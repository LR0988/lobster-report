#!/usr/bin/env python3
"""
run_rsi_momentum_doe.py
👑 【RSI 相對強弱動能選股最佳化 (RSI Momentum Selection Optimization)】
全因子田口正交 DOE (Taguchi Orthogonal Array L64) + ANOVA 方差分析 + 細緻網格實證
========================================================================================
背景說明：
  當前生產環境基準 (Option A, Commit 1e911a9)：
  - 累積報酬率：+26,550.7% (266.5倍), CAGR: 30.34%, MDD: -36.55%, 勝率: 45.54%, 夏普: 1.00
  - 核心機制：70/15/15 核心衛星配置、5MA拉回 (<= 1.025)、大盤20MA濾網、FIP溫水煮青蛙 (>= 0.52)、
             逆向散戶避雷 (-0.20)、+15% 保本平手鎖利、15% 衛星 +60% 移動停利。
  用戶目標：
    在「不損害獲利能力 (保持 200~270倍以上)」的嚴格前提下，探索 RSI 能否將勝率推升至 50% 以上！

因子維度 (6 因子 x 4 水平 = 4,096 參數空間，採用 Galois Field GF(4) L64 正交表完全正交覆蓋)：
  - Factor A: RSI 計算週期 (rsi_period): 6, 10, 14, 20
  - Factor B: RSI 強勢進場下限門檻 (rsi_min): 0 (不限/Baseline), 50 (強勢中軸), 55 (動能確認), 60 (極強加速)
  - Factor C: RSI 高檔超買天花板防追高 (rsi_max): 75 (嚴格防追高), 80 (防過熱), 85 (寬鬆防追高), 100 (不設限/Baseline)
  - Factor D: RSI 動能選股排序評分權重 (rsi_weight): 0.00 (不加入打分/Baseline), 0.10, 0.15, 0.20
  - Factor E: 5MA 拉回整理容許度 (pullback): 1.015, 1.020, 1.025, 1.030
  - Factor F: 保本平手鎖利啟動門檻 (be_trig): 0.10, 0.12, 0.15, 0.18
"""

import os, sys, time, pickle, json
import numpy as np
import pandas as pd
from scipy import stats

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925 # 單邊 0.2925% (來回 0.585%)

print("="*95)
print("👑 正在啟動【RSI 相對強弱動能選股最佳化】田口正交 DOE 深度實驗...")
print("="*95)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 預計算基礎多頭趨勢條件 (保持生產環境 100% 同步)
base_ok = pool & np.isfinite(C) & np.isfinite(D['ma60'])
base_ok &= (C >= D['ma60'] * 1.025) & (C >= D['ma20']) & (D['ma20'] >= D['ma60'])
base_ok &= (D['s5'] >= 0) & (D['r20'] >= 0) & (D['s20'] >= 0.025) & (C >= 0.88 * D['h60'])

# 計算 FIP 與散戶關注度指標
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

# 快速預計算各週期 RSI 矩陣 (Wilder Cutler SMA)
print("[*] 正在向量化預計算 RSI(6), RSI(10), RSI(14), RSI(20) 全矩陣 ...")
delta = np.zeros_like(C)
delta[1:] = C[1:] - C[:-1]
up = np.maximum(delta, 0)
down = np.maximum(-delta, 0)

RSI_MATRICES = {}
for n in [6, 10, 14, 20]:
    roll_up = pd.DataFrame(up).rolling(n).mean().values
    roll_down = pd.DataFrame(down).rolling(n).mean().values
    rs = roll_up / (roll_down + 1e-9)
    RSI_MATRICES[n] = 100.0 - (100.0 / (1.0 + rs))
print("[+] RSI 全矩陣預計算完成！")

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

