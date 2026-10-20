import { THREE, RAPIER, world, V3, yawQ, rand, clamp, smooth, spawnCap, killCap, dropBody, makeBody, syncCaps, writeMatrix, touchInstances, allCaps, physCaps, capMesh, flavorColors } from './core.js';
import * as C from './config.js';
import { FLAVORS, CAP, NF, BOX_SIZE } from './config.js';
import { belts, bins, beltT, beltLat, beltPt, HUB } from './plant.js';
import { table, stationPos, stationOf, slotAt, updateTable, BOWL_R, BOWL_FLOOR } from './table.js';
import { lane, laneEmit, laneCanAccept, updateLane, boxLine, stationBox, boxPlace, boxLineAdvance, updateBoxLine, Delta, DELTA, AGV, LANE_ITEM_Y, HEAD_X, LANE_Y, BOX_Z, LANE_Z, STATION_X, cellLocal } from './line.js';
import { R } from './table.js';

export const P = { ...C.defaults, paused: false, maxActive: 3, lowWater: 0.15 };
export const S = {
  time: 0, orders: [], nextId: 1, boxesDone: 0, boxTimes: [], lost: 0, log: [], awake: 0, util: 0, idxWait: '',
  physSteps: 0, rtf: 1, delivered: 0, stockInit: P.binStock, rate: 0, lastBox: 0,
};
export const deltas = [];
const flow = new Set();               // capsule in volo: fall | belt | hop
const binByFlavor = [];
const agvs = new Map();
const H = 1 / 60;
let acc = 0;
const Yax = V3(0, 1, 0);

export const log = (t, cls = '') => { S.log.unshift({ t: S.time, msg: t, cls }); if (S.log.length > 40) S.log.pop(); };

// ============================================================ ordini
const weights = FLAVORS.map((_, i) => 1 / (1 + (i % 9) * 0.35));
function pickFlavors(k) {
  const chosen = [];
  while (chosen.length < k) {
    const tot = weights.reduce((a, b, i) => a + (chosen.includes(i) ? 0 : b), 0);
    let r = Math.random() * tot, f = 0;
    for (; f < NF; f++) { if (chosen.includes(f)) continue; r -= weights[f]; if (r <= 0) break; }
    chosen.push(Math.min(f, NF - 1));
  }
  return chosen;
}
export function genOrder() {
  const r = Math.random(), k = r < 0.22 ? 1 : r < 0.57 ? 2 : r < 0.82 ? 3 : 4;
  const fl = pickFlavors(k);
  const cuts = new Set();
  while (cuts.size < k - 1) cuts.add(1 + Math.floor(Math.random() * (BOX_SIZE - 1)));
  const arr = [0, ...[...cuts].sort((a, b) => a - b), BOX_SIZE];
  const counts = {};
  fl.forEach((f, i) => { counts[f] = arr[i + 1] - arr[i]; });
  return counts;
}
export function addOrder(counts, manual = false) {
  const o = { id: S.nextId++, counts, status: 'queued', released: 0, relF: {}, camF: {}, camera: 0, arrived: 0, bowl: [], lastArrival: 0, t0: S.time, manual };
  S.orders.push(o);
  log(`Ordine #${o.id}: ` + Object.entries(counts).map(([f, n]) => `${n}× ${FLAVORS[f][0]}`).join(', '), 'ord');
  return o;
}
const activeCount = () => S.orders.filter((o) => o.status === 'dosing' || o.status === 'collecting').length;
function dispatch() {
  if (P.autoOrders && S.orders.filter((o) => o.status === 'queued').length < 2) addOrder(genOrder());
  const next = S.orders.find((o) => o.status === 'queued');
  if (next && activeCount() < P.maxActive) {
    for (const [f, n] of Object.entries(next.counts)) binByFlavor[f].queue.push({ order: next, remaining: n, flavor: +f });
    next.status = 'dosing'; next.tDose = S.time;
  }
}

