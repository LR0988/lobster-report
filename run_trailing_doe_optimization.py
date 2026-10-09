#!/usr/bin/env python3
"""
run_trailing_doe_optimization.py
👑 泰坦 70/15/15 王者部位架構 + 移動停損/停利 (Trailing Stop) 全因子 DOE 實驗設計深入分析
========================================================================================
1. 實驗設計架構 (DOE Framework):
   - 鎖定核心 70/15/15 王者衛星部位配置 (1 王者泰坦 70% + 2 革命衛星 15%)
   - 採用 Galois Field GF(4) 田口正交表 L64(4^21)
   - 涵蓋 6 大因子、每因子 4 水平 (4^6 = 4096 參數空間)
   - 包含 ANOVA 方差分析、主效應分析 (Main Effects)、信噪比 (S/N Ratio)
2. 針對移動停損/停利 (Trailing Stop) 的專門因子維度：
   - Factor A: 衛星移動停利啟動門檻 (sat_trail_trig): +40%, +60%, +80%, 無 (9.99)
   - Factor B: 衛星高點回吐容許度 (sat_trail_drop): -15%, -20%, -25%, 跌破20MA
   - Factor C: 王者泰坦高檔鎖利機制 (leader_trail_mode): 純60MA, +100%破20MA, +100%回撤25%, +50%破20MA
   - Factor D: 保本平手鎖利門檻 (be_trigger): +8%, +10%, +12%, +15%
   - Factor E: 5MA 拉回整理門檻 (pullback): 1.015, 1.020, 1.025, 1.030
   - Factor F: 逆向散戶避雷權重 (anti_att): 0.05, 0.10, 0.15, 0.20
"""

import os, sys, time, pickle, json
import numpy as np
import pandas as pd
from scipy import stats

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925

print("="*95)
print("👑 正在啟動【泰坦 70/15/15 + 移動停損停利 (Trailing Stop)】田口正交 DOE 深度分析系統...")
print("="*95)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

base_ok = pool & np.isfinite(C) & np.isfinite(D['ma60'])
base_ok &= (C >= D['ma60'] * 1.025) & (C >= D['ma20']) & (D['ma20'] >= D['ma60'])
base_ok &= (D['s5'] >= 0) & (D['r20'] >= 0) & (D['s20'] >= 0.025) & (C >= 0.88 * D['h60'])

ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

FACTORS = {
    'A_Sat_Trig': [0.40, 0.60, 0.80, 9.99],                     # 衛星移動停利啟動浮盈
    'B_Sat_Drop': ['drop15', 'drop20', 'drop25', 'ma20'],       # 衛星出場規則
    'C_Lead_Trail': ['none', 'ma20_100', 'drop25_100', 'ma20_50'], # 王者高檔鎖利機制
    'D_BE_Trig': [0.08, 0.10, 0.12, 0.15],                      # 保本平手鎖利點
    'E_Pullback': [1.015, 1.020, 1.025, 1.030],                 # 5MA 拉回整理門檻
    'F_Anti_Att': [0.05, 0.10, 0.15, 0.20]                      # 逆向散戶避雷權重
}

FACTOR_NAMES = list(FACTORS.keys())

# Galois Field GF(4) L64 正交矩陣
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
for (a, b, c) in cols_gf[:6]:
    col_vals = [gf4_add(gf4_add(gf4_mul(a, u), gf4_mul(b, v)), gf4_mul(c, w)) for (u, v, w) in rows_gf]
    L64_matrix.append(col_vals)
L64_matrix = np.array(L64_matrix).T

print(f"[*] 成功構建田口正交表 L64(4^6)：共 {L64_matrix.shape[0]} 組試驗配置。")

