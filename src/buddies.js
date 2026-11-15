// Designer-toy style 3D buddies: glossy physical materials, big-head proportions, eyes that track a target.
// Each stands with its feet at y=0, ~2 units tall, facing +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const vinyl = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, ...o });
const matte = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
const light = (color, intensity = 2.5) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
const sphere = (r, seg = 40) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 8, 24);
const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function add(parent, geo, mat, [x = 0, y = 0, z = 0] = [], [sx = 1, sy = 1, sz = 1] = []) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  parent.add(m);
  return m;
}
function group(parent, [x = 0, y = 0, z = 0] = []) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const GLOSS_BLACK = vinyl(0x0b0b0d, { roughness: 0.12, clearcoat: 1 });
const SHINE = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Organic eye: sclera + iris + pupil + catch-light. `g` blinks (scale.y), `look` rotates toward a target.
function eye(parent, pos, r, iris) {
  const g = group(parent, pos);
  add(g, sphere(r), vinyl(0xffffff, { roughness: 0.18 }), [0, 0, 0], [1, 1, 0.75]);
  const look = group(g);
  add(look, sphere(r * 0.64, 32), vinyl(iris, { roughness: 0.2 }), [0, 0, r * 0.5], [1, 1, 0.45]);
  add(look, sphere(r * 0.34, 24), GLOSS_BLACK, [0, 0, r * 0.67], [1, 1, 0.4]);
  add(look, sphere(r * 0.13, 12), SHINE, [r * 0.22, r * 0.25, r * 0.8]);
  return { g, look };
}
// Simple glossy bead eye (ghost, duck, mochi).
function bead(parent, pos, r, sy = 1.25) {
  const g = group(parent, pos);
  const look = group(g);
  add(look, sphere(r, 32), GLOSS_BLACK, [0, 0, 0], [1, sy, 0.7]);
  add(look, sphere(r * 0.3, 12), SHINE, [r * 0.3, r * 0.45, r * 0.6]);
  return { g, look };
}
function cheeks(parent, y, z, spread, color = 0xff6b81) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
  for (const s of [-1, 1]) add(parent, sphere(0.07, 16), m, [s * spread, y, z], [1.2, 0.6, 0.3]);
}
// Shoulder pivots: rotation.z > 0 raises the +x arm, < 0 raises the -x arm.
function arms(parent, x, y, z, build) {
  return [-1, 1].map((s) => { const p = group(parent, [s * x, y, z]); build(p, s); return p; });
}
function lathe(points, seg = 48) {
  return new THREE.LatheGeometry(points.map(([x, y]) => V2(x, y)), seg);
}

// White hovering robot with a glass visor and light-up eyes.
function robot() {
  const root = new THREE.Group();
  const shell = vinyl(0xf5f5f7, { roughness: 0.22, clearcoat: 1 });
  const joint = matte(0x3a3a3c);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.06, metalness: 0.3, clearcoat: 1 });
  const cyan = light(0x64d2ff, 3);
  const body = group(root, [0, 0.25, 0]);
  add(body, lathe([[0, 0], [0.2, 0.02], [0.36, 0.14], [0.43, 0.36], [0.41, 0.58], [0.3, 0.74], [0, 0.78]]), shell);
  add(body, new THREE.TorusGeometry(0.06, 0.014, 12, 32), cyan, [0, 0.42, 0.42]);
  add(root, new THREE.CircleGeometry(0.16, 32), light(0x64d2ff, 1.2), [0, 0.12, 0]).rotation.x = -Math.PI / 2;
  add(body, new THREE.CylinderGeometry(0.1, 0.12, 0.1, 24), joint, [0, 0.8, 0]);
  const head = group(body, [0, 0.84, 0]);
  add(head, new RoundedBoxGeometry(0.98, 0.7, 0.76, 6, 0.3), shell, [0, 0.36, 0]);
  add(head, new RoundedBoxGeometry(0.8, 0.44, 0.1, 6, 0.2), glass, [0, 0.36, 0.34]);
  const eyes = [-1, 1].map((s) => {
    const g = group(head, [s * 0.17, 0.38, 0]);
    const look = group(g);
    add(look, capsule(0.055, 0.07), cyan, [0, 0, 0.4]);
    return { g, look };
  });
  const mouth = add(head, capsule(0.012, 0.1), cyan, [0, 0.22, 0.4]);
  mouth.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    add(head, new THREE.CylinderGeometry(0.11, 0.11, 0.06, 32), joint, [s * 0.5, 0.36, 0]).rotation.z = Math.PI / 2;
    add(head, new THREE.TorusGeometry(0.075, 0.012, 8, 32), cyan, [s * 0.535, 0.36, 0]).rotation.y = Math.PI / 2;
  }
  const [armR, armL] = arms(body, 0.43, 0.58, 0, (p, s) => {
    add(p, sphere(0.07, 20), joint);
    add(p, capsule(0.075, 0.26), shell, [s * 0.02, -0.22, 0]);
    add(p, sphere(0.08, 20), joint, [s * 0.02, -0.44, 0]);
  });
  return {
    root, head, armL, armR, eyes, mouth, eyeRange: 0.35,
    extra(t) {
      body.position.y = 0.25 + Math.sin(t * 2.2) * 0.05;
      cyan.emissiveIntensity = 2.6 + Math.sin(t * 3) * 0.5;
    },
  };
}

