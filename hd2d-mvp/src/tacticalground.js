// The 白兵 field's painted look (A2, as the war map): the ground is baked once per battle onto one canvas from
// the war map's painted materials (assets/ai/warground, GPT image against the approved concept), laid where each
// board class lies with its edge broken by noise so terrains meet like paint; the month's grass and snow on top,
// a faint grid on the 16×10 board, and the shadows of woods and knolls painted in. The relief is one smooth
// heightfield: rock cells rise as rounded knolls whose steep flanks show the painted cliff band, water cells
// sink into pools under a painted water plane, the country climbs gently away behind the board and stays low
// in front of it (N09: nothing between the camera and the front row). 城战's towers are raised stone decks rimmed
// by a painted crenellated wall (tools/gen_tactical_codex.sh) over a paved yard; woods are painted crowns on quads.
import * as THREE from 'three';
import { data } from './core/game.js';
import { plateKey } from './seasonenv.js';
import { vnoise } from './diorama.js';

const WG = 'assets/ai/warground/', TG = 'assets/ai/tactical/';
const cache = new Map();
const image = (url) => cache.get(url) ?? cache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; })).get(url);
const json = (url) => cache.get(url) ?? cache.set(url, fetch(url).then((r) => r.json())).get(url);

// The month's ground at the battle's latitude, from the same horizon plate the scene's ring shows.
function seasonOf(month, lat) {
  const k = plateKey(month, lat);
  if (k === 'winter') return { grass: 'grass-autumn', snow: true, trees: 'trees-winter' };
  if (k === 'autumn' || k === 'winter-south') return { grass: 'grass-autumn', trees: 'trees-autumn' };
  if (k === 'spring') return { grass: 'grass-spring', trees: 'trees-spring' };
  return { grass: 'grass', trees: 'trees' };
}
const MATS = ['dirt', 'sand', 'hilltop', 'forest-floor', 'paving', 'bank', 'water', 'cliff', 'snow', 'village'];
let loaded = null;
// Before the field is built (app.js awaits it): the materials for this battle's month and place.
export async function loadTacticalGround(month, city) {
  const key = `${month}|${city}`;
  if (loaded?.key === key) return loaded;
  const season = seasonOf(month, data()?.cities[city]?.lat ?? 33);
  const names = [...MATS, season.grass];
  const [imgs, atlas, sheet, sets] = await Promise.all([
    Promise.all(names.map((n) => image(`${WG}${n}.webp`))), image(`${WG}${season.trees}.webp`), json(`${WG}${season.trees}.json`),
    Promise.all(['wall-face', 'wall-top', 'banners'].map((n) => image(`${TG}${n}.webp`).catch(() => null))),
  ]);
  const bannerRects = sets[2] ? await json(`${TG}banners.json`).catch(() => null) : null;
  const img = Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
  img.grass = img[season.grass];
  loaded = { key, season, img, atlas, sheet, wallFace: sets[0], wallTop: sets[1], banners: bannerRects && { img: sets[2], ...bannerRects } };
  return loaded;
}
export const tacticalGround = (month, city) => (loaded?.key === `${month}|${city}` ? loaded : null);

// How many cells one repeat of a swatch spans.
const SPAN = { grass: 5, snow: 5, dirt: 4.5, sand: 5, hilltop: 3, 'forest-floor': 4, paving: 2.6, bank: 2.5, water: 4 };
const PX = 56, M = 8; // canvas texels and mask texels a cell
export const WATER_Y = 0.25, KNOLL = 0.62, H0 = 0.32; // H0: the board's level ground
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Box blur in place, r texels, twice (≈ a gaussian).
function blur(F, w, h, r) {
  const T = new Float32Array(F.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += F[y * w + xx]; n++; } } T[y * w + x] = s / n; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += T[yy * w + x]; n++; } } F[y * w + x] = s / n; }
  }
  return F;
}

// Whether a point (board cell coordinates) lies on or at the edge of any of the towers' cells.
const underTower = (T, x, y) => { for (const cx of new Set([Math.floor(x - 1e-6), Math.floor(x + 1e-6)])) for (const cy of new Set([Math.floor(y - 1e-6), Math.floor(y + 1e-6)])) if (T.has(`${cx},${cy}`)) return true; return false; };

