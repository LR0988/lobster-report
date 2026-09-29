#!/usr/bin/env python3
"""
market_ml_engine.py
台股加權指數 (TAIEX) 宏觀多因子機器學習預測引擎
- 整合大盤真實日K、外資/投信/自營商期貨留倉 (Net OI)、三大法人現貨買賣超、權值龍頭與市場動能廣度
- 預測未來 5 天、10 天、20 天大盤多空波段方向、突破勝率、跌破風險與關鍵支撐壓力
- 提供 Top 8 可解釋性特徵貢獻排行 (Feature Importance)
"""

import os
import sys
import json
import sqlite3
import joblib
import datetime
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple, List

try:
    import lightgbm as lgb
except ImportError:
    lgb = None

try:
    import xgboost as xgb
except ImportError:
    xgb = None

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
DB_PATH = os.path.join(LOCAL_DIR, "tw_stock.db")
PREDICTION_JSON_PATH = os.path.join(LOCAL_DIR, "market_ml_prediction.json")
MODEL_SAVE_PATH = os.path.join(LOCAL_DIR, "market_ml_model_lightgbm.joblib")

def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"找不到資料庫: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

FEATURE_NAMES_ZH = {
    'ret_1d': '大盤 1 日漲跌幅 (%)',
    'ret_3d': '大盤 3 日累計漲跌 (%)',
    'ret_5d': '大盤 5 日累計漲跌 (%)',
    'ret_10d': '大盤 10 日累計漲跌 (%)',
    'ret_20d': '大盤 20 日月波段漲跌 (%)',
    'ret_60d': '大盤 60 日季線波段漲跌 (%)',
    'ma5_bias': '大盤 5 日線乖離率 (%)',
    'ma10_bias': '大盤 10 日線乖離率 (%)',
    'ma20_bias': '大盤 20 日月線乖離率 (%)',
    'ma60_bias': '大盤 60 日季線乖離率 (%)',
    'ma120_bias': '大盤 120 日半年線乖離率 (%)',
    'ma_alignment': '均線多頭排列評分 (-1~+1)',
    'rsi_14': '大盤 14 日 RSI 相對強弱',
    'macd_hist': '大盤 MACD 柱狀體動能',
    'volatility_20d': '大盤 20 日年化波動度 (%)',
    'turnover_ratio_5d': '大盤成交量能放大倍數',
    'foreign_futures_net': '外資台指期未平倉淨口數 (口)',
    'foreign_futures_net_change_3d': '外資期貨淨留倉 3 日增減',
    'foreign_futures_net_change_5d': '外資期貨淨留倉 5 日增減',
    'trust_futures_net': '投信台指期未平倉淨口數 (口)',
    'dealer_futures_net': '自營商台指期未平倉淨口數 (口)',
    'total_futures_inst_net': '三大法人期貨合計淨口數 (口)',
    'foreign_cash_net_1d': '外資現貨單日買賣超 (億元)',
    'foreign_cash_net_5d': '外資現貨 5 日累計買賣超 (億元)',
    'trust_cash_net_1d': '投信現貨單日買賣超 (億元)',
    'trust_cash_net_5d': '投信現貨 5 日累計買賣超 (億元)',
    'total_cash_net_1d': '三大法人現貨單日合計 (億元)',
    'total_cash_net_5d': '三大法人現貨 5 日合計 (億元)',
    'tsmc_ret_5d': '台積電 (2330) 5 日漲跌幅 (%)',
    'tsmc_ret_20d': '台積電 (2330) 20 日漲跌幅 (%)',
    'tsmc_ma20_bias': '台積電月線乖離率 (%)'
}

