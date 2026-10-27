/* ==========================================================================
   Mechanisms. Each one: params, build(B, P) → { update(dt) }, calc(P).
   Rotary parts are modelled in XY with the axis on Z; flat assemblies then
   rotate the root so the axis points up.
   ========================================================================== */
const DEG = 180 / Math.PI;
const rpmParam = (v, max = 6000, label = 'Input speed') => ({ id: 'rpm', label, type: 'range', min: 0, max, step: 50, value: v, unit: 'rpm' });
const torqueParam = (v, max, step = 0.1, label = 'Input torque') => ({ id: 'torque', label, type: 'range', min: 0, max, step, value: v, unit: 'N·m', dec: step < 1 ? 1 : 0 });
const W = (T, rpm) => T * rpm * TAU / 60;
const dirTxt = rev => rev ? 'reversed' : 'same direction';
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

/* ---------- Shared builders ---------- */
function statorGeo(n, rCore, rRoot, rTip, stemW, tipT, tipFrac, h) {
  const pts = [], pitch = TAU / n, tipHalf = pitch / 2 * tipFrac;
  const dR = Math.asin(stemW / 2 / rRoot), dT = Math.asin(stemW / 2 / (rTip - tipT));
  for (let k = 0; k < n; k++) {
    const c = k * pitch, a0 = c - pitch + dR, a1 = c - dR;
    for (let i = 1; i <= 4; i++) pts.push(polar(rRoot, a0 + (a1 - a0) * i / 4));
    pts.push(polar(rTip - tipT, c - dT)); pts.push(polar(rTip - tipT, c - tipHalf));
    for (let i = 0; i <= 6; i++) pts.push(polar(rTip, c - tipHalf + 2 * tipHalf * i / 6));
    pts.push(polar(rTip - tipT, c + tipHalf)); pts.push(polar(rTip - tipT, c + dT)); pts.push(polar(rRoot, c + dR));
  }
  const s = shapeFrom(pts); s.holes.push(circlePath(rCore));
  return extrude(s, h, { bevel: 0.006 });
}
function coilMeshes(n, stemW, stack, r0, len) {
  const g = new THREE.Group(), coils = [];
  const s = roundRectShape(stemW + 0.2, stack + 0.16, 0.07);
  const hw = stemW / 2 + 0.006, hh = stack / 2 + 0.006;
  s.holes.push(shapeFrom([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], THREE.Path));
  const geo = extrude(s, len, { bevel: 0.02 }); geo.translate(0, 0, len / 2);
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < n; k++) {
    const c = k * TAU / n;
    const m = mesh(geo, 'copper'); m.userData.dynamicEmissive = true;
    m4.makeBasis(new THREE.Vector3(-Math.sin(c), Math.cos(c), 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(c), Math.sin(c), 0));
    m.quaternion.setFromRotationMatrix(m4); m.position.set(r0 * Math.cos(c), r0 * Math.sin(c), 0);
    g.add(m); coils.push(m);
  }
  return { g, coils };
}
function sectorShape(ri, ro, a0, a1, seg = 10) {
  const pts = [];
  for (let i = 0; i <= seg; i++) pts.push(polar(ro, a0 + (a1 - a0) * i / seg));
  for (let i = seg; i >= 0; i--) pts.push(polar(ri, a0 + (a1 - a0) * i / seg));
  return shapeFrom(pts);
}
function magnetRing(n, ri, ro, h) {
  const g = new THREE.Group(), w = TAU / n * 0.86;
  const geo = extrude(sectorShape(ri, ro, -w / 2, w / 2), h, { bevel: 0.008 });
  for (let k = 0; k < n; k++) { const m = mesh(geo, k % 2 ? 'magS' : 'magN'); m.rotation.z = k * TAU / n; g.add(m); }
  return g;
}
function commutate(coils, pattern, thE, gain) {
  const I = { a: Math.cos(thE), b: Math.cos(thE - TAU / 3), c: Math.cos(thE - 2 * TAU / 3) };
  coils.forEach((m, k) => {
    const ch = pattern[k % pattern.length], sgn = ch === ch.toUpperCase() ? 1 : -1;
    const v = sgn * I[ch.toLowerCase()];
    m.material.emissive.setHex(v > 0 ? 0xff2a14 : 0xbcd6ff);
    m.material.emissiveIntensity = Math.abs(v) * gain;
  });
}
function buildPlanetary(B, o) {
  const S = o.S, R = o.R, P = (R - S) / 2, m = o.m, t = o.t, z = o.z || 0;
  const rs = m * S / 2, rp = m * P / 2, rr = m * R / 2, d = rs + rp;
  const psis = []; for (let i = 0; i < o.n; i++) psis.push(TAU * Math.round(i * (S + R) / o.n) / (S + R));
  const parent = o.parent || B.root;
  // Sun
  const sun = group(mesh(gearGeo(S, m, t, { bore: o.sunBore || 0, z }), ROLE_MAT[o.roles.sun]));
  if (o.sunShaft) sun.add(mesh(cylZ(o.sunShaft.r, o.sunShaft.h, o.sunShaft.z), 'steel'));
  B.add(sun, { name: 'Sun gear', role: o.roles.sun, desc: o.desc.sun, explode: [0, 0, o.ex.sun], anchor: [0, 0, z + t / 2 + 0.02], parent });
  B.pitchCircle(rs, sun.parent, z + t / 2 + 0.012);
  // Planets
  const planets = new THREE.Group(), pMeshes = [];
  const pinR = o.pinR;
  const pgeo = gearGeo(P, m, t, { bore: pinR + 0.012, z });
  psis.forEach(psi => {
    const pg = new THREE.Group(); pg.position.set(d * Math.cos(psi), d * Math.sin(psi), 0);
    const pm = mesh(pgeo, 'steel'); pg.add(pm); planets.add(pg); pMeshes.push(pm);
    B.pitchCircle(rp, pg, z + t / 2 + 0.012);
  });
  B.add(planets, { name: 'Planet gears', role: 'transfer', desc: o.desc.planets, explode: [0, 0, o.ex.planets], anchor: [d, 0, z + t / 2 + 0.02], follow: planets, parent });
  // Carrier: plate + pins (+ shaft or flange)
  const side = o.carrierSide === 'front' ? 1 : -1;
  const zc = z + side * (t / 2 + 0.03 + o.plateT / 2);
  const cShape = circleShape(o.plateR);
  if (o.plateBore) cShape.holes.push(circlePath(o.plateBore));
  if (o.n >= 3) psis.forEach((psi, i) => {
    const nx = i + 1 < psis.length ? psis[i + 1] : psis[0] + TAU, mid = (psi + nx) / 2;
    const rad = Math.min(0.32 * d * Math.sin((nx - psi) / 2), o.plateR - d * 0.72 - 0.06);
    if (rad > 0.04) cShape.holes.push(circlePath(rad, d * 0.72 * Math.cos(mid), d * 0.72 * Math.sin(mid)));
  });
  const carrier = group(mesh(extrude(cShape, o.plateT, { z: zc, bevel: 0.01 }), ROLE_MAT[o.roles.carrier]));
  const pinLen = t + 0.1 + o.plateT;
  psis.forEach(psi => { const pin = mesh(cylZ(pinR, pinLen, z + side * (o.plateT / 2 + 0.02), 24), 'steel2'); pin.position.x = d * Math.cos(psi); pin.position.y = d * Math.sin(psi); carrier.add(pin); });
  if (o.carrierExtra) o.carrierExtra(carrier, zc);
  B.add(carrier, { name: o.carrierName || 'Carrier', role: o.roles.carrier, desc: o.desc.carrier, explode: [0, 0, o.ex.carrier], anchor: o.carrierAnchor || [(o.plateR - 0.1) * Math.cos(-1.1), (o.plateR - 0.1) * Math.sin(-1.1), zc], clip: !!o.clipCarrier, parent });
  // Ring
  const ring = mesh(ringGeo(R, m, t, o.ringOuter, { z, bolts: o.ringBolts }), ROLE_MAT[o.roles.ring]);
  const ra = (rr + o.ringOuter) / 2;
  B.add(ring, { name: o.ringName || 'Ring gear', role: o.roles.ring, desc: o.desc.ring, explode: [0, 0, o.ex.ring], anchor: [ra * Math.cos(2.4), ra * Math.sin(2.4), z + t / 2], clip: o.clipRing !== false, parent });
  B.pitchCircle(rr, ring.parent, z + t / 2 + 0.012);
  const beta0 = Math.PI * (P - 1) / R;
  function set(thS, thC) {
    sun.rotation.z = thS; planets.rotation.z = thC; carrier.rotation.z = thC;
    const a = thS - thC;
    for (let i = 0; i < pMeshes.length; i++) { const psi = psis[i]; pMeshes[i].rotation.z = psi + Math.PI - Math.PI / P + (psi - a) * S / P; }
    ring.rotation.z = beta0 + thC - (S / R) * (thS - thC);
  }
  return { set, sun, planets, carrier, ring, P, d, rs, rp, rr };
}

/* ============================== SPUR ============================== */
MECHS.spur = {
  params: [
    { id: 'n1', label: 'Pinion teeth N₁', type: 'range', min: 10, max: 30, step: 1, value: 14, rebuild: true },
    { id: 'n2', label: 'Gear teeth N₂', type: 'range', min: 20, max: 80, step: 1, value: 42, rebuild: true },
    { id: 'module', label: 'Module m', type: 'seg', value: 2, options: [{ v: 1, l: '1 mm' }, { v: 1.5, l: '1.5 mm' }, { v: 2, l: '2 mm' }, { v: 3, l: '3 mm' }], help: 'Tooth size. Only gears with the same module can mesh.' },
    rpmParam(1500), torqueParam(2, 20),
  ],
  pitch: true, cut: null, camDir: [0.3, 1.05, 0.95], visRpm: 1.5 * 60 / TAU,
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const N1 = P.n1, N2 = P.n2, m = Math.min(0.14, 6.6 / (N1 + N2)), t = 0.5;
    const r1 = m * N1 / 2, r2 = m * N2 / 2, x1 = -r2, x2 = r1;
    const pin = group(mesh(gearGeo(N1, m, t, { bore: 0 }), 'input'));
    pin.add(mesh(cylZ(0.13, 1.5, -0.35), 'steel'));
    pin.add(mesh(boxGeo(0.06, 0.05, 0.3, 0, 0.13, 0.32), 'steel2'));
    pin.position.x = x1;
    B.add(pin, { name: 'Pinion', role: 'input', desc: `Driving gear with ${N1} teeth on the motor shaft. Fastest member, lowest torque.`, explode: [0, 0, 1.3], anchor: [x1 - r1 * 0.45, r1 * 0.45, t / 2] });
    const gear = group(mesh(gearGeo(N2, m, t, { bore: 0, holes: N2 >= 28 ? { n: 5, r: r2 * 0.58, rad: r2 * 0.17 } : null }), 'output'));
    gear.add(mesh(cylZ(0.42, t + 0.22, 0), 'output'));
    gear.add(mesh(cylZ(0.17, 1.6, -0.35), 'steel'));
    gear.add(mesh(boxGeo(0.07, 0.06, 0.36, 0, 0.17, 0.35), 'steel2'));
    gear.position.x = x2;
    B.add(gear, { name: 'Driven gear', role: 'output', desc: `Driven gear with ${N2} teeth. Turns ${fmt(N2 / N1, 2)}× slower with ${fmt(N2 / N1, 2)}× the torque, in the opposite direction.`, explode: [0, 0, 0.6], anchor: [x2 + r2 * 0.62, r2 * 0.5, t / 2] });
    // Frame: a slotted bed plate with two bearing bosses.
    const pl = new THREE.Shape(); const hw = 0.55;
    pl.moveTo(x1, -hw); pl.lineTo(x2, -hw); pl.absarc(x2, 0, hw, -Math.PI / 2, Math.PI / 2, false); pl.lineTo(x1, hw); pl.absarc(x1, 0, hw, Math.PI / 2, Math.PI * 1.5, false);
    const frame = group(mesh(extrude(pl, 0.16, { z: -1.0 }), 'housing'));
    frame.add(mesh(ringZ(0.34, 0.135, 0.5, -0.67), 'fixed')); frame.children[1].position.x = x1;
    const boss2 = mesh(ringZ(0.4, 0.175, 0.5, -0.67), 'fixed'); boss2.position.x = x2; frame.add(boss2);
    B.add(frame, { name: 'Bed plate and bearings', role: 'fixed', desc: `Holds the shafts at the centre distance a = m(N₁+N₂)/2. Any error here changes backlash.`, explode: [0, 0, -0.8], anchor: [0, -hw, -0.92] });
    // Pitch circles, pitch point and line of action
    const zt = t / 2 + 0.03, pc = B.root;
    const c1 = B.pitchCircle(r1, pc, zt); c1.position.x = x1;
    const c2 = B.pitchCircle(r2, pc, zt); c2.position.x = x2;
    const al = 20 / DEG, px = x1 + r1, ux = Math.sin(al), uy = Math.cos(al);
    B.pitchLine([px - ux * r1 * Math.sin(al) * 1.6, -uy * r1 * Math.sin(al) * 1.6, zt], [px + ux * r2 * Math.sin(al) * 1.25, uy * r2 * Math.sin(al) * 1.25, zt], pc, true);
    const ppt = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xE8590C }));
    ppt.position.set(px, 0, zt); ppt.visible = false; pc.add(ppt); B.pitch.push(ppt);
    let th = 0;
    return { update(dt) { th += dt * 1.5; pin.rotation.z = th; gear.rotation.z = Math.PI - Math.PI / N2 - th * N1 / N2; } };
  },
  calc(P) {
    const i = P.n2 / P.n1, eta = 0.98, n2 = P.rpm / i, T2 = P.torque * i * eta, pin = W(P.torque, P.rpm);
    const d1 = P.module * P.n1, a = P.module * (P.n1 + P.n2) / 2, v = Math.PI * d1 * P.rpm / 60000, f = P.n1 * P.rpm / 60;
    return {
      realRpm: P.rpm,
      hud: [['Ratio', `${fmt(i, 2)} : 1`], ['Input', `${fmt(P.rpm)} rpm · ${fmt(P.torque, 1)} N·m`], ['Output', `${fmt(n2)} rpm · ${fmtS(T2)} N·m`], ['Direction', 'Reversed']],
      rows: [
        { k: 'Gear ratio', expr: `i = N₂/N₁ = ${P.n2}/${P.n1}`, v: `${fmt(i, 2)} : 1` },
        { k: 'Output speed (reversed)', expr: `n₂ = n₁/i = ${fmt(P.rpm)}/${fmt(i, 2)}`, v: `${fmt(n2)} rpm` },
        { k: 'Output torque', expr: `τ₂ = τ₁·i·η = ${fmt(P.torque, 1)}·${fmt(i, 2)}·0.98`, v: `${fmtS(T2)} N·m` },
        { k: 'Pitch diameters', expr: `d = m·N = ${P.module}·${P.n1}, ${P.module}·${P.n2}`, v: `${fmt(d1, 1)} / ${fmt(P.module * P.n2, 1)} mm` },
        { k: 'Centre distance', expr: `a = m(N₁+N₂)/2 = ${P.module}·${P.n1 + P.n2}/2`, v: `${fmt(a, 1)} mm` },
        { k: 'Pitch-line velocity', expr: `v = π·d₁·n₁ / 60 000`, v: `${fmt(v, 2)} m/s` },
        { k: 'Tooth-mesh frequency (main gear-noise tone)', expr: `f = N₁·n₁ / 60 = ${P.n1}·${fmt(P.rpm)}/60`, v: `${fmt(f)} Hz` },
      ],
      power: { pin, pout: pin * eta },
    };
  }
};

