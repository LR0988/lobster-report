import React, { useState, useEffect } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';

const STORAGE_KEY_POSITIONS = 'global_titan_user_positions_v1';
const STORAGE_KEY_CLOSED = 'global_titan_user_closed_v1';
const STORAGE_KEY_CAPITAL = 'global_titan_user_capital_v1';
const STORAGE_KEY_USDFX = 'global_titan_user_usdfx_v1';

const DEFAULT_POSITIONS = [
  {
    id: 'pos_mrna_1',
    ticker: 'MRNA',
    name: '莫德納 (Moderna 生技巨擘)',
    market: '美股 (NASDAQ)',
    currency: 'USD',
    shares: 54,
    entry_price: 186.61,
    current_price: 225.0,
    entry_date: '2026-10-01',
    entry_fee: 15,
    role: '👑 第1王者 (40%)',
    stop_condition: '無均線過敏停損，SPY 破年線才清倉'
  },
  {
    id: 'pos_3037_1',
    ticker: '3037.TW',
    name: '欣興 (Unimicron 載板王者)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 236,
    entry_price: 1195.0,
    current_price: 1270.0,
    entry_date: '2026-10-01',
    entry_fee: 400,
    role: '🥈 第2主力 (30%)',
    stop_condition: '載板王者主升段狂飆，持滿整月'
  },
  {
    id: 'pos_3443_1',
    ticker: '3443.TW',
    name: '創意 (Global Unichip ASIC)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 35,
    entry_price: 8040.0,
    current_price: 8360.0,
    entry_date: '2026-10-01',
    entry_fee: 400,
    role: '🥉 第3主力 (30%)',
    stop_condition: 'ASIC龍頭多頭強勁，每週一動態檢視'
  }
];

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('current_picks'); // 'current_picks', 'history', 'recent_trades', 'doe_audit'

  // 資金試算機狀態
  const [capital, setCapital] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CAPITAL);
      return saved ? parseFloat(saved) : 1000000;
    } catch { return 1000000; }
  });
  const [usdFx, setUsdFx] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_USDFX);
      return saved ? parseFloat(saved) : 32.5;
    } catch { return 32.5; }
  });

  // 使用者實戰持股與平倉紀錄
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_POSITIONS);
      return saved ? JSON.parse(saved) : DEFAULT_POSITIONS;
    } catch { return DEFAULT_POSITIONS; }
  });

  const [userClosedTrades, setUserClosedTrades] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CLOSED);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // 帶入建倉表單
  const [orderForm, setOrderForm] = useState({
    ticker: '',
    name: '',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: '',
    price: '',
    date: '2026-10-11',
    fee: '',
    role: '👑 第1王者 (40%)',
    stop_condition: '大波段抱牢，SPY破年線才清倉'
  });

  // 出場平倉彈窗
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
    exit_date: '2026-10-11',
    exit_tax_fee: '',
    reason: '依策略輪動換股'
  });

  const [feedbackMsg, setFeedbackMsg] = useState('');

  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_CAPITAL, String(capital)); } catch {}
  }, [capital]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_USDFX, String(usdFx)); } catch {}
  }, [usdFx]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(userPositions)); } catch {}
  }, [userPositions]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_CLOSED, JSON.stringify(userClosedTrades)); } catch {}
  }, [userClosedTrades]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/global_sovereign/dashboard');
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'ok') {
          setData(json);
        }
      }
    } catch (err) {
      console.warn('無法從後端獲取最新全球主權數據，使用快取展示:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const macro = data?.macro_status || {};
  const kpi = data?.kpi || {};
  const schemeA = kpi?.scheme_a || {};
  const spy = kpi?.spy || {};
  const currentPicks = data?.current_picks || [];
  const yearly = data?.yearly_performance || [];
  const recentTrades = data?.recent_trades || [];

  // 計算特定標的在當前資金下的建議部位
  const getSizingSuggestion = (pick) => {
    const weight = (pick.weight_pct || 30) / 100.0;
    const targetTwd = capital * weight;
    const isUsd = pick.currency === 'USD';
    const price = pick.price || 1;
    if (isUsd) {
      const targetUsd = targetTwd / usdFx;
      const shares = Math.max(1, Math.floor(targetUsd / price));
      const actualUsd = shares * price;
      const actualTwd = actualUsd * usdFx;
      return { targetTwd, targetUsd, shares, actualUsd, actualTwd };
    } else {
      const shares = Math.max(1, Math.floor(targetTwd / price));
      const actualTwd = shares * price;
      return { targetTwd, targetUsd: targetTwd / usdFx, shares, actualUsd: actualTwd / usdFx, actualTwd };
    }
  };

  // 點擊「📥 帶入實戰下單」
  const handleImportToOrder = (pick) => {
    const sizing = getSizingSuggestion(pick);
    const estFee = pick.currency === 'USD' ? 15 : Math.max(20, Math.round(sizing.actualTwd * 0.001425));
    setOrderForm({
      ticker: pick.ticker,
      name: pick.name,
      market: pick.market,
      currency: pick.currency,
      shares: String(sizing.shares),
      price: String(pick.price),
      date: '2026-10-11',
      fee: String(estFee),
      role: pick.rank === 1 ? '👑 第1王者 (40%)' : pick.rank === 2 ? '🥈 第2主力 (30%)' : '🥉 第3主力 (30%)',
      stop_condition: pick.stop_condition || '無過敏均線干擾，SPY破年線清倉'
    });
    triggerNotice(`已自動帶入【${pick.name}】至下方實戰建倉確認表單，您可以自由微調並確認！`);
    const elem = document.getElementById('real-order-form-anchor');
    if (elem) elem.scrollIntoView({ behavior: 'smooth' });
  };

  // 確認建倉送出
  const handleConfirmBuy = (e) => {
    e.preventDefault();
    if (!orderForm.ticker || !orderForm.shares || !orderForm.price) {
      alert('請填寫完整的股票代號、買進股數與成交價格');
      return;
    }
    const sharesNum = parseInt(orderForm.shares, 10);
    const priceNum = parseFloat(orderForm.price);
    const feeNum = parseFloat(orderForm.fee || 0);

    const newPos = {
      id: 'pos_' + Date.now(),
      ticker: orderForm.ticker.trim(),
      name: orderForm.name.trim() || orderForm.ticker.trim(),
      market: orderForm.market,
      currency: orderForm.currency,
      shares: sharesNum,
      entry_price: priceNum,
      current_price: priceNum,
      entry_date: orderForm.date,
      entry_fee: feeNum,
      role: orderForm.role,
      stop_condition: orderForm.stop_condition
    };

    setUserPositions(prev => [newPos, ...prev]);
    triggerNotice(`✅ 成功建立實戰持股【${newPos.name} (${newPos.ticker})】，共 ${sharesNum} 股！`);
  };

  // 開啟出場彈窗
  const handleOpenExitModal = (pos) => {
    const isUsd = pos.currency === 'USD';
    const estExitTaxFee = isUsd ? 15 : Math.round(pos.shares * pos.current_price * (0.003 + 0.001425));
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
      exit_price: String(pos.current_price || pos.entry_price),
      exit_date: '2026-10-11',
      exit_tax_fee: String(estExitTaxFee),
      reason: '依策略輪動換股'
    });
  };

  // 確認出場平倉送出
  const handleConfirmExit = (e) => {
    e.preventDefault();
    const exitPriceNum = parseFloat(exitModal.exit_price);
    const taxFeeNum = parseFloat(exitModal.exit_tax_fee || 0);
    if (!exitPriceNum || exitPriceNum <= 0) {
      alert('請輸入有效的出場成交價格');
      return;
    }

    const grossPnl = (exitPriceNum - exitModal.entry_price) * exitModal.shares;
    const totalTaxFee = exitModal.entry_fee + taxFeeNum;
    const netPnl = grossPnl - totalTaxFee;
    const totalCost = exitModal.entry_price * exitModal.shares + exitModal.entry_fee;
    const netReturnPct = totalCost > 0 ? (netPnl / totalCost) * 100 : 0;

    const closedRecord = {
      id: 'closed_' + Date.now(),
      ticker: exitModal.ticker,
      name: exitModal.name,
      currency: exitModal.currency,
      shares: exitModal.shares,
      entry_date: exitModal.entry_date,
      exit_date: exitModal.exit_date,
      entry_price: exitModal.entry_price,
      exit_price: exitPriceNum,
      entry_fee: exitModal.entry_fee,
      exit_tax_fee: taxFeeNum,
      total_tax_fee: totalTaxFee,
      gross_pnl: grossPnl,
      net_pnl: netPnl,
      net_return_pct: netReturnPct,
      reason: exitModal.reason
    };

    setUserPositions(prev => prev.filter(p => p.id !== exitModal.posId));
    setUserClosedTrades(prev => [closedRecord, ...prev]);
    setExitModal({ ...exitModal, open: false });
    triggerNotice(`🚪 成功平倉【${closedRecord.name}】！淨損益: ${exitModal.currency === 'USD' ? 'US$' : 'NT$'} ${netPnl.toLocaleString(undefined, { maximumFractionDigits: 1 })} (${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}%)`);
  };

  // 計算實戰持股的整體統計數據 (全部換算為台幣 TWD 統計)
  let totalOpenCostTwd = 0;
  let totalOpenMarketValTwd = 0;
  userPositions.forEach(p => {
    const fx = p.currency === 'USD' ? usdFx : 1.0;
    const cost = (p.shares * p.entry_price + (p.entry_fee || 0)) * fx;
    const val = (p.shares * (p.current_price || p.entry_price)) * fx;
    totalOpenCostTwd += cost;
    totalOpenMarketValTwd += val;
  });
  const totalOpenUnrealizedPnlTwd = totalOpenMarketValTwd - totalOpenCostTwd;
  const totalOpenUnrealizedPct = totalOpenCostTwd > 0 ? (totalOpenUnrealizedPnlTwd / totalOpenCostTwd) * 100 : 0;

  // 已實現損益換算 TWD
  let totalRealizedNetPnlTwd = 0;
  let totalTaxesPaidTwd = 0;
  let winningTradesCount = 0;
  userClosedTrades.forEach(t => {
    const fx = t.currency === 'USD' ? usdFx : 1.0;
    totalRealizedNetPnlTwd += t.net_pnl * fx;
    totalTaxesPaidTwd += (t.total_tax_fee || 0) * fx;
    if (t.net_pnl > 0) winningTradesCount++;
  });
  const realizedWinRate = userClosedTrades.length > 0 ? (winningTradesCount / userClosedTrades.length) * 100 : 0;

  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* 提示回饋氣泡 */}
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
          zIndex: 9999,
          fontWeight: 'bold',
          fontSize: '0.92rem',
          animation: 'slideIn 0.3s ease'
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* 頂部標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#60A5FA', fontSize: '1.5rem' }}>
            👑 全球高流動性泰坦旗艦（最高 Calmar 冠軍：Top 3 溫和階梯 40/30/30 - 慢慢跟他玩）
          </h2>
          <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            1,134 組全覆蓋 DOE 總冠軍 ➔ 22 年累積狂飆 +294,215% (翻 2,942 倍) | CAGR 42.38% | MDD -42.68% | Calmar 0.993
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            最後資料日: <strong style={{ color: '#E0E7FF' }}>{data?.latest_data_date || '即時'}</strong>
          </span>
          <button 
            className="btn btn-secondary" 
            onClick={fetchData} 
            disabled={loading}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
          >
            {loading ? '🔄 更新中...' : '🔄 重新整理'}
          </button>
        </div>
      </div>

      {/* 核心 KPI 指標卡片 (僅保留 Calmar 冠軍、我的實戰投資組合總覽、標普500) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.8rem' }}>
        {/* 卡片 1: Calmar 冠軍歷史績效 */}
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #10B981', background: 'rgba(16, 185, 129, 0.12)' }}>
          <div style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            👑 最高 Calmar 冠軍旗艦 (Top 3 階梯 40/30/30)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: '#10B981' }}>
            +{schemeA.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.78rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
            翻 <strong>{schemeA.mult?.toLocaleString()} 倍</strong> | CAGR <strong>{schemeA.cagr}%</strong> | MDD <strong>{schemeA.mdd}%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#6EE7B7', marginTop: '0.2rem' }}>
            Calmar <strong>{schemeA.calmar} (全場最高)</strong> | 夏普 <strong>1.08</strong> | 勝率 <strong>{schemeA.win_rate}%</strong>
          </div>
        </div>

        {/* 卡片 2: 我的實戰帳戶整體損益總覽 */}
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #38BDF8', background: 'rgba(14, 165, 233, 0.1)' }}>
          <div style={{ fontSize: '0.82rem', color: '#38BDF8', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            💼 我的實戰投資組合總市值與未實現損益
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: totalOpenUnrealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>
            NT$ {Math.round(totalOpenMarketValTwd).toLocaleString()}
          </div>
          <div style={{ fontSize: '0.78rem', color: '#BAE6FD', marginTop: '0.2rem' }}>
            未實現: <strong style={{ color: totalOpenUnrealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalOpenUnrealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalOpenUnrealizedPnlTwd).toLocaleString()} ({totalOpenUnrealizedPct >= 0 ? '+' : ''}{totalOpenUnrealizedPct.toFixed(2)}%)</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#CBD5E1', marginTop: '0.2rem' }}>
            持股 <strong>{userPositions.length} 檔</strong> | 累計已實現淨利: <strong style={{ color: totalRealizedNetPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedNetPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedNetPnlTwd).toLocaleString()}</strong>
          </div>
        </div>

        {/* 卡片 3: 標普 500 被動大盤基準 */}
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #9CA3AF' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            📊 基準：標普 500 (SPY 買入持有)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: '#D1D5DB' }}>
            +{spy.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.78rem', color: '#9CA3AF', marginTop: '0.2rem' }}>
            翻 <strong>{spy.mult} 倍</strong> | CAGR <strong>{spy.cagr}%</strong> | MDD <strong>{spy.mdd}%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: '0.2rem' }}>
            大盤被動持有基準線
          </div>
        </div>
      </div>

      {/* 當前宏觀風控狀態與當月持倉卡片 */}
      <div className="glass-card" style={{
        padding: '1.4rem',
        marginBottom: '1.8rem',
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(17, 24, 39, 0.9) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
          <div style={{ fontSize: '2.8rem', lineHeight: 1 }}>🛡️</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', background: '#10B981', color: '#FFF', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>
                最高 Calmar 冠軍即時總經風控
              </span>
              <span style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold' }}>
                {macro.regime || '牛市滿倉 (100% 倉位狂飆)'}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#F3F4F6' }}>
              標普 500 (SPY): ${macro.spy_price} ＞ 年線 200MA: ${macro.spy_ma200}
            </h3>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              大盤穩站年線之上，安全氣囊判定多頭有效 ➔ <strong>100% 滿倉重壓 Top 3 超級狂飆王權股</strong>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: '220px' }}>
          <div style={{ fontSize: '0.82rem', color: '#34D399', marginBottom: '0.3rem' }}>
            💡 Calmar 冠軍配置權重
          </div>
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '0.5rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '0.88rem', color: '#F9FAFB', fontWeight: 'bold' }}>
              Top 3: 40% / 30% / 30%
            </div>
            <div style={{ fontSize: '0.76rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
              國內台股現股 ＋ 複委託一鍵購足
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換按鈕 */}
      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.4rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem', flexWrap: 'wrap' }}>
        <button
          className={`btn ${activeSubTab === 'current_picks' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('current_picks')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          👑 實戰跟單帳簿與部位試算 (Top 3 旗艦)
        </button>
        <button
          className={`btn ${activeSubTab === 'history' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('history')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          📅 20 年逐年回測績效 ({yearly.length} 年)
        </button>
        <button
          className={`btn ${activeSubTab === 'recent_trades' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('recent_trades')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          📜 最近 24 個月調倉歷史
        </button>
        <button
          className={`btn ${activeSubTab === 'doe_audit' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('doe_audit')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🔬 1,134 組全覆蓋 DOE 出場與配比最佳化報告
        </button>
      </div>

      {/* 區塊 1: 當前實盤持倉名單與實戰記帳系統 */}
      {activeSubTab === 'current_picks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8rem' }}>

          {/* 1.1 投入現金計算目前總額與部位試算機 (Capital & Sizing Calculator) */}
          <div className="glass-card" style={{ padding: '1.3rem', borderTop: '3px solid #38BDF8', background: 'rgba(14, 165, 233, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  💵 投入總資金部位試算機（動態換算台美股各主力買進股數）
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: '#94A3B8', fontSize: '0.82rem' }}>
                  輸入您的總投資現金，系統將自動依據【Top 3 溫和階梯 40/30/30】精確計算各標的應分配金額與建議買進股數
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: '#CBD5E1' }}>
                  <span>美金匯率:</span>
                  <input
                    type="number"
                    step="0.1"
                    value={usdFx}
                    onChange={(e) => setUsdFx(parseFloat(e.target.value) || 32.5)}
                    style={{ width: '70px', padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#67E8F9', fontFamily: 'monospace', fontWeight: 'bold' }}
                  />
                </div>
              </div>
            </div>

            {/* 資金輸入框與快捷金額鈕 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.2rem', background: 'rgba(0,0,0,0.25)', padding: '0.8rem 1rem', borderRadius: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#F8FAFC' }}>投入總現金 (NT$):</span>
                <input
                  type="number"
                  step="10000"
                  value={capital}
                  onChange={(e) => setCapital(parseFloat(e.target.value) || 0)}
                  style={{ width: '160px', padding: '0.4rem 0.6rem', borderRadius: '6px', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid #38BDF8', color: '#FDE68A', fontWeight: 'bold', fontSize: '1.05rem', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {[300000, 500000, 1000000, 2000000, 5000000].map(amt => (
                  <button
                    key={amt}
                    onClick={() => setCapital(amt)}
                    style={{
                      background: capital === amt ? '#0284C7' : 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#FFF',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.78rem',
                      cursor: 'pointer'
                    }}
                  >
                    NT$ {amt >= 1000000 ? `${amt / 1000000}百萬` : `${amt / 10000}萬`}
                  </button>
                ))}
              </div>
            </div>

            {/* 3 大主力即時試算卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              {currentPicks.filter(p => p.is_active).map((pick) => {
                const sizing = getSizingSuggestion(pick);
                const isUsd = pick.currency === 'USD';
                return (
                  <div key={pick.ticker} style={{
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '1rem',
                    borderLeft: pick.rank === 1 ? '4px solid #F59E0B' : (pick.rank === 2 ? '4px solid #38BDF8' : '4px solid #818CF8')
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{
                        fontSize: '0.74rem',
                        fontWeight: 'bold',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: pick.rank === 1 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(56, 189, 248, 0.25)',
                        color: pick.rank === 1 ? '#FBBF24' : '#38BDF8'
                      }}>
                        {pick.rank === 1 ? '👑 第1王者 (40%)' : pick.rank === 2 ? '🥈 第2主力 (30%)' : '🥉 第3主力 (30%)'}
                      </span>
                      <span style={{ fontSize: '0.76rem', color: '#94A3B8' }}>{pick.market}</span>
                    </div>

                    <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F8FAFC' }}>
                      {pick.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace', marginBottom: '0.6rem' }}>
                      代碼: {pick.ticker} | 現價: {isUsd ? 'US$ ' : 'NT$ '}{pick.price?.toLocaleString()}
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '6px', fontSize: '0.82rem', marginBottom: '0.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#CBD5E1', marginBottom: '0.2rem' }}>
                        <span>目標分配額:</span>
                        <strong style={{ color: '#FDE68A' }}>NT$ {Math.round(sizing.targetTwd).toLocaleString()} {isUsd && `(≈ US$ ${Math.round(sizing.targetUsd).toLocaleString()})`}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#CBD5E1', marginBottom: '0.2rem' }}>
                        <span>建議買進股數:</span>
                        <strong style={{ color: '#34D399', fontSize: '1rem', fontFamily: 'monospace' }}>
                          {sizing.shares.toLocaleString()} 股 {(!isUsd && sizing.shares >= 1000) && `(${Math.floor(sizing.shares / 1000)}張 ${sizing.shares % 1000}股)`}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: '0.76rem' }}>
                        <span>實際動用資金:</span>
                        <span>NT$ {Math.round(sizing.actualTwd).toLocaleString()} {isUsd && `(US$ ${sizing.actualUsd.toFixed(1)})`}</span>
                      </div>
                    </div>

                    <button
                      className="btn"
                      onClick={() => handleImportToOrder(pick)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        fontSize: '0.84rem',
                        background: 'linear-gradient(135deg, #0284C7, #0369A1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      📥 帶入下單資料 ({sizing.shares} 股)
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 1.2 AI 當前持股推薦清單 (含右側帶入按鈕) */}
          <div className="glass-card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F3F4F6', fontSize: '1.1rem' }}>
                  👑 AI 當前精選持倉推薦 (Domestic-Accessible Titan Pool - 集中最強 Top 3)
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  前 3 名為當前滿倉主力（合計 100%），第 4～5 名為觀察候補。點擊右側按鈕可將建議股數直接帶入下方建倉表單！
                </p>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#10B981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
                ✓ 100% 國內券商可買・無海外換匯出入金門檻
              </div>
            </div>

            <table className="custom-table" style={{ width: '100%', fontSize: '0.86rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'center', width: '50px' }}>排名</th>
                  <th>股票名稱 / 代碼</th>
                  <th>交易市場</th>
                  <th style={{ textAlign: 'center' }}>配置權重</th>
                  <th style={{ textAlign: 'right' }}>最新現價</th>
                  <th style={{ textAlign: 'right' }}>60MA 季線</th>
                  <th style={{ textAlign: 'right' }}>3個月動能</th>
                  <th style={{ textAlign: 'right' }}>12個月動能</th>
                  <th style={{ textAlign: 'center' }}>持倉狀態</th>
                  <th style={{ textAlign: 'center', minWidth: '130px' }}>操作動作</th>
                </tr>
              </thead>
              <tbody>
                {currentPicks.map((p) => {
                  const curr = p.currency === 'USD' ? 'US$ ' : 'NT$ ';
                  return (
                    <tr key={p.ticker} style={{ background: p.is_active ? 'rgba(16, 185, 129, 0.06)' : 'transparent', borderLeft: p.is_active ? '3px solid #10B981' : 'none' }}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                        {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank}
                      </td>
                      <td>
                        <div style={{ fontWeight: 'bold', color: '#F3F4F6' }}>{p.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontFamily: 'monospace' }}>{p.ticker}</div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.76rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: p.market.includes('台股') ? 'rgba(99, 102, 241, 0.2)' : 'rgba(59, 130, 246, 0.2)', color: p.market.includes('台股') ? '#A5B4FC' : '#93C5FD' }}>
                          {p.market}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {p.is_active ? (
                          <span style={{ fontWeight: 'bold', color: '#10B981', background: 'rgba(16, 185, 129, 0.2)', padding: '0.15rem 0.5rem', borderRadius: '4px' }}>
                            {p.weight_pct}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>候補 (0%)</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#F3F4F6', fontFamily: 'monospace' }}>
                        {curr}{p.price?.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {curr}{p.ma60?.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: p.mom_3m >= 0 ? '#34D399' : '#F87171' }}>
                        {p.mom_3m >= 0 ? `+${p.mom_3m}%` : `${p.mom_3m}%`}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: p.mom_12m >= 0 ? '#34D399' : '#F87171' }}>
                        {p.mom_12m >= 0 ? `+${p.mom_12m}%` : `${p.mom_12m}%`}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {p.is_active ? (
                          <span style={{ fontSize: '0.76rem', color: '#34D399', fontWeight: 'bold' }}>🔥 滿倉主力</span>
                        ) : (
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>👀 候補儲備</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleImportToOrder(p)}
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          📥 帶入下單
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 1.3 實戰持股建倉表單 (Real Order Form) */}
          <div id="real-order-form-anchor" className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #6366F1', background: 'rgba(99, 102, 241, 0.05)' }}>
            <h4 style={{ margin: '0 0 0.8rem 0', color: '#A5B4FC', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              ✍️ 實戰持股建倉確認表單（修改確認股數與價格 ➔ 登記實盤持股）
            </h4>
            <p style={{ margin: '0 0 1rem 0', color: '#CBD5E1', fontSize: '0.82rem' }}>
              您可以直接點擊上方表格「📥 帶入下單」自動預填，或手動修改買進股數、實際成交價與手續費，確認無誤後點擊「確認建倉並記錄」！
            </p>

            <form onSubmit={handleConfirmBuy}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>股票代碼 (Ticker)</label>
                  <input
                    type="text"
                    value={orderForm.ticker}
                    onChange={(e) => setOrderForm({ ...orderForm, ticker: e.target.value })}
                    placeholder="例如 MRNA 或 3037.TW"
                    required
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>股票名稱</label>
                  <input
                    type="text"
                    value={orderForm.name}
                    onChange={(e) => setOrderForm({ ...orderForm, name: e.target.value })}
                    placeholder="例如 莫德納"
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>幣別</label>
                  <select
                    value={orderForm.currency}
                    onChange={(e) => setOrderForm({ ...orderForm, currency: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="TWD">新台幣 (TWD)</option>
                    <option value="USD">美元 (USD)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>買進股數 (Shares)</label>
                  <input
                    type="number"
                    value={orderForm.shares}
                    onChange={(e) => setOrderForm({ ...orderForm, shares: e.target.value })}
                    placeholder="例如 54 或 236"
                    required
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #38BDF8', color: '#38BDF8', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>買進成交價 (Entry Price)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderForm.price}
                    onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                    placeholder="例如 225.0"
                    required
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>手續費 (Fee)</label>
                  <input
                    type="number"
                    value={orderForm.fee}
                    onChange={(e) => setOrderForm({ ...orderForm, fee: e.target.value })}
                    placeholder="例如 15 或 400"
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>建倉日期</label>
                  <input
                    type="date"
                    value={orderForm.date}
                    onChange={(e) => setOrderForm({ ...orderForm, date: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>配置角色</label>
                  <select
                    value={orderForm.role}
                    onChange={(e) => setOrderForm({ ...orderForm, role: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="👑 第1王者 (40%)">👑 第1王者 (40%)</option>
                    <option value="🥈 第2主力 (30%)">🥈 第2主力 (30%)</option>
                    <option value="🥉 第3主力 (30%)">🥉 第3主力 (30%)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    padding: '0.55rem 1.4rem',
                    fontSize: '0.9rem',
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    fontWeight: 'bold',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  ✅ 確認建倉並記錄到實戰部位
                </button>
              </div>
            </form>
          </div>

          {/* 1.4 我的實戰持有中部位 (My Live Positions) + 出場按鈕 */}
          <div className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #10B981', background: 'rgba(16, 185, 129, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔥 我的實戰持有中部位（真實下單紀錄・即時損益監控・一鍵出場）
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: '#94A3B8', fontSize: '0.82rem' }}>
                  此處為您確認建倉的真實投資部位。點擊右側「🚪 執行出場平倉」可輸入實際賣出價與稅金，自動結算淨損益並記入歷史帳簿！
                </p>
              </div>
              <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6EE7B7', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
                當前持倉: {userPositions.length} 檔
              </span>
            </div>

            {userPositions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.9rem' }}>
                目前尚無實戰持股。請利用上方試算機點擊「📥 帶入下單」建立您的第一筆持倉！
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.86rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th>標的名稱 (代碼)</th>
                      <th style={{ textAlign: 'center' }}>角色</th>
                      <th style={{ textAlign: 'center' }}>建倉日期</th>
                      <th style={{ textAlign: 'right' }}>持有股數</th>
                      <th style={{ textAlign: 'right' }}>買進成本價</th>
                      <th style={{ textAlign: 'right' }}>最新現價</th>
                      <th style={{ textAlign: 'right' }}>目前市值 (折合台幣)</th>
                      <th style={{ textAlign: 'right' }}>未實現淨損益</th>
                      <th style={{ textAlign: 'center', minWidth: '110px' }}>出場操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userPositions.map((pos) => {
                      const isUsd = pos.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const fx = isUsd ? usdFx : 1.0;
                      const costTwd = (pos.shares * pos.entry_price + (pos.entry_fee || 0)) * fx;
                      const valTwd = (pos.shares * (pos.current_price || pos.entry_price)) * fx;
                      const pnlTwd = valTwd - costTwd;
                      const retPct = costTwd > 0 ? (pnlTwd / costTwd) * 100 : 0;
                      const isWin = pnlTwd >= 0;

                      return (
                        <tr key={pos.id} style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                            {pos.name} <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace' }}>({pos.ticker})</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '0.74rem', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 'bold', background: pos.role?.includes('王者') ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.25)', color: pos.role?.includes('王者') ? '#FBBF24' : '#38BDF8' }}>
                              {pos.role}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', color: '#94A3B8' }}>{pos.entry_date}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#E2E8F0' }}>
                            {pos.shares.toLocaleString()} 股
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#E2E8F0' }}>
                            {curr}{pos.entry_price?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                            {curr}{(pos.current_price || pos.entry_price)?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#67E8F9' }}>
                            NT$ {Math.round(valTwd).toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                            {isWin ? '+' : ''}NT$ {Math.round(pnlTwd).toLocaleString()} ({isWin ? '+' : ''}{retPct.toFixed(2)}%)
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="btn"
                              onClick={() => handleOpenExitModal(pos)}
                              style={{
                                padding: '0.3rem 0.7rem',
                                fontSize: '0.76rem',
                                background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                                border: 'none'
                              }}
                            >
                              🚪 執行出場
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

          {/* 1.5 實戰歷史成交與損益日誌 (Closed Trades Ledger) */}
          <div className="glass-card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F3F4F6', fontSize: '1.1rem' }}>
                  📜 實戰歷史進出與實現損益帳簿（扣除手續費與證交稅淨損益）
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  每次平倉皆完整記錄買進價、賣出價、交易稅費與淨報酬率，終身累計結算實戰成績
                </p>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#E2E8F0', background: 'rgba(255,255,255,0.06)', padding: '0.3rem 0.6rem', borderRadius: '4px' }}>
                已實現總筆數: <strong>{userClosedTrades.length}</strong> | 勝率: <strong>{realizedWinRate.toFixed(1)}%</strong> | 累計稅費: <strong>NT$ {Math.round(totalTaxesPaidTwd).toLocaleString()}</strong>
              </div>
            </div>

            {userClosedTrades.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
                目前尚無平倉歷史紀錄。持股出場時將自動在此歸檔並結算損益！
              </div>
            ) : (
              <table className="custom-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>標的名稱 (代碼)</th>
                    <th style={{ textAlign: 'center' }}>進場日期</th>
                    <th style={{ textAlign: 'center' }}>出場日期</th>
                    <th style={{ textAlign: 'right' }}>成交股數</th>
                    <th style={{ textAlign: 'right' }}>買進成本</th>
                    <th style={{ textAlign: 'right' }}>出場價格</th>
                    <th style={{ textAlign: 'right' }}>交易稅金與手續費</th>
                    <th style={{ textAlign: 'right' }}>實現淨損益 (折合NT$)</th>
                    <th style={{ textAlign: 'right' }}>淨報酬率</th>
                    <th style={{ textAlign: 'left' }}>出場原因說明</th>
                  </tr>
                </thead>
                <tbody>
                  {userClosedTrades.map((t) => {
                    const isUsd = t.currency === 'USD';
                    const curr = isUsd ? 'US$ ' : 'NT$ ';
                    const fx = isUsd ? usdFx : 1.0;
                    const netPnlTwd = t.net_pnl * fx;
                    const taxTwd = (t.total_tax_fee || 0) * fx;
                    const isWin = t.net_pnl >= 0;

                    return (
                      <tr key={t.id} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                          {t.name} <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>({t.ticker})</span>
                        </td>
                        <td style={{ textAlign: 'center', color: '#94A3B8' }}>{t.entry_date}</td>
                        <td style={{ textAlign: 'center', color: '#94A3B8' }}>{t.exit_date}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{t.shares?.toLocaleString()} 股</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{curr}{t.entry_price?.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{curr}{t.exit_price?.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                          NT$ {Math.round(taxTwd).toLocaleString()} {isUsd && `(US$ ${t.total_tax_fee})`}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}NT$ {Math.round(netPnlTwd).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}{t.net_return_pct?.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'left', fontSize: '0.76rem', color: '#CBD5E1' }}>
                          {t.reason || '平倉出場'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 區塊 2: 20年歷年戰績對比 */}
      {activeSubTab === 'history' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            🛡️ <strong>無上帝視角原則</strong>：每月最後一個交易日收盤確認動能 ➔ 次日開盤執行 ➔ 逐筆內扣交易稅費 ➔ 22 年累積狂飆 <strong>+294,215% (翻 2,942 倍)</strong>！
          </div>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '65px' }}>年份</th>
                <th style={{ textAlign: 'right', color: '#10B981', fontWeight: 'bold' }}>Calmar 冠軍 (Top 3 溫和階梯)</th>
                <th style={{ textAlign: 'right', color: '#9CA3AF' }}>標普 500 (SPY 基準)</th>
                <th style={{ textAlign: 'right', color: '#60A5FA' }}>超額報酬 (Alpha)</th>
                <th style={{ textAlign: 'right' }}>年底資產淨值</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => {
                const alpha = y.scheme_a_ret - y.spy_ret;
                return (
                  <tr key={y.year}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{y.year}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.scheme_a_ret >= 0 ? '#10B981' : '#EF4444', fontFamily: 'monospace' }}>
                      {y.scheme_a_ret >= 0 ? `+${y.scheme_a_ret}%` : `${y.scheme_a_ret}%`}
                    </td>
                    <td style={{ textAlign: 'right', color: y.spy_ret >= 0 ? 'var(--text-muted)' : '#EF4444', fontFamily: 'monospace' }}>
                      {y.spy_ret >= 0 ? `+${y.spy_ret}%` : `${y.spy_ret}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: alpha >= 0 ? '#60A5FA' : '#F59E0B', fontFamily: 'monospace' }}>
                      {alpha >= 0 ? `+${alpha.toFixed(2)}%` : `${alpha.toFixed(2)}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      ${y.capital?.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 3: 最近 24 個月調倉歷史 */}
      {activeSubTab === 'recent_trades' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#F3F4F6', fontSize: '1.1rem' }}>
            📜 最近調倉成交歷史明細 (最近 20 筆)
          </h4>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.86rem' }}>
            <thead>
              <tr>
                <th>標的代碼</th>
                <th>進場日期</th>
                <th>出場日期</th>
                <th style={{ textAlign: 'right' }}>進場價格</th>
                <th style={{ textAlign: 'right' }}>出場價格</th>
                <th style={{ textAlign: 'right' }}>單筆損益</th>
                <th style={{ textAlign: 'right' }}>持倉天數</th>
                <th>出場觸發原因</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((t, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>{t.ticker}</td>
                  <td>{t.entry_date}</td>
                  <td>{t.exit_date}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${t.entry_price?.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${t.exit_price?.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: t.return_pct >= 0 ? '#10B981' : '#EF4444', fontFamily: 'monospace' }}>
                    {t.return_pct >= 0 ? `+${t.return_pct}%` : `${t.return_pct}%`}
                  </td>
                  <td style={{ textAlign: 'right' }}>{t.holding_days} 天</td>
                  <td style={{ color: 'var(--text-muted)' }}>{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 4: 1,134 組全覆蓋 DOE 出場策略與分配比例深度實驗報告 */}
      {activeSubTab === 'doe_audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card" style={{ padding: '1.4rem', borderTop: '4px solid #8B5CF6', background: 'rgba(139, 92, 246, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#C4B5FD', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔬 1,134 組全因子 DOE 深度實驗：出場策略與分配比例全向最佳化
                </h3>
                <p style={{ margin: '0.4rem 0 0 0', color: '#CBD5E1', fontSize: '0.86rem', lineHeight: '1.5' }}>
                  2004～2026 全歷史（5,720 交易日）全量實證：覆蓋 6 種均線/硬停損 x 7 種移動停利 x 3 種遞補模式 x 9 種持股檔數與配比風格。
                </p>
              </div>
              <span style={{ fontSize: '0.8rem', background: 'rgba(139, 92, 246, 0.2)', color: '#DDD6FE', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.4)' }}>
                全因子實驗總量：1,134 組完整回測
              </span>
            </div>

            {/* 4 大核心主效應 ANOVA 矩陣看板 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {/* 1. 均線防守效應 */}
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#6EE7B7', marginBottom: '0.6rem' }}>
                  🛡️ 因子 A：均線防守機制 (Exit MA)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.6rem', lineHeight: '1.4' }}>
                  <strong>40MA:</strong> 最抗跌但過敏 (MDD -43.3%, CAGR 25.3%, 1,085次交易)<br/>
                  <strong>60MA 季線:</strong> 均衡防禦中樞 (MDD -45.9%, CAGR 28.6%)<br/>
                  <strong>80MA:</strong> 波段與避險最佳平衡 (Calmar 0.66, CAGR 30.4%)<br/>
                  <strong>None (無均線):</strong> 總收益最高 (CAGR 34.5%)，但月中無防守
                </div>
                <div style={{ fontSize: '0.74rem', color: '#10B981', fontWeight: 'bold' }}>
                  💡 結論：實戰防守推薦 60MA 或 80MA，切忌 40MA 頻繁洗盤。
                </div>
              </div>

              {/* 2. 守住獲利移動停利效應 */}
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#FBBF24', marginBottom: '0.6rem' }}>
                  🎯 因子 B：守住獲利移動停利 (Trailing Stop)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.6rem', lineHeight: '1.4' }}>
                  <strong>+10%回檔6%:</strong> 勝率衝上 <span style={{ color: '#FBBF24', fontWeight: 'bold' }}>53.2% (最高61.5%)</span>，絕不做白工<br/>
                  <strong>+15%回檔10%:</strong> Calmar 0.65，CAGR 30.4%，鎖利波段兼備<br/>
                  <strong>+20%回檔10%:</strong> 寬鬆型移動停利，CAGR 30.4%，MDD -47.0%<br/>
                  <strong>None:</strong> CAGR 34.1%，但回吐心理壓力最大
                </div>
                <div style={{ fontSize: '0.74rem', color: '#FBBF24', fontWeight: 'bold' }}>
                  💡 結論：追求勝率選「+10%回檔6%」；兼顧複利選「+15%回檔10%」。
                </div>
              </div>

              {/* 3. 遞補時點效應 */}
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#60A5FA', marginBottom: '0.6rem' }}>
                  ⚡ 因子 C：資金遞補時點 (Refill Mode)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.6rem', lineHeight: '1.4' }}>
                  <strong>次日立即遞補 (Next-day):</strong> CAGR <span style={{ color: '#60A5FA', fontWeight: 'bold' }}>32.90% 全場第一</span> (資金零閒置)<br/>
                  <strong>每週動態遞補 (Weekly):</strong> Calmar 0.67，MDD -46.5%，實戰操作最舒服<br/>
                  <strong>月底才換股 (Monthly):</strong> CAGR 慘跌至 26.63% (現金閒置 2~4 週)
                </div>
                <div style={{ fontSize: '0.74rem', color: '#60A5FA', fontWeight: 'bold' }}>
                  💡 結論：停損後絕對不能空手乾等月底！必須搭配每週或次日遞補。
                </div>
              </div>

              {/* 4. 分配比例與檔數效應 */}
              <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#C084FC', marginBottom: '0.6rem' }}>
                  ⚖️ 因子 D：檔數與分配比例 (Sizing Scheme)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.6rem', lineHeight: '1.4' }}>
                  <strong>Top 5 檔:</strong> MDD 僅 <span style={{ color: '#34D399', fontWeight: 'bold' }}>-41.35% (全場最穩)</span>，Calmar 0.70<br/>
                  <strong>Top 4 檔:</strong> MDD -47.56%，CAGR 29.82%，階梯配比經典黃金平衡<br/>
                  <strong>Top 3 檔:</strong> CAGR 衝上 31.38%，但 MDD 擴大至 -50.49%<br/>
                  <strong>陡峭配置 (如 50/30/20):</strong> MDD 崩至 -52.9%，重壓風險過高
                </div>
                <div style={{ fontSize: '0.74rem', color: '#C084FC', fontWeight: 'bold' }}>
                  💡 結論：等權 (如 25%x4 或 20%x5) 或溫和階梯最優，嚴禁單股超載 50%。
                </div>
              </div>
            </div>

            {/* 4 大維度全場冠軍榜單 */}
            <h4 style={{ margin: '0 0 0.8rem 0', color: '#F3F4F6', fontSize: '1.05rem' }}>
              🏆 全球泰坦 DOE 4 大維度實戰冠軍配置推薦
            </h4>
            <div style={{ overflowX: 'auto', marginBottom: '1.2rem' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th style={{ textAlign: 'left' }}>冠軍類別</th>
                    <th style={{ textAlign: 'left' }}>最佳參數組合 (均線 / 停利 / 遞補 / 配比)</th>
                    <th style={{ textAlign: 'right' }}>22年累積總報酬</th>
                    <th style={{ textAlign: 'right' }}>年化 (CAGR)</th>
                    <th style={{ textAlign: 'right' }}>最大回撤 (MDD)</th>
                    <th style={{ textAlign: 'right' }}>卡瑪 Calmar</th>
                    <th style={{ textAlign: 'right' }}>勝率 Win%</th>
                    <th style={{ textAlign: 'right' }}>總交易數</th>
                    <th style={{ textAlign: 'left' }}>實戰推薦適用場景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ background: 'rgba(16, 185, 129, 0.08)', borderLeft: '3px solid #10B981' }}>
                    <td style={{ fontWeight: 'bold', color: '#34D399' }}>🥇 最高 Calmar 冠軍</td>
                    <td>
                      <span style={{ fontWeight: 'bold', color: '#F1F5F9' }}>無均線 ＋ 無停利 ＋ 每週遞補 ＋ Top 3 階梯 (40/30/30)</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+294,215%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>+42.38%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>-42.68%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>0.993</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>52.1%</td>
                    <td style={{ textAlign: 'right', color: '#94A3B8' }}>311 筆</td>
                    <td style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>風險調整後效率最高，極限複利狂飆首選</td>
                  </tr>

                  <tr style={{ background: 'rgba(59, 130, 246, 0.08)', borderLeft: '3px solid #3B82F6' }}>
                    <td style={{ fontWeight: 'bold', color: '#60A5FA' }}>🛡️ 最低回撤防守冠軍</td>
                    <td>
                      <span style={{ fontWeight: 'bold', color: '#F1F5F9' }}>40MA 停損 ＋ +15%回檔10% ＋ 月底換倉 ＋ Top 5 等權 (20%x5)</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+3,391%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>+17.33%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>-29.50%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>0.587</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>43.8%</td>
                    <td style={{ textAlign: 'right', color: '#94A3B8' }}>751 筆</td>
                    <td style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>回撤壓破 30% 大關！極致厭惡風險型專用</td>
                  </tr>

                  <tr style={{ background: 'rgba(245, 158, 11, 0.08)', borderLeft: '3px solid #F59E0B' }}>
                    <td style={{ fontWeight: 'bold', color: '#FBBF24' }}>🏆 最高勝率冠軍</td>
                    <td>
                      <span style={{ fontWeight: 'bold', color: '#F1F5F9' }}>無均線 ＋ +10%回檔6%停利 ＋ 月底換倉 ＋ Top 3 等權 (33%x3)</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+35,630%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>+29.55%</td>
                    <td style={{ textAlign: 'right', color: '#F87171', fontFamily: 'monospace' }}>-47.85%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>0.618</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>61.48%</td>
                    <td style={{ textAlign: 'right', color: '#94A3B8' }}>392 筆</td>
                    <td style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>勝率衝破 61%！快速鎖利入袋，絕不抱上抱下</td>
                  </tr>

                  <tr style={{ background: 'rgba(168, 85, 247, 0.08)', borderLeft: '3px solid #A855F7' }}>
                    <td style={{ fontWeight: 'bold', color: '#C084FC' }}>⚖️ 實戰旗艦平衡推薦</td>
                    <td>
                      <span style={{ fontWeight: 'bold', color: '#F1F5F9' }}>60MA 季線 ＋ +10%回檔6% ＋ 次日立即遞補 ＋ Top 5 溫和階梯</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>+46,120%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>+30.76%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>-38.19%</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#A855F7', fontFamily: 'monospace' }}>0.805</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>50.66%</td>
                    <td style={{ textAlign: 'right', color: '#94A3B8' }}>1,064 筆</td>
                    <td style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>全面防守 (破季線出) + 鎖利 (回檔停利) + 零資金閒置，心安首選</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: '1rem', borderRadius: '6px', fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.6' }}>
              📌 <strong>DOE 實證落地方案建議</strong>：
              您選擇的「<strong>最高 Calmar 冠軍 (Top 3 溫和階梯 40/30/30)</strong>」在 22 年裡翻了 <strong>2,942 倍</strong>，Calmar 高達 0.993。當您放下短線得失心、給它時間慢慢跟他玩時，這套策略將以強大的複利幾何曲線為您創造超額收益！
            </div>
          </div>
        </div>
      )}

      {/* 出場平倉確認彈窗 Modal */}
      {exitModal.open && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)',
          padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '520px',
            width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.6rem' }}>
              <h4 style={{ margin: 0, color: '#F87171', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🚪 執行實戰持股出場平倉
              </h4>
              <button
                onClick={() => setExitModal({ ...exitModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '6px', marginBottom: '1.2rem', fontSize: '0.84rem' }}>
              <div style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: '1rem', marginBottom: '0.2rem' }}>
                {exitModal.name} <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>({exitModal.ticker})</span>
              </div>
              <div style={{ color: '#CBD5E1' }}>
                持有股數: <strong style={{ color: '#FDE68A' }}>{exitModal.shares?.toLocaleString()} 股</strong> | 買進成本: <strong style={{ color: '#FDE68A' }}>{exitModal.currency === 'USD' ? 'US$ ' : 'NT$ '}{exitModal.entry_price?.toLocaleString()}</strong>
              </div>
              <div style={{ color: '#94A3B8', fontSize: '0.78rem' }}>
                建倉日期: {exitModal.entry_date} | 買進手續費: {exitModal.currency === 'USD' ? 'US$ ' : 'NT$ '}{exitModal.entry_fee}
              </div>
            </div>

            <form onSubmit={handleConfirmExit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>出場成交價格 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_price}
                    onChange={(e) => setExitModal({ ...exitModal, exit_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #F87171', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>出場稅金與手續費 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_tax_fee}
                    onChange={(e) => setExitModal({ ...exitModal, exit_tax_fee: e.target.value })}
                    placeholder="證交稅+手續費"
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>出場日期</label>
                  <input
                    type="date"
                    value={exitModal.exit_date}
                    onChange={(e) => setExitModal({ ...exitModal, exit_date: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.25rem' }}>出場原因</label>
                  <select
                    value={exitModal.reason}
                    onChange={(e) => setExitModal({ ...exitModal, reason: e.target.value })}
                    style={{ width: '100%', padding: '0.45rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="依策略輪動換股">依策略輪動換股</option>
                    <option value="大盤破年線避險出清">大盤破年線避險出清</option>
                    <option value="個人獲利了結">個人獲利了結</option>
                    <option value="停損離場">停損離場</option>
                  </select>
                </div>
              </div>

              {/* 實時預估淨損益 */}
              {(() => {
                const ep = parseFloat(exitModal.exit_price) || 0;
                const tf = parseFloat(exitModal.exit_tax_fee) || 0;
                const gross = (ep - exitModal.entry_price) * exitModal.shares;
                const net = gross - exitModal.entry_fee - tf;
                const cost = exitModal.entry_price * exitModal.shares + exitModal.entry_fee;
                const ret = cost > 0 ? (net / cost) * 100 : 0;
                const curr = exitModal.currency === 'USD' ? 'US$ ' : 'NT$ ';
                return (
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.7rem 0.9rem', borderRadius: '6px', marginBottom: '1.2rem', fontSize: '0.84rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#94A3B8' }}>扣除稅費後實現淨損益:</span>
                      <strong style={{ color: net >= 0 ? '#34D399' : '#F87171', fontSize: '1rem', fontFamily: 'monospace' }}>
                        {net >= 0 ? '+' : ''}{curr}{Math.round(net).toLocaleString()} ({net >= 0 ? '+' : ''}{ret.toFixed(2)}%)
                      </strong>
                    </div>
                    {exitModal.currency === 'USD' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#67E8F9', fontSize: '0.78rem' }}>
                        <span>折合台幣淨損益:</span>
                        <span>{net >= 0 ? '+' : ''}NT$ {Math.round(net * usdFx).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setExitModal({ ...exitModal, open: false })}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
                    color: '#FFF',
                    fontWeight: 'bold',
                    padding: '0.5rem 1.4rem'
                  }}
                >
                  確認出場平倉並記入帳簿
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
