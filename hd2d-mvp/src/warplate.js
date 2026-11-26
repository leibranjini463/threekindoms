// The war map's painted look (A2): the ground, cliff faces, water and woods come from materials painted with
// GPT image against the approved concept (tools/gen_warground_codex.sh, tools/bake_warground.py), not from
// shader noise. At load each battlefield's ground is baked once onto two canvases (the board and its margin
// at PX texels a cell, the surrounding country coarser): every material is laid where its terrain lies, its
// edge broken by noise so terrains meet like paint, the month's grass and snow laid on top and a faint grid
// drawn on the playable cells. Per frame that is one texture fetch for the ground and a plain lit material,
// cheaper than the procedural tile shader it replaces; the woods are one instanced quad mesh.
import * as THREE from 'three';
import { groundSeason, seasonKey } from './warseason.js';
import { data, fieldArtOf } from './core/game.js';
import { vnoise } from './diorama.js';

export { groundSeason };
const DIR = 'assets/ai/warground/';
const cache = new Map();
const image = (n) => cache.get(n) ?? cache.set(n, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `${DIR}${n}.webp`; })).get(n);
const rectsOf = (n) => cache.get(`${n}.json`) ?? cache.set(`${n}.json`, fetch(`${DIR}${n}.json`).then((r) => r.json())).get(`${n}.json`);

const MATERIALS = ['dirt', 'sand', 'hilltop', 'forest-floor', 'paving', 'fields', 'bank', 'water', 'cliff', 'cliff-tier', 'snow', 'castle', 'village'];
let loaded = null;
// Before the battle scene is built (app.js): the materials for this battle's month and place.
export async function loadWarGround(month, city) {
  const T0 = performance.now(); // tools/scene_switch_trace.mjs (PERF-05): measures only
  const season = groundSeason(month, data()?.cities[city]?.lat ?? 33);
  const names = [...new Set([...MATERIALS, season.grass, season.mix?.[0]].filter(Boolean))];
  const [imgs, atlas, sheet] = await Promise.all([Promise.all(names.map(image)), image(season.trees), rectsOf(season.trees)]);
  // A painted battlefield (tools/gen_warmap_codex.sh), when one exists for this field: maps/<city>.json lists
  // the board's rectangle in the picture and a picture per season ('spring', 'summer', 'autumn', 'winter').
  let painted = null;
  try {
    const m = await (await fetch(`${DIR}maps/${fieldArtOf(city)}.json`, { cache: 'no-store' })).json(), file = m.images[seasonKey(month, season)] ?? Object.values(m.images)[0];
    painted = { board: m.board, img: await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `${DIR}maps/${file}`; }) };
  } catch { /* none for this field: the map is composed from the materials */ }
  loaded = { key: `${month}|${city}`, season, painted, img: Object.fromEntries(names.map((n, i) => [n, imgs[i]])), atlas, sheet };
  performance.measure('war:loadGround(async)', { start: T0 });
  return loaded;
}
export const warGround = (month, city) => (loaded?.key === `${month}|${city}` ? loaded : null);

// How many cells one repeat of a swatch spans.
const SPAN = { grass: 5, 'grass-spring': 5, 'grass-autumn': 5, snow: 5, dirt: 4.5, sand: 5, hilltop: 3.5, 'forest-floor': 4, paving: 3, fields: 6, bank: 3, water: 4.5 };

