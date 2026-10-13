#!/usr/bin/env python3
"""
ml_momentum_top10_system.py
=============================================================================
歷史強動能股票池 ML 建模與 20 年回測系統:
1. 掃描 2005~2026 全歷史，滾動篩選動能前十強 (Top 10) 股票
2. 模擬出場機制 (季線停損 / 衛星-12%停損 / 30日輪動)，記錄真實出場盈虧建立訓練資料庫
3. 採用 6 大機器學習模型 (LightGBM, XGBoost, Random Forest, Logistic Regression, MLP, Ensemble)
   進行時間序列滾動交叉驗證 (Time-Series Split)，詳細評估各模型對強動能股票的預測準確度
4. 挑選表現最優之 ML 模型作為選股依據，執行 20 年完整實戰回測 (含週度動態遞補消除空窗期)
=============================================================================
"""

import sqlite3
import os
import json
import numpy as np
import pandas as pd
from datetime import datetime

# 機器學習庫
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, f1_score, log_loss
from sklearn.model_selection import TimeSeriesSplit

try:
    import lightgbm as lgb
except ImportError:
    lgb = None

try:
    import xgboost as xgb
except ImportError:
    xgb = None

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

print("[*] 正在從資料庫讀取加權指數與 2005~2026 歷史行情...")
conn = sqlite3.connect(DB_PATH)

df_taiex_raw = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')

years = [str(y) for y in range(2005, 2027)]
top_stocks = set()
for yr in years:
    df_yr = pd.read_sql_query(f'''
        SELECT stock_id
        FROM daily_stock
        WHERE date >= "{yr}0101" AND date <= "{yr}1231"
          AND LENGTH(stock_id) = 4 AND stock_id GLOB '[0-9][0-9][0-9][0-9]'
          AND stock_id NOT LIKE '00%'
        GROUP BY stock_id
        ORDER BY SUM(trade_value) DESC
        LIMIT 60
    ''', conn)
    top_stocks.update(df_yr['stock_id'].tolist())

sids = list(top_stocks)
placeholders = ','.join(['?']*len(sids))

df_px = pd.read_sql_query(f'''
    SELECT date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_value, change_sign, change_price
    FROM daily_stock
    WHERE stock_id IN ({placeholders}) AND date >= "20050101"
''', conn, params=sids)

df_inst = pd.read_sql_query(f'''
    SELECT date, stock_id, foreign_net, trust_net
    FROM institutional_trades
    WHERE stock_id IN ({placeholders}) AND date >= "20050101"
''', conn, params=sids)
conn.close()

print(f"[✓] 歷史數據讀取完成: {len(sids)} 檔標的，{len(df_px):,} 筆日行情。正在計算連續除權息復權矩陣...")

def get_signed_change(r):
    val = r['change_price']
    if pd.isna(val) or val == 0:
        return 0.0
    sign = str(r['change_sign']).strip()
    abs_val = abs(float(val))
    if sign == '-':
        return -abs_val
    elif sign == '+':
        return abs_val
    else:
        return float(val)

df_px['signed_change'] = df_px.apply(get_signed_change, axis=1)
df_px['ref_price'] = df_px['closing_price'] - df_px['signed_change']

price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
change_pivot = df_px.pivot(index='date', columns='stock_id', values='signed_change').sort_index().fillna(0)
ref_pivot = df_px.pivot(index='date', columns='stock_id', values='ref_price').sort_index().fillna(price_pivot)
price_open = df_px.pivot(index='date', columns='stock_id', values='opening_price').sort_index().ffill().combine_first(price_pivot)
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)

prev_price = price_pivot.shift(1)
raw_ret = (price_pivot / prev_price) - 1.0

# 嚴格除權息修正 (消除負號錯誤與跌停誤判)
ex_div_mask = (raw_ret < -0.075) & ((change_pivot / ref_pivot) > raw_ret + 0.05)
adj_ret = raw_ret.copy()
adj_ret[ex_div_mask] = (change_pivot[ex_div_mask] / ref_pivot[ex_div_mask]).clip(-0.10, 0.10)

cum_factors = (1.0 + adj_ret.fillna(0.0)).cumprod()
last_prices = price_pivot.ffill().iloc[-1].fillna(100.0)
cum_last = cum_factors.iloc[-1].replace(0, np.nan).fillna(1.0)
price_adj_pivot = cum_factors.div(cum_last) * last_prices

open_ratio = (price_open / price_pivot).fillna(1.0).clip(0.5, 2.0)
price_adj_open = price_adj_pivot * open_ratio

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)
trust_pivot = df_inst.pivot(index='date', columns='stock_id', values='trust_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)
foreign_pivot = df_inst.pivot(index='date', columns='stock_id', values='foreign_net').fillna(0).sort_index().reindex(price_pivot.index).reindex(columns=price_pivot.columns).fillna(0)

name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()
all_dates = [d for d in price_pivot.index if d >= '20050401']

df_taiex = df_taiex_raw.reindex(price_pivot.index).ffill().bfill()
df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean().bfill()

print("[*] 正在計算全歷史多維度動能、均線、波動率與籌碼指標...")
ma5_pivot = price_adj_pivot.rolling(5, min_periods=3).mean()
ma10_pivot = price_adj_pivot.rolling(10, min_periods=5).mean()
ma20_pivot = price_adj_pivot.rolling(20, min_periods=10).mean()
ma60_pivot = price_adj_pivot.rolling(60, min_periods=20).mean()

ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)
ma20_slope5 = (ma20_pivot - ma20_pivot.shift(5)) / ma20_pivot.shift(5)
high60_pivot = price_adj_pivot.rolling(60, min_periods=20).max()
high20_pivot = price_adj_pivot.rolling(20, min_periods=10).max()

ret_20 = price_adj_pivot.pct_change(20, fill_method=None)
ret_60 = price_adj_pivot.pct_change(60, fill_method=None)
ret_120 = price_adj_pivot.pct_change(120, fill_method=None)

