import pickle, numpy as np, pandas as pd

CACHE = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch/pit_clean_verified.pkl'
with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 讀取產業分類
import sqlite3
conn = sqlite3.connect('/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db')
df_ind = pd.read_sql_query('SELECT DISTINCT stock_id, industry FROM monthly_revenue WHERE industry IS NOT NULL AND industry != ""', conn).drop_duplicates(subset=['stock_id'])
conn.close()
ind_map = dict(zip(df_ind['stock_id'], df_ind['industry']))
stock_ind_array = np.array([ind_map.get(s, '其他') for s in D['sids']])

base_ok = pool & np.isfinite(C) & np.isfinite(D['ma60'])
base_ok &= (C >= D['ma60'] * 1.025) & (C >= D['ma20']) & (D['ma20'] >= D['ma60'])
base_ok &= (D['s5'] >= 0) & (D['r20'] >= 0) & (D['s20'] >= 0.025) & (C >= 0.88 * D['h60'])

ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

FEE = 0.002925

# 完美復刻 Option A 基準 (Commit 1e911a9 / 266.5倍配置)
def run_exact_option_a(enable_sector_synergy=False):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan)

    lead_w = 0.70; sat_w = 0.15; num_sats = 2
    pullback = 1.025; be_trig = 0.15; trail_trig = 0.60; anti_att = 0.20

    for i in range(t0, T):
        handled = set()
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos: continue
            px = O[i, s]
            if not np.isfinite(px) or px <= 0: px = C[i-1, s]
            sh = pos[s]['sh'] * f
            cash += sh * px * (1.0 - FEE)
            pos[s]['sh'] -= sh
            if pos[s]['sh'] <= 1e-4: del pos[s]
            handled.add(s)
        pend_sell.clear()

        for s, target_val, role in pend_buy:
            if s in handled: continue
            px = O[i, s]
            if not np.isfinite(px) or px <= 0: px = C[i-1, s]
            cur_tot = cash + sum(pos[k]['sh'] * C[i-1, k] for k in pos)
            val = cur_tot * target_val
            if cash < val * (1.0 + FEE): val = max(0.0, cash / (1.0 + FEE) * 0.98)
            if val > 1000 and px > 0:
                sh = val / (px * (1.0 + FEE))
                cash -= val
                pos[s] = {'sh': sh, 'ep': px, 'role': role, 'highest': px, 'entry_i': i}
        pend_buy.clear()

        tot_eq = cash
        for s in list(pos.keys()):
            px = C[i, s]
            if not np.isfinite(px) or px <= 0: px = pos[s]['ep']
            tot_eq += pos[s]['sh'] * px
            if px > pos[s]['highest']: pos[s]['highest'] = px
        eq[i] = tot_eq

        for s in list(pos.keys()):
            p = pos[s]; px = C[i, s]
            if not np.isfinite(px) or px <= 0: continue
            ret = px / p['ep'] - 1.0
            from_high = px / p['highest'] - 1.0

            if p['role'] == 'leader':
                if ret >= be_trig and (px < p['ep'] * 1.005):
                    pend_sell[s] = (1.0, 'BE_Leader')
                elif ret <= -0.15:
                    pend_sell[s] = (1.0, 'HardStop_Leader')
            else:
                if ret >= trail_trig and from_high <= -0.20:
                    pend_sell[s] = (1.0, 'TrailStop_Sat')
                elif ret >= be_trig and (px < p['ep'] * 1.005):
                    pend_sell[s] = (1.0, 'BE_Sat')
                elif ret <= -0.12:
                    pend_sell[s] = (1.0, 'HardStop_Sat')

        is_sched = ((i - t0) % 30 == 0)
        has_lead = any(pos[k]['role'] == 'leader' for k in pos)
        cur_sat_cnt = sum(1 for k in pos if pos[k]['role'] == 'satellite')
        is_refill = (not has_lead) or (cur_sat_cnt < num_sats)

        if (is_sched or is_refill) and (D['tx'][i] >= tx_ma20[i]) and (D['breadth'][i] >= 0.35):
            cands = np.where(base_ok[i])[0]

            raw_scores = []
            for s in cands:
                if fip_quality[i, s] < 0.52: continue
                if C[i, s] > D['ma5'][i, s] * pullback: continue

                sc = 0.40 * D['r60'][i, s] + 0.25 * D['trust20'][i, s] + 0.15 * D['inst20'][i, s]
                sc -= anti_att * abnormal_attention[i, s]

                # 🌟 族群共振加成 (非排除，而是強者主流加分 Boost / 軟性加權)
                raw_scores.append((s, sc, stock_ind_array[s]))

            if raw_scores:
                if enable_sector_synergy:
                    # 計算各產業平均得分或動能
                    ind_sc_map = {}
                    for s, sc, ind in raw_scores:
                        ind_sc_map.setdefault(ind, []).append(sc)
                    ind_avg = {ind: np.mean(v) for ind, v in ind_sc_map.items()}
                    top_3_inds = set(pd.Series(ind_avg).nlargest(3).index)
                    # 主流族群享受 30% 評分加成 (Sector Momentum Boost)
                    boosted = []
                    for s, sc, ind in raw_scores:
                        final_sc = sc * 1.30 if ind in top_3_inds else sc
                        boosted.append((s, final_sc))
                    boosted.sort(key=lambda x: x[1], reverse=True)
                    ranked_sids = [x[0] for x in boosted]
                else:
                    raw_scores.sort(key=lambda x: x[1], reverse=True)
                    ranked_sids = [x[0] for x in raw_scores]

                lead_sid = ranked_sids[0]
                sat_sids = ranked_sids[1:1+num_sats]

                if is_sched:
                    for k in list(pos.keys()):
                        if k != lead_sid and k not in sat_sids:
                            pend_sell[k] = (1.0, 'Rebalance_Exit')
                    if lead_sid not in pos: pend_buy.append((lead_sid, lead_w, 'leader'))
                    for s in sat_sids:
                        if s not in pos: pend_buy.append((s, sat_w, 'satellite'))
                elif is_refill:
                    if not has_lead: pend_buy.append((lead_sid, lead_w, 'leader'))
                    for s in sat_sids:
                        if len([k for k in pos if pos[k]['role'] == 'satellite']) + len([b for b in pend_buy if b[2] == 'satellite']) < num_sats:
                            if s not in pos: pend_buy.append((s, sat_w, 'satellite'))

    return eq

