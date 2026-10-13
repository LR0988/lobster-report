#!/usr/bin/env python3
"""
verify_scheme_a_plus_correct.py
完整的 2005~2026 年（21年）年度回測與代碼查核：
1. 確保 s5 與 s20 均線斜率計算與 improve_ablation.py 100% 一致：
   s5 = (ma5 - ma5.shift(5)) / ma5.shift(5)
   s20 = (ma20 - ma20.shift(5)) / ma20.shift(5)
2. 徹底消除 0 成交量假價異常 (過濾 trade_volume == 0)
3. 嚴格 Point-in-Time 過去60日成交額前50名、T+1開盤價進出、來回 0.585% 手續費與稅
4. 輸出逐年 (2005~2026) 報酬、MDD、勝率、盈虧比與詳細交易驗證
"""
import os, sys, json, time, pickle, sqlite3
import numpy as np
import pandas as pd

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_cache_audited.pkl')
START_TRADE = '20050401'
FEE = 0.002925  # 單邊 0.2925% (來回 0.585%)
FUT_FEE = 0.00005 # 期貨

def build_audited():
    t0 = time.time()
    conn = sqlite3.connect('/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db')
    print("[*] 讀取 tw_stock.db (過濾無交易髒數據) ...", flush=True)
    px = pd.read_sql_query("""
        SELECT date, stock_id, opening_price o, highest_price h, lowest_price l,
               closing_price c, trade_value v, change_sign sg, change_price cp
        FROM daily_stock
        WHERE date >= '20050101' AND LENGTH(stock_id)=4
          AND stock_id GLOB '[0-9][0-9][0-9][0-9]' AND stock_id NOT LIKE '00%'
          AND (trade_volume > 0 OR trade_value > 0)
    """, conn)
    px = px.drop_duplicates(['date', 'stock_id'])
    
    tx = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')['close']
    
    for col in ('o', 'h', 'l', 'c', 'cp'): px[col] = pd.to_numeric(px[col], errors='coerce')
    px['v'] = pd.to_numeric(px['v'], errors='coerce')
    for col in ('o', 'h', 'l', 'c'): px.loc[px[col] <= 0, col] = np.nan
    
    sg = px['sg'].astype(str).str.strip()
    a = px['cp'].abs()
    chg_arr = np.where(sg == '-', -a, np.where(sg == '+', a, px['cp']))
    px['chg'] = pd.Series(chg_arr, index=px.index).fillna(0.0)
    px['ref'] = px['c'] - px['chg']
    
    def P(col): return px.pivot(index='date', columns='stock_id', values=col).sort_index()
    
    C0 = P('c')
    dates = C0.index
    C = C0.ffill(limit=20)
    O = P('o').reindex(dates).combine_first(C)
    H = P('h').reindex(dates).combine_first(C)
    L = P('l').reindex(dates).combine_first(C)
    V = P('v').reindex(dates).fillna(0.0)
    CHG = P('chg').reindex(dates).fillna(0.0)
    REF = P('ref').reindex(dates).fillna(C)
    del px
    
    raw = C / C.shift(1) - 1.0
    exdiv = (raw < -0.075) & ((CHG / REF) > raw + 0.05) & (REF > 0)
    adj = raw.copy()
    adj[exdiv] = (CHG[exdiv] / REF[exdiv]).clip(-0.10, 0.10)
    adj = adj.clip(-0.15, 0.15)
    
    cum = (1.0 + adj.fillna(0.0)).cumprod()
    last = C.ffill().iloc[-1].fillna(100.0)
    cl = cum.iloc[-1].replace(0, np.nan).fillna(1.0)
    Cadj = (cum.div(cl) * last).where(C.notna())
    orat = (O / C).fillna(1.0).clip(0.5, 2.0)
    Oadj = Cadj * orat
    
    print("[*] 計算均線與斜率 ...", flush=True)
    ma5 = Cadj.rolling(5).mean()
    ma10 = Cadj.rolling(10).mean()
    ma20 = Cadj.rolling(20).mean()
    ma60 = Cadj.rolling(60).mean()
    h60 = Cadj.rolling(60).max()
    
    s5 = (ma5 - ma5.shift(5)) / ma5.shift(5)
    s20 = (ma20 - ma20.shift(5)) / ma20.shift(5)
    
    r20 = Cadj.pct_change(20, fill_method=None)
    r60 = Cadj.pct_change(60, fill_method=None)
    r120 = Cadj.pct_change(120, fill_method=None)
    
    ret_d = Cadj.pct_change(fill_method=None)
    vol20 = ret_d.rolling(20).std()
    sharpe = (ret_d.rolling(20).mean() / vol20.replace(0, np.nan)) * np.sqrt(250)
    
    tr1 = H - L
    tr2 = (H - C.shift(1)).abs()
    tr3 = (L - C.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3]).groupby(level=0).max()
    atr_pct = (tr.rolling(14).mean() / C).clip(0.005, 0.20)
    
    inst = pd.read_sql_query("""
        SELECT date, stock_id, trust_net, (foreign_net + trust_net + dealer_net) AS inst_net
        FROM institutional_trades WHERE date >= '20050101'
    """, conn)
    def P_inst(col): return inst.pivot(index='date', columns='stock_id', values=col).reindex(dates).fillna(0.0)
    trust20 = P_inst('trust_net').rolling(20).sum()
    inst20 = P_inst('inst_net').rolling(20).sum()
    
    tx_series = tx.reindex(dates).ffill()
    tx_ma60 = tx_series.rolling(60).mean()
    tx_r20 = tx_series.pct_change(20, fill_method=None)
    tx_r60 = tx_series.pct_change(60, fill_method=None)
    tx_r120 = tx_series.pct_change(120, fill_method=None)
    
    mb = pd.read_sql_query('SELECT date, ad_ratio FROM market_breadth WHERE date >= "20050101"', conn).set_index('date')['ad_ratio']
    mb_s = mb.reindex(dates).ffill().fillna(0.5)
    
    rt60 = V.rolling(60, min_periods=20).mean()
    rank_pit = rt60.rank(axis=1, ascending=False)
    pool_pit = (rank_pit <= 50) & (rt60 > 0)
    
    data = dict(
        dates=dates.values, sids=Cadj.columns.values,
        C=Cadj.values, O=Oadj.values,
        ma5=ma5.values, ma10=ma10.values, ma20=ma20.values, ma60=ma60.values,
        s5=s5.values, s20=s20.values, h60=h60.values,
        r20=r20.values, r60=r60.values, r120=r120.values,
        sharpe=sharpe.values, trust20=trust20.values, inst20=inst20.values,
        atr=atr_pct.values, rt60=rt60.values,
        pool_pit=pool_pit.values,
        tx=tx_series.values, tx_ma60=tx_ma60.values,
        tx_r20=tx_r20.values, tx_r60=tx_r60.values, tx_r120=tx_r120.values,
        breadth=mb_s.values
    )
    with open(CACHE, 'wb') as f: pickle.dump(data, f)
    print(f"[✓] 審計版資料快取完成 ({time.time()-t0:.1f}s)")
    return data