def simulate(sat_trig, sat_drop, lead_trail, be_trig, pullback, anti_att):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []
    weights = [0.70, 0.15, 0.15]

    for i in range(t0, T):
        handled = set()
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
                trades.append(dict(s=D['sids'][s], ret=(p['proc'] / p['cost'] - 1.0) * 100.0, year=int(str(dates[i])[:4])))
                del pos[s]
            else:
                ro = C[i, s] / O[i, s]
                p['v'] *= ro if np.isfinite(ro) else 1.0
                handled.add(s)
        pend_sell.clear()

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

        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0

        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv

        tx_today = D['tx'][i]; tx_ma_today = D['tx_ma60'][i]
        macro_ok = tx_today >= tx_ma_today

        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']; hh = p['hh']
            peak_gain = hh / entry - 1.0
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not macro_ok: sell = 'macro'
            else:
                # 1. 衛星移動停損停利 (Satellites Trailing Stop)
                if (not p['leader']) and sat_trig < 9.0 and peak_gain >= sat_trig:
                    if sat_drop == 'drop15' and c < hh * 0.85: sell = 'sat_trail_15'
                    elif sat_drop == 'drop20' and c < hh * 0.80: sell = 'sat_trail_20'
                    elif sat_drop == 'drop25' and c < hh * 0.75: sell = 'sat_trail_25'
                    elif sat_drop == 'ma20':
                        m20 = D['ma20'][i, s]
                        if np.isfinite(m20) and c < m20: sell = 'sat_trail_ma20'

                # 2. 王者高檔鎖利機制 (Leader Trailing Stop)
                elif p['leader'] and lead_trail != 'none':
                    if lead_trail == 'ma20_100' and peak_gain >= 1.00:
                        m20 = D['ma20'][i, s]
                        if np.isfinite(m20) and c < m20: sell = 'lead_trail_ma20'
                    elif lead_trail == 'drop25_100' and peak_gain >= 1.00:
                        if c < hh * 0.75: sell = 'lead_trail_drop25'
                    elif lead_trail == 'ma20_50' and peak_gain >= 0.50:
                        m20 = D['ma20'][i, s]
                        if np.isfinite(m20) and c < m20: sell = 'lead_trail_ma20_50'

                # 3. 常規趨勢與保本停損
                if not sell:
                    m60 = D['ma60'][i, s]
                    if np.isfinite(m60) and c < m60: sell = 'ma60'
                    elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = 'hard12'
                    elif be_trig < 9.0 and hh >= entry * (1.0 + be_trig) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)

        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            has_leader = any(pos[s]['leader'] for s in held)
            nsat = sum(1 for s in held if not pos[s]['leader'])
            need_leader = not has_leader; need_sat = max(0, 2 - nsat)
            need = int(need_leader) + need_sat

            if need > 0:
                c = C[i]
                ok = base_ok[i] & (c <= D['ma5'][i] * pullback) & (D['tx'][i] >= tx_ma20[i]) & (fip_quality[i] >= 0.52)
                idx = np.where(ok)[0]
                if len(idx) > 0:
                    r20 = D['r20'][i, idx]; r60 = D['r60'][i, idx]
                    r120 = np.where(np.isfinite(D['r120'][i, idx]), D['r120'][i, idx], r60)
                    t20 = np.nan_to_num(D['tx_r20'][i]); t60 = np.nan_to_num(D['tx_r60'][i])
                    t120 = D['tx_r120'][i]; t120 = t60 if not np.isfinite(t120) else t120
                    rs = (r20 - t20) * .30 + (r60 - t60) * .40 + (r120 - t120) * .30
                    hp = c[idx] / D['h60'][i, idx]; turn = D['rt60'][i, idx]
                    mom = .50 * rank_pct(rs) + .35 * rank_pct(hp) + .15 * rank_pct(turn)
                    top = np.argsort(-mom)[:10]; sel = idx[top]
                    mom_t = mom[top]; turn_t = turn[top]

                    tr_ = rank_pct(D['trust20'][i, sel]); in_ = rank_pct(D['inst20'][i, sel])
                    sh_ = rank_pct(np.nan_to_num(D['sharpe'][i, sel]))
                    al_ = ((D['ma5'][i, sel] >= D['ma10'][i, sel]) & (D['ma10'][i, sel] >= D['ma20'][i, sel])).astype(float)
                    att_score = rank_pct(abnormal_attention[i, sel])
                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - anti_att * att_score

                    order = np.argsort(-win)
                    chosen = []; used = set(held)
                    lead_w = weights[0]; sat_w = weights[1]
                    if need_leader:
                        top5 = set(np.argsort(-turn_t)[:5].tolist())
                        for k in order:
                            if k in top5 and sel[k] not in used:
                                chosen.append((sel[k], lead_w, True)); used.add(sel[k]); break
                    got = 0
                    for k in order:
                        if got >= need_sat: break
                        if sel[k] not in used:
                            chosen.append((sel[k], sat_w, False)); used.add(sel[k]); got += 1
                    pend_buy = chosen

    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(dates[t0:], format='%Y%m%d'))
    tdf = pd.DataFrame(trades)

    tot_r = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    cagr = ((eq_series.iloc[-1] / eq_series.iloc[0]) ** (250.0 / len(eq_series)) - 1.0) * 100.0
    mdd = ((eq_series / eq_series.cummax() - 1.0).min()) * 100.0
    win_r = (tdf['ret'] > 0).mean() * 100.0 if len(tdf) > 0 else 0.0

    d_r = eq_series.pct_change().dropna()
    sharpe = (d_r.mean() / d_r.std()) * np.sqrt(250) if d_r.std() > 0 else 0.0
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0.0

    sub_2026 = eq_series.loc['20260101':]
    tdf_2026 = tdf[tdf['year'] == 2026]
    r_2026 = (sub_2026.iloc[-1] / sub_2026.iloc[0] - 1.0) * 100.0 if len(sub_2026) > 0 else 0.0
    win_2026 = (tdf_2026['ret'] > 0).mean() * 100.0 if len(tdf_2026) > 0 else 0.0

    # 綜合適應度
    fitness = (cagr * win_r * sharpe / abs(mdd)) * (1.2 if r_2026 >= 100.0 else 1.0)

    return dict(
        tot=tot_r, cagr=cagr, mdd=mdd, win=win_r, sharpe=sharpe, calmar=calmar,
        r2026=r_2026, win2026=win_2026, trades=len(tdf), fitness=fitness
    )

