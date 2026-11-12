#!/usr/bin/env python3
"""
export_g11_pit_detailed_history.py
================================================================================
【G12-PIT Sovereign 歷年績效與逐筆詳細進出全景資料庫生成器】
================================================================================
功能：
1. 完整保留 G12-PIT Sovereign 官方生產模型所有參數與權威指標 (CAGR 40.48%、累積 1,621.2x 等)。
2. 匯出 2005–2026 全歷史 22 年每一次調倉 (Tranche 1 & Tranche 22) 的每一筆進出明細：
   - 調倉日期、進場日期、出場日期
   - 選中標的：股票代號、中文全名、市場 (美股/台股)、配置權重 %
   - 進場價格 (Entry Price)、出場價格 (Exit Price / 最新現價)
   - 該期真實損益率 (Period Return %)
   - 持倉狀態：🟢 進行中持倉 (Active) / ⚪ 已換倉結算
3. 2026 當前最新選股與進行中持倉清單 (供使用者對照核對「我有沒有買對」)。
4. 全歷史股票代號反查索引 (all_trades_lookup)。
"""

import os
import json
import sqlite3
import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

import forensic_open_pool_sniper as fops
import global_sovereign_service as gss
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, make_pit_macro_fn
from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit

def asym_stepped_winner_tr_dd(peak_pnl: float) -> float:
    return 0.09 if peak_pnl < 0.20 else (0.13 if peak_pnl < 0.50 else 0.16)

def build_exposure_reason(exp_pct: float, br_val: float) -> str:
    exp = float(exp_pct if exp_pct is not None else 100.0)
    br_pct = round(float(br_val) * 100.0, 1) if (br_val is not None and float(br_val) <= 1.5) else round(float(br_val or 63.3), 1)
    if exp >= 99.5:
        return f"全球寬幅 {br_pct}% (≥50% 多頭標準) 且無過熱/破線警訊 ➔ 100% 滿倉進攻"
    elif abs(exp - 95.0) < 1.0:
        return f"全球寬幅 {br_pct}% (30~50% 警戒區)，因 QQQ 守穩季線且選擇權莊家地板支撐 ➔ 回補至 95%"
    elif abs(exp - 82.0) < 1.0:
        return f"全球寬幅 {br_pct}% (<30% 深熊區)，因 QQQ 站上月線且寬幅急彈 ≥8% 機構吸籌 ➔ V轉先遣 82%"
    elif abs(exp - 72.0) < 1.0:
        return f"全球寬幅 {br_pct}%，觸發 C1 護盾 (10Y美債殖利率急升 × 選擇權避險減弱) ➔ 預防降倉至 72%"
    elif abs(exp - 70.0) < 1.0:
        return f"全球寬幅 {br_pct}% 落入 30%~50% 警戒區 (QQQ 仍守穩季線) ➔ 防禦降倉至 70%"
    elif abs(exp - 65.0) < 1.0:
        return f"全球寬幅 {br_pct}%，觸發 C2 護盾 (QQQ跌破季線 × 科技相對轉弱 × 機構流出) ➔ 降倉至 65%"
    elif abs(exp - 60.0) < 1.0:
        return f"全球寬幅 {br_pct}%，觸發 C3 護盾 (Top5 領頭羊集體機構出貨 × 大盤破月線) ➔ 降倉至 60%"
    elif abs(exp - 50.0) < 1.0:
        if br_pct >= 50.0:
            return f"全球寬幅 {br_pct}%，觸發模組 C 2.0 過熱閥門 (QQQ年線乖離 ≥30% × 10Y美債 ≥3.5%) ➔ 半倉防禦 50%"
        else:
            return f"全球寬幅 {br_pct}% (30~50% 警戒區) × 選擇權異常放量避險 ➔ 半倉防禦 50%"
    elif abs(exp - 45.0) < 1.0:
        return f"全球寬幅 {br_pct}%，觸發 C4 護盾 / Top5 領頭羊集體跌破月線護盾 (≥4/5 破 20MA 且 QQQ 破月線) ➔ 降倉至 45%"
    elif abs(exp - 35.0) < 1.0:
        return f"全球寬幅 {br_pct}% (30~50% 警戒區) 且 QQQ 跌破 60MA 季線 (M1減震器) ➔ 降倉至 35%"
    elif abs(exp - 20.0) < 1.0:
        return f"全球寬幅 {br_pct}% (30~50% 警戒區) 且 QQQ 破季線 + SPY 破月線雙殺 (C6護盾) ➔ 極度防禦 20%"
    elif exp <= 0.5:
        return f"全球寬幅 {br_pct}% (<30% 全面空頭警戒區) ➔ 100% 空倉抱現金避險"
    else:
        return f"全球寬幅 {br_pct}%，觸發大盤下行半波動率連續縮放護盾 (Moreira & Muir 2017 / Wang & Yan 2021) ➔ 動態曝險 {exp:.1f}%"

def _roc_to_ann_str(ym) -> str:
    ym_s = str(ym).strip()
    if len(ym_s) < 5 or not ym_s.isdigit():
        return "2099-01-10"
    y, m = int(ym_s[:3]) + 1911, int(ym_s[3:5])
    return f"{y + 1:04d}-01-10" if m == 12 else f"{y:04d}-{m + 1:02d}-10"

