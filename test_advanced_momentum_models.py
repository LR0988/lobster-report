import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

print("載入全球行情數據庫...")
conn = sqlite3.connect(DB_PATH)
sov_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
stk_df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
conn.close()

sov_df['date'] = pd.to_datetime(sov_df['date'])
stk_df['date'] = pd.to_datetime(stk_df['date'])

# 計算還原開盤價
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

print(f"國內可買池標的數: {len(domestic_tickers)}")

# 1. 基礎指標計算
stk_ma60 = stk_adj.rolling(60).mean()
stk_ma200 = stk_adj.rolling(200).mean()
stk_mom12m = stk_adj.pct_change(252)
stk_mom3m = stk_adj.pct_change(63)
stk_mom1m = stk_adj.pct_change(21)
raw_score = 0.50 * stk_mom12m + 0.30 * stk_mom3m + 0.20 * stk_mom1m

sov_ma200 = sov_adj.rolling(200).mean()

# 2. 學術前沿因子 1: FIP (Frog-in-the-Pan / 漸進式動能)
# 計算過去 252 天中，每日漲跌符號
stk_daily_ret = stk_adj.pct_change()
pos_days = (stk_daily_ret > 0).rolling(252).sum()
neg_days = (stk_daily_ret < 0).rolling(252).sum()
tot_days = pos_days + neg_days
# FIP 介於 -1 到 +1 之間，越高代表漲幅是微幅連漲堆疊，而非單日暴衝
fip_score = (pos_days - neg_days) / (tot_days + 1e-9)

# 3. 學術前沿因子 2: 波動率與質量動能 (Quality Momentum / Sharpe Momentum)
# 年化個股波動率
stk_vol = stk_daily_ret.rolling(252).std() * np.sqrt(252)
sharpe_mom_score = raw_score / (stk_vol + 1e-6)

# 4. 學術前沿因子 3: 宏觀已實現波動率 (SPY Realized Volatility for Vol-Managed Momentum)
spy_ret = sov_adj['SPY'].pct_change()
spy_vol63 = spy_ret.rolling(63).std() * np.sqrt(252) # 3 個月滾動已實現波動率

