/* ==========================================================================
   Core: geometry helpers, materials, scene, builder, interaction, UI.
   ========================================================================== */
const TAU = Math.PI * 2;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (v, d = 0) => Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtS = (v, sig = 3) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return fmt(v, Math.min(d, sig));
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('atlas:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('atlas:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- 2D profiles ---------- */
// Involute gear outline, tooth 0 centred on angle 0, counter-clockwise.
function gearOutline(N, m, opt = {}) {
  const add = opt.add ?? m, ded = opt.ded ?? 1.25 * m, pa = (opt.pa ?? 20) * Math.PI / 180;
  const bl = opt.backlash ?? 0.04;
  const r = m * N / 2, ra = r + add, rf = Math.max(r - ded, 0.2 * r), rb = r * Math.cos(pa);
  const inv = a => Math.tan(a) - a;
  const half = Math.PI / (2 * N) * (1 - bl);
  const th = rho => rho <= rb ? half + inv(pa) : half + inv(pa) - inv(Math.acos(rb / rho));
  const steps = opt.steps ?? 6;
  const pts = [];
  const r0 = Math.max(rf, rb * 0.999);
  const thRoot = th(rf);
  const gapHalf = Math.PI / N - thRoot;
  for (let i = 0; i < N; i++) {
    const c = i * TAU / N;
    for (let k = 0; k <= 2; k++) { const a = c - Math.PI / N + gapHalf * k / 2; pts.push([rf * Math.cos(a), rf * Math.sin(a)]); }
    if (rf < rb) { const a = c - th(rb); pts.push([rb * Math.cos(a), rb * Math.sin(a)]); }
    for (let k = 0; k <= steps; k++) { const rho = r0 + (ra - r0) * k / steps; const a = c - Math.max(th(rho), 0.002); pts.push([rho * Math.cos(a), rho * Math.sin(a)]); }
    const tt = Math.max(th(ra), 0.002);
    for (let k = 1; k < 3; k++) { const a = c - tt + 2 * tt * k / 3; pts.push([ra * Math.cos(a), ra * Math.sin(a)]); }
    for (let k = steps; k >= 0; k--) { const rho = r0 + (ra - r0) * k / steps; const a = c + Math.max(th(rho), 0.002); pts.push([rho * Math.cos(a), rho * Math.sin(a)]); }
    if (rf < rb) { const a = c + th(rb); pts.push([rb * Math.cos(a), rb * Math.sin(a)]); }
    for (let k = 0; k < 2; k++) { const a = c + thRoot + gapHalf * k / 2; pts.push([rf * Math.cos(a), rf * Math.sin(a)]); }
  }
  return pts;
}
// Inner boundary of an internal gear: a virtual external gear whose teeth are the ring's gaps.
function ringInner(N, m, opt = {}) { return gearOutline(N, m, { add: 1.25 * m, ded: m, backlash: -0.04, ...opt }); }
// Cycloidal disc for Np ring pins on radius R, pin radius Rr, eccentricity E.
function cycloidPts(Np, R, Rr, E, n = 900) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * TAU;
    const psi = Math.atan2(Math.sin((1 - Np) * t), R / (E * Np) - Math.cos((1 - Np) * t));
    pts.push([R * Math.cos(t) - Rr * Math.cos(t + psi) - E * Math.cos(Np * t), -R * Math.sin(t) + Rr * Math.sin(t + psi) + E * Math.sin(Np * t)]);
  }
  return pts;
}
const rotPts = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); };

