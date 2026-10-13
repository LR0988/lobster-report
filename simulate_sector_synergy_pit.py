import pickle, numpy as np, pandas as pd
import sqlite3

CACHE = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch/pit_clean_verified.pkl'
with open(CACHE, 'rb') as f:
    D = pickle.load(f)

dates = D['dates']; sids = D['sids']; C = D['C']; O = D['O']
T = len(dates); t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 讀取產業對應
conn = sqlite3.connect('/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db')
df_ind = pd.read_sql_query('SELECT DISTINCT stock_id, industry FROM monthly_revenue WHERE industry IS NOT NULL AND industry != ""', conn).drop_duplicates(subset=['stock_id'])
conn.close()
ind_map = dict(zip(df_ind['stock_id'], df_ind['industry']))
stock_ind_array = np.array([ind_map.get(s, '其他') for s in sids])

# 基礎多頭趨勢條件
base_ok = pool & np.isfinite(C) & np.isfinite(D['ma60'])
base_ok &= (C >= D['ma60'] * 1.025) & (C >= D['ma20']) & (D['ma20'] >= D['ma60'])
base_ok &= (D['s5'] >= 0) & (D['r20'] >= 0) & (D['s20'] >= 0.025) & (C >= 0.88 * D['h60'])

# 計算 FIP 與散戶關注度指標
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

FEE = 0.002925

def run_option_a_sim(enable_sector_filter=False):
    cash = 1_000_000.0; pos = {}; pend_sell = {}; pend_buy = []
    eq = np.full(T, np.nan); trades = []

    lead_w = 0.70; sat_w = 0.15; num_sats = 2
    pullback = 1.025; be_trig = 0.15; trail_trig = 0.60; anti_att = 0.20

    for i in range(t0, T):
        handled = set()
        # 1. 賣出執行 (T+1 開盤價)
        for s, (f, why) in list(pend_sell.items()):
            if s not in pos: continue
            px = O[i, s]
            if not np.isfinite(px) or px <= 0: px = C[i-1, s]
            sh = pos[s]['sh'] * f
            cash += sh * px * (1.0 - FEE)
            pos[s]['sh'] -= sh
            trades.append(why)
            if pos[s]['sh'] <= 1e-4:
                del pos[s]
            handled.add(s)
        pend_sell.clear()

        # 2. 買入執行 (T+1 開盤價)
        for s, target_val, role in pend_buy:
            if s in handled: continue
            px = O[i, s]
            if not np.isfinite(px) or px <= 0: px = C[i-1, s]
            cur_tot = cash + sum(pos[k]['sh'] * C[i-1, k] for k in pos)
            val = cur_tot * target_val
            if cash < val * (1.0 + FEE):
                val = max(0.0, cash / (1.0 + FEE) * 0.98)
            if val > 1000 and px > 0:
                sh = val / (px * (1.0 + FEE))
                cash -= val
                pos[s] = {'sh': sh, 'ep': px, 'role': role, 'highest': px, 'entry_i': i}
        pend_buy.clear()

        # 3. 結算市值
        tot_eq = cash
        for s in list(pos.keys()):
            px = C[i, s]
            if not np.isfinite(px) or px <= 0: px = pos[s]['ep']
            tot_eq += pos[s]['sh'] * px
            if px > pos[s]['highest']: pos[s]['highest'] = px
        eq[i] = tot_eq

        # 4. 盤中防守檢測
        for s in list(pos.keys()):
            p = pos[s]; px = C[i, s]
            if not np.isfinite(px) or px <= 0: continue
            ret = px / p['ep'] - 1.0
            from_high = px / p['highest'] - 1.0

            # 王者泰坦防守
            if p['role'] == 'leader':
                if ret >= be_trig and (px < p['ep'] * 1.005):
                    pend_sell[s] = (1.0, 'BE_Leader')
                elif ret <= -0.15:
                    pend_sell[s] = (1.0, 'HardStop_Leader')
            else: # 衛星防守
                if ret >= trail_trig and from_high <= -0.20:
                    pend_sell[s] = (1.0, 'TrailStop_Sat')
                elif ret >= be_trig and (px < p['ep'] * 1.005):
                    pend_sell[s] = (1.0, 'BE_Sat')
                elif ret <= -0.12:
                    pend_sell[s] = (1.0, 'HardStop_Sat')

        # 5. 調倉選股 (每 30 日或衛星空缺遞補)
        is_sched = ((i - t0) % 30 == 0)
        has_lead = any(pos[k]['role'] == 'leader' for k in pos)
        cur_sat_cnt = sum(1 for k in pos if pos[k]['role'] == 'satellite')
        is_refill = (not has_lead) or (cur_sat_cnt < num_sats)

        if (is_sched or is_refill) and (D['tx'][i] >= tx_ma20[i]) and (D['breadth'][i] >= 0.35):
            cands = np.where(base_ok[i])[0]

            # 🌟 族群共振過濾 (Point-in-Time 零上帝視角)
            if enable_sector_filter and len(cands) > 0:
                # 計算全市場各族群當期過去 20 日平均動能
                r20_i = D['r20'][i]
                valid_r20_mask = np.isfinite(r20_i)
                df_temp = pd.DataFrame({'ind': stock_ind_array[valid_r20_mask], 'r20': r20_i[valid_r20_mask]})
                ind_means = df_temp.groupby('ind')['r20'].mean().dropna()
                top_3_inds = set(ind_means.nlargest(3).index)
                
                # 只保留屬於前 3 大主流產業的候選股
                cands = [s for s in cands if stock_ind_array[s] in top_3_inds]

            if len(cands) > 0:
                # 綜合打分 (FIP 0.52 + 散戶避雷 -0.20 + 動能排分)
                raw_scores = []
                for s in cands:
                    if fip_quality[i, s] < 0.52: continue
                    pull_ok = (C[i, s] <= D['ma5'][i, s] * pullback)
                    if not pull_ok: continue

                    sc = 0.40 * D['r60'][i, s] + 0.25 * D['trust20'][i, s] + 0.15 * D['inst20'][i, s]
                    sc -= anti_att * abnormal_attention[i, s]
                    raw_scores.append((s, sc))

                if raw_scores:
                    raw_scores.sort(key=lambda x: x[1], reverse=True)
                    ranked_sids = [x[0] for x in raw_scores]

                    lead_sid = ranked_sids[0]
                    sat_sids = ranked_sids[1:1+num_sats]

                    if is_sched:
                        # 全新輪動
                        for k in list(pos.keys()):
                            if k != lead_sid and k not in sat_sids:
                                pend_sell[k] = (1.0, 'Rebalance_Exit')
                        if lead_sid not in pos:
                            pend_buy.append((lead_sid, lead_w, 'leader'))
                        for s in sat_sids:
                            if s not in pos:
                                pend_buy.append((s, sat_w, 'satellite'))
                    elif is_refill:
                        if not has_lead:
                            pend_buy.append((lead_sid, lead_w, 'leader'))
                        for s in sat_sids:
                            if len([k for k in pos if pos[k]['role'] == 'satellite']) + len([b for b in pend_buy if b[2] == 'satellite']) < num_sats:
                                if s not in pos:
                                    pend_buy.append((s, sat_w, 'satellite'))

    return eq

