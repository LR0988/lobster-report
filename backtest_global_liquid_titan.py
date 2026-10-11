import sys
sys.path.append("/Users/huanggin-chen/gemini-stock-analysis")
import os
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

# 國內券商可買池：美股/ADR (不含 .KS, .T, .DE, .SA) + 台股 (.TW)，並嚴格排除基準 ETF (0050.TW, SPY, QQQ)
domestic_tickers = [c for c in stk_adj.columns if not any(c.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA']) and c not in ['0050.TW', 'SPY', 'QQQ']]

# 指標計算
sov_ma200 = sov_adj.rolling(200).mean()
sov_mom12m = sov_adj.pct_change(252)
sov_mom3m = sov_adj.pct_change(63)
sov_mom1m = sov_adj.pct_change(21)
sov_score = 0.50 * sov_mom12m + 0.30 * sov_mom3m + 0.20 * sov_mom1m

stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
stk_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

# 學術頂刊 FIP 漸進動能 (Frog in the Pan, Da et al. 2014 Journal of Finance)
stk_ret = stk_adj.pct_change()
stk_pos = (stk_ret > 0).rolling(252).sum()
stk_neg = (stk_ret < 0).rolling(252).sum()
stk_fip = (stk_pos - stk_neg) / (stk_pos + stk_neg + 1e-9)
stk_score_fip = stk_score * (1.0 + 0.5 * stk_fip)

candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

from sync_true_domestic_stocks import DOMESTIC_UNIVERSE

def run_model(model_name):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015 # 0.15% per trade
    trade_logs = []

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        future_dates = sov_adj.index[sov_adj.index > t_date]
        if len(future_dates) == 0: break
        t_plus_1 = future_dates[0]
        next_month_end = month_ends[i+1]
        next_future_dates = sov_adj.index[sov_adj.index > next_month_end]
        if len(next_future_dates) == 0: break
        next_exec_date = next_future_dates[0]

        target_alloc = {}

        if model_name == 'SPY_BUY_HOLD':
            target_alloc = {'SPY': 1.0}

        elif model_name == 'STAGE1_ETF_ONLY':
            valid_etfs = []
            for etf in candidate_etfs:
                if etf in sov_adj.columns:
                    p = sov_adj.loc[t_date, etf]; m200 = sov_ma200.loc[t_date, etf]; sc = sov_score.loc[t_date, etf]
                    if pd.notna(p) and pd.notna(m200) and pd.notna(sc) and p > m200 and sc > 0:
                        valid_etfs.append((etf, sc))
            valid_etfs.sort(key=lambda x: x[1], reverse=True)
            c1 = valid_etfs[0][0] if len(valid_etfs) > 0 else 'CASH'
            target_alloc = {c1: 1.0}

        elif model_name == 'TWO_STAGE_DUAL_TITAN': # 50/50 跨國本土雙雄
            valid_etfs = []
            for etf in candidate_etfs:
                if etf in sov_adj.columns:
                    p = sov_adj.loc[t_date, etf]; m200 = sov_ma200.loc[t_date, etf]; sc = sov_score.loc[t_date, etf]
                    if pd.notna(p) and pd.notna(m200) and pd.notna(sc) and p > m200 and sc > 0:
                        valid_etfs.append((etf, sc))
            valid_etfs.sort(key=lambda x: x[1], reverse=True)
            c1 = valid_etfs[0][0] if len(valid_etfs) > 0 else 'CASH'
            c2 = valid_etfs[1][0] if len(valid_etfs) > 1 else 'CASH'

            for c, w in [(c1, 0.50), (c2, 0.50)]:
                if c == 'CASH':
                    target_alloc['CASH'] = target_alloc.get('CASH', 0.0) + w
                else:
                    stk_pool = DOMESTIC_UNIVERSE.get(c, [])
                    valid_stks = []
                    for s in stk_pool:
                        if s in stk_adj.columns:
                            sp = stk_adj.loc[t_date, s]; m6 = stk_ma60.loc[t_date, s]; m2 = stk_ma200.loc[t_date, s]; sc = stk_score.loc[t_date, s]
                            if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
                                valid_stks.append((s, sc))
                    valid_stks.sort(key=lambda x: x[1], reverse=True)
                    if len(valid_stks) > 0:
                        target_alloc[valid_stks[0][0]] = target_alloc.get(valid_stks[0][0], 0.0) + w
                    else:
                        target_alloc[c] = target_alloc.get(c, 0.0) + w

        elif 'DIRECT_TITAN' in model_name:
            # 扁平化全球國內可買高流動性池選股
            score_source = stk_score_fip if 'FIP' in model_name else stk_score
            valid_stks = []
            for s in domestic_tickers:
                sp = stk_adj.loc[t_date, s]
                m6 = stk_ma60.loc[t_date, s]
                m2 = stk_ma200.loc[t_date, s]
                sc = score_source.loc[t_date, s]
                if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
                    valid_stks.append((s, sc))
            valid_stks.sort(key=lambda x: x[1], reverse=True)

            exposure = 1.0
            if 'BREADTH_GRADED' in model_name:
                br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
                if br >= 0.60: exposure = 1.0
                elif br >= 0.40: exposure = 0.70
                else: exposure = 0.0
            elif 'MACRO' in model_name:
                spy_p = sov_adj.loc[t_date, 'SPY']
                spy_m200 = sov_ma200.loc[t_date, 'SPY']
                if pd.notna(spy_p) and pd.notna(spy_m200) and spy_p < spy_m200:
                    exposure = 0.0

            if exposure <= 0 or len(valid_stks) == 0:
                target_alloc = {'CASH': 1.0}
            else:
                target_alloc = {}
                if 'TOP1' in model_name:
                    target_alloc = {valid_stks[0][0]: exposure}
                elif 'TOP2' in model_name:
                    if len(valid_stks) >= 2:
                        target_alloc = {valid_stks[0][0]: 0.50 * exposure, valid_stks[1][0]: 0.50 * exposure}
                    else:
                        target_alloc = {valid_stks[0][0]: exposure}
                elif 'TOP3' in model_name:
                    n = min(3, len(valid_stks))
                    weights = [0.40, 0.30, 0.30][:n]
                    tot_w = sum(weights)
                    weights = [w / tot_w * exposure for w in weights]
                    for idx in range(n):
                        target_alloc[valid_stks[idx][0]] = weights[idx]
                elif 'TOP5' in model_name:
                    n = min(5, len(valid_stks))
                    w_each = (1.0 / n) * exposure
                    for idx in range(n):
                        target_alloc[valid_stks[idx][0]] = w_each
                if exposure < 1.0:
                    target_alloc['CASH'] = target_alloc.get('CASH', 0.0) + (1.0 - exposure)

        # 績效計算
        period_ret = 0.0
        details = []
        for sym, w in target_alloc.items():
            if sym == 'CASH':
                ret_s = 0.0
            else:
                p_in = stk_open.loc[t_plus_1, sym] if sym in stk_open.columns else sov_open.loc[t_plus_1, sym]
                p_out = stk_open.loc[next_exec_date, sym] if sym in stk_open.columns else sov_open.loc[next_exec_date, sym]
                ret_s = (p_out / p_in - 1.0) if pd.notna(p_in) and p_in > 0 else 0.0
            period_ret += w * (ret_s - (0.0 if model_name == 'SPY_BUY_HOLD' else friction))
            details.append(f"{sym}({int(w*100)}%)")

        capital *= (1.0 + period_ret)
        equity.append(capital)
        dates.append(next_exec_date)
        trade_logs.append({
            'date': next_exec_date.strftime('%Y-%m-%d'),
            'alloc': ", ".join(details),
            'ret': period_ret,
            'capital': capital
        })

    eq_s = pd.Series(equity, index=dates)
    tot_ret = (eq_s.iloc[-1] / eq_s.iloc[0] - 1.0) * 100.0
    mult = eq_s.iloc[-1] / eq_s.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_s - eq_s.cummax()) / eq_s.cummax()).min() * 100.0

    # 月回報序列
    monthly_ret = eq_s.pct_change().dropna()
    rf = 0.02 / 12.0
    excess_ret = monthly_ret - rf
    sharpe = (excess_ret.mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

    y_eq = eq_s.resample('YE').last()
    y_ret = y_eq.pct_change().dropna() * 100.0

    return {
        'name': model_name,
        'tot_ret': tot_ret,
        'mult': mult,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'calmar': calmar,
        'y_ret': y_ret,
        'trade_logs': trade_logs
    }

models = [
    'SPY_BUY_HOLD',
    'STAGE1_ETF_ONLY',
    'TWO_STAGE_DUAL_TITAN',
    'DIRECT_TITAN_TOP3',
    'DIRECT_TITAN_TOP3_MACRO',
    'DIRECT_TITAN_TOP3_MACRO_FIP',
    'DIRECT_TITAN_TOP3_BREADTH_GRADED_FIP',
]

results = {}
for m in models:
    res = run_model(m)
    results[m] = res
    print(f"[{m:<24}] 累積: {res['tot_ret']:>10.1f}% ({res['mult']:>8.2f}x) | CAGR: {res['cagr']:>5.2f}% | MDD: {res['mdd']:>6.2f}% | Sharpe: {res['sharpe']:>4.2f} | Calmar: {res['calmar']:>4.2f}")

# 關鍵年份對比 (2008 次貸, 2018 貿易戰, 2020 疫情, 2022 升息暴跌, 2023 AI 爆發, 2024 AI 狂飆)
years_to_check = ['2008', '2018', '2020', '2022', '2023', '2024', '2025']
print("\n=== 關鍵年份年度回報對比 (%) ===")
header = f"{'Model':<24}" + "".join([f"{y:>9}" for y in years_to_check])
print(header)
print("-" * len(header))
for m in models:
    row = f"{m:<24}"
    y_series = results[m]['y_ret']
    for y in years_to_check:
        matching = [val for idx, val in y_series.items() if str(idx.year) == y]
        val_str = f"{matching[0]:>8.1f}%" if len(matching) > 0 else "     N/A"
        row += val_str
    print(row)

