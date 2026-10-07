import sqlite3
import json
import requests

DB_PATH = '/Users/huanggin-chen/gemini-stock-analysis/tw_stock.db'
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# 讀取所有 channels
cursor.execute("SELECT channel_id, name, apple_url, feed_url, artwork_url, artist_name FROM podcast_channels")
channels = []
for row in cursor.fetchall():
    channels.append({
        'channel_id': str(row[0]),
        'name': row[1],
        'apple_url': row[2],
        'feed_url': row[3],
        'artwork_url': row[4],
        'artist_name': row[5]
    })

# 讀取所有 episodes
cursor.execute("""
    SELECT episode_guid, channel_id, title, pub_date, audio_url, duration, description, transcription, analysis_report, analysis_date, status 
    FROM podcast_episodes 
    ORDER BY rowid DESC
""")
episodes = []
for row in cursor.fetchall():
    episodes.append({
        'episode_guid': row[0],
        'channel_id': str(row[1]),
        'title': row[2],
        'pub_date': row[3],
        'audio_url': row[4],
        'duration': row[5],
        'description': row[6],
        'transcription': row[7] or '',
        'analysis_report': row[8] or '',
        'analysis_date': row[9] or '',
        'status': row[10]
    })
conn.close()

completed_count = sum(1 for ep in episodes if ep['status'] == 'completed')
print(f"[*] 讀取到 {len(channels)} 個頻道，共 {len(episodes)} 集 (其中 {completed_count} 集已完成分析)")

payload = {
    'channels': channels,
    'episodes': episodes
}

# 1. 寫入 frontend/src/data/defaultPodcastData.json
target_json = 'frontend/src/data/defaultPodcastData.json'
with open(target_json, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
print(f"[✓] 成功寫入前端快取: {target_json}")

# 2. 上傳至 Supabase stock_ml_cache (model_type = 'podcast_data')
SUPABASE_URL = 'https://hvequgcognhytunjjsyp.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0'

headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
}

upsert_data = [{
    'model_type': 'podcast_data',
    'payload': payload
}]

print("[*] 正在同步 Podcast 資料至 Supabase stock_ml_cache...")
resp = requests.post(
    f"{SUPABASE_URL}/rest/v1/stock_ml_cache",
    headers=headers,
    json=upsert_data,
    timeout=30
)
print(f"[*] Supabase 回應狀態: {resp.status_code}")
if resp.status_code in [200, 201, 204]:
    print("[✓] Supabase 快取同步成功！")
else:
    print(f"[!] Supabase 回應內容: {resp.text}")

