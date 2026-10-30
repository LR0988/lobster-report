"""
exp264_titan_sync.py (相容入口)
資料庫更新後刷新「台股因果泰坦 (上限1億)」即時層：全球泰坦邏輯 × 台股 0050∪0051 PIT。
回測區塊 (曲線/歷年績效/交易明細) 由 tw_titan_pit_backtest.py 產生；此處只更新最新持股、宏觀曝險與資料日期。
"""
import tw_titan_pit_service


def run(timeout: int = 1800) -> str:
    return tw_titan_pit_service.run()


if __name__ == "__main__":
    print(run())
