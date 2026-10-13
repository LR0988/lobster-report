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

# 基本指標
stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
base_mom = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

stk_daily_ret = stk_adj.pct_change()
sov_ma200 = sov_adj.rolling(200).mean()

# 可能性 1: FIP (252天正負天數比)
pos_days = (stk_daily_ret > 0).rolling(252).sum()
neg_days = (stk_daily_ret < 0).rolling(252).sum()
fip_252 = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# 可能性 2: Kaufman Efficiency Ratio (KER, 趨勢效率噪聲比，視窗 126 天)
change_126 = (stk_adj - stk_adj.shift(126)).abs()
daily_diff_126 = (stk_adj - stk_adj.shift(1)).abs().rolling(126).sum()
ker_126 = change_126 / (daily_diff_126 + 1e-9) # 介於 0 到 1，越接近 1 代表路徑越直線平滑

# 可能性 3: 下行波動率懲罰 (Downside Deviation / Sortino Ratio Momentum)
downside_ret = stk_daily_ret.clip(upper=0.0)
downside_vol_252 = np.sqrt((downside_ret ** 2).rolling(252).mean()) * np.sqrt(252)
sortino_mom = base_mom / (downside_vol_252 + 1e-6)

# 可能性 4: 全球主權 ETF 宏觀寬幅 (Global Sovereign Breadth)
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1) # 0.0 ~ 1.0 全球大盤健康度

# 個股滾動波動率 (用於風險平價部位權重)
stk_vol_63 = stk_daily_ret.rolling(63).std() * np.sqrt(252)

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

def run_experiment(
    scoring_logic="fip",       # "baseline", "fip", "ker", "fip_ker", "sortino", "fip_sortino"
    sizing_logic="stepped",    # "stepped" (40/30/30), "risk_parity" (1/vol), "stepped_risk_parity"
    macro_regime="spy200",     # "spy200", "breadth_graded", "spy_and_breadth"
    use_breakeven=False
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    base_weights = [0.40, 0.30, 0.30]

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        next_month_end = month_ends[i+1]

        # 宏觀濾網
        p_spy = sov_adj.loc[t_date, 'SPY']
        m200_spy = sov_ma200.loc[t_date, 'SPY']
        breadth = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5

        exposure = 1.0
        if macro_regime == "spy200":
            if pd.isna(p_spy) or pd.isna(m200_spy) or p_spy < m200_spy:
                exposure = 0.0
        elif macro_regime == "breadth_graded":
            # 依全球寬幅分級: >60% 滿倉, 40-60% 70%倉, <40% 0倉
            if breadth >= 0.60: exposure = 1.0
            elif breadth >= 0.40: exposure = 0.70
            else: exposure = 0.0
        elif macro_regime == "spy_and_breadth":
            if pd.isna(p_spy) or pd.isna(m200_spy) or p_spy < m200_spy:
                exposure = 0.0
            elif breadth < 0.30: # 即使 SPY > 200MA 但全球寬幅崩潰，降至半倉
                exposure = 0.50

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
            sp = stk_adj.loc[t_date, s]
            m6 = stk_ma60.loc[t_date, s]
            m2 = stk_ma200.loc[t_date, s]
            bm = base_mom.loc[t_date, s]
            fip = fip_252.loc[t_date, s] if pd.notna(fip_252.loc[t_date, s]) else 0.0
            ker = ker_126.loc[t_date, s] if pd.notna(ker_126.loc[t_date, s]) else 0.0
            sort_sc = sortino_mom.loc[t_date, s] if pd.notna(sortino_mom.loc[t_date, s]) else 0.0

            if pd.notna(sp) and pd.notna(m6) and pd.notna(bm) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and bm > 0:
                if scoring_logic == "baseline":
                    sc = bm
                elif scoring_logic == "fip":
                    sc = bm * (1.0 + 0.5 * fip)
                elif scoring_logic == "ker":
                    sc = bm * (1.0 + 1.0 * ker)
                elif scoring_logic == "fip_ker":
                    sc = bm * (1.0 + 0.4 * fip + 0.6 * ker)
                elif scoring_logic == "sortino":
                    sc = sort_sc
                elif scoring_logic == "fip_sortino":
                    sc = sort_sc * (1.0 + 0.5 * fip)
                else:
                    sc = bm

                valid_stks.append((s, sc))

        if len(valid_stks) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        valid_stks.sort(key=lambda x: x[1], reverse=True)
        picks = [x[0] for x in valid_stks[:3]]
        n = len(picks)

        # 資金分配權重計算 (Sizing Logic)
        if sizing_logic == "stepped":
            w_sub = base_weights[:n]
            tot_w = sum(w_sub)
            actual_w = [w / tot_w * exposure for w in w_sub]
        elif sizing_logic == "risk_parity":
            # 逆波動率風險平價 (1 / vol)
            vols = [stk_vol_63.loc[t_date, s] for s in picks]
            inv_vols = [1.0 / (v if pd.notna(v) and v > 0.05 else 0.30) for v in vols]
            tot_inv = sum(inv_vols)
            actual_w = [iv / tot_inv * exposure for iv in inv_vols]
        elif sizing_logic == "stepped_risk_parity":
            # 結合名次階梯與逆波動率
            vols = [stk_vol_63.loc[t_date, s] for s in picks]
            inv_vols = [1.0 / (v if pd.notna(v) and v > 0.05 else 0.30) for v in vols]
            combined_scores = [base_weights[idx] * inv_vols[idx] for idx in range(n)]
            tot_c = sum(combined_scores)
            actual_w = [c / tot_c * exposure for c in combined_scores]

        pos_states = {}
        for idx in range(n):
            sym = picks[idx]
            w = actual_w[idx]
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

print("\n=== 深度思考全維度創新機制回測 (2004 - 2026, 22年全歷史) ===")
tests = [
    ("1. 現狀基準 (Baseline)", "baseline", "stepped", "spy200", False),
    ("2. 升級 FIP 漸進動能", "fip", "stepped", "spy200", False),
    ("3. KER 趨勢噪聲效率比 (Kaufman)", "ker", "stepped", "spy200", False),
    ("4. 複合 FIP + KER 雙質量濾網", "fip_ker", "stepped", "spy200", False),
    ("5. 逆波動率風險平價配權 (Risk Parity)", "fip", "risk_parity", "spy200", False),
    ("6. 階梯名次 x 逆波動率配權 (Stepped RP)", "fip", "stepped_risk_parity", "spy200", False),
    ("7. 全球主權寬幅階梯避險 (Breadth Graded)", "fip", "stepped", "breadth_graded", False),
    ("8. SPY 200MA + 全球寬幅極限避險", "fip", "stepped", "spy_and_breadth", False),
    ("9. 旗艦神盾: FIP + 階梯RP + SPY&寬幅 + 保本平手", "fip", "stepped_risk_parity", "spy_and_breadth", True),
    ("10. 旗艦終極版: FIP + 階梯RP + 保本平手 (SPY200)", "fip", "stepped_risk_parity", "spy200", True),
]

for name, sc_m, sz_m, reg_m, be in tests:
    res = run_experiment(scoring_logic=sc_m, sizing_logic=sz_m, macro_regime=reg_m, use_breakeven=be)
    print(f"{name:<45} | CAGR: {res['cagr']:>5.2f}% | MDD: {res['mdd']:>6.2f}% | Sharpe: {res['sharpe']:>4.2f} | Calmar: {res['calmar']:>4.2f} | 總乘數: {res['mult']:>8.1f}x")
