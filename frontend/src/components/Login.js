import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiLogin, setAuthToken, setCurrentUser } from '../api';

const Login = () => {
  const [username, setUsername] = useState('hotpotlu');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiLogin(username, password);
      setAuthToken(data.access_token);
      setCurrentUser(data.user);
      // 觸發自訂事件讓 Header 即時更新狀態
      window.dispatchEvent(new Event('authChange'));
      navigate('/users');
    } catch (err) {
      setError(err.message || '登入失敗，請檢查帳號密碼');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = () => {
    setUsername('hotpotlu');
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="lobster-icon">🦐</div>
          <h2>蝦報 / 蝦爆 系統登入</h2>
          <p className="login-subtitle">請輸入您的帳號密碼以存取蝦報後台與管理功能</p>
        </div>

        {error && <div className="login-alert error">{error}</div>}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="username">使用者帳號</label>
            <input
              id="username"
              type="text"
              className="form-control"
              placeholder="請輸入帳號 (例: hotpotlu)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密碼</label>
            <input
              id="password"
              type="password"
              className="form-control"
              placeholder="請輸入密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="quick-fill-box">
            <button
              type="button"
              className="quick-fill-btn"
              onClick={handleQuickFill}
            >
              💡 填入預設帳號 (hotpotlu)
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary login-submit-btn"
            disabled={loading}
          >
            {loading ? '登入驗證中...' : '立即登入'}
          </button>
        </form>

        <div className="login-footer">
          <small>Lobster Report (蝦報) 綜合資訊分析系統 • Supabase Postgres 整合</small>
        </div>
      </div>
    </div>
  );
};

export default Login;
