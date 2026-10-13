#!/usr/bin/env python3
"""
run_ma_cycle_doe.py
👑 【移動平均線週期架構 (MA Fast / Mid / Slow) 田口正交 DOE 深度實驗】
驗證核心假說：隨資訊流通加速與高頻量化演進，最佳均線週期是否隨時間點縮短？
========================================================================================
1. 實驗設計 (Full Factorial 64 組覆蓋)：
   - MA_fast (週線層次): [3, 5, 7, 10]    (基準: 5MA)
   - MA_mid  (月線層次): [12, 16, 20, 30]  (基準: 20MA)
   - MA_slow (季線層次): [40, 50, 60, 80]  (基準: 60MA)
2. 逐年表現穿透 (2005 - 2026，共 22 年)：
   - 提取每組配置每一年（2005~2026）的勝率 (Win Rate %) 與報酬率 (Return %)
3. 時間序列擬合與假說檢驗 (Hypothesis Testing & Fitting)：
   - 早期 (2005-2011) vs 中期 (2012-2018) vs 近代 (2019-2026) 最優週期演變
   - 滾動 5 年窗口最優週期的線性回歸擬合 (Slope, R², p-value)
   - 「短週期 (3/12/40) vs 基準 (5/20/60) vs 長週期 (10/30/80)」逐年相對優勢對比
"""

import os, sys, time, pickle, json
import numpy as np
import pandas as pd
from scipy import stats

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925 # 單邊 0.2925%

print("="*95)
print("👑 正在啟動【MA 均線週期 (Fast/Mid/Slow) 田口正交 DOE + 時間序列擬合】實驗...")
print("="*95)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 1. 快速預計算各週期均線
FAST_PERIODS = [3, 5, 7, 10]
MID_PERIODS = [12, 16, 20, 30]
SLOW_PERIODS = [40, 50, 60, 80]
ALL_PERIODS = sorted(list(set(FAST_PERIODS + MID_PERIODS + SLOW_PERIODS)))

print(f"[*] 正在預計算 {len(ALL_PERIODS)} 種週期的個股與大盤均線及市場廣度 ...")
ma_dict = {}
tx_ma_dict = {}
breadth_dict = {}

for p in ALL_PERIODS:
    ma_dict[p] = pd.DataFrame(C).rolling(p).mean().values
    tx_ma_dict[p] = pd.Series(D['tx']).rolling(p).mean().values
    breadth_dict[p] = np.nanmean(C >= ma_dict[p], axis=1)

# FIP 與散戶避雷
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

# 模擬回測函數
def simulate_ma(fast_p, mid_p, slow_p):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    lead_w = 0.70; sat_w = 0.15
    trail_trig = 0.60; be_trig = 0.15; anti_att = 0.20; pullback = 1.025

    ma_f = ma_dict[fast_p]
    ma_m = ma_dict[mid_p]
    ma_s = ma_dict[slow_p]
    tx_m = tx_ma_dict[mid_p]
    tx_s = tx_ma_dict[slow_p]
    breadth_s = breadth_dict[slow_p]

    for i in range(t0, T):
        dt_str = str(dates[i])
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
                trades.append(dict(
                    s=D['sids'][s],
                    ret=(p['proc'] / p['cost'] - 1.0) * 100.0,
                    year=int(dt_str[:4]),
                    days=i - p['ei']
                ))
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

        # 4. 出場判斷 (以 slow_p 為大盤與個股防禦底線)
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
                # 衛星 +60% 移動停利 (回吐 20%)
                if (not p['leader']) and peak_gain >= trail_trig and c < hh * 0.80:
                    sell = 'sat_trail'
                else:
                    ms = ma_s[i, s]
                    if np.isfinite(ms) and c < ms: sell = 'slow_stop'
                    elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = 'hard12'
                    elif hh >= entry * (1.0 + be_trig) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)

        # 5. 選股判斷 (週度次日開盤執行)
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
                ok = pool[i] & np.isfinite(c) & np.isfinite(ms_i)
                # 趨勢結構：站上慢線 1.025、站上中線、中線高於慢線
                ok &= (c >= ms_i * 1.025) & (c >= mm_i) & (mm_i >= ms_i)
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
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

    # 提取逐年表現
    yearly_ret = {}
    yearly_win = {}
    yearly_trades = {}
    years = sorted(list(set(eq_series.index.year)))
    for y in years:
        sub = eq_series.loc[str(y)]
        y_r = (sub.iloc[-1] / sub.iloc[0] - 1.0) * 100.0 if len(sub) > 1 else 0.0
        y_tr = tdf[tdf['year'] == y] if len(tdf) > 0 else pd.DataFrame()
        y_w = (y_tr['ret'] > 0).mean() * 100.0 if len(y_tr) > 0 else 0.0
        yearly_ret[y] = y_r
        yearly_win[y] = y_w
        yearly_trades[y] = len(y_tr)

    return {
        'tot': tot_r, 'cagr': cagr, 'mdd': mdd, 'win': win_r, 'sharpe': sharpe,
        'calmar': calmar, 'pf': pf, 'trades': len(tdf),
        'yearly_ret': yearly_ret, 'yearly_win': yearly_win, 'yearly_trades': yearly_trades
    }

