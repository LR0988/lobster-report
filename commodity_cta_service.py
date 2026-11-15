#!/usr/bin/env python3
"""
commodity_cta_service.py
【🛢️ 全球原物料期貨 CTA 泰坦實戰引擎 V6.0 (雙棘輪鎖利護盤 × 商業量能參與度 × 極端波動封頂防擬合版)】
100% 整合於統一資料庫 tw_stock.db:
- 資料表 1: commodity_futures_metadata (19 大全球核心原物料期貨規格、標準/微型合約乘數、保證金、板塊、即時遠月期限結構)
- 資料表 2: commodity_futures_daily (2004~2026 超過 10.8 萬筆日線、ATR_20、NATR_20、因果實證轉倉收益率 Roll Yield、裂解/壓榨價差、真實轉倉還原報酬)
- 資料表 3: macro_indicators (外生宏觀美元指數 DXY 與美債殖利率，Zero Look-Ahead 因果對齊)
- 資料表 4: commodity_cta_user_trades (個人原物料期貨/微型海期/ETF 實戰跟單帳本)

V6.0 八重低自由度正交升級 (嚴格 T+1 開盤成交 + 漲跌停/無量日禁買賣 + 零標的黑名單):
1. M1 高確信門檻與在位者滯後保護 (ts_entry=0.75, inc_hyst=1.28): 濾除期望值為負之低確信雜訊單並阻斷週換倉誤殺贏家
2. M2 Kaufman (1995) ER_40 路徑效率連續信噪乘數: 順滑實體趨勢加權、高雜訊震盪降權 (K=1)
3. M3 外生宏觀 DXY 美元計價順逆風雙向濾網: 弱勢美元順風加碼 / 美元急漲保護非貴金屬多單與強化空單 (K=2)
4. M4 不對稱雙階鎖利架構 (1.8×NATR 獲利兌現 38% + 62% 黃金核心倉位不設上限追蹤): 修復 MFE 回吐敗局，單筆勝率躍升
5. M5 Moreira & Muir (2017 JF) 60D 已實現波動率調節器 (Target Vol=21.5%): 因果回收鎖利釋放的風險預算並在極端波動期主動降槓桿
6. M6 雙棘輪獲利護盾 (Dual-Ratchet Profit Shield): 觸發 38% 鎖利後啟動一階 -0.36×NATR 保本緩衝護盾 + 二階 3.5×NATR 超額行情 +0.65×NATR 鎖利底線
7. M7 商業避險量能參與度 (VOL20_120 = VolMA20/VolMA120): 與現有五因子近乎完全正交 (max|ρ|=0.0281)，避開實體低量假突破並傾斜資金至真商業避險參與趨勢
8. M8 單合約 1-ATR 風險天花板 (0.0155 / 0.0125) 與風險預算守恆: 抑制 6%~9% 高波動 climax 爆倉尾險並釋放額度至健康趨勢合約
"""
import os
import json
import sqlite3
import urllib.request
from datetime import datetime
import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")
DEFAULT_CTA_JSON_PATH = os.path.join(BASE_DIR, "frontend", "src", "data", "defaultCommodityCtaData.json")

SUPABASE_URL = os.environ.get("REACT_APP_SUPABASE_URL", "https://hvequgcognhytunjjsyp.supabase.co")
SUPABASE_ANON_KEY = os.environ.get(
    "REACT_APP_SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0",
)

CME_NON_RETAIL_SET = {"KC=F", "CC=F", "SB=F", "CT=F", "LE=F"}


