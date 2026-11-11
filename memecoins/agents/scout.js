// SCOUT: escanea pares nuevos en Pump.fun (en vivo) y en Raydium/otros DEX de Solana.
// Solo descubre: entrega cada mint nuevo a la lista de seguimiento. No opina.
import { getJson } from '../lib/http.js';

export class Scout {
  constructor(cfg, log, onToken) {
    this.cfg = cfg; this.log = log; this.onToken = onToken;
    this.seen = new Set();
    this.timers = [];
  }

  emit(mint, source, symbol = '') {
    if (!mint || this.seen.has(mint)) return;
    this.seen.add(mint);
    if (this.seen.size > 200_000) this.seen = new Set([...this.seen].slice(-100_000));
    this.onToken({ mint, source, symbol, foundAt: Date.now() });
  }

  start() {
    if (this.cfg.pumpportal) this.connectPump();
    const every = (sec, fn) => { fn(); this.timers.push(setInterval(fn, sec * 1000)); };
    every(this.cfg.geckoEverySec, () => this.gecko().catch((e) => this.log.activity('SCOUT', `GeckoTerminal sin respuesta (${e.message})`)));
    every(this.cfg.dexProfilesEverySec, () => this.dexProfiles().catch((e) => this.log.activity('SCOUT', `DexScreener sin respuesta (${e.message})`)));
  }

  stop() { this.timers.forEach(clearInterval); this.closed = true; try { this.ws?.close(); } catch {} }

  connectPump() {
    const ws = (this.ws = new WebSocket('wss://pumpportal.fun/api/data'));
    ws.onopen = () => {
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      this.log.activity('SCOUT', 'Conectado a Pump.fun en vivo (tokens nuevos + migraciones)');
    };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.txType === 'create') this.emit(d.mint, 'pumpfun', d.symbol);
        else if (d.txType === 'migrate' || d.pool) {
          this.emit(d.mint, 'migración');
          this.log.activity('SCOUT', `Migración de Pump.fun: ${d.mint.slice(0, 6)}…`);
        }
      } catch {}
    };
    ws.onclose = () => { if (!this.closed) setTimeout(() => this.connectPump(), 5000); };
    ws.onerror = () => {};
  }

  async gecko() {
    const j = await getJson('https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1', { minGapMs: 2500 });
    let n = 0;
    for (const p of j?.data ?? []) {
      const id = p.relationships?.base_token?.data?.id ?? '';
      const dex = p.relationships?.dex?.data?.id ?? '';
      const mint = id.replace('solana_', '');
      if (mint && !mint.startsWith('So1111')) { const before = this.seen.size; this.emit(mint, dex || 'dex', (p.attributes?.name ?? '').split(' / ')[0]); n += this.seen.size - before; }
    }
    if (n) this.log.activity('SCOUT', `${n} pools nuevos en Raydium/otros DEX`);
  }

  async dexProfiles() {
    for (const url of ['https://api.dexscreener.com/token-profiles/latest/v1', 'https://api.dexscreener.com/token-boosts/latest/v1']) {
      const j = await getJson(url, { minGapMs: 300 });
      for (const t of j ?? []) if (t.chainId === 'solana') this.emit(t.tokenAddress, 'dexscreener');
    }
  }
}
