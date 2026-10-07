import sqlite3
import pandas as pd
import numpy as np
import time
import itertools

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在載入歷史資料庫...")
conn = sqlite3.connect(DB_PATH)
df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
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
    SELECT date, stock_id, opening_price, highest_price, lowest_price, closing_price, trade_value
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
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)

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

print("[*] 正在預計算每日候選股清單 (Precomputing candidate pools)...")
daily_candidates = {}
min_s20_slope = 0.025

for dt in all_dates:
    is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
    if not is_macro_bull:
        daily_candidates[dt] = None
        continue

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
        sat_ranked = remaining.sort_values('titan_score', ascending=False).index.tolist()
        daily_candidates[dt] = {
            'leader': leader,
            'satellites': sat_ranked,
            'breadth': breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5,
            'valid_sids': set(scores.keys())
        }
    else:
        daily_candidates[dt] = None

print("[✓] 候選池預計算完成！開始向量加速模擬...")

# 提取加速矩陣
px_open_mat = price_open.loc[all_dates].values
px_close_mat = price_pivot.loc[all_dates].values
ma60_mat = ma60_pivot.loc[all_dates].values
ma20_mat = ma20_pivot.loc[all_dates].values
sid_to_col = {s: i for i, s in enumerate(price_pivot.columns)}
col_to_sid = {i: s for i, s in enumerate(price_pivot.columns)}
num_days = len(all_dates)
fee_rate = 0.00585

years_arr = np.array([int(d[:4]) for d in all_dates])

def fast_simulate(rebalance_freq, leader_w, num_sats, min_breadth, sat_hard_stop, profit_thresh, profit_pullback):
    sat_w = (1.0 - leader_w) / num_sats if num_sats > 0 else 0.0
    portfolio_equity = 1000000.0
    equity_arr = np.zeros(num_days)
    
    # 紀錄當前持倉: sid_col -> (w, entry_px, peak_px, is_leader)
    active_positions = {}
    pending_targets = None
    
    for i in range(num_days):
        dt = all_dates[i]
        exited_ret = 0.0
        
        # 1. 執行 T+1 開盤調倉
        if pending_targets is not None:
            prev_i = max(0, i - 1)
            # 平倉已剔除標的
            for c_idx, pos in list(active_positions.items()):
                if c_idx not in pending_targets:
                    w_old, ep, pp, isl = pos
                    exit_px = px_open_mat[i, c_idx]
                    prev_px = px_close_mat[prev_i, c_idx]
                    if prev_px > 0 and exit_px > 0:
                        exited_ret += w_old * (exit_px / prev_px - 1.0)
                    del active_positions[c_idx]
                    
            # 建立或更新新買入標的
            turnover_sum = 0.0
            for c_idx, w_new in pending_targets.items():
                if c_idx not in active_positions:
                    open_px = px_open_mat[i, c_idx]
                    active_positions[c_idx] = (w_new, open_px, open_px, w_new >= 0.50)
                    turnover_sum += w_new
                else:
                    w_old, ep, pp, isl = active_positions[c_idx]
                    turnover_sum += abs(w_new - w_old)
                    active_positions[c_idx] = (w_new, ep, pp, isl)
                    
            portfolio_equity -= portfolio_equity * (turnover_sum / 2.0) * fee_rate
            pending_targets = None

        # 2. 結算今日日報酬 (基於開盤買入價或昨收)
        daily_ret = exited_ret
        prev_i = max(0, i - 1)
        for c_idx, pos in list(active_positions.items()):
            w, ep, pp, isl = pos
            c_px = px_close_mat[i, c_idx]
            prev_px = px_close_mat[prev_i, c_idx]
            if prev_px > 0 and c_px > 0:
                daily_ret += w * (c_px / prev_px - 1.0)
        portfolio_equity *= (1.0 + daily_ret)

        # 3. 盤中防守：跌破季線、衛星硬停損、獲利移動鎖定
        if active_positions:
            to_remove = []
            for c_idx, pos in list(active_positions.items()):
                w, ep, pp, isl = pos
                c_px = px_close_mat[i, c_idx]
                m60_px = ma60_mat[i, c_idx]
                cur_peak = max(pp, c_px)
                active_positions[c_idx] = (w, ep, cur_peak, isl)

                stop = False
                if c_px < m60_px:
                    stop = True
                elif (not isl) and (sat_hard_stop is not None) and ep > 0:
                    if (c_px / ep - 1.0) < -sat_hard_stop:
                        stop = True
                elif profit_thresh is not None and ep > 0:
                    gain = (cur_peak / ep) - 1.0
                    if gain >= profit_thresh:
                        pb = (c_px / cur_peak) - 1.0
                        if pb <= -profit_pullback:
                            stop = True
                if stop:
                    to_remove.append(c_idx)

            if to_remove:
                reduced_w = sum(active_positions[c][0] for c in to_remove)
                portfolio_equity -= portfolio_equity * reduced_w * fee_rate
                for c in to_remove:
                    del active_positions[c]

        # 4. 定期調倉選股
        if i % rebalance_freq == 0:
            cand = daily_candidates[dt]
            if cand is None:
                pending_targets = {}
            else:
                leader = cand['leader']
                allow_sats = (cand['breadth'] >= min_breadth)
                if not allow_sats or num_sats == 0:
                    pending_targets = {sid_to_col[leader]: 1.0}
                else:
                    active_cols = set(active_positions.keys())
                    leader_col = sid_to_col[leader]
                    current_sats_sids = [col_to_sid[c] for c in active_cols if c != leader_col and col_to_sid[c] in cand['valid_sids'] and px_close_mat[i, c] >= ma20_mat[i, c]]
                    needed = num_sats - len(current_sats_sids)
                    new_cands = [s for s in cand['satellites'] if s not in current_sats_sids and s in sid_to_col]
                    final_sats = (current_sats_sids + new_cands)[:num_sats]

                    tgt = {leader_col: leader_w}
                    for sat_sid in final_sats:
                        tgt[sid_to_col[sat_sid]] = sat_w
                    pending_targets = tgt

        equity_arr[i] = portfolio_equity

    final_eq = equity_arr[-1]
    total_ret = ((final_eq - 1000000.0) / 1000000.0) * 100.0
    cagr = ((final_eq / 1000000.0) ** (1.0 / 10.75) - 1.0) * 100.0

    peaks = np.maximum.accumulate(equity_arr)
    dds = (equity_arr - peaks) / peaks * 100.0
    mdd = np.min(dds)

    idx_2024 = np.where(years_arr == 2024)[0]
    ret_2024 = ((equity_arr[idx_2024[-1]] - equity_arr[idx_2024[0]]) / equity_arr[idx_2024[0]] * 100.0) if len(idx_2024) > 1 else 0.0
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0.0

    return {
        'total_ret': total_ret,
        'multiple': final_eq / 1000000.0,
        'cagr': cagr,
        'mdd': mdd,
        'ret_2024': ret_2024,
        'calmar': calmar
    }

