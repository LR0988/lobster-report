#!/usr/bin/env python3
"""
doe_macro_gate_optimization.py
全維度實驗設計 (DOE - Design of Experiments) 與參數表面強健度驗證
深入驗證：QQQ 乖離門檻、US10Y 利率門檻、均線長度 (MA)、減持倉位比例 (Target Exposure)
"""

import time
import sqlite3
import pandas as pd
import numpy as np
import yfinance as yf

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def prepare_doe_data():
    print("[1/4] 載入資料庫並計算量化基礎因子與 OHLCV...")
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

    # 清洗跳空針
    ret_1d = px_adj.pct_change(fill_method=None)
    ret_next = px_adj.pct_change(-1, fill_method=None)
    spike_mask = (ret_1d.abs() > 0.20) & (ret_next.abs() > 0.20) & ((ret_1d * ret_next) > 0)
    px_adj[spike_mask] = np.nan
    px_open[spike_mask] = np.nan
    px_adj = px_adj.ffill()
    px_open = px_open.ffill()

    stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

    ma20 = px_adj.rolling(20).mean()
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

    # 多均線 QQQ 乖離率快取
    qqq_p = sov_adj['QQQ']
    qqq_bias_dict = {}
    for ma_len in [250, 375, 500, 750]:
        ma_s = qqq_p.rolling(ma_len).mean()
        qqq_bias_dict[ma_len] = ((qqq_p - ma_s) / ma_s * 100.0)

    return {
        'px_adj': px_adj, 'px_open': px_open, 'stock_tickers': stock_tickers,
        'ma20': ma20, 'ma60': ma60, 'ma200': ma200, 'mom_agg': mom_agg,
        'global_breadth': global_breadth, 'safe_cash_ret': safe_cash_ret,
        'churn_exhaustion': churn_exhaustion, 'us10y_series': us10y_series,
        'qqq_bias_dict': qqq_bias_dict
    }

def simulate_engine(data,
                    ma_len=500,
                    bias_thresh=30.0,
                    us10y_thresh=3.5,
                    target_exposure=0.70,
                    start_date='2004-01-01',
                    end_date='2026-10-27'):

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

    all_dates = pd.Series(px_adj.index[(px_adj.index >= start_date) & (px_adj.index <= end_date)])
    if len(all_dates) < 50:
        return None

    def get_fee(symbol, is_sell=False):
        if symbol.endswith('.TW'):
            return (0.001425 * 0.28) + (0.003 if is_sell else 0.0)
        return 0.0005

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
        base_weights = [0.40, 0.30, 0.30]
        p_idx = 0
        num_p = len(periods)
        gate_active_count = 0
        total_rebal_count = 0

        for t_idx, current_dt in enumerate(all_sim_dates):
            if cash > 0:
                cash *= (1.0 + float(safe_cash_ret.loc[current_dt]))

            # 調倉日執行
            if p_idx < num_p and current_dt == periods[p_idx][1]:
                t_date, t_in, t_out = periods[p_idx]
                total_rebal_count += 1
                cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)

                br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
                if br >= 0.50: base_exp = 1.0
                elif br >= 0.30: base_exp = 0.70
                else: base_exp = 0.0

                # 宏觀雙因子閥門檢驗
                qb = qqq_bias.loc[t_date] if t_date in qqq_bias.index else 0.0
                rate = us10y_series.loc[t_date] if t_date in us10y_series.index else 0.0

                gate_triggered = False
                if base_exp > 0.0:
                    bias_cond = (qb >= bias_thresh) if (bias_thresh is not None) else True
                    rate_cond = (rate >= us10y_thresh) if (us10y_thresh is not None) else True
                    if bias_cond and rate_cond:
                        gate_triggered = True
                        gate_active_count += 1
                        exposure = min(base_exp, target_exposure)
                    else:
                        exposure = base_exp
                else:
                    exposure = 0.0

                # 選股
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
                top_targets = [x[0] for x in valid_stks[:3]]

                # 平倉未在名單者
                for s in list(holdings.keys()):
                    if s not in top_targets:
                        exit_px = px_open.loc[t_in, s]
                        cash += holdings[s]['shares'] * exit_px * (1.0 - get_fee(s, is_sell=True))
                        del holdings[s]

                # 買入/平衡
                cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)
                equity_pool = cur_val * exposure
                cash_reserve = cur_val * (1.0 - exposure)

                if len(top_targets) > 0 and exposure > 0:
                    allocated_weights = base_weights[:len(top_targets)]
                    sum_w = sum(allocated_weights)
                    final_weights = [w / sum_w for w in allocated_weights]
                    for s, w in zip(top_targets, final_weights):
                        target_capital = equity_pool * w
                        px_in = px_open.loc[t_in, s]
                        cur_pos_val = holdings[s]['shares'] * px_in if s in holdings else 0.0
                        diff_val = target_capital - cur_pos_val
                        if diff_val > 0:
                            cost = diff_val * (1.0 + get_fee(s, is_sell=False))
                            if cash >= cost:
                                buy_shares = diff_val / px_in
                                cash -= cost
                                if s in holdings:
                                    holdings[s]['shares'] += buy_shares
                                else:
                                    holdings[s] = {'shares': buy_shares}
                        elif diff_val < 0:
                            sell_shares = abs(diff_val) / px_in
                            cash += sell_shares * px_in * (1.0 - get_fee(s, is_sell=True))
                            holdings[s]['shares'] -= sell_shares

                p_idx += 1

            # 計算每日淨值
            pos_val = sum(holdings[s]['shares'] * px_adj.loc[current_dt, s] for s in holdings if pd.notna(px_adj.loc[current_dt, s]))
            daily_equity.loc[current_dt] = cash + pos_val

        return daily_equity.dropna(), gate_active_count, total_rebal_count

    eq_a, gate_a, tot_a = sim_tranche(day_target=1)
    eq_b, gate_b, tot_b = sim_tranche(day_target=15)
    comm_idx = eq_a.index.intersection(eq_b.index)
    eq_dual = (eq_a.loc[comm_idx] + eq_b.loc[comm_idx]) / 2.0

    days = len(eq_dual)
    years = days / 252.0
    total_ret = eq_dual.iloc[-1] / eq_dual.iloc[0]
    cagr = (total_ret ** (1.0 / years) - 1.0) * 100.0

    # 月度與日度 MDD
    m_eq = eq_dual.resample('ME').last().dropna()
    m_roll_max = m_eq.cummax()
    m_mdd = ((m_eq - m_roll_max) / m_roll_max * 100.0).min()
    d_roll_max = eq_dual.cummax()
    d_mdd = ((eq_dual - d_roll_max) / d_roll_max * 100.0).min()

    m_ret = m_eq.pct_change().dropna()
    sharpe = (m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12.0)
    calmar = cagr / abs(m_mdd) if abs(m_mdd) > 0 else 0.0

    trigger_rate = ((gate_a + gate_b) / (tot_a + tot_b)) * 100.0 if (tot_a + tot_b) > 0 else 0.0

    return {
        'CAGR': round(cagr, 2),
        'Month_MDD': round(m_mdd, 2),
        'Daily_MDD': round(d_mdd, 2),
        'Calmar': round(calmar, 2),
        'Sharpe': round(sharpe, 2),
        'Trigger_Rate_%': round(trigger_rate, 1),
        'Multiplier': round(total_ret, 1)
    }

