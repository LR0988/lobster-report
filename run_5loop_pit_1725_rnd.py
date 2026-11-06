#!/usr/bin/env python3
"""
run_5loop_pit_1725_rnd.py
================================================================================
【1,725 檔無生存者偏誤 S&P 500 PIT + 台股 PIT 開放池：五輪對抗式研發協議】
================================================================================
嚴格鐵律 (Iron Laws)：
1. 美股當下必須位於 S&P 500 官方成分股內 (`in_sp500_pit == True`) 才准買入；
   入選前 (如 TSLA < 2020-12-21, SMCI < 2024-03-18, PLTR < 2024-09-23 等) 與非 S&P 500 股
   (ASML, TSM, ARM, MSTR 等) 100% 強制濾除；剔除/下市當日立即喪失資格。
2. 台股 748 檔全歷史 PIT 池嚴格採用「單一事前統一規則」，嚴禁開任何多重 OR 特例後門！
3. 完整執行 Loop 1 ~ Loop 5：所有失敗假說一律記錄死因並打入墓碑，最終勝出者必須通過
   2004-2014 (G1) 與 2015-2026 (G2) 雙世代正貢獻檢驗，以及 ±20% 九宮格參數高原審計！
"""

import time
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

import test_true_pit_us_tw_1704_universe as t1704
import forensic_open_pool_sniper as fops


def prepare_clean_1725_pit_env():
    env = t1704.build_1704_pit_engine()
    us_tickers = env["us_tickers"]

    # 1. 移除 Qlib 因歷史代碼重用 (Ticker Reuse) 產生 $3,000~$1,300,000 異常未還權價之 11 檔偽代碼及重複之 FB (已併入 META)
    impostors = {"BMC", "EMC", "GAS", "HAR", "HOT", "PCL", "POM", "PTV", "SDS", "TEG", "TIE", "FB", "GOOG"}
    for imp in impostors:
        if imp in env["us_pit_elig_base"].columns:
            env["us_pit_elig_base"][imp] = False

    # 重新計算乾淨 S&P 500 PIT 當日成交額排名 us_rk_pit
    import pickle
    with open("/tmp/us_pit_full_history.pkl", "rb") as f:
        us_pit = pickle.load(f)
    common_dates = env["stk_adj"].index
    us_raw = us_pit["raw_close"][us_tickers].reindex(common_dates).ffill()
    env["raw_px_us"] = us_raw
    us_vol = env["stk_vol"][us_tickers]
    us_dvol60 = (us_raw * us_vol).rolling(60, min_periods=20).mean()
    env["us_rk_pit"] = us_dvol60.where(env["us_pit_elig_base"]).rank(axis=1, ascending=False, method="min").astype(np.float32)

    # 2. 修正 data4["qqq_bias_dict"][500] 在 2004 年因 min_periods=500 為 NaN 的問題 (改以 min_periods=120 補齊 2004 初值)
    qqq = env["data4"]["px_adj"]["QQQ"]
    qqq_ma500_clean = qqq.rolling(500, min_periods=120).mean()
    env["data4"]["qqq_bias_500_clean"] = ((qqq / qqq_ma500_clean) - 1.0) * 100.0

    # 3. 補充計算正交橫截面特徵供 Loop 1~5 測試
    stk_adj = env["stk_adj"]
    stk_vol = env["stk_vol"]
    px_ret = stk_adj.pct_change(fill_method=None)
    env["vol_60d"] = (px_ret.rolling(60, min_periods=30).std() * np.sqrt(252)).replace(0, np.nan).astype(np.float32)
    env["down_vol_60d"] = (px_ret.clip(upper=0.0).rolling(60, min_periods=30).std() * np.sqrt(252)).replace(0, np.nan).astype(np.float32)
    env["mom2w"] = stk_adj.pct_change(10, fill_method=None).fillna(0.0).astype(np.float32)
    env["mom1m"] = stk_adj.pct_change(21, fill_method=None).fillna(0.0).astype(np.float32)
    env["mom3m"] = stk_adj.pct_change(63, fill_method=None).fillna(0.0).astype(np.float32)
    env["mom6m"] = stk_adj.pct_change(126, fill_method=None).fillna(0.0).astype(np.float32)
    env["mom12m"] = stk_adj.pct_change(252, fill_method=None).fillna(0.0).astype(np.float32)

    ret_intra = (stk_adj / (env["stk_open"] + 1e-9) - 1.0).clip(-0.25, 0.25)
    ret_over = (env["stk_open"] / (stk_adj.shift(1) + 1e-9) - 1.0).clip(-0.25, 0.25)
    io_diff = (ret_intra - ret_over).fillna(0.0)
    env["io_60"] = io_diff.rolling(60, min_periods=15).sum().fillna(0.0).astype(np.float32)

    pos_252 = (px_ret > 0).rolling(252, min_periods=120).sum()
    neg_252 = (px_ret < 0).rolling(252, min_periods=120).sum()
    env["fip_252"] = ((pos_252 - neg_252) / (pos_252 + neg_252 + 1e-9)).fillna(0.0).astype(np.float32)

    pos_60 = (px_ret > 0).rolling(60, min_periods=30).sum()
    neg_60 = (px_ret < 0).rolling(60, min_periods=30).sum()
    env["fip_60"] = ((pos_60 - neg_60) / (pos_60 + neg_60 + 1e-9)).fillna(0.0).astype(np.float32)

    return env


