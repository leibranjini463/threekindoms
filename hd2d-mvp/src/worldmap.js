// 战略地图 landscape in the war map's HD-2D style (src/diorama.js): one continuous heightfield instead of
// voxels, painted texel by texel from the war map's own 32 px-per-unit pixel tiles laid in world space —
// meadow, forest floor, dry earth, rock, snow, river beds and patchwork fields around the cities, with
// dithered borders between them. Rivers cut gorges through the ranges and run as water ribbons, lakes
// sit in their basins, groves of solid trees stand in the woods, and the board ends in an earth skirt.
import * as THREE from 'three';
import { canvasTex, rng } from './pixel.js';
import { dioramaTextures, vnoise, azureWaterTex } from './diorama.js';
import { patchGround, groundChunk, seasonalTree, seasonalWater } from './seasons.js';
import { plantTrees } from './structures.js';
import { isLand as chinaLand, RIVERS as CHINA_RIVERS, LAKES as CHINA_LAKES, nearest, ranges as chinaRanges, plateaus as chinaPlateaus, aridity as chinaAridity, landOf, rangesOf } from './china.js';

export const LON0 = 97.5, LON1 = 125, LAT0 = 20, LAT1 = 43;
export const toX = (lon) => (lon - 111.5) * 0.9, toZ = (lat) => -(lat - 31.5);
export const fromX = (x) => x / 0.9 + 111.5, fromZ = (z) => 31.5 - z;
export const SEA_Y = 0.14;
const STEP = 0.1;
// The board's extent and geography: the original's, or an overseas region's (src/regions/<name>.js, made by tools/region_geo.py),
// built only to be exported for its sand-table bake (tools/export_region_board.mjs). Same grain, same world mapping (toX/toZ).
function geography(geo) {
  const [lon0, lon1, lat0, lat1] = geo ? geo.box : [LON0, LON1, LAT0, LAT1];
  return {
    LON0: lon0, LON1: lon1, LAT0: lat0, LAT1: lat1, NX: Math.round((lon1 - lon0) / STEP) + 1, NZ: Math.round((lat1 - lat0) / STEP) + 1,
    X0: toX(lon0), X1: toX(lon1), Z0: toZ(lat1), Z1: toZ(lat0),
    isLand: geo ? landOf(geo.land) : chinaLand, RIVERS: geo ? geo.rivers : CHINA_RIVERS, LAKES: geo ? geo.lakes : CHINA_LAKES,
    ranges: geo ? rangesOf(geo.ranges) : chinaRanges,
    // A region beside the original's own country (the north strip) keeps its dry country and uplands, so they run on across the seam.
    plateaus: geo && !geo.china ? () => ({ tibet: 0, loess: 0, h: 0 }) : chinaPlateaus, aridity: geo && !geo.china ? () => 0 : chinaAridity,
    // Degrees inland over which the coastal plain and then the relief rise: the original's belts are wide, a region's islands narrow.
    coastRise: geo?.coast ?? [0.6, 0.9],
  };
}
const TPU = 32; // texels per world unit, as on the war map
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

// Field crops: rows of [furrow, crop, lit crop]; the bund between fields is a darker earth line.
const CROPS = [['#3e5a26', '#56782f', '#6a8c3a'], ['#8a7a36', '#a89444', '#bca856'], ['#5e4c32', '#6e5a3c', '#7e6846'], ['#566c2a', '#6e8434', '#84983e']].map((r) => r.map(hex));
const BUND = hex('#4a3e2a');