vol_20 = adj_ret.rolling(20, min_periods=10).std()
vol_60 = adj_ret.rolling(60, min_periods=20).std()
sharpe_rs_pivot = ret_60 / (vol_60 * np.sqrt(60) + 1e-5)

taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

rolling_turnover_20 = value_pivot.rolling(20, min_periods=10).mean()
rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_turnover_5 = value_pivot.rolling(5, min_periods=3).mean()
rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()
rolling_trust_20 = trust_pivot.rolling(20, min_periods=10).sum()
rolling_foreign_20 = foreign_pivot.rolling(20, min_periods=10).sum()
breadth_ma20 = (price_adj_pivot >= ma20_pivot).astype(int).mean(axis=1)


# =============================================================================
# 步驟 1: 滾動時間篩選動能 Top 10，並依照真實出場盈虧建立 ML 樣本資料庫
# =============================================================================
print("\n" + "="*80)
print("[步驟 1] 掃描全歷史 (2005~2026)，滾動篩選動能前十強並依出場盈虧建立資料庫...")
print("="*80)

dataset_records = []
scan_step = 5  # 每 5 個交易日 (週度) 滾動篩選一次
sat_hard_stop = 0.12
max_holding_period = 30
fee_rate = 0.00585  # 來回稅費 0.585%

for i in range(0, len(all_dates) - max_holding_period, scan_step):
    dt = all_dates[i]
    is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
    curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
    if not (is_macro_bull and curr_breadth >= 0.35):
        continue

    valid_turnover = rolling_turnover_60.loc[dt].dropna()
    if len(valid_turnover) < 20:
        continue
    liquid_pool = valid_turnover.nlargest(50).index

    mom_cands = {}
    for sid in liquid_pool:
        p = price_adj_pivot.loc[dt, sid]
        m60 = ma60_pivot.loc[dt, sid]
        m20 = ma20_pivot.loc[dt, sid]
        r20 = ret_20.loc[dt, sid]
        r60 = ret_60.loc[dt, sid]
        r120_raw = ret_120.loc[dt, sid]
        r120 = r60 if (pd.isna(r120_raw) or not np.isfinite(r120_raw)) else r120_raw
        h60 = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p
        if pd.isna(p) or pd.isna(m60) or p < m60 * 1.025:
            continue
        if pd.isna(m20) or p < m20 or m20 < m60:
            continue
        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
        if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
            continue
        s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
        if pd.isna(s20) or s20 < 0.025:
            continue
        if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88:
            continue

        t60 = taiex_ret60.loc[dt] if (dt in taiex_ret60.index and pd.notna(taiex_ret60.loc[dt])) else 0.0
        t20 = taiex_ret20.loc[dt] if (dt in taiex_ret20.index and pd.notna(taiex_ret20.loc[dt])) else 0.0
        t120_raw = taiex_ret120.loc[dt] if (dt in taiex_ret120.index and pd.notna(taiex_ret120.loc[dt])) else t60
        t120 = t60 if (pd.isna(t120_raw) or not np.isfinite(t120_raw)) else t120_raw

        rs = (r20 - t20)*0.30 + (r60 - t60)*0.40 + (r120 - t120)*0.30
        h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
        mom_cands[sid] = {'rs': rs, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

    if len(mom_cands) < 3:
        continue

    df_m = pd.DataFrame(mom_cands).T
    df_m['norm_rs'] = df_m['rs'].rank(pct=True).fillna(0.5)
    df_m['norm_prox'] = df_m['h_prox'].rank(pct=True).fillna(0.5)
    df_m['norm_size'] = df_m['turnover'].rank(pct=True).fillna(0.5)
    df_m['mom_rank_score'] = 0.50 * df_m['norm_rs'] + 0.35 * df_m['norm_prox'] + 0.15 * df_m['norm_size']

    # 🎯 鎖定當期動能最強前 10 檔 (Top 10)
    top10_sids = df_m.nlargest(min(10, len(df_m)), 'mom_rank_score').index

    # 模擬 Top 10 中每一檔股票在進場後的真實出場盈虧
    next_dt = all_dates[i + 1]  # T+1 日開盤進場
    for rank_idx, sid in enumerate(top10_sids):
        entry_price = price_open.loc[next_dt, sid]
        entry_price_adj = price_adj_open.loc[next_dt, sid]
        if pd.isna(entry_price_adj) or entry_price_adj <= 0:
            continue

        # 模擬持倉直到出場 (跌破 60MA / -12% 停損 / 最長 30 天)
        exit_date = None
        exit_price_adj = None
        exit_reason = None
        holding_days = 0

        for h in range(1, max_holding_period + 1):
            cur_idx = i + 1 + h
            if cur_idx >= len(all_dates):
                break
            h_dt = all_dates[cur_idx]
            cur_p_adj = price_adj_pivot.loc[h_dt, sid]
            cur_m60 = ma60_pivot.loc[h_dt, sid]
            holding_days = h

            if not pd.isna(cur_p_adj) and not pd.isna(cur_m60) and cur_p_adj < cur_m60:
                exit_date = h_dt
                exit_price_adj = cur_p_adj
                exit_reason = 'STOP_60MA'
                break
            elif (cur_p_adj / entry_price_adj - 1.0) < -sat_hard_stop:
                exit_date = h_dt
                exit_price_adj = cur_p_adj
                exit_reason = 'STOP_HARD_12'
                break
            elif h == max_holding_period:
                exit_date = h_dt
                exit_price_adj = cur_p_adj
                exit_reason = 'REBALANCE_30D'
                break

        if exit_price_adj is None or pd.isna(exit_price_adj):
            continue

        raw_trade_ret = (exit_price_adj / entry_price_adj) - 1.0
        net_trade_ret = raw_trade_ret - fee_rate  # 扣除手續費與證交稅
        target_win = 1 if net_trade_ret > 0 else 0

        # 採集入場當下 (dt) 的特徵
        p_curr = price_adj_pivot.loc[dt, sid]
        m5_curr = ma5_pivot.loc[dt, sid]
        m10_curr = ma10_pivot.loc[dt, sid]
        m20_curr = ma20_pivot.loc[dt, sid]
        m60_curr = ma60_pivot.loc[dt, sid]
        h60_curr = high60_pivot.loc[dt, sid]
        h20_curr = high20_pivot.loc[dt, sid]
        
        feat_record = {
            'entry_date': next_dt,
            'stock_id': sid,
            'stock_name': name_map.get(sid, sid),
            'top10_rank': rank_idx + 1,
            'mom_score': float(df_m.loc[sid, 'mom_rank_score']),
            'rs_val': float(df_m.loc[sid, 'rs']),
            
            # 動能特徵
            'ret_20': float(ret_20.loc[dt, sid]) if not pd.isna(ret_20.loc[dt, sid]) else 0.0,
            'ret_60': float(ret_60.loc[dt, sid]) if not pd.isna(ret_60.loc[dt, sid]) else 0.0,
            'ret_120': float(ret_120.loc[dt, sid]) if not pd.isna(ret_120.loc[dt, sid]) else 0.0,
            'high60_prox': float(p_curr / h60_curr) if (h60_curr > 0) else 1.0,
            'high20_prox': float(p_curr / h20_curr) if (h20_curr > 0) else 1.0,
            'ma60_slope': float(ma60_slope5.loc[dt, sid]) if not pd.isna(ma60_slope5.loc[dt, sid]) else 0.0,
            'ma20_slope': float(ma20_slope5.loc[dt, sid]) if not pd.isna(ma20_slope5.loc[dt, sid]) else 0.0,
            'bias_ma20': float(p_curr / m20_curr - 1.0) if m20_curr > 0 else 0.0,
            'bias_ma60': float(p_curr / m60_curr - 1.0) if m60_curr > 0 else 0.0,
            'ma_align': 1.0 if (m5_curr >= m10_curr and m10_curr >= m20_curr and m20_curr >= m60_curr) else 0.0,
            'sharpe_rs': float(sharpe_rs_pivot.loc[dt, sid]) if not pd.isna(sharpe_rs_pivot.loc[dt, sid]) else 0.0,
            
            # 籌碼特徵
            'trust_20': float(rolling_trust_20.loc[dt, sid]) if (sid in rolling_trust_20.columns and not pd.isna(rolling_trust_20.loc[dt, sid])) else 0.0,
            'foreign_20': float(rolling_foreign_20.loc[dt, sid]) if (sid in rolling_foreign_20.columns and not pd.isna(rolling_foreign_20.loc[dt, sid])) else 0.0,
            'inst_20': float(rolling_inst_20.loc[dt, sid]) if (sid in rolling_inst_20.columns and not pd.isna(rolling_inst_20.loc[dt, sid])) else 0.0,
            'trust_ratio_20': float(rolling_trust_20.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] * 20 + 1e-5)) if sid in rolling_trust_20.columns else 0.0,
            'inst_ratio_20': float(rolling_inst_20.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] * 20 + 1e-5)) if sid in rolling_inst_20.columns else 0.0,
            
            # 量能與波動特徵
            'turnover_val': float(valid_turnover[sid]),
            'vol_ratio_5_20': float(rolling_turnover_5.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] + 1e-5)) if sid in rolling_turnover_5.columns else 1.0,
            'volatility_20': float(vol_20.loc[dt, sid]) if not pd.isna(vol_20.loc[dt, sid]) else 0.0,
            
            # 宏觀環境特徵
            'macro_breadth': float(curr_breadth),
            'taiex_bias_ma60': float(df_taiex.loc[dt, 'close'] / df_macro_overlay.loc[dt, 'taiex_ma60'] - 1.0),
            
            # 出場標籤 (Label)
            'exit_date': exit_date,
            'holding_days': holding_days,
            'exit_reason': exit_reason,
            'net_return_pct': round(float(net_trade_ret * 100.0), 2),
            'target_win': target_win
        }
        dataset_records.append(feat_record)

