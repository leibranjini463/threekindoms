// 单挑 scene: a side-view HD-2D diorama built from the 白兵 field's terrain. Both armies stand back in
// ranks and cheer while the two generals ride in and trade blows in a steady side-on wide shot that keeps
// both ranks and the place in view; a heavy blow or a death cuts in close for a moment. Under a besieged
// city (setPlace({ siege })) the duel is fought before its gate: a painted wall and gate tower
// (tools/gen_citygate_codex.sh → build_citygate.py) with archers on the wall and the holder's banners.
// Riders are frame-by-frame action strips (tools/gen_duel_frames_codex.sh → slice_duel_frames.py):
// idle breath, gallop strides that carry every move, wind-up / strike / follow-through per weapon class,
// hurt, dodge, taunt and a fall that parts the rider from his horse. Contact drives the hit: hit-stop,
// sparks at the weapon tip, sound, damage number and the HUD's HP bar all fire from one event.
// The generals fight at close quarters: a blow is a short drive in from the mark and a rein back to it, facing
// the foe throughout. A horse turns only to leave (退却, a parley that ends the duel, a riderless bolt): he wheels
// round through side, three-quarter and head-on views (tools/duel_frame_prompts.mjs --wheel) and rides off.
// Every animation runs on this view's own presentation clock, so the hit-stop freezes motion, timing
// is the same at any frame rate, and leaving the scene cancels whatever is still playing.
// Presentation only: core/skirmish.js Duel decides every action; tacticalhud.js drives the turns.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { unitTex, treeTex, canvasTex, rng } from './pixel.js';
import { edgeOcclusion, scatterTufts, backdrop, lightShafts, slash, thrust, sparkBurst, dustPuff, ring as groundRing, skyLit, release, shakeOffset, shakeLevel } from './fx.js';
import { seasonalize } from './seasons.js';
import { genericArt } from './core/pack.js';
import { seasonEnv } from './seasonenv.js';

const FOREST = 0, RIVER = 3, MOUNT = 4, CASTLE = 5;
// The block stage covers what the duel shot sees (z -4…7, rows Z0…Z0+1 hold the riders' lane); flat ground
// carries on beyond it, back to the wall line (BACK) and out past every framing.
const CW = 34, CD = 14, S = 0.8, Z0 = 5, BACK = -9.5;
const HERO_H = 2.1; // idle rider + horse height in world units (0.1.0's 2.3 read as too big)
// Strips are cut to one figure height including the weapon, so a raised glaive shrank its rider. Riders
// are sized by their solid body instead (meta.body px, thin weapons left out), within -15 %…+20 %.
const BODY_PX = 110;
const unitOf = (meta) => (HERO_H / meta.figH) * Math.min(1.2, Math.max(0.85, meta.body ? BODY_PX / meta.body : 1));
const GALLOP = 5.5, WALK = 1.4, DRIVE = 9; // world units per second; DRIVE: the fastest a blow's drive in covers ground
// Gaits are driven by ground covered, not by time: one frame per STEP of travel, so hooves never slide.
const STEP = { gallop: 0.55, walk: 0.3, loose: 0.6, flee: 0.55 };
// A horse leaving the duel wheels round. A wheel is a half circle on the ground, this long (ms) and this wide
// (world units, end to end): walked when both sides draw off, spun on the haunches when fleeing or bolting.
const WHEEL = { walk: { ms: 520, z: 0.55 }, gallop: { ms: 340, z: 0.4 }, loose: { ms: 340, z: 0.4 } };
// The generals stand this far outside the longer weapon's reach, so a blow is a short drive in and the way back
// to the mark is a step or two of reining back. (They stood 1.9 off and wheeled round twice to get back: 2026-11-09.)
// Since 0.4.3 they stand off at mid-field instead (enter: STANDOFF past the longer reach, never under STANDOFF_MIN) and
// both ride in to meet; the old nose-to-nose marks and the toggle that chose between the two stagings are gone.
const STANDOFF = 1.8, STANDOFF_MIN = 4.2;
const SPIN_GAP = 3.2; // 普通攻击: the closest the attacker spins his weapon to the foe (barrel to barrel)
const MIN_GAP = 1.75, LANE = 1.3, SWING_SLIDE = 0.3; // SWING_SLIDE: the most a swing's poses carry him over the ground // closest horse spacing; the striker's near-side lane (z)
// Geometries with material groups (BoxGeometry: one per face) merged into one, grouped by material index so a
// mesh over the same material array draws once per material. (mergeGeometries' own groups are one per source.)
function mergeByMaterial(geos) {
  const merged = mergeGeometries(geos.map((g) => { const c = g.clone(); c.clearGroups(); return c; }));
  const src = merged.index.array, byMat = [];
  let base = 0;
  for (const g of geos) {
    for (const gr of g.groups) { const a = (byMat[gr.materialIndex] ||= []); for (let i = gr.start; i < gr.start + gr.count; i++) a.push(src[base + i]); }
    base += g.index.count;
  }
  const index = [];
  byMat.forEach((a, mi) => { if (a?.length) { merged.addGroup(index.length, a.length, mi); index.push(...a); } });
  merged.setIndex(index);
  for (const g of geos) g.dispose();
  return merged;
}
const ease = (k) => k * k * (3 - 2 * k);
// Wind-ups give a little first and then go (ease-in-back); the way home settles (ease-out).
const easeInBack = (k) => 2.2 * k * k * k - 1.2 * k * k;
const lerp = (a, b, k) => a + (b - a) * k;
// Feedback tiers: hit-stop (s), sparks, flash, knock-back, shake. A miss has none of them.
const TIER = {
// kick: the camera's push along the blow (world units at its peak, see kick()); it replaced the random shake.
  graze:  { stop: 0.03, sparks: 6,  color: '#c8d4e8', flash: 0,    push: 0,    kick: 0 },
  light:  { stop: 0.04, sparks: 8,  color: '#ffe0a0', flash: 0.08, push: 0.08, kick: 0.03 },
  normal: { stop: 0.06, sparks: 16, color: '#ffd070', flash: 0.16, push: 0.22, kick: 0.07 },
  heavy:  { stop: 0.1,  sparks: 34, color: '#ffc050', flash: 0.28, push: 0.5,  kick: 0.24 },
};
// Fallback when a rider has no action strip: lean the single sprite so poses still read a little.
const LEAN = { windup: -0.07, strike: 0.1, follow: 0.04, hurt: -0.12, dodge: -0.09, taunt: -0.05, fall: -0.4 };
// A strip cut from the first sheet only lacks the second sheet's poses; each stands in with the nearest one.
const ALIAS = { walk_1: 'gallop_2', walk_2: 'idle_a', walk_3: 'gallop_3', walk_4: 'idle_b', swing_mid: 'windup', swing_late: 'strike',
  recover: 'follow', feint_ready: 'idle_b', feint_jab: 'strike', feint_back: 'follow', allin_windup: 'windup', allin_strike: 'strike',
  off_balance: 'hurt', hit_light: 'hurt', recoil_step: 'gallop_2',
  // The third sheet (<key>-c: 舍身 run, crushing hit, defeat, triumph; tools/slice_duel_extra.py), for riders who do not
  // have it yet: each falls back to the nearest pose of the first two sheets (and from there as above). The man, horse
  // and weapon alone (man_*, horse_rear, weapon) have no stand-in on a mounted strip; callers check hasPose() first.
  allin_charge_1: 'gallop_1', allin_charge_2: 'gallop_3', allin_leap: 'allin_windup', allin_smear: 'swing_mid', allin_impact: 'allin_strike',
  allin_land: 'recover', hurt_crush: 'hurt', slump: 'off_balance', triumph: 'taunt' };
// The pose a rider actually has for `name`: itself, or its stand-in, followed down the chain.
const resolve = (has, name) => { for (let n = name, i = 0; n && i < 4; n = ALIAS[n], i++) if (has(n)) return n; return null; };

