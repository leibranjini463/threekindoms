// War-map diorama, second pass (the 冀州 art sample): the ground as one merged, bevelled terrain mesh instead
// of a box per cell, painted with 32 px-per-cell tileable pixel textures laid in world space (so the grid no
// longer shows texel for texel), with corner occlusion baked into vertex colours and dense set dressing —
// rocks, tall grass, reeds, bushes, layered trees, stumps, a palisade, banners and village clutter.
import * as THREE from 'three';
import { canvasTex, rng } from './pixel.js';
import { skyLit } from './fx.js';
import { plantTrees, buildFortress, buildVillage, buildCottage } from './structures.js';

// ---------- Pixel painting ----------
// Textures are painted texel by texel into ImageData. Every coordinate wraps, so each texture tiles
// seamlessly; colour comes from short ramps with a 4×4 ordered dither between steps, the way hand-made
// pixel tiles shade, rather than from continuous noise.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Periodic value noise: lattice `period` cells across the texture, so it wraps with the texture.
function pnoise(x, y, w, period, seed) {
  const fx = x / w * period, fy = y / w * period, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const v = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return (v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx) * (1 - sy) + (v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx) * sy;
}
// Smooth value noise on the plane (not periodic), for laying out the landscape around the board.
export function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const v = (a, b) => hash(a, b, seed);
  return (v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx) * (1 - sy) + (v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx) * sy;
}
const fbm = (x, y, w, seed, periods = [4, 8, 16, 32], gain = 0.5) => {
  let s = 0, a = 1, n = 0;
  for (const p of periods) { s += pnoise(x, y, w, p, seed + p) * a; n += a; a *= gain; }
  return s / n;
};

