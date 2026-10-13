import pandas as pd
import numpy as np
from test_multi_horizon_momentum import (
    mom1w, mom2w, mom1m, mom2m, mom3m, mom6m, mom9m, mom12m, mom12_1, fip_mat, evaluate_dual_tranche
)

# 探索三頻段與四頻段的最佳黃金融合比例
grid = [
    # (12m, 6m, 3m, 1m)
    (0.40, 0.20, 0.25, 0.15, "融合A: 40% 12m + 20% 6m + 25% 3m + 15% 1m"),
    (0.45, 0.15, 0.25, 0.15, "融合B: 45% 12m + 15% 6m + 25% 3m + 15% 1m"),
    (0.50, 0.10, 0.25, 0.15, "融合C: 50% 12m + 10% 6m + 25% 3m + 15% 1m"),
    (0.45, 0.00, 0.35, 0.20, "融合D: 45% 12m + 35% 3m + 20% 1m"),
    (0.50, 0.00, 0.30, 0.20, "基準: 50% 12m + 30% 3m + 20% 1m"),
    (0.55, 0.00, 0.30, 0.15, "融合E: 55% 12m + 30% 3m + 15% 1m"),
]

res_list = []
for w12, w6, w3, w1, label in grid:
    score = (w12 * mom12m + w6 * mom6m + w3 * mom3m + w1 * mom1m) * (1.0 + 0.5 * fip_mat)
    res = evaluate_dual_tranche(score, name=label)
    res_list.append(res)
    print(f"{label:<45} | CAGR {res['cagr']:5.2f}% | MDD {res['mdd']:6.2f}% | Calmar {res['calmar']:5.3f} | Sharpe {res['sharpe']:4.2f}")

pd.DataFrame(res_list).to_csv("fine_ensemble_results.csv", index=False)
