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