# 執行 64 組全因子實驗
grid_ma = []
for f_p in FAST_PERIODS:
    for m_p in MID_PERIODS:
        for s_p in SLOW_PERIODS:
            grid_ma.append((f_p, m_p, s_p))

print(f"[*] 開始執行 64 組 MA 週期全因子模擬 (共 64 組，每組計算 21.5 年 + 22 年逐年數據)...")
t_start = time.time()
results_summary = []
yearly_ret_rows = []
yearly_win_rows = []

for idx, (f_p, m_p, s_p) in enumerate(grid_ma):
    res = simulate_ma(f_p, m_p, s_p)
    rec = {
        'run': idx + 1,
        'MA_Fast': f_p,
        'MA_Mid': m_p,
        'MA_Slow': s_p,
        'tot': res['tot'],
        'cagr': res['cagr'],
        'mdd': res['mdd'],
        'win': res['win'],
        'sharpe': res['sharpe'],
        'calmar': res['calmar'],
        'pf': res['pf'],
        'trades': res['trades']
    }
    results_summary.append(rec)

    # 記錄逐年資料
    y_ret_rec = {'run': idx + 1, 'MA_Fast': f_p, 'MA_Mid': m_p, 'MA_Slow': s_p}
    y_ret_rec.update(res['yearly_ret'])
    yearly_ret_rows.append(y_ret_rec)

    y_win_rec = {'run': idx + 1, 'MA_Fast': f_p, 'MA_Mid': m_p, 'MA_Slow': s_p}
    y_win_rec.update(res['yearly_win'])
    yearly_win_rows.append(y_win_rec)

    if (idx + 1) % 16 == 0 or idx == 0:
        print(f"  [{idx+1:02d}/64] MA({f_p:02d}, {m_p:02d}, {s_p:02d}) -> Tot={res['tot']:>9.1f}%, CAGR={res['cagr']:>5.2f}%, MDD={res['mdd']:>6.2f}%, Win={res['win']:>5.2f}% | 耗時 {time.time()-t_start:.1f}s")

df_summary = pd.DataFrame(results_summary)
df_y_ret = pd.DataFrame(yearly_ret_rows)
df_y_win = pd.DataFrame(yearly_win_rows)

df_summary.to_csv('/Users/huanggin-chen/openclaw_test/doe_ma_cycle_summary.csv', index=False)
df_y_ret.to_csv('/Users/huanggin-chen/openclaw_test/doe_ma_yearly_return.csv', index=False)
df_y_win.to_csv('/Users/huanggin-chen/openclaw_test/doe_ma_yearly_winrate.csv', index=False)
print(f"\n[+] 64 組 MA 週期實驗完成！耗時 {time.time()-t_start:.2f} 秒。結果已存檔。")