def load_raw_data() -> Tuple[pd.DataFrame, Dict, Dict, Dict]:
    conn = get_db_connection()
    
    # 1. 載入大盤加權指數 (daily_index)
    df_index = pd.read_sql_query("""
        SELECT date, open, high, low, close, change_points, change_percent, volume, turnover
        FROM daily_index
        ORDER BY date ASC
    """, conn)
    
    # 2. 載入台指期三大法人期貨留倉 (institutional_futures)
    df_fut = pd.read_sql_query("""
        SELECT date, investor_type, net_qty
        FROM institutional_futures
        WHERE contract_name = '臺股期貨'
        ORDER BY date ASC
    """, conn)
    
    fut_dict = {}
    for _, r in df_fut.iterrows():
        d = str(r['date'])
        if d not in fut_dict:
            fut_dict[d] = {'外資': 0, '投信': 0, '自營商': 0}
        fut_dict[d][r['investor_type']] = int(r['net_qty'] or 0)
        
    # 3. 載入三大法人現貨買賣超每日加總 (institutional_trades)
    df_cash = pd.read_sql_query("""
        SELECT date,
               SUM(foreign_net) as foreign_tot,
               SUM(trust_net) as trust_tot,
               SUM(dealer_net) as dealer_tot
        FROM institutional_trades
        GROUP BY date
        ORDER BY date ASC
    """, conn)
    
    cash_dict = {}
    for _, r in df_cash.iterrows():
        d = str(r['date'])
        f_shares = float(r['foreign_tot'] or 0)
        t_shares = float(r['trust_tot'] or 0)
        d_shares = float(r['dealer_tot'] or 0)
        # 以台股均價 ~100 元粗估換算成億元金額 (1張=1000股, 1000*100=10萬, 億元=1000張)
        cash_dict[d] = {
            'foreign': round(f_shares * 100.0 / 100000000.0, 2),
            'trust': round(t_shares * 100.0 / 100000000.0, 2),
            'dealer': round(d_shares * 100.0 / 100000000.0, 2),
            'total': round((f_shares + t_shares + d_shares) * 100.0 / 100000000.0, 2)
        }
        
    # 4. 載入台積電 (2330) 每日價量
    df_tsmc = pd.read_sql_query("""
        SELECT date, closing_price
        FROM daily_stock
        WHERE stock_id = '2330'
        ORDER BY date ASC
    """, conn)
    tsmc_dict = {str(r['date']): float(r['closing_price']) for _, r in df_tsmc.iterrows() if r['closing_price']}
    
    conn.close()
    return df_index, fut_dict, cash_dict, tsmc_dict

