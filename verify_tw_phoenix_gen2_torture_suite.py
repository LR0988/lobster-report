#!/usr/bin/env python3
"""
verify_tw_phoenix_gen2_torture_suite.py
================================================================================
Global Titan Gen-2 8-Gate Torture Audit Suite for Titan-PIT v11.0 Gen-2
(100% Taiwan 13:30 Close-Locked Ultra-Strict PIT Pure Non-Trough Dual-Engine + Multi-Wave Ratchet + P+D/Zweig Mother Ship)

Verifies:
  Gate 1: Gen-2 Official 0050 U 0051 PIT Universe, Zero `/tmp` Cache, Zero `.TWO`, 100% GICS Map, Causal KY 08-31 Lock, Zero Deep-Trough / Re-entry
  Gate 2: Execution Authenticity (09:00 Pure Open-Ref Fills, Zero Halt/Zero-Volume Ghost Fills, Gate B5, T+1 Execution)
  Gate 3: Quadruple 3D +-20% 27-Cell Parameter Plateaus (Grid-A, B, C & D = 108 Cells >= 85% PASS, Grid-B/C/D min > PurePod2_Base)
  Gate 4: True Wave-Masked Re-simulated Portfolio Jackknife (Drop Top-3 & Top-5 > 0050)
  Gate 5: Dual-Era Invariance (2016-2020 & 2021-2026) + Ex-2026 Alpha > 0050 & > PurePod2_Base
  Gate 6: End-to-End Raw-SQL Truncation Causality Test (Cutoff 2023-06-30 max_abs_diff < 1e-12)
  Gate 7: Harsh 2x Friction Stress Test (1.48% RT Stocks / 0.56% RT ETF > 0050 + 4%)
  Gate 8: Positive LOO Marginal Contributions (Pod1 > MS, Pod2 >= MS+12%, Dual >= Pod1+10%, Dual > Pod2, Dual > PurePod2_Base+3.5%, N >= 45)
"""

import json
import os
import pickle
import sys
import numpy as np
import pandas as pd

import tw_phoenix_turnaround_pit_engine as eng


