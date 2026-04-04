import os
from typing import Optional

# 資料庫設定
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://user:password@localhost:5432/lobster_report"
)

# 安全性設定
SECRET_KEY = os.getenv(
    "SECRET_KEY",
    os.getenv("APP_SECRET_KEY", "your-secret-key-here")
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# 伺服器設定
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# API 金鑰 (可選)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")

# Redis 設定
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
