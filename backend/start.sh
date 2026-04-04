#!/bin/bash

# Lobster Report Backend - Start Script

echo "Starting Lobster Report Backend..."

# 安裝 Python 依賴（確保 uvicorn 可用）
echo "Installing Python dependencies..."
pip install -r requirements.txt

# 檢查環境變數
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is not set"
    exit 1
fi

if [ -z "$PORT" ]; then
    export PORT=8000
fi

# 啟動 FastAPI 應用
echo "Starting uvicorn server on port $PORT..."
uvicorn app.main:app --host 0.0.0.0 --port $PORT
