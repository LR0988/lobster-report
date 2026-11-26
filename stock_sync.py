#!/usr/bin/env python3
"""
Lobster Report - 雲地同步工具模組 (stock_sync.py)
負責將本機 4.9GB tw_stock.db 與 11 種 ML 模型推論 JSON 快取同步至 Supabase 雲端
"""

import os
import sys
import glob
import json
import time
import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()
load_dotenv("/Users/huanggin-chen/openclaw_test/.env")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/openclaw_test"
LOCAL_STOCK_DB = os.path.join(LOCAL_DIR, "tw_stock.db")
DATABASE_URL = os.getenv("DATABASE_URL")

_UPSERT_ML_SQL = """
    INSERT INTO stock_ml_cache (model_type, payload, updated_at)
    VALUES (%s, %s, CURRENT_TIMESTAMP)
    ON CONFLICT (model_type) DO UPDATE
    SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
"""


def get_supabase_conn():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL 環境變數未設定")
    return psycopg2.connect(
        DATABASE_URL,
        sslmode="require",
        connect_timeout=15,
        keepalives=1,
        keepalives_idle=20,
        keepalives_interval=10,
        keepalives_count=3,
        options="-c statement_timeout=45000",
    )


class ResilientSupabaseSession:
    """Supabase PostgreSQL 彈性連線包裝：每筆獨立 commit、SSL/網路斷線自動重連與 3 次重試。"""

    def __init__(self, conn=None):
        self.conn = conn if conn is not None else get_supabase_conn()

    def _reconnect(self):
        try:
            if self.conn is not None and self.conn.closed == 0:
                self.conn.close()
        except Exception:
            pass
        self.conn = get_supabase_conn()

    def _is_connection_error(self, exc: Exception) -> bool:
        if isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError)):
            return True
        if self.conn is None or self.conn.closed != 0:
            return True
        msg = str(exc).lower()
        return any(
            k in msg
            for k in (
                "cursor already closed",
                "connection already closed",
                "ssl syscall",
                "operation timed out",
                "eof detected",
                "server closed the connection",
                "reset by peer",
                "broken pipe",
                "terminating connection",
            )
        )

    def _recover_after_error(self, exc: Exception):
        if self._is_connection_error(exc):
            self._reconnect()
            return
        try:
            if self.conn is not None and self.conn.closed == 0:
                self.conn.rollback()
            else:
                self._reconnect()
        except Exception:
            self._reconnect()

    def execute_commit(self, sql: str, params=None, retries: int = 3, label: str = ""):
        for attempt in range(1, retries + 1):
            try:
                if self.conn is None or self.conn.closed != 0:
                    self._reconnect()
                with self.conn.cursor() as cur:
                    cur.execute(sql, params)
                self.conn.commit()
                return
            except Exception as e:
                is_conn = self._is_connection_error(e)
                if attempt < retries and (is_conn or isinstance(e, psycopg2.DatabaseError)):
                    first_ln = str(e).splitlines()[0] if str(e) else repr(e)
                    print(f"  ↻ Supabase 寫入重試 ({attempt}/{retries}) [{label or 'query'}]: {first_ln}")
                    self._recover_after_error(e)
                    time.sleep(min(1.5 * attempt, 5.0))
                    continue
                try:
                    if self.conn is not None and self.conn.closed == 0:
                        self.conn.rollback()
                except Exception:
                    pass
                raise

    def fetchall_retry(self, sql: str, params=None, retries: int = 3, label: str = ""):
        for attempt in range(1, retries + 1):
            try:
                if self.conn is None or self.conn.closed != 0:
                    self._reconnect()
                with self.conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall()
            except Exception as e:
                is_conn = self._is_connection_error(e)
                if attempt < retries and (is_conn or isinstance(e, psycopg2.DatabaseError)):
                    first_ln = str(e).splitlines()[0] if str(e) else repr(e)
                    print(f"  ↻ Supabase 查詢重試 ({attempt}/{retries}) [{label or 'select'}]: {first_ln}")
                    self._recover_after_error(e)
                    time.sleep(min(1.5 * attempt, 5.0))
                    continue
                try:
                    if self.conn is not None and self.conn.closed == 0:
                        self.conn.rollback()
                except Exception:
                    pass
                raise

    def close(self):
        try:
            if self.conn is not None and self.conn.closed == 0:
                self.conn.close()
        except Exception:
            pass


