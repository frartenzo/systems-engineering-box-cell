import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { G, CAP, FLAVORS } from './config.js';

export { THREE, RAPIER };
export let world;

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const Y_AXIS = V3(0, 1, 0);
export const yawQ = (a) => new THREE.Quaternion().setFromAxisAngle(Y_AXIS, a);
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (t) => t * t * (3 - 2 * t);

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = 1 / 60;
  world.integrationParameters.lengthUnit = 10; // 1 unità = 1 dm: soglie di sleep/penetrazione scalate
  try { world.integrationParameters.numSolverIterations = 4; } catch (e) { /* versione senza parametro */ }
  return world;
}

// ---------------------------------------------------------------- scena
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;   // ricalcolate a mano (vedi main.js): le ombre cambiano poco
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151a22);
scene.fog = new THREE.Fog(0x151a22, 160, 420);
export const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.3, 900);
camera.position.set(70, 55, 40);
export let controls;
let sun = null;

// ---- qualità grafica: 0 alta · 1 media · 2 bassa (niente ombre) · 3 minima (meno fps e risoluzione)
export const quality = { level: 0, fps: 30 };
const Q = [
  { dpr: 1.5, shadows: true, fps: 30 },
  { dpr: 1, shadows: true, fps: 30 },
  { dpr: 1, shadows: false, fps: 30 },
  { dpr: 0.75, shadows: false, fps: 20 },
];
export function setQuality(l) {
  l = Math.max(0, Math.min(Q.length - 1, l));
  const q = Q[l], prevShadows = Q[quality.level].shadows;
  quality.level = l; quality.fps = q.fps;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
  renderer.setSize(innerWidth, innerHeight);
  if (sun && q.shadows !== prevShadows) {
    sun.castShadow = q.shadows;
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  renderer.shadowMap.needsUpdate = true;
}

export function initScene(container) {
  container.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, -22);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.5;
  controls.maxDistance = 330;
  controls.autoRotateSpeed = 0.7;
  controls.update();

  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2f38, 0.65));
  sun = new THREE.DirectionalLight(0xfff4e6, 2.1);
  sun.position.set(50, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 95; sc.bottom = -75; sc.near = 20; sc.far = 260;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.15;
  sun.target.position.set(0, 0, -25);
  scene.add(sun, sun.target);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ---------------------------------------------------------------- materiali
export const mats = {
  steel: new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.32 }),
  brushed: new THREE.MeshStandardMaterial({ color: 0xaab0ba, metalness: 0.85, roughness: 0.45 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.8, roughness: 0.5 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, metalness: 0.3, roughness: 0.55 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.05, roughness: 0.9 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x8e949c, metalness: 0.0, roughness: 0.65 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb48a56, metalness: 0, roughness: 0.85 }),
  cardboard: new THREE.MeshStandardMaterial({ color: 0xc8a06a, metalness: 0, roughness: 0.9 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf3f5f7, metalness: 0.1, roughness: 0.35 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x59606b, metalness: 0.5, roughness: 0.6 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2b705, metalness: 0.2, roughness: 0.5 }),
  agv: new THREE.MeshStandardMaterial({ color: 0xe8541f, metalness: 0.3, roughness: 0.5 }),
  led: new THREE.MeshBasicMaterial({ color: 0x35ff7a }),
};

// Aggiunge una scatola (mesh + collider fisso opzionale). rotY = angolo di yaw.
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function addBox(parent, { pos, size, rotY = 0, q = null, mat = mats.steel, phys = true, friction = 0.3, restitution = 0.1, shadow = true, visible = true, slick = false }) {
  const quat = q || yawQ(rotY);
  let mesh = null;
  if (visible) {
    mesh = new THREE.Mesh(boxGeo, mat);
    mesh.scale.set(size[0] * 2, size[1] * 2, size[2] * 2);
    mesh.position.copy(pos); mesh.quaternion.copy(quat);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
  }
  if (phys) {
    const cd = RAPIER.ColliderDesc.cuboid(size[0], size[1], size[2])
      .setTranslation(pos.x, pos.y, pos.z).setRotation(quat).setFriction(friction).setRestitution(restitution);
    if (slick) cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);  // attrito = il minore dei due: superficie scivolosa
    world.createCollider(cd);
  }
  return mesh;
}

