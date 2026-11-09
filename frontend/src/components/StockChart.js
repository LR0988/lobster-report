import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  createSeriesMarkers, CrosshairMode, LineStyle,
} from 'lightweight-charts';
import { resolveApiBase } from '../api';
import * as ind from './chartIndicators';

/* ------------------------------------------------------------------
 * 個股技術線圖：資料即時取自本機 tw_stock.db (GET /api/chart/{ticker})，
 * 不上傳、不快取價量資料，每次開啟 / 按「重新整理」都重新讀取。
 * 任何頁面以 <StockChartButton ticker="2330.TW" name="台積電" /> 或
 * openStockChart({ticker,name,levels}) 開啟；App.js 掛一個 <StockChartHost />。
 * ------------------------------------------------------------------ */

const EVT = 'open-stock-chart';
export const openStockChart = (detail) => window.dispatchEvent(new CustomEvent(EVT, { detail }));

export const StockChartButton = ({ ticker, name, levels, trade, trades, label = '📈', style }) => (
  <button
    type="button"
    title={trade?.entry_date ? `開啟 ${name || ticker} K線圖 (標記進場 ${trade.entry_date} ➔ 出場 ${trade.exit_date || '持有中'})` : `開啟 ${name || ticker} 技術線圖`}
    onClick={(e) => { e.stopPropagation(); openStockChart({ ticker, name, levels, trade, trades }); }}
    style={{
      cursor: 'pointer', fontSize: '0.78rem', fontWeight: 'bold', padding: '2px 5px', borderRadius: '4px',
      border: '1px solid rgba(96,165,250,0.55)', background: 'rgba(59,130,246,0.15)', color: '#93C5FD',
      lineHeight: 1.1, whiteSpace: 'nowrap', ...style,
    }}
  >{label}</button>
);

const MA_DEFS = [
  { n: 5, color: '#FBBF24' }, { n: 10, color: '#38BDF8' }, { n: 20, color: '#F472B6' },
  { n: 60, color: '#34D399' }, { n: 120, color: '#A78BFA' }, { n: 240, color: '#94A3B8' },
];
const VMA_DEFS = [{ n: 5, color: '#FBBF24' }, { n: 20, color: '#F472B6' }, { n: 60, color: '#34D399' }];
const SUBS = [
  { key: 'vol', label: '成交量' },
  { key: 'rev', label: '月營收', tw: true },
  { key: 'eps', label: 'EPS/本益比', tw: true },
  { key: 'kd', label: 'KD' }, { key: 'macd', label: 'MACD' },
  { key: 'rsi', label: 'RSI' }, { key: 'bias', label: '乖離率' }, { key: 'dmi', label: 'DMI/ADX' },
  { key: 'wr', label: '威廉%R' }, { key: 'obv', label: 'OBV' }, { key: 'atr', label: 'ATR' },
  { key: 'fi', label: '外資', tw: true }, { key: 'tr', label: '投信', tw: true },
  { key: 'de', label: '自營商', tw: true }, { key: 'mg', label: '融資/融券', tw: true },
];
const RANGES = [{ l: '1月', n: 21 }, { l: '3月', n: 63 }, { l: '6月', n: 126 }, { l: '1年', n: 252 }, { l: '3年', n: 756 }, { l: '全部', n: 0 }];
const TYPES = [{ k: 'candle', l: 'K線' }, { k: 'bar', l: '美國線' }, { k: 'line', l: '收盤線' }, { k: 'area', l: '面積' }];

const DEFAULT_PREFS = {
  type: 'candle', ma: [5, 20, 60], vma: [5, 20], boll: false, hilo: true, signals: false, log: false,
  subs: ['vol', 'rev', 'eps', 'kd'], upColor: null, range: 126, days: 1500,
  profile: true, profWin: 60, profBins: 50, prefsVer: 2,
};
const loadPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('stockChartPrefs')) || {};
    const p = { ...DEFAULT_PREFS, ...raw };
    p.days = Math.max(p.days || 0, DEFAULT_PREFS.days); // 舊設定存的 750 日不夠看「全部」
    if (!raw.prefsVer || raw.prefsVer < 2) {
      const curSubs = Array.isArray(p.subs) ? [...p.subs] : ['vol', 'kd'];
      const nextSubs = [];
      if (curSubs.includes('vol')) nextSubs.push('vol');
      nextSubs.push('rev', 'eps');
      curSubs.forEach((k) => { if (!nextSubs.includes(k)) nextSubs.push(k); });
      p.subs = nextSubs;
      p.prefsVer = 2;
      try { localStorage.setItem('stockChartPrefs', JSON.stringify(p)); } catch {}
    }
    return p;
  }
  catch { return DEFAULT_PREFS; }
};

const toLine = (dates, arr) => dates.map((t, i) => (arr[i] == null ? { time: t } : { time: t, value: arr[i] }));
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

const Chip = ({ on, color, onClick, children }) => (
  <button type="button" onClick={onClick} style={{
    cursor: 'pointer', fontSize: '0.72rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold',
    border: `1px solid ${on ? (color || '#60A5FA') : 'rgba(255,255,255,0.14)'}`,
    background: on ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
    color: on ? (color || '#E2E8F0') : '#64748B',
  }}>{children}</button>
);

