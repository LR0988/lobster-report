import os
import sqlite3
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

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

print(f"[*] 股票池標的數: {len(stock_tickers)} 檔, 交易日天數: {len(common_dates)}")

# 預計算指標
ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()

mom3m = px_adj.pct_change(63)
mom12m = px_adj.pct_change(252)
mom_score = 0.40 * mom3m + 0.60 * mom12m

spy_adj = px_adj['SPY']
spy_ma200 = spy_adj.rolling(200).mean()

trading_dates = [d for d in common_dates if d >= pd.to_datetime('2004-03-01')]
weights_target = [0.40, 0.25, 0.20, 0.15]

# 月初開盤日判斷
is_month_start = [False] * len(trading_dates)
for i in range(len(trading_dates)):
    if i == 0 or trading_dates[i].month != trading_dates[i-1].month:
        is_month_start[i] = True

def run_simulation(strategy_name, use_ma60_exit=False, use_ma20_exit=False, trailing_stop_pct=None, refill_weekly=False):
    cash = 1000000.0
    positions = {} # ticker -> {'shares': float, 'entry_price': float, 'entry_date': d, 'peak_price': float, 'slot_weight': float}
    equity_curve = []
    trade_logs = []
    friction = 0.0015 # 0.15% 摩擦成本

    for i, cur_date in enumerate(trading_dates):
        prev_date = trading_dates[i-1] if i > 0 else cur_date
        spy_bull = (spy_adj.loc[prev_date] > spy_ma200.loc[prev_date]) if i > 0 else True
        is_m_start = is_month_start[i]
        is_week_start = (i % 5 == 0)

        # 1. 每日盤中/收盤風控判定 (以前一日收盤或當日開盤判定出場)
        # 若大盤跌破 SPY 200MA，全體出清避險
        if not spy_bull and len(positions) > 0:
            for t, pos in list(positions.items()):
                exit_price = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                ret_pct = (exit_price / pos['entry_price'] - 1.0) * 100.0
                cash += pos['shares'] * exit_price * (1.0 - friction)
                holding_days = (cur_date - pos['entry_date']).days
                trade_logs.append({
                    'ticker': t, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                    'entry_price': pos['entry_price'], 'exit_price': exit_price,
                    'return_pct': ret_pct, 'holding_days': holding_days, 'reason': 'SPY跌破200MA清倉避險'
                })
                del positions[t]

        # 個股均線防守與移動停利風控
        if spy_bull and len(positions) > 0:
            for t, pos in list(positions.items()):
                cur_open = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                prev_close = px_adj.loc[prev_date, t]
                p_ma60 = ma60.loc[prev_date, t]
                p_ma20 = ma20.loc[prev_date, t]

                # 更新持股最高價
                if prev_close > pos['peak_price']:
                    pos['peak_price'] = prev_close

                should_exit = False
                exit_reason = ""

                # 風控 A: 跌破 60MA 季線
                if use_ma60_exit and pd.notna(prev_close) and pd.notna(p_ma60) and prev_close < p_ma60:
                    should_exit = True
                    exit_reason = "跌破60MA季線停損"

                # 風控 B: 跌破 20MA 月線
                elif use_ma20_exit and pd.notna(prev_close) and pd.notna(p_ma20) and prev_close < p_ma20:
                    should_exit = True
                    exit_reason = "跌破20MA月線出場"

                # 風控 C: 移動停利 (Trailing Stop: 獲利超過 15% 後，自最高價回撤 trailing_stop_pct 鎖利)
                elif trailing_stop_pct is not None:
                    max_gain_pct = (pos['peak_price'] / pos['entry_price'] - 1.0) * 100.0
                    dd_from_peak = (prev_close / pos['peak_price'] - 1.0) * 100.0
                    if max_gain_pct >= 15.0 and dd_from_peak <= -trailing_stop_pct:
                        should_exit = True
                        exit_reason = f"高點回撤{trailing_stop_pct}%移動停利(峰值+{max_gain_pct:.1f}%)"

                if should_exit:
                    ret_pct = (cur_open / pos['entry_price'] - 1.0) * 100.0
                    cash += pos['shares'] * cur_open * (1.0 - friction)
                    holding_days = (cur_date - pos['entry_date']).days
                    trade_logs.append({
                        'ticker': t, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                        'entry_price': pos['entry_price'], 'exit_price': cur_open,
                        'return_pct': ret_pct, 'holding_days': holding_days, 'reason': exit_reason
                    })
                    del positions[t]

        # 2. 月初全換股再平衡 (若為月初，且 SPY 大盤健康)
        if is_m_start and spy_bull:
            # 計算當前總資產
            port_val = cash
            for t, pos in positions.items():
                p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                port_val += pos['shares'] * p

            # 動態篩選 Top 4 候選股
            valid_cands = []
            for t in stock_tickers:
                p = px_adj.loc[prev_date, t]
                m60 = ma60.loc[prev_date, t]
                sc = mom_score.loc[prev_date, t]
                if pd.notna(p) and pd.notna(m60) and pd.notna(sc) and p > m60 and sc > 0:
                    valid_cands.append((t, sc))

            valid_cands.sort(key=lambda x: x[1], reverse=True)
            top4_targets = [x[0] for x in valid_cands[:4]]

            # 若不設均線停損/停利 (純月度輪動)，則月末全清換新；
            # 若為泰坦模式，未跌破均線/未停利的在席股可續抱，僅踢除不再在前 10 名或空出的位置換入新股
            if strategy_name == "Baseline_Monthly":
                # 全平倉
                for t, pos in list(positions.items()):
                    exit_price = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                    ret_pct = (exit_price / pos['entry_price'] - 1.0) * 100.0
                    cash += pos['shares'] * exit_price * (1.0 - friction)
                    holding_days = (cur_date - pos['entry_date']).days
                    trade_logs.append({
                        'ticker': t, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                        'entry_price': pos['entry_price'], 'exit_price': exit_price,
                        'return_pct': ret_pct, 'holding_days': holding_days, 'reason': '月度定期輪動換股'
                    })
                    del positions[t]

                port_val = cash
                for rank_idx, t in enumerate(top4_targets):
                    alloc = weights_target[rank_idx] * port_val
                    p_in = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                    if pd.notna(p_in) and p_in > 0:
                        shares = (alloc * (1.0 - friction)) / p_in
                        cash -= alloc
                        positions[t] = {
                            'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                            'peak_price': p_in, 'slot_weight': weights_target[rank_idx]
                        }
            else:
                # 泰坦風格：檢查在席持股是否仍在頂尖池，若不在或空出位置，換入新強者
                top10_pool = [x[0] for x in valid_cands[:10]]
                # 踢出掉出 Top 10 的在席股
                for t, pos in list(positions.items()):
                    if t not in top10_pool:
                        exit_price = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                        ret_pct = (exit_price / pos['entry_price'] - 1.0) * 100.0
                        cash += pos['shares'] * exit_price * (1.0 - friction)
                        holding_days = (cur_date - pos['entry_date']).days
                        trade_logs.append({
                            'ticker': t, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                            'entry_price': pos['entry_price'], 'exit_price': exit_price,
                            'return_pct': ret_pct, 'holding_days': holding_days, 'reason': '動能轉弱掉出前十名'
                        })
                        del positions[t]

                # 補足至 4 檔
                port_val = cash
                for t, pos in positions.items():
                    p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                    port_val += pos['shares'] * p

                needed = 4 - len(positions)
                if needed > 0 and cash > 1000:
                    avail_cands = [t for t in top4_targets if t not in positions]
                    # 分配現金
                    cash_per_slot = cash / needed
                    for t in avail_cands[:needed]:
                        p_in = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                        if pd.notna(p_in) and p_in > 0:
                            shares = (cash_per_slot * (1.0 - friction)) / p_in
                            cash -= cash_per_slot
                            positions[t] = {
                                'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                                'peak_price': p_in, 'slot_weight': 0.25
                            }

        # 3. 週度動態遞補開倉 (Refill weekly)
        elif refill_weekly and is_week_start and spy_bull and len(positions) < 4 and cash > 10000:
            port_val = cash
            for t, pos in positions.items():
                p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                port_val += pos['shares'] * p

            needed = 4 - len(positions)
            valid_cands = []
            for t in stock_tickers:
                if t in positions: continue
                p = px_adj.loc[prev_date, t]
                m60 = ma60.loc[prev_date, t]
                sc = mom_score.loc[prev_date, t]
                if pd.notna(p) and pd.notna(m60) and pd.notna(sc) and p > m60 and sc > 0:
                    valid_cands.append((t, sc))

            valid_cands.sort(key=lambda x: x[1], reverse=True)
            avail_cands = [x[0] for x in valid_cands[:needed]]
            cash_per_slot = cash / len(avail_cands) if len(avail_cands) > 0 else 0
            for t in avail_cands:
                p_in = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                if pd.notna(p_in) and p_in > 0:
                    shares = (cash_per_slot * (1.0 - friction)) / p_in
                    cash -= cash_per_slot
                    positions[t] = {
                        'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                        'peak_price': p_in, 'slot_weight': 0.25
                    }

        # 每日計算總淨值
        cur_port_val = cash
        for t, pos in positions.items():
            p = px_adj.loc[cur_date, t]
            cur_port_val += pos['shares'] * p
        equity_curve.append(cur_port_val)

    # 指標統計
    s_eq = pd.Series(equity_curve, index=trading_dates)
    total_ret = (s_eq.iloc[-1] / s_eq.iloc[0] - 1.0) * 100.0
    years = (trading_dates[-1] - trading_dates[0]).days / 365.25
    cagr = ((s_eq.iloc[-1] / s_eq.iloc[0]) ** (1.0 / years) - 1.0) * 100.0
    rolling_max = s_eq.cummax()
    dd = (s_eq - rolling_max) / rolling_max * 100.0
    mdd = dd.min()

    daily_ret = s_eq.pct_change().dropna()
    sharpe = (daily_ret.mean() / daily_ret.std()) * np.sqrt(252) if daily_ret.std() > 0 else 0

    df_trades = pd.DataFrame(trade_logs)
    if len(df_trades) > 0:
        win_trades = df_trades[df_trades['return_pct'] > 0]
        loss_trades = df_trades[df_trades['return_pct'] <= 0]
        win_rate = len(win_trades) / len(df_trades) * 100.0
        tot_win = win_trades['return_pct'].sum()
        tot_loss = abs(loss_trades['return_pct'].sum())
        profit_factor = tot_win / tot_loss if tot_loss > 0 else 999.0
        avg_holding = df_trades['holding_days'].mean()
    else:
        win_rate = 0; profit_factor = 0; avg_holding = 0

    return {
        'name': strategy_name,
        'final_equity': s_eq.iloc[-1],
        'total_ret': total_ret,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'total_trades': len(df_trades),
        'avg_holding_days': avg_holding,
        'equity_series': s_eq
    }

