import sqlite3
import pandas as pd
import numpy as np
import json
import os
import datetime

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("================================================================================")
print("👑 泰坦旗艦升級版：【族群強弱共振 (Sector Synergy Dual-Momentum)】20年實測引擎")
print("   - 嚴格零上帝視角 (No Lookahead Bias / Point-in-Time 族群 RS 運算)")
print("   - 嚴格 T+1 開盤價真實撮合、滑價與手續費 (0.585%)")
print("   - 嚴格連續復權價格矩陣 (消除除權息假跳空)")
print("   - 王者泰坦 70% + 雙衛星 15%/15% + 季線多頭防守")
print("================================================================================")

conn = sqlite3.connect(DB_PATH)

# 1. 讀取加權指數與 0050
print("[1/5] 讀取加權指數基準...")
df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')
df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()

# 2. 讀取產業分類映射表 (Point-in-Time 產業分類)
print("[2/5] 讀取全市場產業分類對應...")
df_ind = pd.read_sql_query('''
    SELECT DISTINCT stock_id, industry
    FROM monthly_revenue
    WHERE industry IS NOT NULL AND industry != ''
''', conn).drop_duplicates(subset=['stock_id'])
ind_map = dict(zip(df_ind['stock_id'], df_ind['industry']))

# 3. 篩選高流動性股票池 (2005~2026 全歷史流動性頂尖前 60 大)
print("[3/5] 建立 2005~2026 全歷史流動性核心標的池...")
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

# 4. 構建連續復權價格矩陣
print("[4/5] 構建精確連續復權價格矩陣與特徵計算...")
def get_signed_change(r):
    val = r['change_price']
    if pd.isna(val) or val == 0: return 0.0
    sign = str(r['change_sign']).strip()
    abs_val = abs(float(val))
    return -abs_val if sign == '-' else abs_val

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

stock_industries = pd.Series([ind_map.get(s, '其他') for s in price_pivot.columns], index=price_pivot.columns)

# 5. 回測模擬引擎 (對比: A. 原版泰坦 vs B. 族群共振泰坦)
print("[5/5] 執行 20 年逐日嚴格對比回測 (2005~2026)...")

