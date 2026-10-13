import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

conn = sqlite3.connect(DB_PATH)
sov_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
stk_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
conn.close()

sov_df['date'] = pd.to_datetime(sov_df['date'])
stk_df['date'] = pd.to_datetime(stk_df['date'])

sov_df['adj_open'] = np.where(sov_df['close'] > 0, sov_df['open'] * (sov_df['adj_close'] / sov_df['close']), sov_df['open'])
stk_df['adj_open'] = np.where(stk_df['close'] > 0, stk_df['open'] * (stk_df['adj_close'] / stk_df['close']), stk_df['open'])

sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
sov_open = sov_df.pivot(index='date', columns='ticker', values='adj_open').sort_index()
stk_adj = stk_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
stk_open = stk_df.pivot(index='date', columns='ticker', values='adj_open').sort_index()

common_dates = sov_adj.index[sov_adj.index >= '2003-01-01']
sov_adj = sov_adj.reindex(common_dates).ffill()
sov_open = sov_open.reindex(common_dates).ffill()
stk_adj = stk_adj.reindex(common_dates).ffill()
stk_open = stk_open.reindex(common_dates).ffill()

domestic_tickers = [c for c in stk_adj.columns if not any(c.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]

stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
base_mom = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

stk_daily_ret = stk_adj.pct_change()
pos_days = (stk_daily_ret > 0).rolling(252).sum()
neg_days = (stk_daily_ret < 0).rolling(252).sum()
fip_252 = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

sov_ma200 = sov_adj.rolling(200).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

def simulate_with_yearly(mode="breadth_graded"):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    base_weights = [0.40, 0.30, 0.30]

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        next_month_end = month_ends[i+1]

        p_spy = sov_adj.loc[t_date, 'SPY']
        m200_spy = sov_ma200.loc[t_date, 'SPY']
        breadth = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5

        if mode == "baseline":
            exposure = 1.0 if (pd.notna(p_spy) and pd.notna(m200_spy) and p_spy >= m200_spy) else 0.0
        elif mode == "breadth_graded":
            if breadth >= 0.60: exposure = 1.0
            elif breadth >= 0.40: exposure = 0.70
            else: exposure = 0.0
        elif mode == "spy_plus_breadth":
            if pd.isna(p_spy) or pd.isna(m200_spy) or p_spy < m200_spy: exposure = 0.0
            elif breadth < 0.40: exposure = 0.50
            else: exposure = 1.0

        if exposure <= 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
        if len(future_dates) == 0: continue
        t_entry = future_dates[0]
        sub_dates = list(future_dates)

        valid_stks = []
        for s in domestic_tickers:
            sp = stk_adj.loc[t_date, s]; m6 = stk_ma60.loc[t_date, s]; m2 = stk_ma200.loc[t_date, s]
            bm = base_mom.loc[t_date, s]
            fip = fip_252.loc[t_date, s] if pd.notna(fip_252.loc[t_date, s]) else 0.0

            if pd.notna(sp) and pd.notna(m6) and pd.notna(bm) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and bm > 0:
                sc = bm if mode == "baseline" else bm * (1.0 + 0.5 * fip)
                valid_stks.append((s, sc))

        if len(valid_stks) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        valid_stks.sort(key=lambda x: x[1], reverse=True)
        picks = [x[0] for x in valid_stks[:3]]
        n = len(picks)

        w_sub = base_weights[:n]
        tot_w = sum(w_sub)
        actual_w = [w / tot_w * exposure for w in w_sub]

        month_end_d = sub_dates[-1]
        period_ret = 0.0
        for idx in range(n):
            sym = picks[idx]
            w = actual_w[idx]
            p_in = stk_open.loc[t_entry, sym] if sym in stk_open.columns else np.nan
            p_out = stk_open.loc[month_end_d, sym] if sym in stk_open.columns else np.nan
            r = (p_out / p_in - 1.0) if pd.notna(p_in) and p_in > 0 else 0.0
            period_ret += w * (r - friction)

        capital *= (1.0 + period_ret)
        equity.append(capital)
        dates.append(next_month_end)

    eq_s = pd.Series(equity, index=dates)
    tot_ret = (eq_s.iloc[-1] / eq_s.iloc[0] - 1.0) * 100.0
    mult = eq_s.iloc[-1] / eq_s.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_s - eq_s.cummax()) / eq_s.cummax()).min() * 100.0
    monthly_ret = eq_s.pct_change().dropna()
    rf = 0.02 / 12.0
    sharpe = ((monthly_ret - rf).mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0
    y_ret = eq_s.resample('YE').last().pct_change().dropna() * 100.0

    return {'tot_ret': tot_ret, 'mult': mult, 'cagr': cagr, 'mdd': mdd, 'sharpe': sharpe, 'calmar': calmar, 'y_ret': y_ret}

res_base = simulate_with_yearly("baseline")
res_breadth = simulate_with_yearly("breadth_graded")
res_spy_b = simulate_with_yearly("spy_plus_breadth")

print(f"{'指標':<15} | {'現狀基準 (SPY 200MA)':<22} | {'全球寬幅階梯 (Breadth Graded)':<25} | {'SPY 200MA + 寬幅防禦':<20}")
print("-" * 90)
print(f"{'年化 CAGR':<15} | {res_base['cagr']:>18.2f}% | {res_breadth['cagr']:>24.2f}% | {res_spy_b['cagr']:>18.2f}%")
print(f"{'最大回撤 MDD':<15} | {res_base['mdd']:>18.2f}% | {res_breadth['mdd']:>24.2f}% | {res_spy_b['mdd']:>18.2f}%")
print(f"{'卡瑪比率 Calmar':<15} | {res_base['calmar']:>18.2f}  | {res_breadth['calmar']:>24.2f}  | {res_spy_b['calmar']:>18.2f} ")
print(f"{'夏普比率 Sharpe':<15} | {res_base['sharpe']:>18.2f}  | {res_breadth['sharpe']:>24.2f}  | {res_spy_b['sharpe']:>18.2f} ")
print(f"{'總資產倍數':<15} | {res_base['mult']:>18.1f}x | {res_breadth['mult']:>24.1f}x | {res_spy_b['mult']:>18.1f}x")

print("\n=== 關鍵危機年份對比 (%) ===")
years_to_check = [2008, 2011, 2015, 2018, 2020, 2022, 2023, 2024, 2025]
header = f"{'年份':<8}" + f"{'現狀基準':>14}" + f"{'全球寬幅階梯':>18}" + f"{'SPY + 寬幅防禦':>18}"
print(header)
print("-" * len(header))
for y in years_to_check:
    v_b = res_base['y_ret'].get(pd.Timestamp(f"{y}-12-31"), np.nan)
    v_br = res_breadth['y_ret'].get(pd.Timestamp(f"{y}-12-31"), np.nan)
    v_sb = res_spy_b['y_ret'].get(pd.Timestamp(f"{y}-12-31"), np.nan)
    print(f"{y:<8} | {v_b:>11.1f}% | {v_br:>15.1f}% | {v_sb:>15.1f}%")