export function createDuelView(T, sprites = {}, audio) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d6c6ae', 24, 75);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 120);
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.6); sun.position.set(-10, 9, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 12, bottom: -12, far: 60 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const back = new THREE.DirectionalLight('#a8c8ff', 0.8); back.position.set(8, 6, -10);
  const hemi = new THREE.HemisphereLight('#f4e8d4', '#5a4c3a', 0.9);
  scene.add(sun, back, hemi);
  const sky = backdrop(scene, { radius: 28, y: -1.6 });
  const shafts = lightShafts(scene, 3, [20, 6]);
  // The war's month and place (setPlace): light, sky and weather; the set is recoloured in buildSet().
  const env = seasonEnv(scene, { sun, back, hemi, sunK: 0.72, hemiK: 0.95, snowH: 0.6, patch: 0.4, ring: [36, 2.2] });
  env.backdrop(sky);
  let place = env.set({ month: 2, city: 12 });

  let set = null, cast = [], riders = [], time = 0, shake = 0, flags = [], crew = [];
  const shakeV = new THREE.Vector3();
  let siegeOf = null; // under the walls (setPlace): { color, look } of the castle's holder
  const cam = { pos: new THREE.Vector3(0, 4, 13), look: new THREE.Vector3(0, 0.6, 0) };
  // The 舍身 build-up darkens the frame's edges (a plane held just in front of the lens, placed in update()).
  const vignette = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false,
    map: canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 12, 32, 32, 46); gr.addColorStop(0, 'rgba(8,4,2,0)'); gr.addColorStop(1, 'rgba(8,4,2,0.85)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }) }));
  vignette.material.map.magFilter = vignette.material.map.minFilter = THREE.LinearFilter; vignette.renderOrder = 999; vignette.frustumCulled = false; scene.add(vignette);
  const dim = (to, ms) => { const o0 = vignette.material.opacity; return tween(ms, (k) => { vignette.material.opacity = lerp(o0, to, ease(k)); }); };
  // Tight DoF is reserved for 舍身 (and deathblows), never for regular swings.
  let pull = 0, pulled = false;
  const spot = (to, ms) => { const p0 = pull; pulled = true; return tween(ms, (k) => { pull = lerp(p0, to, ease(k)); }); };
  // The 舍身 contact's impact frame: both riders pressed to silhouettes for this many rendered frames.
  let silhouette = 0;
  // The camera's kick along a blow: a damped spring (kickX, kickV) pushed by kick(); scaled by the 震屏 setting.
  let kickX = 0, kickV = 0;
  const kick = (dir, s) => { if (fx && s) kickV += dir * s * 15; };
  let cheering = 0; // the side (1 left, -1 right) whose ranks cheer the duel's winner; 0 none

  // ---------- Presentation clock ----------
  // tween() advances only in update(); a hit-stop sets `freeze`, which holds every tween, idle loop and
  // particle in place for that long. abort() finishes everything at once (scene exit).
  // Finer control for heavier blows: `timeScale` slows the whole clock (a slow-motion beat; 1 is normal), and a
  // rider's own `hold` (s, real time) stops only the tweens and idle loop started for him (tween's `who`), so the
  // striker can stop dead on contact while the struck rider still reels.
  const tasks = new Set();
  let freeze = 0, timeScale = 1, aborted = false, lastNow = 0;
  // fx off (setFx(false)) strips sparks, arcs, flashes, shake, dust and numbers so the motion alone can be judged.
  let fx = true;
  function tween(ms, f = () => {}, done, who = null) {
    if (aborted) { f(1); done?.(); return Promise.resolve(); }
    return new Promise((res) => { tasks.add({ e: 0, ms: Math.max(1, ms), f, done, res, who }); f(0); });
  }
  const wait = (ms) => tween(ms);
  // The original's 单挑 sounds (bank24, traced on the ROM: docs/review-assets/2026-11-11/original-audio-trace/duel): every gallop
  // beats 96 once each 32 frames ($CEF0), 牵制's three clashes play 98×3 ($C631), 攻击 swings 97 ($C7BF) and ends on the slash 105
  // ($C8BE), 舍身 leaps on 97 ($CA35) and strikes on 104 ($CB3E): the same on a hit and a miss. Two riders galloping at once share a beat.
  const RIDE_BEAT = 533, CONTACT = { feint: 'sfx-chime', attack: 'sfx-duel-blow', desperate: 'sfx-duel-desperate' };
  let hoofAt = -Infinity;
  const hoof = () => { const t = performance.now(); if (t - hoofAt < 120) return; hoofAt = t; audio?.sfx('sfx-duel-ride'); };
  function tick(dt) {
    for (const R of riders) if (R.hold > 0) R.hold = Math.max(0, R.hold - dt);
    if (timeScale !== 1 && performance.now() >= slowUntil) timeScale = 1;
    if (freeze > 0) { freeze -= dt; return 0; }
    dt *= timeScale;
    for (const t of [...tasks]) {
      if (t.who?.hold > 0) continue;
      t.e += dt * 1000; const k = Math.min(1, t.e / t.ms); t.f(k);
      if (k >= 1) { tasks.delete(t); t.done?.(); t.res(); }
    }
    return dt;
  }
  // A slow-motion beat: the clock runs at `scale` for `ms` of real time (a later beat replaces an earlier one).
  let slowUntil = 0;
  function slow(scale, ms) { timeScale = scale; slowUntil = performance.now() + ms; }
  function abort() {
    aborted = true; freeze = 0; timeScale = 1; silhouette = 0; kickX = kickV = 0; vignette.material.opacity = 0; pull = 0; pulled = false; for (const R of riders) { R.hold = 0; R.trembleT = 0; }
    for (const t of [...tasks]) { tasks.delete(t); try { t.f(1); t.done?.(); } catch {} t.res(); }
  }

  // foeX: the side (-1 left, 1 right) the castle holder's enemy rides in from; the archers face that way.
  function buildSet(terrain, foeX = -1) {
    if (set) scene.remove(set);
    flags = []; crew = [];
    set = new THREE.Group(); scene.add(set);
    const r = rng(terrain * 17 + 3);
    // On the castle's own cell the duel is before its gate, on the open ground outside the walls (as round the
    // 白兵 castle board), not on the paving inside them.
    const siege = siegeOf ?? (terrain === CASTLE ? { color: '#5a5a66', look: 'defender' } : null);
    const top = [T.forestTop, T.sandTop, T.grassTop, T.grassTop, T.rockTop, T.grassTop][terrain];
    const side = [T.grassSide, T.sandSide, T.grassSide, T.grassSide, T.rockSide, T.grassSide][terrain];
    // The ground sits a step below the riders in contrast: a little darker and rougher than the 白兵 field.
    const mats = [side, side, top, side, side, side].map((map) => new THREE.MeshStandardMaterial({ map, roughness: 1, color: '#c8c0b0' }));
    const tile = ['forest', 'sand', 'grass', 'grass', 'rock', 'grass'][terrain];
    const hts = [];
    const cx = (i) => (i - CW / 2 + 0.5) * S, cz = (j) => (j - Z0) * S;
    const blocks = [];
    for (let j = 0; j < CD; j++) for (let i = 0; i < CW; i++) {
      // The fighting lane is flat so hooves stay on one ground line.
      let h = 0.25 + (j >= Z0 - 1 && j <= Z0 + 2 ? 0 : r() < 0.25 ? 0.06 : 0);
      if (j <= 1 && terrain === RIVER) h = 0.02;
      hts[j * CW + i] = h;
      blocks.push(new THREE.BoxGeometry(S, h + 1, S).translate(cx(i), (h - 1) / 2, cz(j)));
    }
    // All the blocks are one mesh with one group per face material: as a mesh each (476, six faces apiece) they
    // were ~4,500 draw calls between the picture and the shadow map, ~2.5 ms of CPU a frame (PERF, 2026-11-09).
    const ground = new THREE.Mesh(mergeByMaterial(blocks), mats);
    ground.castShadow = ground.receiveShadow = true; ground.userData.tile = tile; set.add(ground);
    // Beyond the blocks the same ground runs on flat to the horizon, so no framing (the wide opening, a narrow
    // window's pull-back) ever looks over the stage's edge.
    const far = top.clone(); far.userData = top.userData; far.wrapS = far.wrapT = THREE.RepeatWrapping; far.repeat.set(150, 75); far.needsUpdate = true;
    // By a river it stops at the near bank (z -2.8): open water runs from there back to the far bank's strip.
    const near = terrain === RIVER && !siege ? -2.8 : -26;
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(120, 34 - near), new THREE.MeshStandardMaterial({ map: far, roughness: 1, color: '#c8c0b0' }));
    skirt.rotation.x = -Math.PI / 2; skirt.position.set(0, 0.22, (34 + near) / 2); skirt.receiveShadow = true; skirt.userData.tile = tile; set.add(skirt);
    const hAt = (i, j) => (i < 0 || j < 0 || i >= CW || j >= CD ? null : hts[j * CW + i]);
    const cells = []; for (let j = 0; j < CD; j++) for (let i = 0; i < CW; i++) cells.push({ x: i, y: j });
    edgeOcclusion(set, cells, hAt, cx, cz);
    if (terrain === RIVER) {
      const wide = siege ? CW * S : 120, deep = siege ? 2 * S : -2.8 - BACK + 0.4, wz = siege ? cz(0.5) : (-2.8 + BACK - 0.4) / 2;
      const map = T.water.clone(); map.userData = T.water.userData; map.repeat.set(wide / (CW * S), deep / (2 * S)); map.needsUpdate = true;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(wide, deep), new THREE.MeshStandardMaterial({ map, transparent: true, opacity: 0.85, roughness: 0.4, emissive: '#1a3a5a', emissiveIntensity: 0.2 }));
      w.rotation.x = -Math.PI / 2; w.position.set(0, 0.16, wz); w.userData.water = true; set.add(w);
    }
    if (terrain !== MOUNT && terrain !== 1 && !siege) {
      const trees = terrain === FOREST ? 20 : 7;
      for (let i = 0; i < trees; i++) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.95), skyLit(new THREE.MeshStandardMaterial({ map: treeTex(i * 13 + terrain), alphaTest: 0.5, side: THREE.DoubleSide, color: '#b8b8a8' })));
        // Clear of the band behind the riders (|x| < 4.5) outside a forest, so no trunk cuts a duelist's outline.
        let x = (r() - 0.5) * CW * S; if (terrain !== FOREST && Math.abs(x) < 4.5) x = Math.sign(x || 1) * (4.5 + r() * 4);
        t.position.set(x, 0.25 + 0.97, cz(terrain === RIVER ? 2 : 0) - r() * 0.6); t.castShadow = true; t.userData.foliage = 'leaf'; set.add(t);
      }
    }
    // Tufts stay out of the riders' lane so they never cut across the hooves.
    const tufts = [];
    if (terrain !== 1) for (let i = 0; i < 130; i++) { const z = -3.8 + r() * 11; if (z < -0.1 || z > 2) tufts.push([(r() - 0.5) * CW * S, 0.25, z]); }
    scatterTufts(set, tufts, terrain + 5);
    seasonalize(set, place);
    const mine = set, add = (g) => { if (set === mine && g) set.add(g); };
    if (siege) cityWall(siege, place.plate === 'winter', foeX).then(add);
    else farSide(['forest', 'sand', 'plain', 'river', 'mount'][terrain], r, place.plate === 'winter').then(add);
  }

  // ---------- The city wall (siege) ----------
  // Painted front elevations on cards along the back of the stage: the gate sheet in the middle, the tileable
  // wall sheet run out to both sides at the same scale. Archers stand on the walkway BEHIND the card, so the
  // painted parapet hides their legs and they show between and over the merlons; banners in the holder's
  // colour fly from the parapet. Sheets load once and are reused; the snow pair in a northern winter.
  const WALL_H = 3.2; // world height of the wall, foot to merlon top (it stands well back, so it reads taller)
  const sheets = new Map();
  let wallMeta = null;
  const loader = new THREE.TextureLoader();
  function sheet(name, dir = 'citygate') {
    if (!sheets.has(name)) sheets.set(name, loader.loadAsync(`assets/ai/${dir}/${name}.webp`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.anisotropy = 4; return t;
    }).catch(() => null));
    return sheets.get(name);
  }
  async function cityWall({ color, look }, snow, foeX) {
    wallMeta ||= fetch('assets/ai/citygate/index.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    const meta = await wallMeta, sfx = snow && meta['gate-snow'] ? '-snow' : '', G = meta[`gate${sfx}`], Wm = meta[`wall${sfx}`];
    if (!G || !Wm) return null;
    const [gt, wt] = await Promise.all([sheet(`gate${sfx}`), sheet(`wall${sfx}`)]);
    if (!gt || !wt) return null;
    const u = WALL_H / (G.size[1] - G.top), y0 = 0.22, g = new THREE.Group();
    const card = (tex, w, h, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), skyLit(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, color: '#e6ded2' })));
      m.position.set(x, y0 + h / 2, z); m.receiveShadow = true; m.userData.noSeason = true; g.add(m); return m;
    };
    const gw = G.size[0] * u, gh = G.size[1] * u, ww = Wm.size[0] * u, wh = Wm.size[1] * u;
    card(gt, gw, gh, 0, BACK);
    // Wall runs: a hair of overlap under the gate sheet's cut edges, slightly behind it so the gate wins.
    for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) card(wt, ww, wh, sx * (gw / 2 + ww / 2 + k * ww - 0.04 - k * 0.02), BACK - 0.02);
    // Archers on the walkway between the gate tower and the frame's edge, a few to each side.
    const walk = y0 + (G.size[1] - G.crenel) * u - 0.05 * WALL_H, r = rng(5), tower = G.tower ? [(G.tower[0] - G.size[0] / 2) * u, (G.tower[1] - G.size[0] / 2) * u] : [-2, 2];
    const tex = sprites[`${look}-archer`] || unitTex(look, 'archer'), ah = 0.22 * WALL_H, aw = (ah * tex.image.width) / tex.image.height;
    for (const sx of [-1, 1]) for (let i = 0; i < 10; i++) {
      const x = sx < 0 ? tower[0] - 0.7 - i * 0.95 - r() * 0.25 : tower[1] + 0.7 + i * 0.95 + r() * 0.25;
      const m = billboard(tex, aw, ah, foeX < 0);
      m.material.color.set('#e0d8cc'); m.castShadow = false; m.userData.noSeason = true;
      const y = walk + ah / 2; m.position.set(x, y, BACK - 0.35); m.userData = { y0: y, phase: r() * 6, noSeason: true }; g.add(m); crew.push(m);
    }
    // Banners in the holder's colour on the poles painted along the parapet, and one on each wall run.
    const c = new THREE.Color(color), dark = '#' + c.clone().multiplyScalar(0.6).getHexString(), lit = '#' + c.clone().lerp(new THREE.Color('#ffffff'), 0.25).getHexString();
    // A tall banner with a gold-edged swallowtail foot, a shade darker down the fly edge.
    const flagTex = canvasTex(12, 24, (q) => {
      q.clearRect(0, 0, 12, 24); q.fillStyle = lit; q.fillRect(0, 0, 12, 18); q.fillStyle = dark; q.fillRect(9, 0, 3, 18);
      for (let y = 18; y < 24; y++) { const k = y - 18; q.fillStyle = lit; q.fillRect(0, y, 5 - k, 1); q.fillRect(7 + k, y, 5 - k, 1); }
      q.fillStyle = '#d8b050'; q.fillRect(0, 0, 12, 1); q.fillRect(0, 0, 1, 24);
    });
    const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 1, alphaTest: 0.5 });
    const pole = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1 });
    const top = y0 + WALL_H;
    const poles = G.poles?.length ? G.poles.map((px) => (px - G.size[0] / 2) * u) : [tower[0] - 0.3, tower[1] + 0.3];
    for (const x of [...poles, -gw / 2 - ww * 0.5, gw / 2 + ww * 0.5]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), pole); p.position.set(x, top + 0.45, BACK - 0.15); g.add(p);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0, 6, 1), flagMat);
      f.geometry.translate(0.25, 0, 0); f.position.set(x, top + 0.74, BACK - 0.15); f.userData.base = f.geometry.attributes.position.array.slice(); g.add(f); flags.push(f);
    }
    return g;
  }

  // ---------- The far side of the field (open ground) ----------
  // A painted strip for the terrain (tools/gen_duelsets_codex.sh → build_duelsets.py): the hamlet and poplars of
  // a plain, a forest's edge, a river's far bank, a pass's cliffs, a loess wasteland. Tiled along the back of
  // the stage from a random start, every other tile mirrored where its edges do not loop. Its greens take the
  // month's colours from seasons.js, as the grass in front of it does; where snow lies it is the painted winter
  // twin instead (the shader's snow would only dither over the painting).
  let setMeta = null;
  async function farSide(base, r, snow) {
    setMeta ||= fetch('assets/ai/duelsets/index.json', { cache: 'no-store' }).then((res) => res.json()).catch(() => ({}));
    const all = await setMeta, name = snow && all[`${base}-snow`] ? `${base}-snow` : base;
    const M = all[name], tex = M && (await sheet(name, 'duelsets'));
    if (!tex) return null;
    const w = M.size[0] / M.unit, h = M.size[1] / M.unit, g = new THREE.Group(), x0 = -r() * w, y0 = base === 'river' ? 0.16 : 0.22;
    const mat = skyLit(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, color: '#e6ded2' }));
    // One mesh for the whole run: seasons.js picks its tint and snow per object, so tiles never differ.
    // A sheet with one landmark (meta.filler: the share of its width, from the left, that is free of it) shows
    // it once every third tile; the tiles between are that free stretch and its mirror image, which meet the
    // sheet's own edges and each other seamlessly.
    const tiles = [], quad = (x, wd, u0, u1) => {
      const geo = new THREE.PlaneGeometry(wd + 0.01, h).translate(x + wd / 2, 0, 0), uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
      tiles.push(geo);
    };
    const f = M.filler, step = (k) => (f && k % 3 ? 2 * f * w : w);
    let x = x0 - w / 2;
    for (let k = -1; k >= -4; k--) x -= step(k);
    for (let k = -4; k <= 4; k++) {
      if (f && k % 3) { quad(x, f * w, 0, f); quad(x + f * w, f * w, f, 0); }
      else if (M.seam === 'mirror' && k % 2) quad(x, w, 1, 0);
      else quad(x, w, 0, 1);
      x += step(k);
    }
    const m = new THREE.Mesh(mergeGeometries(tiles), mat); m.position.set(0, y0 + h / 2, BACK); m.receiveShadow = true; m.userData = name === base ? { foliage: 'grass' } : { noSeason: true }; g.add(m);
    seasonalize(g, place);
    return g;
  }

  function billboard(tex, w, h, flip) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), skyLit(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0 })));
    m.scale.x = flip ? -1 : 1; m.castShadow = true; return m;
  }
  function rank(side, count, dir) {
    const gen = sprites[`${side}-soldier`], tex = gen || unitTex(side, 'soldier'), out = [], r = rng(count * 7 + dir);
    const sh = gen ? 0.72 : 0.57, sw = gen ? (0.72 * tex.image.width) / tex.image.height : 0.62;
    for (let i = 0; i < count; i++) {
      const row = i % 3, col = Math.floor(i / 3);
      const m = billboard(tex, sw, sh, dir < 0);
      m.material.color.set('#d8d0c4'); // the ranks stay a step behind the duelists
      const x = -dir * (6.0 + col * 0.55 + r() * 0.15), z = -1.9 + row * 0.55 + r() * 0.15, y0 = 0.25 + sh / 2;
      m.position.set(x, y0, z); m.userData = { y0, phase: r() * 6, side: dir };
      scene.add(m); out.push(m);
    }
    return out;
  }

  // ---------- Riders ----------
  // A rider is a group on the hoof line. With an action strip its plane shows one cell at a time,
  // offset so the horse's barrel (the strip's anchor) stays on the group origin in every frame.
  function framePlane(A, unit = unitOf(A.meta)) {
    const { meta } = A, n = meta.frames.length, [cw, ch] = meta.cell;
    const tex = A.tex.clone(); tex.repeat.set(1 / n, 1); tex.needsUpdate = true;
    const body = billboard(tex, cw * unit, ch * unit, false);
    body.position.y = (ch * unit) / 2; body.userData.ax = (cw / 2 - meta.anchor) * unit;
    return { body, unit };
  }
  // weapon: the equipment he holds; an officer without strips of his own rides as his side's generic general with that weapon class
  // (core/pack.js genericArt), or with the glaive when that set is not there.
  function rider(id, look, dir, weapon) {
    // A star officer without his own strip keeps his own sprite rather than borrowing the generic rider.
    const strip = sprites[`duel-${id}`] || sprites[`duel-${genericArt(look, weapon)}`] || sprites[`duel-${look}`];
    const g = new THREE.Group(), A = sprites[`duel-${id}`] || (sprites[`officer-${id}`] ? null : strip);
    let body, unit = 1, meta = null;
    // Cards beside the side strip for the wheel: head-on and from behind (<key>-turn, never mirrored) and the
    // three-quarter views between (<key>-wheel, drawn with his head to the right and mirrored by setCard).
    const cards = [];
    if (A) {
      ({ body, unit } = framePlane(A), meta = A.meta);
      for (const S of [A.turn, A.wheel]) if (S) { const c = { body: framePlane(S, unit).body, meta: S.meta }; c.body.position.x = c.body.userData.ax; c.body.visible = false; cards.push(c); g.add(c.body); }
      // The third sheet is drawn facing right like the side strip and turns with him (show()); each of its frames
      // stands on its own ground line, meta.base px above the frame's bottom edge, so the frame sinks by that much.
      for (const S of [A.extra, A.spin, A.leap]) if (S) { const c = { body: framePlane(S, unit).body, meta: S.meta, follows: true }; c.body.userData.y0 = c.body.position.y; c.body.visible = false; cards.push(c); g.add(c.body); }
    } else {
      const own = sprites[`officer-${id}`], tex = own || sprites[look] || unitTex(look), img = tex.image, hh = own ? HERO_H : HERO_H * 0.9;
      body = billboard(tex, (hh * img.width) / img.height, hh, false); body.position.y = hh / 2; body.userData.ax = 0;
    }
    // A ground ring in the side's colour (as on the 白兵 field) under a soft contact shadow.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.9, 32), new THREE.MeshBasicMaterial({ color: look === 'attacker' ? '#3f9cff' : '#ff6a4a', transparent: true, opacity: 0.35, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; ring.scale.y = 0.45;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.y = 0.4;
    g.add(body, shadow, ring);
    g.position.set(-dir * 9, 0.25, dir > 0 ? 1.0 : 0.82); scene.add(g);
    const R = { g, body, dir, id, look, strip, meta, unit, cards, shadow, face: dir, home: 0, loop: 'idle', loopT: Math.random() * 600, stride: 0, flash: 0, ring, react: null, hold: 0 };
    setFace(R, dir); show(R, 'idle_a');
    return R;
  }
  function setFace(R, f, width = 1) { R.face = f; R.body.scale.x = f * width; R.body.position.x = R.body.userData.ax * f * width; }
  const hasFrame = (R, name) => !!R.meta?.frames.includes(name);
  const cardOf = (R, name) => R.cards.find((c) => c.meta.frames.includes(name));
  // Whether he has this pose drawn (on the side strip or a card), without falling back to a stand-in.
  const hasPose = (R, name) => hasFrame(R, name) || !!cardOf(R, name);
  // The meta (strip or card) a pose is drawn on, and its tip for that pose, after following the stand-ins.
  const poseMeta = (R, name) => { const n = resolve((x) => hasPose(R, x), name); return n ? [n, cardOf(R, n)?.meta || R.meta] : [null, R.meta]; };
  function show(R, name) {
    R.frame = name;
    const n = R.meta ? resolve((x) => hasPose(R, x), name) ?? name : name, card = cardOf(R, n);
    for (const c of R.cards) c.body.visible = c === card;
    R.body.visible = !card;
    if (card) {
      card.body.material.map.offset.x = card.meta.frames.indexOf(n) / card.meta.frames.length;
      if (card.follows) {
        card.body.scale.x = R.face; card.body.position.x = card.body.userData.ax * R.face;
        card.body.position.y = card.body.userData.y0 - (card.meta.base?.[n] || 0) * R.unit;
      }
      return;
    }
    if (!R.meta) { R.body.rotation.z = R.face * (LEAN[name] ?? LEAN[ALIAS[name]] ?? 0); return; }
    const i = R.meta.frames.indexOf(n);
    if (i >= 0) R.body.material.map.offset.x = i / R.meta.frames.length;
  }
  const clip = (R, name) => R.meta?.clips[name] || DEFAULT_CLIPS[name];
  // The idle breath runs in update(); a clip or a ride takes the rider over until it ends.
  function runLoop(R, dt) {
    if (!R.loop) return;
    const c = clip(R, R.loop), total = c.reduce((a, f) => a + f[1], 0);
    R.loopT = (R.loopT + dt * 1000) % total;
    let t = R.loopT; for (const [f, ms] of c) { if (t < ms) { if (R.frame !== f) show(R, f); break; } t -= ms; }
  }
  async function play(R, name, onEvent) {
    R.loop = null;
    for (const [f, ms, ev] of clip(R, name)) { show(R, f); await wait(ms); if (ev) onEvent?.(ev); }
    R.loop = 'idle'; show(R, 'idle_a');
  }
  // Ride to x at a steady speed: a gallop when fast, a four-beat walk when slow. The frame advances with
  // the ground covered, so the hooves carry the move at any speed. He stops square on four hooves.
  async function ride(R, x, speed = GALLOP, gait = speed > 2.5 ? 'gallop' : 'walk', quiet = false) {
    const x0 = R.g.position.x, d = Math.abs(x - x0);
    if (d < 0.01) { R.loop = 'idle'; show(R, 'idle_a'); return; }
    const frames = clip(R, gait).map((f) => f[0]), n = frames.length;
    R.loop = null;
    let lastDust = 0, beats = 0;
    const ms = (d / speed) * 1000;
    await tween(ms, (k) => {
      if (!quiet && k * ms >= beats * RIDE_BEAT) { beats++; hoof(); }
      R.g.position.x = lerp(x0, x, k);
      const at = (R.stride + d * k) / STEP[gait], step = Math.floor(at);
      show(R, frames[step % n]);
      // He rides the stride: the whole figure rises a pixel or two off each footfall and settles onto the next.
      R.g.position.y = 0.25 + R.unit * (gait === 'walk' ? 1 : 2) * Math.sin(Math.PI * (at % 1));
      if (gait !== 'walk' && fx && k - lastDust > 0.25) { lastDust = k; dustPuff(scene, R.g.position.clone().setY(0.35), 0.5, tween); }
    });
    R.stride = (R.stride + d) % (STEP[gait] * n); R.g.position.y = 0.25;
    R.loop = gait === 'loose' ? null : 'idle'; if (gait !== 'loose') show(R, 'idle_a');
  }
  // Wheel the horse round to face the other way along a half circle on the ground: via 'front' he turns toward
  // the camera and we see the horse's head on as he comes round; via 'back' away from it, showing the rump. He
  // keeps moving through it: side, three-quarter, head-on, the other three-quarter, the other side, with the legs
  // stepping, the ground shadow narrowing head-on and the arc carrying him on to x, z. A rider without those
  // strips goes edge-on at the middle of the turn instead.
  async function wheel(R, via, { x = R.g.position.x, gait = 'walk', z = R.g.position.z + (via === 'front' ? 1 : -1) * WHEEL[gait].z } = {}) {
    const { ms } = WHEEL[gait], x0 = R.g.position.x, z0 = R.g.position.z, f0 = R.face, sway = f0 * Math.abs(z - z0) * 0.5;
    const names = (re) => R.cards.flatMap((c) => c.meta.frames.filter((f) => re.test(f)));
    const side = clip(R, gait).map((f) => f[0]);
    const quarter = names(gait === 'loose' ? /^loose_quarter/ : gait === 'gallop' ? /^quarter_flee/ : new RegExp(`^quarter_${via}`));
    const on = names(gait === 'loose' ? /^loose_front/ : new RegExp(`^${via}_walk_1`)), painted = quarter.length && on.length;
    const pick = (list, k) => list[Math.floor(k * 8) % list.length];
    R.loop = null;
    await tween(ms, (k) => {
      const th = Math.PI * k, across = Math.sin(th), f = k < 0.5 ? f0 : -f0;
      R.g.position.x = lerp(x0, x, ease(k)) + sway * across;
      R.g.position.z = lerp(z0, z, (1 - Math.cos(th)) / 2);
      R.shadow.scale.x = 1 - 0.5 * across;
      if (!painted) { setFace(R, f, Math.max(0.06, Math.abs(Math.cos(th)))); show(R, pick(side, k)); return; }
      if (k >= 0.38 && k < 0.62) show(R, pick(on, k));
      else if (k >= 0.14 && k < 0.86) { const name = pick(quarter, k), c = cardOf(R, name); c.body.scale.x = f; c.body.position.x = c.body.userData.ax * f; show(R, name); }
      else { setFace(R, f); show(R, pick(side, k)); }
    });
    setFace(R, -f0); R.shadow.scale.x = 1;
  }
  // Back to his mark after a blow: he reins the horse back the step or two he drove in, still facing the foe,
  // quick at first and settling, back into his own lane.
  async function reinBack(R, z) {
    const x0 = R.g.position.x, z0 = R.g.position.z, d = Math.abs(R.home - x0);
    R.loop = null;
    if (d > 0.02 || Math.abs(z - z0) > 0.02) {
      show(R, 'recoil_step'); hoof();
      await tween(Math.min(460, 180 + d * 240), (k) => {
        const e = 1 - (1 - k) * (1 - k);
        R.g.position.x = lerp(x0, R.home, e); R.g.position.z = lerp(z0, z, e);
        if (k > 0.62 && R.frame !== 'idle_b') show(R, 'idle_b');
      });
    }
    R.loop = 'idle'; show(R, 'idle_a');
  }
  // The weapon tip of a pose (px from the horse anchor and above the ground line), on whichever strip or card draws it.
  const tipPx = (R, frame) => { const [n, m] = poseMeta(R, frame); return (n && m?.tips?.[n]) || R.meta?.tips.strike; };
  const tipOf = (R, frame = 'strike') => {
    const t = tipPx(R, frame), tx = t ? t[0] * R.unit : 1.3, ty = t ? t[1] * R.unit : 1.5;
    return new THREE.Vector3(R.g.position.x + R.face * tx, R.g.position.y + ty, 1.35);
  };
  const reach = (R, frame = 'strike') => { const t = tipPx(R, frame); return t ? t[0] * R.unit : 1.3; };

  function popup(text, at, cls) {
    if (!fx) return;
    const el = document.createElement('div'); el.className = `dmg ${cls}`; el.textContent = text;
    const o = new CSS2DObject(el); o.position.copy(at); scene.add(o);
    tween(1000, (k) => { o.position.y = at.y + ease(k) * 0.7; el.style.opacity = String(k < 0.7 ? 1 : (1 - k) / 0.3); }, () => { el.remove(); scene.remove(o); });
  }
  const head = (R, y = 2.75) => new THREE.Vector3(R.g.position.x, y, 1.3);
  async function moveCam(pos, look, ms) {
    const p0 = cam.pos.clone(), l0 = cam.look.clone();
    await tween(ms, (k) => { const e = ease(k); cam.pos.lerpVectors(p0, pos, e); cam.look.lerpVectors(l0, look, e); });
  }
  // The framing for the exchange: side-on and wide, the riders about a quarter of the frame tall with both
  // ranks and the place (the wall, the tree line) behind them.
  const SHOT = { pos: new THREE.Vector3(0, 3.1, 14.6), look: new THREE.Vector3(0, 1.55, 0.6) };
  // Opening: high and far, the whole set in view, craning down to SHOT while the generals ride in.
  const OPEN = { pos: new THREE.Vector3(-2.5, 7.2, 24), look: new THREE.Vector3(0, 3.2, -2) };
  // A close two-shot centred on x (the old medium shot), for a heavy blow or a death.
  const close = (x) => ({ pos: new THREE.Vector3(x * 0.7, 2.2, 10.4), look: new THREE.Vector3(x * 0.7, 1.2, 0.9) });
  let cutIn = 0;
  // A heavy blow cuts in on the contact, holds a beat, then eases back out to the wide shot.
  async function punchIn(x) {
    const my = ++cutIn, c = close(x);
    await moveCam(c.pos, c.look, 140);
    await wait(520);
    if (my === cutIn) await moveCam(SHOT.pos, SHOT.look, 650);
  }
  const byId = (id) => riders.find((R) => R.id === id);
  const foeOf = (R) => riders.find((x) => x !== R);

  // Contact: everything the blow causes happens here, once — the struck rider's hurt pose and recoil
  // start on this same event (react: false when the caller stages the reaction itself).
  function impact(me, foe, a, tier, ctx, frame = 'strike', react = true) {
    const T0 = TIER[tier], w = me.meta?.weapon || 'blade';
    const short = w === 'sword' || w === 'fan'; // 诸葛亮's feather fan cuts like a sword
    // The hit-stop holds the striker on the blow (swing() waits it out) while the struck rider takes it at once and
    // trembles; only a 舍身 (allIn) and the deathblow stop the whole scene.
    const deathblow = (ctx.hp?.[foe.id] ?? 1) <= 0;
    if (deathblow) { freeze = Math.max(T0.stop, 0.14); if (fx && shakeLevel() > 0) silhouette = 1; }
    foe.trembleT = deathblow ? freeze : T0.stop;
    const p = tipOf(me, frame); p.x = me.dir > 0 ? Math.min(p.x, foe.g.position.x + 0.2) : Math.max(p.x, foe.g.position.x - 0.2);
    p.y = Math.min(Math.max(p.y, 1.2), 2.1);
    if (fx && tier !== 'graze') {
      if (w === 'spear') thrust(scene, p, me.dir < 0, tier === 'heavy' ? 2.2 : 1.5, tween);
      else slash(scene, p, me.dir < 0, short ? (tier === 'heavy' ? 1.3 : 0.9) : tier === 'heavy' ? 1.9 : tier === 'light' ? 1.0 : 1.4, tween, short ? 0.9 : 0.55);
    }
    if (fx) sparkBurst(scene, p, T0.sparks, T0.color, tween);
    kick(me.dir, deathblow ? Math.max(T0.kick, 0.14) : T0.kick);
    if (tier === 'heavy' && fx) punchIn(p.x);
    if (fx) { foe.flash = T0.flash; foe.hurtT = T0.flash ? 1 : 0; }
    popup(a.dmg > 0 ? `-${a.dmg}` : '0', head(foe), `${foe.look} ${tier}`);
    if (react && T0.push) foe.react = recoil(foe, tier);
    ctx.onHit?.(foe.id, a.dmg, tier);
    return deathblow ? 0 : T0.stop;
  }
  // Recoil: the rider takes the force first (hurt pose at contact), then the horse steps back under
  // him and he settles. A 牵制 only makes him flinch; a 舍身 throws him hardest. He walks back to his
  // mark once the attacker has drawn off (swing()), so the two horses do not grind past each other.
  async function recoil(R, tier) {
    const T0 = TIER[tier], x0 = R.g.position.x, back = x0 - R.face * T0.push;
    const c = clip(R, tier === 'light' ? 'hurt_light' : tier === 'heavy' ? 'hurt_heavy' : 'hurt');
    R.loop = null; show(R, c[0][0]);
    await tween(c[0][1], (k) => { R.g.position.x = lerp(x0, back, ease(k)); });
    for (const [f, ms] of c.slice(1)) { show(R, f); await wait(ms); }
    R.loop = 'idle'; show(R, 'idle_a');
  }
  async function swing(me, foe, a, ctx) {
    const cmd = a.cmd, dir = me.dir;
    const tier = a.dmg > 0 ? (cmd === 'feint' ? 'light' : cmd === 'desperate' ? 'heavy' : 'normal') : a.hit ? 'graze' : null;
    const c = (cmd === 'desperate' && !a.hit && hasFrame(me, 'off_balance') && clip(me, 'desperate_miss')) || clip(me, cmd);
    const hitAt = c.findIndex((f) => f[2] === 'hit'), goAt = c.findIndex((f) => f[2] === 'go' || f[2] === 'hit'), hitFrame = c[hitAt][0];
    // Contact lands on the foe's rider; a 牵制 only reaches his horse's chest, a 舍身 drives in deep.
    const depth = cmd === 'feint' ? -0.3 : cmd === 'desperate' ? 0.25 : 0.05;
    // Horses never close nearer than head-to-chest; a short sword reaches less far than a glaive.
    const strikeX = foe.g.position.x - dir * Math.max(MIN_GAP, reach(me, hitFrame) - depth), preX = strikeX - dir * (cmd === 'feint' ? 0.3 : 0.65);
    const z0 = me.g.position.z;
    // From his mark the drive in starts where he stands (a ride up of half a stride is a twitch and a puff of
    // dust); he rides up first only from further off than the marks ever are.
    if ((preX - me.g.position.x) * dir > 1.2) await ride(me, preX);
    me.loop = null; foe.react = null;
    let lunge = null;
    for (const [i, [f, ms, ev]] of c.entries()) {
      show(me, f);
      if (i === 0) hoof(); // he puts the horse in
      if (i === goAt && cmd !== 'feint') audio?.sfx('sfx-duel-swing');
      const x0 = me.g.position.x;
      // 攻击 holds its wind-up longer (250 ms, the original takes its time over the swing); it gives a little first.
      if (i < goAt && /windup|ready/.test(f)) await tween(cmd === 'attack' && i === 0 ? Math.max(ms, 250) : ms, (k) => { me.g.position.x = x0 - dir * (cmd === 'desperate' ? 0.3 : cmd === 'feint' ? 0.05 : 0.12) * easeInBack(k); });
      else if (i >= goAt && i <= hitAt) {
        if (i === goAt && Math.abs(strikeX - x0) > SWING_SLIDE + 0.05) {
          // The ground between the marks is covered at a gallop stride, not by sliding the swing's poses: the
          // swing itself moves him only the last SWING_SLIDE.
          const xa = x0, xb = strikeX - dir * SWING_SLIDE, d = Math.abs(xb - xa);
          await tween(Math.max(70, (d / DRIVE) * 1000), (k) => {
            me.g.position.x = lerp(xa, xb, k); me.g.position.z = lerp(z0, LANE, k * 0.7);
            show(me, k < 0.5 ? 'gallop_2' : 'gallop_3');
          });
          show(me, f);
        }
        if (i === goAt) {
          const x0 = me.g.position.x, zs = me.g.position.z;
          // The lunge spans the swing's poses from the first 'go' frame to the contact frame.
          const ms2 = c.slice(goAt, hitAt + 1).reduce((t, x) => t + x[1], 0), dodge = !a.hit ? foe : null, fx0 = foe.g.position.x;
          if (dodge) { show(foe, 'dodge'); foe.loop = null; }
          // …and takes at least the time the ground needs: a longer drive in holds the last pose until it lands.
          lunge = tween(Math.max(ms2, (Math.abs(strikeX - x0) / DRIVE) * 1000), (k) => {
            me.g.position.x = lerp(x0, strikeX, ease(k)); me.g.position.z = lerp(zs, LANE, ease(k)); // the lunge passes on the near side
            if (dodge) foe.g.position.x = fx0 + dir * 0.7 * ease(k);
          });
        }
        await wait(ms);
        if (i === hitAt) {
          await lunge;
          audio?.sfx(CONTACT[cmd]);
          if (tier) { const stop = impact(me, foe, a, tier, ctx, f); if (stop) { me.loop = null; await wait(stop * 1000); } }
          else {
            popup('落空', head(foe), `${foe.look} miss`);
            foe.react = wait(200).then(() => { foe.loop = 'idle'; show(foe, 'idle_a'); });
            if (a.self) {
              // 舍身 that misses leaves him over-extended: the self-inflicted cost lands as he loses balance.
              wait(120).then(() => { popup(`反噬 -${a.self}`, head(me, 2.5), `${me.look} self`); if (fx) me.flash = 0.12; ctx.onSelf?.(me.id, a.self); });
            }
          }
        }
      } else await wait(ms);
    }
    if (a.self && !c.some((f) => f[0] === 'off_balance')) await play(me, 'stagger');
    const home = reinBack(me, z0);
    await foe.react;
    foe.react = null;
    await Promise.all([home, ride(foe, foe.home, WALK)]);
    await wait(120);
  }
  // 舍身 (docs/单挑舍身败北与手感方案_2026-11-13.md §2.2, the high leap since 0.4.3: docs/单挑动作全面优化_交接_2026-11-21.md):
  // he reins back half a length while the foe walks up to meet him, charges, rockets high over the foe's head, hangs at
  // the apex and dives down on him. The sounds keep the original's order (96 rein back, 96 charge, 97 leap, 104 contact).
  //   0–260 rein back (allin_windup) · 260–450 charge (allin_charge_1/2 by ground covered) · 450–690 up (leap_up) ·
  //   690–870 apex hang (leap_apex) · 870–1020 the dive with a fading trail (leap_dive) · contact (leap_slam), a
  //   one-frame silhouette, a 180 ms stop with the struck rider trembling, then 300 ms at 0.35× while he is driven back.
  // A miss: the foe sidesteps at the apex and he lands over-extended (leap_miss), paying the cost.
  // A rider without the leap poses plays it on the stand-ins (allin_leap, allin_smear, allin_impact; ALIAS).
  const ALLIN = { back: 260, charge: 190, stop: 0.18, gap: 2.0 };
  function ghost(R) {
    const src = R.cards.find((c) => c.body.visible)?.body || R.body, m = src.clone(), mat = src.material.clone();
    mat.map = src.material.map.clone(); mat.map.needsUpdate = true; // its own frame offset: the rider moves on to the next pose
    Object.assign(mat, { transparent: true, depthWrite: false, opacity: 0.42, alphaTest: 0.05, emissiveIntensity: 0 });
    m.material = mat; m.castShadow = false; m.position.add(R.g.position); scene.add(m);
    tween(280, (k) => { mat.opacity = 0.42 * (1 - k); }, () => { scene.remove(m); mat.map.dispose(); mat.dispose(); });
  }
  // The leap's height (world units above his stand): the frame rises, the shadow and ring stay on the ground.
  function lift(R, h) {
    const s = Math.max(0.28, 1 - h * 0.32);
    R.g.position.y = 0.25 + h; R.shadow.position.y = 0.01 - h; R.ring.position.y = 0.012 - h;
    R.shadow.scale.set(s, 0.4 * s, 1);
  }
  // Struck by a 舍身: the horse sits back on its haunches and he is driven a full length back.
  async function crush(R) {
    const x0 = R.g.position.x, back = x0 - R.face * 1.0;
    R.loop = null; show(R, 'hurt_crush');
    await tween(300, (k) => { R.g.position.x = lerp(x0, back, 1 - (1 - k) * (1 - k)); });
    await wait(220); show(R, 'recoil_step'); await wait(200);
    R.loop = 'idle'; show(R, 'idle_a');
  }
  async function allIn(me, foe, a, ctx) {
    const dir = me.dir, x0 = me.g.position.x, z0 = me.g.position.z;
    const tier = a.dmg > 0 ? 'heavy' : a.hit ? 'graze' : null;
    const foeMeet = foe.home - dir * 0.45;
    // He comes down a little short of a normal blow's spacing (MIN_GAP): the third sheet's leap and impact draw the
    // horse at full stretch, so nearer than this its head runs into the foe's before the blow lands.
    const strikeX = foeMeet - dir * Math.max(ALLIN.gap, reach(me, 'allin_impact') - 0.25);
    const endX = a.hit ? strikeX : strikeX + dir * 0.3; // a miss carries him on, into the ground the foe has left
    const backX = x0 - dir * 0.6, run = endX - backX, xb = backX + run * 0.42, xc = backX + run * 0.9;
    me.loop = null; foe.react = null; cutIn++;
    // 蓄势: rein back, the shot closes in a little and its edges darken.
    show(me, 'allin_windup'); hoof();
    popup('舍身', head(me, 3.0), `${me.look} allin`);
    if (fx) { dim(0.68, ALLIN.back); spot(1, ALLIN.back); }
    moveCam(SHOT.pos.clone().lerp(SHOT.look, 0.06), SHOT.look.clone(), ALLIN.back + ALLIN.charge);
    const foeStep = ride(foe, foeMeet, WALK * 1.6, 'walk', true).then(() => { foe.loop = null; show(foe, 'feint_ready'); });
    await tween(ALLIN.back, (k) => { me.g.position.x = lerp(x0, backX, 1 - (1 - k) * (1 - k)); });
    // 助跑
    hoof();
    let lastDust = 0;
    await Promise.all([foeStep, tween(ALLIN.charge, (k) => {
      const x = lerp(backX, xb, k * k); me.g.position.x = x; me.g.position.z = lerp(z0, LANE, k * 0.4);
      show(me, Math.floor(Math.abs(x - backX) / 0.3) % 2 ? 'allin_charge_2' : 'allin_charge_1');
      if (fx && k - lastDust > 0.45) { lastDust = k; dustPuff(scene, me.g.position.clone().setY(0.35), 0.55, tween); }
    })]);
    // 起跳
    audio?.sfx('sfx-duel-swing');
    // Exaggerated FC-style high leap: rocket high above the foe's head, hang briefly at the apex, then dive-cleave.
    // 诸葛亮's carriage only hops (leap sheet: a small bounce while the fan calls a wind blade down), user's call 2026-11-21.
    const peak = me.meta?.weapon === 'fan' ? 0.35 : 1.9, xMid = lerp(xb, xc, 0.58), xHang = lerp(xb, xc, 0.78);
    const upPose = hasPose(me, 'leap_up') ? 'leap_up' : 'allin_leap';
    const apexPose = hasPose(me, 'leap_apex') ? 'leap_apex' : 'allin_leap';
    const divePose = hasPose(me, 'leap_dive') ? 'leap_dive' : 'allin_smear';
    const camZoom = SHOT.pos.clone().lerp(SHOT.look, 0.06);
    const camLookHigh = SHOT.look.clone().add(new THREE.Vector3(0, 0.55, 0));
    moveCam(camZoom, camLookHigh, 240);
    show(me, upPose);
    await tween(240, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      me.g.position.x = lerp(xb, xMid, k); me.g.position.z = lerp(z0, LANE, 0.4 + k * 0.35);
      lift(me, peak * e);
    });
    // Dramatic mid-air apex hang: foe dodges at the last moment on a miss.
    show(me, apexPose);
    if (!a.hit) { show(foe, 'dodge'); foe.loop = null; const f0 = foe.g.position.x; tween(260, (k) => { foe.g.position.x = f0 + dir * 1.25 * ease(k); }); }
    await tween(180, (k) => {
      me.g.position.x = lerp(xMid, xHang, ease(k)); me.g.position.z = lerp(z0, LANE, 0.75 + k * 0.15);
      lift(me, peak + 0.12 * Math.sin(Math.PI * k));
    });
    // Steep downward cleave dive with afterimages.
    show(me, divePose);
    moveCam(camZoom, SHOT.look.clone(), 150);
    let ghosts = 0;
    await tween(150, (k) => {
      me.g.position.x = lerp(xHang, endX, k); me.g.position.z = lerp(z0, LANE, 0.9 + k * 0.1);
      lift(me, peak * (1 - k * k));
      if (fx && k > 0.15 + ghosts * 0.25 && ghosts < 3) { ghosts++; ghost(me); }
    });
    lift(me, 0);
    // 接触: 104 lands on the blow, hit or miss (as in the original).
    audio?.sfx(CONTACT.desperate);
    if (tier) {
      const slamPose = hasPose(me, 'leap_slam') ? 'leap_slam' : 'allin_impact';
      show(me, slamPose);
      impact(me, foe, a, tier, ctx, 'allin_impact', tier !== 'heavy');
      if (tier === 'heavy') {
        freeze = ALLIN.stop; foe.trembleT = ALLIN.stop;
        if (fx && shakeLevel() > 0) silhouette = 1;
        if (fx) { groundRing(scene, foe.g.position.clone().setY(0.75), '#ffd9a0', { r: 2.6, ms: 540 }, tween); dustPuff(scene, foe.g.position.clone().setY(0.4), 1.65, tween); }
        slow(0.35, ALLIN.stop * 1000 + 300);
        foe.react = crush(foe);
      }
      await wait(260); show(me, 'allin_land'); await wait(200); show(me, 'recover'); await wait(160);
    } else {
      // Over-extended: past the foe, he loses his balance and staggers two steps; the cost lands as he does.
      popup('落空', head(foe), `${foe.look} miss`);
      foe.react = wait(240).then(() => { foe.loop = 'idle'; show(foe, 'idle_a'); });
      show(me, hasPose(me, 'leap_miss') ? 'leap_miss' : 'off_balance');
      wait(120).then(() => { if (a.self) { popup(`反噬 -${a.self}`, head(me, 2.5), `${me.look} self`); if (fx) me.flash = 0.12; ctx.onSelf?.(me.id, a.self); } });
      const xs = me.g.position.x;
      await tween(380, (k) => { me.g.position.x = xs + dir * 0.3 * Math.sin(k * Math.PI / 2); });
      show(me, 'recover'); await wait(220);
    }
    if (fx) { dim(0, 420); spot(0, 420); }
    if (tier !== 'heavy') moveCam(SHOT.pos, SHOT.look, 420); // a heavy blow's cut-in eases back out by itself (punchIn)
    const home = reinBack(me, z0);
    await foe.react;
    foe.react = null;
    await Promise.all([home, ride(foe, foe.home, WALK)]);
    await wait(120);
  }
  // Gentle horizontal camera pan following the clash center without zooming, darkening or tightening DoF.
  function panShot(dx, ms) {
    const p = SHOT.pos.clone(), l = SHOT.look.clone(); p.x += dx; l.x += dx;
    return moveCam(p, l, ms);
  }
  // Mid-range riding approach for single-picture riders as well as full strips.
  function approach(R, x, speed, gait = 'gallop', quiet = false) {
    if (R.meta) return ride(R, x, speed, gait, quiet);
    const x0 = R.g.position.x, d = Math.abs(x - x0);
    if (d < 0.01) return Promise.resolve();
    if (!quiet) hoof();
    return tween((d / speed) * 1000, (k) => { R.g.position.x = lerp(x0, x, k); });
  }
  // Spark point between the two engaged riders for non-damaging blade clashes.
  function clashPoint(me, foe, frame = 'swing_mid') {
    const p = tipOf(me, frame);
    p.x = (me.g.position.x + foe.g.position.x) * 0.5 + me.dir * 0.15;
    p.y = Math.min(Math.max(p.y, 1.25), 1.95);
    return p;
  }
  // 牵制 (FC mode 16): both riders close into mid-field, trade three crisp blade clashes (98×3)
  // with the defender parrying the first two, and settle the graze/hit only on the third clash.
  async function feintClash(me, foe, a, ctx) {
    const dir = me.dir, z0 = me.g.position.z;
    const foeMeet = foe.home - dir * 0.55;
    const strikeX = foeMeet - dir * Math.max(MIN_GAP, reach(me, 'feint_jab') + 0.12);
    const tier = a.dmg > 0 ? 'light' : a.hit ? 'graze' : null;
    me.loop = null; foe.react = null; cutIn++;
    panShot((strikeX + foeMeet) * 0.18, 320);
    await Promise.all([
      approach(me, strikeX - dir * 0.35, 6.2, 'gallop', false),
      approach(foe, foeMeet, 2.2, 'walk', true).then(() => { foe.loop = null; show(foe, 'feint_ready'); }),
    ]);
    me.loop = null;
    for (let i = 0; i < 2; i++) {
      const mx0 = me.g.position.x, fx0 = foe.g.position.x;
      show(me, 'feint_ready'); await wait(65);
      show(me, 'feint_jab'); audio?.sfx(CONTACT.feint);
      if (fx) sparkBurst(scene, clashPoint(me, foe, 'feint_jab'), 8, '#ffe6a8', tween);
      show(foe, i === 0 ? 'recoil_step' : 'feint_ready');
      await tween(100, (k) => {
        me.g.position.x = lerp(mx0, mx0 + dir * 0.14, ease(k));
        me.g.position.z = lerp(me.g.position.z, LANE, ease(k));
        foe.g.position.x = lerp(fx0, fx0 + dir * 0.08, Math.sin(Math.PI * k));
      });
      show(me, 'feint_back'); show(foe, 'feint_ready'); await wait(65);
    }
    const mx0 = me.g.position.x;
    show(me, 'feint_ready'); await wait(65);
    show(me, 'feint_jab');
    await tween(80, (k) => { me.g.position.x = lerp(mx0, strikeX, ease(k)); me.g.position.z = lerp(me.g.position.z, LANE, ease(k)); });
    audio?.sfx(CONTACT.feint);
    if (tier) {
      const stop = impact(me, foe, a, tier, ctx, 'feint_jab');
      if (stop) await wait(stop * 1000);
    } else {
      const xf = foe.g.position.x;
      foe.loop = null; show(foe, 'dodge'); popup('落空', head(foe), `${foe.look} miss`);
      foe.react = tween(160, (k) => { foe.g.position.x = xf + dir * 0.55 * ease(k); });
    }
    await wait(90); show(me, 'feint_back'); await wait(90); show(me, 'recover'); await wait(80);
    moveCam(SHOT.pos, SHOT.look, 380);
    const home = reinBack(me, z0);
    await foe.react;
    foe.react = null;
    await Promise.all([home, ride(foe, foe.home, WALK)]);
    await wait(120);
  }
  // 普通攻击 (FC mode 17): both riders close into mid-field; the attacker whirls his weapon overhead
  // three full turns (97×3, identical on hit and miss while the defender holds guard) then drives in on the
  // decisive cleave (105) which alone reveals the hit or miss.
  async function spinAttack(me, foe, a, ctx) {
    const dir = me.dir, z0 = me.g.position.z;
    const foeMeet = foe.home - dir * 0.55;
    const strikeX = foeMeet - dir * Math.max(MIN_GAP, reach(me) - 0.05);
    // He spins from at least SPIN_GAP out, as 关羽's long blade does: a sword's short reach put the horses nose to
    // nose for the whole spin (刘备 vs 典韦, 2026-11-21). The drive-in below covers the extra ground.
    const engageX = foeMeet - dir * Math.max(SPIN_GAP, Math.abs(foeMeet - strikeX) + 0.7);
    me.loop = null; foe.react = null; cutIn++;
    panShot((strikeX + foeMeet) * 0.2, 340);
    await Promise.all([
      approach(me, engageX, 6.2, 'gallop', false),
      approach(foe, foeMeet, 2.2, 'walk', true).then(() => { foe.loop = null; show(foe, 'feint_ready'); }),
    ]);
    me.loop = null;
    if (hasPose(me, 'spin_1')) {
      // Three overhead weapon spins (97×3): 4-frame 360° loop per turn, steady mount, defender holds guard.
      for (let i = 0; i < 3; i++) {
        show(me, 'spin_1'); await wait(70);
        show(me, 'spin_2'); audio?.sfx('sfx-duel-swing'); await wait(70);
        show(me, 'spin_3'); await wait(70);
        show(me, 'spin_4'); await wait(70);
      }
      show(me, 'spin_cleave'); await wait(95);
    } else {
      for (let i = 0; i < 3; i++) {
        show(me, 'windup'); await wait(95);
        show(me, 'swing_mid'); audio?.sfx('sfx-duel-swing'); await wait(95);
        show(me, 'windup'); await wait(90);
      }
    }
    // Decisive cleave (105): drive in from engageX to strikeX and reveal the outcome.
    const nearX = me.g.position.x;
    show(me, 'swing_mid');
    await tween(Math.min(170, 115 * Math.max(1, Math.abs(strikeX - nearX) / 0.7)), (k) => {
      me.g.position.x = lerp(nearX, strikeX, ease(k));
      me.g.position.z = lerp(z0, LANE, ease(k));
      if (k >= 0.45 && me.frame !== 'swing_late') show(me, 'swing_late');
    });
    show(me, 'strike'); audio?.sfx(CONTACT.attack);
    if (a.hit) {
      const stop = impact(me, foe, a, a.dmg > 0 ? 'normal' : 'graze', ctx);
      if (stop) await wait(stop * 1000);
    } else {
      const xf = foe.g.position.x;
      foe.loop = null; show(foe, 'dodge'); popup('落空', head(foe), `${foe.look} miss`);
      foe.react = tween(160, (k) => { foe.g.position.x = xf + dir * 0.7 * ease(k); });
    }
    await wait(100); show(me, 'follow'); await wait(100); show(me, 'recover'); await wait(90);
    moveCam(SHOT.pos, SHOT.look, 380);
    const home = reinBack(me, z0);
    await foe.react;
    foe.react = null;
    await Promise.all([home, ride(foe, foe.home, WALK)]);
    await wait(120);
  }
  async function retreat(me, foe, a, ctx) {
    popup('退却', head(me), me.look);
    const away = me.home - me.dir * 9, spin = { x: me.home - me.dir * 0.3, gait: 'gallop' };
    if (!a.hit) { await leave(me); return; }
    // Chased down: the foe gallops after him and strikes his back before he gets clear, inside the shot.
    // They stand close, so the foe holds until he has turned and run a few strides: the chase has ground to cover.
    const mid = me.home - me.dir * 1.9;
    panShot(-me.dir * 0.85, 650);
    await Promise.all([wheel(me, 'front', spin).then(() => ride(me, mid, GALLOP * 0.5)), wait(260).then(() => ride(foe, mid + me.dir * Math.max(MIN_GAP, reach(foe) - 0.2), GALLOP))]);
    me.loop = null;
    await play(foe, 'feint', () => {
      impact(foe, me, a, 'normal', ctx, 'feint_jab', false); // no blow sounds: the original's pursuit is its gallops (mode 21) alone
      show(me, 'hurt'); // struck in the back as he turns; he keeps running unless it killed him
    });
    show(me, 'hurt'); await wait(200);
    if ((ctx.hp?.[me.id] ?? 1) > 0) { show(me, 'slump'); await wait(220); await ride(me, away, GALLOP, 'flee'); me.gone = true; }
  }
  async function taunt(me, foe, a) { // silent in the original, whether it rattles him or not
    await play(me, 'taunt');
    popup(a.hit ? '骂倒!' : '骂倒无效', head(me), `${me.look} word`);
    if (a.hit) {
      // Rattled: he flinches and his horse shies a step.
      show(foe, 'dodge'); foe.loop = null; const x0 = foe.g.position.x;
      await tween(320, (k) => { foe.g.position.x = x0 + me.dir * 0.3 * Math.sin(k * Math.PI); });
      popup('心神大乱', head(foe), `${foe.look} word`);
      foe.loop = 'idle';
    } else await play(foe, 'taunt');
    await wait(200);
  }
  async function persuade(me, foe, a) {
    // He lowers his weapon to talk; the answer is the foe's.
    show(me, 'follow'); me.loop = null; await wait(650);
    const say = ['', '不为所动', '退出单挑', '双方收兵', '投降!'][a.out] || '不为所动';
    popup(say, head(foe), `${foe.look} word`);
    if (a.out <= 1) await play(foe, 'taunt');
    else if (a.out === 2) await leave(foe);
    else if (a.out === 3) await Promise.all([foe, me].map(async (R) => { await wheel(R, 'front'); await ride(R, R.home - R.dir * 1.6, WALK); }));
    else await kneel(foe);
    me.loop = 'idle';
    await wait(250);
  }

  // ---------- Defeat (docs/单挑舍身败北与手感方案_2026-11-13.md §2.3) ----------
  // The winner's ranks cheer; the loser's give back half a step.
  function cheer(W, L) {
    cheering = W.dir;
    for (const m of cast) if (m.userData.side === L?.dir) { const x0 = m.position.x; tween(500, (k) => { m.position.x = x0 - m.userData.side * 0.5 * ease(k); }); }
  }
  // Taken (被擒): two of the winner's men run out of his ranks and stand over the kneeling man, one on each side,
  // spears levelled (the remake's own staging, §2.3: the original shows nothing here). Their 白兵 strips.
  async function guards(W, man) {
    const A = sprites[`troop-${W.look}-soldier`];
    if (!A?.meta || !man) return;
    const unit = 1.3 / A.meta.figH, mx = man.g.position.x, mz = man.g.position.z;
    const run = A.meta.clips.walk, lap = run.reduce((a, f) => a + f[1], 0) * 0.6; // the walk cycle, quickened to a jog
    const go = [-1, 1].map(async (s, i) => {
      const { body } = framePlane(A, unit), g = new THREE.Group();
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.y = 0.45;
      g.add(body, shadow); scene.add(g); cast.push(g);
      const M = { g, body, cards: [], meta: A.meta, unit, face: 1 };
      // One on each side of him along the line, clear of his body and his weapon, a step nearer the camera.
      const x0 = -W.dir * (5.6 + i * 0.4), z0 = -0.9 + i * 0.3, x1 = mx + s * 1.05, z1 = mz + 0.35 + i * 0.08;
      g.position.set(x0, 0.25, z0); setFace(M, Math.sign(x1 - x0) || W.dir);
      await wait(i * 160);
      const ms = (Math.hypot(x1 - x0, z1 - z0) / 2.8) * 1000;
      // They keep to the back lane until they are past the winner's horse, then come forward, so they never run through it.
      const kp = Math.min(0.85, Math.max(0, (W.g.position.x + W.dir * 1.2 - x0) / (x1 - x0)));
      await tween(ms, (k) => {
        g.position.set(lerp(x0, x1, k), 0.25, k < kp ? z0 : lerp(z0, z1, ease((k - kp) / (1 - kp))));
        let t = ((k * ms) % lap) / 0.6; for (const [f, d] of run) { if (t < d) { show(M, f); break; } t -= d; }
      });
      // He kneels drawn over the ground (onTop): standing in front of him now, they are drawn after him.
      onTop(body, 13);
      setFace(M, Math.sign(mx - x1) || -W.dir); show(M, 'guard');
      if (fx) dustPuff(scene, g.position.clone().setY(0.3), 0.45, tween);
    });
    await Promise.all(go);
  }
  // Drawn over whatever was drawn before it, in renderOrder among the transparent planes. The depth test passes
  // always rather than being switched off: switched off, WebGL writes no depth either, and the depth of field then
  // reads the haze behind him and blurs him like the far distance.
  function onTop(m, order) { m.material.transparent = true; m.material.depthFunc = THREE.AlwaysDepth; m.renderOrder = order; }
  // An opaque box (px in its cell) of one frame of a strip or card, read off its picture once; rows from `from` down.
  const pixels = new WeakMap();
  function frameBox(A, name, from = 0) {
    const { frames, cell: [cw, ch] } = A.meta, i = frames.indexOf(name), img = A.tex.image;
    if (i < 0 || !img) return null;
    let d = pixels.get(img);
    if (!d) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); d = g.getImageData(0, 0, c.width, c.height); pixels.set(img, d); }
    let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
    for (let y = from; y < ch; y++) for (let x = 0; x < cw; x++) if (d.data[(y * d.width + i * cw + x) * 4 + 3] >= 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2 };
  }
  // The general on foot, apart from his horse: a copy of his side strip (DOWNED) and his third card (thrown, landing,
  // struggling, kneeling). lying: drawn over the ground (onTop; see the DOWNED note below).
  function onFoot(R, lying) {
    const A = R.strip, u = unitOf(A.meta);
    const { body } = framePlane(A), c = { body: framePlane(A.extra, u).body, meta: A.extra.meta, follows: true };
    c.body.userData.y0 = c.body.position.y; c.body.visible = false;
    // The strip's bottom row is often his dropped weapon lying in front of him: sink the plane so his body
    // (meta.rest px up) meets the ground, and draw it over the ground so the weapon shows below that line.
    body.position.y -= (A.meta.rest || 0) * u;
    // Drawn late and over the ground (onTop), so his sunk bottom rows still show; he writes his depth, so the
    // haze backdrop behind him does not paint over whatever of him rises above the ground's far edge.
    for (const b of [body, c.body]) { b.material.transparent = true; if (lying) onTop(b, 10); }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.set(A.meta.cell[0] * u * 0.42, 0.32, 1);
    const man = { ...R, g: new THREE.Group(), body, cards: [c], shadow, loop: null, hold: 0, A };
    man.g.add(body, c.body, shadow); man.g.position.copy(R.g.position); scene.add(man.g);
    setFace(man, R.face);
    return man;
  }
  // His weapon on its own (the third card's WEAPON frame), turning about its middle; rest: { x, y } its middle
  // where it comes to lie flat (y above the stand line).
  function looseWeapon(R, A, over = true) {
    const u = unitOf(A.meta), [cw, ch] = A.extra.meta.cell, b = frameBox(A.extra, 'weapon');
    const { body } = framePlane(A.extra, u), g = new THREE.Group();
    body.material.map.offset.x = A.extra.meta.frames.indexOf('weapon') / A.extra.meta.frames.length;
    body.scale.x = R.face; body.position.set(-(b ? b.cx - cw / 2 : 0) * u * R.face, (b ? b.cy - ch / 2 : 0) * u, 0);
    body.material.transparent = true; if (over) onTop(body, 11);
    g.add(body); scene.add(g);
    return { g, body, half: b ? ((b.y1 - b.y0) / 2) * u : 0.05, len: b ? (b.x1 - b.x0) * u : 1.5 };
  }
  // Struck from the saddle: thrown back off the rearing horse, he hits the ground, tries to rise and lies still
  // (death) or kneels (taken). His weapon spins away, lands flat and bounces once: where the DOWNED frame draws it
  // under him, so nothing jumps when that frame takes over and the loose one goes; or before him when he kneels.
  async function fallFrom(R, { captured = false } = {}) {
    const foe = foeOf(R), A = R.strip;
    popup(captured ? '落马' : '阵亡', head(R, 3.0), R.look);
    const plain = !R.meta || !A?.extra, landX = R.g.position.x - R.face * 1.2;
    // The close shot holds the winner and the ground the loser is thrown onto.
    const c = close(((plain ? R.g.position.x : landX) + (foe?.g.position.x ?? R.g.position.x)) / 2); cutIn++; moveCam(c.pos, c.look, 260);
    R.loop = null; show(R, 'hurt');
    if (plain) return fallPlain(R, foe);
    await wait(150);
    if (!captured) slow(0.3, 420); // the deathblow plays out slowly: the start of the throw
    const f = R.face, man = onFoot(R, true), u = man.unit, sx = R.g.position.x;
    man.g.position.y = 0.25 + 0.75; R.ring.visible = false;
    show(R, 'horse_rear'); show(man, 'man_fly');
    // Where the weapon comes to rest, from the DOWNED frame's bottom rows (its weapon) or before the kneeling man.
    const dn = !captured && frameBox(A, 'downed', A.meta.cell[1] - (A.meta.rest || 0));
    const wpn = looseWeapon(R, A), w0 = new THREE.Vector3(sx + f * 0.5, 0.25 + 1.55, R.g.position.z + 0.05);
    const wx = dn ? landX + f * (dn.cx - A.meta.anchor) * u : landX - f * 0.2, wz = R.g.position.z + (dn ? 0.2 : 0.55); // kneeling: laid on the ground before him
    const wy = dn ? 0.25 - (A.meta.rest || 0) * u + (A.meta.cell[1] - dn.cy) * u : 0.25 + wpn.half;
    wpn.g.position.copy(w0);
    const spin = tween(620, (k) => {
      wpn.g.position.set(lerp(w0.x, wx, k), lerp(w0.y, wy, k) + 1.1 * Math.sin(Math.PI * k), lerp(w0.z, wz, k));
      wpn.g.rotation.z = -f * Math.PI * 4 * ease(k); // two turns, ending flat as drawn
    }).then(() => tween(180, (k) => { wpn.g.position.y = wy + 0.14 * Math.sin(Math.PI * k); wpn.g.rotation.z = f * 0.12 * Math.sin(Math.PI * k); }));
    await tween(440, (k) => {
      man.g.position.x = lerp(sx, landX, k); man.g.position.y = 0.25 + 0.75 * (1 - k) + 0.55 * Math.sin(Math.PI * k);
      man.shadow.position.y = 0.01 - (man.g.position.y - 0.25); man.shadow.scale.x = A.meta.cell[0] * u * 0.42 * (0.6 + 0.4 * k);
    });
    man.g.position.y = 0.25; man.shadow.position.y = 0.01;
    show(man, 'man_hit'); if (fx) { dustPuff(scene, man.g.position.clone().setY(0.4), 1.2, tween); shake = Math.max(shake, 0.08); }
    // The horse shies round from the fall and bolts riderless (if he was not already running from the foe).
    // He lies drawn over the ground (no depth test), so the horse wheeling round in front of him is drawn after him.
    for (const b of [R.body, ...R.cards.map((c) => c.body)]) onTop(b, 12);
    const bolt = (async () => {
      await wait(120);
      if (R.face === R.dir) await wheel(R, 'front', { x: R.g.position.x - R.dir * 0.4, gait: 'loose' });
      await ride(R, R.g.position.x - R.dir * 10, GALLOP * 1.3, 'loose');
      R.gone = true;
    })();
    await wait(300);
    // STRUGGLE is drawn rolled over (head to the other side from the other cells): turned round it keeps his head
    // where it was as he props himself up.
    man.face = -f; show(man, 'man_struggle'); man.face = f;
    await Promise.all([spin, wait(captured ? 420 : 480)]);
    if (captured) { show(man, 'man_kneel'); man.g.position.x += f * 0.15; }
    else { show(man, 'downed'); scene.remove(wpn.g); }
    if (fx) dustPuff(scene, man.g.position.clone().setY(0.35), 0.7, tween);
    cast.push(man.g); if (captured) cast.push(wpn.g);
    await bolt;
    await wait(250);
    return captured ? man : null;
  }
  // A rider without the third sheet: he falls from the saddle and the horse bolts (the earlier staging).
  async function fallPlain(R, foe) {
    await wait(160);
    show(R, 'fall'); if (fx) dustPuff(scene, R.g.position.clone().setY(0.5), 1.0, tween); await wait(420);
    if (R.meta) {
      const A = R.strip;
      const { body } = framePlane(A), man = { ...R, g: new THREE.Group(), body, cards: [], loop: null };
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.set(A.meta.cell[0] * unitOf(A.meta) * 0.42, 0.32, 1);
      body.position.y -= (A.meta.rest || 0) * unitOf(A.meta);
      onTop(body, 10);
      man.g.add(body, shadow); man.g.position.copy(R.g.position); man.g.position.x -= R.face * 0.5; scene.add(man.g);
      setFace(man, R.face); show(man, 'downed'); if (fx) dustPuff(scene, man.g.position.clone().setY(0.4), 1.2, tween);
      R.ring.visible = false;
      if (R.face === R.dir) await wheel(R, 'front', { x: R.g.position.x - R.dir * 0.4, gait: 'loose' });
      await ride(R, R.g.position.x - R.dir * 10, GALLOP * 1.3, 'loose');
      R.gone = true;
      cast.push(man.g);
    } else {
      const m = R.body.material; m.transparent = true;
      await tween(600, (k) => { R.g.position.y = 0.25 - k * 0.3; m.opacity = 1 - k; });
    }
    await wait(250);
  }
  // Beaten off the field (退却, 说得 退出单挑, the 100th round): he sags in the saddle, then wheels and runs, low
  // over the horse's neck (the third card's charge frames, or the gallop without it).
  async function leave(R, { sag = true } = {}) {
    if (sag) { R.loop = null; show(R, 'slump'); await wait(400); }
    await wheel(R, 'front', { x: R.home - R.dir * 0.3, gait: 'gallop' });
    await ride(R, R.home - R.dir * 9, GALLOP, 'flee');
    R.gone = true;
  }
  // Giving himself up (降参, or talked into it): he sags, gets down and kneels with his weapon laid before him, and
  // the riderless horse walks away. A rider without the third sheet bows in the saddle instead.
  async function kneel(R) {
    R.loop = null; show(R, 'slump'); await wait(500);
    const A = R.strip;
    if (!R.meta || !A?.extra) { show(R, 'follow'); await tween(500, (k) => { R.body.rotation.z = -R.face * 0.12 * ease(k); }); return; }
    const f = R.face, man = onFoot(R, false), wpn = looseWeapon(R, A, false);
    man.g.position.x += f * 0.45; man.g.position.z += 0.3; // before his horse, toward the winner, clear of it as it turns away
    wpn.g.position.set(man.g.position.x - f * 0.2, 0.25 + wpn.half, man.g.position.z + 0.3); // a long glaive reaches past him either way: centred back from the winner
    // Down from the saddle in a puff of dust: he kneels beside the horse, now riderless. (No fade: the sprites are
    // alpha-tested, so a fade would only pop at half way.)
    show(man, 'man_kneel'); show(R, 'loose_1'); R.ring.visible = false;
    if (fx) dustPuff(scene, man.g.position.clone().setY(0.4), 0.9, tween);
    cast.push(man.g, wpn.g);
    await wait(250);
    if (R.face === R.dir) await wheel(R, 'front', { x: R.g.position.x - R.dir * 0.6, gait: 'loose' });
    await ride(R, R.g.position.x - R.dir * 8, WALK * 1.4, 'loose');
    R.gone = true;
  }
  // 降参: he lowers his weapon and bows in the saddle (the same yielding pose as a persuaded foe).
  async function yieldTo(me) {
    popup('投降', head(me), `${me.look} word`);
    await kneel(me);
    await wait(300);
  }

  return {
    scene, camera,
    // The war this 单挑 belongs to: { month, city, siege } (the battlefield's seat sets the latitude; siege:
    // { color, look } of the castle's holder when the generals meet under its walls, else null).
    setPlace(p) { place = env.set(p); siegeOf = p.siege ?? null; },
    update(dt) {
      time += dt;
      // The shell caps dt at 50 ms for physics-like updates; the duel's timing uses real elapsed time
      // (capped at 250 ms) so a blow takes the same time at 30, 60 or 120 fps and on a slow frame.
      const now = performance.now(), real = Math.min(0.25, lastNow ? (now - lastNow) / 1000 : dt); lastNow = now;
      for (const R of riders) if (R.jit) { R.g.position.x -= R.jit; R.jit = 0; } // last frame's tremble, before the tweens move him
      const pdt = tick(real);
      // A 舍身's struck rider trembles a pixel each way through the stop.
      for (const R of riders) if (R.trembleT > 0) { R.trembleT -= real; if (R.trembleT > 0) { R.jit = (Math.floor(now / 33) % 2 ? 1 : -1) * R.unit; R.g.position.x += R.jit; } }
      shake *= Math.pow(0.002, dt);
      for (const R of riders) {
        if (!(R.hold > 0)) runLoop(R, pdt);
        R.flash = Math.max(0, R.flash - real * 8);
        // A blow flashes him white for an instant, then a red tint fades out of him (hurtT).
        R.hurtT = Math.max(0, (R.hurtT || 0) - real * 2.6); const hr = R.flash > 0.05 ? 0 : R.hurtT;
        for (const m of [R.body.material, ...R.cards.map((c) => c.body.material)]) {
          m.emissiveIntensity = silhouette > 0 ? 0 : R.flash;
          if (silhouette > 0) m.color.setScalar(0.08); else m.color.setRGB(1, 1 - 0.45 * hr, 1 - 0.5 * hr);
        }
      }
      if (silhouette > 0) silhouette--;
      // The ranks breathe; once the duel is won the winner's men cheer, jumping higher and faster.
      for (const m of cast) if (m.userData.phase != null) { const up = m.userData.side === cheering; m.position.y = m.userData.y0 + Math.abs(Math.sin(time * (up ? 11 : 7) + m.userData.phase)) * (up ? 0.16 : 0.06); }
    for (const m of crew) m.position.y = m.userData.y0 + Math.abs(Math.sin(time * 5 + m.userData.phase)) * 0.05;
    // Banners ripple from the pole outwards.
    for (const f of flags) {
      const p = f.geometry.attributes.position, b = f.userData.base;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3], w = Math.sin(time * 4 - x * 9 + f.position.x);
        p.array[i * 3] = x * (0.92 + 0.08 * Math.cos(time * 4 - x * 9 + f.position.x)); p.array[i * 3 + 1] = b[i * 3 + 1] + w * 0.07 * x * 2; p.array[i * 3 + 2] = b[i * 3 + 2] + w * 0.1 * x;
      }
      p.needsUpdate = true;
    }
      // Shots are framed for ~16:9; pull back on narrower windows so both generals stay clear of the portrait cards.
      const pull = Math.max(1, 1.7 / camera.aspect);
      // The kick: a spring that overshoots once and settles (about 0.3 s), on the real clock so a hit-stop does not hold it.
      kickV += (-220 * kickX - 13 * kickV) * real; kickX += kickV * real;
      camera.position.copy(cam.pos).sub(cam.look).multiplyScalar(pull).add(cam.look).add(shakeOffset(time, shake, shakeV, 0.5));
      camera.position.x += kickX * shakeLevel(); camera.position.y -= Math.abs(kickX) * 0.25 * shakeLevel();
      camera.lookAt(cam.look);
      if (vignette.material.opacity > 0) {
        const d = camera.near * 1.5, h = 2 * d * Math.tan((camera.fov * Math.PI) / 360);
        vignette.position.copy(camera.position).addScaledVector(camera.getWorldDirection(shakeV.clone()), d); vignette.quaternion.copy(camera.quaternion); vignette.scale.set(h * camera.aspect, h, 1);
      }
      vignette.visible = vignette.material.opacity > 0;
      sky.update(time); shafts.update(time); env.update(pdt, time, cam.look, 14); T.water.offset.x = time * 0.05;
    },
    focusPoint() { return cam.look; },
    // Tighter DoF reserved for 舍身, reset cleanly on abort().
    dof() { return pulled ? { strength: lerp(1.5, 2.6, pull), band: lerp(0.1, 0.075, pull) } : null; },
    // Stage the field's two generals; ranks scale with the troops each side still has.
    // warm: run once the set and riders are made, before the camera moves (app.js compiles their shaders then).
    async enter(battle, looks, warm = null) {
      abort(); aborted = false; lastNow = 0; cheering = 0;
      const T0 = performance.now(); // tools/scene_switch_trace.mjs (PERF-05): measures only
      const gone = [set, ...cast, ...riders.map((R) => R.g)];
      for (const m of cast) scene.remove(m);
      for (const R of riders) scene.remove(R.g);
      buildSet(battle.terrain, siegeOf && looks.a === siegeOf.look ? 1 : -1);
      const n = (s) => Math.max(3, Math.min(27, Math.ceil(battle.fielded(s) / 40)));
      const RA = rider(battle.side.a.id, looks.a, 1, battle.side.a.o?.weapon), RD = rider(battle.side.d.id, looks.d, -1, battle.side.d.o?.weapon);
      riders = [RA, RD];
      cast = [...rank(looks.a, n('a'), 1), ...rank(looks.d, n('d'), -1)];
      release(gone, scene, Object.values(T)); // the last duel's set, riders and ranks
      performance.measure('duel:build', { start: T0 });
      await warm?.();
      // Stand-off distance: a mid-range riding gap, so both generals meet mid-field.
      const gap = Math.max(STANDOFF_MIN, Math.max(MIN_GAP, reach(RA), reach(RD)) + STANDOFF);
      RA.home = -gap / 2; RD.home = gap / 2;
      cam.pos.copy(OPEN.pos); cam.look.copy(OPEN.look); cutIn++; // no war-start phrase: the original starts the duel theme and nothing else
      await Promise.all([moveCam(SHOT.pos, SHOT.look, 2100), ride(RA, RA.home, GALLOP * 0.75, undefined, true), ride(RD, RD.home, GALLOP * 0.75, undefined, true)]); // quiet: the original enters on the theme alone
      await wait(200);
    },
    // One Duel action ({ by, cmd, hit, dmg, self, out }) already settled by the rules.
    // ctx: { hp: { [id]: hp after }, onHit(id, dmg, tier), onSelf(id, self) } — the HUD updates on those events.
    async act(a, ctx = {}) {
      const me = byId(a.by), foe = foeOf(me);
      if (a.cmd === 'retreat') return retreat(me, foe, a, ctx);
      if (a.cmd === 'taunt') return taunt(me, foe, a);
      if (a.cmd === 'persuade') return persuade(me, foe, a);
      if (a.cmd === 'surrender') return yieldTo(me);
      if (a.cmd === 'desperate' && me.meta) return allIn(me, foe, a, ctx);
      if (a.cmd === 'feint') return feintClash(me, foe, a, ctx);
      if (a.cmd === 'attack') return spinAttack(me, foe, a, ctx);
      return swing(me, foe, a, ctx); // a 舍身 by a rider without an action strip
    },
    // Death: struck from the saddle, the rider falls to the ground and his horse bolts riderless.
    // Death (or, under 武将不战死, a capture): see fallFrom().
    fall(id, opts) { const R = byId(id); return R ? fallFrom(R, opts) : undefined; },
    // How the duel ends, once its result is settled (tacticalhud.js after resolveDuel): { dead, captured, surrendered,
    // retreated, winner }. The fallen general comes down here; one who lost on the 100th round leaves the field;
    // a 降参 or a persuaded surrender has already knelt (act). The winner of a death or capture raises his weapon.
    async finish(r) {
      let taken = null;
      if (r.dead != null) await this.fall(r.dead);
      else if (r.captured != null) taken = await this.fall(r.captured, { captured: true });
      else if (r.retreated != null) { const R = byId(r.retreated); if (R && !R.gone) { popup('败走', head(R), `${R.look} word`); await leave(R); } }
      if (r.dead != null || r.captured != null || r.surrendered != null) {
        const W = byId(r.winner), L = foeOf(W);
        if (W && !W.gone) { W.loop = null; show(W, r.surrendered != null ? 'follow' : 'triumph'); cheer(W, L); await Promise.all([wait(700), guards(W, taken)]); }
      }
    },
    async pullBack() { cutIn++; await moveCam(new THREE.Vector3(0, 4.2, 17.5), new THREE.Vector3(0, 1.6, 0.2), 900); },
    abort,
    // The clock's finer controls, for the 舍身 and defeat staging and for capture tools: slow(scale, ms), and a
    // per-rider hold (s) that stops only his own tweens.
    slow,
    hold(id, s) { const R = byId(id); if (R) R.hold = s; },
    // Hold one pose on a rider (capture and review tools); 'idle' hands him back to his idle loop.
    pose(id, name) { const R = byId(id); if (!R) return null; if (name === 'idle') { R.loop = 'idle'; show(R, 'idle_a'); return 'idle_a'; } R.loop = null; show(R, name); return R.meta ? resolve((x) => hasPose(R, x), name) : null; },
    // Where a rider stands and what he shows, with the camera's kick (capture and review tools).
    probe(id) { const R = byId(id); return R ? { x: R.g.position.x, y: R.g.position.y, frame: R.frame, kick: kickX, camX: camera.position.x } : null; },
    setFx(on) { fx = on; },
  };
}

// Clips for riders without an action strip (same names as slice_duel_frames.py writes).
const DEFAULT_CLIPS = {
  attack: [['windup', 150], ['strike', 90, 'hit'], ['strike', 140], ['follow', 210]],
  feint: [['idle_b', 70], ['strike', 60, 'hit'], ['strike', 70], ['follow', 120]],
  desperate: [['windup', 350], ['strike', 110, 'hit'], ['strike', 200], ['follow', 320]],
  hurt: [['hurt', 150], ['idle_a', 180]], hurt_light: [['hurt', 120], ['idle_a', 140]], hurt_heavy: [['hurt', 260], ['idle_a', 200]],
  walk: [['idle_a', 160], ['idle_b', 160]], stagger: [['hurt', 260], ['dodge', 200]], dodge: [['dodge', 260]],
  flee: [['allin_charge_1', 90], ['allin_charge_2', 90]], // beaten and running, low over the neck (stand-ins: two gallop frames)
  taunt: [['taunt', 700]], idle: [['idle_a', 900], ['idle_b', 520]], gallop: [['idle_a', 120], ['idle_b', 120]], loose: [['idle_a', 200]],
};
