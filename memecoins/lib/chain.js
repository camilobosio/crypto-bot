// Precio directo de la blockchain (Solana RPC) para pools de PumpSwap.
// Lee las reservas del pool (token / SOL) y calcula el precio y la liquidez al instante,
// sin la demora de DexScreener. Verificado contra DexScreener el 12/11/2026 (diferencia < 1 %).
const RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
export const PUMPSWAP_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL = 'So11111111111111111111111111111111111111112';
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58(u) {
  let n = 0n;
  for (const x of u) n = n * 256n + BigInt(x);
  let s = '';
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const x of u) { if (x) break; s = '1' + s; }
  return s;
}

let rpcIdx = 0;
export async function rpc(method, params) {
  let last;
  for (let k = 0; k < RPCS.length * 2; k++) {
    const url = RPCS[(rpcIdx + k) % RPCS.length];
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(6000),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      rpcIdx = (rpcIdx + k) % RPCS.length; // se queda con el que anduvo
      return j.result;
    } catch (e) { last = e; }
  }
  throw last;
}

// Cuentas del pool (se leen una sola vez y se guardan en la posición).
// Estructura del Pool de PumpSwap: 8 discriminador + 1 bump + 2 index + 32 creator,
// base_mint @43, quote_mint @75, lp_mint @107, pool_base_token_account @139, pool_quote_token_account @171.
export async function poolInfo(pairAddress) {
  const r = await rpc('getAccountInfo', [pairAddress, { encoding: 'base64' }]);
  const v = r?.value;
  if (!v || v.owner !== PUMPSWAP_PROGRAM) return null;
  const b = Buffer.from(v.data[0], 'base64');
  const k = (o) => b58(b.subarray(o, o + 32));
  const baseMint = k(43), quoteMint = k(75);
  if (baseMint !== WSOL && quoteMint !== WSOL) return null;
  return { baseMint, quoteMint, baseVault: k(139), quoteVault: k(171), solIsBase: baseMint === WSOL };
}

// Precio (en SOL por token) y SOL en el pool para muchas posiciones a la vez.
// pools: [{ key, info }] → Map(key → { priceSol, solReserve })
export async function readPools(pools) {
  const out = new Map();
  const accs = pools.flatMap((p) => [p.info.baseVault, p.info.quoteVault]);
  for (let i = 0; i < accs.length; i += 100) {
    const r = await rpc('getMultipleAccounts', [accs.slice(i, i + 100), { encoding: 'jsonParsed' }]);
    (r?.value ?? []).forEach((v, j) => { accs[i + j] = { addr: accs[i + j], amt: v?.data?.parsed?.info?.tokenAmount?.uiAmount ?? null }; });
  }
  pools.forEach((p, i) => {
    const base = accs[2 * i]?.amt, quote = accs[2 * i + 1]?.amt;
    if (base == null || quote == null) return;
    const [tok, sol] = p.info.solIsBase ? [quote, base] : [base, quote];
    out.set(p.key, { priceSol: tok > 0 ? sol / tok : 0, solReserve: sol });
  });
  return out;
}
