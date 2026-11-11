// Mesa de memecoins de Solana — coordinador de los 6 agentes (PAPER TRADING).
// Traspasos estrictos: Scout → Filter → Analyst → Executor. Risk vigila lo abierto. Logger registra todo.
//   node memecoins/run.js --minutes 320 --data mc-data [--sync]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import cfg from './config.js';
import { sleep } from './lib/http.js';
import { Logger } from './agents/logger.js';
import { Scout } from './agents/scout.js';
import { marketBatch, security } from './agents/filter.js';
import { analyze } from './agents/analyst.js';
import { Executor } from './agents/executor.js';
import { Risk } from './agents/risk.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MINUTES = +arg('--minutes', 320);
const DIR = path.resolve(arg('--data', 'mc-data'));
const SYNC = process.argv.includes('--sync');
fs.mkdirSync(DIR, { recursive: true });
const STATE = path.join(DIR, 'state.json');

const fresh = () => ({
  startedAt: Date.now(), cash: cfg.capitalUsd, positions: {}, trades: [], activity: [], recentDecisions: [], counters: {},
  equityPts: [], stats: { scanned: 0, passedVolume: 0, passedFilter: 0, approved: 0 }, blacklist: {}, lossStreak: 0,
  pausedUntil: 0, lastSummaryDay: null, summaries: [],
});
const s = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : fresh();
const log = new Logger(DIR, s);
const risk = new Risk(cfg.risk, null, s, log);
const ex = new Executor(cfg.executor, cfg.risk, s, log);
risk.ex = ex;

const watch = new Map();       // mint -> token esperando volumen
const secQueue = [];           // tokens con volumen, esperando chequeo de seguridad
const retryAt = new Map();     // mint -> momento en que se puede volver a evaluar
const symbolOf = (t, pair) => (t.symbol?.endsWith("…)") ? t.symbol : `${t.symbol || pair?.baseToken?.symbol || "?"} (${t.mint.slice(0, 4)}…)`);

// ---- SCOUT → lista de seguimiento
const scout = new Scout(cfg.scout, log, (t) => {
  s.stats.scanned++;
  if (s.blacklist[t.mint] || s.positions[t.mint]) return;
  if (watch.size >= cfg.scout.maxWatch) return;
  watch.set(t.mint, t);
});

// ---- FILTER (paso 1: volumen, barato y en lote)
async function sweep() {
  const now = Date.now(), mints = [];
  for (const [m, t] of watch) {
    if (now - t.foundAt > cfg.scout.watchMinutes * 6e4) {
      watch.delete(m);
      log.decision('descarte', t, `volumen < 50k: no llegó en ${cfg.scout.watchMinutes} min`, { source: t.source, volH1: t.volH1 ?? 0 });
    } else if (!(retryAt.get(m) > now)) mints.push(m);
  }
  if (!mints.length) return;
  const market = await marketBatch(mints);
  for (const m of mints) {
    const t = watch.get(m), pair = market.get(m);
    if (!t || !pair) continue;
    t.volH1 = pair.volume?.h1 ?? 0;
    if (t.volH1 >= cfg.filter.minVolumeH1Usd) {
      watch.delete(m);
      t.symbol = symbolOf(t, pair);
      s.stats.passedVolume++;
      secQueue.push({ t, pair });
      log.activity('FILTER', `${t.symbol}: volumen 1h ${Math.round(t.volH1 / 1000)}k ✓ → chequeo de seguridad`);
    }
  }
}

