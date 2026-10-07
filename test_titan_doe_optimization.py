import sqlite3
import pandas as pd
import numpy as np
import itertools
import time

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在載入歷史資料與特徵庫...")
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
price_high = df_px.pivot(index='date', columns='stock_id', values='highest_price').sort_index().ffill().combine_first(price_pivot)
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

print("[✓] 資料庫與特徵快取完成，開始建構回測引擎...")

def simulate_strategy(rebalance_freq=30, leader_w=0.60, num_sats=2, min_breadth=0.40, sat_hard_stop=0.18, profit_lock_thresh=None, profit_lock_pullback=0.10, buy_mode='open'):
    sat_w = (1.0 - leader_w) / num_sats if num_sats > 0 else 0.0
    min_s20_slope = 0.025
    fee_rate = 0.00585

    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    open_position_tracker = {}
    just_entered_sids = set()

    for i, dt in enumerate(all_dates):
        just_entered_sids.clear()
        exited_returns = 0.0

        # 1. 處理待生效調倉 (T+1 開盤買賣)
        if pending_weights is not None:
            prev_dt = all_dates[i-1] if i > 0 else dt
            # 結算平倉
            for sid, w_old in list(active_weights.items()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        exit_px = price_open.loc[dt, sid] if buy_mode == 'open' else price_pivot.loc[dt, sid]
                        p_prev = price_pivot.loc[prev_dt, sid]
                        if not pd.isna(p_prev) and p_prev > 0 and not pd.isna(exit_px):
                            exited_returns += w_old * ((exit_px / p_prev) - 1.0)
                        del open_position_tracker[sid]

            # 買進新標的
            for sid, w_new in pending_weights.items():
                exec_buy_px = price_open.loc[dt, sid] if buy_mode == 'open' else price_pivot.loc[dt, sid]
                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': exec_buy_px,
                        'peak_price': exec_buy_px,
                        'role': 'leader' if w_new >= 0.50 else 'sat',
                        'target_weight': w_new
                    }
                    just_entered_sids.add(sid)
                elif sid in open_position_tracker:
                    open_position_tracker[sid]['target_weight'] = w_new

            turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            active_weights = pending_weights
            pending_weights = None

        # 2. 結算日報酬
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = exited_returns
            for sid, w in active_weights.items():
                p_now = price_pivot.loc[dt, sid]
                if sid in just_entered_sids and buy_mode == 'open':
                    buy_px = open_position_tracker[sid]['entry_price']
                    if buy_px > 0 and not pd.isna(p_now):
                        daily_ret += w * ((p_now / buy_px) - 1.0)
                else:
                    p_prev = price_pivot.loc[prev_dt, sid]
                    if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                        daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        # 3. 盤中防守與獲利鎖定 (Trailing Profit Lock & Stop Loss)
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_pivot.loc[dt, sid]
                ma60 = ma60_pivot.loc[dt, sid]
                pos = open_position_tracker.get(sid, {})
                ep = pos.get('entry_price', p)
                peak_p = max(pos.get('peak_price', p), p)
                pos['peak_price'] = peak_p
                is_leader = (w >= 0.50)

                should_stop = False

                # A. 季線防守
                if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                    should_stop = True
                # B. 衛星災難停損
                elif not is_leader and sat_hard_stop is not None and ep > 0:
                    if (p / ep - 1.0) < -sat_hard_stop:
                        should_stop = True
                # C. 獲利回檔鎖利機制 (DOE 測試的新功能)
                elif profit_lock_thresh is not None and ep > 0:
                    current_gain = (peak_p / ep) - 1.0
                    # 若波段獲利曾超過門檻 (e.g. +25%)，且自最高點回撤超過門檻 (e.g. -10%) 則獲利鎖定出場
                    if current_gain >= profit_lock_thresh:
                        pullback = (p / peak_p) - 1.0
                        if pullback <= -profit_lock_pullback:
                            should_stop = True

                if should_stop:
                    if sid in open_position_tracker:
                        del open_position_tracker[sid]
                else:
                    temp_active[sid] = w
            
            if len(temp_active) < len(active_weights):
                reduced = sum(active_weights[s] for s in active_weights if s not in temp_active)
                portfolio_equity -= portfolio_equity * reduced * fee_rate
            active_weights = temp_active

        # 4. 定期調倉選股
        if i % rebalance_freq == 0:
            is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
            if not is_macro_bull:
                next_targets = {}
            else:
                curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
                allow_sats = (curr_breadth >= min_breadth)

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

                    if not allow_sats or num_sats == 0:
                        next_targets = {leader: 1.0}
                    else:
                        if active_weights:
                            current_sats = [s for s in active_weights if s != leader and s in scores and price_pivot.loc[dt, s] >= ma20_pivot.loc[dt, s]]
                            needed = num_sats - len(current_sats)
                            new_candidates = [s for s in remaining.nlargest(num_sats * 2, 'titan_score').index if s not in current_sats]
                            satellites = (current_sats + new_candidates)[:num_sats]
                        else:
                            satellites = remaining.nlargest(num_sats, 'titan_score').index.tolist()
                        
                        next_targets = {leader: leader_w}
                        for sat in satellites:
                            next_targets[sat] = sat_w
                else:
                    next_targets = {}
            pending_weights = next_targets

        equity_curve.append({
            'date': dt,
            'year': int(dt[:4]),
            'titan_equity': portfolio_equity
        })

    df_curve = pd.DataFrame(equity_curve)
    final_eq = df_curve['titan_equity'].iloc[-1]
    total_ret = ((final_eq - 1000000.0) / 1000000.0) * 100.0
    cagr = ((final_eq / 1000000.0) ** (1.0 / 10.75) - 1.0) * 100.0

    peak = df_curve['titan_equity'].cummax()
    df_curve['drawdown_pct'] = ((df_curve['titan_equity'] - peak) / peak) * 100.0
    mdd = df_curve['drawdown_pct'].min()

    df_2024 = df_curve[df_curve['year'] == 2024]
    ret_2024 = ((df_2024.iloc[-1]['titan_equity'] - df_2024.iloc[0]['titan_equity']) / df_2024.iloc[0]['titan_equity'] * 100.0) if len(df_2024) > 1 else 0.0

    # 計算 Calmar Ratio (CAGR / |MDD|)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0.0

    return {
        'total_ret': total_ret,
        'multiple': final_eq / 1000000.0,
        'cagr': cagr,
        'mdd': mdd,
        'ret_2024': ret_2024,
        'calmar': calmar
    }

print("[✓] 引擎完成！開始設計 DOE (Design of Experiments) 參數矩陣...")
