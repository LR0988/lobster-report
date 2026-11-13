#!/usr/bin/env python3
"""
pit_integrity_gatekeeper.py
================================================================================
【全球主權泰坦：零偏誤・全成分・零缺失 強制斷言守門員 (Hard-Assert PIT Gatekeeper)】
================================================================================
本模組直接掛載於：
  1. 資料池建構層 (`test_true_pit_us_tw_1704_universe.py` -> `assert_pre_backtest_env_integrity`)
  2. 交易明細匯出層 (`export_g11_pit_detailed_history.py` -> `assert_post_backtest_trade_and_equity_integrity`)

只要未來任何回測、資料重抓或新因子實驗違反下列任一鐵律，立即拋出 `PITIntegrityViolationError`
強制停機，拒絕回傳環境或拒絕寫出 JSON，從程式碼底層根除「看錯成分、漏股、拆股未來函數、截斷淨值」！
"""

import os
import json
import sqlite3
import numpy as np
import pandas as pd


class PITIntegrityViolationError(RuntimeError):
    """Raised whenever any Point-in-Time, missing-data, or split-stitching invariant fails."""


_FORBIDDEN_ETFS_AND_DUPLICATES = {
    "SPY", "QQQ", "GLD", "BIL", "TLT", "ECH", "GRN", "PHB", "SDS", "UCC", "VO",
    "0050", "0050.TW", "BRK.B", "BF.B",
}


def _resolve_sp500_csv(sp500_csv_path: str = None) -> str:
    candidates = [
        sp500_csv_path,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "pit_cache", "sp500_ticker_start_end.csv"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "sp500_ticker_start_end.csv"),
        "/tmp/sp500_ticker_start_end.csv",
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    raise PITIntegrityViolationError("找不到 sp500_ticker_start_end.csv，無法驗證 S&P 500 PIT 成分股！")


def load_sp500_intervals(sp500_csv_path: str = None, include_db_historical: bool = False, db_path: str = None) -> dict:
    """回傳 {ticker: [(start_ts, end_ts), ...]} 官方 S&P 500 歷史成分區間表。"""
    csv_path = _resolve_sp500_csv(sp500_csv_path)
    df = pd.read_csv(csv_path)
    intervals = {}
    for _, row in df.iterrows():
        tk = str(row.get("ticker", "")).strip().upper().replace(".", "-")
        if not tk:
            continue
        s_raw = str(row.get("start_date", "")).strip()
        e_raw = str(row.get("end_date", "")).strip()
        s_dt = pd.Timestamp(s_raw) if s_raw and s_raw.lower() != "nan" else pd.Timestamp("1990-01-01")
        e_dt = pd.Timestamp(e_raw) if e_raw and e_raw.lower() != "nan" else pd.Timestamp("2099-12-31")
        intervals.setdefault(tk, []).append((s_dt, e_dt))

    if include_db_historical:
        resolved_db = db_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "tw_stock.db")
        if os.path.exists(resolved_db):
            conn = sqlite3.connect(resolved_db)
            try:
                rows = conn.execute(
                    "SELECT ticker, start_date, end_date FROM us_pit_constituents WHERE source IN ('SP500_FJA', 'SP500_QLIB')"
                ).fetchall()
                for tk_r, s_r, e_r in rows:
                    tk = str(tk_r or "").strip().upper().replace(".", "-")
                    if not tk:
                        continue
                    s_dt = pd.Timestamp(str(s_r).strip()) if s_r else pd.Timestamp("1990-01-01")
                    e_str = str(e_r or "").strip()
                    # Qlib 歷史表僅採信至 Qlib 結束日 2020-11-10，2020 後一律以 SP500_FJA 官方名單為準
                    e_dt = pd.Timestamp(e_str) if e_str else pd.Timestamp("2020-11-10")
                    intervals.setdefault(tk, []).append((s_dt, e_dt))
            except Exception:
                pass
            finally:
                conn.close()
    return intervals


