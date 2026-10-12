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

bs = market_data.get('backtest_simulation', {})
periods_dict = bs.get('periods', {})

top3_positions = [
    {
        "stock_id": "MRNA",
        "stock_name": "莫德納 (Moderna)",
        "role": "👑 第1王者 (40%)",
        "target_weight_pct": 40.0,
        "weight_pct": 40.0,
        "entry_date": "20261001",
        "entry_price": 186.61,
        "current_price": 225.0,
        "latest_price": 225.0,
        "unrealized_return_pct": 20.57,
        "holding_days": 8,
        "ma60_stop_price": 126.18,
        "stop_loss_ma60": 126.18,
        "dist_to_stop_pct": 78.3,
        "currency": "USD",
        "stop_condition": "👑 最高Calmar冠軍 (40%重壓)：大主升段續抱狂奔！無短線均線過敏干擾，SPY破年線才清倉"
    },
    {
        "stock_id": "3037.TW",
        "stock_name": "欣興 (Unimicron ABF載板)",
        "role": "🥈 第2主力 (30%)",
        "target_weight_pct": 30.0,
        "weight_pct": 30.0,
        "entry_date": "20261001",
        "entry_price": 1195.0,
        "current_price": 1270.0,
        "latest_price": 1270.0,
        "unrealized_return_pct": 6.28,
        "holding_days": 8,
        "ma60_stop_price": 1026.38,
        "stop_loss_ma60": 1026.38,
        "dist_to_stop_pct": 23.8,
        "currency": "TWD",
        "stop_condition": "🥈 第2主力 (30%配置)：載板王者主升段奔馳！持滿整月，不被盤中洗盤震下車"
    },
    {
        "stock_id": "3443.TW",
        "stock_name": "創意 (Global Unichip ASIC)",
        "role": "🥉 第3主力 (30%)",
        "target_weight_pct": 30.0,
        "weight_pct": 30.0,
        "entry_date": "20261001",
        "entry_price": 8040.0,
        "current_price": 8360.0,
        "latest_price": 8360.0,
        "unrealized_return_pct": 3.98,
        "holding_days": 8,
        "ma60_stop_price": 5985.17,
        "stop_loss_ma60": 5985.17,
        "dist_to_stop_pct": 39.7,
        "currency": "TWD",
        "stop_condition": "🥉 第3主力 (30%配置)：ASIC龍頭多頭強勁，每週一動態檢視，消除資金閒置"
    }
]

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
        "name": "👑 全球高流動性泰坦旗艦 (最高 Calmar 冠軍：Top 3 溫和階梯 40/30/30)",
        "short_name": "👑 全球泰坦(Calmar冠軍)",
        "model_name": "👑 全球高流動性泰坦旗艦 (最高 Calmar 冠軍：Top 3 溫和階梯 40/30/30)",
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
        comp_list = [x for x in comp_list if x.get('model_id') != 'global_liquid_titan_a']
        comp_list.insert(0, m_item)
        p_val['comparison_long_only'] = comp_list

        comp_list_ls = p_val.get('comparison_long_short', [])
        comp_list_ls = [x for x in comp_list_ls if x.get('model_id') != 'global_liquid_titan_a']
        comp_list_ls.insert(0, m_item)
        p_val['comparison_long_short'] = comp_list_ls

        if 'models_detail' not in p_val:
            p_val['models_detail'] = {}
        p_val['models_detail']['global_liquid_titan_a'] = {
            "name": "👑 全球高流動性泰坦旗艦 (最高 Calmar 冠軍：Top 3 溫和階梯 40/30/30)",
            "model_id": "global_liquid_titan_a",
            "open_positions": top3_positions,
            "long_only": {
                **m_item,
                "open_positions": top3_positions
            },
            "long_short": {
                **m_item,
                "open_positions": top3_positions
            }
        }

# 頂層預設模型與持股全面更新為冠軍 Top 3
market_data['selected_model'] = 'global_liquid_titan_a'
market_data['best_model_id'] = 'global_liquid_titan_a'
bs['selected_model_id'] = 'global_liquid_titan_a'
bs['open_positions'] = top3_positions
bs['titan_open_positions'] = top3_positions

# 注入頂層 models
if 'models' not in market_data:
    market_data['models'] = {}

m_20y = calc_metrics_for_range('2005-01-01', '2026-10-15')
market_data['models']['global_liquid_titan_a'] = {
    "name": "👑 全球高流動性泰坦旗艦 (最高 Calmar 冠軍：Top 3 溫和階梯 40/30/30)",
    "description": "全球流動性巨頭池 + Top 3 階梯 (40/30/30) + FIP漸進動能 + 全球主權寬幅階梯避險",
    "metrics": m_20y,
    "open_positions": top3_positions,
    "prediction": {
        "confidence": 0.95,
        "action": "BUY",
        "signal": "STRONG_BUY",
        "directive": "大盤維持全球共振多頭格局，頂刊 FIP 漸進動能冠軍 Top 3 滿倉佈局"
    }
}

# 保存更新後的 defaultMarketMlData.json
with open("frontend/src/data/defaultMarketMlData.json", "w", encoding="utf-8") as f:
    json.dump(market_data, f, ensure_ascii=False, indent=2)

print("[✓] 成功將 global_liquid_titan_a (Top 3 冠軍) 注入 defaultMarketMlData.json 全面同步完成！")
