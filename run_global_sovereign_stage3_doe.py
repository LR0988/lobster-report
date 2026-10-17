#!/usr/bin/env python3
"""
run_global_sovereign_stage3_doe.py
🔬 Stage 3 精細化多因子疊加 DOE：
  1. 修正避險資金最小門檻 (僅在宏觀減碼 exposure < 1.0 時啟動 GLD/BIL Crisis Alpha，不因 5% 緩衝零頭頻繁交易)
  2. 測試「大盤條件式月內保護 (Regime-Conditional Stop)」與「組合波動率目標縮放 (Portfolio Vol-Target Overlay)」
  3. 精細掃描：
     - 非對稱凸性因子權重 eta_convex ∈ [0.0, 0.08, 0.12, 0.15, 0.20]
     - 下行波動懲罰指數 gamma_sortino ∈ [0.0, 0.05, 0.10, 0.15]
     - 殘差動能權重 alpha_res ∈ [0.0, 0.10, 0.20]
     - 反波動率配重權重 beta_inv_vol ∈ [0.0, 0.20, 0.35, 0.50]
     - 危機 Alpha 避險模式 safe_haven ∈ ['CASH_0', 'GLD_CRISIS', 'GLD_BIL_CRISIS']
     - 組合波動率頂部保護 vol_shield ∈ ['OFF', 'VOL35_SCALE', 'VOL40_SCALE', 'SPY_MA60_GUARD']
     - 持有任期與緩衝區 max_tenure ∈ [4, 5, 6], rank_buffer ∈ [4, 5, 6]
"""

import time
import sqlite3
import itertools
import numpy as np
import pandas as pd

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"
t0 = time.time()

conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close, volume FROM global_stock_daily ORDER BY date ASC", conn)
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

for sh_ticker in ['GLD', 'BIL', 'SPY', 'QQQ']:
    if sh_ticker in sov_adj.columns and sh_ticker not in px_adj.columns:
        px_adj[sh_ticker] = sov_adj[sh_ticker]
        px_open[sh_ticker] = sov_open[sh_ticker]

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()
mom2w = px_adj.pct_change(10)
mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom12m = px_adj.pct_change(252)

spy_ret1m = sov_adj['SPY'].pct_change(21)
spy_ret3m = sov_adj['SPY'].pct_change(63)
spy_ret12m = sov_adj['SPY'].pct_change(252)
spy_ma200 = sov_adj['SPY'].rolling(200).mean()
spy_ma60 = sov_adj['SPY'].rolling(60).mean()
spy_vol20 = sov_adj['SPY'].pct_change().rolling(20).std() * np.sqrt(252)

sov_ma200 = sov_adj.rolling(200).mean()
sov_ma60 = sov_adj.rolling(60).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
global_breadth_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int).mean(axis=1)
global_breadth_60 = (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).astype(int).mean(axis=1)

px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

vol_20d = px_daily_ret.rolling(20).std() * np.sqrt(252)
downside_ret = px_daily_ret.clip(upper=0.0)
upside_ret = px_daily_ret.clip(lower=0.0)
downside_vol_60d = (downside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
upside_vol_60d = (upside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
convexity_ratio = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

spy_d_ret = sov_adj['SPY'].pct_change()
spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)
betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
for s in stock_tickers:
    cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
    betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

res_mom12m = mom12m[stock_tickers].sub(spy_ret12m, axis=0) * 0.5 + (mom12m[stock_tickers] - betas_126.mul(spy_ret12m, axis=0)) * 0.5
res_mom3m = mom3m[stock_tickers] - betas_126.mul(spy_ret3m, axis=0)
res_mom1m = mom1m[stock_tickers] - betas_126.mul(spy_ret1m, axis=0)

raw_mom_core = (0.45 * mom12m[stock_tickers] + 0.35 * mom3m[stock_tickers] + 0.20 * mom1m[stock_tickers])
res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)

vol_ma60 = px_vol.rolling(60).mean()
vol_5d_mean = px_vol.rolling(5).mean()
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

gld_ma60 = sov_adj['GLD'].rolling(60).mean()
gld_mom3m = sov_adj['GLD'].pct_change(63)
gld_mom1m = sov_adj['GLD'].pct_change(21)

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

# 為了讓回測極速化，預先建立每個 period 的開盤買入價、期末賣出價與期內每日價格切片
all_sim_dates = px_adj.index[(px_adj.index >= periods_1[0][0]) & (px_adj.index <= periods_1[-1][2])]
px_adj_np = px_adj.loc[all_sim_dates]
px_open_np = px_open.loc[all_sim_dates]
dvol60_dict = {col: downside_vol_60d[col].to_dict() for col in stock_tickers}
vol20_dict = {col: vol_20d[col].to_dict() for col in stock_tickers}