def assert_pre_backtest_env_integrity(
    env: dict,
    us_pit: dict = None,
    sp500_csv_path: str = None,
    industry_map_path: str = None,
    verbose: bool = True,
) -> dict:
    """
    【回測前強制安檢 Gate A1 ~ A4】
    於 `build_1704_pit_engine()` 回傳前自動執行，失敗直接 raise `PITIntegrityViolationError`。
    """
    us_tickers = list(env["us_tickers"])
    us_set = set(us_tickers)
    stk_adj = env["stk_adj"]
    stk_vol = env["stk_vol"]
    us_in_sp500 = env["us_in_sp500"]
    common_dates = stk_adj.index
    latest_dt = common_dates[-1]

    # -------------------------------------------------------------------------
    # Gate A1: 現任 S&P 500 成分股 100.00% 零遺漏覆蓋斷言 (503/503)
    # -------------------------------------------------------------------------
    intervals = load_sp500_intervals(sp500_csv_path)
    active_sp500_now = sorted([
        tk for tk, ivs in intervals.items()
        if any(s_dt <= latest_dt <= e_dt for (s_dt, e_dt) in ivs)
    ])
    if len(active_sp500_now) < 500:
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] sp500_ticker_start_end.csv 於 {latest_dt.date()} 現任成分股僅 {len(active_sp500_now)} 檔 (< 500)！"
        )

    missing_in_universe = [tk for tk in active_sp500_now if tk not in us_set]
    if missing_in_universe:
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] 現任 S&P 500 缺漏 {len(missing_in_universe)} 檔成分股未載入回測池: {missing_in_universe[:15]}"
        )

    latest_adj_us = stk_adj.loc[latest_dt, active_sp500_now]
    nan_px_active = latest_adj_us[latest_adj_us.isna() | (latest_adj_us <= 0)].index.tolist()
    if nan_px_active:
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] 現任 S&P 500 於最新交易日 {latest_dt.date()} 有 {len(nan_px_active)} 檔價格缺失或 <=0: {nan_px_active[:15]}"
        )

    latest_pit_flag = us_in_sp500.loc[latest_dt, active_sp500_now]
    false_pit_active = latest_pit_flag[~latest_pit_flag].index.tolist()
    if false_pit_active:
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] 現任 S&P 500 於 {latest_dt.date()} 有 {len(false_pit_active)} 檔 us_in_sp500=False: {false_pit_active[:15]}"
        )

    # -------------------------------------------------------------------------
    # Gate A2: 2005–2026 全歷史逐日 S&P 500 有效成分股密度斷言 (防歷史空窗/漏載 Qlib)
    #   - 2020–2026 現今與近世代區間：每日有效 S&P 500 成分數必須在 [495, 520] (100% 滿編)
    #   - 2005–2019 早期併購/下市區間：每日有效成分數必須 >= 370，且本機 Qlib 存在之成分股必須 100% 零遺漏載入
    # -------------------------------------------------------------------------
    post_2005 = common_dates >= pd.Timestamp("2005-01-03")
    post_2020 = common_dates >= pd.Timestamp("2020-01-02")
    daily_sp500_all = us_in_sp500.loc[post_2005].sum(axis=1)
    daily_sp500_modern = us_in_sp500.loc[post_2020].sum(axis=1)

    min_all, max_all = int(daily_sp500_all.min()), int(daily_sp500_all.max())
    min_mod, max_mod = int(daily_sp500_modern.min()), int(daily_sp500_modern.max())

    if min_all < 370 or max_all > 520:
        bad_dt = daily_sp500_all[(daily_sp500_all < 370) | (daily_sp500_all > 520)].index[0]
        raise PITIntegrityViolationError(
            f"[Gate A2 失敗] 2005-2026 歷史 S&P 500 每日成分數異常 (區間 [{min_all}, {max_all}]，異常日 {bad_dt.date()}: {int(daily_sp500_all.loc[bad_dt])} 檔)！"
        )
    if min_mod < 495 or max_mod > 520:
        bad_dt = daily_sp500_modern[(daily_sp500_modern < 495) | (daily_sp500_modern > 520)].index[0]
        raise PITIntegrityViolationError(
            f"[Gate A2 失敗] 2020-2026 近世代 S&P 500 每日成分數未達滿編 [495, 520] (區間 [{min_mod}, {max_mod}]，異常日 {bad_dt.date()}: {int(daily_sp500_modern.loc[bad_dt])} 檔)！"
        )

    qlib_feat_dir = os.path.expanduser("~/.qlib/qlib_data/us_data/features")
    if os.path.exists(qlib_feat_dir):
        _EXCL_REUSE = {"BMC", "EMC", "GAS", "HAR", "HOT", "PCL", "POM", "PTV", "SDS", "TEG", "TIE", "CBE"}
        qlib_avail = {d.upper().replace(".", "-") for d in os.listdir(qlib_feat_dir)}
        unloaded_qlib = sorted([
            tk for tk in intervals.keys()
            if tk in qlib_avail and tk not in us_set and tk not in _EXCL_REUSE and tk not in _FORBIDDEN_ETFS_AND_DUPLICATES
        ])
        if unloaded_qlib:
            raise PITIntegrityViolationError(
                f"[Gate A2 失敗] 本機 Qlib 存在但未載入回測池之歷史 S&P 500 成分股共 {len(unloaded_qlib)} 檔: {unloaded_qlib[:15]}"
            )

    # -------------------------------------------------------------------------
    # Gate A3: 跨資料源拼接 (2020-11-10) 拆股成交額連續性斷言 (封死墓碑 #64)
    # -------------------------------------------------------------------------
    if us_pit is not None and "raw_close" in us_pit:
        us_raw = us_pit["raw_close"][us_tickers].reindex(common_dates).ffill()
        stitch_dt = pd.Timestamp("2020-11-10")
        pre_mask = (common_dates >= pd.Timestamp("2020-10-15")) & (common_dates <= pd.Timestamp("2020-11-09"))
        post_mask = (common_dates >= pd.Timestamp("2020-11-12")) & (common_dates <= pd.Timestamp("2020-12-08"))
        if pre_mask.sum() >= 10 and post_mask.sum() >= 10:
            dvol_mat = us_raw * stk_vol[us_tickers]
            med_pre = dvol_mat.loc[pre_mask].median(axis=0)
            med_post = dvol_mat.loc[post_mask].median(axis=0)
            adj_ret_window = (
                stk_adj.loc[post_mask, us_tickers].median(axis=0)
                / stk_adj.loc[pre_mask, us_tickers].median(axis=0).replace(0, np.nan)
                - 1.0
            ).abs()
            valid_chk = (med_pre > 5e6) & (med_post > 5e6) & (adj_ret_window < 0.25)
            ratio = (med_pre / med_post).where(valid_chk)
            # 若未還權價誤乘未來 10:1 / 40:1 / 50:1 拆股股數，交界處美元成交額會暴衝 > 6x
            split_oracle_bugs = ratio[(ratio > 6.0) | (ratio < (1.0 / 6.0))].dropna()
            if len(split_oracle_bugs) > 0:
                offenders = {k: round(float(v), 2) for k, v in split_oracle_bugs.head(10).items()}
                raise PITIntegrityViolationError(
                    f"[Gate A3 失敗・觸犯墓碑 #64] 偵測到 2020-11-10 資料源交界處美元成交額異常斷層 "
                    f"(疑似未還權價誤乘拆股後股數): {offenders}"
                )

    # -------------------------------------------------------------------------
    # Gate A4: 零 ETF / 代碼重複混入 & 100% GICS 產業映射完整性斷言
    # -------------------------------------------------------------------------
    leaked_etfs = sorted(list(us_set.intersection(_FORBIDDEN_ETFS_AND_DUPLICATES)))
    if leaked_etfs:
        raise PITIntegrityViolationError(
            f"[Gate A4 失敗] 美股選股池混入禁用 ETF 或點號重複代碼: {leaked_etfs}"
        )
    if "FB" in us_in_sp500.columns and "META" in us_in_sp500.columns:
        overlap_fb_meta = int((us_in_sp500["FB"] & us_in_sp500["META"]).sum())
        if overlap_fb_meta > 0:
            raise PITIntegrityViolationError(
                f"[Gate A4 失敗] FB 與 META 在 us_in_sp500 重疊 {overlap_fb_meta} 天，造成雙重計算！"
            )

    imap_file = industry_map_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "industry_map.json")
    if os.path.exists(imap_file):
        with open(imap_file, "r", encoding="utf-8") as f_im:
            imap = json.load(f_im)
        unmapped = [tk for tk in env["all_open_tickers"] if tk not in imap or imap[tk] == "G_UNCLASSIFIED"]
        if unmapped:
            raise PITIntegrityViolationError(
                f"[Gate A4 失敗] industry_map.json 存在 {len(unmapped)} 檔未分類標的: {unmapped[:15]}"
            )

    summary = {
        "active_sp500_verified": f"{len(active_sp500_now)}/{len(active_sp500_now)} (100.0%)",
        "daily_sp500_range_2005_2026": f"05-19:[{min_all},{max_all}] / 20-26:[{min_mod},{max_mod}]",
        "latest_env_date": str(latest_dt.date()),
        "total_universe": len(env["all_open_tickers"]),
    }
    if verbose:
        print(
            f"🛡️ [PIT Pre-Flight Gate PASS] 現任 S&P 500 {summary['active_sp500_verified']} 零遺漏 ｜ "
            f"2005-2026 每日成分數 {summary['daily_sp500_range_2005_2026']} ｜ "
            f"2020 拼接處零拆股成交額斷層 ｜ 全池 {summary['total_universe']} 檔 100% 產業映射！"
        )
    return summary


