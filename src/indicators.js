// Todos los indicadores son causales: el valor en i usa solo datos <= i.

export function ema(x, n) {
  const out = new Array(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev;
  for (let i = n - 1; i < x.length; i++) {
    if (i === n - 1) {
      let s = 0;
      for (let j = 0; j < n; j++) s += x[j];
      prev = s / n;
    } else prev = x[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function wilder(x, n, start) {
  const out = new Array(x.length).fill(NaN);
  if (x.length < start + n) return out;
  let s = 0;
  for (let j = start; j < start + n; j++) s += x[j];
  let prev = s / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < x.length; i++) {
    prev = (prev * (n - 1) + x[i]) / n;
    out[i] = prev;
  }
  return out;
}

export function atr(h, l, c, n) {
  const tr = h.map((_, i) =>
    i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])),
  );
  return wilder(tr, n, 0);
}

export function rsi(c, n) {
  const up = [0], dn = [0];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    up.push(Math.max(d, 0));
    dn.push(Math.max(-d, 0));
  }
  const au = wilder(up, n, 1), ad = wilder(dn, n, 1);
  return au.map((u, i) => (Number.isNaN(u) ? NaN : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])));
}

// Máximo/mínimo móvil (ventana que incluye i), con deque monótono.
function rolling(x, n, better) {
  const out = new Array(x.length).fill(NaN);
  const dq = [];
  for (let i = 0; i < x.length; i++) {
    while (dq.length && !better(x[dq[dq.length - 1]], x[i])) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = x[dq[0]];
  }
  return out;
}
export const rollingMax = (x, n) => rolling(x, n, (a, b) => a > b);
export const rollingMin = (x, n) => rolling(x, n, (a, b) => a < b);

// ADX de Wilder: fuerza de la tendencia (no dirección). +DI > -DI indica presión alcista.
export function adx(h, l, c, n = 14) {
  const len = h.length, pdm = [0], ndm = [0], tr = [h[0] - l[0]];
  for (let i = 1; i < len; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const sm = (x) => wilder(x, n, 1);
  const atrN = sm(tr), p = sm(pdm), m = sm(ndm);
  const pdi = p.map((v, i) => (100 * v) / atrN[i]), ndi = m.map((v, i) => (100 * v) / atrN[i]);
  const dx = pdi.map((v, i) => (Number.isNaN(v) ? NaN : (100 * Math.abs(v - ndi[i])) / Math.max(v + ndi[i], 1e-12)));
  const first = dx.findIndex((v) => !Number.isNaN(v));
  const a = first < 0 ? dx.map(() => NaN) : wilder(dx.map((v) => (Number.isNaN(v) ? 0 : v)), n, first);
  return { adx: a, pdi, ndi };
}

// Estructura con swings de 2k+1 velas: +1 si los dos últimos máximos Y mínimos confirmados son crecientes,
// -1 si ambos decrecientes, 0 si no es obvio. Un swing en j se confirma recién al cierre de j+k.
export function structure(h, l, k = 2) {
  const out = new Int8Array(h.length);
  const hs = [], ls = [];
  for (let i = 0; i < h.length; i++) {
    const j = i - k;
    if (j >= k) {
      let isH = true, isL = true;
      for (let d = 1; d <= k; d++) {
        if (!(h[j] > h[j - d] && h[j] >= h[j + d])) isH = false;
        if (!(l[j] < l[j - d] && l[j] <= l[j + d])) isL = false;
      }
      if (isH) hs.push(h[j]);
      if (isL) ls.push(l[j]);
    }
    if (hs.length >= 2 && ls.length >= 2) {
      const [h1, h2] = hs.slice(-2), [l1, l2] = ls.slice(-2);
      out[i] = h2 > h1 && l2 > l1 ? 1 : h2 < h1 && l2 < l1 ? -1 : 0;
    }
  }
  return out;
}
