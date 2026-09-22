import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api';
import './StockDashboard.css';

const API_BASE = process.env.REACT_APP_STOCK_API_URL || 'http://localhost:8000';
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://hvequgcognhytunjjsyp.supabase.co';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2ZXF1Z2NvZ25oeXR1bmpqc3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5OTkxNjksImV4cCI6MjEwNTU3NTE2OX0.be_QMANHRP9avUIM5S9o-Xx20NOn0A68nBkAimet_e0';

const supabaseFetch = async (path, options = {}) => {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  return window.fetch(url, { ...options, headers });
};

const stockFetch = (url, opts) => {
  const finalUrl = (typeof url === 'string' && url.startsWith('/api')) ? `${API_BASE}${url}` : url;
  return window.fetch(finalUrl, opts);
};


// 簡單處理 **粗體**
function parseBold(text) {
  const parts = text.split('**');
  return parts.map((part, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#F3F4F6', fontWeight: 'bold' }}>{part}</strong> : part);
}

// 簡易 Markdown 渲染器元件
function MarkdownRenderer({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="markdown-body" style={{ lineHeight: '1.6', fontSize: '0.95rem' }}>
      {lines.map((line, idx) => {
        let cleanLine = line.trim();
        if (!cleanLine) return <div key={idx} style={{ height: '0.8rem' }} />;
        
        // 標題 1
        if (cleanLine.startsWith('# ')) {
          return <h2 key={idx} style={{ color: '#60A5FA', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.3rem', margin: '1.2rem 0 0.6rem 0' }}>{parseBold(cleanLine.substring(2))}</h2>;
        }
        // 標題 2
        if (cleanLine.startsWith('## ')) {
          return <h3 key={idx} style={{ color: '#34D399', margin: '1rem 0 0.5rem 0' }}>{parseBold(cleanLine.substring(3))}</h3>;
        }
        // 標題 3
        if (cleanLine.startsWith('### ')) {
          return <h4 key={idx} style={{ color: '#A78BFA', margin: '0.8rem 0 0.4rem 0' }}>{parseBold(cleanLine.substring(4))}</h4>;
        }
        // 列表
        if (cleanLine.startsWith('- ') || cleanLine.startsWith('* ')) {
          return <li key={idx} style={{ marginLeft: '1.2rem', marginBottom: '0.3rem', listStyleType: 'disc' }}>{parseBold(cleanLine.substring(2))}</li>;
        }
        // 一般段落
        return <p key={idx} style={{ margin: '0.4rem 0' }}>{parseBold(line)}</p>;
      })}
    </div>
  );
}

const DEFAULT_CONFIG = {
  pe_min: 0, pe_max: 1000,
  pb_min: 0, pb_max: 100,
  yield_min: 0, yield_max: 100,
  vol_min: 0, vol_max: 2000000000,
  price_trend: 0, vol_trend: 0,
  vol_surge: false, vol_surge_mult: 1.0,
  strat1: false, strat2: false,
  large_holder_min: 0, large_holder_max: 100, large_holder_inc: false,
  foreign_buy_days_min: 0, trust_buy_days_min: 0, inst_buy_days_min: 0,
};

const DEFAULT_PROMPT = `請扮演一位資深的台股產業與籌碼分析師。
我剛透過「量價突破/底部出量」的技術面篩選邏輯，挑出了 {stock_id} 這檔處於谷底上揚階段的股票。為了評估這是不是有效的起漲點，以及是否值得投入實質資金，請幫我利用你的網路搜尋功能，抓取最新的網路資訊（包括最新財報營收、法說會簡報、法人研究報告，以及 PTT 股票板、股市同學會、Threads 等論壇的最新討論與輿情），進行以下 5 個維度的深度查證與分析：
1. 族群性與產業位階考核（打群架還是單打獨鬥？同業競合狀況）
2. 基本面破底翻的「實質理由」（有最新財報數字或營收回升支撐嗎？）
3. 籌碼面動能（法人與主力近期的進出動態，大戶持股比例變化）
4. 投資價值與風控評估（預期報酬、技術防守價位）
5. 2026 2027 2028 EPS 與本益比 (FPE) 預估，並說明推論邏輯與數據來源。`;

const DEFAULT_PROMPT_TEMPLATE = `你是一位資深的台股產業與籌碼分析師。請針對以下個股進行「持股健檢」，並給予具體可行的交易策略與評估。

個股資訊:
- 股票代碼與名稱: {stock_id} {stock_name}
- 個人購入成本 (均價): {buy_price}
- 最新收盤價: {latest_price}
- 個人交易筆記: {notes}

最近 10 個交易日的股價歷史走勢 (舊到新):
{price_text}

最新每月營收與財務數據 (最新到舊):
{revenue_text}

最新 10 個交易日三大法人買賣超 (舊到新):
{inst_text}

最新集保股權分散與大戶持股比例變動 (最新到舊):
{concentration_text}

最新相關新聞與市場輿情:
{news_text}

PTT 股票板最新討論熱度與標題:
{ptt_text}

股市同學會熱門討論:
{cmoney_text}

Threads 社群最新討論:
{threads_text}

請結合上述資料，以及您對市場的理解，進行以下維度的分析（請務必結合最新的財報營收與論壇討論，進行嚴謹查證與推理）：
1. **技術面與籌碼面評估**：分析近 10 天的量價關係，並結合提供的三大法人買賣超、集保大戶持股變化，說明目前籌碼結構與走勢（例如：法人連續買超、大戶吃貨、散戶退場、強勢噴出等）。
2. **基本面與營收分析**：評估最新 1-6 個月的營收與 YoY 變化趨勢，說明基本面是否有落底翻揚或持續高成長的實質理由。
3. **新聞與論壇輿情分析**：簡評新聞對股價的正面或負面影響，並分析 PTT、股市同學會與 Threads 論壇的討論熱度、市場氣氛以及是否有小道消息（說明股民是處於「緊張/恐慌」、「冷淡/理性」還是「過熱/盲目追高」狀態，以及此情緒對股價的潛在影響）。
4. **持股策略建議**：
   - 如果是「持股」（有提供購入成本），請計算目前損益狀況，給予止盈、止損或加碼的具體價位建議。
   - 如果是「追蹤股」（未提供成本），請評估目前是否為適合切入的買點，並建議分批買進的區間。
5. **最後核心評級與燈號**：請在報告開頭或結尾，**務必以獨立一行**給出這三個燈號評級之一（必須包含雙括號，例如：【燈號】: 綠燈）：
   - 【燈號】: 綠燈（繼續持有）
   - 【燈號】: 黃燈（準備賣出）
   - 【燈號】: 紅燈（立刻賣出）

請以繁體中文撰寫，語氣專業、客觀，格式精美且使用 Markdown 排版。`;

function getSignalClass(sig) {
  if (sig === '綠燈') return 'green';
  if (sig === '黃燈') return 'yellow';
  if (sig === '紅燈') return 'red';
  return 'none';
}

function getSignalLabel(sig) {
  if (sig === '綠燈') return '🟢 繼續持有';
  if (sig === '黃燈') return '🟡 準備賣出';
  if (sig === '紅燈') return '🔴 立刻賣出';
  return '⚪ 尚未診斷';
}

function RangeInput({ label, minKey, maxKey, config, setConfig, step = 1, isFloat = false }) {
  return (
    <div className="filter-row">
      <label>{label}</label>
      <div className="range-inputs">
        <input
          type="number"
          value={config[minKey]}
          step={step}
          onChange={e => setConfig(c => ({ ...c, [minKey]: isFloat ? parseFloat(e.target.value) : parseInt(e.target.value) }))}
        />
        <span>～</span>
        <input
          type="number"
          value={config[maxKey]}
          step={step}
          onChange={e => setConfig(c => ({ ...c, [maxKey]: isFloat ? parseFloat(e.target.value) : parseInt(e.target.value) }))}
        />
      </div>
    </div>
  );
}

const STORAGE_KEY = 'stock_screener_config';
const PROMPT_KEY  = 'stock_screener_prompt';

function StockDashboard() {
  const user = getCurrentUser();
  const navigate = useNavigate();
  const [screeningStatus, setScreeningStatus] = useState('');

  if (!user) {
    return (
      <div className="stock-auth-lock-card glass-panel" style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🔒</div>
        <h2 style={{ fontSize: '1.8rem', color: '#F8FAFC', marginBottom: '12px' }}>智慧選股與量化分析系統</h2>
        <p style={{ color: '#94A3B8', fontSize: '1rem', lineHeight: '1.6', marginBottom: '24px' }}>
          本功能包含完整台股歷史資料庫、機器學習波段飆股預測與智慧選股篩選。<br />
          <span style={{ color: '#F87171', fontWeight: 'bold' }}>⚠️ 本系統資料受保護，請先登入帳號後繼續瀏覽。</span>
        </p>
        <button 
          onClick={() => navigate('/login')}
          className="btn"
          style={{ background: 'linear-gradient(135deg, #4F46E5, #06B6D4)', padding: '12px 28px', fontSize: '1.1rem', borderRadius: '8px', cursor: 'pointer', border: 'none', color: '#FFF' }}
        >
          🔐 前往登入 (hotpotlu)
        </button>
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState('screener');
  const [activeDbTable, setActiveDbTable] = useState('');
  const [portfolioList, setPortfolioList] = useState([]);
  const [portfolioInput, setPortfolioInput] = useState({ stock_id: '', buy_price: '', notes: '', auto_analyze: true });
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analyzingId, setAnalyzingId] = useState(null);

  // Podcast 相關狀態
  const [podcastChannels, setPodcastChannels] = useState([]);
  const [podcastEpisodes, setPodcastEpisodes] = useState([]);
  const [podcastUrlInput, setPodcastUrlInput] = useState('');
  const [addingChannel, setAddingChannel] = useState(false);
  const [refreshingChannelId, setRefreshingChannelId] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [podcastModalTab, setPodcastModalTab] = useState('analysis'); // 'analysis' or 'transcription'
  const [batchLimits, setBatchLimits] = useState({});
  const [batchAnalyzingChannelId, setBatchAnalyzingChannelId] = useState(null);
  const [selectedPodcastChannelId, setSelectedPodcastChannelId] = useState(null);

  // 後端設定與歷史軌跡狀態
  const [serverSettings, setServerSettings] = useState({
    gemini_api_key: '',
    gemini_model: 'gemini-3.5-flash',
    analysis_prompt: '',
    telegram_bot_token: '',
    telegram_chat_id: ''
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [historyStockId, setHistoryStockId] = useState('');
  const [historyStockName, setHistoryStockName] = useState('');

  // Watchlist & Alerts 相關狀態
  const [watchlistList, setWatchlistList] = useState([]);
  const [watchlistAlerts, setWatchlistAlerts] = useState([]);
  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [editingWatchlistStock, setEditingWatchlistStock] = useState(null);
  const [watchlistModalInput, setWatchlistModalInput] = useState({
    target_price_high: '',
    target_price_low: '',
    compare_ma5: 0,
    compare_ma20: 0,
    compare_ma60: 0
  });

  // 排程相關狀態
  const [scheduleConfig, setScheduleConfig] = useState({ enabled: true, time: '06:00', scrape_daily: true, scrape_revenue: true, analyze: true });
  const [savingSchedule, setSavingSchedule] = useState(false);

  // ML 機器學習相關狀態 (支援 LocalStorage 與記憶體即時快取)
  const [mlModelType, setMlModelType] = useState(() => localStorage.getItem('ml_model_type') || 'lightgbm');
  const [allModelsStatus, setAllModelsStatus] = useState(() => {
    try {
      const saved = localStorage.getItem('ml_all_models_status');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [mlPredictionsCache, setMlPredictionsCache] = useState(() => {
    try {
      const saved = localStorage.getItem('ml_predictions_cache');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [mlStatus, setMlStatus] = useState(() => {
    try {
      const saved = localStorage.getItem('ml_all_models_status');
      const all = saved ? JSON.parse(saved) : {};
      const curType = localStorage.getItem('ml_model_type') || 'lightgbm';
      return all[curType] || null;
    } catch { return null; }
  });
  const [mlPredictions, setMlPredictions] = useState(() => {
    try {
      const saved = localStorage.getItem('ml_predictions_cache');
      const cache = saved ? JSON.parse(saved) : {};
      const curType = localStorage.getItem('ml_model_type') || 'lightgbm';
      return cache[curType] || [];
    } catch { return []; }
  });
  const [mlLoading, setMlLoading] = useState(false);
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlComputingStatus, setMlComputingStatus] = useState(''); // '' | 'computing' | 'training'

  // 持股 AI 20天勝率預測狀態
  const [portfolioMlModel, setPortfolioMlModel] = useState(() => localStorage.getItem('portfolio_ml_model') || 'lightgbm');
  const [portfolioPredictions, setPortfolioPredictions] = useState({});
  const [fetchingPortfolioMl, setFetchingPortfolioMl] = useState(false);

  // ML 客製化訓練長度與回測長度 (交易日天數)
  const [trainRatio, setTrainRatio] = useState(() => {
    const saved = localStorage.getItem('bt_train_ratio');
    return saved !== null ? parseFloat(saved) : 0.8;
  });
  const [trainDays, setTrainDays] = useState(() => {
    const saved = localStorage.getItem('bt_train_days');
    return saved !== null ? parseInt(saved) : 180;
  });
  const [testDays, setTestDays] = useState(() => {
    const saved = localStorage.getItem('bt_test_days');
    return saved !== null ? parseInt(saved) : 30;
  });

  // ML 標的過濾與排除參數 (排除6碼標的 & 股本過濾)
  const [exclude6Digit, setExclude6Digit] = useState(() => localStorage.getItem('bt_exclude_6digit') !== 'false');
  const [filterCapital, setFilterCapital] = useState(() => localStorage.getItem('bt_filter_capital') !== 'false');
  const [minCapitalBillion, setMinCapitalBillion] = useState(() => parseFloat(localStorage.getItem('bt_min_capital_billion') || '10.0'));

  // 背景任務與訓練即時監控看板狀態
  const [activeTasks, setActiveTasks] = useState([]);
  const [fetchingTasks, setFetchingTasks] = useState(false);
  const [taskTimerTick, setTaskTimerTick] = useState(0);
  const [killingTaskPid, setKillingTaskPid] = useState(null);

  // ML 預測表格排序狀態

  // ── 低頻量化交易 (Low-Frequency Quant) 狀態 ──
  const [lowFreqRollingMonths, setLowFreqRollingMonths] = useState(24);
  const [lowFreqTopN, setLowFreqTopN] = useState(30);
  const [lowFreqMarketFilter, setLowFreqMarketFilter] = useState(true);
  const [lowFreqLoading, setLowFreqLoading] = useState(false);
  const [lowFreqData, setLowFreqData] = useState(null);
  const [lowFreqSortField, setLowFreqSortField] = useState('rank');
  const [lowFreqSortOrder, setLowFreqSortOrder] = useState('asc');

  const fetchLowFreqStatus = async () => {
    try {
      // 優先從 Supabase 快取載入低頻量化報告
      const res = await supabaseFetch('/stock_ml_cache?model_type=eq.low_freq&select=payload');
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          setLowFreqData(rows[0].payload);
          return;
        }
      }
      const fallbackRes = await stockFetch('/api/low_freq/status');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        if (json.data) {
          setLowFreqData(json.data);
        } else if (json.market_status) {
          setLowFreqData(prev => ({ ...(prev || {}), market_status: json.market_status }));
        }
      }
    } catch (err) {
      console.error('取得低頻量化狀態失敗', err);
    }
  };

  const handleRunLowFreqBacktest = async () => {
    try {
      setLowFreqLoading(true);
      // 發送任務至 Supabase 佇列由本地 Mac 運算
      const createRes = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: {
            job_type: 'low_freq_backtest',
            rolling_months: parseInt(lowFreqRollingMonths),
            top_n: parseInt(lowFreqTopN),
            market_filter: lowFreqMarketFilter
          }
        })
      });
      if (createRes.ok) {
        alert('🎉 已將低頻量化回測任務發送至家裡的 Mac！本機 Worker 將於背景執行滾動回測。');
        fetchLowFreqStatus();
      } else {
        const fallbackRes = await stockFetch('/api/low_freq/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rolling_months: parseInt(lowFreqRollingMonths),
            top_n: parseInt(lowFreqTopN),
            market_filter: lowFreqMarketFilter
          })
        });
        const json = await fallbackRes.json();
        if (fallbackRes.ok && json.status === 'ok') {
          setLowFreqData(json);
          alert(`🎉 低頻量化滾動回測完成！\n年化報酬 (CAGR): ${json.metrics?.cagr}% | 最大回撤 (MDD): ${json.metrics?.mdd}% | 夏普值: ${json.metrics?.sharpe}`);
        }
      }
    } catch (err) {
      alert(`❌ 執行低頻量化回測異常: ${err.message}`);
    } finally {
      setLowFreqLoading(false);
    }
  };

  const handleLowFreqSort = (field) => {
    if (lowFreqSortField === field) {
      setLowFreqSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setLowFreqSortField(field);
      setLowFreqSortOrder('asc');
    }
  };

  const getSortedLowFreqTop30 = () => {
    if (!lowFreqData || !lowFreqData.top30_recommendations) return [];
    return [...lowFreqData.top30_recommendations].sort((a, b) => {
      let valA = a[lowFreqSortField];
      let valB = b[lowFreqSortField];
      if (valA === undefined || valA === null) valA = 0;
      if (valB === undefined || valB === null) valB = 0;

      if (typeof valA === 'string') {
        return lowFreqSortOrder === 'desc'
          ? valB.localeCompare(valA)
          : valA.localeCompare(valB);
      }
      return lowFreqSortOrder === 'desc' ? valB - valA : valA - valB;
    });
  };

  const [mlSortField, setMlSortField] = useState('net_score');
  const [mlSortOrder, setMlSortOrder] = useState('desc');

  const handleMlSort = (field) => {
    if (mlSortField === field) {
      setMlSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setMlSortField(field);
      setMlSortOrder('desc');
    }
  };

  const getSortedPredictions = () => {
    if (!mlPredictions) return [];
    return [...mlPredictions].sort((a, b) => {
      let valA = a[mlSortField];
      let valB = b[mlSortField];
      if (valA === undefined || valA === null) valA = 0;
      if (valB === undefined || valB === null) valB = 0;

      if (typeof valA === 'string') {
        return mlSortOrder === 'desc'
          ? valB.localeCompare(valA)
          : valA.localeCompare(valB);
      }
      return mlSortOrder === 'desc' ? valB - valA : valA - valB;
    });
  };

  const [btMinWinProb, setBtMinWinProb] = useState(() => {
    const saved = localStorage.getItem('bt_min_win_prob');
    return saved !== null ? parseFloat(saved) : 35;
  });
  const [btMaxDropProb, setBtMaxDropProb] = useState(() => {
    const saved = localStorage.getItem('bt_max_drop_prob');
    return saved !== null ? parseFloat(saved) : 30;
  });
  const [btStopProfit, setBtStopProfit] = useState(() => {
    const saved = localStorage.getItem('bt_stop_profit_pct');
    return saved !== null ? parseFloat(saved) : 20;
  });
  const [btStopLoss, setBtStopLoss] = useState(() => {
    const saved = localStorage.getItem('bt_stop_loss_pct');
    return saved !== null ? parseFloat(saved) : 8;
  });
  const [btHoldingDays, setBtHoldingDays] = useState(() => {
    const saved = localStorage.getItem('bt_max_holding_days');
    return saved !== null ? parseInt(saved) : 20;
  });
  const [btPortfolioSize, setBtPortfolioSize] = useState(() => {
    const saved = localStorage.getItem('bt_max_portfolio_size');
    return saved !== null ? parseInt(saved) : 5;
  });
  
  const [btExitStrategy, setBtExitStrategy] = useState(() => {
    const saved = localStorage.getItem('bt_exit_strategy');
    return saved !== null ? saved : 'fixed';
  });
  const [btTrailingActivation, setBtTrailingActivation] = useState(() => {
    const saved = localStorage.getItem('bt_trailing_activation_pct');
    return saved !== null ? parseFloat(saved) : 10.0;
  });
  const [btMarketBullFilter, setBtMarketBullFilter] = useState(() => {
    const saved = localStorage.getItem('bt_market_bull_filter');
    return saved === 'true';
  });
  
  const [btResult, setBtResult] = useState(null);
  const [btLoading, setBtLoading] = useState(false);
  const [savingBtSettings, setSavingBtSettings] = useState(false);

  const fetchBacktestSettings = async () => {
    try {
      // 優先從 Supabase stock_settings 讀取
      const res = await supabaseFetch('/stock_settings?select=key,value');
      if (res.ok) {
        const rows = await res.json();
        const data = {};
        rows.forEach(r => { data[r.key] = r.value; });
        if (data.bt_min_win_prob !== undefined) { setBtMinWinProb(parseFloat(data.bt_min_win_prob)); localStorage.setItem('bt_min_win_prob', data.bt_min_win_prob); }
        if (data.bt_max_drop_prob !== undefined) { setBtMaxDropProb(parseFloat(data.bt_max_drop_prob)); localStorage.setItem('bt_max_drop_prob', data.bt_max_drop_prob); }
        if (data.bt_stop_profit_pct !== undefined) { setBtStopProfit(parseFloat(data.bt_stop_profit_pct)); localStorage.setItem('bt_stop_profit_pct', data.bt_stop_profit_pct); }
        if (data.bt_stop_loss_pct !== undefined) { setBtStopLoss(parseFloat(data.bt_stop_loss_pct)); localStorage.setItem('bt_stop_loss_pct', data.bt_stop_loss_pct); }
        if (data.bt_max_holding_days !== undefined) { setBtHoldingDays(parseInt(data.bt_max_holding_days)); localStorage.setItem('bt_max_holding_days', data.bt_max_holding_days); }
        if (data.bt_max_portfolio_size !== undefined) { setBtPortfolioSize(parseInt(data.bt_max_portfolio_size)); localStorage.setItem('bt_max_portfolio_size', data.bt_max_portfolio_size); }
        if (data.bt_train_ratio !== undefined) { setTrainRatio(parseFloat(data.bt_train_ratio)); localStorage.setItem('bt_train_ratio', data.bt_train_ratio); }
        if (data.bt_train_days !== undefined && data.bt_train_days !== null) { setTrainDays(parseInt(data.bt_train_days)); localStorage.setItem('bt_train_days', data.bt_train_days); }
        if (data.test_days !== undefined && data.test_days !== null) { setTestDays(parseInt(data.test_days)); localStorage.setItem('bt_test_days', data.test_days); }
        if (data.bt_exit_strategy !== undefined) { setBtExitStrategy(data.bt_exit_strategy); localStorage.setItem('bt_exit_strategy', data.bt_exit_strategy); }
        if (data.bt_trailing_activation_pct !== undefined) { setBtTrailingActivation(parseFloat(data.bt_trailing_activation_pct)); localStorage.setItem('bt_trailing_activation_pct', data.bt_trailing_activation_pct); }
        if (data.bt_exclude_6digit !== undefined) { setExclude6Digit(data.bt_exclude_6digit === 'true'); localStorage.setItem('bt_exclude_6digit', data.bt_exclude_6digit); }
        if (data.bt_filter_capital !== undefined) { setFilterCapital(data.bt_filter_capital === 'true'); localStorage.setItem('bt_filter_capital', data.bt_filter_capital); }
        if (data.bt_market_bull_filter !== undefined) { setBtMarketBullFilter(data.bt_market_bull_filter === 'true'); localStorage.setItem('bt_market_bull_filter', data.bt_market_bull_filter); }
        if (data.bt_min_capital_billion !== undefined) {
          setMinCapitalBillion(parseFloat(data.bt_min_capital_billion));
          localStorage.setItem('bt_min_capital_billion', data.bt_min_capital_billion);
        }
        return;
      }
      const fallbackRes = await stockFetch('/api/ml/backtest_settings');
      if (fallbackRes.ok) {
        const data = await fallbackRes.json();
        if (data.min_win_prob !== undefined) setBtMinWinProb(data.min_win_prob);
      }
    } catch (err) {
      console.error('讀取回測設定失敗', err);
    }
  };

  const handleSaveBacktestSettings = async (showToast = true) => {
    try {
      setSavingBtSettings(true);
      const updates = [
        { key: 'bt_min_win_prob', value: String(btMinWinProb) },
        { key: 'bt_max_drop_prob', value: String(btMaxDropProb) },
        { key: 'bt_stop_profit_pct', value: String(btStopProfit) },
        { key: 'bt_stop_loss_pct', value: String(btStopLoss) },
        { key: 'bt_max_holding_days', value: String(btHoldingDays) },
        { key: 'bt_max_portfolio_size', value: String(btPortfolioSize) },
        { key: 'bt_train_ratio', value: String(trainRatio) },
        { key: 'bt_train_days', value: String(trainDays) },
        { key: 'bt_test_days', value: String(testDays) },
        { key: 'bt_exit_strategy', value: String(btExitStrategy) },
        { key: 'bt_trailing_activation_pct', value: String(btTrailingActivation) },
        { key: 'bt_exclude_6digit', value: String(exclude6Digit) },
        { key: 'bt_filter_capital', value: String(filterCapital) },
        { key: 'bt_market_bull_filter', value: String(btMarketBullFilter) },
        { key: 'bt_min_capital_billion', value: String(minCapitalBillion) }
      ];

      localStorage.setItem('bt_min_win_prob', btMinWinProb);
      localStorage.setItem('bt_max_drop_prob', btMaxDropProb);
      localStorage.setItem('bt_stop_profit_pct', btStopProfit);
      localStorage.setItem('bt_stop_loss_pct', btStopLoss);
      localStorage.setItem('bt_max_holding_days', btHoldingDays);
      localStorage.setItem('bt_max_portfolio_size', btPortfolioSize);
      localStorage.setItem('bt_train_ratio', trainRatio);
      localStorage.setItem('bt_train_days', trainDays);
      localStorage.setItem('bt_test_days', testDays);
      localStorage.setItem('bt_exit_strategy', btExitStrategy);
      localStorage.setItem('bt_trailing_activation_pct', btTrailingActivation);
      localStorage.setItem('bt_exclude_6digit', exclude6Digit);
      localStorage.setItem('bt_filter_capital', filterCapital);
      localStorage.setItem('bt_market_bull_filter', btMarketBullFilter);
      localStorage.setItem('bt_min_capital_billion', minCapitalBillion);

      await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(updates)
      });

      if (showToast) {
        alert('💾 回測與訓練參數已成功儲存至雲端資料庫！');
      }
    } catch (err) {
      console.error('儲存回測參數失敗', err);
      if (showToast) alert('已儲存至瀏覽器快取');
    } finally {
      setSavingBtSettings(false);
    }
  };

  const fetchActiveTasks = async () => {
    try {
      setFetchingTasks(true);
      const res = await supabaseFetch('/stock_screener_jobs?status=in.(pending,running)&select=id,status,config,created_at');
      if (res.ok) {
        const jobs = await res.json();
        const mapped = jobs.map(j => ({
          pid: j.id,
          name: j.config?.job_type || '選股運算',
          type: j.config?.job_type || 'screener',
          status: j.status,
          model_type: j.config?.model_type || 'lightgbm',
          start_time: j.created_at
        }));
        setActiveTasks(mapped);
        return;
      }
      const fallbackRes = await stockFetch('/api/tasks/active');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setActiveTasks(json.tasks || []);
      }
    } catch (err) {
      // 靜默處理
    } finally {
      setFetchingTasks(false);
    }
  };

  const handleKillTask = async (task) => {
    if (!confirm(`確定要立即強制終止任務「${task.name}」(PID: ${task.pid}) 嗎？`)) return;
    try {
      setKillingTaskPid(task.pid);
      const res = await stockFetch('/api/tasks/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: task.pid, model_type: task.model_type })
      });
      const json = await res.json();
      if (res.ok && json.status === 'ok') {
        alert(json.message);
        fetchActiveTasks();
        fetchMlStatusAndPredictions(mlModelType, false);
      } else {
        alert(`終止任務失敗: ${json.message || '未知錯誤'}`);
      }
    } catch (err) {
      alert(`連線終止任務失敗: ${err.message}`);
    } finally {
      setKillingTaskPid(null);
    }
  };

  const formatSecondsToDuration = (seconds) => {
    const s = Math.max(0, parseInt(seconds || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSelectModel = (val) => {
    setMlModelType(val);
    try { localStorage.setItem('ml_model_type', val); } catch {}
    if (allModelsStatus && allModelsStatus[val]) {
      setMlStatus(allModelsStatus[val]);
    }
    if (mlPredictionsCache && mlPredictionsCache[val]) {
      setMlPredictions(mlPredictionsCache[val]);
    }
    fetchMlStatusAndPredictions(val, false);
  };

  // 記錄是否正在輪詢推論計算中，避免重複觸發多個輪詢 loop
  const isPollingPredictRef = React.useRef({});

  const fetchMlStatusAndPredictions = async (overrideModelType = null, force = false) => {
    const targetType = overrideModelType || mlModelType;
    try { localStorage.setItem('ml_model_type', targetType); } catch {}

    const capParam = filterCapital ? parseFloat(minCapitalBillion) : '';
    const ex6Param = exclude6Digit;

    // 1. 若快取中已有資料，立即瞬時帶入數值，0 秒渲染不卡頓
    if (allModelsStatus && allModelsStatus[targetType]) {
      setMlStatus(allModelsStatus[targetType]);
    }
    const hasCachedPreds = mlPredictionsCache && mlPredictionsCache[targetType] && mlPredictionsCache[targetType].length > 0;
    if (hasCachedPreds && !force) {
      setMlPredictions(mlPredictionsCache[targetType]);
    } else if (!mlPredictions.length || force) {
      setMlLoading(true);
    }

    setMlRefreshing(true);
    try {
      // 優先從 Supabase stock_ml_cache 雲端讀取 (0ms 延遲)
      const [resPred, resAllStatus] = await Promise.all([
        supabaseFetch(`/stock_ml_cache?model_type=eq.${targetType}&select=payload`),
        supabaseFetch(`/stock_ml_cache?model_type=eq.status_all&select=payload`)
      ]);

      let gotData = false;

      if (resAllStatus.ok) {
        const rows = await resAllStatus.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          const statuses = rows[0].payload;
          setAllModelsStatus(statuses);
          try { localStorage.setItem('ml_all_models_status', JSON.stringify(statuses)); } catch {}
          setMlStatus(statuses[targetType] || { status: 'ready', message: '已就緒' });
        }
      }

      if (resPred.ok) {
        const rows = await resPred.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          const jsonPred = rows[0].payload;
          let predList = jsonPred.data || [];
          if (exclude6Digit) {
            predList = predList.filter(s => !s.stock_id || s.stock_id.length <= 4);
          }
          setMlPredictions(predList);
          setMlPredictionsCache(prev => {
            const next = { ...prev, [targetType]: predList };
            try { localStorage.setItem('ml_predictions_cache', JSON.stringify(next)); } catch {}
            return next;
          });
          setMlComputingStatus('');
          gotData = true;
        }
      }

      // 若雲端快取暫無，嘗試呼叫本地 FastAPI 備援
      if (!gotData) {
        const predUrl = `/api/ml/predict?model_type=${targetType}${force ? '&force=true' : ''}&min_capital_billion=${capParam}&exclude_6digit=${ex6Param}`;
        const [fallbackPred, fallbackStatus] = await Promise.all([
          stockFetch(predUrl),
          stockFetch('/api/ml/status_all')
        ]);
        if (fallbackStatus.ok) {
          const statuses = await fallbackStatus.json();
          setAllModelsStatus(statuses);
          setMlStatus(statuses[targetType] || { status: 'none', message: '尚未訓練' });
        }
        if (fallbackPred.ok) {
          const jsonPred = await fallbackPred.json();
          const predList = jsonPred.data || [];
          setMlPredictions(predList);
          setMlPredictionsCache(prev => ({ ...prev, [targetType]: predList }));
        }
      }
    } catch (err) {
      console.error('讀取 ML 狀態與預測失敗', err);
    } finally {
      setMlLoading(false);
      setMlRefreshing(false);
    }
  };

  // 載入/訓練 ML 模型（透過 Supabase 佇列派工至本機 Mac 運算）
  const handleTrainMLModel = async (forceRetrain = false, targetModelType = null) => {
    const targetType = targetModelType || mlModelType;
    try {
      setMlLoading(true);
      setMlModelType(targetType);
      const trainDaysVal = parseInt(trainDays) || 180;
      const testDaysVal = parseInt(testDays) || 30;
      const trainRatioVal = parseFloat(trainRatio) || 0.8;

      // 1. 發送任務至 Supabase 佇列由本地 Mac Worker 運算
      const createRes = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: {
            job_type: 'ml_train',
            model_type: targetType,
            train_ratio: trainRatioVal,
            train_days: trainDaysVal,
            test_days: testDaysVal,
            force_retrain: forceRetrain,
            min_capital_billion: filterCapital ? parseFloat(minCapitalBillion) : null,
            exclude_6digit: exclude6Digit
          }
        })
      });

      if (createRes.ok) {
        // 設定前端 UI 狀態為訓練中
        setAllModelsStatus(prev => ({
          ...prev,
          [targetType]: { status: 'training', message: '正在本機背景訓練中...' }
        }));
        setMlStatus({ status: 'training', message: '正在本機背景訓練中...' });
        alert(`🚀 已成功將「${targetType.toUpperCase()}」模型訓練任務下發至家裡的 Mac！\n本機 Worker 將於背景執行訓練，完成後自動更新最新指標與推薦清單。`);
        fetchActiveTasks();
        return;
      }

      // 備援：若本地 FastAPI 正在運行
      const fallbackRes = await stockFetch('/api/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_type: targetType,
          train_ratio: trainRatioVal,
          train_days: trainDaysVal,
          test_days: testDaysVal,
          force_retrain: forceRetrain,
          min_capital_billion: filterCapital ? parseFloat(minCapitalBillion) : null,
          exclude_6digit: exclude6Digit
        })
      });
      const data = await fallbackRes.json();
      if (fallbackRes.ok && data.status === 'ok') {
        alert(data.message || '模型訓練已啟動');
        fetchMlStatusAndPredictions(targetType);
      } else {
        alert(`❌ 訓練模型失敗: ${data.message || '未知錯誤'}`);
      }
    } catch (err) {
      console.error('訓練 ML 模型失敗', err);
      alert(`❌ 系統異常，訓練模型失敗: ${err.message}`);
    } finally {
      setMlLoading(false);
    }
  };

  const handleRunBacktest = async () => {
    try {
      setBtLoading(true);
      handleSaveBacktestSettings(false);

      const payload = {
        job_type: 'ml_backtest',
        model_type: mlModelType,
        min_win_prob: parseFloat(btMinWinProb),
        max_drop_prob: parseFloat(btMaxDropProb),
        stop_profit_pct: parseFloat(btStopProfit),
        stop_loss_pct: parseFloat(btStopLoss),
        max_holding_days: parseInt(btHoldingDays),
        max_portfolio_size: parseInt(btPortfolioSize),
        train_ratio: parseFloat(trainRatio),
        train_days: parseInt(trainDays),
        test_days: parseInt(testDays),
        exit_strategy: btExitStrategy,
        trailing_activation_pct: parseFloat(btTrailingActivation),
        min_capital_billion: filterCapital ? parseFloat(minCapitalBillion) : null,
        exclude_6digit: exclude6Digit,
        market_bull_filter: btMarketBullFilter
      };

      // 1. 發送回測任務至 Supabase 佇列
      const createRes = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: payload
        })
      });

      if (createRes.ok) {
        const jobList = await createRes.json();
        const jobId = jobList[0]?.id;

        if (jobId) {
          // 輪詢等待本機 Mac 計算完成
          let attempts = 0;
          const maxAttempts = 60;
          let completedJob = null;

          while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1500));
            attempts++;

            const checkRes = await supabaseFetch(`/stock_screener_jobs?id=eq.${jobId}`);
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData && checkData.length > 0) {
                const current = checkData[0];
                if (current.status === 'completed') {
                  completedJob = current;
                  break;
                } else if (current.status === 'error') {
                  throw new Error(current.error_message || '本機回測運算發生錯誤');
                }
              }
            }
          }

          if (completedJob && completedJob.results) {
            setBtResult(completedJob.results);
            const totalRet = completedJob.results.metrics?.total_return_pct ?? completedJob.results.total_return_pct ?? 0;
            const winRate = completedJob.results.metrics?.win_rate ?? completedJob.results.win_rate ?? 0;
            alert(`🎉 策略回測完成！\n累積報酬率: ${totalRet}% | 勝率: ${winRate}%`);
            return;
          }
        }
      }

      // 備援：若本地 FastAPI 正在運行
      const fallbackRes = await stockFetch('/api/ml/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await fallbackRes.json();
      if (fallbackRes.ok && json.status === 'ok') {
        setBtResult(json);
      } else {
        alert(`執行策略回測失敗: ${json.message || '未知錯誤'}`);
      }
    } catch (err) {
      alert(`執行策略回測失敗: ${err.message}`);
    } finally {
      setBtLoading(false);
    }
  };

  const handleAddWatchlistStockDirectly = async (stockId) => {
    try {
      const res = await supabaseFetch('/stock_watchlist', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ stock_id: stockId, stock_name: stockId })
      });
      if (res.ok) {
        alert(`已成功將 ${stockId} 加入追蹤與警示清單！`);
        fetchWatchlist();
      } else {
        const fallbackRes = await stockFetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId })
        });
        if (fallbackRes.ok) {
          alert(`已成功將 ${stockId} 加入追蹤與警示清單！`);
          fetchWatchlist();
        } else {
          alert('新增至追蹤清單失敗');
        }
      }
    } catch (err) {
      alert(`新增至追蹤清單失敗: ${err.message}`);
    }
  };

  const fetchPortfolioMlPredictions = async (targetModel = null) => {
    const modelToUse = targetModel || portfolioMlModel;
    try {
      setFetchingPortfolioMl(true);
      // 從 Supabase ML 快取讀取該模型針對全市場的 all_data_map
      const res = await supabaseFetch(`/stock_ml_cache?model_type=eq.${modelToUse}&select=payload`);
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          const allMap = rows[0].payload.all_data_map || {};
          setPortfolioPredictions(allMap);
          return;
        }
      }
      const fallbackRes = await stockFetch(`/api/portfolio/ml_predict?model_type=${modelToUse}`);
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setPortfolioPredictions(json.predictions || {});
      }
    } catch (err) {
      console.error('讀取持股 AI 預測失敗', err);
    } finally {
      setFetchingPortfolioMl(false);
    }
  };

  const fetchPortfolio = async () => {
    try {
      // 優先從 Supabase stock_portfolio 讀取雲端最新持股與損益
      const res = await supabaseFetch('/stock_portfolio?select=*&order=stock_id.asc');
      if (res.ok) {
        const json = await res.json();
        setPortfolioList(json);
        fetchPortfolioMlPredictions();
        return;
      }
      const fallbackRes = await stockFetch('/api/portfolio');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setPortfolioList(json);
        fetchPortfolioMlPredictions();
      }
    } catch (err) {
      console.error('無法讀取持股清單', err);
    }
  };

  const fetchWatchlist = async () => {
    try {
      // 優先從 Supabase stock_watchlist 讀取
      const res = await supabaseFetch('/stock_watchlist?select=*&order=stock_id.asc');
      if (res.ok) {
        const json = await res.json();
        setWatchlistList(json);
        return;
      }
      const fallbackRes = await stockFetch('/api/watchlist');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setWatchlistList(json);
      }
    } catch (err) {
      console.error('無法讀取追蹤清單', err);
    }
  };

  const fetchWatchlistAlerts = async () => {
    try {
      const res = await supabaseFetch('/stock_watchlist_alerts?select=*&order=created_at.desc&limit=50');
      if (res.ok) {
        const json = await res.json();
        setWatchlistAlerts(json);
        return;
      }
      const fallbackRes = await stockFetch('/api/watchlist/alerts');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setWatchlistAlerts(json);
      }
    } catch (err) {
      console.error('無法讀取警示歷史', err);
    }
  };

  const handleAddToWatchlist = async () => {
    const selectedIds = Object.keys(selectedStocks).filter(k => selectedStocks[k]);
    if (selectedIds.length === 0) return;
    try {
      const insertItems = selectedIds.map(id => ({
        stock_id: id,
        stock_name: id
      }));
      const res = await supabaseFetch('/stock_watchlist', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(insertItems)
      });
      if (res.ok) {
        alert(`成功將 ${selectedIds.join(', ')} 加入追蹤清單！`);
        setSelectedStocks({});
        fetchWatchlist();
      } else {
        const fallbackRes = await stockFetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_ids: selectedIds })
        });
        if (fallbackRes.ok) {
          const json = await fallbackRes.json();
          alert(json.message);
          setSelectedStocks({});
          fetchWatchlist();
        } else {
          alert('加入追蹤清單失敗');
        }
      }
    } catch (e) {
      alert(`連線失敗: ${e.message}`);
    }
  };

  const handleUpdateWatchlistAlert = async (stockId) => {
    try {
      const payload = {
        target_price_high: watchlistModalInput.target_price_high === '' ? null : parseFloat(watchlistModalInput.target_price_high),
        target_price_low: watchlistModalInput.target_price_low === '' ? null : parseFloat(watchlistModalInput.target_price_low),
        compare_ma5: parseInt(watchlistModalInput.compare_ma5),
        compare_ma20: parseInt(watchlistModalInput.compare_ma20),
        compare_ma60: parseInt(watchlistModalInput.compare_ma60)
      };
      
      const res = await supabaseFetch(`/stock_watchlist?stock_id=eq.${stockId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setEditingWatchlistStock(null);
        fetchWatchlist();
      } else {
        const fallbackRes = await stockFetch(`/api/watchlist/${stockId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId, ...payload })
        });
        if (fallbackRes.ok) {
          setEditingWatchlistStock(null);
          fetchWatchlist();
        } else {
          alert('修改警示條件失敗');
        }
      }
    } catch (e) {
      alert(`連線失敗: ${e.message}`);
    }
  };

  const handleDeleteWatchlist = async (stockId) => {
    if (!confirm(`確定要取消追蹤 ${stockId} 嗎？`)) return;
    try {
      const res = await supabaseFetch(`/stock_watchlist?stock_id=eq.${stockId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchWatchlist();
      } else {
        const fallbackRes = await stockFetch(`/api/watchlist/${stockId}`, {
          method: 'DELETE'
        });
        if (fallbackRes.ok) fetchWatchlist();
        else alert('刪除追蹤失敗');
      }
    } catch (e) {
      alert(`連線失敗: ${e.message}`);
    }
  };

  const handleClearAlerts = async () => {
    if (!confirm('確定要清空所有警示紀錄嗎？')) return;
    try {
      const res = await supabaseFetch('/stock_watchlist_alerts', { method: 'DELETE' });
      if (res.ok) {
        fetchWatchlistAlerts();
      } else {
        const fallbackRes = await stockFetch('/api/watchlist/clear-alerts', { method: 'POST' });
        if (fallbackRes.ok) fetchWatchlistAlerts();
      }
    } catch (e) {
      alert('清空警示失敗');
    }
  };

  const handleManualCheckAlerts = async () => {
    setCheckingAlerts(true);
    try {
      const res = await stockFetch('/api/watchlist/check-alerts', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        alert(json.message);
        fetchWatchlist();
        fetchWatchlistAlerts();
      } else {
        alert('檢查警示失敗');
      }
    } catch (e) {
      alert(`連線失敗: ${e.message}`);
    } finally {
      setCheckingAlerts(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await supabaseFetch('/stock_settings?select=key,value');
      if (res.ok) {
        const rows = await res.json();
        const cfg = {};
        rows.forEach(r => { cfg[r.key] = r.value; });
        setServerSettings(prev => ({
          ...prev,
          gemini_api_key: cfg.gemini_api_key || prev.gemini_api_key,
          gemini_model: cfg.gemini_model || prev.gemini_model,
          analysis_prompt: cfg.analysis_prompt || prev.analysis_prompt,
          telegram_bot_token: cfg.telegram_bot_token || prev.telegram_bot_token,
          telegram_chat_id: cfg.telegram_chat_id || prev.telegram_chat_id,
        }));
        return;
      }
      const fallbackRes = await stockFetch('/api/settings');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setServerSettings(json);
      }
    } catch (err) {
      console.error('無法讀取後端設定', err);
    }
  };

  const fetchScheduleSettings = async () => {
    try {
      const res = await supabaseFetch('/stock_settings?select=key,value');
      if (res.ok) {
        const rows = await res.json();
        const cfg = {};
        rows.forEach(r => { cfg[r.key] = r.value; });
        setScheduleConfig({
          enabled: cfg.schedule_enabled === 'true',
          time: cfg.schedule_time || '06:00',
          scrape_daily: cfg.schedule_scrape_daily !== 'false',
          scrape_revenue: cfg.schedule_scrape_revenue !== 'false',
          analyze: cfg.schedule_analyze !== 'false'
        });
        return;
      }
      const fallbackRes = await stockFetch('/api/schedule');
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setScheduleConfig(json);
      }
    } catch (err) {
      console.error('無法讀取排程設定', err);
    }
  };

  const handleSaveSchedule = async () => {
    try {
      setSavingSchedule(true);
      const updates = [
        { key: 'schedule_enabled', value: String(scheduleConfig.enabled) },
        { key: 'schedule_time', value: String(scheduleConfig.time) },
        { key: 'schedule_scrape_daily', value: String(scheduleConfig.scrape_daily) },
        { key: 'schedule_scrape_revenue', value: String(scheduleConfig.scrape_revenue) },
        { key: 'schedule_analyze', value: String(scheduleConfig.analyze) }
      ];
      const res = await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        alert('排程設定已成功更新至雲端！');
        fetchScheduleSettings();
      } else {
        const fallbackRes = await stockFetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleConfig)
        });
        if (fallbackRes.ok) {
          alert('排程設定已成功更新！');
          fetchScheduleSettings();
        } else {
          throw new Error('更新失敗');
        }
      }
    } catch (err) {
      alert(`更新排程設定失敗: ${err.message}`);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleResetSchedule = async () => {
    if (!confirm('確定要將排程還原為預設設定嗎？（每天 06:00 執行，預設啟用）')) return;
    try {
      setSavingSchedule(true);
      const defaultConfig = { enabled: true, time: '06:00', scrape_daily: true, scrape_revenue: true, analyze: true };
      const updates = [
        { key: 'schedule_enabled', value: 'true' },
        { key: 'schedule_time', value: '06:00' },
        { key: 'schedule_scrape_daily', value: 'true' },
        { key: 'schedule_scrape_revenue', value: 'true' },
        { key: 'schedule_analyze', value: 'true' }
      ];
      await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(updates)
      });
      alert('已成功還原為預設排程設定！');
      setScheduleConfig(defaultConfig);
    } catch (err) {
      alert(`還原預設設定失敗: ${err.message}`);
    } finally {
      setSavingSchedule(false);
    }
  };

  const fetchPodcastChannels = async () => {
    try {
      const res = await stockFetch('/api/podcast/channels');
      if (res.ok) {
        const json = await res.json();
        setPodcastChannels(json);
      }
    } catch (err) {
      console.error('無法讀取 Podcast 頻道列表', err);
    }
  };

  const fetchPodcastEpisodes = async (channelId = selectedPodcastChannelId) => {
    try {
      const url = channelId ? `/api/podcast/episodes?channel_id=${channelId}` : '/api/podcast/episodes';
      const res = await stockFetch(url);
      if (res.ok) {
        const json = await res.json();
        setPodcastEpisodes(json);
      }
    } catch (err) {
      console.error('無法讀取 Podcast 單集列表', err);
    }
  };

  const handleAddPodcastChannel = async (e) => {
    e.preventDefault();
    if (!podcastUrlInput.trim()) return;
    try {
      setAddingChannel(true);
      const res = await stockFetch('/api/podcast/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: podcastUrlInput.trim() })
      });
      if (res.ok) {
        setPodcastUrlInput('');
        alert('成功加入 Podcast 頻道！已自動抓取前 15 集，您可以開始進行轉譯與分析。');
        fetchPodcastChannels();
        fetchPodcastEpisodes();
      } else {
        const json = await res.json();
        throw new Error(json.detail || '新增失敗');
      }
    } catch (err) {
      alert(`新增頻道失敗: ${err.message}`);
    } finally {
      setAddingChannel(false);
    }
  };

  const handleRestoreDefaultPodcastChannels = async () => {
    try {
      setAddingChannel(true);
      const res = await stockFetch('/api/podcast/channels/restore_defaults', {
        method: 'POST'
      });
      if (res.ok) {
        const json = await res.json();
        alert(json.message || '已成功恢復預設熱門頻道 (股癌、游庭皓的財經皓角)！');
        fetchPodcastChannels();
        fetchPodcastEpisodes();
      } else {
        const json = await res.json();
        throw new Error(json.detail || '恢復失敗');
      }
    } catch (err) {
      alert(`恢復失敗: ${err.message}`);
    } finally {
      setAddingChannel(false);
    }
  };

  const handleDeletePodcastChannel = async (channelId, name) => {
    if (!confirm(`確定要取消追蹤「${name}」並刪除其所有單集紀錄嗎？`)) return;
    try {
      const res = await stockFetch(`/api/podcast/channels/${channelId}`, { method: 'DELETE' });
      if (res.ok) {
        alert('已成功刪除！');
        let nextSelectedId = selectedPodcastChannelId;
        if (selectedPodcastChannelId === channelId) {
          nextSelectedId = null;
          setSelectedPodcastChannelId(null);
        }
        fetchPodcastChannels();
        fetchPodcastEpisodes(nextSelectedId);
        if (selectedEpisode?.channel_id === channelId) {
          setSelectedEpisode(null);
          setShowEpisodeModal(false);
        }
      } else {
        const json = await res.json();
        throw new Error(json.detail || '刪除失敗');
      }
    } catch (err) {
      alert(`刪除失敗: ${err.message}`);
    }
  };

  const handleRefreshPodcastChannel = async (channelId) => {
    try {
      setRefreshingChannelId(channelId);
      const res = await stockFetch(`/api/podcast/channels/${channelId}/refresh`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        alert(json.message);
        fetchPodcastEpisodes();
      } else {
        const json = await res.json();
        throw new Error(json.detail || '重新載入失敗');
      }
    } catch (err) {
      alert(`刷新失敗: ${err.message}`);
    } finally {
      setRefreshingChannelId(null);
    }
  };

  const handleBatchAnalyzeChannel = async (channelId, limit) => {
    try {
      setBatchAnalyzingChannelId(channelId);
      const headers = { 'Content-Type': 'application/json' };
      if (geminiApiKey) {
        headers['X-Gemini-API-Key'] = geminiApiKey;
      }
      const res = await stockFetch(`/api/podcast/channels/${channelId}/batch_transcribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ limit })
      });
      if (res.ok) {
        const json = await res.json();
        alert(json.message);
        fetchPodcastEpisodes();
      } else {
        const json = await res.json();
        throw new Error(json.detail || '批次分析啟動失敗');
      }
    } catch (err) {
      alert(`批次分析失敗: ${err.message}`);
    } finally {
      setBatchAnalyzingChannelId(null);
    }
  };

  const handleTranscribeEpisode = async (episodeGuid) => {
    try {
      setPodcastEpisodes(prev => prev.map(ep => ep.episode_guid === episodeGuid ? { ...ep, status: 'transcribing' } : ep));
      
      const headers = {};
      if (geminiApiKey) {
        headers['X-Gemini-API-Key'] = geminiApiKey;
      }
      
      const res = await stockFetch(`/api/podcast/transcribe/${episodeGuid}`, {
        method: 'POST',
        headers
      });
      
      const json = await res.json();
      alert(json.message);
      fetchPodcastEpisodes();
    } catch (err) {
      alert(`啟動轉譯失敗: ${err.message}`);
      fetchPodcastEpisodes();
    }
  };

  React.useEffect(() => {
    fetchSettings();
    fetchScheduleSettings();
    fetchBacktestSettings();
    fetchActiveTasks();

    // 1. 每秒碼表遞增
    const timerInterval = setInterval(() => {
      setTaskTimerTick(t => t + 1);
    }, 1000);

    // 2. 背景任務與模型訓練狀態自動輪詢 (每 3 秒同步最新任務與模型狀態)
    const taskPollInterval = setInterval(async () => {
      fetchActiveTasks();
      try {
        const resStatus = await supabaseFetch('/stock_ml_cache?model_type=eq.status_all&select=payload');
        let statuses = null;
        if (resStatus.ok) {
          const rows = await resStatus.json();
          if (rows && rows.length > 0 && rows[0].payload) {
            statuses = rows[0].payload;
          }
        }
        if (!statuses) {
          const fallbackRes = await stockFetch('/api/ml/status_all');
          if (fallbackRes.ok) {
            statuses = await fallbackRes.json();
          }
        }
        if (statuses) {
          setAllModelsStatus(prev => {
            if (prev) {
              Object.keys(statuses).forEach(k => {
                if (prev[k]?.status === 'training' && statuses[k]?.status === 'ready') {
                  console.log(`[Auto-Sync] 偵測到模型 ${k} 訓練完成！自動更新推薦清單與模型指標...`);
                  fetchMlStatusAndPredictions(k, true);
                }
              });
            }
            try { localStorage.setItem('ml_all_models_status', JSON.stringify(statuses)); } catch {}
            return statuses;
          });
          setMlStatus(prev => statuses[mlModelType] || prev);
        }
      } catch (err) {}
    }, 3000);

    return () => {
      clearInterval(timerInterval);
      clearInterval(taskPollInterval);
    };
  }, [mlModelType, filterCapital, minCapitalBillion, exclude6Digit]);

  React.useEffect(() => {
    if (activeTab === 'portfolio') {
      fetchPortfolio();
    } else if (activeTab === 'ml') {
      fetchMlStatusAndPredictions();
    } else if (activeTab === 'schedule') {
      fetchScheduleSettings();
    } else if (activeTab === 'podcast') {
      fetchPodcastChannels();
      fetchPodcastEpisodes();
    } else if (activeTab === 'watchlist') {
      fetchWatchlist();
      fetchWatchlistAlerts();
    } else if (activeTab === 'low_freq') {
      fetchLowFreqStatus();
    }
  }, [activeTab, mlModelType]);

  const handleStockIdChange = (val) => {
    const cleaned = val.trim();
    setPortfolioInput(p => {
      const existing = portfolioList.find(item => item.stock_id === cleaned);
      if (existing) {
        return {
          stock_id: cleaned,
          buy_price: existing.buy_price !== null ? existing.buy_price.toString() : '',
          notes: existing.notes || '',
          auto_analyze: existing.auto_analyze === 1
        };
      }
      return { ...p, stock_id: cleaned };
    });
  };

  const handleAddPortfolio = async (e) => {
    e.preventDefault();
    if (!portfolioInput.stock_id) return;
    try {
      const payload = {
        stock_id: portfolioInput.stock_id,
        stock_name: portfolioInput.stock_name || portfolioInput.stock_id,
        buy_price: portfolioInput.buy_price ? parseFloat(portfolioInput.buy_price) : null,
        notes: portfolioInput.notes || '',
        auto_analyze: portfolioInput.auto_analyze ? 1 : 0
      };
      const res = await supabaseFetch('/stock_portfolio', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setPortfolioInput({ stock_id: '', buy_price: '', notes: '', auto_analyze: true });
        fetchPortfolio();
      } else {
        const fallbackRes = await stockFetch('/api/portfolio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (fallbackRes.ok) {
          setPortfolioInput({ stock_id: '', buy_price: '', notes: '', auto_analyze: true });
          fetchPortfolio();
        } else {
          throw new Error('新增持股失敗');
        }
      }
    } catch (err) {
      alert('新增持股失敗: ' + err.message);
    }
  };

  const handleToggleAutoAnalyze = async (stockId) => {
    try {
      const item = portfolioList.find(p => p.stock_id === stockId);
      const nextVal = (item?.auto_analyze === 1) ? 0 : 1;
      const res = await supabaseFetch(`/stock_portfolio?stock_id=eq.${stockId}`, {
        method: 'PATCH',
        body: JSON.stringify({ auto_analyze: nextVal })
      });
      if (res.ok) {
        setPortfolioList(prev => prev.map(p => 
          p.stock_id === stockId ? { ...p, auto_analyze: nextVal } : p
        ));
      } else {
        const fallbackRes = await stockFetch(`/api/portfolio/${stockId}/toggle_analyze`, { method: 'POST' });
        if (fallbackRes.ok) {
          setPortfolioList(prev => prev.map(p => 
            p.stock_id === stockId ? { ...p, auto_analyze: nextVal } : p
          ));
        } else {
          throw new Error('切換失敗');
        }
      }
    } catch (err) {
      alert('切換自動分析設定失敗');
    }
  };

  const handleDeletePortfolio = async (stockId) => {
    if (!confirm(`確定要刪除持股 ${stockId} 嗎？`)) return;
    try {
      const res = await supabaseFetch(`/stock_portfolio?stock_id=eq.${stockId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchPortfolio();
        if (analysisResult?.stock_id === stockId) {
          setAnalysisResult(null);
        }
      } else {
        const fallbackRes = await stockFetch(`/api/portfolio/${stockId}`, { method: 'DELETE' });
        if (fallbackRes.ok) {
          fetchPortfolio();
          if (analysisResult?.stock_id === stockId) setAnalysisResult(null);
        } else {
          throw new Error('刪除失敗');
        }
      }
    } catch (err) {
      alert('刪除持股失敗');
    }
  };

  const handleAnalyzeStock = async (stockId) => {
    try {
      setAnalyzingId(stockId);
      setAnalysisResult(null);
      
      // 先檢查持股中是否已有快取的診斷報告
      const item = portfolioList.find(p => p.stock_id === stockId);
      if (item && item.analysis_report) {
        setAnalysisResult({
          stock_id: item.stock_id,
          stock_name: item.stock_name,
          signal: item.latest_signal,
          analysis_text: item.analysis_report,
          date: item.latest_analysis_date
        });
        return;
      }

      const headers = {};
      if (geminiApiKey) {
        headers['X-Gemini-API-Key'] = geminiApiKey;
        localStorage.setItem('gemini_api_key', geminiApiKey);
      }
      
      const res = await stockFetch(`/api/portfolio/analyze/${stockId}`, { headers });
      if (res.ok) {
        const json = await res.json();
        setAnalysisResult(json);
        fetchPortfolio();
      } else {
        alert(`目前尚無 ${stockId} 之預存診斷報告。請開啟本地 Worker 執行最新 AI 個股深度分析！`);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const updates = Object.keys(serverSettings).map(k => ({
        key: k,
        value: String(serverSettings[k] ?? '')
      }));
      const res = await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        alert('設定已成功儲存至雲端 Supabase！');
        setShowSettingsModal(false);
        return;
      }
      const fallbackRes = await stockFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverSettings)
      });
      if (fallbackRes.ok) {
        alert('設定已成功儲存至後端伺服器！');
        setShowSettingsModal(false);
      } else {
        throw new Error('儲存失敗');
      }
    } catch (err) {
      alert('儲存設定失敗，請確認連線。');
    }
  };

  const handleAnalyzeAll = async () => {
    if (!confirm("確定要手動重新診斷「自動分析」已勾選的持股嗎？\n這將在後端背景啟動已勾選的批次任務，可能需要幾分鐘時間。")) return;
    try {
      const res = await stockFetch('/api/portfolio/analyze-all', { method: 'POST' });
      if (res.ok) {
        alert('已成功於後端背景啟動批次診斷任務！您可以在列表隨時重新載入或稍後查看。');
      } else {
        throw new Error('背景任務啟動失敗');
      }
    } catch (err) {
      alert('啟動背景診斷失敗，請確認伺服器連線。');
    }
  };

  const viewHistory = async (stockId, stockName) => {
    try {
      setHistoryStockId(stockId);
      setHistoryStockName(stockName || '未知股');
      // 優先從 Supabase stock_portfolio_history 查詢
      const res = await supabaseFetch(`/stock_portfolio_history?stock_id=eq.${stockId}&order=date.desc&limit=20`);
      if (res.ok) {
        const json = await res.json();
        setHistoryList(json);
        if (json.length > 0) {
          setSelectedHistoryItem(json[0]);
        } else {
          setSelectedHistoryItem(null);
        }
        setShowHistoryModal(true);
        return;
      }
      const fallbackRes = await stockFetch(`/api/portfolio/history/${stockId}`);
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setHistoryList(json);
        if (json.length > 0) {
          setSelectedHistoryItem(json[0]);
        } else {
          setSelectedHistoryItem(null);
        }
        setShowHistoryModal(true);
      } else {
        throw new Error('無法讀取歷史紀錄');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    } catch { return DEFAULT_CONFIG; }
  });
  const [aiPrompt, setAiPrompt] = useState(() => {
    try { return localStorage.getItem(PROMPT_KEY) || DEFAULT_PROMPT; }
    catch { return DEFAULT_PROMPT; }
  });
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scraperStatus, setScraperStatus] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });

  const [selectedStocks, setSelectedStocks] = useState({});
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
  const [screenerModel, setScreenerModel] = useState('gemini-3.5-flash');

  const toggleSelectStock = (stockId) => {
    setSelectedStocks(prev => ({
      ...prev,
      [stockId]: !prev[stockId]
    }));
  };

  const toggleSelectAll = () => {
    const allSelected = sortedData && sortedData.length > 0 && sortedData.every(row => selectedStocks[row.stock_id]);
    const nextSelected = {};
    if (!allSelected && sortedData) {
      sortedData.forEach(row => {
        if (row.stock_id) {
          nextSelected[row.stock_id] = true;
        }
      });
    }
    setSelectedStocks(nextSelected);
  };

  const handleBatchAnalyzeScreener = async () => {
    const selectedIds = Object.keys(selectedStocks).filter(k => selectedStocks[k]);
    if (selectedIds.length === 0) return;
    
    if (!confirm(`確定要批次用 ${screenerModel} 分析選取的 ${selectedIds.length} 檔股票嗎？\n因 API 限制，將依序進行，請稍候。`)) return;
    
    setBatchAnalyzing(true);
    setAnalyzeProgress({ current: 0, total: selectedIds.length });
    
    const headers = {};
    if (geminiApiKey) {
      headers['X-Gemini-API-Key'] = geminiApiKey;
    }
    
    const updatedData = [...data];
    let updatedCount = 0;
    
    for (const stockId of selectedIds) {
      setAnalyzeProgress(prev => ({ ...prev, current: updatedCount + 1 }));
      try {
        const res = await stockFetch(`/api/portfolio/analyze/${stockId}?model_name=${screenerModel}`, {
          headers
        });
        if (res.ok) {
          const resJson = await res.json();
          const rowIndex = updatedData.findIndex(row => row.stock_id === stockId);
          if (rowIndex !== -1) {
            updatedData[rowIndex] = {
              ...updatedData[rowIndex],
              "2026_FPE": resJson.fpe_2026 !== null && resJson.fpe_2026 !== undefined ? resJson.fpe_2026 : "N/A",
              "2027_FPE": resJson.fpe_2027 !== null && resJson.fpe_2027 !== undefined ? resJson.fpe_2027 : "N/A",
              "2028_FPE": resJson.fpe_2028 !== null && resJson.fpe_2028 !== undefined ? resJson.fpe_2028 : "N/A",
              "2027_PEG": resJson.peg_2027 !== null && resJson.peg_2027 !== undefined ? resJson.peg_2027 : "N/A",
              "是否是打群架": resJson.is_group_fight || "否"
            };
            setData([...updatedData]);
          }
        } else {
          console.error(`分析股票 ${stockId} 失敗`);
        }
      } catch (err) {
        console.error(`連線股票 ${stockId} 失敗`, err);
      }
      updatedCount++;
    }
    
    setBatchAnalyzing(false);
    alert("批次分析完成！已將分析結果寫入表格與資料庫歷史紀錄。");
  };

  const saveSettings = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      localStorage.setItem(PROMPT_KEY, aiPrompt);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch { alert('儲存失敗'); }
  };

  const resetSettings = () => {
    setConfig(DEFAULT_CONFIG);
    setAiPrompt(DEFAULT_PROMPT);
    setSelectedStocks({});
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PROMPT_KEY);
  };

  const handleSort = (key) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const sortedData = useMemo(() => {
    if (!data || !sortConfig.key) return data;
    return [...data].sort((a, b) => {
      const va = a[sortConfig.key];
      const vb = b[sortConfig.key];
      if (va === null || va === 'N/A') return 1;
      if (vb === null || vb === 'N/A') return -1;
      const result = isNaN(va) ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb);
      return sortConfig.dir === 'asc' ? result : -result;
    });
  }, [data, sortConfig]);

  const parsedAnalysis = useMemo(() => {
    if (!selectedEpisode?.analysis_report) return null;
    try {
      // 搜尋 JSON block
      const jsonMatch = selectedEpisode.analysis_report.match(/```json\s*([\s\S]*?)\s*```/) || selectedEpisode.analysis_report.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
    } catch (e) {
      console.error("解析 Gemini JSON 指標失敗", e);
    }
    return null;
  }, [selectedEpisode]);

  const runScraper = async (taskType) => {
    try {
      setLoading(true);
      setScraperStatus(`⏳ 正在將「${taskType === 'daily' ? '每日股價' : '月營收'}」爬蟲任務派工至你家裡的 Mac...`);
      const createRes = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: {
            job_type: 'scraper',
            task_type: taskType
          }
        })
      });
      if (createRes.ok) {
        setScraperStatus(`✅ 爬蟲任務已下發至家裡的 Mac！本地 Worker 正在抓取最新資料。`);
        return;
      }
      const res = await stockFetch(`/api/scraper/${taskType}`, { method: 'POST' });
      const json = await res.json();
      setScraperStatus(`✅ 任務已在背景啟動！`);
    } catch (err) {
      setScraperStatus('❌ 啟動爬蟲失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const runScreener = async () => {
    try {
      setLoading(true);
      setData(null);
      setSelectedStocks({});
      setScreeningStatus('🚀 正在將選股條件派工至你家裡的 Mac...');

      // 1. 發送任務至 Supabase 佇列
      const createRes = await window.fetch(`${SUPABASE_URL}/rest/v1/stock_screener_jobs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: config
        })
      });

      if (!createRes.ok) {
        throw new Error('無法發送選股任務至雲端中繼佇列');
      }

      const jobList = await createRes.json();
      const jobId = jobList[0]?.id;
      if (!jobId) throw new Error('任務建立異常');

      setScreeningStatus(`📡 任務 #${jobId} 已送達！家裡的 Mac 正在從 4.9GB 資料庫進行高速計算...`);

      // 2. 輪詢等待 Mac 完成任務 (每秒檢查一次，最多 45 秒)
      let attempts = 0;
      const maxAttempts = 45;
      let completedJob = null;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;

        const checkRes = await window.fetch(`${SUPABASE_URL}/rest/v1/stock_screener_jobs?id=eq.${jobId}`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });

        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData && checkData.length > 0) {
            const current = checkData[0];
            if (current.status === 'completed') {
              completedJob = current;
              break;
            } else if (current.status === 'error') {
              throw new Error(current.error_message || '本機運算發生錯誤');
            }
          }
        }
      }

      if (!completedJob) {
        throw new Error('等候運算逾時，請確認家裡 Mac 的 stock_cloud_worker.py 是否正在運行中！');
      }

      // 3. 渲染結果
      setData(completedJob.results || []);
      setScreeningStatus(`✨ 計算完成！家裡 Mac 共命中 ${completedJob.results?.length || 0} 檔符合條件之個股。`);

    } catch (err) {
      alert(err.message || '選股篩選失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadDatabase = async (tableName) => {
    try {
      setLoading(true);
      setData(null);
      setActiveDbTable(tableName);

      // 優先從 Supabase 雲端快照讀取
      const res = await supabaseFetch(`/stock_database_preview?table_name=eq.${tableName}&select=columns,data`);
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].data) {
          setData(rows[0].data);
          return;
        }
      }

      // 備援：若本地 FastAPI 正在運行
      const fallbackRes = await stockFetch(`/api/database/${tableName}`);
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        setData(json.data);
      } else {
        throw new Error('無法讀取資料表快照');
      }
    } catch (err) {
      alert('無法載入資料表: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyAiPrompt = (stockId) => {
    const text = aiPrompt.replace('{stock_id}', stockId);
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="app-container">
      <header>
        <h1>智慧選股與籌碼分析系統</h1>
        <p style={{ color: 'var(--text-muted)' }}>Taiwan Stock Screener &amp; Analysis Platform</p>
      </header>

      <div className="glass-panel">
        <div className="tabs" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          {[
            { id: 'screener', label: '🎯 智慧選股器' },
            { id: 'ml', label: '🤖 ML 波段飆股預測', badge: activeTasks.some(t => t.type === 'ml_train') ? '🏋️ 訓練中' : null },
            { id: 'low_freq', label: '📉 低頻量化交易' },
            { id: 'portfolio', label: '💼 我的持股' },
            { id: 'watchlist', label: '🔔 追蹤與警示' },
            { id: 'database', label: '📊 資料庫檢視' },
            { id: 'scraper', label: '⚡ 爬蟲控制', badge: activeTasks.some(t => t.type === 'data_backfill') ? '🗄️ 回補中' : null },
            { id: 'schedule', label: '⏰ 排程管理' },
            { id: 'podcast', label: '🎧 Podcast 觀點' },
          ].map(t => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(t.id); setData(null); setScraperStatus(''); setActiveDbTable(''); }}
              style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {t.label}
              {t.badge && (
                <span style={{
                  fontSize: '0.68rem',
                  background: 'rgba(239, 68, 68, 0.3)',
                  border: '1px solid rgba(239, 68, 68, 0.7)',
                  color: '#FECACA',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '10px',
                  fontWeight: 'bold'
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}

          {activeTasks.length > 0 && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: 'rgba(30, 58, 138, 0.35)',
                border: '1px solid rgba(59, 130, 246, 0.5)',
                padding: '0.35rem 0.8rem',
                borderRadius: '20px',
                fontSize: '0.82rem',
                color: '#93C5FD',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={() => setActiveTab('ml')}
              title="點擊前往查看背景執行中之任務與訓練詳細進度"
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 8px #10B981' }}></span>
              <span><strong>{activeTasks.length}</strong> 個背景任務執行中</span>
            </div>
          )}
        </div>

        {/* ===== 智慧選股器 ===== */}
        {activeTab === 'screener' && (
          <div>
            <div className="filter-grid">
              <div className="filter-section">
                <h3>基本估值篩選</h3>
                <RangeInput label="本益比 (PE)" minKey="pe_min" maxKey="pe_max" config={config} setConfig={setConfig} step={0.5} isFloat />
                <RangeInput label="股價淨值比 (PB)" minKey="pb_min" maxKey="pb_max" config={config} setConfig={setConfig} step={0.1} isFloat />
                <RangeInput label="殖利率 (%)" minKey="yield_min" maxKey="yield_max" config={config} setConfig={setConfig} step={0.1} isFloat />
                <RangeInput label="成交量 (股)" minKey="vol_min" maxKey="vol_max" config={config} setConfig={setConfig} step={100000} />
              </div>

              <div className="filter-section">
                <h3>均線趨勢條件</h3>
                <div className="filter-row">
                  <label>股價均線條件</label>
                  <select value={config.price_trend} onChange={e => setConfig(c => ({ ...c, price_trend: parseInt(e.target.value) }))}>
                    <option value={0}>不限</option>
                    <option value={1}>收盤價 站上 MA5</option>
                    <option value={2}>收盤價 站上 MA20</option>
                    <option value={3}>MA5 大於 MA20（多頭排列）</option>
                  </select>
                </div>
                <div className="filter-row">
                  <label>成交量均線條件</label>
                  <select value={config.vol_trend} onChange={e => setConfig(c => ({ ...c, vol_trend: parseInt(e.target.value) }))}>
                    <option value={0}>不限</option>
                    <option value={1}>最新量 突破 量MA5</option>
                    <option value={2}>最新量 突破 量MA20</option>
                    <option value={3}>量MA5 大於 量MA20（放量）</option>
                  </select>
                </div>
                <div className="filter-row checkbox-row">
                  <label>
                    <input type="checkbox" checked={config.vol_surge} onChange={e => setConfig(c => ({ ...c, vol_surge: e.target.checked }))} />
                    &nbsp;成交量激增（近5日均量 {'>'} 前20日均量 ×
                  </label>
                  <input
                    type="number" step="0.1" min="0.1" max="100"
                    value={config.vol_surge_mult}
                    style={{ width: '80px', marginLeft: '0.5rem' }}
                    onChange={e => setConfig(c => ({ ...c, vol_surge_mult: parseFloat(e.target.value) }))}
                  />
                  <span>&nbsp;倍）</span>
                </div>
              </div>

              <div className="filter-section">
                <h3>專業選股策略</h3>
                <div className="filter-row checkbox-row">
                  <label>
                    <input type="checkbox" checked={config.strat1} onChange={e => setConfig(c => ({ ...c, strat1: e.target.checked }))} />
                    &nbsp;策略一：爆量突破季線（尋找起漲第一根）
                  </label>
                </div>
                <div className="filter-row checkbox-row">
                  <label>
                    <input type="checkbox" checked={config.strat2} onChange={e => setConfig(c => ({ ...c, strat2: e.target.checked }))} />
                    &nbsp;策略二：均線多頭排列 + 凹洞量（強勢股回檔買點）
                  </label>
                </div>
                <p className="hint">※ 如勾選策略，符合其中一項即可通過篩選（OR 邏輯）</p>
              </div>

              <div className="filter-section">
                <h3>籌碼與法人動向</h3>
                <RangeInput label="千張大戶持股 (%)" minKey="large_holder_min" maxKey="large_holder_max" config={config} setConfig={setConfig} step={1} isFloat />
                
                <div className="filter-row checkbox-row" style={{ marginTop: '0.25rem', marginBottom: '0.75rem' }}>
                  <label>
                    <input type="checkbox" checked={config.large_holder_inc} onChange={e => setConfig(c => ({ ...c, large_holder_inc: e.target.checked }))} />
                    &nbsp;千張大戶持股近週連續增加 (▲)
                  </label>
                </div>

                <div className="filter-row">
                  <label>外資連續買超天數</label>
                  <select value={config.foreign_buy_days_min} onChange={e => setConfig(c => ({ ...c, foreign_buy_days_min: parseInt(e.target.value) }))}>
                    <option value={0}>不限</option>
                    <option value={1}>至少連買 1 天以上</option>
                    <option value={3}>至少連買 3 天以上</option>
                    <option value={5}>至少連買 5 天以上</option>
                    <option value={10}>至少連買 10 天以上</option>
                  </select>
                </div>

                <div className="filter-row">
                  <label>投信連續買超天數</label>
                  <select value={config.trust_buy_days_min} onChange={e => setConfig(c => ({ ...c, trust_buy_days_min: parseInt(e.target.value) }))}>
                    <option value={0}>不限</option>
                    <option value={1}>至少連買 1 天以上</option>
                    <option value={3}>至少連買 3 天以上 (投信作多)</option>
                    <option value={5}>至少連買 5 天以上 (投信鎖碼)</option>
                    <option value={10}>至少連買 10 天以上</option>
                  </select>
                </div>

                <div className="filter-row">
                  <label>三大法人合計連買天數</label>
                  <select value={config.inst_buy_days_min} onChange={e => setConfig(c => ({ ...c, inst_buy_days_min: parseInt(e.target.value) }))}>
                    <option value={0}>不限</option>
                    <option value={1}>至少連買 1 天以上</option>
                    <option value={3}>至少連買 3 天以上</option>
                    <option value={5}>至少連買 5 天以上</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
              <button className="btn" onClick={runScreener} disabled={loading}>
                {loading ? <span className="loader"></span> : '🚀 開始篩選'}
              </button>
              <button className="btn btn-save" onClick={saveSettings}>💾 儲存設定</button>
              <button className="btn btn-secondary" onClick={resetSettings}>↺ 重設預設</button>
              <button className="btn btn-secondary" onClick={() => setShowPromptEditor(!showPromptEditor)}>
                ⚙️ AI 指令範本
              </button>
              {savedToast && (
                <span className="save-toast">✅ 設定已儲存！</span>
              )}
              {data && <span style={{ color: 'var(--text-muted)', marginLeft: '1rem' }}>共 {data.length} 筆資料</span>}
            </div>

            {screeningStatus && (
              <div style={{ width: '100%', marginTop: '0.8rem', padding: '0.65rem 1.2rem', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '8px', color: '#93C5FD', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{screeningStatus}</span>
              </div>
            )}

            {showPromptEditor && (
              <div className="api-key-block" style={{ marginTop: '1.5rem', flexDirection: 'column', alignItems: 'stretch', width: '100%', gap: '0.75rem' }}>
                <label htmlFor="screener-prompt-input" style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#60A5FA' }}>
                  📝 複製用 AI 指令範本 (可用於手動複製貼上至 AI 網頁)
                </label>
                <textarea
                  id="screener-prompt-input"
                  value={aiPrompt}
                  onChange={e => {
                    setAiPrompt(e.target.value);
                    localStorage.setItem(PROMPT_KEY, e.target.value);
                  }}
                  style={{
                    width: '100%',
                    minHeight: '120px',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.3)',
                    color: 'white',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    lineHeight: '1.5',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  使用 <code>{"{stock_id}"}</code> 作為股票代號的佔位符。點擊表格中的「📋 複製AI指令」將會自動替換並複製到剪貼簿。
                </span>
              </div>
            )}
          </div>
        )}

        {/* ===== ML 波段飆股預測 ===== */}
        {activeTab === 'ml' && (
          <div>
            {/* 🏃 背景任務即時監控看板 (Live Task Monitor Dashboard) */}
            <div style={{
              background: activeTasks.length > 0 ? 'linear-gradient(135deg, rgba(30, 58, 138, 0.3), rgba(15, 23, 42, 0.85))' : 'rgba(15, 23, 42, 0.4)',
              border: activeTasks.length > 0 ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--border-color)',
              boxShadow: activeTasks.length > 0 ? '0 8px 24px rgba(37, 99, 235, 0.15)' : 'none',
              borderRadius: '12px',
              padding: '1.25rem',
              marginBottom: '1.75rem',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: activeTasks.length > 0 ? '1rem' : '0', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>🏃</span>
                    背景執行與訓練任務監控看板
                  </h3>
                  {activeTasks.length > 0 ? (
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid #10B981',
                      color: '#6EE7B7',
                      fontSize: '0.78rem',
                      fontWeight: 'bold',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 8px #10B981' }}></span>
                      {activeTasks.length} 個任務正在執行中
                    </span>
                  ) : (
                    <span style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: 'var(--text-muted)',
                      fontSize: '0.78rem',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '20px'
                    }}>
                      目前無任何背景任務
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    className="btn"
                    style={{
                      padding: '0.3rem 0.75rem',
                      fontSize: '0.8rem',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-color)',
                      color: 'white',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                    onClick={fetchActiveTasks}
                    disabled={fetchingTasks}
                  >
                    {fetchingTasks ? <span className="loader" style={{ width: '12px', height: '12px' }}></span> : '🔄 重新整理看板'}
                  </button>
                </div>
              </div>

              {activeTasks.length === 0 ? (
                <div style={{ padding: '0.75rem 0', color: 'var(--text-muted)', fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>✨</span> 目前系統背景處於閒置就緒狀態，所有模型訓練或數據同步已完成。
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
                  {activeTasks.map(task => {
                    // 計算前端即時動態累計時長
                    const currentElapsed = task.created_timestamp ? Math.max(0, Math.floor(Date.now() / 1000 - task.created_timestamp)) : task.elapsed_seconds;
                    const durationStr = formatSecondsToDuration(currentElapsed);
                    const isKilling = killingTaskPid === task.pid;

                    return (
                      <div
                        key={task.id}
                        style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(59, 130, 246, 0.35)',
                          borderRadius: '10px',
                          padding: '1rem 1.15rem',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {/* 頂部名稱與標籤 */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#F1F5F9', lineHeight: '1.4' }}>
                              {task.name}
                            </div>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '4px',
                              background: task.type === 'ml_train' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(59, 130, 246, 0.25)',
                              color: task.type === 'ml_train' ? '#D8B4FE' : '#93C5FD',
                              border: task.type === 'ml_train' ? '1px solid rgba(168, 85, 247, 0.5)' : '1px solid rgba(59, 130, 246, 0.5)',
                              whiteSpace: 'nowrap'
                            }}>
                              {task.type === 'ml_train' ? '🏋️ AI 訓練' : '🗄️ 數據回補'}
                            </span>
                          </div>

                          {/* 核心數據看板：已執行時間高亮碼表 */}
                          <div style={{
                            background: 'rgba(0, 0, 0, 0.35)',
                            borderRadius: '8px',
                            padding: '0.75rem',
                            margin: '0.5rem 0',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '0.5rem',
                            border: '1px solid rgba(255,255,255,0.05)'
                          }}>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>⏱️ 已執行時間</div>
                              <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#FDE68A', fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                                {durationStr}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📅 啟動時間</div>
                              <div style={{ fontSize: '0.82rem', color: '#CBD5E1', marginTop: '0.2rem' }}>
                                {task.created_at?.split(' ')[1] || task.created_at}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🆔 PID</div>
                              <div style={{ fontSize: '0.82rem', color: '#93C5FD', fontFamily: 'monospace' }}>
                                {task.pid}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>💾 記憶體佔用</div>
                              <div style={{ fontSize: '0.82rem', color: '#6EE7B7' }}>
                                {task.memory_mb} MB
                              </div>
                            </div>
                          </div>

                          {/* 進度細節 */}
                          <div style={{ fontSize: '0.78rem', color: '#94A3B8', wordBreak: 'break-all', background: 'rgba(255,255,255,0.03)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                            <strong style={{ color: '#A5B4FC' }}>當前狀態: </strong>
                            {task.details}
                          </div>
                        </div>

                        {/* 底部操作：一鍵強制終止 */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.25rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                          <button
                            className="btn"
                            style={{
                              padding: '0.35rem 0.9rem',
                              fontSize: '0.8rem',
                              background: 'rgba(239, 68, 68, 0.18)',
                              border: '1px solid rgba(239, 68, 68, 0.45)',
                              color: '#FCA5A5',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              borderRadius: '6px'
                            }}
                            onClick={() => handleKillTask(task)}
                            disabled={isKilling}
                          >
                            {isKilling ? (
                              <>
                                <span className="loader" style={{ width: '12px', height: '12px', borderColor: '#FCA5A5' }}></span>
                                終止中...
                              </>
                            ) : (
                              <>🛑 終止此任務</>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ML 模型訓練與控制面板 */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem', background: 'rgba(15, 23, 42, 0.65)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#60A5FA' }}>
                    🤖 機器學習「未來一個月 20% 波段飆股」預測模型
                  </h2>
                  <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    融合全台股每日價量、三大法人買賣超與集保千張大戶歷史數據，透過 GBDT 擬合未來 20 個交易日漲幅突破 20% 的潛力標的。
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {mlRefreshing && (
                    <span style={{ fontSize: '0.8rem', color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="loader" style={{ width: '12px', height: '12px' }}></span> 背景同步中...
                    </span>
                  )}
                  <button
                    className="btn"
                    style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    onClick={() => fetchMlStatusAndPredictions(mlModelType, true)}
                    disabled={mlLoading || mlRefreshing}
                    title="強制重新計算今日最新市場推論"
                  >
                    🔄 重新推論最新數據
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid var(--border-color)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    onClick={() => fetchMlStatusAndPredictions(mlModelType, false)}
                    disabled={mlLoading || mlRefreshing}
                    title="重新整理所有模型指標與快取"
                  >
                    ⚡ 同步狀態
                  </button>
                </div>
              </div>

              {/* ⚡ AI 模型即時讀取與運算狀態列 (AI Model Status & Pipeline Bar) */}
              <div style={{
                background: mlComputingStatus ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(15, 23, 42, 0.8))' :
                            allModelsStatus[mlModelType]?.status === 'training' ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(15, 23, 42, 0.8))' :
                            'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(15, 23, 42, 0.8))',
                border: mlComputingStatus ? '1px solid rgba(245, 158, 11, 0.4)' :
                        allModelsStatus[mlModelType]?.status === 'training' ? '1px solid rgba(168, 85, 247, 0.4)' :
                        '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '10px',
                padding: '1rem 1.25rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>當前選用模型:</span>
                    <span style={{
                      background: 'rgba(59, 130, 246, 0.3)',
                      border: '1px solid #3B82F6',
                      color: '#93C5FD',
                      fontWeight: 'bold',
                      padding: '0.2rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.88rem'
                    }}>
                      🌟 {mlModelType?.toUpperCase()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>運算狀態:</span>
                    {mlComputingStatus ? (
                      <span style={{ color: '#FBBF24', fontWeight: 'bold', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="loader" style={{ width: '12px', height: '12px', borderColor: '#FBBF24', borderBottomColor: 'transparent' }}></span>
                        {mlComputingStatus}
                      </span>
                    ) : allModelsStatus[mlModelType]?.status === 'training' ? (
                      <span style={{ color: '#C084FC', fontWeight: 'bold', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="loader" style={{ width: '12px', height: '12px', borderColor: '#C084FC', borderBottomColor: 'transparent' }}></span>
                        🏋️ 模型獨立背景進程訓練中...
                      </span>
                    ) : allModelsStatus[mlModelType]?.status === 'ready' ? (
                      <span style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.85rem' }}>
                        ✅ 模型與推論資料已就緒 ({allModelsStatus[mlModelType]?.trained_at || '就緒'})
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        ⭕ 尚未訓練或未載入
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  {allModelsStatus[mlModelType]?.data_details?.train_range && (
                    <span style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                      🗓️ 訓練資料區間：<strong style={{ color: '#FDE68A' }}>{allModelsStatus[mlModelType].data_details.train_range}</strong>
                      <span style={{ fontSize: '0.75rem', color: '#CBD5E1', marginLeft: '0.35rem' }}>
                        ({allModelsStatus[mlModelType].data_details.train_days} 天 / {allModelsStatus[mlModelType].data_details.train_samples?.toLocaleString()} 樣本)
                      </span>
                    </span>
                  )}
                  {allModelsStatus[mlModelType]?.data_details?.filters && (
                    <span style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '0.2rem 0.5rem', borderRadius: '6px', color: '#93C5FD' }}>
                      🎯 樣本過濾：<strong style={{ color: '#BFDBFE' }}>{allModelsStatus[mlModelType].data_details.filters}</strong>
                    </span>
                  )}
                  {(allModelsStatus[mlModelType]?.train_settings || allModelsStatus[mlModelType]?.data_details?.train_settings) && (
                    <span style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '0.2rem 0.5rem', borderRadius: '6px', color: '#D8B4FE' }}>
                      ⚙️ 訓練配置：<strong>
                        {allModelsStatus[mlModelType].train_settings?.train_days || allModelsStatus[mlModelType].data_details?.train_days}天訓練 / {allModelsStatus[mlModelType].train_settings?.test_days || allModelsStatus[mlModelType].data_details?.test_days}天測試
                      </strong>
                    </span>
                  )}
                  {mlPredictions.length > 0 && (
                    <span>
                      🎯 推薦標的：<strong style={{ color: '#60A5FA' }}>{mlPredictions.length}</strong> 檔
                    </span>
                  )}
                  {mlPredictions[0]?.date && (
                    <span>
                      🗓️ 數據基準日：<strong style={{ color: '#A7F3D0' }}>{mlPredictions[0].date}</strong>
                    </span>
                  )}
                  {allModelsStatus[mlModelType]?.metrics?.auc && (
                    <span>
                      📈 驗證 AUC：<strong style={{ color: '#FBBF24' }}>{(allModelsStatus[mlModelType].metrics.auc * 100).toFixed(1)}%</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* AI 模型載入與效能指標總覽對比表格 - 移至最上方 */}
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📊 已載入 AI 模型評估指標總覽對比表格
                  </h4>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    點擊表格中的「🎯 選用」即可將該模型設為當前預測與回測標的
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.86rem', borderCollapse: 'separate', borderSpacing: '0 4px' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.05)', color: '#93C5FD', textAlign: 'left' }}>
                        <th style={{ padding: '0.6rem 0.75rem', borderRadius: '6px 0 0 6px' }}>AI 模型名稱</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>📈 上漲 / 跳破 AUC</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>📊 Rank IC (Mean / IR)</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>🏆 作多夏普 (D1 Sharpe)</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>⚖️ 多空夏普 (L-S Sharpe)</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>💰 多空年化利差 (L-S Spread)</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>🎯 驗證集準確度</th>
                        <th style={{ padding: '0.6rem 0.75rem' }}>🗓️ 狀態 / 訓練時間與資料區間</th>
                        <th style={{ padding: '0.6rem 0.75rem', borderRadius: '0 6px 6px 0', textAlign: 'center' }}>⚙️ 操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { val: 'attention_bilstm_xgb', label: '🔥 Attention BiLSTM-XGBoost' },
                        { val: 'vsn_xlstm', label: '🧬 VSN-xLSTM' },
                        { val: 'patchtst',  label: '🧩 PatchTST' },
                        { val: 'tft',       label: '🔮 TFT' },
                        { val: 'resnet50',  label: '🧬 ResNet-50' },
                        { val: 'cnn_hybrid', label: '⚡ CNN-Hybrid' },
                        { val: 'lightgbm',  label: '🌟 LightGBM' },
                        { val: 'mlp',       label: '🧠 DNN (MLP)' },
                        { val: 'xgboost',   label: '🔥 XGBoost' },
                        { val: 'rf',        label: '🌲 Random Forest' },
                        { val: 'lr',        label: '📊 Logistic Regression' },
                      ].map(({ val, label }) => {
                        const s = allModelsStatus[val] || {};
                        const isSelected = mlModelType === val;
                        const isReady = s.status === 'ready';
                        const isTraining = s.status === 'training';
                        const m = s.metrics || {};

                        return (
                          <tr
                            key={val}
                            style={{
                              background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                              borderLeft: isSelected ? '4px solid #60A5FA' : '4px solid transparent',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: isSelected ? 'bold' : 'normal', color: isSelected ? '#93C5FD' : 'white' }}>
                              {label}
                              {isSelected && <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: '#3B82F6', color: 'white' }}>當前選用</span>}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold' }}>
                              <span style={{ color: m.auc >= 0.73 ? '#34D399' : '#60A5FA' }}>{m.auc !== undefined ? m.auc : '—'}</span>
                              <span style={{ color: 'var(--text-muted)', margin: '0 0.3rem' }}>/</span>
                              <span style={{ color: m.auc_down >= 0.73 ? '#F87171' : '#FBBF24' }}>{m.auc_down !== undefined ? m.auc_down : '—'}</span>
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.mean_ic !== undefined ? (m.mean_ic >= 0.05 ? '#34D399' : '#FBBF24') : 'var(--text-muted)' }}>
                              {m.mean_ic !== undefined ? `${m.mean_ic} (IR:${m.ic_ir || 0})` : '—'}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.d1_sharpe !== undefined ? (m.d1_sharpe >= 1.5 ? '#34D399' : '#FBBF24') : 'var(--text-muted)' }}>
                              {m.d1_sharpe !== undefined ? m.d1_sharpe : '—'}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.ls_sharpe !== undefined ? (m.ls_sharpe >= 2.0 ? '#C084FC' : '#38BDF8') : 'var(--text-muted)' }}>
                              {m.ls_sharpe !== undefined ? m.ls_sharpe : '—'}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.ls_spread !== undefined ? (m.ls_spread >= 10.0 ? '#34D399' : '#FBBF24') : 'var(--text-muted)' }}>
                              {m.ls_spread !== undefined ? `+${m.ls_spread}%` : '—'}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.accuracy !== undefined ? '#38BDF8' : 'var(--text-muted)' }}>
                              {m.accuracy !== undefined ? `${(m.accuracy * 100).toFixed(1)}%` : '—'}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.8rem' }}>
                              {isReady ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  <div style={{ color: '#34D399', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <span>✅ {s.trained_at || '就緒'}</span>
                                  </div>
                                  {s.data_details?.train_range && (
                                    <div style={{ fontSize: '0.73rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span>📅 區間:</span>
                                      <strong>{s.data_details.train_range}</strong>
                                      <span style={{ color: '#CBD5E1' }}>({s.data_details.train_days}天/{s.data_details.train_samples?.toLocaleString()}筆)</span>
                                    </div>
                                  )}
                                  {(s.train_settings?.filters || s.data_details?.filters) && (
                                    <div style={{ fontSize: '0.72rem', color: '#FDE68A', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                      <span>🎯 過濾:</span>
                                      <span style={{ background: 'rgba(245, 158, 11, 0.15)', padding: '1px 4px', borderRadius: '3px' }}>
                                        {s.train_settings?.filters || s.data_details?.filters}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              ) : isTraining ? (
                                <span style={{ color: '#FBBF24', fontWeight: 'bold' }}>⏳ 背景訓練中...</span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>⭕ 未訓練</span>
                              )}
                            </td>
                            <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                <button
                                  className="btn"
                                  style={{
                                    padding: '0.25rem 0.6rem',
                                    fontSize: '0.78rem',
                                    background: isSelected ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.08)',
                                    border: '1px solid var(--border-color)',
                                    color: isSelected ? '#93C5FD' : 'white'
                                  }}
                                  onClick={() => handleSelectModel(val)}
                                >
                                  {isSelected ? '✓ 使用中' : '🎯 選用'}
                                </button>
                                <button
                                  className="btn"
                                  style={{
                                    padding: '0.25rem 0.6rem',
                                    fontSize: '0.78rem',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#FCA5A5'
                                  }}
                                  onClick={() => handleTrainMLModel(true, val)}
                                  disabled={mlLoading}
                                >
                                  🔄 訓練
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 分位數投資組合 (Decile Portfolios D1 ~ D10) 單調性分佈圖 */}
                {allModelsStatus[mlModelType]?.metrics?.decile_returns && (
                  <div style={{ marginTop: '1.25rem', padding: '1.25rem', borderRadius: '8px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <h5 style={{ margin: 0, color: '#60A5FA', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        📊 分位數投資組合 (Decile Portfolios D1 ~ D10) 平均報酬分佈 — {mlModelType.toUpperCase()}
                      </h5>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        D1 (預測最高前10%) ➡ D10 (預測最低後10%) ｜ 單調性越高代表選股排序能力越佳
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '0.5rem', alignItems: 'end', minHeight: '140px', padding: '0.5rem 0' }}>
                      {allModelsStatus[mlModelType].metrics.decile_returns.map((val, idx) => {
                        const isPositive = val >= 0;
                        const absVal = Math.abs(val);
                        const allVals = allModelsStatus[mlModelType].metrics.decile_returns;
                        const maxVal = Math.max(...allVals.map(v => Math.abs(v)), 1.0);
                        const heightPct = Math.max(18, (absVal / maxVal) * 90);

                        return (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: isPositive ? '#34D399' : '#F87171' }}>
                              {isPositive ? `+${val}%` : `${val}%`}
                            </span>
                            <div style={{
                              width: '100%',
                              height: `${heightPct}px`,
                              maxHeight: '90px',
                              borderRadius: '4px',
                              background: isPositive 
                                ? 'linear-gradient(180deg, #34D399 0%, rgba(52, 211, 153, 0.25) 100%)'
                                : 'linear-gradient(180deg, rgba(248, 113, 113, 0.25) 0%, #F87171 100%)',
                              border: isPositive ? '1px solid #059669' : '1px solid #DC2626',
                              transition: 'all 0.3s ease'
                            }} />
                            <span style={{ fontSize: '0.75rem', color: idx === 0 ? '#93C5FD' : (idx === 9 ? '#FCA5A5' : 'var(--text-muted)'), fontWeight: (idx === 0 || idx === 9) ? 'bold' : 'normal' }}>
                              D{idx + 1}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 客製化數據切割與訓練天數 & 標的過濾條件 */}
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '10px', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  ⚙️ 訓練與回測時間長度配置
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                      分割比例 ({Math.round(trainRatio * 100)}% 訓練 / {Math.round((1 - trainRatio) * 100)}% 測試)
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="0.9"
                      step="0.05"
                      value={trainRatio}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setTrainRatio(val);
                        localStorage.setItem('bt_train_ratio', val);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>🏋️ 訓練集資料長度 (交易日天數)</label>
                    <input
                      type="number"
                      value={trainDays}
                      onChange={e => {
                        setTrainDays(e.target.value);
                        localStorage.setItem('bt_train_days', e.target.value);
                      }}
                      placeholder="例: 180 天"
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>📊 測試/回測資料長度 (交易日天數)</label>
                    <input
                      type="number"
                      value={testDays}
                      onChange={e => {
                        setTestDays(e.target.value);
                        localStorage.setItem('bt_test_days', e.target.value);
                      }}
                      placeholder="例: 30 天"
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem' }}
                    />
                  </div>
                </div>

                {/* 🎯 標的過濾與排除條件 (標的資本額 & 6碼股票過濾) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1rem',
                  marginTop: '1rem',
                  paddingTop: '0.9rem',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  alignItems: 'center'
                }}>
                  {/* 1. 排除 6 碼股票（ETF / 權證） */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    <input
                      type="checkbox"
                      id="exclude-6digit-cb"
                      checked={exclude6Digit}
                      onChange={e => {
                        setExclude6Digit(e.target.checked);
                        localStorage.setItem('bt_exclude_6digit', e.target.checked);
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3B82F6' }}
                    />
                    <label htmlFor="exclude-6digit-cb" style={{ fontSize: '0.85rem', color: '#F1F5F9', cursor: 'pointer', userSelect: 'none' }}>
                      🚫 <strong>排除 6 碼股票（ETF、權證與特別股）</strong>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        只訓練 4 碼個股，避免權證與指數 ETF 雜訊干擾
                      </span>
                    </label>
                  </div>

                  {/* 2. 排除股本小於 10 億元之小型股 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    <input
                      type="checkbox"
                      id="filter-capital-cb"
                      checked={filterCapital}
                      onChange={e => {
                        setFilterCapital(e.target.checked);
                        localStorage.setItem('bt_filter_capital', e.target.checked);
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#10B981' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <label htmlFor="filter-capital-cb" style={{ fontSize: '0.85rem', color: '#F1F5F9', cursor: 'pointer', userSelect: 'none' }}>
                          🏢 <strong>濾除股本小於門檻之股票</strong>
                        </label>
                        {filterCapital && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span style={{ fontSize: '0.75rem', color: '#FDE68A' }}>≥</span>
                            <input
                              type="number"
                              min="0.1"
                              step="0.5"
                              value={minCapitalBillion}
                              onChange={e => {
                                setMinCapitalBillion(e.target.value);
                                localStorage.setItem('bt_min_capital_billion', e.target.value);
                              }}
                              style={{
                                width: '60px',
                                background: 'rgba(0,0,0,0.5)',
                                color: '#FDE68A',
                                border: '1px solid #F59E0B',
                                borderRadius: '4px',
                                padding: '0.2rem 0.4rem',
                                fontSize: '0.82rem',
                                textAlign: 'center'
                              }}
                            />
                            <span style={{ fontSize: '0.75rem', color: '#FDE68A' }}>億元</span>
                          </div>
                        )}
                      </div>
                      <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {filterCapital ? `依集保總股數×10元計算，僅納入股本 ≥ ${minCapitalBillion} 億之流動性主力股` : '未啟用股本過濾（納入所有規模之股票）'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 客製化策略量化回測控制區塊 */}
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1.25rem', borderRadius: '10px', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📊 客製化 AI 策略量化回測引擎 (Quant Backtest)
                  </h4>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button
                      className="btn"
                      style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', background: 'rgba(59, 130, 246, 0.25)', border: '1px solid rgba(59, 130, 246, 0.5)', color: '#93C5FD' }}
                      onClick={() => handleSaveBacktestSettings(true)}
                      disabled={savingBtSettings}
                      title="將目前設定的勝率、風控、停利、停損與持股天數儲存至系統資料庫"
                    >
                      {savingBtSettings ? <span className="loader" style={{ width: '12px', height: '12px' }}></span> : '💾 儲存回測參數'}
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '0.4rem 1.25rem', fontSize: '0.85rem', background: 'linear-gradient(135deg, #059669, #10B981)' }}
                      onClick={handleRunBacktest}
                      disabled={btLoading}
                    >
                      {btLoading ? <span className="loader" style={{ width: '12px', height: '12px' }}></span> : '🚀 執行策略歷史回測'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>🎯 停利出場模式</label>
                    <select
                      value={btExitStrategy}
                      onChange={e => setBtExitStrategy(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: '#FDE68A', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem', fontSize: '0.84rem' }}
                    >
                      <option value="fixed">🎯 固定目標停利</option>
                      <option value="ma5">📉 跌破 5日線 (MA5) 停利</option>
                      <option value="ma10">📉 跌破 10日線 (MA10) 停利</option>
                      <option value="ma20">📉 跌破 20日線 (MA20) 停利</option>
                      <option value="trailing_ma5">🚀 獲利達標後 MA5 移動停利</option>
                      <option value="trailing_ma10">🚀 獲利達標後 MA10 移動停利</option>
                    </select>
                  </div>
                  {(btExitStrategy === 'trailing_ma5' || btExitStrategy === 'trailing_ma10') && (
                    <div>
                      <label style={{ fontSize: '0.8rem', color: '#93C5FD', display: 'block' }}>🚀 移動停利啟動門檻 (+%)</label>
                      <input
                        type="number"
                        value={btTrailingActivation}
                        onChange={e => setBtTrailingActivation(e.target.value)}
                        placeholder="例: 10"
                        style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: '#93C5FD', border: '1px solid rgba(59, 130, 246, 0.5)', borderRadius: '6px', padding: '0.35rem' }}
                      />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>買進突破勝率 (≥%)</label>
                    <input
                      type="number"
                      value={btMinWinProb}
                      onChange={e => setBtMinWinProb(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>跌破風險上限 (≤%)</label>
                    <input
                      type="number"
                      value={btMaxDropProb}
                      onChange={e => setBtMaxDropProb(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>停利目標 (+%)</label>
                    <input
                      type="number"
                      value={btStopProfit}
                      onChange={e => setBtStopProfit(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>停損風控 (-%)</label>
                    <input
                      type="number"
                      value={btStopLoss}
                      onChange={e => setBtStopLoss(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>最長持股 (交易日)</label>
                    <input
                      type="number"
                      value={btHoldingDays}
                      onChange={e => setBtHoldingDays(e.target.value)}
                      style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.35rem' }}
                    />
                  </div>
                </div>

                {/* 大盤 MA 多頭排列進場濾網開關 */}
                <div style={{
                  marginTop: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  background: btMarketBullFilter ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: btMarketBullFilter ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.08)'
                }}>
                  <input
                    type="checkbox"
                    id="bt-market-bull-cb"
                    checked={btMarketBullFilter}
                    onChange={e => {
                      setBtMarketBullFilter(e.target.checked);
                      localStorage.setItem('bt_market_bull_filter', e.target.checked);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3B82F6' }}
                  />
                  <label htmlFor="bt-market-bull-cb" style={{ fontSize: '0.85rem', color: '#F1F5F9', cursor: 'pointer', userSelect: 'none', flex: 1 }}>
                    🏛️ <strong>僅在大盤均線多頭排列時才投資 (大盤 MA5 &gt; MA20 &gt; MA60)</strong>
                    <span style={{ display: 'block', fontSize: '0.75rem', color: btMarketBullFilter ? '#93C5FD' : 'var(--text-muted)' }}>
                      {btMarketBullFilter ? '✅ 已啟用：大盤 (0050/加權) 處於強勢多頭排列時才開新倉；大盤回檔走弱時自動空出部位保留現金避險' : '未啟用：不論大盤整體盤勢，只要個股訊號與多頭排列達標即買進'}
                    </span>
                  </label>
                </div>

                {/* 回測結果報告 */}
                {btResult && btResult.metrics && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-color)' }}>
                    <div style={{ fontSize: '0.88rem', color: '#A7F3D0', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                      📋 {btResult.message}
                    </div>

                    {btResult.backtest_details && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        background: 'rgba(59, 130, 246, 0.08)',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        padding: '0.5rem 0.8rem',
                        borderRadius: '8px',
                        marginBottom: '0.9rem',
                        fontSize: '0.82rem',
                        flexWrap: 'wrap'
                      }}>
                        <span>🗓️ 回測區間：<strong style={{ color: '#93C5FD' }}>{btResult.backtest_details.date_range}</strong></span>
                        <span>⏱️ 回測長度：<strong style={{ color: '#FDE68A' }}>{btResult.backtest_details.test_days} 個交易日</strong></span>
                        <span>🎯 標的過濾：<strong style={{ color: '#A7F3D0' }}>{btResult.backtest_details.filters}</strong></span>
                        <span style={{ color: '#CBD5E1', fontSize: '0.75rem', marginLeft: 'auto' }}>
                          💡 欲回測更多筆交易或跨年度數據，可將上方<strong>「測試/回測資料長度」</strong>調大（如 180 或 360 天）
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                      {/* (1) 平均每筆報酬率 */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📊 平均每筆報酬率</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: (btResult.metrics.avg_return_per_trade || 0) >= 0 ? '#34D399' : '#F87171' }}>
                          {(btResult.metrics.avg_return_per_trade || 0) > 0 ? `+${btResult.metrics.avg_return_per_trade}%` : `${btResult.metrics.avg_return_per_trade || 0}%`}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>每筆平均獲利</span>
                      </div>

                      {/* (2) 策略總資產模擬報酬率 (每次投入 1/5 資金) */}
                      <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: '#93C5FD' }}>💼 策略總資產報酬率</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: (btResult.metrics.portfolio_total_return || 0) >= 0 ? '#60A5FA' : '#F87171' }}>
                          {(btResult.metrics.portfolio_total_return || 0) > 0 ? `+${btResult.metrics.portfolio_total_return}%` : `${btResult.metrics.portfolio_total_return || 0}%`}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#93C5FD' }}>每次投入 1/5 (20%) 資金</span>
                      </div>

                      {/* (3) 大盤同期報酬率 */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🏛️ 大盤同期報酬率</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: (btResult.metrics.benchmark_return || 0) >= 0 ? '#FDE68A' : '#F87171' }}>
                          {(btResult.metrics.benchmark_return || 0) > 0 ? `+${btResult.metrics.benchmark_return}%` : `${btResult.metrics.benchmark_return || 0}%`}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>0050 / 加權基準</span>
                      </div>

                      {/* (4) 超額報酬 Alpha (能否打敗大盤) */}
                      <div style={{
                        background: (btResult.metrics.alpha || 0) >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        border: (btResult.metrics.alpha || 0) >= 0 ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        textAlign: 'center'
                      }}>
                        <span style={{ fontSize: '0.75rem', color: (btResult.metrics.alpha || 0) >= 0 ? '#A7F3D0' : '#FCA5A5' }}>🏆 超額報酬 (Alpha)</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: (btResult.metrics.alpha || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                          {(btResult.metrics.alpha || 0) > 0 ? `+${btResult.metrics.alpha}%` : `${btResult.metrics.alpha || 0}%`}
                        </div>
                        <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: (btResult.metrics.alpha || 0) >= 0 ? '#34D399' : '#F87171' }}>
                          {(btResult.metrics.alpha || 0) >= 0 ? '👑 成功擊敗大盤' : '🔴 落後大盤'}
                        </span>
                      </div>

                      {/* (5) 勝率 */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>🎯 交易勝率</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#60A5FA' }}>
                          {btResult.metrics.win_rate}%
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>獲利筆數佔比</span>
                      </div>

                      {/* (6) 盈虧比 */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>盈虧比 (PF)</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F59E0B' }}>
                          {btResult.metrics.profit_factor}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>總獲利 / 總虧損</span>
                      </div>

                      {/* (7) 最大回撤 */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>最大回撤 (MDD)</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#EC4899' }}>
                          {btResult.metrics.max_drawdown}%
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>資產最大回落</span>
                      </div>

                      {/* (8) Sharpe */}
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>夏普比率 (Sharpe)</span>
                        <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#A7F3D0' }}>
                          {btResult.metrics.sharpe_ratio}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>風險調整後收益</span>
                      </div>
                    </div>

                    {/* 回測交易歷史記錄 */}
                    {btResult.trade_logs && btResult.trade_logs.length > 0 && (
                      <div style={{ overflowX: 'auto', maxHeight: '240px' }}>
                        <table style={{ fontSize: '0.85rem' }}>
                          <thead>
                            <tr>
                              <th>進場日</th>
                              <th>出場日</th>
                              <th>股票代號</th>
                              <th>股票名稱</th>
                              <th>進場價</th>
                              <th>出場價</th>
                              <th>報酬率%</th>
                              <th>出場原因</th>
                            </tr>
                          </thead>
                          <tbody>
                            {btResult.trade_logs.map((t, idx) => (
                              <tr key={idx}>
                                <td>{t.entry_date}</td>
                                <td>{t.exit_date}</td>
                                <td style={{ color: '#60A5FA', fontWeight: 'bold' }}>{t.stock_id}</td>
                                <td style={{ fontWeight: 'bold' }}>{t.stock_name}</td>
                                <td>{t.entry_price} 元</td>
                                <td>{t.exit_price} 元</td>
                                <td style={{ fontWeight: 'bold', color: t.return_pct > 0 ? '#FCA5A5' : t.return_pct < 0 ? '#A7F3D0' : 'white' }}>
                                  {t.return_pct > 0 ? `+${t.return_pct}%` : `${t.return_pct}%`}
                                </td>
                                <td>{t.exit_reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>



              {/* 特徵重要性排行榜 */}
              {mlStatus && mlStatus.top_features && mlStatus.top_features.length > 0 && (
                <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '10px', padding: '1rem', border: '1px solid var(--border-color)' }}>
                  <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#A7F3D0' }}>
                    🏆 飆股判定 Top 特徵重要性排行榜 (Feature Importance)
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {mlStatus.top_features.slice(0, 6).map((item, idx) => (
                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                          <span style={{ color: 'white', fontWeight: 'bold' }}>{idx + 1}. {item.feature}</span>
                          <span style={{ color: '#60A5FA' }}>{item.importance}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 預測標的列表 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                🚀 ML 預測「突破勝率與跌破風險雙向評估」推薦清單
              </h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {mlRefreshing && (
                  <span style={{ fontSize: '0.8rem', color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="loader" style={{ width: '12px', height: '12px' }}></span> 背景同步中...
                  </span>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                  onClick={() => fetchMlStatusAndPredictions(null, true)}
                  disabled={mlLoading || mlRefreshing}
                  title="強制重新執行全台股最新特徵推論並更新快取"
                >
                  🔄 強制重算預測
                </button>
              </div>
            </div>

            {mlPredictions && mlPredictions.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => handleMlSort('win_probability')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        🚀 突破勝率 (20%+) {mlSortField === 'win_probability' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('drop_probability')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        ⚠️ 跌破風險 (10%-) {mlSortField === 'drop_probability' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('net_score')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        🛡️ 攻守評等 {mlSortField === 'net_score' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('stock_id')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        股票代號 {mlSortField === 'stock_id' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('stock_name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        股票名稱 {mlSortField === 'stock_name' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('latest_price')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        最新收盤價 {mlSortField === 'latest_price' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('large_holder_ratio')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        千張大戶持股% {mlSortField === 'large_holder_ratio' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('large_holder_change')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        大戶週增減 {mlSortField === 'large_holder_change' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('foreign_buy_days')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        外資連買 {mlSortField === 'foreign_buy_days' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th onClick={() => handleMlSort('trust_buy_days')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                        投信連買 {mlSortField === 'trust_buy_days' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                      </th>
                      <th>動作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedPredictions().map((row, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 'bold' }}>
                          <span style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '4px',
                            background: row.win_probability >= 35 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                            color: row.win_probability >= 35 ? '#FCA5A5' : '#FDE68A',
                            border: row.win_probability >= 35 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                            display: 'inline-block'
                          }}>
                            {row.win_probability}%
                          </span>
                        </td>
                        <td style={{ fontWeight: 'bold' }}>
                          <span style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '4px',
                            background: row.drop_probability >= 40 ? 'rgba(239, 68, 68, 0.25)' : row.drop_probability <= 25 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                            color: row.drop_probability >= 40 ? '#F87171' : row.drop_probability <= 25 ? '#34D399' : 'white',
                            border: row.drop_probability >= 40 ? '1px solid rgba(239, 68, 68, 0.4)' : row.drop_probability <= 25 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                            display: 'inline-block'
                          }}>
                            {row.drop_probability}%
                          </span>
                        </td>
                        <td style={{ fontWeight: 'bold' }}>
                          <span style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '4px',
                            background: row.risk_tag.includes('👑') ? 'rgba(245, 158, 11, 0.25)' : row.risk_tag.includes('🔴') ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.2)',
                            color: row.risk_tag.includes('👑') ? '#FDE68A' : row.risk_tag.includes('🔴') ? '#FCA5A5' : '#93C5FD',
                            border: row.risk_tag.includes('👑') ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
                            display: 'inline-block'
                          }}>
                            {row.risk_tag}
                          </span>
                        </td>
                        <td style={{ fontWeight: 'bold', color: '#60A5FA' }}>{row.stock_id}</td>
                        <td style={{ fontWeight: 'bold' }}>{row.stock_name}</td>
                        <td style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{row.latest_price} 元</td>
                        <td>{row.large_holder_ratio}%</td>
                        <td style={{ color: row.large_holder_change > 0 ? '#FCA5A5' : row.large_holder_change < 0 ? '#A7F3D0' : 'white' }}>
                          {row.large_holder_change > 0 ? `▲${row.large_holder_change}%p` : row.large_holder_change < 0 ? `▼${Math.abs(row.large_holder_change)}%p` : '0%p'}
                        </td>
                        <td>{row.foreign_buy_days > 0 ? `連買 ${row.foreign_buy_days} 天` : '無'}</td>
                        <td>{row.trust_buy_days > 0 ? `連買 ${row.trust_buy_days} 天` : '無'}</td>
                        <td style={{ display: 'flex', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                          <button
                            className="btn btn-save"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                            onClick={() => handleAddWatchlistStockDirectly(row.stock_id)}
                          >
                            ➕ 加至追蹤
                          </button>
                          <button
                            onClick={() => copyAiPrompt(row.stock_id)}
                            style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '0.8rem' }}
                          >
                            📋 複製AI指令
                          </button>
                          <a
                            href={`https://tw.stock.yahoo.com/quote/${row.stock_id}`}
                            target="_blank" rel="noreferrer"
                            style={{ color: '#60A5FA', textDecoration: 'none', fontSize: '0.85rem' }}
                          >🔍 Yahoo</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🤖</div>
                <p style={{ margin: 0, fontSize: '1.05rem' }}>尚無機器學習預測資料。</p>
                <p style={{ margin: '0.5rem 0 1rem 0', fontSize: '0.85rem' }}>點擊上方「🏋️ 重新訓練模型」即可立即進行 AI 模型擬合與全台股波段飆股預測！</p>
                <button
                  type="button"
                  className="btn btn-save"
                  style={{ padding: '0.5rem 1.25rem', fontSize: '0.9rem' }}
                  onClick={handleTrainMLModel}
                  disabled={mlLoading}
                >
                  🏋️ 立即進行 ML 模型訓練與預測
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'low_freq' && (
          <div className="low-freq-container">
            {/* 1. 大盤 60MA 風險濾網看板 */}
            <div style={{
              background: lowFreqData?.market_status?.is_bull 
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.05))' 
                : 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(185, 28, 28, 0.05))',
              border: `1px solid ${lowFreqData?.market_status?.is_bull ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
              borderRadius: '12px',
              padding: '1.25rem 1.5rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>{lowFreqData?.market_status?.is_bull ? '🟢' : '🔴'}</span>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>
                    大盤 60MA 風險濾網：{lowFreqData?.market_status?.status_text || '計算中...'}
                  </h3>
                </div>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  【關鍵保命機制】：若月底最後一個交易日大盤收盤價跌破 60 日季線，次月強制輸出「100% 現金空手」指令，杜絕系統性崩盤回撤。
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.6rem 1.2rem', borderRadius: '8px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>最新收盤</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff' }}>{lowFreqData?.market_status?.close || '--'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>季線 60MA</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-color)' }}>{lowFreqData?.market_status?.ma60 || '--'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>季線乖離率</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: (lowFreqData?.market_status?.diff_pct || 0) >= 0 ? '#10B981' : '#EF4444' }}>
                    {(lowFreqData?.market_status?.diff_pct || 0) >= 0 ? '+' : ''}{lowFreqData?.market_status?.diff_pct || 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* 2. 策略控制與滾動回測設定面板 */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1.15rem', color: '#fff' }}>⚙️ 台股低頻量化波段選股系統 (XGBoost Ranking)</h3>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    換股頻率：每月最後一個交易日產生次月 Top 30 股票清單，採等權重波段持有
                  </div>
                </div>
                <button
                  className="btn btn-save"
                  style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  onClick={handleRunLowFreqBacktest}
                  disabled={lowFreqLoading}
                >
                  {lowFreqLoading ? '⏳ 滾動回測計算中...' : '🚀 執行 XGBoost 滾動量化回測'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                    🔄 滾動窗口長度 (Rolling Window)
                  </label>
                  <select
                    value={lowFreqRollingMonths}
                    onChange={(e) => setLowFreqRollingMonths(parseInt(e.target.value))}
                    style={{ width: '100%', padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }}
                  >
                    <option value={12}>過去 12 個月 (1年) 滾動訓練</option>
                    <option value={24}>過去 24 個月 (2年) 滾動訓練 (推薦)</option>
                    <option value={36}>過去 36 個月 (3年) 滾動訓練</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                    🎯 每月推薦持股檔數 (Top N)
                  </label>
                  <select
                    value={lowFreqTopN}
                    onChange={(e) => setLowFreqTopN(parseInt(e.target.value))}
                    style={{ width: '100%', padding: '0.5rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }}
                  >
                    <option value={15}>Top 15 檔等權重</option>
                    <option value={30}>Top 30 檔等權重 (標準規格)</option>
                    <option value={50}>Top 50 檔等權重</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                    🛡️ 大盤 60MA 風險濾網
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={lowFreqMarketFilter}
                      onChange={(e) => setLowFreqMarketFilter(e.target.checked)}
                      style={{ width: '16px', height: '16px', accentColor: 'var(--accent-color)' }}
                    />
                    <span style={{ fontSize: '0.9rem', color: '#fff' }}>跌破 60MA 強制空手避險</span>
                  </label>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
                    💧 交易池流動性與安全過濾
                  </label>
                  <div style={{ fontSize: '0.85rem', color: '#94A3B8', marginTop: '0.5rem' }}>
                    ✅ 日均金額 ≥ 5000萬 | 排除DR股(91XX) | 排除處置股
                  </div>
                </div>
              </div>
            </div>

            {lowFreqData && lowFreqData.metrics && (
              <>
                {/* 3. 核心量化績效指標看板 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div className="glass-panel" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #10B981' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>📈 年化報酬率 (CAGR)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: lowFreqData.metrics.cagr >= 0 ? '#10B981' : '#EF4444' }}>
                      {lowFreqData.metrics.cagr >= 0 ? '+' : ''}{lowFreqData.metrics.cagr}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      大盤 CAGR: {lowFreqData.metrics.benchmark_cagr}%
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #EF4444' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>🛡️ 最大歷史回撤 (MDD)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#EF4444' }}>
                      -{lowFreqData.metrics.mdd}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      峰值最大資金下跌幅度
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #F59E0B' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>⚖️ 年化夏普值 (Sharpe)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#F59E0B' }}>
                      {lowFreqData.metrics.sharpe}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      無風險利率 1.5%
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #3B82F6' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>👑 超額報酬 (Alpha)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: lowFreqData.metrics.alpha >= 0 ? '#10B981' : '#EF4444' }}>
                      {lowFreqData.metrics.alpha >= 0 ? '+' : ''}{lowFreqData.metrics.alpha}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      總報酬: {lowFreqData.metrics.total_return}% vs 大盤: {lowFreqData.metrics.benchmark_return}%
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: '1.2rem', textAlign: 'center', borderTop: '3px solid #8B5CF6' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>🎯 月度勝率 (Win Rate)</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#8B5CF6' }}>
                      {lowFreqData.metrics.win_rate}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      總測試月份: {lowFreqData.metrics.total_months} 個月
                    </div>
                  </div>
                </div>

                {/* 4. XGBoost 特徵重要性排行 (Top 6 Features) */}
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#fff' }}>📊 XGBoost 核心因子重要性貢獻 (Feature Importance)</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    {lowFreqData.top_features?.map((f, i) => (
                      <div key={f.feature} style={{ background: 'rgba(0,0,0,0.2)', padding: '0.8rem 1rem', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                          <span style={{ color: '#fff', fontWeight: '500' }}>#{i+1} {f.label}</span>
                          <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>{f.importance}%</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, f.importance * 3.5)}%`,
                            height: '100%',
                            background: i === 0 ? '#10B981' : i === 1 ? '#3B82F6' : i === 2 ? '#F59E0B' : '#8B5CF6',
                            borderRadius: '4px'
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. 次月推薦買進 Top 30 股票清單 */}
                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
                    <div>
                      <h3 style={{ margin: '0 0 0.3rem 0', fontSize: '1.2rem', color: '#fff' }}>
                        🌟 次月推薦買進 Top 30 股票清單 (Next Month's Portfolio)
                      </h3>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        產生時間: {lowFreqData.generated_at} | 依 XGBoost 橫向排名預測得分由高至低排列
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#10B981', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', padding: '0.4rem 0.8rem', borderRadius: '6px' }}>
                      💼 建議資金配置：每檔股票投入 1/{lowFreqData.top30_recommendations?.length || 30} 等權重波段持有
                    </div>
                  </div>

                  <div className="table-responsive">
                    <table className="stock-table">
                      <thead>
                        <tr>
                          <th onClick={() => handleLowFreqSort('rank')} style={{ cursor: 'pointer' }}>
                            排名 {lowFreqSortField === 'rank' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th>股票代號/名稱</th>
                          <th onClick={() => handleLowFreqSort('pred_score')} style={{ cursor: 'pointer' }}>
                            AI 預測分數 {lowFreqSortField === 'pred_score' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('close')} style={{ cursor: 'pointer' }}>
                            收盤價 {lowFreqSortField === 'close' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('avg_value_billion')} style={{ cursor: 'pointer' }}>
                            日均成交額 {lowFreqSortField === 'avg_value_billion' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('rev_yoy_3m')} style={{ cursor: 'pointer' }}>
                            近3月營收YoY {lowFreqSortField === 'rev_yoy_3m' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('pe_ratio')} style={{ cursor: 'pointer' }}>
                            本益比 {lowFreqSortField === 'pe_ratio' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('bias_60d')} style={{ cursor: 'pointer' }}>
                            季線乖離率 {lowFreqSortField === 'bias_60d' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('foreign_buy_ratio_5d')} style={{ cursor: 'pointer' }}>
                            外資5日買超比 {lowFreqSortField === 'foreign_buy_ratio_5d' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th onClick={() => handleLowFreqSort('trust_consec_days')} style={{ cursor: 'pointer' }}>
                            投信連買 {lowFreqSortField === 'trust_consec_days' && (lowFreqSortOrder === 'asc' ? '▲' : '▼')}
                          </th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedLowFreqTop30().map(stock => (
                          <tr key={stock.stock_id}>
                            <td style={{ fontWeight: 'bold', color: stock.rank <= 3 ? '#F59E0B' : 'var(--text-muted)' }}>
                              {stock.rank <= 3 ? `👑 #${stock.rank}` : `#${stock.rank}`}
                            </td>
                            <td>
                              <span style={{ fontWeight: 'bold', color: '#fff', marginRight: '0.4rem' }}>{stock.stock_id}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{stock.stock_name}</span>
                            </td>
                            <td>
                              <span style={{
                                fontWeight: 'bold',
                                color: stock.pred_score >= 70 ? '#10B981' : stock.pred_score >= 60 ? '#3B82F6' : '#F59E0B',
                                background: stock.pred_score >= 70 ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px'
                              }}>
                                {stock.pred_score} 分
                              </span>
                            </td>
                            <td style={{ fontWeight: 'bold', color: '#fff' }}>{stock.close}</td>
                            <td>{stock.avg_value_billion} 億</td>
                            <td style={{ color: stock.rev_yoy_3m >= 0 ? '#EF4444' : '#10B981', fontWeight: '500' }}>
                              {stock.rev_yoy_3m >= 0 ? '+' : ''}{Number(stock.rev_yoy_3m).toFixed(1)}%
                            </td>
                            <td>{Number(stock.pe_ratio).toFixed(1)}x</td>
                            <td style={{ color: stock.bias_60d >= 0 ? '#EF4444' : '#10B981' }}>
                              {stock.bias_60d >= 0 ? '+' : ''}{stock.bias_60d}%
                            </td>
                            <td style={{ color: stock.foreign_buy_ratio_5d >= 0 ? '#EF4444' : '#10B981' }}>
                              {stock.foreign_buy_ratio_5d >= 0 ? '+' : ''}{stock.foreign_buy_ratio_5d}%
                            </td>
                            <td style={{ fontWeight: stock.trust_consec_days > 0 ? 'bold' : 'normal', color: stock.trust_consec_days > 0 ? '#F59E0B' : 'var(--text-muted)' }}>
                              {stock.trust_consec_days > 0 ? `🔥 ${stock.trust_consec_days} 天` : '0 天'}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-save"
                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                                onClick={() => handleAddWatchlistStockDirectly(stock.stock_id)}
                              >
                                + 追蹤
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 6. 月度換股歷史明細與資產曲線記錄 */}
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#fff' }}>📜 歷史月度換股與損益軌跡</h3>
                  <div className="table-responsive">
                    <table className="stock-table">
                      <thead>
                        <tr>
                          <th>月份</th>
                          <th>交易日期</th>
                          <th>策略動作</th>
                          <th>當月策略報酬率</th>
                          <th>當月大盤報酬率</th>
                          <th>累積資產淨值</th>
                          <th>當期 Top 5 股票範例</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lowFreqData.portfolio_history?.slice().reverse().map(h => (
                          <tr key={h.year_month}>
                            <td style={{ fontWeight: 'bold', color: '#fff' }}>{h.year_month}</td>
                            <td>{h.date}</td>
                            <td>
                              <span style={{
                                color: h.market_bull ? '#10B981' : '#EF4444',
                                background: h.market_bull ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold'
                              }}>
                                {h.action}
                              </span>
                            </td>
                            <td style={{ fontWeight: 'bold', color: h.portfolio_return >= 0 ? '#10B981' : '#EF4444' }}>
                              {h.portfolio_return >= 0 ? '+' : ''}{h.portfolio_return}%
                            </td>
                            <td style={{ color: h.benchmark_return >= 0 ? '#10B981' : '#EF4444' }}>
                              {h.benchmark_return >= 0 ? '+' : ''}{h.benchmark_return}%
                            </td>
                            <td style={{ fontWeight: 'bold', color: '#fff' }}>
                              {h.capital} 萬
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {h.top_stocks?.map(s => (
                                  <span key={s.stock_id} style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                    {s.stock_id} {s.stock_name} ({s.actual_ret !== null && s.actual_ret !== undefined ? (s.actual_ret >= 0 ? `+${s.actual_ret}%` : `${s.actual_ret}%`) : '--'})
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div>
            {/* API Key與伺服器設定控制列 */}
            <div className="api-key-block" style={{ padding: '1rem 1.25rem', gap: '1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ background: 'linear-gradient(135deg, #4F46E5, #3730A3)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  onClick={() => { fetchSettings(); setShowSettingsModal(true); }}
                >
                  ⚙️ Gemini 後端自動化設定
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  onClick={handleAnalyzeAll}
                >
                  🔄 一鍵背景分析已選持股
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>🔑 臨時瀏覽器金鑰:</span>
                  <input
                    type="password"
                    placeholder="優先使用此處金鑰 (選填)"
                    value={geminiApiKey}
                    onChange={e => {
                      setGeminiApiKey(e.target.value);
                      localStorage.setItem('gemini_api_key', e.target.value);
                    }}
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'white',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.85rem',
                      width: '180px'
                    }}
                  />
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  ※ 優先使用您填寫的臨時金鑰；若無則使用後端設定之金鑰。
                </span>
              </div>
            </div>

            {/* 新增持股表單 */}
            <form onSubmit={handleAddPortfolio} className="portfolio-form-grid">
              <div className="portfolio-form-field">
                <label htmlFor="stock-id-input">股票代號</label>
                <input
                  id="stock-id-input"
                  type="text"
                  placeholder="例如：2330"
                  required
                  value={portfolioInput.stock_id}
                  onChange={e => handleStockIdChange(e.target.value)}
                />
              </div>
              <div className="portfolio-form-field">
                <label htmlFor="buy-price-input">購入成本均價 (選填)</label>
                <input
                  id="buy-price-input"
                  type="number"
                  step="0.01"
                  placeholder="例如：900"
                  value={portfolioInput.buy_price || ''}
                  onChange={e => setPortfolioInput(p => ({ ...p, buy_price: e.target.value }))}
                />
              </div>
              <div className="portfolio-form-field">
                <label htmlFor="notes-input">個人筆記 / 交易備註 (選填)</label>
                <input
                  id="notes-input"
                  type="text"
                  placeholder="例如：長期投資、跌破月線減碼"
                  value={portfolioInput.notes || ''}
                  onChange={e => setPortfolioInput(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
              <div className="portfolio-form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem', alignSelf: 'center', marginTop: '1.2rem' }}>
                <input
                  id="auto-analyze-checkbox"
                  type="checkbox"
                  checked={portfolioInput.auto_analyze}
                  onChange={e => setPortfolioInput(p => ({ ...p, auto_analyze: e.target.checked }))}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', margin: 0 }}
                />
                <label htmlFor="auto-analyze-checkbox" style={{ margin: 0, cursor: 'pointer', userSelect: 'none', fontWeight: 'normal', fontSize: '0.9rem' }}>自動排程分析</label>
              </div>
              <button type="submit" className="btn btn-save" style={{ height: '38px', padding: '0 1.5rem' }}>
                ➕ 新增/更新持股
              </button>
            </form>

            {/* 🤖 AI 20天勝率預測模型選擇與控制工具列 */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '10px',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.9rem', color: '#93C5FD', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🤖 AI 20天勝率預測模型:
                </span>
                <select
                  value={portfolioMlModel}
                  onChange={e => {
                    const newModel = e.target.value;
                    setPortfolioMlModel(newModel);
                    try { localStorage.setItem('portfolio_ml_model', newModel); } catch {}
                    fetchPortfolioMlPredictions(newModel);
                  }}
                  style={{
                    background: 'rgba(0,0,0,0.5)',
                    color: 'white',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '0.4rem 0.75rem',
                    fontSize: '0.86rem',
                    minWidth: '280px'
                  }}
                >
                  <option value="lightgbm">🌟 LightGBM (推薦 - 極速高精準度)</option>
                  <option value="xgboost">🔥 XGBoost (強力正規化防過擬合)</option>
                  <option value="attention_bilstm_xgb">🔥 Attention BiLSTM-XGBoost (注意力雙向 LSTM)</option>
                  <option value="resnet50">🧬 ResNet-50 (1D 殘差卷積 50 層)</option>
                  <option value="tft">🔮 TFT (時序融合 Transformer)</option>
                  <option value="vsn_xlstm">🧬 VSN-xLSTM (多變數選擇 xLSTM)</option>
                  <option value="patchtst">🧩 PatchTST (分塊時序 Transformer)</option>
                  <option value="cnn_hybrid">⚡ CNN-Hybrid (圖形+籌碼混合)</option>
                  <option value="mlp">🧠 Deep Neural Network (MLP 深度神經網路)</option>
                  <option value="rf">🌲 Random Forest (隨機森林 - 穩健抗噪)</option>
                  <option value="lr">📊 Logistic Regression (線性 Baseline)</option>
                </select>
                <button
                  type="button"
                  className="btn btn-save"
                  style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  onClick={() => fetchPortfolioMlPredictions(portfolioMlModel)}
                  disabled={fetchingPortfolioMl}
                >
                  {fetchingPortfolioMl ? (
                    <>
                      <span className="loader" style={{ width: '12px', height: '12px' }}></span>
                      <span>預測計算中...</span>
                    </>
                  ) : (
                    <span>🚀 預測所有持股 20 天勝率</span>
                  )}
                </button>
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                💡 透過 <strong>{portfolioMlModel.toUpperCase()}</strong> 模型評估持股未來 20 交易日內漲幅突破 20% 之勝率與跌破風險
              </div>
            </div>

            {/* 持股表格 (凍結前 6 欄: 股票代號、名稱、自動分析、均價、最新價、預估損益) */}
            {portfolioList && portfolioList.length > 0 ? (
              <div className="portfolio-table-container">
                <table className="portfolio-sticky-table">
                  <thead>
                    <tr>
                      <th className="portfolio-sticky-col-0">股票代號</th>
                      <th className="portfolio-sticky-col-1">股票名稱</th>
                      <th className="portfolio-sticky-col-2" style={{ textAlign: 'center' }}>自動分析</th>
                      <th className="portfolio-sticky-col-3">購入均價</th>
                      <th className="portfolio-sticky-col-4">最新股價</th>
                      <th className="portfolio-sticky-col-5">預估損益</th>
                      <th>🚀 20天突破勝率 (≥20%)</th>
                      <th>⚠️ 20天跌破風險 (≤-10%)</th>
                      <th>🛡️ AI 攻守評等</th>
                      <th>當日診斷</th>
                      <th>熱度分數</th>
                      <th>網友氛圍</th>
                      <th>備註</th>
                      <th style={{ textAlign: 'center' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioList.map((item) => {
                      const hasCost = item.buy_price !== null && item.buy_price > 0;
                      const hasPrice = item.latest_price !== null;
                      let roi = null;
                      let roiText = '-';
                      let roiClass = 'text-flat';

                      if (hasCost && hasPrice) {
                        roi = ((item.latest_price - item.buy_price) / item.buy_price) * 100;
                        roiText = `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
                        if (roi > 0.001) roiClass = 'text-up'; // Red for up in Taiwan
                        else if (roi < -0.001) roiClass = 'text-down'; // Green for down in Taiwan
                      }

                      const pred = portfolioPredictions[item.stock_id] || {};
                      const hasPred = pred.win_probability !== undefined && pred.win_probability > 0;

                      return (
                        <tr key={item.stock_id}>
                          <td className="portfolio-sticky-col-0"><strong>{item.stock_id}</strong></td>
                          <td className="portfolio-sticky-col-1">{item.stock_name}</td>
                          <td className="portfolio-sticky-col-2" style={{ textAlign: 'center' }}>
                            <input 
                              type="checkbox" 
                              checked={item.auto_analyze === 1} 
                              onChange={() => handleToggleAutoAnalyze(item.stock_id)} 
                              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                            />
                          </td>
                          <td className="portfolio-sticky-col-3">{hasCost ? `$${item.buy_price.toFixed(2)}` : '未提供'}</td>
                          <td className="portfolio-sticky-col-4">{hasPrice ? `$${item.latest_price.toFixed(2)}` : '無最新價'}</td>
                          <td className={`portfolio-sticky-col-5 ${roiClass}`}>{roiText}</td>
                          {/* 🚀 AI 20天突破勝率 */}
                          <td style={{ fontWeight: 'bold' }}>
                            {hasPred ? (
                              <span style={{
                                padding: '0.2rem 0.55rem',
                                borderRadius: '4px',
                                background: pred.win_probability >= 35 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                color: pred.win_probability >= 35 ? '#FCA5A5' : '#FDE68A',
                                border: pred.win_probability >= 35 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                                display: 'inline-block',
                                fontSize: '0.85rem'
                              }}>
                                🚀 {pred.win_probability}%
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                          {/* ⚠️ AI 20天跌破風險 */}
                          <td style={{ fontWeight: 'bold' }}>
                            {hasPred ? (
                              <span style={{
                                padding: '0.2rem 0.55rem',
                                borderRadius: '4px',
                                background: pred.drop_probability >= 40 ? 'rgba(239, 68, 68, 0.25)' : pred.drop_probability <= 25 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                color: pred.drop_probability >= 40 ? '#F87171' : pred.drop_probability <= 25 ? '#34D399' : 'white',
                                border: pred.drop_probability >= 40 ? '1px solid rgba(239, 68, 68, 0.4)' : pred.drop_probability <= 25 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                                display: 'inline-block',
                                fontSize: '0.85rem'
                              }}>
                                ⚠️ {pred.drop_probability}%
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                          {/* 🛡️ AI 攻守評等 */}
                          <td style={{ fontWeight: 'bold' }}>
                            {hasPred && pred.risk_tag ? (
                              <span style={{
                                padding: '0.2rem 0.55rem',
                                borderRadius: '4px',
                                background: pred.risk_tag.includes('👑') ? 'rgba(245, 158, 11, 0.25)' : pred.risk_tag.includes('🔴') ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.2)',
                                color: pred.risk_tag.includes('👑') ? '#FDE68A' : pred.risk_tag.includes('🔴') ? '#FCA5A5' : '#93C5FD',
                                border: pred.risk_tag.includes('👑') ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
                                display: 'inline-block',
                                fontSize: '0.8rem'
                              }}>
                                {pred.risk_tag}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>計算中</span>
                            )}
                          </td>
                          <td>
                            {item.sentiment_score !== null && item.sentiment_score !== undefined ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '95px' }}>
                                <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px', height: '8px', overflow: 'hidden', position: 'relative' }}>
                                  <div style={{ 
                                    width: `${item.sentiment_score}%`, 
                                    height: '100%', 
                                    background: item.sentiment_score >= 80 ? 'linear-gradient(90deg, #F59E0B, #EF4444)' : item.sentiment_score >= 50 ? 'linear-gradient(90deg, #3B82F6, #10B981)' : 'linear-gradient(90deg, #6B7280, #3B82F6)',
                                    boxShadow: item.sentiment_score >= 80 ? '0 0 8px rgba(239, 68, 68, 0.6)' : 'none'
                                  }} />
                                </div>
                                <span style={{ fontSize: '0.85rem', fontWeight: '600', color: item.sentiment_score >= 80 ? '#EF4444' : '#E5E7EB' }}>
                                  {item.sentiment_score.toFixed(0)}%
                                </span>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>-</span>
                            )}
                          </td>
                          <td>
                            {item.sentiment_direction ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <span className={`sentiment-badge`} style={{
                                  padding: '0.2rem 0.5rem',
                                  borderRadius: '12px',
                                  fontSize: '0.8rem',
                                  fontWeight: '600',
                                  backgroundColor: item.sentiment_direction === '看多' ? 'rgba(239, 68, 68, 0.2)' : item.sentiment_direction === '看空' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                                  color: item.sentiment_direction === '看多' ? '#EF4444' : item.sentiment_direction === '看空' ? '#10B981' : '#9CA3AF',
                                  border: `1px solid ${item.sentiment_direction === '看多' ? 'rgba(239, 68, 68, 0.4)' : item.sentiment_direction === '看空' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(107, 114, 128, 0.4)'}`
                                }}>
                                  {item.sentiment_direction}
                                </span>
                                {item.has_rumor && item.has_rumor !== '無' && item.has_rumor !== 'none' && (
                                  <span 
                                    className="rumor-alert-icon" 
                                    style={{ cursor: 'help', animation: 'pulse-rumor 1.5s infinite', fontSize: '0.95rem' }} 
                                    title={`⚠️ 小道消息：${item.has_rumor}`}
                                  >
                                    ⚠️
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>-</span>
                            )}
                          </td>
                          <td style={{ color: item.notes ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.notes}>
                            {item.notes || '無'}
                          </td>
                          <td style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.4rem 0.6rem',
                                fontSize: '0.85rem',
                                background: 'linear-gradient(135deg, #4F46E5, #06B6D4)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                minWidth: '100px',
                                justifyContent: 'center'
                              }}
                              onClick={() => handleAnalyzeStock(item.stock_id)}
                              disabled={analyzingId !== null}
                            >
                              {analyzingId === item.stock_id ? (
                                <>
                                  <span className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
                                  <span>分析中...</span>
                                </>
                              ) : (
                                <span>🤖 診斷</span>
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              onClick={() => viewHistory(item.stock_id, item.stock_name)}
                            >
                              📜 歷史
                            </button>
                            <a
                              href={`https://tw.stock.yahoo.com/quote/${item.stock_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary"
                              style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                            >
                              🔍 Yahoo
                            </a>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: '#EF4444' }}
                              onClick={() => handleDeletePortfolio(item.stock_id)}
                            >
                              🗑️ 刪除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💼</div>
                <p style={{ margin: 0, fontSize: '1rem' }}>目前尚未建立任何持股追蹤。</p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>請在上方輸入股票代號（如 2330），即可開始追蹤其股價與 Gemini 智能診斷分析！</p>
              </div>
            )}

            {/* Gemini 分析報告呈現區 */}
            {analysisResult && (
              <div className="analysis-container">
                <div className="analysis-header">
                  <h3 className="analysis-title">
                    <span>🤖 Gemini 持股智慧健檢報告：{analysisResult.stock_id} {analysisResult.stock_name}</span>
                  </h3>
                  <button className="close-btn" onClick={() => setAnalysisResult(null)} title="關閉報告">×</button>
                </div>

                {analysisResult.news && analysisResult.news.length > 0 && (
                  <div className="news-section">
                    <h4 className="news-title">📰 今日 Yahoo 股市最新新聞</h4>
                    <ul className="news-list">
                      {analysisResult.news.map((item, idx) => (
                        <li key={idx} className="news-item">
                          <a href={item.link} target="_blank" rel="noreferrer">
                            {item.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.25rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <MarkdownRenderer text={analysisResult.analysis} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== 資料庫檢視 ===== */}
        {activeTab === 'database' && (
          <div className="filter-section" style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1.25rem' }}>📊 選擇後端資料庫資料表</h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className={`btn ${activeDbTable === 'daily_stock' ? '' : 'btn-secondary'}`}
                onClick={() => loadDatabase('daily_stock')}
                disabled={loading}
              >
                📅 每日股價 (daily_stock)
              </button>
              <button
                className={`btn ${activeDbTable === 'monthly_revenue' ? '' : 'btn-secondary'}`}
                onClick={() => loadDatabase('monthly_revenue')}
                disabled={loading}
              >
                📈 每月營收 (monthly_revenue)
              </button>
              <button
                className={`btn ${activeDbTable === 'institutional_trades' ? '' : 'btn-secondary'}`}
                onClick={() => loadDatabase('institutional_trades')}
                disabled={loading}
              >
                🏢 三大法人買賣超 (institutional_trades)
              </button>
              <button
                className={`btn ${activeDbTable === 'institutional_futures' ? '' : 'btn-secondary'}`}
                onClick={() => loadDatabase('institutional_futures')}
                disabled={loading}
              >
                📊 期貨未平倉 (institutional_futures)
              </button>
              <button
                className={`btn ${activeDbTable === 'shareholder_concentration' ? '' : 'btn-secondary'}`}
                onClick={() => loadDatabase('shareholder_concentration')}
                disabled={loading}
              >
                👥 股權分散表 (shareholder_concentration)
              </button>
            </div>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem', color: 'var(--text-muted)' }}>
                <span className="loader" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></span>
                <span>正在載入資料庫資料...</span>
              </div>
            )}
          </div>
        )}

        {/* ===== 爬蟲控制 ===== */}
        {activeTab === 'scraper' && (
          <div className="filter-section" style={{ maxWidth: '600px', margin: '0 auto', marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1.25rem', textAlign: 'center' }}>⚡ 爬蟲控制與資料補齊</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem', textAlign: 'center', lineHeight: '1.6' }}>
              若要同步或下載最新台股市場資料，請觸發下方對應的爬蟲任務。<br />
              任務啟動後會以非同步背景程序在伺服器端執行，不會阻礙網頁操作。
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <button
                className="btn"
                onClick={() => runScraper('daily')}
                disabled={loading}
              >
                📅 抓取補齊每日股價
              </button>
              <button
                className="btn"
                onClick={() => runScraper('revenue')}
                disabled={loading}
              >
                📈 抓取最新月營收
              </button>
            </div>
            {scraperStatus && (
              <div style={{
                padding: '1rem',
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                textAlign: 'center',
                fontSize: '0.95rem',
                color: '#34D399',
                marginTop: '1rem'
              }}>
                {scraperStatus}
              </div>
            )}
          </div>
        )}

        {/* ===== 排程管理 ===== */}
        {activeTab === 'schedule' && (
          <div className="schedule-container">
            <div className="schedule-card">
              <div className="schedule-row">
                <div className="schedule-label">
                  <span className="schedule-title-text">啟用自動化排程</span>
                  <span className="schedule-desc-text">開啟後，系統將在每日設定時間自動背景撈取資料並診斷持股。</span>
                </div>
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={scheduleConfig.enabled}
                      onChange={e => setScheduleConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="schedule-row">
                <div className="schedule-label">
                  <span className="schedule-title-text">每日執行時間</span>
                  <span className="schedule-desc-text">設定每日自動觸發任務的精確時間 (HH:MM)。</span>
                </div>
                <div>
                  <input
                    type="time"
                    className="time-select-input"
                    value={scheduleConfig.time}
                    onChange={e => setScheduleConfig(prev => ({ ...prev, time: e.target.value }))}
                    disabled={!scheduleConfig.enabled}
                  />
                </div>
              </div>

              <div className="schedule-row">
                <div className="schedule-label">
                  <span className="schedule-title-text">自動更新每日股價</span>
                  <span className="schedule-desc-text">排程執行時，自動執行爬蟲補齊最新交易日之每日股價及三大法人資料。</span>
                </div>
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={scheduleConfig.scrape_daily ?? true}
                      onChange={e => setScheduleConfig(prev => ({ ...prev, scrape_daily: e.target.checked }))}
                      disabled={!scheduleConfig.enabled}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="schedule-row">
                <div className="schedule-label">
                  <span className="schedule-title-text">自動抓取每月營收</span>
                  <span className="schedule-desc-text">排程執行時，自動連線抓取並更新最新月份之營收數據。</span>
                </div>
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={scheduleConfig.scrape_revenue ?? true}
                      onChange={e => setScheduleConfig(prev => ({ ...prev, scrape_revenue: e.target.checked }))}
                      disabled={!scheduleConfig.enabled}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="schedule-row">
                <div className="schedule-label">
                  <span className="schedule-title-text">自動進行 AI 持股分析</span>
                  <span className="schedule-desc-text">排程執行時，自動對已勾選自動分析的持股進行 Gemini AI 診斷健檢。</span>
                </div>
                <div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={scheduleConfig.analyze ?? true}
                      onChange={e => setScheduleConfig(prev => ({ ...prev, analyze: e.target.checked }))}
                      disabled={!scheduleConfig.enabled}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              <div className="schedule-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
                <span className="schedule-title-text" style={{ fontSize: '0.95rem', color: '#34D399' }}>ℹ️ 開盤日自動確認與排程規則</span>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.6' }}>
                  <li><strong>開盤日過濾</strong>：排程觸發時會自動確認當天是否為台股開盤日（排除週六、週日、國定假日及補班不交易日）。若無開盤則自動跳過，不重複消耗 API 額度。</li>
                  <li><strong>極速生效</strong>：儲存後的設定將在 30 秒內由後端排程執行緒載入，無需重啟伺服器。</li>
                  <li><strong>時間提醒</strong>：建議設定在 06:00 之後（以確保健檢前爬蟲可完成，亦可於下午 14:00 後設定補撈當天最新收盤數據）。</li>
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'center' }}>
              <button
                className="btn btn-save"
                onClick={handleSaveSchedule}
                disabled={savingSchedule}
                style={{ minWidth: '120px' }}
              >
                {savingSchedule ? <span className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span> : '💾 儲存設定'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleResetSchedule}
                disabled={savingSchedule}
                style={{ minWidth: '120px' }}
              >
                ↺ 還原預設
              </button>
            </div>
          </div>
        )}

        {/* ===== Podcast 觀點 ===== */}
        {activeTab === 'podcast' && (
          <div>
            {/* 新增與恢復 Podcast 頻道表單 */}
            <form onSubmit={handleAddPodcastChannel} className="portfolio-form-grid" style={{ marginBottom: '2rem' }}>
              <div className="portfolio-form-field" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="podcast-url-input">新增追蹤 Podcast 頻道 (Apple Podcast 連結)</label>
                <input
                  id="podcast-url-input"
                  type="text"
                  placeholder="請貼上 Apple Podcast 節目網址，例如：https://podcasts.apple.com/tw/podcast/gooaye-%E8%82%A1%E7%99%8C/id1500839292"
                  value={podcastUrlInput}
                  onChange={e => setPodcastUrlInput(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-save" style={{ height: '38px', padding: '0 1.5rem' }} disabled={addingChannel}>
                  {addingChannel ? <span className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span> : '➕ 新增頻道'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '38px', padding: '0 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}
                  onClick={handleRestoreDefaultPodcastChannels}
                  disabled={addingChannel}
                >
                  🔄 恢復推薦頻道 (股癌、財經皓角)
                </button>
              </div>
            </form>

            {/* 追蹤頻道清單 */}
            {podcastChannels && podcastChannels.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#60A5FA' }}>📻 追蹤中的 Podcast 頻道</h3>
                <div className="podcast-channels-grid">
                  {podcastChannels.map(channel => (
                    <div 
                      key={channel.channel_id} 
                      className={`podcast-channel-card ${selectedPodcastChannelId === channel.channel_id ? 'active' : ''}`}
                      onClick={(e) => {
                        if (e.target.closest('button') || e.target.closest('select')) {
                          return;
                        }
                        const nextId = selectedPodcastChannelId === channel.channel_id ? null : channel.channel_id;
                        setSelectedPodcastChannelId(nextId);
                        fetchPodcastEpisodes(nextId);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {selectedPodcastChannelId === channel.channel_id && (
                        <span style={{ position: 'absolute', top: '10px', right: '10px', background: '#4F46E5', color: 'white', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '20px', fontWeight: 'bold', zIndex: 5 }}>
                          📌 篩選中
                        </span>
                      )}
                      <img src={channel.artwork_url} alt={channel.name} className="podcast-channel-artwork" />
                      <div className="podcast-channel-info">
                        <h4 className="podcast-channel-title" title={channel.name}>{channel.name}</h4>
                        <p className="podcast-channel-artist" title={channel.artist_name}>{channel.artist_name}</p>
                        <div className="podcast-channel-actions">
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            onClick={() => handleRefreshPodcastChannel(channel.channel_id)}
                            disabled={refreshingChannelId === channel.channel_id}
                          >
                            {refreshingChannelId === channel.channel_id ? (
                              <span className="loader" style={{ width: '10px', height: '10px', borderWidth: '2px' }}></span>
                            ) : (
                              '🔄 刷新單集'
                            )}
                          </button>
                          <button
                            className="btn"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#EF4444' }}
                            onClick={() => handleDeletePodcastChannel(channel.channel_id, channel.name)}
                          >
                            🗑️ 刪除
                          </button>
                        </div>

                        {/* 批次分析最新 N 集控制項 */}
                        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>分析最新:</span>
                          <select
                            value={batchLimits[channel.channel_id] || 5}
                            onChange={e => setBatchLimits(prev => ({ ...prev, [channel.channel_id]: parseInt(e.target.value) }))}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              color: 'white',
                              padding: '2px 4px',
                              fontSize: '0.75rem',
                              cursor: 'pointer'
                            }}
                          >
                            <option value={1}>1 集</option>
                            <option value={3}>3 集</option>
                            <option value={5}>5 集</option>
                            <option value={10}>10 集</option>
                          </select>
                          <button
                            className="btn btn-save"
                            style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={() => handleBatchAnalyzeChannel(channel.channel_id, batchLimits[channel.channel_id] || 5)}
                            disabled={batchAnalyzingChannelId === channel.channel_id}
                          >
                            {batchAnalyzingChannelId === channel.channel_id ? (
                              <span className="loader" style={{ width: '8px', height: '8px', borderWidth: '1.5px' }}></span>
                            ) : (
                              '🚀 批次分析'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 單集清單 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2rem 0 1rem 0' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#34D399' }}>
                🎙️ 最新節目單集與 AI 轉譯診斷 {selectedPodcastChannelId ? ` (已篩選頻道)` : ''}
              </h3>
              {selectedPodcastChannelId && (
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                  onClick={() => {
                    setSelectedPodcastChannelId(null);
                    fetchPodcastEpisodes(null);
                  }}
                >
                  🌐 顯示所有單集
                </button>
              )}
            </div>
            {podcastEpisodes && podcastEpisodes.length > 0 ? (
              <div className="podcast-episodes-grid">
                {podcastEpisodes.map(ep => {
                  const channel = podcastChannels.find(c => c.channel_id === ep.channel_id);
                  const channelName = channel ? channel.name : '未命名頻道';
                  const durationMin = ep.duration ? Math.round(parseInt(ep.duration) / 60) : null;
                  
                  return (
                    <div key={ep.episode_guid} className="podcast-episode-card">
                      <div className="podcast-episode-header">
                        <div>
                          <span style={{ fontSize: '0.8rem', color: '#818CF8', fontWeight: 'bold', display: 'block', marginBottom: '0.25rem' }}>
                            🎧 {channelName}
                          </span>
                          <h4 className="podcast-episode-title">{ep.title}</h4>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                          <span className={`podcast-status-badge ${ep.status}`}>
                            {ep.status === 'pending' && '⚪ 未分析'}
                            {ep.status === 'transcribing' && '⏳ 語音分析中'}
                            {ep.status === 'completed' && '✅ 分析完成'}
                            {ep.status === 'failed' && '❌ 分析失敗'}
                          </span>
                          {ep.status === 'pending' && (
                            <button
                              className="btn"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'linear-gradient(135deg, #4F46E5, #06B6D4)' }}
                              onClick={() => handleTranscribeEpisode(ep.episode_guid)}
                            >
                              🤖 語音分析
                            </button>
                          )}
                          {ep.status === 'failed' && (
                            <button
                              className="btn"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', background: 'linear-gradient(135deg, #4F46E5, #06B6D4)' }}
                              onClick={() => handleTranscribeEpisode(ep.episode_guid)}
                            >
                              🔄 重試
                            </button>
                          )}
                          {ep.status === 'transcribing' && (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>請在背景稍候...</span>
                          )}
                          {ep.status === 'completed' && (
                            <button
                              className="btn btn-save"
                              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                              onClick={() => {
                                setSelectedEpisode(ep);
                                setPodcastModalTab('analysis');
                                setShowEpisodeModal(true);
                              }}
                            >
                              📝 檢視分析報告
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="podcast-episode-meta">
                        <span>📅 發佈於: {ep.pub_date}</span>
                        {durationMin && <span>⏱️ 時長: {durationMin} 分鐘</span>}
                      </div>

                      <p className="podcast-episode-desc" style={{ 
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {ep.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎙️</div>
                <p style={{ margin: 0, fontSize: '1.05rem' }}>目前尚無任何單集紀錄。</p>
                <p style={{ margin: '0.5rem 0 1rem 0', fontSize: '0.85rem' }}>請在上方新增 Apple Podcast 網址，或點擊下方按鈕一鍵恢復推薦頻道！</p>
                <button
                  type="button"
                  className="btn btn-save"
                  style={{ padding: '0.5rem 1.25rem', fontSize: '0.9rem' }}
                  onClick={handleRestoreDefaultPodcastChannels}
                  disabled={addingChannel}
                >
                  🔄 一鍵恢復推薦頻道 (股癌、財經皓角)
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== 追蹤與警示清單 ===== */}
        {activeTab === 'watchlist' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>🔔 追蹤與警示設定</h2>
              <button
                className="btn"
                style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                onClick={handleManualCheckAlerts}
                disabled={checkingAlerts}
              >
                {checkingAlerts ? (
                  <>
                    <span className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
                    <span>正在檢查警示...</span>
                  </>
                ) : (
                  <span>🔔 立即檢查所有警示</span>
                )}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', marginBottom: '2rem' }}>
              {/* 警示歷史記錄 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>📋 警示歷史通知 (最近 50 筆)</h3>
                  {watchlistAlerts.length > 0 && (
                    <button
                      className="btn"
                      style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgb(239, 68, 68)', color: '#FCA5A5', padding: '0.3rem 0.7rem', fontSize: '0.85rem' }}
                      onClick={handleClearAlerts}
                    >
                      🧹 清空歷史紀錄
                    </button>
                  )}
                </div>
                
                {watchlistAlerts.length > 0 ? (
                  <div style={{ maxHeight: '250px', overflowY: 'auto', borderRadius: '8px' }}>
                    <table style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>時間</th>
                          <th>股票</th>
                          <th>警示類型</th>
                          <th>詳細說明</th>
                          <th>觸發價格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {watchlistAlerts.map(alert => (
                          <tr key={alert.id}>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{alert.triggered_at}</td>
                            <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{alert.stock_id} {alert.stock_name}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <span style={{
                                padding: '0.2rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                background: alert.alert_type.includes('high') || alert.alert_type.includes('above') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: alert.alert_type.includes('high') || alert.alert_type.includes('above') ? '#A7F3D0' : '#FCA5A5',
                                border: alert.alert_type.includes('high') || alert.alert_type.includes('above') ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)'
                              }}>
                                {alert.alert_type === 'price_high' ? '大於上限' :
                                 alert.alert_type === 'price_low' ? '小於下限' :
                                 alert.alert_type.includes('above') ? '突破均線' : '跌破均線'}
                              </span>
                            </td>
                            <td>{alert.alert_message}</td>
                            <td style={{ fontWeight: 'bold', color: 'var(--accent-color)' }}>{alert.triggered_price} 元</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    目前尚無已觸發的警示紀錄。
                  </div>
                )}
              </div>

              {/* 個股追蹤表 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem 0' }}>⭐ 個股追蹤清單 ({watchlistList.length} 檔)</h3>
                {watchlistList.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>股票代號</th>
                          <th>股票名稱</th>
                          <th>最新收盤價</th>
                          <th>MA5 / MA20 / MA60</th>
                          <th>價格上限警示</th>
                          <th>價格下限警示</th>
                          <th>均線警示條件</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {watchlistList.map(item => {
                          const maTexts = [
                            item.ma5 ? `MA5: ${item.ma5.toFixed(2)}` : 'MA5: -',
                            item.ma20 ? `MA20: ${item.ma20.toFixed(2)}` : 'MA20: -',
                            item.ma60 ? `MA60: ${item.ma60.toFixed(2)}` : 'MA60: -'
                          ];
                          
                          const maConds = [];
                          if (item.compare_ma5 === 1) maConds.push('> MA5');
                          if (item.compare_ma5 === -1) maConds.push('< MA5');
                          if (item.compare_ma20 === 1) maConds.push('> MA20');
                          if (item.compare_ma20 === -1) maConds.push('< MA20');
                          if (item.compare_ma60 === 1) maConds.push('> MA60');
                          if (item.compare_ma60 === -1) maConds.push('< MA60');

                          return (
                            <tr key={item.stock_id}>
                              <td style={{ fontWeight: 'bold' }}>{item.stock_id}</td>
                              <td>{item.stock_name}</td>
                              <td style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
                                {item.latest_price !== null ? `${item.latest_price} 元` : '無資料'}
                              </td>
                              <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                  {maTexts.map((txt, idx) => <span key={idx}>{txt}</span>)}
                                </div>
                              </td>
                              <td>
                                {item.target_price_high !== null ? (
                                  <span style={{ color: '#FCA5A5', fontWeight: 'bold' }}>≥ {item.target_price_high} 元</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>未設定</span>
                                )}
                              </td>
                              <td>
                                {item.target_price_low !== null ? (
                                  <span style={{ color: '#93C5FD', fontWeight: 'bold' }}>≤ {item.target_price_low} 元</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>未設定</span>
                                )}
                              </td>
                              <td>
                                {maConds.length > 0 ? (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                    {maConds.map((cond, idx) => (
                                      <span key={idx} style={{
                                        background: 'rgba(255,255,255,0.08)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '4px',
                                        padding: '0.1rem 0.4rem',
                                        fontSize: '0.8rem',
                                        color: cond.includes('>') ? '#A7F3D0' : '#FCA5A5'
                                      }}>
                                        {cond}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>無</span>
                                )}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                  <button
                                    className="btn btn-save"
                                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                                    onClick={() => {
                                      setEditingWatchlistStock(item);
                                      setWatchlistModalInput({
                                        target_price_high: item.target_price_high !== null ? item.target_price_high.toString() : '',
                                        target_price_low: item.target_price_low !== null ? item.target_price_low.toString() : '',
                                        compare_ma5: item.compare_ma5,
                                        compare_ma20: item.compare_ma20,
                                        compare_ma60: item.compare_ma60
                                      });
                                    }}
                                  >
                                    ⚙️ 設定警示
                                  </button>
                                  <button
                                    className="btn btn-delete"
                                    style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                                    onClick={() => handleDeleteWatchlist(item.stock_id)}
                                  >
                                    🗑️ 取消追蹤
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-muted)' }}>
                    目前尚無任何追蹤中的股票。
                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>請到「智慧選股器」篩選股票後，勾選加入此追蹤清單！</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== 資料表格 ===== */}
        {activeTab === 'screener' && sortedData && sortedData.length > 0 && (
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', marginTop: '2rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 'bold' }}>🤖 選用分析模型:</span>
              <select
                value={screenerModel}
                onChange={e => setScreenerModel(e.target.value)}
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'white',
                  padding: '0.4rem 0.6rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash (預設)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </div>
            <button
              className="btn"
              style={{ background: 'linear-gradient(135deg, #10B981, #059669)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={handleBatchAnalyzeScreener}
              disabled={batchAnalyzing || Object.keys(selectedStocks).filter(k => selectedStocks[k]).length === 0}
            >
              {batchAnalyzing ? (
                <>
                  <span className="loader" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
                  <span>批次分析中... ({analyzeProgress.current}/{analyzeProgress.total})</span>
                </>
              ) : (
                <span>🤖 批次 AI 分析已選取股票 ({Object.keys(selectedStocks).filter(k => selectedStocks[k]).length} 檔)</span>
              )}
            </button>
            <button
              className="btn"
              style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={handleAddToWatchlist}
              disabled={Object.keys(selectedStocks).filter(k => selectedStocks[k]).length === 0}
            >
              <span>➕ 將所選加入追蹤清單 ({Object.keys(selectedStocks).filter(k => selectedStocks[k]).length} 檔)</span>
            </button>
            {batchAnalyzing && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                正在呼叫 AI 進行深度分析，請稍候（預計每檔需時 5~10 秒）...
              </span>
            )}
          </div>
        )}

        {sortedData && sortedData.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  {activeTab === 'screener' && (
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={sortedData.length > 0 && sortedData.every(row => selectedStocks[row.stock_id])}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  {Object.keys(sortedData[0]).map(key => {
                    const isActive = sortConfig.key === key;
                    return (
                      <th
                        key={key}
                        onClick={() => handleSort(key)}
                        className="sortable-th"
                        title={`點擊依「${key}」排序`}
                      >
                        {key}
                        <span className="sort-arrow">
                          {isActive ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                        </span>
                      </th>
                    );
                  })}
                  <th>動作</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, idx) => (
                  <tr key={idx}>
                    {activeTab === 'screener' && (
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!selectedStocks[row.stock_id]}
                          onChange={() => toggleSelectStock(row.stock_id)}
                        />
                      </td>
                    )}
                    {Object.values(row).map((val, i) => (
                      <td key={i}>{val !== null ? val.toString() : '-'}</td>
                    ))}
                    <td style={{ display: 'flex', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                      {row.stock_id ? (
                        <>
                          <a
                            href={`https://tw.stock.yahoo.com/quote/${row.stock_id}`}
                            target="_blank" rel="noreferrer"
                            style={{ color: '#60A5FA', textDecoration: 'none' }}
                          >🔍 Yahoo</a>
                          <button
                            onClick={() => copyAiPrompt(row.stock_id)}
                            style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '0.8rem' }}
                          >📋 複製AI指令</button>
                          {activeTab === 'screener' && (
                            <button
                              onClick={() => viewHistory(row.stock_id, row.stock_name)}
                              style={{ background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93C5FD', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '0.8rem' }}
                            >
                              📖 閱讀AI分析
                            </button>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            沒有找到符合條件的資料。
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="analysis-header" style={{ marginBottom: '1.5rem' }}>
              <h3 className="analysis-title">⚙️ Gemini 後端自動化與模型設定</h3>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="portfolio-form-field">
                <label htmlFor="modal-api-key">🔑 Gemini API 金鑰 (儲存於伺服器資料庫中，用於背景任務)</label>
                <input
                  id="modal-api-key"
                  type="password"
                  placeholder="請輸入您的 Gemini API Key"
                  value={serverSettings.gemini_api_key || ''}
                  onChange={e => setServerSettings(s => ({ ...s, gemini_api_key: e.target.value }))}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  ※ 若要在每日爬蟲完成後自動在背景執行持股分析，必須於此處儲存金鑰至伺服器。
                </span>
              </div>

              <div className="portfolio-form-field">
                <label htmlFor="modal-model-select">🤖 分析選用模型</label>
                <select
                  id="modal-model-select"
                  value={serverSettings.gemini_model || 'gemini-3.5-flash'}
                  onChange={e => setServerSettings(s => ({ ...s, gemini_model: e.target.value }))}
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'white',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.95rem',
                    fontFamily: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (推薦 - 推理與細節佳)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (最新旗艦模型)</option>
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash (最新極速模型)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (進階模型)</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (快速 - 輕量診斷)</option>
                </select>
              </div>

              <div className="portfolio-form-field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label htmlFor="modal-telegram-token">🤖 Telegram Bot Token</label>
                  <input
                    id="modal-telegram-token"
                    type="password"
                    placeholder="例如: 123456:ABC-def..."
                    value={serverSettings.telegram_bot_token || ''}
                    onChange={e => setServerSettings(s => ({ ...s, telegram_bot_token: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="modal-telegram-chat">💬 Telegram Chat ID</label>
                  <input
                    id="modal-telegram-chat"
                    type="text"
                    placeholder="例如: 987654321 或 -100123456"
                    value={serverSettings.telegram_chat_id || ''}
                    onChange={e => setServerSettings(s => ({ ...s, telegram_chat_id: e.target.value }))}
                  />
                </div>
              </div>

              <div className="portfolio-form-field">
                <label htmlFor="modal-prompt">📝 診斷研究指令範本 (Prompt Template)</label>
                <textarea
                  id="modal-prompt"
                  value={serverSettings.analysis_prompt || ''}
                  onChange={e => setServerSettings(s => ({ ...s, analysis_prompt: e.target.value }))}
                  style={{
                    width: '100%',
                    minHeight: '250px',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.3)',
                    color: 'white',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    lineHeight: '1.5',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  可以使用以下預設欄位佔位符：
                  <br />
                  <code>{"{stock_id}"}</code> (代號)、<code>{"{stock_name}"}</code> (名稱)、<code>{"{buy_price}"}</code> (成本)、<code>{"{latest_price}"}</code> (收盤價)、<code>{"{notes}"}</code> (備註)、<code>{"{price_text}"}</code> (近10日股價)、<code>{"{news_text}"}</code> (即時新聞)、<code>{"{ptt_text}"}</code> (PTT論壇熱度)
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (confirm("確定要還原成預設的研究指令 Prompt 範本嗎？")) {
                    setServerSettings(s => ({ ...s, analysis_prompt: DEFAULT_PROMPT_TEMPLATE }));
                  }
                }}
              >
                還原預設 Prompt
              </button>
              <button type="button" className="btn btn-save" onClick={handleSaveSettings}>
                💾 儲存設定
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowSettingsModal(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '1000px', width: '95%' }}>
            <div className="analysis-header" style={{ marginBottom: '1.5rem' }}>
              <h3 className="analysis-title">📜 歷史診斷與健檢軌跡：{historyStockId} {historyStockName}</h3>
              <button className="close-btn" onClick={() => setShowHistoryModal(false)}>×</button>
            </div>

            {historyList.length > 0 ? (
              <div className="history-layout">
                <div className="history-sidebar">
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>診斷日期與燈號</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {historyList.map((item, idx) => (
                      <div
                        key={idx}
                        className={`history-date-item ${selectedHistoryItem?.date === item.date ? 'active' : ''}`}
                        onClick={() => setSelectedHistoryItem(item)}
                      >
                        <span>{item.date.substring(4, 6)}/{item.date.substring(6, 8)}</span>
                        <span className={`signal-badge ${getSignalClass(item.signal)}`}>
                          {item.signal}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="history-content">
                  {selectedHistoryItem ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                          診斷日期: {selectedHistoryItem.date} | 記錄時間: {selectedHistoryItem.created_at || '無'} | 分析模型: {selectedHistoryItem.model_name || '預設 (Gemini 3.5 Flash)'}
                        </span>
                        <span className={`signal-badge ${getSignalClass(selectedHistoryItem.signal)}`}>
                          {getSignalLabel(selectedHistoryItem.signal)}
                        </span>
                      </div>
                      <MarkdownRenderer text={selectedHistoryItem.analysis_text} />
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>
                      請點選左側日期以檢視詳細診斷報告。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📜</div>
                <p style={{ margin: 0 }}>尚無該股票的歷史診斷紀錄。</p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>請點擊「🤖 診斷」按鈕以進行首次診斷！</p>
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowHistoryModal(false)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Podcast Episode Detail Modal */}
      {showEpisodeModal && selectedEpisode && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '1100px', width: '95%', padding: '2rem' }}>
            <div className="analysis-header" style={{ marginBottom: '1.5rem' }}>
              <h3 className="analysis-title">
                <span>🎙️ Podcast 語音智能解析報告</span>
              </h3>
              <button className="close-btn" onClick={() => { setShowEpisodeModal(false); setSelectedEpisode(null); }}>×</button>
            </div>

            <div className="podcast-modal-layout">
              {/* 左側 Sidebar */}
              <div className="podcast-modal-sidebar">
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <img 
                    src={podcastChannels.find(c => c.channel_id === selectedEpisode.channel_id)?.artwork_url} 
                    alt="Channel artwork" 
                    style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                  />
                  <div>
                    <span style={{ fontSize: '0.8rem', color: '#818CF8', fontWeight: 'bold', display: 'block' }}>
                      {podcastChannels.find(c => c.channel_id === selectedEpisode.channel_id)?.name}
                    </span>
                    <h4 style={{ margin: '0.25rem 0 0 0', fontSize: '1.05rem', color: 'var(--text-main)', lineHeight: '1.4' }}>{selectedEpisode.title}</h4>
                  </div>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <span>📅 發佈時間: {selectedEpisode.pub_date}</span>
                  {selectedEpisode.duration && (
                    <span>⏱️ 音訊長度: {Math.round(parseInt(selectedEpisode.duration) / 60)} 分鐘</span>
                  )}
                  <span>🔍 分析時間: {selectedEpisode.analysis_date}</span>
                </div>

                {/* 提到個股與情緒評估 */}
                {parsedAnalysis && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#34D399', display: 'block' }}>🎯 提及個股與 AI 情緒評級</span>
                    {parsedAnalysis.mentioned_stocks && parsedAnalysis.mentioned_stocks.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {parsedAnalysis.mentioned_stocks.map((stock, idx) => (
                          <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <span style={{ fontWeight: 'bold', color: '#60A5FA', fontSize: '0.9rem' }}>
                                {stock.name} ({stock.id})
                              </span>
                              <span className="sentiment-badge" style={{
                                padding: '0.15rem 0.4rem',
                                borderRadius: '8px',
                                fontSize: '0.75rem',
                                fontWeight: '600',
                                backgroundColor: stock.sentiment === '看多' ? 'rgba(239, 68, 68, 0.2)' : stock.sentiment === '看空' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(107, 114, 128, 0.2)',
                                color: stock.sentiment === '看多' ? '#EF4444' : stock.sentiment === '看空' ? '#10B981' : '#9CA3AF',
                                border: `1px solid ${stock.sentiment === '看多' ? 'rgba(239, 68, 68, 0.4)' : stock.sentiment === '看空' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(107, 114, 128, 0.4)'}`
                              }}>
                                {stock.sentiment}
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>{stock.reason}</p>
                            {/* 加入持股連結按鈕 */}
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ 
                                padding: '0.25rem 0.4rem', 
                                fontSize: '0.75rem', 
                                marginTop: '0.5rem', 
                                width: '100%', 
                                display: 'inline-flex', 
                                justifyContent: 'center', 
                                alignItems: 'center', 
                                gap: '0.25rem' 
                              }}
                              onClick={() => {
                                setPortfolioInput({
                                  stock_id: stock.id,
                                  buy_price: '',
                                  notes: `來自 Podcast: ${selectedEpisode.title}`
                                });
                                setShowEpisodeModal(false);
                                setSelectedEpisode(null);
                                setActiveTab('portfolio');
                              }}
                            >
                              ➕ 追蹤此股
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>音檔中未提及明確股票標的。</span>
                    )}
                  </div>
                )}
              </div>

              {/* 右側 Main Pane */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="podcast-tab-row">
                  <button 
                    className={`podcast-mini-tab ${podcastModalTab === 'analysis' ? 'active' : ''}`}
                    onClick={() => setPodcastModalTab('analysis')}
                  >
                    📋 AI 投資分析報告
                  </button>
                  <button 
                    className={`podcast-mini-tab ${podcastModalTab === 'transcription' ? 'active' : ''}`}
                    onClick={() => setPodcastModalTab('transcription')}
                  >
                    📝 逐字稿文字
                  </button>
                </div>

                <div className="podcast-modal-content">
                  {podcastModalTab === 'analysis' ? (
                    <div style={{ background: 'rgba(0,0,0,0.15)', padding: '1rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                      <MarkdownRenderer text={selectedEpisode.analysis_report} />
                    </div>
                  ) : (
                    <div className="transcription-text">
                      {selectedEpisode.transcription}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setShowEpisodeModal(false); setSelectedEpisode(null); }}>
                關閉報告
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Watchlist Alert Edit Modal */}
      {editingWatchlistStock && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="analysis-header" style={{ marginBottom: '1.5rem' }}>
              <h3 className="analysis-title" style={{ margin: 0 }}>⚙️ 設定警示條件 - {editingWatchlistStock.stock_id} {editingWatchlistStock.stock_name}</h3>
              <button className="close-btn" onClick={() => setEditingWatchlistStock(null)}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="portfolio-form-field">
                <label style={{ color: 'var(--text-main)', display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>📈 價格上限警示 (當收盤價大於或等於此價格時通知)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="未設定 (請輸入數字，例如: 150)"
                  value={watchlistModalInput.target_price_high}
                  onChange={e => setWatchlistModalInput(s => ({ ...s, target_price_high: e.target.value }))}
                />
              </div>

              <div className="portfolio-form-field">
                <label style={{ color: 'var(--text-main)', display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>📉 價格下限警示 (當收盤價小於或等於此價格時通知)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="未設定 (請輸入數字，例如: 120)"
                  value={watchlistModalInput.target_price_low}
                  onChange={e => setWatchlistModalInput(s => ({ ...s, target_price_low: e.target.value }))}
                />
              </div>

              <div className="portfolio-form-field">
                <label style={{ color: 'var(--text-main)', display: 'block', marginBottom: '0.4rem', fontWeight: 'bold' }}>📊 均線 (MA) 警示條件設定</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                  {/* MA5 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <span>5 日均線 (MA5)</span>
                    <select
                      value={watchlistModalInput.compare_ma5}
                      onChange={e => setWatchlistModalInput(s => ({ ...s, compare_ma5: parseInt(e.target.value) }))}
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      <option value="0">無警示</option>
                      <option value="1">收盤價 &gt; MA5 時警示</option>
                      <option value="-1">收盤價 &lt; MA5 時警示</option>
                    </select>
                  </div>

                  {/* MA20 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <span>20 日均線 (MA20)</span>
                    <select
                      value={watchlistModalInput.compare_ma20}
                      onChange={e => setWatchlistModalInput(s => ({ ...s, compare_ma20: parseInt(e.target.value) }))}
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      <option value="0">無警示</option>
                      <option value="1">收盤價 &gt; MA20 時警示</option>
                      <option value="-1">收盤價 &lt; MA20 時警示</option>
                    </select>
                  </div>

                  {/* MA60 */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <span>60 日均線 (MA60)</span>
                    <select
                      value={watchlistModalInput.compare_ma60}
                      onChange={e => setWatchlistModalInput(s => ({ ...s, compare_ma60: parseInt(e.target.value) }))}
                      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}
                    >
                      <option value="0">無警示</option>
                      <option value="1">收盤價 &gt; MA60 時警示</option>
                      <option value="-1">收盤價 &lt; MA60 時警示</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-save"
                onClick={() => handleUpdateWatchlistAlert(editingWatchlistStock.stock_id)}
              >
                💾 儲存警示
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingWatchlistStock(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StockDashboard;
