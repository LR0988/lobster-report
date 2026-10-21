import React, { useState, useEffect, useMemo, useRef } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';
import { getCurrentUser, apiGetGlobalTitanPortfolio, apiSaveGlobalTitanPortfolio, apiGetGlobalSovereignDashboard, supabaseDirectFetch } from '../api';

const STORAGE_KEY_POSITIONS = 'global_titan_user_positions_v2';
const STORAGE_KEY_IDLE_CASH = 'global_titan_idle_cash_v2';
const STORAGE_KEY_ALL_TX = 'global_titan_all_tx_v2';
const STORAGE_KEY_USDFX = 'global_titan_user_usdfx_v2';
const STORAGE_KEY_DISMISSED_SUGG = 'global_titan_dismissed_sugg_v2';

const getTitanStorageKeys = (username) => ({
  positions: `global_titan_user_positions_v2_${username}`,
  idleCash: `global_titan_idle_cash_v2_${username}`,
  allTx: `global_titan_all_tx_v2_${username}`,
  usdFx: `global_titan_user_usdfx_v2_${username}`,
  dismissedSugg: `global_titan_dismissed_sugg_v2_${username}`
});

const DEFAULT_POSITIONS = [
  {
    id: 'pos_mrna_1',
    ticker: 'MRNA',
    name: '莫德納 (Moderna 生技巨擘)',
    market: '美股 (NASDAQ)',
    currency: 'USD',
    shares: 68,
    entry_price: 186.61,
    current_price: 236.50,
    price_date: '2026-10-15',
    entry_date: '2026-10-01',
    entry_fee: 15,
    stop_loss_price: 165.0,
    role: '👑 第1王者 (50%)',
    stop_condition: '大波段抱牢，SPY破年線才清倉'
  },
  {
    id: 'pos_3037_1',
    ticker: '3037.TW',
    name: '欣興 (Unimicron 載板王者)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 251,
    entry_price: 1195.0,
    current_price: 1090.0,
    price_date: '2026-10-16',
    entry_date: '2026-10-01',
    entry_fee: 400,
    stop_loss_price: 1026.38,
    role: '🥈 第2主力 (30%)',
    stop_condition: '載板王者主升段狂飆，持滿整月'
  },
  {
    id: 'pos_3443_1',
    ticker: '3443.TW',
    name: '創意 (Global Unichip ASIC)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 25,
    entry_price: 8031.0,
    current_price: 7480.0,
    price_date: '2026-10-16',
    entry_date: '2026-10-01',
    entry_fee: 400,
    stop_loss_price: 7150.0,
    role: '🥉 第3先鋒 (20%)',
    stop_condition: 'ASIC龍頭多頭強勁，每週一動態檢視'
  }
];

