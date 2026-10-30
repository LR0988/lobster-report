"""
Global Sovereign Daily Data Sync & Database Pipeline
全球國家級主權市場日K資料庫建置與每日自動同步管線
"""

import os
import sqlite3
import yfinance as yf
import pandas as pd
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")

# 全球國家級主權標的清單
SOVEREIGN_COUNTRIES = {
    # 核心成熟市場
    "SPY": {"country": "美國", "name": "標普500 (SPY)", "region": "北美", "inception": "1993-01-29"},
    "QQQ": {"country": "美國", "name": "那斯達克100 (QQQ)", "region": "北美", "inception": "1999-03-10"},
    "EWJ": {"country": "日本", "name": "MSCI日本 (EWJ)", "region": "亞洲", "inception": "1996-03-18"},
    "EWG": {"country": "德國", "name": "MSCI德國 (EWG)", "region": "歐洲", "inception": "1996-03-18"},
    "EWU": {"country": "英國", "name": "MSCI英國 (EWU)", "region": "歐洲", "inception": "1996-03-18"},
    "EWC": {"country": "加拿大", "name": "MSCI加拿大 (EWC)", "region": "北美", "inception": "1996-03-18"},
    "EWA": {"country": "澳洲", "name": "MSCI澳洲 (EWA)", "region": "大洋洲", "inception": "1996-03-18"},
    "EWL": {"country": "瑞士", "name": "MSCI瑞士 (EWL)", "region": "歐洲", "inception": "1996-03-18"},
    "EWN": {"country": "荷蘭", "name": "MSCI荷蘭 (EWN)", "region": "歐洲", "inception": "1996-03-18"},
    "EWD": {"country": "瑞典", "name": "MSCI瑞典 (EWD)", "region": "歐洲", "inception": "1996-03-18"},
    
    # 核心新興市場與高成長國
    "EWT": {"country": "台灣", "name": "MSCI台灣 (EWT)", "region": "亞洲", "inception": "2000-06-23"},
    "EWY": {"country": "韓國", "name": "MSCI韓國 (EWY)", "region": "亞洲", "inception": "2000-05-12"},
    "EWZ": {"country": "巴西", "name": "MSCI巴西 (EWZ)", "region": "南美", "inception": "2000-07-14"},
    "EWW": {"country": "墨西哥", "name": "MSCI墨西哥 (EWW)", "region": "美洲", "inception": "1996-03-18"},
    "EWH": {"country": "香港", "name": "MSCI香港 (EWH)", "region": "亞洲", "inception": "1996-03-18"},
    "INDA": {"country": "印度", "name": "MSCI印度 (INDA)", "region": "亞洲", "inception": "2012-02-02"},
    
    # 防禦與避險基準 (當全市場走空時之參考錨點)
    "BIL": {"country": "美國", "name": "SPDR 1-3月短期美債 (現金等價物)", "region": "現金", "inception": "2007-05-30"},
    "GLD": {"country": "全球", "name": "SPDR 黃金現貨", "region": "貴金屬", "inception": "2004-11-18"}
}

def init_global_sovereign_tables(conn: sqlite3.Connection):
    """建立全球主權資料表"""
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS global_sovereign_metadata (
            ticker TEXT PRIMARY KEY,
            country TEXT NOT NULL,
            name TEXT NOT NULL,
            region TEXT NOT NULL,
            inception_date TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS global_sovereign_daily (
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            adj_close REAL NOT NULL,
            volume REAL,
            PRIMARY KEY (ticker, date)
        )
    """)
    
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_global_sovereign_lookup 
        ON global_sovereign_daily(ticker, date)
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_global_sovereign_date 
        ON global_sovereign_daily(date)
    """)
    conn.commit()

