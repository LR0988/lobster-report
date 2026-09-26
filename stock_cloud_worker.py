#!/usr/bin/env python3
"""
Lobster Report - 雲地混合股票選股與運算 Worker (stock_cloud_worker.py)
1. 啟動時自動將本地 ML 模型快取、持股、自選、設定與資料庫預覽同步至 Supabase
2. 即時監聽 Supabase 雲端下發的各項任務：
   - screener: 4.9GB 本地高速選股
   - database_query: 即時查詢本地任意資料庫表
   - ml_train: 執行本機 ML 機器學習模型訓練與推論並同步至雲端
   - ml_backtest: 執行歷史策略滾動回測
   - scraper: 執行每日股價或營收爬蟲
"""

import os
import sys
import time
import json
import sqlite3
import subprocess
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

from stock_sync import (
    run_full_sync,
    sync_ml_cache,
    sync_portfolio,
    sync_watchlist,
    get_supabase_conn,
    get_sqlite_conn,
    LOCAL_STOCK_DB,
    LOCAL_DIR
)

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = os.getenv("DATABASE_URL")

LOCAL_VENV_PYTHON = "/Users/huanggin-chen/gemini-stock-analysis/venv/bin/python"
if not os.path.exists(LOCAL_VENV_PYTHON):
    LOCAL_VENV_PYTHON = sys.executable

if not SUPABASE_URL:
    print("錯誤: 找不到 DATABASE_URL，請確認 .env 已設定 Supabase 連線")
    sys.exit(1)

if not os.path.exists(LOCAL_STOCK_DB):
    print(f"錯誤: 找不到本地台股資料庫: {LOCAL_STOCK_DB}")
    sys.exit(1)

_SCREENER_CACHE = {
    "timestamp": 0,
    "db_mtime": 0,
    "stock_dict": {},
    "inst_dict": {},
    "holder_dict": {},
    "history_dict": {},
}

