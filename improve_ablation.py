#!/usr/bin/env python3
"""
improve_ablation.py
逐項測試「提升獲利 + 勝率」建議：
  股票池偷看未來修正 / 出場改革(ATR移動停損, 分批停利, 保本, 時間停損) /
  部位配置(波動加權5檔) / 回撤熔斷 / 進場乖離上限
同一引擎、同一費用；2005-2022 為開發期，2023-2026 為封存驗證期。
"""
import os, sys, json, time, pickle, sqlite3
import numpy as np
import pandas as pd

np.seterr(all='ignore')

DB = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
os.makedirs(SCRATCH, exist_ok=True)
CACHE = os.path.join(SCRATCH, 'pit_cache.pkl')
START_TRADE = '20050401'
SPLIT_DATE = '20230101'
FEE = 0.002925  # 單邊 (來回約 0.585%)


# ----------------------------------------------------------------------------
# 資料建置 (含快取)
# ----------------------------------------------------------------------------
def build():
    t = time.time()
    conn = sqlite3.connect(DB)
    print('[*] 讀取全部 4 碼個股日行情 ...', flush=True)
    px = pd.read_sql_query("""
        SELECT date, stock_id, opening_price o, highest_price h, lowest_price l,
               closing_price c, trade_value v, change_sign sg, change_price cp
        FROM daily_stock
        WHERE date >= '20050101' AND LENGTH(stock_id)=4
          AND stock_id GLOB '[0-9][0-9][0-9][0-9]' AND stock_id NOT LIKE '00%'
    """, conn)
    px = px.drop_duplicates(['date', 'stock_id'])
    print(f'    {len(px):,} 筆, {px.stock_id.nunique()} 檔 ({time.time()-t:.0f}s)', flush=True)

    tx = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')['close']

    for col in ('o', 'h', 'l', 'c', 'cp'):
        px[col] = pd.to_numeric(px[col], errors='coerce')
    px['v'] = pd.to_numeric(px['v'], errors='coerce')
    for col in ('o', 'h', 'l', 'c'):
        px.loc[px[col] <= 0, col] = np.nan

    sg = px['sg'].astype(str).str.strip()
    a = px['cp'].abs()
    px['chg'] = np.where(sg == '-', -a, np.where(sg == '+', a, px['cp']))
    px['chg'] = px['chg'].fillna(0.0)
    px['ref'] = px['c'] - px['chg']

    def P(col):
        return px.pivot(index='date', columns='stock_id', values=col).sort_index()

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

    # 除權息還原報酬
    raw = C / C.shift(1) - 1.0
    exdiv = (raw < -0.075) & ((CHG / REF) > raw + 0.05)
    adj = raw.copy()
    adj[exdiv] = (CHG[exdiv] / REF[exdiv]).clip(-0.10, 0.10)
    cum = (1.0 + adj.fillna(0.0)).cumprod()
    last = C.ffill().iloc[-1].fillna(100.0)
    cl = cum.iloc[-1].replace(0, np.nan).fillna(1.0)
    Cadj = (cum.div(cl) * last).where(C.notna())
    orat = (O / C).fillna(1.0).clip(0.5, 2.0)
    Oadj = Cadj * orat

    # 流動性池
    rt60 = V.rolling(60, min_periods=20).mean()
    rank_pit = rt60.rank(axis=1, ascending=False)
    pool_pit = (rank_pit <= 50) & (rt60 > 0)

    # 舊版：「每年全年成交額前60」(含偷看未來) 的超集
    yrs = sorted(set(d[:4] for d in dates))
    sup = set()
    for y in yrs:
        m = [d[:4] == y for d in dates]
        tot = V[m].sum().nlargest(60)
        sup.update(tot.index.tolist())
    sup = sorted(sup)
    pit_ever = pool_pit.any(axis=0)
    keep = sorted(set(sup) | set(pit_ever[pit_ever].index.tolist()))
    print(f'    靜態(含未來)股票池超集 {len(sup)} 檔, 兩種池聯集 {len(keep)} 檔', flush=True)

    rt_s = rt60[sup]
    pool_static = (rt_s.rank(axis=1, ascending=False) <= 50) & (rt_s > 0)
    pool_static = pool_static.reindex(columns=keep, fill_value=False)
    pool_pit = pool_pit[keep]

    C, O, Cadj, Oadj, H, L, V, adj = [x[keep] for x in (C, O, Cadj, Oadj, H, L, V, adj)]
    rt60 = rt60[keep]

    ma5 = Cadj.rolling(5, min_periods=3).mean()
    ma10 = Cadj.rolling(10, min_periods=5).mean()
    ma20 = Cadj.rolling(20, min_periods=10).mean()
    ma60 = Cadj.rolling(60, min_periods=20).mean()
    s5 = (ma60 - ma60.shift(5)) / ma60.shift(5)
    s20 = (ma20 - ma20.shift(5)) / ma20.shift(5)
    h60 = Cadj.rolling(60, min_periods=20).max()
    r20 = Cadj.pct_change(20, fill_method=None)
    r60 = Cadj.pct_change(60, fill_method=None)
    r120 = Cadj.pct_change(120, fill_method=None)
    vol60 = adj.rolling(60, min_periods=20).std()
    sharpe = r60 / (vol60 * np.sqrt(60) + 1e-5)

    pC = C.shift(1)
    tr = pd.concat([(H - L).abs(), (H - pC).abs(), (L - pC).abs()]).groupby(level=0).max() if False else None
    trv = np.maximum(np.maximum((H - L).abs().values, (H - pC).abs().values), (L - pC).abs().values) / pC.values
    trv = np.clip(trv, 0, 0.12)
    atr = pd.DataFrame(trv, index=dates, columns=keep).rolling(14, min_periods=5).mean()

    print('[*] 讀取法人買賣超 ...', flush=True)
    inst = pd.read_sql_query("SELECT date, stock_id, foreign_net, trust_net FROM institutional_trades WHERE date >= '20050101'", conn)
    conn.close()
    inst = inst[inst.stock_id.isin(keep)]
    inst['inst_net'] = inst['foreign_net'].fillna(0) + inst['trust_net'].fillna(0)

    def PI(col):
        return inst.pivot_table(index='date', columns='stock_id', values=col, aggfunc='sum').reindex(index=dates, columns=keep).fillna(0.0)
    trust20 = PI('trust_net').rolling(20, min_periods=10).sum()
    inst20 = PI('inst_net').rolling(20, min_periods=10).sum()

    txs = tx.reindex(dates).ffill().bfill()
    tx_ma60 = txs.rolling(60).mean().bfill()
    live = Cadj.notna() & (rt60 > 0)
    breadth = ((Cadj >= ma20) & live).sum(axis=1) / live.sum(axis=1).clip(lower=1)

    D = dict(
        dates=np.array(dates), sids=np.array(keep),
        C=Cadj.values, O=Oadj.values, ma5=ma5.values, ma10=ma10.values, ma20=ma20.values, ma60=ma60.values,
        s5=s5.values, s20=s20.values, h60=h60.values, r20=r20.values, r60=r60.values, r120=r120.values,
        sharpe=sharpe.values, trust20=trust20.values, inst20=inst20.values, atr=atr.values, rt60=rt60.values,
        pool_pit=pool_pit.values, pool_static=pool_static.values,
        tx=txs.values, tx_ma60=tx_ma60.values,
        tx_r20=txs.pct_change(20).values, tx_r60=txs.pct_change(60).values, tx_r120=txs.pct_change(120).values,
        breadth=breadth.values,
    )
    with open(CACHE, 'wb') as f:
        pickle.dump(D, f)
    print(f'[✓] 資料建置完成並快取 ({time.time()-t:.0f}s)', flush=True)
    return D