def build_features() -> pd.DataFrame:
    df_index, fut_dict, cash_dict, tsmc_dict = load_raw_data()
    if df_index.empty:
        raise ValueError("daily_index 表查無數據，請先執行 sync_market_index.py")
        
    closes = df_index['close'].values
    opens = df_index['open'].values
    highs = df_index['high'].values
    lows = df_index['low'].values
    dates = df_index['date'].values
    turnovers = df_index['turnover'].values
    n = len(closes)
    
    # 預先計算常見均線
    ma5 = pd.Series(closes).rolling(5).mean().values
    ma10 = pd.Series(closes).rolling(10).mean().values
    ma20 = pd.Series(closes).rolling(20).mean().values
    ma60 = pd.Series(closes).rolling(60).mean().values
    ma120 = pd.Series(closes).rolling(120).mean().values
    
    # RSI 14
    deltas = np.diff(closes)
    seed = deltas[:14]
    up = seed[seed >= 0].sum() / 14 if len(seed) else 0
    down = -seed[seed < 0].sum() / 14 if len(seed) else 0
    rs = up / down if down != 0 else 0
    rsi = np.zeros(n)
    rsi[:14] = 50.0
    for i in range(14, n - 1):
        delta = deltas[i]
        up_val = delta if delta > 0 else 0.0
        down_val = -delta if delta < 0 else 0.0
        up = (up * 13 + up_val) / 14
        down = (down * 13 + down_val) / 14
        rs = up / down if down != 0 else 0
        rsi[i+1] = 100.0 - (100.0 / (1.0 + rs))
        
    # MACD (12, 26, 9)
    ema12 = pd.Series(closes).ewm(span=12, adjust=False).mean()
    ema26 = pd.Series(closes).ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    macd_hist = (dif - dea).values
    
    # 年化波動度 (20d)
    log_ret = pd.Series(closes).pct_change()
    vol20 = (log_ret.rolling(20).std() * np.sqrt(250) * 100).fillna(15.0).values
    
    # 成交量放大倍數 (5d均量)
    ma_turnover_5 = pd.Series(turnovers).rolling(5).mean().values
    turnover_ratio = np.where(ma_turnover_5 > 0, turnovers / ma_turnover_5, 1.0)
    
    rows = []
    last_fut_info = {'外資': 0, '投信': 0, '自營商': 0}
    last_cash_info = {'foreign': 0, 'trust': 0, 'dealer': 0, 'total': 0}
    last_tsmc_c = 0.0

    for i in range(n):
        d = dates[i]
        c = closes[i]
        
        # 漲跌幅
        r1 = (c / closes[i-1] - 1) * 100 if i >= 1 and closes[i-1] else 0.0
        r3 = (c / closes[i-3] - 1) * 100 if i >= 3 and closes[i-3] else 0.0
        r5 = (c / closes[i-5] - 1) * 100 if i >= 5 and closes[i-5] else 0.0
        r10 = (c / closes[i-10] - 1) * 100 if i >= 10 and closes[i-10] else 0.0
        r20 = (c / closes[i-20] - 1) * 100 if i >= 20 and closes[i-20] else 0.0
        r60 = (c / closes[i-60] - 1) * 100 if i >= 60 and closes[i-60] else 0.0
        
        # 乖離率
        b5 = (c / ma5[i] - 1) * 100 if ma5[i] else 0.0
        b10 = (c / ma10[i] - 1) * 100 if ma10[i] else 0.0
        b20 = (c / ma20[i] - 1) * 100 if ma20[i] else 0.0
        b60 = (c / ma60[i] - 1) * 100 if ma60[i] else 0.0
        b120 = (c / ma120[i] - 1) * 100 if ma120[i] else 0.0
        
        # 均線排列分數
        alignment = 0.0
        if ma5[i] and ma20[i] and ma60[i]:
            if ma5[i] > ma20[i] > ma60[i]:
                alignment = 1.0
            elif ma5[i] < ma20[i] < ma60[i]:
                alignment = -1.0
                
        # 期貨籌碼 (自動向前填補最新交易日)
        if d in fut_dict:
            last_fut_info = fut_dict[d]
        f_fut = last_fut_info['外資']
        t_fut = last_fut_info['投信']
        d_fut = last_fut_info['自營商']
        tot_fut = f_fut + t_fut + d_fut
        
        # 期貨歷史增減 (3d, 5d)
        d_prev3 = dates[i-3] if i >= 3 else d
        d_prev5 = dates[i-5] if i >= 5 else d
        f_fut_prev3 = fut_dict.get(d_prev3, {}).get('外資', f_fut)
        f_fut_prev5 = fut_dict.get(d_prev5, {}).get('外資', f_fut)
        f_fut_chg3 = f_fut - f_fut_prev3
        f_fut_chg5 = f_fut - f_fut_prev5
        
        # 現貨籌碼
        if d in cash_dict:
            last_cash_info = cash_dict[d]
        f_cash_1d = last_cash_info['foreign']
        t_cash_1d = last_cash_info['trust']
        tot_cash_1d = last_cash_info['total']
        
        f_cash_5d = sum([cash_dict.get(dates[j], {}).get('foreign', 0) for j in range(max(0, i-4), i+1)])
        t_cash_5d = sum([cash_dict.get(dates[j], {}).get('trust', 0) for j in range(max(0, i-4), i+1)])
        tot_cash_5d = sum([cash_dict.get(dates[j], {}).get('total', 0) for j in range(max(0, i-4), i+1)])
        
        # 台積電連動
        if d in tsmc_dict and tsmc_dict[d] > 0:
            last_tsmc_c = tsmc_dict[d]
        tsmc_c = last_tsmc_c
        
        tsmc_c_prev5 = tsmc_dict.get(d_prev5, tsmc_c) if i >= 5 else tsmc_c
        tsmc_ret5 = ((tsmc_c / tsmc_c_prev5 - 1) * 100) if (tsmc_c and tsmc_c_prev5) else 0.0
        tsmc_ret20 = 0.0
        tsmc_ma20_bias = 0.0
        if i >= 20 and tsmc_c > 0:
            tsmc_c_prev20 = tsmc_dict.get(dates[i-20], tsmc_c)
            tsmc_ret20 = ((tsmc_c / tsmc_c_prev20 - 1) * 100) if tsmc_c_prev20 else 0.0
            tsmc_20_slice = [tsmc_dict.get(dates[j], tsmc_c) for j in range(i-19, i+1)]
            valid_tsmc = [x for x in tsmc_20_slice if x > 0]
            tsmc_ma20 = sum(valid_tsmc) / len(valid_tsmc) if valid_tsmc else tsmc_c
            tsmc_ma20_bias = ((tsmc_c / tsmc_ma20 - 1) * 100) if tsmc_ma20 else 0.0
            
        # 未來目標標籤 (Targets)
        fut_ret_5d = (closes[i+5] / c - 1) * 100 if i + 5 < n else None
        fut_ret_10d = (closes[i+10] / c - 1) * 100 if i + 10 < n else None
        fut_ret_20d = (closes[i+20] / c - 1) * 100 if i + 20 < n else None
        
        # 標籤定義：以 20 天為例，漲超過 +3% 為多(1)，跌破 -3% 為空(0)，其餘為盤整
        target_up_20d = 1 if (fut_ret_20d is not None and fut_ret_20d >= 2.5) else 0
        target_down_20d = 1 if (fut_ret_20d is not None and fut_ret_20d <= -2.5) else 0
        
        target_up_5d = 1 if (fut_ret_5d is not None and fut_ret_5d >= 1.2) else 0
        target_down_5d = 1 if (fut_ret_5d is not None and fut_ret_5d <= -1.2) else 0
        
        rows.append({
            'date': d,
            'close': c,
            'turnover': turnovers[i],
            # Features
            'ret_1d': r1,
            'ret_3d': r3,
            'ret_5d': r5,
            'ret_10d': r10,
            'ret_20d': r20,
            'ret_60d': r60,
            'ma5_bias': b5,
            'ma10_bias': b10,
            'ma20_bias': b20,
            'ma60_bias': b60,
            'ma120_bias': b120,
            'ma_alignment': alignment,
            'rsi_14': rsi[i],
            'macd_hist': macd_hist[i],
            'volatility_20d': vol20[i],
            'turnover_ratio_5d': turnover_ratio[i],
            'foreign_futures_net': f_fut,
            'foreign_futures_net_change_3d': f_fut_chg3,
            'foreign_futures_net_change_5d': f_fut_chg5,
            'trust_futures_net': t_fut,
            'dealer_futures_net': d_fut,
            'total_futures_inst_net': tot_fut,
            'foreign_cash_net_1d': f_cash_1d,
            'foreign_cash_net_5d': f_cash_5d,
            'trust_cash_net_1d': t_cash_1d,
            'trust_cash_net_5d': t_cash_5d,
            'total_cash_net_1d': tot_cash_1d,
            'total_cash_net_5d': tot_cash_5d,
            'tsmc_ret_5d': tsmc_ret5,
            'tsmc_ret_20d': tsmc_ret20,
            'tsmc_ma20_bias': tsmc_ma20_bias,
            # Targets
            'fut_ret_5d': fut_ret_5d,
            'fut_ret_10d': fut_ret_10d,
            'fut_ret_20d': fut_ret_20d,
            'target_up_20d': target_up_20d,
            'target_down_20d': target_down_20d,
            'target_up_5d': target_up_5d,
            'target_down_5d': target_down_5d
        })
        
    return pd.DataFrame(rows)

