// La prueba que importa: parámetros elegidos solo con el pasado, operados en meses que no vio.
import fs from 'node:fs';
import path from 'node:path';
import cfg from '../config.js';
import { loadAll } from '../src/data.js';
import { strategies } from '../src/strategies.js';
import { walkForward } from '../src/walkforward.js';
import { metrics, buyAndHold, fmt, bySymbol } from '../src/metrics.js';
import { writeReport, writeTradesCsv } from '../src/report.js';

const name = process.argv[2] ?? cfg.strategy;
const strategy = strategies[name];
if (!strategy) throw new Error(`Estrategia desconocida: ${name}`);

const { data, funding } = await loadAll(cfg);
const t0 = Date.now();
const d = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`\nWalk-forward "${name}"`);
const { pf, rows, from, to } = walkForward({
  data, funding, strategy, cfg,
  onWindow: (r) => console.log(`${d(r.testFrom)} → ${d(r.testTo)}  ${(r.testReturn * 100).toFixed(1).padStart(7)} %  ops ${String(r.testTrades).padStart(4)}  ${r.params ? 'opera' : 'NO opera'}${r.halted ? '  [DETENIDO]' : ''}`),
});
const m = metrics(pf.equityCurve, pf.trades, cfg.initialCapital);
const bhCurve = buyAndHold(data, cfg, from, to);
const bh = metrics(bhCurve, [], cfg.initialCapital);

console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.table(Object.fromEntries(Object.entries(fmt(m)).map(([k, v]) => [k, { Bot: v, 'Comprar y mantener 1x': fmt(bh)[k] }])));
console.table(bySymbol(pf.trades));
if (pf.s.halted) console.log(`⚠ Interruptor activado ${new Date(pf.s.halted.t).toISOString().slice(0, 16)}`);
console.log(`Comisiones ${pf.s.fees.toFixed(2)} USDT · financiamiento ${pf.s.funding.toFixed(2)} USDT`);

const root = path.resolve(import.meta.dirname, '..', 'reports');
writeTradesCsv(path.join(root, `walkforward_${name}_trades.csv`), pf.trades);
writeReport(path.join(root, `walkforward_${name}.html`), {
  title: `Walk-forward: ${name}`,
  subtitle: `${cfg.symbols.length} perpetuos de Bybit · entrena ${cfg.walkforward.trainMonths} meses, opera ${cfg.walkforward.testMonths} · solo fuera de muestra`,
  strat: fmt(m), bench: fmt(bh), curve: pf.equityCurve, benchCurve: bhCurve, rows, trades: pf.trades, events: pf.events,
  sections: [{ title: 'Resultado por par', head: ['Par', 'Ops', 'Acierto', 'USDT'], rows: bySymbol(pf.trades) }],
});
const stateDir = path.resolve(import.meta.dirname, '..', 'state');
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(stateDir, `params_${name}.json`), JSON.stringify(rows.at(-1).params, null, 2));
console.log(`Reporte: reports/walkforward_${name}.html`);
