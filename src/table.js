import { THREE, RAPIER, world, scene, V3, yawQ, mats, addBox, labelSprite } from './core.js';
import * as C from './config.js';
import { CAP } from './config.js';
import { HUB, labels } from './plant.js';

export const R = C.R_TABLE;
export const BOWL_R = 1.65;           // raggio interno vasca di riempimento
export const BOWL_FLOOR = 0.5;
export const RIM_Y = 1.05;

// buffer ad anello attorno a ogni scrambler: tiene le 36 capsule già dritte e in fila, pronte per l'uscita
export const RING_R0 = 2.42, RING_R1 = 3.0, RING_RC = 2.72;
export const RING_H = 0.34;
export const RING_ITEM_Y = 0.4 + 0.03 + CAP.h / 2 + 0.01;
export const RING_STEP = 0.46 / RING_RC;   // passo angolare tra capsule
// direzione del cancelletto d'uscita di uno slot (nel sistema della tavola): verso l'esterno rispetto al centro tavola
export const gateAngle = (id) => { const a = id * Math.PI / 2; return Math.atan2(-Math.cos(a), Math.sin(a)); };
// posizione (x,z) relativa al centro dello scrambler della k-esima capsula in fila (k=0: davanti al cancelletto)
export function ringXZ(id, k) {
  const ph = gateAngle(id) + k * RING_STEP;
  return [RING_RC * Math.cos(ph), RING_RC * Math.sin(ph)];
}

export const table = {
  group: new THREE.Group(), theta: 0, target: 0, step: 0, moving: false, slots: [], tubs: [],
};
scene.add(table.group);

// posizione mondo di una stazione (0=N fill, 1=E, 2=S uscita, 3=W) a un dato angolo
export const stationPos = (a) => V3(R * Math.sin(a), 0, -R * Math.cos(a));