def run_doe():
    data = prepare_doe_data()
    print("[2/4] 開始全因子 DOE 網格掃描 (Design of Experiments)...")

    # 1. 基準無閥門對照組 (No Macro Gate)
    benchmark = simulate_engine(data, ma_len=500, bias_thresh=None, us10y_thresh=None, target_exposure=1.0)
    print(f"\n📌 【基準無閥門 (100% Full Momentum)】: CAGR={benchmark['CAGR']}%, 月MDD={benchmark['Month_MDD']}%, Calmar={benchmark['Calmar']}, 獲利倍數={benchmark['Multiplier']}x\n")

    # 2. 二維全因子網格：QQQ 乖離門檻 x US10Y 利率門檻 (撒開條件，範圍 15%~45% x 2.0%~5.0%)
    bias_range = [15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, None]
    yield_range = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, None]

    cagr_grid = pd.DataFrame(index=[f"QQQ Bias >={b}%" if b is not None else "No Bias Cond" for b in bias_range],
                             columns=[f"US10Y >={y}%" if y is not None else "No Rate Cond" for y in yield_range])
    mdd_grid = cagr_grid.copy()
    calmar_grid = cagr_grid.copy()
    trig_grid = cagr_grid.copy()

    results_table = []

    for b in bias_range:
        b_label = f"Bias>={b}%" if b is not None else "No_Bias"
        r_row = f"QQQ Bias >={b}%" if b is not None else "No Bias Cond"
        for y in yield_range:
            y_label = f"10Y>={y}%" if y is not None else "No_Rate"
            c_col = f"US10Y >={y}%" if y is not None else "No Rate Cond"

            res = simulate_engine(data, ma_len=500, bias_thresh=b, us10y_thresh=y, target_exposure=0.70)
            cagr_grid.loc[r_row, c_col] = res['CAGR']
            mdd_grid.loc[r_row, c_col] = res['Month_MDD']
            calmar_grid.loc[r_row, c_col] = res['Calmar']
            trig_grid.loc[r_row, c_col] = res['Trigger_Rate_%']

            results_table.append({
                'QQQ_Bias': b_label,
                'US10Y': y_label,
                'CAGR': res['CAGR'],
                'Month_MDD': res['Month_MDD'],
                'Calmar': res['Calmar'],
                'Sharpe': res['Sharpe'],
                'Trigger_Rate_%': res['Trigger_Rate_%'],
                'Multiplier': res['Multiplier']
            })

    res_df = pd.DataFrame(results_table)

    print("="*100)
    print("📊 【DOE 網格 1】: Calmar 收益風險比熱力矩陣 (QQQ 500MA 乖離率 x US10Y 利率門檻)")
    print("="*100)
    print(calmar_grid.to_string())

    print("\n" + "="*100)
    print("📈 【DOE 網格 2】: 年化複合報酬率 (CAGR %) 熱力矩陣")
    print("="*100)
    print(cagr_grid.to_string())

    print("\n" + "="*100)
    print("🛡️ 【DOE 網格 3】: 最大月度回撤 (Month MDD %) 熱力矩陣")
    print("="*100)
    print(mdd_grid.to_string())

    print("\n" + "="*100)
    print("⏱️ 【DOE 網格 4】: 閥門觸發防守比率 (Trigger Rate % of Total Rebalances)")
    print("="*100)
    print(trig_grid.to_string())

    # 3. 測試均線長度敏感度 (MA Lookback: 250MA, 375MA, 500MA, 750MA)
    print("\n" + "="*100)
    print("[3/4] 測試均線長度敏感度 (MA Lookback: 250MA vs 375MA vs 500MA vs 750MA, 利率固定 3.5%)")
    print("="*100)
    ma_results = []
    for m in [250, 375, 500, 750]:
        for b in [20.0, 25.0, 30.0, 35.0, 40.0]:
            r = simulate_engine(data, ma_len=m, bias_thresh=b, us10y_thresh=3.5, target_exposure=0.70)
            ma_results.append({
                'MA_Lookback': f'{m}MA ({m/250:.1f}Y)',
                'Bias_Thresh': f'{b}%',
                'CAGR': r['CAGR'],
                'Month_MDD': r['Month_MDD'],
                'Calmar': r['Calmar'],
                'Trigger_Rate_%': r['Trigger_Rate_%'],
                'Multiplier': r['Multiplier']
            })
    ma_df = pd.DataFrame(ma_results)
    print(ma_df.to_string(index=False))

    # 4. 測試防守減持強度敏感度 (Target Exposure: 0% Cash vs 30% vs 50% vs 70% vs 85%)
    print("\n" + "="*100)
    print("[4/4] 測試減持防守強度 (Target Exposure: 0%現金避險 ~ 85%輕度減持, 門檻 500MA 30% x 10Y 3.5%)")
    print("="*100)
    exp_results = []
    for exp in [0.0, 0.30, 0.50, 0.70, 0.85, 1.0]:
        r = simulate_engine(data, ma_len=500, bias_thresh=30.0, us10y_thresh=3.5, target_exposure=exp)
        exp_results.append({
            'Trigger_Exposure': f'{int(exp*100)}%',
            'CAGR': r['CAGR'],
            'Month_MDD': r['Month_MDD'],
            'Daily_MDD': r['Daily_MDD'],
            'Calmar': r['Calmar'],
            'Sharpe': r['Sharpe'],
            'Multiplier': r['Multiplier']
        })
    exp_df = pd.DataFrame(exp_results)
    print(exp_df.to_string(index=False))

    # 5. 分時期 Walk-Forward 強健度檢驗 (2004-2009 vs 2010-2020 vs 2021-2026)
    print("\n" + "="*100)
    print("⏳ 分時期強健度檢驗 (Sub-Period Robustness: 驗證是否在各歷史宏觀週期均穩定有效)")
    print("="*100)
    periods = [
        ("全歷史 22.8 年 (2004 - 2026)", '2004-01-01', '2026-10-27'),
        ("時期一：升息頂峰與金融海嘯 (2004 - 2009)", '2004-01-01', '2009-12-31'),
        ("時期二：零利率寬鬆牛市 (2010 - 2020)", '2010-01-01', '2020-12-31'),
        ("時期三：通膨升息與AI浪潮 (2021 - 2026)", '2021-01-01', '2026-10-27'),
    ]
    period_res = []
    for pname, s_dt, e_dt in periods:
        bm = simulate_engine(data, ma_len=500, bias_thresh=None, us10y_thresh=None, target_exposure=1.0, start_date=s_dt, end_date=e_dt)
        gt = simulate_engine(data, ma_len=500, bias_thresh=30.0, us10y_thresh=3.5, target_exposure=0.70, start_date=s_dt, end_date=e_dt)
        period_res.append({
            '週期時期': pname,
            '基準無閥門 CAGR': bm['CAGR'],
            '雙因子閥門 CAGR': gt['CAGR'],
            '基準 MDD': bm['Month_MDD'],
            '雙因子閥門 MDD': gt['Month_MDD'],
            '基準 Calmar': bm['Calmar'],
            '雙因子閥門 Calmar': gt['Calmar'],
            '閥門觸發比率': f"{gt['Trigger_Rate_%']}%"
        })
    print(pd.DataFrame(period_res).to_string(index=False))

if __name__ == '__main__':
    run_doe()
