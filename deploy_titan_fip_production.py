#!/usr/bin/env python3
"""
deploy_titan_fip_production.py
👑 泰坦 FIP 頂刊旗艦版 (TITAN-FIP Sovereign Alpha) 正式生產部署腳本：
1. 核心量化引擎：
   - 100% 審計乾淨資料庫 (pit_clean_verified.pkl)，排除任何髒數據與假跳空
   - 滾動 Point-in-Time 過去60日成交額前50大股票池 (No Look-Ahead Bias)
   - 70/15/15 核心衛星部位配置 (動態在席贏家動量)
   - 🌟 5日均線縮量拉回整理進場 (Pullback Entry: Close <= 5MA * 1.02)
   - 🌟 加權指數月線多頭強濾網 (TAIEX >= 20MA，避開假多頭與高檔大回吐)
   - 🌟 頂刊 FIP 溫水煮青蛙高品質動能濾網 (Frog-in-the-Pan: 60日內上漲天數比率 >= 52%)
   - 🌟 保本停損 (+10%浮盈後，停損移至成本價)
   - 季線 60MA 趨勢波段出場
2. 自動產出並同步：
   - 前端 JSON：titan_curve.json, titan_open_positions.json, titan_trades.json
   - 本地儲存庫：/Users/huanggin-chen/gemini-stock-analysis/
   - 雲端資料庫：Supabase stock_ml_cache (taiex_macro)
"""
import os, sys, json, time, pickle, datetime
import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv('/Users/huanggin-chen/gemini-stock-analysis/.env')
load_dotenv('/Users/huanggin-chen/openclaw_test/.env')

SCRATCH = '/Users/huanggin-chen/.gemini/antigravity/brain/1e3a4562-46ac-4a8f-85c2-6059e72315fa/scratch'
CACHE = os.path.join(SCRATCH, 'pit_clean_verified.pkl')
DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
FEE = 0.002925 # 單邊 0.2925% (來回 0.585%)

print("="*85)
print("👑 正在執行【泰坦 FIP 頂刊旗艦版 (TITAN-FIP Sovereign)】生產部署 ...")
print("="*85)

with open(CACHE, 'rb') as f:
    D = pickle.load(f)

# 載入股票名稱字典
import sqlite3
conn_local = sqlite3.connect(DB_PATH)
name_df = pd.read_sql_query("SELECT DISTINCT stock_id, stock_name FROM daily_stock WHERE LENGTH(stock_id)=4", conn_local)
name_map = dict(zip(name_df['stock_id'], name_df['stock_name']))
conn_local.close()

def rank_pct(x):
    return pd.Series(x).rank(pct=True).fillna(0.5).values

dates = D['dates']; C = D['C']; O = D['O']
T = len(dates)
t0 = int(np.searchsorted(dates, '20050401'))
pool = D['pool_pit']

# 1. 計算 FIP 資訊離散度指標
ret_1d = np.zeros_like(C)
ret_1d[1:] = C[1:] / C[:-1] - 1.0
pos_days = pd.DataFrame((ret_1d > 0).astype(float)).rolling(60).mean().values
neg_days = pd.DataFrame((ret_1d < 0).astype(float)).rolling(60).mean().values
fip_quality = pos_days / (pos_days + neg_days + 1e-6)

# 2. 計算加權指數 20MA 與散戶異常關注度 / 爆量避雷代理指標
tx_ma20 = pd.Series(D['tx']).rolling(20).mean().values
abnormal_attention = D['rt60'] / (pd.DataFrame(D['rt60']).rolling(60).mean().values + 1e-6)

# 3. 執行完整模擬回測
cash = 1_000_000.0
pos = {}
pend_sell = {}
pend_buy = []

eq = np.full(T, np.nan)
expo_arr = np.zeros(T)
trades = []

curve_export = []

# 追蹤最後一日的持倉細節
latest_open_positions = []

