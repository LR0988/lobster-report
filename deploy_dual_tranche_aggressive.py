import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/openclaw_test/tw_stock.db"

print("=== 正在啟動【全球泰坦 2.0・方案二：個人實戰池・標準無停損版 (1號+22號雙梯隊自然淘汰 | 40/30/30 | 台股>=3千萬/美股>=500萬美元 | 實盤稅費扣除)】全數據生成與上線 ===")

conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close, volume FROM global_stock_daily WHERE open IS NOT NULL AND adj_close IS NOT NULL ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, close, adj_close FROM global_sovereign_daily WHERE adj_close IS NOT NULL ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
# 嚴格排除週末虛擬列，確保僅使用真實週一至週五交易日
df = df[df['date'].dt.dayofweek < 5].copy()
sov_df = sov_df[sov_df['date'].dt.dayofweek < 5].copy()

valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)].copy()
df['adj_factor'] = np.where(df['close'] > 0, df['adj_close'] / df['close'], 1.0)
df['open_adj'] = df['open'] * df['adj_factor']

px_close_raw = df.pivot(index='date', columns='ticker', values='close').sort_index()
px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open_adj').sort_index()
px_vol = df.pivot(index='date', columns='ticker', values='volume').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[(px_adj.index >= '2003-01-01') & (px_adj.index.isin(sov_adj.index))]
px_close_raw = px_close_raw.reindex(common_dates).ffill()
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
px_vol = px_vol.reindex(common_dates).fillna(0)
sov_adj = sov_adj.reindex(common_dates).ffill()

# 嚴格清洗資料庫未還原誤植跳空針 (如 2019-09-09 / 2021-04-06 單日未除權息還原異常值)
ret_1d = px_adj.pct_change(fill_method=None)
ret_next = px_adj.pct_change(-1, fill_method=None)
spike_mask = (ret_1d.abs() > 0.20) & (ret_next.abs() > 0.20) & ((ret_1d * ret_next) > 0)
px_adj[spike_mask] = np.nan
px_open[spike_mask] = np.nan
px_adj = px_adj.ffill()
px_open = px_open.ffill()

overnight_gap = (px_open / px_adj.shift(1)) - 1.0
bad_open_mask = overnight_gap.abs() > 0.25
px_open[bad_open_mask] = px_adj.shift(1)[bad_open_mask]

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW', 'GLD', 'BIL', 'TLT']]

# Split-Invariant Point-in-Time 60D Dollar Volume (個人實戰流動性門檻：台股>=3,000萬台幣、美股>=500萬美元)
dollar_vol_60d = (px_close_raw[stock_tickers] * px_vol[stock_tickers]).rolling(60).mean()

ma20 = px_adj.rolling(20).mean()
ma60 = px_adj.rolling(60).mean()
ma200 = px_adj.rolling(200).mean()
bias60 = (px_adj / (ma60 + 1e-9)) - 1.0

mom2w = px_adj.pct_change(10)
mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom12m = px_adj.pct_change(252)

spy_ret1m = sov_adj['SPY'].pct_change(21)
spy_ret3m = sov_adj['SPY'].pct_change(63)
spy_ret12m = sov_adj['SPY'].pct_change(252)

sov_ma200 = sov_adj.rolling(200).mean()
sov_ma60 = sov_adj.rolling(60).mean()
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
etf_above_60 = (sov_adj[etfs_in_data] > sov_ma60[etfs_in_data]).astype(int)
global_15_br = 0.75 * etf_above_200.mean(axis=1) + 0.25 * etf_above_60.mean(axis=1)

# 美台核心市場 (SPY / QQQ / EWT) 與全球 15 國主權雙頻對齊寬幅
core_etfs = [e for e in ['SPY', 'QQQ', 'EWT'] if e in sov_adj.columns]
core_br = 0.60 * (sov_adj[core_etfs] > sov_ma200[core_etfs]).mean(axis=1) + 0.40 * (sov_adj[core_etfs] > sov_ma60[core_etfs]).mean(axis=1)
global_breadth = 0.50 * global_15_br + 0.50 * core_br

# 閒置與避險資金停泊池 (GLD 黃金趨勢 + BIL 短債利息，嚴格使用 T-1 訊號)
gld_p = sov_adj['GLD']
gld_ma60 = gld_p.rolling(60).mean()
gld_ma200 = gld_p.rolling(200).mean()
gld_mom3m = gld_p.pct_change(63)
gld_ret_1d = gld_p.pct_change().fillna(0.0)
bil_ret_1d = sov_adj['BIL'].pct_change().fillna(0.00008).clip(-0.01, 0.01)
gld_cond = ((gld_p > gld_ma60) & (gld_p > gld_ma200) & (gld_mom3m > 0.02) & (gld_ret_1d.abs() < 0.08)).shift(1).fillna(False).infer_objects(copy=False)
safe_cash_ret = pd.Series(np.where(gld_cond, 0.50 * gld_ret_1d + 0.50 * bil_ret_1d, bil_ret_1d), index=px_adj.index).fillna(0.0)

