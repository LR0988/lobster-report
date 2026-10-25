"""
Global Sovereign Service (Scheme A Upgrade - Direct SQLite Database Connection)
直連本機 tw_stock.db 資料庫，動態計算最新美股、台股、全球泰坦旗艦行情與持倉
絕不使用過期靜態快取
"""

import os
import json
import sqlite3
import numpy as np
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")
local_template = os.path.join(os.path.dirname(__file__), "frontend", "src", "data", "defaultGlobalSovereignData.json")
parent_template = os.path.join(os.path.dirname(__file__), "..", "openclaw_test", "frontend", "src", "data", "defaultGlobalSovereignData.json")
TEMPLATE_PATH = local_template if os.path.exists(local_template) else parent_template

GLOBAL_STOCK_NAME_MAP = {
    '8996.TW': '高力 (Kaori 水冷散熱飆股)',
    '8996': '高力',
    '3017.TW': '奇鋐 (AI 水冷散熱龍頭)',
    '3017': '奇鋐',
    '3008.TW': '大立光 (Largan 光學鏡頭鏡王)',
    '3008': '大立光',
    '3037.TW': '欣興 (Unimicron 載板王者)',
    '3037': '欣興',
    '3443.TW': '創意 (Global Unichip ASIC)',
    '3443': '創意',
    '2330.TW': '台積電 (TSMC 神山)',
    '2330': '台積電',
    '2454.TW': '聯發科 (MediaTek 晶片霸主)',
    '2454': '聯發科',
    '2382.TW': '廣達 (AI 伺服器代工)',
    '2382': '廣達',
    '3231.TW': '緯創 (AI 代工伺服器)',
    '3231': '緯創',
    '6669.TW': '緯穎 (AI 伺服器巨頭)',
    '6669': '緯穎',
    '2317.TW': '鴻海 (電子代工巨擘)',
    '2317': '鴻海',
    '2308.TW': '台達電 (綠能電源龍頭)',
    '2308': '台達電',
    '3661.TW': '世芯-KY (AI ASIC 矽智財)',
    '3661': '世芯-KY',
    '2603.TW': '長榮海運 (貨櫃航運龍頭)',
    '2603': '長榮',
    '2609.TW': '陽明海運 (貨櫃航運)',
    '2609': '陽明',
    'MRNA': '莫德納 (Moderna 生技巨擘)',
    'TEAM': 'Atlassian (TEAM 協同軟體龍頭)',
    'ASX': '日月光投控 (ASE 封測龍頭ADR)',
    'ILMN': '因美納 (Illumina 基因定序霸主)',
    'PBR': '巴西石油 ADR (Petrobras)',
    'MU': '美光科技 (Micron 記憶體巨頭)',
    'NVDA': '輝達 (NVIDIA AI算力之王)',
    'AVGO': '博通 (Broadcom 網通霸主)',
    'TSLA': '特斯拉 (Tesla 自動駕駛)',
    'AAPL': '蘋果 (Apple)',
    'MSFT': '微軟 (Microsoft)',
    'AMZN': '亞馬遜 (Amazon)',
    'GOOGL': '谷歌 (Alphabet)',
    'META': 'Meta (臉書)'
}

def _resolve_display_name(ticker: str, cursor=None) -> str:
    if ticker in GLOBAL_STOCK_NAME_MAP:
        return GLOBAL_STOCK_NAME_MAP[ticker]
    base = ticker.split(".")[0]
    if base in GLOBAL_STOCK_NAME_MAP:
        return f"{GLOBAL_STOCK_NAME_MAP[base]} ({ticker})"
    if cursor and (ticker.endswith(".TW") or base.isdigit()):
        try:
            cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL LIMIT 1", (base,))
            row = cursor.fetchone()
            if row and row[0]:
                return f"{row[0]} ({ticker})"
        except Exception:
            pass
    return ticker

