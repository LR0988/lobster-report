"""
Sync Global Liquid Universe (自動抓取國內券商可買之全球高流動性股票庫)
支援：
- 台股本土核心權值與高爆發龍頭 (TWSE/TPEx)
- 美股 Nasdaq 100 全池成分股 (USD)
- S&P 500 代表性權值巨頭 (USD)
- 全球高流動性超級 ADR (台積電、艾司摩爾、諾和諾德、淡水河谷、巴西石油、豐田等)
- 宏觀基準 ETF (SPY, QQQ, 0050.TW)
自動增量更新 / 下載入庫 tw_stock.db
"""

import os
import sqlite3
import yfinance as yf
import pandas as pd
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 1. 台股本土代表性高流動性池 (25 檔)
TW_STOCKS = [
    '2330.TW', '2454.TW', '2317.TW', '3231.TW', '2382.TW', '3017.TW', '3324.TW',
    '3661.TW', '6669.TW', '2308.TW', '2379.TW', '3037.TW', '2603.TW', '2412.TW',
    '2881.TW', '2882.TW', '2356.TW', '2376.TW', '3008.TW', '3443.TW', '1519.TW',
    '1513.TW', '2609.TW', '8996.TW', '6274.TW'
]

# 2. 美股 Nasdaq 100 全池成分股 (94 檔)
US_NASDAQ_100 = [
    'AAPL', 'ABNB', 'ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMAT', 'AMD', 'AMGN',
    'AMZN', 'ANSS', 'ASML', 'AVGO', 'AZN', 'BIIB', 'BKNG', 'BKR', 'CDNS', 'CEG',
    'CHTR', 'CMCSA', 'COST', 'CPRT', 'CRWD', 'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTSH',
    'DASH', 'DLTR', 'DXCM', 'EA', 'EXC', 'FAST', 'FANG', 'FTNT', 'GEHC', 'GFS',
    'GILD', 'GOOG', 'GOOGL', 'HON', 'IDXX', 'ILMN', 'INTC', 'INTU', 'ISRG', 'KDP',
    'KHC', 'KLAC', 'LRCX', 'LULU', 'MAR', 'MCHP', 'MDLZ', 'MELI', 'META', 'MNST',
    'MRNA', 'MRVL', 'MSFT', 'MU', 'NFLX', 'NVDA', 'NXPI', 'ODFL', 'ON', 'ORLY',
    'PANW', 'PAYX', 'PCAR', 'PDD', 'PEP', 'PYPL', 'QCOM', 'REGN', 'ROP', 'ROST',
    'SBUX', 'SMCI', 'SNPS', 'TEAM', 'TMUS', 'TSLA', 'TTD', 'TXN', 'VRSK', 'VRTX',
    'WBD', 'WDAY', 'XEL', 'ZS'
]

# 3. S&P 500 代表性權值巨頭 (非 Nasdaq 100) (10 檔)
US_SP500_EXTRA = [
    'BRK-B', 'JPM', 'XOM', 'LLY', 'V', 'PG', 'HD', 'UNH', 'MA', 'CVX'
]

# 4. 全球在美掛牌超級 ADR (國內複委託熱門標的) (12 檔)
GLOBAL_ADRS = [
    'TSM', 'UMC', 'ASX', 'NVO', 'BABA', 'PBR', 'VALE', 'ITUB', 'BBD', 'TM', 'SONY', 'SAP'
]

# 5. 宏觀指標
MACRO_BENCHMARKS = ['SPY', 'QQQ', '0050.TW']

FULL_UNIVERSE = sorted(list(set(TW_STOCKS + US_NASDAQ_100 + US_SP500_EXTRA + GLOBAL_ADRS + MACRO_BENCHMARKS)))

def init_tables():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS global_stock_daily (
            ticker TEXT,
            date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            adj_close REAL,
            volume REAL,
            PRIMARY KEY (ticker, date)
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_gsd_ticker_date ON global_stock_daily(ticker, date)")
    conn.commit()
    conn.close()

def sync_universe():
    init_tables()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    print(f"[*] 全球高流動性股票庫總標的數: {len(FULL_UNIVERSE)}")
    
    # 檢查已存在數據的最晚日期
    existing_status = {}
    for t in FULL_UNIVERSE:
        c.execute("SELECT MAX(date), COUNT(*) FROM global_stock_daily WHERE ticker = ?", (t,))
        row = c.fetchone()
        existing_status[t] = {'max_date': row[0], 'count': row[1]}

    success_count = 0
    updated_records = 0

    for idx, ticker in enumerate(FULL_UNIVERSE, 1):
        status = existing_status.get(ticker, {'max_date': None, 'count': 0})
        max_d = status['max_date']
        
        # 決定下載起點
        if max_d is not None and status['count'] > 200:
            start_date = max_d
            mode = "增量更新"
        else:
            start_date = "2000-01-01"
            mode = "全量下載"

        try:
            df = yf.download(ticker, start=start_date, progress=False, auto_adjust=False)
            if df.empty:
                print(f"[{idx}/{len(FULL_UNIVERSE)}] {ticker:<10} | {mode:<4} | 無新數據")
                continue

            # 處理多層欄位
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            records = []
            for dt, row in df.iterrows():
                dt_str = dt.strftime('%Y-%m-%d')
                o = float(row.get('Open', 0)) if pd.notna(row.get('Open')) else None
                h = float(row.get('High', 0)) if pd.notna(row.get('High')) else None
                l = float(row.get('Low', 0)) if pd.notna(row.get('Low')) else None
                cl = float(row.get('Close', 0)) if pd.notna(row.get('Close')) else None
                ac = float(row.get('Adj Close', cl)) if pd.notna(row.get('Adj Close')) else cl
                v = float(row.get('Volume', 0)) if pd.notna(row.get('Volume')) else 0
                if o is not None and cl is not None and o > 0 and cl > 0:
                    records.append((ticker, dt_str, o, h, l, cl, ac, v))

            if records:
                c.executemany("""
                    INSERT OR REPLACE INTO global_stock_daily (ticker, date, open, high, low, close, adj_close, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, records)
                conn.commit()
                updated_records += len(records)
                success_count += 1
                print(f"[{idx}/{len(FULL_UNIVERSE)}] {ticker:<10} | {mode:<4} | 成功入庫 {len(records):>5} 筆 (最新: {records[-1][1]})")
        except Exception as e:
            print(f"[{idx}/{len(FULL_UNIVERSE)}] {ticker:<10} | 錯誤: {e}")

    conn.close()
    print(f"\n[✓] 全球高流動性數據庫同步完成！成功更新 {success_count} 檔，新增/更新 {updated_records} 筆日K。")

if __name__ == "__main__":
    sync_universe()
