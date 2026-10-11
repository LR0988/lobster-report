import React, { useState, useEffect } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('current_picks'); // 'current_picks', 'history', 'recent_trades', 'doe_audit'

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
  const oldSovereign = kpi?.old_sovereign_dual || {};
  const currentPicks = data?.current_picks || [];
  const yearly = data?.yearly_performance || [];
  const recentTrades = data?.recent_trades || [];

  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* 頂部標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#60A5FA', fontSize: '1.5rem' }}>
            👑 全球高流動性泰坦旗艦（方案 A - 國內券商直接可買）
          </h2>
          <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            國內券商 100% 可買池（台股龍頭 ＋ 美股那斯達克 100 ＋ S&P 500 ＋ 全球 ADR） ➔ 2,240 組全量 DOE 最佳化旗艦
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

      {/* 核心 KPI 指標卡片 (方案 A vs 舊版雙雄 vs 標普500) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.8rem' }}>
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #10B981', background: 'rgba(16, 185, 129, 0.12)' }}>
          <div style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            👑 方案 A 旗艦 (Top 4 階梯 40/25/20/15)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: '#10B981' }}>
            +{schemeA.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.78rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
            翻 <strong>{schemeA.mult?.toLocaleString()} 倍</strong> | CAGR <strong>{schemeA.cagr}%</strong> | MDD <strong>{schemeA.mdd}%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#6EE7B7', marginTop: '0.2rem' }}>
            Calmar <strong>{schemeA.calmar} (全場冠軍)</strong> | 勝率 <strong>{schemeA.win_rate}%</strong>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #6366F1' }}>
          <div style={{ fontSize: '0.82rem', color: '#818CF8', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            🥈 Top 3 精簡方案 (階梯 40/30/30)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: '#818CF8' }}>
            +626,071%
          </div>
          <div style={{ fontSize: '0.78rem', color: '#C7D2FE', marginTop: '0.2rem' }}>
            翻 <strong>6,262 倍</strong> | CAGR <strong>46.73%</strong> | MDD <strong>-29.96%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#A5B4FC', marginTop: '0.2rem' }}>
            Calmar <strong>1.560</strong> | 回撤成功壓入 30% 以內
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #3B82F6' }}>
          <div style={{ fontSize: '0.82rem', color: '#60A5FA', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            🌐 先分國家版 (舊主權雙雄 50/50)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 'bold', color: '#60A5FA' }}>
            +{oldSovereign.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.78rem', color: '#93C5FD', marginTop: '0.2rem' }}>
            翻 <strong>{oldSovereign.mult} 倍</strong> | CAGR <strong>{oldSovereign.cagr}%</strong> | MDD <strong>{oldSovereign.mdd}%</strong>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#93C5FD', marginTop: '0.2rem' }}>
            需跨國帳戶與冷門市場換匯
          </div>
        </div>

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
        padding: '1.5rem',
        marginBottom: '2rem',
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
                方案 A 即時宏觀風控狀態
              </span>
              <span style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold' }}>
                {macro.regime || '牛市滿倉 (100% 倉位運作)'}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#F3F4F6' }}>
              標普 500 (SPY): ${macro.spy_price} ＞ 年線 200MA: ${macro.spy_ma200}
            </h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              大盤穩站年線之上，安全氣囊判定多頭有效 ➔ <strong>允許 100% 滿倉進攻最強 4 檔王權股</strong>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: '220px' }}>
          <div style={{ fontSize: '0.82rem', color: '#34D399', marginBottom: '0.4rem' }}>
            💡 方案 A 實盤下單配置權重
          </div>
          <div style={{ background: 'rgba(15, 23, 42, 0.7)', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '0.88rem', color: '#F9FAFB', fontWeight: 'bold' }}>
              Top 4: 40% / 25% / 20% / 15%
            </div>
            <div style={{ fontSize: '0.8rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
              台股現股 ＋ 國內複委託 1 秒買齊
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換按鈕 */}
      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem', flexWrap: 'wrap' }}>
        <button
          className={`btn ${activeSubTab === 'current_picks' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('current_picks')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          👑 方案 A 最新實盤持倉推薦 ({currentPicks.filter(p => p.is_active).length} 檔)
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
          🔬 2,240 組 DOE 參數優化與除權息審計報告
        </button>
        <button
          className={`btn ${activeSubTab === 'exit_mechanisms' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('exit_mechanisms')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', border: activeSubTab === 'exit_mechanisms' ? '1px solid #10B981' : undefined }}
        >
          🛡️ 出場機制與守住獲利成效對比 (6大策略)
        </button>
      </div>

      {/* 區塊 1: 當前實盤持倉名單 */}
      {activeSubTab === 'current_picks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* 當前實戰持有中部位卡片 */}
          <div className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #10B981', background: 'rgba(16, 185, 129, 0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🔥 當前實戰持有中部位 (2026/10/01 建倉實戰跟單)
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: '#94A3B8', fontSize: '0.82rem' }}>
                  真實建倉成本價 vs 最新收盤價・動態幣別 (美股 US$ / 台股 NT$)・即時未實現損益監控
                </p>
              </div>
              <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6EE7B7', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
                4 檔滿倉配置 (合計 100%)
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.86rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>標的名稱 (代碼)</th>
                    <th style={{ textAlign: 'center' }}>配置角色</th>
                    <th style={{ textAlign: 'center' }}>目標權重</th>
                    <th style={{ textAlign: 'center' }}>建倉日期</th>
                    <th style={{ textAlign: 'right' }}>真實建倉成本</th>
                    <th style={{ textAlign: 'right' }}>最新現價</th>
                    <th style={{ textAlign: 'right' }}>未實現損益</th>
                    <th style={{ textAlign: 'right' }}>60MA 季線防守</th>
                    <th style={{ textAlign: 'left' }}>即時風控指引與操作指令</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPicks.filter(p => p.is_active).map((p) => {
                    const curr = p.currency === 'USD' ? 'US$ ' : 'NT$ ';
                    const isWin = (p.unrealized_return_pct || 0) >= 0;
                    return (
                      <tr key={p.ticker} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                          {p.name} <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace' }}>({p.ticker})</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.74rem',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            background: p.rank === 1 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.25)',
                            color: p.rank === 1 ? '#FBBF24' : '#38BDF8',
                            border: p.rank === 1 ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(14, 165, 233, 0.5)'
                          }}>
                            {p.rank === 1 ? '👑 第1主力' : p.rank === 2 ? '🥈 第2主力' : p.rank === 3 ? '🥉 第3主力' : '🎖️ 第4主力'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#67E8F9' }}>
                          {p.weight_pct}%
                        </td>
                        <td style={{ textAlign: 'center', color: '#94A3B8' }}>{p.entry_date || '2026-10-01'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#E2E8F0' }}>
                          {curr}{p.entry_price?.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                          {curr}{p.price?.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                          {isWin ? '+' : ''}{p.unrealized_return_pct?.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                          {curr}{p.ma60?.toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'left', fontSize: '0.75rem', color: '#CBD5E1' }}>
                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', marginRight: '6px' }}></span>
                          {p.stop_condition || `跌破季線 (${curr}${p.ma60}) 次日出清，目前均線保護安全`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 候選池與全量名單 */}
          <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#F3F4F6', fontSize: '1.1rem' }}>
                  👑 方案 A 當前精選持倉與候補名單 (Domestic-Accessible Titan Pool)
                </h4>
                <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                  前 4 名為當前滿倉標的（合計 100%），第 5～10 名為強勢候補觀察標的
                </p>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#10B981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.3rem 0.6rem', borderRadius: '4px' }}>
                ✓ 100% 國內券商可買・無跨境換匯摩擦
              </div>
            </div>

            <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '50px' }}>排名</th>
                <th>股票名稱 / 代碼</th>
                <th>所屬交易市場</th>
                <th style={{ textAlign: 'center' }}>建議配置權重</th>
                <th style={{ textAlign: 'right' }}>最新現價</th>
                <th style={{ textAlign: 'right' }}>60MA 季線</th>
                <th style={{ textAlign: 'right' }}>200MA 年線</th>
                <th style={{ textAlign: 'right' }}>3個月動能</th>
                <th style={{ textAlign: 'right' }}>12個月動能</th>
                <th style={{ textAlign: 'right' }}>多尺度動能分</th>
                <th style={{ textAlign: 'center' }}>持倉狀態</th>
              </tr>
            </thead>
            <tbody>
              {currentPicks.map((p) => (
                <tr 
                  key={p.ticker}
                  style={{
                    background: p.is_active ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                    borderLeft: p.is_active ? '3px solid #10B981' : 'none'
                  }}
                >
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                    {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : p.rank}
                  </td>
                  <td>
                    <div style={{ fontWeight: 'bold', color: '#F3F4F6' }}>{p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#9CA3AF', fontFamily: 'monospace' }}>{p.ticker}</div>
                  </td>
                  <td>
                    <span style={{
                      fontSize: '0.78rem',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      background: p.market.includes('台股') ? 'rgba(99, 102, 241, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                      color: p.market.includes('台股') ? '#A5B4FC' : '#93C5FD'
                    }}>
                      {p.market}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {p.is_active ? (
                      <span style={{
                        fontWeight: 'bold',
                        fontSize: '0.9rem',
                        color: '#10B981',
                        background: 'rgba(16, 185, 129, 0.2)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px'
                      }}>
                        {p.weight_pct}%
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>候補</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#F3F4F6', fontFamily: 'monospace' }}>
                    {p.currency === 'USD' ? 'US$ ' : 'NT$ '}{p.price?.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {p.currency === 'USD' ? 'US$ ' : 'NT$ '}{p.ma60?.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {p.ma200 ? `${p.currency === 'USD' ? 'US$ ' : 'NT$ '}${p.ma200?.toLocaleString()}` : '-'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: p.mom_3m >= 0 ? '#34D399' : '#F87171' }}>
                    {p.mom_3m >= 0 ? `+${p.mom_3m}%` : `${p.mom_3m}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: p.mom_12m >= 0 ? '#34D399' : '#F87171' }}>
                    {p.mom_12m >= 0 ? `+${p.mom_12m}%` : `${p.mom_12m}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>
                    {p.score > 0 ? `+${p.score}` : p.score}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {p.is_active ? (
                      <span style={{ fontSize: '0.78rem', color: '#34D399', fontWeight: 'bold' }}>
                        🔥 實盤持倉中
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        👀 觀察儲備
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* 區塊 2: 20年歷年戰績對比 */}
      {activeSubTab === 'history' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            🛡️ <strong>無上帝視角原則</strong>：每月最後一個交易日收盤確認動能與季線斜率 ➔ 次月第一個交易日 (T+1) 開盤執行買賣 ➔ 逐筆內扣 0.15% 交易摩擦成本。
          </div>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '65px' }}>年份</th>
                <th style={{ textAlign: 'right', color: '#10B981', fontWeight: 'bold' }}>方案 A (Top 4 階梯旗艦)</th>
                <th style={{ textAlign: 'right', color: '#9CA3AF' }}>標普 500 (SPY 基準)</th>
                <th style={{ textAlign: 'right', color: '#60A5FA' }}>方案 A 超額報酬 (Alpha)</th>
                <th style={{ textAlign: 'right' }}>方案 A 年底資產淨值</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => {
                const alpha = y.scheme_a_ret - y.spy_ret;
                return (
                  <tr key={y.year}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{y.year}</td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.scheme_a_ret >= 0 ? '#34D399' : '#F87171', fontSize: '0.92rem' }}>
                      {y.scheme_a_ret >= 0 ? `+${y.scheme_a_ret}%` : `${y.scheme_a_ret}%`}
                    </td>
                    <td style={{ textAlign: 'right', color: y.spy_ret >= 0 ? '#D1D5DB' : '#EF4444' }}>
                      {y.spy_ret >= 0 ? `+${y.spy_ret}%` : `${y.spy_ret}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: alpha >= 0 ? '#60A5FA' : '#FCA5A5' }}>
                      {alpha >= 0 ? `+${alpha.toFixed(1)}%` : `${alpha.toFixed(1)}%`}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
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
          <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            📜 <strong>實盤調倉追蹤</strong>：每月初 T+1 日自動執行的持倉明細與單期績效。
          </div>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th>執行交易日</th>
                <th>結算交易日</th>
                <th>當期大盤風控</th>
                <th>調倉配置明細</th>
                <th style={{ textAlign: 'right' }}>當期投組報酬</th>
                <th style={{ textAlign: 'right' }}>當期 SPY 報酬</th>
                <th style={{ textAlign: 'right' }}>結算總資產</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.slice().reverse().map((t, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 'bold', color: '#E0E7FF' }}>{t.exec_date}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{t.next_date}</td>
                  <td>
                    <span style={{
                      fontSize: '0.78rem',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '4px',
                      background: t.exposure === 1.0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: t.exposure === 1.0 ? '#34D399' : '#FCA5A5'
                    }}>
                      {t.exposure === 1.0 ? '滿倉 100%' : '減半 50%'}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{t.allocation}</td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: t.period_ret >= 0 ? '#34D399' : '#F87171' }}>
                    {t.period_ret >= 0 ? `+${t.period_ret}%` : `${t.period_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', color: t.spy_ret >= 0 ? '#D1D5DB' : '#EF4444' }}>
                    {t.spy_ret >= 0 ? `+${t.spy_ret}%` : `${t.spy_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#10B981' }}>
                    ${t.capital?.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 4: 2,240 組 DOE 參數優化與除權息審計報告 */}
      {activeSubTab === 'doe_audit' && (
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#60A5FA', fontSize: '1.2rem' }}>
            🔬 全量 2,240 組 DOE 參數最佳化與無上帝視角除權息審計
          </h4>

          {/* 1. 除權息與減資審計核實 */}
          <div style={{ background: 'rgba(59, 130, 246, 0.08)', padding: '1.2rem', borderRadius: '8px', borderLeft: '4px solid #3B82F6', marginBottom: '1.5rem' }}>
            <h5 style={{ margin: '0 0 0.5rem 0', color: '#93C5FD' }}>
              ✅ 股票減資、除權息、拆股合併嚴格審計核實 (Zero Corporate Action Bias)
            </h5>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.7' }}>
              <li><strong>長榮海運 (2603.TW) 2022年9月現金減資 60%</strong>：經逐筆核對，資料庫已完整採用除權息與減資還原價格，減資前後平滑銜接，無任何因減資縮股產生的假暴漲。</li>
              <li><strong>輝達 (NVDA) 2024年 10拆1、蘋果 (AAPL) 2020年 4拆1</strong>：開盤價與收盤價完全同步除權，T+1 執行收益計算 100% 吻合真實行情。</li>
              <li><strong>重大黑天鵝真實還原</strong>：2021年世芯-KY (3661.TW) 實體清單事件 (-46.6%)、2024年 CrowdStrike (CRWD) 藍屏事件 (-39.8%) 均真實承受回撤，絕無人為倖存者偏差濾除。</li>
            </ul>
          </div>

          {/* 2. DOE 參數敏感度與變異數分析 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#10B981', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🥇 影響力第 1 名：選股配比 (Allocation)
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>極差：</strong> MDD 極差高達 <strong>30.99%</strong>，直接決定帳戶生死。</li>
                <li><strong>單壓 Top 1：</strong> MDD 崩壞至 -89.18%，單一黑天鵝即可能重傷。</li>
                <li><strong>階梯配置勝出：</strong> Top 4 階梯 (40/25/20/15) 兼顧龍頭爆發力與抗跌，Calmar 衝上 <strong>1.592 全場第一</strong>！</li>
              </ul>
            </div>

            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#818CF8', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🥈 影響力第 2 名：動能時間窗 (Momentum)
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>極差：</strong> CAGR 極差 <strong>8.96%</strong>，決定 Alpha 的獲利上限。</li>
                <li><strong>長中線多尺度勝出：</strong> (40% 12M + 30% 6M + 20% 3M + 10% 1M) 大幅超越短線動能。</li>
                <li><strong>短線陷阱：</strong> 依賴 1M~3M 短線的組合 CAGR 僅 35%，洗盤回撤急遽飆升。</li>
              </ul>
            </div>

            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#F59E0B', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🥉 影響力第 3 名：宏觀風控 (Macro Airbag)
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>極差：</strong> MDD 極差 <strong>13.64%</strong>，黑天鵝存活關鍵。</li>
                <li><strong>倉位減半 (Half) 最優：</strong> SPY 破年線時倉位減半，既壓制 2008 與 2022 崩盤，又享受底部報復性反彈，勝過完全空手踏空。</li>
              </ul>
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem', color: '#CBD5E1', lineHeight: '1.6' }}>
            📌 <strong>實戰落地總結</strong>：
            方案 A 是經過 22.8 年長週期考驗、數學回測最嚴格、且在台灣國內券商（台股帳戶 ＋ 複委託）完全可一鍵落地的最優解。
          </div>
        </div>
      )}

      {/* 區塊 5: 6大出場機制與守住獲利成效對比 (2004~2026 全歷史回測) */}
      {activeSubTab === 'exit_mechanisms' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* 總覽導讀卡片 */}
          <div className="glass-card" style={{ padding: '1.4rem', borderLeft: '4px solid #10B981', background: 'rgba(16, 185, 129, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h3 style={{ margin: 0, color: '#34D399', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  🛡️ 6 大出場機制與守住獲利成效對比（2004～2026 全歷史實證）
                </h3>
                <p style={{ margin: '0.4rem 0 0 0', color: '#CBD5E1', fontSize: '0.86rem', lineHeight: '1.5' }}>
                  針對「為什麼是每月結算？」以及「嘗試改為台股泰坦模式（跌破均線或守住獲利移動停利）」進行 22.8 年無偏誤回測量化實驗。
                </p>
              </div>
              <span style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.2)', color: '#6EE7B7', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                樣本區間：2004/01 ~ 2026/10 (共 5,720 個交易日)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <div style={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 'bold' }}>👑 總報酬冠軍：方案 A 月度輪動</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#34D399', margin: '0.2rem 0' }}>+141,682%</div>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>CAGR 37.85% | 抱牢大牛股讓利潤奔跑</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ fontSize: '0.78rem', color: '#60A5FA', fontWeight: 'bold' }}>🛡️ 風險最低：方案 B 破 60MA 出場</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#60A5FA', margin: '0.2rem 0' }}>MDD -37.29%</div>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>回撤縮小 7.45% | 徹底防範單股暴跌</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                <div style={{ fontSize: '0.78rem', color: '#FBBF24', fontWeight: 'bold' }}>🏆 勝率冠軍：方案 D 守住獲利</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#FBBF24', margin: '0.2rem 0' }}>勝率 53.0%</div>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>獲利+15%後回檔10%移動鎖利 | 不做白工</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.9rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                <div style={{ fontSize: '0.78rem', color: '#F87171', fontWeight: 'bold' }}>⚠️ 敏感地雷：方案 C 破 20MA 出場</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#F87171', margin: '0.2rem 0' }}>CAGR 僅 9.45%</div>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>交易 757 次頻繁洗盤 | 賣飛無數大牛股</div>
              </div>
            </div>
          </div>

          {/* 6 大機制量化橫向對比表 */}
          <div className="glass-card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
            <h4 style={{ margin: '0 0 1rem 0', color: '#F3F4F6', fontSize: '1.1rem' }}>
              📊 2004～2026 全歷史 6 大出場機制回測成效矩陣
            </h4>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'left', minWidth: '190px' }}>出場機制方案</th>
                  <th style={{ textAlign: 'center', minWidth: '95px' }}>策略風格</th>
                  <th style={{ textAlign: 'right', minWidth: '105px' }}>22年累積總報酬</th>
                  <th style={{ textAlign: 'right', minWidth: '95px' }}>年化 (CAGR)</th>
                  <th style={{ textAlign: 'right', minWidth: '105px' }}>最大回撤 (MDD)</th>
                  <th style={{ textAlign: 'right', minWidth: '85px' }}>夏普 Sharpe</th>
                  <th style={{ textAlign: 'right', minWidth: '85px' }}>勝率 Win%</th>
                  <th style={{ textAlign: 'right', minWidth: '90px' }}>獲利因子 PF</th>
                  <th style={{ textAlign: 'right', minWidth: '85px' }}>總交易數</th>
                  <th style={{ textAlign: 'right', minWidth: '90px' }}>平均持股天數</th>
                </tr>
              </thead>
              <tbody>
                {(data?.exit_mechanisms_comparison || defaultData.exit_mechanisms_comparison || []).map((mech, idx) => {
                  const isBaseline = mech.id === 'baseline_monthly';
                  const isMddMin = mech.id === 'ma60_exit';
                  const isWinTop = mech.id === 'trailing_stop';
                  const isFlagship = mech.id === 'titan_flagship_refill';
                  return (
                    <tr key={idx} style={{
                      background: isBaseline ? 'rgba(16, 185, 129, 0.08)' : (isFlagship ? 'rgba(99, 102, 241, 0.08)' : 'transparent'),
                      borderLeft: isBaseline ? '3px solid #10B981' : (isFlagship ? '3px solid #818CF8' : 'none')
                    }}>
                      <td style={{ textAlign: 'left', fontWeight: 'bold' }}>
                        <div style={{ color: isBaseline ? '#34D399' : (isFlagship ? '#A5B4FC' : '#F1F5F9') }}>
                          {mech.name}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginTop: '2px', lineHeight: '1.35' }}>
                          {mech.desc}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          fontSize: '0.74rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          background: isBaseline ? 'rgba(16, 185, 129, 0.2)' : isMddMin ? 'rgba(59, 130, 246, 0.2)' : isWinTop ? 'rgba(245, 158, 11, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                          color: isBaseline ? '#6EE7B7' : isMddMin ? '#93C5FD' : isWinTop ? '#FDE68A' : '#CBD5E1'
                        }}>
                          {mech.type}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>
                        +{mech.total_ret?.toLocaleString()}%
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>
                        +{mech.cagr?.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: isMddMin ? '#34D399' : (mech.mdd < -44 ? '#F87171' : '#FBBF24'), fontFamily: 'monospace' }}>
                        {mech.mdd?.toFixed(2)}%
                        {isMddMin && <span style={{ fontSize: '0.7rem', display: 'block', color: '#34D399' }}>🛡️ 全場最抗跌</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#E2E8F0' }}>
                        {mech.sharpe?.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: isWinTop ? '#FBBF24' : '#E2E8F0', fontFamily: 'monospace' }}>
                        {mech.win_rate?.toFixed(1)}%
                        {isWinTop && <span style={{ fontSize: '0.7rem', display: 'block', color: '#FBBF24' }}>🏆 勝率之王</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#E2E8F0' }}>
                        {mech.profit_factor?.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                        {mech.trades} 筆
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                        {mech.avg_holding_days} 天
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 深度研發洞察與設計抉擇 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.2rem' }}>
            <div className="glass-card" style={{ padding: '1.25rem', borderTop: '3px solid #10B981' }}>
              <div style={{ fontSize: '0.92rem', color: '#34D399', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                💡 1. 為什麼傳統跨國動能策略採「每月結算」？
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.7' }}>
                <li><strong>動能持續性 (Momentum Persistence)：</strong> 全球高流動性巨頭（如 NVDA、TSLA、欣興、創意）的主升段常持續 3～12 個月。定期月度結算能讓最強飆股獲利「充分奔跑 (Let winners run)」，不被中途洗盤震下車。</li>
                <li><strong>消除交易摩擦成本：</strong> 若每週或每日根據短線均線反覆進出，跨國複委託與台股經手費將大幅侵蝕複利；月度換倉將交易成本控制在每年 1.8% 以內。</li>
                <li><strong>避免假跌破洗盤：</strong> 許多強勢股在主升段中會刻意跌破 10MA 或 20MA 洗出浮額後再飆漲 100%，月度結算能濾除短線噪聲。</li>
              </ul>
            </div>

            <div className="glass-card" style={{ padding: '1.25rem', borderTop: '3px solid #3B82F6' }}>
              <div style={{ fontSize: '0.92rem', color: '#60A5FA', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                🛡️ 2. 改為「跌破 60MA 季線出場」的巨大價值
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.7' }}>
                <li><strong>回撤大幅縮小：</strong> 最大回撤從 <strong>-44.74% 降至 -37.29%（安全度提升 7.45%）</strong>，是 6 種機制中抗跌能力最強的。</li>
                <li><strong>切斷黑天鵝腰斬風險：</strong> 當個股突發重大利空破季線時，不再傻等月底結算，次日開盤即刻退回現金避險，極度適合高風險厭惡型投資人。</li>
                <li><strong>代價是微幅犧牲總回報：</strong> CAGR 從 37.85% 降為 31.57%，換取資產波動曲線平滑與心理安寧。</li>
              </ul>
            </div>

            <div className="glass-card" style={{ padding: '1.25rem', borderTop: '3px solid #F59E0B' }}>
              <div style={{ fontSize: '0.92rem', color: '#FBBF24', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                🎯 3. 改為「守住獲利 (移動停利)」的勝率躍升
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.7' }}>
                <li><strong>勝率衝上 53.0% 全場第一：</strong> 浮盈達 +15% 後啟動移動停利，自最高價回撤 10% 立即鎖利出場，徹底杜絕「獲利 30% 抱到賠錢」的遺憾。</li>
                <li><strong>落袋為安心理舒適：</strong> 交易員在看到浮盈回吐時容易心理失衡，移動停利以客觀機械化規則鎖定戰果。</li>
                <li><strong>潛在機會成本：</strong> 偶爾會賣在 5 倍大牛股的初期回檔（例如欣興 2021 年起漲時的中途洗盤）。</li>
              </ul>
            </div>

            <div className="glass-card" style={{ padding: '1.25rem', borderTop: '3px solid #6366F1' }}>
              <div style={{ fontSize: '0.92rem', color: '#818CF8', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                👑 4. 最佳折衷解：台股泰坦旗艦版 (60MA停損 + 移動停利 + 週度遞補)
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.84rem', color: '#CBD5E1', lineHeight: '1.7' }}>
                <li><strong>解決現金閒置問題 (Cash Drag)：</strong> 單純停損後若要等到月底才買新股，現金會閒置數週；旗艦版引入<strong>每週動態遞補</strong>，有空出資金便在週一遞補第 5 名強勢候補股。</li>
                <li><strong>表現亮眼均衡：</strong> CAGR 達到 <strong>32.52%</strong>，累積總報酬達 <strong>+57,976%</strong>，MDD 控制在 <strong>-40.62%</strong>，兼具進攻與防守！</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
