#!/usr/bin/env python3
"""
run_19_factor_ultra_doe.py
👑 全球主權泰坦旗艦：17+2 大全因子 超大型 DOE (Design of Experiments) 終極優化大搜索
========================================================================================
全面涵蓋 19 大量化維度因子：
1. mom_12m (12M 長週期動能)
2. mom_6m (6M 中長週期動能)
3. mom_3m (3M 中期動能)
4. mom_1m (1M 短期動能)
5. mom_2w (2W 超短期動能)
6. res_mom (Beta 剝離特質 Alpha)
7. fip (FIP 溫水煮青蛙平滑連續性)
8. convexity (非對稱上行/下行波動凸性)
9. er_60 (Kaufman 60D 分形趨勢效率比)
10. prox_52w (52週新高空間錨定比)
11. bias_ma60 (60MA 均線乖離率懲罰)
12. zscore_20d (20D 價格 Z-Score 超買抑制)
13. vcp_score (Minervini VCP 波動收縮與浮額洗淨緊湊度)
14. chip_score (主力籌碼沉澱 / CMF 機構吸籌指標)
15. churn_exhaustion (爆量滯漲高檔誘多過濾網)
16. global_breadth (主權全球大盤寬幅 60MA/200MA 自適應避險風控)
17. safe_cash_ret (黃金 GLD 趨勢跟蹤與 BIL 國債現金收益複合避險池)
18. 🌟 parkinson_squeeze: Parkinson (1980) 日內最高最低波動率極致壓縮乘數 (w_parkinson)
19. 🌟 pullback_entry: Medhat & Schmeling (2022 RFS) 強趨勢 5D 良性回踩防追高乘數 (w_pullback)

多進程並行 (8 核心) 遍歷數百組廣域與細密正交實驗設計，尋找「CAGR 更高、MDD 更小、勝率更高」的 19 因子終極霸主！
"""

import os
import sys
import time
import json
import sqlite3
import itertools
import multiprocessing as mp
import numpy as np
import pandas as pd

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def load_19_factor_data():
    print("[1/4] 載入資料庫並預計算 19 大全維度量化因子特徵矩陣...")
    t0 = time.time()
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

    # 清洗跳空極端雜訊
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

    # 多週期價格動能
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

    # 🌟 新增因子 18: parkinson_squeeze (Parkinson 1980 振幅極致壓縮)
    hl_ratio = (px_high / (px_low + 1e-6)).clip(lower=1.0)
    parkinson_vol_5d = np.sqrt(((np.log(hl_ratio) ** 2) / (4.0 * np.log(2.0))).rolling(5).mean())
    close_vol_20d = px_daily_ret.rolling(20).std().replace(0, np.nan)
    parkinson_squeeze = (close_vol_20d / (parkinson_vol_5d + 1e-6)).clip(0.1, 10.0)
    parkinson_norm = parkinson_squeeze.rank(axis=1, pct=True).fillna(0.5)

    # 🌟 新增因子 19: pullback_entry (Medhat & Schmeling 2022 RFS 5D 回踩防追高)
    ret_5d = px_adj.pct_change(5).fillna(0.0)
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

    print(f"特徵預計算完成，耗時 {time.time()-t0:.2f} 秒。")

    return {
        'px_adj': px_adj, 'px_open': px_open, 'stock_tickers': stock_tickers,
        'mom12m': mom12m, 'mom6m': mom6m, 'mom3m': mom3m, 'mom1m': mom1m, 'mom2w': mom2w,
        'res_mom_core': res_mom_core,
        'fip_mat': fip_mat, 'stk_convexity': stk_convexity,
        'er_60': er_60, 'prox_52w': prox_52w,
        'bias_ma60': bias_ma60, 'zscore_20d': zscore_20d,
        'vcp_norm': vcp_norm, 'chip_norm': chip_norm,
        'parkinson_norm': parkinson_norm, 'pullback_norm': pullback_norm,
        'eligible_mask': eligible_mask, 'global_breadth': global_breadth,
        'safe_cash_ret': safe_cash_ret,
        'periods_a': periods_a, 'periods_b': periods_b
    }

GLOBAL_DATA = None

def init_worker(shared_data):
    global GLOBAL_DATA
    GLOBAL_DATA = shared_data