/* ---------- Three.js geometry helpers (rotary parts are built in XY with the axis on Z) ---------- */
function shapeFrom(pts, Ctor = THREE.Shape) { const s = new Ctor(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
function circlePath(r, x = 0, y = 0) { const p = new THREE.Path(); p.absarc(x, y, r, 0, TAU, false); return p; }
function circleShape(r, x = 0, y = 0) { const s = new THREE.Shape(); s.absarc(x, y, r, 0, TAU, false); return s; }
function annulusShape(ro, ri) { const s = circleShape(ro); if (ri > 0) s.holes.push(circlePath(ri)); return s; }
function boltHoles(shape, n, r, rad, phase = 0) { for (let k = 0; k < n; k++) { const a = phase + k * TAU / n; shape.holes.push(circlePath(rad, r * Math.cos(a), r * Math.sin(a))); } return shape; }
function extrude(shape, depth, o = {}) {
  const bevel = o.bevel ?? Math.min(0.015, depth * 0.08);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps: o.steps ?? 1, curveSegments: o.curve ?? 48,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1
  });
  g.translate(0, 0, -depth / 2 + (o.z ?? 0));
  return g;
}
function gearGeo(N, m, t, o = {}) {
  const s = shapeFrom(gearOutline(N, m, o));
  if (o.bore) s.holes.push(circlePath(o.bore));
  if (o.holes) boltHoles(s, o.holes.n, o.holes.r, o.holes.rad, o.holes.phase || Math.PI / o.holes.n);
  return extrude(s, t, { bevel: o.bevel ?? 0.006, z: o.z, steps: o.steps, curve: 32 });
}
function ringGeo(N, m, t, rOut, o = {}) {
  const s = circleShape(rOut);
  s.holes.push(shapeFrom(ringInner(N, m, o), THREE.Path));
  if (o.bolts) boltHoles(s, o.bolts.n, o.bolts.r, o.bolts.rad, o.bolts.phase || 0);
  return extrude(s, t, { bevel: 0.006, z: o.z, curve: 64 });
}
function cylZ(r, h, z = 0, segs = 48) { const g = new THREE.CylinderGeometry(r, r, h, segs); g.rotateX(Math.PI / 2); g.translate(0, 0, z); return g; }
function cylX(r, len, x = 0, segs = 40) { const g = new THREE.CylinderGeometry(r, r, len, segs); g.rotateZ(-Math.PI / 2); g.translate(x, 0, 0); return g; }
function cylY(r, h, y = 0, segs = 32) { const g = new THREE.CylinderGeometry(r, r, h, segs); g.translate(0, y, 0); return g; }
function ringZ(ro, ri, h, z = 0, o = {}) { return extrude(annulusShape(ro, ri), h, { z, ...o }); }
function ringX(ro, ri, len, x = 0, o = {}) { const g = extrude(annulusShape(ro, ri), len, o); g.rotateY(Math.PI / 2); g.translate(x, 0, 0); return g; }
function boxGeo(sx, sy, sz, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; }
function roundRectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape(), x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function roundBox(sx, sy, sz, r, x = 0, y = 0, z = 0) { const g = extrude(roundRectShape(sx, sy, r), sz, { bevel: Math.min(0.02, r * 0.5) }); g.translate(x, y, z); return g; }
// Sweep a closed 2D profile [[axial, radialOffset]...] along a helix around X.
function helixSweep({ r0, prof, lead, x0 = 0, xMin, xMax, perTurn = 56 }) {
  const phi0 = (xMin - x0) / lead * TAU, phi1 = (xMax - x0) / lead * TAU;
  const n = Math.max(4, Math.ceil((phi1 - phi0) / TAU * perTurn));
  const pos = [], idx = [];
  const P = (phi, a, h) => { const x = x0 + lead * phi / TAU + a, r = r0 + h; return [x, r * Math.cos(phi), r * Math.sin(phi)]; };
  const L = prof.length;
  for (let k = 0; k < L; k++) {
    const pa = prof[k], pb = prof[(k + 1) % L], base = pos.length / 3;
    for (let i = 0; i <= n; i++) { const phi = phi0 + (phi1 - phi0) * i / n; pos.push(...P(phi, pa[0], pa[1]), ...P(phi, pb[0], pb[1])); }
    for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  for (const phi of [phi0, phi1]) { // end caps (convex profiles)
    const base = pos.length / 3; prof.forEach(p => pos.push(...P(phi, p[0], p[1])));
    for (let k = 1; k < L - 1; k++) idx.push(base, base + k, base + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ---------- Materials ---------- */
if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false; // treat hex colours as sRGB
const MAT = {
  input: { color: 0xE8590C, metalness: 0.3, roughness: 0.38 },
  output: { color: 0x1F64C8, metalness: 0.3, roughness: 0.38 },
  fixed: { color: 0x9AA3AD, metalness: 0.8, roughness: 0.42 },
  housing: { color: 0x737C86, metalness: 0.6, roughness: 0.55 },
  steel: { color: 0xC9CED4, metalness: 1.0, roughness: 0.26 },
  steel2: { color: 0xA9B0B8, metalness: 1.0, roughness: 0.3 },
  dark: { color: 0x30363D, metalness: 0.7, roughness: 0.45 },
  lam: { color: 0x3E454D, metalness: 0.85, roughness: 0.4 },
  elastic: { color: 0xA23BBF, metalness: 0.2, roughness: 0.4 },
  copper: { color: 0xC4703A, metalness: 1.0, roughness: 0.3 },
  magN: { color: 0xC0392B, metalness: 0.3, roughness: 0.45 },
  magS: { color: 0xDDE2E8, metalness: 0.3, roughness: 0.45 },
  pcb: { color: 0x1F6B4D, metalness: 0.15, roughness: 0.6 },
  rubber: { color: 0x1B1F24, metalness: 0.0, roughness: 0.85 },
  chrome: { color: 0xEEF1F4, metalness: 1.0, roughness: 0.07 },
  hose: { color: 0x24282D, metalness: 0.15, roughness: 0.75 },
  oil: { color: 0xF2A23B, metalness: 0.0, roughness: 0.2, transparent: true, opacity: 0.6, depthWrite: false },
  air: { color: 0x8FD3F4, metalness: 0.0, roughness: 0.2, transparent: true, opacity: 0.3, depthWrite: false },
};
const ROLE_MAT = { input: 'input', output: 'output', fixed: 'fixed' };
function mat(kind, extra = {}) {
  const b = MAT[kind] || MAT.steel;
  return new THREE.MeshStandardMaterial({ envMapIntensity: 0.7, ...b, ...extra });
}
function mesh(geo, kind, o = {}) {
  const m = new THREE.Mesh(geo, typeof kind === 'string' ? mat(kind, o.mat) : kind);
  m.castShadow = o.shadow !== false && !m.material.transparent; m.receiveShadow = true;
  if (o.clip) m.userData.clip = true;
  if (o.noPick) m.userData.noPick = true;
  if (o.pos) m.position.set(...o.pos);
  return m;
}
function group(...children) { const g = new THREE.Group(); children.forEach(c => c && g.add(c)); return g; }

/* ---------- Scene ---------- */
const stage = $('#stage');
let renderer, scene, camera, controls, keyLight, ground, pmrem;
const cutPlanes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
let webglOK = true;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  stage.prepend(renderer.domElement);
  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.minDistance = 2; controls.maxDistance = 60;
  controls.screenSpacePanning = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 0.3));
  keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(6, 12, 7); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight); scene.add(keyLight.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35); fill.position.set(-8, 4, -6); scene.add(fill);
  ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
} catch (err) {
  webglOK = false;
  console.error(err);
  const d = document.createElement('div'); d.className = 'webgl-error';
  d.innerHTML = '<p>3D view unavailable: this browser could not start WebGL.<br>The datasheets, calculators and comparisons still work.</p>';
  stage.appendChild(d);
}