/* ============================== BLDC ============================== */
MECHS.bldc = {
  params: [
    { id: 'kv', label: 'Motor velocity constant Kv', type: 'range', min: 40, max: 400, step: 10, value: 120, unit: 'rpm/V' },
    { id: 'volts', label: 'Supply voltage', type: 'range', min: 6, max: 60, step: 1, value: 24, unit: 'V' },
    { id: 'amps', label: 'Phase current', type: 'range', min: 0, max: 40, step: 1, value: 18, unit: 'A', live: true, help: 'Brighter coil glow means more current.' },
  ],
  pitch: false, cut: [[-1, 0, 0], [0, 0, -1]], camDir: [0.55, 0.85, 1.0], visRpm: 1.4 * 60 / TAU, defaultCut: true,
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const stator = mesh(statorGeo(12, 0.42, 0.95, 1.5, 0.26, 0.1, 0.8, 0.7), 'lam');
    const sGroup = group(stator, mesh(ringZ(0.43, 0.16, 0.85, -0.12), 'fixed'));
    B.add(sGroup, { name: 'Stator core', role: 'fixed', desc: 'Stack of thin insulated silicon-steel laminations. The thin sheets cut eddy-current losses.', explode: [0, 0, 0], anchor: [0.6, -0.6, 0.36] });
    const { g: coilG, coils } = coilMeshes(12, 0.26, 0.7, 0.98, 0.38);
    B.add(coilG, { name: 'Windings (3 phases)', role: 'fixed', desc: 'Twelve copper coils in three phases A, B, C. Red glow: the coil face is a north pole. White: south.', explode: [0, 0, 0.35], anchor: [-1.15 * Math.cos(0.5), -1.15 * Math.sin(0.5), 0.45] });
    const rotor = new THREE.Group();
    rotor.add(mesh(ringZ(1.8, 1.665, 0.88, 0.02), 'output'));
    const cap = annulusShape(1.8, 0.12); boltHoles(cap, 7, 1.12, 0.26);
    rotor.add(mesh(extrude(cap, 0.08, { z: 0.5 }), 'output'));
    rotor.add(mesh(ringZ(0.3, 0.12, 0.22, 0.62), 'output'));
    rotor.add(mesh(boxGeo(0.5, 0.06, 0.05, 1.45, 0, 0.56), 'steel2'));
    B.add(rotor, { name: 'Rotor bell', role: 'output', desc: 'Steel cup that carries the magnets and closes their magnetic circuit. It is the output.', explode: [0, 0, 1.7], anchor: [1.3 * Math.cos(-0.6), 1.3 * Math.sin(-0.6), 0.55], clip: true });
    const mags = magnetRing(14, 1.56, 1.655, 0.72);
    B.add(mags, { name: 'Magnets (14 poles)', role: 'output', desc: 'Neodymium magnets with alternating north (red) and south (silver) faces, bonded inside the bell.', explode: [0, 0, 1.15], anchor: [-1.6, 0.25, 0.3], follow: null, clip: true });
    const shaft = mesh(cylZ(0.12, 1.85, 0.05), 'steel');
    B.add(shaft, { name: 'Shaft', role: 'output', desc: 'Pressed into the rotor hub. Carries torque to the propeller, wheel or gearbox.', explode: [0, 0, 2.3], anchor: [0, 0, 0.98] });
    const mount = new THREE.Shape(); const arm = 0.22, L = 1.35;
    mount.moveTo(-arm, -L); mount.lineTo(arm, -L); mount.lineTo(arm, -arm); mount.lineTo(L, -arm); mount.lineTo(L, arm); mount.lineTo(arm, arm); mount.lineTo(arm, L); mount.lineTo(-arm, L); mount.lineTo(-arm, arm); mount.lineTo(-L, arm); mount.lineTo(-L, -arm); mount.lineTo(-arm, -arm); mount.closePath();
    mount.holes.push(circlePath(0.12)); [[1.15, 0], [-1.15, 0], [0, 1.15], [0, -1.15]].forEach(([x, y]) => mount.holes.push(circlePath(0.07, x, y)));
    const mnt = mesh(extrude(mount, 0.1, { z: -0.6 }), 'housing');
    B.add(mnt, { name: 'Mount', role: 'fixed', desc: 'Bolts the stator to the airframe or robot. Torque reacts through here.', explode: [0, 0, -0.9], anchor: [1.2, 0, -0.55] });
    let th = 0, gain = 0.3 + 1.1 * P.amps / 40;
    const inst = {
      update(dt) { th += dt * 1.4; rotor.rotation.z = th; mags.rotation.z = th; shaft.rotation.z = th; commutate(coils, 'AabBCcaABbcC', 7 * th + Math.PI / 2, gain); },
      setParams(p) { gain = 0.3 + 1.1 * p.amps / 40; },
      onFrame() {
        const mk = document.getElementById('phase-marker'); if (!mk) return;
        const e = ((7 * th + Math.PI / 2) % TAU + TAU) % TAU, x = 34 + e / TAU * 300;
        mk.setAttribute('x1', x.toFixed(1)); mk.setAttribute('x2', x.toFixed(1));
      }
    };
    return inst;
  },
  calc(P) {
    const Kt = 60 / (TAU * P.kv), T = Kt * P.amps, n0 = P.kv * P.volts, fe = 7 * n0 / 60, Ph = T * (n0 / 2) * TAU / 60;
    const x0 = 34, w = 300, y0 = 70, A = 46;
    const path = ph => { let d = ''; for (let i = 0; i <= 120; i++) { const e = i / 120 * TAU; const y = y0 - A * Math.cos(e - ph); d += (i ? 'L' : 'M') + (x0 + i / 120 * w).toFixed(1) + ' ' + y.toFixed(1); } return d; };
    const lab = (ph, txt) => { const e = (ph + 0.0) % TAU; const x = x0 + e / TAU * w; return `<text class="axis-t" x="${(x + 4).toFixed(1)}" y="${y0 - A - 4}" style="fill:var(--ink)">${txt}</text>`; };
    const chart = `<div class="mini-chart" style="margin-top:14px"><div class="calc-k">Phase currents over one electrical cycle (live marker)</div>
      <svg viewBox="0 0 344 132" role="img" aria-label="Three sinusoidal phase currents A, B and C, each shifted by 120 degrees">
        <line class="grid-l" x1="${x0}" x2="${x0 + w}" y1="${y0 - A}" y2="${y0 - A}"/><line class="grid-l" x1="${x0}" x2="${x0 + w}" y1="${y0 + A}" y2="${y0 + A}"/>
        <line class="axis-l" x1="${x0}" x2="${x0 + w}" y1="${y0}" y2="${y0}"/>
        <text class="axis-t" x="${x0 - 6}" y="${y0 - A + 3}" text-anchor="end">+I</text><text class="axis-t" x="${x0 - 6}" y="${y0 + 3}" text-anchor="end">0</text><text class="axis-t" x="${x0 - 6}" y="${y0 + A + 3}" text-anchor="end">−I</text>
        ${[0, 90, 180, 270, 360].map(dg => `<text class="axis-t" x="${x0 + dg / 360 * w}" y="${y0 + A + 16}" text-anchor="middle">${dg}°e</text>`).join('')}
        <path d="${path(0)}" fill="none" stroke="var(--series-a)" stroke-width="2" stroke-linejoin="round"/>
        <path d="${path(TAU / 3)}" fill="none" stroke="var(--series-b)" stroke-width="2" stroke-linejoin="round"/>
        <path d="${path(2 * TAU / 3)}" fill="none" stroke="var(--series-c)" stroke-width="2" stroke-linejoin="round"/>
        ${lab(0.05, 'A')}${lab(TAU / 3 + 0.05, 'B')}${lab(2 * TAU / 3 + 0.05, 'C')}
        <line id="phase-marker" x1="${x0}" x2="${x0}" y1="${y0 - A - 2}" y2="${y0 + A + 2}" stroke="var(--ink)" stroke-width="1.5"/>
      </svg>
      <div class="flow-legend" style="justify-content:flex-start;gap:14px"><span><i class="sw" style="background:var(--series-a)"></i>Phase A</span><span><i class="sw" style="background:var(--series-b)"></i>Phase B</span><span><i class="sw" style="background:var(--series-c)"></i>Phase C</span></div>
      <p class="chart-cap">Each phase is shifted by 120°. Their sum is a field that rotates once per electrical cycle, 7 times per mechanical turn on this 14-pole rotor.</p></div>`;
    return {
      realRpm: n0 / 2,
      hud: [['Torque constant', `${fmt(Kt, 3)} N·m/A`], ['Torque at ' + P.amps + ' A', `${fmt(T, 2)} N·m`], ['No-load speed', `${fmt(n0)} rpm`], ['Electrical cycles', '7 per turn']],
      rows: [
        { k: 'Torque constant', expr: `Kt = 60 / (2π·Kv) = 60 / (2π·${P.kv})`, v: `${fmt(Kt, 4)} N·m/A` },
        { k: 'Torque', expr: `τ = Kt·I = ${fmt(Kt, 4)}·${P.amps}`, v: `${fmt(T, 2)} N·m` },
        { k: 'No-load speed', expr: `n₀ ≈ Kv·V = ${P.kv}·${P.volts}`, v: `${fmt(n0)} rpm` },
        { k: 'Electrical frequency at n₀', expr: `f = p·n₀ / 60 = 7·${fmt(n0)}/60`, v: `${fmt(fe)} Hz` },
        { k: 'Mechanical power at ½ n₀ and this torque', expr: `P = τ·ω = ${fmt(T, 2)}·${fmt(n0 / 2 * TAU / 60, 1)} rad/s`, v: `${fmtS(Ph)} W` },
      ],
      extra: chart,
    };
  }
};

