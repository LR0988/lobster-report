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
    SELECT date, stock_id, stock_name, closing_price, trade_value, pe_ratio
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
name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()

all_dates = [d for d in price_pivot.index if d >= '20160104']

ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
ret_120 = price_pivot.pct_change(120, fill_method=None)
ret_250 = price_pivot.pct_change(250, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)
rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()

rebalance_freq = 20
active_weights = {}
pending_weights = None
position_entries = {}

for i, dt in enumerate(all_dates):
    if pending_weights is not None:
        for sid, w in pending_weights.items():
            if sid not in active_weights:
                position_entries[sid] = {
                    'entry_date': dt,
                    'entry_price': price_pivot.loc[dt, sid],
                    'role': '👑 王者泰坦 (40%)' if w >= 0.35 else '🚀 革命衛星 (30%)',
                    'target_weight': w
                }
        active_weights = pending_weights
        pending_weights = None
        
    if active_weights:
        temp_active = {}
        for sid, w in active_weights.items():
            p = price_pivot.loc[dt, sid]
            ma = ma60_pivot.loc[dt, sid]
            if not pd.isna(p) and not pd.isna(ma) and p < ma:
                if sid in position_entries:
                    del position_entries[sid]
            else:
                temp_active[sid] = w
        active_weights = temp_active
        
    if i % rebalance_freq == 0:
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
                top5_scale = sdf.nlargest(5, 'turnover')
                sovereign_leader = top5_scale['titan_score'].idxmax()
                remaining = sdf.drop(index=[sovereign_leader])
                satellites = remaining.nlargest(2, 'titan_score').index.tolist()
                next_targets = {sovereign_leader: 0.40}
                for sat in satellites:
                    next_targets[sat] = 0.30
            else:
                next_targets = {}
        pending_weights = next_targets

last_dt = all_dates[-1]
print(f"=== 最新結算日期: {last_dt} ===")
print(f"當前持有中部位: {active_weights}")
total_exp = sum(active_weights.values())
cash_reserve = 1.0 - total_exp
print(f"總持股曝險: {total_exp*100:.1f}%, 現金防禦儲備: {cash_reserve*100:.1f}%\n")

open_positions = []
for sid, w in active_weights.items():
    entry_info = position_entries.get(sid, {})
    e_date = entry_info.get('entry_date', '--')
    e_price = entry_info.get('entry_price', price_pivot.loc[last_dt, sid])
    curr_price = price_pivot.loc[last_dt, sid]
    ma60 = ma60_pivot.loc[last_dt, sid]
    unrealized_ret = (curr_price / e_price - 1.0) * 100 if e_price > 0 else 0
    dist_to_ma60 = (curr_price / ma60 - 1.0) * 100 if ma60 > 0 else 0
    role = entry_info.get('role', '👑 王者泰坦 (40%)' if w >= 0.35 else '🚀 革命衛星 (30%)')
    s_name = name_map.get(sid, sid)
    
    h_days = 0
    if e_date != '--' and e_date in all_dates:
        h_days = all_dates.index(last_dt) - all_dates.index(e_date)
        
    pos = {
        'stock_id': sid,
        'stock_name': s_name,
        'role': role,
        'target_weight_pct': int(w * 100),
        'entry_date': e_date,
        'entry_price': round(float(e_price), 2),
        'current_price': round(float(curr_price), 2),
        'unrealized_return_pct': round(float(unrealized_ret), 2),
        'holding_days': h_days,
        'ma60_stop_price': round(float(ma60), 2),
        'dist_to_stop_pct': round(float(dist_to_ma60), 2),
        'stop_condition': f"收盤跌破季線 60MA (NT$ {ma60:.1f}) 則次日全數停損退回現金"
    }
    open_positions.append(pos)
    print(pos)

import json
with open('titan_open_positions.json', 'w', encoding='utf-8') as f:
    json.dump({
        'as_of_date': last_dt,
        'total_exposure_pct': round(total_exp * 100, 1),
        'cash_reserve_pct': round(cash_reserve * 100, 1),
        'open_positions': open_positions
    }, f, ensure_ascii=False, indent=2)
print("\n[✓] 成功寫入 titan_open_positions.json！")
