import os
import json
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 1. 載入數據
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

mom_score_raw = (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)
mom_mat = mom_score_raw[stock_tickers]

# --- 量能與擁擠度特徵計算 ---
# 1. Volume moving averages
vol_ma20 = px_vol.rolling(20).mean()
vol_ma60 = px_vol.rolling(60).mean()
vol_ratio_20 = (px_vol / (vol_ma60 + 1e-6)).replace([np.inf, -np.inf], 1.0)
vol_5d_mean = px_vol.rolling(5).mean()
vol_surge_5d = (vol_5d_mean / (vol_ma60 + 1e-6)).replace([np.inf, -np.inf], 1.0)

# 2. Climax Run / Hyper-extension (乖離率)
bias_ma200 = ((px_adj - ma200) / (ma200 + 1e-6))
bias_ma60 = ((px_adj - ma60) / (ma60 + 1e-6))

# 3. Churn / Stall (高檔爆量滯漲): 過去 10 日爆量 (>1.8倍 60日均量) 但 10 日報酬 < 0 或 < 2%
ret_10d = px_adj.pct_change(10)
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (ret_10d < 0.02)

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

def run_simulation(
    day_target,
    filter_mode='none', # 'none', 'volume_climax', 'bias_crowded', 'churn_stall', 'combined'
    bias_limit=0.80, # 200MA 乖離率上限 (如 80% 或 100%)
    vol_surge_limit=3.0, # 5日均量超過60日均量的倍數 (爆量竭盡)
):
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
    
    base_weights = [0.40, 0.30, 0.30]
    p_idx = 0
    num_p = len(periods)
    
    for t_idx, current_dt in enumerate(all_sim_dates):
        if p_idx < num_p and current_dt == periods[p_idx][1]:
            t_date, t_in, t_out = periods[p_idx]
            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open.loc[t_in, s]
                
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            if br >= 0.50: exposure = 1.0
            elif br >= 0.30: exposure = 0.70
            else: exposure = 0.0

            valid_stks = []
            for s in stock_tickers:
                sp = px_adj.loc[t_date, s]
                m6 = ma60.loc[t_date, s]
                m2 = ma200.loc[t_date, s]
                sc = mom_mat.loc[t_date, s]
                
                # Base criteria: trend > 60MA & 200MA, mom > 0
                cond = pd.notna(sp) and pd.notna(sc) and pd.notna(m6) and (sp > m6) and (sp > m2 if pd.notna(m2) else True) and (sc > 0)
                
                if cond:
                    # Apply Volume Exhaustion / Crowded Trade Filter
                    is_exhausted = False
                    
                    if filter_mode == 'volume_climax':
                        # 5-day volume surge > limit (Climax Run)
                        v_surge = vol_surge_5d.loc[t_date, s] if s in vol_surge_5d.columns else 1.0
                        if pd.notna(v_surge) and v_surge > vol_surge_limit:
                            is_exhausted = True
                            
                    elif filter_mode == 'bias_crowded':
                        # Extreme Crowded Trade: bias above 200MA > limit (e.g. 80% or 100%)
                        b200 = bias_ma200.loc[t_date, s] if s in bias_ma200.columns else 0.0
                        if pd.notna(b200) and b200 > bias_limit:
                            is_exhausted = True
                            
                    elif filter_mode == 'churn_stall':
                        # Volume Churn: 爆量滯漲
                        ch = churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False
                        if ch:
                            is_exhausted = True
                            
                    elif filter_mode == 'combined_conservative':
                        # Combined: 既過度擁擠 (乖離 > 80%) 又 爆量竭盡 (量比 > 2.5) 或 爆量滯漲
                        b200 = bias_ma200.loc[t_date, s] if s in bias_ma200.columns else 0.0
                        v_surge = vol_surge_5d.loc[t_date, s] if s in vol_surge_5d.columns else 1.0
                        ch = churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False
                        if (pd.notna(b200) and b200 > bias_limit and pd.notna(v_surge) and v_surge > 2.5) or ch:
                            is_exhausted = True

                    elif filter_mode == 'combined_strict':
                        # 只要滿足任一項擁擠竭盡 (乖離 > limit 或 爆量 > limit 或 滯漲)
                        b200 = bias_ma200.loc[t_date, s] if s in bias_ma200.columns else 0.0
                        v_surge = vol_surge_5d.loc[t_date, s] if s in vol_surge_5d.columns else 1.0
                        ch = churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False
                        if (pd.notna(b200) and b200 > bias_limit) or (pd.notna(v_surge) and v_surge > vol_surge_limit) or ch:
                            is_exhausted = True

                    if not is_exhausted:
                        valid_stks.append((s, sc))
                        
            valid_stks.sort(key=lambda x: x[1], reverse=True)
            ranked_tickers = [x[0] for x in valid_stks]
            ticker_info = {x[0]: (idx + 1, x[1]) for idx, x in enumerate(valid_stks)}

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

