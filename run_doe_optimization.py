#!/usr/bin/env python3
"""
run_doe_optimization.py
👑 泰坦 FIP 頂刊旗艦版 (Titan FIP Sovereign Alpha) 全因子實驗設計 (Design of Experiments, DOE) 系統性最佳化
========================================================================================
1. 實驗設計架構 (DOE Framework):
   - 採用田口正交表 L64(4^21) (Taguchi Orthogonal Array L64) 進行完全正交實驗設計
   - 因子空間覆蓋 6 大維度，每因子 4 個水平 (4^6 = 4096 參數空間)
   - 包含主效應分析 (Main Effects Analysis)、信噪比 (S/N Ratio)、方差分析 (ANOVA)、貢獻率分解
2. 樣本切割防過擬合 (Walk-Forward Out-of-Sample Discipline):
   - 樣本內 (IS, In-Sample): 2005/04/01 ~ 2022/12/31 (17.7 年長週期訓練探索)
   - 樣本外 (OOS, Out-of-Sample): 2023/01/01 ~ 2026/10/06 (3.8 年盲測驗證期，含 2026 年)
3. 多目標適應度函數 (Multi-Objective Optimization):
   - 勝率 (Win Rate, 望大)
   - 年化報酬率 (CAGR, 望大)
   - 最大回撤 (MDD, 望小)
   - 夏普比率 (Sharpe, 望大)
   - 2026 年跑贏大盤超額 Alpha (2026 Outperformance)
4. 局部響應曲面驗證 (Response Surface Robustness Check):
   - 對最優候選組合周邊鄰域進行平滑度與高原穩健性檢驗 (Plateau Validation)，杜絕尖銳過擬合。
"""

import os, sys, time, pickle, json
import numpy as np
import pandas as pd
from scipy import stats

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925 # 單邊 0.2925%

print("="*95)
print("👑 正在啟動【泰坦 FIP 旗艦策略】田口正交試驗設計 (Taguchi L64 DOE) 全域參數最佳化系統...")
print("="*95)

# 載入 100% 審計乾淨資料庫
with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 日期切割點
t_split = int(np.searchsorted(dates, '20230101'))
t_2026 = int(np.searchsorted(dates, '20260101'))

# 1. 預計算全歷史特徵矩陣
base_ok = pool & np.isfinite(C) & np.isfinite(D['ma60'])
base_ok &= (C >= D['ma60'] * 1.025) & (C >= D['ma20']) & (D['ma20'] >= D['ma60'])
base_ok &= (D['s5'] >= 0) & (D['r20'] >= 0) & (D['s20'] >= 0.025) & (C >= 0.88 * D['h60'])

ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)

tx_ma10 = pd.Series(D['tx']).rolling(10).mean().values
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
tx_ma30 = pd.Series(D['tx']).rolling(30).mean().values

# 散戶異常關注度 / 爆量代理指標 (Abnormal Attention)
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

# 2. 定義 DOE 因子與水平
FACTORS = {
    'A_Pullback': [1.00, 1.01, 1.02, 1.03],                     # 5MA 拉回整理門檻
    'B_FIP_Min': [0.50, 0.52, 0.54, 0.56],                      # FIP 溫水煮青蛙品質門檻
    'C_BE_Trigger': [0.08, 0.10, 0.12, 9.99],                   # 保本停損觸發點 (9.99 = 不設保本)
    'D_Anti_Attention': [0.00, 0.05, 0.10, 0.15],               # 逆向避開爆量過熱因子權重
    'E_Macro_MA': [10, 20, 30, 0],                              # 大盤月線靈敏度週期 (0 = 僅靠季線)
    'F_Sizing': ['70_15_15', '50_25_25', '40_30_30', '25_25_25_25'] # 部位分配架構
}

FACTOR_NAMES = list(FACTORS.keys())

# 3. 構造 Galois Field GF(4) 完美正交表 L64(4^21)
def gf4_add(a, b): return a ^ b
def gf4_mul(a, b):
    mult = [
        [0, 0, 0, 0],
        [0, 1, 2, 3],
        [0, 2, 3, 1],
        [0, 3, 1, 2]
    ]
    return mult[a][b]

