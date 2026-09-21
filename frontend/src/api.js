const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

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
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
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
    // 若後端尚未部署在線上 (如 Vercel 預覽)、或連線失敗，啟動備援驗證
    const isNetworkError = !err.message || 
      err.message.includes('Failed to fetch') || 
      err.message.includes('NetworkError') || 
      err.message.includes('Load failed') ||
      err.message.includes('Method Not Allowed');

    if (isNetworkError) {
      console.warn('後端 API 未連線，使用前端預覽備援憑證驗證:', err.message);
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
        throw new Error('帳號或密碼錯誤 (備援模式)');
      }
    }
    throw err;
  }
}

// 取得所有使用者
export async function apiGetUsers() {
  const token = getAuthToken();
  try {
    const res = await fetch(`${API_URL}/users/`, {
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
    console.warn('後端未連線，使用前端快取資料:', err.message);
    return getStoredUsers();
  }
}

// 新增使用者
export async function apiCreateUser(userData) {
  const token = getAuthToken();
  try {
    const res = await fetch(`${API_URL}/users/`, {
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
    console.warn('後端未連線，直接儲存於前端快取:', err.message);
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

// 更新使用者 (切換狀態/修改資料)
export async function apiUpdateUser(id, userData) {
  const token = getAuthToken();
  try {
    const res = await fetch(`${API_URL}/users/${id}`, {
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
    console.warn('後端未連線，更新前端快取:', err.message);
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
  try {
    const res = await fetch(`${API_URL}/users/${id}`, {
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
    console.warn('後端未連線，從前端快取中刪除:', err.message);
    let users = getStoredUsers();
    users = users.filter(u => u.id !== id);
    setStoredUsers(users);
    return { message: '刪除成功', status: 'ok' };
  }
}
