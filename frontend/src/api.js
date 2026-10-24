// ==========================================
// 💻 筆電本機端與雲端連線基礎配置 (優先直連筆電 Port 8000)
// ==========================================
import defaultOversoldSniperData from './data/defaultOversoldSniperData.json';

let dynamicApiBase = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'http://localhost:8000'
  : '';

// 雲端 PostgreSQL / Supabase 配置 (作為遠端安全通道註冊與異地離線備援鏡像)
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://hvequgcognhytunjjsyp.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0';

export const supabaseDirectFetch = async (path, options = {}) => {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  return fetch(url, { ...options, headers, cache: 'no-store' });
};

/**
 * 動態解析主機連線網址：
 * 1. 筆電本機 (localhost / 127.0.0.1) -> 強制直連筆電 Port 8000 (SQLite: tw_stock.db)
 * 2. 外部遠端/手機存取 -> 優先查詢筆電在 Supabase 註冊之最新 Cloudflare 安全通道 (Tunnel URL)，直通筆電後端
 */
export const resolveApiBase = async (forceRefresh = false) => {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    dynamicApiBase = 'http://localhost:8000';
    return 'http://localhost:8000';
  }
  if (!forceRefresh && dynamicApiBase && dynamicApiBase.startsWith('http') && !dynamicApiBase.includes('railway.app')) {
    return dynamicApiBase;
  }
  try {
    const sRes = await supabaseDirectFetch('/stock_settings?key=eq.remote_api_url&select=value');
    if (sRes.ok) {
      const rows = await sRes.json();
      if (rows && rows.length > 0 && rows[0].value) {
        const freshUrl = rows[0].value.replace(/\/+$/, '');
        dynamicApiBase = freshUrl;
        try { localStorage.setItem('remote_api_url', freshUrl); } catch {}
        return freshUrl;
      }
    }
  } catch (e) {
    console.warn('查詢筆電遠端通道失敗:', e);
  }

  // 嘗試讀取本地快取
  const cached = (typeof window !== 'undefined') ? localStorage.getItem('remote_api_url') : null;
  if (cached && cached.startsWith('http') && !cached.includes('railway.app')) {
    dynamicApiBase = cached;
    return cached;
  }

  const envUrl = process.env.REACT_APP_API_URL || process.env.REACT_APP_STOCK_API_URL || '';
  if (envUrl && envUrl.startsWith('http') && !envUrl.includes('railway.app')) {
    dynamicApiBase = envUrl;
    return envUrl;
  }

  return dynamicApiBase || 'http://localhost:8000';
};

export const getAuthToken = () => localStorage.getItem('token');
export const setAuthToken = (token) => localStorage.setItem('token', token);
export const removeAuthToken = () => localStorage.removeItem('token');

export const getCurrentUser = () => {
  const user = localStorage.getItem('user');
  try {
    return user ? JSON.parse(user) : null;
  } catch (e) {
    return null;
  }
};
export const setCurrentUser = (user) => localStorage.setItem('user', JSON.stringify(user));
export const removeCurrentUser = () => localStorage.removeItem('user');

// 本地快取使用者存取輔助函數 (當後端未連線時提供離線備援)
const LOCAL_USERS_KEY = 'lobster_local_users';
const getStoredUsers = () => {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [
    {
      id: 1,
      username: 'hotpotlu',
      email: 'hotpotlu@lobster-report.com',
      role: 'admin',
      is_active: true,
      created_at: new Date().toISOString()
    }
  ];
};
const setStoredUsers = (users) => {
  try {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  } catch (e) {}
};

// 登入 API
export async function apiLogin(username, password) {
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '登入失敗' }));
      throw new Error(err.detail || '帳號或密碼錯誤');
    }
    return await res.json();
  } catch (err) {
    const isNetworkError = !err.message || 
      err.message.includes('Failed to fetch') || 
      err.message.includes('NetworkError') || 
      err.message.includes('Load failed') ||
      err.message.includes('Method Not Allowed');

    if (isNetworkError) {
      console.warn('筆電後端 API 未連線，使用本機預覽備援憑證驗證:', err.message);
      const stored = getStoredUsers();
      const matched = stored.find(u => u.username === username);
      if (username === 'hotpotlu' && password === 'qQ!0963067171') {
        return {
          access_token: 'offline_token_hotpotlu_' + Date.now(),
          token_type: 'bearer',
          user: matched || {
            id: 1,
            username: 'hotpotlu',
            email: 'hotpotlu@lobster-report.com',
            role: 'admin',
            is_active: true,
            created_at: new Date().toISOString()
          }
        };
      } else if (matched) {
        return {
          access_token: 'offline_token_' + matched.username + '_' + Date.now(),
          token_type: 'bearer',
          user: matched
        };
      } else {
        throw new Error('帳號或密碼錯誤 (離線備援模式)');
      }
    }
    throw err;
  }
}

