#!/usr/bin/env python3
"""
backfill_inst_trades_2012_2015.py
回補台灣證交所 (TWSE) 2012-05-02 至 2015-12-31 三大法人買賣超資料 (institutional_trades)！
註：證交所官方 T86 API 最早起始日為民國 101 年 05 月 02 日 (2012-05-02)。
"""

import os
import sys
import time
import random
import logging
import sqlite3
import requests

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"
LOG_FILE = "/Users/huanggin-chen/openclaw_test/backfill_inst.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
]

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=60.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn

def fetch_inst_day(date_str: str, max_retries: int = 3):
    url = f"https://www.twse.com.tw/rwd/zh/fund/T86?date={date_str}&selectType=ALL&response=json"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://www.twse.com.tw/zh/page/trading/fund/T86.html"
    }

    for attempt in range(max_retries):
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            if resp.status_code == 429:
                wait_sec = (attempt + 1) * 15
                logging.warning(f"[{date_str}] 法人遇 429 限制，等待 {wait_sec}s...")
                time.sleep(wait_sec)
                continue

            if resp.status_code != 200:
                time.sleep(3)
                continue

            data = resp.json()
            if data.get('stat') != 'OK' or 'data' not in data:
                return []

            fields = [f.strip().replace(' ', '') for f in data.get('fields', [])]
            if '證券代號' not in fields:
                return []

            idx_id = fields.index('證券代號')
            idx_f, idx_t, idx_d = -1, -1, -1
            for i, f in enumerate(fields):
                if ('外資' in f or '外陸資' in f) and '買賣超' in f and idx_f == -1: idx_f = i
                elif '投信' in f and '買賣超' in f and idx_t == -1: idx_t = i
                elif '自營商' in f and '買賣超' in f:
                    if '合計' in f or idx_d == -1: idx_d = i

            if -1 in [idx_f, idx_t, idx_d]:
                return []

            rows = []
            for r in data['data']:
                sid = str(r[idx_id]).strip()
                if not (len(sid) in [4, 5] or sid.startswith('00')):
                    continue
                try:
                    f_net = int(str(r[idx_f]).replace(',', '').strip() or 0)
                    t_net = int(str(r[idx_t]).replace(',', '').strip() or 0)
                    d_net = int(str(r[idx_d]).replace(',', '').strip() or 0)
                    rows.append((date_str, sid, f_net, t_net, d_net))
                except Exception:
                    continue

            return rows
        except Exception as e:
            logging.warning(f"[{date_str}] 法人第 {attempt+1} 次抓取失敗: {e}")
            time.sleep(2)

    return []

def run_inst_backfill(start_date: str = "20120502", end_date: str = "20151231", delay: float = 1.3, limit_days: int = None):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        SELECT date FROM daily_index
        WHERE date >= ? AND date <= ?
        ORDER BY date DESC
    """, (start_date, end_date))
    all_dates = [r[0] for r in cur.fetchall()]

    cur.execute("""
        SELECT date, count(*) FROM institutional_trades
        WHERE date >= ? AND date <= ?
        GROUP BY date
        HAVING count(*) >= 300
    """, (start_date, end_date))
    completed_set = set(r[0] for r in cur.fetchall())

    dates_to_crawl = [d for d in all_dates if d not in completed_set]
    if limit_days:
        dates_to_crawl = dates_to_crawl[:limit_days]
    logging.info(f"[*] 法人回補交易日曆: 總數 {len(all_dates)} 天，已完成 {len(completed_set)} 天，待抓取 {len(dates_to_crawl)} 天")

    total_inserted = 0
    for idx, d_str in enumerate(dates_to_crawl, 1):
        t0 = time.time()
        rows = fetch_inst_day(d_str)
        if rows:
            cur.executemany("""
                INSERT OR REPLACE INTO institutional_trades (date, stock_id, foreign_net, trust_net, dealer_net)
                VALUES (?, ?, ?, ?, ?)
            """, rows)
            conn.commit()
            total_inserted += len(rows)
            elapsed = round(time.time() - t0, 2)
            logging.info(f"[{idx}/{len(dates_to_crawl)}] {d_str} 法人完成！寫入 {len(rows)} 檔 (耗時 {elapsed}s)")
        else:
            logging.info(f"[{idx}/{len(dates_to_crawl)}] {d_str} 無法人資料")

        time.sleep(delay + random.uniform(0.1, 0.4))

    conn.close()
    logging.info(f"[✓] 法人歷史回補完畢，共寫入 {total_inserted} 筆記錄！")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=1.3)
    args = parser.parse_args()
    run_inst_backfill(delay=args.delay, limit_days=args.limit)

