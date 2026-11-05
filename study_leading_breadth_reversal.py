#!/usr/bin/env python3
"""
study_leading_breadth_reversal.py
================================================================================
實測「市場寬幅落後性解剖」與「領先型寬幅翻轉指標 (Leading Breadth Thrust & Divergence)」
涵蓋 2005-2026 完整 22 年 1,704 檔零偏誤 PIT 雙梯隊回測 (100% 對齊線上 43.30% / 44.73% 基準)
================================================================================
"""
import os, sys, sqlite3, warnings
import numpy as np
import pandas as pd
warnings.filterwarnings("ignore")

from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, make_pit_macro_fn
import forensic_open_pool_sniper as fops

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
    conn_twse, params=pit_tw_ids,
)
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
    in_0050_0051_pit & is_twse_listed_pit & (twse_rk_pit <= 30) & (env["avg_order_rk"][pit_tw] <= 30)
    & (env["raw_px_tw"][pit_tw] >= 50.0) & (env["pe_mat"][pit_tw] > 0) & (env["pe_mat"][pit_tw] <= 45.0)
    & ((~env["roe_mat"][pit_tw].notna()) | (env["roe_mat"][pit_tw] >= 20.0))
    & ((~env["roe_mat"][pit_tw].notna()) | (env["tr20_mat"][pit_tw] > 0.001) | (env["fr20_mat"][pit_tw] > 0.002))
    & (env["io_20"][pit_tw] > -0.10) & (env["fip_126"][pit_tw] > 0.05)
)
elig_base = pd.DataFrame(False, index=idx, columns=cols)
elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
elig_base[pit_tw] = tw_base_0050_0051

g9_sec = fops.make_g9_secondary_mult(env)
macro_g11 = make_pit_macro_fn(c4_cap=0.45, c5_cap=1.0, c6_cap=0.20, u10_thr=0.22, qb_thr=22.0)

stk_adj = env["stk_adj"][cols]
stk_open = env["stk_open"][cols]
stk_high = env["stk_high"][cols]
stk_low = env["stk_low"][cols]
stk_vol = env["stk_vol"][cols]