// A painter over cells [x0, x0 + w) × [y0, y0 + h) at px texels a cell. kind(x, y) → 'grass' | 'forest' |
// 'sand' | 'hill' | 'river' | 'castle' | 'fields' | null (outside: grass). mask(cover, …) thresholds a per-cell
// cover (0…1) with the battlefield's edge noise into an alpha mask (MR texels a cell); layMask lays a material
// through it; ground() lays every material, the month's grass and snow; grid() draws the faint cell lines.
export const MR = 12;
export function painter(G, { x0, y0, w, h, px, kind, near = () => 0, seed = 1 }) {
  const W = w * px, H = h * px, M = MR, mw = w * M, mh = h * M;
  const make = (cw, ch, o) => { const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch }); return [c, c.getContext('2d', o)]; };
  const [canvas, g] = make(W, H), [tmp, t] = make(W, H), [low, l] = make(w, h);
  // Edge noise at mask resolution: two octaves, fixed per battlefield.
  const N = new Float32Array(mw * mh);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    const x = x0 + i / M, y = y0 + j / M;
    N[j * mw + i] = vnoise(x * 1.3, y * 1.3, seed) * 0.62 + vnoise(x * 3.7, y * 3.7, seed + 3) * 0.38;
  }
  const pattern = (name, shift = 0, ctx = g) => {
    const p = ctx.createPattern(G.img[name], 'repeat'), k = (SPAN[name] * px) / G.img[name].width;
    p.setTransform(new DOMMatrix([k, 0, 0, k, (-x0 * px + shift * 157) % (SPAN[name] * px), (-y0 * px + shift * 97) % (SPAN[name] * px)]));
    return p;
  };
  const mask = (cover, { edge = 0.32, cut = 0.5, alpha = 1 } = {}) => {
    const img = l.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data[(y * w + x) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, cover(x0 + x, y0 + y))));
    l.putImageData(img, 0, 0);
    const [mid, m] = make(mw, mh, { willReadFrequently: true });
    m.imageSmoothingEnabled = true; m.imageSmoothingQuality = 'high'; m.drawImage(low, 0, 0, mw, mh);
    const d = m.getImageData(0, 0, mw, mh), a = d.data;
    let any = false;
    for (let i = 0; i < mw * mh; i++) {
      const v = a[i * 4 + 3] / 255 + (N[i] - 0.5) * edge, k = Math.max(0, Math.min(1, (v - cut) / 0.05 + 0.5));
      a[i * 4 + 3] = k * 255 * alpha; if (k > 0) any = true;
    }
    m.putImageData(d, 0, 0);
    return any ? mid : null;
  };
  // Fill through a mask: a material's pattern, or a colour / image source drawn by fill(ctx).
  const layMask = (what, mid, { filter = 'none', shift = 0, dx = 0, dy = 0, op = 'source-over' } = {}) => {
    if (!mid) return;
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, W, H);
    if (typeof what === 'function') what(t); else { t.fillStyle = typeof what === 'string' && G.img[what] ? pattern(what, shift, t) : what; t.fillRect(0, 0, W, H); }
    t.globalCompositeOperation = 'destination-in'; t.imageSmoothingEnabled = true; t.drawImage(mid, dx, dy, W, H);
    g.globalCompositeOperation = op; g.filter = filter; g.drawImage(tmp, 0, 0); g.filter = 'none'; g.globalCompositeOperation = 'source-over';
  };
  const lay = (name, cover, o = {}) => layMask(name, mask(cover, o), o);
  const S = G.season, K = (x, y) => kind(x, y) ?? 'grass', is = (...ks) => (x, y) => (ks.includes(K(x, y)) ? 1 : 0);
  function ground({ water = false } = {}) {
    g.fillStyle = pattern(S.grass); g.fillRect(0, 0, W, H);
    // The same grass again, shifted, in broad patches: the repeat no longer lines up into a visible tiling.
    lay(S.grass, () => 0.5, { edge: 0.9, shift: 1 });
    if (S.mix) lay(S.mix[0], () => S.mix[1] + 0.12, { edge: 1.1, shift: 2 });
    lay('dirt', (x, y) => (K(x, y) === 'grass' ? 0.12 + 0.5 * near(x, y) : 0), { edge: 1.2 });
    lay('fields', is('fields'), { edge: 0.25 });
    lay('sand', is('sand'));
    lay('forest-floor', is('forest'), { cut: 0.55 });
    // Hilltops lean to bare rock, greyer and darker than the meadow, so a hill never reads as a plain.
    lay('hilltop', is('hill'), { cut: 0.45, edge: 0.25, filter: 'saturate(0.6) brightness(0.88) contrast(1.08)' });
    lay('bank', is('river'), { cut: 0.36, edge: 0.3 });
    if (water) lay('water', is('river'), { cut: 0.52, edge: 0.3 });
    lay('paving', is('castle'), { edge: 0.06, cut: 0.5 });
    if (S.snow) lay('snow', (x, y) => (K(x, y) === 'river' && water ? 0 : S.snow + (K(x, y) === 'hill' ? 0.15 : K(x, y) === 'forest' ? -0.1 : 0)), { edge: 1.0, cut: 0.5 });
  }
  // The grid: a dark line with a lit edge beside it, faint, only between playable cells (not on water).
  function grid(on, { dark = 0.24, lit = 0.07 } = {}) {
    g.lineWidth = Math.max(1, px / 48);
    for (const [col, off] of [[`rgba(18, 22, 8, ${dark})`, 0], [`rgba(255, 240, 190, ${lit})`, g.lineWidth]]) {
      g.strokeStyle = col; g.beginPath();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!on(x0 + x, y0 + y)) continue;
        const X = x * px + off, Y = y * px + off;
        if (on(x0 + x + 1, y0 + y)) { g.moveTo(X + px, Y); g.lineTo(X + px, Y + px); }
        if (on(x0 + x, y0 + y + 1)) { g.moveTo(X, Y + px); g.lineTo(X + px, Y + px); }
      }
      g.stroke();
    }
  }
  return { canvas, g, W, H, px, x0, y0, mask, layMask, lay, ground, grid, pattern, K };
}

