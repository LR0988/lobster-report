import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# 從環境變數取得資料庫 URL
DATABASE_URL = os.getenv("DATABASE_URL")

# 如果沒有設定 DATABASE_URL，使用 Railway 預設值
if not DATABASE_URL:
    # 使用 Railway PostgreSQL 連線字串
    DATABASE_URL = "postgresql://postgres:fagsfAayXKEmLgqxKNXzErFSTMIEDvDi@postgres.railway.internal:5432/railway"

print(f"DATABASE_URL: {DATABASE_URL}")  # 除錯用

# 建立資料庫引擎
engine = create_engine(DATABASE_URL)

# 建立 Session 工廠
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 建立 Base 類別
Base = declarative_base()

# 依賴注入函數
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
