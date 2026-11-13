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
QLIB_ZIP_PATH = os.path.join(PIT_CACHE_DIR, "qlib_data_us_1d_latest.zip") if os.path.exists(os.path.join(PIT_CACHE_DIR, "qlib_data_us_1d_latest.zip")) else "/tmp/qlib_data_us_1d_latest.zip"
SP500_CSV_PATH = os.path.join(PIT_CACHE_DIR, "sp500_ticker_start_end.csv") if os.path.exists(os.path.join(PIT_CACHE_DIR, "sp500_ticker_start_end.csv")) else "/tmp/sp500_ticker_start_end.csv"
JW_PARQUET_URL = "https://huggingface.co/datasets/jwigginton/timeseries-daily-sp500/resolve/main/data/train-00000-of-00001.parquet"
JW_CACHE_PATH = os.path.join(PIT_CACHE_DIR, "jw_sp500_daily.parquet") if os.path.exists(os.path.join(PIT_CACHE_DIR, "jw_sp500_daily.parquet")) else "/tmp/jw_sp500_daily.parquet"
US_PIT_CACHE_PATH = os.path.join(PIT_CACHE_DIR, "us_pit_full_history.pkl")
US_PIT_TMP_PATH = "/tmp/us_pit_full_history.pkl"

# 經 Yahoo/JW/Qlib 重疊期日報酬相關係數 (corr >= 0.995) 與公司改名紀錄驗證之 S&P 500 代碼更名對映
SP500_VERIFIED_RENAME_PAIRS = [
    ("FB", "META"),
    ("ANTM", "ELV"),
    ("ABC", "COR"),
    ("PKI", "RVTY"),
    ("BLL", "BALL"),
    ("FBHS", "FBIN"),
    ("NLOK", "GEN"),
    ("SYMC", "GEN"),
    ("RE", "EG"),
    ("WLTW", "WTW"),
    ("LB", "BBWI"),
    ("GPS", "GAP"),
    ("HFC", "DINO"),
    ("BK", "BNY"),
    ("MMC", "MRSH"),
    ("FI", "FISV"),
    ("SATS", "ECHO"),
    ("CBS", "SKYD"),
    ("VIAC", "SKYD"),
    ("PARA", "SKYD"),
    ("EQR", "VMRK"),
    ("CTL", "LUMN"),
    ("COG", "CTRA"),
    ("FLT", "CPAY"),
    ("SQ", "XYZ"),
    ("UTX", "RTX"),
    ("HRS", "LHX"),
    ("BBT", "TFC"),
    ("PX", "LIN"),
    ("BHGE", "BKR"),
    ("TMK", "GL"),
    ("KORS", "CPRI"),
    ("MYL", "VTRS"),
]
SP500_OTC_DELIST_STITCH = [("FRC", "FRCB")]


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
    conn_chk = sqlite3.connect(DB_PATH)
    row_spy_dt = conn_chk.execute("SELECT MAX(date) FROM global_sovereign_daily WHERE ticker='SPY'").fetchone()
    conn_chk.close()
    latest_spy_str = str(row_spy_dt[0])[:10] if (row_spy_dt and row_spy_dt[0]) else "2026-11-12"

    if not force_rebuild and os.path.exists(US_PIT_CACHE_PATH):
        with open(US_PIT_CACHE_PATH, "rb") as f:
            cached = pickle.load(f)
        if cached.get("schema_version") == 2 and cached.get("db_max_date", "") >= latest_spy_str:
            print(f"⚡ 載入已建置之美股 PIT 無生存者偏誤快取: {US_PIT_CACHE_PATH}")
            return cached
        print(f"🔄 偵測到 DB 日期更新 ({latest_spy_str}) 或快取版本升級，自動重建美股 PIT 資料庫...")

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

    # 目標美股池 = pit_index_tickers (全部歷史與現任指數成分股) ∪ pit_in_qlib ∪ existing_us_tickers ∪ 改名後繼代碼 (排除 ETF 與點號重複碼)
    etf_and_dup_exclude = {
        "SPY", "QQQ", "GLD", "BIL", "TLT", "ECH", "GRN", "PHB", "SDS", "UCC", "VO",
        "BRK.B", "BF.B", "FRCB",
    }
    rename_successors = {new_t for _, new_t in SP500_VERIFIED_RENAME_PAIRS}
    target_us_tickers = sorted(
        t for t in (set(pit_index_tickers) | set(pit_in_qlib) | set(existing_us_tickers) | rename_successors)
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

    # 找出還需要透過 yfinance 補齊的股票 (包含已自 S&P 500 剔除但仍上市之 2020~2026 股票、官方改名後繼代碼、及 FRCB OTC 接續序列)
    df_sp_fja_pre = df_pit[df_pit["source"] == "SP500_FJA"].copy()
    df_sp_fja_pre["_end_dt"] = pd.to_datetime(df_sp_fja_pre["end_date"], errors="coerce").fillna(pd.Timestamp("2099-12-31"))
    sp_max_end_map = df_sp_fja_pre.groupby("ticker")["_end_dt"].max().to_dict()
    recent_sp_tickers = set(df_sp_fja_pre[df_sp_fja_pre["_end_dt"] >= pd.Timestamp("2020-01-01")]["ticker"].unique())
    successor_tickers = {new_t for _, new_t in SP500_VERIFIED_RENAME_PAIRS} | {otc_t for _, otc_t in SP500_OTC_DELIST_STITCH}

    need_yf = [s for s in target_us_tickers if s not in existing_us_tickers]
    yf_cache_path = os.path.join(PIT_CACHE_DIR, "yf_post2020_pit_us.pkl")
    if not os.path.exists(yf_cache_path) and os.path.exists("/tmp/yf_post2020_pit_us.pkl"):
        yf_cache_path = "/tmp/yf_post2020_pit_us.pkl"
    if os.path.exists(yf_cache_path):
        with open(yf_cache_path, "rb") as f:
            yf_data = pickle.load(f)
        print(f"  - 載入 yfinance 補齊快取: {len(yf_data)} 檔 ({yf_cache_path})")
    else:
        yf_data = {}

    # 增量補抓：尚未快取、或後繼股僅從 2020 起跳、或 2020 後仍交易卻停在 2026-10-29 之前的標的
    yf_fetch_list = []
    for sym in sorted((set(need_yf) & (recent_sp_tickers | successor_tickers)) | successor_tickers):
        if sym in existing_us_tickers:
            continue
        cur_df = yf_data.get(sym)
        sp_end = sp_max_end_map.get(sym, pd.Timestamp("2099-12-31"))
        if cur_df is None or cur_df.empty:
            yf_fetch_list.append(sym)
        elif sym in successor_tickers and cur_df.index.min() > pd.Timestamp("2019-01-01"):
            yf_fetch_list.append(sym)
        elif sp_end >= max_spy_date - pd.Timedelta(days=10) and cur_df.index.max() < max_spy_date - pd.Timedelta(days=5):
            yf_fetch_list.append(sym)

    if yf_fetch_list or not yf_data:
        dl_targets = yf_fetch_list if yf_data else sorted(set(need_yf) | successor_tickers)
        end_dl_str = (max_spy_date + pd.Timedelta(days=2)).strftime("%Y-%m-%d")
        print(f"  - 透過 yfinance 增量補抓 {len(dl_targets)} 檔 (含後繼改名與 2020+ 剔除仍上市股, 2004-01-01 ~ {end_dl_str})...")
        batch_size = 60
        for b_i in range(0, len(dl_targets), batch_size):
            batch = dl_targets[b_i:b_i + batch_size]
            try:
                raw_dl = yf.download(batch, start="2004-01-01", end=end_dl_str, group_by="ticker", auto_adjust=False, progress=False, threads=True)
                for sym in batch:
                    sub = None
                    if len(batch) == 1:
                        sub = raw_dl.dropna(how="all")
                    elif isinstance(raw_dl.columns, pd.MultiIndex) and sym in raw_dl.columns.get_level_values(0):
                        sub = raw_dl[sym].dropna(how="all")
                    if sub is not None and len(sub) > 5 and "Adj Close" in sub.columns:
                        sub_clean = sub.dropna(subset=["Adj Close", "Close"])
                        if len(sub_clean) > 5:
                            sub_clean.index = pd.to_datetime(sub_clean.index).tz_localize(None)
                            yf_data[sym] = sub_clean[["Open", "High", "Low", "Close", "Adj Close", "Volume"]].astype(np.float32)
            except Exception as e:
                print(f"    batch {b_i} warning: {e}")
        # 對單批失敗但屬於 successor/recent 2020+ 的關鍵股，用 single Ticker 補試一次
        for sym in dl_targets:
            if sym in yf_data and len(yf_data[sym]) > 10:
                continue
            try:
                sub = yf.Ticker(sym).history(start="2004-01-01", end=end_dl_str, auto_adjust=False)
                if sub is not None and len(sub) > 10 and "Adj Close" in sub.columns:
                    sub.index = pd.to_datetime(sub.index).tz_localize(None)
                    sub_clean = sub.dropna(subset=["Adj Close", "Close"])
                    if len(sub_clean) > 10:
                        yf_data[sym] = sub_clean[["Open", "High", "Low", "Close", "Adj Close", "Volume"]].astype(np.float32)
            except Exception:
                pass
        with open(os.path.join(PIT_CACHE_DIR, "yf_post2020_pit_us.pkl"), "wb") as f:
            pickle.dump(yf_data, f)

    # 代碼重用污染防護：若某已退場歷史股的 YF 首日反而在其 S&P 500 退場日之後 (例如 INFO 2024 ETF / LB 2024 / SBNY 2024)，嚴禁混入！
    yf_data_clean = {}
    reuse_blocked = []
    for sym, sub_df in yf_data.items():
        if sub_df is None or sub_df.empty:
            continue
        sub_df = sub_df.copy()
        sub_df.index = pd.to_datetime(sub_df.index).tz_localize(None)
        sp_end = sp_max_end_map.get(sym)
        if sp_end is not None and sp_end < pd.Timestamp("2025-01-01"):
            if sub_df.index.min() > sp_end + pd.Timedelta(days=10):
                reuse_blocked.append(sym)
                continue
        yf_data_clean[sym] = sub_df
    if reuse_blocked:
        print(f"  - 🛡️ 代碼重用攔截 ({len(reuse_blocked)} 檔): {sorted(reuse_blocked)} (YF 首日落於退場後，已隔離防污染)")
    yf_data = yf_data_clean

    print("=" * 110)
    print("🔗 [Step 5/5] 執行無斷層比例縫合 (Qlib 2000~2020 + JW/Existing/yfinance 2020~2026) 與除牌/下市日標記...")
    print("=" * 110)

    # 建立統一交易日軸 (2003-01-02 ~ 最新 SPY 交易日)
    existing_dates = pd.DatetimeIndex(sorted(df_existing_us["date"].unique()))
    all_dates = cal_dates.union(existing_dates)
    all_dates = all_dates[(all_dates >= "2003-01-01") & (all_dates <= max_spy_date)]
    all_dates = all_dates[all_dates.dayofweek < 5]

    # FRC -> FRCB OTC 破產退市前連續序列驗證與縫合 (取 2018+ 重疊期驗證相關係數 >= 0.995)
    for old_del, otc_tk in SP500_OTC_DELIST_STITCH:
        if old_del in qlib_adj_close and otc_tk in yf_data and old_del not in yf_data:
            s_q = qlib_adj_close[old_del].pct_change().dropna()
            s_o = yf_data[otc_tk]["Adj Close"].pct_change().dropna()
            ov = s_q.index.intersection(s_o.index)
            ov = ov[ov >= pd.Timestamp("2018-01-01")]
            if len(ov) >= 60:
                corr = float(s_q.loc[ov].corr(s_o.loc[ov]))
                if corr >= 0.995:
                    end_cap = sp_max_end_map.get(old_del, pd.Timestamp("2099-12-31")) + pd.Timedelta(days=5)
                    yf_data[old_del] = yf_data[otc_tk].loc[yf_data[otc_tk].index <= end_cap].copy()
                    print(f"  - 🔗 OTC 下市軌跡連續縫合: {old_del} <- {otc_tk} (2018+ 重疊 {len(ov)} 天, corr={corr:.5f}, 迄 {yf_data[old_del].index.max().date()})")

    # 先將 existing_us 轉成 dict of DataFrames
    existing_map = {}
    for sym, grp in df_existing_us.groupby("ticker"):
        grp = grp.drop_duplicates(subset=["date"]).set_index("date").sort_index()
        existing_map[sym] = grp

    jw_map = {}
    jw_all_map = {}
    for sym, grp in df_jw.groupby("symbol"):
        grp_s = grp.drop_duplicates(subset=["date"]).set_index("date").sort_index()
        jw_all_map[sym] = grp_s
        if sym not in existing_map and sym not in yf_data:
            jw_map[sym] = grp_s

    def _clean_tail_and_patch_vol(sym_k, ac_s, ao_s, ah_s, al_s, rc_s, vv_s):
        # 1. 若 YF 在 2020-2024 期間出現 0 成交量缺口 (如 PARA)，用 jw_all_map 真實成交額與股數補齊
        if sym_k in jw_all_map:
            jg = jw_all_map[sym_k].reindex(all_dates)
            j_vv = jg["volume"].fillna(0.0).astype(np.float32)
            j_rc = jg["close"].replace(0, np.nan).astype(np.float32)
            need_v = (vv_s <= 0) & (j_vv > 0) & ac_s.notna()
            if need_v.any():
                scale = (rc_s / j_rc).replace([np.inf, -np.inf], np.nan).fillna(1.0).clip(0.05, 20.0)
                vv_s = vv_s.where(~need_v, (j_vv / scale).astype(np.float32))
        # 2. 若連續交易結束後出現 > 60 天空白，且尾端僅剩 <= 15 筆零星雜訊 (如 WBD/EA 退場後殘筆)，截斷於主段最後交易日
        valid_pos = np.where(ac_s.notna().values & (vv_s.values > 0))[0]
        if len(valid_pos) > 20:
            gaps = np.diff(valid_pos)
            big_gaps = np.where(gaps > 60)[0]
            for gi in big_gaps:
                tail_cnt = len(valid_pos) - (gi + 1)
                if tail_cnt <= 15:
                    cut_pos = valid_pos[gi] + 1
                    ac_s.iloc[cut_pos:] = np.nan
                    ao_s.iloc[cut_pos:] = np.nan
                    ah_s.iloc[cut_pos:] = np.nan
                    al_s.iloc[cut_pos:] = np.nan
                    rc_s.iloc[cut_pos:] = np.nan
                    vv_s.iloc[cut_pos:] = 0.0
                    break
        return ac_s, ao_s, ah_s, al_s, rc_s, vv_s

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
            ac, ao, ah, al, rc, vv = _clean_tail_and_patch_vol(sym, ac, ao, ah, al, rc, vv)
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
                p_ao = (sub["Open"] * p_rat).astype(np.float32)
                p_ah = (sub["High"] * p_rat).astype(np.float32)
                p_al = (sub["Low"] * p_rat).astype(np.float32)
                p_vv = sub["Volume"].fillna(0.0).astype(np.float32)
                p_ac, p_ao, p_ah, p_al, p_rc, p_vv = _clean_tail_and_patch_vol(sym, p_ac, p_ao, p_ah, p_al, p_rc, p_vv)
                adj_close_dict[sym] = p_ac
                adj_open_dict[sym] = p_ao
                adj_high_dict[sym] = p_ah
                adj_low_dict[sym] = p_al
                raw_close_dict[sym] = p_rc
                vol_dict[sym] = p_vv
                last_valid_date_map[sym] = p_ac.last_valid_index()
            elif sym in jw_map:
                sub = jw_map[sym].reindex(all_dates)
                p_ac = sub["adj_close"].astype(np.float32)
                p_rc = sub["close"].replace(0, np.nan).astype(np.float32)
                p_rat = (p_ac / p_rc).fillna(1.0)
                p_ao = (sub["open"] * p_rat).astype(np.float32)
                p_ah = (sub["high"] * p_rat).astype(np.float32)
                p_al = (sub["low"] * p_rat).astype(np.float32)
                p_vv = sub["volume"].fillna(0.0).astype(np.float32)
                p_ac, p_ao, p_ah, p_al, p_rc, p_vv = _clean_tail_and_patch_vol(sym, p_ac, p_ao, p_ah, p_al, p_rc, p_vv)
                adj_close_dict[sym] = p_ac
                adj_open_dict[sym] = p_ao
                adj_high_dict[sym] = p_ah
                adj_low_dict[sym] = p_al
                raw_close_dict[sym] = p_rc
                vol_dict[sym] = p_vv
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

        q_ac, q_ao, q_ah, q_al, q_rc, q_vv = _clean_tail_and_patch_vol(sym, q_ac, q_ao, q_ah, q_al, q_rc, q_vv)
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

    # 經相關係數驗證之官方改名連續縫合：將舊代碼 S&P 500 區間無縫轉移至具完整連續價格之後繼代碼 (消除 FB/META 8.5年空窗等)
    transferred_rows = []
    for old_tk, new_tk in SP500_VERIFIED_RENAME_PAIRS:
        if new_tk not in us_cols:
            continue
        old_ivs = df_sp_official[df_sp_official["ticker"] == old_tk]
        if old_ivs.empty:
            continue
        new_has_vol = (us_vol[new_tk] > 0) & us_adj_close[new_tk].notna()
        if old_tk not in us_cols:
            # Qlib 已將舊代碼併入新代碼序列 (例如 CTL -> LUMN)，僅需將 FJA 舊代碼入選區間映射至新代碼
            did_direct = False
            for _, r in old_ivs.iterrows():
                s_dt = pd.to_datetime(r["start_date"], errors="coerce")
                e_dt = pd.to_datetime(r["end_date"], errors="coerce")
                if pd.isna(s_dt):
                    s_dt = pd.Timestamp("1990-01-01")
                if pd.isna(e_dt):
                    e_dt = pd.Timestamp("2099-12-31")
                mask_iv = (all_dates >= s_dt) & (all_dates <= e_dt) & new_has_vol.reindex(all_dates).fillna(False)
                if mask_iv.sum() >= 10:
                    us_in_sp500_pit.loc[mask_iv, new_tk] = True
                    us_in_index_pit.loc[mask_iv, new_tk] = True
                    transferred_rows.append({
                        "ticker": new_tk,
                        "source": "SP500_RENAME",
                        "start_date": str(r["start_date"]),
                        "end_date": str(r["end_date"]),
                    })
                    did_direct = True
            if did_direct:
                print(f"  - ✅ 官方改名 PIT 直接映射: {old_tk} -> {new_tk} (Qlib 已承接歷史價格)")
            continue
        r_old = us_adj_close[old_tk].where(us_vol[old_tk] > 0).pct_change(fill_method=None).dropna()
        r_new = us_adj_close[new_tk].where(us_vol[new_tk] > 0).pct_change(fill_method=None).dropna()
        did_transfer = False
        corrs_used = []
        for _, r in old_ivs.iterrows():
            s_dt = pd.to_datetime(r["start_date"], errors="coerce")
            e_dt = pd.to_datetime(r["end_date"], errors="coerce")
            if pd.isna(s_dt):
                s_dt = pd.Timestamp("1990-01-01")
            if pd.isna(e_dt):
                e_dt = pd.Timestamp("2099-12-31")
            # 僅針對該官方區間內的重疊交易日驗證日報酬相關係數 (避開早期前身代碼如 2023 前 FI=Frank's Int'l 造成的誤判)
            ov_iv = r_old.index.intersection(r_new.index)
            ov_iv = ov_iv[(ov_iv >= max(s_dt, pd.Timestamp("2016-01-01"))) & (ov_iv <= e_dt)]
            if len(ov_iv) >= 40:
                corr_iv = float(r_old.loc[ov_iv].corr(r_new.loc[ov_iv]))
                if corr_iv < 0.995:
                    print(f"  - ⚠️ 跳過改名區間 {old_tk} -> {new_tk} [{r['start_date']}..{r['end_date']}]: 重疊 {len(ov_iv)} 天 corr={corr_iv:.4f} < 0.995")
                    continue
                corrs_used.append(corr_iv)
            mask_iv = (all_dates >= s_dt) & (all_dates <= e_dt) & us_in_sp500_pit[old_tk]
            if not mask_iv.any():
                continue
            mask_new_ok = mask_iv & new_has_vol.reindex(all_dates).fillna(False)
            if mask_new_ok.sum() >= max(10, int(0.5 * mask_iv.sum())):
                us_in_sp500_pit.loc[mask_new_ok, new_tk] = True
                us_in_sp500_pit.loc[mask_new_ok, old_tk] = False
                us_in_index_pit.loc[mask_new_ok, new_tk] = True
                us_in_index_pit.loc[mask_new_ok, old_tk] = False
                transferred_rows.append({
                    "ticker": new_tk,
                    "source": "SP500_RENAME",
                    "start_date": str(r["start_date"]),
                    "end_date": str(r["end_date"]),
                })
                did_transfer = True
        if did_transfer:
            corr_str = f"corr={corrs_used[-1]:.5f}" if corrs_used else "pre-2020_direct"
            print(f"  - ✅ 官方改名 PIT 連續縫合: {old_tk} -> {new_tk} ({corr_str})")

    if transferred_rows:
        df_pit = pd.concat([df_pit, pd.DataFrame(transferred_rows)], ignore_index=True)
        conn_w = sqlite3.connect(DB_PATH)
        df_pit.to_sql("us_pit_constituents", conn_w, if_exists="replace", index=False)
        conn_w.close()

    # 同時確保股票在 last_valid_date 之後（已下市/破產/被併購）絕對不可再被選入，且價格僅在活躍期內小幅 ffill (最多5天處理假期)
    us_adj_close_ff5 = us_adj_close.ffill(limit=5)
    us_adj_open_ff5 = us_adj_open.ffill(limit=5)
    us_adj_high_ff5 = us_adj_high.ffill(limit=5)
    us_adj_low_ff5 = us_adj_low.ffill(limit=5)
    us_raw_close_ff5 = us_raw_close.ffill(limit=5)

    res = {
        "schema_version": 2,
        "db_max_date": latest_spy_str,
        "verified_rename_pairs": SP500_VERIFIED_RENAME_PAIRS,
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
    # 同步寫入 /tmp/ 相容舊腳本讀取，主路徑為 pit_cache/us_pit_full_history.pkl
    with open(US_PIT_TMP_PATH, "wb") as f:
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
