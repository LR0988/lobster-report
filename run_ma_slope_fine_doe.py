#!/usr/bin/env python3
"""
run_ma_slope_fine_doe.py
👑 【固定 5MA 下，中長期均線細緻 DOE + 均線斜率 (MA Slope) 相關性與最佳化深度研究】
========================================================================================
研究目標：
1. 求出均線斜率的精確定義與數學量化公式。
2. 關聯性分析 (IC / Rank IC / 勝率分組)：
   - 分析 5MA、中線 (15~25MA)、慢線 (50~70MA) 的斜率與個股未來 20日/60日 報酬與勝率的關聯性。
3. 中長期細緻 DOE (固定 5MA)：
   - MA_mid (中線): [16, 18, 20, 22, 25]
   - MA_slow (慢線): [50, 55, 60, 65, 70]
   - Slope_mid 門檻: [0.00, 0.010, 0.020, 0.025, 0.030]
   - Slope_slow 門檻: [-0.005, 0.000, 0.005, 0.010] (季線走平、微揚或明確向上)
4. 驗證是否能進一步提升獲利與勝率！
"""

import os, sys, time, pickle, json
import numpy as np
import pandas as pd
from scipy import stats

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925 # 單邊 0.2925%

print("="*95)
print("👑 正在啟動【中長期細緻均線 DOE + 均線斜率相關性研究】...")
print("="*95)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# =========================================================================
# 一、均線斜率定義與全市場關聯性分析 (Correlation & IC Analysis)
# =========================================================================
print("[*] 正在計算各週期均線與斜率矩陣 ...")
ma5 = pd.DataFrame(C).rolling(5).mean().values
ma20 = pd.DataFrame(C).rolling(20).mean().values
ma60 = pd.DataFrame(C).rolling(60).mean().values

# 斜率定義：過去 5 個交易日均線的相對變化率 (即 1週均線爬升斜率)
# Slope_t = (MA_t - MA_{t-5}) / MA_{t-5}
slope_ma5 = np.zeros_like(ma5)
slope_ma20 = np.zeros_like(ma20)
slope_ma60 = np.zeros_like(ma60)

slope_ma5[5:] = (ma5[5:] - ma5[:-5]) / (ma5[:-5] + 1e-9)
slope_ma20[5:] = (ma20[5:] - ma20[:-5]) / (ma20[:-5] + 1e-9)
slope_ma60[5:] = (ma60[5:] - ma60[:-5]) / (ma60[:-5] + 1e-9)

# 計算個股未來 20 日與 60 日真實報酬
fwd_ret20 = np.full_like(C, np.nan)
fwd_ret60 = np.full_like(C, np.nan)
fwd_ret20[:-20] = C[20:] / C[:-20] - 1.0
fwd_ret60[:-60] = C[60:] / C[:-60] - 1.0

# 提取在席股票池有效樣本進行 IC 分析
valid_mask = pool & np.isfinite(C) & (C > 0)
s5_valid = slope_ma5[valid_mask]
s20_valid = slope_ma20[valid_mask]
s60_valid = slope_ma60[valid_mask]
r20_valid = fwd_ret20[valid_mask]
r60_valid = fwd_ret60[valid_mask]

clean_idx20 = np.isfinite(s5_valid) & np.isfinite(s20_valid) & np.isfinite(s60_valid) & np.isfinite(r20_valid)
clean_idx60 = np.isfinite(s5_valid) & np.isfinite(s20_valid) & np.isfinite(s60_valid) & np.isfinite(r60_valid)

ic_s5_20, _ = stats.spearmanr(s5_valid[clean_idx20], r20_valid[clean_idx20])
ic_s20_20, _ = stats.spearmanr(s20_valid[clean_idx20], r20_valid[clean_idx20])
ic_s60_20, _ = stats.spearmanr(s60_valid[clean_idx20], r20_valid[clean_idx20])

ic_s5_60, _ = stats.spearmanr(s5_valid[clean_idx60], r60_valid[clean_idx60])
ic_s20_60, _ = stats.spearmanr(s20_valid[clean_idx60], r60_valid[clean_idx60])
ic_s60_60, _ = stats.spearmanr(s60_valid[clean_idx60], r60_valid[clean_idx60])

