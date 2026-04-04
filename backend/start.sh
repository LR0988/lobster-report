#!/bin/bash

# Lobster Report Backend - Start Script

echo "Starting Lobster Report Backend..."

# 進入 backend 目錄
cd /app

# 檢查 uvicorn 是否安裝
if ! command -v uvicorn &> /dev/null; then
    echo "Installing uvicorn..."
    pip install uvicorn[standard]
fi

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
