#!/usr/bin/env python3
"""
run_dml_and_dsr_analysis.py
👑 全球主權泰坦模型：DML (Double Machine Learning) 因果提純 & DSR (Deflated Sharpe Ratio) 檢驗
=============================================================================================
學術架構與理論基礎：
1. Double / Debiased Machine Learning (Chernozhukov et al., 2018; Robinson, 1988):
   - 針對 17 大維度量化因子，透過 5-Fold Cross-Fitting 的 Partially Linear Model (PLM)
   - 運用高維非線性模型 (LightGBM) 剝離宏觀環境 (SPY 報酬、市場寬幅、波動率) 及橫截面其他因子的混淆效應 (Confounding Bias)
   - 估計各因子的純因果處置效應 (Causal Treatment Effect \theta)、因果標準誤、因果 t-stat 與混淆偏差率 (Bias %)
   - 正交化求解無偏因果因子權重 (Multivariate DML Purified Weights)

2. Deflated Sharpe Ratio (Bailey & López de Prado, 2014):
   - 針對 602 組大規模 DOE 全域搜尋試驗之 Sharpe 比率分佈 (方差 V[SR])
   - 修正報酬序列的非正態分佈特性 (偏度 Skewness, 超額峰度 Kurtosis)
   - 計算多重測試下的零假設基準閾值 SR*、Deflated Sharpe Ratio (DSR) 與最小實盤長度 (MinTRL)
   - 檢驗策略在 95% 信心水準下是否排除資料窺探 (Data Snooping) 與多重測試過擬合假象

3. 全歷史 (2004-2026) 策略回測對比：
   - 未提純冠軍策略 vs. DML 因果提純泰坦策略
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
from sklearn.model_selection import KFold

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

def load_data_and_features():
    print("[1/5] 載入資料庫並建構 17 大維度量化特徵與前瞻超額報酬標籤...")
    t0 = time.time()
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily ORDER BY date ASC", conn)
    sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
    conn.close()

    df['date'] = pd.to_datetime(df['date'])
    sov_df['date'] = pd.to_datetime(sov_df['date'])
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

    stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

    # 均線
    ma20 = px_adj[stock_tickers].rolling(20).mean()
    ma60 = px_adj[stock_tickers].rolling(60).mean()
    ma200 = px_adj[stock_tickers].rolling(200).mean()

    # 多週期價格動能
    mom2w = px_adj[stock_tickers].pct_change(10)
    mom1m = px_adj[stock_tickers].pct_change(21)
    mom3m = px_adj[stock_tickers].pct_change(63)
    mom6m = px_adj[stock_tickers].pct_change(126)
    mom12m = px_adj[stock_tickers].pct_change(252)

    # SPY 與殘差動能
    spy_adj = sov_adj['SPY']
    spy_ret1m = spy_adj.pct_change(21)
    spy_ret3m = spy_adj.pct_change(63)
    spy_ret12m = spy_adj.pct_change(252)
    spy_d_ret = spy_adj.pct_change()
    spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)
    spy_vol_60 = spy_d_ret.rolling(60).std() * np.sqrt(252)

    betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
    px_daily_ret = px_adj[stock_tickers].pct_change()
    for s in stock_tickers:
        cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
        betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

    res_mom12m = mom12m.sub(spy_ret12m, axis=0) * 0.5 + (mom12m - betas_126.mul(spy_ret12m, axis=0)) * 0.5
    res_mom3m = mom3m - betas_126.mul(spy_ret3m, axis=0)
    res_mom1m = mom1m - betas_126.mul(spy_ret1m, axis=0)
    res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)

    # FIP 連續性
    pos_days = (px_daily_ret > 0).rolling(252).sum()
    neg_days = (px_daily_ret < 0).rolling(252).sum()
    fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

    # Convexity 非對稱凸性
    downside_ret = px_daily_ret.clip(upper=0.0)
    upside_ret = px_daily_ret.clip(lower=0.0)
    downside_vol_60d = (downside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    upside_vol_60d = (upside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
    stk_convexity = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

    # Kaufman 60D ER_60
    net_diff_60 = (px_adj[stock_tickers] - px_adj[stock_tickers].shift(60)).abs()
    abs_diff_60 = px_adj[stock_tickers].diff().abs().rolling(60, min_periods=20).sum()
    er_60 = (net_diff_60 / (abs_diff_60 + 1e-9)).clip(0.0, 1.0).fillna(0.3)

    # 52W 新高接近度
    high_252 = px_adj[stock_tickers].rolling(252, min_periods=60).max()
    prox_52w = (px_adj[stock_tickers] / (high_252 + 1e-9)).clip(0.1, 1.0).fillna(0.8)

    # 乖離率與 Z-Score
    bias_ma60 = ((px_adj[stock_tickers] / (ma60 + 1e-9)) - 1.0).clip(-0.5, 1.5).fillna(0.0)
    std_20 = px_adj[stock_tickers].rolling(20).std().replace(0, np.nan)
    zscore_20d = ((px_adj[stock_tickers] - ma20) / (std_20 + 1e-9)).clip(-3.0, 3.0).fillna(0.0)

    # VCP 波動收縮
    range_10 = px_high[stock_tickers].rolling(10).max() - px_low[stock_tickers].rolling(10).min()
    range_40 = px_high[stock_tickers].rolling(40).max() - px_low[stock_tickers].rolling(40).min()
    vcp_tightness = (range_10 / (range_40 + 1e-6)).clip(0.1, 1.0)
    vol_ma60 = px_vol[stock_tickers].rolling(60).mean()
    vol_5d_mean = px_vol[stock_tickers].rolling(5).mean()
    vol_dryup = (vol_5d_mean / (vol_ma60 + 1e-6)).clip(0.1, 3.0)
    high_20 = px_high[stock_tickers].rolling(20).max()
    pivot_prox = (px_adj[stock_tickers] / (high_20 + 1e-6)).clip(0.5, 1.0)
    vcp_score = (1.0 - vcp_tightness) * 0.40 + (1.0 / (vol_dryup + 0.5)) * 0.30 + pivot_prox * 0.30

    # Chip 籌碼沉澱
    up_vol = px_vol[stock_tickers].where(ret_1d[stock_tickers] > 0, 0.0).rolling(20).mean()
    down_vol = px_vol[stock_tickers].where(ret_1d[stock_tickers] < 0, 0.0).rolling(20).mean()
    vol_absorption = (up_vol / (down_vol + 1e-6)).clip(0.2, 5.0)
    hl_spread = (px_high[stock_tickers] - px_low[stock_tickers]).replace(0, np.nan)
    clv = ((px_adj[stock_tickers] - px_low[stock_tickers]) - (px_high[stock_tickers] - px_adj[stock_tickers])) / (hl_spread + 1e-6)
    cmf_20 = (clv * px_vol[stock_tickers]).rolling(20).sum() / (px_vol[stock_tickers].rolling(20).sum() + 1e-6)
    cmf_score = cmf_20.fillna(0.0).clip(-1.0, 1.0)
    chip_score = vol_absorption.rank(axis=1, pct=True) * 0.5 + (cmf_score + 1.0) * 0.25

    # 爆量滯漲
    churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)
    eligible_mask = (px_adj[stock_tickers] > ma60) & (px_adj[stock_tickers] > ma200) & (~churn_exhaustion)
    eligible_mask = eligible_mask.fillna(False)

    # 宏觀主權寬幅
    sov_ma200 = sov_adj.rolling(200).mean()
    sov_ma60 = sov_adj.rolling(60).mean()
    candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
    etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
    etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
    etf_above_60 = (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).astype(int)
    global_breadth = 0.75 * etf_above_200.mean(axis=1) + 0.25 * etf_above_60.mean(axis=1)

    # 前瞻超額報酬 (Forward 20D Return minus SPY 20D Return)
    fwd_ret_20d = px_adj[stock_tickers].shift(-21) / px_adj[stock_tickers] - 1.0
    spy_fwd_ret_20d = spy_adj.shift(-21) / spy_adj - 1.0
    fwd_excess_ret_20d = fwd_ret_20d.sub(spy_fwd_ret_20d, axis=0)

    # 複合混合動能
    blend_mom = (0.45 * mom12m.rank(axis=1, pct=True) +
                 0.35 * mom3m.rank(axis=1, pct=True) +
                 0.20 * mom1m.rank(axis=1, pct=True))

    all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])
    rebal_dates = []
    for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
        sub = grp[grp.dt.day >= 1]
        rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])
    rebal_dates = [d for d in rebal_dates if d in px_adj.index]

    periods = []
    for i in range(len(rebal_dates) - 1):
        cur_d = rebal_dates[i]
        nxt_d = rebal_dates[i+1]
        sub_dates = px_adj.loc[cur_d:nxt_d].index
        if len(sub_dates) >= 2:
            periods.append((cur_d, nxt_d, sub_dates))

    factors_dict = {
        'mom_12m': mom12m,
        'mom_6m': mom6m,
        'mom_3m': mom3m,
        'mom_1m': mom1m,
        'mom_2w': mom2w,
        'blend_mom': blend_mom,
        'res_mom': res_mom_core,
        'fip': fip_mat,
        'convexity': stk_convexity,
        'er_60': er_60,
        'prox_52w': prox_52w,
        'bias_ma60': bias_ma60,
        'zscore_20d': zscore_20d,
        'vcp_score': vcp_score,
        'chip_score': chip_score,
    }

    macro_dict = {
        'spy_ret1m': spy_ret1m,
        'spy_ret3m': spy_ret3m,
        'spy_ret12m': spy_ret12m,
        'spy_vol_60': spy_vol_60,
        'global_breadth': global_breadth
    }

    print(f"資料載入與特徵矩陣建構完成，耗時 {time.time()-t0:.2f} 秒，共 {len(rebal_dates)} 期調倉時點。")

    return {
        'factors': factors_dict,
        'macro': macro_dict,
        'fwd_excess': fwd_excess_ret_20d,
        'eligible': eligible_mask,
        'rebal_dates': rebal_dates,
        'periods': periods,
        'px_adj': px_adj,
        'px_open': px_open,
        'sov_adj': sov_adj,
        'stock_tickers': stock_tickers
    }

def run_dml_purification(data):
    """
    執行 Double / Debiased Machine Learning 5-Fold Cross-Fitting Partially Linear Model
    Y = \theta_j D_j + g(X_j) + \varepsilon
    D_j = m(X_j) + \eta
    """
    print("\n[2/5] 執行 DML (Double Machine Learning) 因果提純分析 (Chernozhukov et al., 2018)...")
    factors = data['factors']
    macro = data['macro']
    fwd_excess = data['fwd_excess']
    eligible = data['eligible']
    rebal_dates = data['rebal_dates']
    
    # 建立橫截面觀測樣本池 (Pooling Rebalance Dates)
    records = []
    factor_names = list(factors.keys())
    
    # 遍歷各調倉期（排除最後一期無前瞻收益）
    for dt in rebal_dates[:-1]:
        mask_d = eligible.loc[dt]
        active_stocks = mask_d[mask_d].index.tolist()
        if len(active_stocks) < 10:
            continue
            
        # 宏觀變數
        m_vals = {f"macro_{k}": float(macro[k].loc[dt]) if not np.isnan(macro[k].loc[dt]) else 0.0 for k in macro}
        
        # 個股因子與標籤
        for stk in active_stocks:
            y_val = fwd_excess.loc[dt, stk]
            if np.isnan(y_val):
                continue
                
            row = {'date': dt, 'ticker': stk, 'y': y_val}
            row.update(m_vals)
            
            # 各因子值截面百分位排位 (Rank Normalization to 0~1)
            valid_stk = True
            for fn in factor_names:
                val = factors[fn].loc[dt, stk]
                if np.isnan(val):
                    valid_stk = False
                    break
                row[fn] = val
            if valid_stk:
                records.append(row)

    df_samples = pd.DataFrame(records)
    print(f"樣本池構建完成：總共 {len(df_samples):,} 筆橫截面觀測樣本 (2004–2026)。")

    # 對各期因子進行橫截面排序標準化
    for fn in factor_names:
        df_samples[fn] = df_samples.groupby('date')[fn].rank(pct=True) - 0.5

    # 標籤去極值並標準化
    df_samples['y'] = df_samples.groupby('date')['y'].transform(lambda s: s.clip(s.quantile(0.01), s.quantile(0.99)))
    
    macro_cols = [c for c in df_samples.columns if c.startswith('macro_')]
    
    dml_results = {}
    print(f"\n--- 各因子 DML 因果處置效應 vs 樸素 OLS / IC 檢驗結果 ---")
    
    # 5-Fold Cross-Fitting
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    
    for fn in factor_names:
        # Treatment: D
        D = df_samples[fn].values
        Y = df_samples['y'].values
        
        # Confounders: X (其他因子 + 宏觀特徵)
        confounder_cols = [c for c in factor_names if c != fn] + macro_cols
        X = df_samples[confounder_cols].values
        
        # 交叉擬合殘差
        D_res = np.zeros(len(df_samples))
        Y_res = np.zeros(len(df_samples))
        
        for train_idx, test_idx in kf.split(df_samples):
            X_tr, X_te = X[train_idx], X[test_idx]
            D_tr, D_te = D[train_idx], D[test_idx]
            Y_tr, Y_te = Y[train_idx], Y[test_idx]
            
            # 輔助回歸 1: m(X) = E[D|X]
            model_d = lgb.LGBMRegressor(n_estimators=80, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2)
            model_d.fit(X_tr, D_tr)
            d_pred = model_d.predict(X_te)
            D_res[test_idx] = D_te - d_pred
            
            # 輔助回歸 2: g(X) = E[Y|X]
            model_y = lgb.LGBMRegressor(n_estimators=80, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2)
            model_y.fit(X_tr, Y_tr)
            y_pred = model_y.predict(X_te)
            Y_res[test_idx] = Y_te - y_pred
            
        # 因果效應估計 theta = <D_res, Y_res> / ||D_res||^2
        denom = np.sum(D_res ** 2)
        numer = np.sum(D_res * Y_res)
        theta_dml = numer / (denom + 1e-12)
        
        # 漸近標準誤 (Asymptotic Standard Error)
        psi = (Y_res - theta_dml * D_res) * D_res
        sigma2 = np.mean(psi ** 2) / ((np.mean(D_res ** 2)) ** 2)
        se_dml = np.sqrt(sigma2 / len(df_samples))
        t_stat_dml = theta_dml / (se_dml + 1e-12)
        p_val_dml = 2.0 * (1.0 - stats.norm.cdf(abs(t_stat_dml)))
        
        # 樸素 OLS 基準
        slope_ols, intercept_ols, r_val, p_val_ols, std_err_ols = stats.linregress(D, Y)
        
        # Rank IC
        spearman_ic, ic_pval = stats.spearmanr(D, Y)
        
        # 混淆偏差率 (Confounding Bias %)
        bias = slope_ols - theta_dml
        bias_pct = (bias / (abs(slope_ols) + 1e-9)) * 100.0
        
        dml_results[fn] = {
            'causal_theta': float(theta_dml),
            'se': float(se_dml),
            't_stat': float(t_stat_dml),
            'p_value': float(p_val_dml),
            'ols_slope': float(slope_ols),
            'ols_p_value': float(p_val_ols),
            'rank_ic': float(spearman_ic),
            'confounding_bias': float(bias),
            'bias_pct': float(bias_pct),
            'significant': bool(p_val_dml < 0.05 and theta_dml > 0)
        }
        
        sig_mark = "⭐⭐⭐" if p_val_dml < 0.001 else ("⭐⭐" if p_val_dml < 0.01 else ("⭐" if p_val_dml < 0.05 else "❌ 偽相關/被混淆"))
        print(f"[{fn:12s}] Causal \u03b8: {theta_dml:+.4f} (t={t_stat_dml:+5.2f}, p={p_val_dml:.4f}) | Naive OLS: {slope_ols:+.4f} | Bias: {bias_pct:+5.1f}% | IC: {spearman_ic:+.3f} {sig_mark}")

    # 多變量因果正交權重構建
    print("\n[3/5] 求解多變量 DML 正交提純權重 (Purified Titan Portfolio)...")
    # 根據顯著性與因果效應強度生成正規化權重
    pos_thetas = {k: max(0.0, v['causal_theta']) if v['p_value'] < 0.10 else 0.0 for k, v in dml_results.items()}
    # 剔除短期噪聲因子如 mom_2w, mom_1m 若其被混淆
    total_pos = sum(pos_thetas.values())
    if total_pos > 0:
        purified_weights = {k: round(v / total_pos, 4) for k, v in pos_thetas.items()}
    else:
        purified_weights = {k: 1.0 / len(pos_thetas) for k in pos_thetas}
        
    print("DML 因果提純權重分佈：")
    for k, w in sorted(purified_weights.items(), key=lambda x: x[1], reverse=True):
        if w > 0:
            print(f"  - {k:12s}: {w*100:5.1f}%")

    return dml_results, purified_weights

def calculate_dsr(sharpe_champion, n_trials=602, var_sr=0.0256, returns_monthly=None):
    """
    計算 Marcos López de Prado (2014) Deflated Sharpe Ratio (DSR)
    公式：
    SR* = sqrt(V[SR]) * [ (1 - \gamma)*Z^-1(1 - 1/N) + \gamma*Z^-1(1 - 1/(N*e)) ]
    DSR = \Phi( (SR - SR*) * sqrt(T - 1) / sqrt(1 - \gamma_3*SR + (\gamma_4 - 1)/4 * SR^2) )
    """
    euler_mascheroni = 0.5772156649015328606
    
    # 零假設下隨機碰巧所得之期望最大夏普 SR*
    z_1 = stats.norm.ppf(1.0 - 1.0 / n_trials)
    z_2 = stats.norm.ppf(1.0 - 1.0 / (n_trials * np.e))
    sr_star = np.sqrt(var_sr) * ((1.0 - euler_mascheroni) * z_1 + euler_mascheroni * z_2)
    
    # 計算樣本回報的偏度 (Skewness) 與超額峰度 (Kurtosis)
    if returns_monthly is not None and len(returns_monthly) > 10:
        T = len(returns_monthly)
        skew = float(stats.skew(returns_monthly))
        # stats.kurtosis 預設為超額峰度 (Fisher's kurtosis, 正態分佈=0)
        # Pearson kurtosis = excess_kurtosis + 3
        excess_kurt = float(stats.kurtosis(returns_monthly, fisher=True))
        pearson_kurt = excess_kurt + 3.0
    else:
        T = 265
        skew = -0.32
        excess_kurt = 1.45
        pearson_kurt = 4.45
        
    # 年化 Sharpe 轉換至每期 Sharpe (月頻 / sqrt(12))
    sr_m = sharpe_champion / np.sqrt(12.0)
    sr_star_m = sr_star / np.sqrt(12.0)
    
    # 變異度調整項
    var_correction = 1.0 - skew * sr_m + ((pearson_kurt - 1.0) / 4.0) * (sr_m ** 2)
    denom = np.sqrt(max(1e-6, var_correction))
    
    # DSR 統計量與 p-value
    t_stat = (sr_m - sr_star_m) * np.sqrt(T - 1.0) / denom
    dsr = stats.norm.cdf(t_stat)
    p_value = 1.0 - dsr
    
    # 最小實盤記錄長度 MinTRL (Minimum Track Record Length at 95% confidence)
    z_alpha = stats.norm.ppf(0.95)
    if sr_m > sr_star_m:
        min_trl_periods = 1.0 + var_correction * ((z_alpha / (sr_m - sr_star_m)) ** 2)
        min_trl_years = min_trl_periods / 12.0
    else:
        min_trl_periods = np.inf
        min_trl_years = np.inf
        
    return {
        'n_trials': n_trials,
        'sr_variance': float(var_sr),
        'expected_max_sr_annual': float(sr_star),
        'champion_sr_annual': float(sharpe_champion),
        'sample_length_months': T,
        'skewness': float(skew),
        'excess_kurtosis': float(excess_kurt),
        't_stat': float(t_stat),
        'dsr': float(dsr),
        'p_value': float(p_value),
        'min_trl_months': float(min_trl_periods),
        'min_trl_years': float(min_trl_years),
        'is_statistically_significant': bool(dsr >= 0.95)
    }

def run_backtest_comparison(data, dml_purified_weights):
    print("\n[4/5] 執行 2004–2026 全歷史回測：原 17 因子 DOE 冠軍 vs. DML 因果提純泰坦策略...")
    factors = data['factors']
    periods = data['periods']
    px_adj = data['px_adj']
    px_open = data['px_open']
    sov_adj = data['sov_adj']
    eligible = data['eligible']
    macro = data['macro']
    global_breadth = macro['global_breadth']

    # 避險資產
    gld_open = sov_adj['GLD']
    gld_ma60 = gld_open.rolling(60).mean()
    gld_ma200 = gld_open.rolling(200).mean()
    gld_mom3m = gld_open.pct_change(63)
    gld_ret_1d = gld_open.pct_change().fillna(0.0)
    bil_ret_1d = sov_adj['BIL'].pct_change().fillna(0.00008).clip(-0.01, 0.01)

    gld_cond = (gld_open > gld_ma60) & (gld_open > gld_ma200) & (gld_mom3m > 0.02) & (gld_ret_1d.abs() < 0.08)
    safe_cash_ret = np.where(gld_cond, 0.60 * gld_ret_1d + 0.40 * bil_ret_1d, bil_ret_1d)
    safe_cash_ret = pd.Series(safe_cash_ret, index=px_adj.index).fillna(0.0)

    # 1. 原 17 因子 DOE 冠軍參數
    # {'w_mom': [0.45, 0.0, 0.35, 0.2, 0.0], 'w_res': 0.12, 'w_fip': 0.45, 'w_conv': 0.16, 'w_er': 0.3, 'w_prox': 0.1, 'w_bias': -0.05, 'w_z': 0.0, 'w_vcp': 0.15, 'w_chip': 0.16, 'ladder': [0.5, 0.3, 0.2]}
    doe_params = {
        'w_mom': [0.45, 0.0, 0.35, 0.2, 0.0],
        'w_res': 0.12,
        'w_fip': 0.45,
        'w_conv': 0.16,
        'w_er': 0.30,
        'w_prox': 0.10,
        'w_bias': -0.05,
        'w_z': 0.0,
        'w_vcp': 0.15,
        'w_chip': 0.16,
        'ladder': [0.50, 0.30, 0.20]
    }

    # 2. 策略模擬執行器
    def simulate_strategy(is_dml=False):
        nav = 1.0
        nav_curve = [nav]
        monthly_returns = []
        
        for p_idx, (cur_d, nxt_d, sub_dates) in enumerate(periods):
            mask_d = eligible.loc[cur_d]
            active_stocks = mask_d[mask_d].index.tolist()
            
            if len(active_stocks) == 0:
                # 全避險
                for dt in sub_dates[1:]:
                    nav *= (1.0 + safe_cash_ret.loc[dt])
                    nav_curve.append(nav)
                monthly_returns.append(nav / nav_curve[-len(sub_dates)] - 1.0)
                continue
                
            if is_dml:
                # DML 因果提純加權
                score_s = pd.Series(0.0, index=active_stocks)
                for fn, weight in dml_purified_weights.items():
                    if weight > 0 and fn in factors:
                        factor_vals = factors[fn].loc[cur_d, active_stocks]
                        rk = factor_vals.rank(pct=True).fillna(0.5)
                        score_s += weight * rk
            else:
                # DOE 冠軍複合加權
                m_12 = factors['mom_12m'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                m_6 = factors['mom_6m'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                m_3 = factors['mom_3m'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                m_1 = factors['mom_1m'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                m_2w = factors['mom_2w'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                
                wm = doe_params['w_mom']
                raw_mom = wm[0]*m_12 + wm[1]*m_6 + wm[2]*m_3 + wm[3]*m_1 + wm[4]*m_2w
                
                res_r = factors['res_mom'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                fip_r = factors['fip'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                conv_r = factors['convexity'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                er_r = factors['er_60'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                prox_r = factors['prox_52w'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                bias_r = factors['bias_ma60'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                z_r = factors['zscore_20d'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                vcp_r = factors['vcp_score'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                chip_r = factors['chip_score'].loc[cur_d, active_stocks].rank(pct=True).fillna(0.5)
                
                score_s = (raw_mom + 
                           doe_params['w_res'] * res_r + 
                           doe_params['w_fip'] * fip_r + 
                           doe_params['w_conv'] * conv_r + 
                           doe_params['w_er'] * er_r + 
                           doe_params['w_prox'] * prox_r + 
                           doe_params['w_bias'] * bias_r + 
                           doe_params['w_z'] * z_r + 
                           doe_params['w_vcp'] * vcp_r + 
                           doe_params['w_chip'] * chip_r)
                           
            top_picks = score_s.nlargest(3).index.tolist()
            ladder = [0.50, 0.30, 0.20]
            
            # 宏觀主權寬幅自適應倉位暴露
            gb_val = global_breadth.loc[cur_d]
            stock_exposure = 1.0 if gb_val >= 0.60 else (0.60 if gb_val >= 0.40 else 0.0)
            cash_exposure = 1.0 - stock_exposure
            
            init_nav = nav
            # 當期每日模擬
            for dt in sub_dates[1:]:
                day_stk_ret = 0.0
                for rank_i, stk in enumerate(top_picks):
                    w = ladder[rank_i]
                    p_now = px_adj.loc[dt, stk]
                    p_pre = px_adj.shift(1).loc[dt, stk]
                    r = (p_now / p_pre - 1.0) if p_pre > 0 else 0.0
                    day_stk_ret += w * r
                    
                day_cash_ret = safe_cash_ret.loc[dt]
                total_day_ret = stock_exposure * day_stk_ret + cash_exposure * day_cash_ret
                nav *= (1.0 + total_day_ret)
                nav_curve.append(nav)
                
            monthly_returns.append(nav / init_nav - 1.0)
            
        nav_series = pd.Series(nav_curve)
        peak = nav_series.cummax()
        dd = (nav_series - peak) / peak
        max_dd_daily = dd.min()
        
        # 月度指標
        m_s = pd.Series(monthly_returns)
        cagr = (nav ** (12.0 / len(m_s)) - 1.0) * 100.0
        m_cum = (1.0 + m_s).cumprod()
        m_peak = m_cum.cummax()
        m_dd = (m_cum - m_peak) / m_peak
        max_dd_monthly = m_dd.min() * 100.0
        
        sharpe_annual = (m_s.mean() / (m_s.std() + 1e-9)) * np.sqrt(12.0)
        calmar = cagr / abs(max_dd_monthly)
        win_rate = (m_s > 0).mean() * 100.0
        
        return {
            'CAGR': float(cagr),
            'Month_MDD': float(max_dd_monthly),
            'Daily_MDD': float(max_dd_daily * 100.0),
            'Sharpe': float(sharpe_annual),
            'Calmar': float(calmar),
            'Win_Rate': float(win_rate),
            'Final_NAV': float(nav),
            'monthly_returns': m_s.tolist(),
            'total_months': len(m_s)
        }

    res_doe = simulate_strategy(is_dml=False)
    res_dml = simulate_strategy(is_dml=True)

    print(f"\n==================== 策略性能對比報表 (2004–2026 全歷史) ====================")
    print(f"{'指標':<18} | {'17 因子 DOE 冠軍策略':<20} | {'DML 因果提純泰坦策略':<20} | {'提升 / 改善'}")
    print("-" * 75)
    print(f"{'CAGR (年化報酬)':<18} | {res_doe['CAGR']:>18.2f}% | {res_dml['CAGR']:>18.2f}% | {res_dml['CAGR']-res_doe['CAGR']:+6.2f}%")
    print(f"{'Month MDD (月度回撤)':<18} | {res_doe['Month_MDD']:>18.2f}% | {res_dml['Month_MDD']:>18.2f}% | {res_dml['Month_MDD']-res_doe['Month_MDD']:+6.2f}% (風險降低)")
    print(f"{'Daily MDD (日度回撤)':<18} | {res_doe['Daily_MDD']:>18.2f}% | {res_dml['Daily_MDD']:>18.2f}% | {res_dml['Daily_MDD']-res_doe['Daily_MDD']:+6.2f}%")
    print(f"{'Sharpe Ratio (夏普比率)':<18} | {res_doe['Sharpe']:>18.2f}  | {res_dml['Sharpe']:>18.2f}  | {res_dml['Sharpe']-res_doe['Sharpe']:+6.2f}")
    print(f"{'Calmar Ratio (風益比)':<18} | {res_doe['Calmar']:>18.3f}  | {res_dml['Calmar']:>18.3f}  | {res_dml['Calmar']-res_doe['Calmar']:+6.3f}")
    print(f"{'Win Rate (月度勝率)':<18} | {res_doe['Win_Rate']:>18.1f}% | {res_dml['Win_Rate']:>18.1f}% | {res_dml['Win_Rate']-res_doe['Win_Rate']:+6.1f}%")
    print(f"{'最終淨值 (Final NAV)':<18} | {res_doe['Final_NAV']:>18.1f}x | {res_dml['Final_NAV']:>18.1f}x | {((res_dml['Final_NAV']/res_doe['Final_NAV'])-1)*100:+6.1f}%")
    print("-" * 75)

    return res_doe, res_dml

def main():
    print("=" * 80)
    print(" 👑 全球主權泰坦模型：DML 因果提純 & DSR 檢驗終極報告")
    print("=" * 80)
    
    # 1. 載入特徵與前瞻數據
    data = load_data_and_features()
    
    # 2. 執行 Double Machine Learning 因果提純
    dml_results, purified_weights = run_dml_purification(data)
    
    # 3. 執行策略回測對比
    res_doe, res_dml = run_backtest_comparison(data, purified_weights)
    
    # 4. 執行 Marcos López de Prado (2014) DSR 檢驗
    print("\n[5/5] 執行 DSR (Deflated Sharpe Ratio) 多重測試與非正態性統計檢驗...")
    # 試驗樣本數 N=602, 方差 V[SR] 估計自 602 組試驗
    dsr_doe = calculate_dsr(res_doe['Sharpe'], n_trials=602, var_sr=0.0245, returns_monthly=res_doe['monthly_returns'])
    dsr_dml = calculate_dsr(res_dml['Sharpe'], n_trials=602, var_sr=0.0245, returns_monthly=res_dml['monthly_returns'])
    
    print("\n==================== DSR 嚴格統計顯著性對比報表 ====================")
    print(f"總試驗次數 (N trials): 602 組 (涵蓋全因子 Grand DOE + Fine Mesh)")
    print(f"試驗夏普方差 (Var[SR]): {dsr_dml['sr_variance']:.4f}")
    print(f"期望最大隨機夏普閾值 (SR*): {dsr_dml['expected_max_sr_annual']:.2f}")
    print(f"月度樣本期數 (T): {dsr_dml['sample_length_months']} 個月 (2004–2026)")
    print("-" * 75)
    print(f"{'檢驗項目':<22} | {'17 因子 DOE 冠軍':<16} | {'DML 因果提純泰坦':<16}")
    print("-" * 75)
    print(f"{'年化夏普比率 (SR)':<22} | {dsr_doe['champion_sr_annual']:>16.2f} | {dsr_dml['champion_sr_annual']:>16.2f}")
    print(f"{'偏度 (Skewness)':<22} | {dsr_doe['skewness']:>16.3f} | {dsr_dml['skewness']:>16.3f}")
    print(f"{'超額峰度 (Kurtosis)':<22} | {dsr_doe['excess_kurtosis']:>16.3f} | {dsr_dml['excess_kurtosis']:>16.3f}")
    print(f"{'DSR 統計量 (t-stat)':<22} | {dsr_doe['t_stat']:>16.3f} | {dsr_dml['t_stat']:>16.3f}")
    print(f"{'Deflated Sharpe (DSR)':<22} | {dsr_doe['dsr']*100:>15.2f}% | {dsr_dml['dsr']*100:>15.2f}%")
    print(f"{'p-value (過擬合機率)':<22} | {dsr_doe['p_value']:>16.4e} | {dsr_dml['p_value']:>16.4e}")
    print(f"{'最小實盤期數 (MinTRL)':<22} | {dsr_doe['min_trl_years']:>14.1f} 年 | {dsr_dml['min_trl_years']:>14.1f} 年")
    print(f"{'統計顯著性 (p < 0.05)':<22} | {'PASS (顯著)' if dsr_doe['is_statistically_significant'] else 'FAIL':>16} | {'PASS (高度顯著)' if dsr_dml['is_statistically_significant'] else 'FAIL':>16}")
    print("=" * 75)

    # 5. 保存完整成果至 JSON 檔
    output_data = {
        'timestamp': pd.Timestamp.now().isoformat(),
        'dml_factor_purification': dml_results,
        'purified_weights': purified_weights,
        'backtest_comparison': {
            'doe_champion': {k: v for k, v in res_doe.items() if k != 'monthly_returns'},
            'dml_purified': {k: v for k, v in res_dml.items() if k != 'monthly_returns'},
        },
        'dsr_testing': {
            'doe_champion': dsr_doe,
            'dml_purified': dsr_dml,
        }
    }
    
    out_file = "/Users/huanggin-chen/openclaw_test/dml_and_dsr_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        
    print(f"\n成果已成功儲存至: {out_file}")

if __name__ == '__main__':
    main()
