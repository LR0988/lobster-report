#!/usr/bin/env python3
"""
titan_live_monitor.py
👑 【泰坦旗艦版 (TITAN Sovereign Alpha) 實盤每日監控與對帳系統】
========================================================================================
功能清單：
  1. 📊 實盤戰情室監控 (status)：即時大盤多空、持股水位、現金儲備、總淨值、累積報酬率與回撤。
  2. 🛡️ 停損停利防禦雷達 (stops)：逐檔監控 60MA 季線防守、+15% 保本鎖利、衛星 -12% 停損與 +60% 移動停利。
  3. ➕ 成交買進輸入 (buy)：輸入股票代號、成交價、股數、角色，自動扣抵現金、計算持股水位。
  4. ➖ 成交賣出輸入 (sell)：輸入股票代號、出場價、股數、原因，自動結算已實現損益與累積勝率。
  5. 💰 水位與出入金管理 (cash)：手動校準現金水位或紀錄出入金（Deposit / Withdraw）。
  6. 🎯 訊號與智慧下單試算 (signal)：依據當前實盤總淨值，自動精確計算推薦買進之標的與建議委託張數/股數。
  7. 🔄 一鍵更新與前端同步 (update)：自 tw_stock.db 抓取最新收盤價，自動結算今日淨值曲線並同步至前端。
========================================================================================
使用範例：
  python3 titan_live_monitor.py status            # 查看今日戰情室與持倉停損狀態
  python3 titan_live_monitor.py signal            # 查看最新選股訊號與建議下單張數
  python3 titan_live_monitor.py buy --id 2408 --price 550 --shares 1000 --role leader
  python3 titan_live_monitor.py sell --id 2408 --price 520 --shares 1000 --reason "跌破季線停損"
  python3 titan_live_monitor.py cash --set 350000 # 設定現金水位
  python3 titan_live_monitor.py update            # 更新最新收盤價並結算淨值
  python3 titan_live_monitor.py                   # 啟動互動式選單
"""

import os, sys, json, time, argparse, sqlite3, datetime
import numpy as np
import pandas as pd

OPENCLAW_DIR = '/Users/huanggin-chen/openclaw_test'
FRONTEND_DATA_DIR = os.path.join(OPENCLAW_DIR, 'frontend/src/data')
GEMINI_DIR = '/Users/huanggin-chen/gemini-stock-analysis'
DB_PATH = os.path.join(GEMINI_DIR, 'tw_stock.db')
STATE_FILE = os.path.join(OPENCLAW_DIR, 'live_portfolio_state.json')
FRONTEND_STATE_FILE = os.path.join(FRONTEND_DATA_DIR, 'live_portfolio_state.json')

FEE_RATE = 0.001425 * 0.6  # 券商手續費約 6 折 (0.0855%)
TAX_RATE = 0.003           # 股票交易稅 0.3%

# =========================================================================
# 資料庫輔助函數
# =========================================================================
def get_db_connection():
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"找不到資料庫：{DB_PATH}")
    return sqlite3.connect(DB_PATH)

def get_stock_info(stock_id):
    """取得個股最新收盤價、股票名稱與 60MA"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT date, stock_name, closing_price 
        FROM daily_stock 
        WHERE stock_id = ? 
        ORDER BY date DESC LIMIT 65
    """, (str(stock_id),))
    rows = c.fetchall()
    conn.close()

    if not rows:
        return {'stock_name': stock_id, 'price': 0.0, 'ma60': 0.0, 'date': ''}

    name = rows[0][1]
    latest_price = float(rows[0][2])
    latest_date = rows[0][0]
    prices = [float(r[2]) for r in rows if r[2] is not None]
    ma60 = float(np.mean(prices[:60])) if len(prices) >= 60 else latest_price

    return {
        'stock_name': name,
        'price': latest_price,
        'ma60': round(ma60, 2),
        'date': latest_date
    }

