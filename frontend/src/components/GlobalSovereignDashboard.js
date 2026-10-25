import React, { useState, useEffect, useMemo, useRef } from 'react';
import defaultData from '../data/defaultGlobalSovereignData.json';
import defaultRankIcData from '../data/global_titan_rank_ic.json';
import twStockNamesMap from '../data/tw_stock_names_map.json';
import { getCurrentUser, apiGetGlobalTitanPortfolio, apiSaveGlobalTitanPortfolio, apiGetGlobalSovereignDashboard, apiGetGlobalTitanRankIc, supabaseDirectFetch } from '../api';

// 全球泰坦旗艦核心標的中文對照表 (確保所有台股與美股代號如 8996.TW 均能清楚顯示中文名稱)
export const GLOBAL_TITAN_NAME_MAP = {
  '8996.TW': '高力 (Kaori 水冷散熱飆股)',
  '8996': '高力',
  '3017.TW': '奇鋐 (AI 水冷散熱龍頭)',
  '3017': '奇鋐',
  '3008.TW': '大立光 (Largan 光學鏡頭鏡王)',
  '3008': '大立光',
  '3037.TW': '欣興 (Unimicron 載板王者)',
  '3037': '欣興',
  '3443.TW': '創意 (Global Unichip ASIC)',
  '3443': '創意',
  '2330.TW': '台積電 (TSMC 神山)',
  '2330': '台積電',
  '2454.TW': '聯發科 (MediaTek 晶片霸主)',
  '2454': '聯發科',
  '2382.TW': '廣達 (AI 伺服器代工)',
  '2382': '廣達',
  '3231.TW': '緯創 (AI 代工伺服器)',
  '3231': '緯創',
  '6669.TW': '緯穎 (AI 伺服器巨頭)',
  '6669': '緯穎',
  '2317.TW': '鴻海 (電子代工巨擘)',
  '2317': '鴻海',
  '2308.TW': '台達電 (綠能電源龍頭)',
  '2308': '台達電',
  '3661.TW': '世芯-KY (AI ASIC 矽智財)',
  '3661': '世芯-KY',
  '2603.TW': '長榮海運 (貨櫃航運龍頭)',
  '2603': '長榮',
  '2609.TW': '陽明海運 (貨櫃航運)',
  '2609': '陽明',
  'MRNA': '莫德納 (Moderna 生技巨擘)',
  'TEAM': 'Atlassian (TEAM 協同軟體龍頭)',
  'ASX': '日月光投控 (ASE 封測龍頭ADR)',
  'ILMN': '因美納 (Illumina 基因定序霸主)',
  'PBR': '巴西石油 ADR (Petrobras)',
  'MU': '美光科技 (Micron 記憶體巨頭)',
  'NVDA': '輝達 (NVIDIA AI算力之王)',
  'AVGO': '博通 (Broadcom 網通霸主)',
  'TSLA': '特斯拉 (Tesla 自動駕駛)',
  'AAPL': '蘋果 (Apple)',
  'MSFT': '微軟 (Microsoft)',
  'AMZN': '亞馬遜 (Amazon)',
  'GOOGL': '谷歌 (Alphabet)',
  'META': 'Meta (臉書)'
};

export const formatStockDisplayName = (ticker, originalName) => {
  if (!ticker && !originalName) return '';
  const cleanTicker = String(ticker || '').trim();
  const baseTicker = cleanTicker.split('.')[0];

  // 1. 優先比對全球泰坦專屬中文對照表
  if (GLOBAL_TITAN_NAME_MAP[cleanTicker]) return GLOBAL_TITAN_NAME_MAP[cleanTicker];
  if (GLOBAL_TITAN_NAME_MAP[baseTicker]) return GLOBAL_TITAN_NAME_MAP[baseTicker];

  // 2. 比對台股全市場 350+ 檔中文名稱庫
  if (twStockNamesMap) {
    if (twStockNamesMap[baseTicker]) {
      return `${twStockNamesMap[baseTicker]} (${cleanTicker})`;
    }
    if (twStockNamesMap[cleanTicker]) {
      return `${twStockNamesMap[cleanTicker]} (${cleanTicker})`;
    }
  }

  // 3. 若原有名稱已有繁體中文且不單是代號，則優先沿用
  if (originalName && originalName !== cleanTicker && originalName !== baseTicker && /[\u4e00-\u9fa5]/.test(originalName)) {
    return originalName;
  }

  return originalName || cleanTicker;
};

const STORAGE_KEY_POSITIONS = 'global_titan_user_positions_v4';
const STORAGE_KEY_IDLE_CASH = 'global_titan_idle_cash_v4';
const STORAGE_KEY_ALL_TX = 'global_titan_all_tx_v4';
const STORAGE_KEY_USDFX = 'global_titan_user_usdfx_v4';
const STORAGE_KEY_DISMISSED_SUGG = 'global_titan_dismissed_sugg_v4';

const getTitanStorageKeys = (username) => ({
  positions: `global_titan_user_positions_v4_${username}`,
  idleCash: `global_titan_idle_cash_v4_${username}`,
  allTx: `global_titan_all_tx_v4_${username}`,
  usdFx: `global_titan_user_usdfx_v4_${username}`,
  dismissedSugg: `global_titan_dismissed_sugg_v4_${username}`
});

const DEFAULT_POSITIONS = [
  {
    id: 'pos_mrna_1',
    ticker: 'MRNA',
    name: '莫德納 (Moderna mRNA生技巨擘)',
    market: '美股 (NASDAQ)',
    currency: 'USD',
    shares: 131,
    entry_price: 224.78,
    current_price: 203.15,
    price_date: '2026-10-23',
    entry_date: '2026-10-12',
    entry_fee: 30,
    stop_loss_price: 165.0,
    role: '👑 第1王者 (40%)',
    stop_condition: '雙梯隊滿倉續抱，1號與22號雙軌換倉自然淘汰'
  },
  {
    id: 'pos_3037_1',
    ticker: '3037.TW',
    name: '欣興 (Unimicron 載板王者)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 571,
    entry_price: 1144.62,
    current_price: 1085.00,
    price_date: '2026-10-22',
    entry_date: '2026-10-13',
    entry_fee: 903,
    stop_loss_price: 1026.38,
    role: '🥈 第2主力 (30%)',
    stop_condition: '載板王者主升段續抱，雙軌換倉自然淘汰'
  },
  {
    id: 'pos_3443_1',
    ticker: '3443.TW',
    name: '創意 (Global Unichip ASIC)',
    market: '台股 (TWSE)',
    currency: 'TWD',
    shares: 52,
    entry_price: 8013.77,
    current_price: 7585.00,
    price_date: '2026-10-22',
    entry_date: '2026-10-12',
    entry_fee: 582,
    stop_loss_price: 7150.0,
    role: '🥉 第3主力 (30%)',
    stop_condition: 'ASIC矽智財主升段續抱，雙軌換倉自然淘汰'
  }
];

const DEFAULT_TX_HISTORY = [
  {
    id: 'tx_init_deposit',
    date: '2026-10-01',
    action: '投入現金',
    ticker: '-',
    name: '初始本金入金 (🅰️ A梯隊)',
    currency: 'TWD',
    shares: 0,
    price: 0,
    tax_fee: 0,
    cash_flow_twd: 1000000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '全球泰坦旗艦策略 🅰️ A梯隊開倉入金 (100萬TWD)'
  },
  {
    id: 'tx_init_1',
    date: '2026-10-02',
    action: '買入',
    ticker: 'MRNA',
    name: '莫德納 (Moderna mRNA生技巨擘)',
    currency: 'USD',
    shares: 54,
    price: 210.21,
    tax_fee: 15,
    cash_flow_twd: -369441,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初 A梯隊建倉 👑 第1王者 (40%)'
  },
  {
    id: 'tx_init_2',
    date: '2026-10-02',
    action: '買入',
    ticker: '3037.TW',
    name: '欣興 (Unimicron 載板王者)',
    currency: 'TWD',
    shares: 236,
    price: 1100.0,
    tax_fee: 400,
    cash_flow_twd: -260000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初 A梯隊建倉 🥈 第2主力 (30%)'
  },
  {
    id: 'tx_init_3',
    date: '2026-10-02',
    action: '買入',
    ticker: '3443.TW',
    name: '創意 (Global Unichip ASIC)',
    currency: 'TWD',
    shares: 35,
    price: 7990.0,
    tax_fee: 400,
    cash_flow_twd: -280050,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10月初 A梯隊建倉 🥉 第3主力 (30%)'
  },
  {
    id: 'tx_b_deposit',
    date: '2026-10-22',
    action: '投入現金',
    ticker: '-',
    name: '追加入金 (🅱️ B梯隊注資)',
    currency: 'TWD',
    shares: 0,
    price: 0,
    tax_fee: 0,
    cash_flow_twd: 1100000,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '全球泰坦旗艦策略 🅱️ B梯隊10/22調倉加碼入金 (110萬TWD)'
  },
  {
    id: 'tx_1792679250125',
    date: '2026-10-22',
    action: '買入',
    ticker: 'MRNA',
    name: '莫德納 (Moderna mRNA生技巨擘)',
    currency: 'USD',
    shares: 77,
    price: 235.0,
    tax_fee: 15,
    cash_flow_twd: -588575,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/22 雙隊合流：加碼多買入建倉 (👑 第1王者 補足131股)'
  },
  {
    id: 'tx_b_2',
    date: '2026-10-22',
    action: '買入',
    ticker: '3037.TW',
    name: '欣興 (Unimicron 載板王者)',
    currency: 'TWD',
    shares: 335,
    price: 1176.0,
    tax_fee: 503,
    cash_flow_twd: -394463,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/22 雙隊合流：加碼多買入建倉 (🥈 第2主力 補足571股)'
  },
  {
    id: 'tx_b_3',
    date: '2026-10-22',
    action: '買入',
    ticker: '3443.TW',
    name: '創意 (Global Unichip ASIC)',
    currency: 'TWD',
    shares: 17,
    price: 8062.8,
    tax_fee: 182,
    cash_flow_twd: -137250,
    realized_pnl_twd: null,
    realized_return_pct: null,
    note: '10/22 雙隊合流：加碼多買入建倉 (🥉 第3主力 補足52股)'
  }
];

