import requests

def get_real_weather():
    # 使用 wttr.in 查詢台北天氣，format=j1 回傳 JSON 格式
    url = "https://wttr.in/Taipei?format=j1"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # 偵錯用：印出資料
        # print(data) 
        
        current = data['current_condition'][0]
        # 簡單一點：直接抓 temp_C 和 weatherDesc
        temp = current['temp_C']
        desc = current['weatherDesc'][0]['value']
        
        return {
            "city": "台北",
            "temperature": f"{temp}°C",
            "condition": desc
        }
    except Exception as e:
        return {"city": "台北", "temperature": "N/A", "condition": f"無法獲取資料: {str(e)}"}

if __name__ == "__main__":
    weather = get_real_weather()
    print(f"目前 {weather['city']} 的氣象資訊：")
    print(f"溫度: {weather['temperature']}")
    print(f"狀態: {weather['condition']}")
