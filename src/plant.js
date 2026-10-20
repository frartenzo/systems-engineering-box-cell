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
const mkBelt = (name, d, s, end) => ({ name, d, s, end, len: C.BELT_LEN, yaw: Math.atan2(-d.z, d.x), tex: null });
export const belts = [
  mkBelt('A', V3(0, 0, -1), V3(1, 0, 0), V3(0, 0, -C.R_TABLE - 2.2)),
  mkBelt('B', V3(-1, 0, 0), V3(0, 0, 1), V3(-2.2, 0, -C.R_TABLE)),
  mkBelt('C', V3(1, 0, 0), V3(0, 0, 1), V3(2.2, 0, -C.R_TABLE)),
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
export class Bin {
  constructor(id, flavor, hinge, f, belt) {
    this.id = id; this.flavor = flavor; this.hinge = hinge.clone(); this.f = f.clone(); this.belt = belt;
    this.side = V3(-f.z, 0, f.x); // z locale del cassone
    this.yaw = Math.atan2(-f.z, f.x);
    this.qYaw = yawQ(this.yaw);
    this.tilt = 0; this.queue = []; this.idle = 0; this.online = true;
    this.stock = C.defaults.binStock; this.caps = new Set(); this.moving = []; this.slotTimer = 0;
    this.screwAng = 0; this.screwSpeed = 0; this.agv = null; this.state = 'online';
    this.build();
  }

  local(x, y, z) { // coordinate locali del cassone (a tilt 0) -> mondo
    return this.hinge.clone().addScaledVector(this.f, x).addScaledVector(this.side, z).add(V3(0, y, 0));
  }
  worldFromLocal(v) { // con tilt corrente
    return v.clone().applyQuaternion(this.q).add(this.hinge);
  }
  get q() { return this.qYaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -(C.TILT * this.tilt + (this.wobble || 0)))); }

  build() {
    const { hinge, f } = this, D = C.BIN_D, W = C.BIN_W, H = C.BIN_H;
    // pallet e piano
    const pallet = new THREE.Group(); plantGroup.add(pallet);
    const pTop = C.HINGE_Y - 0.2, pH = pTop - C.DECK_Y;
    addBox(pallet, { pos: this.local(-D / 2, (pTop + C.DECK_Y) / 2 - C.HINGE_Y, 0), size: [D / 2 + 0.1, pH / 2, W / 2 + 0.1], rotY: this.yaw, mat: mats.wood, phys: false });
    this.pallet = pallet;
    // corpo cinematico
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hinge.x, hinge.y, hinge.z).setRotation(this.q));
    this.group = new THREE.Group(); this.group.position.copy(hinge); scene.add(this.group);
    const fl = flavorColors[this.flavor];
    const colorMat = new THREE.MeshStandardMaterial({ color: fl, roughness: 0.5, metalness: 0.2, emissive: fl, emissiveIntensity: 0.15 });
    const shell = (cx, cy, cz, hx, hy, hz, rot = 0, mat = mats.plastic, fr = 0.1) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      m.position.set(cx, cy, cz); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rot);
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(q).setFriction(fr).setRestitution(0.08).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), this.body);
    };
    shell(-D / 2, -0.1, 0, D / 2, 0.1, W / 2 + 0.1, 0, mats.plastic, 0.05);          // fondo
    shell(-D - 0.1, H / 2, 0, 0.1, H / 2, W / 2 + 0.1, 0, colorMat);                // retro (colore gusto)
    for (const sg of [-1, 1]) shell(-D / 2, H / 2, sg * (W / 2 + 0.1), D / 2 + 0.1, H / 2, 0.1);
    const slotHalf = 0.45;
    for (const sg of [-1, 1]) {
      const zc = sg * (slotHalf + W / 2) / 2, hz = (W / 2 - slotHalf) / 2;
      shell(0, H / 2, zc, 0.1, H / 2, hz, 0, mats.plastic, 0.05);
      // imbuto
      const dx = -3, dz = sg * (W / 2 - slotHalf), L = Math.hypot(dx, dz);
      shell(dx / 2, H / 2, sg * slotHalf + dz / 2, L / 2, H / 2, 0.06, Math.atan2(-dz, dx), mats.plastic, 0.05);
    }
    shell(0, 0.6 + (H - 0.6) / 2, 0, 0.1, (H - 0.6) / 2, slotHalf, 0, mats.plastic, 0.05); // architrave
    // targhetta colore sul fronte
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 2.4), colorMat); tag.position.set(0.22, H - 0.9, 0); this.group.add(tag);

    // canale della vite (fisso nel mondo)
    const L = C.SCREW.len, sd = this.side;
    const at = (u, lat, y) => hinge.clone().addScaledVector(f, u).addScaledVector(sd, lat).add(V3(0, y - hinge.y, 0));
    const trough = new THREE.Group(); plantGroup.add(trough);
    addBox(trough, { pos: at((L - 0.15) / 2, 0, C.TROUGH_Y - 0.1), size: [(L - 0.15) / 2, 0.1, 0.5], rotY: this.yaw, mat: mats.steel, friction: 0.25 });
    for (const sg of [-1, 1]) addBox(trough, { pos: at((L - 0.15) / 2 - 0.05, sg * 0.56, C.TROUGH_Y + 0.35), size: [(L - 0.05) / 2, 0.35, 0.06], rotY: this.yaw, mat: mats.steel, friction: 0.05 });
    addBox(trough, { pos: at(1.0, 0, C.TROUGH_Y + 0.45), size: [0.05, 0.45, 0.5], rotY: this.yaw, mat: mats.steel, friction: 0.05, visible: false });
    // vite di Archimede (elica)
    const turns = L / C.SCREW.pitch, pts = [];
    for (let i = 0; i <= turns * 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      pts.push(V3((i / (turns * 18)) * L, Math.sin(a) * C.SCREW.r, Math.cos(a) * C.SCREW.r));
    }
    this.screw = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.045, 6), mats.steel);
    this.screw.castShadow = true;
    const sp = at(0, 0, C.TROUGH_Y + 0.25);
    this.screwHolder = new THREE.Group(); this.screwHolder.position.copy(sp); this.screwHolder.rotation.y = this.yaw; this.screwHolder.add(this.screw); plantGroup.add(this.screwHolder);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), mats.darkSteel);
    motor.rotation.z = Math.PI / 2; motor.position.set(-0.2, 0, 0); this.screwHolder.add(motor);

    // pistone ad aria compressa
    this.pBase = hinge.clone().addScaledVector(f, -(D * Math.cos(C.TILT) - 0.4)).add(V3(0, C.DECK_Y + 0.25 - hinge.y, 0));
    this.pistonA = makeLink(0.24, mats.darkSteel); this.pistonB = makeLink(0.14, mats.steel);
    plantGroup.add(this.pistonA, this.pistonB);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14), mats.darkSteel); base.position.copy(this.pBase); base.position.y -= 0.15; plantGroup.add(base);

    // etichetta
    const lab = labelSprite(FLAVORS[this.flavor][0], '#' + fl.getHexString(), 0.8);
    lab.position.copy(this.local(-2.5, 6.4, 0)); labels.add(lab); this.label = lab;
    this.applyTilt(true);
  }

  applyTilt(kin = false) {
    const q = this.q;
    this.group.quaternion.copy(q);
    if (this.body) this.body.setNextKinematicRotation(q);
    const top = this.worldFromLocal(V3(-C.BIN_D + 0.3, -0.2, 0));
    const mid = this.pBase.clone().lerp(top, 0.55);
    setLink(this.pistonA, this.pBase, mid); setLink(this.pistonB, mid, top);
  }

  // riempimento iniziale: capsule ritte in griglia sul fondo, senza corpo fisico finché il cassone non lavora
  fill(n) {
    const D = C.BIN_D, W = C.BIN_W, sp = 0.42;
    const slots = [];
    const wedge = (x) => 0.45 + clamp(-x, 0, 3) * ((W / 2 - 0.45) / 3);   // semi-larghezza dell'imbuto alla profondità x
    for (let lx = -1.0; lx > -D + 0.5; lx -= sp) for (let lz = -W / 2 + 0.5; lz < W / 2 - 0.4; lz += sp) if (Math.abs(lz) < wedge(lx) - 0.3) slots.push([lx, lz]);
    for (let k = 0; k < Math.min(n, slots.length); k++) {
      const [lx, lz] = slots[k];
      this.spawn(this.local(lx + rand(-0.03, 0.03), CAP.h / 2 + 0.005, lz + rand(-0.03, 0.03)), false, true, false);
    }
  }
  spawn(pos, random = true, upright = false, dynamic = true) {
    const q = upright ? new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rand(0, 6.28))
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)));
    const c = spawnCap(this.flavor, pos, q, { dynamic, state: 'bin' });
    if (c) { c.bin = this; this.caps.add(c); }
    return c;
  }
  clearCaps(killCap) { for (const c of [...this.caps]) killCap(c); this.caps.clear(); }

  uOf(p) { return (p.x - this.hinge.x) * this.f.x + (p.z - this.hinge.z) * this.f.z; }
  latOf(p) { return (p.x - this.hinge.x) * this.side.x + (p.z - this.hinge.z) * this.side.z; }
  get queued() { return this.queue.reduce((a, o) => a + o.remaining, 0); }
}

