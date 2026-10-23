#!/usr/bin/env python3
"""
=====================================================================================
 🛡️ 全球主權泰坦模型：2005-2019 (15年) & 2010-2014 (5年) 歷史區間擴充對比回測
=====================================================================================
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from test_daily_ma60_stop_recent_3y import load_data_and_features, run_simulation, calc_kpis

def main():
    print("=" * 85)
    print(" 🛡️ 全球主權泰坦模型：2005-2019 & 2010-2014 歷史區間擴充深度對比回測")
    print("=" * 85)

    data = load_data_and_features()

    print("\n[2/3] 執行雙軌全歷史模擬 (原版週期換倉 vs 日頻60MA停損)...")
    eq_base = run_simulation(data, enable_daily_ma60_stop=False)
    eq_stop = run_simulation(data, enable_daily_ma60_stop=True)

    print("\n[3/3] 統計目標區間表現...")

    # 1. 區間 A: 2005-01-01 ~ 2019-12-31 (15 年長期跨週期)
    k_0519_base = calc_kpis(eq_base, '2005-01-01', '2019-12-31')
    k_0519_stop = calc_kpis(eq_stop, '2005-01-01', '2019-12-31')

    # 2. 區間 B: 2010-01-01 ~ 2014-12-31 (5 年傳統復甦期)
    k_1014_base = calc_kpis(eq_base, '2010-01-01', '2014-12-31')
    k_1014_stop = calc_kpis(eq_stop, '2010-01-01', '2014-12-31')

    # 3. 現代期: 2022-01-01 ~ 2026-10-23 (近 4 年 AI 時代)
    k_modern_base = calc_kpis(eq_base, '2022-01-01', '2026-10-23')
    k_modern_stop = calc_kpis(eq_stop, '2022-01-01', '2026-10-23')

    print("\n" + "=" * 95)
    print(f" 📅 區間 A：2005-2019 年 (長達 15 年，含 2008海嘯/2011歐債/2015股災/2018貿易戰)")
    print("=" * 95)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 95)
    print(f"{'🎯 原版 (週期調倉檢驗)':<22} | {k_0519_base['CAGR']:>6.2f}% | {k_0519_base['multiplier']:>8.2f}x | {k_0519_base['Month_MDD']:>8.2f}% | {k_0519_base['Sharpe']:>6.2f} | {k_0519_base['Calmar']:>6.3f} | {k_0519_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日砍)':<22} | {k_0519_stop['CAGR']:>6.2f}% | {k_0519_stop['multiplier']:>8.2f}x | {k_0519_stop['Month_MDD']:>8.2f}% | {k_0519_stop['Sharpe']:>6.2f} | {k_0519_stop['Calmar']:>6.3f} | {k_0519_stop['Win_Rate']:>5.1f}%")
    print(f"👉 差異變化：CAGR {k_0519_stop['CAGR'] - k_0519_base['CAGR']:+.2f}%, 月最大回撤變化 {k_0519_stop['Month_MDD'] - k_0519_base['Month_MDD']:+.2f}%")

    print("\n" + "=" * 95)
    print(f" 📅 區間 B：2010-2014 年 (整整 5 年，AI 出現前的早期傳統量化/人類主導市場)")
    print("=" * 95)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 95)
    print(f"{'🎯 原版 (週期調倉檢驗)':<22} | {k_1014_base['CAGR']:>6.2f}% | {k_1014_base['multiplier']:>8.2f}x | {k_1014_base['Month_MDD']:>8.2f}% | {k_1014_base['Sharpe']:>6.2f} | {k_1014_base['Calmar']:>6.3f} | {k_1014_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日砍)':<22} | {k_1014_stop['CAGR']:>6.2f}% | {k_1014_stop['multiplier']:>8.2f}x | {k_1014_stop['Month_MDD']:>8.2f}% | {k_1014_stop['Sharpe']:>6.2f} | {k_1014_stop['Calmar']:>6.3f} | {k_1014_stop['Win_Rate']:>5.1f}%")
    print(f"👉 差異變化：CAGR {k_1014_stop['CAGR'] - k_1014_base['CAGR']:+.2f}%, 月最大回撤變化 {k_1014_stop['Month_MDD'] - k_1014_base['Month_MDD']:+.2f}%")

    print("\n" + "=" * 95)
    print(f" 📅 現代對照：2022-2026 年 (現代 AI/大模型/高頻量化演算法佔比 85% 爆發期)")
    print("=" * 95)
    print(f"{'策略版本':<22} | {'CAGR':<8} | {'總累積倍數':<10} | {'Month MDD':<10} | {'Sharpe':<7} | {'Calmar':<7} | {'月勝率'}")
    print("-" * 95)
    print(f"{'🎯 原版 (週期調倉檢驗)':<22} | {k_modern_base['CAGR']:>6.2f}% | {k_modern_base['multiplier']:>8.2f}x | {k_modern_base['Month_MDD']:>8.2f}% | {k_modern_base['Sharpe']:>6.2f} | {k_modern_base['Calmar']:>6.3f} | {k_modern_base['Win_Rate']:>5.1f}%")
    print(f"{'🛡️ 改版 (破60MA隔日砍)':<22} | {k_modern_stop['CAGR']:>6.2f}% | {k_modern_stop['multiplier']:>8.2f}x | {k_modern_stop['Month_MDD']:>8.2f}% | {k_modern_stop['Sharpe']:>6.2f} | {k_modern_stop['Calmar']:>6.3f} | {k_modern_stop['Win_Rate']:>5.1f}%")
    print(f"👉 差異變化：CAGR {k_modern_stop['CAGR'] - k_modern_base['CAGR']:+.2f}%, 月最大回撤變化 {k_modern_stop['Month_MDD'] - k_modern_base['Month_MDD']:+.2f}%")
    print("=" * 95)

    out_file = "/Users/huanggin-chen/openclaw_test/expanded_periods_ma60_comparison.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            'period_2005_2019': {'baseline': k_0519_base, 'stop': k_0519_stop},
            'period_2010_2014': {'baseline': k_1014_base, 'stop': k_1014_stop},
            'period_2022_2026': {'baseline': k_modern_base, 'stop': k_modern_stop}
        }, f, indent=2, ensure_ascii=False)
    print(f"\n完整對比已保存至: {out_file}")

if __name__ == '__main__':
    main()