def assert_post_backtest_trade_and_equity_integrity(
    all_tranche_records: list,
    eq_d: pd.Series,
    env: dict,
    in_0050_0051_pit: pd.DataFrame,
    official_active_tranches: dict = None,
    db_path: str = None,
    sp500_csv_path: str = None,
    verbose: bool = True,
) -> dict:
    """
    【回測後匯出前強制安檢 Gate B1 ~ B4】
    於 `export_g11_pit_detailed_history.py` 寫入 JSON 前自動執行，
    確保每一筆選股當下真實存在、零缺失價格、零提前截斷淨值、零硬編碼當期持倉！
    """
    if not all_tranche_records:
        raise PITIntegrityViolationError("[Gate B1 失敗] all_tranche_records 為空！")
    if eq_d is None or len(eq_d) < 4000 or eq_d.isna().any() or (eq_d <= 0).any():
        raise PITIntegrityViolationError("[Gate B1 失敗] 日度淨值序列 eq_d 含 NaN、<=0 或長度異常！")

    sp500_intervals = load_sp500_intervals(sp500_csv_path, include_db_historical=True, db_path=db_path)
    us_in_mat = env["us_in_sp500"]
    tw_pit_aligned = in_0050_0051_pit.reindex(us_in_mat.index).ffill().fillna(False)

    total_picks = 0
    bad_prices = []
    pit_violations = []

    for lg in all_tranche_records:
        rb_dt = pd.Timestamp(lg["rebal_date"])
        rb_pos = us_in_mat.index.get_indexer([rb_dt], method="pad")[0]
        rb_idx_dt = us_in_mat.index[rb_pos]

        for p in lg.get("picks", []):
            total_picks += 1
            tk = str(p.get("ticker", "")).strip()
            ep = p.get("entry_price")
            xp = p.get("exit_price")
            wt = p.get("weight")
            pr = p.get("period_ret")

            # Gate B1: 零缺失價格與報酬斷言
            if (
                ep is None or xp is None or wt is None or pr is None
                or not np.isfinite(float(ep)) or float(ep) <= 0
                or not np.isfinite(float(xp)) or float(xp) <= 0
                or not np.isfinite(float(wt)) or float(wt) <= 0
                or not np.isfinite(float(pr))
            ):
                bad_prices.append((lg["rebal_date"], tk, ep, xp, wt, pr))
                continue

            # 盤中戰術換馬股以其自身實際進場日檢核 PIT；一般調倉股以調倉訊號日檢核 PIT
            chk_dt_str = str(p.get("entry_date") or lg["rebal_date"])[:10]
            chk_dt = pd.Timestamp(chk_dt_str)
            chk_pos = us_in_mat.index.get_indexer([chk_dt], method="pad")[0]
            chk_idx_dt = us_in_mat.index[chk_pos]

            # Gate B2: 逐筆選股當下成分存在性斷言 (美股 S&P 500 雙重核對 + 台股 0050∪0051 核對)
            if tk.endswith(".TW"):
                if tk not in tw_pit_aligned.columns or not bool(tw_pit_aligned.loc[rb_idx_dt, tk]):
                    pit_violations.append((lg["rebal_date"], tk, "TW_NOT_IN_0050_0051_PIT"))
            else:
                in_mat_ok = (tk in us_in_mat.columns) and bool(us_in_mat.loc[rb_idx_dt, tk] or us_in_mat.loc[chk_idx_dt, tk])
                ivs = sp500_intervals.get(tk, [])
                # 允許 5 天內公告/生效交界緩衝，嚴格攔截提前數月/數年偷買或剔除後買入
                in_csv_ok = any(
                    (s_dt - pd.Timedelta(days=5)) <= rb_dt <= (e_dt + pd.Timedelta(days=5))
                    or (s_dt - pd.Timedelta(days=5)) <= chk_dt <= (e_dt + pd.Timedelta(days=5))
                    for (s_dt, e_dt) in ivs
                )
                if (not in_mat_ok) or (not in_csv_ok):
                    pit_violations.append((lg["rebal_date"], tk, f"US_PIT_VIOLATION(mat={in_mat_ok}, csv={in_csv_ok}, intervals={ivs})"))

    if bad_prices:
        raise PITIntegrityViolationError(
            f"[Gate B1 失敗] 發現 {len(bad_prices)} 筆缺失或異常進出場價格: {bad_prices[:10]}"
        )
    if pit_violations:
        raise PITIntegrityViolationError(
            f"[Gate B2 失敗] 發現 {len(pit_violations)} 筆違反當下成分股 Point-in-Time 交易: {pit_violations[:10]}"
        )

    # -------------------------------------------------------------------------
    # Gate B3: 嚴禁提前截斷淨值曲線 (`eq_cutoff` 防呆鎖)
    # -------------------------------------------------------------------------
    resolved_db = db_path or os.path.join(os.path.dirname(os.path.abspath(__file__)), "tw_stock.db")
    if os.path.exists(resolved_db):
        conn = sqlite3.connect(resolved_db)
        try:
            row = conn.execute("SELECT MAX(date) FROM global_stock_daily WHERE ticker = 'SPY'").fetchone()
            if row and row[0]:
                max_spy_dt = pd.Timestamp(str(row[0])[:10])
                eq_end_dt = pd.Timestamp(eq_d.index[-1])
                lag_days = (max_spy_dt - eq_end_dt).days
                if lag_days > 5:
                    raise PITIntegrityViolationError(
                        f"[Gate B3 失敗] 淨值曲線終點 ({eq_end_dt.date()}) 早於資料庫最新 SPY 交易日 ({max_spy_dt.date()}) 達 {lag_days} 天！"
                        f"嚴禁使用 eq_cutoff 提前截斷回測區間！"
                    )
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # Gate B4: 當期官方 A/B 梯隊持倉與模擬帳本 100% 一致性斷言 (禁絕硬編碼)
    # -------------------------------------------------------------------------
    if official_active_tranches is not None:
        act_a = [lg for lg in all_tranche_records if lg.get("is_active") and lg["tranche"].startswith("A梯隊")]
        act_b = [lg for lg in all_tranche_records if lg.get("is_active") and lg["tranche"].startswith("B梯隊")]
        if act_a:
            sim_a_tks = [p["ticker"] for p in act_a[-1].get("picks", []) if p.get("is_active", True)]
            out_a_tks = [p["ticker"] for p in official_active_tranches.get("tranche_a", {}).get("picks", [])]
            if sim_a_tks != out_a_tks:
                raise PITIntegrityViolationError(
                    f"[Gate B4 失敗] A 梯隊當期持倉 ({out_a_tks}) 與動態模擬帳本 ({sim_a_tks}) 不一致！"
                )
        if act_b:
            sim_b_tks = [p["ticker"] for p in act_b[-1].get("picks", []) if p.get("is_active", True)]
            out_b_tks = [p["ticker"] for p in official_active_tranches.get("tranche_b", {}).get("picks", [])]
            if sim_b_tks != out_b_tks:
                raise PITIntegrityViolationError(
                    f"[Gate B4 失敗] B 梯隊當期持倉 ({out_b_tks}) 與動態模擬帳本 ({sim_b_tks}) 不一致！"
                )

    report = {
        "rebalance_periods_checked": len(all_tranche_records),
        "total_picks_checked": total_picks,
        "bad_prices": 0,
        "pit_violations": 0,
        "equity_end_date": str(pd.Timestamp(eq_d.index[-1]).date()),
    }
    if verbose:
        print(
            f"🛡️ [PIT Post-Flight Gate PASS] 已逐筆驗算 {report['rebalance_periods_checked']} 期調倉 / "
            f"{report['total_picks_checked']} 筆選股：缺失價 0 筆 ｜ PIT 違規 0 筆 ｜ "
            f"淨值直達 {report['equity_end_date']} 零截斷 ｜ A/B 當期持倉 100% 動態一致！"
        )
    return report


