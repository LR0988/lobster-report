import React, { useState, useEffect } from 'react';
import { apiGetUsers, apiCreateUser, apiUpdateUser, apiDeleteUser, getCurrentUser } from '../api';

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // 新增使用者表單
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('admin');
  const [submitting, setSubmitting] = useState(false);

  const currentUser = getCurrentUser();

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGetUsers();
      setUsers(data);
    } catch (err) {
      console.warn('API fetch failed, fallback to local/mock view:', err);
      setError('無法連線至後端伺服器，請確保後端已啟動。目前顯示快取資訊。');
      // 如果後端沒啟動，提供備用預設使用者列表以利展示
      setUsers([
        {
          id: 1,
          username: 'hotpotlu',
          email: 'hotpotlu@lobster-report.com',
          role: 'admin',
          is_active: true,
          created_at: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      await apiCreateUser({
        username: newUsername,
        password: newPassword,
        email: newEmail || undefined,
        role: newRole,
        is_active: true
      });
      setSuccessMsg(`使用者「${newUsername}」建立成功！`);
      setShowAddModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');
      loadUsers();
    } catch (err) {
      setError(err.message || '建立使用者失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (user) => {
    try {
      await apiUpdateUser(user.id, { is_active: !user.is_active });
      setSuccessMsg(`已將「${user.username}」狀態更新為：${!user.is_active ? '啟用' : '停用'}`);
      loadUsers();
    } catch (err) {
      setError('更新狀態失敗');
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.username === 'hotpotlu') {
      alert('預設管理員 hotpotlu 不可刪除！');
      return;
    }
    if (!window.confirm(`確定要刪除使用者「${user.username}」嗎？`)) {
      return;
    }

    try {
      await apiDeleteUser(user.id);
      setSuccessMsg(`使用者「${user.username}」已刪除`);
      loadUsers();
    } catch (err) {
      setError('刪除失敗');
    }
  };

  return (
    <div className="user-management-container">
      <div className="user-mgmt-header">
        <div>
          <h2>👥 蝦報使用者權限與帳號管理</h2>
          <p className="subtitle">
            管理 Supabase PostgreSQL 資料庫中的使用者帳號與權限層級
          </p>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            ➕ 新增使用者
          </button>
          <button className="btn btn-secondary" onClick={loadUsers}>
            🔄 重新整理
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* 使用者統計卡片 */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-num">{users.length}</span>
          <span className="stat-label">總帳號數</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">
            {users.filter(u => u.is_active).length}
          </span>
          <span className="stat-label">啟用中</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">
            {users.filter(u => u.role === 'admin').length}
          </span>
          <span className="stat-label">管理員 (Admin)</span>
        </div>
      </div>

      {/* 使用者列表表格 */}
      <div className="table-responsive">
        <table className="user-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>使用者帳號</th>
              <th>電子郵件</th>
              <th>角色權限</th>
              <th>帳號狀態</th>
              <th>建立時間</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '30px' }}>
                  讀取 Supabase 使用者資料中...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '30px' }}>
                  目前沒有任何使用者
                </td>
              </tr>
            ) : (
              users.map(u => {
                const isCurrent = currentUser && currentUser.username === u.username;
                return (
                  <tr key={u.id} className={isCurrent ? 'highlight-row' : ''}>
                    <td>#{u.id}</td>
                    <td>
                      <strong>{u.username}</strong>
                      {isCurrent && <span className="badge badge-current">當前登入</span>}
                    </td>
                    <td>{u.email || '-'}</td>
                    <td>
                      <span className={`badge badge-role-${u.role}`}>
                        {u.role === 'admin' ? '🛡️ 管理員' : u.role === 'editor' ? '✍️ 編輯者' : '👤 一般用戶'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-active' : 'badge-disabled'}`}>
                        {u.is_active ? '● 正常啟用' : '○ 已停用'}
                      </span>
                    </td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-action btn-toggle"
                          onClick={() => handleToggleActive(u)}
                          title="切換啟用狀態"
                        >
                          {u.is_active ? '停用' : '啟用'}
                        </button>
                        {u.username !== 'hotpotlu' && (
                          <button
                            className="btn-action btn-delete"
                            onClick={() => handleDeleteUser(u)}
                            title="刪除帳號"
                          >
                            刪除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 新增使用者彈出對話框 */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>➕ 新增蝦報系統使用者</h3>
              <button
                className="close-btn"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="form-group">
                <label>帳號名稱 (Username) *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例: frank_shrimp"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>設定密碼 *</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="請輸入密碼"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>電子郵件 (選填)</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="user@lobster-report.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>角色權限</label>
                <select
                  className="form-control"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  <option value="admin">🛡️ 管理員 (Admin - 全部權限)</option>
                  <option value="editor">✍️ 編輯者 (Editor - 編輯發文)</option>
                  <option value="viewer">👀 檢視者 (Viewer - 純讀取)</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? '寫入 Supabase 中...' : '確定建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
