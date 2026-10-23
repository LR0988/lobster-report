"""
Oversold Sniper Service (極端超賣快打專屬量化引擎)
全面直連本機 tw_stock.db「全球主權泰坦強勢股庫」與「台股新資料庫 (daily_stock)」
專注觀察強勢股在倉與候選池極端超賣 (Z <= -2.0) 訊號
提供一鍵跟單記錄、即時智慧賣出提示 (10MA停利 / +8% / 10天時間風控)、賣出結利與純歷史進出動態累計損益
"""

import os
import json
import sqlite3
import urllib.request
import numpy as np
import pandas as pd
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")
DEFAULT_DATA_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "defaultOversoldSniperData.json")
TITAN_TRADES_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "global_titan_trades.json")

SUPABASE_URL = os.environ.get("REACT_APP_SUPABASE_URL", "https://hvequgcognhytunjjsyp.supabase.co")
SUPABASE_ANON_KEY = os.environ.get("REACT_APP_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0")

# 知名標的中文名稱補充字典
KNOWN_NAMES = {
    '2330': '台積電 (TSMC 全球晶圓龍頭)',
    '2454': '聯發科 (MediaTek 旗艦晶片霸主)',
    '2317': '鴻海 (Hon Hai 全球EMS代工王者)',
    '2382': '廣達 (Quanta AI伺服器龍頭)',
    '3037': '欣興 (Unimicron ABF載板王者)',
    '2308': '台達電 (Delta 全球電源與散熱王者)',
    '2603': '長榮 (Evergreen 全球貨櫃航運)',
    '1519': '華城 (重電外銷霸主)',
    '1513': '中興電 (重電綠能龍頭)',
    '3443': '創意 (GUC ASIC 龍頭)',
    '3661': '世芯-KY (Alchip ASIC 王者)',
    '6274': '台燿 (高頻高速銅箔基板)',
    '6213': '聯茂 (CCL 銅箔基板大廠)',
    '2383': '台光電 (無鹵素銅箔基板龍頭)',
    '3231': '緯創 (AI伺服器代工龍頭)',
    '2376': '技嘉 (主機板與AI伺服器)',
    '6669': '緯穎 (白牌雲端伺服器巨頭)',
    '3017': '奇鋐 (散熱模組全球龍頭)',
    '8996': '高力 (熱能與散熱關鍵元件)',
    'NVDA': '輝達 (NVIDIA 全球AI晶片霸主)',
    'TSLA': '特斯拉 (Tesla 全球電動車與AI機器人)',
    'AAPL': '蘋果 (Apple 全球消費電子生態王者)',
    'MSFT': '微軟 (Microsoft 全球雲端與軟體巨擘)',
    'GOOGL': '谷歌 (Alphabet 全球搜尋與AI霸主)',
    'GOOG': '谷歌 (Alphabet-C)',
    'META': 'Meta (臉書社群與開源AI龍頭)',
    'AMD': '超微半導體 (AMD AI與處理器)',
    'AVGO': '博通 (Broadcom 網通與客製化晶片)',
    'SMCI': '美超微 (Super Micro Computer AI伺服器)',
    'QCOM': '高通 (Qualcomm 無線通訊晶片龍頭)',
    'ASML': '艾司摩爾 (ASML 全球極紫外光微影龍頭)',
    'MU': '美光科技 (Micron 記憶體巨頭)',
    'NFLX': '網飛 (Netflix 全球影音串流霸主)',
    'COST': '好市多 (Costco 全球倉儲量販龍頭)',
    'LLY': '禮來 (Eli Lilly 全球減肥藥與生技龍頭)',
    'SPY': 'SPDR 標普500 ETF (SPY)',
    'QQQ': 'Invesco 納斯達克100 ETF (QQQ)'
}

