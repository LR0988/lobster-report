#!/usr/bin/env python3
"""
fix_price_adjustment.py
修正 tw_stock.db 資料中的「休假日/無交易 0 成交量髒數據」導致的還原股價嚴重失真：
- 在 daily_stock 中，春節/連假等無交易日（trade_volume == 0 且 trade_value IS NULL）
  有時會被填入奇怪的歷史價格（例如鴻海 40.57，而前一日是 142.5）
- 真正交易日必須 trade_volume > 0 且 trade_value > 0！
- 排除髒數據後，重新精準計算台股除權息還原價格 Cadj 與 Oadj。
"""
import os, sys, time, pickle, sqlite3
import numpy as np
import pandas as pd

DB = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_cache_clean.pkl')

t0 = time.time()
print("[*] 讀取 tw_stock.db 4 碼個股行情 (過濾 trade_volume == 0 髒數據) ...", flush=True)
conn = sqlite3.connect(DB)

px = pd.read_sql_query("""
    SELECT date, stock_id, opening_price o, highest_price h, lowest_price l,
           closing_price c, trade_value v, change_sign sg, change_price cp, trade_volume vol
    FROM daily_stock
    WHERE date >= '20050101' AND LENGTH(stock_id)=4
      AND stock_id GLOB '[0-9][0-9][0-9][0-9]' AND stock_id NOT LIKE '00%'
      AND (trade_volume > 0 OR trade_value > 0)
""", conn)
px = px.drop_duplicates(['date', 'stock_id'])
print(f"    有效成交數據: {len(px):,} 筆, {px.stock_id.nunique()} 檔 ({time.time()-t0:.1f}s)", flush=True)

tx = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20050101" ORDER BY date', conn).set_index('date')['close']

for col in ('o', 'h', 'l', 'c', 'cp'):
    px[col] = pd.to_numeric(px[col], errors='coerce')
px['v'] = pd.to_numeric(px['v'], errors='coerce')
for col in ('o', 'h', 'l', 'c'):
    px.loc[px[col] <= 0, col] = np.nan

sg = px['sg'].astype(str).str.strip()
a = px['cp'].abs()
px['chg'] = np.where(sg == '-', -a, np.where(sg == '+', a, px['cp']))
px['chg'] = px['chg'].fillna(0.0)
px['ref'] = px['c'] - px['chg']

def P(col):
    return px.pivot(index='date', columns='stock_id', values=col).sort_index()

C0 = P('c')
dates = C0.index
C = C0.ffill(limit=20)
O = P('o').reindex(dates).combine_first(C)
H = P('h').reindex(dates).combine_first(C)
L = P('l').reindex(dates).combine_first(C)
V = P('v').reindex(dates).fillna(0.0)
CHG = P('chg').reindex(dates).fillna(0.0)
REF = P('ref').reindex(dates).fillna(C)
del px

# 嚴格精準除權息還原
raw = C / C.shift(1) - 1.0
# 台股除權息判定：當日漲跌價 CHG 相對除權息參考價 REF 的真實漲跌幅 vs 收盤價直接相除的落差
# 當日有除權息時，C/C.shift(1)-1 會出現巨大跳空，但交易所公告的 CHG / REF 才是真實無權息偏差的漲跌幅！
exdiv = (raw < -0.075) & ((CHG / REF) > raw + 0.05) & (REF > 0)
adj = raw.copy()
adj[exdiv] = (CHG[exdiv] / REF[exdiv]).clip(-0.10, 0.10)
# 排除極端異常跳空 (例如停牌後復牌跳空超過限制者合理截斷)
adj = adj.clip(-0.15, 0.15)

cum = (1.0 + adj.fillna(0.0)).cumprod()
last = C.ffill().iloc[-1].fillna(100.0)
cl = cum.iloc[-1].replace(0, np.nan).fillna(1.0)
Cadj = (cum.div(cl) * last).where(C.notna())
orat = (O / C).fillna(1.0).clip(0.5, 2.0)
Oadj = Cadj * orat

# 檢查鴻海 2317
if '2317' in Cadj.columns:
    print("\n[驗證] 鴻海 2317 2005年價格修復後狀態:")
    sub = Cadj['2317'].loc['20050530':'20050605']
    print(sub)

# 計算各項技術指標
print("\n[*] 計算指標陣列 ...", flush=True)
ma5 = Cadj.rolling(5).mean()
ma10 = Cadj.rolling(10).mean()
ma20 = Cadj.rolling(20).mean()
ma60 = Cadj.rolling(60).mean()
h60 = Cadj.rolling(60).max()
r20 = Cadj.pct_change(20)
r60 = Cadj.pct_change(60)
r120 = Cadj.pct_change(120)
s5 = (ma5 / ma5.shift(5) - 1.0) / 5.0
s20 = (ma20 / ma20.shift(10) - 1.0) / 10.0

ret_d = Cadj.pct_change()
vol20 = ret_d.rolling(20).std()
sharpe = (ret_d.rolling(20).mean() / vol20.replace(0, np.nan)) * np.sqrt(250)

# ATR %
tr1 = H - L
tr2 = (H - C.shift(1)).abs()
tr3 = (L - C.shift(1)).abs()
tr = pd.concat([tr1, tr2, tr3]).groupby(level=0).max()
atr_pct = (tr.rolling(14).mean() / C).clip(0.005, 0.20)

# 籌碼
inst = pd.read_sql_query("""
    SELECT date, stock_id, trust_net, (foreign_net + trust_net + dealer_net) AS inst_net
    FROM institutional_trades WHERE date >= '20050101'
""", conn)
def P_inst(col):
    return inst.pivot(index='date', columns='stock_id', values=col).reindex(dates).fillna(0.0)
trust = P_inst('trust_net')
inst_tot = P_inst('inst_net')
trust20 = trust.rolling(20).sum()
inst20 = inst_tot.rolling(20).sum()

# 大盤指標
tx_series = tx.reindex(dates).ffill()
tx_ma60 = tx_series.rolling(60).mean()
tx_r20 = tx_series.pct_change(20)
tx_r60 = tx_series.pct_change(60)
tx_r120 = tx_series.pct_change(120)

# 市場廣度
mb = pd.read_sql_query('SELECT date, ad_ratio FROM market_breadth WHERE date >= "20050101"', conn).set_index('date')['ad_ratio']
mb_s = mb.reindex(dates).ffill().fillna(0.5)

# 流動性池 (PIT 過去60日成交額前50名)
rt60 = V.rolling(60, min_periods=20).mean()
rank_pit = rt60.rank(axis=1, ascending=False)
pool_pit = (rank_pit <= 50) & (rt60 > 0)

# 快取保存
sids = Cadj.columns.values
clean_data = dict(
    dates=dates.values, sids=sids,
    C=Cadj.values, O=Oadj.values,
    ma5=ma5.values, ma10=ma10.values, ma20=ma20.values, ma60=ma60.values,
    s5=s5.values, s20=s20.values, h60=h60.values,
    r20=r20.values, r60=r60.values, r120=r120.values,
    sharpe=sharpe.values, trust20=trust20.values, inst20=inst20.values,
    atr=atr_pct.values, rt60=rt60.values,
    pool_pit=pool_pit.values,
    tx=tx_series.values, tx_ma60=tx_ma60.values,
    tx_r20=tx_r20.values, tx_r60=tx_r60.values, tx_r120=tx_r120.values,
    breadth=mb_s.values
)

with open(CACHE, 'wb') as f:
    pickle.dump(clean_data, f)
print(f"[✓] 清洗版快取已生成並儲存至 {CACHE} ({time.time()-t0:.1f}s)")
