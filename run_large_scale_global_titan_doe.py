import sys
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

print("================================================================================")
print("     【全球泰坦旗艦策略】大型全因子 DOE 最佳化實驗 (2004 - 2026, 22年全歷史)      ")
print("================================================================================\n")

# 1. 載入乾淨歷史資料庫
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])

# 嚴格排除非國內券商可買標的 (.KS, .T, .DE, .SA) 以及 基準 ETF (0050.TW, SPY, QQQ)
exclude_exts = ['.KS', '.T', '.DE', '.SA']
valid_tickers = [
    t for t in df['ticker'].unique() 
    if not any(t.endswith(ext) for ext in exclude_exts) and t not in ['0050.TW', 'SPY', 'QQQ']
]
df = df[df['ticker'].isin(valid_tickers)]

# 計算真實還原開盤價
df['adj_open'] = np.where(df['close'] > 0, df['open'] * (df['adj_close'] / df['close']), df['open'])

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='adj_open').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
sov_adj = sov_adj.reindex(common_dates).ffill()

stock_tickers = list(px_adj.columns)
print(f"有效個股數量 (乾淨池): {len(stock_tickers)} 檔")

# 2. 計算基礎技術與動能指標
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()
ma60_slope5 = (ma60 - ma60.shift(5)) / ma60.shift(5)

mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

# 基準多週期動能 (階梯加權)
base_mom = 0.40 * mom12m + 0.30 * mom6m + 0.20 * mom3m + 0.10 * mom1m

# FIP 漸進式動能 (63天, 126天, 252天)
daily_ret = px_adj.pct_change()
def get_fip(w):
    pos = (daily_ret > 0).rolling(w).sum()
    neg = (daily_ret < 0).rolling(w).sum()
    return (pos - neg) / (pos + neg + 1e-9)

fip_252 = get_fip(252)
fip_126 = get_fip(126)

# 宏觀指標 (SPY 200MA 與 全球主權 15 國 ETF 寬幅)
spy_adj = sov_adj['SPY'] if 'SPY' in sov_adj.columns else None
spy_ma200 = spy_adj.rolling(200).mean() if spy_adj is not None else None

sov_ma200 = sov_adj.rolling(200).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

