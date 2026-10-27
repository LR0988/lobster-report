#!/usr/bin/env python3
"""
backtest_overheat_prevention.py
嚴格回測：【當前方案二基準】 vs 【加入過熱防治機制 (個股防追高+連任鎖利+大盤宏觀減持)】
驗證 2004~2026 年 (22.8年) 之勝率、CAGR、MDD、盈虧比、獲利因子差異！
"""

import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def prepare_data():
    print("[1/3] 載入資料庫並計算全維度指標與 OHLCV...")
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily WHERE open IS NOT NULL AND adj_close IS NOT NULL ORDER BY date ASC", conn)
    sov_df = pd.read_sql_query("SELECT ticker, date, close, adj_close FROM global_sovereign_daily WHERE adj_close IS NOT NULL ORDER BY date ASC", conn)
    conn.close()

    df['date'] = pd.to_datetime(df['date'])
    sov_df['date'] = pd.to_datetime(sov_df['date'])
    df = df[df['date'].dt.dayofweek < 5].copy()
    sov_df = sov_df[sov_df['date'].dt.dayofweek < 5].copy()

    valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
    df = df[df['ticker'].isin(valid_tickers)].copy()
    df['adj_factor'] = np.where(df['close'] > 0, df['adj_close'] / df['close'], 1.0)
    df['open_adj'] = df['open'] * df['adj_factor']
    df['high_adj'] = df['high'] * df['adj_factor']
    df['low_adj'] = df['low'] * df['adj_factor']

    px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
    px_open = df.pivot(index='date', columns='ticker', values='open_adj').sort_index()
    px_high = df.pivot(index='date', columns='ticker', values='high_adj').sort_index()
    px_low = df.pivot(index='date', columns='ticker', values='low_adj').sort_index()
    px_vol = df.pivot(index='date', columns='ticker', values='volume').sort_index()
    sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

    common_dates = px_adj.index[(px_adj.index >= '2003-01-01') & (px_adj.index.isin(sov_adj.index))]
    px_adj = px_adj.reindex(common_dates).ffill()
    px_open = px_open.reindex(common_dates).ffill()
    px_high = px_high.reindex(common_dates).ffill()
    px_low = px_low.reindex(common_dates).ffill()
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

    # 正交 4 因子分數
    blend_mom_core = 0.85 * raw_mom_core + 0.15 * res_mom_core
    fip_mult = 1.0 + 0.5 * fip_mat[stock_tickers]
    conv_mult = 1.0 + 0.20 * (stk_convexity[stock_tickers] - 1.0).clip(-0.5, 2.0)
    p_damp = 1.0 / (1.0 + 1.2 * (bias60[stock_tickers] - 0.65))
    parabolic_damper = pd.DataFrame(np.where(bias60[stock_tickers] > 0.65, p_damp, 1.0), index=bias60.index, columns=stock_tickers)
    mom_agg = blend_mom_core * fip_mult * conv_mult * parabolic_damper

    # 大盤宏觀 2 年線乖離 (QQQ)
    qqq_ma500 = sov_adj['QQQ'].rolling(500).mean()
    qqq_bias500 = (sov_adj['QQQ'] - qqq_ma500) / qqq_ma500 * 100.0

    return {
        'px_adj': px_adj, 'px_open': px_open, 'px_high': px_high, 'px_low': px_low, 'px_vol': px_vol,
        'stock_tickers': stock_tickers, 'ma20': ma20, 'ma60': ma60, 'ma200': ma200, 'bias60': bias60,
        'mom2w': mom2w, 'mom_agg': mom_agg, 'global_breadth': global_breadth,
        'safe_cash_ret': safe_cash_ret, 'churn_exhaustion': churn_exhaustion,
        'qqq_bias500': qqq_bias500
    }

