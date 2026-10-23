# -*- coding: utf-8 -*-
"""
MSCI 尾盤失衡隔日沖量化引擎 (MSCI Market-On-Close Imbalance Engine)
------------------------------------------------------------------
專門捕捉外資被動指數基金在季調/半年度調整日（2, 5, 8, 11 月底）最後一盤（13:25~13:30）
進行機械式 MOC（Market on Close）非經濟性強制平倉所造成的超跌失衡，
供散戶於 14:00~14:30「盤後定價交易」無滑價接刀，並於 T+1 ~ T+3 均值回歸時獲利了結。
"""

import sqlite3
import pandas as pd
import numpy as np
import datetime
import os
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tw_stock.db")

# 歷年 MSCI 季調/半年度調整在台股之生效交易日 (2016 - 2026)
MSCI_EFFECTIVE_DATES = [
    '20160531', '20160831', '20161130',
    '20170224', '20170531', '20170831', '20171130',
    '20180227', '20180531', '20180831', '20181130',
    '20190227', '20190531', '20190830', '20191129',
    '20200227', '20200529', '20200831', '20201130',
    '20210226', '20210531', '20210831', '20211130',
    '20220225', '20220531', '20220831', '20221130',
    '20230224', '20230531', '20230831', '20231130',
    '20240229', '20240531', '20240830', '20241129',
    '20250227', '20250529', '20250829', '20251128',
    '20260226', '20260529', '20260831', '20261130'
]

TOP_50_TICKERS = [
    '2330', '2317', '2454', '2382', '2308', '2412', '2881', '2882',
    '2303', '2603', '3711', '3231', '2886', '2891', '1216', '2002',
    '2884', '2885', '2357', '2892', '5880', '2880', '2379', '3008',
    '3045', '2887', '2890', '4938', '2912', '2801', '3037', '2345',
    '6505', '1101', '2207', '2327', '2395', '6669', '1301', '1303',
    '2609', '2615', '3661', '3443', '1590', '2376', '2377', '4904',
    '6415', '5871'
]

def get_next_msci_info():
    """計算距離下一次 MSCI 調整生效日的倒數資訊"""
    today_str = datetime.datetime.now().strftime('%Y%m%d')
    future_dates = [d for d in MSCI_EFFECTIVE_DATES if d >= today_str]
    past_dates = [d for d in MSCI_EFFECTIVE_DATES if d < today_str]
    
    next_date = future_dates[0] if future_dates else '20261130'
    last_date = past_dates[-1] if past_dates else '20260831'
    
    t_dt = datetime.datetime.now()
    n_dt = datetime.datetime.strptime(next_date, '%Y%m%d')
    days_left = (n_dt.date() - t_dt.date()).days
    
    # 格式化日期
    next_fmt = f"{next_date[:4]}-{next_date[4:6]}-{next_date[6:]}"
    last_fmt = f"{last_date[:4]}-{last_date[4:6]}-{last_date[6:]}"
    
    return {
        'next_effective_date': next_fmt,
        'next_raw_date': next_date,
        'days_remaining': max(0, days_left),
        'last_effective_date': last_fmt,
        'last_raw_date': last_date,
        'is_rebalance_day_today': (today_str == next_date)
    }

