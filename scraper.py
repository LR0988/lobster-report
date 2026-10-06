import sqlite3
import json
import time
import random
import requests
import urllib3
from datetime import datetime, timedelta
import logging
from bs4 import BeautifulSoup

# 停用 SSL 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

import os
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, 'tw_stock.db')

# 常見瀏覽器 User-Agent
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
]

# 欄位映射
TWSE_MAPPING = {
    'stock_id': ['證券代號'],
    'stock_name': ['證券名稱'],
    'trade_volume': ['成交股數'],
    'transaction_count': ['成交筆數'],
    'trade_value': ['成交金額'],
    'opening_price': ['開盤價'],
    'highest_price': ['最高價'],
    'lowest_price': ['最低價'],
    'closing_price': ['收盤價'],
    'change_sign': ['漲跌(+/-)', '漲跌'],
    'change_price': ['漲跌價差'],
    'last_bid_price': ['最後揭示買價'],
    'last_bid_volume': ['最後揭示買量'],
    'last_ask_price': ['最後揭示賣價'],
    'last_ask_volume': ['最後揭示賣量'],
    'pe_ratio': ['本益比', 'TWSE_PE'],
    'pb_ratio': ['股價淨值比'],
    'yield_ratio': ['殖利率(%)']
}

TPEX_MAPPING = {
    'stock_id': ['代號'],
    'stock_name': ['名稱'],
    'trade_volume': ['成交股數'],
    'transaction_count': ['成交筆數', '筆數'],
    'trade_value': ['成交金額(元)'],
    'opening_price': ['開盤'],
    'highest_price': ['最高'],
    'lowest_price': ['最低'],
    'closing_price': ['收盤'],
    'change_sign': ['漲跌'],
    'change_price': ['漲跌'],
    'last_bid_price': ['最後買價'],
    'last_bid_volume': ['最後買量<br>(張數)', '最後買量(千股)'],
    'last_ask_price': ['最後賣價'],
    'last_ask_volume': ['最後賣量<br>(張數)', '最後賣量(千股)'],
    'pe_ratio': ['本益比'],
    'pb_ratio': ['股價淨值比'],
    'yield_ratio': ['殖利率(%)']
}

