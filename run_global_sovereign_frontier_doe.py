#!/usr/bin/env python3
"""
run_global_sovereign_frontier_doe.py
🌍 全球主權泰坦旗艦策略 — 前沿量化因子參數化疊加與全因子 DOE 實驗引擎
================================================================================
將六大前沿研究與量化論壇機制全面「參數化 (含權重 0 = 自動關閉)」，
在 2004~2026 (22.8年) 真實乾淨歷史數據上進行：
  1. Stage 1: 單因子敏感度與邊際貢獻分析 (Factor Ablation & Sensitivity)
  2. Stage 2: 多因子正交疊加與權重網格搜尋 (Multi-Factor Stacking DOE)
  3. 自動淘汰無效因子 (權重歸零)，選出：
     - 🏆 綜合夏普/卡瑪王 (Max Calmar & Sharpe Champion)
     - 🚀 極致獲利推進王 (High CAGR + Lower MDD Champion)
     - 🛡️ 極致低回撤防禦王 (Ultra-Low Drawdown Champion)
"""

import os
import json
import time
import sqlite3
import itertools
import numpy as np
import pandas as pd

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

t0_start = time.time()
print("=" * 95)
print("🔬 啟動【全球主權泰坦】前沿量化因子參數化疊加 DOE 實驗 (2004 - 2026, 22.8年全歷史)")
print("=" * 95)

# 1. 載入與清洗歷史資料 (與 deploy_dual_tranche_aggressive.py 100% 同基準)
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)].copy()
df['adj_factor'] = np.where(df['close'] > 0, df['adj_close'] / df['close'], 1.0)
df['open_adj'] = df['open'] * df['adj_factor']

sov_df['adj_factor'] = np.where(sov_df['close'] > 0, sov_df['adj_close'] / sov_df['close'], 1.0)
sov_df['open_adj'] = np.where(sov_df['open'].notna() & (sov_df['open'] > 0), sov_df['open'] * sov_df['adj_factor'], sov_df['adj_close'])

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open_adj').sort_index()
px_vol = df.pivot(index='date', columns='ticker', values='volume').sort_index()

sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
sov_open = sov_df.pivot(index='date', columns='ticker', values='open_adj').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
px_vol = px_vol.reindex(common_dates).fillna(0)
sov_adj = sov_adj.reindex(common_dates).ffill()
sov_open = sov_open.reindex(common_dates).ffill().combine_first(sov_adj)

# 嚴格清洗單日未還原誤植跳空針 (Bad Ticks)
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

# 將避險資產 GLD (黃金) 與 BIL (1-3月美國國庫券) 併入價格矩陣以便無縫交易
for sh_ticker in ['GLD', 'BIL', 'TLT', 'SPY', 'QQQ']:
    if sh_ticker in sov_adj.columns and sh_ticker not in px_adj.columns:
        px_adj[sh_ticker] = sov_adj[sh_ticker]
        px_open[sh_ticker] = sov_open[sh_ticker]

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

# 2. 預先計算所有技術、殘差、波動率、凸性與避險指標矩陣
print(f"[*] 資料載入完成 ({len(stock_tickers)} 檔跨國泰坦標的)，正在預算多維度因子矩陣...")

ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()

mom2w = px_adj.pct_change(10)
mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

# 大盤 SPY 報酬與均線
spy_ret1m = sov_adj['SPY'].pct_change(21)
spy_ret3m = sov_adj['SPY'].pct_change(63)
spy_ret12m = sov_adj['SPY'].pct_change(252)
spy_ma200 = sov_adj['SPY'].rolling(200).mean()
spy_ma60 = sov_adj['SPY'].rolling(60).mean()

# 全球 15 國主權 ETF 寬幅
sov_ma200 = sov_adj.rolling(200).mean()
sov_ma60 = sov_adj.rolling(60).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
global_breadth_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int).mean(axis=1)
global_breadth_60 = (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).astype(int).mean(axis=1)

# FIP (Frog-in-the-Pan 資訊離散度)
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# 波動率與下行波動率 (Downside Volatility & Upside/Downside Convexity)
vol_20d = px_daily_ret.rolling(20).std() * np.sqrt(252)
vol_60d = px_daily_ret.rolling(60).std() * np.sqrt(252)

downside_ret = px_daily_ret.clip(upper=0.0)
upside_ret = px_daily_ret.clip(lower=0.0)
downside_vol_60d = (downside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
upside_vol_60d = (upside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)

# 非對稱凸性比率 (Upside Vol / Downside Vol, 越大代表「漲時衝得快、跌時跌得少」)
convexity_ratio = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

# 個股對 SPY 的滾動 126 日 Beta 與殘差動能 (Residual / Idiosyncratic Momentum, Blitz et al.)
spy_d_ret = sov_adj['SPY'].pct_change()
spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)
betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
for s in stock_tickers:
    cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
    betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

res_mom12m = mom12m[stock_tickers].sub(spy_ret12m, axis=0) * 0.5 + (mom12m[stock_tickers] - betas_126.mul(spy_ret12m, axis=0)) * 0.5
res_mom3m = mom3m[stock_tickers] - betas_126.mul(spy_ret3m, axis=0)
res_mom1m = mom1m[stock_tickers] - betas_126.mul(spy_ret1m, axis=0)