ranking_cache = {}
def get_rankings(alpha_res=0.0, gamma_sortino=0.0, eta_convex=0.0):
    key = (round(alpha_res, 3), round(gamma_sortino, 3), round(eta_convex, 3))
    if key in ranking_cache:
        return ranking_cache[key]
    blend_mom = (1.0 - alpha_res) * raw_mom_core + alpha_res * res_mom_core
    score_mat = blend_mom * (1.0 + 0.5 * fip_mat[stock_tickers])
    if gamma_sortino > 0:
        dvol_clean = downside_vol_60d[stock_tickers].clip(lower=0.12, upper=1.50).fillna(0.35)
        score_mat = score_mat / (dvol_clean ** gamma_sortino)
    if eta_convex > 0:
        score_mat = score_mat * (1.0 + eta_convex * (convexity_ratio[stock_tickers] - 1.0).clip(-0.5, 2.0))

    td_rankings = {}
    for td in all_rebal_tdates:
        row_sc = score_mat.loc[td]
        row_p = px_adj.loc[td, stock_tickers]
        row_m6 = ma60.loc[td, stock_tickers]
        row_m2 = ma200.loc[td, stock_tickers]
        row_ch = churn_exhaustion.loc[td, stock_tickers]
        cond = (row_p > row_m6) & (row_p > row_m2.fillna(0)) & (row_sc > 0) & (~row_ch) & row_sc.notna()
        valid_s = row_sc[cond].sort_values(ascending=False)
        ranked_list = list(valid_s.index)
        info_map = {sym: (idx + 1, float(valid_s.iloc[idx])) for idx, sym in enumerate(ranked_list)}
        td_rankings[td] = (ranked_list, info_map)
    ranking_cache[key] = td_rankings
    return td_rankings