# =========================================================================
# ANOVA 方差分析
# =========================================================================
print("\n" + "="*95)
print("📊 【MA 週期 ANOVA 方差分析 (ANOVA on Win Rate & CAGR)】")
print("="*95)

for m_key in ['cagr', 'win', 'mdd', 'tot']:
    gm = df_summary[m_key].mean()
    tss = np.sum((df_summary[m_key] - gm)**2)
    print(f"\n指標: {m_key.upper()}")
    for factor in ['MA_Fast', 'MA_Mid', 'MA_Slow']:
        l_means = df_summary.groupby(factor)[m_key].mean()
        ss_f = 16 * np.sum((l_means - gm)**2)
        contrib = ss_f / tss * 100.0 if tss > 0 else 0.0
        best_l = l_means.idxmax() if m_key != 'mdd' else l_means.idxmin()
        means_str = ", ".join([f"{k}日: {v:.2f}" for k, v in l_means.items()])
        print(f"  - {factor:<8} | 貢獻度: {contrib:>6.2f}% | 最優: {best_l}日 ({means_str})")

# =========================================================================
# 時間序列演變與假說擬合分析 (Testing the Acceleration Hypothesis)
# =========================================================================
print("\n" + "="*95)
print("⏳ 【時間演變檢驗：隨著資訊傳播加速，最佳均線週期是否隨時間變短？】")
print("="*95)

# 三時期劃分
eras = {
    'Era 1 早期 (2005-2011)': [y for y in range(2005, 2012)],
    'Era 2 中期 (2012-2018)': [y for y in range(2012, 2019)],
    'Era 3 近代 (2019-2026)': [y for y in range(2019, 2027)]
}

era_analysis = []
for era_name, y_list in eras.items():
    # 計算該時期幾何複合年化報酬 (CAGR) 與平均勝率
    era_cagrs = []
    era_wins = []
    for idx, row in df_summary.iterrows():
        rets = [df_y_ret.loc[idx, y] / 100.0 + 1.0 for y in y_list if y in df_y_ret.columns]
        cum_ret = np.prod(rets)
        cagr = (cum_ret ** (1.0 / len(rets)) - 1.0) * 100.0
        wins = [df_y_win.loc[idx, y] for y in y_list if y in df_y_win.columns]
        avg_win = np.mean(wins)
        era_cagrs.append(cagr)
        era_wins.append(avg_win)
    
    sub_df = df_summary.copy()
    sub_df['era_cagr'] = era_cagrs
    sub_df['era_win'] = era_wins

    best_cagr_row = sub_df.sort_values(by='era_cagr', ascending=False).iloc[0]
    best_win_row = sub_df.sort_values(by='era_win', ascending=False).iloc[0]

    # 平均效應
    fast_mean = sub_df.groupby('MA_Fast')['era_cagr'].mean().idxmax()
    mid_mean = sub_df.groupby('MA_Mid')['era_cagr'].mean().idxmax()
    slow_mean = sub_df.groupby('MA_Slow')['era_cagr'].mean().idxmax()

    print(f"\n📌 【{era_name}】:")
    print(f"  - 最高 CAGR 冠軍配置: MA({best_cagr_row['MA_Fast']}, {best_cagr_row['MA_Mid']}, {best_cagr_row['MA_Slow']}) -> CAGR={best_cagr_row['era_cagr']:.2f}%, 勝率={best_cagr_row['era_win']:.2f}%")
    print(f"  - 最高勝率冠軍配置:   MA({best_win_row['MA_Fast']}, {best_win_row['MA_Mid']}, {best_win_row['MA_Slow']}) -> 勝率={best_win_row['era_win']:.2f}%, CAGR={best_win_row['era_cagr']:.2f}%")
    print(f"  - 邊際主效應最優組合: Fast={fast_mean}日, Mid={mid_mean}日, Slow={slow_mean}日")

# 滾動 5 年窗口擬合回歸
print("\n" + "="*95)
print("📈 【滾動 5 年窗口最優週期軌跡線性回歸擬合 (Linear Trend Fitting)】")
print("="*95)

window_years = []
opt_fast_list = []
opt_mid_list = []
opt_slow_list = []