# 原始絕對動能 vs 殘差特質動能
raw_mom_core = (0.45 * mom12m[stock_tickers] + 0.35 * mom3m[stock_tickers] + 0.20 * mom1m[stock_tickers])
res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)

# 爆量滯漲過濾 (Volume Churn Filter)
vol_ma60 = px_vol.rolling(60).mean()
vol_5d_mean = px_vol.rolling(5).mean()
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

# GLD (黃金) 與 BIL (短債) 趨勢狀態 (用於 Crisis Alpha 避險輪動)
gld_ma60 = sov_adj['GLD'].rolling(60).mean()
gld_ma200 = sov_adj['GLD'].rolling(200).mean()
gld_mom3m = sov_adj['GLD'].pct_change(63)
gld_mom1m = sov_adj['GLD'].pct_change(21)
bil_mom3m = sov_adj['BIL'].pct_change(63).fillna(0.0)

# 預算各種参数化的選股排名表，大幅加速 DOE
# 動能公式參數:
#   alpha_res: 殘差動能權重 (0.0 = 純原始動能, 0.5 = 半殘差, 1.0 = 純殘差)
#   gamma_sortino: 下行波動率懲罰指數 (0.0 = 無懲罰, 0.25 = 溫和Sortino調節, 0.50 = 強Sortino調節)
#   eta_convex: 上下波動不對稱凸性加成權重 (0.0 = 無, 0.20 = 20%凸性加成, 0.40 = 40%凸性加成)

all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])

def get_tranche_periods(day_target):
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
    return periods

periods_1 = get_tranche_periods(1)
periods_22 = get_tranche_periods(22)
all_rebal_tdates = sorted(list(set([p[0] for p in periods_1] + [p[0] for p in periods_22])))

# 轉為 numpy / dict 加速查詢
px_adj_dict = {col: px_adj[col].to_dict() for col in px_adj.columns}
px_open_dict = {col: px_open[col].to_dict() for col in px_open.columns}
ma60_dict = {col: ma60[col].to_dict() for col in stock_tickers}
ma200_dict = {col: ma200[col].to_dict() for col in stock_tickers}
vol20_dict = {col: vol_20d[col].to_dict() for col in stock_tickers}
dvol60_dict = {col: downside_vol_60d[col].to_dict() for col in stock_tickers}

# Precompute valid candidate rankings for any (alpha_res, gamma_sortino, eta_convex, ma60_slope_filter)
ranking_cache = {}

def get_rankings_for_score_config(alpha_res=0.0, gamma_sortino=0.0, eta_convex=0.0, slope_filter=False):
    key = (round(alpha_res, 3), round(gamma_sortino, 3), round(eta_convex, 3), bool(slope_filter))
    if key in ranking_cache:
        return ranking_cache[key]

    blend_mom = (1.0 - alpha_res) * raw_mom_core + alpha_res * res_mom_core
    score_mat = blend_mom * (1.0 + 0.5 * fip_mat[stock_tickers])
    if gamma_sortino > 0:
        dvol_clean = downside_vol_60d[stock_tickers].clip(lower=0.12, upper=1.50).fillna(0.35)
        score_mat = score_mat / (dvol_clean ** gamma_sortino)
    if eta_convex > 0:
        score_mat = score_mat * (1.0 + eta_convex * (convexity_ratio[stock_tickers] - 1.0).clip(-0.5, 2.0))

    ma60_slope = (ma60[stock_tickers] > ma60[stock_tickers].shift(5)) if slope_filter else None

    td_rankings = {}
    for td in all_rebal_tdates:
        row_sc = score_mat.loc[td]
        row_p = px_adj.loc[td, stock_tickers]
        row_m6 = ma60.loc[td, stock_tickers]
        row_m2 = ma200.loc[td, stock_tickers]
        row_ch = churn_exhaustion.loc[td, stock_tickers]

        cond = (row_p > row_m6) & (row_p > row_m2.fillna(0)) & (row_sc > 0) & (~row_ch) & row_sc.notna()
        if slope_filter:
            cond = cond & ma60_slope.loc[td]
        valid_s = row_sc[cond].sort_values(ascending=False)
        ranked_list = list(valid_s.index)
        info_map = {sym: (idx + 1, float(valid_s.iloc[idx])) for idx, sym in enumerate(ranked_list)}
        td_rankings[td] = (ranked_list, info_map)

    ranking_cache[key] = td_rankings
    return td_rankings


