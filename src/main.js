import { THREE, initPhysics, initScene, scene, camera, controls, renderer, capMesh, allCaps, V3, quality, setQuality } from './core.js';
import * as C from './config.js';
import { FLAVORS, NF, BOX_SIZE } from './config.js';
import { buildHall, buildBelts, buildBins, bins, labels, HUB } from './plant.js';
import { buildTable, table, stationOf } from './table.js';
import { buildLane, buildBoxLine, HEAD_X, lane, BOX_Z, LANE_Z } from './line.js';
import { R } from './table.js';
import { P, S, deltas, initSim, presettle, frame, addOrder, countsFromLayout, setDeltas, injectError, emptyBin, requestAgv, agvStatus, agvOf, updateBinGlow } from './sim.js';
import { initBuilder, openBuilder, closeBuilder, builderOpen, hideTip } from './builder.js';

const NORENDER = new URLSearchParams(location.search).has('norender');
const $ = (id) => document.getElementById(id);
const hex = (i) => FLAVORS[i][1];

async function boot() {
  await initPhysics();
  initScene($('app'));
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); const l = $('loading') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'loading' })); l.style.display = 'grid'; l.textContent = 'La grafica del dispositivo si è interrotta: ricarica la pagina (prova la qualità bassa con ?q=low).'; });
  scene.add(capMesh);
  if (new URLSearchParams(location.search).has('speed')) P.speed = +new URLSearchParams(location.search).get('speed');
  buildHall(); buildBelts(); buildBins(); buildTable(); buildLane(); buildBoxLine();
  initSim();
  presettle(4);
  $('loading').remove();
  buildUI();
  const q = new URLSearchParams(location.search);
  if (q.get('hud') === '0') for (const id of ['left', 'right', 'bottom', 'top']) $(id).style.display = 'none';
  if (q.get('cam')) { const v = q.get('cam').split(',').map(Number); camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); controls.update(); }
  if (q.get('run') === '1') setRunning(true);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- camera
const binView = (b) => [b.local(-7, 5.5, -11.5), b.local(-1.2, 1, 0.5)];
const views = {
  1: ['Isometrica', () => [V3(78, 58, 34), V3(0, 0, -24)]],
  2: ['Zenitale', () => [V3(0, 205, -22), V3(0, 0, -23)]],
  3: ['Cassone + vite', () => binView(bins[3])],
  4: ['Tavola', () => [V3(15, 13, 12), V3(0, 1, 0)]],
  5: ['Delta + scatole', () => [V3(HEAD_X - 13, 15, LANE_Z + 20), V3(HEAD_X + 1, 3, LANE_Z + 2)]],
  6: ['Hopper', () => [V3(9, 8.5, HUB.z + 9), V3(HUB.x, 1, HUB.z)]],
};
let tween = null;
function goTo(pos, tgt, view = null) {
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt };
  [...$('bottom').querySelectorAll('button[data-v]')].forEach((b) => b.classList.toggle('on', b.dataset.v == view));
}
function goView(k) {
  const [pos, tgt] = views[k][1]();
  if (k === 2) pos.z += 0.01;
  goTo(pos, tgt, k);
}
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || builderOpen()) return;
  const k = e.key.toLowerCase();
  if (views[k]) goView(k);
  else if (k === 'o') openBuilder();
  else if (k === ' ') { e.preventDefault(); setRunning(P.paused); }
  else if (k === 'l') labels.visible = !labels.visible;
  else if (k === 'h') for (const id of ['left', 'right', 'bottom', 'top']) { const e = $(id); e.style.display = e.style.display === 'none' ? '' : 'none'; }
  else keys.add(k);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------- avvio / stop impianto
