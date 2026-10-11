import os
import sqlite3
import time
import json
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

print("[*] 正在載入全球高流動性資料庫...")
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("""
    SELECT ticker, date, open, adj_close
    FROM global_stock_daily
    ORDER BY date ASC
""", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj_df = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open_df = df.pivot(index='date', columns='ticker', values='open').sort_index()

common_dates = px_adj_df.index[px_adj_df.index >= '2003-01-01']
px_adj_df = px_adj_df.reindex(common_dates).ffill()
px_open_df = px_open_df.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj_df.columns if t not in ['SPY', 'QQQ', '0050.TW']]
ticker_to_idx = {t: i for i, t in enumerate(stock_tickers)}
idx_to_ticker = {i: t for i, t in enumerate(stock_tickers)}
n_stocks = len(stock_tickers)

# 矩陣化
px_adj = px_adj_df[stock_tickers].values
px_open = px_open_df[stock_tickers].values

# 預算均線 (Numpy)
def calc_rolling_mean(arr, window):
    res = np.full_like(arr, np.nan)
    for j in range(arr.shape[1]):
        s = pd.Series(arr[:, j])
        res[:, j] = s.rolling(window).mean().values
    return res

print("[*] 正在預計算 40MA, 60MA, 80MA, 120MA 與動能分數矩陣...")
ma40_arr = calc_rolling_mean(px_adj, 40)
ma60_arr = calc_rolling_mean(px_adj, 60)
ma80_arr = calc_rolling_mean(px_adj, 80)
ma120_arr = calc_rolling_mean(px_adj, 120)

mom3m = np.full_like(px_adj, np.nan)
mom12m = np.full_like(px_adj, np.nan)
for j in range(n_stocks):
    s = pd.Series(px_adj[:, j])
    mom3m[:, j] = s.pct_change(63).values
    mom12m[:, j] = s.pct_change(252).values
mom_score_arr = 0.40 * mom3m + 0.60 * mom12m

# SPY 大盤
spy_adj = px_adj_df['SPY'].values
spy_ma200 = pd.Series(spy_adj).rolling(200).mean().values

trading_date_indices = [i for i, d in enumerate(common_dates) if d >= pd.to_datetime('2004-03-01')]
all_dates = common_dates.values

# 月初開盤日與週初開盤日標記
is_month_start = [False] * len(trading_date_indices)
is_week_start = [False] * len(trading_date_indices)

for k, d_idx in enumerate(trading_date_indices):
    prev_d_idx = trading_date_indices[k-1] if k > 0 else d_idx
    cur_date = pd.Timestamp(all_dates[d_idx])
    prev_date = pd.Timestamp(all_dates[prev_d_idx])
    if k == 0 or cur_date.month != prev_date.month:
        is_month_start[k] = True
    if k == 0 or cur_date.isocalendar()[1] != prev_date.isocalendar()[1]:
        is_week_start[k] = True

friction = 0.0015 # 0.15% 交易稅費摩擦

# 定義 DOE 因子與水準
EXIT_MA_LEVELS = {
    'none': None,
    'ma40': 40,
    'ma60': 60,
    'ma80': 80,
    'ma120': 120,
    'hard_10': 'hard_10'
}

TRAILING_STOP_LEVELS = {
    'none': None,
    'trail_15_8': (15.0, 8.0),
    'trail_15_10': (15.0, 10.0),
    'trail_15_12': (15.0, 12.0),
    'trail_20_10': (20.0, 10.0),
    'trail_25_12': (25.0, 12.0),
    'trail_10_6': (10.0, 6.0)
}

REFILL_LEVELS = ['monthly', 'weekly', 'next_day']

SIZING_SCHEMES = {
    'top3_equal': (3, [0.3333, 0.3333, 0.3334]),
    'top3_ladder': (3, [0.40, 0.30, 0.30]),
    'top3_steep': (3, [0.50, 0.30, 0.20]),
    'top4_equal': (4, [0.25, 0.25, 0.25, 0.25]),
    'top4_ladder': (4, [0.40, 0.25, 0.20, 0.15]),
    'top4_steep': (4, [0.50, 0.25, 0.15, 0.10]),
    'top4_balance': (4, [0.35, 0.25, 0.20, 0.20]),
    'top5_equal': (5, [0.20, 0.20, 0.20, 0.20, 0.20]),
    'top5_ladder': (5, [0.35, 0.25, 0.15, 0.15, 0.10])
}

