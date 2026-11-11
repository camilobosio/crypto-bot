import fs from 'node:fs';
import path from 'node:path';

// Datos públicos de Bybit (perpetuos USDT). No requieren cuenta ni clave.
// Con DATA_SOURCE=binance usa el espejo público de Binance (spot), que funciona desde
// servidores en EE. UU. como GitHub Actions. Solo para paper trading: precios casi idénticos,
// financiamiento estimado con costs.defaultFunding.
const BASE = 'https://api.bybit.com/v5/market';
const SOURCE = process.env.DATA_SOURCE === 'binance' ? 'binance' : 'bybit';
const BINANCE = 'https://data-api.binance.vision/api/v3/klines';
export const TF_MS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const BYBIT_TF = { '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');

async function get(url, tries = 6) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url);
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.retCode !== 0) throw new Error(`Bybit ${j.retCode}: ${j.retMsg}`);
      return j.result;
    } catch (e) {
      if (k >= tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 500 * 2 ** k));
    }
  }
}

async function fetchBinance(symbol, tf, startMs) {
  const out = [];
  let from = startMs;
  while (true) {
    let rows;
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(`${BINANCE}?symbol=${symbol}&interval=${tf}&startTime=${from}&limit=1000`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        rows = await r.json();
        break;
      } catch (e) {
        if (k >= 5) throw e;
        await new Promise((s) => setTimeout(s, 500 * 2 ** k));
      }
    }
    const now = Date.now();
    for (const r of rows) if (r[6] < now) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    if (rows.length < 1000) break;
    from = rows.at(-1)[0] + TF_MS[tf];
  }
  return out;
}

// Solo velas CERRADAS, ordenadas de más vieja a más nueva.
export async function fetchKlines(symbol, tf, startMs, endMs = Date.now()) {
  if (SOURCE === 'binance') return fetchBinance(symbol, tf, startMs);
  const rows = new Map();
  let end = endMs;
  while (true) {
    const res = await get(`${BASE}/kline?category=linear&symbol=${symbol}&interval=${BYBIT_TF[tf]}&start=${startMs}&end=${end}&limit=1000`);
    const list = res.list;
    if (!list.length) break;
    for (const r of list) rows.set(+r[0], { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    const oldest = +list.at(-1)[0];
    if (oldest <= startMs || list.length < 1000) break;
    end = oldest - 1;
  }
  const now = Date.now();
  return [...rows.values()].filter((c) => c.t >= startMs && c.t + TF_MS[tf] <= now).sort((a, b) => a.t - b.t);
}

export async function fetchFunding(symbol, startMs, endMs = Date.now()) {
  if (SOURCE === 'binance') return []; // sin dato: el motor usa costs.defaultFunding
  const rows = new Map();
  let end = endMs;
  while (true) {
    const res = await get(`${BASE}/funding/history?category=linear&symbol=${symbol}&startTime=${startMs}&endTime=${end}&limit=200`);
    const list = res.list;
    if (!list.length) break;
    for (const r of list) rows.set(+r.fundingRateTimestamp, +r.fundingRate);
    const oldest = +list.at(-1).fundingRateTimestamp;
    if (oldest <= startMs || list.length < 200) break;
    end = oldest - 1;
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]);
}

function cached(file, startMs, step, fetcher, key) {
  return (async () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (!cache || cache.start > startMs) cache = { start: startMs, rows: [] };
    const last = cache.rows.at(-1);
    const fresh = await fetcher(last ? key(last) + step : startMs);
    cache.rows.push(...fresh);
    fs.writeFileSync(file, JSON.stringify(cache));
    return cache.rows.filter((r) => key(r) >= startMs);
  })();
}

const prefix = SOURCE === 'binance' ? 'binance_' : '';

export const loadCandles = (symbol, tf, startMs) =>
  cached(path.join(DATA_DIR, `${prefix}${symbol}_${tf}.json`), startMs, TF_MS[tf], (from) => fetchKlines(symbol, tf, from), (r) => r.t);

export const loadFunding = (symbol, startMs) =>
  cached(path.join(DATA_DIR, `${prefix}${symbol}_funding.json`), startMs, 1, (from) => fetchFunding(symbol, from), (r) => r[0]);

export function alignCandles(bySymbol) {
  const syms = Object.keys(bySymbol);
  let common = new Set(bySymbol[syms[0]].map((c) => c.t));
  for (const s of syms.slice(1)) {
    const ts = new Set(bySymbol[s].map((c) => c.t));
    common = new Set([...common].filter((t) => ts.has(t)));
  }
  const out = {};
  for (const s of syms) out[s] = bySymbol[s].filter((c) => common.has(c.t));
  return out;
}

// Velas de 5m de todos los pares + tasas de financiamiento.
export async function loadAll(cfg, days = cfg.historyDays) {
  const startMs = Math.floor((Date.now() - days * 864e5) / 864e5) * 864e5;
  const raw = {}, funding = {};
  await Promise.all(cfg.symbols.map(async (s) => {
    raw[s] = await loadCandles(s, '5m', startMs);
    funding[s] = new Map(await loadFunding(s, startMs));
  }));
  return { data: alignCandles(raw), funding };
}