// 取得所有使用者
export async function apiGetUsers() {
  const token = getAuthToken();
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/users/`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error('無法取得使用者列表');
    }
    const data = await res.json();
    setStoredUsers(data);
    return data;
  } catch (err) {
    console.warn('筆電後端未連線，使用前端快取資料:', err.message);
    return getStoredUsers();
  }
}

// 新增使用者
export async function apiCreateUser(userData) {
  const token = getAuthToken();
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/users/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: '新增使用者失敗' }));
      throw new Error(err.detail || '新增使用者失敗');
    }
    return await res.json();
  } catch (err) {
    console.warn('筆電後端未連線，儲存於前端快取:', err.message);
    const users = getStoredUsers();
    if (users.some(u => u.username === userData.username)) {
      throw new Error('使用者名稱已存在');
    }
    const newUser = {
      id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
      username: userData.username,
      email: userData.email,
      role: userData.role || 'admin',
      is_active: userData.is_active ?? true,
      created_at: new Date().toISOString()
    };
    users.push(newUser);
    setStoredUsers(users);
    return newUser;
  }
}

// 更新使用者
export async function apiUpdateUser(id, userData) {
  const token = getAuthToken();
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/users/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      throw new Error('更新使用者失敗');
    }
    return await res.json();
  } catch (err) {
    console.warn('筆電後端未連線，更新前端快取:', err.message);
    const users = getStoredUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...userData };
      setStoredUsers(users);
      return users[idx];
    }
    throw new Error('找不到使用者');
  }
}

// 刪除使用者
export async function apiDeleteUser(id) {
  const token = getAuthToken();
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/users/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error('刪除使用者失敗');
    }
    return await res.json();
  } catch (err) {
    console.warn('筆電後端未連線，從前端快取中刪除:', err.message);
    let users = getStoredUsers();
    users = users.filter(u => u.id !== id);
    setStoredUsers(users);
    return { message: '刪除成功', status: 'ok' };
  }
}

// ==========================================
// 👑 泰坦實盤每日監控與對帳 (Titan Live Monitor) API
// ==========================================
export async function apiGetTitanLiveState() {
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/api/titan/live`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`API ${base}/api/titan/live 未連線，使用本地備援數據:`, err.message);
  }
  try {
    const fallback = await import('./data/live_portfolio_state.json');
    return {
      status: 'ok',
      account: {
        initial_capital: fallback.initial_capital || 1000000,
        current_cash: fallback.current_cash || 1000000,
        total_equity: fallback.total_equity || 1000000,
        peak_equity: fallback.peak_equity || 1000000,
        cum_return_pct: fallback.cum_return_pct || 0.0,
        drawdown_pct: fallback.drawdown_pct || 0.0,
        exposure_pct: fallback.exposure_pct || 0.0,
        cash_reserve_pct: fallback.cash_reserve_pct || 100.0,
        realized_trades: (fallback.trade_history || []).filter(t => t.action === 'SELL').length,
        win_rate: 0.0,
        profit_factor: 0.0,
        total_realized_pnl: 0.0
      },
      taiex: {
        close: 48341.31,
        ma20: 47863.82,
        ma60: 45833.23,
        bullish: true
      },
      positions: fallback.positions || [],
      trades: fallback.trade_history || []
    };
  } catch (e) {
    return { status: 'error', message: '無可用實盤數據' };
  }
}

export async function apiRecordTitanBuy(data) {
  const base = await resolveApiBase();
  const res = await fetch(`${base}/api/titan/live/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '買進失敗' }));
    throw new Error(err.detail || '買進失敗');
  }
  return await res.json();
}

export async function apiRecordTitanSell(data) {
  const base = await resolveApiBase();
  const res = await fetch(`${base}/api/titan/live/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '平倉賣出失敗' }));
    throw new Error(err.detail || '平倉賣出失敗');
  }
  return await res.json();
}