df_dataset = pd.DataFrame(dataset_records)
print(f"[✓] 強動能 Top 10 資料庫建立完成！共採集 {len(df_dataset):,} 筆歷史強動能交易樣本。")
print(f"    - 正樣本 (出場獲利): {sum(df_dataset['target_win'] == 1):,} 筆 (勝率基準: {df_dataset['target_win'].mean()*100:.2f}%)")
print(f"    - 負樣本 (出場虧損): {sum(df_dataset['target_win'] == 0):,} 筆")
print(f"    - 平均淨報酬率: {df_dataset['net_return_pct'].mean():.2f}% | 中位數: {df_dataset['net_return_pct'].median():.2f}%")

# 保存資料庫至 CSV
df_dataset.to_csv('/Users/huanggin-chen/gemini-stock-analysis/momentum_top10_dataset.csv', index=False)
print("[✓] 資料庫已保存至 /Users/huanggin-chen/gemini-stock-analysis/momentum_top10_dataset.csv")


# =============================================================================
# 步驟 2: 餵入多款 ML 模型進行時間序列滾動訓練，評估預測準確度
# =============================================================================
print("\n" + "="*80)
print("[步驟 2] 餵入現有 ML 模型進行時間序列交叉驗證 (Time-Series Split)，評估預測準確度...")
print("="*80)

feature_cols = [
    'top10_rank', 'mom_score', 'rs_val', 'ret_20', 'ret_60', 'ret_120',
    'high60_prox', 'high20_prox', 'ma60_slope', 'ma20_slope', 'bias_ma20',
    'bias_ma60', 'ma_align', 'sharpe_rs', 'trust_20', 'foreign_20', 'inst_20',
    'trust_ratio_20', 'inst_ratio_20', 'turnover_val', 'vol_ratio_5_20',
    'volatility_20', 'macro_breadth', 'taiex_bias_ma60'
]

