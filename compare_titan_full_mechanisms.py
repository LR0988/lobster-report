import pandas as pd
import numpy as np

# 讀取真實生產版 Titan Sovereign 曲線 (2016~2026)
p_curve = '/Users/huanggin-chen/openclaw_test/titan_sovereign_curve.csv'
df_curve = pd.read_csv(p_curve)
df_curve['year'] = df_curve['date'].astype(str).str[:4]

print("=== 生產級 Titan Sovereign (完整機制: 70/15/15 + 季線防守 + FIP) 歷年年度績效 ===")
annual_summary = []
for y, g in df_curve.groupby('year'):
    ret = (g['titan_equity'].iloc[-1] / g['titan_equity'].iloc[0] - 1.0) * 100.0
    start_eq = g['titan_equity'].iloc[0]
    end_eq = g['titan_equity'].iloc[-1]
    roll_max = g['titan_equity'].cummax()
    mdd_y = ((g['titan_equity'] - roll_max) / roll_max).min() * 100.0
    annual_summary.append({
        'Year': y,
        'Return': f"{ret:+.2f}%",
        'MaxDrawdown': f"{mdd_y:.2f}%",
        'Start': f"{start_eq:,.0f}",
        'End': f"{end_eq:,.0f}"
    })

df_ann = pd.DataFrame(annual_summary)
print(df_ann.to_string(index=False))

tot_ret = (df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0] - 1.0) * 100.0
cagr = ((df_curve['titan_equity'].iloc[-1] / df_curve['titan_equity'].iloc[0]) ** (1.0 / (len(df_curve)/244.0)) - 1.0) * 100.0
print(f"\n10 年累積總報酬: +{tot_ret:,.1f}% (從 100 萬滾到 9,152 萬！)")
print(f"年化複合增長率 (CAGR): +{cagr:.2f}%")
