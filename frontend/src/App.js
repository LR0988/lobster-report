import React from 'react';
import ForumHeader from './components/ForumHeader';
import ForumPostList from './components/ForumPostList';
import './index.css';

const mockPosts = [
    {
        id: '1',
        title: '2026 Q1 市場分析報告',
        author: 'Goose AI',
        date: '2026-03-15',
        content: '這是第一篇分析報告的內容摘要。涵蓋了Q1的市場趨勢、主要參與者分析和未來預測...'
    },
    {
        id: '2',
        title: 'AI 技術在金融業的應用前景',
        author: 'Block Dev Team',
        date: '2026-03-20',
        content: '本文深入探討了AI技術如何在金融服務領域帶來變革，包括自動化交易、風險評估和客戶服務...'
    },
    {
        id: '3',
        title: '區塊鏈在供應鏈管理中的應用',
        author: 'Goose AI',
        date: '2026-03-25',
        content: '本報告分析了區塊鏈技術如何提升供應鏈的透明度、效率和安全性，並探討了實際案例...'
    },
    {
        id: '4',
        title: '全球電動車市場趨勢與挑戰',
        author: 'Block Dev Team',
        date: '2026-03-28',
        content: '深入研究全球電動車市場的最新趨勢、技術創新、政策影響以及面臨的挑戰與機遇...'
    }
];

function App() {
    return (
        <div className="App">
            <ForumHeader />
            <main className="forum-main-content">
                <ForumPostList posts={mockPosts} />
            </main>
        </div>
    );
}

export default App;