def run_simulation(data,
                   use_anti_overheat_entry=False,    # 第一層：個股防追高 (過熱標的 50%市價 + 50%回測掛單)
                   use_tenure_trailing_exit=False,   # 第二層：連任過熱防護 (連任標的高檔回撤 >15% 減半鎖利)
                   use_macro_bias_gate=False):       # 第三層：大盤宏觀過熱閥門 (QQQ 乖離>30% 且 US10Y>=3.5% 降至 50% 半倉防守)

    px_adj = data['px_adj']
    px_open = data['px_open']
    px_high = data['px_high']
    px_low = data['px_low']
    stock_tickers = data['stock_tickers']
    ma20 = data['ma20']
    ma60 = data['ma60']
    ma200 = data['ma200']
    bias60 = data['bias60']
    mom2w = data['mom2w']
    mom_agg = data['mom_agg']
    global_breadth = data['global_breadth']
    safe_cash_ret = data['safe_cash_ret']
    churn_exhaustion = data['churn_exhaustion']
    qqq_bias500 = data['qqq_bias500']

    all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

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
        holding_tenure = {}
        trades = []
        period_returns = []
        base_weights = [0.40, 0.30, 0.30]
        p_idx = 0
        num_p = len(periods)

        for t_idx, current_dt in enumerate(all_sim_dates):
            # 避險資金增長
            if cash > 0:
                cash *= (1.0 + float(safe_cash_ret.loc[current_dt]))

            # 日內/持倉期動態監控 (第二層：連任過熱防護 Trailing Take-Profit)
            if use_tenure_trailing_exit and len(holdings) > 0:
                for s, hinfo in list(holdings.items()):
                    cur_px = px_adj.loc[current_dt, s]
                    cur_ma20 = ma20.loc[current_dt, s]
                    if pd.notna(cur_px):
                        if cur_px > hinfo['peak_px']:
                            hinfo['peak_px'] = cur_px
                        # 若連任 >= 2 月，且自高點回撤 > 15%，且跌破 20MA -> 提前減半鎖利
                        tenure = holding_tenure.get(s, 1)
                        if tenure >= 2 and not hinfo.get('half_locked', False):
                            if cur_px <= hinfo['peak_px'] * 0.85 and pd.notna(cur_ma20) and cur_px < cur_ma20:
                                sell_sh = hinfo['shares'] * 0.50
                                cash += sell_sh * cur_px * (1.0 - get_fee(s, is_sell=True))
                                hinfo['shares'] -= sell_sh
                                hinfo['half_locked'] = True
                                trades.append({
                                    'ticker': s, 'entry_px': hinfo['entry_px'], 'exit_px': cur_px,
                                    'ret': (cur_px / hinfo['entry_px'] - 1.0), 'tenure': tenure, 'reason': '連任高檔回撤鎖利'
                                })

            # 調倉日執行
            if p_idx < num_p and current_dt == periods[p_idx][1]:
                t_date, t_in, t_out = periods[p_idx]
                cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)

                br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
                if br >= 0.50: base_exp = 1.0
                elif br >= 0.30: base_exp = 0.70
                else: base_exp = 0.0

                # 第三層：大盤宏觀過熱閥門 (Macro Bias Gate)
                if use_macro_bias_gate and base_exp > 0.0:
                    qb = qqq_bias500.loc[t_date] if t_date in qqq_bias500.index else 0.0
                    if pd.notna(qb) and qb >= 30.0:
                        exposure = min(base_exp, 0.50)
                    else:
                        exposure = base_exp
                else:
                    exposure = base_exp

                # 篩選有效候選
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
                        ret = (out_px / hinfo['entry_px'] - 1.0)
                        trades.append({'ticker': s, 'entry_px': hinfo['entry_px'], 'exit_px': out_px, 'ret': ret, 'tenure': holding_tenure.get(s, 1), 'reason': '總經避險清倉'})
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

                    # 1. 出場
                    for s in list(holdings.keys()):
                        if s not in target_alloc:
                            out_px = px_open.loc[t_in, s]
                            ret = (out_px / holdings[s]['entry_px'] - 1.0)
                            trades.append({'ticker': s, 'entry_px': holdings[s]['entry_px'], 'exit_px': out_px, 'ret': ret, 'tenure': holding_tenure.get(s, 1), 'reason': '換倉汰換'})
                            cash += holdings[s]['shares'] * out_px * (1.0 - get_fee(s, is_sell=True))
                            del holdings[s]

                    cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)

                    # 2. 減碼
                    for s, tgt_w in target_alloc.items():
                        if s in holdings:
                            op = float(px_open.loc[t_in, s])
                            cur_sh = holdings[s]['shares']
                            cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                            if abs(cur_w - tgt_w) > 0.05 and (cur_val * tgt_w) < (cur_sh * op):
                                sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                                cash += sell_sh * op * (1.0 - get_fee(s, is_sell=True))
                                holdings[s]['shares'] -= sell_sh

                    # 3. 買入 (第一層：個股防追高機制)
                    for s, tgt_w in target_alloc.items():
                        op = float(px_open.loc[t_in, s])
                        cur_sh = holdings[s]['shares'] if s in holdings else 0.0
                        cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                        if s in holdings and abs(cur_w - tgt_w) <= 0.05:
                            continue
                        diff_val = (cur_val * tgt_w) - (cur_sh * op)
                        if diff_val > 0 and cash > 0 and op > 0:
                            actual_buy = min(cash, diff_val)
                            
                            # 第一層：防追高執行判定 (若 2W 衝刺 > 11% 或 60MA 乖離 > 25% 且為新進場)
                            is_overheated = False
                            if use_anti_overheat_entry and (s not in holdings or cur_sh == 0):
                                m2w_val = mom2w.loc[t_date, s] if pd.notna(mom2w.loc[t_date, s]) else 0.0
                                b60_val = bias60.loc[t_date, s] if pd.notna(bias60.loc[t_date, s]) else 0.0
                                if m2w_val > 0.11 or b60_val > 0.25:
                                    is_overheated = True

                            if is_overheated:
                                # 50% 開盤價先買，50% 掛單在回測 20MA 或 -3% 折讓價
                                buy_part1 = actual_buy * 0.50
                                buy_part2 = actual_buy * 0.50
                                fee1 = buy_part1 * get_fee(s, is_sell=False)
                                sh1 = (buy_part1 - fee1) / op
                                cash -= buy_part1
                                
                                # 判定掛單是否成交：當期回測低點 (t_in ~ t_out 區間最低價) 是否觸及 op * 0.96 或 20MA
                                target_limit_px = min(op * 0.96, float(ma20.loc[t_date, s]) if pd.notna(ma20.loc[t_date, s]) else op)
                                # 檢視首週最低價
                                low_px = float(px_low.loc[t_in, s]) if pd.notna(px_low.loc[t_in, s]) else op
                                if low_px <= target_limit_px:
                                    # 限價單成交！成交價取 target_limit_px
                                    fill_px = target_limit_px
                                    fee2 = buy_part2 * get_fee(s, is_sell=False)
                                    sh2 = (buy_part2 - fee2) / fill_px
                                    cash -= buy_part2
                                else:
                                    # 未拉回，不勉強追高，資金保留在避險現金池產生利息
                                    sh2 = 0.0
                                    fill_px = op

                                tot_new_sh = sh1 + sh2
                                avg_in_px = (sh1 * op + sh2 * fill_px) / tot_new_sh if tot_new_sh > 0 else op
                                if s in holdings:
                                    holdings[s]['shares'] += tot_new_sh
                                    holdings[s]['entry_px'] = avg_in_px
                                    holdings[s]['peak_px'] = max(holdings[s].get('peak_px', avg_in_px), avg_in_px)
                                else:
                                    holdings[s] = {'shares': tot_new_sh, 'entry_px': avg_in_px, 'peak_px': avg_in_px, 'half_locked': False}
                            else:
                                # 正常 100% 開盤買入
                                fee = actual_buy * get_fee(s, is_sell=False)
                                net_buy = actual_buy - fee
                                sh_to_buy = net_buy / op
                                cash -= actual_buy
                                if s in holdings:
                                    holdings[s]['shares'] += sh_to_buy
                                    holdings[s]['peak_px'] = max(holdings[s].get('peak_px', op), op)
                                else:
                                    holdings[s] = {'shares': sh_to_buy, 'entry_px': op, 'peak_px': op, 'half_locked': False}

                p_idx += 1

            tot_eq = cash + sum(holdings[s]['shares'] * px_adj.loc[current_dt, s] for s in holdings)
            daily_equity.loc[current_dt] = tot_eq

        return daily_equity.ffill().bfill(), trades

    print("[2/3] 執行雙梯隊模擬...")
    eq_a, trades_a = sim_tranche(1, 500000.0)
    eq_b, trades_b = sim_tranche(22, 500000.0)
    common_idx = eq_a.dropna().index
    eq_dual = eq_a.loc[common_idx] + eq_b.reindex(common_idx).ffill().bfill()
    all_trades = pd.DataFrame(trades_a + trades_b)

    # 績效統計
    years = (eq_dual.index[-1] - eq_dual.index[0]).days / 365.25
    cagr = ((eq_dual.iloc[-1] / eq_dual.iloc[0]) ** (1.0 / years) - 1.0) * 100.0

    m_eq = eq_dual.resample('ME').last().dropna()
    m_ret = m_eq.pct_change().dropna()
    m_roll_max = m_eq.cummax()
    m_mdd = ((m_eq - m_roll_max) / m_roll_max * 100.0).min()

    d_roll_max = eq_dual.cummax()
    d_mdd = ((eq_dual - d_roll_max) / d_roll_max * 100.0).min()

    sharpe = (m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12.0)
    calmar = cagr / abs(m_mdd) if abs(m_mdd) > 0 else 0.0

    y_eq = eq_dual.resample('YE').last().dropna()
    y_ret = y_eq.pct_change().dropna() * 100.0
    annual_win_rate = (y_ret > 0).mean() * 100.0
    worst_year = y_ret.min()

    # 個股勝率與損益
    trade_win_rate = (all_trades['ret'] > 0).mean() * 100.0
    avg_trade_pnl = all_trades['ret'].mean() * 100.0
    median_trade_pnl = all_trades['ret'].median() * 100.0
    win_trades = all_trades[all_trades['ret'] > 0]['ret']
    loss_trades = all_trades[all_trades['ret'] < 0]['ret']
    payoff_ratio = (win_trades.mean() / abs(loss_trades.mean())) if len(loss_trades) > 0 else 1.0
    profit_factor = (win_trades.sum() / abs(loss_trades.sum())) if len(loss_trades) > 0 else 1.0
    big_win_20 = (all_trades['ret'] >= 0.20).mean() * 100.0
    severe_loss_15 = (all_trades['ret'] <= -0.15).mean() * 100.0

    return {
        'CAGR': round(cagr, 2),
        '月MDD': round(m_mdd, 2),
        '日MDD': round(d_mdd, 2),
        'Sharpe': round(sharpe, 2),
        'Calmar': round(calmar, 2),
        '年度勝率': round(annual_win_rate, 1),
        '最差單年': round(worst_year, 2),
        '交易筆數': len(all_trades),
        '交易勝率': round(trade_win_rate, 2),
        '單筆均報': round(avg_trade_pnl, 2),
        '單筆中位': round(median_trade_pnl, 2),
        '盈虧比': round(payoff_ratio, 2),
        '獲利因子': round(profit_factor, 2),
        '暴賺率>20%': round(big_win_20, 2),
        '重虧率<-15%': round(severe_loss_15, 2),
    }