print("[*] 正在驗證原版 Option A 旗艦版 (2005~2026)...")
eq_orig = run_option_a_sim(enable_sector_filter=False)

print("[*] 正在驗證【族群共振 + Option A 旗艦版】(2005~2026)...")
eq_synergy = run_option_a_sim(enable_sector_filter=True)

def calc_kpis(eq):
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

tot_0, tm_0, cagr_0, mdd_0, sh_0, end_0 = calc_kpis(eq_orig)
tot_1, tm_1, cagr_1, mdd_1, sh_1, end_1 = calc_kpis(eq_synergy)

print("\n" + "="*85)
print("👑 泰坦 Option A 旗艦框架下的【真實 20 年 260 倍級別】對比")
print("="*85)
print(f"{'指標':<22} | {'原版 Option A 旗艦':<25} | {'族群共振升級版':<25}")
print("-"*85)
print(f"{'累積總倍數':<22} | {tm_0:.1f} 倍 ( +{tot_0:,.1f}% ) | {tm_1:.1f} 倍 ( +{tot_1:,.1f}% )")
print(f"{'年化複合增長 (CAGR)':<22} | {cagr_0:.2f}% | {cagr_1:.2f}%")
print(f"{'歷史最大回撤 (MDD)':<22} | {mdd_0:.2f}% | {mdd_1:.2f}%")
print(f"{'夏普比率 (Sharpe)':<22} | {sh_0:.2f} | {sh_1:.2f}")
print(f"{'期末資產 (100萬起步)':<22} | {end_0:,.0f} 元 | {end_1:,.0f} 元")
print("="*85)