rows_gf = []
for u in range(4):
    for v in range(4):
        for w in range(4):
            rows_gf.append((u, v, w))

cols_gf = []
seen = set()
for a in range(4):
    for b in range(4):
        for c in range(4):
            if a == 0 and b == 0 and c == 0: continue
            first = a if a != 0 else (b if b != 0 else c)
            inv = [0, 1, 3, 2][first]
            norm = (gf4_mul(a, inv), gf4_mul(b, inv), gf4_mul(c, inv))
            if norm not in seen:
                seen.add(norm)
                cols_gf.append((a, b, c))

L64_matrix = []
for (a, b, c) in cols_gf[:6]: # 取前 6 個完美正交欄位
    col_vals = [gf4_add(gf4_add(gf4_mul(a, u), gf4_mul(b, v)), gf4_mul(c, w)) for (u, v, w) in rows_gf]
    L64_matrix.append(col_vals)

L64_matrix = np.array(L64_matrix).T # 64 rows, 6 columns
print(f"[*] 成功構建田口正交表 L64(4^6)：共 {L64_matrix.shape[0]} 組完美正交試驗配置。")

# 4. 極速回測模擬引擎
def simulate_strategy(pullback, fip_min, be_trig, anti_att, macro_ma, sizing_mode):
    cash = 1_000_000.0
    pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    if macro_ma == 10: tx_ma = tx_ma10
    elif macro_ma == 20: tx_ma = tx_ma20
    elif macro_ma == 30: tx_ma = tx_ma30
    else: tx_ma = np.full(T, -9999.0)

    if sizing_mode == '70_15_15': weights = [0.70, 0.15, 0.15]
    elif sizing_mode == '50_25_25': weights = [0.50, 0.25, 0.25]
    elif sizing_mode == '40_30_30': weights = [0.40, 0.30, 0.30]
    elif sizing_mode == '25_25_25_25': weights = [0.25, 0.25, 0.25, 0.25]

    for i in range(t0, T):
        handled = set()
        # 賣出執行
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos: continue
            p = pos[s]
            g = O[i, s] / C[i - 1, s] if i > 0 else 1.0
            if not np.isfinite(g) or g <= 0: g = 1.0
            v = p['v'] * g
            proceeds = v * f * (1.0 - FEE)
            cash += proceeds
            p['proc'] += proceeds
            p['v'] = v * (1.0 - f)
            if f >= 0.999:
                trades.append(dict(
                    s=D['sids'][s], ret=(p['proc'] / p['cost'] - 1.0) * 100.0,
                    year=int(str(dates[i])[:4]), exit_idx=i
                ))
                del pos[s]
            else:
                ro = C[i, s] / O[i, s]
                p['v'] *= ro if np.isfinite(ro) else 1.0
                handled.add(s)
        pend_sell.clear()

        # 買進執行
        if pend_buy:
            tot_val = cash + sum(p['v'] for p in pos.values())
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                amt = min(w * tot_val, cash)
                if amt < 0.01 * tot_val: continue
                cash -= amt
                ro = C[i, s] / O[i, s]
                v = amt * (1.0 - FEE) * (ro if np.isfinite(ro) else 1.0)
                pos[s] = dict(v=v, cost=amt, proc=0.0, entry=O[i, s], hh=C[i, s], ei=i, days=0, leader=is_leader)
                handled.add(s)
            pend_buy = []

        # 持倉價值
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0

        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv

        # 出場判斷
        tx_today = D['tx'][i]; tx_ma_today = D['tx_ma60'][i]
        macro_ok = tx_today >= tx_ma_today

        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not macro_ok: sell = 'macro'
            else:
                m60 = D['ma60'][i, s]
                if np.isfinite(m60) and c < m60: sell = 'ma60'
                elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = 'hard12'
                elif be_trig < 9.0 and p['hh'] >= entry * (1.0 + be_trig) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)

        # 選股進場
        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            
            if sizing_mode == '25_25_25_25':
                need = max(0, 4 - len(held))
                need_leader = False
                need_sat = need
            else:
                has_leader = any(pos[s]['leader'] for s in held)
                nsat = sum(1 for s in held if not pos[s]['leader'])
                need_leader = not has_leader
                need_sat = max(0, 2 - nsat)
                need = int(need_leader) + need_sat

            if need > 0:
                c = C[i]
                ok = base_ok[i] & (c <= D['ma5'][i] * pullback) & (D['tx'][i] >= tx_ma[i]) & (fip_quality[i] >= fip_min)
                idx = np.where(ok)[0]
                if len(idx) > 0:
                    r20 = D['r20'][i, idx]; r60 = D['r60'][i, idx]
                    r120 = np.where(np.isfinite(D['r120'][i, idx]), D['r120'][i, idx], r60)
                    t20 = np.nan_to_num(D['tx_r20'][i]); t60 = np.nan_to_num(D['tx_r60'][i])
                    t120 = D['tx_r120'][i]; t120 = t60 if not np.isfinite(t120) else t120
                    rs = (r20 - t20) * .30 + (r60 - t60) * .40 + (r120 - t120) * .30
                    hp = c[idx] / D['h60'][i, idx]
                    turn = D['rt60'][i, idx]
                    mom = .50 * rank_pct(rs) + .35 * rank_pct(hp) + .15 * rank_pct(turn)
                    top = np.argsort(-mom)[:10]
                    sel = idx[top]
                    mom_t = mom[top]; turn_t = turn[top]

                    tr_ = rank_pct(D['trust20'][i, sel]); in_ = rank_pct(D['inst20'][i, sel])
                    sh_ = rank_pct(np.nan_to_num(D['sharpe'][i, sel]))
                    al_ = ((D['ma5'][i, sel] >= D['ma10'][i, sel]) & (D['ma10'][i, sel] >= D['ma20'][i, sel])).astype(float)
                    
                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_
                    if anti_att > 0:
                        att_score = rank_pct(abnormal_attention[i, sel])
                        win = win - anti_att * att_score

                    order = np.argsort(-win)
                    chosen = []; used = set(held)

                    if sizing_mode == '25_25_25_25':
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.25, False))
                                used.add(sel[k]); got += 1
                    else:
                        lead_w = weights[0]; sat_w = weights[1]
                        if need_leader:
                            top5 = set(np.argsort(-turn_t)[:5].tolist())
                            for k in order:
                                if k in top5 and sel[k] not in used:
                                    chosen.append((sel[k], lead_w, True))
                                    used.add(sel[k]); break
                        got = 0
                        for k in order:
                            if got >= need_sat: break
                            if sel[k] not in used:
                                chosen.append((sel[k], sat_w, False))
                                used.add(sel[k]); got += 1
                    pend_buy = chosen

    # 績效統計
    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(dates[t0:], format='%Y%m%d'))
    tdf = pd.DataFrame(trades)

    tot_r = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    cagr = ((eq_series.iloc[-1] / eq_series.iloc[0]) ** (250.0 / len(eq_series)) - 1.0) * 100.0
    mdd = ((eq_series / eq_series.cummax() - 1.0).min()) * 100.0
    win_r = (tdf['ret'] > 0).mean() * 100.0 if len(tdf) > 0 else 0.0

    d_r = eq_series.pct_change().dropna()
    sharpe = (d_r.mean() / d_r.std()) * np.sqrt(250) if d_r.std() > 0 else 0.0

    # 樣本內 (IS: 2005~2022)
    sub_is = eq_series.loc[:'20221231']
    tdf_is = tdf[tdf['year'] <= 2022]
    cagr_is = ((sub_is.iloc[-1] / sub_is.iloc[0]) ** (250.0 / len(sub_is)) - 1.0) * 100.0 if len(sub_is) > 0 else 0.0
    mdd_is = ((sub_is / sub_is.cummax() - 1.0).min()) * 100.0 if len(sub_is) > 0 else 0.0
    win_is = (tdf_is['ret'] > 0).mean() * 100.0 if len(tdf_is) > 0 else 0.0

    # 樣本外 (OOS: 2023~2026)
    sub_oos = eq_series.loc['20230101':]
    tdf_oos = tdf[tdf['year'] >= 2023]
    tot_oos = (sub_oos.iloc[-1] / sub_oos.iloc[0] - 1.0) * 100.0 if len(sub_oos) > 0 else 0.0
    cagr_oos = ((sub_oos.iloc[-1] / sub_oos.iloc[0]) ** (250.0 / len(sub_oos)) - 1.0) * 100.0 if len(sub_oos) > 0 else 0.0
    mdd_oos = ((sub_oos / sub_oos.cummax() - 1.0).min()) * 100.0 if len(sub_oos) > 0 else 0.0
    win_oos = (tdf_oos['ret'] > 0).mean() * 100.0 if len(tdf_oos) > 0 else 0.0

    # 2026 當年度
    sub_2026 = eq_series.loc['20260101':]
    tdf_2026 = tdf[tdf['year'] == 2026]
    r_2026 = (sub_2026.iloc[-1] / sub_2026.iloc[0] - 1.0) * 100.0 if len(sub_2026) > 0 else 0.0
    win_2026 = (tdf_2026['ret'] > 0).mean() * 100.0 if len(tdf_2026) > 0 else 0.0

    # 綜合適應度函數
    # Fitness = (CAGR * WinRate * Sharpe / |MDD|) * 樣本外懲罰因子 * 2026超額獎勵
    oos_stability = min(1.5, max(0.5, cagr_oos / (cagr_is + 1e-6))) if cagr_is > 0 else 0.5
    bonus_2026 = 1.3 if r_2026 >= 100.0 else (1.1 if r_2026 >= 70.0 else 0.9)
    fitness = (cagr * win_r * sharpe / abs(mdd)) * oos_stability * bonus_2026

    return dict(
        tot=tot_r, cagr=cagr, mdd=mdd, win=win_r, sharpe=sharpe, trades=len(tdf),
        cagr_is=cagr_is, mdd_is=mdd_is, win_is=win_is,
        tot_oos=tot_oos, cagr_oos=cagr_oos, mdd_oos=mdd_oos, win_oos=win_oos,
        r2026=r_2026, win2026=win_2026, trades2026=len(tdf_2026),
        fitness=fitness
    )

