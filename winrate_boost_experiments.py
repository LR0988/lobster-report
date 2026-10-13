#!/usr/bin/env python3
"""
winrate_boost_experiments.py
針對「勝率還是太低」進行深度專項攻堅：
動能策略中，哪些微觀機制可以真正把個股交易勝率由 38%~40% 推進至 45%~55%？
測試維度：
1. 保本停損觸發點（+6%, +8%, +10%, +12%）：何時上移至成本？
2. 多頭均線排列強約束（MA5 > MA10 > MA20 > MA60 全多頭排列）：排除均線糾纏震盪股
3. 籌碼集中度門檻（投信近20日必須為淨買超，排除投信賣超股）
4. 追高保護與ATR回調保護（不買單日漲停/不買乖離率過高）
5. 階段式停損（進場初期用緊密初始停損 -5%~-8%，迅速砍掉假突破）
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd

np.seterr(all='ignore')
SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_cache.pkl')
START_TRADE = '20050401'
SPLIT_DATE = '20230101'
FEE = 0.002925

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def simulate(cfg):
    dates = D['dates']; C = D['C']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, START_TRADE))
    pool = D['pool_pit']
    
    cash = 1_000_000.0
    pos = {}
    pend_sell = {}
    pend_buy = []
    eq = np.full(T, np.nan)
    expo = np.zeros(T)
    trades = []
    
    be_trigger = cfg.get('be_trigger', 0.10) # 預設 +10% 啟動保本
    init_stop = cfg.get('init_stop', 0.12)   # 初始硬停損 -12%
    hedge_ratio = cfg.get('hedge_ratio', 0.0)
    
    for i in range(t0, T):
        handled = set()
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos: continue
            p = pos[s]
            g = O[i, s] / C[i - 1, s] if i > 0 else 1.0
            if not np.isfinite(g) or g <= 0: g = 1.0
            v = p['v'] * g
            proceeds = v * f * (1 - FEE)
            cash += proceeds
            p['proc'] += proceeds
            p['v'] = v * (1 - f)
            if f >= 0.999:
                trades.append(dict(s=s, entry=p['ei'], exit=i, ret=(p['proc'] / p['cost'] - 1) * 100,
                                   days=i - p['ei'], why=why, leader=p['leader']))
                del pos[s]
            else:
                ro = C[i, s] / O[i, s]
                p['v'] *= ro if np.isfinite(ro) else 1.0
                handled.add(s)
        pend_sell.clear()
        
        if pend_buy:
            base = cash + sum(p['v'] for p in pos.values())
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                amount = min(w * base, cash)
                if amount < 0.01 * base: continue
                cash -= amount
                ro = C[i, s] / O[i, s]
                v = amount * (1 - FEE) * (ro if np.isfinite(ro) else 1.0)
                pos[s] = dict(v=v, cost=amount, proc=0.0, entry=O[i, s], hh=C[i, s], ei=i, days=0, leader=is_leader)
                handled.add(s)
            pend_buy = []
            
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        # 台指期避險
        tx_c = D['tx'][i]; tx_prev = D['tx'][i - 1] if i > 0 else tx_c
        tx_ok = tx_c >= D['tx_ma60'][i]
        if hedge_ratio > 0 and not tx_ok:
            curr_pv = sum(p['v'] for p in pos.values())
            target_hedge_val = (cash + curr_pv) * hedge_ratio
            cash += target_hedge_val * (- (tx_c / tx_prev - 1.0))
            
        pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + pv
        expo[i] = pv / eq[i] if eq[i] > 0 else 0
        
        # 出場
        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not tx_ok: sell = 'macro'
            else:
                m60 = D['ma60'][i, s]
                if np.isfinite(m60) and c < m60:
                    sell = 'ma60'
                elif c / entry - 1 < -init_stop:
                    sell = 'stop'
                elif cfg.get('be', True) and p['hh'] >= entry * (1.0 + be_trigger) and c < entry:
                    sell = 'be'
            if sell:
                pend_sell[s] = (1.0, sell)
                
        # 選股
        if i % 5 == 0 and i + 1 < T and tx_ok and D['breadth'][i] >= 0.35:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            
            sizing = cfg.get('sizing', 'scheme_a')
            if sizing == 'scheme_a':
                has_leader = any(pos[s]['leader'] for s in held)
                nsat = sum(1 for s in held if not pos[s]['leader'])
                need_leader = not has_leader
                need_sat = max(0, 2 - nsat)
                need = int(need_leader) + need_sat
            elif sizing == 'equal_4':
                need = max(0, 4 - len(held)); need_leader = False; need_sat = need
            else:
                need = 0
                
            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                
                # 乖離限制
                if cfg.get('bias_cap') is not None:
                    ok &= (c / D['ma20'][i] - 1) <= cfg['bias_cap']
                    
                # 均線完全多頭排列 (5MA > 10MA > 20MA > 60MA)
                if cfg.get('strict_alignment', False):
                    ok &= (D['ma5'][i] >= D['ma10'][i]) & (D['ma10'][i] >= D['ma20'][i])
                    
                # 投信必須為買超
                if cfg.get('trust_positive', False):
                    ok &= (D['trust20'][i] > 0)
                    
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
                    
                    if cfg.get('trust_heavy', False):
                        win = .30 * mom_t + .35 * tr_ + .20 * in_ + .10 * sh_ + .05 * al_
                    else:
                        win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_
                        
                    order = np.argsort(-win)
                    chosen = []
                    used = set(held)
                    
                    if sizing == 'scheme_a':
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
                    elif sizing == 'equal_4':
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.25, False)); used.add(sel[k]); got += 1
                    pend_buy = chosen

    eq_s = pd.Series(eq[t0:], index=dates[t0:])
    tdf = pd.DataFrame(trades)
    
    def get_stat(s_date, e_date):
        sub_eq = eq_s.loc[s_date:e_date]
        ret = sub_eq.iloc[-1] / sub_eq.iloc[0] - 1.0
        yrs = len(sub_eq) / 250.0
        cagr = (sub_eq.iloc[-1] / sub_eq.iloc[0]) ** (1.0 / yrs) - 1.0
        mdd = (sub_eq / sub_eq.cummax() - 1.0).min()
        d_ret = sub_eq.pct_change().dropna()
        sh = (d_ret.mean() / d_ret.std()) * np.sqrt(250) if d_ret.std() > 0 else 0
        
        t_sub = [tr for tr in trades if s_date <= dates[tr['exit']] <= e_date]
        t_sub_df = pd.DataFrame(t_sub)
        win_rate = (t_sub_df['ret'] > 0).mean() * 100.0 if len(t_sub_df) > 0 else 0
        pf = t_sub_df.loc[t_sub_df['ret'] > 0, 'ret'].sum() / t_sub_df.loc[t_sub_df['ret'] < 0, 'ret'].abs().sum() if len(t_sub_df) > 0 else 0
        n_tr = len(t_sub_df)
        return dict(ret=ret*100, cagr=cagr*100, mdd=mdd*100, sh=sh, win=win_rate, pf=pf, n=n_tr)

    return dict(all=get_stat(START_TRADE, dates[-1]), holdout=get_stat(SPLIT_DATE, dates[-1]))

experiments = [
    ("基準 A0: 70/15/15 + 保本10%", dict(sizing='scheme_a', be_trigger=0.10)),
    ("勝率攻堅 1: 保本觸發提前至 +7% (保本停損更快啟動)", dict(sizing='scheme_a', be_trigger=0.07)),
    ("勝率攻堅 2: 保本觸發提前至 +5%", dict(sizing='scheme_a', be_trigger=0.05)),
    ("勝率攻堅 3: 嚴格均線多頭排列 (5MA>10MA>20MA)", dict(sizing='scheme_a', strict_alignment=True, be_trigger=0.10)),
    ("勝率攻堅 4: 投信近20日必須淨買超 (>0)", dict(sizing='scheme_a', trust_positive=True, be_trigger=0.10)),
    ("勝率攻堅 5: 初始緊密停損 -8% (快速止血截斷虧損)", dict(sizing='scheme_a', init_stop=0.08, be_trigger=0.10)),
    ("勝率攻堅 6: 4檔等權重 + 均線多頭排列 + 投信正買超 + 保本7%", dict(sizing='equal_4', strict_alignment=True, trust_positive=True, be_trigger=0.07)),
    ("勝率攻堅 7: 4檔等權重 + 均線多頭排列 + 投信重倉 + 空頭避險30%", dict(sizing='equal_4', strict_alignment=True, trust_heavy=True, hedge_ratio=0.30, be_trigger=0.08)),
    ("勝率攻堅 8: 方案A + 均線多頭 + 投信重倉 + 乖離上限15% + 避險30%", dict(sizing='scheme_a', strict_alignment=True, trust_heavy=True, bias_cap=0.15, hedge_ratio=0.30, be_trigger=0.08))
]

print(f"{'策略名稱':<45} | {'全期報酬':<10} | {'全期CAGR':<8} | {'全期MDD':<8} | {'全期勝率':<8} | {'封存勝率':<8} | {'Sharpe':<6}")
print("-" * 110)
for name, cfg in experiments:
    res = simulate(cfg)
    a = res['all']; h = res['holdout']
    print(f"{name:<45} | {a['ret']:>9,.0f}% | {a['cagr']:>7.1f}% | {a['mdd']:>7.1f}% | {a['win']:>7.1f}% | {h['win']:>7.1f}% | {a['sh']:>6.2f}")
