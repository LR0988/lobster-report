import React, { useState, useEffect, useMemo, useRef } from 'react';
import defaultData from '../data/defaultComplementaryV3Data.json';
import twStockNamesMap from '../data/tw_stock_names_map.json';
import {
  getCurrentUser,
  apiGetComplementaryV3Dashboard,
  apiGetComplementaryV3Portfolio,
  apiSaveComplementaryV3Portfolio,
} from '../api';
import { StockChartButton } from './StockChart';

const STORAGE_PREFIX = 'comp_v3_state_v1';

const getStorageKeys = (username) => ({
  tx: `${STORAGE_PREFIX}_tx_${username}`,
  fx: `${STORAGE_PREFIX}_fx_${username}`,
  dismissed: `${STORAGE_PREFIX}_dismissed_${username}`,
});

const TEMPLATE_INIT_TX = {
  id: 'tx_v3_init_cash',
  date: '2026-01-02',
  action: '投入現金',
  ticker: '-',
  name: 'V3 互補戰艦初始本金',
  currency: 'TWD',
  shares: 0,
  price: 0,
  tax_fee: 0,
  cash_flow_twd: 1000000,
  realized_pnl_twd: null,
  realized_return_pct: null,
  note: '全球泰坦互補戰艦 V3 初始入金 NT$ 1,000,000（可在上方隨時存入或調整本金）',
};

const fmtNum = (n, d = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtTwd = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return 'NT$ --';
  const v = Math.round(Number(n));
  return `${v < 0 ? '-' : ''}NT$ ${Math.abs(v).toLocaleString('en-US')}`;
};

