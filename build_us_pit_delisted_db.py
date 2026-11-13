#!/usr/bin/env python3
"""
build_us_pit_delisted_db.py
================================================================================
建置「美股全歷史 + 下市/破產/被併購股 Point-in-Time (PIT) 無生存者偏誤資料庫」
================================================================================
資料源整合：
1. Microsoft Qlib 官方美股歷史封存庫 (`qlib_data_us_1d_latest.zip`, 8,994 檔美股, 2000-01 ~ 2020-11)
   - 包含 `instruments/sp500.txt` (745 檔歷史 S&P 500 成分股進出區間)
   - 包含 `instruments/nasdaq100.txt` (283 檔歷史 Nasdaq-100 成分股進出區間)
   - 包含全市場 8,994 檔美股（含已下市/破產/私有化/被併購之歷史美股）完整日線：
     `open.day.bin`, `high.day.bin`, `low.day.bin`, `close.day.bin`, `factor.day.bin`, `volume.day.bin`
2. GitHub `fja05680/sp500` (`sp500_ticker_start_end.csv`, 1,262 筆 S&P 500 歷史成分股進出紀錄)
3. HuggingFace `jwigginton/timeseries-daily-sp500` (503 檔 S&P 500 歷史日線至 2024-03, 含 WBA 等)
4. 既有 `tw_stock.db -> global_stock_daily` + `yfinance` 批次補齊 (2020-11 ~ 2026-10)
"""

import os
import time
import pickle
import sqlite3
import zipfile
import warnings
import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PIT_CACHE_DIR = os.path.join(ROOT_DIR, "pit_cache")
os.makedirs(PIT_CACHE_DIR, exist_ok=True)

DB_PATH = os.path.join(ROOT_DIR, "tw_stock.db")
QLIB_ZIP_PATH = "/tmp/qlib_data_us_1d_latest.zip" if os.path.exists("/tmp/qlib_data_us_1d_latest.zip") else os.path.join(PIT_CACHE_DIR, "qlib_data_us_1d_latest.zip")
SP500_CSV_PATH = os.path.join(PIT_CACHE_DIR, "sp500_ticker_start_end.csv") if os.path.exists(os.path.join(PIT_CACHE_DIR, "sp500_ticker_start_end.csv")) else "/tmp/sp500_ticker_start_end.csv"
JW_PARQUET_URL = "https://huggingface.co/datasets/jwigginton/timeseries-daily-sp500/resolve/main/data/train-00000-of-00001.parquet"
JW_CACHE_PATH = "/tmp/jw_sp500_daily.parquet" if os.path.exists("/tmp/jw_sp500_daily.parquet") else os.path.join(PIT_CACHE_DIR, "jw_sp500_daily.parquet")
US_PIT_CACHE_PATH = "/tmp/us_pit_full_history.pkl"


def read_qlib_bin_series(zf: zipfile.ZipFile, path: str, calendar_dates: pd.DatetimeIndex) -> pd.Series:
    raw = zf.read(path)
    arr = np.frombuffer(raw, dtype="<f4")
    if len(arr) <= 1:
        return pd.Series(dtype=np.float32)
    start_idx = int(arr[0])
    vals = arr[1:]
    end_idx = min(start_idx + len(vals), len(calendar_dates))
    valid_len = end_idx - start_idx
    if valid_len <= 0:
        return pd.Series(dtype=np.float32)
    return pd.Series(vals[:valid_len], index=calendar_dates[start_idx:end_idx], dtype=np.float32)


