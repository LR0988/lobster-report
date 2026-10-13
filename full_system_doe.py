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

# Precompute price technicals
ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma120 = px_adj.rolling(120).mean()
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

# Precompute momentum score variants:
# mom_variant: 
# 'standard': 0.50*12m + 0.30*3m + 0.20*1m
# 'fast': 0.30*12m + 0.40*3m + 0.30*1m
# 'smooth': 0.60*12m + 0.25*3m + 0.15*1m
# 'equal': 0.33*12m + 0.33*6m + 0.33*3m
mom_scores = {
    'standard': (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat),
    'fast': (0.30 * mom12m + 0.40 * mom3m + 0.30 * mom1m) * (1.0 + 0.5 * fip_mat),
    'smooth': (0.60 * mom12m + 0.25 * mom3m + 0.15 * mom1m) * (1.0 + 0.5 * fip_mat),
    'no_fip': (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m)
}

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

def simulate_tranche(
    day_target,
    mom_var='standard',
    trend_filter='ma60_ma200', # 'ma60_ma200', 'ma60_only', 'ma20_ma60'
    breadth_thresholds=(0.60, 0.40), # (bull, mid)
    mid_exposure=0.70, # 0.50, 0.70, 0.80
    buffer_rank=5, # 3 (no buffer), 5 (keep top 5), 7
    max_tenure=4, # 3, 4, 6, 99 (no tenure limit)
    rebal_tolerance=0.05, # 0.0 (strict), 0.05 (5% band), 0.10
    base_weights=[0.40, 0.30, 0.30],
    use_convexity=False
):
    mom_mat = mom_scores[mom_var][stock_tickers]
    bull_th, mid_th = breadth_thresholds
    
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
    
    p_idx = 0
    num_p = len(periods)
    
    for t_idx, current_dt in enumerate(all_sim_dates):
        if p_idx < num_p and current_dt == periods[p_idx][1]:
            t_date, t_in, t_out = periods[p_idx]
            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open.loc[t_in, s]
                
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            if br >= bull_th: exposure = 1.0
            elif br >= mid_th: exposure = mid_exposure
            else: exposure = 0.0

            valid_stks = []
            for s in stock_tickers:
                sp = px_adj.loc[t_date, s]
                sc = mom_mat.loc[t_date, s]
                
                # Trend filter condition
                if trend_filter == 'ma60_ma200':
                    m6 = ma60.loc[t_date, s]
                    m2 = ma200.loc[t_date, s]
                    cond = (sp > m6) and (sp > m2 if pd.notna(m2) else True)
                elif trend_filter == 'ma60_only':
                    m6 = ma60.loc[t_date, s]
                    cond = (sp > m6)
                elif trend_filter == 'ma20_ma60':
                    m20_val = ma20.loc[t_date, s]
                    m6 = ma60.loc[t_date, s]
                    cond = (sp > m20_val) and (sp > m6)
                else:
                    cond = True
                    
                if pd.notna(sp) and pd.notna(sc) and cond and sc > 0:
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
                    if info is not None and info[0] <= buffer_rank and tenure < max_tenure:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    tenure = holding_tenure.get(s, 0)
                    if s not in selected_stks and tenure < max_tenure:
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
                    if s in current_holdings and abs(cur_w - tgt_w) <= rebal_tolerance:
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

def evaluate_system(params, name=""):
    eq1 = simulate_tranche(1, **params)
    eq22 = simulate_tranche(22, **params)
    
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

    mdd_2008 = ((eq_dual['2008':'2009'] - eq_dual['2008':'2009'].cummax()) / eq_dual['2008':'2009'].cummax()).min() * 100.0
    mdd_2022 = ((eq_dual['2022'] - eq_dual['2022'].cummax()) / eq_dual['2022'].cummax()).min() * 100.0

    return {
        'name': name,
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
        'mdd_2022': mdd_2022,
        **params
    }

# Build DOE Matrix across key dimensions:
doe_cases = [
    # Baseline
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "基準: 40/30/30 標準配置"),
    
    # 1. 宏觀寬幅門檻 (Macro Breadth)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.50, 0.30), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "宏觀: 寬鬆門檻 (0.50 / 0.30)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.70, 0.50), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "宏觀: 嚴格門檻 (0.70 / 0.50)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.50, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "宏觀: 中度曝險降至50%"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.85, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "宏觀: 中度曝險升至85%"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.00, 0.00), 'mid_exposure': 1.00, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "宏觀: 無宏觀風控 (100% 永遠在場)"),

    # 2. 動能因子架構 (Momentum Formula)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'fast'}, "動能: 偏重短中期 (30% 12m + 40% 3m + 30% 1m)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'smooth'}, "動能: 偏重長週期 (60% 12m + 25% 3m + 15% 1m)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'no_fip'}, "動能: 移除 FIP 漸進動能乘數"),

    # 3. 個股趨勢濾網 (Trend Filter)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_only', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "濾網: 僅站上 60MA (不卡 200MA)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma20_ma60', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "濾網: 雙強濾網 (站上 20MA + 60MA)"),

    # 4. 緩衝區門檻與換手頻率 (Buffer Rank)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 3, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "緩衝: 無緩衝 (非前3名立刻踢出)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 7, 'max_tenure': 4, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "緩衝: 寬鬆緩衝 (在前7名都續抱)"),

    # 5. 持股任期上限 (Max Tenure)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 2, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "任期: 最多抱 2 個月 (強制獲利了結)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 6, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "任期: 最多抱 6 個月 (長波段)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 99, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "任期: 無任期限制 (只要在前5名無限抱)"),

    # 6. 調倉容忍帶 (Rebalance Tolerance Band)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.00, 'mom_var': 'standard'}, "容忍: 嚴格精準調倉 (0% 摩擦容忍)"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 4, 'rebal_tolerance': 0.10, 'mom_var': 'standard'}, "容忍: 寬容帶 (10% 偏離才調倉)"),

    # 7. 最佳化組合冠軍探索 (Combinations)
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_only', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 6, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "組合A: 60MA濾網 + 抱6個月長波段"),
    ({'base_weights': [0.40, 0.30, 0.30], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.85, 'buffer_rank': 5, 'max_tenure': 6, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "組合B: 中度曝險85% + 抱6個月長波段"),
    ({'base_weights': [0.40, 0.36, 0.24], 'use_convexity': False, 'trend_filter': 'ma60_ma200', 'breadth_thresholds': (0.60, 0.40), 'mid_exposure': 0.70, 'buffer_rank': 5, 'max_tenure': 6, 'rebal_tolerance': 0.05, 'mom_var': 'standard'}, "組合C: 40/36/24 比例 + 抱6個月長波段"),
]

print(f"Total DOE cases to run: {len(doe_cases)}")
results = []
for idx, (p, label) in enumerate(doe_cases):
    res = evaluate_system(p, name=label)
    results.append(res)
    print(f"[{idx+1:2d}] {label:<38} | CAGR {res['cagr']:5.2f}% | MDD {res['mdd']:6.2f}% | Calmar {res['calmar']:5.3f} | Sharpe {res['sharpe']:4.2f}")

res_df = pd.DataFrame(results)
res_df.to_csv("full_system_doe_results.csv", index=False)
res_df.to_json("full_system_doe_results.json", orient='records', indent=2)
print("All System DOE Completed!")
