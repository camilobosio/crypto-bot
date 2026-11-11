import { FuturesPortfolio, runBacktest } from './engine.js';
import { gridCombos, base, prepareAll } from './strategies.js';
import { metrics } from './metrics.js';

const addMonths = (t, m) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + m); return d.getTime(); };
const idxAt = (times, t) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; } return lo; };

// Optimiza en 3 meses, opera el mes siguiente con esos parámetros, avanza un mes y repite.
// Fuera de muestra es UNA cartera continua: posiciones, caída e interruptor se arrastran.
export function walkForward({ data, funding, strategy, cfg, onWindow }) {
  const W = cfg.walkforward;
  const syms = Object.keys(data);
  const times = data[syms[0]].map((c) => c.t);
  const bases = Object.fromEntries(syms.map((s) => [s, base(data[s])]));
  const combos = gridCombos(strategy);
  const inds = combos.map((p) => prepareAll(strategy, data, p, bases));

  const windows = [];
  let trainStart = times[0] + W.warmupDays * 864e5;
  while (true) {
    const trainEnd = addMonths(trainStart, W.trainMonths), testEnd = addMonths(trainEnd, W.testMonths);
    const a = idxAt(times, trainStart), b = idxAt(times, trainEnd), c = Math.min(idxAt(times, testEnd), times.length);
    if (b >= times.length - 288) break; // al menos un día para probar
    windows.push({ a, b, c });
    trainStart = addMonths(trainStart, W.testMonths);
  }

  const oos = new FuturesPortfolio({ data, funding, strategy, params: combos[0], cfg, ind: inds[0] });
  const rows = [];
  for (const w of windows) {
    let best = null;
    combos.forEach((p, k) => {
      const pf = runBacktest({ data, funding, strategy, params: p, cfg, from: w.a, to: w.b, ind: inds[k] });
      if (pf.trades.length < W.minTrades) return;
      const m = metrics(pf.equityCurve, pf.trades, cfg.initialCapital);
      if (!best || m.sharpe > best.m.sharpe) best = { p, k, m };
    });
    const trade = best && best.m.sharpe > W.minTrainSharpe;
    if (trade) { oos.p = best.p; oos.ind = inds[best.k]; }
    oos.allowEntries = !!trade;
    const eq0 = oos.s.lastEquity, tr0 = oos.trades.length;
    for (let i = w.b; i < w.c; i++) oos.step(i);
    const row = {
      testFrom: times[w.b], testTo: times[w.c - 1], params: trade ? best.p : null,
      trainSharpe: best?.m.sharpe ?? null, testReturn: oos.s.lastEquity / eq0 - 1,
      testTrades: oos.trades.length - tr0, halted: !!oos.s.halted,
    };
    rows.push(row);
    onWindow?.(row);
  }
  oos.liquidateAll(windows.at(-1).c - 1);
  return { pf: oos, rows, from: windows[0].b, to: windows.at(-1).c };
}
