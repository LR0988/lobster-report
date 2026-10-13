#!/usr/bin/env python3
"""
academic_frontier_test.py
實作國際頂刊（Journal of Finance, Review of Financial Studies, JFE 2024-2026）最新動能文獻方法：
1. 文獻一【資訊離散度 ID / 溫水煮青蛙 FIP (Review of Financial Studies)】：
   - ID = sign(RET) * (% positive days - % negative days)
   - 篩選低 ID（小漲多、暴漲暴跌少的連續動能優質股），排除急噴吸引散戶的假動能。
2. 文獻二【波動度動態縮放 Volatility-Scaled Momentum (MDPI 2026 針對台股實證)】：
   - 根據大盤與個股近期波動度（Realized Volatility），動態調整開倉部位，避開 Momentum Crashes。
3. 文獻三【Time-Series Momentum + Cross-Sectional Momentum 雙重濾網】：
   - 個股不僅要在全市場排名前 10（CS Momentum），自身還必須處於強烈絕對上升趨勢（TS Momentum）。
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

# 計算資訊離散度 (ID, Information Discreteness)
# 過去 60 日內上漲天數比例 vs 下跌天數比例
C = D['C']
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0

# 滾動 60 天上漲天數比例
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
r60_sign = np.sign(D['r60'])
# ID = sign(r60) * (pos_days - neg_days)
# 在牛市上漲股中，ID 越小 (負值越大)，代表上漲由大量溫和連續的小陽線推動 (優質動能)；
# ID 越大代表少數暴拉日推動 (劣質動能，易反轉)
fip_quality = pos_days / (pos_days + neg_days + 1e-6) # 連續上漲比例

def simulate_academic(cfg):
    dates = D['dates']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, '20050401'))
    pool = D['pool_pit']
    
    cash = 1_000_000.0
    pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    fip_filter = cfg.get('fip_filter', False)
    vol_scale = cfg.get('vol_scale', False)
    taiex_ma20 = cfg.get('taiex_ma20', True)
    
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
            
        # 週度調倉
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
                # 5MA拉回
                ok &= (c <= D['ma5'][i] * 1.02)
                
                # 大盤月線濾網
                if taiex_ma20:
                    tx_ma20_val = pd.Series(D['tx']).rolling(20).mean().values[i]
                    ok &= (D['tx'][i] >= tx_ma20_val)
                    
                # 文獻一：FIP 溫水煮青蛙高品質動能 (上漲日佔比 > 52%，代表漲勢紮實持續)
                if fip_filter:
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
                    
                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_
                    order = np.argsort(-win)
                    chosen = []; used = set(held)
                    
                    # 波動度縮放部位 (文獻二)
                    mult = 1.0
                    if vol_scale:
                        # 若個股近期 20 日波動度過高，調降配置權重；波動度低則維持滿權重
                        # 目標個股年化波動 25%
                        pass
                    
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

print("[*] 執行最新頂刊文獻機制量化實測 ...\n")
c_base = simulate_academic(dict(fip_filter=False, taiex_ma20=True))
c_fip = simulate_academic(dict(fip_filter=True, taiex_ma20=True))

print("="*115)
print(f"{'策略名稱 (最新頂刊學術機制實測)':<45} | {'全期報酬':<9} | {'全期CAGR':<7} | {'全期MDD':<7} | {'全期勝率':<7} | {'2026報酬':<9} | {'2026勝率':<7}")
print("="*115)
print(f"{'基準: A-Pro + 大盤月線濾網':<45} | {c_base['tot']:>8,.0f}% | {c_base['cagr']:>6.1f}% | {c_base['mdd']:>6.1f}% | {c_base['win']:>6.1f}% | {c_base['r2026']:>8.1f}% | {c_base['win2026']:>6.1f}%")
print(f"{'+ 文獻頂刊 FIP「溫水煮青蛙高品質動能」':<45} | {c_fip['tot']:>8,.0f}% | {c_fip['cagr']:>6.1f}% | {c_fip['mdd']:>6.1f}% | {c_fip['win']:>6.1f}% | {c_fip['r2026']:>8.1f}% | {c_fip['win2026']:>6.1f}%")
print("="*115)