FACTORS = {
    'A_RSI_Period': [6, 10, 14, 20],               # RSI 週期
    'B_RSI_Min': [0, 50, 55, 60],                  # RSI 強勢進場下限門檻 (0 表示不限)
    'C_RSI_Max': [75, 80, 85, 100],                # RSI 高檔超買天花板防追高 (100 表示不限)
    'D_RSI_Weight': [0.00, 0.10, 0.15, 0.20],      # RSI 動能選股排序評分權重
    'E_Pullback': [1.015, 1.020, 1.025, 1.030],    # 5MA 拉回整理容許度
    'F_BE_Trig': [0.10, 0.12, 0.15, 0.18]          # 保本平手鎖利門檻
}

FACTOR_NAMES = list(FACTORS.keys())

# Galois Field GF(4) L64 正交表構建
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

print(f"[*] 成功構建 Galois Field GF(4) 田口正交表 L64(4^6)：共 {L64_matrix.shape[0]} 組試驗配置。")

def simulate(rsi_period, rsi_min, rsi_max, rsi_weight, pullback, be_trig):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    # 基準 70/15/15 核心衛星配置
    lead_w = 0.70; sat_w = 0.15
    trail_trig = 0.60 # 衛星 +60% 移動停利 (回吐 20%)
    anti_att = 0.20   # 逆向散戶避雷權重 -0.20

    rsi_mat = RSI_MATRICES[rsi_period]

    for i in range(t0, T):
        handled = set()
        # 1. 賣出執行 (T+1 開盤價)
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

        # 2. 買進執行 (T+1 開盤價)
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

        # 3. 日內價格更新
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0

        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv

        # 4. 出場邏輯判定
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
                # 衛星 +60% 移動停利 (回吐 20%)
                if (not p['leader']) and peak_gain >= trail_trig and c < hh * 0.80:
                    sell = 'sat_trail'
                else:
                    m60 = D['ma60'][i, s]
                    if np.isfinite(m60) and c < m60: sell = 'ma60'
                    elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = 'hard12'
                    elif hh >= entry * (1.0 + be_trig) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)

        # 5. 週度選股訊號
        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            has_leader = any(pos[s]['leader'] for s in held)
            nsat = sum(1 for s in held if not pos[s]['leader'])
            need_leader = not has_leader; need_sat = max(0, 2 - nsat)
            need = int(need_leader) + need_sat

            if need > 0:
                c = C[i]
                rsi_today = rsi_mat[i]
                ok = base_ok[i] & (c <= D['ma5'][i] * pullback) & (D['tx'][i] >= tx_ma20[i]) & (fip_quality[i] >= 0.52)

                # 🌟 RSI 強勢進場門檻過濾 (RSI >= rsi_min)
                if rsi_min > 0:
                    ok &= (rsi_today >= rsi_min)
                
                # 🌟 RSI 高檔超買天花板防追高過濾 (RSI <= rsi_max)
                if rsi_max < 100:
                    ok &= (rsi_today <= rsi_max)

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

                    # 🌟 納入 RSI 打分權重
                    base_win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - anti_att * att_score
                    if rsi_weight > 0.0:
                        rsi_score = rank_pct(rsi_today[sel])
                        win = (1.0 - rsi_weight) * base_win + rsi_weight * rsi_score
                    else:
                        win = base_win

                    order = np.argsort(-win)
                    chosen = []; used = set(held)
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

    # 盈虧比
    w_sum = tdf.loc[tdf['ret'] > 0, 'ret'].sum() if len(tdf) > 0 else 0.0
    l_sum = tdf.loc[tdf['ret'] < 0, 'ret'].abs().sum() if len(tdf) > 0 else 0.0
    pf = w_sum / l_sum if l_sum > 0 else 0.0
    avg_win = tdf.loc[tdf['ret'] > 0, 'ret'].mean() if (tdf['ret'] > 0).any() else 0.0
    avg_loss = tdf.loc[tdf['ret'] < 0, 'ret'].mean() if (tdf['ret'] < 0).any() else 0.0

    fitness = (cagr * win_r * sharpe / abs(mdd)) * (1.2 if r_2026 >= 100.0 else 1.0)

    return dict(
        tot=tot_r, cagr=cagr, mdd=mdd, win=win_r, sharpe=sharpe, calmar=calmar,
        r2026=r_2026, win2026=win_2026, trades=len(tdf), fitness=fitness,
        pf=pf, avg_win=avg_win, avg_loss=avg_loss
    )

