import cfg from '../config.js';
import { loadAll } from '../src/data.js';

const t0 = Date.now();
const { data, funding } = await loadAll(cfg);
for (const [s, cs] of Object.entries(data)) {
  console.log(`${s}: ${cs.length} velas 5m, ${new Date(cs[0].t).toISOString().slice(0, 10)} → ${new Date(cs.at(-1).t).toISOString().slice(0, 16)}, ${funding[s].size} tasas de financiamiento`);
}
console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
