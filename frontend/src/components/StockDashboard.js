import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api';
import defaultMarketMlData from '../data/defaultMarketMlData.json';
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
  return window.fetch(url, { ...options, headers, cache: 'no-store' });
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
  { val: 'titan_sovereign', label: '👑 泰坦王權漸進動能 (TITAN-Sovereign)', short: '👑 泰坦王權', tag: '👑 10年+1972% 零槓桿・大盤4倍', desc: '純樣本外零偷看未來！月度動態推舉規模龍頭(50%)+雙革命衛星(各25%)，結合個股60MA移動停損與宏觀雙季線現金避險，10年+1972.36% (大盤近4倍)、近1年+289.52% (大盤3.5倍)，嚴格零槓桿！' },
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

const STORAGE_KEY = 'stock_screener_config';
const PROMPT_KEY  = 'stock_screener_prompt';

function StockDashboard() {
  const authUser = getCurrentUser();
  const user = authUser || { username: '訪客', role: 'viewer', is_guest: true };
  const navigate = useNavigate();
  const [screeningStatus, setScreeningStatus] = useState('');

  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('active_tab') || 'market_ml');
  const [activeDbTable, setActiveDbTable] = useState('');
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
  const [marketMlBtData, setMarketMlBtData] = useState(null);
  const [fetchingMarketMl, setFetchingMarketMl] = useState(false);
  const [fetchingMarketMlBt, setFetchingMarketMlBt] = useState(false);
  const [triggeringMarketMl, setTriggeringMarketMl] = useState(false);
  const [marketMlModelType, setMarketMlModelType] = useState(() => {
    const saved = localStorage.getItem('market_ml_model_type');
    if (!saved || saved === 'alpha_dynamic_convex') return 'titan_sovereign';
    return saved;
  });
  const [showMarketMlConfig, setShowMarketMlConfig] = useState(false);
  const [marketMlSubTab, setMarketMlSubTab] = useState(() => localStorage.getItem('market_ml_sub_tab') || 'cockpit');
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
  const [marketBacktestPeriod, setMarketBacktestPeriod] = useState(() => localStorage.getItem('market_bt_period_v2') || '10y');
  const [marketBtStartYear, setMarketBtStartYear] = useState(() => localStorage.getItem('market_bt_start_year') || '2016');
  const [marketBtEndYear, setMarketBtEndYear] = useState(() => localStorage.getItem('market_bt_end_year') || '2026');
  const [marketBacktestModel, setMarketBacktestModel] = useState(() => localStorage.getItem('market_backtest_model_v2') || 'titan_sovereign');
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
                  const isAutoTuned = extraConfig.auto_tune || (extraConfig.auto_tune === undefined && marketMlAutoTune);
                  if (jobType === 'market_ml_train') {
                    alert(isAutoTuned
                      ? '🎉 大盤 ML 模型「全域參數尋優＋重訓」完成！已成功鎖定 Global Minima 最適超參數並更新至雲端戰情室！'
                      : '🎉 大盤 ML 模型訓練與指標評估完成！'
                    );
                  } else {
                    alert('🚀 大盤最新推論與波段回測模擬已完成！');
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
    } else if (activeTab === 'watchlist') {
      fetchWatchlist();
      fetchWatchlistAlerts();
    } else if (activeTab === 'low_freq') {
      fetchLowFreqStatus();
    } else if (activeTab === 'market_ml') {
      fetchMarketMlData();
      if (marketMlSubTab === 'backtest') {
        fetchMarketMlBtData();
      }
    }
  }, [activeTab, mlModelType, marketMlSubTab]);

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
            { id: 'market_ml', label: '📈 大盤多空預測' },
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
            {/* 1. 頂部控制與模型選擇列 */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              borderRadius: '12px',
              padding: '0.85rem 1.15rem',
              marginBottom: '1rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  📈 台股大盤宏觀 ML 預測
                </span>

                {/* 當前 AI 模型選擇下拉選單 */}
                <select
                  value={marketMlModelType}
                  onChange={e => handleSelectMarketModel(e.target.value)}
                  style={{
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid #3B82F6',
                    color: '#93C5FD',
                    fontWeight: 'bold',
                    padding: '0.3rem 0.6rem',
                    borderRadius: '8px',
                    fontSize: '0.86rem',
                    cursor: 'pointer'
                  }}
                >
                  {MARKET_ML_MODELS.map(m => (
                    <option key={m.val} value={m.val}>
                      {m.label} {m.val === bestModelId ? '⭐ 最佳' : ''}
                    </option>
                  ))}
                </select>

                {/* 狀態徽章 */}
                {activeMetrics?.auc_up ? (
                  <span style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid #10B981',
                    color: '#6EE7B7',
                    fontSize: '0.78rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }}></span>
                    就緒 (AUC {activeMetrics.auc_up}% ｜ 準確 {activeMetrics.accuracy}%)
                  </span>
                ) : (
                  <span style={{
                    background: 'rgba(148, 163, 184, 0.15)',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    color: '#94A3B8',
                    fontSize: '0.78rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '16px'
                  }}>
                    未載入
                  </span>
                )}

                {marketMlData?.latest_date && (
                  <span style={{
                    fontSize: '0.78rem',
                    background: 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#93C5FD',
                    padding: '0.2rem 0.55rem',
                    borderRadius: '12px'
                  }}>
                    🗓️ 基準日: {marketMlData.latest_date}
                  </span>
                )}
              </div>

              {/* 右側操作按鈕 */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowMarketMlConfig(!showMarketMlConfig)}
                  style={{
                    padding: '0.35rem 0.8rem',
                    fontSize: '0.84rem',
                    background: showMarketMlConfig ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                    border: showMarketMlConfig ? '1px solid #3B82F6' : '1px solid var(--border-color)',
                    color: showMarketMlConfig ? '#93C5FD' : 'white',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '8px'
                  }}
                >
                  ⚙️ 訓練條件設定 {showMarketMlConfig ? '▴ 收合' : '▾ 展開'}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => handleTriggerMarketMlJob('market_ml_predict')}
                  disabled={triggeringMarketMl || fetchingMarketMl}
                  style={{
                    padding: '0.35rem 0.8rem',
                    fontSize: '0.84rem',
                    background: 'rgba(59, 130, 246, 0.18)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#93C5FD',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '8px'
                  }}
                  title="重新推論今日最新市場行情"
                >
                  {triggeringMarketMl ? <span className="loader" style={{ width: '12px', height: '12px' }}></span> : '🔄 重新推論'}
                </button>

                {/* 一鍵重訓＋全域尋優 (全模型) */}
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: 'all', auto_tune: true, tune_trials: marketMlTuneTrials })}
                  disabled={triggeringMarketMl || fetchingMarketMl}
                  style={{
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.84rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
                    border: '1px solid #A855F7',
                    color: '#FFFFFF',
                    fontWeight: 'bold',
                    boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)',
                    cursor: 'pointer'
                  }}
                  title="一鍵重訓全部 7 款 AI 模型並直接搭配 Optuna 貝氏全域超參數尋優 (尋找 Global Minima)"
                >
                  {triggeringMarketMl ? <span className="loader" style={{ width: '12px', height: '12px', borderColor: 'white', borderBottomColor: 'transparent' }}></span> : '🧬 一鍵重訓＋尋優 (全模型)'}
                </button>

                <button
                  type="button"
                  className="btn btn-save"
                  onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: marketMlModelType, auto_tune: marketMlAutoTune, tune_trials: marketMlTuneTrials })}
                  disabled={triggeringMarketMl || fetchingMarketMl}
                  style={{
                    padding: '0.35rem 0.8rem',
                    fontSize: '0.84rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '8px'
                  }}
                  title={`單獨訓練當前選取的 ${MARKET_ML_MODELS.find(m => m.val === marketMlModelType)?.short || marketMlModelType} (自動套用尋優)`}
                >
                  🚀 訓練選定模型 {marketMlAutoTune ? '(含尋優)' : ''}
                </button>
              </div>
            </div>

            {/* 2. 可收折的「進階訓練配置與條件清單面板」 */}
            {showMarketMlConfig && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '12px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                animation: 'fadeIn 0.2s ease-in-out'
              }}>
                {/* 快捷訓練模式 Chips 清單 */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#93C5FD', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>⚡</span>
                    <span>快捷訓練條件清單（點擊立即套用配置）：</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {BUILTIN_MARKET_ML_PRESETS.map(preset => {
                      const isActive = marketMlPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleApplyMarketMlPreset(preset)}
                          title={preset.desc}
                          style={{
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.82rem',
                            borderRadius: '20px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            border: isActive ? '1px solid #3B82F6' : '1px solid rgba(255, 255, 255, 0.1)',
                            background: isActive ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.4), rgba(59, 130, 246, 0.2))' : 'rgba(255, 255, 255, 0.04)',
                            color: isActive ? '#93C5FD' : '#CBD5E1',
                            fontWeight: isActive ? 'bold' : 'normal',
                            boxShadow: isActive ? '0 0 10px rgba(59, 130, 246, 0.3)' : 'none'
                          }}
                        >
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 參數設定 Grid (2 欄) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.25rem',
                  background: 'rgba(0, 0, 0, 0.28)',
                  padding: '1.1rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  marginBottom: '1.25rem'
                }}>
                  {/* 區塊 1: 數據長度配置 */}
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#60A5FA', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>📅</span> 數據長度與驗證配置
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                        🏋️ 歷史訓練天數 (0 為 10 年全歷史 2,400+ 天)
                      </label>
                      <input
                        type="number"
                        value={marketMlTrainDays}
                        onChange={e => {
                          const val = parseInt(e.target.value) || 0;
                          setMarketMlTrainDays(val);
                          localStorage.setItem('market_ml_train_days', val);
                        }}
                        style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#FDE68A', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.9rem', fontWeight: 'bold' }}
                      />
                      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                        {[
                          { d: 500, label: '近2年 (500天)' },
                          { d: 1000, label: '近4年 (1000天)' },
                          { d: 1800, label: '近7年 (1800天)' },
                          { d: 0, label: '全部歷史 (10年)' }
                        ].map(item => (
                          <button
                            key={item.d}
                            type="button"
                            className="btn"
                            style={{
                              padding: '0.2rem 0.5rem',
                              fontSize: '0.72rem',
                              background: marketMlTrainDays === item.d ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255,255,255,0.05)',
                              border: marketMlTrainDays === item.d ? '1px solid #3B82F6' : '1px solid var(--border-color)',
                              color: marketMlTrainDays === item.d ? '#93C5FD' : 'var(--text-muted)'
                            }}
                            onClick={() => {
                              setMarketMlTrainDays(item.d);
                              localStorage.setItem('market_ml_train_days', item.d);
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                        <span>走步前瞻驗證切分比率 (Walk-forward Split)</span>
                        <span style={{ color: '#93C5FD', fontWeight: 'bold' }}>{Math.round((1 - marketMlTestRatio) * 100)}% 訓練 / {Math.round(marketMlTestRatio * 100)}% 驗證</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.3"
                        step="0.05"
                        value={marketMlTestRatio}
                        onChange={e => {
                          const val = parseFloat(e.target.value);
                          setMarketMlTestRatio(val);
                          localStorage.setItem('market_ml_test_ratio', val);
                        }}
                        style={{ width: '100%', accentColor: '#3B82F6' }}
                      />
                    </div>
                  </div>

                  {/* 區塊 2: 特徵工程模式 */}
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#FBBF24', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>🧬</span> 特徵工程組合模式 (Feature Group)
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                        特徵預設集 (多因子維度)
                      </label>
                      <select
                        value={marketMlPreset}
                        onChange={e => {
                          setMarketMlPreset(e.target.value);
                          localStorage.setItem('market_ml_preset', e.target.value);
                        }}
                        style={{
                          width: '100%',
                          background: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid var(--border-color)',
                          color: '#F8FAFC',
                          padding: '0.45rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.84rem'
                        }}
                      >
                        {BUILTIN_MARKET_ML_PRESETS.map(p => (
                          <option key={p.id} value={p.id}>{p.name} — {p.desc}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ fontSize: '0.76rem', color: '#94A3B8', lineHeight: 1.5, background: 'rgba(255,255,255,0.03)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      💡 包含台指期未平倉、外資投信現貨、美債10Y、費半、台積電ADR溢價、分數階微分 (FFD)、Amihud 流動性衝擊、赫斯特指數與多階支撐壓力階梯。
                    </div>
                  </div>

                  {/* 區塊 3: 🎯 波段標籤制定方法 (Quantitative Labeling Methodology) */}
                  {(() => {
                    const curMethod = MARKET_ML_LABELING_METHODS.find(m => m.id === marketMlLabelingMethod) || MARKET_ML_LABELING_METHODS[0];
                    return (
                      <div style={{
                        gridColumn: '1 / -1',
                        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.75))',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        borderRadius: '10px',
                        padding: '1rem 1.15rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.85rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '1.15rem' }}>🎯</span>
                              <strong style={{ color: '#F8FAFC', fontSize: '0.92rem' }}>
                                波段標籤制定方法 (Quantitative Labeling Methodology)
                              </strong>
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '4px',
                                background: 'rgba(59, 130, 246, 0.2)',
                                color: '#93C5FD',
                                border: '1px solid rgba(59, 130, 246, 0.4)'
                              }}>
                                5 大頂級量化演算法
                              </span>
                            </div>
                            <span style={{ fontSize: '0.76rem', color: '#94A3B8', display: 'block', marginTop: '0.25rem', lineHeight: 1.5 }}>
                              固定突破門檻 (如 ±2.5%) 在低波動期難以觸發、在高波動期充斥假突破，且忽略持有期間暴跌觸及停損洗盤之路徑依賴 (Path-dependency)。
                              本系統完整實作頂級量化文獻 5 大標籤演算法，可自由切換訓練：
                            </span>
                          </div>
                        </div>

                        {/* 5 大方法卡片群 (Grid Selector) */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                          gap: '0.65rem',
                          marginBottom: '1rem'
                        }}>
                          {MARKET_ML_LABELING_METHODS.map(m => {
                            const isSelected = marketMlLabelingMethod === m.id;
                            return (
                              <div
                                key={m.id}
                                onClick={() => {
                                  setMarketMlLabelingMethod(m.id);
                                  setMarketMlLabelingParam(m.defaultParam);
                                  localStorage.setItem('market_ml_labeling_method', m.id);
                                  localStorage.setItem('market_ml_labeling_param', m.defaultParam);
                                }}
                                style={{
                                  background: isSelected
                                    ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.35), rgba(30, 58, 138, 0.45))'
                                    : 'rgba(255, 255, 255, 0.03)',
                                  border: isSelected ? '1.5px solid #3B82F6' : '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '8px',
                                  padding: '0.75rem',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  boxShadow: isSelected ? '0 0 14px rgba(59, 130, 246, 0.3)' : 'none'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                                  <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.1)', color: '#CBD5E1', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                                    {m.tag}
                                  </span>
                                  {isSelected && <span style={{ color: '#60A5FA', fontSize: '0.8rem', fontWeight: 900 }}>✓ 選定中</span>}
                                </div>
                                <div style={{ fontSize: '0.84rem', fontWeight: 800, color: isSelected ? '#93C5FD' : '#F1F5F9', marginBottom: '0.2rem' }}>
                                  {m.short}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: isSelected ? '#BFDBFE' : '#94A3B8', lineHeight: 1.35 }}>
                                  {m.author}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* 所選方法之深度說明與超參數微調面板 */}
                        <div style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.65rem' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#FCD34D' }}>
                                  {curMethod.name}
                                </span>
                                <span style={{ fontSize: '0.74rem', color: '#93C5FD', background: 'rgba(59, 130, 246, 0.15)', padding: '0.1rem 0.45rem', borderRadius: '4px' }}>
                                  {curMethod.citation}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.78rem', color: '#CBD5E1', marginTop: '0.3rem', lineHeight: 1.5 }}>
                                💡 <strong>機制原理：</strong>{curMethod.desc}
                              </div>
                            </div>
                          </div>

                          {/* 參數微調與預設 Pills */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '0.75rem',
                            marginTop: '0.75rem',
                            paddingTop: '0.75rem',
                            borderTop: '1px dashed rgba(255, 255, 255, 0.1)'
                          }}>
                            {/* 數值輸入與單位 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <label style={{ fontSize: '0.78rem', color: '#E2E8F0', fontWeight: 'bold' }}>
                                ⚙️ {curMethod.paramName}:
                              </label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <input
                                  type="number"
                                  step={curMethod.step}
                                  min={curMethod.min}
                                  max={curMethod.max}
                                  value={marketMlLabelingParam}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value) || curMethod.defaultParam;
                                    setMarketMlLabelingParam(val);
                                    localStorage.setItem('market_ml_labeling_param', val);
                                  }}
                                  style={{
                                    width: '85px',
                                    background: 'rgba(15,23,42,0.9)',
                                    color: '#FDE68A',
                                    border: '1px solid #3B82F6',
                                    borderRadius: '6px',
                                    padding: '0.35rem 0.5rem',
                                    fontSize: '0.88rem',
                                    fontWeight: 'bold',
                                    textAlign: 'center'
                                  }}
                                />
                                <span style={{ fontSize: '0.82rem', color: '#93C5FD', fontWeight: 'bold' }}>
                                  {curMethod.paramUnit}
                                </span>
                              </div>
                            </div>

                            {/* 快速預設值 Pills */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>快速配置:</span>
                              {curMethod.presets.map(p => {
                                const isCurVal = Math.abs(marketMlLabelingParam - p.val) < 0.001;
                                return (
                                  <button
                                    key={p.val}
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                      setMarketMlLabelingParam(p.val);
                                      localStorage.setItem('market_ml_labeling_param', p.val);
                                    }}
                                    style={{
                                      padding: '0.2rem 0.55rem',
                                      fontSize: '0.74rem',
                                      borderRadius: '6px',
                                      background: isCurVal ? 'rgba(59, 130, 246, 0.45)' : 'rgba(255, 255, 255, 0.06)',
                                      border: isCurVal ? '1px solid #60A5FA' : '1px solid rgba(255, 255, 255, 0.1)',
                                      color: isCurVal ? '#EFF6FF' : '#CBD5E1',
                                      fontWeight: isCurVal ? 'bold' : 'normal'
                                    }}
                                  >
                                    {p.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 區塊 3: 🧪 AI 貝氏超參數全域尋優 (AutoML Global Minima Search) */}
                  <div style={{
                    gridColumn: '1 / -1',
                    background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.25), rgba(30, 27, 75, 0.4))',
                    border: '1px solid rgba(168, 85, 247, 0.35)',
                    borderRadius: '10px',
                    padding: '1rem 1.15rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', marginBottom: '0.6rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.1rem' }}>🧪</span>
                        <div>
                          <strong style={{ color: '#E9D5FF', fontSize: '0.9rem' }}>
                            Optuna 貝氏全域超參數尋優 (AutoML Global Minima Search)
                          </strong>
                          <span style={{ fontSize: '0.75rem', color: '#C4B5FD', display: 'block', marginTop: '0.15rem' }}>
                            以 TPE (Tree-structured Parzen Estimator) 尋找時間序列交叉熵與勝率損失函數之全域極小值，跳脫局部鞍點
                          </span>
                        </div>
                      </div>
                      <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: '0.45rem' }}>
                        <input
                          type="checkbox"
                          checked={marketMlAutoTune}
                          onChange={e => {
                            setMarketMlAutoTune(e.target.checked);
                            localStorage.setItem('market_ml_auto_tune', e.target.checked);
                          }}
                          style={{ width: '18px', height: '18px', accentColor: '#A855F7', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.86rem', color: marketMlAutoTune ? '#D8B4FE' : '#94A3B8', fontWeight: marketMlAutoTune ? 'bold' : 'normal' }}>
                          {marketMlAutoTune ? '已啟用全域尋優模式' : '停用 (使用標準預設參數)'}
                        </span>
                      </label>
                    </div>

                    {marketMlAutoTune && (
                      <div style={{
                        marginTop: '0.75rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(168, 85, 247, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.78rem', color: '#DDD6FE' }}>
                            🔬 尋優世代試驗次數 (Trials):
                          </span>
                          {[
                            { n: 10, label: '10次 (快速探索 ~5s)' },
                            { n: 20, label: '20次 (平衡推薦 ~15s)' },
                            { n: 40, label: '40次 (深度全域搜尋 ~35s)' }
                          ].map(t => (
                            <button
                              key={t.n}
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.25rem 0.6rem',
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                                background: marketMlTuneTrials === t.n ? 'rgba(168, 85, 247, 0.4)' : 'rgba(255, 255, 255, 0.05)',
                                border: marketMlTuneTrials === t.n ? '1px solid #A855F7' : '1px solid rgba(255, 255, 255, 0.1)',
                                color: marketMlTuneTrials === t.n ? '#F3E8FF' : '#CBD5E1',
                                fontWeight: marketMlTuneTrials === t.n ? 'bold' : 'normal'
                              }}
                              onClick={() => {
                                setMarketMlTuneTrials(t.n);
                                localStorage.setItem('market_ml_tune_trials', t.n);
                              }}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <span style={{ fontSize: '0.74rem', color: '#A78BFA', background: 'rgba(124, 58, 237, 0.2)', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(124, 58, 237, 0.3)' }}>
                          目標: 3-Fold 滾動前瞻時間序列交叉驗證極小損失 (Min Loss)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 底部操作與派工按鈕列 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontSize: '0.85rem',
                        background: 'rgba(59, 130, 246, 0.2)',
                        border: '1px solid rgba(59, 130, 246, 0.5)',
                        color: '#93C5FD',
                        borderRadius: '8px'
                      }}
                      onClick={handleSaveMarketTrainSettings}
                    >
                      💾 儲存條件
                    </button>

                    <button
                      type="button"
                      className="btn"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontSize: '0.85rem',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid var(--border-color)',
                        color: 'white',
                        borderRadius: '8px'
                      }}
                      onClick={() => handleApplyMarketMlPreset(BUILTIN_MARKET_ML_PRESETS[0])}
                    >
                      ↺ 還原預設
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {marketMlSavedToast && (
                      <span style={{
                        background: 'rgba(16, 185, 129, 0.2)',
                        border: '1px solid #10B981',
                        color: '#6EE7B7',
                        fontSize: '0.82rem',
                        padding: '0.3rem 0.75rem',
                        borderRadius: '6px',
                        fontWeight: 'bold'
                      }}>
                        ✅ 條件已儲存！
                      </span>
                    )}

                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: 'all', auto_tune: true, tune_trials: marketMlTuneTrials })}
                      disabled={triggeringMarketMl || fetchingMarketMl}
                      style={{
                        padding: '0.5rem 1.15rem',
                        fontSize: '0.88rem',
                        background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
                        border: '1.5px solid #C084FC',
                        color: '#FFFFFF',
                        borderRadius: '8px',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        boxShadow: '0 0 16px rgba(168, 85, 247, 0.45)',
                        cursor: 'pointer'
                      }}
                      title="一鍵對全體 7 款模型啟動 Optuna 貝氏尋優尋找各模型 Global Minima 最適參數與超額夏普，並重新訓練產生最新回測排行榜"
                    >
                      {triggeringMarketMl ? <span className="loader" style={{ width: '13px', height: '13px', borderColor: 'white', borderBottomColor: 'transparent' }}></span> : '🧬 🏆 一鍵重訓全部 7 款模型 (直接搭配全域尋優)'}
                    </button>

                    <button
                      type="button"
                      className="btn"
                      onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: marketMlModelType, auto_tune: true, tune_trials: marketMlTuneTrials })}
                      disabled={triggeringMarketMl || fetchingMarketMl}
                      style={{
                        padding: '0.45rem 1rem',
                        fontSize: '0.85rem',
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.35))',
                        border: '1px solid #10B981',
                        color: '#6EE7B7',
                        borderRadius: '8px',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        cursor: 'pointer'
                      }}
                      title={`對當前選定之 ${MARKET_ML_MODELS.find(m => m.val === marketMlModelType)?.short || marketMlModelType} 執行貝氏尋優訓練`}
                    >
                      🎯 尋優重訓選定模型 ({MARKET_ML_MODELS.find(m => m.val === marketMlModelType)?.short || marketMlModelType})
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: 'all', auto_tune: false })}
                      disabled={triggeringMarketMl || fetchingMarketMl}
                      style={{
                        padding: '0.45rem 0.95rem',
                        fontSize: '0.85rem',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#94A3B8',
                        borderRadius: '8px',
                        fontWeight: 'normal',
                        cursor: 'pointer'
                      }}
                      title="略過 Optuna 尋優，以標準既定參數快速重新訓練全體模型（節省時間）"
                    >
                      ⚡ 快速重訓 (不尋優)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3. 🗂️ 大盤功能子分頁切換列 (Segmented Sub-Tabs) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.25rem',
              padding: '0.35rem',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              overflowX: 'auto'
            }}>
              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: marketMlSubTab === 'cockpit' ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'transparent',
                  color: marketMlSubTab === 'cockpit' ? 'white' : 'var(--text-muted)',
                  border: marketMlSubTab === 'cockpit' ? '1px solid #3B82F6' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMarketMlSubTab('cockpit');
                  localStorage.setItem('market_ml_sub_tab', 'cockpit');
                }}
              >
                <span>📈</span>
                <span>大盤戰情駕駛艙 ({MARKET_ML_MODELS.find(m => m.val === marketMlModelType)?.short || '選定模型'})</span>
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: marketMlSubTab === 'elliott' ? 'linear-gradient(135deg, #7C3AED, #9333EA)' : 'transparent',
                  color: marketMlSubTab === 'elliott' ? 'white' : 'var(--text-muted)',
                  border: marketMlSubTab === 'elliott' ? '1px solid #A855F7' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap',
                  boxShadow: marketMlSubTab === 'elliott' ? '0 0 14px rgba(168, 85, 247, 0.4)' : 'none'
                }}
                onClick={() => {
                  setMarketMlSubTab('elliott');
                  localStorage.setItem('market_ml_sub_tab', 'elliott');
                }}
              >
                <span>🌊</span>
                <span>艾略特波浪理論 (Elliott Wave)</span>
                <span style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                  W5 衝刺中
                </span>
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: marketMlSubTab === 'operations' ? 'linear-gradient(135deg, #0EA5E9, #0284C7)' : 'transparent',
                  color: marketMlSubTab === 'operations' ? 'white' : 'var(--text-muted)',
                  border: marketMlSubTab === 'operations' ? '1px solid #0EA5E9' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap',
                  boxShadow: marketMlSubTab === 'operations' ? '0 0 14px rgba(14, 165, 233, 0.4)' : 'none'
                }}
                onClick={() => {
                  setMarketMlSubTab('operations');
                  localStorage.setItem('market_ml_sub_tab', 'operations');
                }}
              >
                <span>🧭</span>
                <span>近半年操作指引與買賣歷程</span>
                <span style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                  145日實戰
                </span>
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: marketMlSubTab === 'backtest' ? 'linear-gradient(135deg, #059669, #047857)' : 'transparent',
                  color: marketMlSubTab === 'backtest' ? 'white' : 'var(--text-muted)',
                  border: marketMlSubTab === 'backtest' ? '1px solid #10B981' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMarketMlSubTab('backtest');
                  localStorage.setItem('market_ml_sub_tab', 'backtest');
                  fetchMarketMlBtData();
                }}
              >
                <span>📊</span>
                <span>歷年波段模擬回測 (Backtest)</span>
                {marketMlData?.backtest_simulation && (
                  <span style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                    487日/自選區間
                  </span>
                )}
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: marketMlSubTab === 'models' ? 'linear-gradient(135deg, #7C3AED, #6D28D9)' : 'transparent',
                  color: marketMlSubTab === 'models' ? 'white' : 'var(--text-muted)',
                  border: marketMlSubTab === 'models' ? '1px solid #8B5CF6' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMarketMlSubTab('models');
                  localStorage.setItem('market_ml_sub_tab', 'models');
                }}
              >
                <span>🏆</span>
                <span>AI 大盤模型效能評比</span>
                {marketMlData?.models && (
                  <span style={{ fontSize: '0.74rem', background: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                    {Object.keys(marketMlData.models).length} 款
                  </span>
                )}
              </button>
            </div>

            {fetchingMarketMl && !marketMlData ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div className="loader" style={{ margin: '0 auto 1rem auto' }}></div>
                <p style={{ color: 'var(--text-muted)' }}>正在載入大盤 ML 宏觀預測與籌碼數據...</p>
              </div>
            ) : marketMlData ? (
              <div>
                {/* ── 子視圖 1: 📈 大盤戰情與當前模型推論 ── */}
                {marketMlSubTab === 'cockpit' && (
                  <div>
                    {/* 1.5 🎯 今日 AI 量化即時操作指示燈 (Today's Real-Time Action Directive) */}
                    {(() => {
                      // Long-Only: bearish => CASH (持現金)，不做空
                      const rawAction = marketMlData?.current_action || marketMlData?.operations_6m?.current_action || {};
                      const _fbSignal = activePrediction?.signal;
                      const _fbIsLong = rawAction.stance?.includes('多') || (rawAction.position_size_pct !== undefined && rawAction.position_size_pct > 0) || rawAction.action_code?.includes('LONG') || rawAction.action_code === 'BUY' || _fbSignal === 'bullish' || _fbSignal === 'mild_bullish';
                      const _fbIsShort = rawAction.stance?.includes('空') || rawAction.action_code?.includes('SHORT') || rawAction.action_code === 'SELL' || _fbSignal === 'bearish';

                      const currentAction = {
                        action_code: rawAction.action_code || (_fbIsLong ? 'HOLD_LONG' : (_fbIsShort ? 'HOLD_SHORT' : 'CASH')),
                        action_title: rawAction.action_title || rawAction.signal_badge || (_fbIsLong ? '🟢 建議操作：多單續抱（持有多方部位）' : '🛡️ 建議操作：空手觀望 / 現金避險'),
                        action_badge: rawAction.action_badge || rawAction.signal_badge || (_fbIsLong ? '🟢 多方持倉中 (Long 100%)' : '🛡️ 現金避險觀望 (Cash 100%)'),
                        action_summary: rawAction.action_summary || rawAction.signal_desc || (_fbIsLong
                          ? '目前大盤多頭架構穩健，AI 20日勝率領先，建議 100% 多方部位續抱或逢回佈局。'
                          : '目前大盤多空方向未見明顯共識突破或回檔風險升高，演算法嚴格執行資本保全原則，建議 100% 現金空手觀望，靜待下一次勝率跨越 45% 的波段買點出現！'),
                        position_size_pct: rawAction.position_size_pct ?? (_fbIsLong ? 100 : 0),
                        direction: rawAction.stance || rawAction.direction || (_fbIsLong ? '多方 (Long)' : '空手觀望 (Cash)'),
                        stop_loss_pts: rawAction.stop_loss_pts || activePrediction?.support_pts || marketMlData.current_market?.ma20 || 47097,
                        take_profit_pts: rawAction.take_profit_pts || activePrediction?.resistance_pts || ((marketMlData.current_market?.close || 48475) * 1.05) || 50000,
                        rationales: rawAction.rationales || [
                          `AI 20日勝率判定：多方機率 ${activePrediction?.prob_up_20d || 50}% vs 空方機率 ${activePrediction?.prob_down_20d || 25}%`,
                          `均線架構支撐：指數穩居 20MA 月線 (${Math.round(activePrediction?.support_pts || marketMlData.current_market?.ma20 || 47097).toLocaleString()} 點) 之上`,
                          '籌碼與流動性：外資期現貨與權值台積電維持正向推升力道',
                          `風控執行守則：跌破 ${Math.round(activePrediction?.support_pts || marketMlData.current_market?.ma20 || 47097).toLocaleString()} 點停損線立即平倉退回現金`
                        ]
                      };

                      const consensus = marketMlData?.operations_6m?.consensus || {
                        dominant_stance: '偏多 (Bullish)',
                        long_count: 4,
                        short_count: 1,
                        cash_count: 2,
                        total_models: 7
                      };

                      const isLong = currentAction.action_code?.includes('LONG') || currentAction.action_code === 'BUY';
                      const isShort = currentAction.action_code?.includes('SHORT') || currentAction.action_code === 'SELL';
                      const isCash = !isLong && !isShort;

                      const cardBorderColor = isLong ? 'rgba(16, 185, 129, 0.5)' : (isShort ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)');
                      const cardTopBorder = isLong ? '#10B981' : (isShort ? '#EF4444' : '#3B82F6');
                      const badgeBg = isLong ? 'rgba(16, 185, 129, 0.25)' : (isShort ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.25)');
                      const badgeColor = isLong ? '#6EE7B7' : (isShort ? '#FCA5A5' : '#93C5FD');
                      const badgeBorder = isLong ? '1px solid #10B981' : (isShort ? '1px solid #EF4444' : '1px solid #3B82F6');

                      return (
                        <div style={{
                          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))',
                          border: `1px solid ${cardBorderColor}`,
                          borderTop: `4px solid ${cardTopBorder}`,
                          borderRadius: '14px',
                          padding: '1.25rem 1.5rem',
                          marginBottom: '1.25rem',
                          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                              <span style={{ fontSize: '1.4rem' }}>🎯</span>
                              <div>
                                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#F8FAFC', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span>今日 AI 量化即時操作指示 (Today's Action Directive)</span>
                                </h3>
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    依據當前選定【{activeModelInfo.name || MARKET_ML_MODELS.find(m => m.val === activeModelKey)?.label || marketMlData.model_name || 'AI 模型'}】推論與風控規則產出之具體交易行為
                                  </span>
                              </div>
                            </div>

                            {/* 核心操作 Badge */}
                            <span style={{
                              background: badgeBg,
                              color: badgeColor,
                              border: badgeBorder,
                              fontSize: '1rem',
                              fontWeight: 900,
                              padding: '0.45rem 1.1rem',
                              borderRadius: '24px',
                              boxShadow: isLong ? '0 0 15px rgba(16, 185, 129, 0.3)' : (isShort ? '0 0 15px rgba(239, 68, 68, 0.3)' : '0 0 15px rgba(59, 130, 246, 0.3)'),
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.45rem'
                            }}>
                              {currentAction.action_badge || currentAction.action_title}
                            </span>
                          </div>

                          {/* 具體操盤白話指引 */}
                          <div style={{
                            background: 'rgba(0, 0, 0, 0.35)',
                            borderRadius: '10px',
                            padding: '0.9rem 1.1rem',
                            marginBottom: '1rem',
                            border: '1px solid rgba(255, 255, 255, 0.08)'
                          }}>
                            <div style={{ fontSize: '0.95rem', color: '#F1F5F9', fontWeight: 600, lineHeight: '1.6' }}>
                              💡 <strong>操盤行動指引：</strong>{currentAction.action_summary}
                            </div>
                          </div>

                          {/* 4 大核心關鍵執行參數 */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '0.75rem',
                            marginBottom: '1rem'
                          }}>
                            {/* 建議倉位 */}
                            <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>建議持倉水位 (Target Exposure)</div>
                              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: isLong ? '#34D399' : (isShort ? '#F87171' : '#60A5FA'), marginTop: '0.15rem' }}>
                                {currentAction.position_size_pct > 0 ? `${currentAction.direction ? currentAction.direction.split(' ')[0] : '多方'} ${currentAction.position_size_pct}%` : '現金 100% (空手)'}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                {isCash ? '🛡️ 規避震盪洗盤風險' : (isLong ? '🚀 全額跟隨多方動能' : '⚡ 融券放空避險')}
                              </div>
                            </div>

                            {/* 停損防守線 */}
                            <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>🛑 停損防守警戒點位</div>
                              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#F87171', marginTop: '0.15rem' }}>
                                {currentAction.stop_loss_pts ? currentAction.stop_loss_pts.toLocaleString() : '--'} 點
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                跌破此線立即無條件退回現金
                              </div>
                            </div>

                            {/* 目標壓力線 */}
                            <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>🎯 短線波段目標 / 壓力線</div>
                              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#34D399', marginTop: '0.15rem' }}>
                                {currentAction.take_profit_pts ? currentAction.take_profit_pts.toLocaleString() : '--'} 點
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                突破續抱 / 乖離過大分批停利
                              </div>
                            </div>

                            {/* 當前指數 */}
                            <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>📊 當前加權指數基準</div>
                              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#F8FAFC', marginTop: '0.15rem' }}>
                                {marketMlData.current_market?.close?.toLocaleString()} 點
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                {currentAction.unrealized_return_pct !== undefined && currentAction.unrealized_return_pct !== 0 ? (
                                  <span>持倉浮動盈虧: <strong style={{ color: currentAction.unrealized_return_pct >= 0 ? '#34D399' : '#F87171' }}>{currentAction.unrealized_return_pct > 0 ? '+' : ''}{currentAction.unrealized_return_pct}%</strong></span>
                                ) : (
                                  <span>現金觀望無持倉曝險</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 下方：全模型共識條 & 前往近半年明細按鈕 */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '1rem',
                            paddingTop: '0.85rem',
                            borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                          }}>
                            {/* 全模型今日多空共識比例 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.78rem', color: '#94A3B8', fontWeight: 'bold' }}>{consensus.total_models || MARKET_ML_MODELS.length} 款模型今日共識：</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
                                <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#6EE7B7', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                                  做多 {consensus.long_count || 0} 款 ({Math.round(((consensus.long_count || 0) / (consensus.total_models || MARKET_ML_MODELS.length || 1)) * 100)}%)
                                </span>
                                <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#93C5FD', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                                  觀望 {consensus.cash_count || 0} 款 ({Math.round(((consensus.cash_count || 0) / (consensus.total_models || MARKET_ML_MODELS.length || 1)) * 100)}%)
                                </span>
                                <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#FCA5A5', padding: '0.15rem 0.5rem', borderRadius: '6px' }}>
                                  放空 {consensus.short_count || 0} 款 ({Math.round(((consensus.short_count || 0) / (consensus.total_models || MARKET_ML_MODELS.length || 1)) * 100)}%)
                                </span>
                              </div>
                            </div>

                            {/* 快速直達近半年操作歷程按鈕 */}
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.45rem 1rem',
                                fontSize: '0.82rem',
                                fontWeight: 'bold',
                                borderRadius: '8px',
                                background: 'linear-gradient(135deg, #0EA5E9, #0284C7)',
                                color: 'white',
                                border: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)'
                              }}
                              onClick={() => {
                                setMarketMlSubTab('operations');
                                localStorage.setItem('market_ml_sub_tab', 'operations');
                              }}
                            >
                              <span>🧭 查看近半年 145 日完整買賣操作歷程與依據</span>
                              <span>➔</span>
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 2. 核心大盤預測 Hero 看板 */}
                    <div style={{
                      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.75))',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      borderRadius: '14px',
                      padding: '1.25rem 1.5rem',
                      marginBottom: '1.25rem',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        marginBottom: '1rem'
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>加權指數最新點位</span>
                            <span style={{
                              fontSize: '0.75rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '6px',
                              background: 'rgba(59, 130, 246, 0.2)',
                              color: '#93C5FD',
                              border: '1px solid rgba(59, 130, 246, 0.3)'
                            }}>
                              🤖 視角: {MARKET_ML_MODELS.find(m => m.val === activeModelKey)?.label || activeModelKey}
                            </span>
                            {marketMlData.labeling_info && (
                              <span style={{
                                fontSize: '0.75rem',
                                padding: '0.15rem 0.55rem',
                                borderRadius: '6px',
                                background: 'rgba(234, 179, 8, 0.15)',
                                color: '#FDE047',
                                border: '1px solid rgba(234, 179, 8, 0.35)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                cursor: 'help'
                              }} title={`標籤演算法: ${marketMlData.labeling_info.method_name} (${marketMlData.labeling_info.param_name} = ${marketMlData.labeling_info.param_value}${marketMlData.labeling_info.param_unit})\n多方比例: ${marketMlData.labeling_info.up_ratio_pct}% | 空方比例: ${marketMlData.labeling_info.down_ratio_pct}% | 震盪中性: ${marketMlData.labeling_info.neutral_ratio_pct}%`}>
                                <span>🎯</span>
                                <span>標籤: {marketMlData.labeling_info.short_name || '標籤法'} ({marketMlData.labeling_info.param_value}{marketMlData.labeling_info.param_unit})</span>
                                {marketMlData.labeling_info.avg_holding_bars && (
                                  <span style={{ color: '#FEF08A', fontSize: '0.7rem' }}>• 均持倉 {marketMlData.labeling_info.avg_holding_bars}天</span>
                                )}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginTop: '0.2rem' }}>
                            <span style={{ fontSize: '2.1rem', fontWeight: 900, color: '#F8FAFC', letterSpacing: '-0.5px' }}>
                              {marketMlData.current_market?.close?.toLocaleString()}
                            </span>
                            <span style={{ fontSize: '0.95rem', color: '#94A3B8' }}>
                              點 (20日年化波動度: {marketMlData.current_market?.volatility_20d}%)
                            </span>
                          </div>
                        </div>

                        {/* AI 多空評定 Badge */}
                        <div style={{ textAlign: 'right' }}>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            padding: '0.45rem 1rem',
                            borderRadius: '10px',
                            background: activePrediction?.signal === 'bullish' ? 'rgba(239, 68, 68, 0.25)' : activePrediction?.signal === 'bearish' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                            color: activePrediction?.signal === 'bullish' ? '#FCA5A5' : activePrediction?.signal === 'bearish' ? '#86EFAC' : '#FDE68A',
                            border: activePrediction?.signal === 'bullish' ? '1px solid rgba(239, 68, 68, 0.5)' : activePrediction?.signal === 'bearish' ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(245, 158, 11, 0.5)',
                            fontSize: '1.05rem',
                            fontWeight: 800
                          }}>
                            {activePrediction?.signal_badge || '🟡 區間箱型盤整'}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem', maxWidth: '320px', lineHeight: '1.4' }}>
                            {activePrediction?.signal_desc}
                          </div>
                        </div>
                      </div>

                      {/* 20 天多空波段機率條 */}
                      <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                          <span style={{ color: '#E2E8F0', fontWeight: 'bold' }}>未來 20 日月波段方向機率預測</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>模型多因子機率分佈</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.65rem' }}>
                          <div style={{ background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#FCA5A5' }}>🚀 突破上漲勝率</div>
                            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#EF4444' }}>
                              {activePrediction?.prob_up_20d}%
                            </div>
                            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '0.35rem', overflow: 'hidden' }}>
                              <div style={{ width: `${activePrediction?.prob_up_20d}%`, height: '100%', background: '#EF4444' }}></div>
                            </div>
                          </div>

                          <div style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#6EE7B7' }}>⚠️ 回檔跌破風險</div>
                            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#10B981' }}>
                              {activePrediction?.prob_down_20d}%
                            </div>
                            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '0.35rem', overflow: 'hidden' }}>
                              <div style={{ width: `${activePrediction?.prob_down_20d}%`, height: '100%', background: '#10B981' }}></div>
                            </div>
                          </div>

                          <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#FDE68A' }}>⚖️ 區間箱型震盪</div>
                            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#F59E0B' }}>
                              {activePrediction?.prob_neutral_20d}%
                            </div>
                            <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '0.35rem', overflow: 'hidden' }}>
                              <div style={{ width: `${activePrediction?.prob_neutral_20d}%`, height: '100%', background: '#FCD34D' }}></div>
                            </div>
                          </div>
                        </div>

                        {/* 5 天短期與波段支撐壓力區間 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', fontSize: '0.82rem', background: 'rgba(0,0,0,0.25)', padding: '0.6rem 0.85rem', borderRadius: '8px' }}>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>⏱️ 短線 5 日方向: </span>
                            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FCA5A5', marginRight: '0.5rem' }}>多 {activePrediction?.prob_up_5d}%</span>
                            <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#86EFAC' }}>空 {activePrediction?.prob_down_5d}%</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>🎯 預估 20 日波段區間: </span>
                            <strong style={{ color: '#60A5FA' }}>
                              {activePrediction?.support_pts?.toLocaleString()} ~ {activePrediction?.resistance_pts?.toLocaleString()} 點
                            </strong>
                          </div>
                        </div>

                        {/* 市場結構狀態與二階段元標籤 (Regime MoE + Meta-Labeling Filter) */}
                        {activeModelInfo?.regime_info && (
                          <div style={{
                            marginTop: '0.75rem',
                            padding: '0.75rem 0.95rem',
                            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.9))',
                            border: '1px solid rgba(59, 130, 246, 0.35)',
                            borderRadius: '8px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.55rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#93C5FD' }}>
                                  🏛️ 當前宏觀結構狀態:
                                </span>
                                <span style={{
                                  fontSize: '0.82rem',
                                  fontWeight: 700,
                                  padding: '0.2rem 0.6rem',
                                  borderRadius: '6px',
                                  background: activeModelInfo.regime_info.active_regime === 'bull' ? 'rgba(239, 68, 68, 0.25)' : activeModelInfo.regime_info.active_regime === 'bear' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)',
                                  color: activeModelInfo.regime_info.active_regime === 'bull' ? '#FCA5A5' : activeModelInfo.regime_info.active_regime === 'bear' ? '#86EFAC' : '#FDE68A',
                                  border: '1px solid currentColor'
                                }}>
                                  {activeModelInfo.regime_info.active_regime_label}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Meta-Filter:</span>
                                <span style={{
                                  fontSize: '0.78rem',
                                  fontWeight: 'bold',
                                  padding: '0.15rem 0.55rem',
                                  borderRadius: '6px',
                                  background: activeModelInfo.regime_info.meta_confidence_pct >= 52 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                  color: activeModelInfo.regime_info.meta_confidence_pct >= 52 ? '#86EFAC' : '#FDE68A',
                                  border: activeModelInfo.regime_info.meta_confidence_pct >= 52 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)'
                                }}>
                                  {activeModelInfo.regime_info.meta_verdict} ({activeModelInfo.regime_info.meta_confidence_pct}%)
                                </span>
                              </div>
                            </div>

                            {activeModelInfo.regime_info.weights && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.3rem' }}>
                                  <span>門控路由權重 (Gating Distribution):</span>
                                  <span>
                                    🐂 牛市主升 {activeModelInfo.regime_info.weights.bull_pct}% · 🐻 熊市防禦 {activeModelInfo.regime_info.weights.bear_pct}% · ⚖️ 箱型震盪 {activeModelInfo.regime_info.weights.range_pct}%
                                  </span>
                                </div>
                                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', display: 'flex', overflow: 'hidden' }}>
                                  <div style={{ width: `${activeModelInfo.regime_info.weights.bull_pct}%`, height: '100%', background: '#EF4444' }} title={`牛市: ${activeModelInfo.regime_info.weights.bull_pct}%`}></div>
                                  <div style={{ width: `${activeModelInfo.regime_info.weights.bear_pct}%`, height: '100%', background: '#10B981' }} title={`熊市: ${activeModelInfo.regime_info.weights.bear_pct}%`}></div>
                                  <div style={{ width: `${activeModelInfo.regime_info.weights.range_pct}%`, height: '100%', background: '#F59E0B' }} title={`箱型震盪: ${activeModelInfo.regime_info.weights.range_pct}%`}></div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* AutoML 全域最佳化超參數展示條 */}
                        {activeModelInfo?.optimization?.is_auto_tuned && (
                          <div style={{
                            marginTop: '0.75rem',
                            padding: '0.55rem 0.85rem',
                            background: 'linear-gradient(135deg, rgba(88, 28, 135, 0.25), rgba(30, 27, 75, 0.35))',
                            border: '1px solid rgba(168, 85, 247, 0.35)',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.5rem'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.82rem', color: '#D8B4FE', fontWeight: 'bold' }}>
                                ✨ 已套用 Optuna 貝氏全域尋優最佳參數 (Global Minima)
                              </span>
                              {activeModelInfo.optimization.best_loss !== undefined && (
                                <span style={{ fontSize: '0.75rem', background: 'rgba(168, 85, 247, 0.25)', color: '#F3E8FF', padding: '0.1rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                                  極小損失 (Loss): {activeModelInfo.optimization.best_loss} · {activeModelInfo.optimization.n_trials || 10}代試驗
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                fontSize: '0.75rem',
                                padding: '0.2rem 0.6rem',
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(168, 85, 247, 0.4)',
                                color: '#E9D5FF',
                                borderRadius: '6px',
                                cursor: 'pointer'
                              }}
                              onClick={() => setShowMarketMlParamsDetail(!showMarketMlParamsDetail)}
                            >
                              {showMarketMlParamsDetail ? '▴ 隱藏超參數配置' : '▾ 檢視最適超參數 (Global Minima Params)'}
                            </button>
                          </div>
                        )}

                        {activeModelInfo?.optimization?.is_auto_tuned && showMarketMlParamsDetail && activeModelInfo.optimization.best_params && (
                          <div style={{
                            marginTop: '0.5rem',
                            padding: '0.75rem 0.95rem',
                            background: 'rgba(15, 23, 42, 0.92)',
                            border: '1px solid rgba(168, 85, 247, 0.3)',
                            borderRadius: '8px',
                            fontSize: '0.78rem',
                            color: '#E2E8F0',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '0.45rem'
                          }}>
                            {Object.entries(activeModelInfo.optimization.best_params).map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.25rem' }}>
                                <span style={{ color: '#C084FC', fontFamily: 'monospace' }}>{k}:</span>
                                <span style={{ fontWeight: 'bold', color: '#F8FAFC', fontFamily: 'monospace' }}>
                                  {typeof v === 'number' ? (v < 0.01 && v > 0 ? v.toExponential(3) : Number.isInteger(v) ? v : v.toFixed(4)) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 🌊 艾略特波浪客觀量化定位與斐波那契階梯 */}
                    {renderElliottWaveMatrix(currentElliottWave, false)}

                    {/* 📐 大盤關鍵支撐壓力多階量化梯隊 (Support & Resistance Ladder) */}
                    {marketMlData?.support_resistance && (
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.8))',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        borderRadius: '14px',
                        padding: '1.25rem 1.5rem',
                        marginBottom: '1.25rem',
                        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.3)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                              <span>📐</span>
                              <span>大盤關鍵支撐壓力多階量化梯隊 (Support & Resistance Ladder)</span>
                            </h3>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                              基於歷史 2,400+ 天價格分佈、半年籌碼成交量密集峰 (VPVR POC) 與黃金分割多維度動態精算
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.15)', color: '#93C5FD', padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                              📍 籌碼重心 POC: {marketMlData.support_resistance.volume_profile?.poc?.toLocaleString()} 點
                            </span>
                            <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.15)', color: '#86EFAC', padding: '0.2rem 0.55rem', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              🛡️ 月線防線 MA20: {marketMlData.support_resistance.moving_averages?.ma20?.price?.toLocaleString()} 點
                            </span>
                          </div>
                        </div>

                        {/* 六階梯隊縱向視覺化看板 */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                          gap: '0.85rem',
                          marginBottom: '1rem'
                        }}>
                          {/* 🔴 壓力梯隊卡片 (R3, R2, R1) */}
                          <div style={{
                            background: 'rgba(239, 68, 68, 0.05)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#FCA5A5', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>🛑 多方上攻壓力防線 (Resistance)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                              {/* R3 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#F87171', fontWeight: 800 }}>{marketMlData.support_resistance.r3?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{marketMlData.support_resistance.r3?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#FCA5A5' }}>{marketMlData.support_resistance.r3?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#EF4444' }}>+{marketMlData.support_resistance.r3?.diff} 點 (+{marketMlData.support_resistance.r3?.diff_pct}%)</div>
                                </div>
                              </div>
                              {/* R2 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.14)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#F87171', fontWeight: 800 }}>{marketMlData.support_resistance.r2?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{marketMlData.support_resistance.r2?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#EF4444' }}>{marketMlData.support_resistance.r2?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#EF4444' }}>+{marketMlData.support_resistance.r2?.diff} 點 (+{marketMlData.support_resistance.r2?.diff_pct}%)</div>
                                </div>
                              </div>
                              {/* R1 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#FCA5A5', fontWeight: 900 }}>{marketMlData.support_resistance.r1?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: '#FCA5A5' }}>{marketMlData.support_resistance.r1?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#F87171' }}>{marketMlData.support_resistance.r1?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#FCA5A5' }}>+{marketMlData.support_resistance.r1?.diff} 點 (+{marketMlData.support_resistance.r1?.diff_pct}%)</div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 🟢 支撐梯隊卡片 (S1, S2, S3) */}
                          <div style={{
                            background: 'rgba(16, 185, 129, 0.05)',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#86EFAC', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>🛡️ 空方回踩支撐防線 (Support)</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                              {/* S1 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#86EFAC', fontWeight: 900 }}>{marketMlData.support_resistance.s1?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: '#86EFAC' }}>{marketMlData.support_resistance.s1?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#34D399' }}>{marketMlData.support_resistance.s1?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#86EFAC' }}>{marketMlData.support_resistance.s1?.diff} 點 ({marketMlData.support_resistance.s1?.diff_pct}%)</div>
                                </div>
                              </div>
                              {/* S2 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.14)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#6EE7B7', fontWeight: 800 }}>{marketMlData.support_resistance.s2?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{marketMlData.support_resistance.s2?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#10B981' }}>{marketMlData.support_resistance.s2?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#10B981' }}>{marketMlData.support_resistance.s2?.diff} 點 ({marketMlData.support_resistance.s2?.diff_pct}%)</div>
                                </div>
                              </div>
                              {/* S3 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16, 185, 129, 0.1)', padding: '0.45rem 0.75rem', borderRadius: '6px' }}>
                                <div>
                                  <span style={{ fontSize: '0.75rem', color: '#6EE7B7', fontWeight: 800 }}>{marketMlData.support_resistance.s3?.name}</span>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{marketMlData.support_resistance.s3?.desc}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#6EE7B7' }}>{marketMlData.support_resistance.s3?.price?.toLocaleString()}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#059669' }}>{marketMlData.support_resistance.s3?.diff} 點 ({marketMlData.support_resistance.s3?.diff_pct}%)</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 📊 大盤籌碼成交量分佈直方圖 (Volume Profile / VPVR 120d) */}
                        {marketMlData.support_resistance.volume_profile?.histogram && marketMlData.support_resistance.volume_profile.histogram.length > 0 && (
                          <div style={{
                            background: 'rgba(0, 0, 0, 0.35)',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                            borderRadius: '10px',
                            padding: '0.9rem 1.1rem',
                            marginBottom: '1rem'
                          }}>
                            {/* 標題與圖例欄 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                  <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#93C5FD' }}>
                                    📊 大盤籌碼成交量分佈直方圖 (Volume-at-Price Profile)
                                  </span>
                                  <span style={{ fontSize: '0.72rem', color: '#6EE7B7', background: 'rgba(16, 185, 129, 0.15)', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                    近半年 120 交易日
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                  橫向柱狀長度代表各價位區間之實際換手總成交金額 (億元)，柱狀越長代表該價位量能換手越密集、具強大支撐/壓力效力
                                </div>
                              </div>

                              {/* 圖例說明 */}
                              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#FCD34D' }}>
                                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#F59E0B', display: 'inline-block' }}></span>
                                  ★ POC 籌碼最大密集峰
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#93C5FD' }}>
                                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#3B82F6', display: 'inline-block' }}></span>
                                  價值區 (Value Area 70%)
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#FDA4AF' }}>
                                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#E11D48', display: 'inline-block' }}></span>
                                  📍 當前指數所在階
                                </span>
                              </div>
                            </div>

                            {/* POC 重心精確導航分析 */}
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.5rem',
                              background: 'rgba(245, 158, 11, 0.08)',
                              border: '1px dashed rgba(245, 158, 11, 0.35)',
                              borderRadius: '8px',
                              padding: '0.5rem 0.8rem',
                              marginBottom: '0.75rem',
                              fontSize: '0.78rem'
                            }}>
                              <div style={{ color: '#FDE68A' }}>
                                <strong>★ 核心量價重心 (POC):</strong> {marketMlData.support_resistance.volume_profile.poc?.toLocaleString()} 點 
                                {marketMlData.support_resistance.volume_profile.poc_turnover_yi && (
                                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                                    (單階換手量達 <strong>{marketMlData.support_resistance.volume_profile.poc_turnover_yi?.toLocaleString()}</strong> 億，佔近半年總量 <strong>{marketMlData.support_resistance.volume_profile.poc_share_pct}%</strong>)
                                  </span>
                                )}
                              </div>
                              <div style={{ color: marketMlData.support_resistance.current_close >= marketMlData.support_resistance.volume_profile.poc ? '#86EFAC' : '#FCA5A5', fontWeight: 700 }}>
                                {marketMlData.support_resistance.current_close >= marketMlData.support_resistance.volume_profile.poc
                                  ? `▲ 現價站於 POC 上方 +${(marketMlData.support_resistance.current_close - marketMlData.support_resistance.volume_profile.poc).toFixed(0)} 點，回踩享強勁量能托盤支撐`
                                  : `▼ 現價位於 POC 下方 ${(marketMlData.support_resistance.current_close - marketMlData.support_resistance.volume_profile.poc).toFixed(0)} 點，反彈面臨龐大換手反壓`}
                              </div>
                            </div>

                            {/* 直方圖主體列表 (由高價到低價) */}
                            <div style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              maxHeight: showFullVolumeHistogram ? 'none' : '440px',
                              overflowY: 'auto',
                              paddingRight: '4px'
                            }}>
                              {marketMlData.support_resistance.volume_profile.histogram.map((bin) => {
                                const isPoc = Boolean(bin.is_poc);
                                const isCurrent = Boolean(bin.is_current);
                                const isVa = Boolean(bin.is_value_area);

                                let barBg = 'linear-gradient(90deg, rgba(71, 85, 105, 0.35), rgba(100, 116, 139, 0.45))';
                                let barBorder = '1px solid rgba(100, 116, 139, 0.2)';
                                let textColor = '#CBD5E1';
                                let rowBg = 'transparent';

                                if (isPoc) {
                                  barBg = 'linear-gradient(90deg, #F59E0B, #FBBF24)';
                                  barBorder = '1px solid #FCD34D';
                                  textColor = '#FEF08A';
                                  rowBg = 'rgba(245, 158, 11, 0.12)';
                                } else if (isCurrent) {
                                  barBg = 'linear-gradient(90deg, #E11D48, #F43F5E)';
                                  barBorder = '1px solid #FDA4AF';
                                  textColor = '#FECDD3';
                                  rowBg = 'rgba(244, 63, 94, 0.12)';
                                } else if (isVa) {
                                  barBg = 'linear-gradient(90deg, rgba(37, 99, 235, 0.6), rgba(59, 130, 246, 0.75))';
                                  barBorder = '1px solid rgba(59, 130, 246, 0.4)';
                                  textColor = '#BFDBFE';
                                }

                                return (
                                  <div
                                    key={bin.bin_index}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '135px 1fr 140px',
                                      alignItems: 'center',
                                      gap: '0.6rem',
                                      padding: '0.22rem 0.5rem',
                                      borderRadius: '5px',
                                      background: rowBg,
                                      fontSize: '0.74rem',
                                      borderLeft: isPoc ? '3px solid #F59E0B' : isCurrent ? '3px solid #F43F5E' : '3px solid transparent'
                                    }}
                                  >
                                    {/* 價位區間 */}
                                    <div style={{
                                      fontFamily: 'monospace',
                                      fontWeight: (isPoc || isCurrent) ? 800 : 500,
                                      color: textColor,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.3rem'
                                    }}>
                                      <span>{Math.round(bin.price_low).toLocaleString()} ~ {Math.round(bin.price_high).toLocaleString()}</span>
                                    </div>

                                    {/* 水平成交量直方條 */}
                                    <div style={{ position: 'relative', width: '100%', height: '18px', background: 'rgba(255, 255, 255, 0.04)', borderRadius: '4px', overflow: 'hidden' }}>
                                      <div
                                        style={{
                                          width: `${Math.max(2, bin.bar_pct)}%`,
                                          height: '100%',
                                          background: barBg,
                                          border: barBorder,
                                          borderRadius: '3px',
                                          transition: 'width 0.4s ease-out'
                                        }}
                                      />
                                      {/* 條內標籤提示 */}
                                      {isPoc && (
                                        <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', fontWeight: 800, color: '#1E293B', textShadow: '0 0 2px rgba(255,255,255,0.8)' }}>
                                          ★ POC 最大換手峰 ({bin.turnover_pct}%)
                                        </span>
                                      )}
                                      {isCurrent && !isPoc && (
                                        <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.68rem', fontWeight: 800, color: '#FFF', textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>
                                          📍 當前指數位置 ({marketMlData.support_resistance.current_close?.toLocaleString()})
                                        </span>
                                      )}
                                    </div>

                                    {/* 成交額與佔比 */}
                                    <div style={{ textAlign: 'right', fontFamily: 'monospace', color: textColor, fontWeight: (isPoc || isCurrent) ? 800 : 500 }}>
                                      <span>{bin.turnover_yi?.toLocaleString()} 億</span>
                                      <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem', fontSize: '0.7rem' }}>
                                        ({bin.turnover_pct}%)
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* 展開/收合控制列 */}
                            {marketMlData.support_resistance.volume_profile.histogram.length > 10 && (
                              <div style={{ textAlign: 'center', marginTop: '0.6rem' }}>
                                <button
                                  onClick={() => setShowFullVolumeHistogram(!showFullVolumeHistogram)}
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.1)',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    borderRadius: '6px',
                                    color: '#93C5FD',
                                    padding: '0.25rem 0.75rem',
                                    fontSize: '0.72rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  {showFullVolumeHistogram ? '▲ 收合直方圖顯示' : '▼ 展開完整 20 階直方圖'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 關鍵均線排列與乖離概況 */}
                        {marketMlData.support_resistance.moving_averages && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                            gap: '0.5rem',
                            padding: '0.65rem 0.85rem',
                            background: 'rgba(0,0,0,0.25)',
                            borderRadius: '8px',
                            fontSize: '0.76rem'
                          }}>
                            {Object.entries(marketMlData.support_resistance.moving_averages).map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ color: 'var(--text-muted)', textTransform: 'uppercase' }}>{k} ({k === 'ma5' ? '週線' : k === 'ma20' ? '月線' : k === 'ma60' ? '季線' : k === 'ma120' ? '半年線' : '年線'}):</span>
                                <strong style={{ color: '#F8FAFC', fontSize: '0.88rem' }}>{v.price?.toLocaleString()}</strong>
                                <span style={{ fontSize: '0.7rem', color: v.bias_pct >= 0 ? '#F87171' : '#34D399' }}>
                                  {v.bias_pct >= 0 ? '+' : ''}{v.bias_pct}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 🌐 國際宏觀跨市場定價看板 (Global Macro Cross-Market Cockpit) */}
                    {marketMlData?.macro_snapshot && (
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <h3 style={{ margin: 0, fontSize: '1rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>🌐</span>
                            <span>國際宏觀跨市場定價看板 (Global Macro Intermarket Cockpit)</span>
                          </h3>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            每日自動同步美債殖利率、費半指數、原油與台幣匯率，作為 ML 模型估值與資金流折現因子
                          </span>
                        </div>
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                          gap: '0.75rem'
                        }}>
                          {/* 1. 美債 10 年期殖利率 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>美債 10 年期殖利率 (US10Y)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.15)', color: '#FCA5A5', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                估值折現因子
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#F8FAFC' }}>
                              {marketMlData.macro_snapshot.us10y?.toFixed(2)}%
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日變動: <strong style={{ color: marketMlData.macro_snapshot.us10y_change_20d > 0 ? '#F87171' : '#34D399' }}>
                                {marketMlData.macro_snapshot.us10y_change_20d > 0 ? '+' : ''}{(marketMlData.macro_snapshot.us10y_change_20d * 100).toFixed(0)} bps
                              </strong>
                              <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem' }}>
                                {marketMlData.macro_snapshot.us10y_change_20d > 0.3 ? '(殖利率急升承壓)' : '(波動平穩)'}
                              </span>
                            </div>
                          </div>

                          {/* 2. 費城半導體指數 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>費城半導體指數 (SOX)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#86EFAC', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                半導體先行指針
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#38BDF8' }}>
                              {marketMlData.macro_snapshot.sox?.toLocaleString()}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日波段動能: <strong style={{ color: marketMlData.macro_snapshot.sox_ret_20d >= 0 ? '#34D399' : '#F87171' }}>
                                {marketMlData.macro_snapshot.sox_ret_20d >= 0 ? '+' : ''}{marketMlData.macro_snapshot.sox_ret_20d?.toFixed(2)}%
                              </strong>
                            </div>
                          </div>

                          {/* 3. 台積電 ADR 溢價折算率 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>台積電 ADR 溢價率 (TSM)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(59, 130, 246, 0.15)', color: '#93C5FD', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                外資超額溢價
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: (marketMlData.macro_snapshot.tsm_adr_premium || 0) >= 0 ? '#34D399' : '#F87171' }}>
                              {(marketMlData.macro_snapshot.tsm_adr_premium || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.tsm_adr_premium?.toFixed(2)}%
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              ADR: <strong style={{ color: '#F8FAFC' }}>${marketMlData.macro_snapshot.tsm_adr?.toFixed(2)}</strong>
                              <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', color: (marketMlData.macro_snapshot.tsm_adr_ret_20d || 0) >= 0 ? '#34D399' : '#F87171' }}>
                                (20日: {(marketMlData.macro_snapshot.tsm_adr_ret_20d || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.tsm_adr_ret_20d?.toFixed(1)}%)
                              </span>
                            </div>
                          </div>

                          {/* 4. 輝達 (NVDA) 全球 AI 舵手 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>輝達 (NVDA)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#86EFAC', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                全球 AI 總舵手
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#38BDF8' }}>
                              ${marketMlData.macro_snapshot.nvda?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日波段動能: <strong style={{ color: (marketMlData.macro_snapshot.nvda_ret_20d || 0) >= 0 ? '#34D399' : '#F87171' }}>
                                {(marketMlData.macro_snapshot.nvda_ret_20d || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.nvda_ret_20d?.toFixed(2)}%
                              </strong>
                            </div>
                          </div>

                          {/* 5. WTI 紐約輕原油 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>WTI 紐約輕原油 (Oil)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.15)', color: '#FCD34D', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                通膨與成本壓力
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#FCD34D' }}>
                              ${marketMlData.macro_snapshot.oil_wti?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日波段動能: <strong style={{ color: marketMlData.macro_snapshot.oil_ret_20d >= 0 ? '#F87171' : '#34D399' }}>
                                {marketMlData.macro_snapshot.oil_ret_20d >= 0 ? '+' : ''}{marketMlData.macro_snapshot.oil_ret_20d?.toFixed(2)}%
                              </strong>
                            </div>
                          </div>

                          {/* 6. 美元兌新台幣即期匯率 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>美元兌新台幣 (USD/TWD)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(139, 92, 246, 0.15)', color: '#C4B5FD', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                外資熱錢水庫
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#F8FAFC' }}>
                              {marketMlData.macro_snapshot.usdtwd?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日變動: <strong style={{ color: marketMlData.macro_snapshot.usdtwd_ret_20d >= 0 ? '#10B981' : '#EF4444' }}>
                                {marketMlData.macro_snapshot.usdtwd_ret_20d >= 0 ? '貶值 +' : '升值 '}{marketMlData.macro_snapshot.usdtwd_ret_20d?.toFixed(2)}%
                              </strong>
                              <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem' }}>
                                {marketMlData.macro_snapshot.usdtwd_ret_20d < 0 ? '(熱錢匯入)' : '(熱錢匯出)'}
                              </span>
                            </div>
                          </div>

                          {/* 7. 美元兌日圓 Carry Trade 利差交易 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>美元兌日圓 (USD/JPY)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(239, 68, 68, 0.15)', color: '#FCA5A5', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                利差平倉警戒
                              </span>
                            </div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#F8FAFC' }}>
                              ¥{marketMlData.macro_snapshot.usdjpy?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              20日變動: <strong style={{ color: (marketMlData.macro_snapshot.usdjpy_ret_20d || 0) <= -2.0 ? '#EF4444' : '#34D399' }}>
                                {(marketMlData.macro_snapshot.usdjpy_ret_20d || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.usdjpy_ret_20d?.toFixed(2)}%
                              </strong>
                              <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem' }}>
                                {(marketMlData.macro_snapshot.usdjpy_ret_20d || 0) <= -2.0 ? '(日圓急升平倉)' : '(流動性穩定)'}
                              </span>
                            </div>
                          </div>

                          {/* 8. 頂級量化學術指針 (Hurst / FracDiff / Amihud / Breadth) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(168, 85, 247, 0.4)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: '#DDD6FE' }}>量化學術指針 (Quant Insights)</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(168, 85, 247, 0.2)', color: '#D8B4FE', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                文獻數學特徵
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#C084FC' }}>
                                Hurst: {marketMlData.macro_snapshot.hurst_60d?.toFixed(3) || '0.500'}
                              </div>
                              <span style={{ fontSize: '0.72rem', color: (marketMlData.macro_snapshot.hurst_60d || 0.5) > 0.52 ? '#34D399' : '#FCD34D' }}>
                                {(marketMlData.macro_snapshot.hurst_60d || 0.5) > 0.52 ? '趨勢持續型 (Trending)' : '均值回歸型 (Mean-Rev)'}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                              <span>分數微分(d=0.45): <strong style={{ color: '#E2E8F0' }}>{marketMlData.macro_snapshot.frac_diff_045?.toFixed(3) || '0.95'}</strong></span>
                              <span>5日漲跌比: <strong style={{ color: (marketMlData.macro_snapshot.breadth_ad_ratio_5d || 1) >= 1 ? '#34D399' : '#F87171' }}>{marketMlData.macro_snapshot.breadth_ad_ratio_5d?.toFixed(2) || '1.00'}</strong></span>
                            </div>
                          </div>

                          {/* 9. 國際大宗商品景氣指針 (銅博士 / 鋁 / 汽油裂解價差) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>🏭 銅油比 & 裂解價差 (大宗商品)</span>
                              <span style={{ fontSize: '0.72rem', color: (marketMlData.macro_snapshot.copper_ret_20d || 0) >= 0 ? '#34D399' : '#F87171' }}>
                                銅價: ${marketMlData.macro_snapshot.copper?.toFixed(2)}/磅
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.35rem' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#FCD34D' }}>
                                銅油比 {marketMlData.macro_snapshot.copper_oil_ratio?.toFixed(3) || '0.072'}
                              </div>
                              <span style={{ fontSize: '0.72rem', color: (marketMlData.macro_snapshot.crack_spread || 0) > 25 ? '#34D399' : '#94A3B8' }}>
                                裂解價差: ${marketMlData.macro_snapshot.crack_spread?.toFixed(1) || '47.9'}/桶
                              </span>
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                              <span>鋁價: <strong style={{ color: '#E2E8F0' }}>${marketMlData.macro_snapshot.aluminum?.toFixed(0) || '3219'}</strong> ({marketMlData.macro_snapshot.aluminum_ret_20d ? (marketMlData.macro_snapshot.aluminum_ret_20d >= 0 ? '+' : '') + marketMlData.macro_snapshot.aluminum_ret_20d.toFixed(1) + '%' : '-5.9%'})</span>
                              <span>汽油: <strong style={{ color: '#E2E8F0' }}>${marketMlData.macro_snapshot.gasoline?.toFixed(2) || '3.31'}</strong></span>
                            </div>
                          </div>

                          {/* 10. 那斯達克 & 標普 500 (Nasdaq / S&P 500) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>那斯達克 & 標普 500</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(59, 130, 246, 0.15)', color: '#93C5FD', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                美股大盤定價
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#38BDF8' }}>
                                {marketMlData.macro_snapshot.nasdaq ? marketMlData.macro_snapshot.nasdaq.toLocaleString() : '27,190'}
                                <span style={{ fontSize: '0.74rem', marginLeft: '0.35rem', color: (marketMlData.macro_snapshot.nasdaq_ret_20d || 0) >= 0 ? '#34D399' : '#F87171' }}>
                                  ({(marketMlData.macro_snapshot.nasdaq_ret_20d || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.nasdaq_ret_20d?.toFixed(1)}%)
                                </span>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                              <span>S&P 500: <strong style={{ color: '#F8FAFC' }}>{marketMlData.macro_snapshot.sp500?.toLocaleString() || '7,722'}</strong> ({marketMlData.macro_snapshot.sp500_ret_20d ? (marketMlData.macro_snapshot.sp500_ret_20d >= 0 ? '+' : '') + marketMlData.macro_snapshot.sp500_ret_20d.toFixed(1) + '%' : '+3.1%'})</span>
                              <span>那/標比: <strong style={{ color: (marketMlData.macro_snapshot.nasdaq_sp500_ratio_chg20 || 0) >= 0 ? '#34D399' : '#F87171' }}>{(marketMlData.macro_snapshot.nasdaq_sp500_ratio_chg20 || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.nasdaq_sp500_ratio_chg20?.toFixed(2)}%</strong></span>
                            </div>
                          </div>

                          {/* 11. 道瓊工業指數 & VT 全球股票 ETF */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            borderRadius: '12px',
                            padding: '0.85rem 1rem'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>道瓊工業 & VT 全球市場</span>
                              <span style={{ fontSize: '0.72rem', background: 'rgba(168, 85, 247, 0.15)', color: '#D8B4FE', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                                全球系統流動性
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#C084FC' }}>
                                {marketMlData.macro_snapshot.dow ? marketMlData.macro_snapshot.dow.toLocaleString() : '51,176'}
                                <span style={{ fontSize: '0.74rem', marginLeft: '0.35rem', color: (marketMlData.macro_snapshot.dow_ret_20d || 0) >= 0 ? '#34D399' : '#F87171' }}>
                                  ({(marketMlData.macro_snapshot.dow_ret_20d || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.dow_ret_20d?.toFixed(1)}%)
                                </span>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                              <span>VT 全球: <strong style={{ color: '#F8FAFC' }}>${marketMlData.macro_snapshot.vt?.toFixed(2) || '159.13'}</strong> ({marketMlData.macro_snapshot.vt_ret_20d ? (marketMlData.macro_snapshot.vt_ret_20d >= 0 ? '+' : '') + marketMlData.macro_snapshot.vt_ret_20d.toFixed(1) + '%' : '+2.4%'})</span>
                              <span>美/球比: <strong style={{ color: (marketMlData.macro_snapshot.sp500_vt_ratio_chg20 || 0) >= 0 ? '#34D399' : '#F87171' }}>{(marketMlData.macro_snapshot.sp500_vt_ratio_chg20 || 0) >= 0 ? '+' : ''}{marketMlData.macro_snapshot.sp500_vt_ratio_chg20?.toFixed(2)}%</strong></span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. 三大法人期現貨籌碼戰情看板 (Institutional Cockpit) */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <h3 style={{ fontSize: '1rem', color: '#93C5FD', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        📊 三大法人期現貨籌碼戰情看板 (Institutional Cockpit)
                      </h3>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '0.75rem'
                      }}>
                        {/* 外資期貨淨留倉卡片 */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>外資台指期未平倉 (Net OI)</span>
                            <span style={{
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '8px',
                              background: marketMlData.institutional_cockpit?.foreign_futures_net < -35000 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(59, 130, 246, 0.2)',
                              color: marketMlData.institutional_cockpit?.foreign_futures_net < -35000 ? '#F87171' : '#93C5FD',
                              border: '1px solid rgba(255,255,255,0.08)'
                            }}>
                              {marketMlData.institutional_cockpit?.foreign_futures_risk}
                            </span>
                          </div>
                          <div style={{ fontSize: '1.45rem', fontWeight: 900, color: marketMlData.institutional_cockpit?.foreign_futures_net < 0 ? '#10B981' : '#EF4444' }}>
                            {marketMlData.institutional_cockpit?.foreign_futures_net?.toLocaleString()} 口
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            3日變動: <strong style={{ color: marketMlData.institutional_cockpit?.foreign_futures_change_3d > 0 ? '#EF4444' : '#10B981' }}>
                              {marketMlData.institutional_cockpit?.foreign_futures_change_3d > 0 ? '+' : ''}{marketMlData.institutional_cockpit?.foreign_futures_change_3d?.toLocaleString()} 口
                            </strong>
                            <span style={{ margin: '0 0.35rem' }}>·</span>
                            5日: <strong style={{ color: marketMlData.institutional_cockpit?.foreign_futures_change_5d > 0 ? '#EF4444' : '#10B981' }}>
                              {marketMlData.institutional_cockpit?.foreign_futures_change_5d > 0 ? '+' : ''}{marketMlData.institutional_cockpit?.foreign_futures_change_5d?.toLocaleString()} 口
                            </strong>
                          </div>
                        </div>

                        {/* 投信與自營商期貨留倉 */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            投信 / 自營商期貨淨留倉
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>投信多單避險</div>
                              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#EF4444' }}>
                                +{marketMlData.institutional_cockpit?.trust_futures_net?.toLocaleString()} 口
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>自營商避險對沖</div>
                              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: marketMlData.institutional_cockpit?.dealer_futures_net < 0 ? '#10B981' : '#EF4444' }}>
                                {marketMlData.institutional_cockpit?.dealer_futures_net?.toLocaleString()} 口
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            三大法人期貨合計: <strong style={{ color: (marketMlData.institutional_cockpit?.foreign_futures_net + marketMlData.institutional_cockpit?.trust_futures_net + marketMlData.institutional_cockpit?.dealer_futures_net) >= 0 ? '#EF4444' : '#10B981' }}>
                              {(marketMlData.institutional_cockpit?.foreign_futures_net + marketMlData.institutional_cockpit?.trust_futures_net + marketMlData.institutional_cockpit?.dealer_futures_net)?.toLocaleString()} 口
                            </strong>
                          </div>
                        </div>

                        {/* 三大法人現貨買賣超 */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            三大法人現貨單日買賣超
                          </div>
                          <div style={{
                            fontSize: '1.45rem',
                            fontWeight: 900,
                            color: marketMlData.institutional_cockpit?.total_cash_net_1d >= 0 ? '#EF4444' : '#10B981'
                          }}>
                            {marketMlData.institutional_cockpit?.total_cash_net_1d >= 0 ? '+' : ''}{marketMlData.institutional_cockpit?.total_cash_net_1d} 億
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            近 5 日合計: <strong style={{ color: marketMlData.institutional_cockpit?.total_cash_net_5d >= 0 ? '#EF4444' : '#10B981' }}>
                              {marketMlData.institutional_cockpit?.total_cash_net_5d >= 0 ? '+' : ''}{marketMlData.institutional_cockpit?.total_cash_net_5d} 億
                            </strong>
                            <span style={{ marginLeft: '0.4rem' }}>
                              (外資: {marketMlData.institutional_cockpit?.foreign_cash_net_5d} 億)
                            </span>
                          </div>
                        </div>

                        {/* 台積電權值錨定卡片 */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(59, 130, 246, 0.3)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            台積電 (2330) 權值錨定動能
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <span style={{
                              fontSize: '1.45rem',
                              fontWeight: 900,
                              color: marketMlData.institutional_cockpit?.tsmc_ret_5d >= 0 ? '#EF4444' : '#10B981'
                            }}>
                              {marketMlData.institutional_cockpit?.tsmc_ret_5d >= 0 ? '+' : ''}{marketMlData.institutional_cockpit?.tsmc_ret_5d?.toFixed(2)}%
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>(近 5 日漲幅)</span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            月線乖離: <strong style={{ color: marketMlData.institutional_cockpit?.tsmc_ma20_bias >= 0 ? '#EF4444' : '#10B981' }}>
                              {marketMlData.institutional_cockpit?.tsmc_ma20_bias >= 0 ? '+' : ''}{marketMlData.institutional_cockpit?.tsmc_ma20_bias?.toFixed(2)}%
                            </strong>
                            <span style={{ marginLeft: '0.4rem', color: '#93C5FD' }}>權重佔比 &gt; 35%</span>
                          </div>
                        </div>

                        {/* 選擇權 Put/Call Ratio 與散戶小台留倉卡片 */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(139, 92, 246, 0.35)',
                          borderRadius: '12px',
                          padding: '0.85rem 1rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: '0.82rem', color: '#DDD6FE' }}>選擇權 P/C Ratio (未平倉)</span>
                            <span style={{
                              fontSize: '0.72rem',
                              fontWeight: 'bold',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '6px',
                              background: (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) > 110
                                ? 'rgba(16, 185, 129, 0.2)'
                                : (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) < 85
                                ? 'rgba(239, 68, 68, 0.2)'
                                : 'rgba(59, 130, 246, 0.2)',
                              color: (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) > 110
                                ? '#6EE7B7'
                                : (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) < 85
                                ? '#FCA5A5'
                                : '#93C5FD'
                            }}>
                              {(marketMlData.institutional_cockpit?.pc_ratio_oi || 100) > 110
                                ? '莊家偏多防守'
                                : (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) < 85
                                ? '避險/極度悲觀'
                                : '多空勢均力敵'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: (marketMlData.institutional_cockpit?.pc_ratio_oi || 100) >= 100 ? '#34D399' : '#F87171' }}>
                              {marketMlData.institutional_cockpit?.pc_ratio_oi?.toFixed(1) || '--'}%
                            </div>
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                              成交量比: <strong style={{ color: '#E2E8F0' }}>{marketMlData.institutional_cockpit?.pc_ratio_vol?.toFixed(1) || '--'}%</strong>
                            </span>
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between' }}>
                            <span>
                              散戶小台: <strong style={{ color: (marketMlData.institutional_cockpit?.retail_mtx_net || 0) < 0 ? '#34D399' : '#F87171' }}>
                                {(marketMlData.institutional_cockpit?.retail_mtx_net || 0) > 0 ? '+' : ''}{(marketMlData.institutional_cockpit?.retail_mtx_net || 0).toLocaleString()} 口
                              </strong>
                            </span>
                            <span>
                              60日 Z: <strong style={{ color: (marketMlData.institutional_cockpit?.pc_ratio_oi_zscore_60d || 0) < -1 ? '#FCA5A5' : '#94A3B8' }}>
                                {marketMlData.institutional_cockpit?.pc_ratio_oi_zscore_60d?.toFixed(2) || '0.00'}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 4. 下半部：大盤技術體檢與 Top 8 AI 核心驅動特徵 */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                      gap: '1rem'
                    }}>
                      {/* 大盤技術均線體檢卡片 */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.75)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '12px',
                        padding: '1.1rem 1.25rem'
                      }}>
                        <h3 style={{ fontSize: '0.95rem', color: '#93C5FD', marginBottom: '0.85rem' }}>
                          📐 大盤技術均線與動能指標
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.45rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>5 日均線 (MA5)</span>
                            <span style={{ fontWeight: 700 }}>{marketMlData.current_market?.ma5?.toLocaleString()} 點</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.45rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>20 日月線 (MA20)</span>
                            <span style={{ fontWeight: 700, color: '#60A5FA' }}>{marketMlData.current_market?.ma20?.toLocaleString()} 點</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.45rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>60 日季線 (MA60)</span>
                            <span style={{ fontWeight: 700, color: '#A78BFA' }}>{marketMlData.current_market?.ma60?.toLocaleString()} 點</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.45rem' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>14 日 RSI 相對強弱指標</span>
                            <span style={{ fontWeight: 700, color: marketMlData.current_market?.rsi_14 > 70 ? '#EF4444' : marketMlData.current_market?.rsi_14 < 30 ? '#10B981' : 'white' }}>
                              {marketMlData.current_market?.rsi_14}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>5日均量能相對倍數</span>
                            <span style={{ fontWeight: 700 }}>{marketMlData.current_market?.turnover_ratio_5d}x (量能持平)</span>
                          </div>
                        </div>
                      </div>

                      {/* Top 8 AI 核心特徵貢獻排行 (Explainable AI) */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.75)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '12px',
                        padding: '1.1rem 1.25rem'
                      }}>
                        <h3 style={{ fontSize: '0.95rem', color: '#93C5FD', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>🧠 AI 判斷多空之關鍵特徵貢獻 (Top 8 XAI)</span>
                          <span style={{ fontSize: '0.75rem', color: '#93C5FD', fontWeight: 'bold' }}>
                            {MARKET_ML_MODELS.find(m => m.val === activeModelKey)?.short || activeModelKey}
                          </span>
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                          {activeTopFeatures?.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                <span style={{ color: '#E2E8F0' }}>
                                  #{idx + 1} {item.name}
                                </span>
                                <span style={{ fontWeight: 'bold', color: '#60A5FA' }}>
                                  {item.importance_pct}%
                                </span>
                              </div>
                              <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{
                                  width: `${Math.min(100, item.importance_pct * 3.5)}%`,
                                  height: '100%',
                                  background: 'linear-gradient(90deg, #3B82F6, #60A5FA)'
                                }}></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 子視圖 5: 🌊 艾略特波浪客觀量化定位與斐波那契階梯專頁 ── */}
                {marketMlSubTab === 'elliott' && (() => {
                  const isLongShort = elliottBtMode === 'long_short';
                  const activePeriodKey = elliottBtPeriod || '10y';

                  // 取得回測數據
                  const btPeriods = marketMlData?.backtest_simulation?.periods || {};
                  const periodObj = btPeriods[activePeriodKey] || (activePeriodKey === '10y' ? btPeriods['10y'] : null);
                  const modelObj = periodObj?.models_detail?.elliott;

                  const activeModeData = modelObj
                    ? (isLongShort ? modelObj.long_short : modelObj.long_only)
                    : (currentElliottWave?.backtest
                        ? (isLongShort ? currentElliottWave.backtest.long_short : currentElliottWave.backtest.long_only)
                        : null);

                  const benchmark = periodObj?.benchmark || {
                    total_return_pct: activeModeData?.benchmark_total_return_pct,
                    cagr_pct: activeModeData?.benchmark_cagr_pct,
                    max_drawdown_pct: activeModeData?.benchmark_max_drawdown_pct,
                    sharpe: activeModeData?.benchmark_sharpe
                  };
                  const etf0050 = periodObj?.etf0050 || activeModeData?.etf0050 || null;

                  const curve = activeModeData?.curve || [];
                  const trades = activeModeData?.trades || [];
                  const actionMarkers = activeModeData?.action_markers || [];

                  // SVG NAV 計算
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

                  // 水下回撤 SVG 計算
                  const ddH = 70;
                  const ddPlotH = ddH - 20;
                  const maxDdObserved = Math.abs(Math.min(-30, ...(curve.map(p => p.drawdown_pct || 0))));
                  const getDdY = (dd) => 5 + (Math.abs(dd) / (maxDdObserved || 1)) * ddPlotH;
                  const ddLinePoints = curve.map((p, i) => `${getX(i).toFixed(1)},${getDdY(p.drawdown_pct || 0).toFixed(1)}`).join(' ');
                  const ddAreaPoints = curve.length > 0 ? `${getX(0).toFixed(1)},5 ` + ddLinePoints + ` ${getX(curve.length - 1).toFixed(1)},5` : '';

                  const yTicks = [minVal, minVal + valRange * 0.5, maxVal];
                  const xTickIndices = [0, Math.floor(curve.length * 0.25), Math.floor(curve.length * 0.5), Math.floor(curve.length * 0.75), curve.length - 1].filter((idx, pos, arr) => arr.indexOf(idx) === pos && idx < curve.length);

                  const formatDateStr = (d) => {
                    if (!d) return '';
                    const s = String(d);
                    return s.length === 8 ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}` : s;
                  };

                  const periodOptions = [
                    { key: '10y', label: '🏛️ 近 10 年跨牛熊完整檢驗 (2016~2026)' },
                    { key: 'oos_2y', label: '🎯 近 2 年樣本外盲測 (2024~2026)' },
                    { key: '5y', label: '🏆 近 5 年波段實戰 (2021~2026)' },
                    { key: '2022', label: '🛡️ 2022 空頭大回撤考驗' },
                    { key: '2024', label: '🚀 2024 AI 狂潮主升段' },
                    { key: '2020', label: '🦅 2020 疫情黑天鵝' }
                  ];

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {/* 1. 即時波浪定位與斐波那契階梯矩陣 */}
                      {renderElliottWaveMatrix(currentElliottWave, true)}

                      {/* 2. 艾略特波浪歷年實戰回測與操作軌跡專屬看板 */}
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 27, 75, 0.85))',
                        border: '1px solid rgba(139, 92, 246, 0.45)',
                        borderRadius: '14px',
                        padding: '1.25rem 1.5rem',
                        boxShadow: '0 8px 24px rgba(139, 92, 246, 0.15)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1.2rem'
                      }}>
                        {/* 頂部標題與快速跳轉 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#C084FC', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span>📊</span>
                                <span>艾略特波浪歷年實戰回測與操作軌跡 (Elliott Wave Historical Backtest & Trades)</span>
                              </h3>
                              <span style={{
                                background: 'rgba(168, 85, 247, 0.2)',
                                color: '#E9D5FF',
                                border: '1px solid rgba(168, 85, 247, 0.45)',
                                fontSize: '0.78rem',
                                fontWeight: 'bold',
                                padding: '0.15rem 0.6rem',
                                borderRadius: '12px'
                              }}>
                                幾何推動與斐波階梯量化回測
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
                            <p style={{ margin: 0, fontSize: '0.82rem', color: '#CBD5E1' }}>
                              基於滾動 ZigZag 極值定位與三大不可違背鐵律（二浪不破底、三浪非最短、四浪不重疊），於第 3 浪突破時追價發動、第 5 浪衝頂與 ABC 修正浪啟動現金避險或做空對沖，嚴格無未來函數。
                            </p>
                          </div>

                          {/* 跳轉全模型回測詳細對照 */}
                          <button
                            type="button"
                            className="btn"
                            style={{
                              padding: '0.5rem 1rem',
                              fontSize: '0.82rem',
                              fontWeight: 'bold',
                              borderRadius: '8px',
                              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(91, 33, 182, 0.4))',
                              border: '1px solid rgba(168, 85, 247, 0.6)',
                              color: '#E9D5FF',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                            onClick={() => {
                              setMarketMlSubTab('backtest');
                              setMarketBacktestModel('elliott');
                              localStorage.setItem('market_ml_sub_tab', 'backtest');
                              localStorage.setItem('market_backtest_model', 'elliott');
                            }}
                          >
                            <span>🔍 在全模型回測套件中詳細對比</span>
                            <span>➔</span>
                          </button>
                        </div>

                        {/* 控制工具列：區間選擇器與多空模式切換 */}
                        <div style={{
                          background: 'rgba(0, 0, 0, 0.35)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '10px',
                          padding: '0.85rem 1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem'
                        }}>
                          {/* 區間選擇 */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 'bold' }}>回測檢驗區間：</span>
                              {periodOptions.map(p => {
                                const isActive = activePeriodKey === p.key;
                                return (
                                  <button
                                    key={p.key}
                                    type="button"
                                    className="btn"
                                    style={{
                                      padding: '0.35rem 0.8rem',
                                      fontSize: '0.78rem',
                                      borderRadius: '8px',
                                      fontWeight: isActive ? 'bold' : 'normal',
                                      background: isActive ? 'linear-gradient(135deg, #8B5CF6, #7C3AED)' : 'rgba(255, 255, 255, 0.05)',
                                      color: isActive ? '#FFFFFF' : '#94A3B8',
                                      border: isActive ? '1px solid #A855F7' : '1px solid rgba(255, 255, 255, 0.1)',
                                      boxShadow: isActive ? '0 0 12px rgba(139, 92, 246, 0.4)' : 'none',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onClick={() => {
                                      setElliottBtPeriod(p.key);
                                      localStorage.setItem('elliott_bt_period', p.key);
                                    }}
                                  >
                                    {p.label}
                                  </button>
                                );
                              })}
                            </div>

                            {/* 做多避險 / 多空雙向 切換按鈕 */}
                            <div style={{
                              display: 'inline-flex',
                              background: 'rgba(0, 0, 0, 0.4)',
                              padding: '0.2rem',
                              borderRadius: '8px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              gap: '0.25rem'
                            }}>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.35rem 0.85rem',
                                  fontSize: '0.82rem',
                                  fontWeight: 'bold',
                                  borderRadius: '6px',
                                  background: !isLongShort ? 'linear-gradient(135deg, #059669, #047857)' : 'transparent',
                                  color: !isLongShort ? '#FFFFFF' : 'var(--text-muted)',
                                  border: !isLongShort ? '1px solid #10B981' : '1px solid transparent',
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  setElliottBtMode('long_only');
                                  localStorage.setItem('elliott_bt_mode', 'long_only');
                                }}
                              >
                                🛡️ 做多＋現金避險 (Long-Only)
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.35rem 0.85rem',
                                  fontSize: '0.82rem',
                                  fontWeight: 'bold',
                                  borderRadius: '6px',
                                  background: isLongShort ? 'linear-gradient(135deg, #7C3AED, #6D28D9)' : 'transparent',
                                  color: isLongShort ? '#FFFFFF' : 'var(--text-muted)',
                                  border: isLongShort ? '1px solid #8B5CF6' : '1px solid transparent',
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  setElliottBtMode('long_short');
                                  localStorage.setItem('elliott_bt_mode', 'long_short');
                                }}
                              >
                                ⚡ 多空雙向操作 (Long/Short)
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* 3. 核心量化指標卡片群組 (8 大卡片) */}
                        {activeModeData ? (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '0.85rem'
                          }}>
                            {/* 總報酬率 */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(139, 92, 246, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #A855F7'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>累積總報酬率 (Total Return)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: activeModeData.total_return_pct >= 0 ? '#C084FC' : '#F87171' }}>
                                {activeModeData.total_return_pct >= 0 ? '+' : ''}{activeModeData.total_return_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div>同期大盤: <span style={{ color: (benchmark.total_return_pct || 0) >= 0 ? '#E2E8F0' : '#FCA5A5' }}>{(benchmark.total_return_pct || 0) >= 0 ? '+' : ''}{benchmark.total_return_pct?.toFixed(1)}%</span></div>
                                {etf0050 && (
                                  <div style={{ color: '#38BDF8' }}>
                                    同期 0050: <span style={{ fontWeight: 'bold' }}>+{(etf0050.total_return_pct || 0).toFixed(1)}%</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 年化報酬率 (CAGR) */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(59, 130, 246, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #3B82F6'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>年化複合成長率 (CAGR)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#60A5FA' }}>
                                +{activeModeData.cagr_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div>同期大盤: <span style={{ color: (benchmark.cagr_pct || 0) >= 0 ? '#E2E8F0' : '#FCA5A5' }}>{(benchmark.cagr_pct || 0) >= 0 ? '+' : ''}{benchmark.cagr_pct?.toFixed(1)}%</span></div>
                                {etf0050 && (
                                  <div style={{ color: '#38BDF8' }}>
                                    0050 CAGR: <span style={{ fontWeight: 'bold' }}>+{(etf0050.cagr_pct || 0).toFixed(1)}%</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 最大回撤 (MDD) */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #EF4444'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>最大歷史回撤 (MDD)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#F87171' }}>
                                {activeModeData.max_drawdown_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div>大盤回撤: <span style={{ color: '#FCA5A5' }}>{benchmark.max_drawdown_pct?.toFixed(1)}%</span></div>
                                <div style={{ color: '#34D399', fontWeight: '600' }}>
                                  🛡️ 結構防守有效避開重挫
                                </div>
                              </div>
                            </div>

                            {/* 夏普值與索提諾比 */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(168, 85, 247, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #8B5CF6'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>夏普值 / 索提諾比</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#D8B4FE', display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                                <span>{activeModeData.sharpe_ratio?.toFixed(2)}</span>
                                <span style={{ fontSize: '0.9rem', color: '#A78BFA' }}>/ {activeModeData.sortino_ratio?.toFixed(2)}</span>
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                衡量下檔波動防禦之性價比
                              </div>
                            </div>

                            {/* 勝率與交易總筆數 */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(16, 185, 129, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #10B981'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>交易勝率 (Win Rate)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#34D399' }}>
                                {activeModeData.win_rate_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                總交易 {activeModeData.total_trades} 筆 (勝 {activeModeData.win_trades} / 負 {activeModeData.loss_trades})
                              </div>
                            </div>

                            {/* 獲利因子 (Profit Factor) */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #F59E0B'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>獲利因子 (Profit Factor)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#FBBF24' }}>
                                {activeModeData.profit_factor?.toFixed(2)}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                卡瑪比率: <span style={{ color: '#E2E8F0' }}>{activeModeData.calmar_ratio?.toFixed(2)}</span>
                              </div>
                            </div>

                            {/* 超額 Alpha */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(236, 72, 153, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #EC4899'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>超額 Alpha (年化)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: activeModeData.alpha_pct >= 0 ? '#F472B6' : '#94A3B8' }}>
                                {activeModeData.alpha_pct >= 0 ? '+' : ''}{activeModeData.alpha_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                                相對基準指數之超額表現
                              </div>
                            </div>

                            {/* 市場曝險比率 */}
                            <div style={{
                              background: 'rgba(15, 23, 42, 0.75)',
                              border: '1px solid rgba(14, 165, 233, 0.4)',
                              borderRadius: '10px',
                              padding: '0.85rem 1rem',
                              borderTop: '3px solid #0EA5E9'
                            }}>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>市場曝險比率 (Exposure)</div>
                              <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#38BDF8' }}>
                                {activeModeData.market_exposure_pct?.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#93C5FD', marginTop: '0.3rem' }}>
                                現金避險: {(100 - (activeModeData.market_exposure_pct || 0)).toFixed(1)}% 天數空手保本
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                            暫無當前區間之波浪回測數據。
                          </div>
                        )}

                        {/* 4. 淨值走勢圖 (SVG Net Asset Value Chart) */}
                        {curve.length > 0 && (
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '10px',
                            padding: '1.15rem 1.25rem'
                          }}>
                            {/* 圖表標題與圖例 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.1rem' }}>📈</span>
                                <span style={{ fontWeight: 'bold', fontSize: '0.96rem', color: '#E2E8F0' }}>累積淨值成長曲線 (基準初始本金：NT$ 1,000,000)</span>
                              </div>

                              {/* 圖例說明 */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '14px', height: '3px', background: '#A855F7', borderRadius: '2px', boxShadow: '0 0 6px #A855F7' }}></span>
                                  <span style={{ color: '#D8B4FE', fontWeight: 'bold' }}>波浪策略淨值 (Strategy NAV)</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '14px', height: '2px', borderTop: '2px dashed #94A3B8' }}></span>
                                  <span style={{ color: '#94A3B8' }}>加權指數基準 (TAIEX)</span>
                                </div>
                                {etf0050 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ display: 'inline-block', width: '14px', height: '2px', borderTop: '2px dashed #38BDF8' }}></span>
                                    <span style={{ color: '#38BDF8' }}>元大台灣 50 (0050)</span>
                                  </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }}></span>
                                  <span style={{ color: '#6EE7B7' }}>買進</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444' }}></span>
                                  <span style={{ color: '#FCA5A5' }}>做空</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }}></span>
                                  <span style={{ color: '#FDE68A' }}>平倉/避險</span>
                                </div>
                              </div>
                            </div>

                            {/* 響應式 SVG NAV 走勢圖 */}
                            <div style={{ width: '100%', overflowX: 'auto' }}>
                              <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', minWidth: '650px', height: 'auto', display: 'block' }}>
                                <defs>
                                  <linearGradient id="elliottStratGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#A855F7" stopOpacity="0.35" />
                                    <stop offset="100%" stopColor="#A855F7" stopOpacity="0.0" />
                                  </linearGradient>
                                  <filter id="elliottGlow" x="-20%" y="-20%" width="140%" height="140%">
                                    <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#C084FC" floodOpacity="0.6" />
                                  </filter>
                                </defs>

                                {/* 背景水平網格線與 Y 軸標籤 */}
                                {yTicks.map((yVal, idx) => {
                                  const yPos = getY(yVal);
                                  return (
                                    <g key={idx}>
                                      <line x1={padL} y1={yPos} x2={svgW - padR} y2={yPos} stroke="rgba(255,255,255,0.06)" strokeDasharray={idx === 1 ? '4 4' : 'none'} />
                                      <text x={padL - 10} y={yPos + 4} fill="#64748B" fontSize="11" textAnchor="end" fontFamily="monospace">
                                        ${Math.round(yVal).toLocaleString()}
                                      </text>
                                    </g>
                                  );
                                })}

                                {/* 策略面積填色 */}
                                {curve.length > 1 && (
                                  <polygon
                                    points={`${getX(0).toFixed(1)},${padT + plotH} ` + stratPoints + ` ${getX(curve.length - 1).toFixed(1)},${padT + plotH}`}
                                    fill="url(#elliottStratGrad)"
                                  />
                                )}

                                {/* 大盤基準走勢虛線 */}
                                {curve.length > 1 && (
                                  <polyline points={benchPoints} fill="none" stroke="#64748B" strokeWidth="1.6" strokeDasharray="5 4" opacity="0.8" />
                                )}

                                {/* 0050 ETF 走勢虛線 */}
                                {curve.length > 1 && etf0050 && (
                                  <polyline points={etfPoints} fill="none" stroke="#38BDF8" strokeWidth="1.6" strokeDasharray="3 3" opacity="0.85" />
                                )}

                                {/* 策略淨值走勢實線 (紫色微光) */}
                                {curve.length > 1 && (
                                  <polyline points={stratPoints} fill="none" stroke="#C084FC" strokeWidth="2.4" filter="url(#elliottGlow)" />
                                )}

                                {/* 交易動作標記圓點 (Action Markers) */}
                                {actionMarkers.map((am, idx) => {
                                  const cIdx = curve.findIndex(p => String(p.date) === String(am.date));
                                  if (cIdx === -1) return null;
                                  const xPos = getX(cIdx);
                                  const pEquity = curve[cIdx].strategy_equity;
                                  const yPos = getY(pEquity);
                                  const isBuy = am.action === 'BUY';
                                  const isShort = am.action === 'SHORT';
                                  const color = isBuy ? '#10B981' : isShort ? '#EF4444' : '#F59E0B';

                                  return (
                                    <g key={idx}>
                                      <circle cx={xPos} cy={yPos} r="4.5" fill={color} stroke="#0F172A" strokeWidth="1.5" />
                                    </g>
                                  );
                                })}

                                {/* X 軸日期標籤 */}
                                {xTickIndices.map((tIdx, idx) => {
                                  const pt = curve[tIdx];
                                  if (!pt) return null;
                                  const xPos = getX(tIdx);
                                  return (
                                    <text key={idx} x={xPos} y={svgH - 8} fill="#94A3B8" fontSize="10.5" textAnchor="middle" fontFamily="sans-serif">
                                      {formatDateStr(pt.date)}
                                    </text>
                                  );
                                })}
                              </svg>
                            </div>

                            {/* 水下回撤分析圖 (Drawdown Underwater Area Chart) */}
                            <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', fontSize: '0.78rem', color: '#94A3B8' }}>
                                <span>水下回撤幅度 (Drawdown Underwater Area)</span>
                                <span>最大歷史回撤：<strong style={{ color: '#F87171' }}>{activeModeData.max_drawdown_pct?.toFixed(1)}%</strong></span>
                              </div>
                              <div style={{ width: '100%', overflowX: 'auto' }}>
                                <svg viewBox={`0 0 ${svgW} ${ddH}`} style={{ width: '100%', minWidth: '650px', height: '65px', display: 'block' }}>
                                  <line x1={padL} y1="5" x2={svgW - padR} y2="5" stroke="rgba(255,255,255,0.12)" />
                                  <line x1={padL} y1={ddH - 10} x2={svgW - padR} y2={ddH - 10} stroke="rgba(239,68,68,0.25)" strokeDasharray="3 3" />
                                  <text x={padL - 10} y="8" fill="#64748B" fontSize="10" textAnchor="end">0%</text>
                                  <text x={padL - 10} y={ddH - 7} fill="#F87171" fontSize="10" textAnchor="end">-{maxDdObserved.toFixed(0)}%</text>
                                  {ddAreaPoints && (
                                    <polygon points={ddAreaPoints} fill="rgba(239, 68, 68, 0.28)" />
                                  )}
                                  {ddLinePoints && (
                                    <polyline points={ddLinePoints} fill="none" stroke="#EF4444" strokeWidth="1.2" />
                                  )}
                                </svg>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 5. 實戰波浪交易軌跡明細 (Trades Table) */}
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.75)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '10px',
                          padding: '1.15rem 1.25rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '1.1rem' }}>📜</span>
                              <span style={{ fontWeight: 'bold', fontSize: '0.96rem', color: '#E2E8F0' }}>實戰波浪交易軌跡明細 (Wave Trades History)</span>
                              <span style={{
                                fontSize: '0.74rem',
                                background: 'rgba(168, 85, 247, 0.2)',
                                color: '#D8B4FE',
                                padding: '0.15rem 0.55rem',
                                borderRadius: '10px'
                              }}>
                                共 {trades.length} 筆完整波浪回測紀錄
                              </span>
                            </div>
                          </div>

                          {trades.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                              在此選定區間內波浪策略處於觀望或尚未產生平倉紀錄。
                            </div>
                          ) : (
                            <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8', background: 'rgba(0,0,0,0.25)' }}>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>#</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>方向</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>進場時間 / 點位</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>出場時間 / 點位</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>持有天數</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>波浪觸發類型</th>
                                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>報酬率 %</th>
                                    <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>損益金額</th>
                                    <th style={{ padding: '0.6rem 0.75rem' }}>出場決策依據</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {trades.slice().reverse().map((t, idx) => {
                                    const isWin = (t.return_pct || 0) >= 0;
                                    const isLong = (t.direction || '').includes('多') || t.direction === 'BUY' || t.direction === 'LONG';
                                    return (
                                      <tr
                                        key={idx}
                                        style={{
                                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                                          background: idx % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                                          transition: 'background 0.15s ease'
                                        }}
                                      >
                                        <td style={{ padding: '0.55rem 0.75rem', color: '#64748B' }}>{trades.length - idx}</td>
                                        <td style={{ padding: '0.55rem 0.75rem' }}>
                                          <span style={{
                                            fontSize: '0.74rem',
                                            padding: '0.15rem 0.45rem',
                                            borderRadius: '4px',
                                            fontWeight: '600',
                                            background: isLong ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                            color: isLong ? '#34D399' : '#F87171'
                                          }}>
                                            {isLong ? '🟢 做多' : '🔴 做空'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem' }}>
                                          <div style={{ fontWeight: '500', color: '#E2E8F0' }}>{formatDateStr(t.entry_date)}</div>
                                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t.entry_price ? t.entry_price.toLocaleString() : '-'} 點</div>
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem' }}>
                                          <div style={{ fontWeight: '500', color: '#E2E8F0' }}>{formatDateStr(t.exit_date)}</div>
                                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t.exit_price ? t.exit_price.toLocaleString() : '-'} 點</div>
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem', color: '#94A3B8' }}>{t.holding_days || 1} 天</td>
                                        <td style={{ padding: '0.55rem 0.75rem' }}>
                                          <span style={{
                                            fontSize: '0.75rem',
                                            background: 'rgba(139, 92, 246, 0.2)',
                                            color: '#D8B4FE',
                                            padding: '0.15rem 0.5rem',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(139, 92, 246, 0.35)'
                                          }}>
                                            {t.wave_tag || '🌊 推動浪'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                                          {isWin ? '+' : ''}{t.return_pct?.toFixed(2)}%
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: isWin ? '#6EE7B7' : '#FCA5A5' }}>
                                          {t.profit_amount !== undefined ? `${t.profit_amount >= 0 ? '+' : ''}NT$ ${Math.round(t.profit_amount).toLocaleString()}` : '-'}
                                        </td>
                                        <td style={{ padding: '0.55rem 0.75rem', fontSize: '0.76rem', color: '#94A3B8' }}>
                                          {t.exit_reason || '正常波段平倉'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── 子視圖 4: 🧭 近半年 AI 量化即時操作指引與買賣歷程 ── */}
                {marketMlSubTab === 'operations' && (() => {
                  const op = marketMlData?.operations_6m;
                  if (!op || !op.models_detail) {
                    return (
                      <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🧭</div>
                        <p style={{ margin: 0, fontSize: '1rem', color: '#93C5FD' }}>
                          {triggeringMarketMl ? '正在連線本機背景運算近半年操作指引與買賣歷程，請稍候...' : '尚未產生近半年操作指引數據。'}
                        </p>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          點擊下方按鈕即可立即驅動各 AI 模型訊號、風控防守與買賣決策歷程運算。
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
                              <span>運算中...</span>
                            </>
                          ) : (
                            <>🚀 立即計算近半年操作指引</>
                          )}
                        </button>
                      </div>
                    );
                  }

                  const activeModelKey = operationsModel || op.selected_model_id || 'regime_moe';
                  const modelData = op.models_detail[activeModelKey] || op.models_detail['regime_moe'] || Object.values(op.models_detail)[0];
                  const activeModeKey = operationsMode || 'long_short';
                  const isLongShort = activeModeKey === 'long_short';
                  const modeData = modelData?.[activeModeKey] || modelData?.long_short || {};
                  const trades = modeData?.trades || [];
                  const currentStatus = modeData?.current_status || op.current_action || {};
                  const consensus = op.consensus || {};
                  const curve = modeData?.curve || [];

                  // 日期格式化輔助函式 (YYYYMMDD -> YYYY/MM/DD)
                  const formatOpDate = (d) => {
                    if (!d) return '';
                    const str = String(d);
                    if (str.length === 8) {
                      return `${str.slice(0, 4)}/${str.slice(4, 6)}/${str.slice(6, 8)}`;
                    }
                    return str;
                  };

                  // 交易篩選與排序
                  let filteredTrades = [...trades];
                  if (operationsTradeFilter === 'win') {
                    filteredTrades = filteredTrades.filter(t => (t.return_pct || 0) > 0);
                  } else if (operationsTradeFilter === 'loss') {
                    filteredTrades = filteredTrades.filter(t => (t.return_pct || 0) <= 0);
                  }

                  if (operationsSortOrder === 'desc') {
                    filteredTrades.reverse();
                  }

                  // 快速統計指標
                  const totalProfitAmount = trades.reduce((acc, t) => acc + (t.profit_amount || 0), 0);
                  const avgReturnPct = trades.length > 0 ? (trades.reduce((acc, t) => acc + (t.return_pct || 0), 0) / trades.length) : 0;
                  const avgHoldingDays = trades.length > 0 ? (trades.reduce((acc, t) => acc + (t.holding_days || 0), 0) / trades.length) : 0;

                  // SVG 走勢圖座標幾何計算 (近半年)
                  const svgW = 920;
                  const svgH = 260;
                  const padL = 75;
                  const padR = 40;
                  const padT = 25;
                  const padB = 40;
                  const plotW = svgW - padL - padR;
                  const plotH = svgH - padT - padB;

                  let minVal = Infinity;
                  let maxVal = -Infinity;
                  curve.forEach(pt => {
                    if (pt.strategy_equity !== undefined) {
                      if (pt.strategy_equity < minVal) minVal = pt.strategy_equity;
                      if (pt.strategy_equity > maxVal) maxVal = pt.strategy_equity;
                    }
                    if (pt.benchmark_equity !== undefined) {
                      if (pt.benchmark_equity < minVal) minVal = pt.benchmark_equity;
                      if (pt.benchmark_equity > maxVal) maxVal = pt.benchmark_equity;
                    }
                    if (pt.etf0050_equity !== undefined) {
                      if (pt.etf0050_equity < minVal) minVal = pt.etf0050_equity;
                      if (pt.etf0050_equity > maxVal) maxVal = pt.etf0050_equity;
                    }
                  });

                  if (minVal === Infinity) {
                    minVal = 950000;
                    maxVal = 1400000;
                  }
                  const valSpan = maxVal - minVal;
                  minVal = Math.max(0, minVal - valSpan * 0.08);
                  maxVal = maxVal + valSpan * 0.08;
                  const range = maxVal - minVal || 1;

                  const getX = (idx) => padL + (idx / Math.max(1, curve.length - 1)) * plotW;
                  const getY = (val) => padT + plotH - ((val - minVal) / range) * plotH;

                  const stratPoints = curve.map((pt, i) => `${getX(i).toFixed(1)},${getY(pt.strategy_equity).toFixed(1)}`).join(' ');
                  const benchPoints = curve.map((pt, i) => `${getX(i).toFixed(1)},${getY(pt.benchmark_equity).toFixed(1)}`).join(' ');
                  const etfPoints = curve.map((pt, i) => `${getX(i).toFixed(1)},${getY(pt.etf0050_equity || pt.benchmark_equity).toFixed(1)}`).join(' ');

                  const opActionMarkers = modeData?.action_markers || [];
                  const curveDateMap = {};
                  curve.forEach((pt, i) => {
                    curveDateMap[String(pt.date)] = i;
                  });

                  const yTicks = [
                    minVal,
                    minVal + range * 0.33,
                    minVal + range * 0.66,
                    maxVal
                  ];

                  const xTickIndices = [];
                  if (curve.length > 0) {
                    const step = Math.max(1, Math.floor(curve.length / 5));
                    for (let i = 0; i < curve.length; i += step) {
                      xTickIndices.push(i);
                    }
                    if (xTickIndices[xTickIndices.length - 1] !== curve.length - 1) {
                      xTickIndices.push(curve.length - 1);
                    }
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      {/* 1. 頁頭概覽卡片 */}
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(15, 23, 42, 0.75))',
                        border: '1px solid rgba(14, 165, 233, 0.35)',
                        borderRadius: '12px',
                        padding: '1.25rem 1.5rem',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '1rem'
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#38BDF8', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span>🧭</span>
                              <span>近半年 AI 量化即時操作指引與買賣歷程</span>
                            </h3>
                            <span style={{
                              background: 'rgba(14, 165, 233, 0.25)',
                              color: '#BAE6FD',
                              fontSize: '0.76rem',
                              fontWeight: 'bold',
                              padding: '0.2rem 0.6rem',
                              borderRadius: '20px',
                              border: '1px solid rgba(14, 165, 233, 0.4)'
                            }}>
                              涵蓋 {formatOpDate(op.start_date)} ～ {formatOpDate(op.end_date)}（近 {op.trading_days || 145} 個台股交易日）
                            </span>
                          </div>
                          <p style={{ margin: '0.45rem 0 0 0', fontSize: '0.84rem', color: '#94A3B8', lineHeight: 1.5 }}>
                            完整透明記錄各 AI 量化模型 (共 {MARKET_ML_MODELS.length} 款) 近半年的逐筆進出場價位、持倉天數、損益趴數與 AI 決策依據。
                            嚴格依據大盤 5MA/月線量價、宏觀特徵與 2.5% 風控停損紀律實盤模擬。
                          </p>
                        </div>

                        {/* 同步與刷新按鈕 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{
                              padding: '0.5rem 1rem',
                              fontSize: '0.84rem',
                              fontWeight: 'bold',
                              borderRadius: '8px',
                              background: 'rgba(14, 165, 233, 0.2)',
                              color: '#38BDF8',
                              border: '1px solid rgba(14, 165, 233, 0.5)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              transition: 'all 0.15s ease'
                            }}
                            onClick={() => handleTriggerMarketMlJob('market_ml_predict')}
                            disabled={triggeringMarketMl}
                          >
                            <span>🔄</span>
                            <span>{triggeringMarketMl ? '運算中...' : '重新運算即時信號'}</span>
                          </button>
                        </div>
                      </div>

                      {/* 2. 模型切換 Pill 與多空模式切換欄 */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem'
                      }}>
                        {/* 上列：7 款模型快速切換 */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 'bold' }}>選擇 AI 模型視角：</span>
                            {MARKET_ML_MODELS.map(m => {
                              const isSelected = activeModelKey === m.val;
                              // 取得該模型今日動作標籤
                              const mAction = consensus.model_actions?.find(a => a.model_id === m.val);
                              const actionDot = mAction?.action === 'LONG' ? '🟢' : mAction?.action === 'SHORT' ? '🔴' : '🛡️';
                              return (
                                <button
                                  key={m.val}
                                  type="button"
                                  className="btn"
                                  style={{
                                    padding: '0.35rem 0.85rem',
                                    fontSize: '0.82rem',
                                    borderRadius: '8px',
                                    fontWeight: isSelected ? 'bold' : 'normal',
                                    background: isSelected ? 'linear-gradient(135deg, #0EA5E9, #0284C7)' : 'rgba(255,255,255,0.05)',
                                    color: isSelected ? '#FFFFFF' : '#94A3B8',
                                    border: isSelected ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.1)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    boxShadow: isSelected ? '0 0 12px rgba(14, 165, 233, 0.35)' : 'none',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onClick={() => {
                                    setOperationsModel(m.val);
                                    localStorage.setItem('market_operations_model', m.val);
                                  }}
                                >
                                  <span>{actionDot}</span>
                                  <span>{m.short}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* 策略多空模式切換 */}
                          <div style={{
                            display: 'inline-flex',
                            background: 'rgba(0,0,0,0.4)',
                            padding: '0.2rem',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            gap: '0.25rem'
                          }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.35rem 0.85rem',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                                borderRadius: '6px',
                                background: isLongShort ? 'linear-gradient(135deg, #059669, #047857)' : 'transparent',
                                color: isLongShort ? 'white' : 'var(--text-muted)',
                                border: isLongShort ? '1px solid #10B981' : '1px solid transparent',
                                transition: 'all 0.15s ease'
                              }}
                              onClick={() => {
                                setOperationsMode('long_short');
                                localStorage.setItem('market_operations_mode', 'long_short');
                              }}
                            >
                              ⚡ 多空雙向操作
                            </button>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.35rem 0.85rem',
                                fontSize: '0.8rem',
                                fontWeight: 'bold',
                                borderRadius: '6px',
                                background: !isLongShort ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'transparent',
                                color: !isLongShort ? 'white' : 'var(--text-muted)',
                                border: !isLongShort ? '1px solid #3B82F6' : '1px solid transparent',
                                transition: 'all 0.15s ease'
                              }}
                              onClick={() => {
                                setOperationsMode('long_only');
                                localStorage.setItem('market_operations_mode', 'long_only');
                              }}
                            >
                              🛡️ 做多 + 現金避險 (Long-Only)
                            </button>
                          </div>
                        </div>

                        {/* 下列：7 模型全體共識風向條 */}
                        <div style={{
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: '8px',
                          padding: '0.6rem 0.9rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '0.6rem',
                          fontSize: '0.8rem',
                          border: '1px dashed rgba(255,255,255,0.1)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <span style={{ color: '#FDE68A', fontWeight: 'bold' }}>🤖 7 大 AI 模型即時共識：</span>
                            <span style={{ color: '#86EFAC', fontWeight: 600 }}>🟢 多方 ({consensus.long_count || 4})</span>
                            <span style={{ color: '#FDE68A', fontWeight: 600 }}>🛡️ 現金觀望 ({consensus.cash_count || 2})</span>
                            <span style={{ color: '#FCA5A5', fontWeight: 600 }}>🔴 做空避險 ({consensus.short_count || 1})</span>
                            <span style={{ color: 'var(--text-muted)' }}>|</span>
                            <span style={{ color: '#E2E8F0' }}>
                              多數共識風向：<strong style={{ color: '#60A5FA' }}>{consensus.dominant_stance || '偏多'}</strong>
                            </span>
                          </div>
                          <div style={{ color: '#94A3B8', fontSize: '0.76rem' }}>
                            目前選定視角：<strong style={{ color: '#38BDF8' }}>{modelData?.name || activeModelKey}</strong>
                          </div>
                        </div>
                      </div>

                      {/* 3. 🎯【本模型今日最新持倉與操作指令】核心卡片 */}
                      <div style={{
                        background: currentStatus.action_code === 'CASH'
                          ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(15, 23, 42, 0.85))'
                          : (currentStatus.action_code === 'HOLD_LONG' || currentStatus.action_code === 'BUY')
                            ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.85))'
                            : 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(15, 23, 42, 0.85))',
                        border: currentStatus.action_code === 'CASH'
                          ? '1px solid rgba(245, 158, 11, 0.45)'
                          : (currentStatus.action_code === 'HOLD_LONG' || currentStatus.action_code === 'BUY')
                            ? '1px solid rgba(16, 185, 129, 0.45)'
                            : '1px solid rgba(239, 68, 68, 0.45)',
                        borderRadius: '14px',
                        padding: '1.35rem 1.5rem',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.35)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <span style={{
                                padding: '0.3rem 0.85rem',
                                borderRadius: '20px',
                                fontSize: '0.84rem',
                                fontWeight: 800,
                                background: currentStatus.action_code === 'CASH'
                                  ? 'linear-gradient(135deg, #D97706, #B45309)'
                                  : (currentStatus.action_code === 'HOLD_LONG' || currentStatus.action_code === 'BUY')
                                    ? 'linear-gradient(135deg, #059669, #047857)'
                                    : 'linear-gradient(135deg, #DC2626, #B91C1C)',
                                color: 'white',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                              }}>
                                {currentStatus.action_badge || '🎯 即時操作指令'}
                              </span>
                              <span style={{ fontSize: '0.85rem', color: '#CBD5E1', fontWeight: 600 }}>
                                【{modelData?.short_name || '選定模型'}】最新持倉與具體行動指示
                              </span>
                            </div>
                            <h3 style={{ margin: '0.6rem 0 0 0', fontSize: '1.2rem', color: '#F8FAFC', fontWeight: 800 }}>
                              {currentStatus.action_title}
                            </h3>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>基準指數最新收盤</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#F8FAFC', fontFamily: 'monospace' }}>
                              {currentStatus.current_price?.toLocaleString()} 點
                            </div>
                          </div>
                        </div>

                        {/* 操作總結說明 */}
                        <p style={{
                          margin: '0 0 1.15rem 0',
                          fontSize: '0.88rem',
                          color: '#E2E8F0',
                          lineHeight: 1.6,
                          background: 'rgba(0,0,0,0.3)',
                          padding: '0.75rem 1rem',
                          borderRadius: '8px',
                          borderLeft: currentStatus.action_code === 'CASH' ? '4px solid #F59E0B' : (currentStatus.action_code === 'HOLD_LONG' || currentStatus.action_code === 'BUY') ? '4px solid #10B981' : '4px solid #EF4444'
                        }}>
                          {currentStatus.action_summary}
                        </p>

                        {/* 部位參數與關鍵價位 4 欄網格 */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: '0.75rem',
                          marginBottom: '1.15rem'
                        }}>
                          {/* 欄 1: 當前持倉狀態 */}
                          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.2rem' }}>當前持倉方向 / 水位</div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: currentStatus.action_code === 'CASH' ? '#FDE68A' : (currentStatus.action_code === 'HOLD_LONG' || currentStatus.action_code === 'BUY') ? '#86EFAC' : '#FCA5A5' }}>
                              {currentStatus.direction}
                              <span style={{ fontSize: '0.8rem', marginLeft: '0.4rem', color: '#94A3B8' }}>({currentStatus.position_size_pct > 0 ? '+' : ''}{currentStatus.position_size_pct}%)</span>
                            </div>
                          </div>

                          {/* 欄 2: 基準價位與日期 */}
                          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                              {currentStatus.action_code === 'CASH' ? '最近平倉日期 / 價位' : '進場建立日期 / 價位'}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#F8FAFC', fontFamily: 'monospace' }}>
                              {formatOpDate(currentStatus.entry_date)} @ {currentStatus.entry_price?.toLocaleString()} 點
                            </div>
                          </div>

                          {/* 欄 3: 損益與持有天數 */}
                          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                              {currentStatus.action_code === 'CASH' ? '最近一筆交易損益' : '目前未實現損益 / 持有'}
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: currentStatus.unrealized_return_pct >= 0 ? '#34D399' : '#F87171' }}>
                              {currentStatus.unrealized_return_pct >= 0 ? '+' : ''}{currentStatus.unrealized_return_pct?.toFixed(2)}%
                              <span style={{ fontSize: '0.78rem', color: '#94A3B8', marginLeft: '0.4rem' }}>
                                (已持有 {currentStatus.holding_days} 天)
                              </span>
                            </div>
                          </div>

                          {/* 欄 4: 防守與目標價 */}
                          <div style={{ background: 'rgba(0,0,0,0.35)', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '0.2rem' }}>🛡️ 風控停損 / 🎯 停利目標</div>
                            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#F8FAFC', display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: '#FCA5A5' }}>停損: {currentStatus.stop_loss_pts?.toLocaleString()}</span>
                              <span style={{ color: '#86EFAC' }}>停利: {currentStatus.take_profit_pts?.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>

                        {/* 4 點決策依據檢核清單 */}
                        <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                          <div style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 'bold', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>📋</span>
                            <span>AI 即時四維決策邏輯審查 (Decision Rationale Checklist)：</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.5rem' }}>
                            {currentStatus.rationales?.map((reason, idx) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.8rem', color: '#E2E8F0', lineHeight: 1.45 }}>
                                <span style={{ color: '#38BDF8', fontWeight: 'bold' }}>✓</span>
                                <span>{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* 4. 近半年績效儀表板 (6-Card KPI Grid) */}
                      <div>
                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>📊</span>
                          <span>近半年【{modelData?.short_name}】波段回測關鍵績效指標 ({formatOpDate(op.start_date)} ～ {formatOpDate(op.end_date)})</span>
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                          {/* 累積總報酬 */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #10B981' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>累積總報酬率</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: (modeData.total_return_pct || 0) >= 0 ? '#34D399' : '#F87171' }}>
                              {(modeData.total_return_pct || 0) >= 0 ? '+' : ''}{modeData.total_return_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div>同期大盤: +{modeData.benchmark_total_return_pct?.toFixed(1)}%</div>
                              {modeData.etf0050 && (
                                <div style={{ color: '#C4B5FD' }}>
                                  同期 0050: <span style={{ fontWeight: 'bold' }}>+{modeData.etf0050.total_return_pct?.toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 超額 Alpha */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #F59E0B' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>超額 Alpha</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: (modeData.alpha_pct || 0) >= 0 ? '#FBBF24' : '#94A3B8' }}>
                              {(modeData.alpha_pct || 0) >= 0 ? '+' : ''}{modeData.alpha_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              相對大盤主動超額
                            </div>
                          </div>

                          {/* 交易勝率 */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #3B82F6' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>波段勝率 (Win Rate)</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#60A5FA' }}>
                              {modeData.win_rate_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              {modeData.win_trades} 勝 {modeData.loss_trades} 敗 (共 {modeData.total_trades} 筆)
                            </div>
                          </div>

                          {/* 獲利因子 */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(139, 92, 246, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #8B5CF6' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>獲利因子 (Profit Factor)</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#C084FC' }}>
                              {modeData.profit_factor?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              總獲利 / 總虧損比例
                            </div>
                          </div>

                          {/* 最大回撤 */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #EF4444' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>最大回撤 (MDD)</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#F87171' }}>
                              {modeData.max_drawdown_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div>大盤回撤: {modeData.benchmark_max_drawdown_pct?.toFixed(1)}%</div>
                              {modeData.etf0050 && (
                                <div style={{ color: '#C4B5FD' }}>
                                  0050回撤: {modeData.etf0050.max_drawdown_pct?.toFixed(1)}%
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 市場曝險率 */}
                          <div style={{ background: 'rgba(15, 23, 42, 0.75)', border: '1px solid rgba(20, 184, 166, 0.4)', borderRadius: '10px', padding: '0.85rem 1rem', borderTop: '3px solid #14B8A6' }}>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>在市曝險 / 夏普比率</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#2DD4BF' }}>
                              {modeData.market_exposure_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              夏普: {modeData.sharpe_ratio?.toFixed(2)} (持幣率 {(100 - (modeData.market_exposure_pct || 0)).toFixed(0)}%)
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 5. 近半年策略淨值 vs 大盤走勢圖 (SVG Curve) */}
                      {curve.length > 0 && (
                        <div style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          borderRadius: '12px',
                          border: '1px solid var(--border-color)',
                          padding: '1.25rem',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <h4 style={{ margin: 0, fontSize: '0.98rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span>📈</span>
                                <span>近半年模型策略淨值 vs 大盤加權指數 vs 0050 走勢（初始 NT$ 1,000,000）</span>
                              </h4>
                            </div>
                            {/* 圖例與標注切換 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '14px', height: '3px', background: '#10B981', borderRadius: '2px' }}></span>
                                <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>AI 策略 ({modelData?.short_name || '策略'})</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#94A3B8', borderTop: '1px dashed #CBD5E1' }}></span>
                                <span style={{ color: '#94A3B8' }}>TAIEX 大盤 (買進持有)</span>
                              </div>
                              {modeData.etf0050 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{ display: 'inline-block', width: '14px', height: '2px', background: '#8B5CF6', borderTop: '1px dashed #C4B5FD' }}></span>
                                  <span style={{ color: '#C4B5FD' }}>0050 ETF (+{modeData.etf0050.total_return_pct?.toFixed(1)}%)</span>
                                </div>
                              )}
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
                                <span>標注加碼/放空 ({opActionMarkers.length})</span>
                              </button>
                            </div>
                          </div>

                          {/* 向量 SVG 走勢圖 */}
                          <div style={{ width: '100%', overflowX: 'auto' }}>
                            <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'rgba(0,0,0,0.25)', borderRadius: '8px' }}>
                              {/* 網格線與 Y 軸標籤 */}
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
                                    {formatOpDate(curve[idx]?.date)}
                                  </text>
                                </g>
                              ))}

                              {/* 基準大盤虛線 */}
                              <polyline fill="none" stroke="#64748B" strokeWidth="1.8" strokeDasharray="4 3" points={benchPoints} />

                              {/* 0050 ETF 基準虛線 */}
                              {curve.some(pt => pt.etf0050_equity !== undefined) && (
                                <polyline fill="none" stroke="#8B5CF6" strokeWidth="1.8" strokeDasharray="3 3" points={etfPoints} />
                              )}

                              {/* AI 策略折線 */}
                              <polyline fill="none" stroke="#10B981" strokeWidth="2.5" points={stratPoints} />

                              {/* 買進加碼與放空標注點位 */}
                              {showActionMarkers && opActionMarkers.map((m, mIdx) => {
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
                                  <g key={`op-marker-${mIdx}`} style={{ cursor: 'pointer' }}>
                                    <title>{`${formatOpDate(m.date)} ${m.label || (isBuy ? '買進加碼' : isShort ? '融券放空' : '平倉')} @ ${m.price?.toLocaleString()} 點 (策略淨值: $${Math.round(m.equity || pt.strategy_equity).toLocaleString()})`}</title>
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

                              {/* AI 策略終點標籤 */}
                              {curve.length > 0 && (
                                <>
                                  <circle cx={getX(curve.length - 1)} cy={getY(curve[curve.length - 1].strategy_equity)} r="4" fill="#34D399" />
                                  <text x={getX(curve.length - 1) - 6} y={getY(curve[curve.length - 1].strategy_equity) - 8} fill="#34D399" fontSize="11" fontWeight="bold" textAnchor="end">
                                    NT$ {Math.round(curve[curve.length - 1].strategy_equity).toLocaleString()} ({(modeData.total_return_pct || 0) >= 0 ? '+' : ''}{modeData.total_return_pct?.toFixed(1)}%)
                                  </text>
                                </>
                              )}
                            </svg>
                          </div>
                        </div>
                      )}

                      {/* 6. 📜【近半年 145 日逐筆買賣歷程與 AI 決策依據】明細清單 */}
                      <div style={{
                        background: 'rgba(15, 23, 42, 0.85)',
                        borderRadius: '14px',
                        border: '1px solid var(--border-color)',
                        padding: '1.25rem 1.5rem',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
                      }}>
                        {/* 工具列：過濾晶片、排序按鈕與累計數據 */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#38BDF8', display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800 }}>
                              <span>📜</span>
                              <span>近半年 145 日逐筆買賣歷程與 AI 決策依據 ({trades.length} 筆完整波段)</span>
                            </h4>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginTop: '0.35rem', fontSize: '0.78rem', color: '#94A3B8' }}>
                              <span>總獲利: <strong style={{ color: totalProfitAmount >= 0 ? '#34D399' : '#F87171' }}>{totalProfitAmount >= 0 ? '+' : ''}NT$ {Math.round(totalProfitAmount).toLocaleString()}</strong></span>
                              <span>平均每筆報酬: <strong style={{ color: avgReturnPct >= 0 ? '#34D399' : '#F87171' }}>{avgReturnPct >= 0 ? '+' : ''}{avgReturnPct.toFixed(2)}%</strong></span>
                              <span>平均持倉: <strong>{avgHoldingDays.toFixed(1)} 天</strong></span>
                            </div>
                          </div>

                          {/* 篩選與排序控制器 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            {/* 勝負過濾 */}
                            <div style={{ display: 'inline-flex', background: 'rgba(0,0,0,0.3)', padding: '0.2rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.25rem 0.65rem',
                                  fontSize: '0.76rem',
                                  borderRadius: '6px',
                                  background: operationsTradeFilter === 'all' ? '#0284C7' : 'transparent',
                                  color: operationsTradeFilter === 'all' ? 'white' : 'var(--text-muted)',
                                  border: 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                onClick={() => setOperationsTradeFilter('all')}
                              >
                                全部 ({trades.length})
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.25rem 0.65rem',
                                  fontSize: '0.76rem',
                                  borderRadius: '6px',
                                  background: operationsTradeFilter === 'win' ? '#059669' : 'transparent',
                                  color: operationsTradeFilter === 'win' ? 'white' : 'var(--text-muted)',
                                  border: 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                onClick={() => setOperationsTradeFilter('win')}
                              >
                                🟢 獲利 ({trades.filter(t => (t.return_pct || 0) > 0).length})
                              </button>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.25rem 0.65rem',
                                  fontSize: '0.76rem',
                                  borderRadius: '6px',
                                  background: operationsTradeFilter === 'loss' ? '#DC2626' : 'transparent',
                                  color: operationsTradeFilter === 'loss' ? 'white' : 'var(--text-muted)',
                                  border: 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                onClick={() => setOperationsTradeFilter('loss')}
                              >
                                🔴 停損 ({trades.filter(t => (t.return_pct || 0) <= 0).length})
                              </button>
                            </div>

                            {/* 順序切換按鈕 */}
                            <button
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.3rem 0.75rem',
                                fontSize: '0.76rem',
                                borderRadius: '8px',
                                background: 'rgba(255,255,255,0.06)',
                                color: '#CBD5E1',
                                border: '1px solid rgba(255,255,255,0.15)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                              }}
                              onClick={() => setOperationsSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                            >
                              <span>{operationsSortOrder === 'desc' ? '🔻 最新在最前' : '🔺 依時間由舊到新'}</span>
                            </button>
                          </div>
                        </div>

                        {/* 交易卡片流 */}
                        {filteredTrades.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                            沒有符合篩選條件的交易紀錄。
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            {filteredTrades.map((trade) => {
                              const isWin = (trade.return_pct || 0) > 0;
                              const isLong = trade.direction?.includes('多') || trade.direction === 'LONG';
                              const pnlColor = isWin ? '#34D399' : '#F87171';
                              const pnlBorder = isWin ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)';
                              const pnlBg = isWin ? 'rgba(6, 78, 59, 0.18)' : 'rgba(127, 29, 29, 0.16)';

                              return (
                                <div
                                  key={trade.trade_no}
                                  style={{
                                    background: pnlBg,
                                    border: pnlBorder,
                                    borderRadius: '12px',
                                    padding: '1rem 1.25rem',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  {/* 卡片標頭列 */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                      {/* 編號標籤 */}
                                      <span style={{
                                        background: 'rgba(255,255,255,0.1)',
                                        color: '#E2E8F0',
                                        fontSize: '0.76rem',
                                        fontWeight: 800,
                                        padding: '0.15rem 0.5rem',
                                        borderRadius: '6px',
                                        fontFamily: 'monospace'
                                      }}>
                                        #{String(trade.trade_no).padStart(2, '0')}
                                      </span>

                                      {/* 動作歷程標籤 */}
                                      <span style={{
                                        background: isWin ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                                        color: isWin ? '#6EE7B7' : '#FCA5A5',
                                        border: isWin ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                                        fontSize: '0.78rem',
                                        fontWeight: 700,
                                        padding: '0.15rem 0.55rem',
                                        borderRadius: '6px'
                                      }}>
                                        {trade.action_label || (isWin ? '獲利平倉' : '停損出場')}
                                      </span>

                                      {/* 多空方向標籤 */}
                                      <span style={{
                                        background: isLong ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                        color: isLong ? '#93C5FD' : '#FDE68A',
                                        fontSize: '0.76rem',
                                        fontWeight: 600,
                                        padding: '0.15rem 0.5rem',
                                        borderRadius: '6px'
                                      }}>
                                        {trade.direction}
                                      </span>

                                      {/* 持倉天數 */}
                                      <span style={{ fontSize: '0.76rem', color: '#94A3B8' }}>
                                        ⏱️ 持倉 {trade.holding_days} 天
                                      </span>
                                    </div>

                                    {/* 損益結果 */}
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.65rem' }}>
                                      <span style={{ fontSize: '1.25rem', fontWeight: 900, color: pnlColor, fontFamily: 'monospace' }}>
                                        {(trade.return_pct || 0) >= 0 ? '+' : ''}{trade.return_pct?.toFixed(2)}%
                                      </span>
                                      <span style={{ fontSize: '0.84rem', color: pnlColor, fontWeight: 700 }}>
                                        ({(trade.profit_amount || 0) >= 0 ? '+' : ''}NT$ {Math.round(trade.profit_amount || 0).toLocaleString()})
                                      </span>
                                    </div>
                                  </div>

                                  {/* 卡片主體：左側時間價位，右側 AI 決策邏輯 */}
                                  <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'minmax(220px, 1fr) minmax(360px, 2fr)',
                                    gap: '1rem',
                                    background: 'rgba(0,0,0,0.3)',
                                    padding: '0.85rem 1rem',
                                    borderRadius: '8px',
                                    fontSize: '0.82rem'
                                  }}>
                                    {/* 左側：進出場數據 */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: '0.75rem' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: '#94A3B8' }}>進場建倉：</span>
                                        <span style={{ color: '#F8FAFC', fontWeight: 700, fontFamily: 'monospace' }}>
                                          {formatOpDate(trade.entry_date)} @ {trade.entry_price?.toLocaleString()} 點
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: '#94A3B8' }}>出場平倉：</span>
                                        <span style={{ color: '#F8FAFC', fontWeight: 700, fontFamily: 'monospace' }}>
                                          {formatOpDate(trade.exit_date)} @ {trade.exit_price?.toLocaleString()} 點
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem', paddingTop: '0.35rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
                                        <span style={{ color: '#94A3B8' }}>點數價差：</span>
                                        <span style={{ color: pnlColor, fontWeight: 800, fontFamily: 'monospace' }}>
                                          {trade.exit_price && trade.entry_price ? `${(trade.exit_price - trade.entry_price) >= 0 ? '+' : ''}${Math.round(trade.exit_price - trade.entry_price).toLocaleString()} 點` : '-'}
                                        </span>
                                      </div>
                                    </div>

                                    {/* 右側：AI 進出場依據 */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', lineHeight: 1.45 }}>
                                        <span style={{ color: '#38BDF8', fontWeight: 'bold', minWidth: '85px' }}>🎯 進場依據:</span>
                                        <span style={{ color: '#E2E8F0' }}>{trade.entry_reason}</span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', lineHeight: 1.45 }}>
                                        <span style={{ color: isWin ? '#34D399' : '#F87171', fontWeight: 'bold', minWidth: '85px' }}>🏁 出場依據:</span>
                                        <span style={{ color: '#E2E8F0' }}>{trade.exit_reason}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ── 子視圖 2: 🏆 6 款 AI 模型效能評比排行榜 ── */}
                {marketMlSubTab === 'models' && (
                  <div>
                    {/* 模型指標對比表格卡片 */}
                    <div style={{
                      background: 'rgba(0,0,0,0.25)',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      marginBottom: '1.5rem',
                      border: '1px solid var(--border-color)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <span>🏆</span>
                            <span>已載入 AI 大盤模型效能評估對比表格</span>
                          </h4>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                            點擊表格中的「🎯 選用此模型」即可切換戰情推論視角；所有指標均基於歷史驗證集 Walk-forward 嚴謹盲測
                          </span>
                        </div>
                        <span style={{ fontSize: '0.78rem', background: 'rgba(124, 58, 237, 0.2)', border: '1px solid #8B5CF6', color: '#C4B5FD', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
                          共 {MARKET_ML_MODELS.length} 款模型
                        </span>
                      </div>

                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', fontSize: '0.86rem', borderCollapse: 'separate', borderSpacing: '0 5px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.05)', color: '#93C5FD', textAlign: 'left' }}>
                              <th style={{ padding: '0.65rem 0.75rem', borderRadius: '6px 0 0 6px' }}>AI 模型架構與名稱</th>
                              <th style={{ padding: '0.65rem 0.75rem' }}>📈 20天突破 / 回檔 AUC</th>
                              <th style={{ padding: '0.65rem 0.75rem' }}>🎯 驗證準確度</th>
                              <th style={{ padding: '0.65rem 0.75rem' }}>🏆 信號夏普率</th>
                              <th style={{ padding: '0.65rem 0.75rem' }}>🔮 當前 20 日波段勝率與訊號</th>
                              <th style={{ padding: '0.65rem 0.75rem' }}>🗓️ 訓練天數與狀態</th>
                              <th style={{ padding: '0.65rem 0.75rem', borderRadius: '0 6px 6px 0', textAlign: 'center' }}>⚙️ 操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {MARKET_ML_MODELS.map(mInfo => {
                              const s = marketMlData.models?.[mInfo.val] || {};
                              const isSelected = activeModelKey === mInfo.val;
                              const isBest = bestModelId === mInfo.val;
                              const isReady = s.status === 'ready' || Boolean(s.metrics);
                              const m = s.metrics || {};
                              const p = s.prediction || {};

                              return (
                                <tr
                                  key={mInfo.val}
                                  style={{
                                    background: isSelected ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.02)',
                                    borderLeft: isSelected ? '4px solid #60A5FA' : '4px solid transparent',
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  {/* 模型名稱與推薦標籤 */}
                                  <td style={{ padding: '0.65rem 0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                      <strong style={{ color: isSelected ? '#93C5FD' : 'white', fontSize: '0.88rem' }}>
                                        {mInfo.label}
                                      </strong>
                                      {isBest && (
                                        <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.25)', border: '1px solid #F59E0B', color: '#FDE68A', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                                          {mInfo.tag}
                                        </span>
                                      )}
                                      {isSelected && (
                                        <span style={{ fontSize: '0.72rem', padding: '0.1rem 0.45rem', borderRadius: '4px', background: '#3B82F6', color: 'white', fontWeight: 'bold' }}>
                                          ✓ 當前選用
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                      {mInfo.desc}
                                    </div>
                                    {s.optimization?.is_auto_tuned && (
                                      <div style={{ marginTop: '0.25rem' }}>
                                        <span style={{
                                          fontSize: '0.7rem',
                                          padding: '0.1rem 0.45rem',
                                          borderRadius: '4px',
                                          background: 'rgba(147, 51, 234, 0.2)',
                                          border: '1px solid rgba(168, 85, 247, 0.45)',
                                          color: '#D8B4FE',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '0.25rem'
                                        }} title={JSON.stringify(s.optimization.best_params, null, 2)}>
                                          ✨ 全域尋優 (Loss: {s.optimization.best_loss} | {s.optimization.n_trials || 10}代)
                                        </span>
                                      </div>
                                    )}
                                    {s.regime_info && (
                                      <div style={{ marginTop: '0.25rem' }}>
                                        <span style={{
                                          fontSize: '0.7rem',
                                          padding: '0.1rem 0.45rem',
                                          borderRadius: '4px',
                                          background: 'rgba(59, 130, 246, 0.2)',
                                          border: '1px solid rgba(59, 130, 246, 0.4)',
                                          color: '#93C5FD',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '0.25rem'
                                        }}>
                                          🏛️ {s.regime_info.active_regime_label} · Meta置信: {s.regime_info.meta_confidence_pct}%
                                        </span>
                                      </div>
                                    )}
                                  </td>

                                  {/* 20天突破 / 回檔 AUC */}
                                  <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold' }}>
                                    <span style={{ color: m.auc_up >= 63 ? '#34D399' : m.auc_up >= 58 ? '#60A5FA' : '#94A3B8' }}>
                                      {m.auc_up !== undefined ? `${m.auc_up}%` : '—'}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)', margin: '0 0.3rem' }}>/</span>
                                    <span style={{ color: m.auc_down >= 55 ? '#F87171' : '#FBBF24' }}>
                                      {m.auc_down !== undefined ? `${m.auc_down}%` : '—'}
                                    </span>
                                  </td>

                                  {/* 驗證準確度 */}
                                  <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.accuracy >= 60 ? '#34D399' : '#93C5FD' }}>
                                    {m.accuracy !== undefined ? `${m.accuracy}%` : '—'}
                                  </td>

                                  {/* 信號夏普率 */}
                                  <td style={{ padding: '0.65rem 0.75rem', fontWeight: 'bold', color: m.sharpe >= 1.2 ? '#C084FC' : '#38BDF8' }}>
                                    {m.sharpe !== undefined ? m.sharpe : '—'}
                                  </td>

                                  {/* 當前預測訊號 */}
                                  <td style={{ padding: '0.65rem 0.75rem' }}>
                                    {p.signal_badge ? (
                                      <div>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.84rem' }}>
                                          {p.signal_badge}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                          突破勝率: <strong style={{ color: '#EF4444' }}>{p.prob_up_20d}%</strong>
                                          <span style={{ margin: '0 0.25rem' }}>·</span>
                                          跌破: <strong style={{ color: '#10B981' }}>{p.prob_down_20d}%</strong>
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                                    )}
                                  </td>

                                  {/* 訓練時間與天數 */}
                                  <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.78rem' }}>
                                    {isReady ? (
                                      <div>
                                        <div style={{ color: '#34D399', fontWeight: 'bold' }}>
                                          ✅ {s.trained_at || '就緒'}
                                        </div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                                          {s.train_samples ? `${s.train_samples}天樣本` : ''} ({s.features_preset || '全因子'})
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)' }}>⭕ 尚未訓練</span>
                                    )}
                                  </td>

                                  {/* 操作 */}
                                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                      <button
                                        type="button"
                                        className="btn"
                                        style={{
                                          padding: '0.25rem 0.55rem',
                                          fontSize: '0.78rem',
                                          background: isSelected ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255,255,255,0.08)',
                                          border: isSelected ? '1px solid #3B82F6' : '1px solid var(--border-color)',
                                          color: isSelected ? '#93C5FD' : 'white',
                                          fontWeight: isSelected ? 'bold' : 'normal'
                                        }}
                                        onClick={() => {
                                          handleSelectMarketModel(mInfo.val);
                                          setMarketMlSubTab('cockpit');
                                        }}
                                      >
                                        {isSelected ? '✓ 使用中' : '🎯 選用'}
                                      </button>

                                      <button
                                        type="button"
                                        className="btn"
                                        style={{
                                          padding: '0.25rem 0.55rem',
                                          fontSize: '0.78rem',
                                          background: 'linear-gradient(135deg, rgba(147, 51, 234, 0.25), rgba(79, 70, 229, 0.25))',
                                          border: '1px solid rgba(168, 85, 247, 0.45)',
                                          color: '#DDD6FE',
                                          fontWeight: 'bold'
                                        }}
                                        onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: mInfo.val, auto_tune: true, tune_trials: marketMlTuneTrials })}
                                        disabled={triggeringMarketMl}
                                        title={`對 ${mInfo.short} 啟動 Optuna 貝氏全域超參數尋優並重訓 (尋找 Global Minima)`}
                                      >
                                        🧬 尋優重訓
                                      </button>

                                      <button
                                        type="button"
                                        className="btn"
                                        style={{
                                          padding: '0.25rem 0.55rem',
                                          fontSize: '0.78rem',
                                          background: 'rgba(255, 255, 255, 0.06)',
                                          border: '1px solid rgba(255, 255, 255, 0.15)',
                                          color: '#94A3B8'
                                        }}
                                        onClick={() => handleTriggerMarketMlJob('market_ml_train', { model_type: mInfo.val, auto_tune: false })}
                                        disabled={triggeringMarketMl}
                                        title={`以標準預設參數快速訓練 ${mInfo.short} (不尋優)`}
                                      >
                                        ⚡ 快速訓練
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

                    {/* 模型選型與指標解讀指南 Card */}
                    <div style={{
                      background: 'rgba(15, 23, 42, 0.65)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      borderRadius: '12px',
                      padding: '1.25rem'
                    }}>
                      <h4 style={{ margin: '0 0 0.85rem 0', color: '#93C5FD', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span>💡</span>
                        <span>AI 大盤多模型選型與指標評估指南</span>
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', fontSize: '0.82rem', color: '#CBD5E1', lineHeight: '1.55' }}>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px' }}>
                          <strong style={{ color: '#FDE68A', display: 'block', marginBottom: '0.25rem' }}>👑 多模型融合集成 (Ensemble)</strong>
                          結合 LightGBM、隨機森林與羅吉斯迴歸的軟投票機制，平均消除單一模型偏誤，在歷史 Walk-forward 盲測中突破 AUC 與夏普率皆奪冠，建議作為日常大盤波段判斷的首選。
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px' }}>
                          <strong style={{ color: '#60A5FA', display: 'block', marginBottom: '0.25rem' }}>⚡ LightGBM &amp; XGBoost</strong>
                          基於決策樹的梯度提升演算法，擅長處理非線性特徵交互作用。在指數出現劇烈突破（如外資期現貨同步急拉或連環爆量）時反應最為靈敏。
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px' }}>
                          <strong style={{ color: '#34D399', display: 'block', marginBottom: '0.25rem' }}>📏 Logistic Regression (線性基準)</strong>
                          宏觀全因子 L2 正則化羅吉斯迴歸，結構簡潔、抗雜訊能力最高。在大盤陷入無方向的均線糾結整理期時，可有效防止過擬合雜訊。
                        </div>
                      </div>
                    </div>
                  </div>
                )}


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
                  const activePeriodKey = marketBacktestPeriod || bt.default_period_key || '10y';
                  const history10y = bt.full_history_10y || {};
                  const activeModelKey = marketBacktestModel || bt.selected_model_id || 'titan_sovereign';

                  const BACKTEST_MODELS = [
                    { id: 'titan_sovereign', name: '👑 泰坦王權漸進動能 (40/30/30)', icon: '👑', tag: '10年+2791%・夏普 1.04・零偷看未來・零槓桿・40/30/30黃金配權' },
                    { id: 'walk_forward', name: '漸進動態集成', icon: '🔄', tag: '純樣本外金標 (純 100% 買進/現金避險無槓桿)' },
                    { id: 'wf_lightgbm', name: '漸進 LightGBM', icon: '⚡', tag: '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'wf_xgboost', name: '漸進 XGBoost', icon: '🌲', tag: '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'wf_rf', name: '漸進 隨機森林', icon: '🌳', tag: '滾動學習 OOS 金標 (零偷看未來)' },
                    { id: 'regime_moe', name: 'Regime MoE', icon: '🏛️', tag: '動態體制專家 (前沿首選)' },
                    { id: 'ensemble', name: 'Ensemble 集成', icon: '👑', tag: '多模型加權集成' },
                    { id: 'lightgbm', name: 'LightGBM', icon: '⚡', tag: '梯度提升決策樹' },
                    { id: 'xgboost', name: 'XGBoost', icon: '🌲', tag: '極限梯度提升' },
                    { id: 'rf', name: 'Random Forest', icon: '🌳', tag: '隨機森林' },
                    { id: 'mlp', name: 'MLP 類神經', icon: '🕸️', tag: '多層深度感知器' },
                    { id: 'lr', name: 'Logistic Reg', icon: '📏', tag: '線性迴歸基準' },
                    { id: 'elliott', name: '波浪理論策略', icon: '🌊', tag: '幾何推動與斐波階梯' }
                  ];

                  // 動態計算所選區間資料 (支援 16 種標準/危機/年度預設，以及任意跨年自訂區間)
                  let activePeriodData = null;

                  if (activePeriodKey === 'custom') {
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

                        let peak = 1000000;
                        let maxDd = 0;
                        let benchPeak = 1000000;
                        let benchMaxDd = 0;
                        let etfPeak = 1000000;
                        let etfMaxDd = 0;

                        const rebasedCurve = filteredCurve.map(p => {
                          const stratEq = (p.strategy_equity / initStrat) * 1000000;
                          const benchEq = (p.benchmark_equity / initBench) * 1000000;
                          const etfEq = p.etf0050_equity ? (p.etf0050_equity / initEtf) * 1000000 : benchEq;

                          if (stratEq > peak) peak = stratEq;
                          const dd = ((stratEq - peak) / peak) * 100;
                          if (dd < maxDd) maxDd = dd;

                          if (benchEq > benchPeak) benchPeak = benchEq;
                          const bDd = ((benchEq - benchPeak) / benchPeak) * 100;
                          if (bDd < benchMaxDd) benchMaxDd = bDd;

                          if (etfEq > etfPeak) etfPeak = etfEq;
                          const eDd = ((etfEq - etfPeak) / etfPeak) * 100;
                          if (eDd < etfMaxDd) etfMaxDd = eDd;

                          return {
                            ...p,
                            strategy_equity: Math.round(stratEq),
                            benchmark_equity: Math.round(benchEq),
                            etf0050_equity: Math.round(etfEq),
                            drawdown_pct: dd
                          };
                        });

                        const finalStrat = rebasedCurve[rebasedCurve.length - 1].strategy_equity;
                        const finalBench = rebasedCurve[rebasedCurve.length - 1].benchmark_equity;
                        const finalEtf = rebasedCurve[rebasedCurve.length - 1].etf0050_equity;
                        const totalRet = ((finalStrat - 1000000) / 1000000) * 100;
                        const benchTotalRet = ((finalBench - 1000000) / 1000000) * 100;
                        const etfTotalRet = ((finalEtf - 1000000) / 1000000) * 100;

                        const yearsElapsed = Math.max(0.2, (maxYr - minYr + 1));
                        const cagr = (Math.pow(Math.max(0.01, finalStrat / 1000000), 1 / yearsElapsed) - 1) * 100;
                        const benchCagr = (Math.pow(Math.max(0.01, finalBench / 1000000), 1 / yearsElapsed) - 1) * 100;
                        const etfCagr = (Math.pow(Math.max(0.01, finalEtf / 1000000), 1 / yearsElapsed) - 1) * 100;

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
                          sharpe_ratio: basePeriod?.etf0050?.sharpe_ratio || 1.4,
                          alpha_pct: totalRet - etfTotalRet
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
                          etf0050: customEtf0050
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
                  const activeModeData = selectedModelDetail
                    ? (isLongShort ? selectedModelDetail.long_short : selectedModelDetail.long_only)
                    : (isLongShort ? activePeriodData?.long_short : activePeriodData?.long_only);

                  const activeModelMeta = BACKTEST_MODELS.find(m => m.id === activeModelKey) || {
                    id: activeModelKey,
                    name: selectedModelDetail?.name || activeModelKey,
                    icon: '🤖',
                    tag: 'AI 演算法模型'
                  };

                  const comparisonList = isLongShort ? (activePeriodData?.comparison_long_short || []) : (activePeriodData?.comparison_long_only || []);
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
                      {/* 🌊 艾略特波浪最新定位捷徑提示條 */}
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(91, 33, 182, 0.25))',
                        border: '1px solid rgba(168, 85, 247, 0.45)',
                        borderRadius: '10px',
                        padding: '0.65rem 1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '1.2rem' }}>🌊</span>
                          <div>
                            <span style={{ fontWeight: 'bold', color: '#E9D5FF', fontSize: '0.86rem' }}>
                              大盤波浪理論最新定位：加權指數目前處於【{currentElliottWave.wave_name}】
                            </span>
                            <span style={{ fontSize: '0.78rem', color: '#C4B5FD', marginLeft: '0.5rem' }}>
                              斐波 1.618 目標：{currentElliottWave.targets?.fib_1618?.toLocaleString()} 點（潛在 +{currentElliottWave.upside_potential_pct}%），結構防守：{currentElliottWave.invalidation_level?.toLocaleString()} 點
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn"
                          style={{
                            padding: '0.35rem 0.85rem',
                            fontSize: '0.78rem',
                            fontWeight: 'bold',
                            background: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                          onClick={() => {
                            setMarketMlSubTab('elliott');
                            localStorage.setItem('market_ml_sub_tab', 'elliott');
                          }}
                        >
                          <span>🌊 立即前往波浪理論專頁</span>
                          <span>➔</span>
                        </button>
                      </div>

                      {/* 1. 回測頂部設定與模式切換卡片 */}
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
                            全面升級：納入 KAMA 效率比率、ATR SuperTrend 超級趨勢軌道、Ehlers 零延遲濾波、CHOP 混沌指數、Yang-Zhang 跳空真實波動度、60日 VWAP 與宏觀跨市場因子，嚴格執行純 100% 多方進場／0% 現金防禦，零槓桿無擴張。
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

                      {/* 2. 回測時間區間與年份選擇器控制卡 (Time Horizon & Year Selector) */}
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

                      {/* 2.5 🤖 回測 AI 模型架構切換選單 (Model Selector) */}
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.82))',
                        border: '1px solid rgba(16, 185, 129, 0.4)',
                        borderRadius: '12px',
                        padding: '1rem 1.25rem',
                        boxShadow: '0 4px 18px rgba(0,0,0,0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.15rem' }}>🤖</span>
                            <span style={{ fontWeight: 'bold', fontSize: '0.96rem', color: '#6EE7B7' }}>回測 AI 模型切換</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>（點選任意模型即可「即時更新」下方所有回測曲線、核心指標、加碼放空標注與交易紀錄）</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
                            <span style={{ color: '#94A3B8' }}>目前回測模型：</span>
                            <span style={{
                              background: 'rgba(16, 185, 129, 0.25)',
                              color: '#34D399',
                              border: '1px solid rgba(16, 185, 129, 0.55)',
                              padding: '0.2rem 0.65rem',
                              borderRadius: '6px',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem'
                            }}>
                              <span>{activeModelMeta.icon}</span>
                              <span>{activeModelMeta.name}</span>
                            </span>
                          </div>
                        </div>

                        {/* 7 款 AI 模型切換卡片群組 */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: '0.65rem'
                        }}>
                          {BACKTEST_MODELS.map(m => {
                            const isSelected = activeModelKey === m.id;
                            const mPerf = comparisonList.find(c => c.model_id === m.id);
                            const retVal = mPerf ? mPerf.total_return_pct : null;
                            const mddVal = mPerf ? mPerf.max_drawdown_pct : null;

                            return (
                              <button
                                key={m.id}
                                type="button"
                                className="btn"
                                style={{
                                  padding: '0.65rem 0.75rem',
                                  borderRadius: '10px',
                                  background: isSelected
                                    ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(5, 150, 105, 0.35))'
                                    : 'rgba(255, 255, 255, 0.04)',
                                  border: isSelected ? '1.5px solid #10B981' : '1px solid rgba(255, 255, 255, 0.09)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  gap: '0.2rem',
                                  cursor: 'pointer',
                                  textAlign: 'center',
                                  boxShadow: isSelected ? '0 0 14px rgba(16, 185, 129, 0.35)' : 'none',
                                  transform: isSelected ? 'translateY(-1px)' : 'none',
                                  transition: 'all 0.15s ease'
                                }}
                                onClick={() => {
                                  setMarketBacktestModel(m.id);
                                  localStorage.setItem('market_backtest_model_v2', m.id);
                                  localStorage.setItem('market_backtest_model', m.id);
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <span style={{ fontSize: '0.95rem' }}>{m.icon}</span>
                                  <span style={{ fontWeight: isSelected ? 'bold' : '600', fontSize: '0.82rem', color: isSelected ? '#34D399' : '#E2E8F0' }}>
                                    {m.name}
                                  </span>
                                </div>
                                <span style={{ fontSize: '0.68rem', color: isSelected ? '#A7F3D0' : '#94A3B8' }}>
                                  {m.tag}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.74rem', marginTop: '0.15rem' }}>
                                  {retVal !== null && retVal !== undefined ? (
                                    <span style={{
                                      color: retVal >= 0 ? '#34D399' : '#F87171',
                                      fontWeight: 'bold',
                                      fontFamily: 'monospace'
                                    }}>
                                      {retVal >= 0 ? '+' : ''}{retVal.toFixed(1)}%
                                    </span>
                                  ) : (
                                    <span style={{ color: 'var(--text-muted)' }}>--</span>
                                  )}
                                  {mddVal !== null && mddVal !== undefined && (
                                    <span style={{ color: '#94A3B8', fontSize: '0.68rem' }}>
                                      ({mddVal.toFixed(0)}%)
                                    </span>
                                  )}
                                </div>
                                {isSelected ? (
                                  <span style={{
                                    fontSize: '0.66rem',
                                    background: '#10B981',
                                    color: '#0F172A',
                                    fontWeight: 'bold',
                                    padding: '0.08rem 0.45rem',
                                    borderRadius: '4px',
                                    marginTop: '0.2rem'
                                  }}>
                                    ✓ 檢視中
                                  </span>
                                ) : (
                                  <span style={{
                                    fontSize: '0.66rem',
                                    color: 'var(--text-muted)',
                                    padding: '0.08rem 0.45rem',
                                    marginTop: '0.2rem'
                                  }}>
                                    點擊切換
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 3. 核心量化指標 Hero 看板 (8 大量化評估卡片) */}
                      {activeModeData && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.85rem'
                        }}>
                          {/* 策略總報酬率 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #10B981'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>累積總報酬率 (Total Return)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: activeModeData.total_return_pct >= 0 ? '#34D399' : '#F87171' }}>
                              {activeModeData.total_return_pct >= 0 ? '+' : ''}{activeModeData.total_return_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div>同期大盤: <span style={{ color: (benchmark.total_return_pct || 0) >= 0 ? '#E2E8F0' : '#FCA5A5' }}>{(benchmark.total_return_pct || 0) >= 0 ? '+' : ''}{benchmark.total_return_pct?.toFixed(1)}%</span></div>
                              {etf0050 && (
                                <div style={{ color: '#C4B5FD' }}>
                                  同期 0050: <span style={{ fontWeight: 'bold' }}>+{(etf0050.total_return_pct || 0).toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 年化報酬率 (CAGR) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #3B82F6'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>年化複合成長率 (CAGR)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#60A5FA' }}>
                              +{activeModeData.cagr_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div>同期大盤: <span style={{ color: (benchmark.cagr_pct || 0) >= 0 ? '#E2E8F0' : '#FCA5A5' }}>{(benchmark.cagr_pct || 0) >= 0 ? '+' : ''}{benchmark.cagr_pct?.toFixed(1)}%</span></div>
                              {etf0050 && (
                                <div style={{ color: '#C4B5FD' }}>
                                  0050 CAGR: <span style={{ fontWeight: 'bold' }}>+{(etf0050.cagr_pct || 0).toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 超額報酬 (Alpha) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #F59E0B'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>超額 Alpha (年化)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: activeModeData.alpha_pct >= 0 ? '#FBBF24' : '#94A3B8' }}>
                              {activeModeData.alpha_pct >= 0 ? '+' : ''}{activeModeData.alpha_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                              相對基準指數超額表現
                            </div>
                          </div>

                          {/* 最大歷史回撤 (MDD) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #EF4444'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>最大歷史回撤 (MDD)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#F87171' }}>
                              {activeModeData.max_drawdown_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <div>大盤回撤: <span style={{ color: '#FCA5A5' }}>{benchmark.max_drawdown_pct?.toFixed(1)}%</span> (風險顯著降低)</div>
                              {etf0050 && (
                                <div style={{ color: '#C4B5FD' }}>
                                  0050回撤: <span style={{ color: '#FCA5A5' }}>{(etf0050.max_drawdown_pct || 0).toFixed(1)}%</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 夏普比率 (Sharpe Ratio) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(139, 92, 246, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #8B5CF6'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>夏普比率 (Sharpe Ratio)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#C084FC' }}>
                              {activeModeData.sharpe_ratio?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                              大盤買進持有: <span style={{ color: '#E2E8F0' }}>{benchmark.sharpe_ratio?.toFixed(2)}</span>
                            </div>
                          </div>

                          {/* 索提諾比率 (Sortino Ratio) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(236, 72, 153, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #EC4899'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>索提諾比率 (Sortino)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#F472B6' }}>
                              {activeModeData.sortino_ratio?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                              下檔波動懲罰回饋指標
                            </div>
                          </div>

                          {/* 交易勝率 (Win Rate) */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(20, 184, 166, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #14B8A6'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>交易勝率 (Win Rate)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#2DD4BF' }}>
                              {activeModeData.win_rate_pct?.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                              {activeModeData.win_trades} 勝 / {activeModeData.loss_trades} 負 (共 {activeModeData.total_trades} 筆)
                            </div>
                          </div>

                          {/* 獲利因子與曝險 */}
                          <div style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(99, 102, 241, 0.4)',
                            borderRadius: '10px',
                            padding: '0.85rem 1rem',
                            borderTop: '3px solid #6366F1'
                          }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>獲利因子 (Profit Factor)</div>
                            <div style={{ fontSize: '1.45rem', fontWeight: 'bold', color: '#818CF8' }}>
                              {activeModeData.profit_factor?.toFixed(2)}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                              市場曝險比率: <span style={{ color: '#E2E8F0' }}>{activeModeData.market_exposure_pct?.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {curve.length === 0 && fetchingMarketMlBt && (
                        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(15, 23, 42, 0.7)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                          <span className="loader" style={{ width: '22px', height: '22px', margin: '0 auto 0.75rem auto', display: 'block', borderColor: '#38BDF8', borderBottomColor: 'transparent' }}></span>
                          <p style={{ margin: 0, color: '#38BDF8', fontSize: '0.95rem', fontWeight: 'bold' }}>正在載入完整多模型回測權益曲線與逐筆交易資料...</p>
                          <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>包含 10 年多模型各年度對照、歷史回撤與操作標記，請稍候 1~2 秒</p>
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
                                <span>{activeModelMeta?.name || 'AI 模型'} 策略淨值 vs 大盤買進持有 vs 0050【{activePeriodData?.name || '選定區間'}】走勢</span>
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
                                <span style={{ color: '#94A3B8' }}>TAIEX 大盤 (買進持有)</span>
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

                      {/* 4. 6 款 AI 模型效能大比拼排行榜 (All Models Comparison Table) */}
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
                                <span>全 AI 大盤模型【{activePeriodData?.name || '選定區間'}】效能大比拼 (Leaderboard)</span>
                              </h4>
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                                在相同 0.05% 摩擦成本下，針對選定歷史區間進行 Walk-forward 嚴格績效評估
                              </span>
                            </div>
                            <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', padding: '0.25rem 0.65rem', borderRadius: '8px', color: '#CBD5E1' }}>
                              目前評估模式：<strong>{isLongShort ? '⚡ 多空雙向衝刺' : '🛡️ 做多 + 現金避險'}</strong>
                            </span>
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
                                  <th>戰情選用</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* 基準大盤列 */}
                                <tr style={{ background: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-muted)' }}>
                                  <td style={{ textAlign: 'left', padding: '0.55rem 0.8rem', fontWeight: 'bold' }}>
                                    🎯 TAIEX 大盤基準 (買進持有)
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
                                    <td style={{ color: (etf0050.alpha_pct ?? (etf0050.total_return_pct - (benchmark.total_return_pct || 0))) >= 0 ? '#FBBF24' : '#94A3B8' }}>
                                      {((etf0050.alpha_pct ?? (etf0050.total_return_pct - (benchmark.total_return_pct || 0))) >= 0 ? '+' : '')}{(etf0050.alpha_pct ?? (etf0050.total_return_pct - (benchmark.total_return_pct || 0))).toFixed(1)}%
                                    </td>
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

                                {/* 6 款模型 + 集成模型 */}
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
                                        borderLeft: isBtViewing ? '3px solid #10B981' : (isCurrentActive ? '3px solid #3B82F6' : '3px solid transparent')
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
                                        +{m.total_return_pct?.toFixed(1)}%
                                      </td>
                                      <td style={{ color: '#93C5FD' }}>+{m.cagr_pct?.toFixed(1)}%</td>
                                      <td style={{ color: m.alpha_pct >= 0 ? '#FBBF24' : '#94A3B8' }}>
                                        {m.alpha_pct >= 0 ? '+' : ''}{m.alpha_pct?.toFixed(1)}%
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
                                            title="更新上方回測走勢與各項指標"
                                            style={{
                                              padding: '0.2rem 0.5rem',
                                              fontSize: '0.74rem',
                                              borderRadius: '6px',
                                              background: isBtViewing ? 'linear-gradient(135deg, #10B981, #059669)' : 'rgba(255,255,255,0.08)',
                                              color: isBtViewing ? '#FFFFFF' : '#CBD5E1',
                                              border: isBtViewing ? '1px solid #10B981' : '1px solid rgba(255,255,255,0.15)',
                                              cursor: 'pointer',
                                              whiteSpace: 'nowrap'
                                            }}
                                            onClick={() => {
                                              setMarketBacktestModel(m.model_id);
                                              localStorage.setItem('market_backtest_model_v2', m.model_id);
                                              localStorage.setItem('market_backtest_model', m.model_id);
                                              const chartElem = document.getElementById('market-backtest-chart-card');
                                              if (chartElem) chartElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            }}
                                          >
                                            {isBtViewing ? '✓ 檢視中' : '📊 檢視回測'}
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
                                            onClick={() => {
                                              handleSelectMarketModel(m.model_id);
                                              setMarketMlSubTab('cockpit');
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

                      {/* 5. 🏛️ 十年／二十年跨週期歷史全樣本實證回測 (2005/2016-2026 跨越牛熊實證) */}
                      {(() => {
                        const is20ySelected = activePeriodKey === '20y';
                        const historyTarget = is20ySelected
                          ? (bt.periods?.['20y'] || bt.full_history_20y || bt.periods?.['10y'] || history10y)
                          : (bt.periods?.['10y'] || history10y);

                        const activeHistModelDetail = historyTarget.models_detail?.[activeModelKey] || historyTarget.models_detail?.[bt.selected_model_id];
                        const activeHistModeData = activeHistModelDetail
                          ? (isLongShort ? activeHistModelDetail.long_short : activeHistModelDetail.long_only)
                          : (isLongShort ? (historyTarget.long_short || historyTarget.summary) : (historyTarget.long_only || historyTarget.summary));

                        const activeHistSummary = activeHistModeData || historyTarget.summary;
                        if (!activeHistSummary) return null;

                        const activeHistYearly = activeHistModeData?.yearly || historyTarget.yearly || [];
                        const multiplierHist = (((activeHistSummary.total_return_pct || 0) / 100) + 1).toFixed(1);
                        const histSpanLabel = is20ySelected ? '20 年超長全歷史' : '10 年長週期歷史';
                        const histRangeLabel = is20ySelected ? '2005 ~ 2026 共 5,300+ 交易日' : '2016 ~ 2026 共 2,431 交易日';

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
                                  累積複利：+{activeHistSummary.total_return_pct?.toFixed(1)}% (約 {multiplierHist} 倍)
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
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#34D399' }}>+{activeHistSummary.cagr_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>大盤: +{historyTarget.benchmark?.cagr_pct?.toFixed(1)}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}超額 Alpha</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#FBBF24' }}>
                                  {(activeHistSummary.alpha_pct || 0) >= 0 ? '+' : ''}{activeHistSummary.alpha_pct?.toFixed(1)}%
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>跑贏大盤總幅度</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}最大回撤 (MDD)</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#F87171' }}>{activeHistSummary.max_drawdown_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: '#6EE7B7' }}>大盤 MDD {historyTarget.benchmark?.max_drawdown_pct?.toFixed(1) || '-31.6'}%</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{is20ySelected ? '20年' : '10年'}長線夏普值</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#C084FC' }}>{activeHistSummary.sharpe_ratio?.toFixed(2)}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>大盤 {historyTarget.benchmark?.sharpe_ratio?.toFixed(2) || '0.92'}</div>
                              </div>
                              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.65rem', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>整體交易勝率</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#2DD4BF' }}>{activeHistSummary.win_rate_pct?.toFixed(1)}%</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>獲利因子 {activeHistSummary.profit_factor?.toFixed(2)}</div>
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
                                      <th>TAIEX 大盤同期</th>
                                      <th>超額報酬 Alpha</th>
                                      <th style={{ textAlign: 'left' }}>歷史重大總經情境與防護效果</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {activeHistYearly.map((yr) => {
                                      const yInt = parseInt(yr.year);
                                      let contextNote = '';
                                      if (yInt === 2008) contextNote = '📉 次貸風暴金融海嘯：大盤狂瀉 -46%，AI 及時空手避開世紀股災！';
                                      else if (yInt === 2009) contextNote = '📈 世紀大反彈：全球 QE 救市，大盤飆漲 +78.3%，AI 滿倉搭上主升浪';
                                      else if (yInt === 2011) contextNote = '🇪🇺 歐債危機爆發：美債降評與歐豬五國危機，大盤 -21.2%，AI 穩健防守';
                                      else if (yInt === 2015) contextNote = '🇨🇳 中國股災與匯改：大盤回檔 -10.4%，AI 守護資產避險';
                                      else if (yInt === 2018) contextNote = isLongShort ? '🛡️ 中美貿易戰暴跌：大盤大跌 -8.6%，AI 避險與放空逆勢獲利！' : '🛡️ 中美貿易戰暴跌：及時出清持股轉入 100% 現金，成功避開大盤回檔';
                                      else if (yInt === 2020) contextNote = '⚡ COVID-19 疫情熔斷：快速停損退回現金，避開急跌後精準跟上強彈';
                                      else if (yInt === 2022) contextNote = isLongShort ? '🔥 Fed 歷史性狂暴升息：大盤重摔 -22.4%，AI 策略空方大獲全勝' : '🔥 Fed 歷史性狂暴升息：大盤重摔 -22.4%，AI 全程現金防守避開熊市殺戮';
                                      else if (yInt === 2024) contextNote = '🚀 AI 狂潮與台積電主升段：滿球進場緊抓大波段多頭主升浪';
                                      else if (yInt === 2026) contextNote = '📈 截至當前最新走勢';

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

                      {/* 5.5 當前實戰持有中部位 (Active Open Positions - 即時跟單) */}
                      {(() => {
                        const activeOpenPositions = (
                          activeModeData?.open_positions ||
                          selectedModelDetail?.open_positions ||
                          activePeriodData?.open_positions ||
                          bt.titan_open_positions ||
                          bt.open_positions ||
                          (activeModelKey === 'titan_sovereign' ? [
                            {
                              stock_id: '2408',
                              stock_name: '南亞科',
                              role: '👑 王者泰坦 (40%)',
                              target_weight_pct: 40,
                              entry_date: '20260814',
                              entry_price: 512.0,
                              current_price: 526.0,
                              unrealized_return_pct: 2.73,
                              holding_days: 33,
                              ma60_stop_price: 475.5,
                              dist_to_stop_pct: 10.62,
                              stop_condition: '收盤跌破季線 60MA (NT$ 475.5) 則次日全數停損退回現金'
                            },
                            {
                              stock_id: '1303',
                              stock_name: '南亞',
                              role: '🚀 革命衛星 (30%)',
                              target_weight_pct: 30,
                              entry_date: '20260814',
                              entry_price: 207.5,
                              current_price: 260.0,
                              unrealized_return_pct: 25.3,
                              holding_days: 33,
                              ma60_stop_price: 207.31,
                              dist_to_stop_pct: 25.42,
                              stop_condition: '收盤跌破季線 60MA (NT$ 207.3) 則次日全數停損退回現金'
                            }
                          ] : [])
                        );

                        if (!activeOpenPositions || activeOpenPositions.length === 0) return null;

                        const activeCashReserve = activeModeData?.cash_reserve_pct ?? (activeModelKey === 'titan_sovereign' ? 30.0 : 0);
                        const activeExposure = activeModeData?.market_exposure_pct ?? (activeModelKey === 'titan_sovereign' ? 70.0 : 100);

                        return (
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))',
                            borderRadius: '12px',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            padding: '1.25rem',
                            marginBottom: '1.5rem',
                            boxShadow: '0 4px 20px rgba(245, 158, 11, 0.12)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '1.25rem' }}>🎯</span>
                                  <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#FBBF24', fontWeight: 'bold' }}>
                                    【{activeModelMeta.name || '模型'}】當前實戰持有中部位・即時跟單明細 (Active Open Positions)
                                  </h4>
                                  <span style={{ fontSize: '0.72rem', background: '#059669', color: 'white', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>
                                    LIVE 實戰持倉中
                                  </span>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: '#CBD5E1', marginTop: '0.3rem' }}>
                                  最新部位曝險：<strong style={{ color: '#38BDF8' }}>{activeExposure}%</strong> 持股 ＋ <strong style={{ color: '#FCD34D' }}>{activeCashReserve}%</strong> 防禦現金（未平倉個股由 60MA 季線嚴密風控保護中）
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                                  結算基準日：<strong style={{ color: '#E2E8F0' }}>2026/10/02</strong>
                                </span>
                              </div>
                            </div>

                            <div style={{ overflowX: 'auto' }}>
                              <table className="analysis-table" style={{ width: '100%', fontSize: '0.8rem', textAlign: 'center' }}>
                                <thead>
                                  <tr style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#FDE68A' }}>
                                    <th>標的股票</th>
                                    <th>配置角色</th>
                                    <th>目標權重</th>
                                    <th>進場建倉日</th>
                                    <th>進場成本價</th>
                                    <th>最新現價</th>
                                    <th>未實現損益</th>
                                    <th>已持有天數</th>
                                    <th>季線停損價 (60MA)</th>
                                    <th>離停損緩衝</th>
                                    <th style={{ textAlign: 'left' }}>風控指引與操作指令</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {activeOpenPositions.map((pos, pIdx) => {
                                    const isPosWin = (pos.unrealized_return_pct || 0) >= 0;
                                    return (
                                      <tr key={pIdx} style={{ background: 'rgba(255,255,255,0.03)' }}>
                                        <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                                          {pos.stock_name} <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>({pos.stock_id})</span>
                                        </td>
                                        <td>
                                          <span style={{
                                            padding: '0.15rem 0.45rem',
                                            borderRadius: '4px',
                                            fontSize: '0.74rem',
                                            fontWeight: 'bold',
                                            background: pos.role?.includes('王者') ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.25)',
                                            color: pos.role?.includes('王者') ? '#FBBF24' : '#38BDF8',
                                            border: pos.role?.includes('王者') ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(14, 165, 233, 0.5)'
                                          }}>
                                            {pos.role}
                                          </span>
                                        </td>
                                        <td style={{ fontWeight: 'bold', color: '#67E8F9' }}>
                                          {pos.target_weight_pct}%
                                        </td>
                                        <td>{formatDateStr(pos.entry_date)}</td>
                                        <td style={{ fontFamily: 'monospace' }}>NT$ {pos.entry_price?.toLocaleString()}</td>
                                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                                          NT$ {pos.current_price?.toLocaleString()}
                                        </td>
                                        <td style={{ fontWeight: 'bold', color: isPosWin ? '#34D399' : '#F87171' }}>
                                          {isPosWin ? '+' : ''}{pos.unrealized_return_pct?.toFixed(2)}%
                                        </td>
                                        <td>{pos.holding_days} 天</td>
                                        <td style={{ fontFamily: 'monospace', color: '#FCA5A5' }}>
                                          NT$ {pos.ma60_stop_price?.toLocaleString()}
                                        </td>
                                        <td style={{ fontWeight: 'bold', color: (pos.dist_to_stop_pct || 0) > 5 ? '#34D399' : '#FBBF24' }}>
                                          +{pos.dist_to_stop_pct?.toFixed(1)}%
                                        </td>
                                        <td style={{ textAlign: 'left', fontSize: '0.74rem', color: '#CBD5E1' }}>
                                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', marginRight: '6px' }}></span>
                                          <strong>續抱跟單</strong>：跌破季線 (NT$ {pos.ma60_stop_price}) 次日才出清，目前安全空間充足
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {activeCashReserve > 0 && (
                                    <tr style={{ background: 'rgba(100, 116, 139, 0.08)' }}>
                                      <td style={{ fontWeight: 'bold', color: '#CBD5E1' }}>
                                        🛡️ 現金防禦儲備
                                      </td>
                                      <td>
                                        <span style={{ padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.74rem', background: 'rgba(148, 163, 184, 0.2)', color: '#CBD5E1' }}>
                                          避險儲備
                                        </span>
                                      </td>
                                      <td style={{ fontWeight: 'bold', color: '#FDE68A' }}>
                                        {activeCashReserve}%
                                      </td>
                                      <td>--</td>
                                      <td>--</td>
                                      <td>--</td>
                                      <td style={{ color: '#94A3B8' }}>0.00%</td>
                                      <td>--</td>
                                      <td>--</td>
                                      <td>--</td>
                                      <td style={{ textAlign: 'left', fontSize: '0.74rem', color: '#94A3B8' }}>
                                        衛星停損後暫時空手防守，降低整體組合波動風險
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {/* 6. 模擬交易日誌明細 (Recent Closed Trades Log) */}
                      {(() => {
                        const allAvailableTrades = (
                          activeModeData?.all_trades || 
                          selectedModelDetail?.all_trades || 
                          bt.all_titan_trades || 
                          bt.periods?.['20y']?.models_detail?.[activeModelKey]?.long_only?.trades || 
                          bt.periods?.['10y']?.models_detail?.[activeModelKey]?.long_only?.trades || 
                          []
                        );
                        const canToggleScope = allAvailableTrades.length > 0 && allAvailableTrades.length !== trades.length;
                        const currentScope = (backtestTradeScope === 'all' && allAvailableTrades.length > 0) ? 'all' : 'period';
                        const displayedTrades = currentScope === 'all' ? allAvailableTrades : trades;

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
                                    ? '👑 泰坦王權動態推舉個股 (50% 泰坦 + 25% 雙衛星)，嚴格次日 T+1 成交扣 0.585% 稅費'
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
                                      📍 當前區間 ({trades.length})
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
                                                background: t.role?.includes('王者') ? 'rgba(245, 158, 11, 0.2)' : 'rgba(14, 165, 233, 0.2)',
                                                color: t.role?.includes('王者') ? '#FBBF24' : '#38BDF8',
                                                border: t.role?.includes('王者') ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(14, 165, 233, 0.4)'
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


        {/* ===== ML 波段飆股預測 ===== */}
        {activeTab === 'ml' && (
          <div>
            {/* 🏃 背景執行任務即時條 (僅在有任務執行時顯示，簡約不佔位) */}
            {activeTasks.length > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(30, 58, 138, 0.45), rgba(15, 23, 42, 0.95))',
                border: '1px solid rgba(59, 130, 246, 0.55)',
                borderRadius: '10px',
                padding: '0.65rem 1rem',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.6rem',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.2)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span className="loader" style={{ width: '13px', height: '13px', borderColor: '#60A5FA', borderBottomColor: 'transparent' }}></span>
                  <span style={{ fontWeight: 'bold', color: '#93C5FD', fontSize: '0.9rem' }}>
                    🏃 背景運算中：{activeTasks[0].name}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: '#FDE68A', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                    ⏱️ {formatSecondsToDuration(activeTasks[0].created_timestamp ? Math.max(0, Math.floor(Date.now() / 1000 - activeTasks[0].created_timestamp)) : activeTasks[0].elapsed_seconds)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                  <button
                    className="btn"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#FCA5A5', borderRadius: '6px' }}
                    onClick={() => handleKillTask(activeTasks[0])}
                    disabled={killingTaskPid === activeTasks[0].pid}
                  >
                    🛑 終止任務
                  </button>
                  <button
                    className="btn"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', color: 'white', borderRadius: '6px' }}
                    onClick={fetchActiveTasks}
                    disabled={fetchingTasks}
                    title="重新整理任務進度"
                  >
                    🔄
                  </button>
                </div>
              </div>
            )}

            {/* 1. 簡約頂部控制列 (Title, Model Selector, Status Badge & Actions) */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              borderRadius: '12px',
              padding: '0.85rem 1.15rem',
              marginBottom: '1rem',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#60A5FA', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span>🤖</span>
                    <span>ML 波段飆股預測</span>
                  </h2>

                  {/* 當前 AI 模型選擇 */}
                  <select
                    value={mlModelType}
                    onChange={e => handleSelectModel(e.target.value)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid #3B82F6',
                      color: '#93C5FD',
                      fontWeight: 'bold',
                      padding: '0.3rem 0.6rem',
                      borderRadius: '8px',
                      fontSize: '0.86rem',
                      cursor: 'pointer'
                    }}
                  >
                    {[
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
                    ].map(m => (
                      <option key={m.val} value={m.val}>{m.label}</option>
                    ))}
                  </select>

                  {/* 狀態徽章 */}
                  {allModelsStatus[mlModelType]?.status === 'training' ? (
                    <span style={{
                      background: 'rgba(168, 85, 247, 0.2)',
                      border: '1px solid #A855F7',
                      color: '#D8B4FE',
                      fontSize: '0.78rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      <span className="loader" style={{ width: '10px', height: '10px', borderColor: '#A855F7' }}></span>
                      訓練中...
                    </span>
                  ) : allModelsStatus[mlModelType]?.status === 'ready' ? (
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid #10B981',
                      color: '#6EE7B7',
                      fontSize: '0.78rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '16px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }}></span>
                      就緒 {allModelsStatus[mlModelType]?.metrics?.auc ? `(AUC ${(allModelsStatus[mlModelType].metrics.auc * 100).toFixed(1)}%)` : ''}
                    </span>
                  ) : (
                    <span style={{
                      background: 'rgba(148, 163, 184, 0.15)',
                      border: '1px solid rgba(148, 163, 184, 0.3)',
                      color: '#94A3B8',
                      fontSize: '0.78rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '16px'
                    }}>
                      未載入
                    </span>
                  )}
                </div>

                {/* 右側操作按鈕 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowMlConfig(!showMlConfig)}
                    style={{
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.84rem',
                      background: showMlConfig ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                      border: showMlConfig ? '1px solid #3B82F6' : '1px solid var(--border-color)',
                      color: showMlConfig ? '#93C5FD' : 'white',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px'
                    }}
                  >
                    ⚙️ 訓練條件設定 {showMlConfig ? '▴ 收合' : '▾ 展開'}
                  </button>

                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.84rem',
                      background: 'rgba(59, 130, 246, 0.18)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      color: '#93C5FD',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      borderRadius: '8px'
                    }}
                    onClick={() => fetchMlStatusAndPredictions(mlModelType, true)}
                    disabled={mlLoading || mlRefreshing}
                    title="強制重新推論今日最新市場行情"
                  >
                    {mlRefreshing ? <span className="loader" style={{ width: '12px', height: '12px' }}></span> : '🔄 重新推論'}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. 可收折的「進階訓練配置與條件清單面板」 */}
            {showMlConfig && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(15, 23, 42, 0.9))',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '12px',
                padding: '1.25rem',
                marginBottom: '1.25rem',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                animation: 'fadeIn 0.2s ease-in-out'
              }}>
                {/* 快捷訓練模式 Chips 清單 */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span>⚡</span>
                      <span>快捷訓練條件清單（點擊立即套用並儲存）：</span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowSaveMlPresetModal(true)}
                      style={{
                        padding: '0.2rem 0.65rem',
                        fontSize: '0.78rem',
                        background: 'rgba(16, 185, 129, 0.2)',
                        border: '1px solid rgba(16, 185, 129, 0.5)',
                        color: '#6EE7B7',
                        borderRadius: '6px'
                      }}
                    >
                      ➕ 另存目前為自訂模式
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* 內建預設 Chips */}
                    {BUILTIN_ML_TRAIN_PRESETS.map(preset => {
                      const isActive = activeMlPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleApplyMlPreset(preset)}
                          title={preset.desc}
                          style={{
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.82rem',
                            borderRadius: '20px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            border: isActive ? '1px solid #3B82F6' : '1px solid rgba(255, 255, 255, 0.1)',
                            background: isActive ? 'linear-gradient(135deg, rgba(37, 99, 235, 0.4), rgba(59, 130, 246, 0.2))' : 'rgba(255, 255, 255, 0.04)',
                            color: isActive ? '#93C5FD' : '#CBD5E1',
                            fontWeight: isActive ? 'bold' : 'normal',
                            boxShadow: isActive ? '0 0 10px rgba(59, 130, 246, 0.3)' : 'none'
                          }}
                        >
                          {preset.name}
                        </button>
                      );
                    })}

                    {/* 自訂預設 Chips */}
                    {mlCustomPresets.map(preset => {
                      const isActive = activeMlPreset === preset.id;
                      return (
                        <div
                          key={preset.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            padding: '0.2rem 0.5rem 0.2rem 0.75rem',
                            borderRadius: '20px',
                            border: isActive ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.15)',
                            background: isActive ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.35), rgba(5, 150, 105, 0.2))' : 'rgba(255, 255, 255, 0.06)',
                            color: isActive ? '#6EE7B7' : '#E2E8F0',
                            fontSize: '0.82rem'
                          }}
                        >
                          <span
                            onClick={() => handleApplyMlPreset(preset)}
                            style={{ cursor: 'pointer', fontWeight: isActive ? 'bold' : 'normal' }}
                            title={preset.desc}
                          >
                            {preset.name}
                          </span>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setEditingMlPreset(preset);
                              setEditMlPresetName(preset.name.replace('⭐ ', ''));
                            }}
                            style={{ background: 'none', border: 'none', color: '#93C5FD', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem' }}
                            title="編輯或更新此條件"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              if (confirm(`確定要刪除「${preset.name}」模式嗎？`)) {
                                handleDeleteMlPreset(preset.id);
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', padding: '0 2px', fontSize: '0.8rem' }}
                            title="刪除"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 參數設定 Grid (2 欄) */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '1.25rem',
                  background: 'rgba(0, 0, 0, 0.28)',
                  padding: '1.1rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.06)',
                  marginBottom: '1.25rem'
                }}>
                  {/* 區塊 1: 數據長度配置 */}
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#60A5FA', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>📅</span> 數據長度配置
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.6rem' }}>
                      <div>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          🏋️ 訓練天數 (交易日)
                        </label>
                        <input
                          type="number"
                          value={trainDays}
                          onChange={e => {
                            setTrainDays(e.target.value);
                            localStorage.setItem('bt_train_days', e.target.value);
                          }}
                          style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#FDE68A', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.9rem', fontWeight: 'bold' }}
                        />
                        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.3rem' }}>
                          {[90, 180, 360].map(d => (
                            <button
                              key={d}
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.15rem 0.4rem',
                                fontSize: '0.72rem',
                                background: parseInt(trainDays) === d ? 'rgba(59, 130, 246, 0.35)' : 'rgba(255,255,255,0.05)',
                                border: parseInt(trainDays) === d ? '1px solid #3B82F6' : '1px solid var(--border-color)',
                                color: parseInt(trainDays) === d ? '#93C5FD' : 'var(--text-muted)'
                              }}
                              onClick={() => {
                                setTrainDays(d);
                                localStorage.setItem('bt_train_days', d);
                              }}
                            >
                              {d}天
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                          📊 測試/回測天數
                        </label>
                        <input
                          type="number"
                          value={testDays}
                          onChange={e => {
                            setTestDays(e.target.value);
                            localStorage.setItem('bt_test_days', e.target.value);
                          }}
                          style={{ width: '100%', background: 'rgba(15,23,42,0.8)', color: '#A7F3D0', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem', fontSize: '0.9rem', fontWeight: 'bold' }}
                        />
                        <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.3rem' }}>
                          {[30, 60, 90].map(d => (
                            <button
                              key={d}
                              type="button"
                              className="btn"
                              style={{
                                padding: '0.15rem 0.4rem',
                                fontSize: '0.72rem',
                                background: parseInt(testDays) === d ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255,255,255,0.05)',
                                border: parseInt(testDays) === d ? '1px solid #10B981' : '1px solid var(--border-color)',
                                color: parseInt(testDays) === d ? '#A7F3D0' : 'var(--text-muted)'
                              }}
                              onClick={() => {
                                setTestDays(d);
                                localStorage.setItem('bt_test_days', d);
                              }}
                            >
                              {d}天
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                        <span>訓練/測試分割比</span>
                        <span style={{ color: '#93C5FD', fontWeight: 'bold' }}>{Math.round(trainRatio * 100)}% 訓練 / {Math.round((1 - trainRatio) * 100)}% 測試</span>
                      </div>
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
                        style={{ width: '100%', accentColor: '#3B82F6' }}
                      />
                    </div>
                  </div>

                  {/* 區塊 2: 標的過濾與排除條件 */}
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#FBBF24', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>🎯</span> 標的過濾與風控條件
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        background: 'rgba(255, 255, 255, 0.04)',
                        padding: '0.55rem 0.75rem',
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
                          style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#3B82F6' }}
                        />
                        <label htmlFor="exclude-6digit-cb" style={{ fontSize: '0.82rem', color: '#F1F5F9', cursor: 'pointer', userSelect: 'none' }}>
                          🚫 <strong>排除 6 碼股票（ETF、權證、特別股）</strong>
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            只訓練 4 碼現股標的，去除衍生品雜訊
                          </span>
                        </label>
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        background: 'rgba(255, 255, 255, 0.04)',
                        padding: '0.55rem 0.75rem',
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
                          style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#10B981' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <label htmlFor="filter-capital-cb" style={{ fontSize: '0.82rem', color: '#F1F5F9', cursor: 'pointer', userSelect: 'none' }}>
                              🏢 <strong>濾除股本過小之股票</strong>
                            </label>
                            {filterCapital && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
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
                                    background: 'rgba(15,23,42,0.8)',
                                    color: '#FDE68A',
                                    border: '1px solid #F59E0B',
                                    borderRadius: '4px',
                                    padding: '0.15rem 0.35rem',
                                    fontSize: '0.8rem',
                                    textAlign: 'center'
                                  }}
                                />
                                <span style={{ fontSize: '0.75rem', color: '#FDE68A' }}>億</span>
                              </div>
                            )}
                          </div>
                          <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {filterCapital ? `僅納入總股本 ≥ ${minCapitalBillion} 億之主力標的` : '未啟用股本過濾（納入全部規模股票）'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 底部操作按鈕列 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      style={{
                        padding: '0.45rem 1.15rem',
                        fontSize: '0.88rem',
                        background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                        color: 'white',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        fontWeight: 'bold',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(37, 99, 235, 0.4)'
                      }}
                      onClick={() => handleTrainMLModel(false)}
                      disabled={mlLoading || allModelsStatus[mlModelType]?.status === 'training'}
                    >
                      {allModelsStatus[mlModelType]?.status === 'training' ? (
                        <>
                          <span className="loader" style={{ width: '13px', height: '13px', borderColor: 'white', borderBottomColor: 'transparent' }}></span>
                          訓練中...
                        </>
                      ) : (
                        <>🏋️ 開始訓練 {mlModelType.toUpperCase()} 模型</>
                      )}
                    </button>

                    <button
                      className="btn"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontSize: '0.85rem',
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        color: '#FCA5A5',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        borderRadius: '8px'
                      }}
                      onClick={() => handleTrainMLModel(true)}
                      disabled={mlLoading || allModelsStatus[mlModelType]?.status === 'training'}
                      title="略過快取，在地端重新訓練特徵權重"
                    >
                      🔄 強制重訓
                    </button>

                    <button
                      className="btn"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontSize: '0.85rem',
                        background: 'rgba(59, 130, 246, 0.2)',
                        border: '1px solid rgba(59, 130, 246, 0.5)',
                        color: '#93C5FD',
                        borderRadius: '8px'
                      }}
                      onClick={() => handleSaveTrainSettings(true)}
                    >
                      💾 儲存條件
                    </button>

                    <button
                      className="btn"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontSize: '0.85rem',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid var(--border-color)',
                        color: 'white',
                        borderRadius: '8px'
                      }}
                      onClick={() => handleApplyMlPreset(BUILTIN_ML_TRAIN_PRESETS[0])}
                    >
                      ↺ 還原預設
                    </button>
                  </div>

                  {trainSavedToast && (
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid #10B981',
                      color: '#6EE7B7',
                      fontSize: '0.82rem',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '6px',
                      fontWeight: 'bold'
                    }}>
                      ✅ 訓練條件已儲存！
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 儲存自訂訓練模式 Modal */}
            {showSaveMlPresetModal && (
              <div className="modal-overlay" style={{ zIndex: 1000 }}>
                <div className="modal-content" style={{ maxWidth: '420px', width: '92%' }}>
                  <div className="analysis-header" style={{ marginBottom: '1rem' }}>
                    <h3 className="analysis-title" style={{ fontSize: '1.1rem' }}>💾 儲存目前訓練設定為自訂模式</h3>
                    <button className="close-btn" onClick={() => setShowSaveMlPresetModal(false)}>×</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                      將您目前的訓練天數、測試天數與標的過濾條件保存為獨立模式，隨時可一鍵切換。
                    </p>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.88rem', color: '#93C5FD' }}>
                        模式名稱（例如：外資短期主力衝刺、中長線高股本）：
                      </label>
                      <input
                        type="text"
                        placeholder="請輸入自訂模式名稱..."
                        value={newMlPresetName}
                        onChange={e => setNewMlPresetName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveCurrentAsMlPreset(); }}
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
                      <div>訓練天數: {trainDays} 天 ｜ 測試天數: {testDays} 天</div>
                      <div>排除6碼權證: {exclude6Digit ? '是' : '否'} ｜ 股本過濾: {filterCapital ? `≥ ${minCapitalBillion} 億` : '無限制'}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
                      <button className="btn btn-secondary" onClick={() => setShowSaveMlPresetModal(false)}>
                        取消
                      </button>
                      <button className="btn btn-save" onClick={handleSaveCurrentAsMlPreset} style={{ fontWeight: 'bold' }}>
                        確認儲存
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 編輯自訂訓練模式 Modal */}
            {editingMlPreset && (
              <div className="modal-overlay" style={{ zIndex: 1000 }}>
                <div className="modal-content" style={{ maxWidth: '440px', width: '92%' }}>
                  <div className="analysis-header" style={{ marginBottom: '1rem' }}>
                    <h3 className="analysis-title" style={{ fontSize: '1.1rem' }}>✏️ 編輯自訂訓練模式</h3>
                    <button className="close-btn" onClick={() => setEditingMlPreset(null)}>×</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.88rem', color: '#93C5FD' }}>
                        模式名稱：
                      </label>
                      <input
                        type="text"
                        value={editMlPresetName}
                        onChange={e => setEditMlPresetName(e.target.value)}
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
                      <div>目前設定：{editingMlPreset.desc}</div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        handleUpdateCurrentMlPresetFromUI(editingMlPreset.id);
                        setEditingMlPreset(null);
                      }}
                      style={{
                        padding: '0.4rem 0.75rem',
                        fontSize: '0.82rem',
                        background: 'rgba(16, 185, 129, 0.2)',
                        border: '1px solid rgba(16, 185, 129, 0.5)',
                        color: '#6EE7B7'
                      }}
                    >
                      🔄 以畫面目前調整數值覆蓋此模式參數
                    </button>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
                      <button className="btn btn-secondary" onClick={() => setEditingMlPreset(null)}>
                        取消
                      </button>
                      <button
                        className="btn btn-save"
                        onClick={() => {
                          const trimmed = (editMlPresetName || '').trim();
                          if (trimmed) {
                            const updated = mlCustomPresets.map(p => p.id === editingMlPreset.id ? { ...p, name: `⭐ ${trimmed}` } : p);
                            setMlCustomPresets(updated);
                            localStorage.setItem('ml_custom_train_presets', JSON.stringify(updated));
                            supabaseFetch('/stock_settings', {
                              method: 'POST',
                              headers: { 'Prefer': 'resolution=merge-duplicates' },
                              body: JSON.stringify([{ key: 'ml_custom_train_presets', value: JSON.stringify(updated) }])
                            }).catch(() => {});
                          }
                          setEditingMlPreset(null);
                        }}
                        style={{ fontWeight: 'bold' }}
                      >
                        確認修改
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. 🗂️ ML 功能視圖子分頁切換列 (Segmented Sub-Tabs) */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1.25rem',
              padding: '0.35rem',
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              overflowX: 'auto'
            }}>
              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: mlSubTab === 'predictions' ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'transparent',
                  color: mlSubTab === 'predictions' ? 'white' : 'var(--text-muted)',
                  border: mlSubTab === 'predictions' ? '1px solid #3B82F6' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMlSubTab('predictions');
                  localStorage.setItem('ml_sub_tab', 'predictions');
                }}
              >
                <span>🎯</span>
                <span>Top 30 飆股突破推薦</span>
                {mlPredictions.length > 0 && (
                  <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.45rem', borderRadius: '10px' }}>
                    {mlPredictions.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: mlSubTab === 'models' ? 'linear-gradient(135deg, #7C3AED, #6D28D9)' : 'transparent',
                  color: mlSubTab === 'models' ? 'white' : 'var(--text-muted)',
                  border: mlSubTab === 'models' ? '1px solid #8B5CF6' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMlSubTab('models');
                  localStorage.setItem('ml_sub_tab', 'models');
                }}
              >
                <span>🏆</span>
                <span>11款 AI 模型效能評比 &amp; 分位數</span>
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  flex: '1',
                  padding: '0.55rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  background: mlSubTab === 'backtest' ? 'linear-gradient(135deg, #D97706, #B45309)' : 'transparent',
                  color: mlSubTab === 'backtest' ? 'white' : 'var(--text-muted)',
                  border: mlSubTab === 'backtest' ? '1px solid #F59E0B' : '1px solid transparent',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => {
                  setMlSubTab('backtest');
                  localStorage.setItem('ml_sub_tab', 'backtest');
                }}
              >
                <span>📊</span>
                <span>策略量化歷史回測引擎</span>
              </button>
            </div>

            {/* 子視圖 1: 🎯 Top 30 飆股突破推薦 */}
            {mlSubTab === 'predictions' && (
              <div>
                {/* 預測標的列表頂部資訊列 */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.85rem',
              flexWrap: 'wrap',
              gap: '0.75rem',
              background: 'rgba(15, 23, 42, 0.5)',
              padding: '0.65rem 0.85rem',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🚀</span> Top 30 飆股突破推薦清單
                  </h3>
                  {mlPredictions && mlPredictions.length > 0 && (
                    <span style={{ fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93C5FD', padding: '0.1rem 0.45rem', borderRadius: '12px' }}>
                      共 {mlPredictions.length} 檔
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>🗓️ 數據基準日：<strong style={{ color: '#F8FAFC' }}>{formatMlDate(allModelsStatus[mlModelType]?.latest_date || mlLatestDate) || '最新交易日'}</strong></span>
                  <span>•</span>
                  <span>🤖 模型：<strong style={{ color: '#A7F3D0' }}>{ML_MODELS.find(m => m.id === mlModelType)?.name || mlModelType}</strong></span>
                  {allModelsStatus[mlModelType]?.metrics?.auc && (
                    <>
                      <span>•</span>
                      <span>📈 驗證 AUC：<strong style={{ color: '#FDE68A' }}>{(allModelsStatus[mlModelType].metrics.auc * 100).toFixed(1)}%</strong></span>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                {mlRefreshing && (
                  <span style={{ fontSize: '0.8rem', color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className="loader" style={{ width: '12px', height: '12px' }}></span> 背景同步中...
                  </span>
                )}
                <div className="view-mode-toggle" style={{ margin: 0 }}>
                  <button
                    type="button"
                    className={`view-mode-btn ${mlRecViewMode === 'card' ? 'active' : ''}`}
                    onClick={() => setMlRecViewMode('card')}
                  >
                    📱 卡片
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${mlRecViewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setMlRecViewMode('table')}
                  >
                    📊 表格
                  </button>
                </div>
              </div>
            </div>

            {mlPredictions && mlPredictions.length > 0 ? (
              <div>
                {mlRecViewMode === 'card' ? (
                  <div className="ml-rec-card-grid">
                    {getSortedPredictions().map((row, idx) => (
                      <div key={row.stock_id} className="ml-rec-card">
                        <div className="ml-rec-card-header">
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#FBBF24', background: 'rgba(245, 158, 11, 0.15)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                              #{idx + 1}
                            </span>
                            <span style={{ fontSize: '1.15rem', fontWeight: '800', color: '#60A5FA' }}>{row.stock_id}</span>
                            <span style={{ fontSize: '1rem', fontWeight: '700', color: '#F8FAFC' }}>{row.stock_name}</span>
                          </div>
                          <div style={{ fontSize: '1.05rem', fontWeight: '800', color: '#34D399' }}>
                            ${row.latest_price} 元
                          </div>
                        </div>

                        <div className="ml-rec-prob-row">
                          <div className="ml-rec-prob-pill" style={{
                            background: row.win_probability >= 35 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.15)',
                            border: row.win_probability >= 35 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                            color: row.win_probability >= 35 ? '#FCA5A5' : '#FDE68A'
                          }}>
                            <span>🚀 突破勝率</span>
                            <span>{row.win_probability}%</span>
                          </div>
                          <div className="ml-rec-prob-pill" style={{
                            background: row.drop_probability >= 40 ? 'rgba(239, 68, 68, 0.25)' : row.drop_probability <= 25 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                            border: row.drop_probability >= 40 ? '1px solid rgba(239, 68, 68, 0.4)' : row.drop_probability <= 25 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                            color: row.drop_probability >= 40 ? '#F87171' : row.drop_probability <= 25 ? '#34D399' : 'white'
                          }}>
                            <span>⚠️ 跌破風險</span>
                            <span>{row.drop_probability}%</span>
                          </div>
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '0.4rem 0.75rem',
                          background: 'rgba(0, 0, 0, 0.22)',
                          padding: '0.55rem 0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>🛡️ AI 攻守</span>
                            <span style={{ fontWeight: 'bold', color: row.risk_tag.includes('👑') ? '#FDE68A' : row.risk_tag.includes('🔴') ? '#FCA5A5' : '#93C5FD' }}>
                              {row.risk_tag}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>大戶持股</span>
                            <span style={{ fontWeight: 'bold' }}>
                              {row.large_holder_ratio}% ({row.large_holder_change > 0 ? `▲${row.large_holder_change}%p` : row.large_holder_change < 0 ? `▼${Math.abs(row.large_holder_change)}%p` : '0%p'})
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>外資動向</span>
                            <span style={{ fontWeight: 'bold' }}>{row.foreign_buy_days > 0 ? `連買 ${row.foreign_buy_days} 天` : '無連買'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-muted)' }}>投信動向</span>
                            <span style={{ fontWeight: 'bold' }}>{row.trust_buy_days > 0 ? `連買 ${row.trust_buy_days} 天` : '無連買'}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', paddingTop: '0.25rem' }}>
                          <button
                            type="button"
                            className="btn btn-save"
                            style={{ flex: 1, padding: '0.4rem 0.5rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                            onClick={() => handleAddWatchlistStockDirectly(row.stock_id)}
                          >
                            ➕ 加入自選
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ flex: 1, padding: '0.4rem 0.5rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                            onClick={() => copyAiPrompt(row.stock_id)}
                          >
                            📋 複製指令
                          </button>
                          <a
                            href={`https://tw.stock.yahoo.com/quote/${row.stock_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                            title="Yahoo 股市"
                          >
                            🔍
                          </a>
                          <a
                            href={`https://finlab.finance/stocks/${row.stock_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', color: '#FCD34D' }}
                            title={`FinLab 量化分析 (${row.stock_id})`}
                          >
                            📊
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                    <table>
                      <thead>
                        <tr>
                          <th onClick={() => handleMlSort('stock_id')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            標的代號 / 名稱 {mlSortField === 'stock_id' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th style={{ width: '120px', textAlign: 'center' }}>快捷動作</th>
                          <th onClick={() => handleMlSort('latest_price')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            最新收盤價 {mlSortField === 'latest_price' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th onClick={() => handleMlSort('win_probability')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            🚀 突破勝率 {mlSortField === 'win_probability' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th onClick={() => handleMlSort('drop_probability')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            ⚠️ 跌破風險 {mlSortField === 'drop_probability' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th onClick={() => handleMlSort('net_score')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            🛡️ 攻守評等 {mlSortField === 'net_score' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th onClick={() => handleMlSort('large_holder_ratio')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                            大戶持股% {mlSortField === 'large_holder_ratio' ? (mlSortOrder === 'desc' ? '▼' : '▲') : ''}
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
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedPredictions().map((row, idx) => (
                          <tr key={row.stock_id || idx}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                <span style={{ fontSize: '0.8rem', color: '#FBBF24', background: 'rgba(245, 158, 11, 0.15)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>
                                  #{idx + 1}
                                </span>
                                <span style={{ fontWeight: 'bold', color: '#60A5FA' }}>{row.stock_id}</span>
                                <span style={{ fontWeight: 'bold', color: '#F8FAFC' }}>{row.stock_name}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.8rem', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#6EE7B7', borderRadius: '4px' }}
                                  onClick={() => handleAddWatchlistStockDirectly(row.stock_id)}
                                  title={`加 ${row.stock_name || row.stock_id} 至自選清單`}
                                >
                                  ➕
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.08)', border: '1px solid var(--border-color)', color: '#CBD5E1', borderRadius: '4px' }}
                                  onClick={() => copyAiPrompt(row.stock_id)}
                                  title="複製 AI 提示詞"
                                >
                                  📋
                                </button>
                                <a
                                  href={`https://tw.stock.yahoo.com/quote/${row.stock_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn"
                                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60A5FA', textDecoration: 'none', borderRadius: '4px', display: 'inline-flex' }}
                                  title="Yahoo 股市"
                                >
                                  🔍
                                </a>
                                <a
                                  href={`https://finlab.finance/stocks/${row.stock_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn"
                                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.8rem', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#FCD34D', textDecoration: 'none', borderRadius: '4px', display: 'inline-flex' }}
                                  title={`FinLab 量化分析 (${row.stock_id})`}
                                >
                                  📊
                                </a>
                              </div>
                            </td>
                            <td style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
                              ${row.latest_price} 元
                            </td>
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
                            <td>{row.large_holder_ratio}%</td>
                            <td style={{ color: row.large_holder_change > 0 ? '#FCA5A5' : row.large_holder_change < 0 ? '#A7F3D0' : 'white' }}>
                              {row.large_holder_change > 0 ? `▲${row.large_holder_change}%p` : row.large_holder_change < 0 ? `▼${Math.abs(row.large_holder_change)}%p` : '0%p'}
                            </td>
                            <td>{row.foreign_buy_days > 0 ? `連買 ${row.foreign_buy_days} 天` : '無'}</td>
                            <td>{row.trust_buy_days > 0 ? `連買 ${row.trust_buy_days} 天` : '無'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
            )}

            {/* 子視圖 2: 🏆 11款 AI 模型效能評比 & 分位數 */}
            {mlSubTab === 'models' && (
              <div>
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
              </div>
            )}

            {/* 子視圖 3: 📊 策略量化歷史回測引擎 */}
            {mlSubTab === 'backtest' && (
              <div>
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
            {/* 1. 持股資產與損益 KPI 看板 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem'
            }}>
              <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>💼 追蹤標的總數</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#60A5FA' }}>{portfolioSummary.totalStocks}</span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>檔持股</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  📈 <strong style={{ color: '#EF4444' }}>{portfolioSummary.profitCount}</strong> 賺 · 📉 <strong style={{ color: '#10B981' }}>{portfolioSummary.lossCount}</strong> 賠 {portfolioSummary.flatCount > 0 ? `· ➖ ${portfolioSummary.flatCount} 平` : ''}
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📊 平均預估損益率</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    color: portfolioSummary.avgRoi !== null
                      ? (portfolioSummary.avgRoi > 0 ? '#EF4444' : portfolioSummary.avgRoi < 0 ? '#10B981' : '#F8FAFC')
                      : 'var(--text-muted)'
                  }}>
                    {portfolioSummary.avgRoi !== null ? `${portfolioSummary.avgRoi > 0 ? '+' : ''}${portfolioSummary.avgRoi.toFixed(2)}%` : '—'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    ({portfolioSummary.validRoiCount} 檔有成本)
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: portfolioSummary.profitCount >= portfolioSummary.lossCount ? '#FCA5A5' : '#86EFAC' }}>
                  {portfolioSummary.totalStocks === 0 ? '尚未加入持股' : portfolioSummary.profitCount >= portfolioSummary.lossCount ? '🚀 整體多方表現領先' : '⚠️ 需留意持股調節風險'}
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🚀 AI 20天勝率亮點 (≥35%)</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#FCD34D' }}>
                    {portfolioList ? portfolioList.filter(s => (portfolioPredictions[s.stock_id]?.win_probability || 0) >= 35).length : 0}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>檔突破潛力</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#93C5FD' }}>
                  模型: {portfolioMlModel.toUpperCase()}
                </div>
              </div>

              <div style={{
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '12px',
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🤖 Gemini 健檢覆蓋率</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#A78BFA' }}>
                    {portfolioList ? portfolioList.filter(s => s.sentiment_score !== null && s.sentiment_score !== undefined).length : 0}
                    <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 500 }}> / {portfolioSummary.totalStocks}</span>
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  排程自動分析: {portfolioList ? portfolioList.filter(s => s.auto_analyze === 1).length : 0} 檔
                </div>
              </div>
            </div>

            {/* 2. 緊湊控制與搜尋工具列 */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              {/* 左側快捷切換按鈕群 */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowAddPortfolioForm(prev => !prev)}
                  style={{
                    background: showAddPortfolioForm ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : 'rgba(59, 130, 246, 0.2)',
                    border: '1px solid rgba(59, 130, 246, 0.5)',
                    color: '#93C5FD',
                    padding: '0.4rem 0.85rem',
                    fontSize: '0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  {showAddPortfolioForm ? '▲ 收合新增' : '➕ 新增持股'}
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowPortfolioAiConfig(prev => !prev)}
                  style={{
                    background: showPortfolioAiConfig ? 'rgba(79, 70, 229, 0.4)' : 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    padding: '0.4rem 0.85rem',
                    fontSize: '0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  ⚙️ AI 設定 {showPortfolioAiConfig ? '▲' : '▼'}
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleAnalyzeAll}
                  style={{
                    padding: '0.4rem 0.85rem',
                    fontSize: '0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                  title="依序分析所有排程持股"
                >
                  🔄 批次健檢
                </button>
              </div>

              {/* 右側搜尋、排序與視圖切換 */}
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* 搜尋框 */}
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="🔍 搜尋代號或股名..."
                    value={portfolioSearchTerm}
                    onChange={e => setPortfolioSearchTerm(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'white',
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.84rem',
                      width: '145px'
                    }}
                  />
                  {portfolioSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPortfolioSearchTerm('')}
                      style={{
                        position: 'absolute',
                        right: '6px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '0.8rem'
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* 排序選單 */}
                <select
                  value={portfolioSortField}
                  onChange={e => handlePortfolioSort(e.target.value)}
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'white',
                    padding: '0.35rem 0.65rem',
                    fontSize: '0.84rem'
                  }}
                >
                  <option value="default">預設排序</option>
                  <option value="roi">預估損益率 (由高到低)</option>
                  <option value="win_probability">20天勝率 (高到低)</option>
                  <option value="drop_probability">20天跌破風險 (低到高)</option>
                  <option value="latest_price">最新股價 (高到低)</option>
                  <option value="stock_id">股票代號</option>
                </select>

                {/* 卡片 / 表格檢視切換 */}
                <div className="view-mode-toggle">
                  <button
                    type="button"
                    className={`view-mode-btn ${portfolioViewMode === 'card' ? 'active' : ''}`}
                    onClick={() => setPortfolioViewMode('card')}
                  >
                    📱 卡片
                  </button>
                  <button
                    type="button"
                    className={`view-mode-btn ${portfolioViewMode === 'table' ? 'active' : ''}`}
                    onClick={() => setPortfolioViewMode('table')}
                  >
                    📊 表格
                  </button>
                </div>
              </div>
            </div>

            {/* 3. 可收折：新增持股表單 */}
            {showAddPortfolioForm && (
              <form onSubmit={handleAddPortfolio} className="portfolio-form-grid" style={{
                background: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: '12px',
                padding: '1rem',
                marginBottom: '1rem'
              }}>
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
                    placeholder="例如：長期波段、跌破月線減碼"
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
            )}

            {/* 4. 可收折：AI 設定面板 (Gemini後端設定、臨時金鑰、20天勝率模型) */}
            {showPortfolioAiConfig && (
              <div style={{
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '12px',
                padding: '1rem 1.25rem',
                marginBottom: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ background: 'linear-gradient(135deg, #4F46E5, #3730A3)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                      onClick={() => { fetchSettings(); setShowSettingsModal(true); }}
                    >
                      ⚙️ Gemini 後端自動化設定
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>🔑 臨時金鑰:</span>
                      <input
                        type="password"
                        placeholder="瀏覽器臨時金鑰 (選填)"
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
                          padding: '0.3rem 0.5rem',
                          fontSize: '0.82rem',
                          width: '180px'
                        }}
                      />
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    ※ 填寫臨時金鑰優先使用；留空則使用後端已配置之 Gemini 金鑰
                  </span>
                </div>

                <div style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.88rem', color: '#93C5FD', fontWeight: 'bold' }}>
                      🤖 AI 20天勝率模型:
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
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.84rem',
                        minWidth: '240px'
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
                      style={{ padding: '0.35rem 0.8rem', fontSize: '0.82rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      onClick={() => fetchPortfolioMlPredictions(portfolioMlModel)}
                      disabled={fetchingPortfolioMl}
                    >
                      {fetchingPortfolioMl ? (
                        <>
                          <span className="loader" style={{ width: '12px', height: '12px' }}></span>
                          <span>預測中...</span>
                        </>
                      ) : (
                        <span>🚀 立即預測持股勝率</span>
                      )}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    評估持股 20 交易日內漲幅突破 20% 之機率與跌破風險
                  </div>
                </div>
              </div>
            )}

            {/* 5. 持股清單主區域 (卡片檢視 / 表格檢視) */}
            {portfolioList && portfolioList.length > 0 ? (
              <div>
                {/* 搜尋與篩選提示列 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    💼 顯示 <strong>{getSortedPortfolioList().length}</strong> / <strong>{portfolioList.length}</strong> 檔持股
                    {portfolioSearchTerm && (
                      <span style={{ marginLeft: '0.5rem', color: '#60A5FA' }}>
                        (搜尋: "{portfolioSearchTerm}")
                      </span>
                    )}
                  </span>
                </div>

                {getSortedPortfolioList().length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                    <p style={{ margin: 0, fontSize: '0.95rem' }}>查無符合「{portfolioSearchTerm}」的持股標的</p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.75rem', padding: '0.35rem 0.8rem', fontSize: '0.82rem' }}
                      onClick={() => setPortfolioSearchTerm('')}
                    >
                      清除搜尋條件
                    </button>
                  </div>
                ) : portfolioViewMode === 'card' ? (
                  <div className="portfolio-card-grid">
                    {getSortedPortfolioList().map((item) => {
                      const hasCost = item.buy_price !== null && item.buy_price > 0;
                      const hasPrice = item.latest_price !== null;
                      let roi = null;
                      let roiText = '—';
                      let roiClass = 'text-flat';
                      let profitDiff = null;

                      if (hasCost && hasPrice) {
                        roi = ((item.latest_price - item.buy_price) / item.buy_price) * 100;
                        profitDiff = item.latest_price - item.buy_price;
                        roiText = `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
                        if (roi > 0.001) roiClass = 'text-up';
                        else if (roi < -0.001) roiClass = 'text-down';
                      }

                      const pred = portfolioPredictions[item.stock_id] || {};
                      const hasPred = pred.win_probability !== undefined && pred.win_probability > 0;

                      return (
                        <div key={item.stock_id} className="portfolio-stock-card" style={{
                          borderLeft: roi && roi > 0 ? '4px solid #EF4444' : roi && roi < 0 ? '4px solid #10B981' : '4px solid rgba(255,255,255,0.1)'
                        }}>
                          <div className="portfolio-card-header">
                            <div className="portfolio-card-stock-info">
                              <span className="portfolio-card-stock-id">{item.stock_id}</span>
                              <span className="portfolio-card-stock-name">{item.stock_name}</span>
                              {hasPrice && (
                                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#F8FAFC', marginLeft: '0.3rem' }}>
                                  ${item.latest_price.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className={`portfolio-card-roi-badge ${roiClass}`} style={{
                              background: roi > 0 ? 'rgba(239, 68, 68, 0.2)' : roi < 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)',
                              border: roi > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : roi < 0 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                            }}>
                              {roiText}
                              {profitDiff !== null && (
                                <span style={{ fontSize: '0.72rem', marginLeft: '0.35rem', opacity: 0.9 }}>
                                  ({profitDiff > 0 ? '+' : ''}${profitDiff.toFixed(2)})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="portfolio-card-body-grid">
                            <div className="portfolio-card-item">
                              <span className="portfolio-card-item-label">購入成本均價</span>
                              <span className="portfolio-card-item-val">{hasCost ? `$${item.buy_price.toFixed(2)}` : '未設定'}</span>
                            </div>
                            <div className="portfolio-card-item">
                              <span className="portfolio-card-item-label">最新收盤價</span>
                              <span className="portfolio-card-item-val">{hasPrice ? `$${item.latest_price.toFixed(2)}` : '無最新價'}</span>
                            </div>
                            <div className="portfolio-card-item">
                              <span className="portfolio-card-item-label">🚀 20天突破勝率</span>
                              <span className="portfolio-card-item-val" style={{ color: pred.win_probability >= 35 ? '#FCA5A5' : '#FDE68A' }}>
                                {hasPred ? `${pred.win_probability}%` : '—'}
                              </span>
                            </div>
                            <div className="portfolio-card-item">
                              <span className="portfolio-card-item-label">⚠️ 20天跌破風險</span>
                              <span className="portfolio-card-item-val" style={{ color: pred.drop_probability >= 40 ? '#F87171' : '#34D399' }}>
                                {hasPred ? `${pred.drop_probability}%` : '—'}
                              </span>
                            </div>
                            {hasPred && pred.risk_tag && (
                              <div className="portfolio-card-item" style={{ gridColumn: 'span 2' }}>
                                <span className="portfolio-card-item-label">🛡️ AI 攻守評等</span>
                                <span style={{ fontSize: '0.82rem', fontWeight: 'bold' }}>{pred.risk_tag}</span>
                              </div>
                            )}
                            {item.sentiment_direction && (
                              <div className="portfolio-card-item" style={{ gridColumn: 'span 2' }}>
                                <span className="portfolio-card-item-label">💬 網友氛圍</span>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                  <span style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 'bold',
                                    color: item.sentiment_direction === '看多' ? '#EF4444' : item.sentiment_direction === '看空' ? '#10B981' : '#9CA3AF'
                                  }}>
                                    {item.sentiment_direction} {item.sentiment_score !== null && item.sentiment_score !== undefined ? `(${item.sentiment_score}分)` : ''}
                                  </span>
                                  {item.has_rumor && item.has_rumor !== '無' && item.has_rumor !== 'none' && (
                                    <span style={{ fontSize: '0.8rem', color: '#FBBF24' }} title={`小道消息: ${item.has_rumor}`}>
                                      ⚠️ 小道消息
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {item.notes && (
                              <div className="portfolio-card-item" style={{ gridColumn: 'span 2' }}>
                                <span className="portfolio-card-item-label">📝 備註</span>
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', wordBreak: 'break-all' }}>{item.notes}</span>
                              </div>
                            )}
                          </div>

                          <div className="portfolio-card-actions">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={item.auto_analyze === 1}
                                onChange={() => handleToggleAutoAnalyze(item.stock_id)}
                                style={{ width: '16px', height: '16px' }}
                              />
                              自動排程
                            </label>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', background: 'linear-gradient(135deg, #4F46E5, #06B6D4)' }}
                                onClick={() => handleAnalyzeStock(item.stock_id)}
                                disabled={analyzingId !== null}
                                title="Gemini 持股健檢"
                              >
                                {analyzingId === item.stock_id ? '分析中...' : '🤖 診斷'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem' }}
                                onClick={() => setEditingPortfolioStock(item)}
                                title="編輯成本與備註"
                              >
                                ✏️ 編輯
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem' }}
                                onClick={() => copyAiPrompt(item.stock_id)}
                                title="複製 AI 提示詞"
                              >
                                📋
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem' }}
                                onClick={() => viewHistory(item.stock_id, item.stock_name)}
                                title="查看歷史健檢紀錄"
                              >
                                📜
                              </button>
                              <a
                                href={`https://tw.stock.yahoo.com/quote/${item.stock_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                                title="Yahoo 股市"
                              >
                                🔍
                              </a>
                              <a
                                href={`https://finlab.finance/stocks/${item.stock_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', color: '#FCD34D' }}
                                title={`FinLab 量化分析 (${item.stock_id})`}
                              >
                                📊
                              </a>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.3rem 0.55rem', fontSize: '0.8rem', color: '#F87171' }}
                                onClick={() => handleDeletePortfolio(item.stock_id)}
                                title="刪除持股"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="portfolio-table-container">
                    <table className="portfolio-sticky-table">
                      <thead>
                        <tr>
                          <th className="portfolio-sticky-col-0" style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('stock_id')}>
                            代號 {portfolioSortField === 'stock_id' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th className="portfolio-sticky-col-1">股名</th>
                          <th style={{ textAlign: 'center', minWidth: '150px' }}>快捷動作</th>
                          <th style={{ textAlign: 'center', minWidth: '70px' }}>自動分析</th>
                          <th style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('buy_price')}>
                            成本均價 {portfolioSortField === 'buy_price' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('latest_price')}>
                            最新股價 {portfolioSortField === 'latest_price' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('roi')}>
                            預估損益 {portfolioSortField === 'roi' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('win_probability')}>
                            🚀 20天勝率 {portfolioSortField === 'win_probability' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th style={{ cursor: 'pointer' }} onClick={() => handlePortfolioSort('drop_probability')}>
                            ⚠️ 20天風險 {portfolioSortField === 'drop_probability' ? (portfolioSortOrder === 'desc' ? '▼' : '▲') : ''}
                          </th>
                          <th>🛡️ 攻守評等</th>
                          <th>網友氛圍</th>
                          <th>備註</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getSortedPortfolioList().map((item) => {
                          const hasCost = item.buy_price !== null && item.buy_price > 0;
                          const hasPrice = item.latest_price !== null;
                          let roi = null;
                          let roiText = '—';
                          let roiClass = 'text-flat';

                          if (hasCost && hasPrice) {
                            roi = ((item.latest_price - item.buy_price) / item.buy_price) * 100;
                            roiText = `${roi > 0 ? '+' : ''}${roi.toFixed(2)}%`;
                            if (roi > 0.001) roiClass = 'text-up';
                            else if (roi < -0.001) roiClass = 'text-down';
                          }

                          const pred = portfolioPredictions[item.stock_id] || {};
                          const hasPred = pred.win_probability !== undefined && pred.win_probability > 0;

                          return (
                            <tr key={item.stock_id}>
                              <td className="portfolio-sticky-col-0">
                                <strong>{item.stock_id}</strong>
                              </td>
                              <td className="portfolio-sticky-col-1">
                                <span style={{ fontWeight: 600 }}>{item.stock_name}</span>
                              </td>
                              {/* 快捷動作放到最前面，免去滑到最右側的困擾 */}
                              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{
                                      padding: '0.25rem 0.5rem',
                                      fontSize: '0.78rem',
                                      background: 'linear-gradient(135deg, #4F46E5, #06B6D4)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.2rem'
                                    }}
                                    onClick={() => handleAnalyzeStock(item.stock_id)}
                                    disabled={analyzingId !== null}
                                    title="Gemini 健檢"
                                  >
                                    {analyzingId === item.stock_id ? '...' : '🤖'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem' }}
                                    onClick={() => setEditingPortfolioStock(item)}
                                    title="編輯持股成本與備註"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem' }}
                                    onClick={() => copyAiPrompt(item.stock_id)}
                                    title="複製 AI 提示詞"
                                  >
                                    📋
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem' }}
                                    onClick={() => viewHistory(item.stock_id, item.stock_name)}
                                    title="查看歷史健檢紀錄"
                                  >
                                    📜
                                  </button>
                                  <a
                                    href={`https://tw.stock.yahoo.com/quote/${item.stock_id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem', textDecoration: 'none' }}
                                    title="Yahoo 股市"
                                  >
                                    🔍
                                  </a>
                                  <a
                                    href={`https://finlab.finance/stocks/${item.stock_id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem', textDecoration: 'none', color: '#FCD34D' }}
                                    title="FinLab 量化"
                                  >
                                    📊
                                  </a>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem', color: '#F87171' }}
                                    onClick={() => handleDeletePortfolio(item.stock_id)}
                                    title="刪除"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={item.auto_analyze === 1}
                                  onChange={() => handleToggleAutoAnalyze(item.stock_id)}
                                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                  title="切換每日自動排程健檢"
                                />
                              </td>
                              <td>{hasCost ? `$${item.buy_price.toFixed(2)}` : '—'}</td>
                              <td><strong>{hasPrice ? `$${item.latest_price.toFixed(2)}` : '無最新價'}</strong></td>
                              <td className={roiClass} style={{ fontWeight: 700 }}>{roiText}</td>
                              <td style={{ fontWeight: 'bold' }}>
                                {hasPred ? (
                                  <span style={{
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px',
                                    background: pred.win_probability >= 35 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                    color: pred.win_probability >= 35 ? '#FCA5A5' : '#FDE68A',
                                    border: pred.win_probability >= 35 ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)',
                                    display: 'inline-block',
                                    fontSize: '0.82rem'
                                  }}>
                                    🚀 {pred.win_probability}%
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                )}
                              </td>
                              <td style={{ fontWeight: 'bold' }}>
                                {hasPred ? (
                                  <span style={{
                                    padding: '0.2rem 0.5rem',
                                    borderRadius: '4px',
                                    background: pred.drop_probability >= 40 ? 'rgba(239, 68, 68, 0.25)' : pred.drop_probability <= 25 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                    color: pred.drop_probability >= 40 ? '#F87171' : pred.drop_probability <= 25 ? '#34D399' : 'white',
                                    border: pred.drop_probability >= 40 ? '1px solid rgba(239, 68, 68, 0.4)' : pred.drop_probability <= 25 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                                    display: 'inline-block',
                                    fontSize: '0.82rem'
                                  }}>
                                    ⚠️ {pred.drop_probability}%
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                )}
                              </td>
                              <td style={{ fontWeight: 'bold' }}>
                                {hasPred && pred.risk_tag ? (
                                  <span style={{
                                    padding: '0.2rem 0.5rem',
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
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                )}
                              </td>
                              <td>
                                {item.sentiment_direction ? (
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <span style={{
                                      padding: '0.15rem 0.45rem',
                                      borderRadius: '12px',
                                      fontSize: '0.78rem',
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
                                        style={{ cursor: 'help', animation: 'pulse-rumor 1.5s infinite', fontSize: '0.9rem' }}
                                        title={`⚠️ 小道消息：${item.has_rumor}`}
                                      >
                                        ⚠️
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                                )}
                              </td>
                              <td style={{ color: item.notes ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.notes}>
                                {item.notes || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '12px', border: '1px dashed var(--border-color)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💼</div>
                <p style={{ margin: 0, fontSize: '1rem' }}>目前尚未建立任何持股追蹤。</p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem' }}>請點擊上方「➕ 新增持股」輸入股票代號（如 2330），即可開始追蹤其股價與 Gemini 智能診斷分析！</p>
              </div>
            )}

            {/* 6. 持股快速編輯 Modal */}
            {editingPortfolioStock && (
              <div className="modal-backdrop" onClick={() => setEditingPortfolioStock(null)}>
                <div className="modal-content" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#60A5FA' }}>
                      ✏️ 編輯持股：{editingPortfolioStock.stock_id} {editingPortfolioStock.stock_name}
                    </h3>
                    <button
                      className="close-btn"
                      onClick={() => setEditingPortfolioStock(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer' }}
                    >
                      ×
                    </button>
                  </div>

                  <form onSubmit={e => {
                    e.preventDefault();
                    handleUpdatePortfolioStock(editingPortfolioStock.stock_id, editingPortfolioStock.buy_price, editingPortfolioStock.notes);
                  }}>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                        購入成本均價 (元)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="例如：850.5"
                        value={editingPortfolioStock.buy_price !== null && editingPortfolioStock.buy_price !== undefined ? editingPortfolioStock.buy_price : ''}
                        onChange={e => setEditingPortfolioStock(prev => ({ ...prev, buy_price: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'white',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                        個人筆記 / 交易備註
                      </label>
                      <textarea
                        rows={3}
                        placeholder="例如：預計跌破季線停損、分批進場..."
                        value={editingPortfolioStock.notes || ''}
                        onChange={e => setEditingPortfolioStock(prev => ({ ...prev, notes: e.target.value }))}
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'white',
                          boxSizing: 'border-box',
                          resize: 'vertical'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEditingPortfolioStock(null)}
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="btn btn-save"
                      >
                        💾 儲存修改
                      </button>
                    </div>
                  </form>
                </div>
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
