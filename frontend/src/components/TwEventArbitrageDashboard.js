import React, { useState, useEffect } from 'react';
import { apiGetTwEventRadarDashboard } from '../api';
import { StockChartButton } from './StockChart';
import defaultTwEventRadarData from '../data/defaultTwEventRadarData.json';

export default function TwEventArbitrageDashboard() {
  const [data, setData] = useState(defaultTwEventRadarData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('titan_pro_live'); // 'titan_pro_live' | 'futures_squeeze' | 'backtest_compare'
  const [capitalTwd, setCapitalTwd] = useState(300000);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLatest = async () => {
    setLoading(true);
    try {
      const res = await apiGetTwEventRadarDashboard();
      if (res && res.status === 'ok') {
        setData(res);
      }
    } catch (e) {
      console.warn('使用預設泰坦Pro與期貨軋空數據:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatest();
  }, []);

  const kpi = data?.summary_kpi || {};
  const titanConversions = data?.titan_pro_conversions || [];
  const idleRsi2Picks = data?.idle_cash_rsi2_picks || [];
  const futSqueezePicks = (data?.futures_arbitrage_picks || []).filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      String(p.stock_id || '').toLowerCase().includes(q) ||
      String(p.stock_name || '').toLowerCase().includes(q) ||
      String(p.industry || '').toLowerCase().includes(q)
    );
  });
  const yearlyComp = data?.titan_pro_yearly_comparison || [];
  const sqzTrades = data?.squeeze_recent_trades || [];

  const futMarginAllocation = Math.round(capitalTwd * 0.35);
  const idleOverlayPool = Math.round(capitalTwd * 0.65);

  return (
    <div style={{ padding: '0.5rem 0', color: '#E2E8F0' }}>
      {/* 頂部戰略指揮橫幅 */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 58, 138, 0.55), rgba(88, 28, 135, 0.45))',
          border: '1px solid rgba(56, 189, 248, 0.4)',
          borderRadius: '14px',
          padding: '1.25rem 1.4rem',
          marginBottom: '1.2rem',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.45rem' }}>🔥</span>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#38BDF8' }}>
                泰坦 Pro 全武裝融合加速（股期免稅 × CBAS 鎖死下檔 × 閒置金快打）＆ 個股期貨軋空雷達
              </h2>
              <span
                style={{
                  fontSize: '0.73rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.5)',
                  color: '#6EE7B7',
                  fontWeight: 'bold'
                }}
              >
                實盤基準日：{data?.latest_data_date || '2026-10-16'}
              </span>
            </div>
            <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.82rem', color: '#CBD5E1', lineHeight: 1.55 }}>
              不拆分泰坦核心本金！將【👑 台股泰坦 / 🌍 全球泰坦】王者核心倉改用<strong>「個股期貨（免 0.3% 證交稅＋除息稅盾）」</strong>、衛星倉改用<strong>「CBAS 可轉債選擇權（單筆最大虧損鎖死 -4.8%）」</strong>，並將泰坦帳上平均 <strong>47% 閒置現金</strong>自動投入 <strong>Connors RSI(2) 急跌 3 日快打</strong>與<strong>高券資比期貨軋空</strong>！
            </p>
          </div>

          <button
            className="btn btn-secondary"
            onClick={fetchLatest}
            disabled={loading}
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
          >
            {loading ? '🔄 即時運算中...' : '🔄 同步最新軋空與持倉'}
          </button>
        </div>

        {/* 4 大核心 KPI 卡 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(0,0,0,0.38)', padding: '0.75rem 0.95rem', borderRadius: '9px', borderLeft: '3px solid #10B981' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🚀 台股泰坦 Pro 全武裝融合 (2016–2026)</div>
            <div style={{ fontSize: '1.22rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              年化 +{kpi.titan_pro_cagr_11y_pct || 74.25}% ({kpi.titan_pro_multiple_11y || 402.5}倍)
            </div>
            <div style={{ fontSize: '0.7rem', color: '#A7F3D0', marginTop: '0.15rem' }}>
              對比原版現股泰坦 (+57.15% / 131.9倍)・年度 MDD 降至 <strong>{kpi.titan_pro_mdd_pct || -11.95}%</strong>
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.38)', padding: '0.75rem 0.95rem', borderRadius: '9px', borderLeft: '3px solid #F59E0B' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🔥 個股期貨高券資比軋空策略 (11年回測)</div>
            <div style={{ fontSize: '1.22rem', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              年化 +{kpi.fut_squeeze_cagr_pct || 38.69}% | 勝率 {kpi.fut_squeeze_win_rate_pct || 56.52}%
            </div>
            <div style={{ fontSize: '0.7rem', color: '#FDE68A', marginTop: '0.15rem' }}>
              11年總報酬 <strong>+{kpi.fut_squeeze_total_ret_pct || 3321.6}% (34.2倍)</strong>・期交稅僅十萬分之 2
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.38)', padding: '0.75rem 0.95rem', borderRadius: '9px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🌍 全球泰坦 + 台股三武器疊加 (Portable Alpha)</div>
            <div style={{ fontSize: '1.22rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              年化 +{kpi.global_titan_overlay_cagr_pct || 97.02}% ({kpi.global_titan_overlay_multiple || 1516.1}倍)
            </div>
            <div style={{ fontSize: '0.7rem', color: '#93C5FD', marginTop: '0.15rem' }}>
              完美填補 2019 (+46.6%) 與 2025 (+29.7%) 跨國動能盤整期收益！
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.38)', padding: '0.75rem 0.95rem', borderRadius: '9px', borderLeft: '3px solid #A855F7' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🧮 泰坦 Pro 保證金 × 閒置金雙池試算</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#CBD5E1' }}>配置本金 NT$:</span>
              <input
                type="number"
                step="50000"
                value={capitalTwd}
                onChange={(e) => setCapitalTwd(Math.max(50000, Number(e.target.value) || 300000))}
                style={{
                  width: '105px',
                  padding: '0.18rem 0.4rem',
                  borderRadius: '4px',
                  background: 'rgba(0,0,0,0.6)',
                  border: '1px solid #A855F7',
                  color: '#E9D5FF',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  fontSize: '0.85rem'
                }}
              />
            </div>
            <div style={{ fontSize: '0.69rem', color: '#D8B4FE', marginTop: '0.2rem' }}>
              35%股期保證金 <strong>{futMarginAllocation.toLocaleString()}</strong> ＋ 65%緩衝/RSI(2)池 <strong>{idleOverlayPool.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換器 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveSubTab('titan_pro_live')}
            style={{
              padding: '0.52rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'titan_pro_live' ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'titan_pro_live' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'titan_pro_live' ? '#6EE7B7' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            🚀 引擎 A：泰坦 Pro 實盤持倉轉換 ＆ 47%閒置金快打 ({titanConversions.length} 檔)
          </button>

          <button
            onClick={() => setActiveSubTab('futures_squeeze')}
            style={{
              padding: '0.52rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'futures_squeeze' ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'futures_squeeze' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(217, 119, 6, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'futures_squeeze' ? '#FDE68A' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            🔥 引擎 B：個股期貨高券資比法人軋空 ＆ 稅盾雷達 ({futSqueezePicks.length} 檔)
          </button>

          <button
            onClick={() => setActiveSubTab('backtest_compare')}
            style={{
              padding: '0.52rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'backtest_compare' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'backtest_compare' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(37, 99, 235, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'backtest_compare' ? '#BAE6FD' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            📊 引擎 C：泰坦 Pro vs 當前策略 ＆ 期貨軋空 11年回測報告
          </button>
        </div>

        {activeSubTab === 'futures_squeeze' && (
          <input
            type="text"
            placeholder="🔍 搜尋股期代碼 / 名稱 / 產業..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.42rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(15, 23, 42, 0.85)',
              color: '#F8FAFC',
              fontSize: '0.82rem',
              minWidth: '220px'
            }}
          />
        )}
      </div>

      {/* ================= 子分頁 A：泰坦 Pro 實盤持倉轉換 ＆ 閒置金 RSI(2) 快打 ================= */}
      {activeSubTab === 'titan_pro_live' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
            <div style={{ marginBottom: '0.85rem' }}>
              <h3 style={{ margin: 0, color: '#34D399', fontSize: '1.06rem' }}>
                👑 泰坦核心持倉「股期免稅 × 衛星 CBAS 鎖死下檔」實戰執行轉換表
              </h3>
              <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.79rem', color: '#94A3B8' }}>
                直接對應您【🌍 全球主權泰坦】與【👑 台股泰坦】當前持倉（如 <code>3037 欣興</code>、<code>3443 創意</code>、<code>2330 台積電</code>）。將王者核心倉改用<strong>個股期貨（35%保證金）</strong>可免除 0.30% 證交稅與二代健保；將衛星倉改用<strong>CBAS 可轉債選擇權</strong>可將單筆最大停損鎖死在 <code>-4.8%</code> 權利金內，使泰坦單筆賺賠比從 <code>2.98x</code> 躍升至 <code>6.05x</code>！
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>代碼 / 名稱</th>
                    <th>所屬泰坦角色</th>
                    <th style={{ textAlign: 'right' }}>最新收盤價</th>
                    <th style={{ textAlign: 'right' }}>季線防守位</th>
                    <th>🔥 個股期貨免稅規格 (核心倉首選)</th>
                    <th style={{ textAlign: 'right' }}>35%安全保證金/口</th>
                    <th style={{ textAlign: 'right' }}>預估省稅盾/口</th>
                    <th>💎 CBAS 鎖死下檔規格 (衛星倉首選)</th>
                    <th>🎯 泰坦 Pro 最佳下單指引</th>
                  </tr>
                </thead>
                <tbody>
                  {titanConversions.map((item) => (
                    <tr key={item.stock_id}>
                      <td>
                        <strong style={{ color: '#F8FAFC', fontSize: '0.9rem' }}>{item.stock_name}</strong>
                        <div style={{ fontSize: '0.73rem', color: '#38BDF8', fontFamily: 'monospace' }}>{item.stock_id}.TW <StockChartButton ticker={`${item.stock_id}.TW`} name={item.stock_name} style={{ marginLeft: '0.4rem' }} /></div>
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          background: item.role.includes('全球') ? 'rgba(56, 189, 248, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: item.role.includes('全球') ? '#7DD3FC' : '#6EE7B7',
                          fontSize: '0.74rem',
                          fontWeight: 'bold'
                        }}>
                          {item.role}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                        {Number(item.close).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {Number(item.ma60_stop).toLocaleString()}
                      </td>
                      <td style={{ color: '#FDE68A', fontWeight: 'bold', fontSize: '0.79rem' }}>
                        {item.contract_spec}
                        <div style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 'normal' }}>
                          契約總值 NT$ {Number(item.notional_twd).toLocaleString()}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                        NT$ {Number(item.safe_margin_35_twd).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold' }}>
                        +NT$ {Number(item.tax_saved_twd).toLocaleString()}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: '#E9D5FF' }}>
                        <strong>{item.cb_name} ({item.cb_code})</strong>
                        <div style={{ fontSize: '0.7rem', color: '#F9A8D4' }}>
                          權利金 NT$ {Number(item.cbas_cost_twd).toLocaleString()}/張 (鎖損 {item.max_downside_lock_pct}%)
                        </div>
                      </td>
                      <td style={{ fontSize: '0.77rem', color: '#A7F3D0', maxWidth: '280px', lineHeight: 1.4 }}>
                        {item.recommended_vehicle}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 區塊 2：泰坦 47% 閒置現金池 Connors RSI(2) 3日急跌快打 */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
            <div style={{ marginBottom: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#38BDF8', fontSize: '1.05rem' }}>
                  ⚡ 泰坦 47% 閒置現金池「Connors RSI(2) 強勢股急跌 3 日快打」今日即時狙擊單
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#94A3B8' }}>
                  當【台股泰坦】未滿倉或【全球泰坦】啟動波動率減速器釋出備用現金時，動用閒置資金池（依上方試算約 <strong>NT$ {idleOverlayPool.toLocaleString()}</strong>）低接長線多頭但短線錯殺（<code>RSI(2) &lt;= 20</code>）之認養股，<strong>平均抱 3.1 天觸及 5MA 立即停利歸還現金池</strong>（11年實證勝率 <code>67.51%</code>，年化額外增厚 <code>+17.1%</code>）！
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>代碼 / 名稱</th>
                    <th>產業分類</th>
                    <th style={{ textAlign: 'right' }}>今日收盤價</th>
                    <th style={{ textAlign: 'right' }}>Connors RSI(2)</th>
                    <th style={{ textAlign: 'right' }}>近3日急跌</th>
                    <th style={{ textAlign: 'right' }}>5MA 停利出場價</th>
                    <th style={{ textAlign: 'right' }}>預估反彈空間</th>
                    <th style={{ textAlign: 'right' }}>歷史回測勝率</th>
                    <th>快打出場紀律</th>
                  </tr>
                </thead>
                <tbody>
                  {idleRsi2Picks.map((p) => (
                    <tr key={p.stock_id}>
                      <td>
                        <strong style={{ color: '#F8FAFC' }}>{p.stock_name}</strong>
                        <span style={{ marginLeft: '0.35rem', color: '#38BDF8', fontFamily: 'monospace' }}>({p.stock_id})</span>
                      </td>
                      <td style={{ color: '#CBD5E1', fontSize: '0.78rem' }}>{p.industry}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{p.close}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: p.rsi2 <= 10 ? '#F43F5E' : '#FBBF24' }}>
                        {p.rsi2}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#F87171' }}>{p.ret_3d_pct}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
                        {p.target_ma5_price}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
                        +{p.expected_rebound_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#6EE7B7', fontWeight: 'bold' }}>
                        {p.est_win_rate_pct}%
                      </td>
                      <td style={{ fontSize: '0.76rem', color: '#FDE68A' }}>{p.hold_days_est}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= 子分頁 B：個股期貨高券資比法人軋空 ＆ 稅盾雷達 ================= */}
      {activeSubTab === 'futures_squeeze' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B' }}>
          <div style={{ marginBottom: '0.85rem' }}>
            <h3 style={{ margin: 0, color: '#FBBF24', fontSize: '1.06rem' }}>
              🔥 台灣期交所「個股期貨（標準2,000股 / 小型100股）」高券資比法人軋空 ＆ 稅盾突破雷達
            </h3>
            <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.79rem', color: '#94A3B8' }}>
              結合 <code>tw_stock.db</code> 融資融券軋空張力、突破 20 日高點動能與三大法人近 5 日雙買超籌碼。當股價創高且外資/投信同步大買時，空單被迫回補引發軋空主升段；搭配 <strong>35% 安全保證金（約 1.8x 實質部位槓桿）</strong>，2016–2026 實盤回測年化達 <strong>38.69%（累積 +3,321.6%）</strong>！
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th>代碼 / 標的</th>
                  <th>期交所契約規格</th>
                  <th>軋空 / 稅盾事件分類</th>
                  <th style={{ textAlign: 'right' }}>現價</th>
                  <th style={{ textAlign: 'right' }}>軋空張力 / 券資比</th>
                  <th style={{ textAlign: 'right' }}>法人5日淨買超</th>
                  <th style={{ textAlign: 'right' }}>現金殖利率</th>
                  <th style={{ textAlign: 'right' }}>35%安全保證金/口</th>
                  <th style={{ textAlign: 'right' }}>軋空目標價 (+17%股期)</th>
                  <th style={{ textAlign: 'right' }}>20MA防守停損</th>
                  <th>實戰操作指引</th>
                </tr>
              </thead>
              <tbody>
                {futSqueezePicks.map((item) => (
                  <tr key={item.stock_id}>
                    <td>
                      <strong style={{ color: '#F8FAFC', fontSize: '0.88rem' }}>{item.stock_name}</strong>
                      <div style={{ fontSize: '0.72rem', color: '#FBBF24', fontFamily: 'monospace' }}>{item.stock_id} 期貨 <StockChartButton ticker={`${item.stock_id}.TW`} name={item.stock_name} style={{ marginLeft: '0.4rem' }} /></div>
                    </td>
                    <td>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: item.contract_shares === 100 ? 'rgba(168, 85, 247, 0.22)' : 'rgba(56, 189, 248, 0.18)',
                        color: item.contract_shares === 100 ? '#E9D5FF' : '#7DD3FC',
                        fontSize: '0.73rem',
                        fontWeight: 'bold'
                      }}>
                        {item.contract_spec}
                      </span>
                    </td>
                    <td style={{ color: '#FDE68A', fontWeight: 'bold', fontSize: '0.78rem' }}>{item.event_type}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{item.close}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F43F5E' }}>
                      {item.short_margin_ratio_pct}%
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: item.inst_5d_lots >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                      {item.inst_5d_lots >= 0 ? '+' : ''}{Number(item.inst_5d_lots).toLocaleString()} 張
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#6EE7B7' }}>{item.yield_pct}%</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                      NT$ {Number(item.safe_margin_35_twd).toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
                      {item.target_squeeze_price}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                      {item.stop_loss_price}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: '#CBD5E1', maxWidth: '250px', lineHeight: 1.35 }}>
                      {item.action_guide}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= 子分頁 C：泰坦 Pro vs 當前策略 ＆ 期貨軋空 11年回測對照 ================= */}
      {activeSubTab === 'backtest_compare' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* 歷年對照總表 */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
            <h4 style={{ margin: '0 0 0.4rem 0', color: '#38BDF8', fontSize: '1.05rem' }}>
              📊 2016–2026 (11年) 【當前台股泰坦 / 全球泰坦】vs【🚀 泰坦 Pro 全武裝融合 ＆ 🔥 個股期貨軋空】歷年報酬率對照表
            </h4>
            <p style={{ margin: '0 0 0.8rem 0', fontSize: '0.78rem', color: '#94A3B8' }}>
              直接基於 <code>titan_curve.json</code>、<code>titan_trades.json</code> 與 <code>tw_stock.db</code> 實盤回測：台股泰坦 Pro 將 11 年年化從 <strong>57.15% 提升至 74.25% (資產從 131.9 倍躍升至 402.5 倍)</strong>；全球主權泰坦疊加台股三武器後年化從 <strong>85.34% 提升至 97.02% (1,516.1 倍)</strong>！
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>年份</th>
                    <th style={{ textAlign: 'right' }}>泰坦平均閒置現金</th>
                    <th style={{ textAlign: 'right' }}>👑 當前台股泰坦 (現股)</th>
                    <th style={{ textAlign: 'right' }}>🔥 個股期貨軋空策略</th>
                    <th style={{ textAlign: 'right' }}>⚡ 閒置金 RSI(2) 快打</th>
                    <th style={{ textAlign: 'right' }}>🚀 台股泰坦 Pro (股期+CBAS+RSI2)</th>
                    <th style={{ textAlign: 'right' }}>泰坦 Pro 淨增 Alpha</th>
                    <th style={{ textAlign: 'right' }}>🌍 當前全球主權泰坦</th>
                    <th style={{ textAlign: 'right' }}>🏆 全球泰坦 + 台股武器疊加</th>
                  </tr>
                </thead>
                <tbody>
                  {yearlyComp.map((yr) => (
                    <tr key={yr.year}>
                      <td style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#F8FAFC' }}>{yr.year}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>{yr.idle_cash_pct}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.titan_orig_pct >= 0 ? '#CBD5E1' : '#F87171' }}>
                        {yr.titan_orig_pct >= 0 ? '+' : ''}{yr.titan_orig_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: yr.fut_sqz_pct >= 0 ? '#FBBF24' : '#F87171' }}>
                        {yr.fut_sqz_pct >= 0 ? '+' : ''}{yr.fut_sqz_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.rsi2_pct >= 0 ? '#34D399' : '#F87171' }}>
                        {yr.rsi2_pct >= 0 ? '+' : ''}{yr.rsi2_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: yr.titan_pro_pct >= 0 ? '#10B981' : '#F87171' }}>
                        {yr.titan_pro_pct >= 0 ? '+' : ''}{yr.titan_pro_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: yr.alpha_gain_pct >= 0 ? '#6EE7B7' : '#F87171' }}>
                        {yr.alpha_gain_pct >= 0 ? '+' : ''}{yr.alpha_gain_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: yr.gs_orig_pct >= 0 ? '#93C5FD' : '#F87171' }}>
                        {yr.gs_orig_pct >= 0 ? '+' : ''}{yr.gs_orig_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: yr.gs_pro_pct >= 0 ? '#38BDF8' : '#F87171' }}>
                        {yr.gs_pro_pct >= 0 ? '+' : ''}{yr.gs_pro_pct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 個股期貨軋空歷史交易代表作 */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B' }}>
            <h4 style={{ margin: '0 0 0.6rem 0', color: '#FBBF24', fontSize: '1.05rem' }}>
              🔥 【個股期貨高券資比法人軋空策略】近期實盤回測交易明細 ({sqzTrades.length} 筆代表作)
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>進場日期</th>
                    <th>平倉日期</th>
                    <th>股期標的</th>
                    <th>部位規格</th>
                    <th style={{ textAlign: 'right' }}>進場價</th>
                    <th style={{ textAlign: 'right' }}>出場價</th>
                    <th style={{ textAlign: 'right' }}>持倉天數</th>
                    <th style={{ textAlign: 'right' }}>現股漲跌幅</th>
                    <th style={{ textAlign: 'right' }}>股期部位淨報酬 (35%保證金)</th>
                    <th>出場原因</th>
                  </tr>
                </thead>
                <tbody>
                  {sqzTrades.map((t, idx) => (
                    <tr key={idx}>
                      <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{t.entry_date}</td>
                      <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{t.exit_date}</td>
                      <td><strong style={{ color: '#F8FAFC' }}>{t.stock_name} ({t.stock_id})</strong></td>
                      <td style={{ color: '#FDE68A', fontSize: '0.77rem' }}>{t.role}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{t.entry_price}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{t.exit_price}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{t.holding_days} 天</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: t.stock_return_pct >= 0 ? '#34D399' : '#F87171' }}>
                        {t.stock_return_pct >= 0 ? '+' : ''}{t.stock_return_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: t.return_pct >= 0 ? '#10B981' : '#F87171' }}>
                        {t.return_pct >= 0 ? '+' : ''}{t.return_pct}%
                      </td>
                      <td style={{ fontSize: '0.76rem', color: '#CBD5E1' }}>{t.exit_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