/* ============================== PLANETARY ============================== */
MECHS.planetary = {
  params: [
    { id: 'S', label: 'Sun teeth S', type: 'range', min: 10, max: 30, step: 1, value: 12, rebuild: true },
    { id: 'R', label: 'Ring teeth R', type: 'range', min: 42, max: 90, step: 1, value: 60, rebuild: true, help: 'If R − S is odd, R is rounded up so the planets get whole teeth.' },
    { id: 'n', label: 'Planets', type: 'seg', value: 3, rebuild: true, options: [{ v: 3, l: '3' }, { v: 4, l: '4' }, { v: 5, l: '5' }] },
    { id: 'fixed', label: 'Held still', type: 'seg', value: 'ring', rebuild: true, options: [{ v: 'ring', l: 'Ring' }, { v: 'carrier', l: 'Carrier' }, { v: 'sun', l: 'Sun' }], help: 'Ring: sun in, carrier out. Carrier: sun in, ring out (reverses). Sun: ring in, carrier out.' },
    rpmParam(3000), torqueParam(1.5, 10),
  ],
  pitch: true, cut: [[-1, 0, 0], [0, 0, -1]], camDir: [0.32, 1.1, 0.85], visRpm: 2.2 * 60 / TAU,
  eff(P) { let S = P.S, R = P.R; if (R < S + 16) R = S + 16; if ((R - S) % 2) R += 1; return { S, R, Pt: (R - S) / 2 }; },
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const { S, R, Pt } = this.eff(P);
    const m = 4.8 / R, t = 0.55;
    let n = P.n; const rp = m * Pt / 2, d = m * (S + Pt) / 2;
    while (n > 3 && 2 * d * Math.sin(Math.PI / n) < 2 * (rp + m) + 0.04) n--;
    const roles = P.fixed === 'ring' ? { sun: 'input', carrier: 'output', ring: 'fixed' } : P.fixed === 'carrier' ? { sun: 'input', carrier: 'fixed', ring: 'output' } : { sun: 'fixed', carrier: 'output', ring: 'input' };
    const pl = buildPlanetary(B, {
      S, R, n, m, t, z: 0, roles, pinR: Math.min(0.16, rp * 0.4), plateT: 0.16, plateR: d + Math.min(0.16, rp * 0.4) * 2.6, carrierSide: 'back',
      sunShaft: { r: Math.min(0.14, m * S / 2 * 0.55), h: 1.6, z: 0.75 }, ringOuter: 2.4 + 0.42, ringBolts: { n: 8, r: 2.4 + 1.25 * m + (0.42 - 1.25 * m) / 2, rad: 0.06 },
      carrierExtra: (c, zc) => c.add(mesh(cylZ(0.26, 1.3, zc - 0.7), 'steel')),
      ex: { sun: 1.7, planets: 0.85, carrier: -1.1, ring: 0 },
      desc: {
        sun: `Central gear with ${S} teeth. ${roles.sun === 'input' ? 'Driven by the motor.' : roles.sun === 'fixed' ? 'Held still in this configuration.' : ''}`,
        planets: `${n} idler gears with ${Pt} teeth. They mesh with the sun and the ring at once, spin on their pins and orbit together.`,
        carrier: `Holds the planet pins. ${roles.carrier === 'output' ? 'Its rotation is the output.' : 'Held still here, so the planets spin in place.'}`,
        ring: `Internal gear with ${R} teeth. ${roles.ring === 'fixed' ? 'Bolted to the housing.' : roles.ring === 'output' ? 'Free to turn: it is the output.' : 'Driven as the input.'}`
      }
    });
    this._n = n;
    let th = 0;
    return {
      legend: ['input', 'output', 'fixed', 'transfer'],
      update(dt) {
        th += dt * 2.2;
        if (P.fixed === 'ring') pl.set(th, th * S / (S + R));
        else if (P.fixed === 'carrier') pl.set(th, 0);
        else { const c = th * R / (R + S); pl.set(0, c); }
      }
    };
  },
  calc(P) {
    const { S, R, Pt } = this.eff(P), eta = 0.97;
    let i, rev = false, path;
    if (P.fixed === 'ring') { i = 1 + R / S; path = 'Sun → carrier'; }
    else if (P.fixed === 'carrier') { i = R / S; rev = true; path = 'Sun → ring'; }
    else { i = 1 + S / R; path = 'Ring → carrier'; }
    const nOut = P.rpm / i, Tout = P.torque * i * eta, pin = W(P.torque, P.rpm);
    const ws = P.fixed === 'sun' ? 0 : P.rpm, wc = P.fixed === 'ring' ? P.rpm / i : P.fixed === 'carrier' ? 0 : nOut;
    const wpRel = -(S / Pt) * (ws - wc);
    const iExpr = P.fixed === 'ring' ? `i = 1 + R/S = 1 + ${R}/${S}` : P.fixed === 'carrier' ? `i = R/S = ${R}/${S}` : `i = 1 + S/R = 1 + ${S}/${R}`;
    const n = this._n || P.n;
    const rows = [
      { k: 'Willis equation (holds for every configuration)', expr: `(ω_s − ω_c)/(ω_r − ω_c) = −R/S = −${R}/${S}`, v: fmt(-R / S, 2) },
      { k: `Ratio, ${path}`, expr: iExpr, v: `${fmt(i, 2)} : 1` },
      { k: `Output speed (${dirTxt(rev)})`, expr: `n_out = n_in / i`, v: `${fmt(nOut)} rpm` },
      { k: 'Output torque', expr: `τ_out = τ_in·i·η = ${fmt(P.torque, 1)}·${fmt(i, 2)}·0.97`, v: `${fmtS(Tout)} N·m` },
      { k: 'Planet teeth', expr: `P = (R − S)/2 = (${R} − ${S})/2`, v: `${Pt}` },
      { k: 'Planet spin relative to carrier', expr: `ω_p = −(S/P)(ω_s − ω_c)`, v: `${fmt(Math.abs(wpRel))} rpm` },
      { k: 'Load sharing', expr: `each planet carries ≈ 1/${n} of the sun mesh force`, v: `${n} paths` },
    ];
    if ((S + R) % n) rows.push({ k: 'Assembly', expr: `(S + R)/n = ${S + R}/${n} is not whole, so planets are spaced unevenly to mesh`, v: 'uneven' });
    if (R !== P.R) rows.push({ k: 'Adjusted', expr: `R rounded to ${R} so R − S is even`, v: '' });
    return {
      realRpm: P.rpm,
      hud: [['Configuration', path], ['Ratio', `${fmt(i, 2)} : 1`], ['Input', `${fmt(P.rpm)} rpm`], ['Output', `${fmt(nOut)} rpm · ${fmtS(Tout)} N·m`]],
      rows, power: { pin, pout: pin * eta },
    };
  }
};

/* ============================== HARMONIC ============================== */
function makeDeformable(geom, o) {
  const pos = geom.attributes.position, nor = geom.attributes.normal, n = pos.count;
  const base = new Float32Array(pos.array), bn = new Float32Array(nor.array);
  const R = new Float32Array(n), A0 = new Float32Array(n), AC = new Float32Array(n), F = new Float32Array(n);
  const pitch = o.toothN ? TAU / o.toothN : 0;
  for (let i = 0; i < n; i++) {
    const x = base[3 * i], y = base[3 * i + 1], z = base[3 * i + 2];
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    R[i] = r; A0[i] = a;
    AC[i] = o.toothN && r > o.rTooth ? Math.round(a / pitch) * pitch : a;
    F[i] = o.taper ? clamp((z - o.zBot) / (o.zTop - o.zBot), 0, 1) : 1;
  }
  return { pos, nor, bn, R, A0, AC, F, n, rRef: o.rRef };
}
function deform(d, w, thF, thW) {
  const p = d.pos.array, q = d.nor.array;
  for (let i = 0; i < d.n; i++) {
    const f = d.F[i], dd = d.AC[i] + thF - thW;
    const wr = w * f * Math.cos(2 * dd), v = -(w * f / 2) * Math.sin(2 * dd);
    const da = thF + v / d.rRef, a = d.A0[i] + da, r = d.R[i] + wr;
    p[3 * i] = r * Math.cos(a); p[3 * i + 1] = r * Math.sin(a);
    const cs = Math.cos(da), sn = Math.sin(da), nx = d.bn[3 * i], ny = d.bn[3 * i + 1];
    q[3 * i] = nx * cs - ny * sn; q[3 * i + 1] = nx * sn + ny * cs;
  }
  d.pos.needsUpdate = true; d.nor.needsUpdate = true;
}
MECHS.harmonic = {
  params: [
    { id: 'ratio', label: 'Ratio', type: 'seg', value: 30, rebuild: true, options: [{ v: 20, l: '20:1' }, { v: 30, l: '30:1' }, { v: 50, l: '50:1' }, { v: 100, l: '100:1' }], help: 'Flexspline teeth = 2 × ratio. 20:1 has the coarsest teeth and the most visible flex.' },
    rpmParam(3000), torqueParam(0.5, 3, 0.05, 'Motor torque'),
  ],
  pitch: false, cut: [[-1, 0, 0], [0, 0, -1]], camDir: [0.3, 1.15, 0.8], visRpm: 2.4 * 60 / TAU, zoom: 0.92,
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const Nf = 2 * P.ratio, Nc = Nf + 2, m = 4.2 / Nf, rf = m * Nf / 2, w = m;
    const rRoot = rf - m, rFi = rRoot - 0.07, tw = 0.42, zc = tw / 2, L = 1.5;
    // Circular spline (fixed, rigid)
    const cs = mesh(ringGeo(Nc, m, 0.52, 2.85, { add: 1.25 * m, ded: 0.8 * m, backlash: -0.3, z: zc, bolts: { n: 8, r: 2.6, rad: 0.075, phase: Math.PI / 8 } }), 'fixed');
    B.add(cs, { name: 'Circular spline', role: 'fixed', desc: `Rigid ring with ${Nc} internal teeth, 2 more than the flexspline. Bolted to the housing.`, explode: [0, 0, 1.25], anchor: [2.5 * Math.cos(0.5), 2.5 * Math.sin(0.5), zc + 0.26], clip: true });
    // Flexspline: teeth band + thin cup wall (both deform) + diaphragm (rigid)
    const flex = new THREE.Group();
    const tShape = shapeFrom(gearOutline(Nf, m, { add: 0.8 * m, ded: m, backlash: 0.3, steps: Nf > 120 ? 4 : 6 }));
    tShape.holes.push(circlePath(rFi));
    const tGeo = extrude(tShape, tw, { bevel: 0, z: zc, curve: 96 });
    const tMesh = mesh(tGeo, 'output'); flex.add(tMesh);
    const wGeo = extrude(annulusShape(rRoot - 0.004, rFi), L, { bevel: 0, steps: 14, z: -L / 2, curve: 128 });
    const wMesh = mesh(wGeo, 'output'); flex.add(wMesh);
    const dia = mesh(ringZ(rRoot - 0.004, 0.62, 0.08, -L - 0.04), 'output'); flex.add(dia);
    const defs = [
      makeDeformable(tGeo, { toothN: Nf, rTooth: rRoot - 0.01, rRef: rf }),
      makeDeformable(wGeo, { taper: true, zTop: 0, zBot: -L, rRef: rf }),
    ];
    B.add(flex, { name: 'Flexspline', role: 'output', desc: `Thin steel cup with ${Nf} external teeth. The wave generator flexes it into an ellipse twice per input turn.`, explode: [0, 0, 0], anchor: [-(rRoot) * Math.cos(0.7), -(rRoot) * Math.sin(0.7), -0.75], clip: true });
    const hubS = annulusShape(0.62, 0.2); boltHoles(hubS, 6, 0.42, 0.055);
    const hub = mesh(extrude(hubS, 0.34, { z: -L - 0.25 }), 'output');
    B.add(hub, { name: 'Output hub', role: 'output', desc: 'Bolted to the flexspline diaphragm. Turns slowly, opposite to the input.', explode: [0, 0, -0.75], anchor: [0, -0.5, -L - 0.42] });
    // Wave generator: elliptical plug (rigid, rotates) + shaft
    const rp = rFi - 0.035 - 0.13;
    const plugPts = []; for (let i = 0; i < 240; i++) { const a = i / 240 * TAU; plugPts.push(polar(rp + w * Math.cos(2 * a), a)); }
    const plugS = shapeFrom(plugPts); plugS.holes.push(circlePath(0.24));
    const wg = group(mesh(extrude(plugS, 0.34, { z: zc, bevel: 0.01 }), 'input'), mesh(cylZ(0.24, 1.5, zc + 0.55), 'steel'));
    const slotS = shapeFrom([[0.55, -0.05], [rp - 0.15, -0.05], [rp - 0.15, 0.05], [0.55, 0.05]]);
    wg.add(mesh(extrude(slotS, 0.04, { z: zc + 0.18, bevel: 0 }), 'dark', { noPick: true }));
    B.add(wg, { name: 'Wave generator', role: 'input', desc: 'Elliptical cam on the input shaft. Its long axis pushes the flexspline teeth into mesh at two places.', explode: [0, 0, 2.4], anchor: [0, 0, zc + 1.3] });
    // Flexible ball bearing: deformed outer race + balls
    const brg = new THREE.Group();
    const raceGeo = extrude(annulusShape(rFi - 0.003, rFi - 0.035), 0.3, { bevel: 0, z: zc, curve: 128 });
    const race = mesh(raceGeo, 'steel2'); brg.add(race);
    defs.push(makeDeformable(raceGeo, { rRef: rf }));
    const NB = 30, ballR = 0.062;
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(ballR, 14, 10), mat('chrome'), NB);
    balls.castShadow = true; balls.frustumCulled = false; brg.add(balls);
    B.add(brg, { name: 'Flexible bearing', role: 'transfer', desc: 'Thin-race ball bearing between the cam and the flexspline. It lets the ellipse rotate while the cup only flexes.', explode: [0, 0, 2.4], anchor: [rFi * Math.cos(2.3), rFi * Math.sin(2.3), zc + 0.2] });
    const m4 = new THREE.Matrix4();
    let th = 0;
    const update = dt => {
      th += dt * 2.4;
      const thF = -th * (Nc - Nf) / Nf;
      wg.rotation.z = th; dia.rotation.z = thF; hub.rotation.z = thF;
      defs.forEach(d => deform(d, w, thF, th));
      const cage = th * 0.5 + thF * 0.5;
      for (let i = 0; i < NB; i++) {
        const a = cage + i * TAU / NB, r = rp + 0.066 + w * Math.cos(2 * (a - th));
        m4.makeTranslation(r * Math.cos(a), r * Math.sin(a), zc); balls.setMatrixAt(i, m4);
      }
      balls.instanceMatrix.needsUpdate = true;
    };
    return { update };
  },
  calc(P) {
    const i = P.ratio, Nf = 2 * i, Nc = Nf + 2, eta = 0.75, nOut = P.rpm / i, Tout = P.torque * i * eta, pin = W(P.torque, P.rpm);
    return {
      realRpm: P.rpm,
      hud: [['Ratio', `${i} : 1 (reversed)`], ['Teeth', `${Nf} / ${Nc}`], ['Input', `${fmt(P.rpm)} rpm`], ['Output', `${fmtS(nOut)} rpm · ${fmtS(Tout)} N·m`]],
      rows: [
        { k: 'Ratio (circular spline fixed)', expr: `i = N_f / (N_c − N_f) = ${Nf}/(${Nc} − ${Nf})`, v: `${i} : 1` },
        { k: 'Output speed (reversed)', expr: `n_out = ${fmt(P.rpm)} / ${i}`, v: `${fmtS(nOut)} rpm` },
        { k: 'Output torque', expr: `τ_out = τ·i·η = ${fmt(P.torque, 2)}·${i}·0.75`, v: `${fmtS(Tout)} N·m` },
        { k: 'Flexspline lag per input turn', expr: `2 teeth = 360°·2/${Nf}`, v: `${fmt(720 / Nf, 2)}°` },
        { k: 'Radial flex amplitude', expr: `w = m·(N_c − N_f)/2 = one module`, v: '1 m' },
        { k: 'Reflected inertia multiplier', expr: `J_out / J_rotor = i² = ${i}²`, v: fmt(i * i) },
      ],
      power: { pin, pout: pin * eta },
    };
  }
};

