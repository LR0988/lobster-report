import json
import os
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from jose import JWTError, jwt

from .. import models, schemas
from ..config import SECRET_KEY, ALGORITHM
from ..database import get_db

router = APIRouter(prefix="/api/taiwan_titan", tags=["taiwan_titan"])

# 預設台股泰坦持股部位 (70% 王者 + 15% 雙衛星)
DEFAULT_TAIWAN_POSITIONS = [
    {
        "id": "pos_tw_2408",
        "stock_id": "2408",
        "stock_name": "南亞科",
        "role": "👑 王者泰坦 (70%)",
        "shares": 1000,
        "entry_price": 550.0,
        "current_price": 527.0,
        "entry_date": "2026-10-01",
        "entry_fee": 783,
        "stop_loss_price": 498.0,
        "stop_condition": "5MA拉回進場 · 破60MA季線($498.0)停損"
    },
    {
        "id": "pos_tw_8069",
        "stock_id": "8069",
        "stock_name": "元太",
        "role": "🚀 革命衛星 (15%)",
        "shares": 500,
        "entry_price": 225.0,
        "current_price": 149.0,
        "entry_date": "2026-10-01",
        "entry_fee": 160,
        "stop_loss_price": 205.0,
        "stop_condition": "動能領先突破 · 破60MA季線($205.0)停損"
    },
    {
        "id": "pos_tw_3037",
        "stock_id": "3037",
        "stock_name": "欣興",
        "role": "🚀 革命衛星 (15%)",
        "shares": 100,
        "entry_price": 1195.0,
        "current_price": 1255.0,
        "entry_date": "2026-10-01",
        "entry_fee": 170,
        "stop_loss_price": 1026.0,
        "stop_condition": "載板龍頭主升段 · 破60MA季線($1026.0)停損"
    }
]

# 預設台股泰坦歷史交易流水帳 (以歷史流水帳為唯一真實來源)
DEFAULT_TAIWAN_TX_HISTORY = [
    {
        "id": "tx_tw_init_deposit",
        "date": "2026-10-01",
        "action": "投入現金",
        "stock_id": "-",
        "stock_name": "初始本金入金",
        "shares": 0,
        "price": 0,
        "tax_fee": 0,
        "cash_flow_twd": 1000000,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "台股王者泰坦策略 初始開倉本金"
    },
    {
        "id": "tx_tw_1",
        "date": "2026-10-01",
        "action": "買入",
        "stock_id": "2408",
        "stock_name": "南亞科",
        "shares": 1000,
        "price": 550.0,
        "tax_fee": 783,
        "cash_flow_twd": -550783,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 👑 王者泰坦 (70%)"
    },
    {
        "id": "tx_tw_2",
        "date": "2026-10-01",
        "action": "買入",
        "stock_id": "8069",
        "stock_name": "元太",
        "shares": 500,
        "price": 225.0,
        "tax_fee": 160,
        "cash_flow_twd": -112660,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 🚀 革命衛星 (15%)"
    },
    {
        "id": "tx_tw_3",
        "date": "2026-10-01",
        "action": "買入",
        "stock_id": "3037",
        "stock_name": "欣興",
        "shares": 100,
        "price": 1195.0,
        "tax_fee": 170,
        "cash_flow_twd": -119670,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 🚀 革命衛星 (15%)"
    }
]

def resolve_username(
    authorization: Optional[str] = Header(None),
    username_param: Optional[str] = Query(None, alias="username")
) -> str:
    """
    從 JWT Token 或離線 Token 或 query 參數中解析出真實使用者名稱
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        if token.startswith("offline_token_"):
            parts = token.split("_")
            if len(parts) >= 3:
                return parts[2]
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            sub = payload.get("sub")
            if sub:
                return sub
        except JWTError:
            pass

    if username_param and username_param.strip():
        return username_param.strip()

    return "guest"

# 取得台股泰坦持股清單與大盤狀態
@router.get("/dashboard")
def get_taiwan_titan_dashboard():
    json_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "frontend", "src", "data", "titan_open_positions.json"
    )
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"status": "ok", "message": "預設台股泰坦數據"}

# 取得特定使用者之個人化台股持股與交易流水帳 (雲端同步讀取)
@router.get("/portfolio", response_model=schemas.TaiwanTitanPortfolioResponse)
def get_user_taiwan_portfolio(
    authorization: Optional[str] = Header(None),
    username: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    target_user = resolve_username(authorization, username)

    record = db.query(models.UserTaiwanTitanPortfolio).filter(
        models.UserTaiwanTitanPortfolio.username == target_user
    ).first()

    if not record:
        user_obj = db.query(models.User).filter(models.User.username == target_user).first()
        record = models.UserTaiwanTitanPortfolio(
            username=target_user,
            user_id=user_obj.id if user_obj else None,
            positions=json.dumps(DEFAULT_TAIWAN_POSITIONS, ensure_ascii=False),
            tx_history=json.dumps(DEFAULT_TAIWAN_TX_HISTORY, ensure_ascii=False),
            dismissed_suggestions=json.dumps([], ensure_ascii=False)
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    try:
        positions_list = json.loads(record.positions)
    except Exception:
        positions_list = DEFAULT_TAIWAN_POSITIONS

    try:
        tx_list = json.loads(record.tx_history)
    except Exception:
        tx_list = DEFAULT_TAIWAN_TX_HISTORY

    try:
        sugg_list = json.loads(record.dismissed_suggestions)
    except Exception:
        sugg_list = []

    return {
        "status": "ok",
        "username": record.username,
        "positions": positions_list,
        "tx_history": tx_list,
        "dismissed_suggestions": sugg_list,
        "updated_at": record.updated_at
    }

# 儲存特定使用者之個人化台股持股與交易流水帳 (雲端同步寫入)
@router.post("/portfolio")
def save_user_taiwan_portfolio(
    payload: schemas.TaiwanTitanPortfolioSaveRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    target_user = payload.username or resolve_username(authorization, None)
    if not target_user or target_user == "guest":
        if payload.username:
            target_user = payload.username

    record = db.query(models.UserTaiwanTitanPortfolio).filter(
        models.UserTaiwanTitanPortfolio.username == target_user
    ).first()

    pos_str = json.dumps(payload.positions, ensure_ascii=False)
    tx_str = json.dumps(payload.tx_history, ensure_ascii=False)
    sugg_str = json.dumps(payload.dismissed_suggestions or [], ensure_ascii=False)

    if record:
        record.positions = pos_str
        record.tx_history = tx_str
        record.dismissed_suggestions = sugg_str
        record.updated_at = func.now()
    else:
        user_obj = db.query(models.User).filter(models.User.username == target_user).first()
        record = models.UserTaiwanTitanPortfolio(
            username=target_user,
            user_id=user_obj.id if user_obj else None,
            positions=pos_str,
            tx_history=tx_str,
            dismissed_suggestions=sugg_str
        )
        db.add(record)

    db.commit()
    db.refresh(record)

    return {
        "status": "ok",
        "message": "台股泰坦雲端帳本儲存成功",
        "username": target_user,
        "updated_at": record.updated_at
    }
