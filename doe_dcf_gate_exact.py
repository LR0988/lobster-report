#!/usr/bin/env python3
"""
doe_dcf_gate_exact.py
使用實盤完全一致的 Titan 2.0 雙梯隊 (Tranche 1 & 22) 核心引擎
執行全因子 DOE (Design of Experiments) 網格大撒網掃描：
驗證 QQQ 乖離門檻 (15% ~ 45%) 與 US10Y 利率門檻 (2.0% ~ 5.0%) 是否為最佳？
是否存在過度擬合 (Overfitting)？參數高原 (Plateau) 的形狀與敏感度為何？
"""

import sqlite3
import pandas as pd
import numpy as np
import yfinance as yf

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def prepare_exact_data():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily WHERE open IS NOT NULL AND adj_close IS NOT NULL ORDER BY date ASC", conn)
    sov_df = pd.read_sql_query("SELECT ticker, date, close, adj_close FROM global_sovereign_daily WHERE adj_close IS NOT NULL ORDER BY date ASC", conn)
    m_df = pd.read_sql_query("SELECT date, us10y FROM macro_indicators WHERE us10y IS NOT NULL ORDER BY date ASC", conn)
    conn.close()

    df['date'] = pd.to_datetime(df['date'])
    sov_df['date'] = pd.to_datetime(sov_df['date'])
    df = df[df['date'].dt.dayofweek < 5].copy()
    sov_df = sov_df[sov_df['date'].dt.dayofweek < 5].copy()

    valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
    df = df[df['ticker'].isin(valid_tickers)].copy()
    df['adj_factor'] = np.where(df['close'] > 0, df['adj_close'] / df['close'], 1.0)
    df['open_adj'] = df['open'] * df['adj_factor']

    px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
    px_open = df.pivot(index='date', columns='ticker', values='open_adj').sort_index()
    px_vol = df.pivot(index='date', columns='ticker', values='volume').sort_index()
    sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

    common_dates = px_adj.index[(px_adj.index >= '2003-01-01') & (px_adj.index.isin(sov_adj.index))]
    px_adj = px_adj.reindex(common_dates).ffill()
    px_open = px_open.reindex(common_dates).ffill()
    px_vol = px_vol.reindex(common_dates).fillna(0)
    sov_adj = sov_adj.reindex(common_dates).ffill()

    ret_1d = px_adj.pct_change(fill_method=None)
    ret_next = px_adj.pct_change(-1, fill_method=None)
    spike_mask = (ret_1d.abs() > 0.20) & (ret_next.abs() > 0.20) & ((ret_1d * ret_next) > 0)
    px_adj[spike_mask] = np.nan
    px_open[spike_mask] = np.nan
    px_adj = px_adj.ffill()
    px_open = px_open.ffill()

    stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

    ma60 = px_adj.rolling(60).mean()
    ma200 = px_adj.rolling(200).mean()
    bias60 = (px_adj / (ma60 + 1e-9)) - 1.0

    mom2w = px_adj.pct_change(10)
    mom1m = px_adj.pct_change(21)
    mom3m = px_adj.pct_change(63)
    mom12m = px_adj.pct_change(252)

    spy_ret1m = sov_adj['SPY'].pct_change(21)
    spy_ret3m = sov_adj['SPY'].pct_change(63)
    spy_ret12m = sov_adj['SPY'].pct_change(252)

    candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
    etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
    sov_ma200 = sov_adj.rolling(200).mean()
    sov_ma60 = sov_adj.rolling(60).mean()
    global_15_br = 0.75 * (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).mean(axis=1) + 0.25 * (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).mean(axis=1)
    core_etfs = [e for e in ['SPY', 'QQQ', 'EWT'] if e in sov_adj.columns]
    core_br = 0.60 * (sov_adj[core_etfs] > sov_ma200[core_etfs]).mean(axis=1) + 0.40 * (sov_adj[core_etfs] > sov_ma60[core_etfs]).mean(axis=1)
    global_breadth = 0.50 * global_15_br + 0.50 * core_br

    gld_p = sov_adj['GLD']
    gld_ma60 = gld_p.rolling(60).mean()
    gld_ma200 = gld_p.rolling(200).mean()
    gld_mom3m = gld_p.pct_change(63)
    gld_ret_1d = gld_p.pct_change().fillna(0.0)
    bil_ret_1d = sov_adj['BIL'].pct_change().fillna(0.00008).clip(-0.01, 0.01)
    gld_cond = ((gld_p > gld_ma60) & (gld_p > gld_ma200) & (gld_mom3m > 0.02) & (gld_ret_1d.abs() < 0.08)).shift(1).fillna(False)
    safe_cash_ret = pd.Series(np.where(gld_cond, 0.50 * gld_ret_1d + 0.50 * bil_ret_1d, bil_ret_1d), index=px_adj.index).fillna(0.0)

    px_daily_ret = px_adj.pct_change()
    pos_days = (px_daily_ret > 0).rolling(252).sum()
    neg_days = (px_daily_ret < 0).rolling(252).sum()
    fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

    downside_vol_60d = (px_daily_ret.clip(upper=0.0).rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    upside_vol_60d = (px_daily_ret.clip(lower=0.0).rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    stk_convexity = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

    spy_d_ret = sov_adj['SPY'].pct_change()
    spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)
    betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
    for s in stock_tickers:
        cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
        betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

    res_mom12m = mom12m[stock_tickers].sub(spy_ret12m, axis=0) * 0.5 + (mom12m[stock_tickers] - betas_126.mul(spy_ret12m, axis=0)) * 0.5
    res_mom3m = mom3m[stock_tickers] - betas_126.mul(spy_ret3m, axis=0)
    res_mom1m = mom1m[stock_tickers] - betas_126.mul(spy_ret1m, axis=0)
    res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)
    raw_mom_core = (0.45 * mom12m[stock_tickers] + 0.35 * mom3m[stock_tickers] + 0.20 * mom1m[stock_tickers])

    vol_ma60 = px_vol.rolling(60).mean()
    vol_5d_mean = px_vol.rolling(5).mean()
    churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

    blend_mom_core = 0.85 * raw_mom_core + 0.15 * res_mom_core
    fip_mult = 1.0 + 0.5 * fip_mat[stock_tickers]
    conv_mult = 1.0 + 0.20 * (stk_convexity[stock_tickers] - 1.0).clip(-0.5, 2.0)
    p_damp = 1.0 / (1.0 + 1.2 * (bias60[stock_tickers] - 0.65))
    parabolic_damper = pd.DataFrame(np.where(bias60[stock_tickers] > 0.65, p_damp, 1.0), index=bias60.index, columns=stock_tickers)
    mom_agg = blend_mom_core * fip_mult * conv_mult * parabolic_damper

    # US10Y 拼接完整歷史數據 (2000 ~ 2026)
    m_df['date'] = pd.to_datetime(m_df['date'], format='%Y%m%d')
    m_s = m_df.set_index('date')['us10y']
    tnx = yf.download('^TNX', start='2000-01-01', end='2005-01-10', progress=False)['Close']
    if isinstance(tnx, pd.DataFrame): tnx = tnx.squeeze()
    tnx.index = pd.to_datetime(tnx.index)
    full_us10y = pd.concat([tnx[tnx.index < m_s.index.min()], m_s]).sort_index()
    us10y_series = full_us10y.reindex(px_adj.index).ffill()

    qqq_p = sov_adj['QQQ']
    qqq_bias_dict = {}
    for ma in [250, 375, 500, 750]:
        ma_s = qqq_p.rolling(ma).mean()
        qqq_bias_dict[ma] = (qqq_p - ma_s) / ma_s * 100.0

    all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

    return {
        'px_adj': px_adj, 'px_open': px_open, 'stock_tickers': stock_tickers,
        'ma60': ma60, 'ma200': ma200, 'mom_agg': mom_agg,
        'global_breadth': global_breadth, 'safe_cash_ret': safe_cash_ret,
        'churn_exhaustion': churn_exhaustion, 'us10y_series': us10y_series,
        'qqq_bias_dict': qqq_bias_dict, 'all_dates': all_dates
    }

