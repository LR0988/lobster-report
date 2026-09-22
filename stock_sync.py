#!/usr/bin/env python3
"""
Lobster Report - 雲地同步工具模組 (stock_sync.py)
負責將本機 4.9GB tw_stock.db 與 11 種 ML 模型推論 JSON 快取同步至 Supabase 雲端
"""

import os
import sys
import glob
import json
import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
LOCAL_STOCK_DB = os.path.join(LOCAL_DIR, "tw_stock.db")
DATABASE_URL = os.getenv("DATABASE_URL")

def get_supabase_conn():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL 環境變數未設定")
    return psycopg2.connect(DATABASE_URL, sslmode="require")

def get_sqlite_conn():
    if not os.path.exists(LOCAL_STOCK_DB):
        raise FileNotFoundError(f"找不到本地台股資料庫: {LOCAL_STOCK_DB}")
    conn = sqlite3.connect(LOCAL_STOCK_DB)
    conn.row_factory = sqlite3.Row
    return conn

def sync_ml_cache(sb_conn):
    """同步 11 種機器學習模型預測及低頻量化報告至 Supabase stock_ml_cache"""
    print("[*] 正在同步 ML 模型預測快取至 Supabase...")
    cur = sb_conn.cursor()
    ml_files = glob.glob(os.path.join(LOCAL_DIR, "ml_predictions_*.json"))
    status_all = {}

    for f in ml_files:
        filename = os.path.basename(f)
        model_type = filename.replace("ml_predictions_", "").replace(".json", "")
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            
            status_all[model_type] = {
                "status": "ready",
                "trained_at": data.get("trained_at", ""),
                "latest_date": data.get("latest_date", ""),
                "metrics": data.get("metrics", {}),
                "count": data.get("count", len(data.get("data", [])))
            }

            cur.execute("""
                INSERT INTO stock_ml_cache (model_type, payload, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (model_type) DO UPDATE
                SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
            """, (model_type, json.dumps(data)))
            print(f"  ✓ ML 模型: {model_type} ({len(data.get('data', []))} 筆推薦)")
        except Exception as e:
            print(f"  ✗ 同步模型 {model_type} 失敗: {e}")

    # 上傳 status_all 匯總狀態
    cur.execute("""
        INSERT INTO stock_ml_cache (model_type, payload, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (model_type) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
    """, ("status_all", json.dumps(status_all)))
    print("  ✓ 匯總模型狀態 status_all 同步完成")

    # 上傳 low_freq_result.json 低頻量化資料
    low_freq_path = os.path.join(LOCAL_DIR, "low_freq_result.json")
    if os.path.exists(low_freq_path):
        try:
            with open(low_freq_path, "r", encoding="utf-8") as fp:
                lf_data = json.load(fp)
            cur.execute("""
                INSERT INTO stock_ml_cache (model_type, payload, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (model_type) DO UPDATE
                SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
            """, ("low_freq", json.dumps(lf_data)))
            print("  ✓ 低頻量化回測結果同步完成")
        except Exception as e:
            print(f"  ✗ 低頻量化同步失敗: {e}")

    sb_conn.commit()

