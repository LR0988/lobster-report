#!/usr/bin/env python3
"""
run_causal_forest_titan.py
👑 全球主權泰坦模型：因果推論升維 —— CausalForestDML 異質因果處置效應 (CATE) 策略
===================================================================================
學術架構與理論基礎：
1. Susan Athey, Guido Imbens (Nobel Laureates), Stefan Wager (2018, 2019):
   - Generalized Random Forests (GRF) & Causal Forest DML (Double Machine Learning)
   - 估計條件平均處置效應 (Conditional Average Treatment Effect, CATE):
     \tau(x) = E[ Y | do(T=1), X=x ] - E[ Y | do(T=0), X=x ]
   - 解決傳統 ML 只學「相關性 (Correlation)」而不懂「因果性 (Causation)」的致命缺陷

2. 金融場景建模：
   - Y (標籤): 未來 20 個交易日前瞻超額報酬率 (Excess Return over SPY)
   - T (處置): 核心多因子驅動信號 (綜合動能與趨勢效率處置)
   - X (異質性調節變量): 全球主權寬幅、市場波動度、個股趨勢效率、特質波動率
   - W (混淆協變量): 跨截面其他多重共線性風險因子
   - 因果森林自適應輸出每檔股票在當前市場狀態下的純因果 Alpha: \hat{\tau}_i(t)

3. 2004–2026 全歷史旗艦雙滾動 Cohort (Periods A + B) 回測對比
"""

import os
import sys
import time
import json
import sqlite3
import numpy as np
import pandas as pd
from scipy import stats
import lightgbm as lgb
from econml.dml import CausalForestDML
from sklearn.model_selection import KFold

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def load_data_for_causal_forest():
    print("[1/5] 載入資料庫並構建因果推論特徵工程矩陣...")
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

    # 清洗跳空極端針
    ret_1d = px_adj.pct_change(fill_method=None)
    ret_next = px_adj.pct_change(-1, fill_method=None)
    spike_mask = (ret_1d.abs() > 0.20) & (ret_next.abs() > 0.20) & ((ret_1d * ret_next) > 0)
    px_adj[spike_mask] = np.nan
    px_open[spike_mask] = np.nan
    px_adj = px_adj.ffill()
    px_open = px_open.ffill()

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
    spy_vol_60 = spy_d_ret.rolling(60).std() * np.sqrt(252)

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

    # 雙滾動管道
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

    # 前瞻超額報酬標籤
    fwd_ret_20d = px_adj.shift(-21) / px_adj - 1.0
    spy_fwd_ret_20d = spy_adj.shift(-21) / spy_adj - 1.0
    fwd_excess_ret_20d = fwd_ret_20d.sub(spy_fwd_ret_20d, axis=0)

    # 綜合動能基底處置信號 T
    treatment_raw = (0.45 * mom12m.rank(axis=1, pct=True) +
                     0.35 * mom3m.rank(axis=1, pct=True) +
                     0.20 * mom1m.rank(axis=1, pct=True))

    factors_dict = {
        'mom_12m': mom12m, 'mom_6m': mom6m, 'mom_3m': mom3m, 'mom_1m': mom1m, 'mom_2w': mom2w,
        'res_mom': res_mom_core, 'fip': fip_mat, 'convexity': stk_convexity,
        'er_60': er_60, 'prox_52w': prox_52w, 'bias_ma60': bias_ma60, 'zscore_20d': zscore_20d,
        'vcp_norm': vcp_norm, 'chip_norm': chip_norm,
        'treatment_base': treatment_raw,
        'betas_126': betas_126
    }

    macro_dict = {
        'spy_ret1m': spy_ret1m, 'spy_ret3m': spy_ret3m, 'spy_ret12m': spy_ret12m,
        'spy_vol_60': spy_vol_60, 'global_breadth': global_breadth
    }

    print(f"資料載入完成，耗時 {time.time()-t0:.2f} 秒。")

    return {
        'factors': factors_dict,
        'macro': macro_dict,
        'fwd_excess': fwd_excess_ret_20d,
        'eligible': eligible_mask,
        'periods_a': periods_a,
        'periods_b': periods_b,
        'px_adj': px_adj,
        'px_open': px_open,
        'sov_adj': sov_adj,
        'stock_tickers': stock_tickers,
        'global_breadth': global_breadth,
        'safe_cash_ret': safe_cash_ret
    }

