// 战略地图 as the war-room sand table (direction B, docs/review-assets/2026-10-30/strategy-style/B.png), baked in
// Blender by tools/blender_sandtable.py --bake into assets/ai/sandtable/board/. Plan 1: only the light is baked —
// the lamp with every piece's shadow and bounce, and the sky — under white light; the month's lamp and sky colour,
// its vegetation tint, snow, rain and cloud shadows, and the owners' tint are laid over it here, live. The Tripo
// set pieces stand as instances where Blender put them, lit by the scene but casting nothing (their shadows are in
// the bake). Same interface as worldmap.js buildWorld (heightAt, ground, tint, update), plus the cities' model
// seats and the road courses as drawn. ?board=proc keeps the procedural board.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { U, SEASON_GLSL, SAND_REF, seasonalPiece, seasonalWater } from './seasons.js';
import { NONE } from './core/game.js';
import { townSeat } from './packgeo.js';
import { toX, toZ } from './worldmap.js';
import { easeSeams } from './regionseam.js';

const DIR = 'assets/ai/sandtable/board';
const STAGED_DIR = 'assets/ai/sandtable/source/ranges-board'; // ?board=staged: review the mountain side bake before installation
// Pieces the board lists and the game leaves out: its bridges stood where the baked roads crossed a river, and no road is drawn
// on the ground since 2026-11-21 (strategyroads.js), so a bridge would join nothing.
const UNSEEN = new Set(['bridge']);
const SEASONED = { 'tree-broad': 'broad', grove: 'broad', 'tree-pine': 'pine' };
const RANGE_PIECES = new Set(['range-a', 'range-b']); // their painted trees recolour, but they are not tree instances or tree LODs
const RANGE_TILES = 3; // fewer, longer range tiles offset the extra variant's draw calls; tree culling stays at 6×6
const TIER = { capital: 'city-capital', major: 'city-major', county: 'city-county', pass: 'pass' };
// A pack town's model in another building style (core/pack.js STYLES, docs/城池风格模型_方案_2026-11-22.md): <tier kind>-<style>,
// made the size and weight of the Han tier by tools/blender_city_styles.py. Only these are on the server; a style's tier not
// made yet (the Korean major city: its reference picture is redrawn, its model not yet made) stands as the Han model, as does one that fails to load.
const STYLED = new Set(['city-capital-japan', 'city-major-japan', 'city-county-japan', 'pass-japan', 'city-capital-korea', 'city-county-korea', 'pass-korea']);
const styledKind = (tier, style) => (style && style !== 'han' ? `${TIER[tier]}-${style}` : null);
const baseKind = (kind) => kind.replace(/-(japan|korea)$/, '');
// The Tripo towns' stone a little lighter, as the mock-up's pale walls (the review renders' value lift).
const LIFT = { 'city-capital': 1.3, 'city-major': 1.3, 'city-county': 1.3, pass: 1.3, hamlet: 1.3, bridge: 1.1, grove: 1.3, 'tree-broad': 1.15, 'tree-pine': 0.88 };
const TREE_TINT = { 'tree-pine': [0.86, 1, 0.92] }; // pines have no leaf-colour test; broadleaf cooling uses the seasonal reference
const TREE_VALUE = [0.9, 1.3]; // subtle per-instance variation, with no extra draw or per-frame work
export const TREE_ISOLATED_RADIUS = 0.5, TREE_ISOLATED_MAX_NEIGHBORS = 0; // only trees with no close neighbour; a grove is a stand by itself
const TREE_FAR_FOOTPRINT_PAD = { 'tree-broad': [1.07, 1.02], 'tree-pine': [1.02, 1.02], grove: [1.02, 1] }; // offset decimation's lost silhouette, bounded by SIZE
// Zoom removes small competing detail, while leaving enough of each hamlet to explain its baked shadow.
const DETAIL_ZOOM = [18, 55], HAMLET_FAR_OPACITY = 0.55, SEA_CREST_FADE = 0.7;
// The sea: calm deep navy offshore, teal over a wide shelf, few pale crests (target picture of 2026-11-13).
const SEA_DEEP = [0.006, 0.034, 0.105], SEA_MID = [0.014, 0.08, 0.2], SEA_SHALLOW = [0.03, 0.2, 0.26];
const SEA_SHELF_BIAS = 5.5, SEA_SHELF = [0.05, 0.75], SEA_SHELF_TINT = 0.45, SEA_GRAIN = 0.3, SEA_CREST = 0.12;
// Wash colours keep the flags' identities in snow and ochre fields; the wash changes chroma, not the painted texture.
export const TERRITORY_PALETTE = ['#5a5a66', '#d12d3e', '#7a4ad0', '#ff7a1a', '#3f8f4f', '#c060a0', '#2f9fb0'];
// A pack's house (8 and up) washes in its own land colour; a slot with no house stays grey so no seam can read as black.
export const territoryHex = (f, factions) => TERRITORY_PALETTE[f] ?? factions?.[f]?.colors?.land ?? '#8a8a8a';
export const TERRITORY_FILL = [0.008, 0.5], TERRITORY_RIM_FILL = 0.2, TERRITORY_BAND_WORLD = [0.35, 4.5];
export const TERRITORY_MID_BOOST = 0.08; // more chroma between the accepted near and far looks, without changing either end
export const TERRITORY_BORDER_HALF_PX = 1.35, TERRITORY_NEUTRAL_BORDER = 0.55, TERRITORY_FOCUS_SCALE = 0.7;
const TERRITORY_ZOOM = [10, 45.6], TERRITORY_WARP = 0.48, TERRITORY_WARP_FINE = 0.4, TERRITORY_BORDER_NOISE = 0.045;
const TERRITORY_WARP_X = [0.47, 0.13, 0.88, 0.26], TERRITORY_WARP_Z = [0.43, 0.15, 0.8, 0.31], TERRITORY_BORDER_WAVE = [0.63, 0.31, 0.71, 0.21, 0.5];
const TERRITORY_BORDER_OPACITY = 0.85, TERRITORY_BORDER_MINE = 1.15, TERRITORY_BORDER_BRIGHT = 0.9, TERRITORY_CORE_FEATHER = [0.6, 1.4];
const TERRITORY_GLOW_OPACITY = 0.3, TERRITORY_GLOW_PX = 16, TERRITORY_GLOW_EXPONENT = 1.5;
const TERRITORY_OWNER_EDGE = [0.5, 0.55], TERRITORY_GAMUT_CEILING = 1, TERRITORY_DISTANCE_MAX = 32, TERRITORY_BORDER_GATE = [2, 8];
const TERRITORY_ROAD_MASK_MIN = 128 / 255; // matches ROAD_MASK_MIN_ALPHA in the bake; nonzero alpha preserves mask RGB on roads
const TERRITORY_SMOOTH_WEIGHTS = [1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1], TERRITORY_SMOOTH_TOTAL = 4096; // round grid corners before the fragment-level line
const TERRITORY_NEUTRAL_EDGE = [0.6, 0.95], TERRITORY_MINE_EDGE = [0.12, 0.38];

// A gentle world-space warp bends the Voronoi seams; it is fixed for the board and the flat-map projection. The index in `cities` ({x, z})
// of the city a point of the board belongs to (the 2D map gives a pack's towns their land by the same rule).
export function nearestSeat(x, z, cities) {
  const wx = x + TERRITORY_WARP * (Math.sin(z * TERRITORY_WARP_X[0] + x * TERRITORY_WARP_X[1]) + TERRITORY_WARP_FINE * Math.sin(z * TERRITORY_WARP_X[2] - x * TERRITORY_WARP_X[3]));
  const wz = z + TERRITORY_WARP * (Math.sin(x * TERRITORY_WARP_Z[0] - z * TERRITORY_WARP_Z[1]) + TERRITORY_WARP_FINE * Math.sin(x * TERRITORY_WARP_Z[2] + z * TERRITORY_WARP_Z[3]));
  let best = 0, bd = Infinity;
  for (let ci = 0; ci < cities.length; ci++) { const c = cities[ci], q = (wx - c.x) ** 2 + (wz - c.z) ** 2; if (q < bd) { bd = q; best = ci; } }
  return best;
}

