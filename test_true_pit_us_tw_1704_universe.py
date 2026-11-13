#!/usr/bin/env python3
"""
test_true_pit_us_tw_1704_universe.py
================================================================================
【真・美台全市場無生存者偏誤動態池 (1,704 檔 = 956 美股 PIT + 748 台股 PIT) 終極實證】
================================================================================
- 美股端 (956 檔)：包含 1999~2026 歷年所有曾進入 S&P 500 / Nasdaq-100 之歷史成分股與
  212 檔已下市/破產/私有化/被併購美股 (SIVB, FRC, BBBY, CHK, SUNW, TWX, MON, WBA, ATVI,
  XLNX, ALXN, CTXS, CERN, RAD, XRX, LUMN, BB, NOK, FSLR 等)，嚴格依據當下日 t 是否在指數內
  (`in_index_pit`) 與當下 60D 美元成交額排名進行動態篩選。
- 台股端 (748 檔)：來自 `daily_stock` 全市場 2,300+ 檔普通股中任何一日曾進當日 60D 成交額前 150 名者，
  含宏達電、上銀、可成、國巨、撼訊、康控、大江、晶宏、高端疫苗、錸德、中環等所有歷史時代眼淚。
- 嚴格禁止「看答案開多重 OR 後門規則」，全面檢驗最真實、零偷看未來的盲測績效！
"""

import os
import time
import pickle
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

import build_us_pit_delisted_db as us_db
import forensic_open_pool_sniper as fops


