import React, { useState } from 'react';

const StockFilter = ({ onApplyFilter }) => {
  const [symbol, setSymbol] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onApplyFilter({ symbol, startDate, endDate });
  };

  // Calculate default end date as today
  const today = new Date();
  const defaultEndDate = today.toISOString().split('T')[0];

  // Calculate default start date as 3 months ago
  const threeMonthsAgo = new Date(today.setMonth(today.getMonth() - 3));
  const defaultStartDate = threeMonthsAgo.toISOString().split('T')[0];

  return (
    <div className="stock-filter-container">
      <form onSubmit={handleSubmit} className="stock-filter-form">
        <div className="form-group">
          <label htmlFor="symbol">股票代碼 (e.g., 2330.TW):</label>
          <input
            type="text"
            id="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="例如: 2330.TW"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="startDate">開始日期:</label>
          <input
            type="date"
            id="startDate"
            value={startDate || defaultStartDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="endDate">結束日期:</label>
          <input
            type="date"
            id="endDate"
            value={endDate || defaultEndDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="submit-button">
          查詢股票資料
        </button>
      </form>
    </div>
  );
};

export default StockFilter;