def run_historical_msci_analysis():
    """執行全歷史 MSCI 尾盤失衡真實統計與個股回測明細"""
    conn = sqlite3.connect(DB_PATH)
    
    # 讀取交易日地圖
    all_dates = pd.read_sql_query('SELECT date FROM daily_index ORDER BY date ASC', conn)['date'].tolist()
    date_to_idx = {d: i for i, d in enumerate(all_dates)}
    
    placeholders = ','.join([f"'{s}'" for s in TOP_50_TICKERS])
    
    # 載入台灣 50 股價歷史
    df_hist = pd.read_sql_query(f'''
        SELECT date, stock_id, stock_name, opening_price, highest_price, lowest_price, closing_price, trade_volume 
        FROM daily_stock 
        WHERE stock_id IN ({placeholders}) 
        ORDER BY date ASC
    ''', conn)
    conn.close()
    
    px_close = df_hist.pivot(index='date', columns='stock_id', values='closing_price').ffill()
    px_high = df_hist.pivot(index='date', columns='stock_id', values='highest_price').ffill()
    px_low = df_hist.pivot(index='date', columns='stock_id', values='lowest_price').ffill()
    px_open = df_hist.pivot(index='date', columns='stock_id', values='opening_price').ffill()
    ma60 = px_close.rolling(60).mean()
    
    name_map = df_hist.groupby('stock_id')['stock_name'].last().to_dict()
    
    friction = 0.004 # 現股 0.3% 證交稅 + 0.1% 買賣手續費
    events = []
    
    for msci_d in MSCI_EFFECTIVE_DATES:
        if msci_d not in date_to_idx:
            continue
        i0 = date_to_idx[msci_d]
        if i0 + 3 >= len(all_dates):
            continue
            
        d1 = all_dates[i0 + 1]
        d2 = all_dates[i0 + 2]
        d3 = all_dates[i0 + 3]
        
        for s in TOP_50_TICKERS:
            if s not in px_close.columns:
                continue
            c0 = px_close.loc[msci_d, s]
            o0 = px_open.loc[msci_d, s]
            l0 = px_low.loc[msci_d, s]
            m60_val = ma60.loc[msci_d, s] if msci_d in ma60.index else np.nan
            
            if pd.isna(c0) or c0 <= 0 or pd.isna(o0) or o0 <= 0:
                continue
                
            drop_pct = (c0 - o0) / o0 * 100.0
            dist_to_low = (c0 - l0) / c0 * 100.0
            in_trend = pd.notna(m60_val) and c0 >= 0.95 * m60_val
            
            # 篩選條件：開盤到收盤跌幅 <= -1.5%、收在當日最低點附近 (<=0.2%)、且中長期多頭趨勢良好
            if drop_pct <= -1.5 and dist_to_low <= 0.25 and in_trend:
                h1 = px_high.loc[d1, s]
                o1 = px_open.loc[d1, s]
                c1 = px_close.loc[d1, s]
                
                h2 = max(h1, px_high.loc[d2, s])
                c2 = px_close.loc[d2, s]
                
                h3 = max(h2, px_high.loc[d3, s])
                c3 = px_close.loc[d3, s]
                
                ret_o1 = (o1 / c0 - 1.0) * 100.0
                ret_h1 = (h1 / c0 - 1.0) * 100.0
                ret_c1 = ((c1 / c0) * (1.0 - friction) - 1.0) * 100.0
                ret_h3 = (h3 / c0 - 1.0) * 100.0
                ret_c3 = ((c3 / c0) * (1.0 - friction) - 1.0) * 100.0
                
                # 實戰目標：若 3 天內觸發 +1.2% 達標停利，則以 +1.2% - friction 獲利平倉；未達標則第 3 天收盤市價平倉
                is_tp_hit = (ret_h3 >= 1.2)
                realized_ret = (1.2 - friction * 100.0) if is_tp_hit else ret_c3
                
                d_fmt = f"{msci_d[:4]}-{msci_d[4:6]}-{msci_d[6:]}"
                
                events.append({
                    'msci_date': d_fmt,
                    'stock_id': s,
                    'stock_name': name_map.get(s, s),
                    'entry_price': round(float(c0), 2),
                    'msci_drop_pct': round(float(drop_pct), 2),
                    'next_open_ret': round(float(ret_o1), 2),
                    't1_high_ret': round(float(ret_h1), 2),
                    't3_high_ret': round(float(ret_h3), 2),
                    'is_tp_hit': bool(is_tp_hit),
                    'realized_ret': round(float(realized_ret), 2),
                    'is_win': bool(realized_ret > 0)
                })
                
    df_ev = pd.DataFrame(events)
    if len(df_ev) == 0:
        return {'status': 'empty'}
        
    # 計算整體績效指標
    total_trades = len(df_ev)
    win_trades = (df_ev['realized_ret'] > 0).sum()
    win_rate = float(round(win_trades / total_trades * 100.0, 1))
    t1_flip_green_rate = float(round((df_ev['t1_high_ret'] > 0).mean() * 100.0, 1))
    t3_flip_green_rate = float(round((df_ev['t3_high_ret'] > 0).mean() * 100.0, 1))
    avg_t3_high = float(round(df_ev['t3_high_ret'].mean(), 2))
    avg_realized_ret = float(round(df_ev['realized_ret'].mean(), 2))
    
    win_sum = df_ev[df_ev['realized_ret'] > 0]['realized_ret'].sum()
    loss_sum = abs(df_ev[df_ev['realized_ret'] <= 0]['realized_ret'].sum())
    profit_factor = float(round(win_sum / loss_sum, 2)) if loss_sum > 0 else 99.0
    
    # 依日期由近到遠排序
    df_ev = df_ev.sort_values(by='msci_date', ascending=False)
    recent_trades = df_ev.head(35).to_dict(orient='records')
    
    # 明星代表作 (最賺前 5 筆)
    hall_of_fame = df_ev.sort_values(by='t3_high_ret', ascending=False).head(5).to_dict(orient='records')
    
    return {
        'status': 'ok',
        'metrics': {
            'total_trades': total_trades,
            'win_trades': int(win_trades),
            'loss_trades': int(total_trades - win_trades),
            'win_rate': win_rate,
            't1_flip_green_rate': t1_flip_green_rate,
            't3_flip_green_rate': t3_flip_green_rate,
            'avg_t3_high': avg_t3_high,
            'avg_realized_ret': avg_realized_ret,
            'profit_factor': profit_factor,
            'annual_opportunities': round(total_trades / 10.0, 1)
        },
        'hall_of_fame': hall_of_fame,
        'recent_trades': recent_trades
    }

def get_live_msci_dashboard():
    """提供前端戰情中心的完整資料包"""
    timing_info = get_next_msci_info()
    analysis = run_historical_msci_analysis()
    
    return {
        'status': 'ok',
        'timing': timing_info,
        'analysis': analysis
    }

if __name__ == '__main__':
    data = get_live_msci_dashboard()
    print("MSCI Timing:", data['timing'])
    print("MSCI Metrics:", data['analysis']['metrics'])
