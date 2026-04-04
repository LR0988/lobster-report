from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

# 新聞相關 Schema
class NewsArticleBase(BaseModel):
    title: str
    content: Optional[str] = None
    source: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[datetime] = None

class NewsArticleCreate(NewsArticleBase):
    pass

class NewsArticle(NewsArticleBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# 財務報告相關 Schema
class FinancialReportBase(BaseModel):
    company_name: str
    report_type: Optional[str] = None
    period: Optional[str] = None
    revenue: Optional[str] = None
    profit: Optional[str] = None
    eps: Optional[str] = None
    source_url: Optional[str] = None
    published_at: Optional[datetime] = None

class FinancialReportCreate(FinancialReportBase):
    pass

class FinancialReport(FinancialReportBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# 論壇貼文相關 Schema
class ForumPostBase(BaseModel):
    title: str
    content: Optional[str] = None
    forum_name: Optional[str] = None
    author: Optional[str] = None
    url: Optional[str] = None
    reply_count: Optional[int] = 0
    published_at: Optional[datetime] = None

class ForumPostCreate(ForumPostBase):
    pass

class ForumPost(ForumPostBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# 世界局勢相關 Schema
class WorldEventBase(BaseModel):
    title: str
    content: Optional[str] = None
    category: Optional[str] = None
    region: Optional[str] = None
    source_url: Optional[str] = None
    published_at: Optional[datetime] = None

class WorldEventCreate(WorldEventBase):
    pass

class WorldEvent(WorldEventBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# 分析結果相關 Schema
class AnalysisResultBase(BaseModel):
    source_type: str
    source_id: int
    sentiment: Optional[str] = None
    sentiment_score: Optional[int] = None
    keywords: Optional[str] = None
    summary: Optional[str] = None

class AnalysisResultCreate(AnalysisResultBase):
    pass

class AnalysisResult(AnalysisResultBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# 警報相關 Schema
class AlertBase(BaseModel):
    title: str
    content: Optional[str] = None
    alert_type: Optional[str] = None
    severity: Optional[str] = None
    is_read: Optional[bool] = False

class AlertCreate(AlertBase):
    pass

class Alert(AlertBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

# 響應 Schema
class HealthResponse(BaseModel):
    status: str

class MessageResponse(BaseModel):
    message: str
    status: str
