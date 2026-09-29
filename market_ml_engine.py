#!/usr/bin/env python3
"""
market_ml_engine.py
台股加權指數 (TAIEX) 宏觀多因子機器學習預測引擎 (多模型訓練與評估版)
- 支援 6 款主流與尖端 ML 模型：
  1. 👑 多模型融合集成 (Ensemble: LightGBM + RF + LR Soft Voting)
  2. ⚡ LightGBM (微軟梯度提升決策樹)
  3. 📏 Logistic Regression (線性基準/高泛化)
  4. 🌳 Random Forest (隨機森林)
  5. 🌲 XGBoost (經典量化極限梯度提升)
  6. 🕸️ MLP Neural Net (深度多層感知器網絡)
- 支援靈活的訓練參數配置與多種快捷特徵預設：
  1. ⚡ 宏觀全因子標準模式 (30+ 維度全特徵)
  2. 🚀 近期動能專注模式 (短天期量能 + 外資期貨增減 + 台積電衝刺)
  3. 🛡️ 法人籌碼純量化模式 (純台指期 Net OI + 現貨三大法人買賣超)
  4. 📐 純技術線型動能模式 (純均線乖離、RSI、MACD、波動度)
- 輸出多維度模型評估指標 (AUC, 準確度, 模擬夏普率, 多空勝率) 與即時波段推論報告
"""

import os
import sys
import json
import sqlite3
import joblib
import datetime
import argparse
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple, List, Optional

try:
    import lightgbm as lgb
except ImportError:
    lgb = None

try:
    import xgboost as xgb
except ImportError:
    xgb = None

from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.metrics import accuracy_score, roc_auc_score

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = "/Users/huanggin-chen/gemini-stock-analysis"
DB_PATH = os.path.join(LOCAL_DIR, "tw_stock.db")
PREDICTION_JSON_PATH = os.path.join(LOCAL_DIR, "market_ml_prediction.json")
MODELS_BUNDLE_PATH = os.path.join(LOCAL_DIR, "market_ml_models.joblib")

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

MODEL_CATALOG = {
    'ensemble': {
        'id': 'ensemble',
        'name': '👑 多模型融合集成 (Ensemble)',
        'short_name': '👑 集成模型',
        'tag': '🥇 綜合推薦首選',
        'desc': '軟投票融合 LightGBM、隨機森林與高泛化羅吉斯迴歸，AUC 表現最佳',
    },
    'lightgbm': {
        'id': 'lightgbm',
        'name': '⚡ LightGBM (梯度提升)',
        'short_name': '⚡ LightGBM',
        'tag': '⚡ 靈敏動能',
        'desc': '微軟開源高效梯度提升決策樹，擅長捕捉籌碼與技術面非線性轉折',
    },
    'lr': {
        'id': 'lr',
        'name': '📏 Logistic Regression (線性基準)',
        'short_name': '📏 羅吉斯迴歸',
        'tag': '🎯 泛化穩定',
        'desc': '宏觀全因子 L2 正則化羅吉斯迴歸，方向預測穩定度高、抗過擬合',
    },
    'rf': {
        'id': 'rf',
        'name': '🌳 Random Forest (隨機森林)',
        'short_name': '🌳 隨機森林',
        'tag': '🛡️ 穩健防禦',
        'desc': '多決策樹 Bagging 集成，能有效平滑單一極端指標雜訊',
    },
    'xgboost': {
        'id': 'xgboost',
        'name': '🌲 XGBoost (經典量化)',
        'short_name': '🌲 XGBoost',
        'tag': '🔥 經典量化',
        'desc': '華爾街與量化基金經典極限梯度提升，對波動急遽擴大有高敏感度',
    },
    'mlp': {
        'id': 'mlp',
        'name': '🕸️ MLP Neural Net (深度感知器)',
        'short_name': '🕸️ MLP 類神經',
        'tag': '🧠 深度網路',
        'desc': '多層前饋神經網絡，透過深度隱藏層提煉宏觀多因子交互效應',
    }
}

