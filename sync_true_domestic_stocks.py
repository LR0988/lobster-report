"""
Sync True Domestic Stocks Universe (各國本土真實交易所泰坦股票庫同步器)
徹底擺脫「只抓美股 ADR」的偷懶做法，直接抓取各國本土交易所真實股票：
- 美國：Nasdaq 100 全市場 94 檔成分股 (美股本土 USD)
- 台灣：台股真實本土上市櫃 20 檔龍頭與 AI 飆股 (.TW - 新台幣 TWD)
- 日本：東京證券交易所核心 (.T - 日圓 JPY)
- 德國：法蘭克福交易所核心 (.DE - 歐元 EUR)
- 韓國：首爾證券交易所核心 (.KS - 韓圓 KRW)
- 巴西：聖保羅交易所核心 (.SA - 雷亞爾 BRL)
"""

import os
import sqlite3
import yfinance as yf
import pandas as pd
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "tw_stock.db")

# 各國本土真實交易所代碼池 (對齊 S&P 500 PIT Top 160 + 台灣 0050∪0051 純上市 PIT)
DOMESTIC_UNIVERSE = {
    # 1. 美國 S&P 500 PIT 官方成分股核心池 (USD)
    'QQQ': [
        'MU', 'NVDA', 'SNDK', 'META', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'INTC', 'AMZN',
        'GOOGL', 'AVGO', 'PLTR', 'LITE', 'ORCL', 'DELL', 'MRNA', 'STX', 'WDC', 'AMAT',
        'LLY', 'CRM', 'LRCX', 'NFLX', 'WMT', 'V', 'JPM', 'CRWD', 'BRK-B', 'HOOD',
        'GEV', 'XOM', 'PANW', 'COHR', 'BAC', 'CAT', 'QCOM', 'NOW', 'GS', 'CSCO',
        'UNH', 'COST', 'JNJ', 'KLAC', 'CVX', 'TXN', 'MA', 'SMCI', 'MDT', 'MRK',
        'BA', 'GE', 'HD', 'TMO', 'KO', 'PG', 'GLW', 'MCD', 'ADI', 'IBM',
        'NKE', 'UBER', 'ACN', 'HPE', 'ABBV', 'ADBE', 'BKNG', 'C', 'WFC', 'INTU',
        'VLO', 'PEP', 'AMGN', 'ANET', 'VZ', 'TJX', 'MS', 'MPC', 'T', 'CIEN',
        'TER', 'LIN', 'APH', 'ISRG', 'SNPS', 'AXP', 'ABT', 'NEE', 'PFE', 'MPWR',
        'BSX', 'CEG', 'RTX', 'DHR', 'FCX', 'TMUS', 'DIS', 'ETN', 'COP', 'PM',
        'GILD', 'NEM', 'AZO', 'SCHW', 'VST', 'ABNB', 'DE', 'NXPI', 'DASH', 'SPGI',
        'SYK', 'CDNS', 'HWM', 'MCK', 'ON', 'PSX', 'SBUX', 'COF', 'CVS', 'FTNT',
        'UNP', 'MCHP', 'BMY', 'LMT', 'PWR', 'PYPL', 'BLK', 'SLB', 'CMCSA', 'TGT',
        'RCL', 'WELL', 'WDAY', 'FIX', 'LOW', 'HON', 'VRTX', 'FICO', 'HLT', 'PCG',
        'CMG', 'GM', 'ADP', 'HCA', 'BX', 'PH', 'CMI', 'MO', 'F', 'PGR',
        'CB', 'LULU', 'REGN', 'SHW', 'EQIX', 'KKR'
    ],
    # 2. 台灣證券交易所 0050 ∪ 0051 純上市核心代表池 (TWD，100% 排除上櫃 TPEx 如 3324.TW)
    'EWT': [
        '2330.TW', '2454.TW', '2317.TW', '3231.TW', '2382.TW', '3017.TW', '2345.TW',
        '3661.TW', '6669.TW', '2308.TW', '2379.TW', '3037.TW', '2603.TW', '2412.TW',
        '2881.TW', '2882.TW', '2356.TW', '2376.TW', '3008.TW', '3443.TW', '1519.TW',
        '2383.TW', '3711.TW', '3036.TW', '6415.TW', '2059.TW', '6805.TW', '3034.TW'
    ],
    # 3. 韓國首爾證券交易所本土代表池 (KRW)
    'EWY': [
        '005930.KS', '000660.KS', '005380.KS', '035420.KS', '000270.KS', '051910.KS'
    ],
    # 4. 德國法蘭克福交易所本土代表池 (EUR)
    'EWG': [
        'RHM.DE', 'SAP.DE', 'SIE.DE', 'ALV.DE', 'AIR.DE', 'DTG.DE', 'MBG.DE'
    ],
    # 5. 日本東京證券交易所本土代表池 (JPY)
    'EWJ': [
        '6857.T', '8035.T', '9984.T', '7203.T', '6758.T', '6501.T', '4063.T', '8058.T'
    ],
    # 6. 巴西聖保羅交易所本土代表池 (BRL)
    'EWZ': [
        'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'WEGE3.SA', 'ABEV3.SA'
    ]
}