function cat() {
  const root = new THREE.Group();
  const fur = vinyl(0xe0802f, { roughness: 0.55, clearcoat: 0.25, sheen: 0.4, sheenColor: 0xffc58a });
  const stripe = vinyl(0xc06a2b, { roughness: 0.55, clearcoat: 0.2 });
  const cream = vinyl(0xfbeee0, { roughness: 0.6, clearcoat: 0.2 });
  const pink = vinyl(0xf7a1a8, { roughness: 0.3 });
  const body = add(root, sphere(0.4), fur, [0, 0.42, 0], [1, 1.05, 0.92]);
  add(body, sphere(0.3), cream, [0, -0.05, 0.22], [0.85, 0.95, 0.6]);
  for (const s of [-1, 1]) add(root, sphere(0.12, 24), cream, [s * 0.17, 0.07, 0.24], [1, 0.65, 1.25]);
  const head = group(root, [0, 0.84, 0]);
  add(head, sphere(0.52), fur, [0, 0.38, 0], [1.14, 0.95, 1]);
  for (const s of [-1, 1]) {
    add(head, sphere(0.15, 24), cream, [s * 0.11, 0.22, 0.42], [1, 0.8, 0.7]);
    const ear = add(head, new THREE.ConeGeometry(0.17, 0.32, 32), fur, [s * 0.34, 0.83, -0.02]);
    ear.rotation.z = -s * 0.32;
    const inner = add(head, new THREE.ConeGeometry(0.1, 0.2, 32), pink, [s * 0.33, 0.8, 0.05]);
    inner.rotation.z = -s * 0.32;
    for (const k of [-1, 1]) {
      const w = add(head, new THREE.CylinderGeometry(0.004, 0.004, 0.32, 4), matte(0xffffff), [s * 0.36, 0.22 + k * 0.035, 0.38]);
      w.rotation.z = Math.PI / 2 + k * s * 0.14;
    }
  }
  for (const [x, w] of [[-0.12, 0.7], [0, 1], [0.12, 0.7]]) add(head, sphere(0.05, 16), stripe, [x, 0.82, 0.2], [0.6, 0.35 * w + 0.2, 1.6]).rotation.x = -0.5;
  const eyes = [-1, 1].map((s) => eye(head, [s * 0.2, 0.42, 0.4], 0.11, 0x7fb800));
  add(head, sphere(0.04, 16), pink, [0, 0.31, 0.53], [1.3, 0.8, 0.8]);
  const mouth = add(head, sphere(0.045, 16), matte(0x5a2a22), [0, 0.16, 0.5], [1.1, 0.35, 0.5]);
  cheeks(head, 0.24, 0.44, 0.32);
  const [armR, armL] = arms(root, 0.33, 0.58, 0.08, (p) => add(p, capsule(0.075, 0.14), fur, [0, -0.15, 0]));
  const tail = group(root, [0, 0.25, -0.34]);
  const curve = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0.12, 0.25, -0.15), V3(0.02, 0.55, -0.2), V3(0.2, 0.72, -0.08)]);
  add(tail, new THREE.TubeGeometry(curve, 32, 0.055, 16), fur);
  add(tail, sphere(0.06, 16), stripe, [0.2, 0.72, -0.08]);
  return {
    root, head, armL, armR, eyes, mouth, eyeRange: 0.45,
    extra(t, mode) { tail.rotation.z = Math.sin(t * (mode === 'nag' ? 12 : 2.6)) * 0.35; },
  };
}

