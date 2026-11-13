#!/usr/bin/env python3
"""
pit_fundamental_service.py
================================================================================
Automated Point-In-Time (PIT) Financial Statement Growth & Quality Service
for G12-PIT Sovereign (Twin Momentum: Price Momentum × Fundamental Momentum).

1. Historical Backtest Mode:
   - Loads pre-verified SEC EDGAR XBRL (`filed <= t_date`) + TW `tw_stock.db`
     (`monthly_revenue` announced on 10th of next month + `quarterly_margins`
     with statutory TWSE deadlines Q1:05-15, Q2:08-14, Q3:11-14, Q4:03-31).
2. Live Proactive Execution Mode (`get_live_top_candidates_fundamentals`):
   - Automatically fetches & refreshes the latest published SEC EDGAR 10-Q/10-K
     filings + Yahoo Finance Earnings Surprise (`get_earnings_dates`) + Taiwan
     monthly revenue / quarterly margins for the current Top-10 momentum leaders.
   - Evaluates:
     * `is_fund_defect`: EPS Surprise < -1%, or Rev_YoY < -15%, or
       (Operating Margin YoY Expansion < -10% and Rev_YoY < 20%)
     * `is_fund_star`: IO_20 >= 0%, EPS Surprise >= 0%, and
       ((Rev_YoY >= 14% and Operating Margin YoY Expansion >= 0%) or Rev_YoY >= 20%)
     * `f_score`: Composite Twin-Momentum Fundamental Growth Score for Kelly sizing.
================================================================================
"""
import os
import time
import hashlib
import pickle
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import numpy as np
import pandas as pd
import yfinance as yf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PIT_CACHE_DIR = os.path.join(BASE_DIR, "pit_cache")
SEC_PKL_PATH = os.path.join(PIT_CACHE_DIR, "sec_edgar_pit_fundamentals.pkl")
REBAL_FUND_PKL_PATH = os.path.join(PIT_CACHE_DIR, "pit_fund_rebal_cache.pkl")
TW_DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")

SEC_HEADERS = {"User-Agent": "LobsterSovereignResearch quant@lobster-report.com"}


def _roc_to_ann_str(ym) -> str:
    ym_s = str(ym).strip()
    if len(ym_s) < 5 or not ym_s.isdigit():
        return "2099-01-10"
    y, m = int(ym_s[:3]) + 1911, int(ym_s[3:5])
    return f"{y + 1:04d}-01-10" if m == 12 else f"{y:04d}-{m + 1:02d}-10"


def _tw_yq_to_filing_date(year: int, season: int) -> pd.Timestamp:
    if season == 1:
        return pd.Timestamp(f"{year:04d}-05-15")
    elif season == 2:
        return pd.Timestamp(f"{year:04d}-08-14")
    elif season == 3:
        return pd.Timestamp(f"{year:04d}-11-14")
    else:
        return pd.Timestamp(f"{year + 1:04d}-03-31")


def extract_sec_quarterly_series(us_gaap: dict, tag_candidates: list) -> pd.DataFrame:
    rows = []
    for tag in tag_candidates:
        if tag not in us_gaap:
            continue
        units = us_gaap[tag].get("units", {})
        for u_key, items in units.items():
            if u_key not in ("USD", "USD/shares", "pure"):
                continue
            for x in items:
                if "start" not in x or "end" not in x or "filed" not in x or "val" not in x:
                    continue
                try:
                    s_dt = pd.Timestamp(x["start"])
                    e_dt = pd.Timestamp(x["end"])
                    f_dt = pd.Timestamp(x["filed"])
                    days = (e_dt - s_dt).days
                    if (70 <= days <= 110) or (345 <= days <= 380):
                        rows.append({
                            "start": s_dt,
                            "end": e_dt,
                            "filed": f_dt,
                            "val": float(x["val"]),
                            "days": days,
                            "q_type": "Q" if days <= 110 else "FY",
                        })
                except Exception:
                    continue
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    return df.sort_values(["end", "filed"]).drop_duplicates(subset=["end", "q_type", "filed"], keep="last")


