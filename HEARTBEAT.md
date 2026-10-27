# HEARTBEAT.md - 泰坦系統自動化健康檢查與調倉巡檢清單

1. 執行 `python3 run_daily_automation.py --check-only` 檢視系統核心健康度。
2. 檢查模組 C 2.0 (DCF 股債折現過熱閥門：QQQ 2年線乖離 >= 30% 且 US10Y >= 3.5%) 是否有異常警示。
3. 檢視距離下次雙梯隊定期調倉窗口（每月 1 號 A 梯隊 / 每月 22 號 B 梯隊）剩餘天數。
4. 若無緊急異常或換倉訊號，回覆 `HEARTBEAT_OK`。