/* ============================== CYCLOIDAL ============================== */
MECHS.cycloidal = {
  params: [
    { id: 'lobes', label: 'Disc lobes', type: 'seg', value: 11, rebuild: true, options: [{ v: 9, l: '9' }, { v: 11, l: '11' }, { v: 15, l: '15' }, { v: 19, l: '19' }], help: 'Ring pins = lobes + 1. The ratio equals the lobe count.' },
    { id: 'discs', label: 'Discs', type: 'seg', value: 2, rebuild: true, options: [{ v: 1, l: 'One' }, { v: 2, l: 'Two, 180° apart' }] },
    rpmParam(3000), torqueParam(1, 6),
  ],
  pitch: false, cut: [[-1, 0, 0], [0, 0, -1]], camDir: [0.32, 1.1, 0.85], visRpm: 2.4 * 60 / TAU,
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const L = P.lobes, Np = L + 1, R = 2.0, Rr = clamp(Math.PI * R / Np * 0.3, 0.08, 0.17), E = Math.min(0.55 * Rr, 0.085);
    const nO = 6, Rop = 1.1, rop = 0.15, tD = 0.3;
    const two = P.discs === 2, z1 = two ? 0.17 : 0, z2 = -0.17;
    const profile = cycloidPts(Np, R, Rr, E, 1000);
    const discGeo = rot => {
      const s = shapeFrom(rot ? rotPts(profile, rot) : profile);
      s.holes.push(circlePath(0.55)); boltHoles(s, nO, Rop, rop + E, 0);
      return extrude(s, tD, { bevel: 0.01, curve: 40 });
    };
    // Ring pins + housing
    const hs = group(mesh(ringZ(R + 0.55, R, 0.8, 0), 'housing'));
    const pinGeo = cylZ(Rr, 0.8, 0, 28);
    for (let k = 0; k < Np; k++) { const a = k * TAU / Np; const p = mesh(pinGeo, 'steel'); p.position.set(R * Math.cos(a), R * Math.sin(a), 0); hs.add(p); }
    B.add(hs, { name: 'Ring pins and housing', role: 'fixed', desc: `${Np} hardened pins on a fixed ring. The disc lobes roll against them.`, explode: [0, 0, 1.5], anchor: [(R + 0.4) * Math.cos(-0.5), (R + 0.4) * Math.sin(-0.5), 0.4], clip: true });
    // Discs (each carries its needle bearing ring)
    const mkDisc = (rot, kind) => { const g = group(mesh(discGeo(rot), kind)); g.add(mesh(ringZ(0.548, 0.47, tD - 0.02, 0), 'steel2', { noPick: false })); return g; };
    const d1 = mkDisc(0, 'steel'); d1.position.z = z1;
    B.add(d1, { name: two ? 'Cycloidal disc 1' : 'Cycloidal disc', role: 'transfer', desc: `Disc with ${L} lobes. It orbits on the eccentric and turns backwards one lobe per input turn.`, explode: [0, 0, 0.75], anchor: [1.5 * Math.cos(0.9), 1.5 * Math.sin(0.9), tD / 2 + 0.01], follow: d1 });
    let d2 = null;
    if (two) {
      d2 = mkDisc(-Math.PI / L, 'steel2'); d2.position.z = z2;
      B.add(d2, { name: 'Cycloidal disc 2', role: 'transfer', desc: 'Second disc, 180° out of phase. It balances the eccentric mass and shares the load.', explode: [0, 0, 0.1], anchor: [1.6 * Math.cos(-2.2), 1.6 * Math.sin(-2.2), -tD / 2], follow: d2 });
    }
    // Eccentric input shaft
    const sh = group(mesh(cylZ(0.22, 2.4, 0.15), 'input'));
    const cam1 = mesh(cylZ(0.47, tD, z1), 'input'); cam1.position.x = E; sh.add(cam1);
    if (two) { const cam2 = mesh(cylZ(0.47, tD, z2), 'input'); cam2.position.x = -E; sh.add(cam2); }
    B.add(sh, { name: 'Eccentric input shaft', role: 'input', desc: `Input shaft with cams offset by e. Each turn makes the disc orbit once.`, explode: [0, 0, 2.3], anchor: [0, 0, 1.33] });
    // Output flange with pins
    const fl = group(mesh(extrude(annulusShape(1.62, 0.26), 0.18, { z: -0.62 }), 'output'), mesh(cylZ(0.4, 0.75, -1.08), 'output'));
    const opGeo = cylZ(rop, 0.98, -0.07, 24);
    for (let k = 0; k < nO; k++) { const a = k * TAU / nO; const p = mesh(opGeo, 'steel'); p.position.set(Rop * Math.cos(a), Rop * Math.sin(a), 0); fl.add(p); }
    B.add(fl, { name: 'Output flange and pins', role: 'output', desc: `${nO} pins through holes ${fmt(2 * E, 2)} units wider than the pins. They follow only the slow rotation.`, explode: [0, 0, -1.0], anchor: [1.45 * Math.cos(-2.0), 1.45 * Math.sin(-2.0), -0.53] });
    let th = 0;
    return {
      update(dt) {
        th += dt * 2.4; const phi = -th / L;
        sh.rotation.z = th; fl.rotation.z = phi;
        d1.position.x = E * Math.cos(th); d1.position.y = E * Math.sin(th); d1.rotation.z = phi;
        if (d2) { d2.position.x = -E * Math.cos(th); d2.position.y = -E * Math.sin(th); d2.rotation.z = phi; }
      }
    };
  },
  calc(P) {
    const L = P.lobes, eta = 0.9, nOut = P.rpm / L, Tout = P.torque * L * eta, pin = W(P.torque, P.rpm);
    return {
      realRpm: P.rpm,
      hud: [['Ratio', `${L} : 1 (reversed)`], ['Pins / lobes', `${L + 1} / ${L}`], ['Input', `${fmt(P.rpm)} rpm`], ['Output', `${fmt(nOut)} rpm · ${fmtS(Tout)} N·m`]],
      rows: [
        { k: 'Ratio (pins fixed, output through pins)', expr: `i = N_lobes = N_pins − 1 = ${L + 1} − 1`, v: `${L} : 1` },
        { k: 'Output speed (reversed)', expr: `n_out = ${fmt(P.rpm)} / ${L}`, v: `${fmt(nOut)} rpm` },
        { k: 'Output torque', expr: `τ_out = τ·i·η = ${fmt(P.torque, 1)}·${L}·0.90`, v: `${fmtS(Tout)} N·m` },
        { k: 'Disc rotation per input turn', expr: `one lobe = 360°/${L}`, v: `${fmt(360 / L, 1)}°` },
        { k: 'Output hole size', expr: 'd_hole = d_pin + 2e', v: 'cancels wobble' },
        { k: 'Lobes sharing load at once', expr: `about one third of ${L}`, v: `≈ ${Math.round(L / 3)}` },
        { k: 'Disc orbit frequency (vibration source)', expr: `f = n_in / 60`, v: `${fmt(P.rpm / 60)} Hz` },
      ],
      power: { pin, pout: pin * eta },
    };
  }
};

