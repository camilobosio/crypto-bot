// RISK: vigila cada posición cada 10 s.
//   - stop fijo en −6 % desde la entrada
//   - trailing SOLO en ganadoras, recién desde +12 %, a 6 % del máximo
//   - si la liquidez cae a la mitad desde la entrada, sale ya (posible rug)
//   - si el par desaparece de DexScreener 1 minuto, sale asumiendo −50 % (conservador)
import { getJson } from '../lib/http.js';

export class Risk {
  constructor(cfg, executor, state, log) { this.cfg = cfg; this.ex = executor; this.s = state; this.log = log; }

  async check() {
    const pos = Object.values(this.s.positions);
    if (!pos.length) return;
    const data = new Map();
    for (let i = 0; i < pos.length; i += 30) {
      const j = await getJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${pos.slice(i, i + 30).map((p) => p.pair).join(',')}`, { minGapMs: 250 });
      for (const pr of j?.pairs ?? []) data.set(pr.pairAddress, pr);
    }
    for (const p of pos) {
      const pr = data.get(p.pair);
      if (!pr || !(+pr.priceUsd > 0)) {
        if (++p.misses >= 6) this.close(p, p.price * 0.5, 'par sin datos 1 min (posible rug) — se asume −50 %');
        continue;
      }
      p.misses = 0;
      p.price = +pr.priceUsd;
      p.liq = pr.liquidity?.usd ?? p.liq;
      p.peak = Math.max(p.peak, p.price);
      const ret = p.price / p.entry - 1;
      if (!p.trailing && p.peak >= p.entry * (1 + this.cfg.trailActivatePct)) {
        p.trailing = true;
        this.log.activity('RISK', `${p.symbol}: llegó a +${((p.peak / p.entry - 1) * 100).toFixed(1)} % → trailing activado`);
      }
      if (p.trailing) p.stop = Math.max(p.stop, p.peak * (1 - this.cfg.trailDistancePct));

      if (p.liqEntry > 0 && p.liq < p.liqEntry * (1 - this.cfg.rugLiquidityDrop)) this.close(p, p.price, `liquidez cayó ${((1 - p.liq / p.liqEntry) * 100).toFixed(0)} % (posible rug)`);
      else if (p.price <= p.stop) this.close(p, p.price, p.trailing ? `trailing stop (máximo +${((p.peak / p.entry - 1) * 100).toFixed(1)} %)` : `stop −6 % (precio ${(ret * 100).toFixed(1)} %)`);
    }
  }

  close(p, price, reason) {
    const t = this.ex.sell(p.mint, price, reason);
    this.log.decision('venta', p, reason, { pnl: +t.pnl.toFixed(4), ret: +t.ret.toFixed(4) });
    this.log.activity('RISK', `CIERRE ${p.symbol} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USD (${(t.ret * 100).toFixed(1)} %) · ${reason}`);
  }
}