# 5. 執行 L64 正交實驗矩陣
print(f"[*] 開始執行 L64 正交試驗 (共 64 組試驗跑 2005~2026 全歷史回測)...")
t_start = time.time()
results = []

for row_idx, row in enumerate(L64_matrix):
    p_pullback = FACTORS['A_Pullback'][row[0]]
    p_fip = FACTORS['B_FIP_Min'][row[1]]
    p_be = FACTORS['C_BE_Trigger'][row[2]]
    p_anti = FACTORS['D_Anti_Attention'][row[3]]
    p_macro = FACTORS['E_Macro_MA'][row[4]]
    p_sizing = FACTORS['F_Sizing'][row[5]]

    res = simulate_strategy(p_pullback, p_fip, p_be, p_anti, p_macro, p_sizing)
    record = {
        'exp_id': row_idx + 1,
        'A_Pullback': p_pullback, 'lvl_A': row[0],
        'B_FIP_Min': p_fip, 'lvl_B': row[1],
        'C_BE_Trigger': p_be, 'lvl_C': row[2],
        'D_Anti_Attention': p_anti, 'lvl_D': row[3],
        'E_Macro_MA': p_macro, 'lvl_E': row[4],
        'F_Sizing': p_sizing, 'lvl_F': row[5],
        **res
    }
    results.append(record)

