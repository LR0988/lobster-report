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
stk_ma200_slope = (stk_ma200 - stk_ma200.shift(20)) / stk_ma200.shift(20) # 200MA 趨勢向上

stk_mom12m = stk_adj.pct_change(252)
stk_mom6m = stk_adj.pct_change(126)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
raw_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

sov_ma200 = sov_adj.rolling(200).mean()
sov_ma60 = sov_adj.rolling(60).mean()

# 每日收益率
stk_daily_ret = stk_adj.pct_change()
spy_daily_ret = sov_adj['SPY'].pct_change()

# FIP 視窗測試: 63天 (短波 FIP), 126天 (半年 FIP), 252天 (一年 FIP)
def calc_fip(window):
    pos = (stk_daily_ret > 0).rolling(window).sum()
    neg = (stk_daily_ret < 0).rolling(window).sum()
    return (pos - neg) / (pos + neg + 1e-9)

fip_252 = calc_fip(252)
fip_126 = calc_fip(126)
fip_63 = calc_fip(63)

# 殘差動能 (Residual Momentum, Blitz 2011) 簡化估算: 
# 計算個股相對於 SPY 的滾動 Beta 與殘差收益 Alpha
# 滾動 252 天 Cov(stock, SPY) / Var(SPY)
cov_spy = stk_daily_ret.rolling(252).cov(spy_daily_ret)
var_spy = spy_daily_ret.rolling(252).var()
beta_spy = cov_spy.div(var_spy, axis=0).clip(-0.5, 3.0)
# 殘差收益率 = 個股動能 - Beta * SPY 動能
spy_mom12m = sov_adj['SPY'].pct_change(252)
spy_mom3m = sov_adj['SPY'].pct_change(63)
spy_mom1m = sov_adj['SPY'].pct_change(21)
spy_raw_score = 0.50 * spy_mom12m + 0.30 * spy_mom3m + 0.20 * spy_mom1m
# 殘差超額得分
res_score = raw_score.sub(beta_spy.mul(spy_raw_score, axis=0), axis=0)

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