// Bake one plate for the 3D board; grid(x, y): whether the cell is playable (gets the grid line).
// key: what else the picture depends on (the battlefield's cells and villages); with it the canvas is kept, by the
// season's materials too, for the next battle on the same field (PERF-05): the paint is deterministic, so the same
// war entered again, or in another month of the same season, gets the same picture without painting it again. One
// battle's two plates are kept; each call still returns a texture of its own (the war disposes it when it ends).
const PLATES_MAX = 2, plates = [];
export function bakePlate(G, { grid = null, key = null, ...o }) {
  const k = key && `${JSON.stringify(G.season)}|${o.px}|${o.x0},${o.y0},${o.w},${o.h}|${grid ? 'grid' : ''}|${key}`;
  let canvas = k && plates.find((e) => e.k === k)?.canvas;
  if (!canvas) {
    const P = painter(G, o);
    P.ground();
    if (grid) P.grid(grid);
    canvas = P.canvas;
    if (k) { plates.push({ k, canvas }); if (plates.length > PLATES_MAX) plates.shift(); }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

const tiled = (img, rx = 1, ry = 1) => {
  const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rx, ry); t.anisotropy = 4; t.needsUpdate = true; return t;
};

// Swap the terrain's tile materials (src/diorama.js buildTerrain) for the plates and the painted cliff band.
// The tops carry uv already set to their plate (uvOf); the band is one image every 2.4 units along and 1.1
// units down a face, its grassy lip on the face's top edge.
const TIER_V = 1; // units one image of the mesa face spans down
export function paintTerrain(tiles, G, plates) {
  const cliff = tiled(G.img.cliff, 4 / 2.4, 4 / 1.1); cliff.offset.y = 1 - 4 / 1.1 - 0.002;
  // A mesa's face (cliff-tier): one image a unit down, its moss lip on the face's top edge and the last row carried on below if a
  // face runs deeper (clamped, not repeated, so a second lip never shows halfway down); 2.4 units along, as the band.
  const tier = tiled(G.img['cliff-tier'], 4 / 2.4, 4 / TIER_V); tier.wrapT = THREE.ClampToEdgeWrapping; tier.offset.y = 1 - 4 / TIER_V - 0.002;
  const mat = (map) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.95, metalness: 0 });
  const tops = Object.fromEntries(Object.entries(plates).map(([k, t]) => [k, mat(t)])), side = mat(cliff), tierSide = mat(tier);
  for (const mesh of tiles.children) {
    const [kind, name] = mesh.userData.key.split(':');
    if (name === 'wall') continue; // the castle's walls keep their own (seasons.js snows on them)
    mesh.material = kind === 't' ? tops[name] : name === 'tier' ? tierSide : side;
    mesh.userData.noSeason = true;
  }
}

export const paintedWater = (G, w, h) => tiled(G.img.water, w / SPAN.water, h / SPAN.water);