def get_screener_cached_data():
    """快取 tw_stock.db 最新 65 天交易與指標資料，避免每次篩選重複全表掃描"""
    current_time = time.time()
    db_mtime = os.path.getmtime(LOCAL_STOCK_DB) if os.path.exists(LOCAL_STOCK_DB) else 0

    # 15 分鐘快取效期，且確認資料庫檔案無異動
    if (
        _SCREENER_CACHE["timestamp"] > 0
        and (current_time - _SCREENER_CACHE["timestamp"] < 900)
        and (_SCREENER_CACHE["db_mtime"] == db_mtime)
        and _SCREENER_CACHE["stock_dict"]
    ):
        return (
            _SCREENER_CACHE["stock_dict"],
            _SCREENER_CACHE["inst_dict"],
            _SCREENER_CACHE["holder_dict"],
            _SCREENER_CACHE["history_dict"],
        )

    print("[*] 正在載入本地台股資料庫快取 (最新 65 天指標)...")
    conn = get_sqlite_conn()
    cursor = conn.cursor()

    # 1. 取得最新 65 個交易日
    cursor.execute("SELECT DISTINCT date FROM daily_stock ORDER BY date DESC LIMIT 65")
    recent_dates = [r["date"] for r in cursor.fetchall()]
    min_date = min(recent_dates) if recent_dates else "20000101"

    # 2. 載入這 65 天的價量指標 (過濾掉 6 碼權證)
    cursor.execute("""
        SELECT date, stock_id, stock_name, closing_price, trade_volume, pe_ratio, pb_ratio, yield_ratio, opening_price, highest_price, lowest_price
        FROM daily_stock
        WHERE date >= ? AND closing_price IS NOT NULL
        ORDER BY stock_id ASC, date DESC
    """, (min_date,))
    rows = cursor.fetchall()

    stock_dict = {}
    for r in rows:
        sid = str(r["stock_id"]).strip()
        # 排除 6 碼權證等非現股標的
        if len(sid) > 5 and sid[-1].isdigit():
            continue
        if sid not in stock_dict:
            stock_dict[sid] = {
                "name": r["stock_name"],
                "latest_date": r["date"],
                "latest_close": r["closing_price"],
                "latest_vol": r["trade_volume"],
                "latest_pe": r["pe_ratio"],
                "latest_pb": r["pb_ratio"],
                "latest_yield": r["yield_ratio"],
                "closes": [],
                "vols": [],
                "opens": [],
                "highs": [],
                "lows": []
            }
        if len(stock_dict[sid]["closes"]) < 65:
            stock_dict[sid]["closes"].append(r["closing_price"])
            stock_dict[sid]["vols"].append(r["trade_volume"])
            stock_dict[sid]["opens"].append(r["opening_price"])
            stock_dict[sid]["highs"].append(r["highest_price"])
            stock_dict[sid]["lows"].append(r["lowest_price"])

    # 3. 載入最新 AI 分析歷史
    history_dict = {}
    try:
        cursor.execute("""
            SELECT h.stock_id, h.fpe_2026, h.fpe_2027, h.fpe_2028, h.is_group_fight, h.date
            FROM portfolio_analysis_history h
            INNER JOIN (
                SELECT stock_id, MAX(date) as max_date 
                FROM portfolio_analysis_history 
                GROUP BY stock_id
            ) sub ON h.stock_id = sub.stock_id AND h.date = sub.max_date
        """)
        for h in cursor.fetchall():
            history_dict[str(h["stock_id"]).strip()] = {
                "fpe_2026": h["fpe_2026"],
                "fpe_2027": h["fpe_2027"],
                "fpe_2028": h["fpe_2028"],
                "is_group_fight": h["is_group_fight"],
                "latest_analysis_date": h["date"]
            }
    except Exception as e:
        print(f"[!] 載入 portfolio_analysis_history 略過或異常: {e}")

    # 4. 預讀取三大法人買賣超歷史 (最新 30 個交易日)
    cursor.execute("SELECT DISTINCT date FROM institutional_trades ORDER BY date DESC LIMIT 30")
    inst_dates = [r["date"] for r in cursor.fetchall()]
    min_inst_date = min(inst_dates) if inst_dates else "20000101"
    cursor.execute("""
        SELECT stock_id, date, foreign_net, trust_net, dealer_net 
        FROM institutional_trades 
        WHERE date >= ?
        ORDER BY stock_id ASC, date DESC
    """, (min_inst_date,))
    inst_rows = cursor.fetchall()
    inst_dict = {}
    for r in inst_rows:
        sid = str(r["stock_id"]).strip()
        if sid not in inst_dict:
            inst_dict[sid] = []
        if len(inst_dict[sid]) < 30:
            f_net = r["foreign_net"] or 0
            t_net = r["trust_net"] or 0
            d_net = r["dealer_net"] or 0
            inst_dict[sid].append({
                "foreign_net": f_net,
                "trust_net": t_net,
                "dealer_net": d_net,
                "total_net": f_net + t_net + d_net
            })

    # 5. 預讀取集保大戶持股比例 (1000張以上: level = 15, 最新 2 筆)
    cursor.execute("""
        SELECT TRIM(stock_id) as sid, date, proportion 
        FROM shareholder_concentration 
        WHERE level = 15 
        ORDER BY TRIM(stock_id) ASC, date DESC
    """)
    holder_rows = cursor.fetchall()
    holder_dict = {}
    for r in holder_rows:
        sid = r["sid"]
        if sid not in holder_dict:
            holder_dict[sid] = []
        if len(holder_dict[sid]) < 2:
            holder_dict[sid].append(r["proportion"] or 0.0)

    conn.close()

    _SCREENER_CACHE["timestamp"] = current_time
    _SCREENER_CACHE["db_mtime"] = db_mtime
    _SCREENER_CACHE["stock_dict"] = stock_dict
    _SCREENER_CACHE["inst_dict"] = inst_dict
    _SCREENER_CACHE["holder_dict"] = holder_dict
    _SCREENER_CACHE["history_dict"] = history_dict

    print(f"[+] 資料庫指標快取完成: {len(stock_dict)} 檔現股標的")
    return stock_dict, inst_dict, holder_dict, history_dict

