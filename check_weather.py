import urllib.request
import json
import os

# 使用 OpenWeatherMap 的 API
# 由於我沒有您的 API Key，我先檢查環境變數是否有設置
def get_weather(city):
    api_key = os.getenv("OPENWEATHER_API_KEY")
    if not api_key:
        # 如果沒有設定環境變數，回傳模擬資料並提示
        print("未設定 OPENWEATHER_API_KEY 環境變數，使用模擬資料。")
        return {"city": city, "temperature": "25°C", "condition": "Sunny (Simulated)"}

    # 嘗試呼叫真實 API
    url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={api_key}&units=metric"
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            return {
                "city": city,
                "temperature": f"{data['main']['temp']}°C",
                "condition": data['weather'][0]['description']
            }
    except Exception as e:
        return {"city": city, "temperature": "N/A", "condition": f"Error: {str(e)}"}

if __name__ == "__main__":
    city = "Taipei"
    weather = get_weather(city)
    print(f"Weather in {weather['city']}: {weather['temperature']}, {weather['condition']}")
