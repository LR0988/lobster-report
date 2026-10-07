import sqlite3
import pandas as pd
import numpy as np
import time

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在載入歷史資料...")
conn = sqlite3.connect(DB_PATH)
df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')

df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()

years = [str(y) for y in range(2015, 2027)]
top_stocks = set()
for yr in years:
    df_yr = pd.read_sql_query(f'''
        SELECT stock_id
        FROM daily_stock
        WHERE date >= "{yr}0101" AND date <= "{yr}1231"
          AND LENGTH(stock_id) = 4 AND stock_id GLOB '[0-9][0-9][0-9][0-9]'
        GROUP BY stock_id
        ORDER BY SUM(trade_value) DESC
        LIMIT 60
    ''', conn)
    top_stocks.update(df_yr['stock_id'].tolist())

sids = list(top_stocks)
placeholders = ','.join(['?']*len(sids))

df_px = pd.read_sql_query(f'''
    SELECT date, stock_id, opening_price, highest_price, lowest_price, closing_price, trade_value
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
price_open = df_px.pivot(index='date', columns='stock_id', values='opening_price').sort_index().ffill().combine_first(price_pivot)
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)

all_dates = [d for d in price_pivot.index if d >= '20160104']

ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)
ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
high60_pivot = price_pivot.rolling(60, min_periods=20).max()

ret_20 = price_pivot.pct_change(20, fill_method=None)
ret_60 = price_pivot.pct_change(60, fill_method=None)
ret_120 = price_pivot.pct_change(120, fill_method=None)

taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()
breadth_ma20 = (price_pivot >= ma20_pivot).astype(int).mean(axis=1)

print("[*] 正在預計算每日候選股清單...")
t0 = time.time()
daily_candidates = {}
min_s20_slope = 0.025

for dt in all_dates:
    is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
    if not is_macro_bull:
        daily_candidates[dt] = None
        continue

    valid_turnover = rolling_turnover_60.loc[dt].dropna()
    liquid_pool = valid_turnover.nlargest(50).index
    scores = {}
    for sid in liquid_pool:
        p = price_pivot.loc[dt, sid]
        m60 = ma60_pivot.loc[dt, sid]
        m20 = ma20_pivot.loc[dt, sid]
        r20 = ret_20.loc[dt, sid]
        r60 = ret_60.loc[dt, sid]
        r120 = ret_120.loc[dt, sid]
        h60 = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p
        if pd.isna(p) or pd.isna(m60) or pd.isna(r120) or p < m60 * 1.025:
            continue
        if pd.isna(m20) or p < m20 or m20 < m60:
            continue
        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
            continue
        s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
        if pd.isna(s20) or s20 < min_s20_slope:
            continue
        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88:
            continue

        t120 = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
        t60 = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
        t20 = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0
        rs = (r20 - t20)*0.30 + (r60 - t60)*0.40 + (r120 - t120)*0.30
        h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
        inst_v = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and dt in rolling_inst_20.index) else 0
        scores[sid] = {'rs': rs, 'inst': inst_v, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

    if len(scores) >= 1:
        sdf = pd.DataFrame(scores).T
        sdf['norm_rs'] = sdf['rs'].rank(pct=True)
        sdf['norm_inst'] = sdf['inst'].rank(pct=True)
        sdf['norm_prox'] = sdf['h_prox'].rank(pct=True)
        sdf['norm_size'] = sdf['turnover'].rank(pct=True)
        sdf['titan_score'] = 0.50 * sdf['norm_rs'] + 0.25 * sdf['norm_inst'] + 0.15 * sdf['norm_prox'] + 0.10 * sdf['norm_size']
        
        top_leaders = sdf.nlargest(min(5, len(sdf)), 'turnover')
        leader = top_leaders['titan_score'].idxmax()
        remaining = sdf.drop(index=[leader])
        sat_ranked = remaining.sort_values('titan_score', ascending=False).index.tolist()
        daily_candidates[dt] = {
            'leader': leader,
            'satellites': sat_ranked,
            'breadth': breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5,
            'valid_sids': set(scores.keys())
        }
    else:
        daily_candidates[dt] = None

t1 = time.time()
print(f"[✓] 候選股每日特徵預計算完成！耗時: {round(t1 - t0, 2)} 秒")
