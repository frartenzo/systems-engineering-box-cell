import {
  THREE, RAPIER, world, scene, V3, yawQ, mats, addBox, makeLink, setLink, labelSprite, clamp,
  spawnCap, rand, flavorColors,
} from './core.js';
import * as C from './config.js';
import { FLAVORS, CAP } from './config.js';

export const plantGroup = new THREE.Group();
scene.add(plantGroup);
export const labels = new THREE.Group();
scene.add(labels);

// ---------------------------------------------------------------- nastri
export const HUB = V3(0, 0, -C.R_TABLE);
// tDoor: distanza (lungo il nastro) della porta del magazzino esterno, oltre la recinzione
const mkBelt = (name, d, s, end, door) => ({ name, d, s, end, len: C.BELT_LEN, yaw: Math.atan2(-d.z, d.x), tex: null, tDoor: door });
export const belts = [
  mkBelt('A', V3(0, 0, -1), V3(1, 0, 0), V3(0, 0, -C.R_TABLE - 2.2), 96 - C.R_TABLE - 2.2),
  mkBelt('B', V3(-1, 0, 0), V3(0, 0, 1), V3(-2.2, 0, -C.R_TABLE), 86 - 2.2),
  mkBelt('C', V3(1, 0, 0), V3(0, 0, 1), V3(2.2, 0, -C.R_TABLE), 86 - 2.2),
];
export const beltPt = (b, t, lat = 0, y = 0) =>
  V3(b.end.x + b.d.x * t + b.s.x * lat, y, b.end.z + b.d.z * t + b.s.z * lat);
export const beltT = (b, p) => (p.x - b.end.x) * b.d.x + (p.z - b.end.z) * b.d.z;
export const beltLat = (b, p) => (p.x - b.end.x) * b.s.x + (p.z - b.end.z) * b.s.z;

function buildBelt(b) {
  const g = new THREE.Group(); plantGroup.add(g);
  const half = C.BELT_W / 2;
  const mid = beltPt(b, b.len / 2, 0, C.BELT_Y - 0.25);
  // superficie con chevron scorrevoli
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const x = cv.getContext('2d'); x.fillStyle = '#1c1f24'; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = '#3a414a'; x.lineWidth = 5;
  for (let k = 0; k < 128; k += 32) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 14, 32); x.lineTo(k, 64); x.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(b.len / 3, 1); tex.colorSpace = THREE.SRGBColorSpace;
  b.tex = tex;
  const surf = new THREE.Mesh(new THREE.BoxGeometry(b.len, 0.5, C.BELT_W), [mats.rubber, mats.rubber, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), mats.rubber, mats.rubber, mats.rubber]);
  surf.position.copy(mid); surf.rotation.y = b.yaw; surf.receiveShadow = true;
  g.add(surf);
  world.createCollider(RAPIER.ColliderDesc.cuboid(b.len / 2, 0.25, half).setTranslation(mid.x, mid.y, mid.z).setRotation(yawQ(b.yaw)).setFriction(0.7).setRestitution(0.05));
  // sponde
  for (const sg of [-1, 1]) {
    const p = beltPt(b, b.len / 2, sg * (half + 0.08), C.BELT_Y + 0.4 - 0.05);
    addBox(g, { pos: p, size: [b.len / 2, 0.45, 0.08], rotY: b.yaw, mat: mats.steel, friction: 0.15 });
  }
  addBox(g, { pos: beltPt(b, b.len + 0.1, 0, C.BELT_Y + 0.35), size: [0.1, 0.45, half + 0.16], rotY: b.yaw, mat: mats.steel, friction: 0.15 });
  // telaio e gambe
  addBox(g, { pos: beltPt(b, b.len / 2, 0, C.BELT_Y - 0.6), size: [b.len / 2, 0.12, half + 0.2], rotY: b.yaw, mat: mats.frame, phys: false });
  for (let t = 1; t < b.len; t += 7) for (const sg of [-1, 1]) {
    addBox(g, { pos: beltPt(b, t, sg * (half + 0.12), (C.BELT_Y - 0.7) / 2), size: [0.12, (C.BELT_Y - 0.7) / 2, 0.12], mat: mats.frame, phys: false });
  }
  // telecamera di conteggio a 6 dm dall'hopper
  const camPos = beltPt(b, 7, 0, C.BELT_Y);
  const gantry = new THREE.Group(); gantry.position.copy(camPos); gantry.rotation.y = b.yaw; g.add(gantry);
  for (const sg of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), mats.darkSteel); post.position.set(0, 1.3, sg * (half + 0.3)); gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, C.BELT_W + 0.8), mats.darkSteel); beam.position.set(0, 2.6, 0); gantry.add(beam);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), mats.white.clone()); cam.position.set(0, 2.45, 0); gantry.add(cam);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0x0a0a14, metalness: 1, roughness: 0.1 })); lens.position.set(0, 2.24, 0); gantry.add(lens);
  // cono di visione
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.3, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.set(0, 1.2, 0); gantry.add(cone);
  b.camMesh = cam;
  const lab = labelSprite(`Nastro ${b.name}`, '#35d0ff', 1.3);
  lab.position.copy(beltPt(b, 12, 0, 6)); labels.add(lab);
}