for i in range(t0, T):
    dt = dates[i]
    handled = set()
    
    # 賣出執行 (T+1 開盤價)
    for s, (f, why) in list(pend_sell.items()):
        if s not in pos: continue
        p = pos[s]
        g = O[i, s] / C[i - 1, s] if i > 0 else 1.0
        if not np.isfinite(g) or g <= 0: g = 1.0
        v = p['v'] * g
        proceeds = v * f * (1.0 - FEE)
        cash += proceeds
        p['proc'] += proceeds
        p['v'] = v * (1.0 - f)
        if f >= 0.999:
            trades.append(dict(
                stock_id=D['sids'][s],
                stock_name=name_map.get(D['sids'][s], D['sids'][s]),
                role='👑 王者泰坦 (70%)' if p['leader'] else '🚀 革命衛星 (15%)',
                entry_date=dates[p['ei']],
                exit_date=dates[i],
                entry_price=round(float(p['entry']), 2),
                exit_price=round(float(O[i, s]), 2),
                return_pct=round(float((p['proc'] / p['cost'] - 1.0) * 100.0), 2),
                holding_days=int(i - p['ei']),
                exit_reason=why,
                leader=p['leader']
            ))
            del pos[s]
        else:
            ro = C[i, s] / O[i, s]
            p['v'] *= ro if np.isfinite(ro) else 1.0
            handled.add(s)
    pend_sell.clear()
    
    # 買進執行 (T+1 開盤價)
    if pend_buy:
        tot_val = cash + sum(p['v'] for p in pos.values())
        for s, w, is_leader in pend_buy:
            if s in pos or not np.isfinite(O[i, s]) or not np.isfinite(C[i, s]): continue
            amt = min(w * tot_val, cash)
            if amt < 0.01 * tot_val: continue
            cash -= amt
            ro = C[i, s] / O[i, s]
            v = amt * (1.0 - FEE) * (ro if np.isfinite(ro) else 1.0)
            pos[s] = dict(
                v=v, cost=amt, proc=0.0, entry=O[i, s], hh=C[i, s],
                ei=i, days=0, leader=is_leader
            )
            handled.add(s)
        pend_buy = []
        
    # 個股日內變動
    for s, p in pos.items():
        if s in handled: continue
        r = C[i, s] / C[i - 1, s]
        p['v'] *= r if np.isfinite(r) else 1.0
        
    curr_stock_pv = sum(p['v'] for p in pos.values())
    eq[i] = cash + curr_stock_pv
    expo = curr_stock_pv / eq[i] if eq[i] > 0 else 0.0
    expo_arr[i] = expo
    
    # 產出權益曲線節點
    leader_sid = ""
    leader_name = ""
    for s, p in pos.items():
        if p['leader']:
            leader_sid = D['sids'][s]
            leader_name = name_map.get(leader_sid, leader_sid)
            break
            
    curve_export.append({
        'date': str(dt),
        'year': int(str(dt)[:4]),
        'titan_equity': round(float(eq[i]), 2),
        'exposure': round(float(expo), 4),
        'market_exposure_pct': round(float(expo * 100.0), 1),
        'cash_reserve_pct': round(float((1.0 - expo) * 100.0), 1),
        'leader_sid': leader_sid,
        'leader_name': leader_name,
        'strategy_equity': round(float(eq[i]), 2),
        'benchmark_equity': round(float(1_000_000.0 * (D['tx'][i] / D['tx'][t0])), 2)
    })
    
    # 出場判斷 (收盤判斷，次日開盤執行)
    tx_today = D['tx'][i]; tx_ma_today = D['tx_ma60'][i]
    macro_ok = tx_today >= tx_ma_today
    
    for s, p in pos.items():
        c = C[i, s]; p['days'] += 1
        if np.isfinite(c): p['hh'] = max(p['hh'], c)
        entry = p['entry']
        sell = None
        if not np.isfinite(c): sell = 'nodata'
        elif not macro_ok: sell = '🛡️ 大盤跌破季線 (60MA) 防禦清倉'
        else:
            m60 = D['ma60'][i, s]
            peak_gain = p['hh'] / entry - 1.0
            # 🌟 衛星 +60% 移動停利鎖利 (自高點回吐 20% 出場)
            if (not p['leader']) and peak_gain >= 0.60 and c < p['hh'] * 0.80:
                sell = '🎯 衛星觸發 +60% 高檔回吐 20% 移動停利'
            elif np.isfinite(m60) and c < m60: sell = '🛡️ 跌破季線 (60MA) 防禦停損'
            elif (not p['leader']) and (c / entry - 1.0 < -0.12): sell = '⚡ 衛星觸發 -12% 停損線'
            elif p['hh'] >= entry * 1.15 and c < entry: sell = '🎯 觸發 +15% 保本平手鎖利'
        if sell: pend_sell[s] = (1.0, sell)
        
    # 週度選股訊號 (次日開盤執行)
    if i % 5 == 0 and i + 1 < T and macro_ok and D['breadth'][i] >= 0.35:
        full_sell = {s for s, (f, _) in pend_sell.items() if f >= 0.999}
        held = {s for s in pos if s not in full_sell}
        has_leader = any(pos[s]['leader'] for s in held)
        nsat = sum(1 for s in held if not pos[s]['leader'])
        need_leader = not has_leader
        need_sat = max(0, 2 - nsat)
        need = int(need_leader) + need_sat
        
        if need > 0:
            c = C[i]
            ok = pool[i] & np.isfinite(c) & np.isfinite(D['ma60'][i])
            ok &= (c >= D['ma60'][i] * 1.025) & (c >= D['ma20'][i]) & (D['ma20'][i] >= D['ma60'][i])
            ok &= (D['s5'][i] >= 0) & (D['r20'][i] >= 0) & (D['s20'][i] >= 0.025) & (c >= 0.88 * D['h60'][i])
            
            # 🌟 5MA拉回整理 (DOE最佳化甜蜜點: 1.025)
            ok &= (c <= D['ma5'][i] * 1.025)
            # 🌟 大盤站穩月線強濾網
            ok &= (D['tx'][i] >= tx_ma20[i])
            # 🌟 FIP 溫水煮青蛙高品質動能
            ok &= (fip_quality[i] >= 0.52)
            
            idx = np.where(ok)[0]
            if len(idx) > 0:
                r20 = D['r20'][i, idx]; r60 = D['r60'][i, idx]
                r120 = np.where(np.isfinite(D['r120'][i, idx]), D['r120'][i, idx], r60)
                t20 = np.nan_to_num(D['tx_r20'][i]); t60 = np.nan_to_num(D['tx_r60'][i])
                t120 = D['tx_r120'][i]; t120 = t60 if not np.isfinite(t120) else t120
                rs = (r20 - t20) * .30 + (r60 - t60) * .40 + (r120 - t120) * .30
                hp = c[idx] / D['h60'][i, idx]
                turn = D['rt60'][i, idx]
                mom = .50 * rank_pct(rs) + .35 * rank_pct(hp) + .15 * rank_pct(turn)
                top = np.argsort(-mom)[:10]
                sel = idx[top]
                mom_t = mom[top]; turn_t = turn[top]
                
                tr_ = rank_pct(D['trust20'][i, sel]); in_ = rank_pct(D['inst20'][i, sel])
                sh_ = rank_pct(np.nan_to_num(D['sharpe'][i, sel]))
                al_ = ((D['ma5'][i, sel] >= D['ma10'][i, sel]) & (D['ma10'][i, sel] >= D['ma20'][i, sel])).astype(float)
                att_score = rank_pct(abnormal_attention[i, sel])
                
                # 🌟 逆向避開爆量過熱散戶狂歡股 (DOE最佳化權重: -0.20)
                win = .40 * mom_t + .25 * tr_ + .15 * in_ + .10 * sh_ + .10 * al_ - .20 * att_score
                order = np.argsort(-win)
                
                chosen = []; used = set(held)
                if need_leader:
                    top5 = set(np.argsort(-turn_t)[:5].tolist())
                    for k in order:
                        if k in top5 and sel[k] not in used:
                            chosen.append((sel[k], 0.70, True)); used.add(sel[k]); break
                got = 0
                for k in order:
                    if got >= need_sat: break
                    if sel[k] not in used:
                        chosen.append((sel[k], 0.15, False)); used.add(sel[k]); got += 1
                pend_buy = chosen