def build_1704_pit_engine():
    t0 = time.time()
    print("=" * 115)
    print("🏗️ 建構 1,704 檔 (956 美股 PIT 含下市股 + 748 台股 PIT 含下市/衰退股) 全市場無偏誤回測引擎...")
    print("=" * 115)

    us_pit = us_db.build_us_pit_database(force_rebuild=False)
    env_tw = fops.build_g9_open_universe_engine(150, use_cache=True)

    # [快取遺失補救] /tmp 快取被清除後，現行引擎不再產生下列三欄；改由倖存的 TW 零遺漏池重建 (定義同 build_and_test_zero_omission_0050_0051.py)
    if "raw_px_tw" not in env_tw or "avg_order_rk" not in env_tw:
        from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
        _tz = build_zero_omission_tw_0050_0051_pit()
        _cd, _pt = env_tw["stk_adj"].index, env_tw["pit_tw"]
        env_tw["raw_px_tw"] = _tz["raw_close"].reindex(index=_cd, columns=_pt).ffill()
        _val = _tz["trade_val"].reindex(index=_cd, columns=_pt).ffill().fillna(0.0)
        _tx = _tz["tx_count"].reindex(index=_cd, columns=_pt).ffill().fillna(0.0)
        _aov = (_val / _tx.replace(0, np.nan)).rolling(20, min_periods=5).mean()
        _inp = _tz["in_0050_0051_pit"].reindex(index=_cd, columns=_pt).ffill().fillna(False)
        env_tw["avg_order_ntd"] = _aov
        env_tw["avg_order_rk"] = _aov.where(_inp).rank(axis=1, ascending=False, method="min")

    data4 = env_tw["data4"]
    common_dates = env_tw["stk_adj"].index
    pit_tw = env_tw["pit_tw"]
    us_all_tickers = list(us_pit["us_tickers"])
    us_orig = [c for c in env_tw["us_orig"] if c in set(us_all_tickers)]
    us_extra_tickers = [c for c in us_all_tickers if c not in set(us_orig)]
    us_tickers = us_orig + us_extra_tickers

    # 統一對齊全部美股至 common_dates：100% 採用 us_pit 經 Qlib+Yahoo 等比無斷層縫合之價格與成交量序列
    # 嚴格確保 raw_close * volume 滿足歷史真實美元成交額守恆 (消除跨資料源未對齊股票分割倍率造成的未來函數)
    us_adj = us_pit["adj_close"][us_tickers].reindex(common_dates).ffill()
    us_open = us_pit["adj_open"][us_tickers].reindex(common_dates).ffill().fillna(us_adj)
    us_high = us_pit["adj_high"][us_tickers].reindex(common_dates).ffill().fillna(us_adj)
    us_low = us_pit["adj_low"][us_tickers].reindex(common_dates).ffill().fillna(us_adj)
    us_vol = us_pit["volume"][us_tickers].reindex(common_dates).fillna(0.0)

    us_raw = us_pit["raw_close"][us_tickers].reindex(common_dates).ffill()
    us_in_idx = us_pit["in_index_pit"][us_tickers].reindex(common_dates).ffill().fillna(False)
    if "in_sp500_pit" in us_pit:
        us_in_sp500 = us_pit["in_sp500_pit"][us_tickers].reindex(common_dates).ffill().fillna(False)
    else:
        us_in_sp500 = us_in_idx

    # 計算美股當下 60D 美元成交額與活躍狀態
    us_dvol60 = (us_raw * us_vol).rolling(60, min_periods=20).mean()
    us_active = (us_vol > 0).rolling(20, min_periods=1).max() > 0
    dataset_end_dt = common_dates[-1]
    for s, lvd in us_pit["last_valid_date"].items():
        if lvd is not None and s in us_active.columns:
            # 僅針對全歷史中真正已下市/被併購的股票 (最後有效日早於數據庫結束日前 10 天者)
            # 在其下市/停止交易前 20 天即禁止新買入，且下市後永遠 active=False
            if lvd < dataset_end_dt - pd.Timedelta(days=10):
                cutoff_dt = lvd - pd.Timedelta(days=20)
                us_active.loc[common_dates >= cutoff_dt, s] = False

    # 排除 Qlib 內因「代碼重用 (Ticker Reuse) 或未還權反向分割 (如 CBE +3049900%, TIE +592900%)」造成的單日異常斷層股
    us_ret1d = us_adj.pct_change(fill_method=None)
    us_has_glitch = (
        (us_ret1d.abs() > 0.80).rolling(252, min_periods=1).max() > 0
    ) | (
        ((us_open / us_adj.replace(0, np.nan)) > 1.50).rolling(60, min_periods=1).max() > 0
    ) | (
        ((us_open / us_adj.replace(0, np.nan)) < 0.65).rolling(60, min_periods=1).max() > 0
    )
    us_listed_252 = us_adj.notna().rolling(252, min_periods=252).sum() >= 252

    # 美股 PIT 資格：當日活躍 + 上市滿252日無代碼重用斷層 + 當日必須已正式進入 S&P 500 成分股名單 (in_sp500_pit)
    # 嚴格濾除當下非 S&P 500 的股票 (例如尚未入選 S&P 500 前的 TSLA/SMCI/PLTR/ANET/AVGO，以及從未入選的 ASML/TSM/ARM/MSTR)
    us_pit_elig_base = us_active & us_listed_252 & (~us_has_glitch) & us_in_sp500
    us_rk_pit = us_dvol60.where(us_pit_elig_base).rank(axis=1, ascending=False, method="min").ffill()

    # 取出台股 748 檔矩陣
    tw_adj = env_tw["stk_adj"][pit_tw]
    tw_open = env_tw["stk_open"][pit_tw]
    tw_high = env_tw["stk_high"][pit_tw]
    tw_low = env_tw["stk_low"][pit_tw]
    tw_vol = env_tw["stk_vol"][pit_tw]

    all_1704_tickers = us_tickers + pit_tw
    stk_adj = pd.concat([us_adj, tw_adj], axis=1)
    stk_open = pd.concat([us_open, tw_open], axis=1)
    stk_high = pd.concat([us_high, tw_high], axis=1).fillna(stk_adj)
    stk_low = pd.concat([us_low, tw_low], axis=1).fillna(stk_adj)
    stk_vol = pd.concat([us_vol, tw_vol], axis=1).fillna(0.0)

    print(f"  - 合併矩陣維度: {stk_adj.shape} (956 美股 + 748 台股 = {len(all_1704_tickers)} 檔)")
    print("  - 計算全市場 1,704 檔 G5 / G9 八大微結構動能因子矩陣 (與 forensic_open_pool_sniper 100% 同步公式)...")

    ma20 = stk_adj.rolling(20, min_periods=15).mean()
    ma60 = stk_adj.rolling(60, min_periods=30).mean()
    ma200 = stk_adj.rolling(200, min_periods=100).mean()
    bias60 = (stk_adj / (ma60 + 1e-9)) - 1.0

    mom2w = stk_adj.pct_change(10, fill_method=None).fillna(0.0)
    mom1m = stk_adj.pct_change(21, fill_method=None)
    mom3m = stk_adj.pct_change(63, fill_method=None)
    mom12m = stk_adj.pct_change(252, fill_method=None)

    spy_adj = data4["px_adj"]["SPY"]
    spy_ret1m = spy_adj.pct_change(21)
    spy_ret3m = spy_adj.pct_change(63)
    spy_ret12m = spy_adj.pct_change(252)
    spy_d_ret = spy_adj.pct_change()
    spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)

    px_daily_ret = stk_adj.pct_change(fill_method=None)
    pos_252 = (px_daily_ret > 0).rolling(252, min_periods=120).sum()
    neg_252 = (px_daily_ret < 0).rolling(252, min_periods=120).sum()
    fip_252 = ((pos_252 - neg_252) / (pos_252 + neg_252 + 1e-9)).fillna(0.0)

    pos_126 = (px_daily_ret > 0).rolling(126, min_periods=60).sum()
    neg_126 = (px_daily_ret < 0).rolling(126, min_periods=60).sum()
    fip_126 = ((pos_126 - neg_126) / (pos_126 + neg_126 + 1e-9)).fillna(0.0)

    downside_vol_60d = (px_daily_ret.clip(upper=0.0).rolling(60, min_periods=30).std() * np.sqrt(252)).replace(0, np.nan)
    upside_vol_60d = (px_daily_ret.clip(lower=0.0).rolling(60, min_periods=30).std() * np.sqrt(252)).replace(0, np.nan)
    stk_convexity = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

    cov_mat = px_daily_ret.rolling(126, min_periods=60).cov(spy_d_ret)
    betas_126 = cov_mat.div(spy_var_126, axis=0).clip(0.1, 3.0).fillna(1.0)

    res_mom12m = mom12m.sub(spy_ret12m, axis=0) * 0.5 + (mom12m - betas_126.mul(spy_ret12m, axis=0)) * 0.5
    res_mom3m = mom3m - betas_126.mul(spy_ret3m, axis=0)
    res_mom1m = mom1m - betas_126.mul(spy_ret1m, axis=0)
    res_mom_core = 0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m
    raw_mom_core = 0.45 * mom12m + 0.35 * mom3m + 0.20 * mom1m

    vol_ma60 = stk_vol.rolling(60, min_periods=20).mean()
    vol_5d_mean = stk_vol.rolling(5, min_periods=3).mean()
    churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

    blend_mom_core = 0.85 * raw_mom_core + 0.15 * res_mom_core
    fip_mult = 1.0 + 0.5 * fip_252
    conv_mult = 1.0 + 0.20 * (stk_convexity - 1.0).clip(-0.5, 2.0)
    p_damp = 1.0 / (1.0 + 1.2 * (bias60 - 0.65))
    parabolic_damper = pd.DataFrame(np.where(bias60 > 0.65, p_damp, 1.0), index=bias60.index, columns=all_1704_tickers)
    high_252 = stk_high.rolling(252, min_periods=60).max()
    prox_52w = (stk_adj / (high_252 + 1e-9)).clip(0.1, 1.05).fillna(0.8)
    m_2a = (1.0 + 0.40 * (prox_52w - 0.85)).clip(0.5, 1.5)

    titan2_base = blend_mom_core * fip_mult * conv_mult * parabolic_damper * m_2a

    ret_intra = (stk_adj / (stk_open + 1e-9) - 1.0).clip(-0.25, 0.25)
    ret_over = (stk_open / (stk_adj.shift(1) + 1e-9) - 1.0).clip(-0.25, 0.25)
    io_diff = (ret_intra - ret_over).fillna(0.0)
    io_20 = io_diff.rolling(20, min_periods=5).sum().fillna(0.0)
    io_5 = io_diff.rolling(5, min_periods=3).sum().fillna(0.0)
    io_accel = (io_5 - io_20 / 4.0).fillna(0.0)

    dn_vol = stk_vol.where(px_daily_ret < 0, 0.0)
    up_vol = stk_vol.where(px_daily_ret > 0, 0.0)
    max_dn_v10 = dn_vol.shift(1).rolling(10, min_periods=3).max().fillna(0.0)
    max_up_v10 = up_vol.shift(1).rolling(10, min_periods=3).max().fillna(0.0)
    pp_up = ((px_daily_ret > 0) & (max_dn_v10 > 0) & (stk_vol > max_dn_v10)).astype(float)
    pp_dn = ((px_daily_ret < 0) & (max_up_v10 > 0) & (stk_vol > max_up_v10)).astype(float)
    pocket_pivot_40 = ((pp_up.rolling(40, min_periods=10).sum() - pp_dn.rolling(40, min_periods=10).sum()) / 20.0).fillna(0.0)

    m_io20 = (1.0 + 0.08 * io_20.clip(-0.35, 0.45)).clip(0.88, 1.18)
    m_fip126 = (1.0 + 0.12 * fip_126).clip(0.85, 1.20)
    m_pp40 = (1.0 + 0.035 * pocket_pivot_40.clip(-0.60, 0.80)).clip(0.92, 1.10)

    s_g5_1704 = (titan2_base * m_io20 * m_fip126 * m_pp40).astype(np.float32)

    below_ma20 = (stk_adj < ma20).astype(float)
    dipped_15d = below_ma20.shift(1).rolling(14, min_periods=1).max() > 0
    ma20_shakeout_reclaim = (dipped_15d & (stk_adj > ma20) & ((1.0 + io_5.clip(-0.05, 0.15)) > 0)).astype(float)

    # 美股全數採用統一無斷層 s_g5_1704 矩陣公式；台股 pit_tw 沿用 env_tw["s_g5_open"] 確保台股漲跌停還權基準一致
    s_g5_1704[pit_tw] = env_tw["s_g5_open"][pit_tw].astype(np.float32)

    pe_1704 = pd.DataFrame(np.nan, index=common_dates, columns=all_1704_tickers, dtype=np.float32)
    roe_1704 = pd.DataFrame(np.nan, index=common_dates, columns=all_1704_tickers, dtype=np.float32)
    tr20_1704 = pd.DataFrame(0.0, index=common_dates, columns=all_1704_tickers, dtype=np.float32)
    fr20_1704 = pd.DataFrame(0.0, index=common_dates, columns=all_1704_tickers, dtype=np.float32)

    pe_1704[pit_tw] = env_tw["pe_mat"][pit_tw].astype(np.float32)
    roe_1704[pit_tw] = env_tw["roe_mat"][pit_tw].astype(np.float32)
    tr20_1704[pit_tw] = env_tw["tr20_mat"][pit_tw].astype(np.float32)
    fr20_1704[pit_tw] = env_tw["fr20_mat"][pit_tw].astype(np.float32)

    env_1704 = {
        "data4": data4,
        "tw_pit": env_tw["tw_pit"],
        "all_open_tickers": all_1704_tickers,
        "us_tickers": us_tickers,
        "us_orig": us_orig,
        "pit_tw": pit_tw,
        "stk_adj": stk_adj.astype(np.float32),
        "stk_open": stk_open.astype(np.float32),
        "stk_high": stk_high.astype(np.float32),
        "stk_low": stk_low.astype(np.float32),
        "stk_vol": stk_vol.astype(np.float32),
        "ma20": ma20.astype(np.float32),
        "ma60": ma60.astype(np.float32),
        "ma200": ma200.astype(np.float32),
        "bias60": bias60.astype(np.float32),
        "fip_126": fip_126.astype(np.float32),
        "io_20": io_20.astype(np.float32),
        "io_5": io_5.astype(np.float32),
        "io_accel": io_accel.astype(np.float32),
        "ma20_shakeout_reclaim": ma20_shakeout_reclaim.astype(np.float32),
        "churn_exhaustion": churn_exhaustion,
        "s_g5_open": s_g5_1704,
        "us_in_sp500": us_in_sp500,
        "us_pit_elig_base": us_pit_elig_base,
        "us_rk_pit": us_rk_pit.astype(np.float32),
        "tw_rk_t": env_tw["tw_rk_t"].astype(np.float32),
        "pe_mat": pe_1704,
        "roe_mat": roe_1704,
        "tr20_mat": tr20_1704,
        "fr20_mat": fr20_1704,
        "raw_px_tw": env_tw["raw_px_tw"].astype(np.float32),
        "avg_order_ntd": env_tw["avg_order_ntd"].astype(np.float32),
        "avg_order_rk": env_tw["avg_order_rk"].astype(np.float32),
    }

    print(f"✅ 1,704 檔美台全市場 PIT 引擎建構完成！耗時 {time.time()-t0:.1f}s")
    return env_1704


