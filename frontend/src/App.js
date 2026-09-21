import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ForumList from './components/ForumList';
import NewPostForm from './components/NewPostForm';
import CategoryList from './components/CategoryList';
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
            <Route path="/" element={<ForumList />} />
            <Route path="/categories" element={<CategoryList />} />
            <Route path="/new-post" element={<NewPostForm />} />
            <Route path="/stock-analysis" element={<StockDashboard />} />
            <Route path="/login" element={<Login />} />
            <Route path="/users" element={<UserManagement />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
