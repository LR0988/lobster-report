const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

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

// 登入 API
export async function apiLogin(username, password) {
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
}

// 取得所有使用者
export async function apiGetUsers() {
  const token = getAuthToken();
  const res = await fetch(`${API_URL}/users/`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error('無法取得使用者列表');
  }
  return await res.json();
}

// 新增使用者
export async function apiCreateUser(userData) {
  const token = getAuthToken();
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
}

// 更新使用者 (切換狀態/修改資料)
export async function apiUpdateUser(id, userData) {
  const token = getAuthToken();
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
}

// 刪除使用者
export async function apiDeleteUser(id) {
  const token = getAuthToken();
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
}
