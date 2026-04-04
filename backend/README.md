# Lobster Report Backend

這是一個 FastAPI 後端服務，提供 Lobster Report 的 API。

## 專案資訊

- **專案名稱：** lobster-report-backend
- **部署平台：** Railway
- **網址：** https://lobster-report-backend.up.railway.app

## API 端點

- `GET /` - 首頁
- `GET /health` - 健康檢查
- `GET /news/` - 新聞列表
- `GET /financial/` - 財務報告列表
- `GET /forum/` - 論壇貼文列表
- `GET /world/` - 世界局勢事件列表
- `GET /dashboard/` - 儀表板資料
- `GET /alerts/` - 警報列表

## 環境變數

- `DATABASE_URL` - 資料庫連線字串
- `SECRET_KEY` - 安全性金鑰