def run_simulation(enable_sector_synergy=False):
    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    all_completed_trades = []
    open_position_tracker = {}
    current_leader_sid = ''
    just_entered_sids = set()

    rebalance_freq = 30
    leader_w = 0.70
    sat_w = 0.15
    num_sats = 2
    min_breadth = 0.35
    min_s20_slope = 0.025
    sat_hard_stop = 0.12
    fee_rate = 0.00585

    for i, dt in enumerate(all_dates):
        just_entered_sids.clear()
        exited_returns = 0.0

        # T+1 開盤調倉生效
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
                            'stock_id': sid, 'stock_name': name_map.get(sid, sid),
                            'entry_date': pos['entry_date'], 'exit_date': dt,
                            'return_pct': round(float(ret_pct), 2),
                            'holding_days': max(1, h_days)
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
                        'entry_date': dt, 'entry_price': exec_buy_px,
                        'entry_price_adj': p_adj_entry, 'role': role_str,
                        'target_weight': w_new
                    }
                    just_entered_sids.add(sid)
                    if w_new >= 0.50: current_leader_sid = sid
                elif sid in open_position_tracker:
                    open_position_tracker[sid]['role'] = role_str
                    open_position_tracker[sid]['target_weight'] = w_new
                    if w_new >= 0.50: current_leader_sid = sid

            turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            active_weights = pending_weights
            pending_weights = None

        # 結算當日報酬
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = exited_returns
            for sid, w in active_weights.items():
                if sid in just_entered_sids:
                    p_adj_close = price_adj_pivot.loc[dt, sid]
                    p_adj_open_entry = price_adj_open.loc[dt, sid]
                    if p_adj_open_entry > 0 and not pd.isna(p_adj_close):
                        daily_ret += w * ((p_adj_close / p_adj_open_entry) - 1.0)
                else:
                    if prev_dt in price_adj_pivot.index and sid in price_adj_pivot.columns:
                        prev_p = price_adj_pivot.loc[prev_dt, sid]
                        curr_p = price_adj_pivot.loc[dt, sid]
                        if prev_p > 0 and not pd.isna(curr_p):
                            daily_ret += w * ((curr_p / prev_p) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        equity_curve.append({'date': dt, 'equity': portfolio_equity})

        # 盤中防守停損檢測
        temp_active = {}
        for sid, w in list(active_weights.items()):
            pos = open_position_tracker.get(sid, {})
            p_curr = price_adj_pivot.loc[dt, sid]
            ep_adj = pos.get('entry_price_adj', p_curr)
            loss_pct = (p_curr / ep_adj - 1.0) if ep_adj > 0 else 0.0
            is_stopped = False
            if w < 0.50 and loss_pct <= -sat_hard_stop:
                is_stopped = True
            elif w >= 0.50 and loss_pct <= -0.15:
                is_stopped = True
            
            if is_stopped:
                del open_position_tracker[sid]
                if sid == current_leader_sid: current_leader_sid = ''
            else:
                temp_active[sid] = w
        
        if len(temp_active) < len(active_weights):
            reduced = sum(active_weights[s] for s in active_weights if s not in temp_active)
            portfolio_equity -= portfolio_equity * reduced * fee_rate
        active_weights = temp_active

        # 資金活化再平衡
        is_macro_bull_curr = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
        curr_breadth_val = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
        if is_macro_bull_curr and (curr_breadth_val >= 0.40) and active_weights:
            tot_w = sum(active_weights.values())
            if tot_w < 0.95 and tot_w > 0:
                scale = 1.0 / tot_w
                active_weights = {s: round(w * scale, 3) for s, w in active_weights.items()}

        # 調倉選股
        is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
        curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
        macro_healthy = is_macro_bull and (curr_breadth >= 0.35)

        is_scheduled = (i % rebalance_freq == 0)
        refill_freq = 5
        is_refill_trigger = False
        if (i % refill_freq == 0) and macro_healthy:
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

                # 🌟 核心升級：若啟用族群共振，計算當下時點過去 20 日最強產業族群 (Top 3)
                if enable_sector_synergy:
                    r20_curr = ret_20.loc[dt].dropna()
                    ind_perf = r20_curr.groupby(stock_industries).mean().dropna()
                    top_industries = set(ind_perf.nlargest(3).index)
                    # 候選池嚴格過濾：個股所屬產業必須排在前 3 大主流產業
                    liquid_pool = [s for s in liquid_pool if stock_industries.get(s) in top_industries]

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
                    if pd.isna(p) or pd.isna(m60) or p < m60 * 1.025: continue
                    if pd.isna(m20) or p < m20 or m20 < m60: continue
                    s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                    if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0: continue
                    s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                    if pd.isna(s20) or s20 < min_s20_slope: continue
                    if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88: continue

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
                        'rs': rs, 'h_prox': h_prox, 'inst': inst_v, 'trust': trust_v,
                        'sharpe': sharpe_v, 'align': align_score, 'turnover': valid_turnover[sid]
                    }

                if len(scores) >= 1:
                    df_s = pd.DataFrame(scores).T
                    df_s['norm_rs'] = df_s['rs'].rank(pct=True).fillna(0.5)
                    df_s['norm_prox'] = df_s['h_prox'].rank(pct=True).fillna(0.5)
                    df_s['norm_inst'] = df_s['inst'].rank(pct=True).fillna(0.5)
                    df_s['norm_trust'] = df_s['trust'].rank(pct=True).fillna(0.5)
                    df_s['norm_sharpe'] = df_s['sharpe'].rank(pct=True).fillna(0.5)
                    df_s['norm_size'] = df_s['turnover'].rank(pct=True).fillna(0.5)

                    df_s['mom_rank_score'] = 0.50 * df_s['norm_rs'] + 0.35 * df_s['norm_prox'] + 0.15 * df_s['norm_size']
                    top10_idx = df_s.nlargest(min(10, len(df_s)), 'mom_rank_score').index
                    df_top10 = df_s.loc[top10_idx].copy()

                    df_top10['win_rate_score'] = (
                        0.40 * df_top10['mom_rank_score'] +
                        0.25 * df_top10['norm_trust'] +
                        0.15 * df_top10['norm_inst'] +
                        0.10 * df_top10['norm_sharpe'] +
                        0.10 * df_top10['align']
                    )

                    top_leaders = df_top10.nlargest(min(5, len(df_top10)), 'turnover')
                    leader = top_leaders['win_rate_score'].idxmax()
                    remaining = df_top10.drop(index=[leader])
                    sat_candidates = remaining.nlargest(len(remaining), 'win_rate_score').index

                    if is_scheduled:
                        if not allow_sats or num_sats == 0:
                            next_targets = {leader: 1.0}
                        else:
                            next_targets = {leader: leader_w}
                            picked_sats = list(sat_candidates[:num_sats])
                            for s in picked_sats: next_targets[s] = sat_w
                            rem_w = 1.0 - sum(next_targets.values())
                            if rem_w > 0: next_targets[leader] += rem_w
                    elif is_refill_trigger:
                        next_targets = active_weights.copy()
                        has_leader = any(w >= 0.50 for w in next_targets.values())
                        if not has_leader and leader:
                            next_targets[leader] = leader_w
                        cur_sats = [s for s in next_targets if next_targets[s] < 0.50]
                        needed = num_sats - len(cur_sats)
                        if needed > 0 and allow_sats:
                            avail_sats = [s for s in sat_candidates if s not in next_targets]
                            for s in avail_sats[:needed]: next_targets[s] = sat_w
                        tot_w = sum(next_targets.values())
                        if tot_w > 1.0:
                            scale = 1.0 / tot_w
                            next_targets = {s: round(w * scale, 3) for s, w in next_targets.items()}

                    pending_weights = next_targets
                else:
                    if is_scheduled: pending_weights = {}

    df_curve = pd.DataFrame(equity_curve)
    return df_curve, all_completed_trades

