import { THREE, scene, V3, mats, addBox, makeLink, setLink, labelSprite, writeMatrix, killCap, smooth, clamp } from './core.js';
import * as C from './config.js';
import { CAP } from './config.js';
import { labels, plantGroup } from './plant.js';
import { R } from './table.js';

// ============================================================ corsia di allineamento
export const LANE_Y = 1.1;
export const LANE_ITEM_Y = LANE_Y + CAP.h / 2 + 0.04;
export const HEAD_X = 25;
export const LANE_SPACING = 0.5;
export const LANE_Z = R + 14;
const PATH = [[0, R], [0, R + 4.5], [2.5, R + 8], [4, LANE_Z], [8, LANE_Z], [HEAD_X, LANE_Z]];
const segLen = [], cum = [0];
for (let i = 1; i < PATH.length; i++) {
  segLen.push(Math.hypot(PATH[i][0] - PATH[i - 1][0], PATH[i][1] - PATH[i - 1][1]));
  cum.push(cum[i - 1] + segLen[i - 1]);
}
export const LANE_LEN = cum[cum.length - 1];
export function laneAt(s, out = V3()) {
  s = clamp(s, 0, LANE_LEN);
  let i = 1; while (i < cum.length - 1 && s > cum[i]) i++;
  const t = (s - cum[i - 1]) / segLen[i - 1];
  return out.set(PATH[i - 1][0] + (PATH[i][0] - PATH[i - 1][0]) * t, LANE_ITEM_Y, PATH[i - 1][1] + (PATH[i][1] - PATH[i - 1][1]) * t);
}

export const lane = { items: [], speed: 9 };
export function buildLane() {
  for (let i = 1; i < PATH.length; i++) {
    const [ax, az] = PATH[i - 1], [bx, bz] = PATH[i];
    const L = segLen[i - 1], ang = Math.atan2(-(bz - az), bx - ax);
    const mid = V3((ax + bx) / 2, 0, (az + bz) / 2);
    addBox(plantGroup, { pos: V3(mid.x, LANE_Y - 0.1, mid.z), size: [L / 2 + 0.2, 0.1, 0.38], rotY: ang, mat: mats.darkSteel, phys: false });
    for (const sg of [-1, 1]) {
      const off = V3(-(bz - az) / L * 0.36 * sg, 0, (bx - ax) / L * 0.36 * sg);
      addBox(plantGroup, { pos: V3(mid.x + off.x, LANE_Y + 0.3, mid.z + off.z), size: [L / 2 + 0.2, 0.3, 0.03], rotY: ang, mat: mats.brushed, phys: false });
    }
  }
  const lab = labelSprite('Guide · buffer da 36 capsule dritte', '#7cf', 1.2); lab.position.set(14, 4.2, LANE_Z); labels.add(lab);
}
export function laneCanAccept() { return lane.items.length < 40 && (lane.items.length === 0 || lane.items[lane.items.length - 1].s > LANE_SPACING); }
export function laneEmit(c, cell) {
  c.state = 'lane'; c.s = 0; c.cell = cell; c.reserved = false; c.quat.identity();
  lane.items.push(c);
}
export function updateLane(dt) {
  let prev = null;
  for (let i = 0; i < lane.items.length; i++) {
    const c = lane.items[i];
    const lim = prev ? prev.s - LANE_SPACING : LANE_LEN;
    c.s = Math.min(c.s + lane.speed * dt, Math.max(c.s, lim));
    c.settled = Math.abs(c.s - lim) < 0.02;
    laneAt(c.s, c.pos); writeMatrix(c);
    prev = c;
  }
}

// ============================================================ nastro scatole
export const BOX_Z = LANE_Z + 4;
export const STATION_X = HEAD_X + 1.4;
export const BOX_PITCH = 5.6;
const CELL = 0.46;
export const cellLocal = (k) => V3(((k % 6) - 2.5) * CELL, 0.12 + CAP.h / 2, (Math.floor(k / 6) - 2.5) * CELL);