function penguin() {
  const root = new THREE.Group();
  const coat = vinyl(0x1c1c1e, { roughness: 0.35 });
  const white = vinyl(0xfafafa, { roughness: 0.45 });
  const beak = vinyl(0xff9f0a, { roughness: 0.3 });
  const gold = vinyl(0xffcc4d, { roughness: 0.4 });
  add(root, sphere(0.46), coat, [0, 0.55, 0], [1, 1.15, 0.92]);
  add(root, sphere(0.38), white, [0, 0.5, 0.16], [0.86, 1.02, 0.72]);
  for (const s of [-1, 1]) add(root, sphere(0.11, 24), beak, [s * 0.17, 0.04, 0.2], [1.15, 0.38, 1.5]);
  const head = group(root, [0, 1.0, 0]);
  add(head, sphere(0.44), coat, [0, 0.28, 0]);
  add(head, sphere(0.34), white, [0, 0.24, 0.17], [1.1, 0.92, 0.8]);
  for (const s of [-1, 1]) add(head, sphere(0.1, 24), gold, [s * 0.36, 0.12, 0.08], [0.6, 1.2, 0.8]);
  const eyes = [-1, 1].map((s) => eye(head, [s * 0.14, 0.34, 0.4], 0.085, 0x3b2a20));
  const mouth = add(head, new THREE.ConeGeometry(0.06, 0.16, 32), beak, [0, 0.2, 0.5]);
  mouth.rotation.x = Math.PI / 2;
  cheeks(head, 0.16, 0.44, 0.22);
  const [armR, armL] = arms(root, 0.42, 0.82, 0, (p, s) => add(p, sphere(0.16, 24), coat, [s * 0.04, -0.26, 0], [0.32, 1.25, 0.65]));
  return { root, head, armL, armR, eyes, mouth, eyeRange: 0.45 };
}

function ghost() {
  const root = new THREE.Group();
  const sheet = vinyl(0xfbfbfd, { roughness: 0.3, clearcoat: 0.8, sheen: 0.6, sheenColor: 0xdfe6ff, side: THREE.DoubleSide });
  const body = group(root, [0, 0.25, 0]);
  add(body, sphere(0.55, 48), sheet, [0, 0.95, 0]);
  const skirtGeo = new THREE.CylinderGeometry(0.55, 0.66, 0.85, 64, 8, true);
  const pos = skirtGeo.attributes.position;
  const baseY = Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
  add(body, skirtGeo, sheet, [0, 0.52, 0]);
  const head = group(body, [0, 0.9, 0]);
  const eyes = [-1, 1].map((s) => bead(head, [s * 0.17, 0.12, 0.5], 0.075, 1.35));
  const mouth = add(head, sphere(0.06, 24), GLOSS_BLACK, [0, -0.08, 0.53], [0.9, 1, 0.4]);
  cheeks(head, -0.02, 0.5, 0.3);
  const [armR, armL] = arms(body, 0.55, 0.72, 0, (p, s) => add(p, sphere(0.11, 24), sheet, [s * 0.07, -0.08, 0], [1, 1.35, 1]));
  return {
    root, head, armL, armR, eyes, mouth, eyeRange: 0.3,
    extra(t) {
      body.position.y = 0.25 + Math.sin(t * 2) * 0.1;
      for (let i = 0; i < pos.count; i++) {
        const depth = Math.max(0, -baseY[i] / 0.425);
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, baseY[i] + Math.sin(a * 8 + t * 4) * 0.06 * depth * depth);
      }
      pos.needsUpdate = true;
    },
  };
}

