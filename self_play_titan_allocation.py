import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
conn = sqlite3.connect(DB_PATH)

df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_macro = pd.read_sql_query('SELECT date, sox FROM macro_indicators WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60, min_periods=20).mean()
df_macro_overlay['sox'] = df_macro['sox'].ffill()
df_macro_overlay['sox_ma60'] = df_macro_overlay['sox'].rolling(60, min_periods=20).mean()
df_macro_overlay['macro_bull'] = (df_macro_overlay['close'] >= df_macro_overlay['taiex_ma60']) | (df_macro_overlay['sox'] >= df_macro_overlay['sox_ma60'])

years = [str(y) for y in range(2015, 2027)]
top_stocks = set()
for yr in years:
    df_yr = pd.read_sql_query(f'SELECT stock_id FROM daily_stock WHERE date >= "{yr}0101" AND date <= "{yr}1231" AND LENGTH(stock_id) = 4 AND stock_id GLOB "[0-9][0-9][0-9][0-9]" GROUP BY stock_id ORDER BY SUM(trade_value) DESC LIMIT 50', conn)
    top_stocks.update(df_yr['stock_id'].tolist())

sids = list(top_stocks)
placeholders = ','.join(['?']*len(sids))

df_px = pd.read_sql_query(f'''
    SELECT date, stock_id, closing_price, trade_value, pe_ratio
    FROM daily_stock
    WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
''', conn, params=sids)

df_inst = pd.read_sql_query(f'''
    SELECT date, stock_id, foreign_net, trust_net
    FROM institutional_trades
    WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
''', conn, params=sids)
conn.close()

price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)
pe_pivot = df_px.pivot(index='date', columns='stock_id', values='pe_ratio').sort_index().ffill()

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index()

all_dates = [d for d in price_pivot.index if d >= '20160104']
ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
ret_120 = price_pivot.pct_change(120, fill_method=None)
ret_250 = price_pivot.pct_change(250, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)
rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()

# Volatility for volatility-weighting experiment
vol_20 = price_pivot.pct_change(fill_method=None).rolling(20).std()

print("Data successfully loaded. Running adversarial self-play on allocation structures...")

