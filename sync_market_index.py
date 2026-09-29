#!/usr/bin/env python3
"""
sync_market_index.py
負責抓取並同步台股加權指數 (TAIEX / ^TWII) 歷史與每日最新日K數據至 SQLite (tw_stock.db)
"""

import os
import sys
import json
import sqlite3
import datetime
import subprocess
import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
DB_PATH = os.path.join(LOCAL_DIR, "tw_stock.db")

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"找不到本地台股資料庫: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_index_table():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_index (
            date TEXT PRIMARY KEY,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            change_points REAL,
            change_percent REAL,
            volume INTEGER,
            turnover REAL
        )
    """)
    conn.commit()
    conn.close()

def fetch_yahoo_taiex_history(range_param="10y"):
    """
    透過 Yahoo Finance API 抓取加權指數 (^TWII) 歷史日K線 (開、高、低、收)
    使用 curl 確保避開 Python requests 在 macOS 上的潛在 SSL/TLS 阻塞
    """
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?range={range_param}&interval=1d"
    cmd = [
        "curl", "-s",
        url,
        "-H", f"User-Agent: {USER_AGENT}"
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if proc.returncode != 0 or not proc.stdout:
            print(f"[!] 抓取 Yahoo ^TWII 失敗: curl returncode {proc.returncode}")
            return []
        
        data = json.loads(proc.stdout)
        res = data.get("chart", {}).get("result", [])
        if not res:
            print("[!] Yahoo API 回傳無效結構")
            return []
        
        result_item = res[0]
        timestamps = result_item.get("timestamp", [])
        quotes = result_item.get("indicators", {}).get("quote", [{}])[0]
        
        opens = quotes.get("open", [])
        highs = quotes.get("high", [])
        lows = quotes.get("low", [])
        closes = quotes.get("close", [])
        volumes = quotes.get("volume", [])
        
        records = []
        prev_close = None
        for i in range(len(timestamps)):
            ts = timestamps[i]
            c = closes[i] if i < len(closes) else None
            o = opens[i] if i < len(opens) else None
            h = highs[i] if i < len(highs) else None
            l = lows[i] if i < len(lows) else None
            v = volumes[i] if i < len(volumes) else 0
            
            if c is None or o is None or h is None or l is None:
                continue
            
            dt = datetime.datetime.fromtimestamp(ts)
            date_str = dt.strftime("%Y%m%d")
            
            c = round(float(c), 2)
            o = round(float(o), 2)
            h = round(float(h), 2)
            l = round(float(l), 2)
            v = int(v) if v else 0
            
            change_pts = round(c - prev_close, 2) if prev_close else 0.0
            change_pct = round((c / prev_close - 1) * 100, 2) if prev_close else 0.0
            prev_close = c
            
            records.append({
                "date": date_str,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "change_points": change_pts,
                "change_percent": change_pct,
                "volume": v,
                "turnover": 0.0
            })
            
        print(f"[✓] 成功取得 Yahoo ^TWII 歷史日K 共 {len(records)} 筆交易日！")
        return records
    except Exception as e:
        print(f"[!] 抓取 Yahoo ^TWII 發生例外: {e}")
        return []

def fetch_twse_recent_turnover(months=6):
    """
    從證交所 FMTQIK 抓取近幾個月的每日加權指數與真實成交金額 (turnover)
    """
    now = datetime.datetime.now()
    dates = []
    for i in range(months):
        y = now.year
        m = now.month - i
        while m <= 0:
            m += 12
            y -= 1
        dates.append(f"{y}{m:02d}01")
    
    turnover_map = {}
    for d in dates:
        url = f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={d}&response=json"
        cmd = ["curl", "-s", "-A", USER_AGENT, url]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if proc.returncode == 0 and proc.stdout:
                data = json.loads(proc.stdout)
                rows = data.get("data", [])
                for r in rows:
                    # r: ['115/09/29', '9,651,142,036', '824,692,107,481', '4,340,289', '47,631.96', '-392.64']
                    if len(r) >= 3:
                        d_parts = r[0].split("/")
                        if len(d_parts) == 3:
                            year_ad = int(d_parts[0]) + 1911
                            d_str = f"{year_ad}{int(d_parts[1]):02d}{int(d_parts[2]):02d}"
                            vol = int(r[1].replace(",", ""))
                            amt = float(r[2].replace(",", ""))
                            turnover_map[d_str] = (vol, amt)
        except Exception:
            pass
    return turnover_map

def sync_taiex_to_sqlite():
    """主同步函式：整合 Yahoo 歷史與證交所成交額，寫入 SQLite daily_index"""
    init_index_table()
    records = fetch_yahoo_taiex_history(range_param="10y")
    if not records:
        print("[!] 無法取得大盤日K，跳過寫入")
        return 0
    
    print("[*] 正在向證交所補充近期真實成交金額...")
    turnover_map = fetch_twse_recent_turnover(months=6)
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    count = 0
    for r in records:
        d = r["date"]
        vol = r["volume"]
        amt = r["turnover"]
        if d in turnover_map:
            vol, amt = turnover_map[d]
        
        cur.execute("""
            INSERT INTO daily_index (date, open, high, low, close, change_points, change_percent, volume, turnover)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                open=excluded.open,
                high=excluded.high,
                low=excluded.low,
                close=excluded.close,
                change_points=excluded.change_points,
                change_percent=excluded.change_percent,
                volume=excluded.volume,
                turnover=excluded.turnover
        """, (d, r["open"], r["high"], r["low"], r["close"], r["change_points"], r["change_percent"], vol, amt))
        count += 1
        
    conn.commit()
    conn.close()
    print(f"[✓] 大盤加權指數 (TAIEX) 成功同步至 daily_index 表，共寫入/更新 {count} 筆交易日！")
    return count

if __name__ == "__main__":
    sync_taiex_to_sqlite()
