import sqlite3
import pandas as pd
import numpy as np

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
conn = sqlite3.connect(DB_PATH)

df_taiex = pd.read_sql_query('SELECT date, close FROM daily_index WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_macro = pd.read_sql_query('SELECT date, sox FROM macro_indicators WHERE date >= "20150101" AND date <= "20261002" ORDER BY date', conn).set_index('date')
df_macro_overlay = df_taiex.copy()
df_macro_overlay['taiex_ma60'] = df_macro_overlay['close'].rolling(60, min_periods=20).mean()
df_macro_overlay['sox'] = df_macro['sox'].ffill()
df_macro_overlay['sox_ma60'] = df_macro_overlay['sox'].rolling(60, min_periods=20).mean()
df_macro_overlay['macro_bull'] = (df_macro_overlay['close'] >= df_macro_overlay['taiex_ma60']) | (df_macro_overlay['sox'] >= df_macro_overlay['sox_ma60'])

years = [str(y) for y in range(2015, 2027)]
top_stocks = set()
for yr in years:
    df_yr = pd.read_sql_query(f'SELECT stock_id FROM daily_stock WHERE date >= "{yr}0101" AND date <= "{yr}1231" AND LENGTH(stock_id) = 4 AND stock_id GLOB "[0-9][0-9][0-9][0-9]" GROUP BY stock_id ORDER BY SUM(trade_value) DESC LIMIT 50', conn)
    top_stocks.update(df_yr['stock_id'].tolist())

sids = list(top_stocks)
placeholders = ','.join(['?']*len(sids))

df_px = pd.read_sql_query(f'''
    SELECT date, stock_id, closing_price, highest_price, lowest_price, trade_value, pe_ratio
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
high_pivot = df_px.pivot(index='date', columns='stock_id', values='highest_price').sort_index().ffill()
low_pivot = df_px.pivot(index='date', columns='stock_id', values='lowest_price').sort_index().ffill()
value_pivot = df_px.pivot(index='date', columns='stock_id', values='trade_value').sort_index().fillna(0)
pe_pivot = df_px.pivot(index='date', columns='stock_id', values='pe_ratio').sort_index().ffill()

df_inst['inst_net'] = df_inst['foreign_net'].fillna(0) + df_inst['trust_net'].fillna(0)
inst_pivot = df_inst.pivot(index='date', columns='stock_id', values='inst_net').fillna(0).sort_index()

all_dates = [d for d in price_pivot.index if d >= '20160104']
ma20_pivot = price_pivot.rolling(20, min_periods=10).mean()
ma60_pivot = price_pivot.rolling(60, min_periods=20).mean()
ret_20 = price_pivot.pct_change(20, fill_method=None)
ret_60 = price_pivot.pct_change(60, fill_method=None)
ret_120 = price_pivot.pct_change(120, fill_method=None)
ret_250 = price_pivot.pct_change(250, fill_method=None)
taiex_ret120 = df_taiex['close'].pct_change(120, fill_method=None)
rolling_turnover_60 = value_pivot.rolling(60, min_periods=20).mean()
rolling_inst_60 = inst_pivot.rolling(60, min_periods=20).sum()

# ATR 20
tr1 = high_pivot - low_pivot
tr2 = (high_pivot - price_pivot.shift(1)).abs()
tr3 = (low_pivot - price_pivot.shift(1)).abs()
tr = pd.concat([tr1, tr2, tr3]).groupby(level=0).max()
atr_20 = tr.rolling(20, min_periods=10).mean()

print("Testing refinement hypotheses on selection logic...")

def run_backtest_with_params(
    score_mode='base',        # 'base', 'accel_mom', 'quality_trend', 'convex_alpha'
    stop_mode='ma60',         # 'ma60', 'ma20_tight', 'chandelier_3atr', 'hybrid_ma_atr'
    macro_defense='double_ma60', # 'double_ma60', 'strict_taiex_ma60', 'macro_or_breadth'
    weights=(0.50, 0.25, 0.25) # weights for Titan and Satellites
):
    portfolio_equity = 1000000.0
    active_weights = {}
    pending_weights = None
    fee_rate = 0.00585
    curve = []
    
    # 紀錄個別標的進場後的最高價 (for Chandelier stop)
    highest_since_entry = {}
    
    for i, dt in enumerate(all_dates):
        if pending_weights is not None:
            turnover = 0.0
            all_s = set(list(active_weights.keys()) + list(pending_weights.keys()))
            for s in all_s:
                turnover += abs(pending_weights.get(s, 0.0) - active_weights.get(s, 0.0))
            turnover /= 2.0
            portfolio_equity -= portfolio_equity * turnover * fee_rate
            
            # 更新 entry tracking
            for s in pending_weights:
                if s not in active_weights:
                    highest_since_entry[s] = price_pivot.loc[dt, s]
            for s in list(highest_since_entry.keys()):
                if s not in pending_weights:
                    del highest_since_entry[s]
                    
            active_weights = pending_weights
            pending_weights = None
            
        if i > 0:
            prev_dt = all_dates[i-1]
            daily_ret = 0.0
            for s, w in active_weights.items():
                p_now = price_pivot.loc[dt, s]
                p_prev = price_pivot.loc[prev_dt, s]
                if not pd.isna(p_now) and not pd.isna(p_prev) and p_prev > 0:
                    daily_ret += w * ((p_now / p_prev) - 1.0)
                # 更新最高價
                if s in highest_since_entry and not pd.isna(p_now):
                    highest_since_entry[s] = max(highest_since_entry[s], p_now)
            portfolio_equity *= (1.0 + daily_ret)
            
        # 個股風控停損
        if active_weights:
            temp_active = {}
            for s, w in active_weights.items():
                p = price_pivot.loc[dt, s]
                ma60 = ma60_pivot.loc[dt, s]
                ma20 = ma20_pivot.loc[dt, s]
                atr = atr_20.loc[dt, s] if s in atr_20.columns else (p * 0.03)
                h_peak = highest_since_entry.get(s, p)
                
                is_stopped = False
                if stop_mode == 'ma60':
                    is_stopped = (p < ma60)
                elif stop_mode == 'ma20_tight':
                    is_stopped = (p < ma20)
                elif stop_mode == 'chandelier_3atr':
                    is_stopped = (p < (h_peak - 3.0 * atr))
                elif stop_mode == 'hybrid_ma_atr':
                    # 跌破 60MA 或從最高點回檔超過 2.5 倍 ATR 且跌破 20MA
                    is_stopped = (p < ma60) or (p < (h_peak - 2.5 * atr) and p < ma20)
                    
                if not is_stopped:
                    temp_active[s] = w
            active_weights = temp_active
            
        if i % 20 == 0:
            # 宏觀防禦
            if macro_defense == 'double_ma60':
                is_macro_bull = df_macro_overlay.loc[dt, 'macro_bull'] if dt in df_macro_overlay.index else True
            elif macro_defense == 'strict_taiex_ma60':
                is_macro_bull = (df_macro_overlay.loc[dt, 'close'] >= df_macro_overlay.loc[dt, 'taiex_ma60']) if dt in df_macro_overlay.index else True
            else:
                is_macro_bull = True
                
            if not is_macro_bull:
                next_targets = {}
            else:
                valid_turnover = rolling_turnover_60.loc[dt].dropna()
                liquid_pool = valid_turnover.nlargest(50).index
                scores = {}
                for sid in liquid_pool:
                    r20 = ret_20.loc[dt, sid]
                    r60 = ret_60.loc[dt, sid]
                    r120 = ret_120.loc[dt, sid]
                    r250 = ret_250.loc[dt, sid]
                    t120 = taiex_ret120.loc[dt] if dt in taiex_ret120.index else 0
                    p = price_pivot.loc[dt, sid]
                    ma60 = ma60_pivot.loc[dt, sid]
                    ma20 = ma20_pivot.loc[dt, sid]
                    
                    if pd.isna(r120) or pd.isna(r250) or pd.isna(p) or pd.isna(ma60) or p < ma60:
                        continue
                        
                    rs_score = (r120 - t120) * 0.7 + r250 * 0.3
                    inst_val = rolling_inst_60.loc[dt, sid] if (sid in rolling_inst_60.columns and not pd.isna(rolling_inst_60.loc[dt, sid])) else 0
                    pe = pe_pivot.loc[dt, sid] if (sid in pe_pivot.columns and not pd.isna(pe_pivot.loc[dt, sid])) else 20
                    pe_score = (1.0 / pe) if (0 < pe <= 65) else (-0.05)
                    turnover = valid_turnover[sid]
                    
                    # 額外特徵
                    mom_accel = (r20 - r60 / 3.0) # 短期動能斜率加速度
                    trend_align = 1.0 if (p > ma20 > ma60) else 0.0 # 均線多頭排列加成
                    
                    scores[sid] = {
                        'rs': rs_score,
                        'inst': inst_val,
                        'pe': pe_score,
                        'turnover': turnover,
                        'accel': mom_accel,
                        'align': trend_align
                    }
                    
                if scores:
                    sdf = pd.DataFrame(scores).T
                    sdf['norm_rs'] = sdf['rs'].rank(pct=True)
                    sdf['norm_inst'] = sdf['inst'].rank(pct=True)
                    sdf['norm_pe'] = sdf['pe'].rank(pct=True)
                    sdf['norm_size'] = sdf['turnover'].rank(pct=True)
                    sdf['norm_accel'] = sdf['accel'].rank(pct=True)
                    sdf['align_bonus'] = sdf['align']
                    
                    if score_mode == 'base':
                        sdf['final_score'] = (
                            0.40 * sdf['norm_rs'] +
                            0.25 * sdf['norm_inst'] +
                            0.20 * sdf['norm_pe'] +
                            0.15 * sdf['norm_size']
                        )
                    elif score_mode == 'accel_mom': # 加入動能加速度
                        sdf['final_score'] = (
                            0.35 * sdf['norm_rs'] +
                            0.20 * sdf['norm_inst'] +
                            0.15 * sdf['norm_pe'] +
                            0.10 * sdf['norm_size'] +
                            0.20 * sdf['norm_accel']
                        )
                    elif score_mode == 'quality_trend': # 強制多頭排列加分
                        sdf['final_score'] = (
                            0.35 * sdf['norm_rs'] +
                            0.25 * sdf['norm_inst'] +
                            0.15 * sdf['norm_pe'] +
                            0.10 * sdf['norm_size'] +
                            0.15 * sdf['align_bonus']
                        )
                    elif score_mode == 'convex_alpha': # 綜合進階體系
                        sdf['final_score'] = (
                            0.30 * sdf['norm_rs'] +
                            0.20 * sdf['norm_accel'] +
                            0.20 * sdf['norm_inst'] +
                            0.15 * sdf['norm_pe'] +
                            0.15 * sdf['align_bonus']
                        )
                        
                    top5_scale = sdf.nlargest(5, 'turnover')
                    sovereign = top5_scale['final_score'].idxmax()
                    rem = sdf.drop(index=[sovereign])
                    sats = rem.nlargest(2, 'final_score').index.tolist()
                    
                    next_targets = {sovereign: weights[0]}
                    for idx_s, s in enumerate(sats):
                        next_targets[s] = weights[idx_s + 1]
                else:
                    next_targets = {}
            pending_weights = next_targets
        curve.append(portfolio_equity)
        
    s = pd.Series(curve)
    tot_ret = (s.iloc[-1] / s.iloc[0] - 1) * 100
    peak = s.cummax()
    mdd = ((s - peak) / peak * 100).min()
    rets = s.pct_change().dropna()
    cagr = ((s.iloc[-1] / s.iloc[0]) ** (244.0 / len(s)) - 1) * 100
    sharpe = (rets.mean() * 244) / (rets.std() * np.sqrt(244)) if rets.std() > 0 else 0
    calmar = cagr / abs(mdd) if mdd != 0 else 0
    
    idx_1y = all_dates.index('20251002') if '20251002' in all_dates else -244
    ret_1y = (s.iloc[-1] / s.iloc[idx_1y] - 1) * 100
    
    return {
        'total_ret': tot_ret,
        'ret_1y': ret_1y,
        'cagr': cagr,
        'mdd': mdd,
        'sharpe': sharpe,
        'calmar': calmar,
        'final_equity': s.iloc[-1]
    }

experiments = [
    ('1. 現行基準 (Base 50/25/25 + 60MA stop)', 'base', 'ma60', 'double_ma60', (0.50, 0.25, 0.25)),
    ('2. 精進配權 (Titan 40% + 雙衛星 30/30)', 'base', 'ma60', 'double_ma60', (0.40, 0.30, 0.30)),
    ('3. 抓取精進：動能加速度 (Accel Mom)', 'accel_mom', 'ma60', 'double_ma60', (0.50, 0.25, 0.25)),
    ('4. 抓取精進：多頭排列約束 (Quality Trend)', 'quality_trend', 'ma60', 'double_ma60', (0.50, 0.25, 0.25)),
    ('5. 抓取精進：凸性 Alpha 綜合模型 (Convex Alpha)', 'convex_alpha', 'ma60', 'double_ma60', (0.50, 0.25, 0.25)),
    ('6. 風控精進：混合 ATR 吊燈停損 (Hybrid ATR)', 'base', 'hybrid_ma_atr', 'double_ma60', (0.50, 0.25, 0.25)),
    ('7. 宏觀防禦精進：單一加權破季線即空手 (Strict Taiex)', 'base', 'ma60', 'strict_taiex_ma60', (0.50, 0.25, 0.25)),
    ('8. 終極王者：凸性 Alpha + 40/30/30 配權', 'convex_alpha', 'ma60', 'double_ma60', (0.40, 0.30, 0.30)),
]

print("\n" + "="*100)
print(f"{'實驗名稱 / 假設驗證':<35} | {'10年總報酬':<10} | {'近1年報酬':<9} | {'CAGR':<7} | {'最大回撤':<8} | {'夏普':<6} | {'卡瑪比'}")
print("="*100)
for name, sc, st, mc, wt in experiments:
    r = run_backtest_with_params(score_mode=sc, stop_mode=st, macro_defense=mc, weights=wt)
    print(f"{name:<35} | {r['total_ret']:+9.1f}% | {r['ret_1y']:+8.1f}% | {r['cagr']:6.1f}% | {r['mdd']:7.2f}% | {r['sharpe']:5.2f} | {r['calmar']:5.2f}")
print("="*100)