print("[*] 正在執行 64 組田口正交實驗...")
t_start = time.time()
results = []
for row_idx, row in enumerate(L64_matrix):
    p_sat_trig = FACTORS['A_Sat_Trig'][row[0]]
    p_sat_drop = FACTORS['B_Sat_Drop'][row[1]]
    p_lead_trail = FACTORS['C_Lead_Trail'][row[2]]
    p_be_trig = FACTORS['D_BE_Trig'][row[3]]
    p_pullback = FACTORS['E_Pullback'][row[4]]
    p_anti_att = FACTORS['F_Anti_Att'][row[5]]

    res = simulate(p_sat_trig, p_sat_drop, p_lead_trail, p_be_trig, p_pullback, p_anti_att)
    record = {
        'exp_id': row_idx + 1,
        'A_Sat_Trig': p_sat_trig, 'lvl_A': row[0],
        'B_Sat_Drop': p_sat_drop, 'lvl_B': row[1],
        'C_Lead_Trail': p_lead_trail, 'lvl_C': row[2],
        'D_BE_Trig': p_be_trig, 'lvl_D': row[3],
        'E_Pullback': p_pullback, 'lvl_E': row[4],
        'F_Anti_Att': p_anti_att, 'lvl_F': row[5],
        **res
    }
    results.append(record)

df_doe = pd.DataFrame(results)
print(f"[✓] L64 實驗完成！耗時: {time.time()-t_start:.2f} 秒。")

df_doe.to_csv('/Users/huanggin-chen/openclaw_test/doe_trailing_stop_l64.csv', index=False)

# 主效應分析
print("\n" + "="*95)
print("📊 田口正交試驗主效應分析 (Taguchi Main Effects & ANOVA Analysis)")
print("="*95)

main_effects = {}
for f_key in FACTOR_NAMES:
    lvl_col = f"lvl_{f_key[0]}"
    f_levels = FACTORS[f_key]
    print(f"\n【因子 {f_key}】:")
    print(f"{'水平':<12} | {'參數值':<15} | {'綜合適應度':<12} | {'勝率 (%)':<10} | {'CAGR (%)':<10} | {'MDD (%)':<10} | {'Calmar':<8}")
    print("-" * 92)
    means_fit = []
    for l_idx, l_val in enumerate(f_levels):
        sub = df_doe[df_doe[lvl_col] == l_idx]
        mean_fit = sub['fitness'].mean()
        mean_win = sub['win'].mean()
        mean_cagr = sub['cagr'].mean()
        mean_mdd = sub['mdd'].mean()
        mean_cal = sub['calmar'].mean()
        means_fit.append(mean_fit)
        print(f"Level {l_idx+1:<6} | {str(l_val):<15} | {mean_fit:>10.2f}   | {mean_win:>8.2f}% | {mean_cagr:>8.2f}% | {mean_mdd:>8.2f}% | {mean_cal:>6.2f}")
    delta_fit = max(means_fit) - min(means_fit)
    main_effects[f_key] = {
        'levels': f_levels,
        'means_fit': means_fit,
        'delta': delta_fit,
        'best_level_idx': int(np.argmax(means_fit)),
        'best_level_val': f_levels[int(np.argmax(means_fit))]
    }