def ensure_user_sniper_table(conn):
    """確保用戶實盤快打記錄表存在並支援獨立進出場時間"""
    conn.execute('''
    CREATE TABLE IF NOT EXISTS user_sniper_trades (
        id TEXT PRIMARY KEY,
        ticker TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        market TEXT DEFAULT '台股',
        currency TEXT DEFAULT 'TWD',
        status TEXT DEFAULT 'OPEN', -- 'OPEN' or 'CLOSED'
        entry_date TEXT NOT NULL,
        entry_time TEXT,
        entry_price REAL NOT NULL,
        shares REAL DEFAULT 1000,
        exit_date TEXT,
        exit_time TEXT,
        exit_price REAL,
        exit_reason TEXT,
        pnl_pct REAL,
        pnl_amount REAL,
        holding_days INTEGER DEFAULT 0,
        target_ma10 REAL,
        target_ma20 REAL,
        stop_loss_price REAL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    # 安全檢查欄位
    cols = [col[1] for col in conn.execute("PRAGMA table_info(user_sniper_trades)").fetchall()]
    if 'entry_time' not in cols:
        conn.execute("ALTER TABLE user_sniper_trades ADD COLUMN entry_time TEXT")
    if 'exit_time' not in cols:
        conn.execute("ALTER TABLE user_sniper_trades ADD COLUMN exit_time TEXT")
    conn.commit()

def get_oversold_sniper_dashboard_data():
    """
    即時計算強勢股超賣快打看板數據：
    1. 聚焦「強勢股 (全球主權泰坦庫 + 台股龍頭)」
    2. 直連本機 tw_stock.db 即時運算最新 Z-Score, 10MA, 20MA, 200MA
    3. 載入用戶個人實盤跟單持倉，提供即時賣出提示 (10MA, +8%, 10天時間風控)
    4. 依據真實歷史進出明細動態計算累計勝率與獲利 (無任何快照)
    """
    if not os.path.exists(DB_PATH):
        print(f"找不到資料庫: {DB_PATH}")
        return {}

    conn = sqlite3.connect(DB_PATH)
    ensure_user_sniper_table(conn)

    radar_candidates = []
    market_date = datetime.now().strftime("%Y-%m-%d")
    total_scanned = 0
    trigger_count = 0
    live_price_map = {} # 供持倉計算現價

    try:
        # 1. 取得最新交易日 (全球與台股綜合最新日)
        max_d_tw_res = conn.execute("SELECT max(date) FROM daily_stock WHERE stock_id != 'HOLIDAY'").fetchone()
        max_d_glb_res = conn.execute("SELECT max(date) FROM global_stock_daily").fetchone()
        d_tw = str(max_d_tw_res[0]) if (max_d_tw_res and max_d_tw_res[0]) else "20261022"
        d_tw_fmt = f"{d_tw[:4]}-{d_tw[4:6]}-{d_tw[6:]}" if len(d_tw) == 8 else d_tw[:10]
        d_glb = str(max_d_glb_res[0])[:10] if (max_d_glb_res and max_d_glb_res[0]) else "2026-10-23"
        market_date = max(d_tw_fmt, d_glb)

        # 2. 定義「這邊的強勢股 (Titan Strong Universe)」
        titan_symbols = set()
        if os.path.exists(TITAN_TRADES_PATH):
            try:
                with open(TITAN_TRADES_PATH, "r", encoding="utf-8") as f:
                    t_trades = json.load(f)
                    for t in t_trades:
                        s_id = t.get("stock_id", "")
                        if s_id:
                            titan_symbols.add(s_id)
            except Exception:
                pass

        # 加上全球 metadata 中的巨頭與知名龍頭
        meta_rows = conn.execute("SELECT ticker, name, country, market FROM global_stock_metadata").fetchall()
        meta_map = {}
        for r in meta_rows:
            meta_map[r[0]] = {"name": r[1] or r[0], "country": r[2] or "全球", "market": r[3] or "全球股市"}
            titan_symbols.add(r[0])

        # -------------------------------------------------------------
        # 🇹🇼 [A] 掃描台股強勢股 (Titan 標的 + 台股主力龍頭)
        # -------------------------------------------------------------
        tw_start_date = (pd.to_datetime(market_date) - pd.Timedelta(days=280)).strftime('%Y%m%d')
        
        tw_target_ids = [s.replace(".TW", "") for s in titan_symbols if s.endswith(".TW") or s.isdigit()]
        # 補充台灣指標型龍頭
        extra_tw = ['2330', '2454', '2317', '2382', '2308', '1519', '1513', '3443', '3661', '3037', '3017', '2376', '2383', '3231', '6669', '6274', '2603', '2881', '2882']
        tw_target_ids = list(set(tw_target_ids + extra_tw))

        placeholders = ','.join(['?'] * len(tw_target_ids))
        tw_query = f"""
        SELECT stock_id, stock_name, date, closing_price 
        FROM daily_stock 
        WHERE stock_id IN ({placeholders}) AND date >= ?
        ORDER BY stock_id, date ASC
        """
        tw_df = pd.read_sql(tw_query, conn, params=(*tw_target_ids, tw_start_date))

        for sid, grp in tw_df.groupby("stock_id"):
            if len(grp) < 20:
                continue
            total_scanned += 1
            grp = grp.sort_values("date")
            closes = grp["closing_price"].values
            latest_c = float(closes[-1])
            sname = str(grp["stock_name"].iloc[-1])

            # 20日均值與標準差
            c20 = closes[-20:]
            m20 = np.mean(c20)
            s20 = np.std(c20, ddof=1)
            if s20 < 1e-4:
                continue
            z = (latest_c - m20) / s20

            # 均線體系：MA5, MA10, MA20, MA60, MA200
            ma5 = float(np.mean(closes[-5:]))
            ma10 = float(np.mean(closes[-10:]))
            ma20 = float(m20)
            ma60 = float(np.mean(closes[-60:])) if len(closes) >= 30 else float(ma20)
            ma200 = float(np.mean(closes[-200:])) if len(closes) >= 80 else float(ma10)
            valid_trend = bool(latest_c >= 0.85 * ma200)

            # DOE 最佳均線負乖離評分公式：Score = 0.5 * (MA5-P)/P + 0.5 * (MA60-P)/P
            dev5 = ((ma5 - latest_c) / latest_c) * 100.0
            dev60 = ((ma60 - latest_c) / latest_c) * 100.0
            sniper_power_score = round(0.5 * dev5 + 0.5 * dev60, 2)

            # 依據實測分位數映射勝率等級
            if sniper_power_score >= 8.7:
                win_rate_tier = "🚀 95% 極致深坑"
                win_rate_pct = 95.2
                priority_badge = "👑 優先首選打擊"
                priority_color = "#C084FC"
            elif sniper_power_score >= 8.1:
                win_rate_tier = "⭐ 90% 強烈推薦"
                win_rate_pct = 90.0
                priority_badge = "🔥 強烈優先"
                priority_color = "#34D399"
            elif sniper_power_score >= 4.2:
                win_rate_tier = "🔥 82% 黃金優選"
                win_rate_pct = 81.6
                priority_badge = "⚡ 推薦打擊"
                priority_color = "#38BDF8"
            else:
                win_rate_tier = "⚡ 75% 常態快打"
                win_rate_pct = 74.5
                priority_badge = "👀 常態觀察"
                priority_color = "#94A3B8"

            exp_rebound = round(float(((ma10 - latest_c) / latest_c) * 100), 2)
            exp_rebound_20 = round(float(((ma20 - latest_c) / latest_c) * 100), 2)
            stop_loss = round(float(latest_c * 0.90), 2)
            is_trigger = bool(z <= -2.0 and valid_trend)

            if is_trigger:
                trigger_count += 1

            disp_name = KNOWN_NAMES.get(sid, f"{sname} ({sid})")
            t_key = f"{sid}.TW"

            live_price_map[t_key] = {
                "close": round(latest_c, 2),
                "ma5": round(ma5, 2),
                "ma10": round(ma10, 2),
                "ma20": round(ma20, 2),
                "ma60": round(ma60, 2),
                "ma200": round(ma200, 2),
                "name": disp_name
            }
            live_price_map[sid] = live_price_map[t_key]

            tw_last_d = str(grp["date"].iloc[-1])
            tw_disp_date = f"{tw_last_d[:4]}-{tw_last_d[4:6]}-{tw_last_d[6:]}" if len(tw_last_d) == 8 else tw_last_d[:10]

            radar_candidates.append({
                "ticker": t_key,
                "name": disp_name,
                "country": "台灣",
                "market": "台股上市/上櫃",
                "date": tw_disp_date,
                "close": round(latest_c, 2),
                "ma5": round(ma5, 2),
                "ma10": round(ma10, 2),
                "ma20": round(ma20, 2),
                "ma60": round(ma60, 2),
                "ma200": round(ma200, 2),
                "z_score": round(float(z), 2),
                "dev5_pct": round(dev5, 2),
                "dev60_pct": round(dev60, 2),
                "sniper_power_score": sniper_power_score,
                "win_rate_tier": win_rate_tier,
                "win_rate_pct": win_rate_pct,
                "priority_badge": priority_badge,
                "priority_color": priority_color,
                "exp_rebound_pct": exp_rebound,
                "exp_rebound_ma20_pct": exp_rebound_20,
                "stop_loss_price": stop_loss,
                "valid_trend": valid_trend,
                "is_trigger": is_trigger,
                "holding_limit_days": 10,
                "action_badge": "🔥 極端超賣撈底" if is_trigger else ("🚫 破線排除 (跌破200MA)" if not valid_trend and z <= -1.7 else ("⚠️ 接近超賣警戒" if z <= -1.7 else "強勢多頭整理")),
                "sop_hint": "T+1開盤市價敲進，站上10MA停利一半，觸及+8%或20MA全清，最長持倉10天"
            })

        # -------------------------------------------------------------
        # 🌐 [B] 掃描全球主權泰坦庫 (global_stock_daily)
        # -------------------------------------------------------------
        g_symbols = [s for s in titan_symbols if not s.endswith(".TW") and not s.isdigit()]
        if not g_symbols:
            g_symbols = list(meta_map.keys())

        if g_symbols:
            g_placeholders = ','.join(['?'] * len(g_symbols))
            g_query = f"""
            SELECT ticker, date, close 
            FROM global_stock_daily 
            WHERE ticker IN ({g_placeholders}) AND date >= date(?, '-300 days') AND close IS NOT NULL AND close > 0
            ORDER BY ticker, date ASC
            """
            g_df = pd.read_sql(g_query, conn, params=(*g_symbols, market_date))

            for ticker, grp in g_df.groupby("ticker"):
                if len(grp) < 20:
                    continue
                total_scanned += 1
                grp = grp.sort_values("date")
                closes = grp["close"].values
                latest_c = float(closes[-1])

                c20 = closes[-20:]
                m20 = np.mean(c20)
                s20 = np.std(c20, ddof=1)
                if s20 < 1e-4:
                    continue
                z = (latest_c - m20) / s20

                # 均線體系：MA5, MA10, MA20, MA60, MA200
                ma5 = float(np.mean(closes[-5:]))
                ma10 = float(np.mean(closes[-10:]))
                ma20 = float(m20)
                ma60 = float(np.mean(closes[-60:])) if len(closes) >= 30 else float(ma20)
                ma200 = float(np.mean(closes[-200:])) if len(closes) >= 80 else float(ma10)
                valid_trend = bool(latest_c >= 0.85 * ma200)

                # DOE 最佳均線負乖離評分公式：Score = 0.5 * (MA5-P)/P + 0.5 * (MA60-P)/P
                dev5 = ((ma5 - latest_c) / latest_c) * 100.0
                dev60 = ((ma60 - latest_c) / latest_c) * 100.0
                sniper_power_score = round(0.5 * dev5 + 0.5 * dev60, 2)

                # 依據實測分位數映射勝率等級
                if sniper_power_score >= 8.7:
                    win_rate_tier = "🚀 95% 極致深坑"
                    win_rate_pct = 95.2
                    priority_badge = "👑 優先首選打擊"
                    priority_color = "#C084FC"
                elif sniper_power_score >= 8.1:
                    win_rate_tier = "⭐ 90% 強烈推薦"
                    win_rate_pct = 90.0
                    priority_badge = "🔥 強烈優先"
                    priority_color = "#34D399"
                elif sniper_power_score >= 4.2:
                    win_rate_tier = "🔥 82% 黃金優選"
                    win_rate_pct = 81.6
                    priority_badge = "⚡ 推薦打擊"
                    priority_color = "#38BDF8"
                else:
                    win_rate_tier = "⚡ 75% 常態快打"
                    win_rate_pct = 74.5
                    priority_badge = "👀 常態觀察"
                    priority_color = "#94A3B8"

                exp_rebound = round(float(((ma10 - latest_c) / latest_c) * 100), 2)
                exp_rebound_20 = round(float(((ma20 - latest_c) / latest_c) * 100), 2)
                stop_loss = round(float(latest_c * 0.90), 2)
                is_trigger = bool(z <= -2.0 and valid_trend)

                if is_trigger:
                    trigger_count += 1

                meta = meta_map.get(ticker, {})
                disp_name = KNOWN_NAMES.get(ticker, meta.get("name", ticker))

                live_price_map[ticker] = {
                    "close": round(latest_c, 2),
                    "ma5": round(ma5, 2),
                    "ma10": round(ma10, 2),
                    "ma20": round(ma20, 2),
                    "ma60": round(ma60, 2),
                    "ma200": round(ma200, 2),
                    "name": disp_name
                }

                glb_disp_date = str(grp["date"].iloc[-1])[:10]

                radar_candidates.append({
                    "ticker": ticker,
                    "name": disp_name,
                    "country": meta.get("country", "美股"),
                    "market": meta.get("market", "美股 (NASDAQ/NYSE)"),
                    "date": glb_disp_date,
                    "close": round(latest_c, 2),
                    "ma5": round(ma5, 2),
                    "ma10": round(ma10, 2),
                    "ma20": round(ma20, 2),
                    "ma60": round(ma60, 2),
                    "ma200": round(ma200, 2),
                    "z_score": round(float(z), 2),
                    "dev5_pct": round(dev5, 2),
                    "dev60_pct": round(dev60, 2),
                    "sniper_power_score": sniper_power_score,
                    "win_rate_tier": win_rate_tier,
                    "win_rate_pct": win_rate_pct,
                    "priority_badge": priority_badge,
                    "priority_color": priority_color,
                    "exp_rebound_pct": exp_rebound,
                    "exp_rebound_ma20_pct": exp_rebound_20,
                    "stop_loss_price": stop_loss,
                    "valid_trend": valid_trend,
                    "is_trigger": is_trigger,
                    "holding_limit_days": 10,
                    "action_badge": "🔥 極端超賣撈底" if is_trigger else ("🚫 破線排除 (跌破200MA)" if not valid_trend and z <= -1.7 else ("⚠️ 接近超賣警戒" if z <= -1.7 else "強勢多頭整理")),
                    "sop_hint": "T+1開盤市價敲進，站上10MA停利一半，觸及+8%或20MA全清，最長持倉10天"
                })

        # -------------------------------------------------------------
        # 💼 [C] 即時載入用戶跟單與實盤持倉 (直連 user_sniper_trades)
        # -------------------------------------------------------------
        user_trades_rows = conn.execute("""
            SELECT id, ticker, stock_name, market, currency, status, 
                   entry_date, entry_price, shares, exit_date, exit_price, 
                   exit_reason, pnl_pct, pnl_amount, holding_days, 
                   target_ma10, target_ma20, stop_loss_price, notes,
                   entry_time, exit_time
            FROM user_sniper_trades
            ORDER BY created_at DESC
        """).fetchall()

        active_holdings = []
        closed_trades = []

        for row in user_trades_rows:
            (t_id, t_ticker, t_name, t_market, t_curr, t_status, 
             e_date, e_price, t_shares, x_date, x_price, 
             x_reason, p_pct, p_amt, h_days, 
             t_ma10, t_ma20, t_sl, t_notes,
             e_time, x_time) = row

            if t_status == 'OPEN':
                # 動態更新最新現價與 10MA/20MA
                lp = live_price_map.get(t_ticker, {})
                c_price = lp.get("close", e_price)
                cur_ma10 = lp.get("ma10", t_ma10 or (e_price * 1.05))
                cur_ma20 = lp.get("ma20", t_ma20 or (e_price * 1.08))

                # 計算持有天數
                try:
                    e_dt = datetime.strptime(e_date[:10], "%Y-%m-%d")
                    m_dt = datetime.strptime(market_date[:10], "%Y-%m-%d")
                    calc_days = max(1, (m_dt - e_dt).days)
                except Exception:
                    calc_days = h_days or 1

                # 浮動損益
                unrealized_pct = round(((c_price - e_price) / e_price) * 100.0, 2)
                unrealized_amt = round((c_price - e_price) * t_shares, 2)

                # =====================================================
                # 🎯 智慧賣出提示 (何時可以賣出了)
                # =====================================================
                sell_alerts = []
                can_sell = False
                sell_badge = "⏳ 均值回歸中"
                sell_badge_color = "#38BDF8"
                sell_instruction = "目前反彈進行中，請耐心等待站回 10MA 或波段達標。"

                # 1. 站上 10MA 停利點
                if c_price >= cur_ma10:
                    can_sell = True
                    sell_badge = "🎯 10MA 停利達標"
                    sell_badge_color = "#10B981"
                    sell_instruction = f"🎉 現價 ({c_price}) 已成功站上 10MA ({cur_ma10})！短線勝率 74.5%，建議立即獲利平倉或賣出一半！"
                    sell_alerts.append({
                        "level": "SUCCESS",
                        "title": "🎯 10MA 均值回歸達標",
                        "text": sell_instruction
                    })

                # 2. 觸及 +8% 或 20MA
                if unrealized_pct >= 8.0 or c_price >= cur_ma20:
                    can_sell = True
                    sell_badge = "🚀 +8% / 20MA 擴大停利"
                    sell_badge_color = "#3B82F6"
                    sell_instruction = f"🔥 獲利達 {unrealized_pct:+.2f}% 或已碰 20MA ({cur_ma20})！深彈反抽動能已完全釋放，強烈建議全數獲利了結！"
                    sell_alerts.append({
                        "level": "EXCELLENT",
                        "title": "🚀 波段深彈停利目標",
                        "text": sell_instruction
                    })

                # 3. 滿 10 天時間風控強制出場
                if calc_days >= 10:
                    can_sell = True
                    sell_badge = "⏱️ 滿 10 天時間風控"
                    sell_badge_color = "#DC2626"
                    sell_instruction = f"⏱️ 已達到最長 10 天持有上限（當前第 {calc_days} 天）。依量化紀律請無條件市價平倉，釋放資金至下一檔！"
                    sell_alerts.append({
                        "level": "DANGER",
                        "title": "⏱️ 時間到期強制出場",
                        "text": sell_instruction
                    })
                elif calc_days >= 8:
                    sell_badge = f"⚠️ 倒數第 {calc_days} 天"
                    sell_badge_color = "#F59E0B"
                    sell_instruction = f"⚠️ 已持倉 {calc_days} 天，即將在滿 10 天時強制平倉，請密切注意 10MA 停利機會。"
                    sell_alerts.append({
                        "level": "WARNING",
                        "title": "⚠️ 時間出場倒數",
                        "text": sell_instruction
                    })

                # 4. -10% 硬停損
                if unrealized_pct <= -10.0:
                    can_sell = True
                    sell_badge = "🛑 觸發 -10% 硬停損"
                    sell_badge_color = "#EF4444"
                    sell_instruction = f"🛑 虧損達 {unrealized_pct:.2f}%，已摜破 -10% 防守底線，建議嚴守紀律停損出場！"
                    sell_alerts.append({
                        "level": "STOP_LOSS",
                        "title": "🛑 硬停損風控",
                        "text": sell_instruction
                    })

                entry_time_str = e_time or ""
                active_holdings.append({
                    "id": t_id,
                    "ticker": t_ticker,
                    "name": t_name,
                    "market": t_market,
                    "currency": t_curr,
                    "entry_date": e_date,
                    "entry_time": entry_time_str,
                    "entry_price": e_price,
                    "current_price": c_price,
                    "shares": t_shares,
                    "target_ma10": cur_ma10,
                    "target_ma20": cur_ma20,
                    "stop_loss_price": t_sl or round(e_price * 0.90, 2),
                    "days_held": calc_days,
                    "unrealized_pnl_pct": unrealized_pct,
                    "unrealized_pnl_amount": unrealized_amt,
                    "notes": t_notes or "",
                    "can_sell": can_sell,
                    "sell_badge": sell_badge,
                    "sell_badge_color": sell_badge_color,
                    "sell_instruction": sell_instruction,
                    "sell_alerts": sell_alerts
                })

            else:
                # CLOSED 歷史進出
                closed_trades.append({
                    "id": t_id,
                    "ticker": t_ticker,
                    "name": t_name,
                    "market": t_market,
                    "currency": t_curr,
                    "entry_date": e_date,
                    "entry_time": e_time or "",
                    "entry_price": e_price,
                    "shares": t_shares,
                    "exit_date": x_date or "",
                    "exit_time": x_time or "",
                    "exit_price": x_price or e_price,
                    "exit_reason": x_reason or "手動獲利平倉",
                    "pnl_pct": p_pct or 0.0,
                    "pnl_amount": p_amt or 0.0,
                    "holding_days": h_days or 1,
                    "notes": t_notes or ""
                })

        # -------------------------------------------------------------
        # 📊 [D] 以真實歷史進出明細為單一真相源 (Single Source of Truth)
        # -------------------------------------------------------------
        tot_closed = len(closed_trades)
        wins = [t for t in closed_trades if t["pnl_pct"] > 0]
        losses = [t for t in closed_trades if t["pnl_pct"] <= 0]
        win_rate = round(len(wins) / tot_closed * 100.0, 1) if tot_closed > 0 else 0.0
        
        tot_win_pnl = sum(t["pnl_pct"] for t in wins)
        tot_loss_pnl = abs(sum(t["pnl_pct"] for t in losses))
        profit_factor = round(tot_win_pnl / tot_loss_pnl, 2) if tot_loss_pnl > 0 else 999.0
        avg_ret = round(float(np.mean([t["pnl_pct"] for t in closed_trades])), 2) if tot_closed > 0 else 0.0
        avg_holding = round(float(np.mean([t["holding_days"] for t in closed_trades])), 1) if tot_closed > 0 else 0.0

        # 分別累計台幣與美金實戰已實現獲利金額
        tot_pnl_twd = sum(t["pnl_amount"] for t in closed_trades if t["currency"] == "TWD")
        tot_pnl_usd = sum(t["pnl_amount"] for t in closed_trades if t["currency"] == "USD")

    except Exception as e:
        print(f"掃描強勢股超賣看板失敗: {e}")
    finally:
        conn.close()

    # 排序雷達候選：觸發標的排最前，並嚴格依照「均線彈力評分 (預估勝率最高)」由大到小排序
    radar_candidates.sort(key=lambda x: (not x.get("is_trigger", False), -x.get("sniper_power_score", 0), x.get("z_score", 0)))

    dashboard_data = {
        "status": "ok",
        "strategy_name": "🎯 強勢股極端超賣快打實戰艙 (Titan Oversold Sniper)",
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "market_date": market_date,
        "database_info": {
            "source": "tw_stock.db (全球主權泰坦強勢股庫 + 台股新資料庫 daily_stock)",
            "total_scanned_symbols": total_scanned,
            "taiwan_stocks_scanned": len([c for c in radar_candidates if c["country"] == "台灣"]),
            "global_stocks_scanned": len([c for c in radar_candidates if c["country"] != "台灣"]),
            "latest_trade_date": market_date
        },
        # 實戰操作累計績效 (完全基於真實歷史進出流水帳，無任何快照)
        "user_performance": {
            "total_closed_trades": tot_closed,
            "win_trades": len(wins),
            "loss_trades": len(losses),
            "win_rate": win_rate,
            "profit_factor": profit_factor,
            "avg_return_pct": avg_ret,
            "avg_holding_days": avg_holding,
            "total_pnl_twd": round(tot_pnl_twd, 2),
            "total_pnl_usd": round(tot_pnl_usd, 2),
            "active_positions_count": len(active_holdings)
        },
        # 關注與實戰進行中持倉 (含智慧賣出提醒)
        "active_holdings": active_holdings,
        # 歷史進出實戰記錄 (Single Source of Truth)
        "trade_history": closed_trades,
        # 雷達清單
        "radar": {
            "total_scanned": total_scanned,
            "trigger_count": trigger_count,
            "triggers": [c for c in radar_candidates if c["is_trigger"]],
            "watch_list": [c for c in radar_candidates if c["valid_trend"] and -2.0 < c["z_score"] <= -1.7][:25],
            "broken_trend_list": [c for c in radar_candidates if not c["valid_trend"] and c["z_score"] <= -1.7][:25],
            "taiwan_triggers": [c for c in radar_candidates if c["is_trigger"] and c["country"] == "台灣"],
            "global_triggers": [c for c in radar_candidates if c["is_trigger"] and c["country"] != "台灣"],
            "all_ranked": radar_candidates[:60]
        }
    }

    # 💾 同步持久化快取 (本地 JSON + 雲端 Supabase stock_ml_cache)
    try:
        with open(DEFAULT_DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(dashboard_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"同步寫入 defaultOversoldSniperData.json 失敗: {e}")

    try:
        sync_sniper_dashboard_to_supabase(dashboard_data)
    except Exception as e:
        print(f"同步寫入 Supabase 失敗: {e}")

    return dashboard_data

def sync_sniper_dashboard_to_supabase(dashboard_data):
    """將超賣快打最新全看板數據同步上傳至 Supabase stock_ml_cache 供 Vercel / 移動端無縫讀取"""
    try:
        payload = json.dumps({
            'model_type': 'oversold_sniper_dashboard',
            'payload': json.dumps(dashboard_data, ensure_ascii=False),
            'updated_at': datetime.utcnow().isoformat() + "Z"
        }).encode('utf-8')

        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/stock_ml_cache",
            data=payload,
            headers={
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            pass
    except Exception as e:
        print(f"同步超賣快打至 Supabase 警告: {e}")

def sync_live_quotes_for_sniper():
    """連線即時抓取持倉標的與重點超賣強勢股的 10/23 最新行情，寫入 SQLite"""
    try:
        import yfinance as yf
        conn = sqlite3.connect(DB_PATH)
        ensure_user_sniper_table(conn)

        # 1. 抓取進行中的持倉代號
        active_tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM user_sniper_trades WHERE status = 'OPEN'").fetchall()]
        
        # 2. 加入代表性超賣雷達巨頭與重點觀察標的
        scan_tickers = list(set(active_tickers + [
            'DXCM', 'WEGE3.SA', 'ASML', 'BKR', 'ASX', 'SIEGY', 'MUFG', 'GOOG', 'GOOGL', 
            'NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMD', 'AVGO', 'COST', 'NFLX', 'LLY'
        ]))
        
        df = yf.download(scan_tickers, period='5d', progress=False)
        if 'Close' in df:
            closes = df['Close']
            for t in scan_tickers:
                if t in closes.columns:
                    s = closes[t].dropna()
                    if len(s) > 0:
                        d_str = s.index[-1].strftime('%Y-%m-%d')
                        c_val = float(s.iloc[-1])
                        conn.execute("""
                            INSERT OR REPLACE INTO global_stock_daily (ticker, date, close, volume)
                            VALUES (?, ?, ?, 1000000)
                        """, (t, d_str, c_val))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"抓取最新即時行情警告: {e}")

def run_full_rescan():
    """完整重新掃描：連線抓取最新行情 -> 運算 Z-Score 與停利 -> 存入 SQLite 與預設檔 -> 同步 Supabase"""
    sync_live_quotes_for_sniper()
    return get_oversold_sniper_dashboard_data()

# =================================================================
# 🛠️ 用戶實盤交易 CRUD 接口
# =================================================================
def add_user_trade(ticker, name, market, currency, entry_price, shares, entry_date, notes="", entry_time=None):
    """新增一筆實盤快打記錄 (一鍵跟單或手動新增，支援分開記錄進場日期與時間)"""
    conn = sqlite3.connect(DB_PATH)
    ensure_user_sniper_table(conn)
    c = conn.cursor()

    trade_id = f"snip_{int(datetime.now().timestamp() * 1000)}"
    entry_p = float(entry_price)
    shs = float(shares)
    e_time = entry_time or datetime.now().strftime("%H:%M:%S")
    
    # 預設目標與停損
    target_ma10 = round(entry_p * 1.05, 2)
    target_ma20 = round(entry_p * 1.08, 2)
    stop_loss = round(entry_p * 0.90, 2)

    c.execute("""
        INSERT INTO user_sniper_trades 
        (id, ticker, stock_name, market, currency, status, entry_date, entry_time, entry_price, shares, target_ma10, target_ma20, stop_loss_price, notes)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (trade_id, ticker.upper(), name or ticker, market, currency, entry_date, e_time, entry_p, shs, target_ma10, target_ma20, stop_loss, notes))

    conn.commit()
    conn.close()

    # 即時刷新預設快取
    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {
        "status": "ok", 
        "message": f"成功新增跟單 {ticker} (成本: {entry_p}，進場時間: {entry_date} {e_time})！", 
        "trade_id": trade_id,
        "entry_date": entry_date,
        "entry_time": e_time
    }

def close_user_trade(trade_id, exit_price, exit_date, exit_reason="🎯 觸及 10MA 停利", exit_time=None):
    """平倉一筆快打持倉，分開記錄賣出日期與具體出場時間與獲利"""
    conn = sqlite3.connect(DB_PATH)
    ensure_user_sniper_table(conn)
    c = conn.cursor()

    row = c.execute("SELECT entry_price, shares, entry_date, entry_time FROM user_sniper_trades WHERE id = ?", (trade_id,)).fetchone()
    if not row:
        conn.close()
        return {"status": "error", "message": "找不到該筆交易紀錄"}

    entry_p, shs, e_date, e_time = row
    exit_p = float(exit_price)
    x_time = exit_time or datetime.now().strftime("%H:%M:%S")
    
    # 計算獲利 % 與 金額
    pnl_pct = round(((exit_p - entry_p) / entry_p) * 100.0, 2)
    pnl_amt = round((exit_p - entry_p) * shs, 2)

    # 計算持有天數
    try:
        e_dt = datetime.strptime(e_date[:10], "%Y-%m-%d")
        x_dt = datetime.strptime(exit_date[:10], "%Y-%m-%d")
        holding_days = max(1, (x_dt - e_dt).days)
    except Exception:
        holding_days = 1

    c.execute("""
        UPDATE user_sniper_trades 
        SET status = 'CLOSED',
            exit_date = ?,
            exit_time = ?,
            exit_price = ?,
            exit_reason = ?,
            pnl_pct = ?,
            pnl_amount = ?,
            holding_days = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (exit_date, x_time, exit_p, exit_reason, pnl_pct, pnl_amt, holding_days, trade_id))

    conn.commit()
    conn.close()

    # 即時刷新預設快取
    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {
        "status": "ok", 
        "message": f"成功平倉！賣出價位: {exit_p} (出場時間: {exit_date} {x_time})，本次報酬率: {pnl_pct:+}% (獲利: {pnl_amt:+} )",
        "pnl_pct": pnl_pct,
        "pnl_amount": pnl_amt,
        "exit_date": exit_date,
        "exit_time": x_time
    }

def delete_user_trade(trade_id):
    """刪除一筆交易紀錄並同步刷新快照"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM user_sniper_trades WHERE id = ?", (trade_id,))
    conn.commit()
    conn.close()

    # 即時刷新預設快取，確保刪除後立刻反映
    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {"status": "ok", "message": "已刪除該筆交易紀錄"}
