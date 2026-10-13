import sys
import sqlite3
import pandas as pd
import numpy as np
import test_hybrid_sl_tp as th

month_plans = th.month_plans
stk_adj = th.stk_adj
stk_open = th.stk_open
stk_ma60 = th.stk_ma60
month_ends = th.month_ends

def run_three_stage_titan(
    hard_sl_pct=0.25,        # 初始硬停損 -25% (或 None)
    use_ma60_stop=True,      # 跌破 60MA 季線停損
    be_trigger=0.15,         # 浮盈達 +15% 鎖定保本
    trail_trigger=0.50,      # 浮盈達 +50% 啟動移動停利
    trail_dd=0.20            # 自最高點回吐 20% 停利
):
    capital = 1000000.0
    equity = [capital]
    dates = [month_ends[0]]
    friction = 0.0015
    trades_list = []
    target_weights = [0.40, 0.30, 0.30]

    for plan in month_plans:
        next_month_end = plan['next_month_end']
        if not plan['macro_ok'] or len(plan['picks']) == 0:
            equity.append(capital)
            dates.append(next_month_end)
            continue

        picks = plan['picks']
        t_entry = plan['t_entry']
        sub_dates = plan['sub_dates']

        n_pick = len(picks)
        active_weights = target_weights[:n_pick]
        tot_w = sum(active_weights)
        active_weights = [w / tot_w for w in active_weights]

        slot_returns = []
        for s_idx, sym in enumerate(picks):
            w = active_weights[s_idx]
            p_entry = stk_open.loc[t_entry, sym] if sym in stk_open.columns else None
            if pd.isna(p_entry) or p_entry <= 0:
                p_entry = stk_adj.loc[sub_dates[0], sym]

            peak_px = p_entry
            exit_px = None
            exit_date = None
            exit_reason = "月底換股"

            for d_idx, cur_d in enumerate(sub_dates):
                cur_close = stk_adj.loc[cur_d, sym] if sym in stk_adj.columns else None
                m6 = stk_ma60.loc[cur_d, sym] if sym in stk_ma60.columns else None
                if pd.isna(cur_close) or cur_close <= 0: continue

                if cur_close > peak_px:
                    peak_px = cur_close

                cur_gain = cur_close / p_entry - 1.0
                max_gain = peak_px / p_entry - 1.0

                # 階段 3: 爆賺主升段 (+50% 以上) ➔ 移動停利鎖定 (回吐 20%)
                if trail_trigger and max_gain >= trail_trigger:
                    dd_from_peak = cur_close / peak_px - 1.0
                    if dd_from_peak <= -trail_dd:
                        exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"🚀+50%移動停利 (峰值+{max_gain*100:.1f}%, 回吐{trail_dd*100:.0f}%)"
                        break

                # 階段 2: 初步獲利 (+15% 以上) ➔ 保本平手鎖定線
                elif be_trigger and max_gain >= be_trigger:
                    if cur_gain <= 0.01:
                        exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"🛡️+15%保本鎖利線 (回測成本平手出場)"
                        break

                # 階段 1: 剛建倉初期 ➔ 跌破 60MA 季線 或 硬停損 (-25%)
                else:
                    if use_ma60_stop and pd.notna(m6) and cur_close < m6:
                        exit_px = cur_close; exit_date = cur_d
                        exit_reason = "⚡跌破60MA季線停損"
                        break
                    if hard_sl_pct and cur_gain <= -hard_sl_pct:
                        exit_px = cur_close; exit_date = cur_d
                        exit_reason = f"⚡硬停損線 (-{hard_sl_pct*100:.0f}%)"
                        break

            if exit_px is None:
                last_d = sub_dates[-1]
                exit_px = stk_open.loc[last_d, sym] if pd.notna(stk_open.loc[last_d, sym]) else stk_adj.loc[last_d, sym]
                exit_date = last_d

            ret_trade = (exit_px / p_entry - 1.0) - friction
            slot_returns.append(ret_trade * w)
            trades_list.append({
                'ticker': sym, 'ret': ret_trade * 100.0, 'reason': exit_reason
            })

        period_net_ret = sum(slot_returns)
        capital *= (1.0 + period_net_ret)
        equity.append(capital)
        dates.append(next_month_end)

    eq_s = pd.Series(equity, index=dates)
    mult = eq_s.iloc[-1] / eq_s.iloc[0]
    years = (dates[-1] - dates[0]).days / 365.25
    cagr = (mult ** (1.0 / years) - 1.0) * 100.0
    mdd = ((eq_s - eq_s.cummax()) / eq_s.cummax()).min() * 100.0
    monthly_ret = eq_s.pct_change().dropna()
    rf = 0.02 / 12.0
    excess_ret = monthly_ret - rf
    sharpe = (excess_ret.mean() / (monthly_ret.std() + 1e-9)) * np.sqrt(12)
    calmar = cagr / abs(mdd) if abs(mdd) > 0 else 0

    df_tr = pd.DataFrame(trades_list)
    win_rate = (df_tr['ret'] > 0).mean() * 100.0
    worst_tr = df_tr['ret'].min()
    best_tr = df_tr['ret'].max()

    return {
        'cagr': cagr, 'mult': mult, 'mdd': mdd, 'calmar': calmar, 'sharpe': sharpe,
        'win_rate': win_rate, 'worst_tr': worst_tr, 'best_tr': best_tr,
        'trades': df_tr
    }

# 執行三階梯動態風控
r_base = run_three_stage_titan(hard_sl_pct=None, use_ma60_stop=False, be_trigger=None, trail_trigger=None)
r_3stage_25 = run_three_stage_titan(hard_sl_pct=0.25, use_ma60_stop=True, be_trigger=0.15, trail_trigger=0.50, trail_dd=0.20)
r_3stage_20 = run_three_stage_titan(hard_sl_pct=0.20, use_ma60_stop=True, be_trigger=0.15, trail_trigger=0.50, trail_dd=0.20)
r_3stage_noma = run_three_stage_titan(hard_sl_pct=0.25, use_ma60_stop=False, be_trigger=0.20, trail_trigger=0.50, trail_dd=0.20)

print("\n=== 三階梯動態停損停利 (Three-Stage Dynamic Stop/Profit) 對比 ===")
for name, r in [
    ("現狀基準 (無日內停損停利)", r_base),
    ("三階梯 A (-25%底線 + 破60MA + +15%保本 + +50%移動鎖利)", r_3stage_25),
    ("三階梯 B (-20%底線 + 破60MA + +15%保本 + +50%移動鎖利)", r_3stage_20),
    ("三階梯 C (-25%底線 + +20%保本 + +50%移動鎖利，不用60MA)", r_3stage_noma)
]:
    print(f"[{name:<50}] CAGR: {r['cagr']:>5.2f}% | 累積: {r['mult']:>7.1f}x | MDD: {r['mdd']:>6.2f}% | Calmar: {r['calmar']:>5.3f} | 最慘單筆: {r['worst_tr']:>6.2f}%")
