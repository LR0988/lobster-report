# Vercel 環境變數設定計畫 (Environment Variable Update Plan)

## 任務目標
將 `REACT_APP_API_URL` 環境變數設定為 `https://lobster-report-backend-production.up.railway.app/`，並套用到 Vercel 的 production 環境。

## 執行步驟
1. **階段 1：分析** (已完成)
   - 確認前端目錄為 `frontend/`。
   - 確認使用的是 React 框架。
2. **階段 2：實作**
   - 進入 `frontend/` 目錄。
   - 執行 `vercel env add REACT_APP_API_URL production` 並提供指定數值。
3. **階段 3：QA**
   - 檢查 `vercel env pull` 或相關指令確認變數已寫入雲端。
4. **階段 4：發布**
   - 提交 Git 紀錄並推送至 GitHub。

## 預計受影響範圍
- Vercel 部署設定 (雲端環境變數)。
- 無直接檔案程式碼修改，但會記錄於 Git commit 中以觸發部署。
