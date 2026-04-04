from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

# 新聞文章模型
class NewsArticle(Base):
    __tablename__ = "news_articles"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    source = Column(String(100))  # 新聞來源
    url = Column(String(500))
    published_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

# 財務報告模型
class FinancialReport(Base):
    __tablename__ = "financial_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String(200), nullable=False)
    report_type = Column(String(50))  # 季報/年報
    period = Column(String(20))  # 期間
    revenue = Column(String(50))  # 營收
    profit = Column(String(50))  # 利潤
    eps = Column(String(20))  # 每股盈餘
    source_url = Column(String(500))
    published_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 論壇貼文模型
class ForumPost(Base):
    __tablename__ = "forum_posts"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    forum_name = Column(String(50))  # PTT, Dcard, Reddit
    author = Column(String(100))
    url = Column(String(500))
    reply_count = Column(Integer, default=0)
    published_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 世界局勢事件模型
class WorldEvent(Base):
    __tablename__ = "world_events"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    category = Column(String(50))  # 地緣政治, 經濟, 軍事
    region = Column(String(100))  # 地區
    source_url = Column(String(500))
    published_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 分析結果模型
class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    
    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String(50))  # news, financial, forum, world
    source_id = Column(Integer)
    sentiment = Column(String(20))  # positive, negative, neutral
    sentiment_score = Column(Integer)  # 0-100
    keywords = Column(String(500))  # 關鍵字 (逗號分隔)
    summary = Column(Text)  # 摘要
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# 警報模型
class Alert(Base):
    __tablename__ = "alerts"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text)
    alert_type = Column(String(50))  # news, financial, world
    severity = Column(String(20))  # low, medium, high, critical
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