# 建立中英文名稱與國別貨幣字典
METADATA_DICT = {
    # 台灣 (TWSE 純上市 0050 ∪ 0051)
    '2330.TW': {'name': '台積電 (TSMC)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2454.TW': {'name': '聯發科 (MediaTek)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2317.TW': {'name': '鴻海 (Foxconn)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3231.TW': {'name': '緯創 (Wistron)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2382.TW': {'name': '廣達 (Quanta)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3017.TW': {'name': '奇鋐 (CCI)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2345.TW': {'name': '智邦 (Accton)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3661.TW': {'name': '世芯-KY (Alchip)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '6669.TW': {'name': '緯穎 (Wiwynn)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2308.TW': {'name': '台達電 (Delta)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2379.TW': {'name': '瑞昱 (Realtek)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3037.TW': {'name': '欣興 (Unimicron)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2603.TW': {'name': '長榮 (Evergreen)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2412.TW': {'name': '中華電 (Chunghwa)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2881.TW': {'name': '富邦金 (Fubon)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2882.TW': {'name': '國泰金 (Cathay)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2356.TW': {'name': '英業達 (Inventec)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2376.TW': {'name': '技嘉 (GIGABYTE)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3008.TW': {'name': '大立光 (Largan)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3443.TW': {'name': '創意 (Global Unichip)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '1519.TW': {'name': '華城 (Fortune Electric)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2383.TW': {'name': '台光電 (EMC)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3711.TW': {'name': '日月光投控 (ASE)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3036.TW': {'name': '文曄 (WT Micro)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '6415.TW': {'name': '矽力*-KY (Silergy)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '2059.TW': {'name': '川湖 (King Slide)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '6805.TW': {'name': '富世達 (Fositek)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},
    '3034.TW': {'name': '聯詠 (Novatek)', 'country': '台灣', 'market': '台灣證交所 (0050∪0051)', 'currency': 'TWD'},

    # 韓國 (KRX)
    '000660.KS': {'name': 'SK海力士 (SK Hynix)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},
    '005930.KS': {'name': '三星電子 (Samsung)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},
    '005380.KS': {'name': '現代汽車 (Hyundai)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},
    '035420.KS': {'name': 'NAVER (網路巨頭)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},
    '000270.KS': {'name': '起亞汽車 (Kia)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},
    '051910.KS': {'name': 'LG化學 (LG Chem)', 'country': '韓國', 'market': '首爾交易所', 'currency': 'KRW'},

    # 德國 (Xetra)
    'RHM.DE': {'name': '萊茵金屬 (Rheinmetall - 歐洲軍工之王)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'SAP.DE': {'name': '思愛普 (SAP 軟體巨頭)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'SIE.DE': {'name': '西門子 (Siemens 工業巨頭)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'ALV.DE': {'name': '安聯保險 (Allianz)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'AIR.DE': {'name': '空中巴士 (Airbus)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'DTG.DE': {'name': '戴姆勒卡車 (Daimler Truck)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},
    'MBG.DE': {'name': '賓士集團 (Mercedes-Benz)', 'country': '德國', 'market': '法蘭克福交易所', 'currency': 'EUR'},

    # 日本 (TSE)
    '6857.T': {'name': '愛德萬測試 (Advantest 半導體設備)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '8035.T': {'name': '東京威力科創 (TEL 半導體設備)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '9984.T': {'name': '軟銀集團 (SoftBank AI投資巨擘)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '7203.T': {'name': '豐田汽車 (Toyota)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '6758.T': {'name': '索尼 (Sony 娛樂半導體)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '6501.T': {'name': '日立製作所 (Hitachi)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '4063.T': {'name': '信越化學 (Shin-Etsu 矽晶圓霸主)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},
    '8058.T': {'name': '三菱商事 (Mitsubishi 巴菲特五大商社)', 'country': '日本', 'market': '東京交易所', 'currency': 'JPY'},

    # 巴西 (B3)
    'PETR4.SA': {'name': '巴西石油 (Petrobras 本土優先股)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'},
    'VALE3.SA': {'name': '淡水河谷 (Vale 本土鐵礦巨頭)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'},
    'ITUB4.SA': {'name': '伊塔烏聯合銀行 (Itaú Unibanco)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'},
    'BBDC4.SA': {'name': '布拉德斯科銀行 (Bradesco)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'},
    'WEGE3.SA': {'name': '萬高電機 (WEG 工業馬達巨頭)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'},
    'ABEV3.SA': {'name': '安貝夫啤酒 (Ambev)', 'country': '巴西', 'market': '聖保羅交易所', 'currency': 'BRL'}
}

def sync_true_domestic_stocks(full_history: bool = False):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 建立所有代碼名單
    all_tickers = []
    for c_etf, t_list in DOMESTIC_UNIVERSE.items():
        all_tickers.extend(t_list)
    all_tickers = sorted(list(set(all_tickers)))

    period_str = "2003年至今 (23年歷史全量)" if full_history else "1mo (增量)"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 開始下載各國本土真實交易所 {len(all_tickers)} 檔股票數據 (週期: {period_str})...")

    # 更新 Metadata
    meta_records = []
    for t in all_tickers:
        meta = METADATA_DICT.get(t, {
            'name': t,
            'country': '美國',
            'market': '那斯達克',
            'currency': 'USD'
        })
        meta_records.append((t, meta['name'], meta['country'], meta['market'], meta.get('currency', 'USD')))

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS global_domestic_metadata (
            ticker TEXT PRIMARY KEY,
            name TEXT,
            country TEXT,
            market TEXT,
            currency TEXT
        )
    """)
    cursor.execute("DELETE FROM global_domestic_metadata")
    cursor.executemany("""
        INSERT OR REPLACE INTO global_domestic_metadata (ticker, name, country, market, currency)
        VALUES (?, ?, ?, ?, ?)
    """, meta_records)
    conn.commit()
    conn.close()

    # 統一委派給 sync_global_titan_stocks 執行 S&P 500 PIT + 台股 0050∪0051 純上市交叉補齊與實盤持倉更新
    import sync_global_titan_stocks
    sync_global_titan_stocks.download_and_save(full_history=full_history)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 各國本土真實交易所股票建庫完成！")

if __name__ == "__main__":
    sync_true_domestic_stocks()
