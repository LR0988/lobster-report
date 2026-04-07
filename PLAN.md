# PLAN.md - Frontend Web Team: Forum Format Revamp

This plan outlines the modifications required to transform the existing Vercel-deployed frontend into a forum-like format specifically for analysis reports.

## Phase 1: Project Analysis & UI Planning (Completed)

*   **Existing Frontend Framework:** React (detected via `frontend/package.json`, `frontend/src/App.js`, `frontend/src/index.js`)
*   **Styling System:** Plain CSS (detected via `frontend/src/index.css`)
*   **Deployment:** Vercel (detected via `frontend/vercel.json`)

## Phase 2: Frontend Implementation

### Modified Files:

*   **`frontend/src/App.js`**:
    *   Will be refactored to serve as the main container for the forum layout.
    *   Will import and render `ForumHeader` and `ForumPostList` components.
    *   Will manage mock data for forum posts (initially) or integrate with a potential backend API later.
*   **`frontend/src/index.css`**:
    *   Will be updated to include global styles for the new forum components (e.g., card styles for posts, header styling, basic layout adjustments).
    *   All new styles will aim to maintain visual consistency with the existing site's aesthetic (assumed to be clean and minimal).

### New Components:

The following new React components will be created within the `frontend/src/components/` directory:

*   **`frontend/src/components/ForumHeader.js`**:
    *   A functional component responsible for rendering the forum's title (e.g., "分析報告論壇").
    *   May include basic navigation elements if needed in the future.
*   **`frontend/src/components/ForumPost.js`**:
    *   A functional component to display a single analysis report (forum post).
    *   Will receive `post` data (title, author, date, content) as props.
    *   Will render the post's title, author, date, and content in a structured, readable format.
*   **`frontend/src/components/ForumPostList.js`**:
    *   A functional component that takes an array of `posts` as props.
    *   Will map over the `posts` array and render a `ForumPost` component for each item.
    *   Responsible for the overall layout of the list of posts.

### Data Structure (Mock Data for Development):

Initially, mock data will be used to populate the forum posts. This data will be structured as an array of objects, with each object representing a post:

```javascript
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
    // More mock posts can be added here
];
```

### Routing:

*   The forum will be rendered at the root path (`/`).
*   Existing routing will be preserved. No new routes are explicitly defined in this phase unless required by the existing application structure (e.g., if `App.js` already uses React Router, it will be adapted).

## Phase 3: QA Testing & Debugging

*   Automated checks for syntax, unclosed tags, undefined variables.
*   Automated checks for non-existent dependency imports.
*   Automatic error correction (max 2 retries).

## Phase 4: Git Auto-publishing to Vercel

*   `git status`
*   `git add .`
*   `git commit -m "Web Team: 前端介面更新與功能實作"`
*   `git push origin master`
*   Final report to user.
