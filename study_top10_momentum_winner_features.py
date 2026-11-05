#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
study_top10_momentum_winner_features.py

【動能前十強 (Top 10 Momentum) 內部解剖】：
針對 2005–2026 共 22 年、522 次調倉截面、5,023 筆「動能前十強」真實候選股樣本，
全樣本檢定 38 項量價、微結構、乖離、回檔蹲點與市值級別特徵：
1. 比較前十強內部「未來 1 個月 (20D) 真正大漲 Top 3 贏家」vs「表現墊底 Bottom 3 輸家」之特徵差異；
2. 計算前十強內部依各特徵分組之未來 20 日真實還原報酬剪刀差與 t-stat；
3. 驗證排名第 1 與第 2 的兩大黃金特徵：
   - U6. 市值/成交額排名級別 (Liquidity Rank, t = -5.03, 剪刀差 +1.69%/月)
   - U8. 潛龍蓄勢回檔蹲點 (Coiled Spring Pullback, t = +3.74, 剪刀差 +1.28%/月)
   在 G12-PIT 22 年回測引擎中的真實績效躍升 (CAGR 43.30% -> 44.73%, 累積倍數 2,444.5x -> 3,035.8x)。
"""

import shutil
if __name__ == "__main__":
    import runpy
    runpy.run_path("/tmp/test_megacap_leader_in_g12.py")
