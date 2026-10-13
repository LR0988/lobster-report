import os
import json
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close, volume FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()
px_vol = df.pivot(index='date', columns='ticker', values='volume').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
px_vol = px_vol.reindex(common_dates).fillna(0)
sov_adj = sov_adj.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()

mom2w = px_adj.pct_change(10)
mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom12m = px_adj.pct_change(252)

sov_ma200 = sov_adj.rolling(200).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

# FIP
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# Convexity
downside_ret = px_daily_ret.clip(upper=0)
upside_ret = px_daily_ret.clip(lower=0)
upside_vol = upside_ret.rolling(60).std()
downside_vol = downside_ret.rolling(60).std().replace(0, 1e-6)
stk_convexity = (upside_vol / (downside_vol + 1e-6)).fillna(1.0)

# Volume Churn Filter
vol_ma60 = px_vol.rolling(60).mean()
vol_5d_mean = px_vol.rolling(5).mean()
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

mom_std = ((0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat))[stock_tickers]
mom_fast = ((0.45 * mom12m + 0.35 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat))[stock_tickers]

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

def simulate_single_tranche(
    rebal_mode='month_end', # 'month_end' or int day (1..30)
    initial_capital=1000000.0,
    breadth_th=(0.60, 0.40),
    use_convexity=True,
    use_churn_filter=False,
    mom_mat=mom_std
):
    rebal_dates = []
    if rebal_mode == 'month_end':
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            rebal_dates.append(grp.iloc[-1])
    else:
        day_target = int(rebal_mode)
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])

    periods = []
    for i in range(len(rebal_dates) - 1):
        t_date = rebal_dates[i]
        fut = px_adj.index[px_adj.index > t_date]
        if len(fut) == 0: break
        t_in = fut[0]
        next_rebal = rebal_dates[i + 1]
        fut_next = px_adj.index[px_adj.index > next_rebal]
        if len(fut_next) == 0: break
        t_out = fut_next[0]
        periods.append((t_date, t_in, t_out))

    friction = 0.0015
    capital = initial_capital
    current_holdings = {}
    cash = capital
    holding_tenure = {}
    
    all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
    daily_equity = pd.Series(index=all_sim_dates, dtype=float)
    
    period_eq = [initial_capital]
    period_dates = [periods[0][0]]
    total_turnover = 0.0
    trade_count = 0
    
    base_weights = [0.40, 0.30, 0.30]
    p_idx = 0
    num_p = len(periods)
    bull_th, mid_th = breadth_th
    
    for t_idx, current_dt in enumerate(all_sim_dates):
        if p_idx < num_p and current_dt == periods[p_idx][1]:
            t_date, t_in, t_out = periods[p_idx]
            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open.loc[t_in, s]
                
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            if br >= bull_th: exposure = 1.0
            elif br >= mid_th: exposure = 0.70
            else: exposure = 0.0

            valid_stks = []
            for s in stock_tickers:
                sp = px_adj.loc[t_date, s]
                m6 = ma60.loc[t_date, s]
                m2 = ma200.loc[t_date, s]
                sc = mom_mat.loc[t_date, s]
                cond = pd.notna(sp) and pd.notna(sc) and pd.notna(m6) and (sp > m6) and (sp > m2 if pd.notna(m2) else True) and (sc > 0)
                if cond:
                    if use_churn_filter:
                        if churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False:
                            continue
                    cx = stk_convexity.loc[t_date, s] if s in stk_convexity.columns and pd.notna(stk_convexity.loc[t_date, s]) else 1.0
                    valid_stks.append((s, sc, cx))
            valid_stks.sort(key=lambda x: x[1], reverse=True)
            ranked_tickers = [x[0] for x in valid_stks]
            ticker_info = {x[0]: (idx + 1, x[1], x[2]) for idx, x in enumerate(valid_stks)}

            current_weights = {}
            if cur_val > 0:
                for s, sh in current_holdings.items():
                    current_weights[s] = (sh * px_open.loc[t_in, s]) / cur_val

            if exposure <= 0 or len(valid_stks) == 0:
                target_alloc = {'CASH': 1.0}
                holding_tenure = {}
            else:
                selected_stks = []
                for s in list(current_holdings.keys()):
                    tenure = holding_tenure.get(s, 0)
                    info = ticker_info.get(s, None)
                    if info is not None and info[0] <= 5 and tenure < 4:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    tenure = holding_tenure.get(s, 0)
                    if s not in selected_stks and tenure < 4:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    if s not in selected_stks:
                        selected_stks.append(s)

                n = min(3, len(selected_stks))
                selected_stks = selected_stks[:n]
                holding_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}

                bw_slice = base_weights[:n]
                tot_bw = sum(bw_slice)
                bw_slice = [w / tot_bw for w in bw_slice]

                if use_convexity:
                    skews = [ticker_info[s][2] for s in selected_stks]
                    comb_w = [bw * sk for bw, sk in zip(bw_slice, skews)]
                    tot_cw = sum(comb_w)
                    norm_weights = [cw / tot_cw for cw in comb_w]
                else:
                    norm_weights = bw_slice

                raw_target_alloc = {selected_stks[idx]: norm_weights[idx] * exposure for idx in range(n)}

                target_alloc = {}
                remaining_weight = exposure
                unadjusted_stks = []

                for s in selected_stks:
                    tgt_w = raw_target_alloc[s]
                    cur_w = current_weights.get(s, 0.0)
                    if s in current_holdings and abs(cur_w - tgt_w) <= 0.05:
                        target_alloc[s] = cur_w
                        remaining_weight -= cur_w
                    else:
                        unadjusted_stks.append((s, tgt_w))

                if len(unadjusted_stks) > 0:
                    tot_unadj = sum(x[1] for x in unadjusted_stks)
                    for s, tgt_w in unadjusted_stks:
                        target_alloc[s] = max(0.0, remaining_weight * (tgt_w / tot_unadj)) if tot_unadj > 0 else 0.0

                if sum(target_alloc.values()) < 1.0:
                    target_alloc['CASH'] = 1.0 - sum(target_alloc.values())

            all_syms = set(list(current_weights.keys()) + list(target_alloc.keys()))
            turnover = sum(abs(target_alloc.get(s, 0.0) - current_weights.get(s, 0.0)) for s in all_syms if s != 'CASH')
            for s in all_syms:
                if s != 'CASH' and abs(target_alloc.get(s, 0.0) - current_weights.get(s, 0.0)) > 0.001:
                    trade_count += 1
            total_turnover += turnover / 2.0
            fee = (turnover / 2.0) * friction * cur_val
            net_val = cur_val - fee

            current_holdings = {}
            cash = net_val * target_alloc.get('CASH', 0.0)
            for s, w in target_alloc.items():
                if s != 'CASH':
                    op = px_open.loc[t_in, s]
                    current_holdings[s] = (net_val * w) / op
            
            period_eq.append(net_val)
            period_dates.append(t_in)
            p_idx += 1

        tot_eq = cash
        for s, sh in current_holdings.items():
            tot_eq += sh * px_adj.loc[current_dt, s]
        daily_equity.loc[current_dt] = tot_eq

    return daily_equity.ffill().bfill(), pd.Series(period_eq, index=period_dates), total_turnover, trade_count