def run_titan_backtest(data, bias_thresh=30.0, us10y_thresh=3.5, ma_len=500, target_exposure=0.70):
    px_adj = data['px_adj']
    px_open = data['px_open']
    stock_tickers = data['stock_tickers']
    ma60 = data['ma60']
    ma200 = data['ma200']
    mom_agg = data['mom_agg']
    global_breadth = data['global_breadth']
    safe_cash_ret = data['safe_cash_ret']
    churn_exhaustion = data['churn_exhaustion']
    us10y_series = data['us10y_series']
    qqq_bias = data['qqq_bias_dict'][ma_len]
    all_dates = data['all_dates']

    def get_fee(symbol, is_sell=False):
        if symbol.endswith('.TW'):
            return (0.001425 * 0.28) + (0.003 if is_sell else 0.0)
        return 0.0005

    base_weights = [0.40, 0.30, 0.30]

    def sim_tranche(day_target, init_cap=500000.0):
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

        all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        cash = init_cap
        holdings = {}
        holding_tenure = {}
        p_idx = 0
        num_p = len(periods)
        trig_count = 0
        total_rebal = 0

        for t_idx, current_dt in enumerate(all_sim_dates):
            if cash > 0:
                cash *= (1.0 + float(safe_cash_ret.loc[current_dt]))

            if p_idx < num_p and current_dt == periods[p_idx][1]:
                t_date, t_in, t_out = periods[p_idx]
                total_rebal += 1
                cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)

                br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
                if br >= 0.50: base_exp = 1.0
                elif br >= 0.30: base_exp = 0.70
                else: base_exp = 0.0

                # 宏觀雙因子檢驗
                qb = qqq_bias.loc[t_date] if t_date in qqq_bias.index else 0.0
                rate = us10y_series.loc[t_date] if t_date in us10y_series.index else 0.0

                if base_exp > 0.0:
                    b_cond = (qb >= bias_thresh) if (bias_thresh is not None) else True
                    r_cond = (rate >= us10y_thresh) if (us10y_thresh is not None) else True
                    if b_cond and r_cond:
                        trig_count += 1
                        exposure = min(base_exp, target_exposure)
                    else:
                        exposure = base_exp
                else:
                    exposure = 0.0

                valid_stks = []
                for s in stock_tickers:
                    sp = px_adj.loc[t_date, s]
                    m6 = ma60.loc[t_date, s]
                    m2 = ma200.loc[t_date, s]
                    sc = mom_agg.loc[t_date, s]
                    if pd.notna(sp) and pd.notna(sc) and pd.notna(m6) and pd.notna(m2):
                        if sp > m6 and sp > m2 and sc > 0:
                            if not (churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False):
                                valid_stks.append((s, sc))

                valid_stks.sort(key=lambda x: x[1], reverse=True)
                ranked_tickers = [x[0] for x in valid_stks]
                ticker_info = {x[0]: idx + 1 for idx, x in enumerate(valid_stks)}

                if exposure <= 0 or len(valid_stks) == 0:
                    for s, hinfo in list(holdings.items()):
                        out_px = px_open.loc[t_in, s]
                        cash += hinfo['shares'] * out_px * (1.0 - get_fee(s, is_sell=True))
                    holdings.clear()
                    holding_tenure = {}
                else:
                    selected_stks = []
                    for s in list(holdings.keys()):
                        tenure = holding_tenure.get(s, 0)
                        info = ticker_info.get(s, None)
                        if info is not None and info <= 5 and tenure < 4:
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
                    norm_weights = [w / tot_bw for w in bw_slice]
                    target_alloc = {selected_stks[idx]: norm_weights[idx] * exposure for idx in range(n)}

                    for s in list(holdings.keys()):
                        if s not in target_alloc:
                            out_px = px_open.loc[t_in, s]
                            cash += holdings[s]['shares'] * out_px * (1.0 - get_fee(s, is_sell=True))
                            del holdings[s]

                    cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)
                    for s, tgt_w in target_alloc.items():
                        if s in holdings:
                            op = float(px_open.loc[t_in, s])
                            cur_sh = holdings[s]['shares']
                            cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                            if abs(cur_w - tgt_w) > 0.05 and (cur_val * tgt_w) < (cur_sh * op):
                                sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                                cash += sell_sh * op * (1.0 - get_fee(s, is_sell=True))
                                holdings[s]['shares'] -= sell_sh

                    for s, tgt_w in target_alloc.items():
                        op = float(px_open.loc[t_in, s])
                        cur_sh = holdings[s]['shares'] if s in holdings else 0.0
                        cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                        if s in holdings and abs(cur_w - tgt_w) <= 0.05:
                            continue
                        diff_val = (cur_val * tgt_w) - (cur_sh * op)
                        if diff_val > 0 and cash > 0 and op > 0:
                            actual_buy = min(cash, diff_val)
                            fee = actual_buy * get_fee(s, is_sell=False)
                            sh = (actual_buy - fee) / op
                            cash -= actual_buy
                            if s in holdings: holdings[s]['shares'] += sh
                            else: holdings[s] = {'shares': sh, 'entry_px': op}

                p_idx += 1

            stk_val = sum(info['shares'] * px_adj.loc[current_dt, s] for s, info in holdings.items() if pd.notna(px_adj.loc[current_dt, s]))
            daily_equity.loc[current_dt] = cash + stk_val

        return daily_equity.dropna(), trig_count, total_rebal

    eq_a, t_a, tot_a = sim_tranche(1, 500000.0)
    eq_b, t_b, tot_b = sim_tranche(22, 500000.0)
    comm = eq_a.index.intersection(eq_b.index)
    eq = eq_a.loc[comm] + eq_b.loc[comm]

    yrs = (comm[-1] - comm[0]).days / 365.25
    cagr = ((eq.iloc[-1] / eq.iloc[0]) ** (1.0 / yrs) - 1.0) * 100.0
    m_eq = eq.resample('ME').last()
    m_mdd = ((m_eq / m_eq.cummax()) - 1.0).min() * 100.0
    d_mdd = ((eq / eq.cummax()) - 1.0).min() * 100.0
    calmar = cagr / abs(m_mdd)
    mult = eq.iloc[-1] / eq.iloc[0]
    trig_rate = (t_a + t_b) / (tot_a + tot_b) * 100.0

    return {
        'CAGR': round(cagr, 2),
        'Month_MDD': round(m_mdd, 2),
        'Daily_MDD': round(d_mdd, 2),
        'Calmar': round(calmar, 2),
        'Multiplier': round(mult, 1),
        'Trigger_Count': t_a + t_b,
        'Trigger_Rate_%': round(trig_rate, 1)
    }