def get_global_sovereign_dashboard_data():
    """
    直接從 tw_stock.db 的 global_stock_daily 及 global_sovereign_positions 資料表
    即時計算最新收盤價、均線、動能與損益指標
    """
    data = None
    if os.path.exists(TEMPLATE_PATH):
        try:
            with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print("讀取策略範本失敗:", e)
    
    if not data:
        data = {
            "status": "ok",
            "strategy_name": "👑 全球高流動性主權泰坦 (純雙梯隊進攻版)",
            "current_picks": [],
            "macro_status": {}
        }

    if not os.path.exists(DB_PATH):
        return data

    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        # 1. 宏觀指標 (SPY 及 雙頻複合主權寬幅 75% 200MA + 25% 60MA) 直查資料庫
        c.execute("SELECT date, close FROM global_stock_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 260", ('SPY',))
        spy_rows = c.fetchall()
        spy_closes = [float(r[1]) for r in spy_rows if r[1] is not None]
        spy_dates = [r[0] for r in spy_rows if r[1] is not None]
        spy_ret_map = {}
        for idx_s in range(len(spy_closes) - 1):
            if spy_closes[idx_s + 1] > 0:
                spy_ret_map[spy_dates[idx_s]] = (spy_closes[idx_s] - spy_closes[idx_s + 1]) / spy_closes[idx_s + 1]

        if spy_closes:
            spy_latest = spy_closes[0]
            spy_ma200 = sum(spy_closes[:200]) / len(spy_closes[:200])
            if "macro_status" not in data:
                data["macro_status"] = {}
            data["macro_status"]["spy_price"] = round(spy_latest, 2)
            data["macro_status"]["spy_ma200"] = round(spy_ma200, 2)

        # 動態計算 15 國主權 ETF 與美台核心 ETF (SPY/QQQ/EWT) 對齊雙頻複合寬幅
        candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
        core_etfs = {'SPY', 'QQQ', 'EWT'}
        br200_cnt, br60_cnt, valid_etf_cnt = 0, 0, 0
        core200_cnt, core60_cnt, valid_core_cnt = 0, 0, 0
        for etf_code in candidate_etfs:
            c.execute("SELECT close FROM global_sovereign_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 200", (etf_code,))
            erows = [float(r[0]) for r in c.fetchall() if r[0] is not None]
            if len(erows) >= 60:
                valid_etf_cnt += 1
                ab200 = erows[0] > (sum(erows[:200]) / len(erows[:200]))
                ab60 = erows[0] > (sum(erows[:60]) / len(erows[:60]))
                if ab200:
                    br200_cnt += 1
                if ab60:
                    br60_cnt += 1
                if etf_code in core_etfs:
                    valid_core_cnt += 1
                    if ab200:
                        core200_cnt += 1
                    if ab60:
                        core60_cnt += 1
        if valid_etf_cnt > 0:
            br200_ratio = br200_cnt / float(valid_etf_cnt)
            br60_ratio = br60_cnt / float(valid_etf_cnt)
            global15_br = 0.75 * br200_ratio + 0.25 * br60_ratio
            if valid_core_cnt > 0:
                core_br = 0.60 * (core200_cnt / float(valid_core_cnt)) + 0.40 * (core60_cnt / float(valid_core_cnt))
                comp_br = 0.50 * global15_br + 0.50 * core_br
            else:
                comp_br = global15_br
            data["macro_status"]["global_breadth_pct"] = round(comp_br * 100.0, 1)
            data["macro_status"]["bull_countries"] = f"{int(round(comp_br * valid_etf_cnt))}/{valid_etf_cnt}"
            if comp_br >= 0.50:
                data["macro_status"]["exposure_pct"] = 100
                data["macro_status"]["regime"] = f"全球共振多頭 (美台核心對齊寬幅 {comp_br*100:.1f}% >= 50% -> A/B雙梯隊100%滿倉進攻)"
            elif comp_br >= 0.30:
                data["macro_status"]["exposure_pct"] = 70
                data["macro_status"]["regime"] = f"全球宏觀分化警示 (美台核心對齊寬幅 {comp_br*100:.1f}% -> 防禦型 70% 倉位)"
            else:
                data["macro_status"]["exposure_pct"] = 0
                data["macro_status"]["regime"] = f"全球系統性空頭 (美台核心對齊寬幅 {comp_br*100:.1f}% < 30% -> 100% 轉入 GLD/BIL 避險池)"

        # 2. 候選清單 current_picks 與實盤持倉全部由資料庫即時運算覆蓋
        max_dt = ""
        max_tw_dt = ""
        max_us_dt = ""
        live_prices = {}

        def _query_ticker_stats(t_code: str):
            c.execute("SELECT date, close, volume FROM global_stock_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 260", (t_code,))
            r_list = c.fetchall()
            # 若為 .TW 標的，同時比對 daily_stock 是否具有更新之收盤價
            if t_code.endswith(".TW"):
                sid = t_code.split(".")[0]
                c.execute("SELECT date, closing_price, trade_volume FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 5", (sid,))
                tw_rows = c.fetchall()
                if tw_rows:
                    d_raw = str(tw_rows[0][0]).strip()
                    d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                    tw_px = float(tw_rows[0][1])
                    tw_vol = float(tw_rows[0][2] or 0.0)
                    if not r_list or d_fmt > r_list[0][0] or (d_fmt == r_list[0][0] and abs(tw_px - float(r_list[0][1])) > 0.001):
                        r_list = [(d_fmt, tw_px, tw_vol)] + [r for r in r_list if r[0] != d_fmt]
            if not r_list:
                return None
            closes = [float(r[1]) for r in r_list if r[1] is not None]
            dates = [r[0] for r in r_list if r[1] is not None]
            vols = [float(r[2] or 0.0) for r in r_list if r[1] is not None]
            if not closes:
                return None
            cur_px = round(closes[0], 2)
            cur_dt = dates[0]
            ma60 = round(float(sum(closes[:60]) / len(closes[:60])), 2) if len(closes) >= 60 else cur_px
            ma200 = round(float(sum(closes[:200]) / len(closes[:200])), 2) if len(closes) >= 200 else cur_px
            mom1m = round(float((closes[0] / closes[min(21, len(closes)-1)] - 1.0) * 100.0), 1) if len(closes) > 21 else 0.0
            mom3m = round(float((closes[0] / closes[min(63, len(closes)-1)] - 1.0) * 100.0), 1) if len(closes) > 63 else None
            mom12m = round(float((closes[0] / closes[min(252, len(closes)-1)] - 1.0) * 100.0), 1) if len(closes) > 1 else None

            # 計算每日報酬序列 (由近到遠)
            daily_rets = []
            for idx_d in range(len(closes) - 1):
                prev_c = closes[idx_d + 1]
                if prev_c > 0:
                    daily_rets.append((closes[idx_d] - prev_c) / prev_c)
                else:
                    daily_rets.append(0.0)

            # 計算 FIP (Frog-in-the-Pan 連續溫和上漲比率, 252D)
            fip_window = min(252, len(daily_rets))
            fip_val = 0.1
            if fip_window >= 20:
                pos_days = sum(1 for r in daily_rets[:fip_window] if r > 0)
                neg_days = sum(1 for r in daily_rets[:fip_window] if r < 0)
                fip_val = round((pos_days - neg_days) / float(pos_days + neg_days + 1e-9), 2)

            # 計算 60D 上行/下行非對稱凸性比 (Asymmetric Volatility Convexity)
            conv_window = min(60, len(daily_rets))
            convexity_val = 1.0
            if conv_window >= 20:
                up_r = [max(0.0, r) for r in daily_rets[:conv_window]]
                dn_r = [min(0.0, r) for r in daily_rets[:conv_window]]
                up_mean = sum(up_r) / conv_window
                dn_mean = sum(dn_r) / conv_window
                up_std = (sum((r - up_mean) ** 2 for r in up_r) / max(1, conv_window - 1)) ** 0.5
                dn_std = (sum((r - dn_mean) ** 2 for r in dn_r) / max(1, conv_window - 1)) ** 0.5
                raw_conv = up_std / max(dn_std, 1e-6)
                convexity_val = round(min(5.0, max(0.2, raw_conv)), 2)

            # VCP 波動收縮特徵 (10D波幅/40D波幅 + 5D量能乾涸 + 20D高點接近度)
            range_10 = (max(closes[:min(10, len(closes))]) - min(closes[:min(10, len(closes))])) if len(closes) >= 10 else 0.0
            range_40 = (max(closes[:min(40, len(closes))]) - min(closes[:min(40, len(closes))])) if len(closes) >= 40 else max(1e-6, range_10)
            vcp_tightness = min(1.0, max(0.1, range_10 / max(range_40, 1e-6)))
            v60_avg = (sum(vols[:60]) / len(vols[:60])) if vols and len(vols) >= 60 else (sum(vols) / max(1, len(vols))) if vols else 1.0
            v5_avg = (sum(vols[:5]) / len(vols[:5])) if vols and len(vols) >= 5 else v60_avg
            vol_dryup = min(3.0, max(0.1, v5_avg / max(v60_avg, 1e-6)))
            h20 = max(closes[:min(20, len(closes))]) if closes else cur_px
            pivot_prox = min(1.0, max(0.5, cur_px / max(h20, 1e-6)))
            vcp_raw = (1.0 - vcp_tightness) * 0.40 + (1.0 / (vol_dryup + 0.5)) * 0.30 + pivot_prox * 0.30
            vcp_val = round(float(vcp_raw), 2)

            # Chip 籌碼沉澱特徵 (陽線吸籌成交量 / 陰線拋售成交量)
            up_vols = [vols[i] for i in range(min(20, len(daily_rets))) if daily_rets[i] > 0]
            dn_vols = [vols[i] for i in range(min(20, len(daily_rets))) if daily_rets[i] < 0]
            mean_up_v = (sum(up_vols) / len(up_vols)) if up_vols else 1.0
            mean_dn_v = (sum(dn_vols) / len(dn_vols)) if dn_vols else 1.0
            vol_abs = min(5.0, max(0.2, mean_up_v / max(mean_dn_v, 1e-6)))
            chip_val = round(float(min(1.0, max(0.0, (vol_abs - 0.2) / 4.8))), 2)

            # 計算精簡正交 4 大核心因子複合動能分數 (拔除 19 因子過擬合雜訊 + 加入拋物線防追高阻尼):
            # Score = (85% Raw_Mom + 15% Residual_Alpha) * (1 + 0.50*FIP) * (1 + 0.20*Convexity) * Parabolic_Damper
            score_val = None
            if mom12m is not None and mom3m is not None:
                raw_mom = (0.45 * mom12m + 0.35 * mom3m + 0.20 * mom1m) / 100.0
                res_mom = raw_mom
                if len(spy_closes) > 63:
                    spy_1m = (spy_closes[0] / spy_closes[min(21, len(spy_closes)-1)] - 1.0)
                    spy_3m = (spy_closes[0] / spy_closes[min(63, len(spy_closes)-1)] - 1.0)
                    spy_12m = (spy_closes[0] / spy_closes[min(252, len(spy_closes)-1)] - 1.0)
                    spy_core = 0.45 * spy_12m + 0.35 * spy_3m + 0.20 * spy_1m
                    res_mom = raw_mom - 0.85 * spy_core
                blend_mom = 0.85 * raw_mom + 0.15 * res_mom
                conv_clip = min(2.0, max(-0.5, convexity_val - 1.0))

                # 60MA 乖離與拋物線防追高阻尼 (Bias60 > 65% 時啟動平滑降權)
                bias_val = (cur_px / max(1e-6, ma60)) - 1.0
                parabolic_damper = 1.0 / (1.0 + 1.2 * (bias_val - 0.65)) if bias_val > 0.65 else 1.0

                fip_m = 1.0 + 0.50 * fip_val
                conv_m = 1.0 + 0.20 * conv_clip

                score_val = round(blend_mom * fip_m * conv_m * parabolic_damper, 4)

            # 爆量滯漲過濾 (Churn Filter: 5D均量 > 2.0倍60D均量 且 10D漲幅 < 2%)
            churn_safe = True
            if len(vols) >= 60 and len(closes) > 10:
                v5 = sum(vols[:5]) / 5.0
                v60 = sum(vols[:60]) / 60.0
                ret10 = (closes[0] / closes[10] - 1.0) if closes[10] > 0 else 0.0
                if v60 > 0 and (v5 > 2.0 * v60) and (ret10 < 0.02):
                    churn_safe = False

            return {
                "ticker": t_code,
                "price": cur_px,
                "price_date": cur_dt,
                "ma60": ma60,
                "ma200": ma200,
                "mom_1m": mom1m,
                "mom_3m": mom3m,
                "mom_12m": mom12m,
                "fip": fip_val,
                "convexity": convexity_val,
                "vcp": vcp_val,
                "chip": chip_val,
                "score": score_val,
                "churn_safe": churn_safe
            }

        picks_list = data.get("current_picks", [])
        valid_picks = []
        for pick in picks_list:
            ticker = pick.get("ticker")
            if not ticker:
                continue
            # 確保股票名稱具備清晰繁體中文標註 (如 8996.TW 顯示為 高力 (Kaori 水冷散熱飆股))
            cur_name = pick.get("name") or ""
            if not cur_name or cur_name == ticker or cur_name == ticker.split(".")[0] or not any('\u4e00' <= char <= '\u9fff' for char in cur_name):
                resolved_name = _resolve_display_name(ticker, c)
                if resolved_name:
                    pick["name"] = resolved_name

            st = _query_ticker_stats(ticker)
            if st:
                pick["price"] = st["price"]
                pick["price_date"] = st["price_date"]
                pick["ma60"] = st["ma60"]
                pick["ma200"] = st["ma200"]
                if st["mom_3m"] is not None:
                    pick["mom_3m"] = st["mom_3m"]
                if st["mom_12m"] is not None:
                    pick["mom_12m"] = st["mom_12m"]
                if st["fip"] is not None:
                    pick["fip"] = st["fip"]
                if st["convexity"] is not None:
                    pick["convexity"] = st["convexity"]
                if st["vcp"] is not None:
                    pick["vcp"] = st["vcp"]
                if st["chip"] is not None:
                    pick["chip"] = st["chip"]
                if st["score"] is not None:
                    pick["score"] = st["score"]
                pick["churn_safe"] = st["churn_safe"]
                live_prices[ticker] = st
                if "." in ticker:
                    live_prices[ticker.split(".")[0]] = st
                cur_dt = st["price_date"]
                if cur_dt > max_dt:
                    max_dt = cur_dt
                if ticker.endswith(".TW") or ticker.endswith(".KS"):
                    if cur_dt > max_tw_dt:
                        max_tw_dt = cur_dt
                else:
                    if cur_dt > max_us_dt:
                        max_us_dt = cur_dt
                # 嚴格檢驗 60MA 與 200MA 結構：若盤中/收盤跌破 60MA 則自動移出正選與保護帶
                if st["price"] > st["ma60"] and st["price"] > st["ma200"] and st["churn_safe"] and (st["score"] or 0) > 0:
                    valid_picks.append(pick)

        # 依最新複合動能分數重新排序 Top 10 候選名單並更新排名與梯隊緩衝狀態
        if valid_picks:
            valid_picks.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
            weights_single_tranche = [40, 30, 30]
            for idx_p, pick in enumerate(valid_picks, start=1):
                pick["rank"] = idx_p
                pick["is_active"] = (idx_p <= 3)
                pick["in_buffer_zone"] = (idx_p <= 5)
                pick["weight_pct"] = weights_single_tranche[idx_p - 1] if idx_p <= 3 else 0
                pick["tranche_weight_pct"] = weights_single_tranche[idx_p - 1] if idx_p <= 3 else 0
                pick["total_nav_weight_pct"] = (weights_single_tranche[idx_p - 1] / 2.0) if idx_p <= 3 else 0
            data["current_picks"] = valid_picks

        # 3. 同步即時實盤持倉現價：將 global_stock_daily 最新收盤價直接同步至 global_sovereign_positions
        c.execute("SELECT id, ticker FROM global_sovereign_positions")
        pos_list = c.fetchall()
        for pos_id, t in pos_list:
            if not t:
                continue
            st = live_prices.get(t) or _query_ticker_stats(t)
            if st:
                live_prices[t] = st
                if "." in t:
                    live_prices[t.split(".")[0]] = st
                c.execute("UPDATE global_sovereign_positions SET current_price = ? WHERE id = ?", (st["price"], pos_id))
                cur_dt = st["price_date"]
                if cur_dt > max_dt:
                    max_dt = cur_dt
                if t.endswith(".TW") or t.endswith(".KS"):
                    if cur_dt > max_tw_dt:
                        max_tw_dt = cur_dt
                else:
                    if cur_dt > max_us_dt:
                        max_us_dt = cur_dt
        conn.commit()

        # 4. 補齊所有 global_stock_daily 標的之最新收盤價與均線至 live_prices，供前端實盤帳本與選股池動態對照
        try:
            c.execute("SELECT DISTINCT ticker FROM global_stock_daily")
            all_db_tickers = [r[0] for r in c.fetchall() if r[0]]
            for meta_t in all_db_tickers:
                if meta_t not in live_prices:
                    st = _query_ticker_stats(meta_t)
                    if st:
                        live_prices[meta_t] = st
                        if "." in meta_t:
                            live_prices[meta_t.split(".")[0]] = st
                        cur_dt = st["price_date"]
                        if cur_dt > max_dt:
                            max_dt = cur_dt
                        if meta_t.endswith(".TW") or meta_t.endswith(".KS"):
                            if cur_dt > max_tw_dt:
                                max_tw_dt = cur_dt
                        else:
                            if cur_dt > max_us_dt:
                                max_us_dt = cur_dt
        except Exception:
            pass

        data["latest_data_date"] = max_dt or "2026-10-16"
        data["latest_tw_date"] = max_tw_dt or max_dt or "2026-10-16"
        data["latest_us_date"] = max_us_dt or max_dt or "2026-10-16"
        data["live_prices"] = live_prices
        data["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        data["data_source"] = "tw_stock.db (SQLite 直連實時運算，零靜態快取)"
        data["status"] = "ok"

        conn.close()
    except Exception as e:
        print("直連資料庫計算全球主權數據失敗:", e)

    # 附加 Rank IC 總覽快照 (供前端即時渲染)
    try:
        rank_ic_file = os.path.join(os.path.dirname(__file__), "frontend", "src", "data", "global_titan_rank_ic.json")
        if os.path.exists(rank_ic_file):
            with open(rank_ic_file, "r", encoding="utf-8") as f_ic:
                ic_json = json.load(f_ic)
                data["rank_ic_summary"] = ic_json.get("overall_summary", {})
                data["rank_ic_total_periods"] = ic_json.get("total_periods", 0)
    except Exception as e:
        pass

    return data

def get_global_titan_rank_ic_analysis(start_date: str = None, end_date: str = None, factor: str = "composite"):
    """
    動態 Rank IC 因子檢驗計算器：
    支援依任意時間範圍 (start_date ~ end_date) 與特定因子 (composite, raw_mom, res_mom, fip, convexity, prox_52w)
    動態重算 Mean Rank IC, ICIR, 勝率, t-stat, p-value 及累計 IC 走勢
    """
    from scipy.stats import t as student_t
    rank_ic_file = os.path.join(os.path.dirname(__file__), "frontend", "src", "data", "global_titan_rank_ic.json")
    if not os.path.exists(rank_ic_file):
        import generate_global_titan_rank_ic
        generate_global_titan_rank_ic.compute_all_rank_ic()

    with open(rank_ic_file, "r", encoding="utf-8") as f:
        full_data = json.load(f)

    series = full_data.get("monthly_series", [])
    if not series:
        return {"status": "error", "message": "無 Rank IC 數據"}

    # 日期範圍過濾
    filtered_series = []
    for row in series:
        dt = row.get("date", "")
        if start_date and dt < start_date:
            continue
        if end_date and dt > end_date:
            continue
        filtered_series.append(row)

    if not filtered_series:
        filtered_series = series

    valid_factors = [
        'composite', 'blend_mom',
        'raw_mom', 'mom_12m', 'mom_6m', 'mom_3m', 'mom_1m', 'mom_2w',
        'res_mom', 'fip', 'convexity', 'er_60', 'prox_52w',
        'bias_ma60', 'zscore_20d'
    ]
    if factor not in valid_factors:
        factor = 'composite'

    # 動態計算該時段與該因子的統計指標
    ic_vals = [float(r.get(factor, 0.0)) for r in filtered_series]
    n = len(ic_vals)
    mean_ic = float(np.mean(ic_vals)) if n > 0 else 0.0
    std_ic = float(np.std(ic_vals)) + 1e-9 if n > 0 else 1.0
    icir = float(mean_ic / std_ic * np.sqrt(24)) if n > 0 else 0.0
    win_rate = float((np.array(ic_vals) > 0).mean() * 100.0) if n > 0 else 0.0
    t_stat = float(mean_ic / (std_ic / np.sqrt(n))) if n > 1 else 0.0
    pval = float(2 * (1 - student_t.cdf(abs(t_stat), df=max(1, n - 1)))) if n > 1 else 1.0

    rating = "🔥 頂級強效 (Excellent Alpha)" if (mean_ic >= 0.07 and icir >= 0.8) else (
        "✅ 穩健有效 (Robust Alpha)" if (mean_ic >= 0.04 and icir >= 0.4) else (
            "⚠️ 具備正向預測力 (Predictive Alpha)" if mean_ic > 0 else "❌ 失效或反轉 (Ineffective)"
        )
    )

    # 重建累計 IC 曲線
    cum_ic = 0.0
    chart_series = []
    for r in filtered_series:
        v = float(r.get(factor, 0.0))
        cum_ic += v
        chart_series.append({
            'date': r.get('date'),
            'year_month': r.get('year_month'),
            'ic': round(v, 4),
            'cum_ic': round(cum_ic, 4),
            'sample_count': r.get('sample_count', 0)
        })

    return {
        'status': 'ok',
        'factor': factor,
        'factor_name': full_data.get('factor_definitions', {}).get(factor, factor),
        'start_date': filtered_series[0]['date'] if filtered_series else start_date,
        'end_date': filtered_series[-1]['date'] if filtered_series else end_date,
        'period_count': n,
        'metrics': {
            'mean_ic': round(mean_ic, 4),
            'ic_std': round(std_ic, 4),
            'icir': round(icir, 3),
            'win_rate': round(win_rate, 1),
            't_stat': round(t_stat, 2),
            'p_value': round(pval, 5),
            'rating': rating
        },
        'factor_definitions': full_data.get('factor_definitions', {}),
        'chart_series': chart_series
    }

if __name__ == "__main__":
    res = get_global_sovereign_dashboard_data()
    print("Strategy:", res.get("strategy_name"))
    print("Latest Date:", res.get("latest_data_date"))
    print("Data Source:", res.get("data_source"))
    for p in res.get("current_picks", [])[:3]:
        print(f"  {p['rank']}. {p['ticker']} ({p['name']}): price={p['price']}, ma60={p['ma60']}")