def _ensure_session(sb_conn) -> ResilientSupabaseSession:
    if isinstance(sb_conn, ResilientSupabaseSession):
        return sb_conn
    return ResilientSupabaseSession(sb_conn)

def get_sqlite_conn():
    if not os.path.exists(LOCAL_STOCK_DB):
        raise FileNotFoundError(f"找不到本地台股資料庫: {LOCAL_STOCK_DB}")
    conn = sqlite3.connect(LOCAL_STOCK_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn

def _load_fresh_json_if_exists(path: str):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None

def sync_ml_cache(sb_conn, reuse_fresh_json: bool = False):
    """同步 11 種機器學習模型預測及低頻量化報告至 Supabase stock_ml_cache"""
    print("[*] 正在同步 ML 模型預測快取至 Supabase...")
    sb = _ensure_session(sb_conn)
    ml_files = glob.glob(os.path.join(LOCAL_DIR, "ml_predictions_*.json"))
    status_all = {}
    critical_failures = []

    for f in ml_files:
        filename = os.path.basename(f)
        model_type = filename.replace("ml_predictions_", "").replace(".json", "")
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)

            status_all[model_type] = {
                "status": "ready",
                "trained_at": data.get("trained_at", ""),
                "latest_date": data.get("latest_date", ""),
                "metrics": data.get("metrics", {}),
                "count": data.get("count", len(data.get("data", [])))
            }

            sb.execute_commit(_UPSERT_ML_SQL, (model_type, json.dumps(data)), label=f"ml:{model_type}")
            print(f"  ✓ ML 模型: {model_type} ({len(data.get('data', []))} 筆推薦)")
        except Exception as e:
            print(f"  ✗ 同步模型 {model_type} 失敗: {e}")

    # 上傳 status_all 匯總狀態
    try:
        sb.execute_commit(_UPSERT_ML_SQL, ("status_all", json.dumps(status_all)), label="ml:status_all")
        print("  ✓ 匯總模型狀態 status_all 同步完成")
    except Exception as e:
        print(f"  ✗ 同步匯總狀態 status_all 失敗: {e}")
        critical_failures.append(f"status_all: {e}")

    # 上傳大盤 ML 預測 (taiex_macro) — 移除超過 50MB 的多年度歷史全量明細以確保雲端同步秒級完成
    market_pred_file = os.path.join(LOCAL_DIR, "market_ml_prediction.json")
    if os.path.exists(market_pred_file):
        try:
            with open(market_pred_file, "r", encoding="utf-8") as fp:
                market_data = json.load(fp)
            if isinstance(market_data.get("backtest_simulation"), dict):
                bs_slim = dict(market_data["backtest_simulation"])
                bs_slim.pop("full_history_10y", None)
                bs_slim.pop("full_history_20y", None)
                bs_slim.pop("models_detail", None)
                if isinstance(bs_slim.get("periods"), dict):
                    def_pk = bs_slim.get("default_period_key", "1y")
                    bs_slim["periods"] = {k: v for k, v in bs_slim["periods"].items() if k in (def_pk, "6m", "1y")}
                market_data = dict(market_data)
                market_data["backtest_simulation"] = bs_slim
            sb.execute_commit(_UPSERT_ML_SQL, ("taiex_macro", json.dumps(market_data)), label="taiex_macro")
            print("  ✓ 大盤 ML 預測 (taiex_macro) 同步完成")
        except Exception as e:
            print(f"  ✗ 同步大盤 ML 失敗: {e}")

    # 上傳 low_freq_result.json 低頻量化資料
    low_freq_path = os.path.join(LOCAL_DIR, "low_freq_result.json")
    if os.path.exists(low_freq_path):
        try:
            with open(low_freq_path, "r", encoding="utf-8") as fp:
                lf_data = json.load(fp)
            sb.execute_commit(_UPSERT_ML_SQL, ("low_freq", json.dumps(lf_data)), label="low_freq")
            print("  ✓ 低頻量化回測結果同步完成")
        except Exception as e:
            print(f"  ✗ 低頻量化同步失敗: {e}")

    # 上傳全球主權泰坦最新數據 (global_sovereign_dashboard)
    try:
        def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultGlobalSovereignData.json")
        gs_data = _load_fresh_json_if_exists(def_path) if reuse_fresh_json else None
        if not gs_data or gs_data.get("status") != "ok":
            import importlib
            import global_sovereign_service
            importlib.reload(global_sovereign_service)
            gs_data = global_sovereign_service.get_global_sovereign_dashboard_data()
            if gs_data and gs_data.get("status") == "ok" and os.path.exists(os.path.dirname(def_path)):
                with open(def_path, "w", encoding="utf-8") as f:
                    json.dump(gs_data, f, ensure_ascii=False, indent=2)
                print("  ✓ 全球主權泰坦前端 defaultGlobalSovereignData.json 同步完成")
        if gs_data and gs_data.get("status") == "ok":
            sb.execute_commit(
                _UPSERT_ML_SQL,
                ("global_sovereign_dashboard", json.dumps(gs_data, ensure_ascii=False)),
                label="global_sovereign_dashboard",
            )
            print("  ✓ 全球主權泰坦最新即時數據同步至 stock_ml_cache")
    except Exception as e:
        print(f"  ✗ 同步全球主權泰坦失敗: {e}")
        critical_failures.append(f"global_sovereign_dashboard: {e}")

    # 上傳全球泰坦互補戰艦 V12 五檔精銳22號同步版最新數據 (complementary_v3_dashboard)
    try:
        v12_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultComplementaryV3Data.json")
        v3_data = _load_fresh_json_if_exists(v12_def_path) if reuse_fresh_json else None
        if not v3_data or v3_data.get("status") != "ok":
            import importlib
            import complementary_v3_service
            importlib.reload(complementary_v3_service)
            v3_data = complementary_v3_service.get_complementary_v3_dashboard_data(force_refresh=False)
        if v3_data and v3_data.get("status") == "ok":
            sb.execute_commit(
                _UPSERT_ML_SQL,
                ("complementary_v3_dashboard", json.dumps(v3_data, ensure_ascii=False)),
                label="complementary_v3_dashboard",
            )
            print("  ✓ 全球泰坦互補戰艦 V12 五檔精銳22號同步版最新即時數據同步至 stock_ml_cache 完成")
    except Exception as e:
        print(f"  ✗ 同步全球泰坦互補戰艦 V12 五檔精銳22號同步版失敗: {e}")
        critical_failures.append(f"complementary_v3_dashboard: {e}")

    # 上傳台股因果泰坦 (大凹洞轉型波段母子艦隊 PIT) 最新數據 (causal_titan_dashboard)
    try:
        ct_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "taiwan_causal_titan_data.json")
        ct_data = _load_fresh_json_if_exists(ct_def_path) if reuse_fresh_json else None
        if not ct_data:
            import importlib
            import tw_titan_pit_service
            importlib.reload(tw_titan_pit_service)
            ct_data = tw_titan_pit_service.refresh_live(force_rebuild=False)
        if ct_data:
            ct_data["status"] = "ok"
            sb.execute_commit(
                _UPSERT_ML_SQL,
                ("causal_titan_dashboard", json.dumps(ct_data, ensure_ascii=False)),
                label="causal_titan_dashboard",
            )
            print("  ✓ 台股因果泰坦 (大凹洞母子艦隊 PIT) 最新即時數據同步至 stock_ml_cache 完成")
    except Exception as e:
        print(f"  ✗ 同步台股因果泰坦失敗: {e}")
        critical_failures.append(f"causal_titan_dashboard: {e}")

    # 上傳強勢股超賣快打 3.0 最新數據 (oversold_sniper_dashboard)
    try:
        os_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultOversoldSniperData.json")
        os_data = _load_fresh_json_if_exists(os_def_path) if reuse_fresh_json else None
        if not os_data or os_data.get("status") != "ok":
            import importlib
            import oversold_sniper_service
            importlib.reload(oversold_sniper_service)
            os_data = oversold_sniper_service.get_oversold_sniper_dashboard_data()
        if os_data and os_data.get("status") == "ok":
            sb.execute_commit(
                _UPSERT_ML_SQL,
                ("oversold_sniper_dashboard", json.dumps(os_data, ensure_ascii=False)),
                label="oversold_sniper_dashboard",
            )
            print("  ✓ 強勢股超賣快打 3.0 最新即時數據同步至 stock_ml_cache 完成")
    except Exception as e:
        print(f"  ✗ 同步強勢股超賣快打失敗: {e}")
        critical_failures.append(f"oversold_sniper_dashboard: {e}")

    # 上傳台股事件與ETF吃豆腐 & 可轉債主力與急跌狙擊最新數據
    try:
        ev_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultTwEventRadarData.json")
        asym_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultTwAsymmetricAlphaData.json")
        ev_obj = _load_fresh_json_if_exists(ev_def_path) if reuse_fresh_json else None
        asym_obj = _load_fresh_json_if_exists(asym_def_path) if reuse_fresh_json else None
        if not (ev_obj and ev_obj.get("status") == "ok" and asym_obj and asym_obj.get("status") == "ok"):
            import importlib
            import tw_special_strategies_service
            importlib.reload(tw_special_strategies_service)
            sp_out = tw_special_strategies_service.compute_tw_special_strategies(save_json=True)
            ev_obj = sp_out.get("tw_event_radar")
            asym_obj = sp_out.get("tw_asymmetric_alpha")
        for cache_key, payload_obj in [
            ("tw_event_radar_dashboard", ev_obj),
            ("tw_asymmetric_alpha_dashboard", asym_obj),
        ]:
            if payload_obj and payload_obj.get("status") == "ok":
                sb.execute_commit(
                    _UPSERT_ML_SQL,
                    (cache_key, json.dumps(payload_obj, ensure_ascii=False)),
                    label=cache_key,
                )
        print("  ✓ 台股事件吃豆腐與可轉債落難天使好球帶雷達同步至 stock_ml_cache 完成")
    except Exception as e:
        print(f"  ✗ 同步台股特殊策略失敗: {e}")
        critical_failures.append(f"tw_special_strategies: {e}")

    # 上傳全球原物料期貨 CTA 泰坦最新數據 (commodity_cta_dashboard)
    try:
        cta_def_path = os.path.join(LOCAL_DIR, "frontend", "src", "data", "defaultCommodityCtaData.json")
        cta_data = _load_fresh_json_if_exists(cta_def_path) if reuse_fresh_json else None
        if not cta_data or cta_data.get("status") != "ok":
            import importlib
            import commodity_cta_service
            importlib.reload(commodity_cta_service)
            cta_data = commodity_cta_service.get_commodity_cta_dashboard_data(force_refresh=False)
        if cta_data and cta_data.get("status") == "ok":
            sb.execute_commit(
                _UPSERT_ML_SQL,
                ("commodity_cta_dashboard", json.dumps(cta_data, ensure_ascii=False)),
                label="commodity_cta_dashboard",
            )
            print("  ✓ 全球原物料期貨 CTA 泰坦最新即時數據同步至 stock_ml_cache 完成")
    except Exception as e:
        print(f"  ✗ 同步全球原物料期貨 CTA 泰坦失敗: {e}")
        critical_failures.append(f"commodity_cta_dashboard: {e}")

    if critical_failures:
        raise RuntimeError(f"關鍵策略看板同步 Supabase 失敗: {' | '.join(critical_failures)}")

