import { ema, atr, rollingMax, rollingMin, adx, structure } from './indicators.js';
import { smc } from './smc.js';
import { resample } from './tf.js';

const col = (bars, k) => bars.map((b) => b[k]);

// Indicadores que no dependen de parámetros: se calculan una vez por par.
export function base(c5) {
  const d1 = resample(c5, '1d'), h4 = resample(c5, '4h'), h1 = resample(c5, '1h'), m15 = resample(c5, '15m');
  const cd = col(d1.bars, 'c'), c4 = col(h4.bars, 'c'), c1 = col(h1.bars, 'c'), c15 = col(m15.bars, 'c');
  const h1h = col(h1.bars, 'h'), h1l = col(h1.bars, 'l'), h4h = col(h4.bars, 'h'), h4l = col(h4.bars, 'l');
  const m15h = col(m15.bars, 'h'), m15l = col(m15.bars, 'l');
  const a4 = adx(h4h, h4l, c4, 14);
  return {
    t: col(c5, 't'), o5: col(c5, 'o'), c5: col(c5, 'c'), h5: col(c5, 'h'), l5: col(c5, 'l'),
    d: { i: d1.idx, c: cd, e: ema(cd, 20) },
    h4: { i: h4.idx, o: col(h4.bars, 'o'), c: c4, h: h4h, l: h4l, f: ema(c4, 21), s: ema(c4, 55), a: atr(h4h, h4l, c4, 14), adx: a4.adx, pdi: a4.pdi, ndi: a4.ndi, st: structure(h4h, h4l) },
    h1: { i: h1.idx, o: col(h1.bars, 'o'), c: c1, h: h1h, l: h1l, e: ema(c1, 21), e55: ema(c1, 55), a: atr(h1h, h1l, c1, 14), st: structure(h1h, h1l) },
    m15: { i: m15.idx, o: col(m15.bars, 'o'), c: c15, h: m15h, l: m15l, e: ema(c15, 9), a: atr(m15h, m15l, c15, 14) },
  };
}

// Puntaje de tendencia 0-1 para la dirección dir: cuántas razones independientes coinciden.
// Diario sobre EMA20, EMAs de 4h y de 1h ordenadas, estructura (máximos y mínimos) en 4h y en 1h,
// y ADX de 4h > 20 con el +DI/-DI a favor. Cada una suma 1/6.
export function trendScore(x, i, dir) {
  const jd = x.d.i[i], j4 = x.h4.i[i], j1 = x.h1.i[i];
  if (jd < 0 || j4 < 0 || j1 < 0) return 0;
  let n = 0;
  if (dir * (x.d.c[jd] - x.d.e[jd]) > 0) n++;
  if (dir * (x.h4.f[j4] - x.h4.s[j4]) > 0) n++;
  if (dir * (x.h1.e[j1] - x.h1.e55[j1]) > 0) n++;
  if (x.h4.st[j4] === dir) n++;
  if (x.h1.st[j1] === dir) n++;
  if (x.h4.adx[j4] > 20 && dir * (x.h4.pdi[j4] - x.h4.ndi[j4]) > 0) n++;
  return n / 6;
}
const withScore = (x, i, sig) => (sig ? { ...sig, score: trendScore(x, i, sig.side) } : sig);

// Dirección permitida: +1 solo largos, -1 solo cortos, 0 no opera.
// 4h: EMA21 vs EMA55 y precio del lado correcto. Diario (opcional): precio vs EMA20.
function bias(x, i, p) {
  const j = x.h4.i[i];
  if (j < 0) return 0;
  const f = x.h4.f[j], s = x.h4.s[j], c = x.h4.c[j];
  const dir = f > s && c > s ? 1 : f < s && c < s ? -1 : 0;
  if (!dir || !p.useDaily) return dir;
  const jd = x.d.i[i];
  if (jd < 0) return 0;
  return (dir === 1 ? x.d.c[jd] > x.d.e[jd] : x.d.c[jd] < x.d.e[jd]) ? dir : 0;
}

function commonManage(x, i, p, pos) {
  if (pos.barsHeld >= p.maxBars) return { exit: 'tiempo' };
  if (bias(x, i, p) === -pos.side) return { exit: 'tendencia giró' };
  return null;
}