/* ---------- Builder: registers parts so they can explode, label, highlight and clip ---------- */
class Builder {
  constructor() { this.root = new THREE.Group(); this.parts = []; this.pickables = []; this.pitch = []; this.dispose = []; }
  add(obj, o) {
    const wrap = new THREE.Group(); wrap.add(obj); (o.parent || this.root).add(wrap);
    const part = { name: o.name, role: o.role || 'transfer', desc: o.desc || '', label: o.label !== false, wrap, obj,
      meshes: [], explodeV: new THREE.Vector3(...(o.explode || [0, 0, 0])), anchor: o.anchor ? new THREE.Vector3(...o.anchor) : null,
      follow: o.follow || null, clip: !!o.clip };
    this.parts.push(part);
    this.register(part);
    return obj;
  }
  register(part) {
    part.meshes.length = 0;
    part.obj.traverse(m => {
      if ((m.isMesh || m.isInstancedMesh) && !m.userData.isSection) {
        m.userData.part = part; part.meshes.push(m);
        if (part.clip) m.userData.clip = true;
        if (!m.userData.noPick && !this.pickables.includes(m)) this.pickables.push(m);
      }
    });
  }
  pitchCircle(r, parent, z, color) {
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * TAU; pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z)); }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: color ?? 0x12161b, dashSize: 0.14, gapSize: 0.05, transparent: true, opacity: 0.85 }));
    line.computeLineDistances(); line.visible = false; parent.add(line); this.pitch.push(line); return line;
  }
  pitchLine(a, b, parent, solid) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    const m = solid ? new THREE.LineBasicMaterial({ color: 0xE8590C }) : new THREE.LineDashedMaterial({ color: 0x12161b, dashSize: 0.14, gapSize: 0.05, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(g, m); if (!solid) line.computeLineDistances(); line.visible = false; parent.add(line); this.pitch.push(line); return line;
  }
  finalize() {
    this.root.updateMatrixWorld(true);
    // Section caps: back faces of clipped solids render in the section colour.
    this.root.traverse(m => {
      if (m.isMesh && m.userData.clip && !m.userData.isSection && !m.material.transparent) {
        const s = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0xB02A37, side: THREE.BackSide, clippingPlanes: cutPlanes, clipIntersection: true }));
        s.userData.isSection = true; s.userData.noPick = true; s.visible = false; m.add(s);
      }
    });
    for (const p of this.parts) {
      if (!p.anchor) {
        const box = new THREE.Box3().setFromObject(p.obj); const c = box.getCenter(new THREE.Vector3());
        p.anchor = (p.follow || p.wrap).worldToLocal(c);
      }
    }
    this.box0 = new THREE.Box3().setFromObject(this.root);
    for (const p of this.parts) p.wrap.position.copy(p.explodeV);
    this.root.updateMatrixWorld(true);
    this.box1 = new THREE.Box3().setFromObject(this.root);
    for (const p of this.parts) p.wrap.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
  }
}

