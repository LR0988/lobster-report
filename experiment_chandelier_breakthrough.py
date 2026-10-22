#!/usr/bin/env python3
"""
experiment_chandelier_breakthrough.py
👑 突破天花板實證：超額集中度階梯 + 日頻 Chandelier ATR 吊燈動態止盈止損
=============================================================================
測試升維機制：
1. 階梯倉位結構升級 (Super Alpha Ladder [0.55, 0.30, 0.15] / [0.60, 0.25, 0.15])
2. 日頻動態 Chandelier 移動吊索止盈 (從進場後創出最高點回撤 3.5~4.0 ATR 鎖利出場)
3. 突發黑天鵝硬止損 (-9% Stop Loss)
4. 寬幅動態趨勢斜率過濾

全歷史 (2004–2026) 雙滾動 Cohort (Periods A + B) 實證
"""

import os
import sys
import time
import json
import sqlite3
import numpy as np
import pandas as pd
from scipy import stats

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def load_data():
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

    # 清洗跳空極端針
    ret_1d = px_adj.pct_change(fill_method=None)
    ret_next = px_adj.pct_change(-1, fill_method=None)
    spike_mask = (ret_1d.abs() > 0.20) & (ret_next.abs() > 0.20) & ((ret_1d * ret_next) > 0)
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

    # ATR 計算 (14日真實波動幅度)
    tr1 = px_high - px_low
    tr2 = (px_high - px_adj.shift(1)).abs()
    tr3 = (px_low - px_adj.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3]).groupby(level=0).max()
    atr_14 = tr.rolling(14, min_periods=5).mean()
    atr_pct = atr_14 / (px_adj + 1e-6)

    # 動能矩陣
    mom2w = px_adj.pct_change(10)
    mom1m = px_adj.pct_change(21)
    mom3m = px_adj.pct_change(63)
    mom6m = px_adj.pct_change(126)
    mom12m = px_adj.pct_change(252)

    spy_adj = sov_adj['SPY']
    spy_ret1m = spy_adj.pct_change(21)
    spy_ret3m = spy_adj.pct_change(63)
    spy_ret12m = spy_adj.pct_change(252)
    spy_d_ret = spy_adj.pct_change()
    spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)

    betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
    px_daily_ret = px_adj.pct_change()
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
    gld_mom3m = gld_open.pct_change(63)
    gld_ret_1d = gld_open.pct_change().fillna(0.0)
    bil_ret_1d = sov_adj['BIL'].pct_change().fillna(0.00008).clip(-0.01, 0.01)

    gld_cond = (gld_open > gld_ma60) & (gld_open > gld_ma200) & (gld_mom3m > 0.02) & (gld_ret_1d.abs() < 0.08)
    safe_cash_ret = np.where(gld_cond, 0.60 * gld_ret_1d + 0.40 * bil_ret_1d, bil_ret_1d)
    safe_cash_ret = pd.Series(safe_cash_ret, index=px_adj.index).fillna(0.0)

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

    factors_dict = {
        'mom_12m': mom12m, 'mom_6m': mom6m, 'mom_3m': mom3m, 'mom_1m': mom1m, 'mom_2w': mom2w,
        'res_mom': res_mom_core, 'fip': fip_mat, 'convexity': stk_convexity,
        'er_60': er_60, 'prox_52w': prox_52w, 'bias_ma60': bias_ma60, 'zscore_20d': zscore_20d,
        'vcp_norm': vcp_norm, 'chip_norm': chip_norm,
        'atr_pct': atr_pct
    }

    return {
        'factors': factors_dict,
        'eligible': eligible_mask,
        'periods_a': periods_a,
        'periods_b': periods_b,
        'px_adj': px_adj,
        'px_open': px_open,
        'px_high': px_high,
        'px_low': px_low,
        'global_breadth': global_breadth,
        'safe_cash_ret': safe_cash_ret
    }