export const boxLine = { boxes: [], offset: 0, moving: false, target: 0, done: 0, completed: [] };
function makeBox() {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 3.2), mats.cardboard); floor.position.y = 0.05; g.add(floor);
  for (const sg of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.55, 0.06), mats.cardboard); a.position.set(0, 0.28, sg * 1.62); g.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 3.2), mats.cardboard); b.position.set(sg * 1.62, 0.28, 0); g.add(b);
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  scene.add(g);
  return { g, x: 0, order: null, placed: 0, reserved: 0, state: 'empty', caps: [], slotIdx: 0 };
}
const slotX = (i) => STATION_X + i * BOX_PITCH;   // i = 0 stazione; -1, -2 a monte; +1, +2 a valle
export function buildBoxLine() {
  const len = 52, x0 = STATION_X - 3 * BOX_PITCH;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 3.8), mats.rubber); belt.position.set(x0 + len / 2 - 3, LANE_Y - 0.15, BOX_Z); belt.receiveShadow = true; scene.add(belt);
  addBox(scene, { pos: V3(x0 + len / 2 - 3, LANE_Y - 0.55, BOX_Z), size: [len / 2, 0.12, 2.1], mat: mats.frame, phys: false });
  for (let x = x0; x < x0 + len - 3; x += 8) for (const sg of [-1, 1]) addBox(scene, { pos: V3(x, (LANE_Y - 0.6) / 2, BOX_Z + sg * 2), size: [0.12, (LANE_Y - 0.6) / 2, 0.12], mat: mats.frame, phys: false });
  for (const sg of [-1, 1]) addBox(scene, { pos: V3(x0 + len / 2 - 3, LANE_Y + 0.05, BOX_Z + sg * 2.05), size: [len / 2, 0.15, 0.05], mat: mats.steel, phys: false });
  const lab = labelSprite('Nastro scatole', '#fc8', 1.1); lab.position.set(STATION_X, 5, BOX_Z + 3); labels.add(lab);
  for (let i = -1; i <= 0; i++) { const b = makeBox(); b.slotIdx = i; boxLine.boxes.push(b); }
  boxLine.boxes[1].state = 'filling'; boxLine.boxes[0].state = 'empty';
  placeBoxes();
}
function placeBoxes() {
  for (const b of boxLine.boxes) { b.x = slotX(b.slotIdx) + boxLine.offset; b.g.position.set(b.x, LANE_Y, BOX_Z); }
}
export const stationBox = () => boxLine.boxes.find((b) => b.slotIdx === 0 && !boxLine.moving);

export function boxPlace(b, c) {
  c.state = 'boxed'; c.box = b; b.caps.push(c); b.placed++;
  c.pos.copy(b.g.position).add(cellLocal(c.cell)); c.quat.identity(); writeMatrix(c);
}
export function boxLineAdvance() {
  boxLine.moving = true; boxLine.target = BOX_PITCH; boxLine.offset = 0;
}
export function updateBoxLine(dt, cb) {
  if (boxLine.moving) {
    boxLine.offset += 7 * dt;
    if (boxLine.offset >= BOX_PITCH) {
      boxLine.offset = 0; boxLine.moving = false;
      for (const b of boxLine.boxes) b.slotIdx++;
      for (const b of [...boxLine.boxes]) if (b.slotIdx > 2) { b.caps.forEach(killCap); scene.remove(b.g); boxLine.boxes.splice(boxLine.boxes.indexOf(b), 1); }
      const nb = makeBox(); nb.slotIdx = -1; boxLine.boxes.push(nb);
      cb && cb();
    }
    placeBoxes();
    for (const b of boxLine.boxes) for (const c of b.caps) { c.pos.copy(b.g.position).add(cellLocal(c.cell)); writeMatrix(c); }
  }
}

