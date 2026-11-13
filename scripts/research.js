// Estudio de varios años: compara variantes de entrada, tamaño y estrategia.
// Corre en GitHub Actions (workflow research.yml) con velas de 5m del espejo público de Binance.
//   node scripts/research.js            -> todo el estudio, deja results/RESUMEN.md
// Lo que cuenta es el WALK-FORWARD: parámetros elegidos solo con meses pasados y operados en meses que no vio.
import fs from 'node:fs';
import path from 'node:path';
import cfg0 from '../config.js';
import { loadAll } from '../src/data.js';
import { strategies, withDefaults, prepareAll } from '../src/strategies.js';
import { runBacktest } from '../src/engine.js';
import { walkForward } from '../src/walkforward.js';
import { metrics, buyAndHold, fmt, bySymbol } from '../src/metrics.js';

const OUT = path.resolve(import.meta.dirname, '..', 'results');
fs.mkdirSync(OUT, { recursive: true });
const YEARS = +(process.env.YEARS ?? 4);
const base = structuredClone(cfg0);
base.symbols = base.symbols.filter((s) => s !== 'SUIUSDT'); // SUI existe recién desde 2023: acortaría todo
base.historyDays = Math.round(YEARS * 365);

const t0 = Date.now();
// SYNTH=1: datos sintéticos, solo para probar que el script corre.
const synth = () => {
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mk = (p0) => { const out = []; let p = p0, dr = 0; for (let i = 0; i < 288 * 200; i++) { if (i % 3000 === 0) dr = (rnd() - 0.5) * 0.0004; const o = p; p *= 1 + dr + (rnd() - 0.5) * 0.004; out.push({ t: Date.UTC(2024, 0, 1) + i * 3e5, o, h: Math.max(o, p) * (1 + rnd() * 0.0015), l: Math.min(o, p) * (1 - rnd() * 0.0015), c: p, v: 1 }); } return out; };
  return { data: { AAA: mk(100), BBB: mk(20), CCC: mk(3) }, funding: {} };
};
const { data, funding } = process.env.SYNTH ? synth() : await loadAll(base);
const syms = Object.keys(data), n = data[syms[0]].length;
const day = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`Datos: ${syms.length} pares, ${n} velas de 5m, ${day(data[syms[0]][0].t)} → ${day(data[syms[0]][n - 1].t)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

const SCORE_RISK = [[0, 0.02], [0.5, 0.04], [0.84, 0.06]]; // dudosa 2 %, normal 4 %, muy clara 6 %
const variants = [
  { key: 'A', name: 'Ruptura · entrada a mercado · 5 % fijo (lo que corre hoy)', strat: 'mtfBreakout', entry: { mode: 'market' } },
  { key: 'B', name: 'Ruptura · orden límite · 5 % fijo', strat: 'mtfBreakout', entry: { mode: 'limit', maxWaitBars: 12, chaseR: 0.5 } },
  { key: 'C', name: 'Ruptura · orden límite · tamaño según puntaje (2/4/6 %)', strat: 'mtfBreakout', entry: { mode: 'limit', maxWaitBars: 12, chaseR: 0.5 }, score: true },
  { key: 'D', name: 'Video (SMC) · orden límite · 5 % fijo', strat: 'smc', entry: { mode: 'limit', maxWaitBars: 12, chaseR: 0.5 }, minStopPct: 0.0025 },
  { key: 'E', name: 'Video (SMC) · orden límite · tamaño según puntaje (2/4/6 %)', strat: 'smc', entry: { mode: 'limit', maxWaitBars: 12, chaseR: 0.5 }, score: true, minStopPct: 0.0025 },
];

const cfgFor = (v, riskPct) => {
  const c = structuredClone(base);
  c.entry = v.entry;
  c.risk.maxSameSide = v.entry.mode === 'limit' ? 2 : undefined; // no apilar 3 apuestas iguales
  if (v.score) { c.risk.riskByScore = SCORE_RISK; c.risk.minScore = 0.34; }
  if (v.minStopPct) c.risk.minStopPct = v.minStopPct;
  if (v.strat === 'smc') c.walkforward.minTrades = 8; // opera menos seguido: con 20 en 3 meses casi nunca calificaría
  if (riskPct) { c.risk.riskPerTradePct = riskPct; if (v.score) c.risk.riskByScore = SCORE_RISK.map(([s, p]) => [s, (p * riskPct) / 0.04]); }
  return c;
};

const pc = (x) => (x * 100).toFixed(1) + ' %';
const scoreBuckets = (trades) => {
  const B = [['< 0,34', 0, 0.34], ['0,34-0,5', 0.34, 0.5], ['0,5-0,84', 0.5, 0.84], ['≥ 0,84', 0.84, 2]];
  return B.map(([lbl, a, b]) => {
    const ts = trades.filter((t) => t.score != null && t.score >= a && t.score < b);
    const w = ts.filter((t) => t.pnl > 0).length;
    return [lbl, ts.length, ts.length ? pc(w / ts.length) : '—', ts.length ? (ts.reduce((s, t) => s + t.r, 0) / ts.length).toFixed(2) : '—'];
  });
};

// El motor guarda el puntaje de cada operación en la posición; lo copiamos a la operación cerrada.
import { FuturesPortfolio } from '../src/engine.js';
const origClose = FuturesPortfolio.prototype.close;
FuturesPortfolio.prototype.close = function (sym, ...rest) {
  const sc = this.s.positions[sym]?.score ?? null, mk = this.s.positions[sym]?.maker ?? false;
  origClose.call(this, sym, ...rest);
  const t = this.trades.at(-1); t.score = sc; t.maker = mk;
};

const results = [];
const md = [];
const from = base.walkforward.warmupDays * 288;
const bh = metrics(buyAndHold(data, base, from, n), [], base.initialCapital);

for (const v of variants) {
  const S = strategies[v.strat];
  const c = cfgFor(v);
  // 1) Ventaja cruda: parámetros por defecto, todo el período, sin interruptor (mide si la idea gana algo).
  const raw = structuredClone(c); raw.risk.maxDrawdownPct = 1.01;
  const p = withDefaults(S);
  const t1 = Date.now();
  const bt = runBacktest({ data, funding, strategy: S, params: p, cfg: raw, from, to: n, ind: prepareAll(S, data, p) });
  const mb = metrics(bt.equityCurve, bt.trades, base.initialCapital);
  // 2) Walk-forward real con interruptor del 40 %.
  const wf = walkForward({ data, funding, strategy: S, cfg: c });
  const mw = metrics(wf.pf.equityCurve, wf.pf.trades, base.initialCapital);
  const secs = ((Date.now() - t1) / 1000).toFixed(0);
  console.log(`[${v.key}] ${v.name}: backtest avgR ${mb.avgR.toFixed(3)} (${mb.trades} ops) · walk-forward ${pc(mw.totalReturn)} DD ${pc(mw.maxDD)} ${wf.pf.s.halted ? 'INTERRUPTOR' : ''} (${secs} s)`);
  results.push({ v, mb, mw, wf, bt });
  fs.writeFileSync(path.join(OUT, `wf_${v.key}_meses.json`), JSON.stringify(wf.rows, null, 1));
  fs.writeFileSync(path.join(OUT, `wf_${v.key}_ops.csv`), 'par,lado,entrada,salida,pnl,r,puntaje,motivo\n' +
    wf.pf.trades.map((t) => [t.sym, t.side, day(t.entryT), day(t.exitT), t.pnl.toFixed(3), t.r.toFixed(3), t.score ?? '', t.reason].join(',')).join('\n'));
}

// 3) Riesgo: con la mejor variante del walk-forward, cuánto arriesgar por operación.
const best = [...results].sort((a, b) => b.mw.sharpe - a.mw.sharpe)[0];
const riskRows = [];
for (const r of [0.01, 0.02, 0.03, 0.05]) {
  const c = cfgFor(best.v, r);
  const wf = walkForward({ data, funding, strategy: strategies[best.v.strat], cfg: c });
  const m = metrics(wf.pf.equityCurve, wf.pf.trades, base.initialCapital);
  riskRows.push([pc(r), m.final.toFixed(2), pc(m.totalReturn), pc(m.monthly), pc(m.maxDD), wf.pf.s.halted ? `sí (${day(wf.pf.s.halted.t)})` : 'no']);
  console.log(`riesgo ${pc(r)}: ${pc(m.totalReturn)} DD ${pc(m.maxDD)}`);
}

// Resumen
const tbl = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
md.push(`# Estudio de ${YEARS} años: bot de futuros