def _calc_consec_days(records, key):
    count = 0
    for rec in records:
        if rec.get(key, 0) > 0:
            count += 1
        else:
            break
    return count

def execute_screener_job(config: dict) -> list:
    """依照雲端傳來的篩選參數，在本地 tw_stock.db 快取指標進行完整多因子量化篩選"""
    stock_dict, inst_dict, holder_dict, history_dict = get_screener_cached_data()

    pe_min = float(config.get("pe_min", 0) or 0)
    pe_max = float(config.get("pe_max", 1000) or 1000)
    pb_min = float(config.get("pb_min", 0) or 0)
    pb_max = float(config.get("pb_max", 100) or 100)
    vol_min = int(config.get("vol_min", 0) or 0)
    vol_max = int(config.get("vol_max", 2000000000) or 2000000000)
    yield_min = float(config.get("yield_min", 0) or 0)
    yield_max = float(config.get("yield_max", 100) or 100)

    price_trend = int(config.get("price_trend", 0) or 0)
    vol_trend = int(config.get("vol_trend", 0) or 0)
    vol_surge = bool(config.get("vol_surge", False))
    vol_surge_mult = float(config.get("vol_surge_mult", 1.0) or 1.0)

    strat1 = bool(config.get("strat1", False))
    strat2 = bool(config.get("strat2", False))

    large_holder_min = float(config.get("large_holder_min", 0) or 0)
    large_holder_max = float(config.get("large_holder_max", 100) or 100)
    large_holder_inc = bool(config.get("large_holder_inc", False))

    foreign_buy_days_min = int(config.get("foreign_buy_days_min", 0) or 0)
    trust_buy_days_min = int(config.get("trust_buy_days_min", 0) or 0)
    inst_buy_days_min = int(config.get("inst_buy_days_min", 0) or 0)

    print(f"[*] 執行專業多因子選股: strat1={strat1}, strat2={strat2}, price_trend={price_trend}, vol_trend={vol_trend}, PE[{pe_min}~{pe_max}], PB[{pb_min}~{pb_max}], Vol[{vol_min}~{vol_max}], LH[{large_holder_min}~{large_holder_max}, inc={large_holder_inc}], Inst[F:{foreign_buy_days_min}, T:{trust_buy_days_min}, All:{inst_buy_days_min}]")

    results = []

    for sid, data in stock_dict.items():
        closes = data["closes"]
        vols = data["vols"]
        opens = data["opens"]
        highs = data["highs"]
        lows = data["lows"]

        if len(closes) < 20:
            continue

        close = data["latest_close"]
        vol = data["latest_vol"]
        pe = data["latest_pe"]
        pb = data["latest_pb"]
        yld = data["latest_yield"]
        open_curr = opens[0]
        high_curr = highs[0]
        low_curr = lows[0]

        # 專業策略判斷 (OR 邏輯：若有勾選，需至少符合一項)
        if strat1 or strat2:
            m1 = False
            m2 = False
            if strat1:
                if len(closes) >= 61 and closes[1] is not None and open_curr is not None:
                    ma60_curr = sum(closes[:60]) / 60
                    ma60_prev = sum(closes[1:61]) / 60
                    v_ma5_prev = sum(vols[1:6]) / 5 if len(vols) >= 6 else (sum(vols[:5]) / 5)
                    cond_a = (close > ma60_curr) and (closes[1] <= ma60_prev)
                    cond_b = (close > open_curr * 1.02)
                    cond_c = (vol > v_ma5_prev * 2)
                    change = (close / closes[1]) if closes[1] != 0 else 1
                    cond_d = (1.035 < change < 1.099)
                    if cond_a and cond_b and cond_c and cond_d:
                        m1 = True

            if strat2:
                if len(closes) >= 21 and highs[0] is not None and lows[0] is not None and closes[1] is not None:
                    ma5_c = sum(closes[:5]) / 5
                    ma10_c = sum(closes[:10]) / 10
                    ma20_c = sum(closes[:20]) / 20
                    ma20_prev = sum(closes[1:21]) / 20
                    ma20_v = sum(vols[:20]) / 20
                    v_min5 = min(vols[:5])
                    cond_a = (ma5_c > ma10_c > ma20_c)
                    cond_b = (ma20_c > ma20_prev)
                    cond_c = (close > ma20_c)
                    cond_d = (vol < ma20_v * 0.5) and (vol == v_min5)
                    cond_e = (high_curr - low_curr < closes[1] * 0.035)
                    if cond_a and cond_b and cond_c and cond_d and cond_e:
                        m2 = True

            if not (m1 or m2):
                continue

        # 成交量激增 (近5日均量 > 前20日均量 * 倍數)
        if vol_surge:
            if len(vols) < 25:
                continue
            avg_v_5 = sum(vols[:5]) / 5
            avg_v_20_prev = sum(vols[5:25]) / 20
            if avg_v_5 <= (avg_v_20_prev * vol_surge_mult):
                continue

        # 基本面與量能過濾
        if vol is None or not (vol_min <= vol <= vol_max):
            continue
        if pe is not None and not (pe_min <= pe <= pe_max):
            continue
        if pb is not None and not (pb_min <= pb <= pb_max):
            continue
        if yld is not None and not (yield_min <= yld <= yield_max):
            continue

        # 價格均線趨勢
        ma5_c = sum(closes[:5]) / 5
        ma20_c = sum(closes[:20]) / 20
        if price_trend == 1 and close <= ma5_c:
            continue
        if price_trend == 2 and close <= ma20_c:
            continue
        if price_trend == 3 and (ma5_c <= ma20_c):
            continue

        # 成交量均線趨勢
        ma5_v = sum(vols[:5]) / 5
        ma20_v = sum(vols[:20]) / 20
        if vol_trend == 1 and vol <= ma5_v:
            continue
        if vol_trend == 2 and vol <= ma20_v:
            continue
        if vol_trend == 3 and (ma5_v <= ma20_v):
            continue

        # 籌碼與三大法人連續買超計算
        inst_records = inst_dict.get(sid, [])
        foreign_buy_days = _calc_consec_days(inst_records, "foreign_net")
        trust_buy_days = _calc_consec_days(inst_records, "trust_net")
        inst_buy_days = _calc_consec_days(inst_records, "total_net")

        # 集保大戶持股
        holder_ratios = holder_dict.get(sid, [])
        latest_holder_ratio = holder_ratios[0] if len(holder_ratios) > 0 else None
        prev_holder_ratio = holder_ratios[1] if len(holder_ratios) > 1 else None
        holder_change = round(latest_holder_ratio - prev_holder_ratio, 2) if (latest_holder_ratio is not None and prev_holder_ratio is not None) else 0.0

        if large_holder_min > 0 or large_holder_max < 100:
            if latest_holder_ratio is None or not (large_holder_min <= latest_holder_ratio <= large_holder_max):
                continue

        if large_holder_inc:
            if latest_holder_ratio is None or prev_holder_ratio is None or latest_holder_ratio <= prev_holder_ratio:
                continue

        if foreign_buy_days_min > 0 and foreign_buy_days < foreign_buy_days_min:
            continue
        if trust_buy_days_min > 0 and trust_buy_days < trust_buy_days_min:
            continue
        if inst_buy_days_min > 0 and inst_buy_days < inst_buy_days_min:
            continue

        # 估值與成長歷史
        h_data = history_dict.get(sid, {})
        fpe26 = h_data.get("fpe_2026")
        fpe27 = h_data.get("fpe_2027")
        fpe28 = h_data.get("fpe_2028")
        is_gf = h_data.get("is_group_fight")
        peg27 = "N/A"
        if fpe26 is not None and fpe27 is not None and fpe27 > 0:
            try:
                growth = (fpe26 / fpe27) - 1
                if growth > 0:
                    peg27 = round(fpe27 / (growth * 100), 2)
            except Exception:
                pass

        # 格式化日期為 YYYY-MM-DD
        d_str = str(data["latest_date"])
        if len(d_str) == 8 and d_str.isdigit():
            d_formatted = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:]}"
        else:
            d_formatted = d_str

        results.append({
            "date": d_formatted,
            "stock_id": sid,
            "stock_name": data["name"],
            "closing_price": close,
            "trade_volume": vol,
            "pe_ratio": pe if pe is not None else "N/A",
            "pb_ratio": pb if pb is not None else "N/A",
            "yield_ratio": yld if yld is not None else 0,
            "large_holder_ratio": round(latest_holder_ratio, 2) if latest_holder_ratio is not None else "N/A",
            "large_holder_change": holder_change,
            "foreign_buy_days": foreign_buy_days,
            "trust_buy_days": trust_buy_days,
            "inst_buy_days": inst_buy_days,
            "2026_FPE": fpe26 if fpe26 is not None else "N/A",
            "2027_FPE": fpe27 if fpe27 is not None else "N/A",
            "2028_FPE": fpe28 if fpe28 is not None else "N/A",
            "2027_PEG": peg27,
            "是否是打群架": is_gf or "否"
        })

    # 排序：依成交量由大到小排序，取前 50 名
    results.sort(key=lambda x: x["trade_volume"] if isinstance(x["trade_volume"], (int, float)) else 0, reverse=True)
    top_results = results[:50]
    print(f"[+] 本地篩選完成，命中 {len(results)} 檔（回傳前 {len(top_results)} 檔）！")
    return top_results