function painter(w, h) {
  const img = new ImageData(w, h), d = img.data;
  const put = (x, y, c) => { x = ((x % w) + w) % w; y = ((y % h) + h) % h; const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] ?? 255; };
  const get = (x, y) => { x = ((x % w) + w) % w; y = ((y % h) + h) % h; const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  // Pick a ramp step for value v∈[0,1] with ordered dither.
  const ramp = (x, y, v, cols, dither = 0.45) => cols[Math.max(0, Math.min(cols.length - 1, Math.round(v * (cols.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * dither)))];
  return { img, put, get, ramp, w, h };
}
function toTex(p, { repeat = true } = {}) {
  const t = canvasTex(p.w, p.h, (g) => g.putImageData(p.img, 0, 0), { repeat });
  t.anisotropy = 4;
  return t;
}
const R = (cols) => cols.map(hex);

// Ramps: muted and warm, darker than the first pass, so light and shadow do the work instead of saturation.
const C = {
  grass: R(['#2b4420', '#36542a', '#44652e', '#547837', '#668a40', '#7c9c4a']),
  grassLit: R(['#90ad58', '#a8bf6a']),
  forest: R(['#1d2e19', '#25391e', '#2f4624', '#3b5329']),
  litter: R(['#4a3a22', '#5e4a2a', '#76603a']),
  dirt: R(['#5e5038', '#6e5e42', '#80704e', '#93825c', '#a4946c']), // dry ochre earth, not orange
  bed: R(['#2c2a22', '#3a362a', '#4a4434', '#5a523e']),
  rock: R(['#3e3b36', '#4f4b44', '#625d54', '#767066', '#8c857a', '#a39b8e']),
  snow: R(['#8c98a4', '#aab6c0', '#c8d2d8', '#e2e8ec', '#f4f6f8']),
  stone: R(['#5e5646', '#706653', '#847862', '#978a71', '#aa9c80']),
  mortar: R(['#3e382e', '#4a4337']),
  soil: R(['#21170f', '#2c1f15', '#3a291b', '#4a3423', '#5a412c', '#6b4f36']),
  flower: R(['#e8d070', '#f0ece0', '#d07a8a', '#a8b4e8']),
};

// 128×128 = 4×4 cells. Grass: broad light/dark meadow patches in a few calm steps (low-frequency noise, light
// dither), sparse clumps of blades where the meadow is lighter, a scatter of flowers and bare spots.
// calm (the war map, A2): broad patches only, a fifth of the blades, no flowers, few bare spots.
function grassTop(seed, calm = false) {
  const p = painter(128, 128), r = rng(seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = fbm(x, y, 128, seed, calm ? [2, 4, 8] : [2, 4, 8, 16], 0.45);
    p.put(x, y, p.ramp(x, y, (v - 0.25) * (calm ? 1.2 : 1.6), C.grass.slice(1, 5), calm ? 0.15 : 0.3));
  }
  // Blade clumps: short vertical strokes, lit tip over a darker root, denser where the meadow is lighter.
  for (let i = 0; i < (calm ? 50 : 260); i++) {
    const x = (r() * 128) | 0, y = (r() * 128) | 0, v = fbm(x, y, 128, seed, [2, 4, 8, 16], 0.45);
    if (r() > v) continue;
    const len = 2 + ((r() * 3) | 0);
    for (let k = 0; k < len; k++) p.put(x, y - k, k === len - 1 ? C.grassLit[(r() * 2) | 0] : C.grass[Math.min(5, 3 + (k > 0) + (r() < 0.3))]);
    p.put(x, y + 1, C.grass[1]);
  }
  for (let i = 0; i < (calm ? 2 : 8); i++) { // bare earth spots
    const x = (r() * 128) | 0, y = (r() * 128) | 0, n = 2 + ((r() * 3) | 0);
    for (let k = 0; k < n * 3; k++) p.put(x + ((r() * n) | 0), y + ((r() * n * 0.6) | 0), C.dirt[1 + ((r() * 2) | 0)]);
  }
  for (let i = 0; i < (calm ? 0 : 12); i++) { const x = (r() * 128) | 0, y = (r() * 128) | 0, c = C.flower[(r() * 4) | 0]; p.put(x, y, c); if (r() < 0.4) p.put(x + 1, y, c); p.put(x, y + 1, C.grass[1]); }
  return toTex(p);
}
// Forest floor: dark moss with leaf litter and roots.
function forestTop(seed, calm = false) {
  const p = painter(128, 128), r = rng(seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = fbm(x, y, 128, seed, [2, 4, 8, 16], 0.45), l = pnoise(x, y, 128, 8, seed + 3);
    p.put(x, y, l > 0.72 ? p.ramp(x, y, (l - 0.72) * 3, C.litter, 0.3) : p.ramp(x, y, v * 1.2 - 0.1, C.forest, 0.3));
  }
  for (let i = 0; i < (calm ? 20 : 80); i++) { const x = (r() * 128) | 0, y = (r() * 128) | 0; p.put(x, y, C.litter[(r() * 3) | 0]); p.put(x + 1, y, C.litter[0]); }
  for (let i = 0; i < (calm ? 3 : 14); i++) { // roots
    let x = (r() * 128) | 0, y = (r() * 128) | 0;
    for (let k = 0; k < 10; k++) { p.put(x, y, C.litter[0]); p.put(x, y - 1, C.litter[2]); x += 1; y += r() < 0.3 ? 1 : r() < 0.3 ? -1 : 0; }
  }
  return toTex(p);
}
// Dry ground (沙): packed earth with pebbles, each pebble lit on top and shadowed below.
function dirtTop(seed, cols = C.dirt) {
  const p = painter(128, 128), r = rng(seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) p.put(x, y, p.ramp(x, y, fbm(x, y, 128, seed, [2, 4, 8, 16], 0.45) * 1.3 - 0.15, cols, 0.3));
  for (let i = 0; i < 60; i++) {
    const x = (r() * 128) | 0, y = (r() * 128) | 0, big = r() < 0.3;
    p.put(x, y, cols[cols.length - 1]); if (big) { p.put(x + 1, y, cols[cols.length - 2]); p.put(x, y + 1, cols[1]); p.put(x + 1, y + 1, cols[0]); } else p.put(x, y + 1, cols[0]);
  }
  return toTex(p);
}
// Rock tops: grey ramp with cracks (dark random walks with a lit lip) and moss in the hollows.
// hill (the war map's rounded mountains, A2): broad weathered rock in large calm patches, moss in the hollows.
function rockTop(seed, cols = C.rock, moss = true, hill = false) {
  const p = painter(128, 128), r = rng(seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const v = fbm(x, y, 128, seed, hill ? [2, 4, 8, 16] : [4, 8, 16, 32, 64], hill ? 0.5 : 0.6);
    p.put(x, y, moss && v < (hill ? 0.4 : 0.36) ? p.ramp(x, y, v * 2.5, C.grass.slice(0, 4), hill ? 0.2 : 0.45) : p.ramp(x, y, v * (hill ? 1.1 : 1.4) - 0.1, cols, hill ? 0.25 : 0.45));
  }
  for (let i = 0; i < (hill ? 8 : 22); i++) {
    let x = (r() * 128) | 0, y = (r() * 128) | 0;
    for (let k = 0; k < 6 + r() * 14; k++) { p.put(x, y, cols[0]); p.put(x, y - 1, cols[cols.length - 1]); x += r() < 0.5 ? 1 : 0; y += r() < 0.5 ? 1 : r() < 0.3 ? -1 : 0; }
  }
  return toTex(p);
}
// Castle paving: irregular slabs (rows of random widths), each slab shaded on its own, worn mortar joints.
function stoneTop(seed) {
  const p = painter(128, 128), r = rng(seed);
  for (let y0 = 0; y0 < 128; y0 += 8) {
    let x0 = (r() * 8) | 0; const end = x0 + 128;
    while (x0 < end) {
      const sw = 7 + ((r() * 9) | 0), tone = 0.25 + r() * 0.55;
      for (let y = 0; y < 8; y++) for (let x = 0; x < sw; x++) {
        const edge = y === 0 || x === 0, v = tone + (pnoise(x0 + x, y0 + y, 128, 32, seed) - 0.5) * 0.35 + (y === 1 ? 0.12 : 0) - (y === 7 ? 0.12 : 0);
        p.put(x0 + x, y0 + y, edge ? C.mortar[(r() * 2) | 0] : p.ramp(x0 + x, y0 + y, v, C.stone));
      }
      x0 += sw;
    }
  }
  for (let i = 0; i < 60; i++) { const x = (r() * 128) | 0, y = (r() * 128) | 0; p.put(x, y, C.grass[2]); } // weeds in the joints
  return toTex(p);
}

// Side textures are 128×128 = 4 cells wide × 4 units deep, v measured down from the block's top edge.
// Earth banks: a grass lip that hangs over the edge in uneven tufts, then soil strata darkening with depth,
// embedded stones and roots.
function earthSide(seed, lip = C.grass, lipLit = C.grassLit) {
  const p = painter(128, 128), r = rng(seed);
  const hang = Array.from({ length: 128 }, (_, x) => 3 + Math.round(pnoise(x, 0, 128, 32, seed) * 6 + (r() < 0.15 ? 3 : 0)));
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    if (y < hang[x]) { p.put(x, y, y === 0 ? lipLit[(r() * 2) | 0] : y >= hang[x] - 1 ? lip[0] : p.ramp(x, y, 0.75 - y / hang[x] * 0.6, lip)); continue; }
    const strata = Math.sin((y + pnoise(x, y, 128, 8, seed) * 6) * 0.5) * 0.12, depth = Math.min(1, y / 110);
    p.put(x, y, p.ramp(x, y, 0.8 - depth * 0.6 + strata + (fbm(x, y, 128, seed + 5) - 0.5) * 0.4, C.soil));
  }
  for (let x = 0; x < 128; x++) p.put(x, hang[x], C.soil[0]); // shadow under the lip
  for (let i = 0; i < 70; i++) { // stones
    const x = (r() * 128) | 0, y = 12 + ((r() * 110) | 0), s = 1 + ((r() * 3) | 0);
    for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) p.put(x + a, y + b, C.rock[b === 0 ? 4 : b === s - 1 ? 1 : 2]);
  }
  for (let i = 0; i < 18; i++) { let x = (r() * 128) | 0, y = 8 + ((r() * 30) | 0); for (let k = 0; k < 8; k++) { p.put(x, y, C.litter[0]); y++; x += r() < 0.4 ? 1 : r() < 0.3 ? -1 : 0; } }
  return toTex(p);
}
// Cliff faces: horizontal bedding planes, vertical joints, lit ledges, moss along the top.
function rockSide(seed, cap = null) {
  const p = painter(128, 128), r = rng(seed);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const bed = (y + Math.round(pnoise(x, 0, 128, 16, seed) * 4)) % 11, depth = y / 128;
    let v = fbm(x, y, 128, seed, [4, 8, 16, 32], 0.6) * 0.9 + 0.25 - depth * 0.35;
    if (bed === 0) v = 0; else if (bed === 1) v += 0.3;
    p.put(x, y, p.ramp(x, y, v, C.rock));
  }
  for (let i = 0; i < 26; i++) { const x = (r() * 128) | 0, y0 = (r() * 128) | 0; for (let y = y0; y < y0 + 4 + r() * 8; y++) { p.put(x, y, C.rock[0]); p.put(x + 1, y, C.rock[3]); } }
  if (cap) for (let x = 0; x < 128; x++) { const n = 2 + Math.round(pnoise(x, 0, 128, 32, seed + 1) * 4); for (let y = 0; y < n; y++) p.put(x, y, cap[Math.max(0, cap.length - 1 - y)]); }
  return toTex(p);
}
// Castle walls: coursed ashlar, shaded per block, a dark plinth course at the foot is the ground's job (AO).
function wallSide(seed) {
  const p = painter(128, 128), r = rng(seed);
  for (let y0 = 0; y0 < 128; y0 += 10) {
    let x0 = (y0 / 10) % 2 ? 0 : 9;
    for (let x1 = x0 - 18; x1 < 128 + 18; x1 += 18) {
      const tone = 0.3 + r() * 0.5;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 18; x++) {
        const edge = y === 9 || x === 17, v = tone + (y === 0 ? 0.15 : 0) - y * 0.015 + (pnoise(x1 + x, y0 + y, 128, 32, seed) - 0.5) * 0.3;
        p.put(x1 + x, y0 + y, edge ? C.mortar[0] : p.ramp(x1 + x, y0 + y, v, C.stone));
      }
    }
  }
  return toTex(p);
}
// Water: deep teal with soft caustic bands and a few glints; drifts via texture offset.
export function waterTex(seed, cols = R(['#163a48', '#1c4a58', '#245a68', '#2f6e7a', '#4a8e94']), glint = '#9ccfc8') {
  const p = painter(64, 64), r = rng(seed);
  cols = cols.map((c) => (typeof c === 'string' ? hex(c) : c));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = Math.abs(Math.sin((pnoise(x, y, 64, 4, seed) * 4 + y / 64 * Math.PI * 2 * 2)));
    p.put(x, y, p.ramp(x, y, 0.15 + v * 0.55 + (pnoise(x, y, 64, 16, seed + 1) - 0.5) * 0.3, cols));
  }
  for (let i = 0; i < 14; i++) { const x = (r() * 64) | 0, y = (r() * 64) | 0; for (let k = 0; k < 3; k++) p.put(x + k, y, hex(glint)); }
  return toTex(p);
}

