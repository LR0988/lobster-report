#!/usr/bin/env python3
"""
test_attention_factor.py
量化測試「網路散戶注意力 / 異常放量關注度 (Retail Investor Attention Proxy)」對選股勝率與獲利的影響：
在量化金融領域（Barber & Odean 2008, Da et al. 2011），散戶注意力指標通常以「異常換手率/爆量比 (Abnormal Turnover / Attention)」作為標準代理。
測試維度：
1. 正向注意力（選當下討論度/爆量最高者）：是否勝率提升？
2. 逆向注意力（排除爆量過熱散戶瘋狂討論股，買在起漲初期）：是否勝率更高？
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
FEE = 0.002925

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates)
t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 計算散戶異常關注度 / 網路熱度代理：
# Abnormal Volume / Turnover = 當日成交額 / 過去20日平均成交額 (爆量程度代表熱搜與論壇洗版)
v_ma20 = pd.DataFrame(D['rt60']).rolling(20).mean().values # 或短天期成交量
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

# FIP
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values

def run_attention_test(mode='baseline'):
    cash = 1_000_000.0
    pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

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
                    s=D['sids'][s], ret=(p['proc'] / p['cost'] - 1.0) * 100.0,
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
                elif p['hh'] >= entry * 1.10 and c < entry: sell = 'be'
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
                ok &= (c <= D['ma5'][i] * 1.02)
                ok &= (D['tx'][i] >= tx_ma20[i])
                ok &= (fip_quality[i] >= 0.52)
                
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
                    
                    if mode == 'baseline':
                        win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_
                    elif mode == 'pro_attention':
                        # 正向關注度加分 (選討論熱度最高)
                        win = .30 * mom_t + .20 * tr_ + .10 * in_ + .10 * sh_ + .10 * al_ + .20 * att_score
                    elif mode == 'anti_attention':
                        # 逆向防割韭菜 (避開過熱散戶狂歡股，給予負分)
                        win = .30 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - .10 * att_score
                        
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

    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(dates[t0:], format='%Y%m%d'))
    tdf = pd.DataFrame(trades)
    
    tot_r = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    cagr = ((eq_series.iloc[-1] / eq_series.iloc[0]) ** (250.0 / len(eq_series)) - 1.0) * 100.0
    mdd = ((eq_series / eq_series.cummax() - 1.0).min()) * 100.0
    win_r = (tdf['ret'] > 0).mean() * 100.0 if len(tdf) > 0 else 0
    
    t_2026 = tdf[tdf['year'] == 2026]
    win_2026 = (t_2026['ret'] > 0).mean() * 100.0 if len(t_2026) > 0 else 0
    sub_2026 = eq_series.loc['20260101':]
    r_2026 = (sub_2026.iloc[-1] / sub_2026.iloc[0] - 1.0) * 100.0
    
    return dict(tot=tot_r, cagr=cagr, mdd=mdd, win=win_r, r2026=r_2026, win2026=win_2026)

print("="*105)
print(f"{'網路討論聲量因子模式':<40} | {'全期累積報酬':<12} | {'CAGR':<8} | {'MDD':<8} | {'全期勝率':<8} | {'2026勝率':<8}")
print("="*105)
m0 = run_attention_test('baseline')
print(f"{'基準: Titan FIP 頂刊旗艦版':<40} | {m0['tot']:>10,.1f}% | {m0['cagr']:>6.1f}% | {m0['mdd']:>6.1f}% | {m0['win']:>7.1f}% | {m0['win2026']:>7.1f}%")

m1 = run_attention_test('pro_attention')
print(f"{'正向模式: 加重網路熱搜討論聲量 (選最熱門)':<40} | {m1['tot']:>10,.1f}% | {m1['cagr']:>6.1f}% | {m1['mdd']:>6.1f}% | {m1['win']:>7.1f}% | {m1['win2026']:>7.1f}%")

m2 = run_attention_test('anti_attention')
print(f"{'反向模式: 避開社群過熱人踩人 (冷門起跑)':<40} | {m2['tot']:>10,.1f}% | {m2['cagr']:>6.1f}% | {m2['mdd']:>6.1f}% | {m2['win']:>7.1f}% | {m2['win2026']:>7.1f}%")
print("="*105)
