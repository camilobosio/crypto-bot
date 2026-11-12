// RISK: vigila cada posición.
//   - Pools de PumpSwap: precio y liquidez DIRECTO de la blockchain cada 2 s (sin demora de DexScreener).
//   - Otros pools: DexScreener cada 10 s (como antes).
//   - stop fijo en −6 % desde la entrada
//   - toma parcial: vende una parte en +25 % y pasa el stop del resto a la entrada (esa operación ya no puede perder)
//   - trailing SOLO en ganadoras, desde +12 %, a 6 % del máximo
//   - si la liquidez cae a la mitad desde la entrada, sale ya (posible rug)
//   - si el par desaparece 1 minuto, sale asumiendo −50 % (conservador)
import { getJson } from '../lib/http.js';
import { poolInfo, readPools } from '../lib/chain.js';

export class Risk {
  constructor(cfg, executor, state, log) { this.cfg = cfg; this.ex = executor; this.s = state; this.log = log; this.lastDex = 0; }

  async check() {
    const pos = Object.values(this.s.positions);
    if (!pos.length) return;

    // 1) Cada 10 s: DexScreener (precio del SOL en USD y pools que no son PumpSwap)
    const dexTurn = Date.now() - this.lastDex >= this.cfg.dexEverySec * 1000;
    const dex = new Map();
    if (dexTurn) {
      this.lastDex = Date.now();
      for (let i = 0; i < pos.length; i += 30) {
        const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${pos.slice(i, i + 30).map((p) => p.pair).join(',')}`, { minGapMs: 250 }).catch(() => null);
        for (const pr of j?.pairs ?? []) dex.set(pr.pairAddress, pr);
      }
      for (const p of pos) {
        const pr = dex.get(p.pair);
        if (pr && +pr.priceUsd > 0 && +pr.priceNative > 0) p.solUsd = +pr.priceUsd / +pr.priceNative;
      }
    }

    // 2) Cada vuelta: blockchain para PumpSwap
    for (const p of pos) {
      // null = no es un pool de PumpSwap legible (no se reintenta); undefined = todavía no se pudo leer
      if (p.pool === undefined && p.dex === 'pumpswap') p.pool = await poolInfo(p.pair).catch(() => undefined);
    }
    const onChain = pos.filter((p) => p.pool && p.solUsd > 0);
    let chain = new Map();
    if (onChain.length) {
      try { chain = await readPools(onChain.map((p) => ({ key: p.mint, info: p.pool }))); }
      catch (e) { if (!this.rpcWarned) { this.rpcWarned = true; this.log.activity('RISK', `RPC de Solana sin respuesta (${e.message}) → uso DexScreener mientras tanto`); } }
    }

    for (const p of pos) {
      if (!this.s.positions[p.mint]) continue;
      let price, liq;
      const c = chain.get(p.mint);
      if (c && c.priceSol > 0) {
        price = c.priceSol * p.solUsd;
        liq = 2 * c.solReserve * p.solUsd;
        p.src = 'blockchain';
        p.misses = 0;
      } else if (c && c.solReserve === 0) {
        this.close(p, p.price * 0.02, 'el pool quedó vacío (rug)');
        continue;
      } else {
        if (!dexTurn) continue;               // sin dato de blockchain: espera la vuelta de DexScreener
        const pr = dex.get(p.pair);
        if (!pr || !(+pr.priceUsd > 0)) {
          if (++p.misses >= 6) this.close(p, p.price * 0.5, 'par sin datos 1 min (posible rug) — se asume −50 %');
          continue;
        }
        p.misses = 0;
        price = +pr.priceUsd;
        liq = pr.liquidity?.usd ?? p.liq;
        p.src = 'dexscreener';
        // DexScreener a veces devuelve un precio aislado erróneo: un salto > 25 % se confirma antes de actuar
        if (Math.abs(price / p.price - 1) > 0.25) {
          const again = await getJson(`https://api.dexscreener.com/token-pairs/v1/solana/${p.mint}`, { minGapMs: 250 }).catch(() => null);
          const same = (again ?? []).find((x) => x.pairAddress === p.pair);
          const confirm = same ? +same.priceUsd : NaN;
          if (!(confirm > 0) || Math.abs(confirm / price - 1) > 0.1) {
            this.log.activity('RISK', `${p.symbol}: precio raro ${price.toPrecision(4)} sin confirmar → se ignora esta lectura`);
            continue;
          }
          price = confirm;
        }
      }
      this.apply(p, price, liq);
    }
  }

  apply(p, price, liq) {
    p.price = price;
    p.liq = liq;
    // la referencia de liquidez se toma de la misma fuente que se usa para vigilar
    if (p.src !== p.liqSrc) { p.liqEntry = liq; p.liqSrc = p.src; }
    p.peak = Math.max(p.peak, price);
    const ret = price / p.entry - 1;

    if (p.liqEntry > 0 && liq < p.liqEntry * (1 - this.cfg.rugLiquidityDrop)) {
      return this.close(p, price, `liquidez cayó ${((1 - liq / p.liqEntry) * 100).toFixed(0)} % (posible rug)`);
    }

    // Toma parcial: asegura ganancia y deja el resto sin riesgo
    if (!p.tpDone && ret >= this.cfg.takeProfitPct) {
      p.tpDone = true;
      const part = this.ex.sellPart(p.mint, this.cfg.takeProfitFraction, price);
      p.stop = Math.max(p.stop, p.entry * this.cfg.breakEvenFactor);
      this.log.decision('venta parcial', p, `+${(ret * 100).toFixed(1)} % → vende ${(this.cfg.takeProfitFraction * 100).toFixed(0)} %`, { pnl: +part.pnl.toFixed(4) });
      this.log.activity('RISK', `${p.symbol}: +${(ret * 100).toFixed(1)} % → VENDE ${(this.cfg.takeProfitFraction * 100).toFixed(0)} % (+${part.pnl.toFixed(2)} USD asegurados) · stop del resto a la entrada`);
    }

    if (!p.trailing && p.peak >= p.entry * (1 + this.cfg.trailActivatePct)) {
      p.trailing = true;
      this.log.activity('RISK', `${p.symbol}: llegó a +${((p.peak / p.entry - 1) * 100).toFixed(1)} % → trailing activado`);
    }
    if (p.trailing) p.stop = Math.max(p.stop, p.peak * (1 - this.cfg.trailDistancePct));

    if (price <= p.stop) {
      const why = p.trailing ? `trailing stop (máximo +${((p.peak / p.entry - 1) * 100).toFixed(1)} %)`
        : p.tpDone ? 'stop en la entrada tras la toma parcial'
          : `stop −6 % (precio ${(ret * 100).toFixed(1)} %)`;
      this.close(p, price, why);
    }
  }

  close(p, price, reason) {
    const t = this.ex.sell(p.mint, price, reason);
    this.log.decision('venta', p, reason, { pnl: +t.pnl.toFixed(4), ret: +t.ret.toFixed(4) });
    this.log.activity('RISK', `CIERRE ${p.symbol} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USD (${(t.ret * 100).toFixed(1)} %) · ${reason} · precio de ${p.src ?? 'dexscreener'}`);
  }
}
