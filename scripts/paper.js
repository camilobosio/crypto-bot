// Paper trading 24/7 de futuros: precios reales de Bybit, dinero simulado.
// Usa el MISMO motor que el backtest. Revisa cada minuto si cerró una vela de 5m.
//   node scripts/paper.js            -> corre en bucle
//   node scripts/paper.js --once     -> un solo ciclo
//   node scripts/paper.js --reset    -> borra estado, log y operaciones
//   node scripts/paper.js --unhalt   -> rearma el interruptor (decisión humana)
import fs from 'node:fs';
import path from 'node:path';
import cfg from '../config.js';
import { loadCandles, loadFunding, alignCandles } from '../src/data.js';
import { strategies, withDefaults, prepareAll } from '../src/strategies.js';
import { FuturesPortfolio } from '../src/engine.js';


const args = new Set(process.argv.slice(2));
const name = cfg.strategy;
const strategy = strategies[name];
const dir = process.env.STATE_DIR ? path.resolve(process.env.STATE_DIR) : path.resolve(import.meta.dirname, '..', 'state');
const STATE = path.join(dir, `paper_${name}.json`);
const TRADES = path.join(dir, `paper_${name}_trades.csv`);
const LOG = path.join(dir, `paper_${name}.log`);
const SUMMARY = path.join(dir, 'RESUMEN.md');
const EQUITY = path.join(dir, `paper_${name}_equity.csv`);
const TRADES_JSON = path.join(dir, `paper_${name}_trades.json`);
const LIVE = path.join(dir, 'live.json');
const paramsFile = path.join(dir, `params_${name}.json`);
fs.mkdirSync(dir, { recursive: true });

const saved = fs.existsSync(paramsFile) ? JSON.parse(fs.readFileSync(paramsFile, 'utf8')) : null;
const params = withDefaults(strategy, saved);
const LOOKBACK_DAYS = 60; // alcanza para la EMA diaria y las de 4h

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const hm = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const log = (msg) => { const line = `[${stamp()}] ${msg}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

if (args.has('--reset')) {
  for (const f of [STATE, TRADES, LOG, SUMMARY, EQUITY, TRADES_JSON, LIVE]) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('Estado, log y operaciones borrados.');
  process.exit(0);
}
if (args.has('--unhalt')) {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  st.halted = null; st.peak = st.lastEquity;
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  log('Interruptor rearmado a mano. El máximo para medir la caída pasa a ser el patrimonio actual.');
  process.exit(0);
}

function writeSummary(s) {
  const ret = s.lastEquity / cfg.initialCapital - 1;
  const trades = fs.existsSync(TRADES) ? fs.readFileSync(TRADES, 'utf8').trim().split('\n').slice(1) : [];
  const wins = trades.filter((l) => +l.split(',')[8] > 0).length;
  const logTail = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-20) : [];
  const pos = Object.entries(s.positions);
  fs.writeFileSync(SUMMARY, `# Paper trading de futuros: ${name}

Dinero **simulado** · precios reales de Bybit. Actualizado ${stamp()} UTC · última vela ${s.lastT ? hm(s.lastT) : '—'}

| | |
|---|---|
| Capital inicial | ${cfg.initialCapital} USDT |
| Patrimonio | **${s.lastEquity.toFixed(2)} USDT** (${(ret * 100).toFixed(2)} %) |
| Caída desde el máximo | ${((1 - s.lastEquity / s.peak) * 100).toFixed(1)} % (corta en ${cfg.risk.maxDrawdownPct * 100} %) |
| Operaciones cerradas | ${trades.length} (${trades.length ? ((wins / trades.length) * 100).toFixed(0) : 0} % ganadoras) |
| Comisiones / financiamiento | ${s.fees.toFixed(2)} / ${s.funding.toFixed(2)} USDT |
| Estado | ${s.halted ? '⛔ DETENIDO por interruptor' : s.blockEntries ? '⏸ límite diario' : '✅ operando'} |

## Posiciones abiertas
${pos.length ? pos.map(([sym, p]) => `- ${sym} ${p.side === 1 ? 'LARGO' : 'CORTO'} ${p.lev}x · entrada ${p.entry.toPrecision(6)} · stop ${p.stop.toPrecision(6)} · objetivo ${p.tp.toPrecision(6)} · liquidación ${p.liq.toPrecision(6)} · margen ${p.margin.toFixed(2)} USDT`).join('\n') : 'Ninguna.'}

## Últimas operaciones
${trades.length ? '```\n' + trades.slice(-15).join('\n') + '\n```' : 'Todavía ninguna.'}

## Log reciente
\`\`\`
${logTail.join('\n')}
\`\`\`
`);
}