def get_defensive_asset_weights(t_date, def_weight, safe_haven_mode):
    """
    計算減碼或避險部位 (def_weight = 1.0 - exposure) 的資產配置：
      - 'CASH_0': 100% 0息現金 (Baseline)
      - 'BIL_ONLY': 100% 停泊於 BIL 短債 ETF
      - 'GLD_BIL_50_50': 若 GLD > MA60 且動能為正，50% GLD + 50% BIL；否則 100% BIL
      - 'GLD_BIL_DYNAMIC': 若 GLD > MA60 且 GLD 3M > BIL 3M 且 GLD 1M > 0，配置 70% GLD + 30% BIL；若僅 GLD > MA60 配置 40% GLD + 60% BIL；否則 100% BIL
      - 'GLD_FULL': 若 GLD > MA60 且 GLD 3M > 0，100% GLD；否則 100% BIL
    """
    if def_weight <= 1e-6:
        return {}
    if safe_haven_mode == 'CASH_0':
        return {'CASH': def_weight}
    if safe_haven_mode == 'BIL_ONLY':
        return {'BIL': def_weight}

    g_p = sov_adj.loc[t_date, 'GLD']
    g_m60 = gld_ma60.loc[t_date]
    g_m3 = gld_mom3m.loc[t_date]
    g_m1 = gld_mom1m.loc[t_date]
    b_m3 = bil_mom3m.loc[t_date]
    gld_bull = pd.notna(g_p) and pd.notna(g_m60) and (g_p > g_m60) and pd.notna(g_m3) and (g_m3 > b_m3)

    if safe_haven_mode == 'GLD_BIL_50_50':
        if gld_bull:
            return {'GLD': def_weight * 0.50, 'BIL': def_weight * 0.50}
        return {'BIL': def_weight}
    elif safe_haven_mode == 'GLD_BIL_DYNAMIC':
        if gld_bull and pd.notna(g_m1) and g_m1 > 0:
            return {'GLD': def_weight * 0.75, 'BIL': def_weight * 0.25}
        elif gld_bull:
            return {'GLD': def_weight * 0.40, 'BIL': def_weight * 0.60}
        return {'BIL': def_weight}
    elif safe_haven_mode == 'GLD_FULL':
        if gld_bull:
            return {'GLD': def_weight}
        return {'BIL': def_weight}
    return {'CASH': def_weight}


