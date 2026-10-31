import os
import sys
import builtins

# 防護機制：當啟動 uvicorn 的終端機視窗 (PTY) 被關閉時，直接 print 會觸發 OSError: [Errno 5] Input/output error 導致背景任務中斷
_orig_print = builtins.print
_fallback_log_fp = None
def _safe_print(*args, **kwargs):
    global _fallback_log_fp
    try:
        _orig_print(*args, **kwargs)
    except OSError:
        try:
            if _fallback_log_fp is None or _fallback_log_fp.closed:
                _fallback_log_fp = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "uvicorn.log"), "a", encoding="utf-8")
                sys.stdout = _fallback_log_fp
                sys.stderr = _fallback_log_fp
            _orig_print(*args, file=_fallback_log_fp, flush=True)
        except Exception:
            pass
builtins.print = _safe_print

os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

import sqlite3
import threading
import time
import json
from datetime import datetime, timedelta
import torch
try:
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
except Exception:
    pass
from fastapi import FastAPI, BackgroundTasks, HTTPException, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import google.generativeai as genai
import scraper
import podcast_scraper
import ml_engine
import backtest_engine

app = FastAPI(title="Stock Analysis API")

# 允許前端 (Vite 預設 port: 5173) 跨網域存取
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 開發環境允許所有來源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_pna_and_cors_headers(request, call_next):
    if request.method == "OPTIONS":
        from fastapi.responses import Response
        response = Response(status_code=204)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, 'tw_stock.db')

DEFAULT_PROMPT_TEMPLATE = """你是一位資深的台股產業與籌碼分析師。請針對以下個股進行「持股健檢」，並給予具體可行的交易策略與評估。

個股資訊:
- 股票代碼與名稱: {stock_id} {stock_name}
- 個人購入成本 (均價): {buy_price}
- 最新收盤價: {latest_price}
- 個人交易筆記: {notes}

最近 10 個交易日的股價歷史走勢 (舊到新):
{price_text}

最新每月營收與財務數據 (最新到舊):
{revenue_text}

最新 10 個交易日三大法人買賣超 (舊到新):
{inst_text}

最新集保股權分散與大戶持股比例變動 (最新到舊):
{concentration_text}

最新相關新聞與市場輿情:
{news_text}

PTT 股票板最新討論熱度與標題:
{ptt_text}

股市同學會熱門討論:
{cmoney_text}

Threads 社群最新討論:
{threads_text}

請結合上述資料，以及您對市場的理解，進行以下維度的分析（請務必結合最新的財報營收與論壇討論，進行嚴謹查證與推理）：
1. **技術面與籌碼面評估**：分析近 10 天的量價關係，並結合提供的三大法人買賣超、集保大戶持股變化，說明目前籌碼結構與走勢（例如：法人連續買超、大戶吃貨、散戶退場、強勢噴出等）。
2. **基本面與營收分析**：評估最新 1-6 個月的營收與 YoY 變化趨勢，說明基本面是否有落底翻揚或持續高成長的實質理由。
3. **新聞與論壇輿情分析**：簡評新聞對股價的正面或負面影響，並分析 PTT、股市同學會與 Threads 論壇的討論熱度、市場氣氛以及是否有小道消息（說明股民是處於「緊張/恐慌」、「冷淡/理性」還是「過熱/盲目追高」狀態，以及此情緒對股價的潛在影響）。
4. **持股策略建議**：
   - 如果是「持股」（有提供購入成本），請計算目前損益狀況，給予止盈、止損或加碼的具體價位建議。
   - 如果是「追蹤股」（未提供成本），請評估目前是否為適合切入的買點，並建議分批買進的區間。
5. **最後核心評級與燈號**：請在報告開頭或結尾，**務必以獨立一行**給出這三個燈號評級之一（必須包含雙括號，例如：【燈號】: 綠燈）：
   - 【燈號】: 綠燈（繼續持有）
   - 【燈號】: 黃燈（準備賣出）
   - 【燈號】: 紅燈（立刻賣出）

5. **指標結構化輸出**：請**務必**在報告的**最尾端**，以獨立行輸出以下指標（用於系統解析存檔，請嚴格遵守格式）：
【熱度分數】: [請評估論壇討論熱度，給出 0 至 100 的整數分數，僅填寫數字即可，例如：85]
【看空看多】: [請根據網友氣氛評估為：看多、看空 或 中立]
【小道消息】: [請簡短摘要討論中是否有提及小道消息或內線傳聞，若無則寫「無」]
【2026_FPE】: [請評估並給出該個股在 2026 年的預估本益比 (Forward PE)，僅填寫數字，例如：15.5]
【2027_FPE】: [請評估並給出該個股在 2027 年的預估本益比 (Forward PE)，僅填寫數字，例如：12.0]
【2028_FPE】: [請評估並給出該個股在 2028 年的預估本益比 (Forward PE)，僅填寫數字，例如：10.2]
【是否是打群架】: [請評估此個股是否為現階段市場熱門、資金集中、大戶法人群起交易的「打群架」或「族群性強」之股票，請填寫「是」或「否」]"""

