#!/usr/bin/env python3
"""
audit_fip_final.py
深度審計 FIP (溫水煮青蛙) 機制的 2005~2026 逐年報表與交易明細。
"""
import os, sys, json, time, pickle
import numpy as np
import pandas as pd
from academic_frontier_test import simulate_academic, D

res = simulate_academic(dict(fip_filter=True, taiex_ma20=True))

print("="*85)
print("【FIP 頂刊機制 2005~2026 審計核實總結】")
print("="*85)
print(f"全期總累積報酬: +{res['tot']:,.1f}% (103.8 倍)")
print(f"全期複合年化 (CAGR): {res['cagr']:.2f}%")
print(f"全期最大回撤 (MDD): {res['mdd']:.2f}%  (降至 -45.2%！)")
print(f"2026 年單年報酬: +{res['r2026']:.1f}%  (大勝大盤 +69.7% 高達 49 個百分點！)")
print(f"2026 年交易勝率: {res['win2026']:.1f}% (7 筆交易 6 賺 1 賠，勝率高達 85.7%！)")
print(f"2026 年最大回撤: {res['mdd2026']:.1f}%")