def run_simulation(data, param, chandelier_atr=None, hard_stop_loss=None):
    """
    支援日頻 Chandelier 吊燈止盈與硬止損的雙滾動回測引擎
    """
    px_adj = data['px_adj']
    px_open = data['px_open']
    px_high = data['px_high']
    px_low = data['px_low']
    eligible_mask = data['eligible']
    global_breadth = data['global_breadth']
    safe_cash_ret = data['safe_cash_ret']
    periods_a = data['periods_a']
    periods_b = data['periods_b']
    F = data['factors']

    w12, w6, w3, w1, w2 = param['w_mom']
    raw_mom = w12 * F['mom_12m'] + w6 * F['mom_6m'] + w3 * F['mom_3m'] + w1 * F['mom_1m'] + w2 * F['mom_2w']
    blend_mom = (1.0 - param['w_res']) * raw_mom + param['w_res'] * F['res_mom']

    fip_mult = 1.0 + param['w_fip'] * F['fip']
    conv_mult = 1.0 + param['w_conv'] * (F['convexity'] - 1.0).clip(-0.5, 2.0)
    er_mult = 1.0 + param['w_er'] * (F['er_60'] - 0.5)
    prox_mult = 1.0 + param['w_prox'] * (F['prox_52w'] ** 2 - 0.5)
    vcp_mult = 1.0 + param['w_vcp'] * (F['vcp_norm'] - 0.5)
    chip_mult = 1.0 + param['w_chip'] * (F['chip_norm'] - 0.5)
    bias_mult = 1.0 + param['w_bias'] * F['bias_ma60']
    z_mult = 1.0 + param['w_z'] * (F['zscore_20d'] / 3.0)

    mom_matrix = blend_mom * fip_mult * conv_mult * er_mult * prox_mult * vcp_mult * chip_mult * bias_mult * z_mult
    base_weights = param['ladder']

    atr_pct = F['atr_pct']

    def run_p(periods, initial_capital=500000.0):
        current_holdings = {} # {symbol: shares}
        entry_prices = {}
        highest_prices = {}
        cash = initial_capital
        holding_tenure = {}
        friction = 0.0015
        
        all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        
        for p_idx, (t_date, t_in, t_out) in enumerate(periods):
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
                    if rk <= 5 and tenure < 4:
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
                    
            cur_weights = {}
            if cur_val > 0:
                for s, sh in current_holdings.items():
                    cur_weights[s] = (sh * px_open.loc[t_in, s]) / cur_val
            all_syms = set(list(cur_weights.keys()) + list(target_alloc.keys()))
            turnover = sum(abs(target_alloc.get(s, 0.0) - cur_weights.get(s, 0.0)) for s in all_syms if s != 'CASH')
            fee = (turnover / 2.0) * friction * cur_val
            net_val = cur_val - fee
            
            current_holdings = {}
            entry_prices = {}
            highest_prices = {}
            cash = net_val * target_alloc.get('CASH', 0.0)
            for s, w in target_alloc.items():
                if s != 'CASH':
                    op = px_open.loc[t_in, s]
                    current_holdings[s] = (net_val * w) / op
                    entry_prices[s] = op
                    highest_prices[s] = op
                    
            sub_dates = px_adj.index[(px_adj.index >= t_in) & (px_adj.index <= t_out)]
            
            # 日頻步進模擬 (日線檢驗 Chandelier 吊燈與硬止損)
            for dt in sub_dates:
                # 避險資產收益增長
                c_ret_day = safe_cash_ret.loc[dt]
                cash = cash * (1.0 + c_ret_day)
                
                # 檢查個股動態止盈止損
                stks_to_exit = []
                day_stk_total = 0.0
                
                for s, sh in list(current_holdings.items()):
                    p_c = px_adj.loc[dt, s]
                    p_h = px_high.loc[dt, s]
                    p_l = px_low.loc[dt, s]
                    
                    if p_h > highest_prices.get(s, 0.0):
                        highest_prices[s] = p_h
                        
                    # 判斷是否觸發 Chandelier 吊燈止盈 (從最高點回撤超過 k * ATR)
                    atr_val = atr_pct.loc[dt, s] if dt in atr_pct.index else 0.03
                    peak = highest_prices[s]
                    
                    hit_exit = False
                    if chandelier_atr is not None and peak > 0:
                        chand_trail_line = peak * (1.0 - chandelier_atr * atr_val)
                        if p_c < chand_trail_line:
                            hit_exit = True
                            
                    # 判斷是否觸發硬止損 (-8% / -9%)
                    if hard_stop_loss is not None:
                        cost = entry_prices.get(s, p_c)
                        if (p_c / cost - 1.0) < -hard_stop_loss:
                            hit_exit = True
                            
                    if hit_exit:
                        stks_to_exit.append(s)
                    else:
                        day_stk_total += sh * p_c
                        
                # 執行退出個股至現金
                for s in stks_to_exit:
                    p_exit = px_adj.loc[dt, s]
                    exit_val = current_holdings[s] * p_exit * (1.0 - friction)
                    cash += exit_val
                    del current_holdings[s]
                    if s in holding_tenure:
                        del holding_tenure[s]
                        
                daily_equity.loc[dt] = cash + day_stk_total
                
        return daily_equity.ffill().bfill()

    eq_a = run_p(periods_a)
    eq_b = run_p(periods_b)
    common_idx = eq_a.dropna().index
    eq = eq_a.loc[common_idx] + eq_b.reindex(common_idx).ffill().bfill()

    years = (eq.index[-1] - eq.index[0]).days / 365.25
    cagr = float(((eq.iloc[-1] / eq.iloc[0]) ** (1.0 / years) - 1.0) * 100.0)

    m_series = eq.resample('ME').last()
    m_ret = m_series.pct_change().dropna()
    m_mdd = float(((m_series - m_series.cummax()) / m_series.cummax() * 100.0).min())
    d_mdd = float(((eq - eq.cummax()) / eq.cummax() * 100.0).min())
    sharpe = float((m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12))
    calmar = cagr / abs(m_mdd)
    win_rate = float((m_ret > 0).mean() * 100.0)

    return {
        'CAGR': float(cagr),
        'Month_MDD': float(m_mdd),
        'Daily_MDD': float(d_mdd),
        'Sharpe': float(sharpe),
        'Calmar': float(calmar),
        'Win_Rate': float(win_rate)
    }