def execute_database_query(config: dict) -> dict:
    """即時查詢本地 SQLite 任意表格"""
    table_name = config.get("table_name", "daily_stock")
    limit = int(config.get("limit", 200))

    valid_tables = [
        "daily_stock", "monthly_revenue", "institutional_trades", 
        "institutional_futures", "shareholder_concentration"
    ]
    if table_name not in valid_tables:
        raise ValueError(f"不合法的資料表名稱: {table_name}")

    conn = get_sqlite_conn()
    cursor = conn.cursor()

    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [col["name"] for col in cursor.fetchall()]

    order_col = "date" if "date" in columns else "revenue_date" if "revenue_date" in columns else None
    order_clause = f"ORDER BY {order_col} DESC" if order_col else ""
    cursor.execute(f"SELECT * FROM {table_name} {order_clause} LIMIT {limit}")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return {"columns": columns, "data": rows}

def execute_ml_train_job(config: dict) -> dict:
    """執行本機 ML 機器學習模型訓練並在完成後自動同步快取至 Supabase"""
    model_type = config.get("model_type", "lightgbm")
    train_ratio = float(config.get("train_ratio", 0.8))
    train_days = int(config.get("train_days", 180))
    test_days = int(config.get("test_days", 30))
    force_retrain = bool(config.get("force_retrain", False))
    min_capital_billion = config.get("min_capital_billion")
    if min_capital_billion is not None:
        min_capital_billion = float(min_capital_billion)
    exclude_6digit = bool(config.get("exclude_6digit", True))

    print(f"[*] 🚀 開始本機訓練 ML 模型: {model_type.upper()} (天數: {train_days} / 比例: {train_ratio})")

    # 更新 Supabase status_all 為 training
    try:
        sb_conn = get_supabase_conn()
        cur = sb_conn.cursor()
        cur.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'status_all';")
        row = cur.fetchone()
        status_map = row[0] if row else {}
        status_map[model_type] = {
            "status": "training",
            "message": "正在本機背景訓練中..."
        }
        cur.execute("""
            INSERT INTO stock_ml_cache (model_type, payload, updated_at)
            VALUES ('status_all', %s, CURRENT_TIMESTAMP)
            ON CONFLICT (model_type) DO UPDATE
            SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
        """, (json.dumps(status_map),))
        sb_conn.commit()
        sb_conn.close()
    except Exception as e:
        print(f"[!] 更新 training 狀態至 Supabase 異常: {e}")

    # 使用本地 venv Python 執行訓練與推論
    train_code = f"""
import sys
sys.path.insert(0, '/Users/huanggin-chen/gemini-stock-analysis')
import ml_engine

res = ml_engine.train_model(
    {repr(model_type)},
    train_ratio={train_ratio},
    train_days={train_days},
    test_days={test_days},
    force_retrain={force_retrain},
    min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'},
    exclude_6digit={exclude_6digit}
)
print('Train result:', res)
if res.get('status') == 'ok':
    ml_engine.predict_top_stocks(
        top_n=30,
        model_type={repr(model_type)},
        force=True,
        min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'},
        exclude_6digit={exclude_6digit}
    )
    print('Prediction complete')
"""
    env = os.environ.copy()
    env["OMP_NUM_THREADS"] = "1"
    env["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.run(
        [LOCAL_VENV_PYTHON, "-c", train_code],
        cwd=LOCAL_DIR,
        capture_output=True,
        text=True,
        env=env
    )

    if proc.returncode != 0:
        err_msg = proc.stderr[:1000] if proc.stderr else proc.stdout[:1000]
        print(f"[x] 模型訓練異常結束: {err_msg}")
        raise RuntimeError(f"訓練失敗: {err_msg}")

    print(f"[✓] 模型 {model_type.upper()} 訓練完成！正在同步推論結果至 Supabase...")
    sb_conn = get_supabase_conn()
    sync_ml_cache(sb_conn)
    sb_conn.close()

    return {"status": "ok", "message": f"{model_type.upper()} 模型訓練完成並已同步至雲端快取！"}

