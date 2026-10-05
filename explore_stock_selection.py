import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'

def load_data():
    conn = sqlite3.connect(DB_PATH)
    df_taiex = pd.read_sql_query('''
        SELECT date, close FROM daily_index 
        WHERE date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_0050 = pd.read_sql_query('''
        SELECT date, closing_price as close FROM daily_stock 
        WHERE stock_id = "0050" AND date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_macro = pd.read_sql_query('''
        SELECT date, sox FROM macro_indicators 
        WHERE date >= "20150101" AND date <= "20261002" 
        ORDER BY date
    ''', conn).set_index('date')

    df_macro_overlay = df_taiex.copy()
    df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60).mean()
    df_macro_overlay['sox'] = df_macro['sox'].ffill()
    df_macro_overlay['sox_ma60'] = df_macro_overlay['sox'].rolling(60).mean()
    df_macro_overlay['macro_bull'] = (df_macro_overlay['close'] >= df_macro_overlay['taiex_ma60']) | \
                                     (df_macro_overlay['sox'] >= df_macro_overlay['sox_ma60'])

    years = [str(y) for y in range(2015, 2027)]
    top_stocks = set()
    for yr in years:
        df_yr = pd.read_sql_query(f'''
            SELECT stock_id
            FROM daily_stock
            WHERE date >= "{yr}0101" AND date <= "{yr}1231"
              AND LENGTH(stock_id) = 4 AND stock_id GLOB '[0-9][0-9][0-9][0-9]'
            GROUP BY stock_id
            ORDER BY SUM(trade_value) DESC
            LIMIT 50
        ''', conn)
        top_stocks.update(df_yr['stock_id'].tolist())

    sids = list(top_stocks)
    placeholders = ','.join(['?']*len(sids))

    df_px = pd.read_sql_query(f'''
        SELECT date, stock_id, stock_name, closing_price, trade_value, pe_ratio
        FROM daily_stock
        WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
    ''', conn, params=sids)

    df_inst = pd.read_sql_query(f'''
        SELECT date, stock_id, foreign_net, trust_net
        FROM institutional_trades
        WHERE stock_id IN ({placeholders}) AND date >= "20150101" AND date <= "20261002"
    ''', conn, params=sids)
    conn.close()

    price_pivot = df_px.pivot(index='date', columns='stock_id', values='closing_price').sort_index().ffill()
    value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)
    pe_pivot = df_px.pivot(index='date', columns='stock_id', values='pe_ratio').sort_index().ffill()

    df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
    inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index()
    name_map = df_px.drop_duplicates(subset=['stock_id'])[['stock_id', 'stock_name']].set_index('stock_id')['stock_name'].to_dict()

    all_dates = [d for d in price_pivot.index if d >= '20160104']

    ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
    ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
    ma60_slope5 = (ma60_pivot - ma60_pivot.shift(5)) / ma60_pivot.shift(5)

    ret_20 = price_pivot.pct_change(20, fill_method=None)
    ret_60 = price_pivot.pct_change(60, fill_method=None)
    ret_120 = price_pivot.pct_change(120, fill_method=None)
    ret_250 = price_pivot.pct_change(250, fill_method=None)

    taiex_ret20 = df_taiex['close'].pct_change(20, fill_method=None)
    taiex_ret60 = df_taiex['close'].pct_change(60, fill_method=None)
    taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)

    rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
    rolling_turnover_20 = value_pivot.rolling(20, min_periods=10).mean()
    rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()
    rolling_inst_20 = inst_pivot.rolling(20, min_periods=10).sum()

    return {
        'all_dates': all_dates,
        'df_taiex': df_taiex,
        'df_0050': df_0050,
        'df_macro_overlay': df_macro_overlay,
        'price_pivot': price_pivot,
        'value_pivot': value_pivot,
        'pe_pivot': pe_pivot,
        'ma20_pivot': ma20_pivot,
        'ma60_pivot': ma60_pivot,
        'ma60_slope5': ma60_slope5,
        'ret_20': ret_20,
        'ret_60': ret_60,
        'ret_120': ret_120,
        'ret_250': ret_250,
        'taiex_ret20': taiex_ret20,
        'taiex_ret60': taiex_ret60,
        'taiex_ret120': taiex_ret120,
        'rolling_turnover_60': rolling_turnover_60,
        'rolling_turnover_20': rolling_turnover_20,
        'rolling_inst_60': rolling_inst_60,
        'rolling_inst_20': rolling_inst_20,
        'name_map': name_map
    }

