import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

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

# 全球主權 ETF 宏觀寬幅 (15 國核心主權指數)
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

# FIP 漸進式動能
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# 收益偏態凸性指標 (Upside Vol / Downside Vol)
downside_ret = px_daily_ret.clip(upper=0)
upside_ret = px_daily_ret.clip(lower=0)
upside_vol = upside_ret.rolling(60).std()
downside_vol = downside_ret.rolling(60).std().replace(0, 1e-6)
stk_convexity = (upside_vol / (downside_vol + 1e-6)).fillna(1.0)

mom_score_raw = (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)
mom_mat = mom_score_raw[stock_tickers]

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

def run_simulation_for_day(day_target):
    rebal_dates = []
    for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
        sub = grp[grp.dt.day >= day_target]
        if len(sub) > 0:
            rebal_dates.append(sub.iloc[0])
        else:
            rebal_dates.append(grp.iloc[-1])

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

    capital = 1000000.0
    equity = [capital]
    dates = [periods[0][0]]
    friction = 0.0015
    current_holdings = {}
    cash = capital
    holding_tenure = {}
    period_returns = []

    for p_idx, (t_date, t_in, t_out) in enumerate(periods):
        br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
        if br >= 0.60:
            exposure = 1.0
        elif br >= 0.40:
            exposure = 0.70
        else:
            exposure = 0.0

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

        current_port_val = cash + sum(current_holdings.values())
        current_weights = {s: val / current_port_val for s, val in current_holdings.items()} if current_port_val > 0 else {}

        if exposure <= 0 or len(valid_stks) == 0:
            target_alloc = {'CASH': 1.0}
            holding_tenure = {}
        else:
            selected_stks = []
            for s in list(current_holdings.keys()):
                tenure = holding_tenure.get(s, 0)
                info = ticker_info.get(s, None)
                if info is not None:
                    rank = info[0]
                    if rank <= 5 and tenure < 4:
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

            new_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}
            holding_tenure = new_tenure

            base_w = [0.40, 0.30, 0.30][:n]
            skews = [ticker_info[s][2] for s in selected_stks]
            comb_w = [bw * sk for bw, sk in zip(base_w, skews)]
            tot_cw = sum(comb_w)
            norm_weights = [cw / tot_cw for cw in comb_w]
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
        period_turnover = 0.0
        for sym in all_syms:
            if sym == 'CASH': continue
            c_w = current_weights.get(sym, 0.0)
            t_w = target_alloc.get(sym, 0.0)
            period_turnover += abs(t_w - c_w)

        period_friction = (period_turnover / 2.0) * friction
        curr_cap = equity[-1] * (1.0 - period_friction)
        period_ret = 0.0
        next_holdings = {}

        for sym, w in target_alloc.items():
            if sym == 'CASH':
                ret_s = 0.0
            else:
                in_p = px_open.loc[t_in, sym] if sym in px_open.columns else None
                out_p = px_open.loc[t_out, sym] if sym in px_open.columns else None
                ret_s = (out_p / in_p - 1.0) if (pd.notna(in_p) and in_p > 0 and pd.notna(out_p)) else 0.0
                next_holdings[sym] = curr_cap * w * (1.0 + ret_s)
            period_ret += w * ret_s

        capital = curr_cap * (1.0 + period_ret)
        current_holdings = next_holdings
        cash = capital - sum(next_holdings.values())
        equity.append(capital)
        dates.append(t_out)
        period_returns.append(period_ret)

    eq_series = pd.Series(equity, index=dates)
    tot_ret = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    mult = eq_series.iloc[-1] / eq_series.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_series - eq_series.cummax()) / eq_series.cummax()).min() * 100.0
    calmar = cagr / abs(mdd)
    
    p_rets = pd.Series(period_returns)
    sharpe = (p_rets.mean() / (p_rets.std() + 1e-9)) * np.sqrt(12)
    win_rate = (p_rets > 0).mean() * 100.0

    oos_eq = eq_series[eq_series.index >= '2018-01-01']
    if len(oos_eq) > 1:
        oos_mult = oos_eq.iloc[-1] / oos_eq.iloc[0]
        oos_yrs = (oos_eq.index[-1] - oos_eq.index[0]).days / 365.25
        oos_cagr = (oos_mult ** (1.0 / oos_yrs) - 1.0) * 100.0
        oos_mdd = ((oos_eq - oos_eq.cummax()) / oos_eq.cummax()).min() * 100.0
        oos_calmar = oos_cagr / abs(oos_mdd)
    else:
        oos_cagr, oos_mdd, oos_calmar = np.nan, np.nan, np.nan

    return {
        'day': day_target,
        'tot_ret': tot_ret,
        'mult': mult,
        'cagr': cagr,
        'mdd': mdd,
        'calmar': calmar,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'oos_cagr': oos_cagr,
        'oos_mdd': oos_mdd,
        'oos_calmar': oos_calmar
    }