Generado ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${syms.join(', ')} · velas de 5m (espejo público de Binance) · ${day(data[syms[0]][from].t)} → ${day(data[syms[0]][n - 1].t)}.
Capital inicial ${base.initialCapital} USDT. Comisiones de Bybit (taker 0,055 %, maker 0,02 %), slippage 0,03 % en entradas a mercado y stops, financiamiento estimado 0,01 % cada 8 h.
Órdenes límite: solo se llenan si el precio ATRAVIESA la orden (no alcanza con tocarla).

**Referencia, comprar y mantener la canasta 1x:** ${pc(bh.totalReturn)} · caída máxima ${pc(bh.maxDD)}.

## 1. ¿La idea gana algo? (parámetros fijos, todo el período, sin interruptor)
"Resultado medio (R)" positivo = la estrategia tiene ventaja después de costos.

${tbl(['', 'Variante', 'Ops', 'Acierto', 'Resultado medio (R)', 'Profit factor'], results.map(({ v, mb }) => [v.key, v.name, mb.trades, pc(mb.winRate), mb.avgR.toFixed(3), Number.isFinite(mb.profitFactor) ? mb.profitFactor.toFixed(2) : '∞']))}

## 2. La prueba que cuenta: walk-forward (meses que no vio, con interruptor del 40 %)

