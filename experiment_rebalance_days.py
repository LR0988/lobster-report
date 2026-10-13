import os
import json
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 1. 載入數據
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
sov_adj = sov_adj.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()

mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

sov_ma200 = sov_adj.rolling(200).mean()

# 全球主權 ETF 宏觀寬幅 (15 國核心主權指數)
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

# FIP 漸進式動能
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# 收益偏態凸性指標 (Upside Vol / Downside Vol)
downside_ret = px_daily_ret.clip(upper=0)
upside_ret = px_daily_ret.clip(lower=0)
upside_vol = upside_ret.rolling(60).std()
downside_vol = downside_ret.rolling(60).std().replace(0, 1e-6)
stk_convexity = (upside_vol / (downside_vol + 1e-6)).fillna(1.0)

mom_score_raw = (0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m) * (1.0 + 0.5 * fip_mat)
mom_mat = mom_score_raw[stock_tickers]

# 核心回測函數
def run_simulation_for_day(day_target):
    all_dates = pd.Series(px_adj.index[px_adj.index >= '2004-01-01'])
    
    # 找出每個月對應的調倉基準日
    rebal_dates = []
    for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
        sub = grp[grp.dt.day >= day_target]
        if len(sub) > 0:
            rebal_dates.append(sub.iloc[0])
        else:
            rebal_dates.append(grp.iloc[-1]) # 若該月沒有該日(如2月30日)，取該月最後一個交易日

    periods = []
    for i in range(len(rebal_dates) - 1):
        t_date = rebal_dates[i]
        fut = px_adj.index[px_adj.index > t_date]
        if len(fut) == 0: break
        t_in = fut[0]
        next_rebal = rebal_dates[i + 1]
        fut_next = px_adj.index[px_adj.index > next_rebal]
        if len(fut_next) == 0: break
        t_out = fut_next[0]
        periods.append((t_date, t_in, t_out))

    capital = 1000000.0
    equity = [capital]
    dates = [periods[0][0]]
    friction = 0.0015
    current_holdings = {}
    cash = capital
    holding_tenure = {}
    period_returns = []

    for p_idx, (t_date, t_in, t_out) in enumerate(periods):
        br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
        if br >= 0.60:
            exposure = 1.0
        elif br >= 0.40:
            exposure = 0.70
        else:
            exposure = 0.0

        # 候選池
        valid_stks = []
        for s in stock_tickers:
            sp = px_adj.loc[t_date, s]
            m6 = ma60.loc[t_date, s]
            m2 = ma200.loc[t_date, s]
            sc = mom_mat.loc[t_date, s]
            if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
                cx = stk_convexity.loc[t_date, s] if s in stk_convexity.columns and pd.notna(stk_convexity.loc[t_date, s]) else 1.0
                valid_stks.append((s, sc, cx))
        valid_stks.sort(key=lambda x: x[1], reverse=True)
        ranked_tickers = [x[0] for x in valid_stks]
        ticker_info = {x[0]: (idx + 1, x[1], x[2]) for idx, x in enumerate(valid_stks)}

        current_port_val = cash + sum(current_holdings.values())
        current_weights = {s: val / current_port_val for s, val in current_holdings.items()} if current_port_val > 0 else {}

        if exposure <= 0 or len(valid_stks) == 0:
            target_alloc = {'CASH': 1.0}
            holding_tenure = {}
        else:
            # 1. 排名保護緩衝 (Rank <= 5) 與 4 個月換血檢查
            selected_stks = []
            for s in list(current_holdings.keys()):
                tenure = holding_tenure.get(s, 0)
                info = ticker_info.get(s, None)
                if info is not None:
                    rank = info[0]
                    if rank <= 5 and tenure < 4:
                        selected_stks.append(s)

            # 2. 補足名額至 3 檔
            for s in ranked_tickers:
                if len(selected_stks) >= 3: break
                tenure = holding_tenure.get(s, 0)
                if s not in selected_stks and tenure < 4:
                    selected_stks.append(s)

            for s in ranked_tickers:
                if len(selected_stks) >= 3: break
                if s not in selected_stks:
                    selected_stks.append(s)

            n = min(3, len(selected_stks))
            selected_stks = selected_stks[:n]

            # 更新年資
            new_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}
            holding_tenure = new_tenure

            # 偏態凸性加權
            base_w = [0.40, 0.30, 0.30][:n]
            skews = [ticker_info[s][2] for s in selected_stks]
            comb_w = [bw * sk for bw, sk in zip(base_w, skews)]
            tot_cw = sum(comb_w)
            norm_weights = [cw / tot_cw for cw in comb_w]
            raw_target_alloc = {selected_stks[idx]: norm_weights[idx] * exposure for idx in range(n)}

            # 5% 權重容差帶
            target_alloc = {}
            remaining_weight = exposure
            unadjusted_stks = []

            for s in selected_stks:
                tgt_w = raw_target_alloc[s]
                cur_w = current_weights.get(s, 0.0)
                if s in current_holdings and abs(cur_w - tgt_w) <= 0.05:
                    target_alloc[s] = cur_w
                    remaining_weight -= cur_w
                else:
                    unadjusted_stks.append((s, tgt_w))

            if len(unadjusted_stks) > 0:
                tot_unadj = sum(x[1] for x in unadjusted_stks)
                for s, tgt_w in unadjusted_stks:
                    target_alloc[s] = max(0.0, remaining_weight * (tgt_w / tot_unadj)) if tot_unadj > 0 else 0.0

            if sum(target_alloc.values()) < 1.0:
                target_alloc['CASH'] = 1.0 - sum(target_alloc.values())

        # 換手摩擦與回報計算
        all_syms = set(list(current_weights.keys()) + list(target_alloc.keys()))
        period_turnover = 0.0
        for sym in all_syms:
            if sym == 'CASH': continue
            c_w = current_weights.get(sym, 0.0)
            t_w = target_alloc.get(sym, 0.0)
            period_turnover += abs(t_w - c_w)

        period_friction = (period_turnover / 2.0) * friction
        curr_cap = equity[-1] * (1.0 - period_friction)
        period_ret = 0.0
        next_holdings = {}

        for sym, w in target_alloc.items():
            if sym == 'CASH':
                ret_s = 0.0
            else:
                in_p = px_open.loc[t_in, sym] if sym in px_open.columns else None
                out_p = px_open.loc[t_out, sym] if sym in px_open.columns else None
                ret_s = (out_p / in_p - 1.0) if (pd.notna(in_p) and in_p > 0 and pd.notna(out_p)) else 0.0
                next_holdings[sym] = curr_cap * w * (1.0 + ret_s)
            period_ret += w * ret_s

        capital = curr_cap * (1.0 + period_ret)
        current_holdings = next_holdings
        cash = capital - sum(next_holdings.values())
        equity.append(capital)
        dates.append(t_out)
        period_returns.append(period_ret)

    eq_series = pd.Series(equity, index=dates)
    tot_ret = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
    mult = eq_series.iloc[-1] / eq_series.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_series - eq_series.cummax()) / eq_series.cummax()).min() * 100.0
    calmar = cagr / abs(mdd)
    
    # 計算月報酬序列夏普比率 (年化)
    p_rets = pd.Series(period_returns)
    sharpe = (p_rets.mean() / (p_rets.std() + 1e-9)) * np.sqrt(12)
    win_rate = (p_rets > 0).mean() * 100.0

    # 盲測期 (2018 ~ 2026 最近 7.8 年)
    oos_eq = eq_series[eq_series.index >= '2018-01-01']
    if len(oos_eq) > 1:
        oos_mult = oos_eq.iloc[-1] / oos_eq.iloc[0]
        oos_yrs = (oos_eq.index[-1] - oos_eq.index[0]).days / 365.25
        oos_cagr = (oos_mult ** (1.0 / oos_yrs) - 1.0) * 100.0
        oos_mdd = ((oos_eq - oos_eq.cummax()) / oos_eq.cummax()).min() * 100.0
        oos_calmar = oos_cagr / abs(oos_mdd)
    else:
        oos_cagr, oos_mdd, oos_calmar = np.nan, np.nan, np.nan

    # 每年報酬率
    yearly_ret = eq_series.resample('YE').last().pct_change().dropna() * 100.0

    return {
        'day': day_target,
        'tot_ret': tot_ret,
        'mult': mult,
        'cagr': cagr,
        'mdd': mdd,
        'calmar': calmar,
        'sharpe': sharpe,
        'win_rate': win_rate,
        'oos_cagr': oos_cagr,
        'oos_mdd': oos_mdd,
        'oos_calmar': oos_calmar,
        'final_capital': capital,
        'eq_series': eq_series,
        'yearly_ret': yearly_ret
    }

