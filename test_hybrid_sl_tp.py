import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

conn = sqlite3.connect(DB_PATH)
sov_df = pd.read_sql_query("SELECT ticker, date, open, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
stk_df = pd.read_sql_query("SELECT ticker, date, open, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
conn.close()

sov_df['date'] = pd.to_datetime(sov_df['date'])
stk_df['date'] = pd.to_datetime(stk_df['date'])

sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
sov_open = sov_df.pivot(index='date', columns='ticker', values='open').sort_index()
stk_adj = stk_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
stk_open = stk_df.pivot(index='date', columns='ticker', values='open').sort_index()

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
stk_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]
sov_ma200 = sov_adj.rolling(200).mean()

# 1. 預先計算每月的宏觀狀態與 Top 3 選股 (大幅加速)
month_plans = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    next_month_end = month_ends[i+1]

    # SPY 200MA
    p_spy = sov_adj.loc[t_date, 'SPY']
    m200_spy = sov_ma200.loc[t_date, 'SPY']
    macro_ok = True
    if pd.notna(p_spy) and pd.notna(m200_spy) and p_spy < m200_spy:
        macro_ok = False

    future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
    if len(future_dates) == 0:
        continue
    t_entry = future_dates[0]
    sub_dates = list(future_dates)

    if not macro_ok:
        month_plans.append({'macro_ok': False, 't_entry': t_entry, 'sub_dates': sub_dates, 'next_month_end': next_month_end, 'picks': []})
        continue

    valid_stks = []
    for s in domestic_tickers:
        sp = stk_adj.loc[t_date, s]; m6 = stk_ma60.loc[t_date, s]; m2 = stk_ma200.loc[t_date, s]; sc = stk_score.loc[t_date, s]
        if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
            valid_stks.append((s, sc))
    valid_stks.sort(key=lambda x: x[1], reverse=True)
    picks = [x[0] for x in valid_stks[:3]]
    month_plans.append({'macro_ok': True, 't_entry': t_entry, 'sub_dates': sub_dates, 'next_month_end': next_month_end, 'picks': picks})

def run_advanced_model(hard_sl_pct=None, breakeven_trigger=None, trail_trigger=None, trail_dd=None):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    trades_list = []
    target_weights = [0.40, 0.30, 0.30]

    for plan in month_plans:
        next_month_end = plan['next_month_end']
        if not plan['macro_ok'] or len(plan['picks']) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        picks = plan['picks']
        t_entry = plan['t_entry']
        sub_dates = plan['sub_dates']

        n_pick = len(picks)
        active_weights = target_weights[:n_pick]
        tot_w = sum(active_weights)
        active_weights = [w / tot_w for w in active_weights]

        slot_returns = []
        for s_idx, sym in enumerate(picks):
            w = active_weights[s_idx]
            p_entry = stk_open.loc[t_entry, sym] if sym in stk_open.columns else None
            if pd.isna(p_entry) or p_entry <= 0:
                p_entry = stk_adj.loc[sub_dates[0], sym]

            peak_px = p_entry
            exit_px = None
            exit_date = None
            exit_reason = "月底換股"

            for d_idx, cur_d in enumerate(sub_dates):
                cur_close = stk_adj.loc[cur_d, sym] if sym in stk_adj.columns else None
                if pd.isna(cur_close) or cur_close <= 0: continue

                if cur_close > peak_px:
                    peak_px = cur_close

                cur_gain = cur_close / p_entry - 1.0
                max_gain = peak_px / p_entry - 1.0

                # 1. 硬停損 (Catastrophic SL)
                if hard_sl_pct is not None and cur_gain <= -hard_sl_pct:
                    if d_idx + 1 < len(sub_dates):
                        next_d = sub_dates[d_idx + 1]
                        exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                        exit_date = next_d
                    else:
                        exit_px = cur_close; exit_date = cur_d
                    exit_reason = f"大災難硬停損 (-{hard_sl_pct*100:.0f}%)"
                    break

                # 2. 高位移動停利 (Trailing Stop)
                if trail_trigger is not None and trail_dd is not None:
                    dd_from_peak = cur_close / peak_px - 1.0
                    if max_gain >= trail_trigger and dd_from_peak <= -trail_dd:
                        if d_idx + 1 < len(sub_dates):
                            next_d = sub_dates[d_idx + 1]
                            exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                            exit_date = next_d
                        else:
                            exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"高位移動停利 (曾達+{max_gain*100:.1f}%, 回吐{trail_dd*100:.0f}%)"
                        break

                # 3. 保本防護線 (Breakeven Lock)
                if breakeven_trigger is not None:
                    if max_gain >= breakeven_trigger and cur_gain <= 0.01:
                        if d_idx + 1 < len(sub_dates):
                            next_d = sub_dates[d_idx + 1]
                            exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                            exit_date = next_d
                        else:
                            exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"保本防護鎖定 (曾達+{breakeven_trigger*100:.0f}%)"
                        break

            if exit_px is None:
                last_d = sub_dates[-1]
                exit_px = stk_open.loc[last_d, sym] if pd.notna(stk_open.loc[last_d, sym]) else stk_adj.loc[last_d, sym]
                exit_date = last_d

            ret_trade = (exit_px / p_entry - 1.0) - friction
            slot_returns.append(ret_trade * w)
            trades_list.append({
                'ticker': sym, 'ret': ret_trade * 100.0, 'reason': exit_reason
            })

        period_net_ret = sum(slot_returns)
        capital *= (1.0 + period_net_ret)
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
    excess_ret = monthly_ret - rf
    sharpe = (excess_ret.mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

    df_tr = pd.DataFrame(trades_list)
    win_rate = (df_tr['ret'] > 0).mean() * 100.0
    worst_tr = df_tr['ret'].min()
    best_tr = df_tr['ret'].max()
    stopped_cnt = df_tr['reason'].str.contains("停損").sum()
    be_cnt = df_tr['reason'].str.contains("保本").sum()
    trail_cnt = df_tr['reason'].str.contains("移動").sum()

    return {
        'cagr': cagr, 'mult': mult, 'mdd': mdd, 'calmar': calmar, 'sharpe': sharpe,
        'win_rate': win_rate, 'worst_tr': worst_tr, 'best_tr': best_tr,
        'stopped_cnt': stopped_cnt, 'be_cnt': be_cnt, 'trail_cnt': trail_cnt
    }

combos = [
    ("現狀基準 (無停損無停利)", None, None, None, None),
    ("方案 1: 純保本防護 (達+20%保本)", None, 0.20, None, None),
    ("方案 2: 純保本防護 (達+15%保本)", None, 0.15, None, None),
    ("方案 3: 寬鬆大災難停損 -30%", 0.30, None, None, None),
    ("方案 4: 寬鬆大災難停損 -25%", 0.25, None, None, None),
    ("方案 5: 寬鬆大災難 -30% + 保本+20%", 0.30, 0.20, None, None),
    ("方案 6: 寬鬆大災難 -25% + 保本+20%", 0.25, 0.20, None, None),
    ("方案 7: 寬鬆大災難 -25% + 保本+20% + 移動(+50%回20%)", 0.25, 0.20, 0.50, 0.20),
    ("方案 8: 寬鬆大災難 -25% + 保本+20% + 移動(+40%回15%)", 0.25, 0.20, 0.40, 0.15),
    ("方案 9: 中度停損 -20% + 保本+20% + 移動(+50%回20%)", 0.20, 0.20, 0.50, 0.20),
    ("方案 10: 緊縮停損 -15% (傳統認知)", 0.15, None, None, None),
    ("方案 11: 緊縮停損 -10% (傳統認知)", 0.10, None, None, None),
]

print("\n" + "="*105)
print(f"{'方案名稱':<36} {'CAGR':>7} {'累積倍數':>9} {'MDD':>8} {'Calmar':>7} {'Sharpe':>7} {'勝率':>6} {'最慘單筆':>8} {'停損次':>6} {'保本次':>6}")
print("="*105)

for name, sl, be, tt, td in combos:
    res = run_advanced_model(hard_sl_pct=sl, breakeven_trigger=be, trail_trigger=tt, trail_dd=td)
    print(f"{name:<36} {res['cagr']:>6.2f}% {res['mult']:>8.1f}x {res['mdd']:>7.2f}% {res['calmar']:>7.3f} {res['sharpe']:>7.2f} {res['win_rate']:>5.1f}% {res['worst_tr']:>7.2f}% {res['stopped_cnt']:>6} {res['be_cnt']:>6}")
print("="*105)