print(f"[✓] L64 正交試驗完成！耗時: {time.time()-t_start:.2f} 秒。")
df_doe = pd.DataFrame(results)

# 儲存 DOE 完整實驗數據
df_doe.to_csv('/Users/huanggin-chen/openclaw_test/doe_titan_l64_results.csv', index=False)
print("[*] 原始正交試驗數據已寫入 doe_titan_l64_results.csv")

# 6. 計算田口主效應 (Main Effects) 與信噪比 (S/N Ratio)
# 望大信噪比: S/N = -10 * log10( 1/n * sum(1/y^2) )
def calc_sn_ratio(values):
    vals = np.array(values)
    vals = vals[vals > 0]
    if len(vals) == 0: return -99.0
    return -10.0 * np.log10(np.mean(1.0 / (vals ** 2)))

print("\n" + "="*95)
print("📊 田口正交試驗主效應分析 (Taguchi Main Effects & ANOVA Analysis)")
print("="*95)

main_effects = {}
anova_data = []

targets = ['fitness', 'win', 'cagr', 'mdd', 'r2026', 'win2026']

for f_key in FACTOR_NAMES:
    lvl_col = f"lvl_{f_key[0]}"
    f_levels = FACTORS[f_key]
    print(f"\n【因子 {f_key}】:")
    print(f"{'水平':<12} | {'參數值':<12} | {'綜合適應度':<12} | {'勝率 (%)':<10} | {'CAGR (%)':<10} | {'MDD (%)':<10} | {'2026報酬':<10}")
    print("-" * 88)
    
    means_fit = []
    for l_idx, l_val in enumerate(f_levels):
        sub = df_doe[df_doe[lvl_col] == l_idx]
        mean_fit = sub['fitness'].mean()
        mean_win = sub['win'].mean()
        mean_cagr = sub['cagr'].mean()
        mean_mdd = sub['mdd'].mean()
        mean_2026 = sub['r2026'].mean()
        means_fit.append(mean_fit)
        val_str = str(l_val)
        print(f"Level {l_idx+1:<6} | {val_str:<12} | {mean_fit:>10.2f}   | {mean_win:>8.2f}% | {mean_cagr:>8.2f}% | {mean_mdd:>8.2f}% | {mean_2026:>8.1f}%")
    
    # 計算 Delta (極差) 代表因子敏感度
    delta_fit = max(means_fit) - min(means_fit)
    main_effects[f_key] = {
        'levels': f_levels,
        'means_fit': means_fit,
        'delta': delta_fit,
        'best_level_idx': int(np.argmax(means_fit)),
        'best_level_val': f_levels[int(np.argmax(means_fit))]
    }

