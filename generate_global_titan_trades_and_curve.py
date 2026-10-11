import os
import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime

DB_PATH = "/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db"

conn = sqlite3.connect(DB_PATH)
df = pd.read_sql_query("SELECT ticker, date, open, close, adj_close FROM global_stock_daily ORDER BY date ASC", conn)
conn.close()

df['date'] = pd.to_datetime(df['date'])
valid_tickers = [t for t in df['ticker'].unique() if not any(t.endswith(ext) for ext in ['.KS', '.T', '.DE', '.SA'])]
df = df[df['ticker'].isin(valid_tickers)]

px_adj = df.pivot(index='date', columns='ticker', values='adj_close').sort_index()
px_open = df.pivot(index='date', columns='ticker', values='open').sort_index()
common_dates = px_adj.index[px_adj.index >= '2003-01-01']
px_adj = px_adj.reindex(common_dates).ffill()
px_open = px_open.reindex(common_dates).ffill()

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

weights = [0.40, 0.25, 0.20, 0.15]
mom_scheme_a = 0.40 * mom12m + 0.30 * mom6m + 0.20 * mom3m + 0.10 * mom1m
mom_mat = mom_scheme_a[stock_tickers]

STOCK_NAME_MAP = {
    'MRNA': '莫德納 (Moderna)',
    '3037.TW': '欣興 (ABF載板龍頭)',
    '3443.TW': '創意 (ASIC設計服務)',
    'MU': '美光科技 (Micron記憶體)',
    '2454.TW': '聯發科 (晶片設計霸主)',
    'ASX': '日月光投控 ADR',
    '3008.TW': '大立光 (光學鏡頭霸主)',
    'UMC': '聯電 ADR',
    'ILMN': '因美納 (基因定序)',
    '8996.TW': '高力 (水冷散熱飆股)',
    '2330.TW': '台積電 (TSMC 神山)',
    'TSM': '台積電 ADR (TSMC)',
    'NVDA': '輝達 (NVIDIA AI算力)',
    'AVGO': '博通 (Broadcom網通)',
    'TSLA': '特斯拉 (Tesla自動駕駛)',
    'AAPL': '蘋果 (Apple)',
    'MSFT': '微軟 (Microsoft)',
    'AMZN': '亞馬遜 (Amazon)',
    'GOOGL': '谷歌 (Alphabet)',
    'META': 'Meta (臉書)',
    'AMD': '超微半導體 (AMD)',
    'SMCI': '美超微 (Supermicro)',
    'LRCX': '科林研發 (半導體設備)',
    'AMAT': '應用材料 (設備巨頭)',
    'QCOM': '高通 (Qualcomm晶片)',
    'PANW': '派拓網路 (資安龍頭)',
    'CRWD': 'CrowdStrike (終端資安)',
    '2603.TW': '長榮海運 (貨櫃航運龍頭)',
    '2609.TW': '陽明海運 (貨櫃航運)',
    '3017.TW': '奇鋐 (AI水冷散熱龍頭)',
    '6669.TW': '緯穎 (AI伺服器巨頭)',
    '2382.TW': '廣達 (AI伺服器代工)',
    '3231.TW': '緯創 (AI代工伺服器)',
    '2317.TW': '鴻海 (電子代工巨擘)',
    '2308.TW': '台達電 (綠能電源龍頭)',
    '3661.TW': '世芯-KY (AI ASIC矽智財)'
}

all_trades = []
capital = 1000000.0
spy_capital = 1000000.0
curve_records = []
friction = 0.0015

role_names = ['👑 第1主力 (40%)', '🥈 第2主力 (25%)', '🥉 第3主力 (20%)', '🏅 第4主力 (15%)']

for p_idx, (t_date, t_in, t_out) in enumerate(periods):
    spy_p = spy_adj.loc[t_date]; spy_m = spy_ma200.loc[t_date]
    exposure = 1.0 if (pd.notna(spy_p) and pd.notna(spy_m) and spy_p >= spy_m) else 0.50

    m_scores = mom_mat.loc[t_date].dropna()
    m_scores = m_scores[m_scores > 0]
    p_cur = px_adj.loc[t_date, m_scores.index]
    m60_cur = ma60.loc[t_date, m_scores.index]
    s5_cur = ma60_slope5.loc[t_date, m_scores.index]
    valid = (p_cur > m60_cur) & (s5_cur > 0)
    cands = m_scores[valid].sort_values(ascending=False).index.tolist()

    selected = cands[:4]

    # SPY return
    s_in = spy_open.loc[t_in]
    s_out = spy_open.loc[t_out]
    r_spy = (s_out / s_in - 1.0) if pd.notna(s_in) and s_in > 0 else 0.0
    spy_capital *= (1.0 + r_spy)

    period_ret = 0.0
    holding_days = len(px_adj.loc[t_in:t_out])

    if len(selected) > 0:
        w_sub = weights[:len(selected)]
        w_norm = [w / sum(w_sub) * exposure for w in w_sub]
        for idx, (sym, w) in enumerate(zip(selected, w_norm)):
            p_buy = float(px_open.loc[t_in, sym])
            p_sell = float(px_open.loc[t_out, sym])
            raw_ret = (p_sell / p_buy - 1.0) if p_buy > 0 else 0.0
            net_ret = raw_ret - friction
            period_ret += w * net_ret

            sname = STOCK_NAME_MAP.get(sym, sym)
            exit_reason = "月末動能輪動調倉" if exposure == 1.0 else "🛡️ 大盤跌破200MA 年線風控減半"

            all_trades.append({
                'stock_id': sym,
                'stock_name': sname,
                'role': role_names[idx] if idx < 4 else f'衛星配置 ({int(w*100)}%)',
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

    # 記錄淨值走勢
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

print(f"[✓] 成功產出 global_titan_trades.json (共 {len(all_trades)} 筆交易)")
print(f"[✓] 成功產出 global_titan_curve.json (共 {len(curve_records)} 期淨值紀錄)")
print("期末淨值:", curve_records[-1]['strategy_equity'], "倍數:", round(curve_records[-1]['strategy_equity']/1000000.0, 2))
