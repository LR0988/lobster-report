from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/alerts", tags=["alerts"])

@router.get("/", response_model=List[schemas.Alert])
def read_alerts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    取得警報列表
    """
    alerts = db.query(models.Alert).offset(skip).limit(limit).all()
    return alerts

@router.get("/{alert_id}", response_model=schemas.Alert)
def read_alert(alert_id: int, db: Session = Depends(get_db)):
    """
    取得單則警報
    """
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert

@router.post("/", response_model=schemas.Alert)
def create_alert(alert: schemas.AlertCreate, db: Session = Depends(get_db)):
    """
    建立警報
    """
    db_alert = models.Alert(**alert.dict())
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert

@router.put("/{alert_id}/read")
def mark_as_read(alert_id: int, db: Session = Depends(get_db)):
    """
    標記警報為已讀
    """
    alert = db.query(models.Alert).filter(models.Alert.id == alert_id).first()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert.is_read = True
    db.commit()
    return {"message": "Alert marked as read", "status": "ok"}
