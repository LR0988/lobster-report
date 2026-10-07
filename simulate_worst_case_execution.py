import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在載入資料庫行情與法人籌碼 (僅需載入一次)...")
conn = sqlite3.connect(DB_PATH)
df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_0050 = pd.read_sql_query('SELECT date, closing_price as close FROM daily_stock WHERE stock_id = "0050" AND date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')

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
    SELECT date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_value
    FROM daily_stock
    WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
''', conn, params=sids)

df_inst = pd.read_sql_query(f'''
    SELECT date, stock_id, foreign_net, trust_net
    FROM institutional_trades
    WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
''', conn, params=sids)
conn.close()

price_close = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
price_open = df_px.pivot(index='date', columns='stock_id', values='opening_price').sort_index().ffill().combine_first(price_close)
price_high = df_px.pivot(index='date', columns='stock_id', values='highest_price').sort_index().ffill().combine_first(price_close)
price_low = df_px.pivot(index='date', columns='stock_id', values='lowest_price').sort_index().ffill().combine_first(price_close)
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_close.index).reindex(columns=price_close.columns).fillna(0)
name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()

all_dates = [d for d in price_close.index if d >= '20160104']

ma20_pivot = price_close.rolling(20, min_periods=10).mean()
ma60_pivot = price_close.rolling(60, min_periods=20).mean()
ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
high60_pivot = price_close.rolling(60, min_periods=20).max()

ret_20 = price_close.pct_change(20, fill_method=None)
ret_60 = price_close.pct_change(60, fill_method=None)
ret_120 = price_close.pct_change(120, fill_method=None)

taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()
breadth_ma20 = (price_close >= ma20_pivot).astype(int).mean(axis=1)

print("[✓] 行情矩陣載入完畢，開始執行各情境壓力測試！\n")

def simulate(entry_mode='open', exit_mode='close', slip_pct=0.0):
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

    for i, dt in enumerate(all_dates):
        # 1. 調倉指令 T+1 開盤生效
        if pending_weights is not None:
            # 結算平倉個股
            for sid in list(active_weights.keys()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        if exit_mode == 'open':
                            exit_px = price_open.loc[dt, sid]
                        elif exit_mode == 'low':
                            exit_px = price_low.loc[dt, sid]
                        else:
                            exit_px = price_close.loc[dt, sid]

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
                    if sid == current_leader_sid:
                        current_leader_sid = ''

            # 記錄新買入個股
            for sid, w_new in pending_weights.items():
                role_str = '👑 王者泰坦 (60%)' if w_new >= 0.50 else '🚀 革命衛星 (20%)'

                # 決定買入成交價格
                if entry_mode == 'open':
                    buy_px = price_open.loc[dt, sid]
                elif entry_mode == 'high':
                    buy_px = price_high.loc[dt, sid]  # 最差價格：買在當天最高點！
                elif entry_mode == 'open_slip':
                    op = price_open.loc[dt, sid]
                    hp = price_high.loc[dt, sid]
                    buy_px = min(hp, op * (1.0 + slip_pct))  # 開盤追價滑價
                else:
                    buy_px = price_close.loc[dt, sid]

                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': buy_px,
                        'role': role_str,
                        'target_weight': w_new
                    }
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
            daily_ret = 0.0
            for sid, w in active_weights.items():
                p_now = price_close.loc[dt, sid]
                pos = open_position_tracker.get(sid)
                if pos and pos['entry_date'] == dt:
                    entry_p = pos['entry_price']
                    if entry_p > 0:
                        daily_ret += w * ((p_now / entry_p) - 1.0)
                else:
                    p_prev = price_close.loc[prev_dt, sid]
                    if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                        daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        # 3. 盤中防守：跌破自身 60MA 或衛星觸發 -18% 寬幅停損退回現金
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_close.loc[dt, sid]
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
                        if exit_mode == 'low':
                            exit_px = price_low.loc[dt, sid]
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
                    if sid == current_leader_sid:
                        current_leader_sid = ''
                else:
                    temp_active[sid] = w

            if len(temp_active) < len(active_weights):
                reduced = sum(active_weights[s] for s in active_weights if s not in temp_active)
                portfolio_equity -= portfolio_equity * reduced * fee_rate
                active_weights = temp_active

        # 4. 記錄每日資產
        mkt_exposure = sum(active_weights.values())
        equity_curve.append({
            'date': dt,
            'year': int(dt[:4]),
            'equity': portfolio_equity,
            'exposure': mkt_exposure
        })

        # 5. 判斷是否為定期調倉日 (每 30 天)
        is_rebal_day = (i % rebalance_freq == 0)
        macro_safe = True
        if dt in df_taiex.index:
            t_close = df_taiex.loc[dt, 'close']
            t_ma60 = df_taiex['close'].loc[:dt].tail(60).mean()
            macro_safe = (t_close > t_ma60)

        if is_rebal_day:
            if not macro_safe:
                pending_weights = {}
            else:
                br = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
                candidates = []
                for sid in sids:
                    p = price_close.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    h60 = high60_pivot.loc[dt, sid]
                    t_val = rolling_turnover_60.loc[dt, sid]
                    s20_slp = ma20_slope5.loc[dt, sid]

                    if pd.isna(p) or pd.isna(ma20) or pd.isna(ma60) or pd.isna(h60) or pd.isna(t_val):
                        continue
                    if t_val < 300000000:
                        continue
                    if p < ma20 or p < ma60:
                        continue

                    r20 = ret_20.loc[dt, sid] or 0.0
                    r60 = ret_60.loc[dt, sid] or 0.0
                    r120 = ret_120.loc[dt, sid] or 0.0

                    m_score = (
                        (r20 - (taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0)) * 0.35 +
                        (r60 - (taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0)) * 0.35 +
                        (r120 - (taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0)) * 0.30
                    )
                    dist_to_h60 = (p - h60) / h60
                    inst_f = rolling_inst_20.loc[dt, sid] if (dt in rolling_inst_20.index and sid in rolling_inst_20.columns) else 0

                    candidates.append({
                        'stock_id': sid,
                        'turnover': t_val,
                        'momentum': m_score,
                        'dist_to_high': dist_to_h60,
                        'inst_flow': inst_f,
                        's20_slope': s20_slp if not pd.isna(s20_slp) else 0.0
                    })

                if not candidates:
                    pending_weights = {}
                else:
                    df_c = pd.DataFrame(candidates)
                    top5_turnover = df_c.sort_values('turnover', ascending=False).head(5)
                    leader_row = top5_turnover.sort_values('momentum', ascending=False).iloc[0]
                    best_leader = leader_row['stock_id']

                    if br < min_breadth:
                        pending_weights = {best_leader: 1.0}
                    else:
                        sat_cands = df_c[
                            (df_c['stock_id'] != best_leader) &
                            (df_c['dist_to_high'] >= -0.15) &
                            (df_c['s20_slope'] >= min_s20_slope)
                        ].copy()

                        if len(sat_cands) < num_sats:
                            sat_cands = df_c[
                                (df_c['stock_id'] != best_leader) &
                                (df_c['dist_to_high'] >= -0.20)
                            ].copy()

                        if len(sat_cands) >= num_sats:
                            sat_cands = sat_cands.sort_values('momentum', ascending=False).head(num_sats)
                            sats = sat_cands['stock_id'].tolist()
                            pending_weights = {best_leader: leader_w}
                            for s in sats:
                                pending_weights[s] = sat_w
                        elif len(sat_cands) == 1:
                            s = sat_cands.iloc[0]['stock_id']
                            pending_weights = {best_leader: leader_w + sat_w, s: sat_w}
                        else:
                            pending_weights = {best_leader: 1.0}

    df_eq = pd.DataFrame(equity_curve)
    final_eq = df_eq.iloc[-1]['equity']
    total_ret = ((final_eq - 1000000.0) / 1000000.0) * 100.0
    cagr = ((final_eq / 1000000.0) ** (1.0 / 10.75) - 1.0) * 100.0

    df_eq['peak'] = df_eq['equity'].cummax()
    df_eq['dd'] = (df_eq['equity'] - df_eq['peak']) / df_eq['peak'] * 100.0
    mdd = df_eq['dd'].min()

    df_2024 = df_eq[df_eq['year'] == 2024]
    ret_2024 = ((df_2024.iloc[-1]['equity'] - df_2024.iloc[0]['equity']) / df_2024.iloc[0]['equity'] * 100) if len(df_2024) > 1 else 0.0

    win_trades = [t for t in all_completed_trades if t['return_pct'] >= 0]
    loss_trades = [t for t in all_completed_trades if t['return_pct'] < 0]
    total_trades = len(all_completed_trades)
    win_rate = (len(win_trades) / total_trades * 100) if total_trades > 0 else 0.0

    leader_trades = [t for t in all_completed_trades if t['role'].startswith('👑')]
    leader_wins = [t for t in leader_trades if t['return_pct'] >= 0]
    leader_win_rate = (len(leader_wins) / len(leader_trades) * 100) if leader_trades else 0.0

    tot_win_gain = sum(t['return_pct'] for t in win_trades)
    tot_loss_loss = abs(sum(t['return_pct'] for t in loss_trades))
    profit_factor = (tot_win_gain / tot_loss_loss) if tot_loss_loss > 0 else 0.0

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
        ('1. 【基準情境】T+1 次日收盤基準 (Close to Close)', 'close', 'close', 0.0),
        ('2. 【真實開盤】T+1 次日開盤價成交 (Next-Day Open)', 'open', 'open', 0.0),
        ('3. 【追高滑價 1%】T+1 開盤追高 +1.0% 滑價成交', 'open_slip', 'open', 0.01),
        ('4. 【極度追高 2%】T+1 開盤追高 +2.0% 嚴重滑價', 'open_slip', 'open', 0.02),
        ('5. 【買在最差價】T+1 當天「最高價」(High) 買入！', 'high', 'close', 0.0),
        ('6. 【地獄雙最差】買在當天最高 (High) + 賣在當天最低 (Low)！', 'high', 'low', 0.0),
    ]

    results = []
    for name, ent, ext, slp in scenarios:
        print(f"[*] 正在模擬: {name}...")
        res = simulate(ent, ext, slp)
        res['name'] = name
        results.append(res)

    print("\n" + "="*110)
    print("⚡ 泰坦王權主宰旗艦版 (Option A) 最差成交價與極端滑價真實壓力測試總表 ⚡")
    print("="*110)
    header = f"{'情境名稱':<38} | {'10年累積':<10} | {'獲利倍數':<8} | {'CAGR':<7} | {'MDD':<8} | {'2024年':<8} | {'王者勝率':<8} | {'全勝率':<7} | {'盈虧比':<6}"
    print(header)
    print("-" * 110)
    for r in results:
        print(f"{r['name']:<36} | {r['total_ret']:>8.1f}% | {r['multiple']:>6.1f}x | {r['cagr']:>5.1f}% | {r['mdd']:>6.1f}% | {r['ret_2024']:>6.1f}% | {r['leader_win_rate']:>6.1f}% | {r['win_rate']:>5.1f}% | {r['profit_factor']:>5.2f}")
    print("="*110)