function setRunning(on) {
  P.paused = !on;
  $('run').textContent = on ? '■ Ferma impianto' : '▶ Avvia impianto';
  $('run').className = on ? 'stop' : 'go';
  $('plantState').textContent = on ? 'IN FUNZIONE' : 'FERMO';
  $('plantState').className = on ? 'run' : 'off';
}
let toastT = 0;
function toast(msg, warn = false) {
  const t = $('toast'); t.textContent = msg; t.className = warn ? 'warn' : ''; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ---------------------------------------------------------------- UI
let selBin = null, followBin = null;
function selectBin(b) {
  if (selBin) { selBin.setSelected(false); updateBinGlow(selBin); }
  selBin = b;
  if (b) { b.setSelected(true); updateBinGlow(b); }
  renderBinCard();
}
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
  setRunning(!P.paused);
  $('run').onclick = () => setRunning(P.paused);
  $('newOrder').onclick = openBuilder;
  $('auto').classList.toggle('on', P.autoOrders);
  $('auto').onclick = () => { P.autoOrders = !P.autoOrders; $('auto').classList.toggle('on', P.autoOrders); };
  $('autoAgv').classList.toggle('on', P.autoAgv);
  $('autoAgv').onclick = () => { P.autoAgv = !P.autoAgv; $('autoAgv').classList.toggle('on', P.autoAgv); };
  const qp = new URLSearchParams(location.search).get('q');
  const coarse = matchMedia('(pointer: coarse)').matches;   // telefoni e tablet partono da qualità media
  setQ(qp === 'low' ? '2' : qp != null && /^[0-3]$/.test(qp) ? qp : 'auto');
  if (qMode === 'auto' && coarse) setQuality(1);
  [...$('qSeg').children].forEach((b) => { b.onclick = () => setQ(b.dataset.q); });
  $('rot').onclick = () => { controls.autoRotate = !controls.autoRotate; $('rot').classList.toggle('on', controls.autoRotate); };
  const bind = (id, key, fmt = (v) => v, cb) => {
    const el = $('p' + id), out = $('o' + id);
    el.value = P[key]; out.textContent = fmt(+el.value);
    el.oninput = () => { P[key] = +el.value; out.textContent = fmt(+el.value); cb && cb(+el.value); };
  };
  bind('Belt', 'beltSpeed'); bind('Screw', 'screwRate'); bind('Scr', 'scrambleTime'); bind('Tab', 'tableTime'); bind('Box', 'boxTime');
  bind('Stock', 'binStock', (v) => v, (v) => { S.stockInit = v; bins.forEach((b) => { if (b.online) b.stock = v; }); });
  [...$('dSeg').children].forEach((b) => {
    b.classList.toggle('on', +b.dataset.n === P.deltas);
    b.onclick = () => { P.deltas = +b.dataset.n; setDeltas(P.deltas); [...$('dSeg').children].forEach((x) => x.classList.toggle('on', x === b)); };
  });
  $('inject').onclick = injectError;
  $('emptyBin').onclick = () => { if (selBin) emptyBin(selBin); };

  initBuilder({
    onSend: (layout, copies) => {
      const counts = countsFromLayout(layout);
      const first = S.nextId;
      for (let i = 0; i < copies; i++) addOrder({ ...counts }, true, layout.slice());
      const ids = copies > 1 ? `#${first}–#${first + copies - 1}` : `#${first}`;
      toast(P.paused ? `Ordine ${ids} in coda · impianto fermo: premi ▶ Avvia` : `Ordine ${ids} in produzione`, P.paused);
    },
  });

  // scheda cassone + chiamata AGV
  $('bcAgv').onclick = () => {
    if (!selBin) return;
    requestAgv(selBin); followBin = selBin; renderBinCard();
    if (P.paused) toast('AGV chiamato, ma l\'impianto è fermo: premi ▶ Avvia', true);
  };
  $('bcCam').onclick = () => { if (selBin) { const [p, t] = binView(selBin); goTo(p, t); } };

  // selezione e tooltip dei cassoni
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const pick = (e) => {
    ptr.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...bins.map((b) => b.group), ...bins.map((b) => b.label)], true)[0];
    if (!hit) return null;
    return bins.find((b) => { let o = hit.object; while (o) { if (o === b.group || o === b.label) return true; o = o.parent; } return false; });
  };
  let down = null, hoverT = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; followBin = null; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    selectBin(pick(e));
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons || performance.now() - hoverT < 60) return;
    hoverT = performance.now();
    const b = pick(e);
    cv.style.cursor = b ? 'pointer' : '';
    const t = $('tip');
    if (!b) { hideTip(); return; }
    t.innerHTML = `<b>${FLAVORS[b.flavor][0]}</b><br><span class="sub">scorta ${b.stock}/${S.stockInit} · inclinazione ${(b.tilt * 180 / Math.PI).toFixed(0)}° · clic per la scheda</span>`;
    t.style.display = 'block';
    t.style.left = Math.min(innerWidth - t.offsetWidth - 8, e.clientX + 14) + 'px'; t.style.top = Math.min(innerHeight - t.offsetHeight - 8, e.clientY + 16) + 'px';
  });
  cv.addEventListener('pointerleave', hideTip);
}