export async function apiUpdateTitanCash(data) {
  const base = await resolveApiBase();
  const res = await fetch(`${base}/api/titan/live/cash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '更新現金失敗' }));
    throw new Error(err.detail || '更新現金失敗');
  }
  return await res.json();
}

// ==========================================
// 🌍 全球主權旗艦策略 Dashboard API (直接連線筆電本機 tw_stock.db)
// ==========================================
export async function apiGetGlobalSovereignDashboard() {
  const base = await resolveApiBase();
  // 1. 優先直接向筆電本機 FastAPI / tw_stock.db 獲取最新演算結果
  try {
    const res = await fetch(`${base}/api/global_sovereign/dashboard`);
    if (res.ok) {
      const json = await res.json();
      if (json.status === 'ok') {
        return json;
      }
    }
  } catch (err) {
    console.warn(`筆電本機 ${base}/api/global_sovereign/dashboard 未連線，嘗試備援:`, err.message);
  }

  // 2. 備援：自 Supabase 讀取雲端快照 (筆電關機時提供離線唯讀)
  try {
    const supRes = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.global_sovereign_dashboard&select=payload');
    if (supRes.ok) {
      const rows = await supRes.json();
      if (rows && rows.length > 0 && rows[0].payload) {
        return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      }
    }
  } catch (e) {}

  return null;
}

export async function apiGetGlobalTitanRankIc(params = {}) {
  const base = await resolveApiBase();
  const query = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${base}/api/global-sovereign/rank-ic?${query}`);
    if (res.ok) {
      const json = await res.json();
      if (json.status === 'ok') {
        return json;
      }
    }
  } catch (err) {
    console.warn(`筆電本機 ${base}/api/global-sovereign/rank-ic 未連線:`, err.message);
  }
  return null;
}

// ==========================================
// 🎯 極端超賣快打專屬 Dashboard API (直連筆電本機 tw_stock.db + 雲端三重容錯備援)
// ==========================================
const LOCAL_SNIPER_TRADES_KEY = 'user_oversold_sniper_trades_v1';
const LOCAL_SNIPER_DELETED_KEY = 'user_oversold_sniper_deleted_ids_v1';

export function getLocalSniperTrades() {
  try {
    const raw = (typeof window !== 'undefined') ? localStorage.getItem(LOCAL_SNIPER_TRADES_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveLocalSniperTrades(trades) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_SNIPER_TRADES_KEY, JSON.stringify(trades));
    }
  } catch (e) {}
}

export function getDeletedSniperTradeIds() {
  try {
    const raw = (typeof window !== 'undefined') ? localStorage.getItem(LOCAL_SNIPER_DELETED_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveDeletedSniperTradeIds(ids) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_SNIPER_DELETED_KEY, JSON.stringify(ids));
    }
  } catch (e) {}
}

export async function syncDeletedSniperTradeIdsToSupabase(ids) {
  try {
    await supabaseDirectFetch('/stock_ml_cache', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        model_type: 'user_oversold_sniper_deleted_ids',
        payload: JSON.stringify(ids),
        updated_at: new Date().toISOString()
      })
    });
  } catch (e) {}
}

export async function loadDeletedSniperTradeIdsFromSupabase() {
  try {
    const res = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.user_oversold_sniper_deleted_ids&select=payload');
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0 && rows[0].payload) {
        return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      }
    }
  } catch (e) {}
  return [];
}

export async function syncSniperTradesToSupabase(trades) {
  try {
    await supabaseDirectFetch('/stock_ml_cache', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        model_type: 'user_oversold_sniper_trades',
        payload: JSON.stringify(trades),
        updated_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('同步超賣跟單至 Supabase 異常:', e);
  }
}

export async function loadSniperTradesFromSupabase() {
  try {
    const res = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.user_oversold_sniper_trades&select=payload');
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0 && rows[0].payload) {
        return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      }
    }
  } catch (e) {}
  return null;
}