// ---- FILTER (paso 2: seguridad) → ANALYST → EXECUTOR
async function processQueue() {
  const item = secQueue.shift();
  if (!item) return sleep(500);
  const { t } = item;
  let sec;
  try { sec = await security(t.mint, cfg.filter); } catch (e) { sec = { ok: false, reason: `RugCheck falló (${e.message})` }; }
  if (!sec.ok) {
    log.decision('descarte', t, sec.reason, { top10: sec.top10, lpLocked: sec.lpLocked });
    log.activity('FILTER', `${t.symbol}: DESCARTADO · ${sec.reason}`);
    s.blacklist[t.mint] = `filtro: ${sec.reason}`;
    return;
  }
  s.stats.passedFilter++;
  // datos de mercado frescos para el Analyst
  const pair = (await marketBatch([t.mint])).get(t.mint) ?? item.pair;
  if ((pair.volume?.h1 ?? 0) < cfg.filter.minVolumeH1Usd) {
    log.decision('descarte', t, 'volumen < 50k al revalidar');
    return;
  }
  log.activity('FILTER', `${t.symbol}: pasó TODOS los filtros (top10 ${sec.top10.toFixed(1)} %, LP ${sec.lpLocked.toFixed(0)} %, ${sec.holders} holders) → Analyst`);
  const a = analyze(pair, sec);
  if (a.score < cfg.analyst.minScore) {
    log.decision('rechazo', t, `puntaje ${a.score.toFixed(3)} < ${cfg.analyst.minScore}`, { parts: a.parts });
    log.activity('ANALYST', `${t.symbol}: puntaje ${a.score.toFixed(3)} → no se opera`);
    retryAt.set(t.mint, Date.now() + 15 * 6e4);
    watch.set(t.mint, { ...t, foundAt: Date.now() }); // se reevalúa más tarde
    return;
  }
  s.stats.approved++;
  log.activity('ANALYST', `${t.symbol}: puntaje ${a.score.toFixed(3)} ✓ → Executor`);
  const block = ex.blocker(t.mint);
  if (block) {
    log.decision('rechazo', t, `executor: ${block}`, { score: a.score });
    log.activity('EXECUTOR', `${t.symbol}: no opera · ${block}`);
    return;
  }
  const err = ex.buy(t, pair, a);
  if (err) { log.decision('rechazo', t, `executor: ${err}`); return; }
  const p = s.positions[t.mint];
  log.decision('compra', t, `filtros OK + puntaje ${a.score.toFixed(2)}`, { size: +p.size.toFixed(2), price: p.entry, parts: a.parts, top10: sec.top10, lpLocked: sec.lpLocked, volH1: pair.volume?.h1, liq: pair.liquidity?.usd, dex: pair.dexId });
  log.activity('EXECUTOR', `COMPRA ${p.symbol} · ${p.size.toFixed(2)} USD (${(cfg.executor.maxPctPerTrade * 100).toFixed(0)} % del saldo) a ${p.entry.toPrecision(4)} · stop ${p.stop.toPrecision(4)}`);
}

// ---- Panel y persistencia
function writeLive() {
  const eq = ex.equity();
  log.equity(eq);
  const step = Math.max(1, Math.ceil(s.equityPts.length / 800));
  const live = {
    updatedAt: Date.now(), startedAt: s.startedAt, capital: cfg.capitalUsd, cash: s.cash, equity: eq,
    positions: Object.values(s.positions).map((p) => ({ ...p, ret: p.price / p.entry - 1, value: p.qty * p.price * (1 - cfg.executor.costPct) })),
    trades: s.trades.slice(-100).reverse(), activity: s.activity.slice(-150).reverse(), decisions: s.recentDecisions.slice(-60).reverse(),
    counters: s.counters, stats: s.stats, watching: watch.size, queue: secQueue.length, pausedUntil: s.pausedUntil,
    equityPts: s.equityPts.filter((_, i) => i % step === 0 || i === s.equityPts.length - 1), summaries: s.summaries.slice(-3).reverse(),
    rules: { minVol: cfg.filter.minVolumeH1Usd, top10: cfg.filter.maxTop10Pct, lp: cfg.filter.minLpLockedPct, score: cfg.analyst.minScore, size: cfg.executor.maxPctPerTrade, stop: cfg.risk.stopPct, trail: cfg.risk.trailActivatePct, trailDist: cfg.risk.trailDistancePct, maxOpen: cfg.executor.maxOpen },
  };
  fs.writeFileSync(path.join(DIR, 'live.json'), JSON.stringify(live));
  fs.writeFileSync(STATE, JSON.stringify(s));
}

