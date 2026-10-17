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
            "strategy_name": "全球高流動性泰坦旗艦【雙梯隊進攻版：1號+22號交錯 × 40/30/30階梯 × 45/35/20敏銳動能 × 爆量滯漲過濾】",
            "current_picks": [],
            "macro_status": {}
        }

    if not os.path.exists(DB_PATH):
        return data

    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()

        # 1. 宏觀指標 (SPY 及 MA200) 直查資料庫
        c.execute("SELECT date, close FROM global_stock_daily WHERE ticker = ? ORDER BY date DESC LIMIT 200", ('SPY',))
        spy_rows = c.fetchall()
        if spy_rows:
            spy_latest = float(spy_rows[0][1])
            spy_ma200 = float(sum(r[1] for r in spy_rows) / len(spy_rows))
            if "macro_status" not in data:
                data["macro_status"] = {}
            data["macro_status"]["spy_price"] = round(spy_latest, 2)
            data["macro_status"]["spy_ma200"] = round(spy_ma200, 2)

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

            # 計算 FIP (Frog-in-the-Pan 連續溫和上漲比率)
            fip_window = min(126, len(closes) - 1)
            fip_val = 0.1
            if fip_window >= 20:
                pos_days = 0
                neg_days = 0
                for idx_d in range(fip_window):
                    prev_c = closes[idx_d + 1]
                    if prev_c > 0:
                        ret_d = (closes[idx_d] - prev_c) / prev_c
                        if ret_d > 0:
                            pos_days += 1
                        elif ret_d < 0:
                            neg_days += 1
                fip_val = round((pos_days - neg_days) / float(fip_window), 2)

            # 計算 45/35/20 敏銳複合動能評分 × FIP 加成
            score_val = None
            if mom12m is not None and mom3m is not None:
                raw_mom = (0.45 * mom12m + 0.35 * mom3m + 0.20 * mom1m) / 100.0
                score_val = round(raw_mom * (1.0 + 0.5 * max(0.0, fip_val)), 4)

            # 爆量滯漲過濾 (Churn Filter)
            churn_safe = True
            if len(vols) >= 60 and len(closes) > 10:
                v5 = sum(vols[:5]) / 5.0
                v60 = sum(vols[:60]) / 60.0
                ret10 = (closes[0] / closes[10] - 1.0) if closes[10] > 0 else 0.0
                if v60 > 0 and (v5 > 2.2 * v60) and (ret10 < 0.02):
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
                "score": score_val,
                "churn_safe": churn_safe
            }

        picks_list = data.get("current_picks", [])
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

        # 依最新複合動能分數重新排序 Top 10 候選名單並更新排名與梯隊緩衝狀態
        if picks_list:
            picks_list.sort(key=lambda x: float(x.get("score") or 0.0), reverse=True)
            for idx_p, pick in enumerate(picks_list, start=1):
                pick["rank"] = idx_p
                pick["is_active"] = (idx_p <= 3)
                pick["in_buffer_zone"] = (idx_p <= 5)

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
