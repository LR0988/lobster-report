import os, sys, json, time, pickle
import numpy as np
import pandas as pd

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
FEE = 0.002925

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

# 載入產業別
import sqlite3
conn_local = sqlite3.connect(DB_PATH)
df_ind = pd.read_sql_query('SELECT DISTINCT stock_id, industry FROM monthly_revenue WHERE industry IS NOT NULL AND industry != ""', conn_local).drop_duplicates(subset=['stock_id'])
conn_local.close()
ind_map = dict(zip(df_ind['stock_id'], df_ind['industry']))
stock_ind_array = np.array([ind_map.get(s, '其他') for s in D['sids']])

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates)
t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 1. 計算 FIP 資訊離散度指標
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)

# 2. 執行兩種配置對比 (A: 原始 266.5倍 FIP 旗艦版 vs B: 加入族群共振加成)
def simulate_titan_fip(enable_sector_synergy=False):
    cash = 1_000_000.0
    pos = {}
    pend_buy = []
    pend_sell = {}
    eq = np.full(T, np.nan)

    for i in range(t0, T):
        handled = set()
        dt = dates[i]
        tot_val = cash + sum(p['v'] for p in pos.values())
        
        # 買入執行 (次日開盤執行)
        if pend_buy:
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

        # 賣出執行 (次日開盤執行)
        if pend_sell:
            for s, (f, why) in pend_sell.items():
                if s not in pos or not np.isfinite(O[i, s]): continue
                p = pos[s]
                ro = O[i, s] / C[i - 1, s] if np.isfinite(C[i - 1, s]) and C[i - 1, s] > 0 else 1.0
                real_v = p['v'] * ro * (1.0 - FEE)
                cash += real_v * f
                del pos[s]
                handled.add(s)
            pend_sell = {}

        # 個股日內變動
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv

        # 出場判斷 (收盤判斷，次日開盤執行)
        tx_today = D['tx'][i]; tx_ma_today = D['tx_ma60'][i]
        macro_ok = tx_today >= tx_ma_today

        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not macro_ok: sell = '🛡️ 大盤跌破季線 (60MA) 防禦清倉'
            else:
                m60 = D['ma60'][i, s]
                peak_gain = p['hh'] / entry - 1.0
                if (not p['leader']) and peak_gain >= 0.60 and c < p['hh'] * 0.80:
                    sell = '🎯 衛星觸發 +60% 高檔回吐 20% 移動停利'
                elif np.isfinite(m60) and c < m60: sell = '🛡️ 跌破季線 (60MA) 防禦停損'
                elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = '⚡ 衛星觸發 -12% 停損線'
                elif p['hh'] >= entry * 1.15 and c < entry: sell = '🎯 觸發 +15% 保本平手鎖利'
            if sell: pend_sell[s] = (1.0, sell)

        # 週度選股訊號 (次日開盤執行)
        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            has_leader = any(pos[s]['leader'] for s in held)
            nsat = sum(1 for s in held if not pos[s]['leader'])
            need_leader = not has_leader
            need_sat = max(0, 2 - nsat)
            need = int(need_leader) + need_sat

            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025)
                ok &= (c >= 0.88 * D['h60'][i]) & (c <= D['ma5'][i] * 1.025) & (fip_quality[i] >= 0.52)
                for h in held: ok[h] = False

                valid_idx = np.where(ok)[0]
                if len(valid_idx) > 0:
                    r60 = D['r60'][i, valid_idx]
                    t20 = D['trust20'][i, valid_idx]
                    i20 = D['inst20'][i, valid_idx]
                    rt60 = D['rt60'][i, valid_idx]
                    mean_rt60 = np.nanmean(D['rt60'][max(0, i-60):i+1, valid_idx], axis=0) + 1e-6
                    att = rt60 / mean_rt60

                    score = 0.40 * rank_pct(r60) + 0.25 * rank_pct(t20) + 0.15 * rank_pct(i20) - 0.20 * rank_pct(att)

                    # 🌟 族群共振主流加成 (當期全市場最強前 3 大產業，打分動態提升 +0.20)
                    if enable_sector_synergy:
                        r20_all = D['r20'][i]
                        valid_r20 = np.isfinite(r20_all)
                        df_sec = pd.DataFrame({'ind': stock_ind_array[valid_r20], 'r20': r20_all[valid_r20]})
                        sec_rs = df_sec.groupby('ind')['r20'].mean().dropna()
                        top3_sec = set(sec_rs.nlargest(3).index)
                        
                        cand_inds = stock_ind_array[valid_idx]
                        is_top_sec = np.array([ind in top3_sec for ind in cand_inds])
                        score += np.where(is_top_sec, 0.20, 0.0)

                    top_k = valid_idx[np.argsort(-score)[:need]]
                    
                    if need_leader and len(top_k) > 0:
                        pend_buy.append((top_k[0], 0.70, True))
                        top_k = top_k[1:]
                    for sat_s in top_k:
                        pend_buy.append((sat_s, 0.15, False))

    return eq

print("[*] 正在驗證原版 266.5倍 泰坦旗艦版 (Titan FIP Option A)...")
eq_base = simulate_titan_fip(enable_sector_synergy=False)

print("[*] 正在驗證【加入族群共振主流加成】後的 20 年實測績效...")
eq_synergy = simulate_titan_fip(enable_sector_synergy=True)

def get_stats(eq_arr, label):
    s = pd.Series(eq_arr).dropna()
    tot = (s.iloc[-1] / s.iloc[0] - 1.0) * 100.0
    times = s.iloc[-1] / s.iloc[0]
    years = len(s) / 250.0
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (1.0 / years) - 1.0) * 100.0
    roll_max = s.cummax()
    mdd = ((s - roll_max) / roll_max).min() * 100.0
    daily_r = s.pct_change().dropna()
    sharpe = (daily_r.mean() / (daily_r.std() + 1e-9)) * np.sqrt(250)
    return {
        'label': label, 'tot': tot, 'times': times, 'cagr': cagr, 'mdd': mdd, 'sharpe': sharpe, 'end': s.iloc[-1]
    }

res_a = get_stats(eq_base, "原版 Titan FIP 頂刊旗艦版")
res_b = get_stats(eq_synergy, "Titan FIP + 族群共振加成")

print("\n" + "="*88)
print("👑 泰坦 260 倍真身對比：【Titan FIP 原版 (266.5倍)】vs【族群共振主流加成版】")
print("="*88)
print(f"{'量化指標':<25} | {'原版 Titan FIP 旗艦':<25} | {'族群共振升級版':<25}")
print("-"*88)
print(f"{'21.5年累積獲利倍數':<25} | {res_a['times']:,.1f} 倍 ( +{res_a['tot']:,.1f}% ) | {res_b['times']:,.1f} 倍 ( +{res_b['tot']:,.1f}% )")
print(f"{'年化複合增長率 (CAGR)':<25} | {res_a['cagr']:.2f}% | {res_b['cagr']:.2f}%")
print(f"{'歷史最大回撤 (MDD)':<25} | {res_a['mdd']:.2f}% | {res_b['mdd']:.2f}%")
print(f"{'夏普比率 (Sharpe)':<25} | {res_a['sharpe']:.2f} | {res_b['sharpe']:.2f}")
print(f"{'期末資產 (100萬起步)':<25} | {res_a['end']:,.0f} 元 | {res_b['end']:,.0f} 元")
print("="*88)