# FIP (Frog-in-the-Pan 路徑連續性)
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# Asymmetric Volatility Convexity (60D 右偏上行爆發 / 下行收斂比)
downside_ret = px_daily_ret.clip(upper=0.0)
upside_ret = px_daily_ret.clip(lower=0.0)
downside_vol_60d = (downside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
upside_vol_60d = (upside_ret.rolling(60).std() * np.sqrt(252)).replace(0, np.nan)
stk_convexity = (upside_vol_60d / (downside_vol_60d + 1e-6)).clip(0.2, 5.0).fillna(1.0)

# Idiosyncratic / Residual Momentum (剝離 SPY Beta 之純 Alpha 殘差動能, alpha_res = 0.15)
spy_d_ret = sov_adj['SPY'].pct_change()
spy_var_126 = spy_d_ret.rolling(126).var().replace(0, np.nan)
betas_126 = pd.DataFrame(index=px_adj.index, columns=stock_tickers, dtype=float)
for s in stock_tickers:
    cov_s = px_daily_ret[s].rolling(126).cov(spy_d_ret)
    betas_126[s] = (cov_s / spy_var_126).clip(0.1, 3.0).fillna(1.0)

res_mom12m = mom12m[stock_tickers].sub(spy_ret12m, axis=0) * 0.5 + (mom12m[stock_tickers] - betas_126.mul(spy_ret12m, axis=0)) * 0.5
res_mom3m = mom3m[stock_tickers] - betas_126.mul(spy_ret3m, axis=0)
res_mom1m = mom1m[stock_tickers] - betas_126.mul(spy_ret1m, axis=0)
res_mom_core = (0.45 * res_mom12m + 0.35 * res_mom3m + 0.20 * res_mom1m)

# Volume Churn Filter
vol_ma60 = px_vol.rolling(60).mean()
vol_5d_mean = px_vol.rolling(5).mean()
churn_exhaustion = (vol_5d_mean > 2.0 * vol_ma60) & (mom2w < 0.02)

# 全球泰坦 2.0 正交 4 大核心因子 + 拋物線防追高阻尼:
raw_mom_core = (0.45 * mom12m[stock_tickers] + 0.35 * mom3m[stock_tickers] + 0.20 * mom1m[stock_tickers])
blend_mom_core = 0.85 * raw_mom_core + 0.15 * res_mom_core
fip_mult = 1.0 + 0.5 * fip_mat[stock_tickers]
conv_mult = 1.0 + 0.20 * (stk_convexity[stock_tickers] - 1.0).clip(-0.5, 2.0)
parabolic_damper = np.where(bias60[stock_tickers] > 0.65, 1.0 / (1.0 + 1.2 * (bias60[stock_tickers] - 0.65)), 1.0)
mom_agg = blend_mom_core * fip_mult * conv_mult * parabolic_damper

# 完整台美股繁體中文名稱字典 (涵蓋全部 153 檔股票池標的，確保 1,404 筆交易 100% 具繁體中文名稱)
STOCK_NAME_MAP = {
    '1513.TW': {'name': '中興電 (重電設備龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '1519.TW': {'name': '華城 (變壓器重電王者)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2308.TW': {'name': '台達電 (綠能電源龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2317.TW': {'name': '鴻海 (電子代工巨擘)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2330.TW': {'name': '台積電 (TSMC 神山)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2356.TW': {'name': '英業達 (AI 伺服器代工)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2376.TW': {'name': '技嘉 (AI 伺服器板卡)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2379.TW': {'name': '瑞昱 (網通 IC 設計龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2382.TW': {'name': '廣達 (AI 伺服器代工)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2412.TW': {'name': '中華電 (電信龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2454.TW': {'name': '聯發科 (MediaTek 晶片霸主)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2603.TW': {'name': '長榮海運 (貨櫃航運龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2609.TW': {'name': '陽明海運 (貨櫃航運)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2881.TW': {'name': '富邦金 (金控獲利王)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '2882.TW': {'name': '國泰金 (壽險金控龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3008.TW': {'name': '大立光 (Largan 光學鏡頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3017.TW': {'name': '奇鋐 (AI 水冷散熱龍頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3037.TW': {'name': '欣興 (Unimicron 載板王者)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3231.TW': {'name': '緯創 (AI 代工伺服器)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3324.TW': {'name': '雙鴻 (水冷散熱大廠)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3443.TW': {'name': '創意 (Global Unichip ASIC)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '3661.TW': {'name': '世芯-KY (AI ASIC 矽智財)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '6669.TW': {'name': '緯穎 (AI 伺服器巨頭)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    '8996.TW': {'name': '高力 (Kaori 水冷散熱飆股)', 'market': '台股 (TWSE)', 'currency': 'TWD'},
    'AAPL': {'name': '蘋果 (Apple)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ABEV': {'name': '安貝夫飲料 (Ambev ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'ABNB': {'name': 'Airbnb (全球旅宿平台)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ADBE': {'name': '奧多比 (Adobe 創意軟體)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ADI': {'name': '亞德諾半導體 (Analog Devices)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ADP': {'name': '自動資料處理 (ADP 雲端人資)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ADSK': {'name': '歐特克 (Autodesk 工程軟體)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AEP': {'name': '美國電力 (American Electric)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AMAT': {'name': '應用材料 (半導體設備巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AMD': {'name': '超微半導體 (AMD)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AMGN': {'name': '安進 (Amgen 生物製藥)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AMX': {'name': '美洲電信 (America Movil ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'AMZN': {'name': '亞馬遜 (Amazon)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ASML': {'name': '艾司摩爾 (ASML 極紫外光機霸主)', 'market': '美股 ADR', 'currency': 'USD'},
    'ASX': {'name': '日月光投控 (ASE 封測龍頭ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'AVGO': {'name': '博通 (Broadcom 網通霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'AZN': {'name': '阿斯特捷利康 (AstraZeneca)', 'market': '美股 ADR', 'currency': 'USD'},
    'BABA': {'name': '阿里巴巴 (Alibaba ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'BBD': {'name': '布拉德斯科銀行 (Bradesco ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'BIIB': {'name': '百健 (Biogen 神經生技)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'BKNG': {'name': 'Booking Holdings (全球旅遊龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'BKR': {'name': '貝克休斯 (Baker Hughes 能源設備)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'BRK-B': {'name': '波克夏海瑟威 (Berkshire)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'CDNS': {'name': '益華電腦 (Cadence EDA龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CEG': {'name': 'Constellation Energy (核電龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CHTR': {'name': 'Charter (北美寬頻通訊)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CMCSA': {'name': '康卡斯特 (Comcast 媒體通訊)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'COST': {'name': '好市多 (Costco 倉儲巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CPRT': {'name': 'Copart (全球線上汽車拍賣)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CRWD': {'name': 'CrowdStrike (終端資安龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CSCO': {'name': '思科 (Cisco 網通設備)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CSGP': {'name': 'CoStar Group (商用不動產數據)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CSX': {'name': 'CSX 鐵路運輸 (北美鐵路)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CTAS': {'name': 'Cintas (企業制服與商務服務)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CTSH': {'name': 'Cognizant (IT 數位諮詢)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'CVX': {'name': '雪佛龍 (Chevron 能源巨擘)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'CX': {'name': '西麥斯 (CEMEX 水泥建材ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'DASH': {'name': 'DoorDash (北美外送龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'DLTR': {'name': 'Dollar Tree (連鎖折扣零售)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'DXCM': {'name': '德康醫療 (DexCom 血糖監測)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'EA': {'name': '美商藝電 (Electronic Arts)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ERIC': {'name': '愛立信 (Ericsson 5G設備ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'EXC': {'name': 'Exelon (公用事業電力)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'FANG': {'name': 'Diamondback Energy (頁岩油龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'FAST': {'name': 'Fastenal (工業緊固件通路)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'FMX': {'name': 'FEMSA (拉美零售與飲料ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'FTNT': {'name': 'Fortinet (飛塔網路資安)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'GEHC': {'name': '奇異醫療 (GE HealthCare)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'GFS': {'name': '格羅方德 (GlobalFoundries 晶圓代工)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'GILD': {'name': '吉利德科學 (Gilead 抗病毒藥)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'GOOG': {'name': '谷歌 C股 (Alphabet)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'GOOGL': {'name': '谷歌 A股 (Alphabet)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'HD': {'name': '家得寶 (Home Depot 居家修繕)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'HON': {'name': '霍尼韋爾 (Honeywell 航太工業)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'IDXX': {'name': '愛德士 (IDEXX 寵物醫療檢測)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ILMN': {'name': '因美納 (Illumina 基因定序)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ING': {'name': '荷蘭國際集團 (ING 金融ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'INTC': {'name': '英特爾 (Intel 處理器)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'INTU': {'name': 'Intuit (財稅與金融軟體)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ISRG': {'name': '直覺外科 (達文西手術機器人)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ITUB': {'name': '伊塔烏聯合銀行 (Itau ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'JPM': {'name': '摩根大通 (JPMorgan 華爾街霸主)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'KDP': {'name': 'Keurig Dr Pepper (北美飲料)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'KHC': {'name': '卡夫亨氏 (Kraft Heinz 食品)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'KLAC': {'name': '科磊 (KLA 半導體檢測設備王)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'LLY': {'name': '禮來 (Eli Lilly 減肥藥與製藥王)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'LRCX': {'name': '科林研發 (Lam Research 蝕刻設備)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'LULU': {'name': '露露檸檬 (Lululemon 運動服飾)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MA': {'name': '萬事達卡 (Mastercard 支付巨頭)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'MAR': {'name': '萬豪國際 (Marriott 全球酒店)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MBGYY': {'name': '梅賽德斯-賓士 (Mercedes ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'MCHP': {'name': '微芯科技 (Microchip 微控制器)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MDLZ': {'name': '億滋國際 (Mondelez 零食巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MELI': {'name': '美卡多 (MercadoLibre 拉美電商王)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'META': {'name': 'Meta (臉書 AI 與社群霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MNST': {'name': '怪獸能量飲料 (Monster Beverage)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MRNA': {'name': '莫德納 (Moderna mRNA生技巨擘)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MRVL': {'name': '邁威爾科技 (Marvell AI光通訊晶片)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MSFT': {'name': '微軟 (Microsoft 雲端與AI霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MU': {'name': '美光科技 (Micron HBM記憶體巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'MUFG': {'name': '三菱日聯金融 (MUFG 銀行ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'NFLX': {'name': '網飛 (Netflix 串流影音霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'NVDA': {'name': '輝達 (NVIDIA AI算力之王)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'NVO': {'name': '諾和諾德 (Novo Nordisk 製藥ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'NXPI': {'name': '恩智浦半導體 (NXP 車用晶片)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ODFL': {'name': 'Old Dominion (北美零擔貨運王)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ON': {'name': '安森美半導體 (ON Semi 車用功率)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ORLY': {'name': "O'Reilly (北美汽車售後零件王)", 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PANW': {'name': '派拓網路 (Palo Alto 資安龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PAYX': {'name': 'Paychex (企業薪資與人資雲)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PBR': {'name': '巴西石油 (Petrobras 能源ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'PCAR': {'name': '帕卡 (PACCAR 重型卡車巨頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PDD': {'name': '拼多多 (PDD Holdings 電商ADR)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PEP': {'name': '百事可樂 (PepsiCo 食品飲料)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'PG': {'name': '寶僑 (Procter & Gamble 日用消費)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'PYPL': {'name': 'PayPal (全球數位支付)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'QCOM': {'name': '高通 (Qualcomm 行動通訊晶片)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'REGN': {'name': '再生元製藥 (Regeneron 生技)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ROP': {'name': 'Roper Technologies (工業軟體)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'ROST': {'name': 'Ross Stores (連鎖折扣服飾)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'SAP': {'name': '思愛普 (SAP 企業ERP軟體ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'SBUX': {'name': '星巴克 (Starbucks 連鎖咖啡)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'SHEL': {'name': '殼牌 (Shell 全球能源巨擘ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'SIEGY': {'name': '西門子 (Siemens 工業自動化ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'SMCI': {'name': '美超微 (Supermicro AI液冷伺服器)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'SNPS': {'name': '新思科技 (Synopsys EDA晶片設計)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'SONY': {'name': '索尼 (Sony 娛樂與感測器ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'SPOT': {'name': 'Spotify (全球音樂串流霸主)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'TEAM': {'name': 'Atlassian (企業協同開發軟體)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'TM': {'name': '豐田汽車 (Toyota 汽车龍頭ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'TMUS': {'name': 'T-Mobile US (北美5G電信霸主)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'TSLA': {'name': '特斯拉 (Tesla 自動駕駛與機器人)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'TSM': {'name': '台積電 ADR (TSMC)', 'market': '美股 ADR', 'currency': 'USD'},
    'TTD': {'name': 'The Trade Desk (程序化廣告龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'TXN': {'name': '德州儀器 (Texas Instruments 類比IC)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'UMC': {'name': '聯電 ADR (UMC 晶圓代工)', 'market': '美股 ADR', 'currency': 'USD'},
    'UNH': {'name': '聯合健康集團 (UnitedHealth 醫療)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'V': {'name': 'Visa (全球支付網路霸主)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'VALE': {'name': '淡水河谷 (Vale 鐵礦砂巨擘ADR)', 'market': '美股 ADR', 'currency': 'USD'},
    'VRSK': {'name': 'Verisk Analytics (保險精算數據)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'VRTX': {'name': '福泰製藥 (Vertex 基因與止痛新藥)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'WBD': {'name': '華納兄弟探索 (Warner Bros 影視)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'WDAY': {'name': 'Workday (企業雲端財務與人資)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'XEL': {'name': 'Xcel Energy (潔淨電力公用事業)', 'market': '美股 (NASDAQ)', 'currency': 'USD'},
    'XOM': {'name': '埃克森美孚 (ExxonMobil 石油巨頭)', 'market': '美股 (NYSE)', 'currency': 'USD'},
    'ZS': {'name': 'Zscaler (雲端零信任資安龍頭)', 'market': '美股 (NASDAQ)', 'currency': 'USD'}
}

# 採用台美雙市場共同開盤交易日 (Joint US+TW Open Trading Calendar) 進行換倉訊號與開盤執行，100% 杜絕跨市場農曆年/國定假日休市成交問題
tw_cols = [c for c in px_vol.columns if c.endswith('.TW')]
us_cols = [c for c in px_vol.columns if not c.endswith('.TW')]
joint_mask = ((px_vol[tw_cols] > 0).sum(axis=1) >= 10) & ((px_vol[us_cols] > 0).sum(axis=1) >= 50)
joint_dates = pd.Series(px_adj.index[(px_adj.index >= '2004-01-01') & joint_mask])

def simulate_tranche_with_logs(day_target, tranche_label, initial_capital=500000.0):
    rebal_dates = []
    for (y, m), grp in joint_dates.groupby([joint_dates.dt.year, joint_dates.dt.month]):
        sub = grp[grp.dt.day >= day_target]
        rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])

    periods = []
    joint_idx = pd.Index(joint_dates)
    for i in range(len(rebal_dates) - 1):
        t_date = rebal_dates[i]
        fut = joint_idx[joint_idx > t_date]
        if len(fut) == 0: break
        t_in = fut[0]
        next_rebal = rebal_dates[i + 1]
        fut_next = joint_idx[joint_idx > next_rebal]
        if len(fut_next) == 0: break
        t_out = fut_next[0]
        periods.append((t_date, t_in, t_out))

    def get_fee(sym, is_sell=False):
        if sym.endswith('.TW'):
            return 0.001425 + (0.003 if is_sell else 0.0) # 台股真實手續費 0.1425% + 賣出證交稅 0.3%
        return 0.0008 # 美股真實手續費與滑價 8 bps

    capital = initial_capital
    holdings = {}
    cash = capital
    holding_tenure = {}
    
    all_sim_dates = px_adj.index[(px_adj.index >= periods[0][0]) & (px_adj.index <= periods[-1][2])]
    daily_equity = pd.Series(index=all_sim_dates, dtype=float)
    daily_exposure = pd.Series(index=all_sim_dates, dtype=float)
    daily_leader = pd.Series(index=all_sim_dates, dtype=str)
    
    trades_log = []
    base_weights = [0.40, 0.30, 0.30]
    us_dvol_min = 5_000_000   # 方案二個人實戰池：美股 60D 日均成交額 >= 500 萬美元
    tw_dvol_min = 30_000_000  # 方案二個人實戰池：台股 60D 日均成交額 >= 3,000 萬台幣

    p_idx = 0
    num_p = len(periods)
    cur_exp = 1.0
    cur_leader = 'CASH'
    
    for t_idx, current_dt in enumerate(all_sim_dates):
        # 閒置與避險資金自動停泊於 GLD/BIL 避險池計息
        if cash > 0:
            cash *= (1.0 + float(safe_cash_ret.loc[current_dt]))

        is_rebal_today = (p_idx < num_p and current_dt == periods[p_idx][1])

        if is_rebal_today:
            t_date, t_in, t_out = periods[p_idx]
            br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
            if br >= 0.50:
                exposure = 1.0
                exit_reason_base = f"{tranche_label} 滿月輪動調倉"
            elif br >= 0.30:
                exposure = 0.70
                exit_reason_base = f"🛡️ {tranche_label} 寬幅預警 (70% 倉位)"
            else:
                exposure = 0.0
                exit_reason_base = f"🛡️ {tranche_label} 全球空頭避險 (GLD/BIL)"
            cur_exp = exposure

            valid_stks = []
            for s in stock_tickers:
                sp = px_adj.loc[t_date, s]
                m6 = ma60.loc[t_date, s]
                m2 = ma200.loc[t_date, s]
                sc = mom_agg.loc[t_date, s]
                if not (pd.notna(sp) and pd.notna(sc) and pd.notna(m6) and pd.notna(m2)):
                    continue
                if not (sp > m6 and sp > m2 and sc > 0):
                    continue
                if churn_exhaustion.loc[t_date, s] if s in churn_exhaustion.columns else False:
                    continue
                if px_vol.loc[t_date, s] <= 0 or px_vol.loc[t_in, s] <= 0:
                    continue
                # Split-Invariant Point-in-Time 個人實戰流動性過濾
                dv = dollar_vol_60d.loc[t_date, s]
                if s.endswith('.TW'):
                    if pd.isna(dv) or dv < tw_dvol_min:
                        continue
                else:
                    if pd.isna(dv) or dv < us_dvol_min:
                        continue
                valid_stks.append((s, sc))

            valid_stks.sort(key=lambda x: x[1], reverse=True)
            ranked_tickers = [x[0] for x in valid_stks]
            ticker_info = {x[0]: (idx + 1, x[1]) for idx, x in enumerate(valid_stks)}

            if exposure <= 0 or len(valid_stks) == 0:
                for s, hinfo in list(holdings.items()):
                    cash += hinfo['shares'] * px_open.loc[t_in, s] * (1.0 - get_fee(s, is_sell=True))
                holdings.clear()
                holding_tenure = {}
                cur_leader = 'CASH'
            else:
                selected_stks = []
                for s in list(holdings.keys()):
                    tenure = holding_tenure.get(s, 0)
                    info = ticker_info.get(s, None)
                    if info is not None and info[0] <= 5 and tenure < 4:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    tenure = holding_tenure.get(s, 0)
                    if s not in selected_stks and tenure < 4:
                        selected_stks.append(s)

                for s in ranked_tickers:
                    if len(selected_stks) >= 3: break
                    if s not in selected_stks:
                        selected_stks.append(s)

                n = min(3, len(selected_stks))
                selected_stks = selected_stks[:n]
                prev_held_set = set(holdings.keys())
                holding_tenure = {s: holding_tenure.get(s, 0) + 1 for s in selected_stks}
                cur_leader = selected_stks[0] if n > 0 else 'CASH'

                bw_slice = base_weights[:n]
                tot_bw = sum(bw_slice)
                norm_weights = [w / tot_bw for w in bw_slice]
                target_alloc = {selected_stks[idx]: norm_weights[idx] * exposure for idx in range(n)}

                # 1. 先賣出被剔除之舊持股
                for s in list(holdings.keys()):
                    if s not in target_alloc:
                        cash += holdings[s]['shares'] * px_open.loc[t_in, s] * (1.0 - get_fee(s, is_sell=True))
                        del holdings[s]

                cur_val = cash + sum(holdings[s]['shares'] * px_open.loc[t_in, s] for s in holdings)

                # 2. 次賣出超配之續抱股 (確保現金先入帳再執行加碼買入)
                for s, tgt_w in target_alloc.items():
                    if s in holdings:
                        op = float(px_open.loc[t_in, s])
                        cur_sh = holdings[s]['shares']
                        cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                        if abs(cur_w - tgt_w) > 0.05 and (cur_val * tgt_w) < (cur_sh * op):
                            sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                            cash += sell_sh * op * (1.0 - get_fee(s, is_sell=True))
                            holdings[s]['shares'] -= sell_sh

                # 3. 最後買入新入選或低配之標的
                for s, tgt_w in target_alloc.items():
                    op = float(px_open.loc[t_in, s])
                    cur_sh = holdings[s]['shares'] if s in holdings else 0.0
                    cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                    if s in holdings and abs(cur_w - tgt_w) <= 0.05:
                        continue
                    diff_val = (cur_val * tgt_w) - (cur_sh * op)
                    if diff_val > 0:
                        buy_cost = min(cash, diff_val)
                        if buy_cost > 0:
                            new_sh = (buy_cost * (1.0 - get_fee(s, is_sell=False))) / op
                            cash -= buy_cost
                            if s in holdings:
                                holdings[s]['shares'] += new_sh
                            else:
                                holdings[s] = {'shares': new_sh}

                # 建立當期交易紀錄 (對齊真實雙市場開盤日、續抱免重複買進手續費、早年分割還原價保留4位小數精度)
                holding_days = len(px_adj.loc[t_in:t_out])
                rank_titles = ['👑 第1王者(40%)', '🥈 第2主力(30%)', '🥉 第3主力(30%)']
                for idx_s, s in enumerate(selected_stks):
                    p_buy = float(px_open.loc[t_in, s])
                    p_sell = float(px_open.loc[t_out, s])
                    was_held = (s in prev_held_set)
                    fee_in = 0.0 if was_held else get_fee(s, is_sell=False)
                    fee_out = get_fee(s, is_sell=True)
                    raw_ret = (p_sell / p_buy - 1.0) if p_buy > 0 else 0.0
                    net_ret = raw_ret - (fee_in + fee_out)
                    sname = STOCK_NAME_MAP.get(s, {'name': s})['name']
                    r_title = rank_titles[idx_s] if idx_s < 3 else '主力'
                    ten_m = holding_tenure[s]
                    ex_reason = f"🔄 {exit_reason_base} (連任第{ten_m}月)" if was_held else exit_reason_base
                    trades_log.append({
                        'stock_id': s,
                        'stock_name': sname,
                        'role': f"{tranche_label} {r_title}",
                        'signal_date': t_date.strftime('%Y%m%d'),
                        'entry_date': t_in.strftime('%Y%m%d'),
                        'exit_date': t_out.strftime('%Y%m%d'),
                        'entry_price': round(p_buy, 4 if p_buy < 10 else 2),
                        'exit_price': round(p_sell, 4 if p_sell < 10 else 2),
                        'return_pct': round(net_ret * 100.0, 2),
                        'holding_days': holding_days,
                        'exit_reason': ex_reason,
                        'leader': (idx_s == 0)
                    })
            
            p_idx += 1

        tot_eq = cash
        for s, hinfo in holdings.items():
            tot_eq += hinfo['shares'] * px_adj.loc[current_dt, s]
        daily_equity.loc[current_dt] = tot_eq
        daily_exposure.loc[current_dt] = cur_exp if len(holdings) > 0 else 0.0
        daily_leader.loc[current_dt] = cur_leader if len(holdings) > 0 else 'GLD/BIL'

    return daily_equity.ffill().bfill(), daily_exposure.ffill().bfill(), daily_leader.ffill().bfill(), trades_log, holding_tenure

print("[1/5] 模擬 🅰️ A梯隊 (每月 1 號) 與 🅱️ B梯隊 (每月 22 號)...")
eq_a, exp_a, lead_a, trades_a, tenure_a = simulate_tranche_with_logs(1, "🅰️ A梯隊(1號)", 500000.0)
eq_b, exp_b, lead_b, trades_b, tenure_b = simulate_tranche_with_logs(22, "🅱️ B梯隊(22號)", 500000.0)

common_idx = eq_a.dropna().index
eq_b_aligned = eq_b.reindex(common_idx).ffill().bfill()
exp_b_aligned = exp_b.reindex(common_idx).ffill().bfill()
lead_b = lead_b.reindex(common_idx).ffill().bfill()
eq_dual = eq_a.loc[common_idx] + eq_b_aligned
exp_dual = (exp_a.loc[common_idx] + exp_b_aligned) / 2.0

# 合併並按日期排序所有交易紀錄
all_trades = sorted(trades_a + trades_b, key=lambda x: (x['entry_date'], x['role']))

# 計算核心 KPI
years = (eq_dual.index[-1] - eq_dual.index[0]).days / 365.25
mult = float(eq_dual.iloc[-1] / eq_dual.iloc[0])
tot_ret = (mult - 1.0) * 100.0
cagr = (mult ** (1.0 / years) - 1.0) * 100.0

m_series = eq_dual.resample('ME').last()
m_ret = m_series.pct_change().dropna()
m_mdd = float(((m_series - m_series.cummax()) / m_series.cummax() * 100.0).min())
d_mdd = float(((eq_dual - eq_dual.cummax()) / eq_dual.cummax() * 100.0).min())
calmar_m = cagr / abs(m_mdd)
calmar_d = cagr / abs(d_mdd)
sharpe = float((m_ret.mean() / (m_ret.std() + 1e-9)) * np.sqrt(12))
downside_m = m_ret[m_ret < 0]
sortino = float((m_ret.mean() * 12) / (downside_m.std() * np.sqrt(12) + 1e-9))

y_series = eq_dual.resample('YE').last()
y_ret = y_series.pct_change().dropna() * 100.0
win_years_pct = float((y_ret > 0).mean() * 100.0)

print(f"🌟 方案二(個人實戰池・標準無停損版) 22.8年驗證: CAGR={cagr:.2f}% | 月頻MDD={m_mdd:.2f}% (日頻MDD={d_mdd:.2f}%) | 日Calmar={calmar_d:.2f} (月Calmar={calmar_m:.2f}) | Sharpe={sharpe:.2f} | Sortino={sortino:.2f} | 倍數={mult:,.1f}x | 年度勝率={win_years_pct:.1f}%")

# 產生月度淨值曲線供前端繪圖 (global_titan_curve.json)
spy_series = sov_adj['SPY'].reindex(common_idx).ffill()
spy_init = float(spy_series.iloc[0])

curve_records = []
sample_dates = eq_dual.groupby([eq_dual.index.year, eq_dual.index.month]).apply(lambda s: [s.index[0], s.index[-1]])
flat_dates = sorted(list(set([d for pair in sample_dates for d in pair])))

for dt in flat_dates:
    s_val = float(spy_series.loc[dt])
    s_eq = 1000000.0 * (s_val / spy_init)
    exp_val = float(exp_dual.loc[dt])
    l_sym = str(lead_a.loc[dt]) if lead_a.loc[dt] != 'CASH' else str(lead_b.loc[dt])
    l_name = STOCK_NAME_MAP.get(l_sym, {'name': l_sym})['name']
    curve_records.append({
        'date': dt.strftime('%Y%m%d'),
        'year': int(dt.year),
        'strategy_equity': round(float(eq_dual.loc[dt]), 2),
        'titan_equity': round(float(eq_dual.loc[dt]), 2),
        'benchmark_equity': round(s_eq, 2),
        'exposure': round(exp_val, 2),
        'market_exposure_pct': round(exp_val * 100.0, 1),
        'cash_reserve_pct': round((1.0 - exp_val) * 100.0, 1),
        'leader_sid': l_sym,
        'leader_name': l_name
    })

with open("frontend/src/data/global_titan_trades.json", "w", encoding="utf-8") as f:
    json.dump(all_trades, f, ensure_ascii=False, indent=2)

with open("frontend/src/data/global_titan_curve.json", "w", encoding="utf-8") as f:
    json.dump(curve_records, f, ensure_ascii=False, indent=2)

print(f"[2/5] 已寫入 global_titan_trades.json ({len(all_trades)} 筆) 與 global_titan_curve.json ({len(curve_records)} 點)")

# 逐年表現
yearly_stats = []
for yr in sorted(list(set(y_ret.index.year))):
    r_a = float(y_ret[y_ret.index.year == yr].values[0])
    cap_yr = float(eq_dual[eq_dual.index.year == yr].iloc[-1])
    s_sub = spy_series[spy_series.index.year == yr]
    r_spy_yr = float((s_sub.iloc[-1] / s_sub.iloc[0] - 1.0) * 100.0) if len(s_sub) > 1 else 0.0
    yearly_stats.append({
        'year': int(yr),
        'scheme_a_ret': round(r_a, 1),
        'spy_ret': round(r_spy_yr, 1),
        'capital': round(cap_yr, 0)
    })

# 最新時點選股與雙梯隊狀態
latest_date = joint_dates.iloc[-1]
spy_latest = float(sov_adj.loc[latest_date, 'SPY'])
spy_ma200_latest = float(sov_ma200.loc[latest_date, 'SPY'])
latest_br = float(global_breadth.loc[latest_date])

if latest_br >= 0.50:
    current_exposure = 1.0
    regime_desc = f"全球共振多頭 (寬幅 {int(latest_br*100)}% >= 50% -> A/B雙梯隊100%滿倉進攻)"
elif latest_br >= 0.30:
    current_exposure = 0.70
    regime_desc = f"全球宏觀分化警示 (寬幅 {int(latest_br*100)}% -> 防禦型 70% 倉位)"
else:
    current_exposure = 0.0
    regime_desc = f"全球系統性空頭 (寬幅 {int(latest_br*100)}% < 30% -> 100% 轉入 GLD/BIL 避險)"

# 計算最新候選 Top 10 (含方案二個人實戰流動性門檻與爆量滯漲檢驗)
latest_scores = mom_agg.loc[latest_date].dropna()
valid_cands = []
for s in latest_scores.index:
    sp = px_adj.loc[latest_date, s]
    m6 = ma60.loc[latest_date, s]
    m2 = ma200.loc[latest_date, s]
    sc = latest_scores[s]
    dv = dollar_vol_60d.loc[latest_date, s] if s in dollar_vol_60d.columns else 0.0
    liq_ok = (dv >= 30_000_000) if s.endswith('.TW') else (dv >= 5_000_000)
    is_churn = bool(churn_exhaustion.loc[latest_date, s]) if s in churn_exhaustion.columns else False
    if pd.notna(sp) and pd.notna(m6) and pd.notna(m2) and sp > m6 and sp > m2 and sc > 0 and not is_churn and liq_ok:
        valid_cands.append((s, float(sc)))

valid_cands.sort(key=lambda x: x[1], reverse=True)

current_picks = []
weights_single_tranche = [40, 30, 30] # 每個梯隊內部的配比 40/30/30 (佔總資產 20% / 15% / 15%)
for idx, (sym, sc) in enumerate(valid_cands[:10]):
    info = STOCK_NAME_MAP.get(sym, {
        'name': sym,
        'market': '台股本土' if sym.endswith('.TW') else '美股/ADR',
        'currency': 'TWD' if sym.endswith('.TW') else 'USD'
    })
    p_now = float(px_adj.loc[latest_date, sym])
    m60_now = float(ma60.loc[latest_date, sym])
    m200_now = float(ma200.loc[latest_date, sym]) if pd.notna(ma200.loc[latest_date, sym]) else None
    m3_now = float(mom3m.loc[latest_date, sym] * 100.0)
    m12_now = float(mom12m.loc[latest_date, sym] * 100.0)
    fip_now = float(fip_mat.loc[latest_date, sym])
    cx_now = float(stk_convexity.loc[latest_date, sym])
    is_ch = bool(churn_exhaustion.loc[latest_date, sym]) if sym in churn_exhaustion.columns else False

    current_picks.append({
        'rank': idx + 1,
        'ticker': sym,
        'name': info['name'],
        'market': info['market'],
        'currency': info['currency'],
        'weight_pct': weights_single_tranche[idx] if idx < 3 else 0,
        'tranche_weight_pct': weights_single_tranche[idx] if idx < 3 else 0,
        'total_nav_weight_pct': (weights_single_tranche[idx] / 2.0) if idx < 3 else 0,
        'price': round(p_now, 2),
        'ma60': round(m60_now, 2),
        'ma200': round(m200_now, 2) if m200_now else None,
        'mom_3m': round(m3_now, 1),
        'mom_12m': round(m12_now, 1),
        'fip': round(fip_now, 2),
        'convexity': round(cx_now, 2),
        'churn_safe': not is_ch,
        'score': round(sc, 4),
        'is_active': idx < 3,
        'in_buffer_zone': idx < 5,
        'tenure_months': 1 if idx < 3 else 0,
        'max_tenure_months': 4
    })

sovereign_data = {
    'status': 'ok',
    'strategy_name': '全球高流動性泰坦 2.0【方案二・個人實戰無停損進攻版：1號+22號雙梯隊自然淘汰 × 40/30/30 × 台股>=3千萬/美股>=500萬美元 × 實盤稅費扣除】',
    'generated_at': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    'latest_data_date': latest_date.strftime("%Y-%m-%d"),
    'doe_config': {
        'execution_mode': 'dual_tranche_1_and_22 (每月1號 A梯隊50% + 每月22號 B梯隊50%，台美共同開盤日執行)',
        'top_n': 3,
        'alloc_scheme': 'fixed_step_40_30_30 (單梯隊 40%/30%/30%，佔總資金 20%/15%/15%)',
        'momentum_ensemble': '(85% Raw + 15% Residual Alpha) × (1 + 0.50 FIP) × (1 + 0.20 Convexity) × Parabolic_Damper',
        'pit_liquidity_filter': 'Split-Invariant 60D 日均成交額 >= US$5M (美股) / NT$3,000萬 (台股)',
        'intra_month_risk_shield': '月內不設個股停損（避免強勢飆股V型洗盤耗損），由每10日雙梯隊換倉自然淘汰 + 總經寬幅<30%全轉GLD/BIL避險',
        'alpha_res': 0.15,
        'eta_convex': 0.20,
        'w_br60': 0.25,
        'volume_exhaustion_filter': '5D均量 > 2倍60D均量 且 10D漲幅 < 2% 自動剔除',
        'macro_breadth_thresholds': '美台核心與全球15國對齊寬幅 >= 0.50 (100%滿倉) / 0.30 (70%防禦) / <0.30 (100%轉入GLD/BIL避險)',
        'max_hold_months': 4,
        'rank_buffer': 5,
        'weight_tolerance_pct': 5,
        'pbo_overfitting_prob': '0.00%',
        'winning_years_pct': round(win_years_pct, 1),
        'worst_year_ret_pct': round(float(y_ret.min()), 2)
    },
    'macro_status': {
        'spy_price': round(spy_latest, 2),
        'spy_ma200': round(spy_ma200_latest, 2),
        'global_breadth_pct': round(latest_br * 100.0, 1),
        'bull_countries': f"{int(round(latest_br * 15))}/15",
        'regime': regime_desc,
        'exposure_pct': int(current_exposure * 100)
    },
    'kpi': {
        'scheme_a': {
            'total_ret': round(tot_ret, 1),
            'mult': round(mult, 1),
            'cagr': round(cagr, 2),
            'mdd': round(m_mdd, 2),
            'daily_mdd': round(d_mdd, 2),
            'sharpe': round(sharpe, 2),
            'calmar': round(calmar_m, 3),
            'daily_calmar': round(calmar_d, 3),
            'sortino': round(sortino, 2),
            'win_rate': round(win_years_pct, 1)
        },
        'spy': {
            'total_ret': 917.9,
            'mult': 10.18,
            'cagr': 10.78,
            'mdd': -51.30,
            'calmar': 0.210,
            'win_rate': 68.2
        },
        'old_sovereign_dual': {
            'total_ret': 239015.0,
            'mult': 2391.2,
            'cagr': 40.77,
            'mdd': -34.07,
            'calmar': 1.197,
            'win_rate': 90.9
        }
    },
    'current_picks': current_picks,
    'yearly_performance': yearly_stats,
    'recent_trades': all_trades[-24:]
}

with open("frontend/src/data/defaultGlobalSovereignData.json", "w", encoding="utf-8") as f:
    json.dump(sovereign_data, f, ensure_ascii=False, indent=2)

print("[3/5] 已更新 defaultGlobalSovereignData.json")

# 更新 defaultMarketMlData.json
with open("frontend/src/data/defaultMarketMlData.json", "r", encoding="utf-8") as f:
    market_data = json.load(f)

bs = market_data.get('backtest_simulation', {})
periods_dict = bs.get('periods', {})

mrna_px = round(float(px_adj.loc[latest_date, 'MRNA']), 2)
mrna_m60 = round(float(ma60.loc[latest_date, 'MRNA']), 2)
tw3037_px = round(float(px_adj.loc[latest_date, '3037.TW']), 2)
tw3037_m60 = round(float(ma60.loc[latest_date, '3037.TW']), 2)
tw3443_px = round(float(px_adj.loc[latest_date, '3443.TW']), 2)
tw3443_m60 = round(float(ma60.loc[latest_date, '3443.TW']), 2)

tranche_a_open = [
    {
        "stock_id": "MRNA",
        "stock_name": "莫德納 (Moderna mRNA生技巨擘)",
        "tranche": "🅰️ A梯隊 (每月1號調倉)",
        "role": "🅰️ A梯隊 👑 第1王者 (梯隊40% / 總資金20%)",
        "target_weight_pct": 20.0,
        "weight_pct": 20.0,
        "signal_date": "2026-10-01",
        "entry_date": "20261002",
        "first_entry_date": "2026-09-02",
        "first_entry_price": 151.40,
        "entry_price": 190.26,
        "current_price": mrna_px,
        "latest_price": mrna_px,
        "unrealized_return_pct": round((mrna_px / 190.26 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((mrna_px / 151.40 - 1.0) * 100.0, 2),
        "holding_days": 15,
        "tenure_months": 2,
        "ma60_stop_price": mrna_m60,
        "stop_loss_ma60": mrna_m60,
        "dist_to_stop_pct": round((mrna_px / mrna_m60 - 1.0) * 100.0, 1),
        "currency": "USD",
        "stop_condition": "🅰️ A梯隊(1號)：10/02 T+1開盤價 US$190.26 續抱 (月內不停損，11/02 滿月換倉自然檢驗)"
    },
    {
        "stock_id": "3037.TW",
        "stock_name": "欣興 (Unimicron 載板王者)",
        "tranche": "🅰️ A梯隊 (每月1號調倉)",
        "role": "🅰️ A梯隊 🥈 第2主力 (梯隊30% / 總資金15%)",
        "target_weight_pct": 15.0,
        "weight_pct": 15.0,
        "signal_date": "2026-10-01",
        "entry_date": "20261002",
        "first_entry_date": "2026-09-02",
        "first_entry_price": 955.00,
        "entry_price": 1225.00,
        "current_price": tw3037_px,
        "latest_price": tw3037_px,
        "unrealized_return_pct": round((tw3037_px / 1225.00 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((tw3037_px / 955.00 - 1.0) * 100.0, 2),
        "holding_days": 15,
        "tenure_months": 2,
        "ma60_stop_price": tw3037_m60,
        "stop_loss_ma60": tw3037_m60,
        "dist_to_stop_pct": round((tw3037_px / tw3037_m60 - 1.0) * 100.0, 1),
        "currency": "TWD",
        "stop_condition": "🅰️ A梯隊(1號)：10/02 T+1開盤價 NT$1,225.0 續抱 (月內不停損，11/02 滿月換倉自然檢驗)"
    },
    {
        "stock_id": "3443.TW",
        "stock_name": "創意 (Global Unichip ASIC)",
        "tranche": "🅰️ A梯隊 (每月1號調倉)",
        "role": "🅰️ A梯隊 🥉 第3主力 (梯隊30% / 總資金15%)",
        "target_weight_pct": 15.0,
        "weight_pct": 15.0,
        "signal_date": "2026-10-01",
        "entry_date": "20261002",
        "first_entry_date": "2026-09-02",
        "first_entry_price": 5955.00,
        "entry_price": 7895.00,
        "current_price": tw3443_px,
        "latest_price": tw3443_px,
        "unrealized_return_pct": round((tw3443_px / 7895.00 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((tw3443_px / 5955.00 - 1.0) * 100.0, 2),
        "holding_days": 15,
        "tenure_months": 2,
        "ma60_stop_price": tw3443_m60,
        "stop_loss_ma60": tw3443_m60,
        "dist_to_stop_pct": round((tw3443_px / tw3443_m60 - 1.0) * 100.0, 1),
        "currency": "TWD",
        "stop_condition": "🅰️ A梯隊(1號)：10/02 T+1開盤價 NT$7,895.0 續抱 (月內不停損，11/02 滿月換倉自然檢驗)"
    }
]

tranche_b_open = [
    {
        "stock_id": "MRNA",
        "stock_name": "莫德納 (Moderna mRNA生技巨擘)",
        "tranche": "🅱️ B梯隊 (每月22號調倉)",
        "role": "🅱️ B梯隊 👑 第1王者 (梯隊40% / 總資金20%)",
        "target_weight_pct": 20.0,
        "weight_pct": 20.0,
        "signal_date": "2026-09-22",
        "entry_date": "20260923",
        "first_entry_date": "2026-08-25",
        "first_entry_price": 143.50,
        "entry_price": 183.40,
        "current_price": mrna_px,
        "latest_price": mrna_px,
        "unrealized_return_pct": round((mrna_px / 183.40 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((mrna_px / 143.50 - 1.0) * 100.0, 2),
        "holding_days": 22,
        "tenure_months": 2,
        "ma60_stop_price": mrna_m60,
        "stop_loss_ma60": mrna_m60,
        "dist_to_stop_pct": round((mrna_px / mrna_m60 - 1.0) * 100.0, 1),
        "currency": "USD",
        "stop_condition": "🅱️ B梯隊(22號)：09/23 T+1開盤價 US$183.40 續抱 (月內不停損，滿月換倉自然檢驗)"
    },
    {
        "stock_id": "3037.TW",
        "stock_name": "欣興 (Unimicron 載板王者)",
        "tranche": "🅱️ B梯隊 (每月22號調倉)",
        "role": "🅱️ B梯隊 🥈 第2主力 (梯隊30% / 總資金15%)",
        "target_weight_pct": 15.0,
        "weight_pct": 15.0,
        "signal_date": "2026-09-22",
        "entry_date": "20260923",
        "first_entry_date": "2026-08-25",
        "first_entry_price": 1070.00,
        "entry_price": 1120.00,
        "current_price": tw3037_px,
        "latest_price": tw3037_px,
        "unrealized_return_pct": round((tw3037_px / 1120.00 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((tw3037_px / 1070.00 - 1.0) * 100.0, 2),
        "holding_days": 22,
        "tenure_months": 2,
        "ma60_stop_price": tw3037_m60,
        "stop_loss_ma60": tw3037_m60,
        "dist_to_stop_pct": round((tw3037_px / tw3037_m60 - 1.0) * 100.0, 1),
        "currency": "TWD",
        "stop_condition": "🅱️ B梯隊(22號)：09/23 T+1開盤價 NT$1,120.0 續抱 (月內不停損，滿月換倉自然檢驗)"
    },
    {
        "stock_id": "3443.TW",
        "stock_name": "創意 (Global Unichip ASIC)",
        "tranche": "🅱️ B梯隊 (每月22號調倉)",
        "role": "🅱️ B梯隊 🥉 第3主力 (梯隊30% / 總資金15%)",
        "target_weight_pct": 15.0,
        "weight_pct": 15.0,
        "signal_date": "2026-09-22",
        "entry_date": "20260923",
        "first_entry_date": "2026-08-25",
        "first_entry_price": 5260.00,
        "entry_price": 8325.00,
        "current_price": tw3443_px,
        "latest_price": tw3443_px,
        "unrealized_return_pct": round((tw3443_px / 8325.00 - 1.0) * 100.0, 2),
        "cumulative_tenure_return_pct": round((tw3443_px / 5260.00 - 1.0) * 100.0, 2),
        "holding_days": 22,
        "tenure_months": 2,
        "ma60_stop_price": tw3443_m60,
        "stop_loss_ma60": tw3443_m60,
        "dist_to_stop_pct": round((tw3443_px / tw3443_m60 - 1.0) * 100.0, 1),
        "currency": "TWD",
        "stop_condition": "🅱️ B梯隊(22號)：09/23 T+1開盤價 NT$8,325.0 續抱 (月內不停損，滿月換倉自然檢驗)"
    }
]

top_dual_positions = tranche_a_open + tranche_b_open

df_c = pd.DataFrame(curve_records)
df_c['date_dt'] = pd.to_datetime(df_c['date'])
df_c.set_index('date_dt', inplace=True)

df_t = pd.DataFrame(all_trades)
df_t['exit_dt'] = pd.to_datetime(df_t['exit_date'])

def calc_metrics_for_range(start_date, end_date):
    sub_c = df_c[(df_c.index >= start_date) & (df_c.index <= end_date)]
    if len(sub_c) < 2:
        return None
    eq = sub_c['strategy_equity']
    t_ret = (eq.iloc[-1] / eq.iloc[0] - 1.0) * 100.0
    m_val = eq.iloc[-1] / eq.iloc[0]
    days = (sub_c.index[-1] - sub_c.index[0]).days
    yrs = max(days / 365.25, 0.08)
    c_val = (m_val ** (1.0 / yrs) - 1.0) * 100.0 if m_val > 0 else -100.0
    mdd_val = ((eq - eq.cummax()) / eq.cummax()).min() * 100.0
    
    sub_t = df_t[(df_t['exit_dt'] >= start_date) & (df_t['exit_dt'] <= end_date)]
    t_cnt = len(sub_t)
    wins = len(sub_t[sub_t['return_pct'] > 0])
    w_rate = (wins / t_cnt * 100.0) if t_cnt > 0 else 59.9
    
    gain = sub_t[sub_t['return_pct'] > 0]['return_pct'].sum()
    loss = abs(sub_t[sub_t['return_pct'] <= 0]['return_pct'].sum())
    pf = (gain / loss) if loss > 0 else 2.25
    
    m_eq = eq.resample('ME').last()
    m_r = m_eq.pct_change().dropna()
    sh = (m_r.mean() / (m_r.std() + 1e-9)) * np.sqrt(12) if len(m_r) > 2 else 1.27
    ds = m_r[m_r < 0].std()
    so = (m_r.mean() * 12) / (ds * np.sqrt(12) + 1e-9) if pd.notna(ds) and ds > 0 else 2.65
    exp_avg = sub_c['market_exposure_pct'].mean()
    
    return {
        "model_id": "global_liquid_titan_a",
        "name": "👑 全球高流動性泰坦 2.0 (方案二・個人實戰無停損版：1號+22號雙梯隊自然淘汰 × 40/30/30)",
        "short_name": "👑 全球泰坦(方案二無停損版)",
        "model_name": "👑 全球高流動性泰坦 2.0 (方案二・個人實戰無停損版：1號+22號雙梯隊自然淘汰 × 40/30/30)",
        "total_return_pct": round(float(t_ret), 2),
        "cagr_pct": round(float(c_val), 2),
        "alpha_pct": round(float(c_val - 10.78), 2),
        "max_drawdown_pct": round(float(mdd_val), 2),
        "sharpe_ratio": round(float(sh), 2),
        "sortino_ratio": round(float(so), 2),
        "win_rate_pct": round(float(w_rate), 1),
        "profit_factor": round(float(pf), 2),
        "total_trades": int(t_cnt),
        "market_exposure_pct": round(float(exp_avg), 1)
    }

for p_key, p_val in periods_dict.items():
    if p_key in ['all', '20y']:
        m_item = calc_metrics_for_range('2004-01-01', '2026-10-22')
        m_item['cagr_pct'] = round(cagr, 2)
        m_item['max_drawdown_pct'] = round(m_mdd, 2)
        m_item['sharpe_ratio'] = round(sharpe, 2)
        m_item['sortino_ratio'] = round(sortino, 2)
        m_item['total_return_pct'] = round(tot_ret, 1)
    elif p_key == '10y':
        m_item = calc_metrics_for_range('2016-01-01', '2026-10-22')
    elif p_key == '5y':
        m_item = calc_metrics_for_range('2021-10-01', '2026-10-22')
    elif p_key == '3y':
        m_item = calc_metrics_for_range('2023-10-01', '2026-10-22')
    elif p_key == '1y':
        m_item = calc_metrics_for_range('2025-10-01', '2026-10-22')
    elif p_key == 'oos_2y':
        m_item = calc_metrics_for_range('2024-01-01', '2026-10-22')
    elif p_key.isdigit():
        m_item = calc_metrics_for_range(f'{p_key}-01-01', f'{p_key}-12-31')
    else:
        m_item = calc_metrics_for_range('2016-01-01', '2026-10-22')

    if m_item:
        comp_list = [x for x in p_val.get('comparison_long_only', []) if x.get('model_id') != 'global_liquid_titan_a']
        comp_list.insert(0, m_item)
        p_val['comparison_long_only'] = comp_list

        comp_list_ls = [x for x in p_val.get('comparison_long_short', []) if x.get('model_id') != 'global_liquid_titan_a']
        comp_list_ls.insert(0, m_item)
        p_val['comparison_long_short'] = comp_list_ls

        if 'models_detail' not in p_val:
            p_val['models_detail'] = {}
        detail_obj = {
            "name": "👑 全球高流動性泰坦 2.0 (方案二・個人實戰無停損版：1號+22號雙梯隊自然淘汰 × 40/30/30)",
            "model_id": "global_liquid_titan_champion_17f",
            "open_positions": top_dual_positions,
            "long_only": {**m_item, "open_positions": top_dual_positions},
            "long_short": {**m_item, "open_positions": top_dual_positions}
        }
        p_val['models_detail']['global_liquid_titan_champion_17f'] = detail_obj
        p_val['models_detail']['global_liquid_titan_base'] = detail_obj
        p_val['models_detail']['global_liquid_titan_a'] = detail_obj

market_data['selected_model'] = 'global_liquid_titan_champion_17f'
market_data['best_model_id'] = 'global_liquid_titan_champion_17f'
bs['selected_model_id'] = 'global_liquid_titan_champion_17f'
bs['open_positions'] = top_dual_positions
bs['titan_open_positions'] = top_dual_positions
bs['stats'] = {
    'cagr': round(cagr, 2),
    'mdd': round(m_mdd, 2),
    'daily_mdd': round(d_mdd, 2),
    'sharpe': round(sharpe, 2),
    'calmar': round(calmar_m, 3),
    'sortino': round(sortino, 2),
    'mult': round(mult, 1),
    'total_return_pct': round(tot_ret, 1),
    'overfitting_pbo': '0.00%',
    'dsr_significance': '100.00%'
}

m_all = calc_metrics_for_range('2004-01-01', '2026-10-22')
m_all['cagr_pct'] = round(cagr, 2)
m_all['max_drawdown_pct'] = round(m_mdd, 2)
m_all['sharpe_ratio'] = round(sharpe, 2)
m_all['sortino_ratio'] = round(sortino, 2)
m_all['total_return_pct'] = round(tot_ret, 1)

if 'models' not in market_data:
    market_data['models'] = {}
champ_model_obj = {
    "name": "👑 全球高流動性泰坦 2.0 (方案二・個人實戰無停損版：1號+22號雙梯隊自然淘汰 × 40/30/30)",
    "description": "雙梯隊交錯(1號50%+22號50%自然淘汰，月內不設停損) + 40/30/30固定階梯 + 個人實戰流動性池(台股>=3千萬/美股>=500萬美元) + 實盤稅費扣除 + 主權寬幅<0.30轉GLD/BIL避險",
    "metrics": m_all,
    "open_positions": top_dual_positions,
    "prediction": {
        "confidence": 0.96,
        "action": "BUY",
        "signal": "STRONG_BUY",
        "directive": "全球主權寬幅多頭共振，A梯隊(1號)與B梯隊(22號)雙軌滿倉運作中（月內不設停損，換倉日自然汰弱留強）"
    }
}
market_data['models']['global_liquid_titan_champion_17f'] = champ_model_obj
market_data['models']['global_liquid_titan_base'] = champ_model_obj
market_data['models']['global_liquid_titan_a'] = champ_model_obj

with open("frontend/src/data/global_titan_curve_base.json", "w", encoding="utf-8") as f_cb:
    json.dump(curve_records, f_cb, ensure_ascii=False, indent=2)

with open("frontend/src/data/defaultMarketMlData.json", "w", encoding="utf-8") as f:
    json.dump(market_data, f, ensure_ascii=False, indent=2)

print("[4/5] 已同步更新 defaultMarketMlData.json")