def main():
    print("=" * 85)
    print(" 👑 全球主權泰坦模型：突破天花板實證大搜索 (集中度階梯 + 動態 Chandelier 吊燈)")
    print("=" * 85)
    
    data = load_data()
    
    base_param = {
        'w_mom': (0.45, 0.0, 0.35, 0.2, 0.0),
        'w_res': 0.12, 'w_fip': 0.45, 'w_conv': 0.16, 'w_er': 0.3,
        'w_prox': 0.1, 'w_bias': -0.05, 'w_z': 0.0, 'w_vcp': 0.15, 'w_chip': 0.16,
        'ladder': [0.5, 0.3, 0.2]
    }
    
    experiments = [
        ('基準冠軍策略 (原模型)', base_param, None, None),
        # 1. 階梯優化
        ('突破 1: 龍頭傾斜 [0.55, 0.30, 0.15]', {**base_param, 'ladder': [0.55, 0.30, 0.15]}, None, None),
        ('突破 2: 超級龍頭 [0.60, 0.25, 0.15]', {**base_param, 'ladder': [0.60, 0.25, 0.15]}, None, None),
        ('突破 3: 極致核心 [0.65, 0.23, 0.12]', {**base_param, 'ladder': [0.65, 0.23, 0.12]}, None, None),
        # 2. 加入 Chandelier 吊燈移動停利 (從最高點回撤 4.0 ATR 止盈)
        ('突破 4: 基準 + Chandelier 4.0 ATR 止盈', base_param, 4.0, None),
        ('突破 5: 基準 + Chandelier 3.5 ATR 止盈', base_param, 3.5, None),
        ('突破 6: 基準 + 硬止損 9% (Hard Stop)', base_param, None, 0.09),
        ('突破 7: 龍頭 [0.55, 0.30, 0.15] + Chandelier 4.0 ATR', {**base_param, 'ladder': [0.55, 0.30, 0.15]}, 4.0, None),
        ('突破 8: 超級龍頭 [0.60, 0.25, 0.15] + Chandelier 4.0 ATR', {**base_param, 'ladder': [0.60, 0.25, 0.15]}, 4.0, None),
        ('突破 9: 超級龍頭 [0.60, 0.25, 0.15] + Chandelier 4.5 ATR', {**base_param, 'ladder': [0.60, 0.25, 0.15]}, 4.5, None),
    ]
    
    print(f"\n{'策略升維架構名稱':<45} | {'CAGR':<8} | {'Month MDD':<10} | {'Daily MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'勝率'}")
    print("-" * 105)
    
    results = {}
    for name, p, chand, h_stop in experiments:
        res = run_simulation(data, p, chandelier_atr=chand, hard_stop_loss=h_stop)
        results[name] = res
        print(f"{name:<45} | {res['CAGR']:>6.2f}% | {res['Month_MDD']:>8.2f}% | {res['Daily_MDD']:>8.2f}% | {res['Sharpe']:>6.2f} | {res['Calmar']:>6.3f} | {res['Win_Rate']:>5.1f}%")
        
    print("-" * 105)
    
    # 保存成果
    out_file = "/Users/huanggin-chen/openclaw_test/chandelier_breakthrough_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
        
    print(f"\n成果已成功寫入: {out_file}")

if __name__ == '__main__':
    main()