def get_db_connection():
    conn = sqlite3.connect(DB_NAME, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

# 初始化持股資料表與設定表
def init_portfolio_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS portfolio (
        stock_id TEXT PRIMARY KEY,
        stock_name TEXT,
        buy_price REAL,
        notes TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS portfolio_analysis_history (
        stock_id TEXT,
        date TEXT,
        signal TEXT,
        analysis_text TEXT,
        created_at TEXT,
        PRIMARY KEY (stock_id, date)
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS podcast_channels (
        channel_id TEXT PRIMARY KEY,
        name TEXT,
        apple_url TEXT,
        feed_url TEXT,
        artwork_url TEXT,
        artist_name TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS podcast_episodes (
        episode_guid TEXT PRIMARY KEY,
        channel_id TEXT,
        title TEXT,
        pub_date TEXT,
        audio_url TEXT,
        duration TEXT,
        description TEXT,
        transcription TEXT,
        analysis_report TEXT,
        analysis_date TEXT,
        status TEXT
    );
    """)
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS watchlist (
        stock_id TEXT PRIMARY KEY,
        stock_name TEXT,
        target_price_high REAL,
        target_price_low REAL,
        compare_ma5 INTEGER DEFAULT 0,
        compare_ma20 INTEGER DEFAULT 0,
        compare_ma60 INTEGER DEFAULT 0,
        created_at TEXT
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS watchlist_alert_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id TEXT,
        alert_type TEXT,
        alert_message TEXT,
        triggered_price REAL,
        triggered_at TEXT,
        date_str TEXT
    );
    """)
    
    # 動態新增指標欄位
    for col, col_type in [
        ("sentiment_score", "REAL"), 
        ("sentiment_direction", "TEXT"), 
        ("has_rumor", "TEXT"),
        ("fpe_2026", "REAL"),
        ("fpe_2027", "REAL"),
        ("fpe_2028", "REAL"),
        ("is_group_fight", "TEXT"),
        ("model_name", "TEXT")
    ]:
        try:
            cursor.execute(f"ALTER TABLE portfolio_analysis_history ADD COLUMN {col} {col_type};")
        except sqlite3.OperationalError:
            pass # 欄位已存在
            
    # 動態新增持股表之自動分析欄位
    try:
        cursor.execute("ALTER TABLE portfolio ADD COLUMN auto_analyze INTEGER DEFAULT 1;")
    except sqlite3.OperationalError:
        pass # 欄位已存在
            
    # 檢查並升級分析提示詞範本
    cursor.execute("SELECT value FROM settings WHERE key = 'analysis_prompt'")
    saved_prompt_row = cursor.fetchone()
    if saved_prompt_row:
        saved_prompt = saved_prompt_row[0]
        if "【2026_FPE】" not in saved_prompt or "{revenue_text}" not in saved_prompt:
            cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('analysis_prompt', ?)", (DEFAULT_PROMPT_TEMPLATE,))
            print("已自動將舊版分析提示詞範本升級為包含營收、籌碼、集保資料與 2026_FPE, 2027_FPE, 2028_FPE 的最新範本。")
    else:
        cursor.execute("INSERT INTO settings (key, value) VALUES ('analysis_prompt', ?)", (DEFAULT_PROMPT_TEMPLATE,))
    # 預設排程啟用設定
    cursor.execute("SELECT value FROM settings WHERE key = 'schedule_enabled'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('schedule_enabled', 'true')")
    cursor.execute("SELECT value FROM settings WHERE key = 'schedule_time'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('schedule_time', '06:00')")
    cursor.execute("SELECT value FROM settings WHERE key = 'schedule_scrape_daily'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('schedule_scrape_daily', 'true')")
    cursor.execute("SELECT value FROM settings WHERE key = 'schedule_scrape_revenue'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('schedule_scrape_revenue', 'true')")
    cursor.execute("SELECT value FROM settings WHERE key = 'schedule_analyze'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('schedule_analyze', 'true')")
    cursor.execute("SELECT value FROM settings WHERE key = 'telegram_bot_token'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('telegram_bot_token', '')")
    cursor.execute("SELECT value FROM settings WHERE key = 'telegram_chat_id'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '')")
                
    conn.commit()
    conn.close()

init_portfolio_db()

# Removed root endpoint to allow React router to handle `/`

# ================================
# 1. 資料庫讀取 (Database Viewer)
# ================================
DATABASE_TABLE_METADATA = {
    "daily_stock": {
        "name": "每日個股價量 (daily_stock)",
        "desc": "台股上市櫃全市場每日開高低收、成交量、融資券等完整歷史行情",
        "category": "台股核心",
        "frequency": "每個交易日 14:00",
        "task_type": "daily"
    },
    "institutional_trades": {
        "name": "三大法人買賣超 (institutional_trades)",
        "desc": "外資、投信、自營商每日買賣超張數與金額明細",
        "category": "台股核心",
        "frequency": "每個交易日 15:30",
        "task_type": "daily"
    },
    "monthly_revenue": {
        "name": "每月營收公告 (monthly_revenue)",
        "desc": "全市場上市櫃公司每月營收數字、MoM 與 YoY 成長率",
        "category": "基本面",
        "frequency": "每月 10 日前",
        "task_type": "revenue"
    },
    "shareholder_concentration": {
        "name": "集保股權分散表 (shareholder_concentration)",
        "desc": "千張大戶持股比例、分級級距持股人次每週變化",
        "category": "籌碼面",
        "frequency": "每週五盤後",
        "task_type": "daily"
    },
    "institutional_futures": {
        "name": "期貨三大法人未平倉 (institutional_futures)",
        "desc": "台指期貨、選擇權各大法人多空淨口數與契約金額",
        "category": "期貨籌碼",
        "frequency": "每個交易日 15:30",
        "task_type": "daily"
    },
    "daily_index": {
        "name": "加權指數每日行情 (daily_index)",
        "desc": "TAIEX 加權指數歷史價量與漲跌幅",
        "category": "大盤總覽",
        "frequency": "每個交易日 14:00",
        "task_type": "daily"
    },
    "market_breadth": {
        "name": "市場寬幅騰落指標 (market_breadth)",
        "desc": "全市場上漲/下跌家數、漲跌停統計與騰落線 (ADL)",
        "category": "大盤總覽",
        "frequency": "每個交易日 14:00",
        "task_type": "daily"
    },
    "options_pc_ratio": {
        "name": "選擇權 P/C Ratio (options_pc_ratio)",
        "desc": "台指選擇權 Put/Call 留倉與成交金額比值多空指標",
        "category": "期貨籌碼",
        "frequency": "每個交易日 15:30",
        "task_type": "daily"
    },
    "macro_indicators": {
        "name": "宏觀跨市場因子庫 (macro_indicators)",
        "desc": "美元指數、美債殖利率、VIX、台積電 ADR 等跨市場數據",
        "category": "總體經濟",
        "frequency": "每日更新",
        "task_type": "daily"
    },
    "global_stock_daily": {
        "name": "全球旗艦資產行情 (global_stock_daily)",
        "desc": "美股四大指數、全球主權資產每日歷史回測行情",
        "category": "全球資產",
        "frequency": "每日美股盤後",
        "task_type": "global_stock"
    },
    "global_sovereign_daily": {
        "name": "全球主權泰坦行情 (global_sovereign_daily)",
        "desc": "全球高流動性主權主階梯商品逐日報價庫",
        "category": "全球資產",
        "frequency": "每日更新",
        "task_type": "global_sovereign"
    },
    "global_sovereign_metadata": {
        "name": "全球主權商品清單 (global_sovereign_metadata)",
        "desc": "全球 18 大主權國家 ETF 與現金避險錨點商品規格定義",
        "category": "全球資產",
        "frequency": "規格定義",
        "task_type": "global_sovereign"
    },
    "global_stock_metadata": {
        "name": "全球旗艦股票清單 (global_stock_metadata)",
        "desc": "美股四大指數與全球最高流動性成分股商品池標的定義",
        "category": "全球資產",
        "frequency": "規格定義",
        "task_type": "global_stock"
    },
    "futures_1m": {
        "name": "台指期 1分K 資料 (futures_1m)",
        "desc": "台指期當沖高頻 1 分鐘線逐筆歷史資料",
        "category": "高頻當沖",
        "frequency": "交易時段同步",
        "task_type": "daily"
    },
    "futures_5m": {
        "name": "台指期 5分K 資料 (futures_5m)",
        "desc": "台指期當沖高頻 5 分鐘線逐筆歷史資料",
        "category": "高頻當沖",
        "frequency": "交易時段同步",
        "task_type": "daily"
    },
    "portfolio": {
        "name": "個人核心持股庫 (portfolio)",
        "desc": "個人追蹤持股清單、成本買價、Gemini AI 輿情診斷標記",
        "category": "個人投資",
        "frequency": "即時同步",
        "task_type": "daily"
    },
    "watchlist": {
        "name": "自選股監控池 (watchlist)",
        "desc": "自選股觀察清單、即時異動監控與 Telegram 警示配置",
        "category": "個人投資",
        "frequency": "即時同步",
        "task_type": "daily"
    },
    "settings": {
        "name": "系統全域設定參數 (settings)",
        "desc": "模型回測參數、Telegram 機器人設定、股本門檻等系統參數",
        "category": "系統設定",
        "frequency": "用戶配置",
        "task_type": "daily"
    },
    "titan_live_account": {
        "name": "泰坦實盤虛擬帳戶 (titan_live_account)",
        "desc": "泰坦實作模擬帳戶淨值、可用現金、累積已實現與未實現損益",
        "category": "泰坦實作",
        "frequency": "每日更新",
        "task_type": "daily"
    },
    "titan_live_positions": {
        "name": "泰坦實盤持股部位 (titan_live_positions)",
        "desc": "泰坦當前持股明細、進場成本、移動停利階梯狀態",
        "category": "泰坦實作",
        "frequency": "每日更新",
        "task_type": "daily"
    },
    "titan_live_trades": {
        "name": "泰坦實盤交易紀錄 (titan_live_trades)",
        "desc": "泰坦策略實作完整歷史買進/賣出交易紀錄與損益",
        "category": "泰坦實作",
        "frequency": "每日更新",
        "task_type": "daily"
    },
    "global_sovereign_positions": {
        "name": "全球主權實盤持股 (global_sovereign_positions)",
        "desc": "全球主權實作當前實盤持股明細、成本、股數與盈虧狀態",
        "category": "泰坦實作",
        "frequency": "即時同步",
        "task_type": "global_sovereign"
    },
    "global_sovereign_trades": {
        "name": "全球主權交易紀錄 (global_sovereign_trades)",
        "desc": "全球主權泰坦完整歷史買進/賣出交易紀錄與已實現損益",
        "category": "泰坦實作",
        "frequency": "即時同步",
        "task_type": "global_sovereign"
    },
    "global_sovereign_account": {
        "name": "全球主權帳戶資金 (global_sovereign_account)",
        "desc": "全球主權泰坦帳戶本金、當前可用現金 (TWD) 與即時匯率換算",
        "category": "泰坦實作",
        "frequency": "即時同步",
        "task_type": "global_sovereign"
    }
}

_DB_STATUS_CACHE = None
_DB_STATUS_CACHE_TIME = 0
_DB_TABLE_COUNTS = {}
_LARGE_TABLES = {'daily_stock', 'institutional_trades', 'shareholder_concentration', 'global_stock_daily', 'futures_1m', 'futures_5m'}

def _refresh_large_table_counts_bg():
    def _worker():
        try:
            conn = get_db_connection()
            c = conn.cursor()
            for t_id in _LARGE_TABLES:
                try:
                    c.execute(f"SELECT count(*) FROM {t_id}")
                    _DB_TABLE_COUNTS[t_id] = c.fetchone()[0] or 0
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass
    threading.Thread(target=_worker, daemon=True).start()

def invalidate_db_status_cache():
    global _DB_STATUS_CACHE, _DB_STATUS_CACHE_TIME, _DB_TABLE_COUNTS
    _DB_STATUS_CACHE = None
    _DB_STATUS_CACHE_TIME = 0
    for k in list(_DB_TABLE_COUNTS.keys()):
        if k not in _LARGE_TABLES:
            _DB_TABLE_COUNTS.pop(k, None)
    _refresh_large_table_counts_bg()

@app.get("/api/database/status")
def get_database_status(force: bool = False):
    global _DB_STATUS_CACHE, _DB_STATUS_CACHE_TIME, _DB_TABLE_COUNTS
    now = time.time()
    if not force and _DB_STATUS_CACHE and (now - _DB_STATUS_CACHE_TIME < 300):
        return {"status": "success", "tables": _DB_STATUS_CACHE, "cached": True}

    conn = get_db_connection()
    cursor = conn.cursor()
    tables_result = []
    need_bg_count = False
    
    for t_id, meta in DATABASE_TABLE_METADATA.items():
        try:
            cursor.execute(f"PRAGMA table_info({t_id})")
            cols = [c['name'] for c in cursor.fetchall()]
            if not cols:
                continue
            
            if t_id in _DB_TABLE_COUNTS and (not force or t_id in _LARGE_TABLES):
                r_cnt = _DB_TABLE_COUNTS[t_id]
                if force and t_id in _LARGE_TABLES:
                    need_bg_count = True
            elif t_id in _LARGE_TABLES:
                cursor.execute(f"SELECT max(rowid) FROM {t_id}")
                r_cnt = cursor.fetchone()[0] or 0
                _DB_TABLE_COUNTS[t_id] = r_cnt
                need_bg_count = True
            else:
                cursor.execute(f"SELECT count(*) FROM {t_id}")
                r_cnt = cursor.fetchone()[0] or 0
                _DB_TABLE_COUNTS[t_id] = r_cnt
            
            latest_val = "-"
            for dc in ['date', 'revenue_date', 'datetime', 'created_at', 'updated_at']:
                if dc in cols:
                    cursor.execute(f"SELECT max({dc}) FROM {t_id}")
                    row = cursor.fetchone()
                    if row and row[0]:
                        latest_val = str(row[0])
                    break
                    
            tables_result.append({
                "id": t_id,
                "name": meta["name"],
                "desc": meta["desc"],
                "category": meta["category"],
                "frequency": meta["frequency"],
                "task_type": meta["task_type"],
                "row_count": r_cnt,
                "latest_date": latest_val,
                "columns_count": len(cols),
                "status": "active"
            })
        except Exception as e:
            tables_result.append({
                "id": t_id,
                "name": meta["name"],
                "desc": meta["desc"],
                "category": meta["category"],
                "frequency": meta["frequency"],
                "task_type": meta["task_type"],
                "row_count": 0,
                "latest_date": "-",
                "columns_count": 0,
                "status": "error",
                "error": str(e)
            })
            
    conn.close()
    if need_bg_count:
        _refresh_large_table_counts_bg()
    _DB_STATUS_CACHE = tables_result
    _DB_STATUS_CACHE_TIME = now
    return {"status": "success", "tables": tables_result, "cached": False}

@app.get("/api/database/{table_name}")
def get_table_data(
    table_name: str, 
    limit: int | None = None, 
    page: int = 1, 
    page_size: int = 100,
    search: str = "",
    sort_by: str | None = None,
    sort_dir: str = "asc"
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 動態取得表格的欄位名稱 (確認存在)
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [col['name'] for col in cursor.fetchall()]
    if not columns:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

    effective_limit = limit if (limit is not None and limit > 0) else (page_size if page_size > 0 else 100)
    effective_offset = (page - 1) * effective_limit if page > 0 else 0

    if sort_by and sort_by in columns:
        dir_sql = "DESC" if sort_dir.lower() == "desc" else "ASC"
        order_by = f"{sort_by} {dir_sql}"
    else:
        order_by = "datetime DESC" if "datetime" in columns else "date DESC" if "date" in columns else "revenue_date DESC" if "revenue_date" in columns else ""
    
    where_clauses = []
    params = []
    q = search.strip() if search else ""
    if q:
        # 針對千萬級別大型資料表採用索引加速檢索 (避免 LIKE '%...%' 全表掃描導致超時)
        if table_name in ('daily_stock', 'institutional_trades', 'shareholder_concentration', 'monthly_revenue'):
            date_col = 'revenue_date' if table_name == 'monthly_revenue' else 'date'
            q_clean_date = q.replace('-', '').replace('/', '')
            if q_clean_date.isdigit() and len(q_clean_date) in (6, 8) and (q_clean_date.startswith('20') or q_clean_date.startswith('19')):
                where_clauses.append(f"{date_col} = ?")
                params.append(q_clean_date if date_col == 'date' else q)
            else:
                # 先從最新交易日的 daily_stock 快速解析出符合代碼或中文名稱的 stock_id 清單 (耗時 < 15ms)
                cursor.execute("SELECT max(date) FROM daily_stock")
                latest_d = (cursor.fetchone() or [None])[0]
                matched_sids = []
                if latest_d:
                    cursor.execute(
                        "SELECT DISTINCT stock_id FROM daily_stock WHERE date = ? AND (stock_id = ? OR stock_id LIKE ? OR stock_name LIKE ?)",
                        (latest_d, q, f"%{q}%", f"%{q}%")
                    )
                    matched_sids = [r[0] for r in cursor.fetchall() if r[0]]
                if not matched_sids:
                    matched_sids = [q]
                # 若完全相符代碼存在且使用者輸入純數字代碼，優先精準匹配或限制前 30 檔以發揮複合索引效能
                if q in matched_sids and q.isalnum():
                    matched_sids = [q] + [s for s in matched_sids if s != q][:19]
                else:
                    matched_sids = matched_sids[:30]
                placeholders = ",".join(["?"] * len(matched_sids))
                where_clauses.append(f"stock_id IN ({placeholders})")
                params.extend(matched_sids)
        elif table_name in ('global_stock_daily', 'global_sovereign_daily'):
            meta_tbl = 'global_stock_metadata' if table_name == 'global_stock_daily' else 'global_sovereign_metadata'
            q_upper = q.upper()
            if len(q) >= 8 and q[:4].isdigit() and ('-' in q or q.isdigit()):
                d_fmt = f"{q[:4]}-{q[4:6]}-{q[6:8]}" if len(q) == 8 and q.isdigit() else q
                where_clauses.append("date = ?")
                params.append(d_fmt)
            else:
                cursor.execute(
                    f"SELECT DISTINCT ticker FROM {meta_tbl} WHERE UPPER(ticker) LIKE ? OR name LIKE ? OR country LIKE ?",
                    (f"%{q_upper}%", f"%{q}%", f"%{q}%")
                )
                matched_tickers = [r[0] for r in cursor.fetchall() if r[0]]
                if not matched_tickers:
                    cursor.execute(f"SELECT DISTINCT ticker FROM {table_name}")
                    all_t = [r[0] for r in cursor.fetchall() if r[0]]
                    matched_tickers = [t for t in all_t if q_upper in t.upper()]
                if not matched_tickers:
                    matched_tickers = [q_upper]
                placeholders = ",".join(["?"] * len(matched_tickers[:30]))
                where_clauses.append(f"ticker IN ({placeholders})")
                params.extend(matched_tickers[:30])
        else:
            search_like = f"%{q}%"
            sub_clauses = []
            for search_col in ['stock_id', 'stock_name', 'ticker', 'date', 'revenue_date', 'symbol', 'name', 'country', 'region', 'key']:
                if search_col in columns:
                    sub_clauses.append(f"{search_col} LIKE ?")
                    params.append(search_like)
            if sub_clauses:
                where_clauses.append(f"({' OR '.join(sub_clauses)})")

    where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # 計算符合條件之總筆數
    if where_sql:
        cursor.execute(f"SELECT count(*) FROM {table_name}{where_sql}", params)
        total_count = cursor.fetchone()[0] or 0
    else:
        if table_name in _DB_TABLE_COUNTS:
            total_count = _DB_TABLE_COUNTS[table_name]
        elif table_name in _LARGE_TABLES:
            cursor.execute(f"SELECT max(rowid) FROM {table_name}")
            total_count = cursor.fetchone()[0] or 0
            _DB_TABLE_COUNTS[table_name] = total_count
            _refresh_large_table_counts_bg()
        else:
            cursor.execute(f"SELECT count(*) FROM {table_name}")
            total_count = cursor.fetchone()[0] or 0
            _DB_TABLE_COUNTS[table_name] = total_count

    query = f"SELECT * FROM {table_name}{where_sql}"
    if order_by:
        query += f" ORDER BY {order_by}"
    query += f" LIMIT {effective_limit} OFFSET {effective_offset}"
    
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    import math
    return {
        "columns": columns, 
        "data": rows,
        "total_count": total_count,
        "page": page,
        "page_size": effective_limit,
        "total_pages": math.ceil(total_count / effective_limit) if total_count > 0 else 1
    }

@app.get("/api/futures/kbars")
def get_futures_kbars(
    symbol: str = "TX", 
    timeframe: str = "1m", 
    limit: int = 500,
    session: str = "all"
):
    table_name = "futures_5m" if timeframe == "5m" else "futures_1m"
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = f"SELECT symbol, contract_month, datetime, open, high, low, close, volume, session FROM {table_name} WHERE symbol = ?"
    params = [symbol]
    if session in ["regular", "night"]:
        query += " AND session = ?"
        params.append(session)
        
    query += " ORDER BY datetime DESC LIMIT ?"
    params.append(limit)
    
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"status": "ok", "count": len(rows), "data": list(reversed(rows))}


# ================================
# 1.5 個股技術線圖資料 (即時讀取本機 tw_stock.db，不經任何上傳)
# ================================
@app.get("/api/chart/{ticker}")
def get_stock_chart_data(ticker: str, days: int = 750, adjust: bool = True):
    """回傳單一標的日K (OHLCV)；台股另附三大法人買賣超(張)與融資/融券餘額。
    台股: daily_stock (+ institutional_trades)；美股/其他: global_stock_daily (adjust=True 時以 adj_close 還原)。
    """
    from fastapi.responses import JSONResponse
    days = max(30, min(int(days), 6000))
    tk = ticker.strip().upper()
    is_tw = tk.endswith(".TW") or tk.endswith(".TWO") or tk.isdigit()
    conn = get_db_connection()
    try:
        out = None
        if is_tw:
            sid = tk.split(".")[0]
            rows = conn.execute(
                "SELECT date, opening_price, highest_price, lowest_price, closing_price, trade_volume, "
                "margin_balance, short_balance, stock_name FROM daily_stock "
                "WHERE stock_id=? AND closing_price>0 ORDER BY date DESC LIMIT ?", (sid, days)).fetchall()[::-1]
            if len(rows) >= 5:
                inst = {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
                    "SELECT date, foreign_net, trust_net, dealer_net FROM institutional_trades "
                    "WHERE stock_id=? AND date>=?", (sid, rows[0][0]))}
                rd = lambda x: None if x is None else round(float(x), 2)
                kz = lambda x: None if x is None else int(x // 1000)  # 股 -> 張
                out = {"market": "TW", "name": rows[0][8] or "", "d": [], "o": [], "h": [], "l": [], "c": [],
                       "v": [], "fi": [], "tr": [], "de": [], "mb": [], "sb": []}
                for d, o, h, l, c, v, mb, sb, _n in rows:
                    f, t, dl = inst.get(d, (None, None, None))
                    out["d"].append(f"{d[:4]}-{d[4:6]}-{d[6:]}")
                    out["o"].append(rd(o or c)); out["h"].append(rd(h or c))
                    out["l"].append(rd(l or c)); out["c"].append(rd(c))
                    out["v"].append(int((v or 0) // 1000))
                    out["fi"].append(kz(f)); out["tr"].append(kz(t)); out["de"].append(kz(dl))
                    out["mb"].append(mb); out["sb"].append(sb)
        if out is None:
            gt = tk if "." in tk else (tk + ".TW" if is_tw else tk)
            rows = conn.execute(
                "SELECT date, open, high, low, close, adj_close, volume FROM global_stock_daily "
                "WHERE ticker=? AND close>0 ORDER BY date DESC LIMIT ?", (gt, days)).fetchall()[::-1]
            # 歷史不足時，接上 chart_extra_daily (僅供線圖的補充歷史，由 backfill_chart_history.py 寫入)
            if rows and len(rows) < days:
                try:
                    extra = conn.execute(
                        "SELECT date, open, high, low, close, adj_close, volume FROM chart_extra_daily "
                        "WHERE ticker=? AND date<? AND close>0 ORDER BY date DESC LIMIT ?",
                        (gt, rows[0][0], days - len(rows))).fetchall()[::-1]
                    rows = extra + rows
                except Exception:
                    pass
            if len(rows) >= 5:
                out = {"market": "TW" if is_tw else ("US" if "." not in gt else gt.rsplit(".", 1)[1]),
                       "name": "", "d": [], "o": [], "h": [], "l": [], "c": [], "v": []}
                for d, o, h, l, c, adj, v in rows:
                    k = (adj / c) if (adjust and adj and c) else 1.0
                    out["d"].append(d)
                    out["o"].append(round((o or c) * k, 2)); out["h"].append(round((h or c) * k, 2))
                    out["l"].append(round((l or c) * k, 2)); out["c"].append(round(c * k, 2))
                    out["v"].append(int(v or 0))
        if out is None:
            raise HTTPException(status_code=404, detail=f"tw_stock.db 查無 {tk} 的日K資料")
        out["ticker"] = tk
        out["last_date"] = out["d"][-1]
        return JSONResponse(out, headers={"Cache-Control": "no-store"})
    finally:
        conn.close()


# ================================
# 2. 智慧選股篩選器 (Screener)
# ================================
class ScreenerConfig(BaseModel):
    pe_min: float = 0.0
    pe_max: float = 1000.0
    pb_min: float = 0.0
    pb_max: float = 100.0
    yield_min: float = 0.0
    yield_max: float = 100.0
    vol_min: int = 0
    vol_max: int = 2000000000
    price_trend: int = 0
    vol_trend: int = 0
    vol_surge: bool = False
    vol_surge_mult: float = 1.0
    strat1: bool = False
    strat2: bool = False
    # 新增籌碼與大戶篩選條件
    large_holder_min: float = 0.0
    large_holder_max: float = 100.0
    large_holder_inc: bool = False
    foreign_buy_days_min: int = 0
    trust_buy_days_min: int = 0
    inst_buy_days_min: int = 0

@app.post("/api/screener")
def run_screener(config: ScreenerConfig):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 取得最近 65 個交易日的起始日期，並使用 PRIMARY KEY (date, stock_id) 索引避免全表掃描
    cursor.execute("SELECT MIN(date) FROM (SELECT DISTINCT date FROM daily_stock ORDER BY date DESC LIMIT 65)")
    min_date_row = cursor.fetchone()
    min_date_65 = min_date_row[0] if (min_date_row and min_date_row[0]) else "20250101"

    cursor.execute("SELECT MIN(date) FROM (SELECT DISTINCT date FROM institutional_trades ORDER BY date DESC LIMIT 30)")
    min_inst_row = cursor.fetchone()
    min_date_30 = min_inst_row[0] if (min_inst_row and min_inst_row[0]) else min_date_65

    cursor.execute("SELECT MIN(date) FROM (SELECT DISTINCT date FROM shareholder_concentration ORDER BY date DESC LIMIT 3)")
    min_holder_row = cursor.fetchone()
    min_date_holder = min_holder_row[0] if (min_holder_row and min_holder_row[0]) else "20250101"

    # 抓取近 65 個交易日歷史資料點 (排除 6 碼權證以加速查詢)
    cursor.execute("""
        SELECT date, stock_id, stock_name, closing_price, trade_volume, pe_ratio, pb_ratio, yield_ratio, opening_price, highest_price, lowest_price
        FROM daily_stock
        WHERE date >= ? AND length(stock_id) <= 5 AND closing_price IS NOT NULL
        ORDER BY date DESC
    """, (min_date_65,))
    rows = cursor.fetchall()
    
    # 查詢已儲存之最新 AI 分析歷史
    cursor.execute("""
        SELECT h.stock_id, h.fpe_2026, h.fpe_2027, h.fpe_2028, h.is_group_fight, h.date
        FROM portfolio_analysis_history h
        INNER JOIN (
            SELECT stock_id, MAX(date) as max_date 
            FROM portfolio_analysis_history 
            GROUP BY stock_id
        ) sub ON h.stock_id = sub.stock_id AND h.date = sub.max_date
    """)
    history_rows = cursor.fetchall()
    history_dict = {}
    for h in history_rows:
        history_dict[h['stock_id']] = {
            "fpe_2026": h['fpe_2026'],
            "fpe_2027": h['fpe_2027'],
            "fpe_2028": h['fpe_2028'],
            "is_group_fight": h['is_group_fight'],
            "latest_analysis_date": h['date']
        }

    # 預讀取近 30 個交易日三大法人買賣超歷史
    cursor.execute("""
        SELECT stock_id, date, foreign_net, trust_net, dealer_net 
        FROM institutional_trades 
        WHERE date >= ? AND length(stock_id) <= 5
        ORDER BY date DESC
    """, (min_date_30,))
    inst_rows = cursor.fetchall()
    inst_dict = {}
    for r in inst_rows:
        sid = r['stock_id']
        if sid not in inst_dict:
            inst_dict[sid] = []
        if len(inst_dict[sid]) < 30:
            f_net = r['foreign_net'] or 0
            t_net = r['trust_net'] or 0
            d_net = r['dealer_net'] or 0
            inst_dict[sid].append({
                'foreign_net': f_net,
                'trust_net': t_net,
                'dealer_net': d_net,
                'total_net': f_net + t_net + d_net
            })

    # 預讀取近 3 週集保大戶持股比例 (1000張以上: level = 15)
    cursor.execute("""
        SELECT TRIM(stock_id) as sid, date, proportion 
        FROM shareholder_concentration 
        WHERE date >= ? AND level = 15 
        ORDER BY date DESC
    """, (min_date_holder,))
    holder_rows = cursor.fetchall()
    holder_dict = {}
    for r in holder_rows:
        sid = r['sid']
        if sid not in holder_dict:
            holder_dict[sid] = []
        if len(holder_dict[sid]) < 2:
            holder_dict[sid].append(r['proportion'] or 0.0)
        
    conn.close()
    
    stock_dict = {}
    for r in rows:
        date, sid, name, close, vol, pe, pb, yld, open_p, high_p, low_p = r['date'], r['stock_id'], r['stock_name'], r['closing_price'], r['trade_volume'], r['pe_ratio'], r['pb_ratio'], r['yield_ratio'], r['opening_price'], r['highest_price'], r['lowest_price']
        if sid not in stock_dict:
            stock_dict[sid] = {
                'name': name, 'latest_date': date, 'latest_close': close, 'latest_vol': vol,
                'latest_pe': pe, 'latest_pb': pb, 'latest_yield': yld,
                'closes': [], 'vols': [], 'opens': [], 'highs': [], 'lows': []
            }
        if len(stock_dict[sid]['closes']) < 80:
            stock_dict[sid]['closes'].append(close)
            stock_dict[sid]['vols'].append(vol)
            stock_dict[sid]['opens'].append(open_p)
            stock_dict[sid]['highs'].append(high_p)
            stock_dict[sid]['lows'].append(low_p)
            
    def calc_consec_days(records, key):
        count = 0
        for rec in records:
            if rec.get(key, 0) > 0:
                count += 1
            else:
                break
        return count

    results = []
    
    # 執行篩選邏輯
    for sid, data in stock_dict.items():
        closes = data['closes']
        vols = data['vols']
        opens = data['opens']
        highs = data['highs']
        lows = data['lows']
        
        if len(closes) < 20: continue 
        
        close = data['latest_close']
        vol = data['latest_vol']
        pe = data['latest_pe']
        pb = data['latest_pb']
        yld = data['latest_yield']
        open_curr = opens[0]
        high_curr = highs[0]
        low_curr = lows[0]

        # 專業策略判斷
        if config.strat1 or config.strat2:
            match_strat1 = False
            match_strat2 = False
            
            if config.strat1:
                if len(closes) >= 61 and closes[1] is not None and open_curr is not None:
                    ma60_curr = sum(closes[:60])/60
                    ma60_prev = sum(closes[1:61])/60
                    v_ma5_prev = sum(vols[1:6])/5 if len(vols) >= 6 else (sum(vols[:5])/5)
                    cond_a = (close > ma60_curr) and (closes[1] <= ma60_prev)
                    cond_b = (close > open_curr * 1.02)
                    cond_c = (vol > v_ma5_prev * 2)
                    change = (close / closes[1]) if closes[1] != 0 else 1
                    cond_d = (1.035 < change < 1.099)
                    if cond_a and cond_b and cond_c and cond_d: match_strat1 = True
            
            if config.strat2:
                if len(closes) >= 21 and highs[0] is not None and lows[0] is not None and closes[1] is not None:
                    ma5_c = sum(closes[:5])/5
                    ma10_c = sum(closes[:10])/10
                    ma20_c = sum(closes[:20])/20
                    ma20_prev = sum(closes[1:21])/20
                    ma20_v = sum(vols[:20])/20
                    v_min5 = min(vols[:5])
                    cond_a = (ma5_c > ma10_c > ma20_c)
                    cond_b = (ma20_c > ma20_prev)
                    cond_c = (close > ma20_c)
                    cond_d = (vol < ma20_v * 0.5) and (vol == v_min5)
                    cond_e = (high_curr - low_curr < closes[1] * 0.035)
                    if cond_a and cond_b and cond_c and cond_d and cond_e: match_strat2 = True
            
            if not (match_strat1 or match_strat2): continue
        
        # 成交量激增
        if config.vol_surge:
            if len(vols) < 25: continue
            avg_v_5 = sum(vols[:5]) / 5
            avg_v_20_prev = sum(vols[5:25]) / 20
            if avg_v_5 <= (avg_v_20_prev * config.vol_surge_mult): continue

        # 基本篩選條件
        if vol is None or not (config.vol_min <= vol <= config.vol_max): continue
        if pe is not None and not (config.pe_min <= pe <= config.pe_max): continue
        if pb is not None and not (config.pb_min <= pb <= config.pb_max): continue
        if yld is not None and not (config.yield_min <= yld <= config.yield_max): continue

        # 趨勢篩選
        ma5_c = sum(closes[:5])/5
        ma20_c = sum(closes[:20])/20
        if config.price_trend == 1 and close <= ma5_c: continue
        if config.price_trend == 2 and close <= ma20_c: continue
        if config.price_trend == 3 and (ma5_c <= ma20_c): continue
        
        ma5_v = sum(vols[:5])/5
        ma20_v = sum(vols[:20])/20
        if config.vol_trend == 1 and vol <= ma5_v: continue
        if config.vol_trend == 2 and vol <= ma20_v: continue
        if config.vol_trend == 3 and (ma5_v <= ma20_v): continue

        # 籌碼與大戶動態計算
        inst_records = inst_dict.get(sid, [])
        foreign_buy_days = calc_consec_days(inst_records, 'foreign_net')
        trust_buy_days = calc_consec_days(inst_records, 'trust_net')
        inst_buy_days = calc_consec_days(inst_records, 'total_net')

        holder_ratios = holder_dict.get(sid, [])
        latest_holder_ratio = holder_ratios[0] if len(holder_ratios) > 0 else None
        prev_holder_ratio = holder_ratios[1] if len(holder_ratios) > 1 else None
        holder_change = round(latest_holder_ratio - prev_holder_ratio, 2) if (latest_holder_ratio is not None and prev_holder_ratio is not None) else 0.0

        # 籌碼面過濾條件
        if config.large_holder_min > 0 or config.large_holder_max < 100:
            if latest_holder_ratio is None or not (config.large_holder_min <= latest_holder_ratio <= config.large_holder_max):
                continue

        if config.large_holder_inc:
            if latest_holder_ratio is None or prev_holder_ratio is None or latest_holder_ratio <= prev_holder_ratio:
                continue

        if config.foreign_buy_days_min > 0 and foreign_buy_days < config.foreign_buy_days_min:
            continue

        if config.trust_buy_days_min > 0 and trust_buy_days < config.trust_buy_days_min:
            continue

        if config.inst_buy_days_min > 0 and inst_buy_days < config.inst_buy_days_min:
            continue

        h_data = history_dict.get(sid, {})
        fpe26 = h_data.get("fpe_2026")
        fpe27 = h_data.get("fpe_2027")
        fpe28 = h_data.get("fpe_2028")
        is_gf = h_data.get("is_group_fight")
        
        peg27 = "N/A"
        if fpe26 is not None and fpe27 is not None and fpe27 > 0:
            try:
                growth = (fpe26 / fpe27) - 1
                if growth > 0:
                    peg27 = round(fpe27 / (growth * 100), 2)
                else:
                    peg27 = "N/A"
            except:
                pass

        results.append({
            "date": data['latest_date'],
            "stock_id": sid,
            "stock_name": data['name'],
            "close": close,
            "volume": vol,
            "pe": pe if pe is not None else "N/A",
            "pb": pb if pb is not None else "N/A",
            "yield": yld if yld is not None else 0,
            "千張大戶持股%": round(latest_holder_ratio, 2) if latest_holder_ratio is not None else "N/A",
            "大戶週增減%p": holder_change,
            "外資連買天數": foreign_buy_days,
            "投信連買天數": trust_buy_days,
            "三大法人連買天數": inst_buy_days,
            "2026_FPE": fpe26 if fpe26 is not None else "N/A",
            "2027_FPE": fpe27 if fpe27 is not None else "N/A",
            "2028_FPE": fpe28 if fpe28 is not None else "N/A",
            "2027_PEG": peg27,
            "是否是打群架": is_gf or "否"
        })
        
    return {"count": len(results), "data": results}

# ================================
# 3. 觸發爬蟲 (Scraper Tasks) 與即時進度追蹤
# ================================
SCRAPER_LOCK = threading.Lock()
SCRAPER_STATE = {
    "is_running": False,
    "task_type": None,
    "target_db": "tw_stock.db (本機 SQLite 主資料庫)",
    "target_table": "",
    "target_table_name": "",
    "current_step": "閒置中，等待觸發更新任務",
    "step_index": 0,
    "total_steps": 1,
    "progress_percent": 0,
    "status": "idle",  # 'idle', 'running', 'success', 'error'
    "started_at": None,
    "updated_at": None,
    "finished_at": None,
    "error_message": None,
    "logs": []
}

def set_scraper_progress(task_type, target_db, target_table, target_table_name, current_step, step_index, total_steps, percent, status="running", error=None):
    global SCRAPER_STATE
    with SCRAPER_LOCK:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        SCRAPER_STATE["is_running"] = (status == "running")
        SCRAPER_STATE["task_type"] = task_type
        SCRAPER_STATE["target_db"] = target_db
        SCRAPER_STATE["target_table"] = target_table
        SCRAPER_STATE["target_table_name"] = target_table_name
        SCRAPER_STATE["current_step"] = current_step
        SCRAPER_STATE["step_index"] = step_index
        SCRAPER_STATE["total_steps"] = total_steps
        SCRAPER_STATE["progress_percent"] = max(0, min(100, int(percent)))
        SCRAPER_STATE["status"] = status
        SCRAPER_STATE["updated_at"] = now_str
        if status == "running" and (step_index == 1 or not SCRAPER_STATE.get("started_at")):
            SCRAPER_STATE["started_at"] = now_str
            SCRAPER_STATE["finished_at"] = None
        if status in ["success", "error"]:
            SCRAPER_STATE["finished_at"] = now_str
        if error:
            SCRAPER_STATE["error_message"] = str(error)
        else:
            SCRAPER_STATE["error_message"] = None

        log_entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "step": f"[{step_index}/{total_steps}]",
            "message": current_step,
            "status": status
        }
        if "logs" not in SCRAPER_STATE or not isinstance(SCRAPER_STATE["logs"], list):
            SCRAPER_STATE["logs"] = []
        SCRAPER_STATE["logs"].append(log_entry)
        if len(SCRAPER_STATE["logs"]) > 25:
            SCRAPER_STATE["logs"] = SCRAPER_STATE["logs"][-25:]

def add_scraper_log(message, status="running"):
    global SCRAPER_STATE
    with SCRAPER_LOCK:
        log_entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "step": f"[{SCRAPER_STATE.get('step_index', 0)}/{SCRAPER_STATE.get('total_steps', 1)}]",
            "message": message,
            "status": status
        }
        if "logs" not in SCRAPER_STATE or not isinstance(SCRAPER_STATE["logs"], list):
            SCRAPER_STATE["logs"] = []
        SCRAPER_STATE["logs"].append(log_entry)
        if len(SCRAPER_STATE["logs"]) > 25:
            SCRAPER_STATE["logs"] = SCRAPER_STATE["logs"][-25:]

def run_scraper_task(task_type: str):
    global scraper
    import importlib
    import scraper
    try:
        importlib.reload(scraper)
    except Exception:
        pass
    try:
        if task_type in ('daily', 'all'):
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'daily_stock', '台股每日個股行情與法人期貨 (TWSE/TPEx/TAIFEX)', '步驟 1/7：正在連線臺灣證交所、櫃買中心與期交所爬取今日全市場價量、三大法人與期貨未平倉...', 1, 7, 14)
            print("[*] [API Scraper] 正在執行每日個股爬蟲 (TWSE + TPEx + 三大法人 + 期貨)...")
            scraper.main()
            add_scraper_log("✓ 台股上市櫃每日價量、三大法人與期貨數據已寫入 daily_stock / institutional_trades / institutional_futures")
            
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'daily_index', '大盤加權指數與市場廣度 (daily_index / market_breadth)', '步驟 2/7：正在更新大盤加權指數 (TAIEX) 歷史走勢與漲跌家數市場廣度...', 2, 7, 28)
            try:
                import sync_market_index
                sync_market_index.sync_taiex_to_sqlite(range_param="1mo")
                add_scraper_log("✓ 大盤加權指數與市場廣度同步完成並寫入 daily_index / market_breadth")
                print("[✓] [API Scraper] 大盤加權指數同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步大盤指數警告: {e}")
                print(f"[x] [API Scraper] 同步大盤指數失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'macro_indicators', '宏觀跨市場指標 (macro_indicators)', '步驟 3/7：正在同步美國 10 年期公債殖利率、美元指數、費半、原油等 16 項跨市場指標...', 3, 7, 42)
            try:
                import sync_macro_indicators
                sync_macro_indicators.sync_macro_to_sqlite(range_param="1mo")
                add_scraper_log("✓ 宏觀跨市場指標同步完成並寫入 macro_indicators")
                print("[✓] [API Scraper] 宏觀跨市場指標同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步宏觀指標警告: {e}")
                print(f"[x] [API Scraper] 同步宏觀指標失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'options_pc_ratio', '臺指選擇權 P/C Ratio (options_pc_ratio)', '步驟 4/7：正在自期交所抓取選擇權 Put/Call Ratio 籌碼多空指標...', 4, 7, 56)
            try:
                import sync_options_pc_ratio
                sync_options_pc_ratio.sync_options_pc_ratio()
                add_scraper_log("✓ 臺指選擇權 P/C Ratio 籌碼同步完成並寫入 options_pc_ratio")
                print("[✓] [API Scraper] 選擇權 P/C Ratio 同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步選擇權 P/C Ratio 警告: {e}")
                print(f"[x] [API Scraper] 同步選擇權 P/C Ratio 失敗: {e}")

            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'global_sovereign_daily', '全球主權泰坦 18 國 ETF (global_sovereign_daily)', '步驟 5/7：正在連線抓取全球 18 國主權 ETF (SPY, QQQ, EWT, EWY, EWJ 等) 最新日K行情...', 5, 7, 70)
            try:
                import sync_global_sovereign
                sync_global_sovereign.sync_global_sovereign_history(full_history=False)
                add_scraper_log("✓ 全球主權 18 國 ETF 最新日K已寫入 global_sovereign_daily")
                print("[✓] [API Scraper] 全球主權泰坦 ETF 同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步全球主權 ETF 警告: {e}")
                print(f"[x] [API Scraper] 同步全球主權 ETF 失敗: {e}")

            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'global_stock_daily', 'S&P 500 PIT 成分股與台股 0050∪0051 純上市池 (global_stock_daily)', '步驟 6/7：正在連線抓取美股 S&P 500 PIT 成分股與交叉補齊台股 0050∪0051 純上市池最新行情並更新實盤現價...', 6, 7, 85)
            try:
                import sync_global_titan_stocks
                sync_global_titan_stocks.download_and_save(full_history=False)
                add_scraper_log("✓ S&P 500 PIT 成分股與台股 0050∪0051 純上市最新行情已寫入 global_stock_daily / global_sovereign_positions")
                print("[✓] [API Scraper] S&P 500 PIT 與台股 0050∪0051 個股及持倉現價同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步全球泰坦個股警告: {e}")
                print(f"[x] [API Scraper] 同步全球泰坦個股失敗: {e}")
                
            try:
                import exp264_titan_sync
                add_scraper_log("⏳ 正在以最新資料庫重算台股因果泰坦 (exp_264，上限1億)...")
                add_scraper_log("✓ " + exp264_titan_sync.run())
            except Exception as e:
                add_scraper_log(f"⚠️ 台股因果泰坦 (exp_264) 更新警告: {e}")
                print(f"[x] [API Scraper] 台股因果泰坦更新失敗: {e}")

            set_scraper_progress(task_type, 'Supabase 雲端備援庫', 'stock_database_preview', '全資料庫雲端預覽快照、泰坦實盤與總筆數同步', '步驟 7/7：正在將全市場 24 表最新快照、全球泰坦看板與實盤持倉報價同步至雲端 Supabase...', 7, 7, 95)
            try:
                from stock_sync import run_full_sync
                run_full_sync()
                add_scraper_log("✓ 雲端 Supabase 快照、全球泰坦看板與即時資料量同步完成")
                print("[✓] [API Scraper] 雲端 Supabase 同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步雲端快照警告: {e}")
                print(f"[x] [API Scraper] 同步至雲端失敗: {e}")
                
            try:
                check_watchlist_alerts()
            except Exception as e:
                print(f"[x] [API Scraper] 警示檢查失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'daily_stock', '全市場與全球泰坦更新完成', '🎉 今日台股全市場、三大法人、大盤總經、選擇權與全球泰坦旗艦數據已全數同步更新完成！', 7, 7, 100, status="success")
            invalidate_db_status_cache()

        elif task_type == 'revenue':
            set_scraper_progress('revenue', 'tw_stock.db (本機 SQLite)', 'monthly_revenue', '月營收公告 (monthly_revenue)', '步驟 1/2：正在爬取公開資訊觀測站全市場最新月營收與年增率...', 1, 2, 40)
            print("[*] [API Scraper] 正在執行月營收爬蟲...")
            scraper.fetch_and_save_revenue()
            add_scraper_log("✓ 全市場最新月營收數據已寫入 monthly_revenue")
            
            set_scraper_progress('revenue', 'Supabase 雲端備援庫', 'stock_database_preview', '月營收雲端快照同步', '步驟 2/2：正在將最新營收快照與總筆數同步至雲端 Supabase...', 2, 2, 85)
            try:
                from stock_sync import run_full_sync
                run_full_sync()
                add_scraper_log("✓ 營收雲端快照同步完成")
                print("[✓] [API Scraper] 雲端 Supabase 同步完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 同步至雲端失敗: {e}")
                print(f"[x] [API Scraper] 同步至雲端失敗: {e}")
                
            set_scraper_progress('revenue', 'tw_stock.db (本機 SQLite)', 'monthly_revenue', '月營收更新完成', '🎉 全市場最新月營收資料已全數更新並同步完成！', 2, 2, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['global_sovereign', 'global_sovereign_daily', 'global_stock', 'global_stock_daily']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'global_sovereign_daily', '全球主權泰坦 18 國 ETF (global_sovereign_daily)', '步驟 1/3：正在更新全球主權 18 國 ETF 最新日K行情...', 1, 3, 25)
            print("[*] [API Scraper] 正在執行全球主權泰坦 ETF 與旗艦個股行情更新...")
            try:
                import sync_global_sovereign
                sync_global_sovereign.sync_global_sovereign_history(full_history=False)
                add_scraper_log("✓ 全球主權泰坦 18 國 ETF 已寫入 global_sovereign_daily")
                print("[✓] [API Scraper] 全球主權泰坦 ETF 更新完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新全球主權 ETF 警告: {e}")
                print(f"[x] [API Scraper] 更新全球主權 ETF 失敗: {e}")

            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'global_stock_daily', 'S&P 500 PIT 成分股與台股 0050∪0051 純上市池 (global_stock_daily)', '步驟 2/3：正在連線抓取美股 S&P 500 PIT 成分股與交叉補齊台股 0050∪0051 純上市前 150 大最新收盤行情...', 2, 3, 60)
            try:
                import sync_global_titan_stocks
                sync_global_titan_stocks.download_and_save(full_history=False)
                add_scraper_log("✓ S&P 500 PIT 與台股 0050∪0051 純上市最新報價已寫入 global_stock_daily 並同步更新實盤持倉現價")
                print("[✓] [API Scraper] S&P 500 PIT 與台股 0050∪0051 資產行情更新完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新全球旗艦資產警告: {e}")
                print(f"[x] [API Scraper] 更新全球旗艦資產失敗: {e}")
                
            set_scraper_progress(task_type, 'Supabase 雲端備援庫', 'stock_database_preview', '全球泰坦雲端同步', '步驟 3/3：正在同步全球泰坦最新數據與實盤持倉現價至雲端快照...', 3, 3, 90)
            try:
                from stock_sync import run_full_sync
                run_full_sync()
                add_scraper_log("✓ 全球泰坦雲端快照與實盤持倉報價同步完成")
            except Exception as e:
                print(f"[x] [API Scraper] 同步雲端快照失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'global_stock_daily', '全球泰坦更新完成', '🎉 全球主權 ETF、S&P 500 PIT 成分股與台股 0050∪0051 純上市池及實盤持倉最新收盤行情已全數更新完成！', 3, 3, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['macro', 'macro_indicators']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'macro_indicators', '宏觀跨市場指標 (macro_indicators)', '步驟 1/2：正在更新美債、美元、VIX 宏觀跨市場指標...', 1, 2, 50)
            print("[*] [API Scraper] 正在執行宏觀跨市場指標更新...")
            try:
                import sync_macro_indicators
                sync_macro_indicators.sync_macro_to_sqlite(range_param="1mo")
                add_scraper_log("✓ 宏觀跨市場指標已寫入 macro_indicators")
                print("[✓] [API Scraper] 宏觀跨市場指標更新完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新宏觀指標警告: {e}")
                print(f"[x] [API Scraper] 更新宏觀指標失敗: {e}")
                
            set_scraper_progress(task_type, 'Supabase 雲端備援庫', 'stock_database_preview', '宏觀指標雲端同步', '步驟 2/2：正在同步宏觀指標至雲端快照...', 2, 2, 85)
            try:
                from stock_sync import run_full_sync
                run_full_sync()
            except Exception as e:
                print(f"[x] [API Scraper] 同步雲端快照失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'macro_indicators', '宏觀指標更新完成', '🎉 宏觀總經跨市場指標更新完成！', 2, 2, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['options', 'options_pc_ratio']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'options_pc_ratio', '選擇權 P/C Ratio (options_pc_ratio)', '正在抓取期交所臺指選擇權 Put/Call Ratio...', 1, 1, 60)
            print("[*] [API Scraper] 正在執行選擇權 P/C Ratio 更新...")
            try:
                import sync_options_pc_ratio
                sync_options_pc_ratio.sync_options_pc_ratio()
                add_scraper_log("✓ 選擇權 P/C Ratio 籌碼已寫入 options_pc_ratio")
                print("[✓] [API Scraper] 選擇權 P/C Ratio 更新完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新選擇權 P/C Ratio 警告: {e}")
                print(f"[x] [API Scraper] 更新選擇權 P/C Ratio 失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'options_pc_ratio', '選擇權更新完成', '🎉 臺指選擇權 Put/Call Ratio 更新完成！', 1, 1, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['index', 'daily_index']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'daily_index', '大盤加權指數 (daily_index)', '正在更新大盤加權指數 (TAIEX) 走勢...', 1, 1, 60)
            print("[*] [API Scraper] 正在執行大盤加權指數更新...")
            try:
                import sync_market_index
                sync_market_index.sync_taiex_to_sqlite(range_param="1mo")
                add_scraper_log("✓ 大盤加權指數數據已寫入 daily_index")
                print("[✓] [API Scraper] 大盤加權指數更新完成")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新大盤指數警告: {e}")
                print(f"[x] [API Scraper] 更新大盤指數失敗: {e}")
                
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'daily_index', '大盤指數更新完成', '🎉 大盤加權指數更新完成！', 1, 1, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['futures', 'futures_chips', 'institutional_futures']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'institutional_futures', '期貨三大法人未平倉 (institutional_futures)', '正在連線期交所抓取臺指期貨三大法人未平倉數據...', 1, 1, 60)
            print("[*] [API Scraper] 正在執行期貨三大法人未平倉更新...")
            try:
                from datetime import datetime
                today_str = datetime.now().strftime('%Y%m%d')
                data = scraper.fetch_taifex_futures(today_str)
                if data:
                    scraper.insert_futures_data(data)
                    add_scraper_log(f"✓ 已寫入今日 ({today_str}) 期貨三大法人未平倉數據")
                else:
                    add_scraper_log(f"ℹ️ 今日 ({today_str}) 期貨未平倉尚無新資料或非交易日")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新期貨未平倉警告: {e}")
                print(f"[x] [API Scraper] 更新期貨未平倉失敗: {e}")

            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'institutional_futures', '期貨三大法人未平倉更新完成', '🎉 期貨三大法人未平倉更新完成！', 1, 1, 100, status="success")
            invalidate_db_status_cache()

        elif task_type in ['tdcc', 'shareholder_concentration', 'concentration']:
            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'shareholder_concentration', '集保股權分散表 (shareholder_concentration)', '正在自臺灣集中保管結算所抓取集保股權分散籌碼...', 1, 1, 60)
            print("[*] [API Scraper] 正在執行集保股權分散表更新...")
            try:
                scraper.fetch_tdcc_concentration()
                add_scraper_log("✓ 最新集保股權分散千張大戶籌碼已寫入 shareholder_concentration")
            except Exception as e:
                add_scraper_log(f"⚠️ 更新集保股權分散警告: {e}")
                print(f"[x] [API Scraper] 更新集保股權分散失敗: {e}")

            set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', 'shareholder_concentration', '集保股權分散表更新完成', '🎉 集保股權分散籌碼更新完成！', 1, 1, 100, status="success")
            invalidate_db_status_cache()

    except BaseException as e:
        set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', '', '更新異常中斷', f'❌ 執行過程發生錯誤: {str(e)}', 0, 1, 0, status="error", error=str(e))
        print(f"[x] [API Scraper] 任務 {task_type} 異常中斷: {e}")

VALID_SCRAPER_TASKS = [
    'daily', 'all', 'revenue', 
    'global_sovereign', 'global_sovereign_daily', 
    'global_stock', 'global_stock_daily', 
    'macro', 'macro_indicators', 
    'options', 'options_pc_ratio', 
    'index', 'daily_index',
    'futures', 'futures_chips', 'institutional_futures',
    'tdcc', 'shareholder_concentration', 'concentration'
]

@app.post("/api/scraper/{task_type}")
def start_scraper(task_type: str, background_tasks: BackgroundTasks):
    if task_type not in VALID_SCRAPER_TASKS:
        raise HTTPException(status_code=400, detail=f"Invalid task type: {task_type}")
    
    table_map = {
        'daily': ('daily_stock', '台股每日個股行情 (TWSE/TPEx)'),
        'revenue': ('monthly_revenue', '全市場最新月營收'),
        'global_stock': ('global_stock_daily', '全球泰坦旗艦資產'),
        'global_stock_daily': ('global_stock_daily', '全球泰坦旗艦資產'),
        'global_sovereign': ('global_sovereign_daily', '全球主權泰坦動態部位'),
        'global_sovereign_daily': ('global_sovereign_daily', '全球主權泰坦動態部位'),
        'macro': ('macro_indicators', '宏觀跨市場指標'),
        'macro_indicators': ('macro_indicators', '宏觀跨市場指標'),
        'options': ('options_pc_ratio', '選擇權 P/C Ratio'),
        'options_pc_ratio': ('options_pc_ratio', '選擇權 P/C Ratio'),
        'index': ('daily_index', '大盤加權指數'),
        'daily_index': ('daily_index', '大盤加權指數'),
        'futures': ('institutional_futures', '期貨三大法人未平倉'),
        'futures_chips': ('institutional_futures', '期貨三大法人未平倉'),
        'institutional_futures': ('institutional_futures', '期貨三大法人未平倉'),
        'tdcc': ('shareholder_concentration', '集保股權分散表'),
        'concentration': ('shareholder_concentration', '集保股權分散表'),
        'shareholder_concentration': ('shareholder_concentration', '集保股權分散表'),
    }
    t_id, t_name = table_map.get(task_type, ('tw_stock', task_type))
    
    with SCRAPER_LOCK:
        SCRAPER_STATE["logs"] = []
    set_scraper_progress(task_type, 'tw_stock.db (本機 SQLite)', t_id, t_name, f'任務啟動中：準備更新「{t_name}」...', 1, 5, 5, status="running")
    
    threading.Thread(target=run_scraper_task, args=(task_type,), daemon=True).start()
    return {
        "status": "Task started in background",
        "task": task_type,
        "target_db": "tw_stock.db (本機 SQLite 主資料庫)",
        "target_table": t_id,
        "target_table_name": t_name
    }

@app.get("/api/scraper/status")
def get_scraper_status():
    with SCRAPER_LOCK:
        return dict(SCRAPER_STATE)

@app.get("/api/scraper/history_status")
def get_history_backfill_status():
    progress_file = "/Users/huanggin-chen/openclaw_test/backfill_twse_progress.json"
    if os.path.exists(progress_file):
        try:
            with open(progress_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            return {"status": "error", "detail": str(e)}
    return {"status": "idle"}

# ================================
# 3.5 個人持股監控與 Gemini 分析
# ================================
class PortfolioItem(BaseModel):
    stock_id: str
    stock_name: str | None = None
    buy_price: float | None = None
    notes: str | None = None
    auto_analyze: int | None = 1

@app.get("/api/portfolio")
def get_portfolio():
    conn = get_db_connection()
    cursor = conn.cursor()
    # 查詢持股，並透過子查詢取得每檔股票在 daily_stock 中的最新收盤價與最新日期，以及最新的診斷信號、診斷日期與輿情指標
    cursor.execute("""
        SELECT 
            p.stock_id, 
            p.stock_name, 
            p.buy_price, 
            p.notes,
            p.auto_analyze,
            (SELECT closing_price FROM daily_stock d WHERE d.stock_id = p.stock_id AND d.closing_price IS NOT NULL ORDER BY d.date DESC LIMIT 1) as latest_price,
            (SELECT date FROM daily_stock d WHERE d.stock_id = p.stock_id AND d.closing_price IS NOT NULL ORDER BY d.date DESC LIMIT 1) as latest_date,
            (SELECT stock_name FROM daily_stock d WHERE d.stock_id = p.stock_id ORDER BY d.date DESC LIMIT 1) as official_name,
            (SELECT h.signal FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as latest_signal,
            (SELECT h.date FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as latest_analysis_date,
            (SELECT h.sentiment_score FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as sentiment_score,
            (SELECT h.sentiment_direction FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as sentiment_direction,
            (SELECT h.has_rumor FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as has_rumor
        FROM portfolio p
    """)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    # 整理資料，如果自訂名稱為空則套用官方名稱
    for row in rows:
        if not row['stock_name'] or row['stock_name'] == '未知股':
            row['stock_name'] = row['official_name'] or '未知股'
    return rows

@app.post("/api/portfolio")
def add_portfolio(item: PortfolioItem):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 自動補齊股票名稱
    name = item.stock_name
    if not name:
        cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? LIMIT 1", (item.stock_id,))
        row = cursor.fetchone()
        if row:
            name = row[0]
        else:
            name = "未知股"

    cursor.execute("""
        INSERT INTO portfolio (stock_id, stock_name, buy_price, notes, auto_analyze)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(stock_id) DO UPDATE SET
            stock_name = excluded.stock_name,
            buy_price = excluded.buy_price,
            notes = excluded.notes,
            auto_analyze = excluded.auto_analyze
    """, (item.stock_id, name, item.buy_price, item.notes, item.auto_analyze))
    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"成功新增/更新持股 {item.stock_id}"}

@app.post("/api/portfolio/{stock_id}/toggle_analyze")
def toggle_portfolio_auto_analyze(stock_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT auto_analyze FROM portfolio WHERE stock_id = ?", (stock_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Stock not found in portfolio")
    current_val = row['auto_analyze']
    new_val = 0 if current_val == 1 else 1
    cursor.execute("UPDATE portfolio SET auto_analyze = ? WHERE stock_id = ?", (new_val, stock_id))
    conn.commit()
    conn.close()
    return {"status": "ok", "auto_analyze": new_val}

@app.delete("/api/portfolio/{stock_id}")
def delete_portfolio(stock_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM portfolio WHERE stock_id = ?", (stock_id,))
    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"已刪除持股 {stock_id}"}

@app.get("/api/portfolio/ml_predict")
def predict_portfolio(model_type: str = 'lightgbm'):
    """
    一鍵計算/回傳所有個人持股在指定 AI 模型下的「未來 20 天突破勝率與跌破風險」
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT stock_id FROM portfolio")
    rows = cursor.fetchall()
    conn.close()
    stock_ids = [row['stock_id'] for row in rows]
    return ml_engine.predict_portfolio_stocks(stock_ids=stock_ids, model_type=model_type)

# ================================
# 3.54 泰坦旗艦版實盤每日監控與對帳 (Titan Live Monitor) APIs
# ================================
class TitanBuyRequest(BaseModel):
    stock_id: str
    price: float
    shares: int
    role: str | None = None
    date: str | None = None

class TitanSellRequest(BaseModel):
    stock_id: str
    price: float
    shares: int | None = None
    reason: str | None = "平倉賣出"
    date: str | None = None

class TitanCashRequest(BaseModel):
    set_amount: float | None = None
    deposit: float | None = None
    withdraw: float | None = None

@app.get("/api/titan/live")
def get_titan_live_state():
    """取得泰坦實盤總覽、持倉停損狀態、大盤雷達與對帳數據 (自本地 tw_stock.db 讀取)"""
    conn = get_db_connection()
    c = conn.cursor()

    # 1. 讀取帳戶基本資料
    c.execute("SELECT key, value FROM titan_live_account")
    acc_rows = dict(c.fetchall())
    init_cap = float(acc_rows.get('initial_capital', 1000000.0))
    cash = float(acc_rows.get('current_cash', 1000000.0))
    peak_eq = float(acc_rows.get('peak_equity', 1000000.0))

    # 2. 讀取持倉並結合最新現價
    c.execute("SELECT * FROM titan_live_positions")
    pos_rows = [dict(r) for r in c.fetchall()]
    
    tot_stock_val = 0.0
    FEE_R = 0.001425 * 0.6
    TAX_R = 0.003

    for p in pos_rows:
        sid = p['stock_id']
        c.execute("SELECT date, closing_price, stock_name FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 65", (sid,))
        price_rows = c.fetchall()
        if price_rows:
            cur_px = float(price_rows[0]['closing_price'])
            d_raw = str(price_rows[0]['date'] or '').strip()
            p['price_date'] = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
            if not p.get('stock_name') or p.get('stock_name') == sid:
                p['stock_name'] = price_rows[0]['stock_name']
            px_list = [float(r['closing_price']) for r in price_rows if r['closing_price'] is not None]
            ma60 = float(sum(px_list[:60]) / len(px_list[:60])) if len(px_list) >= 60 else cur_px
        else:
            cur_px = float(p.get('current_price') or p.get('entry_price') or 0.0)
            ma60 = cur_px

        p['current_price'] = round(cur_px, 2)
        hh = max(float(p.get('highest_price') or cur_px), cur_px)
        p['highest_price'] = round(hh, 2)
        val = p['shares'] * cur_px
        p['market_value'] = round(val, 2)
        cost = float(p.get('cost_amount') or (p['shares'] * p['entry_price']))
        p['cost_amount'] = round(cost, 2)
        p['unrealized_pnl'] = round(val * (1.0 - FEE_R - TAX_R) - cost, 2)
        p['unrealized_ret_pct'] = round((val / cost - 1.0) * 100.0, 2) if cost > 0 else 0.0
        p['ma60_price'] = round(ma60, 2)

        # 停損邏輯
        entry_px = float(p['entry_price'])
        is_leader = '70%' in (p.get('role') or '') or '王者' in (p.get('role') or '')
        stop_px = ma60
        stop_type = "🛡️ 季線 60MA 防守"

        if not is_leader and (hh / entry_px - 1.0 >= 0.60):
            trail_stop = round(hh * 0.80, 2)
            if trail_stop > stop_px:
                stop_px = trail_stop
                stop_type = "🎯 +60% 移動停利鎖定線 (回吐20%)"
        elif (hh >= entry_px * 1.15) and (entry_px > stop_px):
            stop_px = round(entry_px, 2)
            stop_type = "🎯 +15% 保本平手鎖利線"
        elif not is_leader:
            hard_stop = round(entry_px * 0.88, 2)
            if hard_stop > stop_px:
                stop_px = hard_stop
                stop_type = "⚡ 衛星 -12% 硬停損線"

        p['stop_loss_price'] = round(stop_px, 2)
        p['stop_type'] = stop_type
        dist = (cur_px / stop_px - 1.0) * 100.0 if stop_px > 0 else 0.0
        p['dist_to_stop_pct'] = round(dist, 2)

        if cur_px < stop_px:
            p['alert'] = "🚨 跌破停損線！建議賣出"
        elif dist <= 3.0:
            p['alert'] = f"⚠️ 逼近停損點！距停損僅 {dist:.1f}%"
        elif "+60%" in stop_type:
            p['alert'] = "🚀 爆賺主升段！移動停利中"
        elif "保本" in stop_type:
            p['alert'] = "🛡️ 成本保本已鎖定"
        else:
            p['alert'] = "✅ 多頭航行中"

        tot_stock_val += val

    # 3. 大盤宏觀
    c.execute("SELECT date, close FROM daily_index ORDER BY date DESC LIMIT 65")
    idx_rows = c.fetchall()
    if idx_rows:
        latest_tx_date = idx_rows[0]['date']
        tx_close = float(idx_rows[0]['close'])
        tx_closes = [float(r['close']) for r in idx_rows if r['close'] is not None]
        tx_ma20 = float(sum(tx_closes[:20]) / len(tx_closes[:20])) if len(tx_closes) >= 20 else tx_close
        tx_ma60 = float(sum(tx_closes[:60]) / len(tx_closes[:60])) if len(tx_closes) >= 60 else tx_close
        tx_bullish = (tx_close >= tx_ma20) and (tx_close >= tx_ma60)
    else:
        latest_tx_date = ""
        tx_close = 0.0; tx_ma20 = 0.0; tx_ma60 = 0.0; tx_bullish = True

    # 3.5 取得台股泰坦候選標的最新收盤價與 60MA，供前端「持倉更動建議」與實盤帳本動態對照
    tw_live_prices = {}
    candidate_sids = set(['2408', '6213', '2449', '8069', '3037', '3443', '2330', '2382', '2317', '3017', '3661'])
    for p in pos_rows:
        if p.get('stock_id'):
            candidate_sids.add(str(p['stock_id']))
        c.execute("UPDATE titan_live_positions SET current_price = ? WHERE stock_id = ?", (p['current_price'], p['stock_id']))
    conn.commit()
    for sid in candidate_sids:
        c.execute("SELECT date, closing_price, stock_name FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 65", (sid,))
        s_rows = c.fetchall()
        if s_rows:
            s_px = round(float(s_rows[0]['closing_price']), 2)
            d_raw = str(s_rows[0]['date'] or '').strip()
            d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
            px_arr = [float(r['closing_price']) for r in s_rows if r['closing_price'] is not None]
            s_ma60 = round(float(sum(px_arr[:60]) / len(px_arr[:60])), 2) if len(px_arr) >= 60 else s_px
            tw_live_prices[sid] = {
                "stock_id": sid,
                "stock_name": s_rows[0]['stock_name'] or sid,
                "price": s_px,
                "price_date": d_fmt,
                "ma60": s_ma60
            }

    # 4. 已實現交易紀錄 (同時補齊前端對帳所需之 cash_flow_twd, tax_fee, note 等欄位與初始入金紀錄)
    c.execute("SELECT * FROM titan_live_trades ORDER BY id DESC LIMIT 100")
    raw_trades = [dict(r) for r in c.fetchall()]
    conn.close()

    trade_rows = []
    has_deposit = False
    for r in raw_trades:
        act = str(r.get('action') or '')
        amt = float(r.get('amount') or 0.0)
        fee_val = float(r.get('fee') or 0.0)
        tax_val = float(r.get('tax') or 0.0)
        tax_fee = round(fee_val + tax_val, 2)
        if act in ('投入現金', 'DEPOSIT', '入金'):
            has_deposit = True
            cf_twd = round(amt if amt != 0 else init_cap, 0)
        elif act in ('提取資金', 'WITHDRAW', '出金'):
            cf_twd = -round(abs(amt), 0)
        elif act in ('SELL', '賣出'):
            cf_twd = round(amt - tax_fee, 0)
        else:
            cf_twd = -round(amt + tax_fee, 0)

        r['tax_fee'] = tax_fee
        r['cash_flow_twd'] = cf_twd
        r['realized_pnl_twd'] = r.get('realized_pnl') if act in ('SELL', '賣出') else None
        r['realized_return_pct'] = r.get('return_pct') if act in ('SELL', '賣出') else None
        r['note'] = r.get('exit_reason') or ''
        trade_rows.append(r)

    if not has_deposit:
        trade_rows.append({
            "id": "tx_tw_init_deposit",
            "date": "2026-10-01",
            "action": "投入現金",
            "stock_id": "-",
            "stock_name": "初始本金入金",
            "role": "系統本金",
            "shares": 0,
            "price": 0,
            "amount": init_cap,
            "fee": 0,
            "tax": 0,
            "tax_fee": 0,
            "cash_flow_twd": init_cap,
            "realized_pnl": 0,
            "return_pct": 0,
            "realized_pnl_twd": None,
            "realized_return_pct": None,
            "exit_reason": "台股泰坦旗艦策略 初始開倉本金",
            "note": "台股泰坦旗艦策略 初始開倉本金"
        })

    total_equity = round(cash + tot_stock_val, 2)
    peak_eq = max(peak_eq, total_equity)
    cum_ret = round((total_equity / init_cap - 1.0) * 100.0, 2) if init_cap > 0 else 0.0
    dd = round((total_equity / peak_eq - 1.0) * 100.0, 2) if peak_eq > 0 else 0.0
    expo = round((tot_stock_val / total_equity) * 100.0, 1) if total_equity > 0 else 0.0

    for p in pos_rows:
        p['weight_pct'] = round((p['market_value'] / total_equity) * 100.0, 1) if total_equity > 0 else 0.0

    # 交易統計
    sells = [t for t in trade_rows if t.get('action') in ('SELL', '賣出')]
    wins = [t for t in sells if (t.get('realized_pnl') or 0) > 0]
    wr = round(len(wins) / len(sells) * 100.0, 1) if sells else 0.0
    tot_realized = round(sum(t.get('realized_pnl', 0) or 0 for t in sells), 2)
    w_sum = sum(t.get('realized_pnl', 0) or 0 for t in wins)
    l_sum = abs(sum(t.get('realized_pnl', 0) or 0 for t in sells if (t.get('realized_pnl') or 0) < 0))
    pf = round(w_sum / l_sum, 2) if l_sum > 0 else 0.0

    return {
        "status": "ok",
        "account": {
            "initial_capital": init_cap,
            "current_cash": round(cash, 2),
            "stock_value": round(tot_stock_val, 2),
            "total_equity": total_equity,
            "peak_equity": round(peak_eq, 2),
            "cum_return_pct": cum_ret,
            "drawdown_pct": dd,
            "exposure_pct": expo,
            "cash_reserve_pct": round(100.0 - expo, 1),
            "realized_trades": len(sells),
            "win_rate": wr,
            "profit_factor": pf,
            "total_realized_pnl": tot_realized
        },
        "taiex": {
            "date": latest_tx_date,
            "close": round(tx_close, 2),
            "ma20": round(tx_ma20, 2),
            "ma60": round(tx_ma60, 2),
            "bullish": tx_bullish
        },
        "live_prices": tw_live_prices,
        "positions": pos_rows,
        "trades": trade_rows
    }

@app.get("/api/taiwan_causal_titan/live")
def get_taiwan_causal_titan_live():
    """取得台股因果量化泰坦旗艦版 (Causal ML & LLM) 實盤數據、持倉、曲線與績效"""
    json_path = os.path.join(os.path.dirname(__file__), 'frontend', 'src', 'data', 'taiwan_causal_titan_data.json')
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"status": "error", "message": "data not found"}

@app.post("/api/titan/live/buy")
def record_titan_buy(req: TitanBuyRequest):
    """買進成交紀錄 (存入本地 tw_stock.db)"""
    conn = get_db_connection()
    c = conn.cursor()
    
    # 查個股名稱
    c.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? ORDER BY date DESC LIMIT 1", (req.stock_id,))
    row = c.fetchone()
    name = row['stock_name'] if row else req.stock_id
    
    role = req.role or "👑 王者泰坦 (70%)"
    target_w = 70.0 if ('70%' in role or '王者' in role) else 15.0
    gross_amt = req.shares * req.price
    fee = round(gross_amt * (0.001425 * 0.6), 2)
    tot_cost = round(gross_amt + fee, 2)
    dt_str = req.date or datetime.now().strftime('%Y%m%d')

    # 更新現金
    c.execute("SELECT value FROM titan_live_account WHERE key = 'current_cash'")
    cash_row = c.fetchone()
    cur_cash = float(cash_row['value']) if cash_row else 1000000.0
    new_cash = round(cur_cash - tot_cost, 2)
    c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES ('current_cash', ?)", (str(new_cash),))

    # 更新/新增持倉
    c.execute("SELECT * FROM titan_live_positions WHERE stock_id = ?", (req.stock_id,))
    existing = c.fetchone()
    if existing:
        new_shares = existing['shares'] + req.shares
        new_cost = existing['cost_amount'] + tot_cost
        avg_px = round(new_cost / new_shares, 2)
        c.execute("""
            UPDATE titan_live_positions 
            SET shares = ?, cost_amount = ?, entry_price = ?, highest_price = max(highest_price, ?)
            WHERE stock_id = ?
        """, (new_shares, new_cost, avg_px, req.price, req.stock_id))
    else:
        c.execute("""
            INSERT INTO titan_live_positions (
                stock_id, stock_name, role, target_weight_pct, entry_date, entry_price, 
                shares, cost_amount, current_price, highest_price, holding_days, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '')
        """, (req.stock_id, name, role, target_w, dt_str, req.price, req.shares, tot_cost, req.price, req.price))

    # 紀錄交易紀錄
    c.execute("""
        INSERT INTO titan_live_trades (
            date, action, stock_id, stock_name, role, price, shares, amount, fee, tax, realized_pnl, return_pct, exit_reason
        ) VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, '建倉買進')
    """, (dt_str, req.stock_id, name, role, req.price, req.shares, gross_amt, fee))

    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"成功買進 {name} ({req.stock_id}) {req.shares} 股！"}

@app.post("/api/titan/live/sell")
def record_titan_sell(req: TitanSellRequest):
    """平倉賣出紀錄 (存入本地 tw_stock.db)"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM titan_live_positions WHERE stock_id = ?", (req.stock_id,))
    pos = c.fetchone()
    if not pos:
        conn.close()
        raise HTTPException(status_code=404, detail=f"持倉中找不到股票 {req.stock_id}")

    cur_shares = pos['shares']
    sell_shares = cur_shares if (req.shares is None or req.shares >= cur_shares) else req.shares
    gross_amt = sell_shares * req.price
    fee = round(gross_amt * (0.001425 * 0.6), 2)
    tax = round(gross_amt * 0.003, 2)
    net_proceeds = round(gross_amt - fee - tax, 2)

    cost_basis = pos['cost_amount'] * (sell_shares / cur_shares)
    pnl = round(net_proceeds - cost_basis, 2)
    ret_pct = round((net_proceeds / cost_basis - 1.0) * 100.0, 2) if cost_basis > 0 else 0.0
    dt_str = req.date or datetime.now().strftime('%Y%m%d')

    # 更新現金
    c.execute("SELECT value FROM titan_live_account WHERE key = 'current_cash'")
    cash_row = c.fetchone()
    cur_cash = float(cash_row['value']) if cash_row else 0.0
    new_cash = round(cur_cash + net_proceeds, 2)
    c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES ('current_cash', ?)", (str(new_cash),))

    # 更新持倉
    if sell_shares >= cur_shares:
        c.execute("DELETE FROM titan_live_positions WHERE stock_id = ?", (req.stock_id,))
    else:
        c.execute("""
            UPDATE titan_live_positions 
            SET shares = shares - ?, cost_amount = cost_amount - ?
            WHERE stock_id = ?
        """, (sell_shares, cost_basis, req.stock_id))

    # 紀錄交易紀錄
    c.execute("""
        INSERT INTO titan_live_trades (
            date, action, stock_id, stock_name, role, price, shares, amount, fee, tax, realized_pnl, return_pct, exit_reason
        ) VALUES (?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (dt_str, req.stock_id, pos['stock_name'], pos['role'], req.price, sell_shares, gross_amt, fee, tax, pnl, ret_pct, req.reason or '平倉賣出'))

    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"成功平倉 {pos['stock_name']} ({req.stock_id})！損益: {pnl:+,.0f} 元 ({ret_pct:+.2f}%)"}

@app.post("/api/titan/live/cash")
def update_titan_cash(req: TitanCashRequest):
    """校準現金水位 / 出入金 (存入本地 tw_stock.db)"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT value FROM titan_live_account WHERE key = 'current_cash'")
    cash_row = c.fetchone()
    cur_cash = float(cash_row['value']) if cash_row else 1000000.0

    if req.set_amount is not None:
        new_cash = float(req.set_amount)
    elif req.deposit is not None:
        new_cash = cur_cash + float(req.deposit)
        c.execute("SELECT value FROM titan_live_account WHERE key = 'initial_capital'")
        cap_row = c.fetchone()
        cur_cap = float(cap_row['value']) if cap_row else 1000000.0
        c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES ('initial_capital', ?)", (str(cur_cap + float(req.deposit)),))
    elif req.withdraw is not None:
        new_cash = cur_cash - float(req.withdraw)
        c.execute("SELECT value FROM titan_live_account WHERE key = 'initial_capital'")
        cap_row = c.fetchone()
        cur_cap = float(cap_row['value']) if cap_row else 1000000.0
        c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES ('initial_capital', ?)", (str(cur_cap - float(req.withdraw)),))
    else:
        new_cash = cur_cash

    c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES ('current_cash', ?)", (str(round(new_cash, 2)),))
    conn.commit()
    conn.close()
    return {"status": "ok", "current_cash": round(new_cash, 2)}