def evaluate_19_factor_trial(param):
    """
    評估單組 19 因子參數試驗 (全歷史雙滾動 Cohort 引擎)
    """
    D = GLOBAL_DATA
    px_adj = D['px_adj']
    px_open = D['px_open']
    eligible_mask = D['eligible_mask']
    global_breadth = D['global_breadth']
    safe_cash_ret = D['safe_cash_ret']
    periods_a = D['periods_a']
    periods_b = D['periods_b']

    w12, w6, w3, w1, w2 = param['w_mom']
    raw_mom = w12 * D['mom12m'] + w6 * D['mom6m'] + w3 * D['mom3m'] + w1 * D['mom1m'] + w2 * D['mom2w']
    blend_mom = (1.0 - param['w_res']) * raw_mom + param['w_res'] * D['res_mom_core']

    fip_mult = 1.0 + param['w_fip'] * D['fip_mat']
    conv_mult = 1.0 + param['w_conv'] * (D['stk_convexity'] - 1.0).clip(-0.5, 2.0)
    er_mult = 1.0 + param['w_er'] * (D['er_60'] - 0.5)
    prox_mult = 1.0 + param['w_prox'] * (D['prox_52w'] ** 2 - 0.5)
    vcp_mult = 1.0 + param['w_vcp'] * (D['vcp_norm'] - 0.5)
    chip_mult = 1.0 + param['w_chip'] * (D['chip_norm'] - 0.5)
    bias_mult = 1.0 + param['w_bias'] * D['bias_ma60']
    z_mult = 1.0 + param['w_z'] * (D['zscore_20d'] / 3.0)

    # 🌟 新增兩大因子乘數
    parkinson_mult = 1.0 + param.get('w_parkinson', 0.0) * (D['parkinson_norm'] - 0.5)
    pullback_mult = 1.0 + param.get('w_pullback', 0.0) * (D['pullback_norm'] - 0.5)

    mom_matrix = (blend_mom * fip_mult * conv_mult * er_mult * prox_mult * 
                  vcp_mult * chip_mult * bias_mult * z_mult * parkinson_mult * pullback_mult)
    base_weights = param['ladder']

    def run_p(periods, initial_capital=500000.0):
        current_holdings = {}
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
            cash = net_val * target_alloc.get('CASH', 0.0)
            for s, w in target_alloc.items():
                if s != 'CASH':
                    op = px_open.loc[t_in, s]
                    current_holdings[s] = (net_val * w) / op
                    
            sub_dates = px_adj.index[(px_adj.index >= t_in) & (px_adj.index <= t_out)]
            if cash > 0:
                c_ret = safe_cash_ret.loc[sub_dates]
                cum_cash = cash * (1.0 + c_ret).cumprod()
            else:
                cum_cash = 0.0
                
            stk_val = 0.0
            for s, sh in current_holdings.items():
                stk_val = stk_val + sh * px_adj.loc[sub_dates, s]
                
            daily_equity.loc[sub_dates] = cum_cash + stk_val
            if cash > 0:
                cash = float(cum_cash.iloc[-1])
                
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

    # 綜合適應度評分
    fitness = cagr * 0.40 + calmar * 15.0 + sharpe * 10.0 - abs(m_mdd) * 0.40 + win_rate * 0.15

    return {
        'param': param,
        'CAGR': round(cagr, 2),
        'Month_MDD': round(m_mdd, 2),
        'Daily_MDD': round(d_mdd, 2),
        'Sharpe': round(sharpe, 2),
        'Calmar': round(calmar, 3),
        'Win_Rate': round(win_rate, 1),
        'Fitness': round(fitness, 2)
    }