all_years = sorted([y for y in df_y_ret.columns if isinstance(y, int)])
for start_idx in range(len(all_years) - 4):
    w_years = all_years[start_idx : start_idx + 5]
    mid_yr = w_years[2]
    window_years.append(mid_yr)

    w_cagrs = []
    for idx in range(len(df_summary)):
        rets = [df_y_ret.loc[idx, y] / 100.0 + 1.0 for y in w_years]
        w_cagrs.append((np.prod(rets) ** (1.0 / len(rets)) - 1.0) * 100.0)

    best_idx = np.argmax(w_cagrs)
    opt_fast_list.append(df_summary.loc[best_idx, 'MA_Fast'])
    opt_mid_list.append(df_summary.loc[best_idx, 'MA_Mid'])
    opt_slow_list.append(df_summary.loc[best_idx, 'MA_Slow'])

# 擬合趨勢線
slope_f, intercept_f, r_f, p_f, _ = stats.linregress(window_years, opt_fast_list)
slope_m, intercept_m, r_m, p_m, _ = stats.linregress(window_years, opt_mid_list)
slope_s, intercept_s, r_s, p_s, _ = stats.linregress(window_years, opt_slow_list)

print(f"1. 快線 MA_Fast 最優週期回歸: 斜率 Slope = {slope_f:+.3f} 日/年, R² = {r_f**2:.3f}, p-value = {p_f:.4f}")
print(f"2. 中線 MA_Mid  最優週期回歸: 斜率 Slope = {slope_m:+.3f} 日/年, R² = {r_m**2:.3f}, p-value = {p_m:.4f}")
print(f"3. 慢線 MA_Slow 最優週期回歸: 斜率 Slope = {slope_s:+.3f} 日/年, R² = {r_s**2:.3f}, p-value = {p_s:.4f}")

# 比較三大代表組別：極短組 (3/12/40) vs 基準組 (5/20/60) vs 偏長組 (10/30/80)
print("\n" + "="*95)
print("⚖️ 【三大典型架構全史對決：極短 (3/12/40) vs 基準 (5/20/60) vs 長週期 (10/30/80)】")
print("="*95)

bench_row = df_summary[(df_summary['MA_Fast']==5) & (df_summary['MA_Mid']==20) & (df_summary['MA_Slow']==60)].iloc[0]
short_row = df_summary[(df_summary['MA_Fast']==3) & (df_summary['MA_Mid']==12) & (df_summary['MA_Slow']==40)].iloc[0]
long_row  = df_summary[(df_summary['MA_Fast']==10) & (df_summary['MA_Mid']==30) & (df_summary['MA_Slow']==80)].iloc[0]

comp_df = pd.DataFrame([short_row, bench_row, long_row])
print(comp_df[['MA_Fast', 'MA_Mid', 'MA_Slow', 'tot', 'cagr', 'mdd', 'win', 'pf', 'trades']].to_string(index=False))

# 逐年比較矩陣輸出 (2005 - 2026)
print("\n" + "="*95)
print("📅 【三大架構 2005~2026 逐年報酬率與勝率穿透對比】")
print("="*95)
yearly_comp = []
for y in all_years:
    yearly_comp.append({
        '年份': y,
        '短週期(3/12/40)報酬': round(df_y_ret.loc[short_row['run']-1, y], 1),
        '短週期勝率': round(df_y_win.loc[short_row['run']-1, y], 1),
        '基準(5/20/60)報酬': round(df_y_ret.loc[bench_row['run']-1, y], 1),
        '基準勝率': round(df_y_win.loc[bench_row['run']-1, y], 1),
        '長週期(10/30/80)報酬': round(df_y_ret.loc[long_row['run']-1, y], 1),
        '長週期勝率': round(df_y_win.loc[long_row['run']-1, y], 1),
        '超額(短週期-長週期)': round(df_y_ret.loc[short_row['run']-1, y] - df_y_ret.loc[long_row['run']-1, y], 1)
    })
print(pd.DataFrame(yearly_comp).to_string(index=False))