// The clear azure water of the FC map, shared by the 战略地图 and the battle scenes so a river reads the
// same at every scale (the deep teal `water` above stays for anything that wants a darker pool).
let azure = null;
export const azureWaterTex = () => (azure ||= waterTex(31, ['#14588e', '#175f98', '#1a66a0', '#1f6ea8', '#2a7ab2'], '#9ccbe6'));

let cache = null;
export function dioramaTextures() {
  if (cache) return cache;
  cache = {
    top: { grass: grassTop(11), forest: forestTop(12), sand: dirtTop(13), bed: dirtTop(17, C.bed), rock: rockTop(14), snow: rockTop(16, C.snow, false), stone: stoneTop(15) },
    side: { earth: earthSide(21), dirt: earthSide(22, C.dirt, R(['#b0a074', '#bcae84'])), rock: rockSide(23, C.grass.slice(1, 5)), snow: rockSide(24, C.snow.slice(2)), wall: wallSide(25), plinth: earthSide(26) },
    water: waterTex(31),
  };
  return cache;
}
// The war map's calm set (A2): the same tiles with less texel detail, and a rounded hill top for mountains.
let calmCache = null;
export function calmTextures() {
  if (calmCache) return calmCache;
  const base = dioramaTextures();
  calmCache = { top: { ...base.top, grass: grassTop(11, true), forest: forestTop(12, true), hill: rockTop(18, C.rock, true, true) }, side: base.side, water: base.water };
  return calmCache;
}
// The war map's rivers: a deep blue-teal, quieter than the strategy map's azure, so the water does not
// compete with the blue army (A2).
let deep = null;
export const deepWaterTex = () => (deep ||= waterTex(37, ['#174a66', '#1b5574', '#205f80', '#286b8c', '#357a98'], '#9cc4d4'));