# 高性能回測模擬器
def simulate_fast(exit_ma_key, trail_key, refill_mode, sizing_key):
    top_n, weights_target = SIZING_SCHEMES[sizing_key]
    ma_val = EXIT_MA_LEVELS[exit_ma_key]
    trail_params = TRAILING_STOP_LEVELS[trail_key] # (activation_gain, pullback_pct) or None

    cash = 1000000.0
    # positions: dict of stock_idx -> {'shares': float, 'entry_price': float, 'entry_k': int, 'peak_price': float, 'slot_w': float}
    positions = {}
    trade_returns = []
    trade_holdings = []
    equity_curve = np.zeros(len(trading_date_indices), dtype=np.float64)

    for k, d_idx in enumerate(trading_date_indices):
        prev_d_idx = trading_date_indices[k-1] if k > 0 else d_idx
        spy_bull = (spy_adj[prev_d_idx] > spy_ma200[prev_d_idx]) if k > 0 else True
        is_m_start = is_month_start[k]
        is_w_start = is_week_start[k]

        # 1. 大盤風控：若破年線，全數退回現金避險
        if not spy_bull and len(positions) > 0:
            for s_idx, pos in list(positions.items()):
                p_out = px_open[d_idx, s_idx]
                if np.isnan(p_out) or p_out <= 0:
                    p_out = px_adj[d_idx, s_idx]
                ret = (p_out / pos['entry_price'] - 1.0)
                cash += pos['shares'] * p_out * (1.0 - friction)
                trade_returns.append(ret)
                trade_holdings.append(k - pos['entry_k'])
                del positions[s_idx]

        # 2. 個股均線防守與移動停利風控 (每日盤前依昨日收盤判斷，今日開盤執行)
        exited_slots_today = 0
        if spy_bull and len(positions) > 0:
            for s_idx, pos in list(positions.items()):
                prev_c = px_adj[prev_d_idx, s_idx]
                cur_o = px_open[d_idx, s_idx]
                if np.isnan(cur_o) or cur_o <= 0:
                    cur_o = prev_c

                if prev_c > pos['peak_price']:
                    pos['peak_price'] = prev_c

                should_exit = False

                # 均線或硬停損判定
                if ma_val == 'hard_10':
                    if (prev_c / pos['entry_price'] - 1.0) <= -0.10:
                        should_exit = True
                elif ma_val is not None:
                    if ma_val == 40:
                        m = ma40_arr[prev_d_idx, s_idx]
                    elif ma_val == 60:
                        m = ma60_arr[prev_d_idx, s_idx]
                    elif ma_val == 80:
                        m = ma80_arr[prev_d_idx, s_idx]
                    elif ma_val == 120:
                        m = ma120_arr[prev_d_idx, s_idx]
                    else:
                        m = np.nan
                    if not np.isnan(prev_c) and not np.isnan(m) and prev_c < m:
                        should_exit = True

                # 移動停利判定
                if not should_exit and trail_params is not None:
                    act_gain, pb_pct = trail_params
                    max_gain = (pos['peak_price'] / pos['entry_price'] - 1.0) * 100.0
                    dd_from_peak = (prev_c / pos['peak_price'] - 1.0) * 100.0
                    if max_gain >= act_gain and dd_from_peak <= -pb_pct:
                        should_exit = True

                if should_exit:
                    ret = (cur_o / pos['entry_price'] - 1.0)
                    cash += pos['shares'] * cur_o * (1.0 - friction)
                    trade_returns.append(ret)
                    trade_holdings.append(k - pos['entry_k'])
                    del positions[s_idx]
                    exited_slots_today += 1

        # 3. 再平衡與選股：月初換股 或 動態遞補
        can_refill = (refill_mode == 'next_day' and exited_slots_today > 0) or \
                     (refill_mode == 'weekly' and is_w_start and len(positions) < top_n)

        if spy_bull and (is_m_start or can_refill):
            # 動態篩選候選池：前一日 close > 60MA 且 mom_score > 0
            valid_cands = []
            for j in range(n_stocks):
                p = px_adj[prev_d_idx, j]
                m60 = ma60_arr[prev_d_idx, j]
                sc = mom_score_arr[prev_d_idx, j]
                if not np.isnan(p) and not np.isnan(m60) and not np.isnan(sc) and p > m60 and sc > 0:
                    valid_cands.append((j, sc))
            valid_cands.sort(key=lambda x: x[1], reverse=True)

            top_targets = [x[0] for x in valid_cands[:top_n]]
            top_pool_10 = set([x[0] for x in valid_cands[:10]])

            if is_m_start:
                # 月初：踢出掉出 Top 10 的在席股
                for s_idx, pos in list(positions.items()):
                    if s_idx not in top_pool_10:
                        cur_o = px_open[d_idx, s_idx]
                        if np.isnan(cur_o) or cur_o <= 0:
                            cur_o = px_adj[d_idx, s_idx]
                        ret = (cur_o / pos['entry_price'] - 1.0)
                        cash += pos['shares'] * cur_o * (1.0 - friction)
                        trade_returns.append(ret)
                        trade_holdings.append(k - pos['entry_k'])
                        del positions[s_idx]

                # 計算總市值並為空缺席位分配權重
                port_val = cash
                for s_idx, pos in positions.items():
                    p = px_open[d_idx, s_idx]
                    if np.isnan(p) or p <= 0: p = px_adj[d_idx, s_idx]
                    port_val += pos['shares'] * p

                # 買入未持有的新目標
                existing_set = set(positions.keys())
                for rank_i, target_idx in enumerate(top_targets):
                    if target_idx not in existing_set and len(positions) < top_n:
                        alloc = weights_target[rank_i] * port_val
                        alloc = min(alloc, cash)
                        if alloc > 100:
                            p_in = px_open[d_idx, target_idx]
                            if np.isnan(p_in) or p_in <= 0: p_in = px_adj[d_idx, target_idx]
                            if not np.isnan(p_in) and p_in > 0:
                                shares = (alloc * (1.0 - friction)) / p_in
                                cash -= alloc
                                positions[target_idx] = {
                                    'shares': shares, 'entry_price': p_in, 'entry_k': k,
                                    'peak_price': p_in, 'slot_w': weights_target[rank_i]
                                }

            elif can_refill and len(positions) < top_n:
                # 遞補機制：從 top_targets 或 valid_cands 中找未持有的最高分標的
                port_val = cash
                for s_idx, pos in positions.items():
                    p = px_open[d_idx, s_idx]
                    if np.isnan(p) or p <= 0: p = px_adj[d_idx, s_idx]
                    port_val += pos['shares'] * p

                existing_set = set(positions.keys())
                open_slots = top_n - len(positions)
                for cand_idx, sc in valid_cands:
                    if cand_idx not in existing_set:
                        # 權重依空出比例均分剩餘現金
                        slot_alloc = cash / open_slots
                        if slot_alloc > 100:
                            p_in = px_open[d_idx, cand_idx]
                            if np.isnan(p_in) or p_in <= 0: p_in = px_adj[d_idx, cand_idx]
                            if not np.isnan(p_in) and p_in > 0:
                                shares = (slot_alloc * (1.0 - friction)) / p_in
                                cash -= slot_alloc
                                positions[cand_idx] = {
                                    'shares': shares, 'entry_price': p_in, 'entry_k': k,
                                    'peak_price': p_in, 'slot_w': 1.0 / top_n
                                }
                                open_slots -= 1
                                if open_slots <= 0:
                                    break

        # 每日結算淨值
        cur_equity = cash
        for s_idx, pos in positions.items():
            p_end = px_adj[d_idx, s_idx]
            cur_equity += pos['shares'] * p_end
        equity_curve[k] = cur_equity

    # 計算統計指標
    tot_ret = (equity_curve[-1] / equity_curve[0] - 1.0) * 100.0
    years = (pd.Timestamp(all_dates[trading_date_indices[-1]]) - pd.Timestamp(all_dates[trading_date_indices[0]])).days / 365.25
    cagr = ((equity_curve[-1] / equity_curve[0]) ** (1.0 / years) - 1.0) * 100.0

    peak_curve = np.maximum.accumulate(equity_curve)
    dd_curve = (equity_curve - peak_curve) / peak_curve * 100.0
    mdd = np.min(dd_curve)

    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0.0

    eq_s = pd.Series(equity_curve)
    daily_rets = eq_s.pct_change().dropna()
    sharpe = (daily_rets.mean() / daily_rets.std() * np.sqrt(252)) if daily_rets.std() > 0 else 0.0

    if len(trade_returns) > 0:
        trades_arr = np.array(trade_returns)
        win_rate = np.mean(trades_arr > 0) * 100.0
        gains = trades_arr[trades_arr > 0]
        losses = trades_arr[trades_arr < 0]
        tot_gain = np.sum(gains) if len(gains) > 0 else 0.0
        tot_loss = abs(np.sum(losses)) if len(losses) > 0 else 1e-6
        profit_factor = tot_gain / tot_loss
        avg_hold = float(np.mean(trade_holdings))
    else:
        win_rate = 0.0
        profit_factor = 0.0
        avg_hold = 0.0

    return {
        'total_ret': tot_ret,
        'cagr': cagr,
        'mdd': mdd,
        'calmar': calmar,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'trades': len(trade_returns),
        'avg_holding_days': avg_hold
    }