// The field for a board: map (GH rows of GW classes: 0 open, 1 wood, 2 rock, 3 deep water, 4 ford, 5 wall),
// terrain (0 woods … 5 castle), apron (cells of country round the board). Returns the masks and the height
// function every other piece stands on.
export function fieldOf({ map, terrain, GW, GH, apron, seed }) {
  const NX = GW + apron * 2, NZ = GH + apron * 2, w = NX * M, h = NZ * M;
  const cls = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH ? map[y][x] : -1);
  const layer = (f) => { const F = new Float32Array(w * h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) F[j * w + i] = f(Math.floor(i / M) - apron, Math.floor(j / M) - apron); return F; };
  const n1 = (x, y) => vnoise(x * 1.4, y * 1.4, seed) * 0.6 + vnoise(x * 3.9, y * 3.9, seed + 5) * 0.4;
  const rock = blur(layer((x, y) => cls(x, y) === 2), w, h, 2);
  const deep = blur(layer((x, y) => cls(x, y) === 3), w, h, 2), ford = blur(layer((x, y) => cls(x, y) === 4), w, h, 2);
  const wood = blur(layer((x, y) => cls(x, y) === 1), w, h, 2);
  const at = (F, i, j) => F[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  const towers = terrain === 5 ? towersOf(map, GW, GH) : null;
  const H = new Float32Array((w + 1) * (h + 1)), knoll = new Float32Array(w * h), pool = new Float32Array(w * h);
  for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
    const x = i / M - apron, y = j / M - apron, ii = Math.min(w - 1, i), jj = Math.min(h - 1, j), n = n1(x, y);
    // Rock cells: a rounded knoll, steep at its foot (the painted cliff band shows there), domed on top.
    const r = at(rock, ii, jj) + (n - 0.5) * 0.3, k = smooth(0.22, 0.42, r), crag = vnoise(x * 3.1, y * 3.1, seed + 17);
    // Water cells: a pool, its bank broken by the same noise.
    const wd = at(deep, ii, jj) + (n - 0.5) * 0.2, wf = at(ford, ii, jj) + (n - 0.5) * 0.2;
    const p = Math.max(smooth(0.3, 0.55, wd), smooth(0.3, 0.55, wf) * 0.62);
    // The country: level beside the board, rolling away behind and to the sides; low in front (N09).
    const cx = Math.max(0, Math.min(GW, x)), cy = Math.max(0, Math.min(GH, y)), dx = Math.abs(x - cx), back = Math.max(0, cy - y), front = Math.max(0, y - cy);
    const dd = Math.max(dx, back), roll = vnoise(x * 0.18, y * 0.18, seed + 9);
    const country = smooth(1.5, 9, dd) * (0.9 + roll * 1.6) - smooth(0.5, 4, front) * 0.06 + (vnoise(x * 0.5, y * 0.5, seed + 3) - 0.5) * 0.06 * smooth(1, 3, dd + front);
    // a knoll's top is broken into ledges and boulders rather than domed
    const v = H0 + k * (KNOLL * (0.72 + n * 0.32) + (crag - 0.5) * 0.22 * smooth(0.5, 1, k)) - p * 0.26 + country;
    // under a tower's run off the board the rising country stays below its deck (it would come up through it)
    H[j * (w + 1) + i] = towers && underTower(towers, x, y) ? Math.min(v, TOWER.deck - 0.06) : v;
    if (i < w && j < h) { knoll[j * w + i] = k; pool[j * w + i] = p; }
  }
  const height = (x, y) => { // board cell coordinates, continuous (cell centres at .5)
    const fx = (x + apron) * M, fy = (y + apron) * M, i = Math.max(0, Math.min(w - 1, Math.floor(fx))), j = Math.max(0, Math.min(h - 1, Math.floor(fy))), u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
    const a = H[j * (w + 1) + i], b = H[j * (w + 1) + i + 1], c = H[(j + 1) * (w + 1) + i], d = H[(j + 1) * (w + 1) + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // Where a man stands at a board cell's centre: atop a tower's deck or halfway up its stair, else on the ground.
  const stand = (x, y) => { const c = towers?.get(`${x},${y}`); return c ? c.h : height(x + 0.5, y + 0.5); };
  return { NX, NZ, w, h, apron, GW, GH, map, terrain, seed, cls, rock, wood, knoll, pool, height, n1, towers, stand };
}

// 城战's towers (城楼), as the original draws them: each knot of wall cells (class 5) rims a raised stone deck,
// and the defending archers' set (formation 4) stands on the deck to shoot down at the yard. The rules are the
// board's: wall cells stay closed to men and open to arrows, the deck cells are open ground, and the gaps in the
// rim (open cells on the rim's line with open ground outside) are stairs up to the deck. A tower that runs off the
// board's edge carries on a cell or two beyond it, closed by a rim, so it is not cut off at the board.
// Returns Map 'x,y' → { kind: 'wall' | 'deck' | 'stair', h (standing height), up ([dx, dy] the stair climbs) }.
const NORTH_RUN = 6;
export const TOWER = { deck: H0 + 0.5, rim: H0 + 0.58 }; // low enough that the yard row behind a tower keeps its feet in sight
export function towersOf(map, GW, GH) {
  const walls = [];
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (map[y][x] === 5) walls.push([x, y]);
  // knots: walls within two cells of each other (the rim's gaps are one cell wide)
  const group = walls.map((_, i) => i), root = (i) => (group[i] === i ? i : (group[i] = root(group[i])));
  for (let i = 0; i < walls.length; i++) for (let j = 0; j < i; j++) if (Math.max(Math.abs(walls[i][0] - walls[j][0]), Math.abs(walls[i][1] - walls[j][1])) <= 2) group[root(i)] = root(j);
  const boxes = new Map();
  walls.forEach(([x, y], i) => { const r = root(i), b = boxes.get(r) ?? { x0: x, x1: x, y0: y, y1: y }; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); boxes.set(r, b); });
  const out = new Map(), on = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH, mid = (TOWER.deck + H0) / 2;
  for (const b of boxes.values()) {
    if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 1) continue; // a lone wall is no tower
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      if (map[y][x] === 5) { out.set(`${x},${y}`, { kind: 'wall', h: TOWER.rim }); continue; }
      // a gap on the rim's line, open ground outside it: a stair climbing inward
      const up = x === b.x0 ? [1, 0] : x === b.x1 ? [-1, 0] : y === b.y0 ? [0, 1] : y === b.y1 ? [0, -1] : null;
      if (up && on(x - up[0], y - up[1]) && map[y - up[1]][x - up[0]] !== 5) out.set(`${x},${y}`, { kind: 'stair', h: mid, up });
      else out.set(`${x},${y}`, { kind: 'deck', h: TOWER.deck });
    }
    // off the board's edge the tower runs on, its side walls and the deck between them. Behind the board (north) it
    // runs out past the top of the view, open, as a stretch of the city's wall would; in front (south, under the HUD)
    // two cells, closed by a rim.
    for (const [edge, dy, run] of [[b.y0 === 0, -1, NORTH_RUN], [b.y1 === GH - 1, 1, 2]]) {
      if (!edge) continue;
      const y0 = dy < 0 ? -1 : GH;
      for (let k = 0; k < run; k++) for (let x = b.x0; x <= b.x1; x++) {
        const y = y0 + dy * k, side = x === b.x0 || x === b.x1 || (dy > 0 && k === run - 1);
        out.set(`${x},${y}`, side ? { kind: 'wall', h: TOWER.rim } : { kind: 'deck', h: TOWER.deck });
      }
    }
  }
  return out;
}

