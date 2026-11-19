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
  name: 'V10 五檔22號同步初始本金',
  currency: 'TWD',
  shares: 0,
  price: 0,
  tax_fee: 0,
  cash_flow_twd: 1000000,
  realized_pnl_twd: null,
  realized_return_pct: null,
  note: '全球泰坦互補戰艦 V10 五檔精銳22號同步版初始入金 NT$ 1,000,000（可在上方隨時存入或調整本金）',
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
  const [engineLens, setEngineLens] = useState('v3_core'); // 'v3_core' | 'v7_cochamp' | 'v3_champ' | 'barbell_50'
  const [picksTab, setPicksTab] = useState('holdings'); // 'holdings' | 'n6_holdings' | 'watchlist'
  const [prosecutorTab, setProsecutorTab] = useState('grid27'); // 'grid27' | 'gate0' | 'loop1' | 'loo' | 'phase' | 'harsh_jk'

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
  const [rebalMode, setRebalMode] = useState('sync22_n5'); // 'sync22_n5' (5-stock flagship) | 'sync22_n6' (6-stock balanced)
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
    const ordered = [...txHistory].reverse();
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

  // V10 Single-Table Holdings & Countdown (`Monthly 22nd Titan Sync`)
  const tranches = data?.official_active_tranches || {};
  const syncTranche = tranches.sync_22 || (Array.isArray(tranches.sub_tranches) ? tranches.sub_tranches[0] : null) || {};
  const mergedHoldings = data?.merged_active_holdings || [];
  const n6Holdings = data?.cochamp_active_holdings || [];
  const activeSummary = data?.active_portfolio_summary || {};

  const nextRebalCountdown = useMemo(() => {
    const todayStr = data?.latest_tw_date || data?.latest_us_date || data?.latest_data_date || '2026-11-19';
    const nxt = syncTranche?.next_rebal_date || activeSummary?.next_rebal_date || '2026-11-23';
    const dLeft = daysBetween(todayStr, nxt) ?? 5;
    return {
      rebalDate: syncTranche?.rebal_date || activeSummary?.rebal_date || '2026-10-22',
      entryDate: syncTranche?.entry_date || activeSummary?.entry_date || '2026-10-27',
      next: nxt,
      days: dLeft,
    };
  }, [syncTranche, activeSummary, data]);

  // Follow-Trade Rebalance Suggestions Engine (100% Unified Single-Table)
  const targetPicksForCalc = useMemo(() => {
    const src = rebalMode === 'sync22_n6' && n6Holdings.length > 0 ? n6Holdings : mergedHoldings;
    return src.map((m) => ({
      ...m,
      calcWeightPct: m.actual_mtm_weight_pct ?? m.total_weight_pct,
    }));
  }, [rebalMode, mergedHoldings, n6Holdings]);

  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];
    const capitalBaseTwd = totalNetAssetsTwd;
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

    for (const hp of userPositions) {
      if (!targetTickers.has(hp.ticker) && hp.shares > 0) {
        const key = `${rebalMode}_exit_${hp.ticker}`;
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
          note: `V10 五檔22號同步 ${sugg.action} ${shares} 股 (目標 ${sugg.targetWeightPct}%)`,
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
          note: `V10 五檔22號同步 ${sugg.action} ${shares} 股 (實現 ${fmtTwd(netPnlTwd)})`,
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
      '5y': '2021-11-18',
      '2022': '2022-01-03',
      '2020': '2020-01-02',
      '2008': '2007-10-01',
    };
    const cut = startCutoffMap[chartWindow] || '2010-01-04';
    const endCut = chartWindow === '2008' ? '2009-12-31' : chartWindow === '2020' ? '2021-12-31' : chartWindow === '2022' ? '2023-06-30' : '2099-12-31';
    const sub = raw.filter((pt) => pt.d >= cut && pt.d <= endCut);
    if (sub.length < 5) return { points: [], minY: 0.8, maxY: 2.0 };

    const base = sub[0];
    const seriesKeys = ['v3_core', 'v7_cochamp', 'v3_champ', 'v7_lowturn', 'bb50_sa', 'bb70_q', 'spy', ...(chartShowTitan ? ['titan'] : [])];
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

  // Active KPI Summary
  const kpis = data?.kpis || {};
  const core10 = kpis.v3_core?.era_2010_2026 || {};
  const coreEx26 = kpis.v3_core?.era_2010_2025_ex26 || {};
  const core05 = kpis.v3_core?.era_2005_2026 || {};
  const coreG1 = kpis.v3_core?.g1_2005_2015 || {};
  const coreG2 = kpis.v3_core?.g2_2016_2026 || {};
  const cochamp10 = kpis.v7_cochamp?.era_2010_2026 || {};
  const cochampEx26 = kpis.v7_cochamp?.era_2010_2025_ex26 || {};
  const cochamp05 = kpis.v7_cochamp?.era_2005_2026 || {};
  const cochampG1 = kpis.v7_cochamp?.g1_2005_2015 || {};
  const cochampG2 = kpis.v7_cochamp?.g2_2016_2026 || {};
  const champ10 = kpis.v3_champ?.era_2010_2026 || {};
  const champEx26 = kpis.v3_champ?.era_2010_2025_ex26 || {};
  const champ05 = kpis.v3_champ?.era_2005_2026 || {};
  const champG1 = kpis.v3_champ?.g1_2005_2015 || {};
  const champG2 = kpis.v3_champ?.g2_2016_2026 || {};
  const v7Prev10 = kpis.v7_prev_5tr?.era_2010_2026 || {};
  const v4Prev10 = kpis.v4_prev?.era_2010_2026 || {};
  const bb50sa = kpis.barbells?.bb50_sa?.era_2010_2026 || {};
  const bb50saEx26 = kpis.barbells?.bb50_sa?.era_2010_2025_ex26 || {};
  const bb50sa05 = kpis.barbells?.bb50_sa?.era_2005_2026 || {};
  const bb50co = kpis.barbells?.bb50_co_sa?.era_2010_2026 || {};
  const bb70q = kpis.barbells?.bb70_q?.era_2010_2026 || {};
  const bb50Spy = kpis.barbells?.bb50_spy_sa?.era_2010_2026 || {};
  const bb50Spy05 = kpis.barbells?.bb50_spy_sa?.era_2005_2026 || {};
  const spy10 = kpis.spy?.era_2010_2026 || {};
  const pa = data?.prosecutor_audit || {};
  const crashV10 = pa?.titan_crash_months?.sleeves?.V10_Sync22_Champion || pa?.titan_crash_months?.sleeves?.V9_Sync22_Champion || {};

  const activeLensCards = useMemo(() => {
    if (engineLens === 'v7_cochamp') {
      return [
        { lbl: 'V10_N6 均衡 6 檔年化 (10–26)', val: `${cochamp10.cagr ?? 25.76}%`, sub: `${cochamp10.mult ?? 47.82}x ｜ Ex26 ${cochampEx26.cagr ?? 23.91}% (vs SPY ${spy10.cagr ?? 13.62}%)`, col: '#FDE047' },
        { lbl: '05–26 全22年 & G1/G2', val: `${cochamp05.cagr ?? 23.15}%`, sub: `G1 ${cochampG1.cagr ?? 18.4}% / G2 ${cochampG2.cagr ?? 28.28}%`, col: '#38BDF8' },
        { lbl: '極簡配置 (3 美股 + 3 台股)', val: `${n6Holdings.length || 6} 檔滿倉`, sub: `每月 22 號操作 1 次 ｜ mMDD ${cochamp10.m_mdd ?? -18.12}%`, col: '#FBBF24' },
        { lbl: 'Sharpe / Calmar / 2x成本', val: `${cochamp10.sharpe ?? 1.5} / ${cochamp10.calmar ?? 1.42}`, sub: `2x 交易成本仍 24.33% ｜ 50/50 槓鈴 ${bb50co.cagr ?? 37.42}%`, col: '#A78BFA' },
        { lbl: 'vs 泰坦嚴格正交度', val: `ExSPY +${kpis.v7_cochamp?.corr_ex_spy_vs_titan ?? 0.091}`, sub: `每日重疊 ${kpis.v7_cochamp?.mean_weight_overlap_pct ?? 0.11}% ｜ 當期 0 檔重疊`, col: '#6EE7B7' },
      ];
    }
    if (engineLens === 'v3_champ') {
      return [
        { lbl: 'V10_SOV3 月頻護盾年化', val: `${champ10.cagr ?? 25.27}%`, sub: `Ex26 ${champEx26.cagr ?? 24.84}% (月頻換倉連動，零週頻操作)`, col: '#34D399' },
        { lbl: '05–26 全22年實股年化', val: `${champ05.cagr ?? 22.27}%`, sub: `G1 ${champG1.cagr ?? 14.76}% / G2 ${champG2.cagr ?? 30.48}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${champ10.m_mdd ?? -17.14}% / ${champ10.d_mdd ?? -19.74}%`, sub: `SOV3 sv=16% 下行保護 (2008 金融海嘯僅 -17.10%)`, col: '#FBBF24' },
        { lbl: 'Sharpe / Sortino / Calmar', val: `${champ10.sharpe ?? 1.6} / ${champ10.sortino ?? 2.41} / ${champ10.calmar ?? 1.47}`, sub: `2022 升息熊市僅 -2.35% (2x 成本仍 23.56%)`, col: '#A78BFA' },
        { lbl: '月頻平均實股曝險', val: `${kpis.v3_champ?.avg_exposure_pct ?? 92.5}%`, sub: `均值重疊 ${kpis.v3_champ?.overlap?.mean_weight_overlap_pct ?? 0.16}% ｜ 0 檔重疊`, col: '#6EE7B7' },
      ];
    }
    if (engineLens === 'barbell_50') {
      return [
        { lbl: '50/50 泰坦×V10 槓鈴 (SA)', val: `${bb50sa.cagr ?? 38.96}%`, sub: `${bb50sa.mult ?? 257.62}x ｜ Ex26 ${bb50saEx26.cagr ?? 35.45}% ｜ 70/30 Q 達 ${bb70q.cagr ?? 41.71}%`, col: '#F59E0B' },
        { lbl: '05–26 全22年槓鈴年化', val: `${bb50sa05.cagr ?? 36.38}%`, sub: `mMDD ${bb50sa05.m_mdd ?? -18.05}% ｜ 同比例 Titan+SPY ${bb50Spy05.cagr ?? 28.44}%`, col: '#38BDF8' },
        { lbl: '10–26 mMDD / dMDD', val: `${bb50sa.m_mdd ?? -18.05}% / ${bb50sa.d_mdd ?? -22.21}%`, sub: `遠勝單跑 Titan (${kpis.titan_official?.era_2010_2026?.m_mdd ?? -26.07}%) 與 SPY (${bb50Spy.d_mdd ?? -27.70}%)`, col: '#34D399' },
        { lbl: 'Sharpe / Calmar', val: `${bb50sa.sharpe ?? 1.77} / ${bb50sa.calmar ?? 2.16}`, sub: `2010–26 ${bb50sa.win_yrs ?? '17/17'} 零虧損年 ｜ 2022 熊市 +3.58%`, col: '#A78BFA' },
        { lbl: '泰坦重挫月保護 (32次<-3%)', val: `${crashV10.pct_beat_titan ?? 93.8}% 勝泰坦`, sub: `V10 單體均 ${crashV10.mean_ret_pct ?? -0.26}% (vs SPY -2.06% / 舊 V9 -0.56%)`, col: '#6EE7B7' },
      ];
    }
    return [
      { lbl: 'V10_Sync22 五檔旗艦 (10–26)', val: `${core10.cagr ?? 28.24}%`, sub: `${core10.mult ?? 66.48}x ｜ Ex26 ${coreEx26.cagr ?? 27.6}% (vs 舊 V9 26.37%)`, col: '#34D399' },
      { lbl: '05–26 全22年 & G1/G2', val: `${core05.cagr ?? 25.37}%`, sub: `G1 ${coreG1.cagr ?? 18.08}% / G2 ${coreG2.cagr ?? 33.33}% (零過擬合跨代穩健)`, col: '#38BDF8' },
      { lbl: '10–26 mMDD / dMDD', val: `${core10.m_mdd ?? -19.45}% / ${core10.d_mdd ?? -25.79}%`, sub: `僅抱 5 檔 (2美3台) ｜ 2022 升息熊市逆勢 +1.30%`, col: '#FBBF24' },
      { lbl: 'Sharpe / Calmar & 2x成本', val: `${core10.sharpe ?? 1.56} / ${core10.calmar ?? 1.45}`, sub: `2x 交易成本仍 26.45% ｜ ${core10.win_yrs ?? '16/17'} 正報酬年 (vs V4 ${v4Prev10.m_mdd ?? -23.89}%)`, col: '#A78BFA' },
      { lbl: 'vs 泰坦嚴格正交度', val: `ExSPY +${kpis.v3_core?.corr_ex_spy_vs_titan ?? 0.072}`, sub: `每日重疊 ${kpis.v3_core?.mean_weight_overlap_pct ?? 0.16}% ｜ 當期 ${kpis.v3_core?.active_overlap_count ?? 0} 檔重疊`, col: '#6EE7B7' },
    ];
  }, [
    engineLens, core10, coreEx26, core05, coreG1, coreG2, cochamp10, cochampEx26, cochamp05, cochampG1, cochampG2,
    champ10, champEx26, champ05, champG1, champG2, v4Prev10, bb50sa, bb50saEx26, bb50sa05, bb50co, bb70q,
    bb50Spy, bb50Spy05, spy10, kpis, n6Holdings.length, crashV10,
  ]);

  const renderSingleHoldingsTable = (rows) => {
    const usCnt = rows.filter((x) => x.market === 'US').length;
    const twCnt = rows.filter((x) => x.market === 'TW').length;
    const sumMtm = rows.reduce((s, x) => s + Number(x.actual_mtm_weight_pct || 0), 0);
    const sumInit = rows.reduce((s, x) => s + Number(x.init_target_weight_pct || 0), 0);
    const cashTail = Math.max(0, 100 - sumMtm);
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="custom-table" style={{ width: '100%', fontSize: '0.8rem' }}>
          <thead>
            <tr>
              <th>#</th>
              <th>標的 &amp; 狀態</th>
              <th>市場 / 行業</th>
              <th style={{ textAlign: 'right' }}>當期實重 MtM%</th>
              <th style={{ textAlign: 'right' }}>22號初重 Init%</th>
              <th style={{ textAlign: 'right' }}>進場開盤日</th>
              <th style={{ textAlign: 'right' }}>進場開盤價</th>
              <th style={{ textAlign: 'right' }}>最新現價</th>
              <th style={{ textAlign: 'right' }}>股價報酬</th>
              <th style={{ textAlign: 'right' }}>合意 Z / 六柱分數</th>
              <th style={{ textAlign: 'center' }}>泰坦重疊</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, idx) => {
              const isUp = Number(m.price_ret_pct) >= 0;
              return (
                <tr key={m.ticker}>
                  <td><strong>{m.rank ?? idx + 1}</strong></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <StockChartButton
                        ticker={m.ticker}
                        name={m.name}
                        trade={{ entry_date: m.entry_date || m.earliest_entry_date, entry_price: m.avg_entry_price, exit_date: '持有中', exit_price: m.current_price }}
                      />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.88rem', color: m.market === 'TW' ? '#FDE047' : '#93C5FD' }}>{m.ticker}</span>
                          <span style={{ fontSize: '0.67rem', color: String(m.action || '').includes('新進') ? '#34D399' : '#94A3B8', border: `1px solid ${String(m.action || '').includes('新進') ? 'rgba(52,211,153,0.4)' : 'rgba(148,163,184,0.28)'}`, padding: '1px 5px', borderRadius: '4px' }}>
                            {m.action || '持有中'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>{m.name}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: '0.74rem' }}>{m.market} ・ {m.sector}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399', fontSize: '0.9rem' }}>
                    {fmtNum(m.actual_mtm_weight_pct, 2)}%
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                    {fmtNum(m.init_target_weight_pct, 2)}%
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{m.entry_date || m.earliest_entry_date}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(m.avg_entry_price, 2)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{fmtNum(m.current_price, 2)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isUp ? '#F87171' : '#34D399' }}>
                    {fmtPct(m.price_ret_pct)}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.71rem', color: '#CBD5E1' }}>
                    <strong style={{ color: '#FDE047' }}>{fmtNum(m.composite, 2)}</strong>
                    <div style={{ color: '#94A3B8' }}>
                      C{fmtNum(m.z_cbop, 1)} A{fmtNum(m.z_acq, 1)} G{fmtNum(m.z_grw, 1)} R{fmtNum(m.z_glob_rev, 1)} O{fmtNum(m.z_oplev ?? m.z_asym_cat, 1)} PB{fmtNum(m.z_rev21, 1)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{m.in_titan_active ? '⚠️ 重疊' : '✅ 0 重疊'}</td>
                </tr>
              );
            })}
            <tr style={{ background: 'rgba(16,185,129,0.08)', fontWeight: 'bold' }}>
              <td colSpan={3} style={{ color: '#6EE7B7' }}>合計（{rows.length} 檔精銳單表：{usCnt} 美股 ＋ {twCnt} 台股）</td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399' }}>{fmtNum(sumMtm, 2)}%</td>
              <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>{fmtNum(sumInit, 2)}%</td>
              <td colSpan={6} style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                🗓️ 全月僅於每月 22 號調倉 1 次・無子梯或週頻微調{cashTail > 0.15 ? `（&plusmn;3% 免摩擦帶保留現金尾差 ${fmtNum(cashTail, 2)}%）` : ''}
              </td>
            </tr>
          </tbody>
        </table>
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
      { key: 'bb70_q', label: `70/30 泰坦×V10 (${bb70q.cagr ?? 41.71}%)`, color: '#F59E0B', width: 2.1 },
      { key: 'bb50_sa', label: `50/50 泰坦×V10 (${bb50sa.cagr ?? 38.96}%)`, color: '#38BDF8', width: 2.5 },
      { key: 'v7_lowturn', label: `舊 V7 五梯複雜版 (${v7Prev10.cagr ?? 30.35}%)`, color: '#FB7185', width: 1.5, dash: '2,2' },
      { key: 'v3_core', label: `V10_Sync22 旗艦5檔 (${core10.cagr ?? 28.24}%)`, color: '#34D399', width: 3.0 },
      { key: 'v7_cochamp', label: `V10_N6 均衡6檔 (${cochamp10.cagr ?? 25.76}%)`, color: '#FDE047', width: 2.0, dash: '3,2' },
      { key: 'v3_champ', label: `V10_SOV3 月頻護盾 (${champ10.cagr ?? 25.27}%)`, color: '#A78BFA', width: 1.9 },
      { key: 'spy', label: `SPY 大盤 (${spy10.cagr ?? 13.62}%)`, color: '#94A3B8', width: 1.5, dash: '4,4' },
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem', fontSize: '0.75rem', marginBottom: '0.5rem', alignItems: 'center' }}>
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
              { id: 'v3_core', label: `🚀 V10_Sync22 旗艦 5 檔 (${core10.cagr ?? 28.24}% / Ex26 ${coreEx26.cagr ?? 27.6}%)` },
              { id: 'v7_cochamp', label: `⚖️ V10_N6 均衡 6 檔 (${cochamp10.cagr ?? 25.76}% / Cal ${cochamp10.calmar ?? 1.42})` },
              { id: 'v3_champ', label: `🛡️ V10_SOV3 月頻護盾 (${champ10.cagr ?? 25.27}% / mMDD ${champ10.m_mdd ?? -17.14}%)` },
              { id: 'barbell_50', label: `⚡ 50/50 泰坦×V10 槓鈴 (${bb50sa.cagr ?? 38.96}% / 17勝年)` },
            ].map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setEngineLens(l.id)}
                style={{
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.34rem 0.75rem',
                  fontSize: '0.76rem',
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
            ✅ Gen-2 守門員 B1~B5 稽核：{pa?.gatekeeper_b1_b5_report?.rebalance_periods_checked ?? 262} 期 / {pa?.gatekeeper_b1_b5_report?.total_picks_checked ?? 1310} 筆選股・0-day PIT 0 違規・非22號 0 筆 ｜ 2018 投毒 0.00e+00
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
          2. 🗓️ V10 五檔精銳每月 22 號泰坦 B 梯同步操作排程與三大因果升級
         ================================================================= */}
      <div className="glass-card" style={{ padding: '0.9rem 1.2rem', border: '1px solid rgba(56,189,248,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#FDE047', background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.42)', padding: '0.3rem 0.72rem', borderRadius: '6px', fontWeight: 'bold' }}>
              🗓️ 每月 22 號與【全球泰坦 B 梯】同步操作一次（僅 5 檔・0 子梯隊）｜本期：{nextRebalCountdown.rebalDate} 訊號 ➔ {nextRebalCountdown.entryDate} 開盤｜下次換倉：{nextRebalCountdown.next}（11/22 遇週日順延・倒數 {nextRebalCountdown.days} 天）
            </span>
            <span style={{ fontSize: '0.74rem', color: '#A7F3D0', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', padding: '0.3rem 0.65rem', borderRadius: '6px' }}>
              🌐 嚴格非動能與對稱衛生隔離：<strong>g5 &le; 85%</strong> 進場 / <strong>&le; 93%</strong> 續抱（進場與續抱對稱排除反瀑布/機構派發）＋ 當期泰坦 ({(data?.titan_active_tickers || []).join(', ')}) <strong>0 檔重疊</strong>
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))', gap: '0.55rem', fontSize: '0.73rem', color: '#CBD5E1', background: 'rgba(0,0,0,0.28)', padding: '0.6rem 0.85rem', borderRadius: '6px', marginBottom: '0.55rem' }}>
          <div><strong style={{ color: '#38BDF8' }}>① 對稱續抱衛生紀律 (el93_clean)</strong>：補齊舊 V9 續抱緩衝區未排除 <code>Waterfall / InstDist</code> 之漏洞（<code>+0.86%</code> 年化，<code>Ex26</code> 由 <code>26.37% ➔ 27.27%</code>），避免持有基本面或籌碼已崩潰的價值陷阱。</div>
          <div><strong style={{ color: '#34D399' }}>② Minsky 過熱循環低波修正 (P10_MINSKY_ONLY_BAB_SEMIVOL)</strong>：對過去 <code>252D</code> 大漲 <code>&gt; +50%</code> 的景氣強股調升風險平價分母，修正上漲期靜態波動率假平靜錯覺，將 <code>10–26 / Ex26</code> 推至 <strong>28.23% / 27.59%</strong>。</div>
          <div><strong style={{ color: '#A78BFA' }}>③ QQQ 崩盤貝塔尾部風險平價 (P10_MINSKY_QCRASH_BAB_SEMIVOL)</strong>：僅統計 <code>QQQ &lt; -1.0%</code> 科技重挫日的條件下行貝塔並對高敏感股自動減重，將 <code>ExSPY Corr</code> 壓低至 <strong>+0.072</strong>、泰坦重挫月均跌僅 <strong>-0.26%</strong>。</div>
          <div><strong style={{ color: '#FBBF24' }}>④ 2.0x 緩衝 ＋ &plusmn;3% 免摩擦換倉</strong>：維持 <code>5 檔</code>（2 美股＋3 台股）月 22 號單表操作一次、舊持股 <code>2.0&times;</code> 排名內且權重漂移 &le; <strong>&plusmn;3%</strong> 即原單續抱（保留 <code>1.30%</code> 現金尾差），雙倍成本壓測仍保 <strong>26.45%</strong>。</div>
        </div>

        {syncTranche?.previous_rebal_note && (
          <div style={{ fontSize: '0.73rem', color: '#94A3B8', background: 'rgba(15,23,42,0.55)', padding: '0.45rem 0.7rem', borderRadius: '5px' }}>
            💡 {syncTranche.previous_rebal_note}
          </div>
        )}
      </div>

      {/* =================================================================
          3. 🏛️ 當期 V10 極簡 22 號單表實盤持倉 (`5 檔旗艦` / `6 檔均衡` / `候補雷達`)
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.1rem', borderTop: '3px solid #38BDF8' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <div>
            <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.05rem' }}>
              🏛️ V10_Sync22 當期實盤五檔精銳單表（{mergedHoldings.length} 檔實佔 {activeSummary.stocks_mtm_sum_pct ?? 98.70}%・0 子梯隊）
            </h4>
            <div style={{ fontSize: '0.73rem', color: '#6EE7B7', marginTop: '3px' }}>
              ✅ 與全球主權泰坦【每月 22 號 B 梯】同日動作一次（{nextRebalCountdown.rebalDate} 訊號 ➔ {nextRebalCountdown.entryDate} 開盤成交），全月免再調整，下次回測換倉日：{nextRebalCountdown.next}。
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'holdings', label: `🎯 旗艦精銳 5 檔單表 (${mergedHoldings.length} 檔 = ${activeSummary.stocks_mtm_sum_pct ?? 98.70}%)` },
              { id: 'n6_holdings', label: `⚖️ 穩健均衡 6 檔對照 (${n6Holdings.length} 檔 = ${activeSummary.n6_stocks_mtm_sum_pct ?? 96.38}%)` },
              { id: 'watchlist', label: '📡 非泰坦實體營運候補雷達' },
            ].map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => {
                  setPicksTab(tb.id);
                  if (tb.id === 'holdings') setRebalMode('sync22_n5');
                  if (tb.id === 'n6_holdings') setRebalMode('sync22_n6');
                }}
                className={picksTab === tb.id ? 'btn' : 'btn btn-secondary'}
                style={{ fontSize: '0.76rem', padding: '0.32rem 0.72rem' }}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>

        {picksTab === 'holdings' && renderSingleHoldingsTable(mergedHoldings)}
        {picksTab === 'n6_holdings' && renderSingleHoldingsTable(n6Holdings)}

        {picksTab === 'watchlist' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: '1rem' }}>
            {[
              { title: '🇺🇸 美股 S&P 500 PIT 候補 Top 15 (非泰坦・V10_Sync22 六柱合意)', list: data?.top_watchlist_candidates?.us || [] },
              { title: '🇹🇼 台股純上市 0050∪0051 PIT 候補 Top 12 (非泰坦・V10_Sync22 六柱合意)', list: data?.top_watchlist_candidates?.tw || [] },
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
                      <th style={{ textAlign: 'right' }}>G5分位</th>
                      <th style={{ textAlign: 'right' }}>CbOP / 營業槓桿</th>
                      <th style={{ textAlign: 'right' }}>合意Z</th>
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
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.7rem', color: '#CBD5E1' }}>{fmtNum(w.z_cbop, 1)} / {fmtNum(w.z_oplev ?? w.z_glob_rev, 1)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{fmtNum(w.composite, 2)}</td>
                        <td style={{ textAlign: 'center' }}>{w.in_active ? '🟢 5檔持倉' : w.in_n6_active ? '⚖️ 6檔持倉' : '⚪ 觀察中'}</td>
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
          4. 🎯 V10 五檔22號一鍵同步跟單計算機 與 💼 我的目前持股 & 交易流水帳
         ================================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '1rem' }}>
        <div className="glass-card" style={{ padding: '1rem', borderTop: '3px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, color: '#FDE047' }}>🎯 V10 五檔每月 22 號跟單下單計算機 ({rebalanceSuggestions.length} 筆建議)</h4>
            <select
              value={rebalMode}
              onChange={(e) => setRebalMode(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.85)', color: '#F8FAFC', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.28rem 0.55rem', fontSize: '0.75rem' }}
            >
              <option value="sync22_n5">{`🎯 旗艦精銳 5 檔單表 (V10_Sync22・主力推薦)`}</option>
              {n6Holdings.length > 0 && (
                <option value="sync22_n6">{`⚖️ 穩健均衡 6 檔單表 (V10_N6_Balanced)`}</option>
              )}
            </select>
          </div>

          {rebalanceSuggestions.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: '#34D399', padding: '1.2rem', textAlign: 'center', background: 'rgba(16,185,129,0.08)', borderRadius: '6px' }}>
              ✅ 目前持股已完全對齊本期 22 號單表目標權重（只需等下次 22 號換倉：{nextRebalCountdown.next}）！
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
          5. 📈 互動式多策略累積淨值曲線與泰坦×V10 槓鈴壓力比較
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #A855F7' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, color: '#E9D5FF' }}>📈 累積淨值走勢對照（V10_Sync22 五檔旗艦 × V10_N6 × V10_SOV3 × 泰坦雙艙槓鈴 vs 舊 V7 &amp; SPY）</h4>
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
              {chartShowTitan ? '隱藏單泰坦母艦' : '疊加單泰坦 (604x)'}
            </button>
          </div>
        </div>

        {renderEquitySvg()}

        {/* 危機區間抗震表現總表 */}
        <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th>歷史壓力區間</th>
                <th style={{ textAlign: 'right' }}>SPY 大盤</th>
                <th style={{ textAlign: 'right' }}>Global Titan</th>
                <th style={{ textAlign: 'right' }}>舊 V7 五梯</th>
                <th style={{ textAlign: 'right' }}>V10_Sync22 (5檔)</th>
                <th style={{ textAlign: 'right' }}>V10_N6 (6檔)</th>
                <th style={{ textAlign: 'right' }}>V10_SOV3</th>
                <th style={{ textAlign: 'right' }}>50/50 泰坦×V10 (SA)</th>
                <th style={{ textAlign: 'right' }}>70/30 泰坦×V10 (Q)</th>
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
                { key: 'ytd_2026', label: `2026 YTD (截至 ${data?.latest_data_date?.slice(5)?.replace('-', '/') || '11/19'})` },
              ].map((rg) => (
                <tr key={rg.key}>
                  <td><strong>{rg.label}</strong></td>
                  {['spy', 'titan', 'v7_lowturn', 'v3_core', 'v7_cochamp', 'v3_champ', 'bb50_sa', 'bb70_q', 'bb50_spy_sa'].map((sk) => {
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
          6. 📅 2005–2026 全 22 年 PIT 逐年績效與 262 期每月 22 號單表溯源帳本
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #3B82F6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <h4 style={{ margin: 0, color: '#93C5FD' }}>📅 2005–2026 全 22 年零空窗 PIT 逐年績效與 {pa?.gatekeeper_b1_b5_report?.rebalance_periods_checked ?? 262} 期每月 22 號帳本</h4>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="搜尋股票代號或名稱 (如 2207 / NEM / FICO)..."
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
          <table className="custom-table" style={{ width: '100%', fontSize: '0.77rem' }}>
            <thead>
              <tr>
                <th>年份</th>
                <th style={{ textAlign: 'right' }}>V10_Sync22 (5檔)</th>
                <th style={{ textAlign: 'right' }}>V10_N6 (6檔)</th>
                <th style={{ textAlign: 'right' }}>V10_SOV3</th>
                <th style={{ textAlign: 'right' }}>50/50 槓鈴</th>
                <th style={{ textAlign: 'right' }}>Global Titan</th>
                <th style={{ textAlign: 'right' }}>SPY 大盤</th>
                <th style={{ textAlign: 'right' }}>超額 SPY</th>
                <th style={{ textAlign: 'right' }}>V10 年內 MDD</th>
                <th style={{ textAlign: 'center' }}>22號調倉期 / 持股</th>
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
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: (yr.cochamp_ret_pct ?? 0) >= 0 ? '#FDE047' : '#FCA5A5' }}>{fmtPct(yr.cochamp_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.champ_ret_pct >= 0 ? '#A7F3D0' : '#FCA5A5' }}>{fmtPct(yr.champ_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>{fmtPct(yr.bb50_sa_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FBBF24' }}>{fmtPct(yr.titan_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>{fmtPct(yr.spy_ret_pct)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.alpha_vs_spy >= 0 ? '#34D399' : '#F87171' }}>{fmtPct(yr.alpha_vs_spy)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.yearly_mdd_pct >= -15 ? '#34D399' : '#FBBF24' }}>{fmtPct(yr.yearly_mdd_pct, false)}</td>
                      <td style={{ textAlign: 'center' }}>{(yr.rebalances || []).length} 期 / {yr.unique_stocks_count} 檔</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} style={{ padding: '0.6rem', background: 'rgba(15,23,42,0.72)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                            {(yr.rebalances || []).map((rb, idxRb) => (
                              <div key={`${rb.tranche}_${rb.rebal_date}_${idxRb}`} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                                <div style={{ fontSize: '0.73rem', color: '#93C5FD', marginBottom: '0.35rem', fontWeight: 'bold' }}>
                                  {rb.tranche} ｜ 22號訊號 {rb.rebal_date} ｜ 進場 {rb.entry_date} ➔ 出場 {rb.exit_date}
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
          7. 🔬 Round 10 (`V10_Sync22`) 8 道檢察官嚴酷拷問與逐筆 PIT 實證
         ================================================================= */}
      <div className="glass-card" style={{ padding: '1.15rem', borderTop: '3px solid #10B981' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.8rem' }}>
          <h4 style={{ margin: 0, color: '#6EE7B7' }}>🔬 Round 10 (<code>V10_Sync22</code>) 8 道檢察官嚴酷拷問與逐筆 PIT 實證</h4>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {[
              { id: 'grid27', label: '📐 27 參數高原' },
              { id: 'gate0', label: '🌪️ Gate 0 日22裸訊號 & 崩盤保護' },
              { id: 'loop1', label: '🪜 證偽對照 & V10 三階升級' },
              { id: 'loo', label: '✂️ LOO 六因子・對稱防呆・Minsky・QCrash消融' },
              { id: 'phase', label: '📅 月內 1/10/15/22 號錨點' },
              { id: 'harsh_jk', label: '💸 2x成本 & 刀切去 Top-10' },
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
            <div style={{ fontSize: '0.8rem', color: '#CBD5E1', marginBottom: '0.55rem' }}>
              👑 <strong>V10_Sync22 五檔旗艦 27 格參數高原 (HB&isin;&#123;1.8,2.0,2.2&#125; &times; DriftTol&isin;&#123;2%,3%,4%&#125; &times; CatTilt&isin;&#123;-3%,0,+3%&#125;)</strong>：
              中位 CAGR = <strong style={{ color: '#34D399' }}>{pa?.grid_27_summary?.median_cagr_10_26}%</strong> (Ex26 {pa?.grid_27_summary?.median_ex26_cagr}%) ｜
              全距 <strong>[{pa?.grid_27_summary?.min_cagr_10_26}%, {pa?.grid_27_summary?.max_cagr_10_26}%]</strong> ｜
              中位 Sharpe / Calmar = <strong>{pa?.grid_27_summary?.median_sharpe_10_26} / {pa?.grid_27_summary?.median_calmar_10_26}</strong> ｜
              正交 <strong style={{ color: '#34D399' }}>{pa?.grid_27_summary?.pass_ortho_count ?? 27}/{pa?.grid_27_summary?.n_cells}</strong> 全過 ｜ &ge;24.5% 達標 = <strong style={{ color: '#FDE047' }}>{pa?.grid_27_summary?.pass_bar_count ?? 18} / {pa?.grid_27_summary?.n_cells}</strong>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.45rem' }}>
              {(pa?.grid_27_summary?.cells || []).map((c) => {
                const ok = c.pass_bar ?? c.pass_v8_bar ?? c.pass_ortho;
                return (
                  <div
                    key={c.label}
                    style={{
                      background: ok ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                      border: `1px solid ${ok ? 'rgba(16,185,129,0.28)' : 'rgba(245,158,11,0.35)'}`,
                      borderRadius: '6px',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.72rem',
                    }}
                  >
                    <div style={{ fontWeight: 'bold', color: '#E2E8F0' }}>{c.label.replace(/^V(?:8|9|10)\w*_HB/, 'HB')} {ok ? '✅' : '⚠️'}</div>
                    <div style={{ fontFamily: 'monospace', color: ok ? '#34D399' : '#FBBF24', fontWeight: 'bold', fontSize: '0.86rem' }}>{c.cagr_10_26}% (Ex26 {c.ex26_cagr}%)</div>
                    <div style={{ fontFamily: 'monospace', color: '#94A3B8' }}>Cal {c.calmar_10_26} ｜ Shp {c.sharpe_10_26} ｜ ExC {c.ex_spy_corr >= 0 ? '+' : ''}{c.ex_spy_corr}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {prosecutorTab === 'gate0' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowX: 'auto' }}>
            {pa?.gate0_naked_event_study?.['21D_Monthly'] && (
              <div>
                <div style={{ fontWeight: 'bold', color: '#34D399', fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                  🔍 Gate 0 每月 22 號裸訊號 Q5−Q1 多空 21D 事件研究（2005–2025 Ex-2026，Pooled 1,745 vs 美股 US vs 台股 TW）
                </div>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.74rem' }}>
                  <thead>
                    <tr>
                      <th>因子矩陣 (@ 每月 22 號)</th>
                      <th style={{ textAlign: 'right' }}>21D 全池 (NW-t)</th>
                      <th style={{ textAlign: 'right' }}>21D 美股 US (NW-t)</th>
                      <th style={{ textAlign: 'right' }}>21D 台股 TW (NW-t)</th>
                      <th style={{ textAlign: 'right' }}>G1 (05–15) / G2 (16–25)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(pa.gate0_naked_event_study['21D_Monthly']).map(([k, v]) => {
                      const isCtrl = k.startsWith('Ctrl_');
                      return (
                        <tr key={k}>
                          <td><strong style={{ color: isCtrl ? '#F87171' : '#E2E8F0' }}>{k}{isCtrl ? ' (證偽對照)' : ''}</strong></td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: v.pooled?.ex26_mean_pct > 0 ? '#34D399' : '#F87171' }}>
                            {fmtPct(v.pooled?.ex26_mean_pct)} ({v.pooled?.nw_t >= 0 ? '+' : ''}{v.pooled?.nw_t})
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {fmtPct(v.us?.ex26_mean_pct)} ({v.us?.nw_t >= 0 ? '+' : ''}{v.us?.nw_t})
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {v.tw?.ex26_mean_pct !== undefined ? `${fmtPct(v.tw?.ex26_mean_pct)} (${v.tw?.nw_t >= 0 ? '+' : ''}${v.tw?.nw_t})` : '--'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {fmtPct(v.pooled?.g1_05_15_pct)} / {fmtPct(v.pooled?.g2_16_25_pct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <div style={{ fontWeight: 'bold', color: '#93C5FD', fontSize: '0.82rem', marginBottom: '0.35rem' }}>📐 雙世代穩健度審計：G1 (2005–2015 含海嘯) vs G2 (2016–2026) 與嚴格正交檢核</div>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.74rem' }}>
                <thead>
                  <tr>
                    <th>策略引擎 / 架構對比</th>
                    <th style={{ textAlign: 'right' }}>G1 (05–15)</th>
                    <th style={{ textAlign: 'right' }}>G2 (16–26)</th>
                    <th style={{ textAlign: 'right' }}>10–26 CAGR / Cal</th>
                    <th style={{ textAlign: 'right' }}>Ex26</th>
                    <th style={{ textAlign: 'right' }}>ExSPY / 重疊 / MaxW</th>
                    <th style={{ textAlign: 'center' }}>正交檢核</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pa?.dual_era_audit || {}).map(([k, v]) => {
                    const ok = v.strictly_orthogonal ?? true;
                    return (
                      <tr key={k}>
                        <td><strong>{k}</strong></td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.g1_05_15?.cagr}% (Shp {v.g1_05_15?.sharpe})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399' }}>{v.g2_16_26?.cagr}% (Shp {v.g2_16_26?.sharpe})</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{v.cagr_10_26}% / {v.calmar_10_26}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.cagr_ex26}%</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v.ex_spy_corr >= 0 ? '+' : ''}{v.ex_spy_corr} / {v.overlap_pct}% / {v.cur_max_w}%</td>
                        <td style={{ textAlign: 'center' }}>{ok ? '✅ 過關' : '⚠️ ExC>0.15'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pa?.titan_crash_months?.sleeves && (
              <div>
                <div style={{ fontWeight: 'bold', color: '#FBBF24', fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                  🌪️ 泰坦重挫月份護航實測（2010–2026 共 {pa?.titan_crash_months?.n_crash_months} 個泰坦月跌 &lt; -3%，泰坦平均 {pa?.titan_crash_months?.titan_mean_pct}%）
                </div>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.74rem' }}>
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
          <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th>Loop 1：證偽對照 ＆ 每月 22 號單表進化實證階梯</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>05–26 全期</th>
                <th style={{ textAlign: 'right' }}>mMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                <th style={{ textAlign: 'right' }}>ExSPY / 重疊</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pa?.loop1_ablations || {}).map(([k, ev]) => {
                const isFal = k.includes('Falsified');
                return (
                  <tr key={k}>
                    <td><strong style={{ color: isFal ? '#F87171' : '#E2E8F0' }}>{isFal ? '⛔ ' : '✅ '}{k}</strong></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isFal ? '#F87171' : '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe} / {ev.era_2010_2026?.calmar}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.corr_ex_spy_vs_titan_10_26 >= 0 ? '+' : ''}{ev.corr_ex_spy_vs_titan_10_26} / {ev.overlap?.mean_weight_overlap_pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'loo' && (
          <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th>LOO 六因子・對稱防呆・Minsky・QCrash 消融檢定 (V10_Sync22 五檔)</th>
                <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                <th style={{ textAlign: 'right' }}>Ex26</th>
                <th style={{ textAlign: 'right' }}>mMDD / dMDD</th>
                <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                <th style={{ textAlign: 'right' }}>ExSPY</th>
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
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', color: ev.corr_ex_spy_vs_titan_10_26 > 0.15 ? '#F87171' : '#CBD5E1' }}>
                    {ev.corr_ex_spy_vs_titan_10_26 >= 0 ? '+' : ''}{ev.corr_ex_spy_vs_titan_10_26}
                  </td>
                  <td>
                    {k === 'Full_Base'
                      ? '🏆 完整 V10 五檔 22 號單表（零冗餘最優解）'
                      : k.includes('SymHoldHygiene')
                        ? '⚠️ 退回舊 V9 非對稱續抱，年化掉 -0.83%'
                        : k.includes('MinskyQCrashSV')
                          ? '⚠️ 退回舊 V9 BAB 分母，Sharpe 降且 ExSPY 升至 +0.088'
                          : k.includes('HoldBuffer')
                            ? '⚠️ 拿掉 2.0x 緩衝後週轉暴增、報酬掉 -4.11%'
                            : k.includes('oplev') || k.includes('Drop_Factor_grw')
                              ? '⚠️ 拿掉後年化下滑且 ExSPY 破 0.189 失正交'
                              : k.includes('AntiTrap')
                                ? '⚠️ 拿掉進場與續抱防呆回撤惡化至 -22.26%'
                                : '✅ 具實質報酬、正交度或回撤貢獻'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {prosecutorTab === 'phase' && (
          <div>
            <div style={{ fontSize: '0.78rem', color: '#CBD5E1', marginBottom: '0.5rem' }}>
              月內四大日曆錨點對照均值 = <strong style={{ color: '#34D399' }}>{pa?.phase_invariance?.mean_cagr ?? 23.96}%</strong> ｜ 避開月初買盤湧入（Day 01 ExSPY +0.153 失正交），<strong>22 號（泰坦 B 梯同步）</strong>創下全錨點最高 <code>28.24% / Ex-2026 27.60%</code> 與極優正交（<code>ExSPY +0.072</code>）。
            </div>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.76rem' }}>
              <thead>
                <tr>
                  <th>月內單表執行日期錨點</th>
                  <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                  <th style={{ textAlign: 'right' }}>Ex26</th>
                  <th style={{ textAlign: 'right' }}>05–26 全期</th>
                  <th style={{ textAlign: 'right' }}>mMDD</th>
                  <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(pa?.phase_invariance?.phases || {}).map(([k, ev]) => (
                  <tr key={k}>
                    <td><strong style={{ color: k.includes('Day_22') ? '#34D399' : '#E2E8F0' }}>{k}</strong></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe} / {ev.era_2010_2026?.calmar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {prosecutorTab === 'harsh_jk' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  <th>雙倍成本 (2x Harsh) 與 全週期刀切法 (Jackknife) 壓測</th>
                  <th style={{ textAlign: 'right' }}>10–26 CAGR</th>
                  <th style={{ textAlign: 'right' }}>Ex26</th>
                  <th style={{ textAlign: 'right' }}>05–26</th>
                  <th style={{ textAlign: 'right' }}>mMDD</th>
                  <th style={{ textAlign: 'right' }}>Sharpe / Calmar</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...Object.entries(pa?.harsh_2x_cost || {}).map(([k, v]) => [k, v]),
                  ['V10_Sync22 五檔旗艦永久剔除 Top-3 大贏家', pa?.jackknife_drop_top3_top5?.drop_top3],
                  ['V10_Sync22 五檔旗艦永久剔除 Top-5 大贏家', pa?.jackknife_drop_top3_top5?.drop_top5],
                  ['V10_Sync22 五檔旗艦永久剔除 Top-10 大贏家', pa?.jackknife_drop_top3_top5?.drop_top10],
                  ['V10_N6 均衡六檔永久剔除 Top-3 大贏家', pa?.jackknife_drop_top3_top5?.cochamp?.drop_top3],
                  ['V10_N6 均衡六檔永久剔除 Top-10 大贏家', pa?.jackknife_drop_top3_top5?.cochamp?.drop_top10],
                ].map(([lbl, ev]) => ev && (
                  <tr key={lbl}>
                    <td><strong>{lbl}</strong></td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>{ev.era_2010_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2025_ex26?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2005_2026?.cagr}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.m_mdd}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{ev.era_2010_2026?.sharpe} / {ev.era_2010_2026?.calmar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              🏅 全週期 17 年累計 Top-10 功臣股剔除名單：{(pa?.jackknife_drop_top3_top5?.top10_contributors || []).map(([t, v]) => `${t} (${v}%)`).join('、')}
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
            <h4 style={{ margin: '0 0 0.85rem 0', color: '#FDE047' }}>💰 V10 22號互補帳戶資金管理</h4>
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
