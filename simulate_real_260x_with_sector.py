import os, sys, json, time, pickle
import numpy as np
import pandas as pd
import sqlite3

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
FEE = 0.002925

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

# 載入產業別
conn_local = sqlite3.connect(DB_PATH)
df_ind = pd.read_sql_query('SELECT DISTINCT stock_id, industry FROM monthly_revenue WHERE industry IS NOT NULL AND industry != ""', conn_local).drop_duplicates(subset=['stock_id'])
conn_local.close()
ind_map = dict(zip(df_ind['stock_id'], df_ind['industry']))
stock_ind_array = np.array([ind_map.get(s, '其他') for s in D['sids']])

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

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
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

# 2. 執行與 deploy_titan_fip_production.py 100% 完全一致的精確模擬
def run_production_sim(enable_sector_synergy=False):
    cash = 1_000_000.0
    pos = {}
    pend_buy = []
    pend_sell = {}
    eq = np.full(T, np.nan)

    for i in range(t0, T):
        handled = set()
        tot_val = cash + sum(p['v'] for p in pos.values())

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
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                ok &= (c <= D['ma5'][i] * 1.025) & (D['tx'][i] >= tx_ma20[i]) & (fip_quality[i] >= 0.52)
                for h in held: ok[h] = False

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
                    att_score = rank_pct(abnormal_attention[i, sel])

                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - .20 * att_score

                    # 🌟 族群共振加成：在 Top 10 中，若屬於當前最強前 3 大產業，給予勝率打分 1.25x 加乘
                    if enable_sector_synergy:
                        r20_all = D['r20'][i]
                        valid_r20 = np.isfinite(r20_all)
                        df_sec = pd.DataFrame({'ind': stock_ind_array[valid_r20], 'r20': r20_all[valid_r20]})
                        sec_rs = df_sec.groupby('ind')['r20'].mean().dropna()
                        top3_sec = set(sec_rs.nlargest(3).index)
                        
                        cand_inds = stock_ind_array[sel]
                        is_top_sec = np.array([ind in top3_sec for ind in cand_inds])
                        win = np.where(is_top_sec, win + 0.15, win)

                    order = np.argsort(-win)

                    chosen = []; used = set(held)
                    if need_leader:
                        top5 = set(np.argsort(-turn_t)[:5].tolist())
                        for k in order:
                            if k in top5 and sel[k] not in used:
                                chosen.append((sel[k], 0.70, True)); used.add(sel[k]); break
                    got = 0
                    for k in order:
                        if got >= need_sat: break
                        if sel[k] not in used:
                            chosen.append((sel[k], 0.15, False)); used.add(sel[k]); got += 1
                    pend_buy = chosen

    return eq

print("[*] 正在驗證【真實生產版 Option A 基準 (266.5倍)】...")
eq_base = run_production_sim(enable_sector_synergy=False)

print("[*] 正在驗證【族群強弱共振 (Sector Synergy) 升級版】...")
eq_sector = run_production_sim(enable_sector_synergy=True)

def stats(eq):
    s = pd.Series(eq[t0:])
    tot = (s.iloc[-1] / s.iloc[0] - 1.0) * 100.0
    times = s.iloc[-1] / s.iloc[0]
    years = len(s) / 250.0
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (1.0 / years) - 1.0) * 100.0
    roll_max = s.cummax()
    mdd = ((s - roll_max) / roll_max).min() * 100.0
    daily_r = s.pct_change().dropna()
    sharpe = (daily_r.mean() / (daily_r.std() + 1e-9)) * np.sqrt(250)
    return tot, times, cagr, mdd, sharpe, s.iloc[-1]

tot_0, tm_0, cagr_0, mdd_0, sh_0, end_0 = stats(eq_base)
tot_1, tm_1, cagr_1, mdd_1, sh_1, end_1 = stats(eq_sector)

print("\n" + "="*88)
print("👑 泰坦 260 倍真身對決：【真實生產版 Option A (266.5倍)】vs【族群共振升級版】")
print("="*88)
print(f"{'量化指標':<25} | {'真實生產版 Option A':<25} | {'族群共振升級版':<25}")
print("-"*88)
print(f"{'21.5年累積獲利倍數':<25} | {tm_0:,.1f} 倍 ( +{tot_0:,.1f}% ) | {tm_1:,.1f} 倍 ( +{tot_1:,.1f}% )")
print(f"{'年化複合成長 (CAGR)':<25} | {cagr_0:.2f}% | {cagr_1:.2f}%")
print(f"{'歷史最大回撤 (MDD)':<25} | {mdd_0:.2f}% | {mdd_1:.2f}%")
print(f"{'夏普比率 (Sharpe)':<25} | {sh_0:.2f} | {sh_1:.2f}")
print(f"{'期末資產 (100萬起步)':<25} | {end_0:,.0f} 元 | {end_1:,.0f} 元")
print("="*88)