/* ---------- App state ---------- */
const state = {
  mech: null, playing: true, speed: 1, explodeT: 0, explode: 0, cut: false, labels: true, pitch: false,
  view: 'lab', sheet: store.get('sheet', 'overview'), params: {}, hover: null, focus: null, pointer: null, pointerMoved: false
};
let cur = null; // { id, def, info, B, inst, P }
const MECHS = {};

function defaults(params) { const o = {}; params.forEach(p => { o[p.id] = p.value; }); return o; }

function disposeTree(obj) {
  obj.traverse(m => {
    if (m.geometry) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
  });
}

function loadMech(id, keepCam = false, keepSheet = false) {
  if (!MECHS[id]) id = 'planetary';
  const def = MECHS[id], info = INFO[id];
  if (!state.params[id]) state.params[id] = { ...defaults(def.params), ...store.get('p:' + id, {}) };
  const P = state.params[id];
  if (cur && cur.B) { scene && scene.remove(cur.B.root); disposeTree(cur.B.root); cur.inst.dispose && cur.inst.dispose(); }
  const B = new Builder();
  let inst = {};
  if (webglOK) { inst = def.build(B, P) || {}; B.finalize(); scene.add(B.root); }
  const switched = !cur || cur.id !== id;
  cur = { id, def, info, B, inst, P };
  state.mech = id; state.hover = null;
  state.focus = null;
  store.set('mech', id);
  try { history.replaceState(null, '', '#' + id); } catch (e) { /* sandboxed */ }
  if (webglOK) {
    cutPlanes[0].normal.set(...(def.cut ? def.cut[0] : [-1, 0, 0])); cutPlanes[1].normal.set(...(def.cut ? def.cut[1] : [0, 0, -1]));
    if (switched) state.cut = !!def.defaultCut;
    if (!def.cut) state.cut = false;
    if (!def.pitch) state.pitch = false;
    applyCut(); applyPitch(); setPitchColor();
    fitShadow();
    if (!keepCam) fitCamera();
    if (inst.update) inst.update(0, 0);
  }
  $('#btn-cut').disabled = !def.cut; $('#btn-pitch').disabled = !def.pitch;
  $('#btn-cut').setAttribute('aria-pressed', String(state.cut));
  $('#btn-pitch').setAttribute('aria-pressed', String(state.pitch));
  renderRail(); renderStageTitle(); if (keepSheet && state.sheet === 'calc') renderCalcOut(); else renderSheet(); renderHUD(); buildTags();
}

function fitCamera() {
  const box = cur.B.box0, sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = new THREE.Vector3(...(cur.def.camDir || [0.4, 0.8, 1])).normalize();
  const w = stage.clientWidth || 800, h = stage.clientHeight || 600, aspect = w / h;
  const vfov = camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dist = sphere.radius / Math.sin(Math.min(vfov, hfov) / 2) * (cur.def.zoom || 0.95);
  const target = sphere.center.clone().add(new THREE.Vector3(0, -sphere.radius * 0.04, 0));
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = dist / 50; camera.far = dist * 20; camera.updateProjectionMatrix();
  controls.update();
}
function fitShadow() {
  const b = cur.B.box0.clone().union(cur.B.box1), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.75 + 1;
  const cam = keyLight.shadow.camera; cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 6; cam.updateProjectionMatrix();
  keyLight.target.position.copy(c); keyLight.position.copy(c).add(new THREE.Vector3(0.45, 1, 0.55).normalize().multiplyScalar(r * 2.5));
}
function applyCut() {
  if (!cur || !cur.B) return;
  cur.B.root.traverse(m => {
    if (!m.isMesh) return;
    if (m.userData.isSection) { m.visible = state.cut; return; }
    if (m.userData.clip) { m.material.clippingPlanes = state.cut ? cutPlanes : null; m.material.clipIntersection = true; m.material.needsUpdate = true; }
  });
}
function applyPitch() { if (cur && cur.B) cur.B.pitch.forEach(l => { l.visible = state.pitch; }); }
function setPitchColor() {
  if (!cur || !cur.B) return;
  const c = new THREE.Color(cssVar('--ink') || '#12161b');
  cur.B.pitch.forEach(l => { if (l.material.isLineDashedMaterial) l.material.color.copy(c); });
}

