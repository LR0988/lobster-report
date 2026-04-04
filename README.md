# Lobster Report (原蝦報)

一個即時資訊聚合與分析系統，專注於新聞、財報、世界局勢與網路論壇討論的快速分析。

## 專案結構

- **backend/** - 後端 API (FastAPI)
- **frontend/** - 前端介面 (React)
- **database/** - 資料庫設定

## 部署資訊

### 後端 (Railway)
- **專案名稱：** lobster-report-backend
- **網址：** https://lobster-report-backend.up.railway.app

### 前端 (Vercel)
- **專案名稱：** lobster-report
- **網址：** https://lobster-report.vercel.app

### 資料庫 (Railway)
- **專案名稱：** lobster-report (PostgreSQL)

## API 端點

- `GET /` - 首頁
- `GET /health` - 健康檢查
- `GET /news/` - 新聞列表
- `GET /financial/` - 財務報告列表
- `GET /forum/` - 論壇貼文列表
- `GET /world/` - 世界局勢事件列表
- `GET /dashboard/` - 儀表板資料
- `GET /alerts/` - 警報列表

## 開發環境

### 前置需求
- Python 3.11+
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL
- Redis

### 快速開始
```bash
# 啟動後端
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 啟動前端
cd ../frontend
npm install
npm run dev

# 啟動資料庫
docker-compose up -d
```

## 技術棧

### 後端
- Python 3.11
- FastAPI
- PostgreSQL
- Redis
- Celery

### 前端
- React 18
- TypeScript
- Tailwind CSS
- Chart.js

### 部署
- Railway (後端)
- Vercel (前端)
- Docker

---

*專案建立時間：2026-04-04*
*負責人：法蘭克 + Claw 🦞*
