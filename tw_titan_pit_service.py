"""
tw_titan_pit_service.py
台股因果泰坦 (上限1億) 即時層：以本機 tw_stock.db 即時運算「全球泰坦邏輯 × 僅台股 0050∪0051」的最新持股與宏觀曝險，
並寫回前端 taiwan_causal_titan_data.json (回測區塊由 tw_titan_pit_backtest.py 產生，本檔不改動)。

與回測一致之處：選股排序 = 全球泰坦 G12 評分；僅台股候選；前 3 名固定 52/24/24 (已移除研發強度 56/22/22 加碼)；
宏觀曝險 = 護盾前基礎曝險 × 以「台股 Top5」重算的外科五重護盾 (C1/C2/C3/C4/C6) 與深熊 V 轉。
"""
import json
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "taiwan_causal_titan_data.json")
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")


def db_latest_date() -> str:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    try:
        return conn.execute("SELECT MAX(date) FROM daily_index").fetchone()[0] or ""
    finally:
        conn.close()


def snapshot_date() -> str:
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            return str(json.load(f).get("strategy_info", {}).get("latest_data_date", "")).replace("-", "")
    except Exception:
        return ""


def _shield_exposure(ms: dict, tw_top5: list, base_exp: float):
    """複製 global_sovereign_service 的外科護盾決策鏈，但以台股 Top5 的 IO 吸籌統計判斷。"""
    n = max(1, len(tw_top5))
    neg20 = sum(1 for x in tw_top5 if float(x.get("io_20") or 0.0) <= 0.0)
    neg5 = sum(1 for x in tw_top5 if float(x.get("io_5") or 0.0) <= 0.0)
    avg20 = sum(float(x.get("io_20") or 0.0) for x in tw_top5) / n
    c_br = float(ms.get("global_breadth_pct", 50.0)) / 100.0
    u10, u10c = float(ms.get("us10y", 4.0)), float(ms.get("us10y_chg20", 0.0))
    z60, slp = float(ms.get("pc_oi_z60", 0.0)), float(ms.get("pc_oi_slope10", 0.0))
    qb = float(ms.get("qqq_bias500", 0.0))
    q60, q20, s20 = bool(ms.get("qqq_below_ma60")), bool(ms.get("qqq_below_ma20")), bool(ms.get("spy_below_ma20"))
    rs = float(ms.get("rs_qqq_spy_20_pct", 0.0)) / 100.0
    bd10 = float(ms.get("br_delta10_pct", 0.0)) / 100.0
    c1 = c_br >= 0.50 and (u10c >= 0.20 and z60 < -0.45 and slp < -1.5 and qb >= 15.0)
    c2 = c_br >= 0.50 and (q60 and rs < -0.04 and avg20 < -0.03 and z60 < 0.0)
    c3 = c_br >= 0.50 and (neg20 >= 4 and neg5 >= 4 and avg20 <= -0.08 and (s20 or u10c >= 0.35))
    c4 = c_br >= 0.50 and (u10c >= 0.22 and ((qb >= 22.0 and rs < 0.0) or (u10 >= 4.0 and u10c >= 0.35)))
    c6 = 0.30 <= c_br < 0.50 and (q60 and s20 and rs < -0.01)
    vt = c_br < 0.30 and (not q20) and (bd10 >= 0.08) and (avg20 > 0.02)
    exp, tag = base_exp, "全球共振多頭，無護盾觸發"
    if c6 and base_exp > 20:
        exp, tag = 20, "C6 雙指數破線共振減震 (20%)"
    elif c4 and base_exp > 45:
        exp, tag = 45, "C4 利率急升×科技轉弱護盾 (45%)"
    elif c3 and base_exp > 60:
        exp, tag = 60, "C3 領頭羊全面倒貨減震 (60%)"
    elif c2 and base_exp > 65:
        exp, tag = 65, "C2 科技破線落後減震 (65%)"
    elif c1 and base_exp > 72:
        exp, tag = 72, "C1 美債急升×期權莊家退場減震 (72%)"
    elif vt:
        exp, tag = 82, "深熊極底部 V 轉先遣部隊 (82%)"
    elif base_exp <= 0:
        tag = f"宏觀寬幅 {c_br*100:.1f}% 過低，全數空手停泊黃金/短債"
    return exp, tag, dict(top5_neg_io20=neg20, top5_neg_io5=neg5, top5_avg_io20=round(avg20, 4))