const DEFAULT_TX_HISTORY = [
  {
    id: 'tx_init_deposit',
    date: '2026-10-01',
    action: '投入現金',
    ticker: '-',
    name: '初始本金入金',
    currency: 'TWD',
    shares: 0,
    price: 0,
    tax_fee: 0,
    cash_flow_twd: 1000000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '全球泰坦旗艦策略 初始開倉本金'
  },
  {
    id: 'tx_init_1',
    date: '2026-10-01',
    action: '買入',
    ticker: 'MRNA',
    name: '莫德納 (Moderna)',
    currency: 'USD',
    shares: 68,
    price: 186.61,
    tax_fee: 15,
    cash_flow_twd: -412408,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 第1王者 (50%)'
  },
  {
    id: 'tx_init_2',
    date: '2026-10-01',
    action: '買入',
    ticker: '3037.TW',
    name: '欣興 (Unimicron)',
    currency: 'TWD',
    shares: 251,
    price: 1195.0,
    tax_fee: 400,
    cash_flow_twd: -299945,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 第2主力 (30%)'
  },
  {
    id: 'tx_init_3',
    date: '2026-10-01',
    action: '買入',
    ticker: '3443.TW',
    name: '創意 (Global Unichip)',
    currency: 'TWD',
    shares: 25,
    price: 8031.0,
    tax_fee: 400,
    cash_flow_twd: -200775,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初策略建倉 第3先鋒 (20%)'
  }
];

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);

  // 登入使用者身分與帳本歸屬
  const currentUser = getCurrentUser();
  const currentUsername = currentUser?.username || 'guest';
  const storageKeys = useMemo(() => getTitanStorageKeys(currentUsername), [currentUsername]);

  // 雲端同步狀態: 'idle' | 'syncing' | 'synced' | 'saving' | 'saved' | 'error'
  const [cloudSyncStatus, setCloudSyncStatus] = useState('syncing');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const isInitialCloudLoad = useRef(true);
  const autoSaveTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 美元匯率
  const [usdFx, setUsdFx] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.usdFx) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_USDFX) : null);
      return saved ? parseFloat(saved) : 32.5;
    } catch { return 32.5; }
  });

  // 當前持股部位
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.positions) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_POSITIONS) : null);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 如果舊的緩存中還是舊的 40% 角色或舊持股數 (54 股)，自動升級遷移至最新的 50/30/20 黃金階梯基準！
        const hasOld40 = Array.isArray(parsed) && parsed.some(p => p.role && (p.role.includes('40%') || p.shares === 54));
        if (hasOld40) {
          try { localStorage.setItem(storageKeys.positions, JSON.stringify(DEFAULT_POSITIONS)); } catch {}
          return DEFAULT_POSITIONS;
        }
        return parsed;
      }
      return DEFAULT_POSITIONS;
    } catch { return DEFAULT_POSITIONS; }
  });

  // 所有歷史進出紀錄流水帳 (全進出紀錄) - 唯一真實來源
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.allTx) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_ALL_TX) : null);
      let list = saved ? JSON.parse(saved) : DEFAULT_TX_HISTORY;
      if (!Array.isArray(list) || list.length === 0) list = DEFAULT_TX_HISTORY;
      // 如果舊流水帳含有 40% 或 54 股，自動升級為 50/30/20 黃金階梯流水帳
      const hasOld40 = list.some(tx => (tx.note && tx.note.includes('40%')) || (tx.ticker === 'MRNA' && tx.shares === 54));
      if (hasOld40) {
        list = DEFAULT_TX_HISTORY;
        try { localStorage.setItem(storageKeys.allTx, JSON.stringify(list)); } catch {}
      }
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
    ticker: '',
    name: '',
    currency: 'TWD',
    shares: 0,
    entry_price: 0,
    entry_date: '',
    entry_fee: 0,
    exit_price: '',
    exit_date: new Date().toISOString().split('T')[0],
    exit_tax_fee: '',
    reason: '依策略輪動換股'
  });

  // 編輯/新增歷史紀錄彈窗
  const [editTxModal, setEditTxModal] = useState({
    open: false,
    isNew: false,
    id: '',
    date: '',
    action: '買入',
    ticker: '',
    name: '',
    currency: 'USD',
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
    ticker: '',
    name: '',
    market: '美股 (NASDAQ)',
    currency: 'USD',
    role: '👑 第1王者 (40%)',
    shares: '',
    entry_price: '',
    current_price: '',
    entry_date: new Date().toISOString().split('T')[0],
    entry_fee: '15',
    stop_loss_price: '',
    stop_condition: '',
    syncBuyTx: true
  });

  const [feedbackMsg, setFeedbackMsg] = useState('');

  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  // 1. 當切換登入使用者或載入組件時，自動從 Supabase PostgreSQL 雲端資料庫撈取該使用者的專屬帳本
  useEffect(() => {
    let isMounted = true;
    isInitialCloudLoad.current = true;
    setCloudSyncStatus('syncing');

    const fetchCloudPortfolio = async () => {
      try {
        const res = await apiGetGlobalTitanPortfolio(currentUsername);
        if (!isMounted) return;
        if (res && res.status === 'ok') {
          if (Array.isArray(res.positions) && res.positions.length > 0) {
            setUserPositions(res.positions);
            try { localStorage.setItem(storageKeys.positions, JSON.stringify(res.positions)); } catch {}
          }
          if (Array.isArray(res.tx_history) && res.tx_history.length > 0) {
            const hasDeposit = res.tx_history.some(t => t.action === '投入現金' || t.id === 'tx_init_deposit');
            const normalizedTx = hasDeposit ? res.tx_history : [...res.tx_history, DEFAULT_TX_HISTORY[0]];
            setTxHistory(normalizedTx);
            try { localStorage.setItem(storageKeys.allTx, JSON.stringify(normalizedTx)); } catch {}
          }
          if (res.usd_fx) {
            setUsdFx(Number(res.usd_fx));
            try { localStorage.setItem(storageKeys.usdFx, String(res.usd_fx)); } catch {}
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
        console.warn('雲端帳本讀取失敗，使用本機快取:', err);
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
    try { localStorage.setItem(storageKeys.usdFx, String(usdFx)); } catch {}
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
        await apiSaveGlobalTitanPortfolio({
          username: currentUsername,
          positions: userPositions,
          tx_history: txHistory,
          usd_fx: usdFx,
          dismissed_suggestions: dismissedSuggestions
        });
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        setTimeout(() => setCloudSyncStatus('synced'), 2500);
      } catch (err) {
        console.warn('自動雲端儲存失敗:', err);
        setCloudSyncStatus('error');
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [usdFx, idleCash, userPositions, txHistory, dismissedSuggestions, storageKeys, currentUsername]);

  // 自動將「當前持股部位」的成本均價、股數與費用，100% 嚴格綁定對齊「歷史交易流水帳」最新買入明細！
  useEffect(() => {
    if (!Array.isArray(txHistory) || txHistory.length === 0) return;
    setUserPositions(prev => {
      let changed = false;
      const next = prev.map(p => {
        const matchTx = txHistory.find(tx => 
          (tx.action === '買入' || tx.action === '加碼') && 
          (tx.ticker === p.ticker || 
           (tx.ticker && p.ticker && tx.ticker.split('.')[0] === p.ticker.split('.')[0]) || 
           (tx.name && p.name && (tx.name.includes(p.name.slice(0, 2)) || p.name.includes(tx.name.slice(0, 2)))))
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


  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 優先直接向筆電本機 FastAPI / tw_stock.db 獲取最新全球主權演算數據與實盤報價
      const [json, portRes] = await Promise.all([
        apiGetGlobalSovereignDashboard(),
        apiGetGlobalTitanPortfolio(currentUsername).catch(() => null)
      ]);
      if (json && json.status === 'ok') {
        setData(json);
      }
      const liveMap = json?.live_prices || data?.live_prices || {};
      const picksArr = json?.current_picks || data?.current_picks || [];
      if (portRes && portRes.status === 'ok' && Array.isArray(portRes.positions) && portRes.positions.length > 0) {
        setUserPositions(prev => prev.map(p => {
          const baseTicker = p.ticker ? p.ticker.split('.')[0] : '';
          const matchLive = portRes.positions.find(lp => lp.ticker === p.ticker || (lp.ticker && p.ticker && lp.ticker.split('.')[0] === baseTicker));
          const liveItem = liveMap[p.ticker] || liveMap[baseTicker];
          const matchPick = picksArr.find(cp => cp.ticker === p.ticker || (cp.ticker && p.ticker && cp.ticker.split('.')[0] === baseTicker));
          const bestPrice = liveItem?.price || matchPick?.price || matchLive?.current_price;
          const bestDate = liveItem?.price_date || matchPick?.price_date || matchLive?.price_date || p.price_date;
          if (bestPrice && bestPrice > 0) {
            return {
              ...p,
              current_price: bestPrice,
              price_date: bestDate
            };
          }
          return p;
        }));
      }
    } catch (err) {
      console.warn('無法從筆電資料庫獲取最新全球主權數據，使用備援展示:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const macro = data?.macro_status || {};
  const currentPicks = data?.current_picks || [];
  const yearly = data?.yearly_performance || [];
  const shortTwDate = (data?.latest_tw_date || data?.latest_data_date || '2026-10-16').slice(5).replace('-', '/');
  const shortUsDate = (data?.latest_us_date || '2026-10-16').slice(5).replace('-', '/');

  // 自動將「當前持股部位」的最新現價 (current_price) 與報價日期 (price_date)，依據資料庫最新 live_prices 與 currentPicks 行情動態同步對齊！
  // 注意：只更新 current_price 與 price_date，嚴格保留使用者的進場成本 entry_price、股數與進場時間！
  useEffect(() => {
    const liveMap = data?.live_prices || {};
    if ((!currentPicks || currentPicks.length === 0) && Object.keys(liveMap).length === 0) return;
    setUserPositions(prev => {
      let changed = false;
      const next = prev.map(p => {
        const baseTicker = p.ticker ? p.ticker.split('.')[0] : '';
        const liveItem = liveMap[p.ticker] || liveMap[baseTicker];
        const matchPick = currentPicks.find(cp => 
          cp.ticker === p.ticker || 
          (cp.ticker && p.ticker && cp.ticker.split('.')[0] === baseTicker)
        );
        const latestPx = liveItem?.price || matchPick?.price;
        const pickDate = liveItem?.price_date || matchPick?.price_date || (p.currency === 'USD' ? (data?.latest_us_date || '2026-10-16') : (data?.latest_tw_date || '2026-10-16'));
        if (latestPx && latestPx > 0 && (p.current_price !== latestPx || p.price_date !== pickDate)) {
          changed = true;
          return { ...p, current_price: latestPx, price_date: pickDate };
        }
        return p;
      });
      return changed ? next : prev;
    });
  }, [currentPicks, data?.latest_data_date, data?.live_prices, cloudSyncStatus]);

  // 1. 計算持股現值與整體統計
  const { totalStockMarketValTwd, totalCostTwd, unrealizedPnlTwd, unrealizedReturnPct } = useMemo(() => {
    let marketVal = 0;
    let cost = 0;
    userPositions.forEach(p => {
      const fx = p.currency === 'USD' ? usdFx : 1.0;
      const curPrice = p.current_price || p.entry_price;
      marketVal += p.shares * curPrice * fx;
      cost += (p.shares * p.entry_price + (p.entry_fee || 0)) * fx;
    });
    const pnl = marketVal - cost;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    return {
      totalStockMarketValTwd: marketVal,
      totalCostTwd: cost,
      unrealizedPnlTwd: pnl,
      unrealizedReturnPct: pct
    };
  }, [userPositions, usdFx]);

  // 當前總資產淨值 (閒置現金 + 持股市值)
  const totalNetAssetsTwd = useMemo(() => {
    return Math.max(0, idleCash + totalStockMarketValTwd);
  }, [idleCash, totalStockMarketValTwd]);

  // 帳戶真實總淨利 (總資產淨值 - 累計總入金，全依歷史流水帳計算)
  const totalNetProfitTwd = useMemo(() => {
    return totalNetAssetsTwd - totalDepositsTwd;
  }, [totalNetAssetsTwd, totalDepositsTwd]);

  const totalNetProfitPct = useMemo(() => {
    return totalDepositsTwd > 0 ? (totalNetProfitTwd / totalDepositsTwd) * 100 : 0;
  }, [totalNetProfitTwd, totalDepositsTwd]);

  // 2. 歷史全進出紀錄統計 (已實現損益、勝率、總稅費)
  const { totalRealizedPnlTwd, totalTaxesPaidTwd, closedTradesCount, winningTradesCount, winRate } = useMemo(() => {
    let pnl = 0;
    let taxes = 0;
    let closedCount = 0;
    let winCount = 0;

    txHistory.forEach(tx => {
      if (tx.tax_fee) {
        const fx = tx.currency === 'USD' ? usdFx : 1.0;
        taxes += tx.tax_fee * fx;
      }
      if (tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined) {
        pnl += tx.realized_pnl_twd;
        closedCount += 1;
        if (tx.realized_pnl_twd > 0) winCount += 1;
      }
    });

    return {
      totalRealizedPnlTwd: pnl,
      totalTaxesPaidTwd: taxes,
      closedTradesCount: closedCount,
      winningTradesCount: winCount,
      winRate: closedCount > 0 ? (winCount / closedCount) * 100 : 0
    };
  }, [txHistory, usdFx]);

  // 雙梯隊調倉計算模式: 'full_100' (100% 雙隊滿倉 - 純進攻旗艦基準) | 'tranche_a_50' (1號 A梯隊 50%) | 'tranche_b_50' (22號 B梯隊 50%)
  const [rebalanceMode, setRebalanceMode] = useState('full_100');

  // 作戰指揮艙視角: 'all' (全視角總覽) | 'titan_a' (1號 A梯隊 50%) | 'titan_b' (22號 B梯隊 50%)
  const [dashboardStationView, setDashboardStationView] = useState('all');

  // 持倉篩選器: 'all' | 'titan'
  const [positionFilter, setPositionFilter] = useState('all');

  const titanPositions = useMemo(() => {
    return userPositions.filter(p => !p.role?.includes('乾粉') && !p.role?.includes('快打') && !p.role?.includes('抄底'));
  }, [userPositions]);

  const displayedPositions = useMemo(() => {
    if (positionFilter === 'titan') return titanPositions;
    return userPositions;
  }, [userPositions, positionFilter, titanPositions]);

  // 雙梯隊時序自動導航計算 (每月 1 號 A 梯隊 + 每月 22 號 B 梯隊)
  const dualTrancheGuide = useMemo(() => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;
    const day = now.getDate();

    const isWindowA = day >= 1 && day <= 4;
    const isWindowB = day >= 21 && day <= 25;

    let nextActionLabel = '';
    let nextTrancheBadge = '';
    let daysUntilNext = 0;

    if (day < 22) {
      daysUntilNext = 22 - day;
      nextActionLabel = `${yr}-${String(mo).padStart(2, '0')}-22 盤後`;
      nextTrancheBadge = '🅱️ B梯隊 (每月22號・35%進攻部位)';
    } else {
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextYr = mo === 12 ? yr + 1 : yr;
      const nextDate = new Date(nextYr, nextMo - 1, 1);
      daysUntilNext = Math.max(1, Math.ceil((nextDate - now) / (1000 * 60 * 60 * 24)));
      nextActionLabel = `${nextYr}-${String(nextMo).padStart(2, '0')}-01 盤後`;
      nextTrancheBadge = '🅰️ A梯隊 (每月1號・35%進攻部位)';
    }

    return {
      todayStr: `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      isWindowA,
      isWindowB,
      nextActionLabel,
      nextTrancheBadge,
      daysUntilNext
    };
  }, []);

  // 3. 雙梯隊持倉更動建議演算法 (支援 100% 雙隊滿倉 / 1號 A梯隊 50% / 22號 B梯隊 50%，含 DOE 容差帶與前 5 名保護帶)
  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];

    const activeTopPicks = currentPicks.filter(p => p.is_active);
    const suggestions = [];
    const isHalfTranche = rebalanceMode === 'tranche_a_50' || rebalanceMode === 'tranche_b_50';

    let modePrefix = '🔥 100%雙隊滿倉';
    if (rebalanceMode === 'tranche_a_50') {
      modePrefix = '🅰️ 1號A隊(50%)';
    } else if (rebalanceMode === 'tranche_b_50') {
      modePrefix = '🅱️ 22號B隊(50%)';
    }

    // A. 針對目標 Top 3 標的
    activeTopPicks.forEach(pick => {
      // 梯隊內標準黃金階梯配置: 50% / 30% / 20%
      const trancheWeightPct = pick.rank === 1 ? 50 : (pick.rank === 2 ? 30 : (pick.rank === 3 ? 20 : 0));
      // 佔總淨值目標比例: 滿倉模式為 50/30/20%，單梯隊模式為 25/15/10%
      const totalWeightPct = isHalfTranche ? (trancheWeightPct * 0.5) : trancheWeightPct;
      const targetTwd = totalNetAssetsTwd * (totalWeightPct / 100.0);
      const isUsd = pick.currency === 'USD';
      const price = pick.price || 1;
      const fx = isUsd ? usdFx : 1.0;

      // 目標股數 (該模式下對應目標額度所換算之理論股數)
      let targetShares = 0;
      if (isUsd) {
        const targetUsd = targetTwd / fx;
        targetShares = Math.floor(targetUsd / price);
      } else {
        targetShares = Math.floor(targetTwd / price);
      }

      // 檢查目前持有股數與佔總資產權重
      const heldPos = userPositions.find(p => p.ticker === pick.ticker);
      const heldShares = heldPos ? heldPos.shares : 0;
      const curWeightPct = totalNetAssetsTwd > 0 ? (((heldShares * price * fx) / totalNetAssetsTwd) * 100) : 0;
      const weightDiffPct = Math.abs(curWeightPct - totalWeightPct);

      const suggKey = `sugg_${rebalanceMode}_${pick.ticker}`;
      const isAlreadyDismissed = dismissedSuggestions.includes(suggKey);

      // 目標配置文字 (清晰展示梯隊與總淨值比例，杜絕「怎麼不是50/30/20」的誤解)
      const targetWeightDisplay = isHalfTranche
        ? `梯隊 ${trancheWeightPct}% (總額 ${totalWeightPct}%)`
        : `${totalWeightPct}%`;

      const roleTitle = isHalfTranche
        ? `${modePrefix} 👑第${pick.rank}主力 (梯隊${trancheWeightPct}% / 總額${totalWeightPct}%)`
        : `${modePrefix} 👑第${pick.rank}主力 (${totalWeightPct}%)`;

      let action = '續抱';
      let actionColor = '#10B981';
      let recShares = 0;
      let isBalanced = false;
      let estFee = 0;

      if (isAlreadyDismissed) {
        // 如果使用者先前已手動點擊執行送出該建議，保留此行展示為已執行，避免表格缺檔
        action = '續抱';
        actionColor = '#10B981';
        recShares = 0;
        isBalanced = true;
      } else if (isHalfTranche) {
        // === 單梯隊調倉模式 (🅰️ 1號 A 隊 或 🅱️ 22號 B 隊) ===
        // 在雙梯隊架構中，單梯隊調倉動用帳戶 50% 總資金。
        // 1. 若當前持股已達雙隊共振滿倉 (持股比例已覆蓋單梯隊 1.6 倍以上，如第1名 >= 40%、第2名 >= 24%、第3名 >= 16% 或股數足額):
        const isFullResonance = curWeightPct >= (totalWeightPct * 1.6) || (targetShares > 0 && heldShares >= Math.floor(targetShares * 1.6));
        // 2. 若當前持股在單梯隊目標容差帶內 (偏差 <= 2.5% 或股數金額偏差 <= 5000):
        const isTrancheAligned = weightDiffPct <= 2.5 || Math.abs((targetShares - heldShares) * price * fx) <= 5000;

        if (heldShares === 0 && targetShares > 0) {
          // 全新建倉買入
          action = '買入';
          actionColor = '#10B981';
          recShares = targetShares;
          estFee = isUsd ? 15 : Math.max(20, Math.round(targetShares * price * 0.001425));
        } else if (isFullResonance) {
          // 雙隊共振滿倉，該梯隊已完全滿足！絕不叫使用者減持！
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          isBalanced = true;
        } else if (isTrancheAligned) {
          // 單梯隊部位已對齊
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          isBalanced = true;
        } else if (curWeightPct < totalWeightPct - 2.5) {
          // 低於單梯隊目標需加碼補足
          const diff = Math.max(1, targetShares - heldShares);
          action = '加碼';
          actionColor = '#38BDF8';
          recShares = diff;
          estFee = isUsd ? 15 : Math.max(20, Math.round(diff * price * 0.001425));
        } else {
          // 持股介於單梯隊至雙隊共振之間，梯隊額度已安全滿足，續抱即可
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          isBalanced = true;
        }
      } else {
        // === 🔥 100% 雙隊滿倉模式 ===
        const diffShares = targetShares - heldShares;
        if (heldShares === 0 && targetShares > 0) {
          action = '買入';
          actionColor = '#10B981';
          recShares = targetShares;
          estFee = isUsd ? 15 : Math.max(20, Math.round(targetShares * price * 0.001425));
        } else if (weightDiffPct <= 5.0 || Math.abs(diffShares * price * fx) <= 5000) {
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          isBalanced = true;
        } else if (diffShares > 0) {
          action = '加碼';
          actionColor = '#38BDF8';
          recShares = diffShares;
          estFee = isUsd ? 15 : Math.max(20, Math.round(diffShares * price * 0.001425));
        } else {
          const reduceShares = Math.abs(diffShares);
          action = '減持';
          actionColor = '#F59E0B';
          recShares = reduceShares;
          estFee = isUsd ? 15 : Math.round(reduceShares * price * (0.003 + 0.001425));
        }
      }

      suggestions.push({
        key: suggKey,
        action,
        actionColor,
        ticker: pick.ticker,
        name: pick.name,
        market: pick.market,
        currency: pick.currency,
        targetWeightPct: totalWeightPct,
        targetWeightDisplay,
        targetTwd,
        currentShares: heldShares,
        targetShares: isHalfTranche && (curWeightPct >= totalWeightPct * 1.6) ? heldShares : targetShares,
        recShares,
        defaultPrice: price,
        defaultTaxFee: estFee,
        role: roleTitle,
        heldPos,
        isBalanced,
        isExecuted: isAlreadyDismissed
      });
    });

    // B. 針對目前持倉中、但不在 Top 3 的股票:
    // 檢查是否在「前 5 名保護緩衝帶 (Rank <= 5)」且未達 4 個月老化換血上限
    userPositions.forEach(heldPos => {
      const isInTarget = activeTopPicks.some(p => p.ticker === heldPos.ticker);
      const pickInfo = currentPicks.find(p => p.ticker === heldPos.ticker);
      const rank = pickInfo ? pickInfo.rank : 999;
      // 若排名在前 5 名內，且未達 4 個月換血上限 -> 緩衝保護中，不強制賣出！
      const isBufferProtected = rank <= 5 && (!heldPos.tenure_months || heldPos.tenure_months < 4);

      const suggKey = `sugg_exit_${rebalanceMode}_${heldPos.ticker}`;
      if (!isInTarget && !isBufferProtected) {
        const isUsd = heldPos.currency === 'USD';
        const curPrice = heldPos.current_price || heldPos.entry_price;
        const curWeightPct = totalNetAssetsTwd > 0 ? (((heldPos.shares * curPrice * (isUsd ? usdFx : 1.0)) / totalNetAssetsTwd) * 100) : 0;

        // 若為單梯隊調倉且部位為雙隊共振(>15%)，只換血該梯隊之50%份額；若為單梯隊持股或滿倉模式則全數出場
        const shouldHalve = isHalfTranche && heldPos.shares >= 2 && curWeightPct > 15;
        const exitShares = shouldHalve ? Math.max(1, Math.floor(heldPos.shares / 2)) : heldPos.shares;
        const estTaxFee = isUsd ? 15 : Math.round(exitShares * curPrice * (0.003 + 0.001425));

        suggestions.push({
          key: suggKey,
          action: shouldHalve ? '減持' : '賣出',
          actionColor: '#EF4444',
          ticker: heldPos.ticker,
          name: heldPos.name,
          market: heldPos.market,
          currency: heldPos.currency,
          targetWeightPct: 0,
          targetWeightDisplay: '0% (離場)',
          targetTwd: 0,
          currentShares: heldPos.shares,
          targetShares: shouldHalve ? (heldPos.shares - exitShares) : 0,
          recShares: exitShares,
          defaultPrice: curPrice,
          defaultTaxFee: estTaxFee,
          role: shouldHalve ? `${modePrefix} 跌出Top5換血 (釋出50%份額)` : `${modePrefix} 跌出Top5換血 (全數出場)`,
          heldPos: heldPos,
          isBalanced: false,
          isExecuted: dismissedSuggestions.includes(suggKey)
        });
      }
    });

    return suggestions;
  }, [totalNetAssetsTwd, currentPicks, userPositions, usdFx, dismissedSuggestions, rebalanceMode]);

  // 取得目前某列的編輯數值
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

  // 一鍵複製所有調倉委託指令
  const handleCopyAllOrders = () => {
    if (!rebalanceSuggestions || rebalanceSuggestions.length === 0) return;
    const activeLines = rebalanceSuggestions
      .filter(s => s.action !== '續抱' && s.recShares > 0)
      .map(s => {
        const isUsd = s.currency === 'USD';
        const actionText = s.action === '買入' || s.action === '加碼' ? '買進' : '賣出';
        const curr = isUsd ? 'USD $' : 'NT$ ';
        return `${s.ticker} ${s.name}: ${actionText} ${s.recShares} 股 (參考價 ${curr}${s.defaultPrice})`;
      });
    if (activeLines.length === 0) {
      triggerNotice('ℹ️ 目前 3 檔主力標的均已處於平衡容差帶內，無須發送任何調倉委託！');
      return;
    }
    const text = activeLines.join('\n');
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已成功複製 ${activeLines.length} 筆調倉委託指令！`);
  };

  // 4. 點擊「🚀 確認送出」執行建議更動
  const handleExecuteSuggestion = (sugg) => {
    if (sugg.action === '續抱' || sugg.isBalanced) {
      triggerNotice(`✅「${sugg.name}」目前持倉權重已完全對齊目標，處於平衡容差帶內，請安心續抱！`);
      return;
    }

    const rowVal = getRowValues(sugg);
    const actualShares = parseInt(rowVal.shares, 10);
    const actualPrice = parseFloat(rowVal.price);
    const actualTaxFee = parseFloat(rowVal.taxFee || 0);

    if (isNaN(actualShares) || actualShares <= 0 || isNaN(actualPrice) || actualPrice <= 0) {
      alert('請填寫有效的股數與成交價格');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const isUsd = sugg.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;

    if (sugg.action === '買入') {
      const grossValTwd = actualShares * actualPrice * fx;
      const totalCostTwd = grossValTwd + (isUsd ? actualTaxFee * fx : actualTaxFee);

      // 檢查閒置資金
      if (idleCash < totalCostTwd) {
        const proceed = window.confirm(
          `提醒：當前閒置現金 (NT$ ${Math.round(idleCash).toLocaleString()}) 小於預計買進總成本 (NT$ ${Math.round(totalCostTwd).toLocaleString()})。\n是否依然確認建倉？(閒置現金將變為負值或需追加投入)`
        );
        if (!proceed) return;
      }

      // 檢查是否已持有該標的 (例如單梯隊加碼或重複操作)
      const existingPos = userPositions.find(p => p.ticker === sugg.ticker);
      if (existingPos) {
        setUserPositions(prev => prev.map(p => {
          if (p.ticker === sugg.ticker) {
            const oldCost = p.shares * p.entry_price;
            const addCost = actualShares * actualPrice;
            const totalShares = p.shares + actualShares;
            const newAvgPrice = totalShares > 0 ? (oldCost + addCost) / totalShares : p.entry_price;
            return {
              ...p,
              shares: totalShares,
              entry_price: parseFloat(newAvgPrice.toFixed(2)),
              current_price: actualPrice,
              entry_fee: (p.entry_fee || 0) + actualTaxFee,
              role: sugg.role
            };
          }
          return p;
        }));
      } else {
        // 全新新增至持股
        const newPos = {
          id: 'pos_' + Date.now(),
          ticker: sugg.ticker,
          name: sugg.name,
          market: sugg.market,
          currency: sugg.currency,
          shares: actualShares,
          entry_price: actualPrice,
          current_price: actualPrice,
          entry_date: today,
          entry_fee: actualTaxFee,
          role: sugg.role,
          stop_condition: '大波段抱牢，SPY破年線才清倉'
        };
        setUserPositions(prev => [newPos, ...prev]);
      }

      setIdleCash(prev => prev - totalCostTwd);

      // 記帳流水
      const modeNotePrefix = rebalanceMode === 'full_100' ? '雙隊滿倉' : (rebalanceMode === 'tranche_a_50' ? '🅰️ 1號A隊調倉' : '🅱️ 22號B隊調倉');
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '買入',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -totalCostTwd,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `${modeNotePrefix}：買入建倉 (${sugg.role})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【買入】${sugg.name} ${actualShares} 股！已扣除閒置現金 NT$ ${Math.round(totalCostTwd).toLocaleString()}`);

    } else if (sugg.action === '加碼') {
      const grossValTwd = actualShares * actualPrice * fx;
      const totalCostTwd = grossValTwd + (isUsd ? actualTaxFee * fx : actualTaxFee);

      // 更新持股 (加權平均成本)
      setUserPositions(prev => prev.map(p => {
        if (p.ticker === sugg.ticker) {
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
        id: 'tx_' + Date.now(),
        date: today,
        action: '加碼',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -totalCostTwd,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `月底調倉：加碼 ${actualShares} 股`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【加碼】${sugg.name} ${actualShares} 股！已扣除閒置現金 NT$ ${Math.round(totalCostTwd).toLocaleString()}`);

    } else if (sugg.action === '減持') {
      const grossProceedsTwd = actualShares * actualPrice * fx;
      const netProceedsTwd = grossProceedsTwd - (isUsd ? actualTaxFee * fx : actualTaxFee);

      // 計算部分平倉已實現損益
      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const netPnlCurrency = grossPnl - actualTaxFee;
      const netPnlTwd = netPnlCurrency * fx;
      const costBasis = (entryPrice * actualShares) * fx;
      const netRetPct = costBasis > 0 ? (netPnlTwd / costBasis) * 100 : 0;

      // 減少持股
      setUserPositions(prev => prev.map(p => {
        if (p.ticker === sugg.ticker) {
          return {
            ...p,
            shares: Math.max(0, p.shares - actualShares)
          };
        }
        return p;
      }).filter(p => p.shares > 0));

      // 現金回流閒置現金
      setIdleCash(prev => prev + netProceedsTwd);

      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '減持',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: netProceedsTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: netRetPct,
        note: `月底調倉：減持部位 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【減持】${sugg.name} ${actualShares} 股！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);

    } else if (sugg.action === '賣出') {
      // 完全清倉出場
      const grossProceedsTwd = actualShares * actualPrice * fx;
      const netProceedsTwd = grossProceedsTwd - (isUsd ? actualTaxFee * fx : actualTaxFee);

      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const entryFee = sugg.heldPos?.entry_fee || 0;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const totalTaxFeeCurrency = entryFee + actualTaxFee;
      const netPnlCurrency = grossPnl - totalTaxFeeCurrency;
      const netPnlTwd = netPnlCurrency * fx;
      const totalCostBasis = (entryPrice * actualShares + entryFee) * fx;
      const netRetPct = totalCostBasis > 0 ? (netPnlTwd / totalCostBasis) * 100 : 0;

      setUserPositions(prev => prev.filter(p => p.ticker !== sugg.ticker));
      setIdleCash(prev => prev + netProceedsTwd);

      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '賣出',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: netProceedsTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: netRetPct,
        note: `月底調倉：完全出場清倉 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`🚪 已成功【清倉賣出】${sugg.name}！現金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
    }

    // 送出後消掉該筆建議！
    setDismissedSuggestions(prev => [...prev, sugg.key]);
  };

  // 5. 現金存入/調整處理
  const handleSaveCashChange = (e) => {
    e.preventDefault();
    const amt = parseFloat(cashInputAmount);
    if (isNaN(amt)) {
      alert('請輸入有效金額');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (cashActionType === 'deposit') {
      // 追加投入
      setIdleCash(prev => prev + amt);
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '投入現金',
        ticker: '-',
        name: '資金帳戶',
        currency: 'TWD',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: amt,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `追加存入資金 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 已成功追加存入 NT$ ${Math.round(amt).toLocaleString()} 至閒置現金！`);
    } else {
      // 直接重設閒置資金
      const diff = amt - idleCash;
      setIdleCash(amt);
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '調整資金',
        ticker: '-',
        name: '資金帳戶',
        currency: 'TWD',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: diff,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動調整閒置資金至 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 閒置現金已調整為 NT$ ${Math.round(amt).toLocaleString()}！`);
    }

    setCashModalOpen(false);
    setCashInputAmount('');
  };

  // 6. 手動出場彈窗邏輯
  const handleOpenExitModal = (pos) => {
    const isUsd = pos.currency === 'USD';
    const curPrice = pos.current_price || pos.entry_price;
    const estTaxFee = isUsd ? 15 : Math.round(pos.shares * curPrice * (0.003 + 0.001425));
    setExitModal({
      open: true,
      posId: pos.id,
      ticker: pos.ticker,
      name: pos.name,
      currency: pos.currency,
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

    const isUsd = exitModal.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;
    const grossProceedsTwd = exitModal.shares * exitPriceNum * fx;
    const netProceedsTwd = grossProceedsTwd - (isUsd ? taxFeeNum * fx : taxFeeNum);

    const grossPnl = (exitPriceNum - exitModal.entry_price) * exitModal.shares;
    const totalTaxFeeCurrency = exitModal.entry_fee + taxFeeNum;
    const netPnlCurrency = grossPnl - totalTaxFeeCurrency;
    const netPnlTwd = netPnlCurrency * fx;
    const totalCostBasis = (exitModal.entry_price * exitModal.shares + exitModal.entry_fee) * fx;
    const netRetPct = totalCostBasis > 0 ? (netPnlTwd / totalCostBasis) * 100 : 0;

    setUserPositions(prev => prev.filter(p => p.id !== exitModal.posId));
    setIdleCash(prev => prev + netProceedsTwd);

    const newTx = {
      id: 'tx_' + Date.now(),
      date: exitModal.exit_date,
      action: '賣出',
      ticker: exitModal.ticker,
      name: exitModal.name,
      currency: exitModal.currency,
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
    triggerNotice(`🚪 成功平倉【${exitModal.name}】！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
  };

  const handleOpenEditTx = (tx) => {
    setEditTxModal({
      open: true,
      isNew: false,
      id: tx.id,
      date: tx.date || new Date().toISOString().split('T')[0],
      action: tx.action || '買入',
      ticker: tx.ticker || '',
      name: tx.name || '',
      currency: tx.currency || 'USD',
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
      id: `tx_gl_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      action: '買入',
      ticker: '',
      name: '',
      currency: 'USD',
      shares: '50',
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
    const isUsd = editTxModal.currency === 'USD';
    const fx = isUsd ? (usdFx || 32.5) : 1.0;

    let cf = 0;
    if (['買入', '加碼'].includes(act)) {
      cf = Math.round(-(s * p * fx + (isUsd ? tf * fx : tf)));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (['賣出', '減持'].includes(act)) {
      cf = Math.round(s * p * fx - (isUsd ? tf * fx : tf));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf)
      }));
    } else if (['存入', '入金'].includes(act)) {
      cf = Math.round((p > 0 ? p : (s > 0 ? s : 0)) * (isUsd ? fx : 1.0));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (['提出', '出金'].includes(act)) {
      cf = -Math.round((p > 0 ? p : (s > 0 ? s : 0)) * (isUsd ? fx : 1.0));
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
    if (!editTxModal.date || !editTxModal.name) {
      alert('請填寫完整日期與標的名稱');
      return;
    }

    const updatedTx = {
      id: editTxModal.id || `tx_gl_${Date.now()}`,
      date: editTxModal.date,
      action: editTxModal.action,
      ticker: editTxModal.ticker.trim() || '-',
      name: editTxModal.name.trim(),
      currency: editTxModal.currency || 'USD',
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
        if (p.ticker === updatedTx.ticker || (p.ticker && updatedTx.ticker && p.ticker.split('.')[0] === updatedTx.ticker.split('.')[0]) || p.name === updatedTx.name) {
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

      // 同步更新跨頁面共用的買入價格快取
      try {
        const customSaved = JSON.parse(localStorage.getItem('user_custom_entry_prices') || '{}');
        customSaved[updatedTx.ticker] = updatedTx.price;
        if (updatedTx.ticker.includes('.')) {
          customSaved[updatedTx.ticker.split('.')[0]] = updatedTx.price;
        }
        localStorage.setItem('user_custom_entry_prices', JSON.stringify(customSaved));
      } catch {}
    }

    setEditTxModal(prev => ({ ...prev, open: false }));
    triggerNotice(`✅ 已成功${editTxModal.isNew ? '新增' : '更新修正'}「${updatedTx.name}」歷史交易明細！實戰成本已自動對齊。`);
  };

  const handleOpenAddPosition = () => {
    setEditPosModal({
      open: true,
      isNew: true,
      id: `pos_global_${Date.now()}`,
      ticker: '',
      name: '',
      market: '美股 (NASDAQ)',
      currency: 'USD',
      role: '👑 第1王者 (40%)',
      shares: '50',
      entry_price: '',
      current_price: '',
      entry_date: new Date().toISOString().split('T')[0],
      entry_fee: '15',
      stop_loss_price: '',
      stop_condition: '依全球主權階梯輪動持有',
      syncBuyTx: true
    });
  };

  const handleOpenEditPosition = (pos) => {
    setEditPosModal({
      open: true,
      isNew: false,
      id: pos.id,
      ticker: pos.ticker,
      name: pos.name,
      market: pos.market || (pos.currency === 'USD' ? '美股 (NASDAQ)' : '台股 (TWSE)'),
      currency: pos.currency || 'USD',
      role: pos.role || '👑 第1王者 (40%)',
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
    const matchingTx = txHistory.find(t => (t.ticker === pos.ticker || t.name === pos.name) && (t.action === '買入' || t.action === 'BUY'));
    if (matchingTx) {
      const confirmBoth = window.confirm(
        `確定要自全球持股清單中刪除「${pos.name} (${pos.ticker})」部位嗎？\n\n💡 系統偵測到歷史流水帳中存在建倉買進紀錄 (${matchingTx.date} 買入 ${pos.name})。\n\n是否【同時刪除持股部位與其歷史買入紀錄】？\n• 點擊「確定」：同時刪除持股部位 + 歷史買進紀錄\n• 點擊「取消」：保留不作變更`
      );
      if (confirmBoth) {
        setUserPositions(prev => prev.filter(p => p.id !== pos.id));
        setTxHistory(prev => prev.filter(t => t.id !== matchingTx.id));
        triggerNotice(`🗑️ 已同步移除「${pos.name}」全球持股部位與歷史買進紀錄！`);
        return;
      }
      return;
    }

    if (window.confirm(`確定要從全球持股清單中刪除「${pos.name} (${pos.ticker})」部位嗎？\n刪除後該部位不再計入總淨值。`)) {
      setUserPositions(prev => prev.filter(p => p.id !== pos.id));
      triggerNotice(`🗑️ 已成功刪除持股「${pos.name}」！`);
    }
  };

  const handleSavePosition = (e) => {
    e.preventDefault();
    const ticker = editPosModal.ticker.trim();
    const name = editPosModal.name.trim();
    if (!ticker || !name) {
      alert('請填寫標的代號與名稱！');
      return;
    }
    const isUsd = editPosModal.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;
    const sharesNum = parseFloat(editPosModal.shares) || 0;
    const entryPx = parseFloat(editPosModal.entry_price) || 0;
    const curPx = parseFloat(editPosModal.current_price) || entryPx;
    const feeNum = parseFloat(editPosModal.entry_fee) || 0;
    const stopPx = parseFloat(editPosModal.stop_loss_price) || (entryPx * 0.9);

    const posObj = {
      id: editPosModal.id,
      ticker: ticker,
      name: name,
      market: editPosModal.market,
      currency: editPosModal.currency,
      role: editPosModal.role,
      shares: sharesNum,
      entry_price: entryPx,
      current_price: curPx,
      entry_date: editPosModal.entry_date,
      entry_fee: feeNum,
      stop_loss_price: stopPx,
      stop_condition: editPosModal.stop_condition || '依全球主權階梯輪動持有'
    };

    if (editPosModal.isNew) {
      setUserPositions(prev => [posObj, ...prev.filter(p => p.ticker !== ticker)]);
      if (editPosModal.syncBuyTx) {
        const costOrig = sharesNum * entryPx + feeNum;
        const costTwd = costOrig * fx;
        const newTx = {
          id: `tx_global_add_${Date.now()}`,
          date: editPosModal.entry_date,
          action: '買入',
          ticker: ticker,
          name: name,
          currency: editPosModal.currency,
          shares: sharesNum,
          price: entryPx,
          tax_fee: feeNum,
          cash_flow_twd: -Math.round(costTwd),
          realized_pnl_twd: null,
          realized_return_pct: null,
          note: `手動新增全球建倉 ${editPosModal.role}`
        };
        setTxHistory(prev => [newTx, ...prev]);
        setIdleCash(prev => Math.max(0, prev - Math.round(costTwd)));
      }
      triggerNotice(`✅ 已成功新增全球持股「${name} (${ticker})」！`);
    } else {
      setUserPositions(prev => prev.map(p => p.id === posObj.id ? posObj : p));
      triggerNotice(`✏️ 已成功更新全球持股「${name} (${ticker})」明細！`);
    }
    setEditPosModal(prev => ({ ...prev, open: false }));
  };

  const syncToDatabase = async () => {
    setCloudSyncStatus('saving');
    try {
      const res = await apiSaveGlobalTitanPortfolio({
        username: currentUsername,
        positions: userPositions,
        tx_history: txHistory,
        usd_fx: usdFx,
        dismissed_suggestions: dismissedSuggestions
      });
      if (res && res.status === 'ok') {
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        triggerNotice(`💾 已成功將「${currentUsername}」專屬帳本儲存至筆電本機資料庫 (tw_stock.db)！`);
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
      app: 'Lobster Report Global Titan',
      version: '2.0',
      username: currentUsername,
      exported_at: new Date().toISOString(),
      positions: userPositions,
      tx_history: txHistory,
      usd_fx: usdFx,
      dismissed_suggestions: dismissedSuggestions
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `titan_portfolio_${currentUsername}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerNotice(`📤 已成功匯出「${currentUsername}」專屬帳本備份檔！`);
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
          if (imported.usd_fx) setUsdFx(Number(imported.usd_fx));
          if (Array.isArray(imported.dismissed_suggestions)) setDismissedSuggestions(imported.dismissed_suggestions);

          await apiSaveGlobalTitanPortfolio({
            username: currentUsername,
            positions: imported.positions,
            tx_history: imported.tx_history,
            usd_fx: imported.usd_fx || usdFx,
            dismissed_suggestions: imported.dismissed_suggestions || []
          });
          setCloudSyncStatus('synced');
          setLastSyncTime(new Date());
          triggerNotice(`📥 已成功匯入帳本備份並同步更新至雲端！共 ${imported.positions.length} 檔持股，${imported.tx_history.length} 筆流水帳。`);
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

  const handleDeleteTx = (id, ticker, name, action) => {
    const matchingPos = userPositions.find(p => (ticker && p.ticker === ticker) || p.name === name);
    if (matchingPos && (action === '買入' || action === 'BUY')) {
      const confirmBoth = window.confirm(
        `確定要刪除「${action} ${name} (${ticker})」這筆全球歷史交易紀錄嗎？\n\n⚠️ 系統偵測到您目前持有中部位亦包含「${name} (${matchingPos.shares} 股)」！\n\n是否【同步刪除持股部位】？\n• 點擊「確定」：同時刪除歷史交易紀錄 + 移除該持股部位\n• 點擊「取消」：保留兩者不作任何變更`
      );
      if (confirmBoth) {
        setTxHistory(prev => prev.filter(item => item.id !== id));
        setUserPositions(prev => prev.filter(p => p.id !== matchingPos.id));
        triggerNotice(`🗑️ 已同步刪除「${name}」全球歷史交易紀錄與持股部位！`);
        return;
      }
      return;
    }

    if (window.confirm(`確定要刪除「${action} ${name}」這筆全球歷史交易紀錄嗎？\n刪除後無法復原。`)) {
      setTxHistory(prev => prev.filter(item => item.id !== id));
      triggerNotice(`🗑️ 已成功刪除「${name}」該筆歷史交易紀錄！`);
    }
  };


  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.25s ease', paddingBottom: '3rem' }}>
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
        {/* 第一行：標題、冠軍標籤與匯率控制 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#60A5FA', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              👑 全球高流動性主權泰坦 (純雙梯隊進攻版)
            </h3>
            <span style={{
              fontSize: '0.78rem',
              background: 'rgba(56, 189, 248, 0.18)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#38BDF8',
              padding: '0.2rem 0.65rem',
              borderRadius: '5px',
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              🗓️ 最新報價日期：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-16'}</strong> (台股 {shortTwDate}・美股 {shortUsDate})
            </span>
            <span style={{ fontSize: '0.74rem', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(99, 102, 241, 0.25))', border: '1px solid rgba(59, 130, 246, 0.45)', color: '#93C5FD', padding: '0.2rem 0.55rem', borderRadius: '4px', fontWeight: 'bold' }}>
              🚀 每月 1 號 A 梯隊 (50%) ＋ 每月 22 號 B 梯隊 (50%) 雙梯隊交錯進攻
            </span>
            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              22.8年日頻回測 <strong style={{ color: '#34D399' }}>48,165倍 (CAGR 60.47%)</strong> | 索提諾 <strong style={{ color: '#34D399' }}>3.24</strong> | MDD <strong style={{ color: '#FBBF24' }}>-30.93%</strong> | Sharpe 1.34 | 年度勝率 <strong style={{ color: '#34D399' }}>95.5% (23年贏22年)</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            {/* 登入身分與雲端帳本標籤 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(30, 41, 59, 0.9)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
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

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: '#CBD5E1' }}>
              <span>USD匯率:</span>
              <input
                type="number"
                step="0.1"
                value={usdFx}
                onChange={(e) => setUsdFx(parseFloat(e.target.value) || 32.5)}
                style={{ width: '60px', padding: '0.15rem 0.35rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#67E8F9', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.82rem' }}
              />
            </div>
            <button
              className="btn btn-secondary"
              onClick={fetchData}
              disabled={loading}
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
            >
              {loading ? '🔄 更新中' : '🔄 重新整理'}
            </button>
          </div>
        </div>

        {/* 第二行：5 個小小的當前績效與資產配比數據方塊 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
          {/* 總資產淨值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>💼 總資產淨值 (閒置+持股)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: totalNetProfitTwd >= 0 ? '#34D399' : '#F87171', marginTop: '0.2rem' }}>
              本金: NT$ {Math.round(totalDepositsTwd).toLocaleString()} | 總淨利: {totalNetProfitTwd >= 0 ? '+' : ''}{totalNetProfitPct.toFixed(2)}%
            </div>
          </div>

          {/* 雙梯隊股票市值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #6366F1' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📊 雙梯隊股票部位 (目標 100%)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#A5B4FC', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              目前佔比: {totalNetAssetsTwd > 0 ? ((totalStockMarketValTwd / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (滿倉目標 NT$ {Math.round(totalNetAssetsTwd).toLocaleString()})
            </div>
          </div>

          {/* 閒置資金與活期儲備 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #10B981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>💵 閒置現金與儲備池</span>
              <button
                onClick={() => { setCashActionType('deposit'); setCashModalOpen(true); }}
                style={{ background: 'rgba(16, 185, 129, 0.2)', border: 'none', color: '#34D399', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', cursor: 'pointer' }}
              >
                ➕ 存入/調整
              </button>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#6EE7B7', fontFamily: 'monospace' }}>
              NT$ {Math.round(idleCash).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              目前佔比: {totalNetAssetsTwd > 0 ? ((idleCash / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (待命中儲備金)
            </div>
          </div>

          {/* 未實現損益 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: unrealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📈 當前未實現損益</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: unrealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {unrealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(unrealizedPnlTwd).toLocaleString()}
              <span style={{ fontSize: '0.78rem', marginLeft: '0.3rem' }}>
                ({unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* 累計已實現淨利 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: totalRealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>🏆 累計已實現淨利 (扣稅費)</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {totalRealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnlTwd).toLocaleString()}
              <span style={{ fontSize: '0.74rem', color: '#94A3B8', marginLeft: '0.3rem' }}>
                (勝率 {winRate.toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 🎛️ 雙梯隊全視角作戰指揮切換台 (Dual-Tranche Unified Command Station) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.8rem',
        padding: '0.75rem 1rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        borderRadius: '10px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.3rem' }}>🎛️</span>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.98rem', color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              作戰指揮艙視角切換
              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.25)', color: '#34D399', padding: '1px 6px', borderRadius: '4px' }}>
                雙梯隊進攻 ＋ 閒置快打旗艦版
              </span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              每月 1 號 A 隊 (50%) 與 22 號 B 隊 (50%) 進攻主砲；閒置資金 &gt; 15% 時自動啟動極端超賣快打。
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          background: 'rgba(0, 0, 0, 0.45)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          gap: '4px'
        }}>
          <button
            type="button"
            onClick={() => { setDashboardStationView('all'); setRebalanceMode('full_100'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'all' ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
              color: dashboardStationView === 'all' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'all' ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🌐</span> 雙梯隊全視角總覽
          </button>
          <button
            type="button"
            onClick={() => { setDashboardStationView('titan_a'); setRebalanceMode('tranche_a_50'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'titan_a' ? 'linear-gradient(135deg, #0EA5E9, #0284C7)' : 'transparent',
              color: dashboardStationView === 'titan_a' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'titan_a' ? '0 2px 8px rgba(14, 165, 233, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🅰️</span> 1號 A梯隊 (50%)
          </button>
          <button
            type="button"
            onClick={() => { setDashboardStationView('titan_b'); setRebalanceMode('tranche_b_50'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'titan_b' ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : 'transparent',
              color: dashboardStationView === 'titan_b' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'titan_b' ? '0 2px 8px rgba(168, 85, 247, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🅱️</span> 22號 B梯隊 (50%)
          </button>
        </div>
      </div>

      {/* 🧭 雙梯隊實戰跟單導航儀 (Dual-Tranche Follow-Along Action Guide) */}
      <div className="glass-card" style={{
        padding: '1rem 1.2rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88))',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderLeft: '4px solid #38BDF8'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.15rem' }}>🧭</span>
            <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.02rem' }}>
              雙梯隊交錯跟單導航儀（每月 1 號 A 梯隊 50% ＋ 每月 22 號 B 梯隊 50%・單一帳戶 100% 滿額進攻跟隨法）
            </h4>
            <span style={{
              fontSize: '0.73rem',
              background: (dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.18)',
              color: (dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? '#FBBF24' : '#34D399',
              border: `1px solid ${(dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? 'rgba(245, 158, 11, 0.5)' : 'rgba(16, 185, 129, 0.4)'}`,
              padding: '0.18rem 0.55rem',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              {dualTrancheGuide.isWindowA
                ? '🔥 當前為【1號 A梯隊】調倉窗口！'
                : dualTrancheGuide.isWindowB
                  ? '🔥 當前為【22號 B梯隊】調倉窗口！'
                  : `⏳ 下次定期調倉日：${dualTrancheGuide.nextActionLabel} (${dualTrancheGuide.nextTrancheBadge}，倒數 ${dualTrancheGuide.daysUntilNext} 天)`}
            </span>
          </div>
          <div style={{ fontSize: '0.74rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.12)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
            🌍 宏觀寬幅：{macro.bull_countries || '10/15'} 國 &gt; 200MA ({macro.global_breadth_pct || 66.7}%) ➔ <strong>{macro.exposure_pct || 100}% 滿倉進攻</strong>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.8rem' }}>
          {/* A 梯隊說明卡 */}
          <div style={{
            background: dualTrancheGuide.isWindowA ? 'rgba(56, 189, 248, 0.12)' : 'rgba(0,0,0,0.3)',
            border: dualTrancheGuide.isWindowA ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <strong style={{ color: '#38BDF8', fontSize: '0.86rem' }}>🅰️ A 梯隊（每月 1 號調倉｜進攻配比 50% 總資產）</strong>
              <span style={{ fontSize: '0.7rem', color: '#7DD3FC', fontFamily: 'monospace' }}>
                進攻預算 NT$ {Math.round(totalNetAssetsTwd * 0.5).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              • <strong>梯隊配比</strong>：第 1 名 <strong style={{ color: '#FBBF24' }}>25%</strong>、第 2 名 <strong style={{ color: '#67E8F9' }}>15%</strong>、第 3 名 <strong style={{ color: '#67E8F9' }}>10%</strong>（佔總淨值合計 50%，即梯隊內 50/30/20 黃金階梯）。<br/>
              • <strong>當期狀態</strong>：已於 <strong>10月1日</strong> 鎖定前 3 強（<span style={{ color: '#FDE68A' }}>MRNA / 3037 欣興 / 3443 創意</span>），續抱至 <strong>11月1日</strong> 才重新檢視。
            </div>
          </div>

          {/* B 梯隊說明卡 */}
          <div style={{
            background: dualTrancheGuide.isWindowB ? 'rgba(168, 85, 247, 0.14)' : 'rgba(0,0,0,0.3)',
            border: dualTrancheGuide.isWindowB ? '1px solid #A855F7' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <strong style={{ color: '#C084FC', fontSize: '0.86rem' }}>🅱️ B 梯隊（每月 22 號調倉｜進攻配比 50% 總資產）</strong>
              <span style={{ fontSize: '0.7rem', color: '#D8B4FE', fontFamily: 'monospace' }}>
                進攻預算 NT$ {Math.round(totalNetAssetsTwd * 0.5).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              • <strong>梯隊配比</strong>：第 1 名 <strong style={{ color: '#FBBF24' }}>25%</strong>、第 2 名 <strong style={{ color: '#67E8F9' }}>15%</strong>、第 3 名 <strong style={{ color: '#67E8F9' }}>10%</strong>（佔總淨值合計 50%，即梯隊內 50/30/20 黃金階梯）。<br/>
              • <strong>當期狀態</strong>：下次調倉日為 <strong style={{ color: '#FBBF24' }}>{dualTrancheGuide.nextActionLabel}</strong>。捕捉最新財報季後強勢動能黑馬！
            </div>
          </div>

          {/* 單一帳戶零摩擦跟單心法 */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ fontWeight: 'bold', color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              💡 我該怎麼在「同一個帳戶」輕鬆跟單？
            </div>
            <div style={{ fontSize: '0.75rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              1️⃣ <strong>兩隊選股相同時（常態共振）</strong>：A 隊 (25/15/10%) + B 隊 (25/15/10%) 合流為 <strong>50% / 30% / 20%（只買 3 檔，合計 100% 滿額進攻）</strong>。<br/>
              2️⃣ <strong>22 號出現新黑馬時</strong>：若舊股跌出前 5 名，只賣出該舊股<strong>一半部位換入新黑馬</strong>，另一半留待 1 號調倉再決定。<br/>
              3️⃣ <strong>下方一鍵切換試算</strong>：下方調倉表已內建「🔥 100% 雙隊滿倉」與「🅰️/🅱️ 50% 單梯隊」按鈕，自動幫您精算真實股數！
            </div>
          </div>
        </div>
      </div>



        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* 1. 目前持倉 (Current Live Holdings) */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  💼 當前實戰持有中部位 ({userPositions.length} 檔)
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  目前實戰帳戶真實持倉。可點擊「➕ 新增持股部位」手動建倉，或點擊操作欄進行「✏️ 編輯修改」、「🚪 出場」與「🗑️ 刪除」。
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{
                  fontSize: '0.78rem',
                  color: '#38BDF8',
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '0.28rem 0.65rem',
                  borderRadius: '5px',
                  fontWeight: 'bold',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}>
                  🗓️ 最新報價日期：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-16'}</strong> (台股 {shortTwDate}・美股 {shortUsDate})
                </div>
                <div style={{ fontSize: '0.78rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.1)', padding: '0.28rem 0.6rem', borderRadius: '4px' }}>
                  當前持股市值合計: <strong>NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}</strong>
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
                  title="立即將全球泰坦持股部位與交易歷史持久化寫入筆電本機資料庫 (tw_stock.db)"
                >
                  💾 儲存帳本
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
                  title="將目前帳本的全部持股與流水帳匯出為 JSON 備份檔"
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
                  title="從電腦中選擇先前的 JSON 備份檔匯入並同步至雲端"
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
                <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>【👑 全球主權泰坦・純雙梯隊進攻旗艦紀律】</span>
                <span style={{ color: '#CBD5E1' }}>
                  ① <strong>100% 雙梯隊滿額進攻</strong>（1 號 A 隊 50% + 22 號 B 隊 50% 各自 25/15/10%，共振時合流為 50/30/20%）；
                  ② <strong>45/35/20 敏銳動能</strong>（12M 45% + 3M 35% + 1M 20% × FIP 資訊離散度）；
                  ③ <strong>爆量滯漲防護</strong>（5D均量 &gt; 2倍60D均量且10D漲幅 &lt; 2% 自動剔除高檔出貨陷阱）；
                  ④ <strong>前 5 名保護帶 + 滿 4 月換血 + 容差免頻繁換股</strong>；
                  ⑤ <strong>嚴格次日 T+1 開盤成交扣除手續費與摩擦成本</strong>。
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34D399', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                ● 雙梯隊監控中：MRNA / 欣興 / 創意 通過爆量滯漲檢驗並站穩 60MA
              </span>
            </div>

            {/* 持倉分類篩選列 */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.6rem',
              marginBottom: '0.85rem'
            }}>
              <div style={{
                display: 'flex',
                background: 'rgba(0, 0, 0, 0.45)',
                padding: '3px',
                borderRadius: '7px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                gap: '3px'
              }}>
                <button
                  type="button"
                  onClick={() => setPositionFilter('all')}
                  style={{
                    padding: '0.28rem 0.7rem',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    background: positionFilter === 'all' ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
                    color: positionFilter === 'all' ? '#FFF' : '#94A3B8'
                  }}
                >
                  🌐 全部部位 ({userPositions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPositionFilter('titan')}
                  style={{
                    padding: '0.28rem 0.7rem',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    background: positionFilter === 'titan' ? 'linear-gradient(135deg, #0EA5E9, #0284C7)' : 'transparent',
                    color: positionFilter === 'titan' ? '#FFF' : '#94A3B8'
                  }}
                >
                  👑 雙梯隊持股 ({titanPositions.length})
                </button>
              </div>

              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                💡 雙梯隊規則：每月 1 號 (A梯隊 50%) 與 22 號 (B梯隊 50%) 週期調倉，緊扣全球最強龍頭進攻！
              </div>
            </div>

            {displayedPositions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
                {positionFilter === 'titan' ? (
                  <div>
                    <strong>目前無雙梯隊持股部位</strong>
                    <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginTop: '0.3rem' }}>
                      資金待命中，可於下方「雙梯隊持倉更動建議」執行買入！
                    </div>
                  </div>
                ) : (
                  <div>
                    目前尚無任何持股部位。資金 100% 待命中，可點擊上方「➕ 新增持股部位」或於下方「雙梯隊持倉更動建議」執行買入！
                  </div>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <th>標的代碼與名稱</th>
                      <th style={{ textAlign: 'center' }}>梯隊與配置角色</th>
                      <th style={{ textAlign: 'center' }}>當期排名 / 任期</th>
                      <th style={{ textAlign: 'center' }}>建倉日期</th>
                      <th style={{ textAlign: 'right' }}>持有股數</th>
                      <th style={{ textAlign: 'right' }}>成本均價</th>
                      <th style={{ textAlign: 'right' }}>最新現價</th>
                      <th style={{ textAlign: 'center' }}>最新報價日期</th>
                      <th style={{ textAlign: 'right' }}>目前市值 (折合NT$)</th>
                      <th style={{ textAlign: 'right' }}>未實現損益</th>
                      <th style={{ textAlign: 'right' }}>佔總淨值%</th>
                      <th style={{ textAlign: 'center' }}>防守線 (60MA/止損)</th>
                      <th style={{ textAlign: 'center' }}>量價/風控狀態</th>
                      <th style={{ textAlign: 'center', minWidth: '135px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPositions.map((pos) => {
                      const isUsd = pos.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const fx = isUsd ? usdFx : 1.0;
                      const curPrice = pos.current_price || pos.entry_price;
                      const costTwd = (pos.shares * pos.entry_price + (pos.entry_fee || 0)) * fx;
                      const valTwd = (pos.shares * curPrice) * fx;
                      const pnlTwd = valTwd - costTwd;
                      const retPct = costTwd > 0 ? (pnlTwd / costTwd) * 100 : 0;
                      const allocPct = totalNetAssetsTwd > 0 ? (valTwd / totalNetAssetsTwd) * 100 : 0;
                      const isWin = pnlTwd >= 0;

                      // 查找該持股在最新 Top 10 雷達中的排名與量價狀態
                      const pickMatch = currentPicks.find(cp => cp.ticker === pos.ticker || (cp.ticker && pos.ticker && cp.ticker.split('.')[0] === pos.ticker.split('.')[0]));
                      const liveRank = pickMatch ? pickMatch.rank : null;
                      const churnSafe = pickMatch ? pickMatch.churn_safe !== false : true;

                      // 計算持有月數 (任期上限 4 個月)
                      const daysHeld = pos.entry_date ? Math.max(1, Math.floor((new Date() - new Date(pos.entry_date)) / (1000 * 60 * 60 * 24))) : 12;
                      const monthsHeld = Math.min(4, Math.max(1, Math.ceil(daysHeld / 30)));

                      // 停損價與安全邊界計算
                      const stopPrice = pos.stop_loss_price || (pickMatch ? pickMatch.ma60 : (pos.entry_price * 0.85));
                      const distToStopPct = stopPrice > 0 ? ((curPrice - stopPrice) / curPrice) * 100 : 10;
                      const isBroken = curPrice <= stopPrice;
                      const isWarning = !isBroken && distToStopPct <= 5;

                      // 自動推斷標籤
                      const trancheTag = allocPct >= 23
                        ? '🔥 A+B雙隊共振'
                        : (pos.entry_date && parseInt(pos.entry_date.split('-')[2], 10) >= 18 ? '🅱️ B梯隊(22號)' : '🅰️ A梯隊(1號)');

                      return (
                        <tr key={pos.id} style={{ background: isBroken ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.015)' }}>
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{pos.name}</strong>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>{pos.ticker} ({pos.market})</div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.68rem', color: '#A5B4FC', marginBottom: '2px', fontWeight: 'bold' }}>
                              {trancheTag}
                            </div>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              background: pos.role?.includes('王者') ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.25)',
                              color: pos.role?.includes('王者') ? '#FBBF24' : '#38BDF8'
                            }}>
                              {pos.role}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {liveRank ? (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                background: liveRank <= 3 ? 'rgba(16, 185, 129, 0.2)' : (liveRank <= 5 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)'),
                                color: liveRank <= 3 ? '#34D399' : (liveRank <= 5 ? '#60A5FA' : '#F87171')
                              }}>
                                {liveRank <= 3 ? `👑 Rank #${liveRank} 正選` : (liveRank <= 5 ? `🛡️ Rank #${liveRank} 保護帶` : `⚠️ Rank #${liveRank}`)}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>觀察中</span>
                            )}
                            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '2px' }}>
                              任期: 第 {monthsHeld}/4 月 ({daysHeld}天)
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>{pos.entry_date}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#F1F5F9' }}>
                            {pos.shares?.toLocaleString()} 股
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                            {curr}{pos.entry_price?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                            {curr}{curPrice?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.78rem',
                              color: '#FCD34D',
                              background: 'rgba(245, 158, 11, 0.15)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}>
                              📅 {pos.price_date || pickMatch?.price_date || (pos.currency === 'USD' ? '2026-10-14' : '2026-10-15')}
                            </span>
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
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#FCA5A5', fontSize: '0.8rem' }}>
                            {curr}{Number(stopPrice)?.toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {isBroken ? (
                              <span style={{ fontSize: '0.72rem', background: '#EF4444', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🚨 破線停損離場
                              </span>
                            ) : !churnSafe ? (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.25)', color: '#FBBF24', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                ⚠️ 爆量滯漲警示
                              </span>
                            ) : isWarning ? (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.2)', color: '#FBBF24', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                ⚠️ 逼近防守線 (+{distToStopPct.toFixed(1)}%)
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🟢 量價健康 (+{distToStopPct.toFixed(1)}%)
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
                              title="編輯修改全球持股股數、成本均價與條件"
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
                            )}
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

          {/* 2. 雙梯隊持倉更動建議 (Dual-Tranche Rebalance Recommendations) */}
          {(dashboardStationView === 'all' || dashboardStationView === 'titan_attack' || dashboardStationView === 'titan_a' || dashboardStationView === 'titan_b') && (
            <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8', background: 'rgba(14, 165, 233, 0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🔄 雙梯隊持倉更動建議（支援「🔥 100% 雙隊滿倉」與「50% 單梯隊」一鍵切換試算）
                </h4>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  {rebalanceMode === 'full_100'
                    ? `目前為【🔥 100% 雙隊純滿倉模式 (動用 100% 總淨值 NT$ ${Math.round(totalNetAssetsTwd).toLocaleString()})】：A隊(50%) + B隊(50%) 共振合流，以 50% / 30% / 20% 黃金階梯滿額配置。`
                    : rebalanceMode === 'tranche_a_50'
                      ? `目前為【🅰️ 1號 A 梯隊半倉調倉 (動用 50% 總淨值 NT$ ${Math.round(totalNetAssetsTwd * 0.5).toLocaleString()})】：每月 1 號專屬定期調倉！梯隊內部配置 50% / 30% / 20%（佔總淨值 25% / 15% / 10%）。若持股已達雙隊共振滿額則安心續抱，絕不誤砍部位！`
                      : `目前為【🅱️ 22號 B 梯隊半倉調倉 (動用 50% 總淨值 NT$ ${Math.round(totalNetAssetsTwd * 0.5).toLocaleString()})】：每月 22 號專屬定期調倉！梯隊內部配置 50% / 30% / 20%（佔總淨值 25% / 15% / 10%）。若持股已達雙隊共振滿額則安心續抱，絕不誤砍部位！`}
                </p>
              </div>

              {/* 🎛️ 跟單調倉模式切換器 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <div style={{
                  display: 'flex',
                  background: 'rgba(15, 23, 42, 0.9)',
                  padding: '3px',
                  borderRadius: '7px',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  gap: '3px',
                  flexWrap: 'wrap'
                }}>
                  <button
                    type="button"
                    onClick={() => { setRebalanceMode('full_100'); setDashboardStationView('all'); setCustomEdits({}); }}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '5px',
                      border: 'none',
                      fontSize: '0.76rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: rebalanceMode === 'full_100' ? 'linear-gradient(135deg, #10B981, #059669)' : 'transparent',
                      color: rebalanceMode === 'full_100' ? '#FFF' : '#94A3B8'
                    }}
                  >
                    🔥 100% 雙隊滿倉 (50/30/20%)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRebalanceMode('tranche_a_50'); setDashboardStationView('titan_a'); setCustomEdits({}); }}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '5px',
                      border: 'none',
                      fontSize: '0.76rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: rebalanceMode === 'tranche_a_50' ? 'linear-gradient(135deg, #0EA5E9, #2563EB)' : 'transparent',
                      color: rebalanceMode === 'tranche_a_50' ? '#FFF' : '#94A3B8'
                    }}
                  >
                    🅰️ 1號 A隊 (50%)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRebalanceMode('tranche_b_50'); setDashboardStationView('titan_b'); setCustomEdits({}); }}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '5px',
                      border: 'none',
                      fontSize: '0.76rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: rebalanceMode === 'tranche_b_50' ? 'linear-gradient(135deg, #8B5CF6, #6D28D9)' : 'transparent',
                      color: rebalanceMode === 'tranche_b_50' ? '#FFF' : '#94A3B8'
                    }}
                  >
                    🅱️ 22號 B隊 (50%)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyAllOrders}
                  style={{
                    background: 'rgba(56, 189, 248, 0.2)',
                    border: '1px solid #38BDF8',
                    color: '#67E8F9',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '5px',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  title="一鍵複製目前所有需要調整的下單指令"
                >
                  📋 一鍵複製調倉委託
                </button>

                {dismissedSuggestions.length > 0 && (
                  <button
                    onClick={() => setDismissedSuggestions([])}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#94A3B8',
                      padding: '0.28rem 0.55rem',
                      borderRadius: '5px',
                      fontSize: '0.72rem',
                      cursor: 'pointer'
                    }}
                  >
                    ↺ 重新產生建議
                  </button>
                )}
              </div>
            </div>

            {rebalanceSuggestions.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px dashed #10B981' }}>
                <span style={{ fontSize: '1.1rem' }}>✨</span>
                <div style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.92rem', marginTop: '0.2rem' }}>
                  目前持倉與選定模式（{rebalanceMode === 'full_100' ? '100% 雙隊純滿倉 50/30/20%' : (rebalanceMode === 'tranche_a_50' ? '1號 A梯隊 (50%)' : '22號 B梯隊 (50%)')}）已處於平衡容差帶內，無須進行任何調倉！
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.76rem', marginTop: '0.2rem' }}>
                  下次定期調倉窗口為 <strong>{dualTrancheGuide.nextActionLabel} ({dualTrancheGuide.nextTrancheBadge})</strong>，屆時系統將自動依據最新排名試算換股建議。
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th style={{ width: '80px', textAlign: 'center' }}>動作建議</th>
                      <th>標的名稱 (代碼)</th>
                      <th style={{ textAlign: 'right' }}>目標配置 (金額)</th>
                      <th style={{ textAlign: 'right' }}>目前股數</th>
                      <th style={{ textAlign: 'right', color: '#67E8F9' }}>建議更動股數</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>實際成交股數 (可改)</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>成交價格 (可改)</th>
                      <th style={{ textAlign: 'center', width: '100px' }}>稅金/手續費</th>
                      <th style={{ textAlign: 'right' }}>預估現金變動</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>執行確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceSuggestions.map((sugg) => {
                      const rowVal = getRowValues(sugg);
                      const isUsd = sugg.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const fx = isUsd ? usdFx : 1.0;

                      const sharesNum = parseInt(rowVal.shares, 10) || 0;
                      const priceNum = parseFloat(rowVal.price) || 0;
                      const feeNum = parseFloat(rowVal.taxFee) || 0;

                      // 現金變動估算
                      let cashDiffTwd = 0;
                      if (sugg.action === '買入' || sugg.action === '加碼') {
                        cashDiffTwd = -(sharesNum * priceNum * fx + (isUsd ? feeNum * fx : feeNum));
                      } else {
                        cashDiffTwd = (sharesNum * priceNum * fx - (isUsd ? feeNum * fx : feeNum));
                      }

                      return (
                        <tr key={sugg.key} style={{ background: 'rgba(255,255,255,0.02)' }}>
                          {/* 動作標籤 */}
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
                              {sugg.action === '續抱' ? '✅ 續抱' : (sugg.action === '買入' ? '🟢 買入' : (sugg.action === '加碼' ? '🔵 加碼' : (sugg.action === '減持' ? '🟠 減持' : '🔴 賣出')))}
                            </span>
                          </td>

                          {/* 標的名稱 */}
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{sugg.name}</strong>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                              {sugg.ticker} | <span style={{ color: '#FBBF24' }}>{sugg.role}</span>
                            </div>
                          </td>

                          {/* 目標配置 */}
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ color: '#CBD5E1', fontWeight: 'bold' }}>{sugg.targetWeightDisplay || `${sugg.targetWeightPct}%`}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                              NT$ {Math.round(sugg.targetTwd).toLocaleString()}
                            </div>
                          </td>

                          {/* 目前股數 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                            {sugg.currentShares.toLocaleString()} 股
                          </td>

                          {/* 建議股數 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: sugg.action === '續抱' ? '#34D399' : '#67E8F9' }}>
                            {sugg.action === '續抱' ? '0 股 (平衡)' : (sugg.action === '買入' || sugg.action === '加碼' ? `+${sugg.recShares} 股` : `-${sugg.recShares} 股`)}
                          </td>

                          {/* 實際股數 Input */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              value={rowVal.shares}
                              onChange={(e) => handleUpdateRowInput(sugg.key, 'shares', e.target.value)}
                              disabled={sugg.action === '續抱' || sugg.isExecuted}
                              style={{
                                width: '85px',
                                padding: '0.3rem 0.4rem',
                                borderRadius: '4px',
                                background: (sugg.action === '續抱' || sugg.isExecuted) ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
                                border: (sugg.action === '續抱' || sugg.isExecuted) ? '1px solid rgba(255,255,255,0.1)' : '1px solid #38BDF8',
                                color: (sugg.action === '續抱' || sugg.isExecuted) ? '#94A3B8' : '#38BDF8',
                                fontWeight: 'bold',
                                textAlign: 'right',
                                fontFamily: 'monospace',
                                fontSize: '0.85rem'
                              }}
                            />
                          </td>

                          {/* 成交價格 Input */}
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                              <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{curr}</span>
                              <input
                                type="number"
                                step="0.1"
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
                            </div>
                          </td>

                          {/* 稅費 Input */}
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

                          {/* 預估現金變動 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: cashDiffTwd >= 0 ? '#34D399' : '#F87171' }}>
                            {cashDiffTwd >= 0 ? '+' : ''}NT$ {Math.round(cashDiffTwd).toLocaleString()}
                          </td>

                          {/* 右側按鈕送出 */}
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => handleExecuteSuggestion(sugg)}
                              disabled={sugg.action === '續抱' || sugg.isExecuted}
                              style={{
                                padding: '0.35rem 0.8rem',
                                fontSize: '0.78rem',
                                background: (sugg.action === '續抱' || sugg.isExecuted) ? 'rgba(16, 185, 129, 0.25)' : `linear-gradient(135deg, ${sugg.actionColor}, #0284C7)`,
                                color: (sugg.action === '續抱' || sugg.isExecuted) ? '#34D399' : '#FFF',
                                border: (sugg.action === '續抱' || sugg.isExecuted) ? '1px solid rgba(16, 185, 129, 0.5)' : 'none',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                cursor: (sugg.action === '續抱' || sugg.isExecuted) ? 'default' : 'pointer',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {sugg.isExecuted ? '✅ 已執行' : (sugg.action === '續抱' ? '✅ 續抱中' : '🚀 確認送出')}
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
          )}

          {/* 2.5 📡 全球泰坦 Top 10 敏銳動能與爆量滯漲即時雷達表 (Live Top 10 Ranking & Churn Filter Radar) */}
          {(dashboardStationView === 'all' || dashboardStationView === 'titan_attack') && currentPicks.length > 0 && (
            <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B', background: 'rgba(245, 158, 11, 0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📡 全球泰坦 Top 10 即時敏銳動能與非對稱凸性雷達（1號 / 22號 選股順位的唯一依據）
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.77rem' }}>
                    採用 <strong>(85% Raw + 15% 殘差 Alpha) × (45% 12M + 35% 3M + 20% 1M) × (1 + 0.5 FIP) × (1 + 0.20 凸性比)</strong> 排序，並通過「<strong>爆量滯漲濾網</strong>（5D均量 &gt; 2倍60D均量且10D漲幅 &lt; 2% 自動剔除）」。第 1~3 名為當期正選，第 4~5 名為在手續抱保護緩衝帶！
                  </p>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#FDE68A', background: 'rgba(245, 158, 11, 0.18)', border: '1px solid rgba(245, 158, 11, 0.45)', padding: '0.25rem 0.65rem', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                  🗓️ 最新行情基準日：{data?.latest_data_date || '2026-10-16'} (台股 {shortTwDate}・美股 {shortUsDate})
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <th style={{ textAlign: 'center', width: '115px' }}>順位與保護帶</th>
                      <th>標的名稱 (代碼 / 市場)</th>
                      <th style={{ textAlign: 'center' }}>單梯隊配比 (總資金佔比)</th>
                      <th style={{ textAlign: 'right' }}>最新現價</th>
                      <th style={{ textAlign: 'center' }}>最新報價日期</th>
                      <th style={{ textAlign: 'right' }}>防守季線 (60MA)</th>
                      <th style={{ textAlign: 'right' }}>3M 短期爆發</th>
                      <th style={{ textAlign: 'right' }}>12M 長期主升</th>
                      <th style={{ textAlign: 'right' }}>FIP 品質</th>
                      <th style={{ textAlign: 'right' }}>凸性比 (Conv)</th>
                      <th style={{ textAlign: 'right', color: '#FBBF24' }}>複合動能總分</th>
                      <th style={{ textAlign: 'center' }}>爆量滯漲濾網</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPicks.slice(0, 10).map((pick) => {
                      const isTop3 = pick.rank <= 3;
                      const isBuf = pick.rank > 3 && pick.rank <= 5;
                      const curr = pick.currency === 'USD' ? 'US$ ' : 'NT$ ';
                      const isHeld = userPositions.some(p => p.ticker === pick.ticker || (p.ticker && pick.ticker && p.ticker.split('.')[0] === pick.ticker.split('.')[0]));
                      const singleW = isTop3 ? (pick.rank === 1 ? 50 : (pick.rank === 2 ? 30 : 20)) : 0;
                      const navHalfW = singleW / 2;

                      return (
                        <tr key={pick.ticker} style={{
                          background: isTop3 ? 'rgba(16, 185, 129, 0.07)' : (isBuf ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.01)'),
                          borderLeft: isTop3 ? '3px solid #10B981' : (isBuf ? '3px solid #3B82F6' : 'none')
                        }}>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.73rem',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              background: isTop3 ? 'rgba(16, 185, 129, 0.22)' : (isBuf ? 'rgba(59, 130, 246, 0.22)' : 'rgba(255,255,255,0.07)'),
                              color: isTop3 ? '#34D399' : (isBuf ? '#60A5FA' : '#94A3B8')
                            }}>
                              {isTop3 ? `👑 Top ${pick.rank} 正選` : (isBuf ? `🛡️ Rank ${pick.rank} 保護帶` : `Rank ${pick.rank} 候補`)}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{pick.name}</strong>
                            <span style={{ fontSize: '0.73rem', color: '#94A3B8', marginLeft: '0.35rem', fontFamily: 'monospace' }}>
                              ({pick.ticker} · {pick.market})
                            </span>
                            {isHeld && (
                              <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', background: 'rgba(245, 158, 11, 0.25)', color: '#FCD34D', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>
                                ★ 已持有
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                            {isTop3 ? (
                              <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>
                                單隊 {singleW}% <span style={{ color: '#94A3B8', fontSize: '0.73rem' }}>(半倉 {navHalfW}% / 滿倉 {singleW}%)</span>
                              </span>
                            ) : isBuf ? (
                              <span style={{ color: '#93C5FD', fontSize: '0.75rem' }}>在手續抱免賣 (新倉不買)</span>
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '0.75rem' }}>0% (觀察名單)</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                            {curr}{pick.price?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.76rem',
                              color: '#FCD34D',
                              background: 'rgba(245, 158, 11, 0.15)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}>
                              📅 {pick.price_date || (pick.currency === 'USD' ? '2026-10-16' : '2026-10-16')}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                            {curr}{pick.ma60?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: pick.mom_3m >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {pick.mom_3m >= 0 ? '+' : ''}{pick.mom_3m}%
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: pick.mom_12m >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {pick.mom_12m >= 0 ? '+' : ''}{pick.mom_12m}%
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#A5B4FC' }}>
                            {pick.fip}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>
                            {pick.convexity !== undefined ? `${Number(pick.convexity).toFixed(2)}x` : '1.00x'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FBBF24' }}>
                            {pick.score?.toFixed(3)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {pick.churn_safe !== false ? (
                              <span style={{ fontSize: '0.72rem', color: '#34D399', background: 'rgba(16, 185, 129, 0.14)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🟢 量價健康
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#F87171', background: 'rgba(239, 68, 68, 0.18)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🚨 爆量滯漲剔除
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. 最底下紀錄所有進出紀錄 (Complete Transaction History Ledger) */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #6366F1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📜 所有進出歷史紀錄帳簿（共 {txHistory.length} 筆流水明細）
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                    每次買入、加碼、減持、賣出與資金存入皆完整記錄扣款、入帳、稅費與已實現淨利。
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
                  已實現獲利: <strong style={{ color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnlTwd).toLocaleString()}</strong>
                </span>
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                  累計稅費: <strong style={{ color: '#FCA5A5' }}>NT$ {Math.round(totalTaxesPaidTwd).toLocaleString()}</strong>
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
                      <th>備註原因</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txHistory.map((tx) => {
                      const isUsd = tx.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
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
                            <strong style={{ color: '#F1F5F9' }}>{tx.name}</strong>
                            {tx.ticker !== '-' && (
                              <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: '0.3rem', fontFamily: 'monospace' }}>
                                ({tx.ticker})
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {tx.shares > 0 ? `${tx.shares.toLocaleString()} 股` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {tx.price > 0 ? `${curr}${tx.price.toLocaleString()}` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                            {tx.tax_fee > 0 ? `${curr}${tx.tax_fee}` : '-'}
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
                              onClick={() => handleDeleteTx(tx.id, tx.ticker, tx.name, tx.action)}
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

      {/* 資金存入 / 調整彈窗 Modal */}
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
                💵 記錄/存入閒置資金
              </h4>
              <button
                onClick={() => setCashModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#CBD5E1', margin: '0 0 1rem 0' }}>
              投入金額不一定需要立即買進股票，可記錄為當前閒置資金，系統將留待下次調倉時動態計算建議。
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
                  {cashActionType === 'deposit' ? '追加投入金額 (NT$)' : '新的閒置現金總額 (NT$)'}
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

      {/* 手動出場平倉彈窗 Modal */}
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
                🚪 執行實戰持股出場平倉
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
                {exitModal.name} <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>({exitModal.ticker})</span>
              </div>
              <div style={{ color: '#CBD5E1', marginTop: '0.2rem' }}>
                持有: <strong style={{ color: '#FDE68A' }}>{exitModal.shares?.toLocaleString()} 股</strong> | 成本: <strong style={{ color: '#FDE68A' }}>{exitModal.currency === 'USD' ? 'US$ ' : 'NT$ '}{exitModal.entry_price?.toLocaleString()}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmExit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場成交價格 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_price}
                    onChange={(e) => setExitModal({ ...exitModal, exit_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #F87171', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場稅金/手續費 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
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
                    <option value="依策略輪動換股">依策略輪動換股</option>
                    <option value="個人獲利了結">個人獲利了結</option>
                    <option value="大盤破年線避險清倉">大盤破年線避險清倉</option>
                    <option value="停損出場">停損出場</option>
                  </select>
                </div>
              </div>

              {/* 實時預估淨額 */}
              {(() => {
                const ep = parseFloat(exitModal.exit_price) || 0;
                const tf = parseFloat(exitModal.exit_tax_fee) || 0;
                const isUsd = exitModal.currency === 'USD';
                const fx = isUsd ? usdFx : 1.0;
                const netProceedsTwd = (exitModal.shares * ep * fx) - (isUsd ? tf * fx : tf);
                const grossPnl = (ep - exitModal.entry_price) * exitModal.shares;
                const netPnlCurrency = grossPnl - exitModal.entry_fee - tf;
                const netPnlTwd = netPnlCurrency * fx;
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

      {/* 編輯 / 新增全球主權歷史交易紀錄彈窗 Modal */}
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
                {editTxModal.isNew ? '➕ 新增全球主權歷史交易紀錄' : '✏️ 編輯修正歷史交易明細'}
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
                    <option value="存入">存入 (資金投入)</option>
                    <option value="提出">提出 (資金收回)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 0.8fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>代碼 (Ticker)</label>
                  <input
                    type="text"
                    placeholder="例: MRNA / 3037.TW"
                    value={editTxModal.ticker}
                    onChange={(e) => setEditTxModal({ ...editTxModal, ticker: e.target.value })}
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
                    placeholder="例: 莫德納 (Moderna)"
                    value={editTxModal.name}
                    onChange={(e) => setEditTxModal({ ...editTxModal, name: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>計價幣別</label>
                  <select
                    value={editTxModal.currency}
                    onChange={(e) => setEditTxModal({ ...editTxModal, currency: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="TWD">TWD (NT$)</option>
                  </select>
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交價格 ({editTxModal.currency})</label>
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>稅金/手續費 ({editTxModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
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
                      title="依據幣別、匯率(1USD≈32.5NTD)與股價自動換算台幣現金流"
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現淨損益 (NT$, 選填)</label>
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
                  placeholder="例: 美股突破策略加碼、動態輪動平倉等"
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
      {/* 編輯 / 新增全球持股部位彈窗 Modal */}
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
                {editPosModal.isNew ? '➕ 手動新增全球主權持股部位' : `✏️ 編輯持股部位 - ${editPosModal.name}`}
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>標的代碼</label>
                  <input
                    type="text"
                    placeholder="例: MRNA, 3037.TW"
                    value={editPosModal.ticker}
                    onChange={(e) => setEditPosModal({ ...editPosModal, ticker: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>商品/股票名稱</label>
                  <input
                    type="text"
                    placeholder="例: 莫德納 (Moderna)"
                    value={editPosModal.name}
                    onChange={(e) => setEditPosModal({ ...editPosModal, name: e.target.value })}
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>市場別</label>
                  <select
                    value={editPosModal.market}
                    onChange={(e) => setEditPosModal({ ...editPosModal, market: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="美股 (NASDAQ)">美股 (NASDAQ)</option>
                    <option value="美股 (NYSE)">美股 (NYSE)</option>
                    <option value="台股 (TWSE)">台股 (TWSE)</option>
                    <option value="全球 (ETF)">全球 (ETF)</option>
                    <option value="避險債券 (CASH)">避險債券 (CASH)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>計價幣別</label>
                  <select
                    value={editPosModal.currency}
                    onChange={(e) => setEditPosModal({ ...editPosModal, currency: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="USD">美元 (USD)</option>
                    <option value="TWD">新台幣 (TWD)</option>
                  </select>
                </div>
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
                    <option value="👑 第1王者 (50%)">👑 第1王者 (50%)</option>
                    <option value="🥈 第2主力 (30%)">🥈 第2主力 (30%)</option>
                    <option value="🥉 第3先鋒 (20%)">🥉 第3先鋒 (20%)</option>
                    <option value="🛡️ 現金避險">🛡️ 現金避險</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>持有股數</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="例: 54"
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                    成本均價 ({editPosModal.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 186.61"
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                    最新現價 ({editPosModal.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 225.0"
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
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>停損與出場條件</label>
                  <input
                    type="text"
                    placeholder="例: SPY破年線清倉、月底階梯動態輪動"
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
                    <span>連動於下方歷史帳簿新增一筆「買入建倉」流水帳紀錄（並自動扣抵可用資金）</span>
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
                  確認儲存全球持股
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