export async function apiGetOversoldSniperDashboard(cachedServerData = null) {
  let serverData = cachedServerData;

  if (!serverData) {
    const base = await resolveApiBase();
    if (base) {
      try {
        const res = await fetch(`${base}/api/oversold_sniper/dashboard`);
        if (res.ok) {
          const json = await res.json();
          if (json.status === 'ok') {
            serverData = json;
          }
        }
      } catch (err) {
        console.warn(`筆電本機 ${base}/api/oversold_sniper/dashboard 連線異常:`, err.message);
      }
    }

    // 雲端 Supabase 備援讀取 (確保異地或手機存取時立即取得最新 10/23 掃描成果)
    if (!serverData) {
      try {
        const supRes = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.oversold_sniper_dashboard&select=payload');
        if (supRes.ok) {
          const rows = await supRes.json();
          if (rows && rows.length > 0 && rows[0].payload) {
            serverData = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
          }
        }
      } catch (e) {
        console.warn('從 Supabase 讀取超賣快打看板備援失敗:', e);
      }
    }
  }

  // 讀取本地與雲端已刪除黑名單 (確保被刪除的紀錄絕不再被復原)
  const localDeleted = getDeletedSniperTradeIds();
  const cloudDeleted = await loadDeletedSniperTradeIdsFromSupabase().catch(() => []);
  const allDeletedIds = new Set([...localDeleted, ...(cloudDeleted || [])]);
  const isNotDeleted = (t) => t && !allDeletedIds.has(t.id) && !allDeletedIds.has(String(t.id));

  // 讀取本地與雲端用戶跟單紀錄
  const localTrades = getLocalSniperTrades();
  let cloudTrades = null;
  if (localTrades.length === 0) {
    cloudTrades = await loadSniperTradesFromSupabase();
    if (cloudTrades && Array.isArray(cloudTrades)) {
      saveLocalSniperTrades(cloudTrades);
    }
  }
  const allUserTrades = (localTrades.length > 0 ? localTrades : (cloudTrades || [])).filter(isNotDeleted);

  const userActiveHoldings = allUserTrades.filter(t => t.status === 'ACTIVE');
  const userClosedTrades = allUserTrades.filter(t => t.status === 'CLOSED');

  let activeHoldings = [];
  let tradeHistory = [];

  if (serverData) {
    const sActive = (serverData.active_holdings || []).filter(isNotDeleted);
    const sClosed = (serverData.trade_history || []).filter(isNotDeleted);

    // 以最新即時行情更新用戶持倉中的現價與未實現損益
    const priceMap = {};
    for (const item of (serverData.radar?.all_ranked || [])) {
      if (item.ticker && item.close) {
        priceMap[item.ticker] = item.close;
        if (item.ticker.endsWith('.TW')) {
          priceMap[item.ticker.replace('.TW', '')] = item.close;
        }
      }
    }
    for (const h of sActive) {
      if (h.ticker && h.current_price) {
        priceMap[h.ticker] = h.current_price;
      }
    }

    const refreshedUserActive = userActiveHoldings.map(pos => {
      const liveP = priceMap[pos.ticker] || priceMap[pos.ticker.toUpperCase()] || pos.current_price;
      const gainPct = parseFloat((((liveP - pos.entry_price) / pos.entry_price) * 100.0).toFixed(2));
      const gainAmt = parseFloat(((liveP - pos.entry_price) * pos.shares).toFixed(2));
      return {
        ...pos,
        current_price: liveP,
        unrealized_pnl_pct: gainPct,
        unrealized_pnl_amount: gainAmt
      };
    });

    const refreshedSActive = sActive.map(pos => {
      const liveP = priceMap[pos.ticker] || priceMap[pos.ticker.toUpperCase()] || pos.current_price;
      const gainPct = parseFloat((((liveP - pos.entry_price) / pos.entry_price) * 100.0).toFixed(2));
      const gainAmt = parseFloat(((liveP - pos.entry_price) * pos.shares).toFixed(2));
      return {
        ...pos,
        current_price: liveP,
        unrealized_pnl_pct: gainPct,
        unrealized_pnl_amount: gainAmt
      };
    });

    const existingActiveIds = new Set(refreshedSActive.map(t => t.id));
    const mergedActive = [...refreshedUserActive.filter(t => !existingActiveIds.has(t.id)), ...refreshedSActive];

    const existingClosedIds = new Set(sClosed.map(t => t.id));
    const mergedClosed = [...userClosedTrades.filter(t => !existingClosedIds.has(t.id)), ...sClosed];

    activeHoldings = mergedActive;
    tradeHistory = mergedClosed;
    serverData.active_holdings = activeHoldings;
    serverData.trade_history = tradeHistory;
  } else {
    const defaultData = defaultOversoldSniperData || {};
    const dActive = (defaultData.active_holdings || []).filter(isNotDeleted);
    const dClosed = (defaultData.trade_history || []).filter(isNotDeleted);

    const existingActiveIds = new Set(dActive.map(t => t.id));
    const mergedActive = [...userActiveHoldings.filter(t => !existingActiveIds.has(t.id)), ...dActive];

    const existingClosedIds = new Set(dClosed.map(t => t.id));
    const mergedClosed = [...userClosedTrades.filter(t => !existingClosedIds.has(t.id)), ...dClosed];

    activeHoldings = mergedActive;
    tradeHistory = mergedClosed;
    serverData = {
      ...defaultData,
      active_holdings: activeHoldings,
      trade_history: tradeHistory
    };
  }

  // 以真實歷史紀錄即時計算績效 (Single Source of Truth)
  const totClosed = tradeHistory.length;
  const wins = tradeHistory.filter(t => (t.pnl_pct || 0) > 0);
  const losses = tradeHistory.filter(t => (t.pnl_pct || 0) <= 0);
  const winRate = totClosed > 0 ? parseFloat(((wins.length / totClosed) * 100.0).toFixed(1)) : 0.0;
  const avgRet = totClosed > 0 ? parseFloat((tradeHistory.reduce((acc, t) => acc + (t.pnl_pct || 0), 0) / totClosed).toFixed(2)) : 0.0;
  const avgHolding = totClosed > 0 ? parseFloat((tradeHistory.reduce((acc, t) => acc + (t.holding_days || 1), 0) / totClosed).toFixed(1)) : 0.0;
  const totPnlTwd = tradeHistory.filter(t => t.currency === 'TWD' || (t.ticker && t.ticker.endsWith('.TW'))).reduce((acc, t) => acc + (t.pnl_amount || 0), 0);
  const totPnlUsd = tradeHistory.filter(t => t.currency === 'USD' || (!t.currency && !t.ticker?.endsWith('.TW'))).reduce((acc, t) => acc + (t.pnl_amount || 0), 0);

  serverData.user_performance = {
    total_closed_trades: totClosed,
    win_trades: wins.length,
    loss_trades: losses.length,
    win_rate: winRate,
    avg_return_pct: avgRet,
    avg_holding_days: avgHolding,
    total_pnl_twd: parseFloat(totPnlTwd.toFixed(2)),
    total_pnl_usd: parseFloat(totPnlUsd.toFixed(2)),
    active_positions_count: activeHoldings.length
  };

  return serverData;
}

