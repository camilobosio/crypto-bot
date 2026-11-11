// Motor de futuros perpetuos (USDT lineales, margen aislado). Mismo código para backtest y paper.
//
// En cada vela de 5m (índice i):
//   1. Cobra/paga financiamiento si es hora (00, 08, 16 UTC).
//   2. Ejecuta órdenes pendientes a la APERTURA de i (generadas al cierre de i-1).
//      Antes de abrir: interruptor, límite diario, cantidad de posiciones y enfriamiento.
//   3. Revisa liquidación, stop y take profit dentro de la vela (si tocó ambos, asume el stop).
//   4. Valúa al cierre y aplica el interruptor.
//   5. Pide señales a la estrategia -> órdenes para i+1.
//
// Apalancamiento: el riesgo por operación es fijo (% del patrimonio hasta el stop). Con eso sale el tamaño.
// El bot elige el MAYOR apalancamiento que deja la liquidación al menos `liqSafety` veces más lejos
// que el stop (con un techo de maxLeverage). Así usa poco margen, pero el stop salta antes que la liquidación.

const H8 = 8 * 36e5;

export class FuturesPortfolio {
  constructor({ data, funding, strategy, params, cfg, state, ind }) {
    this.data = data;
    this.funding = funding ?? {};
    this.syms = Object.keys(data);
    this.strat = strategy;
    this.cfg = cfg;
    this.p = params;
    this.ind = ind;
    this.s = state ?? FuturesPortfolio.initState(cfg.initialCapital);
    this.allowEntries = true;
    this.trades = [];
    this.equityCurve = [];
    this.events = [];
  }

  static initState(cap) {
    return {
      wallet: cap, positions: {}, pending: [], peak: cap, halted: null, dayKey: null, dayStartEquity: cap,
      blockEntries: false, lastEquity: cap, lastT: null, fees: 0, funding: 0, cooldown: {},
    };
  }

  upnl(pos, px) { return pos.side * pos.qty * (px - pos.entry); }

  equityAt(i, f) {
    let e = this.s.wallet;
    for (const [sym, pos] of Object.entries(this.s.positions)) e += this.upnl(pos, this.data[sym][i][f]);
    return e;
  }

  usedMargin() { return Object.values(this.s.positions).reduce((a, p) => a + p.margin, 0); }

  close(sym, px, t, reason, feeRate, liquidation = false) {
    const s = this.s, pos = s.positions[sym];
    let pnl, fee = 0;
    if (liquidation) pnl = -pos.margin; // margen aislado: se pierde el margen de esa posición
    else { pnl = this.upnl(pos, px); fee = pos.qty * px * feeRate; }
    s.wallet += pnl - fee;
    s.fees += fee;
    const net = pnl - fee - pos.entryFee - pos.fundingPaid;
    this.trades.push({
      sym, side: pos.side, entryT: pos.entryT, exitT: t, entry: pos.entry, exit: px, qty: pos.qty, lev: pos.lev,
      pnl: net, ret: net / pos.eqAtEntry, r: net / pos.riskUsd, bars: pos.barsHeld, reason,
    });
    delete s.positions[sym];
    s.cooldown[sym] = t + this.cfg.risk.cooldownMin * 6e4;
  }

  open(o, i, t) {
    const s = this.s, R = this.cfg.risk, C = this.cfg.costs;
    const bar = this.data[o.sym][i];
    const px = bar.o * (1 + o.side * C.slippagePct);
    const d = (o.side * (px - o.stop)) / px; // distancia al stop en %
    if (!(d >= R.minStopPct)) return;
    const eq = this.equityAt(i, 'o');
    const riskUsd = R.riskPerTradePct * eq;
    const lev = Math.floor(Math.min(R.maxLeverage, 1 / (R.liqSafety * d + R.maintMarginPct)));
    if (lev < 1) return;
    const budget = Math.min(eq - this.usedMargin(), eq / R.maxPositions);
    let notional = riskUsd / (d + 2 * C.takerFee + C.slippagePct); // la pérdida al stop incluye costos
    notional = Math.min(notional, budget * lev);
    if (!(notional >= 5)) return; // mínimo de Bybit
    const qty = notional / px, margin = notional / lev, fee = notional * C.takerFee;
    s.wallet -= fee;
    s.fees += fee;
    const Rdist = Math.abs(px - o.stop);
    s.positions[o.sym] = {
      side: o.side, qty, entry: px, stop: o.stop, tp: px + o.side * o.tpR * Rdist, R: Rdist, lev, margin,
      liq: px * (1 - o.side * (1 / lev - R.maintMarginPct)), entryT: t, barsHeld: 0, entryFee: fee,
      fundingPaid: 0, riskUsd: Math.min(riskUsd, notional * (d + 2 * C.takerFee + C.slippagePct)), eqAtEntry: eq,
    };
  }

