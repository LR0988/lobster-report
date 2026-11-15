import React, { useState, useEffect, useMemo } from 'react';
import defaultCtaData from '../data/defaultCommodityCtaData.json';
import {
  apiGetCommodityCtaDashboard,
  apiTriggerCommodityCtaRescan,
  apiAddCommodityCtaTrade,
  apiCloseCommodityCtaTrade,
  apiDeleteCommodityCtaTrade
} from '../api';
import { StockChartButton } from './StockChart';

export default function CommodityCtaDashboard() {
  const [data, setData] = useState(defaultCtaData);
  const [loading, setLoading] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [notice, setNotice] = useState('');

  // 子分頁: 'active_sizing' | 'radar' | 'backtest' | 'ledger'
  const [activeSubTab, setActiveSubTab] = useState('active_sizing');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [tradeDirFilter, setTradeDirFilter] = useState('ALL'); // 'ALL' | 'SCALED' | 'LONG' | 'SHORT'
  const [tradeTickerFilter, setTradeTickerFilter] = useState('ALL');
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [capitalUsd, setCapitalUsd] = useState(100000); // 預設 $100,000 USD (約 320 萬台幣)
  const [execMode, setExecMode] = useState('MICRO'); // 'MICRO' | 'STD' | 'ETF'

  // 手動新增跟單表單
  const [newTradeForm, setNewTradeForm] = useState({
    ticker: 'BZ=F',
    name_zh: '布蘭特原油',
    sector: '能源 (Energy)',
    direction: '做多 (Long)',
    instrument_type: 'Micro微型期貨',
    symbol_used: 'MBZ',
    contracts: '2',
    multiplier: '100',
    entry_price: '98.32',
    entry_date: new Date().toISOString().split('T')[0],
    notes: '逆價差 +32.3%/年 順勢回檔買進'
  });

  const [closeInputs, setCloseInputs] = useState({});

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const fresh = await apiGetCommodityCtaDashboard(false);
        if (mounted && fresh && fresh.status === 'ok') {
          setData(fresh);
        }
      } catch (e) {
        console.warn('載入原物料 CTA 數據失敗，使用內建基準數據:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const handleRescan = async () => {
    setRescanning(true);
    setNotice('⏳ 正在從統一資料庫 tw_stock.db 重新運算 19 大原物料期貨期限結構與 CTA 動能訊號...');
    try {
      const res = await apiTriggerCommodityCtaRescan();
      if (res && res.data) {
        setData(res.data);
        setNotice(`✅ ${res.message || '重算完成！'}`);
      } else {
        const fresh = await apiGetCommodityCtaDashboard(true);
        if (fresh) setData(fresh);
        setNotice('✅ 已同步最新原物料期貨與期限結構數據！');
      }
    } catch (e) {
      setNotice(`⚠️ 重算連線異常，目前顯示快取數據 (${e.message})`);
    } finally {
      setRescanning(false);
      setTimeout(() => setNotice(''), 6000);
    }
  };

  const handleQuickFollow = async (pos) => {
    const isMicro = execMode === 'MICRO';
    const isStd = execMode === 'STD';
    const targetNotional = capitalUsd * ((pos.target_weight_pct || 15) / 100.0);
    let sym = pos.micro_symbol;
    let mult = pos.micro_multiplier || 100;
    let instType = 'Micro微型海期';
    let qty = Math.max(1, Math.round(targetNotional / Math.max(pos.micro_notional_usd || 5000, 100)));

    if (isStd) {
      sym = pos.std_symbol;
      mult = pos.std_multiplier || 1000;
      instType = 'Standard標準海期';
      qty = Math.max(1, Math.round(targetNotional / Math.max(pos.std_notional_usd || 50000, 1000)));
    } else if (execMode === 'ETF') {
      sym = pos.etf_proxy;
      mult = 1.0;
      instType = '美股原物料ETF';
      qty = Math.max(10, Math.round(targetNotional / 50));
    }

    const payload = {
      ticker: pos.ticker,
      name_zh: pos.name_zh,
      sector: pos.sector,
      direction: pos.direction,
      instrument_type: instType,
      symbol_used: sym,
      contracts: qty,
      multiplier: mult,
      entry_price: pos.front_price,
      entry_date: data?.market_date || new Date().toISOString().split('T')[0],
      notes: `CTA泰坦正選 #${pos.rank} | 轉倉收益 ${pos.live_roll_yield_pct >= 0 ? '+' : ''}${pos.live_roll_yield_pct}%/年 | 停損 ${pos.active_stop_price}`
    };

    try {
      const updated = await apiAddCommodityCtaTrade(payload);
      if (updated && updated.status === 'ok') {
        setData(updated);
        setNotice(`✅ 已將【${pos.name_zh} (${sym}) ${pos.direction} ${qty} 口/股】寫入 tw_stock.db 實戰帳本！`);
        setActiveSubTab('ledger');
      }
    } catch (e) {
      setNotice(`⚠️ 寫入本機資料庫失敗: ${e.message}`);
    }
    setTimeout(() => setNotice(''), 5000);
  };

  const handleManualAddTrade = async (e) => {
    e.preventDefault();
    try {
      const updated = await apiAddCommodityCtaTrade(newTradeForm);
      if (updated && updated.status === 'ok') {
        setData(updated);
        setNotice(`✅ 已新增【${newTradeForm.name_zh} (${newTradeForm.symbol_used})】至 tw_stock.db！`);
      }
    } catch (err) {
      setNotice(`⚠️ 新增失敗: ${err.message}`);
    }
    setTimeout(() => setNotice(''), 4000);
  };

  const handleCloseTrade = async (tradeId, defaultPx) => {
    const inp = closeInputs[tradeId] || {};
    const exitPx = parseFloat(inp.exit_price ?? defaultPx);
    if (!exitPx || isNaN(exitPx)) return;
    try {
      const updated = await apiCloseCommodityCtaTrade(tradeId, {
        exit_price: exitPx,
        exit_date: inp.exit_date || new Date().toISOString().split('T')[0],
        exit_reason: inp.exit_reason || '🎯 觸及移動停利/換月平倉'
      });
      if (updated && updated.status === 'ok') {
        setData(updated);
        setNotice('✅ 已完成平倉結算並更新至 tw_stock.db！');
      }
    } catch (err) {
      setNotice(`⚠️ 平倉失敗: ${err.message}`);
    }
  };

  const handleDeleteTrade = async (tradeId) => {
    try {
      const updated = await apiDeleteCommodityCtaTrade(tradeId);
      if (updated && updated.status === 'ok') {
        setData(updated);
        setNotice('🗑️ 已刪除該筆交易紀錄。');
      }
    } catch (err) {
      setNotice(`⚠️ 刪除失敗: ${err.message}`);
    }
  };

  const fs = data?.flagship_summary || {};
  const v41 = data?.v41_baseline_summary || {};
  const macro = data?.macro_regime || {};
  const twStats = data?.trade_win_rate_stats || {};
  const aoAudit = data?.anti_overfit_audit || {};
  const activePositions = data?.official_active_positions || [];
  const radarList = data?.term_structure_radar || [];
  const ablationTiers = data?.ablation_tiers || [];
  const crisisList = data?.crisis_alpha_periods || [];
  const annualList = data?.annual_comparison || [];
  const recentTrades = data?.recent_trades || [];
  const userTrades = data?.user_trades || [];
  const pillars = data?.methodology_pillars || [];
  const eqCurve = data?.equity_curve || [];

  const filteredTrades = useMemo(() => {
    return recentTrades.filter(t => {
      if (tradeTickerFilter !== 'ALL' && t.ticker !== tradeTickerFilter) return false;
      if (tradeDirFilter === 'SCALED' && !t.scaled_out) return false;
      if (tradeDirFilter === 'LONG' && !t.direction?.includes('做多')) return false;
      if (tradeDirFilter === 'SHORT' && !t.direction?.includes('做空')) return false;
      return true;
    });
  }, [recentTrades, tradeDirFilter, tradeTickerFilter]);

  const filteredRadar = useMemo(() => {
    if (sectorFilter === 'ALL') return radarList;
    return radarList.filter(r => r.sector === sectorFilter);
  }, [radarList, sectorFilter]);

  const radarMap = useMemo(() => {
    const m = {};
    radarList.forEach(r => { m[r.ticker] = r; });
    return m;
  }, [radarList]);

  // 繪製 2005-2026 對數淨值曲線 SVG
  const renderEquitySvg = () => {
    if (!eqCurve || eqCurve.length < 10) return null;
    const W = 880;
    const H = 270;
    const padL = 55;
    const padR = 25;
    const padT = 22;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // 採用對數刻度呈現 22 年長期複利
    const allVals = [];
    eqCurve.forEach(pt => {
      allVals.push(Math.log10(Math.max(pt.cta_titan || 1, 0.3)));
      if (pt.cta_v41) allVals.push(Math.log10(Math.max(pt.cta_v41, 0.3)));
      allVals.push(Math.log10(Math.max(pt.carry_atr || 1, 0.3)));
      allVals.push(Math.log10(Math.max(pt.spy || 1, 0.3)));
      allVals.push(Math.log10(Math.max(pt.passive_comm || 1, 0.3)));
    });
    const minLog = Math.min(...allVals, -0.2);
    const maxLog = Math.max(...allVals, 1.85);

    const xOf = (i) => padL + (i / (eqCurve.length - 1)) * plotW;
    const yOf = (val) => {
      const lv = Math.log10(Math.max(val || 1, 0.3));
      return padT + plotH - ((lv - minLog) / (maxLog - minLog + 1e-6)) * plotH;
    };

    const buildPath = (key) =>
      eqCurve.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(pt[key]).toFixed(1)}`).join(' ');

    const yTicks = [0.5, 1, 2, 5, 10, 20, 40, 60];

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: 'rgba(15, 23, 42, 0.75)', borderRadius: '10px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
        {yTicks.map(tv => {
          const y = yOf(tv);
          if (y < padT || y > padT + plotH) return null;
          return (
            <g key={tv}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(148, 163, 184, 0.14)" strokeDasharray="3,3" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="#94A3B8" fontSize="10" fontFamily="monospace">{tv}x</text>
            </g>
          );
        })}
        {eqCurve.map((pt, i) => {
          if (i % 36 !== 0 && i !== eqCurve.length - 1) return null;
          const x = xOf(i);
          return (
            <text key={pt.date} x={x} y={H - 10} textAnchor="middle" fill="#94A3B8" fontSize="10" fontFamily="monospace">
              {pt.date.slice(0, 4)}
            </text>
          );
        })}
        {/* 被動原物料指數 */}
        <path d={buildPath('passive_comm')} fill="none" stroke="#64748B" strokeWidth="1.6" strokeDasharray="4,3" />
        {/* 標普 500 */}
        <path d={buildPath('spy')} fill="none" stroke="#38BDF8" strokeWidth="1.8" />
        {/* Tier 3: Carry + 1/ATR */}
        <path d={buildPath('carry_atr')} fill="none" stroke="#A78BFA" strokeWidth="1.8" />
        {/* Clean V4.1 對照線 */}
        {eqCurve[0]?.cta_v41 && (
          <path d={buildPath('cta_v41')} fill="none" stroke="#34D399" strokeWidth="1.8" strokeDasharray="5,3" />
        )}
        {/* Tier S++: 全球原物料泰坦 CTA 旗艦 V5.0 */}
        <path d={buildPath('cta_titan')} fill="none" stroke="#F59E0B" strokeWidth="2.9" />
      </svg>
    );
  };

  return (
    <div style={{ color: '#F8FAFC', paddingBottom: '2.5rem' }}>
      {/* 頂部旗艦戰情橫幅 */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(120, 53, 15, 0.45) 0%, rgba(15, 23, 42, 0.95) 60%, rgba(6, 78, 59, 0.35) 100%)',
        border: '1px solid rgba(245, 158, 11, 0.45)',
        borderRadius: '14px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.2rem',
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{
                background: 'linear-gradient(90deg, #F59E0B, #EA580C)',
                color: '#0F172A',
                fontWeight: 900,
                fontSize: '0.76rem',
                padding: '0.2rem 0.65rem',
                borderRadius: '999px',
                letterSpacing: '0.5px'
              }}>
                GLOBAL COMMODITY CTA TITAN V5.0
              </span>
              <span style={{
                background: 'rgba(16, 185, 129, 0.18)',
                color: '#34D399',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                fontSize: '0.75rem',
                padding: '0.18rem 0.6rem',
                borderRadius: '6px',
                fontWeight: 'bold'
              }}>
                🗄️ 統一資料庫 tw_stock.db 直連 (19大主力合約 × 期限結構 × DXY/ER40 正交因子 × 雙階鎖利)
              </span>
              <span style={{ color: '#94A3B8', fontSize: '0.78rem' }}>
                最新行情基準日：<strong style={{ color: '#FDE68A' }}>{data?.market_date || '2026-11-06'}</strong>
              </span>
            </div>
            <h2 style={{ margin: '0.55rem 0 0.35rem 0', fontSize: '1.45rem', fontWeight: 800, color: '#FEF3C7' }}>
              🛢️ 全球原物料期貨 CTA 泰坦量化引擎 V5.0（高勝率雙階鎖利 × DXY/ER 正交過濾 × 27/27 全參數高原防擬合版）
            </h2>
            <p style={{ margin: 0, fontSize: '0.84rem', color: '#CBD5E1', lineHeight: 1.55 }}>
              在純淨零洩漏 <strong style={{ color: '#93C5FD' }}>Clean V4.1 ({v41.cagr_pct ?? 18.91}% / 勝率 {twStats.v41_win_rate_clean_pct ?? 46.52}%)</strong> 基礎上，導入五大經濟學正交升級：
              <strong style={{ color: '#FDE68A' }}> M1 期限結構共鳴進場+1.28x滯後換倉</strong>、
              <strong style={{ color: '#FDE68A' }}> M2 Kaufman ER_40 效率降雜訊</strong>、
              <strong style={{ color: '#FDE68A' }}> M3 DXY 美元體制外生順逆風</strong>、
              <strong style={{ color: '#34D399' }}> M4 雙階 ATR 鎖利+保本護盾</strong> 與
              <strong style={{ color: '#34D399' }}> M5 組合波動率閘門</strong>，
              全樣本、Ex-2026 樣本外與 2x 12bps 壓力測試全數帕累托碾壓舊版。
            </p>
          </div>

          <button
            type="button"
            onClick={handleRescan}
            disabled={rescanning || loading}
            style={{
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#0F172A',
              fontWeight: 800,
              border: 'none',
              borderRadius: '10px',
              padding: '0.65rem 1.1rem',
              cursor: rescanning ? 'wait' : 'pointer',
              fontSize: '0.85rem',
              boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
              whiteSpace: 'nowrap'
            }}
          >
            {rescanning ? '⏳ 正在重算 19 大期貨...' : '🔄 重算 tw_stock.db 期貨訊號'}
          </button>
        </div>

        {notice && (
          <div style={{
            marginTop: '0.8rem',
            padding: '0.55rem 0.9rem',
            borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.18)',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            color: '#A7F3D0',
            fontSize: '0.83rem',
            fontWeight: 600
          }}>
            {notice}
          </div>
        )}

        {/* 6 大核心權威回測與宏觀 KPI 卡片 (V5.0 帕累托升級) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
          gap: '0.8rem',
          marginTop: '1.1rem'
        }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(245, 158, 11, 0.45)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>🏆 21.8年年化報酬 (Strict T+1 Open)</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#FBBF24', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              +{fs.cagr_pct ?? 21.2}%
            </div>
            <div style={{ fontSize: '0.73rem', color: '#34D399' }}>
              累積 <strong>{fs.total_multiple ?? 66.76}x</strong> ｜ Ex-2026: <strong>+{fs.ex_2026_cagr_pct ?? 21.38}%</strong> (V4.1 {v41.cagr_pct ?? 18.91}%)
            </div>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(52, 211, 153, 0.4)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>🎯 逐筆真實單筆勝率 (含雙階鎖利)</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#34D399', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              {twStats.win_rate_clean_pct ?? fs.single_trade_win_rate_pct ?? 52.14}%
            </div>
            <div style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>
              {twStats.win_trades ?? 426}/{twStats.total_trades ?? 817} 筆 ｜ 獲利因子 <strong>{twStats.profit_factor ?? fs.profit_factor ?? 1.84}</strong> (V4.1 {twStats.v41_win_rate_clean_pct ?? 46.52}%)
            </div>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(56, 189, 248, 0.35)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>🛡️ 月度最大回撤 &amp; 風險收益比</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#38BDF8', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              {fs.mdd_monthly_pct ?? -22.35}% <span style={{ fontSize: '0.92rem', color: '#94A3B8' }}>/ Sh {fs.sharpe ?? 1.04}</span>
            </div>
            <div style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>
              日MDD {fs.mdd_daily_pct ?? -22.8}% ｜ Calmar <strong>{fs.calmar ?? 0.95}</strong> (V4.1 0.78)
            </div>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(167, 139, 250, 0.35)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>🧬 八重防過度擬合高原驗證</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#C4B5FD', fontFamily: 'monospace', marginTop: '0.15rem' }}>
              {aoAudit.grid_beat_v41_cagr ?? 27}/{aoAudit.grid_total_cells ?? 27} 鄰域全勝
            </div>
            <div style={{ fontSize: '0.73rem', color: '#34D399' }}>
              2x 12bps 嚴酷: <strong>+{aoAudit.harsh_12bps_cagr_pct ?? 18.83}%</strong> ｜ 投毒差分 <strong>0.00</strong>
            </div>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(251, 146, 60, 0.35)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>💵 DXY 美元體制 &amp; 組合波動閘門</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#FB923C', fontFamily: 'monospace', marginTop: '0.2rem' }}>
              DXY {macro.dxy_spot ?? '—'} ({macro.dxy_ret20_pct >= 0 ? '+' : ''}{macro.dxy_ret20_pct ?? '0'}%)
            </div>
            <div style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>
              {macro.dxy_regime_label ?? '美元體制平衡'} ｜ M5 倍率 <strong>{macro.portfolio_vol_scalar ?? 1.0}x</strong>
            </div>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(148, 163, 184, 0.3)', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>🧭 當前原物料配置與 BIL 護盾</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FDE68A', marginTop: '0.2rem' }}>
              廣度 {macro.breadth_200ma_pct ?? 36.8}% &gt; 年線
            </div>
            <div style={{ fontSize: '0.73rem', color: '#94A3B8' }}>
              期貨 {macro.active_futures_weight_pct ?? 0}% ｜ GLD {macro.gld_reserve_weight_pct ?? 0}% ｜ BIL <strong style={{ color: '#34D399' }}>{macro.bil_shield_weight_pct ?? 100}%</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 四大功能導覽子分頁 */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
        {[
          { id: 'active_sizing', label: `🎯 官方當期正選部位 & 1/ATR 口數計算機 (${activePositions.length}檔)` },
          { id: 'radar', label: `📡 19大原物料期限結構與動能全雷達 (${radarList.length}檔)` },
          { id: 'backtest', label: '📊 22年五階消融實證、Crisis Alpha 與交易明細' },
          { id: 'ledger', label: `💼 我的海期/ETF實戰跟單帳本 (${userTrades.length}筆)` },
        ].map(tab => {
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                padding: '0.6rem 1.05rem',
                borderRadius: '10px',
                border: active ? '1px solid #F59E0B' : '1px solid rgba(148, 163, 184, 0.25)',
                background: active ? 'rgba(245, 158, 11, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                color: active ? '#FDE68A' : '#CBD5E1',
                fontWeight: active ? 800 : 600,
                fontSize: '0.84rem',
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ================= 子分頁 1: 官方當期正選部位 & 1/ATR 口數計算機 ================= */}
      {activeSubTab === 'active_sizing' && (
        <div>
          {/* 資金規模與交易工具選擇器 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.8)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            marginBottom: '1.2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#BAE6FD' }}>💰 帳戶總資金規模 (USD)：</span>
              {[
                { label: '$30,000 (約100萬台幣)', val: 30000 },
                { label: '$100,000 (約320萬台幣)', val: 100000 },
                { label: '$300,000 (約960萬台幣)', val: 300000 },
                { label: '$1,000,000 (機構標準倉)', val: 1000000 },
              ].map(preset => (
                <button
                  key={preset.val}
                  type="button"
                  onClick={() => setCapitalUsd(preset.val)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '6px',
                    border: capitalUsd === preset.val ? '1px solid #38BDF8' : '1px solid rgba(148,163,184,0.3)',
                    background: capitalUsd === preset.val ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.7)',
                    color: capitalUsd === preset.val ? '#E0F2FE' : '#94A3B8',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {preset.label}
                </button>
              ))}
              <input
                type="number"
                value={capitalUsd}
                onChange={e => setCapitalUsd(Math.max(5000, Number(e.target.value) || 0))}
                style={{
                  width: '115px',
                  padding: '0.35rem 0.55rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(56,189,248,0.4)',
                  background: '#0F172A',
                  color: '#FDE68A',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  fontSize: '0.84rem'
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#FDE68A' }}>⚙️ 執行載具：</span>
              {[
                { id: 'MICRO', label: '⚡ CME 微型/迷你海期 (MCL/MGC/SIL/XC・推薦)' },
                { id: 'STD', label: '🏛️ 標準海期合約 (CL/GC/SI/ZC)' },
                { id: 'ETF', label: '📈 免轉倉美股 ETF 替代 (USO/BNO/GLD/DBA)' }
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setExecMode(m.id)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '6px',
                    border: execMode === m.id ? '1px solid #F59E0B' : '1px solid rgba(148,163,184,0.3)',
                    background: execMode === m.id ? 'rgba(245, 158, 11, 0.25)' : 'rgba(30, 41, 59, 0.7)',
                    color: execMode === m.id ? '#FEF3C7' : '#94A3B8',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* V5.0 嚴格 T+1 開盤成交 × 漲跌停鎖死防呆 × 小資金載具限制稽核面板 */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.35), rgba(15, 23, 42, 0.9))',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            borderRadius: '12px',
            padding: '0.9rem 1.15rem',
            marginBottom: '1.15rem',
            fontSize: '0.8rem',
            color: '#E2E8F0',
            lineHeight: 1.65
          }}>
            <div style={{ fontWeight: 800, color: '#34D399', fontSize: '0.88rem', marginBottom: '0.35rem' }}>
              🛡️ V5.0 嚴格 T+1 開盤執行架構 (Strict T+1 Open) × 漲跌停/無量日鎖死防呆 × 未來資料投毒 0.00e+00 驗證通過
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.65rem' }}>
              <div>
                <strong style={{ color: '#FDE68A' }}>① 嚴格 T+1 開盤成交 (零偷吃隔夜跳空)：</strong>
                訊號 100% 鎖定於 <code>T-1 收盤</code> 產生，換倉日之<strong>隔夜跳空報酬 (Close[t-1]→Open[t]) 嚴格歸屬舊倉位</strong>，新倉位僅於 <code>Open[t]</code> 開盤價成交。計入雙邊滑價 (6 bps) 後年化 <strong style={{ color: '#34D399' }}>+{fs.cagr_pct ?? 21.2}%</strong>；即使雙倍嚴酷成本 (12 bps) 年化仍達 <strong style={{ color: '#38BDF8' }}>+{aoAudit.harsh_12bps_cagr_pct ?? 18.83}%</strong>，極端延遲滿 24 小時至 <code>T+1 收盤</code> 才成交年化亦達 <strong>+{data?.tradability_audit?.delayed_24h_next_close_cagr_pct ?? 17.88}% ({data?.tradability_audit?.delayed_24h_next_close_win_years ?? '20/22'})</strong>。
              </div>
              <div>
                <strong style={{ color: '#38BDF8' }}>② 漲跌停鎖死與無量假日禁買賣保護：</strong>
                當 <code>Open[t]</code> 出現 CBOT/ICE 漲跌停鎖死 (<code>High == Low</code>)、休市無量 (<code>Volume &lt;= 0</code>) 或超過 <code>max(4.5%, 2.5×NATR)</code> 之極端跳空時，系統強制禁止買進或平倉（22 年共攔截延後 <strong>{data?.tradability_audit?.blocked_limit_or_holiday_trades_22y ?? 387} 筆</strong>異常開盤，違規成交次數 <strong>{aoAudit.untradable_violations ?? 0}</strong>）。
              </div>
              <div>
                <strong style={{ color: '#C4B5FD' }}>③ 小資金 (&lt;$30萬 USD)「買不到微型合約」解方與實盤帳本嚴格對齊：</strong>
                當日實盤訊號 100% 由模擬帳本最新交易日動態輸出（絕不雙重標準）。19 檔中有 <strong>14 檔為 CME 集團品種</strong>（具 <code>MCL, MGC, SIL, MHG, XC, XK</code> 微型合約）；遇到無微型合約之 5 檔 ICE/活牛品種可切換上方 ETF 模式，或採用<strong>「💎 純 CME 14 檔子集」</strong>（V5.0 年化仍達 <strong>+{data?.tradability_audit?.cme_14_subset_cagr_pct ?? 17.65}%、月度 MDD {data?.tradability_audit?.cme_14_subset_mdd_monthly_pct ?? -20.8}%、{data?.tradability_audit?.cme_14_subset_win_years ?? '20/22'} 勝年</strong>）。
              </div>
            </div>
          </div>

          {/* 官方當期 Top-5 正選持倉與建議買賣口數表 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem',
            marginBottom: '1.3rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.08rem', color: '#FDE68A' }}>
                🏛️ 全球原物料泰坦 CTA V5.0【當期官方實戰正選部位 &amp; 1/ATR 波動率平價口數建議】
              </h3>
              <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                規則：單一板塊上限 2 檔 ｜ 逆價差共鳴順勢做多 × 正價差破線做空 ｜ 閒置保證金停泊 <code style={{ color: '#38BDF8' }}>BIL 短債 + GLD 黃金儲備</code>
              </span>
            </div>

            {activePositions.length === 0 ? (
              <div style={{
                background: 'linear-gradient(135deg, rgba(14, 116, 144, 0.22), rgba(15, 23, 42, 0.92))',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                borderRadius: '10px',
                padding: '1.15rem 1.25rem',
                color: '#E2E8F0',
                lineHeight: 1.65
              }}>
                <div style={{ fontWeight: 900, fontSize: '1.0rem', color: '#38BDF8', marginBottom: '0.35rem' }}>
                  🛡️ 100% 美元短債 (BIL) 防禦空倉護盾啟動中（當期 0 檔原物料符合 V5.0 嚴格突破進場條件）
                </div>
                <div style={{ fontSize: '0.82rem', color: '#CBD5E1' }}>
                  目前最新基準日（<strong style={{ color: '#FDE68A' }}>{data?.market_date || '2026-11-06'}</strong>）全市場 19 檔原物料僅 <strong style={{ color: '#FBBF24' }}>{macro.breadth_200ma_pct ?? 36.8}%</strong> 位於 200 日年線之上，尚未觸發任何多空雙邊突破與期限結構共鳴條件。
                  V5.0 秉持<strong>「實盤與模擬帳本 100% 一致」</strong>原則（嚴禁硬編碼湊數），將全部保證金自動停泊於 <strong style={{ color: '#34D399' }}>BIL 美國超短天期公債 ({macro.bil_shield_weight_pct ?? 100}%)</strong> 領取無風險短債殖利率（{macro.tbill_collateral_yield_pct ?? 4.45}%），耐心等待下次共鳴趨勢出現。
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table className="stock-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>順位</th>
                    <th>商品名稱 (代碼)</th>
                    <th>所屬板塊</th>
                    <th>多空方向</th>
                    <th>近月現價 / 遠月價</th>
                    <th>年化轉倉收益 (Carry)</th>
                    <th>20D / 60D / 126D</th>
                    <th>NATR(20) 日波動</th>
                    <th>目標曝險權重</th>
                    <th>建議下單口數 ({execMode === 'MICRO' ? '微型合約' : execMode === 'STD' ? '標準合約' : 'ETF股數'})</th>
                    <th>預估保證金 / 1ATR風險</th>
                    <th>2.2×ATR 停損保護價</th>
                    <th>K線 / 一鍵跟單</th>
                  </tr>
                </thead>
                <tbody>
                  {activePositions.map((pos) => {
                    const isLong = pos.direction?.includes('做多');
                    const isBack = (pos.live_roll_yield_pct || 0) >= 0;
                    const targetNotional = capitalUsd * ((pos.target_weight_pct || 15) / 100.0);

                    let sym = pos.micro_symbol;
                    let unitDesc = pos.micro_unit;
                    let notionalPerLot = pos.micro_notional_usd || 5000;
                    let marginPerLot = pos.micro_margin_usd || 600;
                    let atrRiskPerLot = pos.micro_1atr_risk_usd || 100;

                    if (execMode === 'STD') {
                      sym = pos.std_symbol;
                      unitDesc = pos.std_unit;
                      notionalPerLot = pos.std_notional_usd || 50000;
                      marginPerLot = pos.std_margin_usd || 6000;
                      atrRiskPerLot = pos.std_1atr_risk_usd || 1000;
                    } else if (execMode === 'ETF') {
                      sym = pos.etf_proxy;
                      unitDesc = 'ETF股數';
                      notionalPerLot = 50;
                      marginPerLot = 50;
                      atrRiskPerLot = Math.round(50 * ((pos.natr_20_pct || 2) / 100));
                    }

                    const recLots = Math.max(1, Math.round(targetNotional / Math.max(notionalPerLot, 1)));
                    const totalMargin = Math.round(recLots * marginPerLot);
                    const total1AtrRisk = Math.round(recLots * atrRiskPerLot);

                    return (
                      <tr key={pos.ticker} style={{ background: isLong ? 'rgba(16, 185, 129, 0.06)' : 'rgba(239, 68, 68, 0.06)' }}>
                        <td style={{ fontWeight: 900, color: '#FBBF24', fontFamily: 'monospace' }}>#{pos.rank}</td>
                        <td style={{ fontWeight: 800, color: '#F8FAFC' }}>
                          {pos.name_zh} <span style={{ color: '#94A3B8', fontSize: '0.74rem' }}>({pos.ticker})</span>
                          <div style={{ fontSize: '0.7rem', color: '#38BDF8', marginTop: '2px' }}>{pos.signal_status}</div>
                          {pos.scaled_out && (
                            <div style={{ fontSize: '0.68rem', color: '#34D399', fontWeight: 800, marginTop: '2px' }}>🎯 M4 雙階鎖利 38% 已觸發 ({pos.scale_date})</div>
                          )}
                          {pos.event_signal_badge && (
                            <div style={{ fontSize: '0.68rem', color: '#FBBF24', marginTop: '2px' }}>{pos.event_signal_badge}</div>
                          )}
                        </td>
                        <td style={{ color: '#CBD5E1', fontSize: '0.76rem' }}>{pos.sector}</td>
                        <td>
                          <span style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: '6px',
                            fontWeight: 800,
                            fontSize: '0.76rem',
                            background: isLong ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)',
                            color: isLong ? '#34D399' : '#FCA5A5',
                            border: isLong ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(239, 68, 68, 0.5)'
                          }}>
                            {pos.direction}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace' }}>
                          <strong style={{ color: '#FDE68A' }}>{pos.front_price}</strong>
                          <span style={{ color: '#94A3B8', fontSize: '0.73rem' }}> / {pos.deferred_price} ({pos.deferred_ticker})</span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: isBack ? '#34D399' : '#F87171' }}>
                          {pos.live_roll_yield_pct >= 0 ? '+' : ''}{pos.live_roll_yield_pct}%/年
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{pos.curve_structure}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          <span style={{ color: pos.ret_20d_pct >= 0 ? '#34D399' : '#F87171' }}>{pos.ret_20d_pct >= 0 ? '+' : ''}{pos.ret_20d_pct}%</span>
                          {' / '}
                          <span style={{ color: pos.ret_60d_pct >= 0 ? '#34D399' : '#F87171' }}>{pos.ret_60d_pct >= 0 ? '+' : ''}{pos.ret_60d_pct}%</span>
                          {' / '}
                          <span style={{ color: pos.ret_126d_pct >= 0 ? '#34D399' : '#F87171' }}>{pos.ret_126d_pct >= 0 ? '+' : ''}{pos.ret_126d_pct}%</span>
                        </td>
                        <td style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>
                          {pos.natr_20_pct}%
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>ATR: {pos.atr_20}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#FBBF24' }}>
                          {pos.target_weight_pct}%
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>${Math.round(targetNotional).toLocaleString()}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 900, color: '#38BDF8', fontSize: '0.88rem' }}>
                          {recLots} {execMode === 'ETF' ? '股' : '口'} <code style={{ color: '#FDE68A' }}>{sym}</code>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 400 }}>{unitDesc}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          <div style={{ color: '#E2E8F0' }}>保證金: ${totalMargin.toLocaleString()}</div>
                          <div style={{ color: '#FCA5A5' }}>1ATR波動: ±${total1AtrRisk.toLocaleString()}</div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#FCA5A5' }}>
                          {pos.active_stop_price}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <StockChartButton ticker={pos.ticker} name={pos.name_zh} />
                            <button
                              type="button"
                              onClick={() => handleQuickFollow(pos)}
                              style={{
                                padding: '0.28rem 0.55rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(52, 211, 153, 0.5)',
                                background: 'rgba(16, 185, 129, 0.2)',
                                color: '#6EE7B7',
                                fontWeight: 700,
                                fontSize: '0.73rem',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              ⚡ 記帳跟單
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          {/* 五大正交策略支柱說明卡 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
            gap: '0.85rem'
          }}>
            {pillars.map((p) => (
              <div key={p.id} style={{
                background: 'rgba(15, 23, 42, 0.78)',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                borderRadius: '10px',
                padding: '0.95rem 1.1rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <span style={{ fontWeight: 800, color: '#FBBF24', fontSize: '0.88rem' }}>{p.title}</span>
                </div>
                <div style={{
                  display: 'inline-block',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '4px',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  fontFamily: 'monospace',
                  fontSize: '0.73rem',
                  fontWeight: 700,
                  marginBottom: '0.45rem'
                }}>
                  {p.metric}
                </div>
                <p style={{ margin: 0, fontSize: '0.79rem', color: '#CBD5E1', lineHeight: 1.55 }}>{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= 子分頁 2: 19大原物料期限結構與動能全雷達 ================= */}
      {activeSubTab === 'radar' && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          borderRadius: '12px',
          padding: '1.1rem 1.25rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#FDE68A' }}>
              📡 全球 19 大核心原物料期貨【近遠月期限結構 (Carry) × 多週期動能 × 合約規格全雷達】
            </h3>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {['ALL', '能源 (Energy)', '貴金屬 (Precious Metals)', '工業金屬 (Industrial Metals)', '農產品穀物 (Grains)', '軟性與農畜 (Softs)'].map(sec => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setSectorFilter(sec)}
                  style={{
                    padding: '0.32rem 0.68rem',
                    borderRadius: '6px',
                    border: sectorFilter === sec ? '1px solid #F59E0B' : '1px solid rgba(148,163,184,0.25)',
                    background: sectorFilter === sec ? 'rgba(245, 158, 11, 0.22)' : 'rgba(30, 41, 59, 0.7)',
                    color: sectorFilter === sec ? '#FDE68A' : '#94A3B8',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {sec === 'ALL' ? '全部 19 檔' : sec}
                </button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="stock-table" style={{ width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>商品名稱 (代碼)</th>
                  <th>板塊 / 交易所</th>
                  <th>近月價</th>
                  <th>遠月價 (合約)</th>
                  <th>年化轉倉收益 (Carry)</th>
                  <th>20D / 60D / 126D 報酬</th>
                  <th>TSMOM Z分</th>
                  <th>ER_40 效率 / DXY 倍率</th>
                  <th>均線結構 (20/60/200)</th>
                  <th>NATR(20)</th>
                  <th>標準合約 / 微型合約 / ETF</th>
                  <th>換月月份</th>
                  <th>當期 CTA 診斷訊號</th>
                  <th>K線</th>
                </tr>
              </thead>
              <tbody>
                {filteredRadar.map((r) => {
                  const isBack = r.live_roll_yield_pct >= 0;
                  return (
                    <tr key={r.ticker}>
                      <td style={{ fontWeight: 800, color: '#F8FAFC' }}>
                        {r.name_zh} <span style={{ color: '#94A3B8', fontSize: '0.73rem' }}>({r.ticker})</span>
                      </td>
                      <td style={{ fontSize: '0.74rem', color: '#CBD5E1' }}>
                        {r.sector} <span style={{ color: '#64748B' }}>({r.exchange})</span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#FDE68A' }}>{r.front_price}</td>
                      <td style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>
                        {r.deferred_price} <span style={{ fontSize: '0.7rem', color: '#64748B' }}>({r.deferred_ticker})</span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, color: isBack ? '#34D399' : '#F87171' }}>
                        {r.live_roll_yield_pct >= 0 ? '+' : ''}{r.live_roll_yield_pct}%/年
                        <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{r.curve_structure}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>
                        <span style={{ color: r.ret_20d_pct >= 0 ? '#34D399' : '#F87171' }}>{r.ret_20d_pct >= 0 ? '+' : ''}{r.ret_20d_pct}%</span>
                        {' / '}
                        <span style={{ color: r.ret_60d_pct >= 0 ? '#34D399' : '#F87171' }}>{r.ret_60d_pct >= 0 ? '+' : ''}{r.ret_60d_pct}%</span>
                        {' / '}
                        <span style={{ color: r.ret_126d_pct >= 0 ? '#34D399' : '#F87171' }}>{r.ret_126d_pct >= 0 ? '+' : ''}{r.ret_126d_pct}%</span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700, color: r.tsmom_z >= 0 ? '#38BDF8' : '#FCA5A5' }}>
                        {r.tsmom_z >= 0 ? '+' : ''}{r.tsmom_z}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.73rem' }}>
                        <span style={{ color: (r.er40_pct || 0) >= 25 ? '#34D399' : '#94A3B8', fontWeight: 700 }}>
                          ER {r.er40_pct ?? '—'}%
                        </span>
                        <div style={{ fontSize: '0.68rem', color: '#CBD5E1' }}>
                          em {r.er_multiplier ?? '1.0'}x / DXY {r.dxy_multiplier ?? '1.0'}x
                        </div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.73rem' }}>
                        <span style={{ color: r.above_ma20 ? '#34D399' : '#64748B' }}>20MA{r.above_ma20 ? '▲' : '▼'}</span>{' '}
                        <span style={{ color: r.above_ma60 ? '#34D399' : '#64748B' }}>60MA{r.above_ma60 ? '▲' : '▼'}</span>{' '}
                        <span style={{ color: r.above_ma200 ? '#FBBF24' : '#64748B', fontWeight: r.above_ma200 ? 700 : 400 }}>200MA{r.above_ma200 ? '▲' : '▼'}</span>
                      </td>
                      <td style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>{r.natr_20_pct}%</td>
                      <td style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#CBD5E1' }}>
                        標準 <strong style={{ color: '#FDE68A' }}>{r.std_symbol}</strong> (${r.std_notional_usd?.toLocaleString()})
                        <br />
                        微型 <strong style={{ color: '#38BDF8' }}>{r.micro_symbol}</strong> (${r.micro_notional_usd?.toLocaleString()}) / ETF: {r.etf_proxy}
                      </td>
                      <td style={{ fontSize: '0.71rem', color: '#94A3B8' }}>{r.roll_months}</td>
                      <td style={{ fontSize: '0.75rem', fontWeight: 700, color: r.signal_dir === 'LONG' ? '#34D399' : r.signal_dir === 'SHORT' ? '#FCA5A5' : '#94A3B8' }}>
                        {r.signal_status}
                        {r.event_signal_badge && (
                          <div style={{ fontSize: '0.68rem', color: '#FBBF24', fontWeight: 600, marginTop: '2px' }}>
                            {r.event_signal_badge} (量比 {r.vol_ratio_5d ?? 1.0}x / CLV {r.clv_5d_pct ?? 50}%)
                          </div>
                        )}
                      </td>
                      <td>
                        <StockChartButton ticker={r.ticker} name={r.name_zh} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= 子分頁 3: 22年五階消融實證、Crisis Alpha 與交易明細 ================= */}
      {activeSubTab === 'backtest' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* 對數淨值走勢圖 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#FDE68A' }}>
                📈 2005–2026 (21.85年) 全球原物料泰坦 CTA 旗艦 vs 各階層基準對數累積淨值曲線
              </h3>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.76rem', fontWeight: 700, flexWrap: 'wrap' }}>
                <span style={{ color: '#F59E0B' }}>━━ 🏆 旗艦 V5.0 CTA ({fs.total_multiple ?? 66.76}x)</span>
                <span style={{ color: '#F472B6' }}>┄┄ Clean V4.1 基準 ({v41.total_multiple ?? 43.93}x)</span>
                <span style={{ color: '#A78BFA' }}>━━ Tier 3: Carry + 1/ATR</span>
                <span style={{ color: '#38BDF8' }}>━━ 標普 500 SPY</span>
                <span style={{ color: '#94A3B8' }}>┅┅ 被動原物料長抱</span>
              </div>
            </div>
            {renderEquitySvg()}
          </div>

          {/* 5 階消融對決總表 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '1.05rem', color: '#FDE68A' }}>
              🔬 2005–2026 原物料期貨策略五階消融實證總表 (含 6 bps 期貨滑價與轉倉價差還原)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="stock-table" style={{ width: '100%', fontSize: '0.81rem' }}>
                <thead>
                  <tr>
                    <th>段位</th>
                    <th>策略架構名稱</th>
                    <th>年化報酬 (CAGR)</th>
                    <th>22年累積倍數</th>
                    <th>月度 MDD</th>
                    <th>日度 MDD</th>
                    <th>Sharpe</th>
                    <th>Sortino</th>
                    <th>Calmar</th>
                    <th>G1 (05–15)</th>
                    <th>G2 (16–26)</th>
                    <th>勝年比例</th>
                    <th>核心物理機制診斷</th>
                  </tr>
                </thead>
                <tbody>
                  {ablationTiers.map((t, idx) => {
                    const isFlagship = t.tier === 'Tier S++' || t.tier === 'Tier S+';
                    return (
                      <tr key={idx} style={{ background: isFlagship ? 'rgba(245, 158, 11, 0.14)' : 'transparent' }}>
                        <td style={{ fontWeight: 800, color: isFlagship ? '#FBBF24' : '#38BDF8' }}>{t.tier}</td>
                        <td style={{ fontWeight: isFlagship ? 900 : 700, color: isFlagship ? '#FEF3C7' : '#F8FAFC' }}>{t.name}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#34D399' }}>+{t.cagr_pct}%</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#FDE68A' }}>{t.total_multiple}x</td>
                        <td style={{ fontFamily: 'monospace', color: '#FCA5A5' }}>{t.mdd_monthly_pct}%</td>
                        <td style={{ fontFamily: 'monospace', color: '#94A3B8' }}>{t.mdd_daily_pct}%</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: '#38BDF8' }}>{t.sharpe}</td>
                        <td style={{ fontFamily: 'monospace', color: '#A78BFA' }}>{t.sortino}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#FBBF24' }}>{t.calmar}</td>
                        <td style={{ fontFamily: 'monospace', color: '#34D399' }}>+{t.g1_cagr_pct}%</td>
                        <td style={{ fontFamily: 'monospace', color: '#34D399' }}>+{t.g2_cagr_pct}%</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{t.win_years}</td>
                        <td style={{ fontSize: '0.74rem', color: '#CBD5E1', maxWidth: '300px' }}>{t.desc}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Panel A: 逐筆單筆勝率與雙階鎖利解剖看板 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(52, 211, 153, 0.4)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#34D399' }}>
                🎯 逐筆單筆勝率與「M4 雙階 ATR 鎖利（收割 38% × 保留 62% 尾倉奔馳）」解剖看板
              </h3>
              <span style={{ fontSize: '0.76rem', color: '#CBD5E1' }}>
                從 Clean V4.1 <strong>{twStats.v41_win_rate_clean_pct ?? 46.52}%</strong>（{twStats.v41_total_trades ?? 933} 筆）
                大幅躍升至 V5.0 <strong style={{ color: '#34D399' }}>{twStats.win_rate_clean_pct ?? 52.14}%</strong>（{twStats.total_trades ?? 817} 筆｜原始未鎖利 {twStats.win_rate_raw_pct ?? 50.8}%）
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.7rem', marginBottom: '0.95rem' }}>
              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.65rem 0.85rem', borderRadius: '9px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>總平倉勝率 (Clean / Raw)</div>
                <div style={{ fontSize: '1.22rem', fontWeight: 900, color: '#34D399', fontFamily: 'monospace' }}>
                  {twStats.win_rate_clean_pct ?? 52.14}% <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>({twStats.win_trades ?? 426}勝/{twStats.loss_trades ?? 391}負)</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#CBD5E1' }}>Raw {twStats.win_rate_raw_pct ?? 50.8}% ｜ V4.1 {twStats.v41_win_rate_clean_pct ?? 46.52}%</div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.65rem 0.85rem', borderRadius: '9px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>做多 / 做空 分項勝率</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38BDF8', fontFamily: 'monospace' }}>
                  多 {twStats.long_win_rate_pct ?? '—'}% ｜ 空 {twStats.short_win_rate_pct ?? '—'}%
                </div>
                <div style={{ fontSize: '0.7rem', color: '#CBD5E1' }}>多 {twStats.long_trades ?? '—'} 筆 ｜ 空 {twStats.short_trades ?? '—'} 筆</div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.65rem 0.85rem', borderRadius: '9px', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>M4 雙階鎖利觸發佔比</div>
                <div style={{ fontSize: '1.22rem', fontWeight: 900, color: '#FBBF24', fontFamily: 'monospace' }}>
                  {twStats.scaled_out_rate_pct ?? 41.2}% <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>({twStats.scaled_out_trades ?? 337} 筆)</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#CBD5E1' }}>達 max(1.8×NATR, 3.5%) 先落袋 38%</div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.65rem 0.85rem', borderRadius: '9px', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>獲利因子 / 賺賠比 / 期望值</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#C4B5FD', fontFamily: 'monospace' }}>
                  PF {twStats.profit_factor ?? 1.84} <span style={{ fontSize: '0.8rem', color: '#34D399' }}>(賠率 {twStats.payoff_ratio ?? '—'}x)</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#CBD5E1' }}>
                  均賺 +{twStats.avg_win_pct ?? '—'}% / 均虧 {twStats.avg_loss_pct ?? '—'}% ｜ EV +{twStats.expectancy_per_trade_pct ?? '—'}%
                </div>
              </div>
            </div>

            {Array.isArray(twStats.per_commodity_stats) && twStats.per_commodity_stats.length > 0 && (
              <div style={{ overflowX: 'auto', maxHeight: '280px' }}>
                <table className="stock-table" style={{ width: '100%', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th>商品 (代碼)</th>
                      <th>板塊</th>
                      <th>歷史成交筆數</th>
                      <th>單筆勝率 (含雙階鎖利)</th>
                      <th>雙階鎖利觸發率</th>
                      <th>單筆平均報酬</th>
                      <th>22年累計單筆報酬貢獻</th>
                    </tr>
                  </thead>
                  <tbody>
                    {twStats.per_commodity_stats.map((cs) => (
                      <tr key={cs.ticker}>
                        <td style={{ fontWeight: 700, color: '#FDE68A' }}>{cs.name_zh} ({cs.ticker})</td>
                        <td style={{ color: '#94A3B8' }}>{cs.sector}</td>
                        <td style={{ fontFamily: 'monospace' }}>{cs.count} 筆</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: cs.win_rate_pct >= 50 ? '#34D399' : '#FCA5A5' }}>
                          {cs.win_rate_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: '#FBBF24' }}>{cs.scaled_out_pct}%</td>
                        <td style={{ fontFamily: 'monospace', color: cs.avg_return_pct >= 0 ? '#34D399' : '#F87171' }}>
                          {cs.avg_return_pct >= 0 ? '+' : ''}{cs.avg_return_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: cs.sum_return_pct >= 0 ? '#38BDF8' : '#F87171' }}>
                          {cs.sum_return_pct >= 0 ? '+' : ''}{cs.sum_return_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Panel B: 八重防過度擬合嚴刑拷打審計報告 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(167, 139, 250, 0.45)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#C4B5FD' }}>
                🧬 八重防過度擬合嚴刑拷打審計報告（8-Gate Anti-Overfitting Torture Suite: {aoAudit.all_8_gates_passed ? '8/8 ALL PASS ✅' : 'AUDITING'}）
              </h3>
              <span style={{ fontSize: '0.75rem', color: '#34D399', fontWeight: 700 }}>
                新增正交因子最高相關 |ρ| = {aoAudit.new_factors_max_abs_corr ?? 0.1303} (&lt;0.30) ｜ 未來投毒差分 {aoAudit.future_poisoning_max_diff ?? 0.0}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '0.95rem', fontSize: '0.78rem' }}>
              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.7rem 0.9rem', borderRadius: '9px', border: '1px solid rgba(167, 139, 250, 0.35)' }}>
                <div style={{ color: '#A78BFA', fontWeight: 800, marginBottom: '0.25rem' }}>Gate 3: 3D ±20% 參數高原 (27 網格)</div>
                <div>CAGR 全勝 V4.1：<strong>{aoAudit.grid_beat_v41_cagr ?? 27}/{aoAudit.grid_total_cells ?? 27}</strong> ({aoAudit.grid_cagr_range || '—'})</div>
                <div>Sharpe / WR / mMDD 全勝：<strong>{aoAudit.grid_beat_v41_sharpe ?? 27}/27 ｜ {aoAudit.grid_beat_v41_wr ?? 27}/27 ｜ {aoAudit.grid_beat_v41_mdd ?? 27}/27</strong></div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.7rem 0.9rem', borderRadius: '9px', border: '1px solid rgba(52, 211, 153, 0.35)' }}>
                <div style={{ color: '#34D399', fontWeight: 800, marginBottom: '0.25rem' }}>Gate 4: 刀切剔除前三大獲利合約</div>
                <div>剔除：<strong>{(aoAudit.jackknife_excluded_top3 || ['HG=F', 'HO=F', 'RB=F']).join(', ')}</strong></div>
                <div>V5.0 剩餘 16 檔：<strong style={{ color: '#34D399' }}>+{aoAudit.jackknife_v5_cagr_pct ?? 16.61}%</strong> (勝率 {aoAudit.jackknife_v5_wr_pct ?? 50.56}%) vs V4.1 +{aoAudit.jackknife_v41_cagr_pct ?? 16.21}%</div>
              </div>

              <div style={{ background: 'rgba(30, 41, 59, 0.72)', padding: '0.7rem 0.9rem', borderRadius: '9px', border: '1px solid rgba(56, 189, 248, 0.35)' }}>
                <div style={{ color: '#38BDF8', fontWeight: 800, marginBottom: '0.25rem' }}>Gate 5 &amp; 7: 雙紀元與雙倍嚴酷成本</div>
                <div>Ex-2026：<strong style={{ color: '#34D399' }}>+{aoAudit.ex_2026_cagr_pct ?? 21.38}%</strong> (V4.1 +{aoAudit.v41_ex_2026_cagr_pct ?? 18.81}%)</div>
                <div>雙倍滑價 12bps：<strong style={{ color: '#38BDF8' }}>+{aoAudit.harsh_12bps_cagr_pct ?? 18.83}%</strong> (V4.1 +{aoAudit.v41_harsh_12bps_cagr_pct ?? 16.65}%)</div>
              </div>
            </div>

            {Array.isArray(aoAudit.loo_ablation) && aoAudit.loo_ablation.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="stock-table" style={{ width: '100%', fontSize: '0.76rem' }}>
                  <thead>
                    <tr>
                      <th>M1–M5 單模組剝離測試 (LOO Ablation)</th>
                      <th>全樣本 CAGR</th>
                      <th>Ex-2026 CAGR</th>
                      <th>月度 MDD</th>
                      <th>Sharpe</th>
                      <th>Calmar</th>
                      <th>單筆勝率 (Clean)</th>
                      <th>獲利因子 PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aoAudit.loo_ablation.map((row, rIdx) => {
                      const isV5 = row.label?.includes('V5.0');
                      return (
                        <tr key={rIdx} style={{ background: isV5 ? 'rgba(245, 158, 11, 0.14)' : 'transparent' }}>
                          <td style={{ fontWeight: isV5 ? 800 : 600, color: isV5 ? '#FBBF24' : '#E2E8F0' }}>{row.label}</td>
                          <td style={{ fontFamily: 'monospace', color: '#34D399', fontWeight: 700 }}>+{row.cagr_pct}%</td>
                          <td style={{ fontFamily: 'monospace', color: '#38BDF8' }}>+{row.ex_2026_cagr_pct}%</td>
                          <td style={{ fontFamily: 'monospace', color: '#FCA5A5' }}>{row.mdd_monthly_pct}%</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{row.sharpe}</td>
                          <td style={{ fontFamily: 'monospace' }}>{row.calmar}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#34D399' }}>{row.win_rate_clean_pct}%</td>
                          <td style={{ fontFamily: 'monospace' }}>{row.profit_factor}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Crisis Alpha 六大歷史危機與通膨實證 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '1.05rem', color: '#34D399' }}>
              🛡️ 六大歷史股災與通膨風暴期之 Crisis Alpha 對決（旗艦 CTA vs 被動原物料 vs 標普 500）
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.8rem' }}>
              {crisisList.map((c) => (
                <div key={c.year} style={{
                  background: 'rgba(30, 41, 59, 0.75)',
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  borderRadius: '10px',
                  padding: '0.85rem 1rem'
                }}>
                  <div style={{ fontWeight: 800, color: '#FDE68A', fontSize: '0.88rem', marginBottom: '0.35rem' }}>{c.period}</div>
                  <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.76rem', color: '#CBD5E1', lineHeight: 1.45 }}>{c.desc}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: '0.8rem', borderTop: '1px solid rgba(148,163,184,0.18)', paddingTop: '0.45rem' }}>
                    <span>🏆 旗艦CTA: <strong style={{ color: c.cta_pct >= 0 ? '#34D399' : '#F87171' }}>{c.cta_pct >= 0 ? '+' : ''}{c.cta_pct}%</strong></span>
                    <span>被動原物料: <strong style={{ color: c.passive_pct >= 0 ? '#94A3B8' : '#F87171' }}>{c.passive_pct >= 0 ? '+' : ''}{c.passive_pct}%</strong></span>
                    <span>SPY: <strong style={{ color: c.spy_pct >= 0 ? '#38BDF8' : '#F87171' }}>{c.spy_pct >= 0 ? '+' : ''}{c.spy_pct}%</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2005–2026 歷年報酬對照表 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '1.05rem', color: '#FDE68A' }}>
              📅 2005–2026 逐年績效全紀錄 (20 / 22 年正報酬，勝率 90.9%)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="stock-table" style={{ width: '100%', fontSize: '0.79rem' }}>
                <thead>
                  <tr>
                    <th>年份</th>
                    <th>🏆 全球原物料泰坦 CTA</th>
                    <th>Tier 3: Carry + 1/ATR</th>
                    <th>Tier 2: 純 1/ATR 動能</th>
                    <th>Tier 0: 被動原物料長抱</th>
                    <th>標普 500 (SPY)</th>
                    <th>CTA 超額報酬 (vs 被動原物料)</th>
                  </tr>
                </thead>
                <tbody>
                  {annualList.map((yr) => {
                    const alphaVsPass = +(yr.cta_titan_pct - yr.passive_comm_pct).toFixed(2);
                    return (
                      <tr key={yr.year}>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#FDE68A' }}>{yr.year}</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: yr.cta_titan_pct >= 0 ? '#34D399' : '#F87171' }}>
                          {yr.cta_titan_pct >= 0 ? '+' : ''}{yr.cta_titan_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: yr.carry_atr_pct >= 0 ? '#A7F3D0' : '#FCA5A5' }}>
                          {yr.carry_atr_pct >= 0 ? '+' : ''}{yr.carry_atr_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: yr.vol_parity_pct >= 0 ? '#CBD5E1' : '#FCA5A5' }}>
                          {yr.vol_parity_pct >= 0 ? '+' : ''}{yr.vol_parity_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: yr.passive_comm_pct >= 0 ? '#94A3B8' : '#F87171' }}>
                          {yr.passive_comm_pct >= 0 ? '+' : ''}{yr.passive_comm_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: yr.spy_pct >= 0 ? '#38BDF8' : '#F87171' }}>
                          {yr.spy_pct >= 0 ? '+' : ''}{yr.spy_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700, color: alphaVsPass >= 0 ? '#FBBF24' : '#94A3B8' }}>
                          {alphaVsPass >= 0 ? '+' : ''}{alphaVsPass}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 近期與全歷史逐筆波段交易明細 (含現貨價差、轉倉收益拆解與雙階鎖利紀錄) */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.85rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#FDE68A' }}>
                📜 全球原物料泰坦 CTA V5.0 逐筆交易帳本（顯示 {showAllTrades ? filteredTrades.length : Math.min(filteredTrades.length, 60)} / 篩選 {filteredTrades.length} 筆，總計 {recentTrades.length} 筆）
              </h3>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { id: 'ALL', label: '全部方向' },
                  { id: 'LONG', label: '做多' },
                  { id: 'SHORT', label: '做空' },
                  { id: 'WIN', label: '僅看獲利' },
                  { id: 'LOSS', label: '僅看虧損' },
                  { id: 'SCALED', label: '僅看雙階鎖利' }
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTradeDirFilter(opt.id)}
                    style={{
                      padding: '0.26rem 0.58rem',
                      borderRadius: '6px',
                      border: tradeDirFilter === opt.id ? '1px solid #F59E0B' : '1px solid rgba(148,163,184,0.3)',
                      background: tradeDirFilter === opt.id ? 'rgba(245, 158, 11, 0.22)' : 'rgba(30, 41, 59, 0.7)',
                      color: tradeDirFilter === opt.id ? '#FDE68A' : '#CBD5E1',
                      fontSize: '0.73rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <select
                  value={tradeTickerFilter}
                  onChange={(e) => setTradeTickerFilter(e.target.value)}
                  style={{
                    background: 'rgba(30, 41, 59, 0.9)',
                    color: '#F8FAFC',
                    border: '1px solid rgba(148,163,184,0.35)',
                    borderRadius: '6px',
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.74rem'
                  }}
                >
                  <option value="ALL">全部 19 項商品</option>
                  {radarList.map((r) => (
                    <option key={r.ticker} value={r.ticker}>{r.name_zh} ({r.ticker})</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAllTrades((v) => !v)}
                  style={{
                    padding: '0.26rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(56, 189, 248, 0.45)',
                    background: showAllTrades ? 'rgba(56, 189, 248, 0.2)' : 'rgba(15, 23, 42, 0.8)',
                    color: '#38BDF8',
                    fontSize: '0.73rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {showAllTrades ? '收合為前 60 筆' : `展開全部 ${filteredTrades.length} 筆`}
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '480px' }}>
              <table className="stock-table" style={{ width: '100%', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>板塊</th>
                    <th>方向</th>
                    <th>進場日期</th>
                    <th>進場價</th>
                    <th>出場日期</th>
                    <th>出場價</th>
                    <th>持有天數</th>
                    <th>現貨價差報酬</th>
                    <th>轉倉收益貢獻 (Roll Yield)</th>
                    <th>總報酬率 (含雙階鎖利)</th>
                    <th>出場與鎖利狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllTrades ? filteredTrades : filteredTrades.slice(0, 60)).map((t, idx) => {
                    const isWin = (t.return_pct || 0) >= 0;
                    return (
                      <tr key={`${t.ticker}-${t.entry_date}-${idx}`}>
                        <td style={{ fontWeight: 700, color: '#FDE68A' }}>{t.name_zh} ({t.ticker})</td>
                        <td style={{ color: '#94A3B8', fontSize: '0.73rem' }}>{t.sector}</td>
                        <td style={{ color: t.direction?.includes('做多') ? '#34D399' : '#FCA5A5', fontWeight: 700 }}>{t.direction}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.entry_date}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.entry_price}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.exit_date}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.exit_price}</td>
                        <td style={{ fontFamily: 'monospace' }}>{t.holding_days}天</td>
                        <td style={{ fontFamily: 'monospace', color: t.spot_return_pct >= 0 ? '#34D399' : '#F87171' }}>
                          {t.spot_return_pct >= 0 ? '+' : ''}{t.spot_return_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', color: t.roll_yield_contrib_pct >= 0 ? '#38BDF8' : '#FCA5A5' }}>
                          {t.roll_yield_contrib_pct >= 0 ? '+' : ''}{t.roll_yield_contrib_pct}%
                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, color: isWin ? '#34D399' : '#F87171' }}>
                          {isWin ? '+' : ''}{t.return_pct}%
                          {t.scaled_out && t.raw_total_return_pct !== undefined && (
                            <div style={{ fontSize: '0.67rem', color: '#94A3B8', fontWeight: 400 }}>
                              未鎖利原值 {t.raw_total_return_pct >= 0 ? '+' : ''}{t.raw_total_return_pct}%
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.73rem', color: '#CBD5E1' }}>
                          {t.scaled_out && (
                            <span style={{
                              display: 'inline-block',
                              marginRight: '0.35rem',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              background: 'rgba(16, 185, 129, 0.2)',
                              color: '#34D399',
                              border: '1px solid rgba(16, 185, 129, 0.45)',
                              fontWeight: 800,
                              fontSize: '0.68rem'
                            }}>
                              🎯 雙階鎖利 38% ({t.scale_date})
                            </span>
                          )}
                          {t.exit_reason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= 子分頁 4: 我的海期/ETF 實戰跟單帳本 ================= */}
      {activeSubTab === 'ledger' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* 手動新增海期/ETF 部位表單 */}
          <form onSubmit={handleManualAddTrade} style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: '12px',
            padding: '1rem 1.25rem'
          }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', color: '#38BDF8' }}>
              ➕ 新增原物料海期 / 微型期貨 / ETF 實戰部位（直接寫入 tw_stock.db `commodity_cta_user_trades`）
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.65rem', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>選擇商品</label>
                <select
                  value={newTradeForm.ticker}
                  onChange={e => {
                    const tk = e.target.value;
                    const r = radarMap[tk];
                    if (r) {
                      setNewTradeForm(prev => ({
                        ...prev,
                        ticker: tk,
                        name_zh: r.name_zh,
                        sector: r.sector,
                        symbol_used: r.micro_symbol,
                        multiplier: String(r.micro_multiplier || 100),
                        entry_price: String(r.front_price || '')
                      }));
                    }
                  }}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#F8FAFC', border: '1px solid rgba(148,163,184,0.3)' }}
                >
                  {radarList.map(r => (
                    <option key={r.ticker} value={r.ticker}>{r.name_zh} ({r.ticker})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>多空方向</label>
                <select
                  value={newTradeForm.direction}
                  onChange={e => setNewTradeForm(prev => ({ ...prev, direction: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#F8FAFC', border: '1px solid rgba(148,163,184,0.3)' }}
                >
                  <option value="做多 (Long)">做多 (Long)</option>
                  <option value="做空 (Short)">做空 (Short)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>交易代碼 (如 MCL/MGC)</label>
                <input
                  type="text"
                  value={newTradeForm.symbol_used}
                  onChange={e => setNewTradeForm(prev => ({ ...prev, symbol_used: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#FDE68A', border: '1px solid rgba(148,163,184,0.3)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>口數 / 股數</label>
                <input
                  type="number"
                  step="any"
                  value={newTradeForm.contracts}
                  onChange={e => setNewTradeForm(prev => ({ ...prev, contracts: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#F8FAFC', border: '1px solid rgba(148,163,184,0.3)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>每點乘數 (Multiplier)</label>
                <input
                  type="number"
                  step="any"
                  value={newTradeForm.multiplier}
                  onChange={e => setNewTradeForm(prev => ({ ...prev, multiplier: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#F8FAFC', border: '1px solid rgba(148,163,184,0.3)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#94A3B8', display: 'block', marginBottom: '3px' }}>進場價格</label>
                <input
                  type="number"
                  step="any"
                  value={newTradeForm.entry_price}
                  onChange={e => setNewTradeForm(prev => ({ ...prev, entry_price: e.target.value }))}
                  style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', background: '#0F172A', color: '#F8FAFC', border: '1px solid rgba(148,163,184,0.3)' }}
                />
              </div>
              <button
                type="submit"
                style={{
                  padding: '0.45rem 0.9rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #38BDF8, #0284C7)',
                  color: '#0F172A',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                💾 寫入 tw_stock.db
              </button>
            </div>
          </form>

          {/* 已登錄部位清單 */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(148, 163, 184, 0.25)',
            borderRadius: '12px',
            padding: '1.1rem 1.25rem'
          }}>
            <h3 style={{ margin: '0 0 0.8rem 0', fontSize: '1.05rem', color: '#FDE68A' }}>
              💼 我的原物料期貨 CTA 實戰部位與歷史結算帳本
            </h3>
            {userTrades.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94A3B8', fontSize: '0.88rem' }}>
                目前尚無自訂實盤部位，您可從「🎯 官方當期正選部位」點擊「⚡ 記帳跟單」一鍵帶入，或由上方表單新增。
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="stock-table" style={{ width: '100%', fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>狀態</th>
                      <th>商品 (執行代碼)</th>
                      <th>方向</th>
                      <th>口數 × 乘數</th>
                      <th>進場日期 / 價格</th>
                      <th>最新價 / 平倉價</th>
                      <th>損益點數 / 報酬率</th>
                      <th>預估美元損益 (USD)</th>
                      <th>備註 / 操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userTrades.map(ut => {
                      const isOpen = ut.status === 'OPEN';
                      const livePx = radarMap[ut.ticker]?.front_price || ut.entry_price;
                      const refPx = isOpen ? livePx : (ut.exit_price || ut.entry_price);
                      const dSign = ut.direction?.includes('做多') ? 1 : -1;
                      const ptDiff = (refPx - ut.entry_price) * dSign;
                      const retPct = ut.entry_price > 0 ? (ptDiff / ut.entry_price) * 100.0 : 0.0;
                      const pnlUsd = ptDiff * (ut.contracts || 1) * (ut.multiplier || 1);

                      return (
                        <tr key={ut.trade_id}>
                          <td>
                            <span style={{
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              background: isOpen ? 'rgba(56, 189, 248, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                              color: isOpen ? '#38BDF8' : '#94A3B8'
                            }}>
                              {isOpen ? '持倉中 OPEN' : '已平倉 CLOSED'}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#FDE68A' }}>
                            {ut.name_zh} <code style={{ color: '#38BDF8' }}>({ut.symbol_used})</code>
                          </td>
                          <td style={{ color: dSign > 0 ? '#34D399' : '#FCA5A5', fontWeight: 700 }}>{ut.direction}</td>
                          <td style={{ fontFamily: 'monospace' }}>{ut.contracts} 口 × {ut.multiplier}</td>
                          <td style={{ fontFamily: 'monospace' }}>{ut.entry_date} @ {ut.entry_price}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{refPx}</td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 700, color: retPct >= 0 ? '#34D399' : '#F87171' }}>
                            {retPct >= 0 ? '+' : ''}{retPct.toFixed(2)}%
                          </td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 800, color: pnlUsd >= 0 ? '#34D399' : '#F87171' }}>
                            {pnlUsd >= 0 ? '+' : ''}${Math.round(pnlUsd).toLocaleString()}
                          </td>
                          <td>
                            {isOpen ? (
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder={String(livePx)}
                                  value={closeInputs[ut.trade_id]?.exit_price ?? ''}
                                  onChange={e => setCloseInputs(prev => ({
                                    ...prev,
                                    [ut.trade_id]: { ...(prev[ut.trade_id] || {}), exit_price: e.target.value }
                                  }))}
                                  style={{ width: '75px', padding: '0.22rem', borderRadius: '4px', background: '#0F172A', color: '#FDE68A', border: '1px solid rgba(148,163,184,0.3)', fontSize: '0.75rem' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCloseTrade(ut.trade_id, livePx)}
                                  style={{ padding: '0.22rem 0.5rem', borderRadius: '4px', background: '#F59E0B', color: '#0F172A', border: 'none', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}
                                >
                                  平倉
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTrade(ut.trade_id)}
                                  style={{ padding: '0.22rem 0.45rem', borderRadius: '4px', background: 'rgba(239,68,68,0.2)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.4)', fontSize: '0.72rem', cursor: 'pointer' }}
                                >
                                  刪除
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.73rem', color: '#94A3B8' }}>
                                <span>{ut.exit_reason || ut.notes}</span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTrade(ut.trade_id)}
                                  style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(239,68,68,0.15)', color: '#FCA5A5', border: 'none', fontSize: '0.7rem', cursor: 'pointer' }}
                                >
                                  🗑️
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