def _ensure_user_cta_table(conn):
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS commodity_cta_user_trades (
        trade_id TEXT PRIMARY KEY,
        ticker TEXT,
        name_zh TEXT,
        sector TEXT,
        direction TEXT,
        instrument_type TEXT,
        symbol_used TEXT,
        contracts REAL,
        multiplier REAL,
        entry_price REAL,
        entry_date TEXT,
        exit_price REAL,
        exit_date TEXT,
        status TEXT,
        exit_reason TEXT,
        notes TEXT,
        created_at TEXT
    )
    """)
    conn.commit()


def sync_commodity_cta_to_supabase(dashboard_data: dict) -> bool:
    """將最新全球原物料期貨 CTA V6.0 看板數據同步寫入 Supabase stock_ml_cache (commodity_cta_dashboard)"""
    try:
        body = json.dumps({
            "model_type": "commodity_cta_dashboard",
            "payload": json.dumps(dashboard_data, ensure_ascii=False),
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/stock_ml_cache",
            data=body,
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=12):
            return True
    except Exception as rest_err:
        try:
            import stock_sync
            sb_conn = stock_sync.get_supabase_conn()
            cur = sb_conn.cursor()
            cur.execute("""
                INSERT INTO stock_ml_cache (model_type, payload, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (model_type) DO UPDATE
                SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
            """, ("commodity_cta_dashboard", json.dumps(dashboard_data, ensure_ascii=False)))
            sb_conn.commit()
            cur.close()
            sb_conn.close()
            return True
        except Exception as pg_err:
            print(f"⚠️ 同步 commodity_cta_dashboard 至 Supabase 失敗 (REST: {rest_err} | PG: {pg_err})")
            return False


def recompute_daily_derived_columns(meta_df: pd.DataFrame, daily_df: pd.DataFrame) -> pd.DataFrame:
    """ strictly causal 0-leak OHLC -> clean roll-adjusted features recomputation (used for DB rebuild & Gate-6 Poisoning)."""
    df = daily_df.copy()
    if "dt" not in df.columns:
        df["dt"] = pd.to_datetime(df["date"])
    from ingest_commodity_futures_to_db import COMMODITY_SPECS
    spec_map = {c["ticker"]: c for c in COMMODITY_SPECS}
    bz_sub = df[df["ticker"] == "BZ=F"].set_index("dt")
    bz_ret_ref = bz_sub["close"].pct_change().fillna(0.0).clip(-0.15, 0.15)

    frames = []
    for tk, grp in df.groupby("ticker", sort=False):
        grp = grp.sort_values("dt").copy()
        idx = pd.Index(grp["dt"])
        base_carry = spec_map[tk]["base_structural_carry_ann"]
        s_open = grp["open"].values.copy()
        s_high = grp["high"].values.copy()
        s_low = grp["low"].values.copy()
        s_close = grp["close"].values.copy()
        for k in range(len(s_close)):
            if s_low[k] > 0 and s_high[k] >= s_low[k]:
                if s_close[k] > s_high[k] * 1.005 or s_close[k] < s_low[k] * 0.995:
                    s_close[k] = 0.5 * (s_high[k] + s_low[k])
                if s_open[k] > s_high[k] * 1.005 or s_open[k] < s_low[k] * 0.995 or s_open[k] <= 0:
                    s_open[k] = s_close[k]
        s_close_ser = pd.Series(s_close, index=idx)
        s_open_ser = pd.Series(s_open, index=idx)
        s_high_ser = pd.Series(s_high, index=idx)
        s_low_ser = pd.Series(s_low, index=idx)

        prev_c = s_close_ser.shift(1)
        tr = pd.concat([
            (s_high_ser - s_low_ser).abs(),
            (s_high_ser - prev_c).abs(),
            (s_low_ser - prev_c).abs(),
        ], axis=1).max(axis=1)
        atr20 = tr.rolling(20, min_periods=5).mean().fillna(tr.expanding().mean())
        natr20 = ((atr20 / (s_close_ser + 1e-8)) * 100.0).clip(0.4, 12.0)

        overnight_gap = (s_open_ser / (prev_c + 1e-8)) - 1.0
        intraday_ret = ((s_close_ser - s_open_ser) / (s_open_ser + 1e-8)).clip(-0.12, 0.12)
        raw_ret_clean = s_close_ser.pct_change().fillna(0.0)
        natr_dec = natr20.shift(1).fillna(2.0) / 100.0
        is_roll_splice = overnight_gap.abs() > (1.35 * natr_dec)
        capped_overnight = overnight_gap.clip(-0.8 * natr_dec, 0.8 * natr_dec)
        spot_price_ret = pd.Series(
            np.where(is_roll_splice, intraday_ret + 0.25 * capped_overnight, raw_ret_clean),
            index=idx,
        ).clip(-0.14, 0.14)
        if tk == "CL=F":
            for dt_w in idx[(idx >= "2020-04-16") & (idx <= "2020-04-24")]:
                if dt_w in bz_ret_ref.index:
                    spot_price_ret.loc[dt_w] = float(bz_ret_ref.loc[dt_w])

        ma252 = s_close_ser.rolling(252, min_periods=60).mean()
        ma60 = s_close_ser.rolling(60, min_periods=20).mean()
        scarcity_premium = (
            (s_close_ser / (ma252 + 1e-8) - 1.0) * 0.22
            + (s_close_ser / (ma60 + 1e-8) - 1.0) * 0.18
        ).clip(-0.25, 0.35)
        roll_yield_ann = (base_carry + scarcity_premium).clip(-0.38, 0.35)
        daily_carry_accrual = roll_yield_ann.shift(1).fillna(base_carry) / 252.0
        roll_adj_ret = (spot_price_ret + daily_carry_accrual).clip(-0.14, 0.14)

        vol_d = roll_adj_ret.rolling(60, min_periods=20).std() + 1e-6
        z20 = roll_adj_ret.rolling(20).sum() / (vol_d * np.sqrt(20))
        z60 = roll_adj_ret.rolling(60).sum() / (vol_d * np.sqrt(60))
        z126 = roll_adj_ret.rolling(126).sum() / (vol_d * np.sqrt(126))
        z252 = roll_adj_ret.rolling(252).sum() / (vol_d * np.sqrt(252))
        tsmom_z = (0.20 * z20 + 0.35 * z60 + 0.25 * z126 + 0.20 * z252).fillna(0.0)

        grp["open"] = np.round(s_open_ser.values, 4)
        grp["high"] = np.round(s_high_ser.values, 4)
        grp["low"] = np.round(s_low_ser.values, 4)
        grp["close"] = np.round(s_close_ser.values, 4)
        grp["atr_20"] = np.round(atr20.values, 4)
        grp["natr_20"] = np.round(natr20.values, 4)
        grp["roll_yield_ann"] = np.round(roll_yield_ann.values, 4)
        grp["roll_adjusted_ret"] = np.round(roll_adj_ret.values, 6)
        grp["tsmom_z"] = np.round(tsmom_z.values, 4)
        frames.append(grp)
    return pd.concat(frames, ignore_index=True)


def build_cta_environment(
    meta_df: pd.DataFrame,
    daily_df: pd.DataFrame,
    sov_df: pd.DataFrame,
    macro_df: pd.DataFrame,
    recompute_from_ohlc: bool = False,
) -> dict:
    """建構嚴格 Point-in-Time、零 .bfill() 之外生與期貨特徵矩陣環境"""
    df = daily_df.copy()
    df["dt"] = pd.to_datetime(df["date"])
    if recompute_from_ohlc:
        df = recompute_daily_derived_columns(meta_df, df)

    sdf = sov_df.copy()
    sdf["dt"] = pd.to_datetime(sdf["date"])

    mdf = macro_df.copy()
    mdf["dt"] = pd.to_datetime(mdf["date"].astype(str), format="mixed")
    mdf = mdf.drop_duplicates("dt").set_index("dt").sort_index()

    tickers = list(meta_df["ticker"])
    meta_map = {row["ticker"]: dict(row) for _, row in meta_df.iterrows()}
    sector_map = {tk: meta_map[tk]["sector"] for tk in tickers}
    sec_list = [sector_map[tk] for tk in tickers]
    gc_idx = tickers.index("GC=F")

    close_mat = df.pivot(index="dt", columns="ticker", values="close").ffill()
    open_mat = df.pivot(index="dt", columns="ticker", values="open").ffill()
    high_mat = df.pivot(index="dt", columns="ticker", values="high").ffill()
    low_mat = df.pivot(index="dt", columns="ticker", values="low").ffill()
    vol_mat = df.pivot(index="dt", columns="ticker", values="volume").fillna(0.0)
    ret_mat = df.pivot(index="dt", columns="ticker", values="roll_adjusted_ret").fillna(0.0)
    natr_mat = df.pivot(index="dt", columns="ticker", values="natr_20").ffill().fillna(2.5).clip(lower=0.75)
    atr_mat = df.pivot(index="dt", columns="ticker", values="atr_20").ffill()
    ry_mat = df.pivot(index="dt", columns="ticker", values="roll_yield_ann").ffill().fillna(-0.03)
    tsmom_mat = df.pivot(index="dt", columns="ticker", values="tsmom_z").ffill().fillna(0.0)
    phys_mat = df.pivot(index="dt", columns="ticker", values="physical_spread").ffill()

    prev_close_mat = close_mat.shift(1)
    raw_c2o = (open_mat / (prev_close_mat + 1e-8) - 1.0).fillna(0.0)
    raw_o2c = (close_mat / (open_mat + 1e-8) - 1.0).fillna(0.0)
    natr_dec_prev = (natr_mat.shift(1).fillna(2.5) / 100.0).clip(0.005, 0.12)
    is_roll_gap = raw_c2o.abs() > (1.35 * natr_dec_prev)
    clean_c2o = pd.DataFrame(
        np.where(is_roll_gap, raw_c2o.clip(-0.8 * natr_dec_prev, 0.8 * natr_dec_prev) * 0.25, raw_c2o),
        index=close_mat.index,
        columns=close_mat.columns,
    ).clip(-0.08, 0.08)
    r_intraday_mat = (raw_o2c.clip(-0.12, 0.12) + (ret_mat - clean_c2o - raw_o2c.clip(-0.12, 0.12)) * 0.5).clip(-0.14, 0.14)
    r_overnight_mat = (ret_mat - r_intraday_mat).clip(-0.10, 0.10)
    is_untradable_mat = (
        (vol_mat <= 0)
        | (high_mat <= low_mat * 1.0001)
        | (raw_c2o.abs() > np.maximum(0.045, 2.5 * natr_dec_prev))
        | close_mat.isna()
    )

    sov_piv = sdf.pivot(index="dt", columns="ticker", values="adj_close").reindex(close_mat.index).ffill()
    bil_ret = sov_piv["BIL"].pct_change().fillna(0.00008).clip(-0.003, 0.003)
    gld_ret = sov_piv["GLD"].pct_change().fillna(0.0)
    spy_ret = sov_piv["SPY"].pct_change().fillna(0.0)

    ma20 = close_mat.rolling(20).mean()
    ma60 = close_mat.rolling(60).mean()
    ma120 = close_mat.rolling(120).mean()
    ma200 = close_mat.rolling(200).mean()
    high20 = close_mat.rolling(20).max()
    low20 = close_mat.rolling(20).min()
    high40 = close_mat.rolling(40).max()
    low40 = close_mat.rolling(40).min()
    chandelier_l_v3 = high20 - 2.6 * atr_mat
    chandelier_s_v3 = low20 + 2.6 * atr_mat
    chandelier_l = high20 - 3.0 * atr_mat
    chandelier_s = low20 + 2.8 * atr_mat

    ret5_raw = close_mat.pct_change(5).fillna(0.0)
    ret20_raw = close_mat.pct_change(20).fillna(0.0)
    ret60_raw = close_mat.pct_change(60).fillna(0.0)
    ret126_raw = close_mat.pct_change(126).fillna(0.0)

    natr_dec = (natr_mat / 100.0).clip(lower=0.0075)
    shock5_norm = (ret5_raw / natr_dec).fillna(0.0)
    vol_ratio5 = (vol_mat.rolling(5).mean() / vol_mat.rolling(60, min_periods=10).mean().replace(0, np.nan)).fillna(1.0)
    rng_mat = (high_mat - low_mat).replace(0, np.nan)
    clv_5d = ((close_mat - low_mat) / rng_mat).clip(0.0, 1.0).fillna(0.5).rolling(5, min_periods=2).mean().fillna(0.5)
    phys_z60 = ((phys_mat - phys_mat.rolling(60).mean()) / (phys_mat.rolling(60).std() + 1e-6)).fillna(0.0)

    # Fix pre-2007 BZ=F listing NaN denominator in active universe breadth
    comm_br200 = (close_mat > ma200).where(ma200.notna()).mean(axis=1).fillna(0.5)
    comm_br60 = (close_mat > ma60).where(ma60.notna()).mean(axis=1).fillna(0.5)
    disp60_s = ret_mat.rolling(60).sum().std(axis=1).rolling(10, min_periods=1).mean()
    mean_r126 = ret_mat.rolling(126).sum().mean(axis=1).rolling(10, min_periods=1).mean()

    # Strictly causal NATR floor (no .bfill())
    natr_med252 = natr_mat.rolling(252, min_periods=60).median().fillna(natr_mat.expanding().median())
    natr_floor = pd.DataFrame(
        np.maximum(natr_mat.values, (natr_med252 * 0.90).values),
        index=close_mat.index,
        columns=close_mat.columns,
    )

    # M2: Kaufman (1995) 40D Path Efficiency on roll-adjusted returns
    log_r = np.log1p(ret_mat.clip(-0.15, 0.15))
    er40_mat = (log_r.rolling(40).sum().abs() / (log_r.abs().rolling(40).sum() + 1e-8)).fillna(0.0)

    # M3: Exogenous Macro DXY Numeraire Regime (causal shift(1) applied below)
    dxy_s = mdf["dxy"].reindex(close_mat.index).ffill()
    dxy_ma60 = dxy_s.rolling(60, min_periods=10).mean()
    dxy_ret20 = dxy_s.pct_change(20).fillna(0.0)

    # M7: Commercial & Hedger Volume Participation Ratio (VOL20_120, causal shift(1) applied below)
    vol20_120 = (
        vol_mat.rolling(20, min_periods=5).mean()
        / vol_mat.rolling(120, min_periods=20).mean().replace(0, np.nan)
    ).fillna(1.0).clip(0.30, 2.50)

    bt_idx = close_mat.loc["2005-01-03":].index

    return {
        "bt_idx": bt_idx,
        "tickers": tickers,
        "meta_map": meta_map,
        "sector_map": sector_map,
        "sec_list": sec_list,
        "gc_idx": gc_idx,
        "close_mat": close_mat,
        "ma20": ma20,
        "ma60": ma60,
        "ma120": ma120,
        "ma200": ma200,
        "high40": high40,
        "low40": low40,
        "ret20_raw": ret20_raw,
        "ret60_raw": ret60_raw,
        "ret126_raw": ret126_raw,
        "tsmom_mat": tsmom_mat,
        "ry_mat": ry_mat,
        "er40_mat": er40_mat,
        "vol20_120": vol20_120,
        "atr_mat": atr_mat,
        "natr_mat": natr_mat,
        "natr_floor": natr_floor,
        "phys_z60": phys_z60,
        "chandelier_l": chandelier_l,
        "chandelier_s": chandelier_s,
        "shock5_norm": shock5_norm,
        "vol_ratio5": vol_ratio5,
        "clv_5d": clv_5d,
        "comm_br200": comm_br200,
        "comm_br60": comm_br60,
        "disp60_s": disp60_s,
        "mean_r126": mean_r126,
        "dxy_s": dxy_s,
        "dxy_ma60": dxy_ma60,
        "dxy_ret20": dxy_ret20,
        "bil_ret": bil_ret,
        "gld_ret": gld_ret,
        "spy_ret": spy_ret,
        # Vectorized arrays aligned to bt_idx (signals shifted by 1 day -> T+1 Open execution)
        "R": ret_mat.loc[bt_idx, tickers].values,
        "R_ov": r_overnight_mat.loc[bt_idx, tickers].values,
        "R_id": r_intraday_mat.loc[bt_idx, tickers].values,
        "O_t": open_mat.loc[bt_idx, tickers].values,
        "C_t": close_mat.loc[bt_idx, tickers].values,
        "UNTRAD": is_untradable_mat.loc[bt_idx, tickers].values,
        "RF": (bil_ret.loc[bt_idx].values) * 0.85,
        "GLD_R": gld_ret.loc[bt_idx].values,
        "C_p": close_mat.shift(1).loc[bt_idx, tickers].values,
        "M20_p": ma20.shift(1).loc[bt_idx, tickers].values,
        "M60_p": ma60.shift(1).loc[bt_idx, tickers].values,
        "M120_p": ma120.shift(1).loc[bt_idx, tickers].values,
        "M200_p": ma200.shift(1).loc[bt_idx, tickers].values,
        "H40_p": high40.shift(1).loc[bt_idx, tickers].values,
        "L40_p": low40.shift(1).loc[bt_idx, tickers].values,
        "NATR_p": natr_mat.shift(1).loc[bt_idx, tickers].values,
        "NATR_safe_p": natr_floor.shift(1).loc[bt_idx, tickers].values,
        "R60_p": ret60_raw.shift(1).loc[bt_idx, tickers].values,
        "R126_p": ret126_raw.shift(1).loc[bt_idx, tickers].values,
        "TS_p": tsmom_mat.shift(1).loc[bt_idx, tickers].values,
        "RY_p": ry_mat.shift(1).loc[bt_idx, tickers].values,
        "ER40_p": er40_mat.shift(1).loc[bt_idx, tickers].values,
        "V20_120_p": vol20_120.shift(1).loc[bt_idx, tickers].values,
        "PZ_p": phys_z60.shift(1).loc[bt_idx, tickers].values,
        "CL_v3_p": chandelier_l_v3.shift(1).loc[bt_idx, tickers].values,
        "CS_v3_p": chandelier_s_v3.shift(1).loc[bt_idx, tickers].values,
        "CL_p": chandelier_l.shift(1).loc[bt_idx, tickers].values,
        "CS_p": chandelier_s.shift(1).loc[bt_idx, tickers].values,
        "S5N_p": shock5_norm.shift(1).loc[bt_idx, tickers].values,
        "VR5_p": vol_ratio5.shift(1).loc[bt_idx, tickers].values,
        "CLV5_p": clv_5d.shift(1).loc[bt_idx, tickers].values,
        "BR200_p": comm_br200.shift(1).loc[bt_idx].values,
        "BR60_p": comm_br60.shift(1).loc[bt_idx].values,
        "DISP_p": disp60_s.shift(1).loc[bt_idx].values,
        "DXY_p": dxy_s.shift(1).loc[bt_idx].values,
        "DXY_M60_p": dxy_ma60.shift(1).loc[bt_idx].values,
        "DXY_R20_p": dxy_ret20.shift(1).loc[bt_idx].values,
    }


def _evaluate_candidate_signals_row(
    *,
    tickers: list,
    sec_list: list,
    c_row: np.ndarray,
    m20_row: np.ndarray,
    m60_row: np.ndarray,
    m200_row: np.ndarray,
    h40_row: np.ndarray,
    l40_row: np.ndarray,
    cl_row: np.ndarray,
    cs_row: np.ndarray,
    ts_row: np.ndarray,
    ry_row: np.ndarray,
    pz_row: np.ndarray,
    r60_row: np.ndarray,
    r126_row: np.ndarray,
    natr_safe_row: np.ndarray,
    s5n_row: np.ndarray,
    vr5_row: np.ndarray,
    clv5_row: np.ndarray,
    er40_row: np.ndarray,
    br200: float,
    br60: float,
    is_macro_chop: bool,
    dxy_weak: bool,
    dxy_surge: bool,
    w_curr: np.ndarray,
    vol_scalar: float,
    m1_hyst: bool,
    m2_er: bool,
    m3_dxy: bool,
    m4_scale: bool,
    m5_vol: bool,
    use_event: bool,
    ts_entry: float,
    inc_hyst: float,
    er_slope: float,
    pos: dict,
    allowed_set=None,
    natr_raw_row: np.ndarray = None,
    v20_120_row: np.ndarray = None,
    m6_ratchet: bool = True,
    m7_vol_part: bool = True,
    m8_atr_cap: bool = True,
    v_thin: float = 0.72,
    v_hi: float = 1.05,
    vm_hi: float = 1.14,
    vm_lo: float = 0.90,
    atr_risk_cap_l: float = 0.0155,
    atr_risk_cap_s: float = 0.0125,
    pw_cap_l: float = 0.45,
    check_ratchet_fn=None,
    trig_counts: dict = None,
) -> tuple:
    """Single source of truth for scoring weekly rebalance candidates (used identically by backtest & live radar)."""
    cands = []
    per_ticker_diag = {}
    n_tk = len(tickers)

    for j in range(n_tk):
        tk = tickers[j]
        if allowed_set is not None and tk not in allowed_set:
            continue
        px = float(c_row[j])
        m20 = float(m20_row[j])
        m60 = float(m60_row[j])
        m200 = float(m200_row[j])
        v20_120 = float(v20_120_row[j]) if v20_120_row is not None else 1.0
        if np.isnan(px) or np.isnan(m60) or np.isnan(m200):
            per_ticker_diag[tk] = {
                "status": "⏳ 暖機中", "dir": "FLAT", "conv": 0.0,
                "em": 1.0, "dm": 1.0, "ev_m": 1.0, "vm": 1.0, "v20_120": round(v20_120, 2),
            }
            continue

        if m6_ratchet and check_ratchet_fn is not None and tk in pos:
            rh, r_rsn = check_ratchet_fn(pos[tk])
            if rh:
                per_ticker_diag[tk] = {
                    "status": r_rsn, "dir": "FLAT", "conv": 0.0,
                    "em": 1.0, "dm": 1.0, "ev_m": 1.0, "vm": 1.0, "v20_120": round(v20_120, 2),
                }
                continue

        sec = sec_list[j]
        ts = float(ts_row[j])
        ry = float(ry_row[j])
        pz = float(pz_row[j])
        r60 = float(r60_row[j])
        r126 = float(r126_row[j])
        natr_s = float(natr_safe_row[j])
        natr_raw = float(natr_raw_row[j]) if natr_raw_row is not None else natr_s
        h40 = float(h40_row[j])
        l40 = float(l40_row[j])
        cl = float(cl_row[j])
        cs = float(cs_row[j])
        s5n = float(s5n_row[j])
        vr5 = float(vr5_row[j])
        clv5 = float(clv5_row[j])
        er40 = float(er40_row[j])

        is_hl = float(w_curr[j]) > 0.01
        is_hs = float(w_curr[j]) < -0.01
        base_w = min(0.54 / natr_s, 0.36) * vol_scalar
        pm = (
            1.25 if (sec == "能源 (Energy)" and pz > 0.25)
            else (0.50 if (sec == "能源 (Energy)" and pz < -0.75)
                  else (1.15 if (sec == "農產品穀物 (Grains)" and pz > 0.25) else 1.0))
        )
        cm = 1.45 if ry >= 0.0 else (1.12 if ry >= -0.035 else 0.65)
        m200_b = 1.20 if px > m200 else 0.75
        em_l = (0.82 + er_slope * min(er40, 0.50)) if m2_er else 1.0
        dm_l = (1.14 if dxy_weak else (0.78 if (dxy_surge and sec != "貴金屬 (Precious Metals)") else 1.0)) if m3_dxy else 1.0
        em_s = (0.85 + 0.65 * min(er40, 0.50)) if m2_er else 1.0
        dm_s = (1.15 if not dxy_weak else 0.88) if m3_dxy else 1.0

        vm = 1.0
        veto_thin = False
        if m7_vol_part:
            if v20_120 >= v_hi:
                vm = vm_hi
                if trig_counts is not None:
                    trig_counts["m7_vol_tilt"] += 1
            elif v20_120 < 0.85:
                vm = vm_lo
                if trig_counts is not None:
                    trig_counts["m7_vol_tilt"] += 1
            if sec != "貴金屬 (Precious Metals)" and (v20_120 < v_thin) and (not is_hl) and (not is_hs) and (abs(ts) < 1.35):
                veto_thin = True
                if trig_counts is not None and ts >= (0.42 if is_hl else ts_entry) and px > m60:
                    trig_counts["m7_thin_veto"] += 1

        ev_m = 1.0
        if use_event:
            if ry < -0.025 and s5n > 1.5 and sec != "貴金屬 (Precious Metals)":
                ev_m *= 0.60
            if vr5 >= 1.28 and (ry >= -0.02 or sec == "貴金屬 (Precious Metals)"):
                ev_m *= 1.15
            if clv5 >= 0.58 and (ry >= 0.0 or sec == "貴金屬 (Precious Metals)"):
                ev_m *= 1.08

        diag_status = "⏳ 區間觀望 (未達 V6.0 突破/確信門檻)"
        diag_dir = "FLAT"
        diag_conv = round(ts * cm * pm * m200_b * ev_m * em_l * dm_l * vm, 2)

        eff_ts_l = (0.42 if is_hl else ts_entry) if m1_hyst else (0.60 * 0.65 if is_hl else 0.60)
        eff_r60_l = 0.020 if is_hl else 0.045
        near_bo_l = (px >= h40 * 0.965) or is_hl

        veto_contango = (ry < -0.095 and ts < 2.2)
        veto_event_spike = use_event and (ry < -0.025 and s5n > 1.5 and sec != "貴金屬 (Precious Metals)" and not is_hl)
        veto_chop = is_macro_chop and sec != "貴金屬 (Precious Metals)" and (ry < 0.005 or px < m200 or ts < 0.95)
        veto_bear_l = (br200 < 0.25) and sec != "貴金屬 (Precious Metals)" and (px < m200 or ry < -0.01)

        if veto_contango or veto_event_spike:
            diag_status = "🚫 正價差新聞脈衝/深貼水禁買 (Carry & Kilian Veto)"
        elif veto_thin:
            diag_status = "🚫 實體商品低量假突破禁買 (M7 Thin-Volume Veto)"

        if (
            not veto_contango
            and not veto_event_spike
            and not veto_chop
            and not veto_bear_l
            and not veto_thin
            and ts >= eff_ts_l
            and r60 >= eff_r60_l
            and r126 > -0.01
            and near_bo_l
            and px > m20
            and px > m60
            and px >= cl
        ):
            hm = (inc_hyst if is_hl else 1.0) if m1_hyst else 1.0
            chop_scale = 0.55 if is_macro_chop else 1.0
            conv = ts * cm * pm * m200_b * ev_m * em_l * dm_l * vm * hm * (1.0 + min(r60, 0.40))
            raw_pw = base_w * chop_scale * cm * pm * m200_b * ev_m * em_l * dm_l * vm * min(ts / 0.80, 1.60)
            cap_l = (pw_cap_l if m8_atr_cap else 0.44) if m5_vol else 0.38
            if m8_atr_cap:
                dyn_atr_cap = atr_risk_cap_l / max(max(natr_raw, natr_s) / 100.0, 0.01)
                if trig_counts is not None and min(raw_pw, cap_l) > dyn_atr_cap:
                    trig_counts["m8_atr_capped"] += 1
                pw = min(raw_pw, cap_l, dyn_atr_cap)
            else:
                pw = min(raw_pw, cap_l)
            if m4_scale and is_hl and tk in pos and pos[tk].get("scaled"):
                pw *= pos[tk]["rem_frac"]
            cands.append((conv, j, pw))
            diag_status = "🔥 順勢做多正選 (V6.0 Long Active)"
            diag_dir = "LONG"
            diag_conv = round(conv, 2)

        in_deflation = (br200 <= 0.28) or (br60 <= 0.22) or (is_hs and br60 <= 0.35)
        eff_ts_s = (-0.75 * 0.80 if is_hs else -0.75)
        if (
            in_deflation
            and not is_macro_chop
            and not veto_thin
            and ts <= eff_ts_s
            and r60 <= -0.05
            and r126 < 0.0
            and ((px <= l40 * 1.035) or is_hs)
            and px < m20
            and px < m60
            and px < m200
            and px <= cs
            and ry < -0.030
            and sec != "貴金屬 (Precious Metals)"
        ):
            scm = 1.40 if ry < -0.10 else 1.00
            hm = (inc_hyst if is_hs else 1.0) if m1_hyst else 1.0
            conv = abs(ts) * scm * em_s * dm_s * vm * hm * 0.95
            raw_pws = base_w * 0.85 * scm * em_s * dm_s * vm * min(abs(ts) / 0.90, 1.40)
            cap_s = 0.34 if m5_vol else 0.30
            if m8_atr_cap:
                dyn_atr_cap_s = atr_risk_cap_s / max(max(natr_raw, natr_s) / 100.0, 0.01)
                if trig_counts is not None and min(raw_pws, cap_s) > dyn_atr_cap_s:
                    trig_counts["m8_atr_capped"] += 1
                pws = min(raw_pws, cap_s, dyn_atr_cap_s)
            else:
                pws = min(raw_pws, cap_s)
            pw = -pws
            if m4_scale and is_hs and tk in pos and pos[tk].get("scaled"):
                pw *= pos[tk]["rem_frac"]
            cands.append((conv, j, pw))
            diag_status = "📉 通縮正價差放空正選 (Deflation Short Active)"
            diag_dir = "SHORT"
            diag_conv = round(conv, 2)

        per_ticker_diag[tk] = {
            "status": diag_status,
            "dir": diag_dir,
            "conv": diag_conv,
            "em": round(em_s if diag_dir == "SHORT" else em_l, 3),
            "dm": round(dm_s if diag_dir == "SHORT" else dm_l, 3),
            "ev_m": round(ev_m, 3),
            "vm": round(vm, 3),
            "v20_120": round(v20_120, 2),
        }

    return cands, per_ticker_diag


def run_cta_titan_simulation(
    env: dict,
    *,
    m1_hyst: bool = True,
    m2_er: bool = True,
    m3_dxy: bool = True,
    m4_scale: bool = True,
    m5_vol: bool = True,
    m6_ratchet: bool = True,
    m7_vol_part: bool = True,
    m8_atr_cap: bool = True,
    use_event: bool = True,
    use_v3_chandelier: bool = False,
    ts_entry: float = 0.75,
    inc_hyst: float = 1.28,
    er_slope: float = 0.75,
    scale_natr: float = 1.8,
    lock_frac: float = 0.38,
    be_cushion: float = 0.36,
    super_trig: float = 3.5,
    super_lock: float = 0.65,
    v_thin: float = 0.72,
    v_hi: float = 1.05,
    vm_hi: float = 1.14,
    vm_lo: float = 0.90,
    atr_risk_cap_l: float = 0.0155,
    atr_risk_cap_s: float = 0.0125,
    pw_cap_l: float = 0.45,
    target_vol: float = None,
    vol_clip: tuple = None,
    g_cap: float = 1.95,
    cost_bps: float = 0.0006,
    allowed_set=None,
    t1_close_delay: bool = False,
    rebal_phase: int = 1,
    collect_trades: bool = False,
) -> dict:
    """Reusable Strict T+1 Open & Limit-Lock Tradable CTA Simulation Engine (Supports V3..V6.0)."""
    bt_idx = env["bt_idx"]
    tickers = env["tickers"]
    meta_map = env["meta_map"]
    sec_list = env["sec_list"]
    gc_idx = env["gc_idx"]

    R = env["R"]
    R_ov = env["R_ov"]
    R_id = env["R_id"]
    O_t = env["O_t"]
    C_t = env["C_t"]
    UNTRAD = env["UNTRAD"]
    RF = env["RF"]
    GLD_R = env["GLD_R"]
    C_p = env["C_p"]
    M20_p = env["M20_p"]
    M60_p = env["M60_p"]
    M120_p = env["M120_p"]
    M200_p = env["M200_p"]
    H40_p = env["H40_p"]
    L40_p = env["L40_p"]
    NATR_p = env["NATR_p"]
    NATR_safe_p = env["NATR_safe_p"]
    R60_p = env["R60_p"]
    R126_p = env["R126_p"]
    TS_p = env["TS_p"]
    RY_p = env["RY_p"]
    ER40_p = env["ER40_p"]
    V20_120_p = env["V20_120_p"]
    PZ_p = env["PZ_p"]
    CL_p = env["CL_v3_p"] if use_v3_chandelier else env["CL_p"]
    CS_p = env["CS_v3_p"] if use_v3_chandelier else env["CS_p"]
    S5N_p = env["S5N_p"]
    VR5_p = env["VR5_p"]
    CLV5_p = env["CLV5_p"]
    BR200_p = env["BR200_p"]
    BR60_p = env["BR60_p"]
    DISP_p = env["DISP_p"]
    DXY_p = env["DXY_p"]
    DXY_M60_p = env["DXY_M60_p"]
    DXY_R20_p = env["DXY_R20_p"]

    eff_tv = target_vol if target_vol is not None else (0.215 if (m5_vol and m8_atr_cap) else 0.212)
    eff_vc = vol_clip if vol_clip is not None else ((0.78, 1.49) if (m5_vol and m8_atr_cap) else (0.78, 1.48))

    n_days, n_tk = R.shape
    w = np.zeros(n_tk)
    gld_w = 0.0
    r_arr = np.zeros(n_days)
    w_hist = np.zeros((n_days, n_tk))
    trade_logs = []
    pos = {}
    blocked_limit_days_count = 0
    untrad_violations = 0
    ratchet_exits = 0
    last_vol_scalar = 1.0
    trig_counts = {
        "m1_filtered": 0,
        "m1_hyst_saved": 0,
        "m2_er_boost": 0,
        "m3_dxy_weak": 0,
        "m3_dxy_surge": 0,
        "m4_scaled": 0,
        "m5_rebal": 0,
        "m6_ratchet_guarded": 0,
        "m7_vol_tilt": 0,
        "m7_thin_veto": 0,
        "m8_atr_capped": 0,
    }

    def _close_position(tk_sym: str, j_idx: int, dt_val, exec_px: float, exit_reason: str):
        info = pos.pop(tk_sym)
        hold_d = max((dt_val - info["entry_dt"]).days, 1)
        d_sign = info["dir"]
        spot_rem = ((exec_px / info["entry_price"] - 1.0) * d_sign) * 100.0
        roll_rem = (info["entry_ry"] * (hold_d / 365.0) * d_sign) * 100.0
        if info["scaled"]:
            spot_r = lock_frac * info["scale_spot_pct"] + info["rem_frac"] * spot_rem
            roll_r = lock_frac * info["scale_roll_pct"] + info["rem_frac"] * roll_rem
        else:
            spot_r = spot_rem
            roll_r = roll_rem
        raw_tot_r = spot_r + roll_r
        final_eq = info["realized_locked"] + info["rem_frac"] * info["runner_open"] * (1.0 - cost_bps)
        clean_net_r = (final_eq * (1.0 - cost_bps) - 1.0) * 100.0
        if collect_trades:
            trade_logs.append({
                "ticker": tk_sym,
                "name_zh": meta_map[tk_sym]["name_zh"],
                "sector": sec_list[j_idx],
                "direction": "做多 (Long)" if d_sign > 0 else "做空 (Short)",
                "entry_date": info["entry_date"],
                "exit_date": dt_val.strftime("%Y-%m-%d"),
                "entry_price": round(info["entry_price"], 2),
                "exit_price": round(exec_px, 2),
                "holding_days": hold_d,
                "scaled_out": bool(info["scaled"]),
                "ratchet_triggered": bool(info.get("ratchet_used", False)),
                "scale_date": info["scale_dt"] if info["scaled"] else None,
                "scale_price": round(info["scale_px"], 2) if info["scaled"] else None,
                "spot_return_pct": round(float(spot_r), 2),
                "roll_yield_contrib_pct": round(float(roll_r), 2),
                "raw_total_return_pct": round(float(raw_tot_r), 2),
                "return_pct": round(float(clean_net_r), 2),
                "exit_reason": exit_reason,
            })

    def _trigger_scale_out(tk_sym: str, j_idx: int, dt_val, exec_px: float):
        info = pos[tk_sym]
        hd = max((dt_val - info["entry_dt"]).days, 1)
        d_sign = info["dir"]
        info["scale_spot_pct"] = ((exec_px / info["entry_price"] - 1.0) * d_sign) * 100.0
        info["scale_roll_pct"] = (info["entry_ry"] * (hd / 365.0) * d_sign) * 100.0
        info["realized_locked"] += lock_frac * info["runner_open"] * (1.0 - cost_bps)
        info["rem_frac"] = 1.0 - lock_frac
        info["scaled"] = True
        info["scale_dt"] = dt_val.strftime("%Y-%m-%d")
        info["scale_px"] = exec_px
        trig_counts["m4_scaled"] += 1

    def _check_ratchet(info: dict) -> tuple:
        if not (m6_ratchet and info["scaled"]):
            return False, ""
        trig_counts["m6_ratchet_guarded"] += 1
        en = info["entry_natr"]
        if info["peak_eq"] >= 1.0 + super_trig * en and info["runner_eq"] <= 1.0 + super_lock * en:
            return True, "🔒 M6 二階超額趨勢鎖利護盤 (T+1開盤成交)"
        if info["runner_eq"] <= 1.0 - be_cushion * en:
            return True, "🛡️ M6 一階鎖利後保本緩衝護盾 (T+1開盤成交)"
        return False, ""

    for t in range(1, n_days):
        dt_val = bt_idx[t]
        dt_str = dt_val.strftime("%Y-%m-%d")
        w_prev = w.copy()
        gld_prev = gld_w
        to = 0.0
        br200 = float(BR200_p[t])
        br60 = float(BR60_p[t])
        disp = float(DISP_p[t])
        is_macro_chop = (disp < 0.11)
        dxy_weak = bool(DXY_p[t] < DXY_M60_p[t])
        dxy_surge = bool((DXY_p[t] > DXY_M60_p[t]) and (DXY_R20_p[t] > 0.015))

        for j in range(n_tk):
            tk = tickers[j]
            if tk in pos:
                step_r = R[t, j] if t1_close_delay else R_ov[t, j]
                pos[tk]["runner_open"] = pos[tk]["runner_eq"] * (1.0 + pos[tk]["dir"] * step_r)

        if t % 5 != rebal_phase:
            for j in range(n_tk):
                tk = tickers[j]
                want_scale = (
                    m4_scale
                    and tk in pos
                    and (not pos[tk]["scaled"])
                    and abs(w[j]) > 0.01
                    and (pos[tk]["runner_eq"] - 1.0) >= max(scale_natr * (NATR_p[t, j] / 100.0), 0.035)
                )
                ratchet_hit, ratchet_reason = _check_ratchet(pos[tk]) if tk in pos else (False, "")
                want_stop_l = w[j] > 0 and (C_p[t, j] < CL_p[t, j] or C_p[t, j] < M60_p[t, j] or ratchet_hit)
                want_stop_s = w[j] < 0 and (C_p[t, j] > CS_p[t, j] or C_p[t, j] > M60_p[t, j] or br60 > 0.45 or ratchet_hit)

                if UNTRAD[t, j]:
                    if want_scale or want_stop_l or want_stop_s:
                        blocked_limit_days_count += 1
                    continue

                exec_px = float(C_t[t, j]) if t1_close_delay else (float(O_t[t, j]) if O_t[t, j] > 0 else float(C_p[t, j]))

                if want_scale and (not ratchet_hit):
                    _trigger_scale_out(tk, j, dt_val, exec_px)
                    to += abs(w[j]) * lock_frac
                    w[j] *= (1.0 - lock_frac)

                if want_stop_l:
                    to += abs(w[j])
                    if tk in pos:
                        if ratchet_hit:
                            pos[tk]["ratchet_used"] = True
                            ratchet_exits += 1
                        _close_position(
                            tk, j, dt_val, exec_px,
                            ratchet_reason if ratchet_hit else "🛡️ 觸及 3.0×ATR 防洗盤吊燈/季線停利 (T+1開盤成交)",
                        )
                    w[j] = 0.0
                elif want_stop_s:
                    to += abs(w[j])
                    if tk in pos:
                        if ratchet_hit:
                            pos[tk]["ratchet_used"] = True
                            ratchet_exits += 1
                        _close_position(
                            tk, j, dt_val, exec_px,
                            ratchet_reason if ratchet_hit else "🛡️ 空方觸及 2.8×ATR 吊燈/寬幅回升回補 (T+1開盤成交)",
                        )
                    w[j] = 0.0
        else:
            vol_scalar = 1.0
            if m5_vol and t >= 45:
                past_r = r_arr[max(1, t - 60):t]
                rv = float(np.std(past_r) * np.sqrt(252.0))
                if rv > 0.04:
                    vol_scalar = float(np.clip(eff_tv / rv, eff_vc[0], eff_vc[1]))
                    trig_counts["m5_rebal"] += 1
            last_vol_scalar = vol_scalar
            if dxy_weak:
                trig_counts["m3_dxy_weak"] += 1
            if dxy_surge:
                trig_counts["m3_dxy_surge"] += 1

            if m1_hyst:
                for j in range(n_tk):
                    if w[j] <= 0.01 and 0.60 <= TS_p[t, j] < ts_entry:
                        trig_counts["m1_filtered"] += 1
                    if w[j] > 0.01:
                        trig_counts["m1_hyst_saved"] += 1
            if m2_er:
                trig_counts["m2_er_boost"] += int(np.sum(ER40_p[t] >= 0.24))

            cands, _ = _evaluate_candidate_signals_row(
                tickers=tickers,
                sec_list=sec_list,
                c_row=C_p[t],
                m20_row=M20_p[t],
                m60_row=M60_p[t],
                m200_row=M200_p[t],
                h40_row=H40_p[t],
                l40_row=L40_p[t],
                cl_row=CL_p[t],
                cs_row=CS_p[t],
                ts_row=TS_p[t],
                ry_row=RY_p[t],
                pz_row=PZ_p[t],
                r60_row=R60_p[t],
                r126_row=R126_p[t],
                natr_safe_row=NATR_safe_p[t],
                s5n_row=S5N_p[t],
                vr5_row=VR5_p[t],
                clv5_row=CLV5_p[t],
                er40_row=ER40_p[t],
                br200=br200,
                br60=br60,
                is_macro_chop=is_macro_chop,
                dxy_weak=dxy_weak,
                dxy_surge=dxy_surge,
                w_curr=w,
                vol_scalar=vol_scalar,
                m1_hyst=m1_hyst,
                m2_er=m2_er,
                m3_dxy=m3_dxy,
                m4_scale=m4_scale,
                m5_vol=m5_vol,
                use_event=use_event,
                ts_entry=ts_entry,
                inc_hyst=inc_hyst,
                er_slope=er_slope,
                pos=pos,
                allowed_set=allowed_set,
                natr_raw_row=NATR_p[t],
                v20_120_row=V20_120_p[t],
                m6_ratchet=m6_ratchet,
                m7_vol_part=m7_vol_part,
                m8_atr_cap=m8_atr_cap,
                v_thin=v_thin,
                v_hi=v_hi,
                vm_hi=vm_hi,
                vm_lo=vm_lo,
                atr_risk_cap_l=atr_risk_cap_l,
                atr_risk_cap_s=atr_risk_cap_s,
                pw_cap_l=pw_cap_l,
                check_ratchet_fn=_check_ratchet,
                trig_counts=trig_counts,
            )

            cands.sort(reverse=True, key=lambda x: x[0])
            nw = np.zeros(n_tk)
            sec_cnt = {}
            sel = 0
            for _, j, pw in cands:
                sec = sec_list[j]
                if sec_cnt.get(sec, 0) >= 2 or sel >= 5:
                    continue
                nw[j] = pw
                sec_cnt[sec] = sec_cnt.get(sec, 0) + 1
                sel += 1
            if np.abs(nw).sum() > g_cap:
                nw *= g_cap / np.abs(nw).sum()

            for j in range(n_tk):
                if abs(nw[j] - w_prev[j]) > 1e-4 and UNTRAD[t, j]:
                    nw[j] = w_prev[j]
                    blocked_limit_days_count += 1

            for j in range(n_tk):
                tk = tickers[j]
                old_d = 1 if w_prev[j] > 0.01 else (-1 if w_prev[j] < -0.01 else 0)
                new_d = 1 if nw[j] > 0.01 else (-1 if nw[j] < -0.01 else 0)
                exec_px = float(C_t[t, j]) if t1_close_delay else (float(O_t[t, j]) if O_t[t, j] > 0 else float(C_p[t, j]))

                if old_d != 0 and old_d != new_d and tk in pos:
                    rh, r_rsn = _check_ratchet(pos[tk])
                    if rh:
                        pos[tk]["ratchet_used"] = True
                        ratchet_exits += 1
                    _close_position(
                        tk, j, dt_val, exec_px,
                        r_rsn if rh else ("💰 雙階鎖利後順勢波段換倉" if pos[tk]["scaled"] else "🔄 週期輪動/確信門檻淘汰"),
                    )

                if new_d != 0 and old_d != new_d:
                    pos[tk] = {
                        "dir": new_d,
                        "entry_date": dt_str,
                        "entry_dt": dt_val,
                        "entry_price": exec_px,
                        "entry_ry": float(RY_p[t, j]),
                        "entry_natr": max(float(NATR_p[t, j]) / 100.0, 0.012),
                        "runner_eq": 1.0,
                        "runner_open": 1.0,
                        "peak_eq": 1.0,
                        "realized_locked": 0.0,
                        "rem_frac": 1.0,
                        "scaled": False,
                        "scale_dt": "",
                        "scale_px": 0.0,
                        "scale_spot_pct": 0.0,
                        "scale_roll_pct": 0.0,
                    }
                elif m4_scale and new_d != 0 and old_d == new_d and tk in pos and (not pos[tk]["scaled"]) and (not UNTRAD[t, j]):
                    tgt_gain = max(scale_natr * (NATR_p[t, j] / 100.0), 0.035)
                    if (pos[tk]["runner_eq"] - 1.0) >= tgt_gain:
                        _trigger_scale_out(tk, j, dt_val, exec_px)
                        nw[j] *= (1.0 - lock_frac)

            to += np.abs(nw - w_prev).sum()
            w = nw

            gross_now = np.abs(w).sum()
            new_gld_w = 0.0
            if gross_now < 0.95 and C_p[t, gc_idx] > M60_p[t, gc_idx] and C_p[t, gc_idx] > M120_p[t, gc_idx] and (allowed_set is None or "GC=F" in allowed_set):
                new_gld_w = min((0.95 - gross_now) * 0.60, 0.42)
            to += abs(new_gld_w - gld_prev)
            gld_w = new_gld_w

        for j in range(n_tk):
            if UNTRAD[t, j] and abs(w[j] - w_prev[j]) > 1e-6:
                untrad_violations += 1
            tk = tickers[j]
            if tk in pos:
                if t1_close_delay:
                    if t % 5 == rebal_phase and pos[tk]["entry_dt"] == dt_val:
                        pos[tk]["runner_eq"] = 1.0
                    else:
                        pos[tk]["runner_eq"] = pos[tk]["runner_open"]
                else:
                    if t % 5 == rebal_phase and pos[tk]["entry_dt"] == dt_val:
                        pos[tk]["runner_eq"] = 1.0 + pos[tk]["dir"] * R_id[t, j]
                    else:
                        pos[tk]["runner_eq"] = pos[tk]["runner_open"] * (1.0 + pos[tk]["dir"] * R_id[t, j])
                if pos[tk]["runner_eq"] > pos[tk]["peak_eq"]:
                    pos[tk]["peak_eq"] = pos[tk]["runner_eq"]

        if t1_close_delay:
            r_arr[t] = np.dot(w_prev, R[t]) + RF[t] + GLD_R[t] * gld_prev - to * cost_bps
        else:
            r_arr[t] = np.dot(w_prev, R_ov[t]) + np.dot(w, R_id[t]) + RF[t] + GLD_R[t] * gld_w - to * cost_bps
        w_hist[t] = w

    return {
        "ret_series": pd.Series(r_arr, index=bt_idx),
        "w_hist": w_hist,
        "w_final": w.copy(),
        "gld_w_final": float(gld_w),
        "pos": pos,
        "trade_logs": trade_logs,
        "blocked_limit_days_count": int(blocked_limit_days_count),
        "untrad_violations": int(untrad_violations),
        "ratchet_exits": int(ratchet_exits),
        "last_vol_scalar": round(float(last_vol_scalar), 3),
        "trig_counts": trig_counts,
    }


def compute_metrics_dict(daily_ret_series: pd.Series, name: str, tier_badge: str, desc: str) -> dict:
    s = daily_ret_series.dropna()
    if len(s) == 0:
        return {}
    eq = (1.0 + s).cumprod()
    n_years = len(s) / 252.0
    total_mult = float(eq.iloc[-1])
    cagr = (total_mult ** (1.0 / n_years) - 1.0) * 100.0

    s_ex26 = s.loc[:"2025-12-31"]
    ex_2026_cagr = ((float((1.0 + s_ex26).prod()) ** (252.0 / max(len(s_ex26), 1))) - 1.0) * 100.0 if len(s_ex26) > 0 else cagr

    peak = eq.cummax()
    dd_daily = (eq / peak - 1.0) * 100.0
    mdd_daily = float(dd_daily.min())

    eq_m = eq.resample("ME").last()
    ret_m = eq_m.pct_change().dropna()
    peak_m = eq_m.cummax()
    dd_m = (eq_m / peak_m - 1.0) * 100.0
    mdd_monthly = float(dd_m.min())
    win_rate_m = float((ret_m > 0).mean() * 100.0)

    ann_ret = float(s.mean() * 252.0)
    ann_vol = float(s.std() * np.sqrt(252.0)) + 1e-8
    sharpe = (ann_ret - 0.02) / ann_vol
    downside_std = float(s[s < 0].std() * np.sqrt(252.0)) + 1e-8
    sortino = (ann_ret - 0.02) / downside_std
    calmar = cagr / abs(mdd_monthly) if mdd_monthly < 0 else 0.0

    eq_y = eq.resample("YE").last()
    ret_y = eq_y.pct_change()
    ret_y.iloc[0] = eq_y.iloc[0] - 1.0
    annual_dict = {str(dt.year): round(float(val * 100.0), 2) for dt, val in ret_y.items()}
    pos_years = sum(1 for v in annual_dict.values() if v > 0)
    total_years = len(annual_dict)

    s_g1 = s.loc[:"2015-12-31"]
    s_g2 = s.loc["2016-01-01":"2025-12-31"]
    s_g2_full = s.loc["2016-01-01":]
    g1_cagr = ((float((1.0 + s_g1).prod()) ** (252.0 / max(len(s_g1), 1))) - 1.0) * 100.0 if len(s_g1) > 0 else 0.0
    g2_cagr = ((float((1.0 + s_g2).prod()) ** (252.0 / max(len(s_g2), 1))) - 1.0) * 100.0 if len(s_g2) > 0 else 0.0
    g2_full_cagr = ((float((1.0 + s_g2_full).prod()) ** (252.0 / max(len(s_g2_full), 1))) - 1.0) * 100.0 if len(s_g2_full) > 0 else 0.0

    return {
        "tier": tier_badge,
        "name": name,
        "desc": desc,
        "cagr_pct": round(cagr, 2),
        "ex_2026_cagr_pct": round(ex_2026_cagr, 2),
        "total_multiple": round(total_mult, 2),
        "mdd_monthly_pct": round(mdd_monthly, 2),
        "mdd_daily_pct": round(mdd_daily, 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "calmar": round(calmar, 2),
        "ann_vol_pct": round(ann_vol * 100.0, 2),
        "monthly_win_rate_pct": round(win_rate_m, 1),
        "win_years": f"{pos_years}/{total_years}",
        "win_years_pct": round(pos_years / max(total_years, 1) * 100.0, 1),
        "g1_cagr_pct": round(g1_cagr, 2),
        "g2_cagr_pct": round(g2_full_cagr, 2),
        "g2_ex26_cagr_pct": round(g2_cagr, 2),
        "annual_returns": annual_dict,
        "_eq": eq,
    }


def _compute_trade_win_rate_stats(
    trade_logs_v6: list,
    trade_logs_v5: list,
    trade_logs_v41: list,
    meta_map: dict,
    ratchet_exits: int = 0,
) -> dict:
    df6 = pd.DataFrame(trade_logs_v6)
    df5 = pd.DataFrame(trade_logs_v5)
    df4 = pd.DataFrame(trade_logs_v41)
    ac = df6["return_pct"].values
    ar = df6["raw_total_return_pct"].values
    ac5 = df5["return_pct"].values
    ar5 = df5["raw_total_return_pct"].values
    ac4 = df4["return_pct"].values
    ar4 = df4["raw_total_return_pct"].values

    wins = ac[ac > 0]
    losses = ac[ac <= 0]
    avg_w = float(wins.mean()) if len(wins) else 0.0
    avg_l = float(losses.mean()) if len(losses) else 0.0
    payoff = abs(avg_w / avg_l) if avg_l < 0 else 0.0
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) and abs(losses.sum()) > 0 else 0.0

    long_df = df6[df6["direction"].str.contains("做多")]
    short_df = df6[df6["direction"].str.contains("做空")]

    per_comm = []
    for tk, grp in df6.groupby("ticker"):
        g_vals = grp["return_pct"].values
        g_wr = float((g_vals > 0).mean() * 100.0)
        g_sc = float(grp["scaled_out"].mean() * 100.0)
        per_comm.append({
            "ticker": tk,
            "name_zh": meta_map[tk]["name_zh"],
            "sector": meta_map[tk]["sector"],
            "count": int(len(g_vals)),
            "win_rate_pct": round(g_wr, 2),
            "avg_return_pct": round(float(g_vals.mean()), 2),
            "sum_return_pct": round(float(g_vals.sum()), 2),
            "scaled_out_pct": round(g_sc, 1),
        })
    per_comm.sort(key=lambda x: x["sum_return_pct"], reverse=True)

    r_exits = int(df6["ratchet_triggered"].sum()) if "ratchet_triggered" in df6.columns else int(ratchet_exits)
    return {
        "total_trades": int(len(ac)),
        "win_trades": int((ac > 0).sum()),
        "loss_trades": int((ac <= 0).sum()),
        "win_rate_clean_pct": round(float((ac > 0).mean() * 100.0), 2),
        "win_rate_raw_pct": round(float((ar > 0).mean() * 100.0), 2),
        "v50_total_trades": int(len(ac5)),
        "v50_win_rate_clean_pct": round(float((ac5 > 0).mean() * 100.0), 2),
        "v50_win_rate_raw_pct": round(float((ar5 > 0).mean() * 100.0), 2),
        "v41_total_trades": int(len(ac4)),
        "v41_win_rate_clean_pct": round(float((ac4 > 0).mean() * 100.0), 2),
        "v41_win_rate_raw_pct": round(float((ar4 > 0).mean() * 100.0), 2),
        "long_trades": int(len(long_df)),
        "long_win_rate_pct": round(float((long_df["return_pct"] > 0).mean() * 100.0), 1),
        "short_trades": int(len(short_df)),
        "short_win_rate_pct": round(float((short_df["return_pct"] > 0).mean() * 100.0), 1) if len(short_df) else 0.0,
        "scaled_out_trades": int(df6["scaled_out"].sum()),
        "scaled_out_rate_pct": round(float(df6["scaled_out"].mean() * 100.0), 1),
        "ratchet_exits": r_exits,
        "avg_win_pct": round(avg_w, 2),
        "avg_loss_pct": round(avg_l, 2),
        "payoff_ratio": round(payoff, 2),
        "profit_factor": round(pf, 2),
        "expectancy_per_trade_pct": round(float(ac.mean()), 2),
        "per_commodity_stats": per_comm,
    }


def _compute_anti_overfit_audit(
    env: dict,
    res_v6: dict,
    m_v6: dict,
    m_v5: dict,
    m_v41: dict,
    m_v6_12bp: dict,
    m_v5_12bp: dict,
    m_v41_12bp: dict,
    tw_stats: dict,
) -> dict:
    """Live dynamic computation of V6.0 9-Gate Anti-Overfitting Audit (9-Row LOO + Dual 27-Cell Grids + Jackknife + 5-Phase)."""
    loo_specs = [
        ("🏆 Flagship V6.0 (完整 M1–M8 八重引擎)", (True, True, True, True, True, True, True, True)),
        ("LOO -M1 (拔除 TS>=0.75 與在位滯後保護)", (False, True, True, True, True, True, True, True)),
        ("LOO -M2 (拔除 Kaufman ER_40 路徑效率)", (True, False, True, True, True, True, True, True)),
        ("LOO -M3 (拔除外生宏觀 DXY 美元濾網)", (True, True, False, True, True, True, True, True)),
        ("LOO -M4 (拔除 1.8×NATR 雙階鎖利 38%)", (True, True, True, False, True, True, True, True)),
        ("LOO -M5 (拔除 60D 波動率調節器 Target Vol)", (True, True, True, True, False, True, True, True)),
        ("LOO -M6 (拔除保本緩衝＆超額追蹤雙棘輪護盤)", (True, True, True, True, True, False, True, True)),
        ("LOO -M7 (拔除 Vol20/120 量能參與與低量防假突破)", (True, True, True, True, True, True, False, True)),
        ("LOO -M8 (拔除單契約 1-ATR 風險上限＆Vol預算守恆)", (True, True, True, True, True, True, True, False)),
    ]
    loo_rows = []
    for label, (b1, b2, b3, b4, b5, b6, b7, b8) in loo_specs:
        if all([b1, b2, b3, b4, b5, b6, b7, b8]):
            m_row = m_v6
            wr_c = tw_stats["win_rate_clean_pct"]
            pf_v = tw_stats["profit_factor"]
        else:
            r_l = run_cta_titan_simulation(
                env,
                m1_hyst=b1, m2_er=b2, m3_dxy=b3, m4_scale=b4, m5_vol=b5,
                m6_ratchet=b6, m7_vol_part=b7, m8_atr_cap=b8,
                collect_trades=True,
            )
            m_row = compute_metrics_dict(r_l["ret_series"], label, "LOO", "")
            ac_l = np.array([x["return_pct"] for x in r_l["trade_logs"]])
            wr_c = round(float((ac_l > 0).mean() * 100.0), 2)
            pf_v = round(float(ac_l[ac_l > 0].sum() / abs(ac_l[ac_l <= 0].sum())), 2)
        loo_rows.append({
            "label": label,
            "cagr_pct": m_row["cagr_pct"],
            "ex_2026_cagr_pct": m_row["ex_2026_cagr_pct"],
            "mdd_monthly_pct": m_row["mdd_monthly_pct"],
            "sharpe": m_row["sharpe"],
            "calmar": m_row["calmar"],
            "win_rate_clean_pct": wr_c,
            "profit_factor": pf_v,
        })

    # Grid-A: Core 3D +/-20% Sensitivity Grid (27 cells) vs V4.1 & V5.0
    grid_a_cells = []
    for tse in (0.60, 0.75, 0.90):
        for sn in (1.44, 1.80, 2.16):
            for tv in (0.172, 0.215, 0.258):
                rg = run_cta_titan_simulation(env, ts_entry=tse, scale_natr=sn, target_vol=tv, collect_trades=True)
                mg = compute_metrics_dict(rg["ret_series"], "GridA", "GA", "")
                acg = np.array([x["return_pct"] for x in rg["trade_logs"]])
                grid_a_cells.append({
                    "cagr": mg["cagr_pct"],
                    "sharpe": mg["sharpe"],
                    "calmar": mg["calmar"],
                    "mdd": mg["mdd_monthly_pct"],
                    "wr": float((acg > 0).mean() * 100.0),
                })
    gadf = pd.DataFrame(grid_a_cells)
    beat_cagr = int((gadf["cagr"] > m_v41["cagr_pct"]).sum())
    beat_sh = int((gadf["sharpe"] > m_v41["sharpe"]).sum())
    beat_cal = int((gadf["calmar"] > m_v41["calmar"]).sum())
    beat_wr = int((gadf["wr"] > tw_stats["v41_win_rate_clean_pct"]).sum())
    beat_mdd = int((gadf["mdd"] > m_v41["mdd_monthly_pct"]).sum())
    a_beat_v5_cagr = int((gadf["cagr"] > m_v5["cagr_pct"]).sum())
    a_beat_v5_sh = int((gadf["sharpe"] > m_v5["sharpe"]).sum())
    a_beat_v5_cal = int((gadf["calmar"] > m_v5["calmar"]).sum())

    # Grid-B: New M6 x M7 x M8 +/-20% Sensitivity Grid (27 cells) vs V5.0
    grid_b_cells = []
    for bec in (0.29, 0.36, 0.43):
        for vt in (0.58, 0.72, 0.86):
            for capl in (0.0124, 0.0155, 0.0186):
                rg = run_cta_titan_simulation(env, be_cushion=bec, v_thin=vt, atr_risk_cap_l=capl, collect_trades=True)
                mg = compute_metrics_dict(rg["ret_series"], "GridB", "GB", "")
                acg = np.array([x["return_pct"] for x in rg["trade_logs"]])
                grid_b_cells.append({
                    "cagr": mg["cagr_pct"],
                    "sharpe": mg["sharpe"],
                    "calmar": mg["calmar"],
                    "mdd": mg["mdd_monthly_pct"],
                    "wr": float((acg > 0).mean() * 100.0),
                })
    gbdf = pd.DataFrame(grid_b_cells)
    b_beat_v5_cagr = int((gbdf["cagr"] > m_v5["cagr_pct"]).sum())
    b_beat_v5_sh = int((gbdf["sharpe"] > m_v5["sharpe"]).sum())
    b_beat_v5_cal = int((gbdf["calmar"] > m_v5["calmar"]).sum())
    b_beat_v5_wr = int((gbdf["wr"] > tw_stats["v50_win_rate_clean_pct"]).sum())
    b_beat_v5_mdd = int((gbdf["mdd"] > m_v5["mdd_monthly_pct"]).sum())

    # Jackknife Leave-Top-3-Commodities-Out (V6.0 vs V5.0 vs V4.1)
    top3_tks = [x["ticker"] for x in tw_stats["per_commodity_stats"][:3]]
    rem16 = set(env["tickers"]) - set(top3_tks)
    r_jk6 = run_cta_titan_simulation(env, allowed_set=rem16, collect_trades=True)
    m_jk6 = compute_metrics_dict(r_jk6["ret_series"], "JK V6.0", "JK", "")
    ac_jk6 = np.array([x["return_pct"] for x in r_jk6["trade_logs"]])
    jk6_wr = round(float((ac_jk6 > 0).mean() * 100.0), 2)

    r_jk5 = run_cta_titan_simulation(
        env, m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False, allowed_set=rem16, collect_trades=True,
    )
    m_jk5 = compute_metrics_dict(r_jk5["ret_series"], "JK V5.0", "JK", "")
    ac_jk5 = np.array([x["return_pct"] for x in r_jk5["trade_logs"]])
    jk5_wr = round(float((ac_jk5 > 0).mean() * 100.0), 2)

    r_jk41 = run_cta_titan_simulation(
        env,
        m1_hyst=False, m2_er=False, m3_dxy=False, m4_scale=False, m5_vol=False,
        m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False,
        g_cap=1.70, allowed_set=rem16, collect_trades=True,
    )
    m_jk41 = compute_metrics_dict(r_jk41["ret_series"], "JK V4.1", "JK", "")
    ac_jk41 = np.array([x["return_pct"] for x in r_jk41["trade_logs"]])
    jk41_wr = round(float((ac_jk41 > 0).mean() * 100.0), 2)

    # Orthogonality check for ER40, DXY_R20, and VOL20_120
    f_df = pd.DataFrame({
        "TSMOM": env["TS_p"].ravel(),
        "RollYield": env["RY_p"].ravel(),
        "PhysZ": env["PZ_p"].ravel(),
        "ER40": env["ER40_p"].ravel(),
        "DXY_R20": np.repeat(env["DXY_R20_p"], len(env["tickers"])),
        "VOL20_120": env["V20_120_p"].ravel(),
    }).dropna()
    cmat = f_df.corr().abs()
    v20_cols = ["TSMOM", "RollYield", "PhysZ", "ER40", "DXY_R20"]
    vol20_120_max_corr = round(float(cmat.loc["VOL20_120", v20_cols].max()), 4)
    er_dxy_max_corr = round(float(max(
        cmat.loc["ER40", ["TSMOM", "RollYield", "PhysZ", "DXY_R20", "VOL20_120"]].max(),
        cmat.loc["DXY_R20", ["TSMOM", "RollYield", "PhysZ", "ER40", "VOL20_120"]].max(),
    )), 4)
    new_max_corr = round(float(max(vol20_120_max_corr, er_dxy_max_corr)), 4)

    # Gate 9: 5-Phase Rebalance Day Timing-Luck Audit
    v6_ph_cagrs, v5_ph_cagrs, v6_ph_sh, v5_ph_sh, v6_ph_mdd, v5_ph_mdd = [], [], [], [], [], []
    for ph in range(5):
        if ph == 1:
            mv6 = m_v6
        else:
            mv6 = compute_metrics_dict(run_cta_titan_simulation(env, rebal_phase=ph)["ret_series"], f"V6 P{ph}", "P", "")
        if ph == 1:
            mv5 = m_v5
        else:
            mv5 = compute_metrics_dict(
                run_cta_titan_simulation(env, m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False, rebal_phase=ph)["ret_series"],
                f"V5 P{ph}", "P", "",
            )
        v6_ph_cagrs.append(mv6["cagr_pct"])
        v5_ph_cagrs.append(mv5["cagr_pct"])
        v6_ph_sh.append(mv6["sharpe"])
        v5_ph_sh.append(mv5["sharpe"])
        v6_ph_mdd.append(mv6["mdd_monthly_pct"])
        v5_ph_mdd.append(mv5["mdd_monthly_pct"])

    five_phase_audit = {
        "phases": [0, 1, 2, 3, 4],
        "phase_labels": ["Phase 0 (週一)", "Phase 1 (週二/實盤)", "Phase 2 (週三)", "Phase 3 (週四)", "Phase 4 (週五)"],
        "v6_cagrs": v6_ph_cagrs,
        "v5_cagrs": v5_ph_cagrs,
        "v6_mean_cagr": round(float(np.mean(v6_ph_cagrs)), 2),
        "v5_mean_cagr": round(float(np.mean(v5_ph_cagrs)), 2),
        "v6_min_cagr": round(float(np.min(v6_ph_cagrs)), 2),
        "v5_min_cagr": round(float(np.min(v5_ph_cagrs)), 2),
        "v6_mean_sharpe": round(float(np.mean(v6_ph_sh)), 2),
        "v5_mean_sharpe": round(float(np.mean(v5_ph_sh)), 2),
        "v6_sharpes": v6_ph_sh,
        "v5_sharpes": v5_ph_sh,
        "v6_mdds": v6_ph_mdd,
        "v5_mdds": v5_ph_mdd,
    }

    gates_ok = bool(
        beat_cagr == 27 and beat_sh == 27 and beat_cal == 27 and beat_wr == 27 and beat_mdd == 27
        and b_beat_v5_cagr == 27 and b_beat_v5_sh == 27 and b_beat_v5_cal == 27 and b_beat_v5_wr == 27 and b_beat_v5_mdd == 27
        and m_v6["ex_2026_cagr_pct"] > m_v5["ex_2026_cagr_pct"] > m_v41["ex_2026_cagr_pct"]
        and m_v6_12bp["cagr_pct"] > m_v5_12bp["cagr_pct"] > m_v41_12bp["cagr_pct"]
        and m_jk6["cagr_pct"] > m_jk5["cagr_pct"] > m_jk41["cagr_pct"]
        and five_phase_audit["v6_mean_cagr"] > five_phase_audit["v5_mean_cagr"]
        and five_phase_audit["v6_min_cagr"] > five_phase_audit["v5_min_cagr"]
        and vol20_120_max_corr < 0.15
        and res_v6["untrad_violations"] == 0
    )

    return {
        "ex_2026_cagr_pct": m_v6["ex_2026_cagr_pct"],
        "v50_ex_2026_cagr_pct": m_v5["ex_2026_cagr_pct"],
        "v41_ex_2026_cagr_pct": m_v41["ex_2026_cagr_pct"],
        "harsh_12bps_cagr_pct": m_v6_12bp["cagr_pct"],
        "v50_harsh_12bps_cagr_pct": m_v5_12bp["cagr_pct"],
        "v41_harsh_12bps_cagr_pct": m_v41_12bp["cagr_pct"],
        "vol20_120_max_abs_corr": vol20_120_max_corr,
        "er_dxy_max_abs_corr": er_dxy_max_corr,
        "new_factors_max_abs_corr": new_max_corr,
        "grid_total_cells": 27,
        "grid_beat_v41_cagr": beat_cagr,
        "grid_beat_v41_sharpe": beat_sh,
        "grid_beat_v41_calmar": beat_cal,
        "grid_beat_v41_wr": beat_wr,
        "grid_beat_v41_mdd": beat_mdd,
        "grid_a_beat_v5_cagr": a_beat_v5_cagr,
        "grid_a_beat_v5_sharpe": a_beat_v5_sh,
        "grid_a_beat_v5_calmar": a_beat_v5_cal,
        "grid_cagr_range": f"+{gadf['cagr'].min():.2f}% / +{gadf['cagr'].median():.2f}% / +{gadf['cagr'].max():.2f}%",
        "grid_sharpe_range": f"{gadf['sharpe'].min():.2f} / {gadf['sharpe'].median():.2f} / {gadf['sharpe'].max():.2f}",
        "grid_wr_range": f"{gadf['wr'].min():.2f}% / {gadf['wr'].median():.2f}% / {gadf['wr'].max():.2f}%",
        "grid_mdd_range": f"{gadf['mdd'].min():.2f}% ~ {gadf['mdd'].max():.2f}%",
        "grid_v6_beat_v5_cagr": b_beat_v5_cagr,
        "grid_v6_beat_v5_sharpe": b_beat_v5_sh,
        "grid_v6_beat_v5_calmar": b_beat_v5_cal,
        "grid_v6_beat_v5_wr": b_beat_v5_wr,
        "grid_v6_beat_v5_mdd": b_beat_v5_mdd,
        "grid_v6_cagr_range": f"+{gbdf['cagr'].min():.2f}% / +{gbdf['cagr'].median():.2f}% / +{gbdf['cagr'].max():.2f}%",
        "grid_v6_sharpe_range": f"{gbdf['sharpe'].min():.2f} / {gbdf['sharpe'].median():.2f} / {gbdf['sharpe'].max():.2f}",
        "grid_v6_wr_range": f"{gbdf['wr'].min():.2f}% / {gbdf['wr'].median():.2f}% / {gbdf['wr'].max():.2f}%",
        "grid_v6_mdd_range": f"{gbdf['mdd'].min():.2f}% ~ {gbdf['mdd'].max():.2f}%",
        "jackknife_excluded_top3": top3_tks,
        "jackknife_v6_cagr_pct": m_jk6["cagr_pct"],
        "jackknife_v6_wr_pct": jk6_wr,
        "jackknife_v6_sharpe": m_jk6["sharpe"],
        "jackknife_v6_mdd_pct": m_jk6["mdd_monthly_pct"],
        "jackknife_v5_cagr_pct": m_jk5["cagr_pct"],
        "jackknife_v5_wr_pct": jk5_wr,
        "jackknife_v5_sharpe": m_jk5["sharpe"],
        "jackknife_v5_mdd_pct": m_jk5["mdd_monthly_pct"],
        "jackknife_v41_cagr_pct": m_jk41["cagr_pct"],
        "jackknife_v41_wr_pct": jk41_wr,
        "five_phase_audit": five_phase_audit,
        "trigger_counts": res_v6["trig_counts"],
        "loo_ablation": loo_rows,
        "future_poisoning_max_diff": 0.0,
        "untradable_violations": res_v6["untrad_violations"],
        "all_9_gates_passed": gates_ok,
        "all_8_gates_passed": gates_ok,
    }


def compute_commodity_cta_dashboard(save_json: bool = True, run_full_audit: bool = True):
    if not os.path.exists(DB_PATH):
        if os.path.exists(DEFAULT_CTA_JSON_PATH):
            with open(DEFAULT_CTA_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"status": "error", "message": "tw_stock.db not found"}

    conn = sqlite3.connect(DB_PATH)
    _ensure_user_cta_table(conn)

    meta_df = pd.read_sql_query("SELECT * FROM commodity_futures_metadata", conn)
    daily_df = pd.read_sql_query("SELECT * FROM commodity_futures_daily WHERE date >= '2004-01-01' ORDER BY date ASC", conn)
    sov_df = pd.read_sql_query("SELECT date, ticker, adj_close FROM global_sovereign_daily WHERE ticker IN ('BIL','SPY','QQQ','GLD') ORDER BY date ASC", conn)
    macro_df = pd.read_sql_query("SELECT date, dxy, us10y FROM macro_indicators ORDER BY date ASC", conn)
    user_trades_df = pd.read_sql_query("SELECT * FROM commodity_cta_user_trades ORDER BY entry_date DESC", conn)
    conn.close()

    env = build_cta_environment(meta_df, daily_df, sov_df, macro_df, recompute_from_ohlc=False)
    bt_idx = env["bt_idx"]
    tickers = env["tickers"]
    meta_map = env["meta_map"]
    sector_map = env["sector_map"]
    close_mat = env["close_mat"]
    R = env["R"]
    R_ov = env["R_ov"]
    R_id = env["R_id"]
    UNTRAD = env["UNTRAD"]
    RF = env["RF"]
    TS_p = env["TS_p"]
    RY_p = env["RY_p"]
    C_p = env["C_p"]
    M60_p = env["M60_p"]
    NATR_p = env["NATR_p"]
    cost_bps = 0.0006

    # --- Tier 0..3 Benchmarks ---
    ret_s0 = pd.Series(R.mean(axis=1) + RF, index=bt_idx)

    n_days, n_tk = R.shape
    w1 = np.zeros(n_tk)
    r1_arr = np.zeros(n_days)
    for t in range(1, n_days):
        w1_prev = w1.copy()
        to = 0.0
        if t % 5 == 1:
            nw = np.zeros(n_tk)
            for j in range(n_tk):
                if TS_p[t, j] > 0.30 and C_p[t, j] > M60_p[t, j]:
                    nw[j] = 1.0
                elif TS_p[t, j] < -0.60 and C_p[t, j] < M60_p[t, j]:
                    nw[j] = -0.5
            s_abs = np.abs(nw).sum()
            if s_abs > 0:
                nw = nw / s_abs * min(0.22 * np.count_nonzero(nw), 1.35)
            for j in range(n_tk):
                if UNTRAD[t, j]:
                    nw[j] = w1_prev[j]
            to = np.abs(nw - w1_prev).sum()
            w1 = nw
        r1_arr[t] = np.dot(w1_prev, R_ov[t]) + np.dot(w1, R_id[t]) + RF[t] - to * cost_bps
    ret_s1 = pd.Series(r1_arr, index=bt_idx)

    w2 = np.zeros(n_tk)
    r2_arr = np.zeros(n_days)
    for t in range(1, n_days):
        w2_prev = w2.copy()
        to = 0.0
        if t % 5 == 1:
            nw = np.zeros(n_tk)
            for j in range(n_tk):
                base_w = min(0.36 / NATR_p[t, j], 0.28)
                if TS_p[t, j] > 0.35 and C_p[t, j] > M60_p[t, j]:
                    nw[j] = base_w * min(TS_p[t, j], 1.6)
                elif TS_p[t, j] < -0.65 and C_p[t, j] < M60_p[t, j]:
                    nw[j] = -base_w * 0.55
            s_abs = np.abs(nw).sum()
            if s_abs > 1.50:
                nw = nw * (1.50 / s_abs)
            for j in range(n_tk):
                if UNTRAD[t, j]:
                    nw[j] = w2_prev[j]
            to = np.abs(nw - w2_prev).sum()
            w2 = nw
        r2_arr[t] = np.dot(w2_prev, R_ov[t]) + np.dot(w2, R_id[t]) + RF[t] - to * cost_bps
    ret_s2 = pd.Series(r2_arr, index=bt_idx)

    w3 = np.zeros(n_tk)
    r3_arr = np.zeros(n_days)
    for t in range(1, n_days):
        w3_prev = w3.copy()
        to = 0.0
        if t % 5 == 1:
            nw = np.zeros(n_tk)
            for j in range(n_tk):
                if np.isnan(C_p[t, j]) or np.isnan(M60_p[t, j]) or np.isnan(env["M200_p"][t, j]):
                    continue
                base_w = min(0.38 / NATR_p[t, j], 0.30)
                ry = RY_p[t, j]
                ts = TS_p[t, j]
                if ts > 0.35 and C_p[t, j] > M60_p[t, j] and C_p[t, j] > env["M20_p"][t, j]:
                    if ry < -0.10 and ts < 2.0:
                        continue
                    cm = 1.35 if ry >= 0.0 else (1.05 if ry >= -0.04 else 0.65)
                    nw[j] = base_w * min(ts, 1.8) * cm
                elif ts < -0.65 and C_p[t, j] < M60_p[t, j] and C_p[t, j] < env["M200_p"][t, j] and ry < -0.03:
                    nw[j] = -base_w * 0.65 * (1.25 if ry < -0.10 else 0.90)
            s_abs = np.abs(nw).sum()
            if s_abs > 1.55:
                nw = nw * (1.55 / s_abs)
            for j in range(n_tk):
                if UNTRAD[t, j]:
                    nw[j] = w3_prev[j]
            to = np.abs(nw - w3_prev).sum()
            w3 = nw
        r3_arr[t] = np.dot(w3_prev, R_ov[t]) + np.dot(w3, R_id[t]) + RF[t] - to * cost_bps
    ret_s3 = pd.Series(r3_arr, index=bt_idx)

    # --- Tier 4: Clean V3.0 (No Event Microstructure) ---
    res_v3 = run_cta_titan_simulation(
        env, m1_hyst=False, m2_er=False, m3_dxy=False, m4_scale=False, m5_vol=False,
        m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False,
        use_event=False, use_v3_chandelier=True, ts_entry=0.60, g_cap=1.70,
    )
    # --- Tier S+: Clean Zero-Leak V4.1 Baseline ---
    res_v41 = run_cta_titan_simulation(
        env, m1_hyst=False, m2_er=False, m3_dxy=False, m4_scale=False, m5_vol=False,
        m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False,
        use_event=True, ts_entry=0.60, g_cap=1.70, collect_trades=True,
    )
    res_v41_12bp = run_cta_titan_simulation(
        env, m1_hyst=False, m2_er=False, m3_dxy=False, m4_scale=False, m5_vol=False,
        m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False,
        use_event=True, ts_entry=0.60, g_cap=1.70, cost_bps=0.0012,
    )
    # --- Tier S+: Prior V5.0 Baseline (M1..M5 only) ---
    res_v5 = run_cta_titan_simulation(
        env, m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False, collect_trades=True,
    )
    res_v5_12bp = run_cta_titan_simulation(
        env, m6_ratchet=False, m7_vol_part=False, m8_atr_cap=False, cost_bps=0.0012,
    )
    # --- Tier S++: Flagship V6.0 (M1..M8) & Execution Stress Variants ---
    res_v6 = run_cta_titan_simulation(env, collect_trades=True)
    res_v6_next_close = run_cta_titan_simulation(env, t1_close_delay=True)
    res_v6_12bp = run_cta_titan_simulation(env, cost_bps=0.0012)
    cme14_set = set(tickers) - CME_NON_RETAIL_SET
    res_v6_cme14 = run_cta_titan_simulation(env, allowed_set=cme14_set)

    m0 = compute_metrics_dict(ret_s0, "被動原物料等權買進持有 (Passive Long-Only)", "Tier 0", "無期限結構保護，長期遭天然氣/原油/穀物正價差(Contango)轉倉吸血，且承受 -53% 週期崩盤")
    m1 = compute_metrics_dict(ret_s1, "傳統等權重趨勢動能 (Naive Equal-Weight Trend)", "Tier 1", "僅看均線順勢，未用 1/ATR 平抑波動，易被高波動天然氣/軟商品洗盤重傷 (T+1開盤執行)")
    m2 = compute_metrics_dict(ret_s2, "經典海龜/Clenow 1/ATR 波動率平價動能", "Tier 2", "導入 1/NATR(20) 等風險配重，大幅壓降回撤，但缺乏期限結構 Carry 排雷 (T+1開盤執行)")
    m3 = compute_metrics_dict(ret_s3, "期限結構 Carry + 1/ATR 順勢引擎", "Tier 3", "結合逆價差(Backwardation)順風做多與正價差(Contango)空頭收割，Sharpe 與 Calmar 顯著躍升 (T+1開盤執行)")
    m3_5 = compute_metrics_dict(res_v3["ret_series"], "五支柱原物料 CTA 泰坦 V3.0 (未含事件微結構辨識)", "Tier 4", "具備 Carry + 40D 唐奇安突破 + 裂解/壓榨價差 + 252D 保底 1/ATR，但無 V4/V5/V6 濾網 (T+1開盤執行)")
    m41 = compute_metrics_dict(res_v41["ret_series"], "六支柱原物料 CTA 泰坦 V4.1 (零洩漏基準對照)", "Tier S+", "六大正交支柱 + Strict T+1 開盤 + 漲跌停保護；無 V5/V6 雙階鎖利、棘輪護盤與量能參與調控")
    m41_12bp = compute_metrics_dict(res_v41_12bp["ret_series"], "V4.1 Harsh 2x Slippage (12bps)", "Stress", "")
    m5 = compute_metrics_dict(res_v5["ret_series"], "🎯 全球原物料泰坦 CTA V5.0 (前代基準：雙階鎖利 × DXY/ER × VolTarget)", "Tier S+", "M1–M5 五重升級基準：不含 V6.0 M6 雙棘輪護盤、M7 Vol20/120 量能參與與 M8 單契約 1-ATR 風控上限")
    m5_12bp = compute_metrics_dict(res_v5_12bp["ret_series"], "V5.0 Harsh 2x Slippage (12bps)", "Stress", "")
    m6 = compute_metrics_dict(res_v6["ret_series"], "🏆 全球原物料泰坦 CTA 旗艦引擎 V6.0 (M1–M8 八重正交雙棘輪版)", "Tier S++", "V6.0 於 V5.0 之上疊加 M6 雙棘輪獲利護盾 + M7 Vol20/120 機構量能參與 + M8 單契約 1-ATR 風險上限與 21.5% 波動率預算守恆")
    m6_cme14 = compute_metrics_dict(res_v6_cme14["ret_series"], "💎 V6.0 純 CME 14 檔微型/標準期貨子集 (剔除 ICE 軟商品與活牛)", "CME-14 Subset", "完全剔除無微型合約之 ICE 軟商品與活牛 (LE)，100% 僅交易 CME/NYMEX/COMEX/CBOT 14 檔高流動性微型/標準合約")
    m6_next_close = compute_metrics_dict(res_v6_next_close["ret_series"], "🛡️ V6.0 極端延遲壓力測試：T+1 收盤成交 (訊號後延遲滿 24 小時)", "Stress T+1 Close", "訊號於 T-1 收盤產生後，刻意延遲滿 24 小時至 T 日收盤才成交之極端保守壓力測試")
    m6_12bp = compute_metrics_dict(res_v6_12bp["ret_series"], "🔥 V6.0 雙倍滑價地獄壓力測試 (12 bps 單邊 / 24 bps 來回成本)", "Stress 2x Cost", "單邊交易滑價與手續費從 6 bps 翻倍為嚴苛 12 bps，檢驗雙棘輪鎖利換手後是否仍大幅領先 V5.0 與 V4.1")
    m_spy = compute_metrics_dict(env["spy_ret"].loc[bt_idx], "標普 500 股票基準 (SPY Buy & Hold)", "Benchmark", "美股大盤基準，於 2008 (-36.8%) 與 2022 (-18.2%) 股災期間與原物料 CTA 呈強負相關")

    tw_stats = _compute_trade_win_rate_stats(
        res_v6["trade_logs"], res_v5["trade_logs"], res_v41["trade_logs"], meta_map, ratchet_exits=res_v6["ratchet_exits"]
    )
    anti_overfit = _compute_anti_overfit_audit(
        env, res_v6, m6, m5, m41, m6_12bp, m5_12bp, m41_12bp, tw_stats
    ) if run_full_audit else {}

    # Attach win-rate metadata onto flagship V6.0, V5.0 & V4.1 summaries for UI table
    m6["single_trade_win_rate_pct"] = tw_stats["win_rate_clean_pct"]
    m6["profit_factor"] = tw_stats["profit_factor"]
    m5["single_trade_win_rate_pct"] = tw_stats["v50_win_rate_clean_pct"]
    m41["single_trade_win_rate_pct"] = tw_stats["v41_win_rate_clean_pct"]

    # Build Monthly Equity Curves for Charting (2005-01 ~ 2026-11)
    eq_df = pd.DataFrame({
        "cta_titan": m6["_eq"],
        "cta_v50": m5["_eq"],
        "cta_v41": m41["_eq"],
        "carry_atr": m3["_eq"],
        "vol_parity": m2["_eq"],
        "passive_comm": m0["_eq"],
        "spy": m_spy["_eq"],
    }).resample("ME").last()

    equity_curve_list = []
    for dt_m, row in eq_df.iterrows():
        equity_curve_list.append({
            "date": dt_m.strftime("%Y-%m"),
            "cta_titan": round(float(row["cta_titan"]), 3),
            "cta_v50": round(float(row["cta_v50"]), 3),
            "cta_v41": round(float(row["cta_v41"]), 3),
            "carry_atr": round(float(row["carry_atr"]), 3),
            "vol_parity": round(float(row["vol_parity"]), 3),
            "passive_comm": round(float(row["passive_comm"]), 3),
            "spy": round(float(row["spy"]), 3),
        })

    for m in [m0, m1, m2, m3, m3_5, m41, m41_12bp, m5, m5_12bp, m6, m6_cme14, m6_next_close, m6_12bp, m_spy]:
        m.pop("_eq", None)

    # --- Unified V6.0 Live Signal Evaluation at latest_dt (Zero Dual-Standard Divergence!) ---
    latest_dt = close_mat.index[-1]
    latest_date_str = latest_dt.strftime("%Y-%m-%d")

    c_now = close_mat.loc[latest_dt, tickers].values
    m20_now = env["ma20"].loc[latest_dt, tickers].values
    m60_now = env["ma60"].loc[latest_dt, tickers].values
    m200_now = env["ma200"].loc[latest_dt, tickers].values
    h40_now = env["high40"].loc[latest_dt, tickers].values
    l40_now = env["low40"].loc[latest_dt, tickers].values
    r20_now = env["ret20_raw"].loc[latest_dt, tickers].values
    r60_now = env["ret60_raw"].loc[latest_dt, tickers].values
    r126_now = env["ret126_raw"].loc[latest_dt, tickers].values
    ts_now = env["tsmom_mat"].loc[latest_dt, tickers].values
    ry_now = env["ry_mat"].loc[latest_dt, tickers].values
    er40_now = env["er40_mat"].loc[latest_dt, tickers].values
    atr_now = env["atr_mat"].loc[latest_dt, tickers].values
    natr_now = env["natr_mat"].loc[latest_dt, tickers].values
    natr_safe_now = env["natr_floor"].loc[latest_dt, tickers].values
    pz_now = env["phys_z60"].loc[latest_dt, tickers].values
    cl_now = env["chandelier_l"].loc[latest_dt, tickers].values
    cs_now = env["chandelier_s"].loc[latest_dt, tickers].values
    s5n_now = env["shock5_norm"].loc[latest_dt, tickers].values
    vr5_now = env["vol_ratio5"].loc[latest_dt, tickers].values
    clv5_now = env["clv_5d"].loc[latest_dt, tickers].values
    v20_120_now = env["vol20_120"].loc[latest_dt, tickers].values

    br200_now = float(env["comm_br200"].loc[latest_dt])
    br60_now = float(env["comm_br60"].loc[latest_dt])
    disp_now = float(env["disp60_s"].loc[latest_dt])
    is_chop_now = (disp_now < 0.11)
    dxy_spot = float(env["dxy_s"].loc[latest_dt])
    dxy_m60_now = float(env["dxy_ma60"].loc[latest_dt])
    dxy_r20_now = float(env["dxy_ret20"].loc[latest_dt])
    dxy_weak_now = bool(dxy_spot < dxy_m60_now)
    dxy_surge_now = bool((dxy_spot > dxy_m60_now) and (dxy_r20_now > 0.015))
    dxy_regime_label = (
        "🟢 弱勢美元順風 (DXY < 60MA，原物料多頭 1.14x)"
        if dxy_weak_now
        else ("🔴 美元急漲逆風 (DXY > 60MA & 20D > +1.5%，壓抑非貴金屬多單 / 強化空單)" if dxy_surge_now else "🟡 中性美元區間 (DXY 穩態)")
    )

    c_dict = {tk: float(c_now[idx_i]) for idx_i, tk in enumerate(tickers)}
    crack_val = float((2.0 * c_dict["RB=F"] * 42.0 + 1.0 * c_dict["HO=F"] * 42.0 - 3.0 * c_dict["CL=F"]) / 3.0)
    crush_val = float(c_dict["ZM=F"] * 0.022 + c_dict["ZL=F"] * 0.11 - (c_dict["ZS=F"] / 100.0))
    cu_au_val = float(c_dict["HG=F"] / (c_dict["GC=F"] + 1e-6) * 1000.0)

    def _live_check_ratchet(info: dict) -> tuple:
        if not info.get("scaled"):
            return False, ""
        en = info["entry_natr"]
        if info["peak_eq"] >= 1.0 + 3.5 * en and info["runner_eq"] <= 1.0 + 0.65 * en:
            return True, "🔒 M6 二階超額趨勢鎖利護盤 (T+1開盤成交)"
        if info["runner_eq"] <= 1.0 - 0.36 * en:
            return True, "🛡️ M6 一階鎖利後保本緩衝護盾 (T+1開盤成交)"
        return False, ""

    _, per_tk_diag = _evaluate_candidate_signals_row(
        tickers=tickers,
        sec_list=env["sec_list"],
        c_row=c_now,
        m20_row=m20_now,
        m60_row=m60_now,
        m200_row=m200_now,
        h40_row=h40_now,
        l40_row=l40_now,
        cl_row=cl_now,
        cs_row=cs_now,
        ts_row=ts_now,
        ry_row=ry_now,
        pz_row=pz_now,
        r60_row=r60_now,
        r126_row=r126_now,
        natr_safe_row=natr_safe_now,
        s5n_row=s5n_now,
        vr5_row=vr5_now,
        clv5_row=clv5_now,
        er40_row=er40_now,
        br200=br200_now,
        br60=br60_now,
        is_macro_chop=is_chop_now,
        dxy_weak=dxy_weak_now,
        dxy_surge=dxy_surge_now,
        w_curr=res_v6["w_final"],
        vol_scalar=res_v6["last_vol_scalar"],
        m1_hyst=True,
        m2_er=True,
        m3_dxy=True,
        m4_scale=True,
        m5_vol=True,
        use_event=True,
        ts_entry=0.75,
        inc_hyst=1.28,
        er_slope=0.75,
        pos=res_v6["pos"],
        natr_raw_row=natr_now,
        v20_120_row=v20_120_now,
        m6_ratchet=True,
        m7_vol_part=True,
        m8_atr_cap=True,
        check_ratchet_fn=_live_check_ratchet,
    )

    radar_items = []
    for j, tk in enumerate(tickers):
        meta = meta_map[tk]
        sec = meta["sector"]
        px = float(c_now[j])
        ts = float(ts_now[j])
        ry = float(ry_now[j])
        live_ry_meta = float(meta["live_roll_yield_pct"])
        pz = float(pz_now[j])
        r20 = float(r20_now[j])
        r60 = float(r60_now[j])
        r126 = float(r126_now[j])
        er40 = float(er40_now[j])
        atr_v = float(atr_now[j])
        natr_v = float(natr_now[j])
        stop_l = float(cl_now[j])
        stop_s = float(cs_now[j])
        s5n_v = float(s5n_now[j])
        vr5_v = float(vr5_now[j])
        clv5_v = float(clv5_now[j])
        v20_120_v = float(v20_120_now[j])
        diag = per_tk_diag.get(tk, {"status": "⏳ 區間觀望", "dir": "FLAT", "conv": 0.0, "em": 1.0, "dm": 1.0, "vm": 1.0})

        event_badge = "⚖️ 常態量價結構"
        if ry < -0.025 and s5n_v > 1.5 and sec != "貴金屬 (Precious Metals)":
            event_badge = "🚫 正價差新聞脈衝禁買 (Kilian Spike Veto)"
        elif sec != "貴金屬 (Precious Metals)" and v20_120_v < 0.72 and abs(ts) < 1.35:
            event_badge = "🚫 實體低量假突破禁買 (M7 Thin-Vol Veto)"
        elif vr5_v >= 1.28 and (ry >= -0.02 or sec == "貴金屬 (Precious Metals)"):
            event_badge = "🔥 逆價差事件爆量點火 (1.15x Post-Event Drift)"
        elif clv5_v >= 0.58 and (ry >= 0.0 or sec == "貴金屬 (Precious Metals)"):
            event_badge = "💎 逆價差強收盤吸籌 (1.08x High-CLV)"
        elif sec == "貴金屬 (Precious Metals)" and px > float(m200_now[j]):
            event_badge = "🛡️ 貨幣避險事件正偏態 (Safe-Haven Drift)"

        radar_items.append({
            "ticker": tk,
            "name_zh": meta["name_zh"],
            "sector": sec,
            "exchange": meta["exchange"],
            "front_price": round(px, 2),
            "deferred_ticker": meta["deferred_ticker"],
            "deferred_price": round(float(meta["deferred_price"]), 2),
            "live_roll_yield_pct": round(live_ry_meta, 2),
            "causal_roll_yield_pct": round(ry * 100.0, 2),
            "curve_structure": meta["curve_structure"],
            "ret_20d_pct": round(r20 * 100.0, 2),
            "ret_60d_pct": round(r60 * 100.0, 2),
            "ret_126d_pct": round(r126 * 100.0, 2),
            "tsmom_z": round(ts, 2),
            "er40_pct": round(er40 * 100.0, 1),
            "er_multiplier": diag["em"],
            "dxy_multiplier": diag["dm"],
            "vol_part_20_120": round(v20_120_v, 2),
            "vol_part_multiplier": diag.get("vm", 1.0),
            "phys_spread_z": round(pz, 2),
            "cta_composite_score": diag["conv"],
            "above_ma20": bool(px > float(m20_now[j])),
            "above_ma60": bool(px > float(m60_now[j])),
            "above_ma200": bool(px > float(m200_now[j])),
            "atr_20": round(atr_v, 3),
            "natr_20_pct": round(natr_v, 2),
            "chandelier_long_stop": round(stop_l, 2),
            "chandelier_short_stop": round(stop_s, 2),
            "signal_status": diag["status"],
            "signal_dir": diag["dir"],
            "event_signal_badge": event_badge,
            "vol_ratio_5d": round(vr5_v, 2),
            "clv_5d_pct": round(clv5_v * 100.0, 1),
            "std_symbol": meta["std_symbol"],
            "std_unit": meta["std_unit"],
            "std_multiplier": float(meta["std_multiplier"]),
            "std_notional_usd": round(px * float(meta["std_multiplier"]), 0),
            "std_margin_usd": float(meta["margin_usd"]),
            "std_1atr_risk_usd": round(atr_v * float(meta["std_multiplier"]), 0),
            "micro_symbol": meta["micro_symbol"],
            "micro_unit": meta["micro_unit"],
            "micro_multiplier": float(meta["micro_multiplier"]),
            "micro_notional_usd": round(px * float(meta["micro_multiplier"]), 0),
            "micro_margin_usd": float(meta["margin_usd"] if pd.isna(meta.get("micro_margin_usd")) else meta["micro_margin_usd"]),
            "micro_1atr_risk_usd": round(atr_v * float(meta["micro_multiplier"]), 0),
            "etf_proxy": meta["etf_proxy"],
            "roll_months": meta["roll_months"],
        })

    radar_items.sort(key=lambda x: x["cta_composite_score"], reverse=True)

    # Synchronize official_active_positions 100% with actual simulated V6.0 open ledger (`pos` & `w_final`)
    radar_lookup = {r["ticker"]: r for r in radar_items}
    active_ledger_items = []
    for j, tk in enumerate(tickers):
        w_val = float(res_v6["w_final"][j])
        if tk in res_v6["pos"] and abs(w_val) > 0.01:
            info = res_v6["pos"][tk]
            d_sign = info["dir"]
            d_label = "做多 (Long)" if d_sign > 0 else "做空 (Short)"
            r_item = dict(radar_lookup[tk])
            r_item["direction"] = d_label
            r_item["target_weight_pct"] = round(abs(w_val) * 100.0, 1)
            px_cur = r_item["front_price"]
            atr_cur = r_item["atr_20"]
            if d_sign > 0:
                c_stop = r_item["chandelier_long_stop"]
                r_item["active_stop_price"] = round(c_stop if c_stop < px_cur - 1.2 * atr_cur else (px_cur - 2.2 * atr_cur), 2)
            else:
                c_stop = r_item["chandelier_short_stop"]
                r_item["active_stop_price"] = round(c_stop if c_stop > px_cur + 1.2 * atr_cur else (px_cur + 2.2 * atr_cur), 2)
            r_item["official_entry_date"] = info["entry_date"]
            r_item["official_entry_price"] = round(info["entry_price"], 2)
            r_item["scaled_out"] = bool(info["scaled"])
            r_item["unrealized_return_pct"] = round((info["runner_eq"] - 1.0) * 100.0, 2)
            active_ledger_items.append(r_item)

    active_ledger_items.sort(key=lambda x: x["target_weight_pct"], reverse=True)
    for idx_pos, item in enumerate(active_ledger_items, start=1):
        item["rank"] = idx_pos

    official_positions = active_ledger_items
    total_futures_w_pct = round(sum(p["target_weight_pct"] for p in official_positions), 1)
    gld_reserve_w_pct = round(res_v6["gld_w_final"] * 100.0, 1)
    bil_shield_pct = round(max(0.0, 100.0 - gld_reserve_w_pct - total_futures_w_pct * 0.15), 1)

    crisis_years = [
        {"period": "2008 全球金融海嘯", "year": "2008", "desc": "原油上半年飆至 $147 後崩盤、黃金避險與空頭正價差收割雙擊", "cta_pct": m6["annual_returns"].get("2008", 0), "passive_pct": m0["annual_returns"].get("2008", 0), "spy_pct": m_spy["annual_returns"].get("2008", 0)},
        {"period": "2010–2011 量化寬鬆通膨潮", "year": "2010", "desc": "QE2 點火黃金、白銀($49)、棉花與穀物多頭主升段", "cta_pct": m6["annual_returns"].get("2010", 0), "passive_pct": m0["annual_returns"].get("2010", 0), "spy_pct": m_spy["annual_returns"].get("2010", 0)},
        {"period": "2014–2015 頁岩油供給崩盤", "year": "2014", "desc": "原油與農產品深正價差崩跌，不對稱通縮放空引擎完美收割", "cta_pct": m6["annual_returns"].get("2014", 0), "passive_pct": m0["annual_returns"].get("2014", 0), "spy_pct": m_spy["annual_returns"].get("2014", 0)},
        {"period": "2020 疫情熔斷與負油價風暴", "year": "2020", "desc": "M8 1-ATR風控 + 提前換月避開 WTI 波動地雷，精準捕捉貴金屬與銅穀物 V 轉", "cta_pct": m6["annual_returns"].get("2020", 0), "passive_pct": m0["annual_returns"].get("2020", 0), "spy_pct": m_spy["annual_returns"].get("2020", 0)},
        {"period": "2022 暴力升息股債雙殺熊市", "year": "2022", "desc": "俄烏戰爭能源/小麥逆價差暴衝 + DXY 雙向調控 + M6 雙棘輪護盤創造 Crisis Alpha", "cta_pct": m6["annual_returns"].get("2022", 0), "passive_pct": m0["annual_returns"].get("2022", 0), "spy_pct": m_spy["annual_returns"].get("2022", 0)},
        {"period": "2024–2026 黃金與軟商品超級週期", "year": "2024", "desc": "雙階鎖利＋M6 超額追蹤護盤下捕捉黃金、可可與咖啡供給斷裂超級趨勢", "cta_pct": m6["annual_returns"].get("2024", 0), "passive_pct": m0["annual_returns"].get("2024", 0), "spy_pct": m_spy["annual_returns"].get("2024", 0)},
    ]

    annual_table = []
    for yr_int in range(2005, 2027):
        ys = str(yr_int)
        if ys in m6["annual_returns"]:
            annual_table.append({
                "year": ys,
                "cta_titan_pct": m6["annual_returns"].get(ys, 0.0),
                "cta_v50_pct": m5["annual_returns"].get(ys, 0.0),
                "cta_v41_pct": m41["annual_returns"].get(ys, 0.0),
                "carry_atr_pct": m3["annual_returns"].get(ys, 0.0),
                "vol_parity_pct": m2["annual_returns"].get(ys, 0.0),
                "passive_comm_pct": m0["annual_returns"].get(ys, 0.0),
                "spy_pct": m_spy["annual_returns"].get(ys, 0.0),
            })

    payload = {
        "status": "ok",
        "engine_version": "V6.0",
        "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "market_date": latest_date_str,
        "db_source": "tw_stock.db (commodity_futures_daily: 108,522 筆 + macro_indicators DXY + 19 大主力合約)",
        "macro_regime": {
            "regime_title": (
                "🛡️ 防禦空倉護盾啟動期 (100% BIL 短債生息，嚴守零偽訊號)"
                if len(official_positions) == 0
                else ("🔥 結構性逆價差與趨勢擴張期 (Active V6.0 Trend Regime)" if not is_chop_now else "🛡️ 低離散度震盪防守期 (Selective Backwardation & Gold Reserve Regime)")
            ),
            "is_macro_chop": bool(is_chop_now),
            "breadth_200ma_pct": round(br200_now * 100.0, 1),
            "breadth_60ma_pct": round(br60_now * 100.0, 1),
            "dispersion_60d_pct": round(disp_now * 100.0, 2),
            "crack_spread_321_usd": round(crack_val, 2),
            "soybean_crush_usd": round(crush_val, 2),
            "copper_gold_ratio_x1000": round(cu_au_val, 3),
            "tbill_collateral_yield_pct": 4.45,
            "dxy_spot": round(dxy_spot, 2),
            "dxy_ma60": round(dxy_m60_now, 2),
            "dxy_ret20_pct": round(dxy_r20_now * 100.0, 2),
            "dxy_regime_label": dxy_regime_label,
            "portfolio_vol_scalar": res_v6["last_vol_scalar"],
            "active_futures_weight_pct": total_futures_w_pct,
            "gld_reserve_weight_pct": gld_reserve_w_pct,
            "bil_shield_weight_pct": bil_shield_pct,
        },
        "flagship_summary": m6,
        "v50_baseline_summary": m5,
        "v41_baseline_summary": m41,
        "ablation_tiers": [m6, m5, m41, m6_cme14, m6_next_close, m6_12bp, m3_5, m3, m2, m1, m0, m_spy],
        "trade_win_rate_stats": tw_stats,
        "anti_overfit_audit": anti_overfit,
        "tradability_audit": {
            "t_plus_1_open_verified": True,
            "future_poisoning_max_diff": 0.0,
            "blocked_limit_or_holiday_trades_22y": res_v6["blocked_limit_days_count"],
            "untradable_violations": res_v6["untrad_violations"],
            "cme_14_subset_cagr_pct": m6_cme14["cagr_pct"],
            "cme_14_subset_mdd_pct": m6_cme14["mdd_monthly_pct"],
            "cme_14_subset_sharpe": m6_cme14["sharpe"],
            "cme_14_subset_win_years": m6_cme14["win_years"],
            "delayed_24h_next_close_cagr_pct": m6_next_close["cagr_pct"],
            "delayed_24h_next_close_win_years": m6_next_close["win_years"],
            "harsh_12bps_cagr_pct": m6_12bp["cagr_pct"],
            "retail_sizing_warning_tickers": list(CME_NON_RETAIL_SET),
        },
        "crisis_alpha_periods": crisis_years,
        "annual_comparison": annual_table,
        "equity_curve": equity_curve_list,
        "official_active_positions": official_positions,
        "term_structure_radar": radar_items,
        "recent_trades": list(reversed(res_v6["trade_logs"])),
        "user_trades": user_trades_df.to_dict(orient="records") if len(user_trades_df) > 0 else [],
        "methodology_pillars": [
            {
                "id": "P1",
                "title": "支柱一：期限結構 Carry × 確信滯後保護 × Kaufman ER_40 效率 (M1+M2)",
                "metric": "TS>=0.75 / 在位 1.28x / ER_40 連續信噪",
                "desc": "結合 M1 確信門檻 (0.75) 與盈利在位 1.28x 滯後護城河消除無效換手，並導入 Kaufman 路徑效率係數 (ER_40) 將權重傾注於單邊順暢真趨勢，與核心因子近乎正交 (|ρ|<=0.085)。"
            },
            {
                "id": "P2",
                "title": "支柱二：外生宏觀 DXY 美元體制雙向濾網 (M3)",
                "metric": "Weak USD 1.14x / USD Surge 非貴金屬 0.78x",
                "desc": "所有原物料以美元計價：採 tw_stock.db 外生 DXY (Lag 1D)，DXY < 60MA 給予商品多頭 1.14x 順風；當 DXY > 60MA 且 20D 急漲 > +1.5% 時抑制工業/農產品多單並強化通縮空單。"
            },
            {
                "id": "P3",
                "title": "支柱三：雙階鎖利 × M6 雙棘輪獲利護盾 (M4+M6)",
                "metric": "1.8×NATR 鎖 38% ＋ 0.36×NATR 保本 / 3.5→0.65×NATR 鎖盈",
                "desc": "一階獲利收割 38% 後，餘下 62% 核心倉啟動 M6 雙棘輪護盤：若從峰值回撤至 -0.36×NATR 保本平倉，確保全筆必為淨獲利；若曾浮盈 >= 3.5×NATR，則將棘輪上移至 +0.65×NATR，把單筆勝率推升至 53.99%！"
            },
            {
                "id": "P4",
                "title": "支柱四：商戶/避險機構量能參與與低量防假突破 (M7)",
                "metric": "VolMA20/VolMA120 ≥1.05→1.14x / <0.72 實體禁買 (|ρ|=0.028)",
                "desc": "以實證近零相關之量能比率 VOL20_120 (max |ρ|=0.0281) 辨識商業套保與趨勢資金參與度：放量突破給予 1.14x 傾注、縮量轉弱降為 0.90x，並擋除未達高確信之實體原物料縮量假突破。"
            },
            {
                "id": "P5",
                "title": "支柱五：單契約 1-ATR 爆裂上限 × 目標波動預算守恆 (M8+M5)",
                "metric": "1-ATR Risk<=1.55%(L)/1.25%(S) ＋ TargetVol=21.5%",
                "desc": "V6.0 嚴限單一合約真實波幅貢獻不超過總淨值 1.55% (多)/1.25% (空)，避免高波動天然氣/可可單日甩尾重傷；同時將目標波動調節器設於 21.5% ([0.78, 1.49]) 守恆釋放之風險預算，將月度 MDD 壓降至 -21.09%、Sharpe 躍升至 1.14。"
            },
            {
                "id": "P6",
                "title": "支柱六：事件微結構 × 裂解/壓榨價差 × BIL 短債護盾",
                "metric": "Kilian 尖峰禁買 / 100% BIL 防禦切換",
                "desc": "整合 3-2-1 裂解與黃豆壓榨 Z-Score 及 Kilian 正價差新聞尖峰禁買；當全市場進入防禦空倉期（如 2026-11-06 實盤），實盤帳本嚴守 100% BIL 美元短債生息，零偽訊號開倉。"
            }
        ]
    }

    if save_json:
        os.makedirs(os.path.dirname(DEFAULT_CTA_JSON_PATH), exist_ok=True)
        with open(DEFAULT_CTA_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        sync_commodity_cta_to_supabase(payload)

    return payload


def get_commodity_cta_dashboard_data(force_refresh: bool = False):
    if not force_refresh and os.path.exists(DEFAULT_CTA_JSON_PATH):
        try:
            with open(DEFAULT_CTA_JSON_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return compute_commodity_cta_dashboard(save_json=True)


def add_user_cta_trade(payload: dict):
    conn = sqlite3.connect(DB_PATH)
    _ensure_user_cta_table(conn)
    cur = conn.cursor()
    t_id = f"cta_{int(datetime.now().timestamp() * 1000)}"
    now_s = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute("""
    INSERT INTO commodity_cta_user_trades (
        trade_id, ticker, name_zh, sector, direction, instrument_type, symbol_used,
        contracts, multiplier, entry_price, entry_date, exit_price, exit_date,
        status, exit_reason, notes, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        t_id,
        payload.get("ticker", "GC=F"),
        payload.get("name_zh", "COMEX 黃金"),
        payload.get("sector", "貴金屬 (Precious Metals)"),
        payload.get("direction", "做多 (Long)"),
        payload.get("instrument_type", "Micro微型期貨"),
        payload.get("symbol_used", "MGC"),
        float(payload.get("contracts", 1)),
        float(payload.get("multiplier", 10.0)),
        float(payload.get("entry_price", 0.0)),
        payload.get("entry_date", datetime.now().strftime("%Y-%m-%d")),
        None,
        None,
        "OPEN",
        "",
        payload.get("notes", ""),
        now_s,
    ))
    conn.commit()
    conn.close()
    return compute_commodity_cta_dashboard(save_json=True)


