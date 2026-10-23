#!/usr/bin/env python3
"""
=====================================================================================
 🛡️ 全球主權泰坦模型：日頻 60MA (季線) 即刻停損 vs 原版調倉 對比回測
=====================================================================================
針對用戶提問：「如果以近三年來說，改成跌回 MA60 立刻停損，隔日市價賣出，CAGR 會跑到哪邊去？」
回測條件：
- 策略基底：19 因子超大型 DOE 總冠軍參數 (CAGR 67.61%, Calmar 2.583)
- 模式 A (基準)：原版雙梯隊調倉，僅在換血日檢查 60MA
- 模式 B (日頻 60MA 停損)：持有期間每天收盤檢查，若 Close < 60MA，次日開盤市價砍出，資金歸入安全避險池
- 評估窗口：
  1. 近 3 年 (2023-10-23 ~ 2026-10-23)
  2. 近 3.8 年完整本輪大行情 (2023-01-01 ~ 2026-10-23)
  3. 全歷史 22 年長期對照 (2004 ~ 2026)
=====================================================================================
"""

import os
import sys
import time
import json
import sqlite3
import numpy as np
import pandas as pd
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def load_data_and_features():
    print("[1/3] 載入資料庫並計算 19 因子特徵矩陣與 60MA...")
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily ORDER BY date ASC", conn)
    sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
    conn.close()

    df['date'] = pd.to_datetime(df['date'])
    sov_df['date'] = pd.to_datetime(sov_df['date'])
    valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA']) and t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]
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

    common_dates = px_adj.index[px_adj.index >= '2003-01-01']
    px_adj = px_adj.reindex(common_dates).ffill()
    px_open = px_open.reindex(common_dates).ffill()
    px_high = px_high.reindex(common_dates).ffill()
    px_low = px_low.reindex(common_dates).ffill()
    px_vol = px_vol.reindex(common_dates).fillna(0)
    sov_adj = sov_adj.reindex(common_dates).ffill()

    # 數據清洗
    ret_1d = px_adj.pct_change(fill_method=None)
    spike_mask = (ret_1d.abs() > 0.40) & (px_adj.shift(-1) / px_adj.shift(1) - 1.0).abs().lt(0.15)
    px_adj[spike_mask] = np.nan
    px_open[spike_mask] = np.nan
    px_adj = px_adj.ffill()
    px_open = px_open.ffill()

    overnight_gap = (px_open / px_adj.shift(1)) - 1.0
    bad_open_mask = overnight_gap.abs() > 0.25
    px_open[bad_open_mask] = px_adj.shift(1)[bad_open_mask]

    stock_tickers = [t for t in px_adj.columns]

    ma20 = px_adj.rolling(20).mean()
    ma60 = px_adj.rolling(60).mean()
    ma200 = px_adj.rolling(200).mean()

    # 多週期價格動能
    mom2w = px_adj.pct_change(10, fill_method=None)
    mom1m = px_adj.pct_change(21, fill_method=None)
    mom3m = px_adj.pct_change(63, fill_method=None)
    mom6m = px_adj.pct_change(126, fill_method=None)
    mom12m = px_adj.pct_change(252, fill_method=None)

    spy_adj = sov_adj['SPY']
    spy_ret1m = spy_adj.pct_change(21, fill_method=None)
    spy_ret3m = spy_adj.pct_change(63, fill_method=None)
    spy_ret12m = spy_adj.pct_change(252, fill_method=None)
    spy_d_ret = spy_adj.pct_change(fill_method=None)
    spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)

    betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
    px_daily_ret = px_adj.pct_change(fill_method=None)
    for s in stock_tickers:
        cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
        betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

    res_mom12m = mom12m.sub(spy_ret12m, axis=0) * 0.5 + (mom12m - betas_126.mul(spy_ret12m, axis=0)) * 0.5
    res_mom3m = mom3m - betas_126.mul(spy_ret3m, axis=0)
    res_mom1m = mom1m - betas_126.mul(spy_ret1m, axis=0)
    res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)

    pos_days = (px_daily_ret > 0).rolling(252).sum()
    neg_days = (px_daily_ret < 0).rolling(252).sum()
    fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

    downside_ret = px_daily_ret.clip(upper=0.0)
    upside_ret = px_daily_ret.clip(lower=0.0)
    downside_vol_60d = (downside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    upside_vol_60d = (upside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    stk_convexity = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

    net_diff_60 = (px_adj - px_adj.shift(60)).abs()
    abs_diff_60 = px_adj.diff().abs().rolling(60, min_periods=20).sum()
    er_60 = (net_diff_60 / (abs_diff_60 + 1e-9)).clip(0.0, 1.0).fillna(0.3)

    high_252 = px_adj.rolling(252, min_periods=60).max()
    prox_52w = (px_adj / (high_252 + 1e-9)).clip(0.1, 1.0).fillna(0.8)

    bias_ma60 = ((px_adj / (ma60 + 1e-9)) - 1.0).clip(-0.5, 1.5).fillna(0.0)
    std_20 = px_adj.rolling(20).std().replace(0, np.nan)
    zscore_20d = ((px_adj - ma20) / (std_20 + 1e-9)).clip(-3.0, 3.0).fillna(0.0)

    range_10 = px_high.rolling(10).max() - px_low.rolling(10).min()
    range_40 = px_high.rolling(40).max() - px_low.rolling(40).min()
    vcp_tightness = (range_10 / (range_40 + 1e-6)).clip(0.1, 1.0)
    vol_ma60 = px_vol.rolling(60).mean()
    vol_5d_mean = px_vol.rolling(5).mean()
    vol_dryup = (vol_5d_mean / (vol_ma60 + 1e-6)).clip(0.1, 3.0)
    high_20 = px_high.rolling(20).max()
    pivot_prox = (px_adj / (high_20 + 1e-6)).clip(0.5, 1.0)
    vcp_score = (1.0 - vcp_tightness) * 0.40 + (1.0 / (vol_dryup + 0.5)) * 0.30 + pivot_prox * 0.30
    vcp_norm = vcp_score.rank(axis=1, pct=True).fillna(0.5)

    up_vol = px_vol.where(ret_1d > 0, 0.0).rolling(20).mean()
    down_vol = px_vol.where(ret_1d < 0, 0.0).rolling(20).mean()
    vol_absorption = (up_vol / (down_vol + 1e-6)).clip(0.2, 5.0)
    hl_spread = (px_high - px_low).replace(0, np.nan)
    clv = ((px_adj - px_low) - (px_high - px_adj)) / (hl_spread + 1e-6)
    cmf_20 = (clv * px_vol).rolling(20).sum() / (px_vol.rolling(20).sum() + 1e-6)
    cmf_score = cmf_20.fillna(0.0).clip(-1.0, 1.0)
    chip_score = vol_absorption.rank(axis=1, pct=True) * 0.5 + (cmf_score + 1.0) * 0.25
    chip_norm = chip_score.rank(axis=1, pct=True).fillna(0.5)

    # parkinson_squeeze
    hl_ratio = (px_high / (px_low + 1e-6)).clip(lower=1.0)
    parkinson_vol_5d = np.sqrt(((np.log(hl_ratio) ** 2) / (4.0 * np.log(2.0))).rolling(5).mean())
    close_vol_20d = px_daily_ret.rolling(20).std().replace(0, np.nan)
    parkinson_squeeze = (close_vol_20d / (parkinson_vol_5d + 1e-6)).clip(0.1, 10.0)
    parkinson_norm = parkinson_squeeze.rank(axis=1, pct=True).fillna(0.5)

    # pullback_entry
    ret_5d = px_adj.pct_change(5, fill_method=None).fillna(0.0)
    pullback_norm = (1.0 - ret_5d.rank(axis=1, pct=True)).fillna(0.5)

    churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)
    eligible_mask = (px_adj > ma60) & (px_adj > ma200) & (~churn_exhaustion)
    eligible_mask = eligible_mask.fillna(False)

    sov_ma200 = sov_adj.rolling(200).mean()
    sov_ma60 = sov_adj.rolling(60).mean()
    candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
    etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
    etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
    etf_above_60 = (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).astype(int)
    global_breadth = 0.75 * etf_above_200.mean(axis=1) + 0.25 * etf_above_60.mean(axis=1)

    gld_open = sov_adj['GLD']
    gld_ma60 = gld_open.rolling(60).mean()
    gld_ma200 = gld_open.rolling(200).mean()
    gld_mom3m = gld_open.pct_change(63, fill_method=None)
    gld_ret_1d = gld_open.pct_change(fill_method=None).fillna(0.0)
    bil_ret_1d = sov_adj['BIL'].pct_change(fill_method=None).fillna(0.00008).clip(-0.01, 0.01)

    gld_cond = (gld_open > gld_ma60) & (gld_open > gld_ma200) & (gld_mom3m > 0.02) & (gld_ret_1d.abs() < 0.08)
    safe_cash_ret = np.where(gld_cond, 0.60 * gld_ret_1d + 0.40 * bil_ret_1d, bil_ret_1d)
    safe_cash_ret = pd.Series(safe_cash_ret, index=px_adj.index).fillna(0.0)

    # 19 因子冠軍權重評分矩陣
    w12, w6, w3, w1, w2 = [0.50, 0.00, 0.30, 0.15, 0.05]
    w_res = 0.16; w_fip = 0.45; w_conv = 0.14; w_er = 0.40
    w_prox = 0.12; w_bias = -0.05; w_z = 0.00
    w_vcp = 0.24; w_chip = 0.12; w_parkinson = 0.08; w_pullback = 0.00

    raw_mom = w12 * mom12m + w6 * mom6m + w3 * mom3m + w1 * mom1m + w2 * mom2w
    blend_mom = (1.0 - w_res) * raw_mom + w_res * res_mom_core

    fip_mult = 1.0 + w_fip * fip_mat
    conv_mult = 1.0 + w_conv * (stk_convexity - 1.0).clip(-0.5, 2.0)
    er_mult = 1.0 + w_er * (er_60 - 0.5)
    prox_mult = 1.0 + w_prox * (prox_52w ** 2 - 0.5)
    vcp_mult = 1.0 + w_vcp * (vcp_norm - 0.5)
    chip_mult = 1.0 + w_chip * (chip_norm - 0.5)
    bias_mult = 1.0 + w_bias * bias_ma60
    z_mult = 1.0 + w_z * (zscore_20d / 3.0)
    parkinson_mult = 1.0 + w_parkinson * (parkinson_norm - 0.5)
    pullback_mult = 1.0 + w_pullback * (pullback_norm - 0.5)

    mom_matrix = (blend_mom * fip_mult * conv_mult * er_mult * prox_mult * 
                  vcp_mult * chip_mult * bias_mult * z_mult * parkinson_mult * pullback_mult)

    all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])
    def get_rebal_periods(day_target):
        rebal_dates = []
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])
        periods = []
        for i in range(len(rebal_dates) - 1):
            cur_d = rebal_dates[i]
            nxt_d = rebal_dates[i+1]
            sub_dates = px_adj.loc[cur_d:nxt_d].index
            if len(sub_dates) >= 2:
                periods.append((cur_d, sub_dates[1], sub_dates[-1]))
        return periods

    periods_a = get_rebal_periods(1)
    periods_b = get_rebal_periods(22)

    return {
        'px_adj': px_adj,
        'px_open': px_open,
        'ma60': ma60,
        'eligible_mask': eligible_mask,
        'global_breadth': global_breadth,
        'safe_cash_ret': safe_cash_ret,
        'mom_matrix': mom_matrix,
        'periods_a': periods_a,
        'periods_b': periods_b
    }