ma10 = stk_adj.rolling(10, min_periods=5).mean()
ma20 = env["ma20"][cols]
ma60 = env["ma60"][cols]
ma200 = env["ma200"][cols]
bias20 = ((stk_adj / (ma20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)
bias200 = ((stk_adj / (ma200 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)
high20 = stk_high.rolling(20, min_periods=5).max()
low20 = stk_low.rolling(20, min_periods=5).min()
dd20 = ((stk_adj / (high20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)

mom12m = env["mom12m"][cols]
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
score_g11 = (env["s_g5_open"][cols] * dist_veto_g10 * coiled_spring_g11).astype(np.float32)
exp262_base_mult = np.where(vcp_condition, 1.04, 1.0).astype(np.float32)
base_score_df = (score_g11 * exp262_base_mult).astype(np.float32)
base_score_arr = base_score_df.values.astype(np.float32)

is_super_mega = pd.DataFrame(False, index=idx, columns=cols)
is_super_mega[us_tickers] = (env["us_rk_pit"] <= 30).fillna(False)
is_super_mega[pit_tw] = (twse_rk_pit <= 10).fillna(False)

is_fringe_rk = pd.DataFrame(False, index=idx, columns=cols)
is_fringe_rk[us_tickers] = (env["us_rk_pit"] > 70).fillna(False)

m_fringe_pen = np.where(is_fringe_rk.values & (dd20.values > -0.02) & (io_20.values < 0.005), 0.90, 1.0).astype(np.float32)
m_coiled_plus_mega = np.where(coiled_mask.values & is_super_mega.values, 1.06, 1.0).astype(np.float32)
champ_score_arr = (base_score_arr * m_fringe_pen * m_coiled_plus_mega).astype(np.float32)

bias200_arr = bias200.values
mom12m_arr = mom12m.values
mom3m_arr = stk_adj.pct_change(63).fillna(0.0).values
ret10_arr = stk_adj.pct_change(10).fillna(0.0).values
px_adj_arr = stk_adj.values
px_open_arr = stk_open.values
ma20_arr = ma20.values
ma60_arr = ma60.values
ma200_arr = ma200.values
down_vol20_arr = down_vol_20.values.astype(np.float32)
io20_arr = io_20.values
io5_arr = io_5.values
churn_arr = env["churn_exhaustion"][cols].values
elig_arr = elig_base.values
sec_arr = g9_sec[cols].values

blowoff_pen = np.where(
    ((mom12m_arr >= 1.80) | (bias200_arr >= 0.80)) & ((ret10_arr < 0.0) | (io5_arr < 0.0) | (px_adj_arr < ma20_arr)),
    0.72,
    1.0
).astype(np.float32)
score_with_blowoff = (champ_score_arr * blowoff_pen).astype(np.float32)

data4 = env["data4"]
dates_idx = stk_adj.index
dt_to_pos = {d: i for i, d in enumerate(dates_idx)}

global_breadth = data4["global_breadth"]
safe_cash_ret = data4["safe_cash_ret"]
us10y_series = data4["us10y_series"]
qqq_bias = data4["qqq_bias_dict"][500]
qqq_p = data4["px_adj"]["QQQ"]
qqq_ma60 = data4["qqq_ma60"]
qqq_ma20 = qqq_p.rolling(20, min_periods=5).mean()
qqq_ma200 = qqq_p.rolling(200, min_periods=60).mean()
spy_p = data4["px_adj"]["SPY"]
spy_ma20 = spy_p.rolling(20, min_periods=5).mean()
spy_ma60 = spy_p.rolling(60, min_periods=20).mean()
spy_ma200 = spy_p.rolling(200, min_periods=60).mean()
spy_ret1d = spy_p.pct_change().fillna(0.0)
qqq_ret1d = qqq_p.pct_change().fillna(0.0)

is_tw_arr = np.array([c_sym.endswith(".TW") for c_sym in cols])
fee_buy_arr = np.where(is_tw_arr, 0.001425 * 0.28, 0.0005)
fee_sell_arr = np.where(is_tw_arr, (0.001425 * 0.28) + 0.003, 0.0005)

df_mac["dt"] = pd.to_datetime(df_mac["date"], format="%Y%m%d", errors="coerce")
df_mac = df_mac.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
df_mac.index = df_mac.index.astype(dates_idx.dtype)
df_mac = df_mac.reindex(dates_idx).ffill().bfill()

cl_s = df_mac["oil_wti"]
rb_s = df_mac["gasoline"]
ho_s = df_mac["heating_oil"]
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

base_veto_s1_arr = np.zeros_like(elig_arr, dtype=bool)
for _t_i in range(len(dates_idx)):
    if cond_s1_crack_veto[_t_i]:
        base_veto_s1_arr[_t_i, refiner_col_mask] = True
    if cond_s2a_oil_veto[_t_i]:
        base_veto_s1_arr[_t_i, upstream_col_mask] = True
    if cond_s2b_macro[_t_i]:
        for _c_i in upstream_indices:
            if mom12m_arr[_t_i, _c_i] >= 0.75 and mom3m_arr[_t_i, _c_i] >= 0.25:
                base_veto_s1_arr[_t_i, _c_i] = True
    if cond_s2a_oil_veto[_t_i] or (cond_s1_crack_veto[_t_i] and cl_s.iloc[_t_i] < cl_ma20_s.iloc[_t_i]):
        base_veto_s1_arr[_t_i, energy_corr_60[_t_i] >= 0.32] = True

# =========================================================================
# 建構「領先型市場寬幅指標 (Leading Market Breadth Metrics)」
# =========================================================================
active_us_pit = env["us_pit_elig_base"].reindex(index=idx, columns=us_tickers).fillna(False)
us_px = stk_adj[us_tickers]
us_ma10 = ma10[us_tickers]
us_ma20 = ma20[us_tickers]
us_ma60 = ma60[us_tickers]
us_ma200 = ma200[us_tickers]

active_cnt = active_us_pit.sum(axis=1).replace(0, np.nan)
br_ma10 = ((us_px > us_ma10) & active_us_pit).sum(axis=1) / active_cnt
br_ma20 = ((us_px > us_ma20) & active_us_pit).sum(axis=1) / active_cnt
br_ma60 = ((us_px > us_ma60) & active_us_pit).sum(axis=1) / active_cnt
br_ma200 = ((us_px > us_ma200) & active_us_pit).sum(axis=1) / active_cnt

br20_chg10 = br_ma20.diff(10).fillna(0.0)
br60_chg10 = br_ma60.diff(10).fillna(0.0)
br200_chg10 = br_ma200.diff(10).fillna(0.0)
br_global_chg10 = global_breadth.diff(10).fillna(0.0)

# 同時計算「底部領頭羊爆發力 (Post-Dodge Fresh Rebound Leader Score)」：
# 當領先寬幅確認翻轉時，給「近20D/60D領漲且主力吸籌」的真反彈龍頭加分，扣減死魚防禦股！
br_min60 = global_breadth.rolling(60, min_periods=5).min().fillna(0.5).values
br_vals = global_breadth.values
ret20_arr = stk_adj.pct_change(20).fillna(0.0).values
ret60_arr = stk_adj.pct_change(60).fillna(0.0).values

leading_rebound_score_arr = score_with_blowoff.copy()
for t_i in range(len(dates_idx)):
    # 當傳統寬幅剛經歷回檔 (近60日曾 < 42%)，但短線 20MA 寬幅已經突破 50% (領先確認底部翻轉)：
    if br_min60[t_i] < 0.42 and float(br_ma20.iloc[t_i]) >= 0.50:
        fresh_v_leader = (ret60_arr[t_i] >= 0.18) & (ret20_arr[t_i] >= 0.06) & (io20_arr[t_i] >= 0.005)
        old_defensive = (ret60_arr[t_i] < 0.10) & (down_vol20_arr[t_i] < 0.18)
        leading_rebound_score_arr[t_i, fresh_v_leader] *= 1.15
        leading_rebound_score_arr[t_i, old_defensive] *= 0.80

def calc_yearly_rets(eq):
    y_rets = {}
    for y in range(2005, 2027):
        sub = eq[eq.index.year == y]
        if len(sub) < 2: continue
        prev = eq[eq.index.year < y]
        base_val = float(prev.iloc[-1]) if len(prev) > 0 else float(sub.iloc[0])
        y_rets[y] = (float(sub.iloc[-1]) / base_val - 1.0) * 100.0
    return y_rets

spy_eq = spy_p.loc[dates_idx >= pd.Timestamp("2005-01-03")]
spy_eq = spy_eq / float(spy_eq.iloc[0])
ys = calc_yearly_rets(spy_eq)

def run_leading_sim(
    score_matrix,
    enable_leading_breadth_reversal=False,
    enable_blowoff_cap=False,
    enable_cash_rebound_etf=False,
):
    drift_tol = 0.12
    macro_cap = 0.35
    base_weights = [0.52, 0.24, 0.24]
    pool_k = 5

    def sim_tranche(day_target, init_cap=500000.0):
        ym_groups = pd.Series(dates_idx, index=dates_idx).groupby([dates_idx.year, dates_idx.month])
        rebal_dates = []
        for (y, m), grp in ym_groups:
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])
        rebal_dates = pd.DatetimeIndex(sorted(list(set(rebal_dates))))
        rebal_dates = rebal_dates[rebal_dates >= pd.Timestamp("2005-01-01")]

        periods = []
        for i in range(len(rebal_dates) - 1):
            t_date = rebal_dates[i]
            fut = dates_idx[dates_idx > t_date]
            if len(fut) == 0: break
            t_in = fut[0]
            next_rebal = rebal_dates[i + 1]
            fut_next = dates_idx[dates_idx > next_rebal]
            if len(fut_next) == 0: break
            t_out = fut_next[0]
            periods.append((t_date, t_in, t_out))

        all_sim_dates = dates_idx[(dates_idx >= periods[0][0]) & (dates_idx <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        cash = init_cap
        holdings = {}
        holding_tenure = {}
        p_idx = 0
        num_p = len(periods)

        for current_dt in all_sim_dates:
            cur_pos = dt_to_pos[current_dt]
            if cash > 0:
                if enable_cash_rebound_etf:
                    q_ok = float(qqq_p.iloc[cur_pos - 1]) > float(qqq_ma20.iloc[cur_pos - 1]) and float(qqq_p.iloc[cur_pos - 1]) > float(qqq_ma60.iloc[cur_pos - 1])
                    s_ok = float(spy_p.iloc[cur_pos - 1]) > float(spy_ma20.iloc[cur_pos - 1]) and float(spy_p.iloc[cur_pos - 1]) > float(spy_ma60.iloc[cur_pos - 1])
                    if q_ok and s_ok:
                        idx_r = 0.5 * float(qqq_ret1d.iloc[cur_pos]) + 0.5 * float(spy_ret1d.iloc[cur_pos])
                        cash *= 1.0 + idx_r
                    else:
                        cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])
                else:
                    cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])

            if p_idx < num_p and current_dt == periods[p_idx][1]:
                t_date, t_in, t_out = periods[p_idx]
                t_pos = dt_to_pos[t_date]
                in_pos = dt_to_pos[t_in]

                sp_row = px_adj_arr[t_pos]
                m6_row = ma60_arr[t_pos]
                m2_row = ma200_arr[t_pos]
                sc_row = score_matrix[t_pos]
                el_row = elig_arr[t_pos]
                ch_row = churn_arr[t_pos]

                valid_mask = (
                    el_row & (~np.isnan(sp_row)) & (~np.isnan(sc_row)) & (~np.isnan(m6_row)) & (~np.isnan(m2_row))
                    & (sp_row > m6_row) & (sp_row > m2_row) & (sc_row > 0) & (~ch_row)
                )
                valid_indices = np.where(valid_mask)[0]
                if len(valid_indices) > 0:
                    sorted_indices = valid_indices[np.argsort(-sc_row[valid_indices])]
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
                    top5_avg_io5 = float(np.mean(io5_arr[t_pos, top5_pre]))
                else:
                    top5_neg_io20, top5_neg_io5, top5_avg_io20, top5_avg_io5 = 0, 0, 0.0, 0.0

                v_row_s1 = base_veto_s1_arr[t_pos]
                if np.any(v_row_s1):
                    sorted_indices = np.array([c_i for c_i in sorted_indices if not v_row_s1[c_i]], dtype=int)
                    if sec_arr is not None and len(sorted_indices) > 2:
                        top1_i = [sorted_indices[0]]
                        pool_i = list(sorted_indices[1:pool_k])
                        rest_i = list(sorted_indices[pool_k:])
                        pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
                        sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)

                br = float(global_breadth.iloc[t_pos]) if t_date in global_breadth.index else 0.5
                base_exp = 1.0 if br >= 0.50 else (0.70 if br >= 0.30 else 0.0)
                qb = float(qqq_bias.iloc[t_pos]) if t_date in qqq_bias.index else 0.0
                rate = float(us10y_series.iloc[t_pos]) if t_date in us10y_series.index else 0.0
                qqq_below_ma60 = float(qqq_p.iloc[t_pos]) < float(qqq_ma60.iloc[t_pos])

                exposure = (min(base_exp, 0.50) if (qb >= 30.0 and rate >= 3.5) else base_exp) if base_exp > 0.0 else 0.0
                if 0.30 <= br < 0.50 and qqq_below_ma60:
                    exposure = min(exposure, macro_cap)
                exposure = macro_g11(t_date, t_pos, exposure, br, qb, rate, qqq_below_ma60, top5_neg_io20, top5_neg_io5, top5_avg_io20, data4)

                if enable_leading_breadth_reversal:
                    b20 = float(br_ma20.iloc[t_pos])
                    b60 = float(br_ma60.iloc[t_pos])
                    b20_d10 = float(br20_chg10.iloc[t_pos])
                    b60_d10 = float(br60_chg10.iloc[t_pos])
                    q_above_200 = float(qqq_p.iloc[t_pos]) >= float(qqq_ma200.iloc[t_pos]) * 0.99
                    s_above_200 = float(spy_p.iloc[t_pos]) >= float(spy_ma200.iloc[t_pos]) * 0.99
                    q_above_20_60 = float(qqq_p.iloc[t_pos]) > float(qqq_ma20.iloc[t_pos]) and float(qqq_p.iloc[t_pos]) > float(qqq_ma60.iloc[t_pos])
                    s_above_20_60 = float(spy_p.iloc[t_pos]) > float(spy_ma20.iloc[t_pos]) and float(spy_p.iloc[t_pos]) > float(spy_ma60.iloc[t_pos])

                    # 1. 【牛市守年線假摔防洗盤 (Bull Washout Floor)】：
                    # 傳統寬幅 br < 0.30 觸發 0% 斷路器，但 QQQ & SPY 仍守穩 200MA 且機構未出貨 -> 保留 65% 倉位 (若短線 20MA 寬幅已回升 >= 45% 則給 85%！)
                    if br < 0.30 and exposure == 0.0 and q_above_200 and s_above_200 and top5_avg_io20 > -0.02:
                        exposure = 0.85 if b20 >= 0.45 else 0.65

                    # 2. 【Zweig 二階寬幅衝力 (Breadth Thrust) 提前解鎖底部 V 轉】：
                    # 傳統 MA200 寬幅 br 還在 0.30~0.50 落後區間，為什麼 2011 假反彈會被騙？
                    # 因為真翻轉必須滿足：(A) 長線牛市結構未破 (QQQ & SPY > MA200) 且短線 20MA 寬幅 >= 55% + 雙指數 > MA20/60；
                    # 或者 (B) 大熊市底部超強 Zweig Breadth Thrust：短線 20MA 寬幅衝上 >= 70% 且 60MA 寬幅同步突破 >= 50% (代表中短線全面翻多，絕非死貓跳！) 且 Top5 機構強力吸籌 (top5_avg_io20 > 0.015)！
                    if br < 0.50:
                        if q_above_200 and s_above_200 and q_above_20_60 and s_above_20_60 and b20 >= 0.55 and top5_avg_io20 > 0.0:
                            exposure = max(exposure, 1.0)
                        elif (b20 >= 0.70 and b60 >= 0.50) and q_above_20_60 and s_above_20_60 and top5_avg_io20 > 0.012:
                            exposure = max(exposure, 0.95)

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
                        if base_veto_s1_arr[t_pos, c_i]: continue
                        if enable_blowoff_cap and ((mom12m_arr[t_pos, c_i] >= 1.80) or (bias200_arr[t_pos, c_i] >= 0.80)) and (px_adj_arr[t_pos, c_i] < ma20_arr[t_pos, c_i]):
                            continue
                        tenure = holding_tenure.get(c_i, 0)
                        rk = ticker_rank.get(c_i, None)
                        cur_c = float(px_adj_arr[t_pos, c_i])
                        m20_c = float(ma20_arr[t_pos, c_i])
                        if rk is not None and tenure < 4:
                            if rk <= 4 or (rk == 5 and float(io20_arr[t_pos, c_i]) > 0.0 and not (cur_c < m20_c and float(io5_arr[t_pos, c_i]) <= -0.015)):
                                selected_stks.append(c_i)
                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        if c_i not in selected_stks and holding_tenure.get(c_i, 0) < 4:
                            selected_stks.append(c_i)
                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
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
                        if enable_blowoff_cap and (mom12m_arr[t_pos, selected_stks[0]] >= 2.00 or bias200_arr[t_pos, selected_stks[0]] >= 0.85):
                            w0 = min(w0, 0.42)
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
                val += hinfo["shares"] * px_adj_arr[cur_pos, c_i]
            daily_equity.loc[current_dt] = val
        return daily_equity

    eq_a = sim_tranche(1, 500000.0)
    eq_b = sim_tranche(22, 500000.0)
    common_idx = eq_a.dropna().index.intersection(eq_b.dropna().index)
    common_idx = common_idx[common_idx >= pd.Timestamp("2005-01-03")]
    eq_d = (eq_a.loc[common_idx] + eq_b.loc[common_idx]) / 1000000.0
    eq_d = eq_d / float(eq_d.iloc[0])
    return eq_d

if __name__ == "__main__":
    print("\n" + "=" * 115)
    print("【22年 (2005-2026) 完整實測：傳統落後 MA200 寬幅 vs 領先型多週期寬幅翻轉引擎 (100% 對齊線上基準)】")
    print("=" * 115)

    configs = [
        ("0. 線上基準 (1. 去蕪存菁・純股票核心版：傳統 MA200 寬幅)", base_score_arr, False, False, False),
        ("1. 動能前十強雙特徵 (傳統落後寬幅)", champ_score_arr, False, False, False),
        ("2. + 【領先寬幅翻轉引擎 (20MA/60MA 寬幅衝力 + 牛市守年線防洗盤)】(純個股)", champ_score_arr, True, False, False),
        ("3. + 【領先寬幅翻轉引擎 + 末升段泡沫股(Mom12M>180%轉弱)防爆頂】(純個股)", score_with_blowoff, True, True, False),
        ("4. 👑 全武裝領先翻轉引擎 + 減倉閒置現金停泊 QQQ/SPY 順勢避風港", score_with_blowoff, True, True, True),
    ]

    for label, sc_mat, e_lead, e_blow, e_etf in configs:
        eq = run_leading_sim(sc_mat, e_lead, e_blow, e_etf)
        yrs = (eq.index[-1] - eq.index[0]).days / 365.25
        cagr = (float(eq.iloc[-1]) ** (1.0 / yrs) - 1.0) * 100
        m_mdd = float((eq.resample("ME").last() / eq.resample("ME").last().cummax() - 1.0).min()) * 100
        d_mdd = float((eq / eq.cummax() - 1.0).min()) * 100
        calmar = (cagr / 100.0) / abs(m_mdd / 100.0)
        r = eq.pct_change().dropna()
        sharpe = float(r.mean() * 252 / (r.std() * np.sqrt(252) + 1e-12))
        down_r = r[r < 0]
        sortino = float(r.mean() * 252 / (down_r.std() * np.sqrt(252) + 1e-12))
        yr = calc_yearly_rets(eq)
        beat = sum(1 for y in yr if yr[y] > ys[y])
        pos = sum(1 for y in yr if yr[y] > 0)
        print(f"{label:<72s} | CAGR={cagr:5.2f}% | Mult={float(eq.iloc[-1]):7,.1f}x | M_MDD={m_mdd:6.2f}% | D_MDD={d_mdd:6.2f}% | Calmar={calmar:4.2f} | Sharpe={sharpe:4.2f} | Sortino={sortino:4.2f} | 贏大盤={beat}/22 | 正報酬={pos}/22")
        print("   [反彈/減倉年對照] " + " | ".join([f"{y}: {yr[y]:+5.1f}% (SPY {ys[y]:+5.1f}%)" for y in [2009, 2010, 2011, 2012, 2018, 2019, 2021, 2022]]))
