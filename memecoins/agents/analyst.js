// ANALYST: puntúa de 0 a 1 cada token que pasó TODOS los filtros. Por debajo de 0,6 no se opera.
// Puntaje transparente: cada componente queda registrado.
import { clamp } from '../lib/http.js';

export function analyze(pair, sec) {
  const tx = pair.txns?.h1 ?? { buys: 0, sells: 0 };
  const bp = tx.buys + tx.sells ? tx.buys / (tx.buys + tx.sells) : 0;
  const m5 = pair.priceChange?.m5 ?? 0, h1 = pair.priceChange?.h1 ?? 0;
  const vol = pair.volume?.h1 ?? 0, liq = pair.liquidity?.usd ?? 0;
  const ageMin = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 6e4 : 0;

  const parts = {
    presionCompradora: clamp((bp - 0.45) / 0.25),                          // 45 % compras = 0, 70 % = 1
    impulso5m: m5 <= 0 ? 0 : m5 <= 12 ? m5 / 12 : clamp(1 - (m5 - 12) / 30), // sube, pero sin perseguir velas verticales
    tendencia1h: h1 < 0 ? 0 : h1 <= 150 ? 1 : clamp(1 - (h1 - 150) / 300),
    actividad: clamp((vol / Math.max(liq, 1) - 0.5) / 2.5),                // volumen/liquidez
    liquidez: clamp((liq - 20_000) / 80_000),
    holders: clamp(((sec.holders ?? 0) - 200) / 1800),
    edad: ageMin < 10 ? 0.3 : ageMin <= 360 ? 1 : 0.6,
  };
  const w = { presionCompradora: 0.2, impulso5m: 0.15, tendencia1h: 0.1, actividad: 0.15, liquidez: 0.15, holders: 0.15, edad: 0.1 };
  const score = Object.entries(w).reduce((a, [k, v]) => a + v * parts[k], 0);
  return { score: +score.toFixed(3), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(2)])) };
}
