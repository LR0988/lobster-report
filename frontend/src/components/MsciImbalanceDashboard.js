import React, { useState, useEffect } from 'react';
import defaultMsciData from '../data/defaultMsciImbalanceData.json';
import { apiGetMsciImbalanceDashboard } from '../api';

export default function MsciImbalanceDashboard() {
  const [data, setData] = useState(defaultMsciData);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('trades'); // 'trades' | 'hall_of_fame' | 'sop'
  const [searchTerm, setSearchTerm] = useState('');
  const [winOnly, setWinOnly] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const res = await apiGetMsciImbalanceDashboard();
        if (res && res.status === 'ok') {
          setData(res);
        }
      } catch (e) {
        console.warn('載入 MSCI 失衡看板失敗:', e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const timing = data?.timing || defaultMsciData.timing;
  const metrics = data?.analysis?.metrics || defaultMsciData.analysis.metrics;
  const recentTrades = data?.analysis?.recent_trades || defaultMsciData.analysis.recent_trades || [];
  const hallOfFame = data?.analysis?.hall_of_fame || defaultMsciData.analysis.hall_of_fame || [];

  const filteredTrades = recentTrades.filter(t => {
    if (winOnly && !t.is_win) return false;
    if (searchTerm) {
      const q = searchTerm.toUpperCase();
      return t.stock_id.includes(q) || t.stock_name.includes(q) || t.msci_date.includes(q);
    }
    return true;
  });

  return (
    <div style={{ padding: '1rem', color: '#E2E8F0', fontFamily: 'sans-serif' }}>
      {/* ===== 頂部大 Banner：倒數計時與事件狀態 ===== */}
      <div style={{
        background: timing.is_rebalance_day_today 
          ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(185, 28, 28, 0.4))' 
          : 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.95))',
        border: timing.is_rebalance_day_today ? '2px solid #EF4444' : '1px solid rgba(56, 189, 248, 0.3)',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '1.6rem' }}>👑</span>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#F8FAFC' }}>
              MSCI 尾盤失衡隔日沖戰情室
            </h2>
            <span style={{
              fontSize: '0.75rem',
              background: timing.is_rebalance_day_today ? '#EF4444' : '#0284C7',
              color: '#FFF',
              padding: '2px 8px',
              borderRadius: '999px',
              fontWeight: 'bold'
            }}>
              {timing.is_rebalance_day_today ? '🔥 今日生效！' : '季度定審策略'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#94A3B8', maxWidth: '680px', lineHeight: '1.5' }}>
            專門捕捉外資被動指數基金在季調生效日最後一盤（13:25~13:30）不計成本出清所造成的「機械式超跌失衡」，
            散戶於 14:00~14:30 盤後定價掛單進場，隔日 09:00 均值回歸跳空獲利了結。
          </p>
        </div>

        {/* 倒數計時框 */}
        <div style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          padding: '0.8rem 1.4rem',
          textAlign: 'center',
          minWidth: '200px'
        }}>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
            距離下次 MSCI 生效日 ({timing.next_effective_date})
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#38BDF8', fontFamily: 'monospace' }}>
            {timing.days_remaining} <span style={{ fontSize: '1rem', color: '#CBD5E1' }}>天</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: '0.2rem' }}>
            上次生效日：{timing.last_effective_date}
          </div>
        </div>
      </div>

      {/* ===== 核心 KPI 指標卡 ===== */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '0.85rem',
        marginBottom: '1.5rem'
      }}>
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(192, 132, 252, 0.3)', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.25rem' }}>🎯 T+3 盤中翻紅勝率</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#C084FC', fontFamily: 'monospace' }}>
            {metrics.t3_flip_green_rate}%
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>3天內高點超越進場價</div>
        </div>

        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.25rem' }}>⚡ T+1 隔日翻紅勝率</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#38BDF8', fontFamily: 'monospace' }}>
            {metrics.t1_flip_green_rate}%
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>隔天盤中即翻紅拉升</div>
        </div>

        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(52, 211, 153, 0.3)', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.25rem' }}>🚀 3天內平均最高反彈</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#34D399', fontFamily: 'monospace' }}>
            +{metrics.avg_t3_high}%
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>極限深坑回彈彈力</div>
        </div>

        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.25rem' }}>📅 每年交易機會</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#F59E0B', fontFamily: 'monospace' }}>
            約 {metrics.annual_opportunities} 次
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>歷年共 188 筆失衡標的</div>
        </div>

        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#CBD5E1', marginBottom: '0.25rem' }}>🛡️ 扣稅後實戰淨勝率</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#E2E8F0', fontFamily: 'monospace' }}>
            {metrics.win_rate}%
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>扣除0.3%證交稅+手續費</div>
        </div>
      </div>

      {/* ===== 分頁導航 ===== */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '1.25rem' }}>
        {[
          { id: 'trades', label: '📜 歷年實戰紀錄庫 (188筆)' },
          { id: 'hall_of_fame', label: '🏆 歷次暴利代表作' },
          { id: 'sop', label: '📘 散戶 14:00 盤後定價下單 SOP' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: activeTab === t.id ? '#0284C7' : 'transparent',
              color: activeTab === t.id ? '#FFF' : '#94A3B8',
              border: 'none',
              borderRadius: '6px 6px 0 0',
              padding: '0.65rem 1.2rem',
              fontWeight: 'bold',
              fontSize: '0.88rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== 分頁 1：歷年實戰明細表格 ===== */}
      {activeTab === 'trades' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <input
                type="text"
                placeholder="搜尋股票代號 / 名稱 / 日期..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  background: '#0F172A',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '6px',
                  padding: '0.4rem 0.8rem',
                  color: '#FFF',
                  fontSize: '0.82rem',
                  width: '240px'
                }}
              />
              <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#94A3B8' }}>
                <input
                  type="checkbox"
                  checked={winOnly}
                  onChange={e => setWinOnly(e.target.checked)}
                />
                只看獲利交易
              </label>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
              顯示 {filteredTrades.length} 筆歷史失衡事件
            </div>
          </div>

          <div style={{ overflowX: 'auto', background: '#0F172A', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', color: '#CBD5E1', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>MSCI 生效日期</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>標的代號與名稱</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>14:00 盤後買進價</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', color: '#F87171' }}>MSCI 當日跌幅</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', color: '#38BDF8' }}>隔日開盤跳空</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', color: '#34D399' }}>T+1 盤中最高</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', color: '#C084FC' }}>3天內最高反彈</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center' }}>實戰獲利狀態</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((t, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ padding: '0.7rem', color: '#94A3B8', fontFamily: 'monospace' }}>{t.msci_date}</td>
                    <td style={{ padding: '0.7rem' }}>
                      <strong style={{ color: '#F8FAFC' }}>{t.stock_name}</strong>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', marginLeft: '6px', fontFamily: 'monospace' }}>{t.stock_id}</span>
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      NT$ {t.entry_price}
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'center', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {t.msci_drop_pct}%
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'right', color: t.next_open_ret >= 0 ? '#38BDF8' : '#94A3B8', fontFamily: 'monospace' }}>
                      {t.next_open_ret >= 0 ? '+' : ''}{t.next_open_ret}%
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'right', color: t.t1_high_ret >= 0 ? '#34D399' : '#EF4444', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      {t.t1_high_ret >= 0 ? '+' : ''}{t.t1_high_ret}%
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'right', color: '#C084FC', fontWeight: 'bold', fontFamily: 'monospace' }}>
                      +{t.t3_high_ret}%
                    </td>
                    <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                      <span style={{
                        fontSize: '0.72rem',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontWeight: 'bold',
                        background: t.is_win ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: t.is_win ? '#34D399' : '#F87171'
                      }}>
                        {t.is_win ? `✅ 獲利 (${t.realized_ret > 0 ? '+' : ''}${t.realized_ret}%)` : `⚠️ 小損 (${t.realized_ret}%)`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== 分頁 2：歷次暴利代表作 ===== */}
      {activeTab === 'hall_of_fame' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {hallOfFame.map((t, idx) => (
            <div key={idx} style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9))',
              border: '1px solid rgba(192, 132, 252, 0.4)',
              borderRadius: '10px',
              padding: '1.2rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', background: '#8B5CF6', color: '#FFF', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                  TOP {idx + 1} 代表作
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8', fontFamily: 'monospace' }}>{t.msci_date}</span>
              </div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#F8FAFC' }}>
                {t.stock_name} ({t.stock_id})
              </h3>
              <div style={{ fontSize: '0.82rem', color: '#94A3B8', marginBottom: '0.8rem' }}>
                MSCI 生效日尾盤被摜壓：<strong style={{ color: '#EF4444' }}>{t.msci_drop_pct}%</strong>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: '6px', fontSize: '0.84rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#94A3B8' }}>14:00 盤後買進：</span>
                  <strong>NT$ {t.entry_price}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#94A3B8' }}>隔日開盤跳高：</span>
                  <strong style={{ color: '#38BDF8' }}>+{t.next_open_ret}%</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94A3B8' }}>3天內極限反彈：</span>
                  <strong style={{ color: '#34D399', fontSize: '1rem' }}>+{t.t3_high_ret}%</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== 分頁 3：散戶實戰下單 SOP ===== */}
      {activeTab === 'sop' && (
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '1.5rem', lineHeight: '1.6' }}>
          <h3 style={{ marginTop: 0, color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📘</span> 散戶專屬「MSCI 尾盤失衡隔日沖」實戰下單指南
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1.2rem' }}>
            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #EF4444' }}>
              <div style={{ fontWeight: 'bold', color: '#F87171', marginBottom: '0.4rem' }}>步驟 1：T日 13:30 鎖定被踹標的</div>
              <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
                在每年 2、5、8、11 月最後一個交易日 13:30 收盤時，查看本戰情室雷達。鎖定權值股中最後一盤被外資大單摜壓超過 <strong>-1.5% 以上</strong>且收在最低點的好股票。
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #38BDF8' }}>
              <div style={{ fontWeight: 'bold', color: '#38BDF8', marginBottom: '0.4rem' }}>步驟 2：T日 14:00~14:30 盤後定價下單</div>
              <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
                打開元大證券（或任何券商）APP，點選下單類別中的<strong>「盤後定價交易」</strong>。直接掛買進單，成交價格強制等於 13:30 的收盤價，完全零滑價！
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #34D399' }}>
              <div style={{ fontWeight: 'bold', color: '#34D399', marginBottom: '0.4rem' }}>步驟 3：T+1日 09:00~09:30 均值回歸出場</div>
              <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
                隔天早上外資被動賣單已徹底消失。開盤掛 <strong>+1.2% ~ +1.5% 限價賣單</strong>（或 09:00 開盤第一筆市價單沖銷），通常在前 15 分鐘即能輕鬆獲利了結！
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #F59E0B' }}>
              <div style={{ fontWeight: 'bold', color: '#F59E0B', marginBottom: '0.4rem' }}>步驟 4：時間風控防線</div>
              <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
                若隔天大盤突發重挫未能在早盤達標，最晚於 <strong>T+3 日收盤前無條件平倉</strong>，歷史回測顯示 3 天內盤中翻紅達標率超過 <strong>92.6%</strong>！
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