/* ---------- Labels ---------- */
const tagsEl = $('#tags'), linesEl = $('#tag-lines');
let tagEls = [];
function buildTags() {
  tagEls.forEach(t => { t.el.remove(); t.dot.remove(); t.line.remove(); });
  tagEls = [];
  if (!cur || !cur.B) return;
  cur.B.parts.forEach(p => {
    if (!p.label) return;
    const el = document.createElement('div'); el.className = 'tag';
    el.innerHTML = `<span class="dot ${p.role}"></span>${esc(p.name)}`;
    const dot = document.createElement('div'); dot.className = 'tag-anchor';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1'); line.style.color = 'var(--ink-3)';
    [el, dot, line].forEach(x => { x.style.visibility = 'hidden'; });
    tagsEl.appendChild(dot); tagsEl.appendChild(el); linesEl.appendChild(line);
    tagEls.push({ p, el, dot, line, w: 0, h: 0 });
  });
  measureTags();
}
function measureTags() { tagEls.forEach(t => { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }); }
const _v = new THREE.Vector3();
function updateTags() {
  const show = state.labels && state.view === 'lab';
  const W = stage.clientWidth, H = stage.clientHeight;
  const placed = [];
  const items = [];
  for (const t of tagEls) {
    const vis = show || state.focus === t.p;
    if (!vis) { t.el.style.display = 'none'; t.dot.style.display = 'none'; t.line.style.display = 'none'; continue; }
    const host = t.p.follow || t.p.wrap;
    _v.copy(t.p.anchor); host.localToWorld(_v); _v.project(camera);
    if (_v.z > 1 || _v.z < -1) { t.el.style.display = 'none'; t.dot.style.display = 'none'; t.line.style.display = 'none'; continue; }
    items.push({ t, x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    const { t, x, y } = it;
    let tx = x + 18, ty = y - t.h - 10;
    if (tx + t.w > W - 8) tx = x - 18 - t.w;
    tx = clamp(tx, 6, Math.max(6, W - t.w - 6));
    for (let k = 0; k < 8; k++) {
      const hit = placed.find(r => tx < r.x + r.w + 4 && tx + t.w + 4 > r.x && ty < r.y + r.h + 3 && ty + t.h + 3 > r.y);
      if (!hit) break; ty = hit.y + hit.h + 4;
    }
    ty = clamp(ty, 4, Math.max(4, H - t.h - 4));
    placed.push({ x: tx, y: ty, w: t.w, h: t.h });
    t.el.style.display = ''; t.dot.style.display = ''; t.line.style.display = '';
    t.el.style.visibility = t.dot.style.visibility = t.line.style.visibility = 'visible';
    t.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
    t.dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const lx = tx > x ? tx : tx + t.w, ly = ty + t.h / 2;
    t.line.setAttribute('x1', x.toFixed(1)); t.line.setAttribute('y1', y.toFixed(1));
    t.line.setAttribute('x2', lx.toFixed(1)); t.line.setAttribute('y2', ly.toFixed(1));
    t.el.classList.toggle('is-focus', state.focus === t.p);
  }
}

/* ---------- Hover, focus, tooltip ---------- */
const raycaster = new THREE.Raycaster();
const tooltip = $('#tooltip');
function setEmissive(part, on) {
  if (!part) return;
  part.meshes.forEach(m => {
    if (m.userData.dynamicEmissive || !m.material || !m.material.emissive) return;
    if (!m.userData.baseEm) m.userData.baseEm = { c: m.material.emissive.getHex(), i: m.material.emissiveIntensity };
    if (on) { m.material.emissive.setHex(0xff6a1a); m.material.emissiveIntensity = 0.28; }
    else { m.material.emissive.setHex(m.userData.baseEm.c); m.material.emissiveIntensity = m.userData.baseEm.i; }
  });
}
function refreshHighlights() {
  if (!cur || !cur.B) return;
  cur.B.parts.forEach(p => setEmissive(p, p === state.hover || p === state.focus));
}
function pickAt(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(cur.B.pickables.filter(m => m.visible), false);
  for (const h of hits) {
    if (state.cut && h.object.userData.clip && cutPlanes.every(pl => pl.distanceToPoint(h.point) < 0)) continue;
    let o = h.object, vis = true; while (o) { if (!o.visible) { vis = false; break; } o = o.parent; }
    if (!vis) continue;
    return h.object.userData.part || null;
  }
  return null;
}
function showTooltip(part, cx, cy) {
  if (!part) { tooltip.hidden = true; return; }
  tooltip.innerHTML = `<span class="role"><span class="dot ${part.role}"></span>${ROLE_LABEL[part.role] || ''}</span><b>${esc(part.name)}</b><p>${esc(part.desc)}</p>`;
  tooltip.hidden = false;
  const r = stage.getBoundingClientRect(), tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  let x = cx - r.left + 16, y = cy - r.top + 16;
  if (x + tw > r.width - 8) x = cx - r.left - tw - 16;
  if (y + th > r.height - 8) y = cy - r.top - th - 16;
  tooltip.style.left = Math.max(8, x) + 'px'; tooltip.style.top = Math.max(8, y) + 'px';
}
function setFocus(part) {
  state.focus = state.focus === part ? null : part;
  refreshHighlights();
  $$('.part-row').forEach(el => el.classList.toggle('is-focus', !!state.focus && el.dataset.part === state.focus.name));
}
if (webglOK) {
  const cv = renderer.domElement;
  let downAt = null;
  cv.addEventListener('pointermove', e => { state.pointer = { x: e.clientX, y: e.clientY }; state.pointerMoved = true; });
  cv.addEventListener('pointerleave', () => { state.pointer = null; state.pointerMoved = true; });
  cv.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', e => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p) setFocus(p); else if (state.focus) setFocus(state.focus);
  });
}

