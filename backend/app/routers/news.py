from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/news", tags=["news"])

@router.get("/", response_model=List[schemas.NewsArticle])
def read_news(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    取得新聞列表
    """
    news = db.query(models.NewsArticle).offset(skip).limit(limit).all()
    return news

@router.get("/{news_id}", response_model=schemas.NewsArticle)
def read_news(news_id: int, db: Session = Depends(get_db)):
    """
    取得單則新聞
    """
    news = db.query(models.NewsArticle).filter(models.NewsArticle.id == news_id).first()
    if news is None:
        raise HTTPException(status_code=404, detail="News not found")
    return news

@router.post("/", response_model=schemas.NewsArticle)
def create_news(news: schemas.NewsArticleCreate, db: Session = Depends(get_db)):
    """
    建立新聞
    """
    db_news = models.NewsArticle(**news.dict())
    db.add(db_news)
    db.commit()
    db.refresh(db_news)
    return db_news

@router.post("/search", response_model=List[schemas.NewsArticle])
def search_news(keyword: str, skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    """
    搜尋新聞
    """
    news = db.query(models.NewsArticle).filter(
        models.NewsArticle.title.contains(keyword) |
        models.NewsArticle.content.contains(keyword)
    ).offset(skip).limit(limit).all()
    return news