export const ALL_RANK_IC_FACTORS = [
  // 旗艦複合
  { key: 'composite', label: '👑 DOE 複合動能冠軍 (Composite Score)', cat: 'flagship', catName: '🏆 旗艦複合', desc: '(85% Raw + 15% Res) × FIP × Convexity 終極冠軍' },
  { key: 'blend_mom', label: '⚖️ 混合動能基底 (Blend Momentum)', cat: 'flagship', catName: '🏆 旗艦複合', desc: '85% Raw + 15% Residual Alpha (Beta中性基底)' },
  // 價格動能系列
  { key: 'mom_12m', label: '🚀 12個月長線動能 (12M Momentum)', cat: 'momentum', catName: '📈 價格動能', desc: 'Jegadeesh & Titman (1993) 經典長週期機構鎖定動能' },
  { key: 'mom_6m', label: '⏳ 6個月中長線動能 (6M Momentum)', cat: 'momentum', catName: '📈 價格動能', desc: '中期主升段中樞 (波段趨勢延續主力)' },
  { key: 'mom_3m', label: '⚡ 3個月中線動能 (3M Momentum)', cat: 'momentum', catName: '📈 價格動能', desc: '季線波段發動與加速因子' },
  { key: 'raw_mom', label: '📈 45/35/20 多週期動能 (Raw Mom)', cat: 'momentum', catName: '📈 價格動能', desc: '45% 12M + 35% 3M + 20% 1M 多尺度融合動能' },
  { key: 'mom_1m', label: '⏱️ 1個月短線動能 (1M Momentum)', cat: 'momentum', catName: '📈 價格動能', desc: '月度輪動爆發力 (短線領先指標)' },
  { key: 'mom_2w', label: '🏃 2週超短衝刺動能 (2W Momentum)', cat: 'momentum', catName: '📈 價格動能', desc: '短線急衝力道 (通常伴隨短期均值回歸反轉)' },
  // 質量與路徑
  { key: 'res_mom', label: '⚡ 純殘差動能 (Residual Alpha vs SPY)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'Blitz et al. (2011) 剝離大盤Beta之純個股Alpha' },
  { key: 'fip', label: '🐸 FIP 溫水煮青蛙連續性 (Frog-in-the-Pan)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'Da et al. (2014 RFS) 252日漲跌天數連續性比率' },
  { key: 'convexity', label: '📐 60D 非對稱波動凸性比 (Convexity)', cat: 'quality', catName: '🔬 質量與路徑', desc: '右偏上行爆發波動 / 下行收斂波動 (右偏凸性溢價)' },
  { key: 'er_60', label: '🌊 Kaufman 60D 趨勢效率比 (Efficiency Ratio)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'Kaufman (1995) 淨位移 / 總路徑雜訊 (趨勢純淨度)' },
  { key: 'prox_52w', label: '🎯 52週新高接近度 (52W High Proximity)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'George & Hwang (2004 JF) 股價/252D新高錨定效應' },
  { key: 'vcp_score', label: '🌀 VCP 波動收縮緊湊度 (Minervini VCP)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'Minervini (2013) 價格波幅收斂+量能乾涸+Pivot突破' },
  { key: 'chip_score', label: '🧱 Chip 籌碼沉澱鎖定 (CMF & Vol Absorption)', cat: 'quality', catName: '🔬 質量與路徑', desc: 'Chaikin 資金流向 + 陽線吸籌比率 (浮額洗淨鎖碼)' },
  // 技術與乖離
  { key: 'bias_ma60', label: '📏 60MA 季線乖離率 (Bias MA60)', cat: 'technicals', catName: '🛡️ 技術與乖離', desc: '(Price - 60MA) / 60MA 季線加速偏離程度' },
  { key: 'zscore_20d', label: '🎚️ 20日價格 Z-Score (Mean Reversion)', cat: 'technicals', catName: '🛡️ 技術與乖離', desc: '(Price - 20MA) / Std20 超買超賣與急跌反彈' }
];

export default function GlobalSovereignDashboard() {
  const [data, setData] = useState(defaultData);
  const [loading, setLoading] = useState(false);

  // ==========================================
  // 🔬 全球泰坦 Rank IC 動態因子檢驗專區 State
  // ==========================================
  const [rankIcFactor, setRankIcFactor] = useState('composite');
  const [rankIcCategoryTab, setRankIcCategoryTab] = useState('ALL'); // 'ALL' | 'flagship' | 'momentum' | 'quality' | 'technicals'
  const [rankIcPreset, setRankIcPreset] = useState('ALL'); // 'ALL' | 'OOS' | '5Y' | '3Y' | '1Y' | 'CUSTOM'
  const [rankIcStartDate, setRankIcStartDate] = useState('2004-01-01');
  const [rankIcEndDate, setRankIcEndDate] = useState('2026-10-22');
  const [rankIcLoading, setRankIcLoading] = useState(false);
  const [rankIcHoverPoint, setRankIcHoverPoint] = useState(null);

  // 登入使用者身分與帳本歸屬
  const currentUser = getCurrentUser();
  const currentUsername = currentUser?.username || 'guest';
  const storageKeys = useMemo(() => getTitanStorageKeys(currentUsername), [currentUsername]);

  // 雲端同步狀態: 'idle' | 'syncing' | 'synced' | 'saving' | 'saved' | 'error'
  const [cloudSyncStatus, setCloudSyncStatus] = useState('syncing');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const isInitialCloudLoad = useRef(true);
  const autoSaveTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 美元匯率
  const [usdFx, setUsdFx] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.usdFx) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_USDFX) : null);
      return saved ? parseFloat(saved) : 32.5;
    } catch { return 32.5; }
  });

  // 1. 所有歷史進出紀錄流水帳 (全進出紀錄) - 唯一真實來源 (Single Source of Truth)
  const [txHistory, setTxHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.allTx) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_ALL_TX) : null);
      let list = saved ? JSON.parse(saved) : DEFAULT_TX_HISTORY;
      if (!Array.isArray(list) || list.length === 0) list = DEFAULT_TX_HISTORY;
      
      // 自動校驗防呆：若快取中包含異常數據（如 phantom 幽靈股 > 1000 股或現金流赤字），即刻自動修復為方案二標準實盤帳本
      const hasCorruptedShares = list.some(tx => Number(tx.shares) > 1000);
      const totalCash = list.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
      if (hasCorruptedShares || totalCash < -10000) {
        list = DEFAULT_TX_HISTORY;
        try { localStorage.setItem(storageKeys.allTx, JSON.stringify(list)); } catch {}
      }

      // 確保歷史紀錄一定有入金流水帳 (若舊快取沒有入金，自動補上 10/1 初始入金 100 萬)
      const hasDeposit = list.some(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')));
      if (!hasDeposit) {
        list = [DEFAULT_TX_HISTORY[0], ...list];
        try { localStorage.setItem(storageKeys.allTx, JSON.stringify(list)); } catch {}
      }
      return list;
    } catch { return DEFAULT_TX_HISTORY; }
  });

  // 2. 閒置現金 (TWD) - 100% 由歷史全進出與入金流水帳 (txHistory) 的現金流動態加總推導！
  const idleCash = useMemo(() => {
    return txHistory.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
  }, [txHistory]);

  // 3. 累計入金本金 (TWD) - 100% 由歷史紀錄推導
  const totalDepositsTwd = useMemo(() => {
    const sum = txHistory
      .filter(tx => tx.action === '投入現金' || tx.action === '初始入金' || tx.action === '入金' || (tx.note && tx.note.includes('入金')))
      .reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
    return sum > 0 ? sum : 1000000;
  }, [txHistory]);

  const setIdleCash = () => {}; // 保持相容性，閒置現金已全面自動化由 txHistory 計算

  // =========================================================================
  // 4. 核心推導：所有持股部位 (userPositions) 100% 嚴格由歷史流水帳 (txHistory) 計算推導！
  // 歷史流水帳中沒有買股票 -> 持股部位絕對為 0！徹底杜絕脫鉤與幽靈持股現象。
  // =========================================================================
  const userPositions = useMemo(() => {
    if (!Array.isArray(txHistory) || txHistory.length === 0) return [];

    // 依交易日期正序推算部位變化
    const sortedTx = [...txHistory].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const holdingsMap = {};

    sortedTx.forEach(tx => {
      const action = tx.action;
      const ticker = String(tx.ticker || '').trim();
      const name = tx.name || '';

      // 跳過純資金進出與無效代碼
      if (['投入現金', '提取本金', '入金', '出金'].includes(action) || !ticker || ticker === '-') {
        return;
      }

      const key = ticker.split('.')[0] || ticker;

      if (!holdingsMap[key]) {
        const isUs = !ticker.includes('.TW') && !ticker.includes('.TWO') && tx.currency === 'USD';
        holdingsMap[key] = {
          ticker: ticker,
          name: formatStockDisplayName(ticker, name.replace(/\s*\(\d+\)/, '').trim()),
          market: isUs ? '美股 (NASDAQ)' : '台股 (TWSE)',
          currency: tx.currency || (isUs ? 'USD' : 'TWD'),
          shares: 0,
          totalCost: 0,
          totalFee: 0,
          firstBuyDate: tx.date || '',
          lastTxDate: tx.date || '',
          originalRole: tx.note || ''
        };
      }

      const h = holdingsMap[key];
      const shares = parseInt(tx.shares, 10) || 0;
      const price = parseFloat(tx.price) || 0;
      const fee = parseFloat(tx.tax_fee) || 0;

      if (action === '買入' || action === '加碼') {
        h.shares += shares;
        h.totalCost += (shares * price);
        h.totalFee += fee;
        h.lastTxDate = tx.date || h.lastTxDate;
        if (!h.firstBuyDate) h.firstBuyDate = tx.date || '';
      } else if (action === '賣出' || action === '減持') {
        if (h.shares > 0) {
          const avgCost = h.totalCost / h.shares;
          const reduceShares = Math.min(shares, h.shares);
          h.shares -= reduceShares;
          h.totalCost -= (reduceShares * avgCost);
        }
        h.lastTxDate = tx.date || h.lastTxDate;
      }
    });

    const liveMap = data?.live_prices || {};
    const picksArr = data?.current_picks || [];
    const activePositions = [];

    Object.keys(holdingsMap).forEach(key => {
      const h = holdingsMap[key];
      if (h.shares > 0) {
        const avgPrice = h.shares > 0 ? (h.totalCost / h.shares) : 0;
        const baseTicker = h.ticker.split('.')[0];
        const matchPick = picksArr.find(cp => cp.ticker === h.ticker || (cp.ticker && cp.ticker.split('.')[0] === baseTicker));
        const liveItem = liveMap[h.ticker] || liveMap[baseTicker];

        const curPrice = liveItem?.price || matchPick?.price || avgPrice;
        const curDate = liveItem?.price_date || matchPick?.price_date || (h.currency === 'USD' ? (data?.latest_us_date || '2026-10-16') : (data?.latest_tw_date || '2026-10-16'));

        const defaultPos = DEFAULT_POSITIONS.find(dp => dp.ticker === h.ticker || dp.ticker.split('.')[0] === baseTicker);
        const stopLossPrice = defaultPos?.stop_loss_price || Math.round(curPrice * 0.9 * 100) / 100;
        const role = defaultPos?.role || (h.originalRole ? (h.originalRole.match(/第[123][王者主力先鋒]+/)?.[0] || '👑 核心實盤持股') : '👑 核心實盤持股');
        const stopCondition = defaultPos?.stop_condition || '全球泰坦動態風控監控';

        activePositions.push({
          id: `pos_${baseTicker}`,
          ticker: h.ticker,
          name: formatStockDisplayName(h.ticker, h.name),
          market: h.market,
          currency: h.currency,
          shares: h.shares,
          entry_price: parseFloat(avgPrice.toFixed(2)),
          current_price: curPrice,
          price_date: curDate,
          entry_date: h.firstBuyDate,
          entry_fee: Math.round(h.totalFee),
          stop_loss_price: stopLossPrice,
          role: role,
          stop_condition: stopCondition
        });
      }
    });

    return activePositions;
  }, [txHistory, data?.live_prices, data?.current_picks, data?.latest_us_date, data?.latest_tw_date]);

  // 已送出/消掉的更動建議 key
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKeys.dismissedSugg) || (currentUsername === 'hotpotlu' ? localStorage.getItem(STORAGE_KEY_DISMISSED_SUGG) : null);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // 表格內即時修改的建議數據暫存
  const [customEdits, setCustomEdits] = useState({});

  // 現金調整彈窗
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashInputAmount, setCashInputAmount] = useState('');
  const [cashActionType, setCashActionType] = useState('deposit'); // 'deposit' or 'set'

  // 手動出場彈窗
  const [exitModal, setExitModal] = useState({
    open: false,
    posId: '',
    ticker: '',
    name: '',
    currency: 'TWD',
    shares: 0,
    entry_price: 0,
    entry_date: '',
    entry_fee: 0,
    exit_price: '',
    exit_date: new Date().toISOString().split('T')[0],
    exit_tax_fee: '',
    reason: '依策略輪動換股'
  });

  // 編輯/新增歷史紀錄彈窗
  const [editTxModal, setEditTxModal] = useState({
    open: false,
    isNew: false,
    id: '',
    date: '',
    action: '買入',
    ticker: '',
    name: '',
    currency: 'USD',
    shares: '',
    price: '',
    tax_fee: '',
    cash_flow_twd: '',
    realized_pnl_twd: '',
    realized_return_pct: '',
    note: ''
  });

  // 編輯/新增持股部位彈窗
  const [editPosModal, setEditPosModal] = useState({
    open: false,
    isNew: false,
    id: '',
    ticker: '',
    name: '',
    market: '美股 (NASDAQ)',
    currency: 'USD',
    role: '👑 第1王者 (40%)',
    shares: '',
    entry_price: '',
    current_price: '',
    entry_date: new Date().toISOString().split('T')[0],
    entry_fee: '15',
    stop_loss_price: '',
    stop_condition: '',
    syncBuyTx: true
  });

  const [feedbackMsg, setFeedbackMsg] = useState('');

  const triggerNotice = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  // 1. 當切換登入使用者或載入組件時，自動從 Supabase PostgreSQL 雲端資料庫撈取該使用者的專屬帳本
  useEffect(() => {
    let isMounted = true;
    isInitialCloudLoad.current = true;
    setCloudSyncStatus('syncing');

    const fetchCloudPortfolio = async () => {
      try {
        const res = await apiGetGlobalTitanPortfolio(currentUsername);
        if (!isMounted) return;
        if (res && res.status === 'ok') {
          if (Array.isArray(res.tx_history) && res.tx_history.length > 0) {
            const hasCorruptedShares = res.tx_history.some(tx => Number(tx.shares) > 1000);
            const totalCash = res.tx_history.reduce((acc, tx) => acc + (Number(tx.cash_flow_twd) || 0), 0);
            let normalizedTx = res.tx_history;
            if (hasCorruptedShares || totalCash < -10000) {
              normalizedTx = DEFAULT_TX_HISTORY;
            } else {
              const hasDeposit = res.tx_history.some(t => t.action === '投入現金' || t.id === 'tx_init_deposit');
              normalizedTx = hasDeposit ? res.tx_history : [...res.tx_history, DEFAULT_TX_HISTORY[0]];
            }
            setTxHistory(normalizedTx);
            try { localStorage.setItem(storageKeys.allTx, JSON.stringify(normalizedTx)); } catch {}
          }
          if (res.usd_fx) {
            setUsdFx(Number(res.usd_fx));
            try { localStorage.setItem(storageKeys.usdFx, String(res.usd_fx)); } catch {}
          }
          if (Array.isArray(res.dismissed_suggestions)) {
            setDismissedSuggestions(res.dismissed_suggestions);
            try { localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(res.dismissed_suggestions)); } catch {}
          }
          setCloudSyncStatus('synced');
          setLastSyncTime(new Date());
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn('雲端帳本讀取失敗，使用本機快取:', err);
        setCloudSyncStatus('error');
      } finally {
        setTimeout(() => {
          if (isMounted) isInitialCloudLoad.current = false;
        }, 600);
      }
    };

    fetchCloudPortfolio();
    return () => { isMounted = false; };
  }, [currentUsername, storageKeys]);

  // 2. 本地持久化儲存與防抖雲端同步 (任何更動皆自動寫入本機與 Supabase 雲端資料庫)
  useEffect(() => {
    try { localStorage.setItem(storageKeys.usdFx, String(usdFx)); } catch {}
    try { localStorage.setItem(storageKeys.idleCash, String(idleCash)); } catch {}
    try { localStorage.setItem(storageKeys.positions, JSON.stringify(userPositions)); } catch {}
    try { localStorage.setItem(storageKeys.allTx, JSON.stringify(txHistory)); } catch {}
    try { localStorage.setItem(storageKeys.dismissedSugg, JSON.stringify(dismissedSuggestions)); } catch {}

    // 初始雲端加載期間，避免用預設值反向覆蓋雲端已有數據
    if (isInitialCloudLoad.current) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setCloudSyncStatus('saving');
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await apiSaveGlobalTitanPortfolio({
          username: currentUsername,
          positions: userPositions,
          tx_history: txHistory,
          usd_fx: usdFx,
          dismissed_suggestions: dismissedSuggestions
        });
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        setTimeout(() => setCloudSyncStatus('synced'), 2500);
      } catch (err) {
        console.warn('自動雲端儲存失敗:', err);
        setCloudSyncStatus('error');
      }
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [usdFx, idleCash, userPositions, txHistory, dismissedSuggestions, storageKeys, currentUsername]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 優先直接向筆電本機 FastAPI / tw_stock.db 獲取最新全球主權演算數據與實盤報價
      const json = await apiGetGlobalSovereignDashboard();
      if (json && json.status === 'ok') {
        setData(json);
      }
    } catch (err) {
      console.warn('無法從筆電資料庫獲取最新全球主權數據，使用備援展示:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const macro = data?.macro_status || {};
  const currentPicks = data?.current_picks || [];
  const yearly = data?.yearly_performance || [];
  const shortTwDate = (data?.latest_tw_date || data?.latest_data_date || '2026-10-16').slice(5).replace('-', '/');
  const shortUsDate = (data?.latest_us_date || '2026-10-16').slice(5).replace('-', '/');

  // 1. 計算持股現值與整體統計
  const { totalStockMarketValTwd, totalCostTwd, unrealizedPnlTwd, unrealizedReturnPct } = useMemo(() => {
    let marketVal = 0;
    let cost = 0;
    userPositions.forEach(p => {
      const fx = p.currency === 'USD' ? usdFx : 1.0;
      const curPrice = p.current_price || p.entry_price;
      marketVal += p.shares * curPrice * fx;
      cost += (p.shares * p.entry_price + (p.entry_fee || 0)) * fx;
    });
    const pnl = marketVal - cost;
    const pct = cost > 0 ? (pnl / cost) * 100 : 0;
    return {
      totalStockMarketValTwd: marketVal,
      totalCostTwd: cost,
      unrealizedPnlTwd: pnl,
      unrealizedReturnPct: pct
    };
  }, [userPositions, usdFx]);

  // 當前總資產淨值 (閒置現金 + 持股市值)
  const totalNetAssetsTwd = useMemo(() => {
    return Math.max(0, idleCash + totalStockMarketValTwd);
  }, [idleCash, totalStockMarketValTwd]);

  // 帳戶真實總淨利 (總資產淨值 - 累計總入金，全依歷史流水帳計算)
  const totalNetProfitTwd = useMemo(() => {
    return totalNetAssetsTwd - totalDepositsTwd;
  }, [totalNetAssetsTwd, totalDepositsTwd]);

  const totalNetProfitPct = useMemo(() => {
    return totalDepositsTwd > 0 ? (totalNetProfitTwd / totalDepositsTwd) * 100 : 0;
  }, [totalNetProfitTwd, totalDepositsTwd]);

  // 2. 歷史全進出紀錄統計 (已實現損益、勝率、總稅費)
  const { totalRealizedPnlTwd, totalTaxesPaidTwd, closedTradesCount, winningTradesCount, winRate } = useMemo(() => {
    let pnl = 0;
    let taxes = 0;
    let closedCount = 0;
    let winCount = 0;

    txHistory.forEach(tx => {
      if (tx.tax_fee) {
        const fx = tx.currency === 'USD' ? usdFx : 1.0;
        taxes += tx.tax_fee * fx;
      }
      if (tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined) {
        pnl += tx.realized_pnl_twd;
        closedCount += 1;
        if (tx.realized_pnl_twd > 0) winCount += 1;
      }
    });

    return {
      totalRealizedPnlTwd: pnl,
      totalTaxesPaidTwd: taxes,
      closedTradesCount: closedCount,
      winningTradesCount: winCount,
      winRate: closedCount > 0 ? (winCount / closedCount) * 100 : 0
    };
  }, [txHistory, usdFx]);

  // 雙梯隊調倉計算模式: 'full_100' (100% 雙隊滿倉 - 純進攻旗艦基準) | 'tranche_a_50' (1號 A梯隊 50%) | 'tranche_b_50' (22號 B梯隊 50%)
  const [rebalanceMode, setRebalanceMode] = useState('full_100');

  // 作戰指揮艙視角: 'all' (全視角總覽) | 'titan_a' (1號 A梯隊 50%) | 'titan_b' (22號 B梯隊 50%)
  const [dashboardStationView, setDashboardStationView] = useState('all');

  // 當前顯示之實戰持股部位 (100% 由流水帳推導，無需額外篩選器)
  const displayedPositions = userPositions;

  // 雙梯隊時序自動導航計算 (每月 1 號 A 梯隊 + 每月 22 號 B 梯隊)
  const dualTrancheGuide = useMemo(() => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth() + 1;
    const day = now.getDate();

    const isWindowA = day >= 1 && day <= 4;
    const isWindowB = day >= 21 && day <= 25;

    let nextActionLabel = '';
    let nextTrancheBadge = '';
    let daysUntilNext = 0;

    if (day < 22) {
      daysUntilNext = 22 - day;
      nextActionLabel = `${yr}-${String(mo).padStart(2, '0')}-22 盤後`;
      nextTrancheBadge = '🅱️ B梯隊 (每月22號・35%進攻部位)';
    } else {
      const nextMo = mo === 12 ? 1 : mo + 1;
      const nextYr = mo === 12 ? yr + 1 : yr;
      const nextDate = new Date(nextYr, nextMo - 1, 1);
      daysUntilNext = Math.max(1, Math.ceil((nextDate - now) / (1000 * 60 * 60 * 24)));
      nextActionLabel = `${nextYr}-${String(nextMo).padStart(2, '0')}-01 盤後`;
      nextTrancheBadge = '🅰️ A梯隊 (每月1號・35%進攻部位)';
    }

    return {
      todayStr: `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      isWindowA,
      isWindowB,
      nextActionLabel,
      nextTrancheBadge,
      daysUntilNext
    };
  }, []);

  // 3. 雙梯隊持倉更動建議演算法 (支援 100% 雙隊滿倉 / 1號 A梯隊 50% / 22號 B梯隊 50%，含 DOE 容差帶與前 5 名保護帶)
  const rebalanceSuggestions = useMemo(() => {
    if (totalNetAssetsTwd <= 0) return [];

    const activeTopPicks = currentPicks.filter(p => p.is_active);
    const suggestions = [];
    const isHalfTranche = rebalanceMode === 'tranche_a_50' || rebalanceMode === 'tranche_b_50';

    let modePrefix = '🔥 100%雙隊滿倉';
    if (rebalanceMode === 'tranche_a_50') {
      modePrefix = '🅰️ 1號A隊(50%)';
    } else if (rebalanceMode === 'tranche_b_50') {
      modePrefix = '🅱️ 22號B隊(50%)';
    }

    // A. 針對目標 Top 3 標的
    activeTopPicks.forEach((pick, idx) => {
      const pRank = pick.rank || (idx + 1);
      // 雙梯隊權重設計：各隊佔 50% 總資金，梯隊內部為 40/30/30 (方案二進攻階梯)
      const weightTranchePct = pRank === 1 ? 40 : 30; // 梯隊內比例 40%, 30%, 30%
      const weightTeamPct = weightTranchePct * 0.5; // 各隊佔總資產 20%, 15%, 15%
      const totalWeightPct = weightTranchePct;       // 雙隊合併佔總資產 40%, 30%, 30%

      const targetTwdA = totalNetAssetsTwd * (weightTeamPct / 100.0);
      const targetTwdB = totalNetAssetsTwd * (weightTeamPct / 100.0);
      const targetTwdTotal = totalNetAssetsTwd * (totalWeightPct / 100.0);

      const isUsd = pick.currency === 'USD';
      const price = pick.price || 1;
      const fx = isUsd ? usdFx : 1.0;

      const targetSharesA = isUsd ? Math.floor((targetTwdA / fx) / price) : Math.floor(targetTwdA / price);
      const targetSharesB = isUsd ? Math.floor((targetTwdB / fx) / price) : Math.floor(targetTwdB / price);
      const targetSharesTotal = targetSharesA + targetSharesB;

      // 當前帳戶持有總股數
      const heldPos = userPositions.find(p => p.ticker === pick.ticker);
      const heldShares = heldPos ? heldPos.shares : 0;
      const curWeightPct = totalNetAssetsTwd > 0 ? (((heldShares * price * fx) / totalNetAssetsTwd) * 100) : 0;
      const weightDiffPct = Math.abs(curWeightPct - totalWeightPct);

      // 【核心實戰規則】：同一標的優先以 A 隊為主補滿，多出的持股給 B 隊，B 隊不滿的部分就建議買入補齊！
      const allocSharesA = Math.min(heldShares, targetSharesA);
      const deficitSharesA = Math.max(0, targetSharesA - allocSharesA);
      const isFullA = deficitSharesA === 0;

      const remForB = Math.max(0, heldShares - targetSharesA);
      const allocSharesB = Math.min(remForB, targetSharesB);
      const deficitSharesB = Math.max(0, targetSharesB - allocSharesB);
      const isFullB = deficitSharesB === 0;

      const totalDeficitShares = deficitSharesA + deficitSharesB;
      const excessShares = Math.max(0, heldShares - targetSharesTotal);

      const suggKey = `sugg_${rebalanceMode}_${pick.ticker}`;
      const isAlreadyDismissed = dismissedSuggestions.includes(suggKey);

      let action = '續抱';
      let actionColor = '#10B981';
      let recShares = 0;
      let actionNote = '';
      let isBalanced = false;
      let estFee = 0;

      if (rebalanceMode === 'full_100') {
        // === 模式 1（主要模式）：雙梯隊統一檢視 (A隊優先補滿 + B隊缺額補齊) ===
        if (totalDeficitShares === 0 && (excessShares === 0 || weightDiffPct <= 5.0)) {
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          actionNote = '雙隊皆已滿額補齊';
          isBalanced = true;
        } else if (totalDeficitShares === 0 && excessShares > 0 && weightDiffPct > 5.0 && (excessShares * price * fx) > 5000) {
          action = '減持';
          actionColor = '#F59E0B';
          recShares = excessShares;
          actionNote = `超出雙隊上限 ${excessShares} 股`;
          estFee = isUsd ? 15 : Math.round(excessShares * price * (0.003 + 0.001425));
        } else if (isFullA && deficitSharesB > 0) {
          // A 隊已補滿，B 隊不滿，買入補齊 B 隊缺額！
          action = '買入';
          actionColor = '#10B981';
          recShares = deficitSharesB;
          actionNote = `A隊已補滿，建議買入 +${deficitSharesB} 股補齊B隊`;
          estFee = isUsd ? 15 : Math.max(20, Math.round(deficitSharesB * price * 0.001425));
        } else {
          // A 隊未補滿（且 B 隊未補滿）
          action = '買入';
          actionColor = '#10B981';
          recShares = totalDeficitShares;
          actionNote = `建議買入 +${totalDeficitShares} 股 (A隊補滿${deficitSharesA}股 + B隊補齊${deficitSharesB}股)`;
          estFee = isUsd ? 15 : Math.max(20, Math.round(totalDeficitShares * price * 0.001425));
        }
      } else if (rebalanceMode === 'tranche_a_50') {
        // 單看 A 隊 (1號 A梯隊 50% 專屬調倉)
        if (isFullA) {
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          actionNote = 'A隊已滿額 (續抱)';
          isBalanced = true;
        } else {
          action = '買入';
          actionColor = '#10B981';
          recShares = deficitSharesA;
          actionNote = `建議買入 +${deficitSharesA} 股補滿 A隊`;
          estFee = isUsd ? 15 : Math.max(20, Math.round(deficitSharesA * price * 0.001425));
        }
      } else {
        // 單看 B 隊 (22號 B梯隊 50% 專屬調倉)
        if (isFullB) {
          action = '續抱';
          actionColor = '#10B981';
          recShares = 0;
          actionNote = 'B隊已補齊 (續抱)';
          isBalanced = true;
        } else {
          action = '買入';
          actionColor = '#10B981';
          recShares = deficitSharesB;
          actionNote = `建議買入 +${deficitSharesB} 股補齊 B隊`;
          estFee = isUsd ? 15 : Math.max(20, Math.round(deficitSharesB * price * 0.001425));
        }
      }

      // 目標配置文字標籤
      const targetWeightDisplay = rebalanceMode === 'full_100'
        ? `雙隊 ${totalWeightPct}% (A隊${weightTeamPct}% + B隊${weightTeamPct}%)`
        : `梯隊 ${weightTranchePct}% (總額 ${weightTeamPct}%)`;

      const roleTitle = `👑 第${pRank}主力 (總目標 ${totalWeightPct}%)`;
      const finalNote = isAlreadyDismissed ? (actionNote ? `${actionNote} (已標記完成)` : '已標記完成') : actionNote;

      suggestions.push({
        key: suggKey,
        action,
        actionColor,
        ticker: pick.ticker,
        name: formatStockDisplayName(pick.ticker, pick.name),
        market: pick.market,
        currency: pick.currency,
        targetWeightPct: totalWeightPct,
        targetWeightDisplay,
        targetTwd: targetTwdTotal,
        currentShares: heldShares,
        targetShares: targetSharesTotal,
        targetSharesA,
        allocSharesA,
        deficitSharesA,
        isFullA,
        targetSharesB,
        allocSharesB,
        deficitSharesB,
        isFullB,
        recShares,
        defaultPrice: price,
        defaultTaxFee: estFee,
        role: roleTitle,
        actionNote: finalNote,
        heldPos,
        isBalanced,
        isExecuted: isAlreadyDismissed
      });
    });

    // B. 針對目前持倉中、但不在 Top 3 的股票:
    // 檢查是否在「前 5 名保護緩衝帶 (Rank <= 5)」且未達 4 個月老化換血上限
    userPositions.forEach(heldPos => {
      const isInTarget = activeTopPicks.some(p => p.ticker === heldPos.ticker);
      const pickInfo = currentPicks.find(p => p.ticker === heldPos.ticker);
      const rank = pickInfo ? pickInfo.rank : 999;
      // 若排名在前 5 名內，且未達 4 個月換血上限 -> 緩衝保護中，不強制賣出！
      const isBufferProtected = rank <= 5 && (!heldPos.tenure_months || heldPos.tenure_months < 4);

      const suggKey = `sugg_exit_${rebalanceMode}_${heldPos.ticker}`;
      if (!isInTarget && !isBufferProtected) {
        const isUsd = heldPos.currency === 'USD';
        const curPrice = heldPos.current_price || heldPos.entry_price;
        const curWeightPct = totalNetAssetsTwd > 0 ? (((heldPos.shares * curPrice * (isUsd ? usdFx : 1.0)) / totalNetAssetsTwd) * 100) : 0;

        // 若為單梯隊調倉且部位為雙隊共振(>15%)，只換血該梯隊之50%份額；若為單梯隊持股或滿倉模式則全數出場
        const shouldHalve = isHalfTranche && heldPos.shares >= 2 && curWeightPct > 15;
        const exitShares = shouldHalve ? Math.max(1, Math.floor(heldPos.shares / 2)) : heldPos.shares;
        const estTaxFee = isUsd ? 15 : Math.round(exitShares * curPrice * (0.003 + 0.001425));

        suggestions.push({
          key: suggKey,
          action: shouldHalve ? '減持' : '賣出',
          actionColor: '#EF4444',
          ticker: heldPos.ticker,
          name: formatStockDisplayName(heldPos.ticker, heldPos.name),
          market: heldPos.market,
          currency: heldPos.currency,
          targetWeightPct: 0,
          targetWeightDisplay: '0% (離場)',
          targetTwd: 0,
          currentShares: heldPos.shares,
          targetShares: shouldHalve ? (heldPos.shares - exitShares) : 0,
          recShares: exitShares,
          defaultPrice: curPrice,
          defaultTaxFee: estTaxFee,
          role: shouldHalve ? `${modePrefix} 跌出Top5換血 (釋出50%份額)` : `${modePrefix} 跌出Top5換血 (全數出場)`,
          heldPos: heldPos,
          isBalanced: false,
          isExecuted: dismissedSuggestions.includes(suggKey)
        });
      }
    });

    return suggestions;
  }, [totalNetAssetsTwd, currentPicks, userPositions, usdFx, dismissedSuggestions, rebalanceMode]);

  // 取得目前某列的編輯數值
  const getRowValues = (sugg) => {
    const edits = customEdits[sugg.key] || {};
    return {
      shares: edits.shares !== undefined ? edits.shares : String(sugg.recShares),
      price: edits.price !== undefined ? edits.price : String(sugg.defaultPrice),
      taxFee: edits.taxFee !== undefined ? edits.taxFee : String(sugg.defaultTaxFee)
    };
  };

  const handleUpdateRowInput = (key, field, val) => {
    setCustomEdits(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: val
      }
    }));
  };

  // 一鍵複製所有調倉委託指令
  const handleCopyAllOrders = () => {
    if (!rebalanceSuggestions || rebalanceSuggestions.length === 0) return;
    const activeLines = rebalanceSuggestions
      .filter(s => s.action !== '續抱' && s.recShares > 0)
      .map(s => {
        const isUsd = s.currency === 'USD';
        const actionText = s.action === '買入' || s.action === '加碼' ? '買進' : '賣出';
        const curr = isUsd ? 'USD $' : 'NT$ ';
        return `${s.ticker} ${s.name}: ${actionText} ${s.recShares} 股 (參考價 ${curr}${s.defaultPrice})`;
      });
    if (activeLines.length === 0) {
      triggerNotice('ℹ️ 目前 3 檔主力標的均已處於平衡容差帶內，無須發送任何調倉委託！');
      return;
    }
    const text = activeLines.join('\n');
    navigator.clipboard.writeText(text);
    triggerNotice(`📋 已成功複製 ${activeLines.length} 筆調倉委託指令！`);
  };

  // 4. 點擊「🚀 確認送出」執行建議更動
  const handleExecuteSuggestion = (sugg) => {
    if (sugg.action === '續抱' || sugg.isBalanced) {
      triggerNotice(`✅「${sugg.name}」目前持倉權重已完全對齊目標，處於平衡容差帶內，請安心續抱！`);
      return;
    }

    const rowVal = getRowValues(sugg);
    const actualShares = parseInt(rowVal.shares, 10);
    const actualPrice = parseFloat(rowVal.price);
    const actualTaxFee = parseFloat(rowVal.taxFee || 0);

    if (isNaN(actualShares) || actualShares <= 0 || isNaN(actualPrice) || actualPrice <= 0) {
      alert('請填寫有效的股數與成交價格');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const isUsd = sugg.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;

    if (sugg.action === '買入') {
      const grossValTwd = actualShares * actualPrice * fx;
      const totalCostTwd = grossValTwd + (isUsd ? actualTaxFee * fx : actualTaxFee);

      // 檢查閒置資金
      if (idleCash < totalCostTwd) {
        const proceed = window.confirm(
          `提醒：當前閒置現金 (NT$ ${Math.round(idleCash).toLocaleString()}) 小於預計買進總成本 (NT$ ${Math.round(totalCostTwd).toLocaleString()})。\n是否依然確認建倉？(閒置現金將變為負值或需追加投入)`
        );
        if (!proceed) return;
      }

      // 記帳流水：寫入 txHistory 後，userPositions 與閒置現金將自動 100% 即時推導！
      const modeNotePrefix = rebalanceMode === 'full_100' ? '雙隊滿倉' : (rebalanceMode === 'tranche_a_50' ? '🅰️ 1號A隊調倉' : '🅱️ 22號B隊調倉');
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '買入',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -Math.round(totalCostTwd),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `${modeNotePrefix}：買入建倉 (${sugg.role})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【買入】${sugg.name} ${actualShares} 股！歷史流水帳已記錄，持股部位已自動更新。`);

    } else if (sugg.action === '加碼') {
      const grossValTwd = actualShares * actualPrice * fx;
      const totalCostTwd = grossValTwd + (isUsd ? actualTaxFee * fx : actualTaxFee);

      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '加碼',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: -Math.round(totalCostTwd),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `梯隊調倉：加碼 ${actualShares} 股`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【加碼】${sugg.name} ${actualShares} 股！歷史流水帳已記錄，持股部位已自動更新。`);

    } else if (sugg.action === '減持') {
      const grossProceedsTwd = actualShares * actualPrice * fx;
      const netProceedsTwd = grossProceedsTwd - (isUsd ? actualTaxFee * fx : actualTaxFee);

      // 計算部分平倉已實現損益
      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const netPnlCurrency = grossPnl - actualTaxFee;
      const netPnlTwd = Math.round(netPnlCurrency * fx);
      const costBasis = (entryPrice * actualShares) * fx;
      const netRetPct = costBasis > 0 ? (netPnlTwd / costBasis) * 100 : 0;

      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '減持',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: Math.round(netProceedsTwd),
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: Math.round(netRetPct * 10) / 10,
        note: `梯隊調倉：減持部位 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`✅ 已成功【減持】${sugg.name} ${actualShares} 股！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);

    } else if (sugg.action === '賣出') {
      // 完全清倉出場
      const grossProceedsTwd = actualShares * actualPrice * fx;
      const netProceedsTwd = grossProceedsTwd - (isUsd ? actualTaxFee * fx : actualTaxFee);

      const entryPrice = sugg.heldPos?.entry_price || actualPrice;
      const entryFee = sugg.heldPos?.entry_fee || 0;
      const grossPnl = (actualPrice - entryPrice) * actualShares;
      const totalTaxFeeCurrency = entryFee + actualTaxFee;
      const netPnlCurrency = grossPnl - totalTaxFeeCurrency;
      const netPnlTwd = Math.round(netPnlCurrency * fx);
      const totalCostBasis = (entryPrice * actualShares + entryFee) * fx;
      const netRetPct = totalCostBasis > 0 ? (netPnlTwd / totalCostBasis) * 100 : 0;

      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '賣出',
        ticker: sugg.ticker,
        name: sugg.name,
        currency: sugg.currency,
        shares: actualShares,
        price: actualPrice,
        tax_fee: actualTaxFee,
        cash_flow_twd: netProceedsTwd,
        realized_pnl_twd: netPnlTwd,
        realized_return_pct: netRetPct,
        note: `月底調倉：完全出場清倉 (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
      };
      setTxHistory(prev => [newTx, ...prev]);

      triggerNotice(`🚪 已成功【清倉賣出】${sugg.name}！現金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
    }

    // 送出後消掉該筆建議！
    setDismissedSuggestions(prev => [...prev, sugg.key]);
  };

  // 5. 現金存入/調整處理
  const handleSaveCashChange = (e) => {
    e.preventDefault();
    const amt = parseFloat(cashInputAmount);
    if (isNaN(amt)) {
      alert('請輸入有效金額');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (cashActionType === 'deposit') {
      // 追加投入
      setIdleCash(prev => prev + amt);
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '投入現金',
        ticker: '-',
        name: '資金帳戶',
        currency: 'TWD',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: amt,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `追加存入資金 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 已成功追加存入 NT$ ${Math.round(amt).toLocaleString()} 至閒置現金！`);
    } else {
      // 直接重設閒置資金
      const diff = amt - idleCash;
      setIdleCash(amt);
      const newTx = {
        id: 'tx_' + Date.now(),
        date: today,
        action: '調整資金',
        ticker: '-',
        name: '資金帳戶',
        currency: 'TWD',
        shares: 0,
        price: 0,
        tax_fee: 0,
        cash_flow_twd: diff,
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動調整閒置資金至 NT$ ${Math.round(amt).toLocaleString()}`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`💰 閒置現金已調整為 NT$ ${Math.round(amt).toLocaleString()}！`);
    }

    setCashModalOpen(false);
    setCashInputAmount('');
  };

  // 6. 手動出場彈窗邏輯
  const handleOpenExitModal = (pos) => {
    const isUsd = pos.currency === 'USD';
    const curPrice = pos.current_price || pos.entry_price;
    const estTaxFee = isUsd ? 15 : Math.round(pos.shares * curPrice * (0.003 + 0.001425));
    setExitModal({
      open: true,
      posId: pos.id,
      ticker: pos.ticker,
      name: pos.name,
      currency: pos.currency,
      shares: pos.shares,
      entry_price: pos.entry_price,
      entry_date: pos.entry_date,
      entry_fee: pos.entry_fee || 0,
      exit_price: String(curPrice),
      exit_date: new Date().toISOString().split('T')[0],
      exit_tax_fee: String(estTaxFee),
      reason: '手動平倉獲利了結'
    });
  };

  const handleConfirmExit = (e) => {
    e.preventDefault();
    const exitPriceNum = parseFloat(exitModal.exit_price);
    const taxFeeNum = parseFloat(exitModal.exit_tax_fee || 0);
    if (!exitPriceNum || exitPriceNum <= 0) {
      alert('請輸入有效的出場成交價格');
      return;
    }

    const isUsd = exitModal.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;
    const grossProceedsTwd = exitModal.shares * exitPriceNum * fx;
    const netProceedsTwd = grossProceedsTwd - (isUsd ? taxFeeNum * fx : taxFeeNum);

    const grossPnl = (exitPriceNum - exitModal.entry_price) * exitModal.shares;
    const totalTaxFeeCurrency = exitModal.entry_fee + taxFeeNum;
    const netPnlCurrency = grossPnl - totalTaxFeeCurrency;
    const netPnlTwd = netPnlCurrency * fx;
    const totalCostBasis = (exitModal.entry_price * exitModal.shares + exitModal.entry_fee) * fx;
    const netRetPct = totalCostBasis > 0 ? (netPnlTwd / totalCostBasis) * 100 : 0;

    const newTx = {
      id: 'tx_' + Date.now(),
      date: exitModal.exit_date,
      action: '賣出',
      ticker: exitModal.ticker,
      name: exitModal.name,
      currency: exitModal.currency,
      shares: exitModal.shares,
      price: exitPriceNum,
      tax_fee: taxFeeNum,
      cash_flow_twd: netProceedsTwd,
      realized_pnl_twd: netPnlTwd,
      realized_return_pct: netRetPct,
      note: `${exitModal.reason} (實現淨利: NT$ ${Math.round(netPnlTwd).toLocaleString()})`
    };
    setTxHistory(prev => [newTx, ...prev]);

    setExitModal({ ...exitModal, open: false });
    triggerNotice(`🚪 成功平倉【${exitModal.name}】！閒置資金入帳 NT$ ${Math.round(netProceedsTwd).toLocaleString()}`);
  };

  const handleOpenEditTx = (tx) => {
    setEditTxModal({
      open: true,
      isNew: false,
      id: tx.id,
      date: tx.date || new Date().toISOString().split('T')[0],
      action: tx.action || '買入',
      ticker: tx.ticker || '',
      name: tx.name || '',
      currency: tx.currency || 'USD',
      shares: tx.shares !== undefined && tx.shares !== null ? String(tx.shares) : '',
      price: tx.price !== undefined && tx.price !== null ? String(tx.price) : '',
      tax_fee: tx.tax_fee !== undefined && tx.tax_fee !== null ? String(tx.tax_fee) : '0',
      cash_flow_twd: tx.cash_flow_twd !== undefined && tx.cash_flow_twd !== null ? String(tx.cash_flow_twd) : '',
      realized_pnl_twd: tx.realized_pnl_twd !== undefined && tx.realized_pnl_twd !== null ? String(tx.realized_pnl_twd) : '',
      realized_return_pct: tx.realized_return_pct !== undefined && tx.realized_return_pct !== null ? String(tx.realized_return_pct) : '',
      note: tx.note || ''
    });
  };

  const handleOpenAddTx = () => {
    setEditTxModal({
      open: true,
      isNew: true,
      id: `tx_gl_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      action: '買入',
      ticker: '',
      name: '',
      currency: 'USD',
      shares: '50',
      price: '',
      tax_fee: '0',
      cash_flow_twd: '',
      realized_pnl_twd: '',
      realized_return_pct: '',
      note: ''
    });
  };

  const handleAutoCalcTx = () => {
    const s = parseFloat(editTxModal.shares) || 0;
    const p = parseFloat(editTxModal.price) || 0;
    const tf = parseFloat(editTxModal.tax_fee) || 0;
    const act = editTxModal.action;
    const isUsd = editTxModal.currency === 'USD';
    const fx = isUsd ? (usdFx || 32.5) : 1.0;

    let cf = 0;
    if (['買入', '加碼'].includes(act)) {
      cf = Math.round(-(s * p * fx + (isUsd ? tf * fx : tf)));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (['賣出', '減持'].includes(act)) {
      cf = Math.round(s * p * fx - (isUsd ? tf * fx : tf));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf)
      }));
    } else if (['存入', '入金'].includes(act)) {
      cf = Math.round((p > 0 ? p : (s > 0 ? s : 0)) * (isUsd ? fx : 1.0));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    } else if (['提出', '出金'].includes(act)) {
      cf = -Math.round((p > 0 ? p : (s > 0 ? s : 0)) * (isUsd ? fx : 1.0));
      setEditTxModal(prev => ({
        ...prev,
        cash_flow_twd: String(cf),
        realized_pnl_twd: '',
        realized_return_pct: ''
      }));
    }
  };

  const handleSaveTx = (e) => {
    e.preventDefault();
    if (!editTxModal.date || !editTxModal.name) {
      alert('請填寫完整日期與標的名稱');
      return;
    }

    const updatedTx = {
      id: editTxModal.id || `tx_gl_${Date.now()}`,
      date: editTxModal.date,
      action: editTxModal.action,
      ticker: editTxModal.ticker.trim() || '-',
      name: editTxModal.name.trim(),
      currency: editTxModal.currency || 'USD',
      shares: parseFloat(editTxModal.shares) || 0,
      price: parseFloat(editTxModal.price) || 0,
      tax_fee: parseFloat(editTxModal.tax_fee) || 0,
      cash_flow_twd: editTxModal.cash_flow_twd !== '' ? parseFloat(editTxModal.cash_flow_twd) : 0,
      realized_pnl_twd: editTxModal.realized_pnl_twd !== '' ? parseFloat(editTxModal.realized_pnl_twd) : null,
      realized_return_pct: editTxModal.realized_return_pct !== '' ? parseFloat(editTxModal.realized_return_pct) : null,
      note: editTxModal.note.trim()
    };

    setTxHistory(prev => {
      if (editTxModal.isNew) {
        return [updatedTx, ...prev];
      } else {
        return prev.map(item => item.id === updatedTx.id ? updatedTx : item);
      }
    });

    // 同步更新跨頁面共用的買入價格快取
    if (updatedTx.action === '買入' || updatedTx.action === '加碼') {
      try {
        const customSaved = JSON.parse(localStorage.getItem('user_custom_entry_prices') || '{}');
        customSaved[updatedTx.ticker] = updatedTx.price;
        if (updatedTx.ticker.includes('.')) {
          customSaved[updatedTx.ticker.split('.')[0]] = updatedTx.price;
        }
        localStorage.setItem('user_custom_entry_prices', JSON.stringify(customSaved));
      } catch {}
    }

    setEditTxModal(prev => ({ ...prev, open: false }));
    triggerNotice(`✅ 已成功${editTxModal.isNew ? '新增' : '更新修正'}「${updatedTx.name}」歷史交易明細！實戰部位已自動對齊。`);
  };

  const handleOpenAddPosition = () => {
    setEditPosModal({
      open: true,
      isNew: true,
      id: `pos_global_${Date.now()}`,
      ticker: '',
      name: '',
      market: '美股 (NASDAQ)',
      currency: 'USD',
      role: '👑 第1王者 (40%)',
      shares: '50',
      entry_price: '',
      current_price: '',
      entry_date: new Date().toISOString().split('T')[0],
      entry_fee: '15',
      stop_loss_price: '',
      stop_condition: '依全球主權階梯輪動持有',
      syncBuyTx: true
    });
  };

  const handleOpenEditPosition = (pos) => {
    setEditPosModal({
      open: true,
      isNew: false,
      id: pos.id,
      ticker: pos.ticker,
      name: pos.name,
      market: pos.market || (pos.currency === 'USD' ? '美股 (NASDAQ)' : '台股 (TWSE)'),
      currency: pos.currency || 'USD',
      role: pos.role || '👑 第1王者 (40%)',
      shares: String(pos.shares || ''),
      entry_price: String(pos.entry_price || ''),
      current_price: String(pos.current_price || pos.entry_price || ''),
      entry_date: pos.entry_date || new Date().toISOString().split('T')[0],
      entry_fee: String(pos.entry_fee || '0'),
      stop_loss_price: String(pos.stop_loss_price || ''),
      stop_condition: pos.stop_condition || '',
      syncBuyTx: false
    });
  };

  const handleDeletePosition = (pos) => {
    if (window.confirm(`確定要自全球持股清單中刪除「${pos.name} (${pos.ticker})」部位嗎？\n\n系統將自歷史進出流水帳中移除該標的之買進紀錄，持股部位將隨即清空，現金流亦將自動回歸。`)) {
      const baseTicker = pos.ticker.split('.')[0];
      setTxHistory(prev => prev.filter(t => t.ticker !== pos.ticker && t.ticker?.split('.')[0] !== baseTicker && !t.name?.includes(baseTicker)));
      triggerNotice(`🗑️ 已自歷史進出移除「${pos.name}」，持股部位已同步清空！`);
    }
  };

  const handleSavePosition = (e) => {
    e.preventDefault();
    const ticker = editPosModal.ticker.trim();
    const name = editPosModal.name.trim();
    if (!ticker || !name) {
      alert('請填寫標的代號與名稱！');
      return;
    }
    const isUsd = editPosModal.currency === 'USD';
    const fx = isUsd ? usdFx : 1.0;
    const sharesNum = parseFloat(editPosModal.shares) || 0;
    const entryPx = parseFloat(editPosModal.entry_price) || 0;
    const feeNum = parseFloat(editPosModal.entry_fee) || 0;

    if (editPosModal.isNew) {
      const costOrig = sharesNum * entryPx + feeNum;
      const costTwd = costOrig * fx;
      const newTx = {
        id: `tx_global_add_${Date.now()}`,
        date: editPosModal.entry_date,
        action: '買入',
        ticker: ticker,
        name: name,
        currency: editPosModal.currency,
        shares: sharesNum,
        price: entryPx,
        tax_fee: feeNum,
        cash_flow_twd: -Math.round(costTwd),
        realized_pnl_twd: null,
        realized_return_pct: null,
        note: `手動新增全球建倉 (${editPosModal.role})`
      };
      setTxHistory(prev => [newTx, ...prev]);
      triggerNotice(`✅ 已在歷史進出寫入買進「${name} (${ticker})」，持股部位已自動生成！`);
    } else {
      const baseTicker = ticker.split('.')[0];
      setTxHistory(prev => {
        let updated = false;
        return prev.map(tx => {
          if (!updated && (tx.action === '買入' || tx.action === '加碼') && (tx.ticker === ticker || tx.ticker?.split('.')[0] === baseTicker)) {
            updated = true;
            const costOrig = sharesNum * entryPx + feeNum;
            const costTwd = costOrig * fx;
            return {
              ...tx,
              date: editPosModal.entry_date,
              shares: sharesNum,
              price: entryPx,
              tax_fee: feeNum,
              cash_flow_twd: -Math.round(costTwd)
            };
          }
          return tx;
        });
      });
      triggerNotice(`✏️ 已同步更新「${name}」歷史進出流水帳，持股均價與股數已動態重算！`);
    }
    setEditPosModal(prev => ({ ...prev, open: false }));
  };

  const syncToDatabase = async () => {
    setCloudSyncStatus('saving');
    try {
      const res = await apiSaveGlobalTitanPortfolio({
        username: currentUsername,
        positions: userPositions,
        tx_history: txHistory,
        usd_fx: usdFx,
        dismissed_suggestions: dismissedSuggestions
      });
      if (res && res.status === 'ok') {
        setCloudSyncStatus('saved');
        setLastSyncTime(new Date());
        triggerNotice(`💾 已成功將「${currentUsername}」專屬帳本儲存至筆電本機資料庫 (tw_stock.db)！`);
        setTimeout(() => setCloudSyncStatus('synced'), 2500);
      } else {
        triggerNotice('⚠️ 雲端同步回應異常，已妥善保存在本機快取');
      }
    } catch (e) {
      console.warn('同步至後端資料庫失敗:', e);
      setCloudSyncStatus('error');
      triggerNotice('⚠️ 雲端連線失敗，目前已妥善保存在本機快取');
    }
  };

  // ==========================================
  // 🔬 Rank IC 因子檢驗計算器與時間範圍處理
  // ==========================================
  const handleRankIcPresetChange = (preset) => {
    setRankIcPreset(preset);
    let s = '2004-01-01';
    let e = '2026-10-22';
    if (preset === 'OOS') {
      s = '2018-01-01';
    } else if (preset === '5Y') {
      s = '2021-01-01';
    } else if (preset === '3Y') {
      s = '2023-01-01';
    } else if (preset === '1Y') {
      s = '2025-01-01';
    }
    setRankIcStartDate(s);
    setRankIcEndDate(e);
  };

  // 即時計算當前選擇範圍與因子的 Rank IC 指標
  const currentRankIcAnalysis = useMemo(() => {
    const rawSeries = defaultRankIcData?.monthly_series || [];
    const filtered = rawSeries.filter(r => {
      const d = r.date || '';
      return (!rankIcStartDate || d >= rankIcStartDate) && (!rankIcEndDate || d <= rankIcEndDate);
    });

    const activeList = filtered.length > 0 ? filtered : rawSeries;
    const vals = activeList.map(r => Number(r[rankIcFactor] || 0));
    const n = vals.length;
    if (n === 0) return null;

    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n > 1 ? n - 1 : 1);
    const std = Math.sqrt(variance) || 0.0001;
    const icir = (mean / std) * Math.sqrt(24);
    const winRate = (vals.filter(v => v > 0).length / n) * 100.0;
    const tStat = mean / (std / Math.sqrt(n));

    let cum = 0;
    const chartSeries = activeList.map(r => {
      const v = Number(r[rankIcFactor] || 0);
      cum += v;
      return {
        date: r.date,
        yearMonth: r.year_month,
        ic: Math.round(v * 10000) / 10000,
        cumIc: Math.round(cum * 10000) / 10000,
        sampleCount: r.sample_count || 0
      };
    });

    let rating = '⚠️ 具備正向預測力 (Predictive Alpha)';
    let ratingColor = '#FBBF24';
    if (mean >= 0.05 && icir >= 0.7) {
      rating = '🔥 頂級強效 (Excellent Alpha)';
      ratingColor = '#34D399';
    } else if (mean >= 0.025 && icir >= 0.4) {
      rating = '✅ 穩健有效 (Robust Alpha)';
      ratingColor = '#60A5FA';
    } else if (mean <= 0) {
      rating = '❌ 因子失效或反轉 (Ineffective)';
      ratingColor = '#F87171';
    }

    return {
      factor: rankIcFactor,
      factorName: defaultRankIcData?.factor_definitions?.[rankIcFactor] || rankIcFactor,
      startDate: activeList[0]?.date || rankIcStartDate,
      endDate: activeList[activeList.length - 1]?.date || rankIcEndDate,
      periodCount: n,
      meanIc: Math.round(mean * 10000) / 10000,
      stdIc: Math.round(std * 10000) / 10000,
      icir: Math.round(icir * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      tStat: Math.round(tStat * 100) / 100,
      rating,
      ratingColor,
      chartSeries
    };
  }, [rankIcFactor, rankIcStartDate, rankIcEndDate]);

  // SVG 向量圖形幾何計算
  const rankIcSvgData = useMemo(() => {
    if (!currentRankIcAnalysis || !currentRankIcAnalysis.chartSeries || currentRankIcAnalysis.chartSeries.length === 0) {
      return null;
    }
    const series = currentRankIcAnalysis.chartSeries;
    const w = 920;
    const h = 260;
    const padL = 50;
    const padR = 25;
    const padT = 20;
    const padB = 40;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const cumVals = series.map(s => s.cumIc);
    const minCum = Math.min(0, ...cumVals);
    const maxCum = Math.max(0.5, ...cumVals);
    const rangeCum = (maxCum - minCum) || 1;

    const points = series.map((s, idx) => {
      const x = padL + (idx / Math.max(1, series.length - 1)) * plotW;
      const normY = (s.cumIc - minCum) / rangeCum;
      const y = h - padB - normY * plotH;
      return { x, y, ...s };
    });

    const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const zeroY = h - padB - ((0 - minCum) / rangeCum) * plotH;
    const areaPath = points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${points[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
      : '';

    // 計算柱狀圖幾何 (每期 IC)
    const barH = 120;
    const barPadT = 15;
    const barPadB = 25;
    const barPlotH = barH - barPadT - barPadB;
    const icVals = series.map(s => s.ic);
    const maxAbsIc = Math.max(0.15, ...icVals.map(Math.abs));
    const barZeroY = barPadT + barPlotH / 2;

    const barWidth = Math.max(1.2, Math.min(8, (plotW / series.length) * 0.75));
    const bars = series.map((s, idx) => {
      const x = padL + (idx / Math.max(1, series.length - 1)) * plotW - barWidth / 2;
      const height = (Math.abs(s.ic) / maxAbsIc) * (barPlotH / 2);
      const y = s.ic >= 0 ? barZeroY - height : barZeroY;
      return { x, y, width: barWidth, height: Math.max(1, height), ic: s.ic, date: s.date, isPos: s.ic >= 0 };
    });

    return {
      w, h, padL, padR, padT, padB, plotW, plotH, minCum, maxCum, zeroY, points, linePath, areaPath,
      barH, barPlotH, barZeroY, maxAbsIc, bars
    };
  }, [currentRankIcAnalysis]);

  const handleExportBackup = () => {
    const exportData = {
      app: 'Lobster Report Global Titan',
      version: '2.0',
      username: currentUsername,
      exported_at: new Date().toISOString(),
      positions: userPositions,
      tx_history: txHistory,
      usd_fx: usdFx,
      dismissed_suggestions: dismissedSuggestions
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `titan_portfolio_${currentUsername}_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    triggerNotice(`📤 已成功匯出「${currentUsername}」專屬帳本備份檔！`);
  };

  const handleImportBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported.tx_history)) {
          setTxHistory(imported.tx_history);
          if (imported.usd_fx) setUsdFx(Number(imported.usd_fx));
          if (Array.isArray(imported.dismissed_suggestions)) setDismissedSuggestions(imported.dismissed_suggestions);

          await apiSaveGlobalTitanPortfolio({
            username: currentUsername,
            positions: imported.positions,
            tx_history: imported.tx_history,
            usd_fx: imported.usd_fx || usdFx,
            dismissed_suggestions: imported.dismissed_suggestions || []
          });
          setCloudSyncStatus('synced');
          setLastSyncTime(new Date());
          triggerNotice(`📥 已成功匯入帳本備份並同步更新至雲端！共 ${imported.tx_history.length} 筆流水帳，持股與損益已即時重算。`);
        } else {
          alert('備份檔案格式不正確，需包含 tx_history 陣列。');
        }
      } catch (err) {
        alert('解析備份檔案失敗：' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetToScheme2 = async () => {
    if (!window.confirm('確定要將對帳歷史與實盤部位校準為「方案二・雙梯隊合流完整實盤帳本」嗎？\n\n・初始本金：NT$ 2,100,000 (A梯隊100萬 + B梯隊加碼110萬)\n・實盤持倉：MRNA 131股、欣興 571股、創意 52股 (含10/22多買入部位)\n・閒置現金：NT$ 70,221\n\n此操作將徹底清除舊快取並同步寫入本地 tw_stock.db 與 Supabase 雲端！')) {
      return;
    }
    try {
      localStorage.removeItem(storageKeys.allTx);
      localStorage.removeItem(storageKeys.positions);
      localStorage.removeItem(storageKeys.idleCash);
      localStorage.removeItem('global_titan_all_tx_v2');
      localStorage.removeItem('global_titan_user_positions_v2');
      localStorage.removeItem(`global_titan_all_tx_v2_${currentUsername}`);
      localStorage.removeItem(`global_titan_user_positions_v2_${currentUsername}`);
    } catch {}

    setTxHistory(DEFAULT_TX_HISTORY);
    try { localStorage.setItem(storageKeys.allTx, JSON.stringify(DEFAULT_TX_HISTORY)); } catch {}

    try {
      await apiSaveGlobalTitanPortfolio({
        username: currentUsername,
        positions: DEFAULT_POSITIONS,
        tx_history: DEFAULT_TX_HISTORY,
        usd_fx: 32.5,
        dismissed_suggestions: []
      });
      triggerNotice('✅ 已成功校準為官方「方案二」完整實盤帳本（本金210萬，MRNA 131股/欣興 571股/創意 52股，閒置現金 70,221 元）！');
    } catch (err) {
      triggerNotice('✅ 本地已成功校準為方案二標準實盤帳本！');
    }
  };

  const handleDeleteTx = (id, ticker, name, action) => {
    if (window.confirm(`確定要刪除「${action} ${name}」這筆全球歷史交易紀錄嗎？\n\n刪除後，當前持股部位與損益將自動依據剩餘流水帳即時動態重算。`)) {
      setTxHistory(prev => prev.filter(item => item.id !== id));
      triggerNotice(`🗑️ 已成功刪除「${name}」該筆歷史流水帳！持股部位與損益已即時重算。`);
    }
  };


  return (
    <div className="global-sovereign-dashboard" style={{ animation: 'fadeIn 0.25s ease', paddingBottom: '3rem' }}>
      {/* 提示通知氣泡 */}
      {feedbackMsg && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #10B981, #059669)',
          color: '#FFF',
          padding: '0.85rem 1.4rem',
          borderRadius: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          zIndex: 99999,
          fontWeight: 'bold',
          fontSize: '0.92rem',
          animation: 'slideIn 0.3s ease'
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* 🌟 17 大全因子 DOE 終極冠軍模型上線通知條 */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(59, 130, 246, 0.22))',
        border: '1px solid rgba(52, 211, 153, 0.45)',
        borderRadius: '8px',
        padding: '0.65rem 1rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem',
        color: '#E2E8F0',
        fontSize: '0.85rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🎉</span>
          <span>
            <strong>【全球泰坦 2.0・方案二 正式上線】</strong>：實裝台美共同開盤日實戰對齊 + 零未來函數雙梯隊自然淘汰（1號50% + 22號50%）× 40/30/30 階梯配比！22.8年日頻回測 <strong style={{ color: '#FDE047' }}>21,284.1倍 (CAGR 54.97%)</strong>，月頻 MDD <strong style={{ color: '#34D399' }}>-30.73%</strong> (日頻 MDD -38.94%)，Calmar <strong style={{ color: '#38BDF8' }}>1.79</strong>，Sharpe <strong style={{ color: '#A78BFA' }}>1.27</strong>，年度勝率 <strong style={{ color: '#38BDF8' }}>90.9% (22年贏20年)</strong>！
          </span>
        </div>
        <span style={{ fontSize: '0.74rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.25)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
          ✅ 方案二實戰全上線
        </span>
      </div>

      {/* 頂部精簡橫條：小小的當前績效 (Mini Performance Header) */}
      <div className="glass-card" style={{
        padding: '0.9rem 1.2rem',
        marginBottom: '1.2rem',
        background: 'rgba(15, 23, 42, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {/* 第一行：標題、冠軍標籤與匯率控制 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, color: '#60A5FA', fontSize: '1.22rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              👑 全球高流動性泰坦 2.0【方案二・個人實戰無停損進攻版】
            </h3>
            <span style={{
              fontSize: '0.78rem',
              background: 'rgba(56, 189, 248, 0.18)',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              color: '#38BDF8',
              padding: '0.2rem 0.65rem',
              borderRadius: '5px',
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}>
              🗓️ 最新報價日期：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-22'}</strong> (台股 {shortTwDate}・美股 {shortUsDate})
            </span>
            <span style={{ fontSize: '0.74rem', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(59, 130, 246, 0.25))', border: '1px solid rgba(52, 211, 153, 0.45)', color: '#6EE7B7', padding: '0.2rem 0.55rem', borderRadius: '4px', fontWeight: 'bold' }}>
              🛡️ 月頻 MDD -30.73% (日頻 -38.94%)
            </span>
            <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              22.8年日頻回測 <strong style={{ color: '#34D399' }}>21,284.1倍 (CAGR 54.97%)</strong> | 月頻 MDD <strong style={{ color: '#34D399' }}>-30.73%</strong> | 日頻 MDD <strong style={{ color: '#FBBF24' }}>-38.94%</strong> | Sharpe <strong style={{ color: '#A78BFA' }}>1.27</strong> | Calmar <strong style={{ color: '#FDE047' }}>1.79</strong> | 年度勝率 <strong style={{ color: '#34D399' }}>90.9% (22年贏20年)</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
            {/* 登入身分與雲端帳本標籤 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(30, 41, 59, 0.9)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              padding: '0.22rem 0.65rem',
              borderRadius: '6px',
              fontSize: '0.78rem'
            }}>
              <span style={{ color: '#94A3B8' }}>👤 帳本所屬:</span>
              <strong style={{ color: '#FCD34D' }}>{currentUsername}</strong>
              <span style={{
                color: cloudSyncStatus === 'synced' || cloudSyncStatus === 'saved' ? '#34D399' : cloudSyncStatus === 'saving' || cloudSyncStatus === 'syncing' ? '#FBBF24' : '#F87171',
                fontWeight: 'bold',
                fontSize: '0.74rem'
              }}>
                {cloudSyncStatus === 'syncing' ? '🔄 雲端讀取中...' : cloudSyncStatus === 'saving' ? '☁️ 雲端儲存中...' : cloudSyncStatus === 'saved' ? '✅ 雲端已儲存' : cloudSyncStatus === 'error' ? '⚠️ 本機快取模式' : '☁️ 雲端已同步'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: '#CBD5E1' }}>
              <span>USD匯率:</span>
              <input
                type="number"
                step="0.1"
                value={usdFx}
                onChange={(e) => setUsdFx(parseFloat(e.target.value) || 32.5)}
                style={{ width: '60px', padding: '0.15rem 0.35rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#67E8F9', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.82rem' }}
              />
            </div>
            <button
              className="btn btn-secondary"
              onClick={fetchData}
              disabled={loading}
              style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
            >
              {loading ? '🔄 更新中' : '🔄 重新整理'}
            </button>
          </div>
        </div>

        {/* 第二行：5 個小小的當前績效與資產配比數據方塊 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.7rem' }}>
          {/* 總資產淨值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #38BDF8' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>💼 總資產淨值 (閒置+持股)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38BDF8', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalNetAssetsTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: totalNetProfitTwd >= 0 ? '#34D399' : '#F87171', marginTop: '0.2rem' }}>
              本金: NT$ {Math.round(totalDepositsTwd).toLocaleString()} | 總淨利: {totalNetProfitTwd >= 0 ? '+' : ''}{totalNetProfitPct.toFixed(2)}%
            </div>
          </div>

          {/* 雙梯隊股票市值 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #6366F1' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📊 雙梯隊股票部位 (目標 100%)</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#A5B4FC', fontFamily: 'monospace' }}>
              NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              目前佔比: {totalNetAssetsTwd > 0 ? ((totalStockMarketValTwd / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (滿倉目標 NT$ {Math.round(totalNetAssetsTwd).toLocaleString()})
            </div>
          </div>

          {/* 閒置資金與活期儲備 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: '3px solid #10B981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>💵 閒置現金與儲備池</span>
              <button
                onClick={() => { setCashActionType('deposit'); setCashModalOpen(true); }}
                style={{ background: 'rgba(16, 185, 129, 0.2)', border: 'none', color: '#34D399', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px', cursor: 'pointer' }}
              >
                ➕ 存入/調整
              </button>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#6EE7B7', fontFamily: 'monospace' }}>
              NT$ {Math.round(idleCash).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.2rem' }}>
              目前佔比: {totalNetAssetsTwd > 0 ? ((idleCash / totalNetAssetsTwd) * 100).toFixed(1) : 0}% (待命中儲備金)
            </div>
          </div>

          {/* 未實現損益 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: unrealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>📈 當前未實現損益</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: unrealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {unrealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(unrealizedPnlTwd).toLocaleString()}
              <span style={{ fontSize: '0.78rem', marginLeft: '0.3rem' }}>
                ({unrealizedReturnPct >= 0 ? '+' : ''}{unrealizedReturnPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* 累計已實現淨利 */}
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem 0.8rem', borderRadius: '6px', borderLeft: totalRealizedPnlTwd >= 0 ? '3px solid #10B981' : '3px solid #EF4444' }}>
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginBottom: '0.15rem' }}>🏆 累計已實現淨利 (扣稅費)</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
              {totalRealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnlTwd).toLocaleString()}
              <span style={{ fontSize: '0.74rem', color: '#94A3B8', marginLeft: '0.3rem' }}>
                (勝率 {winRate.toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 🎛️ 雙梯隊全視角作戰指揮切換台 (Dual-Tranche Unified Command Station) */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.8rem',
        padding: '0.75rem 1rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        borderRadius: '10px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.3rem' }}>🎛️</span>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '0.98rem', color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              作戰指揮艙視角切換
              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.25)', color: '#34D399', padding: '1px 6px', borderRadius: '4px' }}>
                雙梯隊進攻 ＋ 閒置快打旗艦版
              </span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
              每月 1 號 A 隊 (50%) 與 22 號 B 隊 (50%) 進攻主砲；閒置資金 &gt; 15% 時自動啟動極端超賣快打。
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          background: 'rgba(0, 0, 0, 0.45)',
          padding: '4px',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          gap: '4px'
        }}>
          <button
            type="button"
            onClick={() => { setDashboardStationView('all'); setRebalanceMode('full_100'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'all' ? 'linear-gradient(135deg, #3B82F6, #1D4ED8)' : 'transparent',
              color: dashboardStationView === 'all' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'all' ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🌐</span> 雙梯隊全視角總覽
          </button>
          <button
            type="button"
            onClick={() => { setDashboardStationView('titan_a'); setRebalanceMode('tranche_a_50'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'titan_a' ? 'linear-gradient(135deg, #0EA5E9, #0284C7)' : 'transparent',
              color: dashboardStationView === 'titan_a' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'titan_a' ? '0 2px 8px rgba(14, 165, 233, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🅰️</span> 1號 A梯隊 (50%)
          </button>
          <button
            type="button"
            onClick={() => { setDashboardStationView('titan_b'); setRebalanceMode('tranche_b_50'); setCustomEdits({}); }}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: dashboardStationView === 'titan_b' ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : 'transparent',
              color: dashboardStationView === 'titan_b' ? '#FFF' : '#94A3B8',
              boxShadow: dashboardStationView === 'titan_b' ? '0 2px 8px rgba(168, 85, 247, 0.4)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🅱️</span> 22號 B梯隊 (50%)
          </button>
        </div>
      </div>

      {/* 🧭 雙梯隊實戰跟單導航儀 (Dual-Tranche Follow-Along Action Guide) */}
      <div className="glass-card" style={{
        padding: '1rem 1.2rem',
        marginBottom: '1.2rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.88))',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderLeft: '4px solid #38BDF8'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.15rem' }}>🧭</span>
            <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.02rem' }}>
              雙梯隊交錯跟單導航儀（每月 1 號 A 梯隊 50% ＋ 每月 22 號 B 梯隊 50%・單一帳戶 100% 滿額進攻跟隨法）
            </h4>
            <span style={{
              fontSize: '0.73rem',
              background: (dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.18)',
              color: (dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? '#FBBF24' : '#34D399',
              border: `1px solid ${(dualTrancheGuide.isWindowA || dualTrancheGuide.isWindowB) ? 'rgba(245, 158, 11, 0.5)' : 'rgba(16, 185, 129, 0.4)'}`,
              padding: '0.18rem 0.55rem',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              {dualTrancheGuide.isWindowA
                ? '🔥 當前為【1號 A梯隊】調倉窗口！'
                : dualTrancheGuide.isWindowB
                  ? '🔥 當前為【22號 B梯隊】調倉窗口！'
                  : `⏳ 下次定期調倉日：${dualTrancheGuide.nextActionLabel} (${dualTrancheGuide.nextTrancheBadge}，倒數 ${dualTrancheGuide.daysUntilNext} 天)`}
            </span>
          </div>
          <div style={{ fontSize: '0.74rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.12)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
            🌍 宏觀寬幅：{macro.bull_countries || '10/15'} 國 &gt; 200MA ({macro.global_breadth_pct || 66.7}%) ➔ <strong>{macro.exposure_pct || 100}% 滿倉進攻</strong>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.8rem' }}>
          {/* A 梯隊說明卡 */}
          <div style={{
            background: dualTrancheGuide.isWindowA ? 'rgba(56, 189, 248, 0.12)' : 'rgba(0,0,0,0.3)',
            border: dualTrancheGuide.isWindowA ? '1px solid #38BDF8' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <strong style={{ color: '#38BDF8', fontSize: '0.86rem' }}>🅰️ A 梯隊（每月 1 號調倉｜進攻配比 50% 總資產）</strong>
              <span style={{ fontSize: '0.7rem', color: '#7DD3FC', fontFamily: 'monospace' }}>
                進攻預算 NT$ {Math.round(totalNetAssetsTwd * 0.5).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              • <strong>梯隊配比</strong>：第 1 名 <strong style={{ color: '#FBBF24' }}>25%</strong>、第 2 名 <strong style={{ color: '#67E8F9' }}>15%</strong>、第 3 名 <strong style={{ color: '#67E8F9' }}>10%</strong>（佔總淨值合計 50%，即梯隊內 50/30/20 黃金階梯）。<br/>
              • <strong>當期狀態</strong>：已於 <strong>10月1日</strong> 鎖定前 3 強（<span style={{ color: '#FDE68A' }}>MRNA / 3037 欣興 / 3443 創意</span>），續抱至 <strong>11月1日</strong> 才重新檢視。
            </div>
          </div>

          {/* B 梯隊說明卡 */}
          <div style={{
            background: dualTrancheGuide.isWindowB ? 'rgba(168, 85, 247, 0.14)' : 'rgba(0,0,0,0.3)',
            border: dualTrancheGuide.isWindowB ? '1px solid #A855F7' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <strong style={{ color: '#C084FC', fontSize: '0.86rem' }}>🅱️ B 梯隊（每月 22 號調倉｜進攻配比 50% 總資產）</strong>
              <span style={{ fontSize: '0.7rem', color: '#D8B4FE', fontFamily: 'monospace' }}>
                進攻預算 NT$ {Math.round(totalNetAssetsTwd * 0.5).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: '0.76rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              • <strong>梯隊配比</strong>：第 1 名 <strong style={{ color: '#FBBF24' }}>25%</strong>、第 2 名 <strong style={{ color: '#67E8F9' }}>15%</strong>、第 3 名 <strong style={{ color: '#67E8F9' }}>10%</strong>（佔總淨值合計 50%，即梯隊內 50/30/20 黃金階梯）。<br/>
              • <strong>當期狀態</strong>：下次調倉日為 <strong style={{ color: '#FBBF24' }}>{dualTrancheGuide.nextActionLabel}</strong>。捕捉最新財報季後強勢動能黑馬！
            </div>
          </div>

          {/* 單一帳戶零摩擦跟單心法 */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            padding: '0.7rem 0.9rem'
          }}>
            <div style={{ fontWeight: 'bold', color: '#FCD34D', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              💡 我該怎麼在「同一個帳戶」輕鬆跟單？
            </div>
            <div style={{ fontSize: '0.75rem', color: '#CBD5E1', lineHeight: '1.5' }}>
              1️⃣ <strong>兩隊選股相同時（常態共振）</strong>：A 隊 (25/15/10%) + B 隊 (25/15/10%) 合流為 <strong>50% / 30% / 20%（只買 3 檔，合計 100% 滿額進攻）</strong>。<br/>
              2️⃣ <strong>22 號出現新黑馬時</strong>：若舊股跌出前 5 名，只賣出該舊股<strong>一半部位換入新黑馬</strong>，另一半留待 1 號調倉再決定。<br/>
              3️⃣ <strong>下方一鍵切換試算</strong>：下方調倉表已內建「🔥 100% 雙隊滿倉」與「🅰️/🅱️ 50% 單梯隊」按鈕，自動幫您精算真實股數！
            </div>
          </div>
        </div>
      </div>



        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* 1. 目前持倉 (Current Live Holdings) */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #10B981' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  💼 當前實戰持有中部位 ({userPositions.length} 檔)
                </h4>
                <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  目前實戰帳戶真實持倉。可點擊「➕ 新增持股部位」手動建倉，或點擊操作欄進行「✏️ 編輯修改」、「🚪 出場」與「🗑️ 刪除」。
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{
                  fontSize: '0.78rem',
                  color: '#38BDF8',
                  background: 'rgba(56, 189, 248, 0.15)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '0.28rem 0.65rem',
                  borderRadius: '5px',
                  fontWeight: 'bold',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}>
                  🗓️ 最新報價日期：<strong style={{ color: '#FCD34D' }}>{data?.latest_data_date || '2026-10-16'}</strong> (台股 {shortTwDate}・美股 {shortUsDate})
                </div>
                <div style={{ fontSize: '0.78rem', color: '#A7F3D0', background: 'rgba(16, 185, 129, 0.1)', padding: '0.28rem 0.6rem', borderRadius: '4px' }}>
                  當前持股市值合計: <strong>NT$ {Math.round(totalStockMarketValTwd).toLocaleString()}</strong>
                </div>
                <button
                  onClick={handleOpenAddPosition}
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    border: 'none',
                    color: '#FFF',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '5px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                >
                  ➕ 新增持股部位
                </button>
                <button
                  onClick={handleResetToScheme2}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#FCA5A5',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '5px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="徹底清除快取並校準為官方方案二實盤帳本 (100萬本金、40/30/30、現金202元)"
                >
                  🔄 校準方案二帳本
                </button>
                <button
                  onClick={syncToDatabase}
                  style={{
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid rgba(99, 102, 241, 0.5)',
                    color: '#A5B4FC',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '5px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="立即將全球泰坦持股部位與交易歷史持久化寫入筆電本機資料庫 (tw_stock.db)"
                >
                  💾 儲存帳本
                </button>
                <button
                  onClick={handleExportBackup}
                  style={{
                    background: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#7DD3FC',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '5px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="將目前帳本的全部持股與流水帳匯出為 JSON 備份檔"
                >
                  📤 匯出備份
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'rgba(234, 179, 8, 0.15)',
                    border: '1px solid rgba(234, 179, 8, 0.4)',
                    color: '#FDE047',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '5px',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                  title="從電腦中選擇先前的 JSON 備份檔匯入並同步至雲端"
                >
                  📥 匯入備份
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportBackup}
                  accept=".json"
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            {/* 策略月中抱牢紀律與風控狀態看板 */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              padding: '0.65rem 0.95rem',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.6rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ fontSize: '1.15rem' }}>🛡️</span>
                <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>【👑 全球主權泰坦・純雙梯隊進攻旗艦紀律】</span>
                <span style={{ color: '#CBD5E1' }}>
                  ① <strong>100% 雙梯隊滿額進攻</strong>（1 號 A 隊 50% + 22 號 B 隊 50% 各自 25/15/10%，共振時合流為 50/30/20%）；
                  ② <strong>45/35/20 敏銳動能</strong>（12M 45% + 3M 35% + 1M 20% × FIP 資訊離散度）；
                  ③ <strong>爆量滯漲防護</strong>（5D均量 &gt; 2倍60D均量且10D漲幅 &lt; 2% 自動剔除高檔出貨陷阱）；
                  ④ <strong>前 5 名保護帶 + 滿 4 月換血 + 容差免頻繁換股</strong>；
                  ⑤ <strong>嚴格次日 T+1 開盤成交扣除手續費與摩擦成本</strong>。
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34D399', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                ● 雙梯隊監控中：MRNA / 欣興 / 創意 通過爆量滯漲檢驗並站穩 60MA
              </span>
            </div>

            {/* 持倉分類篩選列 */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.6rem',
              marginBottom: '0.85rem'
            }}>
              <div style={{ fontSize: '0.78rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10B981' }}></span>
                <span>📊 當前實戰持股部位（共 {userPositions.length} 檔，100% 嚴格由歷史交易流水帳即時推導）</span>
              </div>

              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                💡 雙梯隊進攻：每月 1 號 (A梯隊 50%) 與 22 號 (B梯隊 50%) 週期調倉，緊扣全球最強龍頭進攻！
              </div>
            </div>

            {userPositions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
                目前尚無任何持股部位。資金 100% 待命中，可點擊上方「➕ 新增持股部位」或於下方「雙梯隊持倉更動建議」執行買入！
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <th>標的代碼與名稱</th>
                      <th style={{ textAlign: 'center' }}>梯隊與配置角色</th>
                      <th style={{ textAlign: 'center' }}>當期排名 / 任期</th>
                      <th style={{ textAlign: 'center' }}>建倉日期</th>
                      <th style={{ textAlign: 'right' }}>持有股數</th>
                      <th style={{ textAlign: 'right' }}>成本均價</th>
                      <th style={{ textAlign: 'right' }}>最新現價</th>
                      <th style={{ textAlign: 'center' }}>最新報價日期</th>
                      <th style={{ textAlign: 'right' }}>目前市值 (折合NT$)</th>
                      <th style={{ textAlign: 'right' }}>未實現損益</th>
                      <th style={{ textAlign: 'right' }}>佔總淨值%</th>
                      <th style={{ textAlign: 'center' }}>防守線 (60MA/止損)</th>
                      <th style={{ textAlign: 'center' }}>量價/風控狀態</th>
                      <th style={{ textAlign: 'center', minWidth: '135px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedPositions.map((pos) => {
                      const isUsd = pos.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const fx = isUsd ? usdFx : 1.0;
                      const curPrice = pos.current_price || pos.entry_price;
                      const costTwd = (pos.shares * pos.entry_price + (pos.entry_fee || 0)) * fx;
                      const valTwd = (pos.shares * curPrice) * fx;
                      const pnlTwd = valTwd - costTwd;
                      const retPct = costTwd > 0 ? (pnlTwd / costTwd) * 100 : 0;
                      const allocPct = totalNetAssetsTwd > 0 ? (valTwd / totalNetAssetsTwd) * 100 : 0;
                      const isWin = pnlTwd >= 0;

                      // 查找該持股在最新 Top 10 雷達中的排名與量價狀態
                      const pickMatch = currentPicks.find(cp => cp.ticker === pos.ticker || (cp.ticker && pos.ticker && cp.ticker.split('.')[0] === pos.ticker.split('.')[0]));
                      const liveRank = pickMatch ? pickMatch.rank : null;
                      const churnSafe = pickMatch ? pickMatch.churn_safe !== false : true;

                      // 計算持有月數 (任期上限 4 個月)
                      const daysHeld = pos.entry_date ? Math.max(1, Math.floor((new Date() - new Date(pos.entry_date)) / (1000 * 60 * 60 * 24))) : 12;
                      const monthsHeld = Math.min(4, Math.max(1, Math.ceil(daysHeld / 30)));

                      // 停損價與安全邊界計算
                      const stopPrice = pos.stop_loss_price || (pickMatch ? pickMatch.ma60 : (pos.entry_price * 0.85));
                      const distToStopPct = stopPrice > 0 ? ((curPrice - stopPrice) / curPrice) * 100 : 10;
                      const isBroken = curPrice <= stopPrice;
                      const isWarning = !isBroken && distToStopPct <= 5;

                      // 自動推斷標籤
                      const trancheTag = allocPct >= 23
                        ? '🔥 A+B雙隊共振'
                        : (pos.entry_date && parseInt(pos.entry_date.split('-')[2], 10) >= 18 ? '🅱️ B梯隊(22號)' : '🅰️ A梯隊(1號)');

                      return (
                        <tr key={pos.id} style={{ background: isBroken ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.015)' }}>
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{formatStockDisplayName(pos.ticker, pos.name)}</strong>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>{pos.ticker} ({pos.market})</div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.68rem', color: '#A5B4FC', marginBottom: '2px', fontWeight: 'bold' }}>
                              {trancheTag}
                            </div>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.45rem',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              background: pos.role?.includes('王者') ? 'rgba(245, 158, 11, 0.25)' : 'rgba(14, 165, 233, 0.25)',
                              color: pos.role?.includes('王者') ? '#FBBF24' : '#38BDF8'
                            }}>
                              {pos.role}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {liveRank ? (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                background: liveRank <= 3 ? 'rgba(16, 185, 129, 0.2)' : (liveRank <= 5 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)'),
                                color: liveRank <= 3 ? '#34D399' : (liveRank <= 5 ? '#60A5FA' : '#F87171')
                              }}>
                                {liveRank <= 3 ? `👑 Rank #${liveRank} 正選` : (liveRank <= 5 ? `🛡️ Rank #${liveRank} 保護帶` : `⚠️ Rank #${liveRank}`)}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>觀察中</span>
                            )}
                            <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '2px' }}>
                              任期: 第 {monthsHeld}/4 月 ({daysHeld}天)
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', color: '#94A3B8', fontSize: '0.78rem' }}>{pos.entry_date}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: '#F1F5F9' }}>
                            {pos.shares?.toLocaleString()} 股
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                            {curr}{pos.entry_price?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                            {curr}{curPrice?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.78rem',
                              color: '#FCD34D',
                              background: 'rgba(245, 158, 11, 0.15)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}>
                              📅 {pos.price_date || pickMatch?.price_date || (pos.currency === 'USD' ? '2026-10-14' : '2026-10-15')}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#67E8F9' }}>
                            NT$ {Math.round(valTwd).toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', fontFamily: 'monospace', color: isWin ? '#34D399' : '#F87171' }}>
                            {isWin ? '+' : ''}NT$ {Math.round(pnlTwd).toLocaleString()} ({isWin ? '+' : ''}{retPct.toFixed(2)}%)
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                            {allocPct.toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#FCA5A5', fontSize: '0.8rem' }}>
                            {curr}{Number(stopPrice)?.toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {isBroken ? (
                              <span style={{ fontSize: '0.72rem', background: '#EF4444', color: '#FFF', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🚨 破線停損離場
                              </span>
                            ) : !churnSafe ? (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.25)', color: '#FBBF24', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                ⚠️ 爆量滯漲警示
                              </span>
                            ) : isWarning ? (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(245, 158, 11, 0.2)', color: '#FBBF24', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                ⚠️ 逼近防守線 (+{distToStopPct.toFixed(1)}%)
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34D399', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🟢 量價健康 (+{distToStopPct.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => handleOpenEditPosition(pos)}
                              style={{
                                padding: '0.22rem 0.45rem',
                                fontSize: '0.72rem',
                                background: 'rgba(56, 189, 248, 0.15)',
                                border: '1px solid rgba(56, 189, 248, 0.4)',
                                color: '#38BDF8',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                marginRight: '4px'
                              }}
                              title="編輯修改全球持股股數、成本均價與條件"
                            >
                              ✏️ 編輯
                            </button>
                            <button
                              onClick={() => handleOpenExitModal(pos)}
                                style={{
                                  padding: '0.22rem 0.45rem',
                                  fontSize: '0.72rem',
                                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                                  color: '#FFF',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  marginRight: '4px'
                                }}
                                title="平倉出場"
                              >
                                🚪 出場
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePosition(pos)}
                              style={{
                                padding: '0.22rem 0.45rem',
                                fontSize: '0.72rem',
                                background: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#F87171',
                                borderRadius: '4px',
                                cursor: 'pointer'
                              }}
                              title="自持股清單中移除此部位"
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
            )}
          </div>

          {/* 2. 雙梯隊持倉更動建議 (Dual-Tranche Rebalance Recommendations) */}
          {(dashboardStationView === 'all' || dashboardStationView === 'titan_attack' || dashboardStationView === 'titan_a' || dashboardStationView === 'titan_b') && (
            <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #38BDF8', background: 'rgba(14, 165, 233, 0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.8rem' }}>
              <div>
                <h4 style={{ margin: 0, color: '#38BDF8', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  🔄 雙梯隊持倉更動建議（A隊優先補滿 ＋ B隊缺額買入補齊）
                </h4>
                <p style={{ margin: '0.25rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                  目前為【👑 雙梯隊交錯進攻總覽 (動用 100% 總淨值 NT$ {Math.round(totalNetAssetsTwd).toLocaleString()})】：同一標的優先以 🅰️ A隊(每月1號・50%預算) 為主補滿，🅱️ B隊(每月22號・50%預算) 不滿的部分即建議買入補齊！雙隊皆補滿時安心續抱。
                </p>
              </div>

              {/* 🎛️ 雙梯隊模式標籤與操作按鈕 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'rgba(16, 185, 129, 0.12)',
                  padding: '0.35rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  color: '#34D399',
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  gap: '5px'
                }}>
                  🔥 雙隊合流 (A隊補滿 + B隊補齊)
                </div>

                <button
                  type="button"
                  onClick={handleCopyAllOrders}
                  style={{
                    background: 'rgba(56, 189, 248, 0.2)',
                    border: '1px solid #38BDF8',
                    color: '#67E8F9',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '5px',
                    fontSize: '0.76rem',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                  title="一鍵複製目前所有需要調整的下單指令"
                >
                  📋 一鍵複製調倉委託
                </button>

                {dismissedSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedSuggestions([]);
                      triggerNotice('✓ 已重設所有調倉標記，重新為您生成即時最新建議！');
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.18)',
                      border: '1px solid #EF4444',
                      color: '#FCA5A5',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '5px',
                      fontSize: '0.76rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="清空歷史消掉記錄，重新強制運算所有標的之即時缺額與調倉建議"
                  >
                    ↺ 重新產生建議 ({dismissedSuggestions.length} 筆已標記)
                  </button>
                )}
              </div>
            </div>

            {rebalanceSuggestions.length === 0 ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '8px', border: '1px dashed #10B981' }}>
                <span style={{ fontSize: '1.1rem' }}>✨</span>
                <div style={{ color: '#34D399', fontWeight: 'bold', fontSize: '0.92rem', marginTop: '0.2rem' }}>
                  目前持倉與選定模式（{rebalanceMode === 'full_100' ? '100% 雙隊純滿倉 50/30/20%' : (rebalanceMode === 'tranche_a_50' ? '1號 A梯隊 (50%)' : '22號 B梯隊 (50%)')}）已處於平衡容差帶內，無須進行任何調倉！
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.76rem', marginTop: '0.2rem' }}>
                  下次定期調倉窗口為 <strong>{dualTrancheGuide.nextActionLabel} ({dualTrancheGuide.nextTrancheBadge})</strong>，屆時系統將自動依據最新排名試算換股建議。
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th style={{ width: '80px', textAlign: 'center' }}>動作建議</th>
                      <th>標的名稱 (代碼)</th>
                      <th style={{ textAlign: 'right' }}>目標配置 (金額)</th>
                      <th style={{ textAlign: 'right' }}>目前股數</th>
                      <th style={{ textAlign: 'right', color: '#67E8F9' }}>建議更動股數</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>實際成交股數 (可改)</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>成交價格 (可改)</th>
                      <th style={{ textAlign: 'center', width: '100px' }}>稅金/手續費</th>
                      <th style={{ textAlign: 'right' }}>預估現金變動</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>執行確認</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceSuggestions.map((sugg) => {
                      const rowVal = getRowValues(sugg);
                      const isUsd = sugg.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const fx = isUsd ? usdFx : 1.0;

                      const sharesNum = parseInt(rowVal.shares, 10) || 0;
                      const priceNum = parseFloat(rowVal.price) || 0;
                      const feeNum = parseFloat(rowVal.taxFee) || 0;

                      // 現金變動估算
                      let cashDiffTwd = 0;
                      if (sugg.action === '買入' || sugg.action === '加碼') {
                        cashDiffTwd = -(sharesNum * priceNum * fx + (isUsd ? feeNum * fx : feeNum));
                      } else {
                        cashDiffTwd = (sharesNum * priceNum * fx - (isUsd ? feeNum * fx : feeNum));
                      }

                      return (
                        <tr key={sugg.key} style={{ background: 'rgba(255,255,255,0.02)' }}>
                          {/* 動作標籤 */}
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              fontSize: '0.78rem',
                              background: sugg.actionColor + '25',
                              color: sugg.actionColor,
                              border: `1px solid ${sugg.actionColor}60`
                            }}>
                              {sugg.action === '續抱' ? '✅ 續抱' : (sugg.isFullA && sugg.deficitSharesB > 0 ? '🟢 補齊B隊' : (sugg.action === '買入' ? '🟢 買入' : (sugg.action === '加碼' ? '🔵 加碼' : (sugg.action === '減持' ? '🟠 減持' : '🔴 賣出'))))}
                            </span>
                          </td>

                          {/* 標的名稱 與 雙梯隊分配進度 */}
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{formatStockDisplayName(sugg.ticker, sugg.name)}</strong>
                            <div style={{ fontSize: '0.74rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                              {sugg.ticker} | <span style={{ color: '#FBBF24' }}>{sugg.role}</span>
                            </div>
                            {/* 雙梯隊 A隊補滿 / B隊補齊 狀態條 */}
                            {sugg.targetSharesA > 0 && (
                              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', fontSize: '0.7rem', flexWrap: 'wrap' }}>
                                <span style={{
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: sugg.isFullA ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: sugg.isFullA ? '#34D399' : '#F87171',
                                  border: sugg.isFullA ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                                  fontFamily: 'monospace'
                                }}>
                                  🅰️ A隊: {sugg.isFullA ? `✅ 已補滿 (${sugg.allocSharesA}/${sugg.targetSharesA}股)` : `⚠️ 缺 ${sugg.deficitSharesA} 股`}
                                </span>
                                <span style={{
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: sugg.isFullB ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                  color: sugg.isFullB ? '#34D399' : '#FBBF24',
                                  border: sugg.isFullB ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                                  fontFamily: 'monospace'
                                }}>
                                  🅱️ B隊: {sugg.isFullB ? `✅ 已補齊 (${sugg.allocSharesB}/${sugg.targetSharesB}股)` : `⚠️ 缺 ${sugg.deficitSharesB} 股 (買入補齊)`}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 目標配置 */}
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ color: '#CBD5E1', fontWeight: 'bold' }}>{sugg.targetWeightDisplay || `${sugg.targetWeightPct}%`}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                              NT$ {Math.round(sugg.targetTwd).toLocaleString()}
                            </div>
                          </td>

                          {/* 目前股數 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#94A3B8' }}>
                            <div style={{ color: '#F1F5F9', fontWeight: 'bold' }}>{sugg.currentShares.toLocaleString()} 股</div>
                            <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>
                              佔比 {totalNetAssetsTwd > 0 ? (((sugg.currentShares * sugg.defaultPrice * (sugg.currency === 'USD' ? usdFx : 1)) / totalNetAssetsTwd) * 100).toFixed(1) : 0}%
                            </div>
                          </td>

                          {/* 建議股數 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: sugg.action === '續抱' ? '#34D399' : '#67E8F9' }}>
                            <div>{sugg.action === '續抱' ? '0 股 (已平衡)' : (sugg.action === '買入' || sugg.action === '加碼' ? `+${sugg.recShares} 股` : `-${sugg.recShares} 股`)}</div>
                            {sugg.actionNote && (
                              <div style={{ fontSize: '0.68rem', color: sugg.action === '續抱' ? '#6EE7B7' : '#FCD34D', fontWeight: 'normal', fontFamily: 'sans-serif' }}>
                                {sugg.actionNote}
                              </div>
                            )}
                          </td>

                          {/* 實際股數 Input */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              value={rowVal.shares}
                              onChange={(e) => handleUpdateRowInput(sugg.key, 'shares', e.target.value)}
                              disabled={sugg.action === '續抱' || sugg.isExecuted}
                              style={{
                                width: '85px',
                                padding: '0.3rem 0.4rem',
                                borderRadius: '4px',
                                background: (sugg.action === '續抱' || sugg.isExecuted) ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
                                border: (sugg.action === '續抱' || sugg.isExecuted) ? '1px solid rgba(255,255,255,0.1)' : '1px solid #38BDF8',
                                color: (sugg.action === '續抱' || sugg.isExecuted) ? '#94A3B8' : '#38BDF8',
                                fontWeight: 'bold',
                                textAlign: 'right',
                                fontFamily: 'monospace',
                                fontSize: '0.85rem'
                              }}
                            />
                          </td>

                          {/* 成交價格 Input */}
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                              <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>{curr}</span>
                              <input
                                type="number"
                                step="0.1"
                                value={rowVal.price}
                                onChange={(e) => handleUpdateRowInput(sugg.key, 'price', e.target.value)}
                                style={{
                                  width: '80px',
                                  padding: '0.3rem 0.4rem',
                                  borderRadius: '4px',
                                  background: 'rgba(0,0,0,0.6)',
                                  border: '1px solid rgba(255,255,255,0.25)',
                                  color: '#F8FAFC',
                                  fontWeight: 'bold',
                                  textAlign: 'right',
                                  fontFamily: 'monospace',
                                  fontSize: '0.85rem'
                                }}
                              />
                            </div>
                          </td>

                          {/* 稅費 Input */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="number"
                              value={rowVal.taxFee}
                              onChange={(e) => handleUpdateRowInput(sugg.key, 'taxFee', e.target.value)}
                              style={{
                                width: '70px',
                                padding: '0.3rem 0.4rem',
                                borderRadius: '4px',
                                background: 'rgba(0,0,0,0.6)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: '#FCA5A5',
                                textAlign: 'right',
                                fontFamily: 'monospace',
                                fontSize: '0.82rem'
                              }}
                            />
                          </td>

                          {/* 預估現金變動 */}
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: cashDiffTwd >= 0 ? '#34D399' : '#F87171' }}>
                            {cashDiffTwd >= 0 ? '+' : ''}NT$ {Math.round(cashDiffTwd).toLocaleString()}
                          </td>

                          {/* 右側按鈕送出 */}
                          <td style={{ textAlign: 'center' }}>
                            {sugg.isExecuted ? (
                              <button
                                type="button"
                                onClick={() => setDismissedSuggestions(prev => prev.filter(k => k !== sugg.key))}
                                title="點擊取消已執行標記，重新恢復為待調倉建議"
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  fontSize: '0.74rem',
                                  background: 'rgba(59, 130, 246, 0.2)',
                                  color: '#93C5FD',
                                  border: '1px solid rgba(59, 130, 246, 0.4)',
                                  borderRadius: '4px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                ✅ 已執行 (↺重算)
                              </button>
                            ) : (
                              <button
                                onClick={() => handleExecuteSuggestion(sugg)}
                                disabled={sugg.action === '續抱'}
                                style={{
                                  padding: '0.35rem 0.8rem',
                                  fontSize: '0.78rem',
                                  background: sugg.action === '續抱' ? 'rgba(16, 185, 129, 0.25)' : `linear-gradient(135deg, ${sugg.actionColor}, #0284C7)`,
                                  color: sugg.action === '續抱' ? '#34D399' : '#FFF',
                                  border: sugg.action === '續抱' ? '1px solid rgba(16, 185, 129, 0.5)' : 'none',
                                  borderRadius: '4px',
                                  fontWeight: 'bold',
                                  cursor: sugg.action === '續抱' ? 'default' : 'pointer',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {sugg.action === '續抱' ? '✅ 續抱中' : '🚀 確認送出'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* 2.5 📡 全球泰坦 Top 10 敏銳動能與爆量滯漲即時雷達表 (Live Top 10 Ranking & Churn Filter Radar) */}
          {(dashboardStationView === 'all' || dashboardStationView === 'titan_attack') && currentPicks.length > 0 && (
            <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #F59E0B', background: 'rgba(245, 158, 11, 0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.6rem' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📡 全球泰坦 2.0 (方案二・個人實戰無停損進攻版) 即時選股雷達（1號 / 22號 選股順位唯一依據）
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.77rem' }}>
                    採用<strong>方案二 4 大正交核心動能因子公式</strong>：(85% Raw + 15% 殘差) × FIP(0.50) × 凸性(0.20) × 拋物線防追高阻尼排序，並通過「5D爆量滯漲濾網」與個人實戰流動性門檻 (台股>=3,000萬/美股>=500萬美元)。第 1~3 名為當期正選 (40%/30%/30%)，第 4~5 名為在手續抱保護緩衝帶！
                  </p>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#FDE68A', background: 'rgba(245, 158, 11, 0.18)', border: '1px solid rgba(245, 158, 11, 0.45)', padding: '0.25rem 0.65rem', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                  🗓️ 最新行情基準日：{data?.latest_data_date || '2026-10-16'} (台股 {shortTwDate}・美股 {shortUsDate})
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <th style={{ textAlign: 'center', width: '115px' }}>順位與保護帶</th>
                      <th>標的名稱 (代碼 / 市場)</th>
                      <th style={{ textAlign: 'center' }}>單梯隊配比 (總資金佔比)</th>
                      <th style={{ textAlign: 'right' }}>最新現價</th>
                      <th style={{ textAlign: 'center' }}>最新報價日期</th>
                      <th style={{ textAlign: 'right' }}>防守季線 (60MA)</th>
                      <th style={{ textAlign: 'right' }}>3M 短期爆發</th>
                      <th style={{ textAlign: 'right' }}>12M 長期主升</th>
                      <th style={{ textAlign: 'right' }}>FIP 品質</th>
                      <th style={{ textAlign: 'right' }}>凸性比 (Conv)</th>
                      <th style={{ textAlign: 'right', color: '#C084FC' }}>VCP 緊湊度</th>
                      <th style={{ textAlign: 'right', color: '#F472B6' }}>Chip 籌碼</th>
                      <th style={{ textAlign: 'right', color: '#FBBF24' }}>方案二總分</th>
                      <th style={{ textAlign: 'center' }}>爆量滯漲濾網</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPicks.slice(0, 10).map((pick, idx) => {
                      const pickRank = pick.rank || (idx + 1);
                      const isTop3 = pickRank <= 3;
                      const isBuf = pickRank > 3 && pickRank <= 5;
                      const curr = pick.currency === 'USD' ? 'US$ ' : 'NT$ ';
                      const isHeld = userPositions.some(p => p.ticker === pick.ticker || (p.ticker && pick.ticker && p.ticker.split('.')[0] === pick.ticker.split('.')[0]));
                      const singleW = isTop3 ? (pickRank === 1 ? 40 : (pickRank === 2 ? 30 : 30)) : 0;
                      const navHalfW = singleW / 2;

                      return (
                        <tr key={pick.ticker} style={{
                          background: isTop3 ? 'rgba(16, 185, 129, 0.07)' : (isBuf ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.01)'),
                          borderLeft: isTop3 ? '3px solid #10B981' : (isBuf ? '3px solid #3B82F6' : 'none')
                        }}>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.73rem',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 'bold',
                              background: isTop3 ? 'rgba(16, 185, 129, 0.22)' : (isBuf ? 'rgba(59, 130, 246, 0.22)' : 'rgba(255,255,255,0.07)'),
                              color: isTop3 ? '#34D399' : (isBuf ? '#60A5FA' : '#94A3B8')
                            }}>
                              {isTop3 ? `👑 Top ${pickRank} 正選` : (isBuf ? `🛡️ Rank ${pickRank} 保護帶` : `Rank ${pickRank} 候補`)}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: '#F8FAFC' }}>{formatStockDisplayName(pick.ticker, pick.name)}</strong>
                            <span style={{ fontSize: '0.73rem', color: '#94A3B8', marginLeft: '0.35rem', fontFamily: 'monospace' }}>
                              ({pick.ticker} · {pick.market})
                            </span>
                            {isHeld && (
                              <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', background: 'rgba(245, 158, 11, 0.25)', color: '#FCD34D', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>
                                ★ 已持有
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>
                            {isTop3 ? (
                              <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>
                                單隊 {singleW}% <span style={{ color: '#94A3B8', fontSize: '0.73rem' }}>(半倉 {navHalfW}% / 滿倉 {singleW}%)</span>
                              </span>
                            ) : isBuf ? (
                              <span style={{ color: '#93C5FD', fontSize: '0.75rem' }}>在手續抱免賣 (新倉不買)</span>
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '0.75rem' }}>0% (觀察名單)</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#F8FAFC' }}>
                            {curr}{pick.price?.toLocaleString()}
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
                              📅 {pick.price_date || (pick.currency === 'USD' ? '2026-10-16' : '2026-10-16')}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#CBD5E1' }}>
                            {curr}{pick.ma60?.toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: pick.mom_3m >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {pick.mom_3m >= 0 ? '+' : ''}{pick.mom_3m}%
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: pick.mom_12m >= 0 ? '#34D399' : '#F87171', fontWeight: 'bold' }}>
                            {pick.mom_12m >= 0 ? '+' : ''}{pick.mom_12m}%
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#A5B4FC' }}>
                            {pick.fip}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#38BDF8', fontWeight: 'bold' }}>
                            {pick.convexity !== undefined ? `${Number(pick.convexity).toFixed(2)}x` : '1.00x'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#C084FC', fontWeight: 'bold' }}>
                            {pick.vcp !== undefined ? `${Number(pick.vcp).toFixed(2)}` : '0.65'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#F472B6', fontWeight: 'bold' }}>
                            {pick.chip !== undefined ? `${Number(pick.chip).toFixed(2)}` : '0.20'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: '#FBBF24' }}>
                            {pick.score?.toFixed(3)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {pick.churn_safe !== false ? (
                              <span style={{ fontSize: '0.72rem', color: '#34D399', background: 'rgba(16, 185, 129, 0.14)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🟢 量價健康
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#F87171', background: 'rgba(239, 68, 68, 0.18)', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                                🚨 爆量滯漲剔除
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. 最底下紀錄所有進出紀錄 (Complete Transaction History Ledger) */}
          <div className="glass-card" style={{ padding: '1.2rem', borderTop: '3px solid #6366F1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                <div>
                  <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📜 所有進出歷史紀錄帳簿（共 {txHistory.length} 筆流水明細）
                  </h4>
                  <p style={{ margin: '0.2rem 0 0 0', color: '#94A3B8', fontSize: '0.78rem' }}>
                    每次買入、加碼、減持、賣出與資金存入皆完整記錄扣款、入帳、稅費與已實現淨利。
                  </p>
                </div>
                <button
                  onClick={handleOpenAddTx}
                  style={{
                    background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    border: 'none',
                    color: '#FFFFFF',
                    borderRadius: '6px',
                    padding: '0.32rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: '0 2px 6px rgba(99, 102, 241, 0.4)'
                  }}
                >
                  ➕ 新增歷史交易紀錄
                </button>
              </div>

              <div style={{ fontSize: '0.76rem', color: '#CBD5E1', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                  已實現獲利: <strong style={{ color: totalRealizedPnlTwd >= 0 ? '#34D399' : '#F87171' }}>{totalRealizedPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(totalRealizedPnlTwd).toLocaleString()}</strong>
                </span>
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                  累計稅費: <strong style={{ color: '#FCA5A5' }}>NT$ {Math.round(totalTaxesPaidTwd).toLocaleString()}</strong>
                </span>
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                  平倉勝率: <strong style={{ color: '#FBBF24' }}>{winRate.toFixed(1)}%</strong>
                </span>
              </div>
            </div>

            {txHistory.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94A3B8', fontSize: '0.88rem' }}>
                尚無進出紀錄。
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table" style={{ width: '100%', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <th style={{ textAlign: 'center', width: '95px' }}>日期</th>
                      <th style={{ textAlign: 'center', width: '70px' }}>動作</th>
                      <th>標的代碼與名稱</th>
                      <th style={{ textAlign: 'right' }}>成交股數</th>
                      <th style={{ textAlign: 'right' }}>成交價格</th>
                      <th style={{ textAlign: 'right' }}>稅金/手續費</th>
                      <th style={{ textAlign: 'right' }}>現金流變動 (NT$)</th>
                      <th style={{ textAlign: 'right' }}>實現淨損益</th>
                      <th>備註原因</th>
                      <th style={{ textAlign: 'center', width: '110px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txHistory.map((tx) => {
                      const isUsd = tx.currency === 'USD';
                      const curr = isUsd ? 'US$ ' : 'NT$ ';
                      const isWin = tx.realized_pnl_twd !== null && tx.realized_pnl_twd >= 0;

                      return (
                        <tr key={tx.id} style={{ background: 'rgba(255,255,255,0.015)' }}>
                          <td style={{ textAlign: 'center', color: '#94A3B8', fontFamily: 'monospace' }}>
                            {tx.date}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: '3px',
                              fontWeight: 'bold',
                              background: tx.action === '買入' ? 'rgba(16, 185, 129, 0.2)' : (
                                tx.action === '加碼' ? 'rgba(56, 189, 248, 0.2)' : (
                                  tx.action === '減持' ? 'rgba(245, 158, 11, 0.2)' : (
                                    tx.action === '賣出' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(168, 85, 247, 0.2)'
                                  )
                                )
                              ),
                              color: tx.action === '買入' ? '#34D399' : (
                                tx.action === '加碼' ? '#38BDF8' : (
                                  tx.action === '減持' ? '#FBBF24' : (
                                    tx.action === '賣出' ? '#F87171' : '#C084FC'
                                  )
                                )
                              )
                            }}>
                              {tx.action}
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: '#F1F5F9' }}>{formatStockDisplayName(tx.ticker, tx.name)}</strong>
                            {tx.ticker !== '-' && (
                              <span style={{ fontSize: '0.72rem', color: '#94A3B8', marginLeft: '0.3rem', fontFamily: 'monospace' }}>
                                ({tx.ticker})
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {tx.shares > 0 ? `${tx.shares.toLocaleString()} 股` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {tx.price > 0 ? `${curr}${tx.price.toLocaleString()}` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#FCA5A5' }}>
                            {tx.tax_fee > 0 ? `${curr}${tx.tax_fee}` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: tx.cash_flow_twd >= 0 ? '#34D399' : '#F87171' }}>
                            {tx.cash_flow_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.cash_flow_twd).toLocaleString()}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold', color: isWin ? '#34D399' : '#F87171' }}>
                            {tx.realized_pnl_twd !== null && tx.realized_pnl_twd !== undefined ? (
                              <span>
                                {tx.realized_pnl_twd >= 0 ? '+' : ''}NT$ {Math.round(tx.realized_pnl_twd).toLocaleString()}
                                {tx.realized_return_pct !== null && (
                                  <span style={{ fontSize: '0.7rem', display: 'block', color: isWin ? '#6EE7B7' : '#FCA5A5' }}>
                                    ({tx.realized_return_pct >= 0 ? '+' : ''}{tx.realized_return_pct.toFixed(1)}%)
                                  </span>
                                )}
                              </span>
                            ) : '-'}
                          </td>
                          <td style={{ color: '#94A3B8', fontSize: '0.76rem' }}>
                            {tx.note}
                          </td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              onClick={() => handleOpenEditTx(tx)}
                              style={{
                                background: 'rgba(99, 102, 241, 0.15)',
                                border: '1px solid rgba(99, 102, 241, 0.4)',
                                color: '#A5B4FC',
                                borderRadius: '4px',
                                padding: '2px 7px',
                                fontSize: '0.74rem',
                                cursor: 'pointer',
                                marginRight: '4px'
                              }}
                              title="編輯修正此筆紀錄"
                            >
                              ✏️ 編輯
                            </button>
                            <button
                              onClick={() => handleDeleteTx(tx.id, tx.ticker, tx.name, tx.action)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.15)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#F87171',
                                borderRadius: '4px',
                                padding: '2px 7px',
                                fontSize: '0.74rem',
                                cursor: 'pointer'
                              }}
                              title="刪除此筆紀錄"
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
            )}
          </div>

        {/* 🔬 全球泰坦 Rank IC (Information Coefficient) 動態因子檢驗專區 */}
        <div className="glass-card" style={{
          marginTop: '2.5rem',
          padding: '1.6rem',
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.90))',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderTop: '4px solid #6366F1',
          borderRadius: '14px',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)'
        }}>
          {/* 頂部標題與評級 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.2rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.4rem' }}>🔬</span>
                <h3 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.3rem', fontWeight: 'bold' }}>
                  全球泰坦 Rank IC (秩相關係數) 動態因子檢驗
                </h3>
              </div>
              <p style={{ margin: '0.35rem 0 0 0', color: '#94A3B8', fontSize: '0.82rem', lineHeight: '1.4' }}>
                遵循 Grinold & Kahn 主動投資基本法則（<span style={{ fontFamily: 'monospace', color: '#CBD5E1' }}>IR = IC × √Breadth</span>），
                檢驗因子排序與未來 1 個月真實股票收益率的斯皮爾曼等級相關係數，可自選檢驗歷史區間與因子。
              </p>
            </div>

            {currentRankIcAnalysis && (
              <div style={{
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                textAlign: 'right'
              }}>
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>因子有效性評級</div>
                <div style={{ fontSize: '0.96rem', fontWeight: 'bold', color: currentRankIcAnalysis.ratingColor }}>
                  {currentRankIcAnalysis.rating}
                </div>
              </div>
            )}
          </div>

          {/* 📐 全球泰坦 17 大全因子 DOE 終極冠軍複合動能公式展示卡片 */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.75), rgba(15, 23, 42, 0.85))',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            borderRadius: '10px',
            padding: '1.2rem 1.4rem',
            marginBottom: '1.5rem',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 4px 20px rgba(0,0,0,0.3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.2rem' }}>👑</span>
                <span style={{ fontSize: '0.96rem', fontWeight: 'bold', color: '#FDE047', letterSpacing: '0.3px' }}>
                  全球泰坦 2.0 (方案二・個人實戰無停損進攻版) 數學架構
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.72rem', color: '#34D399', background: 'rgba(52, 211, 153, 0.15)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold', fontFamily: 'monospace' }}>
                  月MDD -30.73% (日頻 -38.94%)
                </span>
                <span style={{ fontSize: '0.72rem', color: '#A78BFA', background: 'rgba(167, 139, 250, 0.15)', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                  4大正交核心因子 × 40/30/30 雙梯隊自然淘汰
                </span>
              </div>
            </div>

            {/* 核心主公式大字標題 */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.55)',
              border: '1px solid rgba(253, 224, 71, 0.35)',
              borderRadius: '8px',
              padding: '0.85rem 1.1rem',
              fontFamily: 'monospace',
              fontSize: '0.88rem',
              color: '#FDE047',
              textAlign: 'center',
              lineHeight: '1.7',
              overflowX: 'auto',
              marginBottom: '1rem'
            }}>
              <strong>Final Score</strong> = (0.85×<strong>Raw_Mom</strong> + 0.15×<strong>Res_Alpha</strong>) × (1 + 0.50×<strong>FIP</strong>) × [1 + 0.20×clip(<strong>Conv</strong>-1, -0.5, 2)] × <strong>Parabolic_Damper</strong>
            </div>

            {/* 6 大公式層級細項分解 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.8rem', fontSize: '0.78rem' }}>
              {/* 第 1 層：多週期混合動能基底 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#38BDF8', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  1. 混合動能基底 (Blend Momentum)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', marginBottom: '0.3rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  Raw_Mom = 0.45 × R(12M) + 0.35 × R(3M) + 0.20 × R(1M)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  Res_Alpha = Raw_Mom - β(126D) × Raw_Mom(SPY)
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                  • 88% 總收益動能 + 12% 剝離大盤 Beta 之純特質 Alpha (Blitz et al. 2011)。
                </div>
              </div>

              {/* 第 2 層：FIP 溫水煮青蛙連續性乘數 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#34D399', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  2. 溫水煮青蛙乘數 (Frog-in-the-Pan, FIP)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', marginBottom: '0.3rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  FIP = (上漲天數 - 下跌天數) / 總交易日 (252D)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#34D399', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  乘數因子: (1.0 + 0.45 × FIP)
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                  • Da et al. (2014 RFS)：獎勵機構低調漸進買盤，懲罰暴漲一日隨後陰跌之假妖股。
                </div>
              </div>

              {/* 第 3 層：非對稱波動凸性比乘數 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#C084FC', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  3. 非對稱波動凸性乘數 (Asymmetric Convexity)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', marginBottom: '0.3rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  Convexity = 上行爆發波動(60D) / 下行收斂波動(60D)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#C084FC', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  乘數因子: 1.0 + 0.16 × clip(Convexity - 1.0, -0.5, 2.0)
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                  • 鎖定「上漲時劇烈發散暴衝、回檔時收斂縮量」的極品右偏資產。
                </div>
              </div>

              {/* 第 4 層：🌪️ VCP 波動收縮緊湊度乘數 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#FBBF24', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  4. 🌪️ 波動收縮型態 (VCP Tightness Pivot)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', marginBottom: '0.3rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  VCP = 0.40(1-Tightness) + 0.30(VolDry) + 0.30(PivotProx)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#FBBF24', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  乘數因子: 1.0 + 0.15 × (VCP_Norm - 0.5)
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                  • Minervini 經典起漲點：浮額洗淨、量縮極致收斂後的起漲樞紐點 (Low Risk Pivot)。
                </div>
              </div>

              {/* 第 5 層：💎 Chip 籌碼沉澱與吸籌乘數 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#EC4899', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  5. 💎 籌碼沉澱吸籌 (Chip Concentration)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#E2E8F0', marginBottom: '0.3rem', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  Chip = 0.50 × (UpVol/DownVol) + 0.25 × (CMF_20D + 1)
                </div>
                <div style={{ fontFamily: 'monospace', color: '#EC4899', background: 'rgba(0,0,0,0.3)', padding: '0.3rem', borderRadius: '4px' }}>
                  乘數因子: 1.0 + 0.16 × (Chip_Norm - 0.5)
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.72rem', marginTop: '0.35rem' }}>
                  • 鎖定大戶拉抬有量、回檔洗盤無人賣的籌碼鎖定股，排除主力高檔倒貨。
                </div>
              </div>

              {/* 第 6 層：三大硬性過濾門檻 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.7rem 0.9rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ color: '#F87171', fontWeight: 'bold', marginBottom: '0.3rem' }}>
                  6. 三大前置硬風控門檻 (Hard Pre-Filters)
                </div>
                <div style={{ color: '#E2E8F0', fontSize: '0.74rem', lineHeight: '1.5' }}>
                  <div>🛡️ <strong>雙均線多頭</strong>: Price &gt; 60MA 且 Price &gt; 200MA</div>
                  <div>🌊 <strong>分形趨勢效率</strong>: 0.30 × (ER_60 - 0.5) 獎勵低雜訊平滑趨勢</div>
                  <div>🚨 <strong>爆量滯漲剔除</strong>: 5D均量 &gt; 2倍60D均量 且 10D漲幅 &lt; 2% 強制淘汰</div>
                </div>
              </div>
            </div>
          </div>

          {/* 控制面板：時間範圍切換 + 因子切換 */}
          <div style={{
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '1rem 1.2rem',
            borderRadius: '10px',
            marginBottom: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem'
          }}>
            {/* 1. 時間範圍選擇 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span>📅</span> 檢驗時間範圍選擇:
                </span>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                  當前區間: {currentRankIcAnalysis?.startDate} ~ {currentRankIcAnalysis?.endDate} ({currentRankIcAnalysis?.periodCount} 期雙梯隊橫截面)
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', alignItems: 'center' }}>
                {[
                  { key: 'ALL', label: '全歷史 22年 (2004–2026)' },
                  { key: 'OOS', label: '樣本外 9年 (2018–2026 實戰)' },
                  { key: '5Y', label: '近 5 年 (2021–2026)' },
                  { key: '3Y', label: '近 3 年 (2023–2026)' },
                  { key: '1Y', label: '近 1 年 (2025–2026)' },
                  { key: 'CUSTOM', label: '自訂區間 ⚙️' }
                ].map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleRankIcPresetChange(item.key)}
                    style={{
                      padding: '0.38rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: rankIcPreset === item.key ? 'bold' : 'normal',
                      border: rankIcPreset === item.key ? '1px solid #818CF8' : '1px solid rgba(255, 255, 255, 0.1)',
                      background: rankIcPreset === item.key ? 'linear-gradient(135deg, #4F46E5, #3730A3)' : 'rgba(255, 255, 255, 0.05)',
                      color: rankIcPreset === item.key ? '#FFFFFF' : '#CBD5E1',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* 若選擇自訂區間，展開精準日期 Input */}
              {rankIcPreset === 'CUSTOM' && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.8rem',
                  marginTop: '0.7rem',
                  padding: '0.6rem 0.8rem',
                  background: 'rgba(79, 70, 229, 0.12)',
                  borderRadius: '6px',
                  border: '1px solid rgba(129, 140, 248, 0.25)'
                }}>
                  <span style={{ fontSize: '0.76rem', color: '#A5B4FC' }}>自訂起訖:</span>
                  <input
                    type="date"
                    value={rankIcStartDate}
                    onChange={(e) => setRankIcStartDate(e.target.value)}
                    style={{
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      color: '#FFF',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.8rem'
                    }}
                  />
                  <span style={{ color: '#94A3B8' }}>~</span>
                  <input
                    type="date"
                    value={rankIcEndDate}
                    onChange={(e) => setRankIcEndDate(e.target.value)}
                    style={{
                      background: 'rgba(0,0,0,0.5)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      color: '#FFF',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.8rem'
                    }}
                  />
                </div>
              )}
            </div>

            {/* 2. 檢驗因子切換 (15 大全維度量化因子) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                <div style={{ fontSize: '0.82rem', color: '#CBD5E1', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span>🧬</span> 檢驗因子選擇 (共 15 大全維度因子):
                </div>

                {/* 分類篩選 Tab */}
                <div style={{ display: 'flex', gap: '0.3rem', background: 'rgba(255,255,255,0.04)', padding: '2px', borderRadius: '6px' }}>
                  {[
                    { key: 'ALL', label: '🌟 全部 15 因子' },
                    { key: 'flagship', label: '🏆 旗艦複合' },
                    { key: 'momentum', label: '📈 價格動能' },
                    { key: 'quality', label: '🔬 質量與路徑' },
                    { key: 'technicals', label: '🛡️ 技術與反轉' }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setRankIcCategoryTab(tab.key)}
                      style={{
                        padding: '0.2rem 0.55rem',
                        fontSize: '0.72rem',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        background: rankIcCategoryTab === tab.key ? '#6366F1' : 'transparent',
                        color: rankIcCategoryTab === tab.key ? '#FFF' : '#94A3B8',
                        fontWeight: rankIcCategoryTab === tab.key ? 'bold' : 'normal'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 因子按鈕矩陣 */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                {ALL_RANK_IC_FACTORS
                  .filter(f => rankIcCategoryTab === 'ALL' || f.cat === rankIcCategoryTab)
                  .map(item => {
                    const isSelected = rankIcFactor === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setRankIcFactor(item.key)}
                        title={item.desc}
                        style={{
                          padding: '0.36rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          fontWeight: isSelected ? 'bold' : 'normal',
                          border: isSelected ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected ? 'linear-gradient(135deg, #059669, #047857)' : 'rgba(255, 255, 255, 0.05)',
                          color: isSelected ? '#FFFFFF' : '#CBD5E1',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
              </div>

              {/* 當前選中因子說明條 */}
              {(() => {
                const currentFactorObj = ALL_RANK_IC_FACTORS.find(f => f.key === rankIcFactor);
                if (!currentFactorObj) return null;
                return (
                  <div style={{
                    marginTop: '0.65rem',
                    padding: '0.4rem 0.8rem',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderLeft: '3px solid #10B981',
                    borderRadius: '4px',
                    fontSize: '0.74rem',
                    color: '#CBD5E1',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{ color: '#6EE7B7', fontWeight: 'bold' }}>[{currentFactorObj.catName}]</span>
                    <span>{currentFactorObj.desc}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* 四大核心量化指標卡片 */}
          {currentRankIcAnalysis && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '0.8rem',
              marginBottom: '1.5rem'
            }}>
              {/* Mean Rank IC */}
              <div style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '10px',
                padding: '0.9rem',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>Mean Rank IC (平均秩相關)</div>
                <div style={{
                  fontSize: '1.45rem',
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  color: currentRankIcAnalysis.meanIc >= 0 ? '#34D399' : '#F87171'
                }}>
                  {currentRankIcAnalysis.meanIc >= 0 ? '+' : ''}{currentRankIcAnalysis.meanIc}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#6EE7B7', marginTop: '0.2rem' }}>
                  {currentRankIcAnalysis.meanIc >= 0.03 ? '🔥 具備強健選股前瞻預測力' : '正向有效 (預測方向正確)'}
                </div>
              </div>

              {/* 年化 ICIR */}
              <div style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                borderRadius: '10px',
                padding: '0.9rem',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>年化 ICIR (信息比率)</div>
                <div style={{ fontSize: '1.45rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#60A5FA' }}>
                  {currentRankIcAnalysis.icir}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#93C5FD', marginTop: '0.2rem' }}>
                  Mean(IC) / Std(IC) × √24 (穩定度)
                </div>
              </div>

              {/* Rank IC 勝率 */}
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: '10px',
                padding: '0.9rem',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>IC 正向勝率 (IC &gt; 0)</div>
                <div style={{ fontSize: '1.45rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#FBBF24' }}>
                  {currentRankIcAnalysis.winRate}%
                </div>
                <div style={{ fontSize: '0.7rem', color: '#FDE68A', marginTop: '0.2rem' }}>
                  正向預測週期佔比 (高於50%具Alpha)
                </div>
              </div>

              {/* t-stat & 顯著性 */}
              <div style={{
                background: 'rgba(168, 85, 247, 0.08)',
                border: '1px solid rgba(168, 85, 247, 0.25)',
                borderRadius: '10px',
                padding: '0.9rem',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '0.74rem', color: '#94A3B8', marginBottom: '0.2rem' }}>t-stat 檢驗統計量</div>
                <div style={{ fontSize: '1.45rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#C084FC' }}>
                  t = {currentRankIcAnalysis.tStat}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#E9D5FF', marginTop: '0.2rem' }}>
                  {Math.abs(currentRankIcAnalysis.tStat) >= 2.0 ? '✅ 統計顯著 (p < 0.05 拒絕虛無)' : '樣本邊際檢驗中'}
                </div>
              </div>
            </div>
          )}

          {/* 視覺化圖表 A：累計 Rank IC 走勢曲線 (Cumulative Rank IC) */}
          {rankIcSvgData && (
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '10px',
              padding: '1.2rem',
              marginBottom: '1.2rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>📈</span> 累計 Rank IC 淨值走勢曲線（Cumulative Rank IC）
                </span>
                <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                  持續平穩右上爬升 = 因子具備跨週期長期 Alpha 延續力
                </span>
              </div>

              <div style={{ position: 'relative' }}>
                <svg viewBox={`0 0 ${rankIcSvgData.w} ${rankIcSvgData.h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  <defs>
                    <linearGradient id="rankIcGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* 零基準線 */}
                  <line
                    x1={rankIcSvgData.padL}
                    y1={rankIcSvgData.zeroY}
                    x2={rankIcSvgData.w - rankIcSvgData.padR}
                    y2={rankIcSvgData.zeroY}
                    stroke="rgba(255, 255, 255, 0.15)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={rankIcSvgData.padL - 8}
                    y={rankIcSvgData.zeroY + 3}
                    fill="#94A3B8"
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    0.0
                  </text>

                  {/* 頂部極值線 */}
                  <line
                    x1={rankIcSvgData.padL}
                    y1={rankIcSvgData.padT}
                    x2={rankIcSvgData.w - rankIcSvgData.padR}
                    y2={rankIcSvgData.padT}
                    stroke="rgba(255, 255, 255, 0.05)"
                  />
                  <text
                    x={rankIcSvgData.padL - 8}
                    y={rankIcSvgData.padT + 4}
                    fill="#94A3B8"
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    +{rankIcSvgData.maxCum.toFixed(1)}
                  </text>

                  {/* 漸層面積與折線 */}
                  {rankIcSvgData.areaPath && (
                    <path d={rankIcSvgData.areaPath} fill="url(#rankIcGrad)" />
                  )}
                  <path
                    d={rankIcSvgData.linePath}
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* 橫軸時間標籤 (抽樣顯示 6~8 個時間點) */}
                  {rankIcSvgData.points.filter((_, idx) => idx % Math.max(1, Math.floor(rankIcSvgData.points.length / 7)) === 0).map((pt, idx) => (
                    <text
                      key={idx}
                      x={pt.x}
                      y={rankIcSvgData.h - 12}
                      fill="#94A3B8"
                      fontSize="10"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {pt.yearMonth}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          )}

          {/* 視覺化圖表 B：雙梯隊調倉每期 Rank IC 柱狀分佈圖 (Monthly Rank IC Bars) */}
          {rankIcSvgData && (
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              borderRadius: '10px',
              padding: '1.2rem',
              marginBottom: '1rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 'bold', color: '#E2E8F0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>📊</span> 各期橫截面 Rank IC 柱狀分佈（翠綠正向預測 / 珊瑚紅負向反轉）
                </span>
                <span style={{ fontSize: '0.74rem', color: '#94A3B8' }}>
                  單期 IC 振幅上限: ±{rankIcSvgData.maxAbsIc.toFixed(2)}
                </span>
              </div>

              <div style={{ position: 'relative' }}>
                <svg viewBox={`0 0 ${rankIcSvgData.w} ${rankIcSvgData.barH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  {/* 柱狀圖 0 基準線 */}
                  <line
                    x1={rankIcSvgData.padL}
                    y1={rankIcSvgData.barZeroY}
                    x2={rankIcSvgData.w - rankIcSvgData.padR}
                    y2={rankIcSvgData.barZeroY}
                    stroke="rgba(255, 255, 255, 0.25)"
                  />
                  <text
                    x={rankIcSvgData.padL - 8}
                    y={rankIcSvgData.barZeroY + 3}
                    fill="#94A3B8"
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    0
                  </text>

                  {/* 每期柱體 */}
                  {rankIcSvgData.bars.map((b, idx) => (
                    <rect
                      key={idx}
                      x={b.x}
                      y={b.y}
                      width={b.width}
                      height={b.height}
                      fill={b.isPos ? '#10B981' : '#F43F5E'}
                      opacity="0.85"
                      rx="1"
                      onMouseEnter={() => setRankIcHoverPoint(b)}
                      onMouseLeave={() => setRankIcHoverPoint(null)}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </svg>

                {/* 懸停 Tooltip */}
                {rankIcHoverPoint && (
                  <div style={{
                    position: 'absolute',
                    top: '5px',
                    right: '15px',
                    background: 'rgba(15, 23, 42, 0.95)',
                    border: '1px solid #6366F1',
                    borderRadius: '6px',
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.76rem',
                    color: '#FFF',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    fontFamily: 'monospace'
                  }}>
                    📅 日期: <strong>{rankIcHoverPoint.date}</strong> | 當期 Rank IC: <strong style={{ color: rankIcHoverPoint.isPos ? '#34D399' : '#F87171' }}>
                      {rankIcHoverPoint.ic >= 0 ? '+' : ''}{rankIcHoverPoint.ic}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 學術小叮嚀指南 */}
          <div style={{
            fontSize: '0.75rem',
            color: '#94A3B8',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '0.6rem 0.9rem',
            borderRadius: '6px',
            borderLeft: '3px solid #6366F1',
            lineHeight: '1.5'
          }}>
            💡 <strong>量化常識解析</strong>：
            Rank IC 衡量每期因子打分對未來 1 個月股價報酬率的排序預測能力。
            股票市場普遍雜訊極大，通常月度 Rank IC 平均在 <strong style={{ color: '#FDE68A' }}>0.02 ~ 0.05</strong> 即具備極高實戰價值；
            若年化 ICIR 高於 <strong style={{ color: '#FDE68A' }}>0.5</strong> 且勝率高於 <strong style={{ color: '#FDE68A' }}>55%</strong>，即可保證透過長期雙梯隊輪動累積驚人的複合超額 Alpha。
          </div>
        </div>
      </div>

      {/* 資金存入 / 調整彈窗 Modal */}
      {cashModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '420px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid #F59E0B', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#FBBF24', fontSize: '1.1rem' }}>
                💵 記錄/存入閒置資金
              </h4>
              <button
                onClick={() => setCashModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: '#CBD5E1', margin: '0 0 1rem 0' }}>
              投入金額不一定需要立即買進股票，可記錄為當前閒置資金，系統將留待下次調倉時動態計算建議。
            </p>

            <form onSubmit={handleSaveCashChange}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.4rem' }}>操作模式</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setCashActionType('deposit')}
                    style={{
                      flex: 1, padding: '0.4rem', borderRadius: '4px', fontSize: '0.8rem',
                      background: cashActionType === 'deposit' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ➕ 追加存入金額
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashActionType('set')}
                    style={{
                      flex: 1, padding: '0.4rem', borderRadius: '4px', fontSize: '0.8rem',
                      background: cashActionType === 'set' ? '#F59E0B' : 'rgba(255,255,255,0.06)',
                      color: '#FFF', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    ✏️ 直接重設閒置現金
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: '#94A3B8', marginBottom: '0.3rem' }}>
                  {cashActionType === 'deposit' ? '追加投入金額 (NT$)' : '新的閒置現金總額 (NT$)'}
                </label>
                <input
                  type="number"
                  step="1000"
                  value={cashInputAmount}
                  onChange={(e) => setCashInputAmount(e.target.value)}
                  placeholder="例如 100000 或 500000"
                  required
                  style={{
                    width: '100%', padding: '0.5rem', borderRadius: '6px',
                    background: 'rgba(0,0,0,0.6)', border: '1px solid #F59E0B',
                    color: '#FDE68A', fontSize: '1.1rem', fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
                <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {[100000, 300000, 500000, 1000000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCashInputAmount(String(amt))}
                      style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', color: '#CBD5E1',
                        padding: '0.2rem 0.5rem', borderRadius: '3px', fontSize: '0.72rem', cursor: 'pointer'
                      }}
                    >
                      +{amt >= 1000000 ? `${amt / 1000000}百萬` : `${amt / 10000}萬`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCashModalOpen(false)}
                  style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.4rem 1.1rem', fontSize: '0.82rem'
                  }}
                >
                  確認更新
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 手動出場平倉彈窗 Modal */}
      {exitModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '480px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#F87171', fontSize: '1.15rem' }}>
                🚪 執行實戰持股出場平倉
              </h4>
              <button
                onClick={() => setExitModal({ ...exitModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.7rem 0.9rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.82rem' }}>
              <div style={{ color: '#F8FAFC', fontWeight: 'bold', fontSize: '0.95rem' }}>
                {formatStockDisplayName(exitModal.ticker, exitModal.name)} <span style={{ fontFamily: 'monospace', color: '#94A3B8' }}>({exitModal.ticker})</span>
              </div>
              <div style={{ color: '#CBD5E1', marginTop: '0.2rem' }}>
                持有: <strong style={{ color: '#FDE68A' }}>{exitModal.shares?.toLocaleString()} 股</strong> | 成本: <strong style={{ color: '#FDE68A' }}>{exitModal.currency === 'USD' ? 'US$ ' : 'NT$ '}{exitModal.entry_price?.toLocaleString()}</strong>
              </div>
            </div>

            <form onSubmit={handleConfirmExit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場成交價格 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_price}
                    onChange={(e) => setExitModal({ ...exitModal, exit_price: e.target.value })}
                    required
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #F87171', color: '#F87171', fontWeight: 'bold', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場稅金/手續費 ({exitModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={exitModal.exit_tax_fee}
                    onChange={(e) => setExitModal({ ...exitModal, exit_tax_fee: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF', fontFamily: 'monospace' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場日期</label>
                  <input
                    type="date"
                    value={exitModal.exit_date}
                    onChange={(e) => setExitModal({ ...exitModal, exit_date: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>出場原因</label>
                  <select
                    value={exitModal.reason}
                    onChange={(e) => setExitModal({ ...exitModal, reason: e.target.value })}
                    style={{ width: '100%', padding: '0.4rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', color: '#FFF' }}
                  >
                    <option value="依策略輪動換股">依策略輪動換股</option>
                    <option value="個人獲利了結">個人獲利了結</option>
                    <option value="大盤破年線避險清倉">大盤破年線避險清倉</option>
                    <option value="停損出場">停損出場</option>
                  </select>
                </div>
              </div>

              {/* 實時預估淨額 */}
              {(() => {
                const ep = parseFloat(exitModal.exit_price) || 0;
                const tf = parseFloat(exitModal.exit_tax_fee) || 0;
                const isUsd = exitModal.currency === 'USD';
                const fx = isUsd ? usdFx : 1.0;
                const netProceedsTwd = (exitModal.shares * ep * fx) - (isUsd ? tf * fx : tf);
                const grossPnl = (ep - exitModal.entry_price) * exitModal.shares;
                const netPnlCurrency = grossPnl - exitModal.entry_fee - tf;
                const netPnlTwd = netPnlCurrency * fx;
                return (
                  <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.6rem 0.8rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#94A3B8' }}>回流閒置現金:</span>
                      <strong style={{ color: '#FDE68A', fontFamily: 'monospace' }}>
                        +NT$ {Math.round(netProceedsTwd).toLocaleString()}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94A3B8' }}>實現淨損益 (扣稅費):</span>
                      <strong style={{ color: netPnlTwd >= 0 ? '#34D399' : '#F87171', fontFamily: 'monospace' }}>
                        {netPnlTwd >= 0 ? '+' : ''}NT$ {Math.round(netPnlTwd).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setExitModal({ ...exitModal, open: false })}
                  style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #EF4444, #B91C1C)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.4rem 1.1rem', fontSize: '0.82rem'
                  }}
                >
                  確認出場並入帳
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯 / 新增全球主權歷史交易紀錄彈窗 Modal */}
      {editTxModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '520px', width: '100%',
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '1px solid rgba(99, 102, 241, 0.5)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#A5B4FC', fontSize: '1.15rem' }}>
                {editTxModal.isNew ? '➕ 新增全球主權歷史交易紀錄' : '✏️ 編輯修正歷史交易明細'}
              </h4>
              <button
                onClick={() => setEditTxModal({ ...editTxModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTx}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>交易日期</label>
                  <input
                    type="date"
                    value={editTxModal.date}
                    onChange={(e) => setEditTxModal({ ...editTxModal, date: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>交易動作</label>
                  <select
                    value={editTxModal.action}
                    onChange={(e) => setEditTxModal({ ...editTxModal, action: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="買入">買入</option>
                    <option value="加碼">加碼</option>
                    <option value="減持">減持</option>
                    <option value="賣出">賣出 (平倉)</option>
                    <option value="存入">存入 (資金投入)</option>
                    <option value="提出">提出 (資金收回)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 0.8fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>代碼 (Ticker)</label>
                  <input
                    type="text"
                    placeholder="例: MRNA / 3037.TW"
                    value={editTxModal.ticker}
                    onChange={(e) => setEditTxModal({ ...editTxModal, ticker: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>標的名稱</label>
                  <input
                    type="text"
                    placeholder="例: 莫德納 (Moderna)"
                    value={editTxModal.name}
                    onChange={(e) => setEditTxModal({ ...editTxModal, name: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>計價幣別</label>
                  <select
                    value={editTxModal.currency}
                    onChange={(e) => setEditTxModal({ ...editTxModal, currency: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="TWD">TWD (NT$)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交股數</label>
                  <input
                    type="number"
                    step="1"
                    value={editTxModal.shares}
                    onChange={(e) => setEditTxModal({ ...editTxModal, shares: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>成交價格 ({editTxModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editTxModal.price}
                    onChange={(e) => setEditTxModal({ ...editTxModal, price: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>稅金/手續費 ({editTxModal.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editTxModal.tax_fee}
                    onChange={(e) => setEditTxModal({ ...editTxModal, tax_fee: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <label style={{ fontSize: '0.76rem', color: '#94A3B8' }}>現金流變動 (NT$)</label>
                    <button
                      type="button"
                      onClick={handleAutoCalcTx}
                      style={{ background: 'none', border: 'none', color: '#38BDF8', fontSize: '0.7rem', cursor: 'pointer', padding: 0 }}
                      title="依據幣別、匯率(1USD≈32.5NTD)與股價自動換算台幣現金流"
                    >
                      ⚡ 試算
                    </button>
                  </div>
                  <input
                    type="number"
                    step="1"
                    placeholder="負代表支出, 正代表入帳"
                    value={editTxModal.cash_flow_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, cash_flow_twd: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現淨損益 (NT$, 選填)</label>
                  <input
                    type="number"
                    step="1"
                    placeholder="平倉時填寫"
                    value={editTxModal.realized_pnl_twd}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_pnl_twd: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>實現報酬率 %</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="例: 12.5"
                    value={editTxModal.realized_return_pct}
                    onChange={(e) => setEditTxModal({ ...editTxModal, realized_return_pct: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>備註說明</label>
                <input
                  type="text"
                  placeholder="例: 美股突破策略加碼、動態輪動平倉等"
                  value={editTxModal.note}
                  onChange={(e) => setEditTxModal({ ...editTxModal, note: e.target.value })}
                  style={{
                    width: '100%', padding: '0.45rem',
                    background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditTxModal({ ...editTxModal, open: false })}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.84rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', fontSize: '0.84rem'
                  }}
                >
                  確認儲存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 編輯 / 新增全球持股部位彈窗 Modal */}
      {editPosModal.open && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100000, backdropFilter: 'blur(4px)', padding: '1rem'
        }}>
          <div className="glass-card" style={{
            maxWidth: '520px', width: '100%',
            background: 'linear-gradient(135deg, #0F172A, #1E293B)',
            border: '1px solid rgba(16, 185, 129, 0.5)', borderRadius: '10px', padding: '1.4rem'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, color: '#34D399', fontSize: '1.15rem' }}>
                {editPosModal.isNew ? '➕ 手動新增全球主權持股部位' : `✏️ 編輯持股部位 - ${editPosModal.name}`}
              </h4>
              <button
                onClick={() => setEditPosModal({ ...editPosModal, open: false })}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePosition}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>標的代碼</label>
                  <input
                    type="text"
                    placeholder="例: MRNA, 3037.TW"
                    value={editPosModal.ticker}
                    onChange={(e) => setEditPosModal({ ...editPosModal, ticker: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>商品/股票名稱</label>
                  <input
                    type="text"
                    placeholder="例: 莫德納 (Moderna)"
                    value={editPosModal.name}
                    onChange={(e) => setEditPosModal({ ...editPosModal, name: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>市場別</label>
                  <select
                    value={editPosModal.market}
                    onChange={(e) => setEditPosModal({ ...editPosModal, market: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="美股 (NASDAQ)">美股 (NASDAQ)</option>
                    <option value="美股 (NYSE)">美股 (NYSE)</option>
                    <option value="台股 (TWSE)">台股 (TWSE)</option>
                    <option value="全球 (ETF)">全球 (ETF)</option>
                    <option value="避險債券 (CASH)">避險債券 (CASH)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>計價幣別</label>
                  <select
                    value={editPosModal.currency}
                    onChange={(e) => setEditPosModal({ ...editPosModal, currency: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="USD">美元 (USD)</option>
                    <option value="TWD">新台幣 (TWD)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>配置角色</label>
                  <select
                    value={editPosModal.role}
                    onChange={(e) => setEditPosModal({ ...editPosModal, role: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: '#1E293B', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  >
                    <option value="👑 第1王者 (50%)">👑 第1王者 (50%)</option>
                    <option value="🥈 第2主力 (30%)">🥈 第2主力 (30%)</option>
                    <option value="🥉 第3先鋒 (20%)">🥉 第3先鋒 (20%)</option>
                    <option value="🛡️ 現金避險">🛡️ 現金避險</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>持有股數</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="例: 54"
                    value={editPosModal.shares}
                    onChange={(e) => setEditPosModal({ ...editPosModal, shares: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                    成本均價 ({editPosModal.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 186.61"
                    value={editPosModal.entry_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_price: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>
                    最新現價 ({editPosModal.currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="例: 225.0"
                    value={editPosModal.current_price}
                    onChange={(e) => setEditPosModal({ ...editPosModal, current_price: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.7rem', marginBottom: '0.8rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>建倉日期</label>
                  <input
                    type="date"
                    value={editPosModal.entry_date}
                    onChange={(e) => setEditPosModal({ ...editPosModal, entry_date: e.target.value })}
                    required
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', color: '#94A3B8', marginBottom: '0.2rem' }}>停損與出場條件</label>
                  <input
                    type="text"
                    placeholder="例: SPY破年線清倉、月底階梯動態輪動"
                    value={editPosModal.stop_condition}
                    onChange={(e) => setEditPosModal({ ...editPosModal, stop_condition: e.target.value })}
                    style={{
                      width: '100%', padding: '0.45rem',
                      background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '5px', color: '#FFF', fontSize: '0.84rem'
                    }}
                  />
                </div>
              </div>

              {editPosModal.isNew && (
                <div style={{ marginBottom: '1.2rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.6rem', borderRadius: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: '#A7F3D0' }}>
                    <input
                      type="checkbox"
                      checked={editPosModal.syncBuyTx}
                      onChange={(e) => setEditPosModal({ ...editPosModal, syncBuyTx: e.target.checked })}
                    />
                    <span>連動於下方歷史帳簿新增一筆「買入建倉」流水帳紀錄（並自動扣抵可用資金）</span>
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditPosModal({ ...editPosModal, open: false })}
                  style={{ padding: '0.45rem 1rem', fontSize: '0.84rem' }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn"
                  style={{
                    background: 'linear-gradient(135deg, #10B981, #059669)',
                    color: '#FFF', fontWeight: 'bold', padding: '0.45rem 1.2rem', fontSize: '0.84rem'
                  }}
                >
                  確認儲存全球持股
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