def main():
    data = prepare_data()
    print("[3/3] 開始回測四大組合...")

    models = [
        ("0. 基準模型：方案二標準版 (無防過熱，開盤照買，100%滿倉)", dict()),
        ("1. 模組A：疊加【個股防追高】(過熱標的50%開盤+50%拉回限價)", dict(use_anti_overheat_entry=True)),
        ("2. 模組B：疊加【連任鎖利】(連任>=2月高檔回撤>15%減半保護)", dict(use_tenure_trailing_exit=True)),
        ("3. 模組C：疊加【大盤宏觀減持】(QQQ乖離>30%降至70%倉位)", dict(use_macro_bias_gate=True)),
        ("4. 🌟 終極合體：【三位一體過熱防治旗艦版】(個股防追高 + 連任鎖利 + 大盤減持)", 
         dict(use_anti_overheat_entry=True, use_tenure_trailing_exit=True, use_macro_bias_gate=True))
    ]

    results = []
    for name, kw in models:
        res = run_simulation(data, **kw)
        res['策略版本'] = name
        results.append(res)

    res_df = pd.DataFrame(results)
    cols = ['策略版本', 'CAGR', '月MDD', '日MDD', 'Sharpe', 'Calmar', '年度勝率', '最差單年', '交易勝率', '單筆均報', '單筆中位', '盈虧比', '獲利因子', '重虧率<-15%']
    print("\n" + "="*120)
    print("🏆 【全球泰坦 2.0 方案二】：疊加『過熱防治機制』22.8 年真實回測成果對照表")
    print("="*120)
    print(res_df[cols].to_string(index=False))

if __name__ == '__main__':
    main()