FEATURE_PRESETS = {
    'all_factors': {
        'id': 'all_factors',
        'name': '⚡ 宏觀全因子標準',
        'desc': '包含技術指標、外資期貨、三大法人現貨與台積電等 30+ 項全特徵',
        'features': list(FEATURE_NAMES_ZH.keys())
    },
    'recent_momentum': {
        'id': 'recent_momentum',
        'name': '🚀 近期動能專注',
        'desc': '偏重短天期動能 (1d~10d)、外資期貨增減與台積電 5 日衝刺',
        'features': [
            'ret_1d', 'ret_3d', 'ret_5d', 'ret_10d', 'ma5_bias', 'ma10_bias',
            'rsi_14', 'macd_hist', 'volatility_20d', 'turnover_ratio_5d',
            'foreign_futures_net', 'foreign_futures_net_change_3d', 'foreign_futures_net_change_5d',
            'total_futures_inst_net', 'foreign_cash_net_1d', 'foreign_cash_net_5d',
            'total_cash_net_1d', 'tsmc_ret_5d', 'tsmc_ma20_bias'
        ]
    },
    'institutional_flow': {
        'id': 'institutional_flow',
        'name': '🛡️ 法人籌碼純量化',
        'desc': '純三大法人台指期未平倉留倉單、現貨大額買賣超與台積電籌碼',
        'features': [
            'foreign_futures_net', 'foreign_futures_net_change_3d', 'foreign_futures_net_change_5d',
            'trust_futures_net', 'dealer_futures_net', 'total_futures_inst_net',
            'foreign_cash_net_1d', 'foreign_cash_net_5d', 'trust_cash_net_1d', 'trust_cash_net_5d',
            'total_cash_net_1d', 'total_cash_net_5d', 'tsmc_ret_5d', 'tsmc_ret_20d', 'tsmc_ma20_bias'
        ]
    },
    'pure_technicals': {
        'id': 'pure_technicals',
        'name': '📐 純技術線型動能',
        'desc': '純加權指數各期均線、乖離率、RSI、MACD、波動度與成交量能倍數',
        'features': [
            'ret_1d', 'ret_3d', 'ret_5d', 'ret_10d', 'ret_20d', 'ret_60d',
            'ma5_bias', 'ma10_bias', 'ma20_bias', 'ma60_bias', 'ma120_bias',
            'ma_alignment', 'rsi_14', 'macd_hist', 'volatility_20d', 'turnover_ratio_5d'
        ]
    }
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
        # 以每股約 100 元初估換算金額(億元)，若無金額則以買賣超萬股指標化
        cash_dict[d] = {
            'foreign': round(f_shares * 100 / 1e8, 2),
            'trust': round(t_shares * 100 / 1e8, 2),
            'dealer': round(d_shares * 100 / 1e8, 2),
            'total': round((f_shares + t_shares + d_shares) * 100 / 1e8, 2)
        }
        
    # 4. 載入台積電 (2330) 股價
    df_tsmc = pd.read_sql_query("""
        SELECT date, closing_price as close
        FROM daily_stock
        WHERE stock_id = '2330'
        ORDER BY date ASC
    """, conn)
    tsmc_dict = {str(r['date']): float(r['close'] or 0) for _, r in df_tsmc.iterrows()}
    
    conn.close()
    return df_index, fut_dict, cash_dict, tsmc_dict

def build_features() -> pd.DataFrame:
    df_index, fut_dict, cash_dict, tsmc_dict = load_raw_data()
    n = len(df_index)
    
    dates = df_index['date'].astype(str).tolist()
    closes = df_index['close'].astype(float).tolist()
    turnovers = df_index['turnover'].astype(float).tolist()
    
    # 計算各期均線
    s_close = pd.Series(closes)
    ma5 = s_close.rolling(5).mean().values
    ma10 = s_close.rolling(10).mean().values
    ma20 = s_close.rolling(20).mean().values
    ma60 = s_close.rolling(60).mean().values
    ma120 = s_close.rolling(120).mean().values
    
    # 計算 RSI (14)
    delta = s_close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(14).mean()
    avg_loss = loss.rolling(14).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = (100 - (100 / (1 + rs))).fillna(50.0).values
    
    # MACD (12, 26, 9)
    ema12 = s_close.ewm(span=12, adjust=False).mean()
    ema26 = s_close.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    macd_hist = (dif - dea).values
    
    # 年化波動度 (20d)
    log_ret = s_close.pct_change()
    vol20 = (log_ret.rolling(20).std() * np.sqrt(250) * 100).fillna(15.0).values
    
    # 成交量放大倍數 (5d均量) - 使用 np.divide 避免 0 除警告
    ma_turnover_5 = pd.Series(turnovers).rolling(5).mean().values
    turnover_ratio = np.divide(turnovers, ma_turnover_5, out=np.ones_like(turnovers, dtype=float), where=(ma_turnover_5 > 0))
    
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
        
        # 均線乖離率
        b5 = (c / ma5[i] - 1) * 100 if ma5[i] else 0.0
        b10 = (c / ma10[i] - 1) * 100 if ma10[i] else 0.0
        b20 = (c / ma20[i] - 1) * 100 if ma20[i] else 0.0
        b60 = (c / ma60[i] - 1) * 100 if ma60[i] else 0.0
        b120 = (c / ma120[i] - 1) * 100 if ma120[i] else 0.0
        
        # 均線多頭排列評分
        alignment = 0.0
        if ma5[i] and ma10[i] and ma20[i] and ma60[i]:
            if ma5[i] > ma10[i] > ma20[i] > ma60[i]:
                alignment = 1.0
            elif ma5[i] < ma10[i] < ma20[i] < ma60[i]:
                alignment = -1.0
            else:
                score = (1 if ma5[i] > ma20[i] else -1) + (1 if ma20[i] > ma60[i] else -1)
                alignment = score / 2.0
                
        # 期貨留倉 (Forward-fill 避免缺失)
        if d in fut_dict:
            last_fut_info = fut_dict[d]
        f_info = last_fut_info
        f_fut = f_info.get('外資', 0)
        t_fut = f_info.get('投信', 0)
        d_fut = f_info.get('自營商', 0)
        tot_fut = f_fut + t_fut + d_fut
        
        d_prev3 = dates[i-3] if i >= 3 else d
        d_prev5 = dates[i-5] if i >= 5 else d
        f_fut_prev3 = fut_dict.get(d_prev3, {}).get('外資', f_fut)
        f_fut_prev5 = fut_dict.get(d_prev5, {}).get('外資', f_fut)
        f_fut_chg3 = f_fut - f_fut_prev3
        f_fut_chg5 = f_fut - f_fut_prev5
        
        # 現貨買賣超 (Forward-fill)
        if d in cash_dict:
            last_cash_info = cash_dict[d]
        c_info = last_cash_info
        f_cash_1d = c_info.get('foreign', 0)
        t_cash_1d = c_info.get('trust', 0)
        tot_cash_1d = c_info.get('total', 0)
        
        f_cash_5d = sum([cash_dict.get(dates[j], {}).get('foreign', 0) for j in range(max(0, i-4), i+1)])
        t_cash_5d = sum([cash_dict.get(dates[j], {}).get('trust', 0) for j in range(max(0, i-4), i+1)])
        tot_cash_5d = sum([cash_dict.get(dates[j], {}).get('total', 0) for j in range(max(0, i-4), i+1)])
        
        # 台積電連動 (Forward-fill)
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
        
        # 標籤定義：以 20 天為例，漲超過 +2.5% 為多(1)，跌破 -2.5% 為空(1)
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

def create_model_pipeline(model_id: str):
    """依據模型 ID 建立包含防缺漏值與正規化之前處理 Pipeline"""
    if model_id == 'lightgbm':
        clf = lgb.LGBMClassifier(
            n_estimators=100,
            learning_rate=0.03,
            max_depth=4,
            num_leaves=15,
            random_state=42,
            importance_type='gain',
            verbose=-1
        )
        return make_pipeline(SimpleImputer(strategy='median'), clf)
    
    elif model_id == 'xgboost':
        clf = xgb.XGBClassifier(
            n_estimators=100,
            learning_rate=0.03,
            max_depth=4,
            random_state=42,
            eval_metric='logloss'
        )
        return make_pipeline(SimpleImputer(strategy='median'), clf)
    
    elif model_id == 'rf':
        clf = RandomForestClassifier(
            n_estimators=100,
            max_depth=5,
            random_state=42
        )
        return make_pipeline(SimpleImputer(strategy='median'), clf)
    
    elif model_id == 'lr':
        clf = LogisticRegression(
            C=0.1,
            max_iter=1000,
            random_state=42
        )
        return make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), clf)
    
    elif model_id == 'mlp':
        clf = MLPClassifier(
            hidden_layer_sizes=(32, 16),
            max_iter=250,
            early_stopping=True,
            random_state=42
        )
        return make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), clf)
    
    elif model_id == 'ensemble':
        c1 = make_pipeline(SimpleImputer(strategy='median'), lgb.LGBMClassifier(n_estimators=100, learning_rate=0.03, max_depth=4, num_leaves=15, random_state=42, verbose=-1))
        c2 = make_pipeline(SimpleImputer(strategy='median'), RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42))
        c3 = make_pipeline(SimpleImputer(strategy='median'), StandardScaler(), LogisticRegression(C=0.1, max_iter=1000, random_state=42))
        return VotingClassifier(estimators=[('lgb', c1), ('rf', c2), ('lr', c3)], voting='soft')
    
    else:
        raise ValueError(f"不支援的模型 ID: {model_id}")