def run_simulation(data, enable_daily_ma60_stop=False, ladder=[0.60, 0.25, 0.15]):
    """
    雙梯隊全歷史撮合引擎：
    - enable_daily_ma60_stop = False: 原版 (調倉日檢查 60MA)
    - enable_daily_ma60_stop = True: 日頻 60MA 停損 (收盤跌破 60MA, 次日開盤賣出)
    """
    px_adj = data['px_adj']
    px_open = data['px_open']
    ma60 = data['ma60']
    eligible_mask = data['eligible_mask']
    global_breadth = data['global_breadth']
    safe_cash_ret = data['safe_cash_ret']
    mom_matrix = data['mom_matrix']
    base_weights = ladder

    def run_p(periods, initial_capital=500000.0):
        current_holdings = {}
        cash = initial_capital
        holding_tenure = {}
        friction = 0.0015
        
        all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        
        # 追蹤停損出局股票
        stopped_out_stocks = set()
        
        for p_idx, (t_date, t_in, t_out) in enumerate(periods):
            # 調倉日前夕先清算目前持倉價值
            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open.loc[t_in, s]
                
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            exposure = 1.0 if br >= 0.50 else (0.70 if br >= 0.30 else 0.0)
            
            mask_row = eligible_mask.loc[t_date]
            scores_row = mom_matrix.loc[t_date]
            valid_idx = mask_row & (scores_row > 0)
            valid_symbols = scores_row[valid_idx].sort_values(ascending=False)
            
            if exposure <= 0 or len(valid_symbols) == 0:
                target_alloc = {'CASH': 1.0}
                holding_tenure = {}
            else:
                ranked_tickers = list(valid_symbols.index)
                ticker_info = {s: idx + 1 for idx, s in enumerate(ranked_tickers)}
                
                selected_stks = []
                for s in list(current_holdings.keys()):
                    tenure = holding_tenure.get(s, 0)
                    rk = ticker_info.get(s, 999)
                    if rk <= 5 and tenure < 4 and (not enable_daily_ma60_stop or s not in stopped_out_stocks):
                        selected_stks.append(s)
                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    if s not in selected_stks and holding_tenure.get(s, 0) < 4:
                        selected_stks.append(s)
                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    if s not in selected_stks:
                        selected_stks.append(s)
                        
                n = min(3, len(selected_stks))
                selected_stks = selected_stks[:n]
                holding_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}
                
                bw = base_weights[:n]
                tot_bw = sum(bw)
                target_alloc = {selected_stks[i]: (bw[i]/tot_bw) * exposure for i in range(n)}
                if sum(target_alloc.values()) < 1.0:
                    target_alloc['CASH'] = 1.0 - sum(target_alloc.values())
                    
            # 計算換倉手續費
            cur_weights = {}
            if cur_val > 0:
                for s, sh in current_holdings.items():
                    cur_weights[s] = (sh * px_open.loc[t_in, s]) / cur_val
            all_syms = set(list(cur_weights.keys()) + list(target_alloc.keys()))
            turnover = sum(abs(target_alloc.get(s, 0.0) - cur_weights.get(s, 0.0)) for s in all_syms if s != 'CASH')
            fee = (turnover / 2.0) * friction * cur_val
            net_val = cur_val - fee
            
            # 建倉
            current_holdings = {}
            cash = net_val * target_alloc.get('CASH', 0.0)
            stopped_out_stocks.clear()
            
            for s, w in target_alloc.items():
                if s != 'CASH':
                    op = px_open.loc[t_in, s]
                    if pd.notna(op) and op > 0:
                        current_holdings[s] = (net_val * w) / op
                    else:
                        cash += net_val * w
                        
            # 持倉期逐日推進 (含日頻 60MA 停損檢測)
            sub_dates = px_adj.index[(px_adj.index >= t_in) & (px_adj.index <= t_out)]
            
            pending_ma60_sells = []
            
            for d_idx, d in enumerate(sub_dates):
                # 1. 執行昨日觸發 60MA 的開盤賣出
                if enable_daily_ma60_stop and pending_ma60_sells:
                    for s_sell in pending_ma60_sells:
                        if s_sell in current_holdings:
                            sh_s = current_holdings.pop(s_sell)
                            op_s = px_open.loc[d, s_sell] if pd.notna(px_open.loc[d, s_sell]) else px_adj.loc[d, s_sell]
                            if pd.notna(op_s) and op_s > 0:
                                proceeds = sh_s * op_s * (1.0 - friction)
                                cash += proceeds
                            stopped_out_stocks.add(s_sell)
                    pending_ma60_sells = []
                
                # 2. 計算今日資產淨值
                # 現金部位滋息 (黃金/國債避險)
                if cash > 0 and d in safe_cash_ret.index:
                    c_ret = safe_cash_ret.loc[d]
                    cash = cash * (1.0 + c_ret)
                    
                stk_val = 0.0
                for s, sh in current_holdings.items():
                    px_d = px_adj.loc[d, s]
                    stk_val += sh * (px_d if pd.notna(px_d) else 0.0)
                    
                daily_equity.loc[d] = cash + stk_val
                
                # 3. 今日收盤檢查 60MA 停損條件 (供明日開盤賣出)
                if enable_daily_ma60_stop and d_idx < len(sub_dates) - 1:
                    for s in list(current_holdings.keys()):
                        close_s = px_adj.loc[d, s]
                        m60_s = ma60.loc[d, s]
                        if pd.notna(close_s) and pd.notna(m60_s) and close_s < m60_s:
                            # 跌破 60MA，加入明日開盤賣出名單
                            pending_ma60_sells.append(s)
                            
        return daily_equity.ffill().bfill()

    eq_a = run_p(data['periods_a'])
    eq_b = run_p(data['periods_b'])
    common_idx = eq_a.dropna().index
    comb_eq = eq_a.loc[common_idx] + eq_b.reindex(common_idx).ffill().bfill()
    return comb_eq