// regions: the official extension regions a data pack names (data.pack.regions, design §5.5), each its own board in
// assets/ai/sandtable/regions/<name>/ drawn with this board's piece models; none, as without a pack, fetches nothing there.
// towns: a pack's added cities ({ tier, style }); the styled models they use are fetched with the rest, nothing more without a pack.
export async function loadSandtable(regions = [], towns = []) {
  const board = new URLSearchParams(location.search).get('board');
  if (board != null && board !== 'sand' && board !== 'staged') return null;
  const dir = board === 'staged' ? STAGED_DIR : DIR;
  try {
    const meta = await (await fetch(`${dir}/board.json`)).json();
    const tex = (f, srgb, from = dir) => new THREE.TextureLoader().loadAsync(`${from}/${f}`).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t;
    });
    const loader = new GLTFLoader();
    const styled = towns.map((c) => styledKind(c.tier, c.style)).filter((k) => k && STYLED.has(k));
    const kinds = [...new Set([...Object.keys(meta.pieces).filter((k) => !UNSEEN.has(k)), 'city-capital', 'city-major', 'city-county', 'pass', ...styled])];
    const farKinds = (meta.far ?? []).filter((k) => meta.pieces[k]?.length); // no LOD download for a piece absent from this board
    const model = (f) => loader.loadAsync(`${dir}/models/${f}.glb`).then((g) => g.scene).catch(() => null);
    const [albedo, light, mask, sea, frame, height, ...models] = await Promise.all([
      tex('albedo.webp', true), tex('light.webp'), tex('mask.png'), tex('sea.png'), tex('frame.jpg', true),
      fetch(`${dir}/height.bin`).then((r) => r.arrayBuffer()),
      ...kinds.map(model), ...farKinds.map((k) => model(`${k}-far`)),
    ]);
    const S = { dir, meta, albedo, light, mask, sea, frame, height: new Uint16Array(height), models: Object.fromEntries(kinds.map((k, i) => [k, models[i]])),
      farModels: Object.fromEntries(farKinds.map((k, i) => [k, models[kinds.length + i]])) };
    // A region that fails to load is left out loudly, not the whole baked board: its towns then stand on the open sea.
    if (regions.length) S.regions = (await Promise.all(regions.map((name) => loadRegion(name, S, tex).catch((e) => { console.error(`extension region ${name} not loaded`, e); return null; })))).filter(Boolean);
    return S;
  } catch (e) {
    console.warn('sand table not loaded, procedural board instead', e);
    return null;
  }
}

// A region's board: its own ground, light, vegetation, sea and heights, the original's piece models (kinds it does not use are skipped).
async function loadRegion(name, S, texOf) {
  const dir = `assets/ai/sandtable/regions/${name}`, meta = await (await fetch(`${dir}/board.json`)).json();
  const tex = (f, srgb) => texOf(f, srgb, dir);
  const [albedo, light, mask, sea, height] = await Promise.all([tex('albedo.webp', true), tex('light.webp'), tex('mask.png'), tex('sea.png'),
    fetch(`${dir}/height.bin`).then((r) => r.arrayBuffer())]);
  return { name, meta, albedo, light, mask, sea, frame: S.frame, height: new Uint16Array(height), models: S.models, farModels: S.farModels };
}

// The meshes of a piece kind with their materials, made seasonal once.
function partsOf(root, kind) {
  const out = [];
  root?.updateMatrixWorld(true);
  root?.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const mat = seasonalPiece(o.material, SEASONED[kind] ?? (RANGE_PIECES.has(kind) ? 'range' : 'rock'));
    mat.color.multiplyScalar(LIFT[kind] ?? LIFT[baseKind(kind)] ?? 1);
    if (TREE_TINT[kind]) mat.color.multiply(new THREE.Color().setRGB(...TREE_TINT[kind]));
    out.push({ geo: g, mat });
  });
  return out;
}