const stName = ['Riempimento', 'Scrambler', 'Uscita', 'Ritorno'];
const tubTxt = { empty: 'vuoto', scramble: 'scrambler', done: 'in attesa buffer' };
const ringTxt = { empty: 'vuoto', loading: 'carico…', full: 'pronto', discharging: 'scarico' };
const agvTxt = { going: 'AGV in arrivo dal magazzino', swapping: 'AGV: scambio cassone', returning: 'AGV riparte col cassone vecchio' };
function renderBinCard() {
  const card = $('binCard');
  if (!selBin) { card.style.display = 'none'; return; }
  const b = selBin, frac = Math.max(0, Math.min(1, b.stock / S.stockInit));
  card.style.display = 'block';
  $('bcChip').style.background = hex(b.flavor);
  $('bcName').textContent = FLAVORS[b.flavor][0];
  $('bcId').textContent = `cassone #${b.id + 1}`;
  $('bcBar').style.width = frac * 100 + '%';
  $('bcBar').style.background = frac > 0.35 ? 'var(--ok)' : frac > 0.15 ? 'var(--acc)' : 'var(--err)';
  $('bcL1').innerHTML = `Scorta: <b style="color:var(--fg)">${b.stock}</b>/${S.stockInit} · fisiche ${b.caps.size} · in coda ${b.queued}`;
  const st = agvStatus(b);
  const busyTxt = P.paused ? 'AGV chiamato: impianto fermo, premi ▶ Avvia' : 'AGV chiamato: in attesa che il corridoio sia libero';
  $('bcL2').textContent = `Inclinazione ${(b.tilt * 180 / Math.PI).toFixed(0)}° · ${b.swapping ? (agvTxt[st] || 'AGV in corso') : b.agvRequested ? busyTxt : 'online'}`;
  const busy = b.swapping || b.agvRequested;
  $('bcAgv').disabled = busy;
  $('bcAgv').textContent = busy ? '🚚 AGV in corso…' : '🚚 Chiama AGV · cassone nuovo';
}

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
    const st = stationOf(s.id);
    const cls = s.rstate === 'discharging' ? 'discharging' : s.rstate === 'full' ? 'ready' : s.state === 'scramble' ? 'scramble' : '';
    const p = s.state === 'scramble' ? s.timer / P.scrambleTime : s.rstate === 'loading' ? s.ritems.length / Math.max(1, s.total) : s.rstate === 'empty' && s.state === 'empty' ? 0 : 1;
    return `<div class="slot ${cls}"><b>S${s.id + 1}</b> · ${stName[st]}<br>${tubTxt[s.state]}<small>buffer: ${ringTxt[s.rstate]}</small><i><u style="width:${p * 100}%"></u></i></div>`;
  }).join('');
  $('idx').innerHTML = (S.idxWait ? `Tavola: <span class="${S.idxWait.startsWith('attesa scrambler') ? 'warn' : ''}">${S.idxWait}</span>` : 'Tavola: in movimento / ciclo regolare') + ` · cancelletti nastri: <b style="color:${S.gatesOpen ? 'var(--ok)' : 'var(--err)'}">${S.gatesOpen ? 'aperti' : 'chiusi'}</b>`;
  const queued = S.orders.filter((o) => o.status === 'queued').length;
  $('qInfo').textContent = queued ? `${queued} ordini in coda` : '';
  $('orders').innerHTML = S.orders.slice(-6).map((o) => {
    const chips = Object.entries(o.counts).map(([f, n]) => `<span class="chip" style="background:${hex(f)}"></span>${n}`).join('  ');
    const pr = Math.min(1, o.released / 36);
    const mini = `<span class="mini">${o.layout.map((f) => `<i style="background:${hex(f)}"></i>`).join('')}</span>`;
    return `<div class="ord">${mini}<b>#${o.id}</b> ${chips}<br><span class="tag" style="float:none">${o.status}</span><div class="bar"><u style="width:${pr * 100}%"></u></div><span class="sub">dosate ${o.released} · camera ${o.camera} · in vasca ${o.arrived}</span></div>`;
  }).join('');
  $('log').innerHTML = S.log.slice(0, 14).map((l) => `<div class="${l.cls}">${fmtT(l.t)} · ${l.msg}</div>`).join('');
  for (const b of bins) b.updateLabel(S);
  renderBinCard();
}
const fmtT = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };

