# Lobster Report - Dockerfile for Railway

FROM python:3.11-slim

# 設定工作目錄
WORKDIR /app

# 複製 backend 目錄
COPY backend /app/backend

# 設定 backend 為工作目錄
WORKDIR /app/backend

# 安裝 Python 依賴
RUN pip install --no-cache-dir -r requirements.txt

# 設定環境變數
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# 暴露埠
EXPOSE 8000

# 啟動指令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