// ============================================================ cassoni: tilt, vite, cattura
const vs = () => P.screwRate * C.SCREW.pitch;
function stepBin(bin, h) {
  // movimento delle capsule catturate dalla vite
  if (bin.moving.length) {
    const v = vs();
    for (let i = bin.moving.length - 1; i >= 0; i--) {
      const c = bin.moving[i];
      c.u += v * h;
      const p = bin.hinge.clone().addScaledVector(bin.f, c.u); p.y = C.TROUGH_Y + CAP.h / 2 + 0.01;
      c.body.setNextKinematicTranslation(p);
      if (c.u >= C.SCREW.len) {
        c.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        c.body.setLinvel({ x: bin.f.x * v * 1.3, y: 0, z: bin.f.z * v * 1.3 }, true);
        c.state = 'fall'; c.belt = bin.belt; c.lastT = undefined; flow.add(c);
        bin.moving.splice(i, 1);
      }
    }
  }
  let rot = false;
  if (bin.tiltTarget !== undefined && Math.abs(bin.tilt - bin.tiltTarget) > 1e-4) {
    bin.tilt += clamp(bin.tiltTarget - bin.tilt, -h / 2.2, h / 2.2); rot = true;
  }
  // vibrazione leggera mentre la vite lavora: rompe gli archi di capsule sull'imbocco
  const wob = bin.screwSpeed > 0.3 ? 0.05 * Math.sin(S.time * 55 + bin.id) : 0;
  if (wob !== bin.wobble) { bin.wobble = wob; rot = true; }
  if (rot) bin.body.setNextKinematicRotation(bin.q);
}
function capture(bin) {
  const head = bin.queue[0]; let best = null, bu = -1;
  for (const c of bin.caps) {
    if (c.state !== 'bin' || !c.body) continue;
    const u = bin.uOf(c.pos), lat = bin.latOf(c.pos), dy = c.pos.y - C.TROUGH_Y;
    if (u > 0.0 && u < 0.85 && Math.abs(lat) < 0.4 && dy > 0.02 && dy < 0.7 && u > bu) { best = c; bu = u; }
  }
  if (!best) return false;
  const c = best;
  c.state = 'screw'; c.order = head.order; c.u = Math.max(bu, 0.12);
  c.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const p = bin.hinge.clone().addScaledVector(bin.f, c.u); p.y = C.TROUGH_Y + CAP.h / 2 + 0.01;
  c.body.setTranslation(p, true); c.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  c.pos.copy(p); c.quat.identity();
  bin.caps.delete(c); bin.moving.push(c);
  head.remaining--; head.order.released++; head.order.relF[head.flavor] = (head.order.relF[head.flavor] || 0) + 1;
  bin.stock--; bin.capN = (bin.capN || 0) + 1; (bin.capT ||= []).push(+S.time.toFixed(1)); bin.firstCap ??= S.time;
  if (head.remaining <= 0) bin.queue.shift();
  return true;
}
function updateBin(bin, dt) {
  const active = bin.online && bin.queue.length > 0;
  if (active) {
    if (!bin.live) { for (const c of bin.caps) if (!c.body) makeBody(c); bin.live = true; }
    bin.idle = 0;
  } else {
    bin.idle += dt;
    // a cassone fermo e piatto le capsule tornano "statiche" (niente costo fisico)
    if (bin.live && bin.idle > 4 && bin.tilt < 0.02 && [...bin.caps].every((c) => !c.body || c.body.isSleeping())) {
      for (const c of bin.caps) dropBody(c);
      bin.live = false;
    }
  }
  bin.tiltTarget = active ? 1 : (bin.idle > 3 ? 0 : bin.tilt);
  const ready = active && bin.tilt > 0.93;
  bin.screwSpeed += ((ready ? 1 : 0) - bin.screwSpeed) * Math.min(1, dt * 4);
  bin.screwAng += bin.screwSpeed * P.screwRate * Math.PI * 2 * dt;
  bin.screwHolder.children[0].rotation.x = bin.screwAng;
  if (ready) {
    bin.slotTimer += dt;
    if (bin.slotTimer >= 1 / P.screwRate) { bin.slotTimer = capture(bin) ? 0 : 1 / P.screwRate; }
    // ricarica fisica graduale dal "serbatoio" virtuale
    bin.spawnT = (bin.spawnT || 0) + dt;
    if (bin.spawnT > 0.08 && bin.caps.size < 28 && bin.stock > bin.caps.size + bin.moving.length) {
      bin.spawnT = 0;
      bin.spawn(bin.worldFromLocal(V3(-C.BIN_D + 0.9, 1.4, rand(-1.8, 1.8))));
    }
  }
  if (bin.live) for (const c of [...bin.caps]) {
    if (c.body && (c.pos.y < 1 || c.pos.distanceTo(bin.hinge) > 12)) { bin.caps.delete(c); killCap(c); log(`Capsula espulsa dal cassone ${bin.id + 1}`, 'err'); }
  }
  bin.applyTilt();
  // scorta bassa -> AGV
  if (bin.online && !bin.swapping && bin.stock <= Math.max(5, S.stockInit * P.lowWater)) startSwap(bin);
}

