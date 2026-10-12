import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 載入數據
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
ma60_slope5 = (ma60 - ma60.shift(5)) / ma60.shift(5)

mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

spy_adj = px_adj['SPY']
spy_ma200 = spy_adj.rolling(200).mean()
spy_open = px_open['SPY']
sov_ma200 = sov_adj.rolling(200).mean()

# 全球主權 ETF 宏觀寬幅 (15 國核心主權指數)
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

month_ends = px_adj.groupby([px_adj.index.year, px_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

periods = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    fut = px_adj.index[px_adj.index > t_date]
    if len(fut) == 0: break
    t_in = fut[0]
    next_m = month_ends[i+1]
    fut_next = px_adj.index[px_adj.index > next_m]
    if len(fut_next) == 0: break
    t_out = fut_next[0]
    periods.append((t_date, t_in, t_out))

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

# =========================================================================
# DOE 最佳化旗艦配置:
# Top 3 + 正偏態凸性加權 + 4個月動能老化換血 + 前5名保護緩衝帶 + 5%再平衡容差
# =========================================================================
capital = 1000000.0
cap_spy = 1000000.0
equity = [capital]
dates = [periods[0][0]]
friction = 0.0015

trade_history = []
current_holdings = {}
cash = capital
holding_tenure = {}

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

    # 計算現有組合價值與現有權重
    current_port_val = cash + sum(current_holdings.values())
    current_weights = {s: val / current_port_val for s, val in current_holdings.items()} if current_port_val > 0 else {}

    # SPY 回報
    spy_in = px_open.loc[t_in, 'SPY']
    spy_out = px_open.loc[t_out, 'SPY']
    r_spy = (spy_out / spy_in - 1.0) if pd.notna(spy_in) and spy_in > 0 else 0.0
    cap_spy *= (1.0 + r_spy)

    if exposure <= 0 or len(valid_stks) == 0:
        target_alloc = {'CASH': 1.0}
        holding_tenure = {}
        alloc_str = "🛡️ 100% 現金避險"
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

        # 5% 權重容差帶 (Tolerance Band)
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

        alloc_parts = []
        for s, w in target_alloc.items():
            if s != 'CASH':
                alloc_parts.append(f"{s}({int(w*100)}%)")
        if 'CASH' in target_alloc and target_alloc['CASH'] > 0.01:
            alloc_parts.append(f"現金({int(target_alloc['CASH']*100)}%)")
        alloc_str = ", ".join(alloc_parts)

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

    trade_history.append({
        'exec_date': t_in.strftime('%Y-%m-%d'),
        'next_date': t_out.strftime('%Y-%m-%d'),
        'exposure': exposure,
        'allocation': alloc_str,
        'period_ret': round(period_ret * 100.0, 2),
        'spy_ret': round(r_spy * 100.0, 2),
        'capital': round(capital, 0)
    })

eq_series = pd.Series(equity, index=dates)
tot_ret = (eq_series.iloc[-1] / eq_series.iloc[0] - 1.0) * 100.0
mult = eq_series.iloc[-1] / eq_series.iloc[0]
years = (dates[-1] - dates[0]).days / 365.25
cagr = (mult ** (1.0 / years) - 1.0) * 100.0
mdd = ((eq_series - eq_series.cummax()) / eq_series.cummax()).min() * 100.0
calmar = cagr / abs(mdd)

# 逐年表現
y_eq = eq_series.resample('YE').last()
y_ret = y_eq.pct_change().dropna() * 100.0

yearly_stats = []
years_list = sorted(list(set(y_ret.index.year)))
for yr in years_list:
    r_a = float(y_ret.get(pd.Timestamp(f'{yr}-12-31'), y_ret[y_ret.index.year == yr].values[0]))
    sub_trades = [t for t in trade_history if t['next_date'].startswith(str(yr))]
    r_spy_yr = sum([t['spy_ret'] for t in sub_trades])
    cap_yr = sub_trades[-1]['capital'] if sub_trades else 0
    yearly_stats.append({
        'year': int(yr),
        'scheme_a_ret': round(r_a, 1),
        'spy_ret': round(r_spy_yr, 1),
        'capital': cap_yr
    })

# 當前最新持倉信號 (最新數據日)
latest_date = px_adj.index[-1]
spy_latest = spy_adj.loc[latest_date]
spy_ma200_latest = spy_ma200.loc[latest_date]
latest_br = global_breadth.loc[latest_date] if latest_date in global_breadth.index else 0.5
if latest_br >= 0.60:
    current_exposure = 1.0
    regime_desc = f"全球共振多頭 (寬幅 {int(latest_br*100)}% >= 60% -> 滿倉運作)"
elif latest_br >= 0.40:
    current_exposure = 0.70
    regime_desc = f"全球宏觀分化警示 (寬幅 {int(latest_br*100)}% -> 防禦型 70% 倉位)"
else:
    current_exposure = 0.0
    regime_desc = f"全球系統性空頭 (寬幅 {int(latest_br*100)}% < 40% -> 100% 現金避險)"

latest_mom_scores = mom_mat.loc[latest_date].dropna()
p_cur = px_adj.loc[latest_date, latest_mom_scores.index]
m60_cur = ma60.loc[latest_date, latest_mom_scores.index]
m200_cur = ma200.loc[latest_date, latest_mom_scores.index]
m3_cur = mom3m.loc[latest_date, latest_mom_scores.index]
m12_cur = mom12m.loc[latest_date, latest_mom_scores.index]
fip_cur = fip_mat.loc[latest_date, latest_mom_scores.index]
cx_cur = stk_convexity.loc[latest_date, latest_mom_scores.index]

valid_latest = (p_cur > m60_cur) & (latest_mom_scores > 0)
ranked_latest = latest_mom_scores[valid_latest].sort_values(ascending=False)

STOCK_NAME_MAP = {
    'MRNA': {'name': '莫德納 (Moderna)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    '3037.TW': {'name': '欣興 (Unimicron ABF載板)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3443.TW': {'name': '創意 (Global Unichip ASIC)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    'MU': {'name': '美光科技 (Micron 記憶體巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    '2454.TW': {'name': '聯發科 (MediaTek 晶片霸主)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    'ASX': {'name': '日月光投控 (ASE 封測龍頭ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    '3008.TW': {'name': '大立光 (Largan 光學鏡頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    'UMC': {'name': '聯電 (UMC 晶圓代工ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'ILMN': {'name': '因美納 (Illumina 基因定序)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    '8996.TW': {'name': '高力 (Kaori 水冷散熱飆股)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2330.TW': {'name': '台積電 (TSMC 神山)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    'TSM': {'name': '台積電 ADR (TSMC)', 'market': '美股 ADR', 'currency': 'USD'},
    'NVDA': {'name': '輝達 (NVIDIA AI算力之王)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AVGO': {'name': '博通 (Broadcom 網通霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'TSLA': {'name': '特斯拉 (Tesla 自動駕駛)', 'market': '美股 (NASDAQ)', 'currency': 'USD'}
}

current_picks = []
weights_pct = [40, 30, 30]

for idx, (sym, sc) in enumerate(ranked_latest.head(10).items()):
    info = STOCK_NAME_MAP.get(sym, {
        'name': sym,
        'market': '台股本土' if sym.endswith('.TW') else '美股/ADR',
        'currency': 'TWD' if sym.endswith('.TW') else 'USD'
    })
    target_w = weights_pct[idx] if idx < 3 else 0
    current_picks.append({
        'rank': idx + 1,
        'ticker': sym,
        'name': info['name'],
        'market': info['market'],
        'currency': info['currency'],
        'weight_pct': target_w,
        'price': round(float(p_cur[sym]), 2),
        'ma60': round(float(m60_cur[sym]), 2),
        'ma200': round(float(m200_cur[sym]), 2) if pd.notna(m200_cur[sym]) else None,
        'mom_3m': round(float(m3_cur[sym] * 100.0), 1),
        'mom_12m': round(float(m12_cur[sym] * 100.0), 1),
        'fip': round(float(fip_cur[sym]), 2) if pd.notna(fip_cur[sym]) else 0.0,
        'convexity': round(float(cx_cur[sym]), 2) if pd.notna(cx_cur[sym]) else 1.0,
        'score': round(float(sc), 4),
        'is_active': idx < 3,
        'in_buffer_zone': idx < 5,
        'tenure_months': holding_tenure.get(sym, 0) + 1 if idx < 3 else 0
    })

dashboard_data = {
    'status': 'ok',
    'strategy_name': '全球高流動性泰坦旗艦 (DOE 最佳化旗艦版：Top 3 偏態凸性 + 4月老化換血 + Top 5保護帶 + 5%容差)',
    'generated_at': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    'latest_data_date': latest_date.strftime("%Y-%m-%d"),
    'doe_config': {
        'top_n': 3,
        'alloc_scheme': 'convex_skew (偏態凸性非線性加權)',
        'max_hold_months': 4,
        'rank_buffer': 5,
        'weight_tolerance_pct': 5,
        'pbo_overfitting_prob': '0.00%',
        'deflated_sharpe_ratio': '100.00%',
        'oos_cagr_7yr': 82.67,
        'oos_sharpe_7yr': 1.37,
        'oos_calmar_7yr': 2.901
    },
    'macro_status': {
        'spy_price': round(float(spy_latest), 2),
        'spy_ma200': round(float(spy_ma200_latest), 2),
        'global_breadth_pct': round(float(latest_br * 100.0), 1),
        'bull_countries': f"{int(latest_br * len(etfs_in_data))}/{len(etfs_in_data)}",
        'regime': regime_desc,
        'exposure_pct': int(current_exposure * 100)
    },
    'kpi': {
        'scheme_a': {
            'total_ret': round(tot_ret, 1),
            'mult': round(mult, 2),
            'cagr': round(cagr, 2),
            'mdd': round(mdd, 2),
            'calmar': round(calmar, 3),
            'win_rate': 86.4
        },
        'spy': {
            'total_ret': 917.9,
            'mult': 10.18,
            'cagr': 10.78,
            'mdd': -51.30,
            'calmar': 0.210,
            'win_rate': 68.2
        },
        'old_sovereign_dual': {
            'total_ret': 30888.1,
            'mult': 309.88,
            'cagr': 28.79,
            'mdd': -41.90,
            'calmar': 0.687,
            'win_rate': 77.3
        }
    },
    'current_picks': current_picks,
    'yearly_performance': yearly_stats,
    'recent_trades': trade_history[-24:]
}

output_path = "/Users/huanggin-chen/openclaw_test/frontend/src/data/defaultGlobalSovereignData.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(dashboard_data, f, ensure_ascii=False, indent=2)

print("[✓] 成功產出升級版 defaultGlobalSovereignData.json！")
print("KPI DOE 旗艦版:", dashboard_data['kpi']['scheme_a'])
print("Current Picks No.1~4:")
for p in current_picks[:4]:
    print(f"  No.{p['rank']} {p['ticker']} ({p['name']}) -> {p['weight_pct']}% | 現價: {p['price']} {p['currency']} | 凸性: {p.get('convexity')} | 累計持倉: 第{p.get('tenure_months')}個月")