print("=" * 80)
print("【實驗開始】全球泰坦旗艦策略：每月中不同開倉日 (1 / 6 / 11 / 16 / 21 / 30 號) 敏感度對決")
print("=" * 80)

test_days = [1, 6, 11, 16, 21, 30]
results = []

for d in test_days:
    res = run_simulation_for_day(d)
    results.append(res)
    print(f"✅ 開倉日 每月 {d:2d} 號: 22年累積 +{res['tot_ret']:,.1f}% ({res['mult']:,.1f}倍) | CAGR {res['cagr']:.2f}% | MDD {res['mdd']:.2f}% | Sharpe {res['sharpe']:.2f} | Calmar {res['calmar']:.3f} | 勝率 {res['win_rate']:.1f}% | 盲測CAGR {res['oos_cagr']:.2f}%")

# 輸出成格式化 Markdown 比較表
df_res = pd.DataFrame([{
    '開倉日': f"每月 {r['day']} 號",
    '22年總報酬率 (%)': f"+{r['tot_ret']:,.1f}%",
    '累積資產倍數': f"{r['mult']:,.1f} 倍",
    '年化 CAGR (%)': f"{r['cagr']:.2f}%",
    '最大回撤 MDD (%)': f"{r['mdd']:.2f}%",
    '夏普比率 (Sharpe)': f"{r['sharpe']:.2f}",
    '卡瑪比率 (Calmar)': f"{r['calmar']:.3f}",
    '月勝率 (%)': f"{r['win_rate']:.1f}%",
    '7.8年盲測 CAGR': f"{r['oos_cagr']:.2f}%",
    '盲測 MDD': f"{r['oos_mdd']:.2f}%"
} for r in results])

