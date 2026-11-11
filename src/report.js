import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const day = (t) => new Date(t).toISOString().slice(0, 10);
const hm = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

export function chart(series, { log = false, h = 260, pctAxis = false } = {}) {
  const W = 900, P = { l: 56, r: 12, t: 12, b: 24 };
  const all = series.flatMap((s) => s.points);
  const tx = all.map((p) => p.t), ys = all.map((p) => p.v);
  const f = (v) => (log ? Math.log(v) : v);
  const mn = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity), mx = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
  const t0 = mn(tx), t1 = mx(tx);
  const y0 = f(mn(ys)), y1 = f(mx(ys)) || 1;
  const X = (t) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (f(v) - y0) / (y1 - y0 || 1)) * (h - P.t - P.b);
  const paths = series.map((s) => {
    const step = Math.max(1, Math.floor(s.points.length / 900));
    const pts = s.points.filter((_, i) => i % step === 0);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`;
  });
  const ticks = [];
  for (let k = 0; k <= 4; k++) {
    const yv = y0 + ((y1 - y0) * k) / 4, v = log ? Math.exp(yv) : yv;
    const yy = Y(v);
    ticks.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${yy}" y2="${yy}" class="grid"/>
      <text x="${P.l - 6}" y="${yy + 4}" text-anchor="end">${pctAxis ? (v * 100).toFixed(0) + '%' : v.toFixed(0)}</text>`);
  }
  for (let k = 0; k <= 4; k++) {
    const t = t0 + ((t1 - t0) * k) / 4;
    ticks.push(`<text x="${X(t)}" y="${h - 6}" text-anchor="middle">${day(t)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${h}" role="img">${ticks.join('')}${paths.join('')}</svg>`;
}

const simpleTable = ({ title, head, rows }) => `<h2>${esc(title)}</h2><div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
  ${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function writeReport(file, { title, subtitle, strat, bench, curve, benchCurve, rows, trades, events, sections = [] }) {
  const keys = Object.keys(strat);
  const table = `<table><thead><tr><th></th><th>Bot</th><th>Comprar y mantener</th></tr></thead><tbody>
    ${keys.map((k) => `<tr><td>${k}</td><td>${strat[k]}</td><td>${bench[k] ?? ''}</td></tr>`).join('')}</tbody></table>`;
  const wf = rows?.length
    ? `<h2>Ventanas fuera de muestra</h2><div class="scroll"><table><thead><tr><th>Período</th><th>Sharpe entrenamiento</th><th>Parámetros elegidos</th><th>Retorno</th><th>Ops</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${day(r.testFrom)} → ${day(r.testTo)}</td><td>${r.trainSharpe?.toFixed(2) ?? '—'}</td>
        <td><code>${r.params ? esc(Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' ')) : 'no opera'}</code></td>
        <td class="${r.testReturn >= 0 ? 'pos' : 'neg'}">${(r.testReturn * 100).toFixed(1)} %</td><td>${r.testTrades}</td></tr>`).join('')}
      </tbody></table></div>` : '';
  const ev = events?.filter((e) => e.type === 'INTERRUPTOR').map((e) => `<p class="warn">Interruptor activado el ${hm(e.t)} (caída ${(e.dd * 100).toFixed(1)} % desde el máximo). El bot dejó de operar.</p>`).join('') ?? '';
  const last = trades.slice(-40).reverse();
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--mut:#6b6b66;--line:#e2e1dc;--bot:#2563eb;--bh:#a3a39c;--pos:#15803d;--neg:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--mut:#9a9992;--line:#2c2c29;--bot:#60a5fa;--bh:#6b6b66;--pos:#4ade80;--neg:#f87171}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px}
main{max-width:960px;margin:auto}h1{font-size:22px;margin:0}h2{font-size:17px;margin:28px 0 8px}.sub{color:var(--mut)}
svg{width:100%;height:auto}svg text{fill:var(--mut);font-size:11px}.grid{stroke:var(--line)}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left}
.scroll{overflow-x:auto}.pos{color:var(--pos)}.neg{color:var(--neg)}.warn{color:var(--neg);font-weight:600}
.leg span{display:inline-block;width:12px;height:3px;margin:0 6px 3px 12px;vertical-align:middle}code{font-size:12px}
</style></head><body><main>
<h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>${ev}
<h2>Patrimonio (escala logarítmica)</h2><div class="leg"><span style="background:var(--bot)"></span>Bot<span style="background:var(--bh)"></span>Comprar y mantener</div>
${chart([{ points: benchCurve.map((p) => ({ t: p.t, v: p.equity })), color: 'var(--bh)' }, { points: curve.map((p) => ({ t: p.t, v: p.equity })), color: 'var(--bot)' }], { log: true })}
<h2>Drawdown del bot</h2>${chart([{ points: curve.map((p) => ({ t: p.t, v: -p.dd })), color: 'var(--neg)' }], { h: 160, pctAxis: true })}
<h2>Métricas</h2>${table}${wf}${sections.map(simpleTable).join('')}
<h2>Últimas 40 operaciones</h2><div class="scroll"><table><thead><tr><th>Par</th><th>Lado</th><th>Apal.</th><th>Entrada</th><th>Salida</th><th>USDT</th><th>R</th><th>Motivo</th></tr></thead><tbody>
${last.map((t) => `<tr><td>${t.sym}</td><td>${t.side === 1 ? 'largo' : 'corto'}</td><td>${t.lev}x</td><td>${hm(t.entryT)}</td><td>${hm(t.exitT)}</td><td class="${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl.toFixed(2)}</td><td>${t.r.toFixed(2)}</td><td>${t.reason}</td></tr>`).join('')}
</tbody></table></div></main></body></html>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

export function writeTradesCsv(file, trades) {
  const head = 'par,lado,apalancamiento,entrada,salida,precio_entrada,precio_salida,cantidad,pnl_usdt,r,velas_5m,motivo';
  const lines = trades.map((t) => [t.sym, t.side === 1 ? 'largo' : 'corto', t.lev, new Date(t.entryT).toISOString(), new Date(t.exitT).toISOString(),
    t.entry.toPrecision(6), t.exit.toPrecision(6), t.qty.toPrecision(6), t.pnl.toFixed(2), t.r.toFixed(2), t.bars, t.reason].join(','));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [head, ...lines].join('\n'));
}
