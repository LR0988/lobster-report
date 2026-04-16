import React from 'react';

const StockChart = ({ data }) => {
  if (!data || data.length === 0) {
    return <p>無股票圖表資料</p>;
  }

  // In a real application, you would use a charting library here (e.g., Chart.js, Recharts)
  // For now, it's a simple representation.
  return (
    <div className="stock-chart">
      <h4>股價走勢圖</h4>
      <p>這裡將顯示股價與成交量圖表</p>
      <div className="chart-placeholder" style={{ height: '200px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span>圖表內容 (示意)</span>
      </div>
      {/* You might want to display some key data points here as well */}
      <div className="chart-summary">
        <p>最新價格: {data[data.length - 1].price}</p>
        <p>最新成交量: {data[data.length - 1].volume}</p>
      </div>
    </div>
  );
};

export default StockChart;