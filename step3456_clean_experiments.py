#!/usr/bin/env python3
"""
step3456_clean_experiments.py
在 100% 乾淨、無異常跳空、無髒數據的審計資料庫 (pit_clean_verified.pkl) 上，
重做順序 3、4、5、6 全部消融實驗：
- 嚴格遵守：
  1. Point-in-Time 過去60日成交額前50名 (消除偷看未來)
  2. T+1 開盤價買進與賣出 (不使用當日收盤價偷跑)
  3. 來回手續費與證交稅 0.585% (股票), 萬分之0.5 (期貨)
  4. 分期檢驗：
     - 全期 (2005/04 ~ 2026/10)
     - 開發期 (2005/04 ~ 2022/12)
     - 封存驗證期 (2023/01 ~ 2026/10)
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
START_TRADE = '20050401'
SPLIT_DATE = '20230101'
FEE = 0.002925   # 單邊 0.2925% (來回 0.585%)
FUT_FEE = 0.00005 # 期貨

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def run_simulation(cfg):
    dates = D['dates']; C = D['C']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, START_TRADE))
    pool = D['pool_pit']
    
    cash = 1_000_000.0
    pos = {}
    pend_sell = {}
    pend_buy = []
    
    eq = np.full(T, np.nan)
    trades = []
    
    level = 0
    cool_until = -1
    reset_i = t0
    
    be_trigger = cfg.get('be_trigger', 0.10) # 預設 +10% 啟動保本
    hedge_ratio = cfg.get('hedge_ratio', 0.0)
    
    for i in range(t0, T):
        handled = set()
        
        # 1. 開盤執行賣出 (T+1 開盤價)
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
        
        # 2. 開盤執行買進 (T+1 開盤價)
        if pend_buy:
            curr_stock_pv = sum(p['v'] for p in pos.values())
            tot_val = cash + curr_stock_pv
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                amt = min(w * tot_val, cash)
                if amt < 0.01 * tot_val: continue
                cash -= amt
                ro = C[i, s] / O[i, s]
                v = amt * (1.0 - FEE) * (ro if np.isfinite(ro) else 1.0)
                a0 = D['atr'][i - 1, s]
                pos[s] = dict(
                    v=v, cost=amt, proc=0.0, entry=O[i, s], hh=C[i, s],
                    ei=i, days=0, leader=is_leader, atr0=a0 if np.isfinite(a0) else 0.03
                )
                handled.add(s)
            pend_buy = []
            
        # 3. 日內價格更新
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        # 4. 空頭避險：指數放空計算 (順序六)
        tx_prev = D['tx'][i - 1] if i > 0 else D['tx'][i]
        tx_ma_prev = D['tx_ma60'][i - 1] if i > 0 else D['tx_ma60'][i]
        if hedge_ratio > 0 and i > t0:
            if tx_prev < tx_ma_prev:
                prev_tot = eq[i - 1] if np.isfinite(eq[i - 1]) else (cash + sum(p['v'] for p in pos.values()))
                hedge_notional = prev_tot * hedge_ratio
                tx_today = D['tx'][i]
                index_ret = (tx_today / tx_prev - 1.0)
                hedge_pnl = hedge_notional * (- index_ret) - (hedge_notional * FUT_FEE)
                cash += hedge_pnl
                
        # 5. 當日收盤總淨值結算
        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv
        
        # 6. 當日收盤出場訊號判斷
        tx_today = D['tx'][i]
        tx_ma_today = D['tx_ma60'][i]
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
                elif cfg.get('be', True) and p['hh'] >= entry * (1.0 + be_trigger) and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)
            
        # 7. 回撤風控熔斷 (若開啟)
        if cfg.get('breaker', False):
            lo = max(t0, i - 120, reset_i)
            peak = np.nanmax(eq[lo:i + 1])
            dd = eq[i] / peak - 1.0
            if dd <= -0.25 and level < 2:
                level = 2; cool_until = i + 20; reset_i = i
                for s in pos: pend_sell[s] = (1.0, 'breaker')
            elif dd <= -0.15 and level < 1:
                level = 1
                for s in pos:
                    if s not in pend_sell: pend_sell[s] = (0.5, 'breaker_half')
            elif dd > -0.08 and level > 0:
                level = 0
                
        # 8. 週度選股訊號 (次日開盤執行)
        if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35 and level < 2 and i >= cool_until:
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
            elif sizing in ('equal_5', 'vol_5'):
                need = max(0, 5 - len(held)); need_leader = False; need_sat = need
            else:
                need = 0
                
            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                
                # 順序四：進場濾網
                if cfg.get('bias_cap') is not None:
                    ok &= (c / D['ma20'][i] - 1.0) <= cfg['bias_cap']
                if cfg.get('near_high_tight', False):
                    ok &= (c >= 0.95 * D['h60'][i])
                if cfg.get('pullback_filter', False):
                    ok &= (c <= D['ma5'][i] * 1.02)
                    
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
                    
                    # 順序五：籌碼與動能權重分配
                    if cfg.get('trust_heavy', False):
                        win = .30 * mom_t + .35 * tr_ + .20 * in_ + .10 * sh_ + .05 * al_
                    elif cfg.get('pure_momentum_high', False):
                        win = .60 * mom_t + .20 * tr_ + .10 * in_ + .05 * sh_ + .05 * al_
                    else:
                        win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_
                        
                    order = np.argsort(-win)
                    mult = 0.5 if level == 1 else 1.0
                    chosen = []
                    used = set(held)
                    
                    if sizing == 'scheme_a':
                        if need_leader:
                            top5 = set(np.argsort(-turn_t)[:5].tolist())
                            for k in order:
                                if k in top5 and sel[k] not in used:
                                    chosen.append((sel[k], 0.70 * mult, True)); used.add(sel[k]); break
                        got = 0
                        for k in order:
                            if got >= need_sat: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.15 * mult, False)); used.add(sel[k]); got += 1
                    elif sizing == 'equal_4':
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.25 * mult, False)); used.add(sel[k]); got += 1
                    elif sizing == 'equal_5':
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.20 * mult, False)); used.add(sel[k]); got += 1
                    elif sizing == 'vol_5':
                        got = 0
                        for k in order:
                            if got >= need: break
                            if sel[k] not in used:
                                s_ = sel[k]
                                a_ = min(max(D['atr'][i, s_], 0.01), 0.08) if np.isfinite(D['atr'][i, s_]) else 0.03
                                w = min(max(0.015 / (3 * a_), 0.05), 0.25) * mult
                                chosen.append((s_, w, False)); used.add(s_); got += 1
                    pend_buy = chosen

    date_series = pd.Series(dates[t0:])
    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(date_series, format='%Y%m%d'))
    tdf = pd.DataFrame(trades)
    if len(tdf) > 0:
        tdf['exit_date'] = pd.to_datetime(tdf['exit_date'], format='%Y%m%d')
        tdf['year'] = tdf['exit_date'].dt.year
        
    def calc_stat(s_d, e_d):
        sub_eq = eq_series.loc[s_d:e_d]
        if len(sub_eq) < 2: return {}
        ret = (sub_eq.iloc[-1] / sub_eq.iloc[0] - 1.0) * 100.0
        yrs = len(sub_eq) / 250.0
        cagr = ((sub_eq.iloc[-1] / sub_eq.iloc[0]) ** (1.0 / max(yrs, 0.1)) - 1.0) * 100.0
        pk = sub_eq.cummax()
        mdd = ((sub_eq / pk - 1.0).min()) * 100.0
        d_r = sub_eq.pct_change().dropna()
        sh = (d_r.mean() / d_r.std()) * np.sqrt(250) if d_r.std() > 0 else 0.0
        
        t_sub = tdf[(tdf['exit_date'] >= pd.to_datetime(s_d)) & (tdf['exit_date'] <= pd.to_datetime(e_d))] if len(tdf) > 0 else []
        n_tr = len(t_sub)
        if n_tr > 0:
            win_rate = (t_sub['ret'] > 0).mean() * 100.0
            w_sum = t_sub.loc[t_sub['ret'] > 0, 'ret'].sum()
            l_sum = t_sub.loc[t_sub['ret'] < 0, 'ret'].abs().sum()
            pf = w_sum / l_sum if l_sum > 0 else np.nan
        else:
            win_rate = pf = 0.0
        return dict(total=ret, cagr=cagr, mdd=mdd, sharpe=sh, win=win_rate, pf=pf, n=n_tr)

    d_end = str(dates[-1])
    return dict(
        all=calc_stat('2005-04-01', d_end),
        dev=calc_stat('2005-04-01', '2022-12-31'),
        holdout=calc_stat('2023-01-01', d_end)
    )

tests = [
    # 基準組
    ("基準 A0: 方案A (70/15/15+保本)", dict(sizing='scheme_a', be=True)),
    
    # 順序三：部位分散改革
    ("順序三: 4檔等權重(每檔25%)+保本", dict(sizing='equal_4', be=True)),
    ("順序三: 5檔等權重(每檔20%)+保本", dict(sizing='equal_5', be=True)),
    ("順序三: 5檔波動度加權+保本", dict(sizing='vol_5', be=True)),
    ("順序三: 4檔等權重 + 回撤熔斷(-20%減半)", dict(sizing='equal_4', be=True, breaker=True)),
    
    # 順序四：進場濾網攻堅
    ("順序四: 方案A + 月線乖離上限15%", dict(sizing='scheme_a', be=True, bias_cap=0.15)),
    ("順序四: 方案A + 緊密創高(>=0.95*H60)", dict(sizing='scheme_a', be=True, near_high_tight=True)),
    ("順序四: 方案A + 5日均線拉回整理", dict(sizing='scheme_a', be=True, pullback_filter=True)),
    ("順序四: 4檔等權重 + 月線乖離上限15%", dict(sizing='equal_4', be=True, bias_cap=0.15)),
    
    # 順序五：基本面/籌碼動能因子
    ("順序五: 方案A + 投信籌碼加重(35%)", dict(sizing='scheme_a', be=True, trust_heavy=True)),
    ("順序五: 4檔等權重 + 投信籌碼加重", dict(sizing='equal_4', be=True, trust_heavy=True)),
    ("順序五: 方案A + 純強勢動能爆發(60%動能)", dict(sizing='scheme_a', be=True, pure_momentum_high=True)),
    
    # 順序六：空頭期避險機制
    ("順序六: 方案A + 空頭期台指期避險30%", dict(sizing='scheme_a', be=True, hedge_ratio=0.30)),
    ("順序六: 方案A + 空頭期台指期避險50%", dict(sizing='scheme_a', be=True, hedge_ratio=0.50)),
    ("順序六: 4檔等權重 + 投信加重 + 避險30%", dict(sizing='equal_4', be=True, trust_heavy=True, hedge_ratio=0.30)),
    
    # 旗艦組合
    ("方案 A+: 70/15/15 + 保本 + 乖離15% + 避險30%", dict(sizing='scheme_a', be=True, bias_cap=0.15, hedge_ratio=0.30)),
    ("方案 B+: 4檔等權重 + 保本 + 投信重倉 + 避險30%", dict(sizing='equal_4', be=True, trust_heavy=True, hedge_ratio=0.30))
]

results = []
print(f"[*] 開始在審計無髒數據資料庫執行 {len(tests)} 組回測 ...\n", flush=True)
for name, cfg in tests:
    res = run_simulation(cfg)
    results.append(dict(name=name, cfg=cfg, res=res))

print("="*115)
print(f"{'策略版本':<38} | {'全期報酬':<9} | {'全期CAGR':<7} | {'全期MDD':<7} | {'全期勝率':<7} | {'封存(23-26)報酬':<12} | {'封存勝率':<7} | {'Sharpe':<6}")
print("="*115)
for item in results:
    nm = item['name']
    a = item['res']['all']
    h = item['res']['holdout']
    print(f"{nm:<38} | {a['total']:>8,.0f}% | {a['cagr']:>6.1f}% | {a['mdd']:>6.1f}% | {a['win']:>6.1f}% | {h['total']:>11,.1f}% | {h['win']:>6.1f}% | {a['sharpe']:>6.2f}")
print("="*115)

with open(os.path.join(SCRATCH, 'step3456_clean_audited_results.json'), 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)
print(f"\n[✓] 審計版回測完成，結果已保存至 step3456_clean_audited_results.json")