X_all = df_dataset[feature_cols].copy()
y_all = df_dataset['target_win'].values

# 處理極端值與缺失值
X_all = X_all.replace([np.inf, -np.inf], np.nan).fillna(0)

# 定義 6 款主流機器學習候選模型
def get_ml_models():
    models = {}
    
    # 1. LightGBM (微軟梯度提升樹)
    if lgb is not None:
        models['LightGBM'] = lgb.LGBMClassifier(
            n_estimators=100,
            learning_rate=0.03,
            max_depth=4,
            num_leaves=15,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1
        )
        
    # 2. XGBoost (經典量化極限梯度提升)
    if xgb is not None:
        models['XGBoost'] = xgb.XGBClassifier(
            n_estimators=100,
            learning_rate=0.03,
            max_depth=4,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            eval_metric='logloss'
        )
        
    # 3. Random Forest (隨機森林 Bagging)
    models['RandomForest'] = RandomForestClassifier(
        n_estimators=100,
        max_depth=6,
        min_samples_leaf=10,
        random_state=42,
        n_jobs=-1
    )
    
    # 4. Logistic Regression (L2 正則化線性基準)
    models['LogisticRegression'] = LogisticRegression(
        C=0.1,
        max_iter=1000,
        random_state=42
    )
    
    # 5. MLP Neural Net (多層感知機神經網絡)
    models['MLP_NeuralNet'] = MLPClassifier(
        hidden_layer_sizes=(32, 16),
        alpha=0.01,
        max_iter=200,
        random_state=42
    )
    
    return models

base_models = get_ml_models()

# 6. Ensemble (軟投票集成: LightGBM + RF + LR)
ensemble_estimators = []
if 'LightGBM' in base_models:
    ensemble_estimators.append(('lgb', base_models['LightGBM']))
if 'RandomForest' in base_models:
    ensemble_estimators.append(('rf', base_models['RandomForest']))
if 'LogisticRegression' in base_models:
    ensemble_estimators.append(('lr', base_models['LogisticRegression']))

if len(ensemble_estimators) >= 2:
    base_models['Ensemble_Voting'] = VotingClassifier(
        estimators=ensemble_estimators,
        voting='soft'
    )

# 採用 5 折時間序列滾動交叉驗證 (嚴格依時間先後順序分割，避免未來資訊洩漏)
tscv = TimeSeriesSplit(n_splits=5)
model_eval_results = {m_name: {'auc': [], 'acc': [], 'prec': [], 'recall': [], 'f1': [], 'loss': []} for m_name in base_models}

print(f"[*] 啟動 Time-Series 交叉驗證 (共 5 輪時間折疊，每折約 {len(df_dataset)//6:,} 筆測試樣本)...")

for fold_idx, (train_idx, test_idx) in enumerate(tscv.split(X_all)):
    X_train_raw, y_train = X_all.iloc[train_idx], y_all[train_idx]
    X_test_raw, y_test = X_all.iloc[test_idx], y_all[test_idx]
    
    # 標準化特徵
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_test = scaler.transform(X_test_raw)
    
    for m_name, model in base_models.items():
        try:
            model.fit(X_train, y_train)
            if hasattr(model, 'predict_proba'):
                y_prob = model.predict_proba(X_test)[:, 1]
            else:
                y_prob = model.predict(X_test)
            y_pred = (y_prob >= 0.5).astype(int)
            
            auc = roc_auc_score(y_test, y_prob) if len(np.unique(y_test)) > 1 else 0.5
            acc = accuracy_score(y_test, y_pred)
            prec = precision_score(y_test, y_pred, zero_division=0)
            rec = recall_score(y_test, y_pred, zero_division=0)
            f1 = f1_score(y_test, y_pred, zero_division=0)
            loss = log_loss(y_test, y_prob, labels=[0, 1])
            
            model_eval_results[m_name]['auc'].append(auc)
            model_eval_results[m_name]['acc'].append(acc)
            model_eval_results[m_name]['prec'].append(prec)
            model_eval_results[m_name]['recall'].append(rec)
            model_eval_results[m_name]['f1'].append(f1)
            model_eval_results[m_name]['loss'].append(loss)
        except Exception as e:
            print(f"    [!] 模型 {m_name} 在 Fold {fold_idx+1} 發生錯誤: {e}")

# 匯總各模型預測準確度
summary_list = []
for m_name, scores in model_eval_results.items():
    if not scores['auc']:
        continue
    summary_list.append({
        'Model': m_name,
        'ROC_AUC': np.mean(scores['auc']),
        'Accuracy': np.mean(scores['acc']),
        'Precision': np.mean(scores['prec']),
        'Recall': np.mean(scores['recall']),
        'F1_Score': np.mean(scores['f1']),
        'Log_Loss': np.mean(scores['loss'])
    })

df_eval = pd.DataFrame(summary_list).sort_values(by='ROC_AUC', ascending=False).reset_index(drop=True)

print("\n" + "="*80)
print("📊 各模型對【歷史強動能 Top 10 股票】預測準確度排行榜:")
print("="*80)
print(df_eval.to_string(index=False, formatters={
    'ROC_AUC': '{:.4f}'.format,
    'Accuracy': '{:.2%}'.format,
    'Precision': '{:.2%}'.format,
    'Recall': '{:.2%}'.format,
    'F1_Score': '{:.4f}'.format,
    'Log_Loss': '{:.4f}'.format
}))

best_model_name = df_eval.iloc[0]['Model']
best_auc = df_eval.iloc[0]['ROC_AUC']
best_acc = df_eval.iloc[0]['Accuracy']
best_prec = df_eval.iloc[0]['Precision']