// ============================================================ AGV
function agvFor(bin) {
  const key = bin.belt.name + (bin.extra ? 'X' : bin.sg);
  if (!agvs.has(key)) { const a = new AGV(key); a.state = 'idle'; a.group.visible = false; agvs.set(key, a); }
  return agvs.get(key);
}
function startSwap(bin) {
  const agv = agvFor(bin);
  if (agv.state !== 'idle') return;      // il corridoio ha un solo AGV: attende
  bin.swapping = true; agv.state = 'going'; agv.bin = bin;
  const fl = flavorColors[bin.flavor];
  agv.tagMat.color.copy(fl); agv.load.visible = true; agv.binProxy.visible = true;
  log(`AGV ${agv.name}: porta nuovo cassone "${FLAVORS[bin.flavor][0]}"`, 'agv');
  const route = bin.route;
  agv.follow(route.map((p) => p.clone()), () => {
    // arrivo: ritira il cassone vuoto
    bin.online = false; bin.group.visible = false; bin.pallet.visible = false;
    bin.clearCaps(killCap); bin.queue.forEach((q) => { q.held = true; });
    agv.tagMat.color.setHex(0x666666); agv.state = 'returning';
    agv.follow([...route].reverse().map((p) => p.clone()), () => {
      agv.tagMat.color.copy(fl); agv.state = 'coming';
      agv.follow(route.map((p) => p.clone()), () => {
        bin.group.visible = true; bin.pallet.visible = true; bin.stock = S.stockInit; bin.fill(30); bin.online = true; bin.swapping = false;
        agv.load.visible = false; agv.state = 'leaving';
        agv.follow([...route].reverse().map((p) => p.clone()), () => { agv.state = 'idle'; agv.group.visible = false; });
        log(`Cassone "${FLAVORS[bin.flavor][0]}" sostituito (${S.stockInit} capsule)`, 'agv');
      });
    });
  });
}

// ============================================================ nastri, camera, vasca
function stepFlow(h) {
  const k = 1 - Math.exp(-16 * h);
  for (const c of flow) {
    if (!c.body) continue;
    const t = c.body.translation(), b = c.belt;
    const tt = beltT(b, t), lat = beltLat(b, t);
    const on = tt > -0.25 && tt < b.len && Math.abs(lat) < 1.55 && t.y < C.BELT_Y + 0.9 && t.y > C.BELT_Y - 0.1;
    if (on) {
      if (c.state === 'fall') c.state = 'belt';
      const lv = c.body.linvel(), vx = -b.d.x * P.beltSpeed, vz = -b.d.z * P.beltSpeed;
      c.body.setLinvel({ x: lv.x + (vx - lv.x) * k, y: lv.y, z: lv.z + (vz - lv.z) * k }, true);
    } else if (c.state === 'belt') c.state = 'hop';
  }
}
function updateFlow() {
  for (const c of [...flow]) {
    if (!c.body) { flow.delete(c); continue; }
    const p = c.pos, o = c.order;
    if (c.state === 'belt') {
      const t = beltT(c.belt, p);
      if (c.lastT !== undefined && c.lastT > 7 && t <= 7) { o.camera++; o.camF[c.flavor] = (o.camF[c.flavor] || 0) + 1; c.belt.camMesh.material.emissive = new THREE.Color(0x1177aa); c.belt.flash = 0.15; }
      c.lastT = t;
    }
    if (c.state === 'hop' && c.body.isSleeping()) {   // rete di sicurezza: capsula ferma sul cono, la spingo verso la vasca
      const dx = HUB.x - p.x, dz = HUB.z - p.z, d = Math.hypot(dx, dz) || 1;
      c.body.wakeUp(); c.body.applyImpulse({ x: dx / d * 0.05, y: 0.01, z: dz / d * 0.05 }, true);
    }
    if (Math.hypot(p.x - HUB.x, p.z - HUB.z) < BOWL_R - 0.1 && p.y < 1.45) {
      c.state = 'bowl'; flow.delete(c); o.bowl.push(c); o.arrived++; o.lastArrival = S.time; continue;
    }
    if (p.y < 0.85 || Math.abs(p.x) > 200 || Math.abs(p.z) > 200) lostCap(c);
  }
}
export function lostCap(c, injected = false) {
  const o = c.order, f = c.flavor;
  if (!injected) { const bt = c.belt ? beltT(c.belt, c.pos).toFixed(1) : '-', bl = c.belt ? beltLat(c.belt, c.pos).toFixed(1) : '-'; (window.__lostLog ||= []).push([c.state, c.belt && c.belt.name, bt, bl, c.pos.y.toFixed(2)].join(' ')); }
  flow.delete(c); killCap(c);
  S.lost++;
  o.released--; o.relF[f]--;
  const bin = binByFlavor[f];
  bin.queue.unshift({ order: o, remaining: 1, flavor: f });
  bin.stock++;
  log(`${injected ? 'Errore iniettato' : 'Capsula persa'} (${FLAVORS[f][0]}, ordine #${o.id}): ri-dosaggio`, 'err');
}
export function injectError() {
  const cands = [...flow].filter((c) => c.state === 'belt');
  if (!cands.length) { log('Nessuna capsula sul nastro da scartare', 'err'); return; }
  lostCap(cands[Math.floor(Math.random() * cands.length)], true);
}

