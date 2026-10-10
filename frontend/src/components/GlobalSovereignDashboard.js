import React, { useState, useEffect } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('rankings'); // 'rankings', 'history', 'doe'

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

  const summary = data?.summary || {};
  const topPick = data?.top_pick || {};
  const rankings = data?.current_rankings || [];
  const yearly = data?.yearly_performance || [];

  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* 頂部標題與更新按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#60A5FA', fontSize: '1.5rem' }}>
            🌍 全球主權泰坦動能看板 (Global Sovereign Titan)
          </h2>
          <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            放眼全世界・以國家為單位精選最強國運 | 零個股踩雷風險 | 20 年無上帝視角 T+1 回測驗證
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

      {/* 核心 KPI 指標卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.8rem' }}>
        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #10B981' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>20年累計總報酬</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#10B981' }}>
            +{summary.total_return_pct?.toLocaleString()}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#A7F3D0', marginTop: '0.2rem' }}>
            約 {summary.multiple} 倍本金 (標普 {summary.spy_multiple} 倍)
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #3B82F6' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>年化複合報酬 (CAGR)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#60A5FA' }}>
            {summary.cagr_pct}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#93C5FD', marginTop: '0.2rem' }}>
            勝過美股標普 500 (+{summary.spy_cagr_pct}%)
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #F59E0B' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>歷史最大回撤 (MDD)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#FCD34D' }}>
            {summary.max_drawdown_pct}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#FDE68A', marginTop: '0.2rem' }}>
            僅為標普 ({summary.spy_max_drawdown_pct}%) 的一半
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #EC4899' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>2008 金融海嘯表現</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#F472B6' }}>
            -0.67%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#FBCFE8', marginTop: '0.2rem' }}>
            標普暴跌 -36.79% (年線及時空倉)
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #8B5CF6' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>年度勝率 (獲利年比率)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#C084FC' }}>
            {summary.win_rate_years}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#DDD6FE', marginTop: '0.2rem' }}>
            22 個年度中 17 年正報酬獲利
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
                當前全球國運首選 NO.1
              </span>
              <span style={{ fontSize: '0.82rem', color: '#34D399', fontWeight: 'bold' }}>
                {topPick.status}
              </span>
            </div>
            <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#F3F4F6' }}>
              {topPick.country} ({topPick.ticker}) - {topPick.name}
            </h3>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              最新價格: <strong style={{ color: '#F9FAFB' }}>${topPick.price}</strong> | 
              200MA年線防守位: <strong style={{ color: '#9CA3AF' }}>${topPick.ma200}</strong> | 
              12個月動能: <strong style={{ color: topPick.mom_12m >= 0 ? '#34D399' : '#EF4444' }}>{topPick.mom_12m >= 0 ? `+${topPick.mom_12m}%` : `${topPick.mom_12m}%`}</strong>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: '200px' }}>
          <div style={{ fontSize: '0.82rem', color: '#93C5FD', marginBottom: '0.4rem' }}>
            💡 策略配置建議 (DOE 最佳化)
          </div>
          <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ fontSize: '0.85rem', color: '#E0E7FF' }}>
              <strong>方案 A (霸權制):</strong> 配置 100%
            </div>
            <div style={{ fontSize: '0.85rem', color: '#A5B4FC', marginTop: '0.2rem' }}>
              <strong>方案 B (雙雄制):</strong> 配置 70% (王者國)
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換按鈕 */}
      <div style={{ display: 'flex', gap: '0.8rem', marginBottom: '1.2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem' }}>
        <button
          className={`btn ${activeSubTab === 'rankings' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('rankings')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🌐 各國即時動能排行榜 ({rankings.length})
        </button>
        <button
          className={`btn ${activeSubTab === 'history' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('history')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          📅 20年歷年回測清單與報酬 ({yearly.length} 年)
        </button>
        <button
          className={`btn ${activeSubTab === 'doe' ? '' : 'btn-secondary'}`}
          onClick={() => setActiveSubTab('doe')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          🧪 DOE 實驗最佳化配置矩陣
        </button>
      </div>

      {/* 區塊 1: 各國即時動能排行榜 */}
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

      {/* 區塊 2: 20年歷年回測清單與報酬 */}
      {activeSubTab === 'history' && (
        <div className="glass-card" style={{ padding: '1.2rem', overflowX: 'auto' }}>
          <div style={{ marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            🛡️ <strong>無上帝視角原則</strong>：每月最後一個交易日收盤確認國運排名與年線 $\to$ 次月第一個交易日 (T+1) 開盤執行買賣 $\to$ 逐筆內扣 0.15% 交易摩擦成本。
          </div>
          <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'center', width: '70px' }}>年份</th>
                <th>主要持有國運標的</th>
                <th style={{ textAlign: 'right' }}>主權泰坦年度報酬</th>
                <th style={{ textAlign: 'right' }}>美國標普 500 同期</th>
                <th style={{ textAlign: 'right' }}>超額 Alpha</th>
                <th style={{ textAlign: 'right' }}>年底累計淨值 (TWD/USD)</th>
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
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.strategy_return >= 0 ? '#34D399' : '#F87171' }}>
                    {y.strategy_return >= 0 ? `+${y.strategy_return}%` : `${y.strategy_return}%`}
                  </td>
                  <td style={{ textAlign: 'right', color: y.spy_return >= 0 ? '#93C5FD' : '#FCA5A5' }}>
                    {y.spy_return >= 0 ? `+${y.spy_return}%` : `${y.spy_return}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: y.alpha >= 0 ? '#10B981' : '#EF4444' }}>
                    {y.alpha >= 0 ? `+${y.alpha}%` : `${y.alpha}%`}
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>
                    ${y.end_equity?.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 區塊 3: DOE 實驗最佳化配置矩陣 */}
      {activeSubTab === 'doe' && (
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#60A5FA' }}>
            🧪 112 組長週期 (2001～2026) DOE 實驗最佳化分析報告
          </h4>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '1.5rem' }}>
            透過正交實驗設計法（DOE），我們對「權重集中度（1~4國）」、「動能回溯窗口（3M/6M/12M/複合）」與「均線風控門檻（無/60MA/120MA/200MA）」進行全排列回測，得出以下重要定論：
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem', marginBottom: '1.5rem' }}>
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#10B981', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🏆 冠軍配置：方案 A (霸權集中制)
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#F9FAFB' }}>Top 1 (100%) + 12M 動能 + 200MA 年線</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>25年累積倍數：</strong> 37.06 倍 (CAGR 15.06%)</li>
                <li><strong>最大回撤：</strong> -29.08% (卡瑪比 0.52 奪冠)</li>
                <li><strong>年勝率：</strong> 76.0% (獲利年份最多)</li>
                <li><strong>適合對象：</strong> 追求極致資本擴張的主動投資人。</li>
              </ul>
            </div>

            <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '1.2rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <div style={{ fontSize: '0.8rem', color: '#60A5FA', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                🛡️ 亞軍配置：方案 B (泰坦雙雄制)
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#F9FAFB' }}>Top 2 (70/30) + 12M 動能 + 120MA/200MA</h4>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem', color: '#D1D5DB', lineHeight: '1.6' }}>
                <li><strong>25年累積倍數：</strong> 20.74 倍 (CAGR 12.50%)</li>
                <li><strong>最大回撤：</strong> -24.05% ~ -26.25% (極致平滑)</li>
                <li><strong>防禦特徵：</strong> 70% 王者國 + 30% 輔佐國，雙重安全氣囊。</li>
                <li><strong>適合對象：</strong> 重視低波動、安心睡覺的大資金配置者。</li>
              </ul>
            </div>
          </div>

          <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1rem', borderRadius: '6px', fontSize: '0.85rem', color: '#CBD5E1', lineHeight: '1.6' }}>
            📌 <strong>量化關鍵結論</strong>：
            1. <strong>12 個月動能壓倒性勝出</strong>：一個國家的國運週期（如美國 AI、巴西原油、日本通縮逆轉）通常持續 3~5 年，12 個月動能最能過濾短期隨機噪聲。
            2. <strong>200MA 年線不可或缺</strong>：在 2008 年金融海嘯等世紀空頭時，年線保護能讓策略自動切換為 100% 現金，保住資產。
          </div>
        </div>
      )}
    </div>
  );
}
