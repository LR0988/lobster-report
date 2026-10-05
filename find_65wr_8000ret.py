import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
    df_macro_overlay = df_taiex.copy()
    df_macro_overlay['taiex_ma20'] = df_macro_overlay['close'].rolling(20).mean()
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
    inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).fillna(0)

    all_dates = [d for d in price_pivot.index if d >= '20160104']
    ma10_pivot = price_pivot.rolling(10, min_periods=5).mean()
    ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    high60_pivot = price_pivot.rolling(60, min_periods=20).max()
    low20_pivot = price_pivot.rolling(20, min_periods=10).min()
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

    def simulate_grid(params):
        num_stocks = params.get('num_stocks', 3)
        leader_w = params.get('leader_w', 0.40)
        rebalance_freq = params.get('rebalance_freq', 30)
        sat_hard_stop = params.get('sat_hard_stop', None)
        keep_winner = params.get('keep_winner', False)      # If stock is still strong (above 20MA), don't churn on rebalance
        require_inst20 = params.get('require_inst20', False)
        max_bias60 = params.get('max_bias60', None)         # e.g. 1.25 (don't buy if >25% above 60MA)
        min_prox = params.get('min_prox', 0.88)             # p / high60
        trailing_mode = params.get('trailing_mode', None)   # e.g. 'gain25_ma20' (if gained >25%, exit on ma20 break)
        be_thresh = params.get('be_thresh', 0.0)            # if gained > be_thresh, lock be_target
        be_target = params.get('be_target', 0.008)
        macro_filter = params.get('macro_filter', 'taiex_ma60') # 'taiex_ma60' or 'taiex_bull_blend'

        portfolio_equity = 1000000.0
        equity_curve = []
        active_weights = {}
        pending_weights = None
        fee_rate = 0.00585
        all_completed_trades = []
        open_tracker = {}
        high_water = {}

        num_sat = num_stocks - 1
        sat_w = (1.0 - leader_w) / num_sat

        for i, dt in enumerate(all_dates):
            # T+1 execution
            if pending_weights is not None:
                for sid in list(active_weights.keys()):
                    if sid not in pending_weights:
                        if sid in open_tracker:
                            pos = open_tracker[sid]
                            ep = pos['entry_price']
                            exit_p = price_pivot.loc[dt, sid]
                            ret = (exit_p / ep - 1.0) * 100 if ep > 0 else 0
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret, 'entry_date': pos['entry_date'], 'exit_date': dt, 'reason': 'rebalance'})
                            del open_tracker[sid]
                        if sid in high_water:
                            del high_water[sid]

                for sid, w_new in pending_weights.items():
                    if sid not in active_weights:
                        p_now = price_pivot.loc[dt, sid]
                        open_tracker[sid] = {
                            'entry_price': p_now,
                            'entry_date': dt,
                            'role': 'leader' if w_new >= 0.35 else 'sat'
                        }
                        high_water[sid] = p_now

                turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
                portfolio_equity -= portfolio_equity * turnover * fee_rate
                active_weights = {s: w for s, w in pending_weights.items() if s in price_pivot.columns}
                pending_weights = None

            # Daily PnL
            if i > 0:
                prev_dt = all_dates[i-1]
                daily_ret = sum(w * ((price_pivot.loc[dt, sid] / price_pivot.loc[prev_dt, sid]) - 1.0) for sid, w in active_weights.items() if sid in price_pivot.columns)
                portfolio_equity *= (1.0 + daily_ret)

            # Intraday defence checks
            if active_weights:
                temp_active = {}
                for sid, w in active_weights.items():
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    ma10 = ma10_pivot.loc[dt, sid]

                    if sid in high_water:
                        high_water[sid] = max(high_water[sid], p) if not pd.isna(p) else high_water[sid]
                    hwm = high_water.get(sid, p)

                    should_exit = False
                    reason = ''

                    # Basic 60MA exit
                    if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                        should_exit = True
                        reason = '60ma_break'

                    if not should_exit and sid in open_tracker:
                        pos = open_tracker[sid]
                        ep = pos['entry_price']
                        role = pos['role']
                        if not pd.isna(p) and not pd.isna(ep) and ep > 0:
                            # Satellite disaster stop
                            if sat_hard_stop is not None and role == 'sat':
                                if (p / ep - 1.0) < -sat_hard_stop:
                                    should_exit = True
                                    reason = 'hard_stop'

                            # Trailing modes
                            if not should_exit and trailing_mode == 'gain20_ma20':
                                if (hwm / ep - 1.0) >= 0.20 and not pd.isna(ma20) and p < ma20:
                                    should_exit = True
                                    reason = 'gain20_ma20'
                            elif not should_exit and trailing_mode == 'gain30_ma20':
                                if (hwm / ep - 1.0) >= 0.30 and not pd.isna(ma20) and p < ma20:
                                    should_exit = True
                                    reason = 'gain30_ma20'
                            elif not should_exit and trailing_mode == 'gain40_ma20':
                                if (hwm / ep - 1.0) >= 0.40 and not pd.isna(ma20) and p < ma20:
                                    should_exit = True
                                    reason = 'gain40_ma20'

                            # Breakeven Lock
                            if not should_exit and be_thresh > 0:
                                if (hwm / ep - 1.0) >= be_thresh:
                                    if p <= ep * (1.0 + be_target):
                                        should_exit = True
                                        reason = 'be_lock'

                    if should_exit:
                        if sid in open_tracker:
                            ret = (p / open_tracker[sid]['entry_price'] - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret, 'entry_date': open_tracker[sid]['entry_date'], 'exit_date': dt, 'reason': reason})
                            del open_tracker[sid]
                        if sid in high_water:
                            del high_water[sid]
                    else:
                        temp_active[sid] = w
                active_weights = temp_active

            # Rebalance
            if i % rebalance_freq == 0:
                is_bull = True
                if macro_filter == 'taiex_ma60':
                    is_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
                elif macro_filter == 'taiex_bull_blend':
                    is_bull = (df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60']) or (df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma20'])

                if not is_bull:
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

                        if pd.isna(p) or pd.isna(m60) or pd.isna(r120) or p < m60 * 1.025:
                            continue
                        if pd.isna(m20) or p < m20 or m20 < m60:
                            continue
                        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
                            continue
                        s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                        if pd.isna(s20) or s20 < 0:
                            continue
                        if not pd.isna(h60) and h60 > 0 and (p / h60) < min_prox:
                            continue
                        if max_bias60 is not None and not pd.isna(m60) and (p / m60) > max_bias60:
                            continue
                        if require_inst20:
                            inst_val = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and dt in rolling_inst_20.index) else 0
                            if inst_val <= 0:
                                continue

                        t120_val = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                        t60_val = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                        t20_val = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                        rs = (r20 - t20_val)*0.30 + (r60 - t60_val)*0.40 + (r120 - t120_val)*0.30
                        h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
                        inst_v = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and dt in rolling_inst_20.index) else 0
                        scores[sid] = {'rs': rs, 'inst': inst_v, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

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
                        
                        # Winner persistence check (keep_winner):
                        if keep_winner and active_weights:
                            # if current active stocks still in scores and above 20MA, keep them
                            current_sats = [s for s in active_weights if s != leader and s in scores and price_pivot.loc[dt, s] >= ma20_pivot.loc[dt, s]]
                            needed = num_sat - len(current_sats)
                            new_candidates = [s for s in remaining.nlargest(num_sat * 2, 'titan_score').index if s not in current_sats]
                            satellites = (current_sats + new_candidates)[:num_sat]
                        else:
                            satellites = remaining.nlargest(num_sat, 'titan_score').index.tolist()

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
        return {'ret_10y': ret_10y, 'wr': wr, 'ret_2024': ret_2024, 'mdd': mdd, 'trades': len(all_completed_trades), 'yearly': yearly}

    print('=== Testing Multi-Dimensional Hypotheses ===')
    tests = [
        ('1. Baseline Route 2 (3-Stock 40/30/30)', {}),
        ('2. Baseline 4-Stock (40/20/20/20)', {'num_stocks': 4}),
        ('3. 4-Stock + Winner Persistence (Keep Winner)', {'num_stocks': 4, 'keep_winner': True}),
        ('4. 3-Stock + Winner Persistence (Keep Winner)', {'num_stocks': 3, 'keep_winner': True}),
        ('5. 4-Stock + Max Bias 1.25 (Avoid Overextended)', {'num_stocks': 4, 'max_bias60': 1.25}),
        ('6. 4-Stock + Max Bias 1.20', {'num_stocks': 4, 'max_bias60': 1.20}),
        ('7. 4-Stock + Min Prox 0.92 (High Tight Flag)', {'num_stocks': 4, 'min_prox': 0.92}),
        ('8. 4-Stock + Require Inst Net Buy (inst20 > 0)', {'num_stocks': 4, 'require_inst20': True}),
        ('9. 4-Stock + Trailing Gain 30% -> MA20', {'num_stocks': 4, 'trailing_mode': 'gain30_ma20'}),
        ('10. 4-Stock + Trailing Gain 40% -> MA20', {'num_stocks': 4, 'trailing_mode': 'gain40_ma20'}),
        ('11. 4-Stock + Winner Persist + Sat Stop 18%', {'num_stocks': 4, 'keep_winner': True, 'sat_hard_stop': 0.18}),
        ('12. 3-Stock + Winner Persist + Sat Stop 18%', {'num_stocks': 3, 'keep_winner': True, 'sat_hard_stop': 0.18}),
        ('13. 4-Stock + Winner Persist + Inst Net Buy', {'num_stocks': 4, 'keep_winner': True, 'require_inst20': True}),
        ('14. 3-Stock + Winner Persist + Inst Net Buy', {'num_stocks': 3, 'keep_winner': True, 'require_inst20': True}),
        ('15. 4-Stock + Winner Persist + Bias 1.25 + Inst Net Buy', {'num_stocks': 4, 'keep_winner': True, 'max_bias60': 1.25, 'require_inst20': True}),
        ('16. 3-Stock + Winner Persist + Bias 1.25 + Inst Net Buy', {'num_stocks': 3, 'keep_winner': True, 'max_bias60': 1.25, 'require_inst20': True}),
        ('17. 4-Stock + Winner Persist + Sat Stop 18% + Trailing 40% MA20', {'num_stocks': 4, 'keep_winner': True, 'sat_hard_stop': 0.18, 'trailing_mode': 'gain40_ma20'}),
    ]

    for name, p in tests:
        res = simulate_grid(p)
        print(f"{name:58s} | 10Y: {res['ret_10y']:+10,.1f}% | WR: {res['wr']:4.1f}% | 2024: {res['ret_2024']:+6.2f}% | MDD: {res['mdd']:5.1f}% | Trades: {res['trades']}")

if __name__ == '__main__':
    run()
