"""
Sync Global Titan Stock Universe Data (全球泰坦個股數據同步器)
下載全球代表性王權個股日K數據 (2000~2026)，存入 tw_stock.db
"""

import os
import sqlite3
import yfinance as yf
import pandas as pd
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")

# 各國代表性泰坦候選池 (涵蓋美股超級巨頭、各國龍頭ADR與權重股)
COUNTRY_STOCKS_MAP = {
    'QQQ': ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'COST', 'NFLX', 'AMD', 'QCOM', 'INTC', 'CSCO', 'AMAT'],
    'SPY': ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'BRK-B', 'JPM', 'XOM', 'LLY', 'V', 'PG', 'HD'],
    'EWZ': ['PBR', 'VALE', 'ITUB', 'BBD', 'ABEV'],
    'EWT': ['TSM', 'UMC', 'ASX'],
    'EWY': ['005930.KS', '000660.KS', '005380.KS', '051910.KS'],
    'EWW': ['AMX', 'FMX', 'CX'],
    'EWG': ['SAP', 'SIEGY', 'BMWYY', 'MBGYY'],
    'EWN': ['ASML', 'SHEL', 'ING'],
    'EWJ': ['TM', 'SONY', 'MUFG'],
    'EWD': ['ERIC', 'SPOT']
}

STOCK_METADATA = {
    'AAPL': {'name': '蘋果 (Apple)', 'country': '美國', 'market': '美股'},
    'MSFT': {'name': '微軟 (Microsoft)', 'country': '美國', 'market': '美股'},
    'NVDA': {'name': '輝達 (NVIDIA)', 'country': '美國', 'market': '美股'},
    'AMZN': {'name': '亞馬遜 (Amazon)', 'country': '美國', 'market': '美股'},
    'GOOGL': {'name': '谷歌 (Alphabet)', 'country': '美國', 'market': '美股'},
    'META': {'name': 'Meta (臉書)', 'country': '美國', 'market': '美股'},
    'TSLA': {'name': '特斯拉 (Tesla)', 'country': '美國', 'market': '美股'},
    'AVGO': {'name': '博通 (Broadcom)', 'country': '美國', 'market': '美股'},
    'COST': {'name': '好市多 (Costco)', 'country': '美國', 'market': '美股'},
    'NFLX': {'name': '網飛 (Netflix)', 'country': '美國', 'market': '美股'},
    'AMD': {'name': '超微半導體 (AMD)', 'country': '美國', 'market': '美股'},
    'QCOM': {'name': '高通 (Qualcomm)', 'country': '美國', 'market': '美股'},
    'INTC': {'name': '英特爾 (Intel)', 'country': '美國', 'market': '美股'},
    'CSCO': {'name': '思科 (Cisco)', 'country': '美國', 'market': '美股'},
    'AMAT': {'name': '應用材料 (Applied Materials)', 'country': '美國', 'market': '美股'},
    'BRK-B': {'name': '波克夏海瑟威 (Berkshire)', 'country': '美國', 'market': '美股'},
    'JPM': {'name': '摩根大通 (JPMorgan)', 'country': '美國', 'market': '美股'},
    'XOM': {'name': '埃克森美孚 (ExxonMobil)', 'country': '美國', 'market': '美股'},
    'LLY': {'name': '禮來 (Eli Lilly)', 'country': '美國', 'market': '美股'},
    'V': {'name': '威士 (Visa)', 'country': '美國', 'market': '美股'},
    'PG': {'name': '寶僑 (Procter & Gamble)', 'country': '美國', 'market': '美股'},
    'HD': {'name': '家得寶 (Home Depot)', 'country': '美國', 'market': '美股'},
    'PBR': {'name': '巴西石油 (Petrobras ADR)', 'country': '巴西', 'market': '美股ADR'},
    'VALE': {'name': '淡水河谷 (Vale ADR)', 'country': '巴西', 'market': '美股ADR'},
    'ITUB': {'name': '伊塔烏聯合銀行 (Itaú ADR)', 'country': '巴西', 'market': '美股ADR'},
    'BBD': {'name': '布拉德斯科銀行 (Bradesco ADR)', 'country': '巴西', 'market': '美股ADR'},
    'ABEV': {'name': '安貝夫 (Ambev ADR)', 'country': '巴西', 'market': '美股ADR'},
    'TSM': {'name': '台積電 (TSMC ADR)', 'country': '台灣', 'market': '美股ADR'},
    'UMC': {'name': '聯電 (UMC ADR)', 'country': '台灣', 'market': '美股ADR'},
    'ASX': {'name': '日月光投控 (ASE ADR)', 'country': '台灣', 'market': '美股ADR'},
    '005930.KS': {'name': '三星電子 (Samsung)', 'country': '韓國', 'market': '韓股'},
    '000660.KS': {'name': 'SK海力士 (SK Hynix)', 'country': '韓國', 'market': '韓股'},
    '005380.KS': {'name': '現代汽車 (Hyundai)', 'country': '韓國', 'market': '韓股'},
    '051910.KS': {'name': 'LG化學 (LG Chem)', 'country': '韓國', 'market': '韓股'},
    'AMX': {'name': '美洲電信 (América Móvil ADR)', 'country': '墨西哥', 'market': '美股ADR'},
    'FMX': {'name': '芬薩集團 (FEMSA ADR)', 'country': '墨西哥', 'market': '美股ADR'},
    'CX': {'name': '西麥斯水泥 (Cemex ADR)', 'country': '墨西哥', 'market': '美股ADR'},
    'SAP': {'name': '思愛普 (SAP ADR)', 'country': '德國', 'market': '美股ADR'},
    'SIEGY': {'name': '西門子 (Siemens ADR)', 'country': '德國', 'market': '美股ADR'},
    'BMWYY': {'name': '寶馬汽車 (BMW ADR)', 'country': '德國', 'market': '美股ADR'},
    'MBGYY': {'name': '賓士集團 (Mercedes-Benz ADR)', 'country': '德國', 'market': '美股ADR'},
    'ASML': {'name': '艾司摩爾 (ASML ADR)', 'country': '荷蘭', 'market': '美股ADR'},
    'SHEL': {'name': '殼牌石油 (Shell ADR)', 'country': '荷蘭', 'market': '美股ADR'},
    'ING': {'name': '荷蘭國際集團 (ING ADR)', 'country': '荷蘭', 'market': '美股ADR'},
    'TM': {'name': '豐田汽車 (Toyota ADR)', 'country': '日本', 'market': '美股ADR'},
    'SONY': {'name': '索尼 (Sony ADR)', 'country': '日本', 'market': '美股ADR'},
    'MUFG': {'name': '三菱日聯金融 (MUFG ADR)', 'country': '日本', 'market': '美股ADR'},
    'ERIC': {'name': '愛立信 (Ericsson ADR)', 'country': '瑞典', 'market': '美股ADR'},
    'SPOT': {'name': '聲田 (Spotify)', 'country': '瑞典', 'market': '美股'}
}