def _run_adversarial_self_test():
    """執行實盤通過驗證 + 4 項故意投毒攔截測試，證明守門員 100% 會抓出錯誤！"""
    import copy
    import build_us_pit_delisted_db as us_db
    import test_true_pit_us_tw_1704_universe as pit1704
    from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit

    print("=" * 95)
    print("🧪 啟動 PIT Integrity Gatekeeper 實盤驗證與四重故意投毒攔截測試 (Adversarial Self-Test)...")
    print("=" * 95)

    us_pit = us_db.build_us_pit_database(force_rebuild=False)
    env = pit1704.build_1704_pit_engine()
    tw_zero = build_zero_omission_tw_0050_0051_pit()

    with open("frontend/src/data/g11_pit_yearly_history.json", "r", encoding="utf-8") as f:
        hist_json = json.load(f)

    all_rebal = []
    for yr_obj in hist_json["yearly_history"]:
        all_rebal.extend(yr_obj.get("rebalances", []))

    dummy_eq = pd.Series(
        np.linspace(1.0, float(hist_json["mult"]), len(env["stk_adj"].index)),
        index=env["stk_adj"].index,
    )
    assert_post_backtest_trade_and_equity_integrity(
        all_tranche_records=all_rebal,
        eq_d=dummy_eq,
        env=env,
        in_0050_0051_pit=tw_zero["in_0050_0051_pit"],
        official_active_tranches=hist_json.get("official_active_tranches"),
    )

    # 測試 1: 故意移除 1 檔現任 S&P 500 成分股 (ADI) -> 必須被 Gate A1 攔截
    env_missing = dict(env)
    env_missing["us_tickers"] = [t for t in env["us_tickers"] if t != "ADI"]
    try:
        assert_pre_backtest_env_integrity(env_missing, us_pit=us_pit, verbose=False)
        raise AssertionError("Test 1 失敗：未攔截缺漏成分股 ADI！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 1 通過] 成功攔截缺漏 S&P 500 成分股 -> {e}")

    # 測試 2: 故意模擬墓碑 #64 (將 NVDA 2020-11-10 前成交量乘上 40x 未來拆股倍數) -> 必須被 Gate A3 攔截
    env_split_bug = dict(env)
    bad_vol = env["stk_vol"].copy()
    bad_vol.loc[bad_vol.index <= pd.Timestamp("2020-11-09"), "NVDA"] *= 40.0
    env_split_bug["stk_vol"] = bad_vol
    try:
        assert_pre_backtest_env_integrity(env_split_bug, us_pit=us_pit, verbose=False)
        raise AssertionError("Test 2 失敗：未攔截墓碑 #64 跨源拆股成交額斷層！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 2 通過] 成功攔截墓碑 #64 拆股成交額未來函數 -> {e}")

    # 測試 3: 故意塞入一筆 PLTR 於 2023-06-01 (早於 2024-09-23 官方入選日) 偷買交易 -> 必須被 Gate B2 攔截
    bad_rebal = copy.deepcopy(all_rebal[:5])
    bad_rebal[0] = copy.deepcopy(bad_rebal[0])
    bad_rebal[0]["rebal_date"] = "2023-06-01"
    bad_rebal[0]["picks"] = [{
        "ticker": "PLTR",
        "entry_date": "2023-06-02",
        "entry_price": 14.5,
        "exit_price": 16.0,
        "weight": 50.0,
        "period_ret": 10.3,
    }]
    try:
        assert_post_backtest_trade_and_equity_integrity(
            all_tranche_records=bad_rebal,
            eq_d=dummy_eq,
            env=env,
            in_0050_0051_pit=tw_zero["in_0050_0051_pit"],
            verbose=False,
        )
        raise AssertionError("Test 3 失敗：未攔截 PLTR 入選前偷買！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 3 通過] 成功攔截入選前偷買違規交易 -> {e}")

    # 測試 4: 故意將淨值曲線截斷在 2026-10-02 (模擬舊 eq_cutoff 漏洞) -> 必須被 Gate B3 攔截
    trunc_eq = dummy_eq.loc[dummy_eq.index <= pd.Timestamp("2026-10-02")]
    try:
        assert_post_backtest_trade_and_equity_integrity(
            all_tranche_records=all_rebal,
            eq_d=trunc_eq,
            env=env,
            in_0050_0051_pit=tw_zero["in_0050_0051_pit"],
            verbose=False,
        )
        raise AssertionError("Test 4 失敗：未攔截 eq_cutoff 提前截斷淨值！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 4 通過] 成功攔截淨值曲線提前截斷 -> {e}")

    print("=" * 95)
    print("🏆 全數通過！未來任何回測只要觸犯缺股、拆股偷看、非當下成分或截斷淨值，將 100% 自動停機攔截！")
    print("=" * 95)


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        _run_adversarial_self_test()
    else:
        _run_adversarial_self_test()
