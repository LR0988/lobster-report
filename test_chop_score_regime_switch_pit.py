#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_chop_score_regime_switch_pit.py

在 1,704 檔無生存者偏誤 (PIT) 開放池上，嚴格驗證（零未來函數）：
當【無趨勢震盪雷達 Chop Score >= 3】亮燈時，自動切換「均值回歸 (Mean Reversion) / 黃金避險 (GLD)」對 22 年績效與震盪乾旱期的提升效果！
"""

import sqlite3
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, make_pit_macro_fn
import forensic_open_pool_sniper as fops


def main():
    print("=" * 135)
    print("🧭 啟動【Chop Score >= 3 無趨勢震盪盤自動切換：均值回歸 / 黃金避險】22 年 PIT 實證 (2005–2026)")
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
        f"""
        SELECT date, stock_id, trade_value
        FROM daily_stock
        WHERE stock_id IN ({ph_all})
          AND market_type IN ('上市', 'TWSE')
        """,
        conn_twse,
        params=pit_tw_ids,
    )
    df_mac = pd.read_sql_query(
        "SELECT date, oil_wti, gasoline, heating_oil, crack_spread_321 FROM macro_indicators ORDER BY date ASC",
        conn_twse,
    )
    df_gld = pd.read_sql_query(
        "SELECT date, adj_close FROM global_sovereign_daily WHERE ticker = 'GLD' ORDER BY date ASC",
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

    tw_midcap_sniper = (
        is_twse_listed_pit
        & (twse_rk_pit <= 120)
        & (env["raw_px_tw"][pit_tw] >= 40.0)
        & (env["pe_mat"][pit_tw] > 0)
        & (env["pe_mat"][pit_tw] <= 40.0)
        & (env["roe_mat"][pit_tw] >= 18.0)
        & (env["tr20_mat"][pit_tw] >= 0.004)
        & (env["io_20"][pit_tw] > 0.02)
        & (env["fip_126"][pit_tw] > 0.10)
    )

    elig_base = pd.DataFrame(False, index=idx, columns=cols)
    elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_base[pit_tw] = tw_base_0050_0051

    elig_with_tw_sniper = pd.DataFrame(False, index=idx, columns=cols)
    elig_with_tw_sniper[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_with_tw_sniper[pit_tw] = tw_base_0050_0051 | tw_midcap_sniper

    g9_sec = fops.make_g9_secondary_mult(env)
    macro_g11 = make_pit_macro_fn(c4_cap=0.45, c5_cap=1.0, c6_cap=0.20, u10_thr=0.22, qb_thr=22.0)

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

    dvol = (stk_adj * stk_vol).fillna(0.0)
    turnover_growth = ((dvol.rolling(20, min_periods=5).mean() / (dvol.rolling(60, min_periods=15).mean() + 1.0)) - 1.0).fillna(0.0).astype(np.float32)

    high_60 = stk_high.rolling(60, min_periods=20).max()
    low_60 = stk_low.rolling(60, min_periods=20).min()
    sustain_20d = (stk_adj >= high_60 * 0.97).astype(np.float32).rolling(20, min_periods=5).mean().fillna(0.0).astype(np.float32)
    comp_ratio = (((high20 - low20) / (stk_adj + 1e-6)).fillna(0.25) / (((high_60 - low_60) / (stk_adj + 1e-6)).fillna(0.35) + 1e-6)).astype(np.float32)

    daily_ret = stk_adj.pct_change().fillna(0.0)
    down_sq_60 = (daily_ret.clip(upper=0.0) ** 2).rolling(60, min_periods=20).mean()
    sortino_60 = ((daily_ret.rolling(60, min_periods=20).mean() / (np.sqrt(down_sq_60) + 1e-6)) * np.sqrt(252.0)).fillna(0.0).astype(np.float32)
    down_sq_20 = (daily_ret.clip(upper=0.0) ** 2).rolling(20, min_periods=10).mean()
    down_vol_20 = (np.sqrt(down_sq_20) * np.sqrt(252.0)).fillna(0.30).astype(np.float32)

    vcp_condition = (sustain_20d >= 0.45) & (comp_ratio <= 0.65) & (sortino_60 >= 1.5) & (turnover_growth > 0.0) & (io_20 > 0.0)
    dist_veto_g10 = np.where((stk_adj < ma20) & (io_5 < -0.01), 0.70, 1.0)
    is_mega_us = pd.DataFrame(False, index=idx, columns=cols)
    is_mega_us[us_tickers] = (env["us_rk_pit"] <= 100).fillna(False)

    fip_cond = (fip_252 > 0.08) | is_mega_us
    coiled_mask = (mom12m > 0.65) & fip_cond & (dd20 >= -0.12) & (dd20 <= -0.03) & (bias20 >= -0.03) & (bias20 <= 0.04) & (io_20 > -0.02)
    coiled_spring_g11 = np.where(coiled_mask, 1.12, 1.0)

    score_prod_arr = (
        env["s_g5_open"][cols] * dist_veto_g10 * coiled_spring_g11 * np.where(vcp_condition, 1.04, 1.0)
    ).values.astype(np.float32)

    # 震盪盤選股層「回測月線支撐低吸 (Pullback Mean Reversion)」修正係數：
    # 在無趨勢震盪盤 (Chop Score >= 3)，嚴懲短線暴衝過熱股 (bias20 > 12% 或 r5 > 6%)，獎勵長線強勢但回測貼近月線 (bias20 in [-2%, +5%] 且 r5 <= 1.5%) 的標的
    pullback_mr_mult = np.where(
        (bias20.values <= 0.05) & (bias20.values >= -0.02) & (r_mom5.values <= 0.015),
        1.14,
        np.where((bias20.values > 0.12) | (r_mom5.values > 0.06), 0.85, 1.0),
    ).astype(np.float32)
    score_chop_mr_arr = score_prod_arr * pullback_mr_mult

    data4 = env["data4"]
    dates_idx = stk_adj.index
    dt_to_pos = {d: i for i, d in enumerate(dates_idx)}

    # --- 1. 建構四維度「無趨勢震盪雷達 (Chop Score 0~4)」 ---
    qqq_p_s = data4["px_adj"]["QQQ"].reindex(dates_idx).ffill()
    qqq_ret = qqq_p_s.pct_change().fillna(0.0).values
    qqq_ma20_s = qqq_p_s.rolling(20, min_periods=10).mean()
    qqq_ma60_s = qqq_p_s.rolling(60, min_periods=20).mean()
    qqq_ma200_s = qqq_p_s.rolling(200, min_periods=50).mean()
    qqq_vol20_s = (qqq_p_s.pct_change().rolling(20, min_periods=10).std() * np.sqrt(252.0)).fillna(0.25)

    # 指標 1: 價格路徑效率比 ER20 & ER60
    er20_s = (qqq_p_s - qqq_p_s.shift(20)).abs() / (qqq_p_s.diff().abs().rolling(20, min_periods=10).sum() + 1e-9)
    er60_s = (qqq_p_s - qqq_p_s.shift(60)).abs() / (qqq_p_s.diff().abs().rolling(60, min_periods=20).sum() + 1e-9)

    # 指標 2: 均線糾結與穿越次數
    ma_spread_s = ((qqq_ma20_s / (qqq_ma60_s + 1e-9)) - 1.0).abs()
    cross_20d_s = (qqq_p_s > qqq_ma20_s).astype(int).diff().abs().rolling(20, min_periods=5).sum()

    # 指標 3: 截面強勢股動能延續溢價 (MomPayoff20D)
    us_px = stk_adj[us_tickers]
    r20_us = us_px.pct_change(20)
    r60_lag20_us = us_px.shift(20).pct_change(60)
    top_decile_us = r60_lag20_us.rank(axis=1, pct=True) >= 0.90
    mom_payoff_s = (r20_us.where(top_decile_us).mean(axis=1) - r20_us.median(axis=1)).rolling(10, min_periods=3).mean().fillna(0.02)

    # 指標 4: 全球市場廣度
    br_s = data4["global_breadth"].reindex(dates_idx).ffill().fillna(0.5)

    c1_chop = ((er20_s < 0.25) & (er60_s < 0.25)).astype(int)
    c2_chop = ((ma_spread_s < 0.025) | (cross_20d_s >= 3)).astype(int)
    c3_chop = (mom_payoff_s < 0.01).astype(int)
    c4_chop = ((br_s >= 0.35) & (br_s <= 0.58)).astype(int)

    chop_score_arr = (c1_chop + c2_chop + c3_chop + c4_chop).fillna(0).values
    is_chop_arr = chop_score_arr >= 3
    mom_payoff_arr = mom_payoff_s.values

    # --- 2. GLD 黃金趨勢避險序列 ---
    df_gld["dt"] = pd.to_datetime(df_gld["date"], errors="coerce")
    df_gld = df_gld.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
    df_gld.index = df_gld.index.astype(dates_idx.dtype)
    gld_p = df_gld["adj_close"].reindex(dates_idx).ffill().bfill()
    gld_ret = gld_p.pct_change().fillna(0.0).clip(-0.10, 0.10).values
    gld_ma60 = gld_p.rolling(60, min_periods=20).mean()
    gld_mom20 = gld_p.pct_change(20).fillna(0.0)
    gld_mom60 = gld_p.pct_change(60).fillna(0.0)
    gld_bull_mask = (((gld_p > gld_ma60) & (gld_mom20 > -0.01)) | (gld_mom60 > 0.02)).fillna(False).values

    # --- 3. 建構「日頻短線超跌均值回歸子引擎 (Short-Term Oversold Dip-Buying MR Pod)」 ---
    # 原理：在震盪盤 (Chop Score >= 3)，「追突破」會被洗，但「長線多頭權值股 (Price > MA200) 短線連續 3 日急跌超賣 (ret_3d < -3.5% 且低於 MA5)」
    #       隔日抄底、反彈站回 5 日線即出場的短線均值回歸策略勝率極高！
    ma5_us = us_px.rolling(5, min_periods=3).mean().values
    ma200_us = ma200[us_tickers].values
    r3_us = us_px.pct_change(3).fillna(0.0).values
    ret1_us = daily_ret[us_tickers].values
    us_elig_2d = (env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)).values
    us_px_arr = us_px.values

    oversold_mask = us_elig_2d & (us_px_arr > ma200_us * 1.00) & (r3_us < -0.032) & (us_px_arr < ma5_us * 0.985)
    q_r3 = qqq_p_s.pct_change(3).fillna(0.0).values
    q_ma5 = qqq_p_s.rolling(5, min_periods=3).mean().values
    q_ma60_arr = qqq_ma60_s.values
    q_ma200 = qqq_ma200_s.values
    q_p_arr = qqq_p_s.values
    safe_cash_ret = data4["safe_cash_ret"].values

    # 嚴格區分「多頭/箱型震盪 (QQQ >= MA60 * 0.98)」與「空頭崩盤 (QQQ < MA60 * 0.98)」：
    # 均值回歸抄底 (Dip-Buying MR) 只在非崩盤期執行（避免在 2008/2022 接刀放大 MDD），破季線時自動轉入多頭黃金 GLD 或短債！
    mr_pod_daily_ret = np.zeros(len(dates_idx), dtype=float)
    for t in range(200, len(dates_idx) - 1):
        not_crashing = q_p_arr[t] >= q_ma60_arr[t] * 0.98
        cands = np.where(oversold_mask[t])[0]
        if not_crashing and len(cands) >= 2:
            order_mr = cands[np.argsort(r3_us[t, cands])[:4]]
            mr_pod_daily_ret[t + 1] = float(np.mean(ret1_us[t + 1, order_mr])) - 0.0003
        elif not_crashing and q_p_arr[t] > q_ma200[t] and (q_r3[t] < -0.015 or q_p_arr[t] < q_ma5[t] * 0.988):
            mr_pod_daily_ret[t + 1] = float(qqq_ret[t + 1])
        elif gld_bull_mask[t]:
            mr_pod_daily_ret[t + 1] = float(gld_ret[t + 1])
        else:
            mr_pod_daily_ret[t + 1] = float(safe_cash_ret[t + 1])

    bear_short_mask = ((br_s < 0.35) & (qqq_p_s < qqq_ma60_s) & (qqq_p_s < qqq_ma20_s)).fillna(False).values
    goldilocks_bull_mask = (
        (br_s >= 0.55)
        & (qqq_p_s > qqq_ma20_s)
        & (qqq_ma20_s > qqq_ma60_s)
        & (qqq_vol20_s < 0.22)
        & (chop_score_arr <= 1)
    ).fillna(False).values

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
    stk_ret_clean = daily_ret.clip(-0.20, 0.20)
    energy_corr_60 = stk_ret_clean.rolling(60, min_periods=30).corr(energy_factor_ret).fillna(0.0).astype(np.float32).values

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

    px_adj_arr = stk_adj.values
    px_open_arr = stk_open.values
    ma20_arr = ma20.values
    ma60_arr = ma60.values
    ma200_arr = ma200.values
    rmom5_arr = r_mom5.values
    daily_ret_arr = daily_ret.values.astype(np.float32)
    down_vol20_arr = down_vol_20.values.astype(np.float32)
    io20_arr = io_20.values
    io5_arr = io_5.values
    churn_arr = env["churn_exhaustion"][cols].values
    elig_base_arr = elig_base.values
    elig_tw_sniper_arr = elig_with_tw_sniper.values
    sec_arr = g9_sec[cols].values

    global_breadth = data4["global_breadth"]
    us10y_series = data4["us10y_series"]
    qqq_bias = data4["qqq_bias_dict"][500]
    qqq_p = data4["px_adj"]["QQQ"]
    qqq_ma60 = data4["qqq_ma60"]
    all_dates = data4["all_dates"]

    is_tw_arr = np.array([c_sym.endswith(".TW") for c_sym in cols])
    fee_buy_arr = np.where(is_tw_arr, 0.001425 * 0.28, 0.0005)
    fee_sell_arr = np.where(is_tw_arr, (0.001425 * 0.28) + 0.003, 0.0005)

    def run_chop_engine(
        name: str,
        elig_mat: np.ndarray = elig_base_arr,
        chop_switch_mode: str = "none",  # "none", "gld", "mr", "gld_mr", "full_all_weather"
        goldilocks_qqq_boost: float = 0.0,
        bull_conviction_lev: float = 1.0,
    ):
        drift_tol = 0.12
        macro_cap = 0.35
        base_weights = [0.52, 0.24, 0.24]
        pool_k = 5

        def sim_tranche(day_target, init_cap=500000.0):
            rebal_dates = []
            for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
                sub = grp[grp.dt.day >= day_target]
                rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])

            periods = []
            for i in range(len(rebal_dates) - 1):
                t_date = rebal_dates[i]
                fut = dates_idx[dates_idx > t_date]
                if len(fut) == 0:
                    break
                t_in = fut[0]
                next_rebal = rebal_dates[i + 1]
                fut_next = dates_idx[dates_idx > next_rebal]
                if len(fut_next) == 0:
                    break
                t_out = fut_next[0]
                periods.append((t_date, t_in, t_out))

            all_sim_dates = dates_idx[(dates_idx >= periods[0][0]) & (dates_idx <= periods[-1][2])]
            daily_equity = pd.Series(index=all_sim_dates, dtype=float)
            cash = init_cap
            holdings = {}
            holding_tenure = {}
            p_idx = 0
            num_p = len(periods)
            in_gld_haven = False
            in_bear_short = False
            in_chop_regime = False

            for current_dt in all_sim_dates:
                cur_pos = dt_to_pos[current_dt]
                prev_pos = max(0, cur_pos - 1)
                # 每日根據前一日收盤 (prev_pos) 的無趨勢震盪訊號 (Chop_Score >= 3)，決定閒置/防禦資金的配置去向 (零未來函數)
                chop_yesterday = bool(is_chop_arr[prev_pos])
                gld_bull_yesterday = bool(gld_bull_mask[prev_pos])

                if cash > 0:
                    if chop_switch_mode == "gld":
                        if (chop_yesterday or in_gld_haven) and gld_bull_yesterday:
                            cash *= 1.0 + float(gld_ret[cur_pos])
                        else:
                            cash *= 1.0 + float(safe_cash_ret[cur_pos])
                    elif chop_switch_mode == "mr":
                        if chop_yesterday or in_chop_regime:
                            cash *= 1.0 + float(mr_pod_daily_ret[cur_pos])
                        else:
                            cash *= 1.0 + float(safe_cash_ret[cur_pos])
                    elif chop_switch_mode in ("gld_mr", "full_all_weather"):
                        if chop_yesterday or in_chop_regime:
                            # 震盪盤：55% 超跌均值回歸子引擎 + 45% 多頭黃金避險
                            g_r = float(gld_ret[cur_pos]) if gld_bull_yesterday else float(safe_cash_ret[cur_pos])
                            cash *= 1.0 + 0.55 * float(mr_pod_daily_ret[cur_pos]) + 0.45 * g_r
                        elif in_gld_haven and gld_bull_yesterday:
                            cash *= 1.0 + float(gld_ret[cur_pos])
                        elif chop_switch_mode == "full_all_weather" and in_bear_short:
                            r_short = -float(qqq_ret[cur_pos]) - (0.0075 / 252.0)
                            cash *= 1.0 + 0.35 * r_short + 0.65 * float(safe_cash_ret[cur_pos])
                        else:
                            cash *= 1.0 + float(safe_cash_ret[cur_pos])
                    else:
                        cash *= 1.0 + float(safe_cash_ret[cur_pos])

                if p_idx < num_p and current_dt == periods[p_idx][1]:
                    t_date, t_in, t_out = periods[p_idx]
                    t_pos = dt_to_pos[t_date]
                    in_pos = dt_to_pos[t_in]

                    in_gld_haven = bool(gld_bull_mask[t_pos])
                    in_bear_short = bool(bear_short_mask[t_pos])
                    in_chop_regime = bool(is_chop_arr[t_pos])

                    sp_row = px_adj_arr[t_pos]
                    m6_row = ma60_arr[t_pos]
                    m2_row = ma200_arr[t_pos]
                    # 保持主引擎選股排序純淨，不干擾半月換倉龍頭排序；震盪盤專注由「日頻超跌均值回歸子引擎 + 黃金避險」接管防禦與震盪部位！
                    sc_row = score_prod_arr[t_pos]
                    el_row = elig_mat[t_pos]
                    ch_row = churn_arr[t_pos]

                    valid_mask = (
                        el_row
                        & (~np.isnan(sp_row))
                        & (~np.isnan(sc_row))
                        & (~np.isnan(m6_row))
                        & (~np.isnan(m2_row))
                        & (sp_row > m6_row)
                        & (sp_row > m2_row)
                        & (sc_row > 0)
                        & (~ch_row)
                    )
                    valid_indices = np.where(valid_mask)[0]
                    if len(valid_indices) > 0:
                        order_pre = np.argsort(-sc_row[valid_indices])
                        sorted_indices = valid_indices[order_pre]
                    else:
                        sorted_indices = np.array([], dtype=int)

                    if sec_arr is not None and len(sorted_indices) > 2:
                        top1_i = [sorted_indices[0]]
                        pool_i = list(sorted_indices[1:pool_k])
                        rest_i = list(sorted_indices[pool_k:])
                        pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
                        sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)

                    top5_pre = sorted_indices[:min(5, len(sorted_indices))]
                    if len(top5_pre) > 0:
                        top5_neg_io20 = int(np.sum(io20_arr[t_pos, top5_pre] < 0.0))
                        top5_neg_io5 = int(np.sum(io5_arr[t_pos, top5_pre] < 0.0))
                        top5_avg_io20 = float(np.mean(io20_arr[t_pos, top5_pre]))
                    else:
                        top5_neg_io20, top5_neg_io5, top5_avg_io20 = 0, 0, 0.0

                    v_row = veto_hybrid_arr[t_pos]
                    if np.any(v_row):
                        sorted_indices = np.array([c_i for c_i in sorted_indices if not v_row[c_i]], dtype=int)
                        if sec_arr is not None and len(sorted_indices) > 2:
                            top1_i = [sorted_indices[0]]
                            pool_i = list(sorted_indices[1:pool_k])
                            rest_i = list(sorted_indices[pool_k:])
                            pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
                            sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)

                    if len(sorted_indices) >= 6 and t_pos >= 25:
                        cand6 = sorted_indices[:6]
                        ret_mat = daily_ret_arr[t_pos - 19 : t_pos + 1, cand6]
                        std_v = np.std(ret_mat, axis=0) + 1e-8
                        z_mat = (ret_mat - np.mean(ret_mat, axis=0)) / std_v
                        corr_m = (z_mat.T @ z_mat) / 20.0
                        eigvals, eigvecs = np.linalg.eigh(corr_m)
                        pc1_var_ratio = float(eigvals[-1]) / 6.0
                        pc1_vec = np.abs(eigvecs[:, -1])
                        if pc1_var_ratio >= 0.55:
                            mode_ret5 = float(np.mean(rmom5_arr[t_pos, cand6]))
                            mode_io5 = float(np.mean(io5_arr[t_pos, cand6]))
                            if mode_ret5 < 0.0 or mode_io5 < 0.0:
                                adj_scores = []
                                for idx_c, c_i in enumerate(cand6):
                                    base_s = float(sc_row[c_i]) * (float(sec_arr[t_pos, c_i]) if sec_arr is not None else 1.0)
                                    pen = (1.0 - 0.12 * float(pc1_vec[idx_c])) if idx_c >= 1 else 1.0
                                    adj_scores.append((base_s * pen, c_i))
                                adj_scores.sort(key=lambda x: x[0], reverse=True)
                                sorted_indices = np.array([x[1] for x in adj_scores] + list(sorted_indices[6:]), dtype=int)

                    br = float(global_breadth.iloc[t_pos]) if t_date in global_breadth.index else 0.5
                    if br >= 0.50:
                        base_exp = 1.0
                    elif br >= 0.30:
                        base_exp = 0.70
                    else:
                        base_exp = 0.0

                    qb = float(qqq_bias.iloc[t_pos]) if t_date in qqq_bias.index else 0.0
                    rate = float(us10y_series.iloc[t_pos]) if t_date in us10y_series.index else 0.0
                    qqq_below_ma60 = float(qqq_p.iloc[t_pos]) < float(qqq_ma60.iloc[t_pos])

                    if base_exp > 0.0:
                        if qb >= 30.0 and rate >= 3.5:
                            exposure = min(base_exp, 0.50)
                        else:
                            exposure = base_exp
                    else:
                        exposure = 0.0

                    if 0.30 <= br < 0.50 and qqq_below_ma60:
                        exposure = min(exposure, macro_cap)

                    exposure = macro_g11(t_date, t_pos, exposure, br, qb, rate, qqq_below_ma60, top5_neg_io20, top5_neg_io5, top5_avg_io20, data4)

                    ticker_rank = {int(c_i): rk + 1 for rk, c_i in enumerate(sorted_indices)}

                    if exposure <= 0 or len(sorted_indices) == 0:
                        for c_i, hinfo in list(holdings.items()):
                            out_px = px_open_arr[in_pos, c_i]
                            cash += hinfo["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                        holdings.clear()
                        holding_tenure = {}
                    else:
                        selected_stks = []
                        for c_i in list(holdings.keys()):
                            if v_row[c_i]:
                                continue
                            tenure = holding_tenure.get(c_i, 0)
                            rk = ticker_rank.get(c_i, None)
                            cur_c = float(px_adj_arr[t_pos, c_i])
                            m20_c = float(ma20_arr[t_pos, c_i])
                            if rk is not None and tenure < 4:
                                if rk <= 4 or (rk == 5 and float(io20_arr[t_pos, c_i]) > 0.0 and not (cur_c < m20_c and float(io5_arr[t_pos, c_i]) <= -0.015)):
                                    selected_stks.append(c_i)

                        for c_i in sorted_indices:
                            if len(selected_stks) >= 3:
                                break
                            c_i = int(c_i)
                            tenure = holding_tenure.get(c_i, 0)
                            if c_i not in selected_stks and tenure < 4:
                                selected_stks.append(c_i)

                        for c_i in sorted_indices:
                            if len(selected_stks) >= 3:
                                break
                            c_i = int(c_i)
                            if c_i not in selected_stks:
                                selected_stks.append(c_i)

                        n = min(3, len(selected_stks))
                        selected_stks = selected_stks[:n]
                        holding_tenure = {c_i: holding_tenure.get(c_i, 0) + 1 for c_i in selected_stks}

                        if n == 3:
                            s0 = max(float(sc_row[selected_stks[0]]), 0.05)
                            s1 = max(float(sc_row[selected_stks[1]]), 0.05)
                            s2 = max(float(sc_row[selected_stks[2]]), 0.05)
                            dv0 = max(float(down_vol20_arr[t_pos, selected_stks[0]]), 0.12)
                            dv1 = max(float(down_vol20_arr[t_pos, selected_stks[1]]), 0.12)
                            dv2 = max(float(down_vol20_arr[t_pos, selected_stks[2]]), 0.12)
                            ratio_01 = s0 / (s1 + 1e-6)
                            w0 = float(np.clip(0.52 + 0.20 * (ratio_01 - 1.08) - 0.25 * (dv0 - 0.25), 0.45, 0.60))
                            rem = 1.0 - w0
                            k1 = s1 / (dv1 ** 0.35)
                            k2 = s2 / (dv2 ** 0.35)
                            norm_weights = [w0, rem * (k1 / (k1 + k2 + 1e-9)), rem * (k2 / (k1 + k2 + 1e-9))]
                        else:
                            bw_slice = base_weights[:n]
                            tot_bw = sum(bw_slice)
                            norm_weights = [w / tot_bw for w in bw_slice]

                        target_alloc = {selected_stks[idx_s]: norm_weights[idx_s] * exposure for idx_s in range(n)}

                        for c_i in list(holdings.keys()):
                            if c_i not in target_alloc:
                                out_px = px_open_arr[in_pos, c_i]
                                cash += holdings[c_i]["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                                del holdings[c_i]

                        cur_val = cash + sum(holdings[c_i]["shares"] * px_open_arr[in_pos, c_i] for c_i in holdings)
                        for c_i, tgt_w in target_alloc.items():
                            if c_i in holdings:
                                op = float(px_open_arr[in_pos, c_i])
                                cur_sh = holdings[c_i]["shares"]
                                cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                                if abs(cur_w - tgt_w) > drift_tol and (cur_val * tgt_w) < (cur_sh * op):
                                    sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                                    cash += sell_sh * op * (1.0 - fee_sell_arr[c_i])
                                    holdings[c_i]["shares"] -= sell_sh

                        buy_orders = []
                        for c_i, tgt_w in target_alloc.items():
                            op = float(px_open_arr[in_pos, c_i])
                            cur_sh = holdings[c_i]["shares"] if c_i in holdings else 0.0
                            cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                            if c_i in holdings and abs(cur_w - tgt_w) <= drift_tol:
                                continue
                            diff_val = (cur_val * tgt_w) - (cur_sh * op)
                            if diff_val > 0 and op > 0:
                                buy_orders.append((c_i, diff_val))

                        for c_i, diff_val in buy_orders:
                            actual_buy = min(cash, diff_val)
                            if actual_buy > 0:
                                op = float(px_open_arr[in_pos, c_i])
                                sh = (actual_buy * (1.0 - fee_buy_arr[c_i])) / op
                                cash -= actual_buy
                                if c_i in holdings:
                                    holdings[c_i]["shares"] += sh
                                else:
                                    holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op}

                    p_idx += 1

                val = cash
                for c_i, hinfo in holdings.items():
                    cur_px = float(px_adj_arr[cur_pos, c_i])
                    if cur_px > hinfo.get("peak_px", 0.0):
                        hinfo["peak_px"] = cur_px
                    val += hinfo["shares"] * cur_px
                daily_equity.loc[current_dt] = val

            return daily_equity

        eq_a = sim_tranche(1)
        eq_b = sim_tranche(22)
        common_idx = eq_a.dropna().index.intersection(eq_b.dropna().index)
        common_idx = common_idx[common_idx >= pd.Timestamp("2005-01-03")]
        eq_d = (eq_a.loc[common_idx] + eq_b.loc[common_idx]) / 1000000.0
        eq_d = eq_d / float(eq_d.iloc[0])

        if goldilocks_qqq_boost > 0.0 or bull_conviction_lev > 1.0:
            raw_r = eq_d.pct_change().fillna(0.0)
            g_mask = pd.Series(goldilocks_bull_mask, index=dates_idx).shift(1).reindex(common_idx).fillna(False)
            q_r = pd.Series(qqq_ret, index=dates_idx).reindex(common_idx).fillna(0.0)
            rf_s = pd.Series(safe_cash_ret, index=dates_idx).reindex(common_idx).fillna(0.0)
            boost_r = raw_r.copy()
            if goldilocks_qqq_boost > 0.0:
                cost = goldilocks_qqq_boost * (rf_s + 0.012 / 252.0)
                boost_r = np.where(g_mask, raw_r + goldilocks_qqq_boost * q_r - cost, raw_r)
            if bull_conviction_lev > 1.0:
                extra = bull_conviction_lev - 1.0
                cost = extra * (rf_s + 0.012 / 252.0)
                boost_r = np.where(g_mask, boost_r * bull_conviction_lev - cost, boost_r)
            eq_d = (1.0 + pd.Series(boost_r, index=common_idx)).cumprod()

        yrs = (eq_d.index[-1] - eq_d.index[0]).days / 365.25
        cagr = ((float(eq_d.iloc[-1]) / float(eq_d.iloc[0])) ** (1.0 / yrs) - 1.0) * 100.0
        mult = float(eq_d.iloc[-1])
        d_mdd = float((eq_d / eq_d.cummax() - 1.0).min()) * 100.0
        m_eq = eq_d.resample("ME").last()
        m_mdd = float((m_eq / m_eq.cummax() - 1.0).min()) * 100.0
        calmar = cagr / abs(m_mdd)
        r = eq_d.pct_change().dropna()
        sharpe = float(r.mean() * 252.0 / (r.std() * np.sqrt(252.0) + 1e-12))

        e_g1 = eq_d.loc[:"2015-12-31"]
        y_g1 = (e_g1.index[-1] - e_g1.index[0]).days / 365.25
        g1 = ((float(e_g1.iloc[-1]) / float(e_g1.iloc[0])) ** (1.0 / y_g1) - 1.0) * 100.0

        e_g2 = eq_d.loc["2016-01-01":]
        y_g2 = (e_g2.index[-1] - e_g2.index[0]).days / 365.25
        g2 = ((float(e_g2.iloc[-1]) / float(e_g2.iloc[0])) ** (1.0 / y_g2) - 1.0) * 100.0

        yr_rets = eq_d.resample("YE").last().pct_change().dropna()
        win_yrs = int((yr_rets > 0).sum())
        tot_yrs = len(yr_rets)

        print(
            f"{name:<68s} | CAGR {cagr:6.2f}% | Mult {mult:8.1f}x | 月MDD {m_mdd:6.2f}% | 日MDD {d_mdd:6.2f}% | Calmar {calmar:4.2f} | Sharpe {sharpe:4.2f} | 勝年 {win_yrs}/{tot_yrs} | G1 {g1:5.2f}% | G2 {g2:5.2f}%"
        )
        return eq_d

    print("-" * 170)
    eq_base = run_chop_engine("0. 基準對照 (減法瘦身 + 凱利凸度，無震盪切換，閒置領短債)", chop_switch_mode="none")
    eq_gld = run_chop_engine("1. 【切換 A：Chop>=3 轉黃金避險】震盪期與減倉資金自動轉入多頭 GLD", chop_switch_mode="gld")
    eq_mr = run_chop_engine("2. 【切換 B：Chop>=3 轉均值回歸】回測月線低吸 + 日頻超跌反彈子引擎", chop_switch_mode="mr")
    eq_gld_mr = run_chop_engine("3. 【切換 C：Chop>=3 黃金避險 + 超跌均值回歸雙軌合體】", chop_switch_mode="gld_mr")
    print("-" * 170)
    eq_all_w = run_chop_engine(
        "4. 🏆【全天候對稱版 A】震盪盤(GLD+均值回歸) × 順風盤(Chop<=1 雙核推進)",
        chop_switch_mode="full_all_weather",
        goldilocks_qqq_boost=0.20,
        bull_conviction_lev=1.18,
    )
    eq_all_tw = run_chop_engine(
        "5. 🏆【全天候對稱版 B】震盪盤(GLD+均值回歸) × 順風雙核 × 台股中小型解封",
        elig_mat=elig_tw_sniper_arr,
        chop_switch_mode="full_all_weather",
        goldilocks_qqq_boost=0.18,
        bull_conviction_lev=1.15,
    )
    print("=" * 170)

    windows = [
        ("2005-2006", "2005-01-03", "2006-12-31"),
        ("2007-2008 (金融海嘯)", "2007-01-01", "2008-12-31"),
        ("2009-2010 (QE震盪)", "2009-01-01", "2010-12-31"),
        ("2011-2012 (歐債洗盤)", "2011-01-01", "2012-12-31"),
        ("2013-2014 (行動網路)", "2013-01-01", "2014-12-31"),
        ("2015-2016 (箱型衰退)", "2015-01-01", "2016-12-31"),
        ("2017-2018 (升息貿易戰)", "2017-01-01", "2018-12-31"),
        ("2019-2020 (輪動熔斷)", "2019-01-01", "2020-12-31"),
        ("2021-2022 (暴力升息熊)", "2021-01-01", "2022-12-31"),
        ("2023-2024 (AI主升段)", "2023-01-01", "2024-12-31"),
        ("2025-2026 (近兩年實況)", "2025-01-01", "2026-11-04"),
    ]
    print("\n📊 【11 個兩年窗口累積報酬對比】檢視震盪乾旱期 (2009-2012, 2015-2016, 2019-2022) 修復幅度：")
    print(f"{'兩年區間':<20} | {'0. 原基準(無切換)':>15} | {'1. 轉黃金(GLD)':>15} | {'2. 轉均值回歸(MR)':>17} | {'3. 雙軌(GLD+MR)':>16} | {'4. 全天候對稱A':>15} | {'5. 全天候+台中小':>16}")
    print("-" * 130)
    for w_label, d0, d1 in windows:
        r0 = (float(eq_base.loc[d0:d1].iloc[-1]) / float(eq_base.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        r1 = (float(eq_gld.loc[d0:d1].iloc[-1]) / float(eq_gld.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        r2 = (float(eq_mr.loc[d0:d1].iloc[-1]) / float(eq_mr.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        r3 = (float(eq_gld_mr.loc[d0:d1].iloc[-1]) / float(eq_gld_mr.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        r4 = (float(eq_all_w.loc[d0:d1].iloc[-1]) / float(eq_all_w.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        r5 = (float(eq_all_tw.loc[d0:d1].iloc[-1]) / float(eq_all_tw.loc[d0:d1].iloc[0]) - 1.0) * 100.0
        print(f"{w_label:<20} | {r0:+14.2f}% | {r1:+14.2f}% | {r2:+16.2f}% | {r3:+15.2f}% | {r4:+14.2f}% | {r5:+15.2f}%")


if __name__ == "__main__":
    main()