/* ============================== WORM ============================== */
MECHS.worm = {
  params: [
    { id: 'nw', label: 'Wheel teeth', type: 'seg', value: 30, rebuild: true, options: [{ v: 20, l: '20' }, { v: 30, l: '30' }, { v: 40, l: '40' }, { v: 60, l: '60' }] },
    { id: 'starts', label: 'Worm starts', type: 'seg', value: 1, rebuild: true, options: [{ v: 1, l: '1' }, { v: 2, l: '2' }, { v: 3, l: '3' }, { v: 4, l: '4' }], help: 'More starts: steeper thread, lower ratio, higher efficiency.' },
    { id: 'mu', label: 'Friction coefficient μ', type: 'range', min: 0.02, max: 0.15, step: 0.01, value: 0.06, dec: 2, help: '≈ 0.03 well-lubricated steel on bronze at speed, ≈ 0.1+ at start-up.' },
    rpmParam(1500, 3000), torqueParam(1, 10),
  ],
  pitch: true, cut: null, camDir: [0.6, 0.5, 1.0], visRpm: 3.2 * 60 / TAU,
  build(B, P) {
    const Nw = P.nw, s = P.starts, m = 3.4 / Nw, r = m * Nw / 2, t = 0.6, p = Math.PI * m, lead = s * p, rw = 0.5, c = r + rw;
    const tanL = lead / (TAU * rw);
    // Worm wheel with teeth twisted to follow the thread
    const wg = gearGeo(Nw, m, t, { bore: 0, holes: { n: 5, r: r * 0.58, rad: r * 0.16 }, steps: 6 });
    const pos = wg.attributes.position, nor = wg.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), a = z * tanL / r, ca = Math.cos(a), sa = Math.sin(a);
      const x = pos.getX(i), y = pos.getY(i); pos.setXY(i, x * ca - y * sa, x * sa + y * ca);
      const nx = nor.getX(i), ny = nor.getY(i); nor.setXY(i, nx * ca - ny * sa, nx * sa + ny * ca);
    }
    const wheel = group(mesh(wg, 'output'), mesh(cylZ(0.45, t + 0.3, 0), 'output'), mesh(cylZ(0.2, 2.2, -0.35), 'steel'), mesh(boxGeo(0.06, 0.06, 0.4, 0, 0.2, 0.55), 'steel2'));
    B.add(wheel, { name: 'Worm wheel', role: 'output', desc: `Gear with ${Nw} teeth, usually bronze. Advances ${s} tooth${s > 1 ? 'teeth' : ''} per worm revolution.`.replace('toothteeth', 'teeth'), explode: [0, 0, 1.0], anchor: [r * 0.62, -r * 0.62, t / 2] });
    B.pitchCircle(r, wheel.parent, t / 2 + 0.02);
    // Worm
    const rRoot = rw - 1.25 * m, H = 2.25 * m, Lw = 3.4;
    const prof = [[-0.32 * p, 0], [0.32 * p, 0], [0.13 * p, H], [-0.13 * p, H]];
    const worm = new THREE.Group();
    worm.add(mesh(cylX(rRoot + 0.004, Lw, 0, 48), 'input'));
    const x0 = (p - lead) / 2;
    for (let j = 0; j < s; j++) worm.add(mesh(helixSweep({ r0: rRoot, prof, lead, x0: x0 + j * p, xMin: -Lw / 2 + 0.12, xMax: Lw / 2 - 0.12, perTurn: 72 }), 'input', { mat: { side: THREE.DoubleSide } }));
    worm.add(mesh(cylX(0.17, 5.6, 0), 'steel'));
    worm.add(mesh(boxGeo(0.4, 0.05, 0.05, 2.45, 0.17, 0), 'steel2'));
    worm.position.y = c;
    B.add(worm, { name: `Worm (${s}-start)`, role: 'input', desc: `Screw-like input. Lead = ${s} × pitch. Its thread slides across the wheel teeth.`, explode: [0, 1.1, 0], anchor: [-1.0, c + rw + 0.12, 0] });
    B.pitchLine([-1.9, r, t / 2 + 0.02], [1.9, r, t / 2 + 0.02], worm.parent);
    // Frame
    const yb = -(r + m + 0.4);
    const fr = group(mesh(roundBox(5.6, 1.6, 0.22, 0.08, 0, 0, 0), 'housing'));
    fr.children[0].rotation.x = Math.PI / 2; fr.children[0].position.set(0, yb - 0.11, -0.25);
    [-2.35, 2.35].forEach(x => {
      const up = mesh(boxGeo(0.32, c + 0.4 - yb, 1.0, x, (c + 0.4 + yb) / 2, -0.15), 'fixed'); fr.add(up);
      const bo = mesh(cylX(0.3, 0.42, x, 32), 'fixed'); bo.position.y = c; fr.add(bo);
    });
    fr.add(mesh(boxGeo(1.2, -yb + 0.2, 0.2, 0, yb / 2 + 0.05, -1.05), 'fixed'));
    const wb = mesh(cylZ(0.38, 0.32, -1.05), 'fixed'); fr.add(wb);
    B.add(fr, { name: 'Frame and bearings', role: 'fixed', desc: 'Holds the shafts crossed at 90° with the worm tangent to the wheel pitch circle.', explode: [0, -0.7, -0.6], anchor: [2.35, yb + 0.6, 0.36] });
    let th = 0;
    return { update(dt) { th += dt * 3.2; worm.rotation.x = th; wheel.rotation.z = Math.PI / 2 + (s / Nw) * th; } };
  },
  calc(P) {
    const i = P.nw / P.starts, q = 10, lam = Math.atan(P.starts / q), phi = Math.atan(P.mu);
    const eta = Math.tan(lam) / Math.tan(lam + phi), lock = lam <= phi;
    const etaB = lock ? 0 : Math.tan(lam - phi) / Math.tan(lam);
    const nOut = P.rpm / i, Tout = P.torque * i * eta, pin = W(P.torque, P.rpm);
    return {
      realRpm: P.rpm,
      hud: [['Ratio', `${fmt(i, 1)} : 1`], ['Efficiency', `${fmt(eta * 100)} %`], ['Back-driving', lock ? 'Self-locking' : 'Possible'], ['Output', `${fmt(nOut, 1)} rpm · ${fmtS(Tout)} N·m`]],
      rows: [
        { k: 'Ratio', expr: `i = N_wheel / starts = ${P.nw}/${P.starts}`, v: `${fmt(i, 1)} : 1` },
        { k: 'Lead angle (worm diameter factor q = d/m = 10)', expr: `λ = atan(z₁/q) = atan(${P.starts}/10)`, v: `${fmt(lam * DEG, 2)}°` },
        { k: 'Friction angle', expr: `φ = atan μ = atan ${fmt(P.mu, 2)}`, v: `${fmt(phi * DEG, 2)}°` },
        { k: 'Forward efficiency', expr: `η = tan λ / tan(λ + φ)`, v: `${fmt(eta * 100, 1)} %` },
        { k: 'Back-driving', expr: lock ? `λ ≤ φ, the wheel cannot turn the worm` : `η_back = tan(λ − φ)/tan λ`, v: lock ? '<span class="pill good">Self-locking</span>' : `<span class="pill warn">${fmt(etaB * 100)} %</span>` },
        { k: 'Output torque', expr: `τ_out = τ·i·η = ${fmt(P.torque, 1)}·${fmt(i, 1)}·${fmt(eta, 2)}`, v: `${fmtS(Tout)} N·m` },
        { k: 'Heat to dissipate', expr: `P_loss = P_in·(1 − η)`, v: `${fmtS(pin * (1 - eta))} W` },
      ],
      power: { pin, pout: pin * eta },
    };
  }
};

/* ============================== QDD ============================== */
const QDD_SETS = { 6: { S: 12, R: 60 }, 7: { S: 12, R: 72 }, 9: { S: 10, R: 80 } };
MECHS.qdd = {
  params: [
    { id: 'ratio', label: 'Planetary ratio', type: 'seg', value: 6, rebuild: true, options: [{ v: 6, l: '6:1' }, { v: 7, l: '7:1' }, { v: 9, l: '9:1' }] },
    { id: 'amps', label: 'Motor current', type: 'range', min: 0, max: 40, step: 1, value: 24, unit: 'A', live: true },
    rpmParam(1500, 4000, 'Motor speed'),
  ],
  pitch: true, cut: [[-1, 0, 0], [0, 0, -1]], camDir: [0.5, 1.0, 0.95], visRpm: 2.4 * 60 / TAU, defaultCut: true,
  build(B, P) {
    B.root.rotation.x = -Math.PI / 2;
    const { S, R } = QDD_SETS[P.ratio], m = 2.24 / R, t = 0.36;
    // Housing (fixed)
    const hous = group(
      mesh(ringZ(2.62, 2.52, 1.06, -0.09), 'housing'),
      mesh(extrude(annulusShape(2.62, 1.1), 0.08, { z: 0.4 }), 'housing'),
      mesh(ringZ(1.1, 0.97, 0.1, 0.38), 'steel2'),
    );
    const back = extrude(boltHoles(annulusShape(2.62, 0), 6, 2.25, 0.07), 0.08, { z: -0.58 });
    hous.add(mesh(back, 'housing'));
    B.add(hous, { name: 'Housing', role: 'fixed', desc: 'Aluminium case. The stator and ring gear bolt to it, and the output runs in a crossed-roller bearing.', explode: [0, 0, 3.0], anchor: [2.62 * Math.cos(-0.35), 2.62 * Math.sin(-0.35), 0.1], clip: true });
    // Stator, windings
    const st = group(mesh(statorGeo(24, 1.3, 1.55, 2.2, 0.14, 0.06, 0.8, 0.42), 'lam'));
    B.add(st, { name: 'Stator', role: 'fixed', desc: '24-slot laminated stator with a large bore. The gearbox sits inside it, which keeps the actuator flat.', explode: [0, 0, 0], anchor: [1.85 * Math.cos(2.0), 1.85 * Math.sin(2.0), 0.22] });
    const { g: coilG, coils } = coilMeshes(24, 0.14, 0.42, 1.58, 0.52);
    B.add(coilG, { name: 'Windings', role: 'fixed', desc: 'Three-phase copper coils. Current here is what you control.', explode: [0, 0, 0.3], anchor: [1.85 * Math.cos(-2.6), 1.85 * Math.sin(-2.6), 0.33] });
    // Rotor (input to the gearbox)
    const rot = new THREE.Group();
    rot.add(mesh(ringZ(2.42, 2.3, 0.64, -0.04), 'input'));
    const rp = boltHoles(annulusShape(2.42, 0.0), 8, 1.65, 0.28, Math.PI / 8);
    rot.add(mesh(extrude(rp, 0.06, { z: -0.39 }), 'input'));
    rot.add(mesh(cylZ(0.28, 0.12, -0.46), 'input'));
    B.add(rot, { name: 'Rotor', role: 'input', desc: 'Large-diameter outer rotor. Torque grows with rotor radius, so a wide, flat motor is strong.', explode: [0, 0, -1.1], anchor: [2.42 * Math.cos(-0.9), 2.42 * Math.sin(-0.9), -0.34], clip: true });
    const mags = magnetRing(28, 2.235, 2.3, 0.42);
    B.add(mags, { name: 'Magnets (28 poles)', role: 'input', desc: 'Many poles give smooth torque at low speed.', explode: [0, 0, -1.1], anchor: [-2.27, 0.3, 0.21], clip: true, label: false });
    // Encoder
    const encM = group(mesh(extrude(sectorShape(0, 0.13, 0, Math.PI), 0.05, { z: -0.545, bevel: 0 }), 'magN'), mesh(extrude(sectorShape(0, 0.13, Math.PI, TAU), 0.05, { z: -0.545, bevel: 0 }), 'magS'));
    const pcb = mesh(ringZ(0.55, 0.0, 0.04, -0.61), 'pcb');
    const enc = group(pcb); enc.add(mesh(boxGeo(0.14, 0.14, 0.03, 0, 0, -0.58), 'dark'));
    B.add(enc, { name: 'Encoder', role: 'sensor', desc: 'Magnetic encoder reads the diametric magnet on the rotor: rotor angle for commutation and joint angle via the ratio.', explode: [0, 0, -2.0], anchor: [0, -0.5, -0.63] });
    B.add(encM, { name: 'Encoder magnet', role: 'input', desc: 'Diametrically magnetized disc that spins with the rotor.', explode: [0, 0, -1.6], anchor: [0, 0, -0.55], label: false });
    // Planetary stage inside the stator bore
    const pl = buildPlanetary(B, {
      S, R, n: 3, m, t, z: 0, roles: { sun: 'input', carrier: 'output', ring: 'fixed' }, pinR: 0.07, plateT: 0.12, plateR: 1.04, carrierSide: 'front',
      sunShaft: { r: 0.075, h: 0.6, z: -0.3 }, ringOuter: 1.3, clipRing: false, clipCarrier: true,
      carrierName: 'Carrier and output flange',
      carrierExtra: (c) => { c.add(mesh(extrude(boltHoles(annulusShape(0.95, 0.16), 6, 0.68, 0.06), 0.16, { z: 0.44 }), 'output')); c.add(mesh(cylZ(0.42, 0.1, 0.35), 'output')); },
      carrierAnchor: [0.68 * Math.cos(0.5), 0.68 * Math.sin(0.5), 0.53],
      ex: { sun: 0.8, planets: 1.45, carrier: 2.2, ring: 0.35 },
      desc: {
        sun: 'Small gear on the rotor shaft, the input to the gearbox.',
        planets: '3 planets share the load. One stage only, so friction stays low.',
        carrier: `Holds the planet pins and forms the output flange. It turns ${P.ratio}× slower than the rotor.`,
        ring: 'Internal gear fixed to the stator mount and housing.'
      }
    });
    let th = 0, gain = 0.25 + 1.0 * P.amps / 40;
    return {
      update(dt) {
        th += dt * 2.4;
        rot.rotation.z = th; mags.rotation.z = th; encM.rotation.z = th;
        pl.set(th, th * S / (S + R));
        commutate(coils, 'AabBCcaABbcC', 14 * th + Math.PI / 2, gain);
      },
      setParams(p) { gain = 0.25 + 1.0 * p.amps / 40; }
    };
  },
  calc(P) {
    const Kt = 0.07, J = 0.6, i = P.ratio, eta = 0.93;
    const Tm = Kt * P.amps, Tout = Tm * i * eta, nOut = P.rpm / i, Jr = J * i * i, pin = W(Tm, P.rpm);
    const bars = [[`QDD ${i}:1`, Jr], ['2-stage planetary 36:1', J * 36 * 36], ['Strain wave 100:1', J * 100 * 100]];
    const lmax = Math.log10(J * 100 * 100 * 1.5), lmin = Math.log10(5);
    const bw = 220, x0 = 128;
    const svg = `<div class="mini-chart" style="margin-top:14px"><div class="calc-k">Rotor inertia felt at the output, same motor (log scale)</div>
      <svg viewBox="0 0 360 ${bars.length * 30 + 22}" role="img" aria-label="Reflected inertia comparison">
      ${bars.map(([l, v], k) => { const w2 = Math.max(4, (Math.log10(v) - lmin) / (lmax - lmin) * bw); const y = 6 + k * 30; return `<text class="axis-t" x="${x0 - 8}" y="${y + 13}" text-anchor="end" style="fill:var(--ink-2)">${l}</text><rect x="${x0}" y="${y + 3}" width="${w2.toFixed(1)}" height="14" rx="3" fill="${k === 0 ? 'var(--chart-line)' : 'var(--role-fixed)'}"/><text class="axis-t" x="${(x0 + w2 + 6).toFixed(1)}" y="${y + 14}" style="fill:var(--ink)">${fmt(v)} kg·cm²</text>`; }).join('')}
      </svg><p class="chart-cap">Inertia scales with i². A 100:1 joint makes the same rotor feel ${fmt(10000 / (i * i))}× heavier than this QDD during an impact.</p></div>`;
    return {
      realRpm: P.rpm,
      hud: [['Ratio', `${i} : 1`], ['Output torque', `${fmtS(Tout)} N·m`], ['Output speed', `${fmt(nOut)} rpm`], ['Reflected inertia', `${fmt(Jr, 1)} kg·cm²`]],
      rows: [
        { k: 'Motor torque (Kt = 0.07 N·m/A, Mini-Cheetah-class motor)', expr: `τ_m = Kt·I = 0.07·${P.amps}`, v: `${fmt(Tm, 2)} N·m` },
        { k: 'Output torque', expr: `τ_out = τ_m·i·η = ${fmt(Tm, 2)}·${i}·0.93`, v: `${fmtS(Tout)} N·m` },
        { k: 'Torque estimate from current alone', expr: `τ̂ = Kt·I·i·η, no torque sensor needed`, v: `${fmtS(Tout)} N·m` },
        { k: 'Output speed', expr: `n_out = ${fmt(P.rpm)} / ${i}`, v: `${fmt(nOut)} rpm` },
        { k: 'Reflected rotor inertia (J_rotor = 0.6 kg·cm²)', expr: `J_out = J·i² = 0.6·${i}²`, v: `${fmt(Jr, 1)} kg·cm²` },
        { k: 'Motor friction felt at output (0.02 N·m at motor)', expr: `τ_f·i/η = 0.02·${i}/0.93`, v: `${fmt(0.02 * i / eta, 2)} N·m` },
      ],
      power: { pin, pout: pin * eta },
      extra: svg,
    };
  }
};

