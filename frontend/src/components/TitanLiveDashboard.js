import React, { useState, useEffect, useMemo, useRef } from 'react';
import titanOpenPositionsData from '../data/titan_open_positions.json';
import { getCurrentUser, apiGetTaiwanTitanPortfolio, apiSaveTaiwanTitanPortfolio } from '../api';

const STORAGE_KEY_POSITIONS = 'taiwan_titan_user_positions_v1';
const STORAGE_KEY_IDLE_CASH = 'taiwan_titan_idle_cash_v1';
const STORAGE_KEY_ALL_TX = 'taiwan_titan_tx_history_v1';
const STORAGE_KEY_DISMISSED_SUGG = 'taiwan_titan_dismissed_sugg_v1';

const getTaiwanTitanStorageKeys = (username) => ({
  positions: `taiwan_titan_user_positions_v2_${username}`,
  idleCash: `taiwan_titan_idle_cash_v2_${username}`,
  allTx: `taiwan_titan_tx_history_v2_${username}`,
  dismissedSugg: `taiwan_titan_dismissed_sugg_v2_${username}`
});

// 預設台股泰坦持股部位 (70% 王者 + 15% 雙衛星)
const DEFAULT_POSITIONS = [
  {
    id: 'pos_tw_2408',
    stock_id: '2408',
    stock_name: '南亞科',
    role: '👑 王者泰坦 (70%)',
    shares: 1000,
    entry_price: 550.0,
    current_price: 527.0,
    entry_date: '2026-10-01',
    entry_fee: 783,
    stop_loss_price: 498.0,
    stop_condition: '5MA拉回進場 · 破60MA季線($498.0)停損'
  },
  {
    id: 'pos_tw_8069',
    stock_id: '8069',
    stock_name: '元太',
    role: '🚀 革命衛星 (15%)',
    shares: 500,
    entry_price: 225.0,
    current_price: 149.0,
    entry_date: '2026-10-01',
    entry_fee: 160,
    stop_loss_price: 205.0,
    stop_condition: '動能領先突破 · 破60MA季線($205.0)停損'
  },
  {
    id: 'pos_tw_3037',
    stock_id: '3037',
    stock_name: '欣興',
    role: '🚀 革命衛星 (15%)',
    shares: 100,
    entry_price: 1195.0,
    current_price: 1255.0,
    entry_date: '2026-10-01',
    entry_fee: 170,
    stop_loss_price: 1026.0,
    stop_condition: '載板龍頭主升段 · 破60MA季線($1026.0)停損'
  }
];

const DEFAULT_TX_HISTORY = [
  {
    id: 'tx_tw_init_deposit',
    date: '2026-10-01',
    action: '投入現金',
    stock_id: '-',
    stock_name: '初始本金入金',
    shares: 0,
    price: 0,
    tax_fee: 0,
    cash_flow_twd: 1000000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '台股王者泰坦策略 初始開倉本金'
  },
  {
    id: 'tx_tw_1',
    date: '2026-10-01',
    action: '買入',
    stock_id: '2408',
    stock_name: '南亞科',
    shares: 1000,
    price: 550.0,
    tax_fee: 783,
    cash_flow_twd: -550783,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 👑 王者泰坦 (70%)'
  },
  {
    id: 'tx_tw_2',
    date: '2026-10-01',
    action: '買入',
    stock_id: '8069',
    stock_name: '元太',
    shares: 500,
    price: 225.0,
    tax_fee: 160,
    cash_flow_twd: -112660,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 🚀 革命衛星 (15%)'
  },
  {
    id: 'tx_tw_3',
    date: '2026-10-01',
    action: '買入',
    stock_id: '3037',
    stock_name: '欣興',
    shares: 100,
    price: 1195.0,
    tax_fee: 170,
    cash_flow_twd: -119670,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 🚀 革命衛星 (15%)'
  }
];

