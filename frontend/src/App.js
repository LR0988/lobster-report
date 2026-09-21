import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import StockDashboard from './components/StockDashboard';
import Login from './components/Login';
import UserManagement from './components/UserManagement';
import './index.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Header />
        <main className="main-content">
          <Routes>
            {/* 首頁直接載入台股智慧選股系統 */}
            <Route path="/" element={<StockDashboard />} />
            <Route path="/stock-analysis" element={<Navigate to="/" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