// ---------------------------------------------------------------- loop
// Carico GPU/CPU contenuto: render a 30 fps (?fps=60 per fluido), ombre ricalcolate ogni 8 frame disegnati
let last = performance.now(), hudT = 0, lastDraw = 0, drawN = 0;
// Qualità automatica: se per qualche secondo i fps reali restano molto sotto il target, la pagina scende di livello da sola
let qMode = 'auto', qWinT = performance.now(), qWinN = 0, qBad = 0, qHidden = false;
document.addEventListener('visibilitychange', () => { qHidden = true; });
function setQ(mode) {
  qMode = mode; qBad = 0;
  if (mode !== 'auto') setQuality(+mode);
  [...$('qSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.q === mode));
  $('qNow').textContent = ['alta', 'media', 'bassa', 'minima'][quality.level];
}
function qualityTick(now) {
  qWinN++;
  if (now - qWinT < 3000) return;
  const fps = qWinN / ((now - qWinT) / 1000);
  if (qHidden) { qHidden = false; }
  else if (qMode === 'auto' && quality.level < 3) {
    qBad = fps < quality.fps * 0.7 ? qBad + 1 : 0;
    if (qBad >= 2) { setQuality(quality.level + 1); qBad = 0; $('qNow').textContent = ['alta', 'media', 'bassa', 'minima'][quality.level]; toast(`Qualità grafica ridotta automaticamente (${['alta', 'media', 'bassa', 'minima'][quality.level]}) per alleggerire il dispositivo`, true); }
  }
  qWinT = now; qWinN = 0;
}
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
  if (followBin) {   // la camera segue l'AGV chiamato finché non lo scambio finisce o si tocca la vista
    const a = agvOf(followBin);
    if (!a || !a.group.visible) { if (!followBin.swapping && !followBin.agvRequested) followBin = null; }
    else { const d = a.group.position.clone().sub(controls.target).multiplyScalar(Math.min(1, dt * 3)); controls.target.add(d); camera.position.add(d); tween = null; }
  }
  controls.update();
  if (!NORENDER && now - lastDraw >= 1000 / quality.fps - 2) {
    lastDraw = now; qualityTick(now);
    renderer.shadowMap.needsUpdate = drawN++ % 8 === 0;
    renderer.render(scene, camera);
  }
  hudT += dt; if (hudT > 0.25) { hudT = 0; renderHUD(); }
  requestAnimationFrame(loop);
}

boot().catch((e) => { console.error(e); const l = $('loading'); if (l) l.textContent = 'Errore: ' + e.message; });
import { world } from './core.js';
import * as SIM from './sim.js';
window.__sim = { get world() { return world; }, allCaps, S, P, bins, table, deltas, lane, SIM, setRunning, get cam() { return { camera, controls }; } };