/* ============================== SEA ============================== */
class SpokeCurve extends THREE.Curve {
  constructor() { super(); this.r1 = 0.6; this.r2 = 1.45; this.a1 = 0; this.a2 = 1; this.z = 0; }
  getPoint(u, target = new THREE.Vector3()) {
    const s = u * u * (3 - 2 * u), r = this.r1 + (this.r2 - this.r1) * u, a = this.a1 + (this.a2 - this.a1) * s;
    return target.set(r * Math.cos(a), r * Math.sin(a), this.z);
  }
}
MECHS.sea = {
  params: [
    { id: 'k', label: 'Spring stiffness k', type: 'range', min: 40, max: 600, step: 10, value: 150, unit: 'N·m/rad', live: true },
    { id: 'mass', label: 'Payload mass (arm 0.35 m)', type: 'range', min: 1, max: 10, step: 0.5, value: 5, unit: 'kg', dec: 1, live: true },
    { id: 'amp', label: 'Swing amplitude', type: 'range', min: 10, max: 80, step: 5, value: 45, unit: '°', live: true },
    { id: 'freq', label: 'Swing frequency', type: 'range', min: 0.1, max: 1.2, step: 0.05, value: 0.4, unit: 'Hz', dec: 2, live: true },
    { id: 'bits', label: 'Encoder resolution', type: 'seg', value: 17, live: true, options: [{ v: 14, l: '14-bit' }, { v: 17, l: '17-bit' }, { v: 19, l: '19-bit' }] },
  ],
  pitch: false, cut: null, camDir: [0.8, 0.35, 1.0], foot: 'Real time at 1× speed',
  build(B, P) {
    const Lm = 0.35, g = 9.81;
    // Motor + reducer housings
    const motor = group(mesh(cylZ(0.85, 1.7, -2.55, 56), 'housing'));
    for (let k = 0; k < 7; k++) motor.add(mesh(ringZ(0.95, 0.84, 0.07, -3.25 + k * 0.2, { bevel: 0.01 }), 'housing'));
    motor.add(mesh(boxGeo(0.4, 0.35, 0.5, 0, 0.92, -2.4), 'dark'));
    B.add(motor, { name: 'Motor', role: 'fixed', desc: 'Brushless motor. Its housing is fixed; its rotor drives the reducer.', explode: [0, 0, -1.3], anchor: [0, 1.1, -2.6] });
    const red = group(mesh(cylZ(1.0, 1.15, -1.12, 56), 'fixed'), mesh(ringZ(1.05, 0.62, 0.08, -0.56), 'fixed'));
    B.add(red, { name: 'Strain wave reducer 50:1', role: 'fixed', desc: 'High-ratio, high-friction gearbox. On its own it is stiff and not backdrivable.', explode: [0, 0, -0.65], anchor: [0, 1.0, -1.1] });
    const menc = group(mesh(ringZ(0.6, 0.0, 0.05, -3.45), 'pcb'), mesh(boxGeo(0.16, 0.16, 0.04, 0, 0, -3.49), 'dark'));
    B.add(menc, { name: 'Motor encoder', role: 'sensor', desc: 'Reads the motor angle. Divided by the ratio, it gives the spring hub angle θ_hub.', explode: [0, 0, -2.0], anchor: [0, -0.6, -3.47] });
    // Gearbox output hub = spring inner hub
    const hub = group(mesh(cylZ(0.62, 0.14, -0.42), 'input'), mesh(ringZ(0.62, 0.22, 0.22, 0), 'input'), mesh(boxGeo(0.08, 0.3, 0.05, 0, 0.42, 0.13), 'dark'));
    B.add(hub, { name: 'Gearbox output hub', role: 'input', desc: 'Spring inner hub, driven by the reducer. Angle θ_hub.', explode: [0, 0, 0.2], anchor: [0, 0, 0.12] });
    // Spokes
    const spokes = new THREE.Group(), curves = [], sMeshes = [];
    const sm = mat('elastic');
    for (let j = 0; j < 6; j++) { const c = new SpokeCurve(); curves.push(c); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.055, 6), sm); m.castShadow = true; spokes.add(m); sMeshes.push(m); }
    B.add(spokes, { name: 'Torsion spring', role: 'elastic', desc: 'Flexure spokes between hub and ring. Their twist Δθ = τ/k is the torque measurement.', explode: [0, 0, 0.45], anchor: [-1.05, 0.15, 0.06] });
    // Output ring + arm + payload
    const out = new THREE.Group();
    out.add(mesh(ringZ(1.72, 1.45, 0.22, 0), 'output'));
    out.add(mesh(ringZ(1.82, 1.73, 0.05, -0.08), 'dark'));
    const armS = roundRectShape(0.34, 1.15, 0.1, 0, -2.05); out.add(mesh(extrude(armS, 0.16, { z: 0.2 }), 'output'));
    B.add(out, { name: 'Output ring and arm', role: 'output', desc: 'Spring outer ring, bolted to the link. Angle θ_out.', explode: [0, 0, 0.9], anchor: [1.25, 1.0, 0.11], follow: out });
    const pay = group(mesh(cylZ(0.42, 0.42, 0.2), 'dark'));
    pay.children[0].position.y = -2.62;
    B.add(pay, { name: 'Payload', role: 'transfer', desc: 'The load. Gravity and inertia make the torque that twists the spring.', explode: [0, 0, 0.9], anchor: [0.3, -2.62, 0.42], follow: pay });
    const head = group(mesh(boxGeo(0.34, 0.22, 0.3, 0, 1.95, -0.08), 'pcb'));
    B.add(head, { name: 'Output encoder', role: 'sensor', desc: 'Reads the code ring on the output: θ_out. Torque = k·(θ_hub − θ_out).', explode: [0, 0.5, 0], anchor: [0, 2.07, -0.08] });
    // Bracket
    const br = group(mesh(boxGeo(1.4, 2.5, 0.25, 0, -1.95, -2.2), 'housing'), mesh(boxGeo(2.4, 0.18, 2.4, 0, -3.16, -1.7), 'housing'));
    B.add(br, { name: 'Bracket', role: 'fixed', desc: 'Holds the actuator. Reaction torque goes to ground through here.', explode: [0, -0.6, -0.8], anchor: [0.7, -2.4, -2.07], label: false });
    let t = 0; const live = { tau: 0, dth: 0, tho: 0 };
    let p = { ...P };
    const update = dt => {
      t += dt;
      const A = p.amp / DEG, w = TAU * p.freq;
      const tho = A * Math.sin(w * t), acc = -A * w * w * Math.sin(w * t);
      const tau = p.mass * g * Lm * Math.sin(tho) + p.mass * Lm * Lm * acc;
      const dth = clamp(tau / p.k, -0.7, 0.7), thh = tho + dth;
      live.tau = tau; live.dth = dth; live.tho = tho;
      out.rotation.z = tho; pay.rotation.z = tho; hub.rotation.z = thh;
      curves.forEach((c, j) => {
        const b = j * TAU / 6; c.a1 = b + thh; c.a2 = b + tho + 0.95; c.z = 0;
        sMeshes[j].geometry.dispose(); sMeshes[j].geometry = new THREE.TubeGeometry(c, 24, 0.055, 6);
      });
    };
    return {
      update,
      setParams(np) { p = { ...np }; },
      onFrame() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('sea-tau', `${fmt(live.tau, 1)} N·m`); set('sea-dth', `${fmt(live.dth * DEG, 2)}°`);
        set('sea-tho', `${fmt(live.tho * DEG, 1)}°`); set('sea-cnt', fmt(Math.round(live.dth / (TAU / Math.pow(2, p.bits)))));
      },
      dispose() { sm.dispose(); }
    };
  },
  calc(P) {
    const Lm = 0.35, g = 9.81, A = P.amp / DEG, w = TAU * P.freq, J = P.mass * Lm * Lm;
    const tPk = P.mass * g * Lm * Math.sin(A) + J * A * w * w;
    const res = P.k * TAU / Math.pow(2, P.bits), fn = Math.sqrt(P.k / J) / TAU;
    const live = `<div style="margin-top:14px"><div class="calc-k" style="margin-bottom:6px">Live readings from the animation</div><div class="live-grid">
      <div class="live-cell"><div class="k">Torque τ = k·Δθ</div><div class="v" id="sea-tau">—</div></div>
      <div class="live-cell"><div class="k">Spring twist Δθ</div><div class="v" id="sea-dth">—</div></div>
      <div class="live-cell"><div class="k">Output angle θ_out</div><div class="v" id="sea-tho">—</div></div>
      <div class="live-cell"><div class="k">Encoder counts of twist</div><div class="v" id="sea-cnt">—</div></div></div></div>`;
    return {
      hud: [['Spring k', `${P.k} N·m/rad`], ['Peak torque', `≈ ${fmt(tPk, 1)} N·m`], ['Peak twist', `≈ ${fmt(clamp(tPk / P.k, 0, 0.7) * DEG, 1)}°`], ['Torque resolution', `${fmt(res * 1000, 1)} mN·m`]],
      foot: 'Real time at 1× speed',
      rows: [
        { k: 'Torque from spring twist', expr: `τ = k·(θ_hub − θ_out)`, v: `k = ${P.k}` },
        { k: 'Peak load torque (gravity + inertia)', expr: `m·g·L·sin A + m·L²·A·ω²`, v: `${fmt(tPk, 1)} N·m` },
        { k: 'Peak spring twist', expr: `Δθ = τ / k = ${fmt(tPk, 1)} / ${P.k}`, v: `${fmt(tPk / P.k * DEG, 2)}°` },
        { k: 'Torque resolution', expr: `k·2π / 2^${P.bits}`, v: `${fmt(res * 1000, 2)} mN·m` },
        { k: 'Spring–payload natural frequency', expr: `f_n = √(k / m·L²) / 2π`, v: `${fmt(fn, 1)} Hz` },
        { k: 'Motor turns per output degree', expr: `N = 50, so 1° at the hub is 50° at the motor`, v: '50×' },
      ],
      extra: live + `<p class="chart-cap">Softer springs give finer torque resolution and better shock protection but a lower natural frequency, which caps how fast the joint can move a load.</p>`,
    };
  }
};

