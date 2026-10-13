import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

# 讀取數據庫
df_dataset = pd.read_csv('/Users/huanggin-chen/gemini-stock-analysis/momentum_top10_dataset.csv')
feature_cols = [
    'top10_rank', 'mom_score', 'rs_val', 'ret_20', 'ret_60', 'ret_120',
    'high60_prox', 'high20_prox', 'ma60_slope', 'ma20_slope', 'bias_ma20',
    'bias_ma60', 'ma_align', 'sharpe_rs', 'trust_20', 'foreign_20', 'inst_20',
    'trust_ratio_20', 'inst_ratio_20', 'turnover_val', 'vol_ratio_5_20',
    'volatility_20', 'macro_breadth', 'taiex_bias_ma60'
]

# 測試兩種打分模式：
# Mode A: 純 XGBoost 機率
# Mode B: ML-Enhanced Hybrid (40% XGBoost 機率 + 35% 動能 + 25% 法人籌碼)
print("ML 增益複合打分測試準備完成")