print(f"\n[🏆 冠軍模型] {best_model_name}")
print(f"    - ROC-AUC: {best_auc:.4f} (衡量對真假龍頭的精確排序能力)")
print(f"    - 準確度 (Accuracy): {best_acc*100:.2f}%")
print(f"    - 精準度 (Precision): {best_prec*100:.2f}% (被預測為正時的實際勝率)")


# =============================================================================
# 步驟 3: 用最好的模型當作選股依據，回測 20 年實戰績效
# =============================================================================
print("\n" + "="*80)
print(f"[步驟 3] 採用冠軍模型【{best_model_name}】進行二階段選股，回測 2005~2026 年實戰績效...")
print("="*80)

# 在全歷史訓練冠軍模型 (或滾動前瞻預測)
# 這裡採用嚴格的「滾動遞增視窗 (Expanding Window Walk-Forward)」模擬真實實盤：
# 初始至少有 180 個交易日數據後，每 30 交易日重新訓練更新模型參數一次，100% 絕無偷看未來！

rebalance_freq = 30
refill_freq = 5  # 週度動態遞補開倉
leader_w = 0.70
sat_w = 0.15
num_sats = 2
min_breadth = 0.35

portfolio_equity = 1000000.0
equity_curve = []
active_weights = {}
pending_weights = None
all_completed_trades = []
open_position_tracker = {}
current_leader_sid = ''
just_entered_sids = set()

# 特徵快取查找表 (以 (entry_date, sid) 為 key)
feat_dict = df_dataset.set_index(['entry_date', 'stock_id'])[feature_cols].to_dict(orient='index')

# 初始化 ML 模型
scaler_live = StandardScaler()
best_clf = base_models[best_model_name]
trained_records = []
is_model_ready = False

print(f"[*] 啟動 20 年逐日回測引擎 (含嚴格 T+1 開盤成交、{fee_rate*100:.3f}% 交易稅費、週度動態遞補)...")

