import json
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

# 讀取剛剛生成的強動能資料庫
df = pd.read_csv('/Users/huanggin-chen/gemini-stock-analysis/momentum_top10_dataset.csv')

feature_cols = [
    'top10_rank', 'mom_score', 'rs_val', 'ret_20', 'ret_60', 'ret_120',
    'high60_prox', 'high20_prox', 'ma60_slope', 'ma20_slope', 'bias_ma20',
    'bias_ma60', 'ma_align', 'sharpe_rs', 'trust_20', 'foreign_20', 'inst_20',
    'trust_ratio_20', 'inst_ratio_20', 'turnover_val', 'vol_ratio_5_20',
    'volatility_20', 'macro_breadth', 'taiex_bias_ma60'
]

feature_names_tw = {
    'top10_rank': 'Top10 動能名次',
    'mom_score': '綜合動能評分',
    'rs_val': '加權 RS 相對強弱',
    'ret_20': '近 20 日報酬率',
    'ret_60': '近 60 日報酬率',
    'ret_120': '近 120 日報酬率',
    'high60_prox': '60日創高緊鄰度',
    'high20_prox': '20日創高緊鄰度',
    'ma60_slope': '60MA 季線斜率',
    'ma20_slope': '20MA 月線斜率',
    'bias_ma20': '月線乖離率',
    'bias_ma60': '季線乖離率',
    'ma_align': '多頭排列發散 (5>10>20>60)',
    'sharpe_rs': 'Sharpe-RS 動能平滑度',
    'trust_20': '投信 20 日累計淨買超',
    'foreign_20': '外資 20 日累計淨買超',
    'inst_20': '三大法人 20 日合計淨買超',
    'trust_ratio_20': '投信買超佔成交額比例',
    'inst_ratio_20': '法人買超佔成交額比例',
    'turnover_val': '成交額規模',
    'vol_ratio_5_20': '5日均量 / 20日均量',
    'volatility_20': '個股 20 日波動率',
    'macro_breadth': '市場多頭廣度',
    'taiex_bias_ma60': '大盤加權距季線乖離'
}

X = df[feature_cols].replace([np.inf, -np.inf], np.nan).fillna(0)
y = df['target_win'].values

clf = xgb.XGBClassifier(
    n_estimators=100,
    learning_rate=0.03,
    max_depth=4,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    eval_metric='logloss'
)
clf.fit(X, y)

importances = clf.feature_importances_
df_imp = pd.DataFrame({
    'Feature': feature_cols,
    'Name': [feature_names_tw[f] for f in feature_cols],
    'Importance': importances
}).sort_values(by='Importance', ascending=False).reset_index(drop=True)

print("=== XGBoost 特徵重要性排名 (Top 12 關鍵因子) ===")
print(df_imp.head(12).to_string(index=False, formatters={'Importance': '{:.4f}'.format}))

df_imp.to_csv('/Users/huanggin-chen/gemini-stock-analysis/xgb_feature_importance.csv', index=False)
