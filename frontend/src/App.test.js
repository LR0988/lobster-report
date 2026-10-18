import React from 'react';
import ReactDOMServer from 'react-dom/server';
import { BrowserRouter } from 'react-router-dom';

test('renders StockDashboard with logged in user without crashing', () => {
  const userObj = { id: 1, username: 'admin', role: 'admin' };
  const storage = {
    'auth_token': 'mock_token_123',
    'auth_user': JSON.stringify(userObj),
    'current_user': JSON.stringify(userObj),
    'active_tab': 'market_ml',
    'market_backtest_model_v2': 'global_liquid_titan_base',
    'market_operations_model_v2': 'global_liquid_titan_base',
    'market_ml_model_type': 'global_liquid_titan_base',
  };
  global.localStorage = {
    getItem: (key) => (key in storage ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => {}
  };

  const StockDashboard = require('./components/StockDashboard').default;
  const GlobalSovereignDashboard = require('./components/GlobalSovereignDashboard').default;

  console.log('Testing GlobalSovereignDashboard standalone...');
  const gsHtml = ReactDOMServer.renderToString(
    <BrowserRouter>
      <GlobalSovereignDashboard />
    </BrowserRouter>
  );
  console.log('GlobalSovereignDashboard rendered successfully, length:', gsHtml.length);

  // Test 1: market_ml tab
  console.log('Testing StockDashboard with market_ml tab...');
  storage['active_tab'] = 'market_ml';
  const mlHtml = ReactDOMServer.renderToString(
    <BrowserRouter>
      <StockDashboard />
    </BrowserRouter>
  );
  console.log('StockDashboard (market_ml) rendered successfully, length:', mlHtml.length);

  // Test 2: global_sovereign tab
  console.log('Testing StockDashboard with global_sovereign tab...');
  storage['active_tab'] = 'global_sovereign';
  const tabGsHtml = ReactDOMServer.renderToString(
    <BrowserRouter>
      <StockDashboard />
    </BrowserRouter>
  );
  console.log('StockDashboard (global_sovereign) rendered successfully, length:', tabGsHtml.length);

  // Test 3: screener tab
  console.log('Testing StockDashboard with screener tab...');
  storage['active_tab'] = 'screener';
  const screenerHtml = ReactDOMServer.renderToString(
    <BrowserRouter>
      <StockDashboard />
    </BrowserRouter>
  );
  console.log('StockDashboard (screener) rendered successfully, length:', screenerHtml.length);
});