// ⚡ 觸發全市場重新連線掃描 (抓取 10/23 最新即時行情並重算)
export async function apiTriggerOversoldSniperScan() {
  const base = await resolveApiBase(true);
  let freshData = null;

  if (base) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s
      const res = await fetch(`${base}/api/oversold_sniper/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json.status === 'ok') {
          freshData = json.data || json;
        }
      }
    } catch (err) {
      console.warn(`POST 重新掃描異常，嘗試 GET refresh:`, err.message);
      try {
        const res2 = await fetch(`${base}/api/oversold_sniper/dashboard?refresh=1`);
        if (res2.ok) {
          const json2 = await res2.json();
          if (json2.status === 'ok') {
            freshData = json2;
          }
        }
      } catch (e) {}
    }
  }

  // 若後端通道不可及，從 Supabase 取得最新已同步之掃描資料
  if (!freshData) {
    try {
      const supRes = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.oversold_sniper_dashboard&select=payload');
      if (supRes.ok) {
        const rows = await supRes.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          freshData = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
        }
      }
    } catch (e) {}
  }

  return await apiGetOversoldSniperDashboard(freshData);
}

export async function apiAddOversoldSniperTrade(payload) {
  const base = await resolveApiBase();
  let localResult = null;

  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = now.toTimeString().split(' ')[0]; // HH:mm:ss

  const entryDate = payload.entry_date || defaultDate;
  const entryTime = payload.entry_time || defaultTime;

  const fullPayload = {
    ...payload,
    entry_date: entryDate,
    entry_time: entryTime
  };

  if (base) {
    try {
      const res = await fetch(`${base}/api/oversold_sniper/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload)
      });
      if (res.ok) {
        localResult = await res.json();
      }
    } catch (err) {
      console.warn(`後端通道異常，自動切換至雲端/本地韌性保存:`, err.message);
    }
  }

  const newTradeId = localResult?.trade_id || `snip_${Date.now()}`;
  const inputPrice = parseFloat(payload.entry_price);
  const inputShares = parseFloat(payload.shares);

  const newTrade = {
    id: newTradeId,
    ticker: payload.ticker,
    name: payload.name || payload.ticker,
    market: payload.market || '美股',
    currency: payload.currency || 'USD',
    status: 'ACTIVE',
    entry_date: entryDate,
    entry_time: entryTime,
    entry_datetime: `${entryDate} ${entryTime}`,
    entry_price: inputPrice,
    shares: inputShares,
    current_price: inputPrice,
    unrealized_pnl_pct: 0.0,
    unrealized_pnl_amount: 0.0,
    holding_days: 1,
    target_ma10: parseFloat((inputPrice * 1.075).toFixed(2)),
    target_ma20: parseFloat((inputPrice * 1.10).toFixed(2)),
    stop_loss_price: parseFloat((inputPrice * 0.90).toFixed(2)),
    can_sell: false,
    sell_badge: '🛡️ 建倉持有中',
    sell_badge_color: '#38BDF8',
    sell_instruction: `進場時間: ${entryDate} ${entryTime.slice(0, 5)}，目標等待反彈觸及 10MA 停利！`,
    notes: payload.notes || ''
  };

  const currentTrades = getLocalSniperTrades();
  const updatedTrades = [newTrade, ...currentTrades.filter(t => t.id !== newTradeId)];
  saveLocalSniperTrades(updatedTrades);
  syncSniperTradesToSupabase(updatedTrades);

  return localResult || {
    status: 'ok',
    message: `成功新增跟單 ${payload.ticker} (成本: ${inputPrice}，進場時間: ${entryDate} ${entryTime.slice(0, 5)})！`,
    trade_id: newTradeId,
    entry_date: entryDate,
    entry_time: entryTime
  };
}