def main():
    data = prepare_exact_data()
    print("[1/4] 資料載入完畢，開始執行實盤標準版 DOE 網格掃描...")

    # 基準無閥門對照組
    bm = run_titan_backtest(data, bias_thresh=None, us10y_thresh=None, target_exposure=1.0)
    print(f"\n📌 【實盤基準無閥門 (100% Full Throttle)】: CAGR={bm['CAGR']}%, 月MDD={bm['Month_MDD']}%, Calmar={bm['Calmar']}, 獲利倍數={bm['Multiplier']}x\n")

    # 大撒條件掃描：QQQ 乖離率 (15% ~ 45%) x US10Y 利率 (2.0% ~ 5.0%)
    bias_list = [15.0, 20.0, 25.0, 28.0, 30.0, 32.0, 35.0, 40.0, 45.0, None]
    rate_list = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, None]

    calmar_grid = pd.DataFrame(index=[f"Bias>={b}%" if b else "No_Bias" for b in bias_list],
                               columns=[f"10Y>={r}%" if r else "No_Rate" for r in rate_list])
    cagr_grid = calmar_grid.copy()
    mdd_grid = calmar_grid.copy()
    mult_grid = calmar_grid.copy()
    trig_grid = calmar_grid.copy()

    for b in bias_list:
        r_lbl = f"Bias>={b}%" if b else "No_Bias"
        for r in rate_list:
            c_lbl = f"10Y>={r}%" if r else "No_Rate"
            res = run_titan_backtest(data, bias_thresh=b, us10y_thresh=r, ma_len=500, target_exposure=0.70)
            calmar_grid.loc[r_lbl, c_lbl] = res['Calmar']
            cagr_grid.loc[r_lbl, c_lbl] = res['CAGR']
            mdd_grid.loc[r_lbl, c_lbl] = res['Month_MDD']
            mult_grid.loc[r_lbl, c_lbl] = res['Multiplier']
            trig_grid.loc[r_lbl, c_lbl] = res['Trigger_Count']

    print("="*100)
    print("🏆 【實盤 DOE 網格 1】: Calmar 收益風險比熱力矩陣 (QQQ 500MA 乖離率 x US10Y 利率門檻)")
    print("="*100)
    print(calmar_grid.to_string())

    print("\n" + "="*100)
    print("📈 【實盤 DOE 網格 2】: 年化複合報酬率 (CAGR %) 熱力矩陣")
    print("="*100)
    print(cagr_grid.to_string())

    print("\n" + "="*100)
    print("🛡️ 【實盤 DOE 網格 3】: 最大月度回撤 (Month MDD %) 熱力矩陣")
    print("="*100)
    print(mdd_grid.to_string())

    print("\n" + "="*100)
    print("💰 【實盤 DOE 網格 4】: 22.8 年累積獲利倍數 (Multiplier x)")
    print("="*100)
    print(mult_grid.to_string())

    print("\n" + "="*100)
    print("⏱️ 【實盤 DOE 網格 5】: 22.8 年觸發次數 (Trigger Counts out of 540 rebalances)")
    print("="*100)
    print(trig_grid.to_string())

    # 3. 測試均線長度敏感度 (MA Lookback: 250MA vs 375MA vs 500MA vs 750MA)
    print("\n" + "="*100)
    print("[3/4] 測試均線長度敏感度 (MA Lookback: 250MA vs 375MA vs 500MA vs 750MA, 利率固定 3.5%)")
    print("="*100)
    ma_results = []
    for m in [250, 375, 500, 750]:
        for b in [20.0, 25.0, 28.0, 30.0, 32.0, 35.0, 40.0]:
            r = run_titan_backtest(data, bias_thresh=b, us10y_thresh=3.5, ma_len=m, target_exposure=0.70)
            ma_results.append({
                'MA_Lookback': f'{m}MA ({m/250:.1f}Y)',
                'Bias_Thresh': f'{b}%',
                'CAGR': r['CAGR'],
                'Month_MDD': r['Month_MDD'],
                'Calmar': r['Calmar'],
                'Trig_Count': r['Trigger_Count'],
                'Multiplier': r['Multiplier']
            })
    print(pd.DataFrame(ma_results).to_string(index=False))

    # 4. 測試防守減持強度敏感度 (Target Exposure: 0% Cash vs 30% vs 50% vs 70% vs 85%)
    print("\n" + "="*100)
    print("[4/4] 測試減持防守強度 (Target Exposure: 0%全現金避險 ~ 85%微幅減持, 門檻 500MA 30% x 10Y 3.5%)")
    print("="*100)
    exp_results = []
    for exp in [0.0, 0.30, 0.50, 0.70, 0.85, 1.0]:
        r = run_titan_backtest(data, bias_thresh=30.0, us10y_thresh=3.5, ma_len=500, target_exposure=exp)
        exp_results.append({
            'Trigger_Exposure': f'{int(exp*100)}%',
            'CAGR': r['CAGR'],
            'Month_MDD': r['Month_MDD'],
            'Daily_MDD': r['Daily_MDD'],
            'Calmar': r['Calmar'],
            'Multiplier': r['Multiplier']
        })
    print(pd.DataFrame(exp_results).to_string(index=False))

if __name__ == '__main__':
    main()
