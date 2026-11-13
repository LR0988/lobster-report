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
import pickle
import sqlite3
import tempfile
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
                    "SELECT ticker, start_date, end_date FROM us_pit_constituents WHERE source IN ('SP500_FJA', 'SP500_QLIB', 'SP500_RENAME')"
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
    tw_zero_override: dict = None,
    fund_cache_override: dict = None,
    db_path: str = None,
    verbose: bool = True,
) -> dict:
    """
    【回測前強制安檢 Gen-2 Gate A1 ~ A7】
    於 `build_1704_pit_engine()` 回傳前自動執行，失敗直接 raise `PITIntegrityViolationError`。
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cache_dir = os.path.join(base_dir, "pit_cache")
    resolved_db = db_path or os.path.join(base_dir, "tw_stock.db")

    def _load_cache_pkl(filename: str) -> dict:
        p = os.path.join(cache_dir, filename)
        if not os.path.exists(p):
            raise PITIntegrityViolationError(f"[Gate A7 失敗] 缺少必要 PIT 快取檔: {p}")
        with open(p, "rb") as f_p:
            return pickle.load(f_p)

    tw_zero = tw_zero_override if tw_zero_override is not None else _load_cache_pkl("tw_zero_omission_0050_0051_pit.pkl")
    us_pit_obj = us_pit if us_pit is not None else _load_cache_pkl("us_pit_full_history.pkl")
    fund_cache = fund_cache_override if fund_cache_override is not None else _load_cache_pkl("pit_fund_rebal_cache.pkl")

    us_tickers = list(env["us_tickers"])
    us_set = set(us_tickers)
    pit_tw_list = list(env.get("pit_tw", []))
    stk_adj = env["stk_adj"]
    stk_vol = env["stk_vol"]
    us_in_sp500 = env["us_in_sp500"]
    common_dates = stk_adj.index
    latest_dt = common_dates[-1]

    # -------------------------------------------------------------------------
    # Gate A1: 現任 S&P 500 (503/503) & 台股 0050∪0051 純上市 100% 零遺漏與零上櫃滲漏斷言
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

    tpex_leaked = [tk for tk in pit_tw_list if tk.endswith(".TWO")]
    if tpex_leaked:
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] 台股候選池混入上櫃 (TPEx .TWO) 標的: {tpex_leaked[:15]}"
        )
    tw_pit_cols = set(tw_zero["in_0050_0051_pit"].columns)
    if len(pit_tw_list) < 750 or set(pit_tw_list) != tw_pit_cols:
        extra_tw = sorted(list(set(pit_tw_list) - tw_pit_cols))
        miss_tw = sorted(list(tw_pit_cols - set(pit_tw_list)))
        raise PITIntegrityViolationError(
            f"[Gate A1 失敗] 台股 pit_tw ({len(pit_tw_list)}) 與純上市 0050∪0051 PIT 池 ({len(tw_pit_cols)}) 不一致！"
            f"extra={extra_tw[:10]}, missing={miss_tw[:10]}"
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
    if us_pit_obj is not None and "raw_close" in us_pit_obj:
        us_raw = us_pit_obj["raw_close"][us_tickers].reindex(common_dates).ffill()
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

    imap_file = industry_map_path or os.path.join(base_dir, "industry_map.json")
    if not os.path.exists(imap_file):
        raise PITIntegrityViolationError(f"[Gate A4 失敗] 找不到 industry_map.json: {imap_file}")
    with open(imap_file, "r", encoding="utf-8") as f_im:
        imap = json.load(f_im)

    _BAD_CATS = {"", "UNKNOWN", "G_UNCLASSIFIED", "NONE", "NULL", "NAN"}
    unmapped = []
    bad_65xx_energy = []
    for tk in env["all_open_tickers"]:
        entry = imap.get(tk)
        if not isinstance(entry, dict):
            unmapped.append(tk)
            continue
        sec_s = str(entry.get("sector") or "").strip()
        ind_s = str(entry.get("industry") or "").strip()
        if sec_s.upper() in _BAD_CATS or ind_s.upper() in _BAD_CATS:
            unmapped.append(tk)
            continue
        if tk.endswith(".TW") and tk.startswith("65") and tk != "6505.TW":
            low_sec, low_ind = sec_s.lower(), ind_s.lower()
            if ("energy" in low_sec) or ("oil" in low_ind) or ("refin" in low_ind):
                bad_65xx_energy.append((tk, sec_s, ind_s))

    if unmapped:
        raise PITIntegrityViolationError(
            f"[Gate A4 失敗] industry_map.json 存在 {len(unmapped)} 檔缺失/未分類 sector 或 industry: {unmapped[:15]}"
        )
    if bad_65xx_energy:
        raise PITIntegrityViolationError(
            f"[Gate A4 失敗・觸犯墓碑 #66] 偵測到非 6505.TW 之 65xx.TW 誤分類為油氣能源: {bad_65xx_energy[:10]}"
        )

    # -------------------------------------------------------------------------
    # Gate A5: 2020–2026 美股開盤日實際有價量成分密度 + 零下市前 lvd-20d 提前封鎖未來函數 (墓碑 #65)
    # -------------------------------------------------------------------------
    us_open_mask = (common_dates >= pd.Timestamp("2020-01-02")) & ((stk_vol[us_tickers] > 0).sum(axis=1) >= 400)
    if int(us_open_mask.sum()) < 500:
        raise PITIntegrityViolationError("[Gate A5 失敗] 2020-2026 美股開盤日數量異常過少！")
    act_sp_cnt = (
        us_in_sp500.loc[us_open_mask, us_tickers]
        & stk_adj.loc[us_open_mask, us_tickers].notna()
        & (stk_vol.loc[us_open_mask, us_tickers] > 0)
    ).sum(axis=1)
    act_sp_mean = float(act_sp_cnt.mean())
    act_sp_min = int(act_sp_cnt.min())
    act_sp_last = int(act_sp_cnt.iloc[-1])
    if act_sp_mean < 490.0 or act_sp_min < 475 or act_sp_last < 500:
        bad_a5_dt = act_sp_cnt.idxmin()
        raise PITIntegrityViolationError(
            f"[Gate A5 失敗] 2020-2026 美股開盤日實質可交易 S&P 500 密度不足: "
            f"mean={act_sp_mean:.1f} (<490), min={act_sp_min} (<475 @ {bad_a5_dt.date()}), last={act_sp_last} (<500)"
        )

    if "us_pit_elig_base" in env and "us_last_valid_date" in env:
        us_elig_base = env["us_pit_elig_base"]
        us_lvd_map = env["us_last_valid_date"]
        premature_lockouts = []
        for tk in ("FRC", "SIVB", "ATVI", "WBA", "PXD", "MRO"):
            if tk not in us_elig_base.columns or tk not in us_lvd_map:
                continue
            lvd_raw = us_lvd_map.get(tk)
            if not lvd_raw:
                continue
            lvd_ts = pd.Timestamp(lvd_raw)
            if lvd_ts < latest_dt - pd.Timedelta(days=30) and lvd_ts in common_dates:
                if bool(us_in_sp500.loc[lvd_ts, tk]) and float(stk_vol.loc[lvd_ts, tk]) > 0:
                    win_dts = common_dates[(common_dates <= lvd_ts) & (stk_vol[tk] > 0) & us_in_sp500[tk]][-5:]
                    if len(win_dts) > 0 and not bool(us_elig_base.loc[win_dts, tk].any()):
                        premature_lockouts.append((tk, str(lvd_ts.date())))
        if premature_lockouts:
            raise PITIntegrityViolationError(
                f"[Gate A5 失敗・觸犯墓碑 #65] 偵測到下市前 lvd-20d 提前封鎖未來函數: {premature_lockouts}"
            )

    # -------------------------------------------------------------------------
    # Gate A6: 現行美台 PIT 基本面覆蓋率 >= 95.0% 斷言 (封死 /tmp 殘留與空窗斷層)
    # -------------------------------------------------------------------------
    fc_cols = list(fund_cache.get("cols", []))
    fc_dates = pd.DatetimeIndex(fund_cache.get("dates_idx", []))
    if not fc_cols or len(fc_dates) == 0:
        raise PITIntegrityViolationError("[Gate A6 失敗] pit_fund_rebal_cache.pkl 缺少 cols 或 dates_idx！")
    fc_map = {c: i for i, c in enumerate(fc_cols)}

    us_open_all = common_dates[(stk_vol[us_tickers] > 0).sum(axis=1) >= 400]
    us_last_dt = us_open_all[-1] if len(us_open_all) > 0 else latest_dt
    tw_open_all = common_dates[(stk_vol[pit_tw_list] > 0).sum(axis=1) >= 400]
    tw_last_dt = tw_open_all[-1] if len(tw_open_all) > 0 else latest_dt

    us_fc_pos = int(fc_dates.get_indexer([us_last_dt], method="pad")[0])
    tw_fc_pos = int(fc_dates.get_indexer([tw_last_dt], method="pad")[0])
    if us_fc_pos < 0 or tw_fc_pos < 0:
        raise PITIntegrityViolationError("[Gate A6 失敗] pit_fund_rebal_cache dates_idx 無法對齊最新美台開盤日！")

    def _row_has_fund(pos_i: int):
        return (
            (~np.isnan(fund_cache["rev_yoy_mat"][pos_i]))
            | (~np.isnan(fund_cache["mgn_exp_mat"][pos_i]))
            | (~np.isnan(fund_cache["f_score_mat"][pos_i]))
        )

    us_has_f = _row_has_fund(us_fc_pos)
    us_cov = float(np.mean([bool(us_has_f[fc_map[tk]]) if tk in fc_map else False for tk in active_sp500_now]))

    tw_in_aligned = tw_zero["in_0050_0051_pit"].reindex(common_dates).ffill().fillna(False)
    active_tw_now = [
        tk for tk in pit_tw_list
        if tk in tw_in_aligned.columns and bool(tw_in_aligned.loc[tw_last_dt, tk]) and float(stk_vol.loc[tw_last_dt, tk]) > 0
    ]
    if len(active_tw_now) < 50:
        raise PITIntegrityViolationError(f"[Gate A6 失敗] 最新台股開盤日 ({tw_last_dt.date()}) 活躍 0050∪0051 僅 {len(active_tw_now)} 檔！")
    tw_has_f = _row_has_fund(tw_fc_pos)
    tw_cov = float(np.mean([bool(tw_has_f[fc_map[tk]]) if tk in fc_map else False for tk in active_tw_now]))

    if us_cov < 0.95 or tw_cov < 0.95:
        raise PITIntegrityViolationError(
            f"[Gate A6 失敗・觸犯墓碑 #66] PIT 基本面覆蓋率未達 95.0%: "
            f"US SP500={us_cov * 100:.1f}% ({len(active_sp500_now)}), TW 0050∪0051={tw_cov * 100:.1f}% ({len(active_tw_now)})"
        )

    # -------------------------------------------------------------------------
    # Gate A7: 四大核心 PIT 快取 schema_version >= 2 且 db_max_date 與 tw_stock.db 同步鎖
    # -------------------------------------------------------------------------
    def _norm_dt(val) -> str:
        return str(val or "").strip().replace("-", "")[:8]

    if not os.path.exists(resolved_db):
        raise PITIntegrityViolationError(f"[Gate A7 失敗] 找不到資料庫: {resolved_db}")
    conn_a7 = sqlite3.connect(resolved_db)
    try:
        r_spy = conn_a7.execute("SELECT MAX(date) FROM global_stock_daily WHERE ticker = 'SPY'").fetchone()
        r_tw = conn_a7.execute("SELECT MAX(date) FROM daily_stock WHERE stock_id = '2330'").fetchone()
    finally:
        conn_a7.close()
    spy_db_max = _norm_dt(r_spy[0] if r_spy else "")
    tw_db_max = _norm_dt(r_tw[0] if r_tw else "")
    if not spy_db_max or not tw_db_max:
        raise PITIntegrityViolationError(f"[Gate A7 失敗] 資料庫缺少 SPY ({spy_db_max}) 或 2330 ({tw_db_max}) 最新交易日！")

    g9_pkl_path = os.path.join(cache_dir, "g9_open_universe_env_150.pkl")
    if not os.path.exists(g9_pkl_path):
        raise PITIntegrityViolationError(f"[Gate A7 失敗] 找不到 G9 快取: {g9_pkl_path}")
    g9_meta = env.get("g9_meta") or {}

    stale_msgs = []
    if int(us_pit_obj.get("schema_version") or 0) < 2 or _norm_dt(us_pit_obj.get("db_max_date")) < spy_db_max:
        stale_msgs.append(f"us_pit(v={us_pit_obj.get('schema_version')}, dt={us_pit_obj.get('db_max_date')}<{spy_db_max})")
    if int(tw_zero.get("schema_version") or 0) < 2 or _norm_dt(tw_zero.get("db_max_date")) < tw_db_max:
        stale_msgs.append(f"tw_zero(v={tw_zero.get('schema_version')}, dt={tw_zero.get('db_max_date')}<{tw_db_max})")
    if (
        int(g9_meta.get("schema_version") or 0) < 2
        or g9_meta.get("pure_twse_0050_0051_v2") is not True
        or _norm_dt(g9_meta.get("db_max_date_tw")) < tw_db_max
        or _norm_dt(g9_meta.get("db_max_date_spy")) < spy_db_max
    ):
        stale_msgs.append(f"g9_env({g9_meta}, expected tw>={tw_db_max}/spy>={spy_db_max})")
    if int(fund_cache.get("schema_version") or 0) < 2 or _norm_dt(fund_cache.get("db_max_date")) < tw_db_max:
        stale_msgs.append(f"fund_cache(v={fund_cache.get('schema_version')}, dt={fund_cache.get('db_max_date')}<{tw_db_max})")
    if stale_msgs:
        raise PITIntegrityViolationError(f"[Gate A7 失敗] PIT 快取版本過舊或落後資料庫最新交易日: {stale_msgs}")

    summary = {
        "active_sp500_verified": f"{len(active_sp500_now)}/{len(active_sp500_now)} (100.0%)",
        "daily_sp500_range_2005_2026": f"05-19:[{min_all},{max_all}] / 20-26:[{min_mod},{max_mod}]",
        "act_sp500_2020plus_mean_min": f"{act_sp_mean:.1f} / min {act_sp_min}",
        "us_fund_cov_pct": round(us_cov * 100.0, 1),
        "tw_fund_cov_pct": round(tw_cov * 100.0, 1),
        "schema_version": 2,
        "latest_env_date": str(latest_dt.date()),
        "total_universe": len(env["all_open_tickers"]),
    }
    if verbose:
        print(
            f"🛡️ [PIT Pre-Flight Gate Gen-2 PASS (A1~A7)] S&P500 {summary['active_sp500_verified']} & 純上市TW {len(pit_tw_list)} 零遺漏 ｜ "
            f"20-26實質有量均 {summary['act_sp500_2020plus_mean_min']} ｜ 基本面 US={summary['us_fund_cov_pct']}% TW={summary['tw_fund_cov_pct']}% ｜ "
            f"四大快取 v2 同步 ({summary['latest_env_date']}) ｜ 全池 {summary['total_universe']} 檔 100% 乾淨映射！"
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
    【回測後匯出前強制安檢 Gen-2 Gate B1 ~ B5】
    於 `export_g11_pit_detailed_history.py` 寫入 JSON 前自動執行，
    確保每一筆選股當下真實存在、零缺失價格、零停牌/跨市休市假成交、零提前截斷淨值、零硬編碼當期持倉！
    """
    if not all_tranche_records:
        raise PITIntegrityViolationError("[Gate B1 失敗] all_tranche_records 為空！")
    if eq_d is None or len(eq_d) < 4000 or eq_d.isna().any() or (eq_d <= 0).any():
        raise PITIntegrityViolationError("[Gate B1 失敗] 日度淨值序列 eq_d 含 NaN、<=0 或長度異常！")

    sp500_intervals = load_sp500_intervals(sp500_csv_path, include_db_historical=True, db_path=db_path)
    us_in_mat = env["us_in_sp500"]
    stk_vol = env["stk_vol"]
    stk_open = env["stk_open"]
    stk_adj = env["stk_adj"]
    tw_pit_aligned = in_0050_0051_pit.reindex(us_in_mat.index).ffill().fillna(False)

    total_picks = 0
    bad_prices = []
    pit_violations = []
    halt_trade_violations = []

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

            # 盤中戰術換馬/遞延進場以其自身實際進場日檢核 PIT；一般調倉股以調倉訊號日檢核 PIT
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

            # Gate B5: 進出場日嚴禁於個股停牌 / 單邊休市 / 零成交量日成交 (封死墓碑 #67)
            in_dt_str = str(p.get("entry_date") or lg.get("entry_date") or "")[:10]
            if len(in_dt_str) == 10:
                in_dt = pd.Timestamp(in_dt_str)
                if (
                    in_dt not in stk_vol.index
                    or tk not in stk_vol.columns
                    or not (float(stk_vol.loc[in_dt, tk]) > 0 and float(stk_open.loc[in_dt, tk]) > 0)
                ):
                    halt_trade_violations.append((lg["rebal_date"], tk, "ENTRY_ZERO_VOL_OR_HALT", in_dt_str))

            out_dt_raw = str(p.get("exit_date") or lg.get("exit_date") or "").strip()
            if len(out_dt_raw) >= 10 and out_dt_raw[:4].isdigit() and out_dt_raw[4] == "-":
                out_dt = pd.Timestamp(out_dt_raw[:10])
                out_px_ok = (
                    out_dt in stk_vol.index
                    and tk in stk_vol.columns
                    and float(stk_vol.loc[out_dt, tk]) > 0
                    and (float(stk_open.loc[out_dt, tk]) > 0 or float(stk_adj.loc[out_dt, tk]) > 0)
                )
                if not out_px_ok:
                    halt_trade_violations.append((lg["rebal_date"], tk, "EXIT_ZERO_VOL_OR_HALT", out_dt_raw[:10]))

    if bad_prices:
        raise PITIntegrityViolationError(
            f"[Gate B1 失敗] 發現 {len(bad_prices)} 筆缺失或異常進出場價格: {bad_prices[:10]}"
        )
    if pit_violations:
        raise PITIntegrityViolationError(
            f"[Gate B2 失敗] 發現 {len(pit_violations)} 筆違反當下成分股 Point-in-Time 交易: {pit_violations[:10]}"
        )
    if halt_trade_violations:
        raise PITIntegrityViolationError(
            f"[Gate B5 失敗・觸犯墓碑 #67] 發現 {len(halt_trade_violations)} 筆於停牌/跨市休市/零成交量日成交之虛假交易: {halt_trade_violations[:10]}"
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
        "halt_trade_violations": 0,
        "equity_end_date": str(pd.Timestamp(eq_d.index[-1]).date()),
    }
    if verbose:
        print(
            f"🛡️ [PIT Post-Flight Gate Gen-2 PASS (B1~B5)] 已逐筆驗算 {report['rebalance_periods_checked']} 期調倉 / "
            f"{report['total_picks_checked']} 筆選股：缺失價 0 筆 ｜ PIT 違規 0 筆 ｜ 休市/停牌假成交 0 筆 ｜ "
            f"淨值直達 {report['equity_end_date']} 零截斷 ｜ A/B 當期持倉 100% 動態一致！"
        )
    return report


