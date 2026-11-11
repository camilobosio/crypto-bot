// LOGGER: registra el motivo de cada operación y de cada descarte, la actividad de los agentes,
// la curva de equity y el resumen diario. Escribe en el directorio de datos.
import fs from 'node:fs';
import path from 'node:path';

// Agrupa motivos para los contadores (un token puede fallar varios criterios a la vez).
export function category(r) {
  if (/^volumen/.test(r)) return 'volumen 1h < 50k';
  if (/^mint/.test(r)) return 'mint no revocado';
  if (/^freeze/.test(r)) return 'freeze no revocado';
  if (/^LP/.test(r)) return 'LP no bloqueado';
  if (/^top 10/.test(r)) return 'top 10 holders > 20 %';
  if (/rug/i.test(r)) return 'dev vinculado a rugs';
  if (/^puntaje/.test(r)) return 'puntaje del Analyst < 0,6';
  if (/vetado/.test(r)) return 'executor: token vetado';
  if (/pausa/.test(r)) return 'executor: pausa anti-venganza';
  if (/máximo de/.test(r)) return 'executor: máximo de posiciones';
  if (/no se promedia/.test(r)) return 'executor: ya en posición';
  if (/RugCheck/.test(r)) return 'sin datos de seguridad';
  return r.replace(/[\d.,]+/g, '#');
}

export class Logger {
  constructor(dir, state) {
    this.dir = dir;
    this.s = state;
    fs.mkdirSync(path.join(dir, 'decisiones'), { recursive: true });
  }

  activity(agent, msg) {
    const line = { t: Date.now(), agent, msg };
    this.s.activity.push(line);
    if (this.s.activity.length > 400) this.s.activity.splice(0, this.s.activity.length - 400);
    console.log(`[${new Date(line.t).toISOString().slice(11, 19)}] ${agent.padEnd(8)} ${msg}`);
  }

  // Cada decisión (descarte, rechazo, compra, venta) queda en un archivo por día, una línea JSON.
  decision(type, token, reason, extra = {}) {
    const rec = { t: Date.now(), type, mint: token.mint, symbol: token.symbol ?? '', reason, ...extra };
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(path.join(this.dir, 'decisiones', `${day}.jsonl`), JSON.stringify(rec) + '\n');
    if (type === 'descarte' || type === 'rechazo') {
      for (const part of reason.split(' · ')) {
        const k = category(part);
        this.s.counters[k] = (this.s.counters[k] ?? 0) + 1;
      }
    }
    this.s.recentDecisions.push(rec);
    if (this.s.recentDecisions.length > 150) this.s.recentDecisions.splice(0, this.s.recentDecisions.length - 150);
  }

  equity(eq) {
    const pts = this.s.equityPts, last = pts.at(-1);
    if (!last || Date.now() - last.t >= 60_000) pts.push({ t: Date.now(), e: +eq.toFixed(4) });
    if (pts.length > 4000) this.s.equityPts = pts.filter((_, i) => i % 2 === 0 || i > pts.length - 500);
  }

  summary(since, eq) {
    const trades = this.s.trades.filter((t) => t.exitT >= since);
    const wins = trades.filter((t) => t.pnl > 0);
    const pnl = trades.reduce((a, t) => a + t.pnl, 0);
    const best = trades.slice().sort((a, b) => b.pnl - a.pnl)[0], worst = trades.slice().sort((a, b) => a.pnl - b.pnl)[0];
    const reasons = Object.entries(this.s.counters).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return {
      t: Date.now(), since, equity: eq, pnlPeriod: pnl, trades: trades.length,
      winRate: trades.length ? wins.length / trades.length : 0,
      best: best ? `${best.symbol} ${best.pnl >= 0 ? '+' : ''}${best.pnl.toFixed(2)} USD (${(best.ret * 100).toFixed(1)} %)` : '—',
      worst: worst ? `${worst.symbol} ${worst.pnl.toFixed(2)} USD (${(worst.ret * 100).toFixed(1)} %)` : '—',
      scanned: this.s.stats.scanned, filtered: this.s.stats.passedFilter, approved: this.s.stats.approved,
      topDiscards: reasons,
    };
  }
}
