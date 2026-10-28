#!/usr/bin/env python3
"""
run_daily_automation.py
👑 【泰坦旗艦版 (TITAN Sovereign) 全自動化每日排程執行與檢測引擎】
========================================================================================
功能清單：
  1. 🌐 宏觀指標與大盤同步 (Sync Macro & Index: US10Y, SOX, Oil, DXY, TAIEX)
  2. 🌍 全球主權 ETF 與本國股票池日線增量更新 (Sync Global Sovereign & Domestic)
  3. 🛡️ 模組 C 2.0 (DCF 股債折現雙因子過熱閥門) 與全球泰坦 2.0 儀表板重新計算
  4. 🎯 超跌狙擊手 (Oversold Sniper) 與可轉債 (CB/CBAS) 落難天使好球帶雷達更新
  5. 💾 前端 JSON 數據快照即時產出 (defaultGlobalSovereignData.json, etc.)
  6. 📊 雙梯隊調倉窗口檢測 (每月 1 號 A 梯隊 / 每月 22 號 B 梯隊)
  7. 🚀 Git 自動化同步與 Vercel 部署驗證
========================================================================================
使用範例：
  python3 run_daily_automation.py                # 完整執行全自動排程並輸出檢核報表
  python3 run_daily_automation.py --check-only   # 僅執行系統九大核心指標健康檢查
"""

import os
import sys
import json
import sqlite3
import subprocess
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DATA_DIR = os.path.join(BASE_DIR, "frontend/src/data")
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")

def log(msg: str):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{now_str}] {msg}", flush=True)

def run_step(step_name: str, func):
    log(f"▶ 開始執行：{step_name}...")
    try:
        res = func()
        log(f"✅ 完成：{step_name}！")
        return True, res
    except Exception as e:
        log(f"❌ 失敗：{step_name}，原因: {e}")
        return False, str(e)

def sync_macro():
    import sync_macro_indicators
    import sync_options_pc_ratio
    sync_macro_indicators.sync_macro_to_sqlite(range_param="1mo")
    try:
        sync_options_pc_ratio.sync_options_pc_ratio_to_sqlite()
    except Exception as e:
        log(f"選擇權 PC Ratio 同步跳過: {e}")

def sync_sovereign_data():
    import sync_global_sovereign
    import sync_true_domestic_stocks
    sync_global_sovereign.sync_global_sovereign_history(full_history=False)
    sync_true_domestic_stocks.sync_true_domestic_stocks(full_history=False)

def update_global_titan():
    import global_sovereign_service
    data = global_sovereign_service.get_global_sovereign_dashboard_data()
    out_file = os.path.join(FRONTEND_DATA_DIR, "defaultGlobalSovereignData.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return {
        "regime": data.get("macro_status", {}).get("regime"),
        "exposure_pct": data.get("macro_status", {}).get("exposure_pct"),
        "qqq_bias500": data.get("macro_status", {}).get("qqq_bias500"),
        "us10y": data.get("macro_status", {}).get("us10y"),
        "macro_gate_active": data.get("macro_status", {}).get("macro_bias_gate_active"),
        "top_picks": [p.get("ticker") for p in data.get("current_picks", [])[:3]]
    }

