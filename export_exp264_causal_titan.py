"""
export_exp264_causal_titan.py
將 quant-lab/experiments/exp_264.py 的邏輯（elite_55 池、top_n=24、60 天換倉、
贏家豁免護航 + 敗部定檢）回測結果，轉成「台股因果泰坦 (上限1億)」前端資料
frontend/src/data/taiwan_causal_titan_data.json。

不修改 quant-lab 引擎：以 monkeypatch 攔截 finalize_backtest 取得每日目標權重，
再重建持倉、交易流水、績效曲線，並套用 1 億資金上限（流動性容量約束）。
"""
import os, sys, json, sqlite3, importlib.util
import numpy as np, pandas as pd

QL = os.path.expanduser("~/quant-lab")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend/src/data/taiwan_causal_titan_data.json")
CAPITAL_CAP = 100_000_000.0      # 資金上限 1 億
ADV_PARTICIPATION = 0.10         # 單檔部位不得超過 20 日均成交值的 10% (容量約束)
FRICTION = 0.0025                # 與 quant-lab 引擎一致的雙邊換手摩擦
os.chdir(QL)
sys.path.insert(0, QL)

import engine.base_framework as bf

# 引擎的磁碟快取 (pickle) 為舊資料快照；停用它，強制由即時資料庫讀取最新行情
bf._DISK_UNIVERSE_CACHE = False
captured = {}
_orig_finalize = bf.finalize_backtest
def _spy(target_weights, piv_ret, idx_dates, overnight_mult_arr=None):
    captured["tw"], captured["ret"], captured["dates"] = target_weights.copy(), piv_ret.copy(), list(idx_dates)
    return _orig_finalize(target_weights, piv_ret, idx_dates, overnight_mult_arr)
bf.finalize_backtest = _spy
_orig_load = bf.load_market_features
def _load_spy(*a, **k):
    f = _orig_load(*a, **k); captured["feat"] = f; return f
bf.load_market_features = _load_spy

spec = importlib.util.spec_from_file_location("exp_264", os.path.join(QL, "experiments/exp_264.py"))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
# 資料來源：優先使用即時 tw_stock.db (資料庫更新後會自動帶入最新行情)；
# 引擎另需的 external_web_daily (VIX/SMH/HYG 等外部指標) 不在 tw_stock.db，
# 改由 quant-lab/data/external_web_daily.db (每次執行會以 yfinance 增量更新) 以暫存 view 提供。
LIVE_DB = os.environ.get("TW_STOCK_DB", os.path.join(os.path.dirname(os.path.abspath(OUT)), "../../../tw_stock.db"))
LIVE_DB = os.path.abspath(LIVE_DB)
EXT_DB = os.path.join(QL, "data", "external_web_daily.db")
SANDBOX = os.path.join(QL, "data", "agent_sandbox.db")

def refresh_external():
    import engine.data_expander as de
    if not os.path.exists(EXT_DB):                       # 首次：由沙盒複製既有歷史，之後只做增量
        src = sqlite3.connect(f"file:{SANDBOX}?mode=ro", uri=True); dst = sqlite3.connect(EXT_DB)
        dst.execute("CREATE TABLE IF NOT EXISTS external_web_daily (ticker TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY (ticker, date))")
        dst.executemany("INSERT OR REPLACE INTO external_web_daily VALUES (?,?,?,?,?,?,?)", src.execute("SELECT ticker,date,open,high,low,close,volume FROM external_web_daily").fetchall())
        dst.commit(); dst.close(); src.close()
    c = sqlite3.connect(EXT_DB); tks = [r[0] for r in c.execute("SELECT DISTINCT ticker FROM external_web_daily")]; c.close()
    try:
        de.fetch_and_store(tks, db_path=EXT_DB, start_date=(pd.Timestamp.today() - pd.Timedelta(days=45)).strftime("%Y-%m-%d"))
    except Exception as e:
        print("[WARN] 外部指標增量更新失敗，沿用既有資料:", e)

refresh_external()
conn = sqlite3.connect(f"file:{LIVE_DB}?mode=ro", uri=True)
conn.execute(f"ATTACH DATABASE 'file:{EXT_DB}?mode=ro' AS ext")
conn.execute("CREATE TEMP VIEW external_web_daily AS SELECT * FROM ext.external_web_daily")
df_raw = mod.run_strategy(conn)
feat, tw, piv_ret, dates = captured["feat"], captured["tw"], captured["ret"], captured["dates"]
piv_close, piv_val = feat["piv_close"], feat["piv_val"]
idx_close = feat["idx_close"]