// Qué está mirando el bot en cada par: tendencia de 4 h y distancia al nivel de ruptura.
function watchInfo(pf, data) {
  return Object.keys(data).map((sym) => {
    const x = pf.ind[sym], i = data[sym].length - 1, j4 = x.h4.i[i], j1 = x.h1.i[i];
    const f = x.h4.f[j4], sl = x.h4.s[j4], c4 = x.h4.c[j4];
    const trend = f > sl && c4 > sl ? 1 : f < sl && c4 < sl ? -1 : 0;
    const price = data[sym][i].c, hi = x.dcH?.[j1], lo = x.dcL?.[j1];
    const level = trend === 1 ? hi : trend === -1 ? lo : null;
    const chg24 = price / data[sym][Math.max(0, i - 288)].c - 1;
    return { sym, price, trend, hi, lo, level, dist: level ? (level - price) / price : null, chg24 };
  });
}

// Datos del panel en vivo (docs/index.html los lee desde la rama de datos).
function writeLive(pf, data) {
  const s = pf.s;
  const trades = fs.existsSync(TRADES_JSON) ? JSON.parse(fs.readFileSync(TRADES_JSON, 'utf8')) : [];
  let equity = fs.existsSync(EQUITY)
    ? fs.readFileSync(EQUITY, 'utf8').trim().split('\n').map((l) => { const [t, e] = l.split(','); return { t: +t, e: +e }; })
    : [];
  const step = Math.max(1, Math.ceil(equity.length / 800));
  equity = equity.filter((_, i) => i % step === 0 || i === equity.length - 1);
  const logTail = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-40).reverse() : [];
  const live = {
    updatedAt: Date.now(), lastBarT: s.lastT, startedAt: equity[0]?.t ?? s.lastT, capital: cfg.initialCapital,
    equity: s.lastEquity, peak: s.peak, wallet: s.wallet, fees: s.fees, funding: s.funding,
    status: s.halted ? 'detenido' : s.blockEntries ? 'pausa diaria' : 'operando',
    positions: Object.entries(s.positions).map(([sym, p]) => {
      const last = data[sym].at(-1).c;
      return { sym, side: p.side, lev: p.lev, entry: p.entry, price: last, stop: p.stop, tp: p.tp, liq: p.liq, margin: p.margin, upnl: pf.upnl(p, last), entryT: p.entryT };
    }),
    pending: s.pending, trades: trades.slice(-100).reverse(), equityPts: equity, watch: watchInfo(pf, data), log: logTail,
    strategy: name, params, rules: { risk: cfg.risk.riskPerTradePct, maxDD: cfg.risk.maxDrawdownPct, maxPos: cfg.risk.maxPositions, maxLev: cfg.risk.maxLeverage },
  };
  fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify(live));
}