# ANOVA 分析
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
        'best_level': main_effects[f_key]['best_level_val']
    })

df_anova = pd.DataFrame(anova_records).sort_values('contribution_pct', ascending=False)
print("\n" + "="*95)
print("🏆 因子顯著性與貢獻率排行榜 (ANOVA Sensitivity & Contribution Ranking)")
print("="*95)
print(f"{'排名':<4} | {'因子名稱':<20} | {'貢獻度 (%)':<12} | {'F-統計量':<10} | {'p-value':<12} | {'最佳水平配置':<15}")
print("-" * 88)
for idx, r in enumerate(df_anova.itertuples()):
    print(f"{idx+1:<4} | {r.factor:<20} | {r.contribution_pct:>10.2f}% | {r.f_statistic:>8.2f} | {r.p_value:>10.4e} | {str(r.best_level):<15}")

# 最佳組合預測與驗證
opt_combo = {
    'sat_trig': main_effects['A_Sat_Trig']['best_level_val'],
    'sat_drop': main_effects['B_Sat_Drop']['best_level_val'],
    'lead_trail': main_effects['C_Lead_Trail']['best_level_val'],
    'be_trig': main_effects['D_BE_Trig']['best_level_val'],
    'pullback': main_effects['E_Pullback']['best_level_val'],
    'anti_att': main_effects['F_Anti_Att']['best_level_val']
}

print("\n" + "="*95)
print("🌟 田口正交分析導出之全域最優配置 (Taguchi Optimum):")
print("="*95)
for k, v in opt_combo.items():
    print(f"  • {k:<15} : {v}")

res_opt = simulate(**opt_combo)
res_base = simulate(sat_trig=9.99, sat_drop='drop20', lead_trail='none', be_trig=0.12, pullback=1.025, anti_att=0.10)

print("\n" + "="*105)
print(f"{'指標名稱':<28} | {'純60MA無移動停損 (基準)':<22} | {'加入移動停損 DOE 最佳化':<25} | {'提升 / 變化':<15}")
print("="*105)
print(f"{'21.5年全期累積報酬':<28} | {res_base['tot']:>18,.1f}% | {res_opt['tot']:>22,.1f}% | {res_opt['tot']-res_base['tot']:>+12,.1f}%")
print(f"{'年化複合報酬 (CAGR)':<28} | {res_base['cagr']:>18.2f}% | {res_opt['cagr']:>22.2f}% | {res_opt['cagr']-res_base['cagr']:>+12.2f}%")
print(f"{'最大回撤 (MDD)':<28} | {res_base['mdd']:>18.2f}% | {res_opt['mdd']:>22.2f}% | {abs(res_base['mdd'])-abs(res_opt['mdd']):>+12.2f}% (改善)")
print(f"{'全期勝率 (Win Rate)':<28} | {res_base['win']:>18.2f}% | {res_opt['win']:>22.2f}% | {res_opt['win']-res_base['win']:>+12.2f}%")
print(f"{'夏普比率 (Sharpe)':<28} | {res_base['sharpe']:>18.2f} | {res_opt['sharpe']:>22.2f} | {res_opt['sharpe']-res_base['sharpe']:>+12.2f}")
print(f"{'卡瑪比率 (Calmar)':<28} | {res_base['calmar']:>18.2f} | {res_opt['calmar']:>22.2f} | {res_opt['calmar']-res_base['calmar']:>+12.2f}")
print(f"{'2026 當年報酬 (大盤+69.7%)':<28} | {res_base['r2026']:>18.1f}% | {res_opt['r2026']:>22.1f}% | {res_opt['r2026']-res_base['r2026']:>+12.1f}%")
print(f"{'總交易筆數':<28} | {res_base['trades']:>18} 筆 | {res_opt['trades']:>22} 筆 | {res_opt['trades']-res_base['trades']:>+12} 筆")
print("="*105)

summary_data = {
    'baseline': res_base,
    'optimal': res_opt,
    'optimal_params': opt_combo,
    'anova': anova_records,
    'top_experiments': df_doe.sort_values('fitness', ascending=False).head(10).to_dict(orient='records')
}
with open('/Users/huanggin-chen/openclaw_test/trailing_doe_summary.json', 'w', encoding='utf-8') as f:
    json.dump(summary_data, f, ensure_ascii=False, indent=2)

print("\n[✓] 詳細數據已寫入 trailing_doe_summary.json 與 doe_trailing_stop_l64.csv！")
