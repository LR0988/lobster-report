import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在載入資料庫行情與法人籌碼 (精準對齊 Option A 邏輯)...")
conn = sqlite3.connect(DB_PATH)
df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_0050 = pd.read_sql_query('SELECT date, closing_price as close FROM daily_stock WHERE stock_id = "0050" AND date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')

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
    SELECT date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_value, pe_ratio
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
price_low = df_px.pivot(index='date', columns='stock_id', values='lowest_price').sort_index().ffill().combine_first(price_pivot)
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)
name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()

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

print("[✓] 行情與特徵指標矩陣準備完成！\n")

def run_stress_test(buy_mode='baseline', sell_mode='close', slip_pct=0.0):
    """
    buy_mode:
      - 'baseline': 原版基準 (以當日 Close 計算日報酬)
      - 'open': T+1 開盤價買入 (入場合約以 Open 計算至當日 Close 報酬)
      - 'high': T+1 當日最高價買入 (買在全天最差價！入場合約以 High 計算至當日 Close 報酬)
      - 'open_slip': T+1 開盤價 + slip_pct 滑價
    sell_mode:
      - 'close': 正常收盤價出場
      - 'open': T+1 開盤價出場
      - 'low': 出場當天以最低價出場 (賣在全天最差價！)
    """
    rebalance_freq = 30
    leader_w = 0.60
    sat_w = 0.20
    num_sats = 2
    min_breadth = 0.40
    min_s20_slope = 0.025
    sat_hard_stop = 0.18
    fee_rate = 0.00585

    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    all_completed_trades = []
    open_position_tracker = {}
    current_leader_sid = ''
    just_entered_sids = set()

    for i, dt in enumerate(all_dates):
        just_entered_sids.clear()

        # 1. 調倉指令 T+1 開盤生效
        exited_returns = 0.0
        if pending_weights is not None:
            prev_dt = all_dates[i-1] if i > 0 else dt
            # 結算平倉個股
            for sid, w_old in list(active_weights.items()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        if sell_mode == 'open':
                            exit_px = price_open.loc[dt, sid]
                        elif sell_mode == 'low':
                            exit_px = price_low.loc[dt, sid]
                        else:
                            exit_px = price_pivot.loc[dt, sid]

                        entry_px = pos['entry_price']
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'stock_name': name_map.get(sid, sid),
                            'role': pos['role'],
                            'entry_date': pos['entry_date'],
                            'exit_date': dt,
                            'entry_price': round(float(entry_px), 2),
                            'exit_price': round(float(exit_px), 2),
                            'return_pct': round(float(ret_pct), 2),
                            'holding_days': max(1, h_days),
                            'exit_reason': '🔄 波段常態輪動平倉'
                        })
                        del open_position_tracker[sid]

                        # 計算平倉當日從昨收至出場價之報酬損益
                        p_prev = price_pivot.loc[prev_dt, sid]
                        if not pd.isna(p_prev) and p_prev > 0 and not pd.isna(exit_px):
                            exited_returns += w_old * ((exit_px / p_prev) - 1.0)

                    if sid == current_leader_sid:
                        current_leader_sid = ''

            # 記錄新買入個股
            for sid, w_new in pending_weights.items():
                role_str = '👑 王者泰坦 (60%)' if w_new >= 0.50 else '🚀 革命衛星 (20%)'
                
                # 決定成交價
                if buy_mode == 'open':
                    exec_buy_px = price_open.loc[dt, sid]
                elif buy_mode == 'high':
                    exec_buy_px = price_high.loc[dt, sid]  # 買在最差價：當日最高點！
                elif buy_mode == 'open_slip':
                    op = price_open.loc[dt, sid]
                    hp = price_high.loc[dt, sid]
                    exec_buy_px = min(hp, op * (1.0 + slip_pct))
                else:
                    exec_buy_px = price_pivot.loc[dt, sid]

                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': exec_buy_px,
                        'role': role_str,
                        'target_weight': w_new
                    }
                    just_entered_sids.add(sid)
                    if w_new >= 0.50:
                        current_leader_sid = sid
                elif sid in open_position_tracker:
                    open_position_tracker[sid]['role'] = role_str
                    open_position_tracker[sid]['target_weight'] = w_new
                    if w_new >= 0.50:
                        current_leader_sid = sid

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
                if sid in just_entered_sids and buy_mode != 'baseline':
                    # 新買入部位：以實際買進價計算至今日收盤報酬
                    buy_px = open_position_tracker[sid]['entry_price']
                    if buy_px > 0 and not pd.isna(p_now):
                        daily_ret += w * ((p_now / buy_px) - 1.0)
                else:
                    p_prev = price_pivot.loc[prev_dt, sid]
                    if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                        daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        # 3. 盤中防守：跌破自身 60MA 或衛星觸發 -18% 寬幅停損退回現金
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_pivot.loc[dt, sid]
                ma60 = ma60_pivot.loc[dt, sid]
                pos = open_position_tracker.get(sid, {})
                ep = pos.get('entry_price', p)
                is_leader = (pos.get('role', '').startswith('👑') or w >= 0.50)

                should_stop = False
                reason_str = ''

                if not pd.isna(p) and not pd.isna(ma60) and p < ma60:
                    should_stop = True
                    reason_str = '🛡️ 跌破季線 (60MA) 防禦停損'
                elif not is_leader and sat_hard_stop is not None and ep > 0:
                    if (p / ep - 1.0) < -sat_hard_stop:
                        should_stop = True
                        reason_str = '⚡ 衛星觸發 -18% 寬幅災難停損'

                if should_stop:
                    if sid in open_position_tracker:
                        if sell_mode == 'low':
                            exit_px = price_low.loc[dt, sid]
                        elif sell_mode == 'open':
                            exit_px = price_open.loc[dt, sid]
                        else:
                            exit_px = p
                        entry_px = pos['entry_price']
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'stock_name': name_map.get(sid, sid),
                            'role': pos['role'],
                            'entry_date': pos['entry_date'],
                            'exit_date': dt,
                            'entry_price': round(float(entry_px), 2),
                            'exit_price': round(float(exit_px), 2),
                            'return_pct': round(float(ret_pct), 2),
                            'holding_days': max(1, h_days),
                            'exit_reason': reason_str
                        })
                        del open_position_tracker[sid]

                        # 若賣在最低價 (low)，需將今日收盤與最低價的差距補回負報酬
                        if sell_mode == 'low' and i > 0:
                            p_prev = price_pivot.loc[all_dates[i-1], sid]
                            if not pd.isna(p_prev) and p_prev > 0 and not pd.isna(exit_px) and not pd.isna(p):
                                # 之前 step 2 算了 (p - p_prev) / p_prev，現修正為 (exit_px - p_prev) / p_prev
                                delta_ret = w * ((exit_px - p) / p_prev)
                                portfolio_equity += portfolio_equity * delta_ret

                    if sid == current_leader_sid:
                        current_leader_sid = ''
                else:
                    temp_active[sid] = w
            
            if len(temp_active) < len(active_weights):
                reduced = sum(active_weights[s] for s in active_weights if s not in temp_active)
                portfolio_equity -= portfolio_equity * reduced * fee_rate
            active_weights = temp_active

        # 4. 定期調倉選股 (每 30 交易日)
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

        cur_exposure = sum(active_weights.values())
        equity_curve.append({
            'date': dt,
            'year': int(dt[:4]),
            'titan_equity': portfolio_equity,
            'exposure': cur_exposure
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

    win_trades = [t for t in all_completed_trades if t['return_pct'] >= 0]
    loss_trades = [t for t in all_completed_trades if t['return_pct'] < 0]
    total_trades = len(all_completed_trades)
    win_rate = (len(win_trades) / total_trades * 100.0) if total_trades > 0 else 0.0

    leader_trades = [t for t in all_completed_trades if t['role'].startswith('👑')]
    leader_wins = [t for t in leader_trades if t['return_pct'] >= 0]
    leader_win_rate = (len(leader_wins) / len(leader_trades) * 100.0) if leader_trades else 0.0

    tot_win_gain = sum(t['return_pct'] for t in win_trades)
    tot_loss_loss = abs(sum(t['return_pct'] for t in loss_trades))
    profit_factor = (tot_win_gain / tot_loss_loss) if tot_loss_loss > 0 else 0.0

    # 計算平均進場被滑價扣除之幅度 (High vs Open vs Close)
    # 取全部買進交易，看 entry_price 與當天 open 差距
    return {
        'total_ret': total_ret,
        'multiple': final_eq / 1000000.0,
        'cagr': cagr,
        'mdd': mdd,
        'ret_2024': ret_2024,
        'total_trades': total_trades,
        'win_rate': win_rate,
        'leader_win_rate': leader_win_rate,
        'profit_factor': profit_factor,
        'final_equity': final_eq,
        'trades': all_completed_trades
    }

if __name__ == '__main__':
    scenarios = [
        ('1. 【基準情境】T+1 次日收盤基準 (Baseline Close)', 'baseline', 'close', 0.0),
        ('2. 【真實開盤】T+1 次日開盤價買入 (Real-World Open)', 'open', 'close', 0.0),
        ('3. 【開盤買賣】T+1 開盤買進 + 開盤平倉 (Open in, Open out)', 'open', 'open', 0.0),
        ('4. 【保守滑價 1.5%】T+1 開盤追高 +1.5% 滑價買入', 'open_slip', 'close', 0.015),
        ('5. 【保守滑價 2.5%】T+1 開盤追高 +2.5% 重度滑價買入', 'open_slip', 'close', 0.025),
        ('6. 【最差買入價】T+1 當天「最高價」(Day High) 買入！', 'high', 'close', 0.0),
        ('7. 【雙向最差地獄】T+1 買在最高 (High) + 賣在最低 (Low)！', 'high', 'low', 0.0),
    ]

    results = []
    for name, b_mode, s_mode, slp in scenarios:
        print(f"[*] 正在模擬: {name}...")
        res = run_stress_test(b_mode, s_mode, slp)
        res['name'] = name
        results.append(res)

    print("\n" + "="*112)
    print("⚡ 泰坦王權主宰旗艦版 (Option A) 最差成交價與極端滑價真實壓力測試總表 ⚡")
    print("="*112)
    header = f"{'情境名稱':<40} | {'10年累積':<10} | {'獲利倍數':<8} | {'CAGR':<7} | {'MDD':<8} | {'2024年':<8} | {'王者勝率':<8} | {'全勝率':<7} | {'盈虧比':<6}"
    print(header)
    print("-" * 112)
    for r in results:
        print(f"{r['name']:<38} | {r['total_ret']:>8.1f}% | {r['multiple']:>6.1f}x | {r['cagr']:>5.1f}% | {r['mdd']:>6.1f}% | {r['ret_2024']:>6.1f}% | {r['leader_win_rate']:>6.1f}% | {r['win_rate']:>5.1f}% | {r['profit_factor']:>5.2f}")
    print("="*112)
