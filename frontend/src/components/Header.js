import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCurrentUser, removeAuthToken, removeCurrentUser } from '../api';

const Header = () => {
  const [user, setUser] = useState(getCurrentUser());
  const navigate = useNavigate();

  const syncUser = () => {
    setUser(getCurrentUser());
  };

  useEffect(() => {
    syncUser();
    window.addEventListener('authChange', syncUser);
    window.addEventListener('storage', syncUser);
    return () => {
      window.removeEventListener('authChange', syncUser);
      window.removeEventListener('storage', syncUser);
    };
  }, []);

  const handleLogout = () => {
    removeAuthToken();
    removeCurrentUser();
    syncUser();
    navigate('/login');
  };

  return (
    <header className="forum-header">
      <div className="header-brand-container">
        <Link to="/" className="brand-logo-link">
          <span className="brand-icon">🦐</span>
          <span className="brand-name">蝦報 (Lobster Report)</span>
        </Link>
        <div className="user-nav-status">
          {user ? (
            <div className="user-profile-badge">
              <span className="user-avatar">👤</span>
              <span className="user-greeting">
                <strong>{user.username}</strong>
                <span className="user-role-tag">{user.role}</span>
              </span>
              <button onClick={handleLogout} className="btn-logout">
                登出
              </button>
            </div>
          ) : (
            <Link to="/login" className="btn-login-header">
              🔐 登入
            </Link>
          )}
        </div>
      </div>
      <nav className="main-nav">
        <ul className="nav-list">
          <li><Link to="/">📰 即時論壇</Link></li>
          <li><Link to="/categories">📂 分類情報</Link></li>
          <li><Link to="/new-post">✏️ 發表新文章</Link></li>
          <li><Link to="/stock-analysis">📈 股票與財報分析</Link></li>
          <li><Link to="/users">👥 使用者管理</Link></li>
          {!user && <li><Link to="/login" className="nav-highlight">🔐 登入頁面</Link></li>}
        </ul>
      </nav>
    </header>
  );
};

export default Header;