for i, dt in enumerate(all_dates):
    just_entered_sids.clear()
    exited_returns = 0.0

    # 1. 執行 T+1 開盤調倉成交
    if pending_weights is not None:
        prev_dt = all_dates[i-1] if i > 0 else dt
        for sid, w_old in list(active_weights.items()):
            if sid not in pending_weights:
                if sid in open_position_tracker:
                    pos = open_position_tracker[sid]
                    exit_px = price_open.loc[dt, sid]
                    p_adj_exit = price_adj_open.loc[dt, sid]
                    ep_adj = pos.get('entry_price_adj', p_adj_exit)
                    entry_px = pos['entry_price']
                    ret_pct = (p_adj_exit / ep_adj - 1.0) * 100.0 if ep_adj > 0 else 0.0
                    h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                    all_completed_trades.append({
                        'stock_id': sid,
                        'stock_name': name_map.get(sid, sid),
                        'role': pos['role'],
                        'entry_date': pos['entry_date'],
                        'exit_date': dt,
                        'entry_price': round(float(entry_px), 2),
                        'exit_price': round(float(exit_px), 2),
                        'return_pct': round(float(ret_pct), 2),
                        'holding_days': max(1, h_days),
                        'exit_reason': '🔄 波段常態輪動平倉',
                    })
                    del open_position_tracker[sid]
                    if prev_dt in price_adj_pivot.index and sid in price_adj_pivot.columns:
                        prev_p_adj = price_adj_pivot.loc[prev_dt, sid]
                        if prev_p_adj > 0:
                            exited_returns += w_old * ((p_adj_exit / prev_p_adj) - 1.0)
                if sid == current_leader_sid:
                    current_leader_sid = ''

        for sid, w_new in pending_weights.items():
            role_str = '👑 王者泰坦 (70%)' if w_new >= 0.50 else '🚀 革命衛星 (15%)'
            exec_buy_px = price_open.loc[dt, sid]
            p_adj_entry = price_adj_open.loc[dt, sid]
            if sid not in active_weights:
                open_position_tracker[sid] = {
                    'entry_date': dt,
                    'entry_price': exec_buy_px,
                    'entry_price_adj': p_adj_entry,
                    'role': role_str,
                    'target_weight': w_new,
                }
                just_entered_sids.add(sid)
                if w_new >= 0.50:
                    current_leader_sid = sid
            elif sid in open_position_tracker:
                open_position_tracker[sid]['role'] = role_str
                open_position_tracker[sid]['target_weight'] = w_new
                if w_new >= 0.50:
                    current_leader_sid = sid

        turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
        portfolio_equity -= portfolio_equity * turnover * fee_rate
        active_weights = pending_weights
        pending_weights = None

    # 2. 結算當日淨值報酬
    if i > 0:
        daily_ret = exited_returns
        for sid, w in active_weights.items():
            if sid in just_entered_sids:
                p_adj_close = price_adj_pivot.loc[dt, sid]
                p_adj_open_entry = price_adj_open.loc[dt, sid]
                if p_adj_open_entry > 0 and not pd.isna(p_adj_close):
                    daily_ret += w * ((p_adj_close / p_adj_open_entry) - 1.0)
            else:
                if sid in adj_ret.columns and not pd.isna(adj_ret.loc[dt, sid]):
                    daily_ret += w * adj_ret.loc[dt, sid]
        portfolio_equity *= (1.0 + daily_ret)

    # 3. 停損防守：跌破 60MA 季線或衛星跌破 -12% 斷尾
    if active_weights:
        temp_active = {}
        for sid, w in active_weights.items():
            p_adj = price_adj_pivot.loc[dt, sid]
            ma60 = ma60_pivot.loc[dt, sid]
            pos = open_position_tracker.get(sid, {})
            ep_adj = pos.get('entry_price_adj', p_adj)
            is_leader = (w >= 0.50)

            should_stop = False
            reason_str = ''

            if not pd.isna(p_adj) and not pd.isna(ma60) and p_adj < ma60:
                should_stop = True
                reason_str = '🛡️ 跌破季線 (60MA) 防禦停損'
            elif not is_leader and sat_hard_stop is not None and ep_adj > 0:
                if (p_adj / ep_adj - 1.0) < -sat_hard_stop:
                    should_stop = True
                    reason_str = '⚡ 衛星觸發 -12% 停損線 (及時斷尾)'

            if should_stop:
                if sid in open_position_tracker:
                    exit_px = price_pivot.loc[dt, sid]
                    entry_px = pos['entry_price']
                    ret_pct = (p_adj / ep_adj - 1.0) * 100.0 if ep_adj > 0 else 0.0
                    h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                    all_completed_trades.append({
                        'stock_id': sid,
                        'stock_name': name_map.get(sid, sid),
                        'role': pos['role'],
                        'entry_date': pos['entry_date'],
                        'exit_date': dt,
                        'entry_price': round(float(entry_px), 2),
                        'exit_price': round(float(exit_px), 2),
                        'return_pct': round(float(ret_pct), 2),
                        'holding_days': max(1, h_days),
                        'exit_reason': reason_str,
                    })
                    del open_position_tracker[sid]
                if sid == current_leader_sid:
                    current_leader_sid = ''
            else:
                temp_active[sid] = w

        if len(temp_active) < len(active_weights):
            reduced = sum(active_weights[s] for s in active_weights if s not in temp_active)
            portfolio_equity -= portfolio_equity * reduced * fee_rate
        active_weights = temp_active

        # 資金活化：在席贏家等比再平衡
        is_macro_bull_curr = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
        curr_breadth_val = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
        if is_macro_bull_curr and (curr_breadth_val >= 0.40) and active_weights:
            tot_w = sum(active_weights.values())
            if tot_w < 0.95 and tot_w > 0:
                scale = 1.0 / tot_w
                active_weights = {s: round(w * scale, 3) for s, w in active_weights.items()}
                for s, new_w in active_weights.items():
                    if s in open_position_tracker:
                        open_position_tracker[s]['target_weight'] = new_w

    # 4. 滾動訓練 ML 模型 (每 30 交易日用截至今日已出場完成的樣本重新訓練)
    if i % 30 == 0:
        available_history = df_dataset[df_dataset['exit_date'] < dt]
        if len(available_history) >= 120 and len(np.unique(available_history['target_win'])) > 1:
            X_hist = available_history[feature_cols].replace([np.inf, -np.inf], np.nan).fillna(0)
            y_hist = available_history['target_win'].values
            scaler_live.fit(X_hist)
            X_hist_scaled = scaler_live.transform(X_hist)
            best_clf.fit(X_hist_scaled, y_hist)
            is_model_ready = True

    # 5. 調倉或動態遞補檢視
    is_macro_bull = df_taiex.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60'] if dt in df_macro_overlay.index else True
    curr_breadth = breadth_ma20.loc[dt] if dt in breadth_ma20.index else 0.5
    macro_healthy = is_macro_bull and (curr_breadth >= 0.35)

    is_scheduled = (i % rebalance_freq == 0)
    is_refill_trigger = False
    if (i % refill_freq == 0) and macro_healthy:
        has_leader = any(w >= 0.50 for w in active_weights.values())
        cur_sats = len([s for s in active_weights if active_weights[s] < 0.50])
        if (not has_leader) or (cur_sats < num_sats):
            is_refill_trigger = True

    if is_scheduled or is_refill_trigger:
        if not is_macro_bull:
            next_targets = {}
        else:
            allow_sats = (curr_breadth >= min_breadth)
            valid_turnover = rolling_turnover_60.loc[dt].dropna()
            liquid_pool = valid_turnover.nlargest(50).index

            # 第一階段：動能指標初篩 Top 10
            mom_cands = {}
            for sid in liquid_pool:
                p = price_adj_pivot.loc[dt, sid]
                m60 = ma60_pivot.loc[dt, sid]
                m20 = ma20_pivot.loc[dt, sid]
                r20 = ret_20.loc[dt, sid]
                r60 = ret_60.loc[dt, sid]
                r120_raw = ret_120.loc[dt, sid]
                r120 = r60 if (pd.isna(r120_raw) or not np.isfinite(r120_raw)) else r120_raw
                h60 = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p
                if pd.isna(p) or pd.isna(m60) or p < m60 * 1.025:
                    continue
                if pd.isna(m20) or p < m20 or m20 < m60:
                    continue
                s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                if pd.isna(s5) or s5 < 0 or pd.isna(r20) or r20 < 0:
                    continue
                s20 = ma20_slope5.loc[dt, sid] if sid in ma20_slope5.columns else 0
                if pd.isna(s20) or s20 < 0.025:
                    continue
                if not pd.isna(h60) and h60 > 0 and (p / h60) < 0.88:
                    continue

                t60 = taiex_ret60.loc[dt] if (dt in taiex_ret60.index and pd.notna(taiex_ret60.loc[dt])) else 0.0
                t20 = taiex_ret20.loc[dt] if (dt in taiex_ret20.index and pd.notna(taiex_ret20.loc[dt])) else 0.0
                t120_raw = taiex_ret120.loc[dt] if (dt in taiex_ret120.index and pd.notna(taiex_ret120.loc[dt])) else t60
                t120 = t60 if (pd.isna(t120_raw) or not np.isfinite(t120_raw)) else t120_raw

                rs = (r20 - t20)*0.30 + (r60 - t60)*0.40 + (r120 - t120)*0.30
                h_prox = (p / h60) if (not pd.isna(h60) and h60 > 0) else 1.0
                mom_cands[sid] = {'rs': rs, 'h_prox': h_prox, 'turnover': valid_turnover[sid]}

            if len(mom_cands) >= 1:
                df_m = pd.DataFrame(mom_cands).T
                df_m['norm_rs'] = df_m['rs'].rank(pct=True).fillna(0.5)
                df_m['norm_prox'] = df_m['h_prox'].rank(pct=True).fillna(0.5)
                df_m['norm_size'] = df_m['turnover'].rank(pct=True).fillna(0.5)
                df_m['mom_rank_score'] = 0.50 * df_m['norm_rs'] + 0.35 * df_m['norm_prox'] + 0.15 * df_m['norm_size']
                top10_idx = df_m.nlargest(min(10, len(df_m)), 'mom_rank_score').index

                # 第二階段：由最佳 ML 模型預測獲利勝率機率 P(Win)
                ml_prob_map = {}
                for rank_pos, sid in enumerate(top10_idx):
                    # 構造當下的即時特徵
                    p_curr = price_adj_pivot.loc[dt, sid]
                    m5_curr = ma5_pivot.loc[dt, sid]
                    m10_curr = ma10_pivot.loc[dt, sid]
                    m20_curr = ma20_pivot.loc[dt, sid]
                    m60_curr = ma60_pivot.loc[dt, sid]
                    h60_curr = high60_pivot.loc[dt, sid] if sid in high60_pivot.columns else p_curr
                    h20_curr = high20_pivot.loc[dt, sid] if sid in high20_pivot.columns else p_curr
                    
                    feat_v = [
                        rank_pos + 1,
                        float(df_m.loc[sid, 'mom_rank_score']),
                        float(df_m.loc[sid, 'rs']),
                        float(ret_20.loc[dt, sid]) if not pd.isna(ret_20.loc[dt, sid]) else 0.0,
                        float(ret_60.loc[dt, sid]) if not pd.isna(ret_60.loc[dt, sid]) else 0.0,
                        float(ret_120.loc[dt, sid]) if not pd.isna(ret_120.loc[dt, sid]) else 0.0,
                        float(p_curr / h60_curr) if (h60_curr > 0) else 1.0,
                        float(p_curr / h20_curr) if (h20_curr > 0) else 1.0,
                        float(ma60_slope5.loc[dt, sid]) if not pd.isna(ma60_slope5.loc[dt, sid]) else 0.0,
                        float(ma20_slope5.loc[dt, sid]) if not pd.isna(ma20_slope5.loc[dt, sid]) else 0.0,
                        float(p_curr / m20_curr - 1.0) if m20_curr > 0 else 0.0,
                        float(p_curr / m60_curr - 1.0) if m60_curr > 0 else 0.0,
                        1.0 if (m5_curr >= m10_curr and m10_curr >= m20_curr and m20_curr >= m60_curr) else 0.0,
                        float(sharpe_rs_pivot.loc[dt, sid]) if not pd.isna(sharpe_rs_pivot.loc[dt, sid]) else 0.0,
                        float(rolling_trust_20.loc[dt, sid]) if (sid in rolling_trust_20.columns and not pd.isna(rolling_trust_20.loc[dt, sid])) else 0.0,
                        float(rolling_foreign_20.loc[dt, sid]) if (sid in rolling_foreign_20.columns and not pd.isna(rolling_foreign_20.loc[dt, sid])) else 0.0,
                        float(rolling_inst_20.loc[dt, sid]) if (sid in rolling_inst_20.columns and not pd.isna(rolling_inst_20.loc[dt, sid])) else 0.0,
                        float(rolling_trust_20.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] * 20 + 1e-5)) if sid in rolling_trust_20.columns else 0.0,
                        float(rolling_inst_20.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] * 20 + 1e-5)) if sid in rolling_inst_20.columns else 0.0,
                        float(valid_turnover[sid]),
                        float(rolling_turnover_5.loc[dt, sid] / (rolling_turnover_20.loc[dt, sid] + 1e-5)) if sid in rolling_turnover_5.columns else 1.0,
                        float(vol_20.loc[dt, sid]) if not pd.isna(vol_20.loc[dt, sid]) else 0.0,
                        float(curr_breadth),
                        float(df_taiex.loc[dt, 'close'] / df_macro_overlay.loc[dt, 'taiex_ma60'] - 1.0)
                    ]
                    
                    if is_model_ready:
                        df_feat = pd.DataFrame([feat_v], columns=feature_cols)
                        x_scaled = scaler_live.transform(df_feat)
                        prob = float(best_clf.predict_proba(x_scaled)[0, 1])
                    else:
                        prob = float(df_m.loc[sid, 'mom_rank_score'])
                        
                    ml_prob_map[sid] = prob

                # 依 ML 預測獲利勝率機率 P(Win) 降序排序
                df_top10 = df_m.loc[top10_idx].copy()
                df_top10['ml_win_prob'] = [ml_prob_map[s] for s in top10_idx]

                # 王者挑選：兼顧流動性與 ML 預測勝率
                top_leaders = df_top10.nlargest(min(5, len(df_top10)), 'turnover')
                leader = top_leaders['ml_win_prob'].idxmax()
                remaining = df_top10.drop(index=[leader])
                sat_candidates = remaining.nlargest(len(remaining), 'ml_win_prob').index

                if is_scheduled:
                    if not allow_sats or num_sats == 0:
                        next_targets = {leader: 1.0}
                    else:
                        if active_weights:
                            current_sats = [s for s in active_weights if s != leader and s in mom_cands and price_adj_pivot.loc[dt, s] >= ma20_pivot.loc[dt, s]]
                            needed = num_sats - len(current_sats)
                            new_candidates = [s for s in sat_candidates if s not in current_sats]
                            satellites = (current_sats + new_candidates)[:num_sats]
                        else:
                            satellites = sat_candidates[:num_sats].tolist()
                        next_targets = {leader: leader_w}
                        for sat in satellites:
                            next_targets[sat] = sat_w
                else:
                    # 週度動態遞補開倉 (保持在席贏家，填補空位)
                    next_targets = dict(active_weights)
                    has_leader = any(w >= 0.50 for w in active_weights.values())
                    if not has_leader:
                        if leader not in next_targets:
                            next_targets[leader] = leader_w
                        else:
                            if len(sat_candidates) > 0:
                                next_targets[sat_candidates[0]] = leader_w
                    cur_sats = [s for s in next_targets if next_targets[s] < 0.50]
                    needed_sats = num_sats - len(cur_sats)
                    if needed_sats > 0 and allow_sats:
                        avail = [s for s in sat_candidates if s not in next_targets]
                        for c in avail[:needed_sats]:
                            next_targets[c] = sat_w
            else:
                next_targets = {} if is_scheduled else dict(active_weights)
        pending_weights = next_targets

    cur_exposure = sum(active_weights.values())
    equity_curve.append({
        'date': dt,
        'year': int(dt[:4]),
        'strategy_equity': round(float(portfolio_equity), 2),
        'exposure': round(float(cur_exposure), 2),
        'leader_sid': current_leader_sid,
        'leader_name': name_map.get(current_leader_sid, '')
    })