def compute_us_pit_metrics_at_date(fund_entry: dict, t_date: pd.Timestamp) -> dict:
    res = {
        "rev_yoy": np.nan,
        "rev_accel": np.nan,
        "rev_qoq": np.nan,
        "eps_yoy": np.nan,
        "eps_accel": np.nan,
        "op_margin": np.nan,
        "margin_expand": np.nan,
        "eps_surprise": np.nan,
        "has_data": False,
    }
    if not fund_entry:
        return res

    def _calc_yoy_and_accel(df: pd.DataFrame, is_eps=False):
        if df is None or df.empty:
            return np.nan, np.nan, np.nan
        sub = df[df["filed"] <= t_date]
        if sub.empty:
            return np.nan, np.nan, np.nan
        q_sub = sub[sub["q_type"] == "Q"].sort_values(["end", "filed"]).drop_duplicates(subset=["end"], keep="last")
        if len(q_sub) >= 2:
            latest = q_sub.iloc[-1]
            if (t_date - latest["end"]).days <= 190:
                end_0 = latest["end"]
                val_0 = float(latest["val"])
                diffs_0 = (end_0 - q_sub["end"]).dt.days
                yoy_candidates = q_sub[(diffs_0 >= 335) & (diffs_0 <= 395)]
                yoy_0 = np.nan
                if not yoy_candidates.empty:
                    val_m4 = float(yoy_candidates.iloc[-1]["val"])
                    denom = max(abs(val_m4), 0.10) if is_eps else max(abs(val_m4), 1e6)
                    if is_eps or val_m4 > 0:
                        yoy_0 = (val_0 - val_m4) / denom
                qoq_candidates = q_sub[(diffs_0 >= 65) & (diffs_0 <= 120)]
                qoq_0 = np.nan
                accel = np.nan
                if not qoq_candidates.empty:
                    prev_q = qoq_candidates.iloc[-1]
                    val_m1 = float(prev_q["val"])
                    end_m1 = prev_q["end"]
                    denom_q = max(abs(val_m1), 0.10) if is_eps else max(abs(val_m1), 1e6)
                    if is_eps or val_m1 > 0:
                        qoq_0 = (val_0 - val_m1) / denom_q
                    diffs_1 = (end_m1 - q_sub["end"]).dt.days
                    yoy_m1_cands = q_sub[(diffs_1 >= 335) & (diffs_1 <= 395)]
                    if not yoy_m1_cands.empty and not np.isnan(yoy_0):
                        val_m5 = float(yoy_m1_cands.iloc[-1]["val"])
                        denom_5 = max(abs(val_m5), 0.10) if is_eps else max(abs(val_m5), 1e6)
                        if is_eps or val_m5 > 0:
                            yoy_m1 = (val_m1 - val_m5) / denom_5
                            accel = yoy_0 - yoy_m1
                return yoy_0, accel, qoq_0

        fy_sub = sub[sub["q_type"] == "FY"].sort_values(["end", "filed"]).drop_duplicates(subset=["end"], keep="last")
        if len(fy_sub) >= 2:
            latest_fy = fy_sub.iloc[-1]
            if (t_date - latest_fy["end"]).days <= 190:
                end_0 = latest_fy["end"]
                val_0 = float(latest_fy["val"])
                diffs_0 = (end_0 - fy_sub["end"]).dt.days
                yoy_cands = fy_sub[(diffs_0 >= 335) & (diffs_0 <= 395)]
                if not yoy_cands.empty:
                    val_m4 = float(yoy_cands.iloc[-1]["val"])
                    denom = max(abs(val_m4), 0.20) if is_eps else max(abs(val_m4), 1e6)
                    if is_eps or val_m4 > 0:
                        return (val_0 - val_m4) / denom, np.nan, np.nan
        return np.nan, np.nan, np.nan

    rev_yoy, rev_accel, rev_qoq = _calc_yoy_and_accel(fund_entry.get("rev"), is_eps=False)
    eps_yoy, eps_accel, _ = _calc_yoy_and_accel(fund_entry.get("eps"), is_eps=True)
    op_yoy, op_accel, _ = _calc_yoy_and_accel(fund_entry.get("opinc"), is_eps=False)

    if np.isnan(eps_yoy) and not np.isnan(op_yoy):
        eps_yoy = op_yoy
    if np.isnan(eps_accel) and not np.isnan(op_accel):
        eps_accel = op_accel

    rev_df = fund_entry.get("rev")
    op_df = fund_entry.get("opinc")
    if rev_df is not None and not rev_df.empty and op_df is not None and not op_df.empty:
        r_sub = rev_df[(rev_df["filed"] <= t_date) & (rev_df["q_type"] == "Q")].sort_values(["end", "filed"]).drop_duplicates("end", keep="last")
        o_sub = op_df[(op_df["filed"] <= t_date) & (op_df["q_type"] == "Q")].sort_values(["end", "filed"]).drop_duplicates("end", keep="last")
        merged = pd.merge(r_sub[["end", "val"]], o_sub[["end", "val"]], on="end", suffixes=("_rev", "_op")).sort_values("end")
        if not merged.empty and (t_date - merged.iloc[-1]["end"]).days <= 190:
            r0 = float(merged.iloc[-1]["val_rev"])
            o0 = float(merged.iloc[-1]["val_op"])
            if r0 > 0:
                om0 = o0 / r0
                res["op_margin"] = om0
                diffs = (merged.iloc[-1]["end"] - merged["end"]).dt.days
                m4 = merged[(diffs >= 335) & (diffs <= 395)]
                if not m4.empty and float(m4.iloc[-1]["val_rev"]) > 0:
                    om_m4 = float(m4.iloc[-1]["val_op"]) / float(m4.iloc[-1]["val_rev"])
                    res["margin_expand"] = om0 - om_m4

    surp_df = fund_entry.get("surprise")
    if surp_df is not None and not surp_df.empty:
        s_sub = surp_df[surp_df["ann_dt"] <= t_date]
        if not s_sub.empty:
            last_s = s_sub.iloc[-1]
            if (t_date - last_s["ann_dt"]).days <= 115 and not pd.isna(last_s["Surprise(%)"]):
                res["eps_surprise"] = float(last_s["Surprise(%)"]) / 100.0

    res["rev_yoy"] = rev_yoy
    res["rev_accel"] = rev_accel
    res["rev_qoq"] = rev_qoq
    res["eps_yoy"] = eps_yoy
    res["eps_accel"] = eps_accel
    res["has_data"] = not (np.isnan(rev_yoy) and np.isnan(eps_yoy) and np.isnan(res["eps_surprise"]))
    return res


