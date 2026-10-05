import sqlite3
import os
import json
import pandas as pd
import numpy as np

def generate_0020_data():
    print("[*] 正在從 tw_stock.db 計算 0020 台灣前20大等權重指數 10 年曲線...")
    db_path = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
    conn = sqlite3.connect(db_path)

    # 讀取大盤與 0050
    df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" ORDER BY date', conn).set_index('date')
    df_0050 = pd.read_sql_query('SELECT date, closing_price as close FROM daily_stock WHERE stock_id = "0050" AND date >= "20150101" ORDER BY date', conn).set_index('date')

    # 各年份成交金額前 40 大純個股（排除 ETF 代號 00 開頭）
    years = [str(y) for y in range(2015, 2027)]
    top_sids = set()
    for yr in years:
        df_yr = pd.read_sql_query(f'''
            SELECT stock_id
            FROM daily_stock
            WHERE date >= "{yr}0101" AND date <= "{yr}1231"
              AND LENGTH(stock_id) = 4 AND stock_id GLOB '[0-9][0-9][0-9][0-9]'
              AND stock_id NOT LIKE '00%'
            GROUP BY stock_id
            ORDER BY SUM(trade_value) DESC
            LIMIT 40
        ''', conn)
        top_sids.update(df_yr['stock_id'].tolist())

    sids = list(top_sids)
    placeholders = ','.join(['?']*len(sids))
    df_px = pd.read_sql_query(f'''
        SELECT date, stock_id, stock_name, closing_price, trade_value
        FROM daily_stock
        WHERE stock_id IN ({placeholders}) AND date >= "20150101"
    ''', conn, params=sids)
    conn.close()

    name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()

    price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').ffill()
    val_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').fillna(0)

    # 與現有 titan 曲線對齊日期
    df_titan = pd.read_csv('titan_sovereign_curve.csv')
    common_dates = [str(d) for d in df_titan['date']]

    price_pivot = price_pivot.reindex(common_dates).ffill().bfill()
    val_pivot = val_pivot.reindex(common_dates).fillna(0)
    rolling_turnover_60 = val_pivot.rolling(60, min_periods=20).mean()

    # 模擬 0020 等權重 ETF (每檔 5%，每 60 交易日滾動動態換股再平衡，扣 0.585% 換手手續費與證交稅)
    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    latest_holdings = []

    for i, dt in enumerate(common_dates):
        if pending_weights is not None:
            # 扣除換手手續費 (換手比例 * 0.00585)
            churn = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(pending_weights) | set(active_weights))
            portfolio_equity *= (1.0 - churn * 0.00585)
            active_weights = pending_weights
            pending_weights = None

        if i > 0:
            prev_dt = common_dates[i-1]
            daily_ret = sum(w * ((price_pivot.loc[dt, s] / price_pivot.loc[prev_dt, s]) - 1.0) 
                            for s, w in active_weights.items() 
                            if s in price_pivot.columns and price_pivot.loc[prev_dt, s] > 0)
            portfolio_equity *= (1.0 + daily_ret)

        # 每 60 交易日重新按過去 60 日均成交金額選取前 20 大個股
        if i % 60 == 0 or i == len(common_dates) - 1:
            top20 = rolling_turnover_60.loc[dt].dropna().nlargest(20)
            pending_weights = {s: 1.0/20.0 for s in top20.index}
            if i == len(common_dates) - 1:
                latest_holdings = [
                    {
                        'stock_id': s,
                        'stock_name': name_map.get(s, s),
                        'role': '🔷 0020 前20大成分股',
                        'target_weight_pct': 5.0,
                        'entry_date': dt,
                        'current_price': float(price_pivot.loc[dt, s]),
                        'avg_turnover_ntd_亿': round(float(top20.loc[s]) / 1e8, 1) if s in top20.index else 0.0
                    }
                    for s in top20.index
                ]

        equity_curve.append(portfolio_equity)

    s_0020 = pd.Series(equity_curve, index=common_dates)
    total_ret = (s_0020.iloc[-1] / s_0020.iloc[0] - 1.0) * 100.0
    years = len(common_dates) / 242.0
    cagr = (np.power(max(0.01, s_0020.iloc[-1] / s_0020.iloc[0]), 1.0 / years) - 1.0) * 100.0
    peak = s_0020.cummax()
    dd = (s_0020 - peak) / peak * 100.0
    mdd = float(dd.min())
    daily_rets = s_0020.pct_change().fillna(0)
    sharpe = float((daily_rets.mean() * 242.0 - 0.015) / (daily_rets.std() * np.sqrt(242.0) + 1e-9))

    print(f"[✓] 0020 等權重 10年計算完成: 總報酬 {total_ret:+.2f}%, CAGR {cagr:.2f}%, 夏普 {sharpe:.2f}, MDD {mdd:.2f}%")

    # 匯出 etf_0020_curve.csv
    df_0020_curve = pd.DataFrame({
        'date': common_dates,
        'etf0020_equity': [round(x, 2) for x in equity_curve],
        'drawdown_pct': [round(x, 2) for x in dd.values]
    })
    df_0020_curve.to_csv('etf_0020_curve.csv', index=False)
    print(f"[✓] 已匯出 etf_0020_curve.csv (共 {len(df_0020_curve)} 筆)")

    # 更新 titan_sovereign_curve.csv 增添 etf0020_equity
    df_titan['etf0020_equity'] = [round(x, 2) for x in equity_curve]
    df_titan.to_csv('titan_sovereign_curve.csv', index=False)
    print(f"[✓] 已更新 titan_sovereign_curve.csv 包含 etf0020_equity 欄位")

    # 匯出 etf_0020_holdings.json
    holdings_meta = {
        'as_of_date': common_dates[-1],
        'model_id': 'etf_0020',
        'model_name': '🚀 0020 台灣前20大等權重指數 (0020-Equal ETF)',
        'total_return_pct': round(total_ret, 2),
        'cagr_pct': round(cagr, 2),
        'sharpe_ratio': round(sharpe, 2),
        'max_drawdown_pct': round(mdd, 2),
        'cash_reserve_pct': 0.0,
        'market_exposure_pct': 100.0,
        'total_positions_count': len(latest_holdings),
        'open_positions': latest_holdings
    }
    with open('etf_0020_holdings.json', 'w', encoding='utf-8') as f:
        json.dump(holdings_meta, f, ensure_ascii=False, indent=2)
    with open('frontend/src/data/etf_0020_holdings.json', 'w', encoding='utf-8') as f:
        json.dump(holdings_meta, f, ensure_ascii=False, indent=2)
    print(f"[✓] 已更新 frontend/src/data/etf_0020_holdings.json (共 {len(latest_holdings)} 檔成分股)")

if __name__ == '__main__':
    generate_0020_data()