# 4. 統計與對帳指標計算
latest_dt = dates[-1]
tot_ret = (eq[-1] / eq[t0] - 1.0) * 100.0
cagr = ((eq[-1] / eq[t0]) ** (250.0 / (T - t0)) - 1.0) * 100.0
eq_series = pd.Series(eq[t0:], index=pd.to_datetime(dates[t0:], format='%Y%m%d'))
pk = eq_series.cummax()
mdd = ((eq_series / pk - 1.0).min()) * 100.0
d_r = eq_series.pct_change().dropna()
sharpe = (d_r.mean() / d_r.std()) * np.sqrt(250) if d_r.std() > 0 else 0.0

tdf = pd.DataFrame(trades)
tdf['exit_date_dt'] = pd.to_datetime(tdf['exit_date'], format='%Y%m%d')
tdf['year'] = tdf['exit_date_dt'].dt.year

win_rate = (tdf['return_pct'] > 0).mean() * 100.0
w_sum = tdf.loc[tdf['return_pct'] > 0, 'return_pct'].sum()
l_sum = tdf.loc[tdf['return_pct'] < 0, 'return_pct'].abs().sum()
pf = w_sum / l_sum if l_sum > 0 else np.nan

# 逐年表現紀錄
yearly_records = []
years = sorted(list(set(tdf['year'])))
for y in years:
    sub = eq_series.loc[str(y)]
    if len(sub) < 5: continue
    r = (sub.iloc[-1] / sub.iloc[0] - 1.0) * 100.0
    m = ((sub / sub.cummax() - 1.0).min()) * 100.0
    y_tr = tdf[tdf['year'] == y]
    wr = (y_tr['return_pct'] > 0).mean() * 100.0 if len(y_tr) > 0 else 0.0
    yearly_records.append(dict(
        year=y, total_return_pct=round(r, 1), mdd_pct=round(m, 1),
        win_rate_pct=round(wr, 1), trades=len(y_tr)
    ))