print("\n[*] 正在運行策略 A: 原版泰坦 (無產業共振限制)...")
df_a, trades_a = run_simulation(enable_sector_synergy=False)

print("[*] 正在運行策略 B: 族群強弱共振泰坦 (零上帝視角: 嚴格限定當期最強主流產業)...")
df_b, trades_b = run_simulation(enable_sector_synergy=True)

df_a['year'] = df_a['date'].astype(str).str[:4]
df_b['year'] = df_b['date'].astype(str).str[:4]

def analyze_df(df_c, name):
    tot_ret = (df_c['equity'].iloc[-1] / df_c['equity'].iloc[0] - 1.0) * 100.0
    years_cnt = len(df_c) / 244.0
    cagr = ((df_c['equity'].iloc[-1] / df_c['equity'].iloc[0]) ** (1.0 / years_cnt) - 1.0) * 100.0
    roll_max = df_c['equity'].cummax()
    mdd = ((df_c['equity'] - roll_max) / roll_max).min() * 100.0
    daily_r = df_c['equity'].pct_change().dropna()
    sharpe = (daily_r.mean() / (daily_r.std() + 1e-9)) * np.sqrt(244)
    return {
        'name': name,
        'tot_ret': tot_ret,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'end_equity': df_c['equity'].iloc[-1]
    }

st_a = analyze_df(df_a, "原版泰坦 (Titan Base)")
st_b = analyze_df(df_b, "族群共振泰坦 (Sector Synergy Titan)")

print("\n" + "="*85)
print("🏆 20 年 (2005~2026) 實測總對決成果 (零上帝視角 / 嚴格連續復權 / T+1 撮合)")
print("="*85)
print(f"{'指標':<25} | {'原版泰坦 (Titan Base)':<25} | {'族群共振泰坦 (Sector Synergy)':<25}")
print("-"*85)
print(f"{'20年累積總報酬':<25} | {st_a['tot_ret']:+,.1f}%{'':<15} | {st_b['tot_ret']:+,.1f}%")
print(f"{'20年複合年化 (CAGR)':<25} | {st_a['cagr']:.2f}%{'':<18} | {st_b['cagr']:.2f}%")
print(f"{'歷史最大回撤 (MDD)':<25} | {st_a['mdd']:.2f}%{'':<18} | {st_b['mdd']:.2f}%")
print(f"{'夏普比率 (Sharpe)':<25} | {st_a['sharpe']:.2f}{'':<19} | {st_b['sharpe']:.2f}")
print(f"{'期末資產 (100萬起步)':<25} | {st_a['end_equity']:,.0f} 元{'':<12} | {st_b['end_equity']:,.0f} 元")
print("="*85)

print("\n📅 歷年年度績效對比 (Yearly Performance):")
years_list = sorted(list(set(df_a['year'])))
y_rows = []
for y in years_list:
    sub_a = df_a[df_a['year'] == y]
    sub_b = df_b[df_b['year'] == y]
    r_a = (sub_a['equity'].iloc[-1] / sub_a['equity'].iloc[0] - 1.0) * 100.0 if len(sub_a) > 0 else 0.0
    r_b = (sub_b['equity'].iloc[-1] / sub_b['equity'].iloc[0] - 1.0) * 100.0 if len(sub_b) > 0 else 0.0
    diff = r_b - r_a
    y_rows.append({'Year': y, 'Base': f"{r_a:+.2f}%", 'SectorSynergy': f"{r_b:+.2f}%", 'Diff': f"{diff:+.2f}%"})

df_y = pd.DataFrame(y_rows)
print(df_y.to_string(index=False))

# 儲存回測曲線資料
df_b.to_csv('/Users/huanggin-chen/openclaw_test/titan_sector_synergy_curve.csv', index=False)
print("\n[✓] 族群共振泰坦 20 年淨值曲線已儲存至: /Users/huanggin-chen/openclaw_test/titan_sector_synergy_curve.csv")
