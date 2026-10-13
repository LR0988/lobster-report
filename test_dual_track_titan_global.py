import os
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
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

ma60 = px_adj.rolling(60).mean()
mom3m = px_adj.pct_change(63)
mom12m = px_adj.pct_change(252)
mom_score = 0.40 * mom3m + 0.60 * mom12m

spy_adj = px_adj['SPY']
spy_ma200 = spy_adj.rolling(200).mean()

trading_dates = [d for d in common_dates if d >= pd.to_datetime('2004-03-01')]
weights_target = [0.40, 0.25, 0.20, 0.15]

is_month_start = [False] * len(trading_dates)
for i in range(len(trading_dates)):
    if i == 0 or trading_dates[i].month != trading_dates[i-1].month:
        is_month_start[i] = True

def run_dual_track(leader_exit_ma=60, sat_trailing_gain=20.0, sat_trailing_dd=12.0, refill_freq=5):
    cash = 1000000.0
    positions = {} # ticker -> {'shares', 'entry_price', 'entry_date', 'peak_price', 'is_leader': bool, 'slot_idx': int}
    equity_curve = []
    trade_logs = []
    friction = 0.0015

    for i, cur_date in enumerate(trading_dates):
        prev_date = trading_dates[i-1] if i > 0 else cur_date
        spy_bull = (spy_adj.loc[prev_date] > spy_ma200.loc[prev_date]) if i > 0 else True
        is_m_start = is_month_start[i]
        is_refill_day = (i % refill_freq == 0)

        # 1. 大盤 SPY < 200MA 全面避險
        if not spy_bull and len(positions) > 0:
            for t, pos in list(positions.items()):
                exit_price = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                ret_pct = (exit_price / pos['entry_price'] - 1.0) * 100.0
                cash += pos['shares'] * exit_price * (1.0 - friction)
                holding_days = (cur_date - pos['entry_date']).days
                trade_logs.append({
                    'ticker': t, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                    'entry_price': pos['entry_price'], 'exit_price': exit_price,
                    'return_pct': ret_pct, 'holding_days': holding_days, 'reason': 'SPY跌破200MA全面避險'
                })
                del positions[t]

        # 2. 個股分級風控：王者寬鬆季線守護，衛星積極移動停利鎖定獲利
        if spy_bull and len(positions) > 0:
            for t, pos in list(positions.items()):
                cur_open = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                prev_close = px_adj.loc[prev_date, t]
                p_ma60 = ma60.loc[prev_date, t]

                if prev_close > pos['peak_price']:
                    pos['peak_price'] = prev_close

                should_exit = False
                exit_reason = ""

                # 季線停損 (王者與衛星皆具備)
                if pd.notna(prev_close) and pd.notna(p_ma60) and prev_close < p_ma60:
                    should_exit = True
                    exit_reason = f"{'👑王者' if pos['is_leader'] else '🛡️衛星'}跌破60MA季線停損"

                # 衛星專屬：守住獲利移動停利 (波段獲利超過 sat_trailing_gain % 後，高點回檔 sat_trailing_dd % 停利)
                elif not pos['is_leader']:
                    max_gain_pct = (pos['peak_price'] / pos['entry_price'] - 1.0) * 100.0
                    dd_from_peak = (prev_close / pos['peak_price'] - 1.0) * 100.0
                    if max_gain_pct >= sat_trailing_gain and dd_from_peak <= -sat_trailing_dd:
                        should_exit = True
                        exit_reason = f"🛡️衛星守住獲利 (峰值+{max_gain_pct:.1f}%，回檔{sat_trailing_dd}%鎖利)"

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

        # 3. 月度再平衡調倉
        if is_m_start and spy_bull:
            port_val = cash
            for t, pos in positions.items():
                p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                port_val += pos['shares'] * p

            valid_cands = []
            for t in stock_tickers:
                p = px_adj.loc[prev_date, t]; m60_val = ma60.loc[prev_date, t]; sc = mom_score.loc[prev_date, t]
                if pd.notna(p) and pd.notna(m60_val) and pd.notna(sc) and p > m60_val and sc > 0:
                    valid_cands.append((t, sc))
            valid_cands.sort(key=lambda x: x[1], reverse=True)
            top4_targets = [x[0] for x in valid_cands[:4]]

            # 若王者不在 top 4，王者換股
            curr_leader = [t for t, p in positions.items() if p['is_leader']]
            if curr_leader and curr_leader[0] != top4_targets[0]:
                t_old = curr_leader[0]
                pos = positions[t_old]
                exit_price = px_open.loc[cur_date, t_old] if pd.notna(px_open.loc[cur_date, t_old]) else px_adj.loc[cur_date, t_old]
                ret_pct = (exit_price / pos['entry_price'] - 1.0) * 100.0
                cash += pos['shares'] * exit_price * (1.0 - friction)
                trade_logs.append({
                    'ticker': t_old, 'entry_date': pos['entry_date'], 'exit_date': cur_date,
                    'entry_price': pos['entry_price'], 'exit_price': exit_price,
                    'return_pct': ret_pct, 'holding_days': (cur_date - pos['entry_date']).days, 'reason': '👑王者換屆調倉'
                })
                del positions[t_old]

            # 重新計算總值
            port_val = cash
            for t, pos in positions.items():
                p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                port_val += pos['shares'] * p

            # 若無王者，建倉王者 (40%)
            if not any(p['is_leader'] for p in positions.values()):
                t_lead = top4_targets[0]
                alloc = 0.40 * port_val
                p_in = px_open.loc[cur_date, t_lead] if pd.notna(px_open.loc[cur_date, t_lead]) else px_adj.loc[cur_date, t_lead]
                if pd.notna(p_in) and p_in > 0 and cash >= alloc * 0.9:
                    shares = (alloc * (1.0 - friction)) / p_in
                    cash -= alloc
                    positions[t_lead] = {
                        'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                        'peak_price': p_in, 'is_leader': True, 'slot_idx': 0
                    }

            # 補齊 3 檔衛星 (各 20%)
            needed_sat = 4 - len(positions)
            if needed_sat > 0 and cash > 5000:
                sat_cands = [t for t in top4_targets[1:] if t not in positions]
                cash_per = cash / max(1, len(sat_cands[:needed_sat]))
                for t in sat_cands[:needed_sat]:
                    p_in = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                    if pd.notna(p_in) and p_in > 0:
                        shares = (cash_per * (1.0 - friction)) / p_in
                        cash -= cash_per
                        positions[t] = {
                            'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                            'peak_price': p_in, 'is_leader': False, 'slot_idx': 1
                        }

        # 4. 動態遞補 (Refill): 每週五檢查，若有空缺且大盤健康，動態遞補開新倉
        elif is_refill_day and spy_bull and len(positions) < 4 and cash > 10000:
            port_val = cash
            for t, pos in positions.items():
                p = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                port_val += pos['shares'] * p

            needed = 4 - len(positions)
            valid_cands = []
            for t in stock_tickers:
                if t in positions: continue
                p = px_adj.loc[prev_date, t]; m60_val = ma60.loc[prev_date, t]; sc = mom_score.loc[prev_date, t]
                if pd.notna(p) and pd.notna(m60_val) and pd.notna(sc) and p > m60_val and sc > 0:
                    valid_cands.append((t, sc))
            valid_cands.sort(key=lambda x: x[1], reverse=True)
            avail_cands = [x[0] for x in valid_cands[:needed]]
            if avail_cands:
                cash_per = cash / len(avail_cands)
                for t in avail_cands:
                    p_in = px_open.loc[cur_date, t] if pd.notna(px_open.loc[cur_date, t]) else px_adj.loc[cur_date, t]
                    if pd.notna(p_in) and p_in > 0:
                        shares = (cash_per * (1.0 - friction)) / p_in
                        cash -= cash_per
                        positions[t] = {
                            'shares': shares, 'entry_price': p_in, 'entry_date': cur_date,
                            'peak_price': p_in, 'is_leader': False, 'slot_idx': 2
                        }

        # 每日計算總值
        cur_port_val = cash
        for t, pos in positions.items():
            p = px_adj.loc[cur_date, t]
            cur_port_val += pos['shares'] * p
        equity_curve.append(cur_port_val)

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
    win_trades = df_trades[df_trades['return_pct'] > 0]
    win_rate = len(win_trades) / len(df_trades) * 100.0 if len(df_trades) > 0 else 0
    tot_win = win_trades['return_pct'].sum()
    tot_loss = abs(df_trades[df_trades['return_pct'] <= 0]['return_pct'].sum())
    profit_factor = tot_win / tot_loss if tot_loss > 0 else 999.0

    return {
        'total_ret': total_ret, 'cagr': cagr, 'mdd': mdd, 'sharpe': sharpe,
        'win_rate': win_rate, 'profit_factor': profit_factor, 'trades': len(df_trades),
        'trade_logs': df_trades, 'equity_series': s_eq
    }

# 測試不同參數組合
print("[*] 正在測試台股泰坦雙軌制 (王者季線奔跑 + 衛星移動停利鎖利 + 週度遞補)...")
configs = [
    ("泰坦雙軌 A: 衛星獲利+20%後回檔10%鎖利", 20.0, 10.0),
    ("泰坦雙軌 B: 衛星獲利+25%後回檔12%鎖利", 25.0, 12.0),
    ("泰坦雙軌 C: 衛星獲利+30%後回檔15%鎖利", 30.0, 15.0),
    ("泰坦純停損: 王者+衛星皆僅跌破60MA停損+週度遞補", 999.0, 999.0),
]

for label, g, dd_cut in configs:
    res = run_dual_track(sat_trailing_gain=g, sat_trailing_dd=dd_cut)
    print(f"[{label}] 累積報酬: +{res['total_ret']:,.1f}% | CAGR: {res['cagr']:.2f}% | MDD: {res['mdd']:.2f}% | 夏普: {res['sharpe']:.2f} | 勝率: {res['win_rate']:.1f}% | 交易數: {res['trades']}")
