import React, { useState, useEffect } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('stage2_stocks'); // 'stage2_stocks', 'rankings', 'comparison', 'history', 'doe'

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

  const topPick = data?.top_pick || {};
  const topPickSecond = data?.top_pick_second || {};
  const rankings = data?.current_rankings || [];
  const titanStocks = data?.current_titan_stocks || [];
  const comparison = data?.two_stage_comparison || {};
  const yearly = data?.yearly_performance || [];

  const stg2b = comparison.stage2b_dual_titan || {};
  const stg2a = comparison.stage2a_single_titan || {};
  const stg1 = comparison.stage1_etf || {};
  const spy = comparison.spy || {};

  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* 頂部標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#60A5FA', fontSize: '1.5rem' }}>
            🌍 全球主權泰坦兩階段模型 (Two-Stage Global Titan)
          </h2>
          <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            第一步：由上而下評選全球最強國運 (宏觀順風) ➔ 第二步：在天命之國境內挑選最強王權個股 (超級 Alpha)
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

      {/* 核心 KPI 指標卡片 (四種策略 20 年實測對比) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.8rem' }}>
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #10B981', background: 'rgba(16, 185, 129, 0.08)' }}>
          <div style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            👑 階段 2B：全球雙雄泰坦 (50/50)
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#10B981' }}>
            +{stg2b.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
            翻 <strong>{stg2b.mult} 倍</strong> | CAGR <strong>{stg2b.cagr}%</strong> | MDD <strong>{stg2b.mdd}%</strong>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #6366F1' }}>
          <div style={{ fontSize: '0.82rem', color: '#818CF8', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            ⚡ 階段 2A：單國泰坦 (70/30)
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#818CF8' }}>
            +{stg2a.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#C7D2FE', marginTop: '0.2rem' }}>
            翻 <strong>{stg2a.mult} 倍</strong> | CAGR <strong>{stg2a.cagr}%</strong> | MDD <strong>{stg2a.mdd}%</strong>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #3B82F6' }}>
          <div style={{ fontSize: '0.82rem', color: '#60A5FA', fontWeight: 'bold', marginBottom: '0.3rem' }}>
            🌐 階段 1：純國家 ETF 輪動
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#60A5FA' }}>
            +{stg1.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#93C5FD', marginTop: '0.2rem' }}>
            翻 <strong>{stg1.mult} 倍</strong> | CAGR <strong>{stg1.cagr}%</strong> | MDD <strong>{stg1.mdd}%</strong>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #9CA3AF' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
            📊 基準：標普 500 (SPY 買入持有)
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#D1D5DB' }}>
            +{spy.total_ret?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9CA3AF', marginTop: '0.2rem' }}>
            翻 <strong>{spy.mult} 倍</strong> | CAGR <strong>{spy.cagr}%</strong> | MDD <strong>{spy.mdd}%</strong>
          </div>
        </div>
      </div>

      {/* 當前首選推薦橫幅 */}
      <div className="glass-card" style={{
        padding: '1.5rem',
        marginBottom: '2rem',
        background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.4) 0%, rgba(17, 24, 39, 0.8) 100%)',
        border: '1px solid rgba(96, 165, 250, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1.2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem' }}>
          <div style={{ fontSize: '3rem', lineHeight: 1 }}>{topPick.flag || '🌍'}</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', background: '#3B82F6', color: '#FFF', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>
                當前全球主權雙雄
              </span>
              <span style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold' }}>
                {topPick.status}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#F3F4F6' }}>
              No.1 {topPick.country} ({topPick.ticker}) ＋ No.2 {topPickSecond.country} ({topPickSecond.ticker})
            </h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              {topPick.country} 12M動能: <strong style={{ color: '#34D399' }}>+{topPick.mom_12m}%</strong> | 
              {topPickSecond.country} 12M動能: <strong style={{ color: '#34D399' }}>+{topPickSecond.mom_12m}%</strong> | 
              皆站上 200MA 年線多頭防護位
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: '220px' }}>
          <div style={{ fontSize: '0.82rem', color: '#93C5FD', marginBottom: '0.4rem' }}>
            💡 兩階段泰坦配置指引
          </div>
          <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '0.85rem', color: '#34D399' }}>
              <strong>第二步個股首選:</strong> 下方泰坦個股池
            </div>
            <div style={{ fontSize: '0.82rem', color: '#A5B4FC', marginTop: '0.2rem' }}>
              台灣複委託 / 海外券商皆可買 (美元/ADR)
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換按鈕 */}
      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem', flexWrap: 'wrap' }}>
        <button
          className={`btn ${activeSubTab === 'stage2_stocks' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('stage2_stocks')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          👑 第二步：境內泰坦王權選股 ({titanStocks.length})
        </button>
        <button
          className={`btn ${activeSubTab === 'rankings' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('rankings')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🌐 第一步：全球國運動能榜 ({rankings.length})
        </button>
        <button
          className={`btn ${activeSubTab === 'history' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('history')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          📅 20年歷年策略對比回測 ({yearly.length} 年)
        </button>
        <button
          className={`btn ${activeSubTab === 'doe' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('doe')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🧪 策略結構與機制解析
        </button>
      </div>

      {/* 區塊 1: 第二步境內泰坦王權選股 */}
      {activeSubTab === 'stage2_stocks' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
            <div>
              <h4 style={{ margin: 0, color: '#F3F4F6', fontSize: '1.1rem' }}>
                👑 強勢主權國家境內本土交易所泰坦個股池 (True Domestic Titan Universe)
              </h4>
              <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.84rem' }}>
                各國本土真實交易：台灣證交所 (TWD)・首爾交易所 (KRW)・東京交易所 (JPY)・法蘭克福 (EUR)・聖保羅 (BRL)・那斯達克 (USD)
              </p>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#10B981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.3rem 0.6rem', borderRadius: '4px' }}>
              ✓ 真正本土全市場選股・嚴格 T+1 執行
            </div>
          </div>

          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '50px' }}>排名</th>
                <th>本土股票名稱 / 代碼</th>
                <th>所屬國家</th>
                <th>本土交易市場</th>
                <th style={{ textAlign: 'right' }}>本土現價 (貨幣)</th>
                <th style={{ textAlign: 'right' }}>60MA 季線</th>
                <th style={{ textAlign: 'right' }}>200MA 年線</th>
                <th style={{ textAlign: 'right' }}>12個月動能</th>
                <th style={{ textAlign: 'right' }}>泰坦評分</th>
                <th style={{ textAlign: 'center' }}>泰坦狀態</th>
              </tr>
            </thead>
            <tbody>
              {titanStocks.map((stk, idx) => (
                <tr key={stk.ticker} style={{ background: idx === 0 ? 'rgba(16, 185, 129, 0.12)' : idx === 1 ? 'rgba(59, 130, 246, 0.08)' : 'transparent' }}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                    {idx === 0 ? '🥇 1' : idx === 1 ? '🥈 2' : idx === 2 ? '🥉 3' : idx + 1}
                  </td>
                  <td style={{ fontWeight: '500' }}>
                    <strong>{stk.name}</strong> <code style={{ color: '#93C5FD', marginLeft: '0.3rem' }}>{stk.ticker}</code>
                  </td>
                  <td>
                    <span style={{ marginRight: '0.4rem' }}>{stk.country_flag}</span>
                    {stk.country} ({stk.country_etf})
                  </td>
                  <td>
                    <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                      {stk.market}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                    {stk.price?.toLocaleString()} <span style={{ fontSize: '0.75rem', color: '#93C5FD' }}>{stk.currency}</span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {stk.ma60?.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {stk.ma200?.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: stk.mom_12m >= 0 ? '#34D399' : '#F87171' }}>
                    {stk.mom_12m >= 0 ? `+${stk.mom_12m}%` : `${stk.mom_12m}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA' }}>
                    {stk.score}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: '0.8rem' }}>
                    <span style={{
                      color: stk.is_titan ? '#34D399' : '#FCD34D',
                      background: stk.is_titan ? 'rgba(52, 211, 153, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {stk.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 2: 第一步各國即時動能排行榜 */}
      {activeSubTab === 'rankings' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '60px' }}>排名</th>
                <th>國家 / 標的</th>
                <th>代號</th>
                <th style={{ textAlign: 'right' }}>最新市價</th>
                <th style={{ textAlign: 'right' }}>200MA 年線</th>
                <th style={{ textAlign: 'center' }}>年線保護</th>
                <th style={{ textAlign: 'right' }}>1個月動能</th>
                <th style={{ textAlign: 'right' }}>3個月動能</th>
                <th style={{ textAlign: 'right' }}>12個月動能</th>
                <th style={{ textAlign: 'right' }}>綜合動能分</th>
                <th style={{ textAlign: 'center' }}>國運狀態</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.ticker} style={{ background: r.rank === 1 ? 'rgba(59, 130, 246, 0.12)' : 'transparent' }}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                    {r.rank === 1 ? '👑 1' : r.rank}
                  </td>
                  <td style={{ fontWeight: '500' }}>
                    <span style={{ marginRight: '0.5rem', fontSize: '1.1rem' }}>{r.flag}</span>
                    {r.country} <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>({r.name})</span>
                  </td>
                  <td><code style={{ color: '#93C5FD' }}>{r.ticker}</code></td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>${r.price}</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>${r.ma200}</td>
                  <td style={{ textAlign: 'center' }}>
                    {r.above_ma200 ? (
                      <span style={{ color: '#34D399', fontSize: '0.78rem', background: 'rgba(52, 211, 153, 0.15)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                        ✓ 站在年線上
                      </span>
                    ) : (
                      <span style={{ color: '#F87171', fontSize: '0.78rem', background: 'rgba(239, 68, 68, 0.15)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                        ✗ 跌破年線
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', color: r.mom_1m >= 0 ? '#34D399' : '#F87171' }}>
                    {r.mom_1m >= 0 ? `+${r.mom_1m}%` : `${r.mom_1m}%`}
                  </td>
                  <td style={{ textAlign: 'right', color: r.mom_3m >= 0 ? '#34D399' : '#F87171' }}>
                    {r.mom_3m >= 0 ? `+${r.mom_3m}%` : `${r.mom_3m}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: r.mom_12m >= 0 ? '#34D399' : '#F87171' }}>
                    {r.mom_12m >= 0 ? `+${r.mom_12m}%` : `${r.mom_12m}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA' }}>
                    {r.score}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: '0.8rem' }}>
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 3: 20年歷年策略對比回測 */}
      {activeSubTab === 'history' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            🛡️ <strong>無上帝視角原則</strong>：每月最後一個交易日收盤確認國運排名與個股季線 ➔ 次月第一個交易日 (T+1) 開盤執行買賣 ➔ 逐筆內扣 0.15% 交易摩擦成本。
          </div>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '65px' }}>年份</th>
                <th>核心國運市場</th>
                <th style={{ textAlign: 'right', color: '#10B981' }}>階段2B: 全球雙雄 (50/50)</th>
                <th style={{ textAlign: 'right', color: '#818CF8' }}>階段2A: 單國泰坦 (70/30)</th>
                <th style={{ textAlign: 'right', color: '#60A5FA' }}>階段1: 純國家ETF</th>
                <th style={{ textAlign: 'right', color: '#9CA3AF' }}>美股標普 500 (SPY)</th>
                <th style={{ textAlign: 'right' }}>階段2B年底淨值</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={y.year}>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{y.year}</td>
                  <td>
                    <span style={{ marginRight: '0.4rem' }}>{y.flag}</span>
                    <strong>{y.main_country}</strong>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.stg2b_dual_ret >= 0 ? '#34D399' : '#F87171' }}>
                    {y.stg2b_dual_ret >= 0 ? `+${y.stg2b_dual_ret}%` : `${y.stg2b_dual_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.stg2a_titan_ret >= 0 ? '#A5B4FC' : '#FCA5A5' }}>
                    {y.stg2a_titan_ret >= 0 ? `+${y.stg2a_titan_ret}%` : `${y.stg2a_titan_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', color: y.stg1_etf_ret >= 0 ? '#93C5FD' : '#FCA5A5' }}>
                    {y.stg1_etf_ret >= 0 ? `+${y.stg1_etf_ret}%` : `${y.stg1_etf_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', color: y.spy_ret >= 0 ? '#D1D5DB' : '#EF4444' }}>
                    {y.spy_ret >= 0 ? `+${y.spy_ret}%` : `${y.spy_ret}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#34D399' }}>
                    ${y.cap_stg2b?.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 4: 策略結構與機制解析 */}
      {activeSubTab === 'doe' && (
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#60A5FA' }}>
            🧪 兩階段全球王權模型架構核心發現
          </h4>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '1.5rem' }}>
            結合「全球主權國家級動能」與「國家境內王權個股泰坦策略」，我們證實了兩大關鍵量化結論：
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#10B981', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🏆 頂級 Alpha：全球雙雄泰坦 (階段 2B)
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#F9FAFB' }}>跨國前兩強 ➔ 各挑境內最強第 1 名個股 (50/50)</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>20年累積倍數：</strong> 166.89 倍 (累積 +16,588%)</li>
                <li><strong>年化報酬 CAGR：</strong> 25.32% (大幅碾壓標普 10.77%)</li>
                <li><strong>最大回撤 MDD：</strong> -47.71% (跨國產業互補分散回撤)</li>
                <li><strong>核心邏輯：</strong> 捕捉美國科技巨頭 + 各國原物料/半導體霸主（如 NVDA + 巴西石油 / 台積電）。</li>
              </ul>
            </div>

            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#818CF8', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                ⚡ 單國王權集中：單國泰坦 (階段 2A)
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#F9FAFB' }}>單一最強國 ➔ 境內 Top 2 個股 (70/30)</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>20年累積倍數：</strong> 37.73 倍 (累積 +3,673%)</li>
                <li><strong>年化報酬 CAGR：</strong> 17.35%</li>
                <li><strong>對比純 ETF：</strong> 從 7.82 倍暴增至 37.73 倍，個股 Alpha 發揮極致。</li>
                <li><strong>防禦機制：</strong> 跌破 60MA 季線或大盤破 200MA 年線即退守現金。</li>
              </ul>
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem', color: '#CBD5E1', lineHeight: '1.6' }}>
            📌 <strong>執行可操作性</strong>：
            1. <strong>全美元計價 / 台灣皆可買</strong>：美股權王（AAPL, NVDA 等）與各國龍頭（巴西石油 PBR、淡水河谷 VALE、台積電 TSM、ASML 等）均在美股有高度流動性 ADR，台灣投資人透過複委託或海外券商一站式即可輕鬆配置。
            2. <strong>月度調倉</strong>：每個月底僅需調倉一次，極低交易頻率與時間成本，享受全世界資本推升的超額複利。
          </div>
        </div>
      )}
    </div>
  );
}