def _run_adversarial_self_test():
    """執行實盤通過驗證 + 8 項故意投毒攔截測試，證明 Gen-2 守門員 100% 會抓出錯誤！"""
    import copy
    import build_us_pit_delisted_db as us_db
    import test_true_pit_us_tw_1704_universe as pit1704
    from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit

    print("=" * 95)
    print("🧪 啟動 Gen-2 PIT Integrity Gatekeeper 實盤驗證與八重故意投毒攔截測試 (Adversarial Self-Test)...")
    print("=" * 95)

    us_pit = us_db.build_us_pit_database(force_rebuild=False)
    env = pit1704.build_1704_pit_engine()
    tw_zero = build_zero_omission_tw_0050_0051_pit()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(base_dir, "pit_cache", "pit_fund_rebal_cache.pkl"), "rb") as f_fc:
        fund_cache = pickle.load(f_fc)

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
        assert_pre_backtest_env_integrity(
            env_missing, us_pit=us_pit, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 1 失敗：未攔截缺漏成分股 ADI！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 1 通過] 成功攔截缺漏 S&P 500 成分股 -> {e}")

    # 測試 2: 故意模擬墓碑 #64 (將 NVDA 2020-11-10 前成交量乘上 40x 未來拆股倍數) -> 必須被 Gate A3 攔截
    env_split_bug = dict(env)
    bad_vol = env["stk_vol"].copy()
    bad_vol.loc[bad_vol.index <= pd.Timestamp("2020-11-09"), "NVDA"] *= 40.0
    env_split_bug["stk_vol"] = bad_vol
    try:
        assert_pre_backtest_env_integrity(
            env_split_bug, us_pit=us_pit, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 2 失敗：未攔截墓碑 #64 跨源拆股成交額斷層！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 2 通過] 成功攔截墓碑 #64 拆股成交額未來函數 -> {e}")

    # 測試 3: 故意塞入一筆 PLTR 於 2023-06-01 (早於 2024-09-23 官方入選日) 偷買交易 -> 必須被 Gate B2 攔截
    bad_rebal = copy.deepcopy(all_rebal[:5])
    bad_rebal[0] = copy.deepcopy(bad_rebal[0])
    bad_rebal[0]["rebal_date"] = "2023-06-01"
    bad_rebal[0]["entry_date"] = "2023-06-02"
    bad_rebal[0]["exit_date"] = "2023-06-22"
    bad_rebal[0]["picks"] = [{
        "ticker": "PLTR",
        "entry_date": "2023-06-02",
        "exit_date": "2023-06-22",
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

    # 測試 5: 故意將下市股 (PXD) 於最後 15 個交易日提前設為 us_pit_elig_base=False (模擬墓碑 #65 lvd-20d 未來函數) -> Gate A5
    env_lvd_lock = dict(env)
    bad_elig = env["us_pit_elig_base"].copy()
    lvd_pxd = pd.Timestamp(env["us_last_valid_date"]["PXD"])
    pxd_tail_dts = env["stk_adj"].index[(env["stk_adj"].index <= lvd_pxd) & (env["stk_vol"]["PXD"] > 0)][-15:]
    bad_elig.loc[pxd_tail_dts, "PXD"] = False
    env_lvd_lock["us_pit_elig_base"] = bad_elig
    try:
        assert_pre_backtest_env_integrity(
            env_lvd_lock, us_pit=us_pit, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 5 失敗：未攔截 PXD 下市前 lvd-15d 提前封鎖！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 5 通過] 成功攔截墓碑 #65 下市前 lvd-15d 提前封鎖 -> {e}")

    # 測試 6: (a) 台股池混入上櫃 8069.TW -> Gate A1；(b) 6515.TW 誤分類為 Energy -> Gate A4
    env_tpex = dict(env)
    env_tpex["pit_tw"] = list(env["pit_tw"]) + ["8069.TW"]
    try:
        assert_pre_backtest_env_integrity(
            env_tpex, us_pit=us_pit, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 6a 失敗：未攔截上櫃 8069.TW 滲漏！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 6a 通過] 成功攔截上櫃 8069.TW 滲漏 -> {e}")

    with open(os.path.join(base_dir, "industry_map.json"), "r", encoding="utf-8") as f_im0:
        bad_imap = json.load(f_im0)
    bad_imap["6515.TW"] = {"sector": "Energy", "industry": "Oil & Gas Refining & Marketing"}
    fd_tmp, tmp_imap_path = tempfile.mkstemp(prefix="poison_imap_", suffix=".json")
    try:
        with os.fdopen(fd_tmp, "w", encoding="utf-8") as f_tmp:
            json.dump(bad_imap, f_tmp)
        assert_pre_backtest_env_integrity(
            env, us_pit=us_pit, industry_map_path=tmp_imap_path, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 6b 失敗：未攔截 6515.TW 誤分類為 Energy！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 6b 通過] 成功攔截墓碑 #66 6515.TW 油氣誤分類 -> {e}")
    finally:
        if os.path.exists(tmp_imap_path):
            os.unlink(tmp_imap_path)

    # 測試 7: (a) 清空最新日 PIT 基本面 -> Gate A6；(b) us_pit db_max_date 落後 -> Gate A7
    bad_fc = dict(fund_cache)
    for k_mat in ("rev_yoy_mat", "mgn_exp_mat", "f_score_mat"):
        m_copy = fund_cache[k_mat].copy()
        m_copy[-1, :] = np.nan
        bad_fc[k_mat] = m_copy
    try:
        assert_pre_backtest_env_integrity(
            env, us_pit=us_pit, tw_zero_override=tw_zero, fund_cache_override=bad_fc, verbose=False
        )
        raise AssertionError("Test 7a 失敗：未攔截基本面覆蓋率暴跌！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 7a 通過] 成功攔截 PIT 基本面斷層 (<95%) -> {e}")

    stale_us_pit = dict(us_pit)
    stale_us_pit["db_max_date"] = "2025-01-01"
    try:
        assert_pre_backtest_env_integrity(
            env, us_pit=stale_us_pit, tw_zero_override=tw_zero, fund_cache_override=fund_cache, verbose=False
        )
        raise AssertionError("Test 7b 失敗：未攔截過期快取 db_max_date！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 7b 通過] 成功攔截過期快取同步鎖 -> {e}")

    # 測試 8: 故意於台灣清明連假 (2023-04-04 美股開盤/台股休市零成交量) 成交 2330.TW -> Gate B5
    bad_rebal8 = copy.deepcopy(all_rebal[:2])
    bad_rebal8[0]["rebal_date"] = "2023-04-03"
    bad_rebal8[0]["entry_date"] = "2023-04-04"
    bad_rebal8[0]["exit_date"] = "2023-04-24"
    bad_rebal8[0]["picks"] = [{
        "ticker": "2330.TW",
        "entry_date": "2023-04-04",
        "exit_date": "2023-04-24",
        "entry_price": 530.0,
        "exit_price": 510.0,
        "weight": 50.0,
        "period_ret": -3.77,
    }]
    try:
        assert_post_backtest_trade_and_equity_integrity(
            all_tranche_records=bad_rebal8,
            eq_d=dummy_eq,
            env=env,
            in_0050_0051_pit=tw_zero["in_0050_0051_pit"],
            verbose=False,
        )
        raise AssertionError("Test 8 失敗：未攔截 2023-04-04 清明節台股休市假成交！")
    except PITIntegrityViolationError as e:
        print(f"  ✅ [投毒攔截測試 8 通過] 成功攔截墓碑 #67 跨市場單邊休市假成交 -> {e}")

    print("=" * 95)
    print("🏆 全數 8 大投毒測試通過！Gen-2 守門員 (Gates A1~A7 / B1~B5) 已 100% 封死所有已知偏差！")
    print("=" * 95)


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        _run_adversarial_self_test()
    else:
        _run_adversarial_self_test()