// ---------------------------------------------------------------- cassoni
// Sistema di riferimento locale del cassone (a tilt 0):
//   x = verso il lato basso (cerniera), parallelo al nastro; il cassone si estende verso -x
//   z = asse della vite, perpendicolare al nastro, positivo verso il nastro
//   y = su
// L'inclinazione ruota attorno all'asse z passante per la cerniera: le capsule scivolano da sole
// sul fondo fino al canale della vite, che corre lungo tutto il lato basso e scarica sul nastro.
const Z_AX = V3(0, 0, 1), Y_AX = V3(0, 1, 0);

function makeBinLabel(name, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 84;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(3.4, 3.4 * 84 / 256, 1); sprite.renderOrder = 10;
  let key = '';
  const draw = (frac, note = '') => {
    const k = Math.round(frac * 40) + '|' + note;
    if (k === key) return; key = k;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 84);
    g.fillStyle = 'rgba(10,14,20,0.82)'; g.beginPath(); g.roundRect(2, 2, 252, 80, 12); g.fill();
    g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.roundRect(2, 2, 252, 80, 12); g.stroke();
    g.fillStyle = '#fff'; g.font = '600 26px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 128, 28);
    g.fillStyle = '#2a3140'; g.fillRect(16, 52, 224, 14);
    g.fillStyle = note ? '#ffc86b' : frac > 0.35 ? '#35d07a' : frac > 0.15 ? '#ff9f1c' : '#ff5470';
    g.fillRect(16, 52, 224 * Math.max(0, Math.min(1, frac)), 14);
    if (note) { g.fillStyle = '#fff'; g.font = '700 13px system-ui,sans-serif'; g.fillText(note, 128, 59.5); }
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

export class Bin {
  // origin = punto della cerniera (z locale = 0), f = verso del lato basso, belt = nastro servito
  constructor(id, flavor, origin, f, belt, extra = false) {
    this.id = id; this.flavor = flavor; this.hinge = origin.clone(); this.f = f.clone(); this.belt = belt; this.extra = extra;
    this.side = V3(-f.z, 0, f.x); // asse z locale = direzione della vite, verso il nastro
    this.yaw = Math.atan2(-f.z, f.x);
    this.qYaw = yawQ(this.yaw);
    this.tilt = C.TILT_MIN; this.tiltTarget = C.TILT_MIN;
    this.queue = []; this.idle = 0; this.online = true; this.live = false;
    this.stock = C.defaults.binStock; this.caps = new Set(); this.moving = []; this.slotTimer = 0;
    this.screwAng = 0; this.screwSpeed = 0; this.agv = null; this.swapping = false; this.agvRequested = false; this.flash = 0;
    this.build();
  }

  local(x, y, z) { // coordinate locali del cassone (a tilt 0) -> mondo
    return this.hinge.clone().addScaledVector(this.f, x).addScaledVector(this.side, z).add(V3(0, y, 0));
  }
  worldFromLocal(v) { // con tilt corrente
    return v.clone().applyQuaternion(this.q).add(this.hinge);
  }
  get q() { return this.qYaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AX, -this.tilt)); }

  build() {
    const { hinge, f, side } = this, D = C.BIN_D, W = C.BIN_W, H = C.BIN_H;
    // pallet e piano
    const pallet = new THREE.Group(); plantGroup.add(pallet);
    const pTop = C.HINGE_Y - 0.2, pH = pTop - C.DECK_Y;
    addBox(pallet, { pos: this.local(-D / 2, (pTop + C.DECK_Y) / 2 - C.HINGE_Y, 0), size: [D / 2 + 0.1, pH / 2, W / 2 + 0.1], rotY: this.yaw, mat: mats.wood, phys: false });
    this.pallet = pallet;
    // corpo cinematico
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hinge.x, hinge.y, hinge.z).setRotation(this.q));
    this.group = new THREE.Group(); this.group.position.copy(hinge); scene.add(this.group);
    const fl = flavorColors[this.flavor];
    this.colorMat = new THREE.MeshStandardMaterial({ color: fl, roughness: 0.5, metalness: 0.2, emissive: fl, emissiveIntensity: 0.15 });
    const shell = (cx, cy, cz, hx, hy, hz, mat = mats.plastic, fr = 0.05) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      m.position.set(cx, cy, cz); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(fr).setRestitution(0.08).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), this.body);
    };
    shell(-D / 2, -0.1, 0, D / 2, 0.1, W / 2 + 0.1, mats.plastic, C.FLOOR_FRICTION);   // fondo, labbro basso in x = 0
    shell(-D - 0.1, H / 2, 0, 0.1, H / 2, W / 2 + 0.1, this.colorMat);                 // retro (colore gusto)
    shell(-D / 2, H / 2, W / 2 + 0.1, D / 2 + 0.1, H / 2, 0.1);                        // fianco lato nastro
    shell(-D / 2, H / 2, -(W / 2 + 0.1), D / 2 + 0.1, H / 2, 0.1, this.colorMat);      // fianco lato corridoio AGV (colore gusto)

    // canale della vite (fisso nel mondo): corre lungo tutto il lato basso e sporge sopra il nastro
    const Z0 = C.TROUGH_Z0, ZO = C.Z_OUT, zc = (Z0 + ZO) / 2, hz = (ZO - Z0) / 2;
    const at = (x, z, y) => V3(hinge.x + f.x * x + side.x * z, y, hinge.z + f.z * x + side.z * z);
    const trough = new THREE.Group(); plantGroup.add(trough);
    addBox(trough, { pos: at(C.TROUGH_W / 2, zc, C.TROUGH_Y - 0.1), size: [C.TROUGH_W / 2, 0.1, hz], rotY: this.yaw, mat: mats.steel, friction: 0.25 });
    addBox(trough, { pos: at(C.TROUGH_W + 0.06, zc, C.TROUGH_Y + 0.45), size: [0.06, 0.65, hz], rotY: this.yaw, mat: mats.steel, friction: 0.05 });   // sponda esterna alta: ferma le capsule che arrivano veloci
    addBox(trough, { pos: at(C.TROUGH_W / 2 + 0.05, Z0 - 0.06, C.TROUGH_Y + 0.45), size: [C.TROUGH_W / 2 + 0.11, 0.65, 0.06], rotY: this.yaw, mat: mats.steel, friction: 0.05 });
    const zi0 = W / 2 + 0.2, zic = (zi0 + ZO) / 2, hzi = (ZO - zi0) / 2;   // sponda interna oltre il cassone
    addBox(trough, { pos: at(0, zic, C.TROUGH_Y + 0.35), size: [0.06, 0.45, hzi], rotY: this.yaw, mat: mats.steel, friction: 0.05 });

    // vite di Archimede (elica) lungo il canale
    const L = C.SCREW.len, turns = L / C.SCREW.pitch, pts = [];
    for (let i = 0; i <= turns * 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      pts.push(V3((i / (turns * 18)) * L, Math.sin(a) * C.SCREW.r, Math.cos(a) * C.SCREW.r));
    }
    this.screw = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.045, 6), mats.steel);
    this.screw.castShadow = true;
    this.screwHolder = new THREE.Group();
    this.screwHolder.position.copy(at(C.TROUGH_W / 2 + 0.03, Z0 + 0.05, C.TROUGH_Y + 0.25));
    this.screwHolder.rotation.y = Math.atan2(-side.z, side.x);
    this.screwHolder.add(this.screw); plantGroup.add(this.screwHolder);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), mats.darkSteel);
    motor.rotation.z = Math.PI / 2; motor.position.set(-0.2, 0, 0); this.screwHolder.add(motor);

    // pistone ad aria compressa sotto il lato alto
    const mid = (C.TILT_MIN + C.TILT_MAX) / 2;
    this.pBase = hinge.clone().addScaledVector(f, -((D - 0.3) * Math.cos(mid) + 0.2 * Math.sin(mid))).add(V3(0, C.DECK_Y + 0.25 - hinge.y, 0));
    this.pistonA = makeLink(0.24, mats.darkSteel); this.pistonB = makeLink(0.14, mats.steel);
    plantGroup.add(this.pistonA, this.pistonB);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14), mats.darkSteel); base.position.copy(this.pBase); base.position.y -= 0.15; plantGroup.add(base);

    // etichetta con livello scorta
    this.labelUi = makeBinLabel(FLAVORS[this.flavor][0], '#' + fl.getHexString());
    this.label = this.labelUi.sprite;
    this.label.position.copy(this.local(-2.5, 6.4, 0)); labels.add(this.label);
    this.labelUi.draw(1);
    this.applyTilt(true);
  }

  applyTilt() {
    const q = this.q;
    this.group.quaternion.copy(q);
    if (this.body) this.body.setNextKinematicRotation(q);
    const top = this.worldFromLocal(V3(-C.BIN_D + 0.3, -0.2, 0));
    const mid = this.pBase.clone().lerp(top, 0.55);
    setLink(this.pistonA, this.pBase, mid); setLink(this.pistonB, mid, top);
  }

  updateLabel(S) {
    const frac = this.stock / S.stockInit;
    this.labelUi.draw(frac, this.swapping ? 'AGV' : this.agvRequested ? 'AGV chiamato' : '');
  }
  setSelected(on) { this.selected = on; }

  // riempimento iniziale: capsule distese sul fondo inclinato, senza corpo fisico finché il cassone non lavora
  fill(n) {
    const D = C.BIN_D, W = C.BIN_W, sp = 0.42;
    const slots = [];
    for (let lx = -0.9; lx > -D + 0.6; lx -= sp) for (let lz = -W / 2 + 0.5; lz < W / 2 - 0.4; lz += sp) slots.push([lx, lz]);
    for (let k = 0; k < Math.min(n, slots.length); k++) {
      const [lx, lz] = slots[k];
      this.spawn(this.worldFromLocal(V3(lx + rand(-0.03, 0.03), CAP.h / 2 + 0.005, lz + rand(-0.03, 0.03))), false, true, false);
    }
  }
  spawn(pos, random = true, flat = false, dynamic = true) {
    const q = flat ? this.q.multiply(new THREE.Quaternion().setFromAxisAngle(Y_AX, rand(0, 6.28)))
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)));
    const c = spawnCap(this.flavor, pos, q, { dynamic, state: 'bin' });
    if (c) { c.bin = this; this.caps.add(c); }
    return c;
  }
  clearCaps(killCap) { for (const c of [...this.caps]) killCap(c); this.caps.clear(); }

  xOf(p) { return (p.x - this.hinge.x) * this.f.x + (p.z - this.hinge.z) * this.f.z; }
  zOf(p) { return (p.x - this.hinge.x) * this.side.x + (p.z - this.hinge.z) * this.side.z; }
  get queued() { return this.queue.reduce((a, o) => a + o.remaining, 0); }
}