# 月度調倉時間切片
month_ends = px_adj.groupby([px_adj.index.year, px_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

periods = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    fut = px_adj.index[px_adj.index > t_date]
    if len(fut) == 0: break
    t_in = fut[0]
    next_m = month_ends[i+1]
    fut_next = px_adj.index[px_adj.index > next_m]
    if len(fut_next) == 0: break
    t_out = fut_next[0]
    sub_dates = list(px_adj.index[(px_adj.index >= t_in) & (px_adj.index <= t_out)])
    periods.append({
        't_date': t_date,
        't_in': t_in,
        't_out': t_out,
        'sub_dates': sub_dates
    })

print(f"回測週期: {periods[0]['t_in'].strftime('%Y-%m-%d')} 至 {periods[-1]['t_out'].strftime('%Y-%m-%d')} (共 {len(periods)} 個月)")

# 3. 預先計算各因子選股矩陣 (Precompute Candidate Rankings for Performance)
fip_configs = {
    'none': base_mom,
    'fip252_0.5': base_mom * (1.0 + 0.5 * fip_252),
    'fip252_1.0': base_mom * (1.0 + 1.0 * fip_252),
    'fip126_0.5': base_mom * (1.0 + 0.5 * fip_126),
}

filter_configs = ['P_gt_MA60', 'P_gt_MA60_MA200', 'P_gt_MA60_SLOPE']

# precomputed_rankings[fip_cfg][filter_cfg][t_date] = list of top symbols
precomputed_rankings = {}
for f_name, mom_matrix in fip_configs.items():
    precomputed_rankings[f_name] = {}
    for flt in filter_configs:
        precomputed_rankings[f_name][flt] = {}
        for p in periods:
            td = p['t_date']
            scores = mom_matrix.loc[td].dropna()
            scores = scores[scores > 0]
            if len(scores) == 0:
                precomputed_rankings[f_name][flt][td] = []
                continue
            p_cur = px_adj.loc[td, scores.index]
            m60_cur = ma60.loc[td, scores.index]
            
            if flt == 'P_gt_MA60':
                cond = p_cur > m60_cur
            elif flt == 'P_gt_MA60_MA200':
                m200_cur = ma200.loc[td, scores.index]
                cond = (p_cur > m60_cur) & (p_cur > m200_cur)
            elif flt == 'P_gt_MA60_SLOPE':
                s5_cur = ma60_slope5.loc[td, scores.index]
                cond = (p_cur > m60_cur) & (s5_cur > 0)
            
            cands = scores[cond].sort_values(ascending=False).index.tolist()
            precomputed_rankings[f_name][flt][td] = cands[:10]

print("選股排名預算完畢，開始執行 DOE 參數組合模擬...")

# 4. DOE 參數維度定義
sizing_configs = {
    'TOP2_50_50': [0.50, 0.50],
    'TOP3_40_30_30': [0.40, 0.30, 0.30],
    'TOP3_50_30_20': [0.50, 0.30, 0.20],
    'TOP3_EQUAL': [1/3, 1/3, 1/3],
    'TOP4_40_25_20_15': [0.40, 0.25, 0.20, 0.15],
    'TOP4_EQUAL': [0.25, 0.25, 0.25, 0.25],
    'TOP5_EQUAL': [0.20, 0.20, 0.20, 0.20, 0.20]
}

macro_configs = [
    'SPY200_BINARY',     # SPY >= 200MA (1.0 vs 0.0)
    'SPY200_HALF',       # SPY >= 200MA (1.0 vs 0.5)
    'BREADTH_60_40',     # 寬幅 >= 60% 滿倉, 40-60% 70%倉, <40% 0倉
    'SPY_AND_BREADTH'    # SPY破年線全空倉，未破但全球寬幅<40%降半倉
]

exit_configs = [
    'HOLD_MONTH',        # 抱滿整月
    'BREAKEVEN_20'       # 獲利滿 20% 移動保本
]

results = []
total_runs = len(sizing_configs) * len(fip_configs) * len(filter_configs) * len(macro_configs) * len(exit_configs)
print(f"總測試組合數量: {total_runs} 組")

run_count = 0
for sz_name, weights in sizing_configs.items():
    n_stocks = len(weights)
    for fip_name in fip_configs.keys():
        for flt_name in filter_configs:
            rankings_dict = precomputed_rankings[fip_name][flt_name]
            for macro_name in macro_configs:
                for exit_name in exit_configs:
                    run_count += 1
                    capital = 1000000.0
                    equity = [capital]
                    dates = [periods[0]['t_in']]
                    friction = 0.0015
                    
                    for p in periods:
                        td = p['t_date']
                        tin = p['t_in']
                        tout = p['t_out']
                        sub_dates = p['sub_dates']
                        
                        # 宏觀曝險判定
                        exposure = 1.0
                        spy_p = spy_adj.loc[td] if spy_adj is not None else np.nan
                        spy_m = spy_ma200.loc[td] if spy_ma200 is not None else np.nan
                        br = global_breadth.loc[td] if td in global_breadth.index else 0.5
                        
                        if macro_name == 'SPY200_BINARY':
                            if pd.isna(spy_p) or pd.isna(spy_m) or spy_p < spy_m:
                                exposure = 0.0
                        elif macro_name == 'SPY200_HALF':
                            exposure = 1.0 if (pd.notna(spy_p) and pd.notna(spy_m) and spy_p >= spy_m) else 0.50
                        elif macro_name == 'BREADTH_60_40':
                            if br >= 0.60: exposure = 1.0
                            elif br >= 0.40: exposure = 0.70
                            else: exposure = 0.0
                        elif macro_name == 'SPY_AND_BREADTH':
                            if pd.isna(spy_p) or pd.isna(spy_m) or spy_p < spy_m:
                                exposure = 0.0
                            elif br < 0.40:
                                exposure = 0.50
                        
                        if exposure <= 0:
                            equity.append(capital)
                            dates.append(tout)
                            continue
                        
                        cands = rankings_dict[td]
                        selected = cands[:n_stocks]
                        
                        if len(selected) == 0:
                            equity.append(capital)
                            dates.append(tout)
                            continue
                        
                        w_sub = weights[:len(selected)]
                        tot_w = sum(w_sub)
                        actual_w = [w / tot_w * exposure for w in w_sub]
                        
                        # 部位模擬
                        pos_states = {}
                        for idx, sym in enumerate(selected):
                            in_p = px_open.loc[tin, sym] if sym in px_open.columns else np.nan
                            if pd.notna(in_p) and in_p > 0:
                                pos_states[sym] = {
                                    'w': actual_w[idx],
                                    'in_p': in_p,
                                    'peak_ret': 0.0,
                                    'hit_be': False,
                                    'status': 'HOLD',
                                    'exit_ret': 0.0
                                }
                        
                        if exit_name == 'BREAKEVEN_20' and len(sub_dates) > 1:
                            for d in sub_dates[1:]:
                                for sym, state in pos_states.items():
                                    if state['status'] != 'HOLD': continue
                                    cur_p = px_open.loc[d, sym]
                                    if pd.isna(cur_p) or cur_p <= 0: continue
                                    r_curr = cur_p / state['in_p'] - 1.0
                                    if r_curr > state['peak_ret']: state['peak_ret'] = r_curr
                                    if state['peak_ret'] >= 0.20: state['hit_be'] = True
                                    if state['hit_be'] and r_curr <= 0.0:
                                        state['status'] = 'EXIT_BE'
                                        state['exit_ret'] = -friction
                        
                        # 月末結算
                        period_ret = 0.0
                        for sym, state in pos_states.items():
                            if state['status'] == 'HOLD':
                                out_p = px_open.loc[tout, sym] if sym in px_open.columns else np.nan
                                r_fin = (out_p / state['in_p'] - 1.0) if pd.notna(out_p) and out_p > 0 else 0.0
                                net_r = r_fin - friction
                            else:
                                net_r = state['exit_ret']
                            period_ret += state['w'] * net_r
                        
                        capital *= (1.0 + period_ret)
                        equity.append(capital)
                        dates.append(tout)
                    
                    eq_s = pd.Series(equity, index=dates)
                    mult = eq_s.iloc[-1] / eq_s.iloc[0]
                    years = (dates[-1] - dates[0]).days / 365.25
                    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
                    mdd = ((eq_s - eq_s.cummax()) / eq_s.cummax()).min() * 100.0
                    monthly_ret = eq_s.pct_change().dropna()
                    rf = 0.02 / 12.0
                    sharpe = ((monthly_ret - rf).mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
                    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0
                    win_rate = (monthly_ret > 0).mean() * 100.0
                    
                    results.append({
                        'sizing': sz_name,
                        'n_stocks': n_stocks,
                        'fip': fip_name,
                        'filter': flt_name,
                        'macro': macro_name,
                        'exit': exit_name,
                        'cagr': round(cagr, 2),
                        'mdd': round(mdd, 2),
                        'calmar': round(calmar, 3),
                        'sharpe': round(sharpe, 2),
                        'win_rate': round(win_rate, 1),
                        'mult': round(mult, 1)
                    })

res_df = pd.DataFrame(results)
res_df.to_csv("global_titan_grand_doe_results.csv", index=False)
print("DOE 實驗全部完成！已儲存至 global_titan_grand_doe_results.csv\n")

# 5. 分析持股檔數 (3隻 vs 4隻 vs 2隻 vs 5隻) 的邊際效應
print("================================================================================")
print("     【核心問題解密】持股檔數維度 (Sizing) 綜合表現對比 (平均值 vs 最高值)         ")
print("================================================================================")
sizing_group = res_df.groupby('sizing').agg({
    'cagr': ['mean', 'max'],
    'mdd': ['mean', 'min'],
    'calmar': ['mean', 'max'],
    'sharpe': ['mean', 'max'],
    'mult': ['mean', 'max']
}).round(2)
print(sizing_group)

# 6. Top 15 綜合風報比冠軍榜單 (By Calmar Ratio)
print("\n================================================================================")
print("     🏆 全球泰坦 DOE 終極冠軍榜單 (Top 15 by Calmar Ratio)                      ")
print("================================================================================")
top15 = res_df.sort_values(by='calmar', ascending=False).head(15)
for idx, r in top15.reset_index().iterrows():
    print(f"Rank {idx+1:>2}: {r['sizing']:<17} | {r['fip']:<10} | {r['filter']:<16} | {r['macro']:<15} | {r['exit']:<12} | CAGR: {r['cagr']:>5.2f}% | MDD: {r['mdd']:>6.2f}% | Calmar: {r['calmar']:>5.3f} | Mult: {r['mult']:>7.1f}x")