def simulate_structure(alloc_mode='titan_50_25_25'):
    portfolio_equity = 1000000.0
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585
    curve = []
    
    for i, dt in enumerate(all_dates):
        if pending_weights is not None:
            turnover = 0.0
            all_s = set(list(active_weights.keys()) + list(pending_weights.keys()))
            for s in all_s:
                turnover += abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0))
            turnover /= 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            active_weights = pending_weights
            pending_weights = None
            
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = 0.0
            for s, w in active_weights.items():
                p_now = price_pivot.loc[dt, s]
                p_prev = price_pivot.loc[prev_dt, s]
                if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                    daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)
            
        # Stop loss check: 個股跌破 60MA 季線退回現金
        if active_weights:
            temp_active = {}
            for s, w in active_weights.items():
                p = price_pivot.loc[dt, s]
                ma = ma60_pivot.loc[dt, s]
                if not pd.isna(p) and not pd.isna(ma) and p < ma:
                    pass
                else:
                    temp_active[s] = w
            active_weights = temp_active
            
        if i % 20 == 0:
            is_macro_bull = df_macro_overlay.loc[dt, 'macro_bull'] if dt in df_macro_overlay.index else True
            if not is_macro_bull:
                next_targets = {}
            else:
                valid_turnover = rolling_turnover_60.loc[dt].dropna()
                liquid_pool = valid_turnover.nlargest(50).index
                scores = {}
                for sid in liquid_pool:
                    r120 = ret_120.loc[dt, sid]
                    r250 = ret_250.loc[dt, sid]
                    t120 = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                    p = price_pivot.loc[dt, sid]
                    ma = ma60_pivot.loc[dt, sid]
                    if pd.isna(r120) or pd.isna(r250) or pd.isna(p) or pd.isna(ma) or p < ma:
                        continue
                    rs_score = (r120 - t120) * 0.7 + r250 * 0.3
                    inst_val = rolling_inst_60.loc[dt, sid] if (sid in rolling_inst_60.columns and not pd.isna(rolling_inst_60.loc[dt, sid])) else 0
                    pe = pe_pivot.loc[dt, sid] if (sid in pe_pivot.columns and not pd.isna(pe_pivot.loc[dt, sid])) else 20
                    pe_score = (1.0 / pe) if (0 < pe <= 65) else (-0.05)
                    turnover = valid_turnover[sid]
                    scores[sid] = {'rs': rs_score, 'inst': inst_val, 'pe': pe_score, 'turnover': turnover}
                if scores:
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    sdf['norm_inst'] = sdf['inst'].rank(pct=True)
                    sdf['norm_pe'] = sdf['pe'].rank(pct=True)
                    sdf['norm_size'] = sdf['turnover'].rank(pct=True)
                    sdf['titan_score'] = 0.40 * sdf['norm_rs'] + 0.25 * sdf['norm_inst'] + 0.20 * sdf['norm_pe'] + 0.15 * sdf['norm_size']
                    
                    if alloc_mode == 'titan_100': # 1 檔單押 100%
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        next_targets = {sovereign: 1.0}
                    elif alloc_mode == 'titan_70_15_15': # 1 泰坦(70%) + 2 衛星(各15%)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(2, 'titan_score').index.tolist()
                        next_targets = {sovereign: 0.70}
                        for s in sats: next_targets[s] = 0.15
                    elif alloc_mode == 'titan_60_20_20': # 1 泰坦(60%) + 2 衛星(各20%)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(2, 'titan_score').index.tolist()
                        next_targets = {sovereign: 0.60}
                        for s in sats: next_targets[s] = 0.20
                    elif alloc_mode == 'titan_50_25_25': # 現行: 1 泰坦(50%) + 2 衛星(各25%)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(2, 'titan_score').index.tolist()
                        next_targets = {sovereign: 0.50}
                        for s in sats: next_targets[s] = 0.25
                    elif alloc_mode == 'titan_40_30_30': # 1 泰坦(40%) + 2 衛星(各30%)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(2, 'titan_score').index.tolist()
                        next_targets = {sovereign: 0.40}
                        for s in sats: next_targets[s] = 0.30
                    elif alloc_mode == 'titan_40_20_20_20': # 1 泰坦(40%) + 3 衛星(各20%)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(3, 'titan_score').index.tolist()
                        next_targets = {sovereign: 0.40}
                        for s in sats: next_targets[s] = 0.20
                    elif alloc_mode == 'equal_3': # 等權 3 檔 (各 33.3%)
                        top3 = sdf.nlargest(3, 'titan_score').index.tolist()
                        next_targets = {s: 1.0/len(top3) for s in top3}
                    elif alloc_mode == 'equal_5': # 等權 5 檔 (各 20%)
                        top5 = sdf.nlargest(5, 'titan_score').index.tolist()
                        next_targets = {s: 1.0/len(top5) for s in top5}
                    elif alloc_mode == 'equal_10': # 等權 10 檔 (各 10%)
                        top10 = sdf.nlargest(10, 'titan_score').index.tolist()
                        next_targets = {s: 1.0/len(top10) for s in top10}
                    elif alloc_mode == 'vol_parity_titan_sat': # 波動度倒數配權 (Inv-Vol)
                        top5_scale = sdf.nlargest(5, 'turnover')
                        sovereign = top5_scale['titan_score'].idxmax()
                        rem = sdf.drop(index=[sovereign])
                        sats = rem.nlargest(2, 'titan_score').index.tolist()
                        candidates = [sovereign] + sats
                        inv_vols = {}
                        for c in candidates:
                            v = vol_20.loc[dt, c] if (c in vol_20.columns and not pd.isna(vol_20.loc[dt, c]) and vol_20.loc[dt, c] > 0) else 0.02
                            inv_vols[c] = 1.0 / v
                        tot_inv = sum(inv_vols.values())
                        next_targets = {c: inv_vols[c] / tot_inv for c in candidates}
                else:
                    next_targets = {}
            pending_weights = next_targets
        curve.append(portfolio_equity)
        
    s = pd.Series(curve)
    tot_ret = (s.iloc[-1] / s.iloc[0] - 1) * 100
    peak = s.cummax()
    mdd = ((s - peak) / peak * 100).min()
    rets = s.pct_change().dropna()
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (244.0 / len(s)) - 1) * 100
    sharpe = (rets.mean() * 244) / (rets.std() * np.sqrt(244)) if rets.std() > 0 else 0
    calmar = cagr / abs(mdd) if mdd != 0 else 0
    
    # 算近 1 年報酬率 (20251002 ~ 20261002)
    idx_1y = all_dates.index('20251002') if '20251002' in all_dates else -244
    ret_1y = (s.iloc[-1] / s.iloc[idx_1y] - 1) * 100
    
    return {
        'mode': alloc_mode,
        'final_equity': s.iloc[-1],
        'total_ret': tot_ret,
        'ret_1y': ret_1y,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'calmar': calmar
    }

modes = [
    'titan_100',
    'titan_70_15_15',
    'titan_60_20_20',
    'titan_50_25_25',
    'titan_40_30_30',
    'titan_40_20_20_20',
    'vol_parity_titan_sat',
    'equal_3',
    'equal_5',
    'equal_10'
]

results = []
for m in modes:
    res = simulate_structure(m)
    results.append(res)

print("\n" + "="*95)
print(f"{'配置架構 (Allocation Structure)':<22} | {'10年總報酬':<10} | {'近1年報酬':<9} | {'CAGR':<7} | {'最大回撤':<8} | {'夏普':<6} | {'卡瑪比':<6} | {'終端金額(NT$)'}")
print("="*95)
for r in sorted(results, key=lambda x: x['sharpe'], reverse=True):
    print(f"{r['mode']:<22} | {r['total_ret']:+9.1f}% | {r['ret_1y']:+8.1f}% | {r['cagr']:6.1f}% | {r['mdd']:7.2f}% | {r['sharpe']:5.2f} | {r['calmar']:5.2f} | NT$ {r['final_equity']:,.0f}")
print("="*95)
