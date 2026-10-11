import os
import sqlite3
import pandas as pd
import numpy as np
import time
import json
from itertools import product

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

print("[*] 正在載入全球高流動性資料庫 (2000~2026)...")
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("""
    SELECT ticker, date, open, adj_close
    FROM global_stock_daily
    ORDER BY date ASC
""", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])

# 剔除海外本土無美股ADR的交易所代碼 (.KS, .T, .DE, .SA)
# 保留：台股 (.TW)、美股、美股 ADR、SPY、QQQ
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

print(f"[*] 股票池標的數: {len(stock_tickers)} 檔, 交易日天數: {len(common_dates)}")

# 1. 預計算均線與技術指標
print("[*] 預計算均線與趨勢指標...")
ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()
ma60_slope5 = (ma60 - ma60.shift(5)) / ma60.shift(5)

# 2. 預計算各週期動能 (pct_change)
print("[*] 預計算各週期動能指標 (1M, 3M, 6M, 12M)...")
mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

# 3. 宏觀大盤指標
spy_adj = px_adj['SPY']
spy_ma200 = spy_adj.rolling(200).mean()
qqq_adj = px_adj['QQQ']
qqq_ma200 = qqq_adj.rolling(200).mean()

# 4. 月末結算日 (2004-01-01 ～ 2026-10-09)
month_ends = px_adj.groupby([px_adj.index.year, px_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

# 預計算每期的進場開盤日 (T+1) 與出場開盤日 (Next_T+1)
periods = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    future_dates = px_adj.index[px_adj.index > t_date]
    if len(future_dates) == 0: break
    t_plus_1 = future_dates[0]
    next_month_end = month_ends[i+1]
    next_future_dates = px_adj.index[px_adj.index > next_month_end]
    if len(next_future_dates) == 0: break
    next_exec_date = next_future_dates[0]
    periods.append((t_date, t_plus_1, next_exec_date))

print(f"[*] 總調倉期數: {len(periods)} 個月 (跨越 22.8 年)")

# 5. 定義 DOE 因子與水準
ALLOCATION_SCHEMES = {
    'Top1_100': [1.0],
    'Top2_50_50': [0.50, 0.50],
    'Top2_60_40': [0.60, 0.40],
    'Top2_70_30': [0.70, 0.30],
    'Top3_Equal': [1/3, 1/3, 1/3],
    'Top3_40_30_30': [0.40, 0.30, 0.30],
    'Top3_50_30_20': [0.50, 0.30, 0.20],
    'Top3_60_25_15': [0.60, 0.25, 0.15],
    'Top3_70_15_15': [0.70, 0.15, 0.15],
    'Top4_Equal': [0.25, 0.25, 0.25, 0.25],
    'Top4_40_25_20_15': [0.40, 0.25, 0.20, 0.15],
    'Top5_Equal': [0.20, 0.20, 0.20, 0.20, 0.20],
    'Top5_30_25_20_15_10': [0.30, 0.25, 0.20, 0.15, 0.10],
    'Top5_40_20_15_15_10': [0.40, 0.20, 0.15, 0.15, 0.10]
}

MOMENTUM_SCHEMES = {
    'MOM_12_3_1_STD': lambda: 0.50 * mom12m + 0.30 * mom3m + 0.20 * mom1m,
    'MOM_12_3_1_LONG': lambda: 0.70 * mom12m + 0.20 * mom3m + 0.10 * mom1m,
    'MOM_12_6_3_1_MULTI': lambda: 0.40 * mom12m + 0.30 * mom6m + 0.20 * mom3m + 0.10 * mom1m,
    'MOM_6_3_1_MID': lambda: 0.20 * mom12m + 0.50 * mom3m + 0.30 * mom1m,
    'MOM_3_1_FAST': lambda: 0.60 * mom3m + 0.40 * mom1m
}

FILTER_SCHEMES = ['FILT_MA60', 'FILT_MA60_200', 'FILT_MA20_60_200', 'FILT_MA60_SLOPE']
MACRO_SCHEMES = ['MACRO_NONE', 'MACRO_SPY_200MA_CASH', 'MACRO_SPY_200MA_HALF', 'MACRO_QQQ_200MA_CASH']
CAP_SCHEMES = ['CAP_NONE', 'CAP_MAX_SINGLE_MARKET_70']

# 預計算各動能矩陣
print("[*] 預計算各組動能矩陣...")
mom_matrices = {}
for m_name, func in MOMENTUM_SCHEMES.items():
    mom_matrices[m_name] = func()[stock_tickers]

# 預計算各期的個股報酬率 (T+1 Open -> Next Open)
print("[*] 預計算跨期收益率矩陣...")
period_returns = []
for t_date, t_in, t_out in periods:
    in_px = px_open.loc[t_in, stock_tickers]
    out_px = px_open.loc[t_out, stock_tickers]
    ret = (out_px / in_px) - 1.0
    period_returns.append(ret)

# 預計算宏觀風控狀態
macro_states = {}
for m_name in MACRO_SCHEMES:
    states = []
    for t_date, _, _ in periods:
        if m_name == 'MACRO_NONE':
            states.append(1.0) # 100% 倉位
        elif m_name == 'MACRO_SPY_200MA_CASH':
            p = spy_adj.loc[t_date]; m = spy_ma200.loc[t_date]
            states.append(1.0 if (pd.notna(p) and pd.notna(m) and p >= m) else 0.0)
        elif m_name == 'MACRO_SPY_200MA_HALF':
            p = spy_adj.loc[t_date]; m = spy_ma200.loc[t_date]
            states.append(1.0 if (pd.notna(p) and pd.notna(m) and p >= m) else 0.50)
        elif m_name == 'MACRO_QQQ_200MA_CASH':
            p = qqq_adj.loc[t_date]; m = qqq_ma200.loc[t_date]
            states.append(1.0 if (pd.notna(p) and pd.notna(m) and p >= m) else 0.0)
    macro_states[m_name] = states

friction = 0.0015 # 0.15% 摩擦成本

print(f"[*] 開始執行 DOE 參數網格全量搜尋...")
t0 = time.time()

doe_results = []
total_runs = len(ALLOCATION_SCHEMES) * len(MOMENTUM_SCHEMES) * len(FILTER_SCHEMES) * len(MACRO_SCHEMES) * len(CAP_SCHEMES)
print(f"[*] 總實驗組合數: {total_runs} 組")

count = 0
for mom_name, mom_mat in mom_matrices.items():
    for filt_name in FILTER_SCHEMES:
        # 預計算該動能與濾網下，每期的排序合格名單
        candidate_list_by_period = []
        for p_idx, (t_date, _, _) in enumerate(periods):
            m_scores = mom_mat.loc[t_date].dropna()
            m_scores = m_scores[m_scores > 0]
            if len(m_scores) == 0:
                candidate_list_by_period.append([])
                continue
            
            p_cur = px_adj.loc[t_date, m_scores.index]
            m60 = ma60.loc[t_date, m_scores.index]
            m200 = ma200.loc[t_date, m_scores.index]
            m20 = ma20.loc[t_date, m_scores.index]
            s5 = ma60_slope5.loc[t_date, m_scores.index]

            if filt_name == 'FILT_MA60':
                valid = (p_cur > m60)
            elif filt_name == 'FILT_MA60_200':
                valid = (p_cur > m60) & ((p_cur > m200) | m200.isna())
            elif filt_name == 'FILT_MA20_60_200':
                valid = (p_cur > m20) & (p_cur > m60) & ((p_cur > m200) | m200.isna())
            elif filt_name == 'FILT_MA60_SLOPE':
                valid = (p_cur > m60) & (s5 > 0)

            cand = m_scores[valid].sort_values(ascending=False)
            candidate_list_by_period.append(cand.index.tolist())

        # 針對 Allocation, Macro, Cap 快速跑模擬
        for alloc_name, weights in ALLOCATION_SCHEMES.items():
            k = len(weights)
            for cap_name in CAP_SCHEMES:
                for macro_name, m_state_list in macro_states.items():
                    count += 1
                    capital = 1.0
                    eq = [1.0]

                    for p_idx in range(len(periods)):
                        exposure = m_state_list[p_idx]
                        if exposure == 0:
                            # 100% 現金
                            eq.append(capital)
                            continue

                        cands = candidate_list_by_period[p_idx]
                        if len(cands) == 0:
                            eq.append(capital)
                            continue

                        # Cap 限制
                        if cap_name == 'CAP_MAX_SINGLE_MARKET_70':
                            selected = []
                            tw_cnt = 0
                            us_cnt = 0
                            max_single = int(np.ceil(k * 0.70))
                            for sym in cands:
                                is_tw = sym.endswith('.TW')
                                if is_tw and tw_cnt < max_single:
                                    selected.append(sym)
                                    tw_cnt += 1
                                elif not is_tw and us_cnt < max_single:
                                    selected.append(sym)
                                    us_cnt += 1
                                if len(selected) == k:
                                    break
                        else:
                            selected = cands[:k]

                        n_sel = len(selected)
                        if n_sel == 0:
                            eq.append(capital)
                            continue

                        w_sub = weights[:n_sel]
                        tot_w = sum(w_sub)
                        w_norm = [w / tot_w * exposure for w in w_sub]

                        ret_series = period_returns[p_idx]
                        period_ret = 0.0
                        for sym, w in zip(selected, w_norm):
                            r = ret_series.get(sym, 0.0)
                            if pd.isna(r): r = 0.0
                            period_ret += w * (r - friction)

                        capital *= (1.0 + period_ret)
                        eq.append(capital)

                    eq_arr = np.array(eq)
                    tot_mult = eq_arr[-1]
                    years = 22.8
                    cagr = (tot_mult ** (1.0 / years) - 1.0) * 100.0 if tot_mult > 0 else -100.0
                    
                    peaks = np.maximum.accumulate(eq_arr)
                    dds = (eq_arr - peaks) / peaks
                    mdd = np.min(dds) * 100.0
                    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

                    doe_results.append({
                        'alloc': alloc_name,
                        'k': k,
                        'mom': mom_name,
                        'filt': filt_name,
                        'macro': macro_name,
                        'cap': cap_name,
                        'mult': round(tot_mult, 2),
                        'cagr': round(cagr, 2),
                        'mdd': round(mdd, 2),
                        'calmar': round(calmar, 3)
                    })

t1 = time.time()
print(f"[✓] 全量 DOE 完成！總計執行 {len(doe_results)} 組回測，耗時 {t1 - t0:.2f} 秒！")

# 轉成 DataFrame 進行分析
doe_df = pd.DataFrame(doe_results)
doe_df.to_csv("global_titan_doe_all_results.csv", index=False)

print("\n=== DOE 最佳卡瑪比率 (Calmar Ratio: 風險調整後報酬) TOP 10 ===")
top_calmar = doe_df.sort_values(by='calmar', ascending=False).head(10)
print(top_calmar.to_string(index=False))

print("\n=== DOE 最佳年化報酬 (CAGR) TOP 10 ===")
top_cagr = doe_df.sort_values(by='cagr', ascending=False).head(10)
print(top_cagr.to_string(index=False))

print("\n=== DOE 各選股配比 (Allocation) 平均表現 ===")
alloc_summary = doe_df.groupby('alloc').agg({
    'cagr': ['mean', 'max'],
    'mdd': ['mean', 'min'],
    'calmar': ['mean', 'max']
}).round(2)
print(alloc_summary)