function sync() {
  if (!SYNC) return;
  try {
    execSync('git add -A', { cwd: DIR });
    let has = true;
    try { execSync('git rev-parse -q --verify HEAD', { cwd: DIR, stdio: 'ignore' }); } catch { has = false; }
    execSync(has ? 'git commit -q --amend --allow-empty -m "datos mesa memecoins"' : 'git commit -q -m "datos mesa memecoins"', { cwd: DIR });
    execSync('git push -q -f origin HEAD:memecoin-data', { cwd: DIR, stdio: 'ignore' });
  } catch (e) { console.log('sync falló:', e.message.split('\n')[0]); }
}

// ---- Resumen diario (9:00 Argentina)
function maybeSummary() {
  const now = new Date(), day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < cfg.summaryHourUtc || s.lastSummaryDay === day) return;
  const since = s.summaries.at(-1)?.t ?? s.startedAt;
  const sum = log.summary(since, ex.equity());
  s.summaries.push(sum);
  s.lastSummaryDay = day;
  const md = [
    `## Resumen mesa de memecoins — ${day}`, '',
    `- Saldo: **${sum.equity.toFixed(2)} USD** (empezó con ${cfg.capitalUsd})`,
    `- Resultado del período: ${sum.pnlPeriod >= 0 ? '+' : ''}${sum.pnlPeriod.toFixed(2)} USD en ${sum.trades} operaciones (${(sum.winRate * 100).toFixed(0)} % ganadoras)`,
    `- Mejor: ${sum.best} · Peor: ${sum.worst}`,
    `- Embudo total: ${sum.scanned} tokens vistos → ${sum.filtered} pasaron filtros → ${sum.approved} aprobados por el Analyst`,
    `- Principales descartes: ${sum.topDiscards.map(([k, v]) => `${k} (${v})`).join(' · ')}`,
    '', 'Terminal: https://camilobosio.com/crypto-bot/memecoins/',
  ].join('\n');
  fs.mkdirSync(path.join(DIR, 'resumenes'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'resumenes', `${day}.md`), md);
  log.activity('LOGGER', `Resumen diario generado (${sum.trades} operaciones, saldo ${sum.equity.toFixed(2)})`);
  if (process.env.GH_TOKEN && process.env.AVISAR_A) {
    try {
      fs.writeFileSync('/tmp/resumen.md', `@${process.env.AVISAR_A}\n\n${md}`);
      execSync(`gh issue list --label memecoins --state open --json number -q ".[0].number" > /tmp/issue || true`);
      let n = fs.readFileSync('/tmp/issue', 'utf8').trim();
      if (!n) {
        execSync('gh label create memecoins --color 9333ea --force', { stdio: 'ignore' });
        n = execSync('gh issue create --label memecoins --title "🐸 Mesa de memecoins: resúmenes diarios" --body "Resumen diario a las 9:00 de Argentina."').toString().trim().split('/').pop();
      }
      execSync(`gh issue comment ${n} --body-file /tmp/resumen.md`, { stdio: 'ignore' });
    } catch (e) { console.log('aviso de resumen falló:', e.message.split('\n')[0]); }
  }
}

// ---- Bucle principal
const end = Date.now() + MINUTES * 6e4;
log.activity('LOGGER', `Mesa ${s.trades.length || Object.keys(s.positions).length ? 'retomada' : 'iniciada'} · saldo ${ex.equity().toFixed(2)} USD · ${Object.keys(s.positions).length} posiciones abiertas`);
scout.start();

const loop = async (fn, gapMs, name) => {
  while (Date.now() < end) {
    try { await fn(); } catch (e) { log.activity(name, `error: ${e.message}`); }
    await sleep(gapMs);
  }
};
let lastSync = 0;
await Promise.all([
  loop(sweep, 20_000, 'FILTER'),
  loop(processQueue, 100, 'FILTER'),
  loop(() => risk.check(), cfg.risk.checkEverySec * 1000, 'RISK'),
  loop(async () => {
    writeLive();
    maybeSummary();
    if (Date.now() - lastSync > 90_000) { sync(); lastSync = Date.now(); }
  }, 30_000, 'LOGGER'),
]);
scout.stop();
log.activity('LOGGER', `Fin del turno · saldo ${ex.equity().toFixed(2)} USD · se relanza solo`);
writeLive();
sync();
process.exit(0);