def get_taiex_info():
    """取得加權指數最新點位、20MA 與 60MA"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT date, close 
        FROM daily_index 
        ORDER BY date DESC LIMIT 65
    """)
    rows = c.fetchall()
    conn.close()

    if not rows:
        return {'date': '', 'close': 0.0, 'ma20': 0.0, 'ma60': 0.0, 'bullish': False}

    latest_date = rows[0][0]
    latest_close = float(rows[0][1])
    closes = [float(r[1]) for r in rows if r[1] is not None]
    ma20 = float(np.mean(closes[:20])) if len(closes) >= 20 else latest_close
    ma60 = float(np.mean(closes[:60])) if len(closes) >= 60 else latest_close

    bullish = (latest_close >= ma20) and (latest_close >= ma60)
    return {
        'date': latest_date,
        'close': round(latest_close, 2),
        'ma20': round(ma20, 2),
        'ma60': round(ma60, 2),
        'bullish': bullish
    }

# =========================================================================
# 實盤狀態管理類別 (LivePortfolio)
# =========================================================================
class LivePortfolio:
    def __init__(self):
        self.state = self.load_state()

    def load_state(self):
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"[!] 載入狀態檔失敗：{e}，將初始化新狀態。")

        # 預設全新狀態 (若有 titan_open_positions.json 則自動匯入持倉範本)
        default_state = {
            'initial_capital': 1000000.0,
            'current_cash': 1000000.0,
            'total_equity': 1000000.0,
            'peak_equity': 1000000.0,
            'last_updated': datetime.date.today().strftime('%Y%m%d'),
            'positions': [],
            'trade_history': [],
            'equity_history': [{
                'date': datetime.date.today().strftime('%Y%m%d'),
                'cash': 1000000.0,
                'stock_value': 0.0,
                'total_equity': 1000000.0,
                'cum_return_pct': 0.0,
                'exposure_pct': 0.0
            }]
        }

        # 嘗試從生產環境 titan_open_positions.json 匯入初始持倉結構
        prod_pos_file = os.path.join(FRONTEND_DATA_DIR, 'titan_open_positions.json')
        if os.path.exists(prod_pos_file):
            try:
                with open(prod_pos_file, 'r', encoding='utf-8') as f:
                    prod_data = json.load(f)
                positions = []
                cash = 1000000.0
                for p in prod_data.get('open_positions', []):
                    sid = p['stock_id']
                    info = get_stock_info(sid)
                    target_w = p.get('target_weight_pct', 15.0)
                    alloc_amt = 1000000.0 * (target_w / 100.0)
                    px = info['price'] if info['price'] > 0 else p['entry_price']
                    shares = int(alloc_amt // (px * 1.001)) if px > 0 else 1000
                    cost = shares * px * (1.0 + FEE_RATE)
                    cash -= cost
                    positions.append({
                        'stock_id': sid,
                        'stock_name': info['stock_name'] or p['stock_name'],
                        'role': p['role'],
                        'target_weight_pct': target_w,
                        'entry_date': p['entry_date'],
                        'entry_price': round(float(p['entry_price']), 2),
                        'shares': shares,
                        'cost_amount': round(cost, 2),
                        'current_price': round(float(px), 2),
                        'highest_price': round(float(max(p['entry_price'], px)), 2),
                        'holding_days': p.get('holding_days', 1)
                    })
                default_state['positions'] = positions
                default_state['current_cash'] = round(cash, 2)
            except Exception as e:
                print(f"[!] 匯入生產初始持倉提示：{e}")

        return default_state

    def save_state(self):
        self.recalculate()
        self.state['last_updated'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.state, f, indent=2, ensure_ascii=False)
        try:
            with open(FRONTEND_STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.state, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    def recalculate(self):
        """重新計算持股現值、未實現損益、總淨值與停損線"""
        tot_stock_val = 0.0
        for p in self.state['positions']:
            sid = p['stock_id']
            info = get_stock_info(sid)
            cur_px = info['price'] if info['price'] > 0 else p['current_price']
            p['current_price'] = cur_px
            p['highest_price'] = max(p.get('highest_price', cur_px), cur_px)
            val = p['shares'] * cur_px
            p['market_value'] = round(val, 2)
            cost = p['cost_amount']
            p['unrealized_pnl'] = round(val * (1.0 - FEE_RATE - TAX_RATE) - cost, 2)
            p['unrealized_ret_pct'] = round((val / cost - 1.0) * 100.0, 2) if cost > 0 else 0.0
            p['ma60_price'] = info['ma60']

            # 判定有效停損線
            entry_px = p['entry_price']
            hh = p['highest_price']
            is_leader = '70%' in p.get('role', '') or '王者' in p.get('role', '')

            # 預設季線防守
            stop_px = info['ma60']
            stop_type = "🛡️ 季線 60MA 防守"

            # 衛星 +60% 移動停利
            if not is_leader and (hh / entry_px - 1.0 >= 0.60):
                trail_stop = hh * 0.80
                if trail_stop > stop_px:
                    stop_px = round(trail_stop, 2)
                    stop_type = "🎯 +60% 移動停利鎖定線 (回吐20%)"
            # 保本平手鎖利
            elif (hh >= entry_px * 1.15) and (entry_px > stop_px):
                stop_px = round(entry_px, 2)
                stop_type = "🎯 +15% 保本平手鎖利線"
            # 衛星 -12% 停損
            elif not is_leader:
                hard_stop = round(entry_px * 0.88, 2)
                if hard_stop > stop_px:
                    stop_px = hard_stop
                    stop_type = "⚡ 衛星 -12% 硬停損線"

            p['stop_loss_price'] = stop_px
            p['stop_type'] = stop_type
            dist = (cur_px / stop_px - 1.0) * 100.0 if stop_px > 0 else 0.0
            p['dist_to_stop_pct'] = round(dist, 2)

            # 警報判定
            if cur_px < stop_px:
                p['alert'] = "🚨 跌破停損線！建議次日開盤執行賣出"
            elif dist <= 3.0:
                p['alert'] = f"⚠️ 逼近停損點！距停損僅剩 {dist:.1f}%"
            elif "+60%" in stop_type:
                p['alert'] = "🚀 爆賺主升段！移動停利保護中"
            elif "保本" in stop_type:
                p['alert'] = "🛡️ 零風險模式！成本保本已鎖定"
            else:
                p['alert'] = "✅ 多頭航行中"

            tot_stock_val += val

        cash = self.state['current_cash']
        total_equity = cash + tot_stock_val
        self.state['total_equity'] = round(total_equity, 2)
        self.state['peak_equity'] = max(self.state.get('peak_equity', total_equity), total_equity)

        # 權重佔比
        for p in self.state['positions']:
            p['weight_pct'] = round((p['market_value'] / total_equity) * 100.0, 1) if total_equity > 0 else 0.0

        # 績效統計
        init_cap = self.state['initial_capital']
        self.state['cum_return_pct'] = round((total_equity / init_cap - 1.0) * 100.0, 2) if init_cap > 0 else 0.0
        peak = self.state['peak_equity']
        self.state['drawdown_pct'] = round((total_equity / peak - 1.0) * 100.0, 2) if peak > 0 else 0.0
        self.state['exposure_pct'] = round((tot_stock_val / total_equity) * 100.0, 1) if total_equity > 0 else 0.0
        self.state['cash_reserve_pct'] = round((cash / total_equity) * 100.0, 1) if total_equity > 0 else 0.0

    # ---------------------------------------------------------------------
    # 交易執行
    # ---------------------------------------------------------------------
    def record_buy(self, stock_id, price, shares, role=None, date_str=None):
        info = get_stock_info(stock_id)
        name = info['stock_name'] or str(stock_id)
        cur_px = price if price > 0 else info['price']
        if cur_px <= 0:
            print(f"[x] 無法獲取股票 {stock_id} 的有效成交價格！")
            return False

        if not date_str:
            date_str = datetime.date.today().strftime('%Y%m%d')

        if not role:
            # 自動推斷角色
            has_leader = any('70%' in p.get('role', '') or '王者' in p.get('role', '') for p in self.state['positions'])
            role = '👑 王者泰坦 (70%)' if not has_leader else '🚀 革命衛星 (15%)'

        target_w = 70.0 if ('70%' in role or '王者' in role) else 15.0
        gross_amt = shares * cur_px
        fee = round(gross_amt * FEE_RATE, 2)
        total_cost = round(gross_amt + fee, 2)

        if total_cost > self.state['current_cash'] + 1e-4:
            print(f"[!] 警告：所需資金 {total_cost:,.0f} 元超過當前現金餘額 {self.state['current_cash']:,.0f} 元！")

        self.state['current_cash'] -= total_cost

        # 檢查是否已有該持股 (加碼)
        pos = None
        for p in self.state['positions']:
            if p['stock_id'] == str(stock_id):
                pos = p; break

        if pos:
            tot_shares = pos['shares'] + shares
            tot_cost = pos['cost_amount'] + total_cost
            avg_px = tot_cost / tot_shares
            pos['shares'] = tot_shares
            pos['cost_amount'] = round(tot_cost, 2)
            pos['entry_price'] = round(avg_px, 2)
            pos['highest_price'] = max(pos['highest_price'], cur_px)
            print(f"[+] 加碼成功！{name} ({stock_id}) 現有持股：{tot_shares} 股，平均成本：{avg_px:.2f} 元。")
        else:
            self.state['positions'].append({
                'stock_id': str(stock_id),
                'stock_name': name,
                'role': role,
                'target_weight_pct': target_w,
                'entry_date': str(date_str),
                'entry_price': round(float(cur_px), 2),
                'shares': int(shares),
                'cost_amount': round(total_cost, 2),
                'current_price': round(float(cur_px), 2),
                'highest_price': round(float(cur_px), 2),
                'holding_days': 1
            })
            print(f"[+] 買進建倉成功！{role}：{name} ({stock_id}) {shares:,} 股 @ {cur_px:.2f} 元，總投入 {total_cost:,.0f} 元。")

        # 紀錄交易紀錄
        self.state['trade_history'].append({
            'trade_id': len(self.state['trade_history']) + 1,
            'date': str(date_str),
            'action': 'BUY',
            'stock_id': str(stock_id),
            'stock_name': name,
            'role': role,
            'price': cur_px,
            'shares': shares,
            'amount': gross_amt,
            'fee': fee,
            'tax': 0.0,
            'realized_pnl': 0.0,
            'return_pct': 0.0,
            'exit_reason': '建倉買進'
        })

        self.save_state()
        return True

    def record_sell(self, stock_id, price, shares=None, reason="平倉賣出", date_str=None):
        pos_idx = None
        for idx, p in enumerate(self.state['positions']):
            if p['stock_id'] == str(stock_id):
                pos_idx = idx; break

        if pos_idx is None:
            print(f"[x] 錯誤：目前持倉中沒有股票 {stock_id}！")
            return False

        p = self.state['positions'][pos_idx]
        cur_shares = p['shares']
        sell_shares = cur_shares if (shares is None or shares >= cur_shares) else int(shares)
        sell_px = price if price > 0 else p['current_price']

        if not date_str:
            date_str = datetime.date.today().strftime('%Y%m%d')

        gross_amt = sell_shares * sell_px
        fee = round(gross_amt * FEE_RATE, 2)
        tax = round(gross_amt * TAX_RATE, 2)
        net_proceeds = round(gross_amt - fee - tax, 2)

        # 依比例計算成本
        share_ratio = sell_shares / cur_shares
        cost_basis = p['cost_amount'] * share_ratio
        realized_pnl = round(net_proceeds - cost_basis, 2)
        ret_pct = round((net_proceeds / cost_basis - 1.0) * 100.0, 2) if cost_basis > 0 else 0.0

        self.state['current_cash'] += net_proceeds

        # 寫入交易紀錄
        self.state['trade_history'].append({
            'trade_id': len(self.state['trade_history']) + 1,
            'date': str(date_str),
            'action': 'SELL',
            'stock_id': str(stock_id),
            'stock_name': p['stock_name'],
            'role': p['role'],
            'price': sell_px,
            'shares': sell_shares,
            'amount': gross_amt,
            'fee': fee,
            'tax': tax,
            'realized_pnl': realized_pnl,
            'return_pct': ret_pct,
            'exit_reason': reason
        })

        if sell_shares >= cur_shares:
            self.state['positions'].pop(pos_idx)
            print(f"[✓] 全數平倉賣出：{p['stock_name']} ({stock_id}) @ {sell_px:.2f} 元！"
                  f" 回收淨現金 {net_proceeds:,.0f} 元，實現損益：{realized_pnl:+,.0f} 元 ({ret_pct:+.2f}%)。")
        else:
            p['shares'] -= sell_shares
            p['cost_amount'] = round(p['cost_amount'] - cost_basis, 2)
            print(f"[✓] 部分減倉賣出：{p['stock_name']} ({stock_id}) {sell_shares:,} 股 @ {sell_px:.2f} 元！"
                  f" 剩餘持股：{p['shares']:,} 股。")

        self.save_state()
        return True

    def adjust_cash(self, deposit=None, withdraw=None, set_amount=None):
        if set_amount is not None:
            old = self.state['current_cash']
            self.state['current_cash'] = float(set_amount)
            print(f"[+] 現金水位手動校準：{old:,.0f} 元 -> {float(set_amount):,.0f} 元。")
        elif deposit is not None:
            self.state['current_cash'] += float(deposit)
            self.state['initial_capital'] += float(deposit)
            print(f"[+] 帳戶入金成功：存入 {float(deposit):,.0f} 元，最新現金餘額：{self.state['current_cash']:,.0f} 元。")
        elif withdraw is not None:
            self.state['current_cash'] -= float(withdraw)
            self.state['initial_capital'] -= float(withdraw)
            print(f"[-] 帳戶出金成功：提領 {float(withdraw):,.0f} 元，最新現金餘額：{self.state['current_cash']:,.0f} 元。")
        self.save_state()

# =========================================================================
# 戰情室輸出與展示
# =========================================================================
def show_status():
    port = LivePortfolio()
    port.recalculate()
    s = port.state
    tx = get_taiex_info()

    print("\n" + "="*95)
    print("👑 【泰坦旗艦版 (TITAN Sovereign Alpha) 實盤戰情室與持倉停損監控】")
    print("="*95)

    # 1. 大盤宏觀體檢
    tx_status = "🟢 多頭多頭排列 (健康可攻擊)" if tx['bullish'] else "🔴 跌破防禦線 (停止開新倉/防禦防護中)"
    print(f"📡 【大盤宏觀雷達】: 加權指數 {tx['close']:,.2f} 點 | 月線 20MA: {tx['ma20']:,.2f} | 季線 60MA: {tx['ma60']:,.2f} -> {tx_status}")

    # 2. 帳戶資產與持股水位
    print("\n💰 【帳戶資產與即時績效】:")
    print(f"  * 總資產淨值 (NAV):  {s['total_equity']:>14,.0f} 元 | 初始本金: {s['initial_capital']:>14,.0f} 元")
    print(f"  * 股票總市值:        {s['total_equity'] - s['current_cash']:>14,.0f} 元 | 總持股水位: {s['exposure_pct']:>6.1f}%")
    print(f"  * 可用現金儲備:      {s['current_cash']:>14,.0f} 元 | 現金儲備率: {s['cash_reserve_pct']:>6.1f}%")
    ret_sign = "+" if s['cum_return_pct'] >= 0 else ""
    print(f"  * 實盤累積報酬率:    {ret_sign}{s['cum_return_pct']:>13.2f}% | 當前歷史回撤: {s['drawdown_pct']:>6.2f}%")

    # 3. 持倉列表
    print("\n🛡️ 【在席持倉與停損防禦監控清單】:")
    if not s['positions']:
        print("  目前無任何持倉，現金 100% 待命中。")
    else:
        fmt = "  {:<4} {:<8} {:<15} {:>7} {:>7} {:>6} {:>10} {:>9} {:>6} {:>8} {:>6}  {}"
        print(fmt.format("代號", "名稱", "角色", "買價", "現價", "股數", "未實現損益", "報酬率", "佔比", "停損價", "距停損", "狀態與預警"))
        print("  " + "-"*92)
        for p in s['positions']:
            pnl_str = f"{p['unrealized_pnl']:+,.0f}"
            ret_str = f"{p['unrealized_ret_pct']:+.2f}%"
            dist_str = f"{p['dist_to_stop_pct']:+.1f}%"
            print(fmt.format(
                p['stock_id'],
                p['stock_name'][:4],
                p['role'][:12],
                f"{p['entry_price']:.1f}",
                f"{p['current_price']:.1f}",
                f"{p['shares']:,}",
                pnl_str,
                ret_str,
                f"{p['weight_pct']:.1f}%",
                f"{p['stop_loss_price']:.1f}",
                dist_str,
                p['alert']
            ))

    # 4. 已實現交易對帳
    th = s.get('trade_history', [])
    sells = [t for t in th if t['action'] == 'SELL']
    if sells:
        wins = [t for t in sells if t['realized_pnl'] > 0]
        wr = len(wins) / len(sells) * 100.0
        tot_realized = sum(t['realized_pnl'] for t in sells)
        w_sum = sum(t['realized_pnl'] for t in wins)
        l_sum = abs(sum(t['realized_pnl'] for t in sells if t['realized_pnl'] < 0))
        pf = w_sum / l_sum if l_sum > 0 else 0.0
        print("\n📊 【實盤已實現交易對帳】:")
        print(f"  * 總結算交易筆數: {len(sells)} 筆 | 實盤勝率: {wr:.1f}% | 實盤盈虧比: {pf:.2f}")
        print(f"  * 累積實現損益: {tot_realized:+,.0f} 元")

    print("\n" + "="*95)

def show_signals():
    """產出最新選股訊號與智慧下單張數試算"""
    port = LivePortfolio()
    port.recalculate()
    s = port.state
    tx = get_taiex_info()

    print("\n" + "="*95)
    print("🎯 【泰坦最新選股訊號與下單股數智慧試算】")
    print("="*95)

    if not tx['bullish']:
        print("⚠️ 【大盤風控提示】: 目前加權指數未站穩月線/季線，依策略風控規則【暫停開立任何新倉】！")
        return

    # 檢查席位空缺
    held_sids = {p['stock_id'] for p in s['positions']}
    has_leader = any('70%' in p.get('role', '') or '王者' in p.get('role', '') for p in s['positions'])
    nsat = sum(1 for p in s['positions'] if not ('70%' in p.get('role', '') or '王者' in p.get('role', '')))
    need_leader = not has_leader
    need_sat = max(0, 2 - nsat)

    print(f"[*] 當前在席持倉數: {len(s['positions'])} 檔 (王者泰坦: {'有' if has_leader else '缺位'}, 衛星部位: {nsat}/2 檔)")
    if not need_leader and need_sat == 0:
        print("[✓] 席位已全部滿載 (1王者 + 2衛星)，暫無新席位開倉需求，請安心續抱現有持股！")
        return

    # 讀取生產環境最新標的
    prod_pos_file = os.path.join(FRONTEND_DATA_DIR, 'titan_open_positions.json')
    if not os.path.exists(prod_pos_file):
        print("[!] 找不到生產環境候選標的檔！")
        return

    with open(prod_pos_file, 'r', encoding='utf-8') as f:
        prod_data = json.load(f)

    cands = prod_data.get('open_positions', [])
    tot_equity = s['total_equity']

    print(f"\n💡 【依據您實盤總資產 ({tot_equity:,.0f} 元) 之建議下單配置】:")
    print("  " + "-"*92)
    fmt = "  {:<4} {:<8} {:<15} {:>7} {:>12} {:>10} {:>10}  {}"
    print(fmt.format("代號", "名稱", "目標角色", "參考價", "目標配置金", "建議張數", "建議零股", "停損價指引"))
    print("  " + "-"*92)

    for c in cands:
        sid = c['stock_id']
        name = c['stock_name']
        is_leader_role = '70%' in c['role']
        if is_leader_role and not need_leader: continue
        if (not is_leader_role) and (need_sat <= 0): continue
        if sid in held_sids: continue

        target_pct = 70.0 if is_leader_role else 15.0
        alloc_amt = tot_equity * (target_pct / 100.0)
        px = c['current_price']
        total_shares = int(alloc_amt // px) if px > 0 else 0
        lots = total_shares // 1000
        odd_shares = total_shares % 1000

        print(fmt.format(
            sid, name[:4],
            "👑 王者泰坦 (70%)" if is_leader_role else "🚀 革命衛星 (15%)",
            f"{px:.1f}",
            f"{alloc_amt:,.0f} 元",
            f"{lots} 張",
            f"{odd_shares} 股",
            f"破 60MA ({c['ma60_stop_price']:.1f}元) 停損"
        ))

    print("  " + "-"*92)
    print("  💡 執行建議：週一 9:00 前以市價單或開盤撮合送出，成交後立即掛上停損單即可。")
    print("="*95)

def update_daily():
    """更新今日最新收盤價並結算淨值記錄"""
    port = LivePortfolio()
    today_str = datetime.date.today().strftime('%Y%m%d')
    port.recalculate()
    s = port.state

    # 記錄淨值歷史節點
    hist = s.setdefault('equity_history', [])
    if not hist or hist[-1]['date'] != today_str:
        hist.append({
            'date': today_str,
            'cash': s['current_cash'],
            'stock_value': round(s['total_equity'] - s['current_cash'], 2),
            'total_equity': s['total_equity'],
            'cum_return_pct': s['cum_return_pct'],
            'exposure_pct': s['exposure_pct']
        })
    else:
        hist[-1] = {
            'date': today_str,
            'cash': s['current_cash'],
            'stock_value': round(s['total_equity'] - s['current_cash'], 2),
            'total_equity': s['total_equity'],
            'cum_return_pct': s['cum_return_pct'],
            'exposure_pct': s['exposure_pct']
        }

    port.save_state()
    print(f"[✓] 今日結算完成！最新總淨值：{s['total_equity']:,.0f} 元 (累積報酬：{s['cum_return_pct']:+.2f}%)，數據已同步至前端！")

# =========================================================================
# 互動式引導選單
# =========================================================================
def interactive_menu():
    port = LivePortfolio()
    while True:
        print("\n" + "="*50)
        print("👑 【泰坦實盤監控與對帳系統 (TITAN Monitor)】")
        print("="*50)
        print("  1. 📊 查看今日戰情室與持倉停損監控 (Status)")
        print("  2. 🎯 查看最新選股訊號與下單股數試算 (Signals)")
        print("  3. ➕ 記錄買進成交 (Buy Trade)")
        print("  4. ➖ 記錄賣出成交 (Sell Trade)")
        print("  5. 💰 校準現金水位 / 出入金 (Cash Management)")
        print("  6. 🔄 更新最新市價並結算今日淨值 (Update NAV)")
        print("  7. 🚪 退出系統")
        print("="*50)
        choice = input("請選擇操作功能 [1-7]: ").strip()

        if choice == '1':
            show_status()
        elif choice == '2':
            show_signals()
        elif choice == '3':
            sid = input("請輸入股票代號 (如 2408): ").strip()
            px = float(input("請輸入成交價格 (元): ").strip())
            sh = int(input("請輸入成交股數 (如 1000): ").strip())
            role_in = input("請選擇角色 (1: 王者泰坦 70%, 2: 革命衛星 15%, 直接按 Enter 自動推斷): ").strip()
            role = '👑 王者泰坦 (70%)' if role_in == '1' else ('🚀 革命衛星 (15%)' if role_in == '2' else None)
            port.record_buy(sid, px, sh, role)
        elif choice == '4':
            sid = input("請輸入平倉股票代號: ").strip()
            px = float(input("請輸入成交賣價 (元): ").strip())
            sh_in = input("請輸入賣出股數 (直接按 Enter 全數賣出): ").strip()
            sh = int(sh_in) if sh_in else None
            rs = input("請輸入賣出原因 (如 跌破季線停損 / 保本停損 / 移動停利): ").strip()
            port.record_sell(sid, px, sh, rs or "平倉賣出")
        elif choice == '5':
            print("  1. 直接設定目前帳戶現金餘額 (Set Cash)")
            print("  2. 帳戶入金 (Deposit)")
            print("  3. 帳戶出金 (Withdraw)")
            sub_c = input("請選擇 [1-3]: ").strip()
            if sub_c == '1':
                amt = float(input("請輸入最新現金餘額 (元): ").strip())
                port.adjust_cash(set_amount=amt)
            elif sub_c == '2':
                amt = float(input("請輸入存入金額 (元): ").strip())
                port.adjust_cash(deposit=amt)
            elif sub_c == '3':
                amt = float(input("請輸入提領金額 (元): ").strip())
                port.adjust_cash(withdraw=amt)
        elif choice == '6':
            update_daily()
        elif choice == '7':
            print("\n感謝使用，祝交易順利、穩健複利！")
            break
        else:
            print("[x] 無效輸入，請重新選擇。")

# =========================================================================
# 命令列解析 (CLI Argument Parsing)
# =========================================================================
def main():
    parser = argparse.ArgumentParser(description="👑 泰坦實盤每日監控與對帳系統")
    parser.add_argument('action', nargs='?', choices=['status', 'signal', 'buy', 'sell', 'cash', 'update', 'menu'], help="執行動作")
    parser.add_argument('--id', type=str, help="股票代號")
    parser.add_argument('--price', type=float, help="成交價格")
    parser.add_argument('--shares', type=int, help="成交股數")
    parser.add_argument('--role', type=str, choices=['leader', 'satellite'], help="角色配置")
    parser.add_argument('--reason', type=str, default="平倉賣出", help="賣出原因")
    parser.add_argument('--set', type=float, help="設定現金金額")
    parser.add_argument('--deposit', type=float, help="入金金額")
    parser.add_argument('--withdraw', type=float, help="出金金額")
    parser.add_argument('--capital', type=float, help="初始化初始本金")

    args = parser.parse_args()

    if args.action is None or args.action == 'menu':
        interactive_menu()
    elif args.action == 'status':
        show_status()
    elif args.action == 'signal':
        show_signals()
    elif args.action == 'update':
        update_daily()
    elif args.action == 'buy':
        if not args.id or not args.price or not args.shares:
            print("[x] 買進錯誤：必須提供 --id, --price, --shares 參數！")
            return
        role_map = {'leader': '👑 王者泰坦 (70%)', 'satellite': '🚀 革命衛星 (15%)'}
        role = role_map.get(args.role) if args.role else None
        port = LivePortfolio()
        port.record_buy(args.id, args.price, args.shares, role)
    elif args.action == 'sell':
        if not args.id or not args.price:
            print("[x] 賣出錯誤：必須提供 --id, --price 參數！")
            return
        port = LivePortfolio()
        port.record_sell(args.id, args.price, args.shares, args.reason)
    elif args.action == 'cash':
        port = LivePortfolio()
        port.adjust_cash(deposit=args.deposit, withdraw=args.withdraw, set_amount=args.set)

if __name__ == '__main__':
    main()