# DOE 參數因子設計
rebalance_freqs = [15, 20, 25, 30, 40]
leader_weights = [0.50, 0.60, 0.70, 0.80]
sat_hard_stops = [0.12, 0.15, 0.18, 0.22]
profit_locks = [
    (None, None),          # 基準無鎖利
    (0.20, 0.08),          # +20% 獲利，自頂部回檔 -8% 止盈
    (0.25, 0.10),          # +25% 獲利，自頂部回檔 -10% 止盈
    (0.35, 0.12)           # +35% 獲利，自頂部回檔 -12% 止盈
]
min_breadths = [0.35, 0.40, 0.45]

param_grid = list(itertools.product(rebalance_freqs, leader_weights, sat_hard_stops, profit_locks, min_breadths))
print(f"[*] 正在執行完整 DOE (Design of Experiments) 矩陣，總計 {len(param_grid)} 組實驗...")

t_start = time.time()
results = []
for idx, (rf, lw, shs, pl, mb) in enumerate(param_grid):
    pt, pb = pl
    res = fast_simulate(
        rebalance_freq=rf,
        leader_w=lw,
        num_sats=2,
        min_breadth=mb,
        sat_hard_stop=shs,
        profit_thresh=pt,
        profit_pullback=pb
    )
    res['rebalance_freq'] = rf
    res['leader_w'] = lw
    res['sat_w'] = round((1.0 - lw)/2, 2)
    res['sat_hard_stop'] = shs
    res['profit_thresh'] = pt
    res['profit_pullback'] = pb
    res['min_breadth'] = mb
    results.append(res)
    
    if (idx + 1) % 200 == 0 or (idx + 1) == len(param_grid):
        print(f"  -> 進度: {idx + 1}/{len(param_grid)} ({round((idx+1)/len(param_grid)*100, 1)}%) - 已耗時 {round(time.time() - t_start, 1)}s")

df_results = pd.DataFrame(results)
df_results.to_csv('doe_optimization_results.csv', index=False)
print(f"[✓] 全數 DOE 模擬完成！耗時 {round(time.time() - t_start, 1)}s，結果已儲存至 doe_optimization_results.csv")

# 輸出 Top 績效分析
print("\n" + "="*110)
print("🏆 【綜合 Calmar Ratio 最佳 (高報酬、低回撤平衡王)】 Top 5 參數組合:")
print("="*110)
top_calmar = df_results.sort_values('calmar', ascending=False).head(5)
print(top_calmar[['rebalance_freq', 'leader_w', 'sat_hard_stop', 'profit_thresh', 'profit_pullback', 'min_breadth', 'multiple', 'cagr', 'mdd', 'ret_2024', 'calmar']].to_string(index=False))

print("\n" + "="*110)
print("💰 【總獲利倍數最高 (極限獲利王)】 Top 5 參數組合:")
print("="*110)
top_ret = df_results.sort_values('multiple', ascending=False).head(5)
print(top_ret[['rebalance_freq', 'leader_w', 'sat_hard_stop', 'profit_thresh', 'profit_pullback', 'min_breadth', 'multiple', 'cagr', 'mdd', 'ret_2024', 'calmar']].to_string(index=False))

print("\n" + "="*110)
print("🛡️ 【防守抗震最佳 (MDD 最小王)】 Top 5 參數組合 (限定累積倍數 >= 50x):")
print("="*110)
top_safe = df_results[df_results['multiple'] >= 50].sort_values('mdd', ascending=False).head(5)
print(top_safe[['rebalance_freq', 'leader_w', 'sat_hard_stop', 'profit_thresh', 'profit_pullback', 'min_breadth', 'multiple', 'cagr', 'mdd', 'ret_2024', 'calmar']].to_string(index=False))

print("\n" + "="*110)
print("🚀 【2024 年破局突破王】 Top 5 參數組合 (解決 2024 年落後問題，限定累積倍數 >= 60x):")
print("="*110)
top_2024 = df_results[df_results['multiple'] >= 60].sort_values('ret_2024', ascending=False).head(5)
print(top_2024[['rebalance_freq', 'leader_w', 'sat_hard_stop', 'profit_thresh', 'profit_pullback', 'min_breadth', 'multiple', 'cagr', 'mdd', 'ret_2024', 'calmar']].to_string(index=False))

