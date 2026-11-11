// FILTER: descarta todo lo que falle en ALGO:
//   - volumen de la última hora < 50k USD  (se sigue al candidato hasta 45 min por si llega)
//   - mint no revocado (y freeze no revocado)
//   - LP no bloqueado
//   - top 10 holders > 20 % (sin contar pools ni la curva de Pump.fun)
//   - wallet del dev vinculada a rugs anteriores
// Datos: DexScreener (mercado) y RugCheck (seguridad on-chain).
import { getJson } from '../lib/http.js';

const RUG_WORDS = /rug|creator history|scam|honeypot/i;

export function bestPair(pairs, mint) {
  return (pairs ?? [])
    .filter((p) => p.chainId === 'solana' && p.baseToken?.address === mint)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0) || (b.volume?.h1 ?? 0) - (a.volume?.h1 ?? 0))[0];
}

// Mercado de muchos tokens a la vez (30 por consulta).
export async function marketBatch(mints) {
  const out = new Map();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const pairs = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`, { minGapMs: 250 });
    for (const m of chunk) { const p = bestPair(pairs, m); if (p) out.set(m, p); }
  }
  return out;
}

export async function security(mint, cfg) {
  const r = await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { minGapMs: cfg.rugcheckEverySec * 1000, timeoutMs: 30000 });
  if (!r) return { ok: false, reason: 'sin datos de RugCheck' };
  const fails = [];
  if (cfg.requireMintRevoked && (r.mintAuthority ?? r.token?.mintAuthority)) fails.push('mint no revocado');
  if (cfg.requireFreezeRevoked && (r.freezeAuthority ?? r.token?.freezeAuthority)) fails.push('freeze no revocado');

  // LP: el mercado con más liquidez
  const markets = (r.markets ?? []).filter((m) => m.lp).sort((a, b) => (b.lp.lpLockedUSD ?? 0) + (b.lp.quoteUSD ?? 0) - ((a.lp.lpLockedUSD ?? 0) + (a.lp.quoteUSD ?? 0)));
  const lpLocked = markets[0]?.lp?.lpLockedPct ?? 0;
  if (lpLocked < cfg.minLpLockedPct) fails.push(`LP no bloqueado (${lpLocked.toFixed(0)} %)`);

  // Top 10 sin pools/AMM/curva
  const known = r.knownAccounts ?? {};
  const isPool = (h) => known[h.owner]?.type === 'AMM' || known[h.address]?.type === 'AMM' || /pool|curve|amm/i.test(known[h.owner]?.name ?? '')
    || (r.markets ?? []).some((m) => m.pubkey === h.owner || m.liquidityA === h.address || m.liquidityB === h.address);
  const top10 = (r.topHolders ?? []).filter((h) => !isPool(h)).slice(0, 10).reduce((a, h) => a + (h.pct ?? 0), 0);
  if (top10 > cfg.maxTop10Pct) fails.push(`top 10 holders ${top10.toFixed(1)} %`);

  // Dev con historial de rugs
  const rugRisks = (r.risks ?? []).filter((x) => RUG_WORDS.test(`${x.name} ${x.description ?? ''}`));
  if (r.rugged) fails.push('token marcado como rug');
  if (rugRisks.length) fails.push(`dev vinculado a rugs (${rugRisks.map((x) => x.name).join(', ')})`);

  return {
    ok: fails.length === 0, reason: fails.join(' · '), top10, lpLocked,
    holders: r.totalHolders ?? 0, risks: (r.risks ?? []).map((x) => x.name), symbol: r.tokenMeta?.symbol,
  };
}
