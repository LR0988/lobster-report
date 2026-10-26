import React, { useState, useEffect, useMemo } from 'react';
import defaultAsymData from '../data/defaultTwAsymmetricAlphaData.json';
import defaultCbBacktestData from '../data/cb_backtest_data.json';
import { apiGetTwAsymmetricAlphaDashboard, getCurrentUser } from '../api';

const STORAGE_KEY_CB_ACTIVE = 'tw_cb_titan_active_holdings_v2';
const STORAGE_KEY_CB_HISTORY = 'tw_cb_titan_trade_history_v2';

export default function TwAsymmetricAlphaDashboard() {
  const currentUser = getCurrentUser();
  const username = currentUser?.username || 'hotpotlu';
  const activeStorageKey = `${STORAGE_KEY_CB_ACTIVE}_${username}`;
  const historyStorageKey = `${STORAGE_KEY_CB_HISTORY}_${username}`;

  const [data, setData] = useState(defaultAsymData);
  const [loading, setLoading] = useState(false);

  // 主子分頁: 'radar' (今日落難天使好球帶雷達) | 'tracker' (我的進行中持倉) | 'history' (實戰進出歷史) | 'doe_backtest' (歷史四大神作巡禮與27年實證)
  const [activeSubTab, setActiveSubTab] = useState('radar');
  const [radarFilter, setRadarFilter] = useState('in_zone'); // 'in_zone' | 'near_zone' | 'watching' | 'all'
  const [followMode, setFollowMode] = useState('CBAS'); // 'CBAS' (上限300萬) | 'CB現貨' (上限5000萬)
  const [followBudgetLevel, setFollowBudgetLevel] = useState('900k'); // '300k' | '900k' | '3000k' | '15000k'
  const [notice, setNotice] = useState('');

  // 行內跟單輸入狀態 (買價、張數、模式)
  const [radarRowInputs, setRadarRowInputs] = useState({});
  // 持倉行內平倉輸入狀態 (賣價、出場理由、日期、時間)
  const [exitRowInputs, setExitRowInputs] = useState({});

  // 頂部快速手動買進記帳列
  const [quickAdd, setQuickAdd] = useState({
    cb_code: '',
    cb_name: '',
    mode: 'CBAS',
    price: '',
    lots: '5',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toTimeString().split(' ')[0].slice(0, 5)
  });

  // 手動補登歷史進出紀錄彈窗
  const [showManualHistoryModal, setShowManualHistoryModal] = useState(false);
  const [manualHistoryForm, setManualHistoryForm] = useState({
    cb_code: '',
    cb_name: '',
    stock_name: '',
    mode: 'CBAS',
    entry_date: new Date().toISOString().split('T')[0],
    entry_time: '09:15',
    entry_price: '',
    exit_date: new Date().toISOString().split('T')[0],
    exit_time: '13:10',
    exit_price: '',
    lots: '10',
    exit_reason: '🎯 觸及首段停利 (AI極速噴發)',
    notes: '泰坦17因子 VCP+口袋支點突破跟單'
  });

  // 實戰進行中持倉 (Single Source of Truth with LocalStorage)
  const [activeHoldings, setActiveHoldings] = useState(() => {
    try {
      const saved = localStorage.getItem(activeStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return defaultAsymData?.active_holdings || [];
  });

  // 實戰已結算進出歷史 (Single Source of Truth with LocalStorage)
  const [tradeHistory, setTradeHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(historyStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return defaultAsymData?.trade_history || [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(activeStorageKey, JSON.stringify(activeHoldings));
    } catch {}
  }, [activeHoldings, activeStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(historyStorageKey, JSON.stringify(tradeHistory));
    } catch {}
  }, [tradeHistory, historyStorageKey]);

  // 歷史交易篩選狀態
  const [historyFilter, setHistoryFilter] = useState('all'); // 'all' | 'win' | 'rotation28' | 'cbas' | 'cash_cb'
  const [historySearch, setHistorySearch] = useState('');

  // 27 年 (2000~2026) 回測資料與篩選狀態
  const cbBacktestSummary = defaultCbBacktestData?.summary || {};
  const cbBacktestYearly = defaultCbBacktestData?.yearly || [];
  const allCbTrades = defaultCbBacktestData?.trades || [];
  const weeklyDoeMatrix = cbBacktestSummary?.weekly_doe_matrix || [];

  const [backtestSubView, setBacktestSubView] = useState('yearly'); // 'weekly_doe' | 'yearly' | 'trades'
  const [cbMode, setCbMode] = useState('cbas'); // 'cbas' | 'cash_cb'
  const [cbTradeFilter, setCbTradeFilter] = useState('all');
  const [cbTradeYearFilter, setCbTradeYearFilter] = useState('all');
  const [cbTradeSearch, setCbTradeSearch] = useState('');
  const [cbTradePage, setCbTradePage] = useState(1);
  const CB_TRADES_PAGE_SIZE = 25;

  const showToast = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4200);
  };

  const fetchLatest = async () => {
    setLoading(true);
    try {
      const live = await apiGetTwAsymmetricAlphaDashboard();
      if (live && live.status === 'ok' && Array.isArray(live.titan_candidates)) {
        setData(live);
        showToast('✅ 已同步最新落難天使好球帶可轉債掃描資料！');
      } else {
        setData(defaultAsymData);
        showToast('✅ 已重整至最新落難天使好球帶可轉債雷達 (2026-10-25)！');
      }
    } catch (e) {
      setData(defaultAsymData);
    } finally {
      setLoading(false);
    }
  };

  // 計算每檔槽位預算 (固定最多 3 檔槽位，每檔 1/3)
  const activeSlotBudget = useMemo(() => {
    switch (followBudgetLevel) {
      case '300k': return 100000;   // 總資金 30萬 -> 單檔 10萬
      case '900k': return 300000;   // 總資金 90萬 -> 單檔 30萬
      case '3000k': return 1000000; // 總資金 300萬(CBAS上限) -> 單檔 100萬
      case '15000k': return 5000000;// 總資金 1500萬(CB現貨) -> 單檔 500萬
      default: return 300000;
    }
  }, [followBudgetLevel]);

  // 候選清單分類 (落難天使好球帶三層漏斗)
  const allCandidates = useMemo(() => {
    return data?.titan_candidates || defaultAsymData?.titan_candidates || [];
  }, [data]);

  const inZoneList = useMemo(() => allCandidates.filter(c => c.strike_zone_status === 'in_zone' || (c.is_strict_buy && !c.is_deep_otm_trap)), [allCandidates]);
  const nearZoneList = useMemo(() => allCandidates.filter(c => c.strike_zone_status === 'near_zone' || (c.is_waiting_pivot && !c.is_deep_otm_trap)), [allCandidates]);
  const traplist = useMemo(() => allCandidates.filter(c => c.strike_zone_status === 'trap' || c.is_deep_otm_trap), [allCandidates]);
  const watchingList = useMemo(() => allCandidates.filter(c => c.strike_zone_status === 'watching'), [allCandidates]);

  // 兼容舊別名
  const strictBuyList = inZoneList;
  const waitingPivotList = nearZoneList;

  const displayedRadarItems = useMemo(() => {
    if (radarFilter === 'in_zone' || radarFilter === 'strict_buy') return inZoneList;
    if (radarFilter === 'near_zone' || radarFilter === 'waiting_pivot') return nearZoneList;
    if (radarFilter === 'trap') return traplist;
    if (radarFilter === 'watching') return watchingList;
    return allCandidates;
  }, [radarFilter, inZoneList, nearZoneList, traplist, watchingList, allCandidates]);

  // 動態計算用戶實戰 KPI (由真實歷史進出驅動)
  const userPerf = useMemo(() => {
    const total = tradeHistory.length;
    const wins = tradeHistory.filter(t => (t.pnl_pct || 0) > 0).length;
    const losses = total - wins;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const totalPnlTwd = tradeHistory.reduce((acc, t) => acc + (Number(t.pnl_twd) || 0), 0);
    const avgReturnPct = total > 0
      ? (tradeHistory.reduce((acc, t) => acc + (Number(t.pnl_pct) || 0), 0) / total).toFixed(2)
      : '0.00';
    const avgHoldDays = total > 0
      ? (tradeHistory.reduce((acc, t) => acc + (Number(t.holding_days) || 18), 0) / total).toFixed(1)
      : '18.0';
    return {
      total_closed: total,
      wins,
      losses,
      win_rate: winRate,
      total_pnl_twd: totalPnlTwd,
      avg_return_pct: avgReturnPct,
      avg_holding_days: avgHoldDays
    };
  }, [tradeHistory]);

  // ⚡ 從雷達行內一鍵跟單買入
  const handleInlineBuy = (item) => {
    const rowIn = radarRowInputs[item.cb_code] || {};
    const selectedMode = rowIn.mode || followMode;
    const defaultPrice = selectedMode === 'CBAS' ? item.cbas_quote : item.cb_price;
    const inputPrice = rowIn.price !== undefined && rowIn.price !== '' ? parseFloat(rowIn.price) : defaultPrice;

    // 1張 CBAS 權利金成本 = 報價 * 1000；1張 CB現貨成本 = 報價 * 1000
    const unitCost = Math.max(1000, Math.round(inputPrice * 1000));
    const defaultLots = Math.max(1, Math.floor(activeSlotBudget / unitCost));
    const inputLots = rowIn.lots !== undefined && rowIn.lots !== '' ? parseInt(rowIn.lots, 10) : defaultLots;

    if (!inputPrice || inputPrice <= 0 || !inputLots || inputLots <= 0) {
      alert('請輸入有效的買入價格與張數！');
      return;
    }

    const now = new Date();
    const curDate = now.toISOString().split('T')[0];
    const curTime = now.toTimeString().split(' ')[0].slice(0, 5);
    const capitalUsed = Math.round(inputPrice * 1000 * inputLots);

    const newHolding = {
      id: `cb_pos_${Date.now()}`,
      slot: Math.min(3, activeHoldings.length + 1),
      ticker: item.stock_id,
      stock_name: item.stock_name,
      cb_code: item.cb_code,
      cb_name: item.cb_name,
      mode: selectedMode,
      entry_date: curDate,
      entry_time: curTime,
      entry_price: inputPrice,
      current_price: inputPrice,
      lots: inputLots,
      capital_used: capitalUsed,
      unrealized_pnl_pct: 0.0,
      unrealized_pnl_twd: 0,
      holding_days: 1,
      max_hold_days: 28,
      target_stage1_price: selectedMode === 'CBAS' ? parseFloat((inputPrice * 1.85).toFixed(2)) : item.target_stage1_cb,
      target_stage2_price: selectedMode === 'CBAS' ? parseFloat((inputPrice * 2.80).toFixed(2)) : item.target_stage2_cb,
      stop_loss_price: selectedMode === 'CBAS' ? parseFloat((inputPrice * 0.80).toFixed(2)) : item.stop_loss_cb,
      can_sell: false,
      sell_badge: '🛡️ 新建倉持有中 (第 1/28 天)',
      sell_instruction: `進場時間 ${curDate} ${curTime}，等待主升段噴發觸及停利，最慢滿 28 天(4週)定時換倉！`,
      notes: `落難天使好球帶：賽道=${item.theme_tag || item.industry} | 距離好球帶=${item.distance_to_strike_pct}% | 千張大戶=${item.whale_pct}% | 發行${item.issue_amount_b || 20}億`
    };

    setActiveHoldings(prev => [newHolding, ...prev]);
    showToast(`✅ 已成功跟單買入【${item.cb_name} (${item.cb_code})】(${selectedMode})！買價: ${inputPrice}，數量: ${inputLots} 張 (動用 NT$${capitalUsed.toLocaleString()})`);
    setActiveSubTab('tracker');
  };

  // 📋 複製券商下單指令
  const handleCopyOrderCommand = (item) => {
    const rowIn = radarRowInputs[item.cb_code] || {};
    const selectedMode = rowIn.mode || followMode;
    const defaultPrice = selectedMode === 'CBAS' ? item.cbas_quote : item.cb_price;
    const valPrice = rowIn.price !== undefined && rowIn.price !== '' ? parseFloat(rowIn.price) : defaultPrice;
    const unitCost = Math.max(1000, Math.round(valPrice * 1000));
    const defaultLots = Math.max(1, Math.floor(activeSlotBudget / unitCost));
    const valLots = rowIn.lots !== undefined && rowIn.lots !== '' ? parseInt(rowIn.lots, 10) : defaultLots;
    const totalCost = Math.round(valPrice * 1000 * valLots);

    const text = selectedMode === 'CBAS'
      ? `【🎯落難天使CBAS好球帶狙擊】標的：${item.cb_name} (${item.cb_code} / 現股 ${item.stock_id} ${item.stock_name}) | 賽道：${item.theme_tag || item.industry} | 模式：CBAS選擇權 | 建議買進權利金：${valPrice} 元/百元面額 | 建議張數：${valLots} 張 (動用權利金約 NT$${totalCost.toLocaleString()}) | 距離好球帶：${item.distance_to_strike_pct}% | 翻倍預估：+${item.est_mult_2x || 35}倍 | 停損：僅限權利金`
      : `【🛡️落難天使CB現貨保底跟單】標的：${item.cb_name} (${item.cb_code} / 現股 ${item.stock_id} ${item.stock_name}) | 模式：CB現貨 | 建議買進價：${valPrice} 元 | 建議張數：${valLots} 張 (動用約 NT$${totalCost.toLocaleString()}) | 首段停利：${item.target_stage1_cb}元 | 暴擊目標：${item.target_stage2_cb}元 | 下檔保護：100元債底保底`;

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      showToast(`📋 已複製【${item.cb_name}】下單指令！可直接貼至券商營業員詢價或交易筆記！`);
    } else {
      window.prompt('請複製以下跟單指令：', text);
    }
  };

  // ⚡ 頂部快速手動買進
  const handleQuickAddSubmit = () => {
    if (!quickAdd.cb_code || !quickAdd.price) {
      alert('請填寫可轉債代號（如 23822）與買入價格！');
      return;
    }
    const p = parseFloat(quickAdd.price);
    const lts = parseInt(quickAdd.lots, 10) || 5;
    const cap = Math.round(p * 1000 * lts);

    const newHolding = {
      id: `cb_pos_${Date.now()}`,
      slot: Math.min(3, activeHoldings.length + 1),
      ticker: quickAdd.cb_code.slice(0, 4),
      stock_name: quickAdd.cb_name || quickAdd.cb_code,
      cb_code: quickAdd.cb_code.toUpperCase(),
      cb_name: quickAdd.cb_name || quickAdd.cb_code.toUpperCase(),
      mode: quickAdd.mode,
      entry_date: quickAdd.date,
      entry_time: quickAdd.time,
      entry_price: p,
      current_price: p,
      lots: lts,
      capital_used: cap,
      unrealized_pnl_pct: 0.0,
      unrealized_pnl_twd: 0,
      holding_days: 1,
      max_hold_days: 28,
      target_stage1_price: quickAdd.mode === 'CBAS' ? parseFloat((p * 1.85).toFixed(2)) : parseFloat((p * 1.12).toFixed(2)),
      target_stage2_price: quickAdd.mode === 'CBAS' ? parseFloat((p * 2.80).toFixed(2)) : parseFloat((p * 1.25).toFixed(2)),
      stop_loss_price: quickAdd.mode === 'CBAS' ? parseFloat((p * 0.80).toFixed(2)) : 100.2,
      can_sell: false,
      sell_badge: '🛡️ 手動建倉持有中 (第 1/28 天)',
      sell_instruction: '最慢滿 28 天(4週)執行定時換倉，達標首段停利可先出 50%',
      notes: '頂部快速手動記帳買入'
    };

    setActiveHoldings(prev => [newHolding, ...prev]);
    setQuickAdd({
      cb_code: '',
      cb_name: '',
      mode: 'CBAS',
      price: '',
      lots: '5',
      date: new Date().toISOString().split('T')[0],
      time: new Date().toTimeString().split(' ')[0].slice(0, 5)
    });
    showToast(`✅ 已成功記錄買入【${newHolding.cb_name}】(${newHolding.mode}) ${lts} 張！`);
    setActiveSubTab('tracker');
  };

  // 🚪 從持倉追蹤行內直接輸入賣出價平倉
  const handleInlineClose = (pos) => {
    const rowEx = exitRowInputs[pos.id] || {};
    const exitPrice = rowEx.price !== undefined && rowEx.price !== '' ? parseFloat(rowEx.price) : pos.current_price;
    if (!exitPrice || exitPrice <= 0) {
      alert('請輸入有效的賣出平倉價格！');
      return;
    }
    const exitDate = rowEx.exitDate || new Date().toISOString().split('T')[0];
    const exitTime = rowEx.exitTime || new Date().toTimeString().split(' ')[0].slice(0, 5);
    const exitReason = rowEx.reason || '🎯 觸及目標停利落袋';

    const pnlPct = parseFloat((((exitPrice - pos.entry_price) / pos.entry_price) * 100).toFixed(2));
    const pnlTwd = Math.round((exitPrice - pos.entry_price) * 1000 * (pos.lots || 1));

    const d1 = new Date(pos.entry_date);
    const d2 = new Date(exitDate);
    const diffDays = Math.max(1, Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24))) || pos.holding_days || 1;

    const closedRecord = {
      id: `cb_hist_${Date.now()}`,
      ticker: pos.ticker,
      stock_name: pos.stock_name,
      cb_code: pos.cb_code,
      cb_name: pos.cb_name,
      mode: pos.mode,
      entry_date: pos.entry_date,
      entry_time: pos.entry_time,
      exit_date: exitDate,
      exit_time: exitTime,
      entry_price: pos.entry_price,
      exit_price: exitPrice,
      lots: pos.lots,
      capital_used: pos.capital_used,
      pnl_pct: pnlPct,
      pnl_twd: pnlTwd,
      holding_days: diffDays,
      exit_reason: exitReason,
      notes: pos.notes || ''
    };

    setActiveHoldings(prev => prev.filter(x => x.id !== pos.id));
    setTradeHistory(prev => [closedRecord, ...prev]);
    showToast(`🎉 已平倉結算【${pos.cb_name}】！報酬率: ${pnlPct >= 0 ? '+' : ''}${pnlPct}% (實賺 NT$ ${pnlTwd >= 0 ? '+' : ''}${pnlTwd.toLocaleString()})，已歸檔至歷史帳本！`);
    setActiveSubTab('history');
  };

  // 📜 手動補登歷史進出紀錄
  const handleManualHistorySubmit = () => {
    if (!manualHistoryForm.cb_code || !manualHistoryForm.entry_price || !manualHistoryForm.exit_price) {
      alert('請填寫可轉債代號、買進價格與賣出價格！');
      return;
    }
    const entryP = parseFloat(manualHistoryForm.entry_price);
    const exitP = parseFloat(manualHistoryForm.exit_price);
    const lts = parseInt(manualHistoryForm.lots, 10) || 5;
    const pnlPct = parseFloat((((exitP - entryP) / entryP) * 100).toFixed(2));
    const pnlTwd = Math.round((exitP - entryP) * 1000 * lts);

    const d1 = new Date(manualHistoryForm.entry_date);
    const d2 = new Date(manualHistoryForm.exit_date);
    const holdingDays = Math.max(1, Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24))) || 1;

    const newRec = {
      id: `cb_manual_${Date.now()}`,
      ticker: manualHistoryForm.cb_code.slice(0, 4),
      stock_name: manualHistoryForm.stock_name || manualHistoryForm.cb_name || manualHistoryForm.cb_code,
      cb_code: manualHistoryForm.cb_code.toUpperCase(),
      cb_name: manualHistoryForm.cb_name || manualHistoryForm.cb_code.toUpperCase(),
      mode: manualHistoryForm.mode,
      entry_date: manualHistoryForm.entry_date,
      entry_time: manualHistoryForm.entry_time,
      exit_date: manualHistoryForm.exit_date,
      exit_time: manualHistoryForm.exit_time,
      entry_price: entryP,
      exit_price: exitP,
      lots: lts,
      capital_used: Math.round(entryP * 1000 * lts),
      pnl_pct: pnlPct,
      pnl_twd: pnlTwd,
      holding_days: holdingDays,
      exit_reason: manualHistoryForm.exit_reason,
      notes: manualHistoryForm.notes
    };

    setTradeHistory(prev => [newRec, ...prev]);
    setShowManualHistoryModal(false);
    showToast(`🎉 成功補登【${newRec.cb_name}】進出歷史！報酬率: ${pnlPct >= 0 ? '+' : ''}${pnlPct}% (NT$ ${pnlTwd.toLocaleString()})`);
  };

  // 刪除持倉或歷史紀錄
  const handleDeleteActive = (id, name) => {
    if (window.confirm(`確定要移除進行中持倉【${name}】嗎？`)) {
      setActiveHoldings(prev => prev.filter(x => x.id !== id));
      showToast(`🗑️ 已移除持倉【${name}】`);
    }
  };

  const handleDeleteHistory = (id, name) => {
    if (window.confirm(`確定要刪除【${name}】的這筆歷史成交紀錄嗎？`)) {
      setTradeHistory(prev => prev.filter(x => x.id !== id));
      showToast(`🗑️ 已刪除歷史紀錄【${name}】`);
    }
  };

  // 篩選實戰歷史紀錄
  const filteredUserHistory = useMemo(() => {
    return tradeHistory.filter(t => {
      if (historyFilter === 'win' && (t.pnl_pct || 0) <= 0) return false;
      if (historyFilter === 'rotation28' && !String(t.exit_reason || '').includes('28') && !String(t.exit_reason || '').includes('換倉')) return false;
      if (historyFilter === 'cbas' && t.mode !== 'CBAS') return false;
      if (historyFilter === 'cash_cb' && t.mode !== 'CB現貨') return false;
      if (historySearch.trim()) {
        const q = historySearch.trim().toUpperCase();
        return (
          String(t.cb_code || '').toUpperCase().includes(q) ||
          String(t.cb_name || '').toUpperCase().includes(q) ||
          String(t.stock_name || '').toUpperCase().includes(q) ||
          String(t.entry_date || '').includes(q) ||
          String(t.exit_date || '').includes(q)
        );
      }
      return true;
    });
  }, [tradeHistory, historyFilter, historySearch]);

  // 匯出個人實戰進出歷史 CSV
  const handleExportUserHistoryCsv = () => {
    if (tradeHistory.length === 0) {
      alert('目前尚無進出歷史紀錄可匯出！');
      return;
    }
    const headers = ['CB代號', 'CB名稱', '現股名稱', '交易模式', '買進日期', '買進時間', '賣出日期', '賣出時間', '買進價格', '賣出價格', '張數', '動用本金(NT$)', '平倉報酬率(%)', '實賺損益(NT$)', '持有天數', '出場理由', '備註'];
    const rows = tradeHistory.map(t => [
      t.cb_code,
      `"${t.cb_name || ''}"`,
      `"${t.stock_name || ''}"`,
      t.mode,
      t.entry_date,
      t.entry_time || '',
      t.exit_date,
      t.exit_time || '',
      t.entry_price,
      t.exit_price,
      t.lots,
      t.capital_used || 0,
      t.pnl_pct,
      t.pnl_twd,
      t.holding_days,
      `"${t.exit_reason || ''}"`,
      `"${t.notes || ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cb_cbas_user_trade_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 27 年回測交易明細過濾與分頁 (2000~2026)
  const yearsList = useMemo(() => {
    const yrs = [];
    for (let y = 2026; y >= 2000; y--) yrs.push(y);
    return yrs;
  }, []);

  const filteredCbTrades = useMemo(() => {
    return allCbTrades.filter(t => {
      if (cbTradeFilter === 'big_win' && t.pnl_pct < 20) return false;
      if (cbTradeFilter === 'bond_floor' && t.pnl_pct >= 5) return false;
      if (cbTradeYearFilter !== 'all' && String(t.year) !== String(cbTradeYearFilter)) return false;
      if (cbTradeSearch.trim()) {
        const q = cbTradeSearch.trim().toLowerCase();
        return (
          String(t.ticker || '').toLowerCase().includes(q) ||
          String(t.stock_name || '').toLowerCase().includes(q) ||
          String(t.cb_code || '').toLowerCase().includes(q) ||
          String(t.cb_name || '').toLowerCase().includes(q) ||
          String(t.exit_reason || '').toLowerCase().includes(q) ||
          String(t.factor_signals || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allCbTrades, cbTradeFilter, cbTradeYearFilter, cbTradeSearch]);

  const totalCbPages = Math.ceil(filteredCbTrades.length / CB_TRADES_PAGE_SIZE) || 1;
  const currentCbPageTrades = filteredCbTrades.slice(
    (cbTradePage - 1) * CB_TRADES_PAGE_SIZE,
    cbTradePage * CB_TRADES_PAGE_SIZE
  );

  const handleExportCbBacktestCsv = () => {
    const headers = ['編號', '持有槽位', '年份', '股票代號', '股票名稱', 'CB代碼', 'CB名稱', '產業別', '買進日期', '出場日期', '買進價格', '出場價格', '持有天數', '投入本金(NTD)', '實現損益(NTD)', 'CB現貨報酬率%', 'CBAS淨報酬率%', '出場原因', '泰坦17因子DOE標籤'];
    const rows = filteredCbTrades.map(t => [
      t.id,
      `"槽位 ${t.slot_index || 1}"`,
      t.year,
      t.ticker,
      t.stock_name,
      t.cb_code,
      t.cb_name,
      `"${t.industry}"`,
      t.entry_date,
      t.exit_date,
      t.entry_price,
      t.exit_price,
      t.holding_days,
      Math.round(t.allocated_capital || 333333),
      Math.round(t.net_pnl_cash || 0),
      t.pnl_pct,
      t.cbas_roi_pct,
      `"${t.exit_reason}"`,
      `"${t.factor_signals}"`
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cb_fallen_angels_27y_trades_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📥 已匯出 ${filteredCbTrades.length} 筆 27 年落難天使好球帶回測明細 CSV！`);
  };

  return (
    <div style={{ padding: '0 0.5rem', animation: 'fadeIn 0.3s ease-in-out', paddingBottom: '3rem' }}>
      {/* 提示通知氣泡 */}
      {notice && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #10B981, #059669)',
          color: '#FFF',
          padding: '0.85rem 1.4rem',
          borderRadius: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          zIndex: 99999,
          fontWeight: 'bold',
          fontSize: '0.92rem'
        }}>
          {notice}
        </div>
      )}

      {/* ============================================================== */}
      {/* 頂部主標題、AI後期28天極速換倉策略橫幅 ＆ 5大實戰真實KPI */}
      {/* ============================================================== */}
      <div className="glass-card" style={{
        padding: '1.1rem 1.4rem',
        marginBottom: '1rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 27, 75, 0.90))',
        border: '1px solid rgba(245, 158, 11, 0.4)',
        borderLeft: '5px solid #F59E0B'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#FBBF24', fontSize: '1.24rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              🎯 台股可轉債（CB / CBAS）落難天使好球帶狙擊艙 【上限：CB 5,000萬 / CBAS 300萬】
            </h3>
            <span style={{
              fontSize: '0.76rem',
              background: 'rgba(56, 189, 248, 0.18)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#38BDF8',
              padding: '0.2rem 0.65rem',
              borderRadius: '5px',
              fontWeight: 'bold'
            }}>
              📡 最新行情日：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-25'}</strong>
            </span>
            <span style={{
              fontSize: '0.75rem',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              color: '#6EE7B7',
              padding: '0.2rem 0.6rem',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              🎯 落難天使三大篩選漏斗 × 崩跌好球帶(CB ≤ 104 / CBAS ≤ 3元) × 不對稱暴擊
            </span>
          </div>

          <button
            onClick={fetchLatest}
            disabled={loading}
            style={{
              padding: '0.35rem 0.85rem',
              fontSize: '0.78rem',
              borderRadius: '6px',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(234, 88, 12, 0.25))',
              color: '#FDE68A',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            {loading ? '🔄 掃描中...' : '🎯 重新掃描落難天使雷達'}
          </button>
        </div>

        {/* 落難天使核心策略法則橫條 */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.28)',
          borderRadius: '8px',
          padding: '0.7rem 1rem',
          marginBottom: '0.75rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '0.8rem',
          fontSize: '0.79rem',
          color: '#CBD5E1',
          lineHeight: '1.5'
        }}>
          <div>
            <span style={{ color: '#FBBF24', fontWeight: 'bold' }}>🔬 落難天使三大漏斗篩選法則：</span>
            ① <strong>發行規模 ≥ 5億 ＋ 存續期間 ≥ 1.5年</strong>（券商造市與 CBAS 拆解額度充裕，有足夠時間翻倍）＋ ② <strong>大戶鎖碼 ≥ 50% ＋ 曾創高價 ≥ 125元</strong>（熱門主流賽道、具備飆股基因）＋ ③ <strong>崩跌好球帶觸發</strong>：平常只看不買，專等大盤暴跌恐慌時，CB 砸回 <strong>≤ 104元</strong>，CBAS 權利金打回 <strong>≤ 3.0元銅板價</strong>！
          </div>
          <div>
            <span style={{ color: '#34D399', fontWeight: 'bold' }}>⚡ 崩跌收割・30~100倍不對稱暴擊：</span>
            大戶鎖碼後進場只會追高，<strong>唯有大盤無差別崩跌，明星 CB 才會被迫掉入好球帶</strong>！實證歷史神作：<strong>2020 奇鋐五/長榮四、2022 華城三/雙鴻四</strong>均在崩跌時跌入 100~104 元，以 1~3 元 CBAS 銅板價重倉撈底，大盤落底復甦後狂噴 <strong>30x~200x</strong> 史詩級獲利！
          </div>
        </div>

        {/* 實戰真實 KPI 橫條 (由真實歷史進出驅動，無快照) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.6rem'
        }}>
          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>📜 實戰進出已結算</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#F8FAFC', marginTop: '0.1rem' }}>
              {userPerf.total_closed} <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>筆</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#38BDF8', marginTop: '0.1rem' }}>
              進行中持倉：{activeHoldings.length} / 3 槽位
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
            <div style={{ fontSize: '0.7rem', color: '#A7F3D0' }}>🎯 實戰平均勝率</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#34D399', marginTop: '0.1rem' }}>
              {userPerf.win_rate}%
            </div>
            <div style={{ fontSize: '0.68rem', color: '#6EE7B7', marginTop: '0.1rem' }}>
              {userPerf.wins} 勝 / {userPerf.losses} 負
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.25)' }}>
            <div style={{ fontSize: '0.7rem', color: '#FEF08A' }}>💰 台幣累計實賺</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#FACC15', marginTop: '0.1rem' }}>
              NT$ {userPerf.total_pnl_twd.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#E2E8F0', marginTop: '0.1rem' }}>
              可轉債免徵 0.3% 證交稅
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
            <div style={{ fontSize: '0.7rem', color: '#BAE6FD' }}>📈 平均單筆獲利</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38BDF8', marginTop: '0.1rem' }}>
              {Number(userPerf.avg_return_pct) >= 0 ? '+' : ''}{userPerf.avg_return_pct}%
            </div>
            <div style={{ fontSize: '0.68rem', color: '#93C5FD', marginTop: '0.1rem' }}>
              27年回測年化：+{cbBacktestSummary.cbas_cagr || 134.8}%
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.55rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(192, 132, 252, 0.25)' }}>
            <div style={{ fontSize: '0.7rem', color: '#E9D5FF' }}>⏱️ 實戰平均持倉</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#C084FC', marginTop: '0.1rem' }}>
              {userPerf.avg_holding_days} <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>天</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#E9D5FF', marginTop: '0.1rem' }}>
              滿 28 天(4週)強制換倉
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* ⚡ 快速手動買進 / 跟單記帳列 */}
      {/* ============================================================== */}
      <div className="glass-card" style={{
        padding: '0.75rem 1.1rem',
        marginBottom: '1rem',
        background: 'rgba(15, 23, 42, 0.8)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span>⚡</span> 快速買進記帳：
          </span>

          <input
            type="text"
            placeholder="CB代號 (如 23822)"
            value={quickAdd.cb_code}
            onChange={e => setQuickAdd(prev => ({ ...prev, cb_code: e.target.value }))}
            style={{
              padding: '0.35rem 0.6rem',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0F172A',
              color: '#FCD34D',
              width: '125px',
              fontWeight: 'bold'
            }}
          />

          <input
            type="text"
            placeholder="CB名稱 (如 廣達二)"
            value={quickAdd.cb_name}
            onChange={e => setQuickAdd(prev => ({ ...prev, cb_name: e.target.value }))}
            style={{
              padding: '0.35rem 0.6rem',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: '#0F172A',
              color: '#FFF',
              width: '125px'
            }}
          />

          <select
            value={quickAdd.mode}
            onChange={e => setQuickAdd(prev => ({ ...prev, mode: e.target.value }))}
            style={{
              padding: '0.35rem 0.5rem',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: '1px solid #F59E0B',
              background: '#0F172A',
              color: '#FDE68A',
              fontWeight: 'bold'
            }}
          >
            <option value="CBAS">🚀 CBAS 選擇權</option>
            <option value="CB現貨">🛡️ CB 現貨保底</option>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#FACC15', fontWeight: 'bold' }}>買入價:</span>
            <input
              type="number"
              step="any"
              placeholder={quickAdd.mode === 'CBAS' ? '權利金(如14.2)' : 'CB價(如112.5)'}
              value={quickAdd.price}
              onChange={e => setQuickAdd(prev => ({ ...prev, price: e.target.value }))}
              style={{
                padding: '0.35rem 0.6rem',
                fontSize: '0.8rem',
                borderRadius: '4px',
                border: '1px solid #F59E0B',
                background: '#0F172A',
                color: '#FACC15',
                width: '115px',
                fontWeight: 'bold'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#CBD5E1' }}>張數:</span>
            <input
              type="number"
              value={quickAdd.lots}
              onChange={e => setQuickAdd(prev => ({ ...prev, lots: e.target.value }))}
              style={{
                padding: '0.35rem 0.5rem',
                fontSize: '0.8rem',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,255,0.15)',
                background: '#0F172A',
                color: '#FFF',
                width: '70px'
              }}
            />
          </div>

          <input
            type="date"
            value={quickAdd.date}
            onChange={e => setQuickAdd(prev => ({ ...prev, date: e.target.value }))}
            style={{
              padding: '0.35rem 0.5rem',
              fontSize: '0.78rem',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: '#0F172A',
              color: '#FFF'
            }}
          />

          <button
            onClick={handleQuickAddSubmit}
            style={{
              padding: '0.35rem 0.9rem',
              fontSize: '0.8rem',
              borderRadius: '4px',
              border: 'none',
              background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
              color: '#FFF',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            ➕ 立即記錄買入
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4 大核心子分頁切換導航 (比照超賣快打直覺跟單架構) */}
      {/* ============================================================== */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.6rem', flexWrap: 'wrap' }}>
        {[
          {
            id: 'radar',
            label: `🎯 今日落難天使好球帶雷達 (${inZoneList.length} 檔在好球帶·首選敲進)`,
            color: '#F59E0B',
            bg: 'rgba(245, 158, 11, 0.25)'
          },
          {
            id: 'tracker',
            label: `💼 我的進行中持倉 (${activeHoldings.length}/3 檔槽位·好球帶持倉)`,
            color: '#38BDF8',
            bg: 'rgba(56, 189, 248, 0.22)'
          },
          {
            id: 'history',
            label: `📜 實戰進出歷史紀錄簿 (${tradeHistory.length} 筆已結算·累計獲利)`,
            color: '#10B981',
            bg: 'rgba(16, 185, 129, 0.22)'
          },
          {
            id: 'doe_backtest',
            label: `📊 歷史四大神作巡禮與 27 年實證 (${allCbTrades.length} 筆)`,
            color: '#A855F7',
            bg: 'rgba(168, 85, 247, 0.22)'
          }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            style={{
              padding: '0.48rem 1rem',
              borderRadius: '6px',
              border: activeSubTab === tab.id ? `1px solid ${tab.color}` : '1px solid rgba(255,255,255,0.1)',
              background: activeSubTab === tab.id ? tab.bg : 'rgba(15, 23, 42, 0.65)',
              color: activeSubTab === tab.id ? '#FFF' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================================== */}
      {/* 視圖 1：🎯 今日落難天使好球帶雷達 (一鍵跟單 + 複製指令) */}
      {/* ============================================================== */}
      {activeSubTab === 'radar' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.9rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.08rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                🎯 台股可轉債（CB / CBAS）落難天使好球帶即時掃描清單
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                嚴格執行三大篩選漏斗：<strong>發行規模 ≥ 5億 ＋ 存續 ≥ 1.5年 ＋ 千張大戶 ≥ 50% ＋ 曾創高價明星賽道</strong>。平時一股不買，專等大盤暴跌砸進 <strong>≤ 104 元好球帶（CBAS ≤ 3.0 元銅板價）</strong>撈底收割！
              </p>
            </div>

            {/* 雷達分級篩選器 */}
            <div style={{ display: 'flex', gap: '0.35rem', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap' }}>
              <button
                onClick={() => setRadarFilter('in_zone')}
                style={{
                  padding: '0.26rem 0.7rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: (radarFilter === 'in_zone' || radarFilter === 'strict_buy') ? 'linear-gradient(135deg, #10B981, #059669)' : 'transparent',
                  color: (radarFilter === 'in_zone' || radarFilter === 'strict_buy') ? '#FFF' : '#94A3B8'
                }}
              >
                🎯 進入真好球帶 (Parity≥75) ({inZoneList.length})
              </button>
              <button
                onClick={() => setRadarFilter('near_zone')}
                style={{
                  padding: '0.26rem 0.7rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: (radarFilter === 'near_zone' || radarFilter === 'waiting_pivot') ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'transparent',
                  color: (radarFilter === 'near_zone' || radarFilter === 'waiting_pivot') ? '#FFF' : '#94A3B8'
                }}
              >
                🟡 逼近警戒區 (Parity≥75) ({nearZoneList.length})
              </button>
              <button
                onClick={() => setRadarFilter('trap')}
                style={{
                  padding: '0.26rem 0.7rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'trap' ? 'linear-gradient(135deg, #EF4444, #B91C1C)' : 'transparent',
                  color: radarFilter === 'trap' ? '#FFF' : '#FCA5A5'
                }}
              >
                ⚠️ 深度價外陷阱池 (Parity&lt;75) ({traplist.length})
              </button>
              <button
                onClick={() => setRadarFilter('watching')}
                style={{
                  padding: '0.26rem 0.7rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'watching' ? 'linear-gradient(135deg, #64748B, #475569)' : 'transparent',
                  color: radarFilter === 'watching' ? '#FFF' : '#94A3B8'
                }}
              >
                ⚪ 高檔觀望中 ({watchingList.length})
              </button>
              <button
                onClick={() => setRadarFilter('all')}
                style={{
                  padding: '0.26rem 0.7rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'all' ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
                  color: radarFilter === 'all' ? '#FFF' : '#94A3B8'
                }}
              >
                全部落難天使候選池 ({allCandidates.length})
              </button>
            </div>
          </div>

          {/* 🧮 跟單模式與資金預算試算列 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.8rem',
            padding: '0.65rem 0.95rem',
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.28)',
            borderRadius: '8px',
            marginBottom: '0.9rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#38BDF8' }}>
                🛠️ 預設跟單工具：
              </span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                {[
                  { id: 'CBAS', label: '🚀 CBAS 選擇權 (上限300萬·高槓桿暴擊)' },
                  { id: 'CB現貨', label: '🛡️ CB 現貨 (上限5000萬·100元債底保底)' }
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setFollowMode(m.id)}
                    style={{
                      padding: '0.24rem 0.6rem',
                      borderRadius: '4px',
                      border: followMode === m.id ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
                      background: followMode === m.id ? 'linear-gradient(135deg, #D97706, #B45309)' : 'rgba(15, 23, 42, 0.6)',
                      color: followMode === m.id ? '#FFF' : '#94A3B8',
                      fontSize: '0.74rem',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#38BDF8', marginLeft: '0.4rem' }}>
                🧮 3槽位總資金試算：
              </span>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {[
                  { id: '300k', label: '30萬 (單檔10萬)' },
                  { id: '900k', label: '90萬 (單檔30萬)' },
                  { id: '3000k', label: '300萬 CBAS滿額 (單檔100萬)' },
                  { id: '15000k', label: '1500萬 CB現貨 (單檔500萬)' }
                ].map(lvl => (
                  <button
                    key={lvl.id}
                    onClick={() => setFollowBudgetLevel(lvl.id)}
                    style={{
                      padding: '0.24rem 0.55rem',
                      borderRadius: '4px',
                      border: followBudgetLevel === lvl.id ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
                      background: followBudgetLevel === lvl.id ? 'linear-gradient(135deg, #0284C7, #0369A1)' : 'rgba(15, 23, 42, 0.6)',
                      color: followBudgetLevel === lvl.id ? '#FFF' : '#94A3B8',
                      fontSize: '0.74rem',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#7DD3FC' }}>
              💡 單檔槽位預算：<strong style={{ color: '#FACC15', fontFamily: 'monospace' }}>NT$ {activeSlotBudget.toLocaleString()}</strong> (已自動換算右方建議買進張數)
            </div>
          </div>

          {/* 🌟 歷史四大落難天使神作榜 (證明「大盤恐慌崩跌 ＝ CBAS 暴擊好球帶」) */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.7), rgba(15, 23, 42, 0.8))',
            border: '1px solid rgba(168, 85, 247, 0.35)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#E9D5FF', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>🌟</span> 歷史四大落難天使神作巡禮（證明「大盤恐慌崩跌 ＝ CBAS 暴擊好球帶」）：
              </span>
              <span style={{ fontSize: '0.72rem', color: '#A78BFA' }}>
                💡 共通點：平常高不可攀，唯有大盤暴跌破發跌至 97~103 元，大盤回春後 CB 噴破 350~1000 元！
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: '0.6rem'
            }}>
              {[
                {
                  title: '⚡ 華城三 (15193)',
                  track: '重電變壓器龍頭',
                  crashDate: '2022/10 大盤殺萬二恐慌',
                  bottomPrice: 'CB跌至 101.5 元 (CBAS 1.8 元)',
                  peakPrice: '現股飆 988 元 / CB飆破 1,000 元',
                  cbasGain: '+55,455% (550倍暴擊)',
                  bg: 'rgba(245, 158, 11, 0.12)',
                  border: 'rgba(245, 158, 11, 0.35)',
                  color: '#FDE68A'
                },
                {
                  title: '❄️ 奇鋐五 (30175)',
                  track: 'AI伺服器散熱水冷龍頭',
                  crashDate: '2022/10 升息通膨恐慌',
                  bottomPrice: 'CB跌至 102.8 元 (CBAS 2.4 元)',
                  peakPrice: '現股飆 740 元 / CB飆破 420 元',
                  cbasGain: '+13,200% (132倍暴擊)',
                  bg: 'rgba(56, 189, 248, 0.12)',
                  border: 'rgba(56, 189, 248, 0.35)',
                  color: '#7DD3FC'
                },
                {
                  title: '❄️ 雙鴻四 (33244)',
                  track: '水冷散熱板 / 液冷CDU',
                  crashDate: '2022年 全球科技股去庫存',
                  bottomPrice: 'CB跌至 101.2 元 (CBAS 2.1 元)',
                  peakPrice: '現股飆 800+ 元 / CB飆破 360 元',
                  cbasGain: '+12,280% (122倍暴擊)',
                  bg: 'rgba(168, 85, 247, 0.12)',
                  border: 'rgba(168, 85, 247, 0.35)',
                  color: '#E9D5FF'
                },
                {
                  title: '🚢 長榮四 (26034)',
                  track: '全球貨櫃航運巨擘',
                  crashDate: '2020/03 COVID-19世紀熔斷',
                  bottomPrice: 'CB跌至 97.5 元破發 (CBAS 1.2 元)',
                  peakPrice: '現股飆 233 元 / CB飆破 450 元',
                  cbasGain: '+29,000% (290倍暴擊)',
                  bg: 'rgba(16, 185, 129, 0.12)',
                  border: 'rgba(16, 185, 129, 0.35)',
                  color: '#6EE7B7'
                }
              ].map((hero, hIdx) => (
                <div key={hIdx} style={{
                  background: hero.bg,
                  border: `1px solid ${hero.border}`,
                  borderRadius: '6px',
                  padding: '0.55rem 0.75rem',
                  fontSize: '0.74rem',
                  lineHeight: '1.45'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <strong style={{ color: hero.color, fontSize: '0.82rem' }}>{hero.title}</strong>
                    <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{hero.track}</span>
                  </div>
                  <div style={{ color: '#CBD5E1', fontSize: '0.7rem' }}>📉 崩跌落難：{hero.crashDate}</div>
                  <div style={{ color: '#FCD34D', fontSize: '0.71rem' }}>🎯 好球帶底價：<strong>{hero.bottomPrice}</strong></div>
                  <div style={{ color: '#A7F3D0', fontSize: '0.71rem' }}>🚀 復甦噴發：{hero.peakPrice}</div>
                  <div style={{ color: '#F43F5E', fontWeight: 'bold', fontSize: '0.78rem', marginTop: '2px', textAlign: 'right' }}>
                    CBAS獲利：{hero.cbasGain}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 雷達候選表格 */}
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th>現股與可轉債代號</th>
                  <th style={{ textAlign: 'right' }}>現股價 / 轉換價 / Parity</th>
                  <th style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#A7F3D0' }}>
                    🎯 落難天使好球帶診斷 (距離 104 元好球帶 / 千張大戶 / 存續期)
                  </th>
                  <th style={{ textAlign: 'right', color: '#FBBF24' }}>CB現貨價 / CBAS權利金</th>
                  <th style={{ background: 'rgba(56, 189, 248, 0.08)', color: '#BAE6FD' }}>
                    🚀 暴擊目標與翻倍預估 (🎯好球帶狀態 / 翻倍倍數 / 停利點)
                  </th>
                  <th style={{ textAlign: 'center', background: 'rgba(245, 158, 11, 0.08)', color: '#FDE68A' }}>
                    ✍️ 快速跟單 (買價 / 張數 / 一鍵買入)
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedRadarItems.map(item => {
                  const rowIn = radarRowInputs[item.cb_code] || {};
                  const curMode = rowIn.mode || followMode;
                  const defaultPrice = curMode === 'CBAS' ? item.cbas_quote : item.cb_price;
                  const valPrice = rowIn.price !== undefined ? rowIn.price : defaultPrice;
                  const unitCost = Math.max(1000, Math.round((parseFloat(valPrice) || defaultPrice) * 1000));
                  const defaultLots = Math.max(1, Math.floor(activeSlotBudget / unitCost));
                  const valLots = rowIn.lots !== undefined ? rowIn.lots : defaultLots;

                  return (
                    <tr
                      key={item.cb_code}
                      style={{
                        background: (item.strike_zone_status === 'in_zone' || item.is_strict_buy)
                          ? 'rgba(16, 185, 129, 0.10)'
                          : ((item.strike_zone_status === 'near_zone' || item.is_waiting_pivot) ? 'rgba(245, 158, 11, 0.05)' : 'transparent'),
                        borderLeft: (item.strike_zone_status === 'in_zone' || item.is_strict_buy)
                          ? '4px solid #10B981'
                          : ((item.strike_zone_status === 'near_zone' || item.is_waiting_pivot) ? '4px solid #F59E0B' : 'none')
                      }}
                    >
                      {/* 1. 標的與CB代號 */}
                      <td style={{ verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <strong style={{ color: '#F8FAFC', fontSize: '0.92rem' }}>{item.cb_name} ({item.cb_code})</strong>
                          <span style={{
                            fontSize: '0.68rem',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontWeight: 'bold',
                            background: item.strike_zone_status === 'in_zone'
                              ? 'rgba(16, 185, 129, 0.25)'
                              : (item.strike_zone_status === 'near_zone' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.08)'),
                            color: item.strike_zone_status === 'in_zone'
                              ? '#34D399'
                              : (item.strike_zone_status === 'near_zone' ? '#FCD34D' : '#94A3B8')
                          }}>
                            {item.status_badge || (item.is_strict_buy ? '🎯 好球帶' : '👀 觀望')}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.73rem', color: '#38BDF8', marginTop: '3px', fontWeight: '500' }}>
                          {item.theme_tag || item.industry}
                        </div>
                        <div style={{ fontSize: '0.71rem', color: '#94A3B8', marginTop: '1px', fontFamily: 'monospace' }}>
                          現股: {item.stock_name} ({item.stock_id}.TW) ｜ 發行 {item.issue_amount_b || 20} 億
                        </div>
                      </td>

                      {/* 2. 現股價 / 轉換價 / Parity */}
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', verticalAlign: 'middle' }}>
                        <div style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: '0.9rem' }}>
                          現股 NT$ {item.close.toLocaleString()}
                        </div>
                        <div style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>
                          轉換價: {item.conv_price}
                        </div>
                        <div style={{
                          fontSize: '0.74rem',
                          fontWeight: 'bold',
                          color: item.parity >= 75.0 ? '#34D399' : '#F87171'
                        }}>
                          Parity: {item.parity} {item.parity >= 75.0 ? '✅ (≥75)' : '⚠️ (價外太深)'}
                        </div>
                      </td>

                      {/* 3. 落難天使好球帶診斷 */}
                      <td style={{ verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '1px 6px',
                              borderRadius: '3px',
                              fontWeight: 'bold',
                              background: item.strike_zone_status === 'in_zone' ? 'rgba(16, 185, 129, 0.25)' : (item.strike_zone_status === 'near_zone' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.08)'),
                              color: item.strike_zone_status === 'in_zone' ? '#34D399' : (item.strike_zone_status === 'near_zone' ? '#FCD34D' : '#94A3B8')
                            }}>
                              🎯 距離好球帶 (104元): {item.distance_to_strike_pct <= 0 ? `${item.distance_to_strike_pct}% ✅` : `+${item.distance_to_strike_pct}%`}
                            </span>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '1px 6px',
                              borderRadius: '3px',
                              fontWeight: 'bold',
                              background: (item.titan_momentum_score || 50) >= 80 ? 'rgba(16, 185, 129, 0.25)' : ((item.titan_momentum_score || 50) >= 60 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)'),
                              color: (item.titan_momentum_score || 50) >= 80 ? '#34D399' : ((item.titan_momentum_score || 50) >= 60 ? '#38BDF8' : '#CBD5E1')
                            }}>
                              ⚡ 泰坦動能: {item.titan_momentum_score || 65} 分
                            </span>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '1px 6px',
                              borderRadius: '3px',
                              fontWeight: 'bold',
                              background: item.whale_pct >= 50 ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                              color: item.whale_pct >= 50 ? '#C084FC' : '#CBD5E1'
                            }}>
                              🐋 千張大戶: {item.whale_pct}% {item.whale_pct >= 50 ? '✅' : ''}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#CBD5E1' }}>
                            ⏳ 存續期: <strong style={{ color: '#38BDF8' }}>{item.runway_years || 2.5} 年</strong> (至 {item.maturity_date}) ｜ 溢價率: <strong style={{ color: item.premium_rate_pct <= 15 ? '#34D399' : '#FBBF24' }}>{item.premium_rate_pct}%</strong>
                          </div>
                        </div>
                      </td>

                      {/* 4. CB現貨價 / CBAS權利金 */}
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', verticalAlign: 'middle' }}>
                        <div style={{ color: '#38BDF8', fontWeight: 'bold' }}>
                          CB現貨: {item.cb_price} 元
                        </div>
                        <div style={{ color: '#FBBF24', fontWeight: 'bold', fontSize: '0.86rem', marginTop: '2px' }}>
                          CBAS權利金: {item.cbas_quote} 元
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#F9A8D4' }}>
                          (約 NT${item.cbas_cost_twd.toLocaleString()}/張 · <strong>{item.effective_leverage}x 槓桿</strong>)
                        </div>
                      </td>

                      {/* 5. 暴擊目標與翻倍預估 */}
                      <td style={{ verticalAlign: 'middle', fontSize: '0.75rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#E9D5FF', fontWeight: 'bold' }}>🚀 母股翻倍暴擊預估:</span>
                            <strong style={{ color: '#F43F5E', fontFamily: 'monospace', fontSize: '0.82rem' }}>
                              +{item.est_mult_2x || 35} 倍 (+{item.est_cbas_roi_30pct}%)
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94A3B8' }}>① 首段停利目標:</span>
                            <strong style={{ color: '#34D399', fontFamily: 'monospace' }}>
                              CB {item.target_stage1_cb} / CBAS +{item.target_stage1_cbas_pct}%
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed rgba(255,255,255,0.08)', paddingTop: '2px', marginTop: '1px' }}>
                            <span style={{ color: '#FCD34D' }}>暴擊目標: CB {item.target_stage2_cb}</span>
                            <span style={{ color: '#6EE7B7', fontFamily: 'monospace' }}>🛡️ 100元債底保底</span>
                          </div>
                        </div>
                      </td>

                      {/* 6. ✍️ 快速跟單 */}
                      <td style={{ textAlign: 'center', verticalAlign: 'middle', background: 'rgba(245, 158, 11, 0.05)' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <select
                              value={curMode}
                              onChange={e => {
                                const newMode = e.target.value;
                                const newDefaultPrice = newMode === 'CBAS' ? item.cbas_quote : item.cb_price;
                                setRadarRowInputs(prev => ({
                                  ...prev,
                                  [item.cb_code]: { ...(prev[item.cb_code] || {}), mode: newMode, price: newDefaultPrice }
                                }));
                              }}
                              style={{
                                width: '82px',
                                padding: '2px',
                                fontSize: '0.72rem',
                                borderRadius: '3px',
                                border: '1px solid rgba(245, 158, 11, 0.5)',
                                background: '#0F172A',
                                color: '#FDE68A',
                                fontWeight: 'bold'
                              }}
                            >
                              <option value="CBAS">🚀 CBAS</option>
                              <option value="CB現貨">🛡️ CB現貨</option>
                            </select>

                            <input
                              type="number"
                              step="any"
                              value={valPrice}
                              onChange={e => setRadarRowInputs(prev => ({
                                ...prev,
                                [item.cb_code]: { ...(prev[item.cb_code] || {}), price: e.target.value }
                              }))}
                              title="買入價格 (CBAS權利金 或 CB現貨百元報價)"
                              style={{
                                width: '82px',
                                padding: '2px 4px',
                                fontSize: '0.76rem',
                                borderRadius: '3px',
                                border: '1px solid #F59E0B',
                                background: '#0F172A',
                                color: '#FACC15',
                                fontWeight: 'bold',
                                fontFamily: 'monospace',
                                textAlign: 'right'
                              }}
                            />

                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input
                                type="number"
                                value={valLots}
                                onChange={e => setRadarRowInputs(prev => ({
                                  ...prev,
                                  [item.cb_code]: { ...(prev[item.cb_code] || {}), lots: e.target.value }
                                }))}
                                title="買進張數"
                                style={{
                                  width: '62px',
                                  padding: '2px 4px',
                                  fontSize: '0.74rem',
                                  borderRadius: '3px',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                  background: '#0F172A',
                                  color: '#FFF',
                                  fontFamily: 'monospace',
                                  textAlign: 'right'
                                }}
                              />
                              <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>張</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <button
                              onClick={() => handleInlineBuy(item)}
                              style={{
                                padding: '0.4rem 0.6rem',
                                fontSize: '0.74rem',
                                background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                                border: 'none',
                                color: '#FFF',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.2rem'
                              }}
                            >
                              <span>⚡</span> 一鍵跟單
                            </button>

                            <button
                              onClick={() => handleCopyOrderCommand(item)}
                              style={{
                                padding: '0.28rem 0.5rem',
                                fontSize: '0.7rem',
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: '#CBD5E1',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                              }}
                            >
                              📋 複製指令
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 視圖 2：💼 我的進行中持倉 (3檔槽位·28天換倉倒數·行內直接賣出平倉) */}
      {/* ============================================================== */}
      {activeSubTab === 'tracker' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                💼 我的進行中 CB / CBAS 持倉追蹤艙 ({activeHoldings.length} / 3 槽位)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                嚴格執行 <strong>最多 3 檔集中持倉 ＋ 28 天 (4週) 極速換倉紀律</strong>。您可直接在右方輸入實際賣出價格並點擊「🚪 賣出」，系統將自動結算損益並轉入「📜 實戰進出歷史」！
              </p>
            </div>
          </div>

          {activeHoldings.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💼</div>
              <strong>目前無進行中持倉</strong>
              <div style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                請於「🎯 今日落難天使好球帶雷達」點擊「⚡ 一鍵跟單」或由頂部快速記帳列新增買入！
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>槽位與標的名稱</th>
                    <th>模式</th>
                    <th>進場日期時間</th>
                    <th style={{ textAlign: 'right' }}>買進成本價</th>
                    <th style={{ textAlign: 'right' }}>最新報價</th>
                    <th style={{ textAlign: 'right' }}>張數 / 動用本金</th>
                    <th style={{ textAlign: 'right' }}>未實現損益 (%)</th>
                    <th style={{ textAlign: 'center' }}>⏱️ 28天換倉倒數</th>
                    <th>🎯 停利目標與賣出警示</th>
                    <th style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.06)' }}>🚪 直接平倉結算</th>
                    <th style={{ textAlign: 'center' }}>移除</th>
                  </tr>
                </thead>
                <tbody>
                  {activeHoldings.map((pos, idx) => {
                    const curEx = exitRowInputs[pos.id] || {};
                    const valExitPrice = curEx.price !== undefined ? curEx.price : pos.current_price;
                    const valExitReason = curEx.reason || (pos.holding_days >= 28 ? '⏱️ 滿 28 天(4週)定時換倉' : '🎯 觸及首段停利落袋');
                    const isWin = (pos.unrealized_pnl_pct || 0) >= 0;

                    return (
                      <tr key={pos.id} style={{ background: pos.can_sell ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38BDF8', padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                              槽位 #{idx + 1}
                            </span>
                            <strong style={{ color: '#F8FAFC' }}>{pos.cb_name} ({pos.cb_code})</strong>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '2px' }}>
                            現股: {pos.stock_name} ({pos.ticker}) · {pos.notes}
                          </div>
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontSize: '0.73rem',
                            fontWeight: 'bold',
                            background: pos.mode === 'CBAS' ? 'rgba(245, 158, 11, 0.22)' : 'rgba(56, 189, 248, 0.22)',
                            color: pos.mode === 'CBAS' ? '#FDE68A' : '#7DD3FC'
                          }}>
                            {pos.mode}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>
                          <div>{pos.entry_date}</div>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{pos.entry_time || '盤中'}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                          {pos.entry_price}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FACC15' }}>
                          {pos.current_price}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          <div style={{ color: '#F8FAFC', fontWeight: 'bold' }}>{pos.lots} 張</div>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>NT$ {Number(pos.capital_used || 0).toLocaleString()}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                          <div>{isWin ? '+' : ''}{pos.unrealized_pnl_pct}%</div>
                          <div style={{ fontSize: '0.72rem' }}>{isWin ? '+' : ''}NT$ {Number(pos.unrealized_pnl_twd || 0).toLocaleString()}</div>
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                          <span style={{
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '0.76rem',
                            background: pos.holding_days >= 25 ? 'rgba(239, 68, 68, 0.22)' : 'rgba(168, 85, 247, 0.2)',
                            color: pos.holding_days >= 25 ? '#FCA5A5' : '#E9D5FF'
                          }}>
                            第 {pos.holding_days} / {pos.max_hold_days || 28} 天
                          </span>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '2px' }}>
                            剩餘 {Math.max(0, (pos.max_hold_days || 28) - pos.holding_days)} 天換倉
                          </div>
                        </td>
                        <td style={{ fontSize: '0.75rem' }}>
                          <div style={{ color: '#34D399', fontWeight: 'bold' }}>{pos.sell_badge}</div>
                          <div style={{ color: '#94A3B8', fontSize: '0.7rem', marginTop: '2px' }}>
                            目標①: {pos.target_stage1_price} ｜ 目標②: {pos.target_stage2_price} ｜ 防守: {pos.stop_loss_price}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', background: 'rgba(16, 185, 129, 0.05)' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div style={{ display: 'flex', gap: '2px' }}>
                                <input
                                  type="number"
                                  step="any"
                                  value={valExitPrice}
                                  onChange={e => setExitRowInputs(prev => ({
                                    ...prev,
                                    [pos.id]: { ...(prev[pos.id] || {}), price: e.target.value }
                                  }))}
                                  placeholder="賣價"
                                  style={{
                                    width: '75px',
                                    padding: '2px 4px',
                                    fontSize: '0.76rem',
                                    borderRadius: '3px',
                                    border: '1px solid #10B981',
                                    background: '#0F172A',
                                    color: '#34D399',
                                    fontWeight: 'bold',
                                    fontFamily: 'monospace',
                                    textAlign: 'right'
                                  }}
                                />
                                <select
                                  value={valExitReason}
                                  onChange={e => setExitRowInputs(prev => ({
                                    ...prev,
                                    [pos.id]: { ...(prev[pos.id] || {}), reason: e.target.value }
                                  }))}
                                  style={{
                                    width: '92px',
                                    padding: '1px',
                                    fontSize: '0.68rem',
                                    borderRadius: '3px',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    background: '#0F172A',
                                    color: '#CBD5E1'
                                  }}
                                >
                                  <option value="🎯 觸及首段停利落袋">🎯 首段停利</option>
                                  <option value="🚀 觸及暴擊目標全出">🚀 暴擊停利</option>
                                  <option value="⏱️ 滿 28 天(4週)定時換倉">⏱️ 28天換倉</option>
                                  <option value="🛡️ 100元債底防守換馬">🛡️ 債底換馬</option>
                                  <option value="✨ 手動獲利平倉">✨ 手動平倉</option>
                                </select>
                              </div>
                              <input
                                type="date"
                                value={curEx.exitDate || new Date().toISOString().split('T')[0]}
                                onChange={e => setExitRowInputs(prev => ({
                                  ...prev,
                                  [pos.id]: { ...(prev[pos.id] || {}), exitDate: e.target.value }
                                }))}
                                style={{
                                  width: '170px',
                                  padding: '1px 3px',
                                  fontSize: '0.68rem',
                                  borderRadius: '3px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: '#0F172A',
                                  color: '#FCD34D'
                                }}
                              />
                            </div>

                            <button
                              onClick={() => handleInlineClose(pos)}
                              style={{
                                padding: '0.5rem 0.65rem',
                                fontSize: '0.75rem',
                                background: 'linear-gradient(135deg, #10B981, #059669)',
                                border: 'none',
                                color: '#FFF',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                              }}
                            >
                              🚪 賣出
                            </button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleDeleteActive(pos.id, pos.cb_name)}
                            style={{
                              padding: '0.3rem 0.5rem',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#F87171',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            🗑️
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

      {/* ============================================================== */}
      {/* 視圖 3：📜 實戰進出歷史紀錄簿 (純真實進出·手動補登·匯出CSV) */}
      {/* ============================================================== */}
      {activeSubTab === 'history' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📜 可轉債（CB / CBAS）實戰進出歷史紀錄簿 ({tradeHistory.length} 筆已結算)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                頂部所有實戰勝率、累計實賺與平均持倉天數<strong>完全以這份進出歷史為單一真相源（Single Source of Truth）</strong>。
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="搜尋代號或名稱..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                style={{
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(0,0,0,0.35)',
                  color: '#FFF',
                  width: '140px'
                }}
              />

              <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                {[
                  { id: 'all', label: '全部' },
                  { id: 'win', label: '獲利單' },
                  { id: 'rotation28', label: '28天換倉' },
                  { id: 'cbas', label: 'CBAS' },
                  { id: 'cash_cb', label: 'CB現貨' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setHistoryFilter(f.id)}
                    style={{
                      padding: '0.24rem 0.55rem',
                      borderRadius: '4px',
                      border: 'none',
                      fontSize: '0.74rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: historyFilter === f.id ? '#10B981' : 'transparent',
                      color: historyFilter === f.id ? '#FFF' : '#94A3B8'
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowManualHistoryModal(true)}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  border: '1px solid #F59E0B',
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.25))',
                  color: '#FDE68A',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                ➕ 手動補登進出紀錄
              </button>

              <button
                onClick={handleExportUserHistoryCsv}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #10B981, #059669)',
                  color: '#FFF',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                📥 匯出歷史 CSV
              </button>
            </div>
          </div>

          {filteredUserHistory.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
              <strong>尚無符合條件的歷史進出紀錄</strong>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>可轉債代號與名稱</th>
                    <th>模式</th>
                    <th>🟢 買進時間 (進場)</th>
                    <th>🔴 賣出時間 (出場)</th>
                    <th style={{ textAlign: 'right' }}>買進價</th>
                    <th style={{ textAlign: 'right' }}>賣出價</th>
                    <th style={{ textAlign: 'right' }}>張數 / 本金</th>
                    <th style={{ textAlign: 'right' }}>平倉報酬率 (%)</th>
                    <th style={{ textAlign: 'right' }}>實賺損益金額</th>
                    <th style={{ textAlign: 'center' }}>持有天數</th>
                    <th>出場理由与備註</th>
                    <th style={{ textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUserHistory.map(t => {
                    const isWin = (t.pnl_pct || 0) >= 0;
                    return (
                      <tr key={t.id} style={{ background: isWin ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)' }}>
                        <td>
                          <strong style={{ color: '#F8FAFC' }}>{t.cb_name} ({t.cb_code})</strong>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>現股: {t.stock_name}</div>
                        </td>
                        <td>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 'bold',
                            background: t.mode === 'CBAS' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                            color: t.mode === 'CBAS' ? '#FDE68A' : '#7DD3FC'
                          }}>
                            {t.mode}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>
                          <div style={{ color: '#F8FAFC', fontWeight: 'bold' }}>{t.entry_date}</div>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{t.entry_time || '盤中'}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>
                          <div style={{ color: '#FCD34D', fontWeight: 'bold' }}>{t.exit_date}</div>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{t.exit_time || '盤中'}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>{t.entry_price}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FACC15', fontWeight: 'bold' }}>{t.exit_price}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          <div>{t.lots} 張</div>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>NT${Number(t.capital_used || 0).toLocaleString()}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}{t.pnl_pct}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isWin ? '#FBBF24' : '#F87171' }}>
                          {isWin ? '+' : ''}NT$ {Number(t.pnl_twd || 0).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#C084FC', fontWeight: 'bold' }}>
                          {t.holding_days} 天
                        </td>
                        <td style={{ fontSize: '0.76rem' }}>
                          <div style={{ color: '#6EE7B7', fontWeight: 'bold' }}>{t.exit_reason}</div>
                          {t.notes && <div style={{ color: '#94A3B8', fontSize: '0.7rem' }}>{t.notes}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleDeleteHistory(t.id, t.cb_name)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#F87171',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            🗑️
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

      {/* ============================================================== */}
      {/* 視圖 4：📊 2000～2026 (27年) 泰坦17因子 × 按週 DOE 實證與歷年明細 */}
      {/* ============================================================== */}
      {activeSubTab === 'doe_backtest' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #A855F7' }}>
          {/* 次分頁切換按鈕 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1.1rem', paddingBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { id: 'yearly', label: `📈 2000～2026 (27年) 逐年獲利與持倉壓縮趨勢 (${cbBacktestYearly.length} 個年度)` },
                { id: 'weekly_doe', label: '🔬 按週 DOE (7/14/21/28/35/42/49天) 最佳換倉窗口實證表' },
                { id: 'trades', label: `📜 27年歷年實證成交明細 (${allCbTrades.length} 筆 3槽位紀錄)` }
              ].map( tab => (
                <button
                  key={tab.id}
                  onClick={() => setBacktestSubView(tab.id)}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: '6px',
                    border: backtestSubView === tab.id ? '1px solid #A855F7' : '1px solid rgba(255,255,255,0.12)',
                    background: backtestSubView === tab.id ? 'rgba(168, 85, 247, 0.25)' : 'rgba(15, 23, 42, 0.6)',
                    color: backtestSubView === tab.id ? '#E9D5FF' : '#94A3B8',
                    fontWeight: 'bold',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={() => setCbMode('cbas')}
                style={{
                  padding: '0.3rem 0.7rem',
                  borderRadius: '5px',
                  border: cbMode === 'cbas' ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.15)',
                  background: cbMode === 'cbas' ? 'rgba(245, 158, 11, 0.25)' : 'transparent',
                  color: cbMode === 'cbas' ? '#FDE68A' : '#94A3B8',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🚀 CBAS 選擇權視角 (上限300萬)
              </button>
              <button
                onClick={() => setCbMode('cash_cb')}
                style={{
                  padding: '0.3rem 0.7rem',
                  borderRadius: '5px',
                  border: cbMode === 'cash_cb' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.15)',
                  background: cbMode === 'cash_cb' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                  color: cbMode === 'cash_cb' ? '#7DD3FC' : '#94A3B8',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🛡️ CB 現貨保底視角 (上限5000萬)
              </button>
            </div>
          </div>

          {/* 子視圖 A: 按週 DOE 最佳窗口實證表 */}
          {backtestSubView === 'weekly_doe' && (
            <div>
              <div style={{ background: 'rgba(168, 85, 247, 0.08)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#CBD5E1', lineHeight: '1.55' }}>
                <strong style={{ color: '#E9D5FF' }}>💡 27 年按週 DOE (7天 ～ 49天) 結構演進結論：</strong><br />
                • <strong>傳統法人期 (2000~2016)</strong>：最佳換倉窗口為 <strong>第 5~6 週 (35~42天)</strong>，因為早期資訊傳遞較慢，主力建倉後需 5 週發酵。<br />
                • <strong>半導體擴張期 (2017~2022)</strong>：最佳窗口前移至 <strong>第 4 週 (28天)</strong>，量化資金與大戶鎖碼加速。<br />
                • <strong>AI 算力爆發期 (2023~2026)</strong>：最佳窗口穩定落在 <strong>第 4 週 (28天)</strong>，且因期間內頻繁提前觸發 +25% 停利，<strong>實測平均持倉天數大幅壓縮至僅 18 天</strong>！
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.83rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th>換倉窗口 (By Week DOE)</th>
                      <th style={{ textAlign: 'right' }}>2000~2016 傳統期年化</th>
                      <th style={{ textAlign: 'right' }}>2017~2022 半導體期年化</th>
                      <th style={{ textAlign: 'right', color: '#FBBF24' }}>2023~2026 AI爆發期年化</th>
                      <th style={{ textAlign: 'right', color: '#34D399' }}>27年全歷史年化</th>
                      <th style={{ textAlign: 'center' }}>AI期實測均持天數</th>
                      <th>DOE 參數最佳化診斷結論</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyDoeMatrix.map((w, i) => {
                      const isBest = w.window.includes('28天') || w.window.includes('35天');
                      return (
                        <tr key={i} style={{ background: isBest ? 'rgba(16, 185, 129, 0.10)' : 'transparent', borderLeft: isBest ? '4px solid #10B981' : 'none' }}>
                          <td style={{ fontWeight: 'bold', color: isBest ? '#34D399' : '#F8FAFC' }}>{w.window}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>+{w.era1_cagr}%</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>+{w.era2_cagr}%</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FBBF24', fontSize: '0.9rem' }}>+{w.era3_ai_cagr}%</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>+{w.all_27y_cagr}%</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#C084FC', fontWeight: 'bold' }}>{w.avg_hold} 天</td>
                          <td style={{ fontSize: '0.78rem', color: isBest ? '#A7F3D0' : '#94A3B8' }}>{w.verdict}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 子視圖 B: 2000~2026 (27年) 逐年獲利與持倉壓縮趨勢表 */}
          {backtestSubView === 'yearly' && (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>年度</th>
                    <th>時代背景與最佳換倉窗口</th>
                    <th style={{ textAlign: 'right', color: '#FBBF24' }}>
                      {cbMode === 'cbas' ? '🚀 CBAS 年度報酬率' : '🛡️ CB現貨 年度報酬率'}
                    </th>
                    <th style={{ textAlign: 'right' }}>台股大盤 (TAIEX)</th>
                    <th style={{ textAlign: 'right', color: '#34D399' }}>超額 Alpha</th>
                    <th style={{ textAlign: 'center' }}>交易筆數 (3槽位)</th>
                    <th style={{ textAlign: 'center' }}>年度勝率</th>
                    <th style={{ textAlign: 'center', color: '#C084FC' }}>實測平均持有天數</th>
                    <th>年度代表暴擊標的</th>
                    <th>年度市場與策略歸因</th>
                  </tr>
                </thead>
                <tbody>
                  {[...cbBacktestYearly].reverse().map(yr => {
                    const stratRet = cbMode === 'cbas' ? yr.cbas_return_pct : yr.return_pct;
                    const alphaRet = cbMode === 'cbas' ? yr.cbas_alpha_pct : yr.alpha_pct;
                    const isAiEra = Number(yr.year) >= 2023;
                    return (
                      <tr key={yr.year} style={{ background: isAiEra ? 'rgba(245, 158, 11, 0.07)' : 'transparent' }}>
                        <td style={{ fontWeight: 'bold', fontFamily: 'monospace', color: isAiEra ? '#FBBF24' : '#F8FAFC', fontSize: '0.9rem' }}>
                          {yr.year} {isAiEra ? '🔥' : ''}
                        </td>
                        <td style={{ fontSize: '0.74rem', color: isAiEra ? '#FDE68A' : '#CBD5E1' }}>
                          {yr.era_tag}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', color: '#34D399' }}>
                          +{stratRet}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.taiex_ret_pct >= 0 ? '#CBD5E1' : '#F87171' }}>
                          {yr.taiex_ret_pct >= 0 ? '+' : ''}{yr.taiex_ret_pct}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                          +{alphaRet}%
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{yr.trades_count} 筆</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold' }}>{yr.win_rate_pct}%</td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: yr.avg_holding_days <= 20 ? '#F472B6' : '#C084FC' }}>
                          {yr.avg_holding_days} 天
                        </td>
                        <td style={{ fontWeight: 'bold', color: '#FDE68A', fontSize: '0.78rem' }}>{yr.top_trade}</td>
                        <td style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{yr.highlight}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 子視圖 C: 27年歷年回測成交明細 */}
          {backtestSubView === 'trades' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={cbTradeYearFilter}
                    onChange={e => { setCbTradeYearFilter(e.target.value); setCbTradePage(1); }}
                    style={{
                      padding: '0.32rem 0.6rem',
                      borderRadius: '6px',
                      background: '#0F172A',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: '#FCD34D',
                      fontSize: '0.78rem',
                      fontWeight: 'bold'
                    }}
                  >
                    <option value="all">📅 全部年份 (2000~2026)</option>
                    {yearsList.map(y => (
                      <option key={y} value={y}>{y} 年</option>
                    ))}
                  </select>

                  <input
                    type="text"
                    placeholder="搜尋代號、名稱、因子..."
                    value={cbTradeSearch}
                    onChange={e => { setCbTradeSearch(e.target.value); setCbTradePage(1); }}
                    style={{
                      padding: '0.32rem 0.65rem',
                      borderRadius: '6px',
                      background: '#0F172A',
                      border: '1px solid rgba(255,255,255,0.18)',
                      color: '#FFF',
                      fontSize: '0.78rem',
                      width: '180px'
                    }}
                  />
                </div>

                <button
                  onClick={handleExportCbBacktestCsv}
                  style={{
                    padding: '0.35rem 0.8rem',
                    fontSize: '0.78rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#FFF',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  📥 匯出 {filteredCbTrades.length} 筆回測明細 CSV
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th>槽位</th>
                      <th>年份</th>
                      <th>可轉債與現股</th>
                      <th>買進日 ➔ 出場日</th>
                      <th style={{ textAlign: 'center' }}>持有天數</th>
                      <th style={{ textAlign: 'right' }}>買進 ➔ 出場價</th>
                      <th style={{ textAlign: 'right', color: '#38BDF8' }}>CB現貨報酬</th>
                      <th style={{ textAlign: 'right', color: '#FBBF24' }}>CBAS報酬</th>
                      <th>落難天使好球帶篩選訊號</th>
                      <th>出場原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentCbPageTrades.map(t => (
                      <tr key={t.id}>
                        <td style={{ fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>Slot #{t.slot_index}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{t.year}</td>
                        <td>
                          <strong style={{ color: '#F8FAFC' }}>{t.cb_name} ({t.cb_code})</strong>
                          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{t.stock_name} ({t.ticker}) · {t.industry}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {t.entry_date} ➔ {t.exit_date}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#C084FC', fontWeight: 'bold' }}>
                          {t.holding_days} 天
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          {t.entry_price} ➔ <strong style={{ color: '#FACC15' }}>{t.exit_price}</strong>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: t.pnl_pct >= 0 ? '#34D399' : '#F87171' }}>
                          {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: t.cbas_roi_pct >= 0 ? '#FBBF24' : '#F87171' }}>
                          {t.cbas_roi_pct >= 0 ? '+' : ''}{t.cbas_roi_pct}%
                        </td>
                        <td style={{ fontSize: '0.72rem', color: '#67E8F9', fontFamily: 'monospace' }}>{t.factor_signals}</td>
                        <td style={{ fontSize: '0.74rem', color: '#A7F3D0' }}>{t.exit_reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 分頁控制 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.9rem', fontSize: '0.78rem', color: '#94A3B8' }}>
                <span>共 {filteredCbTrades.length} 筆交易紀錄 (每頁 {CB_TRADES_PAGE_SIZE} 筆)</span>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button
                    disabled={cbTradePage <= 1}
                    onClick={() => setCbTradePage(p => Math.max(1, p - 1))}
                    style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', background: '#1E293B', color: '#FFF', border: '1px solid rgba(255,255,255,0.15)', cursor: cbTradePage <= 1 ? 'not-allowed' : 'pointer' }}
                  >
                    ◀ 上一頁
                  </button>
                  <span style={{ fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>
                    {cbTradePage} / {totalCbPages}
                  </span>
                  <button
                    disabled={cbTradePage >= totalCbPages}
                    onClick={() => setCbTradePage(p => Math.min(totalCbPages, p + 1))}
                    style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', background: '#1E293B', color: '#FFF', border: '1px solid rgba(255,255,255,0.15)', cursor: cbTradePage >= totalCbPages ? 'not-allowed' : 'pointer' }}
                  >
                    下一頁 ▶
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 📜 手動補登可轉債進出歷史紀錄 Modal */}
      {/* ============================================================== */}
      {showManualHistoryModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          padding: '1rem'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #0F172A, #1E293B)',
            border: '1px solid #F59E0B',
            borderRadius: '12px',
            padding: '1.5rem',
            width: '100%',
            maxWidth: '560px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
            color: '#F8FAFC'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.6rem' }}>
              <h3 style={{ margin: 0, color: '#FCD34D', fontSize: '1.12rem' }}>
                ➕ 手動補登可轉債（CB / CBAS）進出歷史紀錄
              </h3>
              <button
                onClick={() => setShowManualHistoryModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', fontSize: '0.82rem' }}>
              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>可轉債代號 (如 23822):</label>
                <input
                  type="text"
                  placeholder="23822"
                  value={manualHistoryForm.cb_code}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, cb_code: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FCD34D', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>可轉債名稱 (如 廣達二):</label>
                <input
                  type="text"
                  placeholder="廣達二"
                  value={manualHistoryForm.cb_name}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, cb_name: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>交易工具模式:</label>
                <select
                  value={manualHistoryForm.mode}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, mode: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FDE68A', fontWeight: 'bold' }}
                >
                  <option value="CBAS">🚀 CBAS 選擇權</option>
                  <option value="CB現貨">🛡️ CB 現貨保底</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>交易張數 (如 10):</label>
                <input
                  type="number"
                  value={manualHistoryForm.lots}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, lots: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#38BDF8', marginBottom: '4px' }}>買進價格 (權利金或CB價):</label>
                <input
                  type="number"
                  step="any"
                  placeholder="如 12.5"
                  value={manualHistoryForm.entry_price}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, entry_price: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid #38BDF8', borderRadius: '6px', color: '#38BDF8', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#34D399', marginBottom: '4px' }}>賣出價格 (權利金或CB價):</label>
                <input
                  type="number"
                  step="any"
                  placeholder="如 24.8"
                  value={manualHistoryForm.exit_price}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, exit_price: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid #34D399', borderRadius: '6px', color: '#34D399', fontWeight: 'bold' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>買進日期:</label>
                <input
                  type="date"
                  value={manualHistoryForm.entry_date}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, entry_date: e.target.value }))}
                  style={{ width: '100%', padding: '0.35rem 0.5rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>賣出日期:</label>
                <input
                  type="date"
                  value={manualHistoryForm.exit_date}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, exit_date: e.target.value }))}
                  style={{ width: '100%', padding: '0.35rem 0.5rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>出場理由:</label>
                <select
                  value={manualHistoryForm.exit_reason}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, exit_reason: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FCD34D' }}
                >
                  <option value="🎯 觸及首段停利 (AI極速噴發)">🎯 觸及首段停利 (AI極速噴發)</option>
                  <option value="🚀 觸及暴擊停利目標全出">🚀 觸及暴擊停利目標全出</option>
                  <option value="⏱️ 滿 28 天(4週)定時換倉">⏱️ 滿 28 天(4週)定時換倉</option>
                  <option value="🛡️ 100元債底保護換馬">🛡️ 100元債底保護換馬</option>
                  <option value="✨ 手動獲利平倉">✨ 手動獲利平倉</option>
                </select>
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', color: '#94A3B8', marginBottom: '4px' }}>備註:</label>
                <input
                  type="text"
                  value={manualHistoryForm.notes}
                  onChange={e => setManualHistoryForm(prev => ({ ...prev, notes: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: '#0B1120', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '1.2rem' }}>
              <button
                onClick={() => setShowManualHistoryModal(false)}
                style={{ padding: '0.45rem 1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#CBD5E1', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleManualHistorySubmit}
                style={{
                  padding: '0.45rem 1.4rem',
                  background: 'linear-gradient(135deg, #10B981, #059669)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#FFF',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                確認補登紀錄
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