eq_a = run_exact_option_a(enable_sector_synergy=False)
eq_b = run_exact_option_a(enable_sector_synergy=True)

def stats(eq):
    s = pd.Series(eq).dropna()
    tot = (s.iloc[-1] / s.iloc[0] - 1.0) * 100.0
    times = s.iloc[-1] / s.iloc[0]
    years = len(s) / 250.0
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (1.0 / years) - 1.0) * 100.0
    roll_max = s.cummax()
    mdd = ((s - roll_max) / roll_max).min() * 100.0
    daily_r = s.pct_change().dropna()
    sharpe = (daily_r.mean() / (daily_r.std() + 1e-9)) * np.sqrt(250)
    return tot, times, cagr, mdd, sharpe, s.iloc[-1]

t_a, tm_a, cagr_a, mdd_a, sh_a, end_a = stats(eq_a)
t_b, tm_b, cagr_b, mdd_b, sh_b, end_b = stats(eq_b)

print("\n" + "="*85)
print("👑 泰坦 260 倍原生架構 (Option A / 2005~2026 全歷史 5326 交易日) 實測核對")
print("="*85)
print(f"{'指標':<22} | {'原版 Option A 基準':<25} | {'族群動能加成升級版':<25}")
print("-"*85)
print(f"{'累積總獲利倍數':<22} | {tm_a:,.1f} 倍 ( +{t_a:,.1f}% ) | {tm_b:,.1f} 倍 ( +{t_b:,.1f}% )")
print(f"{'20年年化複合 (CAGR)':<22} | {cagr_a:.2f}% | {cagr_b:.2f}%")
print(f"{'歷史最大回撤 (MDD)':<22} | {mdd_a:.2f}% | {mdd_b:.2f}%")
print(f"{'夏普比率 (Sharpe)':<22} | {sh_a:.2f} | {sh_b:.2f}")
print(f"{'期末資產 (100萬起步)':<22} | {end_a:,.0f} 元 | {end_b:,.0f} 元")
print("="*85)