class TitanSyncRequest(BaseModel):
    positions: list[dict] | None = None
    trades: list[dict] | None = None
    account: dict | None = None

@app.post("/api/titan/sync")
def sync_titan_live_state(req: TitanSyncRequest):
    """將前端台股泰坦持股部位、交易紀錄與帳戶資料同步持久化至本地 tw_stock.db"""
    conn = get_db_connection()
    c = conn.cursor()
    try:
        if req.account:
            for k, v in req.account.items():
                c.execute("INSERT OR REPLACE INTO titan_live_account (key, value) VALUES (?, ?)", (str(k), str(v)))
        
        if req.positions is not None:
            c.execute("DELETE FROM titan_live_positions")
            for p in req.positions:
                c.execute("""
                    INSERT INTO titan_live_positions (
                        stock_id, stock_name, role, target_weight_pct, entry_date, entry_price, 
                        shares, cost_amount, current_price, highest_price, holding_days, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(p.get('stock_id', '')),
                    str(p.get('stock_name', '')),
                    str(p.get('role', '')),
                    float(p.get('target_weight_pct', 0.0) or 0.0),
                    str(p.get('entry_date', '')),
                    float(p.get('entry_price', 0.0) or 0.0),
                    int(p.get('shares', 0) or 0),
                    float(p.get('cost_amount', 0.0) or (float(p.get('shares', 0) or 0) * float(p.get('entry_price', 0.0) or 0))),
                    float(p.get('current_price', 0.0) or p.get('entry_price', 0.0) or 0.0),
                    float(p.get('highest_price', 0.0) or p.get('current_price', 0.0) or p.get('entry_price', 0.0) or 0.0),
                    int(p.get('holding_days', 1) or 1),
                    str(p.get('stop_condition') or p.get('notes') or '')
                ))
        
        if req.trades is not None:
            c.execute("DELETE FROM titan_live_trades")
            for t in req.trades:
                raw_id = t.get('id')
                safe_id = int(raw_id) if (isinstance(raw_id, int) or (isinstance(raw_id, str) and raw_id.isdigit())) else None
                shares_val = int(float(t.get('shares', 0) or 0))
                price_val = float(t.get('price', 0.0) or 0.0)
                cf_val = float(t.get('cash_flow_twd', 0.0) or 0.0)
                amt_val = float(t.get('amount', 0.0) or (shares_val * price_val) or abs(cf_val))
                c.execute("""
                    INSERT INTO titan_live_trades (
                        id, date, action, stock_id, stock_name, role, price, shares, amount, fee, tax, realized_pnl, return_pct, exit_reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    safe_id,
                    str(t.get('date', '')),
                    str(t.get('action', '')),
                    str(t.get('stock_id', '')),
                    str(t.get('stock_name', '')),
                    str(t.get('role', '')),
                    price_val,
                    shares_val,
                    amt_val,
                    float(t.get('tax_fee') or t.get('fee') or 0.0),
                    float(t.get('tax', 0.0) or 0.0),
                    float(t.get('realized_pnl_twd') or t.get('realized_pnl') or 0.0),
                    float(t.get('realized_return_pct') or t.get('return_pct') or 0.0),
                    str(t.get('note') or t.get('exit_reason') or '')
                ))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Sync titan failed: {e}")
    finally:
        conn.close()
    
    return {"status": "ok", "message": "台股泰坦持股與交易紀錄已成功同步至本地資料庫！"}

