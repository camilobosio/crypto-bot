// Estrategia del video de TraderMaine (ICT simplificado), traducida a reglas mecánicas.
// Notas completas en el proyecto: claude/estrategia-video-smc.md
//
// Temporalidad alta (HTF, 1h o 4h): estructura con swings de 3 velas y quiebres por CIERRE.
//   - Tendencia alcista: al cerrar arriba del máximo del rango (MSB) arranca un tramo nuevo.
//     Rango = mínimo significativo antes del quiebre → máximo del tramo. Mitad = 50 %.
//   - Si cierra debajo del mínimo del rango: cambio de estructura (MSS), la tendencia pasa a bajista.
//   - Zona (PDA): order block (velas bajistas antes del impulso) o FVG del impulso, en DESCUENTO
//     (debajo del 50 %). Si hay varias, la más profunda. Bonus si toca la OTE (61,8-78,6 %).
// Entrada:
//   mode 'htf': orden límite en el borde de la zona, stop debajo del mínimo del rango.
//   mode 'ltf': cuando el precio tocó la zona, en la temporalidad baja (5m o 15m) se espera el
//               "breaker": mínimo → máximo → rompe ese mínimo → cierra arriba de ese máximo (MSS).
//               Orden límite en el breaker, stop debajo del mínimo barrido.
// Modo giro (onlyReversal): solo opera el PRIMER tramo después de un cambio de estructura (MSS) que
// llega tras una tendencia de al menos minPrevLegs tramos para el otro lado. Ej.: después de varios
// mínimos decrecientes, el precio cierra arriba del último máximo → busca el largo en el retroceso.
// Objetivo: la liquidez externa (máximo del rango), si da al menos minRR; si no, no opera.
// Bajista: todo al revés.
// Todo se calcula vela por vela con datos ya cerrados (sin mirar el futuro).

import { trendScore } from './strategies.js';

const LTF_OF = { '1h': '5m', '4h': '15m' };