if __name__ == "__main__":
    env = build_1704_pit_engine()
    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    us_orig = env["us_orig"]
    pit_tw = env["pit_tw"]
    orig_tw = [c for c in env["data4"]["stock_tickers"] if c.endswith(".TW")]

    g9_macro = fops.make_g9_macro_fn()
    g9_sec = fops.make_g9_secondary_mult(env)

    print("\n" + "=" * 155)
    print("📊 【真實世界殘酷對照表】靜態事後贏家池 (150檔) vs 美股 PIT 含下市股 (956檔) vs 美台全市場 PIT 開放池 (1,704檔)")
    print("=" * 155)

    # 0. 舊版 150 檔靜態事後贏家池 (126 美股 + 24 台股)
    elig_0 = pd.DataFrame(False, index=idx, columns=cols)
    elig_0[us_orig + orig_tw] = True
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_0, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="0A. 舊版靜態事後贏家池 (126美股 + 24台股 = 150檔，未鎖定S&P500入選日)")

    elig_0b = pd.DataFrame(False, index=idx, columns=cols)
    elig_0b[us_orig] = env["us_in_sp500"][us_orig]
    elig_0b[orig_tw] = True
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_0b, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="0B. 舊版 150 檔但『美股強制鎖定進入 S&P500 後才准買』(濾除非SP500與入選前)")

    # 1. 純美股：舊版 126 檔靜態美股 vs 鎖定 S&P500 入選日 vs 全歷史 977 檔 S&P500 PIT 美股 (含下市/破產/被剔除股)
    elig_1a = pd.DataFrame(False, index=idx, columns=cols)
    elig_1a[us_orig] = True
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_1a, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="1A. 純美股靜態池 (126 檔今日巨頭，未鎖定 S&P500 入選日)")

    elig_1a_sp = pd.DataFrame(False, index=idx, columns=cols)
    elig_1a_sp[us_orig] = env["us_in_sp500"][us_orig]
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_1a_sp, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="1A-SP500. 純美股 126 檔但『強制鎖定進入 S&P500 後才准買』")

    elig_1b = pd.DataFrame(False, index=idx, columns=cols)
    elig_1b[us_tickers] = env["us_pit_elig_base"]
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_1b, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="1B. 純美股全歷史 S&P500 PIT 動態池 (977檔含下市/被剔除股，嚴格鎖定當日SP500)")

    elig_1c = pd.DataFrame(False, index=idx, columns=cols)
    elig_1c[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 150)
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_1c, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="1C. 純美股 S&P500 PIT 當日成交額 Top 150 (含下市/被剔除股，無偏誤)")

    elig_1d = pd.DataFrame(False, index=idx, columns=cols)
    elig_1d[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 80)
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_1d, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="1D. 純美股 S&P500 PIT 當日成交額 Top 80 (含下市/被剔除股，無偏誤)")

    # 2. 美台雙邊全市場 PIT 開放池 (956 美股 PIT + 748 台股 PIT = 1,704 檔)
    # 2A: 無台股品質閘門 (僅當日流動性 Top 50)
    elig_2a = pd.DataFrame(False, index=idx, columns=cols)
    elig_2a[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_2a[pit_tw] = env["tw_rk_t"] <= 50
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_2a, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="2A. 美台 1704 檔 PIT 裸奔池 (美股Top100 + 台股Top50，無品質閘門)")

    # 2B: 單一統一、事前經濟邏輯之台股動態主權門檻 (不開任何 OR 特例後門！)
    tw_rk = env["tw_rk_t"]
    ord_rk = env["avg_order_rk"]
    raw_px = env["raw_px_tw"]
    pe = env["pe_mat"][pit_tw]
    roe = env["roe_mat"][pit_tw]
    tr20 = env["tr20_mat"][pit_tw]
    fr20 = env["fr20_mat"][pit_tw]
    io20 = env["io_20"][pit_tw]
    fip126 = env["fip_126"][pit_tw]

    tw_unified_rule = (
        (tw_rk <= 30)
        & (ord_rk <= 30)
        & (raw_px >= 50.0)
        & (pe > 0)
        & (pe <= 45.0)
        & ((~roe.notna()) | (roe >= 20.0))
        & ((~roe.notna()) | (tr20 > 0.001) | (fr20 > 0.002))
        & (io20 > -0.10)
        & (fip126 > 0.05)
    )
    elig_2b = pd.DataFrame(False, index=idx, columns=cols)
    elig_2b[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_2b[pit_tw] = tw_unified_rule
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_2b, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="2B. 美台 1704 檔 PIT 單一統一主權規則 (零 OR 後門、零偷看答案)")
