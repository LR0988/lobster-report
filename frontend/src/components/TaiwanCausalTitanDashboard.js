import React, { useState, useEffect, useMemo, useRef } from 'react';
import defaultTitanData from '../data/taiwan_causal_titan_data.json';
import { getCurrentUser } from '../api';

// ==========================================
// 👑 台股因果量化泰坦旗艦版 (DOE 黃金階梯 35/25/20/10/10)
// 完全復刻全球主權泰坦互動操作架構
// 包含帳戶資產總覽、調倉更動建議試算、實盤部位增刪修與出場、流水帳記帳與備份
// ==========================================

const getTaiwanTitanStorageKeys = (username) => ({
  positions: `tw_causal_titan_user_positions_v2_${username}`,
  idleCash: `tw_causal_titan_idle_cash_v2_${username}`,
  allTx: `tw_causal_titan_all_tx_v2_${username}`,
  dismissedSugg: `tw_causal_titan_dismissed_sugg_v2_${username}`
});

// 預設 5 檔初始部位 (依 100 萬投資本金，2026-10-12 法定公告日建倉，DOE 黃金階梯 35/25/20/10/10 配置)
const DEFAULT_POSITIONS = [
  {
    id: 'pos_3105',
    stock_id: '3105',
    ticker: '3105.TW',
    stock_name: '穩懋',
    name: '穩懋 (PA 功率放大器 / 5G射頻王者)',
    industry: 'PA 功率放大器 / 5G射頻王者',
    role: '👑 王者先鋒 (35%)',
    target_weight_pct: 35.0,
    shares: 736, // 約 0 張 + 736 股
    entry_price: 475.0,
    current_price: 475.0,
    entry_date: '2026-10-12',
    price_date: '2026-10-20',
    entry_fee: 498,
    stop_loss_price: 460.93,
    stop_condition: '逐日監控：跌破 60MA 季線 (460.9元) 則動態出場停泊現金',
    highlight: '砷化鎵龍頭，因果吸籌大單破季線突破'
  },
  {
    id: 'pos_8358',
    stock_id: '8358',
    ticker: '8358.TW',
    stock_name: '金居',
    name: '金居 (高頻高速銅箔龍頭)',
    industry: '高頻高速銅箔龍頭',
    role: '🚀 核心主力 (25%)',
    target_weight_pct: 25.0,
    shares: 532, // 約 0 張 + 532 股
    entry_price: 469.5,
    current_price: 469.5,
    entry_date: '2026-10-12',
    price_date: '2026-10-20',
    entry_fee: 356,
    stop_loss_price: 458.93,
    stop_condition: '逐日監控：跌破 60MA 季線 (458.9元) 則動態出場停泊現金',
    highlight: 'AI伺服器PCB高頻銅箔主升段爆發'
  },
  {
    id: 'pos_3324',
    stock_id: '3324',
    ticker: '3324.TW',
    stock_name: '雙鴻',
    name: '雙鴻 (AI 水冷散熱伺服器龍頭)',
    industry: 'AI 水冷散熱伺服器龍頭',
    role: '⚡ 動能旗艦 (20%)',
    target_weight_pct: 20.0,
    shares: 143, // 約 0 張 + 143 股
    entry_price: 1395.0,
    current_price: 1395.0,
    entry_date: '2026-10-12',
    price_date: '2026-10-20',
    entry_fee: 284,
    stop_loss_price: 1220.22,
    stop_condition: '逐日監控：跌破 60MA 季線 (1220.2元) 則動態出場停泊現金',
    highlight: 'GB200水冷板主動吸收站穩VWAP'
  },
  {
    id: 'pos_1303',
    stock_id: '1303',
    ticker: '1303.TW',
    stock_name: '南亞',
    name: '南亞 (電子材料 / 環氧樹脂)',
    industry: '電子材料 / 環氧樹脂',
    role: '🛡️ 結構支柱 (10%)',
    target_weight_pct: 10.0,
    shares: 337, // 約 0 張 + 337 股
    entry_price: 296.0,
    current_price: 296.0,
    entry_date: '2026-10-12',
    price_date: '2026-10-20',
    entry_fee: 142,
    stop_loss_price: 227.11,
    stop_condition: '逐日監控：跌破 60MA 季線 (227.1元) 則動態出場停泊現金',
    highlight: 'CCL玻纖布原物料反轉向上潛伏防守'
  },
  {
    id: 'pos_3026',
    stock_id: '3026',
    ticker: '3026.TW',
    stock_name: '禾伸堂',
    name: '禾伸堂 (MLCC 被動元件 / 車用陶瓷)',
    industry: 'MLCC 被動元件 / 車用陶瓷',
    role: '🎯 爆發突破 (10%)',
    target_weight_pct: 10.0,
    shares: 125, // 約 0 張 + 125 股
    entry_price: 794.0,
    current_price: 794.0,
    entry_date: '2026-10-12',
    price_date: '2026-10-20',
    entry_fee: 141,
    stop_loss_price: 703.27,
    stop_condition: '逐日監控：跌破 60MA 季線 (703.3元) 則動態出場停泊現金',
    highlight: '車用被動元件阻力衰減突破'
  }
];

// 預設 5 檔初始建倉流水帳 (依 100 萬本金開倉)
const DEFAULT_TX_HISTORY = [
  {
    id: 'tx_tw_deposit_1',
    date: '2026-10-12',
    action: '投入現金',
    ticker: '-',
    name: '台股因果泰坦初始本金入金',
    shares: 0,
    price: 0,
    tax_fee: 0,
    cash_flow_twd: 1000000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '台股因果泰坦旗艦策略 初始開倉本金 (100萬)'
  },
  {
    id: 'tx_tw_buy_3105',
    date: '2026-10-12',
    action: '買入',
    ticker: '3105.TW',
    stock_id: '3105',
    name: '穩懋 (3105)',
    shares: 736,
    price: 475.0,
    tax_fee: 498,
    cash_flow_twd: -350098,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/12 法定公告日建倉 👑 王者先鋒 (35%)'
  },
  {
    id: 'tx_tw_buy_8358',
    date: '2026-10-12',
    action: '買入',
    ticker: '8358.TW',
    stock_id: '8358',
    name: '金居 (8358)',
    shares: 532,
    price: 469.5,
    tax_fee: 356,
    cash_flow_twd: -250130,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/12 法定公告日建倉 🚀 核心主力 (25%)'
  },
  {
    id: 'tx_tw_buy_3324',
    date: '2026-10-12',
    action: '買入',
    ticker: '3324.TW',
    stock_id: '3324',
    name: '雙鴻 (3324)',
    shares: 143,
    price: 1395.0,
    tax_fee: 284,
    cash_flow_twd: -199769,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/12 法定公告日建倉 ⚡ 動能旗艦 (20%)'
  },
  {
    id: 'tx_tw_buy_1303',
    date: '2026-10-12',
    action: '買入',
    ticker: '1303.TW',
    stock_id: '1303',
    name: '南亞 (1303)',
    shares: 337,
    price: 296.0,
    tax_fee: 142,
    cash_flow_twd: -99894,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/12 法定公告日建倉 🛡️ 結構支柱 (10%)'
  },
  {
    id: 'tx_tw_buy_3026',
    date: '2026-10-12',
    action: '買入',
    ticker: '3026.TW',
    stock_id: '3026',
    name: '禾伸堂 (3026)',
    shares: 125,
    price: 794.0,
    tax_fee: 141,
    cash_flow_twd: -99391,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/12 法定公告日建倉 🎯 爆發突破 (10%)'
  }
];

