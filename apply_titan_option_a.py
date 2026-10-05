import sqlite3
import pandas as pd
import numpy as np
import json
import os
import shutil

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    print("[*] 正在載入資料庫執行 Option A：泰坦王權主宰旗艦版 (Titan Sovereign Dominance 60/20/20) 回測...")
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
    df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
    inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).fillna(0)
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

    # 👑 Option A 核心配置參數
    rebalance_freq = 30     # 30 交易日波段調倉
    leader_w = 0.60         # 60% 王者泰坦
    sat_w = 0.20            # 20% / 20% 雙革命衛星
    num_sats = 2
    min_breadth = 0.40      # 市場廣度低於 40% 時收縮至 100% 王者巨頭
    min_s20_slope = 0.025   # 衛星須具備 20MA 向上 2.5% 爆發斜率
    sat_hard_stop = 0.18    # 衛星 18% 寬幅災難停損

    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585
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
                            'direction': '多方 (Long)',
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
                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': price_pivot.loc[dt, sid],
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
                p_now = price_pivot.loc[dt, sid]
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
                            'direction': '多方 (Long)',
                            'return_pct': round(float(ret_pct), 2),
                            'holding_days': max(1, h_days),
                            'exit_reason': reason_str
                        })
                        del open_position_tracker[sid]
                    if sid == current_leader_sid:
                        current_leader_sid = ''
                else:
                    temp_active[sid] = w
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
                        # 廣度不足時收縮至 100% 王者巨頭
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
        l_name = name_map.get(current_leader_sid, '') if current_leader_sid else ''
        equity_curve.append({
            'date': dt,
            'titan_equity': portfolio_equity,
            'taiex_close': df_taiex.loc[dt, 'close'] if dt in df_taiex.index else np.nan,
            'etf_0050_close': df_0050.loc[dt, 'close'] if dt in df_0050.index else np.nan,
            'market_exposure_pct': round(cur_exposure * 100, 1),
            'exposure': round(cur_exposure, 4),
            'cash_reserve_pct': round((1.0 - cur_exposure) * 100, 1),
            'leader_stock_id': current_leader_sid,
            'leader_stock_name': l_name,
            'leader_name': l_name
        })

    df_curve = pd.DataFrame(equity_curve)
    t0 = df_curve['taiex_close'].dropna().iloc[0]
    e0 = df_curve['etf_0050_close'].dropna().iloc[0]
    df_curve['benchmark_equity'] = (df_curve['taiex_close'] / t0) * 1000000.0
    df_curve['etf0050_equity'] = (df_curve['etf_0050_close'] / e0) * 1000000.0

    peak = df_curve['titan_equity'].cummax()
    df_curve['drawdown_pct'] = ((df_curve['titan_equity'] - peak) / peak) * 100.0

    # 計算統計指標
    total_ret = (df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0] - 1.0) * 100.0
    years = (pd.to_datetime(all_dates[-1]) - pd.to_datetime(all_dates[0])).days / 365.25
    cagr = (np.power(max(0.01, df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0]), 1.0 / years) - 1.0) * 100.0
    mdd = df_curve['drawdown_pct'].min()
    daily_rets = df_curve['titan_equity'].pct_change().dropna()
    sharpe = (daily_rets.mean() / (daily_rets.std() + 1e-9)) * np.sqrt(242)

    df_2024 = df_curve[df_curve['date'].str.startswith('2024')]
    ret_2024 = (df_2024.iloc[-1]['titan_equity'] / df_2024.iloc[0]['titan_equity'] - 1.0) * 100.0 if not df_2024.empty else 0.0

    wins = [t for t in all_completed_trades if t['return_pct'] > 0]
    losses = [t for t in all_completed_trades if t['return_pct'] <= 0]
    win_rate = len(wins) / len(all_completed_trades) * 100.0
    avg_win = sum(t['return_pct'] for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t['return_pct'] for t in losses) / len(losses) if losses else 0

    leader_trades = [t for t in all_completed_trades if '王者' in t['role']]
    sat_trades = [t for t in all_completed_trades if '衛星' in t['role']]
    l_wins = [t for t in leader_trades if t['return_pct'] > 0]
    s_wins = [t for t in sat_trades if t['return_pct'] > 0]
    wr_leader = len(l_wins) / len(leader_trades) * 100 if leader_trades else 0
    wr_sat = len(s_wins) / len(sat_trades) * 100 if sat_trades else 0

    print(f"\n=======================================================")
    print(f"👑 泰坦王權主宰旗艦版 (Option A: 60/20/20) 回測成果")
    print(f"=======================================================")
    print(f"10年累積總報酬: {total_ret:+,.2f}% (約 {total_ret/100+1:.1f} 倍)")
    print(f"年化 CAGR: {cagr:.2f}% | 夏普比率: {sharpe:.2f} | MDD: {mdd:.2f}%")
    print(f"2024 年實測績效: {ret_2024:+6.2f}%")
    print(f"全組合總勝率: {win_rate:.2f}% ({len(wins)} 勝 / {len(losses)} 敗，共 {len(all_completed_trades)} 筆)")
    print(f"👑 王者泰坦勝率: {wr_leader:.2f}% ({len(l_wins)}/{len(leader_trades)} 筆)")
    print(f"🚀 革命衛星勝率: {wr_sat:.2f}% ({len(s_wins)}/{len(sat_trades)} 筆)")
    print(f"平均獲利: +{avg_win:.2f}% / 平均虧損: {avg_loss:.2f}% (盈虧比: {abs(avg_win/avg_loss):.2f})")
    print(f"=======================================================\n")

    # 匯出 titan_sovereign_curve.csv
    df_curve.to_csv('titan_sovereign_curve.csv', index=False)
    print(f"[✓] 已更新 titan_sovereign_curve.csv (共 {len(df_curve)} 筆每日淨值紀錄)")

    # 匯出 titan_trades.json
    all_completed_trades.sort(key=lambda t: t['exit_date'])
    with open('titan_trades.json', 'w', encoding='utf-8') as f:
        json.dump(all_completed_trades, f, ensure_ascii=False, indent=2)
    with open('frontend/src/data/titan_trades.json', 'w', encoding='utf-8') as f:
        json.dump(all_completed_trades, f, ensure_ascii=False, indent=2)
    print(f"[✓] 已更新 titan_trades.json (共 {len(all_completed_trades)} 筆交易)")

    # 產出最新持倉 open_positions
    last_dt = all_dates[-1]
    open_positions = []
    for sid, pos in open_position_tracker.items():
        curr_px = float(price_pivot.loc[last_dt, sid])
        ent_px = float(pos['entry_price'])
        unreal_ret = (curr_px / ent_px - 1.0) * 100.0 if ent_px > 0 else 0.0
        ma60_val = float(ma60_pivot.loc[last_dt, sid])
        h_days = all_dates.index(last_dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
        dist_to_stop = (curr_px / ma60_val - 1.0) * 100.0 if ma60_val > 0 else 0.0

        open_positions.append({
            'stock_id': sid,
            'stock_name': name_map.get(sid, sid),
            'role': pos['role'],
            'target_weight_pct': int(pos['target_weight'] * 100),
            'entry_date': pos['entry_date'],
            'entry_price': round(ent_px, 2),
            'current_price': round(curr_px, 2),
            'unrealized_return_pct': round(unreal_ret, 2),
            'holding_days': h_days,
            'ma60_stop_price': round(ma60_val, 2),
            'dist_to_stop_pct': round(dist_to_stop, 2),
            'stop_condition': f"收盤跌破季線 60MA (NT$ {ma60_val:.1f}) 則次日全數停損退回現金"
        })

    open_positions.sort(key=lambda p: -p['target_weight_pct'])

    open_pos_payload = {
        'as_of_date': last_dt,
        'model_id': 'titan_sovereign',
        'model_name': '👑 泰坦王權主宰旗艦版 (Option A: 核心勝率66%・十年+9052%)',
        'cash_reserve_pct': round((1.0 - sum(p['target_weight_pct']/100 for p in open_positions)) * 100, 1),
        'market_exposure_pct': sum(p['target_weight_pct'] for p in open_positions),
        'total_positions_count': len(open_positions),
        'open_positions': open_positions
    }

    with open('titan_open_positions.json', 'w', encoding='utf-8') as f:
        json.dump(open_pos_payload, f, ensure_ascii=False, indent=2)
    with open('frontend/src/data/titan_open_positions.json', 'w', encoding='utf-8') as f:
        json.dump(open_pos_payload, f, ensure_ascii=False, indent=2)
    print(f"[✓] 已更新 titan_open_positions.json (當前持有 {len(open_positions)} 檔個股)")
    for p in open_positions:
        print(f"    - {p['stock_name']} ({p['stock_id']}): {p['role']}, 成本 {p['entry_price']}, 現價 {p['current_price']}, 浮盈 {p['unrealized_return_pct']:+}%")

if __name__ == '__main__':
    run()
