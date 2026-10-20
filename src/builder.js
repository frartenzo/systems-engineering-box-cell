// Menu a griglia (stile inventario) per comporre la Discovery Box da 36 capsule.
// Clic/tap su un gusto = +1 · Maiusc = +6 · Alt = riempi · trascina su una cella · tasto destro / tap su una cella = togli.
import { FLAVORS, NF, BOX_SIZE } from './config.js';
import { genOrder, layoutFromCounts, countsFromLayout } from './sim.js';

const $ = (id) => document.getElementById(id);
const box = Array(BOX_SIZE).fill(-1);
let copies = 1;
let drag = null;

const capEl = (f, cls = '') => { const d = document.createElement('div'); d.className = 'cap ' + cls; d.style.setProperty('--c', FLAVORS[f][1]); return d; };
const inBox = (f) => box.reduce((a, x) => a + (x === f ? 1 : 0), 0);
const filled = () => box.reduce((a, x) => a + (x >= 0 ? 1 : 0), 0);

function addMany(f, n) {
  for (let i = 0; i < box.length && n > 0; i++) if (box[i] < 0) { box[i] = f; n--; }
}
function removeOne(f) { const i = box.lastIndexOf(f); if (i >= 0) box[i] = -1; }

function render() {
  const n = filled();
  $('bCount').textContent = `${n}/${BOX_SIZE}`;
  $('bCount').className = n === BOX_SIZE ? 'ok' : '';
  [...$('palette').children].forEach((t) => {
    const c = inBox(+t.dataset.f), badge = t.querySelector('.cnt');
    badge.textContent = c || '';
  });
  [...$('boxGrid').children].forEach((sl, i) => {
    sl.replaceChildren();
    if (box[i] >= 0) sl.appendChild(capEl(box[i]));
  });
  const counts = countsFromLayout(box);
  $('bSummary').innerHTML = Object.entries(counts).sort((a, b) => a[0] - b[0])
    .map(([f, c]) => `<span class="sumchip"><i style="background:${FLAVORS[f][1]}"></i>${c}× ${FLAVORS[f][0]}</span>`).join('') || '<span class="sub">Box vuota: scegli i gusti a sinistra.</span>';
  $('bSend').disabled = n !== BOX_SIZE;
  $('bSend').textContent = n === BOX_SIZE ? `Invia in produzione${copies > 1 ? ' ×' + copies : ''}` : `Mancano ${BOX_SIZE - n} capsule`;
  $('bCopies').textContent = copies;
}

// ---- tooltip in stile gioco
const tip = () => $('tip');
function showTip(x, y, lines) {
  const t = tip(); t.innerHTML = lines; t.style.display = 'block';
  const w = t.offsetWidth, h = t.offsetHeight;
  t.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px'; t.style.top = Math.min(innerHeight - h - 8, y + 16) + 'px';
}
export const hideTip = () => { tip().style.display = 'none'; };
function tipFor(el) {
  if (el.dataset.f !== undefined && el.dataset.slot === undefined) { const f = +el.dataset.f; return `<b>${FLAVORS[f][0]}</b><br><span class="sub">${inBox(f)} nella box · clic +1 · Maiusc +6 · Alt riempi</span>`; }
  if (el.dataset.slot !== undefined) { const f = box[+el.dataset.slot]; return f >= 0 ? `<b>${FLAVORS[f][0]}</b><br><span class="sub">tap / tasto destro per togliere · trascina per spostare</span>` : '<span class="sub">Cella libera</span>'; }
  return null;
}