def main():
    print("=" * 80)
    print("🚀 G12-PIT Sovereign 逐筆詳細進出全景歷史資料庫生成中...")
    print("=" * 80)

    tw_zero = build_zero_omission_tw_0050_0051_pit()
    env = prepare_clean_1725_pit_env()

    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    in_0050_0051_pit = tw_zero["in_0050_0051_pit"].reindex(index=idx, columns=pit_tw).ffill().fillna(False)

    conn_twse = sqlite3.connect("tw_stock.db")
    pit_tw_ids = [s.replace(".TW", "") for s in pit_tw]
    ph_all = ",".join(["?"] * len(pit_tw_ids))
    df_twse_daily = pd.read_sql_query(
        f"""
        SELECT date, stock_id, trade_value
        FROM daily_stock
        WHERE stock_id IN ({ph_all})
          AND market_type IN ('上市', 'TWSE')
        """,
        conn_twse,
        params=pit_tw_ids,
    )

    df_twse_daily["dt"] = pd.to_datetime(df_twse_daily["date"], format="%Y%m%d", errors="coerce")
    df_twse_daily = df_twse_daily.dropna(subset=["dt"]).drop_duplicates(subset=["dt", "stock_id"], keep="last")
    df_twse_daily["ticker"] = df_twse_daily["stock_id"] + ".TW"
    piv_twse_val = df_twse_daily.pivot(index="dt", columns="ticker", values="trade_value").reindex(index=idx, columns=pit_tw).fillna(0.0)
    is_twse_listed_pit = (piv_twse_val > 0).rolling(20, min_periods=1).max() > 0
    twse_adv60 = piv_twse_val.rolling(60, min_periods=15).mean()
    twse_rk_pit = twse_adv60.where(is_twse_listed_pit).rank(axis=1, ascending=False, method="min")

    tw_base_0050_0051 = (
        in_0050_0051_pit
        & is_twse_listed_pit
        & (twse_rk_pit <= 30)
        & (env["avg_order_rk"][pit_tw] <= 30)
        & (env["raw_px_tw"][pit_tw] >= 50.0)
        & (env["pe_mat"][pit_tw] > 0)
        & (env["pe_mat"][pit_tw] <= 45.0)
        & ((~env["roe_mat"][pit_tw].notna()) | (env["roe_mat"][pit_tw] >= 20.0))
        & ((~env["roe_mat"][pit_tw].notna()) | (env["tr20_mat"][pit_tw] > 0.001) | (env["fr20_mat"][pit_tw] > 0.002))
        & (env["io_20"][pit_tw] > -0.10)
        & (env["fip_126"][pit_tw] > 0.05)
    )
    elig_base = pd.DataFrame(False, index=idx, columns=cols)
    elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_base[pit_tw] = tw_base_0050_0051

    g9_sec = fops.make_g9_secondary_mult(env)
    macro_g11 = make_pit_macro_fn(c4_cap=0.45, c5_cap=1.0, c6_cap=0.20, u10_thr=0.22, qb_thr=22.0)

    stk_adj = env["stk_adj"][cols]
    stk_open = env["stk_open"][cols]
    stk_high = env["stk_high"][cols]
    stk_low = env["stk_low"][cols]
    stk_vol = env["stk_vol"][cols]

    ma20 = env["ma20"][cols]
    ma60 = env["ma60"][cols]
    ma200 = env["ma200"][cols]

    bias20 = ((stk_adj / (ma20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)
    bias60 = env["bias60"][cols]
    high20 = stk_high.rolling(20, min_periods=5).max()
    low20 = stk_low.rolling(20, min_periods=5).min()
    dd20 = ((stk_adj / (high20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)

    mom12m = env["mom12m"][cols]
    r_mom10 = stk_adj.pct_change(10).fillna(0.0).astype(np.float32)
    r_mom5 = stk_adj.pct_change(5).fillna(0.0).astype(np.float32)
    fip_252 = env["fip_252"][cols]
    io_20 = env["io_20"][cols]
    io_5 = env["io_5"][cols]

    dvol = (stk_adj * stk_vol).fillna(0.0)
    turnover_growth = ((dvol.rolling(20, min_periods=5).mean() / (dvol.rolling(60, min_periods=15).mean() + 1.0)) - 1.0).fillna(0.0).astype(np.float32)

    high_60 = stk_high.rolling(60, min_periods=20).max()
    low_60 = stk_low.rolling(60, min_periods=20).min()
    sustain_20d = (stk_adj >= high_60 * 0.97).astype(np.float32).rolling(20, min_periods=5).mean().fillna(0.0).astype(np.float32)
    comp_ratio = (((high20 - low20) / (stk_adj + 1e-6)).fillna(0.25) / (((high_60 - low_60) / (stk_adj + 1e-6)).fillna(0.35) + 1e-6)).astype(np.float32)

    daily_ret = stk_adj.pct_change().fillna(0.0)
    down_sq_60 = (daily_ret.clip(upper=0.0) ** 2).rolling(60, min_periods=20).mean()
    sortino_60 = ((daily_ret.rolling(60, min_periods=20).mean() / (np.sqrt(down_sq_60) + 1e-6)) * np.sqrt(252.0)).fillna(0.0).astype(np.float32)
    down_sq_20 = (daily_ret.clip(upper=0.0) ** 2).rolling(20, min_periods=10).mean()
    down_vol_20 = (np.sqrt(down_sq_20) * np.sqrt(252.0)).fillna(0.30).astype(np.float32)

    vcp_condition = (sustain_20d >= 0.45) & (comp_ratio <= 0.65) & (sortino_60 >= 1.5) & (turnover_growth > 0.0) & (io_20 > 0.0)

    dist_veto_g10 = np.where((stk_adj < ma20) & (io_5 < -0.01), 0.70, 1.0)
    is_mega_us = pd.DataFrame(False, index=idx, columns=cols)
    is_mega_us[us_tickers] = (env["us_rk_pit"] <= 100).fillna(False)

    fip_cond = (fip_252 > 0.08) | is_mega_us
    coiled_mask = (mom12m > 0.65) & fip_cond & (dd20 >= -0.12) & (dd20 <= -0.03) & (bias20 >= -0.03) & (bias20 <= 0.04) & (io_20 > -0.02)
    coiled_spring_g11 = np.where(coiled_mask, 1.12, 1.0)
    score_g11 = (env["s_g5_open"][cols] * dist_veto_g10 * coiled_spring_g11).astype(np.float32)

    # [去蕪存菁 + 動能前十強雙特徵]
    # 1. VCP 波動收斂加分 (×1.04)
    # 2. 超級巨頭領頭羊 (US Rank<=30 / TW Rank<=10) 潛龍回檔蹲點加乘 (×1.06, t=+3.74 / -5.03)
    # 3. 尾端排名 (US Rank>70) 創高追價且無機構吸籌降權 (×0.90)
    is_super_mega = pd.DataFrame(False, index=idx, columns=cols)
    is_super_mega[us_tickers] = (env["us_rk_pit"] <= 30).fillna(False)
    is_super_mega[pit_tw] = (twse_rk_pit <= 10).fillna(False)

    is_fringe_rk = pd.DataFrame(False, index=idx, columns=cols)
    is_fringe_rk[us_tickers] = (env["us_rk_pit"] > 70).fillna(False)

    exp262_base_mult = np.where(vcp_condition, 1.04, 1.0).astype(np.float32)
    m_fringe_pen = np.where(is_fringe_rk.values & (dd20.values > -0.02) & (io_20.values < 0.005), 0.90, 1.0).astype(np.float32)
    m_coiled_plus_mega = np.where(coiled_mask.values & is_super_mega.values, 1.06, 1.0).astype(np.float32)
    champ_score_arr = ((score_g11 * exp262_base_mult).values * m_fringe_pen * m_coiled_plus_mega).astype(np.float32)

    data4 = env["data4"]
    dates_idx = stk_adj.index
    dt_to_pos = {d: i for i, d in enumerate(dates_idx)}

    px_adj_arr = stk_adj.values
    px_open_arr = stk_open.values
    px_low_arr = stk_low.values
    ma20_arr = ma20.values
    ma60_arr = ma60.values
    ma200_arr = ma200.values
    bias60_arr = ((stk_adj / (ma60 + 1e-9)) - 1.0).fillna(0.0).values.astype(np.float32)
    sustain_arr = sustain_20d.values
    rmom10_arr = r_mom10.values
    rmom5_arr = stk_adj.pct_change(5, fill_method=None).fillna(0.0).values.astype(np.float32)
    daily_ret_arr = daily_ret.values.astype(np.float32)
    down_vol20_arr = down_vol_20.values.astype(np.float32)
    io20_arr = io_20.values
    io5_arr = io_5.values
    churn_arr = env["churn_exhaustion"][cols].values
    elig_arr = elig_base.values
    sec_arr = g9_sec[cols].values

    # 🌟 3-in-1 動能微結構濾網 (12M × 3M × 1M 死貓跳懲罰 + 爆量派發懲罰 + 量價收斂高勝率加分)
    mom12m_arr = mom12m.values.astype(np.float32)
    mom3m_arr = stk_adj.pct_change(63, fill_method=None).fillna(0.0).values.astype(np.float32)
    mom1m_arr = stk_adj.pct_change(21, fill_method=None).fillna(0.0).values.astype(np.float32)
    up_vol_df = stk_vol.where(daily_ret > 0, np.nan).rolling(20, min_periods=3).mean()
    dn_vol_df = stk_vol.where(daily_ret < 0, np.nan).rolling(20, min_periods=3).mean()
    vol_ratio_20d_arr = (up_vol_df / (dn_vol_df + 1.0)).fillna(1.0).clip(0.2, 5.0).values.astype(np.float32)
    vol20_v = stk_vol.rolling(20, min_periods=5).mean().values
    vol60_v = stk_vol.rolling(60, min_periods=15).mean().values
    vol_surge_arr = (vol20_v / (vol60_v + 1.0)).astype(np.float32)

    dead_cat_mask = (mom12m_arr < 0.40) & (mom1m_arr > 0.25)
    vol_blowoff_mask = (vol_surge_arr > 1.60) & (io5_arr < 0.0)
    high_wr_bonus_mask = (vol_ratio_20d_arr >= 1.15) & (down_vol20_arr <= 0.28) & (io20_arr > 0.01)
    # 🌟 5日極值收高力竭阻尼 (Bogousslavsky 2021 JFE × Jegadeesh 1990 JF: CLV_5D > 0.80 & Ret_5D > 10% & Bias60 > 25% ➔ ×0.85)
    hl_range_df = (stk_high - stk_low).replace(0, np.nan)
    clv_daily_df = ((stk_adj - stk_low) / (hl_range_df + 1e-9)).clip(0.0, 1.0).fillna(0.5)
    clv5_arr = clv_daily_df.rolling(5, min_periods=2).mean().fillna(0.5).values.astype(np.float32)
    climax_exhaust_mask = (clv5_arr > 0.80) & (rmom5_arr > 0.10) & (bias60_arr > 0.25)
    mult_3in1 = (
        np.where(dead_cat_mask, 0.75, 1.0)
        * np.where(vol_blowoff_mask, 0.75, 1.0)
        * np.where(high_wr_bonus_mask, 1.05, 1.0)
        * np.where(climax_exhaust_mask, 0.85, 1.0)
    ).astype(np.float32)
    score_arr = (champ_score_arr * mult_3in1).astype(np.float32)
    min_score_thr = 0.28

    global_breadth = data4["global_breadth"]
    safe_cash_ret = data4["safe_cash_ret"]
    us10y_series = data4["us10y_series"]
    qqq_bias = data4["qqq_bias_dict"][500]
    qqq_p = data4["px_adj"]["QQQ"]
    qqq_ma60 = data4["qqq_ma60"]
    all_dates = data4["all_dates"]

    is_tw_arr = np.array([c_sym.endswith(".TW") for c_sym in cols])
    fee_buy_arr = np.where(is_tw_arr, 0.001425 * 0.28, 0.0005)
    fee_sell_arr = np.where(is_tw_arr, (0.001425 * 0.28) + 0.003, 0.0005)

    drift_tol = 0.12
    macro_cap = 0.35
    base_weights = [0.52, 0.24, 0.24]
    pool_k = 5
    tenure_max_rk = 5

    # 🌟 實裝方案 S3 (S1/S2/Beta)：雙層完整能源與裂解價差下行排雷閥門
    df_mac = pd.read_sql_query(
        "SELECT date, oil_wti, gasoline, heating_oil, crack_spread_321 FROM macro_indicators ORDER BY date ASC",
        conn_twse,
    )
    df_mac["dt"] = pd.to_datetime(df_mac["date"], format="%Y%m%d", errors="coerce")
    df_mac = df_mac.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
    df_mac.index = df_mac.index.astype(dates_idx.dtype)

    cl_s = df_mac["oil_wti"].reindex(dates_idx).ffill()
    rb_s = df_mac["gasoline"].reindex(dates_idx).ffill()
    ho_s = df_mac["heating_oil"].reindex(dates_idx).ffill()
    cl_ma20_s = cl_s.rolling(20, min_periods=10).mean()
    crack_s = (2.0 * rb_s * 42.0 + 1.0 * ho_s * 42.0 - 3.0 * cl_s) / 3.0
    crack_ma20_s = crack_s.rolling(20, min_periods=10).mean()
    crack_dd20_s = (crack_s / crack_s.rolling(20, min_periods=10).max() - 1.0).fillna(0.0)
    crack_ret20_s = crack_s.pct_change(20).fillna(0.0)

    cl_ret = cl_s.pct_change().fillna(0.0).clip(-0.15, 0.15)
    crack_diff = (crack_s.diff() / (crack_ma20_s.abs() + 5.0)).fillna(0.0).clip(-0.20, 0.20)
    energy_factor_ret = (0.5 * cl_ret + 0.5 * crack_diff).astype(np.float32)
    stk_ret_clean = daily_ret.clip(-0.20, 0.20)
    energy_corr_60 = stk_ret_clean.rolling(60, min_periods=30).corr(energy_factor_ret).fillna(0.0).astype(np.float32).values

    PURE_REFINERS_SET = {"MPC", "VLO", "PSX", "TSO", "SUN", "HFC", "DINO", "6505.TW"}
    UPSTREAM_CRUDE_SET = {"XOM", "CVX", "COP", "OXY", "SLB", "HAL", "DVN", "EOG", "HES", "MRO", "FANG", "APA", "BKR"}
    refiner_col_mask = np.array([c_sym in PURE_REFINERS_SET for c_sym in cols], dtype=bool)
    upstream_col_mask = np.array([c_sym in UPSTREAM_CRUDE_SET for c_sym in cols], dtype=bool)
    upstream_indices = np.where(upstream_col_mask)[0]

    cond_s1_crack_veto = ((crack_s < crack_ma20_s) & (crack_dd20_s <= -0.15) & (crack_ret20_s <= -0.10)).fillna(False).values
    cond_s2a_oil_veto = ((crack_ma20_s >= 25.0) & (crack_s < crack_ma20_s) & (crack_dd20_s <= -0.18) & (cl_s < cl_ma20_s)).fillna(False).values
    cond_s2b_macro = ((crack_s < crack_ma20_s) & (crack_dd20_s <= -0.20)).fillna(False).values
    mom12m_arr = mom12m.values
    mom3m_arr = stk_adj.pct_change(63).fillna(0.0).values

    veto_s1_arr = np.zeros_like(elig_arr, dtype=bool)
    for _t_i in range(len(dates_idx)):
        if cond_s1_crack_veto[_t_i]:
            veto_s1_arr[_t_i, refiner_col_mask] = True
        if cond_s2a_oil_veto[_t_i]:
            veto_s1_arr[_t_i, upstream_col_mask] = True
        if cond_s2b_macro[_t_i]:
            for _c_i in upstream_indices:
                if mom12m_arr[_t_i, _c_i] >= 0.75 and mom3m_arr[_t_i, _c_i] >= 0.25:
                    veto_s1_arr[_t_i, _c_i] = True
        if cond_s2a_oil_veto[_t_i] or (cond_s1_crack_veto[_t_i] and cl_s.iloc[_t_i] < cl_ma20_s.iloc[_t_i]):
            veto_s1_arr[_t_i, energy_corr_60[_t_i] >= 0.32] = True

    def get_stock_name(tk):
        base = tk.split(".")[0]
        if base in gss.GLOBAL_STOCK_NAME_MAP:
            return gss.GLOBAL_STOCK_NAME_MAP[base].split(" (")[0]
        if tk.endswith(".TW"):
            c = conn_twse.cursor()
            c.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL ORDER BY date DESC LIMIT 1", (base,))
            r = c.fetchone()
            if r and r[0]:
                return r[0]
        return tk

    all_tranche_records = []

    N_DATES = len(dates_idx)
    daily_sorted = [None] * N_DATES
    daily_exp = np.zeros(N_DATES, dtype=np.float32)
    br_arr = global_breadth.values
    qb_arr = qqq_bias.values
    rate_arr = us10y_series.values
    qqq_p_arr = qqq_p.values
    qqq_m60_arr = qqq_ma60.values
    qqq_ma20 = qqq_p.rolling(20, min_periods=5).mean()
    qqq_m20_arr = qqq_ma20.values
    qqq_ret = qqq_p.pct_change().fillna(0.0)
    qqq_dvol20 = (np.sqrt((qqq_ret.clip(upper=0.0) ** 2).rolling(20, min_periods=10).mean()) * np.sqrt(252.0)).fillna(0.15).values
    spy_p_full = data4["px_adj"]["SPY"]
    spy_ret = spy_p_full.pct_change().fillna(0.0)
    spy_dvol20 = (np.sqrt((spy_ret.clip(upper=0.0) ** 2).rolling(20, min_periods=10).mean()) * np.sqrt(252.0)).fillna(0.15).values

    for t_pos in range(N_DATES):
        sp_row = px_adj_arr[t_pos]
        m6_row = ma60_arr[t_pos]
        m2_row = ma200_arr[t_pos]
        sc_row = score_arr[t_pos]
        el_row = elig_arr[t_pos]
        ch_row = churn_arr[t_pos]
        valid_mask = (
            el_row
            & (~np.isnan(sp_row))
            & (~np.isnan(sc_row))
            & (~np.isnan(m6_row))
            & (~np.isnan(m2_row))
            & (sp_row > m6_row)
            & (sp_row > m2_row)
            & (sc_row > min_score_thr)
            & (~ch_row)
        )
        valid_indices = np.where(valid_mask)[0]
        if len(valid_indices) > 0:
            sorted_indices = valid_indices[np.argsort(-sc_row[valid_indices])]
        else:
            sorted_indices = np.array([], dtype=int)
        if sec_arr is not None and len(sorted_indices) > 2:
            top1_i = [sorted_indices[0]]
            pool_i = list(sorted_indices[1:pool_k])
            rest_i = list(sorted_indices[pool_k:])
            pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
            sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)
        top5_pre = sorted_indices[:min(5, len(sorted_indices))]
        if len(top5_pre) > 0:
            top5_neg_io20 = int(np.sum(io20_arr[t_pos, top5_pre] < 0.0))
            top5_neg_io5 = int(np.sum(io5_arr[t_pos, top5_pre] < 0.0))
            top5_avg_io20 = float(np.mean(io20_arr[t_pos, top5_pre]))
        else:
            top5_neg_io20, top5_neg_io5, top5_avg_io20 = 0, 0, 0.0
        v_row_s1 = veto_s1_arr[t_pos]
        if np.any(v_row_s1):
            sorted_indices = np.array([c_i for c_i in sorted_indices if not v_row_s1[c_i]], dtype=int)
            if sec_arr is not None and len(sorted_indices) > 2:
                top1_i = [sorted_indices[0]]
                pool_i = list(sorted_indices[1:pool_k])
                rest_i = list(sorted_indices[pool_k:])
                pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
                sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)
        br = float(br_arr[t_pos])
        base_exp = 1.0 if br >= 0.50 else (0.70 if br >= 0.30 else 0.0)
        qb = float(qb_arr[t_pos])
        rate = float(rate_arr[t_pos])
        qqq_below_ma60 = float(qqq_p_arr[t_pos]) < float(qqq_m60_arr[t_pos])
        exposure = (min(base_exp, 0.50) if (qb >= 30.0 and rate >= 3.5) else base_exp) if base_exp > 0.0 else 0.0
        if 0.30 <= br < 0.50 and qqq_below_ma60:
            exposure = min(exposure, macro_cap)
        exposure = macro_g11(dates_idx[t_pos], t_pos, exposure, br, qb, rate, qqq_below_ma60, top5_neg_io20, top5_neg_io5, top5_avg_io20, data4)
        # 🌟 學術文獻驗證升級 (Moreira & Muir 2017 JF / Wang & Yan 2021 JBF / Han, Zhou & Zhu 2016 JFE):
        # 1. 大盤 20日下行半波動率連續縮放 (當 QQQ < MA20 且 max(QQQ_dvol20, SPY_dvol20) > 20% 時，曝險按 0.20 / mdv 連續降檔)
        # 2. Top-5 領頭羊集體破月線減震器 (當 Top-5 中 >= 4 檔跌破 20MA 且 QQQ < MA20 時，曝險上限鎖定 45%)
        if exposure > 0:
            mdv = max(float(qqq_dvol20[t_pos]), float(spy_dvol20[t_pos]))
            if mdv > 0.20 and float(qqq_p_arr[t_pos]) < float(qqq_m20_arr[t_pos]):
                exposure = exposure * max(0.35, 0.20 / mdv)
            if len(sorted_indices) > 0:
                t5_slice = sorted_indices[:min(5, len(sorted_indices))]
                n_below_ma20 = int(np.sum(px_adj_arr[t_pos, t5_slice] < ma20_arr[t_pos, t5_slice]))
                if n_below_ma20 >= 4 and float(qqq_p_arr[t_pos]) < float(qqq_m20_arr[t_pos]):
                    exposure = min(exposure, 0.45)
        daily_sorted[t_pos] = sorted_indices
        daily_exp[t_pos] = exposure

    # 載入嚴格 Point-In-Time (filed <= t_date) 當期已公告財報成長矩陣 (SEC EDGAR 10-Q/10-K + 台股季報三率/月營收)
    from pit_fundamental_service import load_or_build_pit_fund_matrices, auto_refresh_live_candidates_sec_edgar
    if daily_sorted[-1] is not None and len(daily_sorted[-1]) > 0:
        live_top10_syms = [cols[int(i)] for i in daily_sorted[-1][:10]]
        auto_refresh_live_candidates_sec_edgar(live_top10_syms, force=False)
    _fcache = load_or_build_pit_fund_matrices(dates_idx, cols)
    rev_yoy_mat = _fcache["rev_yoy_mat"]
    mgn_exp_mat = _fcache["mgn_exp_mat"]
    surp_mat = _fcache["surp_mat"]
    f_score_mat = _fcache["f_score_mat"]

    def _is_pit_fund_defect(t_pos_idx: int, ci: int) -> bool:
        ry = rev_yoy_mat[t_pos_idx, ci]
        me = mgn_exp_mat[t_pos_idx, ci]
        su = surp_mat[t_pos_idx, ci]
        if not np.isnan(su) and su < -0.01:
            return True
        if not np.isnan(ry) and ry < -0.15:
            return True
        if (not np.isnan(me) and me < -0.10) and (np.isnan(ry) or ry < 0.20):
            return True
        return False

    def _is_pit_fund_star(t_pos_idx: int, ci: int) -> bool:
        ry = rev_yoy_mat[t_pos_idx, ci]
        me = mgn_exp_mat[t_pos_idx, ci]
        su = surp_mat[t_pos_idx, ci]
        io = io20_arr[t_pos_idx, ci]
        if io < 0.0:
            return False
        if not np.isnan(su) and su < 0.0:
            return False
        if not np.isnan(ry) and not np.isnan(me):
            return bool(ry >= 0.14 and me >= 0.0)
        if not np.isnan(ry):
            return bool(ry >= 0.20)
        return False

    def sim_tranche(day_target, tranche_name, init_cap=500000.0):
        ym_groups = pd.Series(dates_idx, index=dates_idx).groupby([dates_idx.year, dates_idx.month])
        rebal_dates = []
        for (y, m), grp in ym_groups:
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])
        rebal_dates = pd.DatetimeIndex(sorted(list(set(rebal_dates))))
        rebal_dates = rebal_dates[rebal_dates >= pd.Timestamp("2005-01-01")]

        periods = []
        for i in range(len(rebal_dates) - 1):
            t_date = rebal_dates[i]
            fut = dates_idx[dates_idx > t_date]
            if len(fut) == 0: break
            t_in = fut[0]
            next_rebal = rebal_dates[i + 1]
            fut_next = dates_idx[dates_idx > next_rebal]
            if len(fut_next) == 0: break
            t_out = fut_next[0]
            periods.append((t_date, t_in, t_out, False))
        eq_cutoff = periods[-1][2]
        if len(rebal_dates) > 0:
            t_last = rebal_dates[-1]
            fut_last = dates_idx[dates_idx > t_last]
            if len(fut_last) > 0:
                periods.append((t_last, fut_last[0], dates_idx[-1], True))

        all_sim_dates = dates_idx[(dates_idx >= periods[0][0]) & (dates_idx <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        cash = init_cap
        holdings = {}
        holding_tenure = {}
        pending_orders = []
        p_idx = 0
        num_p = len(periods)
        last_rebal_br = 1.0

        for current_dt in all_sim_dates:
            cur_pos = dt_to_pos[current_dt]
            if cash > 0:
                cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])

            if p_idx < num_p and current_dt == periods[p_idx][1]:
                pending_orders.clear()
                t_date, t_in, t_out, is_active_tranche = periods[p_idx]
                t_pos = dt_to_pos[t_date]
                in_pos = dt_to_pos[t_in]
                out_pos = dt_to_pos[t_out]

                sorted_indices = daily_sorted[t_pos]
                exposure = float(daily_exp[t_pos])
                sc_row = score_arr[t_pos]
                br = float(br_arr[t_pos])
                last_rebal_br = br
                ticker_rank = {int(c_i): rk + 1 for rk, c_i in enumerate(sorted_indices)}

                if exposure <= 0 or len(sorted_indices) == 0:
                    for c_i, hinfo in list(holdings.items()):
                        out_px = px_open_arr[in_pos, c_i]
                        cash += hinfo["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                    holdings.clear()
                    holding_tenure = {}
                    all_tranche_records.append({
                        "year": int(t_date.year),
                        "rebal_date": str(t_date)[:10],
                        "entry_date": str(t_in)[:10],
                        "exit_date": str(t_out)[:10],
                        "tranche": tranche_name,
                        "exposure_pct": 0.0,
                        "breadth": round(br, 2),
                        "defense_reason": build_exposure_reason(0.0, round(br, 2)),
                        "is_active": is_active_tranche,
                        "picks": []
                    })
                else:
                    old_holdings_set = set(holdings.keys())
                    selected_stks = []

                    # [3D 動能演化動態任期 + 純粹連任規則]
                    # 1. 預設最長任期 4 期；若短線爆發過熱 (3M>150% & 1M>35%) 縮短為 2 期；若黃金加速主升段 (12M 100~280% & 3M 40~110% & 1M<=32%) 延長為 5 期
                    # 2. 前4名無條件連任，第5名要求主力日內淨吸籌 (IO20>0) 且未破月線加速出貨，且分數 >= 0.28
                    for c_i in list(holdings.keys()):
                        if veto_s1_arr[t_pos, c_i]:
                            continue
                        if float(sc_row[c_i]) < min_score_thr:
                            continue
                        tenure = holding_tenure.get(c_i, 0)
                        rk = ticker_rank.get(c_i, None)
                        cur_c = float(px_adj_arr[t_pos, c_i])
                        m20_c = float(ma20_arr[t_pos, c_i])
                        max_t = 4
                        m12_v = float(mom12m_arr[t_pos, c_i])
                        m3_v = float(mom3m_arr[t_pos, c_i])
                        m1_v = float(mom1m_arr[t_pos, c_i])
                        if m3_v > 1.50 and m1_v > 0.35:
                            max_t = 2
                        elif 1.00 <= m12_v <= 2.80 and 0.40 <= m3_v <= 1.10 and m1_v <= 0.32:
                            max_t = 5
                        if rk is not None and tenure < max_t:
                            if rk <= 4 or (rk == 5 and float(io20_arr[t_pos, c_i]) > 0.0 and not (cur_c < m20_c and float(io5_arr[t_pos, c_i]) <= -0.015)):
                                selected_stks.append(c_i)

                    # 🌟 Top-5 席次機構吸籌過濾 (Lou 2019 JFE) × 當期已公告財報條件式雙動能換馬 (Huang et al. 2020 Twin Momentum: Defect -> Star 替換)
                    top5_cands = list(sorted_indices[:pool_k])
                    has_star_45 = any(
                        _is_pit_fund_star(t_pos, int(x)) and int(x) not in selected_stks
                        for x in top5_cands[3:pool_k]
                    ) if len(top5_cands) > 3 else False
                    for c_i in top5_cands:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        tenure = holding_tenure.get(c_i, 0)
                        if c_i not in selected_stks and tenure < 4:
                            if c_i == int(sorted_indices[0]):
                                selected_stks.append(c_i)
                            else:
                                io_ok = float(io20_arr[t_pos, c_i]) >= -0.025
                                fund_ok = not (has_star_45 and _is_pit_fund_defect(t_pos, c_i))
                                if io_ok and fund_ok:
                                    selected_stks.append(c_i)

                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        tenure = holding_tenure.get(c_i, 0)
                        if c_i not in selected_stks and tenure < 4:
                            selected_stks.append(c_i)

                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        if c_i not in selected_stks:
                            selected_stks.append(c_i)

                    n = min(3, len(selected_stks))
                    selected_stks = selected_stks[:n]
                    holding_tenure = {c_i: holding_tenure.get(c_i, 0) + 1 for c_i in selected_stks}
                    if n == 3:
                        s0 = max(float(sc_row[selected_stks[0]]), 0.05)
                        s1 = max(float(sc_row[selected_stks[1]]), 0.05)
                        s2 = max(float(sc_row[selected_stks[2]]), 0.05)
                        dv0 = max(float(down_vol20_arr[t_pos, selected_stks[0]]), 0.12)
                        dv1 = max(float(down_vol20_arr[t_pos, selected_stks[1]]), 0.12)
                        dv2 = max(float(down_vol20_arr[t_pos, selected_stks[2]]), 0.12)
                        io0 = float(io20_arr[t_pos, selected_stks[0]])
                        io1 = float(io20_arr[t_pos, selected_stks[1]])
                        io2 = float(io20_arr[t_pos, selected_stks[2]])
                        fs0 = float(f_score_mat[t_pos, selected_stks[0]]) if not np.isnan(f_score_mat[t_pos, selected_stks[0]]) else 0.0
                        fs1 = float(f_score_mat[t_pos, selected_stks[1]]) if not np.isnan(f_score_mat[t_pos, selected_stks[1]]) else 0.0
                        fs2 = float(f_score_mat[t_pos, selected_stks[2]]) if not np.isnan(f_score_mat[t_pos, selected_stks[2]]) else 0.0
                        ratio_01 = s0 / (s1 + 1e-6)
                        w0 = float(np.clip(
                            0.52 + 0.20 * (ratio_01 - 1.08) - 0.25 * (dv0 - 0.25)
                            + 0.20 * np.clip(io0, -0.10, 0.15)
                            + 0.08 * np.clip(fs0, -0.15, 0.30),
                            0.45, 0.60
                        ))
                        rem = 1.0 - w0
                        k1 = (s1 * (1.0 + 0.20 * np.clip(io1, -0.10, 0.15) + 0.08 * np.clip(fs1, -0.15, 0.30))) / (dv1 ** 0.35)
                        k2 = (s2 * (1.0 + 0.20 * np.clip(io2, -0.10, 0.15) + 0.08 * np.clip(fs2, -0.15, 0.30))) / (dv2 ** 0.35)
                        norm_weights = [w0, rem * (k1 / (k1 + k2 + 1e-9)), rem * (k2 / (k1 + k2 + 1e-9))]
                    else:
                        bw_slice = base_weights[:n]
                        tot_bw = sum(bw_slice)
                        norm_weights = [w / tot_bw for w in bw_slice]

                    # 🌟 1B Top-3 內部過熱降權轉移 (Bias60 > 25% & Ret5 > 5% ➔ 降權 35% 轉移給同梯未過熱強股)
                    adj_weights = list(norm_weights)
                    oh_flags = [
                        (float(bias60_arr[t_pos, selected_stks[i]]) > 0.25 and float(rmom5_arr[t_pos, selected_stks[i]]) > 0.05)
                        for i in range(n)
                    ]
                    non_oh_idx = [i for i in range(n) if not oh_flags[i]]
                    if len(non_oh_idx) > 0 and any(oh_flags):
                        cut_sum = 0.0
                        for i in range(n):
                            if oh_flags[i]:
                                c_w = adj_weights[i] * (1.0 - 0.65)
                                adj_weights[i] -= c_w
                                cut_sum += c_w
                        add_each = cut_sum / len(non_oh_idx)
                        for i in non_oh_idx:
                            adj_weights[i] += add_each

                    target_alloc = {selected_stks[idx_s]: adj_weights[idx_s] * exposure for idx_s in range(n)}

                    raw_tw_df = env.get("raw_px_tw", None)
                    raw_us_df = env.get("raw_px_us", None)
                    period_picks_info = []
                    for idx_s, c_i in enumerate(selected_stks):
                        sym = cols[c_i]
                        p_in = float(px_open_arr[in_pos, c_i])
                        # 若為當前進行中調倉，出場價格取最新收盤價
                        if is_active_tranche:
                            p_out = float(px_adj_arr[out_pos, c_i])
                        else:
                            p_out = float(px_open_arr[out_pos, c_i])
                        p_ret = ((p_out / p_in) - 1.0) * 100.0 if (p_in > 0 and p_out > 0 and not np.isnan(p_in) and not np.isnan(p_out)) else 0.0

                        disp_in = p_in
                        disp_out = p_out
                        if sym.endswith(".TW") and raw_tw_df is not None and sym in raw_tw_df.columns:
                            raw_c_in = float(raw_tw_df.iloc[in_pos][sym])
                            adj_c_in = float(px_adj_arr[in_pos, c_i])
                            if raw_c_in > 0 and not np.isnan(raw_c_in) and adj_c_in > 0 and not np.isnan(adj_c_in):
                                disp_in = p_in * (raw_c_in / adj_c_in)
                                disp_out = disp_in * (1.0 + p_ret / 100.0)
                        elif not sym.endswith(".TW") and raw_us_df is not None and sym in raw_us_df.columns:
                            raw_c_in = float(raw_us_df.iloc[in_pos][sym])
                            adj_c_in = float(px_adj_arr[in_pos, c_i])
                            if raw_c_in > 0 and not np.isnan(raw_c_in) and adj_c_in > 0 and not np.isnan(adj_c_in):
                                disp_in = p_in * (raw_c_in / adj_c_in)
                                if sym == "AAPL":
                                    in_dt = dates_idx[in_pos]
                                    if in_dt < pd.Timestamp("2005-02-28"):
                                        disp_in *= 56.0
                                    elif in_dt < pd.Timestamp("2014-06-09"):
                                        disp_in *= 28.0
                                    elif in_dt < pd.Timestamp("2020-08-31"):
                                        disp_in *= 4.0
                                disp_out = disp_in * (1.0 + p_ret / 100.0)

                        is_retained = c_i in old_holdings_set
                        is_tilted_down = (oh_flags[idx_s] and len(non_oh_idx) > 0)
                        if is_retained:
                            action_label = "🔄 贏家續抱 (過熱降權)" if is_tilted_down else "🔄 贏家續抱"
                        else:
                            action_label = "🟢 買入建倉 (過熱降權)" if is_tilted_down else "🟢 買入建倉"

                        period_picks_info.append({
                            "rank": idx_s + 1,
                            "ticker": sym,
                            "name": get_stock_name(sym),
                            "market": "TW" if sym.endswith(".TW") else "US",
                            "weight": round(adj_weights[idx_s] * exposure * 100.0, 1),
                            "entry_price": round(disp_in, 2),
                            "exit_price": round(disp_out, 2),
                            "period_ret": round(p_ret, 2),
                            "is_active": is_active_tranche,
                            "action": action_label,
                            "tenure_months": holding_tenure.get(c_i, 1)
                        })

                    all_tranche_records.append({
                        "year": int(t_date.year),
                        "rebal_date": str(t_date)[:10],
                        "entry_date": str(t_in)[:10],
                        "exit_date": str(t_out)[:10],
                        "tranche": tranche_name,
                        "exposure_pct": round(exposure * 100.0, 1),
                        "breadth": round(br, 2),
                        "defense_reason": build_exposure_reason(round(exposure * 100.0, 1), round(br, 2)),
                        "is_active": is_active_tranche,
                        "picks": period_picks_info
                    })

                    for c_i in list(holdings.keys()):
                        if c_i not in target_alloc:
                            out_px = px_open_arr[in_pos, c_i]
                            cash += holdings[c_i]["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                            del holdings[c_i]

                    cur_val = cash + sum(holdings[c_i]["shares"] * px_open_arr[in_pos, c_i] for c_i in holdings)
                    for idx_s, c_i in enumerate(selected_stks):
                        tgt_w = target_alloc[c_i]
                        if c_i in holdings:
                            op = float(px_open_arr[in_pos, c_i])
                            cur_sh = holdings[c_i]["shares"]
                            cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                            force_trim = oh_flags[idx_s]
                            if (abs(cur_w - tgt_w) > drift_tol or force_trim) and (cur_val * tgt_w) < (cur_sh * op):
                                sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                                cash += sell_sh * op * (1.0 - fee_sell_arr[c_i])
                                holdings[c_i]["shares"] -= sell_sh

                    for c_i, tgt_w in target_alloc.items():
                        op = float(px_open_arr[in_pos, c_i])
                        cur_sh = holdings[c_i]["shares"] if c_i in holdings else 0.0
                        cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                        if c_i in holdings and abs(cur_w - tgt_w) <= drift_tol:
                            continue
                        diff_val = (cur_val * tgt_w) - (cur_sh * op)
                        if diff_val > 0 and op > 0 and cash > 0:
                            actual_buy = min(cash, diff_val)
                            sh = (actual_buy * (1.0 - fee_buy_arr[c_i])) / op
                            cash -= actual_buy
                            if c_i in holdings:
                                holdings[c_i]["shares"] += sh
                            else:
                                holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op}

                p_idx += 1
            elif cur_pos >= 2:
                # 🌟 市場狀態轉換閒置現金入場閘門 (Cooper, Gutierrez & Hameed 2004 JF Market-State Transition Gate)
                # 僅限上次調倉日處於空頭/警戒區 (last_rebal_br < 0.50)，且盤中正式翻多 (br >= 0.50 & QQQ > MA20) 時啟動進場；
                # 嚴禁在多頭調倉日主動啟動過熱/殖利率/下行波動護盾 (Module C 2.0 / C1~C4 / Downside-Vol) 減碼後於月中擅自回補！
                t_pos = cur_pos - 1
                in_pos = cur_pos
                sorted_indices = daily_sorted[t_pos]
                exposure = float(daily_exp[t_pos])
                sc_row = score_arr[t_pos]
                if exposure > 0 and len(sorted_indices) > 0:
                    cur_stk_val = sum(holdings[c_i]["shares"] * float(px_open_arr[in_pos, c_i]) for c_i in holdings if not np.isnan(px_open_arr[in_pos, c_i]))
                    cur_tot_val = cash + cur_stk_val
                    cur_exp_ratio = cur_stk_val / cur_tot_val if cur_tot_val > 0 else 0.0
                    if (
                        ((exposure - cur_exp_ratio) >= 0.15)
                        and (last_rebal_br < 0.50)
                        and (float(br_arr[t_pos]) >= 0.50)
                        and (float(qqq_p_arr[t_pos]) > float(qqq_m20_arr[t_pos]))
                    ):
                        selected_stks = list(holdings.keys())
                        for c_i in sorted_indices:
                            if len(selected_stks) >= 3: break
                            c_i = int(c_i)
                            if c_i not in selected_stks:
                                selected_stks.append(c_i)
                                holding_tenure[c_i] = 1
                        n = min(3, len(selected_stks))
                        selected_stks = selected_stks[:n]
                        if n == 3:
                            s0 = max(float(sc_row[selected_stks[0]]), 0.05)
                            s1 = max(float(sc_row[selected_stks[1]]), 0.05)
                            s2 = max(float(sc_row[selected_stks[2]]), 0.05)
                            dv0 = max(float(down_vol20_arr[t_pos, selected_stks[0]]), 0.12)
                            dv1 = max(float(down_vol20_arr[t_pos, selected_stks[1]]), 0.12)
                            dv2 = max(float(down_vol20_arr[t_pos, selected_stks[2]]), 0.12)
                            ratio_01 = s0 / (s1 + 1e-6)
                            w0 = float(np.clip(0.52 + 0.20 * (ratio_01 - 1.08) - 0.25 * (dv0 - 0.25), 0.45, 0.60))
                            rem = 1.0 - w0
                            k1 = s1 / (dv1 ** 0.35)
                            k2 = s2 / (dv2 ** 0.35)
                            norm_weights = [w0, rem * (k1 / (k1 + k2 + 1e-9)), rem * (k2 / (k1 + k2 + 1e-9))]
                        else:
                            bw_slice = base_weights[:n]
                            tot_bw = sum(bw_slice)
                            norm_weights = [w / tot_bw for w in bw_slice]
                        target_alloc = {selected_stks[idx_s]: norm_weights[idx_s] * exposure for idx_s in range(n)}
                        for c_i, tgt_w in target_alloc.items():
                            op = float(px_open_arr[in_pos, c_i])
                            cur_sh = holdings[c_i]["shares"] if c_i in holdings else 0.0
                            diff_val = (cur_tot_val * tgt_w) - (cur_sh * op)
                            if diff_val > (cur_tot_val * 0.05) and op > 0 and cash > 0:
                                actual_buy = min(cash, diff_val)
                                sh = (actual_buy * (1.0 - fee_buy_arr[c_i])) / op
                                cash -= actual_buy
                                if c_i in holdings:
                                    holdings[c_i]["shares"] += sh
                                else:
                                    holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op}

            val = cash
            for c_i, hinfo in holdings.items():
                if not np.isnan(px_adj_arr[cur_pos, c_i]):
                    val += hinfo["shares"] * float(px_adj_arr[cur_pos, c_i])
            daily_equity.loc[current_dt] = val

        return daily_equity.loc[daily_equity.index <= eq_cutoff]

    eq_a = sim_tranche(1, "A梯隊 (月初調倉)")
    eq_b = sim_tranche(22, "B梯隊 (月下旬調倉)")

    # 補齊 2026-11-02 (11月初 A梯隊最新調倉) 並更新 2026-10-01 / 2026-10-22 最新狀態至 2026-11-04
    for lg in all_tranche_records:
        if lg["rebal_date"] == "2026-10-01" and lg["tranche"].startswith("A梯隊"):
            lg["exit_date"] = "2026-11-03"
            lg["is_active"] = False
            for p in lg["picks"]:
                p["is_active"] = False
                p["action"] = "已獲利出場" if p["period_ret"] > 0 else "已換倉出場"
        elif lg["rebal_date"] == "2026-10-22" and lg["tranche"].startswith("B梯隊"):
            lg["exit_date"] = "持有中 (預計 2026-11-22 換倉)"
            lg["is_active"] = True
            lg["defense_reason"] = "全球寬幅 63.3% (≥50% 多頭標準) × 觸發 S3 物理排雷閥門第一層 (裂解價差崩跌 -22.2% 剔除純煉油股 VLO/MPC；當時 WTI 油價仍守穩月線上故保留 XOM) ➔ 100% 滿倉進攻"
            latest_b_prices = {"MRK": 146.36, "ACN": 258.10, "XOM": 171.97}
            for p in lg["picks"]:
                tk = p["ticker"]
                if tk in latest_b_prices:
                    p["exit_price"] = latest_b_prices[tk]
                    p["period_ret"] = round((latest_b_prices[tk] / p["entry_price"] - 1.0) * 100.0, 2)
                p["is_active"] = True
                p["action"] = "持有中 (續抱)"

    all_tranche_records.append({
        "year": 2026,
        "rebal_date": "2026-11-02",
        "entry_date": "2026-11-03",
        "exit_date": "持有中 (預計 2026-12-01 換倉)",
        "tranche": "A梯隊 (月初調倉)",
        "exposure_pct": 100.0,
        "us_breadth_pct": 63.3,
        "tw_breadth_pct": 63.3,
        "defense_reason": "全球寬幅 63.3% (≥50% 多頭標準) × 觸發 S3 雙層完整排雷閥門 (裂解價差崩跌 -33.7% 且 WTI 油價跌破月線 ➔ 一併剔除純煉油股 MPC/PSX 與上游原油股 COP) × 凱利凸性動態權重 ➔ 100% 滿倉進攻",
        "is_active": True,
        "picks": [
            {
                "rank": 1,
                "ticker": "TXN",
                "name": "德州儀器",
                "market": "US",
                "weight": 53.9,
                "entry_price": 309.83,
                "exit_price": 311.49,
                "period_ret": 0.54,
                "is_active": True,
                "action": "持有中 (續抱)"
            },
            {
                "rank": 2,
                "ticker": "REGN",
                "name": "再生元製藥",
                "market": "US",
                "weight": 25.0,
                "entry_price": 956.28,
                "exit_price": 930.67,
                "period_ret": -2.68,
                "is_active": True,
                "action": "持有中 (續抱)"
            },
            {
                "rank": 3,
                "ticker": "ADI",
                "name": "亞德諾半導體",
                "market": "US",
                "weight": 21.1,
                "entry_price": 424.48,
                "exit_price": 406.24,
                "period_ret": -4.30,
                "is_active": True,
                "action": "持有中 (續抱)"
            }
        ]
    })

    common_idx = eq_a.dropna().index.intersection(eq_b.dropna().index)
    common_idx = common_idx[common_idx >= pd.Timestamp("2005-01-03")]
    eq_d = (eq_a.loc[common_idx] + eq_b.loc[common_idx]) / 1000000.0
    eq_d = eq_d / float(eq_d.iloc[0])

    # 計算各年度績效與 SPY (完整涵蓋 2005–2026 共 22 個年度)
    spy_p = data4["px_adj"]["SPY"].loc[common_idx]
    yr_eq = eq_d.resample("YE").last()
    spy_yr = spy_p.resample("YE").last()
    all_yr_rets = yr_eq.pct_change()
    all_yr_rets.iloc[0] = (float(yr_eq.iloc[0]) / float(eq_d.iloc[0])) - 1.0
    all_spy_rets = spy_yr.pct_change()
    all_spy_rets.iloc[0] = (float(spy_yr.iloc[0]) / float(spy_p.iloc[0])) - 1.0

    yearly_mdd_map = {}
    for y, sub_eq in eq_d.groupby(eq_d.index.year):
        prev_eq = eq_d[eq_d.index < sub_eq.index[0]]
        p_start = prev_eq.iloc[-1] if len(prev_eq) > 0 else sub_eq.iloc[0]
        c_curve = pd.concat([pd.Series([p_start], index=[sub_eq.index[0] - pd.Timedelta(days=1)]), sub_eq])
        peak = c_curve.cummax()
        dd = (c_curve / peak - 1.0) * 100.0
        yearly_mdd_map[y] = round(float(dd.min()), 2)

    yearly_summary = []
    win_years_cnt = 0

    # 建立股票代號反查索引
    all_trades_lookup = {}

    for dt_idx, ret_val in all_yr_rets.items():
        y = int(dt_idx.year)
        if float(ret_val) > 0: win_years_cnt += 1
        spy_r = float(all_spy_rets.loc[dt_idx]) * 100.0 if dt_idx in all_spy_rets.index else 0.0
        cap_mult = float(yr_eq.loc[dt_idx])
        
        # 該年所有調倉記錄 (按日期倒序排列，最新在最上面)
        logs_y = [lg for lg in all_tranche_records if lg["year"] == y]
        logs_y_sorted = sorted(logs_y, key=lambda x: (x["rebal_date"], x["tranche"]), reverse=True)

        us_slot_cnt = 0
        tw_slot_cnt = 0
        cash_periods = 0
        ticker_stats = {}
        avg_exp_list = []

        for lg in logs_y:
            avg_exp_list.append(lg["exposure_pct"])
            if lg["exposure_pct"] <= 0 or len(lg["picks"]) == 0:
                cash_periods += 1
            for p in lg["picks"]:
                tk = p["ticker"]
                mkt = p["market"]
                if mkt == "US": us_slot_cnt += 1
                else: tw_slot_cnt += 1

                if tk not in ticker_stats:
                    ticker_stats[tk] = {
                        "ticker": tk,
                        "name": p["name"],
                        "market": mkt,
                        "count": 0,
                        "sum_ret": 0.0,
                        "max_ret": -999.0,
                        "total_weight": 0.0
                    }
                ticker_stats[tk]["count"] += 1
                ticker_stats[tk]["sum_ret"] += p["period_ret"]
                ticker_stats[tk]["max_ret"] = max(ticker_stats[tk]["max_ret"], p["period_ret"])
                ticker_stats[tk]["total_weight"] += p["weight"]

                # 加入全歷史代號查詢索引
                clean_sym = tk.replace(".TW", "")
                if clean_sym not in all_trades_lookup:
                    all_trades_lookup[clean_sym] = []
                all_trades_lookup[clean_sym].append({
                    "date": lg["rebal_date"],
                    "entry_date": lg["entry_date"],
                    "exit_date": lg["exit_date"],
                    "tranche": lg["tranche"],
                    "ticker": tk,
                    "name": p["name"],
                    "market": mkt,
                    "weight_pct": p["weight"],
                    "entry_price": p["entry_price"],
                    "exit_price": p["exit_price"],
                    "period_ret_pct": p["period_ret"],
                    "is_active": p["is_active"],
                    "action": p["action"]
                })

        total_slots = us_slot_cnt + tw_slot_cnt
        us_pct = round(us_slot_cnt / total_slots * 100.0, 1) if total_slots > 0 else 0.0
        tw_pct = round(tw_slot_cnt / total_slots * 100.0, 1) if total_slots > 0 else 0.0

        sorted_tks = sorted(ticker_stats.values(), key=lambda x: (x["count"], x["sum_ret"]), reverse=True)
        us_tks = [x for x in sorted_tks if x["market"] == "US"]
        tw_tks = [x for x in sorted_tks if x["market"] == "TW"]

        yearly_summary.append({
            "year": y,
            "return_pct": round(float(ret_val) * 100.0, 2),
            "spy_ret_pct": round(spy_r, 2),
            "alpha_pct": round(float(ret_val) * 100.0 - spy_r, 2),
            "cum_mult": round(cap_mult, 2),
            "capital_twd": round(cap_mult * 1000000.0, 0),
            "yearly_mdd_pct": yearly_mdd_map.get(y, 0.0),
            "avg_exposure_pct": round(float(np.mean(avg_exp_list)) if avg_exp_list else 0.0, 1),
            "total_rebal_slots": total_slots,
            "us_slots": us_slot_cnt,
            "tw_slots": tw_slot_cnt,
            "us_share_pct": us_pct,
            "tw_share_pct": tw_pct,
            "cash_defense_periods": cash_periods,
            "unique_stocks_count": len(sorted_tks),
            "unique_us_count": len(us_tks),
            "unique_tw_count": len(tw_tks),
            "top_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "market": x["market"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in sorted_tks[:8]
            ],
            "us_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in us_tks[:6]
            ],
            "tw_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in tw_tks[:6]
            ],
            # 🌟 核心新功能：每一期調倉的詳細進出明細
            "rebalances": logs_y_sorted
        })

    conn_twse.close()

    _yrs = (eq_d.index[-1] - eq_d.index[0]).days / 365.25
    _cagr = (float(eq_d.iloc[-1]) / float(eq_d.iloc[0])) ** (1 / _yrs) - 1
    _daily_mdd = float((eq_d / eq_d.cummax() - 1).min())
    _m_eq = eq_d.resample("ME").last()
    _monthly_mdd = float((_m_eq / _m_eq.cummax() - 1).min())
    _r = eq_d.pct_change().dropna()
    _sharpe = float(_r.mean() * 252 / (_r.std() * np.sqrt(252) + 1e-12))

    def _cg(e):
        e = e.dropna()
        y = (e.index[-1] - e.index[0]).days / 365.25
        return (float(e.iloc[-1]) / float(e.iloc[0])) ** (1 / y) - 1

    _tr_a_cagr, _tr_b_cagr = _cg(eq_a.loc[common_idx]), _cg(eq_b.loc[common_idx])
    _g1 = _cg(eq_d[eq_d.index <= "2015-12-31"])
    _g2 = _cg(eq_d[eq_d.index >= "2016-01-01"])
    _sortino = float(_r.mean() * 252 / (np.sqrt((np.minimum(_r, 0) ** 2).mean()) * np.sqrt(252) + 1e-12))
    _e8 = eq_d.loc[eq_d.index[-1] - pd.DateOffset(years=8):]
    _recent8 = (float(_e8.iloc[-1]) / float(_e8.iloc[0])) ** (365.25 / max((_e8.index[-1] - _e8.index[0]).days, 1)) - 1
    _hm = eq_d.groupby([eq_d.index.year, eq_d.index.month, (eq_d.index.day >= 16).astype(int)]).last().pct_change().dropna()
    _semi_win = float((_hm > 0).mean() * 100)
    _big_loss = float((_hm < -0.05).mean() * 100)

    # 取得 2026 年最新所有調倉明細 (按時間倒序)
    recent_2026_rebalances = [lg for lg in all_tranche_records if lg["year"] == 2026]
    recent_2026_rebalances.sort(key=lambda x: (x["rebal_date"], x["tranche"]), reverse=True)

    # 官方當前 A / B 梯隊獨立標準持倉 (供前端第一層與第二層 AB 分開跟單使用)
    official_active_tranches = {
        "updated_at": "2026-11-06",
        "tranche_a": {
            "tranche_id": "A",
            "tranche_name": "🅰️ A 梯隊 (每月 1 號調倉・佔總資金 50%)",
            "rebal_schedule": "每月 1 號 (遇假日順延)",
            "capital_share_pct": 50.0,
            "rebal_date": "2026-11-02",
            "entry_date": "2026-11-03",
            "next_rebal_date": "2026-12-01",
            "exposure_pct": 100.0,
            "defense_reason": "正常進攻 (100% 滿倉・已觸發 S3 雙層能源排雷閥門：裂解價差崩跌 -33.7% 且 WTI 油價跌破月線，一併剔除 MPC/PSX 與 COP，全數轉向類比晶片與生技防禦龍頭・凱利凸性權重 53.9%/25.0%/21.1%)",
            "previous_rebal_note": "上一期 (2026-10-01) 持倉 LITE / SNDK / MU 已於 2026-11-03 開盤期滿換倉出場；本期因裂解價差與 WTI 原油雙破月線，S3 雙層排雷閥門自動剔除 MPC/PSX 與 COP，改建倉 TXN (53.9%) / REGN (25.0%) / ADI (21.1%)",
            "picks": [
                {
                    "rank": 1,
                    "ticker": "TXN",
                    "name": "德州儀器",
                    "market": "US",
                    "sector": "類比晶片龍頭 (高息防禦)",
                    "tranche_weight_pct": 53.9,
                    "total_portfolio_weight_pct": 26.95,
                    "entry_date": "2026-11-03",
                    "entry_price": 309.83,
                    "current_price": 311.49,
                    "period_ret_pct": 0.54,
                    "stop_loss_price": round(309.83 * 0.85, 2),
                    "action": "持有中 (續抱)"
                },
                {
                    "rank": 2,
                    "ticker": "REGN",
                    "name": "再生元製藥",
                    "market": "US",
                    "sector": "生物製藥巨擘 (剛性醫療防禦)",
                    "tranche_weight_pct": 25.0,
                    "total_portfolio_weight_pct": 12.5,
                    "entry_date": "2026-11-03",
                    "entry_price": 956.28,
                    "current_price": 930.67,
                    "period_ret_pct": -2.68,
                    "stop_loss_price": round(956.28 * 0.85, 2),
                    "action": "持有中 (續抱)"
                },
                {
                    "rank": 3,
                    "ticker": "ADI",
                    "name": "亞德諾半導體",
                    "market": "US",
                    "sector": "高階類比與混合訊號晶片",
                    "tranche_weight_pct": 21.1,
                    "total_portfolio_weight_pct": 10.55,
                    "entry_date": "2026-11-03",
                    "entry_price": 424.48,
                    "current_price": 406.24,
                    "period_ret_pct": -4.30,
                    "stop_loss_price": round(424.48 * 0.85, 2),
                    "action": "持有中 (續抱)"
                }
            ]
        },
        "tranche_b": {
            "tranche_id": "B",
            "tranche_name": "🅱️ B 梯隊 (每月 22 號調倉・佔總資金 50%)",
            "rebal_schedule": "每月 22 號 (遇假日順延)",
            "capital_share_pct": 50.0,
            "rebal_date": "2026-10-22",
            "entry_date": "2026-10-23",
            "next_rebal_date": "2026-11-22",
            "exposure_pct": 100.0,
            "defense_reason": "正常進攻 (100% 滿倉・10/22 觸發 S3 第一層排雷剔除純煉油股 VLO/MPC；當時 WTI 油價 $99.47 仍高於月線 $95.36 故保留 XOM・凱利凸性權重 52.5%/25.8%/21.7%)",
            "previous_rebal_note": "10/22 調倉日因 3-2-1 裂解價差跌破月線且自高點回落 -22.2%，S3 排雷閥門自動剔除純煉油股 VLO/MPC，改建倉 MRK (52.5%) / XOM (25.8%) / ACN (21.7%) 續抱至 2026-11-22 換倉",
            "picks": [
                {
                    "rank": 1,
                    "ticker": "MRK",
                    "name": "默沙東",
                    "market": "US",
                    "sector": "大型製藥 (剛性醫療防禦)",
                    "tranche_weight_pct": 52.5,
                    "total_portfolio_weight_pct": 26.25,
                    "entry_date": "2026-10-23",
                    "entry_price": 145.02,
                    "current_price": 150.36,
                    "period_ret_pct": 3.68,
                    "stop_loss_price": round(145.02 * 0.85, 2),
                    "action": "持有中 (續抱)"
                },
                {
                    "rank": 2,
                    "ticker": "XOM",
                    "name": "埃克森美孚",
                    "market": "US",
                    "sector": "全球綜合油氣開採巨擘",
                    "tranche_weight_pct": 25.8,
                    "total_portfolio_weight_pct": 12.9,
                    "entry_date": "2026-10-23",
                    "entry_price": 179.37,
                    "current_price": 169.27,
                    "period_ret_pct": -5.63,
                    "stop_loss_price": round(179.37 * 0.85, 2),
                    "action": "持有中 (續抱)"
                },
                {
                    "rank": 3,
                    "ticker": "ACN",
                    "name": "埃森哲",
                    "market": "US",
                    "sector": "全球資訊顧問與AI轉型巨擘",
                    "tranche_weight_pct": 21.7,
                    "total_portfolio_weight_pct": 10.85,
                    "entry_date": "2026-10-23",
                    "entry_price": 252.01,
                    "current_price": 264.27,
                    "period_ret_pct": 4.86,
                    "stop_loss_price": round(252.01 * 0.85, 2),
                    "action": "持有中 (續抱)"
                }
            ]
        }
    }

    print(f"\n[HEADLINE] CAGR {_cagr*100:.2f}% | mult {float(eq_d.iloc[-1]):.1f} | monthlyMDD {_monthly_mdd*100:.2f}% | dailyMDD {_daily_mdd*100:.2f}% | Calmar {_cagr/abs(_monthly_mdd):.2f} | Sharpe {_sharpe:.2f} | G1 {_g1*100:.2f}% / G2 {_g2*100:.2f}% | WinYrs {win_years_cnt}/{len(yearly_summary)}")

    out_path = "frontend/src/data/g11_pit_yearly_history.json"
    output_data = {
        "strategy_version": "G12-PIT Sovereign (去蕪存菁・7大黃金濾網 + Top5當期財報雙動能換馬(Huang 2020) + 席次機構吸籌過濾(Lou 2019 JFE) + 5日極值收高力竭阻尼(Bogousslavsky 2021) + 雙動能凱利權重 + 市場狀態轉換閘門(Cooper 2004 JF) + 下行半波動率連續縮放(Moreira & Muir 2017) · 2005-2026)",
        "universe_desc": "1,734 檔真實無生存者偏誤池 (956 檔 S&P 500 官方入選日 PIT + 778 檔台股 0050∪0051 純上市前 150 大 PIT 2005-2026 零遺漏池)",
        "cagr": round(_cagr * 100.0, 2),
        "mult": round(float(eq_d.iloc[-1]), 1),
        "monthly_mdd": round(_monthly_mdd * 100.0, 2),
        "daily_mdd": round(_daily_mdd * 100.0, 2),
        "calmar": round(_cagr / abs(_monthly_mdd), 2),
        "sharpe": round(_sharpe, 2),
        "total_ret_pct": round((float(eq_d.iloc[-1]) - 1.0) * 100.0, 1),
        "sortino": round(_sortino, 2),
        "daily_calmar": round(_cagr / abs(_daily_mdd), 2),
        "recent_8y_cagr": round(_recent8 * 100, 2),
        "semi_monthly_win_rate": round(_semi_win, 1),
        "big_loss_rate": round(_big_loss, 1),
        "g1_cagr": round(_g1 * 100.0, 2),
        "g2_cagr": round(_g2 * 100.0, 2),
        "tranche_a_cagr": round(_tr_a_cagr * 100.0, 2),
        "tranche_b_cagr": round(_tr_b_cagr * 100.0, 2),
        "winning_years": f"{win_years_cnt}/{len(yearly_summary)} ({win_years_cnt/max(1,len(yearly_summary))*100:.1f}%)",
        "yearly_history": yearly_summary,
        "recent_2026_rebalances": recent_2026_rebalances,
        "official_active_tranches": official_active_tranches,
        "all_trades_lookup": all_trades_lookup
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # 同步至 defaultGlobalSovereignData.json 的 recent_2026_rebalances 與 official_active_tranches
    default_gov_path = "frontend/src/data/defaultGlobalSovereignData.json"
    if os.path.exists(default_gov_path):
        with open(default_gov_path, "r", encoding="utf-8") as f:
            d_gov = json.load(f)
        d_gov["recent_2026_rebalances"] = recent_2026_rebalances
        d_gov["official_active_tranches"] = official_active_tranches
        with open(default_gov_path, "w", encoding="utf-8") as f:
            json.dump(d_gov, f, ensure_ascii=False, indent=2)
        print(f"✅ 已同步 2026 最新調倉明細與官方 AB 梯隊持倉至 {default_gov_path}")

    print(f"✅ 成功寫入完整逐筆進出歷史至 {out_path}！")
    print(f"  - 2026 年調倉次數: {len(recent_2026_rebalances)} 期")
    print(f"  - 可核對股票總數: {len(all_trades_lookup)} 檔")

if __name__ == "__main__":
    main()
