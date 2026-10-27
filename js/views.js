/* ==========================================================================
   Compare and Concepts views, then start-up.
   ========================================================================== */
const MOTOR = { T: 2.5, n: 3000, J: 2.0 }; // example frameless motor: peak N·m, max rpm, rotor kg·cm²
let ratioSel = store.get('ratio', 6);
const RMIN = 1, RMAX = 300;
const lx = (i, x0, w) => x0 + Math.log10(i / RMIN) / Math.log10(RMAX / RMIN) * w;
const ratioFromX = (x, x0, w) => clamp(RMIN * Math.pow(RMAX / RMIN, (x - x0) / w), RMIN, RMAX);
const sliderToRatio = v => Math.round(RMIN * Math.pow(RMAX / RMIN, v / 1000) * 10) / 10;
const ratioToSlider = r => Math.round(Math.log10(r / RMIN) / Math.log10(RMAX / RMIN) * 1000);
function niceTicks(max, n = 4) {
  const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const out = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(v); return out;
}
const kfmt = v => v >= 1e6 ? fmt(v / 1e6, v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? fmt(v / 1000, v % 1000 ? 1 : 0) + 'k' : fmt(v, v < 10 && v % 1 ? 1 : 0);

function renderCompare() {
  const root = $('#compare-root');
  root.innerHTML = `
    <div class="doc-head">
      <div class="doc-kicker">Compare</div>
      <h2 class="doc-title">The gear ratio decides almost everything</h2>
      <p class="doc-lede">Every rotary actuator here is a motor plus a reduction. Torque goes up with the ratio i, speed goes down with i, and the rotor inertia you feel at the output goes up with i². Drag across any chart.</p>
    </div>
    <section class="block" aria-labelledby="ratio-h">
      <div class="block-title" id="ratio-h">One motor, any ratio</div>
      <div class="block-sub">Example motor: ${MOTOR.T} N·m peak, ${fmt(MOTOR.n)} rpm, rotor inertia ${MOTOR.J} kg·cm². Losses ignored so the scaling is clear.</div>
      <div class="ratio-ctl">
        <label for="ratio-rng" class="ctl-label" style="font-size:12.5px;color:var(--ink-2)">Gear ratio</label>
        <input type="range" id="ratio-rng" min="0" max="1000" value="${ratioToSlider(ratioSel)}">
        <span class="ratio-readout" id="ratio-read"></span>
      </div>
      <div class="bands" id="bands"></div>
      <div class="multiples">
        <div class="multiple"><div class="multiple-title">Output torque</div><div class="multiple-val" id="mv-t"></div><div id="mc-t"></div></div>
        <div class="multiple"><div class="multiple-title">Output speed</div><div class="multiple-val" id="mv-n"></div><div id="mc-n"></div></div>
        <div class="multiple"><div class="multiple-title">Reflected rotor inertia</div><div class="multiple-val" id="mv-j"></div><div id="mc-j"></div></div>
      </div>
      <details style="margin-top:14px"><summary style="cursor:pointer;font-size:12.5px;color:var(--ink-2)">Show as table</summary>
        <div class="table-wrap"><table class="cmp" style="min-width:520px"><thead><tr><th>Ratio</th><th>Torque (N·m)</th><th>Speed (rpm)</th><th>Reflected inertia (kg·cm²)</th></tr></thead>
        <tbody>${[1, 3, 6, 10, 30, 50, 100, 160, 300].map(i => `<tr><td class="num">${i}:1</td><td class="num">${fmt(MOTOR.T * i, 1)}</td><td class="num">${fmt(MOTOR.n / i, 1)}</td><td class="num">${fmt(MOTOR.J * i * i)}</td></tr>`).join('')}</tbody></table></div>
      </details>
    </section>
    <section class="block" aria-labelledby="cmp-h">
      <div class="block-title" id="cmp-h">Side by side</div>
      <div class="block-sub">Typical catalogue ranges. Ratings are relative, 1 to 5; for cost, 5 is most expensive. Click a row to open it in the Lab.</div>
      <div class="table-wrap"><table class="cmp">
        <thead><tr><th>Actuator</th><th>Ratio / output</th><th>Backlash</th><th>Efficiency</th><th>Backdrivable</th><th>Torque density</th><th>Shock tolerance</th><th>Precision</th><th>Cost</th><th>Where you see it</th></tr></thead>
        <tbody>${COMPARE.map(r => `<tr data-open="${r.id}" tabindex="0"><td class="name">${esc(r.name)}</td><td class="num">${esc(r.ratio)}</td><td class="num">${esc(r.backlash)}</td><td class="num">${esc(r.eff)}</td><td>${esc(r.back)}</td>
          ${['td', 'shock', 'prec', 'cost'].map(k => `<td><span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= r[k] ? 'on' : ''}"></i>`).join('')}</span><span class="meter-n">${r[k]}/5</span></td>`).join('')}
          <td>${esc(r.where)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="block" aria-labelledby="guide-h">
      <div class="block-title" id="guide-h">Picking one</div>
      <div class="block-sub">Start from the job, not the hardware.</div>
      <div class="guide">${GUIDE.map(g => `<div class="guide-item"><div class="guide-need">${esc(g.need)}</div><div class="guide-pick">${esc(g.pick)}</div><div class="guide-why">${esc(g.why)}</div><button class="link-btn" data-open="${g.id}" style="margin-top:8px">Open in Lab</button></div>`).join('')}</div>
    </section>`;
  $('#ratio-rng').addEventListener('input', e => { ratioSel = sliderToRatio(Number(e.target.value)); store.set('ratio', ratioSel); renderRatioChart(); });
  root.addEventListener('click', e => { const t = e.target.closest('[data-open]'); if (t) openInLab(t.dataset.open); });
  root.addEventListener('keydown', e => { if (e.key === 'Enter') { const t = e.target.closest('tr[data-open]'); if (t) openInLab(t.dataset.open); } });
}

function renderRatioChart() {
  const bandsEl = $('#bands'); if (!bandsEl || $('#view-compare').hidden) return;
  const i = ratioSel;
  $('#ratio-read').textContent = `${fmt(i, i < 10 ? 1 : 0)} : 1`;
  $('#ratio-rng').value = ratioToSlider(i);
  // Bands on the same log scale as the slider
  const BW = Math.max(300, bandsEl.clientWidth), ml = 150, mr = 14, pw = BW - ml - mr, rh = 20;
  const H = BANDS.length * rh + 26;
  const ticks = [1, 3, 10, 30, 100, 300];
  let s = `<svg viewBox="0 0 ${BW} ${H}" width="${BW}" height="${H}" role="img" aria-label="Typical ratio ranges by actuator type on a logarithmic scale">`;
  ticks.forEach(t => { const x = lx(t, ml, pw); s += `<line class="grid-l" x1="${x}" x2="${x}" y1="0" y2="${H - 18}"/><text class="axis-t" x="${x}" y="${H - 4}" text-anchor="middle">${t}:1</text>`; });
  BANDS.forEach((b, k) => {
    const y = k * rh + 4, x1 = lx(b.lo, ml, pw), x2 = Math.max(lx(b.hi, ml, pw), x1 + 6), on = i >= b.lo && i <= b.hi;
    s += `<g data-band="${k}" style="cursor:pointer"><rect x="0" y="${y - 2}" width="${BW}" height="${rh}" fill="transparent"/>
      <text x="${ml - 10}" y="${y + 11}" text-anchor="end" style="font-size:12px;fill:${on ? 'var(--ink)' : 'var(--ink-2)'};font-weight:${on ? 600 : 400}">${esc(b.label)}</text>
      <rect x="${x1}" y="${y + 3}" width="${x2 - x1}" height="10" rx="4" fill="${on ? 'var(--chart-line)' : 'var(--role-fixed)'}" opacity="${on ? 1 : 0.45}"/></g>`;
  });
  const xs = lx(i, ml, pw);
  s += `<line x1="${xs}" x2="${xs}" y1="0" y2="${H - 18}" stroke="var(--ink)" stroke-width="1.5"/></svg>`;
  bandsEl.innerHTML = s;
  $$('[data-band]', bandsEl).forEach(g => g.addEventListener('click', () => { const b = BANDS[+g.dataset.band]; ratioSel = Math.round(Math.sqrt(b.lo * b.hi) * 10) / 10; store.set('ratio', ratioSel); renderRatioChart(); }));
  // Small multiples
  const mk = (host, valEl, f, opts) => {
    const el = $(host), Wd = Math.max(220, el.clientWidth), Ht = 150, l = 46, r = 10, t = 8, b = 22, w = Wd - l - r, h = Ht - t - b;
    const pts = []; for (let k = 0; k <= 120; k++) { const ii = RMIN * Math.pow(RMAX / RMIN, k / 120); pts.push([ii, f(ii)]); }
    let y;
    let gy = '';
    if (opts.log) {
      const lo = opts.lo, hi = opts.hi;
      y = v => t + h - (Math.log10(v / lo) / Math.log10(hi / lo)) * h;
      for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) { const v = Math.pow(10, e), yy = y(v); gy += `<line class="grid-l" x1="${l}" x2="${l + w}" y1="${yy}" y2="${yy}"/><text class="axis-t" x="${l - 6}" y="${yy + 3}" text-anchor="end">${kfmt(v)}</text>`; }
    } else {
      const tk = niceTicks(opts.max); const top = tk[tk.length - 1];
      y = v => t + h - v / top * h;
      tk.forEach(v => { const yy = y(v); gy += `<line class="${v === 0 ? 'axis-l' : 'grid-l'}" x1="${l}" x2="${l + w}" y1="${yy}" y2="${yy}"/><text class="axis-t" x="${l - 6}" y="${yy + 3}" text-anchor="end">${kfmt(v)}</text>`; });
    }
    const X = ii => lx(ii, l, w);
    const line = pts.map(([ii, v], k) => `${k ? 'L' : 'M'}${X(ii).toFixed(1)} ${y(v).toFixed(1)}`).join('');
    const area = opts.log ? '' : `<path d="${line}L${X(RMAX).toFixed(1)} ${y(0)}L${X(RMIN).toFixed(1)} ${y(0)}Z" fill="var(--chart-wash)"/>`;
    const xt = ticks.map(tv => `<text class="axis-t" x="${X(tv)}" y="${Ht - 6}" text-anchor="middle">${tv}</text>`).join('');
    const cx = X(i), cy = y(f(i));
    el.innerHTML = `<svg viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="${opts.aria}" style="touch-action:pan-y">
      ${gy}${area}<path d="${line}" fill="none" stroke="var(--chart-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${cx}" x2="${cx}" y1="${t}" y2="${t + h}" stroke="var(--ink-3)" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="var(--surface)"/><circle cx="${cx}" cy="${cy}" r="4" fill="var(--chart-line)"/>
      ${xt}<rect class="hit" x="${l}" y="0" width="${w}" height="${Ht}" fill="transparent" style="cursor:crosshair"/></svg>`;
    $(valEl).textContent = opts.val(f(i));
    const hit = $('.hit', el);
    const move = e => { const rc = el.querySelector('svg').getBoundingClientRect(); const x = (e.clientX - rc.left) * (Wd / rc.width); ratioSel = Math.round(ratioFromX(x, l, w) * 10) / 10; store.set('ratio', ratioSel); renderRatioChart(); };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
  };
  mk('#mc-t', '#mv-t', ii => MOTOR.T * ii, { max: MOTOR.T * RMAX, val: v => `${fmtS(v)} N·m`, aria: 'Output torque rises linearly with ratio' });
  mk('#mc-n', '#mv-n', ii => MOTOR.n / ii, { max: MOTOR.n, val: v => `${fmtS(v)} rpm`, aria: 'Output speed falls as one over ratio' });
  mk('#mc-j', '#mv-j', ii => MOTOR.J * ii * ii, { log: true, lo: 1, hi: 1e6, val: v => `${fmt(v)} kg·cm²`, aria: 'Reflected inertia rises with the square of ratio' });
}