def simulate_single_tranche(periods, params, initial_capital=500000.0):
    """
    參數化單梯隊模擬引擎：
      - alpha_res: 殘差動能權重 (0.0 ~ 1.0)
      - gamma_sortino: Sortino 下行波動懲罰指數 (0.0 ~ 0.5)
      - eta_convex: 凸性加成權重 (0.0 ~ 0.4)
      - slope_filter: 60MA 斜率向上濾網 (True/False)
      - beta_inv_vol: 反波動率權重混成比例 (0.0 = 固定 40/30/30, 0.5 = 半反波動率, 1.0 = 全反波動率)
      - safe_haven_mode: 'CASH_0' | 'BIL_ONLY' | 'GLD_BIL_50_50' | 'GLD_BIL_DYNAMIC' | 'GLD_FULL'
      - macro_mode: 'BASE_50_30' | 'GRADED_60_40_20' | 'SPY200_ENHANCED'
      - stop_mode: 'NONE' | 'MA60_STOP' | 'TRAIL_GAIN30_DD12' | 'HYBRID_MA60_TRAIL'
      - rank_buffer: 緩衝區排名 (預設 5)
      - max_tenure: 最大連續持有月數 (預設 4)
    """
    td_rankings = get_rankings_for_score_config(
        alpha_res=params.get('alpha_res', 0.0),
        gamma_sortino=params.get('gamma_sortino', 0.0),
        eta_convex=params.get('eta_convex', 0.0),
        slope_filter=params.get('slope_filter', False)
    )

    beta_inv_vol = params.get('beta_inv_vol', 0.0)
    safe_haven_mode = params.get('safe_haven_mode', 'CASH_0')
    macro_mode = params.get('macro_mode', 'BASE_50_30')
    stop_mode = params.get('stop_mode', 'NONE')
    rank_buffer = params.get('rank_buffer', 5)
    max_tenure = params.get('max_tenure', 4)
    base_weights = params.get('base_weights', [0.40, 0.30, 0.30])

    friction = 0.0015
    cash = initial_capital
    current_holdings = {}   # sym -> shares
    entry_prices = {}       # sym -> entry price
    peak_prices = {}        # sym -> highest close since entry
    holding_tenure = {}

    all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
    n_dates = len(all_sim_dates)
    eq_arr = np.zeros(n_dates, dtype=float)

    p_idx = 0
    num_p = len(periods)
    pending_stop_sells = set()

    for t_idx, current_dt in enumerate(all_sim_dates):
        prev_dt = all_sim_dates[t_idx - 1] if t_idx > 0 else current_dt

        # A. 若非換倉日，先檢查是否有前一日收盤觸發的月內停損/移動停利指令 (T+1 開盤執行)
        is_rebal_exec_day = (p_idx < num_p and current_dt == periods[p_idx][1])
        if not is_rebal_exec_day and pending_stop_sells:
            for sym in list(pending_stop_sells):
                if sym in current_holdings:
                    sh = current_holdings.pop(sym)
                    op_px = px_open_dict[sym].get(current_dt, px_adj_dict[sym].get(current_dt, 0.0))
                    proceeds = sh * op_px * (1.0 - friction)
                    # 將停損退出的資金轉入當下避險資產 (BIL 或 GLD 或 CASH)
                    sh_alloc = get_defensive_asset_weights(prev_dt, 1.0, safe_haven_mode)
                    for def_sym, def_w in sh_alloc.items():
                        if def_sym == 'CASH':
                            cash += proceeds * def_w
                        else:
                            def_op = px_open_dict[def_sym].get(current_dt, px_adj_dict[def_sym].get(current_dt, 1.0))
                            if def_op > 0:
                                current_holdings[def_sym] = current_holdings.get(def_sym, 0.0) + (proceeds * def_w * (1.0 - friction * 0.5)) / def_op
                            else:
                                cash += proceeds * def_w
            pending_stop_sells.clear()

        # B. 換倉執行日 (T+1 開盤調倉)
        if is_rebal_exec_day:
            pending_stop_sells.clear()
            t_date, t_in, t_out = periods[p_idx]

            cur_val = cash
            for s, sh in current_holdings.items():
                cur_val += sh * px_open_dict[s].get(t_in, px_adj_dict[s].get(t_in, 0.0))

            # 1. 宏觀寬幅與曝險決定
            br200 = global_breadth_200.loc[t_date] if t_date in global_breadth_200.index else 0.5
            br60 = global_breadth_60.loc[t_date] if t_date in global_breadth_60.index else 0.5
            spy_bull = (sov_adj.loc[t_date, 'SPY'] >= spy_ma200.loc[t_date]) if pd.notna(spy_ma200.loc[t_date]) else True

            if macro_mode == 'BASE_50_30':
                if br200 >= 0.50:
                    exposure = 1.0
                elif br200 >= 0.30:
                    exposure = 0.70
                else:
                    exposure = 0.0
            elif macro_mode == 'GRADED_60_40_20':
                if br200 >= 0.55 or (br200 >= 0.45 and br60 >= 0.60):
                    exposure = 1.0
                elif br200 >= 0.35:
                    exposure = 0.75
                elif br200 >= 0.20 and spy_bull:
                    exposure = 0.40
                else:
                    exposure = 0.0
            elif macro_mode == 'SPY200_ENHANCED':
                if br200 >= 0.50 and spy_bull:
                    exposure = 1.0
                elif br200 >= 0.30 or spy_bull:
                    exposure = 0.70
                else:
                    exposure = 0.0
            else:
                exposure = 1.0 if br200 >= 0.50 else (0.70 if br200 >= 0.30 else 0.0)

            ranked_tickers, ticker_info = td_rankings[t_date]

            current_weights = {}
            if cur_val > 0:
                for s, sh in current_holdings.items():
                    current_weights[s] = (sh * px_open_dict[s].get(t_in, 0.0)) / cur_val

            if exposure <= 0 or len(ranked_tickers) == 0:
                target_alloc = get_defensive_asset_weights(t_date, 1.0, safe_haven_mode)
                holding_tenure = {}
            else:
                selected_stks = []
                # Buffer Zone 留倉機制
                for s in list(current_holdings.keys()):
                    if s in ('GLD', 'BIL', 'TLT', 'CASH'):
                        continue
                    tenure = holding_tenure.get(s, 0)
                    info = ticker_info.get(s, None)
                    if info is not None and info[0] <= rank_buffer and tenure < max_tenure:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3:
                        break
                    tenure = holding_tenure.get(s, 0)
                    if s not in selected_stks and tenure < max_tenure:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3:
                        break
                    if s not in selected_stks:
                        selected_stks.append(s)

                n = min(3, len(selected_stks))
                selected_stks = selected_stks[:n]
                holding_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}

                # 計算階梯權重 vs 反波動率 (Inverse-Volatility) 混成權重
                bw_slice = base_weights[:n]
                tot_bw = sum(bw_slice)
                step_w = [w / tot_bw for w in bw_slice]

                if beta_inv_vol > 0 and n > 1:
                    inv_vols = []
                    for s in selected_stks:
                        dv = dvol60_dict[s].get(t_date, np.nan)
                        if pd.isna(dv) or dv <= 0:
                            dv = vol20_dict[s].get(t_date, 0.35)
                        if pd.isna(dv) or dv <= 0:
                            dv = 0.35
                        inv_vols.append(1.0 / max(0.12, min(1.20, float(dv))))
                    sum_iv = sum(inv_vols)
                    iv_w = [iv / sum_iv for iv in inv_vols]
                    norm_weights = [(1.0 - beta_inv_vol) * sw + beta_inv_vol * iw for sw, iw in zip(step_w, iv_w)]
                else:
                    norm_weights = step_w

                raw_target_alloc = {selected_stks[idx]: norm_weights[idx] * exposure for idx in range(n)}

                target_alloc = {}
                remaining_weight = exposure
                unadjusted_stks = []

                for s in selected_stks:
                    tgt_w = raw_target_alloc[s]
                    cur_w = current_weights.get(s, 0.0)
                    if s in current_holdings and abs(cur_w - tgt_w) <= 0.05:
                        target_alloc[s] = cur_w
                        remaining_weight -= cur_w
                    else:
                        unadjusted_stks.append((s, tgt_w))

                if len(unadjusted_stks) > 0:
                    tot_unadj = sum(x[1] for x in unadjusted_stks)
                    for s, tgt_w in unadjusted_stks:
                        target_alloc[s] = max(0.0, remaining_weight * (tgt_w / tot_unadj)) if tot_unadj > 0 else 0.0

                tot_stk_w = sum(target_alloc.values())
                if tot_stk_w < 0.999:
                    def_w = max(0.0, 1.0 - tot_stk_w)
                    def_alloc = get_defensive_asset_weights(t_date, def_w, safe_haven_mode)
                    for ds, dw in def_alloc.items():
                        target_alloc[ds] = target_alloc.get(ds, 0.0) + dw

            all_syms = set(list(current_weights.keys()) + list(target_alloc.keys()))
            turnover = sum(abs(target_alloc.get(s, 0.0) - current_weights.get(s, 0.0)) for s in all_syms if s != 'CASH')
            fee = (turnover / 2.0) * friction * cur_val
            net_val = cur_val - fee

            new_holdings = {}
            cash = net_val * target_alloc.get('CASH', 0.0)
            for s, w in target_alloc.items():
                if s != 'CASH' and w > 1e-6:
                    op = px_open_dict[s].get(t_in, px_adj_dict[s].get(t_in, 1.0))
                    if op > 0:
                        new_holdings[s] = (net_val * w) / op
                        if s not in current_holdings:
                            entry_prices[s] = op
                            peak_prices[s] = op
            current_holdings = new_holdings
            p_idx += 1

        # C. 計算當日收盤總淨值與檢查月內停損/吊燈停利條件
        tot_eq = cash
        for s, sh in current_holdings.items():
            c_px = px_adj_dict[s].get(current_dt, 0.0)
            tot_eq += sh * c_px
            if stop_mode != 'NONE' and s not in ('GLD', 'BIL', 'TLT', 'CASH'):
                if c_px > peak_prices.get(s, 0.0):
                    peak_prices[s] = c_px
                e_px = entry_prices.get(s, c_px)
                p_peak = peak_prices.get(s, c_px)
                m60_v = ma60_dict[s].get(current_dt, 0.0)

                if stop_mode == 'MA60_STOP':
                    if m60_v > 0 and c_px < m60_v * 0.98:
                        pending_stop_sells.add(s)
                elif stop_mode == 'TRAIL_GAIN35_DD12':
                    # 當波段浮盈超過 +35% 且從最高點回落超過 12% 時鎖利
                    if e_px > 0 and (p_peak / e_px - 1.0) >= 0.35 and (c_px / p_peak - 1.0) <= -0.12:
                        pending_stop_sells.add(s)
                elif stop_mode == 'HYBRID_MA60_TRAIL':
                    if m60_v > 0 and c_px < m60_v * 0.97:
                        pending_stop_sells.add(s)
                    elif e_px > 0 and (p_peak / e_px - 1.0) >= 0.40 and (c_px / p_peak - 1.0) <= -0.12:
                        pending_stop_sells.add(s)

        eq_arr[t_idx] = tot_eq

    return pd.Series(eq_arr, index=all_sim_dates)


