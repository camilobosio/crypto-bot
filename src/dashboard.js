// Panel de seguimiento del paper trading: una sola página HTML, sin dependencias,
// regenerada en cada corrida. GitHub Pages la publica desde docs/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { chart } from './report.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ar = (t) => new Date(t - 3 * 36e5).toISOString().slice(0, 16).replace('T', ' '); // hora Argentina (UTC-3)
const money = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);
const cls = (x) => (x >= 0 ? 'pos' : 'neg');
const px = (x) => (x >= 100 ? x.toFixed(2) : x.toPrecision(5));

export function writeDashboard(file, { cfg, name, params, s, trades, equity, prices, logTail }) {
  const cap = cfg.initialCapital, eq = s.lastEquity, pnl = eq - cap;
  const wins = trades.filter((t) => t.pnl > 0);
  const dd = 1 - eq / s.peak;
  const startT = equity[0]?.t;
  const hours = startT ? (s.lastT - startT) / 36e5 : 0;
  const status = s.halted ? ['DETENIDO por interruptor', 'neg'] : s.blockEntries ? ['Pausado: límite diario', 'warn'] : ['Operando', 'pos'];

  const positions = Object.entries(s.positions).map(([sym, p]) => {
    const last = prices[sym] ?? p.entry;
    const u = p.side * p.qty * (last - p.entry);
    return `<tr><td><b>${sym.replace('USDT', '')}</b></td><td><span class="tag ${p.side === 1 ? 'pos' : 'neg'}">${p.side === 1 ? 'LARGO' : 'CORTO'} ${p.lev}x</span></td>
      <td>${px(p.entry)}</td><td>${px(last)}</td><td>${px(p.stop)}</td><td>${px(p.tp)}</td><td class="mut">${px(p.liq)}</td>
      <td>${p.margin.toFixed(2)}</td><td class="${cls(u)}"><b>${money(u)}</b></td><td class="mut">${ar(p.entryT)}</td></tr>`;
  }).join('');

  const tradeRows = trades.slice().reverse().slice(0, 50).map((t) => `<tr><td><b>${t.sym.replace('USDT', '')}</b></td>
    <td><span class="tag ${t.side === 1 ? 'pos' : 'neg'}">${t.side === 1 ? 'LARGO' : 'CORTO'} ${t.lev}x</span></td>
    <td class="mut">${ar(t.entryT)}</td><td class="mut">${ar(t.exitT)}</td><td>${px(t.entry)}</td><td>${px(t.exit)}</td>
    <td class="${cls(t.pnl)}"><b>${money(t.pnl)}</b></td><td class="${cls(t.r)}">${t.r.toFixed(2)} R</td><td>${esc(t.reason)}</td></tr>`).join('');

  const bySym = {};
  for (const t of trades) { const o = (bySym[t.sym] ??= { n: 0, w: 0, pnl: 0 }); o.n++; o.pnl += t.pnl; if (t.pnl > 0) o.w++; }
  const symRows = Object.entries(bySym).sort((a, b) => b[1].pnl - a[1].pnl).map(([sym, o]) =>
    `<tr><td><b>${sym.replace('USDT', '')}</b></td><td>${o.n}</td><td>${Math.round((o.w / o.n) * 100)} %</td><td class="${cls(o.pnl)}"><b>${money(o.pnl)}</b></td></tr>`).join('');

  const eqChart = equity.length > 1
    ? chart([{ points: equity.map((p) => ({ t: p.t, v: p.e })), color: 'var(--accent)' }], { h: 240 })
    : '<p class="mut">El gráfico aparece después de las primeras velas.</p>';

  const card = (label, value, sub = '', c = '') => `<div class="card"><div class="lbl">${label}</div><div class="val ${c}">${value}</div><div class="sub">${sub}</div></div>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="120"><title>Bot de futuros</title><style>
:root{--bg:#f6f6f3;--panel:#fff;--fg:#1b1b19;--mut:#77756e;--line:#e6e4dd;--accent:#2563eb;--pos:#15803d;--neg:#c2261c;--warn:#b45309;--posbg:#e8f5ec;--negbg:#fbeaea}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--panel:#1b1b1a;--fg:#ecebe6;--mut:#9a9890;--line:#2c2b29;--accent:#60a5fa;--pos:#4ade80;--neg:#f87171;--warn:#fbbf24;--posbg:#14301f;--negbg:#3a1717}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1100px;margin:auto;padding:20px 16px 48px}header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;justify-content:space-between}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 10px}.mut{color:var(--mut)}.pos{color:var(--pos)}.neg{color:var(--neg)}.warn{color:var(--warn)}
.status{font-weight:600}.status::before{content:"● "}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.lbl{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.val{font-size:24px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}.sub{font-size:13px;color:var(--mut)}
.box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
svg{width:100%;height:auto;display:block}svg text{fill:var(--mut);font-size:11px}.grid{stroke:var(--line)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
th{font-size:12px;color:var(--mut);font-weight:500;text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}tr:last-child td{border-bottom:0}
.tag{font-size:11px;font-weight:700;padding:2px 6px;border-radius:6px}.tag.pos{background:var(--posbg)}.tag.neg{background:var(--negbg)}
pre{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:0}
.note{font-size:13px;color:var(--mut);margin-top:24px}
</style></head><body><main>
<header><h1>Bot de futuros · paper trading</h1><span class="status ${status[1]}">${status[0]}</span></header>
<div class="mut">Dinero simulado · ${cfg.symbols.length} perpetuos · estrategia ${esc(name)} · actualizado ${ar(Date.now())} (hora Argentina) · última vela ${s.lastT ? ar(s.lastT) : '—'}</div>
<div class="cards">
${card('Patrimonio', eq.toFixed(2) + ' <small>USDT</small>', 'empezó con ' + cap + ' USDT')}
${card('Resultado', money(pnl) + ' <small>USDT</small>', ((pnl / cap) * 100).toFixed(2) + ' %', cls(pnl))}
${card('Caída desde el máximo', (dd * 100).toFixed(1) + ' %', 'se corta en ' + cfg.risk.maxDrawdownPct * 100 + ' %', dd > 0.25 ? 'neg' : '')}
${card('Operaciones', trades.length, trades.length ? Math.round((wins.length / trades.length) * 100) + ' % ganadoras' : 'todavía ninguna')}
${card('Abiertas', Object.keys(s.positions).length + ' / ' + cfg.risk.maxPositions, 'posiciones')}
${card('Costos', (s.fees + s.funding).toFixed(2) + ' <small>USDT</small>', 'comisiones ' + s.fees.toFixed(2) + ' · financ. ' + s.funding.toFixed(2))}
${card('Tiempo corriendo', hours >= 48 ? (hours / 24).toFixed(1) + ' días' : hours.toFixed(1) + ' h', startT ? 'desde ' + ar(startT) : '')}
</div>
<h2>Patrimonio</h2><div class="box">${eqChart}</div>
<h2>Posiciones abiertas</h2>${positions ? `<div class="box scroll"><table><thead><tr><th>Par</th><th>Lado</th><th>Entrada</th><th>Precio</th><th>Stop</th><th>Objetivo</th><th>Liquidación</th><th>Margen</th><th>Ganancia</th><th>Desde</th></tr></thead><tbody>${positions}</tbody></table></div>` : '<p class="mut">Ninguna en este momento.</p>'}
${symRows ? `<h2>Resultado por par</h2><div class="box scroll"><table><thead><tr><th>Par</th><th>Ops</th><th>Acierto</th><th>USDT</th></tr></thead><tbody>${symRows}</tbody></table></div>` : ''}
<h2>Operaciones cerradas</h2>${tradeRows ? `<div class="box scroll"><table><thead><tr><th>Par</th><th>Lado</th><th>Entrada</th><th>Salida</th><th>Precio entrada</th><th>Precio salida</th><th>USDT</th><th>R</th><th>Motivo</th></tr></thead><tbody>${tradeRows}</tbody></table></div>` : '<p class="mut">Todavía ninguna.</p>'}
<h2>Últimos movimientos del bot</h2><pre>${esc(logTail.join('\n'))}</pre>
<p class="note">R = resultado medido en unidades de riesgo: −1 R es perder lo arriesgado, +2 R es ganar el doble. Riesgo por operación: ${cfg.risk.riskPerTradePct * 100} % del patrimonio. Parámetros: <code>${esc(JSON.stringify(params))}</code>. La página se recarga sola cada 2 minutos; el bot se actualiza cada ~15.</p>
</main></body></html>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}