def run_fine_test(
    fip_type="252",           # "none", "252", "126", "63", "multi_fip"
    fip_weight=1.0,           # Score * (1 + fip_weight * FIP)
    macro_filter="spy200",    # "spy200", "spy200_and_60", "spy_trend"
    use_ma200_slope=False,    # 要求選股標的 200MA 斜率 > 0
    use_residual=False,       # 使用殘差動能
    use_breakeven=False
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    target_weights = [0.40, 0.30, 0.30]

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        next_month_end = month_ends[i+1]

        # 宏觀避險濾網
        p_spy = sov_adj.loc[t_date, 'SPY']
        m200_spy = sov_ma200.loc[t_date, 'SPY']
        m60_spy = sov_ma60.loc[t_date, 'SPY']

        macro_ok = True
        if macro_filter == "spy200":
            if pd.isna(p_spy) or pd.isna(m200_spy) or p_spy < m200_spy:
                macro_ok = False
        elif macro_filter == "spy200_and_60":
            # 雙重均線過濾: 跌破 200MA 或 60MA 均減碼或空倉
            if pd.isna(p_spy) or pd.isna(m200_spy) or pd.isna(m60_spy) or p_spy < m200_spy or p_spy < m60_spy:
                macro_ok = False

        if not macro_ok:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
        if len(future_dates) == 0: continue
        t_entry = future_dates[0]
        sub_dates = list(future_dates)

        valid_stks = []
        for s in domestic_tickers:
            sp = stk_adj.loc[t_date, s]
            m6 = stk_ma60.loc[t_date, s]
            m2 = stk_ma200.loc[t_date, s]
            slope = stk_ma200_slope.loc[t_date, s]
            sc = raw_score.loc[t_date, s] if not use_residual else res_score.loc[t_date, s]

            # 股票基本過濾
            cond = pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0
            if use_ma200_slope and pd.notna(slope):
                cond = cond and (slope > 0)

            if cond:
                # 計算 FIP 加乘
                if fip_type == "none":
                    final_sc = sc
                elif fip_type == "252":
                    f = fip_252.loc[t_date, s]
                    final_sc = sc * (1.0 + fip_weight * (f if pd.notna(f) else 0.0))
                elif fip_type == "126":
                    f = fip_126.loc[t_date, s]
                    final_sc = sc * (1.0 + fip_weight * (f if pd.notna(f) else 0.0))
                elif fip_type == "63":
                    f = fip_63.loc[t_date, s]
                    final_sc = sc * (1.0 + fip_weight * (f if pd.notna(f) else 0.0))
                elif fip_type == "multi_fip":
                    # 結合長短期漸進動能
                    f252 = fip_252.loc[t_date, s] if pd.notna(fip_252.loc[t_date, s]) else 0.0
                    f63 = fip_63.loc[t_date, s] if pd.notna(fip_63.loc[t_date, s]) else 0.0
                    f_comb = 0.6 * f252 + 0.4 * f63
                    final_sc = sc * (1.0 + fip_weight * f_comb)
                else:
                    final_sc = sc

                valid_stks.append((s, final_sc))

        if len(valid_stks) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        valid_stks.sort(key=lambda x: x[1], reverse=True)
        picks = [x[0] for x in valid_stks[:3]]

        n = len(picks)
        weights = [target_weights[idx] for idx in range(n)]

        pos_states = {}
        for idx in range(n):
            sym = picks[idx]
            w = weights[idx]
            entry_p = stk_open.loc[t_entry, sym] if sym in stk_open.columns else np.nan
            if pd.notna(entry_p) and entry_p > 0:
                pos_states[sym] = {
                    'w': w,
                    'entry_p': entry_p,
                    'peak_ret': 0.0,
                    'hit_be': False,
                    'status': 'HOLD',
                    'exit_ret': 0.0
                }

        for d in sub_dates[1:]:
            for sym, state in pos_states.items():
                if state['status'] != 'HOLD': continue
                open_p = stk_open.loc[d, sym]
                if pd.isna(open_p) or open_p <= 0: continue
                day_ret = open_p / state['entry_p'] - 1.0
                if day_ret > state['peak_ret']: state['peak_ret'] = day_ret
                if use_breakeven:
                    if state['peak_ret'] >= 0.20: state['hit_be'] = True
                    if state['hit_be'] and day_ret <= 0.0:
                        state['status'] = 'EXIT_BE'
                        state['exit_ret'] = -friction

        month_end_d = sub_dates[-1]
        period_ret = 0.0
        for sym, state in pos_states.items():
            if state['status'] == 'HOLD':
                final_p = stk_open.loc[month_end_d, sym]
                stock_ret = (final_p / state['entry_p'] - 1.0) if pd.notna(final_p) and final_p > 0 else 0.0
                net_ret = stock_ret - friction
            else:
                net_ret = state['exit_ret']
            period_ret += state['w'] * net_ret

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

    return {'tot_ret': tot_ret, 'mult': mult, 'cagr': cagr, 'mdd': mdd, 'sharpe': sharpe, 'calmar': calmar}

print("\n=== 深度細化實驗 (FIP 參數、殘差動能、均線斜率、雙重濾網) ===")
experiments = [
    ("A0. 現行基準 (Raw Momentum)", "none", 1.0, "spy200", False, False, False),
    ("A1. FIP 252 (權重 1.0)", "252", 1.0, "spy200", False, False, False),
    ("A2. FIP 252 (權重 0.5)", "252", 0.5, "spy200", False, False, False),
    ("A3. FIP 252 (權重 1.5)", "252", 1.5, "spy200", False, False, False),
    ("A4. FIP 126 (半年漸進動能)", "126", 1.0, "spy200", False, False, False),
    ("A5. FIP 63 (季漸進動能)", "63", 1.0, "spy200", False, False, False),
    ("A6. 多週期複合 FIP (0.6*252 + 0.4*63)", "multi_fip", 1.0, "spy200", False, False, False),
    ("B1. FIP 252 + 200MA 斜率濾網 (>0 向上)", "252", 1.0, "spy200", True, False, False),
    ("B2. FIP 252 + 雙重宏觀濾網 (SPY>200MA & 60MA)", "252", 1.0, "spy200_and_60", False, False, False),
    ("B3. 殘差動能 (Residual Momentum)", "none", 1.0, "spy200", False, True, False),
    ("B4. 殘差動能 + FIP 252", "252", 1.0, "spy200", False, True, False),
    ("C1. 最佳冠軍 FIP 252 + 保本平手線", "252", 1.0, "spy200", False, False, True),
    ("C2. 最佳冠軍 多週期 FIP + 保本平手線", "multi_fip", 1.0, "spy200", False, False, True),
]

for name, ftype, fweight, mfilter, slope, resm, be in experiments:
    res = run_fine_test(fip_type=ftype, fip_weight=fweight, macro_filter=mfilter, use_ma200_slope=slope, use_residual=resm, use_breakeven=be)
    print(f"{name:<45} | CAGR: {res['cagr']:>5.2f}% | MDD: {res['mdd']:>6.2f}% | Sharpe: {res['sharpe']:>4.2f} | Calmar: {res['calmar']:>4.2f} | 總乘數: {res['mult']:>8.1f}x")
