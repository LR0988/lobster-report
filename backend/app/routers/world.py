from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/world", tags=["world"])

@router.get("/", response_model=List[schemas.WorldEvent])
def read_world_events(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    取得世界局勢事件列表
    """
    events = db.query(models.WorldEvent).offset(skip).limit(limit).all()
    return events

@router.get("/{event_id}", response_model=schemas.WorldEvent)
def read_world_event(event_id: int, db: Session = Depends(get_db)):
    """
    取得單則世界局勢事件
    """
    event = db.query(models.WorldEvent).filter(models.WorldEvent.id == event_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="World event not found")
    return event

@router.post("/", response_model=schemas.WorldEvent)
def create_world_event(event: schemas.WorldEventCreate, db: Session = Depends(get_db)):
    """
    建立世界局勢事件
    """
    db_event = models.WorldEvent(**event.dict())
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event