def sync_portfolio(sb_conn, local_conn):
    """同步持股清單與最新價格、燈號、分析報告"""
    print("[*] 正在同步持股 (Portfolio) 資料...")
    local_cur = local_conn.cursor()
    sb = _ensure_session(sb_conn)

    local_cur.execute("""
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
            (SELECT h.has_rumor FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as has_rumor,
            (SELECT h.analysis_text FROM portfolio_analysis_history h WHERE h.stock_id = p.stock_id ORDER BY h.date DESC LIMIT 1) as analysis_report
        FROM portfolio p
    """)
    rows = local_cur.fetchall()
    for r in rows:
        name = r["stock_name"] or r["official_name"] or "未知股"
        sb.execute_commit("""
            INSERT INTO stock_portfolio (
                stock_id, stock_name, buy_price, notes, auto_analyze,
                latest_price, latest_date, latest_signal, latest_analysis_date,
                sentiment_score, sentiment_direction, has_rumor, analysis_report, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (stock_id) DO UPDATE SET
                stock_name = EXCLUDED.stock_name,
                buy_price = EXCLUDED.buy_price,
                notes = EXCLUDED.notes,
                auto_analyze = EXCLUDED.auto_analyze,
                latest_price = EXCLUDED.latest_price,
                latest_date = EXCLUDED.latest_date,
                latest_signal = EXCLUDED.latest_signal,
                latest_analysis_date = EXCLUDED.latest_analysis_date,
                sentiment_score = EXCLUDED.sentiment_score,
                sentiment_direction = EXCLUDED.sentiment_direction,
                has_rumor = EXCLUDED.has_rumor,
                analysis_report = EXCLUDED.analysis_report,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            r["stock_id"], name, r["buy_price"], r["notes"], r["auto_analyze"],
            r["latest_price"], r["latest_date"], r["latest_signal"], r["latest_analysis_date"],
            r["sentiment_score"], r["sentiment_direction"], r["has_rumor"], r["analysis_report"]
        ), label=f"portfolio:{r['stock_id']}")
    print(f"  ✓ 成功同步 {len(rows)} 檔持股明細")

def sync_watchlist(sb_conn, local_conn):
    """同步自選追蹤清單與 MA5/20/60"""
    print("[*] 正在同步自選追蹤清單 (Watchlist)...")
    local_cur = local_conn.cursor()
    sb = _ensure_session(sb_conn)

    local_cur.execute("SELECT * FROM watchlist")
    rows = local_cur.fetchall()
    for w in rows:
        stock_id = w["stock_id"]
        local_cur.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL ORDER BY date DESC LIMIT 1", (stock_id,))
        name_r = local_cur.fetchone()
        official_name = name_r["stock_name"] if name_r else "未知股"
        name = w["stock_name"] or official_name

        local_cur.execute("SELECT closing_price, date FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 60", (stock_id,))
        prices = local_cur.fetchall()
        latest_price, latest_date, ma5, ma20, ma60 = None, None, None, None, None
        if prices:
            latest_price = prices[0]["closing_price"]
            latest_date = prices[0]["date"]
            n = len(prices)
            ma5 = round(sum(p["closing_price"] for p in prices[:5]) / 5.0, 2) if n >= 5 else None
            ma20 = round(sum(p["closing_price"] for p in prices[:20]) / 20.0, 2) if n >= 20 else None
            ma60 = round(sum(p["closing_price"] for p in prices[:60]) / 60.0, 2) if n >= 60 else None

        sb.execute_commit("""
            INSERT INTO stock_watchlist (
                stock_id, stock_name, target_price_high, target_price_low,
                compare_ma5, compare_ma20, compare_ma60, latest_price, latest_date,
                ma5, ma20, ma60, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (stock_id) DO UPDATE SET
                stock_name = EXCLUDED.stock_name,
                target_price_high = EXCLUDED.target_price_high,
                target_price_low = EXCLUDED.target_price_low,
                compare_ma5 = EXCLUDED.compare_ma5,
                compare_ma20 = EXCLUDED.compare_ma20,
                compare_ma60 = EXCLUDED.compare_ma60,
                latest_price = EXCLUDED.latest_price,
                latest_date = EXCLUDED.latest_date,
                ma5 = EXCLUDED.ma5,
                ma20 = EXCLUDED.ma20,
                ma60 = EXCLUDED.ma60,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            stock_id, name, w["target_price_high"], w["target_price_low"],
            w["compare_ma5"], w["compare_ma20"], w["compare_ma60"],
            latest_price, latest_date, ma5, ma20, ma60
        ), label=f"watchlist:{stock_id}")
    print(f"  ✓ 成功同步 {len(rows)} 檔自選股")

