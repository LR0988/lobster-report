import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
conn = sqlite3.connect(DB_PATH)

df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')
df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()

years = [str(y) for y in range(2005, 2027)]
top_stocks = set()
for yr in years:
    df_yr = pd.read_sql_query(f'''
        SELECT stock_id
        FROM daily_stock
        WHERE date >= "{yr}0101" AND date <= "{yr}1231"
          AND LENGTH(stock_id) = 4 AND stock_id GLOB '[0-9][0-9][0-9][0-9]'
          AND stock_id NOT LIKE '00%'
        GROUP BY stock_id
        ORDER BY SUM(trade_value) DESC
        LIMIT 60
    ''', conn)
    top_stocks.update(df_yr['stock_id'].tolist())

sids = list(top_stocks)
placeholders = ','.join(['?']*len(sids))

df_px = pd.read_sql_query(f'''
    SELECT date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_value, change_sign, change_price
    FROM daily_stock
    WHERE stock_id IN ({placeholders}) AND date >= "20050101"
''', conn, params=sids)

df_inst = pd.read_sql_query(f'''
    SELECT date, stock_id, foreign_net, trust_net
    FROM institutional_trades
    WHERE stock_id IN ({placeholders}) AND date >= "20050101"
''', conn, params=sids)
conn.close()

def get_signed_change(r):
    val = r['change_price']
    if pd.isna(val) or val == 0:
        return 0.0
    sign = str(r['change_sign']).strip()
    abs_val = abs(float(val))
    if sign == '-':
        return -abs_val
    elif sign == '+':
        return abs_val
    else:
        return float(val)

df_px['signed_change'] = df_px.apply(get_signed_change, axis=1)
df_px['ref_price'] = df_px['closing_price'] - df_px['signed_change']

price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
change_pivot = df_px.pivot(index='date', columns='stock_id', values='signed_change').sort_index().fillna(0)
ref_pivot = df_px.pivot(index='date', columns='stock_id', values='ref_price').sort_index().fillna(price_pivot)
price_open = df_px.pivot(index='date', columns='stock_id', values='opening_price').sort_index().ffill().combine_first(price_pivot)
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

prev_price = price_pivot.shift(1)
raw_ret = (price_pivot / prev_price) - 1.0

ex_div_mask = (raw_ret < -0.075) & ((change_pivot / ref_pivot) > raw_ret + 0.05)
adj_ret = raw_ret.copy()
adj_ret[ex_div_mask] = (change_pivot[ex_div_mask] / ref_pivot[ex_div_mask]).clip(-0.10, 0.10)

cum_factors = (1.0 + adj_ret.fillna(0.0)).cumprod()
last_prices = price_pivot.ffill().iloc[-1].fillna(100.0)
cum_last = cum_factors.iloc[-1].replace(0, np.nan).fillna(1.0)
price_adj_pivot = cum_factors.div(cum_last) * last_prices

open_ratio = (price_open / price_pivot).fillna(1.0).clip(0.5, 2.0)
price_adj_open = price_adj_pivot * open_ratio

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)
trust_pivot = df_inst.pivot(index='date', columns='stock_id', values='trust_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)

name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()
all_dates = [d for d in price_pivot.index if d >= '20050401']

ma5_pivot = price_adj_pivot.rolling(5, min_periods=3).mean()
ma10_pivot = price_adj_pivot.rolling(10, min_periods=5).mean()
ma20_pivot = price_adj_pivot.rolling(20, min_periods=10).mean()
ma60_pivot = price_adj_pivot.rolling(60, min_periods=20).mean()
ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)
ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
high60_pivot = price_adj_pivot.rolling(60, min_periods=20).max()

ret_20 = price_adj_pivot.pct_change(20, fill_method=None)
ret_60 = price_adj_pivot.pct_change(60, fill_method=None)
ret_120 = price_adj_pivot.pct_change(120, fill_method=None)

vol_60 = adj_ret.rolling(60, min_periods=20).std()
sharpe_rs_pivot = ret_60 / (vol_60 * np.sqrt(60) + 1e-5)

taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()
rolling_trust_20 = trust_pivot.rolling(20, min_periods=10).sum()
breadth_ma20 = (price_adj_pivot >= ma20_pivot).astype(int).mean(axis=1)

def run_simulation(strategy_mode='stage2_top10', refill_freq=5, enable_refill=True, dynamic_rebalance=True):
    rebalance_freq = 30
    leader_w = 0.70
    sat_w = 0.15
    num_sats = 2
    min_breadth = 0.35
    min_s20_slope = 0.025
    sat_hard_stop = 0.12
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
        exited_returns = 0.0

        if pending_weights is not None:
            prev_dt = all_dates[i-1] if i > 0 else dt
            for sid, w_old in list(active_weights.items()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        exit_px = price_open.loc[dt, sid]
                        p_adj_exit = price_adj_open.loc[dt, sid]
                        ep_adj = pos.get('entry_price_adj', p_adj_exit)
                        entry_px = pos['entry_price']
                        ret_pct = (p_adj_exit / ep_adj - 1.0) * 100.0 if ep_adj > 0 else 0.0
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
                            'exit_reason': '🔄 波段常態輪動平倉',
                        })
                        del open_position_tracker[sid]
                        if prev_dt in price_adj_pivot.index and sid in price_adj_pivot.columns:
                            prev_p_adj = price_adj_pivot.loc[prev_dt, sid]
                            if prev_p_adj > 0:
                                exited_returns += w_old * ((p_adj_exit / prev_p_adj) - 1.0)
                    if sid == current_leader_sid:
                        current_leader_sid = ''

            for sid, w_new in pending_weights.items():
                role_str = '👑 王者泰坦 (70%)' if w_new >= 0.50 else '🚀 革命衛星 (15%)'
                exec_buy_px = price_open.loc[dt, sid]
                p_adj_entry = price_adj_open.loc[dt, sid]
                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': exec_buy_px,
                        'entry_price_adj': p_adj_entry,
                        'role': role_str,
                        'target_weight': w_new,
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

        if i > 0:
            daily_ret = exited_returns
            for sid, w in active_weights.items():
                if sid in just_entered_sids:
                    p_adj_close = price_adj_pivot.loc[dt, sid]
                    p_adj_open_entry = price_adj_open.loc[dt, sid]
                    if p_adj_open_entry > 0 and not pd.isna(p_adj_close):
                        daily_ret += w * ((p_adj_close / p_adj_open_entry) - 1.0)
                else:
                    if sid in adj_ret.columns and not pd.isna(adj_ret.loc[dt, sid]):
                        daily_ret += w * adj_ret.loc[dt, sid]
            portfolio_equity *= (1.0 + daily_ret)

        # 停損
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p_adj = price_adj_pivot.loc[dt, sid]
                ma60 = ma60_pivot.loc[dt, sid]
                pos = open_position_tracker.get(sid, {})
                ep_adj = pos.get('entry_price_adj', p_adj)
                is_leader = (w >= 0.50)

                should_stop = False
                reason_str = ''

                if not pd.isna(p_adj) and not pd.isna(ma60) and p_adj < ma60:
                    should_stop = True
                    reason_str = '🛡️ 跌破季線 (60MA) 防禦停損'
                elif not is_leader and sat_hard_stop is not None and ep_adj > 0:
                    if (p_adj / ep_adj - 1.0) < -sat_hard_stop:
                        should_stop = True
                        reason_str = '⚡ 衛星觸發 -12% 停損線 (及時斷尾)'

                if should_stop:
                    if sid in open_position_tracker:
                        exit_px = price_pivot.loc[dt, sid]
                        entry_px = pos['entry_price']
                        ret_pct = (p_adj / ep_adj - 1.0) * 100.0 if ep_adj > 0 else 0.0
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
                            'exit_reason': reason_str,
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

            # 若開啟在席再平衡，且尚無 Refill 或作為 Refill 輔助
            if dynamic_rebalance:
                is_macro_bull_curr = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
                curr_breadth_val = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
                if is_macro_bull_curr and (curr_breadth_val >= 0.40) and active_weights:
                    tot_w = sum(active_weights.values())
                    if tot_w < 0.95 and tot_w > 0:
                        scale = 1.0 / tot_w
                        active_weights = {s: round(w * scale, 3) for s, w in active_weights.items()}
                        for s, new_w in active_weights.items():
                            if s in open_position_tracker:
                                open_position_tracker[s]['target_weight'] = new_w

        is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
        curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
        macro_healthy = is_macro_bull and (curr_breadth >= 0.35)

        is_scheduled = (i % rebalance_freq == 0)
        
        # 🚀 遞補檢查：有空位且多頭健康
        is_refill_trigger = False
        if enable_refill and (i % refill_freq == 0) and macro_healthy:
            has_leader = any(w >= 0.50 for w in active_weights.values())
            cur_sats = len([s for s in active_weights if active_weights[s] < 0.50])
            if (not has_leader) or (cur_sats < num_sats):
                is_refill_trigger = True

        if is_scheduled or is_refill_trigger:
            if not is_macro_bull:
                next_targets = {}
            else:
                allow_sats = (curr_breadth >= min_breadth)
                valid_turnover = rolling_turnover_60.loc[dt].dropna()
                liquid_pool = valid_turnover.nlargest(50).index

                scores = {}
                for sid in liquid_pool:
                    p = price_adj_pivot.loc[dt, sid]
                    m60 = ma60_pivot.loc[dt, sid]
                    m20 = ma20_pivot.loc[dt, sid]
                    m10 = ma10_pivot.loc[dt, sid]
                    m5 = ma5_pivot.loc[dt, sid]
                    r20 = ret_20.loc[dt, sid]
                    r60 = ret_60.loc[dt, sid]
                    r120_raw = ret_120.loc[dt, sid]
                    r120 = r60 if (pd.isna(r120_raw) or not np.isfinite(r120_raw)) else r120_raw
                    h60 = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p
                    if pd.isna(p) or pd.isna(m60) or p < m60 * 1.025:
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

                    t60 = taiex_ret60.loc[dt] if (dt in taiex_ret60.index and pd.notna(taiex_ret60.loc[dt])) else 0.0
                    t20 = taiex_ret20.loc[dt] if (dt in taiex_ret20.index and pd.notna(taiex_ret20.loc[dt])) else 0.0
                    t120_raw = taiex_ret120.loc[dt] if (dt in taiex_ret120.index and pd.notna(taiex_ret120.loc[dt])) else t60
                    t120 = t60 if (pd.isna(t120_raw) or not np.isfinite(t120_raw)) else t120_raw

                    rs = (r20 - t20)*0.30 + (r60 - t60)*0.40 + (r120 - t120)*0.30
                    h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
                    inst_v = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and dt in rolling_inst_20.index) else 0.0
                    trust_v = rolling_trust_20.loc[dt, sid] if (sid in rolling_trust_20.columns and dt in rolling_trust_20.index) else 0.0
                    sharpe_v = sharpe_rs_pivot.loc[dt, sid] if (sid in sharpe_rs_pivot.columns and not pd.isna(sharpe_rs_pivot.loc[dt, sid])) else 0.0
                    align_score = 1.0 if (not pd.isna(m5) and not pd.isna(m10) and m5 >= m10 and m10 >= m20) else 0.0

                    scores[sid] = {
                        'rs': rs,
                        'h_prox': h_prox,
                        'inst': inst_v,
                        'trust': trust_v,
                        'sharpe': sharpe_v,
                        'align': align_score,
                        'turnover': valid_turnover[sid]
                    }

                if len(scores) >= 1:
                    df_s = pd.DataFrame(scores).T
                    df_s['norm_rs'] = df_s['rs'].rank(pct=True).fillna(0.5)
                    df_s['norm_prox'] = df_s['h_prox'].rank(pct=True).fillna(0.5)
                    df_s['norm_inst'] = df_s['inst'].rank(pct=True).fillna(0.5)
                    df_s['norm_trust'] = df_s['trust'].rank(pct=True).fillna(0.5)
                    df_s['norm_sharpe'] = df_s['sharpe'].rank(pct=True).fillna(0.5)
                    df_s['norm_size'] = df_s['turnover'].rank(pct=True).fillna(0.5)

                    if strategy_mode == 'benchmark_option_a':
                        # 基準 Option A: 單階段 Titan Score
                        df_s['score'] = 0.50 * df_s['norm_rs'] + 0.25 * df_s['norm_inst'] + 0.15 * df_s['norm_prox'] + 0.10 * df_s['norm_size']
                        top_leaders = df_s.nlargest(min(5, len(df_s)), 'turnover')
                        leader = top_leaders['score'].idxmax()
                        remaining = df_s.drop(index=[leader])
                        sat_candidates = remaining.nlargest(len(remaining), 'score').index

                    elif strategy_mode == 'stage2_top10':
                        # 🎯 用戶指定：二階段架構
                        # 階段一：動能指標初篩 Top 10
                        df_s['mom_rank_score'] = 0.50 * df_s['norm_rs'] + 0.35 * df_s['norm_prox'] + 0.15 * df_s['norm_size']
                        top10_idx = df_s.nlargest(min(10, len(df_s)), 'mom_rank_score').index
                        df_top10 = df_s.loc[top10_idx].copy()
                        
                        # 階段二：在 Top 10 中評估高勝率指標 (投信認養 + 法人買超 + 均線多頭 + Sharpe-RS + 動能)
                        df_top10['win_rate_score'] = (
                            0.40 * df_top10['mom_rank_score'] +
                            0.25 * df_top10['norm_trust'] +
                            0.15 * df_top10['norm_inst'] +
                            0.10 * df_top10['norm_sharpe'] +
                            0.10 * df_top10['align']
                        )
                        # 從勝率評分最高的前幾名挑選王者（優先兼顧規模避免過度流動性衝擊）
                        top_leaders = df_top10.nlargest(min(5, len(df_top10)), 'turnover')
                        leader = top_leaders['win_rate_score'].idxmax()
                        remaining = df_top10.drop(index=[leader])
                        sat_candidates = remaining.nlargest(len(remaining), 'win_rate_score').index

                    elif strategy_mode == 'stage2_pure_winrate':
                        # 階段二高勝率純化版（王牌以純勝率選出，不限制 turnover）
                        df_s['mom_rank_score'] = 0.50 * df_s['norm_rs'] + 0.35 * df_s['norm_prox'] + 0.15 * df_s['norm_size']
                        top10_idx = df_s.nlargest(min(10, len(df_s)), 'mom_rank_score').index
                        df_top10 = df_s.loc[top10_idx].copy()
                        
                        df_top10['win_rate_score'] = (
                            0.35 * df_top10['norm_rs'] +
                            0.30 * df_top10['norm_trust'] +
                            0.15 * df_top10['norm_inst'] +
                            0.10 * df_top10['norm_sharpe'] +
                            0.10 * df_top10['align']
                        )
                        leader = df_top10['win_rate_score'].idxmax()
                        remaining = df_top10.drop(index=[leader])
                        sat_candidates = remaining.nlargest(len(remaining), 'win_rate_score').index

                    if is_scheduled:
                        if not allow_sats or num_sats == 0:
                            next_targets = {leader: 1.0}
                        else:
                            if active_weights:
                                current_sats = [s for s in active_weights if s != leader and s in scores and price_adj_pivot.loc[dt, s] >= ma20_pivot.loc[dt, s]]
                                needed = num_sats - len(current_sats)
                                new_candidates = [s for s in sat_candidates if s not in current_sats]
                                satellites = (current_sats + new_candidates)[:num_sats]
                            else:
                                satellites = sat_candidates[:num_sats].tolist()
                            next_targets = {leader: leader_w}
                            for sat in satellites:
                                next_targets[sat] = sat_w
                    else:
                        # 🚀 動態遞補（消除空窗期）：保留在席強勢股，填補空缺
                        next_targets = dict(active_weights)
                        has_leader = any(w >= 0.50 for w in active_weights.values())
                        if not has_leader:
                            if leader not in next_targets:
                                next_targets[leader] = leader_w
                            else:
                                if len(sat_candidates) > 0:
                                    next_targets[sat_candidates[0]] = leader_w
                        cur_sats = [s for s in next_targets if next_targets[s] < 0.50]
                        needed_sats = num_sats - len(cur_sats)
                        if needed_sats > 0 and allow_sats:
                            avail = [s for s in sat_candidates if s not in next_targets]
                            for c in avail[:needed_sats]:
                                next_targets[c] = sat_w
                else:
                    next_targets = {} if is_scheduled else dict(active_weights)
            pending_weights = next_targets

        equity_curve.append(portfolio_equity)

    df_curve = pd.DataFrame({'date': all_dates, 'equity': equity_curve})
    final_eq = df_curve['equity'].iloc[-1]
    years_span = len(all_dates) / 242.0
    cagr = ((final_eq / 1000000.0) ** (1.0 / years_span) - 1.0) * 100.0
    peak = df_curve['equity'].cummax()
    mdd = (((df_curve['equity'] - peak) / peak) * 100.0).min()
    daily_rets = df_curve['equity'].pct_change().dropna()
    sharpe = float((daily_rets.mean() / daily_rets.std()) * np.sqrt(242)) if daily_rets.std() > 0 else 0.0
    
    trades_win = [t for t in all_completed_trades if t['return_pct'] > 0]
    win_rate = len(trades_win) / len(all_completed_trades) * 100.0 if all_completed_trades else 0.0
    sum_win = sum(t['return_pct'] for t in all_completed_trades if t['return_pct'] > 0)
    sum_loss = abs(sum(t['return_pct'] for t in all_completed_trades if t['return_pct'] < 0))
    profit_factor = sum_win / sum_loss if sum_loss > 0 else 0.0

    return {
        'total_ret': ((final_eq - 1000000.0) / 1000000.0) * 100.0,
        'final_mult': final_eq / 1000000.0,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'trades_cnt': len(all_completed_trades),
        'trades_win_cnt': len(trades_win)
    }