/* ---------- Render loop ---------- */
let lastT = performance.now(), simT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (!webglOK || !cur || state.view !== 'lab' || document.hidden) return;
  const adt = state.playing ? dt * state.speed : 0;
  simT += adt;
  if (cur.inst.update) cur.inst.update(adt, simT);
  const k = 1 - Math.pow(0.0015, dt);
  state.explode += (state.explodeT - state.explode) * k;
  if (Math.abs(state.explodeT - state.explode) < 1e-4) state.explode = state.explodeT;
  const e = state.explode;
  for (const p of cur.B.parts) p.wrap.position.copy(p.explodeV).multiplyScalar(e);
  ground.position.y = lerp(cur.B.box0.min.y, Math.min(cur.B.box0.min.y, cur.B.box1.min.y), e) - 0.002;
  controls.update();
  if (state.pointerMoved) {
    state.pointerMoved = false;
    const p = state.pointer ? pickAt(state.pointer.x, state.pointer.y) : null;
    if (p !== state.hover) { state.hover = p; refreshHighlights(); renderer.domElement.style.cursor = p ? 'pointer' : ''; }
    if (state.pointer) showTooltip(p, state.pointer.x, state.pointer.y); else showTooltip(null);
  }
  renderer.render(scene, camera);
  updateTags();
  if (cur.inst.onFrame && state.sheet === 'calc') cur.inst.onFrame();
}

function resize() {
  if (!webglOK) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  measureTags();
}
if (webglOK && 'ResizeObserver' in window) new ResizeObserver(resize).observe(stage); else window.addEventListener('resize', resize);

/* ---------- Controls ---------- */
const ICON_PAUSE = '<rect x="3.5" y="3" width="3" height="10" rx="0.6"/><rect x="9.5" y="3" width="3" height="10" rx="0.6"/>';
const ICON_PLAY = '<path d="M4.5 2.8v10.4L13 8z"/>';
function setPlaying(v) {
  state.playing = v;
  $('#ico-play').innerHTML = v ? ICON_PAUSE : ICON_PLAY;
  $('#btn-play').setAttribute('aria-label', v ? 'Pause animation' : 'Play animation');
}
$('#btn-play').addEventListener('click', () => setPlaying(!state.playing));
$('#rng-speed').addEventListener('input', e => { state.speed = Math.pow(2, (e.target.value - 50) / 20); renderHUD(); });
$('#rng-explode').addEventListener('input', e => { state.explodeT = e.target.value / 100; });
$('#btn-cut').addEventListener('click', e => { state.cut = !state.cut; e.currentTarget.setAttribute('aria-pressed', String(state.cut)); applyCut(); });
$('#btn-labels').addEventListener('click', e => { state.labels = !state.labels; e.currentTarget.setAttribute('aria-pressed', String(state.labels)); });
$('#btn-pitch').addEventListener('click', e => { state.pitch = !state.pitch; e.currentTarget.setAttribute('aria-pressed', String(state.pitch)); applyPitch(); });
$('#btn-reset').addEventListener('click', () => { if (webglOK && cur) fitCamera(); });
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || state.view !== 'lab') return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault(); setPlaying(!state.playing);
});