def train_causal_forest_and_predict(data):
    """
    使用 EconML CausalForestDML 估計條件平均處置效應 (CATE)
    """
    print("\n[2/5] 訓練 EconML CausalForestDML 異質因果效應模型 (Susan Athey & Guido Imbens 框架)...")
    F = data['factors']
    macro = data['macro']
    fwd_excess = data['fwd_excess']
    eligible = data['eligible']
    periods_a = data['periods_a']
    rebal_dates = [p[0] for p in periods_a]
    
    # 建立橫截面觀測樣本池
    records = []
    for dt in rebal_dates[:-1]:
        mask_d = eligible.loc[dt]
        active = mask_d[mask_d].index.tolist()
        if len(active) < 15:
            continue
            
        br = float(macro['global_breadth'].loc[dt])
        sp_vol = float(macro['spy_vol_60'].loc[dt])
        sp_ret3m = float(macro['spy_ret3m'].loc[dt])
        
        for stk in active:
            y_val = fwd_excess.loc[dt, stk]
            if np.isnan(y_val):
                continue
                
            t_val = F['treatment_base'].loc[dt, stk]
            er = F['er_60'].loc[dt, stk]
            vcp = F['vcp_norm'].loc[dt, stk]
            chip = F['chip_norm'].loc[dt, stk]
            fip = F['fip'].loc[dt, stk]
            conv = F['convexity'].loc[dt, stk]
            beta = F['betas_126'].loc[dt, stk]
            bias = F['bias_ma60'].loc[dt, stk]
            
            if any(np.isnan([t_val, er, vcp, chip, fip, conv, beta, bias])):
                continue
                
            records.append({
                'date': dt, 'ticker': stk, 'Y': y_val, 'T': t_val,
                # 異質性特徵 X (調節因果效應大小的市場與個股狀態)
                'X_breadth': br, 'X_spy_vol': sp_vol, 'X_spy_ret3m': sp_ret3m,
                'X_er60': er, 'X_vcp': vcp, 'X_chip': chip,
                # 混淆特徵 W (其他共線性干擾)
                'W_fip': fip, 'W_conv': conv, 'W_beta': beta, 'W_bias': bias
            })

    df_samples = pd.DataFrame(records)
    print(f"因果森林訓練樣本：共 {len(df_samples):,} 筆 (2004–2026 全歷史截面)。")

    Y = df_samples['Y'].values
    T = df_samples['T'].values
    X_cols = [c for c in df_samples.columns if c.startswith('X_')]
    W_cols = [c for c in df_samples.columns if c.startswith('W_')]
    X = df_samples[X_cols].values
    W = df_samples[W_cols].values

    # 設定 CausalForestDML:
    # 輔助回歸用 LightGBM 預測 Y 與 T
    # 因果森林 (n_estimators=100) 尋找異質性分叉
    t_train0 = time.time()
    cf = CausalForestDML(
        model_y=lgb.LGBMRegressor(n_estimators=60, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2),
        model_t=lgb.LGBMRegressor(n_estimators=60, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2),
        n_estimators=100,
        criterion='mse',
        max_depth=5,
        min_samples_leaf=20,
        random_state=42,
        n_jobs=-1
    )
    
    cf.fit(Y, T, X=X, W=W)
    print(f"CausalForestDML 擬合完成，耗時 {time.time()-t_train0:.2f} 秒。")

    # 評估因果處置效應 CATE 的異質性
    cate_estimates = cf.effect(X)
    print(f"\n--- 因果處置效應 (CATE) 統計分佈 ---")
    print(f"CATE 平均處置效應 (ATE): {np.mean(cate_estimates):+.4f}")
    print(f"CATE 標準差 (異質性強度): {np.std(cate_estimates):.4f}")
    print(f"CATE 25% 分位數: {np.percentile(cate_estimates, 25):+.4f} | 中位數: {np.median(cate_estimates):+.4f} | 75% 分位數: {np.percentile(cate_estimates, 75):+.4f}")
    print(f"CATE 最高潛力組前 5%: {np.percentile(cate_estimates, 95):+.4f}")

    # 為整個股票歷史預測動態因果 Alpha 矩陣 \hat{\tau}(X)
    print("\n正在生成全歷史各期橫截面因果 Alpha 預測矩陣...")
    stock_tickers = data['stock_tickers']
    dates_idx = data['px_adj'].index
    causal_alpha_matrix = pd.DataFrame(np.nan, index=dates_idx, columns=stock_tickers)
    
    # 遍歷全部期數進行因果推斷評分
    all_rebal_dates = sorted(list(set([p[0] for p in data['periods_a']] + [p[0] for p in data['periods_b']])))
    
    for dt in all_rebal_dates:
        mask_d = eligible.loc[dt]
        active = mask_d[mask_d].index.tolist()
        if len(active) == 0:
            continue
            
        br = float(macro['global_breadth'].loc[dt]) if dt in macro['global_breadth'].index else 0.5
        sp_vol = float(macro['spy_vol_60'].loc[dt]) if dt in macro['spy_vol_60'].index else 0.15
        sp_ret3m = float(macro['spy_ret3m'].loc[dt]) if dt in macro['spy_ret3m'].index else 0.02
        
        x_rows = []
        valid_stks = []
        for stk in active:
            er = F['er_60'].loc[dt, stk]
            vcp = F['vcp_norm'].loc[dt, stk]
            chip = F['chip_norm'].loc[dt, stk]
            if not any(np.isnan([er, vcp, chip])):
                x_rows.append([br, sp_vol, sp_ret3m, er, vcp, chip])
                valid_stks.append(stk)
                
        if len(x_rows) > 0:
            tau_pred = cf.effect(np.array(x_rows))
            causal_alpha_matrix.loc[dt, valid_stks] = tau_pred

    causal_alpha_matrix = causal_alpha_matrix.ffill()
    data['causal_alpha_matrix'] = causal_alpha_matrix
    return cf, df_samples