def refresh_live() -> dict:
    import global_sovereign_service as gss
    live = gss.get_global_sovereign_dashboard_data()
    ms = live.get("macro_status", {}) or {}
    ranked = list(live.get("tw_only_ranked") or [])

    # 產業分散 (同族群 1 檔，其餘遞補) + Rank 2~5 以 sniper_score 重排 (與全球泰坦一致)
    div, used, overflow = [], set(), []
    for p in ranked:
        g = p.get("industry_group", p["ticker"])
        (overflow if g in used else div).append(p)
        used.add(g)
    ranked = div + overflow
    if len(ranked) > 2:
        pool = sorted(ranked[1:5], key=lambda x: float(x.get("sniper_score") or x.get("score") or 0.0), reverse=True)
        ranked = [ranked[0]] + pool + ranked[5:]

    base_exp = float(ms.get("pre_shield_exposure_pct", ms.get("exposure_pct", 100)))
    exp_pct, shield_tag, top5_stats = _shield_exposure(ms, ranked[:5], base_exp)
    weights = [52, 24, 24]

    positions = []
    if exp_pct > 0:
        for i, p in enumerate(ranked[:3]):
            w = weights[i] * exp_pct / 100.0
            price, ma60 = float(p.get("price") or 0.0), float(p.get("ma60") or 0.0)
            sid = str(p["ticker"]).replace(".TW", "")
            positions.append(dict(
                id=f"pos_{sid}", stock_id=sid, stock_name=str(p.get("name", sid)).split(" (")[0], industry=p.get("pool_source", "0050∪0051 PIT"),
                role=["👑 Rank1 王者", "🚀 Rank2", "⚡ Rank3"][i] + f" ({w:.0f}%)", weight_pct=round(w, 2), target_weight_pct=round(w, 2),
                entry_date="", entry_price=price, current_price=price, latest_price=price, unrealized_return_pct=0.0, pnl_pct=0.0, holding_days=0,
                stop_loss_price=round(ma60, 2), ma60_stop_price=round(ma60, 2), stop_loss_ma60=round(ma60, 2),
                dist_to_stop_pct=round((price / ma60 - 1) * 100, 2) if ma60 else 0.0, stop_loss_pct=round((price / ma60 - 1) * 100, 2) if ma60 else 0.0,
                stop_condition="全球泰坦：連任保護 / 贏家護航 / 敗部定檢；破 60MA 或排名掉出將於下次換倉日換出",
                strategy_current_price=price, price_date=p.get("price_date", ""), highlight=p.get("smart_entry_tag") or p.get("winrate_tag") or "",
                score=p.get("score"), smart_entry_desc=p.get("smart_entry_desc", "")))

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    latest = str(live.get("latest_tw_date") or live.get("latest_data_date") or "")
    data["current_positions"] = positions
    data["strategy_info"]["holding_count"] = len(positions)
    data["strategy_info"]["latest_data_date"] = latest
    data["strategy_info"]["current_rebalance_date"] = latest
    data["live_signal"] = dict(
        generated_at=live.get("generated_at"), exposure_pct=exp_pct, base_exposure_pct=base_exp, shield=shield_tag, global_regime=ms.get("regime", ""),
        breadth_pct=ms.get("global_breadth_pct"), qqq_bias500=ms.get("qqq_bias500"), us10y=ms.get("us10y"),
        ranked=[dict(rank=i + 1, stock_id=str(p["ticker"]).replace(".TW", ""), name=str(p.get("name", "")).split(" (")[0], score=p.get("score"), price=p.get("price")) for i, p in enumerate(ranked[:8])],
        **top5_stats)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    return data


def _sync_market_ml(d: dict):
    """同步 defaultMarketMlData.json 內 titan_sovereign 的名稱/績效/訊號 (StockDashboard 排行榜來源之一)。"""
    mp = os.path.join(BASE_DIR, "frontend", "src", "data", "defaultMarketMlData.json")
    with open(mp, "r", encoding="utf-8") as f:
        mm = json.load(f)
    x = mm["models"]["titan_sovereign"]
    K, sig, pos = d["kpis"], d["live_signal"], d["current_positions"]
    x["name"] = "👑 台股因果泰坦 (上限1億 · 全球泰坦邏輯 × 0050∪0051 PIT · 22年 %d倍)" % round(K["total_multiple"])
    x["short_name"] = "👑 台股因果泰坦 (0050∪0051 PIT)"
    x["tag"] = "👑 22年+%d%% (%d倍)・CAGR %.1f%%・夏普%.2f・MDD %.2f%%" % (round(K["total_return_pct"]), round(K["total_multiple"]), K["cagr"], K["sharpe"], K["max_drawdown"])
    x["desc"] = ("台股因果泰坦 (上限1億)：全球泰坦 G12-PIT 邏輯，僅買每日 0050∪0051 (無倖存者偏差)，半月雙梯隊前 3 名 52/24/24 + 宏觀護盾，套用 1 億資金容量約束。"
                 "22年回測 %.1f 倍 (CAGR %.2f%%)，夏普 %.2f，最大回撤 %.2f%%。" % (K["total_multiple"], K["cagr"], K["sharpe"], K["max_drawdown"]))
    x["metrics"] = dict(sharpe=K["sharpe"], cagr=K["cagr"], mdd=K["max_drawdown"], win_rate=K["win_rate"], calmar=K["calmar"], composite_score=x.get("metrics", {}).get("composite_score", 0))
    x["total_return_pct"], x["cagr_pct"], x["max_drawdown_pct"] = K["total_return_pct"], K["cagr"], K["max_drawdown"]
    x["sharpe_ratio"], x["calmar_ratio"], x["win_rate_pct"], x["total_trades"] = K["sharpe"], K["calmar"], K["win_rate"], K["total_trades"]
    names = "、".join(p["stock_name"] for p in pos)
    if pos:
        x["prediction"].update(signal="bullish", signal_badge=f"👑 台股泰坦持股 {len(pos)} 檔・曝險 {sig['exposure_pct']:.0f}%", signal_desc=f"目前持股：{names}")
    else:
        x["prediction"].update(signal="neutral", signal_badge="🛡️ 宏觀護盾空手", signal_desc=f"{sig['shield']}，資金停泊黃金/短債池")
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(mm, f, ensure_ascii=False)


def run() -> str:
    d = refresh_live()
    try:
        _sync_market_ml(d)
    except Exception as e:
        print(f"[x] 同步 defaultMarketMlData 失敗: {e}")
    sig = d["live_signal"]
    return f"written 台股因果泰坦(0050∪0051) 即時訊號 {d['strategy_info']['latest_data_date']} 曝險 {sig['exposure_pct']:.0f}% 持股 {len(d['current_positions'])} 檔 ({sig['shield']})"


if __name__ == "__main__":
    print(run())