def simulate_tranche_fast(periods, params, initial_capital=500000.0):
    td_rankings = get_rankings(
        alpha_res=params.get('alpha_res', 0.0),
        gamma_sortino=params.get('gamma_sortino', 0.0),
        eta_convex=params.get('eta_convex', 0.0)
    )
    beta_inv_vol = params.get('beta_inv_vol', 0.0)
    safe_haven = params.get('safe_haven', 'CASH_0')
    vol_shield = params.get('vol_shield', 'OFF')
    rank_buffer = params.get('rank_buffer', 5)
    max_tenure = params.get('max_tenure', 4)
    base_weights = params.get('base_weights', [0.40, 0.30, 0.30])

    friction = 0.0015
    cash = initial_capital
    current_holdings = {}
    holding_tenure = {}
    daily_eq = pd.Series(index=all_sim_dates, dtype=float)

    # 先填好初始日期到第一個 t_in 之前的資金
    first_t_in = periods[0][1]
    daily_eq.loc[all_sim_dates[all_sim_dates < first_t_in]] = initial_capital

    for p_idx, (t_date, t_in, t_out) in enumerate(periods):
        # 1. 在 t_in 開盤結算上一期持倉總值
        cur_val = cash
        for s, sh in current_holdings.items():
            cur_val += sh * float(px_open.loc[t_in, s])

        # 2. 決定宏觀曝險與波動率護盾
        br = float(global_breadth_200.loc[t_date]) if t_date in global_breadth_200.index else 0.5
        if br >= 0.50:
            exposure = 1.0
        elif br >= 0.30:
            exposure = 0.70
        else:
            exposure = 0.0

        # 波動率與大盤趨勢護盾 (Vol-Target / SPY MA60 Guard)
        if vol_shield != 'OFF' and exposure > 0:
            s_vol = float(spy_vol20.loc[t_date]) if pd.notna(spy_vol20.loc[t_date]) else 0.15
            s_p = float(sov_adj.loc[t_date, 'SPY'])
            s_m60 = float(spy_ma60.loc[t_date]) if pd.notna(spy_ma60.loc[t_date]) else s_p
            s_m200 = float(spy_ma200.loc[t_date]) if pd.notna(spy_ma200.loc[t_date]) else s_p

            if vol_shield == 'VOL_TARGET_25':
                # 當大盤年化波動率飆破 25% 且跌破 60MA 時，按比例縮減曝險
                if s_vol > 0.25 and s_p < s_m60:
                    exposure = min(exposure, max(0.35, 0.25 / s_vol))
            elif vol_shield == 'VOL_TARGET_30':
                if s_vol > 0.30 and s_p < s_m60:
                    exposure = min(exposure, max(0.40, 0.30 / s_vol))
            elif vol_shield == 'SPY_MA200_CAP80':
                # 當全球寬幅 >= 50% 但美股 SPY 跌破 200MA 時，上限鎖在 80%
                if s_p < s_m200 and exposure > 0.80:
                    exposure = 0.80

        ranked_tickers, ticker_info = td_rankings[t_date]
        current_weights = {}
        if cur_val > 0:
            for s, sh in current_holdings.items():
                current_weights[s] = (sh * float(px_open.loc[t_in, s])) / cur_val

        target_alloc = {}
        if exposure <= 0 or len(ranked_tickers) == 0:
            holding_tenure = {}
            # 100% 避險模式
            if safe_haven == 'GLD_CRISIS':
                g_p = float(sov_adj.loc[t_date, 'GLD']) if pd.notna(sov_adj.loc[t_date, 'GLD']) else 0.0
                g_m60 = float(gld_ma60.loc[t_date]) if pd.notna(gld_ma60.loc[t_date]) else 0.0
                g_mom = float(gld_mom3m.loc[t_date]) if pd.notna(gld_mom3m.loc[t_date]) else 0.0
                if g_p > g_m60 and g_mom > 0.02:
                    target_alloc['GLD'] = 0.50
                    target_alloc['CASH'] = 0.50
                else:
                    target_alloc['CASH'] = 1.0
            elif safe_haven == 'GLD_FULL_CRISIS':
                g_p = float(sov_adj.loc[t_date, 'GLD']) if pd.notna(sov_adj.loc[t_date, 'GLD']) else 0.0
                g_m60 = float(gld_ma60.loc[t_date]) if pd.notna(gld_ma60.loc[t_date]) else 0.0
                g_mom = float(gld_mom3m.loc[t_date]) if pd.notna(gld_mom3m.loc[t_date]) else 0.0
                if g_p > g_m60 and g_mom > 0.02:
                    target_alloc['GLD'] = 0.80
                    target_alloc['CASH'] = 0.20
                else:
                    target_alloc['CASH'] = 1.0
            else:
                target_alloc['CASH'] = 1.0
        else:
            selected_stks = []
            for s in list(current_holdings.keys()):
                if s in ('GLD', 'BIL', 'CASH'):
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

            # 關鍵修正：只有當宏觀減碼 (exposure < 0.95，例如 70% 防禦倉位) 時，才把那 30% 防禦部位拿去做 Crisis Alpha 黃金避險！
            # 若 exposure == 1.0，微小的 1~2% 緩衝餘額直接留在 CASH，絕不頻繁買賣避險 ETF！
            def_rem = max(0.0, 1.0 - sum(target_alloc.values()))
            if exposure < 0.95 and def_rem >= 0.15 and safe_haven in ('GLD_CRISIS', 'GLD_FULL_CRISIS'):
                g_p = float(sov_adj.loc[t_date, 'GLD']) if pd.notna(sov_adj.loc[t_date, 'GLD']) else 0.0
                g_m60 = float(gld_ma60.loc[t_date]) if pd.notna(gld_ma60.loc[t_date]) else 0.0
                g_mom = float(gld_mom3m.loc[t_date]) if pd.notna(gld_mom3m.loc[t_date]) else 0.0
                if g_p > g_m60 and g_mom > 0.02:
                    g_share = 0.60 if safe_haven == 'GLD_CRISIS' else 1.0
                    target_alloc['GLD'] = def_rem * g_share
                    target_alloc['CASH'] = def_rem * (1.0 - g_share)
                else:
                    target_alloc['CASH'] = def_rem
            else:
                target_alloc['CASH'] = def_rem

        all_syms = set(list(current_weights.keys()) + list(target_alloc.keys()))
        turnover = sum(abs(target_alloc.get(s, 0.0) - current_weights.get(s, 0.0)) for s in all_syms if s != 'CASH')
        fee = (turnover / 2.0) * friction * cur_val
        net_val = cur_val - fee

        current_holdings = {}
        cash = net_val * target_alloc.get('CASH', 0.0)
        for s, w in target_alloc.items():
            if s != 'CASH' and w > 1e-6:
                op = float(px_open.loc[t_in, s])
                if op > 0:
                    current_holdings[s] = (net_val * w) / op

        # 向量化計算 t_in 到 t_out 期間的每日淨值
        sub_idx = px_adj_np.loc[t_in:t_out].index
        sub_eq = pd.Series(cash, index=sub_idx, dtype=float)
        for s, sh in current_holdings.items():
            sub_eq += sh * px_adj_np.loc[sub_idx, s]
        daily_eq.loc[sub_idx] = sub_eq

    return daily_eq.ffill().bfill()