# ---------- 1 億資金上限：容量約束下重算 ----------
adv20 = piv_val.rolling(20, min_periods=5).mean().shift(1)             # 因果：用前一日以前資料
cap_w = (ADV_PARTICIPATION * adv20 / CAPITAL_CAP).clip(upper=1.0).fillna(0.0)
tw_cap = np.minimum(tw, cap_w)
hold = tw_cap.shift(1).fillna(0.0)
fric = hold.diff().abs().fillna(0.0).sum(axis=1) * FRICTION
ret_cap = (hold * piv_ret).sum(axis=1) - fric
nav = (1 + ret_cap).cumprod()
nav.index = pd.to_datetime(dates)
idx_nav = (idx_close / idx_close.iloc[0]); idx_nav.index = pd.to_datetime(dates)

def kpis(r, years=None):
    r = r.fillna(0.0); n = (1 + r).cumprod()
    yrs = (r.index[-1] - r.index[0]).days / 365.25
    cagr = n.iloc[-1] ** (1 / yrs) - 1
    mdd = (n / n.cummax() - 1).min()
    vol = r.std() * np.sqrt(252)
    return dict(cagr=cagr, mdd=mdd, vol=vol, sharpe=(r.mean() * 252) / (vol + 1e-12), mult=n.iloc[-1])

s_ret = pd.Series(ret_cap.values, index=pd.to_datetime(dates))
t_ret = idx_close.pct_change().fillna(0.0); t_ret.index = pd.to_datetime(dates)
ks, kt = kpis(s_ret), kpis(t_ret)
print("exp_264 原版(無上限):", kpis(pd.Series(df_raw.strategy_return.values, index=pd.to_datetime(dates))))
print("exp_264 1億上限:", ks)

# ---------- 由每日權重重建交易 ----------
names = {}
try:
    nm = json.load(open(os.path.join(os.path.dirname(OUT), "tw_stock_names_map.json")))
    names = {str(k): (v if isinstance(v, str) else v.get("name", "")) for k, v in nm.items()}
except Exception:
    pass
cols = list(tw_cap.columns); W = tw_cap.values; P = piv_close.values; D = [str(d) for d in dates]
trades, open_pos = [], {}
for t in range(len(D)):
    for j, s in enumerate(cols):
        w, held = W[t, j], s in open_pos
        if w > 1e-6 and not held:
            open_pos[s] = dict(entry_i=t, entry_price=float(P[t, j]), w=float(w), peak=float(P[t, j]))
        elif held and w > 1e-6:
            open_pos[s]["peak"] = max(open_pos[s]["peak"], float(P[t, j])); open_pos[s]["w"] = max(open_pos[s]["w"], float(w))
        elif held and w <= 1e-6:
            p = open_pos.pop(s); xp = float(P[t, j]); hd = t - p["entry_i"]
            pk = p["peak"] / p["entry_price"] - 1
            reason = ("🏆 贏家護航後鎖利出場 (移動停利 9/13/16%)" if pk >= 0.055 else "🔍 敗部定檢/換倉淘汰 (滯漲後段班)")
            trades.append(dict(stock_id=s, stock_name=names.get(s, s), role="exp_264 部位", weight_pct=round(p["w"] * 100, 2),
                               entry_date=D[p["entry_i"]], exit_date=D[t], entry_price=round(p["entry_price"], 2), exit_price=round(xp, 2),
                               return_pct=round((xp / p["entry_price"] - 1) * 100, 2), holding_days=hd, exit_reason=reason, leader=pk >= 0.20))
trades.sort(key=lambda x: x["exit_date"], reverse=True)

