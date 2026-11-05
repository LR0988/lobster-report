#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_all_filters_conditional_expectancy.py

以「條件期望值 (Conditional Expectancy) 與觸發當下真實攔截效果」對系統全部 14 道濾網進行法醫級健檢：
不看被 22 年 5,500 天稀釋後的平均，而是單獨拉出每一道濾網「真正觸發攔截 / 降權 / 加分 / 減倉」的那少數幾筆交易，
檢驗：
1. 22 年共觸發幾次？
2. 被攔截/降權的標的，接下來 15 個交易日真的跌了嗎？平均報酬多少？
3. 遞補/提拔上來的標的，接下來 15 個交易日平均報酬多少？
4. 單次觸發平均挽救超額報酬 (Conditional Alpha per Trigger) 是正還是負？
"""

import sqlite3
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env
import forensic_open_pool_sniper as fops


def _roc_to_ann_str(ym) -> str:
    ym_s = str(ym).strip()
    if len(ym_s) < 5 or not ym_s.isdigit():
        return "2099-01-10"
    y, m = int(ym_s[:3]) + 1911, int(ym_s[3:5])
    return f"{y + 1:04d}-01-10" if m == 12 else f"{y:04d}-{m + 1:02d}-10"


def main():
    print("=" * 135)
    print("🔬 啟動【全系統 14 道濾網「條件期望值 (Conditional Expectancy)」逐一健檢】 (2005–2026，528 個半月換倉點)")
    print("=" * 135)

    tw_zero = build_zero_omission_tw_0050_0051_pit()
    env = prepare_clean_1725_pit_env()

    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    in_0050_0051_pit = tw_zero["in_0050_0051_pit"].reindex(index=idx, columns=pit_tw).ffill().fillna(False)

    conn_twse = sqlite3.connect("tw_stock.db")
    pit_tw_ids = [s.replace(".TW", "") for s in pit_tw]
    ph_all = ",".join(["?"] * len(pit_tw_ids))
    df_twse_daily = pd.read_sql_query(
        f"SELECT date, stock_id, trade_value FROM daily_stock WHERE stock_id IN ({ph_all}) AND market_type IN ('上市', 'TWSE')",
        conn_twse,
        params=pit_tw_ids,
    )
    df_rev = pd.read_sql_query("SELECT revenue_date, stock_id, yoy, mom FROM monthly_revenue", conn_twse)
    df_mac = pd.read_sql_query(
        "SELECT date, oil_wti, gasoline, heating_oil, crack_spread_321 FROM macro_indicators ORDER BY date ASC",
        conn_twse,
    )
    conn_twse.close()

    df_twse_daily["dt"] = pd.to_datetime(df_twse_daily["date"], format="%Y%m%d", errors="coerce")
    df_twse_daily = df_twse_daily.dropna(subset=["dt"]).drop_duplicates(subset=["dt", "stock_id"], keep="last")
    df_twse_daily["ticker"] = df_twse_daily["stock_id"] + ".TW"
    piv_twse_val = df_twse_daily.pivot(index="dt", columns="ticker", values="trade_value").reindex(index=idx, columns=pit_tw).fillna(0.0)
    is_twse_listed_pit = (piv_twse_val > 0).rolling(20, min_periods=1).max() > 0
    twse_adv60 = piv_twse_val.rolling(60, min_periods=15).mean()
    twse_rk_pit = twse_adv60.where(is_twse_listed_pit).rank(axis=1, ascending=False, method="min")

    tw_base_0050_0051 = (
        in_0050_0051_pit
        & is_twse_listed_pit
        & (twse_rk_pit <= 30)
        & (env["avg_order_rk"][pit_tw] <= 30)
        & (env["raw_px_tw"][pit_tw] >= 50.0)
        & (env["pe_mat"][pit_tw] > 0)
        & (env["pe_mat"][pit_tw] <= 45.0)
        & ((~env["roe_mat"][pit_tw].notna()) | (env["roe_mat"][pit_tw] >= 20.0))
        & ((~env["roe_mat"][pit_tw].notna()) | (env["tr20_mat"][pit_tw] > 0.001) | (env["fr20_mat"][pit_tw] > 0.002))
        & (env["io_20"][pit_tw] > -0.10)
        & (env["fip_126"][pit_tw] > 0.05)
    )
    elig_base = pd.DataFrame(False, index=idx, columns=cols)
    elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_base[pit_tw] = tw_base_0050_0051

    stk_adj = env["stk_adj"][cols]
    stk_open = env["stk_open"][cols]
    stk_high = env["stk_high"][cols]
    stk_low = env["stk_low"][cols]
    stk_vol = env["stk_vol"][cols]
    ma20 = env["ma20"][cols]
    ma60 = env["ma60"][cols]
    ma200 = env["ma200"][cols]

    bias20 = ((stk_adj / (ma20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)
    high20 = stk_high.rolling(20, min_periods=5).max()
    low20 = stk_low.rolling(20, min_periods=5).min()
    dd20 = ((stk_adj / (high20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)

    mom12m = env["mom12m"][cols]
    mom3m = stk_adj.pct_change(63).fillna(0.0).astype(np.float32)
    r_mom5 = stk_adj.pct_change(5).fillna(0.0).astype(np.float32)
    fip_252 = env["fip_252"][cols]
    io_20 = env["io_20"][cols]
    io_5 = env["io_5"][cols]
    churn = env["churn_exhaustion"][cols]
    g9_sec = fops.make_g9_secondary_mult(env)[cols]

    dvol = (stk_adj * stk_vol).fillna(0.0)
    turnover_growth = ((dvol.rolling(20, min_periods=5).mean() / (dvol.rolling(60, min_periods=15).mean() + 1.0)) - 1.0).fillna(0.0).astype(np.float32)
    high_60 = stk_high.rolling(60, min_periods=20).max()
    low_60 = stk_low.rolling(60, min_periods=20).min()
    sustain_20d = (stk_adj >= high_60 * 0.97).astype(np.float32).rolling(20, min_periods=5).mean().fillna(0.0).astype(np.float32)
    comp_ratio = (((high20 - low20) / (stk_adj + 1e-6)).fillna(0.25) / (((high_60 - low_60) / (stk_adj + 1e-6)).fillna(0.35) + 1e-6)).astype(np.float32)
    daily_ret = stk_adj.pct_change().fillna(0.0)
    down_sq_60 = (daily_ret.clip(upper=0.0) ** 2).rolling(60, min_periods=20).mean()
    sortino_60 = ((daily_ret.rolling(60, min_periods=20).mean() / (np.sqrt(down_sq_60) + 1e-6)) * np.sqrt(252.0)).fillna(0.0).astype(np.float32)

    piv_yoy = pd.DataFrame(0.0, index=idx, columns=cols, dtype=np.float32)
    piv_mom = pd.DataFrame(0.0, index=idx, columns=cols, dtype=np.float32)
    if not df_rev.empty:
        df_rev["ann_date"] = pd.to_datetime(df_rev["revenue_date"].map(_roc_to_ann_str), errors="coerce")
        df_rev["sym"] = df_rev["stock_id"].astype(str).str.strip() + ".TW"
        df_rev = df_rev[df_rev["sym"].isin(pit_tw) & df_rev["ann_date"].notna()]
        if not df_rev.empty:
            y_tab = df_rev.pivot_table(index="ann_date", columns="sym", values="yoy", aggfunc="last")
            m_tab = df_rev.pivot_table(index="ann_date", columns="sym", values="mom", aggfunc="last")
            u_idx = sorted(set(idx) | set(y_tab.index))
            y_tab = y_tab.reindex(index=u_idx).ffill().reindex(idx).fillna(0.0)
            m_tab = m_tab.reindex(index=u_idx).ffill().reindex(idx).fillna(0.0)
            for c_sym in y_tab.columns:
                if c_sym in piv_yoy.columns:
                    piv_yoy[c_sym] = y_tab[c_sym].astype(np.float32)
                    piv_mom[c_sym] = m_tab[c_sym].astype(np.float32)

    vcp_condition = (sustain_20d >= 0.45) & (comp_ratio <= 0.65) & (sortino_60 >= 1.5) & (turnover_growth > 0.0) & (io_20 > 0.0)
    rev_decay_mask = (piv_yoy < -5.0) & (piv_mom < -5.0) & (stk_adj < ma20)
    dist_veto_mask = (stk_adj < ma20) & (io_5 < -0.01)
    is_mega_us = pd.DataFrame(False, index=idx, columns=cols)
    is_mega_us[us_tickers] = (env["us_rk_pit"] <= 100).fillna(False)
    fip_cond = (fip_252 > 0.08) | is_mega_us
    coiled_mask = (mom12m > 0.65) & fip_cond & (dd20 >= -0.12) & (dd20 <= -0.03) & (bias20 >= -0.03) & (bias20 <= 0.04) & (io_20 > -0.02)

    dates_idx = stk_adj.index
    df_mac["dt"] = pd.to_datetime(df_mac["date"], format="%Y%m%d", errors="coerce")
    df_mac = df_mac.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
    df_mac.index = df_mac.index.astype(dates_idx.dtype)

    cl_s = df_mac["oil_wti"].reindex(dates_idx).ffill()
    rb_s = df_mac["gasoline"].reindex(dates_idx).ffill()
    ho_s = df_mac["heating_oil"].reindex(dates_idx).ffill()
    cl_ma20_s = cl_s.rolling(20, min_periods=10).mean()
    crack_s = (2.0 * rb_s * 42.0 + 1.0 * ho_s * 42.0 - 3.0 * cl_s) / 3.0
    crack_ma20_s = crack_s.rolling(20, min_periods=10).mean()
    crack_dd20_s = (crack_s / crack_s.rolling(20, min_periods=10).max() - 1.0).fillna(0.0)
    crack_ret20_s = crack_s.pct_change(20).fillna(0.0)
    cl_ret = cl_s.pct_change().fillna(0.0).clip(-0.15, 0.15)
    crack_diff = (crack_s.diff() / (crack_ma20_s.abs() + 5.0)).fillna(0.0).clip(-0.20, 0.20)
    energy_factor_ret = (0.5 * cl_ret + 0.5 * crack_diff).astype(np.float32)
    energy_corr_60 = daily_ret.clip(-0.20, 0.20).rolling(60, min_periods=30).corr(energy_factor_ret).fillna(0.0).values

    PURE_REFINERS_SET = {"MPC", "VLO", "PSX", "TSO", "SUN", "HFC", "DINO", "6505.TW"}
    UPSTREAM_CRUDE_SET = {"XOM", "CVX", "COP", "OXY", "SLB", "HAL", "DVN", "EOG", "HES", "MRO", "FANG", "APA", "BKR"}
    refiner_col_mask = np.array([c_sym in PURE_REFINERS_SET for c_sym in cols], dtype=bool)
    upstream_col_mask = np.array([c_sym in UPSTREAM_CRUDE_SET for c_sym in cols], dtype=bool)
    upstream_indices = np.where(upstream_col_mask)[0]

    cond_s1_crack_veto = ((crack_s < crack_ma20_s) & (crack_dd20_s <= -0.15) & (crack_ret20_s <= -0.10)).fillna(False).values
    cond_s2a_oil_veto = ((crack_ma20_s >= 25.0) & (crack_s < crack_ma20_s) & (crack_dd20_s <= -0.18) & (cl_s < cl_ma20_s)).fillna(False).values
    cond_s2b_macro = ((crack_s < crack_ma20_s) & (crack_dd20_s <= -0.20)).fillna(False).values
    mom12m_arr = mom12m.values
    mom3m_arr = mom3m.values

    veto_hybrid_arr = np.zeros((len(dates_idx), len(cols)), dtype=bool)
    for _t_i in range(len(dates_idx)):
        if cond_s1_crack_veto[_t_i]:
            veto_hybrid_arr[_t_i, refiner_col_mask] = True
        if cond_s2a_oil_veto[_t_i]:
            veto_hybrid_arr[_t_i, upstream_col_mask] = True
        if cond_s2b_macro[_t_i]:
            for _c_i in upstream_indices:
                if mom12m_arr[_t_i, _c_i] >= 0.75 and mom3m_arr[_t_i, _c_i] >= 0.25:
                    veto_hybrid_arr[_t_i, _c_i] = True
        if cond_s2a_oil_veto[_t_i] or (cond_s1_crack_veto[_t_i] and cl_s.iloc[_t_i] < cl_ma20_s.iloc[_t_i]):
            veto_hybrid_arr[_t_i, energy_corr_60[_t_i] >= 0.32] = True

    # 建立所有正式換倉日 (Day 1 & Day 22)
    all_dates = env["data4"]["all_dates"]
    dt_to_pos = {d: i for i, d in enumerate(dates_idx)}
    rebal_pos_list = []
    for day_target in (1, 22):
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            if y < 2005:
                continue
            sub = grp[grp.dt.day >= day_target]
            dt = sub.iloc[0] if len(sub) > 0 else grp.iloc[-1]
            pos = dt_to_pos[dt]
            if pos + 15 < len(dates_idx):
                rebal_pos_list.append(pos)
    rebal_pos_list = sorted(list(set(rebal_pos_list)))

    px_arr = stk_adj.values
    m60_arr = ma60.values
    m200_arr = ma200.values
    el_arr = elig_base.values
    s_g5_arr = env["s_g5_open"][cols].values
    churn_arr = churn.values
    dist_arr = dist_veto_mask.values
    coiled_arr = coiled_mask.values
    vcp_arr = vcp_condition.values
    rev_dec_arr = rev_decay_mask.values
    sec_arr = g9_sec.values
    rmom5_arr = r_mom5.values
    io5_arr = io_5.values
    daily_ret_arr = daily_ret.values

    # 計算每個換倉點後 15 個交易日的真實報酬 (t+1 收盤至 t+15 收盤)
    def fwd15_ret(t, idx_list):
        if len(idx_list) == 0:
            return np.nan
        return float(np.mean([(px_arr[t + 15, i] / px_arr[t + 1, i] - 1.0) * 100.0 for i in idx_list]))

    print(f"\n📌 第 1 部分：【選股排雷與加分濾網】在 {len(rebal_pos_list)} 個正式半月換倉點的「觸發當下條件期望值」")
    print("-" * 135)
    print(f"{'濾網名稱與物理機制':<45} | {'觸發次數':>8} | {'被踢/原股15D%':>13} | {'遞補/新股15D%':>13} | {'單次挽救幅度':>12} | {'條件勝率':>8} | {'健檢判定'}")
    print("-" * 135)

    def eval_swap_filter(label, get_before_after_fn):
        diffs = []
        r_old_list = []
        r_new_list = []
        for t in rebal_pos_list:
            old_top3, new_top3 = get_before_after_fn(t)
            if old_top3 is None or new_top3 is None:
                continue
            removed = [i for i in old_top3 if i not in new_top3]
            added = [i for i in new_top3 if i not in old_top3]
            if len(removed) > 0 and len(added) > 0:
                ro = fwd15_ret(t, removed)
                rn = fwd15_ret(t, added)
                if not np.isnan(ro) and not np.isnan(rn):
                    r_old_list.append(ro)
                    r_new_list.append(rn)
                    diffs.append(rn - ro)
        cnt = len(diffs)
        if cnt == 0:
            print(f"{label:<45} | {0:>8d} | {'—':>13} | {'—':>13} | {'—':>12} | {'—':>8} | ⚪ 無影響")
            return
        m_old = np.mean(r_old_list)
        m_new = np.mean(r_new_list)
        m_diff = np.mean(diffs)
        win_r = np.mean([1.0 if d > 0 else 0.0 for d in diffs]) * 100.0
        verdict = "🟢 真・黃金濾網 (必留)" if (m_diff >= 0.50 and win_r >= 52.0) else ("🟡 中性微幅輔助" if m_diff >= 0.0 else "🔴 負貢獻/噪音 (應砍)")
        print(f"{label:<45} | {cnt:>8d} | {m_old:>+12.2f}% | {m_new:>+12.2f}% | {m_diff:>+11.2f}% | {win_r:>7.1f}% | {verdict}")

    # 1. 能源與裂解價差下行排雷 (veto_hybrid_arr)
    def fn_energy(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0)
        ord_before = vi[np.argsort(-sc[vi])]
        ord_after = np.array([i for i in ord_before if not veto_hybrid_arr[t, i]], dtype=int)
        if len(ord_after) < 3: return None, None
        return ord_before[:3], ord_after[:3]

    # 2. 高檔爆量滯漲排雷 (churn_exhaustion)
    def fn_churn(t):
        valid_no_ch = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0)
        vi = np.where(valid_no_ch)[0]
        if len(vi) < 6: return None, None
        sc = s_g5_arr[t]
        ord_before = vi[np.argsort(-sc[vi])]
        ord_after = np.array([i for i in ord_before if not churn_arr[t, i]], dtype=int)
        if len(ord_after) < 3: return None, None
        return ord_before[:3], ord_after[:3]

    # 3. 破月線且主力日內出貨降權 (dist_veto_g10: stk_adj < ma20 & io_5 < -0.01 -> 0.70x)
    def fn_dist_veto(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc0 = s_g5_arr[t]
        sc1 = sc0 * np.where(dist_arr[t], 0.70, 1.0)
        return vi[np.argsort(-sc0[vi])[:3]], vi[np.argsort(-sc1[vi])[:3]]

    # 4. 強勢股回測月線量縮蓄勢加分 (coiled_spring_g11 -> 1.12x)
    def fn_coiled(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc0 = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0)
        sc1 = sc0 * np.where(coiled_arr[t], 1.12, 1.0)
        return vi[np.argsort(-sc0[vi])[:3]], vi[np.argsort(-sc1[vi])[:3]]

    # 5. VCP 波動率收斂與高 Sortino 加分 (vcp_condition -> 1.04x)
    def fn_vcp(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc0 = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0)
        sc1 = sc0 * np.where(vcp_arr[t], 1.04, 1.0)
        return vi[np.argsort(-sc0[vi])[:3]], vi[np.argsort(-sc1[vi])[:3]]

    # 6. G9 二階微結構狙擊排序 (第 2~5 名之間依日內吸籌與回撤微調)
    def fn_g9_sec(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0) * np.where(vcp_arr[t], 1.04, 1.0)
        ord0 = vi[np.argsort(-sc[vi])]
        top1_i = [ord0[0]]
        pool_i = list(ord0[1:5])
        pool_i.sort(key=lambda c_i: float(sc[c_i]) * float(sec_arr[t, c_i]), reverse=True)
        ord1 = np.array(top1_i + pool_i, dtype=int)
        return ord0[:3], ord1[:3]

    # 7. PC1 前 6 強高度擁擠共振減速 (pc1_var_ratio >= 0.55 & mode_ret5 < 0)
    def fn_pc1(t):
        if t < 25: return None, None
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0) * np.where(vcp_arr[t], 1.04, 1.0)
        ord0 = vi[np.argsort(-sc[vi])]
        top1_i = [ord0[0]]
        pool_i = list(ord0[1:5])
        pool_i.sort(key=lambda c_i: float(sc[c_i]) * float(sec_arr[t, c_i]), reverse=True)
        ord_pre = np.array(top1_i + pool_i + list(ord0[5:]), dtype=int)
        cand6 = ord_pre[:6]
        ret_mat = daily_ret_arr[t - 19 : t + 1, cand6]
        std_v = np.std(ret_mat, axis=0) + 1e-8
        z_mat = (ret_mat - np.mean(ret_mat, axis=0)) / std_v
        corr_m = (z_mat.T @ z_mat) / 20.0
        eigvals, eigvecs = np.linalg.eigh(corr_m)
        if float(eigvals[-1]) / 6.0 >= 0.55 and (float(np.mean(rmom5_arr[t, cand6])) < 0.0 or float(np.mean(io5_arr[t, cand6])) < 0.0):
            pc1_vec = np.abs(eigvecs[:, -1])
            adj_s = [(float(sc[c_i]) * float(sec_arr[t, c_i]) * ((1.0 - 0.12 * float(pc1_vec[idx_c])) if idx_c >= 1 else 1.0), c_i) for idx_c, c_i in enumerate(cand6)]
            adj_s.sort(key=lambda x: x[0], reverse=True)
            ord_post = np.array([x[1] for x in adj_s], dtype=int)
            return ord_pre[:3], ord_post[:3]
        return None, None

    # 8. 台股月營收雙衰且破月線降權 (rev_decay_pen)
    def fn_rev_decay(t):
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t])
        vi = np.where(valid)[0]
        if len(vi) < 6: return None, None
        sc0 = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0) * np.where(vcp_arr[t], 1.04, 1.0)
        sc1 = sc0 * np.where(rev_dec_arr[t], 0.75, 1.0)
        return vi[np.argsort(-sc0[vi])[:3]], vi[np.argsort(-sc1[vi])[:3]]

    eval_swap_filter("1. 能源與裂解價差下行排雷 (S1/S2/Beta Veto)", fn_energy)
    eval_swap_filter("2. 高檔爆量滯漲排雷 (Churn Exhaustion Veto)", fn_churn)
    eval_swap_filter("3. 破月線且主力日內出貨降權 (Dist Veto 0.70x)", fn_dist_veto)
    eval_swap_filter("4. 年線牛股回測月線蓄勢加分 (Coiled Spring 1.12x)", fn_coiled)
    eval_swap_filter("5. VCP 波動收斂與高 Sortino 加分 (VCP 1.04x)", fn_vcp)
    eval_swap_filter("6. G9 二階微結構狙擊排序 (#2~#5 機構吸籌微調)", fn_g9_sec)
    eval_swap_filter("7. PC1 前6強高度擁擠共振減速 (Crowding Shield)", fn_pc1)
    eval_swap_filter("8. 台股月營收雙衰破月線降權 (Rev Decay 0.75x)", fn_rev_decay)

    # 第 2 部分：宏觀減倉防禦盾 (Macro Exposure Shields) 觸發當下之未來 15 日市場與強勢股真實報酬
    print("\n📌 第 2 部分：【宏觀減倉防禦盾 (Macro Shields)】在觸發減倉當下的「後 15 日 Top 3 強勢股真實漲跌」")
    print("-" * 135)
    print(f"{'宏觀防禦濾網名稱與觸發條件':<52} | {'觸發次數':>8} | {'觸發後Top3 15D報酬':>18} | {'未觸發時15D報酬':>16} | {'觸發時下跌機率':>14} | {'健檢判定'}")
    print("-" * 135)

    d4 = env["data4"]
    br_s = d4["global_breadth"]
    qqq_p_s = d4["px_adj"]["QQQ"]
    qqq_m60_s = d4["qqq_ma60"]
    qqq_bias_s = d4["qqq_bias_dict"][500]
    us10y_s = d4["us10y_series"]
    u10_chg20_s = d4["us10y_chg20"]
    z_oi_s = d4["pc_oi_z60"]
    slp_oi_s = d4["pc_oi_slope10"]
    rs_q_s_s = d4["rs_qqq_spy_20"]
    spy_bm20_s = d4["spy_below_ma20"]
    qqq_bm20_s = d4["qqq_below_ma20"]

    # Precompute Top 3 return at each rebalance pos
    top3_ret_map = {}
    top5_stats_map = {}
    for t in rebal_pos_list:
        valid = el_arr[t] & (px_arr[t] > m60_arr[t]) & (px_arr[t] > m200_arr[t]) & (s_g5_arr[t] > 0) & (~churn_arr[t]) & (~veto_hybrid_arr[t])
        vi = np.where(valid)[0]
        if len(vi) >= 3:
            sc = s_g5_arr[t] * np.where(dist_arr[t], 0.70, 1.0) * np.where(coiled_arr[t], 1.12, 1.0)
            ord_i = vi[np.argsort(-sc[vi])]
            top3_ret_map[t] = fwd15_ret(t, ord_i[:3])
            top5 = ord_i[:min(5, len(ord_i))]
            top5_stats_map[t] = (
                int(np.sum(env["io_20"][cols].values[t, top5] < 0.0)),
                int(np.sum(io5_arr[t, top5] < 0.0)),
                float(np.mean(env["io_20"][cols].values[t, top5])),
            )

    def eval_macro_shield(label, cond_fn):
        trig_rets = []
        norm_rets = []
        for t in rebal_pos_list:
            if t not in top3_ret_map: continue
            r15 = top3_ret_map[t]
            if np.isnan(r15): continue
            if cond_fn(t):
                trig_rets.append(r15)
            else:
                norm_rets.append(r15)
        cnt = len(trig_rets)
        if cnt == 0:
            print(f"{label:<52} | {0:>8d} | {'—':>18} | {'—':>16} | {'—':>14} | ⚪ 無觸發")
            return
        m_trig = np.mean(trig_rets)
        m_norm = np.mean(norm_rets) if len(norm_rets) > 0 else 0.0
        loss_prob = np.mean([1.0 if r < 0 else 0.0 for r in trig_rets]) * 100.0
        verdict = "🟢 真・保命護盾 (必留)" if (m_trig < 0.50 or m_trig < m_norm - 1.0) else "🔴 誤殺牛市補丁 (應檢討)"
        print(f"{label:<52} | {cnt:>8d} | {m_trig:>+17.2f}% | {m_norm:>+15.2f}% | {loss_prob:>13.1f}% | {verdict}")

    eval_macro_shield("9. 極端空頭清倉盾 (全球廣度 Breadth < 30%)", lambda t: float(br_s.iloc[t]) < 0.30)
    eval_macro_shield("10. 中度破線警戒盾 (廣度 30%~50% 且 QQQ < 季線)", lambda t: 0.30 <= float(br_s.iloc[t]) < 0.50 and float(qqq_p_s.iloc[t]) < float(qqq_m60_s.iloc[t]))
    eval_macro_shield("11. 高利率極端乖離盾 (QQQ年線乖離>=30% 且 10Y利率>=3.5%)", lambda t: float(qqq_bias_s.iloc[t]) >= 30.0 and float(us10y_s.iloc[t]) >= 3.5)
    eval_macro_shield("12. C3 領頭羊集體派發盾 (Top5中>=4檔出貨 且 破月線/殖利率飆)", lambda t: top5_stats_map[t][0] >= 4 and top5_stats_map[t][1] >= 4 and top5_stats_map[t][2] <= -0.08 and (bool(spy_bm20_s.iloc[t]) or float(u10_chg20_s.iloc[t]) >= 0.35))
    eval_macro_shield("13. C4 殖利率急飆殺估值盾 (10Y殖利率20D急升>=0.22 且 高乖離轉弱)", lambda t: float(u10_chg20_s.iloc[t]) >= 0.22 and ((float(qqq_bias_s.iloc[t]) >= 22.0 and float(rs_q_s_s.iloc[t]) < 0.0) or (float(us10y_s.iloc[t]) >= 4.0 and float(u10_chg20_s.iloc[t]) >= 0.35)))
    eval_macro_shield("14. C5 雙指數破線共振盾 (QQQ破季線 + SPY破月線 + 殖利率升)", lambda t: float(qqq_p_s.iloc[t]) < float(qqq_m60_s.iloc[t]) and bool(spy_bm20_s.iloc[t]) and (float(u10_chg20_s.iloc[t]) >= 0.22 or float(z_oi_s.iloc[t]) < -0.40))
    print("=" * 135)


if __name__ == "__main__":
    main()