def load():
    if os.path.exists(CACHE):
        with open(CACHE, 'rb') as f:
            return pickle.load(f)
    return build()


# ----------------------------------------------------------------------------
# 回測引擎
# ----------------------------------------------------------------------------
def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values


def run(D, cfg):
    dates = D['dates']; C = D['C']; O = D['O']
    T = len(dates)
    t0 = int(np.searchsorted(dates, START_TRADE))
    pool = D['pool_pit'] if cfg['pool'] == 'pit' else D['pool_static']

    cash = 1_000_000.0
    pos = {}
    pend_sell = {}   # s -> (frac, reason)
    pend_buy = []    # (s, weight, is_leader)
    eq = np.full(T, np.nan)
    expo = np.zeros(T)
    trades = []
    level = 0
    cool_until = -1
    reset_i = t0

    for i in range(t0, T):
        handled = set()
        # ---- 1. 開盤執行賣出 ----
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos:
                continue
            p = pos[s]
            g = O[i, s] / C[i - 1, s] if i > 0 else 1.0
            if not np.isfinite(g) or g <= 0:
                g = 1.0
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

        # ---- 2. 開盤執行買進 ----
        if pend_buy:
            base = cash + sum(p['v'] for p in pos.values())
            for s, w, is_leader in pend_buy:
                if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]):
                    continue
                amount = min(w * base, cash)
                if amount < 0.01 * base:
                    continue
                cash -= amount
                ro = C[i, s] / O[i, s]
                v = amount * (1 - FEE) * (ro if np.isfinite(ro) else 1.0)
                a0 = D['atr'][i - 1, s]
                pos[s] = dict(v=v, cost=amount, proc=0.0, entry=O[i, s], hh=C[i, s], ei=i, days=0,
                              atr0=a0 if np.isfinite(a0) else 0.03, tp=False, leader=is_leader)
                handled.add(s)
            pend_buy = []

        # ---- 3. 當日報酬 ----
        for s, p in pos.items():
            if s in handled:
                continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0
        pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + pv
        expo[i] = pv / eq[i] if eq[i] > 0 else 0

        tx_ok = D['tx'][i] >= D['tx_ma60'][i]

        # ---- 4. 收盤判斷出場 (次日開盤執行) ----
        for s, p in pos.items():
            c = C[i, s]
            p['days'] += 1
            if np.isfinite(c):
                p['hh'] = max(p['hh'], c)
            entry = p['entry']
            R = min(max(3 * p['atr0'], 0.06), 0.18)
            sell = None
            if not np.isfinite(c):
                sell = 'nodata'
            elif not tx_ok:
                sell = 'macro'
            else:
                if cfg['trail']:
                    atr_now = min(max(D['atr'][i, s], 0.01), 0.06) if np.isfinite(D['atr'][i, s]) else 0.03
                    stop = max(entry * (1 - R), p['hh'] * (1 - 3 * atr_now))
                    if cfg['be'] and p['hh'] >= entry * 1.10:
                        stop = max(stop, entry)
                    if c <= stop:
                        sell = 'trail'
                else:
                    m60 = D['ma60'][i, s]
                    if np.isfinite(m60) and c < m60:
                        sell = 'ma60'
                    elif (not p['leader']) and c / entry - 1 < -0.12:
                        sell = 'hard12'
                    elif cfg['be'] and p['hh'] >= entry * 1.10 and c < entry:
                        sell = 'be'
                if sell is None and cfg['tstop'] and p['days'] >= 15 and c / entry < 1.05:
                    sell = 'time'
            if sell:
                pend_sell[s] = (1.0, sell)
            elif cfg['tp'] and (not p['tp']) and c >= entry * (1 + 2 * R):
                p['tp'] = True
                pend_sell[s] = (1 / 3, 'tp')

        # ---- 5. 回撤熔斷 ----
        if cfg['breaker']:
            lo = max(t0, i - 120, reset_i)
            peak = np.nanmax(eq[lo:i + 1])
            dd = eq[i] / peak - 1
            if dd <= -0.25 and level < 2:
                level = 2
                cool_until = i + 20
                reset_i = i
                for s in pos:
                    pend_sell[s] = (1.0, 'breaker')
            elif dd <= -0.15 and level < 1:
                level = 1
                for s in pos:
                    if s not in pend_sell:
                        pend_sell[s] = (0.5, 'breaker_half')
            elif dd > -0.08 and level > 0:
                level = 0

        # ---- 6. 週度選股 / 遞補 ----
        if i % 5 == 0 and i + 1 < T and tx_ok and D['breadth'][i] >= 0.35 and level < 2 and i >= cool_until:
            full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
            held = {s for s in pos if s not in full_sell}
            if cfg['sizing'] == 'fixed':
                has_leader = any(pos[s]['leader'] for s in held)
                nsat = sum(1 for s in held if not pos[s]['leader'])
                need_leader = not has_leader
                need_sat = max(0, 2 - nsat)
                need = int(need_leader) + need_sat
            else:
                need = max(0, 5 - len(held))
                need_leader = False; need_sat = need
            if need > 0:
                c = C[i]
                ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
                ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
                ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
                if cfg['bias_cap'] is not None:
                    ok &= (c / D['ma20'][i] - 1) <= cfg['bias_cap']
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
                    mult = 0.5 if level == 1 else 1.0
                    chosen = []
                    used = set(held)
                    if cfg['sizing'] == 'fixed':
                        if need_leader:
                            top5 = set(np.argsort(-turn_t)[:5].tolist())
                            for k in order:
                                if k in top5 and sel[k] not in used:
                                    chosen.append((sel[k], 0.70 * mult, True)); used.add(sel[k]); break
                        got = 0
                        for k in order:
                            if got >= need_sat:
                                break
                            if sel[k] not in used:
                                chosen.append((sel[k], 0.15 * mult, False)); used.add(sel[k]); got += 1
                    else:
                        got = 0
                        for k in order:
                            if got >= need:
                                break
                            if sel[k] not in used:
                                a0 = D['atr'][i, sel[k]]
                                a0 = a0 if np.isfinite(a0) else 0.03
                                Rk = min(max(3 * a0, 0.06), 0.18)
                                w = min(0.25, 0.015 / Rk) * mult
                                chosen.append((sel[k], w, False)); used.add(sel[k]); got += 1
                    pend_buy = chosen

    return dict(eq=eq, expo=expo, trades=trades, t0=t0)