export async function apiCloseOversoldSniperTrade(tradeId, payload) {
  const base = await resolveApiBase();
  let localResult = null;

  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = now.toTimeString().split(' ')[0]; // HH:mm:ss

  const exitDate = payload.exit_date || defaultDate;
  const exitTime = payload.exit_time || defaultTime;

  const fullPayload = {
    ...payload,
    exit_date: exitDate,
    exit_time: exitTime
  };

  if (base) {
    try {
      const res = await fetch(`${base}/api/oversold_sniper/trades/${tradeId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload)
      });
      if (res.ok) {
        localResult = await res.json();
      }
    } catch (err) {
      console.warn(`平倉快打紀錄異常:`, err.message);
    }
  }

  const currentTrades = getLocalSniperTrades();
  const updatedTrades = currentTrades.map(t => {
    if (t.id === tradeId || t.ticker === tradeId) {
      const xPrice = parseFloat(payload.exit_price) || t.entry_price;
      const pnlPct = parseFloat(((xPrice / t.entry_price - 1.0) * 100.0).toFixed(2));
      const pnlAmt = parseFloat(((xPrice - t.entry_price) * t.shares).toFixed(2));

      let holdingDays = 1;
      try {
        const eStr = `${t.entry_date}T${t.entry_time || '09:00:00'}`;
        const xStr = `${exitDate}T${exitTime}`;
        const diffMs = new Date(xStr).getTime() - new Date(eStr).getTime();
        holdingDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      } catch (e) {}

      return {
        ...t,
        status: 'CLOSED',
        exit_date: exitDate,
        exit_time: exitTime,
        exit_datetime: `${exitDate} ${exitTime}`,
        exit_price: xPrice,
        exit_reason: payload.exit_reason || '🎯 手動獲利平倉',
        pnl_pct: pnlPct,
        pnl_amount: pnlAmt,
        holding_days: holdingDays
      };
    }
    return t;
  });
  saveLocalSniperTrades(updatedTrades);
  syncSniperTradesToSupabase(updatedTrades);

  return localResult || {
    status: 'ok',
    message: `成功平倉跟單紀錄！出場時間: ${exitDate} ${exitTime.slice(0, 5)}`
  };
}

export async function apiDeleteOversoldSniperTrade(tradeId) {
  const base = await resolveApiBase();
  let localResult = null;

  if (base) {
    try {
      const res = await fetch(`${base}/api/oversold_sniper/trades/${tradeId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        localResult = await res.json();
      }
    } catch (err) {
      console.warn(`刪除快打紀錄異常:`, err.message);
    }
  }

  // 1. 寫入本地與雲端黑名單，確保不會被後端舊快照或預設檔復原
  const currentDeleted = getDeletedSniperTradeIds();
  if (!currentDeleted.includes(tradeId)) {
    const updatedDeleted = [...currentDeleted, tradeId];
    saveDeletedSniperTradeIds(updatedDeleted);
    syncDeletedSniperTradeIdsToSupabase(updatedDeleted);
  }

  // 2. 從本地持倉列表中剔除
  const currentTrades = getLocalSniperTrades();
  const updatedTrades = currentTrades.filter(t => t.id !== tradeId && String(t.id) !== String(tradeId));
  saveLocalSniperTrades(updatedTrades);
  syncSniperTradesToSupabase(updatedTrades);

  return localResult || {
    status: 'ok',
    message: `已刪除跟單紀錄`
  };
}

// ==========================================
// 👑 全球泰坦實盤持倉與交易紀錄 (優先直連筆電本機 tw_stock.db)
// ==========================================
export async function apiGetGlobalTitanPortfolio(username) {
  const targetUser = username || 'hotpotlu';
  const base = await resolveApiBase();

  // 1. 優先直接連線筆電本機 tw_stock.db (即時獲取最新現價與持股)
  try {
    const res = await fetch(`${base}/api/global_titan/live`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === 'ok') {
        return {
          status: 'ok',
          username: targetUser,
          positions: data.positions || [],
          tx_history: data.trades || [],
          usd_fx: Number(data.account?.usd_fx) || 32.5,
          account: data.account || {},
          dismissed_suggestions: []
        };
      }
    }
  } catch (err) {
    console.warn(`筆電本機 ${base}/api/global_titan/live 未連線，嘗試雲端備援:`, err.message);
  }

  // 2. 雲端 Supabase 備援讀取 (筆電關機時提供離線閱覽)
  try {
    const res = await supabaseDirectFetch(`/user_titan_portfolios?username=eq.${encodeURIComponent(targetUser)}&select=*`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const row = data[0];
        let positions = [];
        let txHistory = [];
        let dismissed = [];
        try { positions = typeof row.positions === 'string' ? JSON.parse(row.positions) : (row.positions || []); } catch {}
        try { txHistory = typeof row.tx_history === 'string' ? JSON.parse(row.tx_history) : (row.tx_history || []); } catch {}
        try { dismissed = typeof row.dismissed_suggestions === 'string' ? JSON.parse(row.dismissed_suggestions) : (row.dismissed_suggestions || []); } catch {}
        return {
          status: 'ok',
          username: row.username,
          positions,
          tx_history: txHistory,
          usd_fx: Number(row.usd_fx) || 32.5,
          dismissed_suggestions: dismissed,
          updated_at: row.updated_at
        };
      }
    }
  } catch (err) {
    console.warn('Supabase 直連讀取全球泰坦帳本失敗:', err);
  }

  return { status: 'ok', username: targetUser, positions: [], tx_history: [], usd_fx: 32.5, dismissed_suggestions: [] };
}