// ---- drag & drop con pointer events (mouse e touch)
function startDrag(e, src) {
  if (e.button !== 0) return;
  drag = { src, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, shift: e.shiftKey, alt: e.altKey };
  addEventListener('pointermove', onMove); addEventListener('pointerup', onUp, { once: true });
  e.preventDefault();
}
const slotAtPoint = (x, y) => document.elementFromPoint(x, y)?.closest('.mc[data-slot]');
function onMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) {
    drag.moved = true; hideTip();
    drag.ghost = capEl(drag.src.f, 'ghost'); document.body.appendChild(drag.ghost);
    if (drag.src.type === 'slot') $('boxGrid').children[drag.src.i].classList.add('lifted');
  }
  if (drag.moved) {
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    [...$('boxGrid').children].forEach((s) => s.classList.remove('hot'));
    slotAtPoint(e.clientX, e.clientY)?.classList.add('hot');
  }
}
function onUp(e) {
  removeEventListener('pointermove', onMove);
  const d = drag; drag = null; if (!d) return;
  d.ghost?.remove();
  [...$('boxGrid').children].forEach((s) => s.classList.remove('hot', 'lifted'));
  const { src } = d;
  if (!d.moved) {                                   // tap / clic
    if (src.type === 'flavor') addMany(src.f, e.altKey ? BOX_SIZE : e.shiftKey ? 6 : 1);
    else box[src.i] = -1;
  } else {
    const target = slotAtPoint(e.clientX, e.clientY);
    const overPane = document.elementFromPoint(e.clientX, e.clientY)?.closest('#boxPane');
    if (src.type === 'flavor') {
      if (target) box[+target.dataset.slot] = src.f; else if (overPane) addMany(src.f, 1);
    } else if (target) {
      const j = +target.dataset.slot; [box[src.i], box[j]] = [box[j], box[src.i]];
    } else if (!overPane) box[src.i] = -1;          // trascinata fuori dalla box: la tolgo
  }
  render();
}

export function openBuilder() { $('builder').classList.add('open'); render(); }
export function closeBuilder() { $('builder').classList.remove('open'); hideTip(); }
export const builderOpen = () => $('builder').classList.contains('open');

export function initBuilder({ onSend }) {
  const pal = $('palette');
  FLAVORS.forEach(([, col], f) => {
    const t = document.createElement('div'); t.className = 'mc'; t.dataset.f = f;
    t.appendChild(capEl(f));
    const c = document.createElement('span'); c.className = 'cnt'; t.appendChild(c);
    pal.appendChild(t);
  });
  for (let i = 0; i < BOX_SIZE; i++) { const s = document.createElement('div'); s.className = 'mc'; s.dataset.slot = i; $('boxGrid').appendChild(s); }

  pal.addEventListener('pointerdown', (e) => { const t = e.target.closest('.mc'); if (t) startDrag(e, { type: 'flavor', f: +t.dataset.f }); });
  $('boxGrid').addEventListener('pointerdown', (e) => { const t = e.target.closest('.mc'); if (t && box[+t.dataset.slot] >= 0) startDrag(e, { type: 'slot', i: +t.dataset.slot, f: box[+t.dataset.slot] }); });
  $('builder').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const t = e.target.closest('.mc'); if (!t) return;
    if (t.dataset.slot !== undefined) box[+t.dataset.slot] = -1; else removeOne(+t.dataset.f);
    render();
  });
  $('builder').addEventListener('pointermove', (e) => {
    if (drag?.moved) return;
    const t = e.target.closest('.mc'); const html = t && tipFor(t);
    if (html) showTip(e.clientX, e.clientY, html); else hideTip();
  });
  $('builder').addEventListener('pointerleave', hideTip);
  $('bClose').onclick = closeBuilder;
  $('builder').addEventListener('pointerdown', (e) => { if (e.target === $('builder')) closeBuilder(); });
  $('bClear').onclick = () => { box.fill(-1); render(); };
  $('bRand').onclick = () => { const l = layoutFromCounts(genOrder()); l.forEach((f, i) => { box[i] = f; }); render(); };
  $('bMinus').onclick = () => { copies = Math.max(1, copies - 1); render(); };
  $('bPlus').onclick = () => { copies = Math.min(50, copies + 1); render(); };
  $('bSend').onclick = () => {
    if (filled() !== BOX_SIZE) return;
    onSend(box.slice(), copies);
    box.fill(-1); copies = 1; closeBuilder(); render();
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && builderOpen()) closeBuilder(); });
  render();
}