// Glossy jelly blob (key kept as "slime" for saved settings).
function slime() {
  const root = new THREE.Group();
  const jelly = new THREE.MeshPhysicalMaterial({ color: 0x34c759, roughness: 0.12, transmission: 0.55, thickness: 0.8, ior: 1.35, clearcoat: 1 });
  const body = group(root);
  add(body, sphere(0.62, 64), jelly, [0, 0.5, 0], [1.12, 0.82, 1]);
  add(body, sphere(0.18, 32), vinyl(0x1f8f45), [0.12, 0.38, -0.12]);
  const head = group(body, [0, 0.52, 0]);
  const eyes = [-1, 1].map((s) => bead(head, [s * 0.19, 0.1, 0.56], 0.07, 1.3));
  const mouth = add(head, sphere(0.05, 24), GLOSS_BLACK, [0, -0.06, 0.6], [1.4, 0.6, 0.4]);
  cheeks(head, -0.02, 0.57, 0.33);
  const [armR, armL] = arms(body, 0.66, 0.42, 0, (p, s) => add(p, sphere(0.12, 24), jelly, [s * 0.04, -0.06, 0]));
  return {
    root, head, armL, armR, eyes, mouth, eyeRange: 0.3,
    extra(t) {
      const k = Math.sin(t * 4);
      body.scale.set(1 + k * 0.04, 1 - k * 0.05, 1 + k * 0.04);
    },
  };
}

function duck() {
  const root = new THREE.Group();
  const rubber = vinyl(0xffcc00, { roughness: 0.25, clearcoat: 1 });
  const beakM = vinyl(0xff8a00, { roughness: 0.3, clearcoat: 1 });
  add(root, sphere(0.5), rubber, [0, 0.48, -0.05], [1.05, 0.86, 1.15]);
  const tail = add(root, sphere(0.16, 24), rubber, [0, 0.7, -0.55], [0.8, 1.2, 0.8]);
  tail.rotation.x = -0.6;
  for (const s of [-1, 1]) add(root, sphere(0.11, 24), beakM, [s * 0.17, 0.04, 0.18], [1.2, 0.35, 1.6]);
  const head = group(root, [0, 0.82, 0.08]);
  add(head, sphere(0.4), rubber, [0, 0.3, 0]);
  add(head, sphere(0.05, 16), rubber, [0.02, 0.72, 0], [1, 2, 1]).rotation.z = -0.3;
  const eyes = [-1, 1].map((s) => bead(head, [s * 0.15, 0.4, 0.33], 0.06, 1.2));
  add(head, sphere(0.18, 32), beakM, [0, 0.22, 0.36], [1.1, 0.32, 0.95]);
  const mouth = add(head, sphere(0.15, 32), vinyl(0xe06c00), [0, 0.15, 0.34], [1, 0.22, 0.85]);
  cheeks(head, 0.24, 0.33, 0.25);
  const [armR, armL] = arms(root, 0.5, 0.65, 0, (p, s) => add(p, sphere(0.16, 24), rubber, [s * 0.02, -0.17, -0.02], [0.38, 1.05, 0.95]));
  return { root, head, armL, armR, eyes, mouth, eyeRange: 0.3 };
}

export const BUDDIES = {
  robot: { name: 'Bolt', kind: 'Robot', voice: { pitch: 0.5, rate: 1.05 }, hello: 'Beep boop! Scheduled task detected.', build: robot },
  cat: { name: 'Miso', kind: 'Cat', voice: { pitch: 1.6, rate: 1.05 }, hello: 'Meow! Hooman, listen up.', build: cat },
  penguin: { name: 'Pip', kind: 'Penguin', voice: { pitch: 1.3, rate: 1.1 }, hello: 'Waddle waddle, coming through!', build: penguin },
  ghost: { name: 'Boo', kind: 'Ghost', voice: { pitch: 0.8, rate: 0.85 }, hello: "Boo! Don't let this haunt you later.", build: ghost },
  slime: { name: 'Mochi', kind: 'Jelly', voice: { pitch: 1.9, rate: 1.15 }, hello: 'Blorp! Squishy reminder time.', build: slime },
  duck: { name: 'Quackers', kind: 'Duck', voice: { pitch: 1.5, rate: 1.2 }, hello: 'Quack quack! Heads up!', build: duck },
};

// ---------- custom .glb buddies from the store catalog ----------