def run_causal_titan_backtest(data, strategy_mode='causal_hybrid', ladder=[0.55, 0.30, 0.15]):
    """
    雙滾動 Cohort 旗艦回測：
    - 'champion_baseline': 現有 17 因子冠軍模型
    - 'pure_causal': 純因果森林 CATE 處置效應排序選股
    - 'causal_hybrid': 因果 Alpha 與 17 因子乘數矩陣之強強雙核共振模型
    """
    px_adj = data['px_adj']
    px_open = data['px_open']
    eligible_mask = data['eligible']
    global_breadth = data['global_breadth']
    safe_cash_ret = data['safe_cash_ret']
    periods_a = data['periods_a']
    periods_b = data['periods_b']
    F = data['factors']
    causal_alpha = data['causal_alpha_matrix']

    # 基準冠軍參數
    w_mom = (0.45, 0.0, 0.35, 0.2, 0.0)
    w_res = 0.12
    w_fip = 0.45
    w_conv = 0.16
    w_er = 0.30
    w_prox = 0.10
    w_bias = -0.05
    w_z = 0.0
    w_vcp = 0.15
    w_chip = 0.16

    w12, w6, w3, w1, w2 = w_mom
    raw_mom = w12 * F['mom_12m'] + w6 * F['mom_6m'] + w3 * F['mom_3m'] + w1 * F['mom_1m'] + w2 * F['mom_2w']
    blend_mom = (1.0 - w_res) * raw_mom + w_res * F['res_mom']

    fip_mult = 1.0 + w_fip * F['fip']
    conv_mult = 1.0 + w_conv * (F['convexity'] - 1.0).clip(-0.5, 2.0)
    er_mult = 1.0 + w_er * (F['er_60'] - 0.5)
    prox_mult = 1.0 + w_prox * (F['prox_52w'] ** 2 - 0.5)
    vcp_mult = 1.0 + w_vcp * (F['vcp_norm'] - 0.5)
    chip_mult = 1.0 + w_chip * (F['chip_norm'] - 0.5)
    bias_mult = 1.0 + w_bias * F['bias_ma60']
    z_mult = 1.0 + w_z * (F['zscore_20d'] / 3.0)

    base_matrix = blend_mom * fip_mult * conv_mult * er_mult * prox_mult * vcp_mult * chip_mult * bias_mult * z_mult

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
            active_symbols = mask_row[mask_row].index.tolist()
            
            if exposure <= 0 or len(active_symbols) == 0:
                target_alloc = {'CASH': 1.0}
                holding_tenure = {}
            else:
                if strategy_mode == 'champion_baseline':
                    scores_row = base_matrix.loc[t_date, active_symbols]
                elif strategy_mode == 'pure_causal':
                    scores_row = causal_alpha.loc[t_date, active_symbols]
                elif strategy_mode == 'causal_hybrid':
                    # 因果雙核乘數共振：基準多因子矩陣 * (1 + 0.35 * CATE 排名加成)
                    base_s = base_matrix.loc[t_date, active_symbols]
                    base_rank = base_s.rank(pct=True).fillna(0.5)
                    c_s = causal_alpha.loc[t_date, active_symbols]
                    c_rank = c_s.rank(pct=True).fillna(0.5)
                    scores_row = base_s * (1.0 + 0.35 * (c_rank - 0.5))
                    
                valid_symbols = scores_row[scores_row > 0].sort_values(ascending=False)
                if len(valid_symbols) == 0:
                    valid_symbols = scores_row.sort_values(ascending=False)
                    
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
                
                bw = ladder[:n]
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

    return {
        'CAGR': float(cagr),
        'Month_MDD': float(m_mdd),
        'Daily_MDD': float(d_mdd),
        'Sharpe': float(sharpe),
        'Calmar': float(calmar),
        'Win_Rate': float(win_rate),
        'monthly_returns': m_ret.tolist()
    }

