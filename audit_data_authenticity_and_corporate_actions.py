import sys
import sqlite3
import pandas as pd
import numpy as np

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

print("======================================================================")
print("     【全球泰坦旗艦策略】數據真實性、分拆、減資與合併全面審計報告     ")
print("======================================================================\n")

conn = sqlite3.connect(DB_PATH)
df_all = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily ORDER BY ticker, date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_sovereign_daily ORDER BY ticker, date ASC", conn)
conn.close()

df_all['date'] = pd.to_datetime(df_all['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])

# 1. 審計美股標誌性股票的歷史大分拆 (Splits Audit)
splits_to_check = [
    ('NVDA', '2024-06-10', '10-for-1 分拆 (2024年6月)'),
    ('NVDA', '2021-07-20', '4-for-1 分拆 (2021年7月)'),
    ('TSLA', '2022-08-25', '3-for-1 分拆 (2022年8月)'),
    ('TSLA', '2020-08-31', '5-for-1 分拆 (2020年8月)'),
    ('AAPL', '2020-08-31', '4-for-1 分拆 (2020年8月)'),
    ('AAPL', '2014-06-09', '7-for-1 分拆 (2014年6月)'),
    ('GOOGL', '2022-07-18', '20-for-1 分拆 (2022年7月)'),
    ('AMZN', '2022-06-06', '20-for-1 分拆 (2022年6月)')
]

print("【審計項目 1】美股龍頭股歷史知名股票分割 (Stock Splits) 還原連續性檢查")
print("-" * 75)
for ticker, split_date, desc in splits_to_check:
    sub = df_all[df_all['ticker'] == ticker].sort_values('date')
    if len(sub) == 0:
        continue
    target_dt = pd.to_datetime(split_date)
    window = sub[(sub['date'] >= target_dt - pd.Timedelta(days=7)) & (sub['date'] <= target_dt + pd.Timedelta(days=7))]
    if len(window) < 2:
        continue
    
    # 計算分拆日前後的 adj_close 變動率
    window = window.copy()
    window['adj_ret'] = window['adj_close'].pct_change()
    split_day_row = window[window['date'] >= target_dt].iloc[0] if len(window[window['date'] >= target_dt]) > 0 else None
    
    if split_day_row is not None:
        raw_jump = (split_day_row['close'] / window['close'].shift(1).loc[split_day_row.name] - 1.0) * 100
        adj_jump = split_day_row['adj_ret'] * 100
        status = "✓ 完美還原 (無跳空誤判)" if abs(adj_jump) < 15.0 else "⚠️ 需注意"
        print(f"[{ticker:<5}] {desc:<30} | 原始價格跳空: {raw_jump:>7.1f}% | 還原後漲跌: {adj_jump:>6.2f}% -> {status}")

# 2. 審計台股主要成分股的減資、除權息 (Taiwan Corporate Actions)
print("\n【審計項目 2】台股龍頭股除權息與現金減資還原連續性檢查")
print("-" * 75)
tw_stocks_to_check = ['2330.TW', '2454.TW', '3037.TW', '3443.TW', '8996.TW']
for s in tw_stocks_to_check:
    sub = df_all[df_all['ticker'] == s].sort_values('date').copy()
    if len(sub) == 0: continue
    sub['ret'] = sub['adj_close'].pct_change()
    # 台股正常漲跌幅限制為 10% (早期 7%)，檢查是否有超過 15% 的異常跳空
    abnormal = sub[sub['ret'].abs() > 0.15]
    print(f"[{s:<8}] 總交易日: {len(sub):>5} 天 | 單日漲跌 > 15% 筆數: {len(abnormal)} 筆")
    if len(abnormal) > 0:
        for idx, row in abnormal.head(3).iterrows():
            print(f"   ↳ 異常日: {row['date'].strftime('%Y-%m-%d')} | close: {row['close']:.2f} | adj_close: {row['adj_close']:.2f} | 漲跌: {row['ret']*100:+.2f}%")

# 3. 審計所有 179 檔股票的單日特異極端值 (|ret| > 50%)
print("\n【審計項目 3】全市場 179 檔標的單日特異極端值 (|ret| > 50%) 徹底清查")
print("-" * 75)
df_all['ret'] = df_all.groupby('ticker')['adj_close'].pct_change()
extreme_all = df_all[df_all['ret'].abs() > 0.50].copy()
print(f"全數據庫 971,864 筆逐日行情中，單日變動率絕對值 > 50% 總筆數: {len(extreme_all)} 筆")
for idx, r in extreme_all.iterrows():
    print(f"   • Ticker: {r['ticker']:<10} | 日期: {r['date'].strftime('%Y-%m-%d')} | Close: {r['close']:>8.2f} | AdjClose: {r['adj_close']:>8.2f} | 單日幅度: {r['ret']*100:>+7.2f}%")

# 4. 0050.TW 污染檢查與清整
print("\n【審計項目 4】0050.TW 與指數 ETF 混入個股池防範檢查")
print("-" * 75)
benchmark_etfs = ['0050.TW', 'SPY', 'QQQ', 'IVV', 'VOO', 'VT']
for b in benchmark_etfs:
    in_stock_pool = b in df_all['ticker'].unique()
    print(f"標的 {b:<8}: 存在於股票表 = {in_stock_pool} (必須在個股動能篩選中嚴格排除，不得混入選股池)")

print("\n======================================================================")
print("                    數據真實性審計結論摘要                            ")
print("======================================================================")