def evaluate_config(params, label=""):
    eq_a = simulate_tranche_fast(periods_1, params, 500000.0)
    eq_b = simulate_tranche_fast(periods_22, params, 500000.0)
    eq_dual = eq_a + eq_b

    years = (eq_dual.index[-1] - eq_dual.index[0]).days / 365.25
    mult = float(eq_dual.iloc[-1] / eq_dual.iloc[0])
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0

    m_series = eq_dual.resample('ME').last()
    m_ret = m_series.pct_change().dropna()
    m_dd_series = (m_series - m_series.cummax()) / m_series.cummax() * 100.0
    d_dd_series = (eq_dual - eq_dual.cummax()) / eq_dual.cummax() * 100.0
    m_mdd = float(m_dd_series.min())
    d_mdd = float(d_dd_series.min())

    calmar_m = cagr / abs(m_mdd) if m_mdd < 0 else 0.0
    calmar_d = cagr / abs(d_mdd) if d_mdd < 0 else 0.0
    sharpe = float((m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12))
    downside_m = m_ret[m_ret < 0]
    sortino = float((m_ret.mean() * 12) / (downside_m.std() * np.sqrt(12) + 1e-9))

    y_series = eq_dual.resample('YE').last()
    y_ret = y_series.pct_change().dropna() * 100.0
    win_years_pct = float((y_ret > 0).mean() * 100.0)
    worst_yr = float(y_ret.min())

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

base_params = {
    'alpha_res': 0.0,
    'gamma_sortino': 0.0,
    'eta_convex': 0.0,
    'beta_inv_vol': 0.0,
    'safe_haven': 'CASH_0',
    'vol_shield': 'OFF',
    'rank_buffer': 5,
    'max_tenure': 4,
    'base_weights': [0.40, 0.30, 0.30]
}
base_res = evaluate_config(base_params, "Baseline")

# 執行精細網格搜尋
eta_list = [0.0, 0.08, 0.12, 0.15, 0.20]
gamma_list = [0.0, 0.05, 0.10, 0.15]
alpha_list = [0.0, 0.15]
beta_list = [0.0, 0.25, 0.40]
sh_list = ['CASH_0', 'GLD_CRISIS', 'GLD_FULL_CRISIS']
vs_list = ['OFF', 'VOL_TARGET_25', 'VOL_TARGET_30', 'SPY_MA200_CAP80']
tenure_list = [4, 5]
buf_list = [4, 5]

# 先跑選股與任期/緩衝網格
print("[*] 正在執行 Stage 3 精細化全網格疊加測試...")
results = []

for eta, gamma, alpha in itertools.product(eta_list, gamma_list, alpha_list):
    get_rankings(alpha, gamma, eta)

# 挑選表現優異的 (alpha, gamma, eta) 進行全維度疊加
candidate_scores = []
for eta, gamma, alpha in itertools.product(eta_list, gamma_list, alpha_list):
    r = evaluate_config({**base_params, 'alpha_res': alpha, 'gamma_sortino': gamma, 'eta_convex': eta})
    score = r['calmar_m'] * 0.4 + r['calmar_d'] * 0.4 + (r['cagr'] / 55.0) * 0.2
    candidate_scores.append((score, alpha, gamma, eta, r))

candidate_scores.sort(key=lambda x: x[0], reverse=True)
top_ag_eta = candidate_scores[:12]

for _, alpha, gamma, eta, _ in top_ag_eta:
    for beta, sh, vs, ten, buf in itertools.product(beta_list, sh_list, vs_list, tenure_list, buf_list):
        prm = {
            'alpha_res': alpha,
            'gamma_sortino': gamma,
            'eta_convex': eta,
            'beta_inv_vol': beta,
            'safe_haven': sh,
            'vol_shield': vs,
            'rank_buffer': buf,
            'max_tenure': ten,
            'base_weights': [0.40, 0.30, 0.30]
        }
        lbl = f"Conv={eta}|Sort={gamma}|Res={alpha}|InvV={beta}|{sh}|{vs}|Ten={ten}|Buf={buf}"
        results.append(evaluate_config(prm, lbl))

print(f"[✓] Stage 3 完成 {len(results)} 組精細化 DOE 測試！耗時 {time.time()-t0:.1f} 秒")