export const bins = [];
export function buildBins() {
  let id = 0;
  for (const b of belts) for (const sg of [1, -1]) for (let i = 0; i < C.BIN_PER_SIDE; i++) {
    const toBelt = b.s.clone().multiplyScalar(-sg);          // dal cassone verso l'asse del nastro
    const f = V3(toBelt.z, 0, -toBelt.x);                    // pendenza: parallela al nastro, perpendicolare alla vite
    const df = f.x * b.d.x + f.z * b.d.z;                     // ±1: la pendenza guarda verso valle o verso l'hopper
    const tC = C.BIN_FIRST + i * C.BIN_PITCH;
    bins.push(new Bin(id, id, beltPt(b, tC + df * C.BIN_D / 2, sg * C.BIN_LAT, C.HINGE_Y), f, b)); id++;
  }
  // cassone extra in testa al nastro A: la vite scarica lungo l'asse del nastro
  const A = belts[0];
  const toBelt = A.d.clone().multiplyScalar(-1);
  const f = V3(toBelt.z, 0, -toBelt.x);
  const lat = -C.TROUGH_W / 2 * (f.x * A.s.x + f.z * A.s.z);  // l'asse della vite cade sull'asse del nastro
  bins.push(new Bin(id, id, beltPt(A, C.BELT_LEN + 4.1, lat, C.HINGE_Y), f, A, true));
  return bins;
}

