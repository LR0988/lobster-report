#!/usr/bin/env python3
"""
audit_pure_momentum.py
審查「純強勢動能爆發 (60%動能)」交易明細與逐年分布。
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd
from step3456_clean_experiments import D, rank_pct

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates)
t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']
FEE = 0.002925

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
                s=D['sids'][s], entry_idx=p['ei'], exit_idx=i,
                entry_date=dates[p['ei']], exit_date=dates[i],
                entry_px=p['entry'], exit_px=O[i, s],
                ret=(p['proc'] / p['cost'] - 1.0) * 100.0,
                days=i - p['ei'], why=why, leader=p['leader']
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
                
                # 純強勢動能爆發 (60% 動能 + 20% 投信 + 10% 法人 + 5% Sharpe + 5% 排列)
                win = .60 * mom_t + .20 * tr_ + .10 * in_ + .05 * sh_ + .05 * al_
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
tdf['exit_date'] = pd.to_datetime(tdf['exit_date'], format='%Y%m%d')
tdf['year'] = tdf['exit_date'].dt.year

print(f"\n[純動能交易審計] 總交易筆數: {len(tdf)}")
print(f"最大獲利前 5 筆:")
print(tdf.sort_values('ret', ascending=False)[['s', 'entry_date', 'exit_date', 'ret', 'days', 'why']].head())

tot_r = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
cagr = ((eq_series.iloc[-1] / eq_series.iloc[0]) ** (250.0 / len(eq_series)) - 1.0) * 100.0
mdd = ((eq_series / eq_series.cummax() - 1.0).min()) * 100.0
print(f"全期累積: +{tot_r:,.1f}% | CAGR: {cagr:.2f}% | MDD: {mdd:.2f}% | 總勝率: {(tdf['ret']>0).mean()*100:.1f}%")