class GlobalTitanSyncRequest(BaseModel):
    positions: list[dict] | None = None
    trades: list[dict] | None = None
    account: dict | None = None

@app.get("/api/global_titan/live")
def get_global_titan_live_state():
    """取得全球主權泰坦實盤持倉、交易紀錄與帳戶資料"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT key, value FROM global_sovereign_account")
    acc = dict(c.fetchall())
    c.execute("SELECT * FROM global_sovereign_positions")
    positions = [dict(r) for r in c.fetchall()]
    # 自動自 global_stock_daily 與 daily_stock 取得各持股標的最新報價日期與收盤價
    for p in positions:
        ticker = p.get('ticker')
        if ticker:
            c.execute("SELECT date, close FROM global_stock_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 1", (ticker,))
            row = c.fetchone()
            if row:
                p['price_date'] = row[0]
                if row[1] is not None:
                    p['current_price'] = round(float(row[1]), 2)
            if str(ticker).endswith('.TW'):
                sid = str(ticker).split('.')[0]
                c.execute("SELECT date, closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 1", (sid,))
                tw_row = c.fetchone()
                if tw_row and tw_row[1] is not None:
                    d_raw = str(tw_row[0]).strip()
                    d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                    if not p.get('price_date') or d_fmt >= p['price_date']:
                        p['price_date'] = d_fmt
                        p['current_price'] = round(float(tw_row[1]), 2)
    c.execute("SELECT * FROM global_sovereign_trades ORDER BY date DESC, id ASC")
    trades = [dict(r) for r in c.fetchall()]
    conn.close()

    has_deposit = any(t.get('action') == '投入現金' or t.get('id') == 'tx_init_deposit' for t in trades)
    if not has_deposit:
        init_cap = float(acc.get('initial_capital', 1000000.0) or 1000000.0)
        trades.append({
            "id": "tx_init_deposit",
            "date": "2026-10-01",
            "action": "投入現金",
            "ticker": "-",
            "name": "初始本金入金",
            "currency": "TWD",
            "shares": 0,
            "price": 0,
            "tax_fee": 0,
            "cash_flow_twd": init_cap,
            "realized_pnl_twd": None,
            "realized_return_pct": None,
            "note": "全球泰坦旗艦策略 初始開倉本金"
        })

    return {
        "status": "ok",
        "account": acc,
        "positions": positions,
        "trades": trades
    }

@app.post("/api/global_titan/sync")
def sync_global_titan_live_state(req: GlobalTitanSyncRequest):
    """將前端全球主權泰坦持股部位、交易紀錄與帳戶資料同步持久化至本地 tw_stock.db"""
    conn = get_db_connection()
    c = conn.cursor()
    try:
        if req.account:
            for k, v in req.account.items():
                c.execute("INSERT OR REPLACE INTO global_sovereign_account (key, value) VALUES (?, ?)", (str(k), str(v)))
        
        if req.positions is not None:
            c.execute("DELETE FROM global_sovereign_positions")
            for p in req.positions:
                ticker = p.get('ticker')
                real_cur_price = float(p.get('current_price', 0.0) or p.get('entry_price', 0.0) or 0.0)
                if ticker:
                    c.execute("SELECT date, close FROM global_stock_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 1", (str(ticker),))
                    px_row = c.fetchone()
                    g_dt = px_row[0] if px_row else ""
                    if px_row and px_row[1] is not None:
                        real_cur_price = round(float(px_row[1]), 2)
                    if str(ticker).endswith('.TW'):
                        sid = str(ticker).split('.')[0]
                        c.execute("SELECT date, closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 1", (sid,))
                        tw_row = c.fetchone()
                        if tw_row and tw_row[1] is not None:
                            d_raw = str(tw_row[0]).strip()
                            d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                            if not g_dt or d_fmt >= g_dt:
                                real_cur_price = round(float(tw_row[1]), 2)
                c.execute("""
                    INSERT INTO global_sovereign_positions (
                        id, ticker, name, market, currency, role, shares, entry_price, current_price, entry_date, entry_fee, stop_loss_price, stop_condition
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    str(p.get('id', '')),
                    str(p.get('ticker', '')),
                    str(p.get('name', '')),
                    str(p.get('market', '')),
                    str(p.get('currency', 'USD')),
                    str(p.get('role', '')),
                    float(p.get('shares', 0.0) or 0.0),
                    float(p.get('entry_price', 0.0) or 0.0),
                    real_cur_price,
                    str(p.get('entry_date', '')),
                    float(p.get('entry_fee', 0.0) or 0.0),
                    float(p.get('stop_loss_price', 0.0) or 0.0),
                    str(p.get('stop_condition', ''))
                ))
        
        if req.trades is not None and len(req.trades) > 0:
            # 防禦校驗：嚴防異常快取或幽靈部位反向污染資料庫
            has_corrupt_shares = any(float(t.get('shares', 0.0) or 0.0) > 1000 for t in req.trades)
            total_cash = sum(float(t.get('cash_flow_twd', 0.0) or 0.0) for t in req.trades)
            if not has_corrupt_shares and total_cash >= -5000:
                c.execute("DELETE FROM global_sovereign_trades")
                for t in req.trades:
                    c.execute("""
                        INSERT INTO global_sovereign_trades (
                            id, date, action, ticker, name, currency, shares, price, tax_fee, cash_flow_twd, realized_pnl_twd, realized_return_pct, note
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        str(t.get('id', '')),
                        str(t.get('date', '')),
                        str(t.get('action', '')),
                        str(t.get('ticker', '')),
                        str(t.get('name', '')),
                        str(t.get('currency', 'USD')),
                        float(t.get('shares', 0.0) or 0.0),
                        float(t.get('price', 0.0) or 0.0),
                        float(t.get('tax_fee', 0.0) or 0.0),
                        float(t.get('cash_flow_twd', 0.0) or 0.0),
                        float(t.get('realized_pnl_twd', 0.0) or 0.0) if t.get('realized_pnl_twd') is not None else None,
                        float(t.get('realized_return_pct', 0.0) or 0.0) if t.get('realized_return_pct') is not None else None,
                        str(t.get('note', ''))
                    ))
            else:
                print(f"[Warning] /api/global_titan/sync 攔截到異常交易流水帳 (corrupt_shares={has_corrupt_shares}, total_cash={total_cash})，拒絕污染資料庫！")
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Sync global titan failed: {e}")
    finally:
        conn.close()
    
    return {"status": "ok", "message": "全球主權泰坦持股與交易紀錄已成功同步至本地資料庫！"}



# ================================
# 3.55 追蹤與警示清單 (Watchlist & Alerts) APIs
# ================================
class WatchlistItem(BaseModel):
    stock_id: str
    stock_name: str | None = None
    target_price_high: float | None = None
    target_price_low: float | None = None
    compare_ma5: int | None = 0  # 0: None, 1: > MA5, -1: < MA5
    compare_ma20: int | None = 0
    compare_ma60: int | None = 0

class WatchlistAddRequest(BaseModel):
    stock_ids: list[str]

def check_watchlist_alerts():
    import datetime
    import requests
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Read Telegram settings
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('telegram_bot_token', 'telegram_chat_id')")
    settings_rows = cursor.fetchall()
    settings_dict = {r['key']: r['value'] for r in settings_rows}
    token = settings_dict.get('telegram_bot_token')
    chat_id = settings_dict.get('telegram_chat_id')
    
    has_telegram = bool(token and chat_id)
    
    # 2. Fetch all watchlist items
    cursor.execute("SELECT * FROM watchlist")
    watchlist_items = cursor.fetchall()
    
    triggered_alerts = []
    
    for item in watchlist_items:
        stock_id = item['stock_id']
        stock_name = item['stock_name']
        target_high = item['target_price_high']
        target_low = item['target_price_low']
        compare_ma5 = item['compare_ma5']
        compare_ma20 = item['compare_ma20']
        compare_ma60 = item['compare_ma60']
        
        # Fetch latest 60 prices
        cursor.execute("""
            SELECT closing_price, date, stock_name
            FROM daily_stock 
            WHERE stock_id = ? AND closing_price IS NOT NULL 
            ORDER BY date DESC LIMIT 60
        """, (stock_id,))
        price_rows = cursor.fetchall()
        
        if not price_rows:
            continue
            
        prices = [r['closing_price'] for r in price_rows]
        latest_price = prices[0]
        latest_date = price_rows[0]['date']
        official_name = price_rows[0]['stock_name']
        
        # If stored name is empty or default, use the official one
        if not stock_name or stock_name == "未知股":
            stock_name = official_name or "未知股"
            
        n = len(prices)
        ma5 = sum(prices[0:5]) / 5.0 if n >= 5 else None
        ma20 = sum(prices[0:20]) / 20.0 if n >= 20 else None
        ma60 = sum(prices[0:60]) / 60.0 if n >= 60 else None
        
        date_str = latest_date.replace("-", "").replace("/", "")
        
        # Check alerts
        checks = []
        
        # 1. Price High
        if target_high is not None and latest_price >= target_high:
            checks.append({
                "alert_type": "price_high",
                "alert_title": "股價大於上限",
                "alert_message": f"最新收盤價 ({latest_price}) 已高於或等於設定的上限價格 ({target_high})",
                "triggered_price": latest_price
            })
            
        # 2. Price Low
        if target_low is not None and latest_price <= target_low:
            checks.append({
                "alert_type": "price_low",
                "alert_title": "股價小於下限",
                "alert_message": f"最新收盤價 ({latest_price}) 已低於或等於設定的下限價格 ({target_low})",
                "triggered_price": latest_price
            })
            
        # 3. MA5 above/below
        if compare_ma5 == 1 and ma5 is not None and latest_price > ma5:
            checks.append({
                "alert_type": "ma5_above",
                "alert_title": "收盤價 > MA5",
                "alert_message": f"最新收盤價 ({latest_price}) 高於/突破 MA5 ({ma5:.2f})",
                "triggered_price": latest_price
            })
        elif compare_ma5 == -1 and ma5 is not None and latest_price < ma5:
            checks.append({
                "alert_type": "ma5_below",
                "alert_title": "收盤價 < MA5",
                "alert_message": f"最新收盤價 ({latest_price}) 低於/跌破 MA5 ({ma5:.2f})",
                "triggered_price": latest_price
            })
            
        # 4. MA20 above/below
        if compare_ma20 == 1 and ma20 is not None and latest_price > ma20:
            checks.append({
                "alert_type": "ma20_above",
                "alert_title": "收盤價 > MA20",
                "alert_message": f"最新收盤價 ({latest_price}) 高於/突破 MA20 ({ma20:.2f})",
                "triggered_price": latest_price
            })
        elif compare_ma20 == -1 and ma20 is not None and latest_price < ma20:
            checks.append({
                "alert_type": "ma20_below",
                "alert_title": "收盤價 < MA20",
                "alert_message": f"最新收盤價 ({latest_price}) 低於/跌破 MA20 ({ma20:.2f})",
                "triggered_price": latest_price
            })
            
        # 5. MA60 above/below
        if compare_ma60 == 1 and ma60 is not None and latest_price > ma60:
            checks.append({
                "alert_type": "ma60_above",
                "alert_title": "收盤價 > MA60",
                "alert_message": f"最新收盤價 ({latest_price}) 高於/突破 MA60 ({ma60:.2f})",
                "triggered_price": latest_price
            })
        elif compare_ma60 == -1 and ma60 is not None and latest_price < ma60:
            checks.append({
                "alert_type": "ma60_below",
                "alert_title": "收盤價 < MA60",
                "alert_message": f"最新收盤價 ({latest_price}) 低於/跌破 MA60 ({ma60:.2f})",
                "triggered_price": latest_price
            })
            
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Filter duplicates and insert new alerts
        for check in checks:
            atype = check['alert_type']
            msg = check['alert_message']
            t_price = check['triggered_price']
            title = check['alert_title']
            
            # Check if already triggered today
            cursor.execute("""
                SELECT id FROM watchlist_alert_history 
                WHERE stock_id = ? AND alert_type = ? AND date_str = ?
            """, (stock_id, atype, date_str))
            
            if not cursor.fetchone():
                # Record to db
                cursor.execute("""
                    INSERT INTO watchlist_alert_history (stock_id, alert_type, alert_message, triggered_price, triggered_at, date_str)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (stock_id, atype, msg, t_price, now_str, date_str))
                
                triggered_alerts.append({
                    "stock_id": stock_id,
                    "stock_name": stock_name,
                    "alert_type": atype,
                    "alert_title": title,
                    "alert_message": msg,
                    "triggered_price": t_price,
                    "triggered_at": now_str
                })
                
                # Send telegram message
                if has_telegram:
                    tg_text = (
                        f"🔔 追蹤清單警示通知 🔔\n"
                        f"個股：{stock_id} {stock_name}\n"
                        f"警示類型：{title}\n"
                        f"詳細說明：{msg}\n"
                        f"觸發價格：{t_price} 元\n"
                        f"觸發時間：{now_str}"
                    )
                    url = f"https://api.telegram.org/bot{token}/sendMessage"
                    payload = {"chat_id": chat_id, "text": tg_text}
                    try:
                        requests.post(url, json=payload, timeout=5)
                    except Exception as e:
                        print(f"Telegram alert send failed for {stock_id}: {e}")
                        
    conn.commit()
    conn.close()
    return triggered_alerts