// A tiled pattern of a swatch, aligned to the canvas's cell grid.
function pattern(g, img, span, shift = 0) {
  const p = g.createPattern(img, 'repeat'), k = (span * PX) / img.width;
  p.setTransform(new DOMMatrix([k, 0, 0, k, (shift * 157) % (span * PX), (shift * 97) % (span * PX)]));
  return p;
}
// A material laid through a mask: alpha(i, j) per mask texel (0…1), drawn smooth at canvas size.
function lay(g, F, G, name, alpha, shift = 0) {
  const { w, h } = F, m = document.createElement('canvas'); m.width = w; m.height = h;
  const mg = m.getContext('2d'), id = mg.createImageData(w, h);
  let any = false;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const a = Math.max(0, Math.min(1, alpha(i, j))); id.data[(j * w + i) * 4 + 3] = a * 255; if (a > 0) any = true; }
  if (!any) return;
  mg.putImageData(id, 0, 0);
  const W = F.NX * PX, H = F.NZ * PX, c = document.createElement('canvas'); c.width = W; c.height = H;
  const cg = c.getContext('2d');
  cg.imageSmoothingEnabled = true; cg.drawImage(m, 0, 0, W, H);
  cg.globalCompositeOperation = 'source-in'; cg.fillStyle = pattern(cg, G.img[name], SPAN[name], shift); cg.fillRect(0, 0, W, H);
  g.drawImage(c, 0, 0);
}