print("[*] 正在執行 64 組田口正交實驗...")
t_start = time.time()
results = []
for row_idx, row in enumerate(L64_matrix):
    p_period = FACTORS['A_RSI_Period'][row[0]]
    p_min = FACTORS['B_RSI_Min'][row[1]]
    p_max = FACTORS['C_RSI_Max'][row[2]]
    p_weight = FACTORS['D_RSI_Weight'][row[3]]
    p_pullback = FACTORS['E_Pullback'][row[4]]
    p_be_trig = FACTORS['F_BE_Trig'][row[5]]

    m = simulate(p_period, p_min, p_max, p_weight, p_pullback, p_be_trig)
    rec = {
        'run': row_idx + 1,
        'A_RSI_Period': p_period,
        'B_RSI_Min': p_min,
        'C_RSI_Max': p_max,
        'D_RSI_Weight': p_weight,
        'E_Pullback': p_pullback,
        'F_BE_Trig': p_be_trig,
        **m
    }
    results.append(rec)
    if (row_idx + 1) % 16 == 0 or row_idx == 0:
        elapsed = time.time() - t_start
        print(f"  [Run {row_idx+1:02d}/64] Period={p_period:02d}, Min={p_min}, Max={p_max}, W={p_weight:.2f}, PB={p_pullback}, BE={p_be_trig} -> "
              f"Tot={m['tot']:>9.1f}%, CAGR={m['cagr']:>5.2f}%, MDD={m['mdd']:>6.2f}%, Win={m['win']:>5.2f}%, PF={m['pf']:>4.2f} | 耗時 {elapsed:.1f}s")

res_df = pd.DataFrame(results)
csv_path = '/Users/huanggin-chen/openclaw_test/doe_rsi_momentum_l64.csv'
res_df.to_csv(csv_path, index=False)
print(f"\n[+] 64 組正交實驗執行完畢！耗時 {time.time()-t_start:.2f} 秒。結果已存儲至 {csv_path}")

# =========================================================================
# ANOVA 方差分析 (對 Win Rate, CAGR, MDD, Calmar, Tot)
# =========================================================================
print("\n" + "="*95)
print("📊 【田口正交實驗 ANOVA 方差分析與主效應分析 (Main Effect Analysis)】")
print("="*95)

anova_results = {}
metrics_to_analyze = ['win', 'cagr', 'tot', 'mdd', 'calmar', 'sharpe']

for m_key in metrics_to_analyze:
    grand_mean = res_df[m_key].mean()
    total_ss = np.sum((res_df[m_key] - grand_mean) ** 2)
    anova_m = {}

    for factor in FACTOR_NAMES:
        level_means = res_df.groupby(factor)[m_key].mean()
        ss_factor = 16 * np.sum((level_means - grand_mean) ** 2) # 每水平 16 次
        pct_contrib = (ss_factor / total_ss * 100.0) if total_ss > 0 else 0.0
        best_level = level_means.idxmax() if m_key != 'mdd' else level_means.idxmin() # MDD 越小越好 (負值越接近 0)
        anova_m[factor] = {
            'level_means': level_means.to_dict(),
            'ss': float(ss_factor),
            'contrib_pct': float(pct_contrib),
            'best_level': best_level
        }
    anova_results[m_key] = anova_m