def sync_global_sovereign_history(full_history: bool = True):
    """
    抓取並同步全球國家 ETF 全歷史日K數據
    full_history=True: 抓取 max 歷史
    full_history=False: 抓取近 1 個月增量更新
    """
    conn = sqlite3.connect(DB_PATH)
    init_global_sovereign_tables(conn)
    cursor = conn.cursor()
    
    # 寫入 metadata
    for ticker, meta in SOVEREIGN_COUNTRIES.items():
        cursor.execute("""
            INSERT OR REPLACE INTO global_sovereign_metadata (ticker, country, name, region, inception_date)
            VALUES (?, ?, ?, ?, ?)
        """, (ticker, meta["country"], meta["name"], meta["region"], meta["inception"]))
    conn.commit()
    
    tickers = list(SOVEREIGN_COUNTRIES.keys())
    period = "max" if full_history else "1mo"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 開始下載全球 {len(tickers)} 個主權國家 ETF (期間: {period})...")
    
    df_raw = yf.download(tickers, period=period, auto_adjust=False, group_by='ticker', progress=False)
    
    import requests
    from zoneinfo import ZoneInfo

    def _fetch_yahoo_meta_latest(t_sym: str):
        try:
            r = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{t_sym}?range=5d&interval=1d",
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=8
            ).json()
            res = r["chart"]["result"][0]
            meta = res["meta"]
            rmp = meta.get("regularMarketPrice")
            rmt = meta.get("regularMarketTime")
            if rmp is None or not rmt:
                return None
            tz = ZoneInfo(meta.get("exchangeTimezoneName", "America/New_York"))
            d_str = datetime.fromtimestamp(rmt, tz).strftime("%Y-%m-%d")
            c = round(float(rmp), 4)
            h = round(float(meta.get("regularMarketDayHigh") or c), 4)
            l = round(float(meta.get("regularMarketDayLow") or c), 4)
            o = round(float(meta.get("regularMarketOpen") or meta.get("chartPreviousClose") or c), 4)
            v = float(meta.get("regularMarketVolume") or 0.0)
            return (t_sym, d_str, o, h, l, c, c, v)
        except Exception:
            return None

    total_inserted = 0
    for ticker in tickers:
        try:
            if ticker not in df_raw.columns.levels[0]:
                continue
            raw_t = df_raw[ticker]
            had_trailing_nan = (not raw_t.empty) and pd.isna(raw_t.iloc[-1].get('Close'))
            sub = raw_t.dropna(subset=['Close'])
            if sub.empty:
                continue
                
            records = []
            for dt, row in sub.iterrows():
                d_str = dt.strftime("%Y-%m-%d")
                c_val = float(row['Close']) if pd.notna(row['Close']) else None
                adj_val = float(row['Adj Close']) if ('Adj Close' in row and pd.notna(row['Adj Close'])) else c_val
                o_val = float(row['Open']) if ('Open' in row and pd.notna(row['Open'])) else c_val
                h_val = float(row['High']) if ('High' in row and pd.notna(row['High'])) else c_val
                l_val = float(row['Low']) if ('Low' in row and pd.notna(row['Low'])) else c_val
                v_val = float(row['Volume']) if ('Volume' in row and pd.notna(row['Volume'])) else 0.0
                
                records.append((ticker, d_str, o_val, h_val, l_val, c_val, adj_val, v_val))

            # 若最後一根日K為 NaN (Yahoo Finance 美股收盤後結算延遲)，自動從 meta.regularMarketPrice 補齊最新收盤日K
            if had_trailing_nan or not full_history:
                meta_bar = _fetch_yahoo_meta_latest(ticker)
                if meta_bar and (not records or meta_bar[1] >= records[-1][1]):
                    records = [r for r in records if r[1] != meta_bar[1]] + [meta_bar]
                
            cursor.executemany("""
                INSERT OR REPLACE INTO global_sovereign_daily 
                (ticker, date, open, high, low, close, adj_close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, records)
            conn.commit()
            total_inserted += len(records)
            print(f"  ✓ [{ticker}] {SOVEREIGN_COUNTRIES[ticker]['name']}: 寫入 {len(records)} 筆日K (最早: {records[0][1]} ~ 最新: {records[-1][1]})")
        except Exception as e:
            print(f"  ✗ [{ticker}] 處理失敗: {e}")
            
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 全球主權資料庫建置完成！共寫入 {total_inserted} 筆日K。")
    conn.close()

if __name__ == "__main__":
    sync_global_sovereign_history(full_history=True)