print("\n" + "="*95)
print("📊 【均線斜率與未來報酬之 Rank IC 關聯度檢驗 (Spearman Rank Correlation)】")
print("="*95)
print(f"1. 5MA 5日斜率 (Slope_5MA)  -> 未來20日 Rank IC: {ic_s5_20:+.4f} | 未來60日 Rank IC: {ic_s5_60:+.4f}")
print(f"2. 20MA 5日斜率 (Slope_20MA) -> 未來20日 Rank IC: {ic_s20_20:+.4f} | 未來60日 Rank IC: {ic_s20_60:+.4f}")
print(f"3. 60MA 5日斜率 (Slope_60MA) -> 未來20日 Rank IC: {ic_s60_20:+.4f} | 未來60日 Rank IC: {ic_s60_60:+.4f}")

# 分組勝率檢驗 (以 Slope_20MA 為例分為 5 組 Quintiles)
df_ic = pd.DataFrame({
    's20': s20_valid[clean_idx20],
    's60': s60_valid[clean_idx20],
    'r20': r20_valid[clean_idx20]
})
df_ic['q_s20'] = pd.qcut(df_ic['s20'], 5, labels=['Q1(最陡下挫)', 'Q2(微跌走平)', 'Q3(中性走平)', 'Q4(溫和上揚)', 'Q5(強烈上翹)'])
group_stats = df_ic.groupby('q_s20').agg(
    avg_slope=('s20', 'mean'),
    avg_fwd20_ret=('r20', lambda x: x.mean() * 100.0),
    win_rate=('r20', lambda x: (x > 0).mean() * 100.0),
    count=('r20', 'count')
)
print("\n" + "="*95)
print("🎯 【20MA 斜率五分位數 (Quintiles) 對未來 20 日勝率與平均報酬之單調性檢驗】")
print("="*95)
print(group_stats.to_string())

# =========================================================================
# 二、細緻 DOE：固定 5MA，中長期週期微調 x 斜率門檻微調
# =========================================================================
MID_PERIODS = [16, 18, 20, 22, 25]
SLOW_PERIODS = [50, 55, 60, 65, 70]
SLOPE_MID_MINS = [0.000, 0.010, 0.020, 0.025, 0.030]
SLOPE_SLOW_MINS = [-0.005, 0.000, 0.005, 0.010]

ALL_P = sorted(list(set([5] + MID_PERIODS + SLOW_PERIODS)))
ma_cache = {}
tx_ma_cache = {}
slope_cache = {}
breadth_cache = {}

for p in ALL_P:
    ma_val = pd.DataFrame(C).rolling(p).mean().values
    ma_cache[p] = ma_val
    tx_ma_cache[p] = pd.Series(D['tx']).rolling(p).mean().values
    breadth_cache[p] = np.nanmean(C >= ma_val, axis=1)
    sl_val = np.zeros_like(ma_val)
    sl_val[5:] = (ma_val[5:] - ma_val[:-5]) / (ma_val[:-5] + 1e-9)
    slope_cache[p] = sl_val

