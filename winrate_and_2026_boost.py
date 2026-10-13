#!/usr/bin/env python3
"""
winrate_and_2026_boost.py
專項攻堅：
1. 解決 2026 年「獲利從 +151% 回吐到 +41%（輸給大盤 +69.7%）」的問題：
   - 核心問題：獲利巨幅浮盈後缺乏高位移動保護（Trailing Stop on Profit），任由 60MA 季線在跌幅達 40% 時才砍掉。
   - 解法 A：動態階梯移動鎖利（Trailing Take-Profit）：當浮盈突破 +30% 時，停損點上移至「波段最高價 - 15%」；浮盈突破 +50% 時，上移至「波段最高價 - 12%」。
2. 解決勝率偏低問題：
   - 解法 B：大盤動量濾網（加權指數高於 20MA 才做多）+ 個股 RS 強度大於大盤 + 5MA拉回。
3. 測試 2005~2026 全期以及 2026 年單年表現。
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

def simulate_engine(cfg):
    dates = D['dates']; C = D['C']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, '20050401'))
    pool = D['pool_pit']
    
    cash = 1_000_000.0
    pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    trail_profit = cfg.get('trail_profit', False) # 高位動態階梯鎖利
    n_stocks = cfg.get('n_stocks', 3) # 3檔 (70/15/15) 或 4檔 (25%各一)
    pullback = cfg.get('pullback', True)
    
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
                elif p['hh'] >= entry * 1.10 and c < entry: sell = 'be' # 保本停損
                
                # 🚀 高位動態階梯移動鎖利 (保護 2026 年暴賺利潤不被砍半回吐)
                if sell is None and trail_profit:
                    peak_gain = p['hh'] / entry - 1.0
                    if peak_gain >= 0.50 and c <= p['hh'] * 0.85: # 浮盈破50%後，回吐超過15%強制鎖利出場
                        sell = 'trail_lock50'
                    elif peak_gain >= 0.30 and c <= p['hh'] * 0.88: # 浮盈破30%後，回吐超過12%鎖利出場
                        sell = 'trail_lock30'
            if sell: pend_sell[s] = (1.0, sell)
            
        # 週度調倉
        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            
            if n_stocks == 3:
                has_leader = any(pos[s]['leader'] for s in held)
                nsat = sum(1 for s in held if not pos[s]['leader'])
                need_leader = not has_leader
                need_sat = max(0, 2 - nsat)
                need = int(need_leader) + need_sat
            else:
                need = max(0, 4 - len(held)); need_leader = False; need_sat = need
                
            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                if pullback:
                    ok &= (c <= D['ma5'][i] * 1.02)
                
                # 測試額外拉高勝率條件: 大盤站上月線 (更強多頭環境)
                if cfg.get('taiex_ma20_filter', False):
                    # 大盤近 20 日均線
                    tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values[i]
                    ok &= (D['tx'][i] >= tx_ma20)
                    
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
                    order = np.argsort(-win)
                    chosen = []; used = set(held)
                    
                    if n_stocks == 3:
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
                    else:
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.25, False)); used.add(sel[k]); got += 1
                    pend_buy = chosen

    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(dates[t0:], format='%Y%m%d'))
    tdf = pd.DataFrame(trades)
    tdf['exit_date'] = pd.to_datetime(tdf['exit_date'], format='%Y%m%d')
    tdf['year'] = tdf['exit_date'].dt.year
    
    tot_r = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    cagr = ((eq_series.iloc[-1] / eq_series.iloc[0]) ** (250.0 / len(eq_series)) - 1.0) * 100.0
    mdd = ((eq_series / eq_series.cummax() - 1.0).min()) * 100.0
    win_r = (tdf['ret'] > 0).mean() * 100.0 if len(tdf) > 0 else 0
    
    # 2026 年單年
    sub_2026 = eq_series.loc['20260101':]
    r_2026 = (sub_2026.iloc[-1] / sub_2026.iloc[0] - 1.0) * 100.0
    mdd_2026 = ((sub_2026 / sub_2026.cummax() - 1.0).min()) * 100.0
    t_2026 = tdf[tdf['year'] == 2026]
    win_2026 = (t_2026['ret'] > 0).mean() * 100.0 if len(t_2026) > 0 else 0
    
    return dict(
        tot=tot_r, cagr=cagr, mdd=mdd, win=win_r,
        r2026=r_2026, mdd2026=mdd_2026, win2026=win_2026,
        n2026=len(t_2026), n_tot=len(tdf)
    )

configs = [
    ("A-Pro 基準 (5MA拉回)", dict(pullback=True, trail_profit=False, n_stocks=3)),
    ("方案 1: A-Pro + 高位動態階梯移動鎖利 (回吐15%鎖利)", dict(pullback=True, trail_profit=True, n_stocks=3)),
    ("方案 2: A-Pro + 大盤月線多頭強濾網", dict(pullback=True, trail_profit=False, n_stocks=3, taiex_ma20_filter=True)),
    ("方案 3: A-Pro + 高位動態鎖利 + 大盤月線濾網", dict(pullback=True, trail_profit=True, n_stocks=3, taiex_ma20_filter=True)),
    ("方案 4: 4檔等權重 + 高位動態鎖利", dict(pullback=True, trail_profit=True, n_stocks=4)),
    ("方案 5: 4檔等權重 + 高位動態鎖利 + 大盤月線濾網", dict(pullback=True, trail_profit=True, n_stocks=4, taiex_ma20_filter=True))
]

print("="*115)
print(f"{'策略版本':<42} | {'全期報酬':<9} | {'全期CAGR':<7} | {'全期勝率':<7} | {'2026報酬':<9} | {'2026MDD':<8} | {'2026勝率':<7} | {'大盤2026對照'}")
print("="*115)
for nm, cfg in configs:
    res = simulate_engine(cfg)
    print(f"{nm:<42} | {res['tot']:>8,.0f}% | {res['cagr']:>6.1f}% | {res['win']:>6.1f}% | {res['r2026']:>8.1f}% | {res['mdd2026']:>7.1f}% | {res['win2026']:>6.1f}% | 大盤 +69.7%")
print("="*115)
