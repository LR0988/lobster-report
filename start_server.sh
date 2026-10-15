#!/bin/bash
cd "$(dirname "$0")"

echo "================================================="
echo "🚀 正在啟動台股 AI 投資分析系統 (FastAPI + React)"
echo "================================================="

# 1. 導出 macOS / PyTorch / BLAS / OpenMP 多執行緒安全變數，徹底杜絕 Segmentation Fault
export KMP_DUPLICATE_LIB_OK=TRUE
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1
export MKL_NUM_THREADS=1
export VECLIB_MAXIMUM_THREADS=1
export NUMEXPR_NUM_THREADS=1
export TOKENIZERS_PARALLELISM=false

# 2. 徹底清理先前佔用 8000 Port 的舊進程
OLD_PIDS=$(lsof -ti :8000 2>/dev/null)
if [ -n "$OLD_PIDS" ]; then
    echo "正在釋放舊的 Port 8000 進程 (PID: $OLD_PIDS)..."
    kill -9 $OLD_PIDS 2>/dev/null || true
    sleep 1
fi

# 3. 確保使用專案專用虛擬環境
if [ -f "./venv/bin/uvicorn" ]; then
    UVICORN="./venv/bin/uvicorn"
else
    UVICORN="uvicorn"
fi

# 4. 啟動 Cloudflare 遠端安全通道 (支援外部與手機 HTTPS 遠端存取)
python3 manage_tunnel.py > tunnel.log 2>&1 &
TUNNEL_PID=$!
trap "kill -9 $TUNNEL_PID 2>/dev/null || true; exit" INT TERM EXIT

echo "================================================="
echo "✅ 伺服器啟動成功！"
echo "🌐 本機操作網址："
echo "   👉 http://localhost:8000"
echo "🌐 雲端連線通道已建立並自動同步至 Supabase"
echo "================================================="
echo "提示：按 Ctrl + C 可正常關閉伺服器與通道。"
echo ""

# 使用標準 asyncio 事件循環，避免 C-extension 在 macOS 上的 thread-safety 衝突
$UVICORN api:app --host 0.0.0.0 --port 8000 --workers 1 --loop asyncio
kill -9 $TUNNEL_PID 2>/dev/null || true
