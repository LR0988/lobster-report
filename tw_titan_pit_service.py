"""
tw_titan_pit_service.py
台股因果泰坦 — 大凹洞轉型波段母子艦隊 (0050 全球寬幅保護母艦 + S50/A25 轉機突擊艦) 即時與回測同步服務。
直接串接 tw_phoenix_turnaround_pit_engine.py (8 重極端嚴格 Point-in-Time 驗證引擎)，
動態產出 taiwan_causal_titan_data.json 與同步 defaultMarketMlData.json。
"""
import json
import os
import sqlite3
import tw_phoenix_turnaround_pit_engine as phoenix_engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "taiwan_causal_titan_data.json")
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")


def db_latest_date() -> str:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    try:
        return conn.execute("SELECT MAX(date) FROM daily_stock WHERE LENGTH(stock_id)=4").fetchone()[0] or ""
    finally:
        conn.close()


def snapshot_date() -> str:
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            return str(json.load(f).get("strategy_info", {}).get("latest_data_date", "")).replace("-", "")
    except Exception:
        return ""


def refresh_live(force_rebuild: bool = False) -> dict:
    return phoenix_engine.export_to_frontend(force_rebuild=force_rebuild)


def run() -> str:
    d = refresh_live(force_rebuild=False)
    sig = d["live_signal"]
    return (
        f"written 台股因果泰坦(大凹洞母子艦隊 PIT) 訊號 {d['strategy_info']['latest_data_date']} "
        f"曝險 {sig['exposure_pct']:.0f}% 持股 {len(d['current_positions'])} 檔 ({sig['shield']})"
    )


if __name__ == "__main__":
    print(run())
