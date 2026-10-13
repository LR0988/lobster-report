#!/usr/bin/env python3
"""
verify_scheme_a_plus.py
深度驗證方案 A+ (Scheme A+)：
1. 嚴格檢查無未來函數 (Point-in-Time, T+1 開盤價進出, 摩擦成本/證交稅)
2. 逐日逐筆盤點台指期避險計算邏輯，防止現金複利/放空收益計算錯誤 (避免假造收益)
3. 產出 2005~2026 年完整 21 年「逐年報酬率、最大回撤、交易勝率、盈虧比、交易筆數」表格
4. 驗證避險開啟 vs 避險關閉的每年差異，證明避險是否真實合理
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_cache.pkl')
START_TRADE = '20050401'
FEE = 0.002925  # 單邊 0.2925% (來回 0.585%)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def run_a_plus(with_hedge=True, hedge_ratio=0.30):
    dates = D['dates']; C = D['C']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, START_TRADE))
    pool = D['pool_pit']
    
    cash = 1_000_000.0
    pos = {}
    pend_sell = {}
    pend_buy = []
    
    eq = np.full(T, np.nan)
    stock_pv_arr = np.zeros(T)
    cash_arr = np.zeros(T)
    hedge_pnl_arr = np.zeros(T)
    trades = []
    
    # 追蹤期貨空單損益
    # 嚴格模擬：當日指數收盤 vs 前一日收盤，若進行避險放空，部位名目本金 = 前一日總淨值 * hedge_ratio
    # 期貨合約亦扣除手續費與期交稅 (單邊 0.005% = 0.00005，萬分之0.5)
    FUT_FEE = 0.00005
    
    for i in range(t0, T):
        handled = set()
        
        # 1. 開盤賣出股票 (T+1 開盤價)
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos: continue
            p = pos[s]
            # 隔夜跳空開盤價
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
        
        # 2. 開盤買入股票 (T+1 開盤價)
        if pend_buy:
            curr_stock_pv = sum(p['v'] for p in pos.values())
            tot_val = cash + curr_stock_pv
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                target_amt = w * tot_val
                amt = min(target_amt, cash)
                if amt < 0.01 * tot_val: continue
                cash -= amt
                ro = C[i, s] / O[i, s]
                v = amt * (1.0 - FEE) * (ro if np.isfinite(ro) else 1.0)
                pos[s] = dict(
                    v=v, cost=amt, proc=0.0, entry=O[i, s], hh=C[i, s],
                    ei=i, days=0, leader=is_leader
                )
                handled.add(s)
            pend_buy = []
            
        # 3. 股票日內變動 (Close / Close_prev)
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        # 4. 空頭避險：指數放空計算
        # 判斷信號依據昨日收盤資訊 (無未來偷看)
        # 條件：大盤昨日收盤 < 昨日季線 (D['tx_ma60'][i-1])
        day_hedge_pnl = 0.0
        if with_hedge and i > t0:
            tx_prev = D['tx'][i - 1]
            tx_ma_prev = D['tx_ma60'][i - 1]
            if tx_prev < tx_ma_prev:
                # 處於空頭市場，進行指數空單避險
                # 名目本金依據昨日總資產
                prev_tot = eq[i - 1] if np.isfinite(eq[i - 1]) else (cash + sum(p['v'] for p in pos.values()))
                hedge_notional = prev_tot * hedge_ratio
                tx_today = D['tx'][i]
                # 指數下跌時放空賺錢，扣除期貨來回摩擦
                index_ret = (tx_today / tx_prev - 1.0)
                # 空頭獲利 = - index_ret
                day_hedge_pnl = hedge_notional * (- index_ret) - (hedge_notional * FUT_FEE)
                cash += day_hedge_pnl
                hedge_pnl_arr[i] = day_hedge_pnl
                
        # 5. 當日收盤結算淨值
        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv
        stock_pv_arr[i] = curr_stock_pv
        cash_arr[i] = cash
        
        # 6. 當日收盤出場訊號判斷 (次日執行)
        tx_today = D['tx'][i]
        tx_ma_today = D['tx_ma60'][i]
        macro_ok = tx_today >= tx_ma_today
        
        for s, p in pos.items():
            c = C[i, s]
            p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c):
                sell = 'nodata'
            elif not macro_ok:
                sell = 'macro'
            else:
                m60 = D['ma60'][i, s]
                if np.isfinite(m60) and c < m60:
                    sell = 'ma60'
                elif (not p['leader']) and (c / entry - 1.0 < -0.12):
                    sell = 'hard12'
                elif p['hh'] >= entry * 1.10 and c < entry:
                    sell = 'be' # 保本停損
            if sell:
                pend_sell[s] = (1.0, sell)
                
        # 7. 週度選股與開倉訊號 (次日開盤執行)
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
                
                # 順序四：月線乖離上限 15% (避免過熱追高)
                ok &= (c / D['ma20'][i] - 1.0) <= 0.15
                
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
                    
                    # 順序五：投信籌碼加重 (勝率加分)
                    win = .30 * mom_t + .35 * tr_ + .20 * in_ + .10 * sh_ + .05 * al_
                    order = np.argsort(-win)
                    
                    chosen = []
                    used = set(held)
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

    date_series = pd.Series(dates[t0:])
    eq_series = pd.Series(eq[t0:], index=pd.to_datetime(date_series, format='%Y%m%d'))
    tdf = pd.DataFrame(trades)
    if len(tdf) > 0:
        tdf['exit_date'] = pd.to_datetime(tdf['exit_date'], format='%Y%m%d')
        tdf['year'] = tdf['exit_date'].dt.year
    return eq_series, tdf

print("[*] 執行 1: 方案 A+ (無避險, 純股票端) ...", flush=True)
eq_no_hedge, tdf_no_hedge = run_a_plus(with_hedge=False)

print("[*] 執行 2: 方案 A+ (含空頭期 30% 台指期避險) ...", flush=True)
eq_hedge, tdf_hedge = run_a_plus(with_hedge=True, hedge_ratio=0.30)

# 計算逐年指標
years = sorted(list(set(eq_hedge.index.year)))
yearly_stats = []

for y in years:
    sub_h = eq_hedge.loc[str(y)]
    sub_nh = eq_no_hedge.loc[str(y)]
    if len(sub_h) < 5: continue
    
    # 該年首末報酬
    r_h = (sub_h.iloc[-1] / sub_h.iloc[0] - 1.0) * 100.0
    r_nh = (sub_nh.iloc[-1] / sub_nh.iloc[0] - 1.0) * 100.0
    
    # 該年 MDD
    pk_h = sub_h.cummax()
    mdd_h = ((sub_h / pk_h - 1.0).min()) * 100.0
    
    pk_nh = sub_nh.cummax()
    mdd_nh = ((sub_nh / pk_nh - 1.0).min()) * 100.0
    
    # 該年交易勝率與筆數
    y_trades = tdf_hedge[tdf_hedge['year'] == y]
    n_tr = len(y_trades)
    if n_tr > 0:
        win_rate = (y_trades['ret'] > 0).mean() * 100.0
        w_sum = y_trades.loc[y_trades['ret'] > 0, 'ret'].sum()
        l_sum = y_trades.loc[y_trades['ret'] < 0, 'ret'].abs().sum()
        pf = w_sum / l_sum if l_sum > 0 else np.nan
    else:
        win_rate = 0.0; pf = 0.0
        
    yearly_stats.append(dict(
        year=y,
        ret_hedge=r_h,
        mdd_hedge=mdd_h,
        ret_no_hedge=r_nh,
        mdd_no_hedge=mdd_nh,
        win_rate=win_rate,
        pf=pf,
        trades=n_tr
    ))

df_year = pd.DataFrame(yearly_stats)
print("\n" + "="*115)
print(f"{'年份':<6} | {'A+含避險報酬':<13} | {'A+避險MDD':<10} | {'無避險報酬':<12} | {'無避險MDD':<10} | {'個股勝率':<8} | {'盈虧比PF':<8} | {'交易筆數':<6}")
print("="*115)
for _, row in df_year.iterrows():
    print(f"{int(row['year']):<6} | {row['ret_hedge']:>11.1f}% | {row['mdd_hedge']:>8.1f}% | {row['ret_no_hedge']:>10.1f}% | {row['mdd_no_hedge']:>8.1f}% | {row['win_rate']:>7.1f}% | {row['pf']:>7.2f} | {int(row['trades']):>6}")
print("="*115)

# 全期匯總
tot_h = (eq_hedge.iloc[-1] / eq_hedge.iloc[0] - 1.0) * 100.0
tot_nh = (eq_no_hedge.iloc[-1] / eq_no_hedge.iloc[0] - 1.0) * 100.0
cagr_h = ((eq_hedge.iloc[-1] / eq_hedge.iloc[0]) ** (250.0 / len(eq_hedge)) - 1.0) * 100.0
cagr_nh = ((eq_no_hedge.iloc[-1] / eq_no_hedge.iloc[0]) ** (250.0 / len(eq_no_hedge)) - 1.0) * 100.0
mdd_tot_h = ((eq_hedge / eq_hedge.cummax() - 1.0).min()) * 100.0
mdd_tot_nh = ((eq_no_hedge / eq_no_hedge.cummax() - 1.0).min()) * 100.0
tot_win = (tdf_hedge['ret'] > 0).mean() * 100.0
tot_pf = tdf_hedge.loc[tdf_hedge['ret'] > 0, 'ret'].sum() / tdf_hedge.loc[tdf_hedge['ret'] < 0, 'ret'].abs().sum()

print(f"\n【21年全期總結】")
print(f"  * 方案 A+ (含30%避險): 累積報酬 +{tot_h:,.1f}% | CAGR {cagr_h:.2f}% | MDD {mdd_tot_h:.2f}% | 總勝率 {tot_win:.1f}% | 總盈虧比 {tot_pf:.2f} | 交易總筆數 {len(tdf_hedge)}")
print(f"  * 方案 A+ (無避險純股): 累積報酬 +{tot_nh:,.1f}% | CAGR {cagr_nh:.2f}% | MDD {mdd_tot_nh:.2f}%")

out_summary = {
    'yearly': yearly_stats,
    'total_hedge': dict(total=tot_h, cagr=cagr_h, mdd=mdd_tot_h, win=tot_win, pf=tot_pf, n=len(tdf_hedge)),
    'total_no_hedge': dict(total=tot_nh, cagr=cagr_nh, mdd=mdd_tot_nh)
}
with open(os.path.join(SCRATCH, 'scheme_a_plus_verify.json'), 'w') as f:
    json.dump(out_summary, f, indent=2, ensure_ascii=False)