/* ---------- Rail, title, legend ---------- */
function renderRail() {
  const rail = $('#rail');
  if (!rail.childElementCount) {
    rail.innerHTML = GROUPS.map(g => `<div class="rail-group"><div class="rail-head">${esc(g.label)}</div>${g.items.map(id =>
      `<button class="rail-item" data-mech="${id}"><span class="rail-name">${esc(INFO[id].name)}</span><span class="rail-spec">${esc(INFO[id].spec)}</span></button>`).join('')}</div>`).join('');
    rail.addEventListener('click', e => { const b = e.target.closest('[data-mech]'); if (b && b.dataset.mech !== state.mech) loadMech(b.dataset.mech); });
  }
  $$('.rail-item', rail).forEach(b => b.setAttribute('aria-current', String(b.dataset.mech === state.mech)));
}
function legendHTML(roles) {
  const extra = cur && cur.def.cut ? '<span><span class="dot section"></span>Cut face</span>' : '';
  return roles.map(r => `<span><span class="dot ${r}"></span>${ROLE_LABEL[r]}</span>`).join('') + extra;
}
function renderStageTitle() {
  const info = cur.info;
  $('#st-kicker').textContent = info.kicker;
  $('#st-name').textContent = info.name;
  $('#st-tagline').textContent = info.tagline;
  $('#st-legend').innerHTML = legendHTML(cur.inst.legend || info.legend);
}

/* ---------- HUD ---------- */
function renderHUD() {
  if (!cur) return;
  const c = cur.def.calc(cur.P);
  const rows = (c.hud || []).map(([k, v]) => `<div class="hud-row"><span class="hud-k">${esc(k)}</span><span class="hud-v">${v}</span></div>`).join('');
  let foot = '';
  if (c.realRpm && cur.def.visRpm) {
    const vis = cur.def.visRpm * state.speed;
    const slow = c.realRpm / Math.max(vis, 1e-6);
    foot = slow > 1.5 ? `Animation ≈ 1/${fmt(slow)} of real speed` : 'Animation near real speed';
  } else if (c.foot) foot = c.foot;
  $('#hud').innerHTML = rows + (foot ? `<div class="hud-foot">${esc(foot)}</div>` : '');
}

