import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
    df_macro_overlay = df_taiex.copy()
    df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()

    years = [str(y) for y in range(2015, 2027)]
    top_stocks = set()
    for yr in years:
        df_yr = pd.read_sql_query(f'''
            SELECT stock_id FROM daily_stock
            WHERE date >= "{yr}0101" AND date <= "{yr}1231"
              AND LENGTH(stock_id) = 4 AND stock_id GLOB "[0-9][0-9][0-9][0-9]"
            GROUP BY stock_id ORDER BY SUM(trade_value) DESC LIMIT 60
        ''', conn)
        top_stocks.update(df_yr['stock_id'].tolist())

    sids = list(top_stocks)
    placeholders = ','.join(['?']*len(sids))
    df_px = pd.read_sql_query(f'SELECT date, stock_id, stock_name, closing_price, trade_value FROM daily_stock WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"', conn, params=sids)
    df_inst = pd.read_sql_query(f'SELECT date, stock_id, foreign_net, trust_net FROM institutional_trades WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"', conn, params=sids)
    conn.close()

    price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
    value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)
    df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
    inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index()

    all_dates = [d for d in price_pivot.index if d >= '20160104']
    ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    high60_pivot = price_pivot.rolling(60, min_periods=20).max()
    ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
    ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)

    ret_20 = price_pivot.pct_change(20, fill_method=None)
    ret_60 = price_pivot.pct_change(60, fill_method=None)
    ret_120 = price_pivot.pct_change(120, fill_method=None)

    taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
    taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
    taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

    rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
    rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()

    def simulate(name,
                 num_stocks=3,           # 3 (40/30/30) or 4 (40/20/20/20)
                 leader_w=0.40,
                 rebalance_freq=30,
                 sat_hard_stop=None,     # e.g. 0.18
                 be_thresh=0.0,          # Breakeven trigger profit % (e.g. 0.06 or 0.07)
                 be_target=0.008,        # Breakeven locked exit % (e.g. +0.8%)
                 trail_profit_thresh=0.0,# Trailing profit lock trigger (e.g. 0.35)
                 trail_lock_pct=0.0,     # Trailing profit locked level
                 min_buf=0.025,
                 require_ma20_up=True,
                 require_inst20_pos=False):

        portfolio_equity = 1000000.0
        equity_curve = []
        active_weights = {}
        pending_weights = None
        fee_rate = 0.00585
        all_completed_trades = []
        open_position_tracker = {}
        high_water_marks = {}

        num_satellites = num_stocks - 1
        sat_w = (1.0 - leader_w) / num_satellites

        for i, dt in enumerate(all_dates):
            # T+1 execution
            if pending_weights is not None:
                for sid in list(active_weights.keys()):
                    if sid not in pending_weights:
                        if sid in open_position_tracker:
                            pos = open_position_tracker[sid]
                            ret_pct = (price_pivot.loc[dt, sid] / pos['entry_price'] - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret_pct, 'entry_date': pos['entry_date'], 'exit_date': dt, 'exit_reason': 'rebalance'})
                            del open_position_tracker[sid]
                        if sid in high_water_marks:
                            del high_water_marks[sid]
                for sid, w_new in pending_weights.items():
                    if sid not in active_weights:
                        open_position_tracker[sid] = {
                            'entry_price': price_pivot.loc[dt, sid],
                            'entry_date': dt,
                            'role': 'leader' if w_new >= 0.35 else 'sat'
                        }
                        high_water_marks[sid] = price_pivot.loc[dt, sid]
                turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
                portfolio_equity -= portfolio_equity * turnover * fee_rate
                active_weights = {s: w for s, w in pending_weights.items() if s in price_pivot.columns}
                pending_weights = None

            # Daily return
            if i > 0:
                prev_dt = all_dates[i-1]
                daily_ret = sum(w * ((price_pivot.loc[dt, sid] / price_pivot.loc[prev_dt, sid]) - 1.0) for sid, w in active_weights.items() if sid in price_pivot.columns)
                portfolio_equity *= (1.0 + daily_ret)

            # Intraday / protective exits
            if active_weights:
                temp_active = {}
                for sid, w in active_weights.items():
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]

                    if sid in high_water_marks:
                        high_water_marks[sid] = max(high_water_marks[sid], p) if not pd.isna(p) else high_water_marks[sid]
                    hwm = high_water_marks.get(sid, p)

                    should_exit = False
                    reason = ''

                    # 1. 60MA breakdown
                    if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                        should_exit = True
                        reason = '60ma_break'

                    if not should_exit and sid in open_position_tracker:
                        ep = open_position_tracker[sid]['entry_price']
                        role = open_position_tracker[sid]['role']
                        if not pd.isna(p) and not pd.isna(ep) and ep > 0:
                            # 2. Hard disaster stop on satellites
                            if sat_hard_stop is not None and role == 'sat':
                                if (p / ep - 1.0) < -sat_hard_stop:
                                    should_exit = True
                                    reason = 'hard_stop'

                            # 3. Breakeven lock (López de Prado Meta-Barrier)
                            if not should_exit and be_thresh > 0:
                                max_gain = (hwm / ep - 1.0)
                                if max_gain >= be_thresh:
                                    be_px = ep * (1.0 + be_target)
                                    if p <= be_px:
                                        should_exit = True
                                        reason = 'be_lock'

                            # 4. Trailing profit ladder
                            if not should_exit and trail_profit_thresh > 0:
                                max_gain = (hwm / ep - 1.0)
                                if max_gain >= trail_profit_thresh:
                                    trail_px = ep * (1.0 + trail_lock_pct)
                                    if p <= trail_px:
                                        should_exit = True
                                        reason = 'trail_lock'

                    if should_exit:
                        if sid in open_position_tracker:
                            ret_pct = (p / open_position_tracker[sid]['entry_price'] - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret_pct, 'entry_date': open_position_tracker[sid]['entry_date'], 'exit_date': dt, 'exit_reason': reason})
                            del open_position_tracker[sid]
                        if sid in high_water_marks:
                            del high_water_marks[sid]
                    else:
                        temp_active[sid] = w
                active_weights = temp_active

            # Periodic rebalance
            if i % rebalance_freq == 0:
                is_taiex_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
                if not is_taiex_bull:
                    next_targets = {}
                else:
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

                        if pd.isna(p) or pd.isna(m60) or pd.isna(r120) or p < m60 * (1.0 + min_buf):
                            continue
                        if pd.isna(m20) or p < m20 or m20 < m60:
                            continue
                        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
                            continue
                        if require_ma20_up:
                            s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                            if pd.isna(s20) or s20 < 0:
                                continue
                        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88:
                            continue

                        inst20 = rolling_inst_20.loc[dt, sid] if sid in rolling_inst_20.columns else 0
                        if require_inst20_pos and inst20 <= 0:
                            continue

                        t120_val = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                        t60_val = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                        t20_val = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                        # Multi-scale relative strength (Jegadeesh & Titman + Carhart)
                        rs = (r20 - t20_val)*0.30 + (r60 - t60_val)*0.40 + (r120 - t120_val)*0.30
                        h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
                        scores[sid] = {'rs': rs, 'inst': inst20, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

                    if len(scores) >= num_stocks:
                        sdf = pd.DataFrame(scores).T
                        sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                        sdf['norm_inst'] = sdf['inst'].rank(pct=True)
                        sdf['norm_prox'] = sdf['h_prox'].rank(pct=True)
                        sdf['norm_size'] = sdf['turnover'].rank(pct=True)
                        sdf['titan_score'] = 0.50 * sdf['norm_rs'] + 0.25 * sdf['norm_inst'] + 0.15 * sdf['norm_prox'] + 0.10 * sdf['norm_size']
                        
                        top_leaders = sdf.nlargest(min(5, len(sdf)), 'turnover')
                        leader = top_leaders['titan_score'].idxmax()
                        remaining = sdf.drop(index=[leader])
                        satellites = remaining.nlargest(num_satellites, 'titan_score').index.tolist()

                        next_targets = {leader: leader_w}
                        for s in satellites:
                            next_targets[s] = sat_w
                    else:
                        next_targets = {}
                pending_weights = next_targets

            equity_curve.append({'date': dt, 'equity': portfolio_equity})

        df_res = pd.DataFrame(equity_curve).set_index('date')
        df_2024 = df_res[df_res.index.str.startswith('2024')]
        ret_2024 = (df_2024.iloc[-1]['equity'] / df_2024.iloc[0]['equity'] - 1) * 100
        ret_10y = (df_res.iloc[-1]['equity'] / df_res.iloc[0]['equity'] - 1) * 100
        peak = df_res['equity'].cummax()
        mdd = ((df_res['equity'] - peak) / peak).min() * 100
        wins = [t for t in all_completed_trades if t['return_pct'] > 0]
        wr = len(wins) / len(all_completed_trades) * 100 if all_completed_trades else 0
        df_res['year'] = df_res.index.str.slice(0, 4)
        yearly = {y: round(float((g.iloc[-1]['equity'] / g.iloc[0]['equity'] - 1) * 100), 1) for y, g in df_res.groupby('year')}
        print(f"{name:58s} | 10Y: {ret_10y:+10,.1f}% | WR: {wr:4.1f}% | 2024: {ret_2024:+6.2f}% | MDD: {mdd:5.1f}% | Trades: {len(all_completed_trades)}")
        return {'ret_10y': ret_10y, 'wr': wr, 'ret_2024': ret_2024, 'mdd': mdd, 'yearly': yearly, 'trades': all_completed_trades}

    print('='*115)
    print(f"{'策略名稱':58s} | {'10年累積':>12s} | {'總勝率':>7s} | {'2024':>8s} | {'MDD':>7s} | {'總筆數'}")
    print('='*115)

    # 1. Baseline Route 2 (3-stock 40/30/30)
    simulate('Route 2 Base (40/30/30, no stops)', num_stocks=3, leader_w=0.40, sat_hard_stop=None, be_thresh=0.0)

    # 2. Test Breakeven thresholds on 40/30/30
    for be_t in [0.05, 0.06, 0.07, 0.08, 0.09, 0.10]:
        simulate(f'Route 2 (40/30/30) + BE Lock at +{int(be_t*100)}%', num_stocks=3, leader_w=0.40, sat_hard_stop=None, be_thresh=be_t, be_target=0.008)

    # 3. Test Breakeven thresholds on 4-Stock (40/20/20/20)
    simulate('Route 2 (4-Stock 40/20/20/20, no stops)', num_stocks=4, leader_w=0.40, sat_hard_stop=None, be_thresh=0.0)
    for be_t in [0.05, 0.06, 0.07, 0.08, 0.09, 0.10]:
        simulate(f'4-Stock (40/20/20/20) + BE Lock at +{int(be_t*100)}%', num_stocks=4, leader_w=0.40, sat_hard_stop=None, be_thresh=be_t, be_target=0.008)

    # 4. Breakeven Lock + Satellite Disaster Stop (18%)
    for be_t in [0.06, 0.07, 0.08]:
        simulate(f'4-Stock + BE +{int(be_t*100)}% + Sat Stop 18%', num_stocks=4, leader_w=0.40, sat_hard_stop=0.18, be_thresh=be_t, be_target=0.008)
        simulate(f'3-Stock + BE +{int(be_t*100)}% + Sat Stop 18%', num_stocks=3, leader_w=0.40, sat_hard_stop=0.18, be_thresh=be_t, be_target=0.008)

if __name__ == '__main__':
    run()
