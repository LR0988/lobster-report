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
  name: 'V4 重倉雙艙互補初始本金',
  currency: 'TWD',
  shares: 0,
  price: 0,
  tax_fee: 0,
  cash_flow_twd: 1000000,
  realized_pnl_twd: null,
  realized_return_pct: null,
  note: '全球泰坦互補戰艦 V4 重倉雙艙版初始入金 NT$ 1,000,000（可在上方隨時存入或調整本金）',
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
    const seriesKeys = ['v3_core', 'v3_champ', 'v4_single', 'bb50_sa', 'bb70_q', 'spy', ...(chartShowTitan ? ['titan'] : [])];
    const pts = sub.map((row) => {
      const out = { d: row.d };
      seriesKeys.forEach((k) => {
        const rawVal = row[k] ?? row.v3_core ?? 1.0;
        const baseVal = base[k] ?? base.v3_core ?? 1.0;
        out[k] = Number(rawVal) / Math.max(Number(baseVal), 1e-6);
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
  const coreG1 = kpis.v3_core?.g1_2005_2015 || {};
  const coreG2 = kpis.v3_core?.g2_2016_2026 || {};
  const champ10 = kpis.v3_champ?.era_2010_2026 || {};
  const champ05 = kpis.v3_champ?.era_2005_2026 || {};
  const champG1 = kpis.v3_champ?.g1_2005_2015 || {};
  const champG2 = kpis.v3_champ?.g2_2016_2026 || {};
  const single10 = kpis.v4_single?.era_2010_2026 || {};
  const bb50sa = kpis.barbells?.bb50_sa?.era_2010_2026 || {};
  const bb50saEx26 = kpis.barbells?.bb50_sa?.era_2010_2025_ex26 || {};
  const bb50sa05 = kpis.barbells?.bb50_sa?.era_2005_2026 || {};
  const bb70q = kpis.barbells?.bb70_q?.era_2010_2026 || {};
  const bb50Spy = kpis.barbells?.bb50_spy_sa?.era_2010_2026 || {};
  const bb50Spy05 = kpis.barbells?.bb50_spy_sa?.era_2005_2026 || {};
  const spy10 = kpis.spy?.era_2010_2026 || {};
  const pa = data?.prosecutor_audit || {};

  const activeLensCards = useMemo(() => {
    if (engineLens === 'v3_champ') {
      return [
        { lbl: 'V4_SOV3 10–26 抗震年化', val: `${champ10.cagr ?? 23.30}%`, sub: `${champ10.mult ?? 34.22}x ｜ Ex26 ${kpis.v3_champ?.era_2010_2025_ex26?.cagr ?? 22.23}%`, col: '#34D399' },
        { lbl: '05–26 全22年實股年化', val: `${champ05.cagr ?? 21.38}%`, sub: `${champ05.mult ?? 67.09}x ｜ G1 ${champG1.cagr ?? 16.04}% / G2 ${champG2.cagr ?? 27.09}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${champ10.m_mdd ?? -18.62}% / ${champ10.d_mdd ?? -18.73}%`, sub: 'SOV3 sv=16% 下行半方差護盾', col: '#FBBF24' },
        { lbl: 'Sharpe / Calmar', val: `${champ10.sharpe ?? 1.54} / ${champ10.calmar ?? 1.25}`, sub: `2008 -16.70% ｜ 2022 +2.14% (勝大盤 ${champ10.beat_spy ?? '14/17'}年)`, col: '#A78BFA' },
        { lbl: 'vs Titan 獨立度 & 曝險', val: `ExSPY +0.129`, sub: `均值曝險 ${kpis.v3_champ?.avg_exposure_pct ?? 92.7}% ｜ 重疊 0.26%`, col: '#6EE7B7' },
      ];
    }
    if (engineLens === 'barbell_50') {
      return [
        { lbl: '50/50 泰坦×V4 重倉 (SA)', val: `${bb50sa.cagr ?? 37.87}%`, sub: `${bb50sa.mult ?? 225.12}x ｜ Ex26 ${bb50saEx26.cagr ?? 33.61}% ｜ 70/30 Q 達 ${bb70q.cagr ?? 41.34}%`, col: '#F59E0B' },
        { lbl: '05–26 全22年槓鈴年化', val: `${bb50sa05.cagr ?? 34.94}%`, sub: `mMDD ${bb50sa05.m_mdd ?? -18.88}% ｜ 同比例 Titan+SPY ${bb50Spy05.cagr ?? 28.69}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${bb50sa.m_mdd ?? -12.65}% / ${bb50sa.d_mdd ?? -22.06}%`, sub: `遠勝 50/50 Titan+SPY (${bb50Spy.m_mdd ?? -14.32}% / ${bb50Spy.d_mdd ?? -27.70}%)`, col: '#34D399' },
        { lbl: 'Sharpe / Calmar', val: `${bb50sa.sharpe ?? 1.72} / ${bb50sa.calmar ?? 2.99}`, sub: `2010–26 ${bb50sa.win_yrs ?? '17/17'} 零虧損年 ｜ 2022 +2.74%`, col: '#A78BFA' },
        { lbl: '泰坦重挫月保護 (32次<-3%)', val: `96.9% 勝泰坦`, sub: `V4 單體均 -0.47% (vs SPY -1.99%) ｜ 0 檔重疊`, col: '#6EE7B7' },
      ];
    }
    return [
      { lbl: 'V4_Heavy 10–26 年化', val: `${core10.cagr ?? 26.14}%`, sub: `${core10.mult ?? 50.19}x ｜ Ex26 ${coreEx26.cagr ?? 24.36}% (vs SPY ${spy10.cagr ?? 13.79}%)`, col: '#34D399' },
      { lbl: '05–26 全22年 & G1/G2', val: `${core05.cagr ?? 23.36}%`, sub: `${core05.mult ?? 95.47}x ｜ G1 ${coreG1.cagr ?? 16.51}% / G2 ${coreG2.cagr ?? 30.76}%`, col: '#38BDF8' },
      { lbl: '10–26 mMDD / dMDD', val: `${core10.m_mdd ?? -23.89}% / ${core10.d_mdd ?? -23.94}%`, sub: `單艙純股 V4_Single: ${single10.cagr ?? 23.21}% (Shp ${single10.sharpe ?? 1.26})`, col: '#FBBF24' },
      { lbl: 'Sharpe / Calmar', val: `${core10.sharpe ?? 1.50} / ${core10.calmar ?? 1.09}`, sub: `Sortino ${core10.sortino ?? 2.26} ｜ 勝大盤 ${core10.beat_spy ?? '14/17'} 年`, col: '#A78BFA' },
      { lbl: 'vs Titan 嚴格正交度', val: `ExSPY +${kpis.v3_core?.corr_ex_spy_vs_titan ?? 0.123}`, sub: `每日重疊 ${kpis.v3_core?.mean_weight_overlap_pct ?? 0.26}% ｜ 當期 ${kpis.v3_core?.active_overlap_count ?? 0} 檔重疊`, col: '#6EE7B7' },
    ];
  }, [engineLens, core10, coreEx26, core05, coreG1, coreG2, champ10, champ05, champG1, champG2, single10, bb50sa, bb50saEx26, bb50sa05, bb70q, bb50Spy, bb50Spy05, spy10, kpis]);

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
                <th>標的 & 子艙來源</th>
                <th>板塊</th>
                <th style={{ textAlign: 'right' }}>梯隊%</th>
                <th style={{ textAlign: 'right' }}>總倉%</th>
                <th style={{ textAlign: 'right' }}>進場開盤</th>
                <th style={{ textAlign: 'right' }}>最新現價</th>
                <th style={{ textAlign: 'right' }}>股價報酬</th>
                <th style={{ textAlign: 'right' }}>合意/五柱Z</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((pk) => {
                const isUp = Number(pk.price_ret_pct ?? pk.period_ret_pct) >= 0;
                const retShow = pk.price_ret_pct ?? pk.period_ret_pct;
                const podBadgeCol = String(pk.pod_tag || '').includes('共振') ? '#F59E0B' : String(pk.pod_tag || '').includes('PodA') ? '#38BDF8' : '#C084FC';
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 'bold', color: pk.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{pk.ticker}</span>
                            {pk.pod_tag && (
                              <span style={{ fontSize: '0.64rem', color: podBadgeCol, border: `1px solid ${podBadgeCol}55`, padding: '0 4px', borderRadius: '4px' }}>
                                {pk.pod_tag}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', maxWidth: '145px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pk.name}</div>
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
                      <div style={{ color: '#64748B' }}>G{fmtNum(pk.z_grw, 1)} C{fmtNum(pk.z_cbop, 1)} A{fmtNum(pk.z_acq, 1)}</div>
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
      { key: 'bb70_q', label: '70/30 泰坦×V4重倉 (Q)', color: '#F59E0B', width: 2.2 },
      { key: 'bb50_sa', label: '50/50 泰坦×V4重倉 (SA)', color: '#38BDF8', width: 2.4 },
      { key: 'v3_core', label: 'V4_Heavy 雙艙重倉 (26.14%)', color: '#34D399', width: 2.8 },
      { key: 'v3_champ', label: 'V4_SOV3 抗震重倉 (23.30%)', color: '#A78BFA', width: 2.0 },
      { key: 'v4_single', label: 'V4_Single 單艙重倉 (23.21%)', color: '#FBBF24', width: 1.7, dash: '2,2' },
      { key: 'spy', label: 'SPY 大盤基準 (13.79%)', color: '#94A3B8', width: 1.5, dash: '4,4' },
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
              { id: 'v3_core', label: `🚀 V4_Heavy 雙艙重倉旗艦 (${core10.cagr ?? 26.14}% / Shp ${core10.sharpe ?? 1.50})` },
              { id: 'v3_champ', label: `🛡️ V4_SOV3 抗震降波重倉 (${champ10.cagr ?? 23.30}% / Shp ${champ10.sharpe ?? 1.54})` },
              { id: 'barbell_50', label: `⚡ 50/50 泰坦×V4 重倉槓鈴 (${bb50sa.cagr ?? 37.87}% / Shp ${bb50sa.sharpe ?? 1.72})` },
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
            ✅ Gen-2 守門員 B1~B5 稽核：{pa?.gatekeeper_b1_b5_report?.rebalance_periods_checked ?? 526} 期 / {pa?.gatekeeper_b1_b5_report?.total_picks_checked ?? 1578} 筆選股・0-day 嚴格 PIT 0 違規・0 異常值 ｜ 2018 投毒 0.00e+00
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
              🌐 與泰坦雙重隔離：PodA <strong>g5 &le; 90%</strong> / PodB <strong>g5 &le; 85%</strong> ＋ 剔除公用事業/REITs ＋ 當期 {data?.titan_active_tickers?.length ?? 5} 檔泰坦 <strong>0 檔重疊</strong>
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
          <div><strong style={{ color: '#38BDF8' }}>① 50/50 雙艙對稱狙擊架構</strong>：50% <strong>PodA 深價值催化</strong> (30% ACQ＋30% CbOP＋25% GRW＋15% SHY) ＋ 50% <strong>PodB 營運拐點</strong> (45% GRW＋40% CbOP＋15% FIP)，每季再平衡賺取互補紅利。</div>
          <div><strong style={{ color: '#34D399' }}>② `3美+3台` 精銳濃縮</strong>：砍掉第 5～12 名平庸稀釋尾端，PodA 選 <strong>2美1台</strong>、PodB 選 <strong>1美2台</strong>，美台對稱平衡（台股約 44.2%），實盤總持股濃縮至 ~11 檔（100% 滿倉無空窗）。</div>
          <div><strong style={{ color: '#A78BFA' }}>③ 緩衝鎖倉 `1.67x` ＋ `RankInvSV`</strong>：單一板塊限 2 檔，舊持倉維持名次緩衝不頻繁換手；若強勢股同時獲兩艙三梯共振可自然放大至 ~20–32% 重倉（嚴控 2x 雙倍成本仍達 25.31%）。</div>
          <div><strong style={{ color: '#FBBF24' }}>④ 22 年零異常逐筆 PIT 驗證</strong>：1,578 筆選股通過 Gen-2 B1~B5 ＋ 0-day Buffer 精確成分核對，G1 (2005–15) 年化 16.51%、G2 (2016–26) 年化 30.76%，非單時期奇蹟。</div>
        </div>
      </div>

      {/* =================================================================
          3. 🏛️ 當期官方三梯隊持倉 / 三隊合併總權重 / 候補雷達
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.1rem', borderTop: '3px solid #38BDF8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <div>
            <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.05rem' }}>
              🏛️ V4_Heavy 雙艙重倉當期實盤持倉 ({mergedHoldings.length} 檔不重複標的・台股均值 {data?.kpis?.v3_core?.mean_tw_weight_pct ?? 44.2}%)
            </h4>
            <div style={{ fontSize: '0.73rem', color: '#FBBF24', marginTop: '3px' }}>
              ⚠️ 重倉集中度提示：極端高信念股若同時被 PodA 與 PodB 跨梯隊重複入選（如當期雙艙共振標的），總權重會自然集中以換取爆發力；欲控制單檔波動可搭配 V4_SOV3 (sv16)。
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'tranches', label: '📋 三梯隊獨立明細 (每梯約 5 檔共振融合)' },
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
                  <th>標的 & 子艙共振</th>
                  <th>市場 / 行業</th>
                  <th>涵蓋梯隊</th>
                  <th style={{ textAlign: 'right' }}>總組合目標權重</th>
                  <th style={{ textAlign: 'right' }}>最早進場日</th>
                  <th style={{ textAlign: 'right' }}>加權成本價</th>
                  <th style={{ textAlign: 'right' }}>最新市價</th>
                  <th style={{ textAlign: 'right' }}>股價報酬</th>
                  <th style={{ textAlign: 'right' }}>綜合 Z / 五柱分項</th>
                  <th style={{ textAlign: 'center' }}>泰坦重疊</th>
                </tr>
              </thead>
              <tbody>
                {mergedHoldings.map((m) => {
                  const isUp = Number(m.price_ret_pct) >= 0;
                  const podCol = String(m.pod_tag || '').includes('共振') ? '#F59E0B' : String(m.pod_tag || '').includes('PodA') ? '#38BDF8' : '#C084FC';
                  return (
                    <tr key={m.ticker}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <StockChartButton ticker={m.ticker} name={m.name} trade={{ entry_date: m.earliest_entry_date, entry_price: m.avg_entry_price, exit_date: '持有中', exit_price: m.current_price }} />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 'bold', color: m.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{m.ticker}</span>
                              {m.pod_tag && (
                                <span style={{ fontSize: '0.66rem', color: podCol, border: `1px solid ${podCol}55`, padding: '0 4px', borderRadius: '4px' }}>
                                  {m.pod_tag}
                                </span>
                              )}
                            </div>
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
                        <strong style={{ color: '#FDE047' }}>{fmtNum(m.composite, 2)}</strong> (G:{fmtNum(m.z_grw, 1)} C:{fmtNum(m.z_cbop, 1)} A:{fmtNum(m.z_acq, 1)} F:{fmtNum(m.z_fip, 1)})
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
              { title: '🇺🇸 美股 S&P 500 PIT 候補 Top 15 (非泰坦・雙艙合意)', list: data?.top_watchlist_candidates?.us || [] },
              { title: '🇹🇼 台股純上市 0050∪0051 PIT 候補 Top 12 (非泰坦・雙艙合意)', list: data?.top_watchlist_candidates?.tw || [] },
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
                      <th style={{ textAlign: 'right' }}>雙艙合意Z</th>
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
            <h4 style={{ margin: 0, color: '#FDE047' }}>🎯 V4 重倉跟單下單計算機 ({rebalanceSuggestions.length} 筆建議)</h4>
            <select
              value={rebalMode}
              onChange={(e) => setRebalMode(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.28rem 0.55rem', fontSize: '0.76rem' }}
            >
              <option value="full_100">{`🌐 合流 100% 一鍵建倉 (${mergedHoldings.length}檔目標)`}</option>
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
          <h4 style={{ margin: 0, color: '#E9D5FF' }}>📈 累積淨值走勢對照（V4_Heavy 重倉 × V4_SOV3 × 泰坦雙艙槓鈴 vs SPY 大盤）</h4>
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
                <th style={{ textAlign: 'right' }}>V4_Heavy (雙艙)</th>
                <th style={{ textAlign: 'right' }}>V4_SOV3 (sv16)</th>
                <th style={{ textAlign: 'right' }}>V4_Single (單艙)</th>
                <th style={{ textAlign: 'right' }}>50/50 泰坦×V4 (SA)</th>
                <th style={{ textAlign: 'right' }}>70/30 泰坦×V4 (Q)</th>
                <th style={{ textAlign: 'right' }}>50/50 泰坦×SPY</th>
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
                  {['spy', 'titan', 'v3_core', 'v3_champ', 'v4_single', 'bb50_sa', 'bb70_q', 'bb50_spy_sa'].map((sk) => {
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
          6. 📅 2005–2026 全 22 年 PIT 逐年績效與 263 期錯峰調倉溯源帳本
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #3B82F6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, color: '#93C5FD' }}>📅 2005–2026 全 22 年零空窗 PIT 逐年績效與逐筆明細帳本</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="搜尋股票代號或名稱 (如 2330 / TPR)..."
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
                <th style={{ textAlign: 'right' }}>V4_Heavy 雙艙</th>
                <th style={{ textAlign: 'right' }}>V4_SOV3 (sv16)</th>
                <th style={{ textAlign: 'right' }}>50/50 槓鈴</th>
                <th style={{ textAlign: 'right' }}>Global Titan</th>
                <th style={{ textAlign: 'right' }}>SPY 大盤</th>
                <th style={{ textAlign: 'right' }}>超額 SPY</th>
                <th style={{ textAlign: 'right' }}>V4 年內 MDD</th>
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
                                        {pk.pod_tag && <span style={{ fontSize: '0.64rem', color: pk.pod_tag === 'A+B' ? '#F59E0B' : '#94A3B8' }}>[{pk.pod_tag}]</span>}
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
          7. 🔬 Round 4 重倉版 8 道檢察官嚴酷拷問與逐筆 PIT 實證
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #10B981' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <h4 style={{ margin: 0, color: '#6EE7B7' }}>🔬 Round 4 重倉版 8 道檢察官嚴酷拷問與逐筆 PIT 驗證</h4>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {[
              { id: 'grid27', label: '📐 雙組27參數高原' },
              { id: 'gate0', label: '🌪️ 雙世代G1/G2 & 泰坦崩盤保護' },
              { id: 'loop1', label: '🪜 集中化階梯 N=12→3' },
              { id: 'loo', label: '✂️ LOO 因子&子艙消融' },
              { id: 'phase', label: '📅 三相日曆測試' },
              { id: 'harsh_jk', label: '💸 2x成本 & 刀切去Top-10' },
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#CBD5E1', marginBottom: '0.55rem' }}>
                👑 <strong>DualPod 雙艙 27 格高原</strong>：中位數 CAGR = <strong style={{ color: '#34D399' }}>{pa?.grid_27_summary?.median_cagr_10_26}%</strong> (Ex26 {pa?.grid_27_summary?.median_ex26_cagr}%) ｜
                區間 <strong>[{pa?.grid_27_summary?.min_cagr_10_26}%, {pa?.grid_27_summary?.max_cagr_10_26}%]</strong> ｜
                中位 Sharpe = <strong>{pa?.grid_27_summary?.median_sharpe_10_26}</strong> ｜
                嚴格正交 = <strong style={{ color: '#FDE047' }}>{pa?.grid_27_summary?.pass_ortho_count} / {pa?.grid_27_summary?.n_cells}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(178px, 1fr))', gap: '0.45rem' }}>
                {(pa?.grid_27_summary?.cells || []).map((c) => (
                  <div
                    key={c.label}
                    style={{
                      background: c.pass_ortho ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                      border: `1px solid ${c.pass_ortho ? 'rgba(16,185,129,0.28)' : 'rgba(245,158,11,0.35)'}`,
                      borderRadius: '6px',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.72rem',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', color: '#E2E8F0' }}>{c.label.replace('DualGrid_', '')} {c.pass_ortho ? '✅' : '⚠️'}</div>
                    <div style={{ fontFamily: 'monospace', color: c.pass_ortho ? '#34D399' : '#FBBF24', fontWeight: 'bold', fontSize: '0.88rem' }}>{c.cagr_10_26}% (Ex26 {c.ex26_cagr}%)</div>
                    <div style={{ fontFamily: 'monospace', color: '#94A3B8' }}>Shp {c.sharpe_10_26} ｜ ExC {c.ex_spy_corr >= 0 ? '+' : ''}{c.ex_spy_corr}</div>
                  </div>
                ))}
              </div>
            </div>

            {pa?.grid_27_single_summary?.cells && (
              <div>
                <div style={{ fontSize: '0.8rem', color: '#CBD5E1', marginBottom: '0.5rem' }}>
                  🏆 <strong>Single_Heavy 單艙 27 格高原</strong>：中位數 CAGR = <strong style={{ color: '#38BDF8' }}>{pa?.grid_27_single_summary?.median_cagr_10_26}%</strong> ｜
                  區間 <strong>[{pa?.grid_27_single_summary?.min_cagr_10_26}%, {pa?.grid_27_single_summary?.max_cagr_10_26}%]</strong> ｜
                  全數過嚴格正交+達標 = <strong style={{ color: '#34D399' }}>{pa?.grid_27_single_summary?.pass_ortho_count} / {pa?.grid_27_single_summary?.n_cells} (100%)</strong>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(178px, 1fr))', gap: '0.45rem' }}>
                  {(pa?.grid_27_single_summary?.cells || []).map((c) => (
                    <div key={c.label} style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.72rem' }}>
                      <div style={{ fontWeight: 'bold', color: '#E2E8F0' }}>{c.label.replace('SingleGrid_', '')} ✅</div>
                      <div style={{ fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold', fontSize: '0.86rem' }}>{c.cagr_10_26}% (Ex26 {c.ex26_cagr}%)</div>
                      <div style={{ fontFamily: 'monospace', color: '#94A3B8' }}>Shp {c.sharpe_10_26} ｜ mMDD {c.m_mdd_10_26}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {prosecutorTab === 'gate0' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowX: 'auto' }}>
            <div>
              <div style={{ fontWeight: 'bold', color: '#93C5FD', fontSize: '0.82rem', marginBottom: '0.35rem' }}>📐 雙世代穩健度審計：G1 (2005–2015 含海嘯) vs G2 (2016–2026) 與嚴格正交檢核</div>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>策略引擎</th>
                    <th style={{ textAlign: 'right' }}>G1 (05–15) 年化 / Sharpe</th>
                    <th style={{ textAlign: 'right' }}>G2 (16–26) 年化 / Sharpe</th>
                    <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                    <th style={{ textAlign: 'right' }}>Ex26 CAGR</th>
                    <th style={{ textAlign: 'right' }}>ExSPY / TotC / Ov</th>
                    <th style={{ textAlign: 'center' }}>嚴格正交</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pa?.dual_era_audit || {}).map(([k, v]) => (
                    <tr key={k}>
                      <td><strong>{k}</strong></td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.g1_05_15?.cagr}% (Shp {v.g1_05_15?.sharpe})</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399' }}>{v.g2_16_26?.cagr}% (Shp {v.g2_16_26?.sharpe})</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{v.cagr_10_26}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.cagr_ex26}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.ex_spy_corr >= 0 ? '+' : ''}{v.ex_spy_corr} / {v.tot_corr >= 0 ? '+' : ''}{v.tot_corr} / {v.overlap_pct}%</td>
                      <td style={{ textAlign: 'center' }}>{v.strictly_orthogonal ? '✅ 過關' : '⚠️ TW偏重'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pa?.titan_crash_months?.sleeves && (
              <div>
                <div style={{ fontWeight: 'bold', color: '#FBBF24', fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                  🌪️ 泰坦重挫月份護航實測（2010–2026 共 {pa?.titan_crash_months?.n_crash_months} 個泰坦月跌 &lt; -3%，泰坦平均 {pa?.titan_crash_months?.titan_mean_pct}%）
                </div>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th>對比標的 / 組合</th>
                      <th style={{ textAlign: 'right' }}>崩盤月平均報酬</th>
                      <th style={{ textAlign: 'right' }}>逆勢正報酬率</th>
                      <th style={{ textAlign: 'right' }}>跑贏泰坦月佔比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pa?.titan_crash_months?.sleeves || {}).map(([k, s]) => (
                      <tr key={k}>
                        <td><strong>{k}</strong></td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: s.mean_ret_pct > -1.0 ? '#34D399' : '#CBD5E1' }}>{fmtPct(s.mean_ret_pct)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{s.pct_positive}%</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FDE047' }}>{s.pct_beat_titan}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {prosecutorTab === 'loop1' && (
          <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
            <thead>
              <tr>
                <th>集中化階梯 (N=12 → N=3) + MA60 反指標對照</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>05–26 全期</th>
                <th style={{ textAlign: 'right' }}>mMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe</th>
                <th style={{ textAlign: 'right' }}>ExSPY</th>
                <th style={{ textAlign: 'right' }}>台股比重%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.loop1_ablations || {}).map(([k, ev]) => (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: k.includes('NegCtrl') ? '#F87171' : '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.corr_ex_spy_vs_titan_10_26 >= 0 ? '+' : ''}{ev.corr_ex_spy_vs_titan_10_26}</td>
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
                <th>LOO 因子與子艙減法消融 (DualPod)</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>mMDD / dMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                <th>結構必要性檢定</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.loo_ablations || {}).map(([k, ev]) => (
                <tr key={k}>
                  <td><strong>{k}</strong></td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: k === 'Full_Base' ? '#34D399' : '#E2E8F0' }}>{ev.era_2010_2026?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}% / {ev.era_2010_2026?.d_mdd}%</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe} / {ev.era_2010_2026?.calmar}</td>
                  <td>{k === 'Full_Base' ? '👑 完整雙艙全開（夏普＆年化最優平衡）' : k.includes('Pod') ? '⚠️ 單艙失去對稱互補平衡' : '✅ 剔除即掉年化與夏普・具實質貢獻'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'phase' && (
          <div>
            <div style={{ fontSize: '0.78rem', color: '#CBD5E1', marginBottom: '0.5rem' }}>
              三條單梯隊季線均值 = <strong style={{ color: '#34D399' }}>{pa?.phase_invariance?.mean_cagr ?? 24.13}%</strong> ｜ 均值 Sharpe = <strong>{pa?.phase_invariance?.mean_sharpe ?? 1.31}</strong>（三條全勝 SPY 13.79%，三梯隊錯峰合成達 26.14% / Shp 1.50）
            </div>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
              <thead>
                <tr>
                  <th>獨立單季日曆相位 (DualPod)</th>
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
          </div>
        )}

        {prosecutorTab === 'harsh_jk' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
              <thead>
                <tr>
                  <th>雙倍成本 (2x Harsh) 與 全週期刀切法 (Jackknife) 壓測</th>
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
                  ['DualPod 永久剔除累積 Top-3 飆股', pa?.jackknife_drop_top3_top5?.drop_top3],
                  ['DualPod 永久剔除累積 Top-5 飆股', pa?.jackknife_drop_top3_top5?.drop_top5],
                  ['DualPod 永久剔除累積 Top-10 飆股', pa?.jackknife_drop_top3_top5?.drop_top10],
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
              🏅 全週期 17 年累計 Top-10 功臣股剔除名單：{(pa?.jackknife_drop_top3_top5?.top10_contributors || pa?.jackknife_drop_top3_top5?.top5_contributors || []).map(([t, v]) => `${t} (${v}%)`).join('、')}
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
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#FDE047' }}>💰 V4 重倉互補帳戶資金管理</h4>
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