// ---------- Terrain mesh ----------
// One merged mesh per material. Top faces are a 6×6 vertex grid per cell (rows at 0, bevel, margin, …), so
// an edge that drops can round over (bevel) and occlusion from a taller neighbour falls off within a fifth
// of a cell instead of across the whole cell. Sides are emitted only where the neighbour is lower, down to
// the neighbour's top (or deep below the board at its rim), shaded darker toward the foot.
const BEVEL = 0.06, MARGIN = 0.22, OFFS = [0, BEVEL, MARGIN, 1 - MARGIN, 1 - BEVEL, 1];
// A hill (cell with hAt) is a curved surface: a finer, even grid so it does not facet.
const OFFS_HILL = [0, BEVEL, 0.18, 0.32, 0.5, 0.68, 0.82, 1 - BEVEL, 1];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BED = 0.15; // a neighbour below this is a river bed

// Rounded river banks (the war map, A2): where a cell drops to the river bed on both sides of a corner and
// across it, the corner's quarter of the cell is bent onto a quarter circle of radius R, so a river turns
// instead of stepping. Points on the rim land on the arc; inner points follow smoothly; the quarter's inner
// borders do not move, so the rest of the cell is untouched. The bed below is hidden by the water.
const R_BANK = 0.42;
function bankCorners(x, y, c, nb, at, cliffs = false) {
  // cliffs: also round where the cell stands a step above its neighbours (a mesa hill over the plain).
  const low = (n) => !n || n.h < BED || (cliffs && c.h - n.h > 0.2);
  if (c.h < BED || c.square) return null;
  const corners = [];
  for (const [sx, sz] of [[1, 1], [1, 0], [0, 1], [0, 0]]) {
    const ex = nb[sx ? 0 : 1], ez = nb[sz ? 2 : 3], diag = at(x + (sx ? 1 : -1), y + (sz ? 1 : -1));
    // Two neighbours at different heights leave no one floor for the corner to stand on (a gap would open to the water below it): it stays square.
    if (ex && ez && low(ex) && low(ez) && Math.abs(ex.h - ez.h) < 0.06 && (!diag || low(diag))) corners.push([sx, sz, Math.max(ex.h, ez.h)]);
  }
  if (!corners.length) return null;
  const bend = (fx, fz) => {
    for (const [sx, sz] of corners) {
      const a = sx ? 1 - fx : fx, b = sz ? 1 - fz : fz; // distance in from the corner along each axis
      if (a >= R_BANK || b >= R_BANK) continue;
      const dx = a - R_BANK, dz = b - R_BANK, len = Math.hypot(dx, dz);
      if (len < 1e-6) return [fx, fz];
      const k = Math.max(Math.abs(dx), Math.abs(dz)) / len, na = R_BANK + dx * k, nb2 = R_BANK + dz * k;
      return [sx ? 1 - na : na, sz ? 1 - nb2 : nb2];
    }
    return [fx, fz];
  };
  bend.corners = corners; // [sx, sz, height of the ground beside the corner]
  return bend;
}
// cell(x, y) → { h, top: material key, side: material key, shade? (multiplies the baked light, to dim the
// landscape around the board), hAt? (fx, fz ∈ 0…1 across the cell → top height: a rounded hill instead of a
// flat block; neighbouring cells with hAt share their edges, so no wall stands between them) }.
// textures: the tile set (dioramaTextures(), or calmTextures() for the war map).
// roundBanks: bend the convex corners of land along a river (bankCorners); roundCliffs: and of any step down.
// wobble: let edges that drop wander outward by up to this much (cells; c.square cells keep straight sides).
// uvOf(px, pz, c) → [u, v]: the tops' texture coordinates (default: one tile every 4 units).
export function buildTerrain({ W, H, cell, wx, wz, rimDepth = 2.2, textures = dioramaTextures(), roundBanks = false, roundCliffs = false, wobble = 0, uvOf = (px, pz) => [px / 4, -pz / 4] }) {
  const TX = textures;
  const groups = new Map(); // material key → { pos, uv, col, idx }
  const G = (k) => { if (!groups.has(k)) groups.set(k, { pos: [], uv: [], col: [], idx: [], own: [] }); return groups.get(k); };
  // Which cell each face belongs to (for picking): a wall belongs to the cell on top of it, wherever the wobble bulges it to, and so
  // does the top itself: its bevelled rim bulges out over the lower cell with the wall, and from some angles lies in front of the face.
  const owned = (g, from, cellId) => { for (let f = from / 3; f < g.idx.length / 3; f++) g.own[f] = cellId; };
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : cell(x, y));

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cell(x, y), h = c.h;
    const nb = DIRS4.map(([dx, dy]) => at(x + dx, y + dy));
    const nh = nb.map((n) => (n ? n.h : -rimDepth));
    const drop = nh.map((v, k) => h - v > 0.05 && !(c.hAt && nb[k]?.hAt));
    const taller = (dx, dy) => { const n = at(x + dx, y + dy); return n && !(c.hAt && n.hAt) && n.h - h > 0.1 ? Math.min(1, (n.h - h) / 0.35) : 0; };
    const topAt = (fx, fz) => (c.hAt ? c.hAt(fx, fz) : h);
    const O = c.hAt || (wobble && !c.square && drop.some(Boolean)) ? OFFS_HILL : OFFS, N = O.length; // a bulging edge needs the finer row of points
    const round = roundBanks ? bankCorners(x, y, c, nb, at, roundCliffs) : null;
    // wobble: an edge that drops bulges outward by up to `wobble` of a cell, by noise along it in world space
    // (so the face below follows the same line) and nothing at its ends (so neighbours meet): a bank or a
    // cliff runs like a natural edge instead of a cell's side. Only outward: the lower cell's top is under it.
    const bulge = wobble && !c.square && drop.some(Boolean) ? (fx, fz) => {
      let ox = 0, oz = 0;
      DIRS4.forEach(([dx, dy], k) => {
        if (!drop[k]) return;
        const d = dx > 0 ? 1 - fx : dx < 0 ? fx : dy > 0 ? 1 - fz : fz, t = dx ? fz : fx; // distance in from the edge, place along it
        if (d > MARGIN) return;
        const ex = dx ? (dx > 0 ? 1 : 0) : t, ez = dy ? (dy > 0 ? 1 : 0) : t;
        const n = vnoise((wx(x) - 0.5 + ex) * 2.2, (wz(y) - 0.5 + ez) * 2.2, 11) * 0.7 + vnoise((wx(x) - 0.5 + ex) * 5.3, (wz(y) - 0.5 + ez) * 5.3, 12) * 0.3;
        const a = wobble * Math.max(0, n * 1.6 - 0.35) * Math.sin(Math.PI * t) ** 0.7 * (1 - d / MARGIN);
        ox += dx * a; oz += dy * a;
      });
      return [ox, oz];
    } : null;
    const local = (fx, fz) => {
      const p = round ? round(fx, fz) : [fx, fz];
      if (!bulge) return p;
      const [ox, oz] = bulge(fx, fz); return [p[0] + ox, p[1] + oz];
    };
    // --- top ---
    const g = G('t:' + c.top), base = g.pos.length / 3;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const fx = O[i], fz = O[j];
      const onE = i === N - 1, onW = i === 0, onS = j === N - 1, onN = j === 0;
      const down = (onE && drop[0]) || (onW && drop[1]) || (onS && drop[2]) || (onN && drop[3]);
      const [lx, lz] = local(fx, fz);
      const px = wx(x) - 0.5 + lx, pz = wz(y) - 0.5 + lz, py = topAt(fx, fz) - (down ? BEVEL : 0);
      g.pos.push(px, py, pz); g.uv.push(...uvOf(px, pz, c));
      // Occlusion: distance-to-edge falloff for each taller orthogonal neighbour, corner term for diagonals.
      const fall = (d) => (d < 0.01 ? 1 : d < BEVEL + 0.01 ? 0.75 : d < MARGIN + 0.01 ? 0.3 : 0);
      let ao = 1;
      ao *= 1 - 0.55 * taller(1, 0) * fall(1 - fx); ao *= 1 - 0.55 * taller(-1, 0) * fall(fx);
      ao *= 1 - 0.55 * taller(0, 1) * fall(1 - fz); ao *= 1 - 0.55 * taller(0, -1) * fall(fz);
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (taller(dx, 0) || taller(0, dy)) continue;
        const cx = dx > 0 ? 1 - fx : fx, cz = dy > 0 ? 1 - fz : fz;
        ao *= 1 - 0.45 * taller(dx, dy) * fall(cx) * fall(cz);
      }
      // Rounded rim catches a little extra light.
      if (down) ao *= 1.08;
      ao *= c.shade ?? 1;
      g.col.push(ao, ao, ao);
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = base + j * N + i, b = a + 1, c2 = a + N, d = c2 + 1;
      g.idx.push(a, c2, b, b, c2, d);
    }
    // A corner bent round above dry ground leaves its square open: floor it at the ground's level.
    if (roundCliffs && round) for (const [sx, sz, fh] of round.corners) {
      if (fh < BED) continue; // the river bed: under the water
      const f = g.pos.length / 3;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const fx = sx ? 1 - a * R_BANK : a * R_BANK, fz = sz ? 1 - b * R_BANK : b * R_BANK, px = wx(x) - 0.5 + fx, pz = wz(y) - 0.5 + fz;
        g.pos.push(px, fh - 0.004, pz); g.uv.push(...uvOf(px, pz, c)); g.col.push(c.shade ?? 1, c.shade ?? 1, c.shade ?? 1);
      }
      if (sx ^ sz) g.idx.push(f, f + 1, f + 2, f + 1, f + 3, f + 2); else g.idx.push(f, f + 2, f + 1, f + 1, f + 2, f + 3); // a flipped axis flips the winding
    }
    owned(g, g.own.length * 3, y * W + x);
    // --- sides ---
    // A strip along the edge through the same points as the top's rim, so a rounded bank corner or a hill's
    // sloping edge stays closed.
    DIRS4.forEach(([dx, dy], k) => {
      if (!drop[k]) return;
      const s = G('s:' + c.side), b0 = s.pos.length / 3;
      const yBot = nh[k];
      // Ends of the shared edge in the cell's 0…1 frame, wound so the face points away from the cell.
      const l1 = [dx > 0 ? 1 : dx < 0 ? 0 : dy > 0 ? 0 : 1, dy > 0 ? 1 : dy < 0 ? 0 : dx > 0 ? 1 : 0];
      const l2 = [dx > 0 ? 1 : dx < 0 ? 0 : dy > 0 ? 1 : 0, dy > 0 ? 1 : dy < 0 ? 0 : dx > 0 ? 0 : 1];
      const pts = O.map((t) => [l1[0] + (l2[0] - l1[0]) * t, l1[1] + (l2[1] - l1[1]) * t]);
      const along = (wp) => (dx !== 0 ? -wp[1] * dx : wp[0] * dy) / 4;
      const tops = pts.map(([fx, fz]) => topAt(fx, fz) - BEVEL), yTop = Math.max(...tops);
      // Split tall faces so the foot shading is a gradient over the last unit, not over the whole cliff.
      const rows = yTop - yBot > 1.2 ? [null, yBot + 0.9, yBot] : [null, yBot];
      rows.forEach((row) => {
        pts.forEach(([fx, fz], e) => {
          const [lx, lz] = local(fx, fz), wp = [wx(x) - 0.5 + lx, wz(y) - 0.5 + lz];
          const yy = row === null ? tops[e] : Math.min(row, tops[e]), depth = topAt(fx, fz) - yy, foot = yy - yBot;
          const shade = Math.max(0.42, Math.min(1, 0.5 + foot * 0.55)) * (yBot <= -rimDepth + 0.01 ? Math.max(0.35, 1 - depth * 0.28) : 1) * (c.shade ?? 1);
          s.pos.push(wp[0], yy, wp[1]); s.uv.push(along(wp), 1 - depth / 4); s.col.push(shade, shade, shade);
        });
      });
      const v = (r, e) => b0 + r * N + e;
      const from = s.idx.length;
      for (let r = 0; r < rows.length - 1; r++) for (let e = 0; e < N - 1; e++) s.idx.push(v(r, e), v(r + 1, e), v(r, e + 1), v(r, e + 1), v(r + 1, e), v(r + 1, e + 1));
      owned(s, from, y * W + x);
    });
  }

  const group = new THREE.Group();
  for (const [key, g] of groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setIndex(g.idx); geo.computeVertexNormals(); geo.userData.owner = Int32Array.from(g.own);
    const [kind, name] = key.split(':');
    const map = TX[kind === 't' ? 'top' : 'side'][name];
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.96, metalness: 0 }));
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.terrain = true; mesh.userData.key = key;
    // seasons.js recolours grass and forest floor and snows on every top; on the earth banks only the grass lip.
    mesh.userData.tile = kind === 't' ? name : name === 'earth' || name === 'plinth' ? 'lip' : null;
    group.add(mesh);
  }
  return group;
}