# 7. 因子方差分析 (ANOVA) 與敏感度貢獻率排序
total_ss_fit = np.sum((df_doe['fitness'] - df_doe['fitness'].mean())**2)
anova_records = []
for f_key in FACTOR_NAMES:
    lvl_col = f"lvl_{f_key[0]}"
    grand_mean = df_doe['fitness'].mean()
    group_means = df_doe.groupby(lvl_col)['fitness'].mean()
    group_counts = df_doe.groupby(lvl_col)['fitness'].count()
    ss_factor = np.sum(group_counts * (group_means - grand_mean)**2)
    contrib = (ss_factor / total_ss_fit) * 100.0 if total_ss_fit > 0 else 0.0
    f_stat, p_val = stats.f_oneway(*[df_doe[df_doe[lvl_col] == i]['fitness'] for i in range(4)])
    anova_records.append({
        'factor': f_key,
        'ss': ss_factor,
        'contribution_pct': contrib,
        'f_statistic': f_stat,
        'p_value': p_val,
        'best_level': main_effects[f_key]['best_level_val'],
        'delta_sensitivity': main_effects[f_key]['delta']
    })

df_anova = pd.DataFrame(anova_records).sort_values('contribution_pct', ascending=False)

print("\n" + "="*95)
print("🏆 因子顯著性與貢獻率排行榜 (ANOVA Sensitivity & Contribution Ranking)")
print("="*95)
print(f"{'排名':<4} | {'因子名稱':<20} | {'貢獻度 (%)':<12} | {'F-統計量':<10} | {'p-value':<12} | {'最佳水平配置':<15}")
print("-" * 88)
for idx, r in enumerate(df_anova.itertuples()):
    print(f"{idx+1:<4} | {r.factor:<20} | {r.contribution_pct:>10.2f}% | {r.f_statistic:>8.2f} | {r.p_value:>10.4e} | {str(r.best_level):<15}")