// ============================================================ tavola / scrambler
const upright = new THREE.Quaternion();
function tryIndex() {
  if (table.moving) return;
  const nSlot = slotAt(0), sSlot = slotAt(2);
  const ord = S.orders.filter((o) => o.status === 'dosing' || o.status === 'collecting').filter((o) => o.arrived >= BOX_SIZE).sort((a, b) => a.id - b.id)[0];
  for (const o of S.orders) if (o.status === 'dosing' && o.arrived >= BOX_SIZE) o.status = 'collecting';
  if (!ord) { S.idxWait = 'attesa lotto da 36'; return; }
  if (S.time - ord.lastArrival < 0.8) { S.idxWait = 'assestamento lotto'; return; }
  if (nSlot.state !== 'empty') { S.idxWait = 'slot di riempimento non vuoto'; return; }
  if (sSlot.state !== 'empty') { S.idxWait = `scrambler in uscita non pronto (${Math.max(0, P.scrambleTime - sSlot.timer).toFixed(0)} s)`; return; }
  // virtualizza le 36 capsule del lotto nello slot e fai ruotare la tavola
  const tc = stationPos(nSlot.id * Math.PI / 2 + table.theta);
  const items = ord.bowl.splice(0, BOX_SIZE);
  for (const c of items) {
    const off = c.pos.clone().sub(tc).applyAxisAngle(Yax, table.theta);
    off.y = 0; if (off.length() > 1.45) off.setLength(1.45);
    c.off = off; c.q0 = c.quat.clone(); c.state = 'virt'; dropBody(c);
  }
  items.sort((a, b) => a.flavor - b.flavor);
  Object.assign(nSlot, { state: 'scramble', timer: 0, items, order: ord, emitted: 0, emitT: 0 });
  ord.status = 'scrambling'; ord.tIdx = S.time;
  table.step++; table.target = table.step * Math.PI / 2;
  S.idxWait = '';
}
function updateSlots(dt) {
  for (const s of table.slots) {
    const st = stationOf(s.id), tubV = table.tubs[s.id];
    if (s.state === 'scramble') {
      s.timer += dt;
      if (s.timer >= P.scrambleTime) { s.state = 'ready'; }
    }
    if (s.state === 'ready' && st === 2 && !table.moving) { s.state = 'discharging'; s.order.status = 'discharging'; }
    if (s.state === 'discharging') {
      s.emitT += dt;
      while (s.emitT >= 0.1 && s.items.length && laneCanAccept()) {
        s.emitT -= 0.1;
        const c = s.items.shift(); c.order = s.order; laneEmit(c, s.emitted++);
      }
      if (!s.items.length) { s.state = 'empty'; s.order.status = 'boxing'; }
    }
    tubV.led.material.color.setHex({ empty: 0x555a63, scramble: 0xffc400, ready: 0x35ff7a, discharging: 0x35b6ff }[s.state]);
    if (s.state === 'scramble' || s.state === 'ready' && false) tubV.star.rotation.y += dt * 7;
    // capsule virtuali nel tubo
    if (s.items.length && s.state !== 'discharging' || s.state === 'discharging') {
      const p = s.state === 'scramble' ? s.timer / P.scrambleTime : 1;
      const tc = stationPos(s.id * Math.PI / 2 + table.theta), qt = yawQ(-table.theta);
      s.items.forEach((c, k) => {
        const jit = (1 - p) * 0.09 * (s.state === 'scramble' ? 1 : 0);
        const a = S.time * 18 + k * 1.7;
        c.pos.set(c.off.x + Math.sin(a) * jit, BOWL_FLOOR + 0.06 + CAP.h / 2, c.off.z + Math.cos(a * 1.3) * jit);
        c.pos.applyAxisAngle(Yax, -table.theta).add(tc);
        c.quat.copy(c.q0).slerp(upright, smooth(clamp(p * 1.15, 0, 1))).premultiply(qt);
        writeMatrix(c);
      });
    }
  }
}