def update_oversold_sniper():
    import oversold_sniper_service
    data = oversold_sniper_service.get_oversold_sniper_dashboard_data()
    out_file = os.path.join(FRONTEND_DATA_DIR, "defaultOversoldSniperData.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return len(data.get("candidates", []))

def update_cb_radar():
    import generate_real_tpex_radar
    generate_real_tpex_radar.generate_real_radar()

def git_sync():
    # 檢查是否有 JSON 變動，若有則自動 commit 並 push
    status = subprocess.check_output(["git", "status", "--porcelain", "frontend/src/data/"], cwd=BASE_DIR).decode("utf-8")
    if status.strip():
        subprocess.check_call(["git", "add", "frontend/src/data/"], cwd=BASE_DIR)
        msg = f"chore(data): auto-sync daily snapshot [{datetime.now().strftime('%Y-%m-%d %H:%M')}]"
        subprocess.check_call(["git", "commit", "-m", msg], cwd=BASE_DIR)
        subprocess.check_call(["git", "push", "origin", "main"], cwd=BASE_DIR)
        # 同步至 master 供 Vercel 觸發構建
        subprocess.check_call(["git", "checkout", "master"], cwd=BASE_DIR)
        subprocess.check_call(["git", "merge", "main"], cwd=BASE_DIR)
        subprocess.check_call(["git", "push", "origin", "master"], cwd=BASE_DIR)
        subprocess.check_call(["git", "checkout", "main"], cwd=BASE_DIR)
        return "Git 已自動 commit 並推送至 main 與 master (觸發 Vercel 生產部署)"
    return "無前端 JSON 異動，跳過 Git 推送"

def check_system_health():
    """執行全系統健康度與九大指標逐一檢測"""
    report = {}
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 1. 資料庫最新日期
    c.execute("SELECT MAX(date) FROM macro_indicators")
    report["macro_indicators_latest"] = c.fetchone()[0]
    c.execute("SELECT MAX(date) FROM global_sovereign_daily WHERE ticker='QQQ'")
    report["qqq_latest"] = c.fetchone()[0]
    c.execute("SELECT MAX(date) FROM global_stock_daily WHERE ticker='3037.TW'")
    report["tw_stock_latest"] = c.fetchone()[0]

    # 2. 宏觀指標最新值
    c.execute("SELECT us10y, oil_wti, dxy, sox FROM macro_indicators ORDER BY date DESC LIMIT 1")
    row = c.fetchone()
    report["us10y"] = row[0]
    report["oil_wti"] = row[1]
    report["dxy"] = row[2]
    report["sox"] = row[3]

    # 3. 模組 C 2.0 狀態
    c.execute("SELECT close FROM global_sovereign_daily WHERE ticker='QQQ' AND close IS NOT NULL ORDER BY date DESC LIMIT 500")
    qqq_closes = [float(r[0]) for r in c.fetchall()]
    qqq_bias500 = 0.0
    if len(qqq_closes) >= 500:
        ma500 = sum(qqq_closes[:500]) / 500.0
        qqq_bias500 = round((qqq_closes[0] / ma500 - 1.0) * 100.0, 2)
    report["qqq_bias500"] = qqq_bias500
    report["module_c_active"] = (qqq_bias500 >= 30.0) and (row[0] >= 3.5)
    report["recommended_exposure"] = "50% (半倉防禦)" if report["module_c_active"] else "100% (滿倉)"

    # 4. 實盤帳戶持股與淨值
    c.execute("SELECT ticker, shares, current_price, currency FROM global_sovereign_positions")
    positions = c.fetchall()
    c.execute("SELECT value FROM global_sovereign_account WHERE key='current_cash_twd'")
    cash_row = c.fetchone()
    cash = float(cash_row[0]) if cash_row else 70221.0
    c.execute("SELECT value FROM global_sovereign_account WHERE key='usd_fx'")
    fx_row = c.fetchone()
    usd_fx = float(fx_row[0]) if fx_row else 32.5

    stock_val = 0.0
    pos_summary = []
    for ticker, shares, price, curr in positions:
        fx = usd_fx if curr == 'USD' else 1.0
        val = shares * price * fx
        stock_val += val
        pos_summary.append(f"{ticker}: {shares}股 @ {price} ({val:,.0f} TWD)")
    total_nav = stock_val + cash
    report["total_nav_twd"] = round(total_nav, 0)
    report["cash_twd"] = round(cash, 0)
    report["stock_value_twd"] = round(stock_val, 0)
    report["positions"] = pos_summary

    # 5. 調倉倒數
    today = datetime.now()
    if today.day < 22:
        days_left = 22 - today.day
        next_rebal = f"{today.year}-{today.month:02d}-22 (B梯隊)"
    else:
        next_mo = 1 if today.month == 12 else today.month + 1
        next_yr = today.year + 1 if today.month == 12 else today.year
        next_rebal = f"{next_yr}-{next_mo:02d}-01 (A梯隊)"
        next_date = datetime(next_yr, next_mo, 1)
        days_left = (next_date - today).days + 1
    report["next_rebalance"] = next_rebal
    report["days_until_rebalance"] = days_left

    # 6. 前端 JSON 狀態
    gs_json = os.path.join(FRONTEND_DATA_DIR, "defaultGlobalSovereignData.json")
    report["frontend_json_exists"] = os.path.exists(gs_json)
    if os.path.exists(gs_json):
        report["frontend_json_mtime"] = datetime.fromtimestamp(os.path.getmtime(gs_json)).strftime("%Y-%m-%d %H:%M:%S")

    conn.close()
    return report

def main():
    check_only = "--check-only" in sys.argv
    log("================================================================================")
    log("👑 啟動【全球泰坦 2.0】自動化排程引擎 (TITAN Automation Engine)")
    log("================================================================================")

    if not check_only:
        # 步驟 1: 同步大盤與宏觀
        run_step("1. 同步大盤指數與宏觀指標 (US10Y, SOX, Oil, DXY)", sync_macro)
        # 步驟 2: 同步全球主權與股票池
        run_step("2. 同步全球主權 ETF 與本國股票池日線", sync_sovereign_data)
        # 步驟 3: 重新運算全球泰坦 2.0 (含模組 C 2.0 DCF 雙因子閘門)
        ok3, res3 = run_step("3. 運算全球泰坦 2.0 儀表板數據快照", update_global_titan)
        # 步驟 4: 運算超跌狙擊手
        run_step("4. 運算超跌狙擊手 (Oversold Sniper) 候選池", update_oversold_sniper)
        # 步驟 5: 運算可轉債 (CB/CBAS) 落難天使好球帶
        run_step("5. 運算可轉債 (CB/CBAS) 落難天使好球帶雷達", update_cb_radar)
        # 步驟 6: Git 同步與 Vercel 觸發
        run_step("6. Git 同步與 Vercel 觸發部署", git_sync)

    # 步驟 7: 系統核心九大指標逐一檢測
    log("================================================================================")
    log("🔍 執行【系統全維度健康檢查與九大指標檢驗】(System Inspection)")
    log("================================================================================")
    health = check_system_health()

    print("\n" + "="*80)
    print("📊 【泰坦系統自動化線上檢驗報告 (System Inspection Report)】")
    print("="*80)
    print(f"1. 📅 資料庫最新日期：宏觀 {health['macro_indicators_latest']} ｜ 美股 {health['qqq_latest']} ｜ 台股 {health['tw_stock_latest']}")
    print(f"2. 📈 10年期美債殖利率 (US10Y)：{health['us10y']}%（折現率基準閥值: 3.5%）")
    print(f"3. ⚡ 那斯達克 (QQQ) 2年線乖離率：{health['qqq_bias500']}%（過熱門檻: 30.0%）")
    print(f"4. 🛡️ 模組 C 2.0 (DCF 雙因子過熱閥門)：{'觸發防禦 (50% 半倉)' if health['module_c_active'] else '未過熱，健康進攻 (100% 滿倉)'}")
    print(f"5. 💰 建議總持股曝險：{health['recommended_exposure']}")
    print(f"6. 💵 實盤總資產淨值：NT$ {health['total_nav_twd']:,.0f}（股票 NT$ {health['stock_value_twd']:,.0f} ＋ 現金 NT$ {health['cash_twd']:,.0f}）")
    print(f"7. 📦 目前實盤持倉明細：{', '.join(health['positions'])}")
    print(f"8. ⏳ 下次雙梯隊調倉窗口：{health['next_rebalance']}（倒數 {health['days_until_rebalance']} 天）")
    print(f"9. 🌐 前端 JSON 靜態快照：已同步生成 ({health['frontend_json_mtime']})")
    print("="*80 + "\n")

if __name__ == "__main__":
    main()
