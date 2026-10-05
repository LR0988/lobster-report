import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
    df_0050 = pd.read_sql_query('SELECT date, closing_price as close FROM daily_stock WHERE stock_id = "0050" AND date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
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
    ma10_pivot = price_pivot.rolling(10, min_periods=5).mean()
    ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    high60_pivot = price_pivot.rolling(60, min_periods=20).max()
    ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
    ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)

    ret_20 = price_pivot.pct_change(20, fill_method=None)
    ret_60 = price_pivot.pct_change(60, fill_method=None)
    ret_120 = price_pivot.pct_change(120, fill_method=None)
    
    # Novy-Marx Intermediate Momentum (Months 2-6: ret_120 - ret_20)
    inter_mom = (price_pivot.shift(20) / price_pivot.shift(120) - 1.0)

    # Volatility for Sharpe momentum (Blitz et al.)
    vol_60 = price_pivot.pct_change(1, fill_method=None).rolling(60, min_periods=20).std() * np.sqrt(250)

    taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
    taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
    taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

    rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
    rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()

    def run_quant_engine(name, 
                         mom_type='novy_marx', 
                         require_inst_positive=True,
                         require_ma20_slope_positive=True,
                         sat_hard_stop=0.16,
                         num_satellites=2,
                         rebalance_freq=30,
                         trailing_stop_lock=True):
        
        portfolio_equity = 1000000.0
        equity_curve = []
        active_weights = {}
        pending_weights = None
        fee_rate = 0.00585
        all_completed_trades = []
        open_position_tracker = {}
        high_water_marks = {}

        for i, dt in enumerate(all_dates):
            if pending_weights is not None:
                for sid in list(active_weights.keys()):
                    if sid not in pending_weights:
                        if sid in open_position_tracker:
                            pos = open_position_tracker[sid]
                            ret_pct = (price_pivot.loc[dt, sid] / pos['entry_price'] - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret_pct, 'entry_date': pos['entry_date'], 'exit_date': dt})
                            del open_position_tracker[sid]
                        if sid in high_water_marks:
                            del high_water_marks[sid]
                for sid, w_new in pending_weights.items():
                    if sid not in active_weights:
                        open_position_tracker[sid] = {'entry_price': price_pivot.loc[dt, sid], 'entry_date': dt, 'role': 'leader' if w_new>=0.35 else 'sat'}
                        high_water_marks[sid] = price_pivot.loc[dt, sid]
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
                    if sid in high_water_marks:
                        high_water_marks[sid] = max(high_water_marks[sid], p) if not pd.isna(p) else high_water_marks[sid]
                    hwm = high_water_marks.get(sid, p)

                    should_exit = False
                    if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                        should_exit = True

                    if not should_exit and sid in open_position_tracker:
                        ep = open_position_tracker[sid]['entry_price']
                        role = open_position_tracker[sid]['role']
                        if not pd.isna(p) and not pd.isna(ep) and ep > 0:
                            if sat_hard_stop is not None and role == 'sat':
                                if (p / ep - 1.0) < -sat_hard_stop:
                                    should_exit = True
                            if trailing_stop_lock:
                                gain_hwm = (hwm / ep - 1.0)
                                if gain_hwm >= 0.40 and not pd.isna(ma20) and p < ma20:
                                    should_exit = True

                    if should_exit:
                        if sid in open_position_tracker:
                            ret_pct = (p / open_position_tracker[sid]['entry_price'] - 1.0) * 100
                            all_completed_trades.append({'stock_id': sid, 'return_pct': ret_pct, 'entry_date': open_position_tracker[sid]['entry_date'], 'exit_date': dt})
                            del open_position_tracker[sid]
                        if sid in high_water_marks:
                            del high_water_marks[sid]
                    else:
                        temp_active[sid] = w
                active_weights = temp_active

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
                        if pd.isna(p) or pd.isna(m60) or pd.isna(r120) or p < m60 * 1.025:
                            continue
                        if pd.isna(m20) or p < m20 or m20 < m60:
                            continue
                        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
                            continue
                        if require_ma20_slope_positive:
                            s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                            if pd.isna(s20) or s20 < 0:
                                continue
                        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88:
                            continue

                        inst20 = rolling_inst_20.loc[dt, sid] if sid in rolling_inst_20.columns else 0
                        if require_inst_positive and inst20 <= 0:
                            continue

                        t120_val = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                        t60_val = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                        t20_val = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                        if mom_type == 'novy_marx':
                            # Novy-Marx Intermediate Momentum (Months 2-6) - avoids 1-month reversal
                            im = inter_mom.loc[dt, sid] if sid in inter_mom.columns and not pd.isna(inter_mom.loc[dt, sid]) else 0
                            rs = (im - (t120_val - t20_val))*0.60 + (r60 - t60_val)*0.40
                        elif mom_type == 'residual_sharpe':
                            v60 = vol_60.loc[dt, sid] if sid in vol_60.columns and not pd.isna(vol_60.loc[dt, sid]) and vol_60.loc[dt, sid]>0 else 0.3
                            raw_rs = (r20-t20_val)*0.30 + (r60-t60_val)*0.40 + (r120-t120_val)*0.30
                            rs = raw_rs / max(0.15, v60)
                        else:
                            rs = (r20-t20_val)*0.30 + (r60-t60_val)*0.40 + (r120-t120_val)*0.30

                        h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
                        scores[sid] = {'rs': rs, 'inst': inst20, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

                    if len(scores) >= 3:
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
                        
                        next_targets = {leader: 0.40}
                        sat_w = 0.60 / num_satellites
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
        t24 = [t for t in all_completed_trades if str(t['entry_date']).startswith('2024') or str(t['exit_date']).startswith('2024')]
        wr24 = len([t for t in t24 if t['return_pct'] > 0]) / len(t24) * 100 if t24 else 0

        df_res['year'] = df_res.index.str.slice(0, 4)
        yearly = {y: round(float((g.iloc[-1]['equity'] / g.iloc[0]['equity'] - 1) * 100), 1) for y, g in df_res.groupby('year')}
        print(f"{name:65s} | 10Y: {ret_10y:+10,.1f}% | WR: {wr:4.1f}% | 2024: {ret_2024:+6.2f}% | MDD: {mdd:5.1f}% | Total Trades: {len(all_completed_trades)}")
        return yearly

    print('=== Testing Literature-Backed Win Rate & High Profit Innovations ===')
    run_quant_engine('Lit-1: Novy-Marx Intermediate Momentum', mom_type='novy_marx', require_inst_positive=False, require_ma20_slope_positive=False)
    run_quant_engine('Lit-2: Intermediate Mom + MA20 Slope > 0 Confirm', mom_type='novy_marx', require_inst_positive=False, require_ma20_slope_positive=True)
    run_quant_engine('Lit-3: Intermediate Mom + Inst Net Buying Confirm', mom_type='novy_marx', require_inst_positive=True, require_ma20_slope_positive=False)
    run_quant_engine('Lit-4: Residual Sharpe Momentum + Inst Net Buying', mom_type='residual_sharpe', require_inst_positive=True, require_ma20_slope_positive=False)
    run_quant_engine('Lit-5: Intermediate Mom + Dual MA Slopes > 0 + Sat Stop 18%', mom_type='novy_marx', require_inst_positive=False, require_ma20_slope_positive=True, sat_hard_stop=0.18)

if __name__ == '__main__':
    run()