const fmtPct = (v, showPlus = true) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  const num = Number(v);
  return `${showPlus && num > 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const resolveDisplayName = (ticker, rawName) => {
  if (rawName && rawName !== ticker) return rawName;
  const clean = String(ticker || '').trim();
  const base = clean.split('.')[0];
  if (twStockNamesMap && twStockNamesMap[base]) {
    return `${twStockNamesMap[base]} (${clean})`;
  }
  return clean;
};

const calcFee = (ticker, action, shares, price) => {
  const isTw = String(ticker || '').endsWith('.TW');
  const gross = Number(shares) * Number(price);
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  if (isTw) {
    const comm = Math.max(20, gross * 0.001425 * 0.28);
    const tax = action === '賣出' || action === '減持' ? gross * 0.003 : 0;
    return Math.round(comm + tax);
  }
  return Math.round(gross * 0.0005 * 100) / 100;
};

const daysBetween = (d1, d2) => {
  try {
    const t1 = new Date(d1).getTime();
    const t2 = new Date(d2).getTime();
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
    return Math.max(0, Math.round((t2 - t1) / 86400000));
  } catch {
    return null;
  }
};

export default function GlobalComplementaryV3Dashboard({ onTriggerScraper, isScraperRunning }) {
  const currentUser = getCurrentUser();
  const username = currentUser?.username || 'hotpotlu';
  const keys = useMemo(() => getStorageKeys(username), [username]);

  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);
  const [sourceBadge, setSourceBadge] = useState('snapshot');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Navigation & View States
  const [engineLens, setEngineLens] = useState('v3_core'); // 'v3_core' | 'v3_champ' | 'barbell_50'
  const [stationView, setStationView] = useState('all'); // 'all' | 'tranche_a' | 'tranche_b' | 'tranche_c'
  const [picksTab, setPicksTab] = useState('tranches'); // 'tranches' | 'merged' | 'watchlist'
  const [prosecutorTab, setProsecutorTab] = useState('grid27'); // 'gate0' | 'loop1' | 'loo' | 'phase' | 'grid27' | 'harsh_jk'

  // Equity Chart States
  const [chartWindow, setChartWindow] = useState('2010'); // '2010' | '2005' | '5y' | '2022' | '2020' | '2008'
  const [chartLogScale, setChartLogScale] = useState(true);
  const [chartShowTitan, setChartShowTitan] = useState(false);
  const [chartHoverIdx, setChartHoverIdx] = useState(null);
  const svgRef = useRef(null);

  // History Explorer States
  const [histYearFilter, setHistYearFilter] = useState('ALL');
  const [histSearch, setHistSearch] = useState('');
  const [expandedYears, setExpandedYears] = useState({ 2026: true });

  // Follow-Trade Ledger State (Single Source of Truth: txHistory)
  const [usdFx, setUsdFx] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(keys.fx));
      return Number.isFinite(v) && v > 20 ? v : 32.5;
    } catch {
      return 32.5;
    }
  });
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(keys.tx) || 'null');
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {}
    return [TEMPLATE_INIT_TX];
  });
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(keys.dismissed) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [rebalMode, setRebalMode] = useState('full_100'); // 'full_100' | 'tranche_a' | 'tranche_b' | 'tranche_c'
  const [customEdits, setCustomEdits] = useState({});
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashAction, setCashAction] = useState('deposit');
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [exitModal, setExitModal] = useState({ open: false, pos: null, shares: '', price: '' });
  const [hydratedCloud, setHydratedCloud] = useState(false);

  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  // Persist user ledger locally + to local FastAPI when connected
  useEffect(() => {
    try {
      localStorage.setItem(keys.tx, JSON.stringify(txHistory));
      localStorage.setItem(keys.fx, String(usdFx));
      localStorage.setItem(keys.dismissed, JSON.stringify(dismissedSuggestions));
    } catch {}
    if (hydratedCloud) {
      apiSaveComplementaryV3Portfolio({
        username,
        usd_fx: usdFx,
        tx_history: txHistory,
        dismissed_suggestions: dismissedSuggestions,
      });
    }
  }, [txHistory, usdFx, dismissedSuggestions, keys, username, hydratedCloud]);

  const loadDashboard = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const [dash, port] = await Promise.all([
        apiGetComplementaryV3Dashboard(forceRefresh),
        forceRefresh ? Promise.resolve(null) : apiGetComplementaryV3Portfolio(username),
      ]);
      if (dash && dash.status === 'ok') {
        setData(dash);
        setSourceBadge(dash._source || 'local_api');
      } else {
        setSourceBadge('snapshot');
      }
      if (port && port.status === 'ok' && Array.isArray(port.tx_history) && port.tx_history.length > 0) {
        setTxHistory(port.tx_history);
        if (port.usd_fx) setUsdFx(Number(port.usd_fx));
        if (Array.isArray(port.dismissed_suggestions)) setDismissedSuggestions(port.dismissed_suggestions);
      }
    } finally {
      setHydratedCloud(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive Cash & Positions 100% from txHistory (Single Source of Truth)
  const { idleCash, userPositions } = useMemo(() => {
    let cash = 0;
    const posMap = {};
    const ordered = [...txHistory].reverse(); // process chronological oldest -> newest
    for (const tx of ordered) {
      cash += Number(tx.cash_flow_twd || 0);
      const act = tx.action;
      const tk = String(tx.ticker || '').trim();
      if (!tk || tk === '-') continue;
      const sh = Number(tx.shares || 0);
      const px = Number(tx.price || 0);
      const cur = tx.currency || (tk.endsWith('.TW') ? 'TWD' : 'USD');
      const fee = Number(tx.tax_fee || 0);
      if (act === '買進' || act === '加碼') {
        if (!posMap[tk]) {
          posMap[tk] = {
            ticker: tk,
            name: tx.name || tk,
            currency: cur,
            shares: 0,
            totalCostCur: 0,
            entryFeeCur: 0,
            firstDate: tx.date,
          };
        }
        posMap[tk].shares += sh;
        posMap[tk].totalCostCur += sh * px + fee;
        posMap[tk].entryFeeCur += fee;
      } else if (act === '減持' || act === '賣出') {
        if (posMap[tk] && posMap[tk].shares > 0) {
          const sellSh = Math.min(sh, posMap[tk].shares);
          const ratio = sellSh / posMap[tk].shares;
          posMap[tk].totalCostCur *= (1 - ratio);
          posMap[tk].shares -= sellSh;
          if (posMap[tk].shares <= 1e-6) {
            delete posMap[tk];
          }
        }
      }
    }
    const liveMap = data?.live_prices || {};
    const posList = Object.values(posMap).map((p) => {
      const lt = liveMap[p.ticker];
      const livePx = lt ? Number(lt.price) : (p.shares > 0 ? p.totalCostCur / p.shares : 0);
      const avgEntry = p.shares > 0 ? p.totalCostCur / p.shares : 0;
      const fx = p.currency === 'USD' ? usdFx : 1;
      const mvTwd = p.shares * livePx * fx;
      const costTwd = p.totalCostCur * fx;
      const unPnlTwd = mvTwd - costTwd;
      const retPct = costTwd > 0 ? (unPnlTwd / costTwd) * 100 : 0;
      return {
        ...p,
        name: resolveDisplayName(p.ticker, p.name || lt?.name),
        entry_price: avgEntry,
        current_price: livePx,
        price_date: lt?.date || data?.latest_data_date,
        market_value_twd: mvTwd,
        cost_twd: costTwd,
        unrealized_pnl_twd: unPnlTwd,
        unrealized_ret_pct: retPct,
      };
    });
    return { idleCash: cash, userPositions: posList };
  }, [txHistory, data, usdFx]);

  const totalMarketValueTwd = useMemo(
    () => userPositions.reduce((s, p) => s + Number(p.market_value_twd || 0), 0),
    [userPositions]
  );
  const totalNetAssetsTwd = idleCash + totalMarketValueTwd;
  const totalInvestedPrincipal = useMemo(
    () => txHistory.filter((t) => t.action === '投入現金').reduce((s, t) => s + Number(t.cash_flow_twd || 0), 0),
    [txHistory]
  );
  const totalNetProfitTwd = totalNetAssetsTwd - totalInvestedPrincipal;
  const totalNetProfitPct = totalInvestedPrincipal > 0 ? (totalNetProfitTwd / totalInvestedPrincipal) * 100 : 0;
  const userExposurePct = totalNetAssetsTwd > 0 ? (totalMarketValueTwd / totalNetAssetsTwd) * 100 : 0;

  // Tranches Data
  const tranches = data?.official_active_tranches || {};
  const trA = tranches.tranche_a || {};
  const trB = tranches.tranche_b || {};
  const trC = tranches.tranche_c || {};
  const mergedHoldings = data?.merged_active_holdings || [];

  // Determine next upcoming rebalance across A/B/C
  const nextRebalCountdown = useMemo(() => {
    const todayStr = data?.latest_tw_date || data?.latest_data_date || '2026-11-18';
    const cands = [
      { id: 'A', label: '🅰️ A梯隊 (1/4/7/10)', next: trA.next_rebal_date },
      { id: 'B', label: '🅱️ B梯隊 (2/5/8/11)', next: trB.next_rebal_date },
      { id: 'C', label: '🅲 C梯隊 (3/6/9/12)', next: trC.next_rebal_date },
    ]
      .filter((x) => x.next && x.next !== '待排程')
      .map((x) => ({ ...x, days: daysBetween(todayStr, x.next) ?? 999 }))
      .sort((a, b) => a.days - b.days);
    return cands[0] || { label: '🅲 C梯隊', next: '2026-12-01', days: 13 };
  }, [trA, trB, trC, data]);

  // Follow-Trade Rebalance Suggestions Engine
  const targetPicksForCalc = useMemo(() => {
    if (rebalMode === 'tranche_a') {
      return (trA.picks || []).map((p) => ({ ...p, calcWeightPct: p.tranche_weight_pct }));
    }
    if (rebalMode === 'tranche_b') {
      return (trB.picks || []).map((p) => ({ ...p, calcWeightPct: p.tranche_weight_pct }));
    }
    if (rebalMode === 'tranche_c') {
      return (trC.picks || []).map((p) => ({ ...p, calcWeightPct: p.tranche_weight_pct }));
    }
    return mergedHoldings.map((m) => ({
      ...m,
      calcWeightPct: m.total_weight_pct,
      current_price: m.current_price,
    }));
  }, [rebalMode, trA, trB, trC, mergedHoldings]);

  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];
    const capitalBaseTwd = rebalMode === 'full_100' ? totalNetAssetsTwd : totalNetAssetsTwd / 3.0;
    const heldByTk = {};
    userPositions.forEach((p) => {
      heldByTk[p.ticker] = p;
    });

    const list = [];
    const targetTickers = new Set();
    for (const pk of targetPicksForCalc) {
      targetTickers.add(pk.ticker);
      const isTw = pk.ticker.endsWith('.TW');
      const currency = isTw ? 'TWD' : 'USD';
      const fx = isTw ? 1 : usdFx;
      const px = Number(pk.current_price || data?.live_prices?.[pk.ticker]?.price || pk.entry_price || 0);
      if (px <= 0) continue;

      const tgtValTwd = capitalBaseTwd * (Number(pk.calcWeightPct) / 100.0);
      const curHeld = heldByTk[pk.ticker];
      const curValTwd = curHeld ? curHeld.shares * px * fx : 0;
      const diffTwd = tgtValTwd - curValTwd;
      if (Math.abs(diffTwd) < Math.max(3000, capitalBaseTwd * 0.015)) continue;

      const rawDeltaShares = Math.abs(diffTwd) / (px * fx);
      const shares = isTw ? Math.max(100, Math.round(rawDeltaShares / 100) * 100) : Math.max(1, Math.round(rawDeltaShares));
      const action = !curHeld ? '買進' : diffTwd > 0 ? '加碼' : '減持';
      const key = `${rebalMode}_${action}_${pk.ticker}`;
      if (dismissedSuggestions.includes(key)) continue;

      list.push({
        key,
        ticker: pk.ticker,
        name: pk.name,
        market: pk.market,
        sector: pk.sector,
        currency,
        action,
        targetWeightPct: Number(pk.calcWeightPct).toFixed(2),
        price: px,
        shares,
        diffTwd,
        heldPos: curHeld,
      });
    }

    if (rebalMode === 'full_100') {
      for (const hp of userPositions) {
        if (!targetTickers.has(hp.ticker) && hp.shares > 0) {
          const key = `full_exit_${hp.ticker}`;
          if (dismissedSuggestions.includes(key)) continue;
          const px = Number(hp.current_price || hp.entry_price || 0);
          list.push({
            key,
            ticker: hp.ticker,
            name: hp.name,
            market: hp.ticker.endsWith('.TW') ? 'TW' : 'US',
            sector: '-',
            currency: hp.currency,
            action: '賣出',
            targetWeightPct: '0.00',
            price: px,
            shares: hp.shares,
            diffTwd: -hp.market_value_twd,
            heldPos: hp,
          });
        }
      }
    }
    return list;
  }, [targetPicksForCalc, userPositions, totalNetAssetsTwd, rebalMode, usdFx, dismissedSuggestions, data]);

  const executeSuggestion = (sugg) => {
    const ed = customEdits[sugg.key] || {};
    const shares = ed.shares !== undefined && ed.shares !== '' ? parseFloat(ed.shares) : sugg.shares;
    const price = ed.price !== undefined && ed.price !== '' ? parseFloat(ed.price) : sugg.price;
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
      alert('請輸入有效股數與成交價格');
      return;
    }
    const isUsd = sugg.currency === 'USD';
    const fx = isUsd ? usdFx : 1;
    const fee = calcFee(sugg.ticker, sugg.action, shares, price);
    const today = data?.latest_data_date || new Date().toISOString().split('T')[0];

    if (sugg.action === '買進' || sugg.action === '加碼') {
      const totalCostTwd = (shares * price + fee) * fx;
      if (totalCostTwd > idleCash + 500) {
        alert(`閒置現金不足！需 ${fmtTwd(totalCostTwd)}，目前可用 ${fmtTwd(idleCash)}`);
        return;
      }
      setTxHistory((prev) => [
        {
          id: `tx_${Date.now()}_${sugg.ticker}`,
          date: today,
          action: sugg.action,
          ticker: sugg.ticker,
          name: sugg.name,
          currency: sugg.currency,
          shares,
          price,
          tax_fee: fee,
          cash_flow_twd: -Math.round(totalCostTwd),
          realized_pnl_twd: null,
          realized_return_pct: null,
          note: `V3 ${rebalMode} ${sugg.action} ${shares} 股 (目標 ${sugg.targetWeightPct}%)`,
        },
        ...prev,
      ]);
      triggerNotice(`✅ 已完成【${sugg.action}】${sugg.ticker} ${shares} 股！`);
    } else {
      const grossTwd = shares * price * fx;
      const netCashTwd = grossTwd - fee * fx;
      const ep = sugg.heldPos?.entry_price || price;
      const netPnlTwd = Math.round(((price - ep) * shares - fee) * fx);
      const costBasis = ep * shares * fx;
      const retPct = costBasis > 0 ? Math.round((netPnlTwd / costBasis) * 1000) / 10 : 0;
      setTxHistory((prev) => [
        {
          id: `tx_${Date.now()}_${sugg.ticker}`,
          date: today,
          action: sugg.action,
          ticker: sugg.ticker,
          name: sugg.name,
          currency: sugg.currency,
          shares,
          price,
          tax_fee: fee,
          cash_flow_twd: Math.round(netCashTwd),
          realized_pnl_twd: netPnlTwd,
          realized_return_pct: retPct,
          note: `V3 ${rebalMode} ${sugg.action} ${shares} 股 (實現 ${fmtTwd(netPnlTwd)})`,
        },
        ...prev,
      ]);
      triggerNotice(`🚪 已完成【${sugg.action}】${sugg.ticker} ${shares} 股！`);
    }
    setDismissedSuggestions((prev) => [...prev, sugg.key]);
  };

  const handleSaveCashModal = (e) => {
    e.preventDefault();
    const amt = parseFloat(cashAmountInput);
    if (!Number.isFinite(amt)) {
      alert('請輸入有效金額');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const delta = cashAction === 'deposit' ? amt : amt - idleCash;
    setTxHistory((prev) => [
      {
        id: `tx_cash_${Date.now()}`,
        date: today,
        action: '投入現金',
        ticker: '-',
        name: '資金帳戶',
        currency: 'TWD',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: Math.round(delta),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: cashAction === 'deposit' ? `追加投入 ${fmtTwd(amt)}` : `重設帳戶現金為 ${fmtTwd(amt)}`,
      },
      ...prev,
    ]);
    setCashModalOpen(false);
    setCashAmountInput('');
    triggerNotice('✅ 資金帳戶已更新！');
  };

  const handleConfirmExitModal = (e) => {
    e.preventDefault();
    if (!exitModal.pos) return;
    const pos = exitModal.pos;
    const sh = parseFloat(exitModal.shares);
    const px = parseFloat(exitModal.price);
    if (!Number.isFinite(sh) || sh <= 0 || sh > pos.shares + 1e-4 || !Number.isFinite(px) || px <= 0) {
      alert('請輸入有效賣出股數與價格');
      return;
    }
    const act = sh >= pos.shares - 1e-4 ? '賣出' : '減持';
    const isUsd = pos.currency === 'USD';
    const fx = isUsd ? usdFx : 1;
    const fee = calcFee(pos.ticker, act, sh, px);
    const netCashTwd = Math.round((sh * px - fee) * fx);
    const netPnlTwd = Math.round(((px - pos.entry_price) * sh - fee) * fx);
    const costBasis = pos.entry_price * sh * fx;
    const retPct = costBasis > 0 ? Math.round((netPnlTwd / costBasis) * 1000) / 10 : 0;
    const today = data?.latest_data_date || new Date().toISOString().split('T')[0];
    setTxHistory((prev) => [
      {
        id: `tx_sell_${Date.now()}`,
        date: today,
        action: act,
        ticker: pos.ticker,
        name: pos.name,
        currency: pos.currency,
        shares: sh,
        price: px,
        tax_fee: fee,
        cash_flow_twd: netCashTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: retPct,
        note: `手動${act} ${pos.ticker} ${sh} 股`,
      },
      ...prev,
    ]);
    setExitModal({ open: false, pos: null, shares: '', price: '' });
    triggerNotice(`🚪 已${act} ${pos.ticker} ${sh} 股（實現 ${fmtTwd(netPnlTwd)}）`);
  };

  // Normalized Equity Chart Series
  const chartData = useMemo(() => {
    const raw = data?.equity_curves || [];
    if (raw.length < 5) return { points: [], minY: 0.8, maxY: 2.0 };
    const startCutoffMap = {
      '2010': '2010-01-04',
      '2005': '2005-03-01',
      '5y': '2021-11-16',
      '2022': '2022-01-03',
      '2020': '2020-01-02',
      '2008': '2007-10-01',
    };
    const cut = startCutoffMap[chartWindow] || '2010-01-04';
    const endCut = chartWindow === '2008' ? '2009-12-31' : chartWindow === '2020' ? '2021-12-31' : chartWindow === '2022' ? '2023-06-30' : '2099-12-31';
    const sub = raw.filter((pt) => pt.d >= cut && pt.d <= endCut);
    if (sub.length < 5) return { points: [], minY: 0.8, maxY: 2.0 };

    const base = sub[0];
    const seriesKeys = ['v3_core', 'v3_champ', 'bb50_sa', 'bb70_q', 'spy', ...(chartShowTitan ? ['titan'] : [])];
    const pts = sub.map((row) => {
      const out = { d: row.d };
      seriesKeys.forEach((k) => {
        out[k] = Number(row[k]) / Math.max(Number(base[k]), 1e-6);
      });
      return out;
    });

    let lo = Infinity;
    let hi = -Infinity;
    pts.forEach((p) => {
      seriesKeys.forEach((k) => {
        const val = chartLogScale ? Math.log10(Math.max(p[k], 0.05)) : p[k];
        if (val < lo) lo = val;
        if (val > hi) hi = val;
      });
    });
    const pad = (hi - lo) * 0.08 || 0.1;
    return { points: pts, minY: lo - pad, maxY: hi + pad, keys: seriesKeys };
  }, [data, chartWindow, chartLogScale, chartShowTitan]);

  // Filtered Yearly History
  const filteredYearly = useMemo(() => {
    const yh = data?.yearly_history || [];
    const q = histSearch.trim().toUpperCase();
    return yh
      .filter((row) => histYearFilter === 'ALL' || String(row.year) === String(histYearFilter))
      .map((row) => {
        if (!q) return row;
        const matchedRbs = (row.rebalances || []).filter((rb) =>
          (rb.picks || []).some(
            (pk) =>
              String(pk.ticker).toUpperCase().includes(q) ||
              String(pk.name || '').toUpperCase().includes(q)
          )
        );
        return { ...row, rebalances: matchedRbs };
      })
      .filter((row) => !histSearch.trim() || (row.rebalances || []).length > 0);
  }, [data, histYearFilter, histSearch]);

  // Active KPI summary by selected lens
  const kpis = data?.kpis || {};
  const core10 = kpis.v3_core?.era_2010_2026 || {};
  const coreEx26 = kpis.v3_core?.era_2010_2025_ex26 || {};
  const core05 = kpis.v3_core?.era_2005_2026 || {};
  const champ10 = kpis.v3_champ?.era_2010_2026 || {};
  const champ05 = kpis.v3_champ?.era_2005_2026 || {};
  const bb50sa = kpis.barbells?.bb50_sa?.era_2010_2026 || {};
  const bb50sa05 = kpis.barbells?.bb50_sa?.era_2005_2026 || {};
  const bb70q = kpis.barbells?.bb70_q?.era_2010_2026 || {};
  const spy10 = kpis.spy?.era_2010_2026 || {};
  const pa = data?.prosecutor_audit || {};

  const activeLensCards = useMemo(() => {
    if (engineLens === 'v3_champ') {
      return [
        { lbl: 'V3_Champ 10–26 年化', val: `${champ10.cagr ?? 15.51}%`, sub: `${champ10.mult ?? 11.38}x ｜ Ex26 ${kpis.v3_champ?.era_2010_2025_ex26?.cagr ?? 14.07}%`, col: '#34D399' },
        { lbl: '05–26 全22年實股年化', val: `${champ05.cagr ?? 14.24}%`, sub: `${champ05.mult ?? 18.02}x ｜ mMDD ${champ05.m_mdd ?? -22.42}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${champ10.m_mdd ?? -14.27}% / ${champ10.d_mdd ?? -17.57}%`, sub: 'SOV3-sv12 下行護盾', col: '#FBBF24' },
        { lbl: 'Sharpe / Calmar', val: `${champ10.sharpe ?? 1.37} / ${champ10.calmar ?? 1.09}`, sub: `2008海嘯 -12.97% ｜ 2022 -0.27%`, col: '#A78BFA' },
        { lbl: 'vs Titan 獨立度', val: `ExSPY +0.058`, sub: `持股重疊 0.09% ｜ 0 空倉期`, col: '#6EE7B7' },
      ];
    }
    if (engineLens === 'barbell_50') {
      return [
        { lbl: '50/50 泰坦×V3Core (SA)', val: `${bb50sa.cagr ?? 33.94}%`, sub: `${bb50sa.mult ?? 138.14}x ｜ 70/30 Q 達 ${bb70q.cagr ?? 38.79}%`, col: '#F59E0B' },
        { lbl: '05–26 全22年槓鈴年化', val: `${bb50sa05.cagr ?? 30.86}%`, sub: `mMDD ${bb50sa05.m_mdd ?? -20.66}% ｜ 70/30 達 ${kpis.barbells?.bb70_q?.era_2005_2026?.cagr ?? 35.94}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${bb50sa.m_mdd ?? -14.05}% / ${bb50sa.d_mdd ?? -23.97}%`, sub: '優於 R2 雙艙 dMDD -28.13%', col: '#34D399' },
        { lbl: 'Sharpe / Calmar', val: `${bb50sa.sharpe ?? 1.57} / ${bb50sa.calmar ?? 2.42}`, sub: `50/50×Champ 夏普達 1.59`, col: '#A78BFA' },
        { lbl: '再平衡紅利 & 重疊', val: `0 檔撞車`, sub: `雙策略獨立選股・17/17 勝零危機崩盤`, col: '#6EE7B7' },
      ];
    }
    return [
      { lbl: 'V3_Core 10–26 年化', val: `${core10.cagr ?? 18.19}%`, sub: `${core10.mult ?? 16.75}x ｜ Ex26 ${coreEx26.cagr ?? 17.00}% (SPY ${spy10.cagr ?? 13.79}%)`, col: '#34D399' },
      { lbl: '05–26 全22年實股年化', val: `${core05.cagr ?? 15.31}%`, sub: `${core05.mult ?? 22.03}x ｜ 06–09 100% 滿倉實股`, col: '#38BDF8' },
      { lbl: '10–26 mMDD / dMDD', val: `${core10.m_mdd ?? -22.86}% / ${core10.d_mdd ?? -27.76}%`, sub: `優於 R2 V2B (-27.68% / -37.52%)`, col: '#FBBF24' },
      { lbl: 'Sharpe / Calmar', val: `${core10.sharpe ?? 1.26} / ${core10.calmar ?? 0.80}`, sub: `Sortino ${core10.sortino ?? 1.84} ｜ 勝大盤 ${core10.beat_spy ?? '11/17'} 年`, col: '#A78BFA' },
      { lbl: 'vs Titan 正交度', val: `ExSPY ${kpis.v3_core?.corr_ex_spy_vs_titan ?? -0.026}`, sub: `每日重疊 ${kpis.v3_core?.mean_weight_overlap_pct ?? 0.2}% ｜ 當期 ${kpis.v3_core?.active_overlap_count ?? 0} 檔重疊`, col: '#6EE7B7' },
    ];
  }, [engineLens, core10, coreEx26, core05, champ10, champ05, bb50sa, bb50sa05, bb70q, spy10, kpis]);

  const renderTrancheCard = (tObj, accentColor) => {
    const picks = tObj?.picks || [];
    return (
      <div className="glass-card" style={{ padding: '1rem', borderTop: `3px solid ${accentColor}`, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.98rem', color: accentColor }}>{tObj.tranche_name || '梯隊'}</div>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8', marginTop: '2px' }}>
              訊號日 <strong>{tObj.rebal_date}</strong> ➔ 進場 <strong>{tObj.entry_date}</strong> ｜ 下次換倉 <strong style={{ color: '#FDE047' }}>{tObj.next_rebal_date}</strong>
            </div>
          </div>
          <span style={{ fontSize: '0.72rem', background: 'rgba(16,185,129,0.16)', color: '#34D399', padding: '2px 8px', borderRadius: '99px', border: '1px solid rgba(16,185,129,0.35)', fontWeight: 'bold' }}>
            {picks.length} 檔滿倉 ({tObj.exposure_pct || 100}%)
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>#</th>
                <th>標的</th>
                <th>板塊</th>
                <th style={{ textAlign: 'right' }}>梯隊%</th>
                <th style={{ textAlign: 'right' }}>總倉%</th>
                <th style={{ textAlign: 'right' }}>進場開盤</th>
                <th style={{ textAlign: 'right' }}>最新現價</th>
                <th style={{ textAlign: 'right' }}>股價報酬</th>
                <th style={{ textAlign: 'right' }}>合意/四柱Z</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((pk) => {
                const isUp = Number(pk.price_ret_pct ?? pk.period_ret_pct) >= 0;
                const retShow = pk.price_ret_pct ?? pk.period_ret_pct;
                return (
                  <tr key={`${tObj.tranche_id}_${pk.ticker}`}>
                    <td>{pk.rank}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <StockChartButton
                          ticker={pk.ticker}
                          name={pk.name}
                          trade={{ entry_date: pk.entry_date, entry_price: pk.entry_price, exit_date: '持有中', exit_price: pk.current_price }}
                        />
                        <div>
                          <div style={{ fontWeight: 'bold', color: pk.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{pk.ticker}</div>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pk.name}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.69rem', color: '#CBD5E1' }}>{pk.sector}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(pk.tranche_weight_pct, 1)}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>{fmtNum(pk.total_portfolio_weight_pct, 1)}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(pk.entry_price, 2)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{fmtNum(pk.current_price, 2)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isUp ? '#F87171' : '#34D399' }}>
                      {fmtPct(retShow)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.68rem', color: '#CBD5E1' }}>
                      <strong style={{ color: '#FDE047' }}>{fmtNum(pk.composite, 2)}</strong>
                      <div style={{ color: '#64748B' }}>G{fmtNum(pk.z_grw, 1)} C{fmtNum(pk.z_cbop, 1)} S{fmtNum(pk.z_solv, 1)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: '0.72rem', color: '#94A3B8', background: 'rgba(0,0,0,0.22)', padding: '0.45rem 0.65rem', borderRadius: '5px' }}>
          💡 {tObj.previous_rebal_note}
        </div>
      </div>
    );
  };

  // Interactive SVG Polyline Path Generator
  const renderEquitySvg = () => {
    const { points, minY, maxY } = chartData;
    if (!points || points.length < 2) return null;
    const W = 1000;
    const H = 310;
    const padL = 56;
    const padR = 18;
    const padT = 18;
    const padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const toX = (i) => padL + (i / (points.length - 1)) * plotW;
    const toY = (v) => {
      const val = chartLogScale ? Math.log10(Math.max(v, 0.05)) : v;
      return padT + (1 - (val - minY) / Math.max(maxY - minY, 1e-6)) * plotH;
    };

    const mkPath = (k) =>
      points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(pt[k]).toFixed(1)}`).join(' ');

    const seriesMeta = [
      { key: 'bb70_q', label: '70/30 泰坦×V3_Core (Q)', color: '#F59E0B', width: 2.2 },
      { key: 'bb50_sa', label: '50/50 泰坦×V3_Core (SA)', color: '#38BDF8', width: 2.4 },
      { key: 'v3_core', label: 'V3_Core 純股旗艦', color: '#34D399', width: 2.6 },
      { key: 'v3_champ', label: 'V3_Champ 全天候(sv12)', color: '#A78BFA', width: 2.0 },
      { key: 'spy', label: 'SPY 大盤基準', color: '#94A3B8', width: 1.5, dash: '4,4' },
      ...(chartShowTitan ? [{ key: 'titan', label: 'Global Titan R26-GOLD', color: '#F43F5E', width: 1.8, dash: '6,3' }] : []),
    ];

    const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((frac) => {
      const yRaw = minY + frac * (maxY - minY);
      const mult = chartLogScale ? Math.pow(10, yRaw) : yRaw;
      return { y: padT + (1 - frac) * plotH, lbl: `${mult >= 10 ? mult.toFixed(0) : mult.toFixed(1)}x` };
    });

    const hoverPt = chartHoverIdx !== null && points[chartHoverIdx] ? points[chartHoverIdx] : points[points.length - 1];

    const handleMouseMove = (e) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      const frac = Math.max(0, Math.min(1, (relX - padL) / plotW));
      setChartHoverIdx(Math.round(frac * (points.length - 1)));
    };

    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.9rem', fontSize: '0.76rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: '#94A3B8' }}>日期：<strong style={{ color: '#F8FAFC' }}>{hoverPt?.d}</strong></span>
          {seriesMeta.map((s) => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: s.color, fontWeight: 'bold' }}>
              <span style={{ width: '12px', height: '3px', background: s.color, display: 'inline-block' }} />
              {s.label}: <span style={{ fontFamily: 'monospace' }}>{hoverPt ? `${hoverPt[s.key].toFixed(2)}x (${((hoverPt[s.key] - 1) * 100).toFixed(1)}%)` : '--'}</span>
            </span>
          ))}
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setChartHoverIdx(null)}
          style={{ width: '100%', height: '310px', background: 'rgba(15,23,42,0.55)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', cursor: 'crosshair' }}
        >
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="rgba(148,163,184,0.14)" strokeDasharray="3,3" />
              <text x={padL - 6} y={t.y + 4} textAnchor="end" fill="#94A3B8" fontSize="11" fontFamily="monospace">{t.lbl}</text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
            const idxPt = Math.min(points.length - 1, Math.round(f * (points.length - 1)));
            return (
              <text key={i} x={toX(idxPt)} y={H - 8} textAnchor="middle" fill="#94A3B8" fontSize="10" fontFamily="monospace">
                {points[idxPt]?.d?.slice(0, 7)}
              </text>
            );
          })}
          {seriesMeta.map((s) => (
            <path
              key={s.key}
              d={mkPath(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeDasharray={s.dash || 'none'}
            />
          ))}
          {chartHoverIdx !== null && (
            <line
              x1={toX(chartHoverIdx)}
              y1={padT}
              x2={toX(chartHoverIdx)}
              y2={H - padB}
              stroke="rgba(248,250,252,0.45)"
              strokeDasharray="3,3"
            />
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="global-sovereign-dashboard" style={{ paddingBottom: '3rem', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {feedbackMsg && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
          background: 'rgba(16, 185, 129, 0.95)', color: '#FFF', padding: '0.75rem 1.2rem',
          borderRadius: '8px', fontWeight: 'bold', boxShadow: '0 8px 25px rgba(0,0,0,0.45)',
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* =================================================================
          1. 頂部戰情總覽與雙重 KPI (Strategy Backtest + Live User Account)
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.1rem 1.3rem', borderTop: '3px solid #10B981' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.85rem' }}>
          <div style={{ flex: '1 1 520px' }}>
            <h3 style={{ margin: 0, color: '#34D399', fontSize: '1.22rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              🛡️ {data?.strategy_name}
              <span style={{ fontSize: '0.72rem', background: sourceBadge === 'local_api' ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)', color: sourceBadge === 'local_api' ? '#6EE7B7' : '#93C5FD', padding: '2px 8px', borderRadius: '99px', border: '1px solid rgba(16,185,129,0.35)' }}>
                {sourceBadge === 'local_api' ? '🟢 直連本機 tw_stock.db 實時報價' : sourceBadge === 'supabase_cache' ? '☁️ Supabase 雲端同步快照' : '📦 內建出廠快照'}
              </span>
            </h3>
            <div style={{ fontSize: '0.79rem', color: '#CBD5E1', marginTop: '0.35rem' }}>{data?.strategy_subtitle}</div>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              股池規格：{data?.universe_desc} ｜ 美股最新: <strong>{data?.latest_us_date}</strong> ・ 台股最新: <strong>{data?.latest_tw_date}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.76rem', color: '#94A3B8', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '0.3rem 0.6rem', borderRadius: '6px' }}>
              USD/TWD
              <input
                type="number"
                step="0.1"
                value={usdFx}
                onChange={(e) => setUsdFx(parseFloat(e.target.value) || 32.5)}
                style={{ width: '54px', background: 'transparent', border: 'none', color: '#FDE047', fontWeight: 'bold', textAlign: 'right' }}
              />
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => { setCashAction('deposit'); setCashModalOpen(true); }} style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}>
              💰 資金存入 / 調整
            </button>
            <button type="button" className="btn" onClick={() => loadDashboard(false)} disabled={loading} style={{ fontSize: '0.78rem', padding: '0.38rem 0.8rem' }}>
              {loading ? <span className="loader" style={{ width: '11px', height: '11px', borderWidth: '2px' }} /> : '🔄 同步最新報價'}
            </button>
            {onTriggerScraper && (
              <button type="button" className="btn btn-secondary" onClick={onTriggerScraper} disabled={isScraperRunning} style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}>
                {isScraperRunning ? '⏳ 抓盤中...' : '📥 抓取今日收盤'}
              </button>
            )}
          </div>
        </div>

        {/* Engine Lens Switcher */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', background: 'rgba(0,0,0,0.35)', padding: '4px', borderRadius: '8px' }}>
            {[
              { id: 'v3_core', label: `🚀 V3_Core 純股旗艦 (${core10.cagr ?? 18.19}% / Shp ${core10.sharpe ?? 1.26})` },
              { id: 'v3_champ', label: `🛡️ V3_Champ 全天候夏普王 (${champ10.cagr ?? 15.51}% / Shp ${champ10.sharpe ?? 1.37})` },
              { id: 'barbell_50', label: `⚡ 50/50 泰坦×V3 雙艙槓鈴 (${bb50sa.cagr ?? 33.94}% / Shp ${bb50sa.sharpe ?? 1.57})` },
            ].map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setEngineLens(l.id)}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.34rem 0.75rem',
                  fontSize: '0.77rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: engineLens === l.id ? 'linear-gradient(135deg, #10B981, #059669)' : 'transparent',
                  color: engineLens === l.id ? '#FFF' : '#94A3B8',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#6EE7B7' }}>
            ✅ Gen-2 守門員 B1~B5 稽核：{pa?.gatekeeper_b1_b5_report?.rebalance_periods_checked ?? 263} 期 / {pa?.gatekeeper_b1_b5_report?.total_picks_checked ?? 3156} 筆選股・0 違規 ｜ 2018 投毒測試 0.00e+00 洩漏
          </div>
        </div>

        {/* 5 Strategy KPI Cards + 5 User Live Account Strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '0.6rem', marginBottom: '0.7rem' }}>
          {activeLensCards.map((c, idx) => (
            <div key={idx} style={{ background: 'rgba(15,23,42,0.55)', borderRadius: '8px', padding: '0.65rem 0.8rem', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{c.lbl}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: c.col, fontFamily: 'monospace', marginTop: '2px' }}>{c.val}</div>
              <div style={{ fontSize: '0.69rem', color: '#CBD5E1', marginTop: '2px' }}>{c.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.55rem', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: '8px', padding: '0.6rem 0.85rem' }}>
          <div>
            <div style={{ fontSize: '0.69rem', color: '#94A3B8' }}>👤 我的帳戶總淨值 ({username})</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F8FAFC', fontFamily: 'monospace' }}>{fmtTwd(totalNetAssetsTwd)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.69rem', color: '#94A3B8' }}>💼 持倉總市值 ({userPositions.length} 檔)</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>{fmtTwd(totalMarketValueTwd)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.69rem', color: '#94A3B8' }}>💵 可用閒置現金</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#FDE047', fontFamily: 'monospace' }}>{fmtTwd(idleCash)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.69rem', color: '#94A3B8' }}>📈 累積帳面損益</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: totalNetProfitTwd >= 0 ? '#F87171' : '#34D399', fontFamily: 'monospace' }}>
              {fmtTwd(totalNetProfitTwd)} ({fmtPct(totalNetProfitPct)})
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.69rem', color: '#94A3B8' }}>⚖️ 實質持股曝險</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#A78BFA', fontFamily: 'monospace' }}>{userExposurePct.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* =================================================================
          2. 🧭 三梯隊季度錯峰時序導航與視角切換台
         ================================================================= */}
      <div className="glass-card" style={{ padding: '0.85rem 1.2rem', border: '1px solid rgba(56,189,248,0.28)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.76rem', color: '#FDE047', background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.4)', padding: '0.26rem 0.65rem', borderRadius: '5px', fontWeight: 'bold' }}>
              ⏳ 下次錯峰輪動：{nextRebalCountdown.label} ➔ {nextRebalCountdown.next}（倒數 {nextRebalCountdown.days} 天・每次僅輪動 1/3 資金）
            </span>
            <span style={{ fontSize: '0.75rem', color: '#A7F3D0', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', padding: '0.26rem 0.65rem', borderRadius: '5px' }}>
              🌐 與泰坦雙重隔離：動能限制 <strong>g5 &le; 85%</strong> ＋ 剔除公用事業/REITs ＋ 當期 {data?.titan_active_tickers?.length ?? 5} 檔泰坦 <strong>0 檔重疊</strong>
            </span>
          </div>

          <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '7px', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: '🌐 三梯隊合流總覽', mode: 'full_100', col: '#10B981' },
              { id: 'tranche_a', label: '🅰️ A梯 (1/4/7/10)', mode: 'tranche_a', col: '#0EA5E9' },
              { id: 'tranche_b', label: '🅱️ B梯 (2/5/8/11)', mode: 'tranche_b', col: '#A855F7' },
              { id: 'tranche_c', label: '🅲 C梯 (3/6/9/12)', mode: 'tranche_c', col: '#F59E0B' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => { setStationView(st.id); setRebalMode(st.mode); }}
                style={{
                  border: 'none',
                  borderRadius: '5px',
                  padding: '0.3rem 0.7rem',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: stationView === st.id ? st.col : 'transparent',
                  color: stationView === st.id ? '#FFF' : '#94A3B8',
                }}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.55rem', fontSize: '0.73rem', color: '#CBD5E1', background: 'rgba(0,0,0,0.28)', padding: '0.5rem 0.8rem', borderRadius: '6px' }}>
          <div><strong style={{ color: '#38BDF8' }}>① 四大無動能追高正交柱 (LOO 簡化認證)</strong>：37.5% 基本面成長斜率 (PEAD/ΔCbOP) ＋ 31.25% Ball(2016) 現金營業獲利 (CbOP) ＋ 18.75% 償債與 F-Score ＋ 12.5% FIP 連續性平滑度。</div>
          <div><strong style={{ color: '#34D399' }}>② 65/35 美台全球配額＋板塊防呆</strong>：每梯隊固定精選 <strong>8 美股＋4 台股</strong>（單一產業限 4 檔），徹底治癒傳統混合排序 92% 押注單一市場之結構失衡。</div>
          <div><strong style={{ color: '#A78BFA' }}>③ 緩衝鎖倉＋秩半方差加權 (RankInvSV)</strong>：舊持倉維持於各市場前 20 名 (`1.67x`) 內不換倉以節省摩擦；依名次傾角 × 下行半波動率倒數動態配重（上限 20%）。</div>
          <div><strong style={{ color: '#FBBF24' }}>④ 22 年全時代零空窗接軌</strong>：透過台股 22Y PE/CAPE/EPS 穩定度與美股 Pre-XBRL 股息濾網，實現 `2006–2026` 100% 滿倉實股運作（無需空倉避險）。</div>
        </div>
      </div>

      {/* =================================================================
          3. 🏛️ 當期官方三梯隊持倉 / 三隊合併總權重 / 候補雷達
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.1rem', borderTop: '3px solid #38BDF8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.05rem' }}>
            🏛️ V3_Core 當期標準實盤持倉 ({mergedHoldings.length} 檔不重複標的・台股約 {data?.kpis?.v3_core?.mean_tw_weight_pct ?? 30.4}%)
          </h4>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'tranches', label: '📋 三梯隊獨立明細 (A/B/C 各12檔)' },
              { id: 'merged', label: `🌐 合流總目標權重表 (${mergedHoldings.length} 檔 = 100%)` },
              { id: 'watchlist', label: '📡 非泰坦實體營運候補雷達' },
            ].map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => setPicksTab(tb.id)}
                className={picksTab === tb.id ? 'btn' : 'btn btn-secondary'}
                style={{ fontSize: '0.76rem', padding: '0.32rem 0.72rem' }}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>

        {picksTab === 'tranches' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '0.9rem' }}>
            {(stationView === 'all' || stationView === 'tranche_a') && renderTrancheCard(trA, '#0EA5E9')}
            {(stationView === 'all' || stationView === 'tranche_b') && renderTrancheCard(trB, '#A855F7')}
            {(stationView === 'all' || stationView === 'tranche_c') && renderTrancheCard(trC, '#F59E0B')}
          </div>
        )}

        {picksTab === 'merged' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>標的</th>
                  <th>市場 / 行業</th>
                  <th>涵蓋梯隊</th>
                  <th style={{ textAlign: 'right' }}>總組合目標權重</th>
                  <th style={{ textAlign: 'right' }}>最早進場日</th>
                  <th style={{ textAlign: 'right' }}>加權成本價</th>
                  <th style={{ textAlign: 'right' }}>最新市價</th>
                  <th style={{ textAlign: 'right' }}>股價報酬</th>
                  <th style={{ textAlign: 'right' }}>綜合 Z / 分項</th>
                  <th style={{ textAlign: 'center' }}>泰坦重疊</th>
                </tr>
              </thead>
              <tbody>
                {mergedHoldings.map((m) => {
                  const isUp = Number(m.price_ret_pct) >= 0;
                  return (
                    <tr key={m.ticker}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <StockChartButton ticker={m.ticker} name={m.name} trade={{ entry_date: m.earliest_entry_date, entry_price: m.avg_entry_price, exit_date: '持有中', exit_price: m.current_price }} />
                          <div>
                            <div style={{ fontWeight: 'bold', color: m.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{m.ticker}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{m.name}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.74rem' }}>{m.market} ・ {m.sector}</td>
                      <td>
                        {m.tranches.map((t) => (
                          <span key={t} style={{ display: 'inline-block', fontSize: '0.68rem', fontWeight: 'bold', padding: '1px 5px', borderRadius: '4px', marginRight: '3px', background: t === 'A' ? 'rgba(14,165,233,0.22)' : t === 'B' ? 'rgba(168,85,247,0.22)' : 'rgba(245,158,11,0.22)', color: '#F8FAFC' }}>
                            {t}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>{fmtNum(m.total_weight_pct, 2)}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{m.earliest_entry_date}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(m.avg_entry_price, 2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{fmtNum(m.current_price, 2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isUp ? '#F87171' : '#34D399' }}>{fmtPct(m.price_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                        <strong style={{ color: '#FDE047' }}>{fmtNum(m.composite, 2)}</strong> (G:{fmtNum(m.z_grw, 1)} C:{fmtNum(m.z_cbop, 1)} S:{fmtNum(m.z_solv, 1)} F:{fmtNum(m.z_fip, 1)})
                      </td>
                      <td style={{ textAlign: 'center' }}>{m.in_titan_active ? '⚠️ 重疊' : '✅ 0 重疊'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {picksTab === 'watchlist' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '1rem' }}>
            {[
              { title: '🇺🇸 美股 S&P 500 PIT 候補 Top 15 (g5 ≤ 85%)', list: data?.top_watchlist_candidates?.us || [] },
              { title: '🇹🇼 台股純上市 0050∪0051 PIT 候補 Top 12 (g5 ≤ 85%)', list: data?.top_watchlist_candidates?.tw || [] },
            ].map((grp) => (
              <div key={grp.title}>
                <div style={{ fontWeight: 'bold', color: '#93C5FD', marginBottom: '0.45rem', fontSize: '0.88rem' }}>{grp.title}</div>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>標的</th>
                      <th>行業</th>
                      <th style={{ textAlign: 'right' }}>現價</th>
                      <th style={{ textAlign: 'right' }}>G5動能分位</th>
                      <th style={{ textAlign: 'right' }}>V3合意Z</th>
                      <th style={{ textAlign: 'center' }}>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.list.map((w) => (
                      <tr key={w.ticker}>
                        <td>{w.rank}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <StockChartButton ticker={w.ticker} name={w.name} />
                            <div>
                              <strong style={{ color: w.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{w.ticker}</strong>
                              <span style={{ fontSize: '0.69rem', color: '#94A3B8', marginLeft: '5px' }}>{w.name}</span>
                            </div>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.7rem' }}>{w.sector}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(w.price, 2)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>{fmtNum(w.g5_pct, 1)}%</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{fmtNum(w.composite, 2)}</td>
                        <td style={{ textAlign: 'center' }}>{w.in_active ? '🟢 持倉中' : '⚪ 觀察中'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* =================================================================
          4. 🎯 跟單調倉建議與 💼 我的目前持股 & 交易流水帳
         ================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem' }}>
        {/* 跟單計算機 */}
        <div className="glass-card" style={{ padding: '1rem', borderTop: '3px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, color: '#FDE047' }}>🎯 V3 跟單下單計算機 ({rebalanceSuggestions.length} 筆建議)</h4>
            <select
              value={rebalMode}
              onChange={(e) => setRebalMode(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.28rem 0.55rem', fontSize: '0.76rem' }}
            >
              <option value="full_100">🌐 合流 100% 一鍵建倉 (18檔目標)</option>
              <option value="tranche_a">🅰️ 僅 A 梯隊建倉 (總資金 1/3)</option>
              <option value="tranche_b">🅱️ 僅 B 梯隊建倉 (總資金 1/3)</option>
              <option value="tranche_c">🅲 僅 C 梯隊建倉 (總資金 1/3)</option>
            </select>
          </div>

          {rebalanceSuggestions.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: '#34D399', padding: '1.2rem', textAlign: 'center', background: 'rgba(16,185,129,0.08)', borderRadius: '6px' }}>
              ✅ 目前持股已對齊所選梯隊目標權重，或待存入更多本金即可依建議執行！
            </div>
          ) : (
            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>動作</th>
                    <th>標的</th>
                    <th style={{ textAlign: 'right' }}>目標%</th>
                    <th style={{ textAlign: 'right' }}>股數</th>
                    <th style={{ textAlign: 'right' }}>價格</th>
                    <th style={{ textAlign: 'center' }}>執行</th>
                  </tr>
                </thead>
                <tbody>
                  {rebalanceSuggestions.map((s) => {
                    const ed = customEdits[s.key] || {};
                    return (
                      <tr key={s.key}>
                        <td>
                          <span style={{ fontWeight: 'bold', color: s.action === '賣出' || s.action === '減持' ? '#F87171' : '#34D399' }}>
                            {s.action}
                          </span>
                        </td>
                        <td>
                          <strong>{s.ticker}</strong>
                          <div style={{ fontSize: '0.67rem', color: '#94A3B8' }}>{s.name}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{s.targetWeightPct}%</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            value={ed.shares !== undefined ? ed.shares : s.shares}
                            onChange={(e) => setCustomEdits((p) => ({ ...p, [s.key]: { ...p[s.key], shares: e.target.value } }))}
                            style={{ width: '62px', textAlign: 'right', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.18)', color: '#FFF', borderRadius: '4px', padding: '2px 4px', fontSize: '0.74rem' }}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number"
                            step="0.01"
                            value={ed.price !== undefined ? ed.price : s.price}
                            onChange={(e) => setCustomEdits((p) => ({ ...p, [s.key]: { ...p[s.key], price: e.target.value } }))}
                            style={{ width: '68px', textAlign: 'right', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.18)', color: '#FFF', borderRadius: '4px', padding: '2px 4px', fontSize: '0.74rem' }}
                          />
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn" onClick={() => executeSuggestion(s)} style={{ fontSize: '0.7rem', padding: '2px 7px', marginRight: '4px' }}>
                            成交
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setDismissedSuggestions((p) => [...p, s.key])} style={{ fontSize: '0.68rem', padding: '2px 5px' }}>
                            略
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 我的目前持股 + 最近交易 */}
        <div className="glass-card" style={{ padding: '1rem', borderTop: '3px solid #6366F1' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: '#A5B4FC' }}>💼 我的實戰帳本持股 ({userPositions.length} 檔) 與流水紀錄 ({txHistory.length} 筆)</h4>
          {userPositions.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: '#94A3B8', padding: '1rem', background: 'rgba(0,0,0,0.22)', borderRadius: '6px', marginBottom: '0.75rem' }}>
              尚無實戰買進部位（目前 100% 現金 {fmtTwd(idleCash)} 待命），可於左側點擊「成交」開始建倉。
            </div>
          ) : (
            <div style={{ maxHeight: '210px', overflowY: 'auto', marginBottom: '0.8rem' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>標的</th>
                    <th style={{ textAlign: 'right' }}>股數</th>
                    <th style={{ textAlign: 'right' }}>均價</th>
                    <th style={{ textAlign: 'right' }}>現價</th>
                    <th style={{ textAlign: 'right' }}>未實現損益</th>
                    <th style={{ textAlign: 'center' }}>平倉</th>
                  </tr>
                </thead>
                <tbody>
                  {userPositions.map((p) => (
                    <tr key={p.ticker}>
                      <td>
                        <StockChartButton ticker={p.ticker} name={p.name} /> <strong>{p.ticker}</strong>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(p.shares, p.currency === 'TWD' ? 0 : 2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(p.entry_price, 2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(p.current_price, 2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: p.unrealized_pnl_twd >= 0 ? '#F87171' : '#34D399', fontWeight: 'bold' }}>
                        {fmtTwd(p.unrealized_pnl_twd)} ({fmtPct(p.unrealized_ret_pct)})
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setExitModal({ open: true, pos: p, shares: String(p.shares), price: String(p.current_price) })} style={{ fontSize: '0.68rem', padding: '2px 6px' }}>
                          賣出
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '0.73rem' }}>
            <table className="custom-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>動作</th>
                  <th>標的</th>
                  <th style={{ textAlign: 'right' }}>現金流(TWD)</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                {txHistory.slice(0, 15).map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'monospace' }}>{t.date}</td>
                    <td style={{ fontWeight: 'bold' }}>{t.action}</td>
                    <td>{t.ticker}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: Number(t.cash_flow_twd) >= 0 ? '#34D399' : '#FBBF24' }}>{fmtTwd(t.cash_flow_twd)}</td>
                    <td style={{ color: '#94A3B8', fontSize: '0.69rem' }}>{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* =================================================================
          5. 📈 互動式多策略累積淨值曲線與雙艙槓鈴壓力比較
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #A855F7' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, color: '#E9D5FF' }}>📈 累積淨值走勢對照（V3_Core × V3_Champ × 泰坦雙艙槓鈴 vs SPY 大盤）</h4>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { id: '2010', label: '2010–2026 主期' },
              { id: '2005', label: '2005–2026 全22年' },
              { id: '5y', label: '近5年' },
              { id: '2022', label: '2022 升息熊市' },
              { id: '2020', label: '2020 疫情輪動' },
              { id: '2008', label: '2008 海嘯-V轉' },
            ].map((w) => (
              <button
                key={w.id}
                type="button"
                className={chartWindow === w.id ? 'btn' : 'btn btn-secondary'}
                onClick={() => setChartWindow(w.id)}
                style={{ fontSize: '0.73rem', padding: '0.26rem 0.6rem' }}
              >
                {w.label}
              </button>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => setChartLogScale((x) => !x)} style={{ fontSize: '0.73rem', padding: '0.26rem 0.6rem' }}>
              {chartLogScale ? '📐 對數刻度' : '📏 線性刻度'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setChartShowTitan((x) => !x)} style={{ fontSize: '0.73rem', padding: '0.26rem 0.6rem' }}>
              {chartShowTitan ? '隱藏單泰坦母艦' : '疊加單泰坦 (630x)'}
            </button>
          </div>
        </div>

        {renderEquitySvg()}

        {/* 危機區間抗震表現總表 */}
        <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>歷史壓力區間</th>
                <th style={{ textAlign: 'right' }}>SPY 大盤</th>
                <th style={{ textAlign: 'right' }}>Global Titan</th>
                <th style={{ textAlign: 'right' }}>V3_Core (100%股)</th>
                <th style={{ textAlign: 'right' }}>V3_Champ (sv12)</th>
                <th style={{ textAlign: 'right' }}>50/50 泰坦×V3 (SA)</th>
                <th style={{ textAlign: 'right' }}>70/30 泰坦×V3 (Q)</th>
                <th style={{ textAlign: 'right' }}>50/50 泰坦×Champ</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'crash_2008', label: '2008 金融海嘯' },
                { key: 'mom_crash_2009_vturn', label: '2009 動能崩盤 V 轉' },
                { key: 'bear_2011', label: '2011 歐債熊市' },
                { key: 'q4_2018', label: '2018 Q4 急殺' },
                { key: 'covid_2020_q1', label: '2020 Q1 新冠熔斷' },
                { key: 'vaccine_rot_2020_11', label: '2020-11 疫苗價值輪動' },
                { key: 'bear_2022', label: '2022 升息股債雙殺' },
                { key: 'ytd_2026', label: '2026 YTD (截至 11/16)' },
              ].map((rg) => (
                <tr key={rg.key}>
                  <td><strong>{rg.label}</strong></td>
                  {['spy', 'titan', 'v3_core', 'v3_champ', 'bb50_sa', 'bb70_q', 'bb50_champ_sa'].map((sk) => {
                    const val = kpis?.regimes?.[sk]?.[rg.key];
                    return (
                      <td key={sk} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: sk === 'v3_core' || sk === 'bb50_sa' ? 'bold' : 'normal', color: val >= 0 ? '#34D399' : '#F87171' }}>
                        {fmtPct(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* =================================================================
          6. 📅 2005–2026 全 22 年 PIT 逐年績效與 263 期調倉溯源帳本
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #3B82F6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, color: '#93C5FD' }}>📅 2005–2026 全 22 年零空窗 PIT 逐年績效與逐筆明細帳本</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="搜尋股票代號或名稱 (如 2330 / AAPL)..."
              value={histSearch}
              onChange={(e) => setHistSearch(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '6px', padding: '0.3rem 0.65rem', fontSize: '0.76rem', width: '230px' }}
            />
            <select
              value={histYearFilter}
              onChange={(e) => setHistYearFilter(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.76rem' }}
            >
              <option value="ALL">全部年份 (2005–2026)</option>
              {(data?.yearly_history || []).map((y) => (
                <option key={y.year} value={String(y.year)}>{y.year} 年</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>年份</th>
                <th style={{ textAlign: 'right' }}>V3_Core 年度報酬</th>
                <th style={{ textAlign: 'right' }}>V3_Champ</th>
                <th style={{ textAlign: 'right' }}>50/50 槓鈴</th>
                <th style={{ textAlign: 'right' }}>Global Titan</th>
                <th style={{ textAlign: 'right' }}>SPY 大盤</th>
                <th style={{ textAlign: 'right' }}>超額 SPY</th>
                <th style={{ textAlign: 'right' }}>V3 年內 MDD</th>
                <th style={{ textAlign: 'center' }}>調倉期數 / 明細</th>
              </tr>
            </thead>
            <tbody>
              {filteredYearly.map((yr) => {
                const isOpen = !!expandedYears[yr.year];
                return (
                  <React.Fragment key={yr.year}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedYears((p) => ({ ...p, [yr.year]: !p[yr.year] }))}>
                      <td><strong>{isOpen ? '▼' : '▶'} {yr.year}</strong></td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: yr.return_pct >= 0 ? '#34D399' : '#F87171' }}>{fmtPct(yr.return_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.champ_ret_pct >= 0 ? '#A7F3D0' : '#FCA5A5' }}>{fmtPct(yr.champ_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>{fmtPct(yr.bb50_sa_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FDE047' }}>{fmtPct(yr.titan_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>{fmtPct(yr.spy_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.alpha_vs_spy >= 0 ? '#34D399' : '#F87171' }}>{fmtPct(yr.alpha_vs_spy)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.yearly_mdd_pct >= -15 ? '#34D399' : '#FBBF24' }}>{fmtPct(yr.yearly_mdd_pct, false)}</td>
                      <td style={{ textAlign: 'center' }}>{(yr.rebalances || []).length} 期 / {yr.unique_stocks_count} 檔</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} style={{ padding: '0.6rem', background: 'rgba(15,23,42,0.72)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                            {(yr.rebalances || []).map((rb, idxRb) => (
                              <div key={`${rb.tranche}_${rb.rebal_date}_${idxRb}`} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                                <div style={{ fontSize: '0.73rem', color: '#93C5FD', marginBottom: '0.35rem', fontWeight: 'bold' }}>
                                  {rb.tranche} ｜ 訊號 {rb.rebal_date} ｜ 進場 {rb.entry_date} ➔ 出場 {rb.exit_date}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                                  {(rb.picks || []).map((pk) => {
                                    const pos = Number(pk.period_ret) >= 0;
                                    return (
                                      <div key={`${pk.ticker}_${pk.entry_date}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.71rem', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.07)' }}>
                                        <StockChartButton ticker={pk.ticker} name={pk.name} trade={{ entry_date: pk.entry_date, entry_price: pk.entry_price, exit_date: pk.exit_date, exit_price: pk.exit_price }} />
                                        <strong style={{ color: pk.market === 'TW' ? '#FDE047' : '#CBD5E1' }}>{pk.ticker}</strong>
                                        <span style={{ color: '#94A3B8' }}>{fmtNum(pk.weight, 1)}%</span>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: pos ? '#F87171' : '#34D399' }}>{fmtPct(pk.period_ret)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* =================================================================
          7. 🔬 8 道檢察官拷問實證報告專區 (Prosecutor Audit Lab)
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #10B981' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <h4 style={{ margin: 0, color: '#6EE7B7' }}>🔬 Round 3 8 道檢察官嚴酷拷問與數學統計實證</h4>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {[
              { id: 'grid27', label: '📐 27參數高原網格' },
              { id: 'gate0', label: '🔎 Gate0 裸多空顯著性' },
              { id: 'loop1', label: '🪜 Loop1 漸進消融' },
              { id: 'loo', label: '✂️ LOO 自動剪枝' },
              { id: 'phase', label: '📅 三相日曆測試' },
              { id: 'harsh_jk', label: '💸 2x成本 & 刀切去飆股' },
            ].map((pt) => (
              <button
                key={pt.id}
                type="button"
                className={prosecutorTab === pt.id ? 'btn' : 'btn btn-secondary'}
                onClick={() => setProsecutorTab(pt.id)}
                style={{ fontSize: '0.73rem', padding: '0.28rem 0.62rem' }}
              >
                {pt.label}
              </button>
            ))}
          </div>
        </div>

        {prosecutorTab === 'grid27' && (
          <div>
            <div style={{ fontSize: '0.8rem', color: '#CBD5E1', marginBottom: '0.6rem' }}>
              中位數 10–26 CAGR = <strong style={{ color: '#34D399' }}>{pa?.grid_27_summary?.median_cagr_10_26}%</strong> ｜
              全區間 <strong>[{pa?.grid_27_summary?.min_cagr_10_26}%, {pa?.grid_27_summary?.max_cagr_10_26}%]</strong> ｜
              中位 Sharpe = <strong>{pa?.grid_27_summary?.median_sharpe_10_26}</strong> ｜
              正交與達標率 = <strong style={{ color: '#FDE047' }}>{pa?.grid_27_summary?.pass_g8_bar_count} / {pa?.grid_27_summary?.n_cells} (100%)</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '0.45rem' }}>
              {(pa?.grid_27_summary?.cells || []).map((c) => (
                <div key={c.label} style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.28)', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.72rem' }}>
                  <div style={{ fontWeight: 'bold', color: '#E2E8F0' }}>{c.label.replace('Grid_', '')}</div>
                  <div style={{ fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold', fontSize: '0.88rem' }}>{c.cagr_10_26}% (Ex26 {c.ex26_cagr}%)</div>
                  <div style={{ fontFamily: 'monospace', color: '#94A3B8' }}>Shp {c.sharpe_10_26} ｜ mMDD {c.m_mdd_10_26}%</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {prosecutorTab === 'gate0' && (
          <div style={{ overflowX: 'auto' }}>
            {['21D_Monthly', '63D_Quarterly'].map((hz) => (
              <div key={hz} style={{ marginBottom: '0.9rem' }}>
                <div style={{ fontWeight: 'bold', color: '#93C5FD', fontSize: '0.82rem', marginBottom: '0.35rem' }}>[{hz}] 非重疊期五分位 Q5 − Q1 裸多空擴散</div>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>因子支柱</th>
                      <th style={{ textAlign: 'right' }}>G1 (06–15)</th>
                      <th style={{ textAlign: 'right' }}>G2 Ex26 (16–25)</th>
                      <th style={{ textAlign: 'right' }}>Full 10–26 (t-stat)</th>
                      <th style={{ textAlign: 'right' }}>Ex26 10–25 (t-stat)</th>
                      <th style={{ textAlign: 'right' }}>勝率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pa?.gate0_event_study?.[hz] || {}).map(([fn, eras]) => (
                      <tr key={fn}>
                        <td><strong>{fn}</strong></td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(eras.G1_06_15?.per_mean_pct)} (t={eras.G1_06_15?.t_stat})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(eras.G2_Ex26_16_25?.per_mean_pct)} (t={eras.G2_Ex26_16_25?.t_stat})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{fmtPct(eras.Full_10_26?.per_mean_pct)} (t={eras.Full_10_26?.t_stat})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8' }}>{fmtPct(eras.Ex26_10_25?.per_mean_pct)} (t={eras.Ex26_10_25?.t_stat})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{eras.Full_10_26?.win_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {prosecutorTab === 'loop1' && (
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>消融階梯</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>05–26 全期</th>
                <th style={{ textAlign: 'right' }}>mMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe</th>
                <th style={{ textAlign: 'right' }}>06–09 實股持倉%</th>
                <th style={{ textAlign: 'right' }}>台股比重%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.loop1_ablations || {}).map(([k, ev]) => (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.continuity?.pct_invested_06_09}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.continuity?.mean_tw_weight_pct_10_26}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'loo' && (
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>LOO 因子減法消融</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>mMDD / dMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                <th>剪枝決策</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.loo_ablations || {}).map(([k, ev]) => (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: k === 'Drop_acq' ? '#34D399' : '#E2E8F0' }}>{ev.era_2010_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}% / {ev.era_2010_2026?.d_mdd}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe} / {ev.era_2010_2026?.calmar}</td>
                  <td>{k === 'Drop_acq' ? '✂️ 剔除重疊估值項後年化+夏普雙升，自動定版' : k === 'Full_Base' ? '原 5 因子基礎' : '✅ 保留核心貢獻'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'phase' && (
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>獨立單季日曆相位</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>05–26 全期</th>
                <th style={{ textAlign: 'right' }}>mMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.phase_invariance?.phases || {}).map(([k, ev]) => (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'harsh_jk' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
              <thead>
                <tr>
                  <th>雙倍成本 (2x Harsh) 與 刀切法 (Jackknife) 壓測</th>
                  <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                  <th style={{ textAlign: 'right' }}>Harsh Ex26</th>
                  <th style={{ textAlign: 'right' }}>05–26</th>
                  <th style={{ textAlign: 'right' }}>mMDD</th>
                  <th style={{ textAlign: 'right' }}>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...Object.entries(pa?.harsh_2x_cost || {}).map(([k, v]) => [k, v]),
                  ['Jackknife 拔除累積 Top-3 飆股', pa?.jackknife_drop_top3_top5?.drop_top3],
                  ['Jackknife 拔除累積 Top-5 飆股', pa?.jackknife_drop_top3_top5?.drop_top5],
                ].map(([lbl, ev]) => ev && (
                  <tr key={lbl}>
                    <td><strong>{lbl}</strong></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              🏅 累積最大貢獻 Top-5 剔除標的：{(pa?.jackknife_drop_top3_top5?.top5_contributors || []).map(([t, v]) => `${t} (${v}%)`).join('、')}
            </div>
          </div>
        )}
      </div>

      {/* =================================================================
          Modals: 資金調整 & 手動賣出
         ================================================================= */}
      {cashModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.68)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <form className="glass-card" onSubmit={handleSaveCashModal} style={{ maxWidth: '420px', width: '100%', padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#FDE047' }}>💰 V3 帳戶資金管理</h4>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <button type="button" className={cashAction === 'deposit' ? 'btn' : 'btn btn-secondary'} onClick={() => setCashAction('deposit')}>追加存入</button>
              <button type="button" className={cashAction === 'set' ? 'btn' : 'btn btn-secondary'} onClick={() => setCashAction('set')}>直接重設現金餘額</button>
            </div>
            <input
              type="number"
              placeholder="輸入台幣金額 (TWD)"
              value={cashAmountInput}
              onChange={(e) => setCashAmountInput(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: 'rgba(15,23,42,0.85)', color: '#FFF', border: '1px solid rgba(255,255,255,0.2)', marginBottom: '0.9rem' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCashModalOpen(false)}>取消</button>
              <button type="submit" className="btn">確認儲存</button>
            </div>
          </form>
        </div>
      )}

      {exitModal.open && exitModal.pos && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.68)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <form className="glass-card" onSubmit={handleConfirmExitModal} style={{ maxWidth: '420px', width: '100%', padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#F87171' }}>🚪 賣出平倉：{exitModal.pos.ticker} ({exitModal.pos.name})</h4>
            <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.5rem' }}>目前持有：{exitModal.pos.shares} 股</div>
            <label style={{ fontSize: '0.76rem', color: '#CBD5E1' }}>賣出股數</label>
            <input
              type="number"
              step="any"
              value={exitModal.shares}
              onChange={(e) => setExitModal((p) => ({ ...p, shares: e.target.value }))}
              style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: 'rgba(15,23,42,0.85)', color: '#FFF', border: '1px solid rgba(255,255,255,0.2)', marginBottom: '0.65rem' }}
            />
            <label style={{ fontSize: '0.76rem', color: '#CBD5E1' }}>成交價 ({exitModal.pos.currency})</label>
            <input
              type="number"
              step="0.01"
              value={exitModal.price}
              onChange={(e) => setExitModal((p) => ({ ...p, price: e.target.value }))}
              style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: 'rgba(15,23,42,0.85)', color: '#FFF', border: '1px solid rgba(255,255,255,0.2)', marginBottom: '0.9rem' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setExitModal({ open: false, pos: null, shares: '', price: '' })}>取消</button>
              <button type="submit" className="btn">確認賣出</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