// The ground canvas: every material where it lies, the woods' and knolls' shadows, the grid, the country dimmed
// with distance. trees: [{ x, y, size }] in board cells, for their painted shadows.
export function bakeGround(G, F, trees) {
  const { NX, NZ, w, h, apron, GW, GH, terrain, seed, cls, knoll, pool, wood, n1 } = F;
  const W = NX * PX, Hh = NZ * PX, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = Hh;
  const g = canvas.getContext('2d');
  const xy = (i, j) => [i / M - apron, j / M - apron];
  const onBoard = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH;
  const n2 = (x, y, s) => vnoise(x * 0.7, y * 0.7, seed + s);
  // base: the month's meadow (sand for the desert)
  g.fillStyle = pattern(g, G.img[terrain === 1 ? 'sand' : 'grass'], SPAN[terrain === 1 ? 'sand' : 'grass']); g.fillRect(0, 0, W, Hh);
  if (terrain === 1) lay(g, F, G, 'grass', (i, j) => { const [x, y] = xy(i, j), d = Math.max(-x, x - GW, -y, y - GH); return smooth(0.62, 0.72, n2(x, y, 21) - smooth(2, 9, d) * 0.25) ; });
  // trampled earth: patches over the country, a worn band where the lines meet on the board
  lay(g, F, G, 'dirt', (i, j) => {
    const [x, y] = xy(i, j), band = onBoard(x, y) ? smooth(4.5, 1.2, Math.abs(x - GW / 2)) * 0.35 : 0;
    return smooth(0.62, 0.74, n2(x, y, 7) * 0.8 + n1(x, y) * 0.3 + band) * (terrain === 1 ? 0.5 : 0.75);
  }, 1);
  // a fortress yard (as the original's 城战, paved wall to wall): flagstones across the board, broken into the
  // meadow at its rim; swept of snow, which lies only on the country beyond
  const yard = terrain === 5 ? (x, y) => smooth(0.9, 0.2, Math.max(-x, x - GW, -y, y - GH) + (n1(x, y) - 0.5) * 0.9) : () => 0;
  if (terrain === 5) lay(g, F, G, 'paving', (i, j) => yard(...xy(i, j)), 2);
  // woods: their floor under and round the crowns
  lay(g, F, G, 'forest-floor', (i, j) => smooth(0.25, 0.45, wood[j * w + i] + (n1(...xy(i, j)) - 0.5) * 0.2), 3);
  for (const t of trees) if (!onBoard(t.x, t.y)) { /* the country's groves: floor painted under each */ }
  // pools: a pebble bank round them (the water plane covers the middle)
  lay(g, F, G, 'bank', (i, j) => smooth(0.05, 0.3, pool[j * w + i]), 4);
  // knolls: the rocky top
  lay(g, F, G, 'hilltop', (i, j) => smooth(0.12, 0.45, knoll[j * w + i]), 5);
  // the country's far rises: rock where it climbs high
  lay(g, F, G, 'hilltop', (i, j) => { const [x, y] = xy(i, j); return smooth(1.05, 1.35, F.height(x, y)) * 0.85; }, 6);
  // winter: snow over everything but the trampled band, thinner on the board
  if (G.season.snow) lay(g, F, G, 'snow', (i, j) => {
    // on the board: a thin, broken cover, trodden away where the lines meet; drifts lie deeper beyond it
    const [x, y] = xy(i, j), on = onBoard(x, y), b = on ? 0.2 + smooth(5, 1, Math.abs(x - GW / 2)) * 0.3 : 0;
    const v = n2(x * 2.2, y * 2.2, 31) * 0.55 + n1(x * 1.7, y * 1.7) * 0.45 + 0.3 - b;
    return smooth(0.3, 0.7, v) * (on ? 0.75 : 1) * (1 - pool[j * w + i]) * (1 - yard(x, y));
  }, 7);
  // painted shadows: the woods' crowns throw theirs to the lower right (the sun is upper left), knolls darken at the foot
  g.save();
  for (const t of trees) {
    const cx = (t.x + apron + t.size * 0.35) * PX, cy = (t.y + apron + 0.05) * PX, r = t.size * 0.55 * PX;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(18,22,10,0.42)'); gr.addColorStop(1, 'rgba(18,22,10,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  // occlusion at the foot of a knoll and the edge of a pool, and the country dimmed with distance
  {
    const m = document.createElement('canvas'); m.width = w; m.height = h;
    const mg = m.getContext('2d'), id = mg.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const [x, y] = xy(i, j), k = knoll[j * w + i], p = pool[j * w + i];
      const foot = k > 0.02 && k < 0.5 ? (1 - Math.abs(k - 0.2) / 0.3) * 0.28 : 0, wet = p > 0.02 ? 0.12 + smooth(0.3, 0.9, p) * 0.45 : 0; // a pool's bed darkens toward its middle
      const d = Math.max(-x, x - GW, -y, y - GH), far = smooth(0.8, 7, d) * 0.62;
      id.data[(j * w + i) * 4 + 3] = Math.min(1, foot + wet + far) * 255;
    }
    mg.putImageData(id, 0, 0);
    g.save(); g.imageSmoothingEnabled = true; g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const c = document.createElement('canvas'); c.width = W; c.height = Hh; const cg = c.getContext('2d');
    cg.drawImage(m, 0, 0, W, Hh); cg.globalCompositeOperation = 'source-in'; cg.fillStyle = '#1a140c'; cg.fillRect(0, 0, W, Hh);
    g.drawImage(c, 0, 0); g.restore();
  }
  // the grid: a faint line between the board's cells (not across walls or pools)
  g.save(); g.strokeStyle = 'rgba(28,22,12,0.2)'; g.lineWidth = 1.5; g.beginPath();
  for (let x = 0; x <= GW; x++) { g.moveTo((x + apron) * PX, apron * PX); g.lineTo((x + apron) * PX, (GH + apron) * PX); }
  for (let y = 0; y <= GH; y++) { g.moveTo(apron * PX, (y + apron) * PX); g.lineTo((GW + apron) * PX, (y + apron) * PX); }
  g.stroke();
  g.strokeStyle = 'rgba(255,240,200,0.07)'; g.beginPath();
  for (let x = 0; x <= GW; x++) { g.moveTo((x + apron) * PX + 1.5, apron * PX); g.lineTo((x + apron) * PX + 1.5, (GH + apron) * PX); }
  for (let y = 0; y <= GH; y++) { g.moveTo(apron * PX, (y + apron) * PX + 1.5); g.lineTo((GW + apron) * PX, (y + apron) * PX + 1.5); }
  g.stroke(); g.restore();
  void cls;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// The relief as one mesh: the baked ground on top, and on steep flanks the painted cliff band projected from
// the side (a top-down texture would smear down a slope).
const CLIFF = new WeakMap();
export function groundMesh(G, F, tex, wx0, wz0, SUB = 6) {
  const { NX, NZ } = F;
  const geo = new THREE.PlaneGeometry(NX, NZ, NX * SUB, NZ * SUB); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + NX / 2 - F.apron, y = pos.getZ(i) + NZ / 2 - F.apron;
    pos.setY(i, F.height(x, y));
  }
  geo.translate(wx0 + NX / 2, 0, wz0 + NZ / 2);
  geo.computeVertexNormals();
  // One cliff texture per painted image: the shader holds it outside the material, where release() (fx.js) does not
  // look, so a new one per battle stayed on the GPU for good.
  let cliff = CLIFF.get(G.img.cliff);
  if (!cliff) { cliff = new THREE.Texture(G.img.cliff); cliff.wrapS = cliff.wrapT = THREE.RepeatWrapping; cliff.colorSpace = THREE.SRGBColorSpace; cliff.anisotropy = 4; cliff.needsUpdate = true; CLIFF.set(G.img.cliff, cliff); }
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uCliff = { value: cliff };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uCliff; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
 { vec3 n = normalize(vWN); float steep = smoothstep(0.3, 0.52, 1.0 - n.y);
   float a = abs(n.x) > abs(n.z) ? vWP.z : vWP.x;
   vec4 c = texture2D(uCliff, vec2(a * 0.5, clamp((vWP.y - 0.28) * 1.25, 0.04, 0.97)));
   diffuseColor.rgb = mix(diffuseColor.rgb, c.rgb * 0.9, steep); }`);
  };
  mat.customProgramCacheKey = () => 'tactical-ground';
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.userData.noSeason = true; mesh.userData.part = 'ground';
  return mesh;
}

// The painted water over the pools (only where the ground dips under it).
export function waterMesh(G, F, wx0, wz0) {
  const m0 = document.createElement('canvas'); m0.width = F.w; m0.height = F.h;
  const mg = m0.getContext('2d'), id = mg.createImageData(F.w, F.h);
  for (let i = 0; i < F.w * F.h; i++) { const a = smooth(0.24, 0.62, F.pool[i]) * 255; id.data.set([a, a, a, 255], i * 4); }
  mg.putImageData(id, 0, 0);
  const alpha = new THREE.CanvasTexture(m0); alpha.flipY = true;
  const t = new THREE.Texture(G.img.water); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  t.repeat.set(F.NX / SPAN.water, F.NZ / SPAN.water);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(F.NX, F.NZ), new THREE.MeshStandardMaterial({ map: t, alphaMap: alpha, transparent: true, opacity: 0.82, roughness: 0.3, metalness: 0, color: '#7f9a98', depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(wx0 + F.NX / 2, WATER_Y, wz0 + F.NZ / 2); m.receiveShadow = true; m.userData.noSeason = true; m.userData.water = true; m.userData.part = 'water';
  return m;
}

// 城战's towers (towersOf): the rim's wall cells and the deck as solid stone raised over the yard, the stairs as
// steps, every open side faced with the painted wall (tools/gen_tactical_codex.sh). The rim's outer faces (but the
// north ones, which face away from the camera) rise past the walk into the painted merlons (their gaps cut out), so
// the deck's archers stand behind a parapet; the faces toward the deck and the stairs stop at the walk. The face's painted cap
// course lies at the rim's walk wherever the face runs, so blocks of every height continue one wall.
// wx / wz: cell → world centre. Tagged as ground, so marks laid on the field (爆炎's scorch) sit on the deck.
const STEPS = 6, SUBS = 6; // a stair's steps, and the fine cells a board cell is cut into to lay them
export function towerMeshes(G, F, wx, wz, H0) {
  const T = F.towers, out = new THREE.Group(); out.userData.part = 'walls';
  if (!T?.size || !G.wallFace || !G.wallTop) return out;
  const BASE = H0 - 0.3, FH = (TOWER.rim - H0) / 0.75, MER = TOWER.rim + 0.25 * FH;
  // the height of fine cell (i, j) (SUBS to a board cell) and whether it is any of the tower's
  const fine = (i, j) => {
    const x = Math.floor(i / SUBS), y = Math.floor(j / SUBS), c = T.get(`${x},${y}`);
    if (!c) return null;
    if (c.kind !== 'stair') return c;
    const a = i - x * SUBS, b = j - y * SUBS, [ux, uy] = c.up;
    const s = Math.floor(((ux > 0 ? a : ux < 0 ? SUBS - 1 - a : uy > 0 ? b : SUBS - 1 - b) * STEPS) / SUBS);
    return { kind: 'step', s, up: c.up, h: H0 + ((TOWER.deck - H0) * (s + 1)) / (STEPS + 1) };
  };
  const keys = [...T.keys()].map((k) => k.split(',').map(Number));
  const fx = (i) => wx(0) - 0.5 + i / SUBS, fz = (j) => wz(0) - 0.5 + j / SUBS;
  const faces = [], tops = { rim: [], deck: [] };
  const v = (y) => 0.75 + (y - TOWER.rim) / FH;
  for (const [x, y] of keys) for (let j = y * SUBS; j < (y + 1) * SUBS; j++) for (let i = x * SUBS; i < (x + 1) * SUBS; i++) {
    const c = fine(i, j), x0 = fx(i), x1 = fx(i + 1), z0 = fz(j), z1 = fz(j + 1), h = c.h;
    if (c.kind !== 'step') (c.kind === 'deck' ? tops.deck : tops.rim).push([[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], 1]);
    else {
      // A tread: darker the lower it lies, and darker still in a band along one edge. Mostly along its back, where
      // the next riser stands over it; but on a stair that climbs toward the camera ((10,7): it falls away north,
      // its risers face away and only treads show) the step above hides that corner, so the band lies along the
      // tread's front edge, where it drops to the step below, and is the only thing that reads it as steps.
      const [ux, uy] = c.up, toward = uy > 0, lit = (toward ? 0.7 : 0.8) + ((toward ? 0.3 : 0.2) * c.s) / (STEPS - 1), k = (toward ? 0.35 : 0.3) / SUBS;
      const [bx0, bx1, bz0, bz1] = ux > 0 ? [x1 - k, x1, z0, z1] : ux < 0 ? [x0, x0 + k, z0, z1] : [x0, x1, z0, z0 + k]; // north edge: the back of a stair climbing north, the front of one climbing south
      const [tx0, tx1, tz0, tz1] = ux > 0 ? [x0, x1 - k, z0, z1] : ux < 0 ? [x0 + k, x1, z0, z1] : [x0, x1, z0 + k, z1];
      const top = (a0, a1, b0, b1, col) => tops.rim.push([[a0, h, b1], [a1, h, b1], [a1, h, b0], [a0, h, b0], col]);
      top(tx0, tx1, tz0, tz1, lit);
      top(bx0, bx1, bz0, bz1, lit * 0.55);
    }
    // each side where the neighbour is lower, wound outward; u runs along the wall in world units
    for (const [di, dj, a, b, u0, u1] of [
      [0, 1, [x0, z1], [x1, z1], x0, x1], [0, -1, [x1, z0], [x0, z0], -x1, -x0],
      [1, 0, [x1, z1], [x1, z0], -z1, -z0], [-1, 0, [x0, z0], [x0, z1], z0, z1]]) {
      const n = fine(i + di, j + dj), lo = n ? n.h : BASE;
      if (lo >= h - 1e-4) continue;
      // the parapet stands on the rim's outer sides, but not on the north ones: those face away from the camera, and
      // a parapet there would hide the men in the yard behind the tower to the waist (row 6, behind the lower tower)
      const hi = c.kind === 'wall' && !n && dj !== -1 ? MER : h;
      faces.push([[a[0], lo, a[1]], [b[0], lo, b[1]], [b[0], hi, b[1]], [a[0], hi, a[1]], [u0, u1, v(lo), v(hi)]]);
    }
  }
  const geom = (list, face) => {
    const p = [], u = [], col = [], idx = [];
    list.forEach((q, k) => {
      p.push(...q[0], ...q[1], ...q[2], ...q[3]);
      if (!face) for (let m = 0; m < 4; m++) col.push(q[4], q[4], q[4]);
      if (face) { const [u0, u1, v0, v1] = q[4], s = 0.55; u.push(u0 * s, v0, u1 * s, v0, u1 * s, v1, u0 * s, v1); } else for (let m = 0; m < 4; m++) u.push(q[m][0] / 2, q[m][2] / 2);
      idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    if (!face) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const tx = (img, clampV) => { const t = new THREE.Texture(img); t.wrapS = THREE.RepeatWrapping; t.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t; };
  const fm = new THREE.Mesh(geom(faces, true), new THREE.MeshStandardMaterial({ map: tx(G.wallFace, true), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }));
  fm.customDepthMaterial = new THREE.MeshDepthMaterial({ map: fm.material.map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  const rm = new THREE.Mesh(geom(tops.rim, false), new THREE.MeshStandardMaterial({ map: tx(G.wallTop), roughness: 0.95, vertexColors: true }));
  const dm = new THREE.Mesh(geom(tops.deck, false), new THREE.MeshStandardMaterial({ map: tx(G.img.paving), roughness: 0.95 }));
  for (const m of [fm, rm, dm]) { m.castShadow = m.receiveShadow = true; m.userData.noSeason = true; m.userData.ground = m !== fm; out.add(m); }
  return out;
}

// Woods: one quad per tree from the season's sheet, standing on its foot and reclined by half the camera's
// pitch toward the eye (as the men are), stretched back to the painted proportions. The crowns are painted lit
// and shaded already, so they take no shadow; their own are painted into the ground (bakeGround).
// trees: [{ x, z, h, size (crown width, world units), pine, shade }].
export function plantWoods(G, trees, pitch, seed = 1) {
  const { rects, w: AW, h: AH } = G.sheet;
  const broad = rects.filter((r) => r[4] === 'broad'), pines = rects.filter((r) => r[4] === 'pine');
  const ref = Math.max(...broad.map((r) => r[2]));
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array(4).fill([0, 1, 0]).flat(), 3));
  const map = new THREE.Texture(G.atlas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.needsUpdate = true;
  const patch = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aRect.xy + uv * aRect.zw;\n#endif');
  };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = patch; mat.customProgramCacheKey = () => 'tactical-woods';
  const list = [...trees].sort((a, b) => a.z - b.z);
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  im.count = list.length;
  const rect = new Float32Array(Math.max(1, list.length) * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch / 2), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let k = seed >>> 0;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach((t, i) => {
    const set = t.pine ? pines : broad, [rx, ry, rw, rh] = set[Math.floor(rnd() * set.length)];
    const wide = (t.size * rw) / ref;
    im.setMatrixAt(i, m4.compose(v.set(t.x, t.h - 0.04, t.z), q, s.set(wide, (wide * rh) / rw / Math.cos(pitch / 2), 1)));
    rect.set(rnd() < 0.5 ? [rx / AW, 1 - (ry + rh) / AH, rw / AW, rh / AH] : [(rx + rw) / AW, 1 - (ry + rh) / AH, -rw / AW, rh / AH], i * 4);
    im.setColorAt(i, c.setScalar(t.shade ?? 1));
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  im.castShadow = false; im.receiveShadow = false; im.userData.noSeason = true; im.userData.part = 'woods'; im.frustumCulled = false;
  return im;
}

// Where the woods stand: two or three broad crowns closing into one canopy on each wood cell; groves over the
// country beside and behind the board, thinning toward it and none in front of it (N09). In board cells.
export function woodsOf(F) {
  const { GW, GH, apron, seed, cls } = F, out = [];
  let k = (seed * 7919) >>> 0;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (cls(x, y) === 1) {
    const n = 2 + (rnd() < 0.5);
    for (let i = 0; i < n; i++) out.push({ x: x + 0.2 + rnd() * 0.6, y: y + 0.15 + rnd() * 0.7, size: 1.1 + rnd() * 0.35, pine: rnd() < 0.15 });
  }
  for (let y = -apron; y < GH + apron; y++) for (let x = -apron; x < GW + apron; x++) {
    if (x >= -1 && x <= GW && y >= -1 && y <= GH) continue; // a clear ring round the board
    if (y >= GH) continue; // nothing in front of the board
    const d = Math.max(-1 - x, x - GW, -1 - y), grove = vnoise(x * 0.22, y * 0.22, seed + 13) + Math.min(0.25, d * 0.05);
    if (grove < 0.56) continue;
    const n = 1 + (rnd() < 0.6) + (grove > 0.7);
    for (let i = 0; i < n; i++) {
      const t = { x: x + rnd(), y: y + rnd(), size: 1.0 + rnd() * 0.5, pine: rnd() < 0.2, far: d };
      // none on a tower's run off the board, nor so near that the crown hangs over its wall
      if (!F.towers || ![-0.6, 0, 0.6].some((dx) => underTower(F.towers, t.x + dx * t.size, t.y))) out.push(t);
    }
  }
  return out;
}

// A side's war banner planted at its retreat edge: a turned pole, and the painted cloth (plain, no character)
// hanging from its crossbar, swaying from the top down. look: 'attacker' | 'defender'.
export function bannerMesh(G, look, toward = 1) {
  const g = new THREE.Group(), POLE = 2.5;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, POLE, 8), new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.8 }));
  pole.position.y = POLE / 2; pole.castShadow = true; g.add(pole);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), new THREE.MeshStandardMaterial({ color: '#8a6a32', roughness: 0.4, metalness: 0.5 }));
  tip.position.y = POLE + 0.09; g.add(tip);
  const B = G.banners, [rx, ry, rw, rh] = B.rects[look], H = 1.45, W = (H * rw) / rh;
  const t = new THREE.Texture(B.img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  t.repeat.set(rw / B.w, rh / B.h); t.offset.set(rx / B.w, 1 - (ry + rh) / B.h);
  const geo = new THREE.PlaneGeometry(W, H, 6, 10); geo.translate(W / 2 - 0.02, -H / 2, 0);
  // toward the board's left: the cloth's texture mirrored rather than the quad, so its front still faces the camera
  if (toward < 0) { const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); uv.setX(i, 1 - uv.getX(i)); } geo.index.array.reverse(); }
  const u = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color: '#e8e0d8', emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.18 });
  const wave = (s) => {
    s.uniforms.uTime = u.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
 float k = clamp(-position.y / ${H.toFixed(2)}, 0.0, 1.0) * 0.6 + clamp(abs(position.x) / ${W.toFixed(2)}, 0.0, 1.0) * 0.4;
 transformed.z += sin(uTime * 2.1 + position.y * 3.0 + position.x * 2.0) * 0.07 * k;
 transformed.x += sin(uTime * 1.3 + position.y * 2.0) * 0.03 * k;`);
  };
  mat.onBeforeCompile = wave; mat.customProgramCacheKey = () => 'banner';
  const depth = new THREE.MeshDepthMaterial({ map: t, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = wave; depth.customProgramCacheKey = () => 'banner-depth';
  const cloth = new THREE.Mesh(geo, mat); cloth.customDepthMaterial = depth; cloth.position.set(0, POLE - 0.05, 0.04); cloth.rotation.x = -0.35; cloth.castShadow = true;
  g.add(cloth); g.userData.part = 'banner'; g.userData.look = look; g.userData.noSeason = true; g.traverse((o) => { o.userData.noSeason = true; });
  g.userData.tick = (time) => { u.uTime.value = time; };
  return g;
}
