// Backtest con parámetros fijos sobre todo el histórico.
// Sirve para entender la estrategia; NO estima ganancias futuras. Para eso: walkforward.
import path from 'node:path';
import cfg from '../config.js';
import { loadAll } from '../src/data.js';
import { strategies, withDefaults, prepareAll } from '../src/strategies.js';
import { runBacktest } from '../src/engine.js';
import { metrics, buyAndHold, fmt, bySymbol } from '../src/metrics.js';
import { writeReport, writeTradesCsv } from '../src/report.js';

const name = process.argv[2] ?? cfg.strategy;
const strategy = strategies[name];
if (!strategy) throw new Error(`Estrategia desconocida: ${name}`);
const params = withDefaults(strategy);
// --sin-interruptor: para medir la ventaja cruda de la estrategia en todo el año
if (process.argv.includes('--sin-interruptor')) cfg.risk.maxDrawdownPct = 1.01;

const { data, funding } = await loadAll(cfg);
const n = data[cfg.symbols[0]].length, from = cfg.walkforward.warmupDays * 288;
const pf = runBacktest({ data, funding, strategy, params, cfg, from, to: n, ind: prepareAll(strategy, data, params) });
const m = metrics(pf.equityCurve, pf.trades, cfg.initialCapital);
const bhCurve = buyAndHold(data, cfg, from, n);
const bh = metrics(bhCurve, [], cfg.initialCapital);

console.log(`\nBacktest "${name}" ${JSON.stringify(params)}`);
console.table(Object.fromEntries(Object.entries(fmt(m)).map(([k, v]) => [k, { Bot: v, 'Comprar y mantener 1x': fmt(bh)[k] }])));
console.table(bySymbol(pf.trades));
if (pf.s.halted) console.log(`⚠ Interruptor activado ${new Date(pf.s.halted.t).toISOString().slice(0, 16)}`);
console.log(`Comisiones ${pf.s.fees.toFixed(2)} USDT · financiamiento ${pf.s.funding.toFixed(2)} USDT`);

const root = path.resolve(import.meta.dirname, '..', 'reports');
writeTradesCsv(path.join(root, `backtest_${name}_trades.csv`), pf.trades);
writeReport(path.join(root, `backtest_${name}.html`), {
  title: `Backtest: ${name}`,
  subtitle: `${cfg.symbols.length} perpetuos de Bybit · 5m · riesgo ${cfg.risk.riskPerTradePct * 100} % por operación · parámetros fijos (optimista)`,
  strat: fmt(m), bench: fmt(bh), curve: pf.equityCurve, benchCurve: bhCurve, trades: pf.trades, events: pf.events,
  sections: [{ title: 'Resultado por par', head: ['Par', 'Ops', 'Acierto', 'USDT'], rows: bySymbol(pf.trades) }],
});
console.log(`Reporte: reports/backtest_${name}.html`);