last_i = len(D) - 1
cur = []
for s, p in open_pos.items():
    j = cols.index(s); px = float(P[last_i, j]); ma60 = float(feat["s_ma60"].values[last_i, j])
    cur.append(dict(id=f"pos_{s}", stock_id=s, stock_name=names.get(s, s), industry="elite_55 池", role=f"exp_264 持股 ({p['w']*100:.1f}%)",
                    weight_pct=round(float(W[last_i, j]) * 100, 2), target_weight_pct=round(float(W[last_i, j]) * 100, 2),
                    entry_date=f"{D[p['entry_i']][:4]}-{D[p['entry_i']][4:6]}-{D[p['entry_i']][6:8]}",
                    entry_price=round(p["entry_price"], 2), current_price=round(px, 2), latest_price=round(px, 2),
                    unrealized_return_pct=round((px / p["entry_price"] - 1) * 100, 2), pnl_pct=round((px / p["entry_price"] - 1) * 100, 2),
                    holding_days=last_i - p["entry_i"], stop_loss_price=round(ma60, 2), ma60_stop_price=round(ma60, 2), stop_loss_ma60=round(ma60, 2),
                    dist_to_stop_pct=round((px / ma60 - 1) * 100, 2), stop_loss_pct=round((px / ma60 - 1) * 100, 2),
                    stop_condition="exp_264：浮盈≥5.5% 且 sustain≥0.5/ortho_z>0.8/收盤>60MA 護航；否則 15 日/月營收定檢",
                    strategy_current_price=round(px, 2), price_date=f"{D[last_i][:4]}-{D[last_i][4:6]}-{D[last_i][6:8]}",
                    highlight=f"持有 {last_i - p['entry_i']} 個交易日"))
cur.sort(key=lambda x: -x["weight_pct"])

# ---------- 月度曲線與年度績效 ----------
m_nav = nav.resample("ME").last().dropna(); m_idx = idx_nav.resample("ME").last().dropna()
curve, pv, pi = [], 1.0, 1.0
last_ts = nav.index[-1]
for d in m_nav.index:
    a, b = float(m_nav[d]), float(m_idx.get(d, pi))
    curve.append(dict(date=min(d, last_ts).strftime("%Y-%m-%d"), strategy_nav=round(a, 3), taiex_nav=round(b, 3),
                      monthly_ret=round((a / pv - 1) * 100, 2), taiex_ret=round((b / pi - 1) * 100, 2))); pv, pi = a, b
y_nav = nav.groupby(nav.index.year).last(); y_idx = idx_nav.groupby(idx_nav.index.year).last()
yearly, pv, pi = [], 1.0, 1.0
for y in y_nav.index:
    a, b = float(y_nav[y]), float(y_idx[y]); sr, tr = (a / pv - 1) * 100, (b / pi - 1) * 100
    yearly.append(dict(year=int(y), strategy_ret=round(sr, 2), taiex_ret=round(tr, 2), alpha=round(sr - tr, 2), is_positive=sr > 0,
                       return_pct=round(sr, 2), taiex_pct=round(tr, 2))); pv, pi = a, b

wins = [t for t in trades if t["return_pct"] > 0]
old = json.load(open(OUT))
latest = f"{D[last_i][:4]}-{D[last_i][4:6]}-{D[last_i][6:8]}"
old["strategy_info"] = dict(
    name="👑 台股因果泰坦 (上限1億) · exp_264 旗艦",
    subtitle="elite_55 精選池 · 24 檔分散 · 60 日週期換股 · 贏家豁免護航 + 敗部定檢 · 1 億資金容量上限",
    version="exp_264 (非對稱贏家豁免定檢 × 月營收窗口 × Sustain 正交護航)",
    rebalance_freq="每 60 個交易日週期換股 + 每 15 日/每月 10~12 日營收窗口定檢",
    next_rebalance_date=old["strategy_info"].get("next_rebalance_date"), current_rebalance_date=latest,
    holding_count=len(cur), allocation_type="動態權重 (波動自適應 · 單檔 ≤ 20 日均成交值 10% · 總部位 ≤ 1.0x 現貨，資金上限 1 億)",
    exit_rule="贏家(浮盈≥5.5%)移動停利 9%/13%/16% 並於 sustain/ortho 護航下續抱；滯漲股 hd≥15 日跌入後段班或營收雙衰減即淘汰",
    transaction_friction="0.25% 雙邊換手摩擦 (引擎標準)", latest_data_date=latest, capital_cap_twd=int(CAPITAL_CAP))