def calc_kpis(equity_series, start_date=None, end_date=None):
    if start_date:
        equity_series = equity_series.loc[start_date:end_date]
    if len(equity_series) < 10:
        return {}

    years = (equity_series.index[-1] - equity_series.index[0]).days / 365.25
    total_mult = equity_series.iloc[-1] / equity_series.iloc[0]
    cagr = (total_mult ** (1.0 / years) - 1.0) * 100.0

    m_series = equity_series.resample('ME').last()
    m_ret = m_series.pct_change().dropna()
    m_mdd = ((m_series - m_series.cummax()) / m_series.cummax() * 100.0).min()
    d_mdd = ((equity_series - equity_series.cummax()) / equity_series.cummax() * 100.0).min()
    sharpe = (m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(m_mdd) if abs(m_mdd) > 0 else 0.0
    win_rate = (m_ret > 0).mean() * 100.0

    return {
        'start_date': str(equity_series.index[0])[:10],
        'end_date': str(equity_series.index[-1])[:10],
        'years': round(years, 2),
        'multiplier': round(total_mult, 2),
        'CAGR': round(cagr, 2),
        'Month_MDD': round(m_mdd, 2),
        'Daily_MDD': round(d_mdd, 2),
        'Sharpe': round(sharpe, 2),
        'Calmar': round(calmar, 3),
        'Win_Rate': round(win_rate, 1)
    }

def main():
    print("=" * 85)
    print(" 🛡️ 全球主權泰坦模型：日頻 60MA 即刻停損 (Daily Stop) vs 原版調倉 對比回測")
    print("=" * 85)

    data = load_data_and_features()

    print("\n[2/3] 執行雙軌回測...")
    t0 = time.time()
    # 模式 A: 原版 (調倉日檢查 60MA)
    eq_baseline = run_simulation(data, enable_daily_ma60_stop=False)
    # 模式 B: 日頻 60MA 停損 (跌破 60MA 次日開盤賣出)
    eq_ma60_stop = run_simulation(data, enable_daily_ma60_stop=True)
    print(f"回測計算完畢，耗時 {time.time()-t0:.2f} 秒！")

    print("\n[3/3] 統計不同時間窗口下的真實績效對照...")

    # 窗口 1: 精準近 3 年 (2023-10-23 ~ 2026-10-23)
    kpi_3y_base = calc_kpis(eq_baseline, '2023-10-23', '2026-10-23')
    kpi_3y_stop = calc_kpis(eq_ma60_stop, '2023-10-23', '2026-10-23')

    # 窗口 2: 本輪 AI 多頭行情全週期 (2023-01-01 ~ 2026-10-23, 近 3.8 年)
    kpi_full_base = calc_kpis(eq_baseline, '2023-01-01', '2026-10-23')
    kpi_full_stop = calc_kpis(eq_ma60_stop, '2023-01-01', '2026-10-23')

    # 窗口 3: 22 年全歷史長期表現 (2004 ~ 2026)
    kpi_22y_base = calc_kpis(eq_baseline, '2004-01-01', '2026-10-23')
    kpi_22y_stop = calc_kpis(eq_ma60_stop, '2004-01-01', '2026-10-23')

    print("\n" + "=" * 90)
    print(f" 📅 窗口一：精準近三年 (2023/10/23 ～ 2026/10/23, 整整 3.0 年)")
    print("=" * 90)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 90)
    print(f"{'🎯 原版 (調倉日檢驗 60MA)':<22} | {kpi_3y_base['CAGR']:>6.2f}% | {kpi_3y_base['multiplier']:>8.2f}x | {kpi_3y_base['Month_MDD']:>8.2f}% | {kpi_3y_base['Sharpe']:>6.2f} | {kpi_3y_base['Calmar']:>6.3f} | {kpi_3y_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日立刻砍)':<22} | {kpi_3y_stop['CAGR']:>6.2f}% | {kpi_3y_stop['multiplier']:>8.2f}x | {kpi_3y_stop['Month_MDD']:>8.2f}% | {kpi_3y_stop['Sharpe']:>6.2f} | {kpi_3y_stop['Calmar']:>6.3f} | {kpi_3y_stop['Win_Rate']:>5.1f}%")
    cagr_diff_3y = kpi_3y_stop['CAGR'] - kpi_3y_base['CAGR']
    mdd_diff_3y = kpi_3y_stop['Month_MDD'] - kpi_3y_base['Month_MDD']
    print(f"👉 差異變化：CAGR {cagr_diff_3y:+.2f}%, 月最大回撤改善 {mdd_diff_3y:+.2f}%")

    print("\n" + "=" * 90)
    print(f" 📅 窗口二：本輪大牛市全週期 (2023/01/01 ～ 2026/10/23, 近 3.8 年)")
    print("=" * 90)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 90)
    print(f"{'🎯 原版 (調倉日檢驗 60MA)':<22} | {kpi_full_base['CAGR']:>6.2f}% | {kpi_full_base['multiplier']:>8.2f}x | {kpi_full_base['Month_MDD']:>8.2f}% | {kpi_full_base['Sharpe']:>6.2f} | {kpi_full_base['Calmar']:>6.3f} | {kpi_full_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日立刻砍)':<22} | {kpi_full_stop['CAGR']:>6.2f}% | {kpi_full_stop['multiplier']:>8.2f}x | {kpi_full_stop['Month_MDD']:>8.2f}% | {kpi_full_stop['Sharpe']:>6.2f} | {kpi_full_stop['Calmar']:>6.3f} | {kpi_full_stop['Win_Rate']:>5.1f}%")
    cagr_diff_full = kpi_full_stop['CAGR'] - kpi_full_base['CAGR']
    mdd_diff_full = kpi_full_stop['Month_MDD'] - kpi_full_base['Month_MDD']
    print(f"👉 差異變化：CAGR {cagr_diff_full:+.2f}%, 月最大回撤改善 {mdd_diff_full:+.2f}%")

    print("\n" + "=" * 90)
    print(f" 📅 窗口三：全歷史長期 22.8 年大考驗 (2004/01/01 ～ 2026/10/23)")
    print("=" * 90)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 90)
    print(f"{'🎯 原版 (調倉日檢驗 60MA)':<22} | {kpi_22y_base['CAGR']:>6.2f}% | {kpi_22y_base['multiplier']:>8.2f}x | {kpi_22y_base['Month_MDD']:>8.2f}% | {kpi_22y_base['Sharpe']:>6.2f} | {kpi_22y_base['Calmar']:>6.3f} | {kpi_22y_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日立刻砍)':<22} | {kpi_22y_stop['CAGR']:>6.2f}% | {kpi_22y_stop['multiplier']:>8.2f}x | {kpi_22y_stop['Month_MDD']:>8.2f}% | {kpi_22y_stop['Sharpe']:>6.2f} | {kpi_22y_stop['Calmar']:>6.3f} | {kpi_22y_stop['Win_Rate']:>5.1f}%")
    cagr_diff_22y = kpi_22y_stop['CAGR'] - kpi_22y_base['CAGR']
    mdd_diff_22y = kpi_22y_stop['Month_MDD'] - kpi_22y_base['Month_MDD']
    print(f"👉 差異變化：CAGR {cagr_diff_22y:+.2f}%, 月最大回撤改善 {mdd_diff_22y:+.2f}%")
    print("=" * 90)

    # 輸出 json 報告
    out_file = "/Users/huanggin-chen/openclaw_test/daily_ma60_stop_comparison_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'period_3y': {'baseline': kpi_3y_base, 'daily_ma60_stop': kpi_3y_stop},
            'period_full_bull': {'baseline': kpi_full_base, 'daily_ma60_stop': kpi_full_stop},
            'period_22y': {'baseline': kpi_22y_base, 'daily_ma60_stop': kpi_22y_stop}
        }, f, indent=2, ensure_ascii=False)
    print(f"\n完整對比結果已保存至: {out_file}")

if __name__ == '__main__':
    main()
