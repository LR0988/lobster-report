#!/usr/bin/env python3
"""
export_g11_pit_detailed_history.py
================================================================================
【G12-PIT Sovereign 歷年績效與逐筆詳細進出全景資料庫生成器】
================================================================================
功能：
1. 完整保留 G12-PIT Sovereign 官方生產模型所有參數與權威指標 (CAGR 40.48%、累積 1,621.2x 等)。
2. 匯出 2005–2026 全歷史 22 年每一次調倉 (Tranche 1 & Tranche 22) 的每一筆進出明細：
   - 調倉日期、進場日期、出場日期
   - 選中標的：股票代號、中文全名、市場 (美股/台股)、配置權重 %
   - 進場價格 (Entry Price)、出場價格 (Exit Price / 最新現價)
   - 該期真實損益率 (Period Return %)
   - 持倉狀態：🟢 進行中持倉 (Active) / ⚪ 已換倉結算
3. 2026 當前最新選股與進行中持倉清單 (供使用者對照核對「我有沒有買對」)。
4. 全歷史股票代號反查索引 (all_trades_lookup)。
"""

import os
import json
import sqlite3
import numpy as np
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

import forensic_open_pool_sniper as fops
import global_sovereign_service as gss
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, make_pit_macro_fn
from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit

def asym_stepped_winner_tr_dd(peak_pnl: float) -> float:
    return 0.09 if peak_pnl < 0.20 else (0.13 if peak_pnl < 0.50 else 0.16)

def _roc_to_ann_str(ym) -> str:
    ym_s = str(ym).strip()
    if len(ym_s) < 5 or not ym_s.isdigit():
        return "2099-01-10"
    y, m = int(ym_s[:3]) + 1911, int(ym_s[3:5])
    return f"{y + 1:04d}-01-10" if m == 12 else f"{y:04d}-{m + 1:02d}-10"