def _cols_hash(cols: list) -> str:
    return hashlib.md5(",".join(str(c) for c in cols).encode("utf-8")).hexdigest()[:12]


def _get_tw_db_max_date() -> str:
    if not os.path.exists(TW_DB_PATH):
        return ""
    try:
        conn = sqlite3.connect(TW_DB_PATH)
        r = conn.execute("SELECT MAX(date) FROM global_stock_daily WHERE ticker = 'SPY'").fetchone()
        conn.close()
        return str(r[0]) if r and r[0] else ""
    except Exception:
        return ""


def load_or_build_pit_fund_matrices(dates_idx: pd.DatetimeIndex, cols: list) -> dict:
    """
    Loads precomputed PIT Fundamental matrices `(N_DATES, N_COLS)` from
    `pit_cache/pit_fund_rebal_cache.pkl` (never `/tmp/`), validating
    `schema_version >= 2`, `cols_hash`, and `db_max_date`, and safely
    aligning `(dates_idx, cols)` with bounded `ffill(limit=65)`.
    """
    n_d, n_c = len(dates_idx), len(cols)
    mat_keys = ("rev_yoy_mat", "rev_acc_mat", "eps_yoy_mat", "mgn_exp_mat", "surp_mat", "f_score_mat")
    if os.path.exists(REBAL_FUND_PKL_PATH):
        try:
            with open(REBAL_FUND_PKL_PATH, "rb") as f:
                d = pickle.load(f)
            if int(d.get("schema_version", 1)) >= 2 and d.get("cols_hash") == _cols_hash(cols):
                if d["rev_yoy_mat"].shape == (n_d, n_c) and list(d.get("cols", [])) == list(cols):
                    if pd.DatetimeIndex(d["dates_idx"]).equals(dates_idx):
                        return d
            c_dates = d.get("dates_idx", d.get("dates"))
            c_cols = d.get("cols")
            if c_dates is not None and c_cols is not None:
                out_d = {}
                for k in mat_keys:
                    if k in d:
                        df_k = pd.DataFrame(d[k], index=pd.DatetimeIndex(c_dates), columns=list(c_cols))
                        out_d[k] = df_k.reindex(index=dates_idx, method="ffill", limit=105).reindex(columns=cols).values.astype(np.float32)
                if len(out_d) == len(mat_keys):
                    return out_d
        except Exception:
            pass
    # Fallback empty matrices if cache not built yet
    return {k: np.full((n_d, n_c), np.nan, dtype=np.float32) for k in mat_keys}


