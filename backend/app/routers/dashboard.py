from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from .. import models
from ..database import get_db

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/")
def get_dashboard_data(db: Session = Depends(get_db)):
    """
    取得儀表板資料
    """
    # 新聞數量
    news_count = db.query(func.count(models.NewsArticle.id)).scalar()
    
    # 財務報告數量
    financial_count = db.query(func.count(models.FinancialReport.id)).scalar()
    
    # 論壇貼文數量
    forum_count = db.query(func.count(models.ForumPost.id)).scalar()
    
    # 世界局勢事件數量
    world_count = db.query(func.count(models.WorldEvent.id)).scalar()
    
    # 未讀警報數量
    unread_alerts = db.query(func.count(models.Alert.id)).filter(
        models.Alert.is_read == False
    ).scalar()
    
    return {
        "stats": {
            "news": news_count,
            "financial": financial_count,
            "forum": forum_count,
            "world": world_count,
            "unread_alerts": unread_alerts
        },
        "status": "ok"
    }