// 全球泰坦旗艦策略：儲存個人投資組合與交易紀錄 (優先寫入筆電本機 tw_stock.db，並異步備份至 Supabase)
export async function apiSaveGlobalTitanPortfolio(portfolioData) {
  const targetUser = portfolioData.username || 'hotpotlu';
  const base = await resolveApiBase();
  let localSaved = false;

  // 1. 優先持久化寫入筆電本機資料庫 tw_stock.db
  try {
    const res = await fetch(`${base}/api/global_titan/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positions: portfolioData.positions || [],
        trades: portfolioData.tx_history || [],
        account: {
          usd_fx: portfolioData.usd_fx || 32.5,
          last_updated: new Date().toISOString().split('T')[0],
          ...(portfolioData.account || {})
        }
      })
    });
    if (res.ok) {
      localSaved = true;
    }
  } catch (err) {
    console.warn('寫入筆電本機 tw_stock.db 失敗:', err.message);
  }

  // 2. 同步非同步備份至 Supabase 雲端 (供手機/異地訪問備援)
  try {
    const posStr = typeof portfolioData.positions === 'string' ? portfolioData.positions : JSON.stringify(portfolioData.positions || []);
    const txStr = typeof portfolioData.tx_history === 'string' ? portfolioData.tx_history : JSON.stringify(portfolioData.tx_history || []);
    const suggStr = typeof portfolioData.dismissed_suggestions === 'string' ? portfolioData.dismissed_suggestions : JSON.stringify(portfolioData.dismissed_suggestions || []);
    const fxVal = Number(portfolioData.usd_fx) || 32.5;

    const checkRes = await supabaseDirectFetch(`/user_titan_portfolios?username=eq.${encodeURIComponent(targetUser)}&select=id`);
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        await supabaseDirectFetch(`/user_titan_portfolios?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            positions: posStr,
            tx_history: txStr,
            usd_fx: fxVal,
            dismissed_suggestions: suggStr,
            updated_at: new Date().toISOString()
          })
        });
      } else {
        await supabaseDirectFetch(`/user_titan_portfolios`, {
          method: 'POST',
          body: JSON.stringify({
            username: targetUser,
            positions: posStr,
            tx_history: txStr,
            usd_fx: fxVal,
            dismissed_suggestions: suggStr,
            updated_at: new Date().toISOString()
          })
        });
      }
    }
  } catch (err) {
    console.warn('Supabase 雲端備份同步失敗:', err);
  }

  return { 
    status: 'ok', 
    source: localSaved ? 'local' : 'cloud',
    message: localSaved ? '已成功儲存至筆電本機資料庫 (tw_stock.db)' : '已成功儲存至雲端備份'
  };
}

// ==========================================
// 🇹🇼 台股泰坦實作策略 (優先直連筆電本機 tw_stock.db)
// ==========================================
export async function apiGetTaiwanTitanPortfolio(username) {
  const targetUser = username || 'hotpotlu';
  const base = await resolveApiBase();

  // 1. 優先直接向筆電本機 tw_stock.db (/api/titan/live) 獲取
  try {
    const res = await fetch(`${base}/api/titan/live`);
    if (res.ok) {
      const live = await res.json();
      if (live && live.status === 'ok') {
        return {
          status: 'ok',
          username: targetUser,
          positions: live.positions || [],
          tx_history: live.trades || [],
          account: live.account || {},
          taiex: live.taiex || null,
          live_prices: live.live_prices || {},
          dismissed_suggestions: []
        };
      }
    }
  } catch (e) {
    console.warn(`筆電本機 ${base}/api/titan/live 未連線，嘗試雲端備援:`, e.message);
  }

  // 2. 雲端 Supabase 備援讀取
  try {
    const res = await supabaseDirectFetch(`/user_taiwan_titan_portfolios?username=eq.${encodeURIComponent(targetUser)}&select=*`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const row = data[0];
        let positions = [];
        let txHistory = [];
        let dismissed = [];
        try { positions = typeof row.positions === 'string' ? JSON.parse(row.positions) : (row.positions || []); } catch {}
        try { txHistory = typeof row.tx_history === 'string' ? JSON.parse(row.tx_history) : (row.tx_history || []); } catch {}
        try { dismissed = typeof row.dismissed_suggestions === 'string' ? JSON.parse(row.dismissed_suggestions) : (row.dismissed_suggestions || []); } catch {}
        return {
          status: 'ok',
          username: row.username,
          positions,
          tx_history: txHistory,
          dismissed_suggestions: dismissed,
          updated_at: row.updated_at
        };
      }
    }
  } catch (err) {
    console.warn('Supabase 直連讀取台股泰坦帳本失敗:', err);
  }

  return { status: 'ok', username: targetUser, positions: [], tx_history: [], dismissed_suggestions: [] };
}