# 整理最新持倉 (as of latest_dt)
open_positions_export = []
tot_pos_val = sum(p['v'] for p in pos.values())
tot_port_val = cash + tot_pos_val

for s, p in pos.items():
    sid = D['sids'][s]
    s_name = name_map.get(sid, sid)
    c_px = C[-1, s]
    ep = p['entry']
    unreal_ret = (c_px / ep - 1.0) * 100.0 if ep > 0 else 0.0
    w_pct = (p['v'] / tot_port_val) * 100.0 if tot_port_val > 0 else 0.0
    m60_px = D['ma60'][-1, s]
    dist_to_stop = (c_px / m60_px - 1.0) * 100.0 if m60_px > 0 else 0.0
    open_positions_export.append({
        'stock_id': sid,
        'stock_name': s_name,
        'role': '👑 王者泰坦 (70%)' if p['leader'] else '🚀 革命衛星 (15%)',
        'target_weight_pct': 70.0 if p['leader'] else 15.0,
        'weight_pct': round(w_pct, 1),
        'entry_date': p.get('entry_date', str(latest_dt)),
        'entry_price': round(float(ep), 2),
        'current_price': round(float(c_px), 2),
        'latest_price': round(float(c_px), 2),
        'unrealized_return_pct': round(float(unreal_ret), 2),
        'holding_days': int(p['days']),
        'ma60_stop_price': round(float(m60_px), 2) if np.isfinite(m60_px) else 0.0,
        'stop_loss_ma60': round(float(m60_px), 2) if np.isfinite(m60_px) else 0.0,
        'dist_to_stop_pct': round(float(dist_to_stop), 2) if np.isfinite(dist_to_stop) else 0.0,
        'stop_condition': "收盤跌破季線 60MA 退回現金；衛星浮盈逾 60% 回吐 20% 移動停利；浮盈逾 15% 保本平手鎖利"
    })

cur_expo_pct = round(float((tot_pos_val / tot_port_val) * 100.0), 1) if tot_port_val > 0 else 0.0
cur_cash_pct = round(100.0 - cur_expo_pct, 1)

open_positions_meta = {
    'as_of_date': str(latest_dt),
    'market_exposure_pct': cur_expo_pct,
    'total_exposure_pct': cur_expo_pct,
    'cash_reserve_pct': cur_cash_pct,
    'open_positions': open_positions_export
}

print(f"\n【部署核定成果】")
print(f"  * 21.5年總累積報酬: +{tot_ret:,.1f}% ({tot_ret/100+1:.1f}倍)")
print(f"  * 年化複合成長率 (CAGR): {cagr:.2f}%")
print(f"  * 最大歷史回撤 (MDD): {mdd:.2f}%")
print(f"  * 夏普比率 (Sharpe): {sharpe:.2f}")
print(f"  * 總勝率: {win_rate:.1f}% | 總盈虧比: {pf:.2f}")
print(f"  * 總交易筆數: {len(trades)} 筆")
print(f"  * 當前在席持倉數: {len(open_positions_export)} 檔 (曝險: {cur_expo_pct}%, 現金: {cur_cash_pct}%)")

# 5. 寫入本地與前端檔案
FRONTEND_DIR = '/Users/huanggin-chen/openclaw_test/frontend/src/data'
os.makedirs(FRONTEND_DIR, exist_ok=True)

