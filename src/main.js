import { THREE, initPhysics, initScene, scene, camera, controls, renderer, capMesh, allCaps, V3 } from './core.js';
import * as C from './config.js';
import { FLAVORS, NF } from './config.js';
import { buildHall, buildBelts, buildBins, bins, labels, HUB } from './plant.js';
import { buildTable, table, stationOf } from './table.js';
import { buildLane, buildBoxLine, HEAD_X, lane, BOX_Z, LANE_Z } from './line.js';
import { R } from './table.js';
import { P, S, deltas, initSim, presettle, frame, addOrder, genOrder, setDeltas, injectError, emptyBin } from './sim.js';

const NORENDER = new URLSearchParams(location.search).has('norender');
const $ = (id) => document.getElementById(id);
const hex = (i) => '#' + new THREE.Color(FLAVORS[i][1]).getHexString();

async function boot() {
  await initPhysics();
  initScene($('app'));
  scene.add(capMesh);
  if (new URLSearchParams(location.search).has('speed')) P.speed = +new URLSearchParams(location.search).get('speed');
  buildHall(); buildBelts(); buildBins(); buildTable(); buildLane(); buildBoxLine();
  initSim();
  presettle(4);
  $('loading').remove();
  buildUI();
  const q = new URLSearchParams(location.search);
  if (q.get('hud') === '0') for (const id of ['left', 'right', 'bottom']) $(id).style.display = 'none';
  if (q.get('cam')) { const v = q.get('cam').split(',').map(Number); camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); controls.update(); }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- camera
const views = {
  1: ['Isometrica', () => [V3(78, 58, 34), V3(0, 0, -24)]],
  2: ['Zenitale', () => [V3(0, 205, -22), V3(0, 0, -23)]],
  3: ['Cassone + vite', () => { const b = bins[3]; return [b.hinge.clone().addScaledVector(b.side, 7.5).add(V3(0, 4.5, 0)).addScaledVector(b.f, -2), b.hinge.clone().addScaledVector(b.f, -1.8).add(V3(0, 0.8, 0))]; }],
  4: ['Tavola', () => [V3(15, 13, 12), V3(0, 1, 0)]],
  5: ['Delta + scatole', () => [V3(HEAD_X - 13, 15, LANE_Z + 20), V3(HEAD_X + 1, 3, LANE_Z + 2)]],
  6: ['Hopper', () => [V3(9, 8.5, HUB.z + 9), V3(HUB.x, 1, HUB.z)]],
};
let tween = null;
function goView(k) {
  const [pos, tgt] = views[k][1]();
  if (k === 2) pos.z += 0.01;
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt };
  [...$('bottom').querySelectorAll('button[data-v]')].forEach((b) => b.classList.toggle('on', b.dataset.v == k));
}
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (views[k]) goView(k);
  else if (k === 'l') labels.visible = !labels.visible;
  else if (k === 'h') for (const id of ['left', 'right', 'bottom']) { const e = $(id); e.style.display = e.style.display === 'none' ? '' : 'none'; }
  else keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------- UI