  step(i) {
    const s = this.s, R = this.cfg.risk, C = this.cfg.costs;
    const t = this.data[this.syms[0]][i].t;

    const day = new Date(t).toISOString().slice(0, 10);
    if (day !== s.dayKey) { s.dayKey = day; s.dayStartEquity = s.lastEquity; s.blockEntries = false; }

    // 1. Financiamiento
    if (t % H8 === 0) {
      for (const [sym, pos] of Object.entries(s.positions)) {
        const rate = this.funding[sym]?.get(t) ?? C.defaultFunding;
        const pay = pos.side * pos.qty * this.data[sym][i].o * rate; // largos pagan si la tasa es positiva
        s.wallet -= pay; s.funding += pay; pos.fundingPaid += pay;
      }
    }

    // 2. Órdenes pendientes (cierres primero)
    const pend = s.pending.sort((a, b) => (a.type === 'close' ? 0 : 1) - (b.type === 'close' ? 0 : 1));
    s.pending = [];
    for (const o of pend) {
      if (o.type === 'close') {
        const pos = s.positions[o.sym];
        if (pos) this.close(o.sym, this.data[o.sym][i].o * (1 - pos.side * C.slippagePct), t, o.reason, C.takerFee);
        continue;
      }
      if (s.halted || s.blockEntries || !this.allowEntries || s.positions[o.sym]) continue;
      if (Object.keys(s.positions).length >= R.maxPositions) continue;
      this.open(o, i, t);
    }

    // 3. Liquidación, stop y take profit dentro de la vela
    for (const [sym, pos] of Object.entries(s.positions)) {
      const b = this.data[sym][i];
      const adverse = pos.side === 1 ? b.l : b.h, favor = pos.side === 1 ? b.h : b.l;
      const beyond = (lvl, px) => pos.side * (px - lvl) <= 0; // px alcanzó lvl en contra
      if (beyond(pos.liq, b.o)) this.close(sym, b.o, t, 'LIQUIDACIÓN', 0, true);
      else if (beyond(pos.stop, b.o)) this.close(sym, b.o * (1 - pos.side * C.slippagePct), t, 'stop (gap)', C.takerFee);
      else if (beyond(pos.stop, adverse)) this.close(sym, pos.stop * (1 - pos.side * C.slippagePct), t, pos.side * (pos.stop - pos.entry) >= 0 ? 'stop en ganancia' : 'stop', C.takerFee);
      else if (pos.side * (favor - pos.tp) >= 0) this.close(sym, pos.tp, t, 'take profit', C.makerFee);
    }

    // 4. Valuación e interruptor
    const eq = this.equityAt(i, 'c');
    s.lastEquity = eq;
    s.peak = Math.max(s.peak, eq);
    const dd = 1 - eq / s.peak;
    if (R.dailyLossPct && !s.blockEntries && eq / s.dayStartEquity - 1 <= -R.dailyLossPct) {
      s.blockEntries = true;
      for (const sym of Object.keys(s.positions)) s.pending.push({ type: 'close', sym, reason: 'límite diario' });
      this.events.push({ t, type: 'LÍMITE DIARIO', eq });
    }
    if (!s.halted && dd >= R.maxDrawdownPct) {
      s.halted = { t, dd };
      for (const sym of Object.keys(s.positions)) s.pending.push({ type: 'close', sym, reason: 'interruptor' });
      this.events.push({ t, type: 'INTERRUPTOR', eq, dd });
    }

    // 5. Señales
    if (!s.halted) {
      let slots = R.maxPositions - Object.keys(s.positions).length;
      for (const sym of this.syms) {
        const x = this.ind[sym], pos = s.positions[sym];
        if (pos) {
          pos.barsHeld++;
          const m = this.strat.manage(x, i, this.p, pos);
          if (m?.exit) s.pending.push({ type: 'close', sym, reason: m.exit });
          else if (m?.stop && pos.side * (m.stop - pos.stop) > 0) pos.stop = m.stop; // el stop solo se acerca
        } else if (slots > 0 && !s.blockEntries && this.allowEntries && t >= (s.cooldown[sym] ?? 0)) {
          const sig = this.strat.entry(x, i, this.p);
          if (sig && Number.isFinite(sig.stop)) { s.pending.push({ type: 'open', sym, ...sig }); slots--; }
        }
      }
    }

    s.lastT = t;
    this.equityCurve.push({ t, equity: eq, dd, exposed: Object.keys(s.positions).length > 0 });
  }

  liquidateAll(i, reason = 'fin') {
    const t = this.data[this.syms[0]][i].t;
    for (const [sym, pos] of Object.entries(this.s.positions)) {
      this.close(sym, this.data[sym][i].c * (1 - pos.side * this.cfg.costs.slippagePct), t, reason, this.cfg.costs.takerFee);
    }
    this.s.pending = [];
  }
}

export function runBacktest({ data, funding, strategy, params, cfg, from, to, ind, liquidateAtEnd = true }) {
  const pf = new FuturesPortfolio({ data, funding, strategy, params, cfg, ind });
  for (let i = from; i < to; i++) pf.step(i);
  if (liquidateAtEnd) pf.liquidateAll(to - 1);
  return pf;
}