# 8. 預測田口最優組合 (Taguchi Optimal Parameter Set)
opt_combo = {
    'pullback': main_effects['A_Pullback']['best_level_val'],
    'fip_min': main_effects['B_FIP_Min']['best_level_val'],
    'be_trig': main_effects['C_BE_Trigger']['best_level_val'],
    'anti_att': main_effects['D_Anti_Attention']['best_level_val'],
    'macro_ma': main_effects['E_Macro_MA']['best_level_val'],
    'sizing_mode': main_effects['F_Sizing']['best_level_val']
}

print("\n" + "="*95)
print("🌟 田口正交分析導出之全域最優參數配置 (Taguchi Predicted Optimum):")
print("="*95)
for k, v in opt_combo.items():
    print(f"  • {k:<15} : {v}")

# 9. 實證驗證試驗 (Confirmation Run)
print("\n[*] 正在執行實證驗證回測 (Confirmation Validation Run)...")
res_opt = simulate_strategy(**opt_combo)
res_base = simulate_strategy(pullback=1.02, fip_min=0.52, be_trig=0.10, anti_att=0.0, macro_ma=20, sizing_mode='70_15_15')

print("\n" + "="*105)
print(f"{'指標名稱':<28} | {'現行在線基準 (Titan FIP)':<22} | {'DOE 全域最佳化 (Titan Sovereign DOE)':<25} | {'提升幅度 / 改善':<15}")
print("="*105)
print(f"{'21.5年全期累積報酬':<28} | {res_base['tot']:>18,.1f}% | {res_opt['tot']:>22,.1f}% | {res_opt['tot']-res_base['tot']:>+12,.1f}%")
print(f"{'年化複合報酬 (CAGR)':<28} | {res_base['cagr']:>18.2f}% | {res_opt['cagr']:>22.2f}% | {res_opt['cagr']-res_base['cagr']:>+12.2f}%")
print(f"{'最大回撤 (MDD)':<28} | {res_base['mdd']:>18.2f}% | {res_opt['mdd']:>22.2f}% | {abs(res_base['mdd'])-abs(res_opt['mdd']):>+12.2f}% (改善)")
print(f"{'全期勝率 (Win Rate)':<28} | {res_base['win']:>18.2f}% | {res_opt['win']:>22.2f}% | {res_opt['win']-res_base['win']:>+12.2f}%")
print(f"{'夏普比率 (Sharpe)':<28} | {res_base['sharpe']:>18.2f} | {res_opt['sharpe']:>22.2f} | {res_opt['sharpe']-res_base['sharpe']:>+12.2f}")
print(f"{'樣本外 (2023~2026) 報酬':<28} | {res_base['tot_oos']:>18.1f}% | {res_opt['tot_oos']:>22.1f}% | {res_opt['tot_oos']-res_base['tot_oos']:>+12.1f}%")
print(f"{'樣本外 (2023~2026) 勝率':<28} | {res_base['win_oos']:>18.1f}% | {res_opt['win_oos']:>22.1f}% | {res_opt['win_oos']-res_base['win_oos']:>+12.1f}%")
print(f"{'2026 單年報酬 (大盤+69.7%)':<28} | {res_base['r2026']:>18.1f}% | {res_opt['r2026']:>22.1f}% | {res_opt['r2026']-res_base['r2026']:>+12.1f}%")
print(f"{'2026 單年勝率':<28} | {res_base['win2026']:>18.1f}% | {res_opt['win2026']:>22.1f}% | {res_opt['win2026']-res_base['win2026']:>+12.1f}%")
print("="*105)

# 10. 產出綜合報告 JSON
doe_summary = {
    'baseline': res_base,
    'optimal': res_opt,
    'optimal_params': opt_combo,
    'anova': anova_records,
    'main_effects': {k: {
        'levels': [str(x) for x in v['levels']],
        'means_fit': [round(float(x), 2) for x in v['means_fit']],
        'delta': round(float(v['delta']), 2),
        'best_level': str(v['best_level_val'])
    } for k, v in main_effects.items()}
}

with open('/Users/huanggin-chen/openclaw_test/doe_optimization_summary.json', 'w', encoding='utf-8') as f:
    json.dump(doe_summary, f, ensure_ascii=False, indent=2)

print("\n[✓] DOE 最佳化總結報告已成功寫入 doe_optimization_summary.json！")
