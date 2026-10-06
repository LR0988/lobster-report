#!/usr/bin/env python3
"""
backfill_options_2005_2015.py
完整回補期交所 (TAIFEX) 臺指選擇權 P/C Ratio 至 2005 年！
涵蓋 2005-01-01 至 2015-12-31 全歷史月份。
"""

import os
import sys
import time
import calendar
import datetime
import sqlite3
import requests

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"
TAIFEX_PC_URL = "https://www.taifex.com.tw/cht/3/pcRatioDown"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    return conn

def backfill_options():
    print("[*] 開始回補期交所 2005~2015 選擇權 Put/Call Ratio...")
    conn = get_db()
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

    total_inserted = 0
    headers = {"User-Agent": USER_AGENT}

    for year in range(2005, 2016):
        print(f"  --> 正在抓取 {year} 年 P/C Ratio...")
        for month in range(1, 13):
            last_day = calendar.monthrange(year, month)[1]
            start_str = f"{year}/{month:02d}/01"
            end_str = f"{year}/{month:02d}/{last_day:02d}"

            payload = {
                "queryStartDate": start_str,
                "queryEndDate": end_str
            }

            try:
                resp = requests.post(TAIFEX_PC_URL, data=payload, headers=headers, timeout=12)
                if resp.status_code == 200 and "日期" in resp.text:
                    lines = [l.strip() for l in resp.text.strip().split("\n") if l.strip()]
                    month_inserted = 0
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
                                month_inserted += 1
                            except Exception:
                                continue
                    conn.commit()
                    total_inserted += month_inserted
                time.sleep(0.3)
            except Exception as e:
                print(f"      [!] 抓取 {year}-{month:02d} 失敗: {e}")
                time.sleep(1)

    conn.close()
    print(f"[✓] 選擇權 P/C Ratio 回補完成！共寫入/更新 {total_inserted} 筆資料。")

if __name__ == "__main__":
    backfill_options()
