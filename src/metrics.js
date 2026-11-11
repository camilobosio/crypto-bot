import { TF_MS } from './data.js';

export function metrics(curve, trades, initial) {
  const bpy = (365 * 864e5) / TF_MS['5m'];
  const eq = [initial, ...curve.map((p) => p.equity)];
  let sum = 0, sum2 = 0, down2 = 0;
  for (let i = 1; i < eq.length; i++) {
    const r = eq[i] / eq[i - 1] - 1;
    sum += r; sum2 += r * r; down2 += Math.min(r, 0) ** 2;
  }
  const n = Math.max(eq.length - 1, 1), mean = sum / n;
  const std = Math.sqrt(Math.max(sum2 / n - mean * mean, 0)), dstd = Math.sqrt(down2 / n);
  const days = Math.max((curve.at(-1).t - curve[0].t) / 864e5, 1e-9);
  const final = eq.at(-1);
  let peak = eq[0], maxDD = 0;
  for (const e of eq) { if (e > peak) peak = e; const d = 1 - e / peak; if (d > maxDD) maxDD = d; }

  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const monthly = final > 0 ? (final / initial) ** (30 / days) - 1 : -1;
  return {
    final, totalReturn: final / initial - 1, monthly, maxDD,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(bpy) : 0,
    sortino: dstd > 0 ? (mean / dstd) * Math.sqrt(bpy) : 0,
    trades: trades.length,
    perDay: trades.length / days,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
    avgLev: trades.length ? trades.reduce((a, t) => a + t.lev, 0) / trades.length : 0,
    liquidations: trades.filter((t) => t.reason === 'LIQUIDACIÓN').length,
    longs: trades.filter((t) => t.side === 1).length,
    exposure: curve.filter((p) => p.exposed).length / curve.length,
    days,
  };
}

// Referencia: comprar y mantener la canasta (1x, sin apalancamiento).
export function buyAndHold(data, cfg, from, to) {
  const syms = Object.keys(data);
  const per = (cfg.initialCapital / syms.length) * (1 - cfg.costs.takerFee - cfg.costs.slippagePct);
  const curve = [];
  for (let i = from; i < to; i++) {
    let e = 0;
    for (const s of syms) e += (per * data[s][i].c) / data[s][from].o;
    curve.push({ t: data[syms[0]][i].t, equity: e, exposed: true });
  }
  return curve;
}

const pct = (x) => (x * 100).toFixed(1) + ' %';
export function fmt(m) {
  return {
    'Capital final (USDT)': m.final.toFixed(2),
    'Retorno total': pct(m.totalReturn),
    'Retorno mensual promedio': pct(m.monthly),
    'Caída máxima': pct(m.maxDD),
    Sharpe: m.sharpe.toFixed(2),
    Operaciones: m.trades,
    'Operaciones por día': m.perDay.toFixed(1),
    'Tasa de acierto': pct(m.winRate),
    'Profit factor': Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞',
    'Resultado medio (R)': m.avgR.toFixed(2),
    'Apalancamiento medio': m.avgLev ? m.avgLev.toFixed(1) + 'x' : '—',
    Liquidaciones: m.liquidations,
    'Largos / cortos': m.trades ? `${m.longs} / ${m.trades - m.longs}` : '—',
  };
}

export function bySymbol(trades) {
  const out = {};
  for (const t of trades) {
    const o = (out[t.sym] ??= { ops: 0, wins: 0, pnl: 0 });
    o.ops++; o.pnl += t.pnl; if (t.pnl > 0) o.wins++;
  }
  return Object.entries(out).sort((a, b) => b[1].pnl - a[1].pnl)
    .map(([s, o]) => [s, o.ops, ((o.wins / o.ops) * 100).toFixed(0) + ' %', o.pnl.toFixed(2)]);
}