def sync_settings(sb_conn, local_conn):
    """同步系統設定與回測參數"""
    print("[*] 正在同步系統與回測設定...")
    local_cur = local_conn.cursor()
    sb = _ensure_session(sb_conn)

    local_cur.execute("SELECT key, value FROM settings")
    rows = local_cur.fetchall()
    for s in rows:
        sb.execute_commit("""
            INSERT INTO stock_settings (key, value, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
        """, (s["key"], s["value"]), label=f"setting:{s['key']}")
    print(f"  ✓ 成功同步 {len(rows)} 項設定參數")

def sync_database_previews(sb_conn, local_conn):
    """同步五大核心資料庫表格的最新 100 筆快照至 Supabase 供前端瞬時瀏覽"""
    print("[*] 正在同步資料庫檢視快照...")
    local_cur = local_conn.cursor()
    sb = _ensure_session(sb_conn)

    tables = [
        "daily_stock", "monthly_revenue", "institutional_trades", "institutional_futures",
        "stock_margin_daily", "shareholder_concentration",
        "daily_index", "market_breadth", "options_pc_ratio", "macro_indicators",
        "tpex_cb_metadata", "tpex_cb_quotes",
        "global_stock_daily", "global_sovereign_daily",
        "commodity_futures_daily", "commodity_futures_metadata", "commodity_cta_user_trades",
        "futures_1m", "futures_5m",
        "quarterly_eps", "quarterly_margins", "official_corporate_actions",
        "portfolio", "watchlist", "settings", "titan_live_account", "titan_live_positions", "titan_live_trades",
        "global_sovereign_metadata", "global_stock_metadata",
        "global_sovereign_positions", "global_sovereign_trades", "global_sovereign_account"
    ]
    stat1_counts = {}
    try:
        local_cur.execute("SELECT tbl, MAX(CAST(SUBSTR(stat, 1, INSTR(stat || ' ', ' ') - 1) AS INTEGER)) FROM sqlite_stat1 GROUP BY tbl")
        for tbl_n, cnt_v in local_cur.fetchall():
            if tbl_n and cnt_v:
                stat1_counts[tbl_n] = int(cnt_v)
    except Exception:
        pass

    for t in tables:
        try:
            local_cur.execute(f"PRAGMA table_info({t})")
            cols = [col["name"] for col in local_cur.fetchall()]
            if not cols:
                continue
            order_col = "datetime" if "datetime" in cols else "date" if "date" in cols else "trade_date" if "trade_date" in cols else "revenue_date" if "revenue_date" in cols else None
            order_clause = f"ORDER BY {order_col} DESC" if order_col else ""
            local_cur.execute(f"SELECT * FROM {t} {order_clause} LIMIT 100")
            data_rows = [dict(r) for r in local_cur.fetchall()]

            if t in stat1_counts and stat1_counts[t] > 200000:
                row_count = stat1_counts[t]
            else:
                local_cur.execute(f"SELECT count(*) FROM {t}")
                row_count = local_cur.fetchone()[0] or 0

            sb.execute_commit("""
                INSERT INTO stock_database_preview (table_name, columns, data, row_count, updated_at)
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (table_name) DO UPDATE SET
                    columns = EXCLUDED.columns,
                    data = EXCLUDED.data,
                    row_count = EXCLUDED.row_count,
                    updated_at = CURRENT_TIMESTAMP;
            """, (t, json.dumps(cols), json.dumps(data_rows), row_count), label=f"preview:{t}")
            print(f"  ✓ 資料表 {t}: 快照 {len(data_rows)} 筆 (總量 {row_count:,} 筆)")
        except Exception as e:
            print(f"  ⚠️ 資料表 {t} 快照失敗: {e}")