def rebuild_full_pit_fund_caches(dates_idx: pd.DatetimeIndex, cols: list, force_sec: bool = False) -> dict:
    """
    Rebuilds full-pool SEC EDGAR XBRL cache (`pit_cache/sec_edgar_pit_fundamentals.pkl`)
    for all active & historical US tickers and computes exact Point-In-Time fundamental
    matrices across all `dates_idx` × `cols` (US SEC EDGAR + TW `tw_stock.db` in-memory
    batch queries), applying bounded `ffill(limit=65)` and saving `schema_version=2`
    to `pit_cache/pit_fund_rebal_cache.pkl`.
    """
    from build_us_pit_delisted_db import SP500_VERIFIED_RENAME_PAIRS
    os.makedirs(PIT_CACHE_DIR, exist_ok=True)
    dates_idx = pd.DatetimeIndex(dates_idx)
    n_d, n_c = len(dates_idx), len(cols)
    us_cols = [c for c in cols if not str(c).endswith(".TW")]
    tw_cols = [c for c in cols if str(c).endswith(".TW")]

    # 1. Load existing SEC EDGAR dictionary
    us_dict = {}
    if os.path.exists(SEC_PKL_PATH):
        try:
            with open(SEC_PKL_PATH, "rb") as f:
                us_dict = pickle.load(f)
        except Exception:
            us_dict = {}

    # 2. Fetch official SEC CIK mappings (tickers + exchange)
    sec_map = {}
    for url in (
        "https://www.sec.gov/files/company_tickers.json",
        "https://www.sec.gov/files/company_tickers_exchange.json",
    ):
        try:
            r = requests.get(url, headers=SEC_HEADERS, timeout=15)
            if r.status_code == 200:
                js = r.json()
                if isinstance(js, dict) and "data" in js and "fields" in js:
                    t_idx = js["fields"].index("ticker")
                    c_idx = js["fields"].index("cik")
                    for row in js["data"]:
                        tk = str(row[t_idx]).upper().strip()
                        cik_s = str(row[c_idx]).zfill(10)
                        sec_map[tk] = cik_s
                        sec_map[tk.replace("-", ".")] = cik_s
                        sec_map[tk.replace(".", "-")] = cik_s
                elif isinstance(js, dict):
                    for v in js.values():
                        tk = str(v["ticker"]).upper().strip()
                        cik_s = str(v["cik_str"]).zfill(10)
                        sec_map[tk] = cik_s
                        sec_map[tk.replace("-", ".")] = cik_s
                        sec_map[tk.replace(".", "-")] = cik_s
        except Exception:
            pass

    rename_fwd = {o: n for o, n in SP500_VERIFIED_RENAME_PAIRS}
    today_str = pd.Timestamp.now().strftime("%Y-%m-%d")
    # Determine US tickers needing SEC EDGAR XBRL fetch
    todo_us = []
    for sym in us_cols:
        cik = sec_map.get(sym) or sec_map.get(sym.replace(".", "-")) or sec_map.get(rename_fwd.get(sym, ""))
        if not cik:
            continue
        ent = us_dict.get(sym)
        if force_sec or ent is None:
            todo_us.append((sym, cik))
            continue
        if ent.get("last_checked") == today_str:
            continue
        rev_df = ent.get("rev", pd.DataFrame())
        if rev_df is None or rev_df.empty:
            todo_us.append((sym, cik))
        else:
            max_f = pd.to_datetime(rev_df["filed"]).max()
            if pd.isna(max_f) or max_f < pd.Timestamp("2026-06-01"):
                todo_us.append((sym, cik))

    print(f"📡 [SEC EDGAR Full Backfill] CIK matched={sum(1 for s in us_cols if s in sec_map or s.replace('.','-') in sec_map)}/{len(us_cols)} | Cached={len(us_dict)} | Fetch/Refresh={len(todo_us)}")
    if todo_us:
        rate_lock = threading.Lock()
        last_req = [0.0]

        def _fetch_sec_one(sym_cik):
            sym_k, cik_k = sym_cik
            with rate_lock:
                wait_s = 0.14 - (time.time() - last_req[0])
                if wait_s > 0:
                    time.sleep(wait_s)
                last_req[0] = time.time()
            try:
                url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik_k}.json"
                resp = requests.get(url, headers=SEC_HEADERS, timeout=15)
                if resp.status_code != 200:
                    return sym_k, None, resp.status_code
                ug = resp.json().get("facts", {}).get("us-gaap", {})
                if not ug:
                    return sym_k, None, 204
                rev_tags = [k for k in ug.keys() if "Revenue" in k or "Sales" in k]
                out = {
                    "rev": extract_sec_quarterly_series(ug, [
                        "RevenueFromContractWithCustomerExcludingAssessedTax",
                        "RevenueFromContractWithCustomerIncludingAssessedTax",
                        "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
                        "InterestAndDividendIncomeOperating", "InterestIncomeOperating",
                        "PremiumsEarnedNet", "TotalRevenuesAndOtherIncome",
                    ] + rev_tags[:4]),
                    "opinc": extract_sec_quarterly_series(ug, [
                        "OperatingIncomeLoss",
                        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                    ]),
                    "gp": extract_sec_quarterly_series(ug, ["GrossProfit"]),
                    "netinc": extract_sec_quarterly_series(ug, ["NetIncomeLoss", "ProfitLoss"]),
                    "eps": extract_sec_quarterly_series(ug, ["EarningsPerShareDiluted", "EarningsPerShareBasic"]),
                    "surprise": us_dict.get(sym_k, {}).get("surprise", pd.DataFrame()),
                    "last_checked": pd.Timestamp.now().strftime("%Y-%m-%d"),
                }
                return sym_k, out, 200
            except Exception:
                return sym_k, None, -1

        ok_cnt = 0
        fail_429 = 0
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = [ex.submit(_fetch_sec_one, pair) for pair in todo_us]
            for idx_f, fut in enumerate(as_completed(futs), start=1):
                sym_r, ent_r, code_r = fut.result()
                if ent_r is not None and not ent_r["rev"].empty:
                    us_dict[sym_r] = ent_r
                    ok_cnt += 1
                elif code_r in (403, 429):
                    fail_429 += 1
                if idx_f % 80 == 0:
                    with open(SEC_PKL_PATH, "wb") as f:
                        pickle.dump(us_dict, f)
                    print(f"  - SEC EDGAR progress {idx_f}/{len(todo_us)} (updated={ok_cnt}, rate_err={fail_429})")

        # Propagate renamed successor filings to predecessor ticker keys if missing
        for old_t, new_t in SP500_VERIFIED_RENAME_PAIRS:
            if old_t in us_cols and new_t in us_dict and old_t not in us_dict:
                us_dict[old_t] = us_dict[new_t]

        with open(SEC_PKL_PATH, "wb") as f:
            pickle.dump(us_dict, f)
        print(f"  ✅ SEC EDGAR backfill done: updated={ok_cnt}, total cached US={len(us_dict)}, err403/429={fail_429}")

    # 3. Build exact PIT fundamental matrices across all dates_idx × cols
    rev_yoy_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)
    rev_acc_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)
    eps_yoy_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)
    mgn_exp_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)
    surp_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)
    f_score_mat = np.full((n_d, n_c), np.nan, dtype=np.float32)

    col_to_idx = {c: i for i, c in enumerate(cols)}
    dt_min, dt_max = dates_idx[0], dates_idx[-1]

    # Precompute US matrices via unique filing/expiry milestones (100% day-exact, ~3s total)
    for sym in us_cols:
        ent = us_dict.get(sym)
        if not ent:
            continue
        ci = col_to_idx[sym]
        ms_dates = {dt_max}
        for key, dcol in (("rev", "filed"), ("opinc", "filed"), ("eps", "filed"), ("surprise", "ann_dt")):
            df_k = ent.get(key)
            if df_k is not None and not df_k.empty and dcol in df_k.columns:
                dts = pd.to_datetime(df_k[dcol], errors="coerce").dropna()
                for x in dts:
                    if dt_min <= x <= dt_max:
                        ms_dates.add(x)
                if "end" in df_k.columns:
                    ends = pd.to_datetime(df_k["end"], errors="coerce").dropna()
                    for e in ends:
                        exp_d = e + pd.Timedelta(days=191)
                        if dt_min <= exp_d <= dt_max:
                            ms_dates.add(exp_d)
        sorted_ms = sorted(ms_dates)
        if not sorted_ms:
            continue
        # Evaluate at each milestone and fill forward to next milestone (bounded by <= 65 trading days safety)
        for m_i, m_dt in enumerate(sorted_ms):
            res = compute_us_pit_metrics_at_date(ent, m_dt)
            if not res["has_data"] and np.isnan(res["margin_expand"]):
                continue
            p_start = int(dates_idx.searchsorted(m_dt, side="left"))
            if m_i + 1 < len(sorted_ms):
                p_end = int(dates_idx.searchsorted(sorted_ms[m_i + 1], side="left"))
            else:
                p_end = n_d
            p_end = min(p_end, p_start + 106, n_d)
            if p_start >= p_end:
                continue
            ry, ra, ey, me, su = res["rev_yoy"], res["rev_accel"], res["eps_yoy"], res["margin_expand"], res["eps_surprise"]
            rev_yoy_mat[p_start:p_end, ci] = ry
            rev_acc_mat[p_start:p_end, ci] = ra
            eps_yoy_mat[p_start:p_end, ci] = ey
            mgn_exp_mat[p_start:p_end, ci] = me
            surp_mat[p_start:p_end, ci] = su
            ry_c = np.clip(ry, -0.50, 1.50) if not np.isnan(ry) else 0.0
            ra_c = np.clip(ra, -0.50, 0.80) if not np.isnan(ra) else 0.0
            ey_c = np.clip(ey, -0.80, 2.00) if not np.isnan(ey) else 0.0
            me_c = np.clip(me, -0.15, 0.20) if not np.isnan(me) else 0.0
            su_c = np.clip(su, -0.25, 0.50) if not np.isnan(su) else 0.0
            f_score_mat[p_start:p_end, ci] = float(0.35 * ry_c + 0.25 * ra_c + 0.20 * ey_c + 0.50 * me_c + 0.25 * su_c)

    # Batch-load TW monthly_revenue and quarterly_margins in memory once
    if tw_cols and os.path.exists(TW_DB_PATH):
        conn = sqlite3.connect(TW_DB_PATH)
        df_m_all = pd.read_sql_query("SELECT stock_id, revenue_date, yoy FROM monthly_revenue WHERE yoy IS NOT NULL", conn)
        df_q_all = pd.read_sql_query("SELECT stock_id, year, season, rev_q, om_q FROM quarterly_margins ORDER BY stock_id, year, season", conn)
        conn.close()

        df_m_all["ann_dt"] = pd.to_datetime(df_m_all["revenue_date"].map(_roc_to_ann_str), errors="coerce")
        df_m_all = df_m_all.dropna(subset=["ann_dt"]).sort_values(["stock_id", "ann_dt"])
        m_groups = {k: g for k, g in df_m_all.groupby("stock_id")}

        df_q_all["filed"] = [_tw_yq_to_filing_date(int(y), int(s)) for y, s in zip(df_q_all["year"], df_q_all["season"])]
        df_q_all = df_q_all.sort_values(["stock_id", "filed"])
        q_groups = {k: g for k, g in df_q_all.groupby("stock_id")}

        for sym in tw_cols:
            sid = sym.split(".")[0]
            ci = col_to_idx[sym]
            gm = m_groups.get(sid)
            gq = q_groups.get(sid)

            # Monthly YoY & 3M YoY acceleration series (ann_dt -> dates_idx, bounded ffill 65)
            if gm is not None and not gm.empty:
                gm_d = gm.drop_duplicates(subset=["ann_dt"], keep="last").set_index("ann_dt").sort_index()
                yoy_s = (gm_d["yoy"].astype(float) / 100.0)
                acc_s = yoy_s - yoy_s.shift(3)
                # Shift onto dates_idx cleanly with limit=65
                pos_m = dates_idx.searchsorted(yoy_s.index, side="left")
                for idx_m, p0 in enumerate(pos_m):
                    if p0 >= n_d:
                        continue
                    p1 = pos_m[idx_m + 1] if (idx_m + 1 < len(pos_m)) else n_d
                    p1 = min(p1, p0 + 106, n_d)
                    if p0 < p1:
                        rev_yoy_mat[p0:p1, ci] = float(yoy_s.iloc[idx_m])
                        if not pd.isna(acc_s.iloc[idx_m]):
                            rev_acc_mat[p0:p1, ci] = float(acc_s.iloc[idx_m])

            if gq is not None and len(gq) >= 5:
                gq = gq.reset_index(drop=True)
                rq = gq["rev_q"].astype(float).values
                om = gq["om_q"].astype(float).values
                f_dts = pd.DatetimeIndex(gq["filed"].values)
                pos_q = dates_idx.searchsorted(f_dts, side="left")
                for iq in range(4, len(gq)):
                    p0 = pos_q[iq]
                    if p0 >= n_d:
                        continue
                    p1 = pos_q[iq + 1] if (iq + 1 < len(pos_q)) else n_d
                    p1 = min(p1, p0 + 106, n_d)
                    if p0 >= p1:
                        continue
                    r0, r4 = rq[iq], rq[iq - 4]
                    om0, om4 = om[iq], om[iq - 4]
                    if np.isnan(rev_yoy_mat[p0, ci]) and r4 > 0 and not np.isnan(r0):
                        rev_yoy_mat[p0:p1, ci] = (r0 - r4) / r4
                    if not (np.isnan(om0) or np.isnan(om4)):
                        mgn_exp_mat[p0:p1, ci] = (om0 - om4) / 100.0
                    if not (np.isnan(r0) or np.isnan(r4) or np.isnan(om0) or np.isnan(om4)):
                        op0, op4 = r0 * om0, r4 * om4
                        if abs(op4) > 10:
                            eps_yoy_mat[p0:p1, ci] = (op0 - op4) / abs(op4)

            # Compute composite f_score across populated TW positions
            valid_tw = (~np.isnan(rev_yoy_mat[:, ci])) | (~np.isnan(mgn_exp_mat[:, ci])) | (~np.isnan(eps_yoy_mat[:, ci]))
            if np.any(valid_tw):
                ry_v = np.where(np.isnan(rev_yoy_mat[:, ci]), 0.0, np.clip(rev_yoy_mat[:, ci], -0.50, 1.50))
                ra_v = np.where(np.isnan(rev_acc_mat[:, ci]), 0.0, np.clip(rev_acc_mat[:, ci], -0.50, 0.80))
                ey_v = np.where(np.isnan(eps_yoy_mat[:, ci]), 0.0, np.clip(eps_yoy_mat[:, ci], -0.80, 2.00))
                me_v = np.where(np.isnan(mgn_exp_mat[:, ci]), 0.0, np.clip(mgn_exp_mat[:, ci], -0.15, 0.20))
                f_score_mat[valid_tw, ci] = (0.35 * ry_v + 0.25 * ra_v + 0.20 * ey_v + 0.50 * me_v)[valid_tw]

    res_bundle = {
        "schema_version": 2,
        "cols_hash": _cols_hash(cols),
        "db_max_date": _get_tw_db_max_date(),
        "dates_idx": dates_idx,
        "cols": list(cols),
        "rev_yoy_mat": rev_yoy_mat,
        "rev_acc_mat": rev_acc_mat,
        "eps_yoy_mat": eps_yoy_mat,
        "mgn_exp_mat": mgn_exp_mat,
        "surp_mat": surp_mat,
        "f_score_mat": f_score_mat,
    }
    with open(REBAL_FUND_PKL_PATH, "wb") as f:
        pickle.dump(res_bundle, f)
    print(f"💾 已重建 PIT 財報矩陣快取 (schema_version=2): {REBAL_FUND_PKL_PATH} | shape=({n_d}, {n_c})")
    return res_bundle