# ----------------------------------------------------------------------------
# 績效統計
# ----------------------------------------------------------------------------
def stats(D, res, lo_date, hi_date):
    dates = D['dates']
    lo = max(res['t0'], int(np.searchsorted(dates, lo_date)))
    hi = int(np.searchsorted(dates, hi_date)) if hi_date else len(dates)
    e = res['eq'][lo:hi]
    if len(e) < 30:
        return None
    ret = e[-1] / e[0] - 1
    yrs = len(e) / 242.0
    cagr = (e[-1] / e[0]) ** (1 / yrs) - 1
    peak = np.maximum.accumulate(e)
    mdd = (e / peak - 1).min()
    dr = np.diff(e) / e[:-1]
    sharpe = dr.mean() / dr.std() * np.sqrt(242) if dr.std() > 0 else 0
    tr = [t for t in res['trades'] if lo <= t['exit'] < hi]
    wins = [t['ret'] for t in tr if t['ret'] > 0]
    loss = [-t['ret'] for t in tr if t['ret'] <= 0]
    wr = len(wins) / len(tr) * 100 if tr else 0
    pf = sum(wins) / sum(loss) if loss and sum(loss) > 0 else 0
    med = float(np.median([t['ret'] for t in tr])) if tr else 0
    tx = D['tx']
    bcagr = (tx[hi - 1] / tx[lo]) ** (1 / yrs) - 1
    ex = res['expo'][lo:hi].mean() * 100
    return dict(total=ret * 100, cagr=cagr * 100, mdd=mdd * 100, sharpe=sharpe, win=wr, pf=pf,
                n=len(tr), med=med, expo=ex, bm=bcagr * 100)