def run_simulation(data, config):
    all_dates = data['all_dates']
    price_pivot = data['price_pivot']
    ma20_pivot = data['ma20_pivot']
    ma60_pivot = data['ma60_pivot']
    ma60_slope5 = data['ma60_slope5']
    ret_20 = data['ret_20']
    ret_60 = data['ret_60']
    ret_120 = data['ret_120']
    ret_250 = data['ret_250']
    taiex_ret20 = data['taiex_ret20']
    taiex_ret60 = data['taiex_ret60']
    taiex_ret120 = data['taiex_ret120']
    rolling_turnover_60 = data['rolling_turnover_60']
    rolling_turnover_20 = data['rolling_turnover_20']
    rolling_inst_60 = data['rolling_inst_60']
    rolling_inst_20 = data['rolling_inst_20']
    pe_pivot = data['pe_pivot']
    df_macro_overlay = data['df_macro_overlay']
    df_taiex = data['df_taiex']

    rebalance_freq = 20
    portfolio_equity = 1000000.0
    equity_curve = []
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585

    all_completed_trades = []
    open_position_tracker = {}

    for i, dt in enumerate(all_dates):
        # 1. 前一日調倉指令生效
        if pending_weights is not None:
            # 結算平倉的股票
            for sid in list(active_weights.keys()):
                if sid not in pending_weights:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        exit_px = price_pivot.loc[dt, sid]
                        entry_px = pos['entry_price']
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'entry_date': pos['entry_date'],
                            'exit_date': dt,
                            'return_pct': ret_pct,
                            'holding_days': max(1, h_days),
                            'exit_reason': '月度輪動'
                        })
                        del open_position_tracker[sid]

            # 記錄新買入的股票
            for sid, w_new in pending_weights.items():
                if sid not in active_weights:
                    open_position_tracker[sid] = {
                        'entry_date': dt,
                        'entry_price': price_pivot.loc[dt, sid],
                        'target_weight': w_new
                    }

            turnover = sum(abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0)) for s in set(list(active_weights.keys()) + list(pending_weights.keys()))) / 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            active_weights = pending_weights
            pending_weights = None

        # 2. 結算日報酬
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = 0.0
            for sid, w in active_weights.items():
                p_now = price_pivot.loc[dt, sid]
                p_prev = price_pivot.loc[prev_dt, sid]
                if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                    daily_ret += w * ((p_now / p_prev) - 1.0)
            portfolio_equity *= (1.0 + daily_ret)

        # 3. 季線防守：收盤跌破 60MA 停損
        if active_weights:
            temp_active = {}
            for sid, w in active_weights.items():
                p = price_pivot.loc[dt, sid]
                ma = ma60_pivot.loc[dt, sid]
                if not pd.isna(p) and not pd.isna(ma) and p < ma:
                    if sid in open_position_tracker:
                        pos = open_position_tracker[sid]
                        exit_px = p
                        entry_px = pos['entry_price']
                        ret_pct = (exit_px / entry_px - 1.0) * 100 if entry_px > 0 else 0.0
                        h_days = all_dates.index(dt) - all_dates.index(pos['entry_date']) if pos['entry_date'] in all_dates else 0
                        all_completed_trades.append({
                            'stock_id': sid,
                            'entry_date': pos['entry_date'],
                            'exit_date': dt,
                            'return_pct': ret_pct,
                            'holding_days': max(1, h_days),
                            'exit_reason': '破60MA停損'
                        })
                        del open_position_tracker[sid]
                else:
                    temp_active[sid] = w
            active_weights = temp_active

        # 4. 定期調倉
        if i % rebalance_freq == 0:
            is_macro_bull = df_macro_overlay.loc[dt, 'macro_bull'] if dt in df_macro_overlay.index else True
            if not is_macro_bull:
                next_targets = {}
            else:
                valid_turnover = rolling_turnover_60.loc[dt].dropna()
                pool_size = config.get('pool_size', 50)
                liquid_pool = valid_turnover.nlargest(pool_size).index

                scores = {}
                for sid in liquid_pool:
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    r20 = ret_20.loc[dt, sid]
                    r60 = ret_60.loc[dt, sid]
                    r120 = ret_120.loc[dt, sid]
                    r250 = ret_250.loc[dt, sid]

                    if pd.isna(p) or pd.isna(ma60) or pd.isna(r120) or pd.isna(r250):
                        continue

                    # 基本要求: 價格 > 60MA
                    if p < ma60:
                        continue

                    # 篩選條件 1: 均線多頭排列
                    if config.get('require_p_gt_ma20', False) and (pd.isna(ma20) or p < ma20):
                        continue
                    if config.get('require_ma20_gt_ma60', False) and (pd.isna(ma20) or ma20 < ma60):
                        continue

                    # 篩選條件 2: 60MA 斜率走揚 (非下彎)
                    if config.get('require_ma60_rising', False):
                        s5 = ma60_slope5.loc[dt, sid] if sid in ma60_slope5.columns else 0
                        if pd.isna(s5) or s5 < 0:
                            continue

                    # 篩選條件 3: 緩衝帶 (防早夭停損) 與 乖離上限 (防追高反轉)
                    min_buffer = config.get('min_ma60_buffer_pct', 0.0) # 例如 2.0%
                    if min_buffer > 0 and p < ma60 * (1.0 + min_buffer / 100.0):
                        continue
                    max_bias = config.get('max_ma60_bias_pct', 999.0)   # 例如 25%
                    if max_bias < 900.0 and p > ma60 * (1.0 + max_bias / 100.0):
                        continue

                    # 篩選條件 4: 近期動能必須為正 (避免高檔頭部崩跌股)
                    if config.get('require_ret20_positive', False):
                        if pd.isna(r20) or r20 < 0:
                            continue
                    if config.get('require_ret20_outperform', False):
                        t20 = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0
                        if pd.isna(r20) or (r20 < t20):
                            continue

                    # 篩選條件 5: 近 20 日法人必須為淨買超
                    if config.get('require_inst20_positive', False):
                        inst20 = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and not pd.isna(rolling_inst_20.loc[dt, sid])) else 0
                        if inst20 <= 0:
                            continue

                    # 計算得分
                    # RS 分數權重
                    rs_mode = config.get('rs_mode', 'classic')
                    t120 = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                    t60 = taiex_ret60.loc[dt] if dt in taiex_ret60.index else 0
                    t20 = taiex_ret20.loc[dt] if dt in taiex_ret20.index else 0

                    if rs_mode == 'classic':
                        rs_score = (r120 - t120) * 0.7 + r250 * 0.3
                    elif rs_mode == 'multi_scale':
                        # 短中長全面動能
                        rs_score = (r20 - t20)*0.20 + (r60 - t60)*0.35 + (r120 - t120)*0.30 + r250*0.15
                    elif rs_mode == 'short_medium':
                        # 聚焦近半年爆發力
                        rs_score = (r20 - t20)*0.30 + (r60 - t60)*0.45 + (r120 - t120)*0.25

                    inst_val = rolling_inst_60.loc[dt, sid] if (sid in rolling_inst_60.columns and not pd.isna(rolling_inst_60.loc[dt, sid])) else 0
                    if config.get('use_inst20', False):
                        inst_val = rolling_inst_20.loc[dt, sid] if (sid in rolling_inst_20.columns and not pd.isna(rolling_inst_20.loc[dt, sid])) else 0

                    pe = pe_pivot.loc[dt, sid] if (sid in pe_pivot.columns and not pd.isna(pe_pivot.loc[dt, sid])) else 20
                    if config.get('pe_mode', 'classic') == 'classic':
                        pe_score = (1.0 / pe) if (0 < pe <= 65) else (-0.05)
                    else:
                        pe_score = 0.0 # 不懲罰高成長股

                    turnover = valid_turnover[sid]

                    scores[sid] = {
                        'rs': rs_score,
                        'inst': inst_val,
                        'pe': pe_score,
                        'turnover': turnover
                    }

                if len(scores) >= 3:
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    sdf['norm_inst'] = sdf['inst'].rank(pct=True)
                    sdf['norm_pe'] = sdf['pe'].rank(pct=True)
                    sdf['norm_size'] = sdf['turnover'].rank(pct=True)

                    w_rs = config.get('w_rs', 0.40)
                    w_inst = config.get('w_inst', 0.25)
                    w_pe = config.get('w_pe', 0.20)
                    w_size = config.get('w_size', 0.15)

                    sdf['titan_score'] = (
                        w_rs * sdf['norm_rs'] +
                        w_inst * sdf['norm_inst'] +
                        w_pe * sdf['norm_pe'] +
                        w_size * sdf['norm_size']
                    )

                    top5_scale = sdf.nlargest(min(5, len(sdf)), 'turnover')
                    sovereign_leader = top5_scale['titan_score'].idxmax()
                    remaining = sdf.drop(index=[sovereign_leader])
                    satellites = remaining.nlargest(min(2, len(remaining)), 'titan_score').index.tolist()

                    next_targets = {sovereign_leader: 0.40}
                    sat_w = 0.30 if len(satellites) == 2 else (0.60 / max(1, len(satellites)))
                    for sat in satellites:
                        next_targets[sat] = sat_w
                elif len(scores) > 0:
                    # 選出的個股少於 3 檔，按 40/30/30 比例配置，剩餘留現金防禦
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    next_targets = {}
                    leader = sdf['norm_rs'].idxmax()
                    next_targets[leader] = 0.40
                    for sat in sdf.drop(index=[leader]).index[:2]:
                        next_targets[sat] = 0.30
                else:
                    next_targets = {}

            pending_weights = next_targets

        equity_curve.append(portfolio_equity)

    # 結算統計指標
    df_res = pd.Series(equity_curve, index=all_dates)
    total_ret = (df_res.iloc[-1] / df_res.iloc[0] - 1.0) * 100.0
    years = (pd.to_datetime(all_dates[-1]) - pd.to_datetime(all_dates[0])).days / 365.25
    cagr = (np.power(max(0.01, df_res.iloc[-1] / df_res.iloc[0]), 1.0 / years) - 1.0) * 100.0
    peak = df_res.cummax()
    mdd = ((df_res - peak) / peak).min() * 100.0
    daily_returns = df_res.pct_change().dropna()
    sharpe = (daily_returns.mean() / (daily_returns.std() + 1e-9)) * np.sqrt(242)

    df_trades = pd.DataFrame(all_completed_trades)
    total_trades = len(df_trades)
    if total_trades > 0:
        wins = df_trades[df_trades['return_pct'] > 0]
        losses = df_trades[df_trades['return_pct'] <= 0]
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / total_trades) * 100.0
        avg_win = wins['return_pct'].mean() if len(wins) > 0 else 0.0
        avg_loss = losses['return_pct'].mean() if len(losses) > 0 else 0.0
        fast_stopouts = len(df_trades[df_trades['holding_days'] <= 10])
        payoff = abs(avg_win / avg_loss) if avg_loss != 0 else 0.0
    else:
        win_rate = 0.0
        win_count = 0
        loss_count = 0
        avg_win = 0.0
        avg_loss = 0.0
        fast_stopouts = 0
        payoff = 0.0

    return {
        'total_ret': total_ret,
        'cagr': cagr,
        'sharpe': sharpe,
        'mdd': mdd,
        'total_trades': total_trades,
        'win_rate': win_rate,
        'win_count': win_count,
        'loss_count': loss_count,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'payoff': payoff,
        'fast_stopouts': fast_stopouts
    }