/* ---------- Datasheet ---------- */
function renderSheet() {
  $$('.sheet-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sheet === state.sheet)));
  const body = $('#sheet-body');
  const info = cur.info;
  if (state.sheet === 'overview') {
    const parts = cur.B && cur.B.parts.length ? cur.B.parts : [];
    body.innerHTML = `
      <section>
        <div class="plate">
          <div class="plate-head"><span class="plate-title">${esc(info.name)}</span><span class="plate-std">typical values</span></div>
          <div class="plate-grid">${info.plate.map(([k, v]) => `<div class="plate-cell"><div class="plate-k">${esc(k) || '&nbsp;'}</div><div class="plate-v">${esc(v)}</div></div>`).join('')}</div>
        </div>
      </section>
      <section>
        <h2 class="h-sec">Power path</h2>
        <ol class="steps">${info.how.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
        ${info.note ? `<p class="steps-note">${esc(info.note)}</p>` : ''}
      </section>
      ${parts.length ? `<section>
        <h2 class="h-sec">Parts · click to highlight</h2>
        <div class="parts">${parts.map(p => `<button class="part-row${state.focus === p ? ' is-focus' : ''}" data-part="${esc(p.name)}"><span class="dot ${p.role}"></span><span><span class="part-name">${esc(p.name)}</span><span class="part-role">${ROLE_LABEL[p.role] || ''}</span><span class="part-desc">${esc(p.desc)}</span></span></button>`).join('')}</div>
      </section>` : ''}
      <section>
        <h2 class="h-sec">Trade-offs</h2>
        <div class="pc">
          <div class="plus"><h4>Strengths</h4><ul>${info.pros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="minus"><h4>Limits</h4><ul>${info.cons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>
      </section>`;
    $$('.part-row', body).forEach(b => b.addEventListener('click', () => {
      const p = cur.B.parts.find(x => x.name === b.dataset.part); if (p) setFocus(p);
    }));
  } else if (state.sheet === 'calc') {
    const def = cur.def, P = cur.P;
    body.innerHTML = `<section><h2 class="h-sec">Inputs</h2><div id="params"></div></section>
      <section><h2 class="h-sec">Results</h2><div id="calc-out"></div></section>`;
    const host = $('#params', body);
    def.params.forEach(p => {
      if (p.show && !p.show(P)) return;
      const wrap = document.createElement('div'); wrap.className = 'param';
      const id = `p-${cur.id}-${p.id}`;
      if (p.type === 'seg') {
        wrap.innerHTML = `<div class="param-top"><span class="param-label" id="${id}-l">${esc(p.label)}</span></div>
          <div class="seg" role="group" aria-labelledby="${id}-l">${p.options.map(o => `<button id="${id}-${esc(o.v)}" data-v="${esc(o.v)}" aria-pressed="${String(P[p.id]) === String(o.v)}">${esc(o.l)}</button>`).join('')}</div>
          ${p.help ? `<div class="param-help">${esc(p.help)}</div>` : ''}`;
        $$('button', wrap).forEach(b => b.addEventListener('click', () => {
          const raw = b.dataset.v; const v = typeof p.value === 'number' ? Number(raw) : raw;
          if (P[p.id] === v) return; P[p.id] = v; onParam(p);
        }));
      } else {
        wrap.innerHTML = `<div class="param-top"><label for="${id}">${esc(p.label)}</label><output for="${id}" id="${id}-o">${p.fmt ? p.fmt(P[p.id]) : fmt(P[p.id], p.dec || 0)} ${esc(p.unit || '')}</output></div>
          <input type="range" id="${id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${P[p.id]}">
          ${p.help ? `<div class="param-help">${esc(p.help)}</div>` : ''}`;
        const inp = $('input', wrap), out = $('output', wrap);
        let raf = 0;
        inp.addEventListener('input', () => {
          P[p.id] = Number(inp.value);
          out.textContent = `${p.fmt ? p.fmt(P[p.id]) : fmt(P[p.id], p.dec || 0)} ${p.unit || ''}`;
          if (p.rebuild) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => onParam(p, true)); } else onParam(p, true);
        });
      }
      host.appendChild(wrap);
    });
    renderCalcOut();
  } else {
    body.innerHTML = `
      <section><h2 class="h-sec">Applications</h2>
        <div class="uses">${info.uses.map(u => `<div class="use"><div class="use-field">${esc(u.field)}</div><div class="use-ex">${esc(u.ex)}</div><div class="use-why">${esc(u.why)}</div></div>`).join('')}</div>
      </section>
      <section><h2 class="h-sec">Pick it or skip it</h2>
        <div class="choose"><div class="yes"><b>Choose it when</b>${esc(info.choose)}</div><div class="no"><b>Look elsewhere when</b>${esc(info.avoid)}</div></div>
      </section>`;
  }
}
function onParam(p, fromSlider) {
  store.set('p:' + cur.id, cur.P);
  if (p.rebuild) {
    loadMech(cur.id, true, !!fromSlider);
  } else {
    if (p.live && cur.inst.setParams) cur.inst.setParams(cur.P);
    if (p.type === 'seg' || cur.def.params.some(q => q.show)) {
      if (p.type === 'seg') renderSheet(); else renderCalcOut();
    } else renderCalcOut();
    renderHUD();
  }
}
function renderCalcOut() {
  const out = $('#calc-out'); if (!out) return;
  const c = cur.def.calc(cur.P);
  let html = `<div class="calc">${c.rows.map(r => `<div class="calc-row"><div class="calc-k">${esc(r.k)}</div><div class="calc-line"><span class="calc-expr">${r.expr ? esc(r.expr) : ''}</span><span class="calc-val">${r.v}</span></div></div>`).join('')}</div>`;
  if (c.power) {
    const { pin, pout } = c.power;
    const eff = pin > 0 ? pout / pin : 0;
    html += `<div class="flow"><div class="calc-k">Power flow at this operating point</div>
      <div class="flow-bar" role="img" aria-label="Output ${fmt(eff * 100)} percent, losses ${fmt((1 - eff) * 100)} percent"><span class="out" style="flex:${Math.max(eff, 0.001)}"></span><span class="loss" style="flex:${Math.max(1 - eff, 0.001)}"></span></div>
      <div class="flow-legend"><span><i class="sw out"></i>Output ${fmtS(pout)} W</span><span><i class="sw loss"></i>Heat ${fmtS(pin - pout)} W</span></div></div>`;
  }
  if (c.extra) html += c.extra;
  out.innerHTML = html;
  if (cur.inst.afterCalc) cur.inst.afterCalc();
}
$$('.sheet-tab').forEach(b => b.addEventListener('click', () => { state.sheet = b.dataset.sheet; store.set('sheet', state.sheet); renderSheet(); }));

/* ---------- Views ---------- */
function setView(v) {
  state.view = v;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
  $('#view-lab').hidden = v !== 'lab'; $('#view-compare').hidden = v !== 'compare'; $('#view-concepts').hidden = v !== 'concepts';
  store.set('view', v);
  if (v === 'lab') requestAnimationFrame(resize);
  if (v === 'compare') renderRatioChart();
}
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
function openInLab(id) { setView('lab'); if (state.mech !== id) loadMech(id); window.scrollTo({ top: 0 }); }

/* ---------- Small SVG helpers ---------- */
function svgEl(tag, attrs, text) { const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' '); return `<${tag} ${a}>${text ?? ''}</${tag}>`; }