print("[*] 正在執行多因子完整 DOE 矩陣實驗 (Exit Strategies & Sizing Scheme)...")
doe_records = []
t_start = time.time()

# 遍歷所有關鍵組合
total_combos = len(EXIT_MA_LEVELS) * len(TRAILING_STOP_LEVELS) * len(REFILL_LEVELS) * len(SIZING_SCHEMES)
print(f"[*] 總試驗組數: {total_combos} 組")

counter = 0
for ma_k in EXIT_MA_LEVELS.keys():
    for trail_k in TRAILING_STOP_LEVELS.keys():
        for refill_k in REFILL_LEVELS:
            for sizing_k in SIZING_SCHEMES.keys():
                res = simulate_fast(ma_k, trail_k, refill_k, sizing_k)
                rec = {
                    'exit_ma': ma_k,
                    'trailing_stop': trail_k,
                    'refill_mode': refill_k,
                    'sizing_scheme': sizing_k,
                    **res
                }
                doe_records.append(rec)
                counter += 1
                if counter % 100 == 0 or counter == total_combos:
                    elapsed = time.time() - t_start
                    print(f"    - 完成 {counter}/{total_combos} 組 ({counter/total_combos*100:.1f}%) | 耗時: {elapsed:.1f}s")

doe_df = pd.DataFrame(doe_records)
csv_out = "/Users/huanggin-chen/openclaw_test/exit_and_sizing_doe_results.csv"
doe_df.to_csv(csv_out, index=False)
print(f"[+] DOE 完整回測資料已存檔至: {csv_out}")