def execute_ml_backtest_job(config: dict) -> dict:
    """執行本機 ML 策略歷史回測並回傳績效指標"""
    model_type = config.get("model_type", "lightgbm")
    min_win_prob = float(config.get("min_win_prob", 50.0))
    max_drop_prob = float(config.get("max_drop_prob", 30.0))
    stop_profit_pct = float(config.get("stop_profit_pct", 20.0))
    stop_loss_pct = float(config.get("stop_loss_pct", 7.0))
    max_holding_days = int(config.get("max_holding_days", 30))
    max_portfolio_size = int(config.get("max_portfolio_size", 5))
    train_ratio = float(config.get("train_ratio", 0.85))
    train_days = int(config.get("train_days", 300))
    test_days = int(config.get("test_days", 60))
    exit_strategy = config.get("exit_strategy", "fixed")
    trailing_activation_pct = float(config.get("trailing_activation_pct", 10.0))
    min_capital_billion = config.get("min_capital_billion")
    if min_capital_billion is not None:
        min_capital_billion = float(min_capital_billion)
    exclude_6digit = bool(config.get("exclude_6digit", True))
    market_bull_filter = bool(config.get("market_bull_filter", True))

    print(f"[*] 執行策略回測: 模型={model_type}, 停利={stop_profit_pct}%, 停損={stop_loss_pct}%")

    backtest_code = f"""
import sys, json
sys.path.insert(0, '/Users/huanggin-chen/gemini-stock-analysis')
import backtest_engine

res = backtest_engine.run_backtest(
    model_type={repr(model_type)},
    min_win_prob={min_win_prob},
    max_drop_prob={max_drop_prob},
    stop_profit_pct={stop_profit_pct},
    stop_loss_pct={stop_loss_pct},
    max_holding_days={max_holding_days},
    max_portfolio_size={max_portfolio_size},
    train_ratio={train_ratio},
    train_days={train_days},
    test_days={test_days},
    exit_strategy={repr(exit_strategy)},
    trailing_activation_pct={trailing_activation_pct},
    min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'},
    exclude_6digit={exclude_6digit},
    market_bull_filter={market_bull_filter}
)
print('__RESULT__' + json.dumps(res))
"""
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.run(
        [LOCAL_VENV_PYTHON, "-c", backtest_code],
        cwd=LOCAL_DIR,
        capture_output=True,
        text=True,
        env=env
    )

    if proc.returncode != 0:
        err_msg = proc.stderr[:1000] if proc.stderr else proc.stdout[:1000]
        print(f"[x] 回測執行失敗: {err_msg}")
        raise RuntimeError(f"回測失敗: {err_msg}")

    for line in proc.stdout.splitlines():
        if line.startswith("__RESULT__"):
            return json.loads(line[len("__RESULT__"):])

    return {"status": "error", "message": "未取得回測結果"}