print("=" * 80)
print("【全面窮舉實驗】1~30 號 每天作為定期開倉日之 22 年貫穿回測對決")
print("=" * 80)

all_results = []
for d in range(1, 31):
    res = run_simulation_for_day(d)
    all_results.append(res)
    print(f"Day {d:2d}: CAGR {res['cagr']:5.2f}% | MDD {res['mdd']:6.2f}% | Calmar {res['calmar']:5.3f} | Sharpe {res['sharpe']:4.2f} | 22年累積倍數 {res['mult']:8,.1f}倍 | 盲測CAGR {res['oos_cagr']:5.2f}%")

df = pd.DataFrame(all_results)
df.to_csv("all_30_days_rebalance_results.csv", index=False)

print("\n" + "=" * 80)
print("【統計分佈概況 (Summary Statistics Across All 30 Days)】")
print("=" * 80)
print(f"平均 CAGR (Mean)      : {df['cagr'].mean():.2f}% (標準差 {df['cagr'].std():.2f}%)")
print(f"中位數 CAGR (Median)  : {df['cagr'].median():.2f}%")
print(f"最低 CAGR (Min)       : {df['cagr'].min():.2f}% (出現在 Day {df.loc[df['cagr'].idxmin(), 'day']})")
print(f"最高 CAGR (Max)       : {df['cagr'].max():.2f}% (出現在 Day {df.loc[df['cagr'].idxmax(), 'day']})")
print("-" * 50)
print(f"平均 MDD (Mean)       : {df['mdd'].mean():.2f}%")
print(f"最低回撤 (Best MDD)   : {df['mdd'].max():.2f}% (出現在 Day {df.loc[df['mdd'].idxmax(), 'day']})")
print(f"最大回撤 (Worst MDD)  : {df['mdd'].min():.2f}% (出現在 Day {df.loc[df['mdd'].idxmin(), 'day']})")
print("-" * 50)
print(f"平均 Calmar (Mean)    : {df['calmar'].mean():.3f}")
print(f"最高 Calmar (Best)    : {df['calmar'].max():.3f} (出現在 Day {df.loc[df['calmar'].idxmax(), 'day']})")

print("\n" + "=" * 80)
print("【Top 5 表現最頂尖的開倉日 (依 Calmar 排序)】")
print("=" * 80)
top5 = df.sort_values(by='calmar', ascending=False).head(5)
print(top5[['day', 'cagr', 'mdd', 'calmar', 'sharpe', 'mult', 'oos_cagr']].to_string(index=False))

print("\n" + "=" * 80)
print("【Bottom 5 表現相對較差的開倉日 (依 Calmar 排序)】")
print("=" * 80)
bot5 = df.sort_values(by='calmar', ascending=True).head(5)
print(bot5[['day', 'cagr', 'mdd', 'calmar', 'sharpe', 'mult', 'oos_cagr']].to_string(index=False))