def evaluate_dual_tranche_config(params, label=""):
    eq_a = simulate_single_tranche(periods_1, params, 500000.0)
    eq_b = simulate_single_tranche(periods_22, params, 500000.0)
    common_idx = eq_a.index.intersection(eq_b.index)
    eq_dual = eq_a.loc[common_idx] + eq_b.loc[common_idx]

    years = (eq_dual.index[-1] - eq_dual.index[0]).days / 365.25
    mult = float(eq_dual.iloc[-1] / eq_dual.iloc[0])
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0

    m_series = eq_dual.resample('ME').last()
    m_ret = m_series.pct_change().dropna()
    m_mdd = float(((m_series - m_series.cummax()) / m_series.cummax() * 100.0).min())
    d_mdd = float(((eq_dual - eq_dual.cummax()) / eq_dual.cummax() * 100.0).min())

    calmar_m = cagr / abs(m_mdd) if m_mdd < 0 else 0.0
    calmar_d = cagr / abs(d_mdd) if d_mdd < 0 else 0.0
    sharpe = float((m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12))
    downside_m = m_ret[m_ret < 0]
    sortino = float((m_ret.mean() * 12) / (downside_m.std() * np.sqrt(12) + 1e-9))

    y_series = eq_dual.resample('YE').last()
    y_ret = y_series.pct_change().dropna() * 100.0
    win_years_pct = float((y_ret > 0).mean() * 100.0)
    worst_yr = float(y_ret.min())

    # 近 8 年樣本外 (OOS: 2018-01-01 ~ 2026-10-16)
    oos_eq = eq_dual[eq_dual.index >= '2018-01-01']
    oos_yrs = (oos_eq.index[-1] - oos_eq.index[0]).days / 365.25
    oos_cagr = float((oos_eq.iloc[-1] / oos_eq.iloc[0]) ** (1.0 / oos_yrs) - 1.0) * 100.0
    oos_m_series = oos_eq.resample('ME').last()
    oos_mdd = float(((oos_m_series - oos_m_series.cummax()) / oos_m_series.cummax() * 100.0).min())
    oos_calmar = oos_cagr / abs(oos_mdd) if oos_mdd < 0 else 0.0

    return {
        'label': label,
        'cagr': round(cagr, 2),
        'm_mdd': round(m_mdd, 2),
        'd_mdd': round(d_mdd, 2),
        'calmar_m': round(calmar_m, 3),
        'calmar_d': round(calmar_d, 3),
        'sharpe': round(sharpe, 2),
        'sortino': round(sortino, 2),
        'mult': round(mult, 1),
        'win_years_pct': round(win_years_pct, 1),
        'worst_yr': round(worst_yr, 2),
        'oos_cagr': round(oos_cagr, 2),
        'oos_mdd': round(oos_mdd, 2),
        'oos_calmar': round(oos_calmar, 3),
        'params': params
    }