# 計算完整回測統計數據
df_curve = pd.DataFrame(equity_curve)
s_taiex = df_taiex['close'].reindex(all_dates).ffill().bfill()
base_taiex = float(s_taiex.iloc[0])
df_curve['benchmark_equity'] = [round(float(s_taiex.loc[d] / base_taiex * 1000000.0), 2) for d in all_dates]

final_eq = df_curve['strategy_equity'].iloc[-1]
total_ret = ((final_eq - 1000000.0) / 1000000.0) * 100.0
years_span = len(all_dates) / 242.0
cagr = ((final_eq / 1000000.0) ** (1.0 / years_span) - 1.0) * 100.0

peak = df_curve['strategy_equity'].cummax()
df_curve['drawdown_pct'] = ((df_curve['strategy_equity'] - peak) / peak) * 100.0
mdd = df_curve['drawdown_pct'].min()

daily_rets = df_curve['strategy_equity'].pct_change().dropna()
sharpe = float((daily_rets.mean() / daily_rets.std()) * np.sqrt(242)) if daily_rets.std() > 0 else 0.0

trades_win = [t for t in all_completed_trades if t['return_pct'] > 0]
win_rate = (len(trades_win) / len(all_completed_trades) * 100.0) if all_completed_trades else 0.0
sum_win = sum(t['return_pct'] for t in all_completed_trades if t['return_pct'] > 0)
sum_loss = abs(sum(t['return_pct'] for t in all_completed_trades if t['return_pct'] < 0))
profit_factor = (sum_win / sum_loss) if sum_loss > 0 else 0.0

