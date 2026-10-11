import json
import pandas as pd
import numpy as np

# 載入 curve 與 trades
with open("frontend/src/data/global_titan_curve.json", "r") as f:
    curve = json.load(f)

with open("frontend/src/data/global_titan_trades.json", "r") as f:
    trades = json.load(f)

df_c = pd.DataFrame(curve)
df_c['date_dt'] = pd.to_datetime(df_c['date'])
df_c.set_index('date_dt', inplace=True)

df_t = pd.DataFrame(trades)
df_t['exit_dt'] = pd.to_datetime(df_t['exit_date'])

with open("frontend/src/data/defaultMarketMlData.json", "r") as f:
    market_data = json.load(f)

bs = market_data['backtest_simulation']
periods_dict = bs.get('periods', {})

# 為每個 period 計算指標
def calc_metrics_for_range(start_date, end_date):
    sub_c = df_c[(df_c.index >= start_date) & (df_c.index <= end_date)]
    if len(sub_c) < 2:
        return None
    eq = sub_c['strategy_equity']
    tot_ret = (eq.iloc[-1] / eq.iloc[0] - 1.0) * 100.0
    mult = eq.iloc[-1] / eq.iloc[0]
    days = (sub_c.index[-1] - sub_c.index[0]).days
    years = max(days / 365.25, 0.08)
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0 if mult > 0 else -100.0
    
    mdd = ((eq - eq.cummax()) / eq.cummax()).min() * 100.0
    
    # trades in range
    sub_t = df_t[(df_t['exit_dt'] >= start_date) & (df_t['exit_dt'] <= end_date)]
    t_cnt = len(sub_t)
    wins = len(sub_t[sub_t['return_pct'] > 0])
    win_rate = (wins / t_cnt * 100.0) if t_cnt > 0 else 50.0
    
    gain = sub_t[sub_t['return_pct'] > 0]['return_pct'].sum()
    loss = abs(sub_t[sub_t['return_pct'] <= 0]['return_pct'].sum())
    pf = (gain / loss) if loss > 0 else 9.99
    
    monthly_ret = eq.pct_change().dropna()
    rf = 0.02 / 12.0
    excess = monthly_ret - rf
    sharpe = (excess.mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    downside_std = monthly_ret[monthly_ret < 0].std()
    sortino = (excess.mean() / (downside_std + 1e-9)) * np.sqrt(12) if downside_std > 0 else 2.5
    
    exposure = sub_c['market_exposure_pct'].mean()
    
    return {
        "model_id": "global_liquid_titan_a",
        "name": "👑 全球高流動性泰坦方案 A (Top 4 階梯旗艦)",
        "short_name": "👑 全球泰坦方案 A",
        "model_name": "👑 全球高流動性泰坦方案 A (Top 4 階梯旗艦)",
        "total_return_pct": round(float(tot_ret), 2),
        "cagr_pct": round(float(cagr), 2),
        "alpha_pct": round(float(cagr - 12.0), 2),
        "max_drawdown_pct": round(float(mdd), 2),
        "sharpe_ratio": round(float(sharpe), 2),
        "sortino_ratio": round(float(sortino), 2),
        "win_rate_pct": round(float(win_rate), 1),
        "profit_factor": round(float(pf), 2),
        "total_trades": int(t_cnt),
        "market_exposure_pct": round(float(exposure), 1)
    }

latest_dt = df_c.index[-1]

for p_key, p_val in periods_dict.items():
    if p_key == 'all' or p_key == '20y':
        m_item = calc_metrics_for_range('2005-01-01', '2026-10-15')
    elif p_key == '10y':
        m_item = calc_metrics_for_range('2016-01-01', '2026-10-15')
    elif p_key == '5y':
        m_item = calc_metrics_for_range('2021-10-01', '2026-10-15')
    elif p_key == '3y':
        m_item = calc_metrics_for_range('2023-10-01', '2026-10-15')
    elif p_key == '1y':
        m_item = calc_metrics_for_range('2025-10-01', '2026-10-15')
    elif p_key == 'oos_2y':
        m_item = calc_metrics_for_range('2024-01-01', '2026-10-15')
    elif p_key.isdigit():
        yr = p_key
        m_item = calc_metrics_for_range(f'{yr}-01-01', f'{yr}-12-31')
    else:
        m_item = calc_metrics_for_range('2016-01-01', '2026-10-15')

    if m_item:
        comp_list = p_val.get('comparison_long_only', [])
        # 移除可能已存在的舊 global_liquid_titan_a
        comp_list = [x for x in comp_list if x.get('model_id') != 'global_liquid_titan_a']
        # 插入到第 0 位（最頂部）
        comp_list.insert(0, m_item)
        p_val['comparison_long_only'] = comp_list

# 保存更新後的 defaultMarketMlData.json
with open("frontend/src/data/defaultMarketMlData.json", "w", encoding="utf-8") as f:
    json.dump(market_data, f, ensure_ascii=False, indent=2)

print("[✓] 成功將 global_liquid_titan_a 注入 defaultMarketMlData.json 的所有回測區間！")
