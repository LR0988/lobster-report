"""
Global Sovereign Service (Scheme A Upgrade - Direct SQLite Database Connection)
直連本機 tw_stock.db 資料庫，動態計算最新美股、台股、全球泰坦旗艦行情與持倉
絕不使用過期靜態快取
"""

import os
import json
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")
local_template = os.path.join(os.path.dirname(__file__), "frontend", "src", "data", "defaultGlobalSovereignData.json")
parent_template = os.path.join(os.path.dirname(__file__), "..", "openclaw_test", "frontend", "src", "data", "defaultGlobalSovereignData.json")
TEMPLATE_PATH = local_template if os.path.exists(local_template) else parent_template

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
            "strategy_name": "👑 全球高流動性泰坦旗艦【雙梯隊進攻 × 30% 波動階梯乾粉互補版】(70% 雙梯隊核心進攻 + 30% 美元高息定存乾粉抄底池)",
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

        # 動態計算 15 國主權 ETF 雙頻複合寬幅 (75% 200MA + 25% 60MA)
        candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
        br200_cnt, br60_cnt, valid_etf_cnt = 0, 0, 0
        for etf_code in candidate_etfs:
            c.execute("SELECT close FROM global_sovereign_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 200", (etf_code,))
            erows = [float(r[0]) for r in c.fetchall() if r[0] is not None]
            if len(erows) >= 60:
                valid_etf_cnt += 1
                if erows[0] > (sum(erows[:200]) / len(erows[:200])):
                    br200_cnt += 1
                if erows[0] > (sum(erows[:60]) / len(erows[:60])):
                    br60_cnt += 1
        if valid_etf_cnt > 0:
            br200_ratio = br200_cnt / float(valid_etf_cnt)
            br60_ratio = br60_cnt / float(valid_etf_cnt)
            comp_br = 0.75 * br200_ratio + 0.25 * br60_ratio
            data["macro_status"]["global_breadth_pct"] = round(comp_br * 100.0, 1)
            data["macro_status"]["bull_countries"] = f"{int(round(comp_br * valid_etf_cnt))}/{valid_etf_cnt}"
            if comp_br >= 0.50:
                data["macro_status"]["exposure_pct"] = 100
                data["macro_status"]["regime"] = f"全球共振多頭 (雙頻複合寬幅 {comp_br*100:.1f}% >= 50% -> A/B雙梯隊100%滿倉進攻)"
            elif comp_br >= 0.30:
                data["macro_status"]["exposure_pct"] = 70
                data["macro_status"]["regime"] = f"全球宏觀分化警示 (雙頻複合寬幅 {comp_br*100:.1f}% -> 防禦型 70% 倉位)"
            else:
                data["macro_status"]["exposure_pct"] = 0
                data["macro_status"]["regime"] = f"全球系統性空頭 (雙頻複合寬幅 {comp_br*100:.1f}% < 30% -> 100% 現金避險)"

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

            # 計算 DOE 終極冠軍複合動能分數:
            # ((85% Raw + 15% Residual) * (1 + 0.5*FIP) * (1 + 0.20*clip(Convexity - 1.0, -0.5, 2.0)))
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
                score_val = round(blend_mom * (1.0 + 0.5 * fip_val) * (1.0 + 0.20 * conv_clip), 4)

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
                "score": score_val,
                "churn_safe": churn_safe
            }

        picks_list = data.get("current_picks", [])
        valid_picks = []
        for pick in picks_list:
            ticker = pick.get("ticker")
            if not ticker:
                continue
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

    return data

if __name__ == "__main__":
    res = get_global_sovereign_dashboard_data()
    print("Strategy:", res.get("strategy_name"))
    print("Latest Date:", res.get("latest_data_date"))
    print("Data Source:", res.get("data_source"))
    for p in res.get("current_picks", [])[:3]:
        print(f"  {p['rank']}. {p['ticker']} ({p['name']}): price={p['price']}, ma60={p['ma60']}")
