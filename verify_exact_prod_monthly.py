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
pool = D['pool_pit']

# 預計算 FIP
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

# 100% 完全複製 deploy_titan_fip_production.py，僅開放 t_start
def run_exact_prod(start_date_str):
    t_start = int(np.searchsorted(dates, start_date_str))
    cash = 1_000_000.0
    pos = {}
    pend_buy = []
    pend_sell = {}
    eq = np.full(T, np.nan)

    for i in range(t_start, T):
        dt = dates[i]
        handled = set()

        # 🌟 關鍵：必須先賣出、回補現金！
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
                del pos[s]
            else:
                ro = C[i, s] / O[i, s]
                p['v'] *= ro if np.isfinite(ro) else 1.0
                handled.add(s)
        pend_sell.clear()

        # 買進執行 (使用剛賣出釋放的充沛現金)
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

        # 個股日內變動
        for s, p in pos.items():
            if s in handled: continue
            r = C[i, s] / C[i - 1, s]
            p['v'] *= r if np.isfinite(r) else 1.0

        curr_stock_pv = sum(p['v'] for p in pos.values())
        eq[i] = cash + curr_stock_pv

        # 出場判斷 (收盤判斷，次日開盤執行)
        tx_today = D['tx'][i]; tx_ma_today = D['tx_ma60'][i]
        macro_ok = tx_today >= tx_ma_today

        for s, p in pos.items():
            c = C[i, s]; p['days'] += 1
            if np.isfinite(c): p['hh'] = max(p['hh'], c)
            entry = p['entry']
            sell = None
            if not np.isfinite(c): sell = 'nodata'
            elif not macro_ok: sell = '🛡️ 大盤跌破季線 (60MA) 防禦清倉'
            else:
                m60 = D['ma60'][i, s]
                peak_gain = p['hh'] / entry - 1.0
                if (not p['leader']) and peak_gain >= 0.60 and c < p['hh'] * 0.80:
                    sell = '🎯 衛星觸發 +60% 高檔回吐 20% 移動停利'
                elif np.isfinite(m60) and c < m60: sell = '🛡️ 跌破季線 (60MA) 防禦停損'
                elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = '⚡ 衛星觸發 -12% 停損線'
                elif p['hh'] >= entry * 1.15 and c < entry: sell = '🎯 觸發 +15% 保本平手鎖利'
            if sell: pend_sell[s] = (1.0, sell)

        # 週度選股訊號 (次日開盤執行)
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
                ok &= (c <= D['ma5'][i] * 1.025) & (D['tx'][i] >= tx_ma20[i]) & (fip_quality[i] >= 0.52)
                for h in held: ok[h] = False

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

                    win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - .20 * att_score
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

    s = pd.Series(eq[t_start:])
    tot = (s.iloc[-1] / s.iloc[0] - 1.0) * 100.0
    times = s.iloc[-1] / s.iloc[0]
    years = len(s) / 250.0
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (250.0 / len(s)) - 1.0) * 100.0
    roll_max = s.cummax()
    mdd = ((s - roll_max) / roll_max).min() * 100.0
    daily_r = s.pct_change().dropna()
    sharpe = (daily_r.mean() / (daily_r.std() + 1e-9)) * np.sqrt(250)
    return {
        'start_date': start_date_str, 'tot': tot, 'times': times, 'cagr': cagr, 'mdd': mdd, 'sharpe': sharpe, 'end_eq': s.iloc[-1], 'years': years
    }

print("=== 正在用 100% 生產代碼測試 2005 年 12 個月份進場 (確認 266.5 倍) ===")
res = []
for m in range(1, 13):
    date_str = f"2005{m:02d}01"
    valid_d = [d for d in dates if d >= date_str][0]
    r = run_exact_prod(valid_d)
    res.append(r)
    print(f"  * 進場日: {r['start_date']} ({r['years']:.1f}年) | 總獲利: {r['times']:>5.1f} 倍 (+{r['tot']:>9,.1f}%) | CAGR: {r['cagr']:>5.2f}% | MDD: {r['mdd']:>6.2f}% | Sharpe: {r['sharpe']:.2f} | 期末: {r['end_eq']:,.0f}")

df_r = pd.DataFrame(res)
print("\n" + "="*85)
print("👑 泰坦 266.5 倍生產核心 12 個進場月份統計:")
print(f"  * 平均獲利倍數: {df_r['times'].mean():.1f} 倍 (最低: {df_r['times'].min():.1f} 倍, 最高: {df_r['times'].max():.1f} 倍)")
print(f"  * CAGR 平均: {df_r['cagr'].mean():.2f}% (標準差僅: {df_r['cagr'].std():.2f}%)")
print(f"  * MDD 平均: {df_r['mdd'].mean():.2f}%")
print(f"  * Sharpe 平均: {df_r['sharpe'].mean():.2f}")
print("="*85)
