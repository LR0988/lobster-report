import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

# 載入數據
conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
sov_df = pd.read_sql_query("SELECT ticker, date, adj_close FROM global_sovereign_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
sov_df['date'] = pd.to_datetime(sov_df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()
sov_adj = sov_df.pivot(index='date', columns='ticker', values='adj_close').sort_index()

common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()
sov_adj = sov_adj.reindex(common_dates).ffill()

stock_tickers = [t for t in px_adj.columns if t not in ['SPY', 'QQQ', '0050.TW']]

ma60 = px_adj.rolling(60).mean()
ma60_slope5 = (ma60 - ma60.shift(5)) / ma60.shift(5)

mom1m = px_adj.pct_change(21)
mom3m = px_adj.pct_change(63)
mom6m = px_adj.pct_change(126)
mom12m = px_adj.pct_change(252)

spy_adj = px_adj['SPY']
spy_ma200 = spy_adj.rolling(200).mean()
spy_open = px_open['SPY']
sov_ma200 = sov_adj.rolling(200).mean()

# 全球主權 ETF 宏觀寬幅 (15 國核心主權指數)
candidate_etfs = ['QQQ', 'SPY', 'EWJ', 'EWG', 'EWU', 'EWC', 'EWA', 'EWL', 'EWN', 'EWD', 'EWT', 'EWY', 'EWZ', 'EWW', 'EWH']
etfs_in_data = [e for e in candidate_etfs if e in sov_adj.columns]
etf_above_200 = (sov_adj[etfs_in_data] > sov_ma200[etfs_in_data]).astype(int)
global_breadth = etf_above_200.mean(axis=1)

month_ends = px_adj.groupby([px_adj.index.year, px_adj.index.month]).apply(lambda x: x.index[-1]).values
month_ends = [pd.to_datetime(d) for d in month_ends if pd.to_datetime(d) >= pd.to_datetime('2004-01-01')]

periods = []
for i in range(len(month_ends) - 1):
    t_date = month_ends[i]
    fut = px_adj.index[px_adj.index > t_date]
    if len(fut) == 0: break
    t_in = fut[0]
    next_m = month_ends[i+1]
    fut_next = px_adj.index[px_adj.index > next_m]
    if len(fut_next) == 0: break
    t_out = fut_next[0]
    periods.append((t_date, t_in, t_out))

# FIP 漸進式動能 (Frog in the Pan, Da et al. 2014 Journal of Finance)
px_daily_ret = px_adj.pct_change()
pos_days = (px_daily_ret > 0).rolling(252).sum()
neg_days = (px_daily_ret < 0).rolling(252).sum()
fip_mat = (pos_days - neg_days) / (pos_days + neg_days + 1e-9)

# 旗艦冠軍配置: Top 3 (40%, 30%, 30%) + 多尺度動能 + FIP漸進加乘 + 全球主權寬幅階梯避險
weights = [0.40, 0.30, 0.30]
mom_scheme_a = (0.40 * mom12m + 0.30 * mom6m + 0.20 * mom3m + 0.10 * mom1m) * (1.0 + 0.5 * fip_mat)
mom_mat = mom_scheme_a[stock_tickers]

STOCK_NAME_MAP = {
    'MRNA': '莫德納 (Moderna)',
    '3037.TW': '欣興 (Unimicron ABF載板)',
    '3443.TW': '創意 (Global Unichip ASIC)',
    'MU': '美光科技 (Micron 記憶體巨頭)',
    '2454.TW': '聯發科 (MediaTek 晶片霸主)',
    'ASX': '日月光投控 (ASE 封測龍頭ADR)',
    '3008.TW': '大立光 (Largan 光學鏡頭)',
    'UMC': '聯電 (UMC 晶圓代工ADR)',
    'ILMN': '因美納 (Illumina 基因定序)',
    '8996.TW': '高力 (Kaori 水冷散熱飆股)',
    '2330.TW': '台積電 (TSMC 神山)',
    'TSM': '台積電 ADR (TSMC)',
    'NVDA': '輝達 (NVIDIA AI算力)',
    'AVGO': '博通 (Broadcom 網通霸主)',
    'TSLA': '特斯拉 (Tesla 自動駕駛)',
    'AAPL': '蘋果 (Apple)',
    'MSFT': '微軟 (Microsoft)',
    'AMZN': '亞馬遜 (Amazon)',
    'GOOGL': '谷歌 (Alphabet)',
    'META': 'Meta (臉書)',
    'AMD': '超微半導體 (AMD)',
    'SMCI': '美超微 (Supermicro)',
    'LRCX': '科林研發 (半導體設備)',
    'AMAT': '應用材料 (設備巨頭)',
    'QCOM': '高通 (Qualcomm 晶片)',
    'PANW': '派拓網路 (資安龍頭)',
    'CRWD': 'CrowdStrike (終端資安)',
    '2603.TW': '長榮海運 (貨櫃航運龍頭)',
    '2609.TW': '陽明海運 (貨櫃航運)',
    '3017.TW': '奇鋐 (AI 水冷散熱龍頭)',
    '6669.TW': '緯穎 (AI 伺服器巨頭)',
    '2382.TW': '廣達 (AI 伺服器代工)',
    '3231.TW': '緯創 (AI 代工伺服器)',
    '2317.TW': '鴻海 (電子代工巨擘)',
    '2308.TW': '台達電 (綠能電源龍頭)',
    '3661.TW': '世芯-KY (AI ASIC 矽智財)'
}

role_names = ['👑 第1主力 (40%)', '🥈 第2主力 (30%)', '🥉 第3主力 (30%)']

all_trades = []
capital = 1000000.0
spy_capital = 1000000.0
curve_records = []
friction = 0.0015

for p_idx, (t_date, t_in, t_out) in enumerate(periods):
    # 全球主權寬幅階梯曝險
    br = global_breadth.loc[t_date] if t_date in global_breadth.index else 0.5
    if br >= 0.60:
        exposure = 1.0
        exit_reason = "月末動能輪動調倉"
    elif br >= 0.40:
        exposure = 0.70
        exit_reason = "🛡️ 主權寬幅分化預警 (70% 倉位)"
    else:
        exposure = 0.0
        exit_reason = "🛡️ 全球系統性空頭 (100% 現金避險)"

    m_scores = mom_mat.loc[t_date].dropna()
    m_scores = m_scores[m_scores > 0]
    p_cur = px_adj.loc[t_date, m_scores.index]
    m60_cur = ma60.loc[t_date, m_scores.index]
    s5_cur = ma60_slope5.loc[t_date, m_scores.index]
    valid = (p_cur > m60_cur) & (s5_cur > 0)
    cands = m_scores[valid].sort_values(ascending=False).index.tolist()

    selected = cands[:3]

    # SPY return
    s_in = spy_open.loc[t_in]
    s_out = spy_open.loc[t_out]
    r_spy = (s_out / s_in - 1.0) if pd.notna(s_in) and s_in > 0 else 0.0
    spy_capital *= (1.0 + r_spy)

    period_ret = 0.0
    holding_days = len(px_adj.loc[t_in:t_out])

    if len(selected) > 0 and exposure > 0:
        w_sub = weights[:len(selected)]
        w_norm = [w / sum(w_sub) * exposure for w in w_sub]
        for idx, (sym, w) in enumerate(zip(selected, w_norm)):
            p_buy = float(px_open.loc[t_in, sym])
            p_sell = float(px_open.loc[t_out, sym])
            raw_ret = (p_sell / p_buy - 1.0) if p_buy > 0 else 0.0
            net_ret = raw_ret - friction
            period_ret += w * net_ret

            sname = STOCK_NAME_MAP.get(sym, sym)
            all_trades.append({
                'stock_id': sym,
                'stock_name': sname,
                'role': role_names[idx] if idx < 3 else f'主力配置 ({int(w*100)}%)',
                'entry_date': t_in.strftime('%Y%m%d'),
                'exit_date': t_out.strftime('%Y%m%d'),
                'entry_price': round(p_buy, 2),
                'exit_price': round(p_sell, 2),
                'return_pct': round(net_ret * 100.0, 2),
                'holding_days': holding_days,
                'exit_reason': exit_reason,
                'leader': (idx == 0)
            })

    capital *= (1.0 + period_ret)

    top1_sym = selected[0] if len(selected) > 0 else 'CASH'
    top1_name = STOCK_NAME_MAP.get(top1_sym, top1_sym)
    curve_records.append({
        'date': t_out.strftime('%Y%m%d'),
        'year': t_out.year,
        'strategy_equity': round(capital, 2),
        'titan_equity': round(capital, 2),
        'benchmark_equity': round(spy_capital, 2),
        'exposure': exposure,
        'market_exposure_pct': round(exposure * 100.0, 1),
        'cash_reserve_pct': round((1.0 - exposure) * 100.0, 1),
        'leader_sid': top1_sym,
        'leader_name': top1_name
    })

# 存檔
with open("frontend/src/data/global_titan_trades.json", "w", encoding="utf-8") as f:
    json.dump(all_trades, f, ensure_ascii=False, indent=2)

with open("frontend/src/data/global_titan_curve.json", "w", encoding="utf-8") as f:
    json.dump(curve_records, f, ensure_ascii=False, indent=2)

print(f"[✓] 成功產出 Top 3 冠軍 global_titan_trades.json (共 {len(all_trades)} 筆交易)")
print(f"[✓] 成功產出 Top 3 冠軍 global_titan_curve.json (共 {len(curve_records)} 期淨值紀錄)")
print("期末淨值:", curve_records[-1]['strategy_equity'], "倍數:", round(curve_records[-1]['strategy_equity']/1000000.0, 2))