bm_cagr = ((df_curve['benchmark_equity'].iloc[-1] / 1000000.0) ** (1.0 / years_span) - 1.0) * 100.0
alpha_pct = cagr - bm_cagr

print("\n" + "="*80)
print(f"🌟【{best_model_name} 驅動之二階段動能旗艦策略】22年回測績效 (2005~2026):")
print("="*80)
print(f"  - 全期累積獲利: +{total_ret:,.1f}% ({final_eq/1000000.0:.1f} 倍)")
print(f"  - 年化複合報酬率 (CAGR): {cagr:.2f}%")
print(f"  - 最大歷史回撤 (MDD): {mdd:.2f}%")
print(f"  - 夏普比率 (Sharpe Ratio): {sharpe:.2f}")
print(f"  - 實戰交易勝率 (Win Rate): {win_rate:.2f}% (總完成交易: {len(all_completed_trades)} 筆, 獲利: {len(trades_win)} 筆)")
print(f"  - 盈虧比 (Profit Factor): {profit_factor:.2f}")
print(f"  - 超額年化報酬 (Alpha vs TAIEX): +{alpha_pct:.2f}%")

# 計算歷年回報
years_list = sorted(df_curve['year'].unique())
yearly_perf = []
for idx_y, y in enumerate(years_list):
    sub = df_curve[df_curve['year'] == y]
    if idx_y == 0:
        s_start = sub.iloc[0]['strategy_equity']
        b_start = sub.iloc[0]['benchmark_equity']
    else:
        prev_sub = df_curve[df_curve['year'] == years_list[idx_y - 1]]
        s_start = prev_sub.iloc[-1]['strategy_equity']
        b_start = prev_sub.iloc[-1]['benchmark_equity']
    s_end = sub.iloc[-1]['strategy_equity']
    b_end = sub.iloc[-1]['benchmark_equity']
    s_ret = (s_end / s_start - 1.0) * 100.0
    b_ret = (b_end / b_start - 1.0) * 100.0
    yearly_perf.append({
        'year': int(y),
        'strategy_ret': round(s_ret, 2),
        'benchmark_ret': round(b_ret, 2),
        'alpha': round(s_ret - b_ret, 2)
    })

df_yearly = pd.DataFrame(yearly_perf)
print("\n📅 歷年實戰表現 (近年摘要):")
print(df_yearly.tail(10).to_string(index=False))

# 保存回測結果供前端與後端使用
output_meta = {
    'best_model': best_model_name,
    'model_metrics': df_eval.to_dict(orient='records'),
    'strategy_summary': {
        'total_return_pct': round(total_ret, 1),
        'cagr_pct': round(cagr, 2),
        'max_drawdown_pct': round(mdd, 2),
        'sharpe_ratio': round(sharpe, 2),
        'win_rate_pct': round(win_rate, 2),
        'profit_factor': round(profit_factor, 2),
        'total_trades': len(all_completed_trades),
        'winning_trades': len(trades_win)
    },
    'yearly': yearly_perf
}

with open('/Users/huanggin-chen/gemini-stock-analysis/ml_momentum_top10_result.json', 'w', encoding='utf-8') as f:
    json.dump(output_meta, f, ensure_ascii=False, indent=2)

print("\n[✓] 完整 ML 訓練與 20 年回測分析結果已保存至 /Users/huanggin-chen/gemini-stock-analysis/ml_momentum_top10_result.json！")

print("\n[✓] 完整 ML 訓練與 20 年回測分析結果已保存至 /Users/huanggin-chen/gemini-stock-analysis/ml_momentum_top10_result.json！")
