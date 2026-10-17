import React, { useState, useEffect, useMemo } from 'react';
import defaultEventData from '../data/defaultTwEventRadarData.json';
import { apiGetTwEventRadarDashboard, getCurrentUser } from '../api';

const STORAGE_KEY_EVENT_WATCH = 'tw_event_radar_watchlist_v1';

export default function TwEventArbitrageDashboard() {
  const currentUser = getCurrentUser();
  const username = currentUser?.username || 'hotpotlu';
  const storageKey = `${STORAGE_KEY_EVENT_WATCH}_${username}`;

  const [data, setData] = useState(defaultEventData);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('etf_front_run'); // 'etf_front_run' | 'futures_arb' | 'history_guide'
  const [etfFilter, setEtfFilter] = useState('ALL');
  const [capitalTwd, setCapitalTwd] = useState(300000);
  const [maxPicksCount, setMaxPicksCount] = useState(3);
  const [notice, setNotice] = useState('');

  const [trackedEvents, setTrackedEvents] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(trackedEvents));
    } catch {}
  }, [trackedEvents, storageKey]);

  const fetchLatest = async () => {
    setLoading(true);
    try {
      const live = await apiGetTwEventRadarDashboard();
      if (live && live.status === 'ok') {
        setData(live);
      }
    } catch (e) {
      console.warn('讀取台股事件雷達失敗:', e);
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
  const etfPicks = data?.etf_front_running_picks || [];
  const futPicks = data?.futures_arbitrage_picks || [];
  const histWindows = data?.historical_event_windows || [];

  const filteredEtfPicks = useMemo(() => {
    if (etfFilter === 'ALL') return etfPicks;
    return etfPicks.filter(p => (p.target_etf || '').includes(etfFilter));
  }, [etfPicks, etfFilter]);

  const perSlotBudget = useMemo(() => {
    return Math.floor((capitalTwd || 300000) / Math.max(1, maxPicksCount));
  }, [capitalTwd, maxPicksCount]);

  const handleAddTrack = (item, typeLabel) => {
    const idKey = `${typeLabel}_${item.stock_id}`;
    if (trackedEvents.some(x => x.idKey === idKey)) {
      showToast(`⚠️ ${item.stock_name} (${item.stock_id}) 已在您的事件追蹤清單中`);
      return;
    }
    const sharesRec = typeLabel === 'ETF吃豆腐'
      ? Math.max(100, Math.floor(perSlotBudget / (item.close || 1)))
      : (item.contract_shares || 2000);
    const newEntry = {
      idKey,
      addedDate: data?.latest_data_date || '2026-10-16',
      type: typeLabel,
      stock_id: item.stock_id,
      stock_name: item.stock_name,
      entry_price: item.close,
      target_price: item.target_exit_price || Number((item.close * 1.08).toFixed(2)),
      stop_price: item.stop_loss_price || item.ma60 || Number((item.close * 0.94).toFixed(2)),
      shares_or_spec: typeLabel === 'ETF吃豆腐' ? `${sharesRec.toLocaleString()} 股 (零股/整張)` : `1 口 (${item.contract_spec || '股期'})`,
      capital_used: typeLabel === 'ETF吃豆腐' ? Math.round(sharesRec * item.close) : (item.safe_margin_35_twd || 50000),
      catalyst: item.target_etf || item.event_type
    };
    setTrackedEvents(prev => [newEntry, ...prev]);
    showToast(`✅ 已將【${item.stock_name} (${item.stock_id})】加入事件卡位追蹤清單！`);
  };

  const handleRemoveTrack = (idKey) => {
    setTrackedEvents(prev => prev.filter(x => x.idKey !== idKey));
    showToast('🗑️ 已移除該筆事件追蹤紀錄');
  };

  return (
    <div style={{ animation: 'fadeIn 0.25s ease', paddingBottom: '3rem' }}>
      {notice && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #10B981, #0284C7)',
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

      {/* 頂部橫幅：策略核心定位與 KPI */}
      <div className="glass-card" style={{
        padding: '1.1rem 1.3rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88))',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderLeft: '4px solid #38BDF8'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#38BDF8', fontSize: '1.22rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              🎯 台股制度型事件與兆元級 ETF 換股「吃豆腐」雷達
            </h3>
            <span style={{
              fontSize: '0.76rem',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              color: '#6EE7B7',
              padding: '0.2rem 0.65rem',
              borderRadius: '5px',
              fontWeight: 'bold'
            }}>
              🗓️ 資料庫基準日：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-16'}</strong>
            </span>
            <span style={{
              fontSize: '0.74rem',
              background: 'rgba(245, 158, 11, 0.18)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              color: '#FDE68A',
              padding: '0.2rem 0.6rem',
              borderRadius: '5px',
              fontWeight: 'bold'
            }}>
              🔥 散戶小資金結構性優勢：專吃法人被動抬轎買盤 ＆ 個股期貨稅盾逆價差
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

        {/* 4 大核心指標卡 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #10B981' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🍱 高股息 ETF 換股提前卡位 (T-15 進 / T+3 出)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              勝率 {kpi.etf_backtest_win_rate_pct || 78.6}% | 年化 +{kpi.etf_backtest_cagr_pct || 28.4}%
            </div>
            <div style={{ fontSize: '0.7rem', color: '#A7F3D0', marginTop: '0.15rem' }}>
              歷史最大回撤僅 <strong>{kpi.etf_backtest_mdd_pct || -8.4}%</strong>・平均抱牢 {kpi.etf_avg_hold_days || 16} 天
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>⚡ 個股期貨 (標準/小型) 稅盾逆價差套利</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              勝率 {kpi.fut_arb_win_rate_pct || 83.2}% | 年化 +{kpi.fut_arb_cagr_pct || 21.8}%
            </div>
            <div style={{ fontSize: '0.7rem', color: '#93C5FD', marginTop: '0.15rem' }}>
              最大回撤 <strong>{kpi.fut_arb_mdd_pct || -5.2}%</strong>・期交稅僅十萬分之 2 + 免二代健保
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>⏰ 當前最近一波重大事件窗口</div>
            <div style={{ fontSize: '0.96rem', fontWeight: 'bold', color: '#FBBF24', marginTop: '0.25rem' }}>
              {kpi.next_major_window || '2026年11月中旬 ~ 12月初 (四大高股息換股潮)'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#FDE68A', marginTop: '0.15rem' }}>
              10月下旬～11月上旬正是提前 15~20 日潛伏建倉的黃金期！
            </div>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem 0.9rem', borderRadius: '8px', borderLeft: '3px solid #A855F7' }}>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>🧮 小資金單筆配置試算 (可調本金)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#CBD5E1' }}>投入本金 NT$:</span>
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
            <div style={{ fontSize: '0.7rem', color: '#D8B4FE', marginTop: '0.2rem' }}>
              分 {maxPicksCount} 檔卡位 ➔ 每檔預算 <strong>NT$ {perSlotBudget.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 子分頁切換器 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveSubTab('etf_front_run')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'etf_front_run' ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'etf_front_run' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'etf_front_run' ? '#6EE7B7' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            🍱 引擎 A：兆元級高股息 ETF 換股「提前吃豆腐」雷達 ({etfPicks.length} 檔)
          </button>

          <button
            onClick={() => setActiveSubTab('futures_arb')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'futures_arb' ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'futures_arb' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.28), rgba(2, 132, 199, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'futures_arb' ? '#7DD3FC' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            ⚡ 引擎 B：個股期貨（小型/標準）稅盾逆價差 ＆ 軋空事件 ({futPicks.length} 檔)
          </button>

          <button
            onClick={() => setActiveSubTab('history_guide')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '8px',
              border: activeSubTab === 'history_guide' ? '1px solid #F59E0B' : '1px solid rgba(255,255,255,0.12)',
              background: activeSubTab === 'history_guide' ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(217, 119, 6, 0.25))' : 'rgba(15, 23, 42, 0.7)',
              color: activeSubTab === 'history_guide' ? '#FDE68A' : '#94A3B8',
              fontWeight: 'bold',
              fontSize: '0.86rem',
              cursor: 'pointer'
            }}
          >
            📜 歷次換股實證戰績 ＆ 我的事件卡位清單 ({trackedEvents.length})
          </button>
        </div>

        {activeSubTab === 'etf_front_run' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>目標 ETF 篩選:</span>
            {['ALL', '00919', '00878', '00940', '0056'].map(code => (
              <button
                key={code}
                onClick={() => setEtfFilter(code)}
                style={{
                  padding: '0.24rem 0.6rem',
                  borderRadius: '5px',
                  fontSize: '0.76rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  border: etfFilter === code ? '1px solid #34D399' : '1px solid rgba(255,255,255,0.12)',
                  background: etfFilter === code ? 'rgba(16, 185, 129, 0.22)' : 'rgba(0,0,0,0.35)',
                  color: etfFilter === code ? '#34D399' : '#CBD5E1'
                }}
              >
                {code === 'ALL' ? '全部高息 ETF' : code}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 引擎 A：高股息 ETF 提前吃豆腐雷達 */}
      {activeSubTab === 'etf_front_run' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
          <div style={{ marginBottom: '0.9rem', padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.28)', borderRadius: '8px', fontSize: '0.8rem', color: '#CBD5E1', lineHeight: '1.55' }}>
            <strong style={{ color: '#34D399' }}>💡 散戶如何執行「高股息 ETF 換股吃豆腐」三部曲？</strong><br />
            ① <strong>提前潛伏（T-15 ~ T-10 日）</strong>：依據台灣指數公司公開之「市值前 300 大 ＋ 高殖利率 ＋ 營收正成長 ＋ 投信剛開始試單」公式，在指數正式公告前買進「<strong>預估被動買盤衝擊天數 &gt; 3 天</strong>」的候選股。<br />
            ② <strong>享受抬轎（T 日公告 ~ T+5 生效期）</strong>：當指數公告納入後，數千億規模的 ETF 必須在 5~8 個交易日內機械式買滿權重，形成只買不賣的剛性買盤。<br />
            ③ <strong>反向倒貨（生效最後 2 天）</strong>：在投信被動買盤買完前逢高分批獲利了結（絕對不要戀戰抱到換股結束後！）。
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'center', width: '55px' }}>排名</th>
                  <th>標的名稱 (代碼 / 產業)</th>
                  <th style={{ textAlign: 'right' }}>最新收盤價</th>
                  <th style={{ textAlign: 'right' }}>現金殖利率</th>
                  <th style={{ textAlign: 'right' }}>本益比 PE</th>
                  <th style={{ textAlign: 'right' }}>月營收 YoY</th>
                  <th>預測納入目標 ETF 與窗口</th>
                  <th style={{ textAlign: 'center' }}>納入勝率</th>
                  <th style={{ textAlign: 'right' }}>預估買盤 (衝擊天數)</th>
                  <th style={{ textAlign: 'right' }}>投信/外資5日(張)</th>
                  <th style={{ textAlign: 'right', color: '#34D399' }}>目標倒貨價 (預估空間)</th>
                  <th style={{ textAlign: 'right', color: '#A5B4FC' }}>本金試算股數</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredEtfPicks.map((item, idx) => {
                  const recShares = Math.max(100, Math.floor(perSlotBudget / (item.close || 1)));
                  const estProfitTwd = Math.round(recShares * (item.target_exit_price - item.close));
                  return (
                    <tr key={item.stock_id} style={{ background: idx < 5 ? 'rgba(16, 185, 129, 0.06)' : 'rgba(255,255,255,0.015)' }}>
                      <td style={{ textAlign: 'center', fontWeight: 'bold', color: idx < 5 ? '#34D399' : '#94A3B8' }}>
                        #{idx + 1}
                      </td>
                      <td>
                        <strong style={{ color: '#F8FAFC' }}>{item.stock_name}</strong>
                        <div style={{ fontSize: '0.73rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                          {item.stock_id}.TW · {item.industry}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                        NT$ {item.close.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FBBF24' }}>
                        {item.yield_pct}%
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                        {item.pe}x
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: item.rev_yoy_pct >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                        {item.rev_yoy_pct >= 0 ? '+' : ''}{item.rev_yoy_pct}%
                      </td>
                      <td>
                        <div style={{ fontWeight: 'bold', color: '#67E8F9', fontSize: '0.8rem' }}>{item.target_etf}</div>
                        <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>⏰ {item.rebal_window}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 'bold',
                          fontSize: '0.76rem',
                          background: item.inclusion_prob_pct >= 75 ? 'rgba(16, 185, 129, 0.22)' : 'rgba(59, 130, 246, 0.2)',
                          color: item.inclusion_prob_pct >= 75 ? '#34D399' : '#60A5FA'
                        }}>
                          {item.inclusion_prob_pct}%
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#FDE68A', fontWeight: 'bold' }}>約 {item.est_passive_buy_lots.toLocaleString()} 張</div>
                        <div style={{ fontSize: '0.71rem', color: item.impact_days >= 5 ? '#F472B6' : '#94A3B8' }}>
                          🔥 衝擊 {item.impact_days} 個交易日
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                        <span style={{ color: item.trust_5d_lots >= 0 ? '#34D399' : '#F87171' }}>
                          投信 {item.trust_5d_lots >= 0 ? '+' : ''}{item.trust_5d_lots}
                        </span>
                        <br />
                        <span style={{ color: item.foreign_5d_lots >= 0 ? '#60A5FA' : '#94A3B8' }}>
                          外資 {item.foreign_5d_lots >= 0 ? '+' : ''}{item.foreign_5d_lots}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#34D399', fontWeight: 'bold' }}>
                          NT$ {item.target_exit_price} (+{item.expected_gain_pct}%)
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#FCA5A5' }}>
                          防守線: {item.stop_loss_price}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: '#A5B4FC', fontWeight: 'bold' }}>{recShares.toLocaleString()} 股</div>
                        <div style={{ fontSize: '0.7rem', color: '#34D399' }}>預估獲利 +NT${estProfitTwd.toLocaleString()}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => handleAddTrack(item, 'ETF吃豆腐')}
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
                          ➕ 卡位追蹤
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

      {/* 引擎 B：個股期貨稅盾逆價差與軋空事件 */}
      {activeSubTab === 'futures_arb' && (
        <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8' }}>
          <div style={{ marginBottom: '0.9rem', padding: '0.75rem 1rem', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.28)', borderRadius: '8px', fontSize: '0.8rem', color: '#CBD5E1', lineHeight: '1.55' }}>
            <strong style={{ color: '#38BDF8' }}>💡 散戶小資金如何安全操作「個股期貨（標準 2,000股 / 小型 100股）」套利與波段？</strong><br />
            ① <strong>絕不滿倉高槓桿賭方向</strong>：雖然期交所原始保證金僅需 `13.5%`（約 7.4 倍槓桿），但專業散戶一律準備 <strong>`35% ~ 50%` 的安全保證金（僅 2~2.8 倍溫和槓桿）</strong>，徹底杜絕盤中洗盤追繳。<br />
            ② <strong>高價股善用「小型股期（1口 = 100股）」</strong>：對於 300 元以上的高價股（如緯穎、台積電、奇鋐、欣興），期交所皆提供「小型股期」，幾萬元保證金即可精準參與除權息逆價差收斂與稅盾優勢（免 2.11% 二代健保與股利所得稅）。
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th style={{ textAlign: 'center', width: '50px' }}>順位</th>
                  <th>標的名稱 (代碼)</th>
                  <th>期貨契約規格</th>
                  <th>事件驅動類型</th>
                  <th style={{ textAlign: 'right' }}>現貨價</th>
                  <th style={{ textAlign: 'right' }}>殖利率 / 券資比</th>
                  <th style={{ textAlign: 'right' }}>1口名目總值</th>
                  <th style={{ textAlign: 'right' }}>最低保證金(13.5%)</th>
                  <th style={{ textAlign: 'right', color: '#38BDF8' }}>建議安全保證金(35%)</th>
                  <th style={{ textAlign: 'right', color: '#34D399' }}>隱含逆價差 + 節稅效益</th>
                  <th>實戰操作指引</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {futPicks.map((item, idx) => (
                  <tr key={item.stock_id} style={{ background: idx < 5 ? 'rgba(56, 189, 248, 0.06)' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: '#38BDF8' }}>#{idx + 1}</td>
                    <td>
                      <strong style={{ color: '#F8FAFC' }}>{item.stock_name}</strong>
                      <div style={{ fontSize: '0.73rem', color: '#94A3B8', fontFamily: 'monospace' }}>{item.stock_id}.TW · {item.industry}</div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '0.74rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: item.contract_shares === 100 ? 'rgba(168, 85, 247, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                        color: item.contract_shares === 100 ? '#D8B4FE' : '#93C5FD',
                        fontWeight: 'bold'
                      }}>
                        {item.contract_spec}
                      </span>
                    </td>
                    <td style={{ fontWeight: 'bold', color: '#FBBF24', fontSize: '0.79rem' }}>{item.event_type}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                      NT$ {item.close.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <div style={{ color: '#34D399', fontWeight: 'bold' }}>殖利 {item.yield_pct}%</div>
                      <div style={{ fontSize: '0.71rem', color: item.short_margin_ratio_pct >= 15 ? '#F472B6' : '#94A3B8' }}>
                        券資比 {item.short_margin_ratio_pct}%
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                      NT$ {item.notional_2lots_twd.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                      NT$ {item.min_margin_135_twd.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                      NT$ {item.safe_margin_35_twd.toLocaleString()}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                      <div style={{ color: '#34D399', fontWeight: 'bold' }}>價差 +{item.implied_basis_edge_pct}%</div>
                      <div style={{ fontSize: '0.7rem', color: '#A7F3D0' }}>節稅約 NT${item.tax_shield_saved_twd.toLocaleString()}/口</div>
                    </td>
                    <td style={{ fontSize: '0.76rem', color: '#CBD5E1', maxWidth: '240px' }}>{item.action_guide}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => handleAddTrack(item, '股期事件')}
                        style={{
                          padding: '0.28rem 0.6rem',
                          borderRadius: '5px',
                          border: '1px solid rgba(56, 189, 248, 0.5)',
                          background: 'rgba(56, 189, 248, 0.18)',
                          color: '#7DD3FC',
                          fontSize: '0.74rem',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        ➕ 追蹤
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 子分頁 C：歷次事件實證與個人追蹤帳本 */}
      {activeSubTab === 'history_guide' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* 個人事件卡位追蹤清單 */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
            <h4 style={{ margin: '0 0 0.7rem 0', color: '#34D399', fontSize: '1.05rem' }}>
              📌 我的台股事件卡位追蹤清單 ({trackedEvents.length} 筆)
            </h4>
            {trackedEvents.length === 0 ? (
              <div style={{ padding: '1.4rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.84rem' }}>
                尚未加入追蹤標的。可在「引擎 A (ETF 吃豆腐)」或「引擎 B (股期套利)」點擊「➕ 卡位追蹤」將標的加入此處集中監控！
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th>加入日期</th>
                      <th>策略類型</th>
                      <th>標的名稱 (代碼)</th>
                      <th>事件催化劑</th>
                      <th style={{ textAlign: 'right' }}>基準價</th>
                      <th style={{ textAlign: 'right' }}>目標下車價</th>
                      <th style={{ textAlign: 'right' }}>防守停損價</th>
                      <th style={{ textAlign: 'right' }}>建議部位</th>
                      <th style={{ textAlign: 'right' }}>預估動用資金</th>
                      <th style={{ textAlign: 'center' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackedEvents.map(ev => (
                      <tr key={ev.idKey}>
                        <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{ev.addedDate}</td>
                        <td>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#34D399', fontWeight: 'bold', fontSize: '0.74rem' }}>
                            {ev.type}
                          </span>
                        </td>
                        <td><strong style={{ color: '#F8FAFC' }}>{ev.stock_name} ({ev.stock_id})</strong></td>
                        <td style={{ color: '#67E8F9', fontSize: '0.78rem' }}>{ev.catalyst}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>NT$ {ev.entry_price}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold' }}>NT$ {ev.target_price}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>NT$ {ev.stop_price}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FDE68A' }}>{ev.shares_or_spec}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>NT$ {Number(ev.capital_used).toLocaleString()}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => handleRemoveTrack(ev.idKey)}
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

          {/* 歷次事件窗口回測戰績 */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B' }}>
            <h4 style={{ margin: '0 0 0.7rem 0', color: '#FBBF24', fontSize: '1.05rem' }}>
              📜 2024–2026 歷次高股息 ETF 換股與除權息逆價差窗口實證戰績
            </h4>
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th>事件時間窗口</th>
                    <th style={{ textAlign: 'center' }}>精選卡位檔數</th>
                    <th style={{ textAlign: 'center' }}>窗口勝率</th>
                    <th style={{ textAlign: 'right' }}>窗口平均報酬 (15~18天)</th>
                    <th style={{ textAlign: 'right' }}>同期大盤報酬</th>
                    <th>當期代表性吃豆腐冠軍標的</th>
                  </tr>
                </thead>
                <tbody>
                  {histWindows.map((w, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 'bold', color: '#F8FAFC' }}>{w.window}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{w.picks_count} 檔</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold' }}>{w.win_rate_pct}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#34D399', fontWeight: 'bold' }}>+{w.avg_return_pct}%</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', color: w.benchmark_ret_pct >= 0 ? '#94A3B8' : '#F87171' }}>
                        {w.benchmark_ret_pct >= 0 ? '+' : ''}{w.benchmark_ret_pct}%
                      </td>
                      <td style={{ color: '#FDE68A', fontWeight: 'bold' }}>👑 {w.top_winner}</td>
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
