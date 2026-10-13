import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

conn = sqlite3.connect(DB_PATH)
sov_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
stk_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
conn.close()

sov_df['date'] = pd.to_datetime(sov_df['date'])
stk_df['date'] = pd.to_datetime(stk_df['date'])

# 計算真實還原開盤價 adj_open
sov_df['adj_open'] = np.where(sov_df['close'] > 0, sov_df['open'] * (sov_df['adj_close'] / sov_df['close']), sov_df['open'])
stk_df['adj_open'] = np.where(stk_df['close'] > 0, stk_df['open'] * (stk_df['adj_close'] / stk_df['close']), stk_df['open'])

sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
sov_open = sov_df.pivot(index='date', columns='ticker', values='adj_open').sort_index()
stk_adj = stk_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
stk_open = stk_df.pivot(index='date', columns='ticker', values='adj_open').sort_index()

common_dates = sov_adj.index[sov_adj.index >= '2003-01-01']
sov_adj = sov_adj.reindex(common_dates).ffill()
sov_open = sov_open.reindex(common_dates).ffill()
stk_adj = stk_adj.reindex(common_dates).ffill()
stk_open = stk_open.reindex(common_dates).ffill()

domestic_tickers = [c for c in stk_adj.columns if not any(c.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]

stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
stk_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]
sov_ma200 = sov_adj.rolling(200).mean()

# 預先計算每月計劃
month_plans = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    next_month_end = month_ends[i+1]

    # SPY 200MA 宏觀避險
    p_spy = sov_adj.loc[t_date, 'SPY']
    m200_spy = sov_ma200.loc[t_date, 'SPY']
    macro_ok = True
    if pd.notna(p_spy) and pd.notna(m200_spy) and p_spy < m200_spy:
        macro_ok = False

    future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
    if len(future_dates) == 0: continue
    t_entry = future_dates[0]
    sub_dates = list(future_dates)

    if not macro_ok:
        month_plans.append({'macro_ok': False, 't_entry': t_entry, 'sub_dates': sub_dates, 'next_month_end': next_month_end, 'picks': []})
        continue

    valid_stks = []
    for s in domestic_tickers:
        sp = stk_adj.loc[t_date, s]; m6 = stk_ma60.loc[t_date, s]; m2 = stk_ma200.loc[t_date, s]; sc = stk_score.loc[t_date, s]
        if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
            valid_stks.append((s, sc))
    valid_stks.sort(key=lambda x: x[1], reverse=True)
    picks = [x[0] for x in valid_stks[:3]]
    month_plans.append({'macro_ok': True, 't_entry': t_entry, 'sub_dates': sub_dates, 'next_month_end': next_month_end, 'picks': picks})

