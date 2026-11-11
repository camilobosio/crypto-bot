// EXECUTOR: solo opera lo que el Analyst aprobó (que a su vez solo recibe lo que pasó el Filter).
// Máximo 8 % del saldo actual por operación. Una posición por token: nunca promedia a la baja.
// Anti-venganza: un token que cerró en pérdida queda vetado para siempre, y tras N pérdidas seguidas pausa.
export class Executor {
  constructor(cfg, risk, state, log) { this.cfg = cfg; this.risk = risk; this.s = state; this.log = log; }

  equity() {
    let e = this.s.cash;
    for (const p of Object.values(this.s.positions)) e += p.qty * p.price * (1 - this.cfg.costPct);
    return e;
  }

  // Devuelve el motivo por el que NO puede operar, o null.
  blocker(mint) {
    if (this.s.positions[mint]) return 'ya hay posición en este token (no se promedia)';
    if (this.s.blacklist[mint]) return `token vetado: ${this.s.blacklist[mint]}`;
    if (Date.now() < (this.s.pausedUntil ?? 0)) return `pausa anti-venganza hasta ${new Date(this.s.pausedUntil).toISOString().slice(11, 16)} UTC`;
    if (Object.keys(this.s.positions).length >= this.cfg.maxOpen) return `máximo de ${this.cfg.maxOpen} posiciones abiertas`;
    return null;
  }

  buy(token, pair, analysis) {
    const price = +pair.priceUsd;
    const size = Math.min(this.cfg.maxPctPerTrade * this.equity(), this.s.cash);
    if (!(price > 0)) return 'sin precio';
    if (size < 1) return 'saldo insuficiente';
    const qty = size / (price * (1 + this.cfg.costPct));
    this.s.cash -= size;
    this.s.positions[token.mint] = {
      mint: token.mint, symbol: token.symbol || pair.baseToken?.symbol || token.mint.slice(0, 6), pair: pair.pairAddress, dex: pair.dexId,
      entryT: Date.now(), entry: price, qty, size, price, peak: price, liqEntry: pair.liquidity?.usd ?? 0, liq: pair.liquidity?.usd ?? 0,
      stop: price * (1 + this.risk.stopPct), trailing: false, score: analysis.score, misses: 0,
    };
    return null;
  }

  sell(mint, price, reason) {
    const p = this.s.positions[mint];
    const proceeds = p.qty * price * (1 - this.cfg.costPct);
    const pnl = proceeds - p.size;
    this.s.cash += proceeds;
    const trade = { mint, symbol: p.symbol, dex: p.dex, entryT: p.entryT, exitT: Date.now(), entry: p.entry, exit: price, size: p.size, pnl, ret: pnl / p.size, peakRet: p.peak / p.entry - 1, reason, score: p.score };
    this.s.trades.push(trade);
    delete this.s.positions[mint];
    if (pnl < 0) {
      this.s.blacklist[mint] = 'cerró en pérdida (sin revancha)';
      this.s.lossStreak = (this.s.lossStreak ?? 0) + 1;
      if (this.s.lossStreak >= this.cfg.lossStreakPause) {
        this.s.pausedUntil = Date.now() + this.cfg.pauseMinutes * 6e4;
        this.s.lossStreak = 0;
        this.log.activity('EXECUTOR', `${this.cfg.lossStreakPause} pérdidas seguidas → pausa de ${this.cfg.pauseMinutes} min (anti-venganza)`);
      }
    } else this.s.lossStreak = 0;
    return trade;
  }
}