export const bins = [];
export function buildBins() {
  let id = 0;
  for (const b of belts) for (const sg of [1, -1]) for (let i = 0; i < C.BIN_PER_SIDE; i++) {
    const hinge = beltPt(b, C.BIN_FIRST + i * C.BIN_PITCH, sg * C.BIN_FRONT, C.HINGE_Y);
    const f = b.s.clone().multiplyScalar(-sg);
    bins.push(new Bin(id, id, hinge, f, b)); id++;
  }
  const A = belts[0];
  bins.push(new Bin(id, id, beltPt(A, C.BELT_LEN + 1.2, 0, C.HINGE_Y), A.d.clone().multiplyScalar(-1), A));
  return bins;
}

// ---------------------------------------------------------------- piano, hall, recinzioni
export function buildHall() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshStandardMaterial({ color: 0x3b414a, roughness: 0.55, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(520, 260, 0x4b5360, 0x424954); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  world.createCollider(RAPIER.ColliderDesc.cuboid(260, 1, 260).setTranslation(0, -1, 0).setFriction(0.6));

  // banchine con corridoi AGV
  for (const b of belts) for (const sg of [1, -1]) {
    const t0 = C.BIN_FIRST - 4.2, t1 = C.BELT_LEN + 3;
    const lat0 = C.BIN_FRONT - 0.3, lat1 = 16;
    const mid = beltPt(b, (t0 + t1) / 2, sg * (lat0 + lat1) / 2, C.DECK_Y - 0.15);
    addBox(plantGroup, { pos: mid, size: [(t1 - t0) / 2, 0.15, (lat1 - lat0) / 2], rotY: b.yaw, mat: mats.deck, phys: false });
    // strisce gialle corridoio
    addBox(plantGroup, { pos: beltPt(b, (t0 + t1) / 2, sg * 9.6, C.DECK_Y + 0.01), size: [(t1 - t0) / 2, 0.01, 0.06], rotY: b.yaw, mat: mats.yellow, phys: false, shadow: false });
    // gambe banchina
    for (let t = t0 + 3; t < t1; t += 12) addBox(plantGroup, { pos: beltPt(b, t, sg * 8, C.DECK_Y / 2 - 0.1), size: [0.18, C.DECK_Y / 2, 0.18], rotY: b.yaw, mat: mats.frame, phys: false });
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
