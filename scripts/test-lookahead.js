// Verifica que no haya mirada al futuro: cortando los datos en la vela k,
// el patrimonio hasta k tiene que ser idéntico al de la corrida completa.
// Cubre también el armado de velas de 15m/1h/4h/1d.
import cfg from '../config.js';
import { loadAll } from '../src/data.js';
import { strategies, withDefaults, prepareAll } from '../src/strategies.js';
import { runBacktest } from '../src/engine.js';

const { data, funding } = await loadAll(cfg);
const n = data[cfg.symbols[0]].length, from = cfg.walkforward.warmupDays * 288;
let ok = true;
for (const [name, strategy] of Object.entries(strategies)) {
  const params = withDefaults(strategy);
  const full = runBacktest({ data, funding, strategy, params, cfg, from, to: n, ind: prepareAll(strategy, data, params), liquidateAtEnd: false });
  for (const k of [from + 20_000, from + 50_000, n - 7]) {
    const cut = Object.fromEntries(Object.entries(data).map(([s, cs]) => [s, cs.slice(0, k)]));
    const part = runBacktest({ data: cut, funding, strategy, params, cfg, from, to: k, ind: prepareAll(strategy, cut, params), liquidateAtEnd: false });
    const a = full.equityCurve[k - from - 1].equity, b = part.equityCurve.at(-1).equity;
    const same = Math.abs(a - b) < 1e-9 && full.trades.filter((t) => t.exitT <= part.s.lastT).length === part.trades.length;
    ok &&= same;
    console.log(`${name} corte ${k}: ${same ? 'OK' : `DIFERENTE ${a} vs ${b}`}`);
  }
}
console.log(ok ? 'Sin mirada al futuro.' : 'FALLA: hay fuga de datos futuros.');
process.exit(ok ? 0 : 1);