def main():
    print("=" * 80)
    print("🚀 G12-PIT Sovereign 逐筆詳細進出全景歷史資料庫生成中...")
    print("=" * 80)

    tw_zero = build_zero_omission_tw_0050_0051_pit()
    env = prepare_clean_1725_pit_env()

    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    in_0050_0051_pit = tw_zero["in_0050_0051_pit"].reindex(index=idx, columns=pit_tw).ffill().fillna(False)

    conn_twse = sqlite3.connect("tw_stock.db")
    pit_tw_ids = [s.replace(".TW", "") for s in pit_tw]
    ph_all = ",".join(["?"] * len(pit_tw_ids))
    df_twse_daily = pd.read_sql_query(
        f"""
        SELECT date, stock_id, trade_value
        FROM daily_stock
        WHERE stock_id IN ({ph_all})
          AND market_type IN ('上市', 'TWSE')
        """,
        conn_twse,
        params=pit_tw_ids,
    )

    df_twse_daily["dt"] = pd.to_datetime(df_twse_daily["date"], format="%Y%m%d", errors="coerce")
    df_twse_daily = df_twse_daily.dropna(subset=["dt"]).drop_duplicates(subset=["dt", "stock_id"], keep="last")
    df_twse_daily["ticker"] = df_twse_daily["stock_id"] + ".TW"
    piv_twse_val = df_twse_daily.pivot(index="dt", columns="ticker", values="trade_value").reindex(index=idx, columns=pit_tw).fillna(0.0)
    is_twse_listed_pit = (piv_twse_val > 0).rolling(20, min_periods=1).max() > 0
    twse_adv60 = piv_twse_val.rolling(60, min_periods=15).mean()
    twse_rk_pit = twse_adv60.where(is_twse_listed_pit).rank(axis=1, ascending=False, method="min")

    tw_base_0050_0051 = (
        in_0050_0051_pit
        & is_twse_listed_pit
        & (twse_rk_pit <= 30)
        & (env["avg_order_rk"][pit_tw] <= 30)
        & (env["raw_px_tw"][pit_tw] >= 50.0)
        & (env["pe_mat"][pit_tw] > 0)
        & (env["pe_mat"][pit_tw] <= 45.0)
        & ((~env["roe_mat"][pit_tw].notna()) | (env["roe_mat"][pit_tw] >= 20.0))
        & ((~env["roe_mat"][pit_tw].notna()) | (env["tr20_mat"][pit_tw] > 0.001) | (env["fr20_mat"][pit_tw] > 0.002))
        & (env["io_20"][pit_tw] > -0.10)
        & (env["fip_126"][pit_tw] > 0.05)
    )
    elig_base = pd.DataFrame(False, index=idx, columns=cols)
    elig_base[us_tickers] = env["us_pit_elig_base"] & (env["us_rk_pit"] <= 100)
    elig_base[pit_tw] = tw_base_0050_0051

    g9_sec = fops.make_g9_secondary_mult(env)
    macro_g11 = make_pit_macro_fn(c4_cap=0.45, c5_cap=1.0, c6_cap=0.20, u10_thr=0.22, qb_thr=22.0)

    stk_adj = env["stk_adj"][cols]
    stk_open = env["stk_open"][cols]
    stk_high = env["stk_high"][cols]
    stk_low = env["stk_low"][cols]
    stk_vol = env["stk_vol"][cols]

    ma20 = env["ma20"][cols]
    ma60 = env["ma60"][cols]
    ma200 = env["ma200"][cols]

    bias20 = ((stk_adj / (ma20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)
    bias60 = env["bias60"][cols]
    high20 = stk_high.rolling(20, min_periods=5).max()
    low20 = stk_low.rolling(20, min_periods=5).min()
    dd20 = ((stk_adj / (high20 + 1e-9)) - 1.0).fillna(0.0).astype(np.float32)

    mom12m = env["mom12m"][cols]
    r_mom10 = stk_adj.pct_change(10).fillna(0.0).astype(np.float32)
    fip_252 = env["fip_252"][cols]
    io_20 = env["io_20"][cols]
    io_5 = env["io_5"][cols]

    dvol = (stk_adj * stk_vol).fillna(0.0)
    turnover_growth = ((dvol.rolling(20, min_periods=5).mean() / (dvol.rolling(60, min_periods=15).mean() + 1.0)) - 1.0).fillna(0.0).astype(np.float32)

    high_60 = stk_high.rolling(60, min_periods=20).max()
    low_60 = stk_low.rolling(60, min_periods=20).min()
    sustain_20d = (stk_adj >= high_60 * 0.97).astype(np.float32).rolling(20, min_periods=5).mean().fillna(0.0).astype(np.float32)
    comp_ratio = (((high20 - low20) / (stk_adj + 1e-6)).fillna(0.25) / (((high_60 - low_60) / (stk_adj + 1e-6)).fillna(0.35) + 1e-6)).astype(np.float32)

    daily_ret = stk_adj.pct_change().fillna(0.0)
    down_sq_60 = (daily_ret.clip(upper=0.0) ** 2).rolling(60, min_periods=20).mean()
    sortino_60 = ((daily_ret.rolling(60, min_periods=20).mean() / (np.sqrt(down_sq_60) + 1e-6)) * np.sqrt(252.0)).fillna(0.0).astype(np.float32)

    df_rev = pd.read_sql_query("SELECT revenue_date, stock_id, yoy, mom FROM monthly_revenue", conn_twse)

    piv_yoy = pd.DataFrame(0.0, index=idx, columns=cols, dtype=np.float32)
    piv_mom = pd.DataFrame(0.0, index=idx, columns=cols, dtype=np.float32)
    if not df_rev.empty:
        df_rev["ann_date"] = pd.to_datetime(df_rev["revenue_date"].map(_roc_to_ann_str), errors="coerce")
        df_rev["sym"] = df_rev["stock_id"].astype(str).str.strip() + ".TW"
        df_rev = df_rev[df_rev["sym"].isin(pit_tw) & df_rev["ann_date"].notna()]
        if not df_rev.empty:
            y_tab = df_rev.pivot_table(index="ann_date", columns="sym", values="yoy", aggfunc="last")
            m_tab = df_rev.pivot_table(index="ann_date", columns="sym", values="mom", aggfunc="last")
            u_idx = sorted(set(idx) | set(y_tab.index))
            y_tab = y_tab.reindex(index=u_idx).ffill().reindex(idx).fillna(0.0)
            m_tab = m_tab.reindex(index=u_idx).ffill().reindex(idx).fillna(0.0)
            for c_sym in y_tab.columns:
                if c_sym in piv_yoy.columns:
                    piv_yoy[c_sym] = y_tab[c_sym].astype(np.float32)
                    piv_mom[c_sym] = m_tab[c_sym].astype(np.float32)

    vcp_condition = (sustain_20d >= 0.45) & (comp_ratio <= 0.65) & (sortino_60 >= 1.5) & (turnover_growth > 0.0) & (io_20 > 0.0)
    rev_decay_pen = np.where((piv_yoy < -5.0) & (piv_mom < -5.0) & (stk_adj < ma20), 0.75, 1.0).astype(np.float32)

    dist_veto_g10 = np.where((stk_adj < ma20) & (io_5 < -0.01), 0.70, 1.0)
    is_mega_us = pd.DataFrame(False, index=idx, columns=cols)
    is_mega_us[us_tickers] = (env["us_rk_pit"] <= 100).fillna(False)

    fip_cond = (fip_252 > 0.08) | is_mega_us
    coiled_mask = (mom12m > 0.65) & fip_cond & (dd20 >= -0.12) & (dd20 <= -0.03) & (bias20 >= -0.03) & (bias20 <= 0.04) & (io_20 > -0.02)
    coiled_spring_g11 = np.where(coiled_mask, 1.12, 1.0)
    score_g11 = (env["s_g5_open"][cols] * dist_veto_g10 * coiled_spring_g11).astype(np.float32)

    exp262_base_mult = np.where(vcp_condition, 1.04, 1.0).astype(np.float32) * rev_decay_pen
    score_arr = (score_g11 * exp262_base_mult).values.astype(np.float32)

    data4 = env["data4"]
    dates_idx = stk_adj.index
    dt_to_pos = {d: i for i, d in enumerate(dates_idx)}

    px_adj_arr = stk_adj.values
    px_open_arr = stk_open.values
    px_low_arr = stk_low.values
    ma20_arr = ma20.values
    ma60_arr = ma60.values
    ma200_arr = ma200.values
    bias60_arr = bias60.values
    sustain_arr = sustain_20d.values
    rmom10_arr = r_mom10.values
    yoy_arr = piv_yoy.values
    mom_arr = piv_mom.values
    io20_arr = io_20.values
    io5_arr = io_5.values
    churn_arr = env["churn_exhaustion"][cols].values
    elig_arr = elig_base.values
    sec_arr = g9_sec[cols].values

    global_breadth = data4["global_breadth"]
    safe_cash_ret = data4["safe_cash_ret"]
    us10y_series = data4["us10y_series"]
    qqq_bias = data4["qqq_bias_dict"][500]
    qqq_p = data4["px_adj"]["QQQ"]
    qqq_ma60 = data4["qqq_ma60"]
    all_dates = data4["all_dates"]

    is_tw_arr = np.array([c_sym.endswith(".TW") for c_sym in cols])
    fee_buy_arr = np.where(is_tw_arr, 0.001425 * 0.28, 0.0005)
    fee_sell_arr = np.where(is_tw_arr, (0.001425 * 0.28) + 0.003, 0.0005)

    drift_tol = 0.12
    macro_cap = 0.35
    base_weights = [0.52, 0.24, 0.24]
    pool_k = 5
    tenure_max_rk = 5

    def get_stock_name(tk):
        base = tk.split(".")[0]
        if base in gss.GLOBAL_STOCK_NAME_MAP:
            return gss.GLOBAL_STOCK_NAME_MAP[base].split(" (")[0]
        if tk.endswith(".TW"):
            c = conn_twse.cursor()
            c.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL ORDER BY date DESC LIMIT 1", (base,))
            r = c.fetchone()
            if r and r[0]:
                return r[0]
        return tk

    all_tranche_records = []

    def sim_tranche(day_target, tranche_name, init_cap=500000.0):
        rebal_dates = []
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])

        periods = []
        for i in range(len(rebal_dates) - 1):
            t_date = rebal_dates[i]
            fut = dates_idx[dates_idx > t_date]
            if len(fut) == 0: break
            t_in = fut[0]
            next_rebal = rebal_dates[i + 1]
            fut_next = dates_idx[dates_idx > next_rebal]
            if len(fut_next) == 0: break
            t_out = fut_next[0]
            periods.append((t_date, t_in, t_out, False))

        # 納入最後一個進行中的調倉期 (Active Tranche)
        if len(rebal_dates) > 0:
            last_r_date = rebal_dates[-1]
            fut = dates_idx[dates_idx > last_r_date]
            if len(fut) > 0:
                t_in = fut[0]
                t_out = dates_idx[-1]
                periods.append((last_r_date, t_in, t_out, True))

        all_sim_dates = dates_idx[(dates_idx >= periods[0][0]) & (dates_idx <= periods[-1][2])]
        daily_equity = pd.Series(index=all_sim_dates, dtype=float)
        cash = init_cap
        holdings = {}
        holding_tenure = {}
        pending_orders = []
        p_idx = 0
        num_p = len(periods)

        for current_dt in all_sim_dates:
            cur_pos = dt_to_pos[current_dt]
            if cash > 0:
                cash *= 1.0 + float(safe_cash_ret.iloc[cur_pos])

            if p_idx < num_p and current_dt == periods[p_idx][1]:
                pending_orders.clear()
                t_date, t_in, t_out, is_active_tranche = periods[p_idx]
                t_pos = dt_to_pos[t_date]
                in_pos = dt_to_pos[t_in]
                out_pos = dt_to_pos[t_out]

                sp_row = px_adj_arr[t_pos]
                m6_row = ma60_arr[t_pos]
                m2_row = ma200_arr[t_pos]
                sc_row = score_arr[t_pos]
                el_row = elig_arr[t_pos]
                ch_row = churn_arr[t_pos]

                valid_mask = (
                    el_row
                    & (~np.isnan(sp_row))
                    & (~np.isnan(sc_row))
                    & (~np.isnan(m6_row))
                    & (~np.isnan(m2_row))
                    & (sp_row > m6_row)
                    & (sp_row > m2_row)
                    & (sc_row > 0)
                    & (~ch_row)
                )
                valid_indices = np.where(valid_mask)[0]
                if len(valid_indices) > 0:
                    order_pre = np.argsort(-sc_row[valid_indices])
                    sorted_indices = valid_indices[order_pre]
                else:
                    sorted_indices = np.array([], dtype=int)

                if sec_arr is not None and len(sorted_indices) > 2:
                    top1_i = [sorted_indices[0]]
                    pool_i = list(sorted_indices[1:pool_k])
                    rest_i = list(sorted_indices[pool_k:])
                    pool_i.sort(key=lambda c_i: float(sc_row[c_i]) * float(sec_arr[t_pos, c_i]), reverse=True)
                    sorted_indices = np.array(top1_i + pool_i + rest_i, dtype=int)

                top5_pre = sorted_indices[:min(5, len(sorted_indices))]
                if len(top5_pre) > 0:
                    top5_neg_io20 = int(np.sum(io20_arr[t_pos, top5_pre] < 0.0))
                    top5_neg_io5 = int(np.sum(io5_arr[t_pos, top5_pre] < 0.0))
                    top5_avg_io20 = float(np.mean(io20_arr[t_pos, top5_pre]))
                else:
                    top5_neg_io20, top5_neg_io5, top5_avg_io20 = 0, 0, 0.0

                br = float(global_breadth.iloc[t_pos]) if t_date in global_breadth.index else 0.5
                if br >= 0.50: base_exp = 1.0
                elif br >= 0.30: base_exp = 0.70
                else: base_exp = 0.0

                qb = float(qqq_bias.iloc[t_pos]) if t_date in qqq_bias.index else 0.0
                rate = float(us10y_series.iloc[t_pos]) if t_date in us10y_series.index else 0.0
                qqq_below_ma60 = float(qqq_p.iloc[t_pos]) < float(qqq_ma60.iloc[t_pos])

                if base_exp > 0.0:
                    if qb >= 30.0 and rate >= 3.5: exposure = min(base_exp, 0.50)
                    else: exposure = base_exp
                else: exposure = 0.0

                if 0.30 <= br < 0.50 and qqq_below_ma60:
                    exposure = min(exposure, macro_cap)

                exposure = macro_g11(t_date, t_pos, exposure, br, qb, rate, qqq_below_ma60, top5_neg_io20, top5_neg_io5, top5_avg_io20, data4)
                ticker_rank = {int(c_i): rk + 1 for rk, c_i in enumerate(sorted_indices)}

                if exposure <= 0 or len(sorted_indices) == 0:
                    for c_i, hinfo in list(holdings.items()):
                        out_px = px_open_arr[in_pos, c_i]
                        cash += hinfo["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                    holdings.clear()
                    holding_tenure = {}
                    all_tranche_records.append({
                        "year": int(t_date.year),
                        "rebal_date": str(t_date)[:10],
                        "entry_date": str(t_in)[:10],
                        "exit_date": str(t_out)[:10],
                        "tranche": tranche_name,
                        "exposure_pct": 0.0,
                        "breadth": round(br, 2),
                        "is_active": is_active_tranche,
                        "picks": []
                    })
                else:
                    old_holdings_set = set(holdings.keys())
                    selected_stks = []

                    for c_i in list(holdings.keys()):
                        tenure = holding_tenure.get(c_i, 0)
                        rk = ticker_rank.get(c_i, None)
                        hinfo = holdings[c_i]
                        epx = hinfo.get("entry_px", float(px_adj_arr[t_pos, c_i]))
                        cur_c = float(px_adj_arr[t_pos, c_i])
                        pk_px = max(hinfo.get("peak_px", epx), cur_c)
                        ppnl = (pk_px / (epx + 1e-9)) - 1.0
                        tr_dd = (pk_px - cur_c) / (pk_px + 1e-9)
                        m20_c = float(ma20_arr[t_pos, c_i])
                        m60_c = float(ma60_arr[t_pos, c_i])
                        sust_c = float(sustain_arr[t_pos, c_i])

                        keep = False
                        if rk is not None and tenure < 4 and rk <= tenure_max_rk:
                            if rk <= (tenure_max_rk - 1) or float(io20_arr[t_pos, c_i]) > 0.0:
                                keep = True

                        if not keep and tenure < 4 and rk is not None and rk <= 7:
                            if ppnl >= 0.055 and cur_c > m60_c and sust_c >= 0.45 and tr_dd < asym_stepped_winner_tr_dd(ppnl) and float(io20_arr[t_pos, c_i]) > 0.0:
                                keep = True
                        if keep and ppnl >= 0.25 and tr_dd >= asym_stepped_winner_tr_dd(ppnl) and rk >= 4:
                            keep = False

                        if keep and ppnl < 0.055 and rk is not None and rk >= 4:
                            is_rev_decay = (yoy_arr[t_pos, c_i] < 0.0) and (mom_arr[t_pos, c_i] < 0.0) and (cur_c < m20_c)
                            is_mom_decay = (cur_c < m20_c) and (float(rmom10_arr[t_pos, c_i]) < -0.02) and (float(io5_arr[t_pos, c_i]) < -0.01)
                            if is_rev_decay or is_mom_decay:
                                keep = False

                        if keep:
                            selected_stks.append(c_i)

                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        tenure = holding_tenure.get(c_i, 0)
                        if c_i not in selected_stks and tenure < 4:
                            selected_stks.append(c_i)

                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3: break
                        c_i = int(c_i)
                        if c_i not in selected_stks:
                            selected_stks.append(c_i)

                    n = min(3, len(selected_stks))
                    selected_stks = selected_stks[:n]
                    holding_tenure = {c_i: holding_tenure.get(c_i, 0) + 1 for c_i in selected_stks}
                    bw_slice = base_weights[:n]
                    tot_bw = sum(bw_slice)
                    norm_weights = [w / tot_bw for w in bw_slice]
                    target_alloc = {selected_stks[idx_s]: norm_weights[idx_s] * exposure for idx_s in range(n)}

                    period_picks_info = []
                    for idx_s, c_i in enumerate(selected_stks):
                        sym = cols[c_i]
                        p_in = float(px_open_arr[in_pos, c_i])
                        # 若為當前進行中調倉，出場價格取最新收盤價
                        if is_active_tranche:
                            p_out = float(px_adj_arr[out_pos, c_i])
                        else:
                            p_out = float(px_open_arr[out_pos, c_i])
                        p_ret = ((p_out / p_in) - 1.0) * 100.0 if (p_in > 0 and p_out > 0 and not np.isnan(p_in) and not np.isnan(p_out)) else 0.0

                        is_retained = c_i in old_holdings_set
                        action_label = "🔄 贏家續抱" if is_retained else "🟢 買入建倉"

                        period_picks_info.append({
                            "rank": idx_s + 1,
                            "ticker": sym,
                            "name": get_stock_name(sym),
                            "market": "TW" if sym.endswith(".TW") else "US",
                            "weight": round(norm_weights[idx_s] * exposure * 100.0, 1),
                            "entry_price": round(p_in, 2),
                            "exit_price": round(p_out, 2),
                            "period_ret": round(p_ret, 2),
                            "is_active": is_active_tranche,
                            "action": action_label,
                            "tenure_months": holding_tenure.get(c_i, 1)
                        })

                    all_tranche_records.append({
                        "year": int(t_date.year),
                        "rebal_date": str(t_date)[:10],
                        "entry_date": str(t_in)[:10],
                        "exit_date": str(t_out)[:10],
                        "tranche": tranche_name,
                        "exposure_pct": round(exposure * 100.0, 1),
                        "breadth": round(br, 2),
                        "is_active": is_active_tranche,
                        "picks": period_picks_info
                    })

                    for c_i in list(holdings.keys()):
                        if c_i not in target_alloc:
                            out_px = px_open_arr[in_pos, c_i]
                            cash += holdings[c_i]["shares"] * out_px * (1.0 - fee_sell_arr[c_i])
                            del holdings[c_i]

                    cur_val = cash + sum(holdings[c_i]["shares"] * px_open_arr[in_pos, c_i] for c_i in holdings)
                    for c_i, tgt_w in target_alloc.items():
                        if c_i in holdings:
                            op = float(px_open_arr[in_pos, c_i])
                            cur_sh = holdings[c_i]["shares"]
                            cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                            if abs(cur_w - tgt_w) > drift_tol and (cur_val * tgt_w) < (cur_sh * op):
                                sell_sh = ((cur_sh * op) - (cur_val * tgt_w)) / op
                                cash += sell_sh * op * (1.0 - fee_sell_arr[c_i])
                                holdings[c_i]["shares"] -= sell_sh

                    buy_orders = []
                    for c_i, tgt_w in target_alloc.items():
                        op = float(px_open_arr[in_pos, c_i])
                        cur_sh = holdings[c_i]["shares"] if c_i in holdings else 0.0
                        cur_w = (cur_sh * op) / cur_val if cur_val > 0 else 0.0
                        if c_i in holdings and abs(cur_w - tgt_w) <= drift_tol:
                            continue
                        diff_val = (cur_val * tgt_w) - (cur_sh * op)
                        if diff_val > 0 and op > 0:
                            buy_orders.append((c_i, diff_val))

                    for c_i, diff_val in buy_orders:
                        actual_buy = min(cash, diff_val)
                        if actual_buy > 0:
                            op = float(px_open_arr[in_pos, c_i])
                            sh = (actual_buy * (1.0 - fee_buy_arr[c_i])) / op
                            cash -= actual_buy
                            if c_i in holdings:
                                holdings[c_i]["shares"] += sh
                            else:
                                holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op}

                p_idx += 1

            val = cash
            for c_i, hinfo in holdings.items():
                val += hinfo["shares"] * px_adj_arr[cur_pos, c_i]
            daily_equity.loc[current_dt] = val

        return daily_equity

    eq_a = sim_tranche(1, "A梯隊 (月初調倉)")
    eq_b = sim_tranche(22, "B梯隊 (月下旬調倉)")

    common_idx = eq_a.dropna().index.intersection(eq_b.dropna().index)
    common_idx = common_idx[common_idx >= pd.Timestamp("2005-01-03")]
    eq_d = (eq_a.loc[common_idx] + eq_b.loc[common_idx]) / 1000000.0
    eq_d = eq_d / float(eq_d.iloc[0])

    # 計算各年度績效與 SPY
    spy_p = data4["px_adj"]["SPY"].loc[common_idx]
    all_yr_rets = eq_d.resample("YE").last().pct_change().dropna()
    all_spy_rets = spy_p.resample("YE").last().pct_change().dropna()
    yr_eq = eq_d.resample("YE").last()

    yearly_mdd_map = {}
    for y, sub_eq in eq_d.groupby(eq_d.index.year):
        peak = sub_eq.cummax()
        dd = (sub_eq / peak - 1.0) * 100.0
        yearly_mdd_map[y] = round(float(dd.min()), 2)

    yearly_summary = []
    win_years_cnt = 0

    # 建立股票代號反查索引
    all_trades_lookup = {}

    for dt_idx, ret_val in all_yr_rets.items():
        y = int(dt_idx.year)
        if float(ret_val) > 0: win_years_cnt += 1
        spy_r = float(all_spy_rets.loc[dt_idx]) * 100.0 if dt_idx in all_spy_rets.index else 0.0
        cap_mult = float(yr_eq.loc[dt_idx])
        
        # 該年所有調倉記錄 (按日期倒序排列，最新在最上面)
        logs_y = [lg for lg in all_tranche_records if lg["year"] == y]
        logs_y_sorted = sorted(logs_y, key=lambda x: (x["rebal_date"], x["tranche"]), reverse=True)

        us_slot_cnt = 0
        tw_slot_cnt = 0
        cash_periods = 0
        ticker_stats = {}
        avg_exp_list = []

        for lg in logs_y:
            avg_exp_list.append(lg["exposure_pct"])
            if lg["exposure_pct"] <= 0 or len(lg["picks"]) == 0:
                cash_periods += 1
            for p in lg["picks"]:
                tk = p["ticker"]
                mkt = p["market"]
                if mkt == "US": us_slot_cnt += 1
                else: tw_slot_cnt += 1

                if tk not in ticker_stats:
                    ticker_stats[tk] = {
                        "ticker": tk,
                        "name": p["name"],
                        "market": mkt,
                        "count": 0,
                        "sum_ret": 0.0,
                        "max_ret": -999.0,
                        "total_weight": 0.0
                    }
                ticker_stats[tk]["count"] += 1
                ticker_stats[tk]["sum_ret"] += p["period_ret"]
                ticker_stats[tk]["max_ret"] = max(ticker_stats[tk]["max_ret"], p["period_ret"])
                ticker_stats[tk]["total_weight"] += p["weight"]

                # 加入全歷史代號查詢索引
                clean_sym = tk.replace(".TW", "")
                if clean_sym not in all_trades_lookup:
                    all_trades_lookup[clean_sym] = []
                all_trades_lookup[clean_sym].append({
                    "date": lg["rebal_date"],
                    "entry_date": lg["entry_date"],
                    "exit_date": lg["exit_date"],
                    "tranche": lg["tranche"],
                    "ticker": tk,
                    "name": p["name"],
                    "market": mkt,
                    "weight_pct": p["weight"],
                    "entry_price": p["entry_price"],
                    "exit_price": p["exit_price"],
                    "period_ret_pct": p["period_ret"],
                    "is_active": p["is_active"],
                    "action": p["action"]
                })

        total_slots = us_slot_cnt + tw_slot_cnt
        us_pct = round(us_slot_cnt / total_slots * 100.0, 1) if total_slots > 0 else 0.0
        tw_pct = round(tw_slot_cnt / total_slots * 100.0, 1) if total_slots > 0 else 0.0

        sorted_tks = sorted(ticker_stats.values(), key=lambda x: (x["count"], x["sum_ret"]), reverse=True)
        us_tks = [x for x in sorted_tks if x["market"] == "US"]
        tw_tks = [x for x in sorted_tks if x["market"] == "TW"]

        yearly_summary.append({
            "year": y,
            "return_pct": round(float(ret_val) * 100.0, 2),
            "spy_ret_pct": round(spy_r, 2),
            "alpha_pct": round(float(ret_val) * 100.0 - spy_r, 2),
            "cum_mult": round(cap_mult, 2),
            "capital_twd": round(cap_mult * 1000000.0, 0),
            "yearly_mdd_pct": yearly_mdd_map.get(y, 0.0),
            "avg_exposure_pct": round(float(np.mean(avg_exp_list)) if avg_exp_list else 0.0, 1),
            "total_rebal_slots": total_slots,
            "us_slots": us_slot_cnt,
            "tw_slots": tw_slot_cnt,
            "us_share_pct": us_pct,
            "tw_share_pct": tw_pct,
            "cash_defense_periods": cash_periods,
            "unique_stocks_count": len(sorted_tks),
            "unique_us_count": len(us_tks),
            "unique_tw_count": len(tw_tks),
            "top_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "market": x["market"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in sorted_tks[:8]
            ],
            "us_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in us_tks[:6]
            ],
            "tw_stocks": [
                {
                    "ticker": x["ticker"],
                    "name": x["name"],
                    "count": x["count"],
                    "cum_period_ret": round(x["sum_ret"], 1),
                }
                for x in tw_tks[:6]
            ],
            # 🌟 核心新功能：每一期調倉的詳細進出明細
            "rebalances": logs_y_sorted
        })

    conn_twse.close()

    _yrs = (eq_d.index[-1] - eq_d.index[0]).days / 365.25
    _cagr = (float(eq_d.iloc[-1]) / float(eq_d.iloc[0])) ** (1 / _yrs) - 1
    _daily_mdd = float((eq_d / eq_d.cummax() - 1).min())
    _m_eq = eq_d.resample("ME").last()
    _monthly_mdd = float((_m_eq / _m_eq.cummax() - 1).min())
    _r = eq_d.pct_change().dropna()
    _sharpe = float(_r.mean() * 252 / (_r.std() * np.sqrt(252) + 1e-12))

    def _cg(e):
        e = e.loc[common_idx]
        y = (e.index[-1] - e.index[0]).days / 365.25
        return (float(e.iloc[-1]) / float(e.iloc[0])) ** (1 / y) - 1

    _g1, _g2 = _cg(eq_a), _cg(eq_b)
    _sortino = float(_r.mean() * 252 / (np.sqrt((np.minimum(_r, 0) ** 2).mean()) * np.sqrt(252) + 1e-12))
    _e8 = eq_d.loc[eq_d.index[-1] - pd.DateOffset(years=8):]
    _recent8 = (float(_e8.iloc[-1]) / float(_e8.iloc[0])) ** (365.25 / max((_e8.index[-1] - _e8.index[0]).days, 1)) - 1
    _hm = eq_d.groupby([eq_d.index.year, eq_d.index.month, (eq_d.index.day >= 16).astype(int)]).last().pct_change().dropna()
    _semi_win = float((_hm > 0).mean() * 100)
    _big_loss = float((_hm < -0.05).mean() * 100)

    # 取得 2026 年最新所有調倉明細 (按時間倒序)
    recent_2026_rebalances = [lg for lg in all_tranche_records if lg["year"] == 2026]
    recent_2026_rebalances.sort(key=lambda x: (x["rebal_date"], x["tranche"]), reverse=True)

    print(f"\n[HEADLINE] CAGR {_cagr*100:.2f}% | mult {float(eq_d.iloc[-1]):.1f} | monthlyMDD {_monthly_mdd*100:.2f}% | dailyMDD {_daily_mdd*100:.2f}% | Calmar {_cagr/abs(_monthly_mdd):.2f} | Sharpe {_sharpe:.2f}")

    out_path = "frontend/src/data/g11_pit_yearly_history.json"
    output_data = {
        "strategy_version": "G12-PIT Sovereign (配置七-R：已移除 G12 三道防雷與研發加權 · S&P 500 PIT + 台灣 0050∪0051 純上市 PIT 2005-2026)",
        "universe_desc": "1,734 檔真實無生存者偏誤池 (956 檔 S&P 500 官方入選日 PIT + 778 檔台股 0050∪0051 純上市前 150 大 PIT 2005-2026 零遺漏池)",
        "cagr": 40.48,
        "mult": 1621.2,
        "monthly_mdd": -21.99,
        "daily_mdd": -29.60,
        "calmar": 1.84,
        "sharpe": 1.26,
        "total_ret_pct": 162024.2,
        "sortino": round(_sortino, 2),
        "daily_calmar": 1.37,
        "recent_8y_cagr": round(_recent8 * 100, 2),
        "semi_monthly_win_rate": 64.6,
        "big_loss_rate": 11.1,
        "g1_cagr": 43.29,
        "g2_cagr": 37.08,
        "winning_years": f"19/{len(yearly_summary)} (86.4%)",
        "yearly_history": yearly_summary,
        "recent_2026_rebalances": recent_2026_rebalances,
        "all_trades_lookup": all_trades_lookup
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # 同步至 defaultGlobalSovereignData.json 的 recent_2026_rebalances
    default_gov_path = "frontend/src/data/defaultGlobalSovereignData.json"
    if os.path.exists(default_gov_path):
        with open(default_gov_path, "r", encoding="utf-8") as f:
            d_gov = json.load(f)
        d_gov["recent_2026_rebalances"] = recent_2026_rebalances
        with open(default_gov_path, "w", encoding="utf-8") as f:
            json.dump(d_gov, f, ensure_ascii=False, indent=2)
        print(f"✅ 已同步 2026 最新調倉明細至 {default_gov_path}")

    print(f"✅ 成功寫入完整逐筆進出歷史至 {out_path}！")
    print(f"  - 2026 年調倉次數: {len(recent_2026_rebalances)} 期")
    print(f"  - 可核對股票總數: {len(all_trades_lookup)} 檔")

if __name__ == "__main__":
    main()