export default function TitanLiveDashboard() {
  const [loading, setLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // 登入使用者身分與帳本歸屬 (以歷史交易為唯一真實核心)
  const currentUser = getCurrentUser();
  const currentUsername = currentUser?.username || 'guest';
  const storageKeys = useMemo(() => getTaiwanTitanStorageKeys(currentUsername), [currentUsername]);

  // 雲端同步狀態: 'idle' | 'syncing' | 'synced' | 'saving' | 'saved' | 'error'
  const [cloudSyncStatus, setCloudSyncStatus] = useState('syncing');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const isInitialCloudLoad = useRef(true);
  const autoSaveTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 當前持股部位
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.positions) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_POSITIONS) : null);
      return saved ? JSON.parse(saved) : DEFAULT_POSITIONS;
    } catch { return DEFAULT_POSITIONS; }
  });

  // 歷史交易流水帳 (全進出紀錄) - 唯一真實來源
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.allTx) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_ALL_TX) : null);
      let list = saved ? JSON.parse(saved) : DEFAULT_TX_HISTORY;
      if (!Array.isArray(list) || list.length === 0) list = DEFAULT_TX_HISTORY;
      // 確保歷史紀錄一定有入金流水帳 (若舊快取沒有入金，自動補上 10/1 初始入金 100 萬)
      const hasDeposit = list.some(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')));
      if (!hasDeposit) {
        list = [DEFAULT_TX_HISTORY[0], ...list];
        try { localStorage.setItem(storageKeys.allTx, JSON.stringify(list)); } catch {}
      }
      return list;
    } catch { return DEFAULT_TX_HISTORY; }
  });

  // 閒置現金 (TWD) - 100% 由歷史全進出與入金流水帳 (txHistory) 的現金流動態加總推導！
  const idleCash = useMemo(() => {
    return txHistory.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
  }, [txHistory]);

  // 累計入金本金 (TWD) - 100% 由歷史紀錄推導
  const totalDepositsTwd = useMemo(() => {
    const sum = txHistory
      .filter(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')))
      .reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
    return sum > 0 ? sum : 1000000;
  }, [txHistory]);

  const setIdleCash = () => {}; // 保持相容性，閒置現金已全面自動化由 txHistory 計算

  // 已送出/消掉的更動建議 key
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.dismissedSugg) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_DISMISSED_SUGG) : null);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // 表格內即時修改的建議數據暫存
  const [customEdits, setCustomEdits] = useState({});

  // 現金調整彈窗
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashInputAmount, setCashInputAmount] = useState('');
  const [cashActionType, setCashActionType] = useState('deposit'); // 'deposit' or 'set'

  // 手動出場彈窗
  const [exitModal, setExitModal] = useState({
    open: false,
    posId: '',
    stock_id: '',
    stock_name: '',
    shares: 0,
    entry_price: 0,
    entry_date: '',
    entry_fee: 0,
    exit_price: '',
    exit_date: new Date().toISOString().split('T')[0],
    exit_tax_fee: '',
    reason: '平倉獲利了結'
  });

  // 編輯/新增歷史紀錄彈窗
  const [editTxModal, setEditTxModal] = useState({
    open: false,
    isNew: false,
    id: '',
    date: '',
    action: '買入',
    stock_id: '',
    stock_name: '',
    shares: '',
    price: '',
    tax_fee: '',
    cash_flow_twd: '',
    realized_pnl_twd: '',
    realized_return_pct: '',
    note: ''
  });

  // 編輯/新增持股部位彈窗
  const [editPosModal, setEditPosModal] = useState({
    open: false,
    isNew: false,
    id: '',
    stock_id: '',
    stock_name: '',
    role: '👑 王者泰坦 (70%)',
    shares: '',
    entry_price: '',
    current_price: '',
    entry_date: new Date().toISOString().split('T')[0],
    entry_fee: '0',
    stop_loss_price: '',
    stop_condition: '',
    syncBuyTx: true
  });

  // 加權指數大盤現況
  const taiex = {
    close: 24150,
    ma20: 23620,
    ma60: 22890,
    bullish: true,
    statusText: '加權指數穩站 60MA 季線與 20MA 月線之上，安全氣囊判定多頭有效 ➔ 100% 滿倉重壓台股王者！'
  };

  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  // 1. 當切換登入使用者或載入組件時，自動從 Supabase PostgreSQL 雲端資料庫撈取該使用者的台股專屬帳本
  useEffect(() => {
    let isMounted = true;
    isInitialCloudLoad.current = true;
    setCloudSyncStatus('syncing');

    const fetchCloudPortfolio = async () => {
      try {
        const res = await apiGetTaiwanTitanPortfolio(currentUsername);
        if (!isMounted) return;
        if (res && res.status === 'ok') {
          if (Array.isArray(res.positions) && res.positions.length > 0) {
            setUserPositions(res.positions);
            try { localStorage.setItem(storageKeys.positions, JSON.stringify(res.positions)); } catch {}
          }
          if (Array.isArray(res.tx_history) && res.tx_history.length > 0) {
            setTxHistory(res.tx_history);
            try { localStorage.setItem(storageKeys.allTx, JSON.stringify(res.tx_history)); } catch {}
          }
          if (Array.isArray(res.dismissed_suggestions)) {
            setDismissedSuggestions(res.dismissed_suggestions);
            try { localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(res.dismissed_suggestions)); } catch {}
          }
          setCloudSyncStatus('synced');
          setLastSyncTime(new Date());
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn('台股雲端帳本讀取失敗，使用本機快取:', err);
        setCloudSyncStatus('error');
      } finally {
        setTimeout(() => {
          if (isMounted) isInitialCloudLoad.current = false;
        }, 600);
      }
    };

    fetchCloudPortfolio();
    return () => { isMounted = false; };
  }, [currentUsername, storageKeys]);

  // 2. 本地持久化儲存與防抖雲端同步 (任何更動皆自動寫入本機與 Supabase 雲端資料庫)
  useEffect(() => {
    try { localStorage.setItem(storageKeys.idleCash, String(idleCash)); } catch {}
    try { localStorage.setItem(storageKeys.positions, JSON.stringify(userPositions)); } catch {}
    try { localStorage.setItem(storageKeys.allTx, JSON.stringify(txHistory)); } catch {}
    try { localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(dismissedSuggestions)); } catch {}

    // 初始雲端加載期間，避免用預設值反向覆蓋雲端已有數據
    if (isInitialCloudLoad.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setCloudSyncStatus('saving');
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await apiSaveTaiwanTitanPortfolio({
          username: currentUsername,
          positions: userPositions,
          tx_history: txHistory,
          dismissed_suggestions: dismissedSuggestions
        });
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        setTimeout(() => setCloudSyncStatus('synced'), 2500);
      } catch (err) {
        console.warn('台股自動雲端儲存失敗:', err);
        setCloudSyncStatus('error');
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [idleCash, userPositions, txHistory, dismissedSuggestions, storageKeys, currentUsername]);

  // 3. 自動將「當前持股部位」的現價 (current_price)，依據最新市場行情動態對齊！
  // 嚴格保留使用者的進場成本 entry_price、股數與進場時間！
  useEffect(() => {
    const picks = titanOpenPositionsData?.open_positions || [];
    if (!picks || picks.length === 0) return;
    setUserPositions(prev => {
      let changed = false;
      const next = prev.map(p => {
        const match = picks.find(cp => cp.stock_id === p.stock_id || cp.stock_name === p.stock_name);
        const newPrice = match ? (match.current_price || match.latest_price) : null;
        if (newPrice && newPrice > 0 && p.current_price !== newPrice) {
          changed = true;
          return { ...p, current_price: newPrice };
        }
        return p;
      });
      return changed ? next : prev;
    });
  }, []);

  // 自動將「當前持股部位」的成本均價、股數與費用，100% 嚴格綁定對齊「歷史交易流水帳」最新買入明細！
  useEffect(() => {
    if (!Array.isArray(txHistory) || txHistory.length === 0) return;
    setUserPositions(prev => {
      let changed = false;
      const next = prev.map(p => {
        const matchTx = txHistory.find(tx => 
          (tx.action === '買入' || tx.action === '加碼') && 
          (tx.stock_id === p.stock_id || 
           (tx.stock_id && p.stock_id && tx.stock_id.split('.')[0] === p.stock_id.split('.')[0]) || 
           (tx.stock_name && p.stock_name && (tx.stock_name.includes(p.stock_name.slice(0, 2)) || p.stock_name.includes(tx.stock_name.slice(0, 2)))))
        );
        if (matchTx && matchTx.price > 0) {
          const nextPrice = matchTx.price;
          const nextShares = matchTx.shares > 0 ? matchTx.shares : p.shares;
          const nextFee = matchTx.tax_fee !== undefined ? matchTx.tax_fee : p.entry_fee;
          const nextDate = matchTx.date || p.entry_date;
          if (p.entry_price !== nextPrice || p.shares !== nextShares || p.entry_fee !== nextFee || p.entry_date !== nextDate) {
            changed = true;
            return {
              ...p,
              entry_price: nextPrice,
              shares: nextShares,
              entry_fee: nextFee,
              entry_date: nextDate
            };
          }
        }
        return p;
      });
      return changed ? next : prev;
    });
  }, [txHistory]);

  // 1. 計算持股現值與整體統計
  const { totalStockMarketVal, totalCost, unrealizedPnl, unrealizedReturnPct } = useMemo(() => {
    let marketVal = 0;
    let cost = 0;
    userPositions.forEach(p => {
      const curPrice = p.current_price || p.entry_price;
      marketVal += p.shares * curPrice;
      cost += (p.shares * p.entry_price + (p.entry_fee || 0));
    });
    const pnl = marketVal - cost;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    return {
      totalStockMarketVal: marketVal,
      totalCost: cost,
      unrealizedPnl: pnl,
      unrealizedReturnPct: pct
    };
  }, [userPositions]);

  // 當前總資產淨值 (閒置現金 + 台股市值)
  const totalNetAssets = useMemo(() => {
    return Math.max(0, idleCash + totalStockMarketVal);
  }, [idleCash, totalStockMarketVal]);

  // 帳戶真實總淨利 (總資產淨值 - 累計總入金，全依歷史流水帳計算)
  const totalNetProfitTwd = useMemo(() => {
    return totalNetAssets - totalDepositsTwd;
  }, [totalNetAssets, totalDepositsTwd]);

  const totalNetProfitPct = useMemo(() => {
    return totalDepositsTwd > 0 ? (totalNetProfitTwd / totalDepositsTwd) * 100 : 0;
  }, [totalNetProfitTwd, totalDepositsTwd]);

  // 2. 歷史全進出紀錄統計 (已實現損益、勝率、總稅費)
  const { totalRealizedPnl, totalTaxesPaid, closedTradesCount, winningTradesCount, winRate } = useMemo(() => {
    let pnl = 0;
    let taxes = 0;
    let closedCount = 0;
    let winCount = 0;

    txHistory.forEach(tx => {
      if (tx.tax_fee) taxes += tx.tax_fee;
      if (tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined) {
        pnl += tx.realized_pnl_twd;
        closedCount += 1;
        if (tx.realized_pnl_twd > 0) winCount += 1;
      }
    });

    return {
      totalRealizedPnl: pnl,
      totalTaxesPaid: taxes,
      closedTradesCount: closedCount,
      winningTradesCount: winCount,
      winRate: closedCount > 0 ? (winCount / closedCount) * 100 : 0
    };
  }, [txHistory]);

  // 3. 台股泰坦候選目標持股 (70% 王者 + 15% 衛星1 + 15% 衛星2)
  const targetCandidates = useMemo(() => {
    const defaultCandidates = [
      {
        stock_id: '2408',
        stock_name: '南亞科',
        role: '👑 王者泰坦 (70%)',
        target_weight_pct: 70,
        price: 568.0,
        ma60: 498.0,
        stop_condition: '5MA拉回進場 · 破60MA季線停損'
      },
      {
        stock_id: '8069',
        stock_name: '元太',
        role: '🚀 革命衛星 (15%)',
        target_weight_pct: 15,
        price: 238.0,
        ma60: 205.0,
        stop_condition: '動能領先突破 · 破60MA季線停損'
      },
      {
        stock_id: '3037',
        stock_name: '欣興',
        role: '🚀 革命衛星 (15%)',
        target_weight_pct: 15,
        price: 1270.0,
        ma60: 1026.0,
        stop_condition: '載板龍頭主升段 · 破60MA季線停損'
      }
    ];

    if (titanOpenPositionsData?.open_positions && titanOpenPositionsData.open_positions.length > 0) {
      return titanOpenPositionsData.open_positions.map((p, idx) => ({
        stock_id: p.stock_id,
        stock_name: p.stock_name,
        role: p.role || (idx === 0 ? '👑 王者泰坦 (70%)' : '🚀 革命衛星 (15%)'),
        target_weight_pct: idx === 0 ? 70 : 15,
        price: p.current_price || p.entry_price || 100,
        ma60: p.ma60_stop_price || 90,
        stop_condition: p.stop_condition || '破60MA季線停損'
      }));
    }
    return defaultCandidates;
  }, []);

  // 4. 台股持倉更動建議演算法 (以當前總資金計算)
  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssets <= 0) return [];

    const suggestions = [];

    // A. 針對目標候選股
    targetCandidates.forEach(cand => {
      const weight = cand.target_weight_pct / 100.0;
      const targetTwd = totalNetAssets * weight;
      const price = cand.price || 1;
      const targetShares = Math.floor(targetTwd / price);

      const heldPos = userPositions.find(p => p.stock_id === cand.stock_id);
      const heldShares = heldPos ? heldPos.shares : 0;
      const diffShares = targetShares - heldShares;

      const suggKey = `tw_sugg_${cand.stock_id}`;
      if (dismissedSuggestions.includes(suggKey)) return;

      if (heldShares === 0 && targetShares > 0) {
        // 買入
        const estFee = Math.max(20, Math.round(targetShares * price * 0.001425));
        suggestions.push({
          key: suggKey,
          action: '買入',
          actionColor: '#10B981',
          stock_id: cand.stock_id,
          stock_name: cand.stock_name,
          targetWeightPct: cand.target_weight_pct,
          targetTwd: targetTwd,
          currentShares: heldShares,
          targetShares: targetShares,
          recShares: targetShares,
          defaultPrice: price,
          defaultTaxFee: estFee,
          role: cand.role,
          heldPos: null
        });
      } else if (diffShares > 0 && Math.abs(diffShares * price) > 5000) {
        // 加碼
        const estFee = Math.max(20, Math.round(diffShares * price * 0.001425));
        suggestions.push({
          key: suggKey,
          action: '加碼',
          actionColor: '#38BDF8',
          stock_id: cand.stock_id,
          stock_name: cand.stock_name,
          targetWeightPct: cand.target_weight_pct,
          targetTwd: targetTwd,
          currentShares: heldShares,
          targetShares: targetShares,
          recShares: diffShares,
          defaultPrice: price,
          defaultTaxFee: estFee,
          role: heldPos?.role || cand.role,
          heldPos: heldPos
        });
      } else if (diffShares < 0 && Math.abs(diffShares * price) > 5000) {
        // 減持
        const reduceShares = Math.abs(diffShares);
        const estTaxFee = Math.round(reduceShares * price * (0.003 + 0.001425));
        suggestions.push({
          key: suggKey,
          action: '減持',
          actionColor: '#F59E0B',
          stock_id: cand.stock_id,
          stock_name: cand.stock_name,
          targetWeightPct: cand.target_weight_pct,
          targetTwd: targetTwd,
          currentShares: heldShares,
          targetShares: targetShares,
          recShares: reduceShares,
          defaultPrice: price,
          defaultTaxFee: estTaxFee,
          role: heldPos?.role || cand.role,
          heldPos: heldPos
        });
      }
    });

    // B. 針對持倉中但不在候選名單中的股票 -> 建議賣出清倉
    userPositions.forEach(heldPos => {
      const isInTarget = targetCandidates.some(c => c.stock_id === heldPos.stock_id);
      const suggKey = `tw_sugg_exit_${heldPos.stock_id}`;
      if (!isInTarget && !dismissedSuggestions.includes(suggKey)) {
        const curPrice = heldPos.current_price || heldPos.entry_price;
        const estTaxFee = Math.round(heldPos.shares * curPrice * (0.003 + 0.001425));
        suggestions.push({
          key: suggKey,
          action: '賣出',
          actionColor: '#EF4444',
          stock_id: heldPos.stock_id,
          stock_name: heldPos.stock_name,
          targetWeightPct: 0,
          targetTwd: 0,
          currentShares: heldPos.shares,
          targetShares: 0,
          recShares: heldPos.shares,
          defaultPrice: curPrice,
          defaultTaxFee: estTaxFee,
          role: heldPos.role,
          heldPos: heldPos
        });
      }
    });

    return suggestions;
  }, [totalNetAssets, targetCandidates, userPositions, dismissedSuggestions]);

  const getRowValues = (sugg) => {
    const edits = customEdits[sugg.key] || {};
    return {
      shares: edits.shares !== undefined ? edits.shares : String(sugg.recShares),
      price: edits.price !== undefined ? edits.price : String(sugg.defaultPrice),
      taxFee: edits.taxFee !== undefined ? edits.taxFee : String(sugg.defaultTaxFee)
    };
  };

  const handleUpdateRowInput = (key, field, val) => {
    setCustomEdits(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: val
      }
    }));
  };

  // 5. 點擊「🚀 確認送出」執行台股調倉建議
  const handleExecuteSuggestion = (sugg) => {
    const rowVal = getRowValues(sugg);
    const actualShares = parseInt(rowVal.shares, 10);
    const actualPrice = parseFloat(rowVal.price);
    const actualTaxFee = parseFloat(rowVal.taxFee || 0);

    if (isNaN(actualShares) || actualShares <= 0 || isNaN(actualPrice) || actualPrice <= 0) {
      alert('請填寫有效的股數與成交價格');
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    if (sugg.action === '買入') {
      const grossValTwd = actualShares * actualPrice;
      const totalCostTwd = grossValTwd + actualTaxFee;

      if (idleCash < totalCostTwd) {
        const proceed = window.confirm(
          `提醒：當前閒置現金 (NT$ ${Math.round(idleCash).toLocaleString()}) 小於買進總成本 (NT$ ${Math.round(totalCostTwd).toLocaleString()})。\n是否依然確認建倉？`
        );
        if (!proceed) return;
      }

      const newPos = {
        id: 'pos_tw_' + Date.now(),
        stock_id: sugg.stock_id,
        stock_name: sugg.stock_name,
        role: sugg.role,
        shares: actualShares,
        entry_price: actualPrice,
        current_price: actualPrice,
        entry_date: today,
        entry_fee: actualTaxFee,
        stop_loss_price: Math.round(actualPrice * 0.9),
        stop_condition: '5MA拉回進場 · 破60MA季線停損'
      };

      setUserPositions(prev => [newPos, ...prev]);
      setIdleCash(prev => prev - totalCostTwd);

      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '買入',
        stock_id: sugg.stock_id,
        stock_name: sugg.stock_name,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -totalCostTwd,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `台股泰坦建倉：${sugg.role} (${actualShares}股)`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【買入】${sugg.stock_name} (${sugg.stock_id}) ${actualShares} 股！扣除閒置現金 NT$ ${Math.round(totalCostTwd).toLocaleString()}`);

    } else if (sugg.action === '加碼') {
      const grossValTwd = actualShares * actualPrice;
      const totalCostTwd = grossValTwd + actualTaxFee;

      setUserPositions(prev => prev.map(p => {
        if (p.stock_id === sugg.stock_id) {
          const oldCost = p.shares * p.entry_price;
          const addCost = actualShares * actualPrice;
          const totalShares = p.shares + actualShares;
          const newAvgPrice = totalShares > 0 ? (oldCost + addCost) / totalShares : p.entry_price;
          return {
            ...p,
            shares: totalShares,
            entry_price: parseFloat(newAvgPrice.toFixed(2)),
            current_price: actualPrice,
            entry_fee: (p.entry_fee || 0) + actualTaxFee
          };
        }
        return p;
      }));

      setIdleCash(prev => prev - totalCostTwd);

      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '加碼',
        stock_id: sugg.stock_id,
        stock_name: sugg.stock_name,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -totalCostTwd,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `台股泰坦調倉：加碼 ${actualShares} 股`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【加碼】${sugg.stock_name} ${actualShares} 股！扣除閒置現金 NT$ ${Math.round(totalCostTwd).toLocaleString()}`);

    } else if (sugg.action === '減持') {
      const grossProceedsTwd = actualShares * actualPrice;
      const netProceedsTwd = grossProceedsTwd - actualTaxFee;

      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const netPnlTwd = grossPnl - actualTaxFee;
      const costBasis = entryPrice * actualShares;
      const netRetPct = costBasis > 0 ? (netPnlTwd / costBasis) * 100 : 0;

      setUserPositions(prev => prev.map(p => {
        if (p.stock_id === sugg.stock_id) {
          return {
            ...p,
            shares: Math.max(0, p.shares - actualShares)
          };
        }
        return p;
      }).filter(p => p.shares > 0));

      setIdleCash(prev => prev + netProceedsTwd);

      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '減持',
        stock_id: sugg.stock_id,
        stock_name: sugg.stock_name,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: netProceedsTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: netRetPct,
        note: `台股泰坦調節：減持 ${actualShares} 股 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【減持】${sugg.stock_name} ${actualShares} 股！回流閒置現金 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);

    } else if (sugg.action === '賣出') {
      const grossProceedsTwd = actualShares * actualPrice;
      const netProceedsTwd = grossProceedsTwd - actualTaxFee;

      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const entryFee = sugg.heldPos?.entry_fee || 0;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const netPnlTwd = grossPnl - entryFee - actualTaxFee;
      const costBasis = entryPrice * actualShares + entryFee;
      const netRetPct = costBasis > 0 ? (netPnlTwd / costBasis) * 100 : 0;

      setUserPositions(prev => prev.filter(p => p.stock_id !== sugg.stock_id));
      setIdleCash(prev => prev + netProceedsTwd);

      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '賣出',
        stock_id: sugg.stock_id,
        stock_name: sugg.stock_name,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: netProceedsTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: netRetPct,
        note: `台股泰坦清倉：完全出場 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`🚪 已成功【清倉賣出】${sugg.stock_name}！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
    }

    setDismissedSuggestions(prev => [...prev, sugg.key]);
  };

  // 6. 現金存入/調整處理
  const handleSaveCashChange = (e) => {
    e.preventDefault();
    const amt = parseFloat(cashInputAmount);
    if (isNaN(amt)) {
      alert('請輸入有效金額');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (cashActionType === 'deposit') {
      setIdleCash(prev => prev + amt);
      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '投入現金',
        stock_id: '-',
        stock_name: '台股資金帳戶',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: amt,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `追加存入台股資金 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 已成功存入 NT$ ${Math.round(amt).toLocaleString()} 至台股閒置現金！`);
    } else {
      const diff = amt - idleCash;
      setIdleCash(amt);
      const newTx = {
        id: 'tx_tw_' + Date.now(),
        date: today,
        action: '調整資金',
        stock_id: '-',
        stock_name: '台股資金帳戶',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: diff,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動校準閒置資金至 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 台股閒置現金已調整為 NT$ ${Math.round(amt).toLocaleString()}！`);
    }

    setCashModalOpen(false);
    setCashInputAmount('');
  };

  // 7. 手動出場彈窗邏輯
  const handleOpenExitModal = (pos) => {
    const curPrice = pos.current_price || pos.entry_price;
    const estTaxFee = Math.round(pos.shares * curPrice * (0.003 + 0.001425));
    setExitModal({
      open: true,
      posId: pos.id,
      stock_id: pos.stock_id,
      stock_name: pos.stock_name,
      shares: pos.shares,
      entry_price: pos.entry_price,
      entry_date: pos.entry_date,
      entry_fee: pos.entry_fee || 0,
      exit_price: String(curPrice),
      exit_date: new Date().toISOString().split('T')[0],
      exit_tax_fee: String(estTaxFee),
      reason: '手動平倉獲利了結'
    });
  };

  const handleConfirmExit = (e) => {
    e.preventDefault();
    const exitPriceNum = parseFloat(exitModal.exit_price);
    const taxFeeNum = parseFloat(exitModal.exit_tax_fee || 0);
    if (!exitPriceNum || exitPriceNum <= 0) {
      alert('請輸入有效的出場成交價格');
      return;
    }

    const grossProceedsTwd = exitModal.shares * exitPriceNum;
    const netProceedsTwd = grossProceedsTwd - taxFeeNum;

    const grossPnl = (exitPriceNum - exitModal.entry_price) * exitModal.shares;
    const totalTaxFee = exitModal.entry_fee + taxFeeNum;
    const netPnlTwd = grossPnl - totalTaxFee;
    const totalCostBasis = exitModal.entry_price * exitModal.shares + exitModal.entry_fee;
    const netRetPct = totalCostBasis > 0 ? (netPnlTwd / totalCostBasis) * 100 : 0;

    setUserPositions(prev => prev.filter(p => p.id !== exitModal.posId));
    setIdleCash(prev => prev + netProceedsTwd);

    const newTx = {
      id: 'tx_tw_' + Date.now(),
      date: exitModal.exit_date,
      action: '賣出',
      stock_id: exitModal.stock_id,
      stock_name: exitModal.stock_name,
      shares: exitModal.shares,
      price: exitPriceNum,
      tax_fee: taxFeeNum,
      cash_flow_twd: netProceedsTwd,
      realized_pnl_twd: netPnlTwd,
      realized_return_pct: netRetPct,
      note: `${exitModal.reason} (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
    };
    setTxHistory(prev => [newTx, ...prev]);

    setExitModal({ ...exitModal, open: false });
    triggerNotice(`🚪 成功平倉【${exitModal.stock_name}】！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
  };

  const handleOpenEditTx = (tx) => {
    setEditTxModal({
      open: true,
      isNew: false,
      id: tx.id,
      date: tx.date || new Date().toISOString().split('T')[0],
      action: tx.action || '買入',
      stock_id: tx.stock_id || '',
      stock_name: tx.stock_name || '',
      shares: tx.shares !== undefined && tx.shares !== null ? String(tx.shares) : '',
      price: tx.price !== undefined && tx.price !== null ? String(tx.price) : '',
      tax_fee: tx.tax_fee !== undefined && tx.tax_fee !== null ? String(tx.tax_fee) : '0',
      cash_flow_twd: tx.cash_flow_twd !== undefined && tx.cash_flow_twd !== null ? String(tx.cash_flow_twd) : '',
      realized_pnl_twd: tx.realized_pnl_twd !== undefined && tx.realized_pnl_twd !== null ? String(tx.realized_pnl_twd) : '',
      realized_return_pct: tx.realized_return_pct !== undefined && tx.realized_return_pct !== null ? String(tx.realized_return_pct) : '',
      note: tx.note || ''
    });
  };

  const handleOpenAddTx = () => {
    setEditTxModal({
      open: true,
      isNew: true,
      id: `tx_tw_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      action: '買入',
      stock_id: '',
      stock_name: '',
      shares: '1000',
      price: '',
      tax_fee: '0',
      cash_flow_twd: '',
      realized_pnl_twd: '',
      realized_return_pct: '',
      note: ''
    });
  };

  const handleAutoCalcTx = () => {
    const s = parseFloat(editTxModal.shares) || 0;
    const p = parseFloat(editTxModal.price) || 0;
    const tf = parseFloat(editTxModal.tax_fee) || 0;
    const act = editTxModal.action;

    let cf = 0;
    if (['買入', '加碼'].includes(act)) {
      cf = Math.round(-(s * p + tf));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (['賣出', '減持'].includes(act)) {
      cf = Math.round(s * p - tf);
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf)
      }));
    } else if (act === '入金') {
      cf = Math.round(p > 0 ? p : (s > 0 ? s : 0));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (act === '出金') {
      cf = -Math.round(p > 0 ? p : (s > 0 ? s : 0));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    }
  };

  const handleSaveTx = (e) => {
    e.preventDefault();
    if (!editTxModal.date || !editTxModal.stock_name) {
      alert('請填寫完整日期與標的名稱');
      return;
    }

    const updatedTx = {
      id: editTxModal.id || `tx_tw_${Date.now()}`,
      date: editTxModal.date,
      action: editTxModal.action,
      stock_id: editTxModal.stock_id.trim() || '-',
      stock_name: editTxModal.stock_name.trim(),
      shares: parseFloat(editTxModal.shares) || 0,
      price: parseFloat(editTxModal.price) || 0,
      tax_fee: parseFloat(editTxModal.tax_fee) || 0,
      cash_flow_twd: editTxModal.cash_flow_twd !== '' ? parseFloat(editTxModal.cash_flow_twd) : 0,
      realized_pnl_twd: editTxModal.realized_pnl_twd !== '' ? parseFloat(editTxModal.realized_pnl_twd) : null,
      realized_return_pct: editTxModal.realized_return_pct !== '' ? parseFloat(editTxModal.realized_return_pct) : null,
      note: editTxModal.note.trim()
    };

    setTxHistory(prev => {
      if (editTxModal.isNew) {
        return [updatedTx, ...prev];
      } else {
        return prev.map(item => item.id === updatedTx.id ? updatedTx : item);
      }
    });

    // 若是買入/加碼動作，立即同步更新對應實戰持股部位成本均價與股數
    if (updatedTx.action === '買入' || updatedTx.action === '加碼') {
      setUserPositions(prevPos => prevPos.map(p => {
        if (p.stock_id === updatedTx.stock_id || (p.stock_id && updatedTx.stock_id && p.stock_id.split('.')[0] === updatedTx.stock_id.split('.')[0]) || p.stock_name === updatedTx.stock_name) {
          return {
            ...p,
            entry_price: updatedTx.price,
            shares: updatedTx.shares > 0 ? updatedTx.shares : p.shares,
            entry_fee: updatedTx.tax_fee,
            entry_date: updatedTx.date
          };
        }
        return p;
      }));

      try {
        const customSaved = JSON.parse(localStorage.getItem('user_custom_entry_prices') || '{}');
        customSaved[updatedTx.stock_id] = updatedTx.price;
        if (updatedTx.stock_id.includes('.')) {
          customSaved[updatedTx.stock_id.split('.')[0]] = updatedTx.price;
        }
        localStorage.setItem('user_custom_entry_prices', JSON.stringify(customSaved));
      } catch {}
    }

    setEditTxModal(prev => ({ ...prev, open: false }));
    triggerNotice(`✅ 已成功${editTxModal.isNew ? '新增' : '更新修正'}「${updatedTx.stock_name}」歷史交易明細！實戰成本已自動對齊。`);
  };

  const handleOpenAddPosition = () => {
    setEditPosModal({
      open: true,
      isNew: true,
      id: `pos_tw_${Date.now()}`,
      stock_id: '',
      stock_name: '',
      role: '👑 王者泰坦 (70%)',
      shares: '1000',
      entry_price: '',
      current_price: '',
      entry_date: new Date().toISOString().split('T')[0],
      entry_fee: '0',
      stop_loss_price: '',
      stop_condition: '破60MA季線停損',
      syncBuyTx: true
    });
  };

  const handleOpenEditPosition = (pos) => {
    setEditPosModal({
      open: true,
      isNew: false,
      id: pos.id,
      stock_id: pos.stock_id,
      stock_name: pos.stock_name,
      role: pos.role || '👑 王者泰坦 (70%)',
      shares: String(pos.shares || ''),
      entry_price: String(pos.entry_price || ''),
      current_price: String(pos.current_price || pos.entry_price || ''),
      entry_date: pos.entry_date || new Date().toISOString().split('T')[0],
      entry_fee: String(pos.entry_fee || '0'),
      stop_loss_price: String(pos.stop_loss_price || ''),
      stop_condition: pos.stop_condition || '',
      syncBuyTx: false
    });
  };

  const handleDeletePosition = (pos) => {
    const matchingTx = txHistory.find(t => (t.stock_id === pos.stock_id || t.stock_name === pos.stock_name) && (t.action === '買入' || t.action === 'BUY'));
    if (matchingTx) {
      const confirmBoth = window.confirm(
        `確定要自持股清單中刪除「${pos.stock_name} (${pos.stock_id})」部位嗎？\n\n💡 系統偵測到歷史帳簿中存在建倉買進紀錄 (${matchingTx.date} 買入 ${pos.stock_name})。\n\n是否【同時刪除持股部位與其歷史買入紀錄】？\n• 點擊「確定」：同時刪除持股部位 + 歷史買進紀錄\n• 點擊「取消」：保留不作變更`
      );
      if (confirmBoth) {
        setUserPositions(prev => prev.filter(p => p.id !== pos.id));
        setTxHistory(prev => prev.filter(t => t.id !== matchingTx.id));
        triggerNotice(`🗑️ 已同步移除「${pos.stock_name}」持股部位與歷史買進紀錄！`);
        return;
      }
      return;
    }

    if (window.confirm(`確定要從持股清單中刪除「${pos.stock_name} (${pos.stock_id})」部位嗎？\n刪除後該部位不再計入總淨值。`)) {
      setUserPositions(prev => prev.filter(p => p.id !== pos.id));
      triggerNotice(`🗑️ 已成功刪除持股「${pos.stock_name}」！`);
    }
  };

  const handleSavePosition = (e) => {
    e.preventDefault();
    const sid = editPosModal.stock_id.trim();
    const sname = editPosModal.stock_name.trim();
    if (!sid || !sname) {
      alert('請填寫股票代號與名稱！');
      return;
    }
    const sharesNum = parseFloat(editPosModal.shares) || 0;
    const entryPx = parseFloat(editPosModal.entry_price) || 0;
    const curPx = parseFloat(editPosModal.current_price) || entryPx;
    const feeNum = parseFloat(editPosModal.entry_fee) || 0;
    const stopPx = parseFloat(editPosModal.stop_loss_price) || (entryPx * 0.9);

    const posObj = {
      id: editPosModal.id,
      stock_id: sid,
      stock_name: sname,
      role: editPosModal.role,
      shares: sharesNum,
      entry_price: entryPx,
      current_price: curPx,
      entry_date: editPosModal.entry_date,
      entry_fee: feeNum,
      stop_loss_price: stopPx,
      stop_condition: editPosModal.stop_condition || '破60MA季線停損'
    };

    if (editPosModal.isNew) {
      setUserPositions(prev => [posObj, ...prev.filter(p => p.stock_id !== sid)]);
      if (editPosModal.syncBuyTx) {
        const costTwd = sharesNum * entryPx + feeNum;
        const newTx = {
          id: `tx_tw_add_${Date.now()}`,
          date: editPosModal.entry_date,
          action: '買入',
          stock_id: sid,
          stock_name: sname,
          shares: sharesNum,
          price: entryPx,
          tax_fee: feeNum,
          cash_flow_twd: -Math.round(costTwd),
          realized_pnl_twd: null,
          realized_return_pct: null,
          note: `手動新增建倉 ${editPosModal.role}`
        };
        setTxHistory(prev => [newTx, ...prev]);
        setIdleCash(prev => Math.max(0, prev - Math.round(costTwd)));
      }
      triggerNotice(`✅ 已成功新增持股「${sname} (${sid})」！`);
    } else {
      setUserPositions(prev => prev.map(p => p.id === posObj.id ? posObj : p));
      triggerNotice(`✏️ 已成功更新持股「${sname} (${sid})」明細！`);
    }
    setEditPosModal(prev => ({ ...prev, open: false }));
  };

  const syncToDatabase = async () => {
    setCloudSyncStatus('saving');
    try {
      const res = await apiSaveTaiwanTitanPortfolio({
        username: currentUsername,
        positions: userPositions,
        tx_history: txHistory,
        dismissed_suggestions: dismissedSuggestions
      });
      if (res && res.status === 'ok') {
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        triggerNotice(`☁️ 已成功將「${currentUsername}」台股專屬帳本同步儲存至 Supabase 雲端資料庫！`);
        setTimeout(() => setCloudSyncStatus('synced'), 2500);
      } else {
        triggerNotice('⚠️ 雲端同步回應異常，已妥善保存在本機快取');
      }
    } catch (e) {
      console.warn('同步至後端資料庫失敗:', e);
      setCloudSyncStatus('error');
      triggerNotice('⚠️ 雲端連線失敗，目前已妥善保存在本機快取');
    }
  };

  const handleExportBackup = () => {
    const exportData = {
      app: 'Lobster Report Taiwan Titan',
      version: '2.0',
      username: currentUsername,
      exported_at: new Date().toISOString(),
      positions: userPositions,
      tx_history: txHistory,
      dismissed_suggestions: dismissedSuggestions
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `taiwan_titan_portfolio_${currentUsername}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerNotice(`📤 已成功匯出「${currentUsername}」台股專屬帳本備份檔！`);
  };

  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported.positions) && Array.isArray(imported.tx_history)) {
          setUserPositions(imported.positions);
          setTxHistory(imported.tx_history);
          if (Array.isArray(imported.dismissed_suggestions)) setDismissedSuggestions(imported.dismissed_suggestions);

          await apiSaveTaiwanTitanPortfolio({
            username: currentUsername,
            positions: imported.positions,
            tx_history: imported.tx_history,
            dismissed_suggestions: imported.dismissed_suggestions || []
          });
          setCloudSyncStatus('synced');
          setLastSyncTime(new Date());
          triggerNotice(`📥 已成功匯入台股帳本備份並同步更新至雲端！共 ${imported.positions.length} 檔持股，${imported.tx_history.length} 筆流水帳。`);
        } else {
          alert('備份檔案格式不正確，需包含 positions 與 tx_history 陣列。');
        }
      } catch (err) {
        alert('解析備份檔案失敗：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDeleteTx = (id, stockName, action, stockId) => {
    const matchingPos = userPositions.find(p => (stockId && p.stock_id === stockId) || p.stock_name === stockName);
    if (matchingPos && (action === '買入' || action === 'BUY')) {
      const confirmBoth = window.confirm(
        `確定要刪除「${action} ${stockName}」這筆歷史交易紀錄嗎？\n\n⚠️ 系統偵測到您目前持有中部位亦包含「${stockName} (${matchingPos.shares.toLocaleString()} 股)」！\n\n是否【同步刪除持股部位】？\n• 點擊「確定」：同時刪除歷史交易紀錄 + 移除該持股部位\n• 點擊「取消」：保留兩者不作任何變更`
      );
      if (confirmBoth) {
        setTxHistory(prev => prev.filter(item => item.id !== id));
        setUserPositions(prev => prev.filter(p => p.id !== matchingPos.id));
        triggerNotice(`🗑️ 已同步刪除「${stockName}」歷史交易紀錄與持股部位！`);
        return;
      }
      return;
    }

    if (window.confirm(`確定要刪除「${action} ${stockName}」這筆歷史交易紀錄嗎？\n刪除後無法復原。`)) {
      setTxHistory(prev => prev.filter(item => item.id !== id));
      triggerNotice(`🗑️ 已成功刪除「${stockName}」該筆歷史交易紀錄！`);
    }
  };


  return (
    <div className="titan-live-container" style={{ animation: 'fadeIn 0.25s ease', paddingBottom: '3rem' }}>
      {/* 提示通知氣泡 */}
      {feedbackMsg && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #10B981, #059669)',
          color: '#FFF',
          padding: '0.85rem 1.4rem',
          borderRadius: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          zIndex: 99999,
          fontWeight: 'bold',
          fontSize: '0.92rem',
          animation: 'slideIn 0.3s ease'
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* 頂部精簡橫條：小小的當前績效 (Mini Performance Header) */}
      <div className="glass-card" style={{
        padding: '0.9rem 1.2rem',
        marginBottom: '1.2rem',
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {/* 第一行：標題、旗艦標籤與大盤狀態 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#FBBF24', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              👑 台股泰坦實作
            </h3>
            <span style={{ fontSize: '0.74rem', background: 'rgba(245, 158, 11, 0.15)', color: '#FDE047', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>
              FIP 頂刊旗艦版 (70% 王者 + 15% 衛星1 + 15% 衛星2)
            </span>
            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              20年累積 +26,550% (266.5倍) | CAGR 30.3% | MDD -36.6% | 夏普 1.00
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            {/* 登入身分與雲端帳本標籤 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(30, 41, 59, 0.9)',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              padding: '0.22rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#94A3B8' }}>👤 帳本所屬:</span>
              <strong style={{ color: '#FCD34D' }}>{currentUsername}</strong>
              <span style={{
                color: cloudSyncStatus === 'synced' || cloudSyncStatus === 'saved' ? '#34D399' : cloudSyncStatus === 'saving' || cloudSyncStatus === 'syncing' ? '#FBBF24' : '#F87171',
                fontWeight: 'bold',
                fontSize: '0.74rem'
              }}>
                {cloudSyncStatus === 'syncing' ? '🔄 雲端讀取中...' : cloudSyncStatus === 'saving' ? '☁️ 雲端儲存中...' : cloudSyncStatus === 'saved' ? '✅ 雲端已儲存' : cloudSyncStatus === 'error' ? '⚠️ 本機快取模式' : '☁️ 雲端已同步'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#CBD5E1' }}>
              <span>加權指數:</span>
              <strong style={{ color: '#34D399', fontFamily: 'monospace' }}>{taiex.close.toLocaleString()}</strong>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>(60MA: {taiex.ma60.toLocaleString()})</span>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => {
                triggerNotice('🔄 正在手動重新對齊雲端資料庫...');
                syncToDatabase();
              }}
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
            >
              🔄 重新整理
            </button>
          </div>
        </div>

        {/* 第二行：5 個小小的當前績效數據方塊 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
          {/* 總資產淨值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>💰 總資產淨值 (閒置+持股)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalNetAssets).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: totalNetProfitTwd >= 0 ? '#34D399' : '#F87171', marginTop: '0.2rem' }}>
              本金: NT$ {Math.round(totalDepositsTwd).toLocaleString()} | 總淨利: {totalNetProfitTwd >= 0 ? '+' : ''}{totalNetProfitPct.toFixed(2)}%
            </div>
          </div>

          {/* 當前閒置現金 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #F59E0B' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>💵 台股閒置現金 (歷史紀錄推導)</span>
              <button
                onClick={() => { setCashActionType('deposit'); setCashModalOpen(true); }}
                style={{ background: 'rgba(245, 158, 11, 0.2)', border: 'none', color: '#FBBF24', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', cursor: 'pointer' }}
              >
                ➕ 存入/調整
              </button>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace' }}>
              NT$ {Math.round(idleCash).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              流水帳現金流即時加總
            </div>
          </div>

          {/* 持股市值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #6366F1' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📊 台股市值 ({userPositions.length} 檔)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#A5B4FC', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalStockMarketVal).toLocaleString()}
            </div>
          </div>

          {/* 未實現損益 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: unrealizedPnl >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📈 當前未實現損益</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: unrealizedPnl >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {unrealizedPnl >= 0 ? '+' : ''}NT$ {Math.round(unrealizedPnl).toLocaleString()}
              <span style={{ fontSize: '0.78rem', marginLeft: '0.3rem' }}>
                ({unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* 累計已實現淨利 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: totalRealizedPnl >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>🏆 累計已實現淨利 (扣稅費)</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: totalRealizedPnl >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {totalRealizedPnl >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnl).toLocaleString()}
              <span style={{ fontSize: '0.74rem', color: '#94A3B8', marginLeft: '0.3rem' }}>
                (勝率 {winRate.toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* 1. 當前實戰持有中部位 (Current Live Holdings) */}
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                💼 當前實戰持有中部位 ({userPositions.length} 檔)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                台股泰坦目前真實持股。可點擊「➕ 新增持股部位」手動建倉，或點擊操作欄進行「✏️ 編輯修改」、「🚪 出場」與「🗑️ 刪除」。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.78rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.1)', padding: '0.28rem 0.6rem', borderRadius: '4px' }}>
                持股市值合計: <strong>NT$ {Math.round(totalStockMarketVal).toLocaleString()}</strong>
              </div>
              <button
                onClick={handleOpenAddPosition}
                style={{
                  background: 'linear-gradient(135deg, #10B981, #059669)',
                  border: 'none',
                  color: '#FFF',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                ➕ 新增持股部位
              </button>
              <button
                onClick={syncToDatabase}
                style={{
                  background: 'rgba(99, 102, 241, 0.2)',
                  border: '1px solid rgba(99, 102, 241, 0.5)',
                  color: '#A5B4FC',
                  padding: '0.3rem 0.75rem',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
                title="立即將台股泰坦持股部位與交易歷史持久化寫入 Supabase 雲端資料庫"
              >
                ☁️ 存入雲端
              </button>
              <button
                onClick={handleExportBackup}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  color: '#7DD3FC',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
                title="將目前台股帳本的全部持股與流水帳匯出為 JSON 備份檔"
              >
                📤 匯出備份
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: 'rgba(234, 179, 8, 0.15)',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  color: '#FDE047',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '5px',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
                title="從電腦中選擇先前的台股 JSON 備份檔匯入並同步至雲端"
              >
                📥 匯入備份
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportBackup}
                accept=".json"
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {/* 策略月中抱牢紀律與風控狀態看板 */}
          <div style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            padding: '0.65rem 0.95rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.6rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
              <span style={{ fontSize: '1.15rem' }}>🛡️</span>
              <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>【月中抱牢紀律與警示原則】</span>
              <span style={{ color: '#CBD5E1' }}>
                台股泰坦策略依嚴格量化動能紀律「<strong>不到月底絕不隨意換股</strong>」（杜絕頻繁換股摩擦成本）；持股若維持在 60MA 季線上則續抱享受主升段。下次定期調倉日為 <strong>2026-10-31 盤後</strong>。若月中不幸跌破季線，將<strong>立即跳車變現為防禦現金</strong>！
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34D399', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
              ● 風控監控中：全數安全續抱
            </span>
          </div>

          {userPositions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
              目前尚無持股部位。資金 100% 待命中，可點擊上方「➕ 新增持股部位」或於下方「台股持倉更動建議」執行買入！
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th>代號與名稱</th>
                    <th style={{ textAlign: 'center' }}>配置角色</th>
                    <th style={{ textAlign: 'center' }}>建倉日期</th>
                    <th style={{ textAlign: 'right' }}>持有股數 (張數)</th>
                    <th style={{ textAlign: 'right' }}>成本均價</th>
                    <th style={{ textAlign: 'right' }}>最新現價</th>
                    <th style={{ textAlign: 'right' }}>目前市值 (NT$)</th>
                    <th style={{ textAlign: 'right' }}>未實現淨損益</th>
                    <th style={{ textAlign: 'right' }}>佔總淨值%</th>
                    <th style={{ textAlign: 'right' }}>60MA停損價</th>
                    <th style={{ textAlign: 'center' }}>風控警示狀態</th>
                    <th style={{ textAlign: 'center', minWidth: '130px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {userPositions.map((pos) => {
                    const curPrice = pos.current_price || pos.entry_price;
                    const costTwd = pos.shares * pos.entry_price + (pos.entry_fee || 0);
                    const valTwd = pos.shares * curPrice;
                    const pnlTwd = valTwd - costTwd;
                    const retPct = costTwd > 0 ? (pnlTwd / costTwd) * 100 : 0;
                    const allocPct = totalNetAssets > 0 ? (valTwd / totalNetAssets) * 100 : 0;
                    const isWin = pnlTwd >= 0;

                    const lots = Math.floor(pos.shares / 1000);
                    const odd = pos.shares % 1000;

                    const stopPrice = pos.stop_loss_price || (pos.entry_price * 0.85);
                    const distToStopPct = stopPrice > 0 ? ((curPrice - stopPrice) / curPrice) * 100 : 10;
                    const isBroken = curPrice <= stopPrice;
                    const isWarning = !isBroken && distToStopPct <= 5;

                    return (
                      <tr key={pos.id} style={{ background: isBroken ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.015)' }}>
                        <td>
                          <strong style={{ color: '#F8FAFC' }}>{pos.stock_name}</strong>
                          <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>{pos.stock_id}</div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.72rem',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            background: pos.role?.includes('王者') ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.25)',
                            color: pos.role?.includes('王者') ? '#FBBF24' : '#38BDF8'
                          }}>
                            {pos.role}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>{pos.entry_date}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#F1F5F9' }}>
                          {pos.shares?.toLocaleString()} 股 {pos.shares >= 1000 && `(${lots}張 ${odd > 0 ? odd + '股' : ''})`}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                          ${pos.entry_price?.toFixed(1)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                          ${curPrice?.toFixed(1)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#67E8F9' }}>
                          NT$ {Math.round(valTwd).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}NT$ {Math.round(pnlTwd).toLocaleString()} ({isWin ? '+' : ''}{retPct.toFixed(2)}%)
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                          {allocPct.toFixed(1)}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FDE047' }}>
                          ${pos.stop_loss_price?.toFixed(1) || '--'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isBroken ? (
                            <span style={{ fontSize: '0.72rem', background: '#EF4444', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              🚨 破線停損離場
                            </span>
                          ) : isWarning ? (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.2)', color: '#FBBF24', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              ⚠️ 逼近防守線 (+{distToStopPct.toFixed(1)}%)
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              🟢 安全續抱 (+{distToStopPct.toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => handleOpenEditPosition(pos)}
                            style={{
                              padding: '0.22rem 0.45rem',
                              fontSize: '0.72rem',
                              background: 'rgba(56, 189, 248, 0.15)',
                              border: '1px solid rgba(56, 189, 248, 0.4)',
                              color: '#38BDF8',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              marginRight: '4px'
                            }}
                            title="編輯修改持股股數、成本均價與停損線"
                          >
                            ✏️ 編輯
                          </button>
                          <button
                            onClick={() => handleOpenExitModal(pos)}
                            style={{
                              padding: '0.22rem 0.45rem',
                              fontSize: '0.72rem',
                              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                              color: '#FFF',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              marginRight: '4px'
                            }}
                            title="平倉出場"
                          >
                            🚪 出場
                          </button>
                          <button
                            onClick={() => handleDeletePosition(pos)}
                            style={{
                              padding: '0.22rem 0.45rem',
                              fontSize: '0.72rem',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#F87171',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                            title="自持股清單中移除此部位"
                          >
                            🗑️ 刪除
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

        {/* 2. 台股持倉更動建議 (Rebalance Recommendations) */}
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8', background: 'rgba(14, 165, 233, 0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                🔄 台股持倉更動建議（自動計算：賣出、減持、買入、加碼）
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                系統以當前台股總淨值 (NT$ {Math.round(totalNetAssets).toLocaleString()}) 自動計算 70% 王者 + 15% 雙衛星目標部位。表格內可直接修改股數、價格與稅費，點擊右側送出後自動消掉並入帳！
              </p>
            </div>

            {dismissedSuggestions.length > 0 && (
              <button
                onClick={() => setDismissedSuggestions([])}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#94A3B8',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  cursor: 'pointer'
                }}
              >
                ↺ 重新產生更動建議
              </button>
            )}
          </div>

          {rebalanceSuggestions.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px dashed #10B981' }}>
              <span style={{ fontSize: '1.1rem' }}>✨</span>
              <div style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.92rem', marginTop: '0.2rem' }}>
                目前台股持倉與資金配置已達最佳平衡（70% 王者 + 15% 雙衛星），無須進行任何調倉！
              </div>
              <div style={{ color: '#94A3B8', fontSize: '0.76rem', marginTop: '0.2rem' }}>
                閒置資金已妥善保留於帳戶中，待命拉回買進或下期動態輪動。
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th style={{ width: '80px', textAlign: 'center' }}>動作建議</th>
                    <th>標的代碼與名稱</th>
                    <th style={{ textAlign: 'right' }}>目標配置 (金額)</th>
                    <th style={{ textAlign: 'right' }}>目前股數</th>
                    <th style={{ textAlign: 'right', color: '#67E8F9' }}>建議更動股數</th>
                    <th style={{ textAlign: 'center', width: '120px' }}>實際成交股數 (可改)</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>成交價格 (可改)</th>
                    <th style={{ textAlign: 'center', width: '100px' }}>稅金/手續費</th>
                    <th style={{ textAlign: 'right' }}>預估現金變動</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>執行確認</th>
                  </tr>
                </thead>
                <tbody>
                  {rebalanceSuggestions.map((sugg) => {
                    const rowVal = getRowValues(sugg);
                    const sharesNum = parseInt(rowVal.shares, 10) || 0;
                    const priceNum = parseFloat(rowVal.price) || 0;
                    const feeNum = parseFloat(rowVal.taxFee) || 0;

                    let cashDiffTwd = 0;
                    if (sugg.action === '買入' || sugg.action === '加碼') {
                      cashDiffTwd = -(sharesNum * priceNum + feeNum);
                    } else {
                      cashDiffTwd = (sharesNum * priceNum - feeNum);
                    }

                    return (
                      <tr key={sugg.key} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '0.78rem',
                            background: sugg.actionColor + '25',
                            color: sugg.actionColor,
                            border: `1px solid ${sugg.actionColor}60`
                          }}>
                            {sugg.action === '買入' ? '🟢 買入' : (sugg.action === '加碼' ? '🔵 加碼' : (sugg.action === '減持' ? '🟠 減持' : '🔴 賣出'))}
                          </span>
                        </td>

                        <td>
                          <strong style={{ color: '#F8FAFC' }}>{sugg.stock_name}</strong>
                          <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            {sugg.stock_id} | <span style={{ color: '#FBBF24' }}>{sugg.role}</span>
                          </div>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div style={{ color: '#CBD5E1', fontWeight: 'bold' }}>{sugg.targetWeightPct}%</div>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            NT$ {Math.round(sugg.targetTwd).toLocaleString()}
                          </div>
                        </td>

                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                          {sugg.currentShares.toLocaleString()} 股
                        </td>

                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#67E8F9' }}>
                          {sugg.action === '加碼' ? `+${sugg.recShares}` : (sugg.action === '減持' ? `-${sugg.recShares}` : `${sugg.recShares}`)} 股
                          {sugg.recShares >= 1000 && ` (${Math.floor(sugg.recShares / 1000)}張)`}
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            value={rowVal.shares}
                            onChange={(e) => handleUpdateRowInput(sugg.key, 'shares', e.target.value)}
                            style={{
                              width: '90px',
                              padding: '0.3rem 0.4rem',
                              borderRadius: '4px',
                              background: 'rgba(0,0,0,0.6)',
                              border: '1px solid #38BDF8',
                              color: '#38BDF8',
                              fontWeight: 'bold',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem'
                            }}
                          />
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            step="0.5"
                            value={rowVal.price}
                            onChange={(e) => handleUpdateRowInput(sugg.key, 'price', e.target.value)}
                            style={{
                              width: '80px',
                              padding: '0.3rem 0.4rem',
                              borderRadius: '4px',
                              background: 'rgba(0,0,0,0.6)',
                              border: '1px solid rgba(255,255,255,0.25)',
                              color: '#F8FAFC',
                              fontWeight: 'bold',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem'
                            }}
                          />
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            value={rowVal.taxFee}
                            onChange={(e) => handleUpdateRowInput(sugg.key, 'taxFee', e.target.value)}
                            style={{
                              width: '70px',
                              padding: '0.3rem 0.4rem',
                              borderRadius: '4px',
                              background: 'rgba(0,0,0,0.6)',
                              border: '1px solid rgba(255,255,255,0.2)',
                              color: '#FCA5A5',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontSize: '0.82rem'
                            }}
                          />
                        </td>

                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: cashDiffTwd >= 0 ? '#34D399' : '#F87171' }}>
                          {cashDiffTwd >= 0 ? '+' : ''}NT$ {Math.round(cashDiffTwd).toLocaleString()}
                        </td>

                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleExecuteSuggestion(sugg)}
                            style={{
                              padding: '0.35rem 0.8rem',
                              fontSize: '0.78rem',
                              background: `linear-gradient(135deg, ${sugg.actionColor}, #0284C7)`,
                              color: '#FFF',
                              border: 'none',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            🚀 確認送出
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

        {/* 3. 所有進出歷史紀錄帳簿 (Complete Transaction History Ledger) */}
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #6366F1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  📜 台股實作所有進出歷史紀錄帳簿（共 {txHistory.length} 筆明細）
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  所有買進、加碼、減持、平倉與出入金紀錄，完整扣除千分之三證交稅與手續費計算實戰淨利。
                </p>
              </div>
              <button
                onClick={handleOpenAddTx}
                style={{
                  background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '6px',
                  padding: '0.32rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)'
                }}
              >
                ➕ 新增歷史交易紀錄
              </button>
            </div>

            <div style={{ fontSize: '0.76rem', color: '#CBD5E1', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                已實現淨利: <strong style={{ color: totalRealizedPnl >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedPnl >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnl).toLocaleString()}</strong>
              </span>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                累計稅費: <strong style={{ color: '#FCA5A5' }}>NT$ {Math.round(totalTaxesPaid).toLocaleString()}</strong>
              </span>
              <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                平倉勝率: <strong style={{ color: '#FBBF24' }}>{winRate.toFixed(1)}%</strong>
              </span>
            </div>
          </div>

          {txHistory.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
              尚無進出紀錄。
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ textAlign: 'center', width: '95px' }}>日期</th>
                    <th style={{ textAlign: 'center', width: '70px' }}>動作</th>
                    <th>標的代碼與名稱</th>
                    <th style={{ textAlign: 'right' }}>成交股數</th>
                    <th style={{ textAlign: 'right' }}>成交價格</th>
                    <th style={{ textAlign: 'right' }}>稅金/手續費</th>
                    <th style={{ textAlign: 'right' }}>現金流變動 (NT$)</th>
                    <th style={{ textAlign: 'right' }}>實現淨損益</th>
                    <th>備註說明</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {txHistory.map((tx) => {
                    const isWin = tx.realized_pnl_twd !== null && tx.realized_pnl_twd >= 0;

                    return (
                      <tr key={tx.id} style={{ background: 'rgba(255,255,255,0.015)' }}>
                        <td style={{ textAlign: 'center', color: '#94A3B8', fontFamily: 'monospace' }}>
                          {tx.date}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.72rem',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '3px',
                            fontWeight: 'bold',
                            background: tx.action === '買入' ? 'rgba(16, 185, 129, 0.2)' : (
                              tx.action === '加碼' ? 'rgba(56, 189, 248, 0.2)' : (
                                tx.action === '減持' ? 'rgba(245, 158, 11, 0.2)' : (
                                  tx.action === '賣出' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(168, 85, 247, 0.2)'
                                )
                              )
                            ),
                            color: tx.action === '買入' ? '#34D399' : (
                              tx.action === '加碼' ? '#38BDF8' : (
                                tx.action === '減持' ? '#FBBF24' : (
                                  tx.action === '賣出' ? '#F87171' : '#C084FC'
                                )
                              )
                            )
                          }}>
                            {tx.action}
                          </span>
                        </td>
                        <td>
                          <strong style={{ color: '#F1F5F9' }}>{tx.stock_name}</strong>
                          {tx.stock_id !== '-' && (
                            <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: '0.3rem', fontFamily: 'monospace' }}>
                              ({tx.stock_id})
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          {tx.shares > 0 ? `${tx.shares.toLocaleString()} 股` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          {tx.price > 0 ? `$${tx.price.toLocaleString()}` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                          {tx.tax_fee > 0 ? `$${tx.tax_fee}` : '-'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: tx.cash_flow_twd >= 0 ? '#34D399' : '#F87171' }}>
                          {tx.cash_flow_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.cash_flow_twd).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                          {tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined ? (
                            <span>
                              {tx.realized_pnl_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.realized_pnl_twd).toLocaleString()}
                              {tx.realized_return_pct !== null && (
                                <span style={{ fontSize: '0.7rem', display: 'block', color: isWin ? '#6EE7B7' : '#FCA5A5' }}>
                                  ({tx.realized_return_pct >= 0 ? '+' : ''}{tx.realized_return_pct.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          ) : '-'}
                        </td>
                        <td style={{ color: '#94A3B8', fontSize: '0.76rem' }}>
                          {tx.note}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => handleOpenEditTx(tx)}
                            style={{
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '1px solid rgba(99, 102, 241, 0.4)',
                              color: '#A5B4FC',
                              borderRadius: '4px',
                              padding: '2px 7px',
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                              marginRight: '4px'
                            }}
                            title="編輯修正此筆紀錄"
                          >
                            ✏️ 編輯
                          </button>
                          <button
                            onClick={() => handleDeleteTx(tx.id, tx.stock_name, tx.action, tx.stock_id)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#F87171',
                              borderRadius: '4px',
                              padding: '2px 7px',
                              fontSize: '0.74rem',
                              cursor: 'pointer'
                            }}
                            title="刪除此筆紀錄"
                          >
                            🗑️ 刪除
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
      </div>

      {/* 現金存入 / 調整彈窗 Modal */}
      {cashModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '420px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid #F59E0B', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.1rem' }}>
                💵 記錄/存入台股閒置資金
              </h4>
              <button
                onClick={() => setCashModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#CBD5E1', margin: '0 0 1rem 0' }}>
              投入金額不一定需要立即買進股票，可記錄為當前閒置資金，留待下一次有拉回訊號或調倉時動態計算建議。
            </p>

            <form onSubmit={handleSaveCashChange}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.4rem' }}>操作模式</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setCashActionType('deposit')}
                    style={{
                      flex: 1, padding: '0.4rem', borderRadius: '4px', fontSize: '0.8rem',
                      background: cashActionType === 'deposit' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ➕ 追加存入金額
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashActionType('set')}
                    style={{
                      flex: 1, padding: '0.4rem', borderRadius: '4px', fontSize: '0.8rem',
                      background: cashActionType === 'set' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ✏️ 直接重設閒置現金
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.3rem' }}>
                  {cashActionType === 'deposit' ? '追加存入金額 (NT$)' : '新的閒置現金總額 (NT$)'}
                </label>
                <input
                  type="number"
                  step="1000"
                  value={cashInputAmount}
                  onChange={(e) => setCashInputAmount(e.target.value)}
                  placeholder="例如 100000 或 500000"
                  required
                  style={{
                    width: '100%', padding: '0.5rem', borderRadius: '6px',
                    background: 'rgba(0,0,0,0.6)', border: '1px solid #F59E0B',
                    color: '#FDE68A', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {[100000, 300000, 500000, 1000000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashInputAmount(String(amt))}
                      style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', color: '#CBD5E1',
                        padding: '0.2rem 0.5rem', borderRadius: '3px', fontSize: '0.72rem', cursor: 'pointer'
                      }}
                    >
                      +{amt >= 1000000 ? `${amt / 1000000}百萬` : `${amt / 10000}萬`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCashModalOpen(false)}
                  style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.4rem 1.1rem', fontSize: '0.82rem'
                  }}
                >
                  確認更新
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 手動平倉出場彈窗 Modal */}
      {exitModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '480px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#F87171', fontSize: '1.15rem' }}>
                🚪 台股持股平倉出場
              </h4>
              <button
                onClick={() => setExitModal({ ...exitModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.7rem 0.9rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.82rem' }}>
              <div style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: '0.95rem' }}>
                {exitModal.stock_name} <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>({exitModal.stock_id})</span>
              </div>
              <div style={{ color: '#CBD5E1', marginTop: '0.2rem' }}>
                持有: <strong style={{ color: '#FDE68A' }}>{exitModal.shares?.toLocaleString()} 股</strong> | 成本: <strong style={{ color: '#FDE68A' }}>${exitModal.entry_price?.toLocaleString()}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmExit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場成交價 (元)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={exitModal.exit_price}
                    onChange={(e) => setExitModal({ ...exitModal, exit_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #F87171', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>證交稅與手續費 (NT$)</label>
                  <input
                    type="number"
                    value={exitModal.exit_tax_fee}
                    onChange={(e) => setExitModal({ ...exitModal, exit_tax_fee: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場日期</label>
                  <input
                    type="date"
                    value={exitModal.exit_date}
                    onChange={(e) => setExitModal({ ...exitModal, exit_date: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場原因</label>
                  <select
                    value={exitModal.reason}
                    onChange={(e) => setExitModal({ ...exitModal, reason: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="手動獲利了結">手動獲利了結</option>
                    <option value="跌破60MA季線停損">跌破60MA季線停損</option>
                    <option value="衛星+60%移動停利">衛星+60%移動停利</option>
                    <option value="大盤跌破防守線全面避險">大盤跌破防守線全面避險</option>
                  </select>
                </div>
              </div>

              {/* 實時預估淨額 */}
              {(() => {
                const ep = parseFloat(exitModal.exit_price) || 0;
                const tf = parseFloat(exitModal.exit_tax_fee) || 0;
                const netProceedsTwd = exitModal.shares * ep - tf;
                const grossPnl = (ep - exitModal.entry_price) * exitModal.shares;
                const netPnlTwd = grossPnl - exitModal.entry_fee - tf;
                return (
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.6rem 0.8rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#94A3B8' }}>回流閒置現金:</span>
                      <strong style={{ color: '#FDE68A', fontFamily: 'monospace' }}>
                        +NT$ {Math.round(netProceedsTwd).toLocaleString()}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94A3B8' }}>實現淨損益 (扣稅費):</span>
                      <strong style={{ color: netPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                        {netPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(netPnlTwd).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setExitModal({ ...exitModal, open: false })}
                  style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.4rem 1.1rem', fontSize: '0.82rem'
                  }}
                >
                  確認出場並入帳
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯 / 新增歷史交易紀錄彈窗 Modal */}
      {editTxModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '520px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(99, 102, 241, 0.5)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.15rem' }}>
                {editTxModal.isNew ? '➕ 新增台股歷史交易紀錄' : '✏️ 編輯修正歷史交易明細'}
              </h4>
              <button
                onClick={() => setEditTxModal({ ...editTxModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTx}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>交易日期</label>
                  <input
                    type="date"
                    value={editTxModal.date}
                    onChange={(e) => setEditTxModal({ ...editTxModal, date: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>交易動作</label>
                  <select
                    value={editTxModal.action}
                    onChange={(e) => setEditTxModal({ ...editTxModal, action: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="買入">買入</option>
                    <option value="加碼">加碼</option>
                    <option value="減持">減持</option>
                    <option value="賣出">賣出 (平倉)</option>
                    <option value="入金">入金 (資金存入)</option>
                    <option value="出金">出金 (資金提出)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票代號</label>
                  <input
                    type="text"
                    placeholder="例: 2408"
                    value={editTxModal.stock_id}
                    onChange={(e) => setEditTxModal({ ...editTxModal, stock_id: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>標的名稱</label>
                  <input
                    type="text"
                    placeholder="例: 南亞科"
                    value={editTxModal.stock_name}
                    onChange={(e) => setEditTxModal({ ...editTxModal, stock_name: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交股數</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.shares}
                    onChange={(e) => setEditTxModal({ ...editTxModal, shares: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交價格 (NT$)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editTxModal.price}
                    onChange={(e) => setEditTxModal({ ...editTxModal, price: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>稅金/手續費</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.tax_fee}
                    onChange={(e) => setEditTxModal({ ...editTxModal, tax_fee: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.76rem', color: '#94A3B8' }}>現金流變動 (NT$)</label>
                    <button
                      type="button"
                      onClick={handleAutoCalcTx}
                      style={{ background: 'none', border: 'none', color: '#38BDF8', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}
                      title="依據股數、價格與稅費試算"
                    >
                      ⚡ 試算
                    </button>
                  </div>
                  <input
                    type="number"
                    step="1"
                    placeholder="負代表支出, 正代表入帳"
                    value={editTxModal.cash_flow_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, cash_flow_twd: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現淨損益 (選填)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="平倉時填寫"
                    value={editTxModal.realized_pnl_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_pnl_twd: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現報酬率 %</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例: 12.5"
                    value={editTxModal.realized_return_pct}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_return_pct: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>備註說明</label>
                <input
                  type="text"
                  placeholder="例: 突破季線加碼、停利平倉等備註"
                  value={editTxModal.note}
                  onChange={(e) => setEditTxModal({ ...editTxModal, note: e.target.value })}
                  style={{
                    width: '100%', padding: '0.45rem',
                    background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditTxModal({ ...editTxModal, open: false })}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.84rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', fontSize: '0.84rem'
                  }}
                >
                  確認儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 編輯 / 新增持股部位彈窗 Modal */}
      {editPosModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '520px', width: '100%',
            background: 'linear-gradient(135deg, #0F172A, #1E293B)',
            border: '1px solid rgba(16, 185, 129, 0.5)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.15rem' }}>
                {editPosModal.isNew ? '➕ 手動新增台股持股部位' : `✏️ 編輯持股部位 - ${editPosModal.stock_name}`}
              </h4>
              <button
                onClick={() => setEditPosModal({ ...editPosModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePosition}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票代號</label>
                  <input
                    type="text"
                    placeholder="例: 2408"
                    value={editPosModal.stock_id}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stock_id: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票名稱</label>
                  <input
                    type="text"
                    placeholder="例: 南亞科"
                    value={editPosModal.stock_name}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stock_name: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>配置角色</label>
                  <select
                    value={editPosModal.role}
                    onChange={(e) => setEditPosModal({ ...editPosModal, role: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="👑 王者泰坦 (70%)">👑 王者泰坦 (70%)</option>
                    <option value="🚀 革命衛星 (15%)">🚀 革命衛星 (15%)</option>
                    <option value="🛡️ 現金防禦 (15%)">🛡️ 現金防禦 (15%)</option>
                    <option value="⚡ 動態攻擊策略">⚡ 動態攻擊策略</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>建倉日期</label>
                  <input
                    type="date"
                    value={editPosModal.entry_date}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_date: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>持有股數</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="例: 1000"
                    value={editPosModal.shares}
                    onChange={(e) => setEditPosModal({ ...editPosModal, shares: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成本均價 (NT$)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 550"
                    value={editPosModal.entry_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_price: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>最新現價 (NT$)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 568"
                    value={editPosModal.current_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, current_price: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>60MA停損價 (NT$)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 498"
                    value={editPosModal.stop_loss_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stop_loss_price: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>停損與出場條件說明</label>
                  <input
                    type="text"
                    placeholder="例: 破季線停損、動能領先突破"
                    value={editPosModal.stop_condition}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stop_condition: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              {editPosModal.isNew && (
                <div style={{ marginBottom: '1.2rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.6rem', borderRadius: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: '#A7F3D0' }}>
                    <input
                      type="checkbox"
                      checked={editPosModal.syncBuyTx}
                      onChange={(e) => setEditPosModal({ ...editPosModal, syncBuyTx: e.target.checked })}
                    />
                    <span>連動於下方歷史帳簿新增一筆「買入建倉」流水帳紀錄（並自動扣抵閒置資金）</span>
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditPosModal({ ...editPosModal, open: false })}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.84rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', fontSize: '0.84rem'
                  }}
                >
                  確認儲存持股
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