BASE = dict(pool='static', trail=False, tp=False, be=False, tstop=False, sizing='fixed', breaker=False, bias_cap=None)


def v(**kw):
    c = dict(BASE); c.update(kw); return c


VARIANTS = [
    ('V0 基準(舊股票池+MA60出場+70/15/15)', v()),
    ('V1 股票池改 point-in-time', v(pool='pit')),
    ('  +ATR移動停損(取代MA60)', v(pool='pit', trail=True)),
    ('  +分批停利(+2R賣1/3)', v(pool='pit', tp=True)),
    ('  +保本停損(+10%後)', v(pool='pit', be=True)),
    ('  +時間停損(15天<5%)', v(pool='pit', tstop=True)),
    ('V2 出場全改革(4項合併)', v(pool='pit', trail=True, tp=True, be=True, tstop=True)),
    ('  V2+波動加權5檔', v(pool='pit', trail=True, tp=True, be=True, tstop=True, sizing='volw')),
    ('  V2+回撤熔斷', v(pool='pit', trail=True, tp=True, be=True, tstop=True, breaker=True)),
    ('V3 V2+5檔波動加權+熔斷', v(pool='pit', trail=True, tp=True, be=True, tstop=True, sizing='volw', breaker=True)),
    ('V4 V3+乖離上限15%', v(pool='pit', trail=True, tp=True, be=True, tstop=True, sizing='volw', breaker=True, bias_cap=0.15)),
]


