import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def load_all_data():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('''
        SELECT date, close FROM daily_index 
        WHERE date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_0050 = pd.read_sql_query('''
        SELECT date, closing_price as close FROM daily_stock 
        WHERE stock_id = "0050" AND date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_macro = pd.read_sql_query('''
        SELECT date, sox FROM macro_indicators 
        WHERE date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_macro_overlay = df_taiex.copy()
    df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()
    df_macro_overlay['sox'] = df_macro['sox'].ffill()
    df_macro_overlay['sox_ma60'] = df_macro_overlay['sox'].rolling(60).mean()
    df_macro_overlay['macro_bull'] = (df_macro_overlay['close'] >= df_macro_overlay['taiex_ma60']) | \
                                     (df_macro_overlay['sox'] >= df_macro_overlay['sox_ma60'])

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

    ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)
    high60_pivot = price_pivot.rolling(60, min_periods=20).max()

    ret_20 = price_pivot.pct_change(20, fill_method=None)
    ret_60 = price_pivot.pct_change(60, fill_method=None)
    ret_120 = price_pivot.pct_change(120, fill_method=None)
    ret_250 = price_pivot.pct_change(250, fill_method=None)

    taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
    taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
    taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

    rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
    rolling_turnover_20 = value_pivot.rolling(20, min_periods=10).mean()
    rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()
    rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()

    return {
        'all_dates': all_dates,
        'df_taiex': df_taiex,
        'df_0050': df_0050,
        'df_macro_overlay': df_macro_overlay,
        'price_pivot': price_pivot,
        'value_pivot': value_pivot,
        'pe_pivot': pe_pivot,
        'ma20_pivot': ma20_pivot,
        'ma60_pivot': ma60_pivot,
        'ma60_slope5': ma60_slope5,
        'high60_pivot': high60_pivot,
        'ret_20': ret_20,
        'ret_60': ret_60,
        'ret_120': ret_120,
        'ret_250': ret_250,
        'taiex_ret20': taiex_ret20,
        'taiex_ret60': taiex_ret60,
        'taiex_ret120': taiex_ret120,
        'rolling_turnover_60': rolling_turnover_60,
        'rolling_turnover_20': rolling_turnover_20,
        'rolling_inst_60': rolling_inst_60,
        'rolling_inst_20': rolling_inst_20,
        'name_map': name_map
    }

def run_titan_pro(data, cfg):
    all_dates = data['all_dates']
    price_pivot = data['price_pivot']
    ma20_pivot = data['ma20_pivot']
    ma60_pivot = data['ma60_pivot']
    ma60_slope5 = data['ma60_slope5']
    high60_pivot = data['high60_pivot']
    ret_20 = data['ret_20']
    ret_60 = data['ret_60']
    ret_120 = data['ret_120']
    ret_250 = data['ret_250']
    taiex_ret20 = data['taiex_ret20']
    taiex_ret60 = data['taiex_ret60']
    taiex_ret120 = data['taiex_ret120']
    rolling_turnover_60 = data['rolling_turnover_60']
    rolling_turnover_20 = data['rolling_turnover_20']
    rolling_inst_20 = data['rolling_inst_20']
    rolling_inst_60 = data['rolling_inst_60']
    df_macro_overlay = data['df_macro_overlay']

    rebalance_freq = cfg.get('rebalance_freq', 20)
    be_thresh = cfg.get('be_thresh', 0.0)         # 保本啟動門檻 (例如 6.0% 或 8.0%)
    be_target = cfg.get('be_target', 0.8)         # 觸發保本後之出場點 (entry_px * 1.008, 確保扣手續費後依然正報酬)
    trail_thresh = cfg.get('trail_thresh', 0.0)   # 階梯停利門檻 (例如 20%)
    trail_lock = cfg.get('trail_lock', 0.0)       # 階梯停利鎖定 (例如 10%)
    keep_winner = cfg.get('keep_winner', False)   # 調倉日若個股強勁則繼續持有，不強制換掉
    alloc_scheme = cfg.get('alloc_scheme', '40_30_30') # 40_30_30 or 50_25_25
    
    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585
    all_completed_trades = []
    open_position_tracker = {}

    for i, dt in enumerate(all_dates):
        # 1. 調倉指令 T+1 開盤生效
        if pending_weights is not None:
            # 結算平倉的股票
            for sid in list(active_weights.keys()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        exit_px = price_pivot.loc[dt, sid]
                        entry_px = pos['entry_price']
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'return_pct': ret_pct,
                            'holding_days': max(1, h_days),
                            'exit_reason': '月度輪動'
                        })
                        del open_position_tracker[sid]

            # 記錄新買入的股票
            for sid, w_new in pending_weights.items():
                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': price_pivot.loc[dt, sid],
                        'max_px': price_pivot.loc[dt, sid],
                        'target_weight': w_new
                    }

            turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            active_weights = pending_weights
            pending_weights = None

        # 2. 結算日報酬
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = 0.0
            for sid, w in active_weights.items():
                p_now = price_pivot.loc[dt, sid]
                p_prev = price_pivot.loc[prev_dt, sid]
                if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                    daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        # 更新最高價
        for sid in active_weights:
            if sid in open_position_tracker:
                p = price_pivot.loc[dt, sid]
                if not pd.isna(p) and p > open_position_tracker[sid]['max_px']:
                    open_position_tracker[sid]['max_px'] = p

        # 3. 盤中防守檢查 (季線防守 + 浮盈保本機制 + 階梯停利)
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_pivot.loc[dt, sid]
                ma = ma60_pivot.loc[dt, sid]
                pos = open_position_tracker.get(sid, {})
                entry_px = pos.get('entry_price', p)
                max_px = pos.get('max_px', p)

                should_stop = False
                reason = ''

                # 條件 A: 跌破自身 60MA 停損
                if not pd.isna(p) and not pd.isna(ma) and p < ma:
                    should_stop = True
                    reason = '破60MA防禦停損'

                # 條件 B: 階梯鎖利 (例如浮盈曾達 25%，鎖定 12% 利潤)
                elif trail_thresh > 0 and entry_px > 0 and (max_px / entry_px - 1.0) * 100 >= trail_thresh:
                    lock_price = entry_px * (1.0 + trail_lock / 100.0)
                    if p <= lock_price:
                        should_stop = True
                        reason = f'浮盈>{trail_thresh}%鎖利出場'

                # 條件 C: 浮盈保本 (例如浮盈曾達 6%~8%，回落至成本+0.8% 保本出場)
                elif be_thresh > 0 and entry_px > 0 and (max_px / entry_px - 1.0) * 100 >= be_thresh:
                    be_price = entry_px * (1.0 + be_target / 100.0)
                    if p <= be_price:
                        should_stop = True
                        reason = f'浮盈>{be_thresh}%保本停利'

                if should_stop:
                    if sid in open_position_tracker:
                        exit_px = p
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'return_pct': ret_pct,
                            'holding_days': max(1, h_days),
                            'exit_reason': reason
                        })
                        del open_position_tracker[sid]
                else:
                    temp_active[sid] = w
            active_weights = temp_active

        # 4. 定期調倉選股
        if i % rebalance_freq == 0:
            is_macro_bull = df_macro_overlay.loc[dt, 'macro_bull'] if dt in df_macro_overlay.index else True
            if not is_macro_bull:
                next_targets = {}
            else:
                valid_turnover = rolling_turnover_60.loc[dt].dropna()
                liquid_pool = valid_turnover.nlargest(50).index
                scores = {}
                for sid in liquid_pool:
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    r20 = ret_20.loc[dt, sid]
                    r60 = ret_60.loc[dt, sid]
                    r120 = ret_120.loc[dt, sid]
                    r250 = ret_250.loc[dt, sid]
                    h60 = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p

                    if pd.isna(p) or pd.isna(ma60) or pd.isna(r120):
                        continue

                    # 門檻 1: 價格大於季線 + 緩衝帶 (預設 2.0%)
                    min_buf = cfg.get('min_buf', 2.0)
                    if p < ma60 * (1.0 + min_buf / 100.0):
                        continue

                    # 門檻 2: 季線 5 日斜率上揚
                    s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                    if pd.isna(s5) or s5 < 0:
                        continue

                    # 門檻 3: 近 20 交易日必須為正報酬 (拒絕轉弱股)
                    if pd.isna(r20) or r20 < 0:
                        continue

                    # 門檻 4: 距 60 日新高不到 20% (只買高姿態真強勢股，拒絕深跌破線股)
                    if cfg.get('near_high_filter', True):
                        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.82:
                            continue

                    # 門檻 5: 近 20 日法人必須為淨買超
                    inst20 = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and not pd.isna(rolling_inst_20.loc[dt, sid])) else 0
                    if cfg.get('require_inst20', True) and inst20 <= 0:
                        continue

                    t120 = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                    t60 = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                    t20 = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                    # 多尺度真實動能打分
                    rs_score = (r20 - t20)*0.25 + (r60 - t60)*0.35 + (r120 - t120)*0.25 + (r250 if not pd.isna(r250) else 0)*0.15
                    turnover = valid_turnover[sid]

                    scores[sid] = {
                        'rs': rs_score,
                        'inst': inst20,
                        'turnover': turnover
                    }

                if len(scores) >= 3:
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    sdf['norm_inst'] = sdf['inst'].rank(pct=True)
                    sdf['norm_size'] = sdf['turnover'].rank(pct=True)

                    sdf['titan_score'] = 0.50 * sdf['norm_rs'] + 0.30 * sdf['norm_inst'] + 0.20 * sdf['norm_size']

                    top_leaders_pool = sdf.nlargest(min(cfg.get('leader_pool_k', 6), len(sdf)), 'turnover')
                    sovereign_leader = top_leaders_pool['titan_score'].idxmax()
                    remaining = sdf.drop(index=[sovereign_leader])
                    satellites = remaining.nlargest(min(2, len(remaining)), 'titan_score').index.tolist()

                    w_leader = 0.40 if alloc_scheme == '40_30_30' else 0.50
                    w_sat = 0.30 if alloc_scheme == '40_30_30' else 0.25
                    next_targets = {sovereign_leader: w_leader}
                    for sat in satellites:
                        next_targets[sat] = w_sat

                elif len(scores) > 0:
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    next_targets = {}
                    leader = sdf['norm_rs'].idxmax()
                    w_leader = 0.40 if alloc_scheme == '40_30_30' else 0.50
                    next_targets[leader] = w_leader
                    w_sat = 0.30 if alloc_scheme == '40_30_30' else 0.25
                    for sat in sdf.drop(index=[leader]).index[:2]:
                        next_targets[sat] = w_sat
                else:
                    next_targets = {}

            pending_weights = next_targets

        equity_curve.append(portfolio_equity)

    df_res = pd.Series(equity_curve, index=all_dates)
    total_ret = (df_res.iloc[-1] / df_res.iloc[0] - 1.0) * 100.0
    cagr = (np.power(max(0.01, df_res.iloc[-1] / df_res.iloc[0]), 1.0 / (len(all_dates)/242.0)) - 1.0) * 100.0
    peak = df_res.cummax()
    mdd = ((df_res - peak) / peak).min() * 100.0
    daily_returns = df_res.pct_change().dropna()
    sharpe = (daily_returns.mean() / (daily_returns.std() + 1e-9)) * np.sqrt(242)

    df_trades = pd.DataFrame(all_completed_trades)
    wins = df_trades[df_trades['return_pct'] > 0]
    losses = df_trades[df_trades['return_pct'] <= 0]
    win_rate = len(wins) / len(df_trades) * 100 if len(df_trades) > 0 else 0
    avg_win = wins['return_pct'].mean() if len(wins) > 0 else 0
    avg_loss = losses['return_pct'].mean() if len(losses) > 0 else 0

    return {
        'win_rate': win_rate,
        'win_count': len(wins),
        'loss_count': len(losses),
        'total_trades': len(df_trades),
        'total_ret': total_ret,
        'cagr': cagr,
        'sharpe': sharpe,
        'mdd': mdd,
        'avg_win': avg_win,
        'avg_loss': avg_loss
    }

if __name__ == '__main__':
    print("[*] 正在載入歷史數據...")
    data = load_all_data()
    print("[*] 數據載入完成，測試高勝率 (>=50%) + 高報酬 (>=3000%) 突破架構...")

    grid = [
        ('基準 Titan 40_30_30', {'min_buf': 0.0, 'near_high_filter': False, 'require_inst20': False, 'be_thresh': 0.0}),
        ('選股矩陣 + 6%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 6.0, 'be_target': 0.8}),
        ('選股矩陣 + 7%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 7.0, 'be_target': 0.8}),
        ('選股矩陣 + 8%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 8.0, 'be_target': 0.8}),
        ('選股矩陣 + 8%保本 + 25%階梯鎖利(12%)', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 8.0, 'be_target': 0.8, 'trail_thresh': 25.0, 'trail_lock': 12.0}),
        ('選股矩陣(50_25_25) + 8%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 8.0, 'be_target': 0.8, 'alloc_scheme': '50_25_25'}),
        ('選股矩陣(50_25_25) + 7%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 7.0, 'be_target': 0.8, 'alloc_scheme': '50_25_25'}),
        ('選股矩陣(50_25_25) + 6%保本', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 6.0, 'be_target': 0.8, 'alloc_scheme': '50_25_25'}),
        ('選股矩陣(50_25_25) + 8%保本 + 25%鎖利(12%)', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 8.0, 'be_target': 0.8, 'trail_thresh': 25.0, 'trail_lock': 12.0, 'alloc_scheme': '50_25_25'}),
        ('選股矩陣(40_30_30) + 5%保本 + 20%鎖利(10%)', {'min_buf': 2.0, 'near_high_filter': True, 'require_inst20': True, 'be_thresh': 5.0, 'be_target': 0.6, 'trail_thresh': 20.0, 'trail_lock': 10.0}),
    ]

    results = []
    for name, c in grid:
        res = run_titan_pro(data, c)
        results.append({
            '方案': name,
            '勝率 (%)': f"{res['win_rate']:.2f}%",
            '勝/敗': f"{res['win_count']} / {res['loss_count']}",
            '10年總報酬': f"{res['total_ret']:+,.1f}%",
            '年化CAGR': f"{res['cagr']:.2f}%",
            '夏普': f"{res['sharpe']:.2f}",
            'MDD': f"{res['mdd']:.2f}%",
            '均勝/均負': f"+{res['avg_win']:.1f}% / {res['avg_loss']:.1f}%",
            '盈虧比': f"{abs(res['avg_win']/res['avg_loss']):.2f}" if res['avg_loss'] != 0 else '-'
        })

    print(pd.DataFrame(results).to_string(index=False))