export function buildTable() {
  const g = table.group;
  // base fissa
  const plateTop = 0.4;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, plateTop, 64), mats.steel);
  plate.position.y = plateTop / 2; plate.castShadow = true; plate.receiveShadow = true; g.add(plate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.6, 0.12, 10, 80), mats.brushed); ring.rotation.x = Math.PI / 2; ring.position.y = plateTop; g.add(ring);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.9, 24), mats.darkSteel); hub.position.y = 0.6; g.add(hub);
  world.createCollider(RAPIER.ColliderDesc.cylinder(0.2, 7.6).setTranslation(0, 0.2, 0).setFriction(0.4));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.2, 40), mats.darkSteel); base.position.y = 0.1; scene.add(base);

  for (let j = 0; j < 4; j++) {
    const a = j * Math.PI / 2;
    const tub = new THREE.Group(); tub.position.copy(stationPos(a)); g.add(tub);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.65, 48, 1, true), mats.brushed); wall.position.y = 0.4 + 0.325; wall.castShadow = true; tub.add(wall);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.38, 0.65, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a919b, metalness: 0.85, roughness: 0.4, side: THREE.BackSide })); inner.position.copy(wall.position); tub.add(inner);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.38, 2.38, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.7, roughness: 0.55 })); floor.position.y = BOWL_FLOOR - 0.02; tub.add(floor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.07, 8, 60), mats.steel); rim.rotation.x = Math.PI / 2; rim.position.y = RIM_Y; tub.add(rim);
    // scrambler: stella a pale che ruota quando lavora
    const star = new THREE.Group(); star.position.y = BOWL_FLOOR + 0.05; tub.add(star);
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.16), mats.darkSteel); p.position.set(0, 0.06, 0); p.rotation.y = k * Math.PI / 3; star.add(p);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), mats.yellow); tip.position.set(Math.cos(k * Math.PI / 3) * 1.1, 0.1, -Math.sin(k * Math.PI / 3) * 1.1); star.add(tip);
    }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), new THREE.MeshBasicMaterial({ color: 0x444444 })); led.position.set(0, 1.25, 2.3); tub.add(led);

    // buffer ad anello con cancelletto d'uscita
    const gate = 0.28, thetaG = Math.PI - a;   // CylinderGeometry misura l'angolo da +z verso +x
    const rfloor = new THREE.Mesh(new THREE.RingGeometry(RING_R0, RING_R1, 72), new THREE.MeshStandardMaterial({ color: 0x3a414b, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }));
    rfloor.rotation.x = -Math.PI / 2; rfloor.position.y = 0.425; rfloor.receiveShadow = true; tub.add(rfloor);
    const rwall = new THREE.Mesh(new THREE.CylinderGeometry(RING_R1, RING_R1, RING_H, 72, 1, true, thetaG + gate / 2, Math.PI * 2 - gate), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide }));
    rwall.position.y = 0.4 + RING_H / 2; rwall.castShadow = true; tub.add(rwall);
    const gdir = V3(Math.sin(a), 0, -Math.cos(a));
    const rled = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), new THREE.MeshBasicMaterial({ color: 0x444444 }));
    rled.position.copy(gdir).multiplyScalar(RING_R1 + 0.15).setY(0.7); tub.add(rled);
    table.tubs.push({ tub, star, led, rled, a });
    table.slots.push({
      id: j, state: 'empty', timer: 0, items: [], order: null,                    // scrambler: empty | scramble | done
      rstate: 'empty', ritems: [], rorder: null, emitted: 0, emitT: 0, feed: 0, total: 0, relT: 0,   // buffer: empty | loading | full | discharging
    });
  }

  // ----- vasca fisica di riempimento (fissa nel mondo, sotto l'hopper)
  const ringN = 14;
  for (let k = 0; k < ringN; k++) {
    const ang = k / ringN * Math.PI * 2, rr = BOWL_R + 0.1;
    const pos = V3(HUB.x + Math.cos(ang) * rr, (BOWL_FLOOR + RIM_Y) / 2, HUB.z + Math.sin(ang) * rr);
    addBox(scene, { pos, size: [0.42, (RIM_Y - BOWL_FLOOR) / 2, 0.1], rotY: Math.atan2(-Math.cos(ang), -Math.sin(ang)), phys: true, visible: false, friction: 0.1, slick: true });
  }
  addBox(scene, { pos: V3(HUB.x, BOWL_FLOOR - 0.2, HUB.z), size: [1.9, 0.2, 1.9], phys: true, visible: false, friction: 0.35 });

  // ----- hopper conico
  const ri = 1.85, yi = RIM_Y, ro = 2.7, yo = 1.5, N = 16;
  const rm = (ri + ro) / 2, ym = (yi + yo) / 2, Ls = Math.hypot(ro - ri, yo - yi);
  const sIn = V3(-(ro - ri), -(yo - yi), 0).normalize();   // direzione in (r,y): verso il centro, in basso
  for (let k = 0; k < N; k++) {
    const psi = k / N * Math.PI * 2, rh = V3(Math.cos(psi), 0, Math.sin(psi)), th = V3(-Math.sin(psi), 0, Math.cos(psi));
    const slopeDir = rh.clone().multiplyScalar(sIn.x).add(V3(0, sIn.y, 0));      // lungo la pendenza
    const normal = V3().crossVectors(slopeDir, th).normalize();                    // verso l'alto
    if (normal.y < 0) normal.negate();
    const m4 = new THREE.Matrix4().makeBasis(th, normal, V3().crossVectors(th, normal));
    const q = new THREE.Quaternion().setFromRotationMatrix(m4);
    addBox(scene, { pos: V3(HUB.x + rh.x * rm, ym, HUB.z + rh.z * rm), size: [0.58, 0.05, Ls / 2], q, mat: mats.steel, friction: 0.03, slick: true });
  }
  const lab = labelSprite('Hopper / slot di riempimento', '#ffb020', 1.3); lab.position.set(HUB.x, 6.5, HUB.z); labels.add(lab);
  const lab2 = labelSprite('Tavola rotante · 4 scrambler', '#ffb020', 1.3); lab2.position.set(0, 4.5, 0); labels.add(lab2);
  const lab3 = labelSprite('Uscita', '#ffb020', 1); lab3.position.set(0, 4, R + 2.6); labels.add(lab3);
}

// indice stazione (0=N,1=E,2=S,3=W) dello slot j al passo corrente
export const stationOf = (j) => ((j + table.step) % 4 + 4) % 4;
export const slotAt = (st) => table.slots.find((s) => stationOf(s.id) === st);

export function updateTable(dt, indexTime) {
  if (Math.abs(table.theta - table.target) > 1e-4) {
    table.moving = true;
    const rate = (Math.PI / 2) / indexTime;
    const d = table.target - table.theta;
    table.theta += Math.sign(d) * Math.min(Math.abs(d), rate * dt * (0.25 + 1.5 * Math.sin(Math.PI * Math.min(1, (Math.PI / 2 - Math.abs(d)) / (Math.PI / 2) + 0.02))));
  } else { table.theta = table.target; table.moving = false; }
  table.group.rotation.y = -table.theta;
}