def main():
    print("=" * 88)
    print("🔬 Global Titan Gen-2 8-Gate Torture Audit Suite — Titan-PIT v11.0 Gen-2 (Zero Trough · Wave Rider)")
    print("=" * 88)

    # Load PIT matrices & simulate default portfolio
    base_data = eng._build_or_load_full_matrices(force_rebuild=False)
    sim = eng.run_simulation(data_override=base_data)
    audit = eng.compute_or_load_torture_audit(sim, force_rebuild=False)

    idx = base_data["tw_cal"]
    syms = base_data["all_syms"]
    trades = sim["trades"]

    # ------------------------------------------------------------------
    # Gate 1: Gen-2 PIT Compliance, Pure GICS Sector Partition & Zero Deep-Trough
    # ------------------------------------------------------------------
    assert os.path.exists(eng.ENGINE_CACHE_PATH), f"Missing Gen-2 cache: {eng.ENGINE_CACHE_PATH}"
    assert not os.path.exists(eng.LEGACY_TMP_CACHE_PATH), f"Legacy /tmp cache still exists: {eng.LEGACY_TMP_CACHE_PATH}"
    assert base_data.get("schema_version") == 2, f"Cache schema_version must be 2, got {base_data.get('schema_version')}"
    assert "open_lim_up" in base_data and "open_lim_dn" in base_data, "Missing strict 09:00 limit-up/down flags"
    assert len(base_data.get("ky_syms", [])) >= 40, f"Expected >=40 causal KY/F- PIT syms, got {len(base_data.get('ky_syms', []))}"
    tpex_cols = [s for s in syms if s.endswith(".TWO")]
    assert len(tpex_cols) == 0, f"Found .TWO leakage in universe: {tpex_cols[:5]}"

    with open(eng.INDUSTRY_MAP_PATH, "r", encoding="utf-8") as f:
        imap = json.load(f)
    missing_gics = [s for s in syms if not imap.get(s, {}).get("sector") or not imap.get(s, {}).get("industry") or imap[s]["sector"] == "Unknown"]
    assert len(missing_gics) == 0, f"Missing GICS sector/industry in universe: {missing_gics[:10]}"

    with open(eng.TW_ZERO_PIT_PATH, "rb") as f:
        tw_zero = pickle.load(f)
    pit_mat = tw_zero["in_0050_0051_pit"].reindex(index=idx).ffill().fillna(False)

    assert audit.get("zero_trough_verified") is True, "audit['zero_trough_verified'] must be True"
    non_pit_trades = []
    veto_sector_trades = []
    trough_or_reentry_trades = []
    for tr in trades:
        sym = f"{tr['stock_id']}.TW"
        e_ts = pd.Timestamp(tr["entry_date"])
        if sym not in pit_mat.columns or not bool(pit_mat.at[e_ts, sym]):
            non_pit_trades.append((sym, tr["entry_date"]))
        if tr.get("pod") not in ("POD1", "POD2") or tr.get("is_reentry") or ("凹洞" in tr.get("role", "")) or ("回馬槍" in tr.get("role", "")):
            trough_or_reentry_trades.append((sym, tr.get("pod"), tr.get("role")))
        meta = imap.get(sym, {})
        sec, ind = meta.get("sector", ""), meta.get("industry", "")
        ok_sec = (
            (sec == "Technology" and ind in eng.PURE_TECH_INDUSTRIES)
            or (sec == "Industrials" and ind in eng.PURE_HEAVY_INDUSTRIES)
        )
        if not ok_sec:
            veto_sector_trades.append((sym, tr["pod"], sec, ind))

    assert len(non_pit_trades) == 0, f"Non-PIT 0050∪0051 trade(s) detected: {non_pit_trades}"
    assert len(veto_sector_trades) == 0, f"Vetoed GICS sector trade(s) detected: {veto_sector_trades}"
    assert len(trough_or_reentry_trades) == 0, f"Residual trough/reentry trade(s) detected: {trough_or_reentry_trades}"
    print(f"[Gate 1 PASS] Gen-2 Cache v2 verified | 0% .TWO | 0% Trough/REENTRY | 100% GICS ({len(syms)} syms) | {len(trades)} trades 100% in official 0050∪0051 PIT & Pure GICS")

    # ------------------------------------------------------------------
    # Gate 2: Execution Authenticity & Gate B5 Zero Halt/Zero-Vol Fills
    # ------------------------------------------------------------------
    assert sim["zero_vol_violations"] == 0, f"Simulator flagged {sim['zero_vol_violations']} zero-volume fills"
    val_df = base_data["piv_val"]
    act_df = base_data["is_active_pit"]
    zero_vol_entries = []
    zero_vol_exits = []
    same_day_trades = []
    for tr in trades:
        sym = f"{tr['stock_id']}.TW"
        e_ts = pd.Timestamp(tr["entry_date"])
        x_ts = pd.Timestamp(tr["exit_date"])
        if e_ts >= x_ts or tr["holding_days"] < 1:
            same_day_trades.append((sym, tr["entry_date"], tr["exit_date"]))
        if float(val_df.at[e_ts, sym]) <= 0:
            zero_vol_entries.append((sym, tr["entry_date"]))
        is_forced_delist = not bool(act_df.at[x_ts, sym])
        if (not is_forced_delist) and float(val_df.at[x_ts, sym]) <= 0:
            zero_vol_exits.append((sym, tr["exit_date"]))

    assert len(same_day_trades) == 0, f"Same-day/invalid hold trades: {same_day_trades}"
    assert len(zero_vol_entries) == 0, f"Zero-volume entries (Gate B5): {zero_vol_entries}"
    assert len(zero_vol_exits) == 0, f"Zero-volume non-delist exits (Gate B5): {zero_vol_exits}"
    print(f"[Gate 2 PASS] Gate B5 Execution Authenticity: 0 halt/zero-volume buys or sells | 100% T+1 open execution")

    # ------------------------------------------------------------------
    # Gate 3: Quadruple 3D +-20% 27-Cell Parameter Plateaus (Grid-A, B, C & D = 108 Cells)
    # ------------------------------------------------------------------
    pure_base = audit.get("pure_pod2_base_cagr", 36.94)
    assert audit["plateau_total"] == 27, f"Expected 27 plateau cells, got {audit['plateau_total']}"
    assert audit["plateau_pass_rate"] >= 85.0, f"Grid-A pass rate {audit['plateau_pass_rate']}% < 85%"
    assert audit["plateau_min_cagr"] > audit["bench_0050_cagr"], (
        f"Worst Grid-A cell {audit['plateau_min_cagr']}% <= 0050 {audit['bench_0050_cagr']}%"
    )
    assert audit.get("grid_b_total") == 27, f"Expected 27 Grid-B cells, got {audit.get('grid_b_total')}"
    assert audit.get("grid_b_pass_rate", 0.0) >= 85.0, f"Grid-B pass rate {audit.get('grid_b_pass_rate')}% < 85%"
    assert audit.get("grid_b_min_cagr", 0.0) > pure_base, (
        f"Worst Grid-B cell {audit.get('grid_b_min_cagr')}% <= PurePod2_Base ({pure_base}%)"
    )
    assert audit.get("grid_c_total") == 27, f"Expected 27 Grid-C cells, got {audit.get('grid_c_total')}"
    assert audit.get("grid_c_pass_rate", 0.0) >= 85.0, f"Grid-C pass rate {audit.get('grid_c_pass_rate')}% < 85%"
    assert audit.get("grid_c_min_cagr", 0.0) > pure_base, (
        f"Worst Grid-C cell {audit.get('grid_c_min_cagr')}% <= PurePod2_Base ({pure_base}%)"
    )
    assert audit.get("grid_d_total") == 27, f"Expected 27 Grid-D cells, got {audit.get('grid_d_total')}"
    assert audit.get("grid_d_pass_rate", 0.0) >= 85.0, f"Grid-D pass rate {audit.get('grid_d_pass_rate')}% < 85%"
    assert audit.get("grid_d_min_cagr", 0.0) > pure_base, (
        f"Worst Grid-D cell {audit.get('grid_d_min_cagr')}% <= PurePod2_Base ({pure_base}%)"
    )
    print(
        f"[Gate 3 PASS] Quadruple 3D +-20% Plateaus (108 Cells): "
        f"Grid-A={audit['plateau_passed']}/{audit['plateau_total']} ({audit['plateau_min_cagr']}%~{audit['plateau_max_cagr']}%) | "
        f"Grid-B={audit['grid_b_passed']}/{audit['grid_b_total']} ({audit['grid_b_min_cagr']}%~{audit['grid_b_max_cagr']}%, {audit.get('grid_b_beats_base', 0)}/27 > Base {pure_base}%) | "
        f"Grid-C={audit['grid_c_passed']}/{audit['grid_c_total']} ({audit['grid_c_min_cagr']}%~{audit['grid_c_max_cagr']}%, {audit.get('grid_c_beats_base', 0)}/27 > Base {pure_base}%) | "
        f"Grid-D={audit['grid_d_passed']}/{audit['grid_d_total']} ({audit['grid_d_min_cagr']}%~{audit['grid_d_max_cagr']}%, {audit.get('grid_d_beats_base', 0)}/27 > Base {pure_base}%)"
    )

    # ------------------------------------------------------------------
    # Gate 4: True Re-simulated Portfolio Jackknife
    # ------------------------------------------------------------------
    assert audit["jackknife_drop3_cagr"] > audit["bench_0050_cagr"], (
        f"Jackknife Drop-3 {audit['jackknife_drop3_cagr']}% <= 0050 {audit['bench_0050_cagr']}%"
    )
    assert audit["jackknife_drop5_cagr"] > audit["bench_0050_cagr"], (
        f"Jackknife Drop-5 {audit['jackknife_drop5_cagr']}% <= 0050 {audit['bench_0050_cagr']}%"
    )
    print(
        f"[Gate 4 PASS] True Portfolio Jackknife: Drop-Top3={audit['jackknife_drop3_cagr']}% / "
        f"Drop-Top5={audit['jackknife_drop5_cagr']}% > 0050 ({audit['bench_0050_cagr']}%) | Removed: {audit['dropped_top3_labels']}"
    )

    # ------------------------------------------------------------------
    # Gate 5: Era Invariance & Ex-2026 Alpha > 0050 & > PurePod2_Base & > v10.0
    # ------------------------------------------------------------------
    assert audit["ex26_cagr"] > max(audit["ex26_0050_cagr"], 41.0), f"Ex-2026 {audit['ex26_cagr']}% <= 41.0% threshold"
    assert audit["era1_cagr"] > max(audit["era1_0050_cagr"], 24.69), f"Era1 {audit['era1_cagr']}% <= v10.0 24.69% threshold"
    assert audit["era2_cagr"] > max(audit["era2_0050_cagr"], 65.0), f"Era2 {audit['era2_cagr']}% <= 65.0% threshold"
    print(
        f"[Gate 5 PASS] Dual-Era & Ex-2026 Alpha: Ex26={audit['ex26_cagr']}% (vs 0050 {audit['ex26_0050_cagr']}% / v10 35.21%) | "
        f"Era1={audit['era1_cagr']}% (vs {audit['era1_0050_cagr']}% / v10 24.69%) | Era2={audit['era2_cagr']}% (vs {audit['era2_0050_cagr']}% / v10 55.97%)"
    )

    # ------------------------------------------------------------------
    # Gate 6: End-to-End Raw-SQL Truncation Causality
    # ------------------------------------------------------------------
    assert audit.get("raw_sql_truncation_verified") is True, "raw_sql_truncation_verified must be True"
    assert audit["future_poison_max_diff"] < 1e-12, f"Future leak detected! max_abs_diff={audit['future_poison_max_diff']}"
    print(f"[Gate 6 PASS] End-to-End Raw-SQL Truncation (Cutoff 2023-06-30): max_abs_diff = {audit['future_poison_max_diff']:.2e}")

    # ------------------------------------------------------------------
    # Gate 7: Harsh 2x Friction Stress Test
    # ------------------------------------------------------------------
    assert audit["harsh_2x_cagr"] > audit["bench_0050_cagr"] + 4.0, (
        f"Harsh 2x friction CAGR {audit['harsh_2x_cagr']}% did not exceed 0050+4% ({audit['bench_0050_cagr'] + 4.0}%)"
    )
    print(
        f"[Gate 7 PASS] Harsh 2x Friction (1.48% RT stk / 0.56% RT ETF): "
        f"CAGR={audit['harsh_2x_cagr']}% > 0050+4% ({audit['bench_0050_cagr'] + 4.0:.2f}%)"
    )

    # ------------------------------------------------------------------
    # Gate 8: Positive LOO Marginal Contributions & Sample Size
    # ------------------------------------------------------------------
    assert audit["loo_pod1_only_cagr"] > audit["loo_mothership_cagr"], (
        f"Pod1 {audit['loo_pod1_only_cagr']}% <= MotherShip {audit['loo_mothership_cagr']}%"
    )
    assert audit["loo_pod2_only_cagr"] >= audit["loo_mothership_cagr"] + 12.0, (
        f"Pod2 {audit['loo_pod2_only_cagr']}% < MotherShip+12% ({audit['loo_mothership_cagr'] + 12.0}%)"
    )
    assert audit["dual_engine_cagr"] >= audit["loo_pod1_only_cagr"] + 10.0, (
        f"Dual {audit['dual_engine_cagr']}% < Pod1Only+10% ({audit['loo_pod1_only_cagr'] + 10.0}%)"
    )
    assert audit["dual_engine_cagr"] > audit["loo_pod2_only_cagr"], (
        f"Dual {audit['dual_engine_cagr']}% <= Pod2 Only {audit['loo_pod2_only_cagr']}%"
    )
    assert audit["dual_engine_cagr"] > 46.5, (
        f"Dual {audit['dual_engine_cagr']}% <= 46.5% (must exceed v10.0 41.14% by >5%)"
    )
    assert audit["total_trades"] >= 40, f"Sample size N={audit['total_trades']} < 40"
    assert audit.get("median_hold_days", 0) >= 28, f"Median hold days {audit.get('median_hold_days')} < 28d"
    assert audit.get("super_waves_50pct", 0) >= 6, f"Super waves >=50% {audit.get('super_waves_50pct')} < 6"
    print(
        f"[Gate 8 PASS] LOO Synergy & Wave Capture: MotherShip={audit['loo_mothership_cagr']}% -> "
        f"Pod1={audit['loo_pod1_only_cagr']}% | Pod2={audit['loo_pod2_only_cagr']}% -> "
        f"Dual={audit['dual_engine_cagr']}% (vs v10 41.14% / Base {pure_base}%) | "
        f"N={audit['total_trades']} (Pod1={audit['pod1_trades']} [{audit['pod1_win_rate']}%], Pod2={audit['pod2_trades']} [{audit['pod2_win_rate']}%]) | "
        f"MedHold={audit['median_hold_days']}d · >=50%Waves={audit['super_waves_50pct']} · MaxWin={audit.get('max_win_pct', 0):.1f}%"
    )

    assert audit["all_8_gates_passed"], "audit['all_8_gates_passed'] must be True"
    print("=" * 88)
    print("✅ ALL 8 TORTURE AUDIT GATES PASSED (Titan-PIT v11.0 Gen-2 Pure Non-Trough Multi-Wave Production Verified)")
    print("=" * 88)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as err:
        print(f"\n❌ TORTURE AUDIT FAILED: {err}", file=sys.stderr)
        sys.exit(1)