// ============================================================ delta
export function setDeltas(n) {
  while (deltas.length > n) { const d = deltas.pop(); d.group.visible = false; if (d.job) { d.job.c.reserved = false; d.job.box.reserved--; d.job = null; } }
  while (deltas.length < n) {
    const i = deltas.length;
    const base = V3(HEAD_X - 1.8 + i * 4.5, DELTA.Y, LANE_Z + 2 + (i ? 0.3 : 0));
    deltas.push(new Delta(base, 'Delta ' + (i + 1)));
  }
  deltas.forEach((d) => { d.group.visible = true; });
}
const FR = [0.27, 0.10, 0.10, 0.28, 0.10, 0.15];
function tipAbove(pos, dy) { return V3(pos.x, pos.y + CAP.h / 2 + 0.74 + dy, pos.z); }
function stepDelta(d, dt) {
  d.life += dt;
  const T = P.pickTime;
  if (d.phase === 'idle') {
    const box = stationBox();
    if (!box || box.state !== 'filling' || box.reserved >= BOX_SIZE) { d.hold = true; return; }
    for (let i = 0; i < Math.min(4, lane.items.length); i++) {
      const c = lane.items[i];
      if (!c.reserved && c.settled && (box.order == null || c.order === box.order)) {
        c.reserved = true; box.order = c.order; box.reserved++;
        d.job = { c, box }; d.phase = 0; d.setTarget(tipAbove(c.pos, 1.6), FR[0] * T);
        break;
      }
    }
    if (d.phase === 'idle') return;
  }
  d.busy += dt;
  const { c, box } = d.job;
  d.t += dt;
  const ph = d.phase;
  // bersaglio vivo (la capsula può ancora scorrere)
  if (ph === 0) d.to = tipAbove(c.pos, 1.6);
  if (ph === 1) d.to = tipAbove(c.pos, 0);
  const k = smooth(clamp(d.t / d.dur, 0, 1));
  d.P.lerpVectors(d.from, d.to, k);
  if (ph >= 2 && ph <= 4 && d.job.held) { c.pos.set(d.P.x, d.P.y - 0.74 - CAP.h / 2, d.P.z); writeMatrix(c); }
  d.solve(d.P);
  if (d.t >= d.dur) {
    d.t = 0;
    if (ph === 0) { d.phase = 1; d.setTarget(tipAbove(c.pos, 0), FR[1] * T); }
    else if (ph === 1) { // aspirazione
      const idx = lane.items.indexOf(c); if (idx >= 0) lane.items.splice(idx, 1);
      c.state = 'held'; d.job.held = true; d.phase = 2; d.setTarget(tipAbove(c.pos, 1.6), FR[2] * T);
    } else if (ph === 2) {
      const cp = box.g.position.clone().add(cellLocal(c.cell));
      d.phase = 3; d.setTarget(tipAbove(cp, 1.6), FR[3] * T);
    } else if (ph === 3) {
      const cp = box.g.position.clone().add(cellLocal(c.cell));
      d.phase = 4; d.setTarget(tipAbove(cp, 0.02), FR[4] * T);
    } else if (ph === 4) {
      boxPlace(box, c); d.picks++; d.job.held = false;
      if (box.placed >= BOX_SIZE) box.state = 'done';
      d.phase = 5; d.setTarget(tipAbove(box.g.position.clone().add(cellLocal(c.cell)), 1.6), FR[5] * T);
    } else { d.phase = 'idle'; d.job = null; }
  }
}
function updateLine(dt) {
  let left = dt;
  while (left > 1e-6) {
    const d = Math.min(0.02, left); left -= d;
    updateLane(d);
    for (const dl of deltas) stepDelta(dl, d);
    const box = boxLine.boxes.find((b) => b.slotIdx === 0);
    if (box && box.state === 'done' && !boxLine.moving && deltas.every((x) => x.phase === 'idle')) {
      const o = box.order;
      if (o && o.status !== 'done') {
        o.status = 'done'; o.tDone = S.time; S.boxesDone++;
        S.boxTimes.push(S.time); if (S.boxTimes.length > 12) S.boxTimes.shift();
        log(`Scatola #${o.id} completata (${(S.time - o.t0).toFixed(0)} s dall'ordine)`, 'ok');
      }
      box.state = 'out'; boxLineAdvance();
    }
    updateBoxLine(d, () => {
      const nb = boxLine.boxes.find((b) => b.slotIdx === 0);
      if (nb) { nb.state = 'filling'; nb.order = null; nb.placed = 0; nb.reserved = 0; }
    });
  }
}

