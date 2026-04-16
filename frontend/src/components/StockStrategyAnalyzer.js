import React, { useState } from 'react';

const StockStrategyAnalyzer = ({ stockData, onAnalyze }) => {
  const [strategy, setStrategy] = useState('volume_ma_up'); // Default strategy

  const strategies = [
    { value: 'volume_ma_up', label: '成交量放大 & 均線向上' },
    // Add more strategies here
  ];

  const handleAnalyze = () => {
    if (stockData && stockData.length > 0) {
      let result = {};
      switch (strategy) {
        case 'volume_ma_up':
          result = analyzeVolumeAndMA(stockData);
          break;
        default:
          result = { description: '請選擇一個策略來分析', recommendation: '' };
      }
      onAnalyze(result);
    } else {
      onAnalyze({ description: '沒有足夠的股票資料進行分析', recommendation: '' });
    }
  };

  // Example strategy: Volume Amplification and Upward Moving Average
  const analyzeVolumeAndMA = (data) => {
    // This is a simplified example. Real MA calculation needs more data points.
    if (data.length < 5) { // Need at least 5 days for a basic MA
      return { description: '資料點不足以分析均線', recommendation: '' };
    }

    const latestData = data[data.length - 1];
    const previousData = data[data.length - 2];

    // Check for volume increase (simplified: latest volume > previous volume)
    const volumeIncreased = latestData.volume > previousData.volume;

    // Check for upward moving average (simplified: latest price > average of last 3 days)
    const prices = data.slice(-3).map(item => item.price);
    const sumPrices = prices.reduce((sum, price) => sum + price, 0);
    const movingAverage = sumPrices / prices.length;
    const maUp = latestData.price > movingAverage;

    let recommendation = '觀望';
    if (volumeIncreased && maUp) {
      recommendation = '買入訊號: 成交量放大且均線向上';
    } else if (volumeIncreased) {
      recommendation = '留意: 成交量放大';
    } else if (maUp) {
      recommendation = '趨勢向上: 均線向上';
    }

    return {
      description: `策略分析: 成交量放大 & 均線向上 (${strategy})`,
      recommendation: recommendation,
      details: {
        latestVolume: latestData.volume,
        previousVolume: previousData.volume,
        volumeIncreased: volumeIncreased,
        latestPrice: latestData.price,
        movingAverage: movingAverage.toFixed(2),
        maUp: maUp,
      }
    };
  };

  return (
    <div className="stock-strategy-analyzer-container">
      <div className="form-group">
        <label htmlFor="strategy-select">選擇分析策略:</label>
        <select
          id="strategy-select"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className="strategy-select"
        >
          {strategies.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <button onClick={handleAnalyze} className="submit-button">
        執行策略分析
      </button>
    </div>
  );
};

export default StockStrategyAnalyzer;