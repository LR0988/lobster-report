from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/financial", tags=["financial"])

@router.get("/", response_model=List[schemas.FinancialReport])
def read_financial_reports(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    取得財務報告列表
    """
    reports = db.query(models.FinancialReport).offset(skip).limit(limit).all()
    return reports

@router.get("/{report_id}", response_model=schemas.FinancialReport)
def read_financial_report(report_id: int, db: Session = Depends(get_db)):
    """
    取得單筆財務報告
    """
    report = db.query(models.FinancialReport).filter(models.FinancialReport.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=404, detail="Financial report not found")
    return report

@router.post("/", response_model=schemas.FinancialReport)
def create_financial_report(report: schemas.FinancialReportCreate, db: Session = Depends(get_db)):
    """
    建立財務報告
    """
    db_report = models.FinancialReport(**report.dict())
    db.add(db_report)
    db.commit()
    db.refresh(db_report)
    return db_report