def main():
    D = load()
    print(f"[*] 資料: {len(D['dates'])} 日 x {len(D['sids'])} 檔", flush=True)
    out = []
    segs = [('全期 2005-2026', START_TRADE, None), ('開發期 2005-2022', START_TRADE, SPLIT_DATE), ('封存期 2023-2026', SPLIT_DATE, None)]
    for name, cfg in VARIANTS:
        t = time.time()
        res = run(D, cfg)
        row = dict(name=name)
        for sn, lo, hi in segs:
            row[sn] = stats(D, res, lo, hi)
        out.append(row)
        f = row['全期 2005-2026']
        print(f"{name:<38} 全期 CAGR {f['cagr']:6.2f}% MDD {f['mdd']:7.2f}% Sh {f['sharpe']:.2f} 勝率 {f['win']:.1f}% PF {f['pf']:.2f} n={f['n']} ({time.time()-t:.0f}s)", flush=True)

    print('\n' + '=' * 118)
    for sn, _, _ in segs:
        print(f'\n【{sn}】  (大盤 CAGR {out[0][sn]["bm"]:.2f}%)')
        print(f"{'版本':<40}{'總報酬%':>10}{'CAGR%':>8}{'MDD%':>8}{'Sharpe':>8}{'勝率%':>7}{'盈虧比':>7}{'中位數%':>8}{'筆數':>6}{'曝險%':>7}")
        for r in out:
            s = r[sn]
            if not s:
                continue
            print(f"{r['name']:<40}{s['total']:>10.0f}{s['cagr']:>8.2f}{s['mdd']:>8.1f}{s['sharpe']:>8.2f}{s['win']:>7.1f}{s['pf']:>7.2f}{s['med']:>8.2f}{s['n']:>6}{s['expo']:>7.0f}")
    with open(os.path.join(SCRATCH, 'ablation_result.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, default=float)
    print('\n[✓] 結果已存 scratch/ablation_result.json')


if __name__ == '__main__':
    main()