def generate_19_factor_ultra_doe_space():
    print("[2/4] 生成 17+2 大全維度因子超大型 DOE (Design of Experiments) 網格空間...")
    
    # 核心動能配比
    mom_combos = [
        (0.45, 0.00, 0.35, 0.20, 0.00), # 經典 45/35/20
        (0.40, 0.10, 0.30, 0.15, 0.05), # 均衡 5 週期
        (0.50, 0.00, 0.30, 0.15, 0.05), # 長線加強
        (0.45, 0.10, 0.30, 0.15, 0.00)  # 中長線因果配比
    ]

    # 特質殘差 Alpha
    w_res_list = [0.10, 0.12, 0.16]
    
    # FIP 連續性
    w_fip_list = [0.40, 0.45, 0.55]

    # 凸性
    w_conv_list = [0.14, 0.18, 0.22]

    # ER 分形效率
    w_er_list = [0.25, 0.32, 0.40]

    # 52W 新高空間
    w_prox_list = [0.00, 0.06, 0.12]

    # 乖離率與 Z-Score
    bias_z_combos = [
        (-0.05, 0.00),
        (-0.06, -0.04),
        (0.00, 0.00)
    ]

    # VCP 波動收縮
    w_vcp_list = [0.12, 0.18, 0.24]

    # CMF 籌碼沉澱
    w_chip_list = [0.12, 0.16, 0.22]

    # 🌟 新增因子 18: parkinson_squeeze (0.00 ~ 0.20)
    w_parkinson_list = [0.00, 0.08, 0.12, 0.16, 0.20]

    # 🌟 新增因子 19: pullback_entry (0.00 ~ 0.15)
    w_pullback_list = [0.00, 0.06, 0.12]

    # 階梯部位管理
    ladders = [
        [0.50, 0.30, 0.20], # 基準均衡
        [0.55, 0.30, 0.15], # 龍頭傾斜 (Calmar 2.604 冠軍階梯)
        [0.60, 0.25, 0.15]  # 超級龍頭 (CAGR 65.5% 階梯)
    ]

    # 系統性正交網格與高覆蓋拉丁超立方抽樣 (生成約 550~650 組代表性試驗)
    np.random.seed(42)
    doe_candidates = []
    
    # 核心網格密集取樣
    for m in mom_combos:
        for r in w_res_list:
            for f in w_fip_list:
                for vcp in w_vcp_list:
                    for park in w_parkinson_list:
                        pull = np.random.choice(w_pullback_list)
                        c = np.random.choice(w_conv_list)
                        er = np.random.choice(w_er_list)
                        px = np.random.choice(w_prox_list)
                        cp = np.random.choice(w_chip_list)
                        bz = bias_z_combos[np.random.randint(len(bias_z_combos))]
                        ld = ladders[np.random.randint(len(ladders))]
                        
                        doe_candidates.append({
                            'w_mom': m,
                            'w_res': r,
                            'w_fip': f,
                            'w_conv': c,
                            'w_er': er,
                            'w_prox': px,
                            'w_bias': bz[0],
                            'w_z': bz[1],
                            'w_vcp': vcp,
                            'w_chip': cp,
                            'w_parkinson': park,
                            'w_pullback': pull,
                            'ladder': ld
                        })

    # 去重
    unique_candidates = []
    seen = set()
    for item in doe_candidates:
        sig = (item['w_mom'], item['w_res'], item['w_fip'], item['w_conv'], item['w_er'], 
               item['w_prox'], item['w_bias'], item['w_z'], item['w_vcp'], item['w_chip'], 
               item['w_parkinson'], item['w_pullback'], tuple(item['ladder']))
        if sig not in seen:
            seen.add(sig)
            unique_candidates.append(item)

    print(f"超大型 DOE 實驗矩陣構建完成：共 {len(unique_candidates)} 組正交超立方試驗空間！")
    return unique_candidates

