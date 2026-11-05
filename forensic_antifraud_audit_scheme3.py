#!/usr/bin/env python3
"""
forensic_antifraud_audit_scheme3.py
================================================================================
【嚴格打假測試 (Anti-Fraud & Overfitting Forensic Audit)】
針對「方案二 / 方案三」的四大組件逐一進行：
1. 未來函數與成交時點稽核 (T-1 Close 偷看隔夜跳空 vs 嚴格 T+1 Open 含手續費滑價 vs 僅在換倉日配置 QQQ/SPY)
2. 觸發樣本數稽核 (22年 522 次換倉中實際觸發幾次？是否為針對 2012 單一事件過擬合？)
3. 參數擾動敏感度測試 (±10% ~ ±20% 參數高原測試)
4. 前後半場分割測試 (G1: 2005-2015 vs G2: 2016-2026 樣本外一致性)
================================================================================
"""
import numpy as np
import pandas as pd
import study_leading_breadth_reversal as slb

dates_idx = slb.dates_idx
dt_to_pos = slb.dt_to_pos
px_adj_arr = slb.px_adj_arr
px_open_arr = slb.px_open_arr
ma20_arr = slb.ma20_arr
ma60_arr = slb.ma60_arr
ma200_arr = slb.ma200_arr
down_vol20_arr = slb.down_vol20_arr
io20_arr = slb.io20_arr
io5_arr = slb.io5_arr
churn_arr = slb.churn_arr
elig_arr = slb.elig_arr
sec_arr = slb.sec_arr
global_breadth = slb.global_breadth
safe_cash_ret = slb.safe_cash_ret
us10y_series = slb.us10y_series
qqq_bias = slb.qqq_bias
qqq_p = slb.qqq_p
qqq_ma20 = slb.qqq_ma20
qqq_ma60 = slb.qqq_ma60
qqq_ma200 = slb.qqq_ma200
spy_p = slb.spy_p
spy_ma20 = slb.spy_ma20
spy_ma60 = slb.spy_ma60
spy_ma200 = slb.spy_ma200
spy_ret1d = slb.spy_ret1d
qqq_ret1d = slb.qqq_ret1d
fee_buy_arr = slb.fee_buy_arr
fee_sell_arr = slb.fee_sell_arr
base_veto_s1_arr = slb.base_veto_s1_arr
macro_g11 = slb.macro_g11
data4 = slb.data4
br_ma20 = slb.br_ma20
br_ma60 = slb.br_ma60
br20_chg10 = slb.br20_chg10
ys = slb.ys

# =========================================================================
# 打假測試一：稽核「牛市守年線防洗盤」與「20MA/60MA 寬幅衝力」在 22 年換倉日到底觸發幾次？
# =========================================================================
print("=" * 115)
print("【打假測試一：樣本數與單一事件過擬合稽核 (522 次雙梯隊換倉中實際觸發次數)】")
print("=" * 115)

ym_groups = pd.Series(dates_idx, index=dates_idx).groupby([dates_idx.year, dates_idx.month])
rebal_all = []
for day_target in [1, 22]:
    for (y, m), grp in ym_groups:
        sub = grp[grp.dt.day >= day_target]
        rebal_all.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])
rebal_all = pd.DatetimeIndex(sorted(list(set(rebal_all))))
rebal_all = rebal_all[rebal_all >= pd.Timestamp("2005-01-01")]

washout_99_hits = []
washout_100_hits = []
thrust_a_hits = []
thrust_b_hits = []
etf_rebal_hits = []

for t_date in rebal_all:
    t_pos = dt_to_pos[t_date]
    br = float(global_breadth.iloc[t_pos])
    b20 = float(br_ma20.iloc[t_pos])
    b60 = float(br_ma60.iloc[t_pos])
    q_p = float(qqq_p.iloc[t_pos])
    s_p = float(spy_p.iloc[t_pos])
    q_200 = float(qqq_ma200.iloc[t_pos])
    s_200 = float(spy_ma200.iloc[t_pos])
    q_20_60 = q_p > float(qqq_ma20.iloc[t_pos]) and q_p > float(qqq_ma60.iloc[t_pos])
    s_20_60 = s_p > float(spy_ma20.iloc[t_pos]) and s_p > float(spy_ma60.iloc[t_pos])

    if br < 0.30 and (q_p >= q_200 * 0.99) and (s_p >= s_200 * 0.99):
        washout_99_hits.append(t_date.strftime("%Y-%m-%d"))
    if br < 0.30 and (q_p >= q_200) and (s_p >= s_200):
        washout_100_hits.append(t_date.strftime("%Y-%m-%d"))
    if br < 0.50 and (q_p >= q_200 * 0.99) and (s_p >= s_200 * 0.99) and q_20_60 and s_20_60 and b20 >= 0.55:
        thrust_a_hits.append(t_date.strftime("%Y-%m-%d"))
    if br < 0.50 and (b20 >= 0.70 and b60 >= 0.50) and q_20_60 and s_20_60:
        thrust_b_hits.append(t_date.strftime("%Y-%m-%d"))
    if br < 0.50 and q_20_60 and s_20_60:
        etf_rebal_hits.append(t_date.strftime("%Y-%m-%d"))

