// Trading Lab — utilidades compartidas de los paneles
(() => {
  const REPO = 'camilobosio/crypto-bot';
  const qs = new URLSearchParams(location.search);

  // Lee el JSON en vivo de la rama de datos. ?src=ruta permite probar con un archivo local.
  async function loadLive(branch) {
    if (qs.get('src')) return (await fetch(qs.get('src') + '?t=' + Date.now(), { cache: 'no-store' })).json();
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/live.json?ref=${branch}`, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch {}
    return (await fetch(`https://raw.githubusercontent.com/${REPO}/${branch}/live.json?t=${Date.now()}`, { cache: 'no-store' })).json();
  }

  const AR = -3 * 36e5; // hora Argentina
  const f = {
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    time: (t) => new Date(t + AR).toISOString().slice(11, 16),
    timeS: (t) => new Date(t + AR).toISOString().slice(11, 19),
    dt: (t) => { const d = new Date(t + AR).toISOString(); return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`; },
    money: (x, d = 2) => (x < 0 ? '−' : '') + Math.abs(x).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }),
    signed: (x, d = 2) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }),
    pct: (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %',
    price: (x) => { x = +x; if (!isFinite(x)) return '—'; if (x >= 1000) return x.toLocaleString('es-AR', { maximumFractionDigits: 1 }); if (x >= 1) return x.toLocaleString('es-AR', { maximumFractionDigits: 4 }); return x.toPrecision(4); },
    cls: (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : 'muted'),
    ago: (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${(s / 3600).toFixed(1)} h`; },
    dur: (ms) => { const h = ms / 36e5; return h < 1 ? `${Math.round(ms / 6e4)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} días`; },
  };

  // Gráfico de área con tooltip. pts: [{t, e}]
  function areaChart(el, pts, { baseline, unit = '' } = {}) {
    if (!pts || pts.length < 2) { el.innerHTML = '<div class="empty">La curva aparece después de los primeros minutos de operación.</div>'; return; }
    const W = 800, H = 260, P = { l: 52, r: 12, t: 14, b: 26 };
    const ts = pts.map((p) => p.t), vs = pts.map((p) => p.e).concat(baseline != null ? [baseline] : []);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    let y0 = Math.min(...vs), y1 = Math.max(...vs); const pad = (y1 - y0) * 0.12 || Math.max(1, y1 * 0.01); y0 -= pad; y1 += pad;
    const X = (t) => P.l + ((t - t0) / (t1 - t0 || 1)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
    const last = pts.at(-1).e, up = baseline == null ? last >= pts[0].e : last >= baseline;
    const col = up ? 'var(--green)' : 'var(--red)';
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.e).toFixed(1)}`).join('');
    const area = `${line}L${X(t1).toFixed(1)},${H - P.b}L${X(t0).toFixed(1)},${H - P.b}Z`;
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    let grid = '';
    for (let k = 0; k <= 4; k++) { const v = y0 + ((y1 - y0) * k) / 4; grid += `<line class="gl" x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(v < 10 ? 2 : 1)}</text>`; }
    for (let k = 0; k <= 4; k++) { const t = t0 + ((t1 - t0) * k) / 4; grid += `<text class="ax" x="${X(t)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}">${(t1 - t0) > 864e5 ? f.dt(t) : f.time(t)}</text>`; }
    const base = baseline != null ? `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(baseline)}" y2="${Y(baseline)}" stroke="var(--faint)" stroke-dasharray="4 5"/>` : '';
    el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${grid}${base}<path d="${area}" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
      <line class="hl" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" stroke="var(--faint)" opacity="0"/><circle class="hp" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2" opacity="0"/>
      <rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent"/></svg><div class="tip"></div></div>`;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hl = el.querySelector('.hl'), hp = el.querySelector('.hp');
    const move = (cx) => {
      const r = svg.getBoundingClientRect(), x = ((cx - r.left) / r.width) * W;
      const t = t0 + ((x - P.l) / (W - P.l - P.r)) * (t1 - t0);
      let best = pts[0]; for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      const px = X(best.t), py = Y(best.e);
      hl.setAttribute('x1', px); hl.setAttribute('x2', px); hl.setAttribute('opacity', 1);
      hp.setAttribute('cx', px); hp.setAttribute('cy', py); hp.setAttribute('opacity', 1);
      tip.style.left = (px / W) * r.width + 'px'; tip.style.top = (py / H) * r.height + 'px'; tip.style.opacity = 1;
      tip.textContent = `${f.money(best.e)} ${unit} · ${f.dt(best.t)}`;
    };
    const hide = () => { tip.style.opacity = 0; hl.setAttribute('opacity', 0); hp.setAttribute('opacity', 0); };
    svg.addEventListener('mousemove', (e) => move(e.clientX));
    svg.addEventListener('touchmove', (e) => move(e.touches[0].clientX), { passive: true });
    svg.addEventListener('mouseleave', hide); svg.addEventListener('touchend', hide);
  }

  function setStatus(el, updatedAt) {
    const fresh = Date.now() - updatedAt < 5 * 6e4;
    el.className = 'pill ' + (fresh ? 'live' : 'warn');
    el.innerHTML = `<span class="dot"></span>${fresh ? 'En vivo' : 'Sin datos nuevos'} · ${f.ago(updatedAt)}`;
  }

  function startLoop(branch, render, statusEl, everyMs = 90_000) {
    let lastAt = 0;
    const tick = async () => {
      try { const L = await loadLive(branch); lastAt = L.updatedAt; render(L); setStatus(statusEl, lastAt); }
      catch { statusEl.className = 'pill warn'; statusEl.innerHTML = '<span class="dot"></span>Reintentando…'; }
    };
    tick();
    setInterval(tick, everyMs);
    setInterval(() => lastAt && setStatus(statusEl, lastAt), 15_000);
  }

  // Bloque superior idéntico en los dos paneles.
  // m: { equity, capital, unit, cash, open, maxOpen, closed, wins, startedAt, updatedAt, state: 'ok'|'pause'|'stop', stateText }
  function hero(m) {
    const pnl = m.equity - m.capital;
    document.getElementById('equity').innerHTML = `${f.money(m.equity)}<small>${m.unit}</small>`;
    document.getElementById('pnlchip').innerHTML = `<span class="chip ${pnl >= 0 ? 'b-green' : 'b-red'}">${pnl >= 0 ? '▲' : '▼'} ${f.signed(pnl)} ${m.unit} · ${f.pct(pnl / m.capital, 2)}</span> <span class="sub">desde ${m.capital} ${m.unit}</span>`;
    const k = (l, v, s = '', c = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
    const badge = m.state === 'ok' ? '<span class="badge b-green">OPERANDO</span>' : m.state === 'pause' ? '<span class="badge b-amber">PAUSA</span>' : '<span class="badge b-red">DETENIDO</span>';
    document.getElementById('kpis').innerHTML =
      k('Resultado', f.signed(pnl) + ' ' + m.unit, f.pct(pnl / m.capital, 2), f.cls(pnl)) +
      k('Disponible', f.money(m.cash) + ' ' + m.unit, 'libre para operar') +
      k('Estado', badge, m.stateText) +
      k('Abiertas', `${m.open} / ${m.maxOpen}`, 'posiciones ahora') +
      k('Cerradas', m.closed, m.closed ? `${Math.round((m.wins / m.closed) * 100)} % ganadoras` : 'todavía ninguna') +
      k('Corriendo', f.dur(m.updatedAt - m.startedAt), 'desde ' + f.dt(m.startedAt));
  }

  // Historial de operaciones: abiertas primero, después las cerradas (más nuevas arriba).
  // r: { name, side, sideCls, entryT, entry, exitT, exit, size, pnl, pct, reason, open }
  function history(rows, unit) {
    const el = document.getElementById('history');
    const nOpen = rows.filter((r) => r.open).length, closed = rows.filter((r) => !r.open);
    const wins = closed.filter((r) => r.pnl > 0).length, total = closed.reduce((a, r) => a + r.pnl, 0);
    document.getElementById('histcount').innerHTML = rows.length
      ? `${nOpen} abiertas · ${closed.length} cerradas${closed.length ? ` · ${Math.round((wins / closed.length) * 100)} % ganadoras · <b class="${f.cls(total)}">${f.signed(total)} ${unit}</b>` : ''}`
      : '';
    if (!rows.length) { el.innerHTML = '<div class="empty">Todavía no hubo operaciones. Apenas el bot compre algo, aparece acá con su precio de entrada, de salida y el resultado.</div>'; return; }
    el.innerHTML = `<div class="tbl-wrap"><table class="hist"><thead><tr><th>Estado</th><th>Activo</th><th>Lado</th><th>Compra / entrada</th><th class="num">Precio</th><th>Venta / salida</th><th class="num">Precio</th><th class="num">Monto</th><th class="num">Resultado</th><th>Motivo</th></tr></thead><tbody>${
      rows.map((r) => `<tr class="${r.open ? 'row-open' : ''}">
        <td>${r.open ? '<span class="badge b-accent">ABIERTA</span>' : r.pnl >= 0 ? '<span class="badge b-green">GANADA</span>' : '<span class="badge b-red">PERDIDA</span>'}</td>
        <td class="sym">${f.esc(r.name)}</td>
        <td><span class="badge ${r.sideCls}">${f.esc(r.side)}</span></td>
        <td class="muted">${f.dt(r.entryT)}</td><td class="num mono">${f.price(r.entry)}</td>
        <td class="muted">${r.open ? 'en curso' : f.dt(r.exitT)}</td><td class="num mono">${f.price(r.exit)}${r.open ? ' <span class="muted">ahora</span>' : ''}</td>
        <td class="num">${f.money(r.size)}</td>
        <td class="num ${f.cls(r.pnl)}"><b>${f.signed(r.pnl)}</b> <span class="muted">${f.pct(r.pct)}</span></td>
        <td class="reason-cell">${f.esc(r.reason)}</td></tr>`).join('')
    }</tbody></table></div>`;
  }

  window.UI = { loadLive, f, areaChart, setStatus, startLoop, hero, history };
})();