def process_pending_jobs():
    """從 Supabase 領取 PENDING 任務並執行"""
    sb_conn = get_supabase_conn()
    cur = sb_conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT id, config, username 
        FROM stock_screener_jobs 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 1 
        FOR UPDATE SKIP LOCKED;
    """)
    job = cur.fetchone()

    if not job:
        sb_conn.close()
        return False

    job_id = job["id"]
    config = job["config"] or {}
    job_type = config.get("job_type", "screener")
    print(f"\n[!] 收到來自雲端的任務 #{job_id} (類型: {job_type}, 發起人: {job['username']})")

    cur.execute("UPDATE stock_screener_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = %s;", (job_id,))
    sb_conn.commit()

    try:
        if job_type == "screener":
            results = execute_screener_job(config)
        elif job_type == "database_query":
            results = execute_database_query(config)
        elif job_type == "ml_train":
            results = execute_ml_train_job(config)
        elif job_type == "ml_backtest":
            results = execute_ml_backtest_job(config)
        else:
            results = execute_screener_job(config)

        cur.execute("""
            UPDATE stock_screener_jobs 
            SET status = 'completed', results = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s;
        """, (json.dumps(results), job_id))
        sb_conn.commit()
        print(f"[✓] 任務 #{job_id} ({job_type}) 結果已成功推播回雲端 Supabase！")
    except Exception as e:
        print(f"[x] 任務 #{job_id} 執行失敗: {e}")
        cur.execute("""
            UPDATE stock_screener_jobs 
            SET status = 'error', error_message = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s;
        """, (str(e), job_id))
        sb_conn.commit()

    sb_conn.close()
    return True

def run_worker_loop():
    print("=" * 60)
    print("🦞 蝦報 - 本機台股運算 Worker 正在初始化...")
    print(f"📦 連線至 Supabase 資料庫")
    print(f"🗄️ 連結本機資料庫: {LOCAL_STOCK_DB}")
    print(f"🐍 Python 執行環境: {LOCAL_VENV_PYTHON}")
    print("=" * 60)

    # 1. 啟動時自動執行全量快取同步
    try:
        run_full_sync()
    except Exception as e:
        print(f"[!] 啟動快取同步失敗 (非致命): {e}")

    print("\n📡 正在即時監聽雲端選股、模型訓練與回測指令... (按 Ctrl+C 可停止)")
    print("=" * 60)

    last_sync_time = time.time()

    while True:
        try:
            handled = process_pending_jobs()
            if not handled:
                time.sleep(2)
            else:
                time.sleep(0.5)

            # 每 10 分鐘自動背景輕量同步一次持股與自選
            if time.time() - last_sync_time > 600:
                last_sync_time = time.time()
                try:
                    s_conn = get_supabase_conn()
                    l_conn = get_sqlite_conn()
                    sync_portfolio(s_conn, l_conn)
                    sync_watchlist(s_conn, l_conn)
                    l_conn.close()
                    s_conn.close()
                except Exception as e:
                    print(f"[!] 背景定時同步異常: {e}")

        except KeyboardInterrupt:
            print("\nWorker 已停止")
            break
        except Exception as e:
            print(f"監聽發生異常 (5秒後重試): {e}")
            time.sleep(5)

if __name__ == "__main__":
    run_worker_loop()