// Estado de la temporalidad alta, una fila por vela HTF cerrada.
function htfStates(B, p) {
  const { o, h, l, c, a } = B, n = c.length;
  const S = {
    tr: new Int8Array(n), lo: new Float64Array(n).fill(NaN), hi: new Float64Array(n).fill(NaN),
    zLo: new Float64Array(n).fill(NaN), zHi: new Float64Array(n).fill(NaN), ote: new Uint8Array(n),
    pull: new Uint8Array(n), id: new Int32Array(n), atr: a, flip: new Uint8Array(n),
  };
  let tr = 0, lo = NaN, hi = NaN, loI = -1, hiI = -1, brk = -1, extConf = false, id = 0;
  let legsSame = 0, isFlip = false;
  let lastSH = null, lastSL = null; // swings de 3 velas confirmados (para arrancar)
  let zones = [];

  const findZones = (dir, from, to) => {
    // from = índice del extremo de donde salió el impulso, to = vela del quiebre
    const zs = [];
    // Order block: velas en contra (consecutivas se combinan) que terminan en el extremo o justo antes.
    let k = from;
    while (k > from - 4 && k >= 0 && !(dir === 1 ? c[k] < o[k] : c[k] > o[k])) k--;
    if (k >= 0 && k > from - 4) {
      let a0 = k;
      while (a0 - 1 >= 0 && (dir === 1 ? c[a0 - 1] < o[a0 - 1] : c[a0 - 1] > o[a0 - 1]) && k - a0 < 3) a0--;
      let zl = Infinity, zh = -Infinity;
      for (let q = a0; q <= k; q++) { zl = Math.min(zl, l[q]); zh = Math.max(zh, h[q]); }
      zs.push([zl, zh]);
    }
    // FVG del impulso (3 velas): alcista si máximo(k-1) < mínimo(k+1).
    for (let q = from + 1; q < to; q++) {
      if (q - 1 < 0 || q + 1 > to) continue;
      if (dir === 1 && h[q - 1] < l[q + 1]) zs.push([h[q - 1], l[q + 1]]);
      if (dir === -1 && l[q - 1] > h[q + 1]) zs.push([h[q + 1], l[q - 1]]);
    }
    return zs;
  };

  for (let j = 0; j < n; j++) {
    // swing de 3 velas en j-1, confirmado al cierre de j
    if (j >= 2) {
      const m = j - 1;
      if (h[m] > h[m - 1] && h[m] >= h[j]) lastSH = { px: h[m], i: m };
      if (l[m] < l[m - 1] && l[m] <= l[j]) lastSL = { px: l[m], i: m };
    }
    const newLeg = (dir) => {
      // dir=1: quiebre alcista en j. Mínimo significativo: el más bajo desde el último extremo opuesto.
      const start = dir === 1 ? (tr === 1 ? hiI : lastSH ? lastSH.i : Math.max(0, j - 20)) : (tr === -1 ? loI : lastSL ? lastSL.i : Math.max(0, j - 20));
      let ex = dir === 1 ? Infinity : -Infinity, exI = start;
      for (let q = Math.max(0, start); q <= j; q++) {
        if (dir === 1 ? l[q] < ex : h[q] > ex) { ex = dir === 1 ? l[q] : h[q]; exI = q; }
      }
      if (tr === dir) { legsSame++; isFlip = false; } else { isFlip = tr !== 0 && legsSame >= (p.minPrevLegs ?? 3); legsSame = 1; }
      tr = dir; brk = j; id++; extConf = false;
      if (dir === 1) { lo = ex; loI = exI; hi = h[j]; hiI = j; } else { hi = ex; hiI = exI; lo = l[j]; loI = j; }
      zones = findZones(dir, exI, j);
    };

    if (tr === 0) {
      if (lastSH && c[j] > lastSH.px) newLeg(1);
      else if (lastSL && c[j] < lastSL.px) newLeg(-1);
    } else if (tr === 1) {
      if (c[j] < lo) newLeg(-1);                                   // MSS bajista
      else if (extConf && c[j] > hi) newLeg(1);                    // MSB alcista: tramo nuevo
      else if (!extConf) {
        if (h[j] > hi) { hi = h[j]; hiI = j; }
        if (j - 1 > brk && h[j - 1] >= hi && h[j] < h[j - 1]) extConf = true; // arrancó el retroceso
        else if (j > hiI) extConf = true;
      }
    } else {
      if (c[j] > hi) newLeg(1);
      else if (extConf && c[j] < lo) newLeg(-1);
      else if (!extConf) {
        if (l[j] < lo) { lo = l[j]; loI = j; }
        if (j > loI) extConf = true;
      }
    }

    S.flip[j] = isFlip ? 1 : 0;
    S.tr[j] = tr; S.lo[j] = lo; S.hi[j] = hi; S.id[j] = id; S.pull[j] = extConf ? 1 : 0;
    if (tr !== 0 && hi - lo >= p.sigAtr * a[j]) {
      const rng = hi - lo, mid = lo + rng / 2;
      const oteA = tr === 1 ? hi - 0.786 * rng : lo + 0.618 * rng, oteB = tr === 1 ? hi - 0.618 * rng : lo + 0.786 * rng;
      let best = null;
      for (const [zl, zh] of zones) {
        const inside = tr === 1 ? zh <= mid && zl >= lo : zl >= mid && zh <= hi; // en descuento / premium
        if (!inside) continue;
        if (!best || (tr === 1 ? zh < best[1] : zl > best[0])) best = [zl, zh];
      }
      if (best) {
        S.zLo[j] = best[0]; S.zHi[j] = best[1];
        S.ote[j] = best[1] >= oteA && best[0] <= oteB ? 1 : 0;
      }
    }
  }
  return S;
}

// Breaker en la temporalidad baja: eventos de cambio de estructura con su zona de entrada.
function ltfBreakers(B) {
  const { o, h, l, c } = B, n = c.length;
  const E = { side: new Int8Array(n), limit: new Float64Array(n), stop: new Float64Array(n) };
  const SH = [], SL = []; // swings de 3 velas confirmados
  let usedH = -1, usedL = -1;
  for (let k = 2; k < n; k++) {
    const m = k - 1;
    if (h[m] > h[m - 1] && h[m] >= h[k]) SH.push(m);
    if (l[m] < l[m - 1] && l[m] <= l[k]) SL.push(m);
    // Alcista: último máximo H1 (con un mínimo L1 antes), después se rompió L1, y ahora cierra arriba de H1.
    const hI = SH.at(-1);
    if (hI != null && hI !== usedH && c[k] > h[hI] && c[k - 1] <= h[hI]) {
      const l1 = SL.filter((q) => q < hI).at(-1);
      if (l1 != null) {
        let sweep = Infinity;
        for (let q = hI + 1; q <= k; q++) sweep = Math.min(sweep, l[q]);
        if (sweep < l[l1]) {
          // breaker: velas alcistas que formaron H1
          let top = -Infinity;
          for (let q = hI; q >= Math.max(hI - 3, 0) && c[q] >= o[q]; q--) top = Math.max(top, Math.max(o[q], c[q]));
          if (!Number.isFinite(top)) top = Math.max(o[hI], c[hI]);
          E.side[k] = 1; E.limit[k] = Math.min(top, c[k]); E.stop[k] = sweep; usedH = hI;
        }
      }
    }
    const lI = SL.at(-1);
    if (lI != null && lI !== usedL && c[k] < l[lI] && c[k - 1] >= l[lI]) {
      const h1 = SH.filter((q) => q < lI).at(-1);
      if (h1 != null) {
        let sweep = -Infinity;
        for (let q = lI + 1; q <= k; q++) sweep = Math.max(sweep, h[q]);
        if (sweep > h[h1]) {
          let bot = Infinity;
          for (let q = lI; q >= Math.max(lI - 3, 0) && c[q] <= o[q]; q--) bot = Math.min(bot, Math.min(o[q], c[q]));
          if (!Number.isFinite(bot)) bot = Math.min(o[lI], c[lI]);
          E.side[k] = -1; E.limit[k] = Math.max(bot, c[k]); E.stop[k] = sweep; usedL = lI;
        }
      }
    }
    if (SH.length > 50) SH.splice(0, 25);
    if (SL.length > 50) SL.splice(0, 25);
  }
  return E;
}