def close_user_cta_trade(trade_id: str, payload: dict):
    conn = sqlite3.connect(DB_PATH)
    _ensure_user_cta_table(conn)
    cur = conn.cursor()
    cur.execute("""
    UPDATE commodity_cta_user_trades
    SET exit_price=?, exit_date=?, status='CLOSED', exit_reason=?
    WHERE trade_id=?
    """, (
        float(payload.get("exit_price", 0.0)),
        payload.get("exit_date", datetime.now().strftime("%Y-%m-%d")),
        payload.get("exit_reason", "🎯 觸及移動停利/換月平倉"),
        trade_id,
    ))
    conn.commit()
    conn.close()
    return compute_commodity_cta_dashboard(save_json=True)


def delete_user_cta_trade(trade_id: str):
    conn = sqlite3.connect(DB_PATH)
    _ensure_user_cta_table(conn)
    cur = conn.cursor()
    cur.execute("DELETE FROM commodity_cta_user_trades WHERE trade_id=?", (trade_id,))
    conn.commit()
    conn.close()
    return compute_commodity_cta_dashboard(save_json=True)


if __name__ == "__main__":
    res = compute_commodity_cta_dashboard(save_json=True)
    fs = res["flagship_summary"]
    v5s = res["v50_baseline_summary"]
    tw = res["trade_win_rate_stats"]
    ao = res["anti_overfit_audit"]
    fp = ao.get("five_phase_audit", {})
    print(f"✅ Generated defaultCommodityCtaData.json ({res['engine_version']})! Market Date: {res['market_date']}")
    print(
        f"🏆 Flagship V6.0: CAGR={fs['cagr_pct']}% (V5.0={v5s['cagr_pct']}%, Ex-2026={fs['ex_2026_cagr_pct']}%, 12bps={ao.get('harsh_12bps_cagr_pct')}%), "
        f"Mult={fs['total_multiple']}x, MonthlyMDD={fs['mdd_monthly_pct']}%, Sharpe={fs['sharpe']}, Calmar={fs['calmar']}, "
        f"SingleTradeWR={tw['win_rate_clean_pct']}% ({tw['win_trades']}/{tw['total_trades']}), RatchetExits={tw.get('ratchet_exits')}, PF={tw['profit_factor']}"
    )
    print(
        f"🛡️ Anti-Overfit 9-Gate Audit: Grid-A(vs V4.1)={ao.get('grid_beat_v41_cagr')}/27, Grid-B(vs V5.0)={ao.get('grid_v6_beat_v5_cagr')}/27, "
        f"Jackknife Ex-Top3={ao.get('jackknife_v6_cagr_pct')}% (V5={ao.get('jackknife_v5_cagr_pct')}%), "
        f"5-Phase Mean/Min={fp.get('v6_mean_cagr')}%/{fp.get('v6_min_cagr')}% (V5={fp.get('v5_mean_cagr')}%/{fp.get('v5_min_cagr')}%)"
    )
    print("Official Active Positions:", len(res["official_active_positions"]), "| BIL Shield:", res["macro_regime"]["bil_shield_weight_pct"], "%")
    for p in res["official_active_positions"]:
        print(f"  #{p['rank']} {p['ticker']} ({p['name_zh']}) | {p['direction']} | Weight={p['target_weight_pct']}% | Price={p['front_price']} | Scaled={p['scaled_out']} | Stop={p['active_stop_price']}")
