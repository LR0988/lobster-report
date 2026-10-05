import sqlite3
import pandas as pd
import numpy as np
import json
import os

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def run():
    print("[*] 正在以 Titan 40_30_30 (40% 泰坦 + 30/30 雙衛星) 架構執行全量產出...")
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
            LIMIT 50
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
    
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    ret_120 = price_pivot.pct_change(120, fill_method=None)
    ret_250 = price_pivot.pct_change(250, fill_method=None)
    taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)
    rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
    rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()
    
    rebalance_freq = 20
    portfolio_equity = 1000000.0
    equity_curve = []
    
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585
    
    all_completed_trades = []
    open_position_tracker = {} # sid -> {entry_date, entry_price, role, weight}
    current_leader_sid = ''
    
    for i, dt in enumerate(all_dates):
        # 1. 執行前一日產生的調倉指令 (T+1 開盤生效)
        if pending_weights is not None:
            # 檢查要出場的股票 (active 中有但 pending 中沒有，或權重變為 0)
            for sid, w_old in active_weights.items():
                if sid not in pending_weights:
                    # 賣出記錄
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
                            'exit_reason': '🔄 月度常態換股輪動'
                        })
                        del open_position_tracker[sid]
            
            # 檢查新買入的股票
            for sid, w_new in pending_weights.items():
                if sid not in active_weights:
                    role_str = '👑 王者泰坦 (40%)' if w_new >= 0.35 else '🚀 革命衛星 (30%)'
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': price_pivot.loc[dt, sid],
                        'role': role_str,
                        'target_weight': w_new
                    }
                    if w_new >= 0.35:
                        current_leader_sid = sid
                elif sid in open_position_tracker:
                    # 若權重或角色改變
                    role_str = '👑 王者泰坦 (40%)' if w_new >= 0.35 else '🚀 革命衛星 (30%)'
                    open_position_tracker[sid]['role'] = role_str
                    open_position_tracker[sid]['target_weight'] = w_new
                    if w_new >= 0.35:
                        current_leader_sid = sid

            # 計算換手摩擦
            turnover = 0.0
            all_sids = set(list(active_weights.keys()) + list(pending_weights.keys()))
            for sid in all_sids:
                w_old = active_weights.get(sid, 0.0)
                w_new = pending_weights.get(sid, 0.0)
                turnover += abs(w_new - w_old)
            turnover /= 2.0
            
            fee = portfolio_equity * turnover * fee_rate
            portfolio_equity -= fee
            active_weights = pending_weights
            pending_weights = None
            
        # 2. 結算當日淨值變化
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = 0.0
            for sid, w in active_weights.items():
                p_now = price_pivot.loc[dt, sid]
                p_prev = price_pivot.loc[prev_dt, sid]
                if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                    daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)
            
        # 3. 每日收盤檢查季線防守：若收盤跌破自身 60MA，退場停損轉回現金
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_pivot.loc[dt, sid]
                ma = ma60_pivot.loc[dt, sid]
                if not pd.isna(p) and not pd.isna(ma) and p < ma:
                    # 跌破 60MA 停損
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
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
                            'exit_reason': '🛡️ 跌破季線 (60MA) 防禦停損'
                        })
                        del open_position_tracker[sid]
                    if sid == current_leader_sid:
                        current_leader_sid = ''
                else:
                    temp_active[sid] = w
            active_weights = temp_active
            
        # 4. 定期產生調倉目標 (每 20 交易日)
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
                    sdf['titan_score'] = (
                        0.40 * sdf['norm_rs'] +
                        0.25 * sdf['norm_inst'] +
                        0.20 * sdf['norm_pe'] +
                        0.15 * sdf['norm_size']
                    )
                    
                    top5_scale = sdf.nlargest(5, 'turnover')
                    sovereign_leader = top5_scale['titan_score'].idxmax()
                    
                    remaining = sdf.drop(index=[sovereign_leader])
                    satellites = remaining.nlargest(2, 'titan_score').index.tolist()
                    
                    # 👑 Titan 40_30_30 架構：40% 泰坦 + 30% / 30% 雙衛星
                    next_targets = {sovereign_leader: 0.40}
                    for sat in satellites:
                        next_targets[sat] = 0.30
                else:
                    next_targets = {}
                    
            pending_weights = next_targets
            
        cur_exposure = sum(active_weights.values())
        l_name = name_map.get(current_leader_sid, '') if current_leader_sid else ''
        equity_curve.append({
            'date': dt,
            'titan_equity': portfolio_equity,
            'exposure': round(cur_exposure, 2),
            'leader_sid': current_leader_sid,
            'leader_name': l_name
        })

    # 匯出 titan_sovereign_curve.csv
    df_curve = pd.DataFrame(equity_curve)
    p_curve = 'titan_sovereign_curve.csv'
    df_curve.to_csv(p_curve, index=False)
    print(f"[✓] 成功更新淨值曲線: {p_curve} (總筆數: {len(df_curve)})")
    
    # 匯出 titan_trades.json
    p_trades = 'titan_trades.json'
    with open(p_trades, 'w', encoding='utf-8') as f:
        json.dump(all_completed_trades, f, ensure_ascii=False, indent=2)
    print(f"[✓] 成功更新歷史交易紀錄: {p_trades} (已平倉筆數: {len(all_completed_trades)})")
    
    # 計算最新在倉部位 (Open Positions)
    last_dt = all_dates[-1]
    last_active = active_weights
    total_exp = sum(last_active.values())
    cash_res = 1.0 - total_exp
    open_positions = []
    for sid, w in last_active.items():
        pos = open_position_tracker.get(sid, {})
        e_date = pos.get('entry_date', '--')
        e_px = pos.get('entry_price', price_pivot.loc[last_dt, sid])
        curr_px = price_pivot.loc[last_dt, sid]
        ma60 = ma60_pivot.loc[last_dt, sid]
        unrealized = (curr_px / e_px - 1.0) * 100 if e_px > 0 else 0
        dist_ma60 = (curr_px / ma60 - 1.0) * 100 if ma60 > 0 else 0
        h_days = all_dates.index(last_dt) - all_dates.index(e_date) if (e_date != '--' and e_date in all_dates) else 0
        role = '👑 王者泰坦 (40%)' if w >= 0.35 else '🚀 革命衛星 (30%)'
        open_positions.append({
            'stock_id': sid,
            'stock_name': name_map.get(sid, sid),
            'role': role,
            'target_weight_pct': int(w * 100),
            'entry_date': e_date,
            'entry_price': round(float(e_px), 2),
            'current_price': round(float(curr_px), 2),
            'unrealized_return_pct': round(float(unrealized), 2),
            'holding_days': h_days,
            'ma60_stop_price': round(float(ma60), 2),
            'dist_to_stop_pct': round(float(dist_ma60), 2),
            'stop_condition': f"收盤跌破季線 60MA (NT$ {ma60:.1f}) 則次日全數停損退回現金"
        })
        
    p_open = 'titan_open_positions.json'
    with open(p_open, 'w', encoding='utf-8') as f:
        json.dump({
            'as_of_date': last_dt,
            'total_exposure_pct': round(total_exp * 100, 1),
            'cash_reserve_pct': round(cash_res * 100, 1),
            'open_positions': open_positions
        }, f, ensure_ascii=False, indent=2)
    print(f"[✓] 成功更新當前在倉明細: {p_open} (持有檔數: {len(open_positions)})")

    # 指標統計
    tot_ret = (df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0] - 1) * 100
    peak = df_curve['titan_equity'].cummax()
    mdd = ((df_curve['titan_equity'] - peak) / peak * 100).min()
    rets = df_curve['titan_equity'].pct_change().dropna()
    years_cnt = len(df_curve) / 244.0
    cagr = ((df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0]) ** (1.0 / years_cnt) - 1) * 100
    ann_vol = rets.std() * np.sqrt(244)
    sharpe = (rets.mean() * 244) / ann_vol if ann_vol > 0 else 0
    calmar = cagr / abs(mdd) if mdd != 0 else 0
    
    idx_1y = all_dates.index('20251002') if '20251002' in all_dates else -244
    ret_1y = (df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[idx_1y] - 1) * 100
    
    print("\n" + "="*70)
    print("🏆 TITAN 40_30_30 (40% 泰坦 + 30/30 雙衛星) 更新成果")
    print("="*70)
    print(f"10年累積總報酬: +{tot_ret:,.2f}%")
    print(f"年化複合成長 (CAGR): +{cagr:.2f}%")
    print(f"近 1 年超額報酬: +{ret_1y:.2f}%")
    print(f"最大回撤 (MDD): {mdd:.2f}%")
    print(f"夏普比率 (Sharpe): {sharpe:.2f}")
    print(f"卡瑪比率 (Calmar): {calmar:.2f}")
    print(f"終端資產 (本金 100 萬): NT$ {df_curve['titan_equity'].iloc[-1]:,.0f}")
    print("="*70)

if __name__ == '__main__':
    run()