// cities: [{ lon, lat }] as drawn.
// region: an overseas region's geography (see geography); the original board without it.
export function buildWorld(scene, cities, seed = 5, region = null) {
  const { LON0, LAT1, NX, NZ, X0, X1, Z0, Z1, isLand, RIVERS, LAKES, ranges, plateaus, aridity, coastRise: [RISE, RELIEF] } = geography(region);
  const N = NX * NZ, lonOf = (k) => LON0 + k * STEP, latOf = (j) => LAT1 - j * STEP;
  // ---- Land mask and signed distance to the coast (degrees, + on land) ----
  const land = new Uint8Array(N);
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) land[j * NX + k] = isLand(lonOf(k), latOf(j)) ? 1 : 0;
  const dist = new Float32Array(N).fill(1e9);
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
    const i = j * NX + k;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const kk = k + a, jj = j + b; return kk >= 0 && jj >= 0 && kk < NX && jj < NZ && land[jj * NX + kk] !== land[i]; })) dist[i] = 0.5;
  }
  const chamfer = (k, j, a, b, c) => { const kk = k + a, jj = j + b; if (kk >= 0 && jj >= 0 && kk < NX && jj < NZ) { const i = j * NX + k, v = dist[jj * NX + kk] + c; if (v < dist[i]) dist[i] = v; } };
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) { chamfer(k, j, -1, 0, 1); chamfer(k, j, 0, -1, 1); chamfer(k, j, -1, -1, 1.414); chamfer(k, j, 1, -1, 1.414); }
  for (let j = NZ - 1; j >= 0; j--) for (let k = NX - 1; k >= 0; k--) { chamfer(k, j, 1, 0, 1); chamfer(k, j, 0, 1, 1); chamfer(k, j, 1, 1, 1.414); chamfer(k, j, -1, 1, 1.414); }
  const coast = new Float32Array(N);
  for (let i = 0; i < N; i++) coast[i] = (land[i] ? 1 : -1) * dist[i] * STEP;

  // ---- Height ----
  // gorge: 0 on a big river … 1 clear of it; the ranges open up for the river to pass.
  const ridged = (lon, lat) => 1 - Math.abs(2 * vnoise(lon * 1.4, lat * 1.4, seed + 9) - 1);
  // rng: ranges(lon, lat) when the caller already has it.
  const landH = (lon, lat, cd, gorge, rng0 = ranges(lon, lat)) => {
    const R = rng0 * (0.7 + 0.6 * ridged(lon, lat)) * gorge, P = plateaus(lon, lat);
    const rough = P.tibet * 0.6 * ridged(lon * 0.7, lat * 0.7) ** 2 * gorge; // scattered peaks on the plateau
    const hills = 0.07 * (vnoise(lon * 1.7, lat * 1.7, seed + 3) - 0.5) + 0.06 * vnoise(lon * 0.45, lat * 0.45, seed + 4);
    return 0.17 + 0.13 * sm(0, RISE, cd) + (R + P.h + rough + hills) * sm(0, RELIEF, cd);
  };
  const H = new Float32Array(N), riverD = new Float32Array(N).fill(9), R0 = new Float32Array(N);
  // Cities stand in basins and on plains: their terrace is the land's height without the ranges, so a range
  // that runs close (秦岭 by 长安 and 汉中) opens into a basin round the city.
  const cityRaw = cities.map((c) => landH(c.lon, c.lat, 2, 1, 0));
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
    const i = j * NX + k, lon = lonOf(k), lat = latOf(j), cd = coast[i];
    if (!land[i]) { H[i] = SEA_Y - 0.05 - Math.min(0.3, -cd * 0.45); continue; }
    let gorge = 1, carve = null;
    for (const rv of RIVERS) {
      const n = nearest(rv.pts, lon, lat), e = n.d - rv.w;
      if (e < riverD[i]) riverD[i] = e;
      gorge = Math.min(gorge, sm(-0.05, 0.55, e));
      if (e < 0.3 && (!carve || e < carve.e)) carve = { e, px: n.px, py: n.py };
    }
    const rg = ranges(lon, lat), h0 = landH(lon, lat, cd, gorge, rg);
    let h = h0;
    R0[i] = rg * gorge;
    cities.forEach((c, ci) => { const d = Math.hypot((lon - c.lon) * 0.9, lat - c.lat); if (d < 0.8) h = lerp(cityRaw[ci], h, sm(0.42, 0.8, d)); });
    if (carve) { const hc = landH(carve.px, carve.py, 2, 0); h = lerp(hc - 0.07, Math.max(h, hc), sm(-0.02, 0.28, carve.e)); }
    for (const L of LAKES) {
      const e = Math.hypot((lon - L.lon) / L.rx, (lat - L.lat) / L.ry);
      if (e < 1.35) { const ls = landH(L.lon, L.lat, 2, 0); h = lerp(ls - 0.08, Math.max(h, ls), sm(0.8, 1.35, e)); riverD[i] = Math.min(riverD[i], (e - 1) * 0.3); }
    }
    H[i] = h;
  }
  const at = (arr, k, j) => arr[Math.min(NZ - 1, Math.max(0, j)) * NX + Math.min(NX - 1, Math.max(0, k))];
  // Bilinear lookups in world space.
  const sample = (arr, x, z) => {
    const fk = (fromX(x) - LON0) / STEP, fj = (LAT1 - fromZ(z)) / STEP, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    return lerp(lerp(at(arr, k, j), at(arr, k + 1, j), a), lerp(at(arr, k, j + 1), at(arr, k + 1, j + 1), a), b);
  };
  const heightAt = (x, z) => sample(H, x, z);

  // ---- Surface classes per grid point (0…1 weights), read back per texel ----
  const W = { forest: new Float32Array(N), rock: new Float32Array(N), snow: new Float32Array(N), dry: new Float32Array(N), farm: new Float32Array(N), bed: new Float32Array(N), beach: new Float32Array(N), loess: new Float32Array(N), cav: new Float32Array(N) };
  const cellW = STEP * 0.95; // world size of a grid step, for the slope
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
    const i = j * NX + k, lon = lonOf(k), lat = latOf(j), h = H[i];
    if (!land[i]) continue;
    const slope = Math.hypot(at(H, k + 1, j) - at(H, k - 1, j), at(H, k, j + 1) - at(H, k, j - 1)) / (2 * cellW);
    const P = plateaus(lon, lat), R = R0[i], dry = aridity(lon, lat);
    W.rock[i] = Math.max(sm(0.7, 1.1, slope), sm(0.75, 1.05, R));
    W.snow[i] = Math.max(sm(2.4, 2.5, h), sm(1.25, 1.45, R)); // only the peaks: the plateau itself is high steppe
    W.dry[i] = dry;
    W.loess[i] = Math.max(P.loess, P.tibet * 0.8);
    const fn = vnoise(lon * 0.75, lat * 0.75, seed + 21) * 0.65 + vnoise(lon * 2.3, lat * 2.3, seed + 22) * 0.35;
    const bias = (lat < 30 ? 0.12 : lat > 37 ? -0.1 : 0) + 0.28 * sm(0.12, 0.45, R) - dry * 0.6 - P.loess * 0.35 - P.tibet * 0.45 - (h > 1.6 ? 0.3 : 0);
    W.forest[i] = sm(0.56, 0.6, fn + bias);
    let near = 9; for (const c of cities) near = Math.min(near, Math.hypot((lon - c.lon) * 0.9, lat - c.lat));
    W.farm[i] = near < 1.35 && near > 0.38 && slope < 0.35 && R < 0.3 && dry < 0.3 ? sm(1.35, 1.0, near) * sm(0.3, 0.45, vnoise(lon * 2.5, lat * 2.5, seed + 31) + (1.35 - near) * 0.3) : 0;
    W.bed[i] = sm(0.06, -0.01, riverD[i]);
    W.beach[i] = sm(0.13, 0.05, coast[i]);
  }
  // Cavity: valleys darker, crests a touch lighter (heights against their 5×5 neighbourhood).
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
    let s = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) s += at(H, k + a, j + b);
    W.cav[j * NX + k] = Math.min(1.06, Math.max(0.62, 1 - (s / 25 - H[j * NX + k]) * 2.2));
  }

  // ---- Texture: one texel per 1/32 unit, from the war map's tiles ----
  const TX = dioramaTextures();
  const pix = (t) => { const c = t.userData.canvas; return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const tiles = { grass: pix(TX.top.grass), forest: pix(TX.top.forest), sand: pix(TX.top.sand), bed: pix(TX.top.bed), rock: pix(TX.top.rock), snow: pix(TX.top.snow) };
  const TW = Math.ceil((X1 - X0) * TPU), TH = Math.ceil((Z1 - Z0) * TPU);
  const img = new ImageData(TW, TH), d = img.data;
  // Season mask (seasons.js): grass / forest / farm weight per texel and the texel's tone within its own
  // ramp, so each month can recolour the vegetation while the painted pixel pattern stays.
  const mask = new Uint8Array(TW * TH * 4);
  const lum = (t, i) => 0.2126 * t[i] + 0.7152 * t[i + 1] + 0.0722 * t[i + 2];
  const rangeOf = (t) => { let lo = 255, hi = 0; for (let i = 0; i < t.length; i += 4) { const l = lum(t, i); lo = Math.min(lo, l); hi = Math.max(hi, l); } return [lo, Math.max(1, hi - lo)]; };
  const toneOf = { grass: rangeOf(tiles.grass), forest: rangeOf(tiles.forest) };
  const tint = { // regional colour on vegetation: dry north and plateaus go ochre, the south stays lush
    loess: [1.16, 1.02, 0.74], tibet: [1.05, 0.98, 0.86], south: [0.92, 1.04, 0.94],
  };
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const x = X0 + (tx + 0.5) / TPU, z = Z0 + (ty + 0.5) / TPU, lon = fromX(x), lat = fromZ(z);
    const fk = (lon - LON0) / STEP, fj = (LAT1 - lat) / STEP, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    const S = (arr) => lerp(lerp(at(arr, k, j), at(arr, k + 1, j), a), lerp(at(arr, k, j + 1), at(arr, k + 1, j + 1), a), b);
    // Threshold: coarse value noise (ragged pixel borders) plus a little ordered dither.
    const th = 0.15 + 0.7 * vnoise(tx / 5, ty / 5, 77) + (BAYER[(ty & 3) * 4 + (tx & 3)] - 0.5) * 0.25;
    const u = tx & 127, v = ty & 127, ti = (v * 128 + u) * 4, o = (ty * TW + tx) * 4;
    const h = S(H);
    let src = null, rgb = null, veg = false, cls = -1, tone = 0;
    if (h < SEA_Y + 0.005 && S(coast) < 0) { // seabed: sand going dark teal with depth
      const t = tiles.sand, dk = Math.min(1, (SEA_Y - h) / 0.3);
      rgb = [lerp(t[ti], 30, dk), lerp(t[ti + 1], 62, dk), lerp(t[ti + 2], 70, dk)];
    } else if (S(W.beach) > th) src = tiles.sand;
    else if (S(W.bed) > th) src = tiles.bed;
    else if (S(W.snow) > th) src = tiles.snow;
    else if (S(W.rock) > th) src = tiles.rock;
    else if (S(W.dry) > th) src = tiles.sand;
    else if (S(W.forest) > th) { src = tiles.forest; veg = true; cls = 1; }
    else if (S(W.farm) > th) {
      // Fields: staggered rows of plots, each with its own crop and furrow direction, bunds between them.
      const row = Math.floor(ty / 9), col = Math.floor((tx + row * 5) / 13), hsh = hash(col, row, 5);
      const crop = CROPS[(hsh * CROPS.length) | 0], fx = (tx + row * 5) % 13, fy = ty % 9;
      const ci = (hsh * CROPS.length) | 0;
      if (fx === 0 || fy === 0) rgb = [...BUND];
      else { const lines = hsh > 0.5 ? fx : fy, step = lines % 3 === 0 ? 0 : (hash(tx, ty, 9) < 0.2 ? 2 : 1); rgb = [...crop[step]]; tone = 0.08 + (((ci * 5 + row) % 4) * 3 + step) / 11 * 0.86; }
      veg = true; cls = 2;
    } else { src = tiles.grass; veg = true; cls = 0; }
    if (src) rgb = [src[ti], src[ti + 1], src[ti + 2]];
    if (veg) {
      const lo = S(W.loess), south = sm(30, 25, lat), up = plateaus(lon, lat).loess > 0.2 ? tint.loess : tint.tibet;
      for (let c = 0; c < 3; c++) rgb[c] *= lerp(1, up[c], lo) * lerp(1, tint.south[c], south);
      // The loess and the high plateau keep their baked ochre: the month's palette reaches them only in part.
      const mo = ((TH - 1 - ty) * TW + tx) * 4, w = Math.round(255 * (1 - 0.8 * lo));
      if (cls < 2) { const [l0, ls] = toneOf[cls ? 'forest' : 'grass']; tone = (lum(src, ti) - l0) / ls; }
      mask[mo + cls] = w; mask[mo + 3] = Math.round(255 * Math.min(1, Math.max(0, tone)));
    }
    d[o] = Math.min(255, rgb[0]); d[o + 1] = Math.min(255, rgb[1]); d[o + 2] = Math.min(255, rgb[2]); d[o + 3] = 255;
  }
  const groundTex = canvasTex(TW, TH, (g) => g.putImageData(img, 0, 0));
  groundTex.anisotropy = 8;
  const maskTex = new THREE.DataTexture(mask, TW, TH);
  maskTex.magFilter = THREE.NearestFilter; maskTex.minFilter = THREE.LinearMipmapLinearFilter; maskTex.generateMipmaps = true; maskTex.needsUpdate = true;

  // ---- Mesh ----
  const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), col = new Float32Array(N * 3).fill(1), idx = [];
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
    const i = j * NX + k, x = toX(lonOf(k)), z = toZ(latOf(j));
    pos.set([x, H[i], z], i * 3); uv.set([(x - X0) / (X1 - X0), 1 - (z - Z0) / (Z1 - Z0)], i * 2);
    col.fill(W.cav[i], i * 3, i * 3 + 3); // retain cavity shading even before territory is first enabled
  }
  for (let j = 0; j < NZ - 1; j++) for (let k = 0; k < NX - 1; k++) { const a = j * NX + k, b = a + 1, c = a + NX, e = c + 1; idx.push(a, c, b, b, c, e); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  // Steep faces switch to the war map's cliff texture (bedding planes and joints), projected from the side
  // in world space, with a hard edge as in pixel art; the painted ground stays on everything flatter.
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 0.96, metalness: 0 });
  groundMat.customProgramCacheKey = () => 'strategyGround';
  groundMat.onBeforeCompile = (sh) => {
    patchGround(sh, maskTex, TW, TH);
    sh.uniforms.cliffMap = { value: TX.side.rock };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D cliffMap; varying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec3 wn = normalize(vWNrm);
        if (wn.y < 0.6) {
          vec2 a = vec2(vWPos.z, -vWPos.y) / 4., b = vec2(vWPos.x, -vWPos.y) / 4.;
          float wx = abs(wn.x) / (abs(wn.x) + abs(wn.z) + 1e-4);
          sampledDiffuseColor = mix(texture2D(cliffMap, b), texture2D(cliffMap, a), step(0.5, wx));
        }
        ${groundChunk()}
        diffuseColor *= sampledDiffuseColor;`);
  };
  const ground = new THREE.Mesh(geo, groundMat);
  ground.castShadow = ground.receiveShadow = true; ground.userData.mask = maskTex; scene.add(ground);

  // Skirt: the board is a slab, its cut edge earth strata like the war map's banks.
  const skirtPos = [], skirtUv = [], skirtIdx = [], DEPTH = -1.6;
  const edge = (pts) => {
    let run = 0;
    pts.forEach(([k, j], n) => {
      const i = j * NX + k, x = toX(lonOf(k)), z = toZ(latOf(j)), b = skirtPos.length / 3;
      if (n) run += STEP * 0.95;
      skirtPos.push(x, H[i], z, x, DEPTH, z); skirtUv.push(run / 4, 1, run / 4, 1 - (H[i] - DEPTH) / 4);
      if (n) skirtIdx.push(b - 2, b, b - 1, b - 1, b, b + 1);
    });
  };
  const span = (n, f) => Array.from({ length: n }, (_, t) => f(t));
  edge(span(NX, (k) => [k, NZ - 1])); edge(span(NZ, (j) => [NX - 1, NZ - 1 - j])); edge(span(NX, (k) => [NX - 1 - k, 0])); edge(span(NZ, (j) => [0, j]));
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(skirtUv, 2)); sg.setIndex(skirtIdx); sg.computeVertexNormals();
  scene.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: TX.side.earth, roughness: 1, side: THREE.DoubleSide, color: '#b8ac98' })));

  // ---- Water: the open sea, river ribbons, lakes ----
  // The strategy map's water is the clear azure of the FC map (the war map keeps its deep teal).
  const azure = azureWaterTex();
  const waterMat = (repeat) => {
    const t = azure.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.9, roughness: 0.32, metalness: 0.05, emissive: '#0a3a62', emissiveIntensity: 0.25, depthWrite: false });
  };
  const seaW = X1 - X0 + 30, seaH = Z1 - Z0 + 30, seaMat = waterMat([seaW / 2, seaH / 2]);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(seaW, seaH), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(X0 + seaW / 2, SEA_Y, Z0 + seaH / 2); sea.receiveShadow = true; scene.add(sea);
  const flowing = [seaMat.map];
  const riverMat = seasonalWater(waterMat([1, 1])); riverMat.opacity = 0.92; flowing.push(riverMat.map);
  for (const rv of RIVERS) {
    // Resample the course every 0.05° and lay a ribbon at the carved bed's water line.
    const pts = [];
    for (let s = 0; s < rv.pts.length - 1; s++) {
      const [ax, ay] = rv.pts[s], [bx, by] = rv.pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
      for (let t = 0; t < n; t++) pts.push([lerp(ax, bx, t / n), lerp(ay, by, t / n)]);
    }
    pts.push(rv.pts.at(-1));
    const rp = [], ruv = [], ri = []; let run = 0;
    pts.forEach(([lon, lat], n) => {
      const [plon, plat] = pts[Math.max(0, n - 1)], [nlon, nlat] = pts[Math.min(pts.length - 1, n + 1)];
      const dx = toX(nlon) - toX(plon), dz = toZ(nlat) - toZ(plat), L = Math.hypot(dx, dz) || 1, ox = -dz / L, oz = dx / L;
      const x = toX(lon), z = toZ(lat), w = rv.w * 1.05, y = Math.max(SEA_Y, heightAt(x, z) + 0.045);
      if (n) run += Math.hypot(toX(lon) - toX(plon), toZ(lat) - toZ(plat));
      rp.push(x + ox * w, y, z + oz * w, x - ox * w, y, z - oz * w); ruv.push(0, run * 2, w * 4, run * 2);
      if (n) { const b = n * 2; ri.push(b - 2, b, b - 1, b - 1, b, b + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2)); g.setIndex(ri); g.computeVertexNormals();
    const m = new THREE.Mesh(g, riverMat); m.receiveShadow = true; m.renderOrder = 1; scene.add(m);
  }
  const lakeMat = seasonalWater(waterMat([0.6, 0.6]));
  for (const L of LAKES) {
    const ls = sample(H, toX(L.lon), toZ(L.lat)) + 0.06;
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), lakeMat);
    m.rotation.x = -Math.PI / 2; m.scale.set(L.rx * 0.9 * 1.08, L.ry * 1.08, 1); m.position.set(toX(L.lon), ls, toZ(L.lat)); m.receiveShadow = true; scene.add(m);
  }

  // ---- Trees: groves in the woods, pines on the heights and in the north, the odd lone tree ----
  const r = rng(seed * 31 + 7), trees = [];
  const clearOfCities = (x, z) => cities.every((c) => Math.hypot(x - toX(c.lon), z - toZ(c.lat)) > 0.55);
  for (let n = 0; n < 26000 && trees.length < 2600; n++) {
    const x = lerp(X0 + 0.2, X1 - 0.2, r()), z = lerp(Z0 + 0.2, Z1 - 0.2, r());
    const f = sample(W.forest, x, z), h = heightAt(x, z);
    if (h < SEA_Y + 0.06 || sample(W.bed, x, z) > 0.2 || sample(W.snow, x, z) > 0.3 || sample(W.dry, x, z) > 0.5) continue;
    const lone = f < 0.5 && sample(W.farm, x, z) < 0.2 && r() < 0.015;
    if (f < 0.5 && !lone) continue;
    if (!clearOfCities(x, z)) continue;
    const high = h > 1.0 || fromZ(z) > 37 || sample(W.rock, x, z) > 0.3;
    trees.push({ x, z, h: h + 0.01, s: lerp(0.2, 0.3, r()) * (lone ? 1.15 : 1), ry: r() * 6.3, pine: high ? r() < 0.75 : r() < 0.15 });
  }
  const seasonal = new Map(), wrap = (m, kind) => { if (!seasonal.has(m)) seasonal.set(m, seasonalTree(m, kind)); return seasonal.get(m); };
  plantTrees(scene, trees, seed, { wrap });

  let near = null;
  return {
    heightAt, ground,
    // AO and territory: each land vertex is shaded by its cavity and tinted toward its nearest city's owner.
    tint(colorOfCity) {
      if (!near) {
        const out = new Int16Array(N), dd = new Float32Array(N);
        for (let j = 0; j < NZ; j++) for (let k = 0; k < NX; k++) {
          const i = j * NX + k, lon = lonOf(k), lat = latOf(j);
          let best = 0, bd = Infinity;
          cities.forEach((c, ci) => { const q = Math.hypot((lon - c.lon) * 0.9, lat - c.lat); if (q < bd) { bd = q; best = ci; } });
          out[i] = best; dd[i] = bd;
        }
        near = { out, dd };
      }
      const { out, dd } = near, c = new THREE.Color();
      for (let i = 0; i < N; i++) {
        const ao = W.cav[i], hue = land[i] ? colorOfCity(out[i]) : null, k = hue ? 0.12 * sm(2.8, 0.9, dd[i]) : 0; // a hint of the owner: the land itself stays green
        c.setRGB(1, 1, 1); if (k) c.lerp(hue, k); c.multiplyScalar(ao);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.attributes.color.needsUpdate = true;
    },
    clearTint() { // restore cavity shading without computing ownership while the overlay is off
      for (let i = 0; i < N; i++) col.fill(W.cav[i], i * 3, i * 3 + 3);
      geo.attributes.color.needsUpdate = true;
    },
    update(t) { for (const m of flowing) m.offset.set(t * 0.012, t * 0.03); },
  };
}