// opts.cities: the game's city list; any past the bake's (a data pack's, docs/战略地图数据包扩展设计_2026-11-17.md) stand at their
// seat with the tier's model, and the small pieces under their walls are lifted. opts.factions: more than eight houses take
// a fourth owner bit in the territory field (owner 7 stays the unowned side). Without a pack both are as before.
// With extension regions (sandregions.js) each board is built by this: opts.owns(city) says which towns stand on it (the
// others stay in its list, at their seat, for the territory rule), and opts.frame false leaves the frame and table to the
// joint outline; opts.seat(city) gives a town on another board its seat there, opts.light the shared light uniforms. Without regions
// none is given.
export function buildSandtable(scene, S, opts = {}) {
  const { meta } = S, [X0, X1, Z0, Z1] = meta.box, [GW, GH] = meta.grid, SEA_Y = meta.sea;
  const N = GW * GH, [dx, dz] = meta.step;
  const smoothN = TERRITORY_SMOOTH_WEIGHTS.length, smoothMid = (smoothN - 1) / 2;
  let smoothX, smoothY; // the border grid is only needed if the player asks to see territory
  const uDetailFade = { value: 0 }; // bakeView disables the live-only sea and hamlet fade
  const uTerritory = { value: new THREE.Vector4() };
  const HI = (opts.factions?.length ?? 0) > 8, SLOTS = HI ? 16 : 8;
  const territoryColors = new Float32Array(SLOTS * 3); TERRITORY_PALETTE.forEach((c, i) => new THREE.Color(c).toArray(territoryColors, i * 3));
  for (let f = 8; f < SLOTS; f++) new THREE.Color(territoryHex(f, opts.factions)).toArray(territoryColors, f * 3);
  const uTerritoryColors = { value: territoryColors }; // already flat, so uniform upload needs no per-frame colour-array conversion
  let detailDist = NaN, detailEnabled = true, detailLastEnabled = true, territoryEnabled = false, territoryFocus = false, detailFocus = false, detailDpr = 0;
  // height.bin: the sculpted heights, then the game's own (snow), each 16-bit over its range; row 0 is the north.
  const H = new Float32Array(N), H0 = new Float32Array(N);
  for (let i = 0; i < N; i++) { H[i] = meta.h[0] + S.height[i] / 65535 * (meta.h[1] - meta.h[0]); H0[i] = meta.h0[0] + S.height[N + i] / 65535 * (meta.h0[1] - meta.h0[0]); }
  // An extension board flush against others (sandregions.js opts.seams): its heights ease in from the west neighbour's last column
  // and the south neighbour's first row (regionseam.js easeSeams, shared with the 2D map and the pack check).
  if (opts.seams) easeSeams(H, meta, opts.seams);
  const at = (k, j) => H[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, k))];
  const heightAt = (x, z) => {
    const fk = (x - X0) / dx, fj = (z - Z0) / dz, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    return (at(k, j) * (1 - a) + at(k + 1, j) * a) * (1 - b) + (at(k, j + 1) * (1 - a) + at(k + 1, j + 1) * a) * b;
  };
  // The mesh uses two planar triangles, not heightAt's bilinear patch; a fine road must sit on the visible surface.
  const surfaceAt = (x, z) => {
    const fk = (x - X0) / dx, fj = (z - Z0) / dz, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    return a + b <= 1 ? at(k, j) * (1 - a - b) + at(k + 1, j) * a + at(k, j + 1) * b
      : at(k + 1, j + 1) * (a + b - 1) + at(k, j + 1) * (1 - a) + at(k + 1, j) * (1 - b);
  };

  // ---- Ground ----
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), ownerTint = new Float32Array(N * 4), borders = new Float32Array(N * 4), borderInfo = new Float32Array(N * 4), borderSmooth = new Float32Array(N * 3), bordersHi = HI ? new Float32Array(N) : null, smoothHi = HI ? new Float32Array(N) : null, idx = new Uint32Array((GW - 1) * (GH - 1) * 6);
  for (let j = 0; j < GH; j++) for (let k = 0; k < GW; k++) {
    const i = j * GW + k, x = X0 + k * dx, z = Z0 + j * dz;
    pos[i * 3] = x; pos[i * 3 + 1] = H[i]; pos[i * 3 + 2] = z;
    uv[i * 2] = (x - X0) / (X1 - X0); uv[i * 2 + 1] = 1 - (z - Z0) / (Z1 - Z0);
  }
  // Its first column (at that board's heights already) moves onto the west board's last grid column, so no crack opens where one
  // board's grid stops short of its box; its last row onto the south board's first.
  if (opts.seams?.west) for (let j = 0; j < GH; j++) pos[j * GW * 3] = opts.seams.west.x;
  if (opts.seams?.south) for (let k = 0; k < GW; k++) pos[((GH - 1) * GW + k) * 3 + 2] = opts.seams.south.z;
  let n = 0;
  for (let j = 0; j < GH - 1; j++) for (let k = 0; k < GW - 1; k++) { const a = j * GW + k, b = a + 1, c = a + GW, e = c + 1; idx.set([a, c, b, b, c, e], n); n += 6; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('territory', new THREE.BufferAttribute(ownerTint, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('territoryBorder', new THREE.BufferAttribute(borders, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('territoryDistance', new THREE.BufferAttribute(borderInfo, 4).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('h0', new THREE.BufferAttribute(H0, 1));
  if (HI) geo.setAttribute('territoryBorderHi', new THREE.BufferAttribute(bordersHi, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  // Unlit but for the bake: albedo × (lamp × baked lamp light + sky × baked sky light). strategy.js feeds the
  // month's lamp and sky (lightUniforms) so the board answers the same light as the pieces on it.
  // An extension board shares the main one's lamp, sky and woods floor (opts.light), so strategysky's month reaches every board.
  const { uSun, uSky, uWoodsFloor } = opts.light ?? { uSun: { value: new THREE.Color(1, 1, 1) }, uSky: { value: new THREE.Color(0.3, 0.3, 0.3) }, uWoodsFloor: { value: new THREE.Color(0, 0, 0) } };
  const groundMat = new THREE.MeshBasicMaterial({ map: S.albedo });
  groundMat.customProgramCacheKey = () => (HI ? 'sandGroundHi' : 'sandGround');
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { uLatFix: { value: 0 }, uSnowH: { value: 2.6 }, uPatch: { value: 1.6 }, uSnowMax: { value: 1 } },
      { uLight: { value: S.light }, uMask: { value: S.mask }, uSun, uSky, uWoodsFloor, uTerritory, uTerritoryColors, uRefG: { value: SAND_REF.grass }, uRefF: { value: SAND_REF.forest }, uRefM: { value: SAND_REF.farm } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute float h0; attribute vec4 territory, territoryBorder, territoryDistance; varying float vH0; varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vTerritory, vTerritoryBorder, vTerritoryDistance;${HI ? ' attribute float territoryBorderHi; varying float vTerritoryBorderHi;' : ''}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\nvH0 = h0; vWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal); vTerritory = territory; vTerritoryBorder = territoryBorder; vTerritoryDistance = territoryDistance;${HI ? ' vTerritoryBorderHi = territoryBorderHi;' : ''}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uGrass[5], uForest[5], uFarm[5], uLeaf[5], uCrimson[5];
      ${SEASON_GLSL}
      uniform sampler2D uLight, uMask; uniform vec3 uSun, uSky, uRefG, uRefF, uRefM, uWoodsFloor, uTerritoryColors[${SLOTS}]; uniform vec4 uTerritory;
      varying float vH0; varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vTerritory, vTerritoryBorder, vTerritoryDistance;${HI ? ' varying float vTerritoryBorderHi;' : ''}`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 c = texture2D(map, vMapUv).rgb;
        vec3 wn = normalize(vWNrm);
        // The month's vegetation: grass, woods and fields tinted by their ramps' move from 季春 (autumn woods in
        // patches of amber and crimson with evergreen stands, the far south green through the winter).
        vec4 msk = texture2D(uMask, vMapUv);
        float roadFill = max((msk.a - ${TERRITORY_ROAD_MASK_MIN.toFixed(6)}) / ${(1 - TERRITORY_ROAD_MASK_MIN).toFixed(6)}, 0.); // RGB masks sample alpha 1
        float vw = msk.r + msk.g + msk.b;
        if (vw > .02) {
          float sth = s_south(vWPos) * uSouth, woods = s_noise(vWPos.xz * uPatch);
          vec3 gn = mix(s_ramp(uGrass, .5), s_ramp(uSouthG, .5), sth), g = sqrt(gn / uRefG);
          // Under the woods the ground goes to ochre leaf litter in autumn (the colour is in the trees standing on it).
          vec3 f = mix(s_ramp(uForest, .5), s_ramp(uGrass, .45) * .8, uAutumn * .7);
          vec3 fn = mix(f, s_ramp(uSouthF, .5), sth); f = sqrt(fn / uRefF);
          vec3 fm = s_ramp(uFarm, .5);
          vec3 k = (g * msk.r + f * msk.g + sqrt(fm / uRefM) * msk.b) / vw;
          // Far from 季春 (autumn gold, winter fallow) the hue follows the month's own colour at the texel's brightness.
          vec3 now = (gn * msk.r + fn * msk.g + fm * msk.b) / vw, ref = (uRefG * msk.r + uRefF * msk.g + uRefM * msk.b) / vw;
          float lr = dot(ref, vec3(.2126, .7152, .0722)), away = clamp(length(now - ref) * 3., 0., .6);
          vec3 tinted = mix(c * clamp(k, .55, 1.6), dot(c, vec3(.2126, .7152, .0722)) / lr * now, away);
          // Fields go all the way: golden at harvest, fallow brown in winter, never the red of a tinted plot.
          float fa = clamp(length(fm - uRefM) * 5., 0., .95);
          // Each plot keeps something of its own hue, so the fields stay a patchwork in any month.
          float lc = dot(c, vec3(.2126, .7152, .0722));
          vec3 plot = mix(vec3(1.), c / max(lc, .04), .22);
          tinted = mix(tinted, lc / dot(uRefM, vec3(.2126, .7152, .0722)) * fm * plot, fa * msk.b / vw);
          c = mix(c, tinted, clamp(vw, 0., roadFill)); // earth roads are not grass or fields in any season
        }
        // Snow by the game's rule on the game's own height (h0): thick up high, drifts on the plains.
        float lum = dot(c, vec3(.2126, .7152, .0722));
        float p = s_noise(vWPos.xz * 14.) * .5 + s_noise(vWPos.xz * 31.) * .3 + s_noise(vWPos.xz * 70.) * .2;
        float drift = s_noise(vWPos.xz * 1.4) * .7 + s_noise(vWPos.xz * 4.) * .3;
        float cover = s_snow(vec3(vWPos.x, vH0, vWPos.z), s_noise(vWPos.xz * 1.2)) * smoothstep(.3, .65, wn.y);
        cover *= mix(smoothstep(.3, .7, drift + .1), 1., smoothstep(.6, 1.3, vH0));
        c = mix(c, mix(vec3(.5, .56, .66), vec3(.86, .87, .9), smoothstep(.3, .7, p)), smoothstep(.3, .6, cover * (.7 + p * .6)));
        c = max(mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, 1.45), 0.); // the review renders' fuller colour
        c *= 1. - uWet * .16;
        // The 2D map's pictures only: winter's tint turns some ground and road texels magenta (red and blue both over green); bring those back to earth.
        if (uWoodsFloor.g > 0.) c = mix(c, vec3(dot(c, vec3(.2126, .7152, .0722))) * vec3(1.1, .98, .74), smoothstep(.92, 1.15, c.b / max(c.g, .001)) * smoothstep(1.05, 1.4, c.r / max(c.g, .001)));
        // Baked light (stored as √(L/2)); the drifting cloud shadows dim the lamp's share.
        vec2 L = texture2D(uLight, vMapUv).rg; L = L * L * 2.;
        float cs = smoothstep(.5, .74, s_noise(vWPos.xz * .07 + vec2(uTime * .018, uTime * .007)) * .65 + s_noise(vWPos.xz * .19 + vec2(uTime * .03, 0.)) * .35);
        diffuseColor.rgb *= c * (uSun * L.r * (1. - uCloud * .6 * cs) + uSky * L.g);
        diffuseColor.rgb = max(diffuseColor.rgb, min(dot(c, vec3(.2126, .7152, .0722)), .25) * uWoodsFloor * msk.g * (1. - smoothstep(.1, .4, cover))); // zero in play; the 2D map's pictures fill the woods' floor (strategy.js bakeView)
        // The uniform branch skips the whole overlay when off; derivatives still run before the divergent coast branch.
        if (uTerritory.x > 0.) {
          vec3 territoryRate = fwidth(vTerritoryBorder.xyz);${HI ? ' float territoryRateHi = fwidth(vTerritoryBorderHi);' : ''}
          // Change hue at the texel's own luminance, retaining the texture and keeping snow bright; the sea has no ownership.
          if (vWPos.y >= ${SEA_Y.toFixed(6)}) {
          vec3 luma = vec3(.2126, .7152, .0722), base = diffuseColor.rgb;
          // Use the same bent contour for fill ownership and the line, including the neutral side.
          float bend = (sin(vWPos.x * ${TERRITORY_BORDER_WAVE[0]} + sin(vWPos.z * ${TERRITORY_BORDER_WAVE[1]})) + sin(vWPos.z * ${TERRITORY_BORDER_WAVE[2]} - vWPos.x * ${TERRITORY_BORDER_WAVE[3]}) * ${TERRITORY_BORDER_WAVE[4]}) * ${TERRITORY_BORDER_NOISE.toFixed(3)};
          vec3 side = vTerritoryBorder.xyz + bend;
          int owner = int(step(0., side.x)) + 2 * int(step(0., side.y)) + 4 * int(step(0., side.z));${HI ? ' float sideHi = vTerritoryBorderHi + bend; owner += 8 * int(step(0., sideHi));' : ''}
          if (vTerritory.a > .001 && owner != 7) { // a blurred owner attribute must not colour the unowned side
            vec3 hue = vTerritory.rgb / vTerritory.a;
            float owned = smoothstep(${TERRITORY_OWNER_EDGE[0].toFixed(2)}, ${TERRITORY_OWNER_EDGE[1].toFixed(2)}, vTerritory.a);
            // A grey owner must desaturate green grass too; keep every texel's luminance while shifting its chroma.
            vec3 ownerAtValue = dot(base, luma) * hue / max(dot(hue, luma), .02);
            float rim = exp(-vTerritoryDistance.x / max(uTerritory.w, .001));
            float strength = (uTerritory.x + rim * ${TERRITORY_RIM_FILL.toFixed(3)} * uTerritory.z) * owned * roadFill;
            vec3 tinted = mix(base, ownerAtValue, strength);
            vec3 delta = tinted * (dot(base, luma) / max(dot(tinted, luma), .0001)) - base;
            // Fit the chroma into the available range before output clamping can darken white snow.
            vec3 lower = base / max(-delta, vec3(.00001));
            vec3 upper = (max(vec3(${TERRITORY_GAMUT_CEILING.toFixed(3)}), base) - base) / max(delta, vec3(.00001));
            vec3 limits = mix(lower, upper, step(vec3(0.), delta));
            limits = mix(vec3(1.), limits, step(vec3(.00001), abs(delta)));
            diffuseColor.rgb = base + delta * clamp(min(min(limits.r, limits.g), limits.b), 0., 1.);
          }
          // Signed distances per owner bit cross zero only where that bit changes. The smooth perturbation
          // hides the grid at close range; derivatives keep the luminous line a few CSS pixels wide.
          vec3 pixels = abs(side) / max(territoryRate * uTerritory.y, vec3(.00001));
          float distPx = min(min(pixels.x, pixels.y), pixels.z);${HI ? ' distPx = min(distPx, abs(sideHi) / max(territoryRateHi * uTerritory.y, .00001));' : ''}
          float gate = 1. - smoothstep(${(Math.max(dx, dz) * TERRITORY_BORDER_GATE[0]).toFixed(4)}, ${(Math.max(dx, dz) * TERRITORY_BORDER_GATE[1]).toFixed(4)}, vTerritoryDistance.x);
          float edge = (1. - smoothstep(${(TERRITORY_BORDER_HALF_PX * TERRITORY_CORE_FEATHER[0]).toFixed(3)}, ${(TERRITORY_BORDER_HALF_PX * TERRITORY_CORE_FEATHER[1]).toFixed(3)}, distPx)) * gate;
          float weight = mix(${TERRITORY_NEUTRAL_BORDER.toFixed(3)}, 1., smoothstep(${TERRITORY_NEUTRAL_EDGE[0].toFixed(2)}, ${TERRITORY_NEUTRAL_EDGE[1].toFixed(2)}, vTerritory.a));
          float mine = smoothstep(${TERRITORY_MINE_EDGE[0].toFixed(2)}, ${TERRITORY_MINE_EDGE[1].toFixed(2)}, vTerritoryBorder.w);
          vec3 lineHue = owner == 7 ? vTerritoryDistance.yzw : uTerritoryColors[owner];
          lineHue /= max(max(max(lineHue.r, lineHue.g), lineHue.b), .001);
          float glow = pow(max(0., 1. - distPx / ${TERRITORY_GLOW_PX.toFixed(3)}), ${TERRITORY_GLOW_EXPONENT.toFixed(1)}) * ${TERRITORY_GLOW_OPACITY.toFixed(3)} * gate;
          float emphasis = weight * mix(1., ${TERRITORY_BORDER_MINE.toFixed(3)}, mine) * uTerritory.z;
          diffuseColor.rgb += lineHue * glow * emphasis;
          diffuseColor.rgb = mix(diffuseColor.rgb, lineHue * ${TERRITORY_BORDER_BRIGHT.toFixed(3)}, clamp(edge * ${TERRITORY_BORDER_OPACITY.toFixed(3)} * emphasis, 0., 1.));
          }
        }`);
  };
  const ground = new THREE.Mesh(geo, groundMat);
  ground.userData.mask = S.mask; scene.add(ground);

  // ---- Water: varnished painted blue; the sea greener over the shallows (the ground under it shows through as
  // depth), rivers deep in the channel and pale at the banks, streaks running with the flow ----
  const flowing = [];
  // 'gap': the open sea between this board and another (seaPatch), its shallows map blended from this board's to the other's
  // (`other`) across the strait, so neither board's edge shows as a step in the sea's colour.
  // opts.shelf (sandregions.js, with extension regions): the boards' shallows maps joined in one picture over the joint box `box`,
  // a quarter of their size. The sea's depth reads its coarse mip levels from that (two levels fewer, the picture being halved twice), so
  // they run on across a board's edge; without regions each board's own map, as before.
  const shelf = opts.shelf;
  const waterMat = (kind, other) => {
    const gap = kind === 'gap'; if (gap) kind = 'sea';
    const joint = !!shelf && kind === 'sea';
    const fetch = (b) => (gap ? `mix(texture2D(uSeaMap, vRU${b}), texture2D(uSeaMap2, vRU2${b}), vGW)` : `texture2D(uSeaMap, vRU${b})`);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0, transparent: true, depthWrite: false });
    const uTimeW = { value: 0 }; flowing.push(uTimeW);
    m.customProgramCacheKey = () => `sandWater${kind}${gap ? 'gap' : ''}${joint ? 'joint' : ''}`;
    if (kind === 'sea') m.userData.shelf = joint ? 'joint' : 'own';
    if (joint) m.userData.shelfMap = shelf.map.uuid;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTimeW = uTimeW; sh.uniforms.uSeaMap = { value: S.sea }; sh.uniforms.uDetailFade = uDetailFade;
      if (gap) sh.uniforms.uSeaMap2 = { value: other };
      if (joint) { sh.uniforms.uShelfMap = { value: shelf.map }; sh.uniforms.uShelfBox = { value: new THREE.Vector4(...shelf.box) }; }
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 ruv; varying vec3 vWW; varying vec2 vRU;' + (gap ? ' attribute vec2 ruv2; attribute float gw; varying vec2 vRU2; varying float vGW;' : ''))
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.)).xyz; vRU = ruv;' + (gap ? ' vRU2 = ruv2; vGW = gw;' : ''));
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTimeW, uDetailFade; uniform sampler2D uSeaMap; varying vec3 vWW; varying vec2 vRU;${gap ? ' uniform sampler2D uSeaMap2; varying vec2 vRU2; varying float vGW;' : ''}${joint ? ' uniform sampler2D uShelfMap; uniform vec4 uShelfBox;' : ''}
        float w_h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(w_h(i), w_h(i + vec2(1, 0)), f.x), mix(w_h(i + vec2(0, 1)), w_h(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `
        {
          vec2 p = vWW.xz;
          float n = w_n(p * vec2(7., 2.7) + vec2(uTimeW * .05, 0.)) * .6 + w_n(p * 17. - vec2(0., uTimeW * .08)) * .4;
          ${kind === 'river' ? `
          float across = 1. - abs(vRU.y * 2. - 1.);
          vec3 c = mix(vec3(.12, .4, .5), vec3(.015, .09, .27), smoothstep(0., .64, across));
          float st = smoothstep(.62, .78, w_n(vec2(vRU.x * 1.5 - uTimeW * .4, vRU.y * 14.)) * .7 + w_n(vec2(vRU.x * 4. - uTimeW * .6, vRU.y * 30.)) * .3);
          c = mix(c, vec3(.7, .8, .85), st * .55 * across);
          diffuseColor.a = smoothstep(0., .18, across) * .95;` : `
          vec3 c = mix(vec3(${kind === 'sea' ? '.012, .07, .2' : '.015, .08, .24'}), vec3(${kind === 'sea' ? '.03, .16, .36' : '.05, .22, .46'}), n);
          ${kind === 'sea' ? `vec3 sm = ${fetch('')}.rgb;
          // Depth: the shore map's coarse mip levels spread its narrow shallows band into a wide run from the coast
          // to open water (one biased fetch, no second texture), so the sea reads calm navy offshore and teal inshore.${joint ? `
          // With regions, from the boards' joint map by world position (north at v = 1, as the texture's flipY and each board's ruv).
          vec2 su = vec2((vWW.x - uShelfBox.x) / (uShelfBox.y - uShelfBox.x), 1. - (vWW.z - uShelfBox.z) / (uShelfBox.w - uShelfBox.z));` : ''}
          float shelf = ${joint ? `texture2D(uShelfMap, su, ${(SEA_SHELF_BIAS - 2).toFixed(1)})` : fetch(`, ${SEA_SHELF_BIAS.toFixed(1)}`)}.r, open = smoothstep(${SEA_SHELF[0].toFixed(2)}, ${SEA_SHELF[1].toFixed(2)}, 1. - shelf);
          c = mix(vec3(${SEA_DEEP.join(', ')}), vec3(${SEA_MID.join(', ')}), n * ${SEA_GRAIN.toFixed(2)} + (1. - open) * ${(1 - SEA_GRAIN).toFixed(2)});
          c = mix(c, vec3(${SEA_SHALLOW.join(', ')}), max(sm.r, (1. - open) * ${SEA_SHELF_TINT.toFixed(2)}));
          c = mix(c, vec3(.42, .5, .5), sm.g * (.75 + .25 * sin(uTimeW * .8 + p.x * 3.)));` : ''}
          diffuseColor.a = .93;`}
          // Wave crests: short pale strokes gathered in bands.
          float cr = smoothstep(.72, .92, w_n(p * vec2(9., 34.) + vec2(uTimeW * .03, 0.))) * smoothstep(.5, .7, w_n(p * .8 + 3.));
          c = mix(c, vec3(.6, .72, .8), cr * (${kind === 'sea' ? `${SEA_CREST.toFixed(2)} * (1. - ${SEA_CREST_FADE.toFixed(2)} * uDetailFade)` : '.4'}));
          diffuseColor.rgb = c * ${kind === 'sea' ? '1.' : kind === 'lake' ? '.5' : '.8'};
        }
        #include <map_fragment>`);
    };
    return kind === 'sea' ? m : seasonalWater(m); // the open sea never freezes over
  };
  const lakeMat = waterMat('lake'), riverMat = waterMat('river'), seaMat = waterMat('sea');
  for (const w of meta.water) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(w.v, 3)); g.setIndex(w.i);
    g.setAttribute('ruv', new THREE.Float32BufferAttribute(w.uv ?? new Array(w.v.length / 3 * 2).fill(0.5), 2));
    // Water lies level whatever slope its ribbon runs down: a normal tilted with the slope mirrors the sun into the
    // camera as a white patch (the 金沙江 on the plateau's edge).
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(w.v.length / 3).fill([0, 1, 0]).flat(), 3));
    // A river's alpha at each pair of points: its source fades in, its mouth fades out over the sea.
    if (w.f) g.setAttribute('color', new THREE.Float32BufferAttribute(w.f.flatMap((a) => [1, 1, 1, a, 1, 1, 1, a]), 4));
    // Blender winding is flipped by its y↔z swap; the game's ribbons face up either way (double-sided).
    const m = new THREE.Mesh(g, w.kind === 'river' ? riverMat : lakeMat); m.position.y = 0.002; m.renderOrder = 1; scene.add(m);
  }
  riverMat.side = lakeMat.side = THREE.DoubleSide; riverMat.vertexColors = true;
  // Sea: only inside the frame; a shallows ramp from the ground's own height under it.
  const seaGeo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0); seaGeo.setAttribute('ruv', seaGeo.attributes.uv);
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set((X0 + X1) / 2, SEA_Y, (Z0 + Z1) / 2); scene.add(sea);


  // ---- Frame: dark lacquered wood carved with gilt cloud scrolls along the top, on a dark table ----
  let table = null;
  if (opts.frame !== false) {
  const FW = 1.5, top = SEA_Y + 0.36, BOT = -2;
  const carve = S.frame; carve.wrapS = carve.wrapT = THREE.RepeatWrapping;
  const lacquer = new THREE.MeshStandardMaterial({ color: '#2a120a', roughness: 0.35, metalness: 0 });
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2, hw = (X1 - X0) / 2, hh = (Z1 - Z0) / 2;
  // Each side is a long box whose top runs the carving along its length, turned so its outer edge faces out.
  for (const [x, z, len, ry] of [[cx, cz - hh - FW / 2, hw * 2 + FW * 2, 0], [cx, cz + hh + FW / 2, hw * 2 + FW * 2, Math.PI], [cx - hw - FW / 2, cz, hh * 2, Math.PI / 2], [cx + hw + FW / 2, cz, hh * 2, -Math.PI / 2]]) {
    const t = carve.clone(); t.repeat.set(len / FW, 1); t.needsUpdate = true;
    const topMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.35 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, top - BOT, FW), [lacquer, lacquer, topMat, lacquer, lacquer, lacquer]);
    box.position.set(x, (top + BOT) / 2, z); box.rotation.y = ry; scene.add(box);
  }
  table = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#1a0c06', roughness: 0.6 }));
  table.rotation.x = -Math.PI / 2; table.position.y = BOT; scene.add(table);
  }

  // ---- Pieces: one instanced mesh per part per kind; trees vary a little in hue and value as in the review ----
  const rnd = (i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), SC = new THREE.Vector3(), C = new THREE.Color();
  // Tiles let the camera cull pieces off screen; long ranges use a coarser grid than the smaller pieces.
  const T = 6, tileOf = (x, z, n) => Math.min(n - 1, Math.max(0, Math.floor((x - X0) / (X1 - X0) * n))) * n + Math.min(n - 1, Math.max(0, Math.floor((z - Z0) / (Z1 - Z0) * n)));
  // Count neighbours once across all tree kinds, before making any tile; no fixed share may cut into a stand.
  const treeBins = new Map(), treeNeighbors = new Map(), trees = [];
  for (const [kind, arr] of Object.entries(meta.pieces)) if (SEASONED[kind]) {
    treeNeighbors.set(kind, new Uint16Array(arr.length / 6));
    for (let i = 0; i < arr.length / 6; i++) {
      const x = arr[i * 6], z = arr[i * 6 + 2], bx = Math.floor(x / TREE_ISOLATED_RADIUS), bz = Math.floor(z / TREE_ISOLATED_RADIUS), tree = { kind, i, x, z, bx, bz }, key = `${bx},${bz}`;
      if (!treeBins.has(key)) treeBins.set(key, []); treeBins.get(key).push(tree); trees.push(tree);
    }
  }
  const radius2 = TREE_ISOLATED_RADIUS ** 2;
  for (const tree of trees) {
    let count = 0;
    for (let x = tree.bx - 1; x <= tree.bx + 1 && count <= TREE_ISOLATED_MAX_NEIGHBORS; x++) for (let z = tree.bz - 1; z <= tree.bz + 1 && count <= TREE_ISOLATED_MAX_NEIGHBORS; z++) {
      const cell = treeBins.get(`${x},${z}`); if (!cell) continue;
      for (const other of cell) if (other !== tree) {
        const d2 = (tree.x - other.x) ** 2 + (tree.z - other.z) ** 2;
        if (d2 <= radius2 && ++count > TREE_ISOLATED_MAX_NEIGHBORS) break;
      }
    }
    treeNeighbors.get(tree.kind)[tree.i] = count;
  }
  // Decimation and smoothing shrink the installed far crowns. Restore their horizontal bounds once,
  // preserving UVs and height, and cap the small silhouette allowance at the model's normalised SIZE.
  const fitFarFootprint = (near, far, kind) => {
    near.computeBoundingBox(); far.computeBoundingBox(); const a = near.boundingBox, b = far.boundingBox, pad = TREE_FAR_FOOTPRINT_PAD[kind], limit = meta.size?.[kind] ?? Infinity;
    const nx = a.max.x - a.min.x, nz = a.max.z - a.min.z, fx = b.max.x - b.min.x, fz = b.max.z - b.min.z;
    if (!nx || !nz || !fx || !fz) return;
    const sx = nx * Math.min(pad[0], Math.max(1, limit / nx)) / fx, sz = nz * Math.min(pad[1], Math.max(1, limit / nz)) / fz;
    const tx = (a.max.x + a.min.x - (b.max.x + b.min.x) * sx) / 2, tz = (a.max.z + a.min.z - (b.max.z + b.min.z) * sz) / 2;
    far.scale(sx, 1, sz); far.translate(tx, 0, tz);
  };
  // A tile nearer the camera than LOD_NEAR draws its full meshes, further than LOD_FAR its light ones (the gap stops it flickering).
  const LOD_NEAR = 15, LOD_FAR = 16.5, lods = [], hamletMats = [];
  // A pack's towns: their seats on the board, and the small pieces their walls would stand in lifted (a tree through a
  // roof). The long ranges and massifs stay; tools/check_pack.mjs warns a pack author off them.
  const extra = (opts.cities ?? []).slice(meta.cities.length).map((c) => {
    if (opts.owns && !opts.owns(c)) { const { x, z } = opts.seat?.(c) ?? { x: toX(c.lon), z: toZ(c.lat) }; return { id: c.id, name: c.name, tier: c.tier, style: c.style, x, z, mx: x, mz: z, y: SEA_Y, ms: 1, mod: true, away: true }; }
    const { x, z, y } = townSeat(c, meta.size, heightAt);
    return { id: c.id, name: c.name, tier: c.tier, style: c.style, x, z, mx: x, mz: z, y, ms: 1, mod: true };
  });
  const STAY = new Set(['range-a', 'range-b', 'massif', 'ridge']);
  const lifted = (kind, x, z) => !STAY.has(kind) && extra.some((c) => !c.away && Math.hypot(x - c.x, z - c.z) < meta.size[TIER[c.tier]] * 0.65 + (meta.size[kind] ?? 0) / 2);
  for (const [kind, arr] of Object.entries(meta.pieces)) {
    if (UNSEEN.has(kind)) continue;
    const parts = partsOf(S.models[kind], kind), tiles = new Map(), grid = RANGE_PIECES.has(kind) ? RANGE_TILES : T;
    if (kind === 'hamlet') for (const { mat } of parts) { mat.transparent = true; hamletMats.push(mat); }
    const farGeos = []; S.farModels?.[kind]?.updateMatrixWorld(true); S.farModels?.[kind]?.traverse((o) => { if (o.isMesh) farGeos.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
    if (SEASONED[kind]) farGeos.forEach((g, i) => { if (parts[i]) fitFarFootprint(parts[i].geo, g, kind); });
    for (let i = 0; i < arr.length / 6; i++) { if (extra.length && lifted(kind, arr[i * 6], arr[i * 6 + 2])) continue; if (opts.seams && kind !== 'boat' && heightAt(arr[i * 6], arr[i * 6 + 2]) < SEA_Y + 0.01) continue; /* in the sea the seam's easing made */ const t = tileOf(arr[i * 6], arr[i * 6 + 2], grid); if (!tiles.has(t)) tiles.set(t, []); tiles.get(t).push(i); }
    for (const [t, ids] of tiles) {
      const neighbors = treeNeighbors.get(kind), keep = (i) => kind === 'grove' || neighbors[i] > TREE_ISOLATED_MAX_NEIGHBORS;
      let kept = ids.length;
      if (neighbors && farGeos.length) { kept = ids.reduce((n, i) => n + Number(keep(i)), 0); ids.sort((a, b) => Number(keep(b)) - Number(keep(a)) || a - b); }
      const near = [], far = [];
      parts.forEach(({ geo: g, mat }, pi) => {
        const im = new THREE.InstancedMesh(g, mat, ids.length);
        ids.forEach((i, n) => {
          const [x, y, z, ry, s, sx] = arr.slice(i * 6, i * 6 + 6);
          im.setMatrixAt(n, M4.compose(P.set(x, y, z), Q.setFromAxisAngle(Y, ry), SC.set(s * sx, s, s)));
          if (SEASONED[kind]) { const v = TREE_VALUE[0] + rnd(i) * (TREE_VALUE[1] - TREE_VALUE[0]); C.setRGB(v * (0.97 + rnd(i + 7) * 0.06), v, v * (0.92 + rnd(i + 3) * 0.08)); im.setColorAt(n, C); }
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere(); im.userData.sandKind = kind; im.userData.sandLod = 'near'; scene.add(im); near.push(im);
        if (farGeos[pi]) {   // the same instances and material on the lighter mesh
          const lo = new THREE.InstancedMesh(farGeos[pi], mat, ids.length);
          lo.instanceMatrix = im.instanceMatrix; lo.instanceColor = im.instanceColor;
          if (neighbors) { // only the isolated suffix disappears; the near mesh still draws every instance
            lo.count = kept; if (lo.count) lo.computeBoundingSphere(); else lo.boundingSphere = im.boundingSphere;
          } else lo.boundingSphere = im.boundingSphere;
          lo.userData.sandKind = kind; lo.userData.sandLod = 'far';
          lo.visible = false; scene.add(lo); far.push(lo);
        }
      });
      if (far.length) {
        const w = (X1 - X0) / grid, d = (Z1 - Z0) / grid, tx = Math.floor(t / grid), tz = t % grid;
        lods.push({ x0: X0 + tx * w, x1: X0 + (tx + 1) * w, z0: Z0 + tz * d, z1: Z0 + (tz + 1) * d, near, far, lo: false });
      }
    }
  }
  const updateLods = (cam) => {
    if (!cam) return;
    const { x, y, z } = cam.position;
    for (const l of lods) {
      const d = Math.hypot(Math.max(l.x0 - x, 0, x - l.x1), y, Math.max(l.z0 - z, 0, z - l.z1)), lo = l.lo ? d > LOD_NEAR : d > LOD_FAR;
      if (lo !== l.lo) { l.lo = lo; for (const m of l.near) m.visible = !lo; for (const m of l.far) m.visible = lo; }
    }
  };

  // Cities: the model seat (the bake moved a few off the water) and each road's course as drawn.
  const cities = [...meta.cities, ...extra].map((c) => ({ ...c, pos: new THREE.Vector3(c.mx, c.y, c.mz) }));
  const roads = new Map(meta.roads.map((r) => [r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`, r]));
  const roadPath = (a, b) => {
    const r = roads.get(a < b ? `${a}-${b}` : `${b}-${a}`); if (!r) return null;
    const pts = []; for (let k = 0; k < r.p.length; k += 3) pts.push(new THREE.Vector3(r.p[k], r.p[k + 1], r.p[k + 2]));
    return r.a === a ? pts : pts.reverse();
  };
  // The model of a tier in a style (none: Han). Footprint and banner pole stay the tier's (meta.size): only the buildings change.
  const tiers = new Map(), cityModel = (tier, style) => {
    let kind = styledKind(tier, style) ?? TIER[tier] ?? tier;
    if (kind !== (TIER[tier] ?? tier) && !S.models[kind]) {
      if (STYLED.has(kind)) console.error(`city model ${kind} not loaded: the Han ${TIER[tier]} instead`);
      kind = TIER[tier] ?? tier;
    }
    if (!tiers.has(kind)) tiers.set(kind, partsOf(S.models[kind], kind));
    return tiers.get(kind);
  };

  const nearestCity = (x, z) => nearestSeat(x, z, cities);
  // Each vertex belongs to the nearest city in the warped board. This geometry never changes when an owner changes.
  let near = null; const gapSea = new Map(); const cityOwner = new Int16Array(cities.length), cityHue = new Array(cities.length);
  return {
    heightAt, surfaceAt, ground, table, cities, roadPath, cityModel, size: meta.size, sea: SEA_Y,
    // For tools/bake_strategy_flat.mjs --towns --style only: every model of a style, as a pack using all its tiers would fetch.
    async loadCityStyle(style) {
      const loader = new GLTFLoader();
      await Promise.all([...STYLED].filter((k) => k.endsWith(`-${style}`) && !S.models[k]).map((k) => loader.loadAsync(`${S.dir}/models/${k}.glb`).then((g) => { S.models[k] = g.scene; })));
    },
    box: meta.box,
    // Open sea between this board and another (sandregions.js; `other` its shallows map and box): each board's shallows map
    // clamped at its edge, blended across the strait by distance to the two edges. A material of its own: the 2D map's bake
    // clips each board's own at the board's edge (strategy.js bakeView).
    seaPatch(x0, x1, z0, z1, other) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.max(1, Math.ceil((x1 - x0) / 0.06)), Math.max(1, Math.ceil((z1 - z0) / 0.06)));
      const uvs = [], uvs2 = [], ws = [], [P0, P1, Q0, Q1] = other.box, cl = (v) => Math.min(1, Math.max(0, v));
      const dist = ([a0, a1, b0, b1], x, z) => Math.hypot(Math.max(a0 - x, 0, x - a1), Math.max(b0 - z, 0, z - b1));
      for (let i = 0; i < g.attributes.position.count; i++) {
        const x = (x0 + x1) / 2 + g.attributes.position.getX(i), z = (z0 + z1) / 2 - g.attributes.position.getY(i);
        uvs.push(cl((x - X0) / (X1 - X0)), cl(1 - (z - Z0) / (Z1 - Z0)));
        uvs2.push(cl((x - P0) / (P1 - P0)), cl(1 - (z - Q0) / (Q1 - Q0)));
        const dm = dist(meta.box, x, z), d2 = dist(other.box, x, z); ws.push(dm + d2 > 0 ? dm / (dm + d2) : 0);
      }
      g.setAttribute('ruv', new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute('ruv2', new THREE.Float32BufferAttribute(uvs2, 2));
      g.setAttribute('gw', new THREE.Float32BufferAttribute(ws, 1));
      if (!gapSea.has(other.sea)) gapSea.set(other.sea, waterMat('gap', other.sea));
      const m = new THREE.Mesh(g, gapSea.get(other.sea)); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, SEA_Y, (z0 + z1) / 2); scene.add(m); return m;
    },
    lightUniforms: { uSun, uSky }, uWoodsFloor,
    disableDetail() { detailEnabled = false; }, // bakeView restores full sea crests and opaque hamlets
    setTerritory(on) { on = !!on; if (on === territoryEnabled) return; territoryEnabled = on; if (!on) uTerritory.value.x = 0; detailDist = NaN; },
    setTerritoryFocus(on) { territoryFocus = !!on; }, // candidate rings and war standards stay above territory ink
    // The tint at any point of the land, for the 2D map's grid (strategy.js bakeView). A vertex's near and strength above are this same rule.
    tintAt(x, z) {
      return { near: nearestCity(x, z), k: 1 };
    },
    // Every piece on its full mesh whatever the distance, for the bake (update() would switch them back).
    nearLods() {
      for (const l of lods) { l.lo = false; for (const m of l.near) m.visible = true; for (const m of l.far) m.visible = false; }
      for (const m of hamletMats) { m.opacity = 1; m.transparent = false; m.needsUpdate = true; } // the flat picture keeps the original opaque hamlets
    },
    tint(colorOfCity, factionOfCity = () => NONE, player = NONE) {
      if (!near) {
        near = new Int16Array(N); for (let i = 0; i < N; i++) near[i] = nearestCity(pos[i * 3], pos[i * 3 + 2]);
        smoothX = new Uint32Array(GW * smoothN); smoothY = new Uint32Array(GH * smoothN);
        for (let k = 0; k < GW; k++) for (let q = 0; q < smoothN; q++) smoothX[k * smoothN + q] = Math.max(0, Math.min(GW - 1, k + q - smoothMid));
        for (let j = 0; j < GH; j++) for (let q = 0; q < smoothN; q++) smoothY[j * smoothN + q] = Math.max(0, Math.min(GH - 1, j + q - smoothMid)) * GW;
      }
      for (let ci = 0; ci < cities.length; ci++) { cityOwner[ci] = factionOfCity(ci); cityHue[ci] = colorOfCity(ci); }
      for (let i = 0; i < N; i++) {
        const ci = near[i], faction = cityOwner[ci], hue = H[i] >= SEA_Y ? cityHue[ci] : null, p = i * 4;
        ownerTint[p] = hue?.r ?? 0; ownerTint[p + 1] = hue?.g ?? 0; ownerTint[p + 2] = hue?.b ?? 0; ownerTint[p + 3] = hue ? 1 : 0;
        borders[p] = borders[p + 1] = borders[p + 2] = TERRITORY_DISTANCE_MAX; if (HI) bordersHi[i] = TERRITORY_DISTANCE_MAX;
        borders[p + 3] = player !== NONE && faction === player ? 1 : 0;
        borderInfo[p] = TERRITORY_DISTANCE_MAX; borderInfo[p + 1] = hue?.r ?? 0; borderInfo[p + 2] = hue?.g ?? 0; borderInfo[p + 3] = hue?.b ?? 0;
      }
      // Seed only real land/land owner edges, including the unowned frontier, never a coastline.
      const seed = (a, b, step) => {
        if (H[a] < SEA_Y || H[b] < SEA_Y) return;
        const fa = cityOwner[near[a]], fb = cityOwner[near[b]], bits = fa ^ fb;
        if (!bits) return;
        for (let k = 0; k < 3; k++) if (bits & (1 << k)) { borders[a * 4 + k] = Math.min(borders[a * 4 + k], step / 2); borders[b * 4 + k] = Math.min(borders[b * 4 + k], step / 2); }
        if (HI && bits & 8) { bordersHi[a] = Math.min(bordersHi[a], step / 2); bordersHi[b] = Math.min(bordersHi[b], step / 2); }
        // The unowned side borrows the neighbour's colour for its faint half of the line only.
        for (const [v, other] of [[a, b], [b, a]]) if (cityOwner[near[v]] === NONE) {
          const c = cityHue[near[other]], p = v * 4; if (c) { borderInfo[p + 1] = c.r; borderInfo[p + 2] = c.g; borderInfo[p + 3] = c.b; }
        }
      };
      for (let j = 0; j < GH; j++) for (let k = 0; k < GW; k++) {
        const i = j * GW + k; if (k + 1 < GW) seed(i, i + 1, dx); if (j + 1 < GH) seed(i, i + GW, dz);
      }
      // A two-pass chamfer field is built only when ownership changes. A signed field per faction bit
      // cannot create a seam between two cities owned by the same faction (unlike a single signed field).
      const diag = Math.hypot(dx, dz), relax = (i, j, step) => {
        const p = i * 4, q = j * 4;
        for (let k = 0; k < 3; k++) borders[p + k] = Math.min(borders[p + k], borders[q + k] + step);
        if (HI) bordersHi[i] = Math.min(bordersHi[i], bordersHi[j] + step);
      };
      for (let j = 0; j < GH; j++) for (let k = 0; k < GW; k++) {
        const i = j * GW + k;
        if (k) relax(i, i - 1, dx); if (j) { relax(i, i - GW, dz); if (k) relax(i, i - GW - 1, diag); if (k + 1 < GW) relax(i, i - GW + 1, diag); }
      }
      for (let j = GH - 1; j >= 0; j--) for (let k = GW - 1; k >= 0; k--) {
        const i = j * GW + k;
        if (k + 1 < GW) relax(i, i + 1, dx); if (j + 1 < GH) { relax(i, i + GW, dz); if (k) relax(i, i + GW - 1, diag); if (k + 1 < GW) relax(i, i + GW + 1, diag); }
      }
      for (let i = 0; i < N; i++) {
        const p = i * 4, faction = cityOwner[near[i]];
        borderInfo[p] = Math.min(borders[p], borders[p + 1], borders[p + 2]);
        for (let k = 0; k < 3; k++) if (!(faction & (1 << k))) borders[p + k] = -borders[p + k];
        if (HI) { borderInfo[p] = Math.min(borderInfo[p], bordersHi[i]); if (!(faction & 8)) bordersHi[i] = -bordersHi[i]; }
      }
      // Filter each signed bit independently: all samples of one owner keep the same sign, while
      // a turn through the grid becomes a rounded contour. The unsigned distance still guards coasts.
      for (let j = 0; j < GH; j++) for (let k = 0; k < GW; k++) {
        let r = 0, g = 0, b = 0;
        for (let q = 0; q < smoothN; q++) { const p = (j * GW + smoothX[k * smoothN + q]) * 4, w = TERRITORY_SMOOTH_WEIGHTS[q]; r += w * borders[p]; g += w * borders[p + 1]; b += w * borders[p + 2]; }
        if (HI) { let h = 0; for (let q = 0; q < smoothN; q++) h += TERRITORY_SMOOTH_WEIGHTS[q] * bordersHi[j * GW + smoothX[k * smoothN + q]]; smoothHi[j * GW + k] = h / TERRITORY_SMOOTH_TOTAL; }
        const p = (j * GW + k) * 3; borderSmooth[p] = r / TERRITORY_SMOOTH_TOTAL; borderSmooth[p + 1] = g / TERRITORY_SMOOTH_TOTAL; borderSmooth[p + 2] = b / TERRITORY_SMOOTH_TOTAL;
      }
      for (let j = 0; j < GH; j++) for (let k = 0; k < GW; k++) {
        let r = 0, g = 0, b = 0;
        for (let q = 0; q < smoothN; q++) { const p = (smoothY[j * smoothN + q] + k) * 3, w = TERRITORY_SMOOTH_WEIGHTS[q]; r += w * borderSmooth[p]; g += w * borderSmooth[p + 1]; b += w * borderSmooth[p + 2]; }
        if (HI) { let h = 0; for (let q = 0; q < smoothN; q++) h += TERRITORY_SMOOTH_WEIGHTS[q] * smoothHi[smoothY[j * smoothN + q] + k]; bordersHi[j * GW + k] = h / TERRITORY_SMOOTH_TOTAL; }
        const p = (j * GW + k) * 4; borders[p] = r / TERRITORY_SMOOTH_TOTAL; borders[p + 1] = g / TERRITORY_SMOOTH_TOTAL; borders[p + 2] = b / TERRITORY_SMOOTH_TOTAL;
      }
      geo.attributes.territory.needsUpdate = true; geo.attributes.territoryBorder.needsUpdate = true; geo.attributes.territoryDistance.needsUpdate = true;
      if (HI) geo.attributes.territoryBorderHi.needsUpdate = true;
    },
    update(t, camera, dist, pixelRatio) {
      for (const u of flowing) u.value = t;
      // Medium quality can cap the renderer below the screen DPR; fwidth is measured in renderer pixels.
      const dpr = pixelRatio ?? Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
      if (dist !== detailDist || detailEnabled !== detailLastEnabled || territoryFocus !== detailFocus || dpr !== detailDpr) { // only zoom, pixel ratio or attention changes the look
        detailDist = dist; detailLastEnabled = detailEnabled; detailFocus = territoryFocus; detailDpr = dpr;
        uDetailFade.value = detailEnabled && dist != null ? THREE.MathUtils.smoothstep(dist, DETAIL_ZOOM[0], DETAIL_ZOOM[1]) : 0;
        for (const m of hamletMats) m.opacity = 1 - (1 - HAMLET_FAR_OPACITY) * uDetailFade.value;
        if (territoryEnabled) {
          const z = dist == null ? 0 : THREE.MathUtils.smoothstep(dist, TERRITORY_ZOOM[0], TERRITORY_ZOOM[1]);
          uTerritory.value.set(detailEnabled && dist != null ? (THREE.MathUtils.lerp(TERRITORY_FILL[0], TERRITORY_FILL[1], z) + TERRITORY_MID_BOOST * 4 * z * (1 - z)) * (territoryFocus ? TERRITORY_FOCUS_SCALE : 1) : 0,
            dpr, territoryFocus ? TERRITORY_FOCUS_SCALE : 1, THREE.MathUtils.lerp(TERRITORY_BAND_WORLD[0], TERRITORY_BAND_WORLD[1], z));
        }
      }
      updateLods(camera);
    },
  };
}
