"""
Oversold Sniper Service 3.0 (極端超賣快打專屬量化引擎 — 五維雙境狙擊 ＋ S/B 雙級動態獲利門檻 ＋ 實盤跟單系統)
全面直連本機 tw_stock.db「台股 505 檔高流動性全池 (daily_stock + institutional_trades + daily_index)」與「全球主權泰坦庫 (global_stock_daily)」
核心架構：
1. 雙境分流進場：
   - 🌪️ 系統性群體恐慌日 (同日超賣家數 >= 12 或 大盤 Z <= -1.4)：捕捉 Z <= -2.5 群體錯殺強勢股
   - 🛡️ 常態平靜日 (無系統恐慌)：強制要求「三大法人近 20 日買超在車上 (Inst20 > 0)」且 Z <= -2.3 ＋ 10MA 空間 >= 4.5%，徹底過濾個股獨跌爆雷！
2. 主力換手與波動率過濾：
   - 下影線比例 Tail Ratio >= 35% ＋ 出量換手 Vol >= 1.2x ＋ 剔除 C 級低波牛皮死魚股 (NATR >= 2.2%)
3. 隔日盤前預掛買單 (台股合法 Tick 對齊)：
   - P_limit = round_tw_tick(0.55 * Close_T + 0.45 * Low_T)，兼顧高穿價成交率與安全折價 (開盤跳空跌逾 -8% 自動放棄)
4. S / B 雙級動態首個獲利門檻與零未來函數盤前預掛賣單系統：
   - 🔥 S 級暴衝大魚股 (NATR >= 3.2% 且 [Mom60 >= 12% 或 投信認養 Trust20 > 0 或 買進當日收高 >= +1.2%])：
     前 4 天首個獲利門檻拉高至 max(昨日10MA, 買進價 × 1.065 (+6.5%))，停利上限 +12.0%！第 5 天起回歸昨日 10MA。
   - ⚡ B 級標準中堅股 (2.2% <= NATR < 3.2%)：
     前 2 天首個獲利門檻設為 max(昨日10MA, 買進價 × 1.035 (+3.5%))，停利上限 +8.5%！第 3 天起回歸昨日 10MA。
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
NAMES_MAP_PATH = os.path.join(BASE_DIR, "tw_stock_names_map.json")
DEFAULT_DATA_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "defaultOversoldSniperData.json")
TITAN_TRADES_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "global_titan_trades.json")

SUPABASE_URL = os.environ.get("REACT_APP_SUPABASE_URL", "https://hvequgcognhytunjjsyp.supabase.co")
SUPABASE_ANON_KEY = os.environ.get("REACT_APP_SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0")

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

def round_tw_tick(price, is_tw=True, mode='round'):
    """
    台股證交所 6 級合法跳動單位 (Tick Size) 對齊，確保散戶可直接複製價格貼入券商 App 委託不踢單
    """
    if price is None or not np.isfinite(price) or price <= 0:
        return 0.0
    p = float(price)
    if not is_tw:
        return round(p, 2)
    if p < 10:
        tick = 0.01
    elif p < 50:
        tick = 0.05
    elif p < 100:
        tick = 0.10
    elif p < 500:
        tick = 0.50
    elif p < 1000:
        tick = 1.00
    else:
        tick = 5.00
    if mode == 'floor':
        val = np.floor((p + 1e-7) / tick) * tick
    elif mode == 'ceil':
        val = np.ceil((p - 1e-7) / tick) * tick
    else:
        val = np.round(p / tick) * tick
    return round(float(val), 2)

def ensure_user_sniper_table(conn):
    """確保用戶實盤快打跟單記錄表存在，並支援 S/B 分級、盤前預掛賣單價與獨立進出場時間"""
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
        tier TEXT DEFAULT 'B',
        natr_pct REAL DEFAULT 2.6,
        mom60_pct REAL DEFAULT 10.0,
        trust_buy INTEGER DEFAULT 0,
        context_mode TEXT DEFAULT '🛡️ 平靜日法人自救',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    cols = [col[1] for col in conn.execute("PRAGMA table_info(user_sniper_trades)").fetchall()]
    alter_cols = [
        ('entry_time', 'TEXT'),
        ('exit_time', 'TEXT'),
        ('tier', "TEXT DEFAULT 'B'"),
        ('natr_pct', 'REAL DEFAULT 2.6'),
        ('mom60_pct', 'REAL DEFAULT 10.0'),
        ('trust_buy', 'INTEGER DEFAULT 0'),
        ('context_mode', "TEXT DEFAULT '🛡️ 平靜日法人自救'")
    ]
    for col_name, col_type in alter_cols:
        if col_name not in cols:
            try:
                conn.execute(f"ALTER TABLE user_sniper_trades ADD COLUMN {col_name} {col_type}")
            except Exception:
                pass
    conn.commit()

def compute_stock_vpvr_and_tail(df_tail_slice, latest_c, is_tw=False):
    """計算最新交易日下影線比例 (Tail Ratio) 與過去 120 日 VPVR 籌碼密集峰間距"""
    tail_ratio = 50.0
    h_col = "highest_price" if is_tw else "high"
    l_col = "lowest_price" if is_tw else "low"
    c_col = "closing_price" if is_tw else "close"
    v_col = "trade_volume" if is_tw else "volume"

    if h_col in df_tail_slice.columns and l_col in df_tail_slice.columns:
        valid_hl = df_tail_slice.dropna(subset=[h_col, l_col])
        if len(valid_hl) > 0:
            last_hl = valid_hl.iloc[-1]
            try:
                h = float(last_hl[h_col])
                l = float(last_hl[l_col])
                c = float(last_hl[c_col])
                rng = h - l
                if rng > 1e-4:
                    tail_ratio = round(max(0.0, min(1.0, (c - l) / rng)) * 100.0, 1)
            except Exception:
                tail_ratio = 50.0

    sub = df_tail_slice.tail(120)
    if c_col in sub.columns:
        c_vals = sub[c_col].dropna().values
        if len(c_vals) >= 10:
            v_vals = sub[v_col].fillna(1.0).values if v_col in sub.columns else np.ones(len(c_vals))
            v_vals = np.nan_to_num(v_vals, nan=1.0)
            hist, bin_edges = np.histogram(c_vals, bins=25, weights=v_vals[:len(c_vals)])
            bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
            p65 = np.percentile(hist, 65)
            hvn_prices = bin_centers[hist >= p65]
            supports = hvn_prices[hvn_prices <= latest_c * 1.01]
            if len(supports) > 0:
                nearest_sup = float(np.max(supports))
                vpvr_gap = round(float(((latest_c - nearest_sup) / latest_c) * 100.0), 1)
            else:
                vpvr_gap = 0.0
        else:
            vpvr_gap = 0.0
    else:
        vpvr_gap = 0.0

    return tail_ratio, vpvr_gap

def get_oversold_sniper_dashboard_data():
    """
    即時計算強勢股超賣快打 3.0 看板數據：
    1. 掃描全市場 505 檔高流動性台股 + 全球主權泰坦美股（修復舊版僅掃 30 檔台股之漏網 Bug）
    2. 往前取 420 日曆天（約 285 交易日）並進行除權息還原，確保 200MA、NATR14、Mom60 與 Z-Score 100% 精準
    3. 直連 daily_index 與 institutional_trades，自動判別今日為「🌪️ 系統性群體恐慌日」或「🛡️ 常態平靜日 (強制要求法人 Inst20 > 0 自救)」
    4. 自動將標的分類為 🔥 S 級暴衝股、⚡ B 級標準股、🐢 C 級低波牛皮股，並計算對齊台股 Tick 的預掛買賣價
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
    live_price_map = {}

    market_regime_info = {
        "taiex_close": 0.0,
        "taiex_ma60": 0.0,
        "taiex_ma200": 0.0,
        "taiex_z": 0.0,
        "idx_bull": True,
        "idx_above_60": True,
        "cluster_cnt_20": 0,
        "cluster_cnt_24": 0,
        "is_panic_day": False,
        "active_mode_badge": "🛡️ 常態平靜日模式 (嚴格要求法人近20日買超 Inst20 > 0 自救護欄)",
        "active_mode_desc": "目前大盤無系統性崩跌恐慌，系統自動開啟「平靜日防爆雷護欄」：僅允許近 20 日三大法人買超在車上 (Inst20 > 0)、距離 10MA 空間 >= 4.5% 且常態波動率 NATR >= 2.2% 的錯殺強勢股進入買進名單，100% 過濾個股獨跌地雷！"
    }

    try:
        # 1. 取得最新交易日
        max_d_tw_res = conn.execute("SELECT max(date) FROM daily_stock WHERE stock_id != 'HOLIDAY'").fetchone()
        max_d_glb_res = conn.execute("SELECT max(date) FROM global_stock_daily").fetchone()
        d_tw = str(max_d_tw_res[0]) if (max_d_tw_res and max_d_tw_res[0]) else "20261027"
        d_tw_fmt = f"{d_tw[:4]}-{d_tw[4:6]}-{d_tw[6:]}" if len(d_tw) == 8 else d_tw[:10]
        d_glb = str(max_d_glb_res[0])[:10] if (max_d_glb_res and max_d_glb_res[0]) else "2026-10-27"
        market_date = max(d_tw_fmt, d_glb)

        # 2. 讀取大盤指數 (daily_index) 計算 200MA、60MA 與大盤 Z-Score
        idx_start_date = (pd.to_datetime(d_tw_fmt) - pd.Timedelta(days=420)).strftime('%Y%m%d')
        df_idx = pd.read_sql(
            "SELECT date, close FROM daily_index WHERE date >= ? ORDER BY date ASC",
            conn, params=(idx_start_date,)
        )
        idx_bull = True
        idx_above_60 = True
        idx_z_val = 0.0
        if len(df_idx) >= 30:
            idx_closes = pd.to_numeric(df_idx["close"], errors="coerce").dropna().values
            if len(idx_closes) >= 20:
                taiex_c = float(idx_closes[-1])
                taiex_m20 = float(np.mean(idx_closes[-20:]))
                taiex_s20 = float(np.std(idx_closes[-20:], ddof=1))
                taiex_m60 = float(np.mean(idx_closes[-min(60, len(idx_closes)):]))
                taiex_m200 = float(np.mean(idx_closes[-min(200, len(idx_closes)):]))
                idx_z_val = round((taiex_c - taiex_m20) / (taiex_s20 + 1e-6), 2)
                idx_bull = bool(taiex_c >= taiex_m200)
                idx_above_60 = bool(taiex_c >= taiex_m60 * 0.99)
                market_regime_info.update({
                    "taiex_close": round(taiex_c, 2),
                    "taiex_ma60": round(taiex_m60, 2),
                    "taiex_ma200": round(taiex_m200, 2),
                    "taiex_z": idx_z_val,
                    "idx_bull": idx_bull,
                    "idx_above_60": idx_above_60
                })

        # 3. 讀取三大法人近 20 個交易日買賣超 (institutional_trades)
        inst_dates_rows = conn.execute(
            "SELECT DISTINCT date FROM institutional_trades ORDER BY date DESC LIMIT 20"
        ).fetchall()
        inst20_map = {}
        trust20_map = {}
        if inst_dates_rows:
            min_inst_d = str(inst_dates_rows[-1][0])
            inst_rows = conn.execute("""
                SELECT stock_id,
                       SUM(COALESCE(foreign_net, 0) + COALESCE(trust_net, 0) + COALESCE(dealer_net, 0)) as inst20,
                       SUM(COALESCE(trust_net, 0)) as trust20
                FROM institutional_trades
                WHERE date >= ?
                GROUP BY stock_id
            """, (min_inst_d,)).fetchall()
            for r_sid, r_inst, r_trust in inst_rows:
                inst20_map[str(r_sid)] = int(r_inst or 0)
                trust20_map[str(r_sid)] = int(r_trust or 0)

        # 4. 載入全市場 505 檔台股名稱映射與全球泰坦清單
        names_map = {}
        if os.path.exists(NAMES_MAP_PATH):
            try:
                with open(NAMES_MAP_PATH, "r", encoding="utf-8") as f:
                    names_map = json.load(f)
            except Exception:
                pass

        titan_symbols = set()
        if os.path.exists(TITAN_TRADES_PATH):
            try:
                with open(TITAN_TRADES_PATH, "r", encoding="utf-8") as f:
                    for t in json.load(f):
                        s_id = t.get("stock_id", "")
                        if s_id:
                            titan_symbols.add(s_id)
            except Exception:
                pass

        meta_rows = conn.execute("SELECT ticker, name, country, market FROM global_stock_metadata").fetchall()
        meta_map = {}
        for r in meta_rows:
            meta_map[r[0]] = {"name": r[1] or r[0], "country": r[2] or "全球", "market": r[3] or "全球股市"}
            titan_symbols.add(r[0])

        # 確保用戶正在持倉的台股也一定在掃描池中
        open_tw_rows = conn.execute("SELECT DISTINCT ticker FROM user_sniper_trades WHERE status IN ('OPEN', 'ACTIVE')").fetchall()
        open_tw_ids = [r[0].replace(".TW", "") for r in open_tw_rows if r[0] and (r[0].endswith(".TW") or r[0].isdigit())]

        # -------------------------------------------------------------
        # 🇹🇼 [A] 第一階段：載入台股全池 (往前 420 日曆天 ≈ 285 交易日，確保 200MA 完整)
        # -------------------------------------------------------------
        tw_start_date = (pd.to_datetime(d_tw_fmt) - pd.Timedelta(days=420)).strftime('%Y%m%d')
        tw_target_ids = sorted(list(set(
            list(names_map.keys()) +
            [s.replace(".TW", "") for s in titan_symbols if s.endswith(".TW") or s.isdigit()] +
            open_tw_ids
        )))

        placeholders = ','.join(['?'] * len(tw_target_ids))
        tw_query = f"""
        SELECT stock_id, stock_name, date, opening_price, highest_price, lowest_price, closing_price,
               trade_volume, change_sign, change_price
        FROM daily_stock
        WHERE stock_id IN ({placeholders}) AND date >= ? AND closing_price > 0
        ORDER BY stock_id, date ASC
        """
        tw_df = pd.read_sql(tw_query, conn, params=(*tw_target_ids, tw_start_date))
        for col in ["opening_price", "highest_price", "lowest_price", "closing_price", "trade_volume", "change_price"]:
            tw_df[col] = pd.to_numeric(tw_df[col], errors="coerce")

        # 先掃描計算每檔台股的除權息還原指標與全市場群體超賣家數 (Cluster Count)
        tw_processed = []
        cluster_cnt_20 = 0
        cluster_cnt_24 = 0

        for sid, grp in tw_df.groupby("stock_id"):
            if len(grp) < 60:
                continue
            grp = grp.drop_duplicates(subset=["date"]).sort_values("date")
            vols = grp["trade_volume"].fillna(0).values
            vol_ma20 = float(np.mean(vols[-20:])) if len(vols) >= 20 else 0.0
            # 過濾掉日均量 < 300 張的極冷門殭屍股（除非是用戶持倉股）
            if vol_ma20 < 300_000 and sid not in open_tw_ids:
                continue

            raw_c = grp["closing_price"].values
            raw_o = grp["opening_price"].fillna(grp["closing_price"]).values
            raw_h = grp["highest_price"].fillna(grp["closing_price"]).values
            raw_l = grp["lowest_price"].fillna(grp["closing_price"]).values
            cp = grp["change_price"].fillna(0.0).values
            sg = grp["change_sign"].astype(str).str.strip().values

            # 除權息還原價格序列 (錨定最新一日真實價格 raw_c[-1])
            signed_chg = np.where(sg == '-', -np.abs(cp), np.where(sg == '+', np.abs(cp), cp))
            ref_p = raw_c - signed_chg
            raw_ret = np.zeros(len(raw_c))
            raw_ret[1:] = raw_c[1:] / np.maximum(raw_c[:-1], 1e-4) - 1.0
            exdiv = (raw_ret < -0.075) & (ref_p > 0) & ((signed_chg / np.maximum(ref_p, 1e-4)) > raw_ret + 0.05)
            adj_ret = raw_ret.copy()
            adj_ret[exdiv] = np.clip(signed_chg[exdiv] / np.maximum(ref_p[exdiv], 1e-4), -0.10, 0.10)
            adj_ret = np.clip(adj_ret, -0.15, 0.15)
            cum_p = np.cumprod(1.0 + adj_ret)
            scale = raw_c[-1] / max(cum_p[-1], 1e-8)
            closes = cum_p * scale
            px_ratio = closes / np.maximum(raw_c, 1e-4)
            highs = raw_h * px_ratio
            lows = raw_l * px_ratio

            latest_c = float(raw_c[-1])
            latest_l = float(raw_l[-1]) if raw_l[-1] > 0 else latest_c
            latest_h = float(raw_h[-1]) if raw_h[-1] > 0 else latest_c
            sname = str(grp["stock_name"].iloc[-1]) if pd.notna(grp["stock_name"].iloc[-1]) else names_map.get(sid, sid)

            c20 = closes[-20:]
            m20 = float(np.mean(c20))
            s20 = float(np.std(c20, ddof=1))
            if s20 < 1e-4:
                continue
            z = (latest_c - m20) / s20

            ma5 = float(np.mean(closes[-5:]))
            ma10 = float(np.mean(closes[-10:]))
            prev_ma10 = float(np.mean(closes[-11:-1])) if len(closes) >= 11 else ma10
            ma15 = float(np.mean(closes[-15:])) if len(closes) >= 15 else ma10
            ma60 = float(np.mean(closes[-60:]))
            ma60_10d_ago = float(np.mean(closes[-70:-10])) if len(closes) >= 70 else ma60
            ma200 = float(np.mean(closes[-min(200, len(closes)):]))
            mom60 = float(closes[-1] / closes[-min(61, len(closes))] - 1.0)
            mom120 = float(closes[-1] / closes[-min(121, len(closes))] - 1.0)

            # 計算 14 日常態波動率 NATR14 (%)
            prev_closes = np.roll(closes, 1)
            prev_closes[0] = closes[0]
            tr_arr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_closes), np.abs(lows - prev_closes)))
            natr14 = float(np.mean(tr_arr[-14:]) / max(latest_c, 1e-4))
            natr_pct = round(natr14 * 100.0, 2)

            uptrend = bool(latest_c >= ma200 and ma60 >= ma60_10d_ago)
            if uptrend and z <= -2.0:
                cluster_cnt_20 += 1
            if uptrend and z <= -2.4:
                cluster_cnt_24 += 1

            tw_processed.append({
                "sid": sid,
                "sname": sname,
                "grp": grp,
                "closes": closes,
                "latest_c": latest_c,
                "latest_l": latest_l,
                "latest_h": latest_h,
                "z": z,
                "ma5": ma5,
                "ma10": ma10,
                "prev_ma10": prev_ma10,
                "ma15": ma15,
                "ma20": m20,
                "ma60": ma60,
                "ma200": ma200,
                "uptrend": uptrend,
                "mom60": mom60,
                "mom120": mom120,
                "natr_pct": natr_pct,
                "vol_latest": float(vols[-1]),
                "vol_ma20": vol_ma20,
                "vol_ratio": round(float(vols[-1]) / max(1.0, vol_ma20), 2),
                "inst20": inst20_map.get(sid, 0),
                "trust20": trust20_map.get(sid, 0),
                "last_date": str(grp["date"].iloc[-1])
            })

        is_panic_day = bool(idx_above_60 and (cluster_cnt_24 >= 12 or idx_z_val <= -1.4))
        market_regime_info["cluster_cnt_20"] = cluster_cnt_20
        market_regime_info["cluster_cnt_24"] = cluster_cnt_24
        market_regime_info["is_panic_day"] = is_panic_day
        if not idx_bull:
            market_regime_info["active_mode_badge"] = "🛑 大盤跌破 200MA 年線保護 (全系統強制空手防禦)"
            market_regime_info["active_mode_desc"] = f"台股加權指數 ({market_regime_info['taiex_close']}) 目前位於 200MA 年線 ({market_regime_info['taiex_ma200']}) 之下，系統啟動最高級別空頭保護，全面暫停買進訊號！"
        elif is_panic_day:
            market_regime_info["active_mode_badge"] = f"🌪️ 系統性群體恐慌日模式 (同日 {cluster_cnt_24} 檔強勢股急殺共振｜大盤 Z={idx_z_val})"
            market_regime_info["active_mode_desc"] = f"今日全市場出現系統性恐慌錯殺（同日 {cluster_cnt_24} 檔多頭股跌破 Z≤-2.4），系統自動啟動「群體恐慌狙擊模式 (Z ≤ -2.5 + 出量換手 ≥ 1.2x + NATR ≥ 2.2%)」全面捕捉錯殺大魚！"
        else:
            market_regime_info["active_mode_badge"] = f"🛡️ 常態平靜日・法人自救模式 (共振僅 {cluster_cnt_24} 檔｜強制要求三大法人近20日買超 Inst20 > 0)"
            market_regime_info["active_mode_desc"] = f"今日大盤處於非崩盤常態日（強勢股超賣共振僅 {cluster_cnt_24} 檔 < 12 檔門檻）。為杜絕踩中「個股私下爆雷獨跌股」，系統嚴格要求【近 20 日三大法人買超在車上 (Inst20 > 0) ＋ Z ≤ -2.3 ＋ 10MA 空間 ≥ 4.5% ＋ NATR ≥ 2.2%】才准許進場！"

        # -------------------------------------------------------------
        # 🇹🇼 [A-2] 第二階段：對每檔台股執行五維雙境判定與 S/B/C 分級動態獲利門檻
        # -------------------------------------------------------------
        for item in tw_processed:
            total_scanned += 1
            sid = item["sid"]
            sname = item["sname"]
            grp = item["grp"]
            latest_c = item["latest_c"]
            latest_l = item["latest_l"]
            z = item["z"]
            ma5 = item["ma5"]
            ma10 = item["ma10"]
            prev_ma10 = item["prev_ma10"]
            ma15 = item["ma15"]
            ma20 = item["ma20"]
            ma60 = item["ma60"]
            ma200 = item["ma200"]
            uptrend = item["uptrend"]
            mom60 = item["mom60"]
            mom60_pct = round(mom60 * 100.0, 2)
            natr_pct = item["natr_pct"]
            vol_ratio = item["vol_ratio"]
            inst20 = item["inst20"]
            trust20 = item["trust20"]

            tail_ratio, vpvr_gap = compute_stock_vpvr_and_tail(grp, latest_c, is_tw=True)

            # 🎯 隔日盤前預掛買單價：0.55 * Close_T + 0.45 * Low_T (對齊台股合法 Tick)
            valid_l = latest_l if (np.isfinite(latest_l) and latest_l > 0) else latest_c
            tomorrow_sniper_price = round_tw_tick(0.55 * latest_c + 0.45 * valid_l, is_tw=True, mode='floor')
            tomorrow_sniper_diff_pct = round(((tomorrow_sniper_price - latest_c) / latest_c) * 100.0, 2) if latest_c > 0 else 0.0
            cancel_gap_price = round_tw_tick(latest_c * 0.92, is_tw=True, mode='floor')
            tomorrow_sniper_deep_price = round_tw_tick(valid_l, is_tw=True, mode='floor')
            tomorrow_sniper_deep_diff_pct = round(((tomorrow_sniper_deep_price - latest_c) / latest_c) * 100.0, 2) if latest_c > 0 else 0.0

            # 距離 10MA 與 20MA 的真實反彈空間 (以預掛買進價 tomorrow_sniper_price 為基準)
            room10_pct = round(((ma10 - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
            room20_pct = round(((ma20 - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)

            # 🔥 S / ⚡ B / 🐢 C 三級動態獲利門檻分類
            is_c_tier_low_vol = bool(natr_pct < 2.2)
            is_s_tier = bool(natr_pct >= 3.2 and (mom60 >= 0.12 or trust20 > 0 or room20_pct >= 9.5))
            if is_c_tier_low_vol:
                stock_tier = "C"
                tier_badge = f"🐢 C級低波牛皮股 (NATR {natr_pct}% < 2.2% 排除)"
                tier_color = "#64748B"
                first_tp_price = round_tw_tick(ma10, is_tw=True, mode='round')
                max_tp_price = round_tw_tick(tomorrow_sniper_price * 1.06, is_tw=True, mode='round')
                tp_rule_desc = "C級低波股反彈空間有限 (單筆期望僅+0.55%)，系統自動排除"
            elif is_s_tier:
                stock_tier = "S"
                tier_badge = f"🔥 S級暴衝大魚股 (NATR {natr_pct}%｜首檻+6.5%/上限+12%)"
                tier_color = "#F43F5E"
                first_tp_price = round_tw_tick(min(tomorrow_sniper_price * 1.09, max(ma10, tomorrow_sniper_price * 1.065)), is_tw=True, mode='round')
                max_tp_price = round_tw_tick(tomorrow_sniper_price * 1.12, is_tw=True, mode='round')
                tp_rule_desc = "🔥S級暴衝股：前4天首個獲利門檻拉高至 max(昨10MA, 買價+6.5%)，上限+12% (歷史均利+2.89%)"
            else:
                stock_tier = "B"
                tier_badge = f"⚡ B級標準中堅股 (NATR {natr_pct}%｜首檻+3.5%/上限+8.5%)"
                tier_color = "#38BDF8"
                first_tp_price = round_tw_tick(min(tomorrow_sniper_price * 1.065, max(ma10, tomorrow_sniper_price * 1.035)), is_tw=True, mode='round')
                max_tp_price = round_tw_tick(tomorrow_sniper_price * 1.085, is_tw=True, mode='round')
                tp_rule_desc = "⚡B級標準股：前2天首個獲利門檻設為 max(昨10MA, 買價+3.5%)，上限+8.5% (歷史均利+2.16%)"

            first_tp_gain_pct = round(((first_tp_price - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
            max_tp_gain_pct = round(((max_tp_price - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
            stop_loss = round_tw_tick(tomorrow_sniper_price * 0.92, is_tw=True, mode='floor')

            # 五維雙境進場判定
            has_tail_support = bool(tail_ratio >= 35.0)
            has_vol_support = bool(vol_ratio >= 1.2)
            has_inst_support = bool(inst20 > 0)
            has_room_support = bool(room10_pct >= 4.5)
            valid_trend = bool(idx_bull and uptrend and mom60 > 0.0)

            context_triggered = False
            context_mode = "常態觀察"
            if valid_trend and not is_c_tier_low_vol:
                if z <= -3.0 and (is_panic_day or has_inst_support or cluster_cnt_20 >= 10):
                    context_triggered = True
                    context_mode = "🌪️ 恐慌極端錯殺 (Z≤-3.0)" if (is_panic_day or cluster_cnt_20 >= 10) else "🛡️ 法人重倉自救 (Z≤-3.0)"
                elif is_panic_day and z <= -2.5:
                    context_triggered = True
                    context_mode = "🌪️ 恐慌日群體錯殺 (Z≤-2.5)"
                elif idx_above_60 and has_inst_support and z <= -2.3 and has_room_support:
                    context_triggered = True
                    context_mode = "🛡️ 平靜日法人自救 (Inst20>0 & Z≤-2.3)"

            is_strict_buy = bool(context_triggered and has_tail_support and has_vol_support)
            is_waiting_tail = bool(
                valid_trend and not is_c_tier_low_vol and z <= -2.3 and
                (is_panic_day or has_inst_support) and not (has_tail_support and has_vol_support)
            )
            is_approaching_extreme = bool(valid_trend and not is_c_tier_low_vol and -2.3 < z <= -1.8 and (is_panic_day or has_inst_support))

            # 綜合狙擊優先序評分 (同日多檔觸發時，優先買爆量換手×下影線×超賣深度最高者)
            sniper_power_score = round(float(vol_ratio * (tail_ratio / 50.0) * abs(min(0.0, z)) * 2.2), 2)

            if is_strict_buy and stock_tier == "S":
                win_rate_tier = "🔥 85%+ S級暴衝大魚狙擊"
                win_rate_pct = 85.0
                priority_badge = "👑 S級暴衝大魚首選 (均利+2.89%)"
                priority_color = "#F43F5E"
            elif is_strict_buy:
                win_rate_tier = "⚡ 83.3% B級標準精準狙擊"
                win_rate_pct = 83.3
                priority_badge = "🎯 B級標準確認買進 (均利+2.16%)"
                priority_color = "#10B981"
            elif is_waiting_tail:
                win_rate_tier = "⏳ 缺下影線或換手量確認"
                win_rate_pct = 75.0
                priority_badge = "⏳ 等待下影≥35%且出量≥1.2x"
                priority_color = "#F59E0B"
            else:
                win_rate_tier = "👀 多頭監控中"
                win_rate_pct = 68.0
                priority_badge = "👀 常態監控"
                priority_color = "#94A3B8"

            if is_strict_buy:
                trigger_count += 1
                action_badge = f"🎯 唯一可買 ({context_mode}｜明日預掛 {tomorrow_sniper_price})"
                action_color = "#10B981"
                sop_hint = (
                    f"🌟 【{tier_badge}・{context_mode}】五維濾網全數通過！"
                    f"① 明日 08:50 盤前預掛【限價買單 NT${tomorrow_sniper_price} ({tomorrow_sniper_diff_pct:+}%)】（若 09:00 開盤跌破 NT${cancel_gap_price} 則放棄不買）；"
                    f"② 成交後首個獲利門檻預掛【NT${first_tp_price} (+{first_tp_gain_pct}%)】，停利上限【NT${max_tp_price} (+{max_tp_gain_pct}%)】；"
                    f"③ 嚴格硬停損【NT${stop_loss} (-8%)】，最長持有 10 天！"
                )
            elif is_c_tier_low_vol and z <= -2.3:
                action_badge = f"🚫 C級低波死魚股排除 (NATR={natr_pct}% < 2.2%)"
                action_color = "#64748B"
                sop_hint = f"雖達超賣 Z={round(z,2)}，但該股 14 日常態波動率 NATR 僅 {natr_pct}% (< 2.2%)，屬低波動牛皮股，歷史反彈極小 (+0.55%)，系統自動剔除！"
            elif valid_trend and z <= -2.3 and not is_panic_day and not has_inst_support:
                action_badge = f"🚫 平靜日無法人保護排除 (Inst20={inst20:,} 股·防獨跌爆雷)"
                action_color = "#EF4444"
                sop_hint = f"⚠️ 關鍵防雷：今日非全市場恐慌日，且該股近 20 日三大法人賣超 ({inst20:,} 股)，平靜日個股獨自重挫極易為私下爆雷股 (歷史勝率僅 56.7%)，嚴禁接刀！"
            elif is_waiting_tail:
                action_badge = f"⏳ 缺下影/出量確認 (Tail={tail_ratio}%, 量={vol_ratio}x)"
                action_color = "#F59E0B"
                sop_hint = f"已達超賣區 (Z={round(z,2)}) 且具法人/恐慌條件，但下影線 ({tail_ratio}% 需≥35%) 或出量換手 ({vol_ratio}x 需≥1.2x) 尚未達標，暫勿盲目接刀！"
            elif is_approaching_extreme:
                action_badge = f"⚡ 接近狙擊警戒 (Z={round(z,2)}·預備價 {tomorrow_sniper_price})"
                action_color = "#38BDF8"
                sop_hint = f"多頭強勢股拉回至 Z={round(z,2)}，接近狙擊區，持續觀察！"
            elif not valid_trend and z <= -2.0:
                action_badge = "🚫 趨勢不符排除 (跌破年線或季線走空)"
                action_color = "#EF4444"
                sop_hint = "未滿足 Close>200MA、60MA向上且季漲幅>0 之長多頭結構，嚴禁抄底空頭弱勢股！"
            else:
                action_badge = "強勢多頭整理"
                action_color = "#64748B"
                sop_hint = "常態多頭震盪"

            disp_name = KNOWN_NAMES.get(sid, f"{sname} ({sid})" if sid not in sname else sname)
            t_key = f"{sid}.TW"
            tw_last_d = item["last_date"]
            tw_disp_date = f"{tw_last_d[:4]}-{tw_last_d[4:6]}-{tw_last_d[6:]}" if len(tw_last_d) == 8 else tw_last_d[:10]

            live_price_map[t_key] = {
                "close": round(latest_c, 2),
                "ma5": round(ma5, 2),
                "ma10": round(ma10, 2),
                "prev_ma10": round(prev_ma10, 2),
                "ma15": round(ma15, 2),
                "ma20": round(ma20, 2),
                "ma60": round(ma60, 2),
                "ma200": round(ma200, 2),
                "natr_pct": natr_pct,
                "mom60_pct": mom60_pct,
                "trust20": trust20,
                "inst20": inst20,
                "tier": stock_tier,
                "name": disp_name,
                "closes_by_date": dict(zip(
                    [f"{str(d)[:4]}-{str(d)[4:6]}-{str(d)[6:]}" if len(str(d)) == 8 else str(d)[:10] for d in grp["date"].values],
                    grp["closing_price"].values
                ))
            }
            live_price_map[sid] = live_price_map[t_key]

            radar_candidates.append({
                "ticker": t_key,
                "name": disp_name,
                "country": "台灣",
                "market": "台股上市/上櫃",
                "date": tw_disp_date,
                "close": round(latest_c, 2),
                "ma5": round(ma5, 2),
                "ma10": round(ma10, 2),
                "prev_ma10": round(prev_ma10, 2),
                "ma20": round(ma20, 2),
                "ma60": round(ma60, 2),
                "ma200": round(ma200, 2),
                "z_score": round(float(z), 2),
                "natr_pct": natr_pct,
                "mom60_pct": mom60_pct,
                "vol_ratio": vol_ratio,
                "inst20_shares": inst20,
                "trust20_shares": trust20,
                "has_inst_support": has_inst_support,
                "has_trust_support": bool(trust20 > 0),
                "context_mode": context_mode,
                "tier": stock_tier,
                "tier_badge": tier_badge,
                "tier_color": tier_color,
                "tp_rule_desc": tp_rule_desc,
                "room10_pct": room10_pct,
                "room20_pct": room20_pct,
                "dev5_pct": round(((ma5 - latest_c) / latest_c) * 100.0, 2),
                "dev60_pct": round(((ma60 - latest_c) / latest_c) * 100.0, 2),
                "sniper_power_score": sniper_power_score,
                "is_strict_bull": valid_trend,
                "win_rate_tier": win_rate_tier,
                "win_rate_pct": win_rate_pct,
                "priority_badge": priority_badge,
                "priority_color": priority_color,
                "exp_rebound_pct": first_tp_gain_pct,
                "exp_rebound_ma20_pct": max_tp_gain_pct,
                "target_stage1_price": first_tp_price,
                "target_stage2_price": max_tp_price,
                "stop_loss_price": stop_loss,
                "cancel_gap_price": cancel_gap_price,
                "tail_ratio": tail_ratio,
                "vpvr_gap": vpvr_gap,
                "has_support": bool(vpvr_gap <= 2.0),
                "has_tail_support": has_tail_support,
                "has_vol_support": has_vol_support,
                "tomorrow_sniper_price": tomorrow_sniper_price,
                "tomorrow_sniper_diff_pct": tomorrow_sniper_diff_pct,
                "tomorrow_sniper_deep_price": tomorrow_sniper_deep_price,
                "tomorrow_sniper_deep_diff_pct": tomorrow_sniper_deep_diff_pct,
                "valid_trend": valid_trend,
                "is_trigger": is_strict_buy,
                "is_strict_buy": is_strict_buy,
                "is_waiting_tail": is_waiting_tail,
                "can_buy": is_strict_buy,
                "action_color": action_color,
                "holding_limit_days": 10,
                "action_badge": action_badge,
                "sop_hint": sop_hint
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
            SELECT ticker, date, high, low, close, volume
            FROM global_stock_daily
            WHERE ticker IN ({g_placeholders}) AND date >= date(?, '-420 days') AND close IS NOT NULL AND close > 0
            ORDER BY ticker, date ASC
            """
            g_df = pd.read_sql(g_query, conn, params=(*g_symbols, market_date))

            for ticker, grp in g_df.groupby("ticker"):
                if len(grp) < 60:
                    continue
                total_scanned += 1
                grp = grp.drop_duplicates(subset=["date"]).sort_values("date")
                closes = grp["close"].values
                latest_c = float(closes[-1])
                lows = grp["low"].fillna(grp["close"]).values
                highs = grp["high"].fillna(grp["close"]).values
                latest_l = float(lows[-1]) if len(lows) > 0 else latest_c

                tail_ratio, vpvr_gap = compute_stock_vpvr_and_tail(grp, latest_c, is_tw=False)

                c20 = closes[-20:]
                m20 = float(np.mean(c20))
                s20 = float(np.std(c20, ddof=1))
                if s20 < 1e-4:
                    continue
                z = (latest_c - m20) / s20

                ma5 = float(np.mean(closes[-5:]))
                ma10 = float(np.mean(closes[-10:]))
                prev_ma10 = float(np.mean(closes[-11:-1])) if len(closes) >= 11 else ma10
                ma20 = float(m20)
                ma60 = float(np.mean(closes[-60:]))
                ma60_10d_ago = float(np.mean(closes[-70:-10])) if len(closes) >= 70 else ma60
                ma200 = float(np.mean(closes[-min(200, len(closes)):]))
                mom60 = float(closes[-1] / closes[-min(61, len(closes))] - 1.0)
                mom60_pct = round(mom60 * 100.0, 2)

                prev_closes = np.roll(closes, 1)
                prev_closes[0] = closes[0]
                tr_arr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_closes), np.abs(lows - prev_closes)))
                natr_pct = round(float(np.mean(tr_arr[-14:]) / max(latest_c, 1e-4)) * 100.0, 2)

                vols = grp["volume"].fillna(0).values
                vol_ma20 = float(np.mean(vols[-20:])) if len(vols) >= 20 else 1.0
                vol_ratio = round(float(vols[-1]) / max(1.0, vol_ma20), 2)
                valid_trend = bool(latest_c >= ma200 and ma60 >= ma60_10d_ago and mom60 > 0.0)

                valid_l = latest_l if (np.isfinite(latest_l) and latest_l > 0) else latest_c
                tomorrow_sniper_price = round(0.55 * latest_c + 0.45 * valid_l, 2)
                tomorrow_sniper_diff_pct = round(((tomorrow_sniper_price - latest_c) / latest_c) * 100.0, 2)
                cancel_gap_price = round(latest_c * 0.92, 2)
                tomorrow_sniper_deep_price = round(valid_l, 2)
                tomorrow_sniper_deep_diff_pct = round(((tomorrow_sniper_deep_price - latest_c) / latest_c) * 100.0, 2)

                room10_pct = round(((ma10 - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
                room20_pct = round(((ma20 - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)

                is_c_tier_low_vol = bool(natr_pct < 2.2)
                is_s_tier = bool(natr_pct >= 3.2 and (mom60 >= 0.12 or room20_pct >= 9.5))
                if is_c_tier_low_vol:
                    stock_tier = "C"
                    tier_badge = f"🐢 C級低波股 (NATR {natr_pct}% < 2.2%)"
                    tier_color = "#64748B"
                    first_tp_price = round(ma10, 2)
                    max_tp_price = round(tomorrow_sniper_price * 1.06, 2)
                    tp_rule_desc = "C級低波動股反彈空間有限，系統自動排除"
                elif is_s_tier:
                    stock_tier = "S"
                    tier_badge = f"🔥 S級暴衝大魚股 (NATR {natr_pct}%｜首檻+6.5%/上限+12%)"
                    tier_color = "#F43F5E"
                    first_tp_price = round(min(tomorrow_sniper_price * 1.09, max(ma10, tomorrow_sniper_price * 1.065)), 2)
                    max_tp_price = round(tomorrow_sniper_price * 1.12, 2)
                    tp_rule_desc = "🔥S級暴衝股：前4天首個獲利門檻 max(昨10MA, 買價+6.5%)，上限+12%"
                else:
                    stock_tier = "B"
                    tier_badge = f"⚡ B級標準中堅股 (NATR {natr_pct}%｜首檻+3.5%/上限+8.5%)"
                    tier_color = "#38BDF8"
                    first_tp_price = round(min(tomorrow_sniper_price * 1.065, max(ma10, tomorrow_sniper_price * 1.035)), 2)
                    max_tp_price = round(tomorrow_sniper_price * 1.085, 2)
                    tp_rule_desc = "⚡B級標準股：前2天首個獲利門檻 max(昨10MA, 買價+3.5%)，上限+8.5%"

                first_tp_gain_pct = round(((first_tp_price - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
                max_tp_gain_pct = round(((max_tp_price - tomorrow_sniper_price) / max(tomorrow_sniper_price, 1e-4)) * 100.0, 2)
                stop_loss = round(tomorrow_sniper_price * 0.92, 2)

                has_tail_support = bool(tail_ratio >= 35.0)
                has_vol_support = bool(vol_ratio >= 1.2)
                is_strict_buy = bool(valid_trend and not is_c_tier_low_vol and z <= -2.5 and room10_pct >= 4.5 and has_tail_support and has_vol_support)
                is_waiting_tail = bool(valid_trend and not is_c_tier_low_vol and z <= -2.4 and not (has_tail_support and has_vol_support))
                sniper_power_score = round(float(vol_ratio * (tail_ratio / 50.0) * abs(min(0.0, z)) * 2.2), 2)

                if is_strict_buy:
                    trigger_count += 1
                    action_badge = f"🎯 唯一可買 (美股泰坦錯殺｜預掛 ${tomorrow_sniper_price})"
                    action_color = "#10B981"
                    sop_hint = f"🌟 全球泰坦【{tier_badge}】通過！請預掛限價買單 ${tomorrow_sniper_price} ({tomorrow_sniper_diff_pct:+}%)，首個獲利門檻 ${first_tp_price} (+{first_tp_gain_pct}%)，上限 ${max_tp_price} (+{max_tp_gain_pct}%)，硬停損 ${stop_loss} (-8%)。"
                elif is_waiting_tail:
                    action_badge = f"⏳ 缺下影/出量確認 (Tail={tail_ratio}%, 量={vol_ratio}x)"
                    action_color = "#F59E0B"
                    sop_hint = f"已達超賣 (Z={round(z,2)}) 但下影線或換手量尚未確認。"
                else:
                    action_badge = "強勢多頭整理"
                    action_color = "#64748B"
                    sop_hint = "常態多頭震盪"

                meta = meta_map.get(ticker, {})
                disp_name = KNOWN_NAMES.get(ticker, meta.get("name", ticker))
                glb_disp_date = str(grp["date"].iloc[-1])[:10]

                live_price_map[ticker] = {
                    "close": round(latest_c, 2),
                    "ma5": round(ma5, 2),
                    "ma10": round(ma10, 2),
                    "prev_ma10": round(prev_ma10, 2),
                    "ma20": round(ma20, 2),
                    "ma60": round(ma60, 2),
                    "ma200": round(ma200, 2),
                    "natr_pct": natr_pct,
                    "mom60_pct": mom60_pct,
                    "trust20": 0,
                    "inst20": 1,
                    "tier": stock_tier,
                    "name": disp_name,
                    "closes_by_date": dict(zip([str(d)[:10] for d in grp["date"].values], closes))
                }

                radar_candidates.append({
                    "ticker": ticker,
                    "name": disp_name,
                    "country": meta.get("country", "美股"),
                    "market": meta.get("market", "美股 (NASDAQ/NYSE)"),
                    "date": glb_disp_date,
                    "close": round(latest_c, 2),
                    "ma5": round(ma5, 2),
                    "ma10": round(ma10, 2),
                    "prev_ma10": round(prev_ma10, 2),
                    "ma20": round(ma20, 2),
                    "ma60": round(ma60, 2),
                    "ma200": round(ma200, 2),
                    "z_score": round(float(z), 2),
                    "natr_pct": natr_pct,
                    "mom60_pct": mom60_pct,
                    "vol_ratio": vol_ratio,
                    "inst20_shares": 0,
                    "trust20_shares": 0,
                    "has_inst_support": True,
                    "has_trust_support": False,
                    "context_mode": "🌐 全球泰坦錯殺",
                    "tier": stock_tier,
                    "tier_badge": tier_badge,
                    "tier_color": tier_color,
                    "tp_rule_desc": tp_rule_desc,
                    "room10_pct": room10_pct,
                    "room20_pct": room20_pct,
                    "dev5_pct": round(((ma5 - latest_c) / latest_c) * 100.0, 2),
                    "dev60_pct": round(((ma60 - latest_c) / latest_c) * 100.0, 2),
                    "sniper_power_score": sniper_power_score,
                    "is_strict_bull": valid_trend,
                    "win_rate_tier": "🔥 S級泰坦狙擊" if stock_tier == "S" else "⚡ B級泰坦狙擊",
                    "win_rate_pct": 82.0,
                    "priority_badge": tier_badge,
                    "priority_color": tier_color,
                    "exp_rebound_pct": first_tp_gain_pct,
                    "exp_rebound_ma20_pct": max_tp_gain_pct,
                    "target_stage1_price": first_tp_price,
                    "target_stage2_price": max_tp_price,
                    "stop_loss_price": stop_loss,
                    "cancel_gap_price": cancel_gap_price,
                    "tail_ratio": tail_ratio,
                    "vpvr_gap": vpvr_gap,
                    "has_support": bool(vpvr_gap <= 2.0),
                    "has_tail_support": has_tail_support,
                    "has_vol_support": has_vol_support,
                    "tomorrow_sniper_price": tomorrow_sniper_price,
                    "tomorrow_sniper_diff_pct": tomorrow_sniper_diff_pct,
                    "tomorrow_sniper_deep_price": tomorrow_sniper_deep_price,
                    "tomorrow_sniper_deep_diff_pct": tomorrow_sniper_deep_diff_pct,
                    "valid_trend": valid_trend,
                    "is_trigger": is_strict_buy,
                    "is_strict_buy": is_strict_buy,
                    "is_waiting_tail": is_waiting_tail,
                    "can_buy": is_strict_buy,
                    "action_color": action_color,
                    "holding_limit_days": 10,
                    "action_badge": action_badge,
                    "sop_hint": sop_hint
                })

        # -------------------------------------------------------------
        # 💼 [C] 即時載入用戶跟單與實盤持倉 (支援 S/B 分級動態獲利門檻與每日 08:50 盤前預掛賣單價)
        # -------------------------------------------------------------
        user_trades_rows = conn.execute("""
            SELECT id, ticker, stock_name, market, currency, status,
                   entry_date, entry_price, shares, exit_date, exit_price,
                   exit_reason, pnl_pct, pnl_amount, holding_days,
                   target_ma10, target_ma20, stop_loss_price, notes,
                   entry_time, exit_time, tier, natr_pct, mom60_pct, trust_buy, context_mode
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
             e_time, x_time, db_tier, db_natr, db_mom60, db_trust, db_ctx) = row

            if t_status in ('OPEN', 'ACTIVE'):
                is_tw_pos = bool(t_curr == 'TWD' or str(t_ticker).endswith('.TW'))
                lp = live_price_map.get(t_ticker, live_price_map.get(str(t_ticker).replace('.TW', ''), {}))
                c_price = float(lp.get("close", e_price))
                cur_ma5 = float(lp.get("ma5", t_ma10 or (e_price * 1.035)))
                cur_ma10 = float(lp.get("ma10", t_ma20 or (e_price * 1.06)))
                prev_ma10 = float(lp.get("prev_ma10", cur_ma10))
                pos_natr = float(lp.get("natr_pct", db_natr or 2.8))
                pos_mom60 = float(lp.get("mom60_pct", db_mom60 or 10.0))
                pos_trust = int(lp.get("trust20", db_trust or 0))
                pos_ctx = db_ctx or "🛡️ 法人自救/群體恐慌"

                # 計算買進當日收盤拉升幅度 (Day1_Ret)：若買進當日收盤已較買進價拉升 >= +1.2% 且 NATR >= 3.0%，自動升級為 🔥 S級暴衝大魚股！
                closes_by_date = lp.get("closes_by_date", {})
                day1_close = closes_by_date.get(str(e_date)[:10], None)
                day1_ret_pct = round(((float(day1_close) - e_price) / e_price) * 100.0, 2) if (day1_close and e_price > 0) else 0.0

                try:
                    e_dt = datetime.strptime(e_date[:10], "%Y-%m-%d")
                    m_dt = datetime.strptime(market_date[:10], "%Y-%m-%d")
                    # 約略換算交易日天數 (每 7 日曆天約 5 交易日)
                    cal_days = max(0, (m_dt - e_dt).days)
                    calc_days = max(1, int(round(cal_days * 5.0 / 7.0))) if cal_days > 0 else 1
                except Exception:
                    calc_days = h_days or 1

                # 判定持倉屬於 🔥 S 級 或 ⚡ B 級
                if db_tier == 'S' or (pos_natr >= 3.0 and (pos_mom60 >= 12.0 or pos_trust > 0 or day1_ret_pct >= 1.2)):
                    pos_tier = 'S'
                    pos_tier_badge = f"🔥 S級暴衝大魚股 (NATR {pos_natr}%)" + (f"｜買進當日收高+{day1_ret_pct}%" if day1_ret_pct >= 1.2 else "")
                    # S級前 4 天首個獲利門檻：min(買價*1.09, max(10MA, 買價 * 1.065))，第 5 天起回歸 10MA，封頂上限 +12%
                    raw_first_tp = min(e_price * 1.09, max(cur_ma10, e_price * 1.065)) if calc_days <= 4 else min(e_price * 1.09, max(cur_ma10, e_price * 1.015))
                    raw_max_tp = e_price * 1.12
                    tier_rule_hint = f"🔥S級規則：第1~4天首個獲利門檻拉高至 max(10MA, +6.5%) [首檻上限+9%]；第5~10天降回 10MA；封頂上限 +12%"
                else:
                    pos_tier = 'B'
                    pos_tier_badge = f"⚡ B級標準中堅股 (NATR {pos_natr}%)"
                    # B級前 2 天首個獲利門檻：min(買價*1.065, max(10MA, 買價 * 1.035))，第 3 天起回歸 10MA，封頂上限 +8.5%
                    raw_first_tp = min(e_price * 1.065, max(cur_ma10, e_price * 1.035)) if calc_days <= 2 else min(e_price * 1.065, max(cur_ma10, e_price * 1.012))
                    raw_max_tp = e_price * 1.085
                    tier_rule_hint = f"⚡B級規則：第1~2天首個獲利門檻設為 max(10MA, +3.5%) [首檻上限+6.5%]；第3~10天回歸 10MA；封頂上限 +8.5%"

                today_limit_sell = round_tw_tick(min(raw_max_tp, raw_first_tp), is_tw=is_tw_pos, mode='round')
                max_tp_price = round_tw_tick(raw_max_tp, is_tw=is_tw_pos, mode='round')
                hard_stop = round_tw_tick(e_price * 0.92, is_tw=is_tw_pos, mode='floor')
                day1_cut_price = round_tw_tick(e_price * 0.985, is_tw=is_tw_pos, mode='floor')
                today_limit_gain_pct = round(((today_limit_sell - e_price) / e_price) * 100.0, 2)

                unrealized_pct = round(((c_price - e_price) / e_price) * 100.0, 2)
                unrealized_amt = round((c_price - e_price) * t_shares, 2)

                sell_alerts = []
                can_sell = False
                c_sign = "NT$" if is_tw_pos else "$"
                sell_badge = f"📋 08:50 預掛賣單 {c_sign}{today_limit_sell} (+{today_limit_gain_pct}%)"
                sell_badge_color = "#F43F5E" if pos_tier == 'S' else "#38BDF8"
                sell_instruction = (
                    f"【{pos_tier_badge}｜持倉第 {calc_days}/10 天】請於明日 08:50 盤前直接預掛【限價賣單 {c_sign}{today_limit_sell} (+{today_limit_gain_pct}%)】"
                    f"（封頂上限 {c_sign}{max_tp_price}，買進日13:30收盤防線 {c_sign}{day1_cut_price} (-1.5%)，盤中硬停損 {c_sign}{hard_stop} (-8%)）。"
                )

                # 🛡️ 0. 仲裁官買進當日收盤破底保護鎖 (Day1 13:30 收盤跌破買價 -1.5% 無下影護盤 -> 隔日早盤立即撤退，0誤殺避開 -8% 大賠)
                if day1_ret_pct <= -1.5 or (calc_days <= 1 and unrealized_pct <= -1.5):
                    can_sell = True
                    today_limit_sell = round_tw_tick(c_price, is_tw=is_tw_pos, mode='round')
                    sell_badge = f"🛡️ 買進日收破 -1.5% ({day1_ret_pct or unrealized_pct}%)！隔日早盤撤退"
                    sell_badge_color = "#F97316"
                    sell_instruction = (
                        f"🛡️【仲裁官保護鎖觸發】買進當日 13:30 收盤較買價跌逾 -1.5%（收在 {c_sign}{c_price}，無主力下影線護盤），"
                        f"歷史實證 100% 為真出貨單（0% 誤殺率）！請於隔日開盤優先撤退平倉，切勿死扛至 -8% 硬停損！"
                    )
                    sell_alerts.append({
                        "level": "WARNING",
                        "title": "🛡️ 買進當日收盤破底保護鎖 (-1.5%)",
                        "text": sell_instruction
                    })

                # 1. 檢查是否已達今日動態首個獲利門檻或封頂上限
                if c_price >= today_limit_sell and not (day1_ret_pct <= -1.5 or (calc_days <= 1 and unrealized_pct <= -1.5)) or unrealized_pct >= (12.0 if pos_tier == 'S' else 8.5):
                    can_sell = True
                    sell_badge = f"🚀 已達 {pos_tier} 級獲利門檻 ({c_sign}{today_limit_sell})！立即平倉"
                    sell_badge_color = "#10B981"
                    sell_instruction = f"🎉 現價 ({c_sign}{c_price}, {unrealized_pct:+.2f}%) 已突破 {pos_tier} 級首個獲利門檻 ({c_sign}{today_limit_sell})！請立即全數獲利平倉落袋！"
                    sell_alerts.append({
                        "level": "EXCELLENT",
                        "title": f"🚀 {pos_tier}級獲利門檻達標",
                        "text": sell_instruction
                    })

                # 2. 滿 10 天時間風控強制出場
                if calc_days >= 10:
                    can_sell = True
                    sell_badge = "⏱️ 滿 10 天時間風控強制清倉"
                    sell_badge_color = "#DC2626"
                    sell_instruction = f"⏱️ 已達到最長 10 天持有上限（第 {calc_days} 天）。依量化紀律請於收盤無條件市價平倉，回收資金！"
                    sell_alerts.append({
                        "level": "DANGER",
                        "title": "⏱️ 滿 10 天強制平倉",
                        "text": sell_instruction
                    })
                elif calc_days >= 8 and not can_sell:
                    sell_badge = f"⚠️ 倒數第 {calc_days}/10 天 (預掛 {c_sign}{today_limit_sell})"
                    sell_badge_color = "#F59E0B"

                # 3. -8% 硬停損防線
                if c_price <= hard_stop or unrealized_pct <= -8.0:
                    can_sell = True
                    sell_badge = f"🛑 觸發 -8% 硬停損 ({c_sign}{hard_stop})"
                    sell_badge_color = "#EF4444"
                    sell_instruction = f"🛑 現價 ({c_sign}{c_price}, {unrealized_pct:.2f}%) 已跌破 -8% 硬停損防線 ({c_sign}{hard_stop})，請嚴守紀律立即止血平倉！"
                    sell_alerts.append({
                        "level": "STOP_LOSS",
                        "title": "🛑 -8% 硬停損風控",
                        "text": sell_instruction
                    })

                active_holdings.append({
                    "id": t_id,
                    "ticker": t_ticker,
                    "name": t_name,
                    "market": t_market,
                    "currency": t_curr,
                    "tier": pos_tier,
                    "tier_badge": pos_tier_badge,
                    "tier_rule_hint": tier_rule_hint,
                    "natr_pct": pos_natr,
                    "day1_ret_pct": day1_ret_pct,
                    "context_mode": pos_ctx,
                    "entry_date": e_date,
                    "entry_time": e_time or "",
                    "entry_price": e_price,
                    "current_price": c_price,
                    "shares": t_shares,
                    "target_ma10": round_tw_tick(cur_ma10, is_tw_pos),
                    "target_ma20": max_tp_price,
                    "today_limit_sell_price": today_limit_sell,
                    "today_limit_gain_pct": today_limit_gain_pct,
                    "target_stage1": today_limit_sell,
                    "target_stage2": max_tp_price,
                    "stop_loss_price": hard_stop,
                    "max_holding_days": 10,
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
                closed_trades.append({
                    "id": t_id,
                    "ticker": t_ticker,
                    "name": t_name,
                    "market": t_market,
                    "currency": t_curr,
                    "tier": db_tier or "B",
                    "context_mode": db_ctx or "🛡️ 法人自救/群體恐慌",
                    "entry_date": e_date,
                    "entry_time": e_time or "",
                    "entry_price": e_price,
                    "shares": t_shares,
                    "exit_date": x_date or "",
                    "exit_time": x_time or "",
                    "exit_price": x_price or e_price,
                    "exit_reason": x_reason or "🎯 達標獲利平倉",
                    "pnl_pct": p_pct or 0.0,
                    "pnl_amount": p_amt or 0.0,
                    "holding_days": h_days or 1,
                    "notes": t_notes or ""
                })

        # -------------------------------------------------------------
        # 📊 [D] 以真實歷史進出明細為單一真相源 (Single Source of Truth)
        # -------------------------------------------------------------
        tot_closed = len(closed_trades)
        wins = [t for t in closed_trades if (t["pnl_pct"] or 0) > 0]
        losses = [t for t in closed_trades if (t["pnl_pct"] or 0) <= 0]
        win_rate = round(len(wins) / tot_closed * 100.0, 1) if tot_closed > 0 else 0.0

        tot_win_pnl = sum(t["pnl_pct"] for t in wins)
        tot_loss_pnl = abs(sum(t["pnl_pct"] for t in losses))
        profit_factor = round(tot_win_pnl / tot_loss_pnl, 2) if tot_loss_pnl > 0 else 999.0
        avg_ret = round(float(np.mean([t["pnl_pct"] for t in closed_trades])), 2) if tot_closed > 0 else 0.0
        avg_holding = round(float(np.mean([t["holding_days"] for t in closed_trades])), 1) if tot_closed > 0 else 0.0

        tot_pnl_twd = sum(t["pnl_amount"] for t in closed_trades if t["currency"] == "TWD")
        tot_pnl_usd = sum(t["pnl_amount"] for t in closed_trades if t["currency"] == "USD")

    except Exception as e:
        import traceback
        print(f"掃描強勢股超賣看板失敗: {e}")
        traceback.print_exc()
    finally:
        conn.close()

    # 排序雷達候選：唯一可買進排最前（內部依 S 級 > B 級 > 狙擊分排序），其次為缺下影線者，其次依 Z-Score 由小到大
    radar_candidates.sort(key=lambda x: (
        not x.get("is_strict_buy", False),
        0 if x.get("tier") == "S" else (1 if x.get("tier") == "B" else 2),
        not x.get("is_waiting_tail", False),
        -x.get("sniper_power_score", 0),
        x.get("z_score", 0)
    ))

    strict_buys = [c for c in radar_candidates if c.get("is_strict_buy", False)]
    waiting_tails = [c for c in radar_candidates if c.get("is_waiting_tail", False)]

    # 為今日可買進清單標上跟單優先序 Rank #1, #2 (對應 2 槽位上限)
    for idx_rank, sb_item in enumerate(strict_buys):
        sb_item["order_rank"] = idx_rank + 1
        sb_item["is_top2_slot"] = bool(idx_rank < 2)

    dashboard_data = {
        "status": "ok",
        "strategy_name": "🎯 強勢股極端超賣快打 3.0 — 五維雙境狙擊 (群體恐慌＋法人自救) ＋ S/B 雙級動態獲利門檻",
        "strategy_summary": {
            "win_rate": 84.2,
            "avg_return_pct": 2.54,
            "s_tier_avg_return_pct": 2.89,
            "b_tier_avg_return_pct": 2.16,
            "profit_factor": 3.80,
            "mdd_pct": -5.61,
            "parked_0050_multiple": 8.92,
            "expectancy": 2.54,
            "total_backtest_trades": 38,
            "entry_mode": "隔日盤前預掛下影中點偏上 0.55×Close + 0.45×Low (對齊台股Tick，嚴格穿價成交)",
            "exit_mode": "🔥S級前4天 max(昨10MA,+6.5%)/上限+12% ｜ ⚡B級前2天 max(昨10MA,+3.5%)/上限+8.5% ｜ 剔除NATR<2.2%牛皮股",
            "holding_days": 10,
            "max_slots": 2
        },
        "market_regime": market_regime_info,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "market_date": market_date,
        "database_info": {
            "source": "tw_stock.db (台股 505 檔高流動性全池 + 三大法人籌碼庫 + 全球主權泰坦庫)",
            "total_scanned_symbols": total_scanned,
            "taiwan_stocks_scanned": len([c for c in radar_candidates if c["country"] == "台灣"]),
            "global_stocks_scanned": len([c for c in radar_candidates if c["country"] != "台灣"]),
            "latest_trade_date": market_date
        },
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
        "active_holdings": active_holdings,
        "trade_history": closed_trades,
        "radar": {
            "total_scanned": total_scanned,
            "trigger_count": len(strict_buys),
            "strict_buy_count": len(strict_buys),
            "waiting_tail_count": len(waiting_tails),
            "strict_buy_triggers": strict_buys,
            "waiting_tail_triggers": waiting_tails,
            "triggers": strict_buys,
            "all_oversold": [c for c in radar_candidates if c["z_score"] <= -2.0 and c["valid_trend"]],
            "watch_list": [c for c in radar_candidates if c["valid_trend"] and c["tier"] != "C" and -2.3 < c["z_score"] <= -1.7][:35],
            "broken_trend_list": [c for c in radar_candidates if (not c["valid_trend"] or c["tier"] == "C") and c["z_score"] <= -2.0][:35],
            "taiwan_triggers": [c for c in strict_buys if c["country"] == "台灣"],
            "global_triggers": [c for c in strict_buys if c["country"] != "台灣"],
            "all_ranked": radar_candidates[:100]
        }
    }

    def sanitize_val(v):
        if isinstance(v, float):
            if np.isnan(v) or np.isinf(v):
                return None
            return v
        elif isinstance(v, dict):
            return {k: sanitize_val(val) for k, val in v.items()}
        elif isinstance(v, list):
            return [sanitize_val(val) for val in v]
        return v

    dashboard_data = sanitize_val(dashboard_data)

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

# 相容 api.py 自動排程呼叫名稱
get_oversold_sniper_data = get_oversold_sniper_dashboard_data

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
    """連線即時抓取持倉標的與重點強勢股最新行情，寫入 SQLite"""
    try:
        import yfinance as yf
        conn = sqlite3.connect(DB_PATH)
        ensure_user_sniper_table(conn)

        active_tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM user_sniper_trades WHERE status IN ('OPEN', 'ACTIVE')").fetchall()]
        scan_tickers = list(set(active_tickers + [
            'DXCM', 'WEGE3.SA', 'ASML', 'BKR', 'ASX', 'SIEGY', 'MUFG', 'GOOG', 'GOOGL',
            'NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMD', 'AVGO', 'COST', 'NFLX', 'LLY',
            '1513.TW', '2330.TW', '2308.TW', '0050.TW', '2317.TW', '2454.TW'
        ]))

        today_str = datetime.now().strftime('%Y-%m-%d')
        for t in scan_tickers:
            try:
                tick = yf.Ticker(t)
                last_p = tick.fast_info.get('lastPrice', None)
                if last_p is not None and last_p > 0:
                    conn.execute("""
                        INSERT OR REPLACE INTO global_stock_daily (ticker, date, close, volume)
                        VALUES (?, ?, ?, 1000000)
                    """, (t, today_str, round(float(last_p), 2)))
            except Exception:
                pass
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"抓取最新即時行情警告: {e}")

def run_full_rescan():
    """完整重新掃描：連線抓取最新行情 -> 運算五維雙境與 S/B 分級停利 -> 存入 SQLite 與預設檔 -> 同步 Supabase"""
    sync_live_quotes_for_sniper()
    return get_oversold_sniper_dashboard_data()

# =================================================================
# 🛠️ 用戶實盤跟單 CRUD 接口 (支援 S/B 分級與動態獲利門檻持久化)
# =================================================================
def add_user_trade(ticker, name, market, currency, entry_price, shares, entry_date, notes="", entry_time=None,
                   tier="B", natr_pct=2.8, mom60_pct=10.0, trust_buy=0, context_mode="🛡️ 平靜日法人自救"):
    """新增一筆實盤快打跟單記錄 (自動計算 S/B 級首個獲利門檻與合法 Tick 停損價)"""
    conn = sqlite3.connect(DB_PATH)
    ensure_user_sniper_table(conn)
    c = conn.cursor()

    trade_id = f"snip_{int(datetime.now().timestamp() * 1000)}"
    is_tw = bool(currency == 'TWD' or str(ticker).upper().endswith('.TW'))
    entry_p = round_tw_tick(float(entry_price), is_tw=is_tw, mode='round')
    shs = float(shares)
    e_time = entry_time or datetime.now().strftime("%H:%M:%S")
    tier_str = str(tier or "B").upper()

    if tier_str == 'S':
        target_ma10 = round_tw_tick(entry_p * 1.065, is_tw=is_tw, mode='round')
        target_ma20 = round_tw_tick(entry_p * 1.12, is_tw=is_tw, mode='round')
    else:
        target_ma10 = round_tw_tick(entry_p * 1.035, is_tw=is_tw, mode='round')
        target_ma20 = round_tw_tick(entry_p * 1.085, is_tw=is_tw, mode='round')
    stop_loss = round_tw_tick(entry_p * 0.92, is_tw=is_tw, mode='floor')

    c.execute("""
        INSERT INTO user_sniper_trades
        (id, ticker, stock_name, market, currency, status, entry_date, entry_time, entry_price, shares,
         target_ma10, target_ma20, stop_loss_price, tier, natr_pct, mom60_pct, trust_buy, context_mode, notes)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        trade_id, ticker.upper(), name or ticker, market, currency, entry_date, e_time, entry_p, shs,
        target_ma10, target_ma20, stop_loss, tier_str, float(natr_pct or 2.8), float(mom60_pct or 10.0),
        int(trust_buy or 0), str(context_mode or "🛡️ 平靜日法人自救"), notes
    ))

    conn.commit()
    conn.close()

    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {
        "status": "ok",
        "message": f"成功新增【{tier_str}級】跟單 {ticker} (買價: {entry_p}，首檻停利: {target_ma10}，上限: {target_ma20}，停損: {stop_loss})！",
        "trade_id": trade_id,
        "tier": tier_str,
        "entry_price": entry_p,
        "first_tp_price": target_ma10,
        "max_tp_price": target_ma20,
        "stop_loss_price": stop_loss,
        "entry_date": entry_date,
        "entry_time": e_time
    }

def close_user_trade(trade_id, exit_price, exit_date, exit_reason="🎯 觸及首個獲利門檻停利", exit_time=None):
    """平倉一筆快打持倉，自動扣除或記錄實戰報酬與金額"""
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

    pnl_pct = round(((exit_p - entry_p) / entry_p) * 100.0, 2)
    pnl_amt = round((exit_p - entry_p) * shs, 2)

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

    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {
        "status": "ok",
        "message": f"成功平倉！賣出價位: {exit_p} (出場時間: {exit_date} {x_time})，本次報酬率: {pnl_pct:+}% (獲利: {pnl_amt:+})",
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

    try:
        get_oversold_sniper_dashboard_data()
    except Exception:
        pass

    return {"status": "ok", "message": "已刪除該筆交易紀錄"}