def sync_titan_portfolios(sb_conn, local_conn):
    """同步雲端使用者的全球泰坦與台股泰坦實盤持倉現價 (直連 SQLite 最新價)"""
    print("[*] 正在同步全球泰坦與台股泰坦雲端持倉最新報價...")
    local_cur = local_conn.cursor()
    sb = _ensure_session(sb_conn)
    try:
        users = sb.fetchall_retry("SELECT username, positions FROM user_titan_portfolios;", label="user_titan_portfolios")
        for u_name, pos_raw in users:
            if not pos_raw:
                continue
            pos_list = json.loads(pos_raw) if isinstance(pos_raw, str) else pos_raw
            changed = False
            for p in pos_list:
                ticker = str(p.get("ticker") or "")
                if ticker:
                    local_cur.execute("SELECT date, close FROM global_stock_daily WHERE ticker = ? AND close IS NOT NULL ORDER BY date DESC LIMIT 1", (ticker,))
                    row = local_cur.fetchone()
                    real_dt = row[0] if row else None
                    real_px = round(float(row[1]), 2) if (row and row[1] is not None) else None
                    if ticker.endswith(".TW"):
                        sid = ticker.split(".")[0]
                        local_cur.execute("SELECT date, closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 1", (sid,))
                        tw_r = local_cur.fetchone()
                        if tw_r and tw_r[1] is not None:
                            d_raw = str(tw_r[0]).strip()
                            d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                            if not real_dt or d_fmt >= real_dt:
                                real_dt = d_fmt
                                real_px = round(float(tw_r[1]), 2)
                    if real_px is not None and real_dt is not None:
                        if p.get("current_price") != real_px or p.get("price_date") != real_dt:
                            p["current_price"] = real_px
                            p["price_date"] = real_dt
                            changed = True
            if changed:
                sb.execute_commit("""
                    UPDATE user_titan_portfolios 
                    SET positions = %s, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = %s;
                """, (json.dumps(pos_list, ensure_ascii=False), u_name), label=f"titan_pos:{u_name}")
                print(f"  ✓ 成功同步 {u_name} 的全球泰坦實盤持倉最新報價")
    except Exception as e:
        print(f"  ⚠️ 同步全球泰坦持倉報價失敗: {e}")

    # 同步台股泰坦雲端持倉最新報價 (user_taiwan_titan_portfolios) 與前端 titan_open_positions.json
    try:
        tw_users = sb.fetchall_retry("SELECT username, positions FROM user_taiwan_titan_portfolios;", label="user_taiwan_titan_portfolios")
        for u_name, pos_raw in tw_users:
            if not pos_raw:
                continue
            pos_list = json.loads(pos_raw) if isinstance(pos_raw, str) else pos_raw
            changed = False
            for p in pos_list:
                sid = str(p.get("stock_id") or p.get("ticker") or "").split(".")[0]
                if sid:
                    local_cur.execute("SELECT date, closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 1", (sid,))
                    row = local_cur.fetchone()
                    if row and row[1] is not None:
                        d_raw = str(row[0]).strip()
                        real_dt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                        real_px = round(float(row[1]), 2)
                        if p.get("current_price") != real_px or p.get("price_date") != real_dt:
                            p["current_price"] = real_px
                            p["price_date"] = real_dt
                            changed = True
            if changed:
                sb.execute_commit("""
                    UPDATE user_taiwan_titan_portfolios 
                    SET positions = %s, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = %s;
                """, (json.dumps(pos_list, ensure_ascii=False), u_name), label=f"tw_titan_pos:{u_name}")
                print(f"  ✓ 成功同步 {u_name} 的台股泰坦實盤持倉最新報價")

        tw_open_path = "/Users/huanggin-chen/openclaw_test/frontend/src/data/titan_open_positions.json"
        if os.path.exists(tw_open_path):
            with open(tw_open_path, "r", encoding="utf-8") as f:
                tw_open_data = json.load(f)
            is_dict = isinstance(tw_open_data, dict)
            max_tw_d = tw_open_data.get("as_of_date", "2026-10-16") if is_dict else "2026-10-16"
            open_pos_list = tw_open_data.get("open_positions", []) if is_dict else (tw_open_data if isinstance(tw_open_data, list) else [])
            for op in open_pos_list:
                sid = str(op.get("stock_id") or "")
                if sid:
                    local_cur.execute("SELECT date, closing_price FROM daily_stock WHERE stock_id = ? AND closing_price IS NOT NULL ORDER BY date DESC LIMIT 60", (sid,))
                    s_rows = local_cur.fetchall()
                    if s_rows and s_rows[0][1] is not None:
                        d_raw = str(s_rows[0][0]).strip()
                        d_fmt = f"{d_raw[:4]}-{d_raw[4:6]}-{d_raw[6:8]}" if (len(d_raw) == 8 and d_raw.isdigit()) else d_raw
                        px_val = round(float(s_rows[0][1]), 2)
                        px_arr = [float(r[1]) for r in s_rows if r[1] is not None]
                        ma60_v = round(float(sum(px_arr[:60]) / len(px_arr[:60])), 2) if len(px_arr) >= 60 else px_val
                        op["current_price"] = px_val
                        op["latest_price"] = px_val
                        op["strategy_current_price"] = px_val
                        op["price_date"] = d_fmt
                        op["ma60_stop_price"] = ma60_v
                        op["stop_loss_ma60"] = ma60_v
                        if d_fmt > max_tw_d:
                            max_tw_d = d_fmt
            if is_dict:
                tw_open_data["as_of_date"] = max_tw_d
            with open(tw_open_path, "w", encoding="utf-8") as f:
                json.dump(tw_open_data, f, ensure_ascii=False, indent=2)
            print("  ✓ 台股泰坦前端 titan_open_positions.json 同步完成")
    except Exception as e:
        print(f"  ⚠️ 同步台股泰坦持倉報價失敗: {e}")

def run_full_sync(reuse_fresh_json: bool = False):
    """執行完整一次性全同步"""
    print("=" * 60)
    print("🦞 蝦報 - 本機台股資料與模型同步作業開始")
    print("=" * 60)
    sb_session = ResilientSupabaseSession()
    local_conn = get_sqlite_conn()

    try:
        sync_ml_cache(sb_session, reuse_fresh_json=reuse_fresh_json)
        sync_portfolio(sb_session, local_conn)
        sync_titan_portfolios(sb_session, local_conn)
        sync_watchlist(sb_session, local_conn)
        sync_settings(sb_session, local_conn)
        sync_database_previews(sb_session, local_conn)
        print("=" * 60)
        print("✨ 所有資料與模型已成功同步至 Supabase 雲端！")
        print("=" * 60)
    finally:
        local_conn.close()
        sb_session.close()

if __name__ == "__main__":
    run_full_sync()