def main():
    print("=" * 85)
    print(" 👑 全球主權泰坦模型：17+2 全因子 超大型 DOE 終極優化 (8核心並行搜索)")
    print("=" * 85)
    
    data = load_19_factor_data()
    doe_space = generate_19_factor_ultra_doe_space()
    
    print(f"\n[3/4] 啟動多進程 Pool (8 核心並行運算 {len(doe_space)} 組試驗)...")
    t_start = time.time()
    
    num_cores = min(8, mp.cpu_count())
    pool = mp.Pool(processes=num_cores, initializer=init_worker, initargs=(data,))
    
    results = pool.map(evaluate_19_factor_trial, doe_space)
    pool.close()
    pool.join()
    
    elapsed = time.time() - t_start
    print(f"超大型 DOE 全部試驗評估完畢，耗時 {elapsed:.2f} 秒 (平均每秒處理 {len(doe_space)/elapsed:.1f} 組試驗)！")

    # 4. 排序與最佳化分析
    print("\n[4/4] 統計全域搜尋結果，挑選各大王者策略...")
    
    # 綜合適應度最佳冠軍
    sorted_by_fitness = sorted(results, key=lambda x: x['Fitness'], reverse=True)
    best_overall = sorted_by_fitness[0]
    
    # 最高 CAGR 霸主
    sorted_by_cagr = sorted(results, key=lambda x: x['CAGR'], reverse=True)
    best_cagr = sorted_by_cagr[0]
    
    # 最高 Calmar 風益比之王
    sorted_by_calmar = sorted(results, key=lambda x: x['Calmar'], reverse=True)
    best_calmar = sorted_by_calmar[0]
    
    # 最高勝率之王
    sorted_by_win = sorted(results, key=lambda x: x['Win_Rate'], reverse=True)
    best_win = sorted_by_win[0]
    
    # 最低月度回撤之王 (在 CAGR > 55% 前提下)
    mdd_candidates = [r for r in results if r['CAGR'] >= 55.0]
    best_mdd = sorted(mdd_candidates, key=lambda x: x['Month_MDD'], reverse=True)[0]

    print("\n==================== 19 大維度全因子超大型 DOE 王者排行榜 ====================")
    print(f"{'榮譽獎項':<22} | {'CAGR':<8} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'勝率':<6} | {'階梯配置'}")
    print("-" * 90)
    print(f"{'🏆 綜合適應度冠軍':<22} | {best_overall['CAGR']:>6.2f}% | {best_overall['Month_MDD']:>8.2f}% | {best_overall['Sharpe']:>6.2f} | {best_overall['Calmar']:>6.3f} | {best_overall['Win_Rate']:>5.1f}% | {best_overall['param']['ladder']}")
    print(f"{'🚀 最高 CAGR 收益霸主':<22} | {best_cagr['CAGR']:>6.2f}% | {best_cagr['Month_MDD']:>8.2f}% | {best_cagr['Sharpe']:>6.2f} | {best_cagr['Calmar']:>6.3f} | {best_cagr['Win_Rate']:>5.1f}% | {best_cagr['param']['ladder']}")
    print(f"{'💎 最高 Calmar 風益之王':<22} | {best_calmar['CAGR']:>6.2f}% | {best_calmar['Month_MDD']:>8.2f}% | {best_calmar['Sharpe']:>6.2f} | {best_calmar['Calmar']:>6.3f} | {best_calmar['Win_Rate']:>5.1f}% | {best_calmar['param']['ladder']}")
    print(f"{'🛡️ 最低月度回撤之王':<22} | {best_mdd['CAGR']:>6.2f}% | {best_mdd['Month_MDD']:>8.2f}% | {best_mdd['Sharpe']:>6.2f} | {best_mdd['Calmar']:>6.3f} | {best_mdd['Win_Rate']:>5.1f}% | {best_mdd['param']['ladder']}")
    print(f"{'🎯 最高月度勝率之王':<22} | {best_win['CAGR']:>6.2f}% | {best_win['Month_MDD']:>8.2f}% | {best_win['Sharpe']:>6.2f} | {best_win['Calmar']:>6.3f} | {best_win['Win_Rate']:>5.1f}% | {best_win['param']['ladder']}")
    print("-" * 90)

    print("\n👑 綜合適應度總冠軍參數詳解：")
    print(json.dumps(best_overall['param'], indent=2))

    # 輸出 Top 20 與統計分佈
    out_file = "/Users/huanggin-chen/openclaw_test/ultra_19_factor_doe_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            'timestamp': pd.Timestamp.now().isoformat(),
            'total_tested': len(results),
            'elapsed_seconds': round(elapsed, 2),
            'champion_overall': best_overall,
            'champion_cagr': best_cagr,
            'champion_calmar': best_calmar,
            'champion_min_mdd': best_mdd,
            'champion_win_rate': best_win,
            'top_20': sorted_by_fitness[:20]
        }, f, indent=2, ensure_ascii=False)
        
    print(f"\n完整 19 因子超大型 DOE 成果報告已成功保存至: {out_file}")

if __name__ == '__main__':
    main()