export const smc = {
  defaults: { htf: '1h', mode: 'ltf', sigAtr: 3, bufAtr: 0.1, minRR: 1.5, maxWait: 36, maxBars: 288 },
  grid: { htf: ['1h', '4h'], mode: ['ltf', 'htf'], minRR: [1.5, 2.5] },

  prepare(b, p) {
    const H = p.htf === '4h' ? b.h4 : b.h1;
    const S = htfStates(H, p);
    const ltfName = LTF_OF[p.htf];
    const L = ltfName === '5m' ? { i: Int32Array.from(b.c5, (_, q) => q), o: b.o5, h: b.h5, l: b.l5, c: b.c5 } : b.m15;
    const E = p.mode === 'ltf' ? ltfBreakers(L) : null;
    const n = b.c5.length;
    const sig = { side: new Int8Array(n), limit: new Float64Array(n), stop: new Float64Array(n), tp: new Float64Array(n), ote: new Uint8Array(n) };
    let tapped = -1; // id del rango cuya zona ya fue tocada
    for (let i = 1; i < n; i++) {
      const j = H.i[i];
      if (j < 0) continue;
      const tr = S.tr[j], zl = S.zLo[j], zh = S.zHi[j];
      if (!tr || Number.isNaN(zl) || !S.pull[j]) continue;
      if (p.onlyReversal && !S.flip[j]) continue;
      // ¿el precio entró a la zona? (5m, dentro del rango vigente)
      if (tr === 1 ? b.l5[i] <= zh && b.l5[i] >= S.lo[j] : b.h5[i] >= zl && b.h5[i] <= S.hi[j]) tapped = S.id[j];
      const tp = tr === 1 ? S.hi[j] : S.lo[j];
      const buf = p.bufAtr * S.atr[j];
      let side = 0, limit = NaN, stop = NaN;
      if (p.mode === 'htf') {
        if (tapped === S.id[j]) continue; // la zona ya se usó o ya pasó por ella
        if (tr === 1 && b.c5[i] > zh) { side = 1; limit = zh; stop = S.lo[j] - buf; }
        if (tr === -1 && b.c5[i] < zl) { side = -1; limit = zl; stop = S.hi[j] + buf; }
      } else {
        if (tapped !== S.id[j]) continue;
        const k = L.i[i];
        if (k < 0 || k === L.i[i - 1] || E.side[k] !== tr) continue; // solo cuando cierra una vela LTF con breaker
        side = tr; limit = E.limit[k]; stop = E.stop[k] - tr * buf;
        if (tr === 1 ? stop < S.lo[j] - buf : stop > S.hi[j] + buf) continue; // el barrido ya invalidó el rango HTF
      }
      if (!side) continue;
      const risk = side * (limit - stop), reward = side * (tp - limit);
      if (!(risk > 0) || reward / risk < p.minRR) continue;
      sig.side[i] = side; sig.limit[i] = limit; sig.stop[i] = stop; sig.tp[i] = tp; sig.ote[i] = S.ote[j];
    }
    return { ...b, smc: sig };
  },

  entry(x, i, p) {
    const s = x.smc;
    if (!s.side[i]) return null;
    const side = s.side[i];
    // Puntaje: tendencia en varias temporalidades + bonus si la zona está en la OTE.
    const score = Math.min(1, trendScore(x, i, side) * 0.85 + (s.ote[i] ? 0.15 : 0));
    return {
      side, stop: s.stop[i], tp: s.tp[i], tpR: 0, limit: s.limit[i], ref: s.limit[i], chase: false,
      maxWait: p.mode === 'htf' ? 288 : p.maxWait, score,
    };
  },

  manage(x, i, p, pos) {
    if (pos.barsHeld >= p.maxBars) return { exit: 'tiempo' };
    return null;
  },
};