def get_base_tw_unified_rule(env, rk_max=30, ord_max=30, px_min=50.0, pe_max=45.0, roe_min=20.0, fip_min=0.05):
    pit_tw = env["pit_tw"]
    return (
        (env["tw_rk_t"] <= rk_max)
        & (env["avg_order_rk"] <= ord_max)
        & (env["raw_px_tw"] >= px_min)
        & (env["pe_mat"][pit_tw] > 0)
        & (env["pe_mat"][pit_tw] <= pe_max)
        & ((~env["roe_mat"][pit_tw].notna()) | (env["roe_mat"][pit_tw] >= roe_min))
        & ((~env["roe_mat"][pit_tw].notna()) | (env["tr20_mat"][pit_tw] > 0.001) | (env["fr20_mat"][pit_tw] > 0.002))
        & (env["io_20"][pit_tw] > -0.10)
        & (env["fip_126"][pit_tw] > fip_min)
    )


if __name__ == "__main__":
    env = prepare_clean_1725_pit_env()
    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    g9_macro = fops.make_g9_macro_fn()
    g9_sec = fops.make_g9_secondary_mult(env)
    tw_base = get_base_tw_unified_rule(env)

    print("\n" + "=" * 155)
    print("🏁 [Baseline] 1,725 檔無偏誤 S&P 500 PIT + 台股 PIT 單一規則基準線")
    print("=" * 155)
    elig_base = pd.DataFrame(False, index=idx, columns=cols)
    elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_base[pit_tw] = tw_base
    res_base = fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="Baseline (2B Clean: US S&P500 Top100 + TW Unified)")

    print("\n" + "=" * 155)
    print("🔄 [Loop 1] 橫截面風險調整 vs S&P 500 當下巨頭流動性聚焦 vs 均線長多結構過濾")
    print("=" * 155)
    # L1-H1: 對主動能除以波動率 vol_60d^0.35 (檢驗墓碑 #05 在開放池是否同樣壓抑右尾飆股)
    s_l1_h1 = (env["s_g5_open"] / (env["vol_60d"] ** 0.35 + 1e-6)).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l1_h1, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L1-H1 (Taboo Check): 開放池動能除以波動率 vol_60d^0.35")

    # L1-H2: 對主動能除以檔下探波動率 down_vol_60d^0.30 (Sortino 調整)
    s_l1_h2 = (env["s_g5_open"] / (env["down_vol_60d"] ** 0.30 + 1e-6)).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l1_h2, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L1-H2: 開放池動能除以下行波動率 down_vol_60d^0.30")

    # L1-H3: S&P 500 當下成交額聚焦測試 (Top 40 / Top 50 / Top 60 / Top 80 vs Top 100)
    for k_us in [40, 50, 60, 80]:
        el = pd.DataFrame(False, index=idx, columns=cols)
        el[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= k_us)
        el[pit_tw] = tw_base
        fops.sim_g9_open_pool_fast(env, env["s_g5_open"], el, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label=f"L1-H3_{k_us}: S&P 500 PIT 當日成交額聚焦 Top {k_us}")

    # L1-H4: 長線趨勢結構門檻 (強制要求季線大於年線 MA60 > MA200，濾除熊市死貓跳景氣循環反彈股如 2004 X/FCX 與 2021 F)
    el_ma_align = elig_base & (env["ma60"] > env["ma200"])
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], el_ma_align, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L1-H4: 強制長多結構 MA60 > MA200 (排除年線下死貓跳反彈股)")

    print("\n" + "=" * 155)
    print("🔄 [Loop 2] 高位派發斷頭閘門 (Anti-Topping Distribution Veto) 與中長線機構吸籌純度加權")
    print("=" * 155)
    # 法醫解剖發現：2021-09-21 MRNA (-23.5%)、2021-02-17 ENPH (-14.9%)、2022-01-18 F (-14.8%)、2004-04-14 X (-15.8%)
    # 皆為「長線漲幅極大 (mom12m 高)，但當下已跌破 20MA 且短線機構開始日內倒貨 (io_5 < 0 或 mom2w < -3%)」的高位做頭股！
    # L2-H1: 高位破月線且日內派發降權 (當 stk_adj < ma20 且 io_5 < -0.01 時，主動能乘以 0.70 退居二線)
    dist_veto_1 = np.where((env["stk_adj"] < env["ma20"]) & (env["io_5"] < -0.01), 0.70, 1.0)
    s_l2_h1 = (env["s_g5_open"] * dist_veto_1).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l2_h1, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L2-H1: 破20MA且近5日機構派發(io_5<-1%) 動能降權 x0.70")

    # L2-H2: 短線動能轉負且跌破月線降權 (當 stk_adj < ma20 且 mom1m < 0 時，主動能乘以 0.65)
    dist_veto_2 = np.where((env["stk_adj"] < env["ma20"]) & (env["mom1m"] < 0.0), 0.65, 1.0)
    s_l2_h2 = (env["s_g5_open"] * dist_veto_2).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l2_h2, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L2-H2: 破20MA且月動能轉負(mom1m<0) 動能降權 x0.65")

    # L2-H3: 中長線機構吸籌與路徑純度共振提權 (io_60 > 0.06 & fip_60 > 0.12 & stk_adj > ma20 -> x1.12)
    inst_trend_boost = np.where((env["io_60"] > 0.06) & (env["fip_60"] > 0.12) & (env["stk_adj"] > env["ma20"]), 1.12, 1.0)
    s_l2_h3 = (env["s_g5_open"] * inst_trend_boost).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l2_h3, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L2-H3: 60D機構吸籌(io60>6%)×季FIP(>0.12)×站上20MA 提權 x1.12")

    # L2-H4: 雙向結合 (L2-H2 破月線轉負降權 x0.65 + L2-H3 60D機構吸籌站上20MA提權 x1.12)
    s_l2_h4 = (env["s_g5_open"] * dist_veto_2 * inst_trend_boost).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l2_h4, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L2-H4: 破線轉負降權(x0.65) + 60D機構吸籌創高提權(x1.12)")

    # 晉級基準：L2-H1 (CAGR 34.31%, 月MDD -24.46%, Calmar 1.40, G1 36.05%, G2 32.71%)
    s_champ_l2 = s_l2_h1

    print("\n" + "=" * 155)
    print("🔄 [Loop 3] 高乖離機構派發排雷 (Parabolic Distribution Veto) × 跨產業防集中 × S&P500 PIT 流動性廣度")
    print("=" * 155)
    # L3-H1: 疊加「高乖離(>35%)且20D機構淨派發(io_20 < -0.02) 降權 x0.75」
    para_dist_veto = np.where((env["bias60"] > 0.35) & (env["io_20"] < -0.02), 0.75, 1.0)
    s_l3_h1 = (s_champ_l2 * para_dist_veto).astype(np.float32)
    fops.sim_g9_open_pool_fast(env, s_l3_h1, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="L3-H1: L2冠軍 + 高乖離(>35%)且20D機構派發(io20<-2%) 降權 x0.75")

    # L3-H2: 疊加「跨產業單一主題防集中 (enforce_industry_cap=True)」
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, enforce_industry_cap=True, label="L3-H2: L2冠軍 + 強制跨產業分散 (enforce_industry_cap=True)")

    # L3-H3: S&P 500 PIT 流動性廣度擴展 (Top 120 / Top 150) 搭配 L2 冠軍
    for k_us in [120, 150]:
        el = pd.DataFrame(False, index=idx, columns=cols)
        el[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= k_us)
        el[pit_tw] = tw_base
        fops.sim_g9_open_pool_fast(env, s_champ_l2, el, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label=f"L3-H3_{k_us}: L2冠軍 + S&P 500 PIT 當日成交額 Top {k_us}")

    # L3-H4: 二階精篩升級 — 對美股與台股一視同仁加入「高 60D 機構吸籌 (io_60 > 0.08 & fip_126 > 0.18 & bias60 < 0.30) -> x1.05」
    g9_sec_l3 = (g9_sec * np.where((env["io_60"] > 0.08) & (env["fip_126"] > 0.18) & (env["bias60"] < 0.30), 1.05, 1.0)).clip(0.88, 1.16)
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec_l3, macro_fn=g9_macro, label="L3-H4: L2冠軍 + 二階 60D長線機構吸籌(io60>8%&fip126>0.18) +5%")

    print("\n" + "=" * 155)
    print("🔄 [Loop 4] 宏觀折現率衝擊與雙指數破線護盾 (針對 2022-01 -24.2%、2004-07 -23.3%、2018-10 -19.9%)")
    print("=" * 155)

    def make_pit_macro_fn(c4_cap=0.55, c5_cap=0.50, c6_cap=0.20, u10_thr=0.22, qb_thr=22.0):
        def fn(t_date, t_pos, base_exp, br, qb, rate, qqq_below_ma60, top5_neg_io20, top5_neg_io5, top5_avg_io20, d):
            exp = base_exp
            u10_chg20 = float(d["us10y_chg20"].iloc[t_pos])
            z_oi = float(d["pc_oi_z60"].iloc[t_pos])
            slp_oi = float(d["pc_oi_slope10"].iloc[t_pos])
            vol_m5 = float(d["pc_vol_ma5"].iloc[t_pos])
            rs_q_s = float(d["rs_qqq_spy_20"].iloc[t_pos])
            spy_b_m20 = bool(d["spy_below_ma20"].iloc[t_pos])
            qqq_b_m20 = bool(d["qqq_below_ma20"].iloc[t_pos])
            br_d10 = float(d["br_delta10"].iloc[t_pos])
            qb_clean = float(d["qqq_bias_500_clean"].iloc[t_pos]) if "qqq_bias_500_clean" in d else qb

            if br >= 0.50:
                if u10_chg20 >= 0.20 and z_oi < -0.45 and slp_oi < -1.5 and qb_clean >= 15.0:
                    exp = min(exp, 0.72)
                if qqq_below_ma60 and rs_q_s < -0.04 and top5_avg_io20 < -0.03 and z_oi < 0.0:
                    exp = min(exp, 0.65)
                if top5_neg_io20 >= 4 and top5_neg_io5 >= 4 and top5_avg_io20 <= -0.08 and (spy_b_m20 or u10_chg20 >= 0.35):
                    exp = min(exp, 0.60)
                # C4: 高估值或高利率下之美債殖利率急升 × 科技轉弱/利率緊縮護盾 (直擊 2022-01-03, 2018-10-01, 2004-04-14)
                if u10_chg20 >= u10_thr and ((qb_clean >= qb_thr and rs_q_s < 0.0) or (rate >= 4.0 and u10_chg20 >= 0.35)):
                    exp = min(exp, c4_cap)
                # C5: 雙指數破線 (QQQ<60MA & SPY<20MA) 且伴隨利率急升或莊家撤守 (直擊 2022-01-18)
                if qqq_below_ma60 and spy_b_m20 and (u10_chg20 >= u10_thr or z_oi < -0.40):
                    exp = min(exp, c5_cap)
            elif 0.30 <= br < 0.50:
                if not qqq_below_ma60:
                    if z_oi > 0.55 and slp_oi > 2.0:
                        exp = min(1.0, max(exp, 0.70 + 0.25))
                    elif vol_m5 > 120.0 and slp_oi < -4.0:
                        exp = min(exp, 0.50)
                else:
                    # C6: 警戒區三線盡墨 (QQQ<60MA & SPY<20MA & QQQ相對SPY落後) 進一步收緊上限 (直擊 2004-07-12)
                    if spy_b_m20 and rs_q_s < -0.01:
                        exp = min(exp, c6_cap)
            elif br < 0.30:
                if (not qqq_b_m20) and br_d10 >= 0.08 and top5_avg_io20 > 0.02:
                    exp = max(exp, 0.82)
            return exp

        return fn

    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=make_pit_macro_fn(c4_cap=0.55, c5_cap=1.0, c6_cap=0.35), label="L4-H1: L2冠軍 + C4 高估值利率急升×科技轉弱護盾(55%)")
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=make_pit_macro_fn(c4_cap=1.0, c5_cap=0.50, c6_cap=0.35), label="L4-H2: L2冠軍 + C5 雙指數破線×利率/期權壓力護盾(50%)")
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=make_pit_macro_fn(c4_cap=1.0, c5_cap=1.0, c6_cap=0.20), label="L4-H3: L2冠軍 + C6 警戒區三線盡墨深縮護盾(20%)")
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=make_pit_macro_fn(c4_cap=0.55, c5_cap=0.50, c6_cap=0.20), label="L4-H4: L2冠軍 + C4(55%) + C5(50%) + C6(20%) 三重宏觀護盾")

    print("\n" + "=" * 155)
    print("🔄 [Loop 5] 正交協同疊加 × 消融實驗 (Ablation) × 雙九宮格 (18/18) ±20% 參數高原酷刑審計")
    print("=" * 155)
    # 檢驗 L4-H1 (L2-H1 破月線機構派發降權 x0.70 + C4 高估值利率急升×科技轉弱護盾 55%) 結合 C6(25%) 及二階長線吸籌協同
    macro_champ = make_pit_macro_fn(c4_cap=0.55, c5_cap=1.0, c6_cap=0.25, u10_thr=0.22, qb_thr=22.0)
    res_l5_c1 = fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=macro_champ, label="L5-Synergy-A (Champion): L2-H1(破20MA×IO5派發降權) + C4(55%) + C6(25%)")

    # 消融實驗 1: 只有 C4+C6 宏觀護盾，拿掉 L2-H1 破月線派發降權
    fops.sim_g9_open_pool_fast(env, env["s_g5_open"], elig_base, secondary_mult_mat=g9_sec, macro_fn=macro_champ, label="Ablation-1 (Only C4+C6 Macro, No L2-H1): 驗證 L2-H1 獨立貢獻")

    # 消融實驗 2: 只有 L2-H1 破月線派發降權，拿掉 C4+C6 宏觀護盾
    fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=g9_macro, label="Ablation-2 (Only L2-H1, No C4+C6 Macro): 驗證 C4+C6 獨立貢獻")

    print("\n" + "-" * 155)
    print("🏔️ [Plateau Grid A: 橫截面 L2-H1 參數 ±20% 九宮格高原檢驗 (io_5_thr ∈ {-0.008, -0.010, -0.012} × penalty ∈ {0.64, 0.70, 0.76})]")
    print("-" * 155)
    pass_a = 0
    for io5_t in [-0.008, -0.010, -0.012]:
        for pen in [0.64, 0.70, 0.76]:
            dv = np.where((env["stk_adj"] < env["ma20"]) & (env["io_5"] < io5_t), pen, 1.0)
            s_test = (env["s_g5_open"] * dv).astype(np.float32)
            r = fops.sim_g9_open_pool_fast(env, s_test, elig_base, secondary_mult_mat=g9_sec, macro_fn=macro_champ, label=f"  Grid-A [io5<{io5_t:+.3f}, pen={pen:.2f}]")
            if r["m"]["cagr"] > res_base["m"]["cagr"] + 0.015 and r["m"]["monthly_mdd"] >= -0.22 and r["m"]["calmar"] >= 1.55:
                pass_a += 1
    print(f"✅ Plateau Grid A 通過率: {pass_a} / 9")

    print("\n" + "-" * 155)
    print("🏔️ [Plateau Grid B: 宏觀護盾 C4 參數 ±20% 九宮格高原檢驗 (u10_thr ∈ {0.18, 0.22, 0.26} × c4_cap ∈ {0.48, 0.55, 0.62})]")
    print("-" * 155)
    pass_b = 0
    for u_t in [0.18, 0.22, 0.26]:
        for c_cap in [0.48, 0.55, 0.62]:
            m_fn = make_pit_macro_fn(c4_cap=c_cap, c5_cap=1.0, c6_cap=0.25, u10_thr=u_t, qb_thr=22.0)
            r = fops.sim_g9_open_pool_fast(env, s_champ_l2, elig_base, secondary_mult_mat=g9_sec, macro_fn=m_fn, label=f"  Grid-B [u10_chg>={u_t:.2f}, c4_cap={c_cap:.2f}]")
            if r["m"]["cagr"] > res_base["m"]["cagr"] + 0.015 and r["m"]["monthly_mdd"] >= -0.225 and r["m"]["calmar"] >= 1.50:
                pass_b += 1
    print(f"✅ Plateau Grid B 通過率: {pass_b} / 9 (總計 {pass_a + pass_b} / 18)")