@app.post("/api/watchlist")
def add_watchlist_items(req: WatchlistAddRequest):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    added = []
    import datetime
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for stock_id in req.stock_ids:
        # Check official name
        cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? LIMIT 1", (stock_id,))
        row = cursor.fetchone()
        name = row[0] if row else "未知股"
        
        # Insert into watchlist if not exists
        cursor.execute("""
            INSERT OR IGNORE INTO watchlist (stock_id, stock_name, target_price_high, target_price_low, compare_ma5, compare_ma20, compare_ma60, created_at)
            VALUES (?, ?, NULL, NULL, 0, 0, 0, ?)
        """, (stock_id, name, now_str))
        added.append(stock_id)
        
    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"成功加入追蹤清單: {', '.join(added)}", "added": added}

@app.get("/api/watchlist")
def get_watchlist():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM watchlist")
    items = [dict(row) for row in cursor.fetchall()]
    
    results = []
    for item in items:
        stock_id = item['stock_id']
        # Fetch latest name and prices
        cursor.execute("""
            SELECT stock_name FROM daily_stock 
            WHERE stock_id = ? AND stock_name IS NOT NULL AND stock_name != '' 
            ORDER BY date DESC LIMIT 1
        """, (stock_id,))
        name_row = cursor.fetchone()
        official_name = name_row[0] if name_row else None
        
        cursor.execute("""
            SELECT closing_price, date 
            FROM daily_stock 
            WHERE stock_id = ? AND closing_price IS NOT NULL 
            ORDER BY date DESC LIMIT 60
        """, (stock_id,))
        price_rows = cursor.fetchall()
        
        latest_price, ma5, ma20, ma60 = None, None, None, None
        latest_date = None
        if price_rows:
            latest_price = price_rows[0]['closing_price']
            latest_date = price_rows[0]['date']
            n = len(price_rows)
            ma5 = sum(r['closing_price'] for r in price_rows[0:5]) / 5.0 if n >= 5 else None
            ma20 = sum(r['closing_price'] for r in price_rows[0:20]) / 20.0 if n >= 20 else None
            ma60 = sum(r['closing_price'] for r in price_rows[0:60]) / 60.0 if n >= 60 else None
            
        name = item['stock_name']
        if not name or name == '未知股':
            name = official_name or '未知股'
            
        results.append({
            "stock_id": stock_id,
            "stock_name": name,
            "target_price_high": item['target_price_high'],
            "target_price_low": item['target_price_low'],
            "compare_ma5": item['compare_ma5'],
            "compare_ma20": item['compare_ma20'],
            "compare_ma60": item['compare_ma60'],
            "latest_price": latest_price,
            "latest_date": latest_date,
            "ma5": ma5,
            "ma20": ma20,
            "ma60": ma60,
            "created_at": item['created_at']
        })
    conn.close()
    return results