def init_db(conn):
    cursor = conn.cursor()
    cursor.execute("""
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
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS global_stock_metadata (
            ticker TEXT PRIMARY KEY,
            name TEXT,
            country TEXT,
            market TEXT
        )
    """)
    conn.commit()

def download_and_save(full_history: bool = False):
    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    cursor = conn.cursor()

    merged_meta = dict(STOCK_METADATA)
    try:
        import sync_true_domestic_stocks
        for c_etf, t_list in sync_true_domestic_stocks.DOMESTIC_UNIVERSE.items():
            for t in t_list:
                if t not in merged_meta:
                    m = sync_true_domestic_stocks.METADATA_DICT.get(t, {
                        'name': t, 'country': '美國', 'market': '美股 (NASDAQ)'
                    })
                    merged_meta[t] = {
                        'name': m.get('name', t),
                        'country': m.get('country', '美國'),
                        'market': m.get('market', '美股')
                    }
    except Exception as e:
        print(f"載入 sync_true_domestic_stocks 清單提醒: {e}")

    # 確保實盤持倉中的所有 ticker (如 MRNA, MU, 000660.KS 等) 皆納入同步範圍
    try:
        cursor.execute("SELECT ticker, name, market FROM global_sovereign_positions")
        for r_ticker, r_name, r_market in cursor.fetchall():
            if r_ticker and r_ticker not in merged_meta:
                merged_meta[r_ticker] = {
                    'name': r_name or r_ticker,
                    'country': '全球',
                    'market': r_market or '美股'
                }
    except Exception:
        pass

    # 確保 defaultGlobalSovereignData.json 中的 current_picks (如 8996.TW, 3008.TW, MRVL, ILMN 等) 也納入同步範圍
    try:
        import json
        tpl_path = os.path.join(os.path.dirname(__file__), "frontend", "src", "data", "defaultGlobalSovereignData.json")
        if os.path.exists(tpl_path):
            with open(tpl_path, "r", encoding="utf-8") as f:
                tpl_data = json.load(f)
            for pick in tpl_data.get("current_picks", []):
                pt = pick.get("ticker")
                if pt and pt not in merged_meta:
                    merged_meta[pt] = {
                        'name': pick.get("name", pt),
                        'country': '台灣' if pt.endswith('.TW') else ('韓國' if pt.endswith('.KS') else '美國'),
                        'market': pick.get("market", '台股' if pt.endswith('.TW') else '美股')
                    }
    except Exception as e:
        print(f"載入 defaultGlobalSovereignData.json 提醒: {e}")

    # 確保 SPY 與 QQQ 基準指數也一併更新
    for idx_t, idx_name in [('SPY', 'SPDR 標普500 ETF (SPY)'), ('QQQ', 'Invesco 那斯達克100 ETF (QQQ)')]:
        if idx_t not in merged_meta:
            merged_meta[idx_t] = {'name': idx_name, 'country': '美國', 'market': '美股ETF'}

    # 嚴格清除任何誤入 global_stock_daily / global_stock_metadata 之上櫃 (TPEx) .TW 股票 (如 3324.TW 等)，確保 100% 純上市 0050∪0051
    try:
        cursor.execute("""
            SELECT DISTINCT stock_id FROM daily_stock
            WHERE market_type = 'TPEx' AND length(stock_id) = 4
        """)
        tpex_tw_tickers = [f"{r[0]}.TW" for r in cursor.fetchall() if r[0]]
        for bad_t in set(tpex_tw_tickers + ["3324.TW", "5274.TW", "3293.TW", "8436.TW", "6488.TW", "8069.TW"]):
            merged_meta.pop(bad_t, None)
            cursor.execute("DELETE FROM global_stock_daily WHERE ticker = ?", (bad_t,))
            cursor.execute("DELETE FROM global_stock_metadata WHERE ticker = ?", (bad_t,))
        conn.commit()
    except Exception as e_tpex:
        print(f"清除 TPEx 上櫃標的提醒: {e_tpex}")

    # 自動納入台股最新一日 0050 ∪ 0051 (TWSE 純上市成交額前 150 大) 進入 metadata 與交叉補齊池
    try:
        cursor.execute("SELECT MAX(date) FROM daily_stock WHERE closing_price IS NOT NULL AND market_type IN ('上市', 'TWSE')")
        lat_tw_row = cursor.fetchone()
        lat_tw_date = lat_tw_row[0] if lat_tw_row and lat_tw_row[0] else None
        if lat_tw_date:
            cursor.execute("""
                SELECT stock_id, stock_name
                FROM daily_stock
                WHERE date = ?
                  AND length(stock_id) = 4
                  AND stock_id GLOB '[1-9][0-9][0-9][0-9]'
                  AND stock_id NOT LIKE '91%'
                  AND market_type IN ('上市', 'TWSE')
                  AND closing_price IS NOT NULL
                ORDER BY COALESCE(trade_value, closing_price * trade_volume) DESC
                LIMIT 150
            """, (lat_tw_date,))
            for sid_150, sname_150 in cursor.fetchall():
                t_150 = f"{sid_150}.TW"
                if t_150 not in merged_meta:
                    merged_meta[t_150] = {
                        'name': f"{sname_150} ({t_150})" if sname_150 else t_150,
                        'country': '台灣',
                        'market': '台灣證交所 (0050∪0051)'
                    }
    except Exception as e_150:
        print(f"載入台股 0050∪0051 純上市前 150 大提醒: {e_150}")

    # 確保 global_stock_daily 已存在的所有歷史 ticker (排除上櫃股) 皆納入更新，不遺漏任何一檔
    try:
        cursor.execute("""
            SELECT DISTINCT d.ticker, m.name, m.country, m.market
            FROM global_stock_daily d
            LEFT JOIN global_stock_metadata m ON d.ticker = m.ticker
        """)
        for ex_t, ex_n, ex_c, ex_m in cursor.fetchall():
            if ex_t and ex_t not in merged_meta:
                merged_meta[ex_t] = {
                    'name': ex_n or ex_t,
                    'country': ex_c or ('台灣' if ex_t.endswith('.TW') else '全球'),
                    'market': ex_m or ('台股' if ex_t.endswith('.TW') else '美股')
                }
    except Exception:
        pass

    meta_records = [
        (t, m['name'], m['country'], m['market'])
        for t, m in merged_meta.items()
    ]
    cursor.execute("DELETE FROM global_stock_metadata")
    cursor.executemany("""
        INSERT OR REPLACE INTO global_stock_metadata (ticker, name, country, market)
        VALUES (?, ?, ?, ?)
    """, meta_records)
    conn.commit()
    print(f"已更新 global_stock_metadata (共 {len(meta_records)} 檔)")

    all_tickers = sorted(list(merged_meta.keys()))
    # 台股 (.TW) 直接由本地 daily_stock 零延遲交叉同步，僅對跨國與美股標的呼叫 Yahoo Finance，大幅加速同步並避免重複抓取
    yf_tickers = [t for t in all_tickers if not t.endswith('.TW')]
    mode_label = "2000-01-01 至今完整歷史" if full_history else "近 1 個月增量 (1mo)"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 開始下載 {len(yf_tickers)} 檔美股 S&P 500 PIT 與跨國泰坦個股數據 ({mode_label})...")

    batch_size = 30
    total_saved = 0
    trailing_nan_tickers = []
    for i in range(0, len(yf_tickers), batch_size):
        batch = yf_tickers[i:i + batch_size]
        print(f"  正在下載第 {i+1}~{min(i+batch_size, len(yf_tickers))} 檔: {batch[:5]}...")
        try:
            if full_history:
                df = yf.download(batch, start="2000-01-01", auto_adjust=False, progress=False, group_by='ticker')
            else:
                df = yf.download(batch, period="1mo", auto_adjust=False, progress=False, group_by='ticker')
        except Exception as e:
            print(f"    批次下載失敗: {e}")
            continue

        records = []
        for ticker in batch:
            try:
                raw_t = df[ticker] if len(batch) > 1 else df
                if not raw_t.empty and pd.isna(raw_t.iloc[-1].get('Close')) and not ticker.endswith('.TW'):
                    trailing_nan_tickers.append(ticker)
                sub_df = raw_t.dropna(how='all')
                if sub_df.empty:
                    continue
                sub_df = sub_df.reset_index()
                date_col = 'Date' if 'Date' in sub_df.columns else sub_df.columns[0]
                for _, row in sub_df.iterrows():
                    d_str = pd.to_datetime(row[date_col]).strftime('%Y-%m-%d')
                    c_val = float(row.get('Close', 0.0)) if pd.notna(row.get('Close')) else None
                    if c_val is None:
                        continue
                    records.append((
                        ticker,
                        d_str,
                        float(row.get('Open', 0.0)) if pd.notna(row.get('Open')) else None,
                        float(row.get('High', 0.0)) if pd.notna(row.get('High')) else None,
                        float(row.get('Low', 0.0)) if pd.notna(row.get('Low')) else None,
                        c_val,
                        float(row.get('Adj Close', c_val)) if pd.notna(row.get('Adj Close')) else c_val,
                        float(row.get('Volume', 0.0)) if pd.notna(row.get('Volume')) else None
                    ))
            except Exception as e:
                print(f"    處理 {ticker} 失敗: {e}")

        if records:
            cursor.executemany("""
                INSERT OR REPLACE INTO global_stock_daily (ticker, date, open, high, low, close, adj_close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, records)
            conn.commit()
            total_saved += len(records)
            print(f"    已存入 {len(records)} 筆日K數據 (累計 {total_saved})")

    # 自動補齊 Yahoo Finance 日K結算延遲 (Close=NaN) 之最新收盤價 (透過 Yahoo Chart API meta.regularMarketPrice)
    if trailing_nan_tickers:
        try:
            import requests
            from zoneinfo import ZoneInfo
            from concurrent.futures import ThreadPoolExecutor

            def _fetch_meta_bar(t_sym: str):
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

            unique_nan_tickers = sorted(list(set(trailing_nan_tickers)))
            meta_bars = []
            with ThreadPoolExecutor(max_workers=16) as ex:
                for bar in ex.map(_fetch_meta_bar, unique_nan_tickers):
                    if bar:
                        meta_bars.append(bar)
            if meta_bars:
                cursor.executemany("""
                    INSERT OR REPLACE INTO global_stock_daily (ticker, date, open, high, low, close, adj_close, volume)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, meta_bars)
                conn.commit()
                total_saved += len(meta_bars)
                print(f"  ✓ 已透過 Yahoo 即時結算介面補齊 {len(meta_bars)} 檔跨國個股最新收盤價 (例如 {meta_bars[0][0]} {meta_bars[0][1]} = {meta_bars[0][5]})")
        except Exception as e:
            print(f"  補齊跨國個股最新結算價提醒: {e}")

    # 自動將台股 daily_stock 最新行情交叉補齊至 global_stock_daily (.TW 標的)，確保台股盤後零延遲同步
    try:
        tw_tickers = [t for t in all_tickers if t.endswith('.TW')]
        cross_records = []
        for tw_t in tw_tickers:
            sid = tw_t.split('.')[0]
            cursor.execute("""
                SELECT date, opening_price, highest_price, lowest_price, closing_price, trade_volume
                FROM daily_stock
                WHERE stock_id = ? AND closing_price IS NOT NULL
                ORDER BY date DESC LIMIT 10
            """, (sid,))
            for d_raw, o_p, h_p, l_p, c_p, vol in cursor.fetchall():
                d_s = str(d_raw).strip()
                if len(d_s) == 8 and d_s.isdigit():
                    d_fmt = f"{d_s[:4]}-{d_s[4:6]}-{d_s[6:8]}"
                else:
                    d_fmt = d_s
                c_f = float(c_p)
                cross_records.append((
                    tw_t,
                    d_fmt,
                    float(o_p) if o_p is not None else c_f,
                    float(h_p) if h_p is not None else c_f,
                    float(l_p) if l_p is not None else c_f,
                    c_f,
                    c_f,
                    float(vol) if vol is not None else 0.0
                ))
        if cross_records:
            cursor.executemany("""
                INSERT OR REPLACE INTO global_stock_daily (ticker, date, open, high, low, close, adj_close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, cross_records)
            conn.commit()
            print(f"  ✓ 已自 daily_stock 交叉補齊 {len(tw_tickers)} 檔台股 (.TW) 最新日K共 {len(cross_records)} 筆")
    except Exception as e:
        print(f"  交叉補齊台股 .TW 行情提醒: {e}")

    # 自動將 global_stock_daily 最新收盤價同步寫回 global_sovereign_positions
    try:
        cursor.execute("SELECT id, ticker FROM global_sovereign_positions")
        for pos_id, t in cursor.fetchall():
            cursor.execute("SELECT close FROM global_stock_daily WHERE ticker = ? ORDER BY date DESC LIMIT 1", (t,))
            r = cursor.fetchone()
            if r and r[0] is not None:
                cursor.execute("UPDATE global_sovereign_positions SET current_price = ? WHERE id = ?", (round(float(r[0]), 2), pos_id))
        conn.commit()
    except Exception as e:
        print(f"  同步全球泰坦持倉現價提醒: {e}")

    # 自動將 daily_stock 最新收盤價同步寫回 titan_live_positions (台股泰坦持倉)
    try:
        cursor.execute("SELECT stock_id, highest_price FROM titan_live_positions")
        for sid, hh in cursor.fetchall():
            cursor.execute("SELECT closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 1", (sid,))
            r = cursor.fetchone()
            if r and r[0] is not None:
                cur_p = round(float(r[0]), 2)
                new_hh = max(float(hh or cur_p), cur_p)
                cursor.execute("UPDATE titan_live_positions SET current_price = ?, highest_price = ? WHERE stock_id = ?", (cur_p, new_hh, sid))
        conn.commit()
    except Exception as e:
        print(f"  同步台股泰坦持倉現價提醒: {e}")

    conn.close()
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 全球泰坦個股數據下載建庫完成！總計存入 {total_saved} 筆。")

if __name__ == "__main__":
    download_and_save()