print("=== 對比實驗開始 ===")
modes = [
    ('Option A 基準 (原單階段, 30天輪動, 席位再平衡)', 'benchmark_option_a', False, 30, True),
    ('Option A 基準 + 週度遞補 (消除空窗期)', 'benchmark_option_a', True, 5, True),
    ('二階段選股 (Top 10 初篩 + 高勝率複選, 30天調倉)', 'stage2_top10', False, 30, True),
    ('二階段選股 + 週度動態遞補 (消除空窗期, 每5日補倉)', 'stage2_top10', True, 5, True),
    ('二階段選股 + 極速動態遞補 (消除空窗期, 每2日補倉)', 'stage2_top10', True, 2, True),
    ('二階段純勝率精選 + 週度動態遞補', 'stage2_pure_winrate', True, 5, True),
]

for label, mode, refill, r_freq, dyn_reb in modes:
    res = run_simulation(strategy_mode=mode, refill_freq=r_freq, enable_refill=refill, dynamic_rebalance=dyn_reb)
    print(f"\n[{label}]")
    print(f"總報酬: +{res['total_ret']:,.1f}% ({res['final_mult']:.1f}倍) | CAGR: {res['cagr']:.2f}% | MDD: {res['mdd']:.2f}% | Sharpe: {res['sharpe']:.2f} | 勝率: {res['win_rate']:.2f}% | 交易數: {res['trades_cnt']} (勝: {res['trades_win_cnt']}) | 盈虧比: {res['profit_factor']:.2f}")