def main():
    print("=" * 85)
    print(" 👑 全球主權泰坦模型：因果推論升維 (EconML CausalForestDML 異質因果效應)")
    print("=" * 85)
    
    # 1. 載入資料
    data = load_data_for_causal_forest()
    
    # 2. 訓練因果森林模型並預測 CATE Alpha
    cf, df_samples = train_causal_forest_and_predict(data)
    
    # 3. 策略回測對比大對決 (2004–2026 全歷史)
    print("\n[3/5] 執行 2004–2026 全歷史回測：現有基準冠軍 vs. 因果推論雙核共振模型...")
    
    suites = [
        ('1. 現有基準冠軍模型 (標準階梯 0.50/0.30/0.20)', 'champion_baseline', [0.50, 0.30, 0.20]),
        ('2. 現有基準冠軍模型 (龍頭傾斜 0.55/0.30/0.15)', 'champion_baseline', [0.55, 0.30, 0.15]),
        ('3. 純因果森林選股 (Pure Causal Forest CATE)', 'pure_causal', [0.55, 0.30, 0.15]),
        ('4. 因果森林雙核共振模型 (Causal-Titan Hybrid: 0.50/0.30/0.20)', 'causal_hybrid', [0.50, 0.30, 0.20]),
        ('5. 因果森林雙核共振模型 (Causal-Titan Hybrid: 0.55/0.30/0.15)', 'causal_hybrid', [0.55, 0.30, 0.15]),
        ('6. 因果森林超級龍頭 (Causal-Titan Super Alpha: 0.60/0.25/0.15)', 'causal_hybrid', [0.60, 0.25, 0.15])
    ]
    
    print(f"\n{'策略架構名稱':<52} | {'CAGR':<8} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'勝率'}")
    print("-" * 105)
    
    results = {}
    for name, mode, lad in suites:
        res = run_causal_titan_backtest(data, strategy_mode=mode, ladder=lad)
        results[name] = res
        print(f"{name:<52} | {res['CAGR']:>6.2f}% | {res['Month_MDD']:>8.2f}% | {res['Sharpe']:>6.2f} | {res['Calmar']:>6.3f} | {res['Win_Rate']:>5.1f}%")
        
    print("-" * 105)
    
    # 輸出保存成果
    out_file = "/Users/huanggin-chen/openclaw_test/causal_forest_titan_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            'timestamp': pd.Timestamp.now().isoformat(),
            'experiments': {k: {m: v for m, v in val.items() if m != 'monthly_returns'} for k, val in results.items()}
        }, f, indent=2, ensure_ascii=False)
        
    print(f"因果推論升維成果已成功寫入: {out_file}")

if __name__ == '__main__':
    main()
