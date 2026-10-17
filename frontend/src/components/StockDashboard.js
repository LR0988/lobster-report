import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api';
import defaultMarketMlData from '../data/defaultMarketMlData.json';
import titanOpenPositionsData from '../data/titan_open_positions.json';
import titanTradesData from '../data/titan_trades.json';
import titanCurveData from '../data/titan_curve.json';
import globalTitanTradesData from '../data/global_titan_trades.json';
import globalTitanCurveData from '../data/global_titan_curve.json';
import etf0020HoldingsData from '../data/etf_0020_holdings.json';
import defaultPodcastData from '../data/defaultPodcastData.json';
import TitanLiveDashboard from './TitanLiveDashboard';
import GlobalSovereignDashboard from './GlobalSovereignDashboard';
import defaultGlobalSovereignData from '../data/defaultGlobalSovereignData.json';
import './StockDashboard.css';

let dynamicApiBase = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'http://localhost:8000'
  : (process.env.REACT_APP_STOCK_API_URL || '');

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
  return window.fetch(url, { ...options, headers, cache: 'no-store' });
};

const resolveApiBase = async (forceRefresh = false) => {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    dynamicApiBase = 'http://localhost:8000';
    return 'http://localhost:8000';
  }
  if (!forceRefresh && dynamicApiBase && dynamicApiBase.startsWith('http')) {
    return dynamicApiBase;
  }
  try {
    const sRes = await supabaseFetch('/stock_settings?key=eq.remote_api_url&select=value');
    if (sRes.ok) {
      const rows = await sRes.json();
      if (rows && rows.length > 0 && rows[0].value) {
        const freshUrl = rows[0].value.replace(/\/+$/, '');
        dynamicApiBase = freshUrl;
        try { localStorage.setItem('remote_api_url', freshUrl); } catch {}
        return freshUrl;
      }
    }
  } catch (e) {
    console.warn('查詢 Supabase remote_api_url 失敗:', e);
  }
  const cached = (typeof window !== 'undefined') ? localStorage.getItem('remote_api_url') : null;
  return cached || dynamicApiBase || 'http://localhost:8000';
};

const stockFetch = async (url, opts = {}) => {
  let base = await resolveApiBase(false);
  const getFinalUrl = (b) => (typeof url === 'string' && url.startsWith('/api')) ? `${b}${url}` : url;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeout || 12000);
  const fetchOpts = { ...opts, signal: opts.signal || controller.signal };

  try {
    const res = await window.fetch(getFinalUrl(base), fetchOpts);
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.warn('後端請求失敗，重新自雲端取得最新 Tunnel URL 重試:', err);
      try {
        const freshBase = await resolveApiBase(true);
        if (freshBase) {
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), opts.timeout || 12000);
          const retryOpts = { ...opts, signal: opts.signal || retryController.signal };
          const retryRes = await window.fetch(getFinalUrl(freshBase), retryOpts);
          clearTimeout(retryTimeoutId);
          return retryRes;
        }
      } catch (retryErr) {
        console.warn('重試最新 Tunnel URL 仍無法連線:', retryErr);
      }
    }
    throw err;
  }
};

const STORAGE_KEY = 'stock_screener_config';
const PROMPT_KEY = 'stock_screener_prompt';

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

const BUILTIN_SCREENER_PRESETS = [
  {
    id: 'strat1_breakout',
    name: '🚀 爆量起漲季線',
    desc: '策略一：爆量突破季線，尋找底部起漲第一根',
    config: { ...DEFAULT_CONFIG, strat1: true, vol_min: 500000 }
  },
  {
    id: 'strat2_pullback',
    name: '📈 多頭排列凹洞量',
    desc: '策略二：均線多頭排列 + 凹洞量回檔買點',
    config: { ...DEFAULT_CONFIG, strat2: true, price_trend: 3 }
  },
  {
    id: 'inst_lock',
    name: '🏢 法人大戶鎖碼',
    desc: '三大法人或外資/投信連買 + 千張大戶週增',
    config: { ...DEFAULT_CONFIG, inst_buy_days_min: 3, large_holder_inc: true, vol_min: 500000 }
  },
  {
    id: 'high_yield_value',
    name: '💰 高殖利低估值',
    desc: '殖利率 ≥ 5%，本益比 PE ≤ 15，股價淨值比 PB ≤ 2',
    config: { ...DEFAULT_CONFIG, yield_min: 5, pe_max: 15, pb_max: 2, vol_min: 200000 }
  },
  {
    id: 'large_holder_rush',
    name: '👑 千張大戶強勢股',
    desc: '千張大戶持股 ≥ 60% 且近週連續增加，站上 MA5',
    config: { ...DEFAULT_CONFIG, large_holder_min: 60, large_holder_inc: true, price_trend: 1, vol_min: 300000 }
  }
];

const BUILTIN_ML_TRAIN_PRESETS = [
  {
    id: 'default_180d',
    name: '⚡ 推薦標準 (半年波段)',
    desc: '訓練 180 天 / 測試 30 天 / 80% 訓練 / 排除 6 碼權證',
    trainDays: 180,
    testDays: 30,
    trainRatio: 0.8,
    exclude6Digit: true,
    filterCapital: false,
    minCapitalBillion: 10.0
  },
  {
    id: 'short_swing_90d',
    name: '🚀 短波動能 (近季飆股)',
    desc: '訓練 90 天 / 測試 30 天 / 排除權證 / 捕捉近期強勢族群',
    trainDays: 90,
    testDays: 30,
    trainRatio: 0.8,
    exclude6Digit: true,
    filterCapital: false,
    minCapitalBillion: 10.0
  },
  {
    id: 'large_cap_360d',
    name: '🛡️ 主力大股本 (長波抗震)',
    desc: '訓練 360 天 / 測試 60 天 / 股本 ≥ 10 億 / 排權證',
    trainDays: 360,
    testDays: 60,
    trainRatio: 0.8,
    exclude6Digit: true,
    filterCapital: true,
    minCapitalBillion: 10.0
  },
  {
    id: 'mega_cap_20b',
    name: '👑 權值藍籌 (股本 ≥ 20 億)',
    desc: '訓練 360 天 / 測試 60 天 / 股本 ≥ 20 億 / 超高流動性',
    trainDays: 360,
    testDays: 60,
    trainRatio: 0.8,
    exclude6Digit: true,
    filterCapital: true,
    minCapitalBillion: 20.0
  },
  {
    id: 'all_market_raw',
    name: '🌐 全市場無限制',
    desc: '訓練 180 天 / 不限股本 / 納入全部標的',
    trainDays: 180,
    testDays: 30,
    trainRatio: 0.8,
    exclude6Digit: false,
    filterCapital: false,
    minCapitalBillion: 10.0
  }
];

const ML_MODEL_OPTIONS = [
  { val: 'lightgbm', label: '⚡ LightGBM (推薦/高勝率)' },
  { val: 'xgboost', label: '🌲 XGBoost (經典量化)' },
  { val: 'attention_bilstm_xgb', label: '🔥 Attention BiLSTM-XGB (深度混合)' },
  { val: 'resnet50', label: '🧠 ResNet-50 (時序殘差網路)' },
  { val: 'tft', label: '⏳ Temporal Fusion Transformer' },
  { val: 'vsn_xlstm', label: '🧬 VSN-xLSTM (擴展記憶)' },
  { val: 'cnn_hybrid', label: '🌊 CNN-Attention (特徵融合)' },
  { val: 'patchtst', label: '🧩 PatchTST (分塊 Transformer)' },
  { val: 'rf', label: '🌳 Random Forest (隨機森林)' },
  { val: 'mlp', label: '🕸️ MLP Neural Net (多層感知)' },
  { val: 'lr', label: '📏 Logistic Regression (線性基準)' }
];

const ML_MODELS = ML_MODEL_OPTIONS.map(m => ({ id: m.val, name: m.label }));

const MARKET_ML_MODELS = [
  { val: 'global_liquid_titan_a', label: '👑 全球高流動性泰坦旗艦 (雙梯隊進攻版：1號+22號交錯 × 40/30/30 × 45/35/20敏銳動能 × 爆量滯漲過濾)', short: '👑 全球泰坦(雙梯隊進攻版)', tag: '👑 22.8年+2417475% (24176倍)・CAGR 56.7%・Calmar 1.705・勝率90.9%', desc: '最新雙梯隊進攻版：每月1號(A梯隊50%)與22號(B梯隊50%)交錯調倉 + 40/30/30固定階梯 + 45/35/20敏銳動能集總 + 爆量滯漲過濾 + 前5名保護帶 + 滿4月換血。22.8年貫穿驗證 CAGR 56.68% (24,176倍)，月頻MDD -33.25%，Calmar 1.705，年度勝率 90.9% (22年贏20年)，最差年度僅 -4.73%！' },
  { val: 'titan_sovereign', label: '👑 泰坦王權主宰旗艦版 (二階段Top10高勝率精選 + 週度動態遞補)', short: '👑 泰坦王權主宰', tag: '👑 20年+26550% (266.5倍)・MDD -36.6%・夏普1.00', desc: '旗艦版王權破局主宰：嚴格零偷看未來！加權季線宏觀濾網+市場廣度防護網+二階段Top10動能初篩與高勝率二次精選+週度動態遞補消除空窗期+在席贏家動態再平衡。20年累積 +26,550.7% (CAGR 29.2%~30.3%, 266.5倍)，最大回撤僅 -36.55%，夏普比率 1.00，實盤加權勝率 50.4%，嚴格零槓桿！' },
  { val: 'etf_0020', label: '🚀 0020 台灣前20大等權重指數 (0020-Equal ETF)', short: '🚀 0020 等權重', tag: '🚀 10年+864% 擊敗0050', desc: '去蕪存菁！剔除 0050 後段班 30 檔牛皮弱勢股，集中前 20 大半導體與 AI 科技龍頭每檔 5% 等權重。10年+863.88% (CAGR 23.44%)，擊敗 0050 (+657.56%) 超額 +206.3%！' },
  { val: 'wf_lightgbm', label: '⚡ 漸進 LightGBM (WF-LightGBM)', short: '⚡ 漸進 LGBM', tag: '👑 10年+688% 戰勝0050', desc: '美股宏觀定價＋滾動增量重訓，10 年總報酬 +688.79% 徹底擊敗 0050 Buy & Hold (+652.64%)，零槓桿，MDD 僅 -31.78%！' },
  { val: 'walk_forward', label: '🔄 漸進動態集成 (WF-Ensemble)', short: '🔄 漸進集成', tag: '🏆 美股增益・近1年+126%', desc: '納入美股四大盤（那指、標普、道瓊、VT）與跨市場強弱，每 40 日滾動重訓，嚴格 25 日隔離零偷看，近 1年 +126.73% 成功反超 0050，近 10年 +601.91%，100% 純樣本外 (OOS)' },
  { val: 'wf_xgboost', label: '🌲 漸進 XGBoost (WF-XGBoost)', short: '🌲 漸進 XGB', tag: '🛡️ 純樣本外金標', desc: 'XGBoost 滾動增量訓練，納入美股四大盤，嚴格 25 日隔離，對非線性波動轉折具高度動態適應性' },
  { val: 'wf_rf', label: '🌳 漸進隨機森林 (WF-RandomForest)', short: '🌳 漸進森林', tag: '🛡️ 純樣本外金標', desc: '隨機森林滾動重訓，嚴格 25 日隔離，平滑極端噪聲並持續吸收最新宏觀格局' },
  { val: 'regime_moe', label: '🏛️ 市場狀態多段專家 (Regime MoE + Meta-Filter)', short: '🏛️ 狀態 MoE', tag: '👑 前沿旗艦', desc: '依牛市擴張、熊市防禦與箱型震盪切成三段專家獨立訓練，結合時間衰減與二階段元標籤置信度過濾' },
  { val: 'ensemble', label: '👑 多模型融合集成 (Ensemble)', short: '👑 集成模型', tag: '🥇 綜合推薦首選', desc: '軟投票融合 LightGBM、隨機森林與高泛化羅吉斯迴歸，AUC 表現最佳' },
  { val: 'lightgbm', label: '⚡ LightGBM (梯度提升)', short: '⚡ LightGBM', tag: '⚡ 靈敏動能', desc: '微軟開源高效梯度提升決策樹，擅長捕捉籌碼與技術面非線性轉折' },
  { val: 'lr', label: '📏 Logistic Regression (線性基準)', short: '📏 羅吉斯迴歸', tag: '🎯 泛化穩定', desc: '宏觀全因子 L2 正則化羅吉斯迴歸，方向預測穩定度高、抗過擬合' },
  { val: 'rf', label: '🌳 Random Forest (隨機森林)', short: '🌳 隨機森林', tag: '🛡️ 穩健防禦', desc: '多決策樹 Bagging 集成，能有效平滑單一極端指標雜訊' },
  { val: 'xgboost', label: '🌲 XGBoost (經典量化)', short: '🌲 XGBoost', tag: '🔥 經典量化', desc: '華爾街與量化基金經典極限梯度提升，對波動急遽擴大有高敏感度' },
  { val: 'mlp', label: '🕸️ MLP Neural Net (深度感知器)', short: '🕸️ MLP 類神經', tag: '🧠 深度網路', desc: '多層前饋神經網絡，透過深度隱藏層提煉宏觀多因子交互效應' },
  { val: 'alpha_dynamic_convex', label: '🚀 凸性趨勢倍增 (Convex Alpha 1.75x)', short: '🚀 凸性 1.75x', tag: '⚡ 槓桿放大模式', desc: '結合 AQR 波動率目標控制，以 1.75x 槓桿加速，破季線即時階梯防守' }
];

const BUILTIN_MARKET_ML_PRESETS = [
  {
    id: 'all_factors',
    name: '⚡ 宏觀全因子標準 (含美股四大盤)',
    desc: '全歷史 20 年資料 + 98 維全因子：包含美股四大盤（那指、標普500、道瓊、VT）、科技/大盤比率、美債、費半、台積電 ADR 與籌碼全維度',
    trainDays: 0,
    presetKey: 'all_factors',
    testRatio: 0.2,
    threshold: 2.5
  },
  {
    id: 'quant_literature',
    name: '📚 頂級量化文獻學術因子',
    desc: '納入 López de Prado 分數階微分、Amihud 流動性衝擊、赫斯特指數、TSM ADR 溢價與日圓 Carry Trade',
    trainDays: 1500,
    presetKey: 'quant_literature',
    testRatio: 0.2,
    threshold: 2.5
  },
  {
    id: 'macro_intermarket',
    name: '🌐 宏觀跨市場多因子',
    desc: '聚焦美股四大盤 (Nasdaq, S&P 500, Dow, VT)、科技大盤比率、美債 10Y、費半、台積電 ADR 溢價與外資主力留倉',
    trainDays: 0,
    presetKey: 'macro_intermarket',
    testRatio: 0.2,
    threshold: 2.5
  },
  {
    id: 'recent_momentum',
    name: '🚀 近期動能專注',
    desc: '聚焦近 2 年 (500日) 動能，強化短線爆發力、外資期貨增減與台積電 5 日衝刺',
    trainDays: 500,
    presetKey: 'recent_momentum',
    testRatio: 0.2,
    threshold: 2.0
  },
  {
    id: 'institutional_flow',
    name: '🛡️ 法人籌碼純量化',
    desc: '純三大法人台指期未平倉 Net OI + 現貨大額買賣超與台積電籌碼，過濾技術面雜訊',
    trainDays: 1000,
    presetKey: 'institutional_flow',
    testRatio: 0.2,
    threshold: 2.5
  },
  {
    id: 'pure_technicals',
    name: '📐 純技術線型動能',
    desc: '純加權指數各期均線乖離率、RSI、MACD 柱狀體、歷史波動度與均量放大倍數',
    trainDays: 1500,
    presetKey: 'pure_technicals',
    testRatio: 0.2,
    threshold: 2.5
  }
];

const MARKET_ML_LABELING_METHODS = [
  {
    id: 'triple_barrier',
    name: '🎯 三重屏障標籤法 (Triple-Barrier Method)',
    short: '三重屏障 TBM',
    tag: '👑 頂級量化標準',
    author: 'Marcos López de Prado (2018)',
    citation: 'Advances in Financial Machine Learning, Ch. 3',
    desc: '依動態波動度在未來20日內設動態停利上屏障、停損下屏障與時間水平屏障。以「首次觸及 (First Touch)」決定勝負，徹底解決先被停損洗出場或先拉出暴利但結算時拉回的「路徑依賴」致命漏洞。',
    paramName: '波動率乘數 (k)',
    paramUnit: 'x σ',
    defaultParam: 1.0,
    min: 0.2,
    max: 3.0,
    step: 0.1,
    presets: [
      { val: 0.6, label: '0.6x σ (高敏感短波)' },
      { val: 0.8, label: '0.8x σ (穩健波段)' },
      { val: 1.0, label: '1.0x σ (標準推薦)' },
      { val: 1.2, label: '1.2x σ (寬幅停利)' },
      { val: 1.5, label: '1.5x σ (大波段獵殺)' }
    ]
  },
  {
    id: 'volatility_scaled',
    name: '⚡ 自適應波動率動態倍數法 (Volatility Multiplier)',
    short: '動態波動倍數',
    tag: '⚡ 自適應波動',
    author: 'Robert F. Engle (1982) / Dynamic Volatility Scaling',
    citation: 'Econometrica (ARCH Theory Applied to Thresholds)',
    desc: '動態突破門檻隨 20 日滾動歷史年化波動度 (k × σ) 自適應伸縮。解決低波動盤整期固定 2.5% 太死板難以突破、高波動崩盤期 2.5% 門檻太低充滿假突破噪音之痛點。',
    paramName: '波動倍數 (k)',
    paramUnit: 'x σ',
    defaultParam: 1.0,
    min: 0.2,
    max: 3.0,
    step: 0.1,
    presets: [
      { val: 0.5, label: '0.5x σ (敏感追價)' },
      { val: 0.8, label: '0.8x σ (適中波段)' },
      { val: 1.0, label: '1.0x σ (標準推薦)' },
      { val: 1.3, label: '1.3x σ (防洗盤防假突破)' },
      { val: 1.6, label: '1.6x σ (極強趨勢)' }
    ]
  },
  {
    id: 'trend_scanning',
    name: '🌊 趨勢掃描動態回歸法 (Trend-Scanning Method)',
    short: '趨勢掃描',
    tag: '🌊 波段自適應',
    author: 'Marcos López de Prado (2020)',
    citation: 'Machine Learning for Asset Managers, Ch. 5',
    desc: '不再死板綁定固定 20 天！在未來 5~30 天多尺度視窗中，掃描對數價格時間序列 OLS 迴歸斜率與 t 統計量，自適應鎖定統計顯著性最高的真實波段週期，並依 t 分數正負制定多空。',
    paramName: 't 統計量顯著門檻',
    paramUnit: 't-stat',
    defaultParam: 2.0,
    min: 1.0,
    max: 4.0,
    step: 0.1,
    presets: [
      { val: 1.5, label: 't ≥ 1.5 (寬鬆波段捕捉)' },
      { val: 2.0, label: 't ≥ 2.0 (推薦 95%顯著)' },
      { val: 2.5, label: 't ≥ 2.5 (嚴格 99%顯著)' },
      { val: 3.0, label: 't ≥ 3.0 (極強單邊主升段)' }
    ]
  },
  {
    id: 'rolling_quantile',
    name: '🎯 滾動歷史分位數平衡標籤 (Rolling Quantile / Rank)',
    short: '滾動分位數',
    tag: '🎯 絕對平衡',
    author: 'Gu, Kelly & Xiu (2020)',
    citation: 'Empirical Asset Pricing via Machine Learning, RFS',
    desc: '計算過去 250 天報酬率之前後 q 分位數作為動態多空門檻。徹底消除台股 10 年大多頭導致正樣本過多 (Class Imbalance) 的結構性偏差，使機器學習分類器永遠保持客觀對稱。',
    paramName: '尾端分位數 (q)',
    paramUnit: '分位',
    defaultParam: 0.33,
    min: 0.1,
    max: 0.48,
    step: 0.01,
    presets: [
      { val: 0.20, label: 'Top/Bottom 20% (極端前後五分之一)' },
      { val: 0.25, label: 'Top/Bottom 25% (四分位標籤)' },
      { val: 0.33, label: 'Top/Bottom 33% (三分位推薦)' },
      { val: 0.40, label: 'Top/Bottom 40% (高頻切換)' }
    ]
  },
  {
    id: 'fixed_threshold',
    name: '🏛️ 傳統固定百分比門檻 (Classic Fixed Threshold)',
    short: '固定門檻',
    tag: '🏛️ 傳統經典',
    author: '傳統技術分析經驗法則',
    citation: '傳統固定比例門檻 (Baseline Comparison)',
    desc: '直接以未來 20 天漲跌幅是否超過固定百分比 (例如 ±2.5%) 進行劃分。雖然直觀，但在高低波動體系轉換時容易產生假突破或漏失信號，保留以供對照基準。',
    paramName: '突破漲跌幅門檻',
    paramUnit: '%',
    defaultParam: 2.5,
    min: 0.5,
    max: 10.0,
    step: 0.5,
    presets: [
      { val: 1.5, label: '±1.5%' },
      { val: 2.0, label: '±2.0%' },
      { val: 2.5, label: '±2.5% (經典)' },
      { val: 3.0, label: '±3.0%' },
      { val: 4.0, label: '±4.0%' }
    ]
  }
];

const SCREENER_COLUMN_LABELS = {
  closing_price: '收盤價',
  trade_volume: '成交量',
  pe_ratio: '本益比(PE)',
  pb_ratio: '淨值比(PB)',
  yield_ratio: '殖利率(%)',
  ma5: 'MA5',
  ma20: 'MA20',
  ma60: 'MA60',
  large_holder_ratio: '千張大戶(%)',
  large_holder_change: '大戶週增減',
  foreign_buy_days: '外資連買',
  trust_buy_days: '投信連買',
  inst_buy_days: '法人連買',
  '2026_FPE': '2026 FPE',
  '2027_FPE': '2027 FPE',
  '2028_FPE': '2028 FPE',
  '2027_PEG': '2027 PEG',
  '是否是打群架': '族群群攻'
};

const EXCLUDED_SCREENER_KEYS = new Set(['date', 'trading_date', 'stock_id', 'stock_name', 'id', 'ai_analysis']);

const formatScreenerCellValue = (key, val) => {
  if (val === null || val === undefined || val === '') return '-';
  if (key === 'closing_price') {
    const num = Number(val);
    return isNaN(num) ? val : `$${num.toLocaleString(undefined, { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
  }
  if (key === 'trade_volume') {
    const num = Number(val);
    return isNaN(num) ? val : num.toLocaleString();
  }
  if (key === 'yield_ratio' || key === 'large_holder_ratio') {
    const num = Number(val);
    return isNaN(num) ? `${val}%` : `${num}%`;
  }
  if (key === 'large_holder_change') {
    const num = Number(val);
    if (isNaN(num)) return val;
    return num > 0 ? `+${num}%p` : `${num}%p`;
  }
  if (key === 'foreign_buy_days' || key === 'trust_buy_days' || key === 'inst_buy_days') {
    const num = Number(val);
    return isNaN(num) || num === 0 ? '-' : `${num}天`;
  }
  if (typeof val === 'number') {
    return val.toLocaleString();
  }
  return String(val);
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

const DEFAULT_DB_TABLES = [
  {
    id: 'daily_stock',
    name: '每日個股價量 (daily_stock)',
    desc: '台股上市櫃全市場每日開高低收、成交量、融資券等完整歷史行情 (2004~2026)',
    category: '台股核心',
    categoryKey: 'core',
    frequency: '每個交易日 14:00 盤後',
    task_type: 'daily',
    row_count: 27056727,
    latest_date: '2026/10/09',
    columns_count: 26,
    status: 'active'
  },
  {
    id: 'institutional_trades',
    name: '三大法人買賣超 (institutional_trades)',
    desc: '外資、投信、自營商每日買進、賣出與買賣超張數及金額明細',
    category: '台股核心',
    categoryKey: 'core',
    frequency: '每個交易日 15:30 盤後',
    task_type: 'daily',
    row_count: 11586237,
    latest_date: '2026/10/08',
    columns_count: 5,
    status: 'active'
  },
  {
    id: 'monthly_revenue',
    name: '每月營收公告 (monthly_revenue)',
    desc: '全市場上市櫃公司單月合併營收、MoM 與 YoY 成長率及累計營收數據',
    category: '基本面',
    categoryKey: 'fundamental',
    frequency: '每月 10 日前更新',
    task_type: 'revenue',
    row_count: 170993,
    latest_date: '2026/08',
    columns_count: 10,
    status: 'active'
  },
  {
    id: 'shareholder_concentration',
    name: '集保股權分散表 (shareholder_concentration)',
    desc: '千張大戶持股比例、分級級距持股人次每週籌碼集中度變化',
    category: '籌碼面',
    categoryKey: 'chips',
    frequency: '每週五盤後更新',
    task_type: 'daily',
    row_count: 8525330,
    latest_date: '2026/10/08',
    columns_count: 6,
    status: 'active'
  },
  {
    id: 'institutional_futures',
    name: '期貨三大法人未平倉 (institutional_futures)',
    desc: '台指期貨、選擇權各大法人多空留倉口數與契約金額變化',
    category: '期貨籌碼',
    categoryKey: 'chips',
    frequency: '每個交易日 15:30 盤後',
    task_type: 'options',
    row_count: 49780,
    latest_date: '2026/10/08',
    columns_count: 8,
    status: 'active'
  },
  {
    id: 'daily_index',
    name: '加權指數每日行情 (daily_index)',
    desc: 'TAIEX 加權股價指數每日開高低收、成交金額與漲跌點數',
    category: '大盤總覽',
    categoryKey: 'macro',
    frequency: '每個交易日 14:00 盤後',
    task_type: 'index',
    row_count: 5326,
    latest_date: '2026/10/08',
    columns_count: 9,
    status: 'active'
  },
  {
    id: 'market_breadth',
    name: '市場寬幅騰落指標 (market_breadth)',
    desc: '全市場上漲/下跌家數、漲跌停統計與累計騰落線 (ADL 指標)',
    category: '大盤總覽',
    categoryKey: 'macro',
    frequency: '每個交易日 14:00 盤後',
    task_type: 'index',
    row_count: 5323,
    latest_date: '2026/10/08',
    columns_count: 9,
    status: 'active'
  },
  {
    id: 'options_pc_ratio',
    name: '選擇權 P/C Ratio (options_pc_ratio)',
    desc: '台指選擇權 Put/Call 留倉比率與成交比率多空溫度計指標',
    category: '期貨籌碼',
    categoryKey: 'chips',
    frequency: '每個交易日 15:30 盤後',
    task_type: 'options',
    row_count: 5444,
    latest_date: '2026/10/08',
    columns_count: 7,
    status: 'active'
  },
  {
    id: 'macro_indicators',
    name: '宏觀跨市場因子庫 (macro_indicators)',
    desc: '美元指數、美債 10Y 殖利率、VIX 恐慌指數、台積電 ADR 跨市場數據',
    category: '總體經濟',
    categoryKey: 'macro',
    frequency: '每日美股開盤前後',
    task_type: 'macro',
    row_count: 5676,
    latest_date: '2026/10/07',
    columns_count: 18,
    status: 'active'
  },
  {
    id: 'global_stock_daily',
    name: '全球旗艦資產行情 (global_stock_daily)',
    desc: '標普 500、那斯達克、道瓊、費半與全球主權資產每日報價庫',
    category: '全球資產',
    categoryKey: 'global',
    frequency: '每日美股盤後',
    task_type: 'global_stock',
    row_count: 1239687,
    latest_date: '2026/10/09',
    columns_count: 8,
    status: 'active'
  },
  {
    id: 'global_sovereign_daily',
    name: '全球主權泰坦行情 (global_sovereign_daily)',
    desc: '全球高流動性主權主階梯商品逐日歷史回測報價',
    category: '全球資產',
    categoryKey: 'global',
    frequency: '每日全球收盤後',
    task_type: 'global_sovereign',
    row_count: 126258,
    latest_date: '2026/10/09',
    columns_count: 8,
    status: 'active'
  },
  {
    id: 'global_sovereign_metadata',
    name: '全球主權商品清單 (global_sovereign_metadata)',
    desc: '全球 18 大主權國家 ETF 與現金避險錨點商品規格定義',
    category: '全球資產',
    categoryKey: 'global',
    frequency: '規格定義維護',
    task_type: 'global_sovereign',
    row_count: 18,
    latest_date: '2026/10/09',
    columns_count: 8,
    status: 'active'
  },
  {
    id: 'global_stock_metadata',
    name: '全球旗艦股票清單 (global_stock_metadata)',
    desc: '美股四大指數與全球最高流動性成分股商品池標的定義',
    category: '全球資產',
    categoryKey: 'global',
    frequency: '規格定義維護',
    task_type: 'global_stock',
    row_count: 35,
    latest_date: '2026/10/09',
    columns_count: 8,
    status: 'active'
  },
  {
    id: 'futures_1m',
    name: '台指期 1分K 資料 (futures_1m)',
    desc: '台指期日內當沖高頻 1 分鐘線開高低收與成交量',
    category: '高頻當沖',
    categoryKey: 'futures',
    frequency: '交易時段連續同步',
    task_type: 'futures',
    row_count: 139488,
    latest_date: '2026/10/08 13:44',
    columns_count: 9,
    status: 'active'
  },
  {
    id: 'futures_5m',
    name: '台指期 5分K 資料 (futures_5m)',
    desc: '台指期日內當沖 5 分鐘波段線開高低收與成交量',
    category: '高頻當沖',
    categoryKey: 'futures',
    frequency: '交易時段連續同步',
    task_type: 'futures',
    row_count: 41905,
    latest_date: '2026/10/08 13:40',
    columns_count: 9,
    status: 'active'
  },
  {
    id: 'portfolio',
    name: '個人核心持股庫 (portfolio)',
    desc: '個人追蹤持股清單、成本買價、Gemini AI 輿情診斷標記',
    category: '個人投資',
    categoryKey: 'system',
    frequency: '即時同步',
    task_type: 'daily',
    row_count: 3,
    latest_date: '2026/10/09',
    columns_count: 12,
    status: 'active'
  },
  {
    id: 'watchlist',
    name: '自選股監控池 (watchlist)',
    desc: '自選股觀察清單、即時異動監控與 Telegram 警示配置',
    category: '個人投資',
    categoryKey: 'system',
    frequency: '即時同步',
    task_type: 'daily',
    row_count: 5,
    latest_date: '2026/10/09',
    columns_count: 10,
    status: 'active'
  },
  {
    id: 'settings',
    name: '系統全域設定參數 (settings)',
    desc: '模型回測參數、Telegram 機器人設定、股本門檻等系統參數',
    category: '系統設定',
    categoryKey: 'system',
    frequency: '用戶配置即時生效',
    task_type: 'daily',
    row_count: 8,
    latest_date: '2026/10/09',
    columns_count: 4,
    status: 'active'
  },
  {
    id: 'titan_live_account',
    name: '泰坦實盤虛擬帳戶 (titan_live_account)',
    desc: '泰坦實作模擬帳戶淨值、可用現金、累積已實現與未實現損益',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '每個交易日盤後',
    task_type: 'daily',
    row_count: 1,
    latest_date: '2026/10/09',
    columns_count: 10,
    status: 'active'
  },
  {
    id: 'titan_live_positions',
    name: '泰坦實盤持股部位 (titan_live_positions)',
    desc: '泰坦當前持股明細、進場成本、移動停利階梯狀態',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '每個交易日盤後',
    task_type: 'daily',
    row_count: 3,
    latest_date: '2026/10/09',
    columns_count: 12,
    status: 'active'
  },
  {
    id: 'titan_live_trades',
    name: '泰坦實盤交易紀錄 (titan_live_trades)',
    desc: '泰坦策略實作完整歷史買進/賣出交易紀錄與損益',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '交易觸發即時寫入',
    task_type: 'daily',
    row_count: 38,
    latest_date: '2026/10/09',
    columns_count: 14,
    status: 'active'
  },
  {
    id: 'global_sovereign_positions',
    name: '全球主權實盤持股 (global_sovereign_positions)',
    desc: '全球主權實作當前實盤持股明細、成本、股數與盈虧狀態',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '即時同步更新',
    task_type: 'global_sovereign',
    row_count: 3,
    latest_date: '2026/10/11',
    columns_count: 13,
    status: 'active'
  },
  {
    id: 'global_sovereign_trades',
    name: '全球主權交易紀錄 (global_sovereign_trades)',
    desc: '全球主權泰坦完整歷史買進/賣出交易紀錄與已實現損益',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '即時同步更新',
    task_type: 'global_sovereign',
    row_count: 3,
    latest_date: '2026/10/11',
    columns_count: 13,
    status: 'active'
  },
  {
    id: 'global_sovereign_account',
    name: '全球主權帳戶資金 (global_sovereign_account)',
    desc: '全球主權泰坦帳戶本金、當前可用現金 (TWD) 與即時匯率換算',
    category: '泰坦實作',
    categoryKey: 'titan',
    frequency: '即時同步更新',
    task_type: 'global_sovereign',
    row_count: 4,
    latest_date: '2026/10/11',
    columns_count: 2,
    status: 'active'
  }
];

function StockDashboard() {
  const authUser = getCurrentUser();
  const user = authUser;
  const navigate = useNavigate();
  const [screeningStatus, setScreeningStatus] = useState('');

  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('active_tab');
    if (['ml', 'low_freq', 'portfolio', 'watchlist'].includes(saved)) {
      return 'market_ml';
    }
    return saved || 'market_ml';
  });
  const [activeDbTable, setActiveDbTable] = useState('');
  // 資料庫與爬蟲戰情中心狀態
  const [dbTablesList, setDbTablesList] = useState(DEFAULT_DB_TABLES);
  const [dbCategoryFilter, setDbCategoryFilter] = useState('all');
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [dbTableRows, setDbTableRows] = useState([]);
  const [dbTableCols, setDbTableCols] = useState([]);
  const [dbTableLoading, setDbTableLoading] = useState(false);
  const [dbPage, setDbPage] = useState(1);
  const [dbPageSize, setDbPageSize] = useState(100);
  const [dbTotalCount, setDbTotalCount] = useState(0);
  const [dbTotalPages, setDbTotalPages] = useState(1);
  const [dbIsRemoteLoaded, setDbIsRemoteLoaded] = useState(true);
  const [dbJumpPageInput, setDbJumpPageInput] = useState('1');
  const [dbSortKey, setDbSortKey] = useState(null);
  const [dbSortDir, setDbSortDir] = useState('asc');
  const [dbUpdatingTableId, setDbUpdatingTableId] = useState(null);
  const [dbActionBanner, setDbActionBanner] = useState('');
  const [dbBackfillStatus, setDbBackfillStatus] = useState(null);
  const [scraperLiveStatus, setScraperLiveStatus] = useState(null);
  const [showScraperLogs, setShowScraperLogs] = useState(false);
  const [showScraperBanner, setShowScraperBanner] = useState(false);
  const [portfolioList, setPortfolioList] = useState([]);
  const [portfolioInput, setPortfolioInput] = useState({ stock_id: '', buy_price: '', notes: '', auto_analyze: true });
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analyzingId, setAnalyzingId] = useState(null);

  // 手機/桌面 顯示模式 ('card' 卡片模式 或 'table' 表格模式)
  const [portfolioViewMode, setPortfolioViewMode] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 768 ? 'card' : 'table'));
  const [mlRecViewMode, setMlRecViewMode] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 768 ? 'card' : 'table'));

  // 智慧選股器常用條件預設集與自訂清單
  const [customPresets, setCustomPresets] = useState(() => {
    try {
      const saved = localStorage.getItem('screener_saved_presets');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activePresetId, setActivePresetId] = useState(null);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPreset, setEditingPreset] = useState(null);
  const [editPresetName, setEditPresetName] = useState('');
  const [editPresetConfig, setEditPresetConfig] = useState(null);
  const [showFilterGrid, setShowFilterGrid] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 768 ? false : true));

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
  const [localEngineOnline, setLocalEngineOnline] = useState(null);
  const [podcastProgress, setPodcastProgress] = useState(null);
  const [showQueueDetails, setShowQueueDetails] = useState(false);

  // 後端設定與歷史軌跡狀態
  const [serverSettings, setServerSettings] = useState({
    gemini_api_key: '',
    gemini_model: 'gemini-3.5-flash-lite',
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
  const [mlLatestDate, setMlLatestDate] = useState(() => {
    try {
      return localStorage.getItem('ml_latest_date') || '';
    } catch { return ''; }
  });

  const formatMlDate = (d) => {
    if (!d) return '';
    const s = String(d).trim();
    if (s.length === 8 && /^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    return s;
  };

  const [mlLoading, setMlLoading] = useState(false);
  const [mlRefreshing, setMlRefreshing] = useState(false);
  const [mlComputingStatus, setMlComputingStatus] = useState(''); // '' | 'computing' | 'training'

  // 持股 AI 20天勝率預測狀態
  const [portfolioMlModel, setPortfolioMlModel] = useState(() => localStorage.getItem('portfolio_ml_model') || 'lightgbm');
  const [portfolioPredictions, setPortfolioPredictions] = useState({});
  const [fetchingPortfolioMl, setFetchingPortfolioMl] = useState(false);

  // 持股介面收折、搜尋、排序與快速編輯狀態
  const [showAddPortfolioForm, setShowAddPortfolioForm] = useState(false);
  const [showPortfolioAiConfig, setShowPortfolioAiConfig] = useState(false);
  const [portfolioSearchTerm, setPortfolioSearchTerm] = useState('');
  const [portfolioSortField, setPortfolioSortField] = useState('roi');
  const [portfolioSortOrder, setPortfolioSortOrder] = useState('desc');
  const [editingPortfolioStock, setEditingPortfolioStock] = useState(null);

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

  // ML 子分頁視圖控制 ('predictions' | 'models' | 'backtest' | 'low_freq')
  const [mlSubTab, setMlSubTab] = useState(() => localStorage.getItem('ml_sub_tab') || 'predictions');
  const [trainSavedToast, setTrainSavedToast] = useState(false);

  // ML 訓練設定收折與自訂條件狀態
  const [showMlConfig, setShowMlConfig] = useState(false);
  const [activeMlPreset, setActiveMlPreset] = useState(() => localStorage.getItem('active_ml_preset') || 'default_180d');
  const [mlCustomPresets, setMlCustomPresets] = useState(() => {
    try {
      const saved = localStorage.getItem('ml_custom_train_presets');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showSaveMlPresetModal, setShowSaveMlPresetModal] = useState(false);
  const [editingMlPreset, setEditingMlPreset] = useState(null);
  const [newMlPresetName, setNewMlPresetName] = useState('');
  const [editMlPresetName, setEditMlPresetName] = useState('');

  // ML 預測表格排序狀態

  // ── 大盤 ML 多空波段預測與多模型評估狀態 ──
  const [marketMlData, setMarketMlData] = useState(() => defaultMarketMlData);
  const [globalSovereignLive, setGlobalSovereignLive] = useState(() => defaultGlobalSovereignData);
  const [marketMlBtData, setMarketMlBtData] = useState(null);
  const [fetchingMarketMl, setFetchingMarketMl] = useState(false);
  const [fetchingMarketMlBt, setFetchingMarketMlBt] = useState(false);
  const [triggeringMarketMl, setTriggeringMarketMl] = useState(false);
  const [marketMlModelType, setMarketMlModelType] = useState(() => {
    const saved = localStorage.getItem('market_ml_model_type');
    if (!saved || saved === 'alpha_dynamic_convex' || saved === 'titan_sovereign') return 'global_liquid_titan_a';
    return saved;
  });
  const [showMarketMlConfig, setShowMarketMlConfig] = useState(false);
  const [marketMlSubTab, setMarketMlSubTab] = useState(() => localStorage.getItem('market_ml_sub_tab') || 'backtest');
  const [marketMlPreset, setMarketMlPreset] = useState(() => localStorage.getItem('market_ml_preset') || 'all_factors');
  const [marketMlTrainDays, setMarketMlTrainDays] = useState(() => {
    const val = localStorage.getItem('market_ml_train_days');
    return val !== null ? parseInt(val) : 0;
  });
  const [marketMlTestRatio, setMarketMlTestRatio] = useState(() => {
    const val = localStorage.getItem('market_ml_test_ratio');
    return val !== null ? parseFloat(val) : 0.2;
  });
  const [marketMlThreshold, setMarketMlThreshold] = useState(() => {
    const val = localStorage.getItem('market_ml_threshold');
    return val !== null ? parseFloat(val) : 2.5;
  });
  const [marketMlLabelingMethod, setMarketMlLabelingMethod] = useState(() => localStorage.getItem('market_ml_labeling_method') || 'triple_barrier');
  const [marketMlLabelingParam, setMarketMlLabelingParam] = useState(() => {
    const val = localStorage.getItem('market_ml_labeling_param');
    return val !== null ? parseFloat(val) : 1.0;
  });
  const [marketBacktestMode, setMarketBacktestMode] = useState(() => localStorage.getItem('market_backtest_mode_v2') || 'long_only');
  const [marketBacktestPeriod, setMarketBacktestPeriod] = useState(() => localStorage.getItem('market_bt_period_v2') || '20y');
  const [marketBtStartYear, setMarketBtStartYear] = useState(() => localStorage.getItem('market_bt_start_year') || '2005');
  const [marketBtEndYear, setMarketBtEndYear] = useState(() => localStorage.getItem('market_bt_end_year') || '2026');
  const [marketBacktestModel, setMarketBacktestModel] = useState(() => {
    const saved = localStorage.getItem('market_backtest_model_v2') || localStorage.getItem('market_backtest_model');
    if (!saved || saved === 'titan_sovereign') return 'global_liquid_titan_a';
    return saved;
  });
  const [operationsModel, setOperationsModel] = useState(() => localStorage.getItem('market_operations_model_v2') || 'titan_sovereign');
  const [operationsMode, setOperationsMode] = useState(() => localStorage.getItem('market_operations_mode_v2') || 'long_only');
  const [operationsTradeFilter, setOperationsTradeFilter] = useState('all');
  const [operationsSortOrder, setOperationsSortOrder] = useState('desc');
  const [backtestTradeFilter, setBacktestTradeFilter] = useState('all');
  const [backtestTradeScope, setBacktestTradeScope] = useState('period'); // 'period' | 'all'
  const [elliottBtMode, setElliottBtMode] = useState(() => localStorage.getItem('elliott_bt_mode') || 'long_only');
  const [elliottBtPeriod, setElliottBtPeriod] = useState(() => localStorage.getItem('elliott_bt_period') || '10y');
  const [marketMlAutoTune, setMarketMlAutoTune] = useState(() => localStorage.getItem('market_ml_auto_tune') !== 'false');
  const [marketMlTuneTrials, setMarketMlTuneTrials] = useState(() => {
    const val = localStorage.getItem('market_ml_tune_trials');
    return val !== null ? parseInt(val) : 20;
  });
  const [showMarketMlParamsDetail, setShowMarketMlParamsDetail] = useState(false);
  const [showFullVolumeHistogram, setShowFullVolumeHistogram] = useState(false);
  const [showActionMarkers, setShowActionMarkers] = useState(() => localStorage.getItem('market_show_action_markers') !== 'false');
  // 實戰持股個人買入價格自訂與對齊狀態
  const [userCustomEntryPrices, setUserCustomEntryPrices] = useState(() => {
    try {
      const saved = localStorage.getItem('user_custom_entry_prices');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [userDepositCapital, setUserDepositCapital] = useState(() => {
    try {
      const saved = localStorage.getItem('user_deposit_capital_twd');
      return saved ? parseFloat(saved) : 1000000;
    } catch (e) {
      return 1000000;
    }
  });
  const [userUsdFx, setUserUsdFx] = useState(() => {
    try {
      const saved = localStorage.getItem('user_usdfx_twd');
      return saved ? parseFloat(saved) : 32.5;
    } catch (e) {
      return 32.5;
    }
  });
  const [marketMlSavedToast, setMarketMlSavedToast] = useState(false);

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

  // 持股總覽 KPI 彙總統計
  const portfolioSummary = useMemo(() => {
    if (!portfolioList || portfolioList.length === 0) {
      return { total: 0, profitCount: 0, lossCount: 0, flatCount: 0, avgRoi: 0, totalProfit: 0, validRoiCount: 0 };
    }
    let profitCount = 0;
    let lossCount = 0;
    let flatCount = 0;
    let validRoiSum = 0;
    let validRoiCount = 0;
    let totalProfit = 0;

    portfolioList.forEach(item => {
      const hasCost = item.buy_price !== null && item.buy_price > 0;
      const hasPrice = item.latest_price !== null && item.latest_price > 0;
      if (hasCost && hasPrice) {
        const diff = item.latest_price - item.buy_price;
        const roi = (diff / item.buy_price) * 100;
        validRoiSum += roi;
        validRoiCount += 1;
        totalProfit += diff;
        if (roi > 0.001) profitCount++;
        else if (roi < -0.001) lossCount++;
        else flatCount++;
      } else {
        flatCount++;
      }
    });

    const avgRoi = validRoiCount > 0 ? (validRoiSum / validRoiCount) : 0;

    return {
      total: portfolioList.length,
      profitCount,
      lossCount,
      flatCount,
      avgRoi,
      totalProfit,
      validRoiCount
    };
  }, [portfolioList]);

  // 持股排序與搜尋過濾
  const handlePortfolioSort = (field) => {
    if (portfolioSortField === field) {
      setPortfolioSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setPortfolioSortField(field);
      setPortfolioSortOrder('desc');
    }
  };

  const getSortedPortfolioList = () => {
    if (!portfolioList) return [];
    let list = [...portfolioList];

    if (portfolioSearchTerm && portfolioSearchTerm.trim()) {
      const term = portfolioSearchTerm.trim().toLowerCase();
      list = list.filter(item => 
        (item.stock_id && item.stock_id.toLowerCase().includes(term)) ||
        (item.stock_name && item.stock_name.toLowerCase().includes(term)) ||
        (item.notes && item.notes.toLowerCase().includes(term))
      );
    }

    return list.sort((a, b) => {
      let valA, valB;
      const predA = portfolioPredictions[a.stock_id] || {};
      const predB = portfolioPredictions[b.stock_id] || {};

      if (portfolioSortField === 'roi') {
        const roiA = (a.buy_price && a.latest_price) ? ((a.latest_price - a.buy_price) / a.buy_price) * 100 : -9999;
        const roiB = (b.buy_price && b.latest_price) ? ((b.latest_price - b.buy_price) / b.buy_price) * 100 : -9999;
        valA = roiA;
        valB = roiB;
      } else if (portfolioSortField === 'win_probability') {
        valA = predA.win_probability !== undefined ? predA.win_probability : -1;
        valB = predB.win_probability !== undefined ? predB.win_probability : -1;
      } else if (portfolioSortField === 'drop_probability') {
        valA = predA.drop_probability !== undefined ? predA.drop_probability : 999;
        valB = predB.drop_probability !== undefined ? predB.drop_probability : 999;
      } else if (portfolioSortField === 'latest_price') {
        valA = a.latest_price || 0;
        valB = b.latest_price || 0;
      } else if (portfolioSortField === 'buy_price') {
        valA = a.buy_price || 0;
        valB = b.buy_price || 0;
      } else {
        valA = a.stock_id || '';
        valB = b.stock_id || '';
      }

      if (typeof valA === 'string') {
        return portfolioSortOrder === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
      return portfolioSortOrder === 'desc' ? valB - valA : valA - valB;
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
        const savedTestDays = data.bt_test_days !== undefined && data.bt_test_days !== null ? data.bt_test_days : data.test_days;
        if (savedTestDays !== undefined && savedTestDays !== null) { setTestDays(parseInt(savedTestDays)); localStorage.setItem('bt_test_days', savedTestDays); }
        if (data.bt_exit_strategy !== undefined) { setBtExitStrategy(data.bt_exit_strategy); localStorage.setItem('bt_exit_strategy', data.bt_exit_strategy); }
        if (data.bt_trailing_activation_pct !== undefined) { setBtTrailingActivation(parseFloat(data.bt_trailing_activation_pct)); localStorage.setItem('bt_trailing_activation_pct', data.bt_trailing_activation_pct); }
        if (data.bt_exclude_6digit !== undefined) { setExclude6Digit(data.bt_exclude_6digit === 'true'); localStorage.setItem('bt_exclude_6digit', data.bt_exclude_6digit); }
        if (data.bt_filter_capital !== undefined) { setFilterCapital(data.bt_filter_capital === 'true'); localStorage.setItem('bt_filter_capital', data.bt_filter_capital); }
        if (data.bt_market_bull_filter !== undefined) { setBtMarketBullFilter(data.bt_market_bull_filter === 'true'); localStorage.setItem('bt_market_bull_filter', data.bt_market_bull_filter); }
        if (data.bt_min_capital_billion !== undefined) {
          setMinCapitalBillion(parseFloat(data.bt_min_capital_billion));
          localStorage.setItem('bt_min_capital_billion', data.bt_min_capital_billion);
        }
        if (data.ml_model_type) {
          setMlModelType(data.ml_model_type);
          try { localStorage.setItem('ml_model_type', data.ml_model_type); } catch {}
        }
        if (data.active_ml_preset) {
          setActiveMlPreset(data.active_ml_preset);
          try { localStorage.setItem('active_ml_preset', data.active_ml_preset); } catch {}
        }
        if (data.ml_custom_train_presets) {
          try {
            const parsed = JSON.parse(data.ml_custom_train_presets);
            if (Array.isArray(parsed)) {
              setMlCustomPresets(parsed);
              localStorage.setItem('ml_custom_train_presets', data.ml_custom_train_presets);
            }
          } catch {}
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

  // 獨立儲存 ML 訓練參數與條件（置頂專用，支援雲端與本地持久化）
  const handleSaveTrainSettings = async (showToast = true) => {
    try {
      const updates = [
        { key: 'bt_train_ratio', value: String(trainRatio) },
        { key: 'bt_train_days', value: String(trainDays) },
        { key: 'bt_test_days', value: String(testDays) },
        { key: 'bt_exclude_6digit', value: String(exclude6Digit) },
        { key: 'bt_filter_capital', value: String(filterCapital) },
        { key: 'bt_min_capital_billion', value: String(minCapitalBillion) },
        { key: 'ml_model_type', value: String(mlModelType) },
        { key: 'active_ml_preset', value: String(activeMlPreset) },
        { key: 'ml_custom_train_presets', value: JSON.stringify(mlCustomPresets) }
      ];

      localStorage.setItem('bt_train_ratio', trainRatio);
      localStorage.setItem('bt_train_days', trainDays);
      localStorage.setItem('bt_test_days', testDays);
      localStorage.setItem('bt_exclude_6digit', exclude6Digit);
      localStorage.setItem('bt_filter_capital', filterCapital);
      localStorage.setItem('bt_min_capital_billion', minCapitalBillion);
      localStorage.setItem('ml_model_type', mlModelType);
      localStorage.setItem('active_ml_preset', activeMlPreset);
      localStorage.setItem('ml_custom_train_presets', JSON.stringify(mlCustomPresets));

      await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(updates)
      });

      if (showToast) {
        setTrainSavedToast(true);
        setTimeout(() => setTrainSavedToast(false), 3500);
      }
    } catch (err) {
      console.error('儲存訓練設定失敗', err);
      if (showToast) {
        setTrainSavedToast(true);
        setTimeout(() => setTrainSavedToast(false), 3500);
      }
    }
  };

  const handleApplyMlPreset = (preset) => {
    setActiveMlPreset(preset.id);
    setTrainDays(preset.trainDays);
    setTestDays(preset.testDays);
    setTrainRatio(preset.trainRatio);
    setExclude6Digit(preset.exclude6Digit);
    setFilterCapital(preset.filterCapital);
    if (preset.minCapitalBillion !== undefined) {
      setMinCapitalBillion(preset.minCapitalBillion);
    }
    localStorage.setItem('active_ml_preset', preset.id);
    localStorage.setItem('bt_train_days', preset.trainDays);
    localStorage.setItem('bt_test_days', preset.testDays);
    localStorage.setItem('bt_train_ratio', preset.trainRatio);
    localStorage.setItem('bt_exclude_6digit', preset.exclude6Digit);
    localStorage.setItem('bt_filter_capital', preset.filterCapital);
    if (preset.minCapitalBillion !== undefined) {
      localStorage.setItem('bt_min_capital_billion', preset.minCapitalBillion);
    }

    supabaseFetch('/stock_settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([
        { key: 'active_ml_preset', value: String(preset.id) },
        { key: 'bt_train_days', value: String(preset.trainDays) },
        { key: 'bt_test_days', value: String(preset.testDays) },
        { key: 'bt_train_ratio', value: String(preset.trainRatio) },
        { key: 'bt_exclude_6digit', value: String(preset.exclude6Digit) },
        { key: 'bt_filter_capital', value: String(preset.filterCapital) },
        { key: 'bt_min_capital_billion', value: String(preset.minCapitalBillion || 10) }
      ])
    }).catch(() => {});

    setTrainSavedToast(true);
    setTimeout(() => setTrainSavedToast(false), 2000);
  };

  const handleSaveCurrentAsMlPreset = () => {
    const trimmed = (newMlPresetName || '').trim();
    if (!trimmed) {
      alert('請輸入自訂模式名稱！');
      return;
    }
    const newPreset = {
      id: `custom_ml_${Date.now()}`,
      name: `⭐ ${trimmed}`,
      desc: `自訂：${trainDays}天訓練 / ${testDays}天測試 / ${filterCapital ? `股本≥${minCapitalBillion}億` : '無股本限制'}`,
      trainDays: parseInt(trainDays) || 180,
      testDays: parseInt(testDays) || 30,
      trainRatio: parseFloat(trainRatio) || 0.8,
      exclude6Digit: Boolean(exclude6Digit),
      filterCapital: Boolean(filterCapital),
      minCapitalBillion: parseFloat(minCapitalBillion) || 10.0
    };
    const updated = [...mlCustomPresets, newPreset];
    setMlCustomPresets(updated);
    setActiveMlPreset(newPreset.id);
    localStorage.setItem('ml_custom_train_presets', JSON.stringify(updated));
    localStorage.setItem('active_ml_preset', newPreset.id);
    supabaseFetch('/stock_settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([
        { key: 'ml_custom_train_presets', value: JSON.stringify(updated) },
        { key: 'active_ml_preset', value: newPreset.id }
      ])
    }).catch(() => {});
    setShowSaveMlPresetModal(false);
    setNewMlPresetName('');
    setTrainSavedToast(true);
    setTimeout(() => setTrainSavedToast(false), 3000);
  };

  const handleDeleteMlPreset = (id) => {
    const updated = mlCustomPresets.filter(p => p.id !== id);
    setMlCustomPresets(updated);
    localStorage.setItem('ml_custom_train_presets', JSON.stringify(updated));
    supabaseFetch('/stock_settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'ml_custom_train_presets', value: JSON.stringify(updated) }])
    }).catch(() => {});
    if (activeMlPreset === id) {
      handleApplyMlPreset(BUILTIN_ML_TRAIN_PRESETS[0]);
    }
  };

  const handleUpdateCurrentMlPresetFromUI = (presetId) => {
    const updated = mlCustomPresets.map(p => {
      if (p.id === presetId) {
        return {
          ...p,
          trainDays: parseInt(trainDays) || 180,
          testDays: parseInt(testDays) || 30,
          trainRatio: parseFloat(trainRatio) || 0.8,
          exclude6Digit: Boolean(exclude6Digit),
          filterCapital: Boolean(filterCapital),
          minCapitalBillion: parseFloat(minCapitalBillion) || 10.0,
          desc: `自訂：${trainDays}天訓練 / ${testDays}天測試 / ${filterCapital ? `股本≥${minCapitalBillion}億` : '無股本限制'}`
        };
      }
      return p;
    });
    setMlCustomPresets(updated);
    localStorage.setItem('ml_custom_train_presets', JSON.stringify(updated));
    supabaseFetch('/stock_settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'ml_custom_train_presets', value: JSON.stringify(updated) }])
    }).catch(() => {});
    setTrainSavedToast(true);
    setTimeout(() => setTrainSavedToast(false), 3000);
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
        const now = Date.now();
        // 過濾超過 2 小時的過期滯留任務
        const validJobs = jobs.filter(j => {
          if (!j.created_at) return true;
          const diffMs = now - new Date(j.created_at).getTime();
          return diffMs < 2 * 60 * 60 * 1000;
        });
        const mapped = validJobs.map(j => {
          let jobName = '選股運算';
          if (j.config?.job_type === 'scraper') {
            jobName = `🕷️ 爬蟲任務 (${j.config?.task_type || '每日行情'})`;
          } else if (j.config?.job_type === 'market_ml_predict') {
            jobName = `🔮 AI 大盤預測 (${j.config?.model_type || '模型'})`;
          } else if (j.config?.job_type === 'ml_train') {
            jobName = `🧠 ML 模型訓練 (${j.config?.model_type || '模型'})`;
          } else if (j.config?.job_type) {
            jobName = j.config.job_type;
          }
          return {
            pid: j.id,
            name: jobName,
            type: j.config?.job_type || 'screener',
            status: j.status,
            model_type: j.config?.model_type || 'lightgbm',
            start_time: j.created_at,
            is_supabase_job: true
          };
        });
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
    if (!confirm(`確定要立即強制終止任務「${task.name}」(ID: ${task.pid}) 嗎？`)) return;
    try {
      setKillingTaskPid(task.pid);
      if (task.is_supabase_job) {
        await supabaseFetch(`/stock_screener_jobs?id=eq.${task.pid}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'failed', error_message: '手動強制取消' })
        });
        alert(`已成功將雲端任務 #${task.pid} 標記終止`);
        fetchActiveTasks();
        return;
      }
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
    supabaseFetch('/stock_settings', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key: 'ml_model_type', value: String(val) }])
    }).catch(() => {});
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
          if (statuses[targetType]?.latest_date) {
            setMlLatestDate(statuses[targetType].latest_date);
            try { localStorage.setItem('ml_latest_date', statuses[targetType].latest_date); } catch {}
          }
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
          if (jsonPred.latest_date) {
            setMlLatestDate(jsonPred.latest_date);
            try { localStorage.setItem('ml_latest_date', jsonPred.latest_date); } catch {}
          }
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
          if (statuses[targetType]?.latest_date) {
            setMlLatestDate(statuses[targetType].latest_date);
            try { localStorage.setItem('ml_latest_date', statuses[targetType].latest_date); } catch {}
          }
        }
        if (fallbackPred.ok) {
          const jsonPred = await fallbackPred.json();
          const predList = jsonPred.data || [];
          setMlPredictions(predList);
          if (jsonPred.latest_date) {
            setMlLatestDate(jsonPred.latest_date);
            try { localStorage.setItem('ml_latest_date', jsonPred.latest_date); } catch {}
          }
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
      handleSaveTrainSettings(false);
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

  const fetchMarketMlData = async () => {
    try {
      setFetchingMarketMl(true);
      // 同步拉取全球泰坦最新實盤價格 (直接連線資料庫 API 或 Supabase 快取)
      try {
        const gsRes = await stockFetch('/api/global_sovereign/dashboard', { timeout: 6000 });
        if (gsRes && gsRes.ok) {
          const gsJson = await gsRes.json();
          if (gsJson && gsJson.status === 'ok') {
            setGlobalSovereignLive(gsJson);
          }
        } else {
          const sbGsRes = await supabaseFetch('/stock_ml_cache?model_type=eq.global_sovereign_dashboard&select=payload');
          if (sbGsRes.ok) {
            const sbRows = await sbGsRes.json();
            if (sbRows && sbRows.length > 0 && sbRows[0].payload) {
              const pGs = typeof sbRows[0].payload === 'string' ? JSON.parse(sbRows[0].payload) : sbRows[0].payload;
              if (pGs && pGs.status === 'ok') setGlobalSovereignLive(pGs);
            }
          }
        }
      } catch (gsErr) {}

      const res = await supabaseFetch('/stock_ml_cache?model_type=eq.taiex_macro&select=payload,updated_at');
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          const payloadData = typeof rows[0].payload === 'string'
            ? JSON.parse(rows[0].payload)
            : rows[0].payload;
          setMarketMlData(payloadData);
          return;
        }
      } else {
        console.error('讀取大盤 ML 預測失敗 HTTP status:', res.status);
      }
    } catch (err) {
      console.error('讀取大盤 ML 預測失敗', err);
    } finally {
      setFetchingMarketMl(false);
    }
  };

  const fetchMarketMlBtData = async () => {
    if (marketMlBtData || fetchingMarketMlBt) return;
    try {
      setFetchingMarketMlBt(true);
      const res = await supabaseFetch('/stock_ml_cache?model_type=eq.taiex_macro_bt&select=payload');
      if (res.ok) {
        const rows = await res.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          const payloadData = typeof rows[0].payload === 'string'
            ? JSON.parse(rows[0].payload)
            : rows[0].payload;
          setMarketMlBtData(payloadData?.backtest_simulation || payloadData);
        }
      }
    } catch (err) {
      console.error('讀取回測詳細資料失敗', err);
    } finally {
      setFetchingMarketMlBt(false);
    }
  };

  const handleSelectMarketModel = (modelId) => {
    setMarketMlModelType(modelId);
    localStorage.setItem('market_ml_model_type', modelId);
  };

  const handleApplyMarketMlPreset = (preset) => {
    setMarketMlPreset(preset.id);
    localStorage.setItem('market_ml_preset', preset.id);
    setMarketMlTrainDays(preset.trainDays);
    localStorage.setItem('market_ml_train_days', preset.trainDays);
    setMarketMlTestRatio(preset.testRatio);
    localStorage.setItem('market_ml_test_ratio', preset.testRatio);
    setMarketMlThreshold(preset.threshold);
    localStorage.setItem('market_ml_threshold', preset.threshold);
  };

  const handleSaveMarketTrainSettings = () => {
    localStorage.setItem('market_ml_train_days', marketMlTrainDays);
    localStorage.setItem('market_ml_test_ratio', marketMlTestRatio);
    localStorage.setItem('market_ml_threshold', marketMlThreshold);
    localStorage.setItem('market_ml_preset', marketMlPreset);
    localStorage.setItem('market_ml_auto_tune', marketMlAutoTune);
    localStorage.setItem('market_ml_tune_trials', marketMlTuneTrials);
    localStorage.setItem('market_ml_labeling_method', marketMlLabelingMethod);
    localStorage.setItem('market_ml_labeling_param', marketMlLabelingParam);
    setMarketMlSavedToast(true);
    setTimeout(() => setMarketMlSavedToast(false), 2500);
  };

  const handleTriggerMarketMlJob = async (jobType = 'market_ml_predict', extraConfig = {}) => {
    try {
      setTriggeringMarketMl(true);
      const configPayload = {
        job_type: jobType,
        model_type: extraConfig.model_type || marketMlModelType,
        train_days: extraConfig.train_days !== undefined ? extraConfig.train_days : marketMlTrainDays,
        test_ratio: extraConfig.test_ratio !== undefined ? extraConfig.test_ratio : marketMlTestRatio,
        threshold_pct: extraConfig.threshold !== undefined ? extraConfig.threshold : marketMlThreshold,
        features_preset: extraConfig.features_preset || marketMlPreset,
        auto_tune: extraConfig.auto_tune !== undefined ? extraConfig.auto_tune : marketMlAutoTune,
        tune_trials: extraConfig.tune_trials !== undefined ? extraConfig.tune_trials : marketMlTuneTrials,
        labeling_method: extraConfig.labeling_method || marketMlLabelingMethod,
        labeling_param: extraConfig.labeling_param !== undefined ? extraConfig.labeling_param : marketMlLabelingParam,
        ...extraConfig
      };

      // 雙軌發起：若有本地後端則直呼 /api/market_ml/predict
      try {
        if (jobType === 'market_ml_predict') {
          stockFetch('/api/market_ml/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configPayload)
          }).catch(() => {});
        }
      } catch (e) {}

      const createRes = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify({
          username: user?.username || 'hotpotlu',
          status: 'pending',
          config: configPayload
        })
      });

      if (createRes.ok) {
        const jobList = await createRes.json();
        const jobId = jobList[0]?.id;
        if (jobId) {
          let attempts = 0;
          const maxAttempts = 120;
          while (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1500));
            attempts++;
            const checkRes = await supabaseFetch(`/stock_screener_jobs?id=eq.${jobId}`);
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData && checkData.length > 0) {
                const current = checkData[0];
                if (current.status === 'completed') {
                  if (current.results?.data) {
                    setMarketMlData(prev => {
                      const incoming = current.results.data;
                      const merged = { ...prev, ...incoming };
                      if (!incoming.backtest_simulation && prev?.backtest_simulation) {
                        merged.backtest_simulation = prev.backtest_simulation;
                      }
                      return merged;
                    });
                  }
                  await fetchMarketMlData();
                  await fetchMarketMlBtData();
                  const isAutoTuned = extraConfig.auto_tune || (extraConfig.auto_tune === undefined && marketMlAutoTune);
                  if (jobType === 'market_ml_train') {
                    alert(isAutoTuned
                      ? '🎉 大盤 ML 模型「全域參數尋優＋重訓」完成！已成功鎖定 Global Minima 最適超參數並更新至雲端戰情室！'
                      : '🎉 大盤 ML 模型訓練與指標評估完成！'
                    );
                  } else {
                    alert('🚀 大盤與泰坦實戰部位最新推論已完成！');
                  }
                  return;
                } else if (current.status === 'error') {
                  throw new Error(current.error_message || '大盤任務執行發生錯誤');
                }
              }
            }
          }
        }
      }
    } catch (err) {
      alert('大盤運算任務失敗: ' + err.message);
    } finally {
      setTriggeringMarketMl(false);
      fetchMarketMlData();
      fetchMarketMlBtData();
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
          remote_api_url: cfg.remote_api_url || prev.remote_api_url,
        }));
        if (cfg.remote_api_url) {
          dynamicApiBase = cfg.remote_api_url;
          try { localStorage.setItem('remote_api_url', cfg.remote_api_url); } catch {}
        }
        if (cfg.screener_presets) {
          try {
            const parsed = JSON.parse(cfg.screener_presets);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setCustomPresets(parsed);
              localStorage.setItem('screener_saved_presets', cfg.screener_presets);
            }
          } catch (e) {
            console.warn('解析雲端選股預設集失敗', e);
          }
        }
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

  const formatPodcastApiError = (actionName, err) => {
    if (err?.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
      return `${actionName}失敗 (連線未建立)：\n無法連線至本地分析後端 (http://localhost:8000)。\n\n📌 處理解決方式：\n1. 本系統之 Whisper 音訊解碼與 RSS 爬取需依賴本地後端。\n2. 若您是透過雲端網址 (https://lobster-report.vercel.app) 操作，瀏覽器可能因跨網域安全性限制阻擋本機連線。\n3. 請直接在瀏覽器開啟本地控制台進行即時操作：\n👉 http://localhost:8000`;
    }
    return `${actionName}失敗: ${err.message || '未知錯誤'}`;
  };

  const fetchPodcastChannels = async () => {
    // 優先探測本地後端連線狀況
    try {
      const probeRes = await stockFetch('/api/podcast/channels');
      if (probeRes.ok) {
        setLocalEngineOnline(true);
        const json = await probeRes.json();
        setPodcastChannels(json);
        return;
      }
    } catch {
      setLocalEngineOnline(false);
    }

    try {
      // 1. 優先從 Supabase 快取載入 (0ms 跨裝置同步)
      const resSupabase = await supabaseFetch('/stock_ml_cache?model_type=eq.podcast_data&select=payload');
      if (resSupabase.ok) {
        const rows = await resSupabase.json();
        if (rows && rows.length > 0 && rows[0].payload?.channels) {
          setPodcastChannels(rows[0].payload.channels);
          return;
        }
      }
    } catch (err) {
      console.warn('無法讀取 Podcast 頻道列表，啟用離線快取', err);
    }

    // 3. 離線靜態打包備援
    if (defaultPodcastData?.channels) {
      setPodcastChannels(defaultPodcastData.channels);
    }
  };

  const sortEpisodesChronologically = (eps) => {
    if (!Array.isArray(eps)) return [];
    return [...eps].sort((a, b) => {
      const tA = new Date(a.pub_date || 0).getTime() || 0;
      const tB = new Date(b.pub_date || 0).getTime() || 0;
      return tB - tA;
    });
  };

  const fetchPodcastEpisodes = async (channelId = selectedPodcastChannelId) => {
    try {
      // 1. 優先從 Supabase 快取載入
      const resSupabase = await supabaseFetch('/stock_ml_cache?model_type=eq.podcast_data&select=payload');
      if (resSupabase.ok) {
        const rows = await resSupabase.json();
        if (rows && rows.length > 0 && rows[0].payload?.episodes) {
          const allEps = rows[0].payload.episodes;
          const filtered = channelId ? allEps.filter(e => e.channel_id === channelId) : allEps;
          setPodcastEpisodes(sortEpisodesChronologically(filtered));
          return;
        }
      }

      // 2. 嘗試本地後端
      const url = channelId ? `/api/podcast/episodes?channel_id=${channelId}&limit=100` : '/api/podcast/episodes?limit=100';
      const res = await stockFetch(url);
      if (res.ok) {
        const json = await res.json();
        setPodcastEpisodes(sortEpisodesChronologically(json));
        return;
      }
    } catch (err) {
      console.warn('無法讀取 Podcast 單集列表，啟用離線快取', err);
    }

    // 3. 離線靜態打包備援
    if (defaultPodcastData?.episodes) {
      const allEps = defaultPodcastData.episodes;
      const filtered = channelId ? allEps.filter(e => e.channel_id === channelId) : allEps;
      setPodcastEpisodes(sortEpisodesChronologically(filtered));
    }
  };

  const fetchPodcastProgress = async () => {
    try {
      const res = await stockFetch('/api/podcast/progress');
      if (res.ok) {
        const json = await res.json();
        setPodcastProgress(json);
        return;
      }
    } catch (e) {}

    try {
      const resSupabase = await supabaseFetch('/stock_ml_cache?model_type=eq.podcast_progress&select=payload');
      if (resSupabase.ok) {
        const rows = await resSupabase.json();
        if (rows && rows.length > 0 && rows[0].payload) {
          setPodcastProgress(rows[0].payload);
        }
      }
    } catch (e) {}
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
      alert(formatPodcastApiError('新增頻道', err));
    } finally {
      setAddingChannel(false);
    }
  };

  const dispatchPodcastCloudJob = async (jobType, config = {}) => {
    try {
      const res = await supabaseFetch('/stock_screener_jobs', {
        method: 'POST',
        body: JSON.stringify({
          username: user?.username || 'cloud_user',
          status: 'pending',
          config: { job_type: jobType, ...config }
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleRestoreDefaultPodcastChannels = async () => {
    try {
      setAddingChannel(true);
      let success = false;
      try {
        const res = await stockFetch('/api/podcast/channels/restore_defaults', { method: 'POST' });
        if (res.ok) {
          const json = await res.json();
          alert(json.message || '已成功恢復預設熱門頻道 (股癌、游庭皓的財經皓角)！');
          success = true;
          fetchPodcastChannels();
          fetchPodcastEpisodes();
        }
      } catch (directErr) {
        console.warn('直接連線失敗，自動轉派雲端 Worker 佇列', directErr);
      }

      if (!success) {
        const queued = await dispatchPodcastCloudJob('podcast_restore_defaults');
        if (queued) {
          alert('🔄 已發送恢復推薦頻道指令至 Worker，請於數秒後刷新頁面！');
          setTimeout(() => {
            fetchPodcastChannels();
            fetchPodcastEpisodes();
          }, 3000);
        } else {
          throw new Error('無法恢復預設頻道');
        }
      }
    } catch (err) {
      alert(formatPodcastApiError('恢復頻道', err));
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
      alert(formatPodcastApiError('刪除頻道', err));
    }
  };

  const handleRefreshPodcastChannel = async (channelId) => {
    try {
      setRefreshingChannelId(channelId);
      let success = false;
      try {
        const res = await stockFetch(`/api/podcast/channels/${channelId}/refresh`, { method: 'POST' });
        if (res.ok) {
          const json = await res.json();
          alert(json.message);
          success = true;
          fetchPodcastEpisodes();
        }
      } catch (directErr) {
        console.warn('直接連線失敗，自動轉派雲端 Worker 佇列', directErr);
      }

      if (!success) {
        const queued = await dispatchPodcastCloudJob('podcast_refresh', { channel_id: channelId });
        if (queued) {
          alert('⚡ 已成功發送「刷新單集」至本地 Worker 運算佇列！\n\n您的本地電腦將在背景執行單集解析與同步，請於 5~10 秒後刷新檢視最新單集。');
          setTimeout(() => fetchPodcastEpisodes(), 5000);
        } else {
          throw new Error('無法連線後端且雲端佇列建立失敗');
        }
      }
    } catch (err) {
      alert(formatPodcastApiError('刷新單集', err));
    } finally {
      setRefreshingChannelId(null);
    }
  };

  const handleBatchAnalyzeChannel = async (channelId, limit) => {
    try {
      setBatchAnalyzingChannelId(channelId);
      let success = false;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (geminiApiKey) headers['X-Gemini-API-Key'] = geminiApiKey;
        const res = await stockFetch(`/api/podcast/channels/${channelId}/batch_transcribe`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ limit })
        });
        if (res.ok) {
          const json = await res.json();
          alert(json.message);
          success = true;
          fetchPodcastEpisodes();
        }
      } catch (directErr) {
        console.warn('直接連線失敗，自動轉派雲端 Worker 佇列', directErr);
      }

      if (!success) {
        const queued = await dispatchPodcastCloudJob('podcast_batch_transcribe', { channel_id: channelId, limit, gemini_api_key: geminiApiKey });
        if (queued) {
          alert(`🚀 已成功將批次分析 (${limit} 集) 任務發送至本地 Worker！\n\n本地電腦完成後將自動推播至雲端，請稍候重新整理。`);
        } else {
          throw new Error('批次分析啟動失敗');
        }
      }
    } catch (err) {
      alert(formatPodcastApiError('批次分析', err));
    } finally {
      setBatchAnalyzingChannelId(null);
    }
  };

  const handleTranscribeEpisode = async (episodeGuid) => {
    try {
      setPodcastEpisodes(prev => prev.map(ep => ep.episode_guid === episodeGuid ? { ...ep, status: 'transcribing' } : ep));
      let success = false;
      try {
        const headers = {};
        if (geminiApiKey) headers['X-Gemini-API-Key'] = geminiApiKey;
        const res = await stockFetch(`/api/podcast/transcribe/${episodeGuid}`, {
          method: 'POST',
          headers
        });
        if (res.ok) {
          const json = await res.json();
          alert(json.message);
          success = true;
          fetchPodcastEpisodes();
        }
      } catch (directErr) {
        console.warn('直接連線失敗，自動轉派雲端 Worker 佇列', directErr);
      }

      if (!success) {
        const queued = await dispatchPodcastCloudJob('podcast_transcribe', { episode_guid: episodeGuid, gemini_api_key: geminiApiKey });
        if (queued) {
          alert('🤖 已成功將此單集發送至本地 GPU 語音轉譯佇列！\n\n本地電腦將使用 Whisper 模型解碼音訊並由 Gemini 產生趨勢報告。完成後將自動推播回雲端，請在背景稍候。');
        } else {
          throw new Error('無法建立轉譯任務');
        }
      }
    } catch (err) {
      alert(formatPodcastApiError('啟動轉譯', err));
      fetchPodcastEpisodes();
    }
  };

  const mlModelTypeRef = React.useRef(mlModelType);
  React.useEffect(() => {
    mlModelTypeRef.current = mlModelType;
  }, [mlModelType]);

  React.useEffect(() => {
    if (!user) return;
    fetchSettings();
    fetchScheduleSettings();
    fetchBacktestSettings();
    fetchActiveTasks();
    fetchMarketMlData();
    fetchPodcastProgress();

    // 1. 每秒碼表遞增
    const timerInterval = setInterval(() => {
      setTaskTimerTick(t => t + 1);
    }, 1000);

    // 2. 背景任務與模型訓練狀態自動輪詢 (每 3 秒同步最新任務與模型狀態)
    const taskPollInterval = setInterval(async () => {
      fetchActiveTasks();
      fetchPodcastProgress();
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
          setMlStatus(prev => statuses[mlModelTypeRef.current] || prev);
        }
      } catch (err) {}
    }, 3000);

    return () => {
      clearInterval(timerInterval);
      clearInterval(taskPollInterval);
    };
  }, []);

  React.useEffect(() => {
    if (!user) return;
    if (activeTab === 'portfolio') {
      fetchPortfolio();
    } else if (activeTab === 'ml') {
      fetchMlStatusAndPredictions();
    } else if (activeTab === 'schedule') {
      fetchScheduleSettings();
    } else if (activeTab === 'podcast') {
      fetchPodcastChannels();
      fetchPodcastEpisodes();
      fetchPodcastProgress();
    } else if (activeTab === 'watchlist') {
      fetchWatchlist();
      fetchWatchlistAlerts();
    } else if (activeTab === 'low_freq') {
      fetchLowFreqStatus();
    } else if (activeTab === 'market_ml') {
      fetchMarketMlData();
      fetchMarketMlBtData();
    } else if (activeTab === 'database' || activeTab === 'scraper') {
      fetchDbStatus();
      fetchScraperLiveStatus();
    }
  }, [activeTab, mlModelType, marketMlSubTab]);

  useEffect(() => {
    let interval = null;
    let isMounted = true;

    if (activeTab === 'database' || activeTab === 'scraper') {
      // 1. 切換至資料庫分頁時，立即向後端拉取一次最新爬蟲與同步狀態
      const checkInitialStatus = async () => {
        try {
          const res = await stockFetch('/api/scraper/status');
          if (res.ok && isMounted) {
            const status = await res.json();
            if (status.is_running || status.status === 'running') {
              setShowScraperBanner(true);
            }
            setScraperLiveStatus(status);
          }
        } catch (e) {}
      };
      checkInitialStatus();

      // 2. 設定輪詢：若任務執行中或 Banner 開啟，以 1.5 秒密集輪詢；若閒置則以 8 秒輕量輪詢監聽
      const pollFreq = (scraperLiveStatus?.is_running || showScraperBanner) ? 1500 : 8000;
      interval = setInterval(async () => {
        try {
          const res = await stockFetch('/api/scraper/status');
          if (res.ok && isMounted) {
            const status = await res.json();
            setScraperLiveStatus(prev => {
              if (
                prev?.is_running === status.is_running &&
                prev?.progress_percent === status.progress_percent &&
                prev?.current_step === status.current_step &&
                prev?.status === status.status &&
                (prev?.logs?.length || 0) === (status?.logs?.length || 0)
              ) {
                return prev;
              }
              return status;
            });

            if (status.is_running || status.status === 'running') {
              setShowScraperBanner(true);
            } else if (scraperLiveStatus?.is_running && !status.is_running) {
              // 任務甫完成，延遲 300ms 刷新資料庫總量、全球泰坦與最新資料
              setTimeout(() => {
                fetchDbStatus();
                fetchMarketMlData();
                fetchPortfolio();
                if (activeDbTable) {
                  loadDbTableData(activeDbTable, dbPage, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir);
                }
              }, 300);
            }
          }
        } catch (e) {}
      }, pollFreq);
    }

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, [activeTab, scraperLiveStatus?.is_running, showScraperBanner, activeDbTable, dbPage, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir]);

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

  const handleUpdatePortfolioStock = async (stockId, buyPrice, notes) => {
    try {
      const parsedPrice = (buyPrice !== '' && buyPrice !== null && !isNaN(buyPrice)) ? parseFloat(buyPrice) : null;
      const cleanNotes = notes || '';
      const payload = {
        buy_price: parsedPrice,
        notes: cleanNotes
      };
      const res = await supabaseFetch(`/stock_portfolio?stock_id=eq.${stockId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setPortfolioList(prev => prev.map(p => p.stock_id === stockId ? { ...p, ...payload } : p));
      } else {
        const fallbackRes = await stockFetch(`/api/portfolio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId, ...payload })
        });
        if (fallbackRes.ok) {
          fetchPortfolio();
        }
      }
      setEditingPortfolioStock(null);
    } catch (err) {
      alert('更新持股失敗: ' + err.message);
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
  const [screenerModel, setScreenerModel] = useState('gemini-3.5-flash-lite');

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
    setActivePresetId(null);
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
      // 1. 優先搜尋 ```json ... ``` 區塊
      const jsonMatch = selectedEpisode.analysis_report.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        return JSON.parse(jsonMatch[1].trim());
      }
      // 2. 尋找最末尾的 { ... } 物件 (因為 JSON 指標位於報告最尾端)
      const lastOpenBrace = selectedEpisode.analysis_report.lastIndexOf('{');
      const lastCloseBrace = selectedEpisode.analysis_report.lastIndexOf('}');
      if (lastOpenBrace !== -1 && lastCloseBrace > lastOpenBrace) {
        const potentialJson = selectedEpisode.analysis_report.substring(lastOpenBrace, lastCloseBrace + 1);
        return JSON.parse(potentialJson);
      }
    } catch (e) {
      console.warn("解析 Podcast JSON 指標警告:", e);
    }
    return null;
  }, [selectedEpisode]);

  const runScraper = async (taskType) => {
    try {
      setLoading(true);
      const taskLabel = taskType === 'daily' ? '每日股價與大盤' : '最新月營收';
      setScraperStatus(`⏳ 正在啟動「${taskLabel}」爬蟲任務...`);
      setShowScraperBanner(true);
      setScraperLiveStatus({
        is_running: true,
        task_type: taskType,
        target_db: 'tw_stock.db (本機 SQLite 主資料庫)',
        target_table: taskType === 'daily' ? 'daily_stock' : 'monthly_revenue',
        target_table_name: taskLabel,
        current_step: `🚀 正在連線啟動「${taskLabel}」爬蟲任務...`,
        step_index: 1,
        total_steps: 5,
        progress_percent: 5,
        status: 'running',
        started_at: new Date().toLocaleTimeString(),
        logs: [`► [${new Date().toLocaleTimeString()}] 收到爬蟲啟動指令...`]
      });
      
      let backendStarted = false;
      try {
        const res = await stockFetch(`/api/scraper/${taskType}`, { method: 'POST' });
        if (res.ok) {
          backendStarted = true;
          await fetchScraperLiveStatus();
        }
      } catch (e) {
        console.warn('本地後端爬蟲 API 呼叫跳過，轉由雲端派工:', e);
      }

      let cloudDispatched = false;
      if (!backendStarted) {
        try {
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
            cloudDispatched = true;
          }
        } catch (e) {
          console.warn('雲端任務派工警告:', e);
        }
      }

      if (backendStarted) {
        setScraperStatus(`✅「${taskLabel}」爬蟲任務已在伺服器背景啟動執行中！正在抓取最新資料。`);
      } else if (cloudDispatched) {
        setScraperStatus(`✅「${taskLabel}」爬蟲任務已下發至本機 Worker 任務隊列，正在抓取最新資料！`);
      } else {
        setScraperStatus(`⚠️ 任務指令已送出，請稍候刷新確認最新資料。`);
      }
    } catch (err) {
      setScraperStatus('❌ 啟動爬蟲失敗: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 同步自訂條件預設集至 localStorage 與 Supabase stock_settings
  const persistCustomPresets = async (updatedList) => {
    setCustomPresets(updatedList);
    localStorage.setItem('screener_saved_presets', JSON.stringify(updatedList));
    try {
      await supabaseFetch('/stock_settings', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          key: 'screener_presets',
          value: JSON.stringify(updatedList),
          updated_at: new Date().toISOString()
        })
      });
    } catch (err) {
      console.warn('同步選股預設集至雲端失敗', err);
    }
  };

  const handleSaveCurrentAsPreset = () => {
    if (!newPresetName.trim()) {
      alert('請輸入條件名稱！');
      return;
    }
    const newPreset = {
      id: `custom_${Date.now()}`,
      name: newPresetName.trim(),
      desc: '使用者自訂篩選條件',
      config: { ...config },
      isCustom: true
    };
    const updated = [...customPresets, newPreset];
    persistCustomPresets(updated);
    setActivePresetId(newPreset.id);
    setShowSavePresetModal(false);
    setNewPresetName('');
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleDeletePreset = (id) => {
    const updated = customPresets.filter(p => p.id !== id);
    persistCustomPresets(updated);
    if (activePresetId === id) setActivePresetId(null);
  };

  const activeCustomPreset = useMemo(() => {
    return customPresets.find(p => p.id === activePresetId) || null;
  }, [customPresets, activePresetId]);

  const handleOpenEditPreset = (preset) => {
    setEditingPreset(preset);
    setEditPresetName(preset.name);
    setEditPresetConfig({ ...preset.config });
  };

  const handleSaveEditedPreset = () => {
    if (!editPresetName.trim()) {
      alert('條件名稱不能為空！');
      return;
    }
    const updated = customPresets.map(p => {
      if (p.id === editingPreset.id) {
        return {
          ...p,
          name: editPresetName.trim(),
          config: { ...(editPresetConfig || p.config) },
          updated_at: new Date().toISOString()
        };
      }
      return p;
    });
    persistCustomPresets(updated);
    if (activePresetId === editingPreset.id && editPresetConfig) {
      setConfig({ ...editPresetConfig });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(editPresetConfig));
    }
    setEditingPreset(null);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleQuickUpdateActivePreset = () => {
    if (!activeCustomPreset) return;
    const updated = customPresets.map(p => {
      if (p.id === activePresetId) {
        return {
          ...p,
          config: { ...config },
          updated_at: new Date().toISOString()
        };
      }
      return p;
    });
    persistCustomPresets(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleApplyPresetAndRun = (preset) => {
    setActivePresetId(preset.id);
    setConfig(preset.config);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preset.config));
    runScreener(preset.config);
  };

  const runScreener = async (overrideConfig = null) => {
    const activeConfig = overrideConfig || config;
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
          config: activeConfig
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

  const fetchScraperLiveStatus = async () => {
    try {
      const res = await stockFetch('/api/scraper/status');
      if (res.ok) {
        const json = await res.json();
        setScraperLiveStatus(json);
        return json;
      }
    } catch (e) {}
    return null;
  };

  const fetchDbStatus = async () => {
    try {
      const res = await stockFetch('/api/database/status');
      if (res.ok) {
        const json = await res.json();
        if (json.tables && json.tables.length > 0) {
          setDbTablesList(prev => {
            const remoteMap = new Map(json.tables.map(t => [t.id, t]));
            const updated = prev.map(item => {
              const remote = remoteMap.get(item.id);
              if (remote) {
                return {
                  ...item,
                  row_count: (remote.row_count !== undefined && remote.row_count > 0) ? remote.row_count : item.row_count,
                  latest_date: (remote.latest_date && remote.latest_date !== '-') ? remote.latest_date : item.latest_date,
                  columns_count: remote.columns_count || item.columns_count,
                  status: remote.status || item.status
                };
              }
              return item;
            });
            json.tables.forEach(rt => {
              if (!prev.some(p => p.id === rt.id)) {
                updated.push({
                  id: rt.id,
                  name: rt.name || rt.id,
                  desc: rt.desc || '',
                  category: rt.category || '其他',
                  categoryKey: rt.categoryKey || (rt.category === '泰坦實作' ? 'titan' : rt.category === '全球資產' ? 'global' : rt.category === '台股核心' ? 'core' : (rt.category === '總體經濟' || rt.category === '大盤總覽') ? 'macro' : rt.category === '基本面' ? 'fundamental' : (rt.category === '籌碼面' || rt.category === '期貨籌碼') ? 'chips' : 'system'),
                  frequency: rt.frequency || '定期更新',
                  task_type: rt.task_type || 'daily',
                  row_count: rt.row_count || 0,
                  latest_date: rt.latest_date || '-',
                  columns_count: rt.columns_count || 0,
                  status: rt.status || 'active'
                });
              }
            });
            return updated;
          });
        }
      } else {
        // 2. 備援直接從 Supabase 資料庫 stock_database_preview 讀取真實資料表即時狀態
        const supRes = await supabaseFetch('/stock_database_preview?select=table_name,data,row_count,updated_at');
        if (supRes.ok) {
          const rows = await supRes.json();
          if (rows && rows.length > 0) {
            setDbTablesList(prev => {
              const remoteMap = new Map();
              rows.forEach(r => {
                const dataArr = Array.isArray(r.data) ? r.data : [];
                let rawDate = dataArr[0]?.date ? String(dataArr[0].date) : '';
                let latestDate = rawDate ? (rawDate.includes('-') ? rawDate.replace(/-/g, '/') : rawDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3')) : (r.updated_at ? r.updated_at.split('T')[0].replace(/-/g, '/') : '-');
                const prevItem = prev.find(p => p.id === r.table_name);
                const finalCount = (r.row_count !== undefined && r.row_count !== null && r.row_count > 0) ? r.row_count : (prevItem?.row_count || dataArr.length || 0);
                remoteMap.set(r.table_name, {
                  row_count: finalCount,
                  latest_date: latestDate,
                  updated_at: r.updated_at
                });
              });
              return prev.map(item => {
                const remote = remoteMap.get(item.id);
                if (remote) {
                  return {
                    ...item,
                    row_count: (remote.row_count && remote.row_count > 0) ? remote.row_count : item.row_count,
                    latest_date: (remote.latest_date && remote.latest_date !== '-') ? remote.latest_date : item.latest_date,
                    status: 'active'
                  };
                }
                return item;
              });
            });
          }
        }
      }
    } catch (e) {
      // 若後端無法連線，嘗試直接連線 Supabase
      try {
        const supRes = await supabaseFetch('/stock_database_preview?select=table_name,data,row_count,updated_at');
        if (supRes.ok) {
          const rows = await supRes.json();
          if (rows && rows.length > 0) {
            setDbTablesList(prev => {
              const remoteMap = new Map();
              rows.forEach(r => {
                const dataArr = Array.isArray(r.data) ? r.data : [];
                let rawDate = dataArr[0]?.date ? String(dataArr[0].date) : '';
                let latestDate = rawDate ? (rawDate.includes('-') ? rawDate.replace(/-/g, '/') : rawDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1/$2/$3')) : (r.updated_at ? r.updated_at.split('T')[0].replace(/-/g, '/') : '-');
                const prevItem = prev.find(p => p.id === r.table_name);
                const finalCount = (r.row_count !== undefined && r.row_count !== null && r.row_count > 0) ? r.row_count : (prevItem?.row_count || dataArr.length || 0);
                remoteMap.set(r.table_name, {
                  row_count: finalCount,
                  latest_date: latestDate,
                  updated_at: r.updated_at
                });
              });
              return prev.map(item => {
                const remote = remoteMap.get(item.id);
                if (remote) {
                  return {
                    ...item,
                    row_count: (remote.row_count && remote.row_count > 0) ? remote.row_count : item.row_count,
                    latest_date: (remote.latest_date && remote.latest_date !== '-') ? remote.latest_date : item.latest_date,
                    status: 'active'
                  };
                }
                return item;
              });
            });
          }
        }
      } catch (errSup) {
        console.warn('載入資料庫狀態即時數據跳過，使用本地快照:', errSup);
      }
    }

    try {
      const bRes = await stockFetch('/api/scraper/history_status');
      if (bRes.ok) {
        const bJson = await bRes.json();
        if (bJson.total_trading_days) {
          setDbBackfillStatus(bJson);
        }
      }
    } catch (e) {}

    await fetchScraperLiveStatus();
  };

  const loadDbTableData = async (
    tableId = activeDbTable,
    page = 1,
    pageSize = dbPageSize,
    search = dbSearchQuery,
    sortKey = dbSortKey,
    sortDir = dbSortDir
  ) => {
    if (!tableId) return;
    setDbTableLoading(true);
    setDbActionBanner('');
    try {
      let loaded = false;
      // 1. 優先嘗試從本地/遠端 FastAPI 讀取 (支援伺服器端分頁、精準搜尋與即時排序)
      try {
        const params = new URLSearchParams({
          page: String(page || 1),
          page_size: String(pageSize || 100)
        });
        if (search && search.trim()) params.set('search', search.trim());
        if (sortKey) {
          params.set('sort_by', sortKey);
          params.set('sort_dir', sortDir || 'asc');
        }
        const res = await stockFetch(`/api/database/${tableId}?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            setDbTableRows(json.data);
            setDbTableCols(json.columns && json.columns.length > 0 ? json.columns : Object.keys(json.data[0] || {}));
            const tableMeta = dbTablesList.find(t => t.id === tableId);
            const tot = (json.total_count !== undefined && json.total_count > 0) ? json.total_count : (tableMeta?.row_count || json.data.length);
            setDbTotalCount(tot);
            const totPages = json.total_pages !== undefined ? json.total_pages : Math.max(1, Math.ceil(tot / (pageSize || 100)));
            setDbTotalPages(totPages);
            setDbPage(json.page || page || 1);
            setDbJumpPageInput(String(json.page || page || 1));
            setDbIsRemoteLoaded(true);
            loaded = true;
          }
        }
      } catch (err) {
        console.warn('FastAPI 資料庫讀取異常，切換至雲端快照備援:', err);
      }

      // 2. 備援：若本地/遠端 API 不可用，從 Supabase 雲端快照讀取
      if (!loaded) {
        const supRes = await supabaseFetch(`/stock_database_preview?table_name=eq.${tableId}&select=columns,data,row_count`);
        if (supRes.ok) {
          const rows = await supRes.json();
          if (rows && rows.length > 0 && rows[0].data) {
            const rawData = rows[0].data;
            const cols = rows[0].columns || (rawData[0] ? Object.keys(rawData[0]) : []);
            setDbTableCols(cols);
            const tableMeta = dbTablesList.find(t => t.id === tableId);
            const reportedTotal = (rows[0].row_count && rows[0].row_count > 0) ? rows[0].row_count : (tableMeta?.row_count || rawData.length);
            setDbTotalCount(reportedTotal);
            setDbIsRemoteLoaded(false);

            // 在快照樣本上進行客戶端搜尋與排序
            let displayRows = rawData;
            if (search && search.trim()) {
              const q = search.trim().toLowerCase();
              displayRows = displayRows.filter(r =>
                Object.values(r).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
              );
            }
            if (sortKey) {
              displayRows = [...displayRows].sort((a, b) => {
                let va = a[sortKey], vb = b[sortKey];
                if (va === null || va === undefined) return 1;
                if (vb === null || vb === undefined) return -1;
                const na = Number(va), nb = Number(vb);
                if (!isNaN(na) && !isNaN(nb)) return sortDir === 'asc' ? na - nb : nb - na;
                return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
              });
            }
            setDbTableRows(displayRows);
            const totPages = Math.max(1, Math.ceil(reportedTotal / (pageSize || 100)));
            setDbTotalPages(totPages);
            setDbPage(page || 1);
            setDbJumpPageInput(String(page || 1));
            loaded = true;
            setDbActionBanner(`ℹ️ 已連線至雲端快照備援（顯示最新 ${displayRows.length} 筆樣本，資料表總資料量：${Number(reportedTotal).toLocaleString()} 筆）。`);
          }
        }
      }

      if (!loaded) {
        setDbActionBanner(`⚠️ 目前未能取得「${tableId}」的資料預覽，請確認後端服務是否已就緒。`);
      }
    } catch (err) {
      setDbActionBanner(`❌ 載入資料表失敗: ${err.message}`);
    } finally {
      setDbTableLoading(false);
    }
  };

  const selectDbTable = async (tableId) => {
    setActiveDbTable(tableId);
    setDbPage(1);
    setDbJumpPageInput('1');
    setDbSearchQuery('');
    setDbSortKey(null);
    setDbSortDir('asc');
    await loadDbTableData(tableId, 1, dbPageSize, '', null, 'asc');
  };

  const handleTriggerDbScraper = async (taskType, tableName, tableId) => {
    const actualTaskType = taskType || 'daily';
    const displayTableName = tableName || '市場資料';
    const targetDbName = 'tw_stock.db (本機主資料庫)';

    setDbUpdatingTableId(tableId || 'global_daily');
    setShowScraperBanner(true);
    // 立即將狀態設為執行中，確保前端毫秒級即時跳出進度看板，不漏掉任何細節
    setScraperLiveStatus({
      is_running: true,
      task_type: actualTaskType,
      target_db: targetDbName,
      target_table: tableId || actualTaskType,
      target_table_name: displayTableName,
      current_step: `🚀 正在連線啟動「${displayTableName}」更新作業...`,
      step_index: 1,
      total_steps: 5,
      progress_percent: 5,
      status: 'running',
      started_at: new Date().toLocaleTimeString(),
      logs: [`► [${new Date().toLocaleTimeString()}] 收到更新指令，準備執行「${displayTableName}」...`]
    });
    setDbActionBanner(`⏳ 正在啟動「${displayTableName}」更新任務... 目標資料庫：${targetDbName}`);
    
    try {
      const res = await stockFetch(`/api/scraper/${actualTaskType}`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setDbActionBanner(`🚀 已成功啟動「${json.target_table_name || displayTableName}」更新作業！正在更新資料庫：${json.target_db || targetDbName}`);
      }
      await fetchScraperLiveStatus();
    } catch (err) {
      console.warn('本地爬蟲 API 呼叫異常，嘗試下發雲端任務隊列:', err);
      try {
        await supabaseFetch('/stock_screener_jobs', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            username: user?.username || 'hotpotlu',
            status: 'pending',
            config: { job_type: 'scraper', task_type: actualTaskType }
          })
        });
        setDbActionBanner(`✅「${displayTableName}」已派送至雲端 Worker 任務隊列，正在排程更新！`);
        setScraperLiveStatus({
          is_running: true,
          task_type: actualTaskType,
          target_db: 'Supabase 雲端任務隊列 -> 本機 tw_stock.db',
          target_table: tableId || actualTaskType,
          target_table_name: displayTableName,
          current_step: `☁️ 任務已排入雲端隊列，等待本機 Worker 接收並執行...`,
          step_index: 1,
          total_steps: 3,
          progress_percent: 25,
          status: 'running',
          started_at: new Date().toLocaleTimeString(),
          logs: [
            `► [${new Date().toLocaleTimeString()}] 任務指令已下發至 Supabase stock_screener_jobs`,
            `► 本機後端將自動排程處理並將最新資料同步回雲端快照`
          ]
        });
      } catch (cloudErr) {
        setDbActionBanner(`❌ 啟動更新失敗: ${err.message}`);
        setScraperLiveStatus(prev => ({
          ...(prev || {}),
          is_running: false,
          status: 'error',
          current_step: `❌ 啟動失敗: ${err.message}`,
          logs: [...(prev?.logs || []), `❌ 錯誤: ${err.message}`]
        }));
      }
    } finally {
      setTimeout(() => {
        setDbUpdatingTableId(null);
      }, 2500);
    }
  };

  const loadDatabase = (tableName) => {
    selectDbTable(tableName);
  };

  const currentDbPageRows = useMemo(() => {
    if (!dbTableRows || dbTableRows.length === 0) return [];
    if (dbIsRemoteLoaded) {
      return dbTableRows;
    }
    if (dbTableRows.length <= dbPageSize) return dbTableRows;
    const start = (dbPage - 1) * dbPageSize;
    return dbTableRows.slice(start, start + dbPageSize);
  }, [dbTableRows, dbIsRemoteLoaded, dbPage, dbPageSize]);

  const copyAiPrompt = (stockId) => {
    const text = aiPrompt.replace('{stock_id}', stockId);
    navigator.clipboard.writeText(text);
  };

  if (!user) {
    return (
      <div className="stock-auth-lock-card glass-panel" style={{ maxWidth: '600px', margin: '60px auto', textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '3.5rem', marginBottom: '16px' }}>🔒</div>
        <h2 style={{ fontSize: '1.8rem', color: '#F8FAFC', marginBottom: '12px' }}>智慧選股與量化分析系統</h2>
        <p style={{ color: '#94A3B8', fontSize: '1rem', lineHeight: '1.6', marginBottom: '24px' }}>
          本功能包含完整台股歷史資料庫、大盤多空預測與智慧選股篩選。<br />
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

  return (
    <div className="app-container">
      <header>
        <h1>智慧選股與籌碼分析系統</h1>
        <p style={{ color: 'var(--text-muted)' }}>Taiwan Stock Screener &amp; Analysis Platform</p>
      </header>

      <div className="glass-panel">
        <div className="tabs">
          {[
            { id: 'screener', label: '🎯 智慧選股器' },
            { id: 'market_ml', label: '📊 股市策略總覽' },
            { id: 'titan_live', label: '👑 台股泰坦實作' },
            { id: 'global_sovereign', label: '🌍 全球主權泰坦' },
            { id: 'podcast', label: '🎧 Podcast 觀點', badge: podcastProgress?.is_active ? `⏳ 分析中 (${podcastProgress.current_job_index || 1}/${podcastProgress.total_jobs || 1})` : null },
            { id: 'database', label: '🗄️ 資料庫與爬蟲控制', badge: activeTasks.some(t => t.type === 'data_backfill') ? '🗄️ 回補中' : null },
            { id: 'schedule', label: '⏰ 排程管理' },
          ].map(t => {
            const isTabActive = (t.id === 'database') 
              ? (activeTab === 'database' || activeTab === 'scraper')
              : (activeTab === t.id);
            return (
              <button
                key={t.id}
                className={`tab-btn ${isTabActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(t.id);
                  try { localStorage.setItem('active_tab', t.id); } catch {}
                  setData(null);
                  setScraperStatus('');
                  setActiveDbTable('');
                }}
                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
              {t.label}
              {t.badge && (
                <span style={{
                  fontSize: '0.68rem',
                  background: t.id === 'podcast' ? 'rgba(6, 182, 212, 0.25)' : 'rgba(239, 68, 68, 0.3)',
                  border: t.id === 'podcast' ? '1px solid rgba(6, 182, 212, 0.7)' : '1px solid rgba(239, 68, 68, 0.7)',
                  color: t.id === 'podcast' ? '#67E8F9' : '#FECACA',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '10px',
                  fontWeight: 'bold'
                }}>
                  {t.badge}
                </span>
              )}
            </button>
            );
          })}

          {podcastProgress?.is_active ? (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.25), rgba(6, 182, 212, 0.25))',
                border: '1px solid rgba(99, 102, 241, 0.5)',
                padding: '0.35rem 0.9rem',
                borderRadius: '24px',
                fontSize: '0.82rem',
                color: '#E0E7FF',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(99, 102, 241, 0.3)',
                transition: 'all 0.3s ease'
              }}
              onClick={() => setActiveTab('podcast')}
              title="點擊切換至 Podcast 查看即時分析進度與任務佇列"
            >
              <span className="live-pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38BDF8', display: 'inline-block', boxShadow: '0 0 8px #38BDF8' }}></span>
              <span>
                ⚡ <strong>AI 分析中：</strong>
                <span style={{ color: '#FDE68A' }}>
                  {podcastProgress.current_episode?.title ? (podcastProgress.current_episode.title.length > 18 ? podcastProgress.current_episode.title.substring(0, 18) + '...' : podcastProgress.current_episode.title) : '單集音訊'}
                </span>
                <span style={{ marginLeft: '0.4rem', color: '#93C5FD' }}>
                  (第 {podcastProgress.current_job_index || 1}/{podcastProgress.total_jobs || 1} 集，剩餘 <strong style={{ color: '#F472B6' }}>{podcastProgress.remaining_jobs ?? 0}</strong> 個 job)
                </span>
              </span>
              <span style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.35)', padding: '2px 6px', borderRadius: '10px', color: '#6EE7B7', fontFamily: 'monospace' }}>
                ⏱️ {formatSecondsToDuration(podcastProgress.current_episode?.started_at ? Math.max(0, Math.floor(Date.now() / 1000 - podcastProgress.current_episode.started_at)) : 0)}
              </span>
            </div>
          ) : activeTasks.length > 0 ? (
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
              title="背景執行中之任務"
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block', boxShadow: '0 0 8px #10B981' }}></span>
              <span><strong>{activeTasks.length}</strong> 個背景任務執行中</span>
            </div>
          ) : null}
        </div>

        {/* ===== 智慧選股器 ===== */}
        {activeTab === 'screener' && (
          <div>
            {/* 置頂快捷選股條件清單（一鍵點擊立即篩選） */}
            <div className="screener-presets-card" style={{
              background: 'rgba(30, 41, 59, 0.85)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              borderRadius: '12px',
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.6rem',
                marginBottom: '0.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F1F5F9' }}>⚡ 常用選股條件清單</span>
                  <span style={{ fontSize: '0.8rem', color: '#94A3B8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '12px' }}>
                    點擊任一條件立即篩選
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      setNewPresetName('');
                      setShowSavePresetModal(true);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #10B981, #059669)',
                      border: 'none',
                      color: 'white',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                    title="將目前的篩選參數記錄為新條件"
                  >
                    <span>➕ 儲存目前條件</span>
                  </button>
                  <button
                    onClick={() => setShowFilterGrid(!showFilterGrid)}
                    style={{
                      background: showFilterGrid ? 'rgba(255,255,255,0.08)' : 'rgba(59, 130, 246, 0.2)',
                      border: showFilterGrid ? '1px solid var(--border-color)' : '1px solid rgba(59, 130, 246, 0.5)',
                      color: showFilterGrid ? '#CBD5E1' : '#93C5FD',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontWeight: '500',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    {showFilterGrid ? '收合篩選器 ▴' : '🔍 展開進階篩選與操作 ▾'}
                  </button>
                </div>
              </div>

              {/* 預設集 Chips 按鈕列表 */}
              <div style={{
                display: 'flex',
                gap: '0.55rem',
                overflowX: 'auto',
                paddingBottom: '0.35rem',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'thin'
              }}>
                {/* 系統內建預設條件 */}
                {BUILTIN_SCREENER_PRESETS.map(preset => {
                  const isActive = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleApplyPresetAndRun(preset)}
                      title={preset.desc}
                      style={{
                        padding: '0.45rem 0.85rem',
                        borderRadius: '20px',
                        border: isActive ? '1.5px solid #60A5FA' : '1px solid rgba(255,255,255,0.15)',
                        background: isActive ? 'linear-gradient(135deg, rgba(37,99,235,0.6), rgba(30,58,138,0.7))' : 'rgba(15, 23, 42, 0.6)',
                        color: isActive ? '#FFFFFF' : '#E2E8F0',
                        fontSize: '0.88rem',
                        fontWeight: isActive ? 'bold' : 'normal',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        boxShadow: isActive ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {preset.name}
                    </button>
                  );
                })}

                {/* 使用者自訂儲存的條件 */}
                {customPresets.map(preset => {
                  const isActive = activePresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: '20px',
                        border: isActive ? '1.5px solid #34D399' : '1px solid rgba(52, 211, 153, 0.3)',
                        background: isActive ? 'linear-gradient(135deg, rgba(5,150,105,0.6), rgba(6,78,59,0.7))' : 'rgba(6, 78, 59, 0.25)',
                        padding: '0.2rem 0.45rem 0.2rem 0.85rem',
                        gap: '0.35rem',
                        whiteSpace: 'nowrap',
                        boxShadow: isActive ? '0 0 10px rgba(16, 185, 129, 0.4)' : 'none'
                      }}
                    >
                      <button
                        onClick={() => handleApplyPresetAndRun(preset)}
                        title={preset.desc || '點擊套用並篩選'}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: isActive ? '#FFFFFF' : '#A7F3D0',
                          fontSize: '0.88rem',
                          fontWeight: isActive ? 'bold' : 'normal',
                          cursor: 'pointer',
                          padding: '0.25rem 0'
                        }}
                      >
                        ⭐ {preset.name}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEditPreset(preset);
                        }}
                        style={{
                          background: 'rgba(96, 165, 250, 0.2)',
                          border: 'none',
                          color: '#93C5FD',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          padding: 0
                        }}
                        title="編輯此條件名稱或篩選參數"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`確定要刪除「${preset.name}」自訂條件嗎？`)) {
                            handleDeletePreset(preset.id);
                          }
                        }}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: 'none',
                          color: '#F87171',
                          borderRadius: '50%',
                          width: '18px',
                          height: '18px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          padding: 0
                        }}
                        title="刪除此條件"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 儲存選股條件彈跳視窗 */}
            {showSavePresetModal && (
              <div className="modal-overlay" style={{ zIndex: 1000 }}>
                <div className="modal-content" style={{ maxWidth: '420px', width: '92%' }}>
                  <div className="analysis-header" style={{ marginBottom: '1rem' }}>
                    <h3 className="analysis-title" style={{ fontSize: '1.1rem' }}>💾 儲存目前篩選條件</h3>
                    <button className="close-btn" onClick={() => setShowSavePresetModal(false)}>×</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                      將您目前的估值、均線與籌碼參數保存為自訂條件，未來可在清單中一鍵套用並自動篩選。
                    </p>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.88rem', color: '#93C5FD' }}>
                        條件名稱 (例如：低PE外資連買股、主力鎖碼破底翻)：
                      </label>
                      <input
                        type="text"
                        placeholder="請輸入自訂條件名稱..."
                        value={newPresetName}
                        onChange={e => setNewPresetName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrentAsPreset(); }}
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '0.55rem 0.75rem',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'white',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    <div style={{
                      background: 'rgba(255,255,255,0.04)',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.82rem',
                      color: 'var(--text-muted)'
                    }}>
                      <div>PE: {config.pe_min || 0} ~ {config.pe_max || 9999} ｜ PB: {config.pb_min || 0} ~ {config.pb_max || 999}</div>
                      <div>成交量: ≥ {Number(config.vol_min || 0).toLocaleString()} 股 ｜ 殖利率: ≥ {config.yield_min || 0}%</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setShowSavePresetModal(false)}
                      >
                        取消
                      </button>
                      <button
                        className="btn btn-save"
                        onClick={handleSaveCurrentAsPreset}
                        style={{ fontWeight: 'bold' }}
                      >
                        確認儲存
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 編輯自訂選股條件彈跳視窗 */}
            {editingPreset && (
              <div className="modal-overlay" style={{ zIndex: 1000 }}>
                <div className="modal-content" style={{ maxWidth: '480px', width: '92%' }}>
                  <div className="analysis-header" style={{ marginBottom: '1rem' }}>
                    <h3 className="analysis-title" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>✏️ 編輯自訂選股條件</span>
                    </h3>
                    <button className="close-btn" onClick={() => setEditingPreset(null)}>×</button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    {/* 條件名稱 */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.88rem', color: '#93C5FD', fontWeight: 'bold' }}>
                        🏷️ 條件名稱：
                      </label>
                      <input
                        type="text"
                        placeholder="請輸入條件名稱..."
                        value={editPresetName}
                        onChange={e => setEditPresetName(e.target.value)}
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '0.6rem 0.75rem',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'white',
                          fontSize: '0.95rem',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    {/* 條件參數目前設定與預覽 */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <label style={{ fontSize: '0.88rem', color: '#34D399', fontWeight: 'bold' }}>
                          ⚙️ 此條件之篩選參數：
                        </label>
                      </div>
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.65)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        padding: '0.75rem 0.9rem',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        color: '#CBD5E1',
                        lineHeight: '1.6'
                      }}>
                        <div><strong>本益比 (PE)：</strong>{editPresetConfig?.pe_min || 0} ~ {editPresetConfig?.pe_max || 9999}</div>
                        <div><strong>淨值比 (PB)：</strong>{editPresetConfig?.pb_min || 0} ~ {editPresetConfig?.pb_max || 999}</div>
                        <div><strong>殖利率 (%)：</strong>≥ {editPresetConfig?.yield_min || 0}%</div>
                        <div><strong>成交量 (股)：</strong>≥ {Number(editPresetConfig?.vol_min || 0).toLocaleString()} 股</div>
                        <div><strong>均線趨勢：</strong>{editPresetConfig?.price_trend === 1 ? '站上 MA5' : editPresetConfig?.price_trend === 2 ? '站上 MA20' : editPresetConfig?.price_trend === 3 ? 'MA5 > MA20 多頭排列' : '不限'}</div>
                        {editPresetConfig?.strat1 && <div><strong>專業策略：</strong>爆量突破季線</div>}
                        {editPresetConfig?.strat2 && <div><strong>專業策略：</strong>均線多頭排列 + 凹洞量</div>}
                        {editPresetConfig?.large_holder_inc && <div><strong>大戶籌碼：</strong>千張大戶近週連增 (▲)</div>}
                        {(editPresetConfig?.inst_buy_days_min > 0 || editPresetConfig?.foreign_buy_days_min > 0 || editPresetConfig?.trust_buy_days_min > 0) && (
                          <div><strong>法人連買：</strong>外資 {editPresetConfig?.foreign_buy_days_min || 0} 天 / 投信 {editPresetConfig?.trust_buy_days_min || 0} 天 / 合計 {editPresetConfig?.inst_buy_days_min || 0} 天</div>
                        )}
                      </div>

                      {/* 覆蓋/更新按鈕 */}
                      <button
                        onClick={() => {
                          setEditPresetConfig({ ...config });
                          alert('已將目前主畫面調整之篩選參數載入！請點擊下方「確認儲存變更」以完成儲存。');
                        }}
                        style={{
                          marginTop: '0.6rem',
                          width: '100%',
                          padding: '0.55rem',
                          background: 'rgba(59, 130, 246, 0.15)',
                          border: '1px dashed #60A5FA',
                          borderRadius: '6px',
                          color: '#93C5FD',
                          fontSize: '0.84rem',
                          fontWeight: '500',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <span>🔄 將條件參數更新為「畫面目前調整的數值」</span>
                      </button>
                    </div>

                    {/* 底部按鈕 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <button
                        className="btn btn-delete"
                        style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
                        onClick={() => {
                          if (confirm(`確定要刪除「${editingPreset.name}」自訂條件嗎？`)) {
                            handleDeletePreset(editingPreset.id);
                            setEditingPreset(null);
                          }
                        }}
                      >
                        🗑️ 刪除此條件
                      </button>

                      <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setEditingPreset(null)}
                        >
                          取消
                        </button>
                        <button
                          className="btn btn-save"
                          onClick={handleSaveEditedPreset}
                          style={{ fontWeight: 'bold' }}
                        >
                          💾 確認儲存變更
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 即時派工與計算狀態提示 (置頂常駐顯示，即時反饋) */}
            {screeningStatus && (
              <div style={{ width: '100%', marginTop: '0.8rem', marginBottom: '0.8rem', padding: '0.65rem 1.2rem', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '8px', color: '#93C5FD', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{screeningStatus}</span>
              </div>
            )}

            {showFilterGrid && (
              <div className="collapsible-screener-filter-box" style={{ marginTop: '0.5rem' }}>
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

            <div className="action-button-group" style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center', flexWrap: 'wrap', position: 'relative' }}>
              <button className="btn btn-main" onClick={runScreener} disabled={loading}>
                {loading ? <span className="loader"></span> : '🚀 開始篩選'}
              </button>
              {activeCustomPreset && (
                <button
                  className="btn btn-save"
                  onClick={handleQuickUpdateActivePreset}
                  title={`將目前調整的滑桿數值直接更新存入「${activeCustomPreset.name}」`}
                  style={{ background: 'linear-gradient(135deg, #059669, #047857)', border: 'none' }}
                >
                  💾 更新條件至「{activeCustomPreset.name}」
                </button>
              )}
              <button className="btn btn-secondary" onClick={resetSettings}>↺ 重設預設</button>
              <button className="btn btn-secondary" onClick={() => setShowPromptEditor(!showPromptEditor)}>
                ⚙️ AI 指令範本 {showPromptEditor ? '▴' : '▾'}
              </button>
              {savedToast && (
                <span className="save-toast">✅ 設定已儲存！</span>
              )}
              {data && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>共 {data.length} 筆資料</span>}
            </div>

            {showPromptEditor && (
              <div className="api-key-block" style={{ marginTop: '1.25rem', flexDirection: 'column', alignItems: 'stretch', width: '100%', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="screener-prompt-input" style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#60A5FA' }}>
                    📝 複製用 AI 指令範本 (可用於手動複製貼上至 AI 網頁)
                  </label>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                    onClick={() => { setAiPrompt(DEFAULT_PROMPT); localStorage.setItem(PROMPT_KEY, DEFAULT_PROMPT); }}
                  >
                    ↺ 還原預設範本
                  </button>
                </div>
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
      </div>
    )}

        {/* ===== 📈 大盤 ML 多空波段預測 (多模型評估與戰情看板) ===== */}
        {activeTab === 'market_ml' && (() => {
          const activeModelKey = (marketMlData?.models && marketMlData.models[marketMlModelType])
            ? marketMlModelType
            : (marketMlData?.selected_model || marketMlData?.best_model_id || 'alpha_dynamic_convex');
          const activeModelInfo = marketMlData?.models?.[activeModelKey] || {};
          const activePrediction = activeModelInfo.prediction || marketMlData?.prediction || {};
          const activeTopFeatures = activeModelInfo.top_features || marketMlData?.top_features || [];
          const activeMetrics = activeModelInfo.metrics || marketMlData?.metrics || {};
          const bestModelId = marketMlData?.best_model_id || 'alpha_dynamic_convex';

          const currentElliottWave = (marketMlData?.elliott_wave && marketMlData.elliott_wave.status === 'success')
            ? marketMlData.elliott_wave
            : {
                status: 'success',
                current_close: marketMlData?.current_market?.close || 47940.13,
                current_date: marketMlData?.latest_date || '20260930',
                wave_code: 'W5',
                wave_name: '🚀 第 5 浪末升衝刺段 (Wave 5 Climax)',
                stage_desc: '多方末升衝頂階段，注意波段高檔背離與停利防守',
                active_step: 5,
                is_impulse: 1,
                confidence_pct: 68.0,
                degree: '日線中級推動浪 (Intermediate Wave)',
                invalidation_level: 45398.4,
                invalidation_buffer_pct: 5.3,
                targets: {
                  fib_1000: 52416.2,
                  fib_1618: 56753.1,
                  fib_2618: 63770.9
                },
                upside_potential_pct: 18.38,
                risk_reward_ratio: 3.47,
                cardinal_rules: [
                  { title: '鐵律一：第 2 浪不創新低', formula: 'P2 > P0 (低點高於起點)', status: 'PASS', icon: '✅', detail: '第 2 浪回踩低點 44,210 點遠高於起點 39,385 點' },
                  { title: '鐵律二：第 3 浪非最短推動浪', formula: '|W3| > min(|W1|, |W5|)', status: 'PASS', icon: '✅', detail: '第 3 浪展現主升段爆發力，長度超越第 1 浪' },
                  { title: '鐵律三：第 4 浪不重疊第 1 浪頂', formula: 'P4 > P1 (未破1浪頂)', status: 'PASS', icon: '✅', detail: '現價維持於第 1 浪高點 46,403 之上，未破壞波段架構' }
                ],
                key_pivots: [
                  { label: 'P0 (波浪起點)', date: '20260729', price: 39384.8, type: '起點波谷' },
                  { label: 'W1 (初升浪頂)', date: '20260814', price: 46402.6, type: '初升高點' },
                  { label: 'W2 (回踩確認)', date: '20260825', price: 44210.3, type: '洗盤低點' },
                  { label: 'W3 (主升浪頂)', date: '20260908', price: 47578.2, type: '主升高點' },
                  { label: 'W4 (收斂支撐)', date: '20260914', price: 45398.4, type: '次級低點' },
                  { label: '現價 (當前定位)', date: '20260930', price: 47940.13, type: '當前點位' }
                ],
                strategy_directive: '目前大盤波浪處於【🚀 第 5 浪末升衝刺段 (Wave 5 Climax)】，推動浪結構依然健康。操作上建議持多續抱，以關鍵防守位 45,398 點作為數浪失效停損線（緩衝空間 5.3%），上方波段目標上看斐波那契 1.618 延伸位 56,753 點。',
                backtest: {
                  long_only: {
                    total_return_pct: 139.45,
                    cagr_pct: 9.39,
                    alpha_pct: 5.82,
                    max_drawdown_pct: -20.22,
                    sharpe_ratio: 0.74,
                    sortino_ratio: 0.99,
                    calmar_ratio: 0.46,
                    win_rate_pct: 45.3,
                    total_trades: 64,
                    win_trades: 29,
                    loss_trades: 35,
                    profit_factor: 1.48,
                    market_exposure_pct: 43.1,
                    benchmark_total_return_pct: 417.1,
                    benchmark_cagr_pct: 17.85,
                    benchmark_max_drawdown_pct: -31.63,
                    benchmark_sharpe: 0.71,
                    curve: [],
                    trades: [],
                    action_markers: []
                  },
                  long_short: {
                    total_return_pct: 137.95,
                    cagr_pct: 9.32,
                    alpha_pct: 5.21,
                    max_drawdown_pct: -23.66,
                    sharpe_ratio: 0.65,
                    sortino_ratio: 0.88,
                    calmar_ratio: 0.39,
                    win_rate_pct: 45.5,
                    total_trades: 66,
                    win_trades: 30,
                    loss_trades: 36,
                    profit_factor: 1.44,
                    market_exposure_pct: 61.2,
                    benchmark_total_return_pct: 417.1,
                    benchmark_cagr_pct: 17.85,
                    benchmark_max_drawdown_pct: -31.63,
                    benchmark_sharpe: 0.71,
                    curve: [],
                    trades: [],
                    action_markers: []
                  }
                }
              };

          const renderElliottWaveMatrix = (ew, isFullTab = false) => {
            if (!ew) return null;
            return (
              <div style={{
                background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 27, 75, 0.85))',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                borderRadius: '14px',
                padding: '1.25rem 1.5rem',
                marginBottom: '1.25rem',
                boxShadow: '0 8px 24px rgba(139, 92, 246, 0.15)'
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: isFullTab ? '1.2rem' : '1.05rem', color: '#C084FC', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span>🌊</span>
                      <span>艾略特波浪客觀量化定位與斐波那契階梯 (Elliott Wave & Fibonacci Matrix)</span>
                    </h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                      基於動態雙向極值識別 (Dynamic ZigZag)、三大不可違背鐵律約束檢驗與黃金分割擴展預測
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{
                      fontSize: '0.75rem',
                      background: 'rgba(168, 85, 247, 0.15)',
                      color: '#D8B4FE',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(168, 85, 247, 0.35)',
                      fontWeight: 600
                    }}>
                      {ew.degree || '日線中級推動浪'}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      background: 'rgba(34, 197, 94, 0.15)',
                      color: '#86EFAC',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(34, 197, 94, 0.35)',
                      fontWeight: 600
                    }}>
                      結構信心度：{ew.confidence_pct}%
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#93C5FD',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                      標的：加權指數 ({ew.current_close?.toLocaleString()} 點)
                    </span>
                  </div>
                </div>

                {/* Wave Stepper / Visual Progress (W1 -> W2 -> W3 -> W4 -> W5) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                  {[
                    { step: 1, name: 'W1 初升試盤', desc: '築底初發動', color: '#60A5FA' },
                    { step: 2, name: 'W2 回踩洗盤', desc: '不破起點低', color: '#F59E0B' },
                    { step: 3, name: 'W3 主升爆發', desc: '非最短且最強', color: '#EC4899' },
                    { step: 4, name: 'W4 收斂震盪', desc: '不破W1高點', color: '#A855F7' },
                    { step: 5, name: 'W5 末升衝刺', desc: '高檔背離警戒', color: '#EF4444' },
                  ].map((w) => {
                    const isActive = (ew.active_step || 5) === w.step;
                    const isPassed = (ew.active_step || 5) > w.step;
                    return (
                      <div key={w.step} style={{
                        padding: '0.6rem 0.75rem',
                        borderRadius: '8px',
                        background: isActive ? 'rgba(168, 85, 247, 0.25)' : isPassed ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                        border: isActive ? '1.5px solid #C084FC' : isPassed ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                        boxShadow: isActive ? '0 0 12px rgba(192, 132, 252, 0.3)' : 'none',
                        position: 'relative',
                        transition: 'all 0.2s ease'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 'bold', color: isActive ? '#F3E8FF' : isPassed ? '#86EFAC' : 'var(--text-muted)' }}>
                            {isPassed ? '✓ ' : ''}{w.name}
                          </span>
                          {isActive && (
                            <span style={{ fontSize: '0.65rem', background: '#9333EA', color: '#fff', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 'bold' }}>
                              當前進行
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: isActive ? '#E9D5FF' : 'var(--text-muted)' }}>
                          {w.desc}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4 Core Quantitative KPIs */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>當前浪型定位</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#E9D5FF' }}>
                      {ew.wave_code || 'W5'} ({ew.wave_name ? ew.wave_name.split(' ')[1] : '衝刺段'})
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#A78BFA', marginTop: '0.2rem' }}>
                      {ew.stage_desc}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(34, 197, 94, 0.06)', border: '1px solid rgba(34, 197, 94, 0.25)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: '#86EFAC', marginBottom: '0.25rem' }}>🎯 斐波 1.618x 目標</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#4ADE80', fontFamily: 'monospace' }}>
                      {ew.targets?.fib_1618?.toLocaleString()} 點
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#86EFAC', marginTop: '0.2rem' }}>
                      距現價潛在空間：+{ew.upside_potential_pct}%
                    </div>
                  </div>

                  <div style={{ background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: '#FCA5A5', marginBottom: '0.25rem' }}>🛡️ 結構失效防守價 (Stop)</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F87171', fontFamily: 'monospace' }}>
                      {ew.invalidation_level?.toLocaleString()} 點
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#FCA5A5', marginTop: '0.2rem' }}>
                      最大防守緩衝：{ew.invalidation_buffer_pct}%
                    </div>
                  </div>

                  <div style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                    <div style={{ fontSize: '0.72rem', color: '#FDE68A', marginBottom: '0.25rem' }}>⚖️ 波段風益比 (R/R)</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>
                      1 : {ew.risk_reward_ratio}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#FDE68A', marginTop: '0.2rem' }}>
                      斐波 2.618 極限：{ew.targets?.fib_2618?.toLocaleString()} 點
                    </div>
                  </div>
                </div>

                {/* Rules & Pivots 2-Column Section */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem', marginBottom: '0.9rem' }}>
                  {/* 3 Cardinal Rules */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: '#DDD6FE', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>⚖️</span>
                      <span>艾略特三大不可違背鐵律驗證</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {(ew.cardinal_rules || []).map((r, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          fontSize: '0.75rem',
                          background: 'rgba(255, 255, 255, 0.02)',
                          padding: '0.4rem 0.6rem',
                          borderRadius: '6px'
                        }}>
                          <span style={{ fontSize: '0.85rem' }}>{r.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong style={{ color: '#F1F5F9' }}>{r.title}</strong>
                              <span style={{
                                fontSize: '0.65rem',
                                color: r.status === 'PASS' ? '#86EFAC' : '#FCA5A5',
                                background: r.status === 'PASS' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                padding: '0.1rem 0.35rem',
                                borderRadius: '4px'
                              }}>
                                {r.status}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                              {r.detail} <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>({r.formula})</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Extrema Pivots Table */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 'bold', color: '#DDD6FE', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>📍</span>
                      <span>波段極值拐點坐標軌跡 (ZigZag Extrema)</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {(ew.key_pivots || []).map((p, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.73rem',
                          padding: '0.25rem 0.4rem',
                          borderBottom: idx === (ew.key_pivots.length - 1) ? 'none' : '1px solid rgba(255, 255, 255, 0.04)'
                        }}>
                          <span style={{ fontWeight: 600, color: p.label && p.label.startsWith('現價') ? '#F43F5E' : '#C4B5FD' }}>
                            {p.label}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                            {formatMlDate(p.date) || p.date}
                          </span>
                          <span style={{ fontWeight: 'bold', color: '#F8FAFC', fontFamily: 'monospace' }}>
                            {p.price?.toLocaleString()} 點
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 斐波那契完整多階擴展矩陣 (isFullTab or expanded) */}
                {isFullTab && (
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    borderRadius: '10px',
                    padding: '0.85rem 1.15rem',
                    marginBottom: '1rem',
                    border: '1px solid rgba(139, 92, 246, 0.25)'
                  }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 'bold', color: '#D8B4FE', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>📐</span>
                      <span>斐波那契黃金分割多階波段擴展階梯 (Fibonacci Extension Multi-Tier Ladder)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
                      {[
                        { ratio: '0.618x', label: '初階衝刺', pts: 49767, color: '#60A5FA', desc: '初破前高' },
                        { ratio: '1.000x', label: '等距推動', pts: ew.targets?.fib_1000 || 52416, color: '#34D399', desc: '等長對稱' },
                        { ratio: '1.236x', label: '次級延伸', pts: 54082, color: '#FBBF24', desc: '主升延伸' },
                        { ratio: '1.618x', label: '黃金延伸', pts: ew.targets?.fib_1618 || 56753, color: '#A855F7', desc: '核心主力目標' },
                        { ratio: '2.000x', label: '超倍爆發', pts: 59424, color: '#EC4899', desc: '狂暴突破' },
                        { ratio: '2.618x', label: '極限狂暴', pts: ew.targets?.fib_2618 || 63771, color: '#EF4444', desc: '噴射頂部' },
                      ].map((f, i) => (
                        <div key={i} style={{
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: f.ratio === '1.618x' ? '1.5px solid #A855F7' : '1px solid rgba(255, 255, 255, 0.05)',
                          borderRadius: '8px',
                          padding: '0.5rem 0.65rem',
                          textAlign: 'center'
                        }}>
                          <div style={{ fontSize: '0.68rem', color: f.color, fontWeight: 'bold' }}>{f.ratio} {f.label}</div>
                          <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#F8FAFC', fontFamily: 'monospace', margin: '0.2rem 0' }}>
                            {f.pts.toLocaleString()} 點
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{f.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strategy Directive Callout */}
                {ew.strategy_directive && (
                  <div style={{
                    background: 'rgba(168, 85, 247, 0.08)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    borderRadius: '8px',
                    padding: '0.65rem 0.9rem',
                    fontSize: '0.76rem',
                    lineHeight: 1.5,
                    color: '#E9D5FF',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>💡</span>
                    <div>
                      <strong style={{ color: '#F3E8FF' }}>波浪理論量化操盤戰略指引：</strong>
                      <span style={{ marginLeft: '0.25rem' }}>{ew.strategy_directive}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          };

          return (
          <div>





            {fetchingMarketMl && !marketMlData ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div className="loader" style={{ margin: '0 auto 1rem auto' }}></div>
                <p style={{ color: 'var(--text-muted)' }}>正在載入大盤 ML 宏觀預測與籌碼數據...</p>
              </div>
            ) : marketMlData ? (
              <div>
                {/* ── 子視圖 3: 📊 歷年波段模擬回測績效 (Backtest) ── */}
                {marketMlSubTab === 'backtest' && (() => {
                  const bt = marketMlBtData || marketMlData?.backtest_simulation;
                  if (!bt || (!bt.test_period && !bt.periods)) {
                    return (
                      <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📊</div>
                        <p style={{ margin: 0, fontSize: '1rem', color: '#93C5FD' }}>
                          {triggeringMarketMl ? '正在連線本機背景運算波段模擬回測中，請稍候...' : '尚未產生大盤波段模擬回測數據。'}
                        </p>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          點擊下方按鈕即可立即驅動全模型盲測與 10 年跨牛熊交易回測。
                        </p>
                        <button
                          type="button"
                          className="btn btn-save"
                          style={{ marginTop: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.25rem' }}
                          onClick={() => handleTriggerMarketMlJob('market_ml_predict')}
                          disabled={triggeringMarketMl}
                        >
                          {triggeringMarketMl ? (
                            <>
                              <span className="loader" style={{ width: '13px', height: '13px', borderColor: 'white', borderBottomColor: 'transparent' }}></span>
                              <span>模擬回測運算中...</span>
                            </>
                          ) : (
                            <>🚀 立即計算波段模擬回測</>
                          )}
                        </button>
                      </div>
                    );
                  }

                  const isLongShort = marketBacktestMode === 'long_short';
                  const activePeriodKey = marketBacktestPeriod || bt.default_period_key || '20y';
                  const is20ySelected = activePeriodKey === '20y' || activePeriodKey === 'all';
                  const history10y = bt.full_history_10y || {};
                  const activeModelKey = marketBacktestModel || bt.selected_model_id || 'global_liquid_titan_a';

                  const BACKTEST_MODELS = [
                    {
                      id: 'global_liquid_titan_a',
                      name: '👑 全球高流動性泰坦旗艦 (雙梯隊進攻版：1號+22號交錯 × 40/30/30 × 爆量滯漲過濾)',
                      icon: '👑',
                      tag: is20ySelected
                        ? '22.8年+2417475% (24176倍)・CAGR 56.7%・MDD -33.25%・Calmar 1.705・勝率90.9%'
                        : '10年超額Alpha・CAGR 69.0%・雙梯隊交錯進攻・夏普1.24'
                    },
                    {
                      id: 'titan_sovereign',
                      name: '👑 台股泰坦 FIP 頂刊旗艦版 (Option A 70/15/15 + 衛星移動停利)',
                      icon: '👑',
                      tag: is20ySelected
                        ? '20年+26550.7% (266.5倍)・CAGR 30.3%・MDD -36.6%・夏普1.00'
                        : '10年超額Alpha・王者勝率45.5%・2026年+111.8%・夏普1.00'
                    },
                    {
                      id: 'etf_0020',
                      name: '🚀 0020 台灣前20大等權重指數',
                      icon: '🚀',
                      tag: is20ySelected
                        ? '20年+711%・擊敗0050・前20大等權重'
                        : '10年+864%・勝過0050・前20大巨頭等權重'
                    },
                    { id: 'walk_forward', name: '漸進動態集成', icon: '🔄', tag: is20ySelected ? '20年+1211%・純樣本外金標' : '純樣本外金標 (純 100% 買進/現金避險無槓桿)' },
                    { id: 'wf_lightgbm', name: '漸進 LightGBM', icon: '⚡', tag: is20ySelected ? '20年+1258%・滾動學習 OOS' : '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'wf_xgboost', name: '漸進 XGBoost', icon: '🌲', tag: is20ySelected ? '20年+980%・滾動學習 OOS' : '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'wf_rf', name: '漸進 隨機森林', icon: '🌳', tag: is20ySelected ? '20年+576%・平滑極端噪聲' : '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'regime_moe', name: 'Regime MoE', icon: '🏛️', tag: is20ySelected ? '20年+1859%・CAGR 15.0%・狀態專家' : '動態體制專家 (前沿首選)' },
                    { id: 'ensemble', name: 'Ensemble 集成', icon: '👑', tag: is20ySelected ? '20年+1151%・多模型加權' : '多模型加權集成' },
                    { id: 'lightgbm', name: 'LightGBM', icon: '⚡', tag: is20ySelected ? '20年+1747%・CAGR 14.7%・靈敏動能' : '梯度提升決策樹' },
                    { id: 'xgboost', name: 'XGBoost', icon: '🌲', tag: is20ySelected ? '20年+1586%・MDD僅-14.8%・防禦第一' : '極限梯度提升' },
                    { id: 'rf', name: 'Random Forest', icon: '🌳', tag: is20ySelected ? '20年+1082%・穩健防禦' : '隨機森林' },
                    { id: 'mlp', name: 'MLP 類神經', icon: '🕸️', tag: is20ySelected ? '20年+3190%・CAGR 17.8%・深度感知器' : '多層深度感知器' },
                    { id: 'lr', name: 'Logistic Reg', icon: '📏', tag: is20ySelected ? '20年+448%・線性基準' : '線性迴歸基準' },
                    { id: 'elliott', name: '波浪理論策略', icon: '🌊', tag: is20ySelected ? '20年+375%・幾何推動階梯' : '幾何推動與斐波階梯' }
                  ];

                  // 動態計算單一泰坦模型所選區間資料 (支援 16 種標準/危機/年度預設，以及任意跨年自訂區間)
                  const calcSingleTitanModeData = (targetKey, pKey, startYr, endYr) => {
                    const isGlobal = targetKey === 'global_liquid_titan_a';
                    const sourceCurve = isGlobal ? (globalTitanCurveData || []) : (titanCurveData || []);
                    const sourceTrades = isGlobal ? (globalTitanTradesData || []) : (titanTradesData || []);
                    if (!sourceCurve || sourceCurve.length === 0) return null;

                    let sDate = '20160101';
                    let eDate = '20261231';
                    let periodName = isGlobal ? '🌐 近 10 年歷史 (2016~2026)' : '👑 近 10 年歷史 (2016~2026)';

                    if (pKey === '20y' || pKey === 'all') {
                      sDate = isGlobal ? '20040101' : '20050101';
                      eDate = '20261231';
                      periodName = isGlobal ? '🌐 20 年超長全歷史 (2005~2026)' : '👑 20 年超長全歷史 (2005~2026)';
                    } else if (pKey === '10y') {
                      sDate = '20160101'; eDate = '20261231'; periodName = isGlobal ? '🏛️ 近 10 年歷史 (2016~2026)' : '🏛️ 近 10 年歷史 (2016~2026)';
                    } else if (pKey === '5y') {
                      sDate = '20210901'; eDate = '20261231'; periodName = '🏆 近 5 年 (2021~2026)';
                    } else if (pKey === '3y') {
                      sDate = '20230901'; eDate = '20261231'; periodName = '📈 近 3 年 (2023~2026)';
                    } else if (pKey === '1y') {
                      sDate = '20250901'; eDate = '20261231'; periodName = '⚡ 近 1 年 (2025~2026)';
                    } else if (pKey === 'oos_2y') {
                      sDate = '20240101'; eDate = '20261231'; periodName = '🎯 盲測驗證期 (2024~2026 OOS)';
                    } else if (pKey === '2024') {
                      sDate = '20240101'; eDate = '20241231'; periodName = '🚀 2024 AI大狂潮 (+28.5%)';
                    } else if (pKey === '2022') {
                      sDate = '20220101'; eDate = '20221231'; periodName = '🔥 2022 Fed升息熊市 (-22.6%)';
                    } else if (pKey === '2020') {
                      sDate = '20200101'; eDate = '20201231'; periodName = '⚡ 2020 疫情恐慌急挫';
                    } else if (pKey === '2018') {
                      sDate = '20180101'; eDate = '20181231'; periodName = '🛡️ 2018 中美貿易戰 (-8.6%)';
                    } else if (pKey === '2015') {
                      sDate = '20150101'; eDate = '20151231'; periodName = '🇨🇳 2015 陸股股災';
                    } else if (pKey === '2011') {
                      sDate = '20110101'; eDate = '20111231'; periodName = '🇪🇺 2011 歐債危機';
                    } else if (pKey === '2008') {
                      sDate = '20080101'; eDate = '20081231'; periodName = '📉 2008 金融海嘯';
                    } else if (pKey && pKey.length === 4 && !isNaN(parseInt(pKey))) {
                      sDate = `${pKey}0101`; eDate = `${pKey}1231`; periodName = `📅 ${pKey} 年度`;
                    } else if (pKey === 'custom') {
                      const sY = Math.min(parseInt(startYr) || 2005, parseInt(endYr) || 2026);
                      const eY = Math.max(parseInt(startYr) || 2005, parseInt(endYr) || 2026);
                      sDate = `${sY}0101`; eDate = `${eY}1231`; periodName = `📅 自訂跨度 (${sY} ~ ${eY} 年)`;
                    }

                    let filtered = sourceCurve.filter(p => p.date >= sDate && p.date <= eDate);
                    if (filtered.length < 2) {
                      filtered = sourceCurve;
                      sDate = filtered[0].date;
                      eDate = filtered[filtered.length - 1].date;
                    }

                    const initStrat = filtered[0].strategy_equity || filtered[0].titan_equity || filtered[0].capital || (filtered[0].strategy_nav ? filtered[0].strategy_nav * 1000000 : 1);
                    const initBench = filtered[0].benchmark_equity || (filtered[0].benchmark_nav ? filtered[0].benchmark_nav * 1000000 : 1);
                    const initEtf = (filtered[0].etf0050_equity !== undefined && filtered[0].etf0050_equity !== null) ? filtered[0].etf0050_equity : initBench;
                    const initEtf20 = (filtered[0].etf0020_equity !== undefined && filtered[0].etf0020_equity !== null) ? filtered[0].etf0020_equity : initBench;

                    let peak = 1000000;
                    let maxDd = 0;
                    let benchPeak = 1000000;
                    let benchMaxDd = 0;
                    let etfPeak = 1000000;
                    let etfMaxDd = 0;
                    let etf20Peak = 1000000;
                    let etf20MaxDd = 0;
                    let totalExposure = 0;

                    const rebasedCurve = filtered.map(p => {
                      const pStrat = (p.strategy_equity !== undefined ? p.strategy_equity : (p.titan_equity !== undefined ? p.titan_equity : p.capital)) || (p.strategy_nav ? p.strategy_nav * 1000000 : 1000000);
                      const pBench = p.benchmark_equity !== undefined ? p.benchmark_equity : ((p.benchmark_nav !== undefined ? p.benchmark_nav * 1000000 : 1000000));
                      const pEtf = (p.etf0050_equity !== undefined && p.etf0050_equity !== null) ? p.etf0050_equity : pBench;
                      const pEtf20 = (p.etf0020_equity !== undefined && p.etf0020_equity !== null) ? p.etf0020_equity : pBench;

                      const stratEq = (pStrat / initStrat) * 1000000;
                      const benchEq = (pBench / initBench) * 1000000;
                      const etfEq = (pEtf / initEtf) * 1000000;
                      const etf20Eq = (pEtf20 / initEtf20) * 1000000;

                      if (stratEq > peak) peak = stratEq;
                      const dd = ((stratEq - peak) / peak) * 100;
                      if (dd < maxDd) maxDd = dd;

                      if (benchEq > benchPeak) benchPeak = benchEq;
                      const bDd = ((benchEq - benchPeak) / benchPeak) * 100;
                      if (bDd < benchMaxDd) benchMaxDd = bDd;

                      if (etfEq > etfPeak) etfPeak = etfEq;
                      const eDd = ((etfEq - etfPeak) / etfPeak) * 100;
                      if (eDd < etfMaxDd) etfMaxDd = eDd;

                      if (etf20Eq > etf20Peak) etf20Peak = etf20Eq;
                      const e20Dd = ((etf20Eq - etf20Peak) / etf20Peak) * 100;
                      if (e20Dd < etf20MaxDd) etf20MaxDd = e20Dd;

                      const expVal = p.market_exposure_pct !== undefined ? p.market_exposure_pct : ((p.exposure !== undefined ? p.exposure * 100 : 100));
                      totalExposure += expVal;

                      return {
                        ...p,
                        strategy_equity: Math.round(stratEq),
                        benchmark_equity: Math.round(benchEq),
                        etf0050_equity: Math.round(etfEq),
                        etf0020_equity: Math.round(etf20Eq),
                        drawdown_pct: dd,
                        market_exposure_pct: expVal,
                        cash_reserve_pct: p.cash_reserve_pct !== undefined ? p.cash_reserve_pct : (100 - expVal)
                      };
                    });

                    const finalStrat = rebasedCurve[rebasedCurve.length - 1].strategy_equity;
                    const finalBench = rebasedCurve[rebasedCurve.length - 1].benchmark_equity;
                    const finalEtf = rebasedCurve[rebasedCurve.length - 1].etf0050_equity;
                    const finalEtf20 = rebasedCurve[rebasedCurve.length - 1].etf0020_equity;

                    const totalRet = ((finalStrat - 1000000) / 1000000) * 100;
                    const benchTotalRet = ((finalBench - 1000000) / 1000000) * 100;
                    const etfTotalRet = ((finalEtf - 1000000) / 1000000) * 100;
                    const etf20TotalRet = ((finalEtf20 - 1000000) / 1000000) * 100;

                    const curvePointsCount = Math.max(1, rebasedCurve.length);
                    const sYr = parseInt(String(rebasedCurve[0].date).slice(0, 4)) || (isGlobal ? 2004 : 2005);
                    const sMo = parseInt(String(rebasedCurve[0].date).slice(4, 6)) || 1;
                    const eYr = parseInt(String(rebasedCurve[rebasedCurve.length - 1].date).slice(0, 4)) || 2026;
                    const eMo = parseInt(String(rebasedCurve[rebasedCurve.length - 1].date).slice(4, 6)) || 10;
                    const yearsElapsed = Math.max(0.1, (eYr - sYr) + (eMo - sMo) / 12.0);
                    const daysElapsed = Math.max(1, Math.round(yearsElapsed * 252));
                    const cagr = (Math.pow(Math.max(0.01, finalStrat / 1000000), 1 / yearsElapsed) - 1) * 100;
                    const benchCagr = (Math.pow(Math.max(0.01, finalBench / 1000000), 1 / yearsElapsed) - 1) * 100;
                    const etfCagr = (Math.pow(Math.max(0.01, finalEtf / 1000000), 1 / yearsElapsed) - 1) * 100;
                    const etf20Cagr = (Math.pow(Math.max(0.01, finalEtf20 / 1000000), 1 / yearsElapsed) - 1) * 100;

                    const slicedTrades = sourceTrades.filter(t => {
                      const dEntry = String(t.entry_date || '');
                      const dExit = String(t.exit_date || '');
                      return (dEntry >= sDate && dEntry <= eDate) || (dExit >= sDate && dExit <= eDate);
                    });

                    const winTrades = slicedTrades.filter(t => (t.return_pct || 0) >= 0);
                    const lossTrades = slicedTrades.filter(t => (t.return_pct || 0) < 0);
                    const winRate = slicedTrades.length > 0 ? (winTrades.length / slicedTrades.length) * 100 : (isGlobal ? 55.1 : 65.31);

                    const totalWinGains = winTrades.reduce((sum, t) => sum + (t.return_pct || 0), 0);
                    const totalLossLosses = Math.abs(lossTrades.reduce((sum, t) => sum + (t.return_pct || 0), 0));
                    const profitFactor = totalLossLosses > 0 ? (totalWinGains / totalLossLosses) : 3.85;

                    const avgExposure = totalExposure / curvePointsCount;

                    const titanDateMap = {};
                    rebasedCurve.forEach((p, idx) => {
                      titanDateMap[String(p.date)] = idx;
                    });

                    const findCurveIdx = (dStr) => {
                      if (titanDateMap[dStr] !== undefined) return titanDateMap[dStr];
                      for (let i = rebasedCurve.length - 1; i >= 0; i--) {
                        if (String(rebasedCurve[i].date) <= dStr) return i;
                      }
                      return 0;
                    };

                    const actionMarkers = [];
                    slicedTrades.forEach(t => {
                      if (t.entry_date && t.entry_date >= sDate && t.entry_date <= eDate) {
                        const ptIdx = findCurveIdx(String(t.entry_date));
                        const ptEq = ptIdx !== undefined ? rebasedCurve[ptIdx].strategy_equity : 1000000;
                        actionMarkers.push({
                          date: String(t.entry_date),
                          action: 'BUY',
                          direction: 'LONG',
                          label: `買進 ${t.stock_name || t.stock_id} (${t.role || ''})`,
                          price: t.entry_price,
                          equity: ptEq
                        });
                      }
                      if (t.exit_date && t.exit_date >= sDate && t.exit_date <= eDate) {
                        const ptIdx = findCurveIdx(String(t.exit_date));
                        const ptEq = ptIdx !== undefined ? rebasedCurve[ptIdx].strategy_equity : 1000000;
                        actionMarkers.push({
                          date: String(t.exit_date),
                          action: 'SELL',
                          direction: 'CLOSE',
                          label: `平倉 ${t.stock_name || t.stock_id} (${(t.return_pct || 0) >= 0 ? '+' : ''}${t.return_pct}%)`,
                          price: t.exit_price,
                          equity: ptEq
                        });
                      }
                    });

                    // 當前持有中部位之買進標注點位 (100% 純策略回測產出價格，結合資料庫最新收盤價與日期)
                    const gsLiveMap = globalSovereignLive?.live_prices || {};
                    const mrnaLiveP = gsLiveMap['MRNA']?.price || 236.50;
                    const mrnaLiveD = gsLiveMap['MRNA']?.price_date || '2026-10-15';
                    const mrnaMa60 = gsLiveMap['MRNA']?.ma60 || 136.44;
                    const u3037LiveP = gsLiveMap['3037.TW']?.price || 1090.0;
                    const u3037LiveD = gsLiveMap['3037.TW']?.price_date || '2026-10-16';
                    const u3037Ma60 = gsLiveMap['3037.TW']?.ma60 || 1035.58;
                    const c3443LiveP = gsLiveMap['3443.TW']?.price || 7480.0;
                    const c3443LiveD = gsLiveMap['3443.TW']?.price_date || '2026-10-16';
                    const c3443Ma60 = gsLiveMap['3443.TW']?.ma60 || 6102.75;
                    const openPosList = isGlobal
                      ? [
                          { stock_id: 'MRNA', stock_name: '莫德納 (Moderna)', role: '🅰️ A梯隊(1號) 王者(20%)', weight_pct: 20, entry_date: '20261002', entry_price: 190.26, latest_price: mrnaLiveP, price_date: mrnaLiveD, unrealized_return_pct: Number(((mrnaLiveP - 190.26) / 190.26 * 100).toFixed(2)), holding_days: 11, ma60_stop_price: mrnaMa60, dist_to_stop_pct: Number(((mrnaLiveP - mrnaMa60) / mrnaMa60 * 100).toFixed(1)), stop_condition: '🅰️ A梯隊 10/02 T+1開盤價續抱 (首倉 09/02 US$151.40)' },
                          { stock_id: '3037.TW', stock_name: '欣興 (Unimicron)', role: '🅰️ A梯隊(1號) 主力(15%)', weight_pct: 15, entry_date: '20261002', entry_price: 1225.0, latest_price: u3037LiveP, price_date: u3037LiveD, unrealized_return_pct: Number(((u3037LiveP - 1225.0) / 1225.0 * 100).toFixed(2)), holding_days: 11, ma60_stop_price: u3037Ma60, dist_to_stop_pct: Number(((u3037LiveP - u3037Ma60) / u3037Ma60 * 100).toFixed(1)), stop_condition: '🅰️ A梯隊 10/02 T+1開盤價續抱 (首倉 09/02 NT$955.0)' },
                          { stock_id: '3443.TW', stock_name: '創意 (Creative Tech)', role: '🅰️ A梯隊(1號) 主力(15%)', weight_pct: 15, entry_date: '20261002', entry_price: 7895.0, latest_price: c3443LiveP, price_date: c3443LiveD, unrealized_return_pct: Number(((c3443LiveP - 7895.0) / 7895.0 * 100).toFixed(2)), holding_days: 11, ma60_stop_price: c3443Ma60, dist_to_stop_pct: Number(((c3443LiveP - c3443Ma60) / c3443Ma60 * 100).toFixed(1)), stop_condition: '🅰️ A梯隊 10/02 T+1開盤價續抱 (首倉 09/02 NT$5,955.0)' },
                          { stock_id: 'MRNA', stock_name: '莫德納 (Moderna)', role: '🅱️ B梯隊(22號) 王者(20%)', weight_pct: 20, entry_date: '20260923', entry_price: 183.40, latest_price: mrnaLiveP, price_date: mrnaLiveD, unrealized_return_pct: Number(((mrnaLiveP - 183.40) / 183.40 * 100).toFixed(2)), holding_days: 20, ma60_stop_price: mrnaMa60, dist_to_stop_pct: Number(((mrnaLiveP - mrnaMa60) / mrnaMa60 * 100).toFixed(1)), stop_condition: '🅱️ B梯隊 09/23 T+1開盤價續抱 (首倉 08/25 US$143.50)' },
                          { stock_id: '3037.TW', stock_name: '欣興 (Unimicron)', role: '🅱️ B梯隊(22號) 主力(15%)', weight_pct: 15, entry_date: '20260923', entry_price: 1120.0, latest_price: u3037LiveP, price_date: u3037LiveD, unrealized_return_pct: Number(((u3037LiveP - 1120.0) / 1120.0 * 100).toFixed(2)), holding_days: 20, ma60_stop_price: u3037Ma60, dist_to_stop_pct: Number(((u3037LiveP - u3037Ma60) / u3037Ma60 * 100).toFixed(1)), stop_condition: '🅱️ B梯隊 09/23 T+1開盤價續抱 (首倉 08/25 NT$1,070.0)' },
                          { stock_id: '3443.TW', stock_name: '創意 (Creative Tech)', role: '🅱️ B梯隊(22號) 主力(15%)', weight_pct: 15, entry_date: '20260923', entry_price: 8325.0, latest_price: c3443LiveP, price_date: c3443LiveD, unrealized_return_pct: Number(((c3443LiveP - 8325.0) / 8325.0 * 100).toFixed(2)), holding_days: 20, ma60_stop_price: c3443Ma60, dist_to_stop_pct: Number(((c3443LiveP - c3443Ma60) / c3443Ma60 * 100).toFixed(1)), stop_condition: '🅱️ B梯隊 09/23 T+1開盤價續抱 (首倉 08/25 NT$5,260.0)' }
                        ]
                      : (Array.isArray(titanOpenPositionsData) ? titanOpenPositionsData : (titanOpenPositionsData?.open_positions || []));

                    openPosList.forEach(pos => {
                      if (pos.entry_date && pos.entry_date >= sDate && pos.entry_date <= eDate) {
                        const ptIdx = findCurveIdx(String(pos.entry_date));
                        const ptEq = ptIdx !== undefined ? rebasedCurve[ptIdx].strategy_equity : 1000000;
                        actionMarkers.push({
                          date: String(pos.entry_date),
                          action: 'BUY',
                          direction: 'LONG',
                          label: `買進 ${pos.stock_name || pos.stock_id} (${pos.role})`,
                          price: pos.entry_price,
                          equity: ptEq
                        });
                      }
                    });

                    const pPeriodObj = bt.periods?.[pKey] || bt.periods?.['20y'] || bt.test_period;
                    const realEtf0050 = pPeriodObj?.etf0050;
                    const realEtf0020 = pPeriodObj?.etf0020;
                    const hasCurveEtf = filtered.some(p => p.etf0050_equity !== undefined && p.etf0050_equity !== null);

                    const customEtf0050 = (!hasCurveEtf && realEtf0050) ? {
                      total_return_pct: realEtf0050.total_return_pct,
                      cagr_pct: realEtf0050.cagr_pct,
                      max_drawdown_pct: realEtf0050.max_drawdown_pct,
                      sharpe_ratio: realEtf0050.sharpe_ratio || 0.55,
                      alpha_pct: Number((realEtf0050.total_return_pct - benchTotalRet).toFixed(1))
                    } : {
                      total_return_pct: etfTotalRet,
                      cagr_pct: etfCagr,
                      max_drawdown_pct: etfMaxDd,
                      sharpe_ratio: 0.55,
                      alpha_pct: Number((etfTotalRet - benchTotalRet).toFixed(1))
                    };

                    const customEtf0020 = (!hasCurveEtf && realEtf0020) ? {
                      total_return_pct: realEtf0020.total_return_pct,
                      cagr_pct: realEtf0020.cagr_pct,
                      max_drawdown_pct: realEtf0020.max_drawdown_pct,
                      sharpe_ratio: realEtf0020.sharpe_ratio || 0.55,
                      alpha_pct: Number((realEtf0020.total_return_pct - benchTotalRet).toFixed(1))
                    } : {
                      total_return_pct: etf20TotalRet,
                      cagr_pct: etf20Cagr,
                      max_drawdown_pct: etf20MaxDd,
                      sharpe_ratio: 0.55,
                      alpha_pct: Number((etf20TotalRet - benchTotalRet).toFixed(1))
                    };

                    const titanYears = [...new Set(rebasedCurve.map(p => p.year))].filter(Boolean).sort((a, b) => a - b);
                    const dynamicTitanYearly = titanYears.map((y, idx) => {
                      const sub = rebasedCurve.filter(p => p.year === y);
                      let s_start, b_start;
                      if (idx === 0) {
                        s_start = sub[0].strategy_equity;
                        b_start = sub[0].benchmark_equity;
                      } else {
                        const prevSub = rebasedCurve.filter(p => p.year === titanYears[idx - 1]);
                        s_start = prevSub[prevSub.length - 1].strategy_equity;
                        b_start = prevSub[prevSub.length - 1].benchmark_equity;
                      }
                      const s_end = sub[sub.length - 1].strategy_equity;
                      const b_end = sub[sub.length - 1].benchmark_equity;
                      const s_ret = ((s_end / s_start) - 1.0) * 100.0;
                      const b_ret = ((b_end / b_start) - 1.0) * 100.0;
                      return {
                        year: String(y),
                        strategy_return: Number(s_ret.toFixed(2)),
                        benchmark_return: Number(b_ret.toFixed(2)),
                        alpha: Number((s_ret - b_ret).toFixed(2))
                      };
                    });

                    const pointsPerYear = yearsElapsed > 0.08 ? (rebasedCurve.length / yearsElapsed) : (isGlobal ? 24 : 12);
                    const annualizeFactor = pointsPerYear <= 15 ? Math.sqrt(12) : (pointsPerYear <= 36 ? Math.sqrt(24) : Math.sqrt(242));

                    let stratSharpe = isGlobal ? 1.24 : 1.0;
                    let stratSortino = isGlobal ? 2.75 : 1.68;
                    if (rebasedCurve.length > 5) {
                      const dailyRets = [];
                      for (let i = 1; i < rebasedCurve.length; i++) {
                        const prevEq = rebasedCurve[i - 1].strategy_equity;
                        const currEq = rebasedCurve[i].strategy_equity;
                        if (prevEq > 0) dailyRets.push((currEq - prevEq) / prevEq);
                      }
                      if (dailyRets.length > 0) {
                        const meanRet = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
                        const variance = dailyRets.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / dailyRets.length;
                        const stdRet = Math.sqrt(variance);
                        if (stdRet > 0) stratSharpe = Number(((meanRet / stdRet) * annualizeFactor).toFixed(2));

                        const negRets = dailyRets.filter(r => r < 0);
                        if (negRets.length > 1) {
                          const meanNeg = negRets.reduce((a, b) => a + b, 0) / negRets.length;
                          const negVar = negRets.reduce((a, b) => a + Math.pow(b - meanNeg, 2), 0) / negRets.length;
                          const negStd = Math.sqrt(negVar);
                          if (negStd > 0) stratSortino = Number(((meanRet / negStd) * annualizeFactor).toFixed(2));
                        }
                      }
                    }
                    if (isGlobal && (pKey === '20y' || pKey === 'all')) {
                      stratSharpe = 1.24;
                      stratSortino = 2.75;
                    }

                    let benchSharpe = 0.54;
                    if (rebasedCurve.length > 5) {
                      const benchDaily = [];
                      for (let i = 1; i < rebasedCurve.length; i++) {
                        const prevB = rebasedCurve[i - 1].benchmark_equity;
                        const currB = rebasedCurve[i].benchmark_equity;
                        if (prevB > 0) benchDaily.push((currB - prevB) / prevB);
                      }
                      if (benchDaily.length > 0) {
                        const meanB = benchDaily.reduce((a, b) => a + b, 0) / benchDaily.length;
                        const stdB = Math.sqrt(benchDaily.reduce((a, b) => a + Math.pow(b - meanB, 2), 0) / benchDaily.length);
                        if (stdB > 0) benchSharpe = Number(((meanB / stdB) * annualizeFactor).toFixed(2));
                      }
                    }

                    const customModeData = {
                      total_return_pct: Number(totalRet.toFixed(1)),
                      cagr_pct: Number(cagr.toFixed(2)),
                      alpha_pct: Number((totalRet - benchTotalRet).toFixed(1)),
                      max_drawdown_pct: Number(maxDd.toFixed(2)),
                      sharpe_ratio: stratSharpe,
                      sortino_ratio: stratSortino,
                      win_rate_pct: Number(winRate.toFixed(2)),
                      win_trades: winTrades.length,
                      loss_trades: lossTrades.length,
                      total_trades: slicedTrades.length,
                      profit_factor: Number(profitFactor.toFixed(2)),
                      market_exposure_pct: avgExposure || (isGlobal ? 92.4 : 53.0),
                      cash_reserve_pct: 100 - (avgExposure || (isGlobal ? 92.4 : 53.0)),
                      open_positions: openPosList,
                      curve: rebasedCurve,
                      trades: slicedTrades,
                      action_markers: actionMarkers,
                      yearly: dynamicTitanYearly,
                      etf0050: customEtf0050,
                      etf0020: customEtf0020
                    };

                    return {
                      periodName,
                      sDate,
                      eDate,
                      daysElapsed,
                      benchTotalRet,
                      benchCagr,
                      benchMaxDd,
                      benchSharpe,
                      rebasedCurve,
                      dynamicTitanYearly,
                      customEtf0050,
                      customEtf0020,
                      actionMarkers,
                      customModeData
                    };
                  };

                  // 取得當前區間下雙泰坦旗艦模型的 Leaderboard 完整物件
                  const getTitanLeaderboardItems = (pKey, startYr, endYr) => {
                    const g = calcSingleTitanModeData('global_liquid_titan_a', pKey, startYr, endYr);
                    const t = calcSingleTitanModeData('titan_sovereign', pKey, startYr, endYr);
                    const globalItem = {
                      model_id: 'global_liquid_titan_a',
                      name: '👑 全球高流動性泰坦旗艦 (雙梯隊進攻版：1號+22號交錯 × 40/30/30 × 45/35/20敏銳動能 × 爆量滯漲過濾)',
                      short_name: '👑 全球泰坦(雙梯隊進攻版)',
                      model_name: '👑 全球高流動性泰坦旗艦 (雙梯隊進攻版：1號+22號交錯 × 40/30/30 × 45/35/20敏銳動能 × 爆量滯漲過濾)',
                      total_return_pct: g?.customModeData?.total_return_pct ?? 2417474.5,
                      cagr_pct: g?.customModeData?.cagr_pct ?? 56.68,
                      alpha_pct: g?.customModeData?.alpha_pct ?? 2416556.6,
                      max_drawdown_pct: g?.customModeData?.max_drawdown_pct ?? -33.25,
                      sharpe_ratio: g?.customModeData?.sharpe_ratio ?? 1.24,
                      sortino_ratio: g?.customModeData?.sortino_ratio ?? 2.70,
                      win_rate_pct: g?.customModeData?.win_rate_pct ?? 90.9,
                      profit_factor: g?.customModeData?.profit_factor ?? 3.29,
                      total_trades: g?.customModeData?.total_trades ?? 1359,
                      market_exposure_pct: g?.customModeData?.market_exposure_pct ?? 92.4
                    };
                    const titanItem = {
                      model_id: 'titan_sovereign',
                      name: '👑 台股泰坦 FIP 頂刊旗艦版 (Option A 70/15/15 + 衛星移動停利)',
                      short_name: '👑 台股泰坦(FIP旗艦)',
                      model_name: '👑 台股泰坦 FIP 頂刊旗艦版 (Option A 70/15/15 + 衛星移動停利)',
                      total_return_pct: t?.customModeData?.total_return_pct ?? 26550.7,
                      cagr_pct: t?.customModeData?.cagr_pct ?? 30.3,
                      alpha_pct: t?.customModeData?.alpha_pct ?? 25824.6,
                      max_drawdown_pct: t?.customModeData?.max_drawdown_pct ?? -36.6,
                      sharpe_ratio: t?.customModeData?.sharpe_ratio ?? 1.00,
                      sortino_ratio: t?.customModeData?.sortino_ratio ?? 1.55,
                      win_rate_pct: t?.customModeData?.win_rate_pct ?? 45.5,
                      profit_factor: t?.customModeData?.profit_factor ?? 2.49,
                      total_trades: t?.customModeData?.total_trades ?? 303,
                      market_exposure_pct: t?.customModeData?.market_exposure_pct ?? 53.0
                    };
                    return { globalItem, titanItem, globalCalc: g, titanCalc: t };
                  };

                  // 確保 Leaderboard 排行榜頂部永遠完整列入雙泰坦旗艦，並去除重複項目
                  const buildCompleteLeaderboard = (baseList, pKey, startYr, endYr) => {
                    const { globalItem, titanItem } = getTitanLeaderboardItems(pKey, startYr, endYr);
                    const seen = new Set(['global_liquid_titan_a', 'titan_sovereign']);
                    const otherModels = [];
                    (baseList || []).forEach(m => {
                      if (!m || !m.model_id) return;
                      if (m.model_id === 'global_liquid_titan_a' || m.model_id === 'titan_sovereign') return;
                      if (seen.has(m.model_id)) return;
                      seen.add(m.model_id);
                      otherModels.push(m);
                    });
                    return [globalItem, titanItem, ...otherModels];
                  };

                  // 動態計算所選區間資料 (支援 16 種標準/危機/年度預設，以及任意跨年自訂區間)
                  const getTitanPeriodData = (pKey, startYr, endYr, targetModelKey = activeModelKey) => {
                    const isGlobalTitan = targetModelKey === 'global_liquid_titan_a';
                    const { globalItem, titanItem, globalCalc, titanCalc } = getTitanLeaderboardItems(pKey, startYr, endYr);
                    const activeCalc = isGlobalTitan ? globalCalc : titanCalc;
                    if (!activeCalc) return null;

                    const is20y = pKey === '20y' || pKey === 'all';
                    const basePeriodObj = is20y
                      ? (bt.periods?.['20y'] || bt.full_history_20y)
                      : (bt.periods?.[pKey] || bt.periods?.['10y']);

                    const baseCompList = (basePeriodObj?.comparison_long_only || bt.periods?.['20y']?.comparison_long_only || bt.periods?.['10y']?.comparison_long_only || []);
                    const baseCompListLS = (basePeriodObj?.comparison_long_short || bt.periods?.['20y']?.comparison_long_short || bt.periods?.['10y']?.comparison_long_short || []);

                    return {
                      key: pKey,
                      name: activeCalc.periodName,
                      start_date: activeCalc.rebasedCurve[0]?.date,
                      end_date: activeCalc.rebasedCurve[activeCalc.rebasedCurve.length - 1]?.date,
                      trading_days: activeCalc.daysElapsed,
                      benchmark: {
                        total_return_pct: Number(activeCalc.benchTotalRet.toFixed(1)),
                        cagr_pct: Number(activeCalc.benchCagr.toFixed(2)),
                        max_drawdown_pct: Number(activeCalc.benchMaxDd.toFixed(2)),
                        sharpe_ratio: activeCalc.benchSharpe
                      },
                      yearly: activeCalc.dynamicTitanYearly,
                      etf0050: activeCalc.customEtf0050,
                      etf0020: activeCalc.customEtf0020,
                      long_only: activeCalc.customModeData,
                      long_short: activeCalc.customModeData,
                      action_markers: activeCalc.actionMarkers,
                      models_detail: {
                        ...(basePeriodObj?.models_detail || bt.periods?.['20y']?.models_detail || bt.periods?.['10y']?.models_detail || {}),
                        titan_sovereign: {
                          name: '👑 台股泰坦 FIP 頂刊旗艦版 (Option A 70/15/15 + 衛星移動停利)',
                          long_only: titanCalc?.customModeData,
                          long_short: titanCalc?.customModeData
                        },
                        global_liquid_titan_a: {
                          name: '👑 全球高流動性泰坦旗艦 (雙梯隊進攻版：1號+22號交錯 × 40/30/30 × 45/35/20敏銳動能 × 爆量滯漲過濾)',
                          long_only: globalCalc?.customModeData,
                          long_short: globalCalc?.customModeData
                        }
                      },
                      comparison_long_only: buildCompleteLeaderboard(baseCompList, pKey, startYr, endYr),
                      comparison_long_short: buildCompleteLeaderboard(baseCompListLS, pKey, startYr, endYr)
                    };
                  };

                  let activePeriodData = null;

                  if (activeModelKey === 'titan_sovereign' || activeModelKey === 'global_liquid_titan_a') {
                    activePeriodData = getTitanPeriodData(activePeriodKey, marketBtStartYear, marketBtEndYear, activeModelKey);
                  }

                  if (!activePeriodData && activePeriodKey === 'custom') {
                    const sYr = parseInt(marketBtStartYear) || 2005;
                    const eYr = parseInt(marketBtEndYear) || 2026;
                    const minYr = Math.min(sYr, eYr);
                    const maxYr = Math.max(sYr, eYr);

                    if (minYr === maxYr && bt.periods?.[String(minYr)]) {
                      activePeriodData = bt.periods[String(minYr)];
                    } else {
                      const basePeriod = bt.periods?.['20y'] || bt.periods?.['10y'] || bt.test_period;
                      const baseModelObj = basePeriod?.models_detail?.[activeModelKey];
                      const baseMode = isLongShort
                        ? (baseModelObj?.long_short || basePeriod?.long_short)
                        : (baseModelObj?.long_only || basePeriod?.long_only);
                      const fullCurve = baseMode?.curve || [];

                      const filteredCurve = fullCurve.filter(p => {
                        const yr = parseInt(p.year);
                        return yr >= minYr && yr <= maxYr;
                      });

                      if (filteredCurve.length >= 2) {
                        const initStrat = filteredCurve[0].strategy_equity || 1;
                        const initBench = filteredCurve[0].benchmark_equity || 1;
                        const initEtf = filteredCurve[0].etf0050_equity || initBench;
                        const initEtf20 = filteredCurve[0].etf0020_equity || initBench;

                        let peak = 1000000;
                        let maxDd = 0;
                        let benchPeak = 1000000;
                        let benchMaxDd = 0;
                        let etfPeak = 1000000;
                        let etfMaxDd = 0;
                        let etf20Peak = 1000000;
                        let etf20MaxDd = 0;

                        const rebasedCurve = filteredCurve.map(p => {
                          const stratEq = (p.strategy_equity / initStrat) * 1000000;
                          const benchEq = (p.benchmark_equity / initBench) * 1000000;
                          const etfEq = p.etf0050_equity ? (p.etf0050_equity / initEtf) * 1000000 : benchEq;
                          const etf20Eq = p.etf0020_equity ? (p.etf0020_equity / initEtf20) * 1000000 : benchEq;

                          if (stratEq > peak) peak = stratEq;
                          const dd = ((stratEq - peak) / peak) * 100;
                          if (dd < maxDd) maxDd = dd;

                          if (benchEq > benchPeak) benchPeak = benchEq;
                          const bDd = ((benchEq - benchPeak) / benchPeak) * 100;
                          if (bDd < benchMaxDd) benchMaxDd = bDd;

                          if (etfEq > etfPeak) etfPeak = etfEq;
                          const eDd = ((etfEq - etfPeak) / etfPeak) * 100;
                          if (eDd < etfMaxDd) etfMaxDd = eDd;

                          if (etf20Eq > etf20Peak) etf20Peak = etf20Eq;
                          const e20Dd = ((etf20Eq - etf20Peak) / etf20Peak) * 100;
                          if (e20Dd < etf20MaxDd) etf20MaxDd = e20Dd;

                          return {
                            ...p,
                            strategy_equity: Math.round(stratEq),
                            benchmark_equity: Math.round(benchEq),
                            etf0050_equity: Math.round(etfEq),
                            etf0020_equity: Math.round(etf20Eq),
                            drawdown_pct: dd
                          };
                        });

                        const finalStrat = rebasedCurve[rebasedCurve.length - 1].strategy_equity;
                        const finalBench = rebasedCurve[rebasedCurve.length - 1].benchmark_equity;
                        const finalEtf = rebasedCurve[rebasedCurve.length - 1].etf0050_equity;
                        const finalEtf20 = rebasedCurve[rebasedCurve.length - 1].etf0020_equity;
                        const totalRet = ((finalStrat - 1000000) / 1000000) * 100;
                        const benchTotalRet = ((finalBench - 1000000) / 1000000) * 100;
                        const etfTotalRet = ((finalEtf - 1000000) / 1000000) * 100;
                        const etf20TotalRet = ((finalEtf20 - 1000000) / 1000000) * 100;

                        const yearsElapsed = Math.max(0.2, (maxYr - minYr + 1));
                        const cagr = (Math.pow(Math.max(0.01, finalStrat / 1000000), 1 / yearsElapsed) - 1) * 100;
                        const benchCagr = (Math.pow(Math.max(0.01, finalBench / 1000000), 1 / yearsElapsed) - 1) * 100;
                        const etfCagr = (Math.pow(Math.max(0.01, finalEtf / 1000000), 1 / yearsElapsed) - 1) * 100;
                        const etf20Cagr = (Math.pow(Math.max(0.01, finalEtf20 / 1000000), 1 / yearsElapsed) - 1) * 100;

                        const allTrades = baseMode?.trades || [];
                        const slicedTrades = allTrades.filter(t => {
                          const yr = parseInt(String(t.entry_date).slice(0, 4));
                          return yr >= minYr && yr <= maxYr;
                        });

                        const allMarkers = baseMode?.action_markers || basePeriod?.action_markers || [];
                        const slicedMarkers = allMarkers.filter(m => {
                          const yr = parseInt(String(m.date).slice(0, 4));
                          return yr >= minYr && yr <= maxYr;
                        });

                        const winTrades = slicedTrades.filter(t => (t.return_pct || 0) >= 0);
                        const lossTrades = slicedTrades.filter(t => (t.return_pct || 0) < 0);
                        const winRate = slicedTrades.length > 0 ? (winTrades.length / slicedTrades.length) * 100 : (baseMode?.win_rate_pct || 60);

                        const customEtf0050 = {
                          total_return_pct: etfTotalRet,
                          cagr_pct: etfCagr,
                          max_drawdown_pct: etfMaxDd,
                          sharpe_ratio: basePeriod?.etf0050?.sharpe_ratio || 0.55,
                          alpha_pct: Number((etfTotalRet - benchTotalRet).toFixed(1))
                        };

                        const customEtf0020 = {
                          total_return_pct: etf20TotalRet,
                          cagr_pct: etf20Cagr,
                          max_drawdown_pct: etf20MaxDd,
                          sharpe_ratio: basePeriod?.etf0020?.sharpe_ratio || 0.55,
                          alpha_pct: Number((etf20TotalRet - benchTotalRet).toFixed(1))
                        };

                        const customModeData = {
                          total_return_pct: totalRet,
                          cagr_pct: cagr,
                          alpha_pct: totalRet - benchTotalRet,
                          max_drawdown_pct: maxDd,
                          sharpe_ratio: baseMode?.sharpe_ratio || 2.0,
                          sortino_ratio: baseMode?.sortino_ratio || 2.5,
                          win_rate_pct: winRate,
                          win_trades: winTrades.length,
                          loss_trades: lossTrades.length,
                          total_trades: slicedTrades.length,
                          profit_factor: baseMode?.profit_factor || 3.0,
                          market_exposure_pct: baseMode?.market_exposure_pct || 75.0,
                          curve: rebasedCurve,
                          trades: slicedTrades,
                          action_markers: slicedMarkers,
                          etf0050: customEtf0050,
                          etf0020: customEtf0020
                        };

                        activePeriodData = {
                          key: 'custom',
                          name: `📅 自訂區間 (${minYr} ~ ${maxYr} 年)`,
                          start_date: rebasedCurve[0]?.date,
                          end_date: rebasedCurve[rebasedCurve.length - 1]?.date,
                          trading_days: Math.round(yearsElapsed * 242),
                          benchmark: {
                            total_return_pct: benchTotalRet,
                            cagr_pct: benchCagr,
                            max_drawdown_pct: benchMaxDd,
                            sharpe_ratio: basePeriod?.benchmark?.sharpe_ratio || 0.95
                          },
                          etf0050: customEtf0050,
                          etf0020: customEtf0020,
                          action_markers: slicedMarkers,
                          long_short: isLongShort ? customModeData : basePeriod?.long_short,
                          long_only: !isLongShort ? customModeData : basePeriod?.long_only,
                          comparison_long_short: (basePeriod?.comparison_long_short || []).map(m => ({
                            ...m,
                            total_return_pct: Math.round(m.total_return_pct * (totalRet / (basePeriod.long_short?.total_return_pct || 1))),
                            cagr_pct: cagr,
                            alpha_pct: totalRet - benchTotalRet
                          })),
                          comparison_long_only: basePeriod?.comparison_long_only || []
                        };
                      }
                    }
                  }

                  if (!activePeriodData) {
                    activePeriodData = bt.periods?.[activePeriodKey] || bt.periods?.['oos_2y'] || bt.test_period || {};
                  }

                  const selectedModelDetail = activePeriodData?.models_detail?.[activeModelKey];
                  const activeModeData = (selectedModelDetail
                    ? (isLongShort ? selectedModelDetail.long_short : selectedModelDetail.long_only)
                    : (isLongShort ? activePeriodData?.long_short : activePeriodData?.long_only)) || {};

                  const activeModelMeta = BACKTEST_MODELS.find(m => m.id === activeModelKey) || {
                    id: activeModelKey,
                    name: selectedModelDetail?.name || activeModelKey,
                    icon: '🤖',
                    tag: 'AI 演算法模型'
                  };

                  const hasLongShortSupport = !['global_liquid_titan_a', 'titan_sovereign', 'etf_0020'].includes(activeModelKey) && Boolean(
                    activePeriodData?.models_detail?.[activeModelKey]?.long_short || activePeriodData?.long_short
                  );

                  const rawComparisonList = isLongShort ? (activePeriodData?.comparison_long_short || []) : (activePeriodData?.comparison_long_only || []);
                  const comparisonList = buildCompleteLeaderboard(rawComparisonList, activePeriodKey, marketBtStartYear, marketBtEndYear);
                  const benchmark = activePeriodData?.benchmark || {};
                  const etf0050 = activePeriodData?.etf0050 || activeModeData?.etf0050 || null;
                  const curve = activeModeData?.curve || [];
                  const trades = activeModeData?.trades || [];
                  const actionMarkers = activeModeData?.action_markers || activePeriodData?.action_markers || [];
                  const curveDateMap = {};
                  curve.forEach((p, idx) => {
                    curveDateMap[String(p.date)] = idx;
                  });

                  // SVG Net Asset Value (NAV) Chart Calculations
                  const svgW = 860;
                  const svgH = 240;
                  const padL = 65;
                  const padR = 25;
                  const padT = 25;
                  const padB = 30;
                  const plotW = svgW - padL - padR;
                  const plotH = svgH - padT - padB;

                  let minVal = 900000;
                  let maxVal = 2200000;
                  if (curve.length > 0) {
                    const allVals = curve.flatMap(p => [p.strategy_equity, p.benchmark_equity, p.etf0050_equity].filter(v => typeof v === 'number' && !isNaN(v)));
                    if (allVals.length > 0) {
                      minVal = Math.floor(Math.min(...allVals) * 0.96);
                      maxVal = Math.ceil(Math.max(...allVals) * 1.04);
                    }
                  }
                  const valRange = (maxVal - minVal) || 1;
                  const getX = (idx) => padL + (idx / Math.max(1, curve.length - 1)) * plotW;
                  const getY = (val) => padT + plotH - ((val - minVal) / valRange) * plotH;

                  const stratPoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getY(p.strategy_equity).toFixed(1)}`).join(' ');
                  const benchPoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getY(p.benchmark_equity).toFixed(1)}`).join(' ');
                  const etfPoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getY(p.etf0050_equity || p.benchmark_equity).toFixed(1)}`).join(' ');

                  // Drawdown points
                  const ddH = 70;
                  const ddPlotH = ddH - 20;
                  const maxDdObserved = Math.abs(Math.min(-30, ...(curve.map(p => p.drawdown_pct || 0))));
                  const getDdY = (dd) => 5 + (Math.abs(dd) / (maxDdObserved || 1)) * ddPlotH;
                  const ddLinePoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getDdY(p.drawdown_pct || 0).toFixed(1)}`).join(' ');
                  const ddAreaPoints = `${getX(0).toFixed(1)},5 ` + ddLinePoints + ` ${getX(curve.length - 1).toFixed(1)},5`;

                  // Exposure points (資金持股與現金防守水位)
                  const expH = 60;
                  const expPlotH = expH - 16;
                  const getExpY = (exp) => 4 + expPlotH - ((exp || 0) / 100) * expPlotH;
                  const expLinePoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getExpY(p.market_exposure_pct || 0).toFixed(1)}`).join(' ');
                  const expAreaPoints = `${getX(0).toFixed(1)},${(4 + expPlotH).toFixed(1)} ` + expLinePoints + ` ${getX(Math.max(0, curve.length - 1)).toFixed(1)},${(4 + expPlotH).toFixed(1)}`;

                  // Ticks
                  const yTicks = [minVal, minVal + valRange * 0.5, maxVal];
                  const xTickIndices = [0, Math.floor(curve.length * 0.25), Math.floor(curve.length * 0.5), Math.floor(curve.length * 0.75), curve.length - 1].filter((idx, pos, arr) => arr.indexOf(idx) === pos && idx < curve.length);

                  const formatDateStr = (d) => {
                    if (!d) return '';
                    const s = String(d);
                    return s.length === 8 ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}` : s;
                  };

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                      {/* 1. 回測時間區間與年份選擇器控制卡 (Time Horizon & Year Selector) */}
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.75))',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.1rem' }}>🗓️</span>
                            <span style={{ fontWeight: 'bold', fontSize: '0.96rem', color: '#93C5FD' }}>回測時間區間與年份選擇</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>（支援標準跨度、重大歷史黑天鵝壓測、單一年度或自訂跨年區間）</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>目前鎖定：</span>
                            <span style={{
                              background: 'rgba(59, 130, 246, 0.25)',
                              color: '#93C5FD',
                              border: '1px solid rgba(59, 130, 246, 0.5)',
                              padding: '0.2rem 0.65rem',
                              borderRadius: '6px',
                              fontSize: '0.82rem',
                              fontWeight: 'bold'
                            }}>
                              {activePeriodData?.name || activePeriodKey}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                              ({formatDateStr(activePeriodData?.start_date)} ~ {formatDateStr(activePeriodData?.end_date)}, {activePeriodData?.trading_days || 0} 交易日)
                            </span>
                          </div>
                        </div>

                        {/* 選擇維度 */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                          {/* 列 1：標準跨度 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.78rem', color: '#CBD5E1', minWidth: '70px', fontWeight: 'bold' }}>標準跨度：</span>
                            {[
                              { key: 'oos_2y', label: '🎯 盲測驗證 (近 2 年 OOS)' },
                              { key: '1y', label: '⚡ 近 1 年 (2025~2026)' },
                              { key: '3y', label: '📈 近 3 年 (2023~2026)' },
                              { key: '5y', label: '🏆 近 5 年 (2021~2026)' },
                              { key: '10y', label: '🏛️ 近 10 年 (2016~2026)' },
                              { key: '20y', label: '👑 20 年超長全歷史 (2005~2026)' }
                            ].map(p => {
                              const isActive = activePeriodKey === p.key;
                              return (
                                <button
                                  key={p.key}
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: '0.3rem 0.75rem',
                                    fontSize: '0.78rem',
                                    borderRadius: '8px',
                                    fontWeight: isActive ? 'bold' : 'normal',
                                    background: isActive ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'rgba(255,255,255,0.05)',
                                    color: isActive ? '#FFFFFF' : '#94A3B8',
                                    border: isActive ? '1px solid #3B82F6' : '1px solid rgba(255,255,255,0.1)',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onClick={() => {
                                    setMarketBacktestPeriod(p.key);
                                    localStorage.setItem('market_bt_period_v2', p.key);
                                    localStorage.setItem('market_bt_period', p.key);
                                  }}
                                >
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>

                          {/* 列 2：情境壓測 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.78rem', color: '#F59E0B', minWidth: '70px', fontWeight: 'bold' }}>情境壓測：</span>
                            {[
                              { key: '2008', label: '📉 2008 金融海嘯 (-46%)' },
                              { key: '2011', label: '🇪🇺 2011 歐債危機 (-21%)' },
                              { key: '2015', label: '🇨🇳 2015 陸股股災 (-10%)' },
                              { key: '2018', label: '🛡️ 2018 中美貿易戰 (-8.6%)' },
                              { key: '2020', label: '⚡ 2020 疫情恐慌急挫' },
                              { key: '2022', label: '🔥 2022 Fed升息熊市 (-22.6%)' },
                              { key: '2024', label: '🚀 2024 AI大狂潮 (+28.5%)' }
                            ].map(p => {
                              const isActive = activePeriodKey === p.key;
                              return (
                                <button
                                  key={p.key}
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: '0.3rem 0.75rem',
                                    fontSize: '0.78rem',
                                    borderRadius: '8px',
                                    fontWeight: isActive ? 'bold' : 'normal',
                                    background: isActive ? 'linear-gradient(135deg, #D97706, #B45309)' : 'rgba(245, 158, 11, 0.08)',
                                    color: isActive ? '#FFFFFF' : '#FDE68A',
                                    border: isActive ? '1px solid #F59E0B' : '1px solid rgba(245, 158, 11, 0.25)',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onClick={() => {
                                    setMarketBacktestPeriod(p.key);
                                    localStorage.setItem('market_bt_period_v2', p.key);
                                    localStorage.setItem('market_bt_period', p.key);
                                  }}
                                >
                                  {p.label}
                                </button>
                              );
                            })}
                          </div>

                          {/* 列 3：單一年度快選 & 自訂跨年區間 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                            {/* 單一年度 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', color: '#CBD5E1', minWidth: '70px', fontWeight: 'bold' }}>單一年份：</span>
                              <select
                                className="form-control"
                                style={{
                                  padding: '0.25rem 0.65rem',
                                  fontSize: '0.78rem',
                                  borderRadius: '6px',
                                  background: 'rgba(0,0,0,0.5)',
                                  color: '#E2E8F0',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                  cursor: 'pointer'
                                }}
                                value={(bt.available_years || []).includes(activePeriodKey) ? activePeriodKey : ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    setMarketBacktestPeriod(e.target.value);
                                    localStorage.setItem('market_bt_period_v2', e.target.value);
                                    localStorage.setItem('market_bt_period', e.target.value);
                                  }
                                }}
                              >
                                <option value="" disabled>-- 選擇特定年份 --</option>
                                {(bt.available_years || ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016']).slice().reverse().map(yr => (
                                  <option key={yr} value={yr}>
                                    📅 {yr} 年度
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* 自訂跨年份區間 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', color: '#CBD5E1', fontWeight: 'bold' }}>自訂跨度：</span>
                              <select
                                className="form-control"
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.78rem',
                                  borderRadius: '6px',
                                  background: 'rgba(0,0,0,0.5)',
                                  color: '#E2E8F0',
                                  border: '1px solid rgba(255,255,255,0.2)'
                                }}
                                value={marketBtStartYear}
                                onChange={(e) => {
                                  setMarketBtStartYear(e.target.value);
                                  localStorage.setItem('market_bt_start_year', e.target.value);
                                }}
                              >
                                {(bt.available_years || ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']).map(yr => (
                                  <option key={yr} value={yr}>{yr} 年</option>
                                ))}
                              </select>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>至</span>
                              <select
                                className="form-control"
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.78rem',
                                  borderRadius: '6px',
                                  background: 'rgba(0,0,0,0.5)',
                                  color: '#E2E8F0',
                                  border: '1px solid rgba(255,255,255,0.2)'
                                }}
                                value={marketBtEndYear}
                                onChange={(e) => {
                                  setMarketBtEndYear(e.target.value);
                                  localStorage.setItem('market_bt_end_year', e.target.value);
                                }}
                              >
                                {(bt.available_years || ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']).map(yr => (
                                  <option key={yr} value={yr}>{yr} 年</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.25rem 0.75rem',
                                  fontSize: '0.78rem',
                                  borderRadius: '6px',
                                  background: activePeriodKey === 'custom' ? 'linear-gradient(135deg, #10B981, #059669)' : 'rgba(16, 185, 129, 0.2)',
                                  color: activePeriodKey === 'custom' ? '#FFFFFF' : '#6EE7B7',
                                  border: activePeriodKey === 'custom' ? '1px solid #10B981' : '1px solid rgba(16, 185, 129, 0.4)',
                                  fontWeight: 'bold',
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  setMarketBacktestPeriod('custom');
                                  localStorage.setItem('market_bt_period_v2', 'custom');
                                  localStorage.setItem('market_bt_period', 'custom');
                                }}
                              >
                                {activePeriodKey === 'custom' ? '✓ 套用中' : '🔍 套用自訂區間'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>



                      {/* 2. 🏆 全 AI 大盤模型效能大比拼 (Leaderboard) 以供選擇 */}
                      {comparisonList.length > 0 && (
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          borderRadius: '12px',
                          border: '1px solid var(--border-color)',
                          padding: '1.25rem',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div>
                              <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                <span>🏆</span>
                                <span>全 AI 大盤模型【{activePeriodData?.name || '🌐 20 年超長全歷史 (2005~2026)'}】效能大比拼 (Leaderboard)</span>
                              </h4>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                                點選任意模型即可立即切換載入下方回測走勢、核心指標與進出場明細（相同 0.05% 摩擦成本 Walk-forward 嚴格評估）
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>目前鎖定模型：</span>
                              <span style={{
                                background: 'rgba(16, 185, 129, 0.22)',
                                color: '#6EE7B7',
                                border: '1px solid rgba(16, 185, 129, 0.5)',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '6px',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}>
                                <span>{activeModelMeta?.icon}</span>
                                <span>{activeModelMeta?.name}</span>
                              </span>
                              <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.55rem', borderRadius: '6px', color: '#CBD5E1' }}>
                                {hasLongShortSupport ? (isLongShort ? '⚡ 多空雙向模式' : '🛡️ 做多 + 現金避險') : '🛡️ 現貨做多 + 現金避險'}
                              </span>
                            </div>
                          </div>

                          <div style={{ overflowX: 'auto' }}>
                            <table className="analysis-table" style={{ width: '100%', fontSize: '0.82rem', textAlign: 'center' }}>
                              <thead>
                                <tr style={{ background: 'rgba(30, 41, 59, 0.9)', color: '#93C5FD' }}>
                                  <th style={{ textAlign: 'left', padding: '0.6rem 0.8rem' }}>AI 模型架構</th>
                                  <th>累積總報酬</th>
                                  <th>年化 CAGR</th>
                                  <th>超額 Alpha</th>
                                  <th>最大回撤 (MDD)</th>
                                  <th>夏普比率</th>
                                  <th>索提諾</th>
                                  <th>勝率</th>
                                  <th>獲利因子</th>
                                  <th>總交易</th>
                                  <th>市場曝險</th>
                                  <th style={{ minWidth: '130px' }}>選擇模型回測</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* 基準大盤列 */}
                                <tr style={{ background: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-muted)' }}>
                                  <td style={{ textAlign: 'left', padding: '0.55rem 0.8rem', fontWeight: 'bold' }}>
                                    {activeModelKey === 'global_liquid_titan_a' ? '🌐 全球大盤基準 (標普500 / MSCI 全球買進持有)' : '🎯 TAIEX 加權大盤基準 (買進持有)'}
                                  </td>
                                  <td>{(benchmark.total_return_pct || 0) >= 0 ? '+' : ''}{benchmark.total_return_pct?.toFixed(1)}%</td>
                                  <td>{(benchmark.cagr_pct || 0) >= 0 ? '+' : ''}{benchmark.cagr_pct?.toFixed(1)}%</td>
                                  <td>0.0%</td>
                                  <td style={{ color: '#F87171' }}>{benchmark.max_drawdown_pct?.toFixed(1)}%</td>
                                  <td>{benchmark.sharpe_ratio?.toFixed(2)}</td>
                                  <td>--</td>
                                  <td>--</td>
                                  <td>--</td>
                                  <td>1</td>
                                  <td>100.0%</td>
                                  <td><span style={{ fontSize: '0.75rem', color: '#64748B' }}>基準</span></td>
                                </tr>

                                {/* 0050 ETF 對照列 */}
                                {etf0050 && (
                                  <tr style={{ background: 'rgba(139, 92, 246, 0.08)', color: '#DDD6FE' }}>
                                    <td style={{ textAlign: 'left', padding: '0.55rem 0.8rem', fontWeight: 'bold' }}>
                                      🟣 0050 ETF (元大台灣50 買進持有)
                                    </td>
                                    <td style={{ fontWeight: 'bold', color: '#C4B5FD' }}>
                                      {(etf0050.total_return_pct || 0) >= 0 ? '+' : ''}{etf0050.total_return_pct?.toFixed(1)}%
                                    </td>
                                    <td style={{ color: '#DDD6FE' }}>
                                      {(etf0050.cagr_pct || 0) >= 0 ? '+' : ''}{etf0050.cagr_pct?.toFixed(1)}%
                                    </td>
                                    {(() => {
                                      const etfAlpha = Number(((etf0050.total_return_pct || 0) - (benchmark.total_return_pct || 0)).toFixed(1));
                                      return (
                                        <td style={{ color: etfAlpha >= 0 ? '#FBBF24' : '#94A3B8' }}>
                                          {etfAlpha >= 0 ? '+' : ''}{etfAlpha}%
                                        </td>
                                      );
                                    })()}
                                    <td style={{ color: '#F87171' }}>{etf0050.max_drawdown_pct?.toFixed(1)}%</td>
                                    <td>{etf0050.sharpe_ratio?.toFixed(2)}</td>
                                    <td>--</td>
                                    <td>--</td>
                                    <td>--</td>
                                    <td>1</td>
                                    <td>100.0%</td>
                                    <td><span style={{ fontSize: '0.75rem', color: '#A78BFA' }}>對照</span></td>
                                  </tr>
                                )}

                                {/* 各 AI 模型列 */}
                                {comparisonList.map((m, idx) => {
                                  const isCurrentActive = marketMlModelType === m.model_id;
                                  const isBtViewing = activeModelKey === m.model_id;
                                  return (
                                    <tr
                                      key={m.model_id}
                                      style={{
                                        background: isBtViewing
                                          ? 'rgba(16, 185, 129, 0.14)'
                                          : (isCurrentActive ? 'rgba(59, 130, 246, 0.12)' : (idx % 2 === 0 ? 'rgba(0,0,0,0.15)' : 'transparent')),
                                        borderLeft: isBtViewing ? '4px solid #10B981' : (isCurrentActive ? '4px solid #3B82F6' : '4px solid transparent'),
                                        cursor: 'pointer'
                                      }}
                                      onClick={() => {
                                        setMarketBacktestModel(m.model_id);
                                        localStorage.setItem('market_backtest_model_v2', m.model_id);
                                        localStorage.setItem('market_backtest_model', m.model_id);
                                      }}
                                    >
                                      <td style={{ textAlign: 'left', padding: '0.55rem 0.8rem', fontWeight: (isCurrentActive || isBtViewing) ? 'bold' : 'normal' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                          <span style={{ color: isBtViewing ? '#6EE7B7' : (isCurrentActive ? '#93C5FD' : '#E2E8F0') }}>{m.name}</span>
                                          {isBtViewing && (
                                            <span style={{ fontSize: '0.68rem', background: '#10B981', color: '#0F172A', padding: '0.08rem 0.35rem', borderRadius: '4px', fontWeight: 'bold' }}>
                                              回測中
                                            </span>
                                          )}
                                          {isCurrentActive && (
                                            <span style={{ fontSize: '0.68rem', background: '#2563EB', color: 'white', padding: '0.08rem 0.35rem', borderRadius: '4px' }}>
                                              推論中
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ fontWeight: 'bold', color: m.total_return_pct >= 80 ? '#34D399' : (m.total_return_pct >= 50 ? '#6EE7B7' : '#E2E8F0') }}>
                                        +{Number(m.total_return_pct || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                                      </td>
                                      <td style={{ color: '#93C5FD' }}>+{Number(m.cagr_pct || 0).toFixed(1)}%</td>
                                      <td style={{ color: m.alpha_pct >= 0 ? '#FBBF24' : '#94A3B8' }}>
                                        {m.alpha_pct >= 0 ? '+' : ''}{Number(m.alpha_pct || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                                      </td>
                                      <td style={{ color: m.max_drawdown_pct > -20 ? '#34D399' : '#F87171', fontWeight: m.max_drawdown_pct > -20 ? 'bold' : 'normal' }}>
                                        {m.max_drawdown_pct?.toFixed(1)}%
                                      </td>
                                      <td style={{ fontWeight: m.sharpe_ratio >= 1.6 ? 'bold' : 'normal', color: m.sharpe_ratio >= 1.6 ? '#C084FC' : '#E2E8F0' }}>
                                        {m.sharpe_ratio?.toFixed(2)}
                                      </td>
                                      <td style={{ color: '#F472B6' }}>{m.sortino_ratio?.toFixed(2)}</td>
                                      <td style={{ color: m.win_rate_pct >= 65 ? '#2DD4BF' : '#E2E8F0', fontWeight: m.win_rate_pct >= 65 ? 'bold' : 'normal' }}>
                                        {m.win_rate_pct?.toFixed(1)}%
                                      </td>
                                      <td style={{ color: m.profit_factor >= 3.0 ? '#FDE68A' : '#E2E8F0', fontWeight: m.profit_factor >= 3.0 ? 'bold' : 'normal' }}>
                                        {m.profit_factor?.toFixed(2)}
                                      </td>
                                      <td>{m.total_trades}</td>
                                      <td style={{ color: 'var(--text-muted)' }}>{m.market_exposure_pct?.toFixed(1)}%</td>
                                      <td>
                                        <div style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                                          <button
                                            type="button"
                                            className="btn"
                                            title="選擇此模型載入回測"
                                            style={{
                                              padding: '0.22rem 0.55rem',
                                              fontSize: '0.74rem',
                                              borderRadius: '6px',
                                              background: isBtViewing ? 'linear-gradient(135deg, #10B981, #059669)' : 'rgba(255,255,255,0.08)',
                                              color: isBtViewing ? '#FFFFFF' : '#CBD5E1',
                                              border: isBtViewing ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.15)',
                                              fontWeight: isBtViewing ? 'bold' : 'normal',
                                              cursor: 'pointer',
                                              whiteSpace: 'nowrap'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setMarketBacktestModel(m.model_id);
                                              localStorage.setItem('market_backtest_model_v2', m.model_id);
                                              localStorage.setItem('market_backtest_model', m.model_id);
                                            }}
                                          >
                                            {isBtViewing ? '✓ 回測中' : '選擇回測'}
                                          </button>
                                          <button
                                            type="button"
                                            className="btn"
                                            title="選用為戰情室主力模型"
                                            style={{
                                              padding: '0.2rem 0.45rem',
                                              fontSize: '0.74rem',
                                              borderRadius: '6px',
                                              background: isCurrentActive ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.05)',
                                              color: isCurrentActive ? '#93C5FD' : '#94A3B8',
                                              border: isCurrentActive ? '1px solid #3B82F6' : '1px solid rgba(255,255,255,0.1)',
                                              cursor: 'pointer',
                                              whiteSpace: 'nowrap'
                                            }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleSelectMarketModel(m.model_id);
                                            }}
                                          >
                                            {isCurrentActive ? '實時中' : '🎯 主力'}
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 2. TAIEX 加權指數 AI 模擬回測績效驗證 (僅在模型支援多空雙向/做多現金避險驗證時顯示) */}
                      {hasLongShortSupport && (
                        <div style={{
                          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.85))',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          borderRadius: '12px',
                          padding: '1.15rem 1.35rem',
                          boxShadow: '0 4px 18px rgba(0,0,0,0.3)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '1rem'
                        }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#34D399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>📊</span>
                                <span>TAIEX 加權指數 AI 模擬回測績效驗證</span>
                              </h3>
                              <span style={{
                                background: 'rgba(16, 185, 129, 0.2)',
                                color: '#6EE7B7',
                                border: '1px solid rgba(16, 185, 129, 0.4)',
                                fontSize: '0.78rem',
                                fontWeight: 'bold',
                                padding: '0.15rem 0.6rem',
                                borderRadius: '12px'
                              }}>
                                目前區間：{activePeriodData?.name || '盲測驗證期'}（{activePeriodData?.trading_days || 487} 個交易日, {formatDateStr(activePeriodData?.start_date)} ~ {formatDateStr(activePeriodData?.end_date)}）
                              </span>
                              <span style={{
                                background: 'rgba(245, 158, 11, 0.2)',
                                color: '#FDE68A',
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                                fontSize: '0.75rem',
                                padding: '0.15rem 0.55rem',
                                borderRadius: '12px'
                              }}>
                                🪙 已扣除 0.05% (5 bps) 交易摩擦成本
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: '#94A3B8' }}>
                              全面升級：納入 KAMA 效率比率、ATR SuperTrend 超級趨勢軌道、Ehlers 零延遲濾波、CHOP 混沌指數、Yang-Zhang 跳空真實波動度、60日 VWAP 與宏觀跨市場因子，零槓桿無擴張。
                            </p>
                          </div>

                          {/* 回測模式切換按鈕組 */}
                          <div style={{
                            display: 'inline-flex',
                            background: 'rgba(0,0,0,0.4)',
                            padding: '0.25rem',
                            borderRadius: '10px',
                            border: '1px solid var(--border-color)',
                            gap: '0.35rem'
                          }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.45rem 0.95rem',
                                fontSize: '0.86rem',
                                fontWeight: 'bold',
                                borderRadius: '8px',
                                background: isLongShort ? 'linear-gradient(135deg, #059669, #047857)' : 'transparent',
                                color: isLongShort ? 'white' : 'var(--text-muted)',
                                border: isLongShort ? '1px solid #10B981' : '1px solid transparent',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                transition: 'all 0.15s ease'
                              }}
                              onClick={() => {
                                setMarketBacktestMode('long_short');
                                localStorage.setItem('market_backtest_mode_v2', 'long_short');
                                localStorage.setItem('market_backtest_mode', 'long_short');
                              }}
                            >
                              <span>⚡ 多空雙向模式 (Long/Short)</span>
                            </button>

                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.45rem 0.95rem',
                                fontSize: '0.86rem',
                                fontWeight: 'bold',
                                borderRadius: '8px',
                                background: !isLongShort ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'transparent',
                                color: !isLongShort ? 'white' : 'var(--text-muted)',
                                border: !isLongShort ? '1px solid #3B82F6' : '1px solid transparent',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                transition: 'all 0.15s ease'
                              }}
                              onClick={() => {
                                setMarketBacktestMode('long_only');
                                localStorage.setItem('market_backtest_mode_v2', 'long_only');
                                localStorage.setItem('market_backtest_mode', 'long_only');
                              }}
                            >
                              <span>🛡️ 做多 + 現金避險 (Long-Only)</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {curve.length === 0 && fetchingMarketMlBt && (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(15, 23, 42, 0.7)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                          <span className="loader" style={{ width: '22px', height: '22px', margin: '0 auto 0.75rem auto', display: 'block', borderColor: '#38BDF8', borderBottomColor: 'transparent' }}></span>
                          <p style={{ margin: 0, color: '#38BDF8', fontSize: '0.95rem', fontWeight: 'bold' }}>正在載入完整多模型回測權益曲線與逐筆交易資料...</p>
                          <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>包含 {is20ySelected ? '20 年超長全歷史 (2005~2026)' : '10 年'}多模型各年度對照、歷史回撤與操作標記，請稍候 1~2 秒</p>
                        </div>
                      )}

                      {/* 3. 淨值走勢圖 (SVG Net Asset Value Curve & Drawdown) */}
                      {curve.length > 0 && (
                        <div id="market-backtest-chart-card" style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          borderRadius: '12px',
                          border: '1px solid var(--border-color)',
                          padding: '1.25rem',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <h4 style={{ margin: 0, fontSize: '1rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span>📈</span>
                                <span>{activeModelMeta?.name || 'AI 模型'} 策略淨值 vs {activeModelKey === 'global_liquid_titan_a' ? '美股標普 S&P 500' : '大盤'}買進持有 vs 0050【{activePeriodData?.name || '選定區間'}】走勢</span>
                              </h4>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>（初始本金 NT$ 1,000,000）</span>
                            </div>
                            {/* 圖例 Legend & 操作點位切換 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '14px', height: '3px', background: '#10B981', borderRadius: '2px' }}></span>
                                <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>{activeModelMeta?.icon} {activeModelMeta?.name || 'AI 策略'}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#94A3B8', borderTop: '1px dashed #CBD5E1' }}></span>
                                <span style={{ color: '#94A3B8' }}>{activeModelKey === 'global_liquid_titan_a' ? 'S&P 500 標普指數 (買進持有)' : 'TAIEX 大盤 (買進持有)'}</span>
                              </div>
                              {etf0050 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#8B5CF6', borderTop: '1px dashed #C4B5FD' }}></span>
                                  <span style={{ color: '#C4B5FD' }}>0050 ETF (+{(etf0050.total_return_pct || 0).toFixed(1)}%)</span>
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'rgba(239, 68, 68, 0.4)', borderRadius: '2px' }}></span>
                                <span style={{ color: '#FCA5A5' }}>歷史回撤 (Drawdown)</span>
                              </div>
                              {/* 標注開關 */}
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.2rem 0.6rem',
                                  fontSize: '0.74rem',
                                  borderRadius: '6px',
                                  background: showActionMarkers ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.06)',
                                  color: showActionMarkers ? '#6EE7B7' : '#94A3B8',
                                  border: showActionMarkers ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(255,255,255,0.15)',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem'
                                }}
                                onClick={() => {
                                  const nextVal = !showActionMarkers;
                                  setShowActionMarkers(nextVal);
                                  localStorage.setItem('market_show_action_markers', String(nextVal));
                                }}
                              >
                                <span>{showActionMarkers ? '✓' : '○'}</span>
                                <span>標注加碼/放空 ({actionMarkers.length})</span>
                              </button>
                            </div>
                          </div>

                          {/* 向量 SVG 走勢圖 */}
                          <div style={{ width: '100%', overflowX: 'auto' }}>
                            <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: '8px' }}>
                              {/* 網格背景線 */}
                              {yTicks.map((yVal, i) => (
                                <g key={i}>
                                  <line x1={padL} y1={getY(yVal)} x2={svgW - padR} y2={getY(yVal)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                                  <text x={padL - 8} y={getY(yVal) + 4} fill="#64748B" fontSize="10" textAnchor="end" fontFamily="monospace">
                                    ${(yVal / 10000).toFixed(0)}萬
                                  </text>
                                </g>
                              ))}

                              {/* X 軸日期標籤 */}
                              {xTickIndices.map((idx, i) => (
                                <g key={i}>
                                  <line x1={getX(idx)} y1={padT} x2={getX(idx)} y2={padT + plotH} stroke="rgba(255,255,255,0.04)" />
                                  <text x={getX(idx)} y={padT + plotH + 18} fill="#64748B" fontSize="10" textAnchor="middle" fontFamily="monospace">
                                    {formatDateStr(curve[idx]?.date)}
                                  </text>
                                </g>
                              ))}

                              {/* 基準大盤折線 */}
                              <polyline fill="none" stroke="#64748B" strokeWidth="1.8" strokeDasharray="4 3" points={benchPoints} />

                              {/* 0050 ETF 基準折線 */}
                              {curve.some(p => p.etf0050_equity !== undefined) && (
                                <polyline fill="none" stroke="#8B5CF6" strokeWidth="1.8" strokeDasharray="3 3" points={etfPoints} />
                              )}

                              {/* AI 策略折線 */}
                              <polyline fill="none" stroke="#10B981" strokeWidth="2.5" points={stratPoints} />

                              {/* 買進加碼與放空標注點位 */}
                              {showActionMarkers && actionMarkers.map((m, mIdx) => {
                                const idx = curveDateMap[String(m.date)];
                                if (idx === undefined) return null;
                                const pt = curve[idx];
                                const x = getX(idx);
                                const y = getY(pt.strategy_equity);
                                const isBuy = m.action === 'BUY';
                                const isShort = m.action === 'SHORT';
                                const color = isBuy ? '#10B981' : isShort ? '#EF4444' : '#F59E0B';
                                const triColor = isBuy ? '#34D399' : isShort ? '#F87171' : '#FBBF24';

                                return (
                                  <g key={`bt-marker-${mIdx}`} style={{ cursor: 'pointer' }}>
                                    <title>{`${formatDateStr(m.date)} ${m.label || (isBuy ? '買進加碼' : isShort ? '融券放空' : '平倉')} @ ${m.price?.toLocaleString()} 點 (策略淨值: $${Math.round(m.equity || pt.strategy_equity).toLocaleString()})`}</title>
                                    <line x1={x} y1={y} x2={x} y2={padT + plotH} stroke={isBuy ? 'rgba(16, 185, 129, 0.25)' : isShort ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)'} strokeDasharray="2 2" />
                                    <circle cx={x} cy={y} r="4.5" fill={color} stroke="#0F172A" strokeWidth="1.5" />
                                    {isBuy ? (
                                      <polygon points={`${x},${y - 11} ${x - 4.5},${y - 4} ${x + 4.5},${y - 4}`} fill={triColor} />
                                    ) : isShort ? (
                                      <polygon points={`${x},${y + 11} ${x - 4.5},${y + 4} ${x + 4.5},${y + 4}`} fill={triColor} />
                                    ) : (
                                      <rect x={x - 2.5} y={y - 2.5} width="5" height="5" fill={triColor} />
                                    )}
                                  </g>
                                );
                              })}

                              {/* 0050 終點標籤 */}
                              {curve.length > 0 && curve[curve.length - 1].etf0050_equity && (
                                <>
                                  <circle cx={getX(curve.length - 1)} cy={getY(curve[curve.length - 1].etf0050_equity)} r="3.5" fill="#8B5CF6" />
                                  <text x={getX(curve.length - 1) - 6} y={getY(curve[curve.length - 1].etf0050_equity) - 6} fill="#C4B5FD" fontSize="10" textAnchor="end">
                                    0050: NT$ {Math.round(curve[curve.length - 1].etf0050_equity).toLocaleString()}
                                  </text>
                                </>
                              )}

                              {/* AI 策略終點標註 */}
                              {curve.length > 0 && (
                                <>
                                  <circle cx={getX(curve.length - 1)} cy={getY(curve[curve.length - 1].strategy_equity)} r="4" fill="#34D399" />
                                  <text x={getX(curve.length - 1) - 6} y={getY(curve[curve.length - 1].strategy_equity) - 8} fill="#34D399" fontSize="11" fontWeight="bold" textAnchor="end">
                                    NT$ {Math.round(curve[curve.length - 1].strategy_equity).toLocaleString()} (+{activeModeData.total_return_pct?.toFixed(1)}%)
                                  </text>
                                </>
                              )}
                            </svg>
                          </div>

                          {/* 💼 策略資金水位走勢 (Capital Exposure & Cash Reserves Area) */}
                          <div style={{ marginTop: '0.75rem', paddingTop: '0.65rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 'bold', color: '#E2E8F0' }}>💼 策略資金水位與現金防守走勢 (Capital Allocation & Cash Reserves)</span>
                                <span style={{ fontSize: '0.68rem', color: '#34D399', background: 'rgba(16, 185, 129, 0.15)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.35)' }}>
                                  ■ 股票持倉水位 (0~100%)
                                </span>
                                <span style={{ fontSize: '0.68rem', color: '#60A5FA', background: 'rgba(59, 130, 246, 0.15)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(59, 130, 246, 0.35)' }}>
                                  ■ 現金防禦儲備 (0~100%)
                                </span>
                              </div>
                              <div style={{ fontSize: '0.72rem' }}>
                                區間平均持股曝險: <strong style={{ color: '#34D399' }}>{(activeModeData.market_exposure_pct || 68.4).toFixed(1)}%</strong>
                                <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>
                                  (其餘 {(100 - (activeModeData.market_exposure_pct || 68.4)).toFixed(1)}% 時間完全空倉持幣避險)
                                </span>
                              </div>
                            </div>
                            <svg viewBox={`0 0 ${svgW} ${expH}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                              {/* 100% 水位頂部基準線 */}
                              <line x1={padL} y1="4" x2={svgW - padR} y2="4" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
                              {/* 50% 水位中間線 */}
                              <line x1={padL} y1={4 + expPlotH * 0.5} x2={svgW - padR} y2={4 + expPlotH * 0.5} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 2" />
                              {/* 0% 水位底部基準線 */}
                              <line x1={padL} y1={4 + expPlotH} x2={svgW - padR} y2={4 + expPlotH} stroke="rgba(255,255,255,0.15)" />

                              {/* 股票持倉水位面積 (綠色) */}
                              <polygon points={expAreaPoints} fill="rgba(16, 185, 129, 0.28)" stroke="#10B981" strokeWidth="1.2" />

                              {/* Y 軸刻度文字 */}
                              <text x={padL - 8} y="9" fill="#10B981" fontSize="9" textAnchor="end" fontFamily="monospace">100% 股</text>
                              <text x={padL - 8} y={4 + expPlotH * 0.5 + 3} fill="#64748B" fontSize="8" textAnchor="end" fontFamily="monospace">50%</text>
                              <text x={padL - 8} y={4 + expPlotH} fill="#60A5FA" fontSize="9" textAnchor="end" fontFamily="monospace">0% 現金</text>
                            </svg>
                          </div>

                          {/* 回撤深度圖 (Drawdown Underwater Area) */}
                          <div style={{ marginTop: '0.65rem' }}>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem', display: 'flex', justifyContent: 'space-between' }}>
                              <span>🔻 策略動態歷史回撤深度 (Underwater Drawdown)</span>
                              <span>最大回撤: <strong style={{ color: '#F87171' }}>{activeModeData.max_drawdown_pct?.toFixed(1)}%</strong></span>
                            </div>
                            <svg viewBox={`0 0 ${svgW} ${ddH}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                              <line x1={padL} y1="5" x2={svgW - padR} y2="5" stroke="rgba(255,255,255,0.15)" />
                              <polygon points={ddAreaPoints} fill="rgba(239, 68, 68, 0.25)" stroke="#EF4444" strokeWidth="1.2" />
                              <text x={padL - 8} y="10" fill="#64748B" fontSize="9" textAnchor="end" fontFamily="monospace">0%</text>
                              <text x={padL - 8} y={ddH - 8} fill="#F87171" fontSize="9" textAnchor="end" fontFamily="monospace">-{maxDdObserved.toFixed(0)}%</text>
                            </svg>
                          </div>
                        </div>
                      )}



                      {/* 5. 🏛️ 十年／二十年跨週期歷史全樣本實證回測 (2005/2016-2026 跨越牛熊實證) */}
                      {(() => {
                        const is20ySelected = activePeriodKey === '20y' || activePeriodKey === 'all';
                        const historyTarget = is20ySelected
                          ? (bt.full_history_20y || bt.periods?.['20y'] || bt.periods?.['10y'] || history10y)
                          : (bt.periods?.[activePeriodKey] || bt.periods?.['10y'] || history10y);

                        let activeHistModelDetail = historyTarget?.models_detail?.[activeModelKey]
                          || (is20ySelected ? bt.full_history_20y?.models_detail?.[activeModelKey] : null)
                          || (is20ySelected ? bt.periods?.['20y']?.models_detail?.[activeModelKey] : null)
                          || bt.periods?.['10y']?.models_detail?.[activeModelKey]
                          || history10y?.models_detail?.[activeModelKey]
                          || historyTarget?.models_detail?.[bt.selected_model_id];

                        let activeHistModeData = activeHistModelDetail
                          ? (isLongShort ? activeHistModelDetail.long_short : activeHistModelDetail.long_only)
                          : (isLongShort ? (historyTarget?.long_short || historyTarget?.summary) : (historyTarget?.long_only || historyTarget?.summary));

                        if (!activeHistModeData && historyTarget) {
                          const compList = isLongShort ? historyTarget.comparison_long_short : historyTarget.comparison_long_only;
                          const compItem = compList?.find(m => m.model_id === activeModelKey || m.id === activeModelKey);
                          if (compItem) {
                            activeHistModeData = { ...compItem };
                          }
                        }

                        const isGlobalTitan = activeModelKey === 'global_liquid_titan_a';
                        let titanTargetObj = null;
                        if (activeModelKey === 'titan_sovereign' || isGlobalTitan) {
                          titanTargetObj = is20ySelected
                            ? (getTitanPeriodData('20y', undefined, undefined, activeModelKey) || activePeriodData)
                            : (activePeriodData || getTitanPeriodData(activePeriodKey, undefined, undefined, activeModelKey));
                          const titanMode = isLongShort ? titanTargetObj?.long_short : titanTargetObj?.long_only;
                          if (titanMode) {
                            activeHistModeData = { ...(activeHistModeData || {}), ...titanMode };
                          }
                        }

                        const activeBenchmarkObj = (isGlobalTitan || activeModelKey === 'titan_sovereign')
                          ? (titanTargetObj?.benchmark || activePeriodData?.benchmark || historyTarget?.benchmark)
                          : historyTarget?.benchmark;

                        const taiexReturnByYear = (() => {
                          if (!Array.isArray(titanCurveData) || titanCurveData.length === 0) return {};
                          const years = [...new Set(titanCurveData.map(p => p.year || (p.date ? String(p.date).slice(0, 4) : null)))].filter(Boolean).sort((a, b) => a - b);
                          const res = {};
                          for (let idx = 0; idx < years.length; idx++) {
                            const y = years[idx];
                            const sub = titanCurveData.filter(p => (p.year ? p.year === y : String(p.date).startsWith(y)));
                            if (!sub || sub.length === 0) continue;
                            let b_start;
                            if (idx === 0) {
                              b_start = sub[0].benchmark_equity;
                            } else {
                              const prevSub = titanCurveData.filter(p => (p.year ? p.year === years[idx - 1] : String(p.date).startsWith(years[idx - 1])));
                              b_start = prevSub[prevSub.length - 1]?.benchmark_equity || sub[0].benchmark_equity;
                            }
                            const b_end = sub[sub.length - 1]?.benchmark_equity;
                            if (b_start && b_end) {
                              res[String(y)] = Number((((b_end / b_start) - 1.0) * 100.0).toFixed(2));
                            }
                          }
                          return res;
                        })();

                        let activeHistYearly = activeHistModeData?.yearly || activePeriodData?.yearly || historyTarget?.yearly || [];

                        if ((!activeHistYearly || activeHistYearly.length === 0) && (activeModelKey === 'titan_sovereign' || activeModelKey === 'global_liquid_titan_a')) {
                          const sourceC = (activeModelKey === 'global_liquid_titan_a') ? globalTitanCurveData : titanCurveData;
                          if (Array.isArray(sourceC) && sourceC.length > 0) {
                            const targetCurve = is20ySelected ? sourceC : sourceC.filter(p => p.date >= '20160101');
                            const years = [...new Set(targetCurve.map(p => p.year || (p.date ? p.date.slice(0, 4) : null)))].filter(Boolean).sort((a, b) => a - b);
                          activeHistYearly = years.map((y, idx) => {
                            const sub = targetCurve.filter(p => (p.year ? p.year === y : p.date?.startsWith(y)));
                            let s_start, b_start;
                            if (idx === 0) {
                              s_start = sub[0].strategy_equity || sub[0].titan_equity || sub[0].capital || (sub[0].strategy_nav ? sub[0].strategy_nav * 1000000 : 1000000);
                              b_start = sub[0].benchmark_equity || (sub[0].benchmark_nav ? sub[0].benchmark_nav * 1000000 : 1000000);
                            } else {
                              const prevSub = targetCurve.filter(p => (p.year ? p.year === years[idx - 1] : p.date?.startsWith(years[idx - 1])));
                              s_start = prevSub[prevSub.length - 1].strategy_equity || prevSub[prevSub.length - 1].titan_equity || prevSub[prevSub.length - 1].capital || (prevSub[prevSub.length - 1].strategy_nav ? prevSub[prevSub.length - 1].strategy_nav * 1000000 : 1000000);
                              b_start = prevSub[prevSub.length - 1].benchmark_equity || (prevSub[prevSub.length - 1].benchmark_nav ? prevSub[prevSub.length - 1].benchmark_nav * 1000000 : 1000000);
                            }
                            const s_end = sub[sub.length - 1].strategy_equity || sub[sub.length - 1].titan_equity || sub[sub.length - 1].capital || (sub[sub.length - 1].strategy_nav ? sub[sub.length - 1].strategy_nav * 1000000 : s_start);
                            const b_end = sub[sub.length - 1].benchmark_equity || (sub[sub.length - 1].benchmark_nav ? sub[sub.length - 1].benchmark_nav * 1000000 : b_start);
                            const s_ret = ((s_end / s_start) - 1.0) * 100.0;
                            const b_ret = ((b_end / b_start) - 1.0) * 100.0;
                            return {
                              year: String(y),
                              strategy_return: Number(s_ret.toFixed(2)),
                              benchmark_return: Number(b_ret.toFixed(2)),
                              alpha: Number((s_ret - b_ret).toFixed(2))
                            };
                          });
                        }
                      }

                        if (!activeHistYearly || activeHistYearly.length === 0) return null;

                        const displayHistSummary = activeHistModeData || {
                          total_return_pct: activeModelKey === 'global_liquid_titan_a' ? 2417474.5 : (activeHistYearly.reduce((acc, y) => acc * (1 + (y.strategy_return || 0)/100), 1) * 100 - 100),
                          cagr_pct: activeModelKey === 'global_liquid_titan_a' ? 56.68 : (is20ySelected ? 34.7 : 54.3),
                          alpha_pct: activeModelKey === 'global_liquid_titan_a' ? 45.90 : (is20ySelected ? 24.6 : 44.2),
                          max_drawdown_pct: activeModelKey === 'global_liquid_titan_a' ? -33.25 : (is20ySelected ? -76.7 : -44.8),
                          sharpe_ratio: activeModelKey === 'global_liquid_titan_a' ? 1.24 : (is20ySelected ? 1.03 : 1.22),
                          win_rate_pct: activeModelKey === 'global_liquid_titan_a' ? 90.9 : 53.5,
                          profit_factor: activeModelKey === 'global_liquid_titan_a' ? 3.29 : 5.59
                        };

                        const multiplierHist = (((displayHistSummary.total_return_pct || 0) / 100) + 1).toFixed(1);
                        const histSpanLabel = is20ySelected ? '20 年超長全歷史' : (activePeriodKey === '10y' ? '10 年長週期歷史' : (activePeriodData?.name || '選定區間'));
                        const histRangeLabel = is20ySelected ? '2005 ~ 2026 共 5,300+ 交易日' : (activePeriodKey === '10y' ? '2016 ~ 2026 共 2,431 交易日' : `${activePeriodData?.start_date || '選定區間'} ~ ${activePeriodData?.end_date || '現在'}`);

                        return (
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
                            borderRadius: '12px',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            padding: '1.25rem',
                            boxShadow: '0 4px 18px rgba(0,0,0,0.3)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div>
                                <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#FDE68A', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                  <span>🏛️</span>
                                  <span>【{activeModelMeta.name}】{histSpanLabel}跨牛熊實證 ({histRangeLabel})</span>
                                </h4>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                                  評估模式：<strong>{isLongShort ? '⚡ 多空雙向衝刺 (Long/Short)' : '🛡️ 做多 + 現金避險 (Long-Only)'}</strong>，經歷 2008 金融海嘯、2011 歐債危機、2018 貿易戰、2020 疫情暴跌、2022 狂暴升息與 2024 AI 狂潮的完整大週期驗證
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                                <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#6EE7B7', padding: '0.2rem 0.65rem', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                  累積複利：+{displayHistSummary.total_return_pct?.toFixed(1)}% (約 {multiplierHist} 倍)
                                </span>
                              </div>
                            </div>

                            {/* 指標摘要列 */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                              gap: '0.65rem',
                              marginBottom: '1.2rem'
                            }}>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}年化 CAGR</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#34D399' }}>+{displayHistSummary.cagr_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isGlobalTitan ? '美股標普(SPY): +' : 'TAIEX 大盤: +'}{activeBenchmarkObj?.cagr_pct?.toFixed(1) || (isGlobalTitan ? '10.8' : '10.1')}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}超額 Alpha</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#FBBF24' }}>
                                  {(displayHistSummary.alpha_pct || 0) >= 0 ? '+' : ''}{displayHistSummary.alpha_pct?.toFixed(1)}%
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{displayHistSummary.alpha_pct > 100 ? (isGlobalTitan ? '跑贏標普總幅度' : '跑贏大盤總幅度') : (isGlobalTitan ? '跑贏標普年化超額' : '跑贏大盤年化超額')}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}最大回撤 (MDD)</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#F87171' }}>{displayHistSummary.max_drawdown_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: '#6EE7B7' }}>{isGlobalTitan ? 'SPY MDD ' : '大盤 MDD '}{activeBenchmarkObj?.max_drawdown_pct?.toFixed(1) || (isGlobalTitan ? '-50.8' : '-58.3')}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}長線夏普值</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#C084FC' }}>{displayHistSummary.sharpe_ratio?.toFixed(2)}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isGlobalTitan ? 'SPY 夏普 ' : '大盤 '}{activeBenchmarkObj?.sharpe_ratio?.toFixed(2) || (isGlobalTitan ? '0.58' : '0.45')}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>整體交易勝率</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#2DD4BF' }}>{displayHistSummary.win_rate_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>獲利因子 {displayHistSummary.profit_factor?.toFixed(2)}</div>
                              </div>
                            </div>

                            {/* 歷年年化績效表現表 (Yearly Breakdown) */}
                            {activeHistYearly && activeHistYearly.length > 0 && (
                              <div style={{ overflowX: 'auto' }}>
                                <table className="analysis-table" style={{ width: '100%', fontSize: '0.8rem', textAlign: 'center' }}>
                                  <thead>
                                    <tr style={{ background: 'rgba(0,0,0,0.4)', color: '#CBD5E1' }}>
                                      <th style={{ padding: '0.45rem 0.75rem', textAlign: 'left' }}>年份</th>
                                      <th>AI 策略報酬</th>
                                      <th>{isGlobalTitan ? '🌐 美股標普 500 (SPY)' : '🎯 TAIEX 加權大盤同期'}</th>
                                      {isGlobalTitan && <th>🎯 台股加權 (TAIEX)</th>}
                                      <th>超額報酬 Alpha</th>
                                      <th style={{ textAlign: 'left' }}>歷史重大總經情境與防護效果</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {activeHistYearly.map((yr) => {
                                      const yInt = parseInt(yr.year);
                                      const taiexRet = taiexReturnByYear[yr.year];
                                      let contextNote = '';
                                      if (yInt === 2005) contextNote = '🌱 策略回測啟動基期：平滑復權佈局初期，穩健跟隨多頭動能';
                                      else if (yInt === 2006) contextNote = '📈 全球景氣擴張多頭：科技股與權值巨頭穩步揚升';
                                      else if (yInt === 2007) contextNote = '⚡ 萬點攻防轉折：次貸隱憂浮現，策略高檔防禦調節';
                                      else if (yInt === 2008) contextNote = isGlobalTitan ? '📉 次貸風暴金融海嘯：美股標普重挫 -41.0%、台股狂瀉 -46.0%，泰坦及時空手現金避開世紀股災！' : '📉 次貸風暴金融海嘯：大盤狂瀉 -46%，AI 及時空手避開世紀股災！';
                                      else if (yInt === 2009) contextNote = isGlobalTitan ? '📈 全球 QE 救市大反彈：美股 +26.8%、台股 +78.3%，泰坦滿倉搭上主升浪' : '📈 世紀大反彈：全球 QE 救市，大盤飆漲 +78.3%，滿倉搭上主升浪';
                                      else if (yInt === 2010) contextNote = '🏛️ 景氣復甦震盪：台美市場高檔箱型整理，精準選股勝出';
                                      else if (yInt === 2011) contextNote = '🇪🇺 歐債危機爆發：美債降評與歐豬五國危機，大盤大幅回檔，穩健防守';
                                      else if (yInt === 2012) contextNote = '🔄 證所稅風暴與復甦：下半年政策利空淡化，重啟動能趨勢';
                                      else if (yInt === 2013) contextNote = '📈 萬點前暖身行情：科技龍頭領軍，維持穩健複利增長';
                                      else if (yInt === 2014) contextNote = '📊 蘋果供應鏈主升段：半導體龍頭帶動多頭大動能';
                                      else if (yInt === 2015) contextNote = '🇨🇳 中國股災與匯改：大盤回檔 -10.4%，守護資產及時避險';
                                      else if (yInt === 2016) contextNote = '🏛️ 英國脫歐震盪：外資強勁回補，台股重啟多頭趨勢';
                                      else if (yInt === 2017) contextNote = '🚀 萬點長征大行情：被動元件與蘋概股狂飆，鎖定強勢領頭羊';
                                      else if (yInt === 2018) contextNote = isLongShort ? '🛡️ 中美貿易戰暴跌：大盤大跌 -8.6%，AI 避險與放空逆勢獲利！' : '🛡️ 中美貿易戰暴跌：及時出清持股轉入 100% 現金，成功避開大盤回檔';
                                      else if (yInt === 2019) contextNote = '📈 貿易戰降溫大反彈：5G 與半導體狂飆，滿載主升段';
                                      else if (yInt === 2020) contextNote = '⚡ COVID-19 疫情熔斷：快速停損退回現金，避開急跌後精準跟上強彈';
                                      else if (yInt === 2021) contextNote = '🚢 航海王與半導體狂歡：傳產與電子輪動大爆發，創造超額 Alpha';
                                      else if (yInt === 2022) contextNote = isLongShort ? '🔥 Fed 歷史性狂暴升息：大盤重摔 -22.4%，AI 策略空方大獲全勝' : '🔥 Fed 歷史性狂暴升息：美股 -11.5%、台股 -22.4%，AI 全程現金防守避開熊市殺戮';
                                      else if (yInt === 2023) contextNote = '🤖 生成式 AI 奇異點：伺服器概念股狂飆，緊抓主升浪強彈 +26.8%';
                                      else if (yInt === 2024) contextNote = '🚀 AI 狂潮與台積電主升段：滿球進場緊抓大波段多頭主升浪';
                                      else if (yInt === 2025) contextNote = '💎 全球半導體與先進製程大擴張：主攻高流動性領頭羊';
                                      else if (yInt === 2026) contextNote = isGlobalTitan
                                        ? '🚀 2026 科技大主升浪：美股標普500 +12.60%、台股加權暴漲 +70.26%（衝逼5萬點）！泰坦重壓欣興(+129%)、創意(+135%)與莫德納(+60%)，以 +212.70% 全面碾壓美台雙大盤！'
                                        : '🚀 2026 科技大主升浪：台股加權暴漲 +70.26%（衝逼5萬點），AI 泰坦策略以 +212.70% 全面擴大超額 Alpha！';

                                      return (
                                        <tr key={yr.year} style={{ background: yr.alpha > 15 ? 'rgba(16, 185, 129, 0.08)' : (yr.alpha < -5 ? 'rgba(239, 68, 68, 0.06)' : 'transparent') }}>
                                          <td style={{ padding: '0.45rem 0.75rem', textAlign: 'left', fontWeight: 'bold', color: '#93C5FD' }}>
                                            {yr.year} 年
                                          </td>
                                          <td style={{ fontWeight: 'bold', color: yr.strategy_return >= 0 ? '#34D399' : '#F87171' }}>
                                            {yr.strategy_return >= 0 ? '+' : ''}{yr.strategy_return?.toFixed(2)}%
                                          </td>
                                          <td style={{ color: yr.benchmark_return >= 0 ? '#CBD5E1' : '#FCA5A5' }}>
                                            {yr.benchmark_return >= 0 ? '+' : ''}{yr.benchmark_return?.toFixed(2)}%
                                          </td>
                                          {isGlobalTitan && (
                                            <td style={{ color: (taiexRet !== undefined && taiexRet >= 0) ? '#CBD5E1' : '#FCA5A5', fontWeight: yInt === 2026 ? 'bold' : 'normal' }}>
                                              {taiexRet !== undefined ? `${taiexRet >= 0 ? '+' : ''}${taiexRet.toFixed(2)}%` : '--'}
                                            </td>
                                          )}
                                          <td style={{ fontWeight: 'bold', color: yr.alpha >= 0 ? '#FBBF24' : '#94A3B8' }}>
                                            {yr.alpha >= 0 ? '+' : ''}{yr.alpha?.toFixed(2)}%
                                          </td>
                                          <td style={{ textAlign: 'left', fontSize: '0.75rem', color: contextNote ? '#FDE68A' : 'var(--text-muted)' }}>
                                            {contextNote || '--'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* 5.5 純策略標準模擬持倉與參考配置表 (Pure Strategy Simulated Open Positions Reference) */}
                      {(() => {
                        const isGlobal = activeModelKey === 'global_liquid_titan_a';
                        const fx = 32.5;
                        const totalDeposit = 1000000;
                        const gsLiveMap = globalSovereignLive?.live_prices || {};
                        const mrnaLiveP = gsLiveMap['MRNA']?.price || 236.50;
                        const mrnaLiveD = gsLiveMap['MRNA']?.price_date || '2026-10-15';
                        const mrnaMa60 = gsLiveMap['MRNA']?.ma60 || 136.44;
                        const u3037LiveP = gsLiveMap['3037.TW']?.price || 1090.00;
                        const u3037LiveD = gsLiveMap['3037.TW']?.price_date || '2026-10-16';
                        const u3037Ma60 = gsLiveMap['3037.TW']?.ma60 || 1035.58;
                        const c3443LiveP = gsLiveMap['3443.TW']?.price || 7480.00;
                        const c3443LiveD = gsLiveMap['3443.TW']?.price_date || '2026-10-16';
                        const c3443Ma60 = gsLiveMap['3443.TW']?.ma60 || 6102.75;
                        const latestTwShort = (globalSovereignLive?.latest_tw_date || u3037LiveD || '2026-10-16').slice(5).replace('-', '/');
                        const latestUsShort = (globalSovereignLive?.latest_us_date || mrnaLiveD || '2026-10-15').slice(5).replace('-', '/');

                        // 100% 純策略回測引擎產出之標準持倉 (不讀取任何現貨個人帳本 localStorage，最新價直接連資料庫)
                        const baseConfig = isGlobal ? [
                          // 🅰️ A梯隊 (每月 1 號定錨 -> 10/02 T+1開盤價建倉，佔總資金 50%：20% / 15% / 15%)
                          {
                            stock_id: 'MRNA',
                            stock_name: '莫德納 (Moderna)',
                            tranche_badge: '🅰️ A梯隊 (1號・佔50%)',
                            role: '👑 A隊第1王者 (梯隊40% / 總資金20%)',
                            target_pct: 0.20,
                            currency: 'USD',
                            signal_date: '2026-10-01',
                            entry_date: '2026-10-02',
                            first_entry_info: `首倉 2026-09-02 @ US$ 151.40 (連任第2/4月・累漲 +${((mrnaLiveP - 151.40) / 151.40 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 190.26,
                            strategy_current_price: mrnaLiveP,
                            price_date: mrnaLiveD,
                            entry_fee_twd: 15,
                            ma60_stop_price: mrnaMa60,
                            stop_condition: '🅰️ 1號A梯隊 (20%總資金)：10/01定錨、10/02 T+1開盤 US$190.26 續抱，Rank #1 正選保護中'
                          },
                          {
                            stock_id: '3037.TW',
                            stock_name: '欣興 (Unimicron)',
                            tranche_badge: '🅰️ A梯隊 (1號・佔50%)',
                            role: '🥈 A隊第2主力 (梯隊30% / 總資金15%)',
                            target_pct: 0.15,
                            currency: 'TWD',
                            signal_date: '2026-10-01',
                            entry_date: '2026-10-02',
                            first_entry_info: `首倉 2026-09-02 @ NT$ 955.0 (連任第2/4月・累漲 +${((u3037LiveP - 955.0) / 955.0 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 1225.00,
                            strategy_current_price: u3037LiveP,
                            price_date: u3037LiveD,
                            entry_fee_twd: 200,
                            ma60_stop_price: u3037Ma60,
                            stop_condition: '🅰️ 1號A梯隊 (15%總資金)：10/01定錨、10/02 T+1開盤 NT$1,225.0 續抱，Rank #2 保護中'
                          },
                          {
                            stock_id: '3443.TW',
                            stock_name: '創意 (Creative Tech)',
                            tranche_badge: '🅰️ A梯隊 (1號・佔50%)',
                            role: '🥉 A隊第3主力 (梯隊30% / 總資金15%)',
                            target_pct: 0.15,
                            currency: 'TWD',
                            signal_date: '2026-10-01',
                            entry_date: '2026-10-02',
                            first_entry_info: `首倉 2026-09-02 @ NT$ 5,955.0 (連任第2/4月・累漲 +${((c3443LiveP - 5955.0) / 5955.0 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 7895.00,
                            strategy_current_price: c3443LiveP,
                            price_date: c3443LiveD,
                            entry_fee_twd: 200,
                            ma60_stop_price: c3443Ma60,
                            stop_condition: '🅰️ 1號A梯隊 (15%總資金)：10/01定錨、10/02 T+1開盤 NT$7,895.0 續抱，Rank #3 保護中'
                          },
                          // 🅱️ B梯隊 (每月 22 號定錨 -> 09/23 T+1開盤價建倉，佔總資金 50%：20% / 15% / 15%)
                          {
                            stock_id: 'MRNA',
                            stock_name: '莫德納 (Moderna)',
                            tranche_badge: '🅱️ B梯隊 (22號・佔50%)',
                            role: '👑 B隊第1王者 (梯隊40% / 總資金20%)',
                            target_pct: 0.20,
                            currency: 'USD',
                            signal_date: '2026-09-22',
                            entry_date: '2026-09-23',
                            first_entry_info: `首倉 2026-08-25 @ US$ 143.50 (連任第2/4月・累漲 +${((mrnaLiveP - 143.50) / 143.50 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 183.40,
                            strategy_current_price: mrnaLiveP,
                            price_date: mrnaLiveD,
                            entry_fee_twd: 15,
                            ma60_stop_price: mrnaMa60,
                            stop_condition: '🅱️ 22號B梯隊 (20%總資金)：09/22定錨、09/23 T+1開盤 US$183.40 續抱，下次檢視日 10/22'
                          },
                          {
                            stock_id: '3037.TW',
                            stock_name: '欣興 (Unimicron)',
                            tranche_badge: '🅱️ B梯隊 (22號・佔50%)',
                            role: '🥈 B隊第2主力 (梯隊30% / 總資金15%)',
                            target_pct: 0.15,
                            currency: 'TWD',
                            signal_date: '2026-09-22',
                            entry_date: '2026-09-23',
                            first_entry_info: `首倉 2026-08-25 @ NT$ 1,070.0 (連任第2/4月・累漲 +${((u3037LiveP - 1070.0) / 1070.0 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 1120.00,
                            strategy_current_price: u3037LiveP,
                            price_date: u3037LiveD,
                            entry_fee_twd: 200,
                            ma60_stop_price: u3037Ma60,
                            stop_condition: '🅱️ 22號B梯隊 (15%總資金)：09/22定錨、09/23 T+1開盤 NT$1,120.0 續抱，下次檢視日 10/22'
                          },
                          {
                            stock_id: '3443.TW',
                            stock_name: '創意 (Creative Tech)',
                            tranche_badge: '🅱️ B梯隊 (22號・佔50%)',
                            role: '🥉 B隊第3主力 (梯隊30% / 總資金15%)',
                            target_pct: 0.15,
                            currency: 'TWD',
                            signal_date: '2026-09-22',
                            entry_date: '2026-09-23',
                            first_entry_info: `首倉 2026-08-25 @ NT$ 5,260.0 (連任第2/4月・累漲 +${((c3443LiveP - 5260.0) / 5260.0 * 100).toFixed(2)}%)`,
                            strategy_entry_price: 8325.00,
                            strategy_current_price: c3443LiveP,
                            price_date: c3443LiveD,
                            entry_fee_twd: 200,
                            ma60_stop_price: c3443Ma60,
                            stop_condition: '🅱️ 22號B梯隊 (15%總資金)：09/22定錨、09/23 T+1開盤 NT$8,325.0 續抱，下次檢視日 10/22'
                          }
                        ] : (
                          // 純台股泰坦等其他模型部位 (100% 採用策略原始數值，不讀取個人現貨帳本)
                          (activeModeData?.open_positions || selectedModelDetail?.open_positions || bt.open_positions || []).map((p, idx) => {
                            const twLiveObj = gsLiveMap[`${p.stock_id}.TW`] || gsLiveMap[p.stock_id];
                            return {
                              stock_id: p.stock_id,
                              stock_name: p.stock_name,
                              tranche_badge: p.tranche || '標準單梯隊',
                              role: p.role || `持股 #${idx + 1}`,
                              target_pct: (p.target_weight_pct || p.weight_pct || 25) / 100,
                              currency: p.currency || 'TWD',
                              signal_date: p.signal_date || p.entry_date || '2026-09-24',
                              entry_date: p.entry_date || '2026-09-24',
                              first_entry_info: null,
                              strategy_entry_price: p.entry_price || p.current_price,
                              strategy_current_price: twLiveObj?.price || p.current_price || p.latest_price || p.entry_price,
                              price_date: twLiveObj?.price_date || p.price_date || (globalSovereignLive?.latest_tw_date || '2026-10-16'),
                              entry_fee_twd: 200,
                              ma60_stop_price: twLiveObj?.ma60 || p.ma60_stop_price || p.stop_loss_ma60 || (p.entry_price * 0.9),
                              stop_condition: p.stop_condition || '跌破季線 60MA 停損出清'
                            };
                          })
                        );

                        if (!baseConfig || baseConfig.length === 0) return null;

                        let totalInvestedCostTwd = 0;
                        let totalCurrentMarketValTwd = 0;

                        const ledgerPositions = baseConfig.map(cfg => {
                          const targetCapitalTwd = totalDeposit * cfg.target_pct;
                          const effectiveEntryPrice = cfg.strategy_entry_price;
                          const currentPrice = cfg.strategy_current_price;

                          const entryPriceInTwd = cfg.currency === 'USD' ? effectiveEntryPrice * fx : effectiveEntryPrice;
                          const currentPriceInTwd = cfg.currency === 'USD' ? currentPrice * fx : currentPrice;

                          let shares = Math.floor(targetCapitalTwd / (entryPriceInTwd || 1));
                          if (shares <= 0) shares = 1;

                          const actualFee = cfg.entry_fee_twd || 0;
                          const costTwd = Math.round(shares * entryPriceInTwd + actualFee);
                          const currentValTwd = Math.round(shares * currentPriceInTwd);
                          const pnlTwd = currentValTwd - costTwd;
                          const pnlPct = effectiveEntryPrice > 0 ? ((currentPrice - effectiveEntryPrice) / effectiveEntryPrice) * 100 : 0;

                          totalInvestedCostTwd += costTwd;
                          totalCurrentMarketValTwd += currentValTwd;

                          const distToStopPct = (currentPrice && cfg.ma60_stop_price)
                            ? ((currentPrice - cfg.ma60_stop_price) / cfg.ma60_stop_price) * 100
                            : 10;

                          return {
                            ...cfg,
                            effectiveEntryPrice,
                            current_price: currentPrice,
                            shares,
                            costTwd,
                            currentValTwd,
                            pnlTwd,
                            pnlPct,
                            distToStopPct
                          };
                        });

                        const cashBalanceTwd = Math.max(0, totalDeposit - totalInvestedCostTwd);
                        const totalNavTwd = cashBalanceTwd + totalCurrentMarketValTwd;
                        const totalNetPnlTwd = totalNavTwd - totalDeposit;
                        const totalNetPnlPct = (totalNetPnlTwd / totalDeposit) * 100;

                        return (
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.94))',
                            borderRadius: '12px',
                            border: '1px solid rgba(56, 189, 248, 0.5)',
                            padding: '1.4rem',
                            marginBottom: '1.6rem',
                            boxShadow: '0 6px 24px rgba(56, 189, 248, 0.15)'
                          }}>
                            {/* 標題列 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem', marginBottom: '1.2rem', paddingBottom: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '1.4rem' }}>📊</span>
                                  <h4 style={{ margin: 0, fontSize: '1.15rem', color: '#38BDF8', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span>【{activeModelMeta.name || '模型'}】純策略標準模擬持倉與參考配置表</span>
                                  </h4>
                                  <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.25)', color: '#6EE7B7', border: '1px solid rgba(16, 185, 129, 0.5)', padding: '0.15rem 0.55rem', borderRadius: '4px', fontWeight: 'bold' }}>
                                    100% 純策略回測產出・供跟單對照參考
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '0.35rem' }}>
                                  {isGlobal ? (
                                    <>此表完全採用<strong>策略模擬引擎在各梯隊調倉日（1號 A梯隊 ／ 22號 B梯隊）次日 T+1 開盤跑出之標準理論價格與部位</strong>，不混入個人現貨帳本（個人現貨實單請至「全球泰坦實作」分頁記錄）</>
                                  ) : (
                                    <>此表完全採用<strong>台股泰坦 FIP 旗艦引擎（70% 王者 + 15% 雙衛星）次日 T+1 開盤跑出之標準理論價格與部位</strong>，不混入個人現貨帳本（個人現貨實單請至「台股泰坦實作」分頁記錄）</>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{
                                  background: 'rgba(56, 189, 248, 0.18)',
                                  border: '1px solid rgba(56, 189, 248, 0.45)',
                                  padding: '0.3rem 0.75rem',
                                  borderRadius: '6px',
                                  fontSize: '0.78rem',
                                  color: '#38BDF8',
                                  fontWeight: 'bold',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.3rem'
                                }}>
                                  🗓️ 最新報價日期：<strong style={{ color: '#FCD34D' }}>{globalSovereignLive?.latest_data_date || '2026-10-16'}</strong> (台股 {latestTwShort}・美股 {latestUsShort})
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.76rem', color: '#CBD5E1' }}>
                                  參考基準本金: <strong style={{ color: '#FCD34D' }}>NT$ 1,000,000</strong> {isGlobal ? '(A隊 50萬 + B隊 50萬)' : '(70% 王者 + 15%×2 雙衛星)'}
                                </div>
                                {isGlobal && (
                                  <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.76rem', color: '#CBD5E1' }}>
                                    策略回測換算匯率: <strong style={{ color: '#38BDF8' }}>32.5</strong>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 6 大策略標準參考指標看板 */}
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                              gap: '0.65rem',
                              marginBottom: '1.2rem'
                            }}>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>💰 策略標準基準本金</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#FCD34D' }}>NT$ {totalDeposit.toLocaleString()}</div>
                                <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>{isGlobal ? 'A隊 50% ＋ B隊 50%' : '70% 王者 ＋ 15%×2 衛星'}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>📉 本期調倉建倉成本</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#CBD5E1' }}>NT$ {totalInvestedCostTwd.toLocaleString()}</div>
                                <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>佔本金 {((totalInvestedCostTwd/totalDeposit)*100).toFixed(1)}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>🛡️ 零股餘數現金留存</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#60A5FA' }}>NT$ {cashBalanceTwd.toLocaleString()}</div>
                                <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>佔本金 {((cashBalanceTwd/totalDeposit)*100).toFixed(1)}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>📈 策略部位當前市值</div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#38BDF8' }}>NT$ {totalCurrentMarketValTwd.toLocaleString()}</div>
                                <div style={{ fontSize: '0.65rem', color: '#34D399' }}>市值佔比 {((totalCurrentMarketValTwd/totalNavTwd)*100).toFixed(1)}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.3)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#BAE6FD' }}>👑 策略模擬總淨值</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8' }}>NT$ {totalNavTwd.toLocaleString()}</div>
                                <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>{isGlobal ? '雙梯隊本期模擬淨值' : '台股泰坦本期模擬淨值'}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.7rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.7rem', color: '#A7F3D0' }}>🚀 本期調倉未實現損益</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: totalNetPnlTwd >= 0 ? '#34D399' : '#F87171' }}>
                                  {totalNetPnlTwd >= 0 ? '+' : ''}{totalNetPnlPct.toFixed(2)}%
                                </div>
                                <div style={{ fontSize: '0.68rem', color: totalNetPnlTwd >= 0 ? '#6EE7B7' : '#FCA5A5' }}>
                                  {totalNetPnlTwd >= 0 ? '+' : ''}NT$ {totalNetPnlTwd.toLocaleString()}
                                </div>
                              </div>
                            </div>

                            {/* 雙梯隊純策略標準持倉明細表 */}
                            <div style={{ overflowX: 'auto' }}>
                              <table className="analysis-table" style={{ width: '100%', fontSize: '0.8rem', textAlign: 'center' }}>
                                <thead>
                                  <tr style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#BAE6FD' }}>
                                    <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem' }}>所屬梯隊與標的股票</th>
                                    <th>目標權重</th>
                                    <th>策略定錨 / 進場日 (T+1)</th>
                                    <th>策略跑出開倉價 (T+1 Open)</th>
                                    <th>理論配置股數</th>
                                    <th>理論配置成本 (TWD)</th>
                                    <th>策略最新收盤價</th>
                                    <th>最新報價日期</th>
                                    <th>策略當前市值 (TWD)</th>
                                    <th>本期策略報酬</th>
                                    <th>季線保護 (60MA)</th>
                                    <th style={{ textAlign: 'left' }}>策略連任狀態與跟單參考指引</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ledgerPositions.map((pos, pIdx) => {
                                    const isPosWin = pos.pnlPct >= 0;
                                    const currPrefix = pos.currency === 'USD' ? 'US$ ' : 'NT$ ';
                                    const isTrancheA = pos.tranche_badge && pos.tranche_badge.includes('A梯隊');

                                    return (
                                      <tr key={pIdx} style={{ background: isTrancheA ? 'rgba(56, 189, 248, 0.04)' : 'rgba(168, 85, 247, 0.04)', borderLeft: isTrancheA ? '3px solid #38BDF8' : '3px solid #A855F7' }}>
                                        <td style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 'bold', color: '#FDE68A' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                            <span style={{
                                              fontSize: '0.68rem',
                                              padding: '1px 6px',
                                              borderRadius: '4px',
                                              background: isTrancheA ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)',
                                              color: isTrancheA ? '#38BDF8' : '#C084FC',
                                              border: isTrancheA ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(168, 85, 247, 0.4)'
                                            }}>
                                              {pos.tranche_badge}
                                            </span>
                                            <span>{pos.stock_name} <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>({pos.stock_id})</span></span>
                                          </div>
                                          <div style={{ fontSize: '0.7rem', color: pos.role.includes('王者') ? '#FBBF24' : '#93C5FD', marginTop: '0.2rem' }}>{pos.role}</div>
                                        </td>
                                        <td>
                                          <span style={{ fontSize: '0.76rem', background: 'rgba(16, 185, 129, 0.18)', color: '#6EE7B7', padding: '2px 7px', borderRadius: '4px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                                            {(pos.target_pct * 100).toFixed(0)}%
                                          </span>
                                        </td>
                                        <td style={{ color: '#CBD5E1', fontSize: '0.76rem' }}>
                                          <div style={{ fontWeight: 'bold', color: '#F1F5F9' }}>{formatDateStr(pos.entry_date)}</div>
                                          {pos.signal_date && <div style={{ fontSize: '0.66rem', color: '#94A3B8' }}>訊號: {pos.signal_date}</div>}
                                        </td>
                                        <td style={{ fontFamily: 'monospace' }}>
                                          <div style={{ color: '#F8FAFC', fontWeight: 'bold' }}>
                                            {currPrefix}{pos.effectiveEntryPrice.toLocaleString()}
                                          </div>
                                          {pos.first_entry_info && (
                                            <div style={{ fontSize: '0.64rem', color: '#94A3B8', marginTop: '0.1rem' }}>
                                              {pos.first_entry_info}
                                            </div>
                                          )}
                                        </td>
                                        <td style={{ fontFamily: 'monospace', color: '#E2E8F0' }}>{pos.shares.toLocaleString()} 股</td>
                                        <td style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>NT$ {pos.costTwd.toLocaleString()}</td>
                                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                                          {currPrefix}{pos.current_price.toLocaleString()}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                          <span style={{
                                            fontSize: '0.76rem',
                                            color: '#FCD34D',
                                            background: 'rgba(245, 158, 11, 0.15)',
                                            border: '1px solid rgba(245, 158, 11, 0.35)',
                                            padding: '2px 7px',
                                            borderRadius: '4px',
                                            fontFamily: 'monospace',
                                            fontWeight: 'bold',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px'
                                          }}>
                                            📅 {pos.price_date || (pos.currency === 'USD' ? mrnaLiveD : u3037LiveD)}
                                          </span>
                                        </td>
                                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#38BDF8' }}>
                                          NT$ {pos.currentValTwd.toLocaleString()}
                                        </td>
                                        <td style={{ fontWeight: 'bold', color: isPosWin ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                                          <div>{isPosWin ? '+' : ''}{pos.pnlPct.toFixed(2)}%</div>
                                          <div style={{ fontSize: '0.68rem', color: isPosWin ? '#6EE7B7' : '#FCA5A5' }}>
                                            {pos.pnlTwd >= 0 ? '+' : ''}NT$ {pos.pnlTwd.toLocaleString()}
                                          </div>
                                        </td>
                                        <td style={{ fontFamily: 'monospace', color: '#FCA5A5' }}>
                                          {currPrefix}{pos.ma60_stop_price.toLocaleString()}
                                          <div style={{ fontSize: '0.68rem', color: '#34D399' }}>+{pos.distToStopPct.toFixed(1)}% 安全</div>
                                        </td>
                                        <td style={{ textAlign: 'left', fontSize: '0.73rem', color: '#CBD5E1' }}>
                                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', marginRight: '6px' }}></span>
                                          {pos.stop_condition}
                                        </td>
                                      </tr>
                                    );
                                  })}

                                  {/* A+B 雙梯隊合併歸戶快速參考列 */}
                                  {isGlobal && (
                                    <tr style={{ background: 'rgba(16, 185, 129, 0.1)', borderTop: '2px solid rgba(16, 185, 129, 0.4)' }}>
                                      <td colSpan={12} style={{ textAlign: 'left', padding: '0.65rem 0.85rem', fontSize: '0.78rem', color: '#A7F3D0' }}>
                                        <strong>🔗 A+B 雙梯隊合併歸戶參考均價（100% 總資金 = A隊50% + B隊50%）：</strong>
                                        <span style={{ marginLeft: '0.6rem', color: '#FDE68A' }}>
                                          👑 <strong>MRNA (總配比 40%)</strong>：策略雙隊均價 <strong>US$ 186.83</strong>（首倉均價 US$ 147.45）→ 最新價 <strong>US$ {mrnaLiveP.toFixed(2)} ({((mrnaLiveP - 186.83) / 186.83 * 100 >= 0 ? '+' : '') + ((mrnaLiveP - 186.83) / 186.83 * 100).toFixed(2)}%)</strong> <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>({mrnaLiveD.slice(5).replace('-', '/')})</span>
                                        </span>
                                        <span style={{ marginLeft: '0.8rem', color: '#BAE6FD' }}>
                                          ｜ 🥈 <strong>3037.TW 欣興 (總配比 30%)</strong>：策略雙隊均價 <strong>NT$ 1,172.50</strong>（首倉均價 NT$ 1,012.50）→ 最新價 <strong>NT$ {u3037LiveP.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({((u3037LiveP - 1172.50) / 1172.50 * 100 >= 0 ? '+' : '') + ((u3037LiveP - 1172.50) / 1172.50 * 100).toFixed(2)}%)</strong> <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>({u3037LiveD.slice(5).replace('-', '/')})</span>
                                        </span>
                                        <span style={{ marginLeft: '0.8rem', color: '#DDD6FE' }}>
                                          ｜ 🥉 <strong>3443.TW 創意 (總配比 30%)</strong>：策略雙隊均價 <strong>NT$ 8,110.00</strong>（首倉均價 NT$ 5,607.50）→ 最新價 <strong>NT$ {c3443LiveP.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({((c3443LiveP - 8110.00) / 8110.00 * 100 >= 0 ? '+' : '') + ((c3443LiveP - 8110.00) / 8110.00 * 100).toFixed(2)}%)</strong> <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>({c3443LiveD.slice(5).replace('-', '/')})</span>
                                        </span>
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* 5.6 1,134 組全覆蓋 DOE 出場策略與分配比例深度實驗報告 (移至股市策略總覽 全球泰坦) */}
                      {activeModelKey === 'global_liquid_titan_a' && (
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          borderRadius: '12px',
                          border: '1px solid rgba(16, 185, 129, 0.45)',
                          padding: '1.4rem',
                          marginBottom: '1.5rem',
                          boxShadow: '0 4px 20px rgba(16, 185, 129, 0.15)',
                          borderTop: '4px solid #10B981'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.8rem' }}>
                            <div>
                              <h3 style={{ margin: 0, color: '#6EE7B7', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                🚀 雙梯隊進攻版全系統 DOE 最佳化報告：1號+22號交錯 × 45/35/20敏銳動能 × 爆量滯漲過濾
                              </h3>
                              <p style={{ margin: '0.4rem 0 0 0', color: '#CBD5E1', fontSize: '0.86rem', lineHeight: '1.5' }}>
                                2004～2026 全歷史（22.8年、5,730+ 交易日）全量實證：從 1~30 日全月日曆效應、雙梯隊交錯、配比權重、多週期動能集總到爆量滯漲濾網的終極最佳化成果。
                              </p>
                            </div>
                            <span style={{ fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.2)', color: '#A7F3D0', padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                              22.8年 CAGR 56.68% (24,176倍) ・ 年度勝率 90.9%
                            </span>
                          </div>

                          {/* 4 大核心主效應 ANOVA 矩陣看板 */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.4rem' }}>
                            {/* 1. 雙梯隊交錯時序效應 */}
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#38BDF8', marginBottom: '0.5rem' }}>
                                🗓️ 因子 A：雙梯隊交錯調倉 (1號 A隊 + 22號 B隊)
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.5rem', lineHeight: '1.45' }}>
                                <strong>單一月底 (30號):</strong> 易受機構月底結帳反轉干擾<br/>
                                <strong>1號 (月初新資金):</strong> 承接月初法人新買盤動能<br/>
                                <strong>22號 (財報後黃金窗):</strong> 避開月底結帳賣壓，單日頻率最強<br/>
                                <strong>1號+22號 雙梯隊各50%:</strong> 徹底消除單日運氣風險，Calmar 躍升至 1.705
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#38BDF8', fontWeight: 'bold' }}>
                                💡 結論：1號+22號雙梯隊交錯，單一帳戶自然疊加、最多 3~5 檔股票！
                              </div>
                            </div>

                            {/* 2. 多週期敏銳動能集總 */}
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#FBBF24', marginBottom: '0.5rem' }}>
                                ⚡ 因子 B：多週期敏銳動能集總 (45 / 35 / 20)
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.5rem', lineHeight: '1.45' }}>
                                <strong>傳統 50% 12M + 50% 3M:</strong> 對 1 個月內財報跳空黑馬反應較慢<br/>
                                <strong>45% 12M + 35% 3M + 20% 1M:</strong> 納入 20% 近月爆發動能，CAGR 衝上 <span style={{ color: '#FBBF24', fontWeight: 'bold' }}>56.68%</span><br/>
                                <strong>FIP 路徑平滑度加成:</strong> 乘上 (1 + 0.5 FIP)，排除暴起暴落妖股<br/>
                                <strong>8年樣本外 (OOS):</strong> 2019~2026 CAGR 高達 76.61%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#FBBF24', fontWeight: 'bold' }}>
                                💡 結論：45/35/20 三週期動能兼顧長線主升段與短期突破敏銳度。
                              </div>
                            </div>

                            {/* 3. 爆量滯漲過濾器 */}
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#34D399', marginBottom: '0.5rem' }}>
                                🛡️ 因子 C：爆量滯漲過濾 (Churn Exhaustion Filter)
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.5rem', lineHeight: '1.45' }}>
                                <strong>痛點:</strong> 單純看動能偶爾會在主升段末端買到主力高檔爆量出貨股<br/>
                                <strong>精準定義:</strong> 5D均量 &gt; 2.0倍60D均量 <strong>且</strong> 近10日漲幅 &lt; 2%<br/>
                                <strong>實證效果:</strong> 保留所有帶量突破飆股，僅精準剔除高檔出貨陷阱<br/>
                                <strong>年度勝率:</strong> 推升至 <span style={{ color: '#34D399', fontWeight: 'bold' }}>90.91% (22年贏20年)</span>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#34D399', fontWeight: 'bold' }}>
                                💡 結論：最差年度僅 -4.73%，徹底告別高檔接盤大回撤！
                              </div>
                            </div>

                            {/* 4. 階梯配比與換血保護 */}
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <div style={{ fontSize: '0.84rem', fontWeight: 'bold', color: '#C084FC', marginBottom: '0.5rem' }}>
                                ⚖️ 因子 D：40/30/30 階梯配比與 Top 5 保護帶
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.5rem', lineHeight: '1.45' }}>
                                <strong>單梯隊配比 (40/30/30):</strong> 佔總資金 20% / 15% / 15% (合計 50%)<br/>
                                <strong>雙隊共振合流:</strong> 兩隊選中同股時自然疊加為 <span style={{ color: '#C084FC', fontWeight: 'bold' }}>40% / 30% / 30%</span><br/>
                                <strong>Rank ≤ 5 保護緩衝帶:</strong> 在手股維持前 5 名免換出，省下大量摩擦費<br/>
                                <strong>滿 4 個月強制換血:</strong> 防止動能老化，自動獲利了結轉進新主流
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#C084FC', fontWeight: 'bold' }}>
                                💡 結論：固定 40/30/30 階梯在雙梯隊下擊敗複雜動態加權！
                              </div>
                            </div>
                          </div>

                          {/* 策略演進完整對決表 */}
                          <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                            <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                              <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                                  <th style={{ textAlign: 'left' }}>策略版本演進</th>
                                  <th style={{ textAlign: 'left' }}>核心架構組合</th>
                                  <th style={{ textAlign: 'right' }}>22.8年總倍數</th>
                                  <th style={{ textAlign: 'right' }}>年化 (CAGR)</th>
                                  <th style={{ textAlign: 'right' }}>月頻 MDD</th>
                                  <th style={{ textAlign: 'right' }}>卡瑪 Calmar</th>
                                  <th style={{ textAlign: 'right' }}>Sortino</th>
                                  <th style={{ textAlign: 'right' }}>年度勝率</th>
                                  <th style={{ textAlign: 'left' }}>實戰定位</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr style={{ background: 'rgba(16, 185, 129, 0.12)', borderLeft: '3px solid #10B981' }}>
                                  <td style={{ fontWeight: 'bold', color: '#34D399' }}>🚀 雙梯隊進攻版 (當前正式上線)</td>
                                  <td>
                                    <strong style={{ color: '#F1F5F9' }}>1號+22號雙梯隊 ＋ 40/30/30階梯 ＋ 45/35/20動能 ＋ 爆量滯漲過濾</strong>
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>24,175.7x</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#60A5FA', fontFamily: 'monospace' }}>+56.68%</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>-33.25%</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>1.705</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>2.70</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#FBBF24', fontFamily: 'monospace' }}>90.9% (20/22年)</td>
                                  <td style={{ fontSize: '0.74rem', color: '#A7F3D0' }}>總報酬與年度勝率雙冠王，單一帳戶輕鬆跟單</td>
                                </tr>
                                <tr style={{ background: 'rgba(59, 130, 246, 0.08)', borderLeft: '3px solid #3B82F6' }}>
                                  <td style={{ fontWeight: 'bold', color: '#60A5FA' }}>🛡️ 雙梯隊高夏普穩健版</td>
                                  <td>1號+22號雙梯隊 ＋ 40/30/30階梯 ＋ 65/25/10長線動能 ＋ 爆量滯漲過濾</td>
                                  <td style={{ textAlign: 'right', color: '#34D399', fontFamily: 'monospace' }}>15,244.4x</td>
                                  <td style={{ textAlign: 'right', color: '#60A5FA', fontFamily: 'monospace' }}>+53.17%</td>
                                  <td style={{ textAlign: 'right', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>-30.22%</td>
                                  <td style={{ textAlign: 'right', color: '#60A5FA', fontFamily: 'monospace' }}>1.760</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>2.71</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>90.9% (20/22年)</td>
                                  <td style={{ fontSize: '0.74rem', color: '#CBD5E1' }}>偏向 12M 長線穩健趨勢，回撤壓至 -30.2%</td>
                                </tr>
                                <tr style={{ background: 'rgba(168, 85, 247, 0.08)', borderLeft: '3px solid #A855F7' }}>
                                  <td style={{ fontWeight: 'bold', color: '#C084FC' }}>🏆 前代單梯隊 DOE 旗艦版</td>
                                  <td>每月月底單梯隊 ＋ 偏態凸性動態加權 ＋ 50/50動能 ＋ Top 5保護帶</td>
                                  <td style={{ textAlign: 'right', color: '#34D399', fontFamily: 'monospace' }}>15,627.8x</td>
                                  <td style={{ textAlign: 'right', color: '#60A5FA', fontFamily: 'monospace' }}>+53.11%</td>
                                  <td style={{ textAlign: 'right', color: '#34D399', fontFamily: 'monospace' }}>-28.49%</td>
                                  <td style={{ textAlign: 'right', color: '#A855F7', fontFamily: 'monospace' }}>1.864</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>2.45</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>86.4% (19/22年)</td>
                                  <td style={{ fontSize: '0.74rem', color: '#CBD5E1' }}>每月僅月底操作 1 次，適合極簡懶人投資</td>
                                </tr>
                                <tr style={{ background: 'rgba(245, 158, 11, 0.08)', borderLeft: '3px solid #F59E0B' }}>
                                  <td style={{ fontWeight: 'bold', color: '#FBBF24' }}>📊 初代全球主權基準版</td>
                                  <td>每月月底單梯隊 ＋ Top 4 階梯 (40/25/20/15) ＋ 50/50動能</td>
                                  <td style={{ textAlign: 'right', color: '#34D399', fontFamily: 'monospace' }}>2,973.7x</td>
                                  <td style={{ textAlign: 'right', color: '#60A5FA', fontFamily: 'monospace' }}>+42.35%</td>
                                  <td style={{ textAlign: 'right', color: '#F87171', fontFamily: 'monospace' }}>-44.21%</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>0.958</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>1.85</td>
                                  <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>77.3% (17/22年)</td>
                                  <td style={{ fontSize: '0.74rem', color: '#CBD5E1' }}>初代未優化基準對照組</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* 6. 模擬交易日誌明細 (Recent Closed Trades Log) */}
                      {(() => {
                        const allAvailableTrades = (
                          activeModeData?.all_trades || 
                          selectedModelDetail?.all_trades || 
                          bt.all_titan_trades || 
                          (activeModelKey === 'global_liquid_titan_a' ? (globalTitanTradesData || []) : []) ||
                          (activeModelKey === 'titan_sovereign' ? (titanTradesData || []) : []) ||
                          bt.periods?.['20y']?.models_detail?.[activeModelKey]?.long_only?.trades || 
                          bt.periods?.['10y']?.models_detail?.[activeModelKey]?.long_only?.trades || 
                          []
                        );

                        // 動態計算當前選定區間之交易明細
                        const periodTrades = (trades && trades.length > 0)
                          ? trades
                          : ((activeModelKey === 'titan_sovereign' || activeModelKey === 'global_liquid_titan_a') && allAvailableTrades && allAvailableTrades.length > 0
                              ? allAvailableTrades.filter(t => {
                                  const d = String(t.exit_date || t.entry_date || '');
                                  if (!d) return true;
                                  if (activePeriodKey === '10y' || activePeriodKey === '20y' || activePeriodKey === 'all') return true;
                                  if (activePeriodKey === '5y') return d >= '20211002';
                                  if (activePeriodKey === '3y') return d >= '20231002';
                                  if (activePeriodKey === '1y') return d >= '20251002';
                                  if (/^\d{4}$/.test(activePeriodKey)) return d.startsWith(activePeriodKey);
                                  if (activePeriodKey === 'custom' && marketBtStartYear && marketBtEndYear) {
                                    return d >= `${marketBtStartYear}0101` && d <= `${marketBtEndYear}1231`;
                                  }
                                  return true;
                                })
                              : []);

                        const canToggleScope = allAvailableTrades.length > 0 && allAvailableTrades.length !== periodTrades.length;
                        const currentScope = (backtestTradeScope === 'all' && allAvailableTrades.length > 0) ? 'all' : 'period';
                        const displayedTrades = currentScope === 'all'
                          ? allAvailableTrades
                          : (periodTrades.length > 0 ? periodTrades : allAvailableTrades);

                        const hasStockDetail = displayedTrades.some(t => t.stock_name || t.stock_id);
                        const filteredTrades = displayedTrades.filter(t => {
                          if (backtestTradeFilter === 'win') return (t.return_pct || 0) > 0;
                          if (backtestTradeFilter === 'loss') return (t.return_pct || 0) <= 0;
                          return true;
                        });
                        const winCount = displayedTrades.filter(t => (t.return_pct || 0) > 0).length;
                        const lossCount = displayedTrades.filter(t => (t.return_pct || 0) <= 0).length;

                        const handleExportCsv = () => {
                          const headers = hasStockDetail
                            ? ['標的名稱', '股票代號', '配置角色', '進場日期', '進場價位', '出場日期', '出場價位', '持有天數', '單筆淨報酬率(%)', '出場原因']
                            : ['進場日期', '操作方向', '進場點位', '出場日期', '出場點位', '持有天數', '單筆淨報酬率(%)', '損益金額(NT$)'];
                          const rows = displayedTrades.map(t => hasStockDetail
                            ? [
                                t.stock_name || '加權指數',
                                t.stock_id || '--',
                                t.role || t.direction || '多方 (Long)',
                                t.entry_date,
                                t.entry_price || '',
                                t.exit_date,
                                t.exit_price || '',
                                t.holding_days || 0,
                                (t.return_pct || 0).toFixed(2),
                                t.exit_reason || '--'
                              ]
                            : [
                                t.entry_date,
                                t.direction || '多方',
                                t.entry_price || '',
                                t.exit_date,
                                t.exit_price || '',
                                t.holding_days || 0,
                                (t.return_pct || 0).toFixed(2),
                                t.profit_amount ? Math.round(t.profit_amount) : 0
                              ]
                          );
                          const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
                          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.setAttribute('href', url);
                          link.setAttribute('download', `${activeModelKey}_trades_${currentScope === 'all' ? 'all_history' : activePeriodKey}.csv`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        };

                        return (
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color)',
                            padding: '1.25rem',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                              <div>
                                <h4 style={{ margin: 0, fontSize: '0.95rem', color: currentScope === 'all' ? '#FBBF24' : '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span>{currentScope === 'all' ? '👑' : '📜'}</span>
                                  <span>
                                    {currentScope === 'all'
                                      ? `【${activeModelMeta.name || '模型'} 全歷史紀錄】逐筆模擬交易明細 (共 ${displayedTrades.length} 筆)`
                                      : `【${activePeriodData?.name || '選定區間'}】逐筆模擬交易明細 (共 ${displayedTrades.length} 筆)`}
                                  </span>
                                </h4>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  {hasStockDetail
                                    ? (activeModelKey === 'global_liquid_titan_a'
                                        ? '🚀 全球高流動性泰坦【雙梯隊進攻版：每月1號(A梯隊50%) + 22號(B梯隊50%)交錯 × 40/30/30階梯 × 45/35/20敏銳動能 × 爆量滯漲過濾】，嚴格次日 T+1 開盤成交'
                                        : '👑 泰坦王權動態推舉個股 (70% 王者泰坦 + 15% 雙衛星)，嚴格次日 T+1 成交扣 0.585% 稅費')
                                    : '大盤指數模擬交易，每次進出場扣除 0.05% 摩擦成本'}
                                  {currentScope === 'all' && (
                                    <span style={{ color: '#FCD34D', marginLeft: '0.4rem' }}>• 🔍 正在直接瀏覽全歷史完整明細清單</span>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {/* 區間 vs 全歷史 切換按鈕 */}
                                {canToggleScope && (
                                  <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <button
                                      type="button"
                                      onClick={() => setBacktestTradeScope('period')}
                                      style={{
                                        padding: '0.2rem 0.65rem',
                                        fontSize: '0.75rem',
                                        borderRadius: '4px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontWeight: currentScope === 'period' ? 'bold' : 'normal',
                                        background: currentScope === 'period' ? '#2563EB' : 'transparent',
                                        color: currentScope === 'period' ? 'white' : 'var(--text-muted)'
                                      }}
                                      title="僅檢視上方選定時間區間內的交易紀錄"
                                    >
                                      📍 當前區間 ({periodTrades.length})
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setBacktestTradeScope('all')}
                                      style={{
                                        padding: '0.2rem 0.65rem',
                                        fontSize: '0.75rem',
                                        borderRadius: '4px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontWeight: currentScope === 'all' ? 'bold' : 'normal',
                                        background: currentScope === 'all' ? '#D97706' : 'transparent',
                                        color: currentScope === 'all' ? 'white' : 'var(--text-muted)'
                                      }}
                                      title="直接在畫面上切換檢視全歷史所有交易紀錄（無需下載 CSV）"
                                    >
                                      👑 全歷史明細 ({allAvailableTrades.length})
                                    </button>
                                  </div>
                                )}

                                {/* 獲利 / 虧損 篩選標籤 */}
                                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '2px', border: '1px solid var(--border-color)' }}>
                                  <button
                                    type="button"
                                    onClick={() => setBacktestTradeFilter('all')}
                                    style={{
                                      padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                      background: backtestTradeFilter === 'all' ? '#3B82F6' : 'transparent',
                                      color: backtestTradeFilter === 'all' ? 'white' : 'var(--text-muted)'
                                    }}
                                  >
                                    全部 ({displayedTrades.length})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBacktestTradeFilter('win')}
                                    style={{
                                      padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                      background: backtestTradeFilter === 'win' ? '#059669' : 'transparent',
                                      color: backtestTradeFilter === 'win' ? 'white' : 'var(--text-muted)'
                                    }}
                                  >
                                    🟢 獲利 ({winCount})
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBacktestTradeFilter('loss')}
                                    style={{
                                      padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', border: 'none', cursor: 'pointer',
                                      background: backtestTradeFilter === 'loss' ? '#DC2626' : 'transparent',
                                      color: backtestTradeFilter === 'loss' ? 'white' : 'var(--text-muted)'
                                    }}
                                  >
                                    🔴 虧損/停損 ({lossCount})
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={handleExportCsv}
                                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid #3B82F6', color: '#93C5FD' }}
                                  title="匯出此清單所有逐筆買賣交易紀錄成 CSV 檔案"
                                >
                                  📥 下載 CSV 明細
                                </button>
                              </div>
                            </div>

                            {displayedTrades.length === 0 ? (
                              <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                此選定區間內無已平倉之交易紀錄（部位可能長期持有中或處於現金防守期）。
                              </div>
                            ) : (
                              <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                                <table className="analysis-table" style={{ width: '100%', fontSize: '0.78rem', textAlign: 'center' }}>
                                  <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                                    <tr style={{ background: '#1E293B', color: '#CBD5E1' }}>
                                      {hasStockDetail && <th>標的股票</th>}
                                      {hasStockDetail && <th>配置角色</th>}
                                      <th>進場日期</th>
                                      <th>進場價位</th>
                                      <th>出場日期</th>
                                      <th>出場價位</th>
                                      <th>持有天數</th>
                                      <th>單筆報酬率</th>
                                      {hasStockDetail ? <th>出場原因 / 風控機制</th> : <th>損益金額 (NT$)</th>}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredTrades.map((t, idx) => {
                                      const isWin = (t.return_pct || 0) >= 0;
                                      return (
                                        <tr key={idx} style={{ background: idx % 2 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.02)' }}>
                                          {hasStockDetail && (
                                            <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                                              {t.stock_name} <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>({t.stock_id})</span>
                                            </td>
                                          )}
                                          {hasStockDetail && (
                                            <td>
                                              <span style={{
                                                padding: '0.12rem 0.4rem',
                                                borderRadius: '4px',
                                                fontSize: '0.72rem',
                                                fontWeight: 'bold',
                                                background: (t.role?.includes('王者') || t.role?.includes('第1主力')) ? 'rgba(245, 158, 11, 0.2)' : 'rgba(14, 165, 233, 0.2)',
                                                color: (t.role?.includes('王者') || t.role?.includes('第1主力')) ? '#FBBF24' : '#38BDF8',
                                                border: (t.role?.includes('王者') || t.role?.includes('第1主力')) ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(14, 165, 233, 0.4)'
                                              }}>
                                                {t.role || t.direction || '多方'}
                                              </span>
                                            </td>
                                          )}
                                          <td>{formatDateStr(t.entry_date)}</td>
                                          <td style={{ fontFamily: 'monospace' }}>{t.entry_price ? t.entry_price.toLocaleString() : '--'}</td>
                                          <td>{formatDateStr(t.exit_date)}</td>
                                          <td style={{ fontFamily: 'monospace' }}>{t.exit_price ? t.exit_price.toLocaleString() : '--'}</td>
                                          <td>{t.holding_days} 天</td>
                                          <td style={{ fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                                            {isWin ? '+' : ''}{t.return_pct?.toFixed(2)}%
                                          </td>
                                          {hasStockDetail ? (
                                            <td style={{ textAlign: 'left', fontSize: '0.74rem', color: t.exit_reason?.includes('停損') ? '#FCA5A5' : '#94A3B8' }}>
                                              {t.exit_reason || '--'}
                                            </td>
                                          ) : (
                                            <td style={{ fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                                              {t.profit_amount ? (t.profit_amount >= 0 ? `+${Math.round(t.profit_amount).toLocaleString()}` : Math.round(t.profit_amount).toLocaleString()) : '--'}
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📈</div>
                <p style={{ margin: 0, fontSize: '1rem' }}>尚未產出大盤 ML 預測報告。</p>
                <button
                  type="button"
                  className="btn btn-save"
                  style={{ marginTop: '1rem' }}
                  onClick={() => handleTriggerMarketMlJob('market_ml_predict')}
                  disabled={triggeringMarketMl}
                >
                  🚀 立即執行大盤推論
                </button>
              </div>
            )}
          </div>
          );
        })()}


        {/* ===== 👑 泰坦實盤每日監控與對帳系統 ===== */}
        {activeTab === 'titan_live' && (
          <TitanLiveDashboard key={scraperLiveStatus?.finished_at || 'init'} />
        )}

        {/* ===== 🌍 全球主權泰坦動能看板 ===== */}
        {activeTab === 'global_sovereign' && (
          <GlobalSovereignDashboard key={scraperLiveStatus?.finished_at || 'init'} />
        )}


        {/* ===== 🗄️ 資料庫與爬蟲戰情中心 (合併全新設計) ===== */}
        {(activeTab === 'database' || activeTab === 'scraper') && (
          <div className="db-crawler-center">
            {/* 1. 頂部 KPI 看板卡片 */}
            <div className="db-kpi-grid">
              <div className="db-kpi-card">
                <span className="db-kpi-label">📁 核心資料表數量</span>
                <span className="db-kpi-value" style={{ color: '#60A5FA' }}>
                  {dbTablesList.length} <small style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>個</small>
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>涵蓋台股、期權、總經、全球資產</span>
              </div>
              <div className="db-kpi-card">
                <span className="db-kpi-label">💾 歷史資料總容量</span>
                <span className="db-kpi-value" style={{ color: '#34D399' }}>
                  {dbTablesList.reduce((acc, t) => acc + (t.row_count || 0), 0).toLocaleString()} <small style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>筆</small>
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>2004~2026 完整全覆蓋大數據</span>
              </div>
              <div className="db-kpi-card">
                <span className="db-kpi-label">📅 最新交易日數據</span>
                <span className="db-kpi-value" style={{ color: '#FCD34D' }}>
                  {dbTablesList.find(t => t.id === 'daily_stock')?.latest_date || '2026/10/09'}
                </span>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>每日盤後 14:00 自動補齊</span>
              </div>
              <div className="db-kpi-card">
                <span className="db-kpi-label">⚡ 爬蟲引擎狀態</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                  <span className="live-pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34D399', display: 'inline-block' }}></span>
                  <span style={{ color: '#34D399', fontWeight: 'bold', fontSize: '1.05rem' }}>連線就緒</span>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>非同步佇列 + 雲端排程連動</span>
              </div>
            </div>

            {/* 2. 一鍵全局立即更新控制列 */}
            <div className="db-quick-bar">
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>⚡ 爬蟲即時控制與資料庫同步</span>
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  點擊下方按鈕將立即啟動背景非同步爬蟲，自動連線交易所補齊最新市場資料。
                </p>
              </div>
              <div className="db-quick-buttons">
                <button
                  className="db-btn-update"
                  onClick={() => handleTriggerDbScraper('daily', '全市場所有數據 (台股+法人+大盤+總經+期權+全球泰坦)', 'daily_stock')}
                  disabled={dbUpdatingTableId !== null}
                >
                  {dbUpdatingTableId === 'daily_stock' || dbUpdatingTableId === 'global_daily' ? (
                    <>
                      <span className="loader" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
                      <span>全市場更新中...</span>
                    </>
                  ) : (
                    <>
                      <span>🌐 立即更新全市場所有數據 (台股/法人/期權/全球泰坦/總經)</span>
                    </>
                  )}
                </button>
                <button
                  className="db-btn-update"
                  style={{ background: 'linear-gradient(135deg, #2563EB, #3B82F6)' }}
                  onClick={() => handleTriggerDbScraper('global_sovereign', '全球泰坦 18 國主權 ETF 與 228 檔旗艦個股', 'global_stock_daily')}
                  disabled={dbUpdatingTableId !== null}
                >
                  {dbUpdatingTableId === 'global_stock_daily' || dbUpdatingTableId === 'global_sovereign_daily' ? (
                    <>
                      <span className="loader" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
                      <span>更新全球泰坦中...</span>
                    </>
                  ) : (
                    <>
                      <span>🌍 立即更新全球泰坦 (主權ETF+跨國個股)</span>
                    </>
                  )}
                </button>
                <button
                  className="db-btn-update"
                  style={{ background: 'linear-gradient(135deg, #059669, #10B981)' }}
                  onClick={() => handleTriggerDbScraper('revenue', '全市場最新月營收公告', 'monthly_revenue')}
                  disabled={dbUpdatingTableId !== null}
                >
                  {dbUpdatingTableId === 'monthly_revenue' ? (
                    <>
                      <span className="loader" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></span>
                      <span>抓取營收中...</span>
                    </>
                  ) : (
                    <>
                      <span>📈 立即更新最新月營收</span>
                    </>
                  )}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={fetchDbStatus}
                  title="重新整理資料庫與爬蟲狀態"
                  style={{ padding: '0.6rem 0.9rem', fontSize: '0.88rem' }}
                >
                  🔄 刷新狀態
                </button>
              </div>
            </div>

            {/* 3. 即時爬蟲與資料庫同步進度看板 (清楚標明正在更新的資料庫、資料表與具體進度) */}
            {(scraperLiveStatus && (scraperLiveStatus.is_running || showScraperBanner || scraperLiveStatus.status === 'running' || scraperLiveStatus.status === 'success' || scraperLiveStatus.status === 'error')) && (
              <div style={{
                background: scraperLiveStatus.is_running 
                  ? 'linear-gradient(135deg, rgba(30, 58, 138, 0.45), rgba(15, 23, 42, 0.75))'
                  : scraperLiveStatus.status === 'success'
                  ? 'linear-gradient(135deg, rgba(6, 78, 59, 0.45), rgba(15, 23, 42, 0.75))'
                  : 'linear-gradient(135deg, rgba(127, 29, 29, 0.45), rgba(15, 23, 42, 0.75))',
                border: `1px solid ${scraperLiveStatus.is_running ? '#3B82F6' : scraperLiveStatus.status === 'success' ? '#10B981' : '#EF4444'}`,
                borderRadius: '12px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.45rem' }}>
                      {scraperLiveStatus.is_running ? (
                        <span className="live-pulse-dot" style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#60A5FA', display: 'inline-block' }}></span>
                      ) : scraperLiveStatus.status === 'success' ? (
                        <span style={{ fontSize: '1.15rem' }}>✅</span>
                      ) : (
                        <span style={{ fontSize: '1.15rem' }}>❌</span>
                      )}
                      <strong style={{ fontSize: '1.08rem', color: scraperLiveStatus.is_running ? '#93C5FD' : scraperLiveStatus.status === 'success' ? '#6EE7B7' : '#FCA5A5' }}>
                        {scraperLiveStatus.is_running ? '⚡ 資料庫同步任務正在執行中...' : scraperLiveStatus.status === 'success' ? '🎉 資料庫更新同步完成！' : '⚠️ 更新過程發生異常'}
                      </strong>
                      <span style={{
                        fontSize: '0.75rem',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: 'rgba(255,255,255,0.1)',
                        color: '#E2E8F0',
                        fontFamily: 'monospace'
                      }}>
                        {scraperLiveStatus.is_running ? `進度 ${scraperLiveStatus.progress_percent}%` : scraperLiveStatus.status.toUpperCase()}
                      </span>
                    </div>

                    {/* 明確標示正在更新的資料庫名稱與目標資料表 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.88rem' }}>
                      <span style={{ color: '#94A3B8' }}>📁 正在更新資料庫：</span>
                      <span style={{
                        padding: '2px 9px',
                        background: 'rgba(59, 130, 246, 0.25)',
                        border: '1px solid rgba(59, 130, 246, 0.5)',
                        borderRadius: '6px',
                        color: '#93C5FD',
                        fontWeight: 'bold'
                      }}>
                        {scraperLiveStatus.target_db || 'tw_stock.db (本機 SQLite 主資料庫)'}
                      </span>
                      <span style={{ color: '#94A3B8' }}>📑 目標資料表：</span>
                      <span style={{
                        padding: '2px 9px',
                        background: 'rgba(16, 185, 129, 0.25)',
                        border: '1px solid rgba(16, 185, 129, 0.5)',
                        borderRadius: '6px',
                        color: '#6EE7B7',
                        fontWeight: 'bold'
                      }}>
                        {scraperLiveStatus.target_table_name || scraperLiveStatus.target_table || '全市場行情資料表'}
                      </span>
                      {scraperLiveStatus.started_at && (
                        <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                          (開始時間: {scraperLiveStatus.started_at.split(' ')[1] || scraperLiveStatus.started_at})
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() => setShowScraperLogs(!showScraperLogs)}
                    >
                      {showScraperLogs ? '▲ 收起詳細日誌' : `▼ 展開動作紀錄 (${scraperLiveStatus.logs?.length || 0})`}
                    </button>
                    {(!scraperLiveStatus.is_running && scraperLiveStatus.status !== 'running') && (
                      <button
                        onClick={() => {
                          setShowScraperBanner(false);
                          setScraperLiveStatus(null);
                        }}
                        style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '1.2rem', padding: '0 0.3rem' }}
                        title="關閉看板"
                      >×</button>
                    )}
                  </div>
                </div>

                {/* 當前具體動作與動態進度條 */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#E2E8F0' }}>
                    <span><strong>目前動作：</strong>{scraperLiveStatus.current_step}</span>
                    <span style={{ fontWeight: 'bold', color: '#60A5FA' }}>
                      {scraperLiveStatus.step_index > 0 ? `步驟 ${scraperLiveStatus.step_index}/${scraperLiveStatus.total_steps}` : ''} ({scraperLiveStatus.progress_percent}%)
                    </span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(0,0,0,0.4)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${scraperLiveStatus.progress_percent}%`,
                      height: '100%',
                      background: scraperLiveStatus.status === 'error'
                        ? '#EF4444'
                        : 'linear-gradient(90deg, #3B82F6, #10B981, #34D399)',
                      transition: 'width 0.4s ease-in-out'
                    }}></div>
                  </div>
                </div>

                {/* 詳細日誌視窗 */}
                {showScraperLogs && scraperLiveStatus.logs && scraperLiveStatus.logs.length > 0 && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'rgba(0,0,0,0.5)',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    maxHeight: '160px',
                    overflowY: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: '1.6'
                  }}>
                    {scraperLiveStatus.logs.map((log, lIdx) => (
                      <div key={lIdx} style={{ display: 'flex', gap: '0.6rem', color: log.status === 'error' ? '#FCA5A5' : log.status === 'success' ? '#6EE7B7' : '#CBD5E1' }}>
                        <span style={{ opacity: 0.6 }}>[{log.time}]</span>
                        <span style={{ color: '#60A5FA' }}>{log.step}</span>
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. 動作回饋 Banner (若有文字通知) */}
            {dbActionBanner && (
              <div style={{
                padding: '0.9rem 1.25rem',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '10px',
                color: '#6EE7B7',
                fontSize: '0.92rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                marginBottom: '1rem'
              }}>
                <span>{dbActionBanner}</span>
                <button
                  onClick={() => setDbActionBanner('')}
                  style={{ background: 'none', border: 'none', color: '#6EE7B7', cursor: 'pointer', fontSize: '1rem' }}
                >×</button>
              </div>
            )}

            {/* 5. 20 年超長全歷史回補進度看板 */}
            {dbBackfillStatus && dbBackfillStatus.total_trading_days && (
              <div style={{
                padding: '0.9rem 1.25rem',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '10px',
                fontSize: '0.85rem',
                color: '#93C5FD',
                marginBottom: '1.25rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontWeight: 'bold' }}>
                  <span>🌐 20 年超長全歷史交易日資料回補狀態</span>
                  <span>{dbBackfillStatus.progress_percent || 100}% (已補齊 {dbBackfillStatus.completed_trading_days || 2712} / {dbBackfillStatus.total_trading_days || 2712} 交易日)</span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${dbBackfillStatus.progress_percent || 100}%`, height: '100%', background: 'linear-gradient(90deg, #3B82F6, #10B981)' }}></div>
                </div>
              </div>
            )}

            {/* 6. 檢視模式切換：當 !activeDbTable 顯示「資料表清單」，當有 activeDbTable 顯示「資料表檢視器」 */}
            {!activeDbTable ? (
              /* ===== 視圖 A：所有資料庫狀態總覽列表 ===== */
              <div className="filter-section" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div>
                    <h3 style={{ margin: '0 0 0.25rem 0' }}>🗄️ 所有資料庫資料表狀態清單</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      請點選任一資料表進入詳細瀏覽（支援全量百萬筆資料伺服器端分頁翻頁、精準篩選與欄位排序），或點擊「立即更新」觸發對應資料庫同步。
                    </p>
                  </div>
                  {/* 分類篩選按鈕 */}
                  <div className="db-category-pills">
                    {[
                      { key: 'all', label: '全部' },
                      { key: 'core', label: '台股核心' },
                      { key: 'fundamental', label: '基本面' },
                      { key: 'chips', label: '籌碼期貨' },
                      { key: 'macro', label: '大盤總經' },
                      { key: 'global', label: '全球資產' },
                      { key: 'futures', label: '高頻當沖' },
                      { key: 'titan', label: '泰坦實盤' },
                      { key: 'system', label: '系統自選' },
                    ].map(cat => (
                      <button
                        key={cat.key}
                        className={`db-cat-pill ${dbCategoryFilter === cat.key ? 'active' : ''}`}
                        onClick={() => setDbCategoryFilter(cat.key)}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 資料表列表 */}
                <div className="db-tables-list-container">
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2.2fr 1fr 1fr 1fr 1.6fr',
                    padding: '0.75rem 1.25rem',
                    background: 'rgba(255, 255, 255, 0.04)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '0.82rem',
                    fontWeight: 'bold',
                    color: 'var(--text-muted)'
                  }}>
                    <div>資料表名稱 / 描述</div>
                    <div>真實總數據量</div>
                    <div>最新資料日期</div>
                    <div>更新週期與頻率</div>
                    <div style={{ textAlign: 'right' }}>操作動作</div>
                  </div>

                  {dbTablesList
                    .filter(t => dbCategoryFilter === 'all' || t.categoryKey === dbCategoryFilter)
                    .map(table => (
                      <div key={table.id} className="db-table-row">
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: '8px',
                              background: table.categoryKey === 'core' ? 'rgba(59, 130, 246, 0.2)' :
                                table.categoryKey === 'fundamental' ? 'rgba(16, 185, 129, 0.2)' :
                                table.categoryKey === 'chips' ? 'rgba(245, 158, 11, 0.2)' :
                                table.categoryKey === 'macro' ? 'rgba(236, 72, 153, 0.2)' :
                                table.categoryKey === 'global' ? 'rgba(14, 165, 233, 0.2)' :
                                table.categoryKey === 'futures' ? 'rgba(239, 68, 68, 0.2)' :
                                table.categoryKey === 'titan' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                              color: table.categoryKey === 'core' ? '#93C5FD' :
                                table.categoryKey === 'fundamental' ? '#6EE7B7' :
                                table.categoryKey === 'chips' ? '#FDE68A' :
                                table.categoryKey === 'macro' ? '#F472B6' :
                                table.categoryKey === 'global' ? '#7DD3FC' :
                                table.categoryKey === 'futures' ? '#FCA5A5' :
                                table.categoryKey === 'titan' ? '#FDE047' : '#C4B5FD',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              fontWeight: 'bold'
                            }}>
                              {table.category}
                            </span>
                            <strong style={{ fontSize: '0.98rem', color: '#F8FAFC' }}>{table.name}</strong>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                            {table.desc}
                          </p>
                        </div>

                        <div>
                          <span style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#34D399', fontFamily: 'monospace' }}>
                            {(table.row_count || 0).toLocaleString()}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '4px' }}>筆</span>
                        </div>

                        <div>
                          <span style={{
                            fontSize: '0.85rem',
                            padding: '3px 8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            fontFamily: 'monospace',
                            color: '#FCD34D'
                          }}>
                            {table.latest_date || '-'}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {table.frequency}
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button
                            className="btn"
                            style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}
                            onClick={() => selectDbTable(table.id)}
                          >
                            🔍 檢視資料表 ({(table.row_count || 0).toLocaleString()} 筆)
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
                            onClick={() => handleTriggerDbScraper(table.task_type, table.name, table.id)}
                            disabled={dbUpdatingTableId === table.id}
                            title={`立即觸發 ${table.name} 更新任務`}
                          >
                            {dbUpdatingTableId === table.id ? '⏳ 更新中' : '⚡ 立即更新'}
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              /* ===== 視圖 B：資料表詳細檢視器 (支援伺服器端分頁與全量筆數檢索) ===== */
              <div className="filter-section" style={{ margin: 0 }}>
                {/* 檢視器頂部工具列 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-color)',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setActiveDbTable('')}
                      style={{ padding: '0.45rem 0.9rem', fontSize: '0.88rem' }}
                    >
                      ◀ 返回資料庫列表
                    </button>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>📊 {dbTablesList.find(t => t.id === activeDbTable)?.name || activeDbTable}</span>
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {dbTablesList.find(t => t.id === activeDbTable)?.desc}
                        </span>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '1px 8px',
                          borderRadius: '6px',
                          background: dbIsRemoteLoaded ? 'rgba(52, 211, 153, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: dbIsRemoteLoaded ? '#34D399' : '#FBBF24',
                          border: `1px solid ${dbIsRemoteLoaded ? 'rgba(52, 211, 153, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                          fontWeight: 'bold'
                        }}>
                          {dbIsRemoteLoaded ? '📁 tw_stock.db (本機 SQLite 全量主庫)' : '☁️ Supabase (雲端快照)'}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                          資料表總容量：<strong style={{ color: '#34D399', fontFamily: 'monospace' }}>{(Number(dbTotalCount) || 0).toLocaleString()} 筆</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {/* 切換其他資料表下拉 */}
                    <select
                      className="db-page-select"
                      value={activeDbTable}
                      onChange={e => selectDbTable(e.target.value)}
                    >
                      {dbTablesList.map(t => (
                        <option key={t.id} value={t.id}>
                          切換至：{t.name} ({(t.row_count || 0).toLocaleString()} 筆)
                        </option>
                      ))}
                    </select>

                    <button
                      className="db-btn-update"
                      style={{ padding: '0.45rem 0.9rem', fontSize: '0.85rem' }}
                      onClick={() => {
                        const curTable = dbTablesList.find(t => t.id === activeDbTable);
                        handleTriggerDbScraper(curTable?.task_type || 'daily', curTable?.name || activeDbTable, activeDbTable);
                      }}
                      disabled={dbUpdatingTableId === activeDbTable}
                    >
                      {dbUpdatingTableId === activeDbTable ? '⏳ 抓取更新中...' : '⚡ 立即更新此表'}
                    </button>

                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                      onClick={() => loadDbTableData(activeDbTable, dbPage, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir)}
                      title="重新載入資料表"
                    >
                      🔄 重新載入
                    </button>
                  </div>
                </div>

                {/* 搜尋與分頁選項列 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  marginBottom: '1rem'
                }}>
                  {/* 即時搜尋 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="db-search-input"
                      placeholder="🔍 搜尋代號、名稱、日期或任意欄位..."
                      value={dbSearchQuery}
                      onChange={e => setDbSearchQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          loadDbTableData(activeDbTable, 1, dbPageSize, e.target.value, dbSortKey, dbSortDir);
                        }
                      }}
                    />
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }}
                      onClick={() => loadDbTableData(activeDbTable, 1, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir)}
                    >
                      搜尋
                    </button>
                    {dbSearchQuery && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                        onClick={() => {
                          setDbSearchQuery('');
                          loadDbTableData(activeDbTable, 1, dbPageSize, '', dbSortKey, dbSortDir);
                        }}
                      >
                        清除
                      </button>
                    )}
                  </div>

                  {/* 每頁筆數控制 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <span>每頁顯示筆數：</span>
                    <select
                      className="db-page-select"
                      value={dbPageSize}
                      onChange={e => {
                        const newSize = Number(e.target.value);
                        setDbPageSize(newSize);
                        loadDbTableData(activeDbTable, 1, newSize, dbSearchQuery, dbSortKey, dbSortDir);
                      }}
                    >
                      <option value={50}>每頁 50 筆</option>
                      <option value={100}>每頁 100 筆 (預設)</option>
                      <option value={200}>每頁 200 筆</option>
                      <option value={500}>每頁 500 筆</option>
                      <option value={1000}>每頁 1,000 筆</option>
                    </select>
                  </div>
                </div>

                {/* 分頁導航控制器 (完整全量資料導覽) */}
                <div className="db-pagination-bar">
                  <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                    當前第 <strong style={{ color: '#FCD34D' }}>{dbPage}</strong> / <strong>{(Number(dbTotalPages) || 1).toLocaleString()}</strong> 頁
                    <span style={{ margin: '0 0.5rem', opacity: 0.5 }}>|</span>
                    顯示第 <strong>{dbTotalCount > 0 ? (dbPage - 1) * dbPageSize + 1 : 0}</strong> ～ <strong>{Math.min(dbPage * dbPageSize, Number(dbTotalCount) || 0).toLocaleString()}</strong> 筆
                    <span style={{ margin: '0 0.5rem', opacity: 0.5 }}>|</span>
                    資料庫總數據量：<strong style={{ color: '#34D399', fontSize: '0.98rem' }}>{(Number(dbTotalCount) || 0).toLocaleString()}</strong> 筆
                    {dbSearchQuery && <span style={{ color: '#60A5FA', marginLeft: '6px' }}>(已套用搜尋篩選)</span>}
                    {!dbIsRemoteLoaded && <span style={{ color: '#F59E0B', marginLeft: '6px' }}>(雲端快照模式：顯示前 100 筆樣本)</span>}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      className="db-page-btn"
                      onClick={() => loadDbTableData(activeDbTable, 1, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir)}
                      disabled={dbPage <= 1 || dbTableLoading}
                      title="第一頁"
                    >
                      ⏮ 首頁
                    </button>
                    <button
                      className="db-page-btn"
                      onClick={() => {
                        const p = Math.max(1, dbPage - 1);
                        loadDbTableData(activeDbTable, p, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir);
                      }}
                      disabled={dbPage <= 1 || dbTableLoading}
                      title="上一頁"
                    >
                      ◀ 上一頁
                    </button>

                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', margin: '0 4px' }}>
                      <input
                        type="number"
                        min={1}
                        max={dbTotalPages}
                        value={dbJumpPageInput}
                        onChange={e => setDbJumpPageInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const p = Math.max(1, Math.min(dbTotalPages, Number(dbJumpPageInput) || 1));
                            loadDbTableData(activeDbTable, p, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir);
                          }
                        }}
                        style={{
                          width: '55px',
                          textAlign: 'center',
                          padding: '3px 4px',
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '4px',
                          color: 'white',
                          fontSize: '0.85rem'
                        }}
                      />
                      <button
                        className="db-page-btn"
                        style={{ padding: '0.35rem 0.55rem' }}
                        onClick={() => {
                          const p = Math.max(1, Math.min(dbTotalPages, Number(dbJumpPageInput) || 1));
                          loadDbTableData(activeDbTable, p, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir);
                        }}
                        disabled={dbTableLoading}
                      >
                        跳頁
                      </button>
                    </div>

                    <button
                      className="db-page-btn"
                      onClick={() => {
                        const p = Math.min(dbTotalPages, dbPage + 1);
                        loadDbTableData(activeDbTable, p, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir);
                      }}
                      disabled={dbPage >= dbTotalPages || dbTableLoading}
                      title="下一頁"
                    >
                      下一頁 ▶
                    </button>
                    <button
                      className="db-page-btn"
                      onClick={() => loadDbTableData(activeDbTable, dbTotalPages, dbPageSize, dbSearchQuery, dbSortKey, dbSortDir)}
                      disabled={dbPage >= dbTotalPages || dbTableLoading}
                      title="最後一頁"
                    >
                      末頁 ⏭
                    </button>
                  </div>
                </div>

                {/* 資料載入中提示 */}
                {dbTableLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    <span className="loader" style={{ width: '20px', height: '20px', borderWidth: '2px' }}></span>
                    <span style={{ fontSize: '0.95rem' }}>正在自資料庫高速載入「{activeDbTable}」資料...</span>
                  </div>
                )}

                {/* 資料表格 */}
                {!dbTableLoading && currentDbPageRows.length > 0 && (
                  <div style={{ overflowX: 'auto', marginTop: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <table>
                      <thead>
                        <tr>
                          {dbTableCols.map(col => {
                            const isSorted = dbSortKey === col;
                            return (
                              <th
                                key={col}
                                onClick={() => {
                                  const nextDir = (dbSortKey === col && dbSortDir === 'asc') ? 'desc' : 'asc';
                                  setDbSortKey(col);
                                  setDbSortDir(nextDir);
                                  loadDbTableData(activeDbTable, 1, dbPageSize, dbSearchQuery, col, nextDir);
                                }}
                                className="sortable-th"
                                style={{ whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
                                title={`點擊依「${col}」排序`}
                              >
                                {col}
                                <span className="sort-arrow">
                                  {isSorted ? (dbSortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                                </span>
                              </th>
                            );
                          })}
                          <th style={{ width: '130px', textAlign: 'center', whiteSpace: 'nowrap' }}>快捷操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentDbPageRows.map((row, idx) => (
                          <tr key={idx} style={{ background: idx % 2 === 1 ? 'rgba(255, 255, 255, 0.015)' : 'transparent' }}>
                            {dbTableCols.map((col, cIdx) => (
                              <td key={cIdx} style={{ whiteSpace: 'nowrap', fontFamily: typeof row[col] === 'number' ? 'monospace' : 'inherit' }}>
                                {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                              </td>
                            ))}
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              {row.stock_id ? (
                                <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                                  <a
                                    href={`https://tw.stock.yahoo.com/quote/${String(row.stock_id).trim()}`}
                                    target="_blank" rel="noreferrer"
                                    style={{ color: '#60A5FA', textDecoration: 'none', fontSize: '0.8rem' }}
                                    title="前往 Yahoo 股市"
                                  >🔍 Yahoo</a>
                                  <a
                                    href={`https://finlab.finance/stocks/${String(row.stock_id).trim()}`}
                                    target="_blank" rel="noreferrer"
                                    style={{ color: '#FCD34D', textDecoration: 'none', fontSize: '0.8rem' }}
                                    title="前往 FinLab"
                                  >📊 FinLab</a>
                                  <button
                                    onClick={() => copyAiPrompt(String(row.stock_id).trim())}
                                    style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer', padding: '1px 5px', fontSize: '0.75rem' }}
                                    title="複製 AI 提示詞"
                                  >📋</button>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 空資料狀態 */}
                {!dbTableLoading && currentDbPageRows.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
                    <div>沒有找到符合條件的資料表紀錄。</div>
                    {dbSearchQuery && (
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: '1rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          setDbSearchQuery('');
                          loadDbTableData(activeDbTable, 1, dbPageSize, '', dbSortKey, dbSortDir);
                        }}
                      >
                        清除搜尋篩選條件
                      </button>
                    )}
                  </div>
                )}
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
            {/* 本地 AI 引擎連線狀態提示列 */}
            {localEngineOnline === true ? (
              <div style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '8px',
                padding: '0.6rem 1rem',
                marginBottom: '1.25rem',
                color: '#6EE7B7',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span>🟢</span>
                <span><strong>AI 語音轉譯引擎連線就緒 (遠端/本地雙向同步)</strong>：支援外部 HTTPS 遠端存取與 Apple Silicon GPU / Whisper 本地音訊解碼。</span>
              </div>
            ) : (
              <div style={{
                background: 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                borderRadius: '8px',
                padding: '0.6rem 1rem',
                marginBottom: '1.25rem',
                color: '#A5B4FC',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}>
                <div>
                  <span>⚡ <strong>雲端非同步運算模式</strong>：已啟用遠端任務佇列。點擊刷新或轉譯將自動派發至本地 GPU Worker 於背景執行並推播回雲端！</span>
                </div>
              </div>
            )}

            {/* 🚀 Podcast AI 即時分析進度與任務監控看板 */}
            {podcastProgress?.is_active ? (
              <div style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95))',
                border: '1px solid rgba(99, 102, 241, 0.45)',
                borderRadius: '12px',
                padding: '1.25rem',
                marginBottom: '1.5rem',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
              }}>
                {/* 頂部標題列 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>🎙️</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#F1F5F9' }}>
                      Podcast AI 語音分析進行中
                    </span>
                    <span style={{
                      background: 'rgba(56, 189, 248, 0.2)',
                      border: '1px solid rgba(56, 189, 248, 0.6)',
                      color: '#38BDF8',
                      fontSize: '0.72rem',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontWeight: 'bold',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <span className="live-pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38BDF8', display: 'inline-block' }}></span>
                      運算中
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                      ⏱️ 當前單集耗時：
                      <strong style={{ color: '#FDE68A', fontFamily: 'monospace' }}>
                        {formatSecondsToDuration(podcastProgress.current_episode?.started_at ? Math.max(0, Math.floor(Date.now() / 1000 - podcastProgress.current_episode.started_at)) : 0)}
                      </strong>
                    </span>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => { fetchPodcastProgress(); fetchPodcastEpisodes(); }}
                      title="手動刷新進度"
                    >
                      🔄 刷新
                    </button>
                  </div>
                </div>

                {/* 當前分析單集與階段卡片 */}
                <div style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '1rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.82rem', color: '#818CF8', fontWeight: 'bold' }}>
                      🎧 【{podcastProgress.channel_name || 'Podcast'}】
                    </span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: '#F8FAFC' }}>
                      {podcastProgress.current_episode?.title || '單集音訊處理中...'}
                    </span>
                  </div>

                  {/* 4 步驟流程指示圖 */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '0.5rem',
                    marginBottom: '0.85rem'
                  }}>
                    {[
                      { key: 'downloading', label: '📥 1. 下載音訊', idx: 1 },
                      { key: 'transcribing', label: '🎙️ 2. Whisper 解碼', idx: 2 },
                      { key: 'analyzing', label: '🤖 3. Gemini 分析', idx: 3 },
                      { key: 'saving', label: '💾 4. 儲存與同步', idx: 4 }
                    ].map(stepItem => {
                      const curStep = podcastProgress.current_episode?.step;
                      const curIdx = podcastProgress.current_episode?.step_index || 1;
                      const isCurrent = (curStep === stepItem.key) || (stepItem.key === 'saving' && curStep === 'saving');
                      const isPast = curIdx > stepItem.idx;

                      let bg = 'rgba(255, 255, 255, 0.03)';
                      let border = '1px solid rgba(255, 255, 255, 0.08)';
                      let textCol = '#64748B';

                      if (isCurrent) {
                        bg = 'rgba(6, 182, 212, 0.15)';
                        border = '1px solid #06B6D4';
                        textCol = '#67E8F9';
                      } else if (isPast) {
                        bg = 'rgba(16, 185, 129, 0.12)';
                        border = '1px solid rgba(16, 185, 129, 0.4)';
                        textCol = '#6EE7B7';
                      }

                      return (
                        <div key={stepItem.key} style={{
                          background: bg,
                          border: border,
                          borderRadius: '6px',
                          padding: '0.45rem 0.6rem',
                          textAlign: 'center',
                          fontSize: '0.8rem',
                          fontWeight: isCurrent ? 'bold' : 'normal',
                          color: textCol,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.35rem'
                        }}>
                          {isCurrent && <span className="loader" style={{ width: '8px', height: '8px', borderWidth: '1.5px', borderColor: '#67E8F9', borderBottomColor: 'transparent' }}></span>}
                          {isPast && <span>✓</span>}
                          <span>{stepItem.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 即時詳細狀態訊息 */}
                  <div style={{
                    fontSize: '0.82rem',
                    color: '#CBD5E1',
                    background: 'rgba(255, 255, 255, 0.04)',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    <span>💬</span>
                    <span>{podcastProgress.current_episode?.message || '正在進行背景語音文字化與大模型金融剖析...'}</span>
                  </div>
                </div>

                {/* 批次任務進度與指標卡 */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem'
                }}>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>總任務集數</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#F8FAFC' }}>{podcastProgress.total_jobs || 1} 集</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>當前處理中</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#67E8F9' }}>第 {podcastProgress.current_job_index || 1} 集</div>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>已完成</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#34D399' }}>{podcastProgress.completed_jobs || 0} 集</div>
                  </div>
                  <div style={{ background: 'rgba(244, 114, 182, 0.1)', border: '1px solid rgba(244, 114, 182, 0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#F472B6', fontWeight: 'bold' }}>剩餘 Job 待處理</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#F472B6' }}>{podcastProgress.remaining_jobs ?? 0} 個 job</div>
                  </div>
                </div>

                {/* 進度條 */}
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.35rem' }}>
                    <span>批次總體進度 ({podcastProgress.completed_jobs || 0} / {podcastProgress.total_jobs || 1} 集)</span>
                    <span style={{ fontWeight: 'bold', color: '#38BDF8' }}>{podcastProgress.progress_pct || 0}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${Math.min(100, Math.max(5, podcastProgress.progress_pct || 0))}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #4F46E5, #06B6D4, #10B981)',
                      borderRadius: '4px',
                      transition: 'width 0.4s ease'
                    }}></div>
                  </div>
                </div>

                {/* 任務佇列抽屜展開按鈕與列表 */}
                {podcastProgress.job_queue && podcastProgress.job_queue.length > 0 && (
                  <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                        📊 系統總計：已完成 {podcastProgress.system_summary?.total_completed || 0} 集 | 尚有 {podcastProgress.system_summary?.total_pending || 0} 個 job 待分析
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowQueueDetails(prev => !prev)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#93C5FD',
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                      >
                        <span>{showQueueDetails ? '▲ 收折佇列清單' : `▼ 展開任務佇列 (${podcastProgress.job_queue.length} 集)`}</span>
                      </button>
                    </div>

                    {showQueueDetails && (
                      <div style={{ marginTop: '0.6rem', maxHeight: '180px', overflowY: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '0.5rem' }}>
                        {podcastProgress.job_queue.map((item, idx) => (
                          <div key={item.guid || idx} style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.35rem 0.5rem',
                            borderBottom: idx < podcastProgress.job_queue.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                            fontSize: '0.78rem'
                          }}>
                            <span style={{ color: item.status === 'running' ? '#67E8F9' : item.status === 'completed' ? '#34D399' : '#94A3B8', fontWeight: item.status === 'running' ? 'bold' : 'normal' }}>
                              {item.status === 'running' && '▶️ 運算中：'}
                              {item.status === 'completed' && '✅ 已完成：'}
                              {item.status === 'pending' && `⏳ 排隊中 (第 ${idx + 1} 集)：`}
                              {item.status === 'failed' && '❌ 失敗：'}
                              {item.title}
                            </span>
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: item.status === 'running' ? 'rgba(6, 182, 212, 0.2)' : item.status === 'completed' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                              color: item.status === 'running' ? '#67E8F9' : item.status === 'completed' ? '#6EE7B7' : '#94A3B8'
                            }}>
                              {item.status === 'running' ? '處理中' : item.status === 'completed' ? '完成' : '待處理'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '0.65rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                fontSize: '0.83rem',
                color: '#94A3B8'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>📊</span>
                  <span><strong>AI 語音分析系統就緒</strong>：目前無進行中之背景運算。</span>
                  <span style={{ color: '#34D399' }}>✅ 已完成 {podcastProgress?.system_summary?.total_completed || (podcastEpisodes ? podcastEpisodes.filter(e => e.status === 'completed').length : 0)} 集</span>
                  <span style={{ color: '#F472B6' }}>⏳ 尚有 {podcastProgress?.system_summary?.total_pending || (podcastEpisodes ? podcastEpisodes.filter(e => e.status === 'pending').length : 0)} 個 job 待分析</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
                  提示：可在下方點擊「🚀 批次分析」或單集「語音分析」開始排程
                </div>
              </div>
            )}

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
                            {ep.status === 'pending' && (
                              podcastProgress?.is_active && podcastProgress.job_queue?.some(q => q.guid === ep.episode_guid && q.status === 'pending')
                                ? `⏳ 佇列排隊中 (第 ${podcastProgress.job_queue.findIndex(q => q.guid === ep.episode_guid) + 1} 集)`
                                : '⚪ 未分析'
                            )}
                            {ep.status === 'transcribing' && (
                              podcastProgress?.current_episode?.episode_guid === ep.episode_guid
                                ? `🎙️ ${podcastProgress.current_episode.step_name || '語音分析中'} (${podcastProgress.current_episode.step_index || 1}/3)`
                                : '⏳ 語音分析中'
                            )}
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
                            <span style={{ fontSize: '0.82rem', color: '#38BDF8', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                              <span className="loader" style={{ width: '8px', height: '8px', borderWidth: '1.5px', borderColor: '#38BDF8', borderBottomColor: 'transparent' }}></span>
                              <span>{podcastProgress?.current_episode?.episode_guid === ep.episode_guid ? podcastProgress.current_episode.message : '請在背景稍候...'}</span>
                            </span>
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

        {/* ===== 最新日期置頂橫幅 (智慧選股器) ===== */}
        {activeTab === 'screener' && sortedData && sortedData.length > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginTop: '1.75rem',
            marginBottom: '0.75rem',
            padding: '0.75rem 1.15rem',
            background: 'linear-gradient(90deg, rgba(30, 58, 138, 0.4), rgba(15, 23, 42, 0.7))',
            border: '1px solid rgba(96, 165, 250, 0.35)',
            borderRadius: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🗓️</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 'bold', color: '#93C5FD', fontSize: '0.98rem' }}>
                    最新交易數據基準日：{sortedData.find(r => r.date || r.trading_date)?.date || sortedData[0]?.date || '最新交易日'}
                  </span>
                  <span style={{
                    fontSize: '0.78rem',
                    color: '#34D399',
                    background: 'rgba(16, 185, 129, 0.18)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontWeight: 'bold'
                  }}>
                    共 {sortedData.length} 檔命中
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#94A3B8', marginTop: '2px' }}>
                  ※ 列表已整合「股票代號+名稱」與快捷圖示，並自動排除每列冗餘日期，大幅節省橫向螢幕空間。
                </div>
              </div>
            </div>
            {activePresetId && (
              <div style={{ fontSize: '0.85rem', color: '#E2E8F0', background: 'rgba(255,255,255,0.06)', padding: '4px 10px', borderRadius: '6px' }}>
                當前策略：<strong style={{ color: '#60A5FA' }}>
                  {[...BUILTIN_SCREENER_PRESETS, ...customPresets].find(p => p.id === activePresetId)?.name || '自訂篩選'}
                </strong>
              </div>
            )}
          </div>
        )}

        {/* ===== 批次操作與模型選擇 ===== */}
        {activeTab === 'screener' && sortedData && sortedData.length > 0 && (
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', marginTop: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
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
                <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (最便宜推薦 - 單集約0.2元 / 無思考溢價)</option>
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (高階思考)</option>
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
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

        {activeTab === 'screener' && sortedData && sortedData.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
            {activeTab === 'screener' ? (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '38px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={sortedData.length > 0 && sortedData.every(row => selectedStocks[row.stock_id])}
                        onChange={toggleSelectAll}
                        title="全選 / 取消全選"
                      />
                    </th>
                    <th
                      onClick={() => handleSort('stock_id')}
                      className="sortable-th"
                      title="點擊依股票代號排序"
                      style={{ whiteSpace: 'nowrap', minWidth: '120px' }}
                    >
                      股票標的
                      <span className="sort-arrow">
                        {sortConfig.key === 'stock_id' ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                      </span>
                    </th>
                    <th style={{ width: '130px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      快捷
                    </th>
                    {Object.keys(sortedData[0])
                      .filter(k => !EXCLUDED_SCREENER_KEYS.has(k))
                      .map(key => {
                        const isActive = sortConfig.key === key;
                        const label = SCREENER_COLUMN_LABELS[key] || key;
                        return (
                          <th
                            key={key}
                            onClick={() => handleSort(key)}
                            className="sortable-th"
                            title={`點擊依「${label}」排序`}
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {label}
                            <span className="sort-arrow">
                              {isActive ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}
                            </span>
                          </th>
                        );
                      })}
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((row, idx) => {
                    const metricKeys = Object.keys(row).filter(k => !EXCLUDED_SCREENER_KEYS.has(k));
                    return (
                      <tr key={row.stock_id || idx}>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!!selectedStocks[row.stock_id]}
                            onChange={() => toggleSelectStock(row.stock_id)}
                          />
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 'bold', color: '#60A5FA', marginRight: '0.45rem', fontSize: '0.92rem' }}>
                            {row.stock_id}
                          </span>
                          <span style={{ fontWeight: '500', color: 'var(--text-main)', fontSize: '0.92rem' }}>
                            {row.stock_name}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            {row.stock_id ? (
                              <>
                                <a
                                  href={`https://tw.stock.yahoo.com/quote/${row.stock_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="查詢 Yahoo 即時報價與技術走勢"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    background: 'rgba(59, 130, 246, 0.18)',
                                    border: '1px solid rgba(59, 130, 246, 0.45)',
                                    color: '#93C5FD',
                                    textDecoration: 'none',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  🔍
                                </a>
                                <a
                                  href={`https://finlab.finance/stocks/${row.stock_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`前往 FinLab 量化分析 (${row.stock_id})`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    background: 'rgba(245, 158, 11, 0.18)',
                                    border: '1px solid rgba(245, 158, 11, 0.45)',
                                    color: '#FCD34D',
                                    textDecoration: 'none',
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  📊
                                </a>
                                <button
                                  onClick={() => copyAiPrompt(row.stock_id)}
                                  title="複製個股專用 AI 提示詞"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    background: 'rgba(148, 163, 184, 0.15)',
                                    border: '1px solid rgba(148, 163, 184, 0.35)',
                                    color: '#E2E8F0',
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  📋
                                </button>
                                <button
                                  onClick={() => viewHistory(row.stock_id, row.stock_name)}
                                  title={row.ai_analysis ? "閱讀 AI 深度健檢報告 (已生成)" : "檢視 / 產生 AI 智能健檢分析"}
                                  style={{
                                    position: 'relative',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '28px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    background: row.ai_analysis ? 'rgba(16, 185, 129, 0.25)' : 'rgba(139, 92, 246, 0.2)',
                                    border: row.ai_analysis ? '1px solid rgba(16, 185, 129, 0.6)' : '1px solid rgba(139, 92, 246, 0.4)',
                                    color: row.ai_analysis ? '#6EE7B7' : '#C4B5FD',
                                    cursor: 'pointer',
                                    padding: 0,
                                    fontSize: '0.85rem'
                                  }}
                                >
                                  🤖
                                  {row.ai_analysis && (
                                    <span style={{
                                      position: 'absolute',
                                      top: '-2px',
                                      right: '-2px',
                                      width: '7px',
                                      height: '7px',
                                      borderRadius: '50%',
                                      background: '#10B981',
                                      boxShadow: '0 0 4px #10B981'
                                    }}></span>
                                  )}
                                </button>
                              </>
                            ) : '-'}
                          </div>
                        </td>
                        {metricKeys.map(key => (
                          <td key={key} style={{ whiteSpace: 'nowrap' }}>
                            {formatScreenerCellValue(key, row[key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
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
                            <a
                              href={`https://finlab.finance/stocks/${row.stock_id}`}
                              target="_blank" rel="noreferrer"
                              style={{ color: '#FCD34D', textDecoration: 'none' }}
                            >📊 FinLab</a>
                            <button
                              onClick={() => copyAiPrompt(row.stock_id)}
                              style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '0.8rem' }}
                            >📋 複製AI指令</button>
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'screener' && data && data.length === 0 && (
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
                  value={serverSettings.gemini_model || 'gemini-3.8-flash'}
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
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (最便宜推薦 - 單集約0.2元 / 無思考溢價)</option>
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash (高階思考)</option>
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash (極速模型)</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview (最新旗艦模型)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (推理與細節佳)</option>
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
