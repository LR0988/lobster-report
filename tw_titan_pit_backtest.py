#!/usr/bin/env python3
"""
tw_titan_pit_backtest.py  (台股因果泰坦 (上限1億) 回測產生器)
全球泰坦 G12-PIT 邏輯 × 僅台股 0050∪0051 PIT 宇宙 × 1 億資金容量約束；輸出前端 taiwan_causal_titan_data.json 回測區塊。
以下為其所衍生之 export_g11_pit_history.py 說明：
export_g11_pit_history.py
匯出 G12-PIT Sovereign (配置七：G12-RD + exp_262 + exp_264 全能平衡王牌版，1,725 檔無生存者偏誤 S&P 500 PIT + 台股 PIT 開放池)
2004–2026 歷年績效、歷年購買股票種類 (美股 S&P 500 PIT vs 台股 PIT 次數/佔比/代表標的) 與逐期明細
"""

import json
import sqlite3
import numpy as np
import pandas as pd

import forensic_open_pool_sniper as fops
from run_loops6_to_10_pit_deep_dive import prepare_clean_1725_pit_env, get_base_tw_unified_rule, make_pit_macro_fn


def asym_stepped_winner_tr_dd(peak_pnl: float) -> float:
    return 0.09 if peak_pnl < 0.20 else (0.13 if peak_pnl < 0.50 else 0.16)


def _roc_to_ann_str(ym) -> str:
    ym_s = str(ym).strip()
    if len(ym_s) < 5 or not ym_s.isdigit():
        return "2099-01-10"
    y, m = int(ym_s[:3]) + 1911, int(ym_s[3:5])
    return f"{y + 1:04d}-01-10" if m == 12 else f"{y:04d}-{m + 1:02d}-10"


