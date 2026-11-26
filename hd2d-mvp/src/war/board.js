// The war map's board (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the scene and its lights, the month's
// light, sky and weather, the cell ↔ world conversions and heights, the terrain and its painted plates, the set dressing and woods,
// the water and the village signs. With ctx.flat it builds none of the 3D scene, only placeholders (still) for what the rest reads.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { rng } from '../pixel.js';
import { backdrop, lightShafts } from '../fx.js';
import { buildTerrain, dressBoard, calmTextures, deepWaterTex, vnoise } from '../diorama.js';
import { seasonalize } from '../seasons.js';
import { warGround, bakePlate, paintTerrain, paintedWater, plantWoods } from '../warplate.js';
import { seasonEnv } from '../seasonenv.js';
import { seeThrough } from '../seethrough.js';
import { W, H, FOREST, SAND, PLAIN, RIVER, MOUNT, CASTLE } from '../core/field.js';
import { factionColor } from '../core/game.js';
import { WATER_Y, PITCH, KIND, PLATE_M, PLATE_PX, DIRS, woodsOf, keySun, phase, WAR_RAIN } from './shared.js';
import { PLAIN_Y, CASTLE_Y, RIVER_BED_Y, hillTop } from './heights.js';

export function makeBoard(wv) {
  const { ctx, field, T0 } = wv; let tp = T0;
  const { audio, ui, sprites } = ctx;
  const map = field.map, human = field.human;
  const scene = new THREE.Scene();
  // Haze in the month's colour (seasonenv.js): the board is clear, the surrounding country fades out over its outer half.
  scene.fog = new THREE.Fog('#c9d4dc', 48, 100); // further out than the old dusk haze: a pale month fog washes out sooner
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  // A key light low enough for long shadows over a cooler sky fill, so the light models the blocks and
  // sprites; colour and strength come from the month (seasonenv.js), the angle stays the war map's.
  const sun = new THREE.DirectionalLight('#ffc884', 3.4);
  sun.position.set(-20, 13, 9); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const back = new THREE.DirectionalLight('#8fb0e0', 0.45); back.position.set(14, 9, -16);
  const hemi = new THREE.HemisphereLight('#90a8c8', '#3a2c1e', 0.5);
  scene.add(sun, back, hemi);
  // The month and the battlefield's latitude (seasonenv.js): light, sky, fog and weather now; the ground,
  // trees and set pieces are recoloured once the board is built (seasonalize below).
  // A calm board (A2): quieter ground and woods, no blossom on the trees (petals still drift in spring).
  // The war map is read cell by cell for minutes on end, so its rain is light (jason at depot heights@小红书, 2026-11-13: the storm
  // months' streaks stood over the whole board): WAR_RAIN draws fewer, shorter, fainter streaks and a soft flash. The wet ground,
  // the grey light and the month's rain level (where.weather, which the range fill reads) still say it is raining.
  const env = seasonEnv(scene, { sun, back, hemi, sunK: 0.95, hemiK: 1.15, snowH: 0.9, patch: 0.3, calm: 1, bloom: 0, ring: [90, 4], weather: WAR_RAIN });
  const where = env.set({ month: field.g.month, city: field.war.city });
  // The key light: a warm, pale low sun on a clear day, the month's own grey light in a rainy, stormy or snowing one (keySun).
  { const k = keySun(field.g.month); sun.color.copy(k.color); sun.intensity = k.intensity; }
  // The painted materials (src/warplate.js), loaded by app.js before the battle; without them (a test that
  // builds the view directly) the board falls back to the tile textures and the 3D woods.
  const G = warGround(field.g.month, field.war.city);
  // The flat painted map (ctx.flat, src/warmap2d.js) shows none of the 3D scene: it draws the board from its own picture and the
  // generals from their views here (flatState). So its war builds only what that reads and what the rules' play moves: the
  // generals, the range and route cells, the camera (PERF-03, 2026-11-07); not the ground plates, the terrain mesh, the dressing,
  // woods, water, sky, shafts and see-through, which were most of the 3D build (about 500 ms of a cold flat entry).
  const flat = !!(G && ctx.flat);

  const wx = (x) => x - W / 2 + 0.5, wz = (y) => y - H / 2 + 0.5;
  const terr = (x, y) => map[y][x];
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  // The board stands in tiers (war-3d Task 8; ./heights.js): plain, sand, wood and village ground 0.3, the river bed 0.05 below it,
  // a hill a low flat mesa a step above the plain at its rim and a little higher where all four neighbours are hill too, the castle
  // on a plinth. The rules never read these heights.
  const hillCell = (x, y) => terr(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y))) === MOUNT; // the range runs on past the board's edge
  const mountH = (x, y) => hillTop(hillCell, x, y);
  const topY = (x, y) => [PLAIN_Y, PLAIN_Y, PLAIN_Y, WATER_Y, mountH(x, y), CASTLE_Y][terr(x, y)];

  // --- Diorama: merged bevelled terrain, then set dressing (src/diorama.js) ---
  const TOP = ['forest', 'sand', 'grass', 'bed', 'hill', 'stone'], SIDE = ['earth', 'dirt', 'earth', 'earth', G ? 'tier' : 'rock', 'wall'];
  // A hill's top: heights at the cell's centre, edge midpoints and corners are the means of the hill cells that
  // meet there, but a point that touches any other ground sits at the hill's foot (FOOT, just above the plain),
  // so a range slopes down to the plain instead of standing on a cliff. Joined smoothly within each quarter,
  // with a little noise so a range does not read as a pyramid; shared points give shared heights.
  const FOOT = 0.33;
  const hv = (x, y) => (inside(x, y) && terr(x, y) === MOUNT ? mountH(x, y) : inside(x, y) ? FOOT : null);
  const mean = (...v) => { const k = v.filter((a) => a != null); return k.includes(FOOT) ? FOOT : k.reduce((a, b) => a + b, 0) / k.length; };
  function hillAt(x, y) {
    const c = mountH(x, y), e = (dx, dy) => mean(c, hv(x + dx, y + dy)), k = (dx, dy) => mean(c, hv(x + dx, y), hv(x, y + dy), hv(x + dx, y + dy));
    const P = [[k(-1, -1), e(0, -1), k(1, -1)], [e(-1, 0), c, e(1, 0)], [k(-1, 1), e(0, 1), k(1, 1)]];
    return (fx, fz) => {
      const i = fx < 0.5 ? 0 : 1, j = fz < 0.5 ? 0 : 1, u = fx * 2 - i, v = fz * 2 - j;
      const s = (t) => t * t * (3 - 2 * t), su = s(u), sv = s(v);
      const h = (P[j][i] * (1 - su) + P[j][i + 1] * su) * (1 - sv) + (P[j + 1][i] * (1 - su) + P[j + 1][i + 1] * su) * sv;
      return h + (vnoise((x + fx) * 2.1, (y + fz) * 2.1, 5) - 0.5) * 0.16 * Math.min(1, (h - FOOT) * 3);
    };
  }
  const boardCell = (x, y) => {
    const t = terr(x, y), h = t === RIVER ? RIVER_BED_Y : topY(x, y);
    // Hills are rock and moss: snow comes from the month and the battlefield's latitude (seasons.js), so a
    // tropical 交州 range stays bare while the 幽州 hills whiten from 十月.
    // Painted, a hill is a rock mesa (A2): flat tops stepping up toward the middle of a range, cliff faces
    // between, the corners rounded (buildTerrain roundCliffs); the castle stays square.
    if (G) return { h, top: 'plate', side: SIDE[t], kind: KIND[t], square: t === CASTLE };
    return { h, top: TOP[t], side: SIDE[t], ...(t === MOUNT ? { hAt: hillAt(x, y) } : {}) };
  };
  // Landscape around the board (APRON cells deep): not playable, the same ground level at the edge so the
  // map reads as a window onto a wider country. Edge terrain carries on outward (woods stay woods, rivers run
  // straight on past the edge), then rolling terraces rise into hills and peaks toward the rim; the light
  // dims with distance so the board stays the subject, and the haze swallows the far edge.
  const APRON = 14, seed = field.war.city * 13 + 7;
  const apron = (x, y) => {
    const cx = Math.max(0, Math.min(W - 1, x)), cy = Math.max(0, Math.min(H - 1, y)), d = Math.max(cx - x, x - cx, cy - y, y - cy);
    const t0 = terr(cx, cy), straight = cx === x || cy === y, n = vnoise(x * 0.18, y * 0.18, seed), m = vnoise(x * 0.07, y * 0.07, seed + 1);
    // A clear step down in light at the board's edge, then a slow fade outward: the board is the lit stage (A2).
    const shade = Math.max(0.15, 0.27 - (d - 1) * 0.03);
    // A river carries on only where it meets the edge head-on (it flows in from beyond), not where it runs along it.
    const ox = cx !== x ? 0 : 1, oy = cy !== y ? 0 : 1, inward = [cx - (x < cx ? -1 : x > cx ? 1 : 0), cy - (y < cy ? -1 : y > cy ? 1 : 0)];
    const along = (k) => { const ax = cx + ox * k, ay = cy + oy * k; return inside(ax, ay) && terr(ax, ay) === RIVER; };
    const far = G ? (Math.max(cx - x, x - cx, cy - y, y - cy) <= PLATE_M ? 'plate' : 'far') : null;
    if (t0 === RIVER && straight && inside(...inward) && terr(...inward) === RIVER && !(along(1) && along(-1)))
      return { h: 0.05, top: far ?? 'bed', side: 'earth', shade, river: true, kind: 'river' };
    const rise = Math.max(0, d - 4) * (0.1 + m * 0.2), hill = Math.floor(rise * (0.6 + n * 0.8) / 0.22) * 0.22;
    // A range at the edge runs on outward (painted: level for two cells, so no cliff stands along the board's edge).
    const h = (t0 === MOUNT && d < 3 ? topY(cx, cy) * (G && d <= 2 ? 1 : 1 - d * 0.15) : 0.3) + hill;
    const kind = h > 1.2 || (t0 === MOUNT && d < 3) ? 'rock' : (t0 === FOREST && d < 3) || n > 0.62 ? 'forest' : t0 === SAND && d < 2 ? 'sand' : 'grass';
    const paint = kind === 'rock' ? 'hill' : kind === 'grass' && d > 2 && vnoise(x * 0.35, y * 0.35, seed + 2) > 0.5 ? 'fields' : kind;
    return { h, top: far ?? kind, side: kind === 'rock' ? (G ? 'tier' : 'rock') : kind === 'sand' ? 'dirt' : 'earth', shade, d, kind, ...(G ? { paint } : {}) };
  };
  // Lay the whole grid out once: buildTerrain asks for each cell and its neighbours many times over.
  tp = phase('war:env', tp);
  const GW = W + APRON * 2, GH = H + APRON * 2, grid = [], ringCells = [];
  for (let Y = 0; Y < GH; Y++) for (let X = 0; X < GW; X++) {
    const x = X - APRON, y = Y - APRON;
    if (inside(x, y)) grid.push(boardCell(x, y));
    else { const c = apron(x, y); grid.push(c); ringCells.push({ x, y, ...c }); }
  }
  // The plates' footprints in world space: the board and PLATE_M cells round it, and the whole country.
  const PB = { x0: -PLATE_M, y0: -PLATE_M, w: W + PLATE_M * 2, h: H + PLATE_M * 2 }, PA = { x0: -APRON, y0: -APRON, w: GW, h: GH };
  const uvIn = (P) => (px, pz) => [(px - (P.x0 - W / 2)) / P.w, 1 - (pz - (P.y0 - H / 2)) / P.h];
  const uvB = uvIn(PB), uvA = uvIn(PA);
  // Painted, the tops are 'plate' / 'far' and the mesa faces 'tier', which the calm set has no tile for: paintTerrain below swaps
  // those materials for the plates, so they start with no map (null, not undefined: three.js warns on an undefined parameter).
  const calm = calmTextures(), TX = G ? { ...calm, top: { ...calm.top, plate: null, far: null }, side: { ...calm.side, tier: null } } : calm;
  const tiles = flat ? new THREE.Group() : buildTerrain({ W: GW, H: GH, wx: (x) => wx(x - APRON), wz: (y) => wz(y - APRON), cell: (X, Y) => grid[Y * GW + X], textures: TX, roundBanks: true,
    ...(G ? { roundCliffs: true, wobble: 0.16, uvOf: (px, pz, c) => (c.top === 'plate' ? uvB : uvA)(px, pz) } : {}) });
  tp = phase('war:terrain', tp);
  if (G && !flat) {
    const at = (x, y) => (x < -APRON || y < -APRON || x >= W + APRON || y >= H + APRON ? null : grid[(y + APRON) * GW + x + APRON]);
    const kindAt = (x, y) => { const c = at(x, y); return c ? c.paint ?? c.kind : null; };
    // Worn ground: round the castle and the villages, where the armies and the townsfolk walk.
    const towns = [...(field.map.flatMap((row, y) => row.flatMap((t, x) => (t === CASTLE ? [[x, y, 1]] : [])))), ...field.villages.map((v) => [v.x, v.y, 0.6])];
    const near = (x, y) => Math.max(0, ...towns.map(([tx, ty, k]) => k * Math.max(0, 1 - Math.hypot(x - tx, y - ty) / 2.6)));
    const playable = (x, y) => inside(x, y) && terr(x, y) !== RIVER;
    const seed = field.war.city * 7 + 3;
    // all the plates read besides the materials (bakePlate keeps the picture for the next battle here)
    const plateKey = `${field.war.city}|${JSON.stringify(field.map)}|${JSON.stringify(field.villages.map((v) => [v.x, v.y]))}`;
    paintTerrain(tiles, G, {
      plate: bakePlate(G, { ...PB, px: PLATE_PX, kind: kindAt, near, grid: playable, seed, key: plateKey }),
      far: bakePlate(G, { ...PA, px: 16, kind: kindAt, near, seed, key: plateKey }),
    });
  }
  scene.add(tiles);
  tp = phase('war:bakePlate', tp);
  const r = rng(field.war.city * 97 + 13), billboards = [];
  const spot = (x, y) => ({ x: wx(x), z: wz(y), h: topY(x, y) });
  const S = { plains: [], forests: [], sands: [], mountains: [], banks: [], castle: null, outskirts: [], villages: [] };
  const vset = new Set(field.villages.map((v) => `${v.x},${v.y}`));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = terr(x, y); if (t === RIVER) continue;
    if (vset.has(`${x},${y}`)) continue; // houses and their clutter fill village cells
    ({ [PLAIN]: S.plains, [FOREST]: S.forests, 1: S.sands, [MOUNT]: S.mountains }[t])?.push(spot(x, y));
    for (const [dx, dy] of DIRS) if (inside(x + dx, y + dy) && terr(x + dx, y + dy) === RIVER && t !== CASTLE && t !== MOUNT) S.banks.push({ ...spot(x, y), dx, dy });
    if (t === CASTLE) S.castle = spot(x, y);
    // Open ground around the castle gets the odd farmhouse (the town outside the walls).
    else if ((t === PLAIN || t === 1) && [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => inside(x + dx, y + dy) && terr(x + dx, y + dy) === CASTLE))) S.outskirts.push(spot(x, y));
  }
  for (const v of field.villages) S.villages.push({ ...spot(v.x, v.y), kind: v.kind });
  // The surrounding country gets a light pass: trees in its woods, rocks on its hills, grass only near the board.
  S.wildForests = []; S.wildRocks = [];
  for (const c of ringCells) {
    const sp = { x: wx(c.x), z: wz(c.y), h: c.h };
    if (c.kind === 'forest') S.wildForests.push({ ...sp, shade: c.shade });
    else if (c.kind === 'rock') { if (c.d < 10) S.wildRocks.push(sp); }
    else if (c.kind === 'grass' && c.d < 3) S.plains.push(sp);
  }
  // The gate faces the side the defenders deploy on (the nearer axis toward their middle).
  if (S.castle) {
    const def = field.units.filter((u) => u.side === 'def' && !(wx(u.x) === S.castle.x && wz(u.y) === S.castle.z));
    if (def.length) {
      const dx = def.reduce((a, u) => a + wx(u.x), 0) / def.length - S.castle.x, dz = def.reduce((a, u) => a + wz(u.y), 0) / def.length - S.castle.z;
      S.castle.facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
    }
  }
  S.castleColor = factionColor(field.faction('def')) ?? '#5a5a66'; // roofs glazed in the holder's colour, as on the strategy map
  const before = new Set(scene.children);
  const dressing = flat ? { billboards: [], lights: [], labels: [], update() {} } : dressBoard(scene, S, field.war.city * 31 + 5, { calm: true, painted: !!G });
  const woods = G && !flat && plantWoods(scene, G, woodsOf(S, rng(field.war.city * 53 + 1)), PITCH, field.war.city);
  // Everything the dressing stood up (castle, villages, cottages, trees, rocks, grass) thins out in front of a general (src/seethrough.js):
  // cleared over him with a soft blended rim; the castle and the village houses only thin to 0.45 of their picture, so a keep still reads as a keep.
  const dressed = scene.children.filter((o) => !before.has(o)), LANDMARK_KEEP = 0.45, DRESS_KEEP = 0;
  const cutout = flat ? Object.assign(() => {}, { rects: () => [] }) : seeThrough(dressed, { keep: (o) => (o.userData.landmark ? LANDMARK_KEEP : DRESS_KEEP) });
  for (const b of dressing.billboards) billboards.push(b);
  tp = phase('war:dressing', tp);
  const still = { update() {} };
  const sky = flat ? still : backdrop(scene, { radius: 34, y: -2.6, tint: '#d8dce0', ridges: ['#6a7a8c', '#8292a4', '#a2b0be'] }), shafts = flat ? still : lightShafts(scene, 7, [W, H]);
  if (!flat) env.backdrop(sky);
  const waterTex = flat ? new THREE.Texture() : G ? paintedWater(G, GW, GH) : deepWaterTex().clone();
  if (!flat) {
    waterTex.needsUpdate = true;
    if (!G) waterTex.repeat.set(W / 2 + APRON, H / 2 + APRON);
    // Matte water: one flat plane under a low sun, so anything glossier mirrors the sun as a blown-out white patch on whatever river lies opposite the eye.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W + APRON * 2, H + APRON * 2), new THREE.MeshStandardMaterial({ map: waterTex, transparent: true, opacity: 0.92, roughness: 0.85, metalness: 0.05, emissive: '#0a3452', emissiveIntensity: 0.32 }));
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true; water.userData.water = true; scene.add(water);
  }
  // Trees and rocks beyond the board dim with the apron ground (seasons.js s_stage).
  const [ax, bx, az, bz] = [wx(-0.5), wx(W - 0.5), wz(-0.5), wz(H - 0.5)];
  where.stage = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
  if (!flat) seasonalize(scene, where); // before the units: generals keep their own colours
  tp = phase('war:water+season', tp);
  const torches = dressing.lights;
  let vsignW = 0; const vsigns = []; // each village sign's element and its cell's centre: a sign over a cell on screen is kept on screen too
  const VICON = { 米店: '米', 武器店: '武', 病院: '医' };
  if (!flat) field.villages.forEach((v, i) => { // the flat map draws its own village signs
    const el = document.createElement('div'); el.className = 'vtag'; el.textContent = VICON[v.kind] || '村';
    // A wooden plaque hung 0.4 over the main roof's ridge (0.45 over the cell's top), always facing the screen.
    const lab = new CSS2DObject(el); lab.position.set(dressing.labels[i].x, topY(v.x, v.y) + 0.85, dressing.labels[i].z); scene.add(lab);
    vsigns.push({ el, lab, cell: new THREE.Vector3(wx(v.x), topY(v.x, v.y), wz(v.y)), w: 0, h: 0 });
  });
  // dispose()'s walk of the scene (the entry's, after the units' and before release()): the labels' elements and the lights' shadow maps, and the sky.
  function disposeBoard() {
    scene.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); o.shadow?.dispose(); }); // a light's shadow map is a render target of its own
    if (scene.background?.isTexture) scene.background.dispose(); // the sky (seasonenv.js)
  }
  // vsignW is reassigned later (the units' tag layout): it is read and written as wv.vsignW from here on, never copied.
  return { audio, ui, sprites, map, human, scene, camera, sun, back, hemi, env, where, G, flat, wx, wz, terr, inside, hillCell, topY,
    APRON, GW, GH, grid, tiles, r, billboards, S, dressing, woods, dressed, LANDMARK_KEEP, cutout, still, sky, shafts, waterTex, torches,
    vsignW, vsigns, VICON, disposeBoard };
}
