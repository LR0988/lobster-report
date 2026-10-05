import sqlite3
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
    df_macro_overlay = df_taiex.copy()
    df_macro_overlay['taiex_ma20'] = df_macro_overlay['close'].rolling(20).mean()
    df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()
    df_macro_overlay['taiex_slope5'] = (df_macro_overlay['taiex_ma60'] - df_macro_overlay['taiex_ma60'].shift(5)) / df_macro_overlay['taiex_ma60'].shift(5)

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

    # Calculate Market Breadth (% of liquid 50 stocks above MA20)
    above_ma20 = (price_pivot >= ma20_pivot).astype(int)
    breadth_ma20 = above_ma20.mean(axis=1)

    print("[*] Data loaded. Testing Literature-Backed Win Rate & Return Optimization...")

    def run_sim(name,
                entry_max_ma20_dist=None, # e.g. 1.08 (entry price <= ma20 * 1.08)
                min_breadth=None,         # e.g. 0.45
                leader_w=0.40,
                num_stocks=4,
                sat_stop=0.18,
                partial_tp=False,         # Scaled exit: take 30% profit at +15%, let rest run
                keep_winner=True):

        portfolio_equity = 1000000.0
        equity_curve = []
        active_weights = {}
        pending_weights = None
        fee_rate = 0.00585
        all_completed_trades = []
        open_tracker = {}
        rebalance_freq = 30
        num_sat = num_stocks - 1
        sat_w = (1.0 - leader_w) / num_sat

        for i, dt in enumerate(all_dates):
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

                for sid, w_new in pending_weights.items():
                    if sid not in active_weights:
                        p_now = price_pivot.loc[dt, sid]
                        open_tracker[sid] = {
                            'entry_price': p_now,
                            'entry_date': dt,
                            'role': 'leader' if w_new >= 0.35 else 'sat',
                            'has_taken_tp': False,
                            'weight': w_new
                        }

                turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
                portfolio_equity -= portfolio_equity * turnover * fee_rate
                active_weights = {s: w for s, w in pending_weights.items() if s in price_pivot.columns}
                pending_weights = None

            if i > 0:
                prev_dt = all_dates[i-1]
                daily_ret = sum(w * ((price_pivot.loc[dt, sid] / price_pivot.loc[prev_dt, sid]) - 1.0) for sid, w in active_weights.items() if sid in price_pivot.columns)
                portfolio_equity *= (1.0 + daily_ret)

            if active_weights:
                temp_active = {}
                for sid, w in active_weights.items():
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    pos = open_tracker.get(sid, {})
                    ep = pos.get('entry_price', p)
                    role = pos.get('role', 'sat')

                    should_exit = False
                    reason = ''

                    # 60MA exit
                    if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                        should_exit = True
                        reason = '60ma_break'
                    elif sat_stop is not None and role == 'sat':
                        if (p / ep - 1.0) < -sat_stop:
                            should_exit = True
                            reason = 'sat_stop'

                    if should_exit:
                        if sid in open_tracker:
                            ret = (p / ep - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret, 'entry_date': open_tracker[sid]['entry_date'], 'exit_date': dt, 'reason': reason})
                            del open_tracker[sid]
                    else:
                        temp_active[sid] = w
                active_weights = temp_active

            # Rebalance
            if i % rebalance_freq == 0:
                is_taiex_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
                if not is_taiex_bull:
                    next_targets = {}
                else:
                    curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
                    allow_satellites = (min_breadth is None) or (curr_breadth >= min_breadth)

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

                        if pd.isna(p) or pd.isna(m60) or pd.isna(r120) or p < m60 * 1.025: continue
                        if pd.isna(m20) or p < m20 or m20 < m60: continue
                        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0: continue
                        s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                        if pd.isna(s20) or s20 < 0: continue
                        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88: continue

                        # Pullback / Entry distance constraint:
                        if entry_max_ma20_dist is not None and not pd.isna(m20):
                            if (p / m20) > entry_max_ma20_dist:
                                continue

                        t120_val = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                        t60_val = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                        t20_val = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                        rs = (r20 - t20_val)*0.30 + (r60 - t60_val)*0.40 + (r120 - t120_val)*0.30
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
                        
                        if not allow_satellites:
                            # In narrow regimes, park satellite capital in King Leader or cash
                            next_targets = {leader: 1.0}
                        else:
                            if keep_winner and active_weights:
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
        print(f"{name:58s} | 10Y: {ret_10y:+10,.1f}% | WR: {wr:4.1f}% | 2024: {ret_2024:+6.2f}% | MDD: {mdd:5.1f}% | Trades: {len(all_completed_trades)}")
        return {'ret_10y': ret_10y, 'wr': wr, 'ret_2024': ret_2024, 'mdd': mdd, 'trades': len(all_completed_trades)}

    print('='*115)
    print(f"{'策略名稱':58s} | {'10年累積':>12s} | {'總勝率':>7s} | {'2024':>8s} | {'MDD':>7s} | {'總筆數'}")
    print('='*115)

    run_sim('1. Benchmark 4-Stock (Winner Persist + Sat Stop 18%)')
    run_sim('2. Pullback Filter: p/MA20 <= 1.10 (Avoid Late Chase)', entry_max_ma20_dist=1.10)
    run_sim('3. Pullback Filter: p/MA20 <= 1.08', entry_max_ma20_dist=1.08)
    run_sim('4. Pullback Filter: p/MA20 <= 1.06', entry_max_ma20_dist=1.06)
    run_sim('5. Pullback Filter: p/MA20 <= 1.04', entry_max_ma20_dist=1.04)

    run_sim('6. Market Breadth Filter >= 40% MA20', min_breadth=0.40)
    run_sim('7. Market Breadth Filter >= 50% MA20', min_breadth=0.50)
    run_sim('8. Market Breadth Filter >= 55% MA20', min_breadth=0.55)

    run_sim('9. Pullback <= 1.08 + Breadth >= 40%', entry_max_ma20_dist=1.08, min_breadth=0.40)
    run_sim('10. Pullback <= 1.08 + Breadth >= 50%', entry_max_ma20_dist=1.08, min_breadth=0.50)
    run_sim('11. 3-Stock Benchmark (40/30/30 + Winner Persist)', num_stocks=3)
    run_sim('12. 3-Stock + Pullback <= 1.08', num_stocks=3, entry_max_ma20_dist=1.08)
    run_sim('13. 3-Stock + Breadth >= 40%', num_stocks=3, min_breadth=0.40)
    run_sim('14. 3-Stock + Breadth >= 50%', num_stocks=3, min_breadth=0.50)

if __name__ == '__main__':
    run()