# 輸出 ANOVA 主效應分析
print("\n" + "="*80)
print("📊 DOE 主效應統計分析 (Main Effects Analysis)")
print("="*80)

print("\n1. 【均線防守機制 (Exit MA)】主效應:")
ma_group = doe_df.groupby('exit_ma')[['cagr', 'mdd', 'calmar', 'win_rate', 'trades']].mean().reset_index()
print(ma_group.sort_values(by='calmar', ascending=False).to_string(index=False))

print("\n2. 【守住獲利移動停利 (Trailing Stop)】主效應:")
trail_group = doe_df.groupby('trailing_stop')[['cagr', 'mdd', 'calmar', 'win_rate', 'trades']].mean().reset_index()
print(trail_group.sort_values(by='win_rate', ascending=False).to_string(index=False))

print("\n3. 【資金遞補時點 (Refill Mode)】主效應:")
refill_group = doe_df.groupby('refill_mode')[['cagr', 'mdd', 'calmar', 'win_rate', 'trades']].mean().reset_index()
print(refill_group.sort_values(by='cagr', ascending=False).to_string(index=False))

print("\n4. 【分配比例與檔數 (Sizing Scheme)】主效應:")
sizing_group = doe_df.groupby('sizing_scheme')[['cagr', 'mdd', 'calmar', 'win_rate', 'trades']].mean().reset_index()
print(sizing_group.sort_values(by='calmar', ascending=False).to_string(index=False))

# 最佳組合排名
print("\n" + "="*80)
print("🏆 全球泰坦最強 DOE 冠軍組合榜單 (Top 5 by Calmar Ratio)")
print("="*80)
top_calmar = doe_df.sort_values(by='calmar', ascending=False).head(5)
for idx, r in top_calmar.iterrows():
    print(f"👑 #{r.name+1} | 均線:{r['exit_ma']} | 移動停利:{r['trailing_stop']} | 遞補:{r['refill_mode']} | 配比:{r['sizing_scheme']}")
    print(f"   總報酬: +{r['total_ret']:,.1f}% | CAGR: {r['cagr']:.2f}% | MDD: {r['mdd']:.2f}% | Calmar: {r['calmar']:.3f} | 勝率: {r['win_rate']:.1f}% | 交易數: {r['trades']}")
    print("-" * 80)
