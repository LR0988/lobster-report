from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/forum", tags=["forum"])

@router.get("/", response_model=List[schemas.ForumPost])
def read_forum_posts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    取得論壇貼文列表
    """
    posts = db.query(models.ForumPost).offset(skip).limit(limit).all()
    return posts

@router.get("/{post_id}", response_model=schemas.ForumPost)
def read_forum_post(post_id: int, db: Session = Depends(get_db)):
    """
    取得單則論壇貼文
    """
    post = db.query(models.ForumPost).filter(models.ForumPost.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Forum post not found")
    return post

@router.post("/", response_model=schemas.ForumPost)
def create_forum_post(post: schemas.ForumPostCreate, db: Session = Depends(get_db)):
    """
    建立論壇貼文
    """
    db_post = models.ForumPost(**post.dict())
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    return db_post

@router.post("/search", response_model=List[schemas.ForumPost])
def search_forum(keyword: str, skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    """
    搜尋論壇貼文
    """
    posts = db.query(models.ForumPost).filter(
        models.ForumPost.title.contains(keyword) |
        models.ForumPost.content.contains(keyword)
    ).offset(skip).limit(limit).all()
    return posts
