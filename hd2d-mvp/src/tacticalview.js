// 白兵 battlefield renderer: a 16×10 HD-2D diorama for core/tactical.js, built from the war map's terrain
// and set dressing (src/diorama.js). A squad is a small formation of men, each playing his own action strip
// (tools/slice_troop_frames.py; generals ride their 单挑 strips): they march, charge, strike, flinch and
// fall a beat apart, lag their squad's moves a little, and the fallen stay on the field. Every man casts his
// shadow from a sun-facing proxy and sits in a soft contact shadow, shaded darker at the feet with a warm rim
// on the lit edge, so the sprites read as standing in the light rather than pasted over it. The DOM console
// lives in app.js.
import { PHONE } from './phone.js';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { unitTex, canvasTex, rng } from './pixel.js';
import { backdrop, lightShafts, slash, sparkBurst, dustPuff, flare, flames, embers, glowTex, animate, skyLit, drop, release, shakeOffset } from './fx.js';
import { seasonalize } from './seasons.js';
import { seasonEnv } from './seasonenv.js';
import { buildTerrain, dressBoard, azureWaterTex, vnoise } from './diorama.js';
import { loadTacticalGround, tacticalGround, fieldOf, bakeGround, groundMesh, waterMesh, towerMeshes, towersOf, woodsOf, plantWoods, bannerMesh, WATER_Y } from './tacticalground.js';
import { GW, GH } from './core/tactical.js';
import { genericArt } from './core/pack.js';
import { blastRig } from './blastfx.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => k * k * (3 - 2 * k);
const SUN = new THREE.Vector3(-11, 16, 9), SUN_YAW = Math.atan2(SUN.x, SUN.z);
// Idle figure heights (world units, weapon included).
// One man stands for each squad, as large as the cell allows, so spear, bow and horse read at a glance
// (as one figure per unit in Fire Emblem / Triangle Strategy); the squad's strength is the bar under him.
// The spearman's 戟 towers over his head (N09 redraw), so his figure, weapon included, stands taller.
const FIG = { inf: 1.2, arc: 1.0, cav: 1.22, gen: 1.45 };
const KIND = { inf: 'soldier', arc: 'archer', cav: 'cavalry' };
// Clips for a man without a strip (a single sprite) and names a strip may lack.
const FALLBACK = {
  idle: [['idle_a', 1000]], walk: [['idle_a', 300]], charge: [['idle_a', 300]], hurt: [['hurt', 220]], fall: [['hurt', 90], ['fall', 260]],
  attack: [['windup', 150], ['strike', 80, 'hit'], ['strike', 140]], cheer: [['idle_a', 400]],
};
const TILT = 0.3; // standing men lean back this much (rad); the dead lie back to face the camera
const CLIP_ALIAS = { charge: 'gallop' }, FRAME_ALIAS = { dead: 'downed', stagger: 'hurt', guard: 'idle_a' };

const blobTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
blobTex.magFilter = blobTex.minFilter = THREE.LinearFilter;
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
// A squad stands on a lacquered base in its side's colour, as the generals on the war map (A2), so the two
// armies part at a glance without an outline round the men.
// A dark lacquer field with a thin bright rim in the side's colour, as in the approved concept.
const SIDE_COL = { attacker: ['#16244e', '#5a9cff'], defender: ['#4a1410', '#ff6a4e'] }, BASE_H = 0.05;
const BASE_GEO = new THREE.CylinderGeometry(0.4, 0.43, BASE_H, 32); BASE_GEO.translate(0, BASE_H / 2, 0);
const RIM_GEO = new THREE.RingGeometry(0.355, 0.4, 40).rotateX(-Math.PI / 2).translate(0, BASE_H + 0.002, 0);
const baseMat = Object.fromEntries(Object.entries(SIDE_COL).map(([k, [c]]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.32, metalness: 0.15 })]));
const rimMat = Object.fromEntries(Object.entries(SIDE_COL).map(([k, [, c]]) => [k, new THREE.MeshBasicMaterial({ color: c })]));
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

// Troop lighting on top of skyLit: the bottom of the cell darkens toward the feet (ground occlusion), and
// an opaque texel whose neighbour toward the sun (upper left on screen; mirrored when he faces left) is
// empty picks up a warm rim, so each silhouette gets a lit edge like the 3D trees and walls beside it.
// An empty texel next to the figure becomes a one-texel outline in the side's colour (uLine, faded by
// uLineK; off for the dead), so blue and red read apart on any ground (N09).
function troopLit(material, texel, face, line) {
  const sky = material.onBeforeCompile, u = { uTexel: { value: texel }, uFace: { value: face }, uFoot: { value: 0.72 }, uRim: { value: new THREE.Color('#ffc87a').multiplyScalar(0.22) },
    uLine: { value: new THREE.Color(line || '#000000') }, uLineK: { value: line ? 1 : 0 } };
  material.userData.u = u;
  material.onBeforeCompile = (s, r) => {
    sky(s, r);
    Object.assign(s.uniforms, u);
    s.fragmentShader = 'uniform vec2 uTexel; uniform float uFace, uFoot, uLineK; uniform vec3 uRim, uLine;\n' + s.fragmentShader
      .replace('void main() {', 'void main() {\n float rimK = 0., lineK = 0.;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
 diffuseColor.rgb *= mix(uFoot, 1., smoothstep(0., 0.32, vMapUv.y));
 rimK = 1. - step(0.5, texture2D(map, vMapUv + vec2(-uFace * uTexel.x, uTexel.y)).a);
 if (uLineK > 0. && diffuseColor.a < 0.5) {
  float n = 0.;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) n = max(n, texture2D(map, vMapUv + vec2(float(i), float(j)) * uTexel).a);
  lineK = step(0.5, n) * uLineK; rimK = 0.;
  diffuseColor = vec4(uLine * 0.35, lineK);
 }
#endif`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = mix(totalEmissiveRadiance + rimK * uRim, uLine * 0.7, lineK);');
  };
  return material;
}