let selBin = null;
function buildUI() {
  const bot = $('bottom');
  for (const k of Object.keys(views)) {
    const b = document.createElement('button'); b.textContent = `${k} · ${views[k][0]}`; b.dataset.v = k; b.onclick = () => goView(k); bot.appendChild(b);
  }
  const speeds = [0.25, 0.5, 1, 2, 4, 8];
  speeds.forEach((s) => {
    const b = document.createElement('button'); b.textContent = '×' + s; b.dataset.s = s; if (s === P.speed) b.classList.add('on');
    b.onclick = () => { P.speed = s; [...$('speedSeg').children].forEach((x) => x.classList.toggle('on', x === b)); };
    $('speedSeg').appendChild(b);
  });
  $('pause').onclick = () => { P.paused = !P.paused; $('pause').textContent = P.paused ? '▶ Riprendi' : '⏸ Pausa'; $('pause').classList.toggle('on', P.paused); };
  $('auto').onclick = () => { P.autoOrders = !P.autoOrders; $('auto').classList.toggle('on', P.autoOrders); };
  $('rot').onclick = () => { controls.autoRotate = !controls.autoRotate; $('rot').classList.toggle('on', controls.autoRotate); };
  const bind = (id, key, fmt = (v) => v, cb) => {
    const el = $('p' + id), out = $('o' + id);
    el.value = P[key]; out.textContent = fmt(+el.value);
    el.oninput = () => { P[key] = +el.value; out.textContent = fmt(+el.value); cb && cb(+el.value); };
  };
  bind('Belt', 'beltSpeed'); bind('Screw', 'screwRate'); bind('Scr', 'scrambleTime');
  bind('Pick', 'pickTime', (v) => v.toFixed(2));
  bind('Stock', 'binStock', (v) => v, (v) => { S.stockInit = v; bins.forEach((b) => { if (b.online) b.stock = v; }); });
  [...$('dSeg').children].forEach((b) => {
    b.classList.toggle('on', +b.dataset.n === P.deltas);
    b.onclick = () => { P.deltas = +b.dataset.n; setDeltas(P.deltas); [...$('dSeg').children].forEach((x) => x.classList.toggle('on', x === b)); };
  });
  // compositore manuale
  const comp = $('compose');
  const opts = FLAVORS.map(([n], i) => `<option value="${i}">${i + 1}. ${n}</option>`).join('');
  for (let i = 0; i < 4; i++) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<select>${i ? '<option value="-1">—</option>' : ''}${opts}</select><input type="number" min="0" max="36" value="${i ? 0 : 36}">`;
    comp.appendChild(r);
  }
  const sum = () => { const s = [...comp.querySelectorAll('.row')].reduce((a, r) => a + (+r.querySelector('select').value >= 0 ? +r.querySelector('input').value : 0), 0); $('sum').textContent = `${s}/36`; $('sum').style.color = s === 36 ? 'var(--ok)' : 'var(--err)'; return s; };
  comp.oninput = sum; sum();
  $('send').onclick = () => {
    if (sum() !== 36) return;
    const counts = {};
    comp.querySelectorAll('.row').forEach((r) => { const f = +r.querySelector('select').value, n = +r.querySelector('input').value; if (f >= 0 && n > 0) counts[f] = (counts[f] || 0) + n; });
    addOrder(counts, true);
  };
  $('rand').onclick = () => addOrder(genOrder(), true);
  $('inject').onclick = injectError;
  $('emptyBin').onclick = () => { if (selBin) emptyBin(selBin); };

  // selezione cassone
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(bins.map((b) => b.group), true)[0];
    if (!hit) { selBin = null; $('binCard').style.display = 'none'; return; }
    selBin = bins.find((b) => { let o = hit.object; while (o) { if (o === b.group) return true; o = o.parent; } return false; });
  });
}

const stName = ['Riempimento', 'Scrambler', 'Uscita', 'Ritorno'];
function renderHUD() {
  const awakeBelts = S.awake;
  const rate = S.rate ? S.rate.toFixed(0) : '—';
  const dUtil = Math.round(S.util * 100);
  const nb = S.boxesDone;
  $('kpi').innerHTML = [
    [fmtT(S.time), 'tempo simulato'], [nb, 'box completati'],
    [rate, 'box/h (misurati)'], [S.rate ? (S.rate * 36).toFixed(0) : '—', 'capsule/h'],
    [dUtil + '%', 'saturazione delta' + (dUtil > 92 ? ' ⚠' : '')], [lane.items.length + '/36', 'buffer in corsia'],
    [S.lost, 'errori / ri-dosaggi'], [awakeBelts + '/' + allCaps.size, 'capsule attive/totali'], ['×' + S.rtf.toFixed(2), 'velocità effettiva sim'],
  ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('slots').innerHTML = table.slots.map((s) => {
    const st = stationOf(s.id), p = s.state === 'scramble' ? s.timer / P.scrambleTime : s.state === 'empty' ? 0 : 1;
    return `<div class="slot ${s.state}"><b>S${s.id + 1}</b><br>${stName[st]}<br>${s.state}<i><u style="width:${p * 100}%"></u></i></div>`;
  }).join('');
  $('idx').innerHTML = S.idxWait ? `Tavola: <span class="${S.idxWait.startsWith('scrambler') ? 'warn' : ''}">${S.idxWait}</span>` : 'Tavola: in movimento / ciclo regolare';
  $('orders').innerHTML = S.orders.slice(-6).map((o) => {
    const chips = Object.entries(o.counts).map(([f, n]) => `<span class="chip" style="background:${hex(f)}"></span>${n}`).join('  ');
    const pr = Math.min(1, o.released / 36);
    return `<div class="ord"><b>#${o.id}</b> ${chips}<span class="tag">${o.status}</span><div class="bar"><u style="width:${pr * 100}%"></u></div><span class="sub">dosate ${o.released} · camera ${o.camera} · in vasca ${o.arrived}</span></div>`;
  }).join('');
  $('log').innerHTML = S.log.slice(0, 14).map((l) => `<div class="${l.cls}">${fmtT(l.t)} · ${l.msg}</div>`).join('');
  const card = $('binCard');
  if (selBin) {
    const b = selBin;
    card.style.display = 'block';
    card.innerHTML = `<h1><span class="chip" style="background:${hex(b.flavor)}"></span>${FLAVORS[b.flavor][0]} <span class="sub">cassone #${b.id + 1}</span></h1>
      <div class="sub">Scorta: <b style="color:var(--fg)">${b.stock}</b> · fisiche ${b.caps.size} · coda ${b.queued}</div>
      <div class="sub">Inclinazione ${(b.tilt * 24).toFixed(0)}° · ${b.online ? (b.swapping ? 'AGV in arrivo' : 'online') : 'offline (cambio pallet)'}</div>`;
  } else card.style.display = 'none';
}
const fmtT = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };

// ---------------------------------------------------------------- loop
let last = performance.now(), hudT = 0;
const fwd = new THREE.Vector3(), rgt = new THREE.Vector3();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  frame(dt);
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 1.4);
    const k = tween.t * tween.t * (3 - 2 * tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (tween.t >= 1) tween = null;
  }
  if (keys.size) {
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); rgt.crossVectors(fwd, camera.up).normalize();
    const sp = 40 * dt * (keys.has('shift') ? 3 : 1), mv = V3();
    if (keys.has('w')) mv.addScaledVector(fwd, sp); if (keys.has('s')) mv.addScaledVector(fwd, -sp);
    if (keys.has('d')) mv.addScaledVector(rgt, sp); if (keys.has('a')) mv.addScaledVector(rgt, -sp);
    if (keys.has('e')) mv.y += sp; if (keys.has('q')) mv.y -= sp;
    camera.position.add(mv); controls.target.add(mv); tween = null;
  }
  controls.update();
  if (!NORENDER) renderer.render(scene, camera);
  hudT += dt; if (hudT > 0.25) { hudT = 0; renderHUD(); }
  requestAnimationFrame(loop);
}

boot().catch((e) => { console.error(e); const l = $('loading'); if (l) l.textContent = 'Errore: ' + e.message; });
import { world } from './core.js';
window.__sim = { get world() { return world; }, allCaps, S, P, bins, table, deltas, lane };
