#!/usr/bin/env python3
"""
test_new_factor_dimensions.py
👑 全球主權泰坦模型：五大前沿正交維度新因子 探索與實證
=============================================================================
五大全新維度候選因子：
1. parkinson_squeeze: 日內最高最低 Parkinson 波動率極致壓縮比
2. price_vol_corr: 20日價量正向共振相關係數 (Campbell et al., 1993 QJE)
3. gap_quality: 開盤跳空質量比 (真突破 vs 衰竭跳空判定)
4. rs_blue_sky: CANSLIM 相對強度曲線創新高突破 (RS Line Breakout)
5. bollinger_squeeze: 布林帶寬度極致壓縮向上開口點火因子

完整流程：
- 2004–2026 全歷史 150 檔全球/台股龍頭標的
- DML 因果處置效應提純 (Chernozhukov et al., 2018)
- 雙滾動 Cohort 旗艦引擎全歷史回測對比
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

def load_data_and_new_dimensions():
    print("[1/4] 載入資料庫並計算五大前沿新維度量化因子...")
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

    # 基準動能
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

    # =========================================================================
    # 🌟 五大全新正交維度新因子
    # =========================================================================

    # 1. parkinson_squeeze: Parkinson (1980) 日內最高最低波動率極致壓縮比
    # ln(High / Low)^2 / (4 * ln 2)
    hl_ratio = (px_high / (px_low + 1e-6)).clip(lower=1.0)
    parkinson_vol_5d = np.sqrt(((np.log(hl_ratio) ** 2) / (4.0 * np.log(2.0))).rolling(5).mean())
    close_vol_20d = px_daily_ret.rolling(20).std().replace(0, np.nan)
    parkinson_squeeze = (close_vol_20d / (parkinson_vol_5d + 1e-6)).clip(0.1, 10.0)
    parkinson_norm = parkinson_squeeze.rank(axis=1, pct=True).fillna(0.5)

    # 2. price_vol_corr: 20日價量滾動相關係數 (Campbell et al., 1993)
    # 價漲量增、價跌量縮為正相關健康上攻
    vol_change = px_vol.pct_change(fill_method=None).clip(-0.5, 3.0)
    price_change = ret_1d.clip(-0.2, 0.2)
    pvc_20d = price_change.rolling(20).corr(vol_change).fillna(0.0).clip(-1.0, 1.0)
    pvc_norm = pvc_20d.rank(axis=1, pct=True).fillna(0.5)

    # 3. gap_quality: 開盤跳空質量比 (Lou et al., 2019)
    # (Close - Open) / (|Open - PreClose| + eps)
    overnight_jump = (px_open - px_adj.shift(1)).abs()
    intraday_run = px_adj - px_open
    gap_quality = (intraday_run / (overnight_jump + 1e-6)).clip(-5.0, 5.0)
    gap_quality_20d = gap_quality.rolling(20).mean().fillna(0.0)
    gap_norm = gap_quality_20d.rank(axis=1, pct=True).fillna(0.5)

    # 4. rs_blue_sky: CANSLIM 相對強度曲線創新高突破 (O'Neil RS Line Breakout)
    # RS Line = Stock / SPY; 接近 252 日新高比例
    rs_line = px_adj.div(spy_adj, axis=0)
    rs_high_252 = rs_line.rolling(252, min_periods=60).max()
    rs_blue_sky = (rs_line / (rs_high_252 + 1e-9)).clip(0.1, 1.0).fillna(0.8)
    rs_norm = rs_blue_sky.rank(axis=1, pct=True).fillna(0.5)

    # 5. bollinger_squeeze: 布林帶寬度極致壓縮向上開口點火因子 (John Bollinger)
    bb_upper = ma20 + 2.0 * std_20
    bb_lower = ma20 - 2.0 * std_20
    bb_width = (bb_upper - bb_lower) / (ma20 + 1e-6)
    # 帶寬壓縮度 (帶寬越窄越好) * %B 位置 (大於 0.5 且小於 1.2)
    pct_b = (px_adj - bb_lower) / (bb_upper - bb_lower + 1e-6)
    bb_squeeze_score = (1.0 / (bb_width + 1e-4)) * (pct_b.clip(0.5, 1.2) - 0.5)
    bb_norm = bb_squeeze_score.rank(axis=1, pct=True).fillna(0.5)

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

    fwd_ret_20d = px_adj.shift(-21) / px_adj - 1.0
    spy_fwd_ret_20d = spy_adj.shift(-21) / spy_adj - 1.0
    fwd_excess_ret_20d = fwd_ret_20d.sub(spy_fwd_ret_20d, axis=0)

    factors_dict = {
        'mom_12m': mom12m, 'mom_6m': mom6m, 'mom_3m': mom3m, 'mom_1m': mom1m, 'mom_2w': mom2w,
        'res_mom': res_mom_core, 'fip': fip_mat, 'convexity': stk_convexity,
        'er_60': er_60, 'prox_52w': prox_52w, 'bias_ma60': bias_ma60, 'zscore_20d': zscore_20d,
        'vcp_norm': vcp_norm, 'chip_norm': chip_norm,
        'parkinson_norm': parkinson_norm,
        'pvc_norm': pvc_norm,
        'gap_norm': gap_norm,
        'rs_norm': rs_norm,
        'bb_norm': bb_norm
    }

    macro_dict = {
        'spy_ret1m': spy_ret1m, 'spy_ret3m': spy_ret3m, 'spy_ret12m': spy_ret12m,
        'spy_vol_60': spy_vol_60, 'global_breadth': global_breadth
    }

    print(f"資料載入與新維度特徵矩陣計算完成，耗時 {time.time()-t0:.2f} 秒。")

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

def run_dml_new_factors(data):
    print("\n[2/4] 執行五大前沿新維度因子的 DML 因果提純分析...")
    factors = data['factors']
    macro = data['macro']
    fwd_excess = data['fwd_excess']
    eligible = data['eligible']
    periods_a = data['periods_a']
    rebal_dates = [p[0] for p in periods_a]
    
    new_factor_keys = ['parkinson_norm', 'pvc_norm', 'gap_norm', 'rs_norm', 'bb_norm']
    all_factor_keys = list(factors.keys())
    
    records = []
    for dt in rebal_dates[:-1]:
        mask_d = eligible.loc[dt]
        active = mask_d[mask_d].index.tolist()
        if len(active) < 15:
            continue
            
        m_vals = {f"macro_{k}": float(macro[k].loc[dt]) if not np.isnan(macro[k].loc[dt]) else 0.0 for k in macro}
        
        for stk in active:
            y_val = fwd_excess.loc[dt, stk]
            if np.isnan(y_val):
                continue
                
            row = {'date': dt, 'ticker': stk, 'y': y_val}
            row.update(m_vals)
            
            valid_stk = True
            for fn in all_factor_keys:
                val = factors[fn].loc[dt, stk]
                if np.isnan(val):
                    valid_stk = False
                    break
                row[fn] = val
            if valid_stk:
                records.append(row)

    df_samples = pd.DataFrame(records)
    print(f"樣本池構建完成：共 {len(df_samples):,} 筆橫截面樣本。")

    for fn in all_factor_keys:
        df_samples[fn] = df_samples.groupby('date')[fn].rank(pct=True) - 0.5

    df_samples['y'] = df_samples.groupby('date')['y'].transform(lambda s: s.clip(s.quantile(0.01), s.quantile(0.99)))
    macro_cols = [c for c in df_samples.columns if c.startswith('macro_')]
    
    dml_results = {}
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    
    print(f"\n--- 五大前沿新維度因子 DML 因果處置效應 vs 樸素 OLS / IC ---")
    for fn in new_factor_keys:
        D = df_samples[fn].values
        Y = df_samples['y'].values
        confounder_cols = [c for c in all_factor_keys if c != fn] + macro_cols
        X = df_samples[confounder_cols].values
        
        D_res = np.zeros(len(df_samples))
        Y_res = np.zeros(len(df_samples))
        
        for train_idx, test_idx in kf.split(df_samples):
            X_tr, X_te = X[train_idx], X[test_idx]
            D_tr, D_te = D[train_idx], D[test_idx]
            Y_tr, Y_te = Y[train_idx], Y[test_idx]
            
            model_d = lgb.LGBMRegressor(n_estimators=70, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2)
            model_d.fit(X_tr, D_tr)
            D_res[test_idx] = D_te - model_d.predict(X_te)
            
            model_y = lgb.LGBMRegressor(n_estimators=70, max_depth=3, learning_rate=0.08, verbosity=-1, random_state=42, n_jobs=2)
            model_y.fit(X_tr, Y_tr)
            Y_res[test_idx] = Y_te - model_y.predict(X_te)
            
        denom = np.sum(D_res ** 2)
        numer = np.sum(D_res * Y_res)
        theta_dml = numer / (denom + 1e-12)
        
        psi = (Y_res - theta_dml * D_res) * D_res
        sigma2 = np.mean(psi ** 2) / ((np.mean(D_res ** 2)) ** 2)
        se_dml = np.sqrt(sigma2 / len(df_samples))
        t_stat_dml = theta_dml / (se_dml + 1e-12)
        p_val_dml = 2.0 * (1.0 - stats.norm.cdf(abs(t_stat_dml)))
        
        slope_ols, _, _, p_val_ols, _ = stats.linregress(D, Y)
        spearman_ic, _ = stats.spearmanr(D, Y)
        bias_pct = ((slope_ols - theta_dml) / (abs(slope_ols) + 1e-9)) * 100.0
        
        dml_results[fn] = {
            'causal_theta': float(theta_dml),
            't_stat': float(t_stat_dml),
            'p_value': float(p_val_dml),
            'ols_slope': float(slope_ols),
            'bias_pct': float(bias_pct),
            'rank_ic': float(spearman_ic)
        }
        sig = "⭐⭐⭐" if p_val_dml < 0.001 else ("⭐⭐" if p_val_dml < 0.01 else ("⭐" if p_val_dml < 0.05 else ("✨ 弱顯著" if p_val_dml < 0.10 else "❌ 偽相關")))
        print(f"[{fn:18s}] Causal \u03b8: {theta_dml:+.4f} (t={t_stat_dml:+5.2f}, p={p_val_dml:.4f}) | OLS: {slope_ols:+.4f} | Bias: {bias_pct:+5.1f}% | IC: {spearman_ic:+.3f} {sig}")

    return dml_results

def run_simulation(data, param):
    px_adj = data['px_adj']
    px_open = data['px_open']
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

    # 🌟 五大新維度因子乘數
    parkinson_mult = 1.0 + param.get('w_parkinson', 0.0) * (F['parkinson_norm'] - 0.5)
    pvc_mult = 1.0 + param.get('w_pvc', 0.0) * (F['pvc_norm'] - 0.5)
    gap_mult = 1.0 + param.get('w_gap', 0.0) * (F['gap_norm'] - 0.5)
    rs_mult = 1.0 + param.get('w_rs', 0.0) * (F['rs_norm'] - 0.5)
    bb_mult = 1.0 + param.get('w_bb', 0.0) * (F['bb_norm'] - 0.5)

    mom_matrix = (blend_mom * fip_mult * conv_mult * er_mult * prox_mult * vcp_mult * chip_mult * bias_mult * z_mult *
                  parkinson_mult * pvc_mult * gap_mult * rs_mult * bb_mult)
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
    print(" 👑 全球主權泰坦模型：五大前沿新維度因子 實證大搜索 (2004–2026 全歷史)")
    print("=" * 85)
    
    data = load_data_and_new_dimensions()
    dml_results = run_dml_new_factors(data)
    
    base_param = {
        'w_mom': (0.45, 0.0, 0.35, 0.2, 0.0),
        'w_res': 0.12, 'w_fip': 0.45, 'w_conv': 0.16, 'w_er': 0.3,
        'w_prox': 0.1, 'w_bias': -0.05, 'w_z': 0.0, 'w_vcp': 0.15, 'w_chip': 0.16,
        'ladder': [0.5, 0.3, 0.2]
    }
    
    ladder_enhanced = [0.55, 0.30, 0.15]
    
    trials = [
        ('1. 基準 17 因子冠軍模型 [0.50, 0.30, 0.20]', base_param),
        ('2. 龍頭傾斜冠軍模型 [0.55, 0.30, 0.15]', {**base_param, 'ladder': ladder_enhanced}),
        ('3. + Parkinson 波動極致壓縮 (0.12)', {**base_param, 'w_parkinson': 0.12}),
        ('4. + 價量正向共振相關 PVC (0.15)', {**base_param, 'w_pvc': 0.15}),
        ('5. + 跳空質量比率 Gap Quality (0.12)', {**base_param, 'w_gap': 0.12}),
        ('6. + CANSLIM 相對強度突破 RS (0.15)', {**base_param, 'w_rs': 0.15}),
        ('7. + 布林帶寬壓縮向上開口 BB (0.12)', {**base_param, 'w_bb': 0.12}),
        ('8. 複合共振: PVC (0.12) + RS 突破 (0.12)', {**base_param, 'w_pvc': 0.12, 'w_rs': 0.12}),
        ('9. 龍頭傾斜 [0.55] + PVC (0.12) + RS 突破 (0.12)', {**base_param, 'ladder': ladder_enhanced, 'w_pvc': 0.12, 'w_rs': 0.12})
    ]
    
    print("\n[3/4] 執行 2004–2026 全歷史雙滾動 Cohort 策略回測對比...")
    print(f"\n{'策略配置名稱':<50} | {'CAGR':<8} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'勝率'}")
    print("-" * 105)
    
    results = {}
    for name, p in trials:
        res = run_simulation(data, p)
        results[name] = res
        print(f"{name:<50} | {res['CAGR']:>6.2f}% | {res['Month_MDD']:>8.2f}% | {res['Sharpe']:>6.2f} | {res['Calmar']:>6.3f} | {res['Win_Rate']:>5.1f}%")
        
    print("-" * 105)
    
    out_file = "/Users/huanggin-chen/openclaw_test/new_factor_dimensions_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            'timestamp': pd.Timestamp.now().isoformat(),
            'dml_results': dml_results,
            'trials': results
        }, f, indent=2, ensure_ascii=False)
        
    print(f"成果已成功儲存至: {out_file}")

if __name__ == '__main__':
    main()
