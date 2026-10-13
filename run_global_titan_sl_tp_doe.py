import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

def load_data():
    conn = sqlite3.connect(DB_PATH)
    sov_df = pd.read_sql_query("SELECT ticker, date, open, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
    stk_df = pd.read_sql_query("SELECT ticker, date, open, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
    conn.close()

    sov_df['date'] = pd.to_datetime(sov_df['date'])
    stk_df['date'] = pd.to_datetime(stk_df['date'])

    sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
    sov_open = sov_df.pivot(index='date', columns='ticker', values='open').sort_index()
    stk_adj = stk_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
    stk_open = stk_df.pivot(index='date', columns='ticker', values='open').sort_index()

    common_dates = sov_adj.index[sov_adj.index >= '2003-01-01']
    sov_adj = sov_adj.reindex(common_dates).ffill()
    sov_open = sov_open.reindex(common_dates).ffill()
    stk_adj = stk_adj.reindex(common_dates).ffill()
    stk_open = stk_open.reindex(common_dates).ffill()

    return sov_adj, sov_open, stk_adj, stk_open

sov_adj, sov_open, stk_adj, stk_open = load_data()

# 國內券商可買池：美股/ADR (不含 .KS, .T, .DE, .SA) + 台股 (.TW)
domestic_tickers = [c for c in stk_adj.columns if not any(c.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]

stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
stk_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

# SPY 200MA 宏觀安全氣囊
sov_ma200 = sov_adj.rolling(200).mean()

def run_simulation(
    stop_loss_pct=None,       # e.g., 0.10, 0.15, 0.20, 0.25, 0.30, None
    tp_type="none",           # "none", "fixed", "trailing", "breakeven"
    tp_target=0.30,           # for fixed tp
    trail_trigger=0.30,       # for trailing tp: trigger threshold (e.g. +30%)
    trail_dd=0.12,            # for trailing tp: drawdown from peak (e.g. 12%)
    breakeven_trigger=0.15,   # for breakeven: once +15%, stop at cost
    alloc_type="TOP3_40_30_30",
    macro_filter=True
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    trades_list = []
    
    weights_map = {
        "TOP1": [1.0],
        "TOP2": [0.50, 0.50],
        "TOP3_40_30_30": [0.40, 0.30, 0.30]
    }
    target_weights = weights_map.get(alloc_type, [0.40, 0.30, 0.30])
    k_slots = len(target_weights)

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        next_month_end = month_ends[i+1]

        # 檢查 SPY 宏觀
        macro_ok = True
        if macro_filter:
            p_spy = sov_adj.loc[t_date, 'SPY']
            m200_spy = sov_ma200.loc[t_date, 'SPY']
            if pd.notna(p_spy) and pd.notna(m200_spy) and p_spy < m200_spy:
                macro_ok = False

        future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
        if len(future_dates) == 0:
            continue
        t_entry = future_dates[0]
        sub_dates = list(future_dates) # 所有月內交易日

        if not macro_ok:
            # 宏觀避險，100% 現金
            equity.append(capital)
            dates.append(next_month_end)
            continue

        # 選股
        valid_stks = []
        for s in domestic_tickers:
            sp = stk_adj.loc[t_date, s]
            m6 = stk_ma60.loc[t_date, s]
            m2 = stk_ma200.loc[t_date, s]
            sc = stk_score.loc[t_date, s]
            if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
                valid_stks.append((s, sc))
        valid_stks.sort(key=lambda x: x[1], reverse=True)

        if len(valid_stks) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        n_pick = min(k_slots, len(valid_stks))
        active_weights = target_weights[:n_pick]
        tot_w = sum(active_weights)
        active_weights = [w / tot_w for w in active_weights]
        picked_stocks = [valid_stks[idx][0] for idx in range(n_pick)]

        # 模擬該月內部持倉演化
        slot_returns = []
        for s_idx, sym in enumerate(picked_stocks):
            w = active_weights[s_idx]
            p_entry = stk_open.loc[t_entry, sym] if sym in stk_open.columns else None
            if pd.isna(p_entry) or p_entry <= 0:
                p_entry = stk_adj.loc[t_date, sym]

            peak_px = p_entry
            exit_px = None
            exit_date = None
            exit_reason = "月底換股"

            # 遍歷月內每日檢查停損/停利
            for d_idx, cur_d in enumerate(sub_dates):
                cur_close = stk_adj.loc[cur_d, sym] if sym in stk_adj.columns else None
                if pd.isna(cur_close) or cur_close <= 0:
                    continue

                if cur_close > peak_px:
                    peak_px = cur_close

                cur_gain = cur_close / p_entry - 1.0
                max_gain = peak_px / p_entry - 1.0

                # 1. 硬停損檢查
                if stop_loss_pct is not None and cur_gain <= -stop_loss_pct:
                    # 次日開盤出場或當日收盤出場
                    if d_idx + 1 < len(sub_dates):
                        next_d = sub_dates[d_idx + 1]
                        exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                        exit_date = next_d
                    else:
                        exit_px = cur_close
                        exit_date = cur_d
                    exit_reason = f"硬停損 (-{stop_loss_pct*100:.0f}%)"
                    break

                # 2. 停利檢查
                if tp_type == "fixed" and cur_gain >= tp_target:
                    if d_idx + 1 < len(sub_dates):
                        next_d = sub_dates[d_idx + 1]
                        exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                        exit_date = next_d
                    else:
                        exit_px = cur_close
                        exit_date = cur_d
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
                            exit_px = cur_close
                            exit_date = cur_d
                        exit_reason = f"移動停利 (峰值+{max_gain*100:.1f}%, 回吐{trail_dd*100:.0f}%)"
                        break

                elif tp_type == "breakeven":
                    if max_gain >= breakeven_trigger and cur_gain <= 0.0:
                        if d_idx + 1 < len(sub_dates):
                            next_d = sub_dates[d_idx + 1]
                            exit_px = stk_open.loc[next_d, sym] if pd.notna(stk_open.loc[next_d, sym]) else cur_close
                            exit_date = next_d
                        else:
                            exit_px = cur_close
                            exit_date = cur_d
                        exit_reason = f"保本平手線 (曾達+{breakeven_trigger*100:.0f}%)"
                        break

            # 若未提前觸發，則在月底以最後一日收盤或次月初開盤結算
            if exit_px is None:
                last_d = sub_dates[-1]
                exit_px = stk_open.loc[last_d, sym] if pd.notna(stk_open.loc[last_d, sym]) else stk_adj.loc[last_d, sym]
                exit_date = last_d

            ret_trade = (exit_px / p_entry - 1.0) - friction
            slot_returns.append(ret_trade * w)

            trades_list.append({
                'ticker': sym,
                'entry_date': t_entry,
                'exit_date': exit_date,
                'entry_px': p_entry,
                'exit_px': exit_px,
                'return_pct': ret_trade * 100.0,
                'reason': exit_reason
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
    win_trades = df_tr[df_tr['return_pct'] > 0]
    loss_trades = df_tr[df_tr['return_pct'] < 0]
    win_rate = len(win_trades) / len(df_tr) * 100.0 if len(df_tr) > 0 else 0.0
    w_sum = win_trades['return_pct'].sum()
    l_sum = abs(loss_trades['return_pct'].sum())
    profit_factor = round(w_sum / l_sum, 2) if l_sum > 0 else 999.0
    
    worst_trade = df_tr['return_pct'].min() if len(df_tr) > 0 else 0.0
    best_trade = df_tr['return_pct'].max() if len(df_tr) > 0 else 0.0
    stopped_count = df_tr['reason'].str.contains("停損").sum() if len(df_tr) > 0 else 0
    tp_count = (df_tr['reason'].str.contains("停利") | df_tr['reason'].str.contains("保本")).sum() if len(df_tr) > 0 else 0

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
        'sharpe': sharpe,
        'calmar': calmar,
        'win_rate': win_rate,
        'profit_factor': profit_factor,
        'worst_trade': worst_trade,
        'best_trade': best_trade,
        'total_trades': len(df_tr),
        'stopped_count': stopped_count,
        'tp_count': tp_count,
        'trades_df': df_tr
    }

print("DOE Engine initialized successfully.")

# 設置 DOE 實驗矩陣
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

print(f"Total DOE cases to run: {len(sl_levels)} SL levels * {len(tp_configs)} TP configs = {len(sl_levels) * len(tp_configs)} combinations.")

records = []
for sl in sl_levels:
    for tpc in tp_configs:
        res = run_simulation(
            stop_loss_pct=sl,
            tp_type=tpc["type"],
            tp_target=tpc["target"],
            trail_trigger=tpc["trigger"],
            trail_dd=tpc["dd"],
            breakeven_trigger=tpc["be"],
            alloc_type="TOP3_40_30_30",
            macro_filter=True
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
df_res.to_csv("/Users/huanggin-chen/openclaw_test/doe_global_titan_sl_tp_results.csv", index=False)
print("DOE Completed and saved to doe_global_titan_sl_tp_results.csv!")

# 1. 基準（現狀：無停損、無停利）
baseline = df_res[(df_res['stop_loss'] == '無停損 (現狀)') & (df_res['tp_desc'] == '無停利 (抱滿整月)')].iloc[0]
print("\n" + "="*80)
print(f"【基準 Baseline】全球泰坦旗艦現狀 (無停損 + 抱滿整月)")
print(f"累積倍數: {baseline['mult']}x | CAGR: {baseline['cagr']}% | MDD: {baseline['mdd']}% | Sharpe: {baseline['sharpe']} | Calmar: {baseline['calmar']}")
print(f"勝率: {baseline['win_rate']}% | 獲利因子 PF: {baseline['profit_factor']} | 最大單筆虧損: {baseline['worst_trade']}% | 最大單筆獲利: {baseline['best_trade']}%")
print("="*80)

# 2. 單看停損 (SL) 對獲利與 MDD 的獨立影響 (無停利狀態下)
print("\n=== 一、停損因子 (Stop-Loss) 獨立效應分析 (在無停利抱滿整月下) ===")
sl_only = df_res[df_res['tp_desc'] == '無停利 (抱滿整月)'].sort_values('calmar', ascending=False)
print(sl_only[['stop_loss', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'worst_trade', 'stopped_count']].to_string(index=False))

# 3. 單看停利 (TP) 對獲利與 MDD 的獨立影響 (在無停損狀態下)
print("\n=== 二、停利因子 (Take-Profit) 獨立效應分析 (在無停損狀態下) ===")
tp_only = df_res[df_res['stop_loss'] == '無停損 (現狀)'].sort_values('calmar', ascending=False)
print(tp_only[['tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'best_trade', 'tp_count']].to_string(index=False))

# 4. 全局最佳 Calmar 前 10 名組合 (綜合風控冠軍)
print("\n=== 三、全局最佳 Calmar 綜合風控冠軍 Top 10 (提升獲利 + 降低回撤) ===")
print(df_res.sort_values('calmar', ascending=False).head(10)[['stop_loss', 'tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'profit_factor', 'worst_trade', 'stopped_count', 'tp_count']].to_string(index=False))

# 5. 全局最低 MDD 前 10 名組合 (極致防禦守護)
print("\n=== 四、全局最低 MDD 極致抗跌 Top 10 ===")
print(df_res.sort_values('mdd', ascending=False).head(10)[['stop_loss', 'tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'worst_trade']].to_string(index=False))

# 6. 全局最高 CAGR 前 10 名組合 (最大化收益)
print("\n=== 五、全局最高 CAGR 暴利衝刺 Top 10 ===")
print(df_res.sort_values('cagr', ascending=False).head(10)[['stop_loss', 'tp_desc', 'cagr', 'mult', 'mdd', 'calmar', 'sharpe', 'win_rate', 'worst_trade']].to_string(index=False))