# 1. 當前線上策略 (Current Production: 月底評價 / 隔月1號開倉 單一梯隊, 0.60/0.40, 凸性加權)
eq_curr_d, eq_curr_p, to_curr, tc_curr = simulate_single_tranche(
    rebal_mode='month_end', initial_capital=1000000.0, breadth_th=(0.60, 0.40), use_convexity=True, use_churn_filter=False, mom_mat=mom_std
)

# 2. 升級版單一梯隊 (每月 1 號單梯隊 + 寬鬆宏觀 0.50/0.30 + 爆量滯漲濾網 + 40/30/30固定)
eq_up1_d, eq_up1_p, to_up1, tc_up1 = simulate_single_tranche(
    rebal_mode=1, initial_capital=1000000.0, breadth_th=(0.50, 0.30), use_convexity=False, use_churn_filter=True, mom_mat=mom_std
)

# 3. 最新終極雙梯隊平衡版 (1號 + 22號 雙梯隊 + 寬鬆宏觀 0.50/0.30 + 爆量滯漲濾網 + 40/30/30固定 + 標準動能)
eq_t1_d, _, to_t1, tc_t1 = simulate_single_tranche(
    rebal_mode=1, initial_capital=500000.0, breadth_th=(0.50, 0.30), use_convexity=False, use_churn_filter=True, mom_mat=mom_std
)
eq_t22_d, _, to_t22, tc_t22 = simulate_single_tranche(
    rebal_mode=22, initial_capital=500000.0, breadth_th=(0.50, 0.30), use_convexity=False, use_churn_filter=True, mom_mat=mom_std
)