async function cycle() {
  const startMs = Date.now() - LOOKBACK_DAYS * 864e5;
  const raw = {}, funding = {};
  await Promise.all(cfg.symbols.map(async (s) => {
    raw[s] = await loadCandles(s, '5m', startMs);
    funding[s] = new Map(await loadFunding(s, startMs));
  }));
  const data = alignCandles(raw);
  const times = data[cfg.symbols[0]].map((c) => c.t);
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  const pf = new FuturesPortfolio({ data, funding, strategy, params, cfg, state, ind: prepareAll(strategy, data, params) });

  if (!state) {
    pf.s.lastT = times.at(-1);
    fs.writeFileSync(STATE, JSON.stringify(pf.s, null, 2));
    log(`Iniciado: ${cfg.initialCapital} USDT simulados · ${name} ${JSON.stringify(params)} · ${cfg.symbols.join(' ')}`);
    fs.writeFileSync(EQUITY, `${pf.s.lastT},${pf.s.lastEquity.toFixed(4)}\n`);
    writeSummary(pf.s);
    writeLive(pf, data);
    return;
  }
  if (times[0] > state.lastT) log('Aviso: el bot estuvo apagado más de lo que cubren los datos.');

  let processed = 0;
  for (let i = 0; i < times.length; i++) if (times[i] > state.lastT) { pf.step(i); processed++; }
  if (!processed) { writeLive(pf, data); return; }

  if (!fs.existsSync(TRADES)) fs.writeFileSync(TRADES, 'par,lado,apalancamiento,entrada,salida,precio_entrada,precio_salida,cantidad,pnl_usdt,r,motivo\n');
  for (const t of pf.trades) {
    fs.appendFileSync(TRADES, [t.sym, t.side === 1 ? 'largo' : 'corto', t.lev, hm(t.entryT), hm(t.exitT), t.entry.toPrecision(6), t.exit.toPrecision(6), t.qty.toPrecision(6), t.pnl.toFixed(2), t.r.toFixed(2), t.reason].join(',') + '\n');
    log(`CIERRE ${t.sym} ${t.side === 1 ? 'largo' : 'corto'} ${t.lev}x · ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USDT (${t.r.toFixed(2)} R) · ${t.reason}`);
  }
  for (const e of pf.events) log(`EVENTO ${e.type}${e.dd ? ` caída ${(e.dd * 100).toFixed(1)} %` : ''}`);
  for (const [sym, p] of Object.entries(pf.s.positions)) {
    if (p.entryT > state.lastT) log(`APERTURA ${sym} ${p.side === 1 ? 'LARGO' : 'CORTO'} ${p.lev}x · entrada ${p.entry.toPrecision(6)} · stop ${p.stop.toPrecision(6)} · objetivo ${p.tp.toPrecision(6)} · margen ${p.margin.toFixed(2)} USDT`);
  }
  const pos = Object.entries(pf.s.positions).map(([s, p]) => `${s} ${p.side === 1 ? 'L' : 'C'} ${p.lev}x ${pf.upnl(p, data[s].at(-1).c) >= 0 ? '+' : ''}${pf.upnl(p, data[s].at(-1).c).toFixed(2)}`).join(' | ') || 'sin posiciones';
  log(`Vela ${hm(pf.s.lastT)} · patrimonio ${pf.s.lastEquity.toFixed(2)} USDT · caída ${((1 - pf.s.lastEquity / pf.s.peak) * 100).toFixed(1)} % · ${pos}${pf.s.halted ? ' · DETENIDO' : ''}`);
  fs.writeFileSync(STATE, JSON.stringify(pf.s, null, 2));
  fs.appendFileSync(EQUITY, pf.equityCurve.map((p) => `${p.t},${p.equity.toFixed(4)}`).join('\n') + '\n');
  if (pf.trades.length) {
    const all = fs.existsSync(TRADES_JSON) ? JSON.parse(fs.readFileSync(TRADES_JSON, 'utf8')) : [];
    fs.writeFileSync(TRADES_JSON, JSON.stringify([...all, ...pf.trades]));
  }
  writeSummary(pf.s);
  writeLive(pf, data);
}

const run = async () => { try { await cycle(); } catch (e) { log('Error: ' + e.message); } };
await run();
if (!args.has('--once')) setInterval(run, 60_000);
