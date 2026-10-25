import React, { useState, useEffect, useMemo } from 'react';
import defaultTitanData from '../data/taiwan_causal_titan_data.json';
import { getCurrentUser } from '../api';

// ==========================================
// 👑 台股因果量化泰坦旗艦版 (DOE 黃金階梯 35/25/20/10/10)
// 核心架構：嚴格以「歷史進出交易流水帳 (txHistory)」為唯一真實來源 (Single Source of Truth)
// 1. 所有持股部位 100% 由歷史交易流水帳 (txHistory) 的買進/加碼/減持/賣出動態推導！
// 2. 歷史進出若無買任何股票，持股部位即為 0 檔，絕無幽靈部位脫鉤！
// 3. 所有損益（未實現、已實現、總淨利、手續費、現金）100% 由歷史流水帳動態核算！
// ==========================================

const getTaiwanTitanStorageKeys = (username) => ({
  idleCash: `tw_causal_titan_idle_cash_v2_${username}`,
  allTx: `tw_causal_titan_all_tx_v2_${username}`,
  dismissedSugg: `tw_causal_titan_dismissed_sugg_v2_${username}`
});

// 10/12 法定建倉預設交易範本 (100萬本金 × DOE 黃金階梯 35/25/20/10/10)
const TEMPLATE_1012_TRANSACTIONS = [
  {
    id: 'tx_tw_deposit_1',
    date: '2026-10-12',
    action: '投入現金',
    ticker: '-',
    stock_id: '-',
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
    shares: 603,
    price: 580.0,
    tax_fee: 498,
    cash_flow_twd: -350238,
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
    shares: 478,
    price: 522.0,
    tax_fee: 356,
    cash_flow_twd: -249872,
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
    shares: 129,
    price: 1540.0,
    tax_fee: 283,
    cash_flow_twd: -198943,
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
    shares: 330,
    price: 303.0,
    tax_fee: 142,
    cash_flow_twd: -100132,
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
    shares: 119,
    price: 840.0,
    tax_fee: 142,
    cash_flow_twd: -100102,
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

  // =========================================================================
  // 唯一的真實來源 (Single Source of Truth)：實戰歷史交易進出流水帳 (txHistory)
  // =========================================================================
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.allTx);
      if (saved) {
        let parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // 確保歷史紀錄中包含投入現金本金紀錄
          const hasDeposit = parsed.some(tx => tx.action === '投入現金' || tx.action === '初始入金' || (tx.note && tx.note.includes('入金')));
          if (!hasDeposit) {
            parsed = [TEMPLATE_1012_TRANSACTIONS[0], ...parsed];
            try { localStorage.setItem(storageKeys.allTx, JSON.stringify(parsed)); } catch {}
          }
          return parsed;
        }
      }
      // 預設為初始本金 100 萬待命 (若使用者尚未建倉則持股為 0，可隨時一鍵執行法定建倉)
      return [TEMPLATE_1012_TRANSACTIONS[0]];
    } catch {
      return [TEMPLATE_1012_TRANSACTIONS[0]];
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

  // 表格內即時修改的建議數據暫存
  const [customEdits, setCustomEdits] = useState({});

  // 持久化儲存流水帳 (唯一的狀態來源)
  useEffect(() => {
    try {
      localStorage.setItem(storageKeys.allTx, JSON.stringify(txHistory));
      localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(dismissedSuggestions));
    } catch (err) {
      console.warn('無法儲存台股泰坦流水帳:', err);
    }
  }, [txHistory, dismissedSuggestions, storageKeys]);

  // 目標階梯配置基準 (DOE 35/25/20/10/10)
  const targetAllocationConfig = useMemo(() => [
    { stock_id: '3105', name: '穩懋', role: '👑 王者先鋒 (35%)', weight_pct: 35.0, price: 512.0, stop_loss: 460.93, industry: 'PA 功率放大器 / 5G射頻王者' },
    { stock_id: '8358', name: '金居', role: '🚀 核心主力 (25%)', weight_pct: 25.0, price: 482.0, stop_loss: 458.93, industry: '高頻高速銅箔龍頭' },
    { stock_id: '3324', name: '雙鴻', role: '⚡ 動能旗艦 (20%)', weight_pct: 20.0, price: 1375.0, stop_loss: 1220.22, industry: 'AI 水冷散熱伺服器龍頭' },
    { stock_id: '1303', name: '南亞', role: '🛡️ 結構支柱 (10%)', weight_pct: 10.0, price: 320.5, stop_loss: 227.11, industry: '電子材料 / 環氧樹脂' },
    { stock_id: '3026', name: '禾伸堂', role: '🎯 爆發突破 (10%)', weight_pct: 10.0, price: 815.0, stop_loss: 703.27, industry: 'MLCC 被動元件 / 車用陶瓷' }
  ], []);

  // =========================================================================
  // 核心推導：所有持股部位 (userPositions) 100% 嚴格由歷史流水帳 (txHistory) 計算推導！
  // 歷史流水帳中沒有買股票 -> 持股部位絕對為 0！徹底杜絕脫鉤現象。
  // =========================================================================
  const userPositions = useMemo(() => {
    if (!Array.isArray(txHistory) || txHistory.length === 0) return [];

    // 依交易日期正序推算部位變化
    const sortedTx = [...txHistory].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const holdingsMap = {};

    sortedTx.forEach(tx => {
      const action = tx.action;
      const stockId = String(tx.stock_id || '').trim();
      const ticker = String(tx.ticker || '').trim();
      const name = tx.name || '';

      // 跳過純資金進出與無效代碼
      if (['投入現金', '提取本金', '入金', '出金'].includes(action) || (!stockId && !ticker) || stockId === '-') {
        return;
      }

      const key = (stockId && stockId !== '-') ? stockId : ticker;
      if (!key) return;

      if (!holdingsMap[key]) {
        holdingsMap[key] = {
          stock_id: (stockId && stockId !== '-') ? stockId : key.split('.')[0],
          ticker: (ticker && ticker !== '-') ? ticker : `${stockId}.TW`,
          name: name.replace(/\s*\(\d+\)/, '').trim(),
          shares: 0,
          totalCost: 0,
          totalFee: 0,
          firstBuyDate: tx.date || '',
          lastTxDate: tx.date || ''
        };
      }

      const h = holdingsMap[key];
      const shares = parseInt(tx.shares, 10) || 0;
      const price = parseFloat(tx.price) || 0;
      const fee = parseFloat(tx.tax_fee) || 0;

      if (action === '買入' || action === '加碼') {
        h.shares += shares;
        h.totalCost += (shares * price);
        h.totalFee += fee;
        h.lastTxDate = tx.date || h.lastTxDate;
        if (!h.firstBuyDate) h.firstBuyDate = tx.date || '';
      } else if (action === '賣出' || action === '減持') {
        if (h.shares > 0) {
          const avgCost = h.totalCost / h.shares;
          const reduceShares = Math.min(shares, h.shares);
          h.shares -= reduceShares;
          h.totalCost -= (reduceShares * avgCost);
        }
        h.lastTxDate = tx.date || h.lastTxDate;
      }
    });

    // 只有在歷史進出中「淨持有股數 > 0」的股票才會產生實戰部位！
    const activePositions = [];
    Object.keys(holdingsMap).forEach(key => {
      const h = holdingsMap[key];
      if (h.shares > 0) {
        const avgPrice = h.shares > 0 ? (h.totalCost / h.shares) : 0;
        const config = targetAllocationConfig.find(t => t.stock_id === h.stock_id || h.ticker?.includes(t.stock_id));
        const defaultPos = (data?.current_positions || []).find(p => p.stock_id === h.stock_id || p.ticker === h.ticker);

        const curPrice = defaultPos?.current_price || config?.price || avgPrice;
        const stopLossPrice = defaultPos?.stop_loss_price || config?.stop_loss || Math.round(curPrice * 0.9 * 100) / 100;
        const role = config?.role || defaultPos?.role || '💎 實盤自選持股';
        const industry = config?.industry || defaultPos?.industry || '台股前100大';
        const targetWeightPct = config?.weight_pct || 20.0;

        activePositions.push({
          id: `pos_${h.stock_id}`,
          stock_id: h.stock_id,
          ticker: h.ticker,
          stock_name: h.name,
          name: h.name,
          industry,
          role,
          target_weight_pct: targetWeightPct,
          shares: h.shares,
          entry_price: parseFloat(avgPrice.toFixed(2)),
          current_price: curPrice,
          price_date: defaultPos?.price_date || '2026-10-21',
          entry_date: h.firstBuyDate,
          entry_fee: Math.round(h.totalFee),
          stop_loss_price: stopLossPrice,
          stop_condition: `逐日監控：跌破 60MA 季線 (${stopLossPrice}元) 則動態出場`
        });
      }
    });

    return activePositions;
  }, [txHistory, targetAllocationConfig, data?.current_positions]);

  // =========================================================================
  // 損益與資金 100% 由「歷史進出 (txHistory)」核算推導！
  // =========================================================================
  // 1. 閒置現金 (TWD) - 由流水帳中所有現金流（入金、出金、買入扣款、賣出回流）動態加總推導
  const idleCash = useMemo(() => {
    return txHistory.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
  }, [txHistory]);

  // 2. 累計投入本金 (TWD) - 由流水帳中的入金項目計算
  const totalDepositsTwd = useMemo(() => {
    const sum = txHistory
      .filter(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')))
      .reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
    return sum > 0 ? sum : 1000000;
  }, [txHistory]);

  // 3. 歷史進出已實現損益與手續費統計
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

  // 4. 持股未實現損益與總市值 (依據由歷史推導出的目前持股 vs 當前市價)
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

  // 5. 當前總資產淨值 (閒置現金 + 持股市值)
  const totalNetAssetsTwd = useMemo(() => {
    return Math.max(0, idleCash + totalStockMarketValTwd);
  }, [idleCash, totalStockMarketValTwd]);

  // 6. 實盤總淨利 (已實現損益 + 未實現損益)
  const totalNetProfitTwd = useMemo(() => {
    return totalRealizedPnlTwd + unrealizedPnlTwd;
  }, [totalRealizedPnlTwd, unrealizedPnlTwd]);

  const totalNetProfitPct = useMemo(() => {
    return totalDepositsTwd > 0 ? (totalNetProfitTwd / totalDepositsTwd) * 100 : 0;
  }, [totalNetProfitTwd, totalDepositsTwd]);

  // ==========================================
  // 階梯持倉更動建議演算法 (完全對齊全球主權泰坦模式)
  // ==========================================
  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];
    const suggestions = [];
    const tolerancePct = 5.0; // DOE ±5% 容差帶

    // 1. 針對目標 5 大主力進行部位試算 (確保 5 檔皆有明確狀態：買入 / 加碼 / 減持 / 續抱)
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
          defaultPrice: target.price,
          defaultTaxFee: estFee,
          sharesDesc,
          price: target.price,
          estTaxFee: estFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos: null,
          isBalanced: false
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
          defaultPrice: target.price,
          defaultTaxFee: estFee,
          sharesDesc,
          price: target.price,
          estTaxFee: estFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos,
          isBalanced: false
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
          defaultPrice: target.price,
          defaultTaxFee: estTaxFee,
          sharesDesc,
          price: target.price,
          estTaxFee,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos,
          isBalanced: false
        });
      } else {
        // 權重在容差帶內：部位平衡無需調整，明確展示為續抱
        suggestions.push({
          key: suggKey,
          action: '續抱',
          actionColor: '#10B981',
          stock_id: target.stock_id,
          name: target.name,
          role: target.role,
          targetWeightPct: target.weight_pct,
          targetTwd,
          currentShares: heldShares,
          targetShares,
          recShares: 0,
          defaultPrice: target.price,
          defaultTaxFee: 0,
          sharesDesc: '0 股 (平衡)',
          price: target.price,
          estTaxFee: 0,
          stop_loss_price: target.stop_loss,
          industry: target.industry,
          heldPos,
          isBalanced: true
        });
      }
    });

    // 2. 針對持倉中但不在目標 5 大主力中的非策略持股提出賣出建議
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
          role: '⚠️ 跌出階梯名單',
          targetWeightPct: 0,
          targetTwd: 0,
          currentShares: exitShares,
          targetShares: 0,
          recShares: exitShares,
          defaultPrice: curPrice,
          defaultTaxFee: estTaxFee,
          sharesDesc,
          price: curPrice,
          estTaxFee,
          stop_loss_price: heldPos.stop_loss_price || 0,
          industry: heldPos.industry || '-',
          heldPos,
          isBalanced: false
        });
      }
    });

    return suggestions;
  }, [totalNetAssetsTwd, targetAllocationConfig, userPositions, dismissedSuggestions]);

  // 取得目前表格列的編輯數值
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

  // 複製單一券商下單字串
  const handleCopyOrder = (sugg) => {
    if (sugg.action === '續抱' || sugg.isBalanced) {
      triggerNotice(`ℹ️「${sugg.name}」目前持倉平衡，無須下單！`);
      return;
    }
    const rowVal = getRowValues(sugg);
    const shares = parseInt(rowVal.shares, 10) || sugg.recShares;
    const price = parseFloat(rowVal.price) || sugg.defaultPrice;
    const actionText = sugg.action === '買入' || sugg.action === '加碼' ? '現股買進' : '現股賣出';
    const text = `${sugg.stock_id} ${sugg.name} ${actionText} ${shares}股 · 委託價 $${price}`;
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已複製委託字串：${text}`);
  };

  // 複製全部建議下單字串
  const handleCopyAllOrders = () => {
    const activeLines = rebalanceSuggestions
      .filter(s => s.action !== '續抱' && !s.isBalanced && s.recShares > 0)
      .map(s => {
        const rowVal = getRowValues(s);
        const shares = parseInt(rowVal.shares, 10) || s.recShares;
        const price = parseFloat(rowVal.price) || s.defaultPrice;
        const actionText = s.action === '買入' || s.action === '加碼' ? '現股買進' : '現股賣出';
        return `${s.stock_id} ${s.name} ${actionText} ${shares}股 ($${price})`;
      });

    if (activeLines.length === 0) {
      triggerNotice('ℹ️ 目前 5 檔黃金階梯主力標的均已處於平衡容差帶內，無須發送任何調倉委託！');
      return;
    }
    const text = activeLines.join('\n');
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已成功複製 ${activeLines.length} 筆調倉委託指令！`);
  };

  // 一鍵執行單筆調倉建議 (嚴格寫入歷史進出流水帳，持股與損益自動由流水帳動態生成)
  const handleExecuteSuggestion = (sugg, isBatch = false) => {
    if (sugg.action === '續抱' || sugg.isBalanced) {
      if (!isBatch) triggerNotice(`✅「${sugg.name}」目前持倉權重已完全對齊目標，處於平衡容差帶內，請安心續抱！`);
      return;
    }

    const rowVal = getRowValues(sugg);
    const actualShares = parseInt(rowVal.shares, 10);
    const actualPrice = parseFloat(rowVal.price);
    const actualTaxFee = parseFloat(rowVal.taxFee || 0);

    if (isNaN(actualShares) || actualShares <= 0 || isNaN(actualPrice) || actualPrice <= 0) {
      if (!isBatch) alert('請填寫有效的股數與成交價格');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const grossVal = actualShares * actualPrice;

    if (sugg.action === '買入') {
      const totalCost = grossVal + actualTaxFee;
      if (idleCash < totalCost && !isBatch) {
        const proceed = window.confirm(
          `提醒：當前閒置現金 (NT$ ${Math.round(idleCash).toLocaleString()}) 小於預計買進總成本 (NT$ ${Math.round(totalCost).toLocaleString()})。\n是否依然確認建倉？(閒置現金將變為負值或需追加投入)`
        );
        if (!proceed) return;
      }

      const newTx = {
        id: `tx_buy_${Date.now()}_${sugg.stock_id}`,
        date: today,
        action: '買入',
        stock_id: sugg.stock_id,
        ticker: `${sugg.stock_id}.TW`,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -Math.round(totalCost),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `法定調倉買入建倉 (${sugg.role})`
      };

      setTxHistory(prev => [newTx, ...prev]);
      if (!isBatch) triggerNotice(`✅ 已成功【買入】${sugg.name} ${actualShares} 股！已寫入歷史進出，持股部位已自動生成。`);

    } else if (sugg.action === '加碼') {
      const totalCost = grossVal + actualTaxFee;
      const newTx = {
        id: `tx_add_${Date.now()}_${sugg.stock_id}`,
        date: today,
        action: '加碼',
        stock_id: sugg.stock_id,
        ticker: `${sugg.stock_id}.TW`,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -Math.round(totalCost),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `定期調倉加碼 (${sugg.role})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      if (!isBatch) triggerNotice(`🔵 已成功【加碼】${sugg.name} ${actualShares} 股！歷史進出已更新，平均成本已重算。`);

    } else if (sugg.action === '減持') {
      const netProceeds = grossVal - actualTaxFee;
      const heldPos = sugg.heldPos || userPositions.find(p => p.stock_id === sugg.stock_id);
      const costBasis = actualShares * (heldPos?.entry_price || actualPrice);
      const realizedPnl = netProceeds - costBasis;
      const realizedReturnPct = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;

      const newTx = {
        id: `tx_reduce_${Date.now()}_${sugg.stock_id}`,
        date: today,
        action: '減持',
        stock_id: sugg.stock_id,
        ticker: `${sugg.stock_id}.TW`,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: Math.round(netProceeds),
        realized_pnl_twd: Math.round(realizedPnl),
        realized_return_pct: Math.round(realizedReturnPct * 10) / 10,
        note: `定期調倉減持平衡 (實現損益 NT$ ${Math.round(realizedPnl).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      if (!isBatch) triggerNotice(`🟠 已成功【減持】${sugg.name} ${actualShares} 股！現金回流 NT$ ${Math.round(netProceeds).toLocaleString()}。`);

    } else if (sugg.action === '賣出') {
      const netProceeds = grossVal - actualTaxFee;
      const heldPos = sugg.heldPos || userPositions.find(p => p.stock_id === sugg.stock_id);
      const costBasis = (actualShares * (heldPos?.entry_price || actualPrice)) + (heldPos?.entry_fee || 0);
      const realizedPnl = netProceeds - costBasis;
      const realizedReturnPct = costBasis > 0 ? (realizedPnl / costBasis) * 100 : 0;

      const newTx = {
        id: `tx_exit_${Date.now()}_${sugg.stock_id}`,
        date: today,
        action: '賣出',
        stock_id: sugg.stock_id,
        ticker: `${sugg.stock_id}.TW`,
        name: `${sugg.name} (${sugg.stock_id})`,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: Math.round(netProceeds),
        realized_pnl_twd: Math.round(realizedPnl),
        realized_return_pct: Math.round(realizedReturnPct * 10) / 10,
        note: `調倉換股平倉 (實現損益 NT$ ${Math.round(realizedPnl).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      if (!isBatch) triggerNotice(`🔴 已成功【賣出平倉】${sugg.name}！現金回流 NT$ ${Math.round(netProceeds).toLocaleString()}，持股部位已清空。`);
    }
  };

  // 一鍵執行所有調倉建議
  const handleExecuteAllSuggestions = () => {
    const activeSuggestions = rebalanceSuggestions.filter(s => s.action !== '續抱' && !s.isBalanced && s.recShares > 0);
    if (activeSuggestions.length === 0) {
      triggerNotice('ℹ️ 目前 5 檔黃金階梯主力標的均已處於平衡狀態，無須執行任何調倉！');
      return;
    }
    if (!window.confirm(`確定要一次性執行共 ${activeSuggestions.length} 檔調倉更動嗎？\n系統將自動在歷史進出流水帳中寫入交易紀錄，持股部位與損益將自動精確生成。`)) return;

    activeSuggestions.forEach(s => handleExecuteSuggestion(s, true));
    triggerNotice(`⚡ 已成功批次執行 ${activeSuggestions.length} 項調倉指令！歷史進出與實戰持股已全面同步。`);
  };

  // 暫時收起忽略建議
  const handleDismissSuggestion = (key) => {
    setDismissedSuggestions(prev => [...prev, key]);
    triggerNotice('👁️ 已暫時隱藏此調倉建議');
  };

  // ==========================================
  // 便捷範本載入與持股清空操作
  // ==========================================
  // 1. 一鍵載入 10/12 法定開倉交易明細
  const handleLoadDefault1012Positions = () => {
    if (window.confirm('確定要載入 2026-10-12 法定建倉 5 筆交易紀錄嗎？\n這將自動在歷史進出中寫入穩懋、金居、雙鴻、南亞、禾伸堂的買進明細。')) {
      setTxHistory(TEMPLATE_1012_TRANSACTIONS);
      setDismissedSuggestions([]);
      triggerNotice('⚡ 已成功寫入 10/12 法定建倉交易明細！實戰部位與損益已即時生成。');
    }
  };

  // 2. 清空所有股票買入 (僅保留現金本金)
  const handleClearAllStockPositions = () => {
    if (window.confirm('確定要清空歷史進出中所有股票買賣紀錄嗎？\n（將只保留 100 萬入金本金，持股部位將隨即歸零）')) {
      const depositTx = txHistory.find(tx => tx.action === '投入現金' || tx.action === '初始入金') || TEMPLATE_1012_TRANSACTIONS[0];
      setTxHistory([depositTx]);
      setDismissedSuggestions([]);
      triggerNotice('🧹 已清空歷史進出中之所有股票買賣！當前持股已完全歸零，資金 100% 待命。');
    }
  };

  // ==========================================
  // 彈窗交互狀態 (Modal States)
  // ==========================================
  // 1. 現金存入與校準彈窗
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashActionType, setCashActionType] = useState('deposit');
  const [cashInputAmount, setCashInputAmount] = useState('');

  const handleSaveCashChange = (e) => {
    e.preventDefault();
    const val = parseFloat(cashInputAmount);
    if (isNaN(val) || val <= 0) {
      alert('請輸入有效金額');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (cashActionType === 'deposit') {
      const newTx = {
        id: `tx_deposit_${Date.now()}`,
        date: today,
        action: '投入現金',
        ticker: '-',
        stock_id: '-',
        name: '手動追加存入本金',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: Math.round(val),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `追加存入資金 NT$ ${Math.round(val).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💵 已成功存入 NT$ ${Math.round(val).toLocaleString()}！閒置資金已增加。`);
    } else {
      const diff = val - idleCash;
      const newTx = {
        id: `tx_adjust_${Date.now()}`,
        date: today,
        action: diff >= 0 ? '投入現金' : '提取本金',
        ticker: '-',
        stock_id: '-',
        name: '直接校準閒置現金總額',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: Math.round(diff),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動校準閒置現金至 NT$ ${Math.round(val).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💵 已校準閒置現金為 NT$ ${Math.round(val).toLocaleString()}！`);
    }

    setCashModalOpen(false);
    setCashInputAmount('');
  };

  // 2. 持股手動出場平倉彈窗
  const [exitModal, setExitModal] = useState({
    open: false,
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

    setTxHistory(prev => [newTx, ...prev]);
    triggerNotice(`🚪 已結利/停損平倉「${exitModal.name}」！歷史進出已記入已實現損益 NT$ ${Math.round(netPnl).toLocaleString()}，持股部位已自動結清。`);
    setExitModal({ ...exitModal, open: false });
  };

  // 3. 編輯/新增持股部位彈窗 (直接操作歷史流水帳 txHistory)
  const [editPosModal, setEditPosModal] = useState({
    open: false,
    isNew: false,
    stock_id: '',
    stock_name: '',
    industry: '',
    role: '👑 王者先鋒 (35%)',
    shares: '',
    entry_price: '',
    current_price: '',
    entry_fee: '0',
    entry_date: new Date().toISOString().split('T')[0],
    stop_loss_price: '',
    stop_condition: ''
  });

  const handleOpenEditPos = (pos) => {
    setEditPosModal({
      open: true,
      isNew: false,
      stock_id: pos.stock_id,
      stock_name: pos.stock_name || pos.name,
      industry: pos.industry || '',
      role: pos.role || '👑 王者先鋒 (35%)',
      shares: String(pos.shares),
      entry_price: String(pos.entry_price),
      current_price: String(pos.current_price || pos.entry_price),
      entry_fee: String(pos.entry_fee || '0'),
      entry_date: pos.entry_date || new Date().toISOString().split('T')[0],
      stop_loss_price: String(pos.stop_loss_price || ''),
      stop_condition: pos.stop_condition || ''
    });
  };

  const handleOpenNewPos = () => {
    setEditPosModal({
      open: true,
      isNew: true,
      stock_id: '',
      stock_name: '',
      industry: '',
      role: '👑 王者先鋒 (35%)',
      shares: '1000',
      entry_price: '100',
      current_price: '100',
      entry_fee: '143',
      entry_date: new Date().toISOString().split('T')[0],
      stop_loss_price: '90',
      stop_condition: '跌破季線停損'
    });
  };

  const handleSavePosition = (e) => {
    e.preventDefault();
    const sharesNum = parseInt(editPosModal.shares, 10) || 0;
    const entryPx = parseFloat(editPosModal.entry_price) || 0;
    const fee = parseFloat(editPosModal.entry_fee) || 0;

    if (editPosModal.isNew) {
      // 新增持股：直接在 txHistory 寫入買進紀錄
      const costTwd = Math.round(sharesNum * entryPx + fee);
      const newTx = {
        id: `tx_buy_${Date.now()}`,
        date: editPosModal.entry_date,
        action: '買入',
        ticker: `${editPosModal.stock_id}.TW`,
        stock_id: editPosModal.stock_id,
        name: `${editPosModal.stock_name} (${editPosModal.stock_id})`,
        shares: sharesNum,
        price: entryPx,
        tax_fee: fee,
        cash_flow_twd: -costTwd,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動新增建倉 (${editPosModal.role})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`➕ 已在歷史進出寫入買進「${editPosModal.stock_name}」，持股部位已自動生成！`);
    } else {
      // 編輯持股：同步更新 txHistory 中該標的之買進紀錄
      setTxHistory(prev => {
        let updated = false;
        return prev.map(tx => {
          if (!updated && (tx.action === '買入' || tx.action === '加碼') && (tx.stock_id === editPosModal.stock_id || tx.ticker?.includes(editPosModal.stock_id))) {
            updated = true;
            const costTwd = Math.round(sharesNum * entryPx + fee);
            return {
              ...tx,
              date: editPosModal.entry_date,
              shares: sharesNum,
              price: entryPx,
              tax_fee: fee,
              cash_flow_twd: -costTwd
            };
          }
          return tx;
        });
      });
      triggerNotice(`✏️ 已同步更新「${editPosModal.stock_name}」歷史進出流水帳，持股均價與股數已動態重算！`);
    }
    setEditPosModal({ ...editPosModal, open: false });
  };

  const handleDeletePos = (pos) => {
    if (window.confirm(`確定要刪除「${pos.stock_name || pos.name}」部位嗎？\n\n系統將自歷史進出流水帳中移除該標的之買進紀錄，持股部位將隨即清空。`)) {
      setTxHistory(prev => prev.filter(t => t.stock_id !== pos.stock_id && t.ticker !== pos.ticker && !t.name?.includes(pos.stock_id)));
      triggerNotice(`🗑️ 已自歷史進出移除「${pos.stock_name || pos.name}」，持股部位已同步清空！`);
    }
  };

  // 4. 歷史流水帳編輯與手動新增
  const [editTxModal, setEditTxModal] = useState({
    open: false,
    isNew: false,
    id: '',
    date: new Date().toISOString().split('T')[0],
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
      date: tx.date,
      action: tx.action,
      stock_id: tx.stock_id || '',
      name: tx.name,
      shares: String(tx.shares || '0'),
      price: String(tx.price || '0'),
      tax_fee: String(tx.tax_fee || '0'),
      cash_flow_twd: String(tx.cash_flow_twd || '0'),
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
      stock_id: '',
      name: '',
      shares: '1000',
      price: '100',
      tax_fee: '143',
      cash_flow_twd: '-100143',
      realized_pnl_twd: '',
      realized_return_pct: '',
      note: '手動記錄交易'
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
      triggerNotice('➕ 已成功新增歷史交易流水帳！持股部位已自動重算。');
    } else {
      setTxHistory(prev => prev.map(t => t.id === updated.id ? updated : t));
      triggerNotice('✏️ 已更新歷史交易紀錄！持股均價與未實現損益已自動連動。');
    }

    setEditTxModal({ ...editTxModal, open: false });
  };

  const handleDeleteTx = (id, name, action) => {
    if (window.confirm(`確定要刪除「${action} ${name}」這筆交易流水帳嗎？\n刪除後，當前持股部位與損益將自動依據剩餘流水帳動態重算。`)) {
      setTxHistory(prev => prev.filter(t => t.id !== id));
      triggerNotice(`🗑️ 已刪除該筆流水帳紀錄！持股與損益已即時重算。`);
    }
  };

  // 匯出 JSON 備份
  const handleExportBackup = () => {
    const payload = {
      version: 'tw_causal_titan_v3_pure_ledger',
      export_date: new Date().toISOString(),
      user: currentUsername,
      tx_history: txHistory,
      dismissed_suggestions: dismissedSuggestions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `taiwan_causal_titan_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerNotice('📥 台股泰坦帳本 JSON 備份檔已成功匯出！');
  };

  // 匯入 JSON 備份
  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (Array.isArray(imported.tx_history)) {
          setTxHistory(imported.tx_history);
          if (Array.isArray(imported.dismissed_suggestions)) setDismissedSuggestions(imported.dismissed_suggestions);
          triggerNotice(`📥 已成功匯入備份！共 ${imported.tx_history.length} 筆流水帳，持股部位已自動生成。`);
        } else {
          alert('備份格式不正確，需包含 tx_history 陣列');
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
      t.realized_pnl_twd !== null && t.realized_pnl_twd !== undefined ? t.realized_pnl_twd : '',
      t.realized_return_pct !== null && t.realized_return_pct !== undefined ? t.realized_return_pct : '',
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

  // 匯出回測 1,290 筆交易 CSV
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

  // 計算歷年交易勝率統計 (按年度分組 trades)
  const yearlyTradeStats = useMemo(() => {
    const map = {};
    if (Array.isArray(trades)) {
      trades.forEach(t => {
        const year = String(t.entry_date).slice(0, 4);
        if (!map[year]) {
          map[year] = { count: 0, wins: 0, best: null, totalRet: 0 };
        }
        map[year].count += 1;
        const ret = Number(t.return_pct) || 0;
        map[year].totalRet += ret;
        if (ret > 0) map[year].wins += 1;
        if (!map[year].best || ret > (map[year].best.return_pct || -999)) {
          map[year].best = t;
        }
      });
    }
    return map;
  }, [trades]);

  // 曲線 SVG 點計算
  const svgCurveData = useMemo(() => {
    if (!curve || curve.length === 0) return { pathStrat: '', pathTx: '', width: 850, height: 280 };
    const width = 850;
    const height = 280;
    const padX = 60;
    const padY = 30;
    const drawW = width - padX - 20;
    const drawH = height - padY * 2;

    const minLog = 0; // Log10(1) = 0
    const maxLog = 3.35; // Log10(2238) ≈ 3.35

    const pointsStrat = curve.map((pt, idx) => {
      const x = padX + (idx / (curve.length - 1)) * drawW;
      const logVal = Math.log10(Math.max(1, pt.strategy));
      const normY = (logVal - minLog) / (maxLog - minLog);
      const y = height - padY - (normY * drawH);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

    const pointsTx = curve.map((pt, idx) => {
      const x = padX + (idx / (curve.length - 1)) * drawW;
      const logVal = Math.log10(Math.max(1, pt.taiex));
      const normY = (logVal - minLog) / (maxLog - minLog);
      const y = height - padY - (normY * drawH);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

    return { pathStrat: pointsStrat, pathTx: pointsTx, width, height };
  }, [curve]);

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '1rem', color: '#F8FAFC' }}>
      {/* 浮動通知 Toast */}
      {feedbackMsg && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 999999,
          background: 'linear-gradient(135deg, #10B981, #059669)',
          color: '#FFF',
          padding: '0.8rem 1.4rem',
          borderRadius: '8px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
          fontSize: '0.9rem',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem'
        }}>
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* ===== 頂部策略橫幅 ===== */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.4)',
        borderRadius: '16px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.4)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#000',
                fontWeight: '900',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.78rem'
              }}>
                👑 DOE 終極尋優版
              </span>
              <h2 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 'bold', color: '#F8FAFC' }}>
                👑 台股因果量化泰坦旗艦版 【上限：1億】
              </h2>
            </div>
            <p style={{ margin: '0.5rem 0 0 0', color: '#94A3B8', fontSize: '0.86rem' }}>
              市值前 100 大滾動池 · 每月 11 號法定公告日建倉 · 4 大真因果 Alpha 因子 · 60MA 季線動態風控停損 · <strong>以歷史交易進出流水帳為唯一真實來源</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              padding: '0.4rem 0.8rem',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#94A3B8' }}>調倉週期：</span>
              <strong style={{ color: '#FDE68A' }}>每月 11 號 (T+1開盤建倉)</strong>
            </div>
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              padding: '0.4rem 0.8rem',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#94A3B8' }}>下次調倉：</span>
              <strong style={{ color: '#60A5FA' }}>2026-11-11</strong>
            </div>
            <div style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: '8px',
              padding: '0.4rem 0.8rem',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#6EE7B7' }}>最新行情日期：</span>
              <strong style={{ color: '#34D399' }}>2026-10-21</strong>
            </div>
          </div>
        </div>

        {/* 策略核心 KPI 方塊 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '0.8rem',
          marginTop: '1.2rem',
          paddingTop: '1.2rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>22年回測倍數</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace' }}>2,053.38x</div>
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>年化報酬率 CAGR</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+42.58%</div>
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>夏普比率 Sharpe</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>1.13</div>
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>最大回撤 MDD</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F472B6', fontFamily: 'monospace' }}>-35.30%</div>
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>卡瑪比率 Calmar</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#C084FC', fontFamily: 'monospace' }}>1.21</div>
          </div>
          <div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>年度勝率 (贏大盤)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>86.4% (19/22)</div>
          </div>
        </div>
      </div>

      {/* ===== 第二行：5 個帳戶資產數據方塊 (100% 由歷史進出 txHistory 即時推導) ===== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: '0.9rem',
        marginBottom: '1.5rem'
      }}>
        {/* 1. 總資產淨值 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          padding: '1.1rem'
        }}>
          <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.3rem' }}>總資產淨值 (TWD)</div>
          <div style={{ fontSize: '1.55rem', fontWeight: 'bold', color: '#F8FAFC', fontFamily: 'monospace' }}>
            NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.3rem' }}>
            本金 NT$ {Math.round(totalDepositsTwd).toLocaleString()}
          </div>
        </div>

        {/* 2. 閒置資金 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '12px',
          padding: '1.1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', color: '#94A3B8' }}>閒置現金 (TWD)</span>
            <button
              onClick={() => { setCashInputAmount(''); setCashModalOpen(true); }}
              style={{
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid #F59E0B',
                color: '#FDE68A',
                borderRadius: '4px',
                fontSize: '0.72rem',
                padding: '0.15rem 0.4rem',
                cursor: 'pointer'
              }}
            >
              💵 調整資金
            </button>
          </div>
          <div style={{ fontSize: '1.55rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace', marginTop: '0.3rem' }}>
            NT$ {Math.round(idleCash).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.3rem' }}>
            佔比 {totalNetAssetsTwd > 0 ? ((idleCash / totalNetAssetsTwd) * 100).toFixed(1) : 0}% · 待命中
          </div>
        </div>

        {/* 3. 持股市值 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '12px',
          padding: '1.1rem'
        }}>
          <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.3rem' }}>持股現值 (TWD)</div>
          <div style={{ fontSize: '1.55rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>
            NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.3rem' }}>
            共 {userPositions.length} 檔持股 · 佔比 {totalNetAssetsTwd > 0 ? ((totalStockMarketValTwd / totalNetAssetsTwd) * 100).toFixed(1) : 0}%
          </div>
        </div>

        {/* 4. 未實現損益 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          padding: '1.1rem'
        }}>
          <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.3rem' }}>未實現損益 (現持股)</div>
          <div style={{
            fontSize: '1.55rem',
            fontWeight: 'bold',
            color: unrealizedPnlTwd >= 0 ? '#34D399' : '#F87171',
            fontFamily: 'monospace'
          }}>
            {unrealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(unrealizedPnlTwd).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: unrealizedReturnPct >= 0 ? '#34D399' : '#F87171', marginTop: '0.3rem', fontWeight: 'bold' }}>
            {unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}% (成本 NT$ {Math.round(totalCostTwd).toLocaleString()})
          </div>
        </div>

        {/* 5. 實盤總淨利 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          borderRadius: '12px',
          padding: '1.1rem'
        }}>
          <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.3rem' }}>實盤總淨利 (含已實現)</div>
          <div style={{
            fontSize: '1.55rem',
            fontWeight: 'bold',
            color: totalNetProfitTwd >= 0 ? '#34D399' : '#F87171',
            fontFamily: 'monospace'
          }}>
            {totalNetProfitTwd >= 0 ? '+' : ''}NT$ {Math.round(totalNetProfitTwd).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.72rem', color: totalNetProfitPct >= 0 ? '#34D399' : '#F87171', marginTop: '0.3rem', fontWeight: 'bold' }}>
            淨投報率 {totalNetProfitPct >= 0 ? '+' : ''}{totalNetProfitPct.toFixed(2)}%
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
          { id: 'trades', label: '📋 回測歷史全交易紀錄 (1,290筆)' },
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

          {/* 1. 每月 11 號法定調倉窗口 · 階梯更動建議試算器 (完全對齊全球主權泰坦模式) */}
          <div className="glass-card" style={{
            padding: '1.2rem',
            borderTop: '3px solid #F59E0B',
            background: 'rgba(245, 158, 11, 0.04)',
            borderRadius: '12px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔄 每月 11 號法定調倉窗口 · 階梯更動建議試算器
                </h4>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  依據總淨資產 (NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}) 與 DOE 黃金階梯基準 (35% / 25% / 20% / 10% / 10%) 即時比對偏差。全台股前 100 大市值池，次月法定調倉窗口：<strong>2026-11-11</strong>。
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleCopyAllOrders}
                  style={{
                    background: 'rgba(245, 158, 11, 0.2)',
                    border: '1px solid #F59E0B',
                    color: '#FDE68A',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '5px',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  title="一鍵複製所有調倉委託指令"
                >
                  📋 一鍵複製調倉委託
                </button>

                <button
                  type="button"
                  onClick={handleExecuteAllSuggestions}
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    border: 'none',
                    color: '#FFF',
                    padding: '0.35rem 0.85rem',
                    borderRadius: '5px',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  title="一鍵執行所有需要調整的調倉建議"
                >
                  ⚡ 一鍵執行所有調倉
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

            {/* 階梯更動建議表格 (完全對齊全球主權泰坦模式) */}
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
                    <th style={{ textAlign: 'center', width: '130px' }}>執行確認</th>
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
                    } else if (sugg.action === '減持' || sugg.action === '賣出') {
                      cashDiffTwd = (sharesNum * priceNum - feeNum);
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
                            {sugg.stock_id} | <span style={{ color: '#FBBF24' }}>{sugg.role}</span>
                          </div>
                        </td>

                        {/* 目標配置 */}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ color: '#CBD5E1', fontWeight: 'bold' }}>{sugg.targetWeightPct}%</div>
                          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            NT$ {Math.round(sugg.targetTwd).toLocaleString()}
                          </div>
                        </td>

                        {/* 目前股數 */}
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                          {sugg.currentShares.toLocaleString()} 股
                        </td>

                        {/* 建議更動股數 */}
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: sugg.action === '續抱' ? '#34D399' : '#67E8F9' }}>
                          {sugg.action === '續抱' ? '0 股 (平衡)' : (sugg.action === '加碼' ? `+${sugg.recShares}` : (sugg.action === '減持' ? `-${sugg.recShares}` : `${sugg.recShares}`)) + ' 股'}
                        </td>

                        {/* 實際股數 Input */}
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            value={rowVal.shares}
                            onChange={(e) => handleUpdateRowInput(sugg.key, 'shares', e.target.value)}
                            disabled={sugg.action === '續抱'}
                            style={{
                              width: '85px',
                              padding: '0.3rem 0.4rem',
                              borderRadius: '4px',
                              background: sugg.action === '續抱' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
                              border: sugg.action === '續抱' ? '1px solid rgba(255,255,255,0.1)' : '1px solid #38BDF8',
                              color: sugg.action === '續抱' ? '#94A3B8' : '#38BDF8',
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
                            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>$</span>
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

                        {/* 預估手續費/稅費 */}
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '0.76rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            ${feeNum.toLocaleString()}
                          </span>
                        </td>

                        {/* 預估現金變動 */}
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: cashDiffTwd > 0 ? '#34D399' : (cashDiffTwd < 0 ? '#F87171' : '#94A3B8') }}>
                          {cashDiffTwd > 0 ? `+NT$ ${Math.round(cashDiffTwd).toLocaleString()}` : (cashDiffTwd < 0 ? `-NT$ ${Math.round(Math.abs(cashDiffTwd)).toLocaleString()}` : 'NT$ 0')}
                        </td>

                        {/* 執行確認操作列 */}
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                            {sugg.action === '續抱' ? (
                              <span style={{ color: '#10B981', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                ✓ 部位平衡
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleExecuteSuggestion(sugg)}
                                  style={{
                                    background: 'linear-gradient(135deg, #10B981, #059669)',
                                    color: '#FFF',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.3rem 0.55rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                  }}
                                  title="執行成交：自動在歷史進出寫入真實交易紀錄，部位與損益隨即生成"
                                >
                                  ⚡ 執行
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyOrder(sugg)}
                                  style={{
                                    background: 'rgba(255,255,255,0.08)',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    color: '#CBD5E1',
                                    borderRadius: '4px',
                                    padding: '0.3rem 0.45rem',
                                    fontSize: '0.72rem',
                                    cursor: 'pointer'
                                  }}
                                  title="複製券商下單字串"
                                >
                                  📋
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDismissSuggestion(sugg.key)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#64748B',
                                    fontSize: '0.75rem',
                                    cursor: 'pointer',
                                    padding: '0.2rem'
                                  }}
                                  title="暫時隱藏"
                                >
                                  👁️
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. 當前實盤持股部位清單 (100% 嚴格由歷史流水帳 txHistory 動態推導) */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: '12px',
            padding: '1.2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#60A5FA', fontSize: '1.15rem' }}>
                  📊 當前實戰持股部位管理 (100% 由下方歷史進出推導 · 60MA 風控監控)
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#94A3B8' }}>
                  持股部位與成本均價完全取決於歷史進出流水帳！若歷史未買入任何股票，持倉即為 0。
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleLoadDefault1012Positions}
                  style={{
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid #10B981',
                    color: '#6EE7B7',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  title="將 10/12 法定開倉 5 筆交易寫入歷史進出"
                >
                  ⚡ 載入 10/12 建倉
                </button>
                <button
                  onClick={handleClearAllStockPositions}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#FCA5A5',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    cursor: 'pointer'
                  }}
                  title="清空歷史進出中之所有股票買賣，僅留現金本金"
                >
                  🧹 清空股票持倉
                </button>
                <button
                  onClick={handleOpenNewPos}
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid #3B82F6',
                    color: '#93C5FD',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ➕ 新增持股部位
                </button>
                <button
                  onClick={handleExportBackup}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#CBD5E1',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    cursor: 'pointer'
                  }}
                  title="將流水帳完整匯出備份 JSON"
                >
                  💾 匯出備份
                </button>
                <label style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#CBD5E1',
                  padding: '0.35rem 0.65rem',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  cursor: 'pointer'
                }}>
                  📂 匯入備份
                  <input type="file" accept=".json" onChange={handleImportBackup} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            {/* 持股部位表格 (100% 依據歷史進出動態呈現) */}
            {userPositions.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '8px',
                border: '1px dashed rgba(255,255,255,0.15)'
              }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>📭</div>
                <strong style={{ fontSize: '1rem', color: '#CBD5E1' }}>歷史進出中目前尚無未平倉股票</strong>
                <div style={{ fontSize: '0.82rem', color: '#94A3B8', marginTop: '0.4rem', maxWidth: '560px', margin: '0.4rem auto 1.2rem auto', lineHeight: '1.6' }}>
                  系統已切換為「歷史進出流水帳唯一來源」模式。因歷史流水帳中尚未買進股票，故目前真實持倉為 <strong>0 檔</strong>，資金 <strong>100% 待命</strong>。
                  您可至上方「階梯更動建議試算器」點擊<strong>「⚡ 一鍵執行所有調倉」</strong>建立持倉，或點擊下方按鈕載入 10/12 法定建倉交易。
                </div>
                <button
                  onClick={handleLoadDefault1012Positions}
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#FFF',
                    border: 'none',
                    padding: '0.5rem 1.3rem',
                    borderRadius: '6px',
                    fontSize: '0.86rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ⚡ 一鍵載入 10/12 法定建倉交易明細
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                      <th style={{ padding: '0.65rem 0.5rem' }}>標的名稱</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>配置角色</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>持有股數</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>成本均價</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>最新現價</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>帳面市值</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>未實現損益</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>60MA季線停損</th>
                      <th style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userPositions.map(pos => {
                      const curPrice = pos.current_price || pos.entry_price || 0;
                      const marketVal = pos.shares * curPrice;
                      const costBasis = (pos.shares * pos.entry_price) + (pos.entry_fee || 0);
                      const pnl = marketVal - costBasis;
                      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
                      const stopLossPrice = pos.stop_loss_price || 0;
                      const distToStopPct = stopLossPrice > 0 && curPrice > 0 ? ((curPrice - stopLossPrice) / curPrice) * 100 : 0;
                      const isDanger = curPrice <= stopLossPrice;

                      return (
                        <tr key={pos.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', background: isDanger ? 'rgba(239, 68, 68, 0.1)' : 'transparent' }}>
                          <td style={{ padding: '0.65rem 0.5rem' }}>
                            <strong style={{ color: '#F8FAFC' }}>{pos.stock_name || pos.name}</strong>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                              {pos.stock_id || pos.ticker} · {pos.industry || '台股前100大'}
                            </div>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem' }}>
                            <span style={{
                              background: 'rgba(59, 130, 246, 0.2)',
                              color: '#93C5FD',
                              padding: '0.2rem 0.45rem',
                              borderRadius: '4px',
                              fontSize: '0.74rem',
                              fontWeight: 'bold'
                            }}>
                              {pos.role}
                            </span>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>
                            {pos.shares.toLocaleString()} 股
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                            ${pos.entry_price}
                            <div style={{ fontSize: '0.7rem', color: '#64748B' }}>建倉: {pos.entry_date || '2026-10-12'}</div>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FDE68A' }}>
                            ${curPrice}
                            <div style={{ fontSize: '0.7rem', color: '#64748B' }}>{pos.price_date || '2026-10-21'}</div>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>
                            NT$ {Math.round(marketVal).toLocaleString()}
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                            <div style={{ color: pnl >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                              {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: pnl >= 0 ? '#34D399' : '#F87171' }}>
                              {pnl >= 0 ? '+' : ''}NT$ {Math.round(pnl).toLocaleString()}
                            </div>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                            <div style={{ color: isDanger ? '#EF4444' : '#CBD5E1', fontWeight: isDanger ? 'bold' : 'normal' }}>
                              ${stopLossPrice.toFixed(1)}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: isDanger ? '#EF4444' : (distToStopPct < 5 ? '#FBBF24' : '#34D399') }}>
                              {isDanger ? '⚠️ 跌破停損' : `距季線 +${distToStopPct.toFixed(1)}%`}
                            </div>
                          </td>

                          <td style={{ padding: '0.65rem 0.5rem', textAlign: 'center' }}>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.35rem' }}>
                              <button
                                onClick={() => handleOpenEditPos(pos)}
                                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '0.85rem' }}
                                title="編輯流水帳中此標的之買進紀錄"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleOpenExitModal(pos)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.2)',
                                  border: '1px solid rgba(239, 68, 68, 0.4)',
                                  color: '#F87171',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                  fontWeight: 'bold'
                                }}
                                title="手動平倉出場：在歷史進出寫入賣出並計算已實現損益"
                              >
                                🚪 出場
                              </button>
                              <button
                                onClick={() => handleDeletePos(pos)}
                                style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: '0.85rem' }}
                                title="自歷史進出移除該標的之買進紀錄"
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
            )}
          </div>

          {/* 3. 歷史交易進出流水帳 (唯一真實來源 - 損益與部位以此為準) */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '1.2rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.15rem' }}>
                  📋 實戰交易全歷史進出流水帳 (唯一真實來源 · 損益與持倉以此為準)
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#94A3B8' }}>
                  共記錄 <strong style={{ color: '#FDE68A' }}>{txHistory.length}</strong> 筆交易，累計實現損益 NT$ <strong style={{ color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedPnlTwd >= 0 ? '+' : ''}{Math.round(totalRealizedPnlTwd).toLocaleString()}</strong>，累計交易稅費 NT$ {Math.round(totalTaxesPaidTwd).toLocaleString()}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleOpenNewTx}
                  style={{
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid #3B82F6',
                    color: '#93C5FD',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  ➕ 記一筆交易
                </button>
                <button
                  onClick={handleExportTxCsv}
                  style={{
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid #10B981',
                    color: '#6EE7B7',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  📥 匯出流水帳 CSV
                </button>
              </div>
            </div>

            {/* 流水帳明細表格 */}
            <div style={{ overflowX: 'auto', maxHeight: '420px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#1E293B', zIndex: 2 }}>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                    <th style={{ padding: '0.6rem 0.5rem' }}>交易日期</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>動作</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>標的代碼/名稱</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>成交股數</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>成交單價</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>稅金手續費</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>現金流變動</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>已實現損益</th>
                    <th style={{ padding: '0.6rem 0.5rem' }}>備註</th>
                    <th style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {txHistory.map(tx => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.6rem 0.5rem', fontFamily: 'monospace' }}>{tx.date}</td>
                      <td style={{ padding: '0.6rem 0.5rem' }}>
                        <span style={{
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 'bold',
                          background: tx.action === '買入' || tx.action === '投入現金' ? 'rgba(16, 185, 129, 0.2)' : (tx.action === '加碼' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(239, 68, 68, 0.2)'),
                          color: tx.action === '買入' || tx.action === '投入現金' ? '#34D399' : (tx.action === '加碼' ? '#38BDF8' : '#F87171')
                        }}>
                          {tx.action}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', fontWeight: 'bold' }}>{tx.name || tx.stock_id}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                        {tx.shares > 0 ? `${tx.shares.toLocaleString()} 股` : '-'}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                        {tx.price > 0 ? `$${tx.price}` : '-'}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {tx.tax_fee > 0 ? `$${tx.tax_fee}` : '-'}
                      </td>
                      <td style={{
                        padding: '0.6rem 0.5rem',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontWeight: 'bold',
                        color: tx.cash_flow_twd >= 0 ? '#34D399' : '#F87171'
                      }}>
                        {tx.cash_flow_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.cash_flow_twd).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                        {tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined ? (
                          <span style={{ color: tx.realized_pnl_twd >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {tx.realized_pnl_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.realized_pnl_twd).toLocaleString()} ({tx.realized_return_pct >= 0 ? '+' : ''}{tx.realized_return_pct}%)
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '0.6rem 0.5rem', fontSize: '0.74rem', color: '#94A3B8' }}>{tx.note}</td>
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.3rem' }}>
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

          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${svgCurveData.width} ${svgCurveData.height}`} style={{ width: '100%', maxHeight: '420px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
              <line x1="60" y1="20" x2="830" y2="20" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="80" x2="830" y2="80" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="150" x2="830" y2="150" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="220" x2="830" y2="220" stroke="rgba(255,255,255,0.08)" strokeDasharray="4" />
              <line x1="60" y1="250" x2="830" y2="250" stroke="rgba(255,255,255,0.15)" />

              <text x="15" y="25" fill="#F59E0B" fontSize="10" fontFamily="monospace">2000x</text>
              <text x="15" y="85" fill="#94A3B8" fontSize="10" fontFamily="monospace">100x</text>
              <text x="15" y="155" fill="#94A3B8" fontSize="10" fontFamily="monospace">10x</text>
              <text x="15" y="250" fill="#94A3B8" fontSize="10" fontFamily="monospace">1.0x</text>

              <text x="70" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2005</text>
              <text x="240" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2010</text>
              <text x="420" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2015</text>
              <text x="610" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2020</text>
              <text x="800" y="270" fill="#64748B" fontSize="10" fontFamily="monospace">2026</text>

              <path d={svgCurveData.pathTx} fill="none" stroke="#64748B" strokeWidth="1.8" />
              <path d={svgCurveData.pathStrat} fill="none" stroke="#F59E0B" strokeWidth="2.8" strokeLinecap="round" />
            </svg>
          </div>

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
          {/* 頂部歷年總結卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #F59E0B' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>22年累積總倍數</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace' }}>2,053.38x</div>
              <div style={{ fontSize: '0.72rem', color: '#34D399', marginTop: '0.2rem' }}>大盤 7.72x (超越大盤 266 倍)</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #10B981' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>年化複合報酬率 (CAGR)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+42.58%</div>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.2rem' }}>大盤 10.02% (Alpha +32.56%)</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #38BDF8' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>年度勝率 (贏大盤年份)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>86.4%</div>
              <div style={{ fontSize: '0.72rem', color: '#67E8F9', marginTop: '0.2rem' }}>22 年中 19 年完勝大盤 (僅輸3年)</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #A855F7' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>正報酬年份比率</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#C084FC', fontFamily: 'monospace' }}>81.8%</div>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.2rem' }}>22 年中 18 年實現正報酬獲利</div>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #EC4899' }}>
              <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>22年回測交易總勝率</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#F472B6', fontFamily: 'monospace' }}>58.53%</div>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: '0.2rem' }}>全歷史共 1,290 筆真實撮合進出</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.2rem' }}>
                🏆 2005 - 2026 歷年年度績效與個股實戰勝率對比 (22 年勝率 86.4%)
              </h4>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94A3B8' }}>
                每年嚴格遵循法定營收公告日次日 T+1 開盤建倉 + 60MA 季線動態風控停損
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.15)', color: '#94A3B8' }}>
                  <th style={{ padding: '0.7rem 0.6rem' }}>年度</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>策略報酬率</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>加權大盤報酬</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>超額 Alpha</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>年度勝負</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>該年個股勝率</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>該年最強飆股</th>
                  <th style={{ padding: '0.7rem 0.6rem' }}>績效條狀圖</th>
                </tr>
              </thead>
              <tbody>
                {yearly_stats.map(y => {
                  const retPct = Number(y.strategy_ret ?? y.return_pct ?? 0);
                  const taiexPct = Number(y.taiex_ret ?? y.taiex_pct ?? 0);
                  const alpha = Number(y.alpha ?? (retPct - taiexPct));
                  const isWin = y.is_positive !== undefined ? y.is_positive : (retPct > taiexPct);
                  const tStat = yearlyTradeStats[String(y.year)];

                  return (
                    <tr key={y.year} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                        {y.year}
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', fontWeight: 'bold', color: retPct >= 0 ? '#34D399' : '#F87171' }}>
                        {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {taiexPct >= 0 ? '+' : ''}{taiexPct.toFixed(1)}%
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
                          {isWin ? '🏆 完勝大盤' : '落後大盤'}
                        </span>
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontFamily: 'monospace' }}>
                        {tStat ? (
                          <span style={{ color: (tStat.wins / tStat.count) >= 0.5 ? '#34D399' : '#FBBF24' }}>
                            {((tStat.wins / tStat.count) * 100).toFixed(1)}% <span style={{ color: '#64748B', fontSize: '0.72rem' }}>({tStat.wins}/{tStat.count})</span>
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem', fontSize: '0.78rem' }}>
                        {tStat?.best ? (
                          <span style={{ color: '#FDE68A' }}>
                            {tStat.best.stock_name} <strong style={{ color: '#34D399', fontFamily: 'monospace' }}>(+{tStat.best.return_pct.toFixed(1)}%)</strong>
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '0.7rem 0.6rem' }}>
                        <div style={{ width: '120px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, Math.max(5, (retPct + 40) / 1.5))}%`,
                            height: '100%',
                            background: retPct >= 0 ? 'linear-gradient(90deg, #10B981, #34D399)' : '#EF4444'
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

      {/* ===== TAB 5: 回測歷史全交易紀錄 (1,290 筆) ===== */}
      {activeTabSub === 'trades' && (
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#F8FAFC', fontSize: '1.2rem' }}>
                📋 2005 - 2026 回測全進出交易明細 (共 1,290 筆完整紀錄)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94A3B8' }}>
                每一筆皆嚴格遵循法定營收公告日次日開盤進場與 60MA 季線動態風控停損
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
              📥 匯出 1,290 筆回測 CSV
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
                {trades.slice(0, 150).map((t, idx) => (
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

      {/* ===== 彈窗 1: 存入 / 調整資金 Modal ===== */}
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
              投入金額不一定需要立即買進股票，可記錄為當前閒置資金，系統將留待調倉時動態試算階梯配置。
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
                  確認出場並寫入歷史
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
                {editPosModal.isNew ? '➕ 手動新增持股 (將自動寫入歷史進出)' : `✏️ 編輯持股成本 - ${editPosModal.stock_name}`}
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成本均價 ($)</label>
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>手續費 (NT$)</label>
                  <input
                    type="number"
                    step="1"
                    value={editPosModal.entry_fee}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_fee: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>建倉日期</label>
                  <input
                    type="date"
                    value={editPosModal.entry_date}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_date: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: '#38BDF8', marginBottom: '1.2rem', background: 'rgba(56, 189, 248, 0.1)', padding: '0.6rem', borderRadius: '6px' }}>
                💡 提示：保存後系統將自動在「歷史進出流水帳」中寫入/更新對應買進紀錄，持股與未實現損益 100% 依流水帳自動連動！
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
                  確認保存至歷史進出
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
            background: 'linear-gradient(135deg, #0F172A, #1E293B)',
            border: '1px solid rgba(245, 158, 11, 0.5)', borderRadius: '12px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.15rem' }}>
                {editTxModal.isNew ? '➕ 記一筆實戰交易紀錄' : '✏️ 編輯歷史交易流水帳'}
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>股票名稱 / 說明</label>
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交單價 ($)</label>
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
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>現金流變動 (NT$)</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.cash_flow_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, cash_flow_twd: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FDE68A', fontWeight: 'bold' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>已實現損益 (選填)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="平倉時填寫"
                    value={editTxModal.realized_pnl_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_pnl_twd: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#FFF' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>報酬率 % (選填)</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例: 15.2"
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
                  placeholder="例: 10/12 法定公告日建倉 👑 王者先鋒 (35%)"
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
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#000', fontWeight: 'bold', padding: '0.45rem 1.2rem', borderRadius: '6px', border: 'none', fontSize: '0.84rem', cursor: 'pointer'
                  }}
                >
                  確認保存至歷史進出
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