/* ============================== SCREW ============================== */
MECHS.screw = {
  params: [
    { id: 'variant', label: 'Type', type: 'seg', value: 'ball', rebuild: true, options: [{ v: 'ball', l: 'Ball screw' }, { v: 'roller', l: 'Roller screw' }, { v: 'lead', l: 'Lead screw' }] },
    { id: 'lead', label: 'Lead L', type: 'seg', value: 10, rebuild: true, options: [{ v: 2, l: '2 mm' }, { v: 5, l: '5 mm' }, { v: 10, l: '10 mm' }, { v: 20, l: '20 mm' }] },
    { id: 'dia', label: 'Screw diameter', type: 'seg', value: 16, options: [{ v: 12, l: '12' }, { v: 16, l: '16' }, { v: 25, l: '25' }, { v: 32, l: '32 mm' }], help: 'Used for lead angle and lead-screw efficiency.' },
    torqueParam(2, 10, 0.1, 'Motor torque'), rpmParam(1000, 3000, 'Motor speed'),
  ],
  pitch: false, cut: [[0, -1, 0], [0, 0, -1]], camDir: [0.3, 0.55, 1.0], zoom: 0.9, defaultCut: true,
  build(B, P) {
    const v = P.variant, pv = 0.12 + P.lead * 0.03;
    let rCore, prof, lead = pv, starts = 1, pitch = pv, ballR = 0, rb = 0.36, nutRo = 0.62;
    if (v === 'ball') { ballR = Math.min(0.085, 0.28 * pv); rCore = rb - ballR * 0.55; prof = [[-0.25 * pv, 0], [0.25 * pv, 0], [0.13 * pv, ballR * 1.15], [-0.13 * pv, ballR * 1.15]]; }
    else if (v === 'roller') { pitch = 0.06; starts = Math.max(1, Math.round(pv / pitch)); lead = starts * pitch; rCore = 0.3; prof = [[-0.46 * pitch, 0], [0.46 * pitch, 0], [0, 0.05]]; nutRo = 0.76; }
    else { rCore = 0.3; const h = Math.min(0.12, 0.3 * pv); prof = [[-0.36 * pv, 0], [0.36 * pv, 0], [0.16 * pv, h], [-0.16 * pv, h]]; }
    const crest = rCore + Math.max(...prof.map(q => q[1]));
    // Screw
    const scr = new THREE.Group();
    scr.add(mesh(cylX(rCore + 0.003, 7.4, 0.17, 48), 'input'));
    for (let j = 0; j < starts; j++) scr.add(mesh(helixSweep({ r0: rCore, prof, lead, x0: j * pitch, xMin: -3.5, xMax: 3.85, perTurn: v === 'roller' ? 40 : 56 }), 'input', { mat: { side: THREE.DoubleSide } }));
    scr.add(mesh(cylX(0.2, 0.75, -3.92), 'steel')); scr.add(mesh(cylX(0.2, 0.6, 4.1), 'steel'));
    B.add(scr, { name: v === 'ball' ? 'Ball screw shaft' : v === 'roller' ? 'Roller screw shaft' : 'Lead screw (trapezoidal)', role: 'input', desc: v === 'roller' ? `Multi-start fine thread (${starts} starts) giving the selected lead.` : `Hardened shaft with a helical ${v === 'ball' ? 'ball groove' : 'trapezoidal thread'}, lead ${P.lead} mm per turn.`, explode: [0, 0, 0], anchor: [2.7, crest, 0.1] });
    const coup = group(mesh(cylX(0.27, 0.45, -4.27), 'input'), mesh(cylX(0.28, 0.04, -4.27), 'dark'));
    B.add(coup, { name: 'Coupling', role: 'input', desc: 'Joins motor and screw while absorbing small misalignment.', explode: [-0.4, 0, 0], label: false });
    // Nut
    const nut = new THREE.Group();
    const nutRi = v === 'roller' ? 0.6 : crest + 0.012;
    nut.add(mesh(ringX(nutRo, nutRi, 1.3, 0), 'output'));
    nut.add(mesh(ringX(nutRo + 0.28, nutRi, 0.16, -0.57), 'output'));
    const turns = 3, carry = new THREE.Group();
    let balls = null, loop = null, rollers = [];
    if (v === 'ball') {
      const delta = (((pv / 2 + turns * pv / 2) % pv) + pv) % pv - pv / 2;
      const xs = -turns * pv / 2 + delta, xe = turns * pv / 2 + delta;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(xe, rb, 0), new THREE.Vector3(xe + 0.02, rb + 0.18, 0), new THREE.Vector3(xe - 0.12, nutRo + 0.12, 0),
        new THREE.Vector3(xs + 0.12, nutRo + 0.12, 0), new THREE.Vector3(xs - 0.02, rb + 0.18, 0), new THREE.Vector3(xs, rb, 0)], false, 'centripetal');
      nut.add(mesh(new THREE.TubeGeometry(curve, 48, ballR + 0.03, 12), 'steel', { noPick: false }));
      const G = turns * Math.hypot(TAU * rb, pv), Rl = curve.getLength(), total = G + Rl;
      const Nb = Math.floor(total / (2.08 * ballR));
      balls = new THREE.InstancedMesh(new THREE.SphereGeometry(ballR, 14, 10), mat('chrome'), Nb);
      balls.castShadow = true; balls.frustumCulled = false; carry.add(balls);
      loop = { G, Rl, total, Nb, curve, xs, s0: 0 };
    } else if (v === 'roller') {
      const rr = 0.125, rOrb = 0.35 + rr - 0.005, Lr = 1.05, prof2 = [];
      for (let k = 0; k <= 42; k++) prof2.push(new THREE.Vector2(k % 2 ? rr : rr - 0.022, -Lr / 2 + Lr * k / 42));
      const rg = new THREE.LatheGeometry(prof2, 18); rg.rotateZ(-Math.PI / 2);
      for (let k = 0; k < 7; k++) { const holder = new THREE.Group(); const rm = mesh(rg, 'steel2'); holder.add(rm); carry.add(holder); rollers.push({ holder, rm, a: k * TAU / 7, rOrb }); }
    }
    B.add(nut, { name: v === 'roller' ? 'Roller nut' : 'Nut', role: 'output', desc: v === 'ball' ? 'Ball nut with a return tube. Balls roll in the groove and recirculate.' : v === 'roller' ? 'Nut with 7 threaded rollers orbiting the screw. Many contact lines carry high loads.' : 'Plain threaded nut, often bronze or polymer. Sliding contact.', explode: [0, 1.0, 0], anchor: [0.35, nutRo, 0.45], follow: nut, clip: true });
    if (balls) B.add(carry, { name: 'Recirculating balls', role: 'transfer', desc: 'Steel balls roll at half the surface speed, leave the groove after 3 turns and return through the tube.', explode: [0, 1.0, 0], anchor: [-0.3, nutRo + 0.16, 0], follow: carry });
    if (rollers.length) B.add(carry, { name: 'Threaded rollers', role: 'transfer', desc: 'Rollers mesh with both the screw and the nut thread, orbiting like planets.', explode: [0, 1.0, 0], anchor: [0.2, 0.47, 0.2], follow: carry });
    // Carriage
    const yP = nutRo;
    const car = group(mesh(boxGeo(1.4, 0.13, 2.6, 0, yP + 0.065, 0), 'output'));
    [-1.15, 1.15].forEach(z => { car.add(mesh(boxGeo(0.9, yP + 0.5, 0.12, 0, (yP - 0.5) / 2, z), 'output')); car.add(mesh(boxGeo(0.9, 0.35, 0.5, 0, -0.675, z), 'steel2')); });
    B.add(car, { name: 'Carriage', role: 'output', desc: 'Moves on linear guides. The guides stop the nut from turning, which forces it to translate.', explode: [0, 1.0, 0], anchor: [0.4, yP + 0.13, -1.0], follow: car });
    // Frame: base, rails, supports, motor
    const fr = group(mesh(boxGeo(10.2, 0.12, 3.0, -0.6, -1.16, 0), 'housing'));
    [-1.15, 1.15].forEach(z => fr.add(mesh(boxGeo(8.4, 0.25, 0.22, 0.1, -0.975, z), 'steel')));
    fr.add(mesh(boxGeo(0.4, 1.55, 1.0, -3.85, -0.33, 0), 'fixed'));
    fr.add(mesh(boxGeo(0.35, 1.45, 0.9, 4.12, -0.38, 0), 'fixed'));
    B.add(fr, { name: 'Bearings, rails and base', role: 'fixed', desc: 'Fixed bearing block takes the axial thrust; the far end only supports. Rails guide the carriage.', explode: [0, -0.5, 0], anchor: [4.12, 0.34, 0.2] });
    const mg = roundBox(1.0, 1.0, 1.05, 0.12); mg.rotateY(Math.PI / 2); mg.translate(-5.05, 0, 0);
    const mot = group(mesh(mg, 'dark'), mesh(boxGeo(0.12, 1.15, 1.15, -4.5, 0, 0), 'housing'), mesh(boxGeo(1.0, 0.55, 0.9, -5.05, -0.83, 0), 'housing'));
    B.add(mot, { name: 'Servo motor', role: 'fixed', desc: 'Motor housing is fixed; its shaft turns the screw through the coupling.', explode: [-0.8, 0, 0], anchor: [-5.05, 0.5, 0] });
    // Motion
    const lv = v === 'roller' ? lead : pv;
    let phase = 0, th = 0, xn = 0;
    const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
    const place = () => {
      nut.position.x = xn; car.position.x = xn; carry.position.x = xn; scr.rotation.x = th; coup.rotation.x = th;
      if (balls) {
        const { G, total, Nb, curve, xs } = loop, perTurn = G / turns;
        for (let i = 0; i < Nb; i++) {
          const s = ((loop.s0 + i * total / Nb) % total + total) % total;
          if (s < G) { const q = s / perTurn, a = TAU * q; m4.makeTranslation(xs + q * pv, rb * Math.cos(a), rb * Math.sin(a)); }
          else { curve.getPointAt((s - G) / loop.Rl, tmp); m4.makeTranslation(tmp.x, tmp.y, tmp.z); }
          balls.setMatrixAt(i, m4);
        }
        balls.instanceMatrix.needsUpdate = true;
      }
      if (rollers.length) {
        const rs = 0.35 - 0.025, rr = 0.125 - 0.011, thc = th * rs / (2 * (rs + rr));
        rollers.forEach(r => { const a = r.a + thc; r.holder.position.set(0, r.rOrb * Math.cos(a), r.rOrb * Math.sin(a)); r.rm.rotation.x = thc - (th - thc) * rs / rr; });
      }
    };
    place();
    return {
      update(dt) {
        phase += dt * 0.11;
        const u = phase % 1, tri = u < 0.5 ? (u * 4 - 1) : (3 - u * 4);
        const xNew = 2.2 * tri, dx = xNew - xn;
        const dth = -dx * TAU / lv;
        th += dth; xn = xNew;
        if (loop) loop.s0 += (dth / 2) * Math.hypot(rb, pv / TAU);
        place();
      }
    };
  },
  calc(P) {
    const L = P.lead / 1000, d = P.dia / 1000, lam = Math.atan(L / (Math.PI * d)), mu = 0.15, phi = Math.atan(mu);
    let eta, etaB, lock = false;
    if (P.variant === 'ball') { eta = 0.9; etaB = 0.85; }
    else if (P.variant === 'roller') { eta = 0.85; etaB = 0.8; }
    else { eta = Math.tan(lam) / Math.tan(lam + phi); lock = lam <= phi; etaB = lock ? 0 : Math.tan(lam - phi) / Math.tan(lam); }
    const F = TAU * eta * P.torque / L, vmm = P.rpm * P.lead / 60, pin = W(P.torque, P.rpm), pout = F * vmm / 1000;
    const Thold = 1000 * L * etaB / TAU;
    return {
      realRpm: P.rpm, foot: null,
      hud: [['Thrust', `${fmtS(F / 1000)} kN`], ['Linear speed', `${fmt(vmm, 1)} mm/s`], ['Efficiency', `${fmt(eta * 100)} %`], ['Backdrives', lock ? 'No (self-locking)' : 'Yes']],
      rows: [
        { k: 'Lead angle', expr: `λ = atan(L / π·d) = atan(${P.lead} / π·${P.dia})`, v: `${fmt(lam * DEG, 2)}°` },
        { k: 'Efficiency', expr: P.variant === 'lead' ? `η = tan λ / tan(λ + φ), μ = 0.15` : P.variant === 'ball' ? 'rolling balls, typical' : 'rolling threads, typical', v: `${fmt(eta * 100, 1)} %` },
        { k: 'Thrust force', expr: `F = 2π·η·T / L = 2π·${fmt(eta, 2)}·${fmt(P.torque, 1)} / ${P.lead} mm`, v: `${fmtS(F / 1000)} kN` },
        { k: 'Linear speed', expr: `v = n·L = ${fmt(P.rpm)}·${P.lead} / 60`, v: `${fmt(vmm, 1)} mm/s` },
        { k: 'Back-driving', expr: lock ? 'λ ≤ φ, a load cannot spin the screw' : `torque on motor from a 1 kN load = F·L·η_b / 2π`, v: lock ? '<span class="pill good">Self-locking</span>' : `<span class="pill warn">${fmt(Thold, 2)} N·m</span>` },
      ],
      power: { pin, pout },
    };
  }
};

