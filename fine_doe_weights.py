import os
import json
import sqlite3
import pandas as pd
import numpy as np
from itertools import product

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 1. 載入數據
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
sov_adj = sov_adj.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()

mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

sov_ma200 = sov_adj.rolling(200).mean()

candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

downside_ret = px_daily_ret.clip(upper=0)
upside_ret = px_daily_ret.clip(lower=0)
upside_vol = upside_ret.rolling(60).std()
downside_vol = downside_ret.rolling(60).std().replace(0, 1e-6)
stk_convexity = (upside_vol / (downside_vol + 1e-6)).fillna(1.0)

mom_score_raw = (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)
mom_mat = mom_score_raw[stock_tickers]

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

# Precompute simulation components
def run_simulation(day_target, w1, w2, w3, use_convexity=False):
    rebal_dates = []
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
    capital = 500000.0
    current_holdings = {}
    cash = capital
    holding_tenure = {}
    
    all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
    daily_equity = pd.Series(index=all_sim_dates, dtype=float)
    
    base_weights = [w1, w2, w3]
    p_idx = 0
    num_p = len(periods)
    
    for t_idx, current_dt in enumerate(all_sim_dates):
        if p_idx < num_p and current_dt == periods[p_idx][1]:
            t_date, t_in, t_out = periods[p_idx]
            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open.loc[t_in, s]
                
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            if br >= 0.60: exposure = 1.0
            elif br >= 0.40: exposure = 0.70
            else: exposure = 0.0

            valid_stks = []
            for s in stock_tickers:
                sp = px_adj.loc[t_date, s]
                m6 = ma60.loc[t_date, s]
                m2 = ma200.loc[t_date, s]
                sc = mom_mat.loc[t_date, s]
                if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
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
            fee = (turnover / 2.0) * friction * cur_val
            net_val = cur_val - fee

            current_holdings = {}
            cash = net_val * target_alloc.get('CASH', 0.0)
            for s, w in target_alloc.items():
                if s != 'CASH':
                    op = px_open.loc[t_in, s]
                    current_holdings[s] = (net_val * w) / op
            
            p_idx += 1

        tot_eq = cash
        for s, sh in current_holdings.items():
            tot_eq += sh * px_adj.loc[current_dt, s]
        daily_equity.loc[current_dt] = tot_eq

    return daily_equity.ffill().bfill()

# Fine Grid Search around 40 / 30 / 30
# w1 from 0.34 to 0.48 step 0.02
# w2 from 0.24 to 0.36 step 0.02
# w3 = round(1.0 - w1 - w2, 2)
# constraints: w1 >= w2 >= w3 > 0.15

grid_points = []
for w1_pct in range(34, 50, 2):
    for w2_pct in range(24, 38, 2):
        w3_pct = 100 - w1_pct - w2_pct
        if w1_pct >= w2_pct >= w3_pct and w3_pct >= 15:
            grid_points.append((w1_pct / 100.0, w2_pct / 100.0, w3_pct / 100.0))

print(f"Total fine grid combinations: {len(grid_points)}")

results = []
for idx, (w1, w2, w3) in enumerate(grid_points):
    # Test both fixed and convexity-adjusted
    for use_conv in [False, True]:
        eq1 = run_simulation(1, w1, w2, w3, use_convexity=use_conv)
        eq22 = run_simulation(22, w1, w2, w3, use_convexity=use_conv)
        
        common = eq1.dropna().index.intersection(eq22.dropna().index)
        eq_dual = eq1.loc[common] + eq22.loc[common]
        
        tot_mult = eq_dual.iloc[-1] / eq_dual.iloc[0]
        years = (eq_dual.index[-1] - eq_dual.index[0]).days / 365.25
        cagr = (tot_mult ** (1.0 / years) - 1.0) * 100.0
        
        cummax = eq_dual.cummax()
        mdd = ((eq_dual - cummax) / cummax).min() * 100.0
        calmar = cagr / abs(mdd)
        
        monthly_s = eq_dual.resample('ME').last()
        m_ret = monthly_s.pct_change().dropna()
        sharpe = (m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12)
        vol_annual = m_ret.std() * np.sqrt(12) * 100.0
        
        oos = eq_dual[eq_dual.index >= '2018-01-01']
        oos_mult = oos.iloc[-1] / oos.iloc[0]
        oos_yrs = (oos.index[-1] - oos.index[0]).days / 365.25
        oos_cagr = (oos_mult ** (1.0 / oos_yrs) - 1.0) * 100.0
        oos_mdd = ((oos - oos.cummax()) / oos.cummax()).min() * 100.0
        oos_calmar = oos_cagr / abs(oos_mdd)

        # Crisis MDD
        mdd_2008 = ((eq_dual['2008':'2009'] - eq_dual['2008':'2009'].cummax()) / eq_dual['2008':'2009'].cummax()).min() * 100.0
        mdd_2022 = ((eq_dual['2022'] - eq_dual['2022'].cummax()) / eq_dual['2022'].cummax()).min() * 100.0

        label = f"{int(w1*100)}% / {int(w2*100)}% / {int(w3*100)}% ({'凸性微調' if use_conv else '純固定'})"
        
        res = {
            'w1': int(w1*100),
            'w2': int(w2*100),
            'w3': int(w3*100),
            'convexity': use_conv,
            'label': label,
            'cagr': cagr,
            'mdd': mdd,
            'calmar': calmar,
            'sharpe': sharpe,
            'vol': vol_annual,
            'mult': tot_mult,
            'oos_cagr': oos_cagr,
            'oos_mdd': oos_mdd,
            'oos_calmar': oos_calmar,
            'mdd_2008': mdd_2008,
            'mdd_2022': mdd_2022
        }
        results.append(res)
        print(f"[{len(results):2d}] {label:<35} | CAGR {cagr:5.2f}% | MDD {mdd:6.2f}% | Calmar {calmar:5.3f} | Sharpe {sharpe:4.2f}")

res_df = pd.DataFrame(results)
res_df.to_csv("fine_doe_results.csv", index=False)
res_df.to_json("fine_doe_results.json", orient='records', indent=2)
print("Fine DOE finished successfully!")
