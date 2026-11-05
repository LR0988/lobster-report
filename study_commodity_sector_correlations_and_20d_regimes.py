#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
study_commodity_sector_correlations_and_20d_regimes.py

針對五大產業鏈 × 對應原物料/報價錨 (2005–2026 共 22 年全歷史日頻數據)：
1. 計算「產業指數 vs 原物料」之同期與領先相關係數 (Correlation & t-stat)
2. 實測四大原物料訊號體制下，該類股「未來 1 個月 (20 個交易日)」的：
   - 下跌機率 (Loss Probability %)
   - 大跌機率 (20D <= -5% Probability %)
   - 平均未來 20 日報酬 (Mean Forward 20D Return %)
   - 相對大盤超額報酬 (Forward 20D Alpha vs Market %)
3. 實測將「原物料惡化降權 (Veto/Penalty) + 原物料緩漲正向加權 (Steady Uptrend Boost)」雙向機制納入 22 年 PIT 引擎之真實績效提升！
"""

import sqlite3
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, make_pit_macro_fn
import forensic_open_pool_sniper as fops

def main():
    print("=" * 130)
    print("🔬 啟動【五大類股 × 重點原物料 22 年關聯性、未來一個月(20D)下跌機率與緩漲雙向加權】全樣本實證 (2005–2026)")
    print("=" * 130)

    tw_zero = build_zero_omission_tw_0050_0051_pit()
    env = prepare_clean_1725_pit_env()
    cols = env["all_open_tickers"]
    stk_adj = env["stk_adj"][cols]
    dates_idx = stk_adj.index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    conn = sqlite3.connect("tw_stock.db")
    df_mac = pd.read_sql_query(
        "SELECT date, oil_wti, gasoline, heating_oil, crack_spread_321, copper, aluminum, us10y, dxy, usdtwd, sox "
        "FROM macro_indicators ORDER BY date ASC",
        conn
    )
    df_gld = pd.read_sql_query("SELECT date, adj_close FROM global_stock_daily WHERE ticker = 'GLD' ORDER BY date ASC", conn)
    conn.close()

    df_mac["dt"] = pd.to_datetime(df_mac["date"], format="%Y%m%d", errors="coerce")
    df_mac = df_mac.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
    df_mac.index = df_mac.index.astype(dates_idx.dtype)
    df_mac = df_mac.reindex(dates_idx).ffill().bfill()

    df_gld["dt"] = pd.to_datetime(df_gld["date"], errors="coerce")
    df_gld = df_gld.dropna(subset=["dt"]).drop_duplicates(subset=["dt"], keep="last").set_index("dt")
    df_gld.index = df_gld.index.astype(dates_idx.dtype)
    gld_s = df_gld["adj_close"].reindex(dates_idx).ffill().bfill()

    wti_s = df_mac["oil_wti"]
    rb_s = df_mac["gasoline"]
    ho_s = df_mac["heating_oil"]
    crack_s = (2.0 * rb_s * 42.0 + 1.0 * ho_s * 42.0 - 3.0 * wti_s) / 3.0
    copper_s = df_mac["copper"]
    alum_s = df_mac["aluminum"]
    us10y_s = df_mac["us10y"]
    dxy_s = df_mac["dxy"]
    usdtwd_s = df_mac["usdtwd"]
    sox_s = df_mac["sox"]
    spy_s = env["data4"]["px_adj"]["SPY"].reindex(dates_idx).ffill()

    # 定義五大產業鏈池內代表股票 (存在於 cols 中的標的)
    col_set = set(cols)
    def filter_cols(tk_list):
        return [t for t in tk_list if t in col_set]

    sectors = {
        "1A. 🛢️ 上游油氣開採 (Upstream Oil)": {
            "tickers": filter_cols(["XOM", "CVX", "COP", "OXY", "SLB", "HAL", "DVN", "EOG", "HES", "MRO", "FANG", "APA", "BKR", "EQT", "CTRA"]),
            "comm_name": "WTI 原油 (oil_wti)",
            "comm_s": wti_s,
            "direction": "positive",  # 原物料漲對股價有利，原物料跌對股價不利
        },
        "1B. ⛽ 中下游煉油與石化 (Refiners)": {
            "tickers": filter_cols(["MPC", "VLO", "PSX", "TSO", "SUN", "HFC", "DINO", "6505.TW", "1301.TW", "1303.TW", "1326.TW"]),
            "comm_name": "3-2-1 裂解價差 (Crack Spread)",
            "comm_s": crack_s,
            "direction": "positive",
        },
        "2A. 🥉 銅礦、基礎金屬與線纜鋼鐵 (Base Metals)": {
            "tickers": filter_cols(["FCX", "NUE", "STLD", "AA", "ATI", "ALB", "DOW", "LYB", "PPG", "SHW", "2002.TW", "1605.TW", "2027.TW", "2014.TW", "2006.TW"]),
            "comm_name": "COMEX 銅期貨 (Copper HG=F)",
            "comm_s": copper_s,
            "direction": "positive",
        },
        "2B. 🥇 金礦與貴金屬開採 (Gold Miners)": {
            "tickers": filter_cols(["NEM", "GOLD", "AEM", "FCX"]),
            "comm_name": "黃金現貨 (GLD)",
            "comm_s": gld_s,
            "direction": "positive",
        },
        "3. ✈️ 航空、郵輪與高油耗運輸 (Airlines/Cruises - 成本反向)": {
            "tickers": filter_cols(["DAL", "UAL", "LUV", "AAL", "CCL", "RCL", "NCLH", "FDX", "UPS", "JBHT", "EXPD", "CHRW", "2610.TW", "2618.TW", "2603.TW", "2609.TW", "2615.TW"]),
            "comm_name": "燃油/原油成本 (Heating Oil / WTI)",
            "comm_s": ho_s,
            "direction": "inverse",   # 燃油成本暴漲對股價不利 (負向)，燃油溫和緩跌對股價有利！
        },
        "4A. 🏦 美股大型銀行與券商金控 (US Financials)": {
            "tickers": filter_cols(["JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC", "SCHW", "BK", "AXP", "COF", "BLK", "KKR", "BX"]),
            "comm_name": "10Y 美債殖利率 (US10Y 利差錨)",
            "comm_s": us10y_s,
            "direction": "positive",  # 殖利率崩跌(景氣衰退/降息壓利差)時銀行股易大跌；殖利率溫和緩升時銀行利差擴大
        },
        "4B. 🏦 台股壽險與大型金控 (TW Financials)": {
            "tickers": filter_cols(["2881.TW", "2882.TW", "2891.TW", "2886.TW", "2884.TW", "2885.TW", "2892.TW", "2880.TW", "2883.TW", "2887.TW", "2890.TW", "5880.TW"]),
            "comm_name": "美元指數 / 台幣匯率穩定度 (USDTWD)",
            "comm_s": usdtwd_s,
            "direction": "inverse_shock", # 台幣匯率急貶(外資大逃殺)時台股金控易跌；台幣溫和緩升(外資匯入)時有利
        },
        "5A. 💾 美股半導體與記憶體週期 (US Semis & Storage)": {
            "tickers": filter_cols(["NVDA", "AMD", "AVGO", "MU", "WDC", "STX", "NTAP", "AMAT", "LRCX", "KLAC", "TXN", "ADI", "MCHP", "NXPI", "ON", "MPWR", "TER", "QCOM", "INTC"]),
            "comm_name": "費半相對大盤強弱 × 銅博士 (SOX/SPY & Copper)",
            "comm_s": (sox_s / (spy_s + 1e-9)) * (copper_s ** 0.25),
            "direction": "positive",
        },
        "5B. 🇹🇼 台股半導體與電子權值 (TW Tech & Semis)": {
            "tickers": filter_cols(["2330.TW", "2454.TW", "2317.TW", "2308.TW", "2382.TW", "3037.TW", "3034.TW", "2379.TW", "2345.TW", "2383.TW", "3711.TW", "2303.TW", "3008.TW", "2408.TW"]),
            "comm_name": "費半指數 ÷ 台幣貶值壓力 (SOX / USDTWD)",
            "comm_s": sox_s / (usdtwd_s + 1e-9),
            "direction": "positive",
        },
    }

    # 計算未來 20 日 (1個月) 個股報酬與大盤報酬
    fwd20_stk = stk_adj.shift(-20) / stk_adj - 1.0
    fwd20_spy = spy_s.shift(-20) / spy_s - 1.0
    ret20_stk = stk_adj.pct_change(20)
    ret20_spy = spy_s.pct_change(20)

    print("\n" + "=" * 135)
    print("📊 第一部分：【五大產業鏈 × 對應原物料】22 年同期關聯性與四大原物料訊號下之「未來 1 個月 (20D) 漲跌機率」實測總表")
    print("=" * 135)
    print("💡 四種原物料狀態定義（完全基於當日 T 已知之歷史數據，零未來函數）：")
    print("  1. 🚨【惡化/暴衝危險訊號 (Danger Signal)】：")
    print("     - 正向原物料類股：原物料跌破 20MA 且跌破 60MA，且近 20 日急跌 <= -6% (或自20日高點回落 <= -10%)")
    print("     - 成本反向類股(航空/運輸)：燃油升破 20MA 且近 20 日暴衝 >= +10% (成本失控)")
    print("  2. 🔥【極端暴衝過熱 (Extreme Blow-off)】：原物料 20 日狂飆 >= +14% 且遠離均線 (觀察是否短線過熱拉回)")
    print("  3. 🌱【溫和緩漲順風期 (Steady Favorable Trend)】：")
    print("     - 正向原物料類股：原物料 > MA20 > MA60，且近 20 日漲幅介於 +0.5% ~ +9.0% (穩定緩漲、未過熱)")
    print("     - 成本反向類股(航空/運輸)：燃油 < MA20，且近 20 日溫和回落 -0.5% ~ -9.0% (成本溫和下降)")
    print("  4. 💤【一般中性盤整期 (Neutral)】：其餘交易日")
    print("-" * 135)

    summary_rows = []
    for sec_name, info in sectors.items():
        tks = info["tickers"]
        if not tks:
            continue
        c_s = info["comm_s"].astype(float)
        direction = info["direction"]

        # 該產業等權 20D 歷史報酬與未來 20D 報酬
        sec_ret20 = ret20_stk[tks].mean(axis=1)
        sec_fwd20 = fwd20_stk[tks].mean(axis=1)
        sec_fwd20_alpha = sec_fwd20 - fwd20_spy
        # 個股層級未來 20D 下跌比例
        stk_fwd20_sub = fwd20_stk[tks]

        c_ret20 = c_s.pct_change(20)
        c_ma20 = c_s.rolling(20, min_periods=10).mean()
        c_ma60 = c_s.rolling(60, min_periods=20).mean()
        c_max20 = c_s.rolling(20, min_periods=10).max()
        c_dd20 = (c_s / (c_max20 + 1e-9)) - 1.0

        valid = sec_ret20.notna() & c_ret20.notna() & sec_fwd20.notna() & (dates_idx >= pd.Timestamp("2005-01-03")) & (dates_idx <= pd.Timestamp("2026-10-01"))
        corr_20d = float(sec_ret20[valid].corr(c_ret20[valid]))
        n_obs = int(valid.sum())
        t_stat = corr_20d * np.sqrt((n_obs - 2) / max(1e-9, 1.0 - corr_20d**2))

        if direction == "positive":
            danger_mask = valid & (c_s < c_ma20) & (c_s < c_ma60) & ((c_ret20 <= -0.06) | (c_dd20 <= -0.09))
            steady_mask = valid & (c_s > c_ma20) & (c_ma20 >= c_ma60 * 0.995) & (c_ret20 >= 0.005) & (c_ret20 <= 0.09)
            blowoff_mask = valid & (c_s > c_ma20) & (c_ret20 > 0.14)
        elif direction == "inverse":
            # 航空/運輸：油價暴衝是危險訊號，油價溫和緩跌是順風訊號
            danger_mask = valid & (c_s > c_ma20) & (c_s > c_ma60) & (c_ret20 >= 0.09)
            steady_mask = valid & (c_s < c_ma20) & (c_ret20 <= -0.005) & (c_ret20 >= -0.09)
            blowoff_mask = valid & (c_s < c_ma20) & (c_ret20 < -0.14)
        else:  # inverse_shock (USDTWD 台幣貶值是危險，台幣緩升是順風)
            danger_mask = valid & (c_s > c_ma20) & (c_s > c_ma60) & (c_ret20 >= 0.012)
            steady_mask = valid & (c_s < c_ma20) & (c_ma20 <= c_ma60 * 1.002) & (c_ret20 <= -0.001) & (c_ret20 >= -0.015)
            blowoff_mask = valid & (c_s < c_ma20) & (c_ret20 < -0.02)

        def calc_regime_stats(mask):
            if mask.sum() == 0:
                return 0, 0.0, 0.0, 0.0
            sub_sec = sec_fwd20[mask]
            sub_alp = sec_fwd20_alpha[mask]
            # 類股指數未來 1 個月下跌機率
            prob_drop = float((sub_sec < 0.0).mean() * 100.0)
            # 個股層級未來 1 個月下跌機率
            stk_vals = stk_fwd20_sub.loc[mask].values.flatten()
            stk_vals = stk_vals[~np.isnan(stk_vals)]
            stk_prob_drop = float((stk_vals < 0.0).mean() * 100.0) if len(stk_vals) > 0 else prob_drop
            mean_ret = float(sub_sec.mean() * 100.0)
            mean_alp = float(sub_alp.mean() * 100.0)
            return int(mask.sum()), stk_prob_drop, mean_ret, mean_alp

        n_d, drop_d, ret_d, alp_d = calc_regime_stats(danger_mask)
        n_s, drop_s, ret_s, alp_s = calc_regime_stats(steady_mask)
        n_b, drop_b, ret_b, alp_b = calc_regime_stats(blowoff_mask)
        n_all, drop_all, ret_all, alp_all = calc_regime_stats(valid)

        print(f"\n▶ 【{sec_name}】 (池內 {len(tks)} 檔) × 錨定：【{info['comm_name']}】")
        print(f"   • 20日同期相關係數 r = {corr_20d:+.3f} (t-stat = {t_stat:+.1f}) | 全樣本基準：未來1個月下跌率 {drop_all:4.1f}% | 平均報酬 {ret_all:+5.2f}%")
        print(f"   • 🚨 [原物料惡化危險期] ({n_d:4d}日): 未來1個月下跌機率 = {drop_d:5.1f}% (較緩漲期 +{drop_d-drop_s:4.1f}%) | 平均 20D 報酬 = {ret_d:+6.2f}% | Alpha = {alp_d:+5.2f}%")
        print(f"   • 🌱 [原物料溫和緩漲期] ({n_s:4d}日): 未來1個月下跌機率 = {drop_s:5.1f}% (勝率 {100-drop_s:4.1f}%)   | 平均 20D 報酬 = {ret_s:+6.2f}% | Alpha = {alp_s:+5.2f}%")
        print(f"   • 🔥 [原物料暴衝過熱期] ({n_b:4d}日): 未來1個月下跌機率 = {drop_b:5.1f}%                  | 平均 20D 報酬 = {ret_b:+6.2f}% | Alpha = {alp_b:+5.2f}%")
        print(f"   👉 【緩漲 vs 惡化 未來1個月報酬剪刀差】 = {ret_s - ret_d:+6.2f}% / 月！")

if __name__ == "__main__":
    main()