// ---------------------------------------------------------------- piano, hall, recinzioni, magazzino
export function buildHall() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshStandardMaterial({ color: 0x3b414a, roughness: 0.55, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(520, 260, 0x4b5360, 0x424954); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  world.createCollider(RAPIER.ColliderDesc.cuboid(260, 1, 260).setTranslation(0, -1, 0).setFriction(0.6));

  // banchine con corridoi AGV, fino alla porta del magazzino esterno
  for (const b of belts) {
    for (const sg of [1, -1]) {
      const t0 = C.BIN_FIRST - 4.2, t1 = b.tDoor + 2;
      const lat0 = C.BIN_FRONT - 0.3, lat1 = 16;
      const mid = beltPt(b, (t0 + t1) / 2, sg * (lat0 + lat1) / 2, C.DECK_Y - 0.15);
      addBox(plantGroup, { pos: mid, size: [(t1 - t0) / 2, 0.15, (lat1 - lat0) / 2], rotY: b.yaw, mat: mats.deck, phys: false });
      // strisce gialle corridoio
      addBox(plantGroup, { pos: beltPt(b, (t0 + t1) / 2, sg * 9.6, C.DECK_Y + 0.01), size: [(t1 - t0) / 2, 0.01, 0.06], rotY: b.yaw, mat: mats.yellow, phys: false, shadow: false });
      // gambe banchina
      for (let t = t0 + 3; t < t1; t += 12) addBox(plantGroup, { pos: beltPt(b, t, sg * 8, C.DECK_Y / 2 - 0.1), size: [0.18, C.DECK_Y / 2, 0.18], rotY: b.yaw, mat: mats.frame, phys: false });
    }
    // magazzino esterno (immaginario): edificio oltre la recinzione, una porta per corridoio
    const bt = b.tDoor + 3 + 4;
    addBox(plantGroup, { pos: beltPt(b, bt, 0, 3), size: [4, 3, 21], rotY: b.yaw, mat: mats.plastic, phys: false });
    addBox(plantGroup, { pos: beltPt(b, bt, 0, 6.2), size: [4.2, 0.2, 21.4], rotY: b.yaw, mat: mats.darkSteel, phys: false });
    for (const sg of [1, -1]) {
      addBox(plantGroup, { pos: beltPt(b, b.tDoor + 3.02, sg * 12.6, C.DECK_Y + 1.7), size: [0.05, 1.7, 2.3], rotY: b.yaw, mat: mats.rubber, phys: false, shadow: false });
      addBox(plantGroup, { pos: beltPt(b, b.tDoor + 3.02, sg * 12.6, C.DECK_Y + 3.6), size: [0.05, 0.12, 2.5], rotY: b.yaw, mat: mats.yellow, phys: false, shadow: false });
    }
    const lab = labelSprite('MAGAZZINO · cassoni di scorta', '#ffc86b', 1.6); lab.position.copy(beltPt(b, bt, 0, 9)); labels.add(lab);
    // pile di cassoni di scorta davanti al magazzino
    for (let k = 0; k < 7; k++) {
      const col = new THREE.MeshStandardMaterial({ color: flavorColors[(k * 6 + b.name.charCodeAt(0)) % C.NF], roughness: 0.5 });
      addBox(plantGroup, { pos: beltPt(b, b.tDoor + 5.4, (k - 3) * 2.3, 1.2), size: [0.9, 1.2, 0.9], rotY: b.yaw, mat: col, phys: false });
    }
  }
  // recinzione perimetrale trasparente con montanti
  const posts = [];
  const rect = { x0: -82, x1: 82, z0: -92, z1: 50 };
  const fenceH = 6;
  const seg = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 8);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(L, fenceH), mats.glass);
    m.position.set((ax + bx) / 2, fenceH / 2 + 0.3, (az + bz) / 2); m.rotation.y = -Math.atan2(bz - az, bx - ax); scene.add(m);
    for (let i = 0; i <= n; i++) posts.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n]);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 0.12), mats.yellow); rail.position.set((ax + bx) / 2, fenceH + 0.3, (az + bz) / 2); rail.rotation.y = m.rotation.y; scene.add(rail);
  };
  seg(rect.x0, rect.z0, rect.x1, rect.z0); seg(rect.x1, rect.z0, rect.x1, rect.z1);
  seg(rect.x1, rect.z1, rect.x0, rect.z1); seg(rect.x0, rect.z1, rect.x0, rect.z0);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, fenceH + 0.3, 0.25), mats.yellow, posts.length);
  const o = new THREE.Object3D();
  posts.forEach(([x, z], i) => { o.position.set(x, (fenceH + 0.3) / 2, z); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); });
  inst.castShadow = true; scene.add(inst);
}

export function buildBelts() { belts.forEach(buildBelt); }
