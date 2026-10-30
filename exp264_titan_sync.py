"""
exp264_titan_sync.py
資料庫更新後，重算「台股因果泰坦 (上限1億)」(exp_264) 並刷新前端 JSON。
以子行程執行 export_exp264_causal_titan.py (會切換到 ~/quant-lab 並載入引擎，不污染 API 行程)。
"""
import os, subprocess, sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def run(timeout: int = 1800) -> str:
    script = os.path.join(BASE_DIR, "export_exp264_causal_titan.py")
    p = subprocess.run([sys.executable, script], cwd=BASE_DIR, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout)[-600:])
    last = [l for l in p.stdout.splitlines() if l.startswith("written")]
    return last[-1] if last else "exp_264 台股因果泰坦已更新"

if __name__ == "__main__":
    print(run())
