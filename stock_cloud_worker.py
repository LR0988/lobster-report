#!/usr/bin/env python3
"""
Lobster Report - 雲地混合股票選股 Worker
監聽 Supabase 雲端下發的選股任務，讀取本地 4.9GB tw_stock.db 進行運算並將結果回傳雲端
"""

import os
import sys
import time
import json
import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = os.getenv("DATABASE_URL")
LOCAL_STOCK_DB = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

if not SUPABASE_URL:
    print("錯誤: 找不到 DATABASE_URL，請確認 .env 已設定 Supabase 連線")
    sys.exit(1)

if not os.path.exists(LOCAL_STOCK_DB):
    print(f"錯誤: 找不到本地台股資料庫: {LOCAL_STOCK_DB}")
    sys.exit(1)

def get_supabase_conn():
    return psycopg2.connect(SUPABASE_URL, sslmode="require")

def get_sqlite_conn():
    conn = sqlite3.connect(LOCAL_STOCK_DB)
    conn.row_factory = sqlite3.Row
    return conn

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

    print(f"[*] 執行篩選參數: PE[{pe_min}~{pe_max}] PB[{pb_min}~{pb_max}] Vol[{vol_min}~{vol_max}]")

    conn = get_sqlite_conn()
    cursor = conn.cursor()

    # 取得最新交易日的個股資料
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
    print(f"[+] 本地篩選完成，命中 {len(results)} 檔符合條件的台股個股！")
    return results

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
    config = job["config"]
    print(f"\n[!] 收到來自雲端的選股任務 #{job_id} (發起人: {job['username']})")

    # 更新狀態為 running
    cur.execute("UPDATE stock_screener_jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = %s;", (job_id,))
    sb_conn.commit()

    try:
        results = execute_screener_job(config)
        # 更新結果回 Supabase
        cur.execute("""
            UPDATE stock_screener_jobs 
            SET status = 'completed', results = %s, updated_at = CURRENT_TIMESTAMP 
            WHERE id = %s;
        """, (json.dumps(results), job_id))
        sb_conn.commit()
        print(f"[✓] 任務 #{job_id} 結果已成功推播回雲端 Supabase！")
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
    print("🦞 蝦報 - 本地台股運算 Worker 已啟動")
    print(f"📦 連線至 Supabase 資料庫")
    print(f"🗄️ 連結本機資料庫: {LOCAL_STOCK_DB}")
    print("📡 正在即時監聽雲端選股指令... (按 Ctrl+C 可停止)")
    print("=" * 60)

    while True:
        try:
            handled = process_pending_jobs()
            if not handled:
                time.sleep(2)
            else:
                time.sleep(0.5)
        except KeyboardInterrupt:
            print("\nWorker 已停止")
            break
        except Exception as e:
            print(f"監聽發生異常 (5秒後重試): {e}")
            time.sleep(5)

if __name__ == "__main__":
    run_worker_loop()
