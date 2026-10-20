import { THREE, RAPIER, world, V3, yawQ, rand, clamp, smooth, spawnCap, killCap, dropBody, makeBody, syncCaps, writeMatrix, touchInstances, allCaps, physCaps, capMesh, flavorColors } from './core.js';
import * as C from './config.js';
import { FLAVORS, CAP, NF, BOX_SIZE } from './config.js';
import { belts, bins, beltT, beltLat, beltPt, HUB, GATE_LIFT } from './plant.js';
import { table, stationPos, stationOf, slotAt, updateTable, BOWL_R, BOWL_FLOOR, ringXZ, RING_ITEM_Y } from './table.js';
import { lane, laneEmit, laneCanAccept, updateLane, boxLine, stationBox, boxPlace, boxLineAdvance, updateBoxLine, Delta, DELTA, AGV, LANE_ITEM_Y, HEAD_X, LANE_Y, BOX_Z, LANE_Z, STATION_X, cellLocal } from './line.js';
import { R } from './table.js';

export const P = { ...C.defaults, paused: true, maxActive: 2, lowWater: 0.15 };   // l'impianto parte fermo: lo avvia l'utente
export const S = {
  gatesOpen: true, time: 0, orders: [], nextId: 1, boxesDone: 0, boxTimes: [], lost: 0, log: [], awake: 0, util: 0, idxWait: '',
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
// disposizione di default nella scatola: gusti in ordine, 6 per riga
export const layoutFromCounts = (counts) => Object.entries(counts).sort((a, b) => a[0] - b[0]).flatMap(([f, n]) => Array(n).fill(+f));
export const countsFromLayout = (layout) => layout.reduce((c, f) => { if (f >= 0) c[f] = (c[f] || 0) + 1; return c; }, {});
export function addOrder(counts, manual = false, layout = null) {
  const o = { id: S.nextId++, counts, layout: layout || layoutFromCounts(counts), status: 'queued', released: 0, relF: {}, camF: {}, camera: 0, arrived: 0, bowl: [], lastArrival: 0, t0: S.time, manual };
  S.orders.push(o);
  log(`Ordine #${o.id}: ` + Object.entries(counts).map(([f, n]) => `${n}× ${FLAVORS[f][0]}`).join(', '), 'ord');
  return o;
}
// cella della scatola (0..35) in cui va la prossima capsula di quel gusto, secondo la disposizione scelta dall'utente
function takeCell(order, flavor) {
  if (!order.pool) { order.pool = {}; order.layout.forEach((f, k) => { (order.pool[f] ||= []).push(k); }); }
  return order.pool[flavor].shift();
}
const activeCount = () => S.orders.filter((o) => o.status === 'dosing' || o.status === 'collecting').length;
function dispatch() {
  if (P.autoOrders && S.orders.filter((o) => o.status === 'queued').length < 2) addOrder(genOrder());
  const next = S.orders.find((o) => o.status === 'queued');
  // un ordine alla volta nella vasca: il successivo parte solo quando il precedente è arrivato tutto (niente cialde "orfane")
  if (next && activeCount() < P.maxActive && !S.orders.some((o) => o.status === 'dosing' && o.arrived < BOX_SIZE)) {
    for (const [f, n] of Object.entries(next.counts)) binByFlavor[f].queue.push({ order: next, remaining: n, flavor: +f });
    next.status = 'dosing'; next.tDose = S.time;
  }
}

// ============================================================ cassoni: inclinazione, vite, cattura
const vs = () => P.screwRate * C.SCREW.pitch;
const NO_COLLISION = 0x00020000;   // gruppo 2 senza filtro: la capsula trasportata dalla vite non urta le altre
const AGV_LAT = 12.6;              // corsia AGV: distanza dall'asse nastro
const SCREW_X = C.TROUGH_W / 2 + 0.03;
const carriedPos = (bin, z) => { const p = bin.local(SCREW_X, 0, z); p.y = C.TROUGH_Y + CAP.h / 2 + 0.01; return p; };

// inclinazione richiesta dalla scorta: sempre un po' inclinato, sempre più ribaltato man mano che si svuota
const tiltFor = (bin) => C.TILT_MIN + (C.TILT_MAX - C.TILT_MIN) * (1 - clamp(bin.stock / S.stockInit, 0, 1));

function stepBin(bin, h) {
  if (Math.abs(bin.tilt - bin.tiltTarget) > 1e-6) {
    bin.tilt += clamp(bin.tiltTarget - bin.tilt, -C.TILT_RATE * h, C.TILT_RATE * h);
    bin.body.setNextKinematicRotation(bin.q);
  }
  // movimento delle capsule catturate dalla vite
  if (bin.moving.length) {
    const v = vs();
    for (let i = bin.moving.length - 1; i >= 0; i--) {
      const c = bin.moving[i];
      c.u += v * h;
      c.body.setNextKinematicTranslation(carriedPos(bin, c.u));
      if (c.u >= C.Z_OUT) {
        c.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        c.col.setCollisionGroups(0xffffffff);
        c.body.setLinvel({ x: bin.side.x * v * 1.3, y: 0, z: bin.side.z * v * 1.3 }, true);
        c.state = 'fall'; c.belt = bin.belt; c.lastT = undefined; flow.add(c);
        bin.moving.splice(i, 1);
      }
    }
  }
}
// la vite preleva la capsula più avanzata nel canale (così le distanze lungo la vite restano >= un passo)
function capture(bin) {
  const head = bin.queue[0]; let best = null, bz = -1e9;
  for (const c of bin.caps) {
    if (c.state !== 'bin' || !c.body) continue;
    const x = bin.xOf(c.pos), z = bin.zOf(c.pos), dy = c.pos.y - C.TROUGH_Y;
    if (x > 0.02 && x < C.TROUGH_W && dy > 0.02 && dy < 0.75 && z > C.TROUGH_Z0 && z < C.Z_OUT - 0.6 && z > bz
      && bin.moving.every((m) => Math.abs(m.u - z) > 0.45)) { best = c; bz = z; }
  }
  if (!best) return false;
  const c = best;
  c.state = 'screw'; c.order = head.order; c.u = Math.max(bz, C.TROUGH_Z0 + 0.1);
  c.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  c.col.setCollisionGroups(NO_COLLISION);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true); c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const p = carriedPos(bin, c.u);
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
  bin.tiltTarget = tiltFor(bin);
  const settling = Math.abs(bin.tilt - bin.tiltTarget) > 1e-4;
  if (active || settling) {
    if (!bin.live) { for (const c of bin.caps) if (!c.body) makeBody(c); bin.live = true; }
    bin.idle = 0;
  } else {
    bin.idle += dt;
    // a cassone fermo e a riposo le capsule tornano "statiche" (niente costo fisico)
    if (bin.live && bin.idle > 4 && [...bin.caps].every((c) => !c.body || c.body.isSleeping())) {
      for (const c of bin.caps) dropBody(c);
      bin.live = false;
    }
  }
  bin.screwSpeed += ((active ? 1 : 0) - bin.screwSpeed) * Math.min(1, dt * 4);
  bin.screwAng += bin.screwSpeed * P.screwRate * Math.PI * 2 * dt;
  bin.screwHolder.children[0].rotation.x = bin.screwAng;
  if (active) {
    if (bin.screwSpeed > 0.8) {
      bin.slotTimer += dt;
      if (bin.slotTimer >= 1 / P.screwRate) { bin.slotTimer = capture(bin) ? 0 : 1 / P.screwRate; }
    }
    // ricarica fisica graduale dal "serbatoio" virtuale, dal lato alto del cassone
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
  // scorta bassa: avviso (e AGV automatico se abilitato)
  const low = bin.stock <= Math.max(5, S.stockInit * P.lowWater);
  if (low && !bin.lowWarned && bin.online) { bin.lowWarned = true; log(`Cassone "${FLAVORS[bin.flavor][0]}" quasi vuoto (${bin.stock}): serve un AGV`, 'err'); }
  if (!low) bin.lowWarned = false;
  if (P.autoAgv && low && bin.online && !bin.swapping && !bin.agvRequested) requestAgv(bin, false);
  if (bin.agvRequested && !bin.swapping) startSwap(bin);
}
export const agvOf = (bin) => { const a = agvs.get(bin.belt.name + (bin.extra ? 'X' : bin.sg)); return a && a.bin === bin ? a : null; };
export const agvStatus = (bin) => { const a = agvs.get(bin.belt.name + (bin.extra ? 'X' : bin.sg)); return a && a.bin === bin ? a.state : 'idle'; };
export function updateBinGlow(b) {
  b.colorMat.emissiveIntensity = 0.15 + b.flash * 1.0 + (b.selected ? 0.55 : 0);
}

// ============================================================ AGV: arriva dal magazzino esterno con un cassone di scorta e lo scambia
function agvFor(bin) {
  const key = bin.belt.name + (bin.extra ? 'X' : bin.sg);
  if (!agvs.has(key)) { const a = new AGV(key); a.state = 'idle'; a.group.visible = false; agvs.set(key, a); }
  return agvs.get(key);
}
export function requestAgv(bin, manual = true) {
  if (bin.swapping || bin.agvRequested) return false;
  bin.agvRequested = true;
  log(`AGV ${manual ? 'chiamato' : 'richiesto'} per il cassone "${FLAVORS[bin.flavor][0]}"`, 'agv');
  return true;
}
function startSwap(bin) {
  const agv = agvFor(bin);
  if (agv.state !== 'idle') return;      // il corridoio ha un solo AGV: attende
  bin.swapping = true; bin.agvRequested = false; agv.state = 'going'; agv.bin = bin;
  agv.lift.position.y = 0.75;
  agv.setPayload('new', flavorColors[bin.flavor]);
  log(`AGV ${agv.name}: parte dal magazzino con un cassone nuovo "${FLAVORS[bin.flavor][0]}"`, 'agv');
  const route = bin.route;
  agv.follow(route.map((p) => p.clone()), () => {
    agv.state = 'swapping'; bin.online = false; agv.swapped = false;
    agv.animate(2.6, (p) => {
      const up = p < 0.3 ? smooth(p / 0.3) : p > 0.7 ? smooth((1 - p) / 0.3) : 1;
      agv.lift.position.y = 0.75 + up * 0.9;
      if (p >= 0.5 && !agv.swapped) {          // scambio: il cassone vecchio sale sull'AGV, quello nuovo è in linea
        agv.swapped = true;
        bin.clearCaps(killCap);
        bin.stock = S.stockInit; bin.fill(30); bin.live = false; bin.flash = 1;
        agv.setPayload('old');
        log(`Cassone "${FLAVORS[bin.flavor][0]}" sostituito (${S.stockInit} capsule)`, 'agv');
      }
    }, () => {
      bin.online = true; bin.swapping = false; bin.lowWarned = false;
      agv.state = 'returning';
      agv.follow([...route].reverse().map((p) => p.clone()), () => { agv.state = 'idle'; agv.group.visible = false; agv.setPayload(null); });
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

// ============================================================ tavola / scrambler / buffer ad anello
// Ogni slot ha uno scrambler (60 s) e un buffer ad anello esterno. Finito lo scrambler, le 36 capsule dritte passano nel
// buffer; il buffer viaggia con la tavola fino all'uscita, dove in ~5 s (rotazione + scarico) le capsule vanno in fila sulla corsia.
const upright = new THREE.Quaternion();
const XFER_FLIGHT = 0.5;
const indexTime = () => P.tableTime * 0.28;                 // rotazione 90°
const dischargeInterval = () => P.tableTime * 0.72 / BOX_SIZE; // scarico dei 36 elementi
function readyOrder() {
  for (const o of S.orders) if (o.status === 'dosing' && o.arrived >= BOX_SIZE) o.status = 'collecting';
  return S.orders.filter((o) => o.status === 'collecting').sort((a, b) => a.id - b.id)[0];
}
function fillSlot(nSlot, ord) {
  // virtualizza le 36 capsule del lotto nello scrambler
  const tc = stationPos(nSlot.id * Math.PI / 2 + table.theta);
  const items = ord.bowl.splice(0, BOX_SIZE);
  for (const c of items) {
    const off = c.pos.clone().sub(tc).applyAxisAngle(Yax, table.theta);
    off.y = 0; if (off.length() > 1.45) off.setLength(1.45);
    c.off = off; c.q0 = c.quat.clone(); c.state = 'virt'; dropBody(c);
  }
  items.sort((a, b) => a.flavor - b.flavor);
  Object.assign(nSlot, { state: 'scramble', timer: 0, items, order: ord, total: items.length, relT: 0 });
  ord.status = 'scrambling'; ord.tIdx = S.time;
}
const rotateTable = () => { table.step++; table.target = table.step * Math.PI / 2; };
function tableControl() {
  if (table.moving) return;
  const nSlot = slotAt(0), sSlot = slotAt(2);
  // il buffer in uscita ha la precedenza: lo scarico non si interrompe
  if (sSlot.rstate === 'full' || sSlot.rstate === 'discharging') { S.idxWait = 'scarico buffer in corsia'; return; }
  const ord = readyOrder();
  if (ord && nSlot.state === 'empty') {
    if (S.time - ord.lastArrival < 0.8) { S.idxWait = 'assestamento lotto'; return; }
    fillSlot(nSlot, ord); S.idxWait = ''; return;
  }
  // con uno scrambler libero sotto l'hopper e un lotto in arrivo (cialde in volo o già in vasca) la tavola non si muove:
  // altrimenti le cialde resterebbero sospese sopra uno scrambler diverso
  if (nSlot.state === 'empty' && S.orders.some((o) => o.bowl.length || (o.status === 'dosing' && o.released > 0))) { S.idxWait = 'attesa lotto da 36'; return; }
  // appena uno scrambler parte, la tavola ruota subito se ce n'è un altro libero (così i cancelletti si riaprono);
  // ruota anche per portare all'uscita un buffer pieno
  const fullAway = table.slots.some((s) => s.rstate === 'full');
  const freeElsewhere = nSlot.state !== 'empty' && table.slots.some((s) => s.state === 'empty');
  if (fullAway || freeElsewhere) { rotateTable(); S.idxWait = ''; return; }
  S.idxWait = nSlot.state !== 'empty' ? 'attesa scrambler libero' : 'attesa lotto da 36';
}
// cancelletti: aperti solo se sotto l'hopper c'è uno scrambler libero, la tavola è ferma e nessun lotto completo aspetta
function updateGates(dt) {
  const nSlot = slotAt(0);
  const complete = S.orders.some((o) => (o.status === 'dosing' || o.status === 'collecting') && o.arrived >= BOX_SIZE);
  S.gatesOpen = nSlot.state === 'empty' && !table.moving && !complete;
  for (const b of belts) {
    const g = b.gate;
    g.target = S.gatesOpen ? 1 : 0;
    g.k += clamp(g.target - g.k, -dt / 0.5, dt / 0.5);
    const y = g.yClosed + smooth(g.k) * GATE_LIFT;
    g.body.setNextKinematicTranslation({ x: g.base.x, y, z: g.base.z });
    g.group.position.y = y;
    g.lamp.material.color.setHex(g.k > 0.5 ? 0x35ff7a : 0xff5470);
  }
}
// una capsula alla volta lascia lo scrambler (già dritta) e va nel buffer ad anello, distribuite sul tempo di processo
function releaseOne(s) {
  const c = s.items.shift();
  if (s.rstate === 'empty') { s.rstate = 'loading'; s.rorder = s.order; s.rorder.status = 'buffering'; s.feed = 0; }
  c.xf0x = c.off.x; c.xf0z = c.off.z; c.xf0y = BOWL_FLOOR + 0.06 + CAP.h / 2; c.fly = 0;
  s.ritems.push(c);
  if (!s.items.length) { s.state = 'empty'; s.order = null; }
}
function updateSlots(dt) {
  const iv = dischargeInterval();
  for (const s of table.slots) {
    const st = stationOf(s.id), tubV = table.tubs[s.id];
    if (s.state === 'scramble') { s.timer += dt; if (s.timer >= P.scrambleTime) s.state = 'done'; }
    if (s.items.length && (s.state === 'scramble' || s.state === 'done')) {
      const due = s.state === 'done' ? s.total : Math.floor(s.timer / P.scrambleTime * s.total);
      s.relT += dt;
      while (s.items.length && s.ritems.length < due && s.relT >= 0.04
        && (s.rstate === 'empty' || (s.rstate === 'loading' && s.rorder === s.order))) { releaseOne(s); s.relT = 0; }
    }
    if (s.rstate === 'loading' && !s.items.length && s.ritems.every((c) => c.fly >= 1)) { s.rstate = 'full'; s.rorder.status = 'buffered'; }
    if (s.rstate === 'full' && st === 2 && !table.moving) { s.rstate = 'discharging'; s.rorder.status = 'discharging'; s.emitted = 0; s.emitT = 0; s.feed = 0; }
    if (s.rstate === 'discharging') {
      s.emitT += dt;
      while (s.emitT >= iv && s.ritems.length && laneCanAccept()) {
        s.emitT -= iv;
        const c = s.ritems.shift(); c.order = s.rorder; laneEmit(c, takeCell(s.rorder, c.flavor)); s.feed = 1;
      }
      if (s.emitT > iv) s.emitT = iv;                            // lane piena: non accumulare scarico arretrato
      if (!s.ritems.length) { s.rstate = 'empty'; s.rorder.status = 'boxing'; }
    }
    s.feed = Math.max(0, s.feed - dt / iv);
    tubV.led.material.color.setHex({ empty: 0x555a63, scramble: 0xffc400, done: 0x35ff7a }[s.state]);
    tubV.rled.material.color.setHex({ empty: 0x555a63, loading: 0xff8a1c, full: 0x35ff7a, discharging: 0x35b6ff }[s.rstate]);
    if (s.state === 'scramble') tubV.star.rotation.y += dt * 7;
    const tc = stationPos(s.id * Math.PI / 2 + table.theta), qt = yawQ(-table.theta);
    // capsule nello scrambler
    if (s.items.length) {
      const p = s.state === 'scramble' ? s.timer / P.scrambleTime : 1;
      s.items.forEach((c, k) => {
        const jit = (1 - p) * 0.09 * (s.state === 'scramble' ? 1 : 0);
        const a = S.time * 18 + k * 1.7;
        c.pos.set(c.off.x + Math.sin(a) * jit, BOWL_FLOOR + 0.06 + CAP.h / 2, c.off.z + Math.cos(a * 1.3) * jit);
        c.pos.applyAxisAngle(Yax, -table.theta).add(tc);
        c.quat.copy(c.q0).slerp(upright, smooth(clamp(p * 1.15, 0, 1))).premultiply(qt);
        writeMatrix(c);
      });
    }
    // capsule nel buffer ad anello (dritte e in fila); in caricamento volano sopra la parete dello scrambler
    if (s.ritems.length) {
      s.ritems.forEach((c, k) => {
        const [rx, rz] = ringXZ(s.id, k + s.feed);
        let x = rx, z = rz, y = RING_ITEM_Y;
        let e = 1;
        if (c.fly < 1) {
          c.fly = Math.min(1, c.fly + dt / XFER_FLIGHT); e = c.fly; const k2 = smooth(e);
          x = c.xf0x + (rx - c.xf0x) * k2; z = c.xf0z + (rz - c.xf0z) * k2;
          y = c.xf0y + (RING_ITEM_Y - c.xf0y) * k2 + Math.sin(Math.PI * e) * 0.75;
        }
        c.pos.set(x, y, z).applyAxisAngle(Yax, -table.theta).add(tc);
        if (e < 1) c.quat.copy(c.q0).slerp(upright, smooth(e)).premultiply(qt); else c.quat.copy(qt);
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
  const T = P.boxTime / BOX_SIZE;
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
    const over = d.t - d.dur; d.t = 0;
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
    if (d.phase !== 'idle') d.t = Math.min(over, d.dur * 0.98);   // il tempo avanzato non si perde: 36 pick = boxTime
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
  while (acc >= H && n < 40 && performance.now() - t0 < 9) { _stepPre(H); world.step(); acc -= H; n++; }
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
    tableControl();
    updateGates(dt);
    updateTable(dt, indexTime());
    updateSlots(dt);
    updateLine(dt);
  }
  // visuale
  for (const b of belts) {
    b.tex.offset.x += (P.beltSpeed / 3) * dt;
    if (b.flash > 0) { b.flash -= dt; if (b.flash <= 0) b.camMesh.material.emissive = new THREE.Color(0x000000); }
  }
  for (const a of agvs.values()) a.update(dt);
  for (const b of bins) { if (b.flash > 0) b.flash = Math.max(0, b.flash - dt / 1.2); updateBinGlow(b); }
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
  // percorsi AGV: porta del magazzino esterno -> corsia -> piazzola dietro il cassone (lato corridoio)
  for (const b of bins) {
    const stop = b.local(-C.BIN_D / 2, 0, -(C.BIN_W / 2 + 3.4)); stop.y = C.DECK_Y;
    if (b.extra) {
      b.route = [beltPt(b.belt, b.belt.tDoor, beltLat(b.belt, stop), C.DECK_Y), stop];
    } else {
      const lat = Math.sign(beltLat(b.belt, b.hinge));
      b.sg = lat;
      const bt = beltT(b.belt, stop);
      b.route = [beltPt(b.belt, b.belt.tDoor, lat * AGV_LAT, C.DECK_Y), beltPt(b.belt, bt, lat * AGV_LAT, C.DECK_Y), stop];
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
