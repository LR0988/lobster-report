#!/usr/bin/env python3
"""
step3456_experiments.py
以方案 A（Point-in-Time + 70/15/15 + 保本停損）為基礎基準：
  - 順序三：部位架構 (4~6 檔等權重 / 波動度加權 / 動態回撤防禦)
  - 順序四：進場濾網 (月線乖離上限 15% / 創新高突破 / 5日均線拉回不破20日線)
  - 順序五：基本面營收代理 / 投信大戶動能加速因子 (籌碼連續性 / RS斜率)
  - 順序六：空頭期避險機制 (大盤破季線做空台指期 / 核心等權重防禦)
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd

np.seterr(all='ignore')

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_cache.pkl')
START_TRADE = '20050401'
SPLIT_DATE = '20230101'
FEE = 0.002925  # 單邊 0.2925% (來回 0.585%)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def run_simulation(D, cfg):
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
    
    # 避險狀態追蹤
    hedge_pos = 0.0 # 台指期空頭價值 (負數或部位價值)
    hedge_entry_tx = 0.0
    
    level = 0
    cool_until = -1
    reset_i = t0
    
    for i in range(t0, T):
        handled = set()
        
        # 1. 執行個股賣出
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
        
        # 2. 執行買進
        if pend_buy:
            base = cash + sum(p['v'] for p in pos.values())
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                amount = min(w * base, cash)
                if amount < 0.01 * base: continue
                cash -= amount
                ro = C[i, s] / O[i, s]
                v = amount * (1 - FEE) * (ro if np.isfinite(ro) else 1.0)
                a0 = D['atr'][i - 1, s]
                pos[s] = dict(v=v, cost=amount, proc=0.0, entry=O[i, s], hh=C[i, s], ei=i, days=0,
                              atr0=a0 if np.isfinite(a0) else 0.03, leader=is_leader)
                handled.add(s)
            pend_buy = []
            
        # 3. 個股當日變動
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        # 4. 空頭避險計算 (順序六: 做空台指期貨模擬)
        tx_c = D['tx'][i]
        tx_prev = D['tx'][i - 1] if i > 0 else tx_c
        tx_ok = tx_c >= D['tx_ma60'][i]
        
        hedge_pnl = 0.0
        if cfg.get('hedge_tx', False):
            # 若處於空頭市場 (大盤跌破季線)，持有一筆做空指數部位
            if not tx_ok:
                # 避險部位相當於帳戶價值的 hedge_ratio
                curr_pv = sum(p['v'] for p in pos.values())
                target_hedge_val = (cash + curr_pv) * cfg.get('hedge_ratio', 0.40)
                # 當日放空指數收益 = - (tx_c / tx_prev - 1) * target_hedge_val
                # 扣除滑價/摩擦成本
                ret_short = - (tx_c / tx_prev - 1.0)
                hedge_pnl = target_hedge_val * ret_short
                cash += hedge_pnl
            
        pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + pv
        expo[i] = pv / eq[i] if eq[i] > 0 else 0
        
        # 5. 收盤出場判斷
        for s, p in pos.items():
            c = C[i, s]
            p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c):
                sell = 'nodata'
            elif not tx_ok:
                sell = 'macro'
            else:
                m60 = D['ma60'][i, s]
                if np.isfinite(m60) and c < m60:
                    sell = 'ma60'
                elif (not p['leader']) and (c / entry - 1 < -0.12):
                    sell = 'hard12'
                elif cfg.get('be', True) and p['hh'] >= entry * 1.10 and c < entry:
                    # 保本停損
                    sell = 'be'
            if sell:
                pend_sell[s] = (1.0, sell)
                
        # 6. 回撤風控熔斷 (若開啟)
        if cfg.get('breaker', False):
            lo = max(t0, i - 120, reset_i)
            peak = np.nanmax(eq[lo:i + 1])
            dd = eq[i] / peak - 1
            if dd <= -0.25 and level < 2:
                level = 2; cool_until = i + 20; reset_i = i
                for s in pos: pend_sell[s] = (1.0, 'breaker')
            elif dd <= -0.15 and level < 1:
                level = 1
                for s in pos:
                    if s not in pend_sell: pend_sell[s] = (0.5, 'breaker_half')
            elif dd > -0.08 and level > 0:
                level = 0
                
        # 7. 選股與開倉
        if i % 5 == 0 and i + 1 < T and tx_ok and D['breadth'][i] >= 0.35 and level < 2 and i >= cool_until:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            
            sizing = cfg.get('sizing', 'scheme_a') # 'scheme_a' (70/15/15), 'equal_4', 'equal_5', 'vol_5'
            
            if sizing == 'scheme_a':
                has_leader = any(pos[s]['leader'] for s in held)
                nsat = sum(1 for s in held if not pos[s]['leader'])
                need_leader = not has_leader
                need_sat = max(0, 2 - nsat)
                need = int(need_leader) + need_sat
            elif sizing == 'equal_4':
                need = max(0, 4 - len(held))
                need_leader = False; need_sat = need
            elif sizing in ('equal_5', 'vol_5'):
                need = max(0, 5 - len(held))
                need_leader = False; need_sat = need
            else:
                need = 0
                
            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                
                # ---- 順序四：進場濾網實驗 ----
                # 4-A: 乖離上限 (防止高位追高)
                if cfg.get('bias_cap') is not None:
                    ok &= (c / D['ma20'][i] - 1) <= cfg['bias_cap']
                
                # 4-B: 創高突破 (收盤價在近 60 日最高價的 95% 以上，或即將突破)
                if cfg.get('near_high_tight', False):
                    ok &= (c >= 0.95 * D['h60'][i])
                    
                # 4-C: 5日拉回回測 (短期拉回未破月線: c >= D['ma20'][i] 但 c <= D['ma5'][i] * 1.01)
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
                    
                    # 取動能前 10 強
                    top = np.argsort(-mom)[:10]
                    sel = idx[top]
                    mom_t = mom[top]; turn_t = turn[top]
                    
                    tr_ = rank_pct(D['trust20'][i, sel]); in_ = rank_pct(D['inst20'][i, sel])
                    sh_ = rank_pct(np.nan_to_num(D['sharpe'][i, sel]))
                    al_ = ((D['ma5'][i, sel] >= D['ma10'][i, sel]) & (D['ma10'][i, sel] >= D['ma20'][i, sel])).astype(float)
                    
                    # ---- 順序五：法人籌碼與動能加強因子 ----
                    if cfg.get('trust_heavy', False):
                        # 加大投信/法人比重 (投信對中小型暴漲股勝率極高)
                        win = .30 * mom_t + .35 * tr_ + .20 * in_ + .10 * sh_ + .05 * al_
                    elif cfg.get('pure_momentum_high', False):
                        # 強調強勢爆發 (動能 60% + 籌碼 20%)
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
                                # 目標每檔承擔總資金 1.5% 風險 (3*ATR)
                                w = min(max(0.015 / (3 * a_), 0.05), 0.25) * mult
                                chosen.append((s_, w, False)); used.add(s_); got += 1
                                
                    pend_buy = chosen

    # 指標統計
    dates_s = pd.Series(dates[t0:])
    eq_s = pd.Series(eq[t0:], index=dates_s)
    expo_s = pd.Series(expo[t0:], index=dates_s)
    tdf = pd.DataFrame(trades)
    
    def calc_metrics(d_start, d_end):
        sub_eq = eq_s.loc[d_start:d_end]
        sub_expo = expo_s.loc[d_start:d_end]
        if len(sub_eq) < 2 or sub_eq.isna().all(): return {}
        ret = sub_eq.iloc[-1] / sub_eq.iloc[0] - 1.0
        yrs = len(sub_eq) / 250.0
        cagr = (sub_eq.iloc[-1] / sub_eq.iloc[0]) ** (1.0 / max(yrs, 0.1)) - 1.0 if sub_eq.iloc[-1] > 0 else -1.0
        pk = sub_eq.cummax()
        mdd = (sub_eq / pk - 1.0).min()
        d_ret = sub_eq.pct_change().dropna()
        sh = (d_ret.mean() / d_ret.std()) * np.sqrt(250) if d_ret.std() > 0 else 0.0
        
        # 交易統計
        if len(tdf) > 0:
            # 轉換交易日期
            t_sub = []
            for tr in trades:
                t_exit_date = dates[tr['exit']]
                if d_start <= t_exit_date <= d_end:
                    t_sub.append(tr)
            t_sub_df = pd.DataFrame(t_sub)
            if len(t_sub_df) > 0:
                win_rate = (t_sub_df['ret'] > 0).mean() * 100.0
                win_sum = t_sub_df.loc[t_sub_df['ret'] > 0, 'ret'].sum()
                loss_sum = t_sub_df.loc[t_sub_df['ret'] < 0, 'ret'].abs().sum()
                pf = win_sum / loss_sum if loss_sum > 0 else np.nan
                n_tr = len(t_sub_df)
                med_ret = t_sub_df['ret'].median()
            else:
                win_rate = pf = n_tr = med_ret = 0
        else:
            win_rate = pf = n_tr = med_ret = 0
            
        return dict(
            total=ret * 100.0,
            cagr=cagr * 100.0,
            mdd=mdd * 100.0,
            sharpe=sh,
            win=win_rate,
            pf=pf,
            n=n_tr,
            med=med_ret,
            expo=sub_expo.mean() * 100.0
        )
        
    return {
        'all': calc_metrics(START_TRADE, dates[-1]),
        'dev': calc_metrics(START_TRADE, '20221231'),
        'holdout': calc_metrics(SPLIT_DATE, dates[-1])
    }

def main():
    print("[*] 載入資料快取 ...", flush=True)
    with open(CACHE, 'rb') as f:
        D = pickle.load(f)
        
    tests = [
        # 基準：方案 A (Point-in-Time + 70/15/15 + 保本停損)
        ("A0 基準: 方案A (70/15/15+保本)", dict(sizing='scheme_a', be=True)),
        
        # 順序三：部位配置改革 (提升勝率與分散度)
        ("A3-1 順序三: 4檔等權重(每檔25%)+保本", dict(sizing='equal_4', be=True)),
        ("A3-2 順序三: 5檔等權重(每檔20%)+保本", dict(sizing='equal_5', be=True)),
        ("A3-3 順序三: 4檔等權重 + 輕度回撤熔斷(-20%減半)", dict(sizing='equal_4', be=True, breaker=True)),
        
        # 順序四：進場濾網 (拉高勝率，過濾追高風險)
        ("A4-1 順序四: 方案A + 月線乖離上限15%", dict(sizing='scheme_a', be=True, bias_cap=0.15)),
        ("A4-2 順序四: 方案A + 緊密創高(收盤>=0.95*H60)", dict(sizing='scheme_a', be=True, near_high_tight=True)),
        ("A4-3 順序四: 方案A + 5日均線拉回整理(不追急噴)", dict(sizing='scheme_a', be=True, pullback_filter=True)),
        ("A4-4 順序四: 4檔等權重 + 緊密創高濾網", dict(sizing='equal_4', be=True, near_high_tight=True)),
        
        # 順序五：基本面籌碼因子 (投信重倉加速)
        ("A5-1 順序五: 方案A + 投信籌碼加重(35%權重)", dict(sizing='scheme_a', be=True, trust_heavy=True)),
        ("A5-2 順序五: 4檔等權重 + 投信加重(勝率取向)", dict(sizing='equal_4', be=True, trust_heavy=True)),
        ("A5-3 順序五: 方案A + 純強勢動能爆發(60%動能權重)", dict(sizing='scheme_a', be=True, pure_momentum_high=True)),
        
        # 順序六：空頭期避險機制 (大盤破季線避險做空 30%~50%)
        ("A6-1 順序六: 方案A + 空頭期台指期避險30%", dict(sizing='scheme_a', be=True, hedge_tx=True, hedge_ratio=0.30)),
        ("A6-2 順序六: 方案A + 空頭期台指期避險50%", dict(sizing='scheme_a', be=True, hedge_tx=True, hedge_ratio=0.50)),
        ("A6-3 順序六: 4檔等權重 + 投信加重 + 台指期避險40%", dict(sizing='equal_4', be=True, trust_heavy=True, hedge_tx=True, hedge_ratio=0.40)),
        
        # 超級融合版 (結合最佳勝率與獲利因子)
        ("A-Best 融合旗艦版: 4檔等權重+保本+投信重倉+空頭避險30%", dict(sizing='equal_4', be=True, trust_heavy=True, hedge_tx=True, hedge_ratio=0.30))
    ]
    
    results = []
    print(f"[*] 開始執行 {len(tests)} 組順序三四五六回測 ...", flush=True)
    for name, cfg in tests:
        t_start = time.time()
        res = run_simulation(D, cfg)
        sec = time.time() - t_start
        print(f"--> 完成: {name} ({sec:.1f}s)")
        print(f"    全期: 報酬 {res['all']['total']:,.1f}%, CAGR {res['all']['cagr']:.2f}%, MDD {res['all']['mdd']:.2f}%, 勝率 {res['all']['win']:.1f}%, Sharpe {res['all']['sharpe']:.2f}")
        print(f"    封存(2023-2026): 報酬 {res['holdout']['total']:,.1f}%, MDD {res['holdout']['mdd']:.2f}%, 勝率 {res['holdout']['win']:.1f}%, Sharpe {res['holdout']['sharpe']:.2f}")
        results.append(dict(name=name, cfg=cfg, res=res))
        
    out_file = os.path.join(SCRATCH, 'step3456_results.json')
    with open(out_file, 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"[✓] 全部回測完成，結果已儲存至 {out_file}")

if __name__ == '__main__':
    main()