/* ============================== CYLINDER ============================== */
MECHS.cylinder = {
  params: [
    { id: 'medium', label: 'Working fluid', type: 'seg', value: 'oil', rebuild: true, options: [{ v: 'oil', l: 'Hydraulic oil' }, { v: 'air', l: 'Compressed air' }] },
    { id: 'bore', label: 'Bore D', type: 'seg', value: 63, options: [{ v: 32, l: '32' }, { v: 63, l: '63' }, { v: 100, l: '100' }, { v: 160, l: '160 mm' }] },
    { id: 'rod', label: 'Rod diameter d / D', type: 'seg', value: 0.56, rebuild: true, options: [{ v: 0.45, l: '0.45' }, { v: 0.56, l: '0.56' }, { v: 0.7, l: '0.70' }] },
    { id: 'pOil', label: 'Pressure', type: 'range', min: 20, max: 350, step: 5, value: 210, unit: 'bar', show: P => P.medium === 'oil' },
    { id: 'pAir', label: 'Pressure', type: 'range', min: 1, max: 10, step: 0.5, value: 6, unit: 'bar', dec: 1, show: P => P.medium === 'air' },
    { id: 'qOil', label: 'Pump flow Q', type: 'range', min: 5, max: 150, step: 5, value: 40, unit: 'L/min', show: P => P.medium === 'oil' },
    { id: 'qAir', label: 'Air flow Q (at working pressure)', type: 'range', min: 20, max: 600, step: 10, value: 150, unit: 'L/min', show: P => P.medium === 'air' },
  ],
  pitch: false, cut: [[0, -1, 0], [0, 0, -1]], camDir: [0.32, 0.5, 1.0], zoom: 0.9,
  build(B, P) {
    const air = P.medium === 'air', fl = air ? 'air' : 'oil';
    const rB = 0.775, rRod = rB * P.rod * 0.92, xCap = -3.0, xHead = 1.6, pT = 0.36, Lrod = 5.0;
    const xMin = -2.55, xMax = 1.05;
    // Barrel, caps, ports
    const bar = group(mesh(ringX(0.9, 0.78, xHead - xCap, (xHead + xCap) / 2), air ? 'fixed' : 'housing'));
    [-2.75, 1.32].forEach(x => { const pp = mesh(cylY(0.11, 0.3, 1.0), 'steel2'); pp.position.x = x; bar.add(pp); });
    B.add(bar, { name: 'Barrel', role: 'fixed', desc: 'Honed steel tube. Its smooth bore lets the piston seals hold pressure.', explode: [0, 1.4, 0], anchor: [-0.6, 0.9, 0.3], clip: true });
    const caps = group(mesh(cylX(0.96, 0.3, xCap - 0.15), 'fixed'), mesh(ringX(0.96, rRod + 0.01, 0.36, xHead + 0.18), 'fixed'), mesh(ringX(rRod + 0.06, rRod + 0.005, 0.06, xHead + 0.39), 'rubber'));
    const eye = mesh(ringZ(0.3, 0.13, 0.45, 0), 'fixed'); eye.position.x = xCap - 0.62; caps.add(eye); caps.add(mesh(boxGeo(0.35, 0.35, 0.45, xCap - 0.42, 0, 0), 'fixed'));
    B.add(caps, { name: 'End caps and gland', role: 'fixed', desc: 'Cap end with mounting eye; head end with rod seal and wiper that keeps dirt out.', explode: [0, 0.6, 0], anchor: [xHead + 0.2, 0.96, 0.2], clip: true });
    // Fluid chambers (unit length, scaled)
    const capF = mesh(cylX(rB - 0.004, 1, 0.5, 48), fl, { clip: true, noPick: false });
    capF.position.x = xCap;
    const rodF = mesh(ringX(rB - 0.004, rRod + 0.004, 1, 0.5, { bevel: 0 }), fl, { clip: true });
    B.add(capF, { name: 'Cap-end chamber', role: 'fluid', desc: 'Full-bore side. Pressure here pushes on the whole piston area A = πD²/4.', anchor: [-2.6, -0.45, 0.55] });
    B.add(rodF, { name: 'Rod-end chamber', role: 'fluid', desc: 'Ring-shaped side around the rod. Smaller area, so less force but faster for the same flow.', anchor: [1.25, -0.45, 0.55] });
    // Piston + rod
    const pis = group(mesh(cylX(rB - 0.002, pT, 0, 48), 'output'), mesh(ringX(rB + 0.001, rB - 0.06, 0.05, -0.1), 'rubber'), mesh(ringX(rB + 0.001, rB - 0.06, 0.05, 0.1), 'rubber'));
    B.add(pis, { name: 'Piston and seals', role: 'output', desc: 'Separates the two chambers. Force = pressure × area.', explode: [0, 0, 0], anchor: [0, 0.6, 0.45], follow: pis });
    const rod = group(mesh(cylX(rRod, Lrod, Lrod / 2, 40), 'chrome'));
    const rEye = mesh(ringZ(0.28, 0.12, 0.4, 0), 'output'); rEye.position.x = Lrod + 0.45; rod.add(rEye); rod.add(mesh(boxGeo(0.3, 0.32, 0.4, Lrod + 0.15, 0, 0), 'output'));
    B.add(rod, { name: 'Rod and clevis', role: 'output', desc: 'Hard-chromed rod transmits force to the load through the clevis.', explode: [0, 0, 0], anchor: [Lrod - 1.0, rRod, 0.15], follow: rod });
    // Valve, pump, hoses
    const vb = group(mesh(roundBox(1.4, 0.5, 0.6, 0.06, -0.9, 1.9, -1.3), 'fixed'), mesh(boxGeo(0.34, 0.4, 0.46, -1.8, 1.9, -1.3), 'dark'), mesh(boxGeo(0.34, 0.4, 0.46, 0.0, 1.9, -1.3), 'dark'));
    const spool = mesh(cylX(0.07, 2.3, -0.9), 'steel'); spool.position.y = 1.9; spool.position.z = -1.3; vb.add(spool);
    B.add(vb, { name: 'Directional valve', role: 'fixed', desc: '4/3 valve. Its spool slides to connect pump and tank to either side of the cylinder.', explode: [0, 0.7, 0], anchor: [-0.9, 2.17, -1.3] });
    const yG = -0.97;
    const pump = group(mesh(roundBox(1.9, 1.1, 1.2, 0.08, -3.4, yG + 0.55, -2.3), air ? 'fixed' : 'housing'), mesh(cylX(0.32, 0.9, -3.75), 'dark'), mesh(boxGeo(0.45, 0.4, 0.45, -2.95, yG + 1.3, -2.3), 'fixed'));
    pump.children[1].position.set(0, yG + 1.42, -2.3);
    B.add(pump, { name: air ? 'Compressor and receiver' : 'Pump and tank', role: 'fixed', desc: air ? 'Compressor fills a receiver tank with air at working pressure.' : 'Motor-driven pump draws oil from the tank and supplies flow; a relief valve caps the pressure.', explode: [-0.4, 0.4, -0.4], anchor: [-3.4, yG + 1.1, -2.3] });
    const curves = {
      A: new THREE.CatmullRomCurve3([[-2.75, 1.15, 0], [-2.75, 1.6, -0.1], [-2.2, 1.95, -0.7], [-1.2, 1.9, -1.0]].map(p => new THREE.Vector3(...p))),
      B: new THREE.CatmullRomCurve3([[1.32, 1.15, 0], [1.32, 1.6, -0.1], [0.4, 1.95, -0.7], [-0.6, 1.9, -1.0]].map(p => new THREE.Vector3(...p))),
      P: new THREE.CatmullRomCurve3([[-2.95, yG + 1.5, -2.3], [-2.5, 1.5, -2.1], [-1.6, 1.95, -1.85], [-1.2, 1.9, -1.6]].map(p => new THREE.Vector3(...p))),
      T: new THREE.CatmullRomCurve3([[-0.6, 1.9, -1.6], [-1.0, 1.4, -2.05], [-2.0, 0.8, -2.35], [-2.5, yG + 1.1, -2.3]].map(p => new THREE.Vector3(...p))),
    };
    const hoses = group(...Object.values(curves).map(c => mesh(new THREE.TubeGeometry(c, 60, 0.075, 10), air ? 'steel2' : 'hose')));
    B.add(hoses, { name: 'Hoses', role: 'fixed', desc: air ? 'Polyurethane air lines.' : 'High-pressure hoses: A and B to the cylinder, P from the pump, T back to the tank.', label: false });
    const parts = {};
    const pMat = new THREE.MeshBasicMaterial({ color: air ? 0x9ad8f5 : 0xffb347 });
    Object.keys(curves).forEach(k => { const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), pMat, 14); im.frustumCulled = false; im.userData.noPick = true; hoses.add(im); parts[k] = im; });
    // Cycle
    const aCap = Math.PI * 1, aAnn = Math.PI * (1 - P.rod * P.rod);
    const Te = 2.6, Tr = Te * aAnn / aCap, hold = 0.7, cyc = Te + Tr + 2 * hold;
    let t = 0, flowU = 0;
    const m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
    const capMat = capF.material, rodMat = rodF.material;
    const update = dt => {
      t = (t + dt) % cyc;
      let x, mode;
      if (t < Te) { x = lerp(xMin, xMax, t / Te); mode = 1; }
      else if (t < Te + hold) { x = xMax; mode = 0; }
      else if (t < Te + hold + Tr) { x = lerp(xMax, xMin, (t - Te - hold) / Tr); mode = -1; }
      else { x = xMin; mode = 0; }
      pis.position.x = x; rod.position.x = x;
      const l1 = Math.max(0.01, x - pT / 2 - xCap), l2 = Math.max(0.01, xHead - (x + pT / 2));
      capF.scale.x = l1; rodF.position.x = x + pT / 2; rodF.scale.x = l2;
      spool.position.x = mode * 0.22;
      const hiE = air ? 0.0 : 0.45;
      capMat.emissive.setHex(air ? 0x000000 : 0xff7a00); rodMat.emissive.setHex(air ? 0x000000 : 0xff7a00);
      capMat.emissiveIntensity = mode === 1 ? hiE : mode === -1 ? 0.02 : 0.15;
      rodMat.emissiveIntensity = mode === -1 ? hiE : mode === 1 ? 0.02 : 0.15;
      if (air) { capMat.opacity = mode === 1 ? 0.5 : 0.22; rodMat.opacity = mode === -1 ? 0.5 : 0.22; }
      flowU += dt * 0.5 * (mode === 0 ? 0 : 1);
      const dirs = { P: 1, T: 1, A: mode === 1 ? -1 : 1, B: mode === 1 ? 1 : -1 };
      Object.keys(parts).forEach(k => {
        const im = parts[k]; im.visible = mode !== 0;
        for (let i = 0; i < 14; i++) {
          let u = ((flowU * dirs[k] + i / 14) % 1 + 1) % 1;
          curves[k].getPointAt(u, tmp); m4.makeTranslation(tmp.x, tmp.y, tmp.z); im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    };
    return { update, legend: ['output', 'fixed', 'fluid'], dispose() { pMat.dispose(); } };
  },
  calc(P) {
    const air = P.medium === 'air', p = air ? P.pAir : P.pOil, Q = air ? P.qAir : P.qOil;
    const D = P.bore, d = P.bore * P.rod, Ac = Math.PI * D * D / 4, Aa = Math.PI * (D * D - d * d) / 4;
    const Fe = p * 0.1 * Ac, Fr = p * 0.1 * Aa, qs = Q * 1e6 / 60, ve = qs / Ac, vr = qs / Aa, Pw = p * Q / 600;
    return {
      foot: 'Stroke timing follows the area ratio',
      hud: [['Push force', `${fmtS(Fe / 1000)} kN`], ['Pull force', `${fmtS(Fr / 1000)} kN`], ['Extend speed', `${fmt(ve)} mm/s`], ['Retract speed', `${fmt(vr)} mm/s`]],
      rows: [
        { k: 'Piston area', expr: `A = π·D²/4 = π·${D}²/4`, v: `${fmt(Ac)} mm²` },
        { k: 'Annulus area (rod side)', expr: `A_r = π(D² − d²)/4, d = ${fmt(d)} mm`, v: `${fmt(Aa)} mm²` },
        { k: 'Extend force', expr: `F = p·A = ${fmt(p, air ? 1 : 0)} bar · ${fmt(Ac)} mm² (1 bar = 0.1 N/mm²)`, v: `${fmtS(Fe / 1000)} kN` },
        { k: 'Retract force', expr: `F = p·A_r`, v: `${fmtS(Fr / 1000)} kN` },
        { k: 'Extend speed', expr: `v = Q / A = ${Q} L/min / ${fmt(Ac)} mm²`, v: `${fmt(ve)} mm/s` },
        { k: 'Retract speed (faster)', expr: `v = Q / A_r, ratio A/A_r = ${fmt(Ac / Aa, 2)}`, v: `${fmt(vr)} mm/s` },
        { k: air ? 'Pneumatic power (ideal)' : 'Hydraulic power', expr: `P = p·Q = ${fmt(p, air ? 1 : 0)} bar · ${Q} L/min`, v: `${fmt(Pw, 2)} kW` },
        ...(air ? [{ k: 'Compressibility', expr: 'air is springy: the piston overshoots and is hard to stop mid-stroke', v: '<span class="pill warn">compliant</span>' }] : [{ k: 'Stiffness', expr: 'oil barely compresses (bulk modulus ≈ 1.5 GPa)', v: '<span class="pill good">holds position</span>' }]),
      ],
    };
  }
};