// Woods: one quad per tree from the season's sheet, standing on its foot and reclined by half the camera's
// pitch toward the eye (as the generals are), stretched back to the painted proportions. Normals point up, so
// a crown takes the light and the cast shadows the ground beside it takes. trees: [{ x, z, h, size (crown
// width, cells), pine, shade (light, 1 on the board) }].
export function plantWoods(scene, G, trees, pitch, seed = 1) {
  const { rects, w: AW, h: AH } = G.sheet;
  const broad = rects.filter((r) => r[4] === 'broad'), pines = rects.filter((r) => r[4] === 'pine'), bloom = rects.filter((r) => r[4] === 'bloom');
  const ref = Math.max(...broad.concat(bloom).map((r) => r[2])); // the widest crown is `size` wide
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Array(4).fill([0, 1, 0]).flat(), 3));
  const rect = new Float32Array(trees.length * 4);
  const map = new THREE.Texture(G.atlas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; map.needsUpdate = true;
  // Each crown turns on its own foot to face the eye (aim.yaw, the camera's yaw) and leans back by half the pitch (aim.tilt), so
  // the wood reads from every corner and from straight above; the quad itself stays upright and unscaled in height, and the lean
  // is a shear of its offset from the foot (the same as tilting it and stretching it by 1 / cos). Its normal leans with it.
  const aim = { yaw: { value: 0 }, tilt: { value: pitch / 2 } };
  const patch = (s) => {
    Object.assign(s.uniforms, { uYaw: aim.yaw, uTilt: aim.tilt });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aRect; uniform float uYaw; uniform float uTilt;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = aRect.xy + uv * aRect.zw;\n#endif')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { vec3 n = vec3(0., cos(uTilt), -sin(uTilt)); objectNormal = vec3(cos(uYaw) * n.x + sin(uYaw) * n.z, n.y, -sin(uYaw) * n.x + cos(uYaw) * n.z); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz); // the instance is a translation and a scale (z 1)
          vec3 d = vec3(transformed.x * sx, transformed.y * sy, transformed.z); d.z -= d.y * tan(uTilt);
          d = vec3(cos(uYaw) * d.x + sin(uYaw) * d.z, d.y, -sin(uYaw) * d.x + cos(uYaw) * d.z);
          transformed = vec3(d.x / sx, d.y / sy, d.z); }`); // done in the vertex's own space, so the see-through patch still finds project_vertex
  };
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 1, metalness: 0 }); // front side only: a back face would light with its normal flipped
  mat.onBeforeCompile = patch; mat.customProgramCacheKey = () => 'woods';
  const depth = new THREE.MeshDepthMaterial({ map, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = patch; depth.customProgramCacheKey = () => 'woods-depth';
  // Back to front, so the alpha-tested edges of a nearer crown always sit over the one behind.
  const list = [...trees].sort((a, b) => a.z - b.z);
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  im.customDepthMaterial = depth;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  let k = seed >>> 0;
  const rnd = () => ((k = (k * 1664525 + 1013904223) >>> 0) / 4294967296);
  list.forEach((t, i) => {
    // A blossoming crown is the odd one in a spring wood (the calm board: the generals stay the colour).
    const set = t.pine ? pines : bloom.length && rnd() < 0.08 ? bloom : broad, [rx, ry, rw, rh] = set[Math.floor(rnd() * set.length)];
    const wide = (t.size * rw) / ref;
    im.setMatrixAt(i, m4.compose(v.set(t.x, t.h - 0.04, t.z), q, s.set(wide, (wide * rh) / rw, 1)));
    // Half the trees mirrored, in the texture coordinates (a mirrored quad would face away).
    rect.set(rnd() < 0.5 ? [rx / AW, 1 - (ry + rh) / AH, rw / AW, rh / AH] : [(rx + rw) / AW, 1 - (ry + rh) / AH, -rw / AW, rh / AH], i * 4);
    im.setColorAt(i, c.setScalar(t.shade ?? 1));
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  // The crowns are painted lit and shaded already: they cast onto the ground but take no shadow (a wood would
  // darken itself into a black mass).
  im.castShadow = true; im.receiveShadow = false; im.userData.noSeason = true; im.userData.woods = true; im.userData.aim = aim;
  im.frustumCulled = false; // instances spread over the whole country; the mesh's own sphere is a single quad
  scene.add(im);
  return im;
}