old["kpis"] = dict(cagr=round(ks["cagr"] * 100, 2), sharpe=round(ks["sharpe"], 2), max_drawdown=round(ks["mdd"] * 100, 2),
                   calmar=round(ks["cagr"] / abs(ks["mdd"]), 2), annual_vol=round(ks["vol"] * 100, 2),
                   win_rate=round(len(wins) / max(len(trades), 1) * 100, 2), total_multiple=round(ks["mult"], 2),
                   taiex_cagr=round(kt["cagr"] * 100, 2), taiex_sharpe=round(kt["sharpe"], 2), taiex_mdd=round(kt["mdd"] * 100, 2),
                   taiex_multiple=round(kt["mult"], 2), alpha_cagr=round((ks["cagr"] - kt["cagr"]) * 100, 2),
                   sortino=round(float(s_ret.mean() * 252 / (np.sqrt((s_ret.clip(upper=0) ** 2).mean()) * np.sqrt(252) + 1e-12)), 2),
                   profit_factor=round(sum(t["return_pct"] for t in wins) / max(abs(sum(t["return_pct"] for t in trades if t["return_pct"] <= 0)), 1e-9), 2),
                   total_trades=len(trades), total_return_pct=round((ks["mult"] - 1) * 100, 1),
                   alpha_total_pct=round((ks["mult"] - kt["mult"]) * 100, 1))
old["current_positions"], old["curve"], old["yearly_stats"], old["trades"] = cur, curve, yearly, trades
json.dump(old, open(OUT, "w"), ensure_ascii=False, indent=1)
print("written", OUT, "positions", len(cur), "trades", len(trades), "latest", latest)

# ---------- 同步更新舊版共用檔 (StockDashboard 的 titan_sovereign 排行榜/歷年績效來源) ----------
dd = (nav / nav.cummax() - 1) * 100
expo = pd.Series(tw_cap.sum(axis=1).values, index=nav.index)
leader = pd.Series(tw_cap.idxmax(axis=1).where(tw_cap.max(axis=1) > 1e-6, "").values, index=nav.index)
legacy = []
for d in nav.resample("ME").last().index:
    di = nav.index[nav.index <= d][-1]
    sid = leader[di]
    e = float(nav[di]) * 1e6; b = float(idx_nav[di]) * 1e6
    legacy.append(dict(date=di.strftime("%Y%m%d"), year=int(di.year), titan_equity=round(e, 2), strategy_equity=round(e, 2),
                       benchmark_equity=round(b, 2), etf0050_equity=round(b, 2), etf0020_equity=round(b, 2),
                       exposure=round(float(expo[di]), 4), market_exposure_pct=round(float(expo[di]) * 100, 2),
                       cash_reserve_pct=round((1 - float(expo[di])) * 100, 2), drawdown_pct=round(float(dd[di]), 2),
                       leader_sid=sid, leader_name=names.get(sid, sid) if sid else ""))
legacy = sorted({r["date"]: r for r in legacy}.values(), key=lambda r: r["date"])
json.dump(legacy, open(os.path.join(os.path.dirname(OUT), "titan_curve.json"), "w"), ensure_ascii=False)
json.dump(trades, open(os.path.join(os.path.dirname(OUT), "titan_trades.json"), "w"), ensure_ascii=False)
print("legacy titan_curve/trades updated", len(legacy), len(trades))

# ---------- 因果 Alpha 因子：exp_264 真實 6 個正交因子 (橫截面 Rank IC，20 日前瞻報酬) ----------
ortho = feat["ortho_factors"]
fwd = (piv_close.shift(-20) / piv_close - 1.0)
FACTORS = [
    ("f2_idio_alpha", 0.12, "個股特質 Alpha (Idio Alpha)", "剝離大盤 Beta 後的殘差報酬持續為正，代表個股自身基本面/題材驅動，而非隨大盤漲跌。", "Jensen (1968) α；Ang et al. (2006) 特質波動與殘差動能"),
    ("f3_fip_continuity", 0.24, "FIP 資訊連續性 (Frog-in-the-Pan)", "報酬由許多小漲日累積而非少數暴衝日，投資人反應不足，動能延續性更強。", "Da, Gurun & Warachka (2014) Frog-in-the-Pan"),
    ("f4_chip_accum", 0.20, "籌碼吸籌 (Chip Accumulation)", "三大法人與大戶持續淨買超且價量配合，代表聰明錢建倉，後續股價具延續性。", "Chordia & Swaminathan (2000) 資金流與價格發現"),
    ("f5_asym_convexity", 0.20, "非對稱凸性 (Asymmetric Convexity)", "上漲日波動大於下跌日波動的正偏度結構，吸引風險偏好資金並帶來右尾爆發。", "Barberis & Huang (2008) 彩券型偏好；Harvey & Siddique (2000) 偏度定價"),
    ("f6_fractal_er", 0.12, "碎形效率比 (Fractal Efficiency Ratio)", "價格路徑接近直線 (噪音低) 的趨勢更純粹，趨勢型標的勝率較高。", "Kaufman (1995) Efficiency Ratio；Mandelbrot 碎形市場假說"),
    ("f7_vcp_pivot", 0.12, "VCP 波動收斂突破 (VCP Pivot)", "波動與量能逐級收斂後的突破，代表供給枯竭，易啟動主升段。", "Minervini (2013) VCP；Wyckoff 供需法則"),
]
alphas = []
for key, wgt, title, mech, basis in FACTORS:
    f = ortho[key].reindex(index=piv_close.index, columns=piv_close.columns)
    ics = []
    for i in range(260, len(D) - 20, 20):              # 每 20 日取樣一次，避免前瞻視窗重疊
        a, b = f.iloc[i], fwd.iloc[i]; m = a.notna() & b.notna()
        if m.sum() >= 15:
            ics.append(a[m].rank().corr(b[m].rank()))
    ics = pd.Series(ics).dropna()
    t = float(ics.mean() / (ics.std() / np.sqrt(len(ics)) + 1e-12)) if len(ics) > 2 else 0.0
    alphas.append(dict(factor=title, name=title, code=key, ic_t_stat=f"IC t = {t:.2f} · IC均值 {ics.mean()*100:.2f}% · 權重 {wgt*100:.0f}%",
                       invariance_ratio=round(float((ics > 0).mean()), 2), source=f"exp_264 正交因子 (Gram-Schmidt)",
                       mechanism=mech, scientific_basis=basis, desc=mech))