def sync_portfolio(sb_conn, local_conn):
    """同步持股清單與最新價格、燈號、分析報告"""
    print("[*] 正在同步持股 (Portfolio) 資料...")
    local_cur = local_conn.cursor()
    sb_cur = sb_conn.cursor()

    local_cur.execute("""
        SELECT 
            p.stock_id, 
            p.stock_name, 
            p.buy_price, 
            p.notes,
            p.auto_analyze,
            (SELECT closing_price FROM daily_stock d WHERE d.stock_id = p.stock_id AND d.closing_price IS NOT NULL ORDER BY d.date DESC LIMIT 1) as latest_price,
            (SELECT date FROM daily_stock d WHERE d.stock_id = p.stock_id AND d.closing_price IS NOT NULL ORDER BY d.date DESC LIMIT 1) as latest_date,
            (SELECT stock_name FROM daily_stock d WHERE d.stock_id = p.stock_id ORDER BY d.date DESC LIMIT 1) as official_name,
            (SELECT h.signal FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as latest_signal,
            (SELECT h.date FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as latest_analysis_date,
            (SELECT h.sentiment_score FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as sentiment_score,
            (SELECT h.sentiment_direction FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as sentiment_direction,
            (SELECT h.has_rumor FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as has_rumor,
            (SELECT h.analysis_text FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as analysis_report
        FROM portfolio p
    """)
    rows = local_cur.fetchall()
    for r in rows:
        name = r["stock_name"] or r["official_name"] or "未知股"
        sb_cur.execute("""
            INSERT INTO stock_portfolio (
                stock_id, stock_name, buy_price, notes, auto_analyze,
                latest_price, latest_date, latest_signal, latest_analysis_date,
                sentiment_score, sentiment_direction, has_rumor, analysis_report, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (stock_id) DO UPDATE SET
                stock_name = EXCLUDED.stock_name,
                buy_price = EXCLUDED.buy_price,
                notes = EXCLUDED.notes,
                auto_analyze = EXCLUDED.auto_analyze,
                latest_price = EXCLUDED.latest_price,
                latest_date = EXCLUDED.latest_date,
                latest_signal = EXCLUDED.latest_signal,
                latest_analysis_date = EXCLUDED.latest_analysis_date,
                sentiment_score = EXCLUDED.sentiment_score,
                sentiment_direction = EXCLUDED.sentiment_direction,
                has_rumor = EXCLUDED.has_rumor,
                analysis_report = EXCLUDED.analysis_report,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            r["stock_id"], name, r["buy_price"], r["notes"], r["auto_analyze"],
            r["latest_price"], r["latest_date"], r["latest_signal"], r["latest_analysis_date"],
            r["sentiment_score"], r["sentiment_direction"], r["has_rumor"], r["analysis_report"]
        ))
    sb_conn.commit()
    print(f"  ✓ 成功同步 {len(rows)} 檔持股明細")

def sync_watchlist(sb_conn, local_conn):
    """同步自選追蹤清單與 MA5/20/60"""
    print("[*] 正在同步自選追蹤清單 (Watchlist)...")
    local_cur = local_conn.cursor()
    sb_cur = sb_conn.cursor()

    local_cur.execute("SELECT * FROM watchlist")
    rows = local_cur.fetchall()
    for w in rows:
        stock_id = w["stock_id"]
        local_cur.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL ORDER BY date DESC LIMIT 1", (stock_id,))
        name_r = local_cur.fetchone()
        official_name = name_r["stock_name"] if name_r else "未知股"
        name = w["stock_name"] or official_name

        local_cur.execute("SELECT closing_price, date FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 60", (stock_id,))
        prices = local_cur.fetchall()
        latest_price, latest_date, ma5, ma20, ma60 = None, None, None, None, None
        if prices:
            latest_price = prices[0]["closing_price"]
            latest_date = prices[0]["date"]
            n = len(prices)
            ma5 = round(sum(p["closing_price"] for p in prices[:5]) / 5.0, 2) if n >= 5 else None
            ma20 = round(sum(p["closing_price"] for p in prices[:20]) / 20.0, 2) if n >= 20 else None
            ma60 = round(sum(p["closing_price"] for p in prices[:60]) / 60.0, 2) if n >= 60 else None

        sb_cur.execute("""
            INSERT INTO stock_watchlist (
                stock_id, stock_name, target_price_high, target_price_low,
                compare_ma5, compare_ma20, compare_ma60, latest_price, latest_date,
                ma5, ma20, ma60, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (stock_id) DO UPDATE SET
                stock_name = EXCLUDED.stock_name,
                target_price_high = EXCLUDED.target_price_high,
                target_price_low = EXCLUDED.target_price_low,
                compare_ma5 = EXCLUDED.compare_ma5,
                compare_ma20 = EXCLUDED.compare_ma20,
                compare_ma60 = EXCLUDED.compare_ma60,
                latest_price = EXCLUDED.latest_price,
                latest_date = EXCLUDED.latest_date,
                ma5 = EXCLUDED.ma5,
                ma20 = EXCLUDED.ma20,
                ma60 = EXCLUDED.ma60,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            stock_id, name, w["target_price_high"], w["target_price_low"],
            w["compare_ma5"], w["compare_ma20"], w["compare_ma60"],
            latest_price, latest_date, ma5, ma20, ma60
        ))
    sb_conn.commit()
    print(f"  ✓ 成功同步 {len(rows)} 檔自選股")

def sync_settings(sb_conn, local_conn):
    """同步系統設定與回測參數"""
    print("[*] 正在同步系統與回測設定...")
    local_cur = local_conn.cursor()
    sb_cur = sb_conn.cursor()

    local_cur.execute("SELECT key, value FROM settings")
    rows = local_cur.fetchall()
    for s in rows:
        sb_cur.execute("""
            INSERT INTO stock_settings (key, value, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
        """, (s["key"], s["value"]))
    sb_conn.commit()
    print(f"  ✓ 成功同步 {len(rows)} 項設定參數")

def sync_database_previews(sb_conn, local_conn):
    """同步五大核心資料庫表格的最新 100 筆快照至 Supabase 供前端瞬時瀏覽"""
    print("[*] 正在同步資料庫檢視快照...")
    local_cur = local_conn.cursor()
    sb_cur = sb_conn.cursor()

    tables = ["daily_stock", "monthly_revenue", "institutional_trades", "institutional_futures", "shareholder_concentration"]
    for t in tables:
        local_cur.execute(f"PRAGMA table_info({t})")
        cols = [col["name"] for col in local_cur.fetchall()]
        order_col = "date" if "date" in cols else "revenue_date" if "revenue_date" in cols else None
        order_clause = f"ORDER BY {order_col} DESC" if order_col else ""
        local_cur.execute(f"SELECT * FROM {t} {order_clause} LIMIT 100")
        data_rows = [dict(r) for r in local_cur.fetchall()]

        sb_cur.execute("""
            INSERT INTO stock_database_preview (table_name, columns, data, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (table_name) DO UPDATE SET
                columns = EXCLUDED.columns,
                data = EXCLUDED.data,
                updated_at = CURRENT_TIMESTAMP;
        """, (t, json.dumps(cols), json.dumps(data_rows)))
        print(f"  ✓ 資料表 {t}: 快照 {len(data_rows)} 筆")
    sb_conn.commit()

def run_full_sync():
    """執行完整一次性全同步"""
    print("=" * 60)
    print("🦞 蝦報 - 本機台股資料與模型同步作業開始")
    print("=" * 60)
    sb_conn = get_supabase_conn()
    local_conn = get_sqlite_conn()

    try:
        sync_ml_cache(sb_conn)
        sync_portfolio(sb_conn, local_conn)
        sync_watchlist(sb_conn, local_conn)
        sync_settings(sb_conn, local_conn)
        sync_database_previews(sb_conn, local_conn)
        print("=" * 60)
        print("✨ 所有資料與模型已成功同步至 Supabase 雲端！")
        print("=" * 60)
    finally:
        local_conn.close()
        sb_conn.close()

if __name__ == "__main__":
    run_full_sync()
