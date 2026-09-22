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

def execute_screener_job(config: dict) -> list:
    """依照雲端傳來的篩選參數，在本地 4.9GB tw_stock.db 進行高速篩選"""
    pe_min = float(config.get("pe_min", 0) or 0)
    pe_max = float(config.get("pe_max", 9999) or 9999)
    pb_min = float(config.get("pb_min", 0) or 0)
    pb_max = float(config.get("pb_max", 999) or 999)
    vol_min = int(config.get("vol_min", 0) or 0)
    vol_max = int(config.get("vol_max", 9999999999) or 9999999999)
    yield_min = float(config.get("yield_min", 0) or 0)
    yield_max = float(config.get("yield_max", 100) or 100)

    print(f"[*] 執行選股篩選: PE[{pe_min}~{pe_max}] PB[{pb_min}~{pb_max}] Vol[{vol_min}~{vol_max}]")

    conn = get_sqlite_conn()
    cursor = conn.cursor()

    query = """
        SELECT date, stock_id, stock_name, closing_price, trade_volume, pe_ratio, pb_ratio, yield_ratio
        FROM daily_stock
        WHERE date = (SELECT MAX(date) FROM daily_stock)
          AND closing_price IS NOT NULL
          AND pe_ratio >= ? AND pe_ratio <= ?
          AND pb_ratio >= ? AND pb_ratio <= ?
          AND trade_volume >= ? AND trade_volume <= ?
          AND yield_ratio >= ? AND yield_ratio <= ?
        ORDER BY trade_volume DESC
        LIMIT 50
    """
    cursor.execute(query, (pe_min, pe_max, pb_min, pb_max, vol_min, vol_max, yield_min, yield_max))
    rows = cursor.fetchall()

    results = []
    for r in rows:
        results.append({
            "date": r["date"],
            "stock_id": r["stock_id"],
            "stock_name": r["stock_name"],
            "closing_price": r["closing_price"],
            "trade_volume": r["trade_volume"],
            "pe_ratio": r["pe_ratio"],
            "pb_ratio": r["pb_ratio"],
            "yield_ratio": r["yield_ratio"],
        })

    conn.close()
    print(f"[+] 本地篩選完成，命中 {len(results)} 檔符合條件之個股！")
    return results

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
