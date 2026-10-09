import React, { useState, useEffect } from 'react';
import { apiGetTitanLiveState, apiRecordTitanBuy, apiRecordTitanSell, apiUpdateTitanCash } from '../api';
import titanOpenPositionsData from '../data/titan_open_positions.json';

export default function TitanLiveDashboard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [actionTab, setActionTab] = useState('buy'); // 'buy', 'cash', 'signal'
  const [notice, setNotice] = useState({ type: '', msg: '' });

  // 買進表單
  const [buyForm, setBuyForm] = useState({
    stock_id: '',
    price: '',
    shares: '1000',
    role: '👑 王者泰坦 (70%)'
  });

  // 賣出彈窗
  const [sellModal, setSellModal] = useState({
    open: false,
    stock_id: '',
    stock_name: '',
    shares: 0,
    price: '',
    reason: '平倉賣出'
  });

  // 現金調整表單
  const [cashForm, setCashForm] = useState({
    mode: 'set', // 'set', 'deposit', 'withdraw'
    amount: ''
  });

  const fetchData = async () => {
    try {
      const res = await apiGetTitanLiveState();
      if (res && res.status === 'ok') {
        setData(res);
      }
    } catch (e) {
      console.error('Fetch titan live error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showMsg = (type, msg) => {
    setNotice({ type, msg });
    setTimeout(() => setNotice({ type: '', msg: '' }), 5000);
  };

  // 處理買進
  const handleBuySubmit = async (e) => {
    e.preventDefault();
    if (!buyForm.stock_id || !buyForm.price || !buyForm.shares) {
      showMsg('error', '請填寫完整的股票代號、成交價與股數');
      return;
    }
    try {
      await apiRecordTitanBuy({
        stock_id: buyForm.stock_id.trim(),
        price: parseFloat(buyForm.price),
        shares: parseInt(buyForm.shares, 10),
        role: buyForm.role
      });
      showMsg('success', `成功買進登記 ${buyForm.stock_id}！`);
      setBuyForm({ stock_id: '', price: '', shares: '1000', role: '🚀 革命衛星 (15%)' });
      fetchData();
    } catch (err) {
      showMsg('error', err.message || '買進失敗');
    }
  };

  // 處理賣出
  const handleSellSubmit = async (e) => {
    e.preventDefault();
    if (!sellModal.price) {
      showMsg('error', '請輸入成交賣價');
      return;
    }
    try {
      await apiRecordTitanSell({
        stock_id: sellModal.stock_id,
        price: parseFloat(sellModal.price),
        shares: parseInt(sellModal.shares, 10),
        reason: sellModal.reason
      });
      showMsg('success', `成功平倉 ${sellModal.stock_name} (${sellModal.stock_id})！`);
      setSellModal({ open: false, stock_id: '', stock_name: '', shares: 0, price: '', reason: '' });
      fetchData();
    } catch (err) {
      showMsg('error', err.message || '平倉失敗');
    }
  };

  // 處理現金調整
  const handleCashSubmit = async (e) => {
    e.preventDefault();
    const val = parseFloat(cashForm.amount);
    if (isNaN(val) || val <= 0) {
      showMsg('error', '請輸入大於 0 的有效金額');
      return;
    }
    try {
      const payload = {};
      if (cashForm.mode === 'set') payload.set_amount = val;
      else if (cashForm.mode === 'deposit') payload.deposit = val;
      else if (cashForm.mode === 'withdraw') payload.withdraw = val;

      await apiUpdateTitanCash(payload);
      showMsg('success', '現金水位更新成功！');
      setCashForm({ mode: 'set', amount: '' });
      fetchData();
    } catch (err) {
      showMsg('error', err.message || '現金更新失敗');
    }
  };

  if (loading && !data) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#93C5FD' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
        載入泰坦實盤監控數據中...
      </div>
    );
  }

  const acc = data?.account || {
    initial_capital: 1000000,
    current_cash: 1000000,
    total_equity: 1000000,
    cum_return_pct: 0,
    drawdown_pct: 0,
    exposure_pct: 0,
    cash_reserve_pct: 100,
    realized_trades: 0,
    win_rate: 0,
    profit_factor: 0
  };
  const taiex = data?.taiex || { close: 49806, ma20: 47577, ma60: 45650, bullish: true };
  const positions = data?.positions || [];
  const trades = data?.trades || [];

  return (
    <div className="titan-live-container" style={{ padding: '0.5rem 0' }}>
      {/* 提示訊息 */}
      {notice.msg && (
        <div style={{
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          background: notice.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
          border: `1px solid ${notice.type === 'error' ? '#EF4444' : '#10B981'}`,
          color: notice.type === 'error' ? '#FCA5A5' : '#86EFAC',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <span>{notice.type === 'error' ? '⚠️' : '✓'}</span>
          <span>{notice.msg}</span>
        </div>
      )}

      {/* 1. 大盤宏觀雷達頂部狀態列 */}
      <div style={{
        background: taiex.bullish ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.15), rgba(30, 58, 138, 0.3))' : 'linear-gradient(90deg, rgba(239, 68, 68, 0.15), rgba(30, 58, 138, 0.3))',
        border: `1px solid ${taiex.bullish ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'}`,
        borderRadius: '12px',
        padding: '0.85rem 1.25rem',
        marginBottom: '1.25rem',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.3rem' }}>{taiex.bullish ? '🟢' : '🔴'}</span>
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#F8FAFC' }}>
              加權指數：{taiex.close.toLocaleString()} 點 ({taiex.date || '最新'})
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              月線 20MA: {taiex.ma20.toLocaleString()} 點 · 季線 60MA: {taiex.ma60.toLocaleString()} 點
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{
            fontSize: '0.8rem',
            padding: '0.25rem 0.75rem',
            borderRadius: '20px',
            background: taiex.bullish ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
            color: taiex.bullish ? '#6EE7B7' : '#FCA5A5',
            fontWeight: 700
          }}>
            {taiex.bullish ? '🛡️ 多頭架構（允許多方攻擊與持倉）' : '⚠️ 跌破防禦線（停止開立新倉）'}
          </span>
          <button 
            onClick={fetchData} 
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#93C5FD',
              padding: '0.3rem 0.65rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            🔄 重新整理
          </button>
        </div>
      </div>

      {/* 2. 核心資產與水位 KPI 數據看板 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* 總資產淨值 */}
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>💰 總資產淨值 (NAV)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#60A5FA', margin: '0.3rem 0' }}>
            ${acc.total_equity.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            初始本金: ${acc.initial_capital.toLocaleString()}
          </div>
        </div>

        {/* 累積報酬率與回撤 */}
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📈 實盤累積報酬率</div>
          <div style={{
            fontSize: '1.6rem',
            fontWeight: 800,
            color: acc.cum_return_pct >= 0 ? '#EF4444' : '#10B981',
            margin: '0.3rem 0'
          }}>
            {acc.cum_return_pct >= 0 ? '+' : ''}{acc.cum_return_pct.toFixed(2)}%
          </div>
          <div style={{ fontSize: '0.78rem', color: acc.drawdown_pct < -10 ? '#FCA5A5' : 'var(--text-muted)' }}>
            當前回撤 (MDD): {acc.drawdown_pct.toFixed(2)}%
          </div>
        </div>

        {/* 持股水位與現金儲備 */}
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📊 當前持股水位</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#FCD34D', margin: '0.3rem 0' }}>
            {acc.exposure_pct.toFixed(1)}%
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            現金: ${acc.current_cash.toLocaleString()} ({acc.cash_reserve_pct.toFixed(1)}%)
          </div>
        </div>

        {/* 實盤勝率與盈虧比 */}
        <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '12px', padding: '1rem' }}>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>🎯 實盤對帳勝率 / 盈虧比</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#A78BFA', margin: '0.3rem 0' }}>
            {acc.realized_trades > 0 ? `${acc.win_rate.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {acc.realized_trades > 0 ? `盈虧比: ${acc.profit_factor} · 結算 ${acc.realized_trades} 筆` : '尚無平倉結算紀錄'}
          </div>
        </div>
      </div>

      {/* 3. 在席持倉與停損防禦清單 */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        borderRadius: '12px',
        padding: '1.25rem',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#F8FAFC' }}>🛡️ 在席持倉與停損防禦監控清單</h3>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              嚴格執行：季線 60MA 趨勢防禦 · 衛星 +60% 移動停利 · +15% 保本平手鎖利
            </div>
          </div>
          <span style={{ fontSize: '0.85rem', color: '#93C5FD' }}>
            持倉數：<strong>{positions.length}</strong> / 3 檔
          </span>
        </div>

        {positions.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            目前帳戶無在席持倉，資金 100% 現金防禦待命中。可在下方表單輸入「買進成交」或點擊「選股訊號試算」開倉。
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: 'rgba(30, 58, 138, 0.25)', color: '#93C5FD' }}>
                  <th>代號</th>
                  <th>股票名稱</th>
                  <th>配置角色</th>
                  <th style={{ textAlign: 'right' }}>買進成本</th>
                  <th style={{ textAlign: 'right' }}>最新現價</th>
                  <th style={{ textAlign: 'right' }}>股數</th>
                  <th style={{ textAlign: 'right' }}>目前市值</th>
                  <th style={{ textAlign: 'right' }}>未實現損益</th>
                  <th style={{ textAlign: 'right' }}>報酬率</th>
                  <th style={{ textAlign: 'right' }}>佔比</th>
                  <th style={{ textAlign: 'right' }}>有效停損價</th>
                  <th style={{ textAlign: 'right' }}>距停損</th>
                  <th>防禦狀態 / 警報</th>
                  <th style={{ textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const isProfit = (p.unrealized_pnl || 0) >= 0;
                  const dist = p.dist_to_stop_pct || 0;
                  const isNearStop = dist <= 3.0 && dist >= 0;
                  const isBelowStop = dist < 0;

                  return (
                    <tr key={p.stock_id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td><strong>{p.stock_id}</strong></td>
                      <td><strong>{p.stock_name}</strong></td>
                      <td>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '12px',
                          background: p.role?.includes('王者') ? 'rgba(234, 179, 8, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: p.role?.includes('王者') ? '#FDE047' : '#93C5FD'
                        }}>
                          {p.role}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>${p.entry_price?.toFixed(1)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>${p.current_price?.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>{p.shares?.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>${p.market_value?.toLocaleString()}</td>
                      <td style={{ textAlign: 'right', color: isProfit ? '#EF4444' : '#10B981', fontWeight: 700 }}>
                        {isProfit ? '+' : ''}{p.unrealized_pnl?.toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right', color: isProfit ? '#EF4444' : '#10B981', fontWeight: 700 }}>
                        {isProfit ? '+' : ''}{p.unrealized_ret_pct?.toFixed(2)}%
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.weight_pct?.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', color: '#FCD34D' }}>
                        ${p.stop_loss_price?.toFixed(1)}
                      </td>
                      <td style={{ textAlign: 'right', color: isBelowStop ? '#EF4444' : (isNearStop ? '#F59E0B' : '#10B981'), fontWeight: 700 }}>
                        {dist > 0 ? `+${dist.toFixed(1)}%` : `${dist.toFixed(1)}%`}
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.75rem',
                          color: isBelowStop ? '#FCA5A5' : (isNearStop ? '#FDE047' : '#93C5FD')
                        }}>
                          {p.alert || '正常運行'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={() => setSellModal({
                            open: true,
                            stock_id: p.stock_id,
                            stock_name: p.stock_name,
                            shares: p.shares,
                            price: p.current_price?.toString() || '',
                            reason: isBelowStop ? '跌破季線停損' : '平倉賣出'
                          })}
                          style={{
                            background: 'rgba(239, 68, 68, 0.2)',
                            border: '1px solid rgba(239, 68, 68, 0.5)',
                            color: '#FCA5A5',
                            padding: '0.25rem 0.65rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.78rem'
                          }}
                        >
                          平倉賣出
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

      {/* 4. 操作管理控制台 (買進登記 / 水位校準 / 訊號試算) */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        borderRadius: '12px',
        padding: '1.25rem',
        marginBottom: '1.5rem'
      }}>
        {/* 子分頁導覽 */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
          <button
            onClick={() => setActionTab('buy')}
            style={{
              background: actionTab === 'buy' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
              border: `1px solid ${actionTab === 'buy' ? '#3B82F6' : 'transparent'}`,
              color: actionTab === 'buy' ? '#93C5FD' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            ➕ 記錄買進成交
          </button>
          <button
            onClick={() => setActionTab('cash')}
            style={{
              background: actionTab === 'cash' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
              border: `1px solid ${actionTab === 'cash' ? '#3B82F6' : 'transparent'}`,
              color: actionTab === 'cash' ? '#93C5FD' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            💰 水位校準 / 出入金
          </button>
          <button
            onClick={() => setActionTab('signal')}
            style={{
              background: actionTab === 'signal' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
              border: `1px solid ${actionTab === 'signal' ? '#3B82F6' : 'transparent'}`,
              color: actionTab === 'signal' ? '#93C5FD' : 'var(--text-muted)',
              padding: '0.4rem 1rem',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            🎯 最新選股與下單張數試算
          </button>
        </div>

        {/* 表單內容：買進 */}
        {actionTab === 'buy' && (
          <form onSubmit={handleBuySubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>股票代號</label>
              <input
                type="text"
                placeholder="例如 2408"
                value={buyForm.stock_id}
                onChange={(e) => setBuyForm({ ...buyForm, stock_id: e.target.value })}
                className="input-field"
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>成交價格 (元)</label>
              <input
                type="number"
                step="any"
                placeholder="例如 550"
                value={buyForm.price}
                onChange={(e) => setBuyForm({ ...buyForm, price: e.target.value })}
                className="input-field"
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>成交股數 (股)</label>
              <input
                type="number"
                placeholder="1000"
                value={buyForm.shares}
                onChange={(e) => setBuyForm({ ...buyForm, shares: e.target.value })}
                className="input-field"
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>配置角色</label>
              <select
                value={buyForm.role}
                onChange={(e) => setBuyForm({ ...buyForm, role: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              >
                <option value="👑 王者泰坦 (70%)">👑 王者泰坦 (70%)</option>
                <option value="🚀 革命衛星 (15%)">🚀 革命衛星 (15%)</option>
              </select>
            </div>
            <div>
              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  border: 'none',
                  color: '#fff',
                  padding: '0.55rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 700
                }}
              >
                確認新增買進
              </button>
            </div>
          </form>
        )}

        {/* 表單內容：現金管理 */}
        {actionTab === 'cash' && (
          <form onSubmit={handleCashSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>操作模式</label>
              <select
                value={cashForm.mode}
                onChange={(e) => setCashForm({ ...cashForm, mode: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              >
                <option value="set">手動校準現金餘額 (Set Cash)</option>
                <option value="deposit">帳戶入金 (Deposit)</option>
                <option value="withdraw">帳戶出金 (Withdraw)</option>
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                {cashForm.mode === 'set' ? '最新真實可用現金金額 (元)' : '金額 (元)'}
              </label>
              <input
                type="number"
                placeholder="例如 350000"
                value={cashForm.amount}
                onChange={(e) => setCashForm({ ...cashForm, amount: e.target.value })}
                style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
              />
            </div>
            <div>
              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #10B981, #059669)',
                  border: 'none',
                  color: '#fff',
                  padding: '0.55rem 1.5rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 700
                }}
              >
                確認更新現金
              </button>
            </div>
          </form>
        )}

        {/* 表單內容：最新選股與下單試算 */}
        {actionTab === 'signal' && (
          <div>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.88rem', color: '#93C5FD' }}>
              依據您目前實盤總資產 <strong>${acc.total_equity.toLocaleString()} 元</strong> 試算之目標配置：
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'rgba(30, 58, 138, 0.25)', color: '#93C5FD' }}>
                    <th>候選代號</th>
                    <th>股票名稱</th>
                    <th>推薦角色</th>
                    <th style={{ textAlign: 'right' }}>參考價格</th>
                    <th style={{ textAlign: 'right' }}>目標配置金</th>
                    <th style={{ textAlign: 'right' }}>建議委託張數</th>
                    <th style={{ textAlign: 'right' }}>建議零股</th>
                    <th>進場與停損原則</th>
                  </tr>
                </thead>
                <tbody>
                  {(titanOpenPositionsData?.open_positions || []).map((cand) => {
                    const isLeader = cand.role?.includes('70%');
                    const targetPct = isLeader ? 70.0 : 15.0;
                    const targetAmt = acc.total_equity * (targetPct / 100.0);
                    const px = cand.current_price || cand.entry_price || 1;
                    const totShares = Math.floor(targetAmt / px);
                    const lots = Math.floor(totShares / 1000);
                    const odd = totShares % 1000;

                    return (
                      <tr key={cand.stock_id}>
                        <td><strong>{cand.stock_id}</strong></td>
                        <td><strong>{cand.stock_name}</strong></td>
                        <td>
                          <span style={{ color: isLeader ? '#FDE047' : '#93C5FD' }}>
                            {isLeader ? '👑 王者泰坦 (70%)' : '🚀 革命衛星 (15%)'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>${px.toFixed(1)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>${Math.round(targetAmt).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: '#FCD34D', fontWeight: 700 }}>{lots} 張</td>
                        <td style={{ textAlign: 'right', color: '#93C5FD' }}>{odd} 股</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          5MA 拉回進場 · 破 60MA (${cand.ma60_stop_price?.toFixed(1)}) 停損
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 5. 實盤交易歷史與對帳紀錄 */}
      <div style={{
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        borderRadius: '12px',
        padding: '1.25rem'
      }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', color: '#F8FAFC' }}>📊 實盤已實現交易歷史對帳表</h3>
        {trades.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>
            目前尚無交易歷史紀錄，買進與平倉後將自動登載於此處。
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'rgba(30, 58, 138, 0.25)', color: '#93C5FD' }}>
                  <th>成交日期</th>
                  <th>動作</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>角色</th>
                  <th style={{ textAlign: 'right' }}>成交價</th>
                  <th style={{ textAlign: 'right' }}>股數</th>
                  <th style={{ textAlign: 'right' }}>實現損益</th>
                  <th style={{ textAlign: 'right' }}>報酬率</th>
                  <th>出場原因 / 備註</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, idx) => (
                  <tr key={idx}>
                    <td>{t.date}</td>
                    <td>
                      <span style={{
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        background: t.action === 'BUY' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: t.action === 'BUY' ? '#93C5FD' : '#FCA5A5',
                        fontWeight: 700
                      }}>
                        {t.action === 'BUY' ? '買進' : '賣出'}
                      </span>
                    </td>
                    <td>{t.stock_id}</td>
                    <td>{t.stock_name}</td>
                    <td>{t.role}</td>
                    <td style={{ textAlign: 'right' }}>${t.price?.toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>{t.shares?.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: (t.realized_pnl || 0) >= 0 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
                      {t.action === 'SELL' ? `${(t.realized_pnl || 0) >= 0 ? '+' : ''}${t.realized_pnl?.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: (t.return_pct || 0) >= 0 ? '#EF4444' : '#10B981', fontWeight: 700 }}>
                      {t.action === 'SELL' ? `${(t.return_pct || 0) >= 0 ? '+' : ''}${t.return_pct?.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.exit_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 平倉彈窗 Modal */}
      {sellModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#1E293B',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '12px',
            padding: '1.5rem',
            width: '90%',
            maxWidth: '420px',
            color: '#F8FAFC'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#FCA5A5' }}>
              ⚠️ 平倉賣出：{sellModal.stock_name} ({sellModal.stock_id})
            </h3>
            <form onSubmit={handleSellSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  成交賣價 (元)
                </label>
                <input
                  type="number"
                  step="any"
                  value={sellModal.price}
                  onChange={(e) => setSellModal({ ...sellModal, price: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  平倉股數 (目前持有 {sellModal.shares} 股)
                </label>
                <input
                  type="number"
                  value={sellModal.shares}
                  onChange={(e) => setSellModal({ ...sellModal, shares: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
                />
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                  平倉出場原因
                </label>
                <input
                  type="text"
                  value={sellModal.reason}
                  onChange={(e) => setSellModal({ ...sellModal, reason: e.target.value })}
                  placeholder="例如 跌破季線停損 / 保本停損 / 移動停利"
                  style={{ width: '100%', padding: '0.5rem', background: '#0F172A', border: '1px solid #334155', color: '#fff', borderRadius: '6px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setSellModal({ open: false, stock_id: '', stock_name: '', shares: 0, price: '', reason: '' })}
                  style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid #475569', color: '#94A3B8', borderRadius: '6px', cursor: 'pointer' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  style={{ padding: '0.5rem 1.25rem', background: '#DC2626', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                >
                  確認平倉
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