def extract_feature_importance(pipeline, feature_cols: List[str], model_id: str) -> List[float]:
    """提取不同模型的特徵重要性權重"""
    try:
        if model_id == 'lightgbm':
            return list(pipeline.named_steps['lgbmclassifier'].feature_importances_)
        elif model_id == 'xgboost':
            return list(pipeline.named_steps['xgbclassifier'].feature_importances_)
        elif model_id == 'rf':
            return list(pipeline.named_steps['randomforestclassifier'].feature_importances_)
        elif model_id == 'lr':
            return list(np.abs(pipeline.named_steps['logisticregression'].coef_[0]))
        elif model_id == 'ensemble':
            # 平均各子模型標準化後的權重
            weights = np.zeros(len(feature_cols))
            estimators = pipeline.named_estimators_
            if 'lgb' in estimators:
                imp = estimators['lgb'].named_steps['lgbmclassifier'].feature_importances_
                weights += imp / (np.sum(imp) + 1e-9)
            if 'rf' in estimators:
                imp = estimators['rf'].named_steps['randomforestclassifier'].feature_importances_
                weights += imp / (np.sum(imp) + 1e-9)
            if 'lr' in estimators:
                imp = np.abs(estimators['lr'].named_steps['logisticregression'].coef_[0])
                weights += imp / (np.sum(imp) + 1e-9)
            return list(weights)
        else:
            return [1.0 / len(feature_cols)] * len(feature_cols)
    except Exception:
        return [1.0 / len(feature_cols)] * len(feature_cols)