function renderConcepts() {
  $('#concepts-root').innerHTML = `
    <div class="doc-head">
      <div class="doc-kicker">Concepts</div>
      <h2 class="doc-title">The vocabulary of motion</h2>
      <p class="doc-lede">Sixteen ideas cover nearly every actuator datasheet. Each links to the mechanism where you can see it move.</p>
    </div>
    <div class="gloss">${GLOSSARY.map(g => `<article class="term"><div class="term-name">${esc(g.term)}</div><div class="term-f">${esc(g.f)}</div><p class="term-d" style="margin:0">${esc(g.d)}</p>
      <div class="term-see">See it in ${g.see.map(id => `<button class="link-btn" data-open="${id}">${esc(INFO[id].name)}</button>`).join('')}</div></article>`).join('')}</div>`;
  $('#concepts-root').addEventListener('click', e => { const t = e.target.closest('[data-open]'); if (t) openInLab(t.dataset.open); });
}

/* ---------- Start ---------- */
(function init() {
  renderRail();
  if (stage.clientWidth && stage.clientWidth < 600) { state.labels = false; $('#btn-labels').setAttribute('aria-pressed', 'false'); }
  renderCompare();
  renderConcepts();
  const hash = (location.hash || '').replace('#', '');
  const start = MECHS[hash] ? hash : store.get('mech', 'qdd');
  loadMech(start);
  const v = MECHS[hash] ? 'lab' : store.get('view', 'lab');
  setView(['lab', 'compare', 'concepts'].includes(v) ? v : 'lab');
  resize();
  requestAnimationFrame(frame);
  const onTheme = () => { setPitchColor(); renderRatioChart(); };
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme); } catch (e) { /* old Safari */ }
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', () => { if (state.view === 'compare') renderRatioChart(); });
  window.addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (MECHS[h] && h !== state.mech) openInLab(h); });
})();