print("\n" + "=" * 80)
print("【各開倉日完整績效總對決表】")
print("=" * 80)
print(df_res.to_string(index=False))

# 年度回報矩陣
years = sorted(list(set([idx.year for r in results for idx in r['yearly_ret'].index])))
year_dict = {'年份': years}
for r in results:
    y_map = {idx.year: val for idx, val in r['yearly_ret'].items()}
    year_dict[f"{r['day']}號開倉"] = [round(y_map.get(y, 0.0), 1) for y in years]
df_years = pd.DataFrame(year_dict)

print("\n" + "=" * 80)
print("【各開倉日歷年年度報酬率對照表 (2004~2026)】")
print("=" * 80)
print(df_years.to_string(index=False))

# 保存結果為 json 方便分析
summary_json = {
    'summary': [{
        'day': r['day'],
        'tot_ret': r['tot_ret'],
        'mult': r['mult'],
        'cagr': r['cagr'],
        'mdd': r['mdd'],
        'calmar': r['calmar'],
        'sharpe': r['sharpe'],
        'win_rate': r['win_rate'],
        'oos_cagr': r['oos_cagr'],
        'oos_mdd': r['oos_mdd'],
        'oos_calmar': r['oos_calmar']
    } for r in results]
}

with open("rebalance_days_experiment_result.json", "w", encoding="utf-8") as f:
    json.dump(summary_json, f, ensure_ascii=False, indent=2)

print("\n實驗完成！結果已保存至 rebalance_days_experiment_result.json")
