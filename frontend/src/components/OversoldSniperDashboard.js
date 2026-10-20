import React, { useState, useEffect, useMemo } from 'react';
import pureSniperTradesData from '../data/pure_sniper_trades.json';
import pureSniperCurveData from '../data/pure_sniper_curve.json';
import { apiGetOversoldSniperDashboard } from '../api';

const STORAGE_KEY_SNIPER_POS = 'oversold_sniper_user_positions_v1';

export default function OversoldSniperDashboard() {
  const [activeSubTab, setActiveSubTab] = useState('radar'); // 'radar' | 'tracker' | 'backtest' | 'rules'
  const [radarFilter, setRadarFilter] = useState('triggers'); // 'triggers' | 'watchlist' | 'all'
  const [tradeFilter, setTradeFilter] = useState('all'); // 'all' | 'win' | 'loss' | 'ma10' | 'time10'
  const [tradeSearch, setTradeSearch] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);

  // 自訂實戰跟單追蹤持倉
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SNIPER_POS);
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      {
        id: 'snip_init_1',
        ticker: 'AMD',
        name: '超微半導體 (AMD)',
        market: '美股',
        currency: 'USD',
        entry_price: 528.75,
        current_price: 540.20,
        shares: 10,
        entry_date: '2026-10-16',
        target_ma10: 601.74,
        stop_loss: 475.88,
        note: '20日 Z=-2.83 極端超賣進場'
      },
      {
        id: 'snip_init_2',
        ticker: '1513.TW',
        name: '中興電 (重電綠能龍頭)',
        market: '台股',
        currency: 'TWD',
        entry_price: 162.0,
        current_price: 164.5,
        shares: 2000,
        entry_date: '2026-10-19',
        target_ma10: 166.35,
        stop_loss: 145.8,
        note: '20日 Z=-2.84 偏離撈底'
      }
    ];
  });

  // 新增跟單彈窗
  const [addModal, setAddModal] = useState({
    open: false,
    ticker: '',
    name: '',
    market: '美股',
    currency: 'USD',
    entry_price: '',
    current_price: '',
    shares: '10',
    entry_date: new Date().toISOString().split('T')[0],
    target_ma10: '',
    stop_loss: '',
    note: ''
  });

  // 儲存持倉變更
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SNIPER_POS, JSON.stringify(userPositions));
    } catch (e) {}
  }, [userPositions]);

  // 載入即時後端雷達與數據
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const res = await apiGetOversoldSniperDashboard();
      if (res && res.status === 'ok') {
        setLiveData(res);
      }
    } catch (e) {
      console.warn('載入超賣快打雷達失敗:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // 靜態與動態指標綜合
  const kpi = liveData?.kpi || {
    total_trades: pureSniperTradesData.length || 352,
    win_rate: 55.68,
    avg_holding_days: 6.69,
    max_holding_days: 10,
    mdd_pct: -18.56,
    cumulative_return_pct: 443.8,
    sharpe_ratio: 0.59,
    exit_reason_breakdown: {
      ma10_profit_take: 265,
      ma10_profit_take_pct: 75.28,
      ten_day_time_exit: 52,
      ten_day_time_exit_pct: 14.77,
      hard_stop_loss: 35,
      hard_stop_loss_pct: 9.94
    }
  };

  const triggers = liveData?.radar?.triggers || [];
  const watchlist = liveData?.radar?.watch_list || [];
  const allScanned = liveData?.radar?.all_ranked || [];

  const radarDisplayItems = useMemo(() => {
    if (radarFilter === 'triggers') return triggers;
    if (radarFilter === 'watchlist') return watchlist;
    return allScanned;
  }, [radarFilter, triggers, watchlist, allScanned]);

  // 回測明細篩選
  const filteredTrades = useMemo(() => {
    const list = pureSniperTradesData || [];
    return list.filter(t => {
      if (tradeFilter === 'win' && (t.return_pct || 0) <= 0) return false;
      if (tradeFilter === 'loss' && (t.return_pct || 0) > 0) return false;
      if (tradeFilter === 'ma10' && !t.exit_reason?.includes('10MA')) return false;
      if (tradeFilter === 'time10' && !t.exit_reason?.includes('10 天')) return false;
      if (tradeSearch) {
        const q = tradeSearch.toUpperCase();
        return (t.stock_id && t.stock_id.toUpperCase().includes(q)) ||
               (t.stock_name && t.stock_name.toUpperCase().includes(q)) ||
               (t.entry_date && t.entry_date.includes(q));
      }
      return true;
    });
  }, [tradeFilter, tradeSearch]);

  // 帶入雷達標的至跟單艙
  const handleAdoptFromRadar = (item) => {
    setAddModal({
      open: true,
      ticker: item.ticker,
      name: item.name,
      market: item.market || (item.ticker.endsWith('.TW') ? '台股' : '美股'),
      currency: item.ticker.endsWith('.TW') ? 'TWD' : 'USD',
      entry_price: String(item.close),
      current_price: String(item.close),
      shares: item.ticker.endsWith('.TW') ? '1000' : '10',
      entry_date: new Date().toISOString().split('T')[0],
      target_ma10: String(item.ma10),
      stop_loss: String(item.stop_loss_price),
      note: `20日 Z=${item.z_score} 極端超賣觸發撈底`
    });
    setActiveSubTab('tracker');
  };

  // 新增持倉確認
  const handleSaveAddModal = () => {
    if (!addModal.ticker || !addModal.entry_price) {
      alert('請填寫標的代號與買入價格！');
      return;
    }
    const newPos = {
      id: `snip_${Date.now()}`,
      ticker: addModal.ticker.toUpperCase(),
      name: addModal.name || addModal.ticker,
      market: addModal.market,
      currency: addModal.currency,
      entry_price: parseFloat(addModal.entry_price),
      current_price: parseFloat(addModal.current_price || addModal.entry_price),
      shares: parseFloat(addModal.shares) || 1,
      entry_date: addModal.entry_date,
      target_ma10: parseFloat(addModal.target_ma10) || (parseFloat(addModal.entry_price) * 1.05),
      stop_loss: parseFloat(addModal.stop_loss) || (parseFloat(addModal.entry_price) * 0.90),
      note: addModal.note
    };
    setUserPositions(prev => [newPos, ...prev]);
    setAddModal(prev => ({ ...prev, open: false }));
  };

  // 平倉持倉
  const handleClosePosition = (id, ticker, gainPct) => {
    const isWin = gainPct >= 0;
    const confirmMsg = `確定要結利/平倉 ${ticker} 嗎？\n本次報酬率：${gainPct.toFixed(2)}% (${isWin ? '獲利了結' : '停損離場'})`;
    if (window.confirm(confirmMsg)) {
      setUserPositions(prev => prev.filter(p => p.id !== id));
    }
  };

  // 匯出 CSV
  const handleExportCsv = () => {
    if (!pureSniperTradesData || pureSniperTradesData.length === 0) return;
    const headers = ['標的代號', '標的名稱', '進場日期', '出場日期', '進場價', '出場價', '報酬率(%)', '持有天數', '出場理由'];
    const rows = pureSniperTradesData.map(t => [
      t.stock_id,
      t.stock_name,
      t.entry_date,
      t.exit_date,
      t.entry_price,
      t.exit_price,
      t.return_pct,
      t.holding_days,
      `"${t.exit_reason}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `oversold_sniper_352_trades_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '0 0.5rem', animation: 'fadeIn 0.3s ease-in-out' }}>
      {/* 頂部標題與哲學橫條 */}
      <div className="glass-card" style={{
        padding: '1.1rem 1.4rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.88))',
        border: '1px solid rgba(239, 68, 68, 0.35)',
        borderLeft: '5px solid #EF4444'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#F87171', fontSize: '1.28rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              🎯 極端超賣純快打專屬戰情室 (Z-Score Extreme Rebound Sniper)
            </h3>
            <span style={{
              fontSize: '0.78rem',
              background: 'rgba(239, 68, 68, 0.18)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: '#FCA5A5',
              padding: '0.2rem 0.65rem',
              borderRadius: '5px',
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              📡 雷達掃描日：<strong style={{ color: '#FCD34D' }}>{liveData?.market_date || '2026-10-19'}</strong> (直連 SQLite 實時運算)
            </span>
            <span style={{
              fontSize: '0.75rem',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(56, 189, 248, 0.2))',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              color: '#6EE7B7',
              padding: '0.2rem 0.6rem',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              🛡️ 平時 100% 現金零曝險 ｜ 出訊號短擊 1~10 天反彈 ｜ 碰 10MA 閃電結利
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              onClick={loadDashboardData}
              disabled={loading}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem',
                borderRadius: '6px',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#FECACA',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <span>🔄</span> {loading ? '掃描中...' : '重新掃描雷達'}
            </button>
          </div>
        </div>

        {/* 策略哲學核心 */}
        <p style={{ margin: '0 0 0.9rem 0', color: '#CBD5E1', fontSize: '0.84rem', lineHeight: '1.5' }}>
          <strong>💡 Frank 量化快打哲學：</strong>「拒絕長期買進死抱，專打機構恐慌踐踏！」當核心權值股爆發踩踏拋售、20日收盤價跌破均線達 <span style={{ color: '#F87171', fontWeight: 'bold' }}>-2.0 個標準差 ($Z \le -2.0$)</span> 時，
          市場出現非理性過度超跌。策略於次日開盤市價敲進，<strong>反彈觸及 10 日均線 (10MA) 即刻無情獲利了結</strong>；持倉上限滿 10 天無條件離場，硬停損設 -10%。
          22.8 年嚴格日頻撮合實證：<strong>平均僅持倉 6.69 天，75.3% 的交易成功於 10MA 停利結算</strong>，平時 100% 現金避險無懼大熊市！
        </p>

        {/* KPI 核心量化指標卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>📊 歷史嚴格撮合筆數</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#F87171', marginTop: '0.15rem' }}>
              {kpi.total_trades} <span style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>筆日頻交易</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#FECACA', marginTop: '0.15rem' }}>
              2004~2026 全球權值股回測
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid #10B981' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>🎯 交易總勝率</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#34D399', marginTop: '0.15rem' }}>
              {kpi.win_rate}%
            </div>
            <div style={{ fontSize: '0.68rem', color: '#A7F3D0', marginTop: '0.15rem' }}>
              196 勝 / 156 負 (非對稱正期望)
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>🚀 10MA 均值回歸停利率</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38BDF8', marginTop: '0.15rem' }}>
              {kpi.exit_reason_breakdown?.ma10_profit_take_pct || 75.28}%
            </div>
            <div style={{ fontSize: '0.68rem', color: '#BAE6FD', marginTop: '0.15rem' }}>
              265 筆成功由 10MA 獲利退場
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid #F59E0B' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>⏱️ 平均持倉週期</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#FCD34D', marginTop: '0.15rem' }}>
              {kpi.avg_holding_days} <span style={{ fontSize: '0.75rem', color: '#CBD5E1' }}>天 (最長10天)</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: '#FEF08A', marginTop: '0.15rem' }}>
              資金超高週轉率，絕不套牢
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.65rem 0.85rem', borderRadius: '6px', borderLeft: '3px solid #A855F7' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>🛡️ 最大策略回撤 (MDD)</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#C084FC', marginTop: '0.15rem' }}>
              {kpi.mdd_pct}%
            </div>
            <div style={{ fontSize: '0.68rem', color: '#E9D5FF', marginTop: '0.15rem' }}>
              平時 100% 現金，回撤遠低於大盤
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換導航 */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.6rem', flexWrap: 'wrap' }}>
        {[
          { id: 'radar', label: `📡 今日最新超賣快打雷達 (${triggers.length} 檔觸發)`, color: '#EF4444' },
          { id: 'tracker', label: `💼 我的實戰快打跟單艙 (${userPositions.length} 筆追蹤中)`, color: '#38BDF8' },
          { id: 'backtest', label: `📊 22.8年逐筆撮合明細 (352 筆真實紀錄)`, color: '#10B981' },
          { id: 'rules', label: '📜 快打四大鐵律與 SOP 手冊', color: '#F59E0B' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '6px',
              border: activeSubTab === tab.id ? `1px solid ${tab.color}` : '1px solid rgba(255,255,255,0.1)',
              background: activeSubTab === tab.id ? `rgba(${tab.id === 'radar' ? '239, 68, 68' : (tab.id === 'tracker' ? '56, 189, 248' : (tab.id === 'backtest' ? '16, 185, 129' : '245, 158, 11'))}, 0.2)` : 'rgba(15, 23, 42, 0.6)',
              color: activeSubTab === tab.id ? '#FFF' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: activeSubTab === tab.id ? `0 2px 8px rgba(0,0,0,0.3)` : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================================== */}
      {/* 視圖 1：📡 今日最新超賣快打雷達 (Live Z <= -2.0 Scanner) */}
      {/* ============================================================== */}
      {activeSubTab === 'radar' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #EF4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#F87171', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📡 全球核心流動性權值股 — 即時超賣撈底雷達
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                直連 tw_stock.db 動態運算全球 177 檔核心標的最新 20 日 Z-Score。當 Z ≤ -2.0 且 Price ≥ 0.85×200MA 時自動亮燈，提示 10MA 停利目標與預期反彈漲幅！
              </p>
            </div>

            {/* 篩選標籤 */}
            <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => setRadarFilter('triggers')}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'triggers' ? 'linear-gradient(135deg, #EF4444, #DC2626)' : 'transparent',
                  color: radarFilter === 'triggers' ? '#FFF' : '#94A3B8'
                }}
              >
                🔥 已觸發撈底 ({triggers.length})
              </button>
              <button
                onClick={() => setRadarFilter('watchlist')}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'watchlist' ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'transparent',
                  color: radarFilter === 'watchlist' ? '#FFF' : '#94A3B8'
                }}
              >
                ⚠️ 接近超賣警戒 ({watchlist.length})
              </button>
              <button
                onClick={() => setRadarFilter('all')}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: radarFilter === 'all' ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
                  color: radarFilter === 'all' ? '#FFF' : '#94A3B8'
                }}
              >
                🌐 全部排名 ({allScanned.length})
              </button>
            </div>
          </div>

          {/* 雷達表格 */}
          {radarDisplayItems.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>🛡️</div>
              <strong>當前市場未偵測到此分類之超賣標的</strong>
              <div style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
                市場處於正常波動或上升多頭中，閒置資金 100% 待命領息，無須勉強開槍。
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th>標的代碼與名稱</th>
                    <th>市場 / 國家</th>
                    <th style={{ textAlign: 'right' }}>最新收盤價</th>
                    <th style={{ textAlign: 'center' }}>20日 Z-Score</th>
                    <th style={{ textAlign: 'right' }}>🎯 10MA 停利目標</th>
                    <th style={{ textAlign: 'right' }}>預估反彈幅度</th>
                    <th style={{ textAlign: 'right' }}>🛑 -10% 硬停損</th>
                    <th style={{ textAlign: 'center' }}>長期趨勢過濾</th>
                    <th style={{ textAlign: 'center' }}>快打行動建議</th>
                    <th style={{ textAlign: 'center' }}>操作跟單</th>
                  </tr>
                </thead>
                <tbody>
                  {radarDisplayItems.map(item => {
                    const isTw = item.ticker.endsWith('.TW');
                    const cSign = isTw ? 'NT$' : '$';
                    const isExtreme = item.z_score <= -2.5;
                    return (
                      <tr key={item.ticker} style={{ background: item.is_trigger ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
                        <td>
                          <div style={{ fontWeight: 'bold', color: item.is_trigger ? '#FECACA' : '#F8FAFC' }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            {item.ticker}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.74rem', color: '#CBD5E1', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>
                            {item.market} ({item.country})
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                          {cSign} {item.close.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.8rem',
                            fontWeight: 'bold',
                            fontFamily: 'monospace',
                            background: isExtreme ? 'rgba(168, 85, 247, 0.25)' : (item.is_trigger ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)'),
                            border: `1px solid ${isExtreme ? 'rgba(168, 85, 247, 0.6)' : (item.is_trigger ? 'rgba(239, 68, 68, 0.6)' : 'rgba(245, 158, 11, 0.5)')}`,
                            color: isExtreme ? '#D8B4FE' : (item.is_trigger ? '#FCA5A5' : '#FCD34D'),
                            padding: '2px 8px',
                            borderRadius: '4px'
                          }}>
                            {item.z_score.toFixed(2)} σ
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>
                          {cSign} {item.ma10.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: item.exp_rebound_pct >= 10 ? '#34D399' : '#6EE7B7', fontFamily: 'monospace' }}>
                          +{item.exp_rebound_pct.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'right', color: '#F87171', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                          {cSign} {item.stop_loss_price.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {item.valid_trend ? (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', padding: '2px 6px', borderRadius: '4px' }}>
                              ✅ 通過 (≥0.85×200MA)
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.2)', color: '#F87171', padding: '2px 6px', borderRadius: '4px' }}>
                              ❌ 垂死空頭 (已過濾)
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {item.is_trigger ? (
                            <span style={{ fontSize: '0.74rem', background: 'linear-gradient(135deg, #EF4444, #B91C1C)', color: '#FFF', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                              🔥 T+1開盤市價打擊
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                              👀 密切監控急跌
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleAdoptFromRadar(item)}
                            style={{
                              padding: '0.22rem 0.55rem',
                              fontSize: '0.72rem',
                              background: 'linear-gradient(135deg, #38BDF8, #0284C7)',
                              border: 'none',
                              color: '#FFF',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            <span>⚡</span> 一鍵跟單
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
      {/* 視圖 2：💼 我的實戰快打跟單艙 (Live Sniper Tracker) */}
      {/* ============================================================== */}
      {activeSubTab === 'tracker' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                💼 我的實戰快打持倉追蹤艙
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                即時追蹤當前快打持股天數（最長上限 10 天倒數）、當前報酬率與 10MA 獲利達標狀態。達標或滿 10 天請一鍵平倉獲利了結！
              </p>
            </div>

            <button
              onClick={() => setAddModal({
                open: true,
                ticker: '',
                name: '',
                market: '美股',
                currency: 'USD',
                entry_price: '',
                current_price: '',
                shares: '10',
                entry_date: new Date().toISOString().split('T')[0],
                target_ma10: '',
                stop_loss: '',
                note: ''
              })}
              style={{
                padding: '0.35rem 0.8rem',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, #10B981, #059669)',
                color: '#FFF',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
            >
              <span>➕</span> 手動新增快打部位
            </button>
          </div>

          {userPositions.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>🎯</div>
              <strong>目前無進行中的快打持倉</strong>
              <div style={{ fontSize: '0.78rem', marginTop: '0.3rem' }}>
                可至「📡 今日最新超賣快打雷達」選取標的點擊「一鍵跟單」，或點擊上方「手動新增快打部位」。
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th>標的代碼與名稱</th>
                    <th>進場日期</th>
                    <th style={{ textAlign: 'center' }}>已持天數 (上限10天)</th>
                    <th style={{ textAlign: 'right' }}>買入成本價</th>
                    <th style={{ textAlign: 'right' }}>當前參考價</th>
                    <th style={{ textAlign: 'right' }}>🎯 10MA 停利目標</th>
                    <th style={{ textAlign: 'right' }}>目前報酬率 (%)</th>
                    <th style={{ textAlign: 'center' }}>快打狀態警示</th>
                    <th style={{ textAlign: 'center' }}>平倉退場操作</th>
                  </tr>
                </thead>
                <tbody>
                  {userPositions.map(pos => {
                    const daysHeld = pos.entry_date
                      ? Math.max(1, Math.floor((new Date() - new Date(pos.entry_date)) / (1000 * 60 * 60 * 24)))
                      : 1;
                    const gainPct = pos.entry_price > 0 ? ((pos.current_price - pos.entry_price) / pos.entry_price) * 100 : 0;
                    const isTouchMa10 = pos.current_price >= pos.target_ma10;
                    const isTimeWarning = daysHeld >= 8 && daysHeld < 10;
                    const isTimeExpired = daysHeld >= 10;
                    const isStopLoss = pos.current_price <= pos.stop_loss;
                    const isTw = pos.ticker.endsWith('.TW');
                    const cSign = isTw ? 'NT$' : '$';

                    return (
                      <tr key={pos.id} style={{ background: isTimeExpired ? 'rgba(239, 68, 68, 0.08)' : (isTouchMa10 ? 'rgba(16, 185, 129, 0.08)' : 'transparent') }}>
                        <td>
                          <div style={{ fontWeight: 'bold', color: '#F8FAFC' }}>{pos.name}</div>
                          <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            {pos.ticker} ({pos.shares} 股)
                          </div>
                        </td>
                        <td>{pos.entry_date}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.82rem',
                            fontWeight: 'bold',
                            fontFamily: 'monospace',
                            background: isTimeExpired ? '#DC2626' : (isTimeWarning ? '#D97706' : 'rgba(56, 189, 248, 0.2)'),
                            color: isTimeExpired ? '#FFF' : (isTimeWarning ? '#FFF' : '#38BDF8'),
                            padding: '2px 8px',
                            borderRadius: '4px'
                          }}>
                            {daysHeld} / 10 天
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                          {cSign} {pos.entry_price.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                          {cSign} {pos.current_price.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', color: '#38BDF8', fontWeight: 'bold', fontFamily: 'monospace' }}>
                          {cSign} {pos.target_ma10.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: gainPct >= 0 ? '#34D399' : '#F87171' }}>
                          {gainPct >= 0 ? '+' : ''}{gainPct.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {isTouchMa10 ? (
                            <span style={{ fontSize: '0.74rem', background: '#10B981', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              🎉 觸碰10MA停利達標！
                            </span>
                          ) : isStopLoss ? (
                            <span style={{ fontSize: '0.74rem', background: '#EF4444', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              🛑 跌破-10%停損線
                            </span>
                          ) : isTimeExpired ? (
                            <span style={{ fontSize: '0.74rem', background: '#DC2626', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              ⏱️ 滿10天強制無條件出場
                            </span>
                          ) : isTimeWarning ? (
                            <span style={{ fontSize: '0.74rem', background: '#F59E0B', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                              ⚠️ 倒數倒數 (剩餘 {10 - daysHeld} 天)
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.74rem', background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', padding: '2px 6px', borderRadius: '4px' }}>
                              ⏳ 反彈等待中
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleClosePosition(pos.id, pos.ticker, gainPct)}
                            style={{
                              padding: '0.22rem 0.55rem',
                              fontSize: '0.72rem',
                              background: isTouchMa10 ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #EF4444, #B91C1C)',
                              border: 'none',
                              color: '#FFF',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              marginRight: '4px'
                            }}
                          >
                            🚪 {isTouchMa10 ? '獲利平倉' : '平倉退場'}
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
      {/* 視圖 3：📊 22.8年逐筆歷史撮合回測明細 (352 筆嚴格日頻) */}
      {/* ============================================================== */}
      {activeSubTab === 'backtest' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📊 22.8 年逐筆歷史日頻撮合實證明細 (共 352 筆)
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                自 2004 年至 2026 年，所有交易均嚴格依照「Z ≤ -2.0 次日進場、碰 10MA 或持有滿 10 天強制出場、-10% 停損」之客觀撮合，無任何時序偷看或抽樣偏差。
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              {/* 搜尋框 */}
              <input
                type="text"
                placeholder="搜尋代號或年份..."
                value={tradeSearch}
                onChange={e => setTradeSearch(e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '5px',
                  color: '#FFF',
                  padding: '0.28rem 0.6rem',
                  fontSize: '0.78rem'
                }}
              />

              {/* 篩選按鈕 */}
              <div style={{ display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.4)', padding: '2px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.08)' }}>
                {[
                  { id: 'all', label: `全部 (${pureSniperTradesData.length})` },
                  { id: 'win', label: '✅ 獲利' },
                  { id: 'loss', label: '🛑 虧損' },
                  { id: 'ma10', label: '🎯 10MA停利' },
                  { id: 'time10', label: '⏱️ 滿10天' }
                ].map(b => (
                  <button
                    key={b.id}
                    onClick={() => setTradeFilter(b.id)}
                    style={{
                      padding: '0.22rem 0.55rem',
                      borderRadius: '4px',
                      border: 'none',
                      fontSize: '0.72rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      background: tradeFilter === b.id ? 'linear-gradient(135deg, #10B981, #059669)' : 'transparent',
                      color: tradeFilter === b.id ? '#FFF' : '#94A3B8'
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* 匯出 CSV */}
              <button
                onClick={handleExportCsv}
                style={{
                  padding: '0.28rem 0.65rem',
                  fontSize: '0.76rem',
                  borderRadius: '5px',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#6EE7B7',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                <span>📥</span> 匯出完整 CSV
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '550px' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#0F172A', zIndex: 2 }}>
                <tr>
                  <th>#</th>
                  <th>標的代號與名稱</th>
                  <th>進場日期</th>
                  <th>出場日期</th>
                  <th style={{ textAlign: 'center' }}>持有天數</th>
                  <th style={{ textAlign: 'right' }}>買入價</th>
                  <th style={{ textAlign: 'right' }}>賣出價</th>
                  <th style={{ textAlign: 'right' }}>交易報酬率</th>
                  <th>出場理由</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((t, idx) => {
                  const isWin = (t.return_pct || 0) > 0;
                  const isMa10 = t.exit_reason?.includes('10MA');
                  return (
                    <tr key={`${t.stock_id}_${t.entry_date}_${idx}`}>
                      <td style={{ color: '#64748B', fontFamily: 'monospace' }}>{idx + 1}</td>
                      <td>
                        <strong style={{ color: '#F8FAFC' }}>{t.stock_id}</strong>
                        <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{t.stock_name}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{t.entry_date}</td>
                      <td style={{ fontFamily: 'monospace' }}>{t.exit_date}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: '0.74rem',
                          background: t.holding_days === 10 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)',
                          color: t.holding_days === 10 ? '#FCA5A5' : '#7DD3FC',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 'bold'
                        }}>
                          {t.holding_days} 天
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${t.entry_price?.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${t.exit_price?.toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                        {isWin ? '+' : ''}{t.return_pct?.toFixed(2)}%
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isMa10 ? 'rgba(16, 185, 129, 0.2)' : (t.exit_reason?.includes('停損') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'),
                          color: isMa10 ? '#34D399' : (t.exit_reason?.includes('停損') ? '#F87171' : '#FCD34D')
                        }}>
                          {t.exit_reason}
                        </span>
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
      {/* 視圖 4：📜 快打四大鐵律與 SOP 手冊 */}
      {/* ============================================================== */}
      {activeSubTab === 'rules' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '4px solid #EF4444' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '1.3rem' }}>⚡</span>
              <h4 style={{ margin: 0, color: '#F87171', fontSize: '1.05rem' }}>鐵律 1：極端超賣門檻 (Z ≤ -2.0)</h4>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.6' }}>
              當日收盤價相較 20 日均線偏離度必須達到 <strong>-2.0 個標準差以下</strong>。
              此現象僅在市場爆發恐慌斷頭、對沖基金強制停損去槓桿時才會出現，是勝率極高的「非理性定價偏差」。若未達標，寧可 100% 現金停泊，絕不盲目抄底！
            </p>
          </div>

          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '4px solid #F59E0B' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '1.3rem' }}>🛡️</span>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.05rem' }}>鐵律 2：拒碰長期空頭 (Price ≥ 0.85 × 200MA)</h4>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.6' }}>
              標的最新價格必須高於其 200 日均線的 85%。
              此過濾器能<strong>精準剔除基本面破產、財務造假或處於長期垂死下行通道之弱勢股</strong>。我們只撈優質龍頭股的短期恐慌超跌，絕不接正在下墜的飛刀！
            </p>
          </div>

          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '4px solid #10B981' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '1.3rem' }}>🎯</span>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.05rem' }}>鐵律 3：反彈即走：10MA 均值回歸強制停利</h4>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.6' }}>
              一旦反彈盤中或收盤觸及 <strong>10 日均線 (10MA)</strong>，即刻無情市價獲利了結退場！
              超賣快打定位為「均值回歸」，而非波段長抱。75.3% 的回測交易均在觸及 10MA 時成功獲利平倉，落袋為安才是真獲利。
            </p>
          </div>

          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '4px solid #38BDF8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '1.3rem' }}>⏱️</span>
              <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.05rem' }}>鐵律 4：時間風控：上限 10 天無條件退場</h4>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.6' }}>
              資金的時間成本至高無上。若進場後第 10 個交易日收盤仍未觸及 10MA，<strong>強制無條件市價出場退場</strong>！
              若途中虧損觸及 <strong>-10% 硬停損線</strong> 亦立即停損。嚴守紀律，絕不讓短線快打變成套牢長抱！
            </p>
          </div>
        </div>
      )}

      {/* 新增持倉彈窗 Modal */}
      {addModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="glass-card" style={{
            width: '90%',
            maxWidth: '480px',
            padding: '1.4rem',
            background: '#0F172A',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)'
          }}>
            <h4 style={{ margin: '0 0 1rem 0', color: '#38BDF8', fontSize: '1.1rem' }}>
              ⚡ 新增實戰快打跟單部位
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.7rem' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#94A3B8' }}>標的代碼 (如 AMD, 1513.TW):</label>
                <input
                  type="text"
                  value={addModal.ticker}
                  onChange={e => setAddModal({ ...addModal, ticker: e.target.value.toUpperCase() })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#94A3B8' }}>標的中文名稱:</label>
                <input
                  type="text"
                  value={addModal.name}
                  onChange={e => setAddModal({ ...addModal, name: e.target.value })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.7rem' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#94A3B8' }}>買入進場價:</label>
                <input
                  type="number"
                  step="0.01"
                  value={addModal.entry_price}
                  onChange={e => setAddModal({ ...addModal, entry_price: e.target.value, current_price: e.target.value })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#94A3B8' }}>持股股數:</label>
                <input
                  type="number"
                  value={addModal.shares}
                  onChange={e => setAddModal({ ...addModal, shares: e.target.value })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.7rem' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#38BDF8' }}>🎯 10MA 停利目標價:</label>
                <input
                  type="number"
                  step="0.01"
                  value={addModal.target_ma10}
                  onChange={e => setAddModal({ ...addModal, target_ma10: e.target.value })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #0284C7', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.74rem', color: '#F87171' }}>🛑 -10% 硬停損價:</label>
                <input
                  type="number"
                  step="0.01"
                  value={addModal.stop_loss}
                  onChange={e => setAddModal({ ...addModal, stop_loss: e.target.value })}
                  style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #EF4444', borderRadius: '4px', color: '#FFF' }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.74rem', color: '#94A3B8' }}>進場日期 (開始起算10天倒數):</label>
              <input
                type="date"
                value={addModal.entry_date}
                onChange={e => setAddModal({ ...addModal, entry_date: e.target.value })}
                style={{ width: '100%', padding: '0.35rem', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', borderRadius: '4px', color: '#FFF' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                onClick={() => setAddModal({ ...addModal, open: false })}
                style={{ padding: '0.4rem 0.9rem', borderRadius: '4px', border: '1px solid #475569', background: 'transparent', color: '#94A3B8', cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveAddModal}
                style={{ padding: '0.4rem 1.1rem', borderRadius: '4px', border: 'none', background: 'linear-gradient(135deg, #38BDF8, #0284C7)', color: '#FFF', fontWeight: 'bold', cursor: 'pointer' }}
              >
                確認建倉追蹤
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