export const strategies = {
  // Retroceso en tendencia: 4h (y diario) marcan la dirección, en 1h el precio vuelve a la EMA21
  // y la recupera, en 15m el impulso acompaña, y en 5m se entra al romper el máximo/mínimo reciente.
  mtfPullback: {
    defaults: { trigN: 12, pbBars: 6, pbTol: 0.002, stopAtr: 2, tpR: 2, useDaily: true, beAt: 1, maxBars: 288 },
    grid: { trigN: [6, 12], stopAtr: [1.5, 2.5], tpR: [1.5, 2.5], useDaily: [true, false], beAt: [0, 1] },
    prepare(b, p) {
      return { ...b, hiN: rollingMax(b.h5, p.trigN), loN: rollingMin(b.l5, p.trigN), pbLo: rollingMin(b.h1.l, p.pbBars), pbHi: rollingMax(b.h1.h, p.pbBars) };
    },
    entry(x, i, p) {
      const dir = bias(x, i, p);
      if (!dir) return null;
      const j1 = x.h1.i[i], j15 = x.m15.i[i];
      if (j1 < 1 || j15 < 1) return null;
      const e1 = x.h1.e[j1], c1 = x.h1.c[j1], c = x.c5[i], a = x.m15.a[j15];
      if (dir === 1) {
        if (!(x.pbLo[j1] <= e1 * (1 + p.pbTol) && c1 > e1)) return null;
        if (!(x.m15.c[j15] > x.m15.e[j15] && c > x.hiN[i - 1])) return null;
        return { side: 1, stop: c - p.stopAtr * a, tpR: p.tpR };
      }
      if (!(x.pbHi[j1] >= e1 * (1 - p.pbTol) && c1 < e1)) return null;
      if (!(x.m15.c[j15] < x.m15.e[j15] && c < x.loN[i - 1])) return null;
      return { side: -1, stop: c + p.stopAtr * a, tpR: p.tpR };
    },
    manage(x, i, p, pos) {
      const m = commonManage(x, i, p, pos);
      if (m) return m;
      if (p.beAt > 0 && (pos.side * (x.c5[i] - pos.entry)) / pos.R >= p.beAt) {
        return { stop: pos.entry * (1 + pos.side * 0.0015) }; // break-even cubriendo comisiones
      }
      return null;
    },
  },

  // Ruptura: con la tendencia de 4h a favor, entra cuando el precio de 5m cruza el máximo
  // (o mínimo) de las últimas N velas de 1h. Stop por ATR de 1h, objetivo en R y stop que acompaña.
  mtfBreakout: {
    defaults: { dcN: 24, stopAtr: 1.5, tpR: 3, useDaily: true, trail: true, maxBars: 288 },
    grid: { dcN: [12, 24], stopAtr: [1, 1.5], tpR: [2, 3], useDaily: [true, false], trail: [true, false] },
    prepare(b, p) {
      return { ...b, dcH: rollingMax(b.h1.h, p.dcN), dcL: rollingMin(b.h1.l, p.dcN) };
    },
    entry(x, i, p) { return withScore(x, i, this.raw(x, i, p)); },
    raw(x, i, p) {
      const dir = bias(x, i, p);
      const j1 = x.h1.i[i];
      if (!dir || j1 < 1) return null;
      const c = x.c5[i], prev = x.c5[i - 1], a = x.h1.a[j1];
      if (dir === 1 && c > x.dcH[j1] && prev <= x.dcH[j1]) return { side: 1, stop: c - p.stopAtr * a, tpR: p.tpR };
      if (dir === -1 && c < x.dcL[j1] && prev >= x.dcL[j1]) return { side: -1, stop: c + p.stopAtr * a, tpR: p.tpR };
      return null;
    },
    manage(x, i, p, pos) {
      const m = commonManage(x, i, p, pos);
      if (m) return m;
      if (p.trail && (pos.side * (x.c5[i] - pos.entry)) / pos.R >= 1) {
        const a = x.h1.a[x.h1.i[i]];
        return { stop: x.c5[i] - pos.side * p.stopAtr * a };
      }
      return null;
    },
  },

  // Estrategia del video (TraderMaine / ICT simplificado). Ver src/smc.js.
  smc,
};

export const withDefaults = (s, params) => ({ ...s.defaults, ...(params ?? {}) });

export function gridCombos(s) {
  let combos = [{}];
  for (const [k, vals] of Object.entries(s.grid)) combos = combos.flatMap((c) => vals.map((v) => ({ ...c, [k]: v })));
  return combos.map((c) => withDefaults(s, c));
}

export function prepareAll(strategy, data, params, bases) {
  return Object.fromEntries(Object.keys(data).map((s) => [s, strategy.prepare(bases?.[s] ?? base(data[s]), params)]));
}
