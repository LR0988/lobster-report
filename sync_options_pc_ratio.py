#!/usr/bin/env python3
"""
sync_options_pc_ratio.py
負責抓取並同步台灣期貨交易所 (TAIFEX) 臺指選擇權買賣權比率 (Put/Call Ratio) 至 SQLite (tw_stock.db)
包含成交量比率 (Volume Ratio) 與未平倉量比率 (Open Interest Ratio)
"""

import os
import sys
import sqlite3
import datetime
import calendar
import time
import subprocess
import requests

LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
DB_PATH = os.path.join(LOCAL_DIR, "tw_stock.db")
TAIFEX_PC_URL = "https://www.taifex.com.tw/cht/3/pcRatioDown"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"找不到本地台股資料庫: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_options_table():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS options_pc_ratio (
            date TEXT PRIMARY KEY,
            put_vol INTEGER,
            call_vol INTEGER,
            pc_vol_ratio REAL,
            put_oi INTEGER,
            call_oi INTEGER,
            pc_oi_ratio REAL
        )
    """)
    conn.commit()
    conn.close()

def fetch_pc_ratio_csv(start_date_str: str, end_date_str: str) -> str:
    """
    向 TAIFEX 發送 POST 請求取得指定日期區間之 CSV 字串
    start_date_str: YYYY/MM/DD
    end_date_str: YYYY/MM/DD
    """
    headers = {"User-Agent": USER_AGENT}
    data = {
        "queryStartDate": start_date_str,
        "queryEndDate": end_date_str
    }
    
    # 優先嘗試 requests
    try:
        resp = requests.post(TAIFEX_PC_URL, data=data, headers=headers, timeout=12)
        if resp.status_code == 200 and "日期" in resp.text:
            return resp.text
    except Exception as e:
        print(f"[!] requests 抓取期交所 P/C Ratio 異常: {e}，切換 curl 備援")

    # 備援：使用 curl
    try:
        cmd = [
            "curl", "-s", "-X", "POST", TAIFEX_PC_URL,
            "-H", f"User-Agent: {USER_AGENT}",
            "-d", f"queryStartDate={start_date_str}&queryEndDate={end_date_str}"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if res.returncode == 0 and "日期" in res.stdout:
            return res.stdout
    except Exception as e:
        print(f"[!] curl 抓取期交所 P/C Ratio 亦失敗: {e}")

    return ""

def parse_and_insert_pc_csv(csv_text: str, conn: sqlite3.Connection) -> int:
    """
    解析期交所 CSV 並寫入 options_pc_ratio 表
    格式: 日期,賣權成交量,買權成交量,買賣權成交量比率%,賣權未平倉量,買權未平倉量,買賣權未平倉量比率%
    """
    if not csv_text:
        return 0
    
    cur = conn.cursor()
    lines = [l.strip() for l in csv_text.strip().split("\n") if l.strip()]
    inserted = 0

    for line in lines:
        parts = [p.strip() for p in line.split(",") if p.strip()]
        if len(parts) >= 7 and parts[0] != "日期":
            d_clean = parts[0].replace("/", "")
            try:
                p_vol = int(parts[1])
                c_vol = int(parts[2])
                pc_v_ratio = float(parts[3])
                p_oi = int(parts[4])
                c_oi = int(parts[5])
                pc_oi_ratio = float(parts[6])
                
                cur.execute("""
                    INSERT OR REPLACE INTO options_pc_ratio 
                    (date, put_vol, call_vol, pc_vol_ratio, put_oi, call_oi, pc_oi_ratio)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (d_clean, p_vol, c_vol, pc_v_ratio, p_oi, c_oi, pc_oi_ratio))
                inserted += 1
            except (ValueError, IndexError):
                continue

    conn.commit()
    return inserted

def sync_options_pc_ratio(lookback_days: int = 45) -> int:
    """
    增量同步選擇權 Put/Call Ratio
    若資料庫已有資料，自最新日期的前 10 天開始抓至今日；
    若無資料，則執行 2016 年至今的完整回填。
    """
    init_options_table()
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute("SELECT MAX(date), COUNT(*) FROM options_pc_ratio")
    row = cur.fetchone()
    max_date = row[0] if row else None
    count = row[1] if row else 0

    today = datetime.date.today()
    today_str = today.strftime("%Y/%m/%d")

    if not max_date or count < 100:
        print("[*] 偵測到 options_pc_ratio 資料缺失，啟動 2016 年完整歷史回填...")
        total_inserted = 0
        current_year = today.year
        for y in range(2016, current_year + 1):
            max_m = today.month if y == current_year else 12
            for m in range(1, max_m + 1):
                _, last_day = calendar.monthrange(y, m)
                s_str = f"{y}/{m:02d}/01"
                e_str = f"{y}/{m:02d}/{last_day:02d}"
                csv_data = fetch_pc_ratio_csv(s_str, e_str)
                n = parse_and_insert_pc_csv(csv_data, conn)
                total_inserted += n
                time.sleep(0.3)
        conn.close()
        print(f"[✓] 完整歷史回填完成，共寫入 {total_inserted} 筆選擇權 P/C Ratio 紀錄。")
        return total_inserted
    else:
        # 增量同步：從 max_date 往前退 10 天（確保補上最新修正與假日後交易）
        try:
            dt_max = datetime.datetime.strptime(max_date, "%Y%m%d").date()
            dt_start = max(dt_max - datetime.timedelta(days=10), today - datetime.timedelta(days=lookback_days))
        except Exception:
            dt_start = today - datetime.timedelta(days=lookback_days)

        s_str = dt_start.strftime("%Y/%m/%d")
        print(f"[*] 增量同步 options_pc_ratio: 自 {s_str} 至 {today_str}...")
        csv_data = fetch_pc_ratio_csv(s_str, today_str)
        n = parse_and_insert_pc_csv(csv_data, conn)
        conn.close()
        print(f"[✓] 增量同步完成，共更新 {n} 筆選擇權 P/C Ratio。")
        return n

if __name__ == "__main__":
    count = sync_options_pc_ratio()
    print(f"Sync complete. Updated rows: {count}")