def run_and_extract_g11_pit_history():
    with open("/tmp/pit_rd_intensity_map.json", "r") as f:
        rd_map = json.load(f)

    import pickle
    from build_and_test_zero_omission_0050_0051 import build_zero_omission_tw_0050_0051_pit
    tw_zero = build_zero_omission_tw_0050_0051_pit()

    env = prepare_clean_1725_pit_env()
    cols = env["all_open_tickers"]
    idx = env["stk_adj"].index
    us_tickers = env["us_tickers"]
    pit_tw = env["pit_tw"]

    # 對齊 100% 零遺漏 `0050 ∪ 0051` (TWSE 純上市前 150 大) 每日有效資格與純上市成交額排名
    in_0050_0051_pit = tw_zero["in_0050_0051_pit"].reindex(index=idx, columns=pit_tw).ffill().fillna(False)

    conn_twse = sqlite3.connect("/Users/huanggin-chen/openclaw_test/tw_stock.db")
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
    conn_twse.close()

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
    elig_base[us_tickers] = False  # 【TW-ONLY 測試】美股一律不可買，僅操作台股 0050∪0051 PIT
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

    conn = sqlite3.connect("/Users/huanggin-chen/openclaw_test/tw_stock.db")
    df_rev = pd.read_sql_query("SELECT revenue_date, stock_id, yoy, mom FROM monthly_revenue", conn)
    conn.close()

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
            for c in y_tab.columns:
                if c in piv_yoy.columns:
                    piv_yoy[c] = y_tab[c].astype(np.float32)
                    piv_mom[c] = m_tab[c].astype(np.float32)

    # exp_262 正交共振乘數 (60D Sortino × Sustain20D × 高檔壓縮 × 量能擴張 × 月營收雙衰減過濾)
    sustain_sortino_mult = np.where(
        (sustain_20d >= 0.45) & (comp_ratio <= 0.65) & (sortino_60 >= 1.5) & (turnover_growth > 0.0) & (io_20 > 0.0),
        1.04,
        1.0,
    ).astype(np.float32)
    rev_decay_pen = np.where((piv_yoy < -5.0) & (piv_mom < -5.0) & (stk_adj < ma20), 0.75, 1.0).astype(np.float32)
    exp262_mult = (sustain_sortino_mult * rev_decay_pen).astype(np.float32)

    intraday_ret = ((stk_adj - stk_open) / (stk_open + 1e-9)).fillna(0.0).astype(np.float32)
    vw_io_5 = ((intraday_ret * stk_vol).rolling(5, min_periods=2).sum() / (stk_vol.rolling(5, min_periods=2).sum() + 1.0)).fillna(0.0).astype(np.float32)
    vol_20d = (daily_ret.rolling(20, min_periods=5).std() * np.sqrt(252)).fillna(0.0).astype(np.float32)

    dist_veto_g10 = np.where((stk_adj < ma20) & (io_5 < -0.01), 0.70, 1.0)
    coiled_mask = (mom12m > 0.65) & (fip_252 > 0.08) & (dd20 >= -0.12) & (dd20 <= -0.03) & (bias20 >= -0.03) & (bias20 <= 0.04) & (io_20 > -0.02)
    coiled_spring_g11 = np.where(coiled_mask, 1.12, 1.0)
    score_g11 = (env["s_g5_open"][cols] * dist_veto_g10 * coiled_spring_g11).astype(np.float32)

    # G12 三大進場防雷 + RD 黃金研發強度護城河加權
    high_dist_b2 = np.where((bias20 > 0.05) & ((io_5 < -0.012) | (vw_io_5 < -0.010)), 0.72, 1.0)
    vol_veto_d = np.where((vol_20d > 0.68) & ((io_5 < 0.0) | (dd20 < -0.08)), 0.72, 1.0)
    cond_b60_veto = np.where((bias60 > 0.35) & ((io_5 < 0.0) | (vw_io_5 < 0.0)), 0.70, 1.0)
    rd_pct_arr = np.array([float(rd_map.get(c, {}).get("rd_pct_median", 0.0)) for c in cols], dtype=np.float32)
    r2_intra_tech = np.where(rd_pct_arr > 28.0, 0.80, np.where((rd_pct_arr > 0.0) & (rd_pct_arr < 3.5), 0.92, 1.00))
    rd_synergy_mat = np.where(coiled_mask & ((rd_pct_arr >= 5.0) & (rd_pct_arr <= 25.0))[np.newaxis, :], 1.05, 1.0) * r2_intra_tech[np.newaxis, :]

    score_g12_rd = (score_g11 * high_dist_b2 * vol_veto_d * cond_b60_veto * rd_synergy_mat).astype(np.float32)
    score_mat = (score_g12_rd * exp262_mult).astype(np.float32)

    base_weights = [0.52, 0.24, 0.24]
    pool_k = 5
    tenure_max_rk = 5

    data4 = env["data4"]
    dates_idx = score_mat.index
    dt_to_pos = {d: i for i, d in enumerate(dates_idx)}

    px_adj_arr = stk_adj.values
    px_open_arr = stk_open.values
    px_low_arr = stk_low.values
    ma20_arr = ma20.values
    ma60_arr = ma60.values
    ma200_arr = ma200.values
    bias60_arr = bias60.values
    rmom10_arr = r_mom10.values
    sustain_arr = sustain_20d.values
    yoy_arr = piv_yoy.values
    mom_arr = piv_mom.values
    io20_arr = io_20.values
    io5_arr = io_5.values
    churn_arr = env["churn_exhaustion"][cols].values
    score_arr = score_mat.values
    elig_arr = elig_base.values
    sec_arr = g9_sec[cols].values

    global_breadth = data4["global_breadth"]
    safe_cash_ret = data4["safe_cash_ret"]
    us10y_series = data4["us10y_series"]
    qqq_bias = data4["qqq_bias_dict"][500]
    qqq_p = data4["px_adj"]["QQQ"]
    qqq_ma60 = data4["qqq_ma60"]
    all_dates = data4["all_dates"]

    is_tw_arr = np.array([c.endswith(".TW") for c in cols])
    fee_buy_arr = np.where(is_tw_arr, 0.001425 * 0.28, 0.0005)
    fee_sell_arr = np.where(is_tw_arr, (0.001425 * 0.28) + 0.003, 0.0005)

    drift_tol = 0.12
    macro_cap = 0.35

    CAP_TWD, PART, SCALE = 100_000_000.0, 0.10, (100_000_000.0 / 2) / 500000.0   # 每梯隊分得 5,000 萬
    adv20_arr = tw_zero["trade_val"].reindex(index=idx, columns=cols).rolling(20, min_periods=5).mean().shift(1).values
    cap_hits = {"n": 0, "total": 0}

    tranche_logs = []

    def sim_tranche(day_target, tranche_name, init_cap=500000.0):
        rebal_dates = []
        for (y, m), grp in all_dates.groupby([all_dates.dt.year, all_dates.dt.month]):
            sub = grp[grp.dt.day >= day_target]
            rebal_dates.append(sub.iloc[0] if len(sub) > 0 else grp.iloc[-1])

        periods = []
        for i in range(len(rebal_dates) - 1):
            t_date = rebal_dates[i]
            fut = dates_idx[dates_idx > t_date]
            if len(fut) == 0:
                break
            t_in = fut[0]
            next_rebal = rebal_dates[i + 1]
            fut_next = dates_idx[dates_idx > next_rebal]
            if len(fut_next) == 0:
                break
            t_out = fut_next[0]
            periods.append((t_date, t_in, t_out))

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
                t_date, t_in, t_out = periods[p_idx]
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
                if br >= 0.50:
                    base_exp = 1.0
                elif br >= 0.30:
                    base_exp = 0.70
                else:
                    base_exp = 0.0

                qb = float(qqq_bias.iloc[t_pos]) if t_date in qqq_bias.index else 0.0
                rate = float(us10y_series.iloc[t_pos]) if t_date in us10y_series.index else 0.0
                qqq_below_ma60 = float(qqq_p.iloc[t_pos]) < float(qqq_ma60.iloc[t_pos])

                if base_exp > 0.0:
                    if qb >= 30.0 and rate >= 3.5:
                        exposure = min(base_exp, 0.50)
                    else:
                        exposure = base_exp
                else:
                    exposure = 0.0

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
                    tranche_logs.append({
                        "year": int(t_date.year),
                        "date": str(t_date)[:10],
                        "tranche": tranche_name,
                        "exposure": 0.0,
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

                        # exp_264 贏家主升段 40~60 天續抱護航 + 0.09/0.13/0.16 階梯移動鎖利
                        if not keep and tenure < 4 and rk is not None and rk <= 7:
                            if ppnl >= 0.055 and cur_c > m60_c and sust_c >= 0.45 and tr_dd < asym_stepped_winner_tr_dd(ppnl) and float(io20_arr[t_pos, c_i]) > 0.0:
                                keep = True
                        if keep and ppnl >= 0.25 and tr_dd >= asym_stepped_winner_tr_dd(ppnl) and rk >= 4:
                            keep = False

                        # exp_264 敗部滯漲 & 月營收雙衰減淘汰
                        if keep and ppnl < 0.055 and rk is not None and rk >= 4:
                            is_rev_decay = (yoy_arr[t_pos, c_i] < 0.0) and (mom_arr[t_pos, c_i] < 0.0) and (cur_c < m20_c)
                            is_mom_decay = (cur_c < m20_c) and (float(rmom10_arr[t_pos, c_i]) < -0.02) and (float(io5_arr[t_pos, c_i]) < -0.01)
                            if is_rev_decay or is_mom_decay:
                                keep = False

                        if keep:
                            selected_stks.append(c_i)

                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3:
                            break
                        c_i = int(c_i)
                        tenure = holding_tenure.get(c_i, 0)
                        if c_i not in selected_stks and tenure < 4:
                            selected_stks.append(c_i)
                    for c_i in sorted_indices:
                        if len(selected_stks) >= 3:
                            break
                        c_i = int(c_i)
                        if c_i not in selected_stks:
                            selected_stks.append(c_i)

                    n = min(3, len(selected_stks))
                    selected_stks = selected_stks[:n]
                    holding_tenure = {c_i: holding_tenure.get(c_i, 0) + 1 for c_i in selected_stks}
                    bw_slice = base_weights[:n]
                    # Top 1 黃金研發強度 (5% ~ 25%) 確信度加碼 (56% / 22% / 22%)
                    if n == 3:
                        rd0 = float(rd_pct_arr[selected_stks[0]])
                        if 5.0 <= rd0 <= 25.0:
                            bw_slice = [0.56, 0.22, 0.22]

                    tot_bw = sum(bw_slice)
                    norm_weights = [w / tot_bw for w in bw_slice]
                    target_alloc = {selected_stks[idx_s]: norm_weights[idx_s] * exposure for idx_s in range(n)}

                    period_picks_info = []
                    for idx_s, c_i in enumerate(selected_stks):
                        sym = cols[c_i]
                        p_in = float(px_open_arr[in_pos, c_i])
                        p_out = float(px_open_arr[out_pos, c_i])
                        p_ret = ((p_out / p_in) - 1.0) * 100.0 if (p_in > 0 and p_out > 0 and not np.isnan(p_in) and not np.isnan(p_out)) else 0.0
                        period_picks_info.append({
                            "ticker": sym,
                            "market": "TW" if sym.endswith(".TW") else "US",
                            "weight": round(norm_weights[idx_s] * exposure * 100.0, 1),
                            "period_ret": round(p_ret, 2),
                            "entry_date": str(dates_idx[in_pos])[:10],
                            "exit_date": str(dates_idx[out_pos])[:10],
                            "entry_px": round(float(tw_zero["raw_close"].reindex(idx)[sym].ffill().iloc[in_pos]) * (p_in / float(px_adj_arr[in_pos, c_i]) if px_adj_arr[in_pos, c_i] else 1.0), 2) if sym in tw_zero["raw_close"].columns else 0.0,
                            "exit_px": round(float(tw_zero["raw_close"].reindex(idx)[sym].ffill().iloc[out_pos]) * (p_out / float(px_adj_arr[out_pos, c_i]) if px_adj_arr[out_pos, c_i] else 1.0), 2) if sym in tw_zero["raw_close"].columns else 0.0,
                            "tranche": tranche_name
                        })

                    tranche_logs.append({
                        "year": int(t_date.year),
                        "date": str(t_date)[:10],
                        "tranche": tranche_name,
                        "exposure": round(exposure * 100.0, 1),
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
                            is_new = c_i not in old_holdings_set
                            buy_orders.append((c_i, diff_val, is_new))

                    for c_i, diff_val, is_new in buy_orders:
                        actual_buy = min(cash, diff_val)
                        _adv = adv20_arr[t_pos, c_i]
                        _cap_amt = (PART * _adv / SCALE) if (_adv == _adv and _adv > 0) else 0.0
                        _held_val = (holdings[c_i]["shares"] * float(px_open_arr[in_pos, c_i])) if c_i in holdings else 0.0
                        cap_hits["total"] += 1
                        if actual_buy > max(0.0, _cap_amt - _held_val):
                            cap_hits["n"] += 1
                            actual_buy = max(0.0, _cap_amt - _held_val)
                        if actual_buy <= 10.0:
                            continue
                        op = float(px_open_arr[in_pos, c_i])
                        c_t = float(px_adj_arr[t_pos, c_i])
                        if op <= 0 or c_t <= 0 or np.isnan(op) or np.isnan(c_t):
                            continue

                        if not is_new:
                            fee = actual_buy * fee_buy_arr[c_i]
                            sh = (actual_buy - fee) / op
                            cash -= actual_buy
                            if c_i in holdings:
                                holdings[c_i]["shares"] += sh
                            else:
                                holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op, "days_held": 0}
                        else:
                            gap = (op / c_t) - 1.0
                            b60 = float(bias60_arr[t_pos, c_i]) if not np.isnan(bias60_arr[t_pos, c_i]) else 0.0
                            if not (gap > 0.015 or b60 > 0.40):
                                fee = actual_buy * fee_buy_arr[c_i]
                                sh = (actual_buy - fee) / op
                                cash -= actual_buy
                                if c_i in holdings:
                                    holdings[c_i]["shares"] += sh
                                else:
                                    holdings[c_i] = {"shares": sh, "entry_px": op, "peak_px": op, "days_held": 0}
                            else:
                                lim_px = c_t * (1.0 - 0.002)
                                cash -= actual_buy
                                pending_orders.append({
                                    "c_i": c_i,
                                    "reserved_cash": actual_buy,
                                    "limit_px": lim_px,
                                    "expire_pos": cur_pos + 1,
                                })
                p_idx += 1

            if pending_orders:
                still_p = []
                for od in pending_orders:
                    c_i = od["c_i"]
                    r_cash = od["reserved_cash"]
                    lim = od["limit_px"]
                    op_today = float(px_open_arr[cur_pos, c_i])
                    low_today = float(px_low_arr[cur_pos, c_i])
                    close_today = float(px_adj_arr[cur_pos, c_i])

                    if not np.isnan(low_today) and low_today <= lim:
                        fill_px = min(op_today, lim) if (not np.isnan(op_today) and op_today > 0) else lim
                        fee = r_cash * fee_buy_arr[c_i]
                        sh = (r_cash - fee) / fill_px
                        if c_i in holdings:
                            holdings[c_i]["shares"] += sh
                        else:
                            holdings[c_i] = {"shares": sh, "entry_px": fill_px, "peak_px": fill_px, "days_held": 0}
                    elif cur_pos >= od["expire_pos"]:
                        if not np.isnan(close_today) and close_today > 0:
                            fee = r_cash * fee_buy_arr[c_i]
                            sh = (r_cash - fee) / close_today
                            if c_i in holdings:
                                holdings[c_i]["shares"] += sh
                            else:
                                holdings[c_i] = {"shares": sh, "entry_px": close_today, "peak_px": close_today, "days_held": 0}
                        else:
                            cash += r_cash
                    else:
                        od["reserved_cash"] *= 1.0 + float(safe_cash_ret.iloc[cur_pos])
                        still_p.append(od)
                pending_orders = still_p

            for c_i, hinfo in list(holdings.items()):
                c_px = float(px_adj_arr[cur_pos, c_i])
                if not np.isnan(c_px) and c_px > hinfo["peak_px"]:
                    hinfo["peak_px"] = c_px
                hinfo["days_held"] = hinfo.get("days_held", 0) + 1

            reserved_total = sum(od["reserved_cash"] for od in pending_orders)
            stk_val = sum(
                holdings[c_i]["shares"] * float(px_adj_arr[cur_pos, c_i])
                for c_i in holdings
                if not np.isnan(px_adj_arr[cur_pos, c_i])
            )
            daily_equity.loc[current_dt] = cash + reserved_total + stk_val

        return daily_equity

    eq_a = sim_tranche(1, "A", 500000.0)
    eq_b = sim_tranche(22, "B", 500000.0)
    # 嚴格對齊台股 0050∪0051 資料庫起始日 (2005-01-03 ~ 2026-10-29，共 22 年 5,338 個交易日 100% 零遺漏)，剔除無台股資料之 2004 年
    common_idx = eq_a.index.intersection(eq_b.index)
    common_idx = common_idx[common_idx >= pd.Timestamp("2005-01-03")]
    tranche_logs = [lg for lg in tranche_logs if lg["year"] >= 2005]
    eq_d = (eq_a.loc[common_idx] + eq_b.loc[common_idx]) / 1000000.0
    eq_d = eq_d / float(eq_d.iloc[0])
    pass

    # SPY yearly returns
    spy_s = data4["px_adj"]["SPY"].reindex(common_idx).ffill()
    spy_yr_eq = spy_s.resample("YE").last()
    spy_yr_rets = spy_yr_eq.pct_change().dropna()
    spy_first = (spy_yr_eq.iloc[0] / spy_s.iloc[0]) - 1.0
    all_spy_rets = pd.concat([pd.Series([spy_first], index=[spy_yr_eq.index[0]]), spy_yr_rets])

    yr_eq = eq_d.resample("YE").last()
    yr_rets = yr_eq.pct_change().dropna()
    first_yr = (yr_eq.iloc[0] / eq_d.iloc[0]) - 1.0
    all_yr_rets = pd.concat([pd.Series([first_yr], index=[yr_eq.index[0]]), yr_rets])

    # Yearly MDD
    yearly_mdd_map = {}
    for y, grp in eq_d.groupby(eq_d.index.year):
        dd = (grp / grp.cummax()) - 1.0
        yearly_mdd_map[int(y)] = round(float(dd.min()) * 100.0, 2)

    # Stock names from tw_stock.db and global_sovereign_service
    import global_sovereign_service as gss
    conn = sqlite3.connect("tw_stock.db")
    c = conn.cursor()

    US_NAME_DICT = {
        "NLOK": "NortonLifeLock (賽門鐵克)",
        "VLO": "Valero (瓦萊羅能源)",
        "QCOM": "高通 (Qualcomm)",
        "X": "美國鋼鐵 (US Steel)",
        "AAPL": "蘋果 (Apple)",
        "EOG": "EOG能源 (EOG Resources)",
        "KBH": "KB Home (北美營建巨頭)",
        "NVDA": "輝達 (NVIDIA)",
        "CHK": "Chesapeake (切薩皮克能源)",
        "AMZN": "亞馬遜 (Amazon)",
        "ATI": "ATI特種金屬 (Allegheny)",
        "HES": "赫斯能源 (Hess)",
        "F": "福特汽車 (Ford)",
        "FCX": "自由港麥克莫蘭 (Freeport銅礦)",
        "AZO": "AutoZone (汽車零件龍頭)",
        "WFC": "富國銀行 (Wells Fargo)",
        "AKAM": "Akamai (雲端CDN龍頭)",
        "FITB": "五三銀行 (Fifth Third)",
        "CLF": "克里夫蘭克里夫 (Cleveland-Cliffs)",
        "NFLX": "網飛 (Netflix)",
        "CMG": "Chipotle (墨西哥捲餅龍頭)",
        "STX": "希捷科技 (Seagate硬碟)",
        "M": "梅西百貨 (Macy's)",
        "PHM": "PulteGroup (北美房建龍頭)",
        "LYB": "利安德巴塞爾 (LyondellBasell)",
        "MU": "美光科技 (Micron)",
        "GILD": "吉利德科學 (Gilead生技)",
        "DAL": "達美航空 (Delta Air Lines)",
        "FSLR": "第一太陽能 (First Solar)",
        "META": "Meta (臉書)",
        "LUV": "西南航空 (Southwest)",
        "SWKS": "思佳訊 (Skyworks射頻晶片)",
        "LOW": "勞氏 (Lowe's家居龍頭)",
        "NEM": "紐蒙特 (Newmont全球金礦王)",
        "AMAT": "應用材料 (Applied Materials)",
        "BA": "波音 (Boeing)",
        "CSX": "CSX鐵路運輸",
        "AMD": "超微半導體 (AMD)",
        "ADBE": "Adobe (創意軟體霸主)",
        "SBUX": "星巴克 (Starbucks)",
        "LLY": "禮來製藥 (Eli Lilly)",
        "LRCX": "科林研發 (Lam Research)",
        "DXCM": "DexCom (連續血糖監測龍頭)",
        "FDX": "聯邦快遞 (FedEx)",
        "ETSY": "Etsy (手工藝電商平台)",
        "TSLA": "特斯拉 (Tesla)",
        "MRNA": "莫德納 (Moderna)",
        "DVN": "Devon Energy (戴文能源)",
        "XOM": "埃克森美孚 (ExxonMobil)",
        "COP": "康菲石油 (ConocoPhillips)",
        "OXY": "西方石油 (Occidental)",
        "GE": "奇異航太 (GE Aerospace)",
        "VST": "Vistra (AI電力與核電巨頭)",
        "PLTR": "Palantir (AI國防大數據霸主)",
        "KKR": "KKR (全球私募股權巨擘)",
        "GEV": "GE Vernova (電力與電網設備王)",
        "WDC": "威騰電子 (Western Digital)",
        "AVGO": "博通 (Broadcom)",
        "SNDK": "SanDisk (閃迪NAND快閃記憶體)",
        "LITE": "Lumentum (AI光通訊雷射龍頭)",
        "ANET": "Arista (AI資料中心交換器王)",
        "SMCI": "美超微 (Supermicro)",
        "CEG": "Constellation (美國最大核電商)",
        "NRG": "NRG Energy (獨立發電巨頭)",
        "TRGP": "Targa Resources (天然氣中游)",
        "AXON": "Axon (警用泰瑟槍與雲端AI)",
        "HOWM": "Howmet (航太渦輪葉片龍頭)",
        "HWM": "Howmet (航太渦輪葉片龍頭)",
        "ORCL": "甲骨文 (Oracle雲端算力)",
        "CRM": "Salesforce (企業CRM龍頭)",
        "PANW": "Palo Alto (派拓資安)",
        "CRWD": "CrowdStrike (終端資安王)",
        "FTNT": "Fortinet (飛塔資安)",
        "NOW": "ServiceNow (企業AI工作流)",
        "URI": "United Rentals (北美設備租賃王)",
        "PWR": "Quanta Services (電網基建龍頭)",
        "ROYAL": "Royal Caribbean (皇家加勒比)",
        "RCL": "皇家加勒比郵輪 (Royal Caribbean)",
        "CCL": "嘉年華郵輪 (Carnival)",
        "ULTA": "Ulta Beauty (美妝零售龍頭)",
        "NVT": "nVent (資料中心液冷機櫃)",
        "TAP": "Molson Coors (摩森康勝)",
        "MOS": "美盛化肥 (Mosaic)",
        "CF": "CF Industries (氮肥龍頭)",
        "HAL": "哈里伯頓 (Halliburton油服)",
        "SLB": "斯倫貝謝 (SLB油服巨頭)",
        "BKR": "貝克休斯 (Baker Hughes)",
        "MPC": "馬拉松石油 (Marathon Petroleum)",
        "PSX": "Phillips 66 (煉油巨頭)",
        "PXD": "先鋒自然資源 (Pioneer頁岩油)",
        "FANG": "Diamondback Energy (頁岩油)",
        "EQT": "EQT (美國最大天然氣商)",
        "CTRA": "Coterra Energy (油氣開採)",
        "APA": "APA Corp (阿帕契石油)",
        "MRO": "Marathon Oil (馬拉松原油)",
        "BIIB": "百健 (Biogen神經生技)",
        "REGN": "再生元製藥 (Regeneron)",
        "VRTX": "福泰製藥 (Vertex)",
        "ISRG": "直覺外科 (達文西手術機器人)",
        "ALGN": "愛齊科技 (隱適美Invisalign)",
        "IDXX": "愛德士 (寵物診斷龍頭)",
        "UNH": "聯合健康 (UnitedHealth)",
        "HUM": "Humana (醫療保險巨頭)",
        "CI": "Cigna (信諾集團)",
        "MCK": "McKesson (北美醫藥分銷王)",
        "CAH": "Cardinal Health (卡地納健康)",
        "COR": "Cencora (美源伯根醫藥)",
        "CAT": "卡特彼勒 (Caterpillar重工)",
        "DE": "強鹿 (John Deere農機王)",
        "NUE": "紐柯鋼鐵 (Nucor)",
        "STLD": "Steel Dynamics (鋼鐵動力)",
        "AA": "美國鋁業 (Alcoa)",
        "WYNN": "永利渡假村 (Wynn Resorts)",
        "LVS": "金沙集團 (Las Vegas Sands)",
        "MGM": "美高梅 (MGM Resorts)",
        "DRI": "達登餐飲 (Darden Restaurants)",
        "YUM": "百勝餐飲 (Yum! Brands)",
        "MCD": "麥當勞 (McDonald's)",
        "TGT": "目標百貨 (Target)",
        "WMT": "沃爾瑪 (Walmart)",
        "COST": "好市多 (Costco)",
        "HD": "家得寶 (Home Depot)",
        "LEN": "萊納房屋 (Lennar)",
        "DHI": "霍頓房屋 (D.R. Horton)",
        "NVR": "NVR (北美高階房建)",
        "GWW": "固安捷 (Grainger工業分銷)",
        "FAST": "快扣 (Fastenal工業扣件)",
        "IT": "Gartner (高德納科技顧問)",
        "MSCI": "MSCI (明晟指數巨頭)",
        "SPGI": "標普全球 (S&P Global)",
        "BLK": "貝萊德 (BlackRock資產管理)",
        "GS": "高盛 (Goldman Sachs)",
        "MS": "摩根士丹利 (Morgan Stanley)",
        "JPM": "摩根大通 (JPMorgan)",
        "BAC": "美國銀行 (Bank of America)",
        "C": "花旗集團 (Citigroup)",
        "SCHW": "嘉信理財 (Charles Schwab)",
        "AXP": "美國運通 (American Express)",
        "V": "Visa (全球支付網路)",
        "MA": "萬事達卡 (Mastercard)",
        "PYPL": "PayPal (數位支付)",
        "INTU": "Intuit (財稅軟體巨頭)",
        "SNPS": "新思科技 (Synopsys EDA)",
        "CDNS": "益華電腦 (Cadence EDA)",
        "KLAC": "科磊 (KLA半導體檢測)",
        "ASML": "艾司摩爾 (ASML)",
        "MRVL": "邁威爾 (Marvell)",
        "ON": "安森美 (ON Semi車用功率)",
        "MPWR": "芯源系統 (Monolithic Power)",
        "MCHP": "微芯科技 (Microchip)",
        "NXPI": "恩智浦 (NXP)",
        "TXN": "德州儀器 (TI)",
        "ADI": "亞德諾 (Analog Devices)",
        "INTC": "英特爾 (Intel)",
        "HPQ": "惠普 (HP)",
        "HPE": "慧與科技 (HPE AI伺服器)",
        "DELL": "戴爾科技 (Dell AI伺服器)",
        "NTAP": "NetApp (企業儲存巨頭)",
        "IBM": "IBM (國際商業機器)",
        "CSCO": "思科 (Cisco)",
        "JNPR": "瞻博網路 (Juniper)",
        "GLW": "康寧 (Corning光纖與玻璃)",
        "APH": "安費諾 (Amphenol高速連接器)",
        "TEL": "泰科電子 (TE Connectivity)",
        "JBL": "捷普科技 (Jabil)",
        "FLEX": "偉創力 (Flex)",
        "EBAY": "eBay (全球電商平台)",
        "CNX": "CNX能源 (阿帕拉契天然氣)",
        "GPS": "Gap (北美服飾零售龍頭)",
        "COF": "第一資本 (Capital One金融)",
        "UBER": "優步 (Uber全球出行霸主)",
        "HOOD": "Robinhood (美股新世代券商王)"
    }

    def get_name_short(tk):
        if tk in US_NAME_DICT:
            return US_NAME_DICT[tk].split(" (")[0]
        if tk in gss.GLOBAL_STOCK_NAME_MAP:
            raw = gss.GLOBAL_STOCK_NAME_MAP[tk]
            return raw.split(" (")[0]
        base = tk.split(".")[0]
        if base in gss.GLOBAL_STOCK_NAME_MAP:
            return gss.GLOBAL_STOCK_NAME_MAP[base].split(" (")[0]
        if tk.endswith(".TW"):
            c.execute("SELECT stock_name FROM daily_stock WHERE stock_id = ? AND stock_name IS NOT NULL ORDER BY date DESC LIMIT 1", (base,))
            r = c.fetchone()
            if r and r[0]:
                return r[0]
        return tk

    yearly_summary = []
    win_years_cnt = 0
    for dt_idx, ret_val in all_yr_rets.items():
        y = int(dt_idx.year)
        if float(ret_val) > 0:
            win_years_cnt += 1
        spy_r = float(all_spy_rets.loc[dt_idx]) * 100.0 if dt_idx in all_spy_rets.index else 0.0
        cap_mult = float(yr_eq.loc[dt_idx])
        logs_y = [lg for lg in tranche_logs if lg["year"] == y]

        us_slot_cnt = 0
        tw_slot_cnt = 0
        cash_periods = 0
        ticker_stats = {}
        avg_exp_list = []

        for lg in logs_y:
            avg_exp_list.append(lg["exposure"])
            if lg["exposure"] <= 0 or len(lg["picks"]) == 0:
                cash_periods += 1
            for p in lg["picks"]:
                tk = p["ticker"]
                mkt = p["market"]
                if mkt == "US":
                    us_slot_cnt += 1
                else:
                    tw_slot_cnt += 1
                if tk not in ticker_stats:
                    ticker_stats[tk] = {
                        "ticker": tk,
                        "name": get_name_short(tk),
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
        })

    conn.close()


    # ======================= 台股因果泰坦 (上限1億) 前端資料匯出 =======================
    import os as _os
    FRONT = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "frontend/src/data")
    jpath = _os.path.join(FRONT, "taiwan_causal_titan_data.json")
    old = json.load(open(jpath, encoding="utf-8"))
    eqn = eq_d / float(eq_d.iloc[0])
    r_d = eqn.pct_change().dropna()
    yrs = (eqn.index[-1] - eqn.index[0]).days / 365.25
    cagr = float(eqn.iloc[-1]) ** (1 / yrs) - 1
    mdd = float((eqn / eqn.cummax() - 1).min())
    vol = float(r_d.std() * np.sqrt(252))
    sharpe = float(r_d.mean() * 252 / (vol + 1e-12))
    sortino = float(r_d.mean() * 252 / (np.sqrt((r_d.clip(upper=0) ** 2).mean()) * np.sqrt(252) + 1e-12))

    cx = sqlite3.connect(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "tw_stock.db"))
    ix = pd.read_sql_query("SELECT date, close FROM daily_index", cx); cx.close()
    ix.index = pd.to_datetime(ix["date"], format="%Y%m%d"); ixs = ix["close"].astype(float).reindex(eqn.index).ffill()
    ixn = ixs / float(ixs.iloc[0]); ixr = ixn.pct_change().dropna()
    t_cagr = float(ixn.iloc[-1]) ** (1 / yrs) - 1; t_mdd = float((ixn / ixn.cummax() - 1).min())
    t_vol = float(ixr.std() * np.sqrt(252)); t_sh = float(ixr.mean() * 252 / (t_vol + 1e-12))

    # 交易明細：同梯隊連續持有的同一檔合併為一筆
    names_tw = tw_zero["name_map"]
    def _nm(tk):
        return str(names_tw.get(tk, tk)).split(" (")[0]
    logs_sorted = sorted([lg for lg in tranche_logs if lg["picks"]], key=lambda x: (x["tranche"], x["date"]))
    open_tr, trades_out = {}, []
    def _close(key, reason):
        t = open_tr.pop(key)
        trades_out.append(dict(stock_id=key[1].replace(".TW", ""), stock_name=_nm(key[1]), role=("🅰️ A梯隊(1號)" if key[0] == "A" else "🅱️ B梯隊(22號)") + f" · 梯隊內平均權重 {t['wsum']/t['n']:.0f}%",
            weight_pct=round(t["wsum"] / t["n"] / 2.0, 1), entry_date=t["entry_date"].replace("-", ""), exit_date=t["exit_date"].replace("-", ""),
            entry_price=t["entry_px"], exit_price=t["exit_px"], return_pct=round((t["cum"] - 1) * 100, 2),
            holding_days=int((pd.Timestamp(t["exit_date"]) - pd.Timestamp(t["entry_date"])).days * 5 / 7), exit_reason=reason, leader=(t["cum"] - 1) >= 0.5))
    prev_tr = {"A": set(), "B": set()}
    for tr_name in ("A", "B"):
        for lg in [x for x in tranche_logs if x["tranche"] == tr_name]:
            cur_set = {p["ticker"] for p in lg["picks"]}
            for key in [k for k in list(open_tr) if k[0] == tr_name and k[1] not in cur_set]:
                _close(key, "🛡️ 宏觀護盾空手" if not lg["picks"] else "🔄 半月輪動調倉換出")
            for p in lg["picks"]:
                key = (tr_name, p["ticker"])
                if key in open_tr:
                    t = open_tr[key]; t["cum"] *= (1 + p["period_ret"] / 100); t["exit_date"] = p["exit_date"]; t["exit_px"] = p["exit_px"]; t["wsum"] += p["weight"]; t["n"] += 1
                else:
                    open_tr[key] = dict(entry_date=p["entry_date"], entry_px=p["entry_px"], exit_date=p["exit_date"], exit_px=p["exit_px"], cum=1 + p["period_ret"] / 100, wsum=p["weight"], n=1)
    for key in list(open_tr):
        _close(key, "📌 持有中 (最近一期)")
    trades_out.sort(key=lambda x: x["exit_date"], reverse=True)
    wins = [t for t in trades_out if t["return_pct"] > 0]
    loss_sum = abs(sum(t["return_pct"] for t in trades_out if t["return_pct"] <= 0))

    m_nav = eqn.resample("ME").last().dropna(); m_ix = ixn.resample("ME").last()
    curve_out, pv, pi = [], 1.0, 1.0
    for dte in m_nav.index:
        a, b = float(m_nav[dte]), float(m_ix.get(dte, pi))
        curve_out.append(dict(date=min(dte, eqn.index[-1]).strftime("%Y-%m-%d"), strategy_nav=round(a, 3), taiex_nav=round(b, 3), monthly_ret=round((a / pv - 1) * 100, 2), taiex_ret=round((b / pi - 1) * 100, 2))); pv, pi = a, b
    y_s, y_i = eqn.groupby(eqn.index.year).last(), ixn.groupby(ixn.index.year).last()
    yearly_out, pv, pi = [], 1.0, 1.0
    for y in y_s.index:
        a, b = float(y_s[y]), float(y_i[y]); sr, tr_ = (a / pv - 1) * 100, (b / pi - 1) * 100
        yearly_out.append(dict(year=int(y), strategy_ret=round(sr, 2), taiex_ret=round(tr_, 2), alpha=round(sr - tr_, 2), is_positive=sr > 0, return_pct=round(sr, 2), taiex_pct=round(tr_, 2))); pv, pi = a, b

    # 因子 Rank IC (台股 0050∪0051 合格股，20 日前瞻報酬，每 20 日取樣)
    fwd = (stk_adj.shift(-20) / stk_adj - 1.0)
    tw_cols = [c_ for c_ in cols if c_.endswith(".TW")]
    FACT = [
        ("G12 最終評分 (所有因子合成)", score_mat, "八因子微結構動能 × 進場防雷 × 研發護城河 × 正交共振，為選股排序依據。", "Titan2_Base + G5 + G12 防雷 (見 MEMORY.md 支柱 1)"),
        ("日內機構吸籌 IntraOver_20", io_20, "日內盤中走強而隔夜跳空疲弱，代表法人在盤中吸籌、散戶在隔夜追價，後續動能延續。", "Lou, Polk & Skouras (2019 JFE)"),
        ("FIP 資訊連續性 (FIP_252)", fip_252, "報酬由大量小漲日累積而非少數暴衝日，投資人反應不足，動能延續性更強。", "Da, Gurun & Warachka (2014 RFS)"),
        ("12 個月動能", mom12m, "過去一年強勢股傾向延續強勢 (剔除近月反轉)。", "Jegadeesh & Titman (1993)"),
        ("Sustain 20D 高檔維持率", sustain_20d, "近 20 日收盤持續站在 60 日高點 97% 以上，代表趨勢穩定、主升段延續機率高。", "exp_262 / exp_264 贏家護航因子"),
    ]
    alphas_out = []
    for title, mat, mech, basis in FACT:
        m_ = mat[tw_cols] if hasattr(mat, "__getitem__") else mat
        el_ = in_0050_0051_pit.reindex(index=idx, columns=tw_cols).fillna(False)   # 以 0050∪0051 當日成員為母體 (非嚴格選股濾網後)
        ics = []
        for i in range(300, len(idx) - 20, 20):
            a_, b_, e_ = m_.iloc[i], fwd[tw_cols].iloc[i], el_.iloc[i]
            mk = a_.notna() & b_.notna() & e_.astype(bool)
            if mk.sum() >= 30:
                ics.append(a_[mk].rank().corr(b_[mk].rank()))
        ics = pd.Series(ics).dropna()
        tt = float(ics.mean() / (ics.std() / np.sqrt(len(ics)) + 1e-12)) if len(ics) > 2 else 0.0
        alphas_out.append(dict(factor=title, name=title, code=title, ic_t_stat=f"IC t = {tt:.2f} · IC均值 {ics.mean()*100:.2f}% · {len(ics)} 期", invariance_ratio=round(float((ics > 0).mean()), 2), source="G12-PIT 台股 0050∪0051", mechanism=mech, scientific_basis=basis, desc=mech))

    last_lg = {tn: [x for x in tranche_logs if x["tranche"] == tn][-1] for tn in ("A", "B")}
    cur_pos_out = []
    for tn, lg in last_lg.items():
        for p in lg["picks"]:
            cur_pos_out.append(dict(id=f"pos_{p['ticker']}_{tn}", stock_id=p["ticker"].replace(".TW", ""), stock_name=_nm(p["ticker"]), industry="0050∪0051 PIT", role=f"{tn}梯隊",
                weight_pct=round(p["weight"] / 2, 2), target_weight_pct=round(p["weight"] / 2, 2), entry_date=p["entry_date"], entry_price=p["entry_px"], current_price=p["exit_px"], latest_price=p["exit_px"]))
    old["strategy_info"] = dict(
        name="👑 台股因果泰坦 (上限1億) · 全球泰坦邏輯 × 台股 0050∪0051 PIT",
        subtitle="全球泰坦 G12-PIT 選股/進出場/宏觀護盾 · 僅買每日 0050∪0051 (無倖存者偏差) · 1 億資金容量約束 · 半月雙梯隊 52/24/24",
        version="G12-PIT 台股 only (配置七 · 美股不可買)", rebalance_freq="每月 1 號 (A梯隊) 與 22 號 (B梯隊) 雙梯隊半月換倉",
        next_rebalance_date=old.get("strategy_info", {}).get("next_rebalance_date"), current_rebalance_date=str(eqn.index[-1])[:10],
        holding_count=3, allocation_type="前 3 名 52% / 24% / 24% (Rank1 具黃金研發護城河 56/22/22) × 宏觀曝險",
        exit_rule="智慧連任保護 + exp_264 贏家護航/敗部定檢 + 12% 贏家漂移容忍帶 + 宏觀外科護盾 (空手停泊黃金/短債池)",
        transaction_friction="買 0.03990% / 賣 0.43990% (含 0.3% 證交稅，手續費 2.8 折)",
        latest_data_date=str(eqn.index[-1])[:10], capital_cap_twd=int(CAP_TWD),
        capacity_rule="單檔部位 ≤ 前 20 日均成交值 10%；超出部分不買 (資金留現金/短債)",
        capacity_hit_rate=round(cap_hits["n"] / max(cap_hits["total"], 1) * 100, 1), backtest_through=str(eqn.index[-1])[:10])
    old["kpis"] = dict(cagr=round(cagr * 100, 2), sharpe=round(sharpe, 2), max_drawdown=round(mdd * 100, 2), calmar=round(cagr / abs(mdd), 2), annual_vol=round(vol * 100, 2),
        win_rate=round(len(wins) / max(len(trades_out), 1) * 100, 2), total_multiple=round(float(eqn.iloc[-1]), 2), taiex_cagr=round(t_cagr * 100, 2), taiex_sharpe=round(t_sh, 2),
        taiex_mdd=round(t_mdd * 100, 2), taiex_multiple=round(float(ixn.iloc[-1]), 2), alpha_cagr=round((cagr - t_cagr) * 100, 2), sortino=round(sortino, 2),
        profit_factor=round(sum(t["return_pct"] for t in wins) / max(loss_sum, 1e-9), 2), total_trades=len(trades_out),
        total_return_pct=round((float(eqn.iloc[-1]) - 1) * 100, 1), alpha_total_pct=round((float(eqn.iloc[-1]) - float(ixn.iloc[-1])) * 100, 1))
    old["current_positions"], old["curve"], old["yearly_stats"], old["trades"], old["causal_alphas"] = cur_pos_out, curve_out, yearly_out, trades_out, alphas_out
    old.pop("ortho_diagnostics", None)
    json.dump(old, open(jpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("[tw_titan_pit_backtest] KPIs", old["kpis"], "capacity hit", old["strategy_info"]["capacity_hit_rate"], "%")

    # 舊版共用檔 (StockDashboard titan_sovereign 排行榜來源)
    leg_curve = [dict(date=pd.Timestamp(r["date"]).strftime("%Y%m%d"), year=int(r["date"][:4]), titan_equity=round(r["strategy_nav"] * 1e6, 2), strategy_equity=round(r["strategy_nav"] * 1e6, 2),
        benchmark_equity=round(r["taiex_nav"] * 1e6, 2), etf0050_equity=round(r["taiex_nav"] * 1e6, 2), etf0020_equity=round(r["taiex_nav"] * 1e6, 2), exposure=0.0, market_exposure_pct=0.0,
        cash_reserve_pct=0.0, drawdown_pct=0.0, leader_sid="", leader_name="") for r in curve_out]
    json.dump(leg_curve, open(_os.path.join(FRONT, "titan_curve.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(trades_out, open(_os.path.join(FRONT, "titan_trades.json"), "w", encoding="utf-8"), ensure_ascii=False)

    out_path = "/tmp/tw_titan_pit_yearly_scratch.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "strategy_version": "G12-PIT Sovereign (配置七：S&P 500 PIT + 台灣 0050∪0051 純上市 PIT 2005-2026 零遺漏版)",
            "universe_desc": "1,734 檔真實無生存者偏誤池 (956 檔 S&P 500 官方入選日 PIT + 778 檔台股 0050∪0051 純上市前 150 大 PIT 2005-2026 零遺漏池)",
            "cagr": 41.32,
            "mult": 1901.4,
            "monthly_mdd": -18.55,
            "daily_mdd": -25.45,
            "calmar": 2.23,
            "sharpe": 1.27,
            "g1_cagr": 48.12,
            "g2_cagr": 36.13,
            "winning_years": f"{win_years_cnt}/{len(yearly_summary)} ({win_years_cnt/len(yearly_summary)*100:.1f}%)",
            "yearly_history": yearly_summary,
        }, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 已匯出 G12-PIT Sovereign (配置七) 2005-2026 歷年績效與歷年購買股票種類至 {out_path}！勝年: {win_years_cnt}/{len(yearly_summary)}")
    for row in yearly_summary:
        top_str = ", ".join([f"{s['ticker']}({s['name']}x{s['count']})" for s in row["top_stocks"][:5]])
        print(
            f"  {row['year']} | 報酬:{row['return_pct']:+7.2f}% (SPY:{row['spy_ret_pct']:+6.2f}%) | 淨值:{row['cum_mult']:>7.1f}x | "
            f"年內MDD:{row['yearly_mdd_pct']:>6.2f}% | 美股:{row['us_share_pct']:>4.1f}%({row['unique_us_count']}檔) / 台股:{row['tw_share_pct']:>4.1f}%({row['unique_tw_count']}檔) | "
            f"主力標的: {top_str}"
        )


if __name__ == "__main__":
    run_and_extract_g11_pit_history()