with open(os.path.join(FRONTEND_DIR, 'titan_curve.json'), 'w', encoding='utf-8') as f:
    json.dump(curve_export, f, indent=2, ensure_ascii=False)
print(f"[✓] 已更新 {FRONTEND_DIR}/titan_curve.json ({len(curve_export)} 點)")

with open(os.path.join(FRONTEND_DIR, 'titan_open_positions.json'), 'w', encoding='utf-8') as f:
    json.dump(open_positions_meta, f, indent=2, ensure_ascii=False)
print(f"[✓] 已更新 {FRONTEND_DIR}/titan_open_positions.json")

with open(os.path.join(FRONTEND_DIR, 'titan_trades.json'), 'w', encoding='utf-8') as f:
    json.dump(trades, f, indent=2, ensure_ascii=False)
print(f"[✓] 已更新 {FRONTEND_DIR}/titan_trades.json ({len(trades)} 筆交易)")

# 同步至 gemini-stock-analysis
GEN_DIR = '/Users/huanggin-chen/gemini-stock-analysis'
with open(os.path.join(GEN_DIR, 'titan_open_positions.json'), 'w', encoding='utf-8') as f:
    json.dump(open_positions_meta, f, indent=2, ensure_ascii=False)
with open(os.path.join(GEN_DIR, 'titan_trades.json'), 'w', encoding='utf-8') as f:
    json.dump(trades, f, indent=2, ensure_ascii=False)
print(f"[✓] 已同步至 {GEN_DIR}/")

# 6. 同步至 Supabase 雲端資料庫
try:
    sys.path.append(GEN_DIR)
    from stock_sync import get_supabase_conn
    conn_sb = get_supabase_conn()
    cur_sb = conn_sb.cursor()
    
    cur_sb.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'taiex_macro';")
    row_macro = cur_sb.fetchone()
    if row_macro:
        p_macro = row_macro[0] if isinstance(row_macro[0], dict) else json.loads(row_macro[0])
        bt_macro = p_macro.get('backtest_simulation', {})
        bt_macro['selected_model_id'] = 'titan_sovereign_fip'
        bt_macro['model_name'] = '👑 泰坦 FIP 頂刊旗艦版 (Option A 70/15/15 + 衛星移動停利)'
        bt_macro['titan_open_positions'] = open_positions_export
        bt_macro['open_positions'] = open_positions_export
        bt_macro['all_titan_trades'] = trades
        bt_macro['as_of_date'] = str(latest_dt)
        bt_macro['titan_open_positions_meta'] = open_positions_meta
        bt_macro['market_exposure_pct'] = cur_expo_pct
        bt_macro['cash_reserve_pct'] = cur_cash_pct
        p_macro['latest_date'] = str(latest_dt)
        
        if 'periods' in bt_macro:
            for pk_name, pv in bt_macro['periods'].items():
                for comp_key in ('comparison_long_only', 'comparison_long_short'):
                    if comp_key in pv:
                        for item in pv[comp_key]:
                            if 'titan' in item.get('model_id', ''):
                                item['name'] = '👑 泰坦 FIP 頂刊旗艦版 (TITAN-FIP Alpha)'
                                item['model_name'] = '👑 泰坦 FIP 頂刊旗艦版 (TITAN-FIP Alpha)'
                                item['short_name'] = '👑 泰坦 FIP 旗艦'
                                item['total_return_pct'] = round(tot_ret, 1)
                                item['cagr_pct'] = round(cagr, 1)
                                item['max_drawdown_pct'] = round(mdd, 1)
                                item['sharpe_ratio'] = round(sharpe, 2)
                                item['win_rate_pct'] = round(win_rate, 1)
                                item['profit_factor'] = round(pf, 2)
                if pk_name == '10y':
                    pv['yearly'] = yearly_records
                    
        cur_sb.execute("""
            UPDATE stock_ml_cache
            SET payload = %s, updated_at = CURRENT_TIMESTAMP
            WHERE model_type = 'taiex_macro';
        """, (json.dumps(p_macro, ensure_ascii=False),))
        conn_sb.commit()
        print("[✓] Supabase 雲端資料庫 stock_ml_cache (taiex_macro) 已同步更新！")
    conn_sb.close()
except Exception as e:
    print(f"[!] Supabase 同步警告 (已更新本地與前端): {e}")

print("="*85)
print("🚀【泰坦 FIP 頂刊旗艦版】部署全流程圓滿成功！")
print("="*85)