// cilindro tra due punti (aste, pistoni)
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
export function makeLink(radius, mat) {
  const m = new THREE.Mesh(cylGeo, mat);
  m.scale.set(radius, 1, radius); m.castShadow = true;
  return m;
}
const _d = V3(), _q = new THREE.Quaternion();
export function setLink(m, a, b) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-4;
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.scale.y = len;
  _q.setFromUnitVectors(Y_AXIS, _d.multiplyScalar(1 / len));
  m.quaternion.copy(_q);
}

export function labelSprite(text, color = '#ffffff', scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,0.78)'; g.roundRect(2, 2, 252, 60, 12); g.fill();
  g.strokeStyle = color; g.lineWidth = 3; g.roundRect(2, 2, 252, 60, 12); g.stroke();
  g.fillStyle = '#fff'; g.font = '600 28px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4 * scale, 1 * scale, 1); s.renderOrder = 10;
  return s;
}

// ---------------------------------------------------------------- capsule (pool + instancing)
const MAXC = 3600;
function capGeometry() {
  const pts = [
    [0.0, 0.0], [0.118, 0.0], [CAP.rBot, 0.02], [0.145, 0.12], [0.158, 0.215],
    [0.172, 0.236], [CAP.rTop, 0.248], [CAP.rTop, CAP.h], [0.14, CAP.h], [0.0, CAP.h - 0.018],
  ].map(([r, y]) => new THREE.Vector2(r, y - CAP.h / 2));
  return new THREE.LatheGeometry(pts, 22);
}
export const capMesh = new THREE.InstancedMesh(
  capGeometry(),
  new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.88, roughness: 0.3 }),
  MAXC,
);
capMesh.frustumCulled = false;
capMesh.castShadow = false;
capMesh.receiveShadow = false;
capMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXC * 3), 3);
capMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

export const flavorColors = FLAVORS.map(([, c]) => new THREE.Color(c));
const _o = new THREE.Object3D();
const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
const freeIdx = [];
for (let i = MAXC - 1; i >= 0; i--) { freeIdx.push(i); capMesh.setMatrixAt(i, zeroM); }

export const allCaps = new Set();   // tutte le capsule vive
export const physCaps = new Set();  // con rigid body

// stati: bin | screw | fall | belt | bowl | virt | lane | held | boxed
export function spawnCap(flavor, pos, quat, { dynamic = true, state = 'bin', sleeping = false } = {}) {
  if (!freeIdx.length) return null;
  const i = freeIdx.pop();
  const c = { i, flavor, state, body: null, order: -1, bin: null, belt: null, awake: true, pos: pos.clone(), quat: (quat || new THREE.Quaternion()).clone(), u: 0, cell: -1 };
  capMesh.setColorAt(i, flavorColors[flavor]);
  capMesh.instanceColor.needsUpdate = true;
  allCaps.add(c);
  if (dynamic) makeBody(c, sleeping);
  writeMatrix(c);
  return c;
}
export function makeBody(c, sleeping = false) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setSleeping(sleeping)
    .setTranslation(c.pos.x, c.pos.y, c.pos.z).setRotation(c.quat)
    .setLinearDamping(0.05).setAngularDamping(0.35);
  c.body = world.createRigidBody(desc);
  c.col = world.createCollider(
    RAPIER.ColliderDesc.cylinder(CAP.h / 2, (CAP.rTop + CAP.rBot) / 2 - 0.005)
      .setFriction(0.38).setRestitution(0.12).setDensity(1), c.body);
  physCaps.add(c);
}
export function dropBody(c) {
  if (!c.body) return;
  world.removeRigidBody(c.body);
  c.body = null; c.col = null; physCaps.delete(c);
}
export function killCap(c) {
  dropBody(c);
  allCaps.delete(c);
  capMesh.setMatrixAt(c.i, zeroM);
  capMesh.instanceMatrix.needsUpdate = true;
  freeIdx.push(c.i);
  c.dead = true;
}
export function writeMatrix(c) {
  _o.position.copy(c.pos); _o.quaternion.copy(c.quat); _o.scale.set(1, 1, 1);
  _o.updateMatrix();
  capMesh.setMatrixAt(c.i, _o.matrix);
}
// copia lo stato fisico nelle istanze (solo corpi svegli)
export function syncCaps() {
  let awake = 0;
  for (const c of physCaps) {
    const b = c.body;
    if (b.isSleeping()) { c.awake = false; continue; }
    awake++;
    const t = b.translation(), r = b.rotation();
    c.pos.set(t.x, t.y, t.z); c.quat.set(r.x, r.y, r.z, r.w);
    c.awake = true;
    writeMatrix(c);
  }
  return awake;
}
export function touchInstances() { capMesh.instanceMatrix.needsUpdate = true; }