// ---------- Props ----------
const tex = (w, h, draw) => canvasTex(w, h, draw);
// Small sprites drawn from rows of palette indices ('.' transparent).
function sprite(rows, pal) {
  return tex(rows[0].length, rows.length, (g) => rows.forEach((row, y) => [...row].forEach((k, x) => { if (k !== '.') { g.fillStyle = pal[k]; g.fillRect(x, y, 1, 1); } })));
}

const TREE_PALS = [
  ['#12200f', '#1d3317', '#2a4720', '#3d5f2a', '#5d7d38'],
  ['#162210', '#243619', '#334b21', '#4b6629', '#71883c'],
  ['#1c2412', '#2c3818', '#40501f', '#5d6a2a', '#86903e'],
];
function bushSprite(seed) {
  return tex(24, 14, (g) => {
    const r = rng(seed), pal = TREE_PALS[seed % 3];
    for (let i = 0; i < 6; i++) {
      const cx = 4 + r() * 16, cy = 7 + r() * 3, rad = 3 + r() * 3;
      for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
        if (Math.hypot(x, y) > rad || cy + y > 13) continue;
        const l = (-x - y * 1.4) / rad + (r() - 0.5) * 0.6;
        g.fillStyle = l > 0.8 ? pal[4] : l > 0 ? pal[3] : l > -0.7 ? pal[2] : pal[1];
        g.fillRect(Math.round(cx + x), Math.round(cy + y), 1, 1);
      }
    }
  });
}
const TUFTS = [
  sprite(['..g..h..', '.gg.hh..', '.g.gh.h.', 'Gg.gh.hg', 'GG.Gg.Gg', '.GGGgGG.', '..GGGG..', '...GG...'], { g: '#5e7e38', h: '#7c9a48', G: '#344f24' }),
  sprite(['...y....', '..yyy.w.', '...g.www', '.h.g..w.', '.hhg.Gg.', 'GhGgGGg.', '.GGGGG..', '..GG....'], { y: '#d8c060', w: '#e8e2d2', g: '#4e6e30', h: '#6a8a40', G: '#2e4820' }),
  sprite(['g.......', 'g..h..g.', 'gg.h.gg.', '.g.hhg..', '.gGGhg..', 'GGGGGGG.', '.GGGGG..', '........'], { g: '#6a8240', h: '#8ca04e', G: '#3a5226' }),
];
const REED = sprite(['..b...b.', '..b..bb.', '.gb..g..', '.g..gg..', '.g.hg...', 'gg.hg..h', 'g.Ghg.hh', 'GGGGGGGG'], { b: '#8a7a52', g: '#5a7040', h: '#76884e', G: '#34462a' });

