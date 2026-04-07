import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import ForumList from './components/ForumList';
import NewPostForm from './components/NewPostForm';
import CategoryList from './components/CategoryList';
import './index.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Header />
        <main className="forum-main-content">
          <Routes>
            <Route path="/" element={<ForumList />} />
            <Route path="/categories" element={<CategoryList />} />
            <Route path="/new-post" element={<NewPostForm />} />
            {/* Add more routes here for individual posts, user profiles, etc. if needed */}
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