// Adds catalog entries whose `model` is a .glb URL (built-in ones are already defined above).
export function registerBuddies(items, baseUrl = '') {
  const abs = (u) => (/^https?:/.test(u) ? u : baseUrl + u);
  for (const it of items) {
    const common = { name: it.name, kind: it.kind || 'Buddy', voice: it.voice || { pitch: 1, rate: 1 }, hello: it.hello || 'Hey! Time for your next thing.' };
    // A cut-out buddy: one transparent picture of a standing character (see server/models/README.md).
    if (it.image) BUDDIES[it.id] = { ...common, image: abs(it.image), hip: it.hip, split: it.split, tall: true, flat: true };
    else if (it.model && !it.model.startsWith('builtin:')) BUDDIES[it.id] = { ...common, model: abs(it.model), tall: it.tall !== false };
  }
}

const gltfLoader = new GLTFLoader();
const gltfCache = new Map();
const loadGltf = (url) => {
  if (!gltfCache.has(url)) gltfCache.set(url, gltfLoader.loadAsync(url));
  return gltfCache.get(url);
};

// Which of the model's own animation clips to play for each mode (first match wins).
const CLIP_HINTS = {
  idle: [/idle/i, /breath/i, /stand/i],
  walk: [/walk/i, /run/i, /move/i],
  wave: [/wave/i, /hello/i, /greet/i, /idle/i],
  happy: [/happy/i, /jump/i, /dance/i, /victory|cheer|celebrat/i],
  nag: [/no\b|shake/i, /angry/i, /jump/i, /wave/i],
  sleep: [/sleep/i, /sit/i, /lie|lay/i, /idle/i],
};

// Normalizes any model to ~2 units tall, feet at y=0, centered — so it fits the same stage as the built-ins.
async function buildModel(url) {
  const gltf = await loadGltf(url);
  const model = SkeletonUtils.clone(gltf.scene);
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(2 / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3));
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  const root = new THREE.Group();
  root.add(model);
  const dummy = () => new THREE.Object3D();
  const rig = { root, head: dummy(), armL: dummy(), armR: dummy(), eyes: [], mouth: dummy(), eyeRange: 0, generic: true };
  if (gltf.animations.length) {
    rig.mixer = new THREE.AnimationMixer(model);
    rig.clips = gltf.animations;
  }
  return rig;
}

function playClip(rig, mode) {
  if (!rig.mixer) return;
  const hints = CLIP_HINTS[mode] || CLIP_HINTS.idle;
  let clip = null;
  for (const re of hints) if ((clip = rig.clips.find((c) => re.test(c.name)))) break;
  rig.clipDriven = !!clip;
  clip ||= rig.clips.find((c) => /idle/i.test(c.name)) || rig.clips[0];
  const next = rig.mixer.clipAction(clip);
  if (rig.action === next) return;
  next.reset().fadeIn(0.3).play();
  rig.action?.fadeOut(0.3);
  rig.action = next;
}

// ---------- cut-out buddies: a realistic character from a single transparent picture ----------

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const loadTexture = (url) => {
  if (!textureCache.has(url)) textureCache.set(url, textureLoader.loadAsync(url));
  return textureCache.get(url);
};

// The picture is cut into a torso and two legs (at `hip`, a 0–1 height from the feet, and `split`, the 0–1
// horizontal gap between the legs). The legs hinge at the hip, so the character walks, hops and breathes.
async function buildCutout({ image, hip = 0.47, split = 0.5 }) {
  const tex = await loadTexture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  const H = 2, W = H * (tex.image.width / tex.image.height);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, alphaTest: 0.03, side: THREE.DoubleSide });
  const piece = (u0, u1, v0, v1) => {
    const g = new THREE.PlaneGeometry((u1 - u0) * W, (v1 - v0) * H);
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
    return new THREE.Mesh(g, mat);
  };
  const root = new THREE.Group();
  const seam = 0.012; // torso overlaps the legs slightly so no gap shows mid-stride
  const torso = piece(0, 1, hip - seam, 1);
  torso.position.set(0, ((hip - seam + 1) / 2) * H, 0.002);
  root.add(torso);
  const leg = (u0, u1) => {
    const pivot = new THREE.Group();
    pivot.position.set(((u0 + u1) / 2 - 0.5) * W, hip * H, 0);
    const m = piece(u0, u1, 0, hip);
    m.position.y = (-hip * H) / 2;
    pivot.add(m);
    root.add(pivot);
    return pivot;
  };
  const legL = leg(0, split), legR = leg(split, 1);
  const dummy = () => new THREE.Object3D();
  return {
    root, head: dummy(), armL: dummy(), armR: dummy(), eyes: [], mouth: dummy(), eyeRange: 0, generic: true, flat: true,
    extra(t, mode) {
      const stride = mode === 'walk' ? Math.sin(t * 10) * 0.3 : mode === 'nag' ? Math.sin(t * 14) * 0.12 : 0;
      damp(legL.rotation, 'z', stride, 0.35);
      damp(legR.rotation, 'z', -stride, 0.35);
      torso.scale.y = 1 + Math.sin(t * 1.7) * 0.006; // breathing
      torso.rotation.z = mode === 'wave' ? Math.sin(t * 2.2) * 0.012 : 0;
    },
  };
}

