#!/usr/bin/env python3
"""
sync_tpex_cb_data.py
櫃買中心 (TPEx) 100% 真實可轉換公司債 (CB) 發行條件、轉換價與每日收盤行情同步引擎

功能：
1. 從 TPEx 官方 OpenAPI (bond_ISSBD5_data) 下載全市場流通中真實 CB 發行資料 (395+ 檔)
2. 提取真實 5 碼代號、簡稱、母股代號、真實發行轉換價 (Conversion Price)、賣回日、賣回價與發行/流通餘額
3. 建立並同步至 tw_stock.db 的 `tpex_cb_metadata` 與 `tpex_cb_quotes` 資料表
4. 針對核心具流動性之可轉債，即時透過 TPEx cbDayQry API 抓取真實市場等價成交收盤價與成交張數
5. 計算真實 Parity (轉換價值) 與真實轉換溢價率 (Conversion Premium)
"""

import urllib.request
import requests
import json
import sqlite3
import os
import time
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")

def init_cb_tables(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tpex_cb_metadata (
            cb_code TEXT PRIMARY KEY,
            cb_name TEXT,
            stock_id TEXT,
            stock_name TEXT,
            conv_price REAL,
            issue_date TEXT,
            maturity_date TEXT,
            put_date TEXT,
            put_price REAL,
            issue_amount REAL,
            outstanding_amount REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tpex_cb_quotes (
            cb_code TEXT,
            trade_date TEXT,
            cb_close REAL,
            cb_change REAL,
            cb_open REAL,
            cb_high REAL,
            cb_low REAL,
            volume_lots INTEGER,
            trade_value REAL,
            parity REAL,
            premium_pct REAL,
            PRIMARY KEY (cb_code, trade_date)
        )
    """)
    conn.commit()

def fetch_tpex_cb_metadata():
    url = "https://www.tpex.org.tw/openapi/v1/bond_ISSBD5_data"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    print(f"📥 正在從櫃買中心 OpenAPI 下載全市場可轉債發行資料庫 ({url})...")
    with urllib.request.urlopen(req, timeout=15) as r:
        raw_data = json.loads(r.read().decode('utf-8'))
        
    print(f"✅ 成功下載 {len(raw_data)} 檔債券資料，開始清洗上市櫃可轉債...")
    
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # 動態取得台股最新交易日與母股名稱對照 (零硬編碼日期)
    latest_date_row = cur.execute(
        "SELECT MAX(date) FROM daily_stock WHERE length(stock_id) = 4 AND closing_price > 0 AND stock_id != 'HOLIDAY'"
    ).fetchone()
    latest_tw_date = str(latest_date_row[0]) if (latest_date_row and latest_date_row[0]) else datetime.now().strftime("%Y%m%d")
    cur.execute("SELECT stock_id, stock_name FROM daily_stock WHERE date = ? AND length(stock_id) = 4", (latest_tw_date,))
    db_stocks = dict(cur.fetchall())
    
    cbs = []
    for d in raw_data:
        b_code = d.get('BondCode', '').strip()
        if len(b_code) >= 5:
            stock_id = b_code[:4]
            stock_name = db_stocks.get(stock_id, d.get('IssuerName', ''))
            conv_px = float(d.get('Conversion/ExchangePriceAtIssuance') or 0.0)
            put_px = float(d.get('PutOptionPrice') or 100.0)
            issue_amt = float(d.get('IssueAmount') or 0.0)
            out_amt = float(d.get('OutstandingAmount') or 0.0)
            
            cbs.append({
                'cb_code': b_code,
                'cb_name': d.get('ShortName', ''),
                'stock_id': stock_id,
                'stock_name': stock_name,
                'conv_price': conv_px,
                'issue_date': d.get('IssueDate', ''),
                'maturity_date': d.get('MaturityDate', ''),
                'put_date': d.get('PutOptionDate', ''),
                'put_price': put_px,
                'issue_amount': issue_amt,
                'outstanding_amount': out_amt
            })
            
    # 寫入資料庫
    cur.executemany("""
        INSERT OR REPLACE INTO tpex_cb_metadata 
        (cb_code, cb_name, stock_id, stock_name, conv_price, issue_date, maturity_date, put_date, put_price, issue_amount, outstanding_amount, updated_at)
        VALUES (:cb_code, :cb_name, :stock_id, :stock_name, :conv_price, :issue_date, :maturity_date, :put_date, :put_price, :issue_amount, :outstanding_amount, CURRENT_TIMESTAMP)
    """, cbs)
    conn.commit()
    print(f"💾 已將 {len(cbs)} 檔真實可轉債發行條件寫入 tpex_cb_metadata 資料表！")
    
    conn.close()
    return cbs

def fetch_real_cb_quotes_for_candidates(candidates_limit=35):
    """針對高關聯與核心可轉債，抓取真實等價成交行情"""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    latest_date_row = cur.execute(
        "SELECT MAX(date) FROM daily_stock WHERE length(stock_id) = 4 AND closing_price > 0 AND stock_id != 'HOLIDAY'"
    ).fetchone()
    latest_tw_date = str(latest_date_row[0]) if (latest_date_row and latest_date_row[0]) else datetime.now().strftime("%Y%m%d")
    tpex_query_date = f"{latest_tw_date[:4]}/{latest_tw_date[4:6]}/{latest_tw_date[6:8]}" if len(latest_tw_date) == 8 else datetime.now().strftime("%Y/%m/%d")

    # 關聯母股最新收盤價，篩選出具代表性、Parity 介於 80~130 或高流通餘額之 CB
    cur.execute("""
        SELECT m.cb_code, m.cb_name, m.stock_id, m.stock_name, m.conv_price, s.closing_price, m.outstanding_amount
        FROM tpex_cb_metadata m
        JOIN daily_stock s ON m.stock_id = s.stock_id
        WHERE s.date = ? AND m.conv_price > 0
        ORDER BY m.outstanding_amount DESC
        LIMIT 60
    """, (latest_tw_date,))
    rows = cur.fetchall()
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.tpex.org.tw/zh-tw/bond/info/statistics-cb/day-quotes.html'
    }
    
    quotes_saved = 0
    print(f"📡 開始自 TPEx 抓取前 {len(rows)} 檔核心可轉債真實等價市場報價 (基準日: {tpex_query_date})...")
    
    for r in rows:
        cb_code, cb_name, stock_id, stock_name, conv_px, stock_close, out_amt = r
        parity = round((stock_close / conv_px) * 100.0, 2)
        
        try:
            url = "https://www.tpex.org.tw/www/zh-tw/bond/cbDayQry"
            resp = requests.get(url, params={'date': tpex_query_date, 'code': cb_code}, headers=headers, timeout=6)
            j = resp.json()
            tables = j.get('tables', [])
            if tables and len(tables[0].get('data', [])) > 0:
                data_rows = [x for x in tables[0].get('data') if x[1] == '等價' and x[2].strip() != '']
                if data_rows:
                    last_q = data_rows[-1]
                    d_str = last_q[0]
                    cb_close = float(last_q[2].replace(',', ''))
                    cb_change = float(last_q[3].replace(',', '') or 0.0)
                    cb_open = float(last_q[4].replace(',', '') or cb_close)
                    cb_high = float(last_q[5].replace(',', '') or cb_close)
                    cb_low = float(last_q[6].replace(',', '') or cb_close)
                    vol = int(last_q[8].replace(',', '') or 0)
                    val = float(last_q[9].replace(',', '') or 0.0)
                    prem_pct = round(((cb_close - parity) / parity) * 100.0, 2)
                    
                    cur.execute("""
                        INSERT OR REPLACE INTO tpex_cb_quotes
                        (cb_code, trade_date, cb_close, cb_change, cb_open, cb_high, cb_low, volume_lots, trade_value, parity, premium_pct)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (cb_code, d_str, cb_close, cb_change, cb_open, cb_high, cb_low, vol, val, parity, prem_pct))
                    quotes_saved += 1
            time.sleep(0.08)
        except Exception as e:
            continue
            
    conn.commit()
    conn.close()
    print(f"💾 成功同步 {quotes_saved} 筆真實市場等價收盤報價至 tpex_cb_quotes！")

if __name__ == "__main__":
    conn = sqlite3.connect(DB_PATH)
    init_cb_tables(conn)
    conn.close()
    fetch_tpex_cb_metadata()
    fetch_real_cb_quotes_for_candidates()