print(f"  1. [牛市守年線防洗盤 (br<0.30 & QQQ/SPY >= MA200*0.99)] 22年觸發次數: {len(washout_99_hits)} / {len(rebal_all)} 次 -> {washout_99_hits}")
print(f"     ⚠️ 若把 0.99 改為嚴格 1.00 (QQQ/SPY >= MA200) 觸發次數: {len(washout_100_hits)} / {len(rebal_all)} 次 -> {washout_100_hits}")
print(f"  2. [領先寬幅衝力 A (br<0.50 & QQQ/SPY>=MA200 & b20>=55%)] 22年觸發次數: {len(thrust_a_hits)} / {len(rebal_all)} 次 -> {thrust_a_hits}")
print(f"  3. [領先寬幅衝力 B (br<0.50 & b20>=70% & b60>=50%)]       22年觸發次數: {len(thrust_b_hits)} / {len(rebal_all)} 次 -> {thrust_b_hits}")
print(f"  4. [換倉日減倉且 QQQ/SPY 站上 20MA&60MA]                  22年觸發次數: {len(etf_rebal_hits)} / {len(rebal_all)} 次")

# =========================================================================
# 打假測試二：稽核「減倉閒置現金停泊 QQQ/SPY」是否存在「T-1收盤偷看隔夜跳空」與「日頻免手續費摩擦偏誤」？
# =========================================================================
print("\n" + "=" * 115)
print("【打假測試二：嚴格 T+1 Open 成交 + 手續費滑價 vs 原本日頻 Close-to-Close 停泊 QQQ/SPY】")
print("=" * 115)

# Get QQQ and SPY Open prices if available, or T+1 lag (cur_pos - 2 signal for cur_pos Close-to-Close return)
# Wait: if signal is observed at day t-1 Close, and you enter at day t Open, your return on day t is Open(t)->Close(t),
# or if we only have Close prices for QQQ/SPY in data4["px_adj"], a full 1-day execution delay means signal at cur_pos - 2 Close earns cur_pos Close-to-Close return!
# Even better: what if we ONLY allocate to QQQ/SPY on the Semi-Monthly Rebalance Date (t_date signal -> t_in entry, holding for the half-month period with 5 bps buy/sell fee)?
def run_strict_audit_sim(
    score_matrix,
    etf_mode="none", # "none", "flawed_t1_close", "strict_t2_lag_with_fee", "rebal_only_with_fee"
    use_washout_and_thrust=False,
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
        in_etf_prev = False
        rebal_etf_active = False

        for current_dt in all_sim_dates:
            cur_pos = dt_to_pos[current_dt]
            if cash > 0:
                if etf_mode == "flawed_t1_close":
                    q_ok = float(qqq_p.iloc[cur_pos - 1]) > float(qqq_ma20.iloc[cur_pos - 1]) and float(qqq_p.iloc[cur_pos - 1]) > float(qqq_ma60.iloc[cur_pos - 1])
                    s_ok = float(spy_p.iloc[cur_pos - 1]) > float(spy_ma20.iloc[cur_pos - 1]) and float(spy_p.iloc[cur_pos - 1]) > float(spy_ma60.iloc[cur_pos - 1])
                    if q_ok and s_ok:
                        idx_r = 0.5 * float(qqq_ret1d.iloc[cur_pos]) + 0.5 * float(spy_ret1d.iloc[cur_pos])
                        cash *= 1.0 + idx_r
                    else:
                        cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])
                elif etf_mode == "strict_t2_lag_with_fee":
                    # Signal at cur_pos - 2 Close, executed at cur_pos - 1 Close (1 full day delay so zero overnight lookahead!) + 5 bps fee on every switch!
                    q_ok = float(qqq_p.iloc[cur_pos - 2]) > float(qqq_ma20.iloc[cur_pos - 2]) and float(qqq_p.iloc[cur_pos - 2]) > float(qqq_ma60.iloc[cur_pos - 2])
                    s_ok = float(spy_p.iloc[cur_pos - 2]) > float(spy_ma20.iloc[cur_pos - 2]) and float(spy_p.iloc[cur_pos - 2]) > float(spy_ma60.iloc[cur_pos - 2])
                    now_etf = (q_ok and s_ok)
                    if now_etf != in_etf_prev:
                        cash *= (1.0 - 0.0005) # 5 bps transaction fee on switch
                        in_etf_prev = now_etf
                    if now_etf:
                        idx_r = 0.5 * float(qqq_ret1d.iloc[cur_pos]) + 0.5 * float(spy_ret1d.iloc[cur_pos])
                        cash *= 1.0 + idx_r
                    else:
                        cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])
                elif etf_mode == "rebal_only_with_fee":
                    # Only decided on rebalance date t_date, executed at t_in! No daily watching!
                    if rebal_etf_active:
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

                # Check rebalance-day ETF status (decided at t_date Close, applied from t_in onward)
                if etf_mode == "rebal_only_with_fee":
                    q_ok_reb = float(qqq_p.iloc[t_pos]) > float(qqq_ma20.iloc[t_pos]) and float(qqq_p.iloc[t_pos]) > float(qqq_ma60.iloc[t_pos])
                    s_ok_reb = float(spy_p.iloc[t_pos]) > float(spy_ma20.iloc[t_pos]) and float(spy_p.iloc[t_pos]) > float(spy_ma60.iloc[t_pos])
                    new_reb_etf = (q_ok_reb and s_ok_reb)
                    if new_reb_etf != rebal_etf_active and cash > 0:
                        cash *= (1.0 - 0.0005)
                    rebal_etf_active = new_reb_etf

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
                else:
                    top5_neg_io20, top5_neg_io5, top5_avg_io20 = 0, 0, 0.0

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

                if use_washout_and_thrust:
                    b20 = float(br_ma20.iloc[t_pos])
                    b60 = float(br_ma60.iloc[t_pos])
                    q_above_200 = float(qqq_p.iloc[t_pos]) >= float(qqq_ma200.iloc[t_pos]) * 0.99
                    s_above_200 = float(spy_p.iloc[t_pos]) >= float(spy_ma200.iloc[t_pos]) * 0.99
                    q_above_20_60 = float(qqq_p.iloc[t_pos]) > float(qqq_ma20.iloc[t_pos]) and float(qqq_p.iloc[t_pos]) > float(qqq_ma60.iloc[t_pos])
                    s_above_20_60 = float(spy_p.iloc[t_pos]) > float(spy_ma20.iloc[t_pos]) and float(spy_p.iloc[t_pos]) > float(spy_ma60.iloc[t_pos])
                    if br < 0.30 and exposure == 0.0 and q_above_200 and s_above_200 and top5_avg_io20 > -0.02:
                        exposure = 0.85 if b20 >= 0.45 else 0.65
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