// Crossed-quad instanced foliage (static, two quads at right angles), scaled per instance.
function crossed(parent, spots, map, size) {
  if (!spots.length) return;
  const geo = new THREE.PlaneGeometry(size, size); geo.translate(0, size / 2, 0);
  const mat = skyLit(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }));
  const im = new THREE.InstancedMesh(geo, mat, spots.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, y, z, a, s], i) => {
    for (let j = 0; j < 2; j++) im.setMatrixAt(i * 2 + j, m4.compose(new THREE.Vector3(x, y - 0.01, z), q.setFromAxisAngle(up, a + j * Math.PI / 2), new THREE.Vector3(s, s, s)));
  });
  im.receiveShadow = true; im.userData.foliage = 'grass'; parent.add(im);
}

// Rocks: a jittered icosahedron, flat shaded, scaled flatter than tall, half sunk into the ground.
function rockGeo(seed) {
  const r = rng(seed), geo = new THREE.IcosahedronGeometry(1, 0), p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.75 + r() * 0.5);
    const s = seen.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
  }
  geo.computeVertexNormals(); return geo;
}
function instanced(parent, geo, mat, list, { cast = true } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach(({ p, s, ry = 0, rx = 0, rz = 0 }, i) => im.setMatrixAt(i, m4.compose(new THREE.Vector3(...p), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(...(Array.isArray(s) ? s : [s, s, s])))));
  im.castShadow = cast; im.receiveShadow = true; parent.add(im); return im;
}