print("\n[*] 開始執行多種出場機制對比回測 (2004~2026 跨越22年)...")

res1 = run_simulation("方案A: 固定月度輪動 (Baseline)", use_ma60_exit=False, use_ma20_exit=False, trailing_stop_pct=None, refill_weekly=False)
res2 = run_simulation("方案B: 跌破 60MA 季線即時出場", use_ma60_exit=True, use_ma20_exit=False, trailing_stop_pct=None, refill_weekly=False)
res3 = run_simulation("方案C: 跌破 20MA 月線即時出場", use_ma60_exit=False, use_ma20_exit=True, trailing_stop_pct=None, refill_weekly=False)
res4 = run_simulation("方案D: 守住獲利 (+15%後回檔10%移動停利)", use_ma60_exit=False, use_ma20_exit=False, trailing_stop_pct=10.0, refill_weekly=False)
res5 = run_simulation("方案E: 60MA停損 + 移動停利12%守住獲利", use_ma60_exit=True, use_ma20_exit=False, trailing_stop_pct=12.0, refill_weekly=False)
res6 = run_simulation("方案F: 台股泰坦旗艦版 (60MA停損+移動停利+週度遞補)", use_ma60_exit=True, use_ma20_exit=False, trailing_stop_pct=12.0, refill_weekly=True)

results = [res1, res2, res3, res4, res5, res6]
summary_df = pd.DataFrame([{
    '策略模式': r['name'],
    '累積總報酬': f"+{r['total_ret']:,.1f}%",
    '年化 CAGR': f"{r['cagr']:.2f}%",
    '最大回撤 MDD': f"{r['mdd']:.2f}%",
    '夏普比率': f"{r['sharpe']:.2f}",
    '勝率': f"{r['win_rate']:.1f}%",
    '獲利因子': f"{r['profit_factor']:.2f}",
    '總交易數': r['total_trades'],
    '平均持有': f"{r['avg_holding_days']:.1f}天"
} for r in results])

print("\n" + "="*80)
print("📊 全球流動性宇宙：各出場機制與守住獲利模式回測對比大比拼 (2004~2026)")
print("="*80)
print(summary_df.to_string(index=False))
print("="*80)