def auto_refresh_live_candidates_sec_edgar(tickers: list, force: bool = False) -> dict:
    """
    Proactively fetches / updates the latest SEC EDGAR 10-Q/10-K XBRL filings +
    Yahoo Finance Earnings Surprise for any live US Top-10 candidates that are
    either missing from `pit_cache/sec_edgar_pit_fundamentals.pkl` or whose cache
    has not been refreshed today.
    """
    us_tickers = [t for t in tickers if not str(t).endswith(".TW")]
    if not us_tickers:
        return {}

    us_dict = {}
    if os.path.exists(SEC_PKL_PATH):
        try:
            with open(SEC_PKL_PATH, "rb") as f:
                us_dict = pickle.load(f)
        except Exception:
            us_dict = {}

    today_str = pd.Timestamp.now().strftime("%Y-%m-%d")
    todo = [
        s for s in us_tickers
        if force or (s not in us_dict) or (us_dict[s].get("last_checked") != today_str and us_dict[s].get("rev", pd.DataFrame()).empty)
    ]
    if not todo:
        return us_dict

    try:
        r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=SEC_HEADERS, timeout=10)
        sec_map = {}
        if r.status_code == 200:
            for v in r.json().values():
                t_sym = v["ticker"].upper()
                sec_map[t_sym] = str(v["cik_str"]).zfill(10)
                sec_map[t_sym.replace("-", ".")] = str(v["cik_str"]).zfill(10)
    except Exception:
        sec_map = {}

    updated = False
    for sym in todo:
        cik = sec_map.get(sym)
        out = us_dict.get(sym, {"rev": pd.DataFrame(), "opinc": pd.DataFrame(), "gp": pd.DataFrame(), "netinc": pd.DataFrame(), "eps": pd.DataFrame(), "surprise": pd.DataFrame()})
        if cik:
            try:
                url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
                r2 = requests.get(url, headers=SEC_HEADERS, timeout=10)
                if r2.status_code == 200:
                    ug = r2.json().get("facts", {}).get("us-gaap", {})
                    rev_tags = [k for k in ug.keys() if "Revenue" in k or "Sales" in k]
                    out["rev"] = extract_sec_quarterly_series(ug, [
                        "RevenueFromContractWithCustomerExcludingAssessedTax",
                        "RevenueFromContractWithCustomerIncludingAssessedTax",
                        "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet",
                    ] + rev_tags[:4])
                    out["opinc"] = extract_sec_quarterly_series(ug, [
                        "OperatingIncomeLoss",
                        "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                    ])
                    out["gp"] = extract_sec_quarterly_series(ug, ["GrossProfit"])
                    out["netinc"] = extract_sec_quarterly_series(ug, ["NetIncomeLoss", "ProfitLoss"])
                    out["eps"] = extract_sec_quarterly_series(ug, ["EarningsPerShareDiluted", "EarningsPerShareBasic"])
                    updated = True
            except Exception:
                pass
        try:
            tk = yf.Ticker(sym)
            ed = tk.get_earnings_dates(limit=20)
            if ed is not None and not ed.empty:
                ed_clean = ed.dropna(subset=["Reported EPS"]).copy()
                ed_clean["ann_dt"] = pd.to_datetime(ed_clean.index).tz_localize(None)
                out["surprise"] = ed_clean[["ann_dt", "EPS Estimate", "Reported EPS", "Surprise(%)"]].sort_values("ann_dt")
                updated = True
        except Exception:
            pass
        out["last_checked"] = today_str
        us_dict[sym] = out

    if updated:
        try:
            os.makedirs(PIT_CACHE_DIR, exist_ok=True)
            with open(SEC_PKL_PATH, "wb") as f:
                pickle.dump(us_dict, f)
        except Exception:
            pass
    return us_dict


def evaluate_live_ticker_pit_fundamentals(sym: str, io20_val: float = 0.0, as_of_date: pd.Timestamp = None) -> dict:
    """
    Proactively evaluates a single stock's latest published Point-In-Time financial
    statements for live trading / dashboard display.
    Uses `pit_cache/sec_edgar_pit_fundamentals.pkl` + `tw_stock.db` + live `yfinance` fallback.
    """
    if as_of_date is None:
        as_of_date = pd.Timestamp.now().normalize()

    metrics = {
        "rev_yoy": np.nan,
        "rev_accel": np.nan,
        "eps_yoy": np.nan,
        "margin_expand": np.nan,
        "eps_surprise": np.nan,
        "f_score": 0.0,
        "is_star": False,
        "is_defect": False,
        "fund_tag": "✅ 財報穩健",
    }

    if sym.endswith(".TW"):
        sid = sym.replace(".TW", "")
        if os.path.exists(TW_DB_PATH):
            try:
                conn = sqlite3.connect(TW_DB_PATH)
                df_m = pd.read_sql_query(
                    "SELECT revenue_date, yoy, mom FROM monthly_revenue WHERE stock_id = ?",
                    conn, params=(sid,)
                )
                df_q = pd.read_sql_query(
                    "SELECT year, season, rev_q, om_q FROM quarterly_margins WHERE stock_id = ? ORDER BY year, season",
                    conn, params=(sid,)
                )
                conn.close()
                if not df_m.empty:
                    df_m["ann_dt"] = pd.to_datetime(df_m["revenue_date"].map(_roc_to_ann_str), errors="coerce")
                    df_m = df_m.dropna(subset=["ann_dt"]).sort_values("ann_dt")
                    m_sub = df_m[df_m["ann_dt"] <= as_of_date]
                    if len(m_sub) >= 4:
                        y0 = float(m_sub.iloc[-1]["yoy"]) / 100.0 if not pd.isna(m_sub.iloc[-1]["yoy"]) else np.nan
                        y3 = float(m_sub.iloc[-4]["yoy"]) / 100.0 if not pd.isna(m_sub.iloc[-4]["yoy"]) else np.nan
                        metrics["rev_yoy"] = y0
                        if not np.isnan(y0) and not np.isnan(y3):
                            metrics["rev_accel"] = y0 - y3
                if len(df_q) >= 5:
                    df_q["filed"] = [_tw_yq_to_filing_date(int(y), int(s)) for y, s in zip(df_q["year"], df_q["season"])]
                    q_sub = df_q[df_q["filed"] <= as_of_date]
                    if len(q_sub) >= 5:
                        r0, r4 = float(q_sub.iloc[-1]["rev_q"]), float(q_sub.iloc[-5]["rev_q"])
                        om0, om4 = float(q_sub.iloc[-1]["om_q"]), float(q_sub.iloc[-5]["om_q"])
                        if np.isnan(metrics["rev_yoy"]) and r4 > 0:
                            metrics["rev_yoy"] = (r0 - r4) / r4
                        metrics["margin_expand"] = (om0 - om4) / 100.0
                        op0, op4 = r0 * om0, r4 * om4
                        if abs(op4) > 10:
                            metrics["eps_yoy"] = (op0 - op4) / abs(op4)
            except Exception:
                pass
    else:
        if os.path.exists(SEC_PKL_PATH):
            try:
                with open(SEC_PKL_PATH, "rb") as f:
                    us_dict = pickle.load(f)
                if sym in us_dict:
                    m = compute_us_pit_metrics_at_date(us_dict[sym], as_of_date)
                    metrics.update({
                        "rev_yoy": m["rev_yoy"],
                        "rev_accel": m["rev_accel"],
                        "eps_yoy": m["eps_yoy"],
                        "margin_expand": m["margin_expand"],
                        "eps_surprise": m["eps_surprise"],
                    })
            except Exception:
                pass

    ry = metrics["rev_yoy"]
    ra = metrics["rev_accel"]
    ey = metrics["eps_yoy"]
    me = metrics["margin_expand"]
    su = metrics["eps_surprise"]

    ry_c = np.clip(ry, -0.50, 1.50) if not np.isnan(ry) else 0.0
    ra_c = np.clip(ra, -0.50, 0.80) if not np.isnan(ra) else 0.0
    ey_c = np.clip(ey, -0.80, 2.00) if not np.isnan(ey) else 0.0
    me_c = np.clip(me, -0.15, 0.20) if not np.isnan(me) else 0.0
    su_c = np.clip(su, -0.25, 0.50) if not np.isnan(su) else 0.0
    f_score = float(0.35 * ry_c + 0.25 * ra_c + 0.20 * ey_c + 0.50 * me_c + 0.25 * su_c)
    metrics["f_score"] = round(f_score, 4)

    # Check Defect vs Star
    is_def = False
    if not np.isnan(su) and su < -0.01:
        is_def = True
    elif not np.isnan(ry) and ry < -0.15:
        is_def = True
    elif (not np.isnan(me) and me < -0.10) and (np.isnan(ry) or ry < 0.20):
        is_def = True

    is_star = False
    if io20_val >= 0.0 and (np.isnan(su) or su >= 0.0):
        if not np.isnan(ry) and not np.isnan(me) and ry >= 0.14 and me >= 0.0:
            is_star = True
        elif not np.isnan(ry) and ry >= 0.20:
            is_star = True

    metrics["is_defect"] = is_def
    metrics["is_star"] = is_star
    if is_star:
        metrics["fund_tag"] = "🏆 財報高成長明星"
    elif is_def:
        metrics["fund_tag"] = "⚠️ 當期財報瑕疵"
    else:
        metrics["fund_tag"] = "✅ 當期財報穩健"
    return metrics
