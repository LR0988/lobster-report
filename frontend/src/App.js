import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'https://lobster-report-backend.up.railway.app';

function App() {
  const [healthStatus, setHealthStatus] = useState('Checking...');
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 檢查健康狀態
    axios.get(`${API_URL}/health`)
      .then(response => {
        setHealthStatus(response.data.status);
      })
      .catch(error => {
        setHealthStatus('Error');
        console.error('Health check error:', error);
      });

    // 取得新聞列表
    axios.get(`${API_URL}/news/`)
      .then(response => {
        setNews(response.data);
        setLoading(false);
      })
      .catch(error => {
        console.error('News fetch error:', error);
        setLoading(false);
      });
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>🦞 Lobster Report</h1>
        <p>即時資訊聚合與分析系統</p>
        <p>API 狀態: {healthStatus}</p>
      </header>

      <main>
        <section>
          <h2>最新新聞</h2>
          {loading ? (
            <p>載入中...</p>
          ) : (
            <ul>
              {news.map(article => (
                <li key={article.id}>
                  <h3>{article.title}</h3>
                  <p>{article.source}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer>
        <p>© 2026 Lobster Report. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;