# ==============================================================================
# STAGE 1: 單因子敏感度與消融實驗 (Single-Factor Ablation Study)
# 驗證每一個前沿機制單獨加入時，究竟是「真 Alpha」還是「無效雜訊」！
# ==============================================================================
print("\n" + "=" * 95)
print("📊 [STAGE 1] 單因子邊際貢獻測試 (對照基準 Baseline vs 6 大前沿因子獨立參數掃描)")
print("=" * 95)

base_params = {
    'alpha_res': 0.0,
    'gamma_sortino': 0.0,
    'eta_convex': 0.0,
    'slope_filter': False,
    'beta_inv_vol': 0.0,
    'safe_haven_mode': 'CASH_0',
    'macro_mode': 'BASE_50_30',
    'stop_mode': 'NONE',
    'rank_buffer': 5,
    'max_tenure': 4,
    'base_weights': [0.40, 0.30, 0.30]
}

baseline_res = evaluate_dual_tranche_config(base_params, "0. 現行基準 (Baseline: 40/30/30 + 45/35/20 + FIP + 現金避險)")
print(f"👉 {baseline_res['label']:<62s} | CAGR: {baseline_res['cagr']:>5.2f}% | 月MDD: {baseline_res['m_mdd']:>6.2f}% | 日MDD: {baseline_res['d_mdd']:>6.2f}% | Calmar: {baseline_res['calmar_m']:>5.3f} | Sharpe: {baseline_res['sharpe']:>4.2f} | OOS_CAGR: {baseline_res['oos_cagr']:>5.2f}%")

stage1_tests = [
    # 1. 殘差動能權重 alpha_res
    ("1A. 殘差動能 alpha=0.25 (25%剝離SPY Beta)", {**base_params, 'alpha_res': 0.25}),
    ("1B. 殘差動能 alpha=0.50 (50%剝離SPY Beta)", {**base_params, 'alpha_res': 0.50}),
    ("1C. 殘差動能 alpha=0.75 (75%剝離SPY Beta)", {**base_params, 'alpha_res': 0.75}),
    ("1D. 殘差動能 alpha=1.00 (100%純殘差動能)", {**base_params, 'alpha_res': 1.00}),

    # 2. 下行波動率懲罰指數 gamma_sortino (Sortino Momentum)
    ("2A. 下行波動懲罰 gamma=0.15 (輕度Sortino調節)", {**base_params, 'gamma_sortino': 0.15}),
    ("2B. 下行波動懲罰 gamma=0.25 (中度Sortino調節)", {**base_params, 'gamma_sortino': 0.25}),
    ("2C. 下行波動懲罰 gamma=0.40 (重度Sortino調節)", {**base_params, 'gamma_sortino': 0.40}),

    # 3. 上下波動不對稱凸性加成 eta_convex
    ("3A. 凸性加成 eta=0.15 (獎勵漲快跌慢標的)", {**base_params, 'eta_convex': 0.15}),
    ("3B. 凸性加成 eta=0.30 (中度獎勵漲快跌慢)", {**base_params, 'eta_convex': 0.30}),
    ("3C. 凸性加成 eta=0.50 (重度獎勵漲快跌慢)", {**base_params, 'eta_convex': 0.50}),

    # 4. 60MA 季線斜率向上濾網
    ("4A. 季線斜率濾網 (要求60MA 5日斜率 > 0)", {**base_params, 'slope_filter': True}),

    # 5. 反波動率風險平價倉位 beta_inv_vol
    ("5A. 反波動率配重 beta=0.30 (30%反波動+70%階梯)", {**base_params, 'beta_inv_vol': 0.30}),
    ("5B. 反波動率配重 beta=0.50 (50%反波動+50%階梯)", {**base_params, 'beta_inv_vol': 0.50}),
    ("5C. 反波動率配重 beta=1.00 (100%純反波動率配重)", {**base_params, 'beta_inv_vol': 1.00}),

    # 6. Crisis Alpha 危機避險輪動 (GLD / BIL)
    ("6A. 避險轉短債 (BIL_ONLY: 空倉資金停泊短債)", {**base_params, 'safe_haven_mode': 'BIL_ONLY'}),
    ("6B. 避險轉黃金+短債對半 (GLD_BIL_50_50)", {**base_params, 'safe_haven_mode': 'GLD_BIL_50_50'}),
    ("6C. 避險動態黃金/短債輪動 (GLD_BIL_DYNAMIC)", {**base_params, 'safe_haven_mode': 'GLD_BIL_DYNAMIC'}),
    ("6D. 避險全黃金趨勢輪動 (GLD_FULL)", {**base_params, 'safe_haven_mode': 'GLD_FULL'}),

    # 7. 宏觀寬幅與SPY雙重濾網
    ("7A. 宏觀四階動態寬幅 (GRADED_60_40_20)", {**base_params, 'macro_mode': 'GRADED_60_40_20'}),
    ("7B. 宏觀寬幅+SPY年線雙重濾網 (SPY200_ENHANCED)", {**base_params, 'macro_mode': 'SPY200_ENHANCED'}),

    # 8. 月內動態停損 / 移動鎖利
    ("8A. 月內跌破季線提前停損 (MA60_STOP)", {**base_params, 'stop_mode': 'MA60_STOP'}),
    ("8B. 月內暴漲+35%回落12%鎖利 (TRAIL_GAIN35_DD12)", {**base_params, 'stop_mode': 'TRAIL_GAIN35_DD12'}),
    ("8C. 月內季線+高檔鎖利雙軌 (HYBRID_MA60_TRAIL)", {**base_params, 'stop_mode': 'HYBRID_MA60_TRAIL'}),
]

