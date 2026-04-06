# --- 設定區 ---
import os
import subprocess
import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, ContextTypes, CommandHandler, MessageHandler, filters

# --- 設定區 ---
TOKEN = "8663304968:AAG1Fwdd5OiZiCOp0f88xHfowZWAIwGPJk0" # 記得換成你的 Token

GOOSE_BIN_PATHS = [
    "/Applications/Goose.app/Contents/Resources/bin/goose",
    "/opt/homebrew/bin/goose",
    "/usr/local/bin/goose"
]

chat_history = []

logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)

def get_goose_path():
    for path in GOOSE_BIN_PATHS:
        if os.path.exists(path):
            return path
    return None

# --- 核心安全發送函式 ---
async def safe_reply(update: Update, text: str):
    """安全發送機制：超過 4000 字自動轉成檔案傳送，徹底解決長度限制"""
    if not text:
        return
        
    if len(text) <= 4000:
        await update.message.reply_text(text)
    else:
        # 字數爆表，轉存成檔案
        file_path = "goose_long_report.md"
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text)
        
        await update.message.reply_document(
            document=open(file_path, "rb"),
            filename="Goose_超長回報.md",
            caption="⚠️ 報告內容超過 Telegram 字數限制，已自動幫您整理成 Markdown 檔案！"
        )

# --- 處理一般對話 (有記憶) ---
async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global chat_history
    user_text = update.message.text
    goose_path = get_goose_path()

    if not goose_path:
        await safe_reply(update, "🚨 找不到 Goose 執行檔！")
        return

    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")

    chat_history.append(f"User: {user_text}")
    recent_history = "\n".join(chat_history[-10:])

    system_prompt = (
        "你是一個具備本機操作權限的 AI 開發代理人。以下是我們最近的對話紀錄，"
        "請根據上下文回答我最後的問題。使用繁體中文回答。\n"
        "---對話紀錄開始---\n"
        f"{recent_history}\n"
        "---對話紀錄結束---\n\n"
        "請直接執行必要任務並回覆："
    )

    await update.message.reply_text("⏳ Goose 正在處理中...")

    try:
        process = subprocess.run(
            [goose_path, "run", "--text", system_prompt],
            capture_output=True,
            text=True,
            env=env,
            timeout=120
        )

        if process.stdout:
            chat_history.append(f"Goose: {process.stdout}")
            # 關鍵修改：改用 safe_reply
            await safe_reply(update, process.stdout)
            
        if process.stderr:
            logging.error(f"Goose Error: {process.stderr}")

    except Exception as e:
        await safe_reply(update, f"❌ 錯誤: {str(e)}")

# --- 處理多角色團隊配方 /team ---
async def team_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_task = " ".join(context.args)
    if not user_task:
        await safe_reply(update, "請在指令後加上需求！例如：/team 幫我寫一個計算 BMI 的程式")
        return

    goose_path = get_goose_path()
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + env.get("PATH", "")

    recipe_path = "team_recipe.md"
    if not os.path.exists(recipe_path):
        await safe_reply(update, "🚨 找不到 team_recipe.md！請先在同一個資料夾建立這個配方檔案。")
        return

    with open(recipe_path, "r", encoding="utf-8") as f:
        recipe_content = f.read()

    prompt = f"{recipe_content}\n\n--- 目前的最新需求 ---\n{user_task}"

    await update.message.reply_text("🚀 團隊已啟動！正在進行：規劃 -> 實作 -> 測試，這可能需要幾分鐘...")

    try:
        process = subprocess.run(
            [goose_path, "run", "--text", prompt],
            capture_output=True,
            text=True,
            env=env,
            timeout=300
        )

        if process.stdout:
            # 關鍵修改：改用 safe_reply，再長都不怕
            await safe_reply(update, f"🏁 團隊回報：\n\n{process.stdout}")
            
        if process.stderr:
            logging.error(f"Goose Error: {process.stderr}")

    except Exception as e:
        await safe_reply(update, f"❌ 錯誤: {str(e)}")

async def clear_memory(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global chat_history
    chat_history = []
    await update.message.reply_text("🧹 記憶已清除！")

if __name__ == '__main__':
    if not get_goose_path():
        print("🚨 啟動失敗：找不到 Goose 執行檔。")
    else:
        app = ApplicationBuilder().token(TOKEN).build()
        
        app.add_handler(CommandHandler("clear", clear_memory))
        app.add_handler(CommandHandler("team", team_command))
        app.add_handler(MessageHandler(filters.TEXT & (~filters.COMMAND), handle_message))
        
        print("🚀 Telegram Goose Bot 已啟動...")
        app.run_polling()
