#!/usr/bin/env python3
"""
backfill_2005_data.py
全面回補台股加權指數 (^TWII)、國際宏觀指標與核心權值三雄 (2330, 2317, 2454) 至 2005 年！
涵蓋 2005~2026 全歷史（逾 21 年、5,300+ 交易日），完整重現 2008 全球金融海嘯、2011 歐債危機與完整景氣循環。
"""

import os
import sys
import json
import sqlite3
import datetime
import subprocess
import urllib.parse
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"
USER_AGENT = "Mozilla/5.0"

# 2005-01-01 00:00:00 UTC = 1104537600
START_TIMESTAMP = 1104537600
# 2026-12-31 timestamp
END_TIMESTAMP = 1798761600

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def fetch_yahoo_chart(ticker: str, start_ts: int = START_TIMESTAMP, end_ts: int = END_TIMESTAMP):
    safe_ticker = urllib.parse.quote(ticker)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{safe_ticker}?period1={start_ts}&period2={end_ts}&interval=1d"
    cmd = ["curl", "-s", url, "-H", f"User-Agent: {USER_AGENT}"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0 or not proc.stdout:
        print(f"[!] curl 失敗: {ticker}")
        return None
    try:
        data = json.loads(proc.stdout)
        res = data.get("chart", {}).get("result", [])
        if not res:
            print(f"[!] Yahoo 回傳無效結構: {ticker}")
            return None
        return res[0]
    except Exception as e:
        print(f"[!] 解析 JSON 失敗 {ticker}: {e}")
        return None

def backfill_taiex():
    print("[*] 正在回補台股加權指數 (^TWII) 自 2005 年至今...")
    res = fetch_yahoo_chart("^TWII")
    if not res:
        print("[!] 抓取 ^TWII 失敗")
        return 0
    
    timestamps = res.get("timestamp", [])
    quotes = res.get("indicators", {}).get("quote", [{}])[0]
    opens = quotes.get("open", [])
    highs = quotes.get("high", [])
    lows = quotes.get("low", [])
    closes = quotes.get("close", [])
    volumes = quotes.get("volume", [])
    
    conn = get_db()
    cur = conn.cursor()
    
    # 確保表存在
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
        
        d_str = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d")
        c = round(float(c), 2)
        o = round(float(o), 2)
        h = round(float(h), 2)
        l = round(float(l), 2)
        v = int(v) if v else 0
        
        # 估算成交金額：若量大且非0，初估 turnover = volume * close
        turnover = round(v * c, 2)
        chg_pts = round(c - prev_close, 2) if prev_close else 0.0
        chg_pct = round((c / prev_close - 1) * 100, 2) if prev_close else 0.0
        prev_close = c
        
        records.append((d_str, o, h, l, c, chg_pts, chg_pct, v, turnover))
    
    # 寫入，若日期已存在且既有 turnover > 0 則保留既有真實成交額
    inserted = 0
    for r in records:
        d_str, o, h, l, c, chg_pts, chg_pct, v, turnover = r
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
                turnover=CASE WHEN daily_index.turnover > 0 THEN daily_index.turnover ELSE excluded.turnover END
        """, (d_str, o, h, l, c, chg_pts, chg_pct, v, turnover))
        inserted += 1
        
    conn.commit()
    conn.close()
    print(f"[✓] 加權指數 (^TWII) 回補完成，共處理 {inserted} 筆交易日！")
    return inserted

def backfill_macro_indicators():
    print("[*] 正在回補國際宏觀指標自 2005 年至今...")
    MACRO_TICKERS = {
        'us10y': '^TNX',
        'oil_wti': 'CL=F',
        'usdtwd': 'USDTWD=X',
        'sox': '^SOX',
        'dxy': 'DX-Y.NYB',
        'tsm_adr': 'TSM',
        'nvda': 'NVDA',
        'usdjpy': 'JPY=X',
        'etf_0050': '0050.TW',
    }
    
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS macro_indicators (
            date TEXT PRIMARY KEY,
            us10y REAL,
            oil_wti REAL,
            usdtwd REAL,
            sox REAL,
            dxy REAL,
            tsm_adr REAL,
            nvda REAL,
            usdjpy REAL,
            etf_0050 REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    for col in ['tsm_adr', 'nvda', 'usdjpy', 'etf_0050']:
        try:
            cur.execute(f"ALTER TABLE macro_indicators ADD COLUMN {col} REAL")
        except sqlite3.OperationalError:
            pass
    conn.commit()
    conn.close()
    
    # 抓取台股交易日列表作為基準日曆
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT date FROM daily_index ORDER BY date ASC")
    tw_dates = [r[0] for r in cur.fetchall()]
    conn.close()
    
    if not tw_dates:
        print("[!] 尚未有 daily_index，無法對齊宏觀日曆")
        return 0
        
    df_macro = pd.DataFrame({'date': tw_dates})
    df_macro.set_index('date', inplace=True)
    
    for col, ticker in MACRO_TICKERS.items():
        print(f"    - 抓取 {col} ({ticker})...")
        res = fetch_yahoo_chart(ticker)
        if not res:
            continue
        timestamps = res.get("timestamp", [])
        quotes = res.get("indicators", {}).get("quote", [{}])[0]
        closes = quotes.get("close", [])
        
        series_dict = {}
        for ts, c in zip(timestamps, closes):
            if c is not None:
                d_str = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d")
                series_dict[d_str] = round(float(c), 4)
                
        s = pd.Series(series_dict, name=col)
        df_macro = df_macro.join(s, how='left')
        
    # 前向填充 (Forward-Fill)，若前段仍有缺失則後向填充 (Back-Fill)
    df_macro = df_macro.ffill().bfill()
    
    conn = get_db()
    cur = conn.cursor()
    updated = 0
    for d_str, row in df_macro.iterrows():
        cur.execute("""
            INSERT INTO macro_indicators (date, us10y, oil_wti, usdtwd, sox, dxy, tsm_adr, nvda, usdjpy, etf_0050)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                us10y=excluded.us10y,
                oil_wti=excluded.oil_wti,
                usdtwd=excluded.usdtwd,
                sox=excluded.sox,
                dxy=excluded.dxy,
                tsm_adr=excluded.tsm_adr,
                nvda=excluded.nvda,
                usdjpy=excluded.usdjpy,
                etf_0050=excluded.etf_0050,
                updated_at=CURRENT_TIMESTAMP
        """, (
            str(d_str),
            float(row['us10y']) if pd.notnull(row['us10y']) else None,
            float(row['oil_wti']) if pd.notnull(row['oil_wti']) else None,
            float(row['usdtwd']) if pd.notnull(row['usdtwd']) else None,
            float(row['sox']) if pd.notnull(row['sox']) else None,
            float(row['dxy']) if pd.notnull(row['dxy']) else None,
            float(row['tsm_adr']) if pd.notnull(row['tsm_adr']) else None,
            float(row['nvda']) if pd.notnull(row['nvda']) else None,
            float(row['usdjpy']) if pd.notnull(row['usdjpy']) else None,
            float(row['etf_0050']) if pd.notnull(row['etf_0050']) else None,
        ))
        updated += 1
        
    conn.commit()
    conn.close()
    print(f"[✓] 宏觀指標回補完成，共更新 {updated} 個交易日！")
    return updated

def backfill_top3_stocks():
    print("[*] 正在回補權值三雄 (台積電 2330, 鴻海 2317, 聯發科 2454) 2005~2016 歷史股價...")
    STOCKS = {
        '2330': ('2330.TW', '台積電'),
        '2317': ('2317.TW', '鴻海'),
        '2454': ('2454.TW', '聯發科')
    }
    
    conn = get_db()
    cur = conn.cursor()
    total_inserted = 0
    for sid, (ticker, sname) in STOCKS.items():
        print(f"    - 抓取 {sid} {sname} ({ticker})...")
        res = fetch_yahoo_chart(ticker)
        if not res:
            continue
        timestamps = res.get("timestamp", [])
        quotes = res.get("indicators", {}).get("quote", [{}])[0]
        opens = quotes.get("open", [])
        highs = quotes.get("high", [])
        lows = quotes.get("low", [])
        closes = quotes.get("close", [])
        volumes = quotes.get("volume", [])
        
        cnt = 0
        for i in range(len(timestamps)):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue
            ts = timestamps[i]
            d_str = datetime.datetime.fromtimestamp(ts).strftime("%Y%m%d")
            
            # 若已經是 2016 之後且本地已有，則不覆蓋既有細膩籌碼欄位
            c_val = round(float(c), 2)
            o_val = round(float(opens[i]), 2) if i < len(opens) and opens[i] else c_val
            h_val = round(float(highs[i]), 2) if i < len(highs) and highs[i] else c_val
            l_val = round(float(lows[i]), 2) if i < len(lows) and lows[i] else c_val
            v_val = int(volumes[i]) if i < len(volumes) and volumes[i] else 0
            
            cur.execute("""
                INSERT INTO daily_stock (date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_volume, market_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, '上市')
                ON CONFLICT(date, stock_id) DO UPDATE SET
                    closing_price=CASE WHEN daily_stock.closing_price IS NULL OR daily_stock.closing_price = 0 THEN excluded.closing_price ELSE daily_stock.closing_price END
            """, (d_str, sid, sname, o_val, h_val, l_val, c_val, v_val))
            cnt += 1
        print(f"      [✓] {sid} {sname} 處理了 {cnt} 筆記錄")
        total_inserted += cnt
        
    conn.commit()
    conn.close()
    print(f"[✓] 權值三雄回補完成，共處理 {total_inserted} 筆記錄！")
    return total_inserted

if __name__ == "__main__":
    backfill_taiex()
    backfill_macro_indicators()
    backfill_top3_stocks()
    print("[🎉] 全數 2005~2026 歷史資料已成功回補至 SQLite！")