# 印出 Win Rate 關鍵因子貢獻度排行榜
print("\n🎯 【勝率 (Win Rate %) 因子方差貢獻度與主效應排行榜】:")
win_anova = anova_results['win']
sorted_win_factors = sorted(win_anova.items(), key=lambda x: x[1]['contrib_pct'], reverse=True)
for rank, (fname, f_info) in enumerate(sorted_win_factors, 1):
    means_str = ", ".join([f"{k}: {v:.2f}%" for k, v in f_info['level_means'].items()])
    print(f"  Top {rank}. {fname:<15} | 貢獻度: {f_info['contrib_pct']:>6.2f}% | 最優水平: {f_info['best_level']} ({means_str})")

# 印出 CAGR 關鍵因子貢獻度排行榜
print("\n🚀 【年化報酬率 (CAGR %) 因子方差貢獻度與主效應排行榜】:")
cagr_anova = anova_results['cagr']
sorted_cagr_factors = sorted(cagr_anova.items(), key=lambda x: x[1]['contrib_pct'], reverse=True)
for rank, (fname, f_info) in enumerate(sorted_cagr_factors, 1):
    means_str = ", ".join([f"{k}: {v:.2f}%" for k, v in f_info['level_means'].items()])
    print(f"  Top {rank}. {fname:<15} | 貢獻度: {f_info['contrib_pct']:>6.2f}% | 最優水平: {f_info['best_level']} ({means_str})")

# 印出 總獲利 (Tot %) 關鍵因子貢獻度排行榜
print("\n💰 【總累積獲利 (Total Return %) 因子方差貢獻度排行榜】:")
tot_anova = anova_results['tot']
sorted_tot_factors = sorted(tot_anova.items(), key=lambda x: x[1]['contrib_pct'], reverse=True)
for rank, (fname, f_info) in enumerate(sorted_tot_factors, 1):
    means_str = ", ".join([f"{k}: {v:.1f}%" for k, v in f_info['level_means'].items()])
    print(f"  Top {rank}. {fname:<15} | 貢獻度: {f_info['contrib_pct']:>6.2f}% | 最優水平: {f_info['best_level']}")

# 篩選勝率 >= 50% 且獲利卓越的配置
high_wr = res_df[res_df['win'] >= 49.0].sort_values(by='cagr', ascending=False)
print("\n" + "="*95)
print(f"🏆 【勝率 >= 49% 的精英配置 (共 {len(high_wr)} 組)】:")
print("="*95)
print(high_wr[['run', 'A_RSI_Period', 'B_RSI_Min', 'C_RSI_Max', 'D_RSI_Weight', 'E_Pullback', 'F_BE_Trig', 'tot', 'cagr', 'mdd', 'win', 'pf']].to_string(index=False))

# 綜合最優 Top 10 (依綜合適應度 Fitness)
print("\n" + "="*95)
print("🌟 【全域綜合評分 (Fitness) Top 10 最佳配置】:")
print("="*95)
top10 = res_df.sort_values(by='fitness', ascending=False).head(10)
print(top10[['run', 'A_RSI_Period', 'B_RSI_Min', 'C_RSI_Max', 'D_RSI_Weight', 'E_Pullback', 'F_BE_Trig', 'tot', 'cagr', 'mdd', 'win', 'pf', 'fitness']].to_string(index=False))

# 儲存摘要 JSON
summary_out = {
    'anova': anova_results,
    'top10_fitness': top10.to_dict(orient='records'),
    'high_wr': high_wr.to_dict(orient='records'),
    'baseline_comparison': {
        'baseline_tot': 26550.7,
        'baseline_cagr': 30.34,
        'baseline_mdd': -36.55,
        'baseline_win': 45.54,
        'baseline_pf': 2.98
    }
}
with open('/Users/huanggin-chen/openclaw_test/doe_rsi_momentum_summary.json', 'w') as f:
    json.dump(summary_out, f, indent=2, ensure_ascii=False)

print("\n[+] DOE 摘要已保存至 doe_rsi_momentum_summary.json")
