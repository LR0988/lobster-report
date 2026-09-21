import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from dotenv import load_dotenv

load_dotenv()

# 從環境變數取得資料庫 URL
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise ValueError("環境變數 DATABASE_URL 未設定，請在 .env 或環境變數中設定 PostgreSQL 連線字串。")

# 遮蔽密碼以利安全除錯
def mask_db_url(url: str) -> str:
    if "@" in url:
        part1, part2 = url.split("@", 1)
        if ":" in part1:
            base = part1.rsplit(":", 1)[0]
            return f"{base}:****@{part2}"
    return url

print(f"DATABASE_URL: {mask_db_url(DATABASE_URL)}")

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
