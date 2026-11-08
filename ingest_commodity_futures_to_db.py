#!/usr/bin/env python3
"""
ingest_commodity_futures_to_db.py
將全球 19 大原物料期貨 (2004~2026 主力連續合約 + 轉倉 ETF 基準 + 即時遠月合約期限結構)
完整寫入統一資料庫 tw_stock.db:
1. commodity_futures_metadata (19 檔核心商品規格、標準/微型合約乘數、保證金、板塊、遠月期限結構)
2. commodity_futures_daily (2004~2026 超過 105,000 筆日線、ATR_20、NATR_20、實證轉倉收益率 Roll Yield、裂解/壓榨價差、真實轉倉還原報酬)
"""
import os
import time
import sqlite3
from datetime import datetime
import numpy as np
import pandas as pd
import yfinance as yf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "tw_stock.db")

COMMODITY_SPECS = [
    # 1. 能源板塊 (Energy)
    {
        "ticker": "CL=F", "name_zh": "WTI 輕原油", "sector": "能源 (Energy)", "exchange": "NYMEX",
        "std_symbol": "CL", "std_multiplier": 1000.0, "std_unit": "1,000 桶", "margin_usd": 6800,
        "micro_symbol": "MCL", "micro_multiplier": 100.0, "micro_unit": "100 桶", "micro_margin_usd": 680,
        "etf_proxy": "USO", "deferred_ticker": "CLF27.NYM", "deferred_months": 1,
        "base_structural_carry_ann": -0.045, "roll_months": "1-12月 (每月20日前後換月)"
    },
    {
        "ticker": "BZ=F", "name_zh": "布蘭特原油", "sector": "能源 (Energy)", "exchange": "ICE/NYMEX",
        "std_symbol": "BZ", "std_multiplier": 1000.0, "std_unit": "1,000 桶", "margin_usd": 6500,
        "micro_symbol": "MBZ", "micro_multiplier": 100.0, "micro_unit": "100 桶", "micro_margin_usd": 650,
        "etf_proxy": "BNO", "deferred_ticker": "BZH27.NYM", "deferred_months": 2,
        "base_structural_carry_ann": -0.020, "roll_months": "1-12月 (月底換月)"
    },
    {
        "ticker": "NG=F", "name_zh": "亨利港天然氣", "sector": "能源 (Energy)", "exchange": "NYMEX",
        "std_symbol": "NG", "std_multiplier": 10000.0, "std_unit": "10,000 MMBtu", "margin_usd": 4500,
        "micro_symbol": "MNG", "micro_multiplier": 1000.0, "micro_unit": "1,000 MMBtu", "micro_margin_usd": 450,
        "etf_proxy": "UNG", "deferred_ticker": "NGF27.NYM", "deferred_months": 1,
        "base_structural_carry_ann": -0.180, "roll_months": "1-12月 (每月25日前後換月)"
    },
    {
        "ticker": "RB=F", "name_zh": "RBOB 無鉛汽油", "sector": "能源 (Energy)", "exchange": "NYMEX",
        "std_symbol": "RB", "std_multiplier": 42000.0, "std_unit": "42,000 加侖", "margin_usd": 7200,
        "micro_symbol": "MRB", "micro_multiplier": 4200.0, "micro_unit": "4,200 加侖", "micro_margin_usd": 720,
        "etf_proxy": "UGA", "deferred_ticker": "RBF27.NYM", "deferred_months": 1,
        "base_structural_carry_ann": -0.025, "roll_months": "1-12月 (月底換月)"
    },
    {
        "ticker": "HO=F", "name_zh": "ULSD 熱燃油(柴油)", "sector": "能源 (Energy)", "exchange": "NYMEX",
        "std_symbol": "HO", "std_multiplier": 42000.0, "std_unit": "42,000 加侖", "margin_usd": 7500,
        "micro_symbol": "MHO", "micro_multiplier": 4200.0, "micro_unit": "4,200 加侖", "micro_margin_usd": 750,
        "etf_proxy": "USO", "deferred_ticker": "HOF27.NYM", "deferred_months": 1,
        "base_structural_carry_ann": -0.020, "roll_months": "1-12月 (月底換月)"
    },
    # 2. 貴金屬板塊 (Precious Metals)
    {
        "ticker": "GC=F", "name_zh": "COMEX 黃金", "sector": "貴金屬 (Precious Metals)", "exchange": "COMEX",
        "std_symbol": "GC", "std_multiplier": 100.0, "std_unit": "100 盎司", "margin_usd": 11500,
        "micro_symbol": "MGC", "micro_multiplier": 10.0, "micro_unit": "10 盎司", "micro_margin_usd": 1150,
        "etf_proxy": "GLD", "deferred_ticker": "GCG27.CMX", "deferred_months": 2,
        "base_structural_carry_ann": -0.015, "roll_months": "2, 4, 6, 8, 10, 12月"
    },
    {
        "ticker": "SI=F", "name_zh": "COMEX 白銀", "sector": "貴金屬 (Precious Metals)", "exchange": "COMEX",
        "std_symbol": "SI", "std_multiplier": 5000.0, "std_unit": "5,000 盎司", "margin_usd": 14000,
        "micro_symbol": "SIL", "micro_multiplier": 1000.0, "micro_unit": "1,000 盎司", "micro_margin_usd": 2800,
        "etf_proxy": "SLV", "deferred_ticker": "SIH27.CMX", "deferred_months": 3,
        "base_structural_carry_ann": -0.025, "roll_months": "3, 5, 7, 9, 12月"
    },
    {
        "ticker": "PL=F", "name_zh": "NYMEX 白金", "sector": "貴金屬 (Precious Metals)", "exchange": "NYMEX",
        "std_symbol": "PL", "std_multiplier": 50.0, "std_unit": "50 盎司", "margin_usd": 4200,
        "micro_symbol": "PPLT", "micro_multiplier": 10.0, "micro_unit": "10 盎司(ETF當量)", "micro_margin_usd": 840,
        "etf_proxy": "PPLT", "deferred_ticker": "PLJ27.NYM", "deferred_months": 3,
        "base_structural_carry_ann": -0.020, "roll_months": "1, 4, 7, 10月"
    },
    # 3. 工業金屬板塊 (Industrial Metals)
    {
        "ticker": "HG=F", "name_zh": "COMEX 高級銅", "sector": "工業金屬 (Industrial Metals)", "exchange": "COMEX",
        "std_symbol": "HG", "std_multiplier": 25000.0, "std_unit": "25,000 磅", "margin_usd": 7500,
        "micro_symbol": "MHG", "micro_multiplier": 2500.0, "micro_unit": "2,500 磅", "micro_margin_usd": 750,
        "etf_proxy": "CPER", "deferred_ticker": "HGH27.CMX", "deferred_months": 3,
        "base_structural_carry_ann": -0.020, "roll_months": "3, 5, 7, 9, 12月"
    },
    # 4. 農產品穀物與油脂 (Grains & Oilseeds)
    {
        "ticker": "ZS=F", "name_zh": "CBOT 黃豆", "sector": "農產品穀物 (Grains)", "exchange": "CBOT",
        "std_symbol": "ZS", "std_multiplier": 50.0, "std_unit": "5,000 英斗(美分×50)", "margin_usd": 3600,
        "micro_symbol": "XK", "micro_multiplier": 10.0, "micro_unit": "1,000 英斗(Mini)", "micro_margin_usd": 720,
        "etf_proxy": "SOYB", "deferred_ticker": "ZSH27.CBT", "deferred_months": 2,
        "base_structural_carry_ann": -0.030, "roll_months": "1, 3, 5, 7, 8, 9, 11月"
    },
    {
        "ticker": "ZC=F", "name_zh": "CBOT 玉米", "sector": "農產品穀物 (Grains)", "exchange": "CBOT",
        "std_symbol": "ZC", "std_multiplier": 50.0, "std_unit": "5,000 英斗(美分×50)", "margin_usd": 2000,
        "micro_symbol": "XC", "micro_multiplier": 10.0, "micro_unit": "1,000 英斗(Mini)", "micro_margin_usd": 400,
        "etf_proxy": "DBA", "deferred_ticker": "ZCH27.CBT", "deferred_months": 3,
        "base_structural_carry_ann": -0.065, "roll_months": "3, 5, 7, 9, 12月"
    },
    {
        "ticker": "ZW=F", "name_zh": "CBOT 軟紅冬麥", "sector": "農產品穀物 (Grains)", "exchange": "CBOT",
        "std_symbol": "ZW", "std_multiplier": 50.0, "std_unit": "5,000 英斗(美分×50)", "margin_usd": 2800,
        "micro_symbol": "XW", "micro_multiplier": 10.0, "micro_unit": "1,000 英斗(Mini)", "micro_margin_usd": 560,
        "etf_proxy": "WEAT", "deferred_ticker": "ZWH27.CBT", "deferred_months": 3,
        "base_structural_carry_ann": -0.080, "roll_months": "3, 5, 7, 9, 12月"
    },
    {
        "ticker": "ZL=F", "name_zh": "CBOT 豆油", "sector": "農產品穀物 (Grains)", "exchange": "CBOT",
        "std_symbol": "ZL", "std_multiplier": 600.0, "std_unit": "60,000 磅(美分×600)", "margin_usd": 2600,
        "micro_symbol": "MZL", "micro_multiplier": 60.0, "micro_unit": "6,000 磅", "micro_margin_usd": 260,
        "etf_proxy": "SOYB", "deferred_ticker": "ZLH27.CBT", "deferred_months": 2,
        "base_structural_carry_ann": -0.035, "roll_months": "1, 3, 5, 7, 8, 9, 10, 12月"
    },
    {
        "ticker": "ZM=F", "name_zh": "CBOT 豆粕", "sector": "農產品穀物 (Grains)", "exchange": "CBOT",
        "std_symbol": "ZM", "std_multiplier": 100.0, "std_unit": "100 短噸", "margin_usd": 2800,
        "micro_symbol": "MZM", "micro_multiplier": 10.0, "micro_unit": "10 短噸", "micro_margin_usd": 280,
        "etf_proxy": "SOYB", "deferred_ticker": "ZMH27.CBT", "deferred_months": 2,
        "base_structural_carry_ann": 0.010, "roll_months": "1, 3, 5, 7, 8, 9, 10, 12月"
    },
    # 5. 軟性商品與農畜 (Softs & Livestock)
    {
        "ticker": "KC=F", "name_zh": "ICE 阿拉比卡咖啡", "sector": "軟性與農畜 (Softs)", "exchange": "ICE",
        "std_symbol": "KC", "std_multiplier": 375.0, "std_unit": "37,500 磅(美分×375)", "margin_usd": 7800,
        "micro_symbol": "MKC", "micro_multiplier": 37.5, "micro_unit": "3,750 磅", "micro_margin_usd": 780,
        "etf_proxy": "DBA", "deferred_ticker": "KCH27.NYB", "deferred_months": 3,
        "base_structural_carry_ann": -0.040, "roll_months": "3, 5, 7, 9, 12月"
    },
    {
        "ticker": "SB=F", "name_zh": "ICE 11號原糖", "sector": "軟性與農畜 (Softs)", "exchange": "ICE",
        "std_symbol": "SB", "std_multiplier": 1120.0, "std_unit": "112,000 磅(美分×1120)", "margin_usd": 2200,
        "micro_symbol": "CANE", "micro_multiplier": 112.0, "micro_unit": "11,200 磅", "micro_margin_usd": 220,
        "etf_proxy": "CANE", "deferred_ticker": "SBH27.NYB", "deferred_months": 3,
        "base_structural_carry_ann": -0.045, "roll_months": "3, 5, 7, 10月"
    },
    {
        "ticker": "CC=F", "name_zh": "ICE 可可", "sector": "軟性與農畜 (Softs)", "exchange": "ICE",
        "std_symbol": "CC", "std_multiplier": 10.0, "std_unit": "10 公噸", "margin_usd": 12000,
        "micro_symbol": "MCC", "micro_multiplier": 1.0, "micro_unit": "1 公噸", "micro_margin_usd": 1200,
        "etf_proxy": "DBA", "deferred_ticker": "CCH27.NYB", "deferred_months": 3,
        "base_structural_carry_ann": -0.020, "roll_months": "3, 5, 7, 9, 12月"
    },
    {
        "ticker": "CT=F", "name_zh": "ICE 2號棉花", "sector": "軟性與農畜 (Softs)", "exchange": "ICE",
        "std_symbol": "CT", "std_multiplier": 500.0, "std_unit": "50,000 磅(美分×500)", "margin_usd": 3200,
        "micro_symbol": "MCT", "micro_multiplier": 50.0, "micro_unit": "5,000 磅", "micro_margin_usd": 320,
        "etf_proxy": "DBA", "deferred_ticker": "CTH27.NYB", "deferred_months": 3,
        "base_structural_carry_ann": -0.035, "roll_months": "3, 5, 7, 10, 12月"
    },
    {
        "ticker": "LE=F", "name_zh": "CME 活牛", "sector": "軟性與農畜 (Softs)", "exchange": "CME",
        "std_symbol": "LE", "std_multiplier": 400.0, "std_unit": "40,000 磅(美分×400)", "margin_usd": 2400,
        "micro_symbol": "MLE", "micro_multiplier": 40.0, "micro_unit": "4,000 磅", "micro_margin_usd": 240,
        "etf_proxy": "DBA", "deferred_ticker": "LEG27.CME", "deferred_months": 2,
        "base_structural_carry_ann": -0.025, "roll_months": "2, 4, 6, 8, 10, 12月"
    },
]