// spots: { plains, forests, sands, mountains, banks: [{x,z,h,dx,dy}], castle, outskirts, villages } as world-space
// cell centres. Returns billboards (sprites that turn with the camera yaw), the castle's lights and the
// villages' label anchors. calm (the war map, A2): woods as a few big crowns that close into one canopy,
// open ground left open (a rare bush, sparse grass, few pebbles), so the generals stand out.
// painted (the war map's painted look, src/warplate.js): woods, grass, reeds and rocks are painted into the
// ground and planted as sprites there; only the castle, villages and cottages are stood up here.
export function dressBoard(scene, s, seed = 7, { calm = false, painted = false } = {}) {
  const r = rng(seed), rnd = (a, b) => a + r() * (b - a), off = (lim) => (r() - 0.5) * lim;
  const billboards = [];
  const board = (map, w, h, x, y, z) => {
    const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, skyLit(new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 })));
    m.position.set(x, y - 0.02, z); m.castShadow = true; m.receiveShadow = true; m.userData.foliage = 'leaf'; scene.add(m); billboards.push(m); return m;
  };
  // A cell's centre stays clear (units stand there); dressing goes in a ring around it.
  const ring = (lim = 0.92, clear = 0.26) => { for (;;) { const a = off(lim), b = off(lim); if (Math.max(Math.abs(a), Math.abs(b)) > clear) return [a, b]; } };

  if (!painted) {
  // Trees: solid 3D trees (src/structures.js), three to five per forest cell, pines mixed in; bushes stay sprites.
  const bushes = Array.from({ length: 4 }, (_, i) => bushSprite(i)), trees = [];
  for (const c of s.forests) {
    if (calm) { // two broad crowns on opposite corners, the odd pine; together the cells close into one wood
      // The two rows of wood in front of the castle (toward the camera) stay low: it is what the battle is for.
      const ahead = s.castle && Math.abs(c.x - s.castle.x) < 1.6 && c.z > s.castle.z + 0.5 && c.z < s.castle.z + 2.6;
      if (ahead) { trees.push({ x: c.x + off(0.3), z: c.z + 0.2, h: c.h, s: rnd(0.8, 0.95), ry: r() * 6.3 }); continue; }
      const q = r() * Math.PI * 2;
      for (let i = 0; i < 2; i++) { const a = q + i * Math.PI + off(0.6), d = rnd(0.28, 0.38); trees.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, h: c.h, s: rnd(1.6, 1.95), ry: r() * 6.3, pine: r() < 0.12 }); }
      continue;
    }
    const n = 3 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) { const [a, b] = ring(0.9, 0.26); trees.push({ x: c.x + a, z: c.z + b, h: c.h, s: rnd(1.0, 1.45), ry: r() * 6.3, pine: r() < 0.25 }); }
    for (let i = 0; i < 2; i++) { const [a, b] = ring(0.9, 0.3); board(bushes[(r() * 4) | 0], 0.5, 0.29, c.x + a, c.h, c.z + b); }
  }
  // Plains: occasional bush or lone tree.
  for (const c of s.plains) {
    if (r() < (calm ? 0.03 : 0.12)) { const [a, b] = ring(0.85, 0.32); board(bushes[(r() * 4) | 0], 0.46, 0.27, c.x + a, c.h, c.z + b); }
    if (r() < (calm ? 0.015 : 0.03)) { const [a, b] = ring(0.8, 0.34); trees.push({ x: c.x + a, z: c.z + b, h: c.h, s: rnd(1.1, 1.5), ry: r() * 6.3 }); }
  }
  for (const c of s.wildForests || []) for (let i = 0; i < (calm ? 2 : 3); i++) trees.push({ x: c.x + off(0.85), z: c.z + off(0.85), h: c.h, s: calm ? rnd(1.5, 1.9) : rnd(1.0, 1.5), ry: r() * 6.3, pine: r() < 0.35 });
  plantTrees(scene, trees, seed);

  // Tall grass and flowers: dense on plains, sparser on forest floor and dry ground.
  const tufts = TUFTS.map(() => []);
  const tuft = (c, n, lim) => { for (let i = 0; i < n; i++) { const [a, b] = ring(lim, 0.14); tufts[r() < 0.7 ? 0 : r() < 0.5 ? 1 : 2].push([c.x + a, c.h, c.z + b, r() * Math.PI, rnd(0.7, 1.3)]); } };
  for (const c of s.plains) tuft(c, calm ? (r() < 0.25 ? 1 : 0) : 3, 0.95);
  if (!calm) for (const c of s.forests) tuft(c, 2, 0.9);
  for (const c of s.sands) tuft(c, calm ? (r() < 0.4 ? 1 : 0) : 2, 0.9);
  tufts.forEach((list, k) => crossed(scene, list, TUFTS[k], 0.17));
  // Reeds along the water side of each bank cell.
  const reeds = [];
  for (const b of s.banks) for (let i = 0; i < 2; i++) {
    const t = off(0.9), e = 0.36 + r() * 0.1;
    reeds.push([b.x + (b.dx ? b.dx * e : t), b.h, b.z + (b.dy ? b.dy * e : t), r() * Math.PI, rnd(0.8, 1.3)]);
  }
  crossed(scene, reeds, REED, 0.3);

  // Rocks: scattered pebbles on open ground, boulders on dry ground, craggy outcrops on mountains.
  const rockMat = new THREE.MeshStandardMaterial({ color: '#77746e', roughness: 1, flatShading: true });
  const mossMat = new THREE.MeshStandardMaterial({ color: '#56603e', roughness: 1, flatShading: true });
  const geos = [rockGeo(1), rockGeo(2), rockGeo(3)];
  const rocks = geos.map(() => []), mossy = geos.map(() => []);
  const rock = (c, sz, lim, list = rocks) => { const [a, b] = ring(lim, 0.28); list[(r() * 3) | 0].push({ p: [c.x + a, c.h - sz * 0.25, c.z + b], s: [sz * rnd(0.8, 1.3), sz, sz * rnd(0.8, 1.3)], ry: r() * 6 }); };
  for (const c of s.plains) if (r() < (calm ? 0.08 : 0.35)) rock(c, rnd(0.04, 0.08), 0.95, r() < 0.5 ? mossy : rocks);
  for (const c of s.sands) for (let i = 0; i < (calm ? 1 : 2); i++) rock(c, rnd(0.05, 0.12), 0.95);
  if (!calm) for (const c of s.forests) if (r() < 0.4) rock(c, rnd(0.06, 0.1), 0.9, mossy);
  for (const c of s.wildRocks || []) if (r() < 0.5) rock(c, rnd(0.1, 0.22), 0.95);
  for (const c of s.mountains) {
    if (calm) { if (r() < 0.6) rock(c, rnd(0.16, 0.26), 0.66); continue; } // the odd outcrop on a rounded hill (ring() keeps 0.28 clear: lim must exceed 0.56)
    for (let i = 0; i < 2; i++) rock(c, rnd(0.1, 0.2), 0.95);
    for (let i = 0; i < 2; i++) rock(c, rnd(0.05, 0.09), 0.9);
  }
  geos.forEach((g, i) => { instanced(scene, g, rockMat, rocks[i]); instanced(scene, g, mossMat, mossy[i]); });

  // Stumps and fallen logs in the woods.
  const woodMat = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1 });
  const stumps = [], logs = [];
  for (const c of calm ? [] : s.forests) {
    if (r() < 0.35) { const [a, b] = ring(0.85, 0.3); stumps.push({ p: [c.x + a, c.h + 0.03, c.z + b], s: [1, 1, 1], ry: r() * 6 }); }
    if (r() < 0.15) { const [a, b] = ring(0.8, 0.32); logs.push({ p: [c.x + a, c.h + 0.035, c.z + b], s: [1, 1, 1], rz: Math.PI / 2, ry: r() * 6 }); }
  }
  instanced(scene, new THREE.CylinderGeometry(0.05, 0.065, 0.07, 7), woodMat, stumps);
  instanced(scene, new THREE.CylinderGeometry(0.035, 0.04, 0.42, 6), woodMat, logs);
  }

  // The castle, villages and a few cottages on the castle's outskirts.
  const fort = s.castle ? buildFortress(scene, s.castle, s.castleColor, { facing: s.castle.facing ?? 0 }) : { lights: [], flags: [] };
  const labels = s.villages.map((v, i) => buildVillage(scene, v, seed + i * 7, v.kind));
  // Outskirts: two cottages per open cell around the castle, in the corners facing away from it.
  for (const c of s.outskirts) {
    const ax = Math.sign(c.x - s.castle.x), az = Math.sign(c.z - s.castle.z);
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].sort((p, q) => (q[0] * ax + q[1] * az) - (p[0] * ax + p[1] * az) + off(0.5));
    for (const [sx, sz] of corners.slice(0, 2)) buildCottage(scene, { x: c.x + sx * 0.3, z: c.z + sz * 0.3, h: c.h }, (r() * 1e6) | 0);
  }
  const flags = fort.flags;

  return {
    billboards, lights: fort.lights, labels,
    update(t) { labels.forEach((l) => l.tick?.(t)); flags.forEach((f, i) => { const p = f.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, Math.sin(t * 3 + x * 14 + i) * 0.03 * x / 0.22); } p.needsUpdate = true; }); },
  };
}