# FIP 與散戶避雷
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def simulate_fine(mid_p, slow_p, s_mid_min, s_slow_min):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    lead_w = 0.70; sat_w = 0.15
    trail_trig = 0.60; be_trig = 0.15; anti_att = 0.20; pullback = 1.025

    ma_f = ma_cache[5]
    ma_m = ma_cache[mid_p]
    ma_s = ma_cache[slow_p]
    sl_m = slope_cache[mid_p]
    sl_s = slope_cache[slow_p]
    sl_f = slope_cache[5]
    tx_m = tx_ma_cache[mid_p]
    tx_s = tx_ma_cache[slow_p]
    breadth_s = breadth_cache[slow_p]

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
                trades.append(dict(
                    ret=(p['proc'] / p['cost'] - 1.0) * 100.0,
                    year=int(str(dates[i])[:4])
                ))
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

        tx_today = D['tx'][i]; macro_ok = tx_today >= tx_s[i]

        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']; hh = p['hh']
            peak_gain = hh / entry - 1.0
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not macro_ok: sell = 'macro_slow'
            else:
                if (not p['leader']) and peak_gain >= trail_trig and c < hh * 0.80:
                    sell = 'sat_trail'
                else:
                    ms = ma_s[i, s]
                    if np.isfinite(ms) and c < ms: sell = 'slow_stop'
                    elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = 'hard12'
                    elif hh >= entry * (1.0 + be_trig) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)

        if i % 5 == 0 and i + 1 < T and macro_ok and breadth_s[i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            has_leader = any(pos[s]['leader'] for s in held)
            nsat = sum(1 for s in held if not pos[s]['leader'])
            need_leader = not has_leader; need_sat = max(0, 2 - nsat)
            need = int(need_leader) + need_sat

            if need > 0:
                c = C[i]
                mf_i = ma_f[i]; mm_i = ma_m[i]; ms_i = ma_s[i]
                sm_i = sl_m[i]; ss_i = sl_s[i]; sf_i = sl_f[i]

                ok = pool[i] & np.isfinite(c) & np.isfinite(ms_i)
                ok &= (c >= ms_i * 1.025) & (c >= mm_i) & (mm_i >= ms_i)
                ok &= (D['r20'][i] >= 0) & (c >= 0.88 * D['h60'][i])
                ok &= (sf_i >= 0) # 快線斜率向上

                # 🌟 中線與慢線斜率門檻
                ok &= (sm_i >= s_mid_min)
                ok &= (ss_i >= s_slow_min)

                # 縮量拉回快線
                ok &= (c <= mf_i * pullback)
                # 大盤站穩中線
                ok &= (D['tx'][i] >= tx_m[i])
                # FIP 溫水煮青蛙
                ok &= (fip_quality[i] >= 0.52)

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
                    al_ = ((mf_i[sel] >= mm_i[sel]) & (mm_i[sel] >= ms_i[sel])).astype(float)
                    att_score = rank_pct(abnormal_attention[i, sel])

                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - anti_att * att_score

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

    w_sum = tdf.loc[tdf['ret'] > 0, 'ret'].sum() if len(tdf) > 0 else 0.0
    l_sum = tdf.loc[tdf['ret'] < 0, 'ret'].abs().sum() if len(tdf) > 0 else 0.0
    pf = w_sum / l_sum if l_sum > 0 else 0.0

    return dict(tot=tot_r, cagr=cagr, mdd=mdd, win=win_r, sharpe=sharpe, calmar=calmar, pf=pf, trades=len(tdf))

# 測試 5 x 5 x 5 x 4 = 500 組細緻網格
print("\n[*] 正在執行 500 組中長期週期與斜率細緻 DOE ...")
t_start = time.time()
fine_results = []
for m_p in MID_PERIODS:
    for s_p in SLOW_PERIODS:
        for sm_min in SLOPE_MID_MINS:
            for ss_min in SLOPE_SLOW_MINS:
                res = simulate_fine(m_p, s_p, sm_min, ss_min)
                fine_results.append({
                    'MA_Mid': m_p,
                    'MA_Slow': s_p,
                    'Slope_Mid_Min': sm_min,
                    'Slope_Slow_Min': ss_min,
                    **res
                })

df_fine = pd.DataFrame(fine_results)
df_fine.to_csv('/Users/huanggin-chen/openclaw_test/doe_ma_slope_fine_results.csv', index=False)
print(f"[+] 500 組實驗完成！耗時 {time.time()-t_start:.2f} 秒。")

# ANOVA
print("\n" + "="*95)
print("📊 【細緻 DOE 之 ANOVA 方差分析】")
print("="*95)
for m_key in ['cagr', 'win', 'tot', 'mdd']:
    gm = df_fine[m_key].mean()
    tss = np.sum((df_fine[m_key] - gm)**2)
    print(f"\n指標: {m_key.upper()}")
    for f in ['MA_Mid', 'MA_Slow', 'Slope_Mid_Min', 'Slope_Slow_Min']:
        lm = df_fine.groupby(f)[m_key].mean()
        ssf = (len(df_fine) / len(lm)) * np.sum((lm - gm)**2)
        contrib = ssf / tss * 100.0 if tss > 0 else 0.0
        best_l = lm.idxmax() if m_key != 'mdd' else lm.idxmin()
        means_str = ", ".join([f"{k}: {v:.2f}" for k, v in lm.items()])
        print(f"  - {f:<15} | 貢獻度: {contrib:>6.2f}% | 最優: {best_l} ({means_str})")

print("\n" + "="*95)
print("🏆 【總獲利最高 Top 10 配置】:")
print("="*95)
print(df_fine.sort_values(by='tot', ascending=False)[['MA_Mid', 'MA_Slow', 'Slope_Mid_Min', 'Slope_Slow_Min', 'tot', 'cagr', 'mdd', 'win', 'pf', 'trades']].head(10).to_string(index=False))

print("\n" + "="*95)
print("🎯 【勝率最高 Top 10 配置】:")
print("="*95)
print(df_fine.sort_values(by='win', ascending=False)[['MA_Mid', 'MA_Slow', 'Slope_Mid_Min', 'Slope_Slow_Min', 'tot', 'cagr', 'mdd', 'win', 'pf', 'trades']].head(10).to_string(index=False))