if not os.path.exists(CACHE):
    D = build_audited()
else:
    with open(CACHE, 'rb') as f: D = pickle.load(f)

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

def simulate_a_plus(with_hedge=True, hedge_ratio=0.30):
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
    
    for i in range(t0, T):
        handled = set()
        
        # 1. 執行個股賣出 (T+1 開盤價)
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
        
        # 2. 執行個股買進 (T+1 開盤價)
        if pend_buy:
            tot_val = cash + sum(p['v'] for p in pos.values())
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
                amt = min(w * tot_val, cash)
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
            
        # 3. 日內價格更新
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
            
        # 4. 指數期貨空頭避險
        if with_hedge and i > t0:
            tx_prev = D['tx'][i - 1]
            tx_ma_prev = D['tx_ma60'][i - 1]
            if tx_prev < tx_ma_prev:
                prev_tot = eq[i - 1] if np.isfinite(eq[i - 1]) else (cash + sum(p['v'] for p in pos.values()))
                hedge_notional = prev_tot * hedge_ratio
                tx_today = D['tx'][i]
                index_ret = (tx_today / tx_prev - 1.0)
                hedge_pnl = hedge_notional * (- index_ret) - (hedge_notional * FUT_FEE)
                cash += hedge_pnl
                
        # 5. 當日收盤總淨值結算
        curr_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_pv
        
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
                elif p['hh'] >= entry * 1.10 and c < entry: sell = 'be'
            if sell: pend_sell[s] = (1.0, sell)
            
        # 7. 週度選股訊號
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
                ok &= (c / D['ma20'][i] - 1.0) <= 0.15 # 月線乖離上限 15%
                
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

