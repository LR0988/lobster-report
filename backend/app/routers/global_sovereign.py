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

router = APIRouter(prefix="/api/global_sovereign", tags=["global_sovereign"])

# 預設持股部位範本
DEFAULT_POSITIONS = [
    {
        "id": "pos_mrna_1",
        "ticker": "MRNA",
        "name": "莫德納 (Moderna 生技巨擘)",
        "market": "美股 (NASDAQ)",
        "currency": "USD",
        "shares": 54,
        "entry_price": 186.61,
        "current_price": 225.0,
        "entry_date": "2026-10-01",
        "entry_fee": 15,
        "stop_loss_price": 126.18,
        "role": "👑 第1王者 (40%)",
        "stop_condition": "大波段抱牢，SPY破年線才清倉"
    },
    {
        "id": "pos_3037_1",
        "ticker": "3037.TW",
        "name": "欣興 (Unimicron 載板王者)",
        "market": "台股 (TWSE)",
        "currency": "TWD",
        "shares": 236,
        "entry_price": 1195.0,
        "current_price": 1255.0,
        "entry_date": "2026-10-01",
        "entry_fee": 400,
        "stop_loss_price": 1026.38,
        "role": "🥈 第2主力 (30%)",
        "stop_condition": "載板王者主升段狂飆，持滿整月"
    },
    {
        "id": "pos_3443_1",
        "ticker": "3443.TW",
        "name": "創意 (Global Unichip ASIC)",
        "market": "台股 (TWSE)",
        "currency": "TWD",
        "shares": 35,
        "entry_price": 8031.0,
        "current_price": 8100.0,
        "entry_date": "2026-10-01",
        "entry_fee": 400,
        "stop_loss_price": 5985.17,
        "role": "🥉 第3主力 (30%)",
        "stop_condition": "ASIC龍頭多頭強勁，每週一動態檢視"
    }
]

# 預設歷史交易流水帳
DEFAULT_TX_HISTORY = [
    {
        "id": "tx_init_deposit",
        "date": "2026-10-01",
        "action": "投入現金",
        "ticker": "-",
        "name": "初始本金入金",
        "currency": "TWD",
        "shares": 0,
        "price": 0,
        "tax_fee": 0,
        "cash_flow_twd": 1000000,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "全球泰坦旗艦策略 初始開倉本金"
    },
    {
        "id": "tx_init_1",
        "date": "2026-10-01",
        "action": "買入",
        "ticker": "MRNA",
        "name": "莫德納 (Moderna)",
        "currency": "USD",
        "shares": 54,
        "price": 186.61,
        "tax_fee": 15,
        "cash_flow_twd": -327988,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 第1主力 (40%)"
    },
    {
        "id": "tx_init_2",
        "date": "2026-10-01",
        "action": "買入",
        "ticker": "3037.TW",
        "name": "欣興 (Unimicron)",
        "currency": "TWD",
        "shares": 236,
        "price": 1195.0,
        "tax_fee": 400,
        "cash_flow_twd": -282420,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 第2主力 (30%)"
    },
    {
        "id": "tx_init_3",
        "date": "2026-10-01",
        "action": "買入",
        "ticker": "3443.TW",
        "name": "創意 (Global Unichip)",
        "currency": "TWD",
        "shares": 35,
        "price": 8031.0,
        "tax_fee": 400,
        "cash_flow_twd": -281485,
        "realized_pnl_twd": None,
        "realized_return_pct": None,
        "note": "10月初策略建倉 第3主力 (30%)"
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
        # 1. 離線 Token 解析: offline_token_{username}_{timestamp}
        if token.startswith("offline_token_"):
            parts = token.split("_")
            if len(parts) >= 3:
                return parts[2]
        # 2. 標準 JWT 解析
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

# 取得全球主權策略總覽儀表板數據
@router.get("/dashboard")
def get_global_sovereign_dashboard():
    # 優先從 defaultGlobalSovereignData.json 讀取最新產出
    json_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "frontend", "src", "data", "defaultGlobalSovereignData.json"
    )
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            pass
    return {"status": "ok", "message": "預設數據加載中"}

# 取得特定使用者之個人化持股與交易流水帳 (雲端同步讀取)
@router.get("/portfolio", response_model=schemas.TitanPortfolioResponse)
def get_user_portfolio(
    authorization: Optional[str] = Header(None),
    username: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    target_user = resolve_username(authorization, username)
    
    # 查詢該使用者的雲端投資組合記錄
    record = db.query(models.UserTitanPortfolio).filter(
        models.UserTitanPortfolio.username == target_user
    ).first()

    if not record:
        # 初次使用，為該使用者自動初始化專屬的雲端投資組合
        user_obj = db.query(models.User).filter(models.User.username == target_user).first()
        record = models.UserTitanPortfolio(
            username=target_user,
            user_id=user_obj.id if user_obj else None,
            positions=json.dumps(DEFAULT_POSITIONS, ensure_ascii=False),
            tx_history=json.dumps(DEFAULT_TX_HISTORY, ensure_ascii=False),
            usd_fx=32.5,
            dismissed_suggestions=json.dumps([], ensure_ascii=False)
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    try:
        positions_list = json.loads(record.positions)
    except Exception:
        positions_list = DEFAULT_POSITIONS

    try:
        tx_list = json.loads(record.tx_history)
    except Exception:
        tx_list = DEFAULT_TX_HISTORY

    try:
        sugg_list = json.loads(record.dismissed_suggestions)
    except Exception:
        sugg_list = []

    return {
        "status": "ok",
        "username": record.username,
        "positions": positions_list,
        "tx_history": tx_list,
        "usd_fx": record.usd_fx or 32.5,
        "dismissed_suggestions": sugg_list,
        "updated_at": record.updated_at
    }

# 儲存特定使用者之個人化持股與交易流水帳 (雲端同步寫入)
@router.post("/portfolio")
def save_user_portfolio(
    payload: schemas.TitanPortfolioSaveRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    target_user = payload.username or resolve_username(authorization, None)
    if not target_user or target_user == "guest":
        # 允許 guest，但如果前端有帶使用者名稱優先使用
        if payload.username:
            target_user = payload.username

    record = db.query(models.UserTitanPortfolio).filter(
        models.UserTitanPortfolio.username == target_user
    ).first()

    pos_str = json.dumps(payload.positions, ensure_ascii=False)
    tx_str = json.dumps(payload.tx_history, ensure_ascii=False)
    sugg_str = json.dumps(payload.dismissed_suggestions or [], ensure_ascii=False)
    fx_val = float(payload.usd_fx or 32.5)

    if record:
        record.positions = pos_str
        record.tx_history = tx_str
        record.usd_fx = fx_val
        record.dismissed_suggestions = sugg_str
        record.updated_at = func.now()
    else:
        user_obj = db.query(models.User).filter(models.User.username == target_user).first()
        record = models.UserTitanPortfolio(
            username=target_user,
            user_id=user_obj.id if user_obj else None,
            positions=pos_str,
            tx_history=tx_str,
            usd_fx=fx_val,
            dismissed_suggestions=sugg_str
        )
        db.add(record)

    db.commit()
    db.refresh(record)

    return {
        "status": "ok",
        "message": "雲端帳本儲存成功",
        "username": target_user,
        "updated_at": record.updated_at
    }