export function createTacticalView(T, sprites) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d9c6a6', 26, 70);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 160);
  const sun = new THREE.DirectionalLight('#ffd49c', 2.9); sun.position.copy(SUN); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, far: 60 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const rim = new THREE.DirectionalLight('#9cc4ff', 0.8); rim.position.set(9, 7, -12);
  const hemi = new THREE.HemisphereLight('#e8f0ff', '#5a4630', 0.9);
  scene.add(sun, rim, hemi);
  const sky = backdrop(scene, { radius: 30, y: -2 }), shafts = lightShafts(scene, 6, [18, 12]);
  // The war's month and place (setPlace): light, sky and weather here, the ground recoloured in ground().
  const env = seasonEnv(scene, { sun, back: rim, hemi, sunK: 0.8, hemiK: 0.95, snowH: 0.6, patch: 0.3, ring: [64, 3] });
  env.backdrop(sky);
  const blast = blastRig(scene); // 爆炎 (src/blastfx.js), made once and compiled with each field
  let where = { month: 2, city: 12 }, place = env.set(where), loading = loadTacticalGround(2, 12).catch(() => null);

  let set = null, units = new Map(), battle = null, time = 0, shake = 0, speed = 1, shift = 0, shiftX = 0, fit = 1, billboards = [], corpses = [], water = null, cellH = () => H0;
  const edge = new THREE.Vector3(), camGoal = new THREE.Vector3(), shakeV = new THREE.Vector3(); // scratch for update(), which runs every frame
  const inset = { top: 0, bottom: 0, left: 0, right: 0 }; // screen pixels the HUD covers at the top and bottom (and, on a phone, by the sides)
  const cam = { pos: new THREE.Vector3(0, 16, 16), look: new THREE.Vector3(0, 0, 1.1), yaw: 0, dist: 21, baseDist: 21 };
  // Depth of field focuses on the latest clash, then drifts back to the view's centre.
  const focus = { at: new THREE.Vector3(0, 0, 1.1), goal: null, until: 0 };
  const wx = (x) => x - GW / 2 + 0.5, wz = (y) => y - GH / 2 + 0.5;
  const H0 = 0.32;
  // 白兵 pace at 1×: every tween, clip frame and pause runs this much slower than authored (0.1.0 felt rushed).
  const PACE = 1.6;
  const d = (ms) => (ms * PACE) / speed;

  // ---------- Ground ----------
  // The board plus an apron of country around it, as one bevelled terrain mesh (src/diorama.js). Board
  // classes: 0 open, 1 wood, 2 rock, 3 deep water, 4 ford, 5 wall.
  const APRON = 9;
  // The painted field (src/tacticalground.js, A2): one baked ground over a smooth relief, painted woods,
  // pools and walls. Without its materials (they failed to load) the field falls back to the tile diorama.
  // The baked ground of the last two fields (src/tacticalground.js bakeGround) by the place's materials (G: one month and
  // place), the board and its terrain: the next 白兵 there on the same terrain lays the same picture (the bake is
  // deterministic) without baking it again (PERF-05). A texture disposed when its field went is uploaded again on use.
  const BAKED_MAX = 2, baked = [];
  function bakedGround(G, map, terrain, bake) {
    const i = baked.findIndex((e) => e.G === G && e.map === map && e.terrain === terrain);
    if (i >= 0) { const [e] = baked.splice(i, 1); baked.push(e); return e.tex; }
    const tex = bake(); baked.push({ G, map, terrain, tex });
    if (baked.length > BAKED_MAX) baked.shift(); // its texture goes with its field (release in build)
    return tex;
  }
  function painted(b, G) {
    const t = b.terrain, seed = t * 31 + 7;
    let tp = performance.now();
    const F = fieldOf({ map: b.map, terrain: t, GW, GH, apron: APRON, seed });
    const woods = woodsOf(F);
    performance.measure('tac:field', { start: tp }); tp = performance.now();
    const wx0 = wx(-APRON) - 0.5, wz0 = wz(-APRON) - 0.5;
    const baked = bakedGround(G, b.map, t, () => bakeGround(G, F, woods));
    performance.measure('tac:bakeGround', { start: tp });
    { const gm = groundMesh(G, F, baked, wx0, wz0); gm.userData.ground = true; set.add(gm); }
    if (b.map.some((row) => row.some((c) => c === 3 || c === 4))) { water = waterMesh(G, F, wx0, wz0); set.add(water); } else water = null;
    if (t === 5) set.add(towerMeshes(G, F, wx, wz, H0));
    // the country's crowns dim with distance like its ground
    set.add(plantWoods(G, woods.map((w) => ({ x: wx(w.x - 0.5), z: wz(w.y - 0.5), h: F.height(w.x, w.y), size: w.size, pine: w.pine, shade: w.far ? Math.max(0.55, 1 - w.far * 0.05) : 1 })), 0.86, seed));
    billboards = [];
    const wet = (x, y) => b.map[y][x] === 3 || b.map[y][x] === 4;
    // men stand on the ground under them: atop a knoll or a tower's deck, ankle-deep in a pool
    cellH = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH && wet(x, y) ? WATER_Y - 0.04 : F.stand(x, y));
  }
  function ground(b) {
    const G = tacticalGround(where.month, where.city);
    if (G) return painted(b, G);
    const t = b.terrain, map = b.map, inside = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH, seed = t * 31 + 7;
    const floor = t === 1 ? ['sand', 'dirt'] : t === 5 ? ['stone', 'plinth'] : ['grass', 'earth'];
    // 城战's towers (towersOf): the decks and stairs raised inside the walls, as on the painted field
    // (the walls at the rim's height, not a block over the deck); men stand only on the decks and stairs
    const T = t === 5 ? towersOf(map, GW, GH) : null, tower = (x, y) => T?.get(`${x},${y}`);
    const raised = (x, y) => { const c = tower(x, y); return c && c.kind !== 'wall' ? c.h : null; };
    const hAt = (x, y) => tower(x, y)?.h ?? [H0, H0, H0 + 0.75 + ((x * 7 + y * 13) % 3) * 0.08, 0.1, 0.18, H0 + 0.95][map[y][x]];
    const board = (x, y) => {
      const c = map[y][x], h = hAt(x, y);
      if (c === 1) return { h, top: 'forest', side: 'earth' };
      if (c === 2) return { h, top: 'rock', side: 'rock' };
      if (c === 3 || c === 4) return { h, top: 'bed', side: 'earth' };
      if (c === 5) return { h, top: 'stone', side: 'wall' };
      return { h, top: floor[0], side: floor[1] };
    };
    // The country beyond the board: level near it, then terraces rising into hills, dimmer with distance.
    const apron = (x, y) => {
      const cx = Math.max(0, Math.min(GW - 1, x)), cy = Math.max(0, Math.min(GH - 1, y)), dd = Math.max(cx - x, x - cx, cy - y, y - cy);
      const c0 = map[cy][cx], n = vnoise(x * 0.2, y * 0.2, seed), m = vnoise(x * 0.08, y * 0.08, seed + 1);
      const shade = Math.max(0.4, 0.78 - (dd - 1) * 0.045);
      const hill = Math.floor(Math.max(0, dd - 3) * (0.12 + m * 0.22) * (0.6 + n * 0.8) / 0.2) * 0.2;
      const h = (c0 === 2 && dd < 2 ? hAt(cx, cy) * 0.8 : H0) + hill;
      // no woods on the near side: their trees would stand between the camera and the front row (N09)
      const near = y >= GH && dd <= 3;
      const kind = h > 1.4 ? 'rock' : !near && ((c0 === 1 && dd < 3) || n > 0.6) ? 'forest' : t === 1 ? 'sand' : 'grass';
      return { h, top: kind, side: kind === 'rock' ? 'rock' : kind === 'sand' ? 'dirt' : 'earth', shade, d: dd, kind };
    };
    const NX = GW + APRON * 2, NZ = GH + APRON * 2, grid = [], ring = [];
    for (let Y = 0; Y < NZ; Y++) for (let X = 0; X < NX; X++) {
      const x = X - APRON, y = Y - APRON;
      if (inside(x, y)) grid.push(board(x, y)); else { const c = apron(x, y); grid.push(c); ring.push({ x, y, ...c }); }
    }
    { const t = buildTerrain({ W: NX, H: NZ, wx: (X) => wx(X - APRON), wz: (Y) => wz(Y - APRON), cell: (X, Y) => grid[Y * NX + X] }); t.userData.ground = true; set.add(t); }
    // Set dressing: woods, grass among the men, rocks, reeds on the banks.
    const S = { plains: [], forests: [], sands: [], mountains: [], banks: [], castle: null, outskirts: [], villages: [], wildForests: [], wildRocks: [] };
    const spot = (x, y) => ({ x: wx(x), z: wz(y), h: hAt(x, y) });
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const c = map[y][x];
      if (c === 0) (t === 1 ? S.sands : t === 5 ? [] : S.plains).push(spot(x, y));
      else if (c === 1) S.forests.push(spot(x, y));
      else if (c === 2) S.mountains.push(spot(x, y));
      if (c === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(x + dx, y + dy) && map[y + dy][x + dx] === 3) S.banks.push({ ...spot(x, y), dx, dy });
    }
    for (const c of ring) {
      const sp = { x: wx(c.x), z: wz(c.y), h: c.h };
      if (c.kind === 'forest') S.wildForests.push(sp);
      else if (c.kind === 'rock') S.wildRocks.push(sp);
      else if (c.d < 3) (t === 1 ? S.sands : S.plains).push(sp);
    }
    billboards = dressBoard(set, S, seed).billboards;
    water = null;
    if (map.some((row) => row.some((c) => c === 3 || c === 4))) {
      const wt = azureWaterTex().clone(); wt.needsUpdate = true; wt.repeat.set(GW / 2 + APRON, GH / 2 + APRON);
      water = new THREE.Mesh(new THREE.PlaneGeometry(GW + APRON * 2, GH + APRON * 2), new THREE.MeshStandardMaterial({ map: wt, transparent: true, opacity: 0.88, roughness: 0.32, emissive: '#0a3a62', emissiveIntensity: 0.25 }));
      water.rotation.x = -Math.PI / 2; water.position.y = 0.26; water.receiveShadow = true; water.userData.water = true; set.add(water);
    }
    seasonalize(set, place);
    // faint tactical grid so squares stay legible under the depth of field
    const grid2 = new THREE.GridHelper(GW, GW, '#000000', '#000000');
    grid2.scale.z = GH / GW; grid2.position.y = H0 + 0.012; grid2.material.transparent = true; grid2.material.opacity = 0.08; set.add(grid2);
    cellH = (x, y) => (inside(x, y) ? raised(x, y) ?? Math.min(hAt(x, y), H0) : H0);
  }

  // What the last build laid besides the men (ground, water, walls, woods, banners) and what it was laid for: the
  // 布阵 picker deploys the field, and the chosen formation redeploys the same battle on the same ground, which then
  // stays and only the men are made again (PERF-05: the ground's bake was most of the pause after the pick).
  let laid = null;
  const sameField = (b, looks) => !!laid && laid.b === b && laid.G === tacticalGround(where.month, where.city) && laid.month === where.month && laid.city === where.city && laid.a === looks.a && laid.d === looks.d;
  // troops: each side's pack troop looks ({ a: { soldier: 'ashigaru' }, d: null }, core/game.js factionTroops); a look whose
  // strips are not loaded (the release packages leave them out) wears its original kind's.
  let wear = {};
  function build(b, looks, troops = {}) {
    wear = troops || {};
    const T0 = performance.now(); // tools/scene_switch_trace.mjs (PERF-05): measures only
    blast.clear(); aim?.(null);
    if (set && sameField(b, looks)) {
      const gone = set.children.filter((o) => !laid.kids.has(o));
      for (const o of gone) { o.traverse((x) => x.isCSS2DObject && x.element.remove()); set.remove(o); }
      units = new Map(); battle = b; marching.clear(); corpses = [];
      { const t = performance.now(); for (const u of b.units) addUnit(u, looks[u.side]); performance.measure('tac:units', { start: t }); }
      release(gone, scene, Object.values(T));
      performance.measure('tac:build', { start: T0 });
      return;
    }
    const old = set;
    if (set) { set.traverse((o) => o.isCSS2DObject && o.element.remove()); scene.remove(set); }
    set = new THREE.Group(); scene.add(set); units = new Map(); battle = b; marching.clear(); corpses = [];
    ground(b);
    performance.measure('tac:ground', { start: T0 });
    // edge banners mark each side's retreat edge
    const G = tacticalGround(where.month, where.city);
    if (G?.banners) for (const [s, x] of [['a', -1.4], ['d', GW + 0.4]]) for (const y of [1, GH - 2]) {
      // the cloth hangs toward the board from the pole
      const bn = bannerMesh(G, looks[s], s === 'a' ? 1 : -1); bn.position.set(wx(x), cellH(Math.max(0, Math.min(GW - 1, x | 0)), y) - 0.02, wz(y)); set.add(bn);
    }
    else for (const [s, x] of [['a', -1.6], ['d', GW + 0.6]]) for (const y of [1, GH - 2]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.06), new THREE.MeshStandardMaterial({ color: '#3a2a1c' }));
      pole.position.set(wx(x), H0 + 1.1, wz(y)); pole.castShadow = true; set.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshStandardMaterial({ color: looks[s] === 'attacker' ? '#2f6fb8' : '#b83a2f', side: THREE.DoubleSide, emissive: looks[s] === 'attacker' ? '#0a2a60' : '#5a0a08', emissiveIntensity: 0.4 }));
      flag.position.set(wx(x) + 0.38, H0 + 1.7, wz(y)); flag.userData.flag = true; flag.castShadow = true; set.add(flag);
    }
    laid = { b, G, month: where.month, city: where.city, a: looks.a, d: looks.d, kids: new Set(set.children) };
    { const t = performance.now(); for (const u of b.units) addUnit(u, looks[u.side]); performance.measure('tac:units', { start: t }); }
    // The last field's meshes, cards and their texture copies, once nothing in the new one shares them.
    if (old) release([old], scene, Object.values(T));
    performance.measure('tac:build', { start: T0 });
  }

  // ---------- Men ----------
  // Each man is a holder on the ground (his feet at its origin) with a camera-facing plane showing one cell
  // of his strip, a proxy of the same plane turned to the sun that only casts his shadow, and a contact blob.
  function strips(look, u) {
    if (u.kind === 'gen') {
      // Without strips of his own he rides as his side's generic general in the weapon class he holds (core/pack.js genericArt).
      const S = battle.side[u.side], id = S.id, A = sprites[`duel-${id}`] || (sprites[`officer-${id}`] ? null : sprites[`duel-${genericArt(look, S.o?.weapon)}`] || sprites[`duel-${look}`]);
      return [A || { tex: sprites[`officer-${id}`] || sprites[look] || unitTex(look), meta: null }];
    }
    const kind = KIND[u.kind], alt = wear[u.side]?.[kind], own = alt && sprites[`troop-${look}-${alt}`] ? alt : kind;
    const k = `troop-${look}-${own}`, list = [sprites[k], sprites[`${k}-v2`]].filter(Boolean);
    return list.length ? list : [{ tex: sprites[`${look}-${KIND[u.kind]}`] || sprites[`${look}-soldier`] || unitTex(look, 'soldier'), meta: null }];
  }
  // One camera-facing card of a strip (with its shadow proxy): the side strip, or the front / back one.
  function card(A, kind, face, shade, line) {
    const { meta } = A, img = A.tex.image, n = meta ? meta.frames.length : 1;
    // A pack troop look (core/pack.js TROOP_LOOKS) keeps its borrowed kind's pixel scale (meta.ref): the elephant towers over a horse.
    const [cw, ch] = meta ? meta.cell : [img.width, img.height], figH = meta ? meta.ref ?? meta.figH : img.height;
    const unit = FIG[kind] / figH, tex = A.tex.clone(); tex.repeat.set(1 / n, 1); tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(cw * unit, ch * unit); geo.translate((cw / 2 - (meta ? meta.anchor : cw / 2)) * unit, (ch * unit) / 2, 0);
    // emissive (map-shaped, off at rest) is only the hit flash
    const mat = troopLit(skyLit(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0 })), new THREE.Vector2(1 / img.width, 1 / img.height), face, line);
    mat.color.setScalar(shade);
    // Leaned back a little toward the high camera, so the men are not foreshortened into squat cards.
    const plane = new THREE.Mesh(geo, mat); plane.scale.x = face; plane.receiveShadow = true; plane.rotation.x = -TILT;
    const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
    proxy.castShadow = true; proxy.scale.x = face;
    return { plane, proxy, tex, mat, meta, unit };
  }
  function man(A, kind, face, r, line) {
    const side = card(A, kind, face, 0.88 + r() * 0.12, line);
    // The front / back card is never mirrored, so the shield and spear stay in the hands they were drawn in.
    const tv = A.turn ? card(A.turn, kind, 1, side.mat.color.r, line) : null;
    const blob = new THREE.Mesh(blobGeo, blobMat); blob.position.y = 0.012;
    const bw = kind === 'cav' ? 0.5 : kind === 'gen' ? 0.8 : 0.26; blob.scale.set(bw, 1, bw * 0.45);
    const holder = new THREE.Group(); holder.add(side.plane, side.proxy, blob);
    if (tv) { holder.add(tv.plane, tv.proxy); tv.plane.visible = tv.proxy.visible = false; }
    holder.scale.setScalar(kind === 'gen' ? 1 : 0.93 + r() * 0.14);
    const M = { holder, ...side, tv, blob, face, dir: 'side', kind, loop: 'idle', loopT: r() * 1400, frame: null, busy: false,
      base: new THREE.Vector3(), off: new THREE.Vector3(), k: 11 + r() * 7, delay: r() * 110 };
    show(M, 'idle_a');
    return M;
  }
  // A frame the front / back strip has is shown on that card; any other (the side clips, falling, the dead)
  // on the side card.
  function show(M, f) {
    M.frame = f; if (!M.meta) return;
    const ti = M.tv ? M.tv.meta.frames.indexOf(f) : -1, onTurn = ti >= 0;
    if (M.tv) { M.tv.plane.visible = M.tv.proxy.visible = onTurn; M.plane.visible = M.proxy.visible = !onTurn; }
    if (onTurn) { M.tv.tex.offset.x = ti / M.tv.meta.frames.length; return; }
    let i = M.meta.frames.indexOf(f); if (i < 0) i = M.meta.frames.indexOf(FRAME_ALIAS[f]);
    if (i >= 0) M.tex.offset.x = i / M.meta.frames.length;
  }
  const mats = (M) => (M.tv ? [M.mat, M.tv.mat] : [M.mat]);
  const clipOf = (M, c) => (M.dir !== 'side' && M.tv?.meta.clips[`${M.dir}:${c}`]) || M.meta?.clips[c] || M.meta?.clips[CLIP_ALIAS[c]] || FALLBACK[c] || FALLBACK.idle;
  function runLoop(M, dt) {
    if (M.busy || !M.loop) return;
    const c = clipOf(M, M.loop), total = c.reduce((a, f) => a + f[1], 0);
    M.loopT = (M.loopT + (dt * 1000 * speed) / PACE) % total;
    let t = M.loopT; for (const [f, ms] of c) { if (t < ms) { if (M.frame !== f) show(M, f); break; } t -= ms; }
  }
  // Play a clip once; onEvent gets its 'hit' / 'loose' marks. The man goes back to his loop after.
  async function playClip(M, c, onEvent, { hold = false } = {}) {
    M.busy = true;
    for (const [f, ms, ev] of clipOf(M, c)) { show(M, f); await sleep(d(ms)); if (ev) onEvent?.(ev); }
    if (!hold) { M.busy = false; show(M, 'idle_a'); }
  }
  function addUnit(u, look) {
    const g = new THREE.Group(), face = u.side === 'd' ? -1 : 1, r = rng((u.x * 31 + u.y * 7 + (u.side === 'd' ? 500 : 0)) | 0);
    // Squads alternate between the arm's two looks, so a line of them is not one man copied.
    const body = new THREE.Group(), list = strips(look, u), M = man(list[u.idx % list.length], u.kind, face, r, null);
    M.base.set(0, BASE_H, 0.05); M.holder.position.copy(M.base); body.add(M.holder);
    const men = [M];
    const wide = u.kind === 'gen' || u.kind === 'cav';
    const ring = new THREE.Group(), disc = new THREE.Mesh(BASE_GEO, baseMat[look]), rim = new THREE.Mesh(RIM_GEO, rimMat[look]);
    disc.receiveShadow = true; ring.add(disc, rim); ring.userData.part = 'base'; ring.userData.look = look; ring.traverse((o) => { o.userData.noSeason = true; });
    ring.scale.set(wide ? 0.95 : 0.72, 1, wide ? 0.78 : 0.6);
    g.add(ring, body);
    const el = document.createElement('div'); el.className = `tk ${look} ${u.kind}`;
    // Every tag lies at the unit's feet: no height over a general clears them all (a chariot's canopy, a raised blade), and nothing may cover his head.
    const lab = new CSS2DObject(el); lab.position.y = 0.05; g.add(lab);
    g.position.set(wx(u.x), cellH(u.x, u.y), wz(u.y)); set.add(g);
    units.set(u, { g, body, el, ring, look, men, alive: [...men], face, last: g.position.clone(), phase: r() * 6, moving: false });
    tag(u);
  }
  // The squad turns to its heading: along a row the side strip, mirrored to face left or right; along a
  // column the front strip (toward the camera, +y) or the back strip (away from it).
  function turn(v, dx, dy = 0) {
    const dir = dx ? 'side' : dy > 0 ? 'front' : dy < 0 ? 'back' : null;
    if (!dir) return;
    for (const M of v.alive) {
      if (dx) { M.face = dx; M.plane.scale.x = M.proxy.scale.x = dx; M.mat.userData.u.uFace.value = dx; }
      if (M.dir !== dir) { M.dir = dir; if (!M.busy) show(M, clipOf(M, M.loop || 'idle')[0][0]); }
    }
  }
  // The tactic badges on a unit's tag (暴力倾向@devblog, 2026-11-13): one character over the troop chip for each effect that
  // works on it (core/tactical.js effects()), a hindrance in red; the general's 咒缚 carries the rounds left.
  const FX_CHAR = { bind: '缚', xbow: '弩', fire: '火', morale: '气' };
  const badges = (u) => { const l = battle.effects(u.side).filter((e) => e.on === 'all' || e.on === u.kind);
    return l.length ? `<span class="fxs">${l.map((e) => `<b class="fx-${e.id}${e.bad ? ' bad' : ''}"${e.bad ? ` data-n="${e.n}"` : ''}>${FX_CHAR[e.id]}</b>`).join('')}</span>` : ''; };
  // Every tag again: a tactic took, a round ended (the counters tick down) or a 单挑 is over.
  function retag() { for (const [u, v] of units) if (v.g.visible && !u.dead && !u.out) tag(u); }
  function tag(u) {
    const v = units.get(u); if (!v) return;
    const S = battle.side[u.side];
    if (u.kind === 'gen') {
      // his 体力 with the capture gate on the bar; under it the bar turns gold (可擒 / 危)
      const gate = battle.captureGate(u.side), low = gate != null && S.hp < gate, hp = Math.max(0, S.hp);
      v.el.innerHTML = `<i class="sb${low ? ' low' : ''}" style="--w:${hp}%;${gate != null ? `--gate:${gate}%` : ''}" data-n="${hp}${low ? (u.side === battle.human ? ' 危' : ' 可擒') : ''}">${gate != null ? '<u></u>' : ''}${badges(u)}</i>`;
      return;
    }
    // A squad holds at most 100 men (core/tactical.js splits ceil(N/100) ways), so the bar is out of 100.
    v.el.innerHTML = `<i class="sb" style="--w:${Math.max(0, u.hp)}%" data-n="${Math.max(0, u.hp)}">${u.hp > 0 ? badges(u) : ''}</i>`;
    if (u.hp <= 0) for (const M of [...v.alive]) fall(v, M, 60 + Math.random() * 120);
  }
  // A man drops where he stands and stays there, laid on the ground with the field's other dead.
  async function fall(v, M, delay = 0) {
    v.alive.splice(v.alive.indexOf(M), 1);
    M.busy = true; await sleep(d(delay));
    M.dir = 'side'; // men fall and lie on the side strip
    await playClip(M, 'fall', null, { hold: true });
    show(M, 'dead');
    const p = new THREE.Vector3(); M.holder.getWorldPosition(p);
    set.attach(M.holder); M.holder.position.copy(p); M.holder.rotation.set(0, 0, 0);
    M.plane.rotation.order = 'YXZ'; M.plane.rotation.x = -0.8; M.plane.rotation.z = (Math.random() - 0.5) * 0.3; M.proxy.castShadow = false;
    // Shrunk a little and scattered, so a fallen rank reads as bodies rather than one long log.
    M.holder.scale.multiplyScalar(0.82); M.holder.position.x += (Math.random() - 0.5) * 0.3; M.holder.position.z += (Math.random() - 0.5) * 0.22;
    M.holder.position.y -= (M.meta?.rest ?? 0) * M.unit * M.holder.scale.y;
    M.mat.color.multiplyScalar(0.85); M.mat.userData.u.uFoot.value = 1; M.mat.userData.u.uLineK.value = 0; M.blob.scale.set(M.blob.scale.x * 1.6, 1, M.blob.scale.z);
    corpses.push(M);
  }
  function popup(text, at, cls) {
    const el = document.createElement('div'); el.className = `dmg ${cls}`; el.textContent = text;
    const o = new CSS2DObject(el); o.position.copy(at); scene.add(o);
    animate(d(1000), (k) => { o.position.y = at.y + k * 0.8; el.style.opacity = String(k < 0.65 ? 1 : (1 - k) / 0.35); }, () => scene.remove(o));
  }
  const posOf = (u) => units.get(u).g.position;
  const flash = (u, k = 1.4) => { const v = units.get(u); v.body.traverse((m) => { if (m.material?.emissive) m.material.emissiveIntensity = k; }); setTimeout(() => v.body.traverse((m) => { if (m.material?.emissive) m.material.emissiveIntensity = m.userData.glow ?? 0; }), d(110)); };
  const worldOf = (M) => M.holder.getWorldPosition(new THREE.Vector3());
  const arrowGeo = new THREE.BoxGeometry(0.016, 0.016, 0.28), arrowMat = new THREE.MeshBasicMaterial({ color: '#e8dcbc' });
  const fireArrowMat = new THREE.MeshBasicMaterial({ color: '#ffb050' }), fireHeadMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffa040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // fire: a 火矢 arrow, its head a flickering flame (the shaft points along +z, toward the target).
  function arrow(from, to, fire = false) {
    const m = new THREE.Mesh(arrowGeo, fire ? fireArrowMat : arrowMat);
    if (fire) { const head = new THREE.Sprite(fireHeadMat); head.position.z = 0.14; head.scale.setScalar(0.45); m.add(head); }
    set.add(m); const a = from.clone(), b = to.clone();
    const arc = 0.8 + a.distanceTo(b) * 0.12;
    return animate(d(300), (k) => { m.position.lerpVectors(a, b, k); m.position.y += Math.sin(k * Math.PI) * arc; m.lookAt(b.x, m.position.y - (k - 0.5) * arc * 2, b.z); }, () => set.remove(m));
  }
  const clash = (p) => { focus.goal = p.clone(); focus.until = time + 1.6; };
  // The painted ground's height at (x, z): its relief rises over cellH's flat board height in places, and a mark
  // laid on the ground (爆炎's scorch) must sit on it.
  const down = new THREE.Raycaster(), downFrom = new THREE.Vector3(), downDir = new THREE.Vector3(0, -1, 0);
  const groundY = (x, z, fallback) => {
    const floors = []; set?.traverse((o) => o.userData.ground && floors.push(o));
    down.set(downFrom.set(x, 30, z), downDir);
    return down.intersectObjects(floors, true)[0]?.point.y ?? fallback;
  };
  // Every man of the attacking squad plays the clip a beat apart; resolves at the first man's mark.
  function volley(v, c, onMark) {
    let first = true;
    return new Promise((res) => {
      const order = [...v.alive].sort((a, b) => a.delay - b.delay);
      if (!order.length) return res();
      order.forEach((M, i) => setTimeout(() => playClip(M, c, (ev) => { onMark?.(M, ev); if (first && (ev === 'hit' || ev === 'loose')) { first = false; res(); } }), d(i ? M.delay : 0)));
      setTimeout(res, d(900)); // a strip without marks still lands
    });
  }
  function reel(t) {
    const v = units.get(t); if (!v) return;
    for (const M of v.alive) if (!M.busy && Math.random() < 0.6) setTimeout(() => !M.busy && playClip(M, 'hurt'), d(Math.random() * 120));
  }

  // Steps of a round march together: each move starts a beat after the last instead of waiting for it,
  // and anything else (a blow, an exit, the round marker) first lets every running step land.
  const marching = new Map();
  const settle = () => Promise.all(marching.values());
  async function play(ev, hooks) {
    if (!ev) return;
    const v = ev.u && units.get(ev.u);
    if (ev.type !== 'move') await settle();
    switch (ev.type) {
      case 'move': {
        await marching.get(ev.u);
        const from = v.g.position.clone(), to = new THREE.Vector3(wx(ev.to[0]), cellH(ev.to[0], ev.to[1]), wz(ev.to[1]));
        turn(v, Math.sign(ev.to[0] - ev.from[0]), Math.sign(ev.to[1] - ev.from[1]));
        if (ev.u.kind === 'cav' || ev.u.kind === 'gen') hooks.sfx?.('sfx-step');
        v.moving = true;
        const step = animate(d(150), (k) => { v.g.position.lerpVectors(from, to, ease(k)); }).then(() => {
          if (ev.u.kind === 'cav' && Math.random() < 0.3) dustPuff(scene, v.g.position.clone().setY(to.y + 0.15), 0.5);
          if (marching.get(ev.u) === step) { marching.delete(ev.u); v.moving = false; }
        });
        marching.set(ev.u, step);
        await sleep(d(30));
        break;
      }
      case 'attack': {
        const a = v.g.position.clone(), tv = units.get(ev.t), b = posOf(ev.t).clone();
        { const dx = ev.t.x - ev.u.x, dy = ev.t.y - ev.u.y; turn(v, Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0, Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0); }
        clash(b);
        const land = () => {
          flash(ev.t); sparkBurst(scene, b.clone().setY(b.y + 0.5), ev.kill ? 40 : 14, ev.fire ? '#ff9a40' : ev.ranged ? '#ffe8a0' : '#ffd070');
          // 火矢: the arrows set the struck squad alight for a moment
          if (ev.fire) { const at = b.clone().setY(b.y + 0.7); flames(scene, at, '#ff9a50', { n: 6, spread: 0.35, h: 0.9, ms: d(800) }); embers(scene, at, 14, '#ff7a30', { spread: 0.35, rise: 1.4, size: 0.3, ms: d(800) }); }
          popup(ev.dmg ? `-${ev.dmg}` : '0', b.clone().setY(b.y + 1.0), tv.look);
          reel(ev.t); tag(ev.t); hooks.update?.();
        };
        if (ev.ranged) {
          // Each archer looses his own arrow at a man of the target squad; the first to land is the hit.
          hooks.sfx?.('sfx-select');
          let landed = null;
          const targets = tv.alive.length ? tv.alive : [{ holder: tv.g }];
          await volley(v, v.men[0]?.meta?.clips.volley ? 'volley' : 'attack', (M) => {
            const T2 = targets[Math.floor(Math.random() * targets.length)], to = T2?.holder ? worldOf(T2).add(new THREE.Vector3(0, 0.3, 0)) : b;
            const fly = arrow(worldOf(M).add(new THREE.Vector3(0.1 * M.face, 0.42, 0)), to, ev.fire);
            landed ??= fly;
          });
          await landed; land(); hooks.sfx?.('sfx-volley-land'); // the original's 93 as the arrows reach them (bank14 $A744, D44)
        } else {
          // The squad charges a third of the way in (the men trail it), strikes, then falls back to its cell.
          const mid = a.clone().lerp(b, ev.u.kind === 'cav' ? 0.5 : 0.36);
          v.moving = true;
          const lunge = animate(d(200), (k) => v.g.position.lerpVectors(a, mid, ease(k)));
          await volley(v, 'attack');
          await lunge; v.moving = false;
          slash(scene, b.clone().setY(b.y + 0.55), ev.u.side === 'd', ev.u.kind === 'gen' ? 1.5 : 0.9);
          hooks.sfx?.('sfx-clash');
          land();
          // The fall back runs on while the blow's result plays, and counts as a step of this squad: whatever it does next
          // (a rider's second action rides on after a kill) starts from its cell once it is back there. Left untracked, a
          // step that began meanwhile was overwritten and the squad was drawn on the cell it had left (D38, 2026-11-10).
          const back = animate(d(220), (k) => v.g.position.lerpVectors(mid, a, ease(k))).then(() => { if (marching.get(ev.u) === back) marching.delete(ev.u); });
          marching.set(ev.u, back);
        }
        if (ev.kill) await kill(ev.t);
        else if (ev.spared) { popup('被俘!', posOf(ev.t).clone().setY(2.2), units.get(ev.t).look); await kill(ev.t, { fade: true }); } // 武将不战死
        else await sleep(d(60));
        if (ev.t.kind === 'gen' || ev.dmg >= 30) shake = 0.12;
        // he turned to strike; the original writes his facing back once the stroke is done (core/tactical.js faceOf), and
        // his 爆炎 flies that way, so the figure shows it again
        if (battle.faceOf) turn(v, ...battle.faceOf(ev.u));
        break;
      }
      case 'exit': {
        // The squad turns and runs for its own edge, fading out over the board's rim.
        const dir = ev.u.side === 'a' ? -1 : 1, p = ev.pursuit;
        turn(v, dir);
        v.moving = true;
        // A general is pursued at the rim (core/tactical.js pursue()): the HUD names it, the blow lands on him there and
        // his bar takes it before he goes, so the HP never changes after he has gone; a pursuit that kills him fells him.
        if (p) {
          // on the cell he leaves from: the board's rim is the screen's edge, so the numbers stand a cell inward
          clash(posOf(ev.u));
          v.moving = false;
          await hooks.pursuit?.(ev);
          const at = posOf(ev.u).clone(); at.x -= dir * 0.9;
          if (p.hit) {
            hooks.sfx?.('sfx-clash'); flash(ev.u, 1.8); sparkBurst(scene, posOf(ev.u).clone().setY(at.y + 0.5), 24, '#ffd070');
            popup(`-${p.dmg}`, at.clone().setY(at.y + 1.0), `${v.look} heavy`); reel(ev.u); tag(ev.u); hooks.update?.(); shake = 0.12;
            await sleep(d(560));
          } else { popup('脱身', at.clone().setY(at.y + 1.0), 'word'); await sleep(d(360)); }
          if (p.fell) {
            if (p.fell !== 'dead') popup('被俘!', at.clone().setY(2.2), v.look);
            await kill(ev.u, { fade: p.fell !== 'dead' }); hooks.update?.(); break;
          }
          turn(v, dir); v.moving = true;
        }
        for (const M of v.alive) for (const m of mats(M)) m.transparent = true;
        await animate(d(480), (k) => { v.g.position.x += dir * 0.045; for (const M of v.alive) { for (const m of mats(M)) m.opacity = 1 - k; M.blob.visible = k < 0.5; } });
        hide(v); hooks.update?.(); break;
      }
      case 'tactic': await hooks.tactic?.(ev); await tacticFx(ev, hooks); retag(); break;
      case 'capture': popup('被俘!', posOf(ev.u).clone().setY(2.2), units.get(ev.u).look); await kill(ev.u, { fade: true }); break;
      case 'round': retag(); hooks.round?.(ev); await sleep(d(120)); break;
      // Back from a 单挑: the generals' bars take the HP the duel left them, and one slain or taken falls.
      case 'duelEnd': for (const s of ['a', 'd']) { const gu = battle.gen(s); tag(gu); if (gu.dead || gu.out) await kill(gu, { fade: battle.side[s].fate !== 'dead' }); } hooks.update?.(); break;
      case 'idle': break;
    }
  }
  // CSS2D labels ignore their parent's visibility, so hide them explicitly.
  function hide(v) { v.g.visible = false; v.g.traverse((o) => o.isCSS2DObject && (o.visible = false)); }
  // The rest of the squad goes down a beat apart and stays on the field; a captive general is led off (fades).
  async function kill(u, { fade = false } = {}) {
    const v = units.get(u); dustPuff(scene, v.g.position.clone().setY(v.g.position.y + 0.2), u.kind === 'gen' ? 1.4 : 0.8);
    if (fade) {
      for (const M of v.men) for (const m of mats(M)) m.transparent = true;
      await animate(d(320), (k) => { for (const M of v.men) { for (const m of mats(M)) m.opacity = 1 - k; M.blob.visible = false; } });
    } else await Promise.all([...v.alive].map((M, i) => fall(v, M, i * 70 + Math.random() * 60)));
    hide(v);
  }
  // 爆炎's landing, shown on the ground while the player points at the tactic (tacticalhud.js): the 3×3 two cells along
  // the general's facing (core/tactical.js blastAt). cells: [cx, cy], or null to clear.
  const aimMat = new THREE.MeshBasicMaterial({ color: '#ff7a30', transparent: true, opacity: 0.38, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const aimTiles = Array.from({ length: 9 }, () => { const m = new THREE.Mesh(blobGeo, aimMat); m.scale.setScalar(0.92); m.visible = false; m.renderOrder = 5; m.userData.noSeason = true; scene.add(m); return m; });
  function aim(at) {
    aimTiles.forEach((m, i) => {
      const x = at && at[0] + (i % 3) - 1, y = at && at[1] + Math.floor(i / 3) - 1;
      m.visible = !!at && x >= 0 && y >= 0 && x < GW && y < GH;
      if (m.visible) m.position.set(wx(x), groundY(wx(x), wz(y), cellH(x, y)) + 0.03, wz(y));
    });
  }
  async function tacticFx(ev, hooks = {}) {
    if (!ev.ok) return;
    const own = battle.gen(ev.side), foe = battle.gen(ev.side === 'a' ? 'd' : 'a');
    aim(null);
    if (ev.id === 'blast' && (ev.center || ev.toward)) {
      // 爆炎 (src/blastfx.js): the general winds up and throws on his strike, the way he faces; the blow lands as the bomb
      // goes off. Thrown off the board (ev.center null, the original's B440) the pot flies out over the edge and nothing bursts.
      const v = units.get(own), M = v?.alive[0], [fx, fy] = ev.toward ?? [own.side === 'a' ? 1 : -1, 0];
      if (v) turn(v, fx, fy);
      const [cx, cy] = ev.center ?? [own.x + 2 * fx, own.y + 2 * fy], to = new THREE.Vector3(wx(cx), 0, wz(cy));
      to.y = groundY(to.x, to.z, cellH(Math.min(GW - 1, Math.max(0, cx)), Math.min(GH - 1, Math.max(0, cy))));
      if (M && !M.busy) await new Promise((res) => { playClip(M, 'attack', (e) => e === 'hit' && res()); setTimeout(res, d(500)); });
      const from = posOf(own).clone(); from.y += 1.05; from.x += 0.25 * (fx || 0);
      if (!ev.center) { await blast.play({ from, to, d, dud: true }); return; }
      clash(to);
      await blast.play({ from, to, d, shake: (k) => { shake = Math.max(shake, k); },
        onBurst: () => { hooks.sfx?.('sfx-blast'); for (const h of ev.hits) { popup(`-${h.dmg}`, posOf(h.u).clone().setY(1.2), units.get(h.u).look); flash(h.u); reel(h.u); tag(h.u); if (h.u.dead || h.u.out) kill(h.u, { fade: h.u.kind === 'gen' && battle.side[h.u.side].fate !== 'dead' }); } } });
      await sleep(d(200));
    } else {
      const target = ev.id === 'bind' ? foe : own, p = posOf(target).clone();
      // 火矢: every archer squad of the side lights its arrows
      if (ev.id === 'fire') for (const [u, v] of units) if (u.side === ev.side && u.kind === 'arc' && v.g.visible) {
        const at = v.g.position.clone().setY(v.g.position.y + 0.75);
        flare(scene, at, '#ffb050', { size: 1.4, ms: d(420) }); flames(scene, at, '#ff9a50', { n: 5, spread: 0.3, h: 0.9, ms: d(900) }); embers(scene, at, 12, '#ff8a30', { spread: 0.3, rise: 1.2, size: 0.3, ms: d(900) });
      }
      if (ev.id === 'morale') for (const v of units.values()) if (v.g.visible && v.look === units.get(own).look) for (const M of v.alive) if (!M.busy) setTimeout(() => playClip(M, 'cheer'), d(Math.random() * 200));
      const ringM = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 32), new THREE.MeshBasicMaterial({ color: { bind: '#c070ff', xbow: '#7ad0ff', fire: '#ff8a30', morale: '#ffe070', taunt: '#ff5040' }[ev.id] || '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ringM.rotation.x = -Math.PI / 2; ringM.position.copy(p).setY(p.y + 0.05); set.add(ringM);
      await animate(d(600), (k) => { ringM.scale.setScalar(1 + k * 5); ringM.material.opacity = 1 - k; }, () => drop(set, ringM));
    }
  }

  const tmp = new THREE.Vector3();
  return {
    scene, camera,
    build, play, tag, settle, aim,
    // The war this 白兵 belongs to: { month, city } (the battlefield's seat sets the latitude).
    setPlace(p) { where = p; place = env.set(p); loading = loadTacticalGround(p.month, p.city).catch((e) => console.warn('白兵 ground', e)); },
    // The painted field's materials for the place set last (build() falls back to tiles without them).
    ready() { return loading; },
    setSpeed(s) { speed = s; },
    setInsets(top = 0, bottom = 0, left = 0, right = 0) { Object.assign(inset, { top, bottom, left, right }); },
    update(dt) {
      time += dt; shake *= Math.pow(0.003, dt);
      // The framing was tuned at ~16:10; pull back on narrower windows so all 16 columns stay in view.
      // With the battle HUD up, fit the board to the screen: the rows (row 0's sprites down to row 9's
      // ground) to the band between the top cards and the console, the columns (the near row's corners,
      // the widest) to the width, coming in as close as the tighter of the two allows (N09: the men read
      // at play size), then lift the picture with a view offset so the rows sit centred in that band.
      const ih = innerHeight, iw = innerWidth, k = 1 - Math.exp(-dt * 4), hud = inset.top + inset.bottom > 0;
      const dist = cam.dist * Math.max(1, 1.55 / camera.aspect) * fit, pitch = 0.86;
      const target = camGoal.set(cam.look.x + Math.sin(cam.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, cam.look.z + Math.cos(cam.yaw) * Math.cos(pitch) * dist);
      cam.pos.lerp(target, 1 - Math.exp(-dt * 3)); // eased by time, the same at 30 and 144 fps
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
      if (camera.view) camera.clearViewOffset();
      if (hud) {
        camera.updateMatrixWorld();
        const py = (x, y, z) => ((1 - edge.set(x, y, z).project(camera).y) / 2) * ih;
        const band = Math.max(80, ih - inset.top - inset.bottom);
        let a, b, half, low = 0.5;
        if (PHONE) {
          // A phone's screen is too short for the whole board: its men would be a few pixels high. The picture follows the
          // fighting instead: the box round the units still standing (never less than 9 columns by 5 rows), eased, so the
          // camera closes in as the lines meet and nothing in the fight is left out.
          let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (const v of units.values()) { if (!v.g.visible) continue; const p = v.g.position; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
          if (x0 > x1) { x0 = -GW / 2; x1 = GW / 2; z0 = wz(0); z1 = wz(GH - 1); }
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = Math.max(4.5, (x1 - x0) / 2 + 1.6), hd = Math.max(2.5, (z1 - z0) / 2 + 1.2);
          cam.look.x += (cx - cam.look.x) * k * 0.6; cam.look.z += (cz + 1.1 - cam.look.z) * k * 0.6;
          a = py(cx, 1.2, cz - hd); b = py(cx, H0, cz + hd);
          half = Math.max(...[-1, 1].map((sx) => Math.abs(edge.set(cx + sx * hw, H0, cz + hd).project(camera).x)));
          // the orders and the tactics stand by the left and right edges: the lines keep to the width between them, centred there
          const side = inset.left + inset.right, room = side > 0 ? Math.max(0.5, (iw - side) / iw) : 0.84;
          half /= room; low = 0.2;
          if (side > 0) { const mid = ((edge.set(cx, H0, cz).project(camera).x + 1) / 2) * iw; shiftX += (mid - (inset.left + (iw - side) / 2) - shiftX) * k; }
          else shiftX += (0 - shiftX) * k;
        } else {
          a = py(0, 1.2, wz(0) - 0.5); b = py(0, H0, wz(GH - 1) + 0.5);
          half = Math.max(...[-1, 1].map((sx) => Math.abs(edge.set(sx * (GW / 2), H0, wz(GH - 1) + 0.5).project(camera).x)));
        }
        const over = Math.max((b - a) / band / 0.96, half / 0.97);
        fit = Math.min(2.5, Math.max(low, fit * (1 + (over - 1) * k)));
        shift += ((a + b) / 2 - (inset.top + band / 2) - shift) * k;
      } else { fit += (1 - fit) * k; shift += (0 - shift) * k; shiftX += (0 - shiftX) * k; if (PHONE) { cam.look.x += (0 - cam.look.x) * k; cam.look.z += (1.1 - cam.look.z) * k; } }
      if (Math.abs(shift) > 0.5 || Math.abs(shiftX) > 0.5) camera.setViewOffset(iw, ih, shiftX, shift, iw, ih);
      camera.position.add(shakeOffset(time, shake, shakeV));
      sky.update(time); shafts.update(time); env.update(dt, time, cam.look, cam.dist);
      if (water) water.material.map.offset.x = time * 0.04;
      if (focus.goal && time > focus.until) focus.goal = null;
      focus.at.lerp(focus.goal || cam.look, 1 - Math.exp(-dt * 2.5));
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), lift = (dt * speed) / PACE;
      for (const v of units.values()) {
        if (!v.g.visible) continue;
        v.body.rotation.y = cam.yaw;
        // Men trail their squad's moves: the squad's travel since last frame is taken back from each man's
        // offset, which then springs home at his own rate, so a charge ripples through the ranks.
        tmp.subVectors(v.g.position, v.last); v.last.copy(v.g.position);
        const lx = tmp.x * cy - tmp.z * sy, lz = tmp.x * sy + tmp.z * cy;
        for (const M of v.alive) {
          M.off.x -= lx; M.off.z -= lz; M.off.y = 0;
          if (M.off.length() > 0.28) M.off.setLength(0.28);
          M.off.multiplyScalar(Math.exp(-lift * M.k));
          M.holder.position.copy(M.base).add(M.off);
          M.proxy.rotation.y = SUN_YAW - cam.yaw; if (M.tv) M.tv.proxy.rotation.y = M.proxy.rotation.y;
          const going = v.moving || M.off.lengthSq() > 0.0009;
          M.loop = going ? (v.moving || M.kind === 'gen' ? 'charge' : 'walk') : 'idle';
          runLoop(M, dt);
        }
      }
      for (const M of corpses) { M.plane.rotation.y = cam.yaw; M.proxy.rotation.y = SUN_YAW; }
      for (const b of billboards) b.rotation.y = cam.yaw;
      set?.children.forEach((m) => { if (m.userData.flag) m.rotation.y = Math.sin(time * 2 + m.position.z) * 0.25; m.userData.tick?.(time); });
    },
    focusPoint() { return focus.at; },
    // Phone: the picture comes in close on the fighting (update, above), and the sharp zone is a share of the focus distance, so at
    // that distance it no longer reached from the front rank to the rear and the men themselves were blurred. There the zone is
    // sized to the lines (about 6 cells either side of the focus) and the blur outside it is lighter.
    ...(PHONE ? { dof() { const d = camera.position.distanceTo(focus.at) || 1; return { strength: 1.1, band: Math.min(0.7, Math.max(0.1, 6 / d)), far: 1 }; } } : {}),
    orbit(dx) { cam.yaw = Math.max(-0.35, Math.min(0.35, cam.yaw - dx * 0.004)); },
    zoom(dz) { cam.baseDist = cam.dist = Math.max(12, Math.min(30, cam.dist * (1 + dz * 0.001))); },
  };
}