${tbl(['', 'Variante', 'Capital final', 'Retorno', 'Mensual', 'Caída máx.', 'Sharpe', 'Ops', 'Acierto', 'R medio', 'Interruptor'], results.map(({ v, mw, wf }) => [v.key, v.name, mw.final.toFixed(2), pc(mw.totalReturn), pc(mw.monthly), pc(mw.maxDD), mw.sharpe.toFixed(2), mw.trades, pc(mw.winRate), mw.avgR.toFixed(2), wf.pf.s.halted ? `sí (${day(wf.pf.s.halted.t)})` : 'no']))}

## 3. ¿El puntaje de tendencia sirve? (operaciones del backtest, por puntaje)
Si el acierto y el R medio suben con el puntaje, tiene sentido arriesgar más cuando el puntaje es alto.

${results.filter((r) => r.v.score).map(({ v, bt }) => `**${v.key}. ${v.name}**\n\n${tbl(['Puntaje', 'Ops', 'Acierto', 'R medio'], scoreBuckets(bt.trades))}`).join('\n\n')}

## 4. Cuánto arriesgar por operación (mejor variante: ${best.v.key})

${tbl(['Riesgo por operación', 'Capital final', 'Retorno', 'Mensual', 'Caída máx.', 'Interruptor'], riskRows)}

## 5. Detalle por par (walk-forward, mejor variante ${best.v.key})

${tbl(['Par', 'Ops', 'Acierto', 'USDT'], bySymbol(best.wf.pf.trades))}

Tiempo total: ${((Date.now() - t0) / 60000).toFixed(0)} min.
`);
fs.writeFileSync(path.join(OUT, 'RESUMEN.md'), md.join('\n'));
console.log(md.join('\n'));