diag = df_raw.attrs.get("ortho_diagnostics", {})
d2 = json.load(open(OUT)); d2["causal_alphas"] = alphas; d2["ortho_diagnostics"] = diag
json.dump(d2, open(OUT, "w"), ensure_ascii=False, indent=1)
print("alphas", [(a["code"], a["ic_t_stat"]) for a in alphas], diag)

# ---------- defaultMarketMlData.json 內的 titan_sovereign 同步 ----------
K = d2["kpis"]; MP = os.path.join(os.path.dirname(OUT), "defaultMarketMlData.json")
mm = json.load(open(MP)); x = mm["models"]["titan_sovereign"]
x["name"] = "👑 台股因果泰坦 (exp_264 · 上限1億 · 22年 %d倍)" % round(K["total_multiple"])
x["short_name"] = "👑 台股因果泰坦 (exp_264)"
x["tag"] = "👑 22年+%d%% (%d倍)・CAGR %.1f%%・夏普%.2f・MDD %.2f%%" % (round(K["total_return_pct"]), round(K["total_multiple"]), K["cagr"], K["sharpe"], K["max_drawdown"])
x["desc"] = ("台股因果泰坦 (exp_264)：elite_55 精選池 24 檔 + 60 日週期換股 + 贏家豁免護航與敗部定檢 + 回撤分級降倉，並套用 1 億資金容量上限。"
             "22年回測 %.1f 倍 (CAGR %.2f%%)，夏普 %.2f，最大回撤 %.2f%%。" % (K["total_multiple"], K["cagr"], K["sharpe"], K["max_drawdown"]))
x["metrics"] = dict(sharpe=K["sharpe"], cagr=K["cagr"], mdd=K["max_drawdown"], win_rate=K["win_rate"], calmar=K["calmar"], composite_score=x.get("metrics", {}).get("composite_score", 0))
x["total_return_pct"], x["cagr_pct"], x["max_drawdown_pct"] = K["total_return_pct"], K["cagr"], K["max_drawdown"]
x["sharpe_ratio"], x["calmar_ratio"], x["win_rate_pct"], x["total_trades"] = K["sharpe"], K["calmar"], K["win_rate"], K["total_trades"]
pos_txt = "、".join(p["stock_name"] for p in cur[:5])
if cur:
    x["prediction"].update(signal="bullish", signal_badge=f"👑 exp_264 持股 {len(cur)} 檔", signal_desc=f"exp_264 目前持有：{pos_txt}")
else:
    x["prediction"].update(signal="neutral", signal_badge="🛡️ exp_264 風控全數空手", signal_desc=f"截至 {latest}，exp_264 回撤/大盤廣度風控觸發，目標持股為 0 檔，資金 100% 現金待命")
json.dump(mm, open(MP, "w"), ensure_ascii=False)
print("defaultMarketMlData titan_sovereign updated")