// ============================================================ robot delta
export const DELTA = { Rb: 2.0, Re: 0.65, L1: 5.2, L2: 11.4, Y: 14.5 };
export class Delta {
  constructor(base, name) {
    this.base = base.clone(); this.name = name;
    this.P = V3(base.x, 5, base.z); this.phase = 'idle'; this.t = 0; this.job = null; this.busy = 0; this.life = 0; this.picks = 0;
    this.from = this.P.clone(); this.T = 0.42;
    const g = this.group = new THREE.Group(); scene.add(g);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 36), mats.white); plate.position.copy(base); plate.position.y += 0.35; g.add(plate);
    this.arms = []; this.rods = []; this.motors = [];
    for (let k = 0; k < 3; k++) {
      const mo = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 16), mats.darkSteel); mo.castShadow = true; g.add(mo); this.motors.push(mo);
      const ua = makeLink(0.16, mats.white); g.add(ua); this.arms.push(ua);
      const r1 = makeLink(0.06, mats.steel), r2 = makeLink(0.06, mats.steel); g.add(r1, r2); this.rods.push([r1, r2]);
    }
    this.eff = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.22, 24), mats.darkSteel); this.eff.castShadow = true; g.add(this.eff);
    this.stem = makeLink(0.07, mats.steel); g.add(this.stem);
    this.cup = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })); this.cup.rotation.x = Math.PI; g.add(this.cup);
    this.solve(this.P);
  }
  solve(P) {
    const { Rb, Re, L1, L2 } = DELTA, b = this.base;
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + k * Math.PI * 2 / 3, rh = V3(Math.cos(a), 0, Math.sin(a)), th = V3(-Math.sin(a), 0, Math.cos(a));
      const M = b.clone().addScaledVector(rh, Rb);
      const E = P.clone().addScaledVector(rh, Re).add(V3(0, 0.25, 0));
      const d = E.clone().sub(M), er = d.dot(rh), ez = d.y, et = d.dot(th);
      const K = (L1 * L1 + er * er + et * et + ez * ez - L2 * L2) / (2 * L1);
      const rho = Math.hypot(er, ez), dl = Math.atan2(ez, er);
      const cs = clamp(K / rho, -1, 1), ph = [Math.acos(cs) - dl, -Math.acos(cs) - dl];
      const cand = ph.map((p) => ({ p, r: L1 * Math.cos(p) }));
      const best = cand[0].r > cand[1].r ? cand[0] : cand[1];
      const J = M.clone().addScaledVector(rh, L1 * Math.cos(best.p)).add(V3(0, -L1 * Math.sin(best.p), 0));
      this.motors[k].position.copy(M); this.motors[k].rotation.set(0, 0, 0); this.motors[k].quaternion.setFromUnitVectors(V3(0, 1, 0), th);
      setLink(this.arms[k], M, J);
      const off = th.clone().multiplyScalar(0.32);
      setLink(this.rods[k][0], J.clone().add(off), E.clone().add(off));
      setLink(this.rods[k][1], J.clone().sub(off), E.clone().sub(off));
    }
    this.eff.position.copy(P).add(V3(0, 0.12, 0));
    setLink(this.stem, P.clone().add(V3(0, 0.1, 0)), P.clone().add(V3(0, -0.55, 0)));
    this.cup.position.copy(P).add(V3(0, -0.66, 0));
  }
  tip() { return V3(this.P.x, this.P.y - 0.74, this.P.z); }
  setTarget(to, dur) { this.from = this.P.clone(); this.to = to; this.dur = Math.max(dur, 1e-3); this.t = 0; }
}

// ============================================================ AGV
export class AGV {
  constructor(name) {
    this.name = name;
    const g = this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 3), mats.agv); body.position.y = 0.4; g.add(body);
    const lift = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 2.6), mats.darkSteel); lift.position.y = 0.75; g.add(lift);
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3.1, 12), mats.rubber); w.rotation.x = Math.PI / 2; w.position.set(sx * 1.8, 0.25, 0); g.add(w); }
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 2.2), mats.led); led.position.set(2.5, 0.5, 0); g.add(led);
    this.load = new THREE.Group(); this.load.position.y = 0.8; g.add(this.load);
    const pal = new THREE.Mesh(new THREE.BoxGeometry(4, 1.0, 4), mats.wood); pal.position.y = 0.5; this.load.add(pal);
    this.binProxy = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.4, 3.8), mats.plastic); this.binProxy.position.y = 1.7; this.load.add(this.binProxy);
    this.tagMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); const tag = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.4, 3.9), this.tagMat); tag.position.y = 2.4; this.load.add(tag);
    this.load.visible = false;
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
    scene.add(g);
    this.path = []; this.idx = 0; this.speed = 9; this.cb = null; this.state = 'idle'; this.bin = null;
  }
  place(p) { this.group.position.set(p.x, C.DECK_Y, p.z); }
  follow(path, cb) { this.path = path; this.idx = 0; this.cb = cb; this.group.visible = true; this.place(path[0]); }
  update(dt) {
    if (!this.path.length || this.idx >= this.path.length - 1) return;
    const a = this.group.position, b = this.path[this.idx + 1];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), step = this.speed * dt;
    if (d > 1e-3) this.group.rotation.y = Math.atan2(-dz, dx);
    if (step >= d) { a.x = b.x; a.z = b.z; this.idx++; if (this.idx >= this.path.length - 1) { const cb = this.cb; this.cb = null; cb && cb(); } }
    else { a.x += dx / d * step; a.z += dz / d * step; }
  }
}
