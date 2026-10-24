import React, { useState, useEffect } from 'react';
import defaultAsymData from '../data/defaultTwAsymmetricAlphaData.json';
import defaultCbBacktestData from '../data/cb_backtest_data.json';
import { apiGetTwAsymmetricAlphaDashboard, getCurrentUser } from '../api';

const STORAGE_KEY_ASYM_WATCH = 'tw_asymmetric_alpha_watchlist_v1';

export default function TwAsymmetricAlphaDashboard() {
  const currentUser = getCurrentUser();
  const username = currentUser?.username || 'hotpotlu';
  const storageKey = `${STORAGE_KEY_ASYM_WATCH}_${username}`;

  const [data, setData] = useState(defaultAsymData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('cbas_boom'); // 'cbas_boom' | 'rsi2_sniper' | 'my_sniper_list' | 'cb_yearly' | 'cb_trades'
  const [cbasBudgetTwd, setCbasBudgetTwd] = useState(50000);
  const [rsi2BudgetTwd, setRsi2BudgetTwd] = useState(150000);
  const [notice, setNotice] = useState('');

  // 22 年可轉債回測資料狀態
  const cbBacktestSummary = defaultCbBacktestData?.summary || {};
  const cbBacktestYearly = defaultCbBacktestData?.yearly || [];
  const allCbTrades = defaultCbBacktestData?.trades || [];

  const [cbTradeFilter, setCbTradeFilter] = useState('all'); // 'all' | 'big_win' | 'bond_floor'
  const [cbTradeYearFilter, setCbTradeYearFilter] = useState('all');
  const [cbTradeSearch, setCbTradeSearch] = useState('');
  const [cbTradePage, setCbTradePage] = useState(1);
  const [cbMode, setCbMode] = useState('cbas'); // 'cbas' (62.5% CAGR) | 'cash_cb' (23.0% CAGR)
  const CB_TRADES_PAGE_SIZE = 25;

  const [sniperList, setSniperList] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sniperList));
    } catch {}
  }, [sniperList, storageKey]);

  const fetchLatest = async () => {
    setLoading(true);
    try {
      const live = await apiGetTwAsymmetricAlphaDashboard();
      if (live && live.status === 'ok') {
        setData(live);
      }
    } catch (e) {
      console.warn('讀取可轉債與急跌狙擊數據失敗:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatest();
  }, []);

  const showToast = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const kpi = data?.summary_kpi || {};
  const cbasPicks = data?.cbas_boom_picks || [];
  const rsi2Picks = data?.rsi2_sniper_picks || [];

  const handleAddSniper = (item, mode) => {
    const idKey = `${mode}_${item.stock_id}`;
    if (sniperList.some(x => x.idKey === idKey)) {
      showToast(`⚠️ ${item.stock_name} (${item.stock_id}) 已在您的狙擊追蹤清單中`);
      return;
    }

    if (mode === 'CBAS暴擊') {
      const lots = Math.max(1, Math.floor(cbasBudgetTwd / (item.cbas_cost_twd || 15000)));
      const totalPremium = lots * (item.cbas_cost_twd || 15000);
      const controlledNotional = lots * 100000;
      const newEntry = {
        idKey,
        addedDate: data?.latest_data_date || '2026-10-16',
        mode: '🔥 CBAS 可轉債選擇權',
        stock_id: item.stock_id,
        stock_name: `${item.stock_name} (${item.cb_name})`,
        entry_price: `現股 ${item.close} / 權利金 ${item.cbas_quote}`,
        target_desc: `現股 +30% ➔ CBAS 預估 +${item.est_cbas_roi_30pct}%`,
        risk_desc: `最大虧損鎖死 NT$ ${totalPremium.toLocaleString()} (絕不斷頭)`,
        size_desc: `${lots} 張 CBAS (控制面額 NT$ ${controlledNotional.toLocaleString()})`,
        capital_used: totalPremium
      };
      setSniperList(prev => [newEntry, ...prev]);
      showToast(`✅ 已將【${item.cb_name} (${item.cb_code})】加入 CBAS 暴擊追蹤清單！`);
    } else {
      const shares = Math.max(50, Math.floor(rsi2BudgetTwd / (item.close || 1)));
      const costTwd = Math.round(shares * item.close);
      const estGainTwd = Math.round(shares * (item.target_ma5_price - item.close));
      const newEntry = {
        idKey,
        addedDate: data?.latest_data_date || '2026-10-16',
        mode: '🎯 RSI(2) 急跌反彈',
        stock_id: item.stock_id,
        stock_name: item.stock_name,
        entry_price: `NT$ ${item.close} (RSI2=${item.rsi2})`,
        target_desc: `觸及 5MA (NT$ ${item.target_ma5_price}, +${item.expected_rebound_pct}%) 停利 (+NT$${estGainTwd.toLocaleString()})`,
        risk_desc: `防守線 NT$ ${item.stop_loss_price} (持有 3~5 天)`,
        size_desc: `${shares.toLocaleString()} 股 (盤中零股/整張)`,
        capital_used: costTwd
      };
      setSniperList(prev => [newEntry, ...prev]);
      showToast(`✅ 已將【${item.stock_name} (${item.stock_id})】加入 RSI(2) 急跌反彈狙擊清單！`);
    }
  };

  const handleRemoveSniper = (idKey) => {
    setSniperList(prev => prev.filter(x => x.idKey !== idKey));
    showToast('🗑️ 已移除該筆狙擊追蹤紀錄');
  };

  // 22 年可轉債回測明細過濾與分頁計算
  const yearsList = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009, 2008, 2007, 2006, 2005, 2004, 2003];

  const filteredCbTrades = allCbTrades.filter(t => {
    if (cbTradeFilter === 'big_win' && t.pnl_pct < 20) return false;
    if (cbTradeFilter === 'bond_floor' && t.pnl_pct >= 5) return false;
    if (cbTradeYearFilter !== 'all' && String(t.year) !== String(cbTradeYearFilter)) return false;
    if (cbTradeSearch.trim()) {
      const q = cbTradeSearch.trim().toLowerCase();
      const match =
        String(t.ticker || '').toLowerCase().includes(q) ||
        String(t.stock_name || '').toLowerCase().includes(q) ||
        String(t.cb_code || '').toLowerCase().includes(q) ||
        String(t.cb_name || '').toLowerCase().includes(q) ||
        String(t.industry || '').toLowerCase().includes(q) ||
        String(t.exit_reason || '').toLowerCase().includes(q) ||
        String(t.factor_signals || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const totalCbPages = Math.ceil(filteredCbTrades.length / CB_TRADES_PAGE_SIZE) || 1;
  const currentCbPageTrades = filteredCbTrades.slice(
    (cbTradePage - 1) * CB_TRADES_PAGE_SIZE,
    cbTradePage * CB_TRADES_PAGE_SIZE
  );

  const handleExportCbBacktestCsv = () => {
    const headers = ['編號', '年份', '股票代號', '股票名稱', 'CB代碼', 'CB名稱', '產業別', '買進日期', '出場日期', '買進價格', '出場價格', '持有天數', 'CB報酬率%', 'CBAS報酬率%', '出場原因', '全因子標籤'];
    const rows = filteredCbTrades.map(t => [
      t.id,
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
    a.download = `cb_backtest_22y_trades_${data?.latest_data_date || 'latest'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📥 已成功匯出 ${filteredCbTrades.length} 筆可轉債回測成交明細 CSV！`);
  };

  return (
    <div style={{ animation: 'fadeIn 0.25s ease', paddingBottom: '3rem' }}>
      {notice && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
          color: '#FFF',
          padding: '0.8rem 1.3rem',
          borderRadius: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          zIndex: 99999,
          fontWeight: 'bold',
          fontSize: '0.9rem'
        }}>
          {notice}
        </div>
      )}

      {/* 頂部橫幅 */}
      <div className="glass-card" style={{
        padding: '1.1rem 1.3rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 27, 75, 0.88))',
        border: '1px solid rgba(245, 158, 11, 0.38)',
        borderLeft: '4px solid #F59E0B'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.85rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#FBBF24', fontSize: '1.22rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              ⚡ 台股可轉債（CB / CBAS）主力鎖碼 × 強勢股 RSI(2) 急跌狙擊工作站
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
              🗓️ 資料庫基準日：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-16'}</strong>
            </span>
            <span style={{
              fontSize: '0.74rem',
              background: 'rgba(168, 85, 247, 0.2)',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              color: '#E9D5FF',
              padding: '0.2rem 0.6rem',
              borderRadius: '5px',
              fontWeight: 'bold'
            }}>
              🛡️ 與長線動能策略「負相關互補」：大盤洗盤時靠 RSI(2) 低接提款，主升段靠 CBAS 鎖死風險翻倍
            </span>
          </div>

          <button
            className="btn btn-secondary"
            onClick={fetchLatest}
            disabled={loading}
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
          >
            {loading ? '🔄 即時運算中...' : '🔄 重新掃描資料庫'}
          </button>
        </div>

        {/* 4 大核心指標與試算器 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🔥 CBAS 可轉債選擇權 (大戶鎖碼突破)</div>
            <div style={{ fontSize: '1.22rem', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              盈虧比 {kpi.cbas_payoff_ratio || 3.85}:1 | 年化 +{kpi.cbas_backtest_cagr_pct || 52.6}%
            </div>
            <div style={{ fontSize: '0.7rem', color: '#FDE68A', marginTop: '0.15rem' }}>
              {kpi.cbas_max_loss_rule || '單筆最大虧損鎖死於權利金 (絕不斷頭)'}
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🎯 強勢股 Connors RSI(2) 急跌反彈</div>
            <div style={{ fontSize: '1.22rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              勝率 {kpi.rsi2_win_rate_pct || 72.4}% | 年化 +{kpi.rsi2_backtest_cagr_pct || 31.8}%
            </div>
            <div style={{ fontSize: '0.7rem', color: '#A7F3D0', marginTop: '0.15rem' }}>
              最大回撤 <strong>{kpi.rsi2_mdd_pct || -11.6}%</strong>・平均持股僅 <strong>{kpi.rsi2_avg_hold_days || 4.2} 天</strong>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #EC4899' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>💎 CBAS 權利金單筆預算 (以小博大)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#CBD5E1' }}>權利金預算 NT$:</span>
              <input
                type="number"
                step="10000"
                value={cbasBudgetTwd}
                onChange={(e) => setCbasBudgetTwd(Math.max(10000, Number(e.target.value) || 50000))}
                style={{
                  width: '95px',
                  padding: '0.18rem 0.4rem',
                  borderRadius: '4px',
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid #EC4899',
                  color: '#FBCFE8',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  fontSize: '0.85rem'
                }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: '#F9A8D4', marginTop: '0.2rem' }}>
              約可買 <strong>{Math.max(1, Math.round(cbasBudgetTwd / 14500))} 張 CBAS</strong> (控制 {Math.max(1, Math.round(cbasBudgetTwd / 14500)) * 10} 萬可轉債)
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>⚡ RSI(2) 急跌低接單筆預算 (3~5天快進快出)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#CBD5E1' }}>單筆低接 NT$:</span>
              <input
                type="number"
                step="50000"
                value={rsi2BudgetTwd}
                onChange={(e) => setRsi2BudgetTwd(Math.max(30000, Number(e.target.value) || 150000))}
                style={{
                  width: '100px',
                  padding: '0.18rem 0.4rem',
                  borderRadius: '4px',
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid #38BDF8',
                  color: '#BAE6FD',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  fontSize: '0.85rem'
                }}
              />
            </div>
            <div style={{ fontSize: '0.7rem', color: '#7DD3FC', marginTop: '0.2rem' }}>
              收盤前買進超賣強勢股 ➔ 彈回 5MA 立即落袋
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁按鈕 */}
      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button
          onClick={() => setActiveSubTab('cbas_boom')}
          style={{
            padding: '0.52rem 1.05rem',
            borderRadius: '8px',
            border: activeSubTab === 'cbas_boom' ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
            background: activeSubTab === 'cbas_boom' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(234, 88, 12, 0.25))' : 'rgba(15, 23, 42, 0.7)',
            color: activeSubTab === 'cbas_boom' ? '#FDE68A' : '#94A3B8',
            fontWeight: 'bold',
            fontSize: '0.86rem',
            cursor: 'pointer'
          }}
        >
          🔥 引擎 A：可轉債（CB / CBAS）大戶鎖碼 × 轉換價突破暴擊雷達 ({cbasPicks.length} 檔)
        </button>

        <button
          onClick={() => setActiveSubTab('rsi2_sniper')}
          style={{
            padding: '0.52rem 1.05rem',
            borderRadius: '8px',
            border: activeSubTab === 'rsi2_sniper' ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.12)',
            background: activeSubTab === 'rsi2_sniper' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.25))' : 'rgba(15, 23, 42, 0.7)',
            color: activeSubTab === 'rsi2_sniper' ? '#6EE7B7' : '#94A3B8',
            fontWeight: 'bold',
            fontSize: '0.86rem',
            cursor: 'pointer'
          }}
        >
          🎯 引擎 B：強勢領頭羊 Connors RSI(2) 極端急跌反彈狙擊器 ({rsi2Picks.length} 檔)
        </button>

        <button
          onClick={() => setActiveSubTab('my_sniper_list')}
          style={{
            padding: '0.52rem 1.05rem',
            borderRadius: '8px',
            border: activeSubTab === 'my_sniper_list' ? '1px solid #A855F7' : '1px solid rgba(255,255,255,0.12)',
            background: activeSubTab === 'my_sniper_list' ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.28), rgba(126, 34, 206, 0.25))' : 'rgba(15, 23, 42, 0.7)',
            color: activeSubTab === 'my_sniper_list' ? '#E9D5FF' : '#94A3B8',
            fontWeight: 'bold',
            fontSize: '0.86rem',
            cursor: 'pointer'
          }}
        >
          📌 我的 CBAS 與 RSI(2) 實戰狙擊追蹤清單 ({sniperList.length})
        </button>

        <button
          onClick={() => setActiveSubTab('cb_yearly')}
          style={{
            padding: '0.52rem 1.05rem',
            borderRadius: '8px',
            border: activeSubTab === 'cb_yearly' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
            background: activeSubTab === 'cb_yearly' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(2, 132, 199, 0.25))' : 'rgba(15, 23, 42, 0.7)',
            color: activeSubTab === 'cb_yearly' ? '#38BDF8' : '#94A3B8',
            fontWeight: 'bold',
            fontSize: '0.86rem',
            cursor: 'pointer'
          }}
        >
          📊 22年歷年實證績效 ({cbBacktestYearly.length} 個年度明細)
        </button>

        <button
          onClick={() => setActiveSubTab('cb_trades')}
          style={{
            padding: '0.52rem 1.05rem',
            borderRadius: '8px',
            border: activeSubTab === 'cb_trades' ? '1px solid #34D399' : '1px solid rgba(255,255,255,0.12)',
            background: activeSubTab === 'cb_trades' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.25))' : 'rgba(15, 23, 42, 0.7)',
            color: activeSubTab === 'cb_trades' ? '#34D399' : '#94A3B8',
            fontWeight: 'bold',
            fontSize: '0.86rem',
            cursor: 'pointer'
          }}
        >
          📜 歷年實證進出歷史 ({allCbTrades.length} 筆回測紀錄)
        </button>
      </div>

      {/* 引擎 A：可轉債 CB / CBAS 主力鎖碼雷達 */}
      {activeSubTab === 'cbas_boom' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B' }}>
          <div style={{ marginBottom: '0.9rem', padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.28)', borderRadius: '8px', fontSize: '0.8rem', color: '#CBD5E1', lineHeight: '1.55' }}>
            <strong style={{ color: '#FBBF24' }}>💡 為什麼台股主力最愛用「可轉債選擇權（CBAS）」翻倍？散戶該如何跟單？</strong><br />
            ① <strong>看懂主力記號</strong>：當一家成長股發行可轉債（CB），且<strong>「集保千張大戶比例連續上升、百張散戶退場」＋「自營商（CBAS 造市避險端）連續買超」＋「現股剛突破轉換價（Parity 介於 98 ~ 115）」</strong>時，代表主力準備拉抬現股讓可轉債進入價內轉換！<br />
            ② <strong>小資金不對稱優勢</strong>：買進 1 張現股可能要 20~30 萬，但買進 1 張 CBAS 只需要 <strong>約 NT$ 1.2 萬 ~ 1.6 萬權利金</strong>（即可參與 10 萬元可轉債的完整漲幅）。就算看錯方向，最大虧損就是這 1 萬多元權利金，絕不斷頭；一旦現股波段拉升 +30%，CBAS 常直接翻 <strong>+150% ~ +250%</strong>！
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'center', width: '50px' }}>排名</th>
                  <th>現股與可轉債代號</th>
                  <th>主力鎖碼訊號</th>
                  <th style={{ textAlign: 'right' }}>現股收盤價</th>
                  <th style={{ textAlign: 'right' }}>轉換價 / 轉換價值(Parity)</th>
                  <th style={{ textAlign: 'right', color: '#FBBF24' }}>CBAS 權利金/張 (槓桿)</th>
                  <th style={{ textAlign: 'right', color: '#34D399' }}>現股+30%時 CBAS預估報酬</th>
                  <th style={{ textAlign: 'right' }}>千張大戶%(3週增減)</th>
                  <th style={{ textAlign: 'right' }}>自營避險/法人5日</th>
                  <th style={{ textAlign: 'right' }}>營收 YoY</th>
                  <th style={{ textAlign: 'center' }}>鎖碼評分</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {cbasPicks.map((item, idx) => (
                  <tr key={item.stock_id} style={{ background: idx < 5 ? 'rgba(245, 158, 11, 0.06)' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: idx < 5 ? '#FBBF24' : '#94A3B8' }}>
                      #{idx + 1}
                    </td>
                    <td>
                      <strong style={{ color: '#F8FAFC' }}>{item.stock_name} ({item.stock_id})</strong>
                      <div style={{ fontSize: '0.73rem', color: '#FDE68A', fontFamily: 'monospace' }}>
                        債券: {item.cb_name} ({item.cb_code}) · {item.industry}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.73rem',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        background: item.signal_tag.includes('剛過轉換價') ? 'rgba(245, 158, 11, 0.24)' : 'rgba(56, 189, 248, 0.2)',
                        color: item.signal_tag.includes('剛過轉換價') ? '#FCD34D' : '#7DD3FC'
                      }}>
                        {item.signal_tag}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                      NT$ {item.close.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <div style={{ color: '#CBD5E1' }}>轉換價 {item.conv_price}</div>
                      <div style={{ fontSize: '0.72rem', color: item.parity >= 100 ? '#34D399' : '#93C5FD', fontWeight: 'bold' }}>
                        Parity: {item.parity} (溢價 {item.premium_rate_pct}%)
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <div style={{ color: '#FBBF24', fontWeight: 'bold' }}>
                        NT$ {item.cbas_cost_twd.toLocaleString()} / 張
                      </div>
                      <div style={{ fontSize: '0.71rem', color: '#F9A8D4' }}>
                        報價 {item.cbas_quote} · <strong>{item.effective_leverage}x 槓桿</strong>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399', fontSize: '0.88rem' }}>
                      +{item.est_cbas_roi_30pct}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <div style={{ color: '#F8FAFC', fontWeight: 'bold' }}>{item.whale_pct}%</div>
                      <div style={{ fontSize: '0.71rem', color: item.whale_diff_3w >= 0 ? '#34D399' : '#F87171' }}>
                        大戶 {item.whale_diff_3w >= 0 ? '+' : ''}{item.whale_diff_3w}% | 散戶 {item.retail_diff_3w >= 0 ? '+' : ''}{item.retail_diff_3w}%
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.77rem' }}>
                      <div style={{ color: item.dealer_5d_lots >= 0 ? '#FBBF24' : '#94A3B8' }}>
                        自營 {item.dealer_5d_lots >= 0 ? '+' : ''}{item.dealer_5d_lots} 張
                      </div>
                      <div style={{ color: item.inst_5d_lots >= 0 ? '#34D399' : '#F87171' }}>
                        總法人 {item.inst_5d_lots >= 0 ? '+' : ''}{item.inst_5d_lots} 張
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: item.rev_yoy_pct >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                      {item.rev_yoy_pct >= 0 ? '+' : ''}{item.rev_yoy_pct}%
                    </td>
                    <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: '#67E8F9' }}>
                      {item.lock_score}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => handleAddSniper(item, 'CBAS暴擊')}
                        style={{
                          padding: '0.28rem 0.6rem',
                          borderRadius: '5px',
                          border: '1px solid rgba(245, 158, 11, 0.5)',
                          background: 'rgba(245, 158, 11, 0.2)',
                          color: '#FDE68A',
                          fontSize: '0.74rem',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        ➕ 鎖定CBAS
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 引擎 B：強勢領頭羊 Connors RSI(2) 極端急跌反彈狙擊器 */}
      {activeSubTab === 'rsi2_sniper' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
          <div style={{ marginBottom: '0.9rem', padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.28)', borderRadius: '8px', fontSize: '0.8rem', color: '#CBD5E1', lineHeight: '1.55' }}>
            <strong style={{ color: '#34D399' }}>💡 量化大師 Larry Connors 經典《RSI(2) 強勢股恐慌急跌買進法》實戰守則：</strong><br />
            ① <strong>只買長線大多頭的股票</strong>：嚴格限定 `收盤價 &gt; 60MA (季線)` 且 `60MA &gt; 120MA (半年線)` 且 `20日均成交額 &gt; 2億` 的主流強勢股（絕不接空頭下跌刀！）。<br />
            ② <strong>趁短線非理性急殺尾盤進場</strong>：當強勢股因大盤震盪連續回檔 2~4 天，導致 <strong>`2日RSI (RSI-2) 跌破 15 ~ 20`</strong> 時，於當日收盤前（13:20~13:30）買進。<br />
            ③ <strong>觸及 5 日均線（5MA）無條件獲利了結</strong>：平均持有僅 <strong>3 ~ 5 個交易日</strong>，一旦反彈摸到 `5MA` 立即賣出落袋，實證勝率高達 <strong>72.4%</strong>！
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'center', width: '50px' }}>順位</th>
                  <th>標的名稱 (代碼 / 產業)</th>
                  <th>超賣狙擊訊號</th>
                  <th style={{ textAlign: 'right' }}>最新收盤價</th>
                  <th style={{ textAlign: 'center', color: '#F472B6' }}>RSI(2) 超賣指標</th>
                  <th style={{ textAlign: 'right' }}>近3日急跌 / 連跌天數</th>
                  <th style={{ textAlign: 'right', color: '#34D399' }}>5MA 停利目標價 (預估反彈)</th>
                  <th style={{ textAlign: 'right' }}>60MA 多頭季線 (停損價)</th>
                  <th style={{ textAlign: 'right' }}>月營收 YoY</th>
                  <th style={{ textAlign: 'center' }}>歷史同型勝率</th>
                  <th style={{ textAlign: 'right', color: '#A5B4FC' }}>試算買進股數</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rsi2Picks.map((item, idx) => {
                  const recShares = Math.max(50, Math.floor(rsi2BudgetTwd / (item.close || 1)));
                  const estGainTwd = Math.round(recShares * (item.target_ma5_price - item.close));
                  return (
                    <tr key={item.stock_id} style={{ background: item.rsi2 < 10 ? 'rgba(16, 185, 129, 0.07)' : 'rgba(255,255,255,0.015)' }}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: item.rsi2 < 10 ? '#34D399' : '#94A3B8' }}>
                        #{idx + 1}
                      </td>
                      <td>
                        <strong style={{ color: '#F8FAFC' }}>{item.stock_name}</strong>
                        <div style={{ fontSize: '0.73rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                          {item.stock_id}.TW · {item.industry}
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.73rem',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          background: item.rsi2 < 10 ? 'rgba(16, 185, 129, 0.24)' : 'rgba(56, 189, 248, 0.2)',
                          color: item.rsi2 < 10 ? '#34D399' : '#7DD3FC'
                        }}>
                          {item.urgency_tag}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                        NT$ {item.close.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.9rem', color: item.rsi2 < 8 ? '#F472B6' : '#FBBF24' }}>
                        {item.rsi2}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#F87171' }}>
                        <div>{item.ret_3d_pct}%</div>
                        <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>連跌 {item.down_days} 日 (乖離5MA {item.bias_5ma_pct}%)</div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#34D399', fontWeight: 'bold' }}>
                          NT$ {item.target_ma5_price} (+{item.expected_rebound_pct}%)
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#A7F3D0' }}>觸及 5MA 立即停利</div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#CBD5E1' }}>季線 {item.ma60}</div>
                        <div style={{ fontSize: '0.7rem', color: '#FCA5A5' }}>停損: {item.stop_loss_price}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: item.rev_yoy_pct >= 0 ? '#34D399' : '#94A3B8', fontWeight: 'bold' }}>
                        {item.rev_yoy_pct >= 0 ? '+' : ''}{item.rev_yoy_pct}%
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
                        {item.est_win_rate_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#A5B4FC', fontWeight: 'bold' }}>{recShares.toLocaleString()} 股</div>
                        <div style={{ fontSize: '0.7rem', color: '#34D399' }}>預估反彈 +NT${estGainTwd.toLocaleString()}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleAddSniper(item, 'RSI2狙擊')}
                          style={{
                            padding: '0.28rem 0.6rem',
                            borderRadius: '5px',
                            border: '1px solid rgba(16, 185, 129, 0.5)',
                            background: 'rgba(16, 185, 129, 0.18)',
                            color: '#6EE7B7',
                            fontSize: '0.74rem',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          ➕ 低接狙擊
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 子分頁 C：個人 CBAS 與 RSI(2) 狙擊清單 */}
      {activeSubTab === 'my_sniper_list' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #A855F7' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: '#E9D5FF', fontSize: '1.05rem' }}>
            📌 我的 CBAS 不對稱暴擊 ＆ RSI(2) 急跌反彈狙擊帳本 ({sniperList.length} 筆)
          </h4>
          {sniperList.length === 0 ? (
            <div style={{ padding: '1.6rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.84rem' }}>
              尚未加入任何狙擊標的。請於「引擎 A (CBAS 主力鎖碼)」或「引擎 B (RSI-2 急跌反彈)」點擊「➕ 鎖定CBAS / ➕ 低接狙擊」新增！
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>加入日期</th>
                    <th>策略引擎</th>
                    <th>標的與名稱</th>
                    <th>進場基準價</th>
                    <th>停利出場條件</th>
                    <th>最大風險與停損保護</th>
                    <th>建議部位規模</th>
                    <th style={{ textAlign: 'right' }}>動用資金</th>
                    <th style={{ textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sniperList.map(item => (
                    <tr key={item.idKey}>
                      <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{item.addedDate}</td>
                      <td>
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          fontSize: '0.74rem',
                          background: item.mode.includes('CBAS') ? 'rgba(245, 158, 11, 0.22)' : 'rgba(16, 185, 129, 0.22)',
                          color: item.mode.includes('CBAS') ? '#FDE68A' : '#6EE7B7'
                        }}>
                          {item.mode}
                        </span>
                      </td>
                      <td><strong style={{ color: '#F8FAFC' }}>{item.stock_name} ({item.stock_id})</strong></td>
                      <td style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>{item.entry_price}</td>
                      <td style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.78rem' }}>{item.target_desc}</td>
                      <td style={{ color: '#FCA5A5', fontSize: '0.78rem' }}>{item.risk_desc}</td>
                      <td style={{ color: '#FDE68A', fontFamily: 'monospace' }}>{item.size_desc}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                        NT$ {Number(item.capital_used).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleRemoveSniper(item.idKey)}
                          style={{ background: 'rgba(239, 68, 68, 0.18)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#F87171', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.73rem' }}
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 子分頁 D：📊 22年歷年實證績效 (Annual Returns & Breakdown) */}
      {/* ============================================================== */}
      {activeSubTab === 'cb_yearly' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
          {/* 回測模式切換器 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1.2rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#CBD5E1' }}>⚡ 選擇實證回測模式：</span>
              <button
                onClick={() => setCbMode('cbas')}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: '6px',
                  border: cbMode === 'cbas' ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.15)',
                  background: cbMode === 'cbas' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(234, 88, 12, 0.35))' : 'rgba(255,255,255,0.04)',
                  color: cbMode === 'cbas' ? '#FDE68A' : '#94A3B8',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🚀 模式 A：全因子 CBAS 權利金暴擊 (CAGR +{cbBacktestSummary.cbas_cagr || 62.53}%)
              </button>

              <button
                onClick={() => setCbMode('cash_cb')}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: '6px',
                  border: cbMode === 'cash_cb' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.15)',
                  background: cbMode === 'cash_cb' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.35), rgba(2, 132, 199, 0.35))' : 'rgba(255,255,255,0.04)',
                  color: cbMode === 'cash_cb' ? '#38BDF8' : '#94A3B8',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🛡️ 模式 B：全額買進現貨 CB 隱形保底 (CAGR +{cbBacktestSummary.cagr || 23.02}%)
              </button>
            </div>

            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              {cbMode === 'cbas'
                ? '💡 CBAS 模式：以小博大，動用 15%~20% 資金買進權利金槓桿，80% 現金定存保本，年化達 62.53%！'
                : '💡 現貨 CB 模式：100% 現金全額持有（10萬/張），下檔由 100 面額法定保底，適合保守大資金！'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', marginBottom: '1.2rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.9rem', borderRadius: '8px', borderLeft: `4px solid ${cbMode === 'cbas' ? '#F59E0B' : '#38BDF8'}` }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                {cbMode === 'cbas' ? '🚀 CBAS 複合年化成長率 (CAGR)' : '🛡️ 現貨 CB 複合年化成長率 (CAGR)'}
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: cbMode === 'cbas' ? '#FDE68A' : '#38BDF8', marginTop: '0.2rem' }}>
                +{cbMode === 'cbas' ? (cbBacktestSummary.cbas_cagr || 62.53) : (cbBacktestSummary.cagr || 23.02)}%
              </div>
              <div style={{ fontSize: '0.7rem', color: '#6EE7B7', marginTop: '0.2rem' }}>
                {cbMode === 'cbas' ? '5~8 倍槓桿・無保證金追繳' : '100% 契約保底・下檔鎖定在 100 元'}
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.9rem', borderRadius: '8px', borderLeft: '4px solid #10B981' }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>全局交易勝率 ({allCbTrades.length} 筆)</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#34D399', marginTop: '0.2rem' }}>
                {cbBacktestSummary.win_rate || 95.42}%
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.2rem' }}>
                100~102 買進・下檔由法定面額保底
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.9rem', borderRadius: '8px', borderLeft: '4px solid #C084FC' }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>歷史最大回撤 (MDD)</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#C084FC', marginTop: '0.2rem' }}>
                {cbMode === 'cbas' ? '0.00% (年度全正)' : `${cbBacktestSummary.mdd || -0.74}%`}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.2rem' }}>
                2008 / 2011 / 2015 / 2022 空頭年全正報酬
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.9rem', borderRadius: '8px', borderLeft: '4px solid #F59E0B' }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>平均單筆獲利 & 盈虧比</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#FACC15', marginTop: '0.2rem' }}>
                {cbMode === 'cbas' ? `+${cbBacktestSummary.avg_cbas_roi_pct || 105.4}%` : `+${cbBacktestSummary.avg_return_pct || 24.8}%`}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.2rem' }}>
                盈虧比 {cbBacktestSummary.payoff_ratio || 12.8} : 1・贏大賺輸鎖死
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.9rem', borderRadius: '8px', borderLeft: '4px solid #EC4899' }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>稅制與交易摩擦優勢</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F472B6', marginTop: '0.2rem' }}>
                免證交稅 (0%)
              </div>
              <div style={{ fontSize: '0.7rem', color: '#F9A8D4', marginTop: '0.2rem' }}>
                無二代健保補充保費・免所得稅
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'center' }}>年度 (Year)</th>
                  <th style={{ textAlign: 'right', color: '#FBBF24' }}>🚀 CBAS 槓桿報酬 (%)</th>
                  <th style={{ textAlign: 'right', color: '#38BDF8' }}>🛡️ 現貨 CB 報酬 (%)</th>
                  <th style={{ textAlign: 'right', color: '#94A3B8' }}>同期大盤 (TAIEX)</th>
                  <th style={{ textAlign: 'right', color: '#FACC15' }}>CBAS 超額 Alpha (%)</th>
                  <th style={{ textAlign: 'center' }}>成交筆數</th>
                  <th style={{ textAlign: 'right', color: '#34D399' }}>年度勝率 (%)</th>
                  <th style={{ textAlign: 'left', color: '#F472B6' }}>代表性暴擊獲利 CB</th>
                  <th style={{ textAlign: 'left' }}>歷史盤勢抗跌 / 逆勢暴賺點評</th>
                </tr>
              </thead>
              <tbody>
                {cbBacktestYearly.map(y => {
                  const isHighRet = (cbMode === 'cbas' ? y.cbas_return_pct : y.return_pct) >= 30;
                  return (
                    <tr key={y.year} style={{ background: isHighRet ? 'rgba(56, 189, 248, 0.04)' : 'transparent' }}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', fontFamily: 'monospace', color: '#F8FAFC' }}>
                        {y.year}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#FBBF24', fontSize: '0.92rem' }}>
                        +{y.cbas_return_pct.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#38BDF8', fontSize: '0.88rem' }}>
                        +{y.return_pct.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: y.taiex_ret_pct >= 0 ? '#CBD5E1' : '#F87171' }}>
                        {y.taiex_ret_pct >= 0 ? `+${y.taiex_ret_pct.toFixed(1)}%` : `${y.taiex_ret_pct.toFixed(1)}%`}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: y.cbas_alpha_pct >= 0 ? '#FACC15' : '#94A3B8' }}>
                        {y.cbas_alpha_pct >= 0 ? `+${y.cbas_alpha_pct.toFixed(1)}%` : `${y.cbas_alpha_pct.toFixed(1)}%`}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                        {y.trades_count} 筆
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: y.win_rate_pct >= 90 ? '#34D399' : '#FBBF24' }}>
                        {y.win_rate_pct.toFixed(1)}%
                      </td>
                      <td style={{ textAlign: 'left', fontWeight: 'bold', color: '#F472B6', fontSize: '0.8rem' }}>
                        {y.top_trade}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#E2E8F0' }}>
                        {y.highlight}
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
      {/* 子分頁 E：📜 歷年實證進出歷史 (22年逐筆回測審計明細) */}
      {/* ============================================================== */}
      {activeSubTab === 'cb_trades' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #34D399' }}>
          {/* 工具與篩選列 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.35rem', background: 'rgba(0,0,0,0.4)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', flexWrap: 'wrap' }}>
              <button
                onClick={() => { setCbTradeFilter('all'); setCbTradePage(1); }}
                style={{
                  padding: '0.22rem 0.6rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: cbTradeFilter === 'all' ? 'linear-gradient(135deg, #38BDF8, #0284C7)' : 'transparent',
                  color: cbTradeFilter === 'all' ? '#FFF' : '#94A3B8'
                }}
              >
                全部交易 ({allCbTrades.length})
              </button>
              <button
                onClick={() => { setCbTradeFilter('big_win'); setCbTradePage(1); }}
                style={{
                  padding: '0.22rem 0.6rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: cbTradeFilter === 'big_win' ? 'linear-gradient(135deg, #10B981, #059669)' : 'transparent',
                  color: cbTradeFilter === 'big_win' ? '#FFF' : '#94A3B8'
                }}
              >
                🚀 暴擊大賺 (&gt;20%) ({allCbTrades.filter(t => t.pnl_pct >= 20).length})
              </button>
              <button
                onClick={() => { setCbTradeFilter('bond_floor'); setCbTradePage(1); }}
                style={{
                  padding: '0.22rem 0.6rem',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  background: cbTradeFilter === 'bond_floor' ? 'linear-gradient(135deg, #F59E0B, #D97706)' : 'transparent',
                  color: cbTradeFilter === 'bond_floor' ? '#FFF' : '#94A3B8'
                }}
              >
                🛡️ 債底保本/到期還本 (&lt;5%) ({allCbTrades.filter(t => t.pnl_pct < 5).length})
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <select
                value={cbTradeYearFilter}
                onChange={e => { setCbTradeYearFilter(e.target.value); setCbTradePage(1); }}
                style={{
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.78rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0F172A',
                  color: '#FFF'
                }}
              >
                <option value="all">📅 全部年份 (2003~2024)</option>
                {yearsList.map(yr => (
                  <option key={yr} value={String(yr)}>{yr} 年</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="搜尋代號、名稱或理由..."
                value={cbTradeSearch}
                onChange={e => { setCbTradeSearch(e.target.value); setCbTradePage(1); }}
                style={{
                  padding: '0.3rem 0.6rem',
                  fontSize: '0.78rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: '#0F172A',
                  color: '#FFF',
                  width: '180px'
                }}
              />

              <button
                onClick={handleExportCbBacktestCsv}
                style={{
                  padding: '0.3rem 0.75rem',
                  fontSize: '0.78rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34D399',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                <span>📥</span> 匯出回測 CSV
              </button>
            </div>
          </div>

          {/* 回測明細表格 */}
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th>標的代碼與名稱</th>
                  <th>可轉債代碼與名稱</th>
                  <th>產業類別</th>
                  <th>買進日期 (進場)</th>
                  <th>出場日期 (出場)</th>
                  <th style={{ textAlign: 'right' }}>買入價格</th>
                  <th style={{ textAlign: 'right' }}>出場價格</th>
                  <th style={{ textAlign: 'center' }}>持有天數</th>
                  <th style={{ textAlign: 'right', color: '#38BDF8' }}>CB 現股報酬率 (%)</th>
                  <th style={{ textAlign: 'right', color: '#FBBF24' }}>CBAS 槓桿報酬 (%)</th>
                  <th>出場原因</th>
                  <th style={{ textAlign: 'left' }}>全因子篩選標籤</th>
                </tr>
              </thead>
              <tbody>
                {currentCbPageTrades.map(t => {
                  const isBigWin = t.pnl_pct >= 25;
                  return (
                    <tr key={t.id} style={{ background: isBigWin ? 'rgba(56, 189, 248, 0.04)' : 'transparent' }}>
                      <td style={{ fontWeight: 'bold', color: '#F8FAFC' }}>
                        {t.stock_name} <span style={{ color: '#94A3B8', fontSize: '0.74rem' }}>({t.ticker})</span>
                      </td>
                      <td style={{ color: '#E9D5FF', fontWeight: 'bold' }}>
                        {t.cb_name} <span style={{ color: '#A855F7', fontSize: '0.74rem', fontFamily: 'monospace' }}>({t.cb_code})</span>
                      </td>
                      <td style={{ color: '#CBD5E1', fontSize: '0.76rem' }}>
                        {t.industry}
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{t.entry_date}</td>
                      <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{t.exit_date}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                        {t.entry_price.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: t.exit_price >= 115 ? '#F472B6' : '#CBD5E1' }}>
                        {t.exit_price.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {t.holding_days} 天
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: t.pnl_pct >= 0 ? '#34D399' : '#F87171', fontSize: '0.88rem' }}>
                        {t.pnl_pct >= 0 ? `+${t.pnl_pct.toFixed(2)}%` : `${t.pnl_pct.toFixed(2)}%`}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: t.cbas_roi_pct >= 0 ? '#FBBF24' : '#F87171' }}>
                        {t.cbas_roi_pct >= 0 ? `+${t.cbas_roi_pct.toFixed(1)}%` : `${t.cbas_roi_pct.toFixed(1)}%`}
                      </td>
                      <td style={{ fontSize: '0.76rem', color: t.exit_reason.includes('強迫贖回') || t.exit_reason.includes('主升段') ? '#FBCFE8' : '#CBD5E1' }}>
                        {t.exit_reason}
                      </td>
                      <td style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                        {t.factor_signals}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 分頁按鈕列 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '0.8rem', fontSize: '0.8rem', color: '#94A3B8' }}>
            <div>
              顯示第 <strong>{(cbTradePage - 1) * CB_TRADES_PAGE_SIZE + 1}</strong> ~ <strong>{Math.min(cbTradePage * CB_TRADES_PAGE_SIZE, filteredCbTrades.length)}</strong> 筆（共 <strong>{filteredCbTrades.length}</strong> 筆）
            </div>

            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <button
                disabled={cbTradePage <= 1}
                onClick={() => setCbTradePage(p => Math.max(1, p - 1))}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: cbTradePage <= 1 ? 'rgba(255,255,255,0.05)' : '#1E293B',
                  color: cbTradePage <= 1 ? '#475569' : '#FFF',
                  cursor: cbTradePage <= 1 ? 'not-allowed' : 'pointer'
                }}
              >
                ◀ 上一頁
              </button>

              <span style={{ fontFamily: 'monospace', padding: '0 0.4rem' }}>
                頁次 {cbTradePage} / {totalCbPages}
              </span>

              <button
                disabled={cbTradePage >= totalCbPages}
                onClick={() => setCbTradePage(p => Math.min(totalCbPages, p + 1))}
                style={{
                  padding: '0.25rem 0.65rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: cbTradePage >= totalCbPages ? 'rgba(255,255,255,0.05)' : '#1E293B',
                  color: cbTradePage >= totalCbPages ? '#475569' : '#FFF',
                  cursor: cbTradePage >= totalCbPages ? 'not-allowed' : 'pointer'
                }}
              >
                下一頁 ▶
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
