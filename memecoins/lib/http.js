// fetch JSON con reintentos y un limitador de ritmo por host.
const nextSlot = new Map();

export async function getJson(url, { minGapMs = 0, tries = 4, timeoutMs = 15000 } = {}) {
  const host = new URL(url).host;
  if (minGapMs) {
    const now = Date.now(), at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + minGapMs);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
  for (let k = 0; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (k >= tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 800 * 2 ** k));
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