s1_results = [baseline_res]
for lbl, prm in stage1_tests:
    r = evaluate_dual_tranche_config(prm, lbl)
    s1_results.append(r)
    d_cagr = r['cagr'] - baseline_res['cagr']
    d_mdd = r['m_mdd'] - baseline_res['m_mdd'] # positive means smaller drawdown!
    d_cal = r['calmar_m'] - baseline_res['calmar_m']
    flag = "✅ 雙贏(提利+降回撤)" if (d_cagr >= 0 and d_mdd >= 0 and (d_cagr > 0.1 or d_mdd > 0.1)) else ("🛡️ 降回撤提Calmar" if d_cal > 0.02 else ("🚀 提CAGR" if d_cagr > 0.2 else "❌ 無效/降權"))
    print(f"  {lbl:<50s} | CAGR: {r['cagr']:>5.2f}% ({d_cagr:+5.2f}%) | 月MDD: {r['m_mdd']:>6.2f}% ({d_mdd:+5.2f}%) | 日MDD: {r['d_mdd']:>6.2f}% | Calmar: {r['calmar_m']:>5.3f} ({d_cal:+6.3f}) | Sharpe: {r['sharpe']:>4.2f} | {flag}")

# ==============================================================================
# STAGE 2: 多因子正交疊加全網格 DOE (Multi-Factor Stacking Optimization)
# 將有效因子與無效因子 (0權重) 放入網格，讓演算法自動找出最佳疊加權重組合！
# ==============================================================================
print("\n" + "=" * 95)
print("🔥 [STAGE 2] 啟動多因子疊加 DOE 網格最佳化 (含權重 0 自動淘汰機制)...")
print("=" * 95)

grid_alpha_res = [0.0, 0.25, 0.50]
grid_gamma_sortino = [0.0, 0.15, 0.25]
grid_eta_convex = [0.0, 0.15, 0.30]
grid_slope_filter = [False, True]
grid_beta_inv_vol = [0.0, 0.30, 0.50]
grid_safe_haven = ['CASH_0', 'GLD_BIL_50_50', 'GLD_BIL_DYNAMIC', 'GLD_FULL']
grid_macro = ['BASE_50_30', 'GRADED_60_40_20', 'SPY200_ENHANCED']
grid_stop = ['NONE', 'TRAIL_GAIN35_DD12']

# 先預算所有 54 種選股分數矩陣排名 (3 x 3 x 3 x 2 = 54)
for a_r, g_s, e_c, slp in itertools.product(grid_alpha_res, grid_gamma_sortino, grid_eta_convex, grid_slope_filter):
    get_rankings_for_score_config(a_r, g_s, e_c, slp)
print(f"[*] 54 組多因子選股矩陣預算完成！開始搜尋疊加組合...")

# 篩選前 12 名最強選股因子組合進入全倉位/避險/風控疊加網格
score_combos = []
for a_r, g_s, e_c, slp in itertools.product(grid_alpha_res, grid_gamma_sortino, grid_eta_convex, grid_slope_filter):
    p_test = {**base_params, 'alpha_res': a_r, 'gamma_sortino': g_s, 'eta_convex': e_c, 'slope_filter': slp}
    r_test = evaluate_dual_tranche_config(p_test)
    # 綜合評分: Calmar_M * 0.5 + Calmar_D * 0.3 + (CAGR / 50.0) * 0.2
    comp_score = r_test['calmar_m'] * 0.5 + r_test['calmar_d'] * 0.3 + (r_test['cagr'] / 50.0) * 0.2
    score_combos.append((comp_score, a_r, g_s, e_c, slp, r_test))

score_combos.sort(key=lambda x: x[0], reverse=True)
top_score_factors = score_combos[:10]
# 確保 Baseline (0, 0, 0, False) 也在其中作為對照
if not any(x[1] == 0.0 and x[2] == 0.0 and x[3] == 0.0 and not x[4] for x in top_score_factors):
    top_score_factors.append((0.0, 0.0, 0.0, 0.0, False, baseline_res))

all_doe_results = []
for _, a_r, g_s, e_c, slp, _ in top_score_factors:
    for b_iv, sh_mode, mac_mode, st_mode in itertools.product(grid_beta_inv_vol, grid_safe_haven, grid_macro, grid_stop):
        prm = {
            'alpha_res': a_r,
            'gamma_sortino': g_s,
            'eta_convex': e_c,
            'slope_filter': slp,
            'beta_inv_vol': b_iv,
            'safe_haven_mode': sh_mode,
            'macro_mode': mac_mode,
            'stop_mode': st_mode,
            'rank_buffer': 5,
            'max_tenure': 4,
            'base_weights': [0.40, 0.30, 0.30]
        }
        lbl = f"Res={a_r}|Sort={g_s}|Conv={e_c}|Slp={int(slp)}|InvV={b_iv}|{sh_mode}|{mac_mode}|{st_mode}"
        res = evaluate_dual_tranche_config(prm, lbl)
        all_doe_results.append(res)

print(f"[✓] 共完成 {len(all_doe_results)} 組多因子疊加 DOE 全歷史回測！耗時: {time.time() - t0_start:.1f} 秒")

