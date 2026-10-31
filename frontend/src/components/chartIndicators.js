// 技術指標計算：全部以陣列對齊輸入 (null 代表尚無值)

export const sma = (arr, n) => {
  const out = new Array(arr.length).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null) { sum += v; cnt++; }
    const j = i - n;
    if (j >= 0 && arr[j] != null) { sum -= arr[j]; cnt--; }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
};

export const ema = (arr, n) => {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    prev = prev == null ? v : v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
};

const stdev = (arr, n) => {
  const out = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += arr[j];
    m /= n;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (arr[j] - m) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
};

export const bollinger = (close, n = 20, k = 2) => {
  const mid = sma(close, n);
  const sd = stdev(close, n);
  return {
    mid,
    upper: mid.map((m, i) => (m == null ? null : m + k * sd[i])),
    lower: mid.map((m, i) => (m == null ? null : m - k * sd[i])),
  };
};

// 台股 KD (9,3,3)：RSV 以 1/3 權重遞迴平滑，初值 50
export const kd = (high, low, close, n = 9) => {
  const K = new Array(close.length).fill(null);
  const D = new Array(close.length).fill(null);
  let k = 50, d = 50;
  for (let i = n - 1; i < close.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, high[j]); ll = Math.min(ll, low[j]); }
    const rsv = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    K[i] = k; D[i] = d;
  }
  return { K, D };
};

export const macd = (close, fast = 12, slow = 26, sig = 9) => {
  const ef = ema(close, fast), es = ema(close, slow);
  const dif = close.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const dea = ema(dif, sig);
  const hist = dif.map((v, i) => (v != null && dea[i] != null ? (v - dea[i]) * 2 : null));
  return { dif, dea, hist };
};

// Wilder RSI
export const rsi = (close, n = 14) => {
  const out = new Array(close.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) {
      ag += g / n; al += l / n;
      if (i < n) continue;
    } else {
      ag = (ag * (n - 1) + g) / n;
      al = (al * (n - 1) + l) / n;
    }
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
};

export const bias = (close, n) => {
  const m = sma(close, n);
  return close.map((c, i) => (m[i] ? ((c - m[i]) / m[i]) * 100 : null));
};

export const obv = (close, vol) => {
  const out = [0];
  for (let i = 1; i < close.length; i++) {
    out.push(out[i - 1] + (close[i] > close[i - 1] ? vol[i] : close[i] < close[i - 1] ? -vol[i] : 0));
  }
  return out;
};

export const atr = (high, low, close, n = 14) => {
  const tr = close.map((c, i) => (i === 0 ? high[i] - low[i]
    : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]))));
  const out = new Array(close.length).fill(null);
  let prev = null;
  for (let i = 0; i < tr.length; i++) {
    if (i === n - 1) { prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n; out[i] = prev; }
    else if (i >= n) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  }
  return out;
};

// 威廉 %R
export const williams = (high, low, close, n = 14) => close.map((c, i) => {
  if (i < n - 1) return null;
  let hh = -Infinity, ll = Infinity;
  for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, high[j]); ll = Math.min(ll, low[j]); }
  return hh === ll ? -50 : ((hh - c) / (hh - ll)) * -100;
});

// DMI / ADX
export const dmi = (high, low, close, n = 14) => {
  const len = close.length;
  const pdm = [0], mdm = [0], tr = [high[0] - low[0]];
  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const wilder = (a) => {
    const o = new Array(len).fill(null);
    let s = 0;
    for (let i = 0; i < len; i++) {
      if (i < n) { s += a[i]; if (i === n - 1) o[i] = s; }
      else { s = s - s / n + a[i]; o[i] = s; }
    }
    return o;
  };
  const str = wilder(tr), sp = wilder(pdm), sm = wilder(mdm);
  const pdi = str.map((t, i) => (t ? (sp[i] / t) * 100 : null));
  const mdi = str.map((t, i) => (t ? (sm[i] / t) * 100 : null));
  const dx = pdi.map((p, i) => (p != null && p + mdi[i] > 0 ? (Math.abs(p - mdi[i]) / (p + mdi[i])) * 100 : null));
  const adx = new Array(len).fill(null);
  let first = dx.findIndex((v) => v != null);
  if (first >= 0 && first + n <= len) {
    let s = 0;
    for (let i = first; i < first + n; i++) s += dx[i];
    adx[first + n - 1] = s / n;
    for (let i = first + n; i < len; i++) adx[i] = (adx[i - 1] * (n - 1) + dx[i]) / n;
  }
  return { pdi, mdi, adx };
};

// 累計值 (法人買賣超累積線)
export const cumsum = (arr) => {
  let s = 0;
  return arr.map((v) => { s += v || 0; return s; });
};

// 交叉訊號：a 上穿 b => +1，下穿 => -1
export const crossovers = (a, b) => {
  const out = [];
  for (let i = 1; i < a.length; i++) {
    if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) out.push({ i, dir: 1 });
    else if (a[i - 1] >= b[i - 1] && a[i] < b[i]) out.push({ i, dir: -1 });
  }
  return out;
};