if __name__ == '__main__':
    print("[*] 正在載入歷史數據...")
    data = load_data()
    print("[*] 數據載入完成，開始執行各選股假說回測...")

    experiments = [
        ('1. 基準 (當前 Titan 40_30_30)', {}),
        ('2. 多頭均線: P > 20MA (月線之上)', {'require_p_gt_ma20': True}),
        ('3. 多頭排列: 20MA > 60MA (月線高於季線)', {'require_ma20_gt_ma60': True}),
        ('4. 雙重多頭: P > 20MA 且 20MA > 60MA', {'require_p_gt_ma20': True, 'require_ma20_gt_ma60': True}),
        ('5. 季線斜率: 60MA 必須上揚 (斜率 >= 0)', {'require_ma60_rising': True}),
        ('6. 安全起跑緩衝帶: P >= 60MA * 1.02 (距季線至少 2%)', {'min_ma60_buffer_pct': 2.0}),
        ('7. 防追高上限: P <= 60MA * 1.25 (乖離率 < 25%)', {'max_ma60_bias_pct': 25.0}),
        ('8. 緩衝帶 + 防追高: 2% <= 距60MA <= 25%', {'min_ma60_buffer_pct': 2.0, 'max_ma60_bias_pct': 25.0}),
        ('9. 近期動能: ret_20 > 0 (近月非下跌轉弱股)', {'require_ret20_positive': True}),
        ('10. 短期超額: ret_20 > taiex_ret20 (近月擊敗大盤)', {'require_ret20_outperform': True}),
        ('11. 動能結構升級: 多尺度 RS (20d/60d/120d/250d)', {'rs_mode': 'multi_scale'}),
        ('12. 聚焦近半年 RS (20d+60d+120d)', {'rs_mode': 'short_medium'}),
        ('13. 成長股賦能: 移除 PE 懲罰', {'pe_mode': 'ignore', 'w_rs': 0.50, 'w_inst': 0.30, 'w_pe': 0.0, 'w_size': 0.20}),
        ('14. 近期籌碼: 近20日法人必須淨買超', {'require_inst20_positive': True}),
        ('15. 【旗艦強化 A】雙重多頭 + 緩衝帶 + 近月動能為正', {
            'require_p_gt_ma20': True,
            'require_ma20_gt_ma60': True,
            'min_ma60_buffer_pct': 2.0,
            'max_ma60_bias_pct': 25.0,
            'require_ret20_positive': True
        }),
        ('16. 【旗艦強化 B】多尺度RS + 雙重多頭 + 緩衝帶 + 近月動能', {
            'rs_mode': 'multi_scale',
            'require_p_gt_ma20': True,
            'require_ma20_gt_ma60': True,
            'min_ma60_buffer_pct': 2.0,
            'max_ma60_bias_pct': 25.0,
            'require_ret20_positive': True
        }),
        ('17. 【旗艦強化 C】全多頭排列 + 緩衝帶 + 60MA上揚 + 多尺度RS', {
            'rs_mode': 'multi_scale',
            'require_p_gt_ma20': True,
            'require_ma20_gt_ma60': True,
            'require_ma60_rising': True,
            'min_ma60_buffer_pct': 2.0,
            'max_ma60_bias_pct': 25.0,
            'require_ret20_positive': True
        }),
        ('18. 【旗艦強化 D】旗艦C + 成長股無PE束縛 + 法人近期確認', {
            'rs_mode': 'multi_scale',
            'require_p_gt_ma20': True,
            'require_ma20_gt_ma60': True,
            'require_ma60_rising': True,
            'min_ma60_buffer_pct': 2.0,
            'max_ma60_bias_pct': 25.0,
            'require_ret20_positive': True,
            'pe_mode': 'ignore',
            'w_rs': 0.45, 'w_inst': 0.30, 'w_pe': 0.05, 'w_size': 0.20
        }),
    ]

    results = []
    for name, cfg in experiments:
        res = run_simulation(data, cfg)
        results.append({
            '方案名稱': name,
            '勝率 (%)': f"{res['win_rate']:.2f}%",
            '總交易筆數': res['total_trades'],
            '勝/敗筆數': f"{res['win_count']} / {res['loss_count']}",
            '早夭停損(<=10日)': res['fast_stopouts'],
            '10年總報酬 (%)': f"{res['total_ret']:+,.1f}%",
            '年化 CAGR (%)': f"{res['cagr']:.2f}%",
            '夏普比率': f"{res['sharpe']:.2f}",
            '最大回撤 MDD': f"{res['mdd']:.2f}%",
            '平均勝率/平均損失': f"+{res['avg_win']:.1f}% / {res['avg_loss']:.1f}%",
            '盈虧比 (Payoff)': f"{res['payoff']:.2f}"
        })

    df_out = pd.DataFrame(results)
    print("\n" + "="*120)
    print("【泰坦王者選股強化自我博弈實驗結果 (2016-2026 全樣本)】")
    print("="*120)
    print(df_out.to_string(index=False))