# 儲存完整 DOE 結果
df_doe = pd.DataFrame([
    {
        'label': r['label'],
        'cagr': r['cagr'],
        'm_mdd': r['m_mdd'],
        'd_mdd': r['d_mdd'],
        'calmar_m': r['calmar_m'],
        'calmar_d': r['calmar_d'],
        'sharpe': r['sharpe'],
        'sortino': r['sortino'],
        'mult': r['mult'],
        'win_years_pct': r['win_years_pct'],
        'worst_yr': r['worst_yr'],
        'oos_cagr': r['oos_cagr'],
        'oos_mdd': r['oos_mdd'],
        'oos_calmar': r['oos_calmar'],
        **r['params']
    }
    for r in all_doe_results
])
df_doe.drop(columns=['base_weights'], errors='ignore').to_csv("/Users/huanggin-chen/openclaw_test/global_sovereign_frontier_doe_results.csv", index=False)

# 選出三大領域冠軍：
# 1. 雙贏綜合王 (CAGR > Baseline 且 月MDD 與 日MDD 均顯著低於 Baseline，且 Calmar 最高)
win_win = [r for r in all_doe_results if r['cagr'] >= baseline_res['cagr'] and r['m_mdd'] > baseline_res['m_mdd'] and r['d_mdd'] > baseline_res['d_mdd']]
win_win.sort(key=lambda x: (x['calmar_m'] + x['calmar_d']), reverse=True)

# 2. 極致獲利王 (在月 MDD 不超過 Baseline 的前提下，CAGR 最高)
high_cagr = [r for r in all_doe_results if r['m_mdd'] >= baseline_res['m_mdd'] - 0.5]
high_cagr.sort(key=lambda x: x['cagr'], reverse=True)

# 3. 極致低回撤防禦王 (在 CAGR >= 52% 的前提下，月 MDD 與 日 MDD 最小、Calmar 最高)
low_mdd = [r for r in all_doe_results if r['cagr'] >= 52.0]
low_mdd.sort(key=lambda x: (x['calmar_m'], -abs(x['m_mdd'])), reverse=True)

print("\n" + "=" * 95)
print("🏆 【DOE 實驗結果總結：三大最佳化疊加方案 vs 現行基準 Baseline】")
print("=" * 95)
print(f"📌 [現行基準 Baseline] CAGR={baseline_res['cagr']}% | 月MDD={baseline_res['m_mdd']}% | 日MDD={baseline_res['d_mdd']}% | 月Calmar={baseline_res['calmar_m']} | 日Calmar={baseline_res['calmar_d']} | Sharpe={baseline_res['sharpe']} | Sortino={baseline_res['sortino']} | 勝率年={baseline_res['win_years_pct']}% | 最差年={baseline_res['worst_yr']}% | 淨值倍數={baseline_res['mult']}x")

print("\n🥇 【冠軍方案 A：提利降回撤雙贏王 (Balanced Alpha + Crisis Hedge)】")
for idx, r in enumerate(win_win[:5], 1):
    print(f"  Top {idx}: {r['label']}")
    print(f"         CAGR={r['cagr']}% ({r['cagr']-baseline_res['cagr']:+.2f}%) | 月MDD={r['m_mdd']}% ({r['m_mdd']-baseline_res['m_mdd']:+.2f}%) | 日MDD={r['d_mdd']}% ({r['d_mdd']-baseline_res['d_mdd']:+.2f}%) | 月Calmar={r['calmar_m']} | 日Calmar={r['calmar_d']} | Sharpe={r['sharpe']} | Sortino={r['sortino']} | 倍數={r['mult']}x | OOS_CAGR={r['oos_cagr']}%")

print("\n🚀 【冠軍方案 B：極致獲利推進王 (Max CAGR Without Extra Drawdown)】")
for idx, r in enumerate(high_cagr[:5], 1):
    print(f"  Top {idx}: {r['label']}")
    print(f"         CAGR={r['cagr']}% ({r['cagr']-baseline_res['cagr']:+.2f}%) | 月MDD={r['m_mdd']}% ({r['m_mdd']-baseline_res['m_mdd']:+.2f}%) | 日MDD={r['d_mdd']}% ({r['d_mdd']-baseline_res['d_mdd']:+.2f}%) | 月Calmar={r['calmar_m']} | 日Calmar={r['calmar_d']} | Sharpe={r['sharpe']} | Sortino={r['sortino']} | 倍數={r['mult']}x | OOS_CAGR={r['oos_cagr']}%")

print("\n🛡️ 【冠軍方案 C：極致低回撤防禦王 (Max Calmar & Min Drawdown, CAGR >= 52%)】")
for idx, r in enumerate(low_mdd[:5], 1):
    print(f"  Top {idx}: {r['label']}")
    print(f"         CAGR={r['cagr']}% ({r['cagr']-baseline_res['cagr']:+.2f}%) | 月MDD={r['m_mdd']}% ({r['m_mdd']-baseline_res['m_mdd']:+.2f}%) | 日MDD={r['d_mdd']}% ({r['d_mdd']-baseline_res['d_mdd']:+.2f}%) | 月Calmar={r['calmar_m']} | 日Calmar={r['calmar_d']} | Sharpe={r['sharpe']} | Sortino={r['sortino']} | 倍數={r['mult']}x | OOS_CAGR={r['oos_cagr']}%")
