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
//
// Entradas (cfg.entry.mode):
//   'market' -> entra a la apertura de la vela siguiente, paga comisión taker + slippage.
//   'limit'  -> NUNCA entra a mercado. Deja una orden límite (post-only) en el precio de la señal
//               (o en el que pida la estrategia). Solo se llena si el precio la ATRAVIESA (no alcanza
//               con tocarla: hay fila de órdenes). Si no se llena, en cada vela la corre al precio nuevo
//               mientras no se haya alejado más de chaseR veces el riesgo; vence a las maxWaitBars velas.
//               Paga comisión maker y sin slippage. Stop y objetivo quedan donde los puso la señal.
// Salidas (cfg.exits.mode):
//   'taker' -> stop y cierres a mercado (comisión taker + slippage). El take profit siempre es límite (maker).
//   'maker' -> al tocar el stop deja una orden límite EN el precio del stop y espera que el precio rebote
//              hasta ahí (solo así paga maker). Si el precio sigue en contra hasta emergencyR veces el
//              riesgo más allá del stop, o pasan maxWaitBars velas, cierra a mercado igual (protección).
//              Los cierres por tiempo/trailing/interruptor también se intentan con límite primero.
// Tamaño: si la estrategia manda un puntaje (score 0-1) y cfg.risk.riskByScore existe, el riesgo por
// operación sale de esa tabla; debajo de cfg.risk.minScore no opera.

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
    this.s.orders ??= {};
    this.limitMode = cfg.entry?.mode === 'limit';
    this.makerExits = cfg.exits?.mode === 'maker';
    this.allowEntries = true;
    this.trades = [];
    this.equityCurve = [];
    this.events = [];
  }

  static initState(cap) {
    return {
      wallet: cap, positions: {}, pending: [], peak: cap, halted: null, dayKey: null, dayStartEquity: cap,
      blockEntries: false, lastEquity: cap, lastT: null, fees: 0, funding: 0, cooldown: {}, orders: {},
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

  riskPct(o, t) {
    const R = this.cfg.risk;
    let pct = R.riskPerTradePct;
    if (o.score != null && R.riskByScore) { pct = 0; for (const [min, p] of R.riskByScore) if (o.score >= min) pct = p; }
    // Fin de semana (sábado y domingo, hora UTC): menos volumen y más lateral → arriesga menos.
    const wd = new Date(t).getUTCDay();
    if (R.weekendRiskFactor != null && (wd === 0 || wd === 6)) pct *= R.weekendRiskFactor;
    return pct;
  }

  sameSideCount(side) {
    return Object.values(this.s.positions).filter((p) => p.side === side).length
      + Object.values(this.s.orders).filter((o) => o.side === side).length;
  }

  // px = precio de entrada ya decidido; maker = true si entró con orden límite.
  open(o, i, t, px = null, maker = false) {
    const s = this.s, R = this.cfg.risk, C = this.cfg.costs;
    const bar = this.data[o.sym][i];
    px ??= bar.o * (1 + o.side * C.slippagePct);
    const feeIn = maker ? C.makerFee : C.takerFee;
    const d = (o.side * (px - o.stop)) / px; // distancia al stop en %
    if (!(d >= R.minStopPct)) return false;
    const eq = this.equityAt(i, 'o');
    const riskUsd = this.riskPct(o, t) * eq;
    if (!(riskUsd > 0)) return false;
    const lev = Math.floor(Math.min(R.maxLeverage, 1 / (R.liqSafety * d + R.maintMarginPct)));
    if (lev < 1) return false;
    const budget = Math.min(eq - this.usedMargin(), eq / R.maxPositions);
    const cost = d + feeIn + C.takerFee + C.slippagePct; // la pérdida al stop incluye costos
    let notional = riskUsd / cost;
    notional = Math.min(notional, budget * lev);
    if (!(notional >= 5)) return false; // mínimo de Bybit
    const qty = notional / px, margin = notional / lev, fee = notional * feeIn;
    s.wallet -= fee;
    s.fees += fee;
    const Rdist = Math.abs(px - o.stop);
    const anchor = maker ? (o.ref ?? px) : px; // con orden límite el objetivo queda donde lo marcó la señal
    const tp = o.tp ?? anchor + o.side * o.tpR * Math.abs(anchor - o.stop);
    if (!(o.side * (tp - px) > 0)) return false;
    s.positions[o.sym] = {
      side: o.side, qty, entry: px, stop: o.stop, tp, R: Rdist, lev, margin,
      liq: px * (1 - o.side * (1 / lev - R.maintMarginPct)), entryT: t, barsHeld: 0, entryFee: fee,
      fundingPaid: 0, riskUsd: Math.min(riskUsd, notional * cost), eqAtEntry: eq, score: o.score ?? null, maker,
    };
    return true;
  }

  // Órdenes límite que esperan: ¿el precio las atravesó en esta vela?
  fillOrders(i, t) {
    const s = this.s, R = this.cfg.risk;
    for (const [sym, o] of Object.entries(s.orders)) {
      const b = this.data[sym][i];
      if (s.halted || s.blockEntries || !this.allowEntries || s.positions[sym]) { delete s.orders[sym]; continue; }
      const through = o.side === 1 ? b.l < o.limit : b.h > o.limit;
      if (!through) continue;
      delete s.orders[sym];
      if (Object.keys(s.positions).length >= R.maxPositions) continue;
      const px = o.side === 1 ? Math.min(b.o, o.limit) : Math.max(b.o, o.limit); // si abrió más allá, se llena a la apertura
      this.open(o, i, t, px, true);
    }
  }

  // Al cierre: las que no se llenaron se corren al precio nuevo, o se cancelan.
  repriceOrders(i) {
    const E = this.cfg.entry;
    for (const [sym, o] of Object.entries(this.s.orders)) {
      o.waited++;
      const c = this.data[sym][i].c;
      const R0 = Math.abs(o.ref - o.stop);
      const tooFar = o.chase !== false && o.side * (c - o.ref) > (E.chaseR ?? 0.5) * R0; // las de zona esperan quietas
      const broken = o.side * (c - o.stop) <= 0;
      if (o.waited >= (o.maxWait ?? E.maxWaitBars) || tooFar || broken) { delete this.s.orders[sym]; continue; }
      if (o.chase !== false) o.limit = c;
    }
  }

  // Salida con orden límite (ver cabecera). Pesimista: dentro de la vela, si pudo pasar lo malo, pasó.
  makerExit(sym, pos, b, t) {
    const C = this.cfg.costs, X = this.cfg.exits;
    const adverse = pos.side === 1 ? b.l : b.h, favor = pos.side === 1 ? b.h : b.l;
    const reached = (lvl, px) => pos.side * (px - lvl) <= 0;
    const taker = (px, why) => this.close(sym, px * (1 - pos.side * C.slippagePct), t, why, C.takerFee);
    const eo = pos.exitOrder;
    if (eo) {
      if (reached(eo.emerg, b.o)) return taker(b.o, `${eo.reason} (emergencia)`);
      if (reached(eo.emerg, adverse)) return taker(eo.emerg, `${eo.reason} (emergencia)`);
      if (pos.side * (favor - eo.px) > 0) return this.close(sym, eo.px, t, `${eo.reason} (límite)`, C.makerFee);
      if (++eo.waited >= (X.maxWaitBars ?? 3)) return taker(b.c, `${eo.reason} (venció la límite)`);
      return;
    }
    const why = pos.side * (pos.stop - pos.entry) >= 0 ? 'stop en ganancia' : 'stop';
    if (reached(pos.stop, b.o) || reached(pos.stop, adverse)) {
      const emerg = pos.stop - pos.side * (X.emergencyR ?? 0.25) * pos.R;
      if (reached(emerg, b.o)) return taker(b.o, `${why} (emergencia)`);
      if (reached(emerg, adverse)) return taker(emerg, `${why} (emergencia)`);
      pos.exitOrder = { px: pos.stop, emerg, waited: 0, reason: why };
      return;
    }
    if (pos.side * (favor - pos.tp) >= 0) this.close(sym, pos.tp, t, 'take profit', C.makerFee);
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
        if (!pos) continue;
        if (this.makerExits) {
          const px = this.data[o.sym][i].o;
          pos.exitOrder ??= { px, emerg: px - pos.side * (this.cfg.exits.emergencyR ?? 0.25) * pos.R, waited: 0, reason: o.reason, fresh: false };
        } else this.close(o.sym, this.data[o.sym][i].o * (1 - pos.side * C.slippagePct), t, o.reason, C.takerFee);
        continue;
      }
      if (s.halted || s.blockEntries || !this.allowEntries || s.positions[o.sym]) continue;
      if (Object.keys(s.positions).length >= R.maxPositions) continue;
      if (this.limitMode) {
        // La orden queda en el libro desde la apertura de esta vela.
        s.orders[o.sym] = { ...o, limit: o.limit ?? o.ref, waited: 0 };
        continue;
      }
      this.open(o, i, t);
    }
    if (this.limitMode) this.fillOrders(i, t);

    // 3. Liquidación, stop y take profit dentro de la vela
    for (const [sym, pos] of Object.entries(s.positions)) {
      const b = this.data[sym][i];
      const adverse = pos.side === 1 ? b.l : b.h, favor = pos.side === 1 ? b.h : b.l;
      const beyond = (lvl, px) => pos.side * (px - lvl) <= 0; // px alcanzó lvl en contra
      if (beyond(pos.liq, b.o)) { this.close(sym, b.o, t, 'LIQUIDACIÓN', 0, true); continue; }
      if (this.makerExits) { this.makerExit(sym, pos, b, t); continue; }
      if (beyond(pos.stop, b.o)) this.close(sym, b.o * (1 - pos.side * C.slippagePct), t, 'stop (gap)', C.takerFee);
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
    if (this.limitMode) this.repriceOrders(i);
    if (!s.halted) {
      let slots = R.maxPositions - Object.keys(s.positions).length - Object.keys(s.orders).length;
      for (const sym of this.syms) {
        const x = this.ind[sym], pos = s.positions[sym];
        if (s.orders[sym]) continue;
        if (pos) {
          pos.barsHeld++;
          const m = this.strat.manage(x, i, this.p, pos);
          if (m?.exit) s.pending.push({ type: 'close', sym, reason: m.exit });
          else if (m?.stop && pos.side * (m.stop - pos.stop) > 0) pos.stop = m.stop; // el stop solo se acerca
        } else if (slots > 0 && !s.blockEntries && this.allowEntries && t >= (s.cooldown[sym] ?? 0)) {
          const sig = this.strat.entry(x, i, this.p);
          if (!sig || !Number.isFinite(sig.stop)) continue;
          if (sig.score != null && R.minScore != null && sig.score < R.minScore) continue;
          if (R.maxSameSide && this.sameSideCount(sig.side) + s.pending.filter((q) => q.type === 'open' && q.side === sig.side).length >= R.maxSameSide) continue;
          s.pending.push({ type: 'open', sym, ref: this.data[sym][i].c, ...sig }); slots--;
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
    this.s.orders = {};
  }
}

export function runBacktest({ data, funding, strategy, params, cfg, from, to, ind, liquidateAtEnd = true }) {
  const pf = new FuturesPortfolio({ data, funding, strategy, params, cfg, ind });
  for (let i = from; i < to; i++) pf.step(i);
  if (liquidateAtEnd) pf.liquidateAll(to - 1);
  return pf;
}