// ============================================================ ciclo di simulazione
const _stepPre = (h) => {
  for (const b of bins) stepBin(b, h);
  stepFlow(h);
};
export function frame(realDt) {
  if (P.paused) { syncCaps(); touchInstances(); return; }
  acc += Math.min(realDt, 0.05) * P.speed;
  let n = 0;
  const t0 = performance.now();
  while (acc >= H && n < 40 && performance.now() - t0 < 14) { _stepPre(H); world.step(); acc -= H; n++; }
  if (acc >= H) acc = 0;           // budget esaurito: la simulazione rallenta invece di bloccare il browser
  S.rtf += ((n * H) / Math.max(realDt, 1e-3) - S.rtf) * 0.1;
  const dt = n * H;
  S.physSteps = n;
  S.time += dt;
  S.awake = syncCaps();
  if (dt > 0) {
    dispatch();
    for (const b of bins) updateBin(b, dt);
    updateFlow();
    tryIndex();
    updateTable(dt, P.indexTime);
    updateSlots(dt);
    updateLine(dt);
  }
  // visuale
  for (const b of belts) {
    b.tex.offset.x += (P.beltSpeed / 3) * dt;
    if (b.flash > 0) { b.flash -= dt; if (b.flash <= 0) b.camMesh.material.emissive = new THREE.Color(0x000000); }
  }
  for (const a of agvs.values()) a.update(dt);
  // statistiche
  const busy = deltas.reduce((a, d) => a + (d.phase !== 'idle' ? 1 : 0), 0) / Math.max(1, deltas.length);
  S.util += (busy - S.util) * Math.min(1, dt / 8);
  if (S.boxTimes.length >= 2) { const iv = (S.boxTimes[S.boxTimes.length - 1] - S.boxTimes[0]) / (S.boxTimes.length - 1); S.rate = 3600 / iv; }
  S.orders = S.orders.filter((o) => o.status !== 'done' || S.time - o.tDone < 25);
  touchInstances();
}

// ============================================================ init
export function initSim() {
  bins.forEach((b) => {
    binByFlavor[b.flavor] = b;
    b.sg = b.sg ?? 0;
  });
  // percorsi AGV
  for (const b of bins) {
    const stop = b.local(-C.BIN_D - 3.2, 0, 0); stop.y = C.DECK_Y;
    const extra = b === bins[bins.length - 1];
    b.extra = extra;
    if (extra) {
      const depot = stop.clone().addScaledVector(b.f, -9).addScaledVector(b.side, 4);
      b.route = [depot, stop];
    } else {
      const bt = beltT(b.belt, b.hinge), lat = Math.sign(beltLat(b.belt, b.hinge));
      b.sg = lat;
      const corr = beltPt(b.belt, bt, lat * 12.6, C.DECK_Y);
      const depot = beltPt(b.belt, C.BELT_LEN + 8, lat * 12.6, C.DECK_Y);
      b.route = [depot, corr, stop];
    }
  }
  bins.forEach((b) => b.fill(24));
  setDeltas(P.deltas);
}
export function presettle(steps = 2) {
  for (let i = 0; i < steps; i++) world.step();
  syncCaps(); touchInstances();
}
export function emptyBin(bin) { bin.stock = Math.min(bin.stock, 2); }
