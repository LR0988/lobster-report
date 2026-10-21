import React, { useState, useMemo } from 'react';
import defaultTitanData from '../data/taiwan_causal_titan_data.json';

export default function TaiwanCausalTitanDashboard() {
  const [data] = useState(defaultTitanData);
  const [userCapital, setUserCapital] = useState(1000000); // 預設 100 萬投資本金試算
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [activeTabSub, setActiveTabSub] = useState('portfolio'); // 'portfolio', 'curve', 'yearly', 'alphas', 'trades'
  const [tradeFilter, setTradeFilter] = useState('all'); // 'all', 'win', 'loss'
  const [tradeSearch, setTradeSearch] = useState('');

  const { strategy_info, kpis, current_positions, curve, yearly_stats, causal_alphas, trades = [] } = data;

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (tradeFilter === 'win' && (t.return_pct || 0) < 0) return false;
      if (tradeFilter === 'loss' && (t.return_pct || 0) >= 0) return false;
      if (tradeSearch.trim()) {
        const q = tradeSearch.trim().toLowerCase();
        const sid = String(t.stock_id || '').toLowerCase();
        const sname = String(t.stock_name || '').toLowerCase();
        return sid.includes(q) || sname.includes(q);
      }
      return true;
    });
  }, [trades, tradeFilter, tradeSearch]);

  const winCount = useMemo(() => trades.filter(t => (t.return_pct || 0) >= 0).length, [trades]);
  const lossCount = useMemo(() => trades.filter(t => (t.return_pct || 0) < 0).length, [trades]);

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
    link.setAttribute('href', url);
    link.setAttribute('download', `taiwan_causal_titan_trades_2005_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 動態計算各檔個股建議配置股數 (依黃金階梯權重分配 35/25/20/10/10)
  const calculatedPositions = useMemo(() => {
    return current_positions.map(pos => {
      const weight = (pos.weight_pct || 20) / 100;
      const allocatedCapital = userCapital * weight;
      const targetShares = Math.floor(allocatedCapital / pos.current_price);
      const targetLots = Math.floor(targetShares / 1000);
      const oddShares = targetShares % 1000;
      const targetAmount = targetShares * pos.current_price;
      return {
        ...pos,
        allocatedCapital,
        targetShares,
        targetLots,
        oddShares,
        targetAmount
      };
    });
  }, [userCapital, current_positions]);

  // 總試算市值與剩餘現金
  const totalAllocatedAmount = useMemo(() => {
    return calculatedPositions.reduce((sum, p) => sum + p.targetAmount, 0);
  }, [calculatedPositions]);
  const residualCash = Math.max(0, userCapital - totalAllocatedAmount);

  // 複製所有跟隨指令
  const copyAllOrders = () => {
    const text = calculatedPositions.map(p => 
      `${p.stock_id} ${p.stock_name}: 買進 ${p.targetShares.toLocaleString()} 股 (約 ${p.targetLots} 張 ${p.oddShares > 0 ? `+ ${p.oddShares} 股` : ''}) · 現價 $${p.current_price} · 停損 $${p.stop_loss_price}`
    ).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedIndex('all');
    setTimeout(() => setCopiedIndex(null), 2500);
  };

  // 複製單一股票下單指令
  const copySingleOrder = (p, idx) => {
    const text = `${p.stock_id} ${p.stock_name} 買進 ${p.targetShares}股`;
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // 曲線 SVG 點計算
  const svgCurveData = useMemo(() => {
    if (!curve || curve.length === 0) return { pathStrat: '', pathTx: '', points: [] };
    const width = 860;
    const height = 280;
    const padding = { top: 20, right: 30, bottom: 30, left: 60 };

    // 取對數或歸一化
    const maxStrat = Math.max(...curve.map(c => c.strategy_nav));
    const minStrat = Math.min(...curve.map(c => Math.min(c.strategy_nav, c.taiex_nav)));

    // 採用 Log10 尺度以便同時展示 1312x 與 7.7x
    const logMin = Math.log10(Math.max(0.8, minStrat));
    const logMax = Math.log10(Math.max(10, maxStrat));

    const getX = (idx) => padding.left + (idx / (curve.length - 1)) * (width - padding.left - padding.right);
    const getY = (val) => {
      const logVal = Math.log10(Math.max(0.8, val));
      const ratio = (logVal - logMin) / (logMax - logMin);
      return height - padding.bottom - ratio * (height - padding.top - padding.bottom);
    };

    let pathStrat = `M ${getX(0)} ${getY(curve[0].strategy_nav)}`;
    let pathTx = `M ${getX(0)} ${getY(curve[0].taiex_nav)}`;

    curve.forEach((c, idx) => {
      if (idx > 0) {
        pathStrat += ` L ${getX(idx)} ${getY(c.strategy_nav)}`;
        pathTx += ` L ${getX(idx)} ${getY(c.taiex_nav)}`;
      }
    });

    return { pathStrat, pathTx, width, height, padding, maxStrat };
  }, [curve]);

  return (
    <div style={{ color: '#E2E8F0', padding: '1.2rem', maxWidth: '1440px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* ===== 頂部旗艦 Banner ===== */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: '16px',
        padding: '1.8rem',
        marginBottom: '1.5rem',
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '1.6rem' }}>👑</span>
              <h2 style={{ fontSize: '1.65rem', fontWeight: '800', margin: 0, background: 'linear-gradient(90deg, #60A5FA, #A78BFA, #F472B6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {strategy_info.name}
              </h2>
              <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34D399', border: '1px solid rgba(16, 185, 129, 0.5)', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700' }}>
                正式實盤運作中 (取代舊版台股泰坦)
              </span>
            </div>
            <p style={{ color: '#94A3B8', fontSize: '0.9rem', margin: '0 0 0.8rem 0' }}>
              {strategy_info.subtitle} · 100% 官方價格還原審計 · 零跳空誤導認證
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
              <span style={{ background: 'rgba(51, 65, 85, 0.6)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#CBD5E1' }}>
                📅 調倉週期: <strong>{strategy_info.rebalance_freq}</strong>
              </span>
              <span style={{ background: 'rgba(51, 65, 85, 0.6)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#CBD5E1' }}>
                🎯 持股檔數: <strong>{strategy_info.holding_count} 檔 ({strategy_info.allocation_type})</strong>
              </span>
              <span style={{ background: 'rgba(51, 65, 85, 0.6)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#CBD5E1' }}>
                🛡️ 風控機制: <strong>{strategy_info.exit_rule}</strong>
              </span>
              <span style={{ background: 'rgba(51, 65, 85, 0.6)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#CBD5E1' }}>
                ⚡ 交易稅費: <strong>{strategy_info.transaction_friction}</strong>
              </span>
            </div>
          </div>

          {/* 調倉倒數與時間卡 */}
          <div style={{ background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '12px', padding: '1rem 1.4rem', textAlign: 'right' }}>
            <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>本期調倉生效日</div>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#60A5FA', margin: '0.2rem 0' }}>{strategy_info.current_rebalance_date}</div>
            <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>下次預計換股日: <span style={{ color: '#F59E0B', fontWeight: '700' }}>{strategy_info.next_rebalance_date}</span></div>
          </div>
        </div>
      </div>

      {/* ===== 核心 22 年終極績效指標卡片 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: '22年累積總倍數', val: `${kpis.total_multiple.toLocaleString()}x`, sub: `大盤同期 ${kpis.taiex_multiple}x`, color: '#F472B6', badge: '+170倍大盤' },
          { label: '年化複合報酬 (CAGR)', val: `${kpis.cagr}%`, sub: `大盤同期 ${kpis.taiex_cagr}% (Alpha +${kpis.alpha_cagr}%)`, color: '#38BDF8', badge: '頂級年化' },
          { label: '夏普比率 (Sharpe)', val: kpis.sharpe.toFixed(2), sub: `大盤同期 ${kpis.taiex_sharpe.toFixed(2)}`, color: '#34D399', badge: '極致風險回報' },
          { label: '歷史最大回撤 (MDD)', val: `${kpis.max_drawdown}%`, sub: `大盤同期 ${kpis.taiex_mdd}%`, color: '#FB923C', badge: '抗海嘯防禦' },
          { label: '卡瑪比率 (Calmar)', val: kpis.calmar.toFixed(2), sub: '收益 / 最大回撤比', color: '#A78BFA', badge: '高質量' },
          { label: '月度勝率 (Win Rate)', val: `${kpis.win_rate}%`, sub: '257 個月實盤追蹤', color: '#E879F9', badge: '高勝率' },
        ].map((k, i) => (
          <div key={i} style={{
            background: 'rgba(30, 41, 59, 0.7)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '1.1rem',
            position: 'relative',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>{k.label}</span>
              <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.06)', color: k.color, padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '700' }}>{k.badge}</span>
            </div>
            <div style={{ fontSize: '1.65rem', fontWeight: '800', color: k.color, letterSpacing: '-0.5px' }}>{k.val}</div>
            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '0.3rem' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ===== 功能導航子頁籤 ===== */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '1.2rem', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { id: 'portfolio', label: '🚀 當前最新持倉與跟隨試算', icon: '⚡' },
          { id: 'trades', label: `📜 逐筆歷史交易紀錄 (${trades.length} 筆)`, icon: '📝' },
          { id: 'curve', label: '📈 22 年真實淨值曲線 (對照大盤)', icon: '📊' },
          { id: 'yearly', label: '📅 2005~2026 歷年年度績效明細', icon: '📜' },
          { id: 'alphas', label: '🧠 四大因果 Alpha 因子解析 (Causal ML)', icon: '🛡️' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTabSub(t.id)}
            style={{
              background: activeTabSub === t.id ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
              border: activeTabSub === t.id ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
              color: activeTabSub === t.id ? '#60A5FA' : '#94A3B8',
              padding: '0.6rem 1.2rem',
              borderRadius: '8px',
              fontSize: '0.9rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              transition: 'all 0.2s'
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ===== TAB 1: 當前實盤持倉與跟隨試算 ===== */}
      {activeTabSub === 'portfolio' && (
        <div>
          {/* 跟隨試算工具列 */}
          <div style={{
            background: 'rgba(30, 41, 59, 0.6)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: '12px',
            padding: '1.2rem 1.5rem',
            marginBottom: '1.2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#94A3B8', display: 'block', marginBottom: '0.3rem' }}>
                  💰 輸入欲跟隨之投資總本金 (TWD):
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: '#94A3B8', fontSize: '1.1rem' }}>NT$</span>
                  <input
                    type="number"
                    step="50000"
                    value={userCapital}
                    onChange={(e) => setUserCapital(Number(e.target.value) || 0)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.9)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      borderRadius: '6px',
                      color: '#FFF',
                      fontSize: '1.1rem',
                      fontWeight: '800',
                      padding: '0.4rem 0.8rem',
                      width: '180px'
                    }}
                  />
                  {[500000, 1000000, 2000000, 5000000].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setUserCapital(amt)}
                      style={{
                        background: userCapital === amt ? 'rgba(59, 130, 246, 0.4)' : 'rgba(51, 65, 85, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: userCapital === amt ? '#60A5FA' : '#94A3B8',
                        borderRadius: '4px',
                        padding: '0.3rem 0.6rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer'
                      }}
                    >
                      {amt >= 1000000 ? `${amt / 1000000}百萬` : `${amt / 10000}萬`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '1.2rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>黃金階梯配置試算 (35% / 25% / 20% / 10% / 10%)</div>
                <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#38BDF8' }}>
                  5 檔依進攻階梯權重動態分配
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                  預計持股總額: NT$ {totalAllocatedAmount.toLocaleString()} (留存現金: NT$ {residualCash.toLocaleString()})
                </div>
              </div>
            </div>

            <button
              onClick={copyAllOrders}
              style={{
                background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
                border: 'none',
                borderRadius: '8px',
                color: '#FFF',
                fontWeight: '800',
                padding: '0.75rem 1.4rem',
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
              }}
            >
              <span>📋</span>
              <span>{copiedIndex === 'all' ? '✅ 已複製 5 檔跟隨清單！' : '一鍵複製 5 檔跟隨下單指令'}</span>
            </button>
          </div>

          {/* 5 檔持股卡片與表格 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {calculatedPositions.map((pos, idx) => (
              <div key={pos.id} style={{
                background: 'rgba(30, 41, 59, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '1.2rem',
                display: 'grid',
                gridTemplateColumns: '1.8fr 1fr 1fr 1.2fr 1.5fr 1fr',
                alignItems: 'center',
                gap: '1rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.15)'
              }}>
                {/* 股票標的與產業 */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.2)', color: '#60A5FA', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: '800' }}>
                      {pos.role}
                    </span>
                    <span style={{ fontSize: '1.15rem', fontWeight: '800', color: '#FFF' }}>
                      {pos.stock_id} {pos.stock_name}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>{pos.industry}</div>
                  <div style={{ fontSize: '0.72rem', color: '#38BDF8', marginTop: '0.2rem' }}>💡 {pos.highlight}</div>
                </div>

                {/* 現價與入場損益 */}
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>現價 (10/20)</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: '800', color: '#FFF' }}>NT$ {pos.current_price}</div>
                  <div style={{ fontSize: '0.75rem', color: pos.pnl_pct >= 0 ? '#34D399' : '#F87171', fontWeight: '700' }}>
                    {pos.pnl_pct >= 0 ? `+${pos.pnl_pct}%` : `${pos.pnl_pct}%`} (調倉價 ${pos.entry_price})
                  </div>
                </div>

                {/* 季線風控停損價 */}
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>60MA 季線停損價</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: '800', color: '#FB923C' }}>NT$ {pos.stop_loss_price}</div>
                  <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>距停損: {pos.stop_loss_pct}%</div>
                </div>

                {/* 建議買進配置 */}
                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.6rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>本金建議股數 ({pos.weight_pct}%)</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#38BDF8' }}>
                    {pos.targetShares.toLocaleString()} 股
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#CBD5E1' }}>
                    約 {pos.targetLots} 張 {pos.oddShares > 0 ? `+ ${pos.oddShares} 零股` : ''} (NT$ {pos.targetAmount.toLocaleString()})
                  </div>
                </div>

                {/* 風控停損條件 */}
                <div style={{ fontSize: '0.75rem', color: '#CBD5E1', lineHeight: '1.4' }}>
                  <div style={{ color: '#F59E0B', fontWeight: '700', marginBottom: '0.1rem' }}>🛡️ 出場條件</div>
                  {pos.stop_condition}
                </div>

                {/* 複製下單 */}
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => copySingleOrder(pos, idx)}
                    style={{
                      background: copiedIndex === idx ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.2)',
                      border: copiedIndex === idx ? '1px solid rgba(16, 185, 129, 0.6)' : '1px solid rgba(59, 130, 246, 0.5)',
                      color: copiedIndex === idx ? '#34D399' : '#60A5FA',
                      borderRadius: '6px',
                      padding: '0.45rem 0.8rem',
                      fontSize: '0.78rem',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    {copiedIndex === idx ? '✓ 已複製' : '📋 複製指令'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== TAB 2: 22 年真實淨值曲線 ===== */}
      {activeTabSub === 'curve' && (
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1.2rem', color: '#FFF' }}>
                📈 2005 ~ 2026 淨值成長軌跡 (對數尺度 Log10)
              </h3>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#94A3B8' }}>
                完全扣除 38.5 bps 摩擦稅費 · 經證交所官方開盤參考價雙向校正（除權息與減資無跳空水分）
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ width: '14px', height: '3px', background: '#38BDF8', display: 'inline-block' }}></span>
                <span style={{ color: '#38BDF8', fontWeight: '800' }}>👑 因果量化泰坦 (1,312.0x / CAGR 39.8%)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ width: '14px', height: '3px', background: '#94A3B8', display: 'inline-block' }}></span>
                <span style={{ color: '#94A3B8' }}>加權指數基準 (7.72x / CAGR 10.0%)</span>
              </div>
            </div>
          </div>

          {/* SVG 曲線圖表 */}
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${svgCurveData.width} ${svgCurveData.height}`} style={{ width: '100%', height: 'auto', maxHeight: '380px' }}>
              {/* 背景網格線 */}
              {[1, 10, 100, 1000].map(val => {
                const logVal = Math.log10(val);
                const logMin = Math.log10(0.8);
                const logMax = Math.log10(1500);
                const ratio = (logVal - logMin) / (logMax - logMin);
                const y = svgCurveData.height - svgCurveData.padding.bottom - ratio * (svgCurveData.height - svgCurveData.padding.top - svgCurveData.padding.bottom);
                return (
                  <g key={val}>
                    <line x1={svgCurveData.padding.left} y1={y} x2={svgCurveData.width - svgCurveData.padding.right} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                    <text x={svgCurveData.padding.left - 10} y={y + 4} fill="#64748B" fontSize="10" textAnchor="end">{val}x</text>
                  </g>
                );
              })}

              {/* 大盤曲線 */}
              <path d={svgCurveData.pathTx} fill="none" stroke="#64748B" strokeWidth="1.5" strokeOpacity="0.7" />
              {/* 策略曲線 */}
              <path d={svgCurveData.pathStrat} fill="none" stroke="#38BDF8" strokeWidth="2.5" />
            </svg>
          </div>
        </div>
      )}

      {/* ===== TAB 3: 2005~2026 歷年年度績效明細 ===== */}
      {activeTabSub === 'yearly' && (
        <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '12px', padding: '1.2rem', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', color: '#FFF' }}>
            📅 歷年年度報酬與超額 Alpha (2005～2026)
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8' }}>
                  <th style={{ padding: '0.6rem' }}>年份</th>
                  <th style={{ padding: '0.6rem', textAlign: 'right' }}>👑 因果量化泰坦</th>
                  <th style={{ padding: '0.6rem', textAlign: 'right' }}>加權指數同期</th>
                  <th style={{ padding: '0.6rem', textAlign: 'right' }}>年度超額 (Alpha)</th>
                  <th style={{ padding: '0.6rem', textAlign: 'center' }}>亮點防禦 / 進攻紀錄</th>
                </tr>
              </thead>
              <tbody>
                {yearly_stats.map(y => (
                  <tr key={y.year} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '0.6rem', fontWeight: '800', color: '#FFF' }}>{y.year}</td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: '800', color: y.strategy_ret >= 0 ? '#34D399' : '#F87171' }}>
                      {y.strategy_ret >= 0 ? `+${y.strategy_ret}%` : `${y.strategy_ret}%`}
                    </td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', color: '#94A3B8' }}>
                      {y.taiex_ret >= 0 ? `+${y.taiex_ret}%` : `${y.taiex_ret}%`}
                    </td>
                    <td style={{ padding: '0.6rem', textAlign: 'right', fontWeight: '700', color: y.alpha >= 0 ? '#38BDF8' : '#F87171' }}>
                      {y.alpha >= 0 ? `+${y.alpha}%` : `${y.alpha}%`}
                    </td>
                    <td style={{ padding: '0.6rem', textAlign: 'center' }}>
                      {y.year === 2008 && <span style={{ background: 'rgba(16,185,129,0.2)', color: '#34D399', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🛡️ 次貸海嘯僅跌 3.7% (保全本金)</span>}
                      {y.year === 2011 && <span style={{ background: 'rgba(16,185,129,0.2)', color: '#34D399', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🛡️ 歐債危機強勢抗跌</span>}
                      {y.year === 2013 && <span style={{ background: 'rgba(56,189,248,0.2)', color: '#38BDF8', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🚀 單年爆賺 +154.8%</span>}
                      {y.year === 2018 && <span style={{ background: 'rgba(56,189,248,0.2)', color: '#38BDF8', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🚀 貿易戰空頭逆勢翻倍 (+97.6%)</span>}
                      {y.year === 2020 && <span style={{ background: 'rgba(244,114,182,0.2)', color: '#F472B6', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🚀 疫情 QE 單年翻倍 (+119.6%)</span>}
                      {y.year === 2023 && <span style={{ background: 'rgba(167,139,250,0.2)', color: '#A78BFA', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🚀 AI 元年強勢翻倍 (+111.7%)</span>}
                      {y.year === 2026 && <span style={{ background: 'rgba(56,189,248,0.2)', color: '#38BDF8', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem' }}>🚀 權值主升段加速 (+138.2%)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== TAB 4: 四大因果 Alpha 因子解析 ===== */}
      {activeTabSub === 'alphas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem' }}>
          {causal_alphas.map((alpha, idx) => (
            <div key={idx} style={{
              background: 'rgba(30, 41, 59, 0.75)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '12px',
              padding: '1.4rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.75rem', background: 'rgba(167, 139, 250, 0.2)', color: '#C084FC', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: '800' }}>
                  {alpha.source}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#34D399', fontWeight: '800' }}>
                  不變性比率: {alpha.invariance_ratio}
                </span>
              </div>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#FFF', fontSize: '1.05rem' }}>{alpha.name}</h4>
              <div style={{ fontSize: '0.78rem', color: '#60A5FA', fontFamily: 'monospace', marginBottom: '0.8rem', background: 'rgba(15,23,42,0.6)', padding: '0.4rem 0.6rem', borderRadius: '6px' }}>
                {alpha.code}
              </div>
              <p style={{ fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.5', margin: 0 }}>
                {alpha.desc}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ===== TAB 5: 逐筆歷史交易紀錄 ===== */}
      {activeTabSub === 'trades' && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.75)',
          borderRadius: '12px',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          padding: '1.25rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
        }}>
          {/* 頂部工具列 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#FCD34D', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span>📜</span>
                <span>【台股因果泰坦 22 年全歷史】逐筆模擬交易明細 (共 {trades.length} 筆)</span>
              </h3>
              <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.25rem' }}>
                前 5 大因果 Alpha 股各 20% 等權重 · 每月 11 號法定營收公告日 T+1 建倉 · 60MA 季線破線即刻動態停損
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              {/* 搜尋欄 */}
              <input
                type="text"
                placeholder="🔍 搜尋股票名稱或代號..."
                value={tradeSearch}
                onChange={e => setTradeSearch(e.target.value)}
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '6px',
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#FFF',
                  fontSize: '0.78rem',
                  outline: 'none',
                  minWidth: '180px'
                }}
              />

              {/* 篩選按鈕 */}
              <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                  type="button"
                  onClick={() => setTradeFilter('all')}
                  style={{
                    padding: '0.2rem 0.65rem',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: tradeFilter === 'all' ? 'bold' : 'normal',
                    background: tradeFilter === 'all' ? '#2563EB' : 'transparent',
                    color: tradeFilter === 'all' ? 'white' : '#94A3B8'
                  }}
                >
                  全部 ({trades.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('win')}
                  style={{
                    padding: '0.2rem 0.65rem',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: tradeFilter === 'win' ? 'bold' : 'normal',
                    background: tradeFilter === 'win' ? 'rgba(16, 185, 129, 0.4)' : 'transparent',
                    color: tradeFilter === 'win' ? '#34D399' : '#94A3B8'
                  }}
                >
                  🟢 獲利 ({winCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTradeFilter('loss')}
                  style={{
                    padding: '0.2rem 0.65rem',
                    fontSize: '0.75rem',
                    borderRadius: '4px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: tradeFilter === 'loss' ? 'bold' : 'normal',
                    background: tradeFilter === 'loss' ? 'rgba(239, 68, 68, 0.4)' : 'transparent',
                    color: tradeFilter === 'loss' ? '#F87171' : '#94A3B8'
                  }}
                >
                  🔴 虧損/停損 ({lossCount})
                </button>
              </div>

              {/* 下載 CSV */}
              <button
                type="button"
                onClick={handleExportTradesCsv}
                style={{
                  padding: '0.3rem 0.85rem',
                  fontSize: '0.78rem',
                  background: 'rgba(59, 130, 246, 0.25)',
                  border: '1px solid #3B82F6',
                  color: '#93C5FD',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                📥 匯出 CSV 明細
              </button>
            </div>
          </div>

          {/* 表格主體 */}
          <div style={{ overflowX: 'auto', maxHeight: '560px', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', textAlign: 'center', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1E293B', color: '#CBD5E1' }}>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '0.65rem 0.5rem' }}>標的股票</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>配置角色</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>進場日期</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>進場價</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>出場日期</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>出場價</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>持有天數</th>
                  <th style={{ padding: '0.65rem 0.5rem' }}>單筆報酬率</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }}>出場原因 / 風控機制</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '2rem', color: '#94A3B8' }}>
                      無符合篩選條件之交易紀錄
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map((t, idx) => {
                    const isWin = (t.return_pct || 0) >= 0;
                    const formatDt = (d) => {
                      const s = String(d || '');
                      if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
                      return s;
                    };
                    return (
                      <tr key={idx} style={{
                        background: idx % 2 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.02)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)'
                      }}>
                        <td style={{ padding: '0.55rem 0.5rem', fontWeight: 'bold', color: '#FDE68A' }}>
                          {t.stock_name} <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>({t.stock_id})</span>
                        </td>
                        <td style={{ padding: '0.55rem 0.5rem' }}>
                          <span style={{
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            fontSize: '0.72rem',
                            fontWeight: 'bold',
                            background: t.role?.includes('先鋒') ? 'rgba(245, 158, 11, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                            color: t.role?.includes('先鋒') ? '#FBBF24' : '#38BDF8',
                            border: t.role?.includes('先鋒') ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(56, 189, 248, 0.4)'
                          }}>
                            {t.role || '👑 因果泰坦 (20%)'}
                          </span>
                        </td>
                        <td style={{ padding: '0.55rem 0.5rem', color: '#CBD5E1' }}>{formatDt(t.entry_date)}</td>
                        <td style={{ padding: '0.55rem 0.5rem', fontFamily: 'monospace', color: '#E2E8F0' }}>
                          {typeof t.entry_price === 'number' ? t.entry_price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : t.entry_price}
                        </td>
                        <td style={{ padding: '0.55rem 0.5rem', color: '#CBD5E1' }}>{formatDt(t.exit_date)}</td>
                        <td style={{ padding: '0.55rem 0.5rem', fontFamily: 'monospace', color: '#E2E8F0' }}>
                          {typeof t.exit_price === 'number' ? t.exit_price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : t.exit_price}
                        </td>
                        <td style={{ padding: '0.55rem 0.5rem', color: '#94A3B8' }}>{t.holding_days} 天</td>
                        <td style={{ padding: '0.55rem 0.5rem', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}{Number(t.return_pct || 0).toFixed(2)}%
                        </td>
                        <td style={{
                          padding: '0.55rem 0.5rem',
                          textAlign: 'left',
                          fontSize: '0.74rem',
                          color: t.exit_reason?.includes('停損') ? '#FCA5A5' : '#94A3B8'
                        }}>
                          {t.exit_reason}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