def evaluate_dual_tranche(mode, bias_limit=0.80, vol_surge_limit=3.0, name=""):
    eq1 = run_simulation(1, filter_mode=mode, bias_limit=bias_limit, vol_surge_limit=vol_surge_limit)
    eq22 = run_simulation(22, filter_mode=mode, bias_limit=bias_limit, vol_surge_limit=vol_surge_limit)
    
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
    win_rate = (m_ret > 0).mean() * 100.0
    
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
        'mode': mode,
        'bias_limit': bias_limit,
        'vol_surge_limit': vol_surge_limit,
        'cagr': cagr,
        'mdd': mdd,
        'calmar': calmar,
        'sharpe': sharpe,
        'vol': vol_annual,
        'win_rate': win_rate,
        'mult': tot_mult,
        'oos_cagr': oos_cagr,
        'oos_mdd': oos_mdd,
        'oos_calmar': oos_calmar,
        'mdd_2008': mdd_2008,
        'mdd_2022': mdd_2022
    }

experiments = [
    ('none', 0.80, 3.0, "基準無濾網: 不過濾量能竭盡與擁擠"),
    ('volume_climax', 0.80, 3.0, "量能竭盡: 5日均量 > 3.0倍 60日量 (過濾狂熱爆量)"),
    ('volume_climax', 0.80, 2.5, "量能竭盡: 5日均量 > 2.5倍 60日量 (較敏銳過濾)"),
    ('volume_climax', 0.80, 2.0, "量能竭盡: 5日均量 > 2.0倍 60日量 (嚴格過濾)"),
    ('bias_crowded', 1.00, 3.0, "擁擠交易: 200MA 乖離率 > 100% (過濾極度泡沫)"),
    ('bias_crowded', 0.80, 3.0, "擁擠交易: 200MA 乖離率 > 80% (標準擁擠線)"),
    ('bias_crowded', 0.60, 3.0, "擁擠交易: 200MA 乖離率 > 60% (保守擁擠線)"),
    ('churn_stall', 0.80, 3.0, "爆量滯漲: 5日均量>2倍 但近10日報酬<2% (Stall)"),
    ('combined_conservative', 0.80, 2.5, "綜合雙重確認: 乖離>80%且量比>2.5 或 爆量滯漲"),
    ('combined_conservative', 1.00, 3.0, "綜合極端避險: 乖離>100%且量比>3.0 或 爆量滯漲"),
    ('combined_strict', 0.80, 3.0, "綜合嚴格過濾: 乖離>80% 或 爆量>3.0 或 滯漲"),
]

print("Running Volume Exhaustion & Crowded Trade DOE...")
results = []
for mode, b_lim, v_lim, label in experiments:
    res = evaluate_dual_tranche(mode, bias_limit=b_lim, vol_surge_limit=v_lim, name=label)
    results.append(res)
    print(f"{label:<48} | CAGR {res['cagr']:5.2f}% | MDD {res['mdd']:6.2f}% | Calmar {res['calmar']:5.3f} | Sharpe {res['sharpe']:4.2f}")

res_df = pd.DataFrame(results)
res_df.to_csv("volume_exhaustion_doe_results.csv", index=False)
res_df.to_json("volume_exhaustion_doe_results.json", orient='records', indent=2)
print("Volume Exhaustion DOE Completed!")
