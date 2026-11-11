import { ema, atr, rollingMax, rollingMin } from './indicators.js';
import { resample } from './tf.js';

const col = (bars, k) => bars.map((b) => b[k]);

// Indicadores que no dependen de parámetros: se calculan una vez por par.
export function base(c5) {
  const d1 = resample(c5, '1d'), h4 = resample(c5, '4h'), h1 = resample(c5, '1h'), m15 = resample(c5, '15m');
  const cd = col(d1.bars, 'c'), c4 = col(h4.bars, 'c'), c1 = col(h1.bars, 'c'), c15 = col(m15.bars, 'c');
  const h1h = col(h1.bars, 'h'), h1l = col(h1.bars, 'l');
  return {
    c5: col(c5, 'c'), h5: col(c5, 'h'), l5: col(c5, 'l'),
    d: { i: d1.idx, c: cd, e: ema(cd, 20) },
    h4: { i: h4.idx, c: c4, f: ema(c4, 21), s: ema(c4, 55) },
    h1: { i: h1.idx, c: c1, h: h1h, l: h1l, e: ema(c1, 21), a: atr(h1h, h1l, c1, 14) },
    m15: { i: m15.idx, c: c15, e: ema(c15, 9), a: atr(col(m15.bars, 'h'), col(m15.bars, 'l'), c15, 14) },
  };
}

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
    entry(x, i, p) {
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