const StockChartModal = ({ req, onClose }) => {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | error
  const [err, setErr] = useState('');
  const [hover, setHover] = useState(null);
  const boxRef = useRef(null);
  const profRef = useRef(null);
  const chartRef = useRef(null);
  const rangeRef = useRef(null);
  const setP = (patch) => setPrefs((p) => { const n = { ...p, ...patch }; try { localStorage.setItem('stockChartPrefs', JSON.stringify(n)); } catch {} return n; });
  const toggleIn = (key, v) => setP({ [key]: prefs[key].includes(v) ? prefs[key].filter((x) => x !== v) : [...prefs[key], v] });

  const load = useCallback(async () => {
    setState('loading'); setErr('');
    try {
      let base = await resolveApiBase();
      const sym = encodeURIComponent(req.ticker);
      const effectiveDays = (req.trade?.entry_date || (Array.isArray(req.trades) && req.trades.length > 0))
        ? Math.max(prefs.days, 6000)
        : prefs.days;
      let res;
      try {
        res = await fetch(`${base}/api/chart/${sym}?days=${effectiveDays}`, { cache: 'no-store' });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      } catch (firstErr) {
        // 若首次連線失敗或非 404 錯誤，強制從 Supabase 刷新最新通道網址重試一次
        base = await resolveApiBase(true);
        res = await fetch(`${base}/api/chart/${sym}?days=${effectiveDays}`, { cache: 'no-store' });
      }
      if (!res.ok) throw new Error(res.status === 404 ? `本機資料庫查無 ${req.ticker} 日K資料` : `本機 API 回應 ${res.status}`);
      setData(await res.json()); setState('ok');
    } catch (e) {
      setErr(e.message?.includes('Failed to fetch')
        ? '連不到本機 API 通道。請確認筆電上的 uvicorn 與 manage_tunnel.py 正在執行。' : e.message);
      setState('error');
    }
  }, [req.ticker, req.trade, req.trades, prefs.days]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const isTW = data?.market === 'TW';
  const upIsRed = prefs.upColor ? prefs.upColor === 'red' : isTW; // 台股紅漲綠跌
  const UP = upIsRed ? '#EF4444' : '#22C55E';
  const DN = upIsRed ? '#22C55E' : '#EF4444';

  // 全部指標一次算好 (與繪圖/legend 共用)
  const calc = useMemo(() => {
    if (!data) return null;
    const { c, h, l, v } = data;
    const m = {};
    MA_DEFS.forEach(({ n }) => { m[n] = ind.sma(c, n); });
    const vm = {};
    VMA_DEFS.forEach(({ n }) => { vm[n] = ind.sma(v, n); });
    return {
      m, vm, boll: ind.bollinger(c), kd: ind.kd(h, l, c), macd: ind.macd(c),
      rsi6: ind.rsi(c, 6), rsi14: ind.rsi(c, 14), bias5: ind.bias(c, 5), bias20: ind.bias(c, 20), bias60: ind.bias(c, 60),
      dmi: ind.dmi(h, l, c), wr: ind.williams(h, l, c), obv: ind.obv(c, v), atr: ind.atr(h, l, c),
    };
  }, [data]);

  const subs = useMemo(() => prefs.subs.filter((k) => SUBS.find((s) => s.key === k && (!s.tw || isTW))), [prefs.subs, isTW]);

  useEffect(() => {
    if (state !== 'ok' || !data || !calc || !boxRef.current) return undefined;
    const dates = data.d, n = dates.length;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: { background: { color: '#0B1220' }, textColor: '#94A3B8', panes: { separatorColor: '#1E293B' }, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(148,163,184,0.07)' }, horzLines: { color: 'rgba(148,163,184,0.07)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1E293B' },
      timeScale: { borderColor: '#1E293B', rightOffset: 4, barSpacing: 8 },
    });
    chartRef.current = chart;

    // ---- 主圖 ----
    const ohlc = dates.map((t, i) => ({ time: t, open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i] }));
    let main;
    if (prefs.type === 'line') main = chart.addSeries(LineSeries, { color: '#60A5FA', lineWidth: 2 }, 0);
    else if (prefs.type === 'area') main = chart.addSeries(AreaSeries, { lineColor: '#60A5FA', topColor: 'rgba(96,165,250,0.35)', bottomColor: 'rgba(96,165,250,0.02)' }, 0);
    else if (prefs.type === 'bar') main = chart.addSeries(BarSeries, { upColor: UP, downColor: DN }, 0);
    else main = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DN, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN }, 0);
    main.setData(prefs.type === 'line' || prefs.type === 'area' ? dates.map((t, i) => ({ time: t, value: data.c[i] })) : ohlc);

    MA_DEFS.filter(({ n: k }) => prefs.ma.includes(k)).forEach(({ n: k, color }) => {
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0)
        .setData(toLine(dates, calc.m[k]));
    });
    if (prefs.boll) {
      [['upper', '#64748B'], ['mid', '#64748B'], ['lower', '#64748B']].forEach(([k, color], j) => {
        chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: j === 1 ? LineStyle.Dotted : LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0)
          .setData(toLine(dates, calc.boll[k]));
      });
    }
    if (prefs.hilo) {
      const hi = Math.max(...data.h.slice(-252)), lo = Math.min(...data.l.slice(-252));
      const hi20 = Math.max(...data.h.slice(-21, -1));
      main.createPriceLine({ price: hi, color: '#F59E0B', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '52週高' });
      main.createPriceLine({ price: lo, color: '#38BDF8', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: '52週低' });
      if (hi20 && hi20 < hi) main.createPriceLine({ price: hi20, color: '#A78BFA', lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: '20日高' });
    }
    (req.levels || []).forEach((lv) => main.createPriceLine({
      price: lv.price, color: lv.color || '#FDE047', lineStyle: LineStyle.Solid, lineWidth: 1, axisLabelVisible: true, title: lv.label || '',
    }));

    // ---- 回測 / 交易進出點標記與波段軌跡線 ----
    const normDateStr = (s) => {
      if (!s) return '';
      const str = String(s).trim().replace(/\//g, '-').slice(0, 10);
      if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
      return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : '';
    };
    const findBarIdx = (targetStr) => {
      const nd = normDateStr(targetStr);
      if (!nd || !dates.length) return -1;
      const exact = dates.indexOf(nd);
      if (exact >= 0) return exact;
      const next = dates.findIndex((d) => d >= nd);
      return next >= 0 ? next : dates.length - 1;
    };
    const getAlignedPx = (rawPx, barIdx, field = 'o') => {
      if (barIdx < 0 || barIdx >= n) return null;
      const barPx = data[field]?.[barIdx] ?? data.c[barIdx];
      const numPx = Number(rawPx);
      if (numPx > 0 && barPx > 0 && numPx / barPx >= 0.7 && numPx / barPx <= 1.4) {
        return numPx;
      }
      return barPx;
    };

    const allMarkers = [];
    if (prefs.signals && prefs.ma.includes(5) && prefs.ma.includes(20)) {
      ind.crossovers(calc.m[5], calc.m[20]).forEach(({ i, dir }) => {
        allMarkers.push({
          time: dates[i], position: dir > 0 ? 'belowBar' : 'aboveBar', shape: dir > 0 ? 'arrowUp' : 'arrowDown',
          color: dir > 0 ? UP : DN, text: dir > 0 ? '金' : '死',
        });
      });
    }

    const tradeList = Array.isArray(req.trades) && req.trades.length > 0
      ? req.trades
      : (req.trade ? [req.trade] : []);
    let focusTradeRange = null;

    tradeList.forEach((tr) => {
      const eIdx = findBarIdx(tr.entry_date);
      const hasExit = tr.exit_date && !String(tr.exit_date).includes('持有');
      const xIdx = hasExit ? findBarIdx(tr.exit_date) : -1;
      const retVal = Number(tr.return_pct ?? tr.pnl_pct ?? tr.period_ret ?? tr.period_ret_pct ?? 0);
      const isPrimary = req.trade && (tr === req.trade || (tr.entry_date === req.trade.entry_date && tr.exit_date === req.trade.exit_date));
      const isReentry = Boolean(tr.is_reentry || String(tr.role || tr.tier || '').includes('回馬槍'));

      if (eIdx >= 0) {
        allMarkers.push({
          time: dates[eIdx],
          position: 'belowBar',
          shape: 'arrowUp',
          color: isReentry ? '#FB923C' : '#FBBF24',
          size: isPrimary ? 2 : 1,
          text: `${isReentry ? '🔥 回馬槍買進' : '🟢 買進'} ${dates[eIdx]}${tr.entry_price ? ` @$${fmt(tr.entry_price)}` : ''}`,
        });
      }
      if (xIdx >= 0) {
        allMarkers.push({
          time: dates[xIdx],
          position: 'aboveBar',
          shape: 'arrowDown',
          color: retVal >= 0 ? '#38BDF8' : '#F472B6',
          size: isPrimary ? 2 : 1,
          text: `🎯 出場 ${dates[xIdx]}${tr.exit_price ? ` @$${fmt(tr.exit_price)}` : ''} (${retVal >= 0 ? '+' : ''}${retVal.toFixed(1)}%)`,
        });
      }

      if (eIdx >= 0) {
        const ePx = getAlignedPx(tr.entry_price, eIdx, 'o');
        const endIdx = xIdx >= eIdx ? xIdx : Math.min(n - 1, eIdx + 25);
        const xPx = xIdx >= 0 ? getAlignedPx(tr.exit_price, xIdx, 'o') : data.c[n - 1];
        if (ePx != null && xPx != null && endIdx > eIdx) {
          chart.addSeries(LineSeries, {
            color: retVal >= 0 ? (isReentry ? '#FB923C' : '#FBBF24') : '#F472B6',
            lineWidth: isPrimary ? 2 : 2,
            lineStyle: LineStyle.Dashed,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }, 0).setData([
            { time: dates[eIdx], value: ePx },
            { time: dates[endIdx], value: xPx },
          ]);
        }
        if (isPrimary) {
          if (ePx != null) {
            main.createPriceLine({
              price: ePx,
              color: isReentry ? '#FB923C' : '#FBBF24',
              lineStyle: LineStyle.Dashed,
              lineWidth: 2,
              axisLabelVisible: true,
              title: `${isReentry ? '🔥 回馬槍' : '🟢 買進'} $${fmt(tr.entry_price || ePx)}`,
            });
          }
          if (xIdx >= 0 && xPx != null) {
            main.createPriceLine({
              price: xPx,
              color: retVal >= 0 ? '#38BDF8' : '#F472B6',
              lineStyle: LineStyle.Dashed,
              lineWidth: 2,
              axisLabelVisible: true,
              title: `🎯 出場 $${fmt(tr.exit_price || xPx)} (${retVal >= 0 ? '+' : ''}${retVal.toFixed(1)}%)`,
            });
          }
          // 若同檔股票在前後 100 根 K 棒內有二波回馬槍或首波交易，自動將視野涵蓋兩波完整走勢
          let minBar = eIdx;
          let maxBar = endIdx;
          tradeList.forEach((other) => {
            const oe = findBarIdx(other.entry_date);
            const ox = other.exit_date ? findBarIdx(other.exit_date) : oe;
            if (oe >= 0 && Math.abs(oe - eIdx) <= 120) {
              minBar = Math.min(minBar, oe);
              if (ox >= oe) maxBar = Math.max(maxBar, ox);
            }
          });
          const span = Math.max(15, maxBar - minBar);
          const pad = Math.max(25, Math.round(span * 0.35));
          focusTradeRange = { from: Math.max(0, minBar - pad), to: Math.min(n + 2, maxBar + pad) };
        }
      }
    });

    if (allMarkers.length > 0) {
      allMarkers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      createSeriesMarkers(main, allMarkers);
    }

    // 對數座標只套用在主圖 (副圖的量/買賣超含 0 或負值，不可用對數)
    chart.priceScale('right', 0).applyOptions({ mode: prefs.log ? 1 : 0 });

    // ---- 副圖 ----
    const mk = (opts, pane, extra = {}) => chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...opts }, pane);
    const hist = (pane, vals, colorFn) => chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
      .setData(dates.map((t, i) => ({ time: t, value: vals[i] ?? 0, color: colorFn(vals[i] ?? 0, i) })));
    const guide = (s, price, color = '#475569') => s.createPriceLine({ price, color, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });

    subs.forEach((key, idx) => {
      const pane = idx + 1;
      if (key === 'vol') {
        hist(pane, data.v, (_, i) => ((data.c[i] >= (data.o[i] ?? data.c[i])) ? UP : DN) + 'CC');
        VMA_DEFS.filter(({ n: k }) => prefs.vma.includes(k)).forEach(({ n: k, color }) => mk({ color }, pane).setData(toLine(dates, calc.vm[k])));
      } else if (key === 'rev') {
        const revArr = data.rev || [];
        const yoyArr = data.rev_yoy || [];
        const ma3Arr = data.rev_ma3 || [];
        const ma12Arr = data.rev_ma12 || [];
        chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
          .setData(dates.map((t, i) => (revArr[i] == null ? { time: t } : {
            time: t,
            value: revArr[i],
            color: ((yoyArr[i] ?? 0) >= 0 ? UP : DN) + '99',
          })));
        mk({ color: '#FBBF24', lineWidth: 2 }, pane).setData(toLine(dates, ma3Arr));
        mk({ color: '#A78BFA', lineWidth: 2 }, pane).setData(toLine(dates, ma12Arr));
        if (yoyArr.some((x) => x != null)) {
          const yoyS = mk({ color: '#38BDF8', lineWidth: 1, priceScaleId: 'left' }, pane);
          yoyS.setData(toLine(dates, yoyArr));
          guide(yoyS, 0, '#475569');
          chart.priceScale('left', pane).applyOptions({ visible: true, borderColor: '#1E293B' });
        }
      } else if (key === 'eps') {
        const epsQArr = data.eps_q || [];
        const epsTtmArr = data.eps_ttm || [];
        const peArr = data.pe || [];
        const epsHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        epsHist.setData(dates.map((t, i) => (epsQArr[i] == null ? { time: t } : {
          time: t,
          value: epsQArr[i],
          color: (epsQArr[i] >= 0 ? UP : DN) + 'BB',
        })));
        guide(epsHist, 0, '#64748B');
        if (epsTtmArr.some((x) => x != null)) {
          mk({ color: '#FBBF24', lineWidth: 2 }, pane).setData(toLine(dates, epsTtmArr));
        }
        if (peArr.some((x) => x != null && x > 0)) {
          mk({ color: '#2DD4BF', lineWidth: 1, lineStyle: LineStyle.Dashed, priceScaleId: 'left' }, pane).setData(toLine(dates, peArr));
          chart.priceScale('left', pane).applyOptions({ visible: true, borderColor: '#1E293B' });
        }
      } else if (key === 'kd') {
        const K = mk({ color: '#FBBF24' }, pane); K.setData(toLine(dates, calc.kd.K));
        mk({ color: '#38BDF8' }, pane).setData(toLine(dates, calc.kd.D));
        guide(K, 80); guide(K, 20);
        if (prefs.signals) createSeriesMarkers(K, ind.crossovers(calc.kd.K, calc.kd.D).map(({ i, dir }) => ({
          time: dates[i], position: dir > 0 ? 'belowBar' : 'aboveBar', shape: dir > 0 ? 'arrowUp' : 'arrowDown', color: dir > 0 ? UP : DN,
        })));
      } else if (key === 'macd') {
        hist(pane, calc.macd.hist.map((x) => x ?? 0), (x) => (x >= 0 ? UP : DN) + 'CC');
        const dif = mk({ color: '#FBBF24' }, pane); dif.setData(toLine(dates, calc.macd.dif));
        mk({ color: '#38BDF8' }, pane).setData(toLine(dates, calc.macd.dea));
        if (prefs.signals) createSeriesMarkers(dif, ind.crossovers(calc.macd.dif, calc.macd.dea).map(({ i, dir }) => ({
          time: dates[i], position: dir > 0 ? 'belowBar' : 'aboveBar', shape: dir > 0 ? 'arrowUp' : 'arrowDown', color: dir > 0 ? UP : DN,
        })));
      } else if (key === 'rsi') {
        const r6 = mk({ color: '#FBBF24' }, pane); r6.setData(toLine(dates, calc.rsi6));
        mk({ color: '#A78BFA' }, pane).setData(toLine(dates, calc.rsi14));
        guide(r6, 70); guide(r6, 30);
      } else if (key === 'bias') {
        const b = mk({ color: '#FBBF24' }, pane); b.setData(toLine(dates, calc.bias5));
        mk({ color: '#F472B6' }, pane).setData(toLine(dates, calc.bias20));
        mk({ color: '#34D399' }, pane).setData(toLine(dates, calc.bias60));
        guide(b, 0);
      } else if (key === 'dmi') {
        mk({ color: '#EF4444' }, pane).setData(toLine(dates, calc.dmi.pdi));
        mk({ color: '#22C55E' }, pane).setData(toLine(dates, calc.dmi.mdi));
        mk({ color: '#FBBF24', lineWidth: 2 }, pane).setData(toLine(dates, calc.dmi.adx));
      } else if (key === 'wr') {
        const w = mk({ color: '#38BDF8' }, pane); w.setData(toLine(dates, calc.wr)); guide(w, -20); guide(w, -80);
      } else if (key === 'obv') {
        mk({ color: '#60A5FA', lineWidth: 2 }, pane).setData(toLine(dates, calc.obv));
      } else if (key === 'atr') {
        mk({ color: '#F59E0B', lineWidth: 2 }, pane).setData(toLine(dates, calc.atr));
      } else if (key === 'fi' || key === 'tr' || key === 'de') {
        hist(pane, data[key], (x) => (x >= 0 ? UP : DN) + 'DD');
      } else if (key === 'mg') {
        mk({ color: '#F472B6', lineWidth: 2 }, pane).setData(toLine(dates, data.mb.map((x) => x ?? null)));
        mk({ color: '#38BDF8', lineWidth: 2, priceScaleId: 'left' }, pane).setData(toLine(dates, data.sb.map((x) => x ?? null)));
        chart.priceScale('left', pane).applyOptions({ visible: true, borderColor: '#1E293B' });
      }
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(4);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1.2);

    // 可視範圍 (保留使用者縮放；若有傳入回測交易則優先聚焦該筆交易進出場區間；否則依 prefs.range)
    const want = rangeRef.current || focusTradeRange || (prefs.range ? { from: n - prefs.range, to: n + 3 } : null);
    if (want) chart.timeScale().setVisibleLogicalRange(want); else chart.timeScale().fitContent();
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r) rangeRef.current = r; });

    // ---- 價量分布 (Volume Profile)：主圖右側水平直方圖，與股價軸對齊 ----
    const cv = profRef.current;
    const drawProfile = () => {
      if (!cv || !boxRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const W = boxRef.current.clientWidth, H = boxRef.current.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // 繪製各副圖左上角指標浮水印標籤 (讓使用者一眼辨識墊在底下的月營收、EPS等副圖)
      let accY = panes[0] ? panes[0].getHeight() : 0;
      const paneTitleMap = {
        vol: '📊 成交量 (張) · 黃MV5 / 粉MV20',
        rev: '📈 月營收 (億·右軸) · 黃3M均 / 紫12M均 (黃金交叉=營收拐點) · 藍線YoY年增%(左軸)',
        eps: '💰 單季EPS (元·柱狀右軸) · 黃線近四季累計EPS (右軸) · 青虛線本益比PE (左軸)',
        kd: '⚡ KD 隨機指標 (K9, D3)',
        macd: '📉 MACD (12, 26, 9)',
        rsi: '🧭 RSI 相對強弱 (6, 14)',
        bias: '📏 均線乖離率 BIAS (5, 20, 60)',
        dmi: '🎯 DMI / ADX 趨向指標',
        wr: '📐 威廉指標 %R (14)',
        obv: '🌊 OBV 能量潮',
        atr: '🎢 ATR 真實波幅 (14)',
        fi: '🏦 外資買賣超 (張)',
        tr: '🏦 投信買賣超 (張)',
        de: '🏦 自營商買賣超 (張)',
        mg: '💳 融資餘額 (粉·右軸) / 融券餘額 (藍·左軸)',
      };
      let leftAxisW = 0;
      try { leftAxisW = chart.priceScale('left').width(); } catch (e) { leftAxisW = 0; }
      const labelX = Math.max(10, leftAxisW + 8);
      for (let pIdx = 1; pIdx < panes.length; pIdx++) {
        const pH = panes[pIdx]?.getHeight() || 0;
        const sKey = subs[pIdx - 1];
        const titleTxt = paneTitleMap[sKey] || sKey;
        if (pH > 18 && titleTxt) {
          g.save();
          g.font = 'bold 11px sans-serif';
          const tw = g.measureText(titleTxt).width;
          g.fillStyle = 'rgba(15, 23, 42, 0.78)';
          g.fillRect(labelX - 4, accY + 4, tw + 10, 16);
          g.fillStyle = sKey === 'rev' ? '#38BDF8' : (sKey === 'eps' ? '#FBBF24' : '#94A3B8');
          g.textAlign = 'left';
          g.fillText(titleTxt, labelX, accY + 15);
          g.restore();
        }
        accY += pH;
      }
      if (!prefs.profile) return;
      const lr = chart.timeScale().getVisibleLogicalRange();
      let a = 0, b = n - 1;
      if (prefs.profWin === 'visible') { if (lr) { a = Math.max(0, Math.floor(lr.from)); b = Math.min(n - 1, Math.ceil(lr.to)); } }
      else if (prefs.profWin > 0) a = Math.max(0, n - prefs.profWin);
      if (b - a < 1) return;
      let lo = Infinity, hi = -Infinity;
      for (let k = a; k <= b; k++) { lo = Math.min(lo, data.l[k]); hi = Math.max(hi, data.h[k]); }
      const B = prefs.profBins, step = (hi - lo) / B;
      if (!(step > 0)) return;
      const up = new Array(B).fill(0), dn = new Array(B).fill(0);
      for (let k = a; k <= b; k++) { // 單日成交量依 K 棒高低區間均分到各價格帶
        const i0 = Math.min(B - 1, Math.floor((data.l[k] - lo) / step));
        const i1 = Math.min(B - 1, Math.floor((data.h[k] - lo) / step));
        const share = (data.v[k] || 0) / (i1 - i0 + 1);
        const arr = data.c[k] >= (data.o[k] ?? data.c[k]) ? up : dn;
        for (let j = i0; j <= i1; j++) arr[j] += share;
      }
      const tot = up.map((x, j) => x + dn[j]);
      const mx = Math.max(...tot);
      if (!(mx > 0)) return;
      // POC 與 70% 價值區 (Value Area)
      const poc = tot.indexOf(mx);
      const sum = tot.reduce((x, y) => x + y, 0);
      let vaLo = poc, vaHi = poc, acc = tot[poc];
      while (acc < sum * 0.7 && (vaLo > 0 || vaHi < B - 1)) {
        const dnV = vaLo > 0 ? tot[vaLo - 1] : -1, upV = vaHi < B - 1 ? tot[vaHi + 1] : -1;
        if (upV >= dnV) { vaHi++; acc += tot[vaHi]; } else { vaLo--; acc += tot[vaLo]; }
      }
      const paneH = panes[0] ? panes[0].getHeight() : H;
      let axisW = 0; try { axisW = chart.priceScale('right').width(); } catch (e) { axisW = 56; }
      const xR = W - axisW - 2, maxW = Math.max(80, (W - axisW) * 0.3);
      g.save(); g.beginPath(); g.rect(0, 0, W, paneH); g.clip();
      const vaLoP = lo + vaLo * step, vaHiP = lo + (vaHi + 1) * step;
      const yA = main.priceToCoordinate(vaHiP), yB = main.priceToCoordinate(vaLoP);
      if (yA != null && yB != null) { // 成交密集區 (70% 量) 淡色橫帶貫穿主圖
        g.fillStyle = 'rgba(250,204,21,0.07)'; g.fillRect(0, Math.min(yA, yB), xR, Math.abs(yB - yA));
        g.strokeStyle = 'rgba(250,204,21,0.35)'; g.setLineDash([2, 4]); g.lineWidth = 1;
        [yA, yB].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(xR, y); g.stroke(); });
        g.setLineDash([]);
      }
      const winLabel = prefs.profWin === 'visible' ? '顯示區間' : prefs.profWin === 0 ? '全部' : `近${prefs.profWin}日`;
      g.fillStyle = '#FDE047'; g.font = 'bold 11px sans-serif'; g.textAlign = 'right';
      g.fillText(`${winLabel}累積成交密集區 ${vaLoP.toFixed(1)} ~ ${vaHiP.toFixed(1)}（70%量）`, xR, 14);
      for (let j = 0; j < B; j++) {
        const y1 = main.priceToCoordinate(lo + j * step), y2 = main.priceToCoordinate(lo + (j + 1) * step);
        if (y1 == null || y2 == null) continue;
        const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y1 - y2) - 1);
        const inVA = j >= vaLo && j <= vaHi;
        const wDn = (dn[j] / mx) * maxW, wUp = (up[j] / mx) * maxW;
        g.globalAlpha = inVA ? 0.85 : 0.45;
        g.fillStyle = DN; g.fillRect(xR - wDn - wUp, top, wDn, h);
        g.fillStyle = UP; g.fillRect(xR - wUp, top, wUp, h);
      }
      g.globalAlpha = 1;
      const yp = main.priceToCoordinate(lo + (poc + 0.5) * step);
      if (yp != null) {
        g.strokeStyle = '#FDE047'; g.setLineDash([4, 3]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(xR - maxW, yp); g.lineTo(xR, yp); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#FDE047'; g.font = '10px monospace'; g.textAlign = 'right';
        g.fillText(`POC ${(lo + (poc + 0.5) * step).toFixed(2)}`, xR - maxW - 4, yp + 3);
      }
      g.restore();
    };
    const redraw = () => requestAnimationFrame(drawProfile);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    let sig = '';
    const timer = setInterval(() => { // 偵測座標/尺寸變化才重畫
      const lr = chart.timeScale().getVisibleLogicalRange();
      const sg = `${lr ? lr.from.toFixed(2) + lr.to.toFixed(2) : ''}|${boxRef.current?.clientWidth}|${boxRef.current?.clientHeight}|${main.priceToCoordinate(data.c[n - 1])}|${main.priceToCoordinate(data.c[0])}`;
      if (sg !== sig) { sig = sg; drawProfile(); }
    }, 120);
    redraw();

    const idxOf = new Map(dates.map((d, i) => [d, i]));
    chart.subscribeCrosshairMove((p) => setHover(p.time ? (idxOf.get(p.time) ?? null) : null));
    return () => {
      clearInterval(timer);
      chart.remove(); chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, data, calc, prefs.type, prefs.ma, prefs.vma, prefs.boll, prefs.hilo, prefs.signals, prefs.log, prefs.profile, prefs.profWin, prefs.profBins, subs, UP, DN]);

  const applyRange = (r) => {
    if (r.n === 0 && prefs.days < 6000) { // 「全部」：重新向本機 API 取完整歷史
      rangeRef.current = null;
      setP({ range: 0, days: 6000 });
      return;
    }
    setP({ range: r.n });
    const c = chartRef.current;
    if (!c || !data) return;
    const n = data.d.length;
    const lr = r.n ? { from: n - r.n, to: n + 3 } : { from: 0, to: n + 3 };
    rangeRef.current = lr; c.timeScale().setVisibleLogicalRange(lr);
  };

  const focusTrade = () => {
    if (!req.trade || !data || !chartRef.current) return;
    const dates = data.d, n = dates.length;
    const norm = (s) => (s ? String(s).trim().replace(/\//g, '-').slice(0, 10) : '');
    const findIdx = (s) => {
      const nd = norm(s);
      if (!nd) return -1;
      const ex = dates.indexOf(nd);
      if (ex >= 0) return ex;
      const nx = dates.findIndex((d) => d >= nd);
      return nx >= 0 ? nx : n - 1;
    };
    const eIdx = findIdx(req.trade.entry_date);
    if (eIdx < 0) return;
    const hasExit = req.trade.exit_date && !String(req.trade.exit_date).includes('持有');
    const xIdx = hasExit ? findIdx(req.trade.exit_date) : Math.min(n - 1, eIdx + 25);
    const endIdx = Math.max(eIdx + 5, xIdx);
    const pad = Math.max(25, Math.round((endIdx - eIdx) * 0.45));
    const lr = { from: Math.max(0, eIdx - pad), to: Math.min(n + 2, endIdx + pad) };
    rangeRef.current = lr;
    chartRef.current.timeScale().setVisibleLogicalRange(lr);
  };

  // ---- legend ----
  const i = hover ?? (data ? data.d.length - 1 : 0);
  const legend = data && calc ? (() => {
    const chg = i > 0 ? data.c[i] - data.c[i - 1] : 0;
    const pct = i > 0 ? (chg / data.c[i - 1]) * 100 : 0;
    const col = chg >= 0 ? UP : DN;
    return { chg, pct, col };
  })() : null;

  const subLegend = (key) => {
    if (!calc) return null;
    const g = (a) => fmt(a?.[i]);
    const parts = {
      vol: [[`量`, fmt(data.v[i], 0), '#E2E8F0'], ...VMA_DEFS.filter((d) => prefs.vma.includes(d.n)).map((d) => [`MV${d.n}`, fmt(calc.vm[d.n][i], 0), d.color])],
      rev: [
        [data.rev_ym?.[i] ? `[${data.rev_ym[i]}]單月` : '單月', data.rev?.[i] != null ? `${fmt(data.rev[i], 2)}億` : '-', '#E2E8F0'],
        ['YoY', data.rev_yoy?.[i] != null ? `${data.rev_yoy[i] >= 0 ? '+' : ''}${fmt(data.rev_yoy[i], 1)}%` : '-', (data.rev_yoy?.[i] ?? 0) >= 0 ? UP : DN],
        ['3M均', data.rev_ma3?.[i] != null ? `${fmt(data.rev_ma3[i], 2)}億` : '-', '#FBBF24'],
        ['12M均', data.rev_ma12?.[i] != null ? `${fmt(data.rev_ma12[i], 2)}億` : '-', '#A78BFA'],
      ],
      eps: [
        [data.eps_q_label?.[i] ? `[${data.eps_q_label[i]}]單季` : '單季', data.eps_q?.[i] != null ? `${fmt(data.eps_q[i], 2)}元` : '-', (data.eps_q?.[i] ?? 0) >= 0 ? UP : DN],
        ['近四季TTM', data.eps_ttm?.[i] != null ? `${fmt(data.eps_ttm[i], 2)}元` : '-', '#FBBF24'],
        ['PE', data.pe?.[i] != null ? `${fmt(data.pe[i], 1)}倍` : '-', '#2DD4BF'],
      ],
      kd: [['K', g(calc.kd.K), '#FBBF24'], ['D', g(calc.kd.D), '#38BDF8']],
      macd: [['DIF', g(calc.macd.dif), '#FBBF24'], ['DEA', g(calc.macd.dea), '#38BDF8'], ['柱', g(calc.macd.hist), '#E2E8F0']],
      rsi: [['RSI6', g(calc.rsi6), '#FBBF24'], ['RSI14', g(calc.rsi14), '#A78BFA']],
      bias: [['5日', g(calc.bias5), '#FBBF24'], ['20日', g(calc.bias20), '#F472B6'], ['60日', g(calc.bias60), '#34D399']],
      dmi: [['+DI', g(calc.dmi.pdi), '#EF4444'], ['-DI', g(calc.dmi.mdi), '#22C55E'], ['ADX', g(calc.dmi.adx), '#FBBF24']],
      wr: [['%R', g(calc.wr), '#38BDF8']], obv: [['OBV', fmt(calc.obv[i], 0), '#60A5FA']], atr: [['ATR', g(calc.atr), '#F59E0B']],
      fi: [['外資(張)', fmt(data.fi?.[i], 0), '#E2E8F0']], tr: [['投信(張)', fmt(data.tr?.[i], 0), '#E2E8F0']],
      de: [['自營(張)', fmt(data.de?.[i], 0), '#E2E8F0']],
      mg: [['融資', fmt(data.mb?.[i], 0), '#F472B6'], ['融券', fmt(data.sb?.[i], 0), '#38BDF8']],
    }[key] || [];
    return parts;
  };

  const tradeRet = req.trade ? Number(req.trade.return_pct ?? req.trade.pnl_pct ?? req.trade.period_ret ?? req.trade.period_ret_pct ?? 0) : null;

  return (
    <div onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,6,23,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '96vw', height: '94vh', background: '#0F172A', border: '1px solid rgba(96,165,250,0.35)', borderRadius: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 標題列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0.9rem', borderBottom: '1px solid #1E293B', flexWrap: 'wrap' }}>
          <strong style={{ color: '#F1F5F9', fontSize: '1.05rem' }}>{req.name || data?.name || req.ticker} <span style={{ color: '#64748B', fontSize: '0.8rem' }}>{req.ticker}</span></strong>
          {data && legend && (
            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: legend.col, fontWeight: 'bold' }}>
              {fmt(data.c[i])} {legend.chg >= 0 ? '▲' : '▼'} {fmt(Math.abs(legend.chg))} ({legend.pct >= 0 ? '+' : ''}{legend.pct.toFixed(2)}%)
            </span>
          )}
          {data && <span style={{ fontSize: '0.7rem', color: '#64748B' }}>本機資料庫 · 最新 {data.last_date} · 共 {data.d.length} 日</span>}
          <span style={{ flex: 1 }} />
          {req.trade && (
            <button type="button" onClick={focusTrade} style={{ cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', padding: '3px 10px', borderRadius: '4px', border: '1px solid #F59E0B', background: 'rgba(245, 158, 11, 0.2)', color: '#FDE68A' }}>
              🎯 聚焦進出場點
            </button>
          )}
          <button type="button" onClick={load} style={{ cursor: 'pointer', fontSize: '0.75rem', padding: '3px 9px', borderRadius: '4px', border: '1px solid #334155', background: '#1E293B', color: '#CBD5E1' }}>↻ 重新整理</button>
          <button type="button" onClick={onClose} style={{ cursor: 'pointer', fontSize: '0.9rem', padding: '1px 9px', borderRadius: '4px', border: '1px solid #334155', background: '#1E293B', color: '#CBD5E1' }}>✕</button>
        </div>

        {/* 回測交易進出點復盤橫幅 (若有傳入 trade 才顯示) */}
        {req.trade && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem 1.2rem',
            padding: '0.45rem 0.9rem', background: 'linear-gradient(90deg, rgba(245,158,11,0.14) 0%, rgba(56,189,248,0.12) 100%)',
            borderBottom: '1px solid rgba(245,158,11,0.35)', fontSize: '0.78rem'
          }}>
            <span style={{ fontWeight: 'bold', color: '#FDE68A' }}>📍 回測進出點 K 線復盤：</span>
            <span style={{ fontFamily: 'monospace', color: '#FBBF24', fontWeight: 'bold' }}>
              🟢 買進：{req.trade.entry_date} {req.trade.entry_price ? `@ $${fmt(req.trade.entry_price)}` : ''}
            </span>
            <span style={{ color: '#64748B' }}>➔</span>
            <span style={{ fontFamily: 'monospace', color: tradeRet >= 0 ? '#38BDF8' : '#F472B6', fontWeight: 'bold' }}>
              🎯 出場：{req.trade.exit_date || '持有中'} {req.trade.exit_price ? `@ $${fmt(req.trade.exit_price)}` : ''}
            </span>
            {tradeRet != null && (
              <span style={{
                fontFamily: 'monospace', fontWeight: 'bold', padding: '1px 7px', borderRadius: '4px',
                background: tradeRet >= 0 ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)',
                color: tradeRet >= 0 ? '#34D399' : '#F87171', border: `1px solid ${tradeRet >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}`
              }}>
                單筆報酬：{tradeRet >= 0 ? '+' : ''}{tradeRet.toFixed(2)}%
              </span>
            )}
            {req.trade.holding_days != null && (
              <span style={{ color: '#CBD5E1', fontFamily: 'monospace' }}>⏱️ 持有 {req.trade.holding_days} 天</span>
            )}
            {(req.trade.exit_reason || req.trade.role) && (
              <span style={{ color: '#93C5FD' }}>📌 {req.trade.exit_reason || req.trade.role}</span>
            )}
          </div>
        )}

        {/* 工具列 */}
        <div style={{ display: 'flex', gap: '0.35rem 0.9rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.4rem 0.9rem', borderBottom: '1px solid #1E293B' }}>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>圖形</span>
            {TYPES.map((t) => <Chip key={t.k} on={prefs.type === t.k} onClick={() => setP({ type: t.k })}>{t.l}</Chip>)}
          </span>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>均線</span>
            {MA_DEFS.map(({ n, color }) => <Chip key={n} on={prefs.ma.includes(n)} color={color} onClick={() => toggleIn('ma', n)}>MA{n}</Chip>)}
          </span>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>量均</span>
            {VMA_DEFS.map(({ n, color }) => <Chip key={n} on={prefs.vma.includes(n)} color={color} onClick={() => toggleIn('vma', n)}>MV{n}</Chip>)}
          </span>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>疊圖</span>
            <Chip on={prefs.boll} onClick={() => setP({ boll: !prefs.boll })}>布林通道</Chip>
            <Chip on={prefs.hilo} onClick={() => setP({ hilo: !prefs.hilo })}>52週高低</Chip>
            <Chip on={prefs.signals} onClick={() => setP({ signals: !prefs.signals })}>交叉訊號</Chip>
            <Chip on={prefs.log} onClick={() => setP({ log: !prefs.log })}>對數座標</Chip>
            <Chip on={prefs.profile} color="#FDE047" onClick={() => setP({ profile: !prefs.profile })}>價量分布</Chip>
            {prefs.profile && (
              <>
                {[[20, '近1月'], [60, '近3月'], [120, '近半年'], [250, '近1年'], ['visible', '顯示區間']].map(([w, l]) => (
                  <Chip key={l} on={prefs.profWin === w} color="#FDE047" onClick={() => setP({ profWin: w })}>{l}</Chip>
                ))}
                {[30, 50, 80].map((b) => <Chip key={b} on={prefs.profBins === b} onClick={() => setP({ profBins: b })}>{b}檔</Chip>)}
              </>
            )}
            <Chip on={upIsRed} onClick={() => setP({ upColor: upIsRed ? 'green' : 'red' })}>{upIsRed ? '紅漲綠跌' : '綠漲紅跌'}</Chip>
          </span>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>副圖</span>
            {SUBS.filter((s) => !s.tw || isTW).map((s) => <Chip key={s.key} on={prefs.subs.includes(s.key)} onClick={() => toggleIn('subs', s.key)}>{s.label}</Chip>)}
          </span>
          <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <span style={{ color: '#64748B', fontSize: '0.7rem' }}>區間</span>
            {RANGES.map((r) => <Chip key={r.l} on={prefs.range === r.n} onClick={() => applyRange(r)}>{r.l}</Chip>)}
          </span>
        </div>

        {/* 數值列 (跟隨十字游標) */}
        {data && calc && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.15rem 0.9rem', padding: '0.3rem 0.9rem', fontFamily: 'monospace', fontSize: '0.72rem', borderBottom: '1px solid #1E293B', color: '#94A3B8' }}>
            <span>{data.d[i]}</span>
            <span>開 <b style={{ color: '#E2E8F0' }}>{fmt(data.o[i])}</b></span>
            <span>高 <b style={{ color: '#E2E8F0' }}>{fmt(data.h[i])}</b></span>
            <span>低 <b style={{ color: '#E2E8F0' }}>{fmt(data.l[i])}</b></span>
            <span>收 <b style={{ color: legend?.col }}>{fmt(data.c[i])}</b></span>
            <span>量 <b style={{ color: '#E2E8F0' }}>{fmt(data.v[i], 0)}{isTW ? '張' : ''}</b></span>
            {MA_DEFS.filter((d) => prefs.ma.includes(d.n)).map((d) => (
              <span key={d.n} style={{ color: d.color }}>MA{d.n} {fmt(calc.m[d.n][i])}</span>
            ))}
            {prefs.boll && <span style={{ color: '#94A3B8' }}>布林 {fmt(calc.boll.upper[i])}/{fmt(calc.boll.mid[i])}/{fmt(calc.boll.lower[i])}</span>}
            {subs.map((k) => (
              <span key={k} style={{ borderLeft: '1px solid #334155', paddingLeft: '0.6rem' }}>
                <span style={{ color: '#64748B' }}>{SUBS.find((s) => s.key === k)?.label} </span>
                {subLegend(k).map(([nm, val, color]) => <span key={nm} style={{ color, marginRight: '0.5rem' }}>{nm} {val}</span>)}
              </span>
            ))}
          </div>
        )}

        {/* 圖表 */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div ref={boxRef} style={{ position: 'absolute', inset: 0 }} />
          <canvas ref={profRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 5 }} />
          {state !== 'ok' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: state === 'error' ? '#FCA5A5' : '#94A3B8', padding: '2rem', textAlign: 'center', background: '#0B1220' }}>
              {state === 'loading' ? '從本機資料庫讀取中…' : `⚠️ ${err}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StockChartHost = () => {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const h = (e) => e.detail?.ticker && setReq(e.detail);
    window.addEventListener(EVT, h);
    return () => window.removeEventListener(EVT, h);
  }, []);
  const modalKey = req ? `${req.ticker}_${req.trade?.entry_date || ''}_${req.trade?.exit_date || ''}` : '';
  return req ? <StockChartModal key={modalKey} req={req} onClose={() => setReq(null)} /> : null;
};

export default StockChartHost;