export default function TaiwanCausalTitanDashboard() {
  const [data] = useState(defaultTitanData);
  const { strategy_info = {}, kpis = {}, curve = [], yearly_stats = [], causal_alphas = [], trades = [] } = data;

  // 使用者身分與本地存儲
  const currentUser = getCurrentUser();
  const currentUsername = currentUser?.username || 'hotpotlu';
  const storageKeys = useMemo(() => getTaiwanTitanStorageKeys(currentUsername), [currentUsername]);

  const [activeTabSub, setActiveTabSub] = useState('portfolio'); // 'portfolio', 'curve', 'yearly', 'alphas', 'trades', 'rules'
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4000);
  };

  // 持股部位狀態 (localStorage 持久化)
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.positions);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return DEFAULT_POSITIONS;
    } catch {
      return DEFAULT_POSITIONS;
    }
  });

  // 歷史交易流水帳 (localStorage 持久化)
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.allTx);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return DEFAULT_TX_HISTORY;
    } catch {
      return DEFAULT_TX_HISTORY;
    }
  });

  // 忽略的更動建議
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.dismissedSugg);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // 自動持久化儲存
  useEffect(() => {
    try {
      localStorage.setItem(storageKeys.positions, JSON.stringify(userPositions));
      localStorage.setItem(storageKeys.allTx, JSON.stringify(txHistory));
      localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(dismissedSuggestions));
    } catch (err) {
      console.warn('無法儲存台股泰坦持倉:', err);
    }
  }, [userPositions, txHistory, dismissedSuggestions, storageKeys]);

  // 閒置現金 (TWD) - 100% 由交易流水帳現金流動態加總推導
  const idleCash = useMemo(() => {
    return txHistory.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
  }, [txHistory]);

  // 累計投入本金 (TWD)
  const totalDepositsTwd = useMemo(() => {
    const sum = txHistory
      .filter(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')))
      .reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
    return sum > 0 ? sum : 1000000;
  }, [txHistory]);

  // 持股市值、成本、未實現損益
  const { totalStockMarketValTwd, totalCostTwd, unrealizedPnlTwd, unrealizedReturnPct } = useMemo(() => {
    let marketVal = 0;
    let cost = 0;
    userPositions.forEach(p => {
      const curPrice = p.current_price || p.entry_price || 0;
      marketVal += (p.shares || 0) * curPrice;
      cost += ((p.shares || 0) * (p.entry_price || 0)) + (p.entry_fee || 0);
    });
    const pnl = marketVal - cost;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    return {
      totalStockMarketValTwd: marketVal,
      totalCostTwd: cost,
      unrealizedPnlTwd: pnl,
      unrealizedReturnPct: pct
    };
  }, [userPositions]);

  // 當前總資產淨值 (閒置現金 + 持股市值)
  const totalNetAssetsTwd = useMemo(() => {
    return Math.max(0, idleCash + totalStockMarketValTwd);
  }, [idleCash, totalStockMarketValTwd]);

  // 帳戶真實總淨利與淨利率
  const totalNetProfitTwd = useMemo(() => {
    return totalNetAssetsTwd - totalDepositsTwd;
  }, [totalNetAssetsTwd, totalDepositsTwd]);

  const totalNetProfitPct = useMemo(() => {
    return totalDepositsTwd > 0 ? (totalNetProfitTwd / totalDepositsTwd) * 100 : 0;
  }, [totalNetProfitTwd, totalDepositsTwd]);

  // 歷史流水帳統計 (已實現損益、勝率、總稅費)
  const { totalRealizedPnlTwd, totalTaxesPaidTwd, closedTradesCount, winningTradesCount, winRate } = useMemo(() => {
    let pnl = 0;
    let taxes = 0;
    let closedCount = 0;
    let winCount = 0;

    txHistory.forEach(tx => {
      if (tx.tax_fee) taxes += Number(tx.tax_fee) || 0;
      if (tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined) {
        const val = Number(tx.realized_pnl_twd) || 0;
        pnl += val;
        closedCount += 1;
        if (val > 0) winCount += 1;
      }
    });

    return {
      totalRealizedPnlTwd: pnl,
      totalTaxesPaidTwd: taxes,
      closedTradesCount: closedCount,
      winningTradesCount: winCount,
      winRate: closedCount > 0 ? (winCount / closedCount) * 100 : 0
    };
  }, [txHistory]);

  // ==========================================
  // 調倉窗口與更動建議試算器 (DOE 35/25/20/10/10)
  // ==========================================
  const targetAllocationConfig = useMemo(() => [
    { stock_id: '3105', name: '穩懋', role: '👑 王者先鋒 (35%)', weight_pct: 35.0, price: 475.0, stop_loss: 460.93, industry: 'PA 功率放大器 / 5G射頻王者' },
    { stock_id: '8358', name: '金居', role: '🚀 核心主力 (25%)', weight_pct: 25.0, price: 469.5, stop_loss: 458.93, industry: '高頻高速銅箔龍頭' },
    { stock_id: '3324', name: '雙鴻', role: '⚡ 動能旗艦 (20%)', weight_pct: 20.0, price: 1395.0, stop_loss: 1220.22, industry: 'AI 水冷散熱伺服器龍頭' },
    { stock_id: '1303', name: '南亞', role: '🛡️ 結構支柱 (10%)', weight_pct: 10.0, price: 296.0, stop_loss: 227.11, industry: '電子材料 / 環氧樹脂' },
    { stock_id: '3026', name: '禾伸堂', role: '🎯 爆發突破 (10%)', weight_pct: 10.0, price: 794.0, stop_loss: 703.27, industry: 'MLCC 被動元件 / 車用陶瓷' }
  ], []);

  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];
    const suggestions = [];
    const tolerancePct = 5.0; // DOE ±5% 容差帶

    // 1. 針對目標 5 大主力進行部位試算
    targetAllocationConfig.forEach(target => {
      const targetTwd = totalNetAssetsTwd * (target.weight_pct / 100.0);
      const targetShares = Math.floor(targetTwd / target.price);
      const heldPos = userPositions.find(p => p.stock_id === target.stock_id || p.ticker?.includes(target.stock_id));
      const heldShares = heldPos ? heldPos.shares : 0;
      const diffShares = targetShares - heldShares;

      const curVal = heldShares * target.price;
      const curWeightPct = totalNetAssetsTwd > 0 ? (curVal / totalNetAssetsTwd) * 100 : 0;
      const weightDiffPct = Math.abs(curWeightPct - target.weight_pct);

      const suggKey = `sugg_tw_${target.stock_id}`;
      if (dismissedSuggestions.includes(suggKey)) return;

      const lots = Math.floor(Math.abs(diffShares) / 1000);
      const oddShares = Math.abs(diffShares) % 1000;
      const sharesDesc = `${Math.abs(diffShares).toLocaleString()} 股 (${lots > 0 ? `${lots} 張 ` : ''}${oddShares > 0 ? `${oddShares} 股` : ''})`;

      if (heldShares === 0 && targetShares > 0) {
        // 全新買入
        const estFee = Math.max(20, Math.round(targetShares * target.price * 0.001425));
        suggestions.push({
          key: suggKey,
          action: '買入',
          actionColor: '#10B981',
          stock_id: target.stock_id,
          name: target.name,
          role: target.role,
          targetWeightPct: target.weight_pct,
          targetTwd,
          currentShares: heldShares,
          targetShares,
          recShares: targetShares,
          sharesDesc,
          price: target.price,
          estTaxFee: estFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos: null
        });
      } else if (heldShares > 0 && weightDiffPct > tolerancePct && diffShares > 0 && Math.abs(diffShares * target.price) > 5000) {
        // 加碼
        const estFee = Math.max(20, Math.round(diffShares * target.price * 0.001425));
        suggestions.push({
          key: suggKey,
          action: '加碼',
          actionColor: '#38BDF8',
          stock_id: target.stock_id,
          name: target.name,
          role: target.role,
          targetWeightPct: target.weight_pct,
          targetTwd,
          currentShares: heldShares,
          targetShares,
          recShares: diffShares,
          sharesDesc,
          price: target.price,
          estTaxFee: estFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos
        });
      } else if (heldShares > 0 && weightDiffPct > tolerancePct && diffShares < 0 && Math.abs(diffShares * target.price) > 5000) {
        // 減持
        const reduceShares = Math.abs(diffShares);
        const estTaxFee = Math.round(reduceShares * target.price * (0.003 + 0.001425));
        suggestions.push({
          key: suggKey,
          action: '減持',
          actionColor: '#F59E0B',
          stock_id: target.stock_id,
          name: target.name,
          role: target.role,
          targetWeightPct: target.weight_pct,
          targetTwd,
          currentShares: heldShares,
          targetShares,
          recShares: reduceShares,
          sharesDesc,
          price: target.price,
          estTaxFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos
        });
      }
    });

    // 2. 針對持倉中但不在目標 5 大主力中的非策略持股提出賣出清倉建議
    userPositions.forEach(heldPos => {
      const isInTarget = targetAllocationConfig.some(t => t.stock_id === heldPos.stock_id || heldPos.ticker?.includes(t.stock_id));
      const suggKey = `sugg_exit_tw_${heldPos.stock_id || heldPos.id}`;
      if (!isInTarget && !dismissedSuggestions.includes(suggKey)) {
        const curPrice = heldPos.current_price || heldPos.entry_price || 0;
        const exitShares = heldPos.shares || 0;
        const estTaxFee = Math.round(exitShares * curPrice * (0.003 + 0.001425));
        const lots = Math.floor(exitShares / 1000);
        const oddShares = exitShares % 1000;
        const sharesDesc = `${exitShares.toLocaleString()} 股 (${lots > 0 ? `${lots} 張 ` : ''}${oddShares > 0 ? `${oddShares} 股` : ''})`;
        suggestions.push({
          key: suggKey,
          action: '賣出',
          actionColor: '#EF4444',
          stock_id: heldPos.stock_id || '-',
          name: heldPos.stock_name || heldPos.name || '非核心標的',
          role: '⚠️ 非目標梯隊',
          targetWeightPct: 0,
          targetTwd: 0,
          currentShares: exitShares,
          targetShares: 0,
          recShares: exitShares,
          sharesDesc,
          price: curPrice,
          estTaxFee,
          stop_loss_price: heldPos.stop_loss_price || 0,
          industry: heldPos.industry || '-',
          heldPos
        });
      }
    });

    return suggestions;
  }, [totalNetAssetsTwd, targetAllocationConfig, userPositions, dismissedSuggestions]);

  // ==========================================
  // 調倉執行與指令複製操作
  // ==========================================
  // 複製單一券商委託下單字串
  const handleCopyOrder = (sugg) => {
    const actionText = sugg.action === '買入' || sugg.action === '加碼' ? '現股買進' : '現股賣出';
    const text = `${sugg.stock_id} ${sugg.name} ${actionText} ${sugg.recShares}股 · 委託價 $${sugg.price}`;
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已複製委託字串：${text}`);
  };

  // 複製全部建議下單字串
  const handleCopyAllOrders = () => {
    if (rebalanceSuggestions.length === 0) return;
    const text = rebalanceSuggestions.map(s => {
      const actionText = s.action === '買入' || s.action === '加碼' ? '現股買進' : '現股賣出';
      return `${s.stock_id} ${s.name} ${actionText} ${s.recShares}股 ($${s.price})`;
    }).join('\n');
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已成功複製 ${rebalanceSuggestions.length} 筆調倉委託指令！`);
  };

  // 一鍵執行單筆調倉建議 (自動連動持股與流水帳)
  const handleExecuteSuggestion = (sugg) => {
    const today = new Date().toISOString().split('T')[0];
    const amount = sugg.recShares * sugg.price;

    if (sugg.action === '買入') {
      const cashFlow = -(amount + sugg.estTaxFee);
      const newPos = {
        id: `pos_${sugg.stock_id}_${Date.now()}`,
        stock_id: sugg.stock_id,
        ticker: `${sugg.stock_id}.TW`,
        stock_name: sugg.name,
        name: `${sugg.name} (${sugg.industry || ''})`,
        industry: sugg.industry || '',
        role: sugg.role,
        target_weight_pct: sugg.targetWeightPct,
        shares: sugg.recShares,
        entry_price: sugg.price,
        current_price: sugg.price,
        entry_date: today,
        price_date: today,
        entry_fee: sugg.estTaxFee,
        stop_loss_price: sugg.stop_loss_price,
        stop_condition: `逐日監控：跌破 60MA 季線 (${sugg.stop_loss_price}元) 則動態出場`,
        highlight: '台股因果泰坦法定公告日調倉'
      };
      const newTx = {
        id: `tx_${Date.now()}`,
        date: today,
        action: '買入',
        ticker: `${sugg.stock_id}.TW`,
        stock_id: sugg.stock_id,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: sugg.recShares,
        price: sugg.price,
        tax_fee: sugg.estTaxFee,
        cash_flow_twd: cashFlow,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `法定調倉買入 ${sugg.role}`
      };
      setUserPositions(prev => [...prev, newPos]);
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`✅ 已執行買進「${sugg.name}」${sugg.recShares}股，寫入流水帳！`);
    } else if (sugg.action === '加碼') {
      const cashFlow = -(amount + sugg.estTaxFee);
      setUserPositions(prev => prev.map(p => {
        if (p.stock_id === sugg.stock_id || p.ticker?.includes(sugg.stock_id)) {
          const newShares = p.shares + sugg.recShares;
          const newAvgPrice = Math.round(((p.shares * p.entry_price) + amount) / newShares * 100) / 100;
          return {
            ...p,
            shares: newShares,
            entry_price: newAvgPrice,
            current_price: sugg.price,
            entry_fee: (p.entry_fee || 0) + sugg.estTaxFee
          };
        }
        return p;
      }));
      const newTx = {
        id: `tx_${Date.now()}`,
        date: today,
        action: '加碼',
        ticker: `${sugg.stock_id}.TW`,
        stock_id: sugg.stock_id,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: sugg.recShares,
        price: sugg.price,
        tax_fee: sugg.estTaxFee,
        cash_flow_twd: cashFlow,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `階梯配比加碼 ${sugg.role}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`✅ 已執行加碼「${sugg.name}」${sugg.recShares}股！`);
    } else if (sugg.action === '減持' || sugg.action === '賣出') {
      const proceeds = amount - sugg.estTaxFee;
      const targetPos = sugg.heldPos;
      const costBasis = targetPos ? targetPos.entry_price * sugg.recShares : amount;
      const netPnl = proceeds - costBasis;
      const pnlPct = costBasis > 0 ? (netPnl / costBasis) * 100 : 0;

      if (sugg.action === '賣出' || (targetPos && sugg.recShares >= targetPos.shares)) {
        setUserPositions(prev => prev.filter(p => p.stock_id !== sugg.stock_id && !p.ticker?.includes(sugg.stock_id)));
      } else if (targetPos) {
        setUserPositions(prev => prev.map(p => {
          if (p.stock_id === sugg.stock_id || p.ticker?.includes(sugg.stock_id)) {
            return { ...p, shares: Math.max(0, p.shares - sugg.recShares) };
          }
          return p;
        }));
      }

      const newTx = {
        id: `tx_${Date.now()}`,
        date: today,
        action: sugg.action === '賣出' ? '賣出' : '減持',
        ticker: `${sugg.stock_id}.TW`,
        stock_id: sugg.stock_id,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: sugg.recShares,
        price: sugg.price,
        tax_fee: sugg.estTaxFee,
        cash_flow_twd: Math.round(proceeds),
        realized_pnl_twd: Math.round(netPnl),
        realized_return_pct: Math.round(pnlPct * 10) / 10,
        note: `法定調倉${sugg.action} (已實現損益: ${netPnl >= 0 ? '+' : ''}${Math.round(netPnl).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`✅ 已執行${sugg.action}「${sugg.name}」${sugg.recShares}股，回流現金 NT$ ${Math.round(proceeds).toLocaleString()}！`);
    }

    // 暫時消去該建議
    setDismissedSuggestions(prev => [...prev, sugg.key]);
  };

  // 一鍵執行所有調倉建議
  const handleExecuteAllSuggestions = () => {
    if (rebalanceSuggestions.length === 0) return;
    if (!window.confirm(`確定要一次性執行所有共 ${rebalanceSuggestions.length} 檔調倉更動嗎？\n系統將自動調整持股部位並在交易日記中寫入完整紀錄。`)) return;
    rebalanceSuggestions.forEach(s => handleExecuteSuggestion(s));
    triggerNotice(`⚡ 已成功批次執行 ${rebalanceSuggestions.length} 項調倉指令！`);
  };

  // 暫時忽略此建議
  const handleDismissSuggestion = (key) => {
    setDismissedSuggestions(prev => [...prev, key]);
    triggerNotice('已暫時收起此項調倉建議');
  };

  // ==========================================
  // Modals 與互動表單狀態
  // ==========================================
  // 1. 現金調整彈窗
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashInputAmount, setCashInputAmount] = useState('');
  const [cashActionType, setCashActionType] = useState('deposit'); // 'deposit' or 'set'

  const handleSaveCashChange = (e) => {
    e.preventDefault();
    const val = parseFloat(cashInputAmount);
    if (!val || isNaN(val)) return;
    const today = new Date().toISOString().split('T')[0];

    if (cashActionType === 'deposit') {
      const newTx = {
        id: `tx_deposit_${Date.now()}`,
        date: today,
        action: '投入現金',
        ticker: '-',
        name: '追加本金/儲備金',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: val,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: '手動追加存入帳戶現金'
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💵 成功存入閒置資金 NT$ ${val.toLocaleString()}！`);
    } else {
      const diff = val - idleCash;
      const newTx = {
        id: `tx_adj_${Date.now()}`,
        date: today,
        action: diff >= 0 ? '投入現金' : '提取本金',
        ticker: '-',
        name: '直接校準閒置資金',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: diff,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動校準閒置現金總額為 NT$ ${val.toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💵 閒置現金已校準為 NT$ ${val.toLocaleString()}！`);
    }
    setCashModalOpen(false);
    setCashInputAmount('');
  };

  // 2. 持股手動出場平倉彈窗
  const [exitModal, setExitModal] = useState({
    open: false,
    posId: '',
    stock_id: '',
    name: '',
    shares: 0,
    entry_price: 0,
    entry_fee: 0,
    exit_price: '',
    exit_tax_fee: '',
    exit_date: new Date().toISOString().split('T')[0],
    reason: '依 60MA 季線風控停損出場'
  });

  const handleOpenExitModal = (pos) => {
    const curPrice = pos.current_price || pos.entry_price || 0;
    const estTaxFee = Math.round(pos.shares * curPrice * (0.003 + 0.001425));
    setExitModal({
      open: true,
      posId: pos.id,
      stock_id: pos.stock_id,
      name: pos.stock_name || pos.name,
      shares: pos.shares,
      entry_price: pos.entry_price,
      entry_fee: pos.entry_fee || 0,
      exit_price: String(curPrice),
      exit_tax_fee: String(estTaxFee),
      exit_date: new Date().toISOString().split('T')[0],
      reason: pos.current_price < pos.stop_loss_price ? '跌破 60MA 季線風控停損' : '依策略輪動獲利了結'
    });
  };

  const handleConfirmExit = (e) => {
    e.preventDefault();
    const ep = parseFloat(exitModal.exit_price) || 0;
    const tf = parseFloat(exitModal.exit_tax_fee) || 0;
    const totalProceeds = (exitModal.shares * ep) - tf;
    const costBasis = (exitModal.shares * exitModal.entry_price) + exitModal.entry_fee;
    const netPnl = totalProceeds - costBasis;
    const pnlPct = costBasis > 0 ? (netPnl / costBasis) * 100 : 0;

    const newTx = {
      id: `tx_exit_${Date.now()}`,
      date: exitModal.exit_date,
      action: '賣出',
      ticker: `${exitModal.stock_id}.TW`,
      stock_id: exitModal.stock_id,
      name: `${exitModal.name} (${exitModal.stock_id})`,
      shares: exitModal.shares,
      price: ep,
      tax_fee: tf,
      cash_flow_twd: Math.round(totalProceeds),
      realized_pnl_twd: Math.round(netPnl),
      realized_return_pct: Math.round(pnlPct * 10) / 10,
      note: `${exitModal.reason} (實現淨損益: ${netPnl >= 0 ? '+' : ''}${Math.round(netPnl).toLocaleString()})`
    };

    setUserPositions(prev => prev.filter(p => p.id !== exitModal.posId && p.stock_id !== exitModal.stock_id));
    setTxHistory(prev => [newTx, ...prev]);
    triggerNotice(`🚪 已結利/停損平倉「${exitModal.name}」，現金回流 NT$ ${Math.round(totalProceeds).toLocaleString()}！`);
    setExitModal({ ...exitModal, open: false });
  };

  // 3. 編輯/新增持股部位彈窗
  const [editPosModal, setEditPosModal] = useState({
    open: false,
    isNew: false,
    id: '',
    stock_id: '',
    stock_name: '',
    industry: '',
    role: '👑 王者先鋒 (35%)',
    shares: '',
    entry_price: '',
    current_price: '',
    stop_loss_price: '',
    stop_condition: ''
  });

  const handleOpenEditPos = (pos) => {
    setEditPosModal({
      open: true,
      isNew: false,
      id: pos.id,
      stock_id: pos.stock_id,
      stock_name: pos.stock_name || pos.name,
      industry: pos.industry || '',
      role: pos.role || '👑 王者先鋒 (35%)',
      shares: String(pos.shares),
      entry_price: String(pos.entry_price),
      current_price: String(pos.current_price || pos.entry_price),
      stop_loss_price: String(pos.stop_loss_price || ''),
      stop_condition: pos.stop_condition || ''
    });
  };

  const handleOpenNewPos = () => {
    setEditPosModal({
      open: true,
      isNew: true,
      id: `pos_${Date.now()}`,
      stock_id: '',
      stock_name: '',
      industry: '',
      role: '👑 王者先鋒 (35%)',
      shares: '1000',
      entry_price: '100',
      current_price: '100',
      stop_loss_price: '90',
      stop_condition: '跌破季線停損'
    });
  };

  const handleSavePosition = (e) => {
    e.preventDefault();
    const updated = {
      id: editPosModal.id || `pos_${Date.now()}`,
      stock_id: editPosModal.stock_id,
      ticker: `${editPosModal.stock_id}.TW`,
      stock_name: editPosModal.stock_name,
      name: `${editPosModal.stock_name} (${editPosModal.industry || ''})`,
      industry: editPosModal.industry,
      role: editPosModal.role,
      shares: parseInt(editPosModal.shares, 10) || 0,
      entry_price: parseFloat(editPosModal.entry_price) || 0,
      current_price: parseFloat(editPosModal.current_price) || parseFloat(editPosModal.entry_price) || 0,
      entry_fee: Math.max(20, Math.round((parseInt(editPosModal.shares, 10) || 0) * (parseFloat(editPosModal.entry_price) || 0) * 0.001425)),
      stop_loss_price: parseFloat(editPosModal.stop_loss_price) || 0,
      stop_condition: editPosModal.stop_condition,
      price_date: new Date().toISOString().split('T')[0]
    };

    if (editPosModal.isNew) {
      setUserPositions(prev => [...prev, updated]);
      triggerNotice(`➕ 已手動新增持股部位「${updated.stock_name}」！`);
    } else {
      setUserPositions(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
      triggerNotice(`✏️ 已更新「${updated.stock_name}」持股明細！`);
    }
    setEditPosModal({ ...editPosModal, open: false });
  };

  const handleDeletePos = (id, name) => {
    if (window.confirm(`確定要刪除「${name}」持股部位嗎？\n（此操作只移除當前持倉清單，不更動流水帳）`)) {
      setUserPositions(prev => prev.filter(p => p.id !== id));
      triggerNotice(`🗑️ 已刪除持股「${name}」！`);
    }
  };

  // 4. 歷史流水帳編輯與手動新增
  const [editTxModal, setEditTxModal] = useState({
    open: false,
    isNew: false,
    id: '',
    date: '',
    action: '買入',
    stock_id: '',
    name: '',
    shares: '',
    price: '',
    tax_fee: '',
    cash_flow_twd: '',
    realized_pnl_twd: '',
    realized_return_pct: '',
    note: ''
  });

  const handleOpenEditTx = (tx) => {
    setEditTxModal({
      open: true,
      isNew: false,
      id: tx.id,
      date: tx.date || new Date().toISOString().split('T')[0],
      action: tx.action || '買入',
      stock_id: tx.stock_id || tx.ticker?.split('.')[0] || '',
      name: tx.name || '',
      shares: String(tx.shares || 0),
      price: String(tx.price || 0),
      tax_fee: String(tx.tax_fee || 0),
      cash_flow_twd: String(tx.cash_flow_twd || 0),
      realized_pnl_twd: tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined ? String(tx.realized_pnl_twd) : '',
      realized_return_pct: tx.realized_return_pct !== null && tx.realized_return_pct !== undefined ? String(tx.realized_return_pct) : '',
      note: tx.note || ''
    });
  };

  const handleOpenNewTx = () => {
    setEditTxModal({
      open: true,
      isNew: true,
      id: `tx_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      action: '買入',
      stock_id: '3105',
      name: '穩懋 (3105)',
      shares: '1000',
      price: '475',
      tax_fee: '676',
      cash_flow_twd: '-475676',
      realized_pnl_twd: '',
      realized_return_pct: '',
      note: '手動記帳'
    });
  };

  const handleSaveTx = (e) => {
    e.preventDefault();
    const updated = {
      id: editTxModal.id || `tx_${Date.now()}`,
      date: editTxModal.date,
      action: editTxModal.action,
      stock_id: editTxModal.stock_id,
      ticker: editTxModal.stock_id ? `${editTxModal.stock_id}.TW` : '-',
      name: editTxModal.name,
      shares: parseInt(editTxModal.shares, 10) || 0,
      price: parseFloat(editTxModal.price) || 0,
      tax_fee: parseFloat(editTxModal.tax_fee) || 0,
      cash_flow_twd: Math.round(parseFloat(editTxModal.cash_flow_twd) || 0),
      realized_pnl_twd: editTxModal.realized_pnl_twd !== '' ? Math.round(parseFloat(editTxModal.realized_pnl_twd)) : null,
      realized_return_pct: editTxModal.realized_return_pct !== '' ? parseFloat(editTxModal.realized_return_pct) : null,
      note: editTxModal.note
    };

    if (editTxModal.isNew) {
      setTxHistory(prev => [updated, ...prev]);
      triggerNotice('➕ 已成功新增一筆歷史交易流水帳！');
    } else {
      setTxHistory(prev => prev.map(t => t.id === updated.id ? updated : t));
      triggerNotice('✏️ 已成功更新歷史交易紀錄！');
    }
    setEditTxModal({ ...editTxModal, open: false });
  };

  const handleDeleteTx = (id, name, action) => {
    if (window.confirm(`確定要刪除「${action} ${name}」這筆交易流水帳嗎？\n刪除後無法復原。`)) {
      setTxHistory(prev => prev.filter(t => t.id !== id));
      triggerNotice(`🗑️ 已刪除該筆流水帳紀錄！`);
    }
  };

  // 重置回預設開倉
  const handleResetToDefault = () => {
    if (window.confirm('確定要將台股因果泰坦重設回初始預設持倉 (100萬本金開倉) 嗎？\n您現有的自訂持倉與流水帳將被重置。')) {
      setUserPositions(DEFAULT_POSITIONS);
      setTxHistory(DEFAULT_TX_HISTORY);
      setDismissedSuggestions([]);
      triggerNotice('🔄 已重設為初始開倉持倉與流水帳！');
    }
  };

  // 匯出 JSON 備份
  const handleExportBackup = () => {
    const exportData = {
      app: 'Lobster Report Taiwan Causal Titan',
      version: 'v3.2.0',
      username: currentUsername,
      exported_at: new Date().toISOString(),
      positions: userPositions,
      tx_history: txHistory,
      dismissed_suggestions: dismissedSuggestions
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `taiwan_causal_titan_${currentUsername}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(a);
    a.click();
    a.remove();
    triggerNotice(`📤 已匯出「${currentUsername}」專屬台股泰坦備份檔！`);
  };

  // 匯入 JSON 備份
  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (Array.isArray(imported.positions) && Array.isArray(imported.tx_history)) {
          setUserPositions(imported.positions);
          setTxHistory(imported.tx_history);
          if (Array.isArray(imported.dismissed_suggestions)) setDismissedSuggestions(imported.dismissed_suggestions);
          triggerNotice(`📥 已成功匯入備份！共 ${imported.positions.length} 檔持股，${imported.tx_history.length} 筆流水帳。`);
        } else {
          alert('備份格式不正確，需包含 positions 與 tx_history 陣列');
        }
      } catch (err) {
        alert('解析備份檔案失敗: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 匯出流水帳 CSV
  const handleExportTxCsv = () => {
    if (!txHistory || txHistory.length === 0) return;
    const headers = ['日期', '動作', '標的代號', '股票名稱', '成交股數', '價格', '稅金手續費', '現金流變動', '已實現損益', '已實現報酬率(%)', '備註'];
    const rows = txHistory.map(t => [
      t.date,
      t.action,
      t.stock_id || t.ticker,
      t.name,
      t.shares,
      t.price,
      t.tax_fee,
      t.cash_flow_twd,
      t.realized_pnl_twd !== null ? t.realized_pnl_twd : '',
      t.realized_return_pct !== null ? t.realized_return_pct : '',
      t.note || ''
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `taiwan_causal_titan_transactions_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerNotice('📥 交易流水帳 CSV 已成功匯出！');
  };

  // 匯出回測 413 筆交易 CSV
  const handleExportTradesCsv = () => {
    if (!trades || trades.length === 0) return;
    const headers = ['標的代號', '股票名稱', '配置角色', '進場日期', '進場價格', '出場日期', '出場價格', '持有天數', '單筆報酬率(%)', '出場原因/機制'];
    const rows = trades.map(t => [
      t.stock_id,
      t.stock_name,
      t.role,
      t.entry_date,
      t.entry_price,
      t.exit_date,
      t.exit_price,
      t.holding_days,
      t.return_pct,
      t.exit_reason
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `taiwan_causal_titan_22y_trades.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerNotice('📥 22年回測全交易紀錄 CSV 已成功匯出！');
  };

  // 曲線 SVG 點計算
  const svgCurveData = useMemo(() => {
    if (!curve || curve.length === 0) return { pathStrat: '', pathTx: '', width: 860, height: 280 };
    const width = 860;
    const height = 280;
    const padding = { top: 20, right: 30, bottom: 30, left: 60 };

    const maxStrat = Math.max(...curve.map(c => c.strategy_nav));
    const minStrat = Math.min(...curve.map(c => Math.min(c.strategy_nav, c.taiex_nav)));

    const logMin = Math.log10(Math.max(0.8, minStrat));
    const logMax = Math.log10(Math.max(10, maxStrat));

    const getX = (idx) => padding.left + (idx / (curve.length - 1)) * (width - padding.left - padding.right);
    const getY = (val) => {
      const logVal = Math.log10(Math.max(0.8, val));
      const ratio = (logVal - logMin) / (logMax - logMin);
      return height - padding.bottom - ratio * (height - padding.top - padding.bottom);
    };

    let pathStrat = `M ${getX(0)} ${getY(curve[0].strategy_nav)}`;
    let pathTx = `M ${getX(0)} ${getY(curve[0].taiex_nav)}`;

    curve.forEach((c, idx) => {
      if (idx > 0) {
        pathStrat += ` L ${getX(idx)} ${getY(c.strategy_nav)}`;
        pathTx += ` L ${getX(idx)} ${getY(c.taiex_nav)}`;
      }
    });

    return { pathStrat, pathTx, width, height, padding, maxStrat };
  }, [curve]);

  return (
    <div style={{ color: '#E2E8F0', padding: '1.2rem', maxWidth: '1440px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
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
          animation: 'fadeIn 0.25s ease'
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* ===== 頂部綜合旗艦橫條 (Mini Account Banner) ===== */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: '16px',
        padding: '1.4rem',
        marginBottom: '1.5rem',
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)'
      }}>
        {/* 第一行：策略標題、標籤與操作工具列 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#60A5FA', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 'bold' }}>
              👑 台股因果量化泰坦旗艦版 (DOE 黃金階梯 35/25/20/10/10)
            </h3>
            <span style={{
              fontSize: '0.78rem',
              background: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              color: '#38BDF8',
              padding: '0.2rem 0.65rem',
              borderRadius: '6px',
              fontWeight: 'bold'
            }}>
              🗓️ 報價日：<strong style={{ color: '#FCD34D' }}>2026-10-20</strong> · 下次調倉：<strong style={{ color: '#FCD34D' }}>11/11 法定公告日</strong>
            </span>
            <span style={{
              fontSize: '0.76rem',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2))',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#34D399',
              padding: '0.2rem 0.6rem',
              borderRadius: '6px',
              fontWeight: 'bold'
            }}>
              🚀 22年回測 2,053.38倍 (CAGR 42.58%) · Sharpe 1.13 · 60MA 季線風控
            </span>
          </div>

          {/* 帳本身分與備份快捷鍵 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              padding: '0.25rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#94A3B8' }}>👤 帳本:</span>
              <strong style={{ color: '#FCD34D' }}>{currentUsername}</strong>
              <span style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.72rem' }}>● 本機雲端就緒</span>
            </div>

            <button
              onClick={handleExportBackup}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#CBD5E1',
                padding: '0.25rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
              title="匯出個人持倉與交易流水帳 JSON 備份檔"
            >
              📤 備份
            </button>

            <label style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#CBD5E1',
              padding: '0.25rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.78rem',
              cursor: 'pointer'
            }} title="匯入已備份的 JSON 帳本檔案">
              📥 匯入
              <input type="file" accept=".json" onChange={handleImportBackup} style={{ display: 'none' }} />
            </label>

            <button
              onClick={handleResetToDefault}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#FCA5A5',
                padding: '0.25rem 0.65rem',
                borderRadius: '6px',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
              title="重設回初始開倉持倉與流水帳"
            >
              🔄 重設
            </button>
          </div>
        </div>

        {/* 第二行：5 個帳戶資產數據方塊 (完全對齊全球主權泰坦模式) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
          {/* 總資產淨值 */}
          <div style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>💼 總資產淨值 (閒置+持股)</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: totalNetProfitTwd >= 0 ? '#34D399' : '#F87171', marginTop: '0.25rem' }}>
              本金: NT$ {Math.round(totalDepositsTwd).toLocaleString()} | 總淨利: {totalNetProfitTwd >= 0 ? '+' : ''}{totalNetProfitPct.toFixed(2)}%
            </div>
          </div>

          {/* 股票持股市值 */}
          <div style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #6366F1' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>📊 階梯持股市值 (目標 100%)</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#A5B4FC', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.25rem' }}>
              佔比: {totalNetAssetsTwd > 0 ? ((totalStockMarketValTwd / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (5檔主力滿倉)
            </div>
          </div>

          {/* 閒置資金與儲備池 */}
          <div style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>💵 閒置現金與儲備池</span>
              <button
                onClick={() => { setCashActionType('deposit'); setCashModalOpen(true); }}
                style={{
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: 'none',
                  color: '#34D399',
                  fontSize: '0.72rem',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                ➕ 存入/調整
              </button>
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#6EE7B7', fontFamily: 'monospace' }}>
              NT$ {Math.round(idleCash).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.25rem' }}>
              佔比: {totalNetAssetsTwd > 0 ? ((idleCash / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (待命中儲備金)
            </div>
          </div>

          {/* 未實現損益 */}
          <div style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', borderLeft: unrealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>📈 當前未實現損益</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: unrealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {unrealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(unrealizedPnlTwd).toLocaleString()}
              <span style={{ fontSize: '0.8rem', marginLeft: '0.35rem' }}>
                ({unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%)
              </span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.25rem' }}>
              持股總成本: NT$ {Math.round(totalCostTwd).toLocaleString()}
            </div>
          </div>

          {/* 累計已實現淨利 */}
          <div style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', borderLeft: totalRealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>🏆 累計已實現淨利 (扣稅費)</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {totalRealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnlTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.25rem' }}>
              已平倉 {closedTradesCount} 筆 · 勝率 {winRate.toFixed(0)}% · 稅費 NT$ {Math.round(totalTaxesPaidTwd).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* ===== 標籤導航列 ===== */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.2rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { id: 'portfolio', label: '🎯 實盤跟單與調倉指揮部' },
          { id: 'curve', label: '📈 22年 2,053.38x 淨值曲線 (Log)' },
          { id: 'yearly', label: '🏆 歷年年度勝率與報酬 (2005-2026)' },
          { id: 'alphas', label: '🔬 4 大真因果 Alpha 不變性雷達' },
          { id: 'trades', label: '📋 回測歷史全交易紀錄 (413筆)' },
          { id: 'rules', label: '📖 策略 SOP 與風控法典' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTabSub(tab.id)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: 'none',
              background: activeTabSub === tab.id ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'rgba(255, 255, 255, 0.05)',
              color: activeTabSub === tab.id ? '#FFF' : '#94A3B8',
              fontWeight: activeTabSub === tab.id ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: '0.86rem',
              transition: 'all 0.2s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== TAB 1: 實盤跟單與調倉指揮部 (完全對齊全球主權泰坦模式) ===== */}
      {activeTabSub === 'portfolio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* 1. 每月 11 號法定營收調倉窗口與更動建議試算器 */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            borderRadius: '12px',
            padding: '1.2rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔄 每月 11 號法定調倉窗口 · 階梯更動建議試算器
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.8rem', color: '#CBD5E1' }}>
                  依據總淨資產 (NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}) 與 DOE 黃金階梯基準 (35% / 25% / 20% / 10% / 10%) 即時比對偏差。
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleCopyAllOrders}
                  disabled={rebalanceSuggestions.length === 0}
                  style={{
                    background: 'rgba(245, 158, 11, 0.2)',
                    border: '1px solid #F59E0B',
                    color: '#FDE68A',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: rebalanceSuggestions.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: rebalanceSuggestions.length === 0 ? 0.5 : 1
                  }}
                >
                  📋 一鍵複製全部委託指令
                </button>
                <button
                  onClick={handleExecuteAllSuggestions}
                  disabled={rebalanceSuggestions.length === 0}
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    border: 'none',
                    color: '#FFF',
                    padding: '0.4rem 0.95rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: rebalanceSuggestions.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: rebalanceSuggestions.length === 0 ? 0.5 : 1
                  }}
                >
                  ⚡ 一鍵執行所有調倉建議
                </button>
              </div>
            </div>

            {/* 建議卡片清單 */}
            {rebalanceSuggestions.length === 0 ? (
              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px dashed rgba(16, 185, 129, 0.4)',
                borderRadius: '8px',
                padding: '1.2rem',
                textAlign: 'center',
                color: '#34D399',
                fontSize: '0.9rem'
              }}>
                ✅ <strong>目前實盤持股配置已完美對齊 DOE 黃金階梯目標 (35/25/20/10/10)！</strong>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.3rem' }}>
                  所有主力持倉權重偏差均在 ±5% 容差帶內，無需額外手續費磨損，請安心抱牢並逐日監控 60MA 季線！
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '0.9rem' }}>
                {rebalanceSuggestions.map(sugg => (
                  <div key={sugg.key} style={{
                    background: 'rgba(0, 0, 0, 0.45)',
                    border: `1px solid ${sugg.actionColor}55`,
                    borderLeft: `4px solid ${sugg.actionColor}`,
                    borderRadius: '8px',
                    padding: '0.9rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.6rem'
                  }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                        <div>
                          <span style={{
                            background: sugg.actionColor,
                            color: '#000',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            fontSize: '0.75rem',
                            marginRight: '0.4rem'
                          }}>
                            {sugg.action}
                          </span>
                          <strong style={{ fontSize: '1.05rem', color: '#F8FAFC' }}>
                            {sugg.stock_id} {sugg.name}
                          </strong>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{sugg.role}</span>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: '#CBD5E1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem', marginTop: '0.4rem' }}>
                        <div>現有持股: <strong style={{ color: '#F8FAFC' }}>{sugg.currentShares.toLocaleString()} 股</strong></div>
                        <div>目標配比: <strong style={{ color: '#FDE68A' }}>{sugg.targetWeightPct}%</strong></div>
                        <div>建議調倉: <strong style={{ color: sugg.actionColor }}>{sugg.sharesDesc}</strong></div>
                        <div>現價估值: <strong style={{ color: '#38BDF8' }}>${sugg.price} (約 NT${Math.round(sugg.recShares * sugg.price).toLocaleString()})</strong></div>
                      </div>

                      <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginTop: '0.4rem' }}>
                        預估稅費: NT$ {sugg.estTaxFee.toLocaleString()} · 60MA 季線風控: ${sugg.stop_loss_price}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.5rem' }}>
                      <button
                        onClick={() => handleCopyOrder(sugg)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: 'none',
                          color: '#CBD5E1',
                          padding: '0.25rem 0.6rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        📋 複製下單
                      </button>
                      <button
                        onClick={() => handleExecuteSuggestion(sugg)}
                        style={{
                          background: sugg.actionColor,
                          border: 'none',
                          color: '#000',
                          fontWeight: 'bold',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          cursor: 'pointer'
                        }}
                      >
                        ⚡ 一鍵執行
                      </button>
                      <button
                        onClick={() => handleDismissSuggestion(sugg.key)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#64748B',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          padding: '0.25rem 0.4rem'
                        }}
                        title="暫時收起此建議"
                      >
                        ✕ 稍後
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. 當前實盤持股部位清單 (Active Real Positions) */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '1.2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  📊 當前實戰持股部位管理 (全市場前 100 大 · 60MA 風控監控)
                </h4>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.2rem' }}>
                  共持有 <strong style={{ color: '#FDE68A' }}>{userPositions.length}</strong> 檔股票部位，總市值 NT$ <strong style={{ color: '#FDE68A' }}>{Math.round(totalStockMarketValTwd).toLocaleString()}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleOpenNewPos}
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid #3B82F6',
                    color: '#93C5FD',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ➕ 手動新增部位
                </button>
              </div>
            </div>

            {/* 持股表格 */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                    <th style={{ padding: '0.7rem 0.5rem' }}>標的</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>階梯角色</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>持股數 (張+股)</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>成本均價</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>最新現價</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>持股市值</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>未實現損益</th>
                    <th style={{ padding: '0.7rem 0.5rem' }}>60MA 季線風控</th>
                    <th style={{ padding: '0.7rem 0.5rem', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {userPositions.map(pos => {
                    const curPrice = pos.current_price || pos.entry_price || 0;
                    const marketVal = pos.shares * curPrice;
                    const costVal = (pos.shares * pos.entry_price) + (pos.entry_fee || 0);
                    const pnl = marketVal - costVal;
                    const pnlPct = costVal > 0 ? (pnl / costVal) * 100 : 0;

                    const lots = Math.floor(pos.shares / 1000);
                    const odd = pos.shares % 1000;
                    const isStopLossWarning = pos.stop_loss_price && curPrice <= pos.stop_loss_price;
                    const distToStop = pos.stop_loss_price && curPrice > 0 ? ((curPrice - pos.stop_loss_price) / curPrice) * 100 : 0;

                    return (
                      <tr key={pos.id || pos.stock_id} style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                        background: isStopLossWarning ? 'rgba(239, 68, 68, 0.12)' : 'transparent'
                      }}>
                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <div style={{ fontWeight: 'bold', color: '#F8FAFC', fontSize: '0.92rem' }}>
                            {pos.stock_id} {pos.stock_name || pos.name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{pos.industry || pos.highlight}</div>
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <span style={{
                            background: 'rgba(59, 130, 246, 0.2)',
                            color: '#93C5FD',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 'bold'
                          }}>
                            {pos.role || '主權主力'}
                          </span>
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                          <strong style={{ color: '#FDE68A' }}>{pos.shares.toLocaleString()} 股</strong>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                            ({lots > 0 ? `${lots}張 ` : ''}{odd > 0 ? `${odd}股` : ''})
                          </div>
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                          ${pos.entry_price?.toLocaleString()}
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                          ${curPrice.toLocaleString()}
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                          NT$ {Math.round(marketVal).toLocaleString()}
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'monospace' }}>
                          <div style={{ color: pnl >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {pnl >= 0 ? '+' : ''}NT$ {Math.round(pnl).toLocaleString()}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: pnl >= 0 ? '#34D399' : '#F87171' }}>
                            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                          </div>
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem' }}>
                          <div style={{ color: isStopLossWarning ? '#EF4444' : '#FBBF24', fontWeight: 'bold', fontFamily: 'monospace' }}>
                            ${pos.stop_loss_price || '-'}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: isStopLossWarning ? '#F87171' : '#94A3B8' }}>
                            {isStopLossWarning ? '⚠️ 跌破季線停損！' : `距停損 ${distToStop.toFixed(1)}%`}
                          </div>
                        </td>

                        <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem' }}>
                            <button
                              onClick={() => handleOpenExitModal(pos)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#FCA5A5',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.74rem',
                                cursor: 'pointer'
                              }}
                              title="手動結利或停損記帳出場"
                            >
                              🚪 出場
                            </button>
                            <button
                              onClick={() => handleOpenEditPos(pos)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none',
                                color: '#CBD5E1',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.74rem',
                                cursor: 'pointer'
                              }}
                              title="編輯持股明細"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeletePos(pos.id, pos.stock_name || pos.name)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                border: 'none',
                                color: '#F87171',
                                padding: '0.2rem 0.45rem',
                                borderRadius: '4px',
                                fontSize: '0.74rem',
                                cursor: 'pointer'
                              }}
                              title="刪除部位"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3. 歷史全進出交易流水帳日記 (Transaction History) */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            padding: '1.2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.15rem' }}>
                  📜 歷史全進出流水帳日記 (全記錄無隱藏 · 支援 CSV 匯出)
                </h4>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.2rem' }}>
                  共記錄 <strong style={{ color: '#FDE68A' }}>{txHistory.length}</strong> 筆交易，累計實現損益 NT$ <strong style={{ color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedPnlTwd >= 0 ? '+' : ''}{Math.round(totalRealizedPnlTwd).toLocaleString()}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={handleExportTxCsv}
                  style={{
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid #10B981',
                    color: '#6EE7B7',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  📥 匯出流水帳 CSV
                </button>
                <button
                  onClick={handleOpenNewTx}
                  style={{
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid #6366F1',
                    color: '#C7D2FE',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ➕ 手動記帳
                </button>
              </div>
            </div>

            {/* 流水帳清單表格 */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                    <th style={{ padding: '0.6rem 0.5rem' }}>日期</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>動作</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>標的</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>成交股數</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>價格</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>稅金手續費</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>現金流變動</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>已實現損益</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>備註說明</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {txHistory.map(tx => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace', color: '#CBD5E1' }}>
                        {tx.date}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem' }}>
                        <span style={{
                          background: tx.action === '買入' || tx.action === '加碼' ? 'rgba(16, 185, 129, 0.2)' : tx.action === '賣出' || tx.action === '減持' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: tx.action === '買入' || tx.action === '加碼' ? '#34D399' : tx.action === '賣出' || tx.action === '減持' ? '#F87171' : '#FBBF24',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.74rem',
                          fontWeight: 'bold'
                        }}>
                          {tx.action}
                        </span>
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontWeight: 'bold', color: '#F8FAFC' }}>
                        {tx.name || tx.stock_id || tx.ticker}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>
                        {tx.shares > 0 ? `${tx.shares.toLocaleString()} 股` : '-'}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>
                        {tx.price > 0 ? `$${tx.price.toLocaleString()}` : '-'}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {tx.tax_fee > 0 ? `NT$ ${tx.tax_fee.toLocaleString()}` : '-'}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace', fontWeight: 'bold', color: (Number(tx.cash_flow_twd) || 0) >= 0 ? '#34D399' : '#F87171' }}>
                        {(Number(tx.cash_flow_twd) || 0) >= 0 ? '+' : ''}NT$ {Math.round(Number(tx.cash_flow_twd) || 0).toLocaleString()}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>
                        {tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined ? (
                          <span style={{ color: tx.realized_pnl_twd >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {tx.realized_pnl_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.realized_pnl_twd).toLocaleString()}
                            {tx.realized_return_pct !== null && (
                              <span style={{ fontSize: '0.7rem', marginLeft: '0.2rem' }}>
                                ({tx.realized_return_pct >= 0 ? '+' : ''}{tx.realized_return_pct}%)
                              </span>
                            )}
                          </span>
                        ) : '-'}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', color: '#94A3B8', fontSize: '0.76rem' }}>
                        {tx.note || '-'}
                      </td>

                      <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.3rem' }}>
                          <button
                            onClick={() => handleOpenEditTx(tx)}
                            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.76rem' }}
                            title="編輯流水帳"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDeleteTx(tx.id, tx.name || tx.stock_id, tx.action)}
                            style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '0.76rem' }}
                            title="刪除流水帳"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB 2: 22 年 2,053.38x 累積淨值走勢曲線 (Log) ===== */}
      {activeTabSub === 'curve' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.2rem' }}>
                📈 22 年 (2005 - 2026) 策略 vs 大盤加權指數累積淨值走勢 (Log10 對數刻度)
              </h4>
              <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.82rem', color: '#94A3B8' }}>
                台股前 100 大市值 · 法定營收日調倉 · 60MA 季線動態風控 · 38.5 bps 摩擦成本嚴格計入
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
              <span style={{ color: '#F59E0B', fontWeight: 'bold' }}>● 👑 台股因果泰坦 (2,053.38x)</span>
              <span style={{ color: '#64748B' }}>● 加權指數 (7.72x)</span>
            </div>
          </div>

          {/* SVG 圖表 */}
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${svgCurveData.width} ${svgCurveData.height}`} style={{ width: '100%', maxHeight: '420px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
              {/* 網格線 */}
              <line x1="60" y1="20" x2="830" y2="20" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="80" x2="830" y2="80" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="150" x2="830" y2="150" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="220" x2="830" y2="220" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="250" x2="830" y2="250" stroke="rgba(255,255,255,0.15)" />

              {/* 標籤文字 */}
              <text x="15" y="25" fill="#F59E0B" fontSize="10" fontFamily="monospace">2000x</text>
              <text x="15" y="85" fill="#94A3B8" fontSize="10" fontFamily="monospace">100x</text>
              <text x="15" y="155" fill="#94A3B8" fontSize="10" fontFamily="monospace">10x</text>
              <text x="15" y="250" fill="#94A3B8" fontSize="10" fontFamily="monospace">1.0x</text>

              {/* 年份刻度 */}
              <text x="70" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2005</text>
              <text x="240" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2010</text>
              <text x="420" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2015</text>
              <text x="610" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2020</text>
              <text x="800" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2026</text>

              {/* 加權指數走勢 */}
              <path d={svgCurveData.pathTx} fill="none" stroke="#64748B" strokeWidth="1.8" />

              {/* 泰坦策略走勢 */}
              <path d={svgCurveData.pathStrat} fill="none" stroke="#F59E0B" strokeWidth="2.8" strokeLinecap="round" />
            </svg>
          </div>

          {/* 策略績效核心亮點卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.9rem', marginTop: '1.2rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>22年累積倍數</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace' }}>2,053.38x</div>
              <div style={{ fontSize: '0.7rem', color: '#34D399', marginTop: '0.2rem' }}>大盤 7.72x (Alpha +2,045x)</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>年化複合報酬率 (CAGR)</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+42.58%</div>
              <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.2rem' }}>大盤同期 10.02%</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid #38BDF8' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>夏普比率 (Sharpe Ratio)</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>1.13</div>
              <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginTop: '0.2rem' }}>大盤 0.54 (提升 2.1x)</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid #EC4899' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>歷史最大回撤 (MDD)</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#F472B6', fontFamily: 'monospace' }}>-35.30%</div>
              <div style={{ fontSize: '0.7rem', color: '#34D399', marginTop: '0.2rem' }}>大盤 -54.07% (大幅抗震避險)</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TAB 3: 歷年年度勝率與報酬 (2005 - 2026) ===== */}
      {activeTabSub === 'yearly' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#F8FAFC', fontSize: '1.2rem' }}>
            🏆 2005 - 2026 歷年年度績效對比 (22 年勝率 86.4% · 贏 19 年輸 3 年)
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                  <th style={{ padding: '0.7rem 0.6rem' }}>年度</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>策略報酬率</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>加權大盤報酬</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>超額 Alpha</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>年度勝負</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>年度勝率條狀</th>
                </tr>
              </thead>
              <tbody>
                {yearly_stats.map(y => {
                  const isWin = y.return_pct > y.taiex_pct;
                  const alpha = y.return_pct - y.taiex_pct;
                  return (
                    <tr key={y.year} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                        {y.year}
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: y.return_pct >= 0 ? '#34D399' : '#F87171' }}>
                        {y.return_pct >= 0 ? '+' : ''}{y.return_pct.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {y.taiex_pct >= 0 ? '+' : ''}{y.taiex_pct.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: alpha >= 0 ? '#FBBF24' : '#F87171' }}>
                        {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem' }}>
                        <span style={{
                          background: isWin ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                          color: isWin ? '#34D399' : '#F87171',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold'
                        }}>
                          {isWin ? '🏆 完勝大盤' : '落後'}
                        </span>
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem' }}>
                        <div style={{ width: '120px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, Math.max(5, (y.return_pct + 40) / 1.5))}%`,
                            height: '100%',
                            background: y.return_pct >= 0 ? 'linear-gradient(90deg, #10B981, #34D399)' : '#EF4444'
                          }} />
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

      {/* ===== TAB 4: 4 大真因果 Alpha 不變性雷達 ===== */}
      {activeTabSub === 'alphas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.2rem' }}>
          {causal_alphas.map(alpha => (
            <div key={alpha.factor} style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '12px',
              padding: '1.3rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <h4 style={{ margin: 0, color: '#60A5FA', fontSize: '1.1rem' }}>{alpha.factor}</h4>
                <span style={{
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#34D399',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.74rem',
                  fontWeight: 'bold'
                }}>
                  {alpha.ic_t_stat}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#CBD5E1', marginBottom: '0.8rem' }}>
                <strong>因果機制：</strong>{alpha.mechanism}
              </div>
              <div style={{ fontSize: '0.76rem', color: '#94A3B8', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '0.6rem' }}>
                <strong>科學依據：</strong>{alpha.scientific_basis}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== TAB 5: 回測歷史全交易紀錄 (413 筆) ===== */}
      {activeTabSub === 'trades' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.2rem' }}>
                📋 2005 - 2026 回測全進出交易明細 (共 413 筆完整日誌)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94A3B8' }}>
                每一筆皆嚴格遵循法定營收公告日 T+1 進場與 60MA 季線動態停損機制
              </p>
            </div>
            <button
              onClick={handleExportTradesCsv}
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid #10B981',
                color: '#6EE7B7',
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              📥 匯出 413 筆回測 CSV
            </button>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '550px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#1E293B' }}>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                  <th style={{ padding: '0.6rem 0.5rem' }}>標的</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>配置角色</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>進場日期/價格</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>出場日期/價格</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>持有天數</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>單筆報酬率</th>
                  <th style={{ padding: '0.6rem 0.5rem' }}>出場原因</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 100).map((t, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '0.65rem 0.5rem', fontWeight: 'bold', color: '#F8FAFC' }}>
                      {t.stock_id} {t.stock_name}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', color: '#93C5FD' }}>{t.role}</td>
                    <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>
                      {t.entry_date} (${t.entry_price})
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>
                      {t.exit_date} (${t.exit_price})
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace' }}>{t.holding_days} 天</td>
                    <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'monospace', fontWeight: 'bold', color: t.return_pct >= 0 ? '#34D399' : '#F87171' }}>
                      {t.return_pct >= 0 ? '+' : ''}{t.return_pct.toFixed(2)}%
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', color: '#94A3B8', fontSize: '0.76rem' }}>{t.exit_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== TAB 6: 策略 SOP 與風控法典 ===== */}
      {activeTabSub === 'rules' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#FBBF24', fontSize: '1.25rem' }}>
            📖 台股因果量化泰坦旗艦版 · 實戰紀律操作守則 (SOP)
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.2rem', lineHeight: '1.6' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '8px', borderLeft: '3px solid #38BDF8' }}>
              <h5 style={{ margin: '0 0 0.5rem 0', color: '#38BDF8', fontSize: '1rem' }}>1. 標的池與調倉時序</h5>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#CBD5E1' }}>
                • <strong>標的範疇：</strong>全台股市場市值前 100 大高流動性標的，杜絕小型股流動性陷阱。<br />
                • <strong>法定調倉日：</strong>每月 11 號法定營收最後公告日收盤後，由 4 大因果 Alpha 模型運算出次月黃金階梯 5 檔，並於次日開盤建倉執行。
              </p>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
              <h5 style={{ margin: '0 0 0.5rem 0', color: '#FDE68A', fontSize: '1rem' }}>2. DOE 黃金階梯權重 (35/25/20/10/10)</h5>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#CBD5E1' }}>
                • <strong>👑 第1王者 (35%)：</strong>模型信心度最高之絕對主力。<br />
                • <strong>🚀 第2主力 (25%)：</strong>高成長爆發力主升段標的。<br />
                • <strong>⚡ 第3先鋒 (20%)：</strong>動能突破旗艦標的。<br />
                • <strong>🛡️ 第4支柱 (10%) & 🎯 第5突破 (10%)：</strong>輔助配置，兼顧防守與驚喜度。
              </p>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1.2rem', borderRadius: '8px', borderLeft: '3px solid #EF4444' }}>
              <h5 style={{ margin: '0 0 0.5rem 0', color: '#F87171', fontSize: '1rem' }}>3. 60MA 季線動態停損機制</h5>
              <p style={{ margin: 0, fontSize: '0.84rem', color: '#CBD5E1' }}>
                • <strong>動態停損：</strong>持有期間若個股收盤或盤中跌破 60MA 季線，立即觸發風控停損出場。<br />
                • <strong>剩餘天數停泊現金：</strong>停損出場後之資金一律停泊 1.5% 無風險現金儲備，不盲目換股，直至次月 11 號法定調倉窗口重啟。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ===== 彈窗 1: 存入 / 調整資金 Modal (完全對齊全球主權泰坦模式) ===== */}
      {cashModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div style={{
            maxWidth: '440px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid #F59E0B', borderRadius: '12px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.15rem' }}>
                💵 記錄/存入閒置資金
              </h4>
              <button
                onClick={() => setCashModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#CBD5E1', margin: '0 0 1rem 0' }}>
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
                      flex: 1, padding: '0.45rem', borderRadius: '6px', fontSize: '0.82rem',
                      background: cashActionType === 'deposit' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: cashActionType === 'deposit' ? '#000' : '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ➕ 追加存入本金
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashActionType('set')}
                    style={{
                      flex: 1, padding: '0.45rem', borderRadius: '6px', fontSize: '0.82rem',
                      background: cashActionType === 'set' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: cashActionType === 'set' ? '#000' : '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ✏️ 直接校準閒置現金
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
                    width: '100%', padding: '0.55rem', borderRadius: '6px',
                    background: 'rgba(0,0,0,0.6)', border: '1px solid #F59E0B',
                    color: '#FDE68A', fontSize: '1.15rem', fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  {[100000, 300000, 500000, 1000000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashInputAmount(String(amt))}
                      style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', color: '#CBD5E1',
                        padding: '0.25rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer'
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
                  onClick={() => setCashModalOpen(false)}
                  style={{ padding: '0.45rem 1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#FFF', fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#000', fontWeight: 'bold', padding: '0.45rem 1.2rem', borderRadius: '6px', border: 'none', fontSize: '0.84rem', cursor: 'pointer'
                  }}
                >
                  確認更新
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== 彈窗 2: 持股手動出場平倉 Modal ===== */}
      {exitModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div style={{
            maxWidth: '480px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '12px', padding: '1.4rem'
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

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.7rem 0.9rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.84rem' }}>
              <div style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: '0.98rem' }}>
                {exitModal.name} <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>({exitModal.stock_id})</span>
              </div>
              <div style={{ color: '#CBD5E1', marginTop: '0.2rem' }}>
                持有: <strong style={{ color: '#FDE68A' }}>{exitModal.shares?.toLocaleString()} 股</strong> | 買入成本均價: <strong style={{ color: '#FDE68A' }}>${exitModal.entry_price?.toLocaleString()}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmExit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場成交價格 ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_price}
                    onChange={(e) => setExitModal({ ...exitModal, exit_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: 'rgba(0,0,0,0.5)', border: '1px solid #F87171', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場稅金/手續費 (NT$)</label>
                  <input
                    type="number"
                    step="1"
                    value={exitModal.exit_tax_fee}
                    onChange={(e) => setExitModal({ ...exitModal, exit_tax_fee: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場日期</label>
                  <input
                    type="date"
                    value={exitModal.exit_date}
                    onChange={(e) => setExitModal({ ...exitModal, exit_date: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場原因</label>
                  <select
                    value={exitModal.reason}
                    onChange={(e) => setExitModal({ ...exitModal, reason: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', background: '#1E293B', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="跌破 60MA 季線風控停損">跌破 60MA 季線風控停損</option>
                    <option value="依法定營收日輪動換股">依法定營收日輪動換股</option>
                    <option value="個人獲利了結">個人獲利了結</option>
                    <option value="盤整減碼">盤整減碼</option>
                  </select>
                </div>
              </div>

              {/* 實時預估淨額 */}
              {(() => {
                const ep = parseFloat(exitModal.exit_price) || 0;
                const tf = parseFloat(exitModal.exit_tax_fee) || 0;
                const totalProceeds = (exitModal.shares * ep) - tf;
                const costBasis = (exitModal.shares * exitModal.entry_price) + exitModal.entry_fee;
                const netPnl = totalProceeds - costBasis;
                return (
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.7rem 0.9rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#94A3B8' }}>回流閒置現金:</span>
                      <strong style={{ color: '#FDE68A', fontFamily: 'monospace' }}>
                        +NT$ {Math.round(totalProceeds).toLocaleString()}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94A3B8' }}>實現淨損益 (扣稅費):</span>
                      <strong style={{ color: netPnl >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                        {netPnl >= 0 ? '+' : ''}NT$ {Math.round(netPnl).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => setExitModal({ ...exitModal, open: false })}
                  style={{ padding: '0.45rem 1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#FFF', fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', borderRadius: '6px', border: 'none', fontSize: '0.84rem', cursor: 'pointer'
                  }}
                >
                  確認出場並入帳
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== 彈窗 3: 編輯 / 新增持股部位 Modal ===== */}
      {editPosModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div style={{
            maxWidth: '500px', width: '100%',
            background: 'linear-gradient(135deg, #0F172A, #1E293B)',
            border: '1px solid rgba(59, 130, 246, 0.5)', borderRadius: '12px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#60A5FA', fontSize: '1.15rem' }}>
                {editPosModal.isNew ? '➕ 手動新增台股泰坦持股部位' : `✏️ 編輯持股部位 - ${editPosModal.stock_name}`}
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
                    placeholder="例: 3105"
                    value={editPosModal.stock_id}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stock_id: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票名稱</label>
                  <input
                    type="text"
                    placeholder="例: 穩懋"
                    value={editPosModal.stock_name}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stock_name: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>配置角色</label>
                  <select
                    value={editPosModal.role}
                    onChange={(e) => setEditPosModal({ ...editPosModal, role: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  >
                    <option value="👑 王者先鋒 (35%)">👑 王者先鋒 (35%)</option>
                    <option value="🚀 核心主力 (25%)">🚀 核心主力 (25%)</option>
                    <option value="⚡ 動能旗艦 (20%)">⚡ 動能旗艦 (20%)</option>
                    <option value="🛡️ 結構支柱 (10%)">🛡️ 結構支柱 (10%)</option>
                    <option value="🎯 爆發突破 (10%)">🎯 爆發突破 (10%)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>持有股數</label>
                  <input
                    type="number"
                    step="1"
                    value={editPosModal.shares}
                    onChange={(e) => setEditPosModal({ ...editPosModal, shares: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成本均價</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPosModal.entry_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>最新現價</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPosModal.current_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, current_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>60MA 停損價</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPosModal.stop_loss_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stop_loss_price: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>風控停損條件備註</label>
                <input
                  type="text"
                  placeholder="例: 跌破 60MA 季線動態出場停泊現金"
                  value={editPosModal.stop_condition}
                  onChange={(e) => setEditPosModal({ ...editPosModal, stop_condition: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => setEditPosModal({ ...editPosModal, open: false })}
                  style={{ padding: '0.45rem 1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#FFF', fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', borderRadius: '6px', border: 'none', fontSize: '0.84rem', cursor: 'pointer'
                  }}
                >
                  確認儲存部位
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== 彈窗 4: 編輯 / 新增歷史交易流水帳 Modal ===== */}
      {editTxModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div style={{
            maxWidth: '520px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(99, 102, 241, 0.5)', borderRadius: '12px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.15rem' }}>
                {editTxModal.isNew ? '➕ 新增台股泰坦歷史交易紀錄' : '✏️ 編輯歷史流水帳明細'}
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
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>交易動作</label>
                  <select
                    value={editTxModal.action}
                    onChange={(e) => setEditTxModal({ ...editTxModal, action: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  >
                    <option value="買入">買入</option>
                    <option value="加碼">加碼</option>
                    <option value="減持">減持</option>
                    <option value="賣出">賣出 (平倉)</option>
                    <option value="投入現金">投入現金 (本金)</option>
                    <option value="提取本金">提取本金</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票代號</label>
                  <input
                    type="text"
                    placeholder="例: 3105"
                    value={editTxModal.stock_id}
                    onChange={(e) => setEditTxModal({ ...editTxModal, stock_id: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>標的名稱</label>
                  <input
                    type="text"
                    placeholder="例: 穩懋 (3105)"
                    value={editTxModal.name}
                    onChange={(e) => setEditTxModal({ ...editTxModal, name: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
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
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交價格 ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editTxModal.price}
                    onChange={(e) => setEditTxModal({ ...editTxModal, price: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>稅金手續費 (NT$)</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.tax_fee}
                    onChange={(e) => setEditTxModal({ ...editTxModal, tax_fee: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.76rem', color: '#94A3B8' }}>現金流變動 (NT$)</label>
                    <button
                      type="button"
                      onClick={() => {
                        const sh = parseInt(editTxModal.shares, 10) || 0;
                        const pr = parseFloat(editTxModal.price) || 0;
                        const fee = parseFloat(editTxModal.tax_fee) || 0;
                        if (editTxModal.action === '買入' || editTxModal.action === '加碼') {
                          setEditTxModal(prev => ({ ...prev, cash_flow_twd: String(-(sh * pr + fee)) }));
                        } else if (editTxModal.action === '賣出' || editTxModal.action === '減持') {
                          setEditTxModal(prev => ({ ...prev, cash_flow_twd: String(Math.round(sh * pr - fee)) }));
                        }
                      }}
                      style={{ background: 'none', border: 'none', color: '#38BDF8', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}
                      title="自動依股數、價格與稅費試算台幣現金流"
                    >
                      ⚡ 試算
                    </button>
                  </div>
                  <input
                    type="number"
                    step="1"
                    placeholder="負為支出, 正為入帳"
                    value={editTxModal.cash_flow_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, cash_flow_twd: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現淨損益 (選填)</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.realized_pnl_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_pnl_twd: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現報酬率 %</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editTxModal.realized_return_pct}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_return_pct: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>備註說明</label>
                <input
                  type="text"
                  placeholder="例: 法定調倉建倉、季線跌破停損等"
                  value={editTxModal.note}
                  onChange={(e) => setEditTxModal({ ...editTxModal, note: e.target.value })}
                  style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => setEditTxModal({ ...editTxModal, open: false })}
                  style={{ padding: '0.45rem 1rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '6px', color: '#FFF', fontSize: '0.84rem', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{
                    background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', borderRadius: '6px', border: 'none', fontSize: '0.84rem', cursor: 'pointer'
                  }}
                >
                  確認儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