@app.put("/api/watchlist/{stock_id}")
def update_watchlist_item(stock_id: str, item: WatchlistItem):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if stock exists in watchlist
    cursor.execute("SELECT stock_id FROM watchlist WHERE stock_id = ?", (stock_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Stock not found in watchlist")
        
    cursor.execute("""
        UPDATE watchlist SET
            target_price_high = ?,
            target_price_low = ?,
            compare_ma5 = ?,
            compare_ma20 = ?,
            compare_ma60 = ?
        WHERE stock_id = ?
    """, (item.target_price_high, item.target_price_low, item.compare_ma5, item.compare_ma20, item.compare_ma60, stock_id))
    
    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"成功修改 {stock_id} 警示條件"}

@app.delete("/api/watchlist/{stock_id}")
def delete_watchlist_item(stock_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM watchlist WHERE stock_id = ?", (stock_id,))
    conn.commit()
    conn.close()
    return {"status": "ok", "message": f"已刪除追蹤股票 {stock_id}"}

@app.get("/api/watchlist/alerts")
def get_watchlist_alerts(limit: int = 50):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, stock_id, alert_type, alert_message, triggered_price, triggered_at
        FROM watchlist_alert_history
        ORDER BY triggered_at DESC LIMIT ?
    """, (limit,))
    rows = [dict(row) for row in cursor.fetchall()]
    
    for row in rows:
        # Fetch name from watchlist first
        sid = row['stock_id']
        cursor.execute("SELECT stock_name FROM watchlist WHERE stock_id = ?", (sid,))
        w_row = cursor.fetchone()
        if w_row and w_row[0]:
            row['stock_name'] = w_row[0]
        else:
            cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? ORDER BY date DESC LIMIT 1", (sid,))
            d_row = cursor.fetchone()
            row['stock_name'] = d_row[0] if d_row else "未知股"
    conn.close()
    return rows

@app.post("/api/watchlist/clear-alerts")
def clear_watchlist_alerts():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM watchlist_alert_history")
    conn.commit()
    conn.close()
    return {"status": "ok", "message": "警示歷史已清空"}

@app.post("/api/watchlist/check-alerts")
def trigger_alert_check():
    triggered = check_watchlist_alerts()
    return {"status": "ok", "message": f"警示檢查完畢，新觸發了 {len(triggered)} 筆警示", "triggered": triggered}

# ================================
# 3.6 設定與歷史軌跡 APIs
# ================================
class SettingsItem(BaseModel):
    gemini_api_key: str | None = None
    gemini_model: str | None = None
    analysis_prompt: str | None = None
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

# DEFAULT_PROMPT_TEMPLATE moved to top of file

@app.get("/api/settings")
def get_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    
    settings_dict = {row['key']: row['value'] for row in rows}
    model_name = settings_dict.get("gemini_model", "gemini-3.8-flash")
    if model_name == "gemini-3.1-pro":
        model_name = "gemini-3.1-pro-preview"
    return {
        "gemini_api_key": settings_dict.get("gemini_api_key", ""),
        "gemini_model": model_name,
        "analysis_prompt": settings_dict.get("analysis_prompt", DEFAULT_PROMPT_TEMPLATE),
        "telegram_bot_token": settings_dict.get("telegram_bot_token", ""),
        "telegram_chat_id": settings_dict.get("telegram_chat_id", "")
    }

@app.post("/api/settings")
def update_settings(settings: SettingsItem):
    conn = get_db_connection()
    cursor = conn.cursor()
    if settings.gemini_api_key is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_api_key', ?)", (settings.gemini_api_key,))
    if settings.gemini_model is not None:
        model_name_to_save = settings.gemini_model
        if model_name_to_save == "gemini-3.1-pro":
            model_name_to_save = "gemini-3.1-pro-preview"
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_model', ?)", (model_name_to_save,))
    if settings.analysis_prompt is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('analysis_prompt', ?)", (settings.analysis_prompt,))
    if settings.telegram_bot_token is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_token', ?)", (settings.telegram_bot_token,))
    if settings.telegram_chat_id is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_chat_id', ?)", (settings.telegram_chat_id,))
    conn.commit()
    conn.close()
    return {"status": "ok", "message": "設定已更新"}

@app.get("/api/portfolio/history/{stock_id}")
def get_portfolio_history(stock_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT date, signal, analysis_text, created_at, sentiment_score, sentiment_direction, has_rumor
        FROM portfolio_analysis_history
        WHERE stock_id = ?
        ORDER BY date DESC
    """, (stock_id,))
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def perform_stock_analysis(stock_id: str, x_gemini_api_key: str | None = None, model_name: str | None = None):
    from datetime import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. 讀取設定
    cursor.execute("SELECT key, value FROM settings")
    settings_dict = {row['key']: row['value'] for row in cursor.fetchall()}
    
    api_key = x_gemini_api_key or settings_dict.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        conn.close()
        raise ValueError("請提供 Gemini API Key (可於網頁持股分頁設定或伺服器環境變數設定)")
        
    resolved_model_name = model_name or settings_dict.get("gemini_model") or "gemini-3.8-flash"
    if resolved_model_name == "gemini-3.1-pro":
        resolved_model_name = "gemini-3.1-pro-preview"
    prompt_template = settings_dict.get("analysis_prompt") or DEFAULT_PROMPT_TEMPLATE
    
    # 2. 抓取最近 10 天的股價歷史
    cursor.execute("""
        SELECT date, closing_price, trade_volume, opening_price, highest_price, lowest_price
        FROM daily_stock
        WHERE stock_id = ? AND closing_price IS NOT NULL
        ORDER BY date DESC
        LIMIT 10
    """, (stock_id,))
    price_rows = [dict(r) for r in cursor.fetchall()]
    
    # 3. 抓取購入價格與備註
    cursor.execute("SELECT buy_price, notes FROM portfolio WHERE stock_id = ?", (stock_id,))
    portfolio_info = cursor.fetchone()
    buy_price = portfolio_info['buy_price'] if portfolio_info else None
    notes = portfolio_info['notes'] if portfolio_info else None
    
    # 4. 取得股票名稱
    cursor.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? LIMIT 1", (stock_id,))
    name_row = cursor.fetchone()
    stock_name = name_row[0] if name_row else "未知股"
    
    if not price_rows:
        conn.close()
        raise ValueError(f"資料庫中找不到股票 {stock_id} 的股價數據，請先執行爬蟲抓取資料。")
        
    # 5. 爬取最新新聞
    news = scraper.fetch_yahoo_news(stock_id)
    news_text = "\n".join([f"- [{n['title']}]({n['link']})" for n in news]) if news else "目前無相關新聞。"
    
    # 6. 爬取 PTT 輿情
    ptt_posts = scraper.fetch_ptt_sentiment(stock_id)
    ptt_text = "\n".join([f"- [{p['title']}]({p['link']})" for p in ptt_posts]) if ptt_posts else "目前討論區無相關話題。"
    
    # 6.1 爬取股市同學會輿情
    try:
        cmoney_posts = scraper.fetch_cmoney_sentiment(stock_id)
        cmoney_text = "\n".join([f"- {p}" for p in cmoney_posts]) if cmoney_posts else "目前股市同學會無相關討論。"
    except Exception as e:
        print(f"抓取股市同學會輿情失敗: {e}")
        cmoney_text = "抓取股市同學會輿情失敗。"

    # 6.2 爬取 Threads 輿情
    try:
        threads_posts = scraper.fetch_threads_sentiment(stock_id, stock_name)
        threads_text = "\n".join([f"- {p}" for p in threads_posts]) if threads_posts else "目前 Threads 無相關討論。"
    except Exception as e:
        print(f"抓取 Threads 輿情失敗: {e}")
        threads_text = "抓取 Threads 輿情失敗。"
    
    # 7. 格式化近 10 日股價
    price_rows_asc = list(reversed(price_rows))
    price_text = "\n".join([
        f"日期: {r['date']}, 開盤: {r['opening_price']}, 收盤: {r['closing_price']}, 最高: {r['highest_price']}, 最低: {r['lowest_price']}, 成交量: {r['trade_volume']}"
        for r in price_rows_asc
    ])
    latest_price = price_rows[0]['closing_price']
    
    # 7.1 抓取營收資料
    cursor.execute("""
        SELECT revenue_date, current_month_rev, mom, yoy 
        FROM monthly_revenue 
        WHERE TRIM(stock_id) = ? 
        ORDER BY revenue_date DESC 
        LIMIT 6
    """, (stock_id,))
    revenue_rows = cursor.fetchall()
    revenue_text_list = []
    for r in revenue_rows:
        rev_date = r['revenue_date'] or '未知'
        rev_val = f"{r['current_month_rev']:,}" if r['current_month_rev'] is not None else '無'
        mom_val = f"{r['mom']:.2f}%" if r['mom'] is not None else '無'
        yoy_val = f"{r['yoy']:.2f}%" if r['yoy'] is not None else '無'
        revenue_text_list.append(f"月份: {rev_date}, 營收: {rev_val} 元, MoM: {mom_val}, YoY: {yoy_val}")
    revenue_text = "\n".join(revenue_text_list) if revenue_text_list else "無最近營收資料。"

    # 7.2 抓取三大法人買賣超
    cursor.execute("""
        SELECT date, foreign_net, trust_net, dealer_net 
        FROM institutional_trades 
        WHERE TRIM(stock_id) = ? 
        ORDER BY date DESC 
        LIMIT 10
    """, (stock_id,))
    inst_rows = list(reversed(cursor.fetchall()))
    inst_text_list = []
    for r in inst_rows:
        d_val = r['date'] or '未知'
        f_net = f"{r['foreign_net']:,}" if r['foreign_net'] is not None else '無'
        t_net = f"{r['trust_net']:,}" if r['trust_net'] is not None else '無'
        d_net = f"{r['dealer_net']:,}" if r['dealer_net'] is not None else '無'
        inst_text_list.append(f"日期: {d_val}, 外資買賣超: {f_net} 股, 投信買賣超: {t_net} 股, 自營商買賣超: {d_net} 股")
    inst_text = "\n".join(inst_text_list) if inst_text_list else "無最近法人買賣超資料。"

    # 7.3 抓取集保股權分散
    cursor.execute("""
        SELECT DISTINCT date 
        FROM shareholder_concentration 
        WHERE TRIM(stock_id) = ? 
        ORDER BY date DESC 
        LIMIT 2
    """, (stock_id,))
    sh_dates = [row[0] for row in cursor.fetchall()]
    concentration_text = ""
    if sh_dates:
        concentration_parts = []
        for d in sh_dates:
            cursor.execute("""
                SELECT level, proportion 
                FROM shareholder_concentration 
                WHERE TRIM(stock_id) = ? AND date = ? 
                ORDER BY level ASC
            """, (stock_id, d))
            level_rows = cursor.fetchall()
            if not level_rows: continue
            
            retail_prop = sum([r['proportion'] for r in level_rows if r['level'] <= 5])
            mid_prop = sum([r['proportion'] for r in level_rows if 5 < r['level'] < 11])
            large_prop = sum([r['proportion'] for r in level_rows if r['level'] >= 11])
            super_large_prop = sum([r['proportion'] for r in level_rows if r['level'] == 15])
            
            details = ", ".join([f"等級{r['level']}: {r['proportion']:.2f}%" for r in level_rows])
            
            summary = (
                f"日期: {d}\n"
                f"  - 散戶持股比例 (1-20張, 等級1-5): {retail_prop:.2f}%\n"
                f"  - 中戶持股比例 (20-200張, 等級6-10): {mid_prop:.2f}%\n"
                f"  - 大戶持股比例 (200張以上, 等級11-15): {large_prop:.2f}%\n"
                f"  - 千張大戶比例 (1000張以上, 等級15): {super_large_prop:.2f}%\n"
                f"  - 詳細持股分級比例: {details}"
            )
            concentration_parts.append(summary)
        concentration_text = "\n\n".join(concentration_parts)
    else:
        concentration_text = "無最近集保股權分散資料。"

    # 8. 套用自訂 Prompt 範本 (安全替代 replace)
    formatted_prompt = prompt_template.replace("{stock_id}", stock_id)\
                                       .replace("{stock_name}", stock_name)\
                                       .replace("{buy_price}", f"${buy_price:.2f}" if buy_price else "未提供（純追蹤股）")\
                                       .replace("{latest_price}", f"${latest_price:.2f}")\
                                       .replace("{notes}", notes if notes else "無")\
                                       .replace("{price_text}", price_text)\
                                       .replace("{revenue_text}", revenue_text)\
                                       .replace("{inst_text}", inst_text)\
                                       .replace("{concentration_text}", concentration_text)\
                                       .replace("{news_text}", news_text)\
                                       .replace("{ptt_text}", ptt_text)\
                                       .replace("{cmoney_text}", cmoney_text)\
                                       .replace("{threads_text}", threads_text)
                                       
    # 9. 呼叫 Gemini
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(resolved_model_name)
        try:
            # 嘗試啟用 Google Search Grounding 聯網搜尋功能
            response = model.generate_content(formatted_prompt, tools=['google_search_retrieval'])
        except Exception as search_err:
            print(f"啟用 Google Search Grounding 失敗 ({str(search_err)})，將降級為一般非聯網模式呼叫...")
            response = model.generate_content(formatted_prompt)
        response_text = response.text
    except Exception as e:
        conn.close()
        raise Exception(f"Gemini API 呼召失敗 ({resolved_model_name}): {str(e)}")
        
    # 10. 解析燈號 (信號)
    signal = "綠燈"  # 預設為綠燈
    if "紅燈" in response_text:
        signal = "紅燈"
    elif "黃燈" in response_text:
        signal = "黃燈"
    elif "綠燈" in response_text:
        signal = "綠燈"
        
    # 10.1 解析輿情結構化指標
    import re
    sentiment_score = 50.0  # 預設值
    sentiment_direction = "中立"  # 預設值
    has_rumor = "無"  # 預設值
    
    score_match = re.search(r'【熱度分數】\s*:\s*(\d+)', response_text)
    if score_match:
        try:
            sentiment_score = float(score_match.group(1))
        except ValueError:
            pass
            
    dir_match = re.search(r'【看空看多】\s*:\s*([^\s\n\r]+)', response_text)
    if dir_match:
        val = dir_match.group(1).strip()
        val = val.replace('[', '').replace(']', '').replace('【', '').replace('】', '')
        if "看多" in val:
            sentiment_direction = "看多"
        elif "看空" in val:
            sentiment_direction = "看空"
        elif "中立" in val:
            sentiment_direction = "中立"
            
    rumor_match = re.search(r'【小道消息】\s*:\s*([^\n\r]+)', response_text)
    if rumor_match:
        has_rumor = rumor_match.group(1).strip().replace('[', '').replace(']', '')
        
    # 10.2 解析預估本益比與是否是打群架指標
    fpe_2026 = None
    fpe_2027 = None
    fpe_2028 = None
    is_group_fight = "否"
    
    fpe26_match = re.search(r'【2026_FPE】\s*:\s*([0-9.]+)', response_text)
    if fpe26_match:
        try:
            fpe_2026 = float(fpe26_match.group(1))
        except ValueError:
            pass
            
    fpe27_match = re.search(r'【2027_FPE】\s*:\s*([0-9.]+)', response_text)
    if fpe27_match:
        try:
            fpe_2027 = float(fpe27_match.group(1))
        except ValueError:
            pass
            
    fpe28_match = re.search(r'【2028_FPE】\s*:\s*([0-9.]+)', response_text)
    if fpe28_match:
        try:
            fpe_2028 = float(fpe28_match.group(1))
        except ValueError:
            pass
            
    gf_match = re.search(r'【是否是打群架】\s*:\s*([^\n\r]+)', response_text)
    if gf_match:
        val = gf_match.group(1).strip().replace('[', '').replace(']', '')
        if "是" in val:
            is_group_fight = "是"
        else:
            is_group_fight = "否"
            
    peg27 = "N/A"
    if fpe_2026 is not None and fpe_2027 is not None and fpe_2027 > 0:
        try:
            growth = (fpe_2026 / fpe_2027) - 1
            if growth > 0:
                peg27 = round(fpe_2027 / (growth * 100), 2)
            else:
                peg27 = "N/A"
        except:
            peg27 = "N/A"
    else:
        peg27 = "N/A"
        
    # 11. 儲存至歷史紀錄表 (以今日系統日期儲存)
    analysis_date = datetime.now().strftime("%Y%m%d")
    cursor.execute("""
        INSERT OR REPLACE INTO portfolio_analysis_history 
        (stock_id, date, signal, analysis_text, created_at, sentiment_score, sentiment_direction, has_rumor, fpe_2026, fpe_2027, fpe_2028, is_group_fight, model_name)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?)
    """, (stock_id, analysis_date, signal, response_text, sentiment_score, sentiment_direction, has_rumor, fpe_2026, fpe_2027, fpe_2028, is_group_fight, resolved_model_name))
    conn.commit()
    conn.close()
    
    return {
        "stock_id": stock_id,
        "stock_name": stock_name,
        "news": news,
        "analysis": response_text,
        "signal": signal,
        "fpe_2026": fpe_2026,
        "fpe_2027": fpe_2027,
        "fpe_2028": fpe_2028,
        "peg_2027": peg27,
        "is_group_fight": is_group_fight
    }

@app.get("/api/portfolio/analyze/{stock_id}")
def analyze_portfolio_stock(stock_id: str, model_name: str | None = None, x_gemini_api_key: str | None = Header(default=None)):
    try:
        result = perform_stock_analysis(stock_id, x_gemini_api_key, model_name)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400 if "API Key" in str(ve) else 404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    except ValueError as ve:
        raise HTTPException(status_code=400 if "API Key" in str(ve) else 404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# 3.7 自動執行與背景批次診斷任務
# ================================
def run_all_portfolio_analysis_task():
    import time
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT stock_id FROM portfolio WHERE auto_analyze = 1")
    stock_ids = [row['stock_id'] for row in cursor.fetchall()]
    conn.close()
    
    for sid in stock_ids:
        try:
            print(f"背景自動執行診斷股票: {sid}")
            perform_stock_analysis(sid)
            # 延遲避免請求過快
            time.sleep(2)
        except Exception as e:
            print(f"背景自動執行股票 {sid} 失敗: {str(e)}")

@app.post("/api/portfolio/analyze-all")
def start_analyze_all(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_all_portfolio_analysis_task)
    return {"status": "Task started in background", "task": "analyze_all"}

def run_scheduled_pipeline():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT key, value FROM settings 
        WHERE key IN ('schedule_scrape_daily', 'schedule_scrape_revenue', 'schedule_analyze')
    """)
    rows = cursor.fetchall()
    conn.close()
    
    settings_dict = {row['key']: row['value'] for row in rows}
    scrape_daily_enabled = settings_dict.get("schedule_scrape_daily", "true") == "true"
    scrape_revenue_enabled = settings_dict.get("schedule_scrape_revenue", "true") == "true"
    analyze_enabled = settings_dict.get("schedule_analyze", "true") == "true"

    if scrape_daily_enabled:
        print("[Scheduler Pipeline] 開始執行自動化每日股價撈取...")
        try:
            scraper.main()
        except Exception as e:
            print(f"[Scheduler Pipeline] 自動化每日股價撈取失敗: {str(e)}")
    else:
        print("[Scheduler Pipeline] 排程設定：跳過每日股價撈取")
    
    if scrape_revenue_enabled:
        try:
            print("[Scheduler Pipeline] 開始抓取最新月份營收...")
            scraper.fetch_and_save_revenue()
        except Exception as e:
            print(f"[Scheduler Pipeline] 自動抓取營收失敗: {str(e)}")
    else:
        print("[Scheduler Pipeline] 排程設定：跳過每月營收抓取")

    if analyze_enabled:
        try:
            print("[Scheduler Pipeline] 開始啟動已勾選「自動分析」持股之 Gemini 健檢診斷...")
            run_all_portfolio_analysis_task()
        except Exception as e:
            print(f"[Scheduler Pipeline] 自動化每日診斷失敗: {str(e)}")
    else:
        print("[Scheduler Pipeline] 排程設定：跳過自動化持股分析")

    # 執行追蹤清單與警示檢查
    try:
        print("[Scheduler Pipeline] 開始執行追蹤清單警示檢查...")
        check_watchlist_alerts()
    except Exception as e:
        print(f"[Scheduler Pipeline] 自動化警示檢查失敗: {str(e)}")

    # 執行大盤加權指數、8大宏觀指標與 ML 模型推論自動化更新
    try:
        print("[Scheduler Pipeline] 開始執行大盤加權指數與宏觀指標自動化撈取...")
        import sync_market_index
        sync_market_index.sync_taiex_to_sqlite()
        import sync_macro_indicators
        sync_macro_indicators.sync_macro_to_sqlite(range_param="1mo")
        import market_ml_engine
        # 執行期交所超短線高頻分K (1分K/5分K) 自動下載建庫
        try:
            print("[Scheduler Pipeline] 開始執行期交所超短線高頻逐筆資料與分K自動化蒐集...")
            import taifex_intraday_collector
            taifex_intraday_collector.scan_and_collect_all_available_days(days_back=3)
        except Exception as e:
            print(f"[Scheduler Pipeline] 期交所超短線分K更新失敗: {str(e)}")

        # 執行全球國家級主權市場日K自動化同步更新
        try:
            print("[Scheduler Pipeline] 開始執行全球國家級主權市場日K增量同步...")
            import sync_global_sovereign
            sync_global_sovereign.sync_global_sovereign_history(full_history=False)
            print("[Scheduler Pipeline] 全球國家主權市場數據同步成功！")
        except Exception as e:
            print(f"[Scheduler Pipeline] 全球國家主權數據同步失敗: {str(e)}")

        # 執行各國本土真實交易所泰坦股票池日K自動化同步更新
        try:
            print("[Scheduler Pipeline] 開始執行各國本土真實交易所泰坦股票池日K增量同步...")
            import sync_true_domestic_stocks
            sync_true_domestic_stocks.sync_true_domestic_stocks(full_history=False)
            print("[Scheduler Pipeline] 各國本土真實交易所股票池數據同步成功！")
        except Exception as e:
            print(f"[Scheduler Pipeline] 各國本土股票池數據同步失敗: {str(e)}")

        # 執行全球泰坦 2.0、超跌狙擊手與可轉債好球帶自動化快照產出
        try:
            print("[Scheduler Pipeline] 開始執行全球泰坦 G12-PIT (S&P 500 PIT + 台股 0050∪0051 純上市) 與戰情室快照產出...")
            import global_sovereign_service
            gs_data = global_sovereign_service.get_global_sovereign_dashboard_data()
            with open(os.path.join(FRONTEND_DIR, 'src/data/defaultGlobalSovereignData.json'), 'w', encoding='utf-8') as f:
                json.dump(gs_data, f, ensure_ascii=False, indent=2)
            try:
                import stock_sync
                sb_c = stock_sync.get_supabase_conn()
                stock_sync.sync_ml_cache(sb_c)
                sb_c.close()
                print("[Scheduler Pipeline] 全球泰坦雲端 stock_ml_cache 自動同步成功！")
            except Exception as e_sb:
                print(f"[Scheduler Pipeline] 雲端 stock_ml_cache 同步提醒: {e_sb}")
            print("[Scheduler Pipeline] 全球泰坦 G12-PIT 前端資料同步成功！")
        except Exception as e:
            print(f"[Scheduler Pipeline] 全球泰坦 2.0 快照產出失敗: {str(e)}")

        try:
            print("[Scheduler Pipeline] 開始執行超跌狙擊手 (Oversold Sniper) 快照產出...")
            import oversold_sniper_service
            os_data = oversold_sniper_service.get_oversold_sniper_data()
            with open(os.path.join(FRONTEND_DIR, 'src/data/defaultOversoldSniperData.json'), 'w', encoding='utf-8') as f:
                json.dump(os_data, f, ensure_ascii=False, indent=2)
            print("[Scheduler Pipeline] 超跌狙擊手快照產出成功！")
        except Exception as e:
            print(f"[Scheduler Pipeline] 超跌狙擊手快照產出失敗: {str(e)}")

        try:
            print("[Scheduler Pipeline] 開始執行可轉債落難天使好球帶雷達快照產出...")
            import generate_real_tpex_radar
            generate_real_tpex_radar.generate_real_radar()
            print("[Scheduler Pipeline] 可轉債雷達快照產出成功！")
        except Exception as e:
            print(f"[Scheduler Pipeline] 可轉債雷達快照產出失敗: {str(e)}")

        print("[Scheduler Pipeline] 大盤指數、宏觀指標與策略快照自動化更新全部成功！")
    except Exception as e:
        print(f"[Scheduler Pipeline] 大盤指數/宏觀更新失敗: {str(e)}")

# ================================
# 3.8 自動化每日排程器與 API
# ================================
def is_market_open_today():
    import datetime
    import requests
    
    now = datetime.datetime.now()
    # 1. 週末絕對不交易開盤 (5: Saturday, 6: Sunday)
    if now.weekday() >= 5:
        return False
        
    # 2. 查詢國定假日 (使用 ruyut/TaiwanCalendar)
    today_str = now.strftime("%Y%m%d")
    year = now.strftime("%Y")
    
    try:
        url = f"https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json"
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            calendar_data = resp.json()
            for day in calendar_data:
                if day.get("date") == today_str:
                    # 如果 isHoliday 為 True 代表今天放假不交易開盤
                    return not day.get("isHoliday", False)
    except Exception as e:
        print(f"[Scheduler] 無法取得假日行事曆 API: {e}，將預設以星期一至五為開盤交易日。")
        
    # 備援方案：若 API 失敗，僅判斷是否為週一至週五
    return now.weekday() < 5

class StockScheduler:
    def __init__(self):
        self.thread = None
        self.running = False
        self.last_run_date = None  # 防止同一天重複執行
        
    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()
            print("Background StockScheduler thread started.")
            
    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
            print("Background StockScheduler thread stopped.")
            
    def _loop(self):
        # 啟動時先稍微延遲，讓 FastAPI 伺服器初始化完成
        time.sleep(5)
        while self.running:
            try:
                # 讀取資料庫中的排程設定
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT key, value FROM settings WHERE key IN ('schedule_enabled', 'schedule_time')")
                rows = cursor.fetchall()
                conn.close()
                
                settings_dict = {row['key']: row['value'] for row in rows}
                enabled = settings_dict.get("schedule_enabled", "true") == "true"
                schedule_time_str = settings_dict.get("schedule_time", "06:00")
                
                if enabled:
                    import datetime
                    now = datetime.datetime.now()
                    current_time_str = now.strftime("%H:%M")
                    current_date_str = now.strftime("%Y-%m-%d")
                    
                    if current_time_str == schedule_time_str and self.last_run_date != current_date_str:
                        self.last_run_date = current_date_str
                        
                        # 檢查今天是不是開盤日
                        if is_market_open_today():
                            print(f"[{now}] 自動排程觸發 (設定時間: {schedule_time_str})，今天為交易日，啟動排程更新與健檢工作流。")
                            task_thread = threading.Thread(
                                target=run_scheduled_pipeline,
                                daemon=True
                            )
                            task_thread.start()
                        else:
                            print(f"[{now}] 自動排程觸發 (設定時間: {schedule_time_str})，但偵測到今天非交易開盤日，自動跳過任務。")
            except Exception as e:
                print(f"[Scheduler Error] 執行緒循環異常: {e}")
                
            time.sleep(30)

class ScheduleSettings(BaseModel):
    enabled: bool
    time: str
    scrape_daily: bool | None = True
    scrape_revenue: bool | None = True
    analyze: bool | None = True

@app.get("/api/schedule")
def get_schedule():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key IN ('schedule_enabled', 'schedule_time', 'schedule_scrape_daily', 'schedule_scrape_revenue', 'schedule_analyze')")
    rows = cursor.fetchall()
    conn.close()
    
    settings_dict = {row['key']: row['value'] for row in rows}
    enabled_val = settings_dict.get("schedule_enabled", "true") == "true"
    time_val = settings_dict.get("schedule_time", "06:00")
    scrape_daily_val = settings_dict.get("schedule_scrape_daily", "true") == "true"
    scrape_revenue_val = settings_dict.get("schedule_scrape_revenue", "true") == "true"
    analyze_val = settings_dict.get("schedule_analyze", "true") == "true"
    
    return {
        "enabled": enabled_val,
        "time": time_val,
        "scrape_daily": scrape_daily_val,
        "scrape_revenue": scrape_revenue_val,
        "analyze": analyze_val
    }

@app.post("/api/schedule")
def update_schedule(settings: ScheduleSettings):
    import re
    if not re.match(r"^\d{2}:\d{2}$", settings.time):
        raise HTTPException(status_code=400, detail="時間格式必須為 HH:MM")
    try:
        hour, minute = map(int, settings.time.split(":"))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise HTTPException(status_code=400, detail="不合法的時間數值")
    except ValueError:
        raise HTTPException(status_code=400, detail="時間格式必須為 HH:MM")
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedule_enabled', ?)", ("true" if settings.enabled else "false",))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedule_time', ?)", (settings.time,))
    
    scrape_daily_str = "true" if (settings.scrape_daily is None or settings.scrape_daily) else "false"
    scrape_revenue_str = "true" if (settings.scrape_revenue is None or settings.scrape_revenue) else "false"
    analyze_str = "true" if (settings.analyze is None or settings.analyze) else "false"
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedule_scrape_daily', ?)", (scrape_daily_str,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedule_scrape_revenue', ?)", (scrape_revenue_str,))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('schedule_analyze', ?)", (analyze_str,))
    
    conn.commit()
    conn.close()
    
    return {
        "status": "ok", 
        "message": "排程設定已更新", 
        "enabled": settings.enabled, 
        "time": settings.time,
        "scrape_daily": settings.scrape_daily if settings.scrape_daily is not None else True,
        "scrape_revenue": settings.scrape_revenue if settings.scrape_revenue is not None else True,
        "analyze": settings.analyze if settings.analyze is not None else True
    }

# ==========================================
# 3.5 Podcast 轉譯與分析 (Podcast API)
# ==========================================
class PodcastChannelInput(BaseModel):
    url: str

def update_episode_status(episode_guid: str, status: str, transcription: str = "", analysis_report: str = ""):
    from datetime import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    analysis_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if status == "completed" else ""
    cursor.execute("""
        UPDATE podcast_episodes
        SET status = ?, transcription = ?, analysis_report = ?, analysis_date = ?
        WHERE episode_guid = ?
    """, (status, transcription, analysis_report, analysis_date, episode_guid))
    conn.commit()
    conn.close()

def async_transcribe_podcast(episode_guid: str, x_gemini_api_key: str | None = None):
    try:
        import podcast_pipeline
        print(f"[Podcast Task] 啟動本地端 Whisper 語音轉文字與 AI 趨勢分析: {episode_guid}")
        success = podcast_pipeline.process_single_episode(
            episode_guid=episode_guid,
            whisper_model="base",
            gemini_api_key=x_gemini_api_key
        )
        if success:
            print(f"[Podcast Task] 單集 {episode_guid} 本地解碼與 AI 分析全流程成功！")
        else:
            print(f"[Podcast Task] 單集 {episode_guid} 處理未竟全功")
    except Exception as e:
        error_msg = f"本地音頻解碼與趨勢分析失敗: {str(e)}"
        print(f"[Podcast Task] 錯誤: {error_msg}")
        update_episode_status(
            episode_guid=episode_guid,
            status="failed",
            transcription="",
            analysis_report=error_msg
        )

@app.get("/api/podcast/channels")
def get_podcast_channels():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT channel_id, name, apple_url, feed_url, artwork_url, artist_name FROM podcast_channels")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

@app.post("/api/podcast/channels")
def add_podcast_channel(channel_input: PodcastChannelInput):
    url = channel_input.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="網址不能為空")
        
    # 提取 Podcast ID
    podcast_id = podcast_scraper.extract_podcast_id(url)
    if not podcast_id:
        raise HTTPException(status_code=400, detail="無法解析該 Apple Podcast 網址中的頻道 ID")
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 檢查是否已存在
    cursor.execute("SELECT channel_id FROM podcast_channels WHERE channel_id = ?", (podcast_id,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="此頻道已加入追蹤列表")
        
    # 查詢 iTunes API
    channel_info = podcast_scraper.get_feed_url_by_id(podcast_id)
    if not channel_info:
        conn.close()
        raise HTTPException(status_code=400, detail="向 iTunes API 查詢頻道資訊失敗，請確認網址或 ID 是否正確")
        
    try:
        # 寫入頻道資訊
        cursor.execute("""
            INSERT INTO podcast_channels (channel_id, name, apple_url, feed_url, artwork_url, artist_name)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (podcast_id, channel_info['channel_name'], url, channel_info['feed_url'], channel_info['artwork_url'], channel_info['artist_name']))
        
        # 抓取並解析單集寫入資料庫
        episodes = podcast_scraper.parse_podcast_rss(channel_info['feed_url'], limit=15)
        for ep in episodes:
            cursor.execute("""
                INSERT OR IGNORE INTO podcast_episodes (episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (ep['guid'], podcast_id, ep['title'], ep['pub_date'], ep['mp3_url'], ep['duration'], ep['description'], "", "", "", "pending"))
            
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=f"儲存資料至資料庫失敗: {str(e)}")
        
    conn.close()
    return {"status": "ok", "message": "已成功加入 Podcast 頻道", "channel": channel_info}

@app.post("/api/podcast/channels/restore_defaults")
def restore_default_podcast_channels():
    default_channels = [
        {
            "id": "1500839292",
            "url": "https://podcasts.apple.com/tw/podcast/gooaye-%E8%82%A1%E7%99%8C/id1500839292"
        },
        {
            "id": "1488295306",
            "url": "https://podcasts.apple.com/tw/podcast/%E6%B8%B8%E5%BA%AD%E7%9A%84%E8%B2%A1%E7%B6%93%E7%9A%93%E8%A7%92/id1488295306"
        }
    ]
    
    conn = get_db_connection()
    cursor = conn.cursor()
    restored_names = []
    
    for ch in default_channels:
        podcast_id = ch["id"]
        url = ch["url"]
        
        channel_info = podcast_scraper.get_feed_url_by_id(podcast_id)
        if channel_info:
            cursor.execute("""
                INSERT OR REPLACE INTO podcast_channels (channel_id, name, apple_url, feed_url, artwork_url, artist_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (podcast_id, channel_info['channel_name'], url, channel_info['feed_url'], channel_info['artwork_url'], channel_info['artist_name']))
            
            episodes = podcast_scraper.parse_podcast_rss(channel_info['feed_url'], limit=15)
            for ep in episodes:
                cursor.execute("""
                    INSERT OR IGNORE INTO podcast_episodes (episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', 'pending')
                """, (ep['guid'], podcast_id, ep['title'], ep['pub_date'], ep['mp3_url'], ep['duration'], ep['description']))
            
            restored_names.append(channel_info['channel_name'])
            
    conn.commit()
    conn.close()
    
    return {
        "status": "ok",
        "message": f"已成功恢復預設熱門頻道：{', '.join(restored_names)}！" if restored_names else "預設頻道恢復完成。"
    }

@app.delete("/api/podcast/channels/{channel_id}")
def delete_podcast_channel(channel_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 檢查頻道是否存在
    cursor.execute("SELECT channel_id FROM podcast_channels WHERE channel_id = ?", (channel_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="找不到指定的 Podcast 頻道")
        
    try:
        cursor.execute("DELETE FROM podcast_channels WHERE channel_id = ?", (channel_id,))
        cursor.execute("DELETE FROM podcast_episodes WHERE channel_id = ?", (channel_id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=f"刪除失敗: {str(e)}")
        
    conn.close()
    return {"status": "ok", "message": "已成功刪除該頻道與所有單集紀錄"}

@app.post("/api/podcast/channels/{channel_id}/refresh")
def refresh_podcast_channel(channel_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT feed_url FROM podcast_channels WHERE channel_id = ?", (channel_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="找不到指定的 Podcast 頻道")
        
    feed_url = row['feed_url']
    try:
        episodes = podcast_scraper.parse_podcast_rss(feed_url, limit=15)
        new_count = 0
        for ep in episodes:
            cursor.execute("SELECT episode_guid FROM podcast_episodes WHERE episode_guid = ?", (ep['guid'],))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO podcast_episodes (episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ep['guid'], channel_id, ep['title'], ep['pub_date'], ep['mp3_url'], ep['duration'], ep['description'], "", "", "", "pending"))
                new_count += 1
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=f"刷新頻道單集失敗: {str(e)}")
        
    conn.close()
    if new_count > 0:
        try:
            import podcast_pipeline
            podcast_pipeline.sync_cache_and_cloud()
        except Exception:
            pass
    return {"status": "ok", "message": f"頻道單集已刷新，新增了 {new_count} 個新單集", "new_count": new_count}

class BatchTranscribeInput(BaseModel):
    limit: int = 5

@app.post("/api/podcast/channels/{channel_id}/batch_transcribe")
def batch_transcribe_podcast_channel(
    channel_id: str, 
    input_data: BatchTranscribeInput, 
    background_tasks: BackgroundTasks, 
    x_gemini_api_key: str | None = Header(default=None)
):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. 檢查頻道是否存在並取得 RSS URL
    cursor.execute("SELECT feed_url FROM podcast_channels WHERE channel_id = ?", (channel_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="找不到指定的 Podcast 頻道")
    feed_url = row['feed_url']
    
    # 2. 從 RSS 抓取最新 30 單集補入資料庫
    try:
        episodes = podcast_scraper.parse_podcast_rss(feed_url, limit=30)
        for ep in episodes:
            cursor.execute("SELECT episode_guid FROM podcast_episodes WHERE episode_guid = ?", (ep['guid'],))
            if not cursor.fetchone():
                cursor.execute("""
                    INSERT INTO podcast_episodes (episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ep['guid'], channel_id, ep['title'], ep['pub_date'], ep['mp3_url'], ep['duration'], ep['description'], "", "", "", "pending"))
        conn.commit()
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"刷新頻道單集失敗: {str(e)}")
        
    # 3. 獲取該頻道的所有單集並依時間排序，以取得前 N 集
    cursor.execute("""
        SELECT episode_guid, title, pub_date, status 
        FROM podcast_episodes 
        WHERE channel_id = ?
    """, (channel_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    
    from email.utils import parsedate_to_datetime
    import datetime
    
    def get_episode_time(ep):
        try:
            return parsedate_to_datetime(ep['pub_date'])
        except:
            return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
            
    rows.sort(key=get_episode_time, reverse=True)
    target_episodes = rows[:input_data.limit]
    
    # 4. 啟動非 completed/transcribing 單集之背景分析
    target_guids = []
    skipped_completed = 0
    skipped_processing = 0
    
    for ep in target_episodes:
        guid = ep['episode_guid']
        status = ep['status']
        if status == 'completed':
            skipped_completed += 1
        elif status == 'transcribing':
            skipped_processing += 1
        else:
            target_guids.append(guid)
            
    conn.close()
    
    if not target_guids:
        return {
            "status": "ok",
            "message": "所選最新單集皆已完成分析或正在處理中，無待處理單集。",
            "started_count": 0,
            "skipped_completed": skipped_completed,
            "skipped_processing": skipped_processing,
            "total_checked": len(target_episodes)
        }
        
    import podcast_pipeline
    background_tasks.add_task(
        podcast_pipeline.batch_process_episodes,
        target_guids,
        x_gemini_api_key
    )
    
    return {
        "status": "ok",
        "message": f"🚀 批次分析任務已啟動！共加入 {len(target_guids)} 個單集至處理佇列（略過已完成 {skipped_completed} 集、略過進行中 {skipped_processing} 集）。",
        "started_count": len(target_guids),
        "total_jobs": len(target_guids),
        "skipped_completed": skipped_completed,
        "skipped_processing": skipped_processing,
        "total_checked": len(target_episodes)
    }

@app.get("/api/podcast/progress")
def get_podcast_progress():
    """取得當前正在執行之 Podcast 分析進度、當前步驟、已完成集數與剩餘 Job 數量"""
    try:
        import podcast_pipeline
        return podcast_pipeline.get_podcast_progress()
    except Exception as e:
        return {"is_active": False, "error": str(e)}

@app.get("/api/podcast/episodes")
def get_podcast_episodes(channel_id: str | None = None, limit: int = 50):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if channel_id:
        cursor.execute("""
            SELECT episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status
            FROM podcast_episodes
            WHERE channel_id = ?
        """, (channel_id,))
    else:
        cursor.execute("""
            SELECT episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status
            FROM podcast_episodes
        """)
        
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    # 在 Python 中解析 pubDate 日期並進行排序 (由新到舊)
    from email.utils import parsedate_to_datetime
    import datetime
    
    def get_episode_time(ep):
        try:
            return parsedate_to_datetime(ep['pub_date'])
        except:
            return datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
            
    rows.sort(key=get_episode_time, reverse=True)
    return rows[:limit]

@app.post("/api/podcast/transcribe/{episode_guid:path}")
def transcribe_podcast_episode(episode_guid: str, background_tasks: BackgroundTasks, x_gemini_api_key: str | None = Header(default=None)):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 檢查單集是否存在
    cursor.execute("SELECT status, title FROM podcast_episodes WHERE episode_guid = ?", (episode_guid,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="找不到指定的 Podcast 單集")
        
    status, title = row['status'], row['title']
    if status == "transcribing":
        conn.close()
        return {"status": "processing", "message": "此單集語音目前正在轉譯中，請勿重複提交"}
    if status == "completed":
        conn.close()
        return {"status": "completed", "message": f"「{title}」已分析完成，無須重複分析。"}
        
    conn.close()
    
    # 啟動背景任務進行批次處理 (1 集)
    import podcast_pipeline
    background_tasks.add_task(
        podcast_pipeline.batch_process_episodes,
        [episode_guid],
        x_gemini_api_key
    )
    
    return {
        "status": "processing",
        "message": f"🚀 已成功啟動「{title}」的語音轉譯與分析任務！"
    }

class CloudWorkerThread:
    def __init__(self):
        self.thread = None
        self.running = False
        
    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._loop, daemon=True)
            self.thread.start()
            print("[CloudWorker] Background Supabase stock_screener_jobs worker thread started.")
            
    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
            print("[CloudWorker] Background Supabase worker thread stopped.")
            
    def _loop(self):
        time.sleep(5)
        while self.running:
            try:
                import stock_cloud_worker
                handled = stock_cloud_worker.process_pending_jobs()
                if not handled:
                    time.sleep(3)
                else:
                    time.sleep(0.5)
            except Exception as e:
                time.sleep(5)

cloud_worker = CloudWorkerThread()
scheduler = StockScheduler()

@app.on_event("startup")
def startup_event():
    # 啟動時自動重置所有處於 transcribing 狀態的單集為 pending，防止因重載或重啟伺服器而卡死
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE podcast_episodes SET status = 'pending' WHERE status = 'transcribing'")
        conn.commit()
        conn.close()
        print("[Startup] 已成功重置所有卡在轉譯狀態的單集為 pending。")
    except Exception as e:
        print(f"[Startup] 重置轉譯狀態失敗: {e}")

    # 預熱所有已存在的 JSON 快取至記憶體，讓首頁請求完全不觸發任何背景推論
    _ALL_MODEL_TYPES = [
        'attention_bilstm_xgb', 'vsn_xlstm', 'patchtst', 'tft', 'resnet50',
        'cnn_hybrid', 'lightgbm', 'mlp', 'xgboost', 'rf', 'lr'
    ]
    warmed = 0
    for mt in _ALL_MODEL_TYPES:
        ppath = ml_engine.predictions_json_path(mt)
        if os.path.exists(ppath):
            try:
                with open(ppath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if data.get('status') == 'ok' and data.get('data'):
                    ml_engine.PREDICTION_CACHE[mt] = data
                    warmed += 1
            except Exception:
                pass
        jpath = ml_engine.metrics_json_path(mt)
        if os.path.exists(jpath):
            try:
                with open(jpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if data.get('status') == 'ready':
                    ml_engine.STATUS_CACHE[mt] = data
            except Exception:
                pass
    print(f"[Startup] 預熱完成：已載入 {warmed} 個模型預測快取至記憶體。")
    scheduler.start()
    cloud_worker.start()

@app.on_event("shutdown")
def shutdown_event():
    scheduler.stop()
    cloud_worker.stop()

class MLTrainRequest(BaseModel):
    model_type: str = "lightgbm"
    train_ratio: float = 0.8
    train_days: int = None
    test_days: int = None
    force_retrain: bool = False
    min_capital_billion: float | None = 10.0
    exclude_6digit: bool = True

class BacktestRequest(BaseModel):
    model_type: str = "lightgbm"
    min_win_prob: float = 60.0
    max_drop_prob: float = 30.0
    stop_profit_pct: float = 20.0
    stop_loss_pct: float = 8.0
    max_holding_days: int = 20
    max_portfolio_size: int = 5
    train_ratio: float = 0.8
    train_days: int = None
    test_days: int = None
    exit_strategy: str = "fixed"
    trailing_activation_pct: float = 10.0
    min_capital_billion: float | None = 10.0
    exclude_6digit: bool = True
    market_bull_filter: bool = False

import threading
import traceback

_TRAIN_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'train_errors.log')

_TRAIN_LOCK = threading.Lock()

def run_background_ml_train(model_type: str, train_ratio: float, train_days, test_days, force_retrain: bool, min_capital_billion: float | None = 10.0, exclude_6digit: bool = True):
    """序列化訓練：使用獨立 Subprocess 執行訓練，徹底防止 macOS OMP / PyTorch 多執行緒衝突造成崩潰"""
    import subprocess
    import sys

    ml_engine.STATUS_CACHE[model_type] = {
        "status": "training",
        "model_type": model_type,
        "trained_at": "等待訓練鎖...",
        "metrics": {},
        "top_features": []
    }
    print(f"[Background Train] {model_type} 等待全域訓練鎖...", flush=True)
    with _TRAIN_LOCK:
        try:
            ml_engine.STATUS_CACHE[model_type]["trained_at"] = "背景訓練中..."
            print(f"[Background Train] 啟動獨立進程訓練 {model_type} (股本門檻: {min_capital_billion}億, 排除6碼: {exclude_6digit})...", flush=True)
            
            py_bin = sys.executable
            train_code = (
                f"import sys, ml_engine\n"
                f"res = ml_engine.train_model(\n"
                f"    model_type={repr(model_type)},\n"
                f"    train_ratio={train_ratio if train_ratio is not None else 0.8},\n"
                f"    train_days={train_days if train_days is not None else 'None'},\n"
                f"    test_days={test_days if test_days is not None else 'None'},\n"
                f"    force_retrain={force_retrain},\n"
                f"    min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'},\n"
                f"    exclude_6digit={exclude_6digit}\n"
                f")\n"
                f"if res.get('status') != 'ok': sys.exit(1)\n"
            )
            env = os.environ.copy()
            env["OMP_NUM_THREADS"] = "1"
            env["KMP_DUPLICATE_LIB_OK"] = "TRUE"
            env["PYTHONUNBUFFERED"] = "1"

            with open(_TRAIN_LOG, 'a') as log_f:
                log_f.write(f"\n=== [{model_type}] {__import__('datetime').datetime.now()} ===\n")
                log_f.flush()
                proc = subprocess.run(
                    [py_bin, "-c", train_code],
                    cwd=ml_engine._BASE_DIR,
                    stdout=log_f,
                    stderr=log_f,
                    env=env
                )

            if proc.returncode == 0:
                print(f"[Background Train] {model_type} 獨立進程訓練成功！", flush=True)
                ml_engine.STATUS_CACHE.pop(model_type, None)
                ml_engine.get_model_status(model_type)
                # 清除舊的預測快取，確保模型訓練完後推薦清單一併自動重新計算更新
                ml_engine.PREDICTION_CACHE.pop(model_type, None)
                old_ppath = ml_engine.predictions_json_path(model_type)
                if os.path.exists(old_ppath):
                    try:
                        os.remove(old_ppath)
                    except Exception:
                        pass
                # 訓練完畢後立即非同步啟動最新推論計算
                try:
                    pred_code = (
                        f"import ml_engine\n"
                        f"ml_engine.predict_top_stocks(top_n=30, model_type={repr(model_type)}, force=True, min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'}, exclude_6digit={exclude_6digit})\n"
                    )
                    subprocess.Popen([py_bin, "-c", pred_code], cwd=ml_engine._BASE_DIR, env=env)
                    print(f"[Background Train] 已觸發 {model_type} 訓練後最新推論非同步運算", flush=True)
                except Exception as pred_e:
                    print(f"[Background Train] 觸發訓練後推論失敗: {pred_e}", flush=True)
            else:
                print(f"[Background Train ERROR] {model_type}: 訓練進程非正常結束 (code {proc.returncode})", flush=True)
                ml_engine.STATUS_CACHE[model_type] = {
                    "status": "error",
                    "message": f"訓練失敗: 請查看 {os.path.basename(_TRAIN_LOG)}"
                }
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[Background Train EXCEPTION] {model_type}: {e}\n{tb}", flush=True)
            with open(_TRAIN_LOG, 'a') as f:
                f.write(f"\n=== {model_type} {__import__('datetime').datetime.now()} ===\n{tb}\n")
            ml_engine.STATUS_CACHE[model_type] = {
                "status": "error",
                "message": f"訓練失敗: {str(e)}"
            }

@app.post("/api/ml/train")
def train_ml_model(req: MLTrainRequest):
    current_status = ml_engine.STATUS_CACHE.get(req.model_type, {}).get('status')
    if current_status == 'training':
        return {"status": "ok", "message": f"{req.model_type.upper()} 模型目前已在背景訓練中，請稍候。"}

    t = threading.Thread(
        target=run_background_ml_train,
        args=(req.model_type, req.train_ratio, req.train_days, req.test_days, req.force_retrain, req.min_capital_billion, req.exclude_6digit),
        daemon=True,
        name=f"train-{req.model_type}"
    )
    t.start()
    return {
        "status": "ok",
        "message": f"🚀 已成功啟動 {req.model_type.upper()} 模型背景訓練任務！您可以繼續使用其他功能。",
        "background": True
    }

@app.get("/api/ml/debug_status")
def debug_ml_status():
    """回傳目前 STATUS_CACHE 原始內容與磁碟檔案狀態，供除錯用"""
    import glob
    cache_summary = {k: v.get('status') for k, v in ml_engine.STATUS_CACHE.items()}
    disk_files = [os.path.basename(f) for f in glob.glob(os.path.join(ml_engine._BASE_DIR, 'ml_model_*.joblib'))]
    error_log = ""
    if os.path.exists(_TRAIN_LOG):
        with open(_TRAIN_LOG) as f:
            error_log = f.read()[-3000:]
    return {"cache": cache_summary, "disk_files": disk_files, "error_log": error_log}

@app.post("/api/ml/backtest")
def run_ml_backtest(req: BacktestRequest):
    return backtest_engine.run_backtest(
        model_type=req.model_type,
        min_win_prob=req.min_win_prob,
        max_drop_prob=req.max_drop_prob,
        stop_profit_pct=req.stop_profit_pct,
        stop_loss_pct=req.stop_loss_pct,
        max_holding_days=req.max_holding_days,
        max_portfolio_size=req.max_portfolio_size,
        train_ratio=req.train_ratio,
        train_days=req.train_days,
        test_days=req.test_days,
        exit_strategy=req.exit_strategy,
        trailing_activation_pct=req.trailing_activation_pct,
        min_capital_billion=req.min_capital_billion,
        exclude_6digit=req.exclude_6digit,
        market_bull_filter=req.market_bull_filter
    )

@app.get("/api/ml/predict")
def predict_ml_stocks(
    background_tasks: BackgroundTasks,
    top_n: int = 30,
    model_type: str = None,
    force: bool = False,
    min_capital_billion: float | None = None,
    exclude_6digit: bool | None = None
):
    """
    優先從 JSON 快取秒回結果，避免在 API 請求執行緒中觸發 joblib.load() 的 Segfault。
    若快取不存在或 force=True，立即回傳「計算中」狀態，並在背景進程中非同步計算後更新快取。
    """
    target_type = ml_engine.normalize_model_type(model_type or 'lightgbm')
    latest_db_date = ml_engine.get_latest_market_date()
    ppath = ml_engine.predictions_json_path(target_type)

    # 讀取系統設定中儲存的預設過濾值（若未由 query param 提供）
    if min_capital_billion is None or exclude_6digit is None:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings WHERE key IN ('bt_min_capital_billion', 'bt_exclude_6digit', 'bt_filter_capital')")
            s_rows = dict(cursor.fetchall())
            conn.close()
            if min_capital_billion is None:
                if s_rows.get('bt_filter_capital', 'true').lower() == 'false':
                    min_capital_billion = None
                else:
                    val_str = s_rows.get('bt_min_capital_billion', '10.0')
                    min_capital_billion = float(val_str) if val_str not in [None, "None", ""] else 10.0
            if exclude_6digit is None:
                exclude_6digit = s_rows.get('bt_exclude_6digit', 'true').lower() == 'true'
        except Exception:
            if min_capital_billion is None: min_capital_billion = 10.0
            if exclude_6digit is None: exclude_6digit = True

    # 若要求強制重算，立即清除舊快取
    if force:
        ml_engine.PREDICTION_CACHE.pop(target_type, None)
        if os.path.exists(ppath):
            try:
                os.remove(ppath)
            except Exception:
                pass

    # 若正在背景推論中，絕不可回傳舊快取，一律回傳 computing
    if target_type in ml_engine._PREDICTING_TYPES:
        return {
            "status": "computing",
            "model_type": target_type,
            "message": f"⏳ 正在背景計算 {target_type.upper()} 模型最新市場推論中...",
            "count": 0,
            "data": []
        }

    # 1. 優先從記憶體快取取得（0ms）
    if not force and target_type in ml_engine.PREDICTION_CACHE:
        cached = ml_engine.PREDICTION_CACHE[target_type]
        if cached.get('data') and (not latest_db_date or cached.get('latest_date') == latest_db_date):
            return cached

    # 2. 從磁碟 JSON 快取取得（~2ms）
    if not force and os.path.exists(ppath):
        try:
            with open(ppath, 'r', encoding='utf-8') as f:
                disk_cached = json.load(f)
            if disk_cached.get('status') == 'ok' and disk_cached.get('data'):
                cached_date = disk_cached.get('latest_date') or (disk_cached['data'][0].get('date') if disk_cached['data'] else '')
                if not latest_db_date or cached_date == latest_db_date:
                    ml_engine.PREDICTION_CACHE[target_type] = disk_cached
                    return disk_cached
        except Exception:
            pass

    # 3. 快取 Miss 或 force=True：背景觸發重算，立即回傳「計算中」狀態
    if target_type not in ml_engine._PREDICTING_TYPES:
        ml_engine._PREDICTING_TYPES.add(target_type)

        def _bg_predict():
            import subprocess, sys
            try:
                print(f"[BG Predict] 啟動獨立進程計算 {target_type} 推論 (股本門檻: {min_capital_billion}億, 排除6碼: {exclude_6digit})...", flush=True)
                py_bin = sys.executable
                code = (
                    f"import ml_engine\n"
                    f"ml_engine.predict_top_stocks(\n"
                    f"    top_n={top_n},\n"
                    f"    model_type={repr(target_type)},\n"
                    f"    force=True,\n"
                    f"    min_capital_billion={min_capital_billion if min_capital_billion is not None else 'None'},\n"
                    f"    exclude_6digit={exclude_6digit}\n"
                    f")\n"
                )
                env = os.environ.copy()
                env["OMP_NUM_THREADS"] = "1"
                env["KMP_DUPLICATE_LIB_OK"] = "TRUE"
                subprocess.run([py_bin, "-c", code], cwd=ml_engine._BASE_DIR, env=env, check=False)
                # 推論完成後，將剛產生的磁碟快取載入記憶體
                ppath_done = ml_engine.predictions_json_path(target_type)
                if os.path.exists(ppath_done):
                    with open(ppath_done, 'r', encoding='utf-8') as f:
                        ml_engine.PREDICTION_CACHE[target_type] = json.load(f)
                print(f"[BG Predict] {target_type} 獨立進程推論完成！", flush=True)
            except Exception as e:
                print(f"[BG Predict ERROR] {target_type} 背景預測失敗: {e}", flush=True)
            finally:
                ml_engine._PREDICTING_TYPES.discard(target_type)

        background_tasks.add_task(_bg_predict)

    return {
        "status": "computing",
        "model_type": target_type,
        "message": f"⏳ 正在背景計算 {target_type.upper()} 模型最新市場推論中...",
        "count": 0,
        "data": []
    }

@app.get("/api/ml/status")
def get_ml_status(model_type: str = None):
    return ml_engine.get_model_status(model_type=model_type)

@app.get("/api/ml/status_all")
def get_all_ml_status():
    return ml_engine.get_all_models_status()

class KillTaskRequest(BaseModel):
    pid: int
    model_type: str | None = None

@app.get("/api/tasks/active")
def get_active_tasks():
    import psutil, time, datetime
    tasks = []
    now_ts = time.time()
    
    # 讀取 backfill_history.log 最後一行作為即時摘要
    backfill_log_file = os.path.join(ml_engine._BASE_DIR, 'backfill_history.log')
    backfill_last_msg = ""
    if os.path.exists(backfill_log_file):
        try:
            with open(backfill_log_file, 'r', encoding='utf-8') as f:
                lines = [l.strip() for l in f.readlines() if l.strip()]
                if lines:
                    backfill_last_msg = lines[-1]
        except Exception:
            pass

    MODEL_NAMES_MAP = {
        'attention_bilstm_xgb': '🔥 Attention BiLSTM-XGBoost',
        'vsn_xlstm': '🧬 VSN-xLSTM',
        'patchtst': '🧩 PatchTST',
        'tft': '🔮 TFT (Temporal Fusion Transformer)',
        'resnet50': '🧬 1D ResNet-50',
        'cnn_hybrid': '⚡ CNN-Hybrid',
        'lightgbm': '🌟 LightGBM',
        'mlp': '🧠 DNN (MLP)',
        'xgboost': '🔥 XGBoost',
        'rf': '🌲 Random Forest',
        'lr': '📊 Logistic Regression'
    }

    try:
        current_pid = os.getpid()
        for p in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'cpu_percent', 'memory_info']):
            try:
                pid = p.info['pid']
                if pid == current_pid:
                    continue
                cmdline = p.info.get('cmdline') or []
                cmd_str = " ".join(cmdline)
                
                # 1. 偵測 ML 模型訓練任務
                if 'ml_engine.train_model' in cmd_str or 'train_model(' in cmd_str:
                    m_type = 'unknown'
                    for k in MODEL_NAMES_MAP.keys():
                        if k in cmd_str:
                            m_type = k
                            break
                    
                    c_time = p.info['create_time']
                    elapsed = max(0, int(now_ts - c_time))
                    m_label = MODEL_NAMES_MAP.get(m_type, f"AI 模型 ({m_type})")
                    
                    tasks.append({
                        "id": f"train_{m_type}_{pid}",
                        "type": "ml_train",
                        "name": f"{m_label} 深度學習訓練",
                        "model_type": m_type,
                        "pid": pid,
                        "status": "running",
                        "created_at": datetime.datetime.fromtimestamp(c_time).strftime("%Y-%m-%d %H:%M:%S"),
                        "created_timestamp": c_time,
                        "elapsed_seconds": elapsed,
                        "elapsed_formatted": f"{elapsed // 60}分{elapsed % 60:02d}秒" if elapsed >= 60 else f"{elapsed}秒",
                        "cpu_percent": round(p.info['cpu_percent'] or 0.0, 1),
                        "memory_mb": round((p.info['memory_info'].rss / (1024 * 1024)), 1) if p.info.get('memory_info') else 0.0,
                        "details": "正在背景執行 GPU/CPU 特徵抽取與張量訓練",
                        "can_kill": True
                    })
                    
                # 2. 偵測 歷史數據回補任務
                elif 'backfill_history.py' in cmd_str:
                    c_time = p.info['create_time']
                    elapsed = max(0, int(now_ts - c_time))
                    tasks.append({
                        "id": f"backfill_{pid}",
                        "type": "data_backfill",
                        "name": "🗄️ 五年台股歷史行情與法人數據回補",
                        "model_type": None,
                        "pid": pid,
                        "status": "running",
                        "created_at": datetime.datetime.fromtimestamp(c_time).strftime("%Y-%m-%d %H:%M:%S"),
                        "created_timestamp": c_time,
                        "elapsed_seconds": elapsed,
                        "elapsed_formatted": f"{elapsed // 60}分{elapsed % 60:02d}秒" if elapsed >= 60 else f"{elapsed}秒",
                        "cpu_percent": round(p.info['cpu_percent'] or 0.0, 1),
                        "memory_mb": round((p.info['memory_info'].rss / (1024 * 1024)), 1) if p.info.get('memory_info') else 0.0,
                        "details": backfill_last_msg or "正在進行 TWSE / TPEx 歷史行情自動同步",
                        "can_kill": True
                    })

                # 3. 偵測 推論計算任務
                elif 'predict_top_stocks' in cmd_str:
                    c_time = p.info['create_time']
                    elapsed = max(0, int(now_ts - c_time))
                    tasks.append({
                        "id": f"predict_{pid}",
                        "type": "ml_predict",
                        "name": "⚡ AI 潛力股高勝率篩選推論",
                        "model_type": None,
                        "pid": pid,
                        "status": "running",
                        "created_at": datetime.datetime.fromtimestamp(c_time).strftime("%Y-%m-%d %H:%M:%S"),
                        "created_timestamp": c_time,
                        "elapsed_seconds": elapsed,
                        "elapsed_formatted": f"{elapsed // 60}分{elapsed % 60:02d}秒" if elapsed >= 60 else f"{elapsed}秒",
                        "cpu_percent": round(p.info['cpu_percent'] or 0.0, 1),
                        "memory_mb": round((p.info['memory_info'].rss / (1024 * 1024)), 1) if p.info.get('memory_info') else 0.0,
                        "details": "正在進行全市場量化特徵提取與勝率計算",
                        "can_kill": True
                    })

            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception as e:
        print(f"[ERROR] 查詢活躍任務失敗: {e}", flush=True)

    # 4. 偵測 Podcast 語音轉譯與 AI 分析任務
    try:
        import podcast_pipeline
        p_prog = podcast_pipeline.get_podcast_progress()
        if p_prog and p_prog.get("is_active"):
            cur_ep = p_prog.get("current_episode") or {}
            c_time = cur_ep.get("started_at", now_ts)
            elapsed = max(0, int(now_ts - c_time))
            ep_title = cur_ep.get('title', '單集音訊')
            ch_name = p_prog.get('channel_name') or cur_ep.get('channel_name') or 'Podcast'
            tasks.append({
                "id": f"podcast_{cur_ep.get('episode_guid', 'active')}",
                "type": "podcast_transcribe",
                "name": f"🎧 Podcast 分析：【{ch_name}】{ep_title}",
                "model_type": None,
                "pid": os.getpid(),
                "status": "running",
                "created_at": datetime.datetime.fromtimestamp(c_time).strftime("%Y-%m-%d %H:%M:%S"),
                "created_timestamp": c_time,
                "elapsed_seconds": elapsed,
                "elapsed_formatted": f"{elapsed // 60}分{elapsed % 60:02d}秒" if elapsed >= 60 else f"{elapsed}秒",
                "cpu_percent": 0.0,
                "memory_mb": 0.0,
                "step": cur_ep.get('step_name', '運算中'),
                "step_index": cur_ep.get('step_index', 1),
                "total_steps": cur_ep.get('total_steps', 3),
                "batch_current": p_prog.get('current_job_index', 1),
                "batch_total": p_prog.get('total_jobs', 1),
                "remaining_jobs": p_prog.get('remaining_jobs', 0),
                "progress_pct": p_prog.get('progress_pct', 0),
                "details": f"第 {p_prog.get('current_job_index', 1)}/{p_prog.get('total_jobs', 1)} 集 (剩餘 {p_prog.get('remaining_jobs', 0)} 個 job) - {cur_ep.get('step_name', '運算中')} - {cur_ep.get('message', '')}",
                "can_kill": False
            })
    except Exception as e:
        pass

    return {
        "status": "ok",
        "total_active": len(tasks),
        "tasks": tasks
    }

@app.post("/api/tasks/kill")
def kill_active_task(req: KillTaskRequest):
    import psutil
    try:
        if not psutil.pid_exists(req.pid):
            return {"status": "error", "message": f"進程 PID {req.pid} 已不存在或已結束"}
        
        proc = psutil.Process(req.pid)
        proc.kill()
        
        # 若為 ML 模型訓練，更新其快取狀態為已手動終止
        if req.model_type and req.model_type in ml_engine.STATUS_CACHE:
            ml_engine.STATUS_CACHE[req.model_type] = {
                "status": "error",
                "message": "任務已由使用者手動終止"
            }
            
        return {"status": "ok", "message": f"已成功終止任務 (PID: {req.pid})"}
    except Exception as e:
        return {"status": "error", "message": f"終止任務失敗: {str(e)}"}

class BacktestSettingsItem(BaseModel):
    min_win_prob: float = 35.0
    max_drop_prob: float = 30.0
    stop_profit_pct: float = 20.0
    stop_loss_pct: float = 8.0
    max_holding_days: int = 20
    max_portfolio_size: int = 5
    train_ratio: float = 0.8
    train_days: int | None = 180
    test_days: int | None = 30
    exit_strategy: str = "fixed"
    trailing_activation_pct: float = 10.0
    min_capital_billion: float | None = 10.0
    exclude_6digit: bool = True
    filter_capital: bool = True
    market_bull_filter: bool = False

@app.get("/api/ml/backtest_settings")
def get_backtest_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings WHERE key LIKE 'bt_%'")
    rows = cursor.fetchall()
    conn.close()
    
    settings_dict = {row['key']: row['value'] for row in rows}
    return {
        "min_win_prob": float(settings_dict.get("bt_min_win_prob", "35")),
        "max_drop_prob": float(settings_dict.get("bt_max_drop_prob", "30")),
        "stop_profit_pct": float(settings_dict.get("bt_stop_profit_pct", "20")),
        "stop_loss_pct": float(settings_dict.get("bt_stop_loss_pct", "8")),
        "max_holding_days": int(settings_dict.get("bt_max_holding_days", "20")),
        "max_portfolio_size": int(settings_dict.get("bt_max_portfolio_size", "5")),
        "train_ratio": float(settings_dict.get("bt_train_ratio", "0.8")),
        "train_days": int(settings_dict.get("bt_train_days", "180")) if settings_dict.get("bt_train_days") else 180,
        "test_days": int(settings_dict.get("bt_test_days", "30")) if settings_dict.get("bt_test_days") else 30,
        "exit_strategy": settings_dict.get("bt_exit_strategy", "fixed"),
        "trailing_activation_pct": float(settings_dict.get("bt_trailing_activation_pct", "10.0")),
        "min_capital_billion": float(settings_dict.get("bt_min_capital_billion", "10.0")) if settings_dict.get("bt_min_capital_billion") not in [None, "None", ""] else 10.0,
        "exclude_6digit": settings_dict.get("bt_exclude_6digit", "true").lower() == "true",
        "filter_capital": settings_dict.get("bt_filter_capital", "true").lower() == "true",
        "market_bull_filter": settings_dict.get("bt_market_bull_filter", "false").lower() == "true"
    }

@app.post("/api/ml/backtest_settings")
def save_backtest_settings(settings: BacktestSettingsItem):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_min_win_prob', ?)", (str(settings.min_win_prob),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_max_drop_prob', ?)", (str(settings.max_drop_prob),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_stop_profit_pct', ?)", (str(settings.stop_profit_pct),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_stop_loss_pct', ?)", (str(settings.stop_loss_pct),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_max_holding_days', ?)", (str(settings.max_holding_days),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_max_portfolio_size', ?)", (str(settings.max_portfolio_size),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_train_ratio', ?)", (str(settings.train_ratio),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_exit_strategy', ?)", (str(settings.exit_strategy),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_trailing_activation_pct', ?)", (str(settings.trailing_activation_pct),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_exclude_6digit', ?)", (str(settings.exclude_6digit).lower(),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_filter_capital', ?)", (str(settings.filter_capital).lower(),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_market_bull_filter', ?)", (str(settings.market_bull_filter).lower(),))
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_min_capital_billion', ?)", (str(settings.min_capital_billion) if settings.min_capital_billion is not None else "None",))
    if settings.train_days is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_train_days', ?)", (str(settings.train_days),))
    if settings.test_days is not None:
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('bt_test_days', ?)", (str(settings.test_days),))
    conn.commit()
    conn.close()
    return {"status": "ok", "message": "回測與訓練過濾參數已成功儲存！"}

# ================================
# 3.5 低頻量化波段選股系統 (Low-Frequency Quant Swing Trading)
# ================================
import low_freq_engine

class LowFreqBacktestRequest(BaseModel):
    rolling_months: int = 24
    top_n: int = 30
    market_filter: bool = True

@app.get("/api/low_freq/status")
def get_low_freq_status():
    cached = low_freq_engine.get_cached_low_freq_result()
    m_status = low_freq_engine.get_market_ma60_status()
    if cached:
        return {
            "status": "ok",
            "cached": True,
            "data": cached,
            "market_status": m_status
        }
    return {
        "status": "ok",
        "cached": False,
        "market_status": m_status,
        "message": "尚未執行低頻量化回測，請點擊執行回測"
    }

@app.post("/api/low_freq/backtest")
def run_low_freq_backtest(req: LowFreqBacktestRequest):
    return low_freq_engine.run_low_freq_pipeline(
        rolling_months=req.rolling_months,
        top_n=req.top_n,
        market_filter=req.market_filter
    )

@app.get("/api/low_freq/top30")
def get_low_freq_top30():
    cached = low_freq_engine.get_cached_low_freq_result()
    if cached and cached.get("top30_recommendations"):
        return {
            "status": "ok",
            "generated_at": cached.get("generated_at"),
            "market_status": cached.get("market_status"),
            "top30": cached.get("top30_recommendations")
        }
    res = low_freq_engine.run_low_freq_pipeline()
    return {
        "status": "ok",
        "generated_at": res.get("generated_at"),
        "market_status": res.get("market_status"),
        "top30": res.get("top30_recommendations", [])
    }

@app.get("/api/global_sovereign/dashboard")
@app.get("/api/global-sovereign/dashboard")
def get_global_sovereign_dashboard():
    """全球主權國家泰坦看板：即時國運動能排行、歷史回測清單與歷年獲利"""
    import importlib
    import global_sovereign_service
    importlib.reload(global_sovereign_service)
    return global_sovereign_service.get_global_sovereign_dashboard_data()

@app.get("/api/global_sovereign/dml-dsr")
@app.get("/api/global-sovereign/dml-dsr")
def get_global_sovereign_dml_dsr():
    """全球泰坦 DML 因果提純與 DSR (Deflated Sharpe Ratio) 檢驗完整量化報告"""
    results_path = os.path.join(BASE_DIR, "dml_and_dsr_results.json")
    if os.path.exists(results_path):
        try:
            with open(results_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"讀取 DML/DSR 成果失敗: {e}")
    raise HTTPException(status_code=404, detail="DML & DSR 分析成果檔尚未生成，請先執行 run_dml_and_dsr_analysis.py")

@app.get("/api/global_sovereign/rank-ic")
@app.get("/api/global-sovereign/rank-ic")
def get_global_sovereign_rank_ic(start_date: str = None, end_date: str = None, factor: str = "composite"):
    """全球泰坦 Rank IC 動態因子檢驗 API：支援任意時間範圍與六大因子評估"""
    import global_sovereign_service
    return global_sovereign_service.get_global_titan_rank_ic_analysis(start_date, end_date, factor)

_causal_titan_lock = threading.Lock()

@app.get("/api/causal_titan/dashboard")
def get_causal_titan_dashboard(refresh: bool = False):
    """台股因果泰坦 (上限1億, exp_264)：直連本機 tw_stock.db。
    若資料庫最新交易日比目前快照新 (或 refresh=true)，立即以本機資料庫重算 exp_264 後回傳。"""
    import json as _json
    import sqlite3 as _sqlite3
    import exp264_titan_sync
    json_path = os.path.join(BASE_DIR, "frontend", "src", "data", "taiwan_causal_titan_data.json")
    db_path = os.path.join(BASE_DIR, "tw_stock.db")
    def _snap_date():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return str(_json.load(f).get("strategy_info", {}).get("latest_data_date", "")).replace("-", "")
        except Exception:
            return ""
    db_latest = ""
    try:
        conn = _sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
        db_latest = conn.execute("SELECT MAX(date) FROM daily_index").fetchone()[0] or ""
        conn.close()
    except Exception as e:
        print(f"[x] 讀取 tw_stock.db 最新日期失敗: {e}")
    recomputed, err = False, None
    if refresh or (db_latest and db_latest > _snap_date()):
        with _causal_titan_lock:
            if refresh or db_latest > _snap_date():     # 鎖內再確認，避免重複重算
                try:
                    exp264_titan_sync.run()
                    recomputed = True
                except Exception as e:
                    err = str(e)
                    print(f"[x] 台股因果泰坦重算失敗: {e}")
    with open(json_path, "r", encoding="utf-8") as f:
        data = _json.load(f)
    data["status"] = "ok"
    data["live_source"] = {"db": "tw_stock.db (本機)", "db_latest_date": db_latest, "snapshot_date": _snap_date(),
                           "recomputed": recomputed, "error": err}
    return data

@app.get("/api/tw_event_radar/dashboard")
def get_tw_event_radar_dashboard():
    """台股事件與ETF吃豆腐看板：高股息ETF換股提前卡位預測 + 個股期貨逆價差與軋空事件掃描"""
    import tw_special_strategies_service
    return tw_special_strategies_service.get_tw_event_radar_data()

@app.get("/api/tw_asymmetric_alpha/dashboard")
def get_tw_asymmetric_alpha_dashboard():
    """台股可轉債主力與急跌狙擊看板：CB/CBAS千張大戶鎖碼雷達 + 強勢股Connors RSI(2)極端急跌反彈"""
    import tw_special_strategies_service
    return tw_special_strategies_service.get_tw_asymmetric_alpha_data()

@app.get("/api/oversold_sniper/dashboard")
@app.get("/api/oversold_sniper/radar")
def get_oversold_sniper_dashboard(refresh: bool = False, scan: bool = False):
    """強勢股極端超賣快打專屬看板：直連 tw_stock.db 全球主權泰坦強勢股庫 + 台股新資料庫即時雷達"""
    import importlib
    import oversold_sniper_service
    importlib.reload(oversold_sniper_service)
    if refresh or scan:
        return oversold_sniper_service.run_full_rescan()
    return oversold_sniper_service.get_oversold_sniper_dashboard_data()

@app.post("/api/oversold_sniper/scan")
def trigger_oversold_sniper_rescan():
    """重新掃描全市場：連線抓取最新即時行情 (10/23) -> 運算 Z-Score -> 同步 Supabase"""
    import importlib
    import oversold_sniper_service
    importlib.reload(oversold_sniper_service)
    fresh_data = oversold_sniper_service.run_full_rescan()
    return {
        "status": "ok",
        "message": "重新掃描成功！已連線更新至 10/23 最新行情！",
        "data": fresh_data
    }

@app.post("/api/oversold_sniper/trades")
def create_oversold_sniper_trade(payload: dict = Body(...)):
    """新增實盤跟單紀錄 (支援 S/B 分級、动态首個獲利門檻與獨立進場時間)"""
    import oversold_sniper_service
    ticker = payload.get("ticker", "")
    name = payload.get("name", ticker)
    market = payload.get("market", "台股")
    currency = payload.get("currency", "TWD")
    entry_price = payload.get("entry_price", 0)
    shares = payload.get("shares", 1000)
    entry_date = payload.get("entry_date", datetime.now().strftime("%Y-%m-%d"))
    entry_time = payload.get("entry_time", datetime.now().strftime("%H:%M:%S"))
    tier = payload.get("tier", "B")
    natr_pct = payload.get("natr_pct", 2.8)
    mom60_pct = payload.get("mom60_pct", 10.0)
    trust_buy = payload.get("trust_buy", 0)
    context_mode = payload.get("context_mode", "🛡️ 平靜日法人自救")
    notes = payload.get("notes", "")
    return oversold_sniper_service.add_user_trade(
        ticker, name, market, currency, entry_price, shares, entry_date, notes,
        entry_time=entry_time, tier=tier, natr_pct=natr_pct, mom60_pct=mom60_pct,
        trust_buy=trust_buy, context_mode=context_mode
    )

@app.post("/api/oversold_sniper/trades/{trade_id}/close")
def close_oversold_sniper_trade(trade_id: str, payload: dict = Body(...)):
    """平倉實盤快打紀錄 (輸入賣出價位與理由，分開記錄出場日期與時間)"""
    import oversold_sniper_service
    exit_price = payload.get("exit_price", 0)
    exit_date = payload.get("exit_date", datetime.now().strftime("%Y-%m-%d"))
    exit_time = payload.get("exit_time", datetime.now().strftime("%H:%M:%S"))
    exit_reason = payload.get("exit_reason", "🎯 觸及 10MA 停利")
    return oversold_sniper_service.close_user_trade(trade_id, exit_price, exit_date, exit_reason, exit_time=exit_time)

@app.delete("/api/oversold_sniper/trades/{trade_id}")
def delete_oversold_sniper_trade(trade_id: str):
    """刪除實盤快打交易紀錄"""
    import oversold_sniper_service
    return oversold_sniper_service.delete_user_trade(trade_id)

@app.get("/api/market_ml/status")
@app.get("/api/market_ml/predict")
def get_market_ml_status():
    """取得大盤多因子 ML 推論與泰坦回測報告 (自本地 market_ml_prediction.json 快取讀取)"""
    pred_path = os.path.join(BASE_DIR, "market_ml_prediction.json")
    if os.path.exists(pred_path):
        try:
            with open(pred_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            return {"status": "error", "message": f"讀取大盤預測快取失敗: {e}"}
    return {"status": "empty", "message": "尚未產生大盤預測報告"}

@app.post("/api/market_ml/predict")
def trigger_market_ml_predict(background_tasks: BackgroundTasks, payload: dict = Body(default={})):
    """觸發大盤與泰坦實戰部位最新推論 (非同步背景執行)"""
    def _run_predict():
        try:
            import stock_cloud_worker
            stock_cloud_worker.execute_market_ml_job(payload or {})
        except Exception as e:
            print(f"[Market ML Predict] 背景推論失敗: {e}")
    background_tasks.add_task(_run_predict)
    return {"status": "ok", "message": "🚀 大盤與泰坦實戰部位最新推論已在背景啟動！"}

@app.post("/api/market_ml/train")
def trigger_market_ml_train(background_tasks: BackgroundTasks, payload: dict = Body(default={})):
    """觸發大盤多因子 ML 模型重新訓練與推論 (非同步背景執行)"""
    def _run_train():
        try:
            import stock_cloud_worker
            stock_cloud_worker.execute_market_ml_train_job(payload or {})
        except Exception as e:
            print(f"[Market ML Train] 背景訓練失敗: {e}")
    background_tasks.add_task(_run_train)
    return {"status": "ok", "message": "🚀 大盤 ML 模型重訓任務已在背景啟動！"}

# ================================
# 4. 網頁前端 (Web Frontend) 整合
# ================================
# 讓 FastAPI 一併提供編譯好的 React 前端檔案
frontend_dist = os.path.join(BASE_DIR, "frontend", "build")
if not os.path.exists(frontend_dist):
    frontend_dist = os.path.join(BASE_DIR, "frontend", "dist")
if not os.path.exists(frontend_dist):
    frontend_dist = os.path.join(BASE_DIR, "web-frontend", "dist")

if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    static_dir = os.path.join(frontend_dist, "static")
    if os.path.exists(static_dir):
        app.mount("/static", StaticFiles(directory=static_dir), name="static")
    
    # 將所有非 API 的請求都導向 React 的 index.html (SPA routing)
    @app.get("/{catchall:path}")
    def serve_react_app(catchall: str):
        if catchall.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
            
        file_path = os.path.join(frontend_dist, catchall)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            resp = FileResponse(file_path)
            if file_path.endswith(".html"):
                resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
                resp.headers["Pragma"] = "no-cache"
                resp.headers["Expires"] = "0"
            return resp
            
        # 如果找不到檔案 (例如前端路由)，一律回傳 index.html 讓 React Router 處理
        resp = FileResponse(os.path.join(frontend_dist, "index.html"))
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
else:
    print(f"Warning: 前端打包資料夾 {frontend_dist} 不存在。請先執行 npm run build。")