df_s3 = pd.DataFrame([
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
        **{k: v for k, v in r['params'].items() if k != 'base_weights'}
    }
    for r in results
])
df_s3.to_csv("/Users/huanggin-chen/openclaw_test/global_sovereign_stage3_doe_results.csv", index=False)

print("\n" + "=" * 100)
print(f"📌 [現行基準 Baseline] CAGR={base_res['cagr']}% | 月MDD={base_res['m_mdd']}% | 日MDD={base_res['d_mdd']}% | 月Calmar={base_res['calmar_m']} | 日Calmar={base_res['calmar_d']} | Sharpe={base_res['sharpe']} | Sortino={base_res['sortino']} | 倍數={base_res['mult']}x | OOS_CAGR={base_res['oos_cagr']}%")
print("=" * 100)

# 1. 全方位碾壓基準 (Strict Dominance: CAGR > Baseline, m_mdd > Baseline, d_mdd > Baseline, sharpe > Baseline, oos_cagr > Baseline)
strict_dom = [
    r for r in results
    if r['cagr'] > base_res['cagr']
    and r['m_mdd'] > base_res['m_mdd']
    and r['d_mdd'] > base_res['d_mdd']
    and r['sharpe'] >= base_res['sharpe']
]
strict_dom.sort(key=lambda x: (x['calmar_m'] + x['calmar_d'] + x['cagr']/50.0), reverse=True)

print(f"\n🏆 【1. 全方位嚴格優於基準 (Strict Pareto Dominance: 獲利更高 + 月回撤更低 + 日回撤更低)】(共 {len(strict_dom)} 組達標)")
for idx, r in enumerate(strict_dom[:8], 1):
    print(f"  #{idx}: {r['label']}")
    print(f"       CAGR: {r['cagr']}% ({r['cagr']-base_res['cagr']:+.2f}%) | 月MDD: {r['m_mdd']}% ({r['m_mdd']-base_res['m_mdd']:+.2f}%) | 日MDD: {r['d_mdd']}% ({r['d_mdd']-base_res['d_mdd']:+.2f}%) | 月Calmar: {r['calmar_m']} | 日Calmar: {r['calmar_d']} | Sharpe: {r['sharpe']} | Sortino: {r['sortino']} | 倍數: {r['mult']}x | OOS_CAGR: {r['oos_cagr']}%")

# 2. 極致低回撤組合 (CAGR >= 54.0% 且 月MDD 與 日MDD 大幅降低)
low_dd_champs = [r for r in results if r['cagr'] >= 54.0]
low_dd_champs.sort(key=lambda x: (x['m_mdd'] + x['d_mdd']*0.5), reverse=True)
print(f"\n🛡️ 【2. 極致低回撤防禦冠軍 (CAGR >= 54% 下回撤最低)】")
for idx, r in enumerate(low_dd_champs[:6], 1):
    print(f"  #{idx}: {r['label']}")
    print(f"       CAGR: {r['cagr']}% ({r['cagr']-base_res['cagr']:+.2f}%) | 月MDD: {r['m_mdd']}% ({r['m_mdd']-base_res['m_mdd']:+.2f}%) | 日MDD: {r['d_mdd']}% ({r['d_mdd']-base_res['d_mdd']:+.2f}%) | 月Calmar: {r['calmar_m']} | 日Calmar: {r['calmar_d']} | Sharpe: {r['sharpe']} | Sortino: {r['sortino']} | 倍數: {r['mult']}x | OOS_CAGR: {r['oos_cagr']}%")

# 3. 極致高報酬組合 (月MDD <= Baseline 下 CAGR 最高)
high_ret_champs = [r for r in results if r['m_mdd'] >= base_res['m_mdd']]
high_ret_champs.sort(key=lambda x: x['cagr'], reverse=True)
print(f"\n🚀 【3. 極致獲利推進冠軍 (不放大回撤下 CAGR 最高)】")
for idx, r in enumerate(high_ret_champs[:6], 1):
    print(f"  #{idx}: {r['label']}")
    print(f"       CAGR: {r['cagr']}% ({r['cagr']-base_res['cagr']:+.2f}%) | 月MDD: {r['m_mdd']}% ({r['m_mdd']-base_res['m_mdd']:+.2f}%) | 日MDD: {r['d_mdd']}% ({r['d_mdd']-base_res['d_mdd']:+.2f}%) | 月Calmar: {r['calmar_m']} | 日Calmar: {r['calmar_d']} | Sharpe: {r['sharpe']} | Sortino: {r['sortino']} | 倍數: {r['mult']}x | OOS_CAGR: {r['oos_cagr']}%")