# 4. 最新終極雙梯隊進攻版 (1號 + 22號 雙梯隊 + 寬鬆宏觀 0.50/0.30 + 爆量滯漲濾網 + 40/30/30固定 + 45/35/20 敏銳動能)
eq_f1_d, _, to_f1, tc_f1 = simulate_single_tranche(
    rebal_mode=1, initial_capital=500000.0, breadth_th=(0.50, 0.30), use_convexity=False, use_churn_filter=True, mom_mat=mom_fast
)
eq_f22_d, _, to_f22, tc_f22 = simulate_single_tranche(
    rebal_mode=22, initial_capital=500000.0, breadth_th=(0.50, 0.30), use_convexity=False, use_churn_filter=True, mom_mat=mom_fast
)

common_idx = eq_curr_d.dropna().index.intersection(eq_t1_d.dropna().index).intersection(eq_t22_d.dropna().index).intersection(eq_up1_d.dropna().index)
eq_curr = eq_curr_d.loc[common_idx]
eq_up1 = eq_up1_d.loc[common_idx]
eq_dual_bal = eq_t1_d.loc[common_idx] + eq_t22_d.loc[common_idx]
eq_dual_agg = eq_f1_d.loc[common_idx] + eq_f22_d.loc[common_idx]

def full_kpi_report(s, turnover_total, trades_total, name=""):
    years = (s.index[-1] - s.index[0]).days / 365.25
    tot_mult = s.iloc[-1] / s.iloc[0]
    cagr = (tot_mult ** (1.0 / years) - 1.0) * 100.0
    
    # Daily Drawdown & Ulcer Index
    cummax = s.cummax()
    dd = (s - cummax) / cummax * 100.0
    daily_mdd = dd.min()
    ulcer_index = np.sqrt(np.mean(dd ** 2))
    calmar_daily = cagr / abs(daily_mdd)
    
    # Max Drawdown Recovery Duration (in days)
    is_at_high = (s == cummax)
    high_dates = s.index[is_at_high]
    max_underwater_days = 0
    for i in range(len(high_dates) - 1):
        gap = (high_dates[i+1] - high_dates[i]).days
        if gap > max_underwater_days:
            max_underwater_days = gap
    last_gap = (s.index[-1] - high_dates[-1]).days
    if last_gap > max_underwater_days:
        max_underwater_days = last_gap

    # Monthly Metrics
    m_series = s.resample('ME').last()
    m_ret = m_series.pct_change().dropna()
    m_cummax = m_series.cummax()
    monthly_mdd = ((m_series - m_cummax) / m_cummax * 100.0).min()
    calmar_monthly = cagr / abs(monthly_mdd)
    
    vol_ann = m_ret.std() * np.sqrt(12) * 100.0
    sharpe = (m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12)
    
    downside_m = m_ret[m_ret < 0]
    sortino = (m_ret.mean() * 12) / (downside_m.std() * np.sqrt(12) + 1e-9)
    
    win_months = (m_ret > 0).mean() * 100.0
    avg_win = m_ret[m_ret > 0].mean() * 100.0
    avg_loss = abs(m_ret[m_ret < 0].mean()) * 100.0
    profit_factor = (m_ret[m_ret > 0].sum()) / abs(m_ret[m_ret < 0].sum())
    
    worst_month = m_ret.min() * 100.0
    best_month = m_ret.max() * 100.0
    var_95_month = np.percentile(m_ret * 100.0, 5)
    cvar_95_month = (m_ret * 100.0)[m_ret * 100.0 <= var_95_month].mean()

    # Yearly Metrics
    y_series = s.resample('YE').last()
    y_ret = y_series.pct_change().dropna()
    win_years = (y_ret > 0).mean() * 100.0
    worst_year = y_ret.min() * 100.0

    # OOS (2018-2026)
    oos = s[s.index >= '2018-01-01']
    oos_yrs = (oos.index[-1] - oos.index[0]).days / 365.25
    oos_mult = oos.iloc[-1] / oos.iloc[0]
    oos_cagr = (oos_mult ** (1.0 / oos_yrs) - 1.0) * 100.0
    oos_mdd = ((oos - oos.cummax()) / oos.cummax() * 100.0).min()
    oos_calmar = oos_cagr / abs(oos_mdd)

    # Recent 3 Years (2023-2026)
    r3 = s[s.index >= '2023-01-01']
    r3_yrs = (r3.index[-1] - r3.index[0]).days / 365.25
    r3_cagr = ((r3.iloc[-1] / r3.iloc[0]) ** (1.0 / r3_yrs) - 1.0) * 100.0
    r3_mdd = ((r3 - r3.cummax()) / r3.cummax() * 100.0).min()

    # Crisis MDD
    mdd_2008 = ((s['2008':'2009'] - s['2008':'2009'].cummax()) / s['2008':'2009'].cummax() * 100.0).min()
    mdd_2020 = ((s['2020'] - s['2020'].cummax()) / s['2020'].cummax() * 100.0).min()
    mdd_2022 = ((s['2022'] - s['2022'].cummax()) / s['2022'].cummax() * 100.0).min()

    return {
        'name': name,
        'cagr': cagr,
        'mult': tot_mult,
        'daily_mdd': daily_mdd,
        'monthly_mdd': monthly_mdd,
        'calmar_daily': calmar_daily,
        'calmar_monthly': calmar_monthly,
        'sharpe': sharpe,
        'sortino': sortino,
        'ulcer_index': ulcer_index,
        'vol_ann': vol_ann,
        'win_months': win_months,
        'win_years': win_years,
        'profit_factor': profit_factor,
        'avg_win_loss_ratio': avg_win / avg_loss,
        'best_month': best_month,
        'worst_month': worst_month,
        'var_95_month': var_95_month,
        'cvar_95_month': cvar_95_month,
        'worst_year': worst_year,
        'max_underwater_days': max_underwater_days,
        'oos_cagr': oos_cagr,
        'oos_mdd': oos_mdd,
        'oos_calmar': oos_calmar,
        'r3_cagr': r3_cagr,
        'r3_mdd': r3_mdd,
        'mdd_2008': mdd_2008,
        'mdd_2020': mdd_2020,
        'mdd_2022': mdd_2022,
        'ann_turnover': (turnover_total / years) * 100.0,
        'trades_per_year': trades_total / years
    }

k_curr = full_kpi_report(eq_curr, to_curr, tc_curr, "① 當前系統 (單梯隊月底調倉)")
k_up1 = full_kpi_report(eq_up1, to_up1, tc_up1, "② 新單梯隊版 (1號單次 + 新參數)")
k_bal = full_kpi_report(eq_dual_bal, (to_t1 + to_t22)/2.0, tc_t1 + tc_t22, "③ 最新雙梯隊【平衡版】(1+22號)")
k_agg = full_kpi_report(eq_dual_agg, (to_f1 + to_f22)/2.0, tc_f1 + tc_f22, "④ 最新雙梯隊【進攻版】(1+22號)")

kpi_df = pd.DataFrame([k_curr, k_up1, k_bal, k_agg])
kpi_df.to_csv("comprehensive_kpi_comparison.csv", index=False)
kpi_df.to_json("comprehensive_kpi_comparison.json", orient='records', indent=2)

for col in kpi_df.columns:
    if col == 'name': continue
    print(f"\n[{col}]")
    for _, row in kpi_df.iterrows():
        print(f"  {row['name']:<34}: {row[col]:10.2f}")
