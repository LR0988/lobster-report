import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import StockDashboard from './components/StockDashboard';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import ErrorBoundary from './components/ErrorBoundary';
import StockChartHost from './components/StockChart';
import { getCurrentUser } from './api';
import './index.css';

// 路由守衛：未登入者強制導向至登入頁面
function ProtectedRoute({ children }) {
  const user = getCurrentUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <div className="App">
        <Header />
        <main className="main-content">
          <ErrorBoundary>
            <Routes>
              {/* 首頁受保護：需登入帳號才能存取智慧選股與量化系統 */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <StockDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/stock-analysis" element={<Navigate to="/" replace />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/users"
                element={
                  <ProtectedRoute>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
        <Footer />
        <StockChartHost />
      </div>
    </Router>
  );
}

export default App;