const damp = (obj, prop, target, k = 0.18) => { obj[prop] += (target - obj[prop]) * k; };

function softShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Owns a renderer + scene for one canvas. `mover` is the group to slide around (walk in/out).
// Pass `size: [w, h]` for an offscreen canvas (thumbnails).
export function createStage(canvas, { distance = 6.4, size = null, target = 0.95 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!size });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.25, distance);
  camera.lookAt(0, target, 0);
  // Optional auto-framing: the buddy (2 units tall) fills `frac` of the canvas height with its feet near the bottom edge.
  let framing = null, visibleH = 2 * distance * Math.tan((14 * Math.PI) / 180);
  const applyFraming = (frac) => {
    visibleH = 2 / frac;
    const d = visibleH / (2 * Math.tan((14 * Math.PI) / 180));
    const mid = visibleH / 2 - visibleH * 0.05;
    camera.position.set(0, mid + 0.25, d);
    camera.lookAt(0, mid, 0);
  };
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  rim.position.set(-3, 2, -3);
  scene.add(rim);

  const mover = new THREE.Group();
  scene.add(mover);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  mover.add(shadow);

  const clock = new THREE.Clock();
  const look = { x: 0, y: 0, active: false };
  let rig = null, current = null, mode = 'idle', modeAt = 0, talking = false, paused = false, raf = 0;

  const resize = () => {
    const [w, h] = size || [canvas.clientWidth || 1, canvas.clientHeight || 1];
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  if (!size) new ResizeObserver(resize).observe(canvas);
  resize();

  function animate(t, mt) {
    const { root, head, armL, armR, eyes, mouth } = rig;
    let y = 0, rz = 0, ry = 0, aL = 0.12, aR = -0.12, hx = 0, hy = Math.sin(t * 0.7) * 0.15, hz = 0, sy = 1;
    switch (mode) {
      case 'walk':
        y = Math.abs(Math.sin(t * 10)) * 0.12; rz = Math.sin(t * 10) * 0.06;
        aL = 0.25 + Math.sin(t * 10) * 0.45; aR = -0.25 + Math.sin(t * 10) * 0.45; hy = 0;
        break;
      case 'wave':
        aL = 2.5 + Math.sin(t * 9) * 0.4; hz = Math.sin(t * 1.8) * 0.08; y = Math.abs(Math.sin(t * 2.5)) * 0.03;
        break;
      case 'happy':
        y = Math.abs(Math.sin(mt * 7)) * 0.45; ry = Math.min(mt * 9, Math.PI * 2); aL = 2.7; aR = -2.7; hy = 0;
        break;
      case 'nag':
        rz = Math.sin(t * 26) * 0.07; y = Math.abs(Math.sin(t * 8)) * 0.16;
        aL = 2.6 + Math.sin(t * 13) * 0.45; aR = -2.6 - Math.sin(t * 13) * 0.45;
        break;
      case 'sleep':
        hx = 0.3; hy = 0; sy = 1 + Math.sin(t * 1.5) * 0.025; aL = 0.04; aR = -0.04;
        break;
      default:
        y = Math.abs(Math.sin(t * 1.8)) * 0.025; aL = 0.12 + Math.sin(t * 1.5) * 0.05; aR = -aL;
    }
    // Head and eyes follow the look target (the cursor) when there is one.
    const tracking = look.active && mode !== 'sleep' && mode !== 'walk' && mode !== 'happy';
    if (tracking) { hy = look.x * 0.45; hx = -look.y * 0.25; }
    // Models with their own matching clip move themselves; otherwise we move them procedurally.
    if (rig.clipDriven) { y = 0; rz = 0; sy = 1; }
    // Custom models have no separate head, so the whole body turns toward the cursor.
    if (rig.generic && mode !== 'happy') ry = tracking ? hy * (rig.flat ? 0.45 : 0.8) : 0;
    if (rig.flat && mode === 'happy') ry = 0;
    root.position.y = y;
    root.rotation.z = rz;
    if (rig.generic && mode !== 'happy') damp(root.rotation, 'y', ry, 0.1);
    else root.rotation.y = ry;
    root.scale.y = sy;
    damp(armL.rotation, 'z', aL);
    damp(armR.rotation, 'z', aR);
    damp(head.rotation, 'x', hx, 0.1);
    damp(head.rotation, 'y', hy, 0.1);
    damp(head.rotation, 'z', hz, 0.1);
    const blink = mode === 'sleep' ? 0.1 : t % 4.1 < 0.11 ? 0.08 : mode === 'happy' ? 0.5 : 1;
    const range = rig.eyeRange;
    for (const e of eyes) {
      e.g.scale.y = blink;
      damp(e.look.rotation, 'y', tracking ? look.x * range : 0, 0.2);
      damp(e.look.rotation, 'x', tracking ? -look.y * range * 0.7 : 0, 0.2);
    }
    mouth.scale.y = rig.mouthBase * (talking ? 1 + Math.abs(Math.sin(t * 16)) * 1.3 : 1);
    shadow.scale.setScalar(1 - Math.min(y, 0.5) * 0.6);
    rig.extra?.(t, mode);
  }

  let last = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (paused) return;
    const t = clock.getElapsedTime();
    rig?.mixer?.update(Math.min(t - last, 0.1));
    last = t;
    if (rig) animate(t, t - modeAt);
    renderer.render(scene, camera);
  }
  if (!size) frame();

  let loading = 0;
  const api = {
    mover,
    get buddy() { return current; },
    // Built-ins swap instantly; .glb buddies load first (falling back to the robot if the file fails).
    async setBuddy(k) {
      if (!BUDDIES[k]) k = 'robot';
      if (k === current) return;
      current = k;
      const ticket = ++loading;
      const meta = BUDDIES[k];
      const fallback = (e) => { console.warn('Buddy failed to load', e); return BUDDIES.robot.build(); };
      const next = meta.image ? await buildCutout(meta).catch(fallback) : meta.model ? await buildModel(meta.model).catch(fallback) : meta.build();
      if (ticket !== loading) return;
      if (rig) mover.remove(rig.root);
      rig = next;
      rig.mouthBase = rig.mouth.scale.y;
      mover.add(rig.root);
      playClip(rig, mode);
      if (framing) applyFraming(meta.tall ? framing.tall : framing.toy);
    },
    // Auto-frame every buddy: `tall` characters (people, custom models) and `toy` built-ins get different sizes.
    setFraming(f) { framing = f; },
    // Half the visible width at the buddy's depth, in world units — for walking on and off screen.
    get halfWidth() { return (visibleH * camera.aspect) / 2; },
    get flat() { return !!rig?.flat; },
    setMode(m) { mode = m; modeAt = clock.getElapsedTime(); if (rig) playClip(rig, m); },
    setTalking(b) { talking = b; },
    setPaused(b) { paused = b; },
    // x, y in [-1, 1]: where the buddy should look, relative to its head. null stops tracking.
    lookAt(x, y) {
      if (x == null) { look.active = false; return; }
      look.active = true;
      look.x = Math.max(-1, Math.min(1, x));
      look.y = Math.max(-1, Math.min(1, y));
    },
    async snapshot(k) {
      await api.setBuddy(k);
      mode = 'idle';
      rig.mixer?.update(0.5);
      for (let i = 0; i < 30; i++) animate(1.3, 1);
      renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    },
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); pmrem.dispose(); },
  };
  return api;
}