def print_metrics(label, eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr = (float(eq.iloc[-1]) ** (1.0 / yrs) - 1.0) * 100
    m_mdd = float((eq.resample("ME").last() / eq.resample("ME").last().cummax() - 1.0).min()) * 100
    d_mdd = float((eq / eq.cummax() - 1.0).min()) * 100
    calmar = (cagr / 100.0) / abs(m_mdd / 100.0)
    # Split G1 (2005-2015) and G2 (2016-2026)
    eq_g1 = eq[eq.index <= pd.Timestamp("2015-12-31")]
    eq_g2 = eq[eq.index >= pd.Timestamp("2016-01-01")]
    g1_cagr = ((float(eq_g1.iloc[-1]) / float(eq_g1.iloc[0])) ** (365.25 / (eq_g1.index[-1] - eq_g1.index[0]).days) - 1.0) * 100
    g2_cagr = ((float(eq_g2.iloc[-1]) / float(eq_g2.iloc[0])) ** (365.25 / (eq_g2.index[-1] - eq_g2.index[0]).days) - 1.0) * 100
    print(f"  {label:<66s} | CAGR={cagr:5.2f}% ({float(eq.iloc[-1]):7,.1f}x) | M_MDD={m_mdd:6.2f}% | Calmar={calmar:4.2f} | G1(05-15)={g1_cagr:5.2f}% | G2(16-26)={g2_cagr:5.2f}%")

eq_base = run_strict_audit_sim(slb.base_score_arr, "none", False)
eq_top10 = run_strict_audit_sim(slb.champ_score_arr, "none", False)
eq_wash_only = run_strict_audit_sim(slb.champ_score_arr, "none", True)
eq_etf_flawed = run_strict_audit_sim(slb.champ_score_arr, "flawed_t1_close", True)
eq_etf_strict_t2 = run_strict_audit_sim(slb.champ_score_arr, "strict_t2_lag_with_fee", True)
eq_etf_rebal_only = run_strict_audit_sim(slb.champ_score_arr, "rebal_only_with_fee", True)

print_metrics("0. 目前線上基準 (1. 去蕪存菁・純股票核心版)", eq_base)
print_metrics("1. 純股票 + 動能前十強雙特徵 (5,023筆大樣本驗證)", eq_top10)
print_metrics("2. 純股票 + 動能前十強 + 領先寬幅衝力/守年線防洗盤", eq_wash_only)
print_metrics("3A. 方案三(原寫法): T-1收盤訊號吃到T隔夜跳空 + 日頻免手續費", eq_etf_flawed)
print_metrics("3B. 方案三(打假後): 嚴格延遲1整天成交 + 每次切換扣 5bps 摩擦成本", eq_etf_strict_t2)
print_metrics("3C. 方案三(僅換倉日決定): 半月度換倉日才決定停泊 QQQ/SPY + 扣手續費", eq_etf_rebal_only)