def get_db_connection(timeout=60.0):
    conn = sqlite3.connect(DB_NAME, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=60000;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS daily_stock (
            date TEXT, stock_id TEXT, stock_name TEXT, trade_volume INTEGER,
            transaction_count INTEGER, trade_value INTEGER, opening_price REAL,
            highest_price REAL, lowest_price REAL, closing_price REAL,
            change_sign TEXT, change_price REAL, last_bid_price REAL,
            last_bid_volume INTEGER, last_ask_price REAL, last_ask_volume INTEGER,
            pe_ratio REAL, pb_ratio REAL, yield_ratio REAL, market_type TEXT,
            PRIMARY KEY (date, stock_id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS monthly_revenue (
            revenue_date TEXT, stock_id TEXT, stock_name TEXT, industry TEXT,
            current_month_rev INTEGER, last_month_rev INTEGER, last_year_rev INTEGER,
            mom REAL, yoy REAL, accumulated_rev INTEGER,
            PRIMARY KEY (revenue_date, stock_id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS institutional_trades (
            date TEXT, stock_id TEXT, foreign_net INTEGER, trust_net INTEGER, dealer_net INTEGER,
            PRIMARY KEY (date, stock_id)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS institutional_futures (
            date TEXT, investor_type TEXT, contract_name TEXT, 
            long_qty INTEGER, long_amt INTEGER, 
            short_qty INTEGER, short_amt INTEGER, 
            net_qty INTEGER,
            PRIMARY KEY (date, investor_type, contract_name)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shareholder_concentration (
            date TEXT, stock_id TEXT, level INTEGER, 
            holders INTEGER, shares INTEGER, proportion REAL,
            PRIMARY KEY (date, stock_id, level)
        )
    ''')
    cols = {
        'pe_ratio': 'REAL', 'pb_ratio': 'REAL', 'yield_ratio': 'REAL', 'market_type': 'TEXT',
        'margin_buy': 'INTEGER', 'margin_sell': 'INTEGER', 'margin_balance': 'INTEGER',
        'short_buy': 'INTEGER', 'short_sell': 'INTEGER', 'short_balance': 'INTEGER'
    }
    for c, t in cols.items():
        try: cursor.execute(f"ALTER TABLE daily_stock ADD COLUMN {c} {t}")
        except: pass
    conn.commit()
    conn.close()

def get_missing_dates(target_start_date=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    end_date = datetime.now()
    # 如果當前時間在 14:00 之前，代表今天的股市資料尚未公布，我們最多只比對到昨天
    if end_date.hour < 14:
        end_date = end_date - timedelta(days=1)
    if target_start_date:
        start_date = datetime.strptime(target_start_date, '%Y-%m-%d') if isinstance(target_start_date, str) else target_start_date
    else:
        # 自動尋找資料庫中「完整具有上市與上櫃資料」的最新日期，並往前推 7 天以防有任何漏抓或中斷的交易日
        try:
            cursor.execute("SELECT date FROM daily_stock GROUP BY date HAVING COUNT(DISTINCT market_type) >= 2 ORDER BY date DESC LIMIT 1")
            row = cursor.fetchone()
            if row and row[0]:
                start_date = datetime.strptime(row[0], '%Y%m%d') - timedelta(days=7)
            else:
                cursor.execute("SELECT MAX(date) FROM daily_stock")
                max_date = cursor.fetchone()[0]
                if max_date:
                    start_date = datetime.strptime(max_date, '%Y%m%d') - timedelta(days=7)
                else:
                    start_date = end_date - timedelta(days=90)
        except:
            start_date = end_date - timedelta(days=90)
    all_dates = []
    curr = start_date
    while curr <= end_date:
        if curr.weekday() < 5: all_dates.append(curr.strftime('%Y%m%d'))
        curr += timedelta(days=1)
    cursor.execute("SELECT date FROM daily_stock GROUP BY date HAVING COUNT(DISTINCT market_type) >= 2")
    daily_dates = set([r[0] for r in cursor.fetchall()])
    cursor.execute("SELECT date FROM institutional_trades GROUP BY date")
    inst_dates = set([r[0] for r in cursor.fetchall()])
    conn.close()
    return [d for d in all_dates if (d not in daily_dates) or (d not in inst_dates)]

def fetch_twse(date_str):
    url = f"https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date={date_str}&type=ALLBUT0999"
    headers = {"User-Agent": random.choice(USER_AGENTS), "Referer": "https://www.twse.com.tw/zh/page/trading/exchange/MI_INDEX.html"}
    try:
        resp = requests.get(url, headers=headers, timeout=15, verify=False)
        data = resp.json()
        if data.get('stat') != 'OK': return None
        target_fields, target_data = None, None
        for table in data.get('tables', []):
            if '證券代號' in table.get('fields', []):
                target_fields, target_data = table['fields'], table.get('data', [])
                break
        if target_fields and target_data:
            bw_url = f"https://www.twse.com.tw/exchangeReport/BWIBBU_ALL?response=json&date={date_str}"
            try:
                bw_resp = requests.get(bw_url, headers=headers, timeout=15, verify=False)
                bw_data = bw_resp.json()
                if bw_data.get('stat') == 'OK' and bw_data.get('data'):
                    bw_fields = bw_data.get('fields', [])
                    idx_id = bw_fields.index('股票代號') if '股票代號' in bw_fields else -1
                    idx_pe = bw_fields.index('本益比') if '本益比' in bw_fields else -1
                    idx_pb = bw_fields.index('股價淨值比') if '股價淨值比' in bw_fields else -1
                    idx_yld = bw_fields.index('殖利率(%)') if '殖利率(%)' in bw_fields else -1
                    bw_dict = {str(r[idx_id]).strip(): (r[idx_pe], r[idx_pb], r[idx_yld]) for r in bw_data['data'] if idx_id != -1}
                    target_fields.extend(['TWSE_PE', '股價淨值比', '殖利率(%)'])
                    id_idx = [f.strip() for f in target_fields].index('證券代號')
                    for row in target_data:
                        pe, pb, yld = bw_dict.get(str(row[id_idx]).strip(), ('', '', ''))
                        row.extend([pe, pb, yld])
            except: pass
            return target_fields, target_data
    except: return False

def fetch_tpex(date_str):
    y = int(date_str[:4]) - 1911
    roc_date = f"{y}/{date_str[4:6]}/{date_str[6:8]}"
    url = f"https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d={roc_date}&se=AL&_={int(time.time()*1000)}"
    headers = {"User-Agent": random.choice(USER_AGENTS), "Referer": "https://www.tpex.org.tw/zh-tw/mainboard/trading/aftertrading/daily-quotes.html"}
    try:
        resp = requests.get(url, headers=headers, timeout=15, verify=False)
        data = resp.json()
        target_fields, target_data = None, None
        for table in data.get('tables', []):
            if '代號' in [f.strip() for f in table.get('fields', [])]:
                target_fields, target_data = table['fields'], table.get('data', [])
                break
        if target_fields and target_data:
            pe_url = f"https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&d={roc_date}&_={int(time.time()*1000)}"
            try:
                pe_resp = requests.get(pe_url, headers=headers, timeout=15, verify=False)
                pe_json = pe_resp.json()
                for table in pe_json.get('tables', []):
                    f_s = [f.strip().replace(' ', '') for f in table.get('fields', [])]
                    if '股票代號' in f_s:
                        idx_id, idx_pe, idx_pb, idx_yld = f_s.index('股票代號'), f_s.index('本益比'), f_s.index('股價淨值比'), f_s.index('殖利率(%)')
                        pe_dict = {str(r[idx_id]).strip(): (r[idx_pe], r[idx_pb], r[idx_yld]) for r in table.get('data', [])}
                        target_fields.extend(['本益比', '股價淨值比', '殖利率(%)'])
                        id_idx = [f.strip() for f in target_fields].index('代號')
                        for row in target_data:
                            pe, pb, yld = pe_dict.get(str(row[id_idx]).strip(), ('', '', ''))
                            row.extend([pe, pb, yld])
                        break
            except: pass
            return target_fields, target_data
    except: return False

def parse_and_insert_daily(date_str, data_list, fields, mapping, market_type):
    fields_s = [str(f).strip().replace(' ', '') for f in fields]
    col_idx = {}
    for k, aliases in mapping.items():
        for a in aliases:
            ca = a.strip().replace(' ', '')
            if ca in fields_s:
                col_idx[k] = fields_s.index(ca)
                break
    conn = get_db_connection()
    cursor = conn.cursor()
    for row in data_list:
        try:
            def get_val(key, type_cast):
                idx = col_idx.get(key)
                if idx is None or idx >= len(row): return None
                val = str(row[idx]).replace(',', '').strip()
                if val in ['', '--', '---']: return None
                if type_cast == 'float':
                    if '<' in val: val = BeautifulSoup(val, 'html.parser').text.strip()
                    try: return float(val)
                    except: return None
                if type_cast == 'int':
                    try: return int(float(val))
                    except: return None
                if key == 'change_sign':
                    if 'red' in val or '+' in val: return '+'
                    if 'green' in val or '-' in val: return '-'
                    return ''
                return val
            sid = get_val('stock_id', 'str')
            if not sid or len(sid) > 6: continue
            cursor.execute('''
                INSERT OR REPLACE INTO daily_stock 
                (date, stock_id, stock_name, trade_volume, transaction_count, trade_value, 
                 opening_price, highest_price, lowest_price, closing_price, change_sign, change_price,
                 last_bid_price, last_bid_volume, last_ask_price, last_ask_volume, pe_ratio, pb_ratio, yield_ratio, market_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (date_str, sid, get_val('stock_name', 'str'), get_val('trade_volume', 'int'),
                  get_val('transaction_count', 'int'), get_val('trade_value', 'int'),
                  get_val('opening_price', 'float'), get_val('highest_price', 'float'),
                  get_val('lowest_price', 'float'), get_val('closing_price', 'float'),
                  get_val('change_sign', 'str'), get_val('change_price', 'float'),
                  get_val('last_bid_price', 'float'), get_val('last_bid_volume', 'int'),
                  get_val('last_ask_price', 'float'), get_val('last_ask_volume', 'int'),
                  get_val('pe_ratio', 'float'), get_val('pb_ratio', 'float'), get_val('yield_ratio', 'float'), market_type))
        except: continue
    conn.commit()
    conn.close()

def scrape_mops_revenue_month(year, month):
    roc_y = year - 1911
    session = requests.Session()
    session.verify = False
    headers = {'User-Agent': random.choice(USER_AGENTS)}
    total = 0
    conn = get_db_connection()
    cursor = conn.cursor()
    for m_key in ['sii', 'otc']:
        try:
            url_main = 'https://mops.twse.com.tw/mops/web/t21sc04_ifrs'
            url_ajax = 'https://mops.twse.com.tw/mops/web/ajax_t21sc04_ifrs'
            session.get(url_main, headers=headers, timeout=20)
            time.sleep(2)
            payload = {'encodeURIComponent': '1', 'step': '1', 'firstin': '1', 'off': '1', 'TYPEK': m_key, 'year': str(roc_y), 'month': f"{month:02d}"}
            resp = session.post(url_ajax, data=payload, headers={'Referer': url_main, 'User-Agent': headers['User-Agent']}, timeout=30)
            soup = BeautifulSoup(resp.text, 'html.parser')
            tables = soup.find_all('table', class_='hasBorder') or [t for t in soup.find_all('table') if "公司代號" in t.text]
            for table in tables:
                for row in table.find_all('tr'):
                    tds = row.find_all('td')
                    if len(tds) >= 10:
                        try:
                            sid = tds[0].text.strip()
                            if not sid.isdigit(): continue
                            cur, last, last_y = int(tds[2].text.strip().replace(',', '') or 0), int(tds[3].text.strip().replace(',', '') or 0), int(tds[4].text.strip().replace(',', '') or 0)
                            mom, yoy, acc = float(tds[5].text.strip().replace(',', '') or 0), float(tds[6].text.strip().replace(',', '') or 0), int(tds[7].text.strip().replace(',', '') or 0)
                            cursor.execute("INSERT OR REPLACE INTO monthly_revenue (revenue_date, stock_id, stock_name, current_month_rev, last_month_rev, last_year_rev, mom, yoy, accumulated_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (f"{roc_y}{month:02d}", sid, tds[1].text.strip(), cur, last, last_y, mom, yoy, acc))
                            total += 1
                        except: continue
            conn.commit()
            time.sleep(5)
        except: pass
    conn.close()
    return total

def fetch_and_save_revenue(start_date=None):
    total = 0
    urls = [('TWSE', 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'), ('TPEx', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O')]
    conn = get_db_connection()
    cursor = conn.cursor()
    for m, url in urls:
        try:
            resp = requests.get(url, timeout=20, verify=False)
            for item in resp.json():
                try:
                    cursor.execute("INSERT OR REPLACE INTO monthly_revenue (revenue_date, stock_id, stock_name, industry, current_month_rev, last_month_rev, last_year_rev, mom, yoy, accumulated_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (item.get('資料年月'), item.get('公司代號'), item.get('公司名稱'), item.get('產業別'), int(item.get('營業收入-當月營收', 0)), int(item.get('營業收入-上月營收', 0)), int(item.get('營業收入-去年當月營收', 0)), float(item.get('營業收入-上月比較增減(%)', 0)), float(item.get('營業收入-去年同月增減(%)', 0)), int(item.get('累計營業收入-當月累計營收', 0))))
                    total += 1
                except: continue
            conn.commit()
        except: pass
    conn.close()
    if start_date:
        curr = datetime.strptime(start_date, '%Y-%m-%d') if isinstance(start_date, str) else start_date
        today = datetime.now()
        while curr <= today:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM monthly_revenue WHERE revenue_date = ?", (f"{curr.year-1911}{curr.month:02d}",))
            if cursor.fetchone()[0] < 500:
                logging.info(f"正在補齊 {curr.year}/{curr.month} 營收...")
                total += scrape_mops_revenue_month(curr.year, curr.month)
            conn.close()
            if curr.month == 12: curr = curr.replace(year=curr.year+1, month=1)
            else: curr = curr.replace(month=curr.month+1)
    return total

def fetch_twse_inst(date_str):
    url = f"https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date={date_str}&selectType=ALLBUT0999"
    headers = {"User-Agent": random.choice(USER_AGENTS), "Referer": "https://www.twse.com.tw/zh/page/trading/fund/T86.html"}
    try:
        resp = requests.get(url, headers=headers, timeout=20, verify=False)
        data = resp.json()
        if data.get('stat') != 'OK' or 'data' not in data: return None
        fields = [f.strip().replace(' ', '') for f in data.get('fields', [])]
        idx_id = fields.index('證券代號')
        idx_f, idx_t, idx_d = -1, -1, -1
        for i, f in enumerate(fields):
            if ('外資' in f or '外陸資' in f) and '買賣超' in f and idx_f == -1: idx_f = i
            elif '投信' in f and '買賣超' in f and idx_t == -1: idx_t = i
            elif '自營商' in f and '買賣超' in f:
                if '合計' in f or idx_d == -1: idx_d = i
        if -1 in [idx_f, idx_t, idx_d]: return None
        return [(date_str, r[idx_id].strip(), int(str(r[idx_f]).replace(',', '')), int(str(r[idx_t]).replace(',', '')), int(str(r[idx_d]).replace(',', ''))) for r in data['data']]
    except: return False

def fetch_tpex_inst(date_str):
    y = int(date_str[:4]) - 1911
    roc_date = f"{y}/{date_str[4:6]}/{date_str[6:8]}"
    url = f"https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=AL&t=D&d={roc_date}&_={int(time.time()*1000)}"
    try:
        resp = requests.get(url, headers={"User-Agent": random.choice(USER_AGENTS)}, timeout=20, verify=False)
        data = resp.json()
        tables = data.get('tables', [])
        if not tables or not tables[0].get('data'): return None
        return [(date_str, r[0].strip(), int(str(r[10]).replace(',', '')), int(str(r[13]).replace(',', '')), int(str(r[22]).replace(',', ''))) for r in tables[0]['data']]
    except Exception as e:
        logging.error(f"fetch_tpex_inst error: {e}")
        return False

def insert_inst_trades(data_list):
    if not data_list: return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.executemany("INSERT OR REPLACE INTO institutional_trades (date, stock_id, foreign_net, trust_net, dealer_net) VALUES (?, ?, ?, ?, ?)", data_list)
    conn.commit()
    conn.close()

def fetch_twse_margin(date_str):
    url = f"https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date={date_str}&selectType=ALL"
    headers = {"User-Agent": random.choice(USER_AGENTS), "Referer": "https://www.twse.com.tw/zh/page/trading/exchange/MI_MARGN.html"}
    try:
        resp = requests.get(url, headers=headers, timeout=20, verify=False)
        data = resp.json()
        if data.get('stat') != 'OK' or 'data' not in data: return None
        return [(date_str, r[0].strip(), int(str(r[2]).replace(',', '')), int(str(r[3]).replace(',', '')), int(str(r[6]).replace(',', '')), int(str(r[8]).replace(',', '')), int(str(r[9]).replace(',', '')), int(str(r[12]).replace(',', ''))) for r in data['data']]
    except: return False

def fetch_tpex_margin(date_str):
    y = int(date_str[:4]) - 1911
    roc_date = f"{y}/{date_str[4:6]}/{date_str[6:8]}"
    url = f"https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&d={roc_date}&_={int(time.time()*1000)}"
    try:
        resp = requests.get(url, headers={"User-Agent": random.choice(USER_AGENTS)}, timeout=20, verify=False)
        data = resp.json()
        tables = data.get('tables', [])
        if not tables or not tables[0].get('data'): return None
        return [(date_str, r[0].strip(), int(str(r[3]).replace(',', '')), int(str(r[4]).replace(',', '')), int(str(r[6]).replace(',', '')), int(str(r[12]).replace(',', '')), int(str(r[11]).replace(',', '')), int(str(r[14]).replace(',', ''))) for r in tables[0]['data']]
    except Exception as e:
        logging.error(f"fetch_tpex_margin error: {e}")
        return False

def insert_margin_data(data_list):
    if not data_list: return
    conn = get_db_connection()
    cursor = conn.cursor()
    for row in data_list:
        cursor.execute('UPDATE daily_stock SET margin_buy=?, margin_sell=?, margin_balance=?, short_buy=?, short_sell=?, short_balance=? WHERE date=? AND stock_id=?', (row[2], row[3], row[4], row[5], row[6], row[7], row[0], row[1]))
    conn.commit()
    conn.close()

def fetch_taifex_futures(date_str):
    """抓取期交所三大法人期貨未平倉 (包含大盤與個股期貨)"""
    y, m, d = date_str[:4], date_str[4:6], date_str[6:8]
    url = f"https://www.taifex.com.tw/cht/3/futContractsDate?queryDate={y}/{m}/{d}"
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    try:
        resp = requests.get(url, headers=headers, timeout=20, verify=False)
        resp.encoding = 'utf-8'
        if "查無資料" in resp.text: return None
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        rows = soup.find_all('tr')
        res = []
        current_contract = ""
        
        for row in rows:
            tds = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
            if not tds: continue
            
            # 商品名稱通常在 tds[1] (如果有序號) 或是 tds[0] (如果是新區塊第一行)
            # 我們搜尋包含 '期貨' 的字眼
            for val in tds[:3]:
                if "期貨" in val and "合計" not in val:
                    current_contract = val
                    break
            
            # 身份別
            for target_inv in ["自營商", "投信", "外資"]:
                if target_inv in tds:
                    try:
                        # 未平倉量通常在倒數第 6, 4, 2 欄 (多, 空, 淨)
                        long_qty = int(tds[-6].replace(',', ''))
                        short_qty = int(tds[-4].replace(',', ''))
                        net_qty = int(tds[-2].replace(',', ''))
                        
                        # 過濾掉 0 的部位節省空間
                        if long_qty == 0 and short_qty == 0 and net_qty == 0: continue
                        
                        res.append((date_str, target_inv, current_contract, 0, 0, long_qty, short_qty, net_qty))
                    except: continue
        return res
    except: return False

def insert_futures_data(data_list):
    if not data_list: return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.executemany('INSERT OR REPLACE INTO institutional_futures (date, investor_type, contract_name, long_qty, long_amt, short_qty, short_amt, net_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', data_list)
    conn.commit()
    conn.close()

import subprocess
import os

def import_tdcc_csv(file_path):
    """手動匯入集保 CSV 檔案 (支援歷史資料)"""
    if not os.path.exists(file_path): return 0
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        count = 0
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            for line in lines[1:]:
                p = line.strip().split(',')
                if len(p) >= 6:
                    try:
                        # 欄位: 資料日期,證券代號,持股分級,人數,股數,持股比例
                        cursor.execute("INSERT OR REPLACE INTO shareholder_concentration (date, stock_id, level, holders, shares, proportion) VALUES (?, ?, ?, ?, ?, ?)", 
                                       (p[0], p[1], int(p[2]), int(p[3]), int(p[4]), float(p[5])))
                        count += 1
                    except: continue
        conn.commit()
        conn.close()
        return count
    except Exception as e:
        logging.error(f"匯入 TDCC CSV 失敗: {e}")
        return 0

def scrape_tdcc_historical_stock(stock_id, date_str):
    """抓取單一股票特定日期的集保分級 (歷史資料補齊用)"""
    url = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock.do"
    session = requests.Session()
    session.verify = False
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock",
    }
    try:
        # 先 GET 建立 Session
        session.get("https://www.tdcc.com.tw/portal/zh/smWeb/qryStock", headers=headers, timeout=10)
        payload = {
            'scaDates': date_str, 'scaDate': date_str, 'sqlMethod': 'StockNo',
            'stockNo': stock_id, 'stockName': '', 'CharSearch': '', 'method': 'getInScaDate'
        }
        resp = session.post(url, data=payload, headers=headers, timeout=20)
        resp.encoding = 'utf-8'
        soup = BeautifulSoup(resp.text, 'html.parser')
        tables = soup.find_all('table')
        target = None
        for t in tables:
            if "持股分級" in t.text:
                target = t
                break
        if not target: return 0
        
        conn = get_db_connection()
        cursor = conn.cursor()
        count = 0
        for row in target.find_all('tr'):
            tds = row.find_all('td')
            if len(tds) >= 5:
                try:
                    level = int(tds[0].text.strip())
                    holders = int(tds[2].text.strip().replace(',', ''))
                    shares = int(tds[3].text.strip().replace(',', ''))
                    prop = float(tds[4].text.strip().replace(',', ''))
                    cursor.execute("INSERT OR REPLACE INTO shareholder_concentration (date, stock_id, level, holders, shares, proportion) VALUES (?, ?, ?, ?, ?, ?)",
                                   (date_str, stock_id, level, holders, shares, prop))
                    count += 1
                except: continue
        conn.commit()
        conn.close()
        return count
    except: return 0

def fetch_tdcc_concentration(target_date=None):
    """
    抓取集保股權分散表。
    使用 curl -L 解決 Python requests 的重導向問題。
    """
    if target_date is not None:
        # 這裡不自動跑全市場，因為會太慢且容易被鎖
        logging.info(f"自動補齊歷史集保暫不支援全市場，請使用個股補齊功能。")
        return 0

    url = "https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5"
    tmp_file = "tdcc_latest.csv"
    try:
        logging.info("正在透過 curl 下載最新集保股權分散表...")
        cmd = [
            "curl", "-L", "-k", "-s",
            "-A", random.choice(USER_AGENTS),
            "-o", tmp_file,
            url
        ]
        subprocess.run(cmd, check=True)
        
        if os.path.exists(tmp_file) and os.path.getsize(tmp_file) > 10000:
            count = import_tdcc_csv(tmp_file)
            logging.info(f"集保資料下載完成，共匯入 {count} 筆。")
            os.remove(tmp_file)
            return count
        else:
            logging.error("TDCC 下載檔案無效或過小。")
            return 0
    except Exception as e:
        logging.error(f"TDCC 抓取失敗 (curl): {e}")
        return 0

def fetch_yahoo_news(stock_id):
    url = f"https://tw.stock.yahoo.com/quote/{stock_id}/news"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Referer": "https://tw.stock.yahoo.com/"
    }
    
    try:
        logging.info(f"正在爬取 {stock_id} 的 Yahoo 新聞...")
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            logging.error(f"無法取得 Yahoo 新聞，狀態碼: {res.status_code}")
            return []
            
        soup = BeautifulSoup(res.text, 'html.parser')
        news_list = []
        
        # 搜尋包含新聞連結的 a 標籤
        for a in soup.find_all('a', href=True):
            href = a['href']
            title = a.text.strip()
            
            if '/news/' in href and title:
                if len(title) < 6:
                    continue
                if title in [n['title'] for n in news_list]:
                    continue
                    
                full_url = href
                if not href.startswith('http'):
                    full_url = 'https://tw.stock.yahoo.com' + href
                    
                news_list.append({
                    "title": title,
                    "link": full_url
                })
                
                if len(news_list) >= 5:
                    break
        return news_list
    except Exception as e:
        logging.error(f"爬取新聞失敗: {e}")
        return []

def fetch_ptt_sentiment(stock_id):
    url = f"https://www.ptt.cc/bbs/Stock/search?q={stock_id}"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Cookie": "over18=1"
    }
    try:
        logging.info(f"正在爬取 {stock_id} 的 PTT 討論區標題...")
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code != 200:
            logging.error(f"無法取得 PTT 網頁，狀態碼: {res.status_code}")
            return []
            
        soup = BeautifulSoup(res.text, 'html.parser')
        posts = []
        
        for div in soup.find_all('div', class_='title'):
            a = div.find('a')
            if a:
                title = a.text.strip()
                link = "https://www.ptt.cc" + a['href']
                posts.append({
                    "title": title,
                    "link": link
                })
                if len(posts) >= 10:
                    break
        return posts
    except Exception as e:
        logging.error(f"爬取 PTT 討論失敗: {e}")
        return []


def main(start_date=None):
    init_db()
    for date_str in get_missing_dates(target_start_date=start_date):
        logging.info(f"正在抓取 {date_str} 資料...")
        time.sleep(random.uniform(3, 6))
        r1 = fetch_twse(date_str)
        if r1: parse_and_insert_daily(date_str, r1[1], r1[0], TWSE_MAPPING, 'TWSE')
        time.sleep(random.uniform(3, 6))
        r2 = fetch_tpex(date_str)
        if r2: parse_and_insert_daily(date_str, r2[1], r2[0], TPEX_MAPPING, 'TPEx')
        time.sleep(random.uniform(3, 6))
        i1 = fetch_twse_inst(date_str)
        if i1: insert_inst_trades(i1)
        time.sleep(random.uniform(3, 6))
        i2 = fetch_tpex_inst(date_str)
        if i2: insert_inst_trades(i2)
        time.sleep(random.uniform(3, 6))
        m1 = fetch_twse_margin(date_str)
        if m1: insert_margin_data(m1)
        time.sleep(random.uniform(3, 6))
        m2 = fetch_tpex_margin(date_str)
        if m2: insert_margin_data(m2)
        time.sleep(random.uniform(3, 6))
        f1 = fetch_taifex_futures(date_str)
        if f1: insert_futures_data(f1)
        if r1 is None and r2 is None:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("INSERT OR IGNORE INTO daily_stock (date, stock_id, market_type) VALUES (?, ?, ?)", (date_str, 'HOLIDAY', 'NONE'))
            conn.commit()
            conn.close()
    
    # 每週一次更新集保
    fetch_tdcc_concentration()

def fetch_cmoney_sentiment(stock_id):
    """
    抓取股市同學會的最新討論標題
    """
    url = f"https://www.cmoney.tw/forum/stock/{stock_id}"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    try:
        logging.info(f"正在抓取股市同學會個股 {stock_id}...")
        resp = requests.get(url, headers=headers, timeout=10, verify=False)
        if resp.status_code != 200:
            logging.warning(f"股市同學會抓取失敗，HTTP 狀態碼: {resp.status_code}")
            return []
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        titles = []
        # 使用 CSS 屬性選擇器模糊匹配 nav__articleItemTitle
        for item in soup.select('[class*="nav__articleItemTitle"]'):
            text = item.text.strip()
            if text and text not in titles:
                titles.append(text)
        
        # 備用：若找不到，匹配所有可能含有文章標題特徵的 span 或 div
        if not titles:
            for span in soup.find_all('span'):
                cls = span.get('class', [])
                if any('nav__articleItemTitle' in c for c in cls):
                    text = span.text.strip()
                    if text and text not in titles:
                        titles.append(text)
                        
        logging.info(f"股市同學會抓取成功，共 {len(titles)} 筆討論。")
        return titles[:5]
    except Exception as e:
        logging.error(f"抓取股市同學會時發生錯誤: {e}")
        return []

def fetch_threads_sentiment(stock_id, stock_name=None):
    """
    利用 Yahoo Search 搜尋 Threads (threads.com / threads.net) 上關於該個股的最新討論
    """
    import urllib.parse
    import subprocess
    import re
    import random
    import time
    from bs4 import BeautifulSoup

    # 1. 取得股票名稱 (若未傳入，嘗試從資料庫查詢)
    if stock_name == "FORCE_ID":
        stock_name = "未知股"
    elif not stock_name or stock_name == "未知股":
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL AND stock_name != '未知股' LIMIT 1", (stock_id,))
            row = cursor.fetchone()
            if row:
                stock_name = row[0]
            conn.close()
        except Exception as e:
            logging.error(f"從資料庫查詢股票名稱時發生錯誤: {e}")

    # 2. 決定搜尋關鍵字
    search_keyword = stock_name if (stock_name and stock_name != "未知股") else stock_id
    
    # 3. 搜尋字詞與 URL 設定
    # 避免使用 site: 或 .com 等搜尋運算子，改用 "threads 關鍵字"
    query = f"threads {search_keyword}"
    encoded_query = urllib.parse.quote(query)
    
    hosts = ["tw.search.yahoo.com", "search.yahoo.com"]
    snippets = []
    
    # 僅使用已知不會被 Yahoo 直接阻擋的 Windows Chrome / Edge User-Agents
    verified_uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]
    
    for host in hosts:
        url = f"https://{host}/search?p={encoded_query}"
        for attempt in range(3):
            # 由於 Yahoo Search 阻擋 HTTP/1.1 (回傳 500)，必須使用支援 HTTP/2 的 curl 進行請求
            cmd = [
                "curl",
                "-s",
                "-A", random.choice(verified_uas),
                "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "-H", "Accept-Language: zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
                "-H", "Upgrade-Insecure-Requests: 1",
                url
            ]
            try:
                logging.info(f"正在以 Yahoo Search ({host}) 搜尋 Threads 內容 (嘗試 {attempt+1}): {query}...")
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                if res.returncode == 0 and res.stdout:
                    soup = BeautifulSoup(res.stdout, 'html.parser')
                    results = soup.select('.algo-sr')
                    
                    for r in results:
                        a = r.find('a', href=True)
                        comp_text = r.select_one('.compText') or r.select_one('.desc')
                        if a and comp_text:
                            href = a['href']
                            # 解析並還原 Yahoo 轉址 URL 以檢查目標網域
                            target_url = href
                            ru_match = re.search(r'/RU=([^/]+)', href)
                            if ru_match:
                                try:
                                    target_url = urllib.parse.unquote(ru_match.group(1))
                                except:
                                    pass
                            
                            # 嚴格篩選：必須是 Threads 網址且片段符合條件
                            is_threads = "threads.net" in target_url or "threads.com" in target_url
                            if not is_threads:
                                continue
                                
                            text = comp_text.text.strip()
                            if not text:
                                continue
                            
                            # 過濾 Threads 平台介紹語
                            if "Threads is a platform to share ideas" in text or "See the latest conversations" in text:
                                continue
                            
                            # 清理時間字首，例如 "Jul 31, 2025 ·" 或者 "2天 ·"
                            text = re.sub(r'^[A-Za-z]{3}\s+\d+,\s+\d+\s+·\s*', '', text)
                            text = re.sub(r'^\d+\s+天前\s+·\s*', '', text)
                            text = re.sub(r'^\d+\s+天\s+·\s*', '', text)
                            text = re.sub(r'^\d+\s+小時前\s+·\s*', '', text)
                            text = re.sub(r'^\d+\s+小時\s+·\s*', '', text)
                            text = text.strip()
                            
                            # 進一步過濾非相關討論 (如果是用 stock_id 搜尋時，特別過濾時間或非股票相關的純數字內容)
                            if search_keyword == stock_id:
                                if re.search(r'\d{1,2}:\d{2}', text):
                                    continue
                                if "Followers" in text or "Threads" in text or "Conversations" in text:
                                    if not any(k in text for k in ["股", "買", "賣", "點", "台股", "投資"]):
                                        continue
                            
                            # 嚴格校驗：確保該片段確實包含股票名稱或代碼，避免搜尋引擎模糊匹配帶來的無關資料
                            name_to_check = stock_name.strip() if (stock_name and stock_name != "未知股") else None
                            id_to_check = str(stock_id).strip()
                            
                            has_name = name_to_check and (name_to_check.lower() in text.lower())
                            has_id = id_to_check and (id_to_check in text)
                            
                            if not (has_name or has_id):
                                logging.info(f"過濾無關之 Threads 討論片段 (不含股票名稱 '{name_to_check}' 且不含代碼 '{id_to_check}'): {text[:60]}...")
                                continue
                            
                            if text and text not in snippets:
                                snippets.append(text)
                    
                    if snippets:
                        logging.info(f"[{host}] Threads 搜尋成功，共 {len(snippets)} 筆討論片段。")
                        return snippets[:5]
                else:
                    logging.warning(f"搜尋 Threads 失敗 ({host})，curl 返回碼: {res.returncode}")
            except Exception as e:
                logging.error(f"抓取 Threads 討論時發生錯誤 ({host}): {e}")
            
            # 若失敗或無結果則稍作等待再重試
            time.sleep(random.uniform(1.0, 2.5))
            
    # 如果用名稱搜尋沒有結果，且 search_keyword 不等於 stock_id，則嘗試用 stock_id 再搜一次
    if not snippets and search_keyword != stock_id:
        logging.info(f"以股票名稱搜尋無結果，嘗試使用代碼 {stock_id} 重新搜尋...")
        return fetch_threads_sentiment(stock_id, stock_name="FORCE_ID")
        
    return []

if __name__ == "__main__":
    main()
