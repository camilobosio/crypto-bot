import { TF_MS } from './data.js';

// Arma velas de 15m / 1h / 4h / 1d a partir de las de 5m.
// idx[i] = última vela mayor YA CERRADA al cierre de la vela de 5m i.
// Así la estrategia nunca ve una vela de 1h o 4h que todavía no terminó.
export function resample(c5, tf) {
  const ms = TF_MS[tf], base = TF_MS['5m'];
  const bars = [], avail = [];
  let cur = null;
  const complete = (b) => c5[b.last].t + base === b.t + ms;
  for (let i = 0; i < c5.length; i++) {
    const c = c5[i], b = Math.floor(c.t / ms) * ms;
    if (!cur || cur.t !== b) {
      if (cur) { bars.push(cur); avail.push(complete(cur) ? cur.last : cur.last + 1); }
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, last: i };
    } else {
      if (c.h > cur.h) cur.h = c.h;
      if (c.l < cur.l) cur.l = c.l;
      cur.c = c.c; cur.v += c.v; cur.last = i;
    }
  }
  if (cur && complete(cur)) { bars.push(cur); avail.push(cur.last); }
  const idx = new Int32Array(c5.length);
  let j = -1;
  for (let i = 0; i < c5.length; i++) {
    while (j + 1 < bars.length && avail[j + 1] <= i) j++;
    idx[i] = j;
  }
  return { bars, idx };
}