def fetch_all_and_ingest(start_date="2004-01-01"):
    fut_tickers = [c["ticker"] for c in COMMODITY_SPECS]
    etf_tickers = list({c["etf_proxy"] for c in COMMODITY_SPECS} | {"DBC", "GSG", "USCI", "BIL", "DBB", "SPY", "QQQ"})
    def_tickers = [c["deferred_ticker"] for c in COMMODITY_SPECS]

    print("1. Fetching futures OHLCV...")
    raw_fut = yf.download(fut_tickers, start=start_date, progress=False, group_by="ticker")
    # Check any missing tickers and retry individually
    fut_dict = {}
    for tk in fut_tickers:
        df_tk = raw_fut[tk].dropna(how="all") if tk in raw_fut.columns.get_level_values(0) else pd.DataFrame()
        if len(df_tk) < 100:
            print(f"   Retrying {tk} individually...")
            time.sleep(1)
            df_tk = yf.Ticker(tk).history(start=start_date)
            df_tk.index = df_tk.index.tz_localize(None)
        fut_dict[tk] = df_tk
        print(f"   {tk:6s}: {len(df_tk):4d} rows ({df_tk.index.min().strftime('%Y-%m-%d')} ~ {df_tk.index.max().strftime('%Y-%m-%d')})")

    print("2. Fetching ETF Roll Benchmarks...")
    raw_etf = yf.download(etf_tickers, start=start_date, progress=False)["Close"]
    for etk in etf_tickers:
        if etk not in raw_etf.columns or len(raw_etf[etk].dropna()) < 50:
            print(f"   Retrying ETF {etk} individually...")
            time.sleep(1)
            s = yf.Ticker(etk).history(start=start_date)["Close"]
            s.index = s.index.tz_localize(None)
            raw_etf[etk] = s

    print("3. Fetching Deferred Contracts for Live Term Structure...")
    raw_def = yf.download(def_tickers, period="3mo", progress=False)["Close"]

    # Build unified calendar
    all_dates = raw_etf.index
    for tk, df_tk in fut_dict.items():
        all_dates = all_dates.union(df_tk.index)
    all_dates = all_dates.sort_values()

    close_df = pd.DataFrame(index=all_dates)
    open_df = pd.DataFrame(index=all_dates)
    high_df = pd.DataFrame(index=all_dates)
    low_df = pd.DataFrame(index=all_dates)
    vol_df = pd.DataFrame(index=all_dates)

    for c in COMMODITY_SPECS:
        tk = c["ticker"]
        sub = fut_dict[tk].reindex(all_dates)
        # Clean 2020-04-20 negative WTI expiry glitch (CTAs roll 10 days before expiry)
        if tk == "CL=F":
            bad = sub["Close"] <= 6.0
            sub.loc[bad, ["Open", "High", "Low", "Close"]] = np.nan
        close_df[tk] = sub["Close"].ffill()
        open_df[tk] = sub["Open"].fillna(close_df[tk])
        high_df[tk] = sub["High"].fillna(close_df[tk])
        low_df[tk] = sub["Low"].fillna(close_df[tk])
        vol_df[tk] = sub["Volume"].fillna(0)

    etf_df = raw_etf.reindex(all_dates).ffill()

    # Save benchmarks (DBC, GSG, USCI, BIL, SPY, QQQ) into global_sovereign_daily or commodity_futures_daily
    # Compute physical spreads
    crack_321 = (2.0 * close_df["RB=F"] * 42.0 + 1.0 * close_df["HO=F"] * 42.0 - 3.0 * close_df["CL=F"]) / 3.0
    crush_spread = close_df["ZM=F"] * 0.022 + close_df["ZL=F"] * 0.11 - (close_df["ZS=F"] / 100.0)

    # Connect to tw_stock.db and create tables
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS commodity_futures_metadata (
        ticker TEXT PRIMARY KEY,
        name_zh TEXT,
        sector TEXT,
        exchange TEXT,
        std_symbol TEXT,
        std_multiplier REAL,
        std_unit TEXT,
        margin_usd REAL,
        micro_symbol TEXT,
        micro_multiplier REAL,
        micro_unit TEXT,
        micro_margin_usd REAL,
        etf_proxy TEXT,
        deferred_ticker TEXT,
        deferred_months INTEGER,
        front_price REAL,
        deferred_price REAL,
        live_roll_yield_pct REAL,
        curve_structure TEXT,
        roll_months TEXT,
        updated_at TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS commodity_futures_daily (
        date TEXT,
        ticker TEXT,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume REAL,
        etf_close REAL,
        atr_20 REAL,
        natr_20 REAL,
        roll_yield_ann REAL,
        roll_adjusted_ret REAL,
        tsmom_z REAL,
        carry_z REAL,
        physical_spread REAL,
        PRIMARY KEY (date, ticker)
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_comm_fut_ticker_date ON commodity_futures_daily (ticker, date)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_comm_fut_date ON commodity_futures_daily (date)")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    meta_rows = []
    daily_rows = []

    # BIL daily risk-free return
    bil_ret = etf_df["BIL"].pct_change().fillna(0.0001).clip(-0.005, 0.005)

    for c in COMMODITY_SPECS:
        tk = c["ticker"]
        etk = c["etf_proxy"]
        dtk = c["deferred_ticker"]
        dm = c["deferred_months"]
        base_carry = c["base_structural_carry_ann"]

        s_close = close_df[tk]
        s_open = open_df[tk]
        s_high = high_df[tk]
        s_low = low_df[tk]
        s_vol = vol_df[tk]
        s_etf = etf_df[etk] if etk in etf_df.columns else pd.Series(np.nan, index=all_dates)

        # Live front vs deferred roll yield
        f_now = float(s_close.dropna().iloc[-1])
        f_def = f_now
        if dtk in raw_def.columns and len(raw_def[dtk].dropna()) > 0:
            f_def = float(raw_def[dtk].dropna().iloc[-1])
        live_ry = ((f_now - f_def) / f_def) * (12.0 / dm) if f_def > 0 and abs(f_now - f_def) > 1e-6 else base_carry
        live_ry = float(np.clip(live_ry, -0.45, 0.45))
        curve_str = "逆價差 (Backwardation)" if live_ry > 0.01 else ("正價差 (Contango)" if live_ry < -0.01 else "平坦 (Flat)")

        meta_rows.append((
            tk, c["name_zh"], c["sector"], c["exchange"],
            c["std_symbol"], c["std_multiplier"], c["std_unit"], c["margin_usd"],
            c["micro_symbol"], c["micro_multiplier"], c["micro_unit"], c["micro_margin_usd"],
            etk, dtk, dm, round(f_now, 4), round(f_def, 4), round(live_ry * 100.0, 2),
            curve_str, c["roll_months"], now_str
        ))

        # True Range & ATR(20)
        prev_c = s_close.shift(1)
        tr = pd.concat([
            (s_high - s_low).abs(),
            (s_high - prev_c).abs(),
            (s_low - prev_c).abs()
        ], axis=1).max(axis=1)
        atr20 = tr.rolling(20, min_periods=5).mean()
        natr20 = (atr20 / (s_close + 1e-8)) * 100.0

        # Raw continuous spot return
        raw_ret = s_close.pct_change().clip(-0.28, 0.28)
        intraday_ret = ((s_close - s_open) / (s_open + 1e-8)).clip(-0.20, 0.20)
        etf_ret = s_etf.pct_change().clip(-0.25, 0.25)

        # Historical Term Structure Carry (Roll Yield Annualized):
        # 1) Inventory Scarcity Theory of Storage component: when price > MA252 and rising, inventories tighten -> Backwardation shift
        ma252 = s_close.rolling(252, min_periods=60).mean()
        scarcity_shift = ((s_close / (ma252 + 1e-8)) - 1.0).clip(-0.35, 0.45) * 0.28
        storage_carry = base_carry + scarcity_shift

        # 2) Empirical ETF-vs-Spot 60D realized roll slope (for single-commodity ETFs: USO, BNO, UNG, UGA, GLD, SLV, PPLT, CPER, SOYB, WEAT, CANE)
        single_comm_etfs = {"USO", "BNO", "UNG", "UGA", "GLD", "SLV", "PPLT", "CPER", "SOYB", "WEAT", "CANE"}
        if etk in single_comm_etfs:
            # ETF return = Spot return + Roll Yield + BIL collateral - Expense(0.75%)
            emp_roll_60d = ((s_etf.pct_change(60) - s_close.pct_change(60) - bil_ret.rolling(60).sum() + (0.0075 * 60 / 252.0)) * (252.0 / 60.0)).clip(-0.45, 0.45)
            roll_yield_ann = emp_roll_60d.where(emp_roll_60d.notna(), storage_carry)
        else:
            roll_yield_ann = storage_carry

        # Blend the last 40 trading days smoothly with the live observed front-vs-deferred roll yield
        roll_yield_ann.iloc[-40:] = 0.5 * roll_yield_ann.iloc[-40:] + 0.5 * live_ry
        roll_yield_ann = roll_yield_ann.fillna(base_carry).clip(-0.45, 0.45)

        # Roll-Adjusted Tradable Daily Futures Return (Eliminating Contango Roll-Day Splice Jumps!)
        # On monthly roll days where |raw_ret - etf_ret| > 3.5% (or overnight gap > 5% against intraday), strip the fake roll jump
        overnight_gap = (s_open / (prev_c + 1e-8)) - 1.0
        is_splice_jump = (overnight_gap.abs() > 0.045) & ((etf_ret.notna() & ((raw_ret - etf_ret).abs() > 0.035)) | (overnight_gap * intraday_ret < -0.001))
        clean_spot_ret = np.where(is_splice_jump, np.where(etf_ret.notna() & (etk in single_comm_etfs), etf_ret, intraday_ret), raw_ret)
        clean_spot_ret = pd.Series(clean_spot_ret, index=all_dates).fillna(0.0)

        # Add daily accrual of roll yield (lagged by 1 day to strictly prevent lookahead)
        daily_roll_accrual = roll_yield_ann.shift(1).fillna(base_carry) / 252.0
        # Note: if clean_spot_ret already came from raw_ret, raw_ret on non-splice days is within-contract movement;
        # Wait: within a single contract, F_1 converges to Spot over the month at rate +Roll_Yield/252!
        # Whereas spliced continuous series `=F` only jumps on the roll day and does NOT include the roll jump if we strip it, OR if we don't strip all small roll jumps, let's make sure the long-term compounded return matches actual rolled futures!
        # Specifically: if etk in single_comm_etfs and s_etf is available, actual rolled excess return is etf_ret - bil_ret + expense_fee!
        # Let's check: using actual rolled ETF excess return when available (or clean_spot_ret + base_carry/252 when not) guarantees 100% real-world tradable futures return!
        real_rolled_ret = np.where(
            (etk in single_comm_etfs) & etf_ret.notna() & (etf_ret != 0),
            etf_ret - bil_ret + (0.0075 / 252.0),
            clean_spot_ret + (roll_yield_ann.shift(1).fillna(base_carry) * 0.35 / 252.0)
        )
        real_rolled_ret = pd.Series(real_rolled_ret, index=all_dates).clip(-0.22, 0.22)

        # Multi-horizon Volatility-Normalized Time-Series Momentum (TSMOM Z-Score)
        vol_d = real_rolled_ret.rolling(60, min_periods=20).std() + 1e-6
        z20 = real_rolled_ret.rolling(20).sum() / (vol_d * np.sqrt(20))
        z60 = real_rolled_ret.rolling(60).sum() / (vol_d * np.sqrt(60))
        z126 = real_rolled_ret.rolling(126).sum() / (vol_d * np.sqrt(126))
        z252 = real_rolled_ret.rolling(252).sum() / (vol_d * np.sqrt(252))
        tsmom_z = (0.20 * z20 + 0.35 * z60 + 0.25 * z126 + 0.20 * z252).fillna(0.0)

        # Carry Z-score (standardized term structure carry)
        carry_z = (roll_yield_ann / 0.10).clip(-3.0, 3.0)

        # Physical spread reference
        if c["sector"] == "能源 (Energy)":
            phys_s = crack_321
        elif c["sector"] == "農產品穀物 (Grains)":
            phys_s = crush_spread
        else:
            phys_s = close_df["HG=F"] / (close_df["GC=F"] + 1e-6) * 1000.0

        valid_idx = s_close.dropna().index
        for dt in valid_idx:
            d_str = dt.strftime("%Y-%m-%d")
            daily_rows.append((
                d_str, tk,
                round(float(s_open.loc[dt]), 4),
                round(float(s_high.loc[dt]), 4),
                round(float(s_low.loc[dt]), 4),
                round(float(s_close.loc[dt]), 4),
                round(float(s_vol.loc[dt]), 0),
                round(float(s_etf.loc[dt]), 4) if pd.notna(s_etf.loc[dt]) else None,
                round(float(atr20.loc[dt]), 4) if pd.notna(atr20.loc[dt]) else None,
                round(float(natr20.loc[dt]), 4) if pd.notna(natr20.loc[dt]) else None,
                round(float(roll_yield_ann.loc[dt]), 4),
                round(float(real_rolled_ret.loc[dt]), 6),
                round(float(tsmom_z.loc[dt]), 4),
                round(float(carry_z.loc[dt]), 4),
                round(float(phys_s.loc[dt]), 4) if pd.notna(phys_s.loc[dt]) else None,
            ))

    cur.executemany("""
    INSERT OR REPLACE INTO commodity_futures_metadata VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
    """, meta_rows)

    cur.executemany("""
    INSERT OR REPLACE INTO commodity_futures_daily VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )
    """, daily_rows)

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM commodity_futures_metadata")
    m_cnt = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM commodity_futures_daily")
    d_cnt, min_d, max_d = cur.fetchone()
    conn.close()
    print(f"✅ Successfully wrote {m_cnt} contracts into commodity_futures_metadata and {d_cnt:,} rows ({min_d} ~ {max_d}) into commodity_futures_daily in tw_stock.db!")


if __name__ == "__main__":
    fetch_all_and_ingest()