month_ends = sov_adj.groupby([sov_adj.index.year, sov_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

def simulate_strategy(
    scoring_mode="raw",       # "raw", "fip_mult", "fip_two_stage", "quality_sharpe", "composite_fip_sharpe"
    vol_managed=False,        # Barroso & Santa-Clara (2015) 波動率動態部位管理
    target_vol=0.15,          # 目標波動率
    use_breakeven=False,      # +20% 保本平手線
    breakeven_trigger=0.20
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    target_weights = [0.40, 0.30, 0.30]

    for i in range(len(month_ends) - 1):
        t_date = month_ends[i]
        next_month_end = month_ends[i+1]

        # 宏觀濾網: SPY > 200MA
        p_spy = sov_adj.loc[t_date, 'SPY']
        m200_spy = sov_ma200.loc[t_date, 'SPY']
        if pd.isna(p_spy) or pd.isna(m200_spy) or p_spy < m200_spy:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        future_dates = sov_adj.index[(sov_adj.index > t_date) & (sov_adj.index <= next_month_end)]
        if len(future_dates) == 0: continue
        t_entry = future_dates[0]
        sub_dates = list(future_dates)

        # 篩選股票池
        valid_stks = []
        for s in domestic_tickers:
            sp = stk_adj.loc[t_date, s]
            m6 = stk_ma60.loc[t_date, s]
            m2 = stk_ma200.loc[t_date, s]
            sc = raw_score.loc[t_date, s]
            fip = fip_score.loc[t_date, s]
            q_sc = sharpe_mom_score.loc[t_date, s]

            if pd.notna(sp) and pd.notna(m6) and pd.notna(sc) and sp > m6 and (sp > m2 if pd.notna(m2) else True) and sc > 0:
                valid_stks.append({
                    'symbol': s,
                    'raw_score': sc,
                    'fip': fip if pd.notna(fip) else 0.0,
                    'sharpe_mom': q_sc if pd.notna(q_sc) else 0.0
                })

        if len(valid_stks) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        # 依不同選股模型排序
        if scoring_mode == "raw":
            valid_stks.sort(key=lambda x: x['raw_score'], reverse=True)
            picks = [x['symbol'] for x in valid_stks[:3]]
        elif scoring_mode == "fip_mult":
            # FIP 增強: 分數 * (1 + FIP)
            # FIP > 0 代表正收益天數佔優，增強得分；FIP < 0 代表單日暴衝但負天數多，扣分
            valid_stks.sort(key=lambda x: x['raw_score'] * (1.0 + x['fip']), reverse=True)
            picks = [x['symbol'] for x in valid_stks[:3]]
        elif scoring_mode == "fip_two_stage":
            # 兩階段: 前 10 名動能股中，選 FIP 最高的 3 檔 (最純粹的溫和慢牛)
            valid_stks.sort(key=lambda x: x['raw_score'], reverse=True)
            pool = valid_stks[:10]
            pool.sort(key=lambda x: x['fip'], reverse=True)
            picks = [x['symbol'] for x in pool[:3]]
        elif scoring_mode == "quality_sharpe":
            # 質量動能: 動能 / 波動率
            valid_stks.sort(key=lambda x: x['sharpe_mom'], reverse=True)
            picks = [x['symbol'] for x in valid_stks[:3]]
        elif scoring_mode == "composite_fip_sharpe":
            # 複合因子: 質量動能 * (1 + FIP)
            valid_stks.sort(key=lambda x: x['sharpe_mom'] * (1.0 + x['fip']), reverse=True)
            picks = [x['symbol'] for x in valid_stks[:3]]
        else:
            picks = [x['symbol'] for x in valid_stks[:3]]

        # 決定總倉位比例 (Volatility Management)
        market_scale = 1.0
        if vol_managed:
            # Barroso & Santa-Clara 2015: 倉位與滾動波動率反比
            cur_spy_vol = spy_vol63.loc[t_date]
            if pd.notna(cur_spy_vol) and cur_spy_vol > 0:
                # 波動率縮放，最高 1.0 (不開槓桿)，低於 target_vol 時全倉，高於時降倉留現金
                market_scale = min(1.0, target_vol / cur_spy_vol)

        n = min(len(picks), 3)
        actual_weights = [target_weights[idx] * market_scale for idx in range(n)]
        cash_weight = 1.0 - sum(actual_weights)

        # 模擬持股與月內停損/保本平手
        # 初始化部位
        pos_states = {}
        for idx in range(n):
            sym = picks[idx]
            w = actual_weights[idx]
            entry_p = stk_open.loc[t_entry, sym] if sym in stk_open.columns else np.nan
            if pd.notna(entry_p) and entry_p > 0:
                pos_states[sym] = {
                    'w': w,
                    'entry_p': entry_p,
                    'peak_ret': 0.0,
                    'hit_be': False,
                    'status': 'HOLD',
                    'exit_ret': 0.0
                }
            else:
                cash_weight += w

        # 逐日監控保本停損
        for d in sub_dates[1:]:
            for sym, state in pos_states.items():
                if state['status'] != 'HOLD':
                    continue
                open_p = stk_open.loc[d, sym]
                if pd.isna(open_p) or open_p <= 0:
                    continue
                day_ret = open_p / state['entry_p'] - 1.0
                if day_ret > state['peak_ret']:
                    state['peak_ret'] = day_ret

                if use_breakeven:
                    if state['peak_ret'] >= breakeven_trigger:
                        state['hit_be'] = True
                    if state['hit_be'] and day_ret <= 0.0:
                        state['status'] = 'EXIT_BREAKEVEN'
                        state['exit_ret'] = -friction

        # 月末結算
        month_end_d = sub_dates[-1]
        period_ret = 0.0
        for sym, state in pos_states.items():
            if state['status'] == 'HOLD':
                final_p = stk_open.loc[month_end_d, sym]
                stock_ret = (final_p / state['entry_p'] - 1.0) if pd.notna(final_p) and final_p > 0 else 0.0
                net_ret = stock_ret - friction
            else:
                net_ret = state['exit_ret']
            period_ret += state['w'] * net_ret

        capital *= (1.0 + period_ret)
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
    sharpe = ((monthly_ret - rf).mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

    return {
        'tot_ret': tot_ret,
        'mult': mult,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'calmar': calmar
    }

print("\n=== 開始執行學術前沿機制回測矩陣 (2004 - 2026, 22年全歷史) ===")
experiments = [
    ("1. 現行基準 (Raw Momentum)", "raw", False, 0.15, False),
    ("2. FIP 漸進乘數 (Score * (1+FIP))", "fip_mult", False, 0.15, False),
    ("3. FIP 兩階段選股 (Top10 動能選 Top3 FIP)", "fip_two_stage", False, 0.15, False),
    ("4. Quality Sharpe 動能 (Mom / Vol)", "quality_sharpe", False, 0.15, False),
    ("5. 複合 FIP + Quality Sharpe", "composite_fip_sharpe", False, 0.15, False),
    ("6. 基準 + 波動率管理 (Vol-Managed 15%)", "raw", True, 0.15, False),
    ("7. 基準 + 波動率管理 (Vol-Managed 18%)", "raw", True, 0.18, False),
    ("8. FIP 漸進乘數 + 波動率管理 18%", "fip_mult", True, 0.18, False),
    ("9. FIP 漸進乘數 + +20%保本平手線", "fip_mult", False, 0.15, True),
    ("10. 終極結合: FIP + Vol-Managed 18% + 保本平手線", "fip_mult", True, 0.18, True),
    ("11. 終極結合: FIP兩階段 + Vol-Managed 18% + 保本平手線", "fip_two_stage", True, 0.18, True),
]

results_table = []
for name, smode, vman, tvol, be in experiments:
    res = simulate_strategy(scoring_mode=smode, vol_managed=vman, target_vol=tvol, use_breakeven=be)
    results_table.append({
        'Model': name,
        'CAGR': res['cagr'],
        'Multiplier': res['mult'],
        'MDD': res['mdd'],
        'Sharpe': res['sharpe'],
        'Calmar': res['calmar']
    })
    print(f"{name:<42} | CAGR: {res['cagr']:>5.2f}% | MDD: {res['mdd']:>6.2f}% | Sharpe: {res['sharpe']:>4.2f} | Calmar: {res['calmar']:>4.2f} | 總乘數: {res['mult']:>8.1f}x")

df_res = pd.DataFrame(results_table)
df_res.to_csv("quant_advancements_doe.csv", index=False)
print("\n結果已儲存至 quant_advancements_doe.csv")