print("[*] 執行審計版回測 (無避險 vs 含30%空頭避險) ...", flush=True)
eq_nh, tdf_nh = simulate_a_plus(with_hedge=False)
eq_h, tdf_h = simulate_a_plus(with_hedge=True, hedge_ratio=0.30)

years = sorted(list(set(eq_h.index.year)))
rows = []
for y in years:
    sub_h = eq_h.loc[str(y)]
    sub_nh = eq_nh.loc[str(y)]
    if len(sub_h) < 5: continue
    rh = (sub_h.iloc[-1] / sub_h.iloc[0] - 1.0) * 100.0
    rnh = (sub_nh.iloc[-1] / sub_nh.iloc[0] - 1.0) * 100.0
    mdd_h = ((sub_h / sub_h.cummax() - 1.0).min()) * 100.0
    mdd_nh = ((sub_nh / sub_nh.cummax() - 1.0).min()) * 100.0
    y_tr = tdf_h[tdf_h['year'] == y]
    n_tr = len(y_tr)
    wr = (y_tr['ret'] > 0).mean() * 100.0 if n_tr > 0 else 0.0
    w_sum = y_tr.loc[y_tr['ret'] > 0, 'ret'].sum()
    l_sum = y_tr.loc[y_tr['ret'] < 0, 'ret'].abs().sum()
    pf = w_sum / l_sum if l_sum > 0 else np.nan
    rows.append(dict(
        year=y, ret_hedge=rh, mdd_hedge=mdd_h,
        ret_no_hedge=rnh, mdd_no_hedge=mdd_nh,
        win_rate=wr, pf=pf, trades=n_tr
    ))

df_res = pd.DataFrame(rows)
print("\n" + "="*115)
print(f"{'年份':<6} | {'A+含避險報酬':<13} | {'A+避險MDD':<10} | {'無避險報酬':<12} | {'無避險MDD':<10} | {'個股勝率':<8} | {'盈虧比PF':<8} | {'交易筆數':<6}")
print("="*115)
for _, r in df_res.iterrows():
    print(f"{int(r['year']):<6} | {r['ret_hedge']:>11.1f}% | {r['mdd_hedge']:>8.1f}% | {r['ret_no_hedge']:>10.1f}% | {r['mdd_no_hedge']:>8.1f}% | {r['win_rate']:>7.1f}% | {r['pf']:>7.2f} | {int(r['trades']):>6}")
print("="*115)

tot_h = (eq_h.iloc[-1] / eq_h.iloc[0] - 1.0) * 100.0
tot_nh = (eq_nh.iloc[-1] / eq_nh.iloc[0] - 1.0) * 100.0
cagr_h = ((eq_h.iloc[-1] / eq_h.iloc[0]) ** (250.0 / len(eq_h)) - 1.0) * 100.0
cagr_nh = ((eq_nh.iloc[-1] / eq_nh.iloc[0]) ** (250.0 / len(eq_nh)) - 1.0) * 100.0
mdd_tot_h = ((eq_h / eq_h.cummax() - 1.0).min()) * 100.0
mdd_tot_nh = ((eq_nh / eq_nh.cummax() - 1.0).min()) * 100.0
tot_win = (tdf_h['ret'] > 0).mean() * 100.0
tot_pf = tdf_h.loc[tdf_h['ret'] > 0, 'ret'].sum() / tdf_h.loc[tdf_h['ret'] < 0, 'ret'].abs().sum()

print(f"\n【21年審計核實總結】")
print(f"  * 方案 A+ (含30%避險): 累積報酬 +{tot_h:,.1f}% | CAGR {cagr_h:.2f}% | MDD {mdd_tot_h:.2f}% | 總勝率 {tot_win:.1f}% | 總盈虧比 {tot_pf:.2f} | 交易總筆數 {len(tdf_h)}")
print(f"  * 方案 A+ (無避險純股): 累積報酬 +{tot_nh:,.1f}% | CAGR {cagr_nh:.2f}% | MDD {mdd_tot_nh:.2f}%")

with open(os.path.join(SCRATCH, 'audited_scheme_a_plus.json'), 'w') as f:
    json.dump({
        'yearly': rows,
        'tot_hedge': dict(total=tot_h, cagr=cagr_h, mdd=mdd_tot_h, win=tot_win, pf=tot_pf, n=len(tdf_h)),
        'tot_no_hedge': dict(total=tot_nh, cagr=cagr_nh, mdd=mdd_tot_nh)
    }, f, indent=2, ensure_ascii=False)
