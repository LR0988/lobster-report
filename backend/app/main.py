from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine
from app import models
from app.routers import news, financial, forum, world, dashboard, alerts
from app.config import DEBUG

# 建立資料表
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Lobster Report API",
    version="1.0.0",
    debug=DEBUG
)

# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含路由
app.include_router(news.router)
app.include_router(financial.router)
app.include_router(forum.router)
app.include_router(world.router)
app.include_router(dashboard.router)
app.include_router(alerts.router)

@app.get("/")
def read_root():
    return {"message": "Lobster Report API is running", "status": "ok"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