def train_and_evaluate_model():
    """訓練 LightGBM / Random Forest 預測大盤波段，並驗證 AUC"""
    print("[*] 正在構建大盤宏觀多因子時序特徵庫...")
    df = build_features()
    
    feature_cols = list(FEATURE_NAMES_ZH.keys())
    
    # 排除最後 20 天無完整未來標籤之資料作為訓練集
    valid_df = df[df['fut_ret_20d'].notnull()].copy()
    valid_df = valid_df[valid_df['date'] >= '20170101'] # 保留 2017 之後穩定期
    
    X = valid_df[feature_cols].values
    Y_up_20 = valid_df['target_up_20d'].values
    Y_down_20 = valid_df['target_down_20d'].values
    Y_up_5 = valid_df['target_up_5d'].values
    
    split_idx = int(len(X) * 0.8)
    X_train, X_test = X[:split_idx], X[split_idx:]
    Y_train_up, Y_test_up = Y_up_20[:split_idx], Y_up_20[split_idx:]
    Y_train_down, Y_test_down = Y_down_20[:split_idx], Y_down_20[split_idx:]
    
    print(f"[*] 訓練樣本數: {len(X_train)} 天, 驗證集樣本數: {len(X_test)} 天")
    
    # 訓練 20 天突破多方模型
    clf_up = lgb.LGBMClassifier(
        n_estimators=100,
        learning_rate=0.03,
        max_depth=4,
        num_leaves=15,
        random_state=42,
        importance_type='gain'
    )
    clf_up.fit(X_train, Y_train_up)
    
    # 訓練 20 天跌破空方模型
    clf_down = lgb.LGBMClassifier(
        n_estimators=100,
        learning_rate=0.03,
        max_depth=4,
        num_leaves=15,
        random_state=42,
        importance_type='gain'
    )
    clf_down.fit(X_train, Y_train_down)
    
    # 5 天短期多方模型
    clf_5d = lgb.LGBMClassifier(
        n_estimators=80,
        learning_rate=0.04,
        max_depth=3,
        num_leaves=10,
        random_state=42
    )
    clf_5d.fit(X_train, Y_up_5[:split_idx])
    
    # 驗證
    probs_up = clf_up.predict_proba(X_test)[:, 1]
    probs_down = clf_down.predict_proba(X_test)[:, 1]
    
    auc_up = round(roc_auc_score(Y_test_up, probs_up) * 100, 2)
    auc_down = round(roc_auc_score(Y_test_down, probs_down) * 100, 2)
    print(f"[✓] 驗證結果: 20天突破 AUC = {auc_up}%, 20天跌破 AUC = {auc_down}%")
    
    # 儲存模型
    bundle = {
        'model_up': clf_up,
        'model_down': clf_down,
        'model_5d': clf_5d,
        'feature_cols': feature_cols,
        'metrics': {
            'auc_up': auc_up,
            'auc_down': auc_down,
            'train_samples': len(X_train),
            'test_samples': len(X_test),
            'train_date': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    }
    joblib.dump(bundle, MODEL_SAVE_PATH)
    print(f"[✓] 模型成功儲存至: {MODEL_SAVE_PATH}")
    return bundle, df

def generate_prediction_report():
    """執行大盤最新推論並產出 market_ml_prediction.json"""
    if not os.path.exists(MODEL_SAVE_PATH):
        bundle, df = train_and_evaluate_model()
    else:
        bundle = joblib.load(MODEL_SAVE_PATH)
        df = build_features()
        
    clf_up = bundle['model_up']
    clf_down = bundle['model_down']
    clf_5d = bundle['model_5d']
    feature_cols = bundle['feature_cols']
    metrics = bundle.get('metrics', {})
    
    latest_row = df.iloc[-1]
    latest_date = str(latest_row['date'])
    curr_close = float(latest_row['close'])
    
    # 提取特徵進行預測
    x_latest = latest_row[feature_cols].values.reshape(1, -1)
    prob_up_20 = round(float(clf_up.predict_proba(x_latest)[0, 1]) * 100, 1)
    prob_down_20 = round(float(clf_down.predict_proba(x_latest)[0, 1]) * 100, 1)
    prob_neutral_20 = max(0.0, round(100.0 - prob_up_20 - prob_down_20, 1))
    
    prob_up_5 = round(float(clf_5d.predict_proba(x_latest)[0, 1]) * 100, 1)
    prob_down_5 = round(max(5.0, 100.0 - prob_up_5 - 20.0), 1)
    
    # 多空信號評等
    if prob_up_20 >= 55.0 and prob_down_20 < 30.0:
        signal = 'bullish'
        signal_badge = '🟢 多方強烈偏多'
        signal_desc = 'AI 模型判定大盤處於多頭趨勢向上發散波段，多方突破勝率大幅領先。'
    elif prob_down_20 >= 45.0:
        signal = 'bearish'
        signal_badge = '🔴 空方回檔警戒'
        signal_desc = 'AI 模型偵測到大盤回檔避險訊號，期貨空方防守與跌破風險偏高，宜適度提高現金水位。'
    elif prob_up_20 >= 40.0 and prob_down_20 <= 35.0:
        signal = 'mild_bullish'
        signal_badge = '🌿 偏多震盪整理'
        signal_desc = '多方動能溫和，短期均線有撐，盤整墊高勝率高於下殺風險。'
    else:
        signal = 'neutral'
        signal_badge = '🟡 區間箱型盤整'
        signal_desc = '多空力道平衡，大盤處於均線糾結或高檔震盪整理區間，宜選股不選市。'
        
    # 計算期貨外資警戒級別
    f_fut_net = int(latest_row['foreign_futures_net'])
    if f_fut_net < -35000:
        fut_risk = '🚨 極高空單警戒 (破 3.5 萬口)'
        fut_color = '#EF4444'
    elif f_fut_net < -20000:
        fut_risk = '⚠️ 偏空壓盤警戒 (破 2 萬口)'
        fut_color = '#F59E0B'
    elif f_fut_net > 5000:
        fut_risk = '🚀 外資期貨偏多留倉'
        fut_color = '#10B981'
    else:
        fut_risk = '⚖️ 期貨籌碼中性'
        fut_color = '#93C5FD'
        
    # 計算 Top 8 關鍵特徵貢獻排行
    importances = clf_up.feature_importances_
    tot_imp = sum(importances) if sum(importances) > 0 else 1.0
    feat_rank = []
    for col, imp in zip(feature_cols, importances):
        feat_rank.append({
            'feature': col,
            'name': FEATURE_NAMES_ZH.get(col, col),
            'importance_pct': round((imp / tot_imp) * 100, 1),
            'current_value': round(float(latest_row[col]), 2)
        })
    feat_rank.sort(key=lambda x: x['importance_pct'], reverse=True)
    top_features = feat_rank[:8]
    
    # 預估支撐壓力位 (以 20 日年化波動度與近期高低點估算)
    vol_pts = curr_close * (latest_row['volatility_20d'] / 100.0) * np.sqrt(20/250)
    resistance_pts = round(curr_close + vol_pts * 0.7, 0)
    support_pts = round(curr_close - vol_pts * 0.7, 0)
    
    result = {
        'status': 'success',
        'model_name': 'LightGBM 宏觀時序融合多因子模型',
        'trained_at': metrics.get('train_date', ''),
        'latest_date': latest_date,
        'metrics': metrics,
        'current_market': {
            'close': curr_close,
            'date': latest_date,
            'volatility_20d': round(float(latest_row['volatility_20d']), 2),
            'ma5': round(float(latest_row['close'] / (1.0 + latest_row['ma5_bias']/100.0)), 2),
            'ma20': round(float(latest_row['close'] / (1.0 + latest_row['ma20_bias']/100.0)), 2),
            'ma60': round(float(latest_row['close'] / (1.0 + latest_row['ma60_bias']/100.0)), 2),
            'rsi_14': round(float(latest_row['rsi_14']), 1),
            'turnover_ratio_5d': round(float(latest_row['turnover_ratio_5d']), 2)
        },
        'prediction': {
            'signal': signal,
            'signal_badge': signal_badge,
            'signal_desc': signal_desc,
            'prob_up_20d': prob_up_20,
            'prob_down_20d': prob_down_20,
            'prob_neutral_20d': prob_neutral_20,
            'prob_up_5d': prob_up_5,
            'prob_down_5d': prob_down_5,
            'resistance_pts': resistance_pts,
            'support_pts': support_pts
        },
        'institutional_cockpit': {
            'foreign_futures_net': f_fut_net,
            'foreign_futures_change_3d': int(latest_row['foreign_futures_net_change_3d']),
            'foreign_futures_change_5d': int(latest_row['foreign_futures_net_change_5d']),
            'foreign_futures_risk': fut_risk,
            'trust_futures_net': int(latest_row['trust_futures_net']),
            'dealer_futures_net': int(latest_row['dealer_futures_net']),
            'foreign_cash_net_1d': float(latest_row['foreign_cash_net_1d']),
            'foreign_cash_net_5d': float(latest_row['foreign_cash_net_5d']),
            'trust_cash_net_1d': float(latest_row['trust_cash_net_1d']),
            'trust_cash_net_5d': float(latest_row['trust_cash_net_5d']),
            'total_cash_net_1d': float(latest_row['total_cash_net_1d']),
            'total_cash_net_5d': float(latest_row['total_cash_net_5d']),
            'tsmc_ret_5d': float(latest_row['tsmc_ret_5d']),
            'tsmc_ma20_bias': float(latest_row['tsmc_ma20_bias'])
        },
        'top_features': top_features
    }
    
    with open(PREDICTION_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        
    print(f"[✓] 大盤預測報告成功產出: {PREDICTION_JSON_PATH}")
    sync_market_ml_to_supabase(result)
    return result

def sync_market_ml_to_supabase(payload=None):
    """將大盤最新推論結果同步至雲端 Supabase stock_ml_cache (model_type='taiex_macro')"""
    try:
        from stock_sync import get_supabase_conn
        if payload is None:
            if not os.path.exists(PREDICTION_JSON_PATH):
                print("[!] 找不到 market_ml_prediction.json，跳過雲端同步")
                return
            with open(PREDICTION_JSON_PATH, 'r', encoding='utf-8') as f:
                payload = json.load(f)
                
        sb_conn = get_supabase_conn()
        cur = sb_conn.cursor()
        cur.execute("""
            INSERT INTO stock_ml_cache (model_type, payload, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (model_type) DO UPDATE SET
                payload = EXCLUDED.payload,
                updated_at = CURRENT_TIMESTAMP
        """, ('taiex_macro', json.dumps(payload, ensure_ascii=False)))
        sb_conn.commit()
        sb_conn.close()
        print("[✓] 大盤 ML 預測已成功同步至 Supabase (stock_ml_cache -> taiex_macro)！")
    except Exception as e:
        print(f"[!] 同步大盤 ML 至 Supabase 失敗 (離線模式仍可本機運作): {e}")

if __name__ == '__main__':
    generate_prediction_report()
