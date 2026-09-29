#!/usr/bin/env python3
"""
sync_macro_indicators.py
負責自動爬取並同步國際關鍵宏觀指標至 SQLite (tw_stock.db -> macro_indicators)：
1. 美國 10 年期公債殖利率 (^TNX)
2. WTI 紐約輕原油期貨 (CL=F)
3. 美元兌新台幣即期匯率 (USDTWD=X)
4. 費城半導體指數 (^SOX)
5. 美元指數 (DX-Y.NYB)

支援：
- 完整歷史回補 (--backfill: 10 年跨度)
- 每日快速增量更新 (--daily: 近 1 個月)
- 自動向前填充 (Forward-Fill) 處理台美開休市時差
"""

import os
import sys
import json
import sqlite3
import datetime
import subprocess
import requests
import pandas as pd
from typing import Dict, List, Optional, Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
DB_PATH = os.path.join(LOCAL_DIR, "tw_stock.db")
USER_AGENT = "Mozilla/5.0"

MACRO_TICKERS = {
    'us10y': '^TNX',       # 美債 10 年期殖利率 (%)
    'oil_wti': 'CL=F',      # WTI 紐約輕原油 (USD/桶)
    'usdtwd': 'USDTWD=X',  # 美元兌新台幣匯率
    'sox': '^SOX',         # 費城半導體指數
    'dxy': 'DX-Y.NYB'      # 美元指數
}

def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"找不到本地台股資料庫: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_macro_table():
    """初始化 macro_indicators 數據表"""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS macro_indicators (
            date TEXT PRIMARY KEY,
            us10y REAL,
            oil_wti REAL,
            usdtwd REAL,
            sox REAL,
            dxy REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_macro_date ON macro_indicators(date)")
    conn.commit()
    conn.close()

def fetch_yahoo_series(ticker: str, range_param: str = "10y") -> List[Dict[str, Any]]:
    """
    透過 Yahoo Finance Chart API 抓取標的歷史日收盤價
    雙重防禦機制：優先使用 requests，失敗時自動退回 curl
    """
    import urllib.parse
    safe_ticker = urllib.parse.quote(ticker)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{safe_ticker}?range={range_param}&interval=1d"
    headers = {"User-Agent": USER_AGENT}
    
    data = None
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
    except Exception as e:
        print(f"[!] requests 抓取 {ticker} 異常: {e}，切換為 curl 備援...")
        
    if not data or "chart" not in data:
        cmd = ["curl", "-s", url, "-H", f"User-Agent: {USER_AGENT}"]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
            if proc.returncode == 0 and proc.stdout:
                data = json.loads(proc.stdout)
        except Exception as e2:
            print(f"[!] curl 抓取 {ticker} 亦失敗: {e2}")
            return []

    try:
        res = data.get("chart", {}).get("result", [])
        if not res:
            return []
        item = res[0]
        timestamps = item.get("timestamp", [])
        quotes = item.get("indicators", {}).get("quote", [{}])[0]
        closes = quotes.get("close", [])
        
        records = []
        for ts, c in zip(timestamps, closes):
            if c is not None:
                d_str = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d")
                records.append({
                    "date": d_str,
                    "close": round(float(c), 4)
                })
        return records
    except Exception as e:
        print(f"[!] 解析 {ticker} 失敗: {e}")
        return []

def sync_macro_to_sqlite(range_param: str = "1mo") -> int:
    """
    自動同步宏觀指標至 SQLite
    - range_param="1mo": 每日排程增量更新
    - range_param="10y": 初次全量回補 10 年歷史
    """
    init_macro_table()
    print(f"[*] 啟動宏觀跨市場指標同步機制 (範圍: {range_param})...")
    
    series_dfs = {}
    for col, ticker in MACRO_TICKERS.items():
        records = fetch_yahoo_series(ticker, range_param=range_param)
        if records:
            df = pd.DataFrame(records).drop_duplicates("date").set_index("date")
            df = df.rename(columns={"close": col})
            series_dfs[col] = df
            print(f"  ✓ {col:<8s} ({ticker:<10s}): 成功擷取 {len(df):>4d} 筆 (最新: {df.index[-1]} = {df.iloc[-1][col]})")
        else:
            print(f"  [!] {col} ({ticker}) 擷取為空！")

    if not series_dfs:
        print("[!] 無任何指標擷取成功，跳過同步")
        return 0

    # 合併多指標並做前向填充 (ffill 補足跨國休市時差)
    merged_df = pd.concat([series_dfs[col] for col in MACRO_TICKERS.keys() if col in series_dfs], axis=1, join="outer").sort_index()
    merged_df = merged_df.ffill().dropna(how="all")
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    upsert_count = 0
    
    for date_str, row in merged_df.iterrows():
        u10 = row.get("us10y") if pd.notnull(row.get("us10y")) else None
        oil = row.get("oil_wti") if pd.notnull(row.get("oil_wti")) else None
        twd = row.get("usdtwd") if pd.notnull(row.get("usdtwd")) else None
        sox = row.get("sox") if pd.notnull(row.get("sox")) else None
        dxy = row.get("dxy") if pd.notnull(row.get("dxy")) else None
        
        cur.execute("""
            INSERT INTO macro_indicators (date, us10y, oil_wti, usdtwd, sox, dxy, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                us10y = COALESCE(excluded.us10y, macro_indicators.us10y),
                oil_wti = COALESCE(excluded.oil_wti, macro_indicators.oil_wti),
                usdtwd = COALESCE(excluded.usdtwd, macro_indicators.usdtwd),
                sox = COALESCE(excluded.sox, macro_indicators.sox),
                dxy = COALESCE(excluded.dxy, macro_indicators.dxy),
                updated_at = excluded.updated_at
        """, (date_str, u10, oil, twd, sox, dxy, now_str))
        upsert_count += 1
        
    conn.commit()
    conn.close()
    
    print(f"[✓] 宏觀指標同步完成！累計更新寫入 {upsert_count} 筆交易日數據至 SQLite (tw_stock.db -> macro_indicators)。")
    return upsert_count

def check_and_auto_backfill():
    """若資料庫內 macro_indicators 筆數過少，自動觸發 10 年回補"""
    init_macro_table()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM macro_indicators")
    cnt = cur.fetchone()[0]
    conn.close()
    
    if cnt < 500:
        print(f"[*] 檢測到宏觀指標僅有 {cnt} 筆，正在自動執行 10 年歷史回補...")
        sync_macro_to_sqlite(range_param="10y")
    else:
        print(f"[*] 宏觀指標現有 {cnt} 筆，執行每日增量同步...")
        sync_macro_to_sqlite(range_param="1mo")

if __name__ == "__main__":
    if len(sys.argv) > 1 and "--backfill" in sys.argv:
        sync_macro_to_sqlite(range_param="10y")
    else:
        check_and_auto_backfill()