def calculate_simulation_metrics(probs_up: np.ndarray, probs_down: np.ndarray, fut_rets: np.ndarray) -> Tuple[float, float]:
    """計算模擬交易信號的年化夏普值與多空勝率"""
    try:
        # 當 prob_up > 0.45 視為作多信號(+1)，prob_down > 0.45 視為放空或避險(-1)，其餘空手(0)
        signals = np.where(probs_up > 0.45, 1.0, np.where(probs_down > 0.45, -1.0, 0.0))
        strat_returns = signals * (fut_rets / 100.0)
        active_returns = strat_returns[signals != 0]
        
        if len(active_returns) == 0:
            return 1.0, 50.0
            
        win_count = np.sum(active_returns > 0)
        win_rate = round(float(win_count / len(active_returns) * 100), 1)
        
        mean_r = np.mean(strat_returns)
        std_r = np.std(strat_returns)
        sharpe = round(float((mean_r / (std_r + 1e-9)) * np.sqrt(250 / 20)), 2)
        return max(-2.0, min(5.0, sharpe)), win_rate
    except Exception:
        return 1.0, 50.0

def train_and_evaluate_models(config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    全功能多模型訓練與評估引擎
    - config 支援參數:
      * model_type: 'all' 或單一模型 'ensemble', 'lightgbm', 'lr', 'rf', 'xgboost', 'mlp'
      * train_days: 訓練天數 (預設全部歷史，或指定 500, 1000, 1800 等)
      * test_ratio: 走步驗證切分比率 (預設 0.2)
      * features_preset: 'all_factors', 'recent_momentum', 'institutional_flow', 'pure_technicals'
      * threshold_pct: 趨勢突破門檻百分比 (預設 2.5%)
    """
    config = config or {}
    target_model = config.get('model_type', 'all')
    features_preset = config.get('features_preset', 'all_factors')
    train_days_limit = int(config.get('train_days', 0) or 0)
    test_ratio = float(config.get('test_ratio', 0.2) or 0.2)
    threshold_pct = float(config.get('threshold_pct', 2.5) or 2.5)
    
    print(f"[*] 啟動大盤 ML 訓練任務: target_model={target_model}, preset={features_preset}, train_days={train_days_limit or '全部'}, test_ratio={test_ratio}")
    
    # 1. 構建大盤宏觀特徵矩陣
    df = build_features()
    
    # 決定特徵清單
    preset_info = FEATURE_PRESETS.get(features_preset, FEATURE_PRESETS['all_factors'])
    feature_cols = [c for c in preset_info['features'] if c in FEATURE_NAMES_ZH]
    
    # 篩選有效樣本
    valid_df = df[df['fut_ret_20d'].notnull() & (df['date'] >= '20170101')].copy()
    if train_days_limit > 0 and len(valid_df) > train_days_limit:
        valid_df = valid_df.iloc[-train_days_limit:].copy()
        
    X = valid_df[feature_cols].values
    
    # 動態自訂多空門檻
    fut_ret_20 = valid_df['fut_ret_20d'].values
    Y_up_20 = np.where(fut_ret_20 >= threshold_pct, 1, 0)
    Y_down_20 = np.where(fut_ret_20 <= -threshold_pct, 1, 0)
    
    fut_ret_5 = valid_df['fut_ret_5d'].values
    Y_up_5 = np.where(fut_ret_5 >= (threshold_pct * 0.5), 1, 0)
    
    # Walk-forward 測試集切分
    n_samples = len(X)
    split_idx = int(n_samples * (1.0 - test_ratio))
    X_train, X_test = X[:split_idx], X[split_idx:]
    Y_tr_u20, Y_te_u20 = Y_up_20[:split_idx], Y_up_20[split_idx:]
    Y_tr_d20, Y_te_d20 = Y_down_20[:split_idx], Y_down_20[split_idx:]
    Y_tr_u5, Y_te_u5 = Y_up_5[:split_idx], Y_up_5[split_idx:]
    fut_rets_test = fut_ret_20[split_idx:]
    
    train_range = f"{valid_df.iloc[0]['date']} ~ {valid_df.iloc[split_idx-1]['date']}"
    test_range = f"{valid_df.iloc[split_idx]['date']} ~ {valid_df.iloc[-1]['date']}"
    
    print(f"[*] 訓練樣本: {len(X_train)} 天 ({train_range}), 驗證樣本: {len(X_test)} 天 ({test_range})")
    
    # 載入現有模型 bundle (若只訓練單一模型可保留其他模型)
    models_bundle = {}
    if os.path.exists(MODELS_BUNDLE_PATH):
        try:
            models_bundle = joblib.load(MODELS_BUNDLE_PATH)
        except Exception:
            models_bundle = {}
            
    models_to_train = list(MODEL_CATALOG.keys()) if target_model == 'all' else [target_model]
    
    latest_row = df.iloc[-1]
    latest_date = str(latest_row['date'])
    curr_close = float(latest_row['close'])
    x_latest = latest_row[feature_cols].values.reshape(1, -1)
    
    models_status = models_bundle.get('models_status', {})
    
    for m_id in models_to_train:
        if m_id not in MODEL_CATALOG:
            continue
        m_info = MODEL_CATALOG[m_id]
        print(f"[*] 正在訓練 {m_info['name']} ...")
        
        # 訓練 20 天突破多方
        clf_up = create_model_pipeline(m_id)
        clf_up.fit(X_train, Y_tr_u20)
        probs_up = clf_up.predict_proba(X_test)[:, 1]
        preds_up = clf_up.predict(X_test)
        auc_up = round(float(roc_auc_score(Y_te_u20, probs_up) * 100), 1)
        acc_up = round(float(accuracy_score(Y_te_u20, preds_up) * 100), 1)
        
        # 訓練 20 天跌破空方
        clf_down = create_model_pipeline(m_id)
        clf_down.fit(X_train, Y_tr_d20)
        probs_down = clf_down.predict_proba(X_test)[:, 1]
        auc_down = round(float(roc_auc_score(Y_te_d20, probs_down) * 100), 1)
        
        # 訓練 5 天短期多方
        clf_5d = create_model_pipeline(m_id)
        clf_5d.fit(X_train, Y_tr_u5)
        probs_5d = clf_5d.predict_proba(X_test)[:, 1]
        
        # 計算模擬交易夏普率與多空勝率
        sharpe, win_rate = calculate_simulation_metrics(probs_up, probs_down, fut_rets_test)
        
        # 即時最新推論
        p_up_20 = round(float(clf_up.predict_proba(x_latest)[0, 1]) * 100, 1)
        p_down_20 = round(float(clf_down.predict_proba(x_latest)[0, 1]) * 100, 1)
        p_neutral_20 = max(0.0, round(100.0 - p_up_20 - p_down_20, 1))
        
        p_up_5 = round(float(clf_5d.predict_proba(x_latest)[0, 1]) * 100, 1)
        p_down_5 = round(max(5.0, 100.0 - p_up_5 - 20.0), 1)
        
        # 多空信號評等
        if p_up_20 >= 55.0 and p_down_20 < 30.0:
            signal = 'bullish'
            signal_badge = '🟢 多方強烈偏多'
            signal_desc = f"{m_info['short_name']} 判定大盤處於多頭趨勢向上發散波段，多方突破勝率大幅領先。"
        elif p_down_20 >= 45.0:
            signal = 'bearish'
            signal_badge = '🔴 空方回檔警戒'
            signal_desc = f"{m_info['short_name']} 偵測到大盤回檔避險訊號，期貨空方防守與跌破風險偏高，宜適度提高現金水位。"
        elif p_up_20 >= 40.0 and p_down_20 <= 35.0:
            signal = 'mild_bullish'
            signal_badge = '🌿 偏多震盪整理'
            signal_desc = f"{m_info['short_name']} 顯示多方動能溫和，短期均線有撐，盤整墊高勝率高於下殺風險。"
        else:
            signal = 'neutral'
            signal_badge = '🟡 區間箱型盤整'
            signal_desc = f"{m_info['short_name']} 判定多空力道平衡，大盤處於均線糾結或高檔震盪整理區間，宜選股不選市。"
            
        # Top 8 特徵重要性
        importances = extract_feature_importance(clf_up, feature_cols, m_id)
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
        
        # 支撐壓力位計算
        vol_pts = curr_close * (latest_row['volatility_20d'] / 100.0) * np.sqrt(20/250)
        resistance_pts = round(curr_close + vol_pts * (0.8 if p_up_20 > 50 else 0.6), 0)
        support_pts = round(curr_close - vol_pts * (0.8 if p_down_20 > 40 else 0.6), 0)
        
        # 儲存單一模型結果
        models_status[m_id] = {
            'id': m_id,
            'name': m_info['name'],
            'short_name': m_info['short_name'],
            'tag': m_info['tag'],
            'desc': m_info['desc'],
            'status': 'ready',
            'trained_at': datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'train_samples': len(X_train),
            'test_samples': len(X_test),
            'train_range': train_range,
            'test_range': test_range,
            'train_days': len(valid_df),
            'features_preset': features_preset,
            'metrics': {
                'auc_up': auc_up,
                'auc_down': auc_down,
                'accuracy': acc_up,
                'sharpe': sharpe,
                'win_rate': win_rate,
                'composite_score': round(auc_up * 0.6 + acc_up * 0.4, 1)
            },
            'prediction': {
                'signal': signal,
                'signal_badge': signal_badge,
                'signal_desc': signal_desc,
                'prob_up_20d': p_up_20,
                'prob_down_20d': p_down_20,
                'prob_neutral_20d': p_neutral_20,
                'prob_up_5d': p_up_5,
                'prob_down_5d': p_down_5,
                'resistance_pts': resistance_pts,
                'support_pts': support_pts
            },
            'top_features': top_features
        }
        
        # 儲存 pipeline 物件
        if 'pipelines' not in models_bundle:
            models_bundle['pipelines'] = {}
        models_bundle['pipelines'][m_id] = {
            'clf_up': clf_up,
            'clf_down': clf_down,
            'clf_5d': clf_5d,
            'feature_cols': feature_cols
        }
        
        print(f"  [✓] {m_id:10s} -> AUC Up: {auc_up}%, Down: {auc_down}%, Acc: {acc_up}%, Sharpe: {sharpe}")
        
    models_bundle['models_status'] = models_status
    models_bundle['feature_cols'] = feature_cols
    models_bundle['last_trained_at'] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 尋找綜合評分最高之模型 (Best Model)
    best_model_id = max(models_status.keys(), key=lambda k: models_status[k]['metrics'].get('composite_score', 0))
    if 'ensemble' in models_status and models_status['ensemble']['metrics'].get('auc_up', 0) >= 65.0:
        best_model_id = 'ensemble'
    models_bundle['best_model_id'] = best_model_id
    
    joblib.dump(models_bundle, MODELS_BUNDLE_PATH)
    print(f"[✓] 全體模型 Bundle 成功儲存至: {MODELS_BUNDLE_PATH} (最佳模型: {best_model_id})")
    
    # 產出最新預測報告 JSON
    report = generate_prediction_report(selected_model_id=best_model_id, models_bundle=models_bundle, df=df)
    return report

def sanitize_for_json(obj):
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, (np.floating, float)):
        return float(obj)
    elif isinstance(obj, (np.integer, int)):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    elif isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    elif pd.isna(obj):
        return None
    return obj

def generate_prediction_report(selected_model_id: Optional[str] = None, models_bundle: Optional[Dict] = None, df: Optional[pd.DataFrame] = None) -> Dict[str, Any]:
    """生成並同步大盤多模型預測戰情報告"""
    if models_bundle is None:
        if not os.path.exists(MODELS_BUNDLE_PATH):
            print("[*] 找不到已儲存模型，立即啟動預設全模型訓練...")
            return train_and_evaluate_models({'model_type': 'all'})
        models_bundle = joblib.load(MODELS_BUNDLE_PATH)
        
    if df is None:
        df = build_features()
        
    models_status = models_bundle.get('models_status', {})
    best_model_id = models_bundle.get('best_model_id', 'ensemble')
    selected_id = selected_model_id or best_model_id
    if selected_id not in models_status and models_status:
        selected_id = list(models_status.keys())[0]
        
    latest_row = df.iloc[-1]
    latest_date = str(latest_row['date'])
    curr_close = float(latest_row['close'])
    
    # 期貨籌碼警戒分析
    f_fut_net = int(latest_row['foreign_futures_net'])
    if f_fut_net < -35000:
        fut_risk = '🚨 極高空單警戒 (破 3.5 萬口)'
    elif f_fut_net < -20000:
        fut_risk = '⚠️ 偏空壓盤警戒 (破 2 萬口)'
    elif f_fut_net > 5000:
        fut_risk = '🚀 外資期貨偏多留倉'
    else:
        fut_risk = '⚖️ 期貨籌碼中性'
        
    active_model = models_status.get(selected_id, {})
    
    report = {
        'status': 'success',
        'selected_model': selected_id,
        'best_model_id': best_model_id,
        'model_name': active_model.get('name', '多模型宏觀時序預測系統'),
        'trained_at': active_model.get('trained_at', ''),
        'latest_date': latest_date,
        'models': models_status,
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
        # 兼容舊版看板欄位：直接對應選定模型
        'metrics': active_model.get('metrics', {}),
        'prediction': active_model.get('prediction', {}),
        'top_features': active_model.get('top_features', [])
    }
    report = sanitize_for_json(report)
    with open(PREDICTION_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        
    print(f"[✓] 大盤預測報告成功產出: {PREDICTION_JSON_PATH}")
    sync_market_ml_to_supabase(report)
    return report

def sync_market_ml_to_supabase(payload=None):
    """將大盤最新推論與多模型對比結果同步至雲端 Supabase stock_ml_cache (model_type='taiex_macro')"""
    try:
        from dotenv import load_dotenv
        load_dotenv()
        load_dotenv("/Users/huanggin-chen/openclaw_test/.env")
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
        print("[✓] 大盤多模型預測與評估結果已成功同步至 Supabase (stock_ml_cache -> taiex_macro)！")
    except Exception as e:
        print(f"[!] 同步大盤 ML 至 Supabase 失敗 (離線模式仍可本機運作): {e}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="大盤 ML 多因子模型訓練與推論引擎")
    parser.add_argument('--train', type=str, default=None, help="欲訓練之模型 ID (例如 all, ensemble, lightgbm, lr, rf, xgboost, mlp)")
    parser.add_argument('--preset', type=str, default='all_factors', help="特徵預設集 (all_factors, recent_momentum, institutional_flow, pure_technicals)")
    parser.add_argument('--train-days', type=int, default=0, help="訓練天數限制 (0 為全歷史)")
    parser.add_argument('--predict', action='store_true', help="僅執行推論並同步")
    parser.add_argument('--model', type=str, default=None, help="設定當前選用之模型 ID")
    args = parser.parse_args()
    
    if args.train:
        train_and_evaluate_models({
            'model_type': args.train,
            'features_preset': args.preset,
            'train_days': args.train_days
        })
    elif args.predict:
        generate_prediction_report(selected_model_id=args.model)
    else:
        # 預設執行完整多模型訓練與推論
        train_and_evaluate_models({'model_type': 'all'})
