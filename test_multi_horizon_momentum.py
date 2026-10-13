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

# Multi-Horizon Return Windows
mom1w = px_adj.pct_change(5)    # 1 週極短
mom2w = px_adj.pct_change(10)   # 2 週短線
mom1m = px_adj.pct_change(21)   # 1 個月
mom2m = px_adj.pct_change(42)   # 2 個月
mom3m = px_adj.pct_change(63)   # 3 個月 (1季)
mom6m = px_adj.pct_change(126)  # 6 個月 (半年)
mom9m = px_adj.pct_change(189)  # 9 個月 (3季)
mom12m = px_adj.pct_change(252) # 12 個月 (1年)

# 12-1 剔除近期1個月反轉效應的經典 Jegadeesh-Titman 12m minus 1m
mom12_1 = (px_adj.shift(21) / px_adj.shift(252) - 1.0)

# FIP
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# Volume moving averages & Churn Filter
vol_ma60 = px_vol.rolling(60).mean()
vol_5d_mean = px_vol.rolling(5).mean()
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

sov_ma200 = sov_adj.rolling(200).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

# --- Multi-Horizon Ensemble Architectures ---
def zscore_horizon(df_mom):
    # Cross-sectional z-score ranking
    return (df_mom - df_mom.mean(axis=1, keepdims=True)) / (df_mom.std(axis=1, keepdims=True) + 1e-6)

# 1. 基準模型 (Baseline: 50% 12m + 30% 3m + 20% 1m) * (1 + 0.5*FIP)
mom_base = (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)

# 2. 四頻段等權集總 (4-Horizon Balanced Ensemble: 1m + 3m + 6m + 12m)
mom_4h_eq = (0.25 * mom12m + 0.25 * mom6m + 0.25 * mom3m + 0.25 * mom1m) * (1.0 + 0.5 * fip_mat)

# 3. 漸進式金字塔集總 (Progression Pyramid: 40% 12m + 30% 6m + 20% 3m + 10% 1m)
mom_pyramid = (0.40 * mom12m + 0.30 * mom6m + 0.20 * mom3m + 0.10 * mom1m) * (1.0 + 0.5 * fip_mat)

# 4. 全頻段覆蓋 (All-Horizon Comprehensive: 1m, 2m, 3m, 6m, 9m, 12m)
mom_6h_all = (0.30 * mom12m + 0.20 * mom9m + 0.20 * mom6m + 0.15 * mom3m + 0.10 * mom2m + 0.05 * mom1m) * (1.0 + 0.5 * fip_mat)

# 5. 學術經典 Jegadeesh-Titman 12-1 剔除近期反轉 (Academic 12-1 + 3m + 1m)
mom_jt = (0.50 * mom12_1 + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)

# 6. 動態跨期共振集總 (Horizon Alignment / Agreement Filter):
# 股票必須在短、中、長三個頻段皆為正收益 (Alignment Filter)，否則加重懲罰
alignment_mask = ((mom1m > 0).astype(int) + (mom3m > 0).astype(int) + (mom6m > 0).astype(int) + (mom12m > 0).astype(int))
mom_aligned = mom_base * (0.5 + 0.25 * alignment_mask)

# 7. 短衝突破 + 長期支撐 (Barbell Ensemble: 45% 12m + 10% 6m + 15% 3m + 30% 2w短爆發)
mom_barbell = (0.45 * mom12m + 0.10 * mom6m + 0.15 * mom3m + 0.30 * mom2w) * (1.0 + 0.5 * fip_mat)

ensemble_dict = {
    'baseline': mom_base,
    '4h_equal': mom_4h_eq,
    'pyramid': mom_pyramid,
    '6h_all': mom_6h_all,
    'academic_jt': mom_jt,
    'aligned_agreement': mom_aligned,
    'barbell': mom_barbell
}

def run_simulation(day_target, mom_matrix):
    mom_mat = mom_matrix[stock_tickers]
    
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
                
                # Base criteria: trend > 60MA & 200MA, sc > 0
                cond = pd.notna(sp) and pd.notna(sc) and pd.notna(m6) and (sp > m6) and (sp > m2 if pd.notna(m2) else True) and (sc > 0)
                
                # Churn Filter: 排除 5日均量>2倍 且 10日報酬<2%
                is_churn = churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False
                
                if cond and not is_churn:
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

def evaluate_dual_tranche(mom_matrix, name=""):
    eq1 = run_simulation(1, mom_matrix)
    eq22 = run_simulation(22, mom_matrix)
    
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

models = [
    ('baseline', "基準模型 (三頻段: 50% 12m + 30% 3m + 20% 1m)"),
    ('4h_equal', "四頻段等權集總 (25% 12m + 25% 6m + 25% 3m + 25% 1m)"),
    ('pyramid', "階梯金字塔集總 (40% 12m + 30% 6m + 20% 3m + 10% 1m)"),
    ('6h_all', "六頻段全週期集總 (12m + 9m + 6m + 3m + 2m + 1m)"),
    ('academic_jt', "學術經典 JT (50% 12-1 避反轉 + 30% 3m + 20% 1m)"),
    ('aligned_agreement', "跨期共振共識 (四頻段皆多頭加權共振)"),
    ('barbell', "槓鈴集總 (45% 12m基底 + 15% 3m + 30% 2週短衝刺)")
]

print("Running Multi-Horizon Momentum Ensemble Experiments...")
results = []
for key, label in models:
    res = evaluate_dual_tranche(ensemble_dict[key], name=label)
    results.append(res)
    print(f"{label:<48} | CAGR {res['cagr']:5.2f}% | MDD {res['mdd']:6.2f}% | Calmar {res['calmar']:5.3f} | Sharpe {res['sharpe']:4.2f} | 盲測CAGR {res['oos_cagr']:5.2f}%")

res_df = pd.DataFrame(results)
res_df.to_csv("multi_horizon_momentum_results.csv", index=False)
res_df.to_json("multi_horizon_momentum_results.json", orient='records', indent=2)
print("Multi-Horizon Momentum Experiments Finished!")