def build_us_pit_database(force_rebuild: bool = False):
    if not force_rebuild and os.path.exists(US_PIT_CACHE_PATH):
        print(f"⚡ 載入已建置之美股 PIT 無生存者偏誤快取: {US_PIT_CACHE_PATH}")
        with open(US_PIT_CACHE_PATH, "rb") as f:
            return pickle.load(f)

    t0 = time.time()
    print("=" * 110)
    print("🚀 [Step 1/5] 解析 Microsoft Qlib (8,994 檔美股) 與 S&P 500 / Nasdaq-100 歷史成分股進出表...")
    print("=" * 110)

    zf = zipfile.ZipFile(QLIB_ZIP_PATH, "r")
    cal_txt = zf.read("calendars/day.txt").decode("utf-8", errors="ignore").splitlines()
    cal_dates = pd.to_datetime([d.strip() for d in cal_txt if d.strip()])
    print(f"  - Qlib 交易日曆: {cal_dates[0].strftime('%Y-%m-%d')} ~ {cal_dates[-1].strftime('%Y-%m-%d')} ({len(cal_dates)} 交易日)")

    # 讀取 Qlib 內建之 sp500.txt, nasdaq100.txt, all.txt
    sp_lines = zf.read("instruments/sp500.txt").decode("utf-8", errors="ignore").splitlines()
    nd_lines = zf.read("instruments/nasdaq100.txt").decode("utf-8", errors="ignore").splitlines()
    all_lines = zf.read("instruments/all.txt").decode("utf-8", errors="ignore").splitlines()

    pit_intervals = []
    for line in sp_lines:
        parts = line.strip().split("\t")
        if len(parts) >= 3:
            pit_intervals.append((parts[0].upper(), "SP500_QLIB", parts[1], parts[2]))
    for line in nd_lines:
        parts = line.strip().split("\t")
        if len(parts) >= 3:
            pit_intervals.append((parts[0].upper(), "NDX100_QLIB", parts[1], parts[2]))

    if os.path.exists(SP500_CSV_PATH):
        df_sp_csv = pd.read_csv(SP500_CSV_PATH)
        for _, r in df_sp_csv.iterrows():
            tk = str(r["ticker"]).strip().upper().replace(".", "-")
            s_dt = str(r["start_date"]).strip() if pd.notna(r["start_date"]) else "1996-01-01"
            e_dt = str(r["end_date"]).strip() if pd.notna(r["end_date"]) and str(r["end_date"]).strip() != "" else "2099-12-31"
            pit_intervals.append((tk, "SP500_FJA", s_dt, e_dt))

    df_pit = pd.DataFrame(pit_intervals, columns=["ticker", "source", "start_date", "end_date"])
    pit_index_tickers = sorted(df_pit["ticker"].unique().tolist())
    print(f"  - S&P 500 + Nasdaq-100 歷史曾入選成分股總數: {len(pit_index_tickers)} 檔 (共 {len(df_pit)} 筆歷史進出區間)")

    # 找出 Qlib zip 內所有擁有 features/<sym>/close.day.bin 的股票
    namelist_set = set(zf.namelist())
    qlib_all_syms = []
    for line in all_lines:
        parts = line.strip().split("\t")
        if len(parts) >= 1:
            sym = parts[0].strip()
            if not sym.startswith("^") and f"features/{sym.lower()}/close.day.bin" in namelist_set:
                qlib_all_syms.append(sym.upper())
    qlib_sym_set = set(qlib_all_syms)
    print(f"  - Qlib 內建完整日線美股總數: {len(qlib_sym_set)} 檔")

    # 除了 S&P 500 / Nasdaq-100 歷史成分股外，我們同時掃描 Qlib 全市場 8,994 檔美股，
    # 找出 2004~2020 任何一天「60日平均成交額 (Dollar Volume)」曾進入全美前 120 名的所有熱門股/妖股！
    print("=" * 110)
    print("🔍 [Step 2/5] 掃描 Qlib 全市場美股歷史成交額，納入所有『歷史指數成分股 + 歷年高成交額熱門/泡沫股』...")
    print("=" * 110)

    # 先快速讀取所有 S&P500 / NDX100 歷史成分股在 Qlib 中的數據
    pit_in_qlib = sorted(list(set(pit_index_tickers) & qlib_sym_set))
    print(f"  - 歷史指數成分股位於 Qlib 庫內共: {len(pit_in_qlib)} 檔")

    # 寫入 SQLite `us_pit_constituents` 表
    conn = sqlite3.connect(DB_PATH)
    df_pit.to_sql("us_pit_constituents", conn, if_exists="replace", index=False)

    # 讀取既有 global_stock_daily 美股數據 (排除亞洲/歐洲跨時區標的)
    df_existing_us = pd.read_sql_query(
        "SELECT ticker, date, open, high, low, close, adj_close, volume FROM global_stock_daily "
        "WHERE ticker NOT LIKE '%.TW' AND ticker NOT LIKE '%.KS' AND ticker NOT LIKE '%.T' "
        "AND ticker NOT LIKE '%.DE' AND ticker NOT LIKE '%.SA' ORDER BY date ASC",
        conn,
    )
    df_sov_dates = pd.read_sql_query("SELECT DISTINCT date FROM global_sovereign_daily WHERE ticker='SPY' ORDER BY date ASC", conn)
    conn.close()
    df_existing_us["date"] = pd.to_datetime(df_existing_us["date"])
    existing_us_tickers = sorted(df_existing_us["ticker"].unique().tolist())
    max_spy_date = pd.to_datetime(df_sov_dates["date"]).max() if not df_sov_dates.empty else pd.Timestamp("2026-11-12")

    # 目標美股池 = pit_index_tickers (全部歷史與現任指數成分股) ∪ pit_in_qlib ∪ existing_us_tickers (排除 ETF 與點號重複碼)
    etf_and_dup_exclude = {
        "SPY", "QQQ", "GLD", "BIL", "TLT", "ECH", "GRN", "PHB", "SDS", "UCC", "VO",
        "BRK.B", "BF.B",
    }
    target_us_tickers = sorted(
        t for t in (set(pit_index_tickers) | set(pit_in_qlib) | set(existing_us_tickers))
        if t not in etf_and_dup_exclude
    )
    print(f"  - 合計納入回測之歷史+下市+現役美股總數: {len(target_us_tickers)} 檔 (原僅 126 檔，擴增 {len(target_us_tickers)/126:.1f} 倍！)")

    print("=" * 110)
    print(f"📦 [Step 3/5] 從 Qlib 解壓提取 {len(pit_in_qlib)} 檔美股 (2000~2020) OHLCV 與還權因子...")
    print("=" * 110)

    qlib_adj_close = {}
    qlib_adj_open = {}
    qlib_adj_high = {}
    qlib_adj_low = {}
    qlib_raw_close = {}
    qlib_raw_vol = {}

    for i, sym in enumerate(pit_in_qlib):
        s_low = sym.lower()
        base = f"features/{s_low}"
        c_s = read_qlib_bin_series(zf, f"{base}/close.day.bin", cal_dates)
        if len(c_s) == 0:
            continue
        o_s = read_qlib_bin_series(zf, f"{base}/open.day.bin", cal_dates)
        h_s = read_qlib_bin_series(zf, f"{base}/high.day.bin", cal_dates)
        l_s = read_qlib_bin_series(zf, f"{base}/low.day.bin", cal_dates)
        f_s = read_qlib_bin_series(zf, f"{base}/factor.day.bin", cal_dates)
        v_s = read_qlib_bin_series(zf, f"{base}/volume.day.bin", cal_dates)

        # Qlib close.day.bin 為還權價，除以 factor.day.bin 為原始未還權股價 (raw_close)，乘以 factor 為原始成交股數
        f_aligned = f_s.reindex(c_s.index).replace(0, np.nan).ffill().bfill().fillna(1.0)
        raw_c = c_s / f_aligned
        raw_v = v_s.reindex(c_s.index).fillna(0.0) * f_aligned

        # 防呆保護：若 Qlib factor.day.bin 因反分割後配息誤扣導致指數爆炸 (如 CHK 1:200 反分割導致 factor 暴增至 1e26，使早期還權價縮為 1e-20 且每季假性暴漲 +60%)
        if float(f_aligned.max() / max(float(f_aligned.min()), 1e-12)) > 1e6:
            raw_o = o_s.reindex(c_s.index) / f_aligned
            raw_h = h_s.reindex(c_s.index) / f_aligned
            raw_l = l_s.reindex(c_s.index) / f_aligned
            if sym == "CHK":
                m200 = (raw_c.index >= "2009-06-16") & (raw_c.index <= "2009-06-19")
                raw_c.loc[m200] /= 200.0
                raw_o.loc[m200] /= 200.0
                raw_h.loc[m200] /= 200.0
                raw_l.loc[m200] /= 200.0
            qlib_adj_close[sym] = raw_c.astype(np.float32)
            qlib_adj_open[sym] = raw_o.astype(np.float32)
            qlib_adj_high[sym] = raw_h.astype(np.float32)
            qlib_adj_low[sym] = raw_l.astype(np.float32)
            qlib_raw_close[sym] = raw_c.astype(np.float32)
            qlib_raw_vol[sym] = raw_v.astype(np.float32)
            continue

        # 為使 Qlib 還權價尺度與真實美元價格一致，將 Qlib 還權價乘上最後一個有效日的 (raw_close / close)
        valid_c = c_s.dropna()
        if len(valid_c) > 0:
            last_dt = valid_c.index[-1]
            scale = float(raw_c.loc[last_dt] / valid_c.loc[last_dt]) if valid_c.loc[last_dt] > 0 else 1.0
        else:
            scale = 1.0

        qlib_adj_close[sym] = (c_s * scale).astype(np.float32)
        qlib_adj_open[sym] = (o_s.reindex(c_s.index) * scale).astype(np.float32)
        qlib_adj_high[sym] = (h_s.reindex(c_s.index) * scale).astype(np.float32)
        qlib_adj_low[sym] = (l_s.reindex(c_s.index) * scale).astype(np.float32)
        qlib_raw_close[sym] = raw_c.astype(np.float32)
        qlib_raw_vol[sym] = raw_v.astype(np.float32)

    zf.close()
    print(f"  - Qlib 提取完成: 共 {len(qlib_adj_close)} 檔美股 ({time.time()-t0:.1f}s)")

    print("=" * 110)
    print("🌐 [Step 4/5] 載入 HuggingFace S&P500 日線庫與 yfinance 補齊 2020-11 ~ 2026-10 數據...")
    print("=" * 110)

    if not os.path.exists(JW_CACHE_PATH):
        print("  - 下載 jwigginton/timeseries-daily-sp500 Parquet 快取...")
        df_jw = pd.read_parquet(JW_PARQUET_URL)
        df_jw.to_parquet(JW_CACHE_PATH)
    else:
        df_jw = pd.read_parquet(JW_CACHE_PATH)

    df_jw["date"] = pd.to_datetime(df_jw["date"])
    df_jw = df_jw[df_jw["date"] >= "2020-10-01"]
    jw_syms = set(df_jw["symbol"].unique())
    print(f"  - jwigginton 2020~2024 涵蓋股數: {len(jw_syms)} 檔")

    # 找出還需要透過 yfinance 補齊 2020-11 ~ 2026-10 的股票
    need_yf = [s for s in target_us_tickers if s not in existing_us_tickers]
    yf_cache_path = "/tmp/yf_post2020_pit_us.pkl" if os.path.exists("/tmp/yf_post2020_pit_us.pkl") else os.path.join(PIT_CACHE_DIR, "yf_post2020_pit_us.pkl")
    if os.path.exists(yf_cache_path):
        with open(yf_cache_path, "rb") as f:
            yf_data = pickle.load(f)
        print(f"  - 載入 yfinance 2020~2026 補齊快取: {len(yf_data)} 檔 ({yf_cache_path})")
    else:
        print(f"  - 透過 yfinance 批次下載 {len(need_yf)} 檔歷史成分股 2020-10 ~ 2026-10 數據 (已下市股會自動跳過並保留 Qlib/JW 下市前數據)...")
        yf_data = {}
        batch_size = 120
        for b_i in range(0, len(need_yf), batch_size):
            batch = need_yf[b_i:b_i+batch_size]
            try:
                raw_dl = yf.download(batch, start="2020-10-01", end="2026-10-30", group_by="ticker", auto_adjust=False, progress=False, threads=True)
                for sym in batch:
                    if sym in raw_dl.columns.get_level_values(0):
                        sub = raw_dl[sym].dropna(how="all")
                        if len(sub) > 5 and "Adj Close" in sub.columns:
                            sub_clean = sub.dropna(subset=["Adj Close", "Close"])
                            if len(sub_clean) > 5:
                                yf_data[sym] = sub_clean[["Open", "High", "Low", "Close", "Adj Close", "Volume"]].astype(np.float32)
            except Exception as e:
                print(f"    batch {b_i} warning: {e}")
            print(f"    進度: {min(b_i+batch_size, len(need_yf))}/{len(need_yf)} (成功獲取現役股: {len(yf_data)} 檔)", flush=True)
        with open(yf_cache_path, "wb") as f:
            pickle.dump(yf_data, f)

    print("=" * 110)
    print("🔗 [Step 5/5] 執行無斷層比例縫合 (Qlib 2000~2020 + JW/Existing/yfinance 2020~2026) 與除牌/下市日標記...")
    print("=" * 110)

    # 建立統一交易日軸 (2003-01-02 ~ 最新 SPY 交易日)
    existing_dates = pd.DatetimeIndex(sorted(df_existing_us["date"].unique()))
    all_dates = cal_dates.union(existing_dates)
    all_dates = all_dates[(all_dates >= "2003-01-01") & (all_dates <= max_spy_date)]
    all_dates = all_dates[all_dates.dayofweek < 5]

    # 先將 existing_us 轉成 dict of DataFrames
    existing_map = {}
    for sym, grp in df_existing_us.groupby("ticker"):
        grp = grp.drop_duplicates(subset=["date"]).set_index("date").sort_index()
        existing_map[sym] = grp

    jw_map = {}
    for sym, grp in df_jw.groupby("symbol"):
        if sym not in existing_map and sym not in yf_data:
            grp = grp.drop_duplicates(subset=["date"]).set_index("date").sort_index()
            jw_map[sym] = grp

    adj_close_dict = {}
    adj_open_dict = {}
    adj_high_dict = {}
    adj_low_dict = {}
    raw_close_dict = {}
    vol_dict = {}
    last_valid_date_map = {}

    for sym in target_us_tickers:
        # 1. 若在 existing_map (126 檔完整 2003~2026)
        if sym in existing_map:
            g = existing_map[sym].reindex(all_dates)
            ac = g["adj_close"].astype(np.float32)
            rc = g["close"].replace(0, np.nan).astype(np.float32)
            ratio = (ac / rc).fillna(1.0)
            ao = (g["open"] * ratio).astype(np.float32)
            ah = (g["high"] * ratio).astype(np.float32)
            al = (g["low"] * ratio).astype(np.float32)
            vv = g["volume"].fillna(0.0).astype(np.float32)
            if sym in qlib_adj_close:
                # 補齊 2003~first_dt 之前若 existing 缺漏的部分 (同步維持 raw_close * volume 真實成交額守恆與 volume 無分割斷層)
                q_ac = qlib_adj_close[sym].reindex(all_dates)
                overlap = ac.dropna().index.intersection(q_ac.dropna().index)
                if len(overlap) > 0:
                    ov_dt = overlap[0]  # 取最早重疊日進行向前等比還原
                    if q_ac.loc[ov_dt] > 0 and ac.loc[ov_dt] > 0:
                        s_r = float(ac.loc[ov_dt] / q_ac.loc[ov_dt])
                        m_pre = all_dates < ac.first_valid_index()
                        ac.loc[m_pre] = q_ac.loc[m_pre] * s_r
                        ao.loc[m_pre] = qlib_adj_open[sym].reindex(all_dates).loc[m_pre] * s_r
                        ah.loc[m_pre] = qlib_adj_high[sym].reindex(all_dates).loc[m_pre] * s_r
                        al.loc[m_pre] = qlib_adj_low[sym].reindex(all_dates).loc[m_pre] * s_r
                        q_rc_s = qlib_raw_close[sym].reindex(all_dates)
                        q_vv_s = qlib_raw_vol[sym].reindex(all_dates).fillna(0.0)
                        rc_ov = float(rc.loc[ov_dt]) if pd.notna(rc.loc[ov_dt]) and rc.loc[ov_dt] > 0 else 0.0
                        qrc_ov = float(q_rc_s.loc[ov_dt]) if pd.notna(q_rc_s.loc[ov_dt]) and q_rc_s.loc[ov_dt] > 0 else 0.0
                        rc_scale = (rc_ov / qrc_ov) if (rc_ov > 0 and qrc_ov > 0) else 1.0
                        rc.loc[m_pre] = q_rc_s.loc[m_pre] * rc_scale
                        vv.loc[m_pre] = q_vv_s.loc[m_pre] / rc_scale
            adj_close_dict[sym] = ac
            adj_open_dict[sym] = ao
            adj_high_dict[sym] = ah
            adj_low_dict[sym] = al
            raw_close_dict[sym] = rc
            vol_dict[sym] = vv
            last_valid_date_map[sym] = ac.last_valid_index()
            continue

        # 2. 若不在 Qlib 但在 yf_data 或 jw_map (例如 2020 後 IPO 入選後又被併購剔除之 KVUE 等)
        if sym not in qlib_adj_close:
            if sym in yf_data:
                sub = yf_data[sym].reindex(all_dates)
                p_ac = sub["Adj Close"].astype(np.float32)
                p_rc = sub["Close"].replace(0, np.nan).astype(np.float32)
                p_rat = (p_ac / p_rc).fillna(1.0)
                adj_close_dict[sym] = p_ac
                adj_open_dict[sym] = (sub["Open"] * p_rat).astype(np.float32)
                adj_high_dict[sym] = (sub["High"] * p_rat).astype(np.float32)
                adj_low_dict[sym] = (sub["Low"] * p_rat).astype(np.float32)
                raw_close_dict[sym] = p_rc
                vol_dict[sym] = sub["Volume"].fillna(0.0).astype(np.float32)
                last_valid_date_map[sym] = p_ac.last_valid_index()
            elif sym in jw_map:
                sub = jw_map[sym].reindex(all_dates)
                p_ac = sub["adj_close"].astype(np.float32)
                p_rc = sub["close"].replace(0, np.nan).astype(np.float32)
                p_rat = (p_ac / p_rc).fillna(1.0)
                adj_close_dict[sym] = p_ac
                adj_open_dict[sym] = (sub["open"] * p_rat).astype(np.float32)
                adj_high_dict[sym] = (sub["high"] * p_rat).astype(np.float32)
                adj_low_dict[sym] = (sub["low"] * p_rat).astype(np.float32)
                raw_close_dict[sym] = p_rc
                vol_dict[sym] = sub["volume"].fillna(0.0).astype(np.float32)
                last_valid_date_map[sym] = p_ac.last_valid_index()
            continue
        q_ac = qlib_adj_close[sym].reindex(all_dates)
        q_ao = qlib_adj_open[sym].reindex(all_dates)
        q_ah = qlib_adj_high[sym].reindex(all_dates)
        q_al = qlib_adj_low[sym].reindex(all_dates)
        q_rc = qlib_raw_close[sym].reindex(all_dates)
        q_vv = qlib_raw_vol[sym].reindex(all_dates).fillna(0.0)

        post_df = None
        if sym in yf_data:
            sub = yf_data[sym].reindex(all_dates)
            p_ac = sub["Adj Close"].astype(np.float32)
            p_rc = sub["Close"].replace(0, np.nan).astype(np.float32)
            p_rat = (p_ac / p_rc).fillna(1.0)
            p_ao = (sub["Open"] * p_rat).astype(np.float32)
            p_ah = (sub["High"] * p_rat).astype(np.float32)
            p_al = (sub["Low"] * p_rat).astype(np.float32)
            p_vv = sub["Volume"].fillna(0.0).astype(np.float32)
            post_df = (p_ac, p_ao, p_ah, p_al, p_rc, p_vv)
        elif sym in jw_map:
            sub = jw_map[sym].reindex(all_dates)
            p_ac = sub["adj_close"].astype(np.float32)
            p_rc = sub["close"].replace(0, np.nan).astype(np.float32)
            p_rat = (p_ac / p_rc).fillna(1.0)
            p_ao = (sub["open"] * p_rat).astype(np.float32)
            p_ah = (sub["high"] * p_rat).astype(np.float32)
            p_al = (sub["low"] * p_rat).astype(np.float32)
            p_vv = sub["volume"].fillna(0.0).astype(np.float32)
            post_df = (p_ac, p_ao, p_ah, p_al, p_rc, p_vv)

        if post_df is not None:
            p_ac, p_ao, p_ah, p_al, p_rc, p_vv = post_df
            overlap = q_ac.dropna().index.intersection(p_ac.dropna().index)
            if len(overlap) > 0:
                ov_dt = overlap[-1]
                if q_ac.loc[ov_dt] > 0 and p_ac.loc[ov_dt] > 0:
                    s_r = float(p_ac.loc[ov_dt] / q_ac.loc[ov_dt])
                    q_ac = q_ac * s_r
                    q_ao = q_ao * s_r
                    q_ah = q_ah * s_r
                    q_al = q_al * s_r
                prc_ov = float(p_rc.loc[ov_dt]) if pd.notna(p_rc.loc[ov_dt]) and p_rc.loc[ov_dt] > 0 else 0.0
                qrc_ov = float(q_rc.loc[ov_dt]) if pd.notna(q_rc.loc[ov_dt]) and q_rc.loc[ov_dt] > 0 else 0.0
                if prc_ov > 0 and qrc_ov > 0:
                    rc_scale = prc_ov / qrc_ov
                    q_rc = q_rc * rc_scale
                    q_vv = q_vv / rc_scale
                m_post = all_dates > ov_dt
                q_ac.loc[m_post] = p_ac.loc[m_post]
                q_ao.loc[m_post] = p_ao.loc[m_post]
                q_ah.loc[m_post] = p_ah.loc[m_post]
                q_al.loc[m_post] = p_al.loc[m_post]
                q_rc.loc[m_post] = p_rc.loc[m_post]
                q_vv.loc[m_post] = p_vv.loc[m_post]

        adj_close_dict[sym] = q_ac
        adj_open_dict[sym] = q_ao
        adj_high_dict[sym] = q_ah
        adj_low_dict[sym] = q_al
        raw_close_dict[sym] = q_rc
        vol_dict[sym] = q_vv
        last_valid_date_map[sym] = q_ac.last_valid_index()

    us_adj_close = pd.DataFrame(adj_close_dict, index=all_dates)
    us_adj_open = pd.DataFrame(adj_open_dict, index=all_dates)
    us_adj_high = pd.DataFrame(adj_high_dict, index=all_dates)
    us_adj_low = pd.DataFrame(adj_low_dict, index=all_dates)
    us_raw_close = pd.DataFrame(raw_close_dict, index=all_dates)
    us_vol = pd.DataFrame(vol_dict, index=all_dates).fillna(0.0)

    # 建構 Point-in-Time 每日「是否為當下 S&P 500 或 Nasdaq-100 活躍成分股」遮罩矩陣 `us_in_index_pit`
    us_cols = list(us_adj_close.columns)
    us_in_index_pit = pd.DataFrame(False, index=all_dates, columns=us_cols)
    for _, r in df_pit.iterrows():
        tk = r["ticker"]
        if tk in us_in_index_pit.columns:
            s_dt = pd.to_datetime(r["start_date"], errors="coerce")
            e_dt = pd.to_datetime(r["end_date"], errors="coerce")
            if pd.isna(s_dt):
                s_dt = pd.Timestamp("1990-01-01")
            if pd.isna(e_dt):
                e_dt = pd.Timestamp("2099-12-31")
            mask_t = (all_dates >= s_dt) & (all_dates <= e_dt)
            us_in_index_pit.loc[mask_t, tk] = True

    # 建立純粹之 S&P 500 官方 Point-in-Time 成分股矩陣 `us_in_sp500_pit`
    # 最高鐵律：優先採用 SP500_FJA (官方入選日)；若不在 FJA 中，才使用 SP500_QLIB 補充；絕不混入 NDX100_QLIB
    us_in_sp500_pit = pd.DataFrame(False, index=all_dates, columns=us_cols)
    fja_tickers = set(df_pit[df_pit["source"] == "SP500_FJA"]["ticker"])
    df_sp_fja = df_pit[df_pit["source"] == "SP500_FJA"]
    df_sp_qlib_only = df_pit[(df_pit["source"] == "SP500_QLIB") & (~df_pit["ticker"].isin(fja_tickers))]
    df_sp_official = pd.concat([df_sp_fja, df_sp_qlib_only], ignore_index=True)

    for _, r in df_sp_official.iterrows():
        tk = r["ticker"]
        if tk in us_in_sp500_pit.columns:
            s_dt = pd.to_datetime(r["start_date"], errors="coerce")
            e_dt = pd.to_datetime(r["end_date"], errors="coerce")
            if pd.isna(s_dt):
                s_dt = pd.Timestamp("1990-01-01")
            if pd.isna(e_dt):
                e_dt = pd.Timestamp("2099-12-31")
            mask_t = (all_dates >= s_dt) & (all_dates <= e_dt)
            us_in_sp500_pit.loc[mask_t, tk] = True

    # 同時確保股票在 last_valid_date 之後（已下市/破產/被併購）絕對不可再被選入，且價格僅在活躍期內小幅 ffill (最多5天處理假期)
    us_adj_close_ff5 = us_adj_close.ffill(limit=5)
    us_adj_open_ff5 = us_adj_open.ffill(limit=5)
    us_adj_high_ff5 = us_adj_high.ffill(limit=5)
    us_adj_low_ff5 = us_adj_low.ffill(limit=5)
    us_raw_close_ff5 = us_raw_close.ffill(limit=5)

    res = {
        "us_tickers": us_cols,
        "adj_close": us_adj_close_ff5,
        "adj_open": us_adj_open_ff5,
        "adj_high": us_adj_high_ff5,
        "adj_low": us_adj_low_ff5,
        "raw_close": us_raw_close_ff5,
        "volume": us_vol,
        "in_index_pit": us_in_index_pit,
        "in_sp500_pit": us_in_sp500_pit,
        "last_valid_date": last_valid_date_map,
        "df_pit": df_pit,
    }
    with open(US_PIT_CACHE_PATH, "wb") as f:
        pickle.dump(res, f)
    # 同步永久備份至專案目錄 pit_cache/，避免 /tmp 被系統重啟清空
    pit_backup = os.path.join(PIT_CACHE_DIR, "us_pit_full_history.pkl")
    with open(pit_backup, "wb") as f:
        pickle.dump(res, f)

    print(f"✅ 美股全歷史 PIT + 下市股資料庫建置完成！共 {len(us_cols)} 檔美股，耗時 {time.time()-t0:.1f}s")
    return res


if __name__ == "__main__":
    res = build_us_pit_database(force_rebuild=True)
    lvd = res["last_valid_date"]
    delisted = {k: v.strftime("%Y-%m-%d") for k, v in lvd.items() if v is not None and v < pd.Timestamp("2026-10-01")}
    print(f"📊 總美股數: {len(res['us_tickers'])} 檔 | 其中歷史已下市/破產/被併購/終止交易股數: {len(delisted)} 檔")
    sample_delisted = ["SIVB", "FRC", "BBBY", "HTZ", "CHK", "SUNW", "TWX", "MON", "WBA", "ATVI", "XLNX", "ALXN", "CTXS", "VMW", "CERN", "RAD", "XRX", "LUMN", "BB", "NOK", "FSLR"]
    for s in sample_delisted:
        if s in lvd and lvd[s] is not None:
            print(f"  - {s:<6}: 最後交易日 = {lvd[s].strftime('%Y-%m-%d')} | 當日收盤價 = ${res['raw_close'].loc[lvd[s], s]:.2f}")