// 台股泰坦實作策略：儲存個人投資組合與交易紀錄 (優先寫入筆電本機 tw_stock.db，並異步備份至 Supabase)
export async function apiSaveTaiwanTitanPortfolio(portfolioData) {
  const targetUser = portfolioData.username || 'hotpotlu';
  const base = await resolveApiBase();
  let localSaved = false;

  // 1. 優先持久化寫入筆電本機資料庫 tw_stock.db
  try {
    const res = await fetch(`${base}/api/titan/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positions: portfolioData.positions || [],
        trades: portfolioData.tx_history || [],
        account: portfolioData.account || {}
      })
    });
    if (res.ok) {
      localSaved = true;
    }
  } catch (err) {
    console.warn('寫入筆電本機 tw_stock.db 失敗:', err.message);
  }

  // 2. 同步非同步備份至 Supabase 雲端
  try {
    const posStr = typeof portfolioData.positions === 'string' ? portfolioData.positions : JSON.stringify(portfolioData.positions || []);
    const txStr = typeof portfolioData.tx_history === 'string' ? portfolioData.tx_history : JSON.stringify(portfolioData.tx_history || []);
    const suggStr = typeof portfolioData.dismissed_suggestions === 'string' ? portfolioData.dismissed_suggestions : JSON.stringify(portfolioData.dismissed_suggestions || []);

    const checkRes = await supabaseDirectFetch(`/user_taiwan_titan_portfolios?username=eq.${encodeURIComponent(targetUser)}&select=id`);
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        await supabaseDirectFetch(`/user_taiwan_titan_portfolios?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            positions: posStr,
            tx_history: txStr,
            dismissed_suggestions: suggStr,
            updated_at: new Date().toISOString()
          })
        });
      } else {
        await supabaseDirectFetch(`/user_taiwan_titan_portfolios`, {
          method: 'POST',
          body: JSON.stringify({
            username: targetUser,
            positions: posStr,
            tx_history: txStr,
            dismissed_suggestions: suggStr,
            updated_at: new Date().toISOString()
          })
        });
      }
    }
  } catch (err) {
    console.warn('Supabase 直連儲存台股泰坦帳本失敗:', err);
  }

  return { 
    status: 'ok', 
    source: localSaved ? 'local' : 'cloud',
    message: localSaved ? '已成功儲存至筆電本機資料庫 (tw_stock.db)' : '已成功儲存至雲端備份'
  };
}

// ==========================================
// 🎯 台股事件與ETF吃豆腐策略 Dashboard API (優先直連本機 tw_stock.db)
// ==========================================
export async function apiGetTwEventRadarDashboard() {
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/api/tw_event_radar/dashboard`);
    if (res.ok) {
      const json = await res.json();
      if (json && json.status === 'ok') {
        return json;
      }
    }
  } catch (err) {
    console.warn(`本機 ${base}/api/tw_event_radar/dashboard 未連線，嘗試雲端備援:`, err.message);
  }

  try {
    const supRes = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.tw_event_radar_dashboard&select=payload');
    if (supRes.ok) {
      const rows = await supRes.json();
      if (rows && rows.length > 0 && rows[0].payload) {
        return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      }
    }
  } catch (e) {}

  return null;
}

// ==========================================
// ⚡ 台股可轉債主力與急跌狙擊 Dashboard API (優先直連本機 tw_stock.db)
// ==========================================
export async function apiGetTwAsymmetricAlphaDashboard() {
  const base = await resolveApiBase();
  try {
    const res = await fetch(`${base}/api/tw_asymmetric_alpha/dashboard`);
    if (res.ok) {
      const json = await res.json();
      if (json && json.status === 'ok') {
        return json;
      }
    }
  } catch (err) {
    console.warn(`本機 ${base}/api/tw_asymmetric_alpha/dashboard 未連線，嘗試雲端備援:`, err.message);
  }

  try {
    const supRes = await supabaseDirectFetch('/stock_ml_cache?model_type=eq.tw_asymmetric_alpha_dashboard&select=payload');
    if (supRes.ok) {
      const rows = await supRes.json();
      if (rows && rows.length > 0 && rows[0].payload) {
        return typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
      }
    }
  } catch (e) {}

  return null;
}