def run_simulation(
    stop_loss_pct=None,       # e.g., 0.10, 0.15, 0.20, 0.25, 0.30, None
    tp_type="none",           # "none", "fixed", "trailing", "breakeven"
    tp_target=0.30,
    trail_trigger=0.30,
    trail_dd=0.12,
    breakeven_trigger=0.15
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    trades_list = []
    target_weights = [0.40, 0.30, 0.30]

    for plan in month_plans:
        next_month_end = plan['next_month_end']
        if not plan['macro_ok'] or len(plan['picks']) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        picks = plan['picks']
        t_entry = plan['t_entry']
        sub_dates = plan['sub_dates']

        n_pick = len(picks)
        active_weights = target_weights[:n_pick]
        tot_w = sum(active_weights)
        active_weights = [w / tot_w for w in active_weights]

        slot_returns = []
        for s_idx, sym in enumerate(picks):
            w = active_weights[s_idx]
            p_entry = stk_open.loc[t_entry, sym] if sym in stk_open.columns else None
            if pd.isna(p_entry) or p_entry <= 0:
                p_entry = stk_adj.loc[sub_dates[0], sym]

            peak_px = p_entry
            exit_px = None
            exit_date = None
            exit_reason = "月底換股"

            for d_idx, cur_d in enumerate(sub_dates):
                cur_close = stk_adj.loc[cur_d, sym] if sym in stk_adj.columns else None
                if pd.isna(cur_close) or cur_close <= 0: continue

                if cur_close > peak_px:
                    peak_px = cur_close

                cur_gain = cur_close / p_entry - 1.0
                max_gain = peak_px / p_entry - 1.0

                # 1. 停損判定
                if stop_loss_pct is not None and cur_gain <= -stop_loss_pct:
                    if d_idx + 1 < len(sub_dates):
                        next_d = sub_dates[d_idx + 1]
                        exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                        exit_date = next_d
                    else:
                        exit_px = cur_close; exit_date = cur_d
                    exit_reason = f"硬停損 (-{stop_loss_pct*100:.0f}%)"
                    break

                # 2. 停利判定
                if tp_type == "fixed" and cur_gain >= tp_target:
                    if d_idx + 1 < len(sub_dates):
                        next_d = sub_dates[d_idx + 1]
                        exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                        exit_date = next_d
                    else:
                        exit_px = cur_close; exit_date = cur_d
                    exit_reason = f"固定停利 (+{tp_target*100:.0f}%)"
                    break

                elif tp_type == "trailing":
                    dd_from_peak = cur_close / peak_px - 1.0
                    if max_gain >= trail_trigger and dd_from_peak <= -trail_dd:
                        if d_idx + 1 < len(sub_dates):
                            next_d = sub_dates[d_idx + 1]
                            exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                            exit_date = next_d
                        else:
                            exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"移動停利 (峰值+{max_gain*100:.1f}%, 回吐{trail_dd*100:.0f}%)"
                        break

                elif tp_type == "breakeven":
                    if max_gain >= breakeven_trigger and cur_gain <= 0.01:
                        if d_idx + 1 < len(sub_dates):
                            next_d = sub_dates[d_idx + 1]
                            exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                            exit_date = next_d
                        else:
                            exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"保本平手線 (曾達+{breakeven_trigger*100:.0f}%)"
                        break

            if exit_px is None:
                last_d = sub_dates[-1]
                exit_px = stk_open.loc[last_d, sym] if pd.notna(stk_open.loc[last_d, sym]) else stk_adj.loc[last_d, sym]
                exit_date = last_d

            ret_trade = (exit_px / p_entry - 1.0) - friction
            slot_returns.append(ret_trade * w)
            trades_list.append({
                'ticker': sym, 'ret': ret_trade * 100.0, 'reason': exit_reason
            })

        period_net_ret = sum(slot_returns)
        capital *= (1.0 + period_net_ret)
        equity.append(capital)
        dates.append(next_month_end)

    eq_s = pd.Series(equity, index=dates)
    tot_ret = (eq_s.iloc[-1] / eq_s.iloc[0] - 1.0) * 100.0
    mult = eq_s.iloc[-1] / eq_s.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_s - eq_s.cummax()) / eq_s.cummax()).min() * 100.0

    monthly_ret = eq_s.pct_change().dropna()
    rf = 0.02 / 12.0
    excess_ret = monthly_ret - rf
    sharpe = (excess_ret.mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

    df_tr = pd.DataFrame(trades_list)
    win_trades = df_tr[df_tr['ret'] > 0]
    loss_trades = df_tr[df_tr['ret'] < 0]
    win_rate = len(win_trades) / len(df_tr) * 100.0 if len(df_tr) > 0 else 0.0
    w_sum = win_trades['ret'].sum()
    l_sum = abs(loss_trades['ret'].sum())
    profit_factor = round(w_sum / l_sum, 2) if l_sum > 0 else 999.0
    worst_trade = df_tr['ret'].min()
    best_trade = df_tr['ret'].max()
    stopped_count = df_tr['reason'].str.contains("停損").sum()
    tp_count = (df_tr['reason'].str.contains("停利") | df_tr['reason'].str.contains("保本")).sum()

    return {
        'stop_loss': f"-{int(stop_loss_pct*100)}%" if stop_loss_pct else "無停損 (現狀)",
        'tp_type': tp_type,
        'tp_desc': (
            "無停利 (抱滿整月)" if tp_type == "none" else
            f"固定停利 +{int(tp_target*100)}%" if tp_type == "fixed" else
            f"移動停利 (達+{int(trail_trigger*100)}% 回吐{int(trail_dd*100)}%)" if tp_type == "trailing" else
            f"保本平手線 (達+{int(breakeven_trigger*100)}%)"
        ),
        'mult': mult,
        'cagr': cagr,
        'mdd': mdd,
        'calmar': calmar,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'worst_trade': worst_trade,
        'best_trade': best_trade,
        'total_trades': len(df_tr),
        'stopped_count': stopped_count,
        'tp_count': tp_count,
        'trades_df': df_tr
    }

# 執行乾淨 DOE
sl_levels = [None, 0.10, 0.15, 0.20, 0.25, 0.30]

tp_configs = [
    {"type": "none", "target": None, "trigger": None, "dd": None, "be": None, "desc": "無停利 (抱滿整月)"},
    {"type": "fixed", "target": 0.20, "trigger": None, "dd": None, "be": None, "desc": "固定停利 +20%"},
    {"type": "fixed", "target": 0.30, "trigger": None, "dd": None, "be": None, "desc": "固定停利 +30%"},
    {"type": "fixed", "target": 0.40, "trigger": None, "dd": None, "be": None, "desc": "固定停利 +40%"},
    {"type": "fixed", "target": 0.50, "trigger": None, "dd": None, "be": None, "desc": "固定停利 +50%"},
    {"type": "trailing", "target": None, "trigger": 0.15, "dd": 0.08, "be": None, "desc": "移動停利 (達+15% 回吐8%)"},
    {"type": "trailing", "target": None, "trigger": 0.20, "dd": 0.10, "be": None, "desc": "移動停利 (達+20% 回吐10%)"},
    {"type": "trailing", "target": None, "trigger": 0.25, "dd": 0.10, "be": None, "desc": "移動停利 (達+25% 回吐10%)"},
    {"type": "trailing", "target": None, "trigger": 0.30, "dd": 0.12, "be": None, "desc": "移動停利 (達+30% 回吐12%)"},
    {"type": "trailing", "target": None, "trigger": 0.30, "dd": 0.15, "be": None, "desc": "移動停利 (達+30% 回吐15%)"},
    {"type": "trailing", "target": None, "trigger": 0.40, "dd": 0.15, "be": None, "desc": "移動停利 (達+40% 回吐15%)"},
    {"type": "trailing", "target": None, "trigger": 0.50, "dd": 0.15, "be": None, "desc": "移動停利 (達+50% 回吐15%)"},
    {"type": "trailing", "target": None, "trigger": 0.50, "dd": 0.20, "be": None, "desc": "移動停利 (達+50% 回吐20%)"},
    {"type": "breakeven", "target": None, "trigger": None, "dd": None, "be": 0.15, "desc": "保本平手 (達+15%回跌成本)"},
    {"type": "breakeven", "target": None, "trigger": None, "dd": None, "be": 0.20, "desc": "保本平手 (達+20%回跌成本)"},
]

records = []
for sl in sl_levels:
    for tpc in tp_configs:
        res = run_simulation(
            stop_loss_pct=sl,
            tp_type=tpc["type"],
            tp_target=tpc["target"],
            trail_trigger=tpc["trigger"],
            trail_dd=tpc["dd"],
            breakeven_trigger=tpc["be"]
        )
        records.append({
            'stop_loss': res['stop_loss'],
            'tp_desc': res['tp_desc'],
            'cagr': round(res['cagr'], 2),
            'mult': round(res['mult'], 1),
            'mdd': round(res['mdd'], 2),
            'calmar': round(res['calmar'], 3),
            'sharpe': round(res['sharpe'], 2),
            'win_rate': round(res['win_rate'], 1),
            'profit_factor': res['profit_factor'],
            'worst_trade': round(res['worst_trade'], 2),
            'best_trade': round(res['best_trade'], 2),
            'stopped_count': res['stopped_count'],
            'tp_count': res['tp_count'],
            'total_trades': res['total_trades']
        })

df_res = pd.DataFrame(records)
df_res.to_csv("/Users/huanggin-chen/openclaw_test/clean_doe_results.csv", index=False)
print("Clean DOE saved to clean_doe_results.csv")

# 1. 基準（現狀：無停損、無停利）
baseline = df_res[(df_res['stop_loss'] == '無停損 (現狀)') & (df_res['tp_desc'] == '無停利 (抱滿整月)')].iloc[0]
print("\n" + "="*80)
print(f"【基準 Baseline】全球泰坦旗艦現狀 (無停損 + 抱滿整月)")
print(f"累積倍數: {baseline['mult']}x | CAGR: {baseline['cagr']}% | MDD: {baseline['mdd']}% | Sharpe: {baseline['sharpe']} | Calmar: {baseline['calmar']}")
print(f"勝率: {baseline['win_rate']}% | 獲利因子 PF: {baseline['profit_factor']} | 最大單筆虧損: {baseline['worst_trade']}% | 最大單筆獲利: {baseline['best_trade']}%")
print("="*80)

# 2. 單看停損 (SL)
print("\n=== 一、停損因子 (Stop-Loss) 獨立效應 ===")
sl_only = df_res[df_res['tp_desc'] == '無停利 (抱滿整月)'].sort_values('calmar', ascending=False)
print(sl_only[['stop_loss', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'worst_trade', 'stopped_count']].to_string(index=False))

# 3. 單看停利 (TP)
print("\n=== 二、停利因子 (Take-Profit) 獨立效應 ===")
tp_only = df_res[df_res['stop_loss'] == '無停損 (現狀)'].sort_values('calmar', ascending=False)
print(tp_only[['tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'best_trade', 'tp_count']].to_string(index=False))

# 4. 全局最佳 Calmar 前 10 名
print("\n=== 三、全局最佳 Calmar 綜合風控冠軍 Top 10 ===")
print(df_res.sort_values('calmar', ascending=False).head(10)[['stop_loss', 'tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'worst_trade', 'stopped_count', 'tp_count']].to_string(index=False))

# 5. 全局最低 MDD 前 10 名
print("\n=== 四、全局最低 MDD 抗跌組合 Top 10 ===")
print(df_res.sort_values('mdd', ascending=False).head(10)[['stop_loss', 'tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'worst_trade']].to_string(index=False))
