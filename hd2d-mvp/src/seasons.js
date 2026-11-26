// The 战略地图's twelve months. The game counts the lunar calendar (正月 opens spring), so 1–3月 are
// spring, 4–6月 summer, 7–9月 autumn, 10–12月 winter. Each month sets the vegetation palettes, the snow
// line, blossom, autumn colour and bare branches, the weather, and the light; the original's own calendar
// lines up with it (floods in 5–6月, droughts in 8–9月, rice harvest in 10月).
// Palettes follow the 0.1.1 art-direction targets painted with GPT image (docs/review-assets/2026-10-27):
// the bright, clean green land, azure sea and white castles that made the FC map readable.
// One set of uniforms (U) drives every patched material, so a month change is one tween.
import * as THREE from 'three';

const SAND_LEAF_REF_SCALE = [2.1, 1.45, 1.45]; // darken and cool leaves after their trunk test; autumn and snow retain their own colours
const col = (h) => new THREE.Color(h);
const ramp = (...hex) => hex.map(col);
// Vegetation ramps, dark → light; the ground's baked texels keep their tone and take these hues.
const GRASS = {
  thaw: ramp('#4a5a2a', '#607834', '#7a9640', '#96b04e', '#b4c868'),
  spring: ramp('#3c6420', '#54822c', '#70a03a', '#90bc48', '#b4d466'),
  summer: ramp('#2e5c20', '#3e7a28', '#549a32', '#6eb43c', '#90ca52'),
  dry: ramp('#58622a', '#727e32', '#8e983c', '#aaac4c', '#c4be66'),
  autumn: ramp('#6e5a24', '#8c742e', '#aa8e38', '#c6a848', '#dec266'),
  winter: ramp('#5c5640', '#706a4e', '#868060', '#9c9672', '#b4ac88'),
  subtropic: ramp('#3a5a28', '#4a6e30', '#5e843a', '#729846', '#8cae58'), // South China in autumn and winter
};
const FOREST = {
  spring: ramp('#264a1c', '#326226', '#40782e', '#528e38', '#6ca646'),
  summer: ramp('#21481e', '#2c5c24', '#386e2c', '#468236', '#589842'),
  subtropic: ramp('#20401c', '#2a5222', '#36662a', '#447a32', '#568e3c'),
  autumn: ramp('#5a2412', '#843818', '#ac561c', '#cc7c26', '#e2a640'),
  crimson: ramp('#4e1610', '#7a2016', '#a8301e', '#c84a28', '#de7a3e'),
  winter: ramp('#2e2c26', '#3e3a30', '#504a3c', '#645c4a', '#7a705a'),
};
const FARM = {
  thaw: ramp('#4e4a2c', '#62603a', '#7a7c46', '#949854', '#aeb06a'),
  spring: ramp('#3a6a30', '#4a8a3a', '#62a444', '#80bc52', '#a2d26a'),
  summer: ramp('#345e1e', '#447e26', '#5c9c30', '#76b63c', '#96cc52'),
  ripe: ramp('#6e6420', '#8e8228', '#ae9e30', '#c8b83e', '#e0cc54'),
  autumn: ramp('#7e5a1a', '#a27a22', '#c49a2c', '#dcb63c', '#f0d058'),
  winter: ramp('#4c402e', '#5e5038', '#726242', '#86764e', '#9a8a5c'),
};
// Leaves on the 3D trees (the leaf textures are dark greens; their tone picks a step here).
const LEAF = {
  spring: ramp('#2c5220', '#3e6e28', '#548c32', '#70a83e', '#94c252'),
  summer: ramp('#284a1e', '#355e26', '#44742e', '#568a38', '#6ea244'),
  dry: ramp('#34481c', '#4a6024', '#62782c', '#7e8e38', '#9ca44a'),
  winter: ramp('#4a4038', '#5c5046', '#6e6254', '#827464', '#988876'), // bare twigs
};

// [light preset, grass, forest, farm, leaf, snow line (latitude, high ground lower), blossom, autumn,
//  bare, cloud shadow, rain, snowfall, petals, leaves fall, thunder]; a ramp may be [a, b, k] (a→b by k).
// south: the far south (south of ~27°N) keeps evergreen ground in autumn and winter.
const M = (light, grass, forest, farm, leaf, snow, o = {}) => ({ light, grass, forest, farm, leaf, snow, south: 0, blossom: 0, autumn: 0, bare: 0, cloud: 0.25, rain: 0, snowfall: 0, petals: 0, fall: 0, thunder: 0, ...o });
export const MONTHS = [
  M('thaw', ['thaw', 'spring', 0.35], ['winter', 'spring', 0.5], 'thaw', ['winter', 'spring', 0.55], 38.2, { blossom: 0.5, bare: 0.45, petals: 0.35, cloud: 0.2, south: 0.6 }), // 正月 孟春: plum blossom, snow lingering in the far north
  M('spring', 'spring', 'spring', ['thaw', 'spring', 0.6], 'spring', 39.6, { blossom: 1, bare: 0.1, petals: 1, cloud: 0.3 }), // 二月 仲春: peach blossom
  M('spring', 'spring', ['spring', 'summer', 0.4], 'spring', 'spring', 44, { blossom: 0.45, petals: 0.5, rain: 0.3, cloud: 0.35 }), // 三月 季春: 清明 showers
  M('summer', ['spring', 'summer', 0.6], 'summer', 'summer', 'summer', 44, { cloud: 0.5 }), // 四月 孟夏
  M('rain', 'summer', 'summer', 'summer', 'summer', 44, { cloud: 0.3, rain: 0.75, thunder: 0.4 }), // 五月 仲夏: 梅雨
  M('storm', 'summer', 'summer', ['summer', 'ripe', 0.2], 'summer', 44, { cloud: 0.35, rain: 1, thunder: 1 }), // 六月 季夏: storms, floods
  M('summer', ['summer', 'dry', 0.4], 'summer', ['summer', 'ripe', 0.45], 'summer', 44, { cloud: 0.55 }), // 七月 孟秋: late heat
  M('dry', 'dry', ['summer', 'autumn', 0.25], 'ripe', ['summer', 'dry', 0.6], 44, { autumn: 0.25, cloud: 0.15, fall: 0.15 }), // 八月 仲秋: drought, ripening
  M('autumn', ['dry', 'autumn', 0.7], 'autumn', 'autumn', 'dry', 44, { autumn: 1, cloud: 0.2, fall: 0.8, south: 0.7 }), // 九月 季秋: maple red, harvest gold
  M('lateAutumn', 'autumn', ['autumn', 'winter', 0.35], ['autumn', 'winter', 0.5], 'dry', 40.4, { autumn: 0.8, bare: 0.35, cloud: 0.2, fall: 1, south: 0.9 }), // 十月 孟冬: first frost north
  M('winter', ['autumn', 'winter', 0.75], 'winter', 'winter', 'winter', 35.6, { autumn: 0.2, bare: 0.9, cloud: 0.2, snowfall: 0.45, south: 1 }), // 十一月 仲冬
  M('snow', 'winter', 'winter', 'winter', 'winter', 33.4, { bare: 1, cloud: 0.1, snowfall: 1, south: 1 }), // 十二月 季冬: snow to the 淮河
];
// The dark table round the sand-table board leans toward the season, with the UI's colours (ui.css body[data-season]); one per season.
export const SEASON_TABLE = ['#141c0e', '#0c1a1c', '#201006', '#141a24'];
export const MONTH_NAMES = ['孟春', '仲春', '季春', '孟夏', '仲夏', '季夏', '孟秋', '仲秋', '季秋', '孟冬', '仲冬', '季冬'];
export const SEASON_OF = (m) => '春夏秋冬'[Math.floor(m / 3)];
export const WEATHER_OF = (m) => { const s = MONTHS[m]; return s.snowfall > 0.3 ? '雪' : s.rain > 0.6 ? (s.thunder > 0.5 ? '雷雨' : '雨') : s.rain > 0 ? '小雨' : s.petals > 0.4 ? '花' : s.fall > 0.5 ? '落叶' : '晴'; };

// Light per preset: key sun (colour, intensity, direction), cool back light, sky dome / ground bounce,
// fog, and the sky gradient behind the board (top, upper, horizon, below).
const L = (sun, si, dir, back, hemi, hg, hi, fog, sky, puff) => ({ sun: col(sun), si, dir: new THREE.Vector3(...dir).normalize(), back: col(back), hemi: col(hemi), hg: col(hg), hi, fog: col(fog), sky: sky.map(col), puff: col(puff) });
const LIGHTS = {
  thaw:       L('#fff0dc', 3.5, [-18, 19, 10], '#a8c4ec', '#d0e2ff', '#5a5040', 1.0, '#c9d4dc', ['#3e6c9e', '#7fa6cc', '#d6dee0', '#a89880'], '#f4f2ee'),
  spring:     L('#fff2dc', 3.7, [-17, 21, 10], '#a8c8f0', '#d4e6ff', '#5e5236', 1.05, '#cfd9dc', ['#3a72aa', '#82b0d8', '#dfe6e2', '#a89878'], '#f8f2ee'),
  summer:     L('#fff6e4', 4.0, [-14, 24, 9], '#a0c4f0', '#c8e0ff', '#56502e', 1.05, '#c6d8e4', ['#2c6cb0', '#74aee0', '#d6e6ee', '#9c9474'], '#ffffff'),
  rain:       L('#e2e8ee', 1.9, [-12, 24, 8], '#b8c8d8', '#bccad8', '#4a4a40', 1.35, '#a6b4be', ['#56677a', '#8696a6', '#b4bec6', '#7e7c74'], '#c8ced4'),
  storm:      L('#d8e0ea', 1.5, [-12, 24, 8], '#a8b8cc', '#aebccc', '#44443c', 1.3, '#94a2ae', ['#45546a', '#748496', '#a2adb8', '#6e6c66'], '#b4bcc4'),
  dry:        L('#ffe8c0', 4.0, [-15, 22, 10], '#b0c0dc', '#dcdccc', '#6a5634', 0.95, '#e2d8c2', ['#4a7cb0', '#9ab8d4', '#ece0c8', '#b09a76'], '#fff4e2'),
  autumn:     L('#ffd8a0', 3.6, [-20, 15, 11], '#98b4e0', '#d8dcec', '#6a4a2a', 0.9, '#e6d6bc', ['#3a68a0', '#8cacd0', '#f0d8b4', '#a68660'], '#fff0dc'),
  lateAutumn: L('#ffdcb0', 3.3, [-21, 13, 11], '#a0b8e0', '#d4dcea', '#5e4630', 0.95, '#dcd4c6', ['#46709e', '#90acc8', '#e4d8c6', '#9a8468'], '#f6eee6'),
  winter:     L('#f2f4ff', 3.2, [-19, 16, 11], '#b4c8ec', '#dce8ff', '#5a5650', 1.1, '#d2dce6', ['#44709e', '#8eaccc', '#e2e8ee', '#a09a92'], '#f6f8fc'),
  snow:       L('#eef2fc', 2.5, [-17, 19, 10], '#c0d0ec', '#e2ecff', '#606068', 1.3, '#d0d8e2', ['#62788e', '#9aaabc', '#d8dee4', '#9a9a9c'], '#f2f4f8'),
};

const KEYS = ['grass', 'forest', 'farm', 'leaf'];
const TABLE = { grass: GRASS, forest: FOREST, farm: FARM, leaf: LEAF };
const resolve = (set, spec) => (typeof spec === 'string' ? set[spec] : set[spec[0]].map((c, i) => c.clone().lerp(set[spec[1]][i], spec[2])));
// A month as flat numbers and colours, so two can be blended.
function stateOf(m) {
  const s = MONTHS[m], out = { light: LIGHTS[s.light] };
  for (const k of KEYS) out[k] = resolve(TABLE[k], s[k]);
  out.crimson = FOREST.crimson;
  for (const k of ['snow', 'south', 'blossom', 'autumn', 'bare', 'cloud', 'rain', 'snowfall', 'petals', 'fall', 'thunder']) out[k] = s[k];
  return out;
}

// Shared uniforms of every season-patched material.
const vec3s = (n) => Array.from({ length: n }, () => new THREE.Color());
export const U = {
  uGrass: { value: vec3s(5) }, uForest: { value: vec3s(5) }, uFarm: { value: vec3s(5) }, uLeaf: { value: vec3s(5) }, uCrimson: { value: vec3s(5) },
  uSouthG: { value: GRASS.subtropic }, uSouthF: { value: FOREST.subtropic }, uSouth: { value: 0 },
  // uSnowFar: how far north the summer line (44, past the original board's 43°N) moves when the table reaches further (the japan
  // region's boards to 46°N, sandregions.js); 0 without it, so a game without such a pack is as before.
  uSnowLat: { value: 44 }, uSnowFar: { value: 0 }, uBlossom: { value: 0 }, uAutumn: { value: 0 }, uBare: { value: 0 }, uCloud: { value: 0.25 }, uWet: { value: 0 }, uTime: { value: 0 },
};
U.uCrimson.value.forEach((c, i) => c.copy(FOREST.crimson[i]));

// Where a patched material sits. The strategy map reads latitude from world z (31.5 − z) and its heights
// are small; a battle scene is one place, so it fixes the latitude (the battle city's seat) and scales
// the height and patch noise to its own units.
// snowMax: how much of the ground snow may cover at most — a battle board keeps some ground showing
// through so plain, sand and rock stay legible. calm (0…1): the war map's quieter board (A2) — texel
// contrast pulled toward each tile's mean, colour a little less saturated, one autumn hue per wood, snow in
// solid drifts rather than dithered specks; bloom scales the spring blossom on trees (0: none). stage:
// the board's world rectangle [x0, z0, x1, z1]: trees and rocks beyond it dim as the ground there does.
export const STRATEGY_PLACE = { lat: 0, snowH: 2.6, patch: 1.6, snowMax: 1 };
const placeUniforms = (p = STRATEGY_PLACE) => ({ uLatFix: { value: p.lat ?? 0 }, uSnowH: { value: p.snowH ?? 2.6 }, uPatch: { value: p.patch ?? 1.6 }, uSnowMax: { value: p.snowMax ?? 1 },
  uCalm: { value: p.calm ?? 0 }, uBloom: { value: p.bloom ?? 1 }, uStage: { value: new THREE.Vector4(...(p.stage ?? [0, 0, 0, 0])) } });

// GLSL shared by every patched material: hash/value noise, a 4×4 Bayer step, the latitude of a point,
// and the snow cover there — north of the snow line, reached sooner on high ground, ragged.
export const SEASON_GLSL = /* glsl */`
uniform float uSnowLat, uSnowFar, uBlossom, uAutumn, uBare, uCloud, uWet, uTime, uSouth, uLatFix, uSnowH, uPatch, uSnowMax, uCalm, uBloom;
uniform vec4 uStage;
uniform vec3 uSouthG[5], uSouthF[5];
float s_lat(vec3 w) { return uLatFix > 0. ? uLatFix : 31.5 - w.z; }
// How far south a point is (1 below ~26°N), for the evergreen far south.
float s_south(vec3 w) { return smoothstep(29.5, 25.5, s_lat(w)); }
float s_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float s_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(s_hash(i), s_hash(i + vec2(1., 0.)), f.x), mix(s_hash(i + vec2(0., 1.)), s_hash(i + vec2(1., 1.)), f.x), f.y); }
float s_bayer(vec2 p) { vec2 q = mod(floor(p), 4.); int i = int(q.x) + int(q.y) * 4;
  float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.); return (B[i] + .5) / 16.; }
float s_snow(vec3 w, float rag) { float l = uSnowLat + uSnowFar * smoothstep(42., 44., uSnowLat); return smoothstep(l - .45, l + .45, s_lat(w) + max(0., w.y - .3) * uSnowH + (rag - .5) * 1.5); }
vec3 s_ramp(vec3 c[5], float t) { t = clamp(t, 0., 1.) * 4.; int i = int(min(t, 3.)); return mix(c[i], c[i + 1], t - float(i)); }
vec3 s_snowCol(float lum) { return mix(vec3(.62, .70, .80), vec3(.97, .98, 1.), clamp(lum * 2.2 + .25, 0., 1.)); }
// The dither step a snow edge is cut at: per texel on the strategy map, a clean edge on a calm board.
float s_cut(vec2 p, float lo, float span) { return mix(s_bayer(p) * span + lo, lo + span * .5, uCalm); }
vec3 s_quiet(vec3 c, float k) { float l = dot(c, vec3(.2126, .7152, .0722)); return mix(c, vec3(l), k * uCalm); }
// Light beyond the board (uStage set): a step down at its edge, then a slow fade, as warview.js shades the apron.
float s_stage(vec3 w) {
  if (uStage.z <= uStage.x) return 1.;
  float d = max(max(uStage.x - w.x, w.x - uStage.z), max(uStage.y - w.z, w.z - uStage.w));
  return d <= 0. ? 1. : mix(1., max(.15, .27 - max(0., d - 1.) * .03), smoothstep(0., .35, d));
}
// The war map's ground under the month (calm): grass keeps an olive cast, so a plain still reads as a plain
// beside sand and rock in autumn and winter.
vec3 s_field(vec3 c, float t) { return mix(c, mix(vec3(.13, .165, .075), vec3(.35, .39, .2), t), .65 * uCalm); }
`;
const FRAG_HEAD = `uniform vec3 uGrass[5], uForest[5], uFarm[5], uLeaf[5], uCrimson[5];\n${SEASON_GLSL}`;
const declare = (sh, extra = '', place) => {
  Object.assign(sh.uniforms, U, placeUniforms(place));
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_HEAD}${extra}`);
};

// Ground (worldmap.js): mask = R grass, G forest, B farm weights, A the texel's tone in its ramp.
// Vegetation takes the month's ramps (autumn woods in patches of amber and crimson, the odd evergreen
// stand), snow falls in dithered texels north of the line, rain darkens and glosses, and slow cloud
// shadows drift across. Expects vWPos / vWNrm and runs right after the map is sampled into
// sampledDiffuseColor.
export function groundChunk() {
  return /* glsl */`
    {
      vec2 tc = floor(vMapUv * uTexSize);
      vec4 msk = texture2D(uMask, vMapUv); // rows written bottom-up to match the canvas texture's flipY
      float vw = msk.r + msk.g + msk.b;
      vec3 base = sampledDiffuseColor.rgb;
      if (vw > .02 && wn.y >= .6) {
        float t = msk.a, patchN = s_noise(floor(tc / 6.) * .37), sth = s_south(vWPos) * uSouth;
        vec3 forest = s_ramp(uForest, t);
        float woods = s_noise(vWPos.xz * uPatch);
        forest = mix(forest, s_ramp(uCrimson, t), uAutumn * step(.62, woods));
        forest = mix(forest, s_ramp(uLeaf, t) * .8, uAutumn * step(woods, .22)); // evergreen stands keep green
        forest = mix(forest, s_ramp(uSouthF, t), sth);
        vec3 grass = mix(s_ramp(uGrass, t + (patchN - .5) * .12), s_ramp(uSouthG, t + (patchN - .5) * .12), sth);
        vec3 veg = (grass * msk.r + forest * msk.g + s_ramp(uFarm, t) * msk.b) / vw;
        sampledDiffuseColor.rgb = mix(base, veg, clamp(vw, 0., 1.));
      }
      float lum = dot(sampledDiffuseColor.rgb, vec3(.2126, .7152, .0722));
      float rag = s_noise(tc / 7.) * .7 + s_noise(tc / 23.) * .3;
      float cover = s_snow(vWPos, rag) * smoothstep(.3, .7, wn.y);
      if (cover > s_bayer(tc) * .96 + .02) sampledDiffuseColor.rgb = s_snowCol(lum) * (wn.y < .6 ? .9 : 1.);
      sampledDiffuseColor.rgb *= 1. - uWet * .16;
      float cs = smoothstep(.5, .74, s_noise(vWPos.xz * .07 + vec2(uTime * .018, uTime * .007)) * .65 + s_noise(vWPos.xz * .19 + vec2(uTime * .03, 0.)) * .35);
      sampledDiffuseColor.rgb *= 1. - uCloud * .42 * cs;
    }`;
}
export function patchGround(sh, mask, w, h) {
  declare(sh, 'uniform sampler2D uMask; uniform vec2 uTexSize;\n');
  sh.uniforms.uMask = { value: mask }; sh.uniforms.uTexSize = { value: new THREE.Vector2(w, h) };
  sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .38, uWet);');
}

// ---------- Patches for set pieces, trees, sprites, tiles and water ----------
// Every patch adds the same varyings: vWP (world position), vWNs (world normal) and vTree (the instance's or
// object's origin, the "where" of a tree or sprite). It runs after any patch the material already has
// (skyLit billboards, the 白兵 troop light) and keys its program on both.
const VERT_HEAD = 'uniform float uBroad, uBare, uSouth, uLatFix; varying vec3 vTree; varying vec3 vWNs; varying vec3 vWP;';
const VERT_BEGIN = `
  #ifdef USE_INSTANCING
    vTree = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
  #else
    vTree = (modelMatrix * vec4(0., 0., 0., 1.)).xyz;
  #endif`;
const VERT_WORLD = `
  vec4 sWP = vec4(transformed, 1.);
  #ifdef USE_INSTANCING
    sWP = instanceMatrix * sWP;
    vWNs = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  #else
    vWNs = normalize(mat3(modelMatrix) * objectNormal);
  #endif
  vWP = (modelMatrix * sWP).xyz;`;
// Broadleaf crowns thin to a smaller crown of bare twigs in winter (not in the evergreen south).
const VERT_BARE = `
  float bareK = uBare * uBroad * step(.4, transformed.y) * (1. - uSouth * smoothstep(29.5, 25.5, uLatFix > 0. ? uLatFix : 31.5 - vTree.z));
  transformed = mix(transformed, vec3(0., .66, 0.) + (transformed - vec3(0., .66, 0.)) * vec3(.62, .7, .62), bareK);`;
function patch(material, key, place, extra, body, { bare = false, uniforms = {} } = {}) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = (sh, renderer) => {
    prev.call(material, sh, renderer);
    declare(sh, `uniform float uBroad; varying vec3 vTree; varying vec3 vWNs; varying vec3 vWP;\n${extra}`, place);
    Object.assign(sh.uniforms, { uBroad: { value: 0 } }, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BEGIN}${bare ? VERT_BARE : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERT_WORLD}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n{\n${body}\n}`);
  };
  material.customProgramCacheKey = () => `${prevKey}|season:${key}`;
  material.needsUpdate = true;
  return material;
}
const LUM = 'float lum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));';
// Leaves of a broadleaf at tone t, picked per tree by seed: autumn amber / crimson / gold, spring blossom,
// evergreen in the far south.
const LEAF_GLSL = `
  vec3 s_leaf(float t, float seed, vec3 at) {
    float sth = s_south(at) * uSouth;
    vec3 leaf = s_ramp(uLeaf, t);
    float aseed = mix(seed, .45 + (seed - .5) * .2, uCalm); // calm: most woods turn the same amber
    vec3 au = aseed < .34 ? mix(vec3(.55, .16, .06), vec3(.95, .42, .14), t) : aseed < .62 ? mix(vec3(.6, .3, .06), vec3(1., .66, .2), t) : aseed < .82 ? mix(vec3(.55, .44, .08), vec3(.98, .84, .3), t) : leaf;
    au = mix(au, mix(vec3(.2, .045, .015), vec3(.5, .15, .035), t), .7 * uCalm); // calm: deeper russet, not pale gold
    leaf = mix(leaf, au, uAutumn * (1. - sth));
    leaf = mix(leaf, mix(vec3(.13, .26, .09), vec3(.38, .56, .22), t), sth * uBare);
    float bl = (seed < uBlossom * uBloom * .32 ? 1. : 0.) * step(s_lat(at), 38.5); // strict: a seed of exactly 0 must not bloom in a month without blossom
    vec3 pink = seed < uBlossom * .16 ? mix(vec3(.86, .5, .6), vec3(1., .86, .9), t) : mix(vec3(.84, .84, .86), vec3(1.), t);
    return mix(leaf, pink, bl * (1. - uBare));
  }`;

// Trees (structures.js plantTrees): broadleaf crowns take the month's leaves — peach and plum blossom in
// spring (south of the 黄河), amber, crimson and gold per tree in autumn, thinning to a smaller crown of
// bare twigs in winter; pines only darken. Snow settles on what faces up where the snow line has passed.
// kind: 'broad' | 'pine' | 'trunk'.
export function seasonalTree(material, kind, place) {
  const broad = kind === 'broad' ? 1 : 0;
  return patch(cloneMat(material), `tree${broad}`, place, LEAF_GLSL, `
    ${LUM}
    vec3 c = diffuseColor.rgb;
    float t = clamp((sqrt(lum) - .14) / .42, 0., 1.), seed = s_hash(floor(vTree.xz * 37.));
    t = mix(t, .5, .45 * uCalm);
    if (uBroad > .5) c = s_leaf(t, seed, vTree) * mix(1., .7, uCalm); // calm: a wood sits a step darker than the open field
    else c = mix(c, c * vec3(.86, .92, .96), uBare * .5);
    float cover = s_snow(vTree, seed) * smoothstep(mix(.15, .5, uCalm), mix(.6, .85, uCalm), vWNs.y);
    if (cover > s_cut(gl_FragCoord.xy, .05, .9)) c = s_snowCol(lum + .1);
    diffuseColor.rgb = s_quiet(c, .16) * s_stage(vTree);`, { bare: true, uniforms: { uBroad: { value: broad } } });
}
// Roofs, wall tops, rocks and any other set piece: snow settles on the up-facing surfaces.
export function seasonalRoof(material, place) {
  return patch(material, 'snow', place, '', `
    float cover = s_snow(vWP, .5) * smoothstep(.35, .7, vWNs.y);
    if (cover > s_bayer(gl_FragCoord.xy) * .85 + .1) diffuseColor.rgb = s_snowCol(.45);
    diffuseColor.rgb *= s_stage(vWP);`);
}
// Rivers and lakes freeze north of the snow line: pale ice with the water's pattern showing as cracks.
export function seasonalWater(material, place) {
  return patch(material, 'water', place, '', `
    float ice = smoothstep(.4, .7, s_snow(vWP + vec3(0., .4, 0.), .5));
    ${LUM}
    vec3 iceCol = mix(mix(vec3(.55, .68, .78), vec3(.86, .92, .96), clamp(lum * 3., 0., 1.)), mix(vec3(.11, .21, .33), vec3(.28, .4, .54), clamp(lum * 3., 0., 1.)), uCalm); // calm: steel-blue ice, apart from the snow
    diffuseColor.rgb = mix(diffuseColor.rgb, iceCol, ice) * s_stage(vWP);
    diffuseColor.a = mix(diffuseColor.a, .97, ice);`);
}
// The sand-table board (sandtable.js) keeps its painted colours: a month tints them by how far its palette has
// moved from 季春's, the month the board was painted in (mid tones of each ramp).
const REF = stateOf(2);
export const SAND_REF = { grass: REF.grass[2], forest: REF.forest[2], farm: REF.farm[2], leaf: REF.leaf[2].clone().multiply(new THREE.Color().setRGB(...SAND_LEAF_REF_SCALE)) };
// Its Tripo set pieces: leaves ('broad') take the month's tint per tree (blossom, autumn colours, the evergreen
// south), pines only darken; snow settles in soft drifts on what faces up, by the same line as the ground.
export function seasonalPiece(material, kind) {
  const range = kind === 'range' ? 1 : 0, broad = kind === 'broad' || range ? 1 : 0, pine = kind === 'pine' ? 1 : 0;
  return patch(cloneMat(material), `piece${broad}${pine}${range}`, undefined, `uniform vec3 uRefL; uniform float uPine, uRange;${LEAF_GLSL}`, `
    ${LUM}
    vec3 c = diffuseColor.rgb;
    float seed = s_hash(floor(vTree.xz * 37.));
    if (uBroad > .5) {
      // Leaves (olive-to-green texels, not the trunk): the month's leaf for this tree; far from 季春 (autumn red and
      // gold, blossom) the crown takes that colour outright at the texel's brightness.
      vec3 now = s_leaf(.5, seed, vTree);
      float away = clamp(length(now - uRefL) * 3., 0., 1.), lr = dot(uRefL, vec3(.2126, .7152, .0722));
      vec3 leaf = mix(c * clamp(sqrt(now / uRefL), .5, 1.8), lum / lr * now * (1. + .45 * uAutumn), away); // autumn crowns glow
      float green = c.g - max(c.r * mix(.6, .8, uRange), c.b);
      c = mix(c, leaf, uRange > .5 ? smoothstep(.005, .035, green) : smoothstep(-.004, .006, green)); // keep the ranges' grey rock out of the leaf ramp
    }
    if (uPine > .5) c = mix(c, c * vec3(.86, .92, .96), uBare * .5);
    c = max(mix(vec3(dot(c, vec3(.2126, .7152, .0722))), c, 1.3), 0.); // the board's fuller colour
    float cover = s_snow(uBroad + uPine > .5 && uRange < .5 ? vTree : vWP, s_noise(vWP.xz * 9.) * .6 + seed * .4) * smoothstep(.3, .75, vWNs.y);
    c = mix(c, s_snowCol(lum + .2) * .96, smoothstep(.4, .72, cover));
    diffuseColor.rgb = c;`, { uniforms: { uBroad: { value: broad }, uPine: { value: pine }, uRange: { value: range }, uRefL: { value: SAND_REF.leaf } } });
}
// Battle ground tiles (diorama.js buildTerrain): grass and forest floor take the month's ramps by their
// tone in the tile (uTone: darkest sRGB luminance, span), snow comes in dithered world-space texels (32 per
// unit, as the tiles), cloud shadows drift over; other tops only take the snow. On the side faces ('lip',
// and the sides of a grass or forest block) only the overhanging grass lip follows the month.
export function seasonalTile(material, kind, place, tone = [0, 255]) {
  const veg = kind === 'grass' ? 1 : kind === 'forest' ? 2 : kind === 'lip' ? 3 : kind === 'hill' ? 4 : 0;
  // calm: open grass takes a fuller cover, sand a thinner one (it blows clear), so the kinds stay apart in snow.
  const snowK = kind === 'grass' ? 1.24 : kind === 'sand' ? 0.5 : kind === 'stone' ? 0.3 : 1; // a castle's paving is kept swept
  return patch(material, `tile${veg}`, place, 'uniform float uVeg, uSnowK, uDry; uniform vec2 uTone; uniform vec3 uMean;', `
    vec2 tc = floor(vWP.xz * 32.);
    diffuseColor.rgb = mix(diffuseColor.rgb, uMean, .55 * uCalm * step(uVeg, 3.5)); // calm: the texel pattern at under half strength (a hill keeps its rock)
    ${LUM}
    if (uVeg > .5 && uVeg < 2.5 && vWNs.y > .6) {
      float t = clamp((pow(lum, 1. / 2.2) * 255. - uTone.x) / uTone.y, 0., 1.), sth = s_south(vWP) * uSouth;
      t = mix(t, .5, .25 * uCalm);
      vec3 c;
      if (uVeg < 1.5) c = s_field(mix(s_ramp(uGrass, t + (s_noise(tc / 40.) - .5) * .12), s_ramp(uSouthG, t), sth), t);
      else {
        float woods = s_noise(vWP.xz * uPatch);
        c = mix(s_ramp(uForest, t), s_ramp(uCrimson, t), uAutumn * step(.62, woods));
        c = mix(c, s_ramp(uLeaf, t) * .8, uAutumn * step(woods, .22));
        c = mix(c, s_ramp(uSouthF, t), sth);
      }
      diffuseColor.rgb = c;
      lum = dot(c, vec3(.2126, .7152, .0722));
    } else if (uVeg > 3.5) {
      // A hill (the war map, A2, after the concept's rock outcrops): textured weathered stone on its steep sides,
      // the month's grass, a shade darker, on the gentle tops and around the foot.
      float t = clamp((pow(lum, 1. / 2.2) * 255. - uTone.x) / uTone.y, 0., 1.), sth = s_south(vWP) * uSouth;
      vec3 g = s_field(mix(s_ramp(uGrass, mix(t, .45, .5) * .8), s_ramp(uSouthG, t * .8), sth), .3) * .85;
      vec3 orig = diffuseColor.rgb; // the rock texel, with the baked light (a hill keeps its texture: no uMean pull)
      orig = mix(orig, vec3(dot(orig, vec3(.2126, .7152, .0722))), .8 * uCalm); // calm: the texture's moss goes grey, not lime once brightened
      float strata = .8 + .4 * s_noise(vec2(vWP.y * 11., (vWP.x + vWP.z) * 1.3)); // bedding lines across the face
      vec3 stone = mix(orig, orig * vec3(.92, .95, 1.03) * strata * 2.3, uCalm); // calm: cool slate, banded: warm fields, cool hills in every season
      float steep = 1. - smoothstep(mix(.45, .62, uCalm), mix(.8, .9, uCalm), vWNs.y + (s_noise(vWP.xz * 4.) - .5) * .12);
      float high = smoothstep(.62, 1.02, vWP.y + (s_noise(vWP.xz * 3.1) - .5) * .32) * smoothstep(.2, .6, vWNs.y + .1) * (1. - uCalm);
      float scree = smoothstep(.35, .65, s_noise(vWP.xz * 2.3)) * .7 * uCalm; // calm: the tops stony too, so a hill reads as one lighter mass
      float rocky = max(max(high, steep), scree);
      rocky = mix(rocky, smoothstep(.36, .52, vWP.y + (s_noise(vWP.xz * 5.) - .5) * .1), uCalm); // calm: one rock mass, grass only round the foot
      diffuseColor.rgb = mix(g, stone, rocky);
      lum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    } else if (uDry > 1.5) {
      diffuseColor.rgb *= mix(vec3(1.), vec3(.8, .84, .92), uCalm); // calm: a castle's paving a cool grey, apart from sand
    } else if (uDry > .5) {
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.6, .47, .27) * (.8 + lum * .8), .5 * uCalm); // calm: pale dry sand, lighter than any field
    } else if (uVeg > .5 && diffuseColor.g > diffuseColor.r * 1.02 && diffuseColor.g > diffuseColor.b * 1.1) {
      diffuseColor.rgb = mix(s_ramp(uGrass, clamp((sqrt(lum) - .1) / .5, 0., 1.)), s_ramp(uSouthG, clamp((sqrt(lum) - .1) / .5, 0., 1.)), s_south(vWP) * uSouth);
    }
    float rag = mix(s_noise(tc / 7.) * .7 + s_noise(tc / 23.) * .3, s_noise(tc / 40.) * .7 + s_noise(tc / 90.) * .3, uCalm); // calm: soft edges, no specks
    // Bare ground breaks through between drifts (coarse noise, ragged edge), so plain, sand and rock stay
    // readable under the snow; uSnowMax sets how much stays white (1 on the strategy map: no gaps).
    float drift = mix(s_noise(tc / 21.) * .65 + s_noise(tc / 6.) * .35, s_noise(tc / 96.) * .85 + s_noise(tc / 34.) * .15, uCalm); // calm: broad drifts, no speckle
    float gap = (1. - min(1., uSnowMax * mix(1., uSnowK, uCalm))) * 1.5;
    float cover = s_snow(vWP, rag) * smoothstep(.3, .7, vWNs.y) * smoothstep(gap - .06, gap + .06, drift) * (uVeg > .5 ? 1. : .9);
    if (uVeg > 3.5) cover *= (1. - .75 * uCalm * smoothstep(.92, .6, vWNs.y + rag * .2)) * mix(1., .42, uCalm); // calm: wind-scoured slopes show rock
    if (cover > s_cut(tc, .02, .96)) diffuseColor.rgb = s_snowCol(mix(lum, .4, .6 * uCalm)) * mix(mix(.86, 1., s_noise(tc / 11.)), .95, uCalm) * sqrt(s_stage(vWP)); // snow, the brightest ground, dims a little more past the board
    diffuseColor.rgb = s_quiet(diffuseColor.rgb, .3);
    diffuseColor.rgb *= 1. - uWet * .16;
    float cs = smoothstep(.5, .74, s_noise(vWP.xz * .05 + vec2(uTime * .02, uTime * .008)) * .65 + s_noise(vWP.xz * .13 + vec2(uTime * .035, 0.)) * .35);
    diffuseColor.rgb *= 1. - uCloud * .38 * cs * (1. - .75 * uCalm); // calm: drifting shade must not change how a terrain reads
`, { uniforms: { uVeg: { value: veg }, uSnowK: { value: snowK }, uDry: { value: kind === 'sand' ? 1 : kind === 'stone' ? 2 : 0 }, uTone: { value: new THREE.Vector2(tone[0], Math.max(1, tone[1])) }, uMean: { value: new THREE.Color(...(tone[2] ?? [0.5, 0.5, 0.5])) } } });
}
// Flat foliage sprites (bushes, grass tufts, reeds, the 单挑 trees): their green texels take the month —
// leaves like the 3D trees ('leaf'), or the grass ramp ('grass'); flowers and earth keep their colour.
// Snow whitens the upper part of each sprite.
export function seasonalSprite(material, kind, place) {
  const leaf = kind === 'leaf' ? 1 : 0;
  return patch(material, `sprite${leaf}`, place, `uniform float uLeafy;${LEAF_GLSL}`, `
    vec3 c = diffuseColor.rgb;
    ${LUM}
    float seed = s_hash(floor(vTree.xz * 37.) + vec2(.5)); // one pick per sprite (its origin), so a crown never splits
    if (c.g > c.r * 1.02 && c.g > c.b * 1.1) {
      float t = clamp((sqrt(lum) - .1) / .5, 0., 1.);
      c = uLeafy > .5 ? s_leaf(t, seed, vTree) : mix(s_ramp(uGrass, t), s_ramp(uSouthG, t), s_south(vTree) * uSouth);
    }
    #ifdef USE_MAP
      float up = smoothstep(.35, .8, vMapUv.y);
    #else
      float up = 1.;
    #endif
    float cover = s_snow(vTree, seed) * up;
    if (cover > s_cut(gl_FragCoord.xy, .05, .9)) c = s_snowCol(lum + .15);
    diffuseColor.rgb = s_quiet(c, .16);`, { uniforms: { uLeafy: { value: leaf } } });
}

// Patch everything under root for a battle scene at `place`: ground tiles (userData.tile), trees
// (userData.tree), foliage sprites (userData.foliage), water (userData.water); every other lit mesh takes
// snow on what faces up. Materials are cloned once each; userData.noSeason opts a mesh out.
const tones = new Map();
function toneOf(tex) {
  if (!tones.has(tex)) {
    const c = tex?.userData?.canvas;
    if (!c) tones.set(tex, [0, 255]);
    else {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lo = 255, hi = 0; const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); for (let k = 0; k < 3; k++) sum[k] += d[i + k]; }
      const n = d.length / 4, lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      tones.set(tex, [lo, hi - lo, sum.map((v) => lin(v / n))]); // the mean in linear light, as the shader sees the texels
    }
  }
  return tones.get(tex);
}
// material.clone() drops an instance's own shader hook (skyLit, troopLit); keep it on the copy.
function cloneMat(m) {
  const c = m.clone();
  if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) c.onBeforeCompile = m.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}
export function seasonalize(root, place) {
  const done = new Map();
  const variant = (m, o) => {
    if (!m?.isMeshStandardMaterial || m.userData.season) return m;
    const u = o.userData, key = `${m.uuid}|${u.tile || u.tree || u.foliage || (u.water ? 'water' : 'snow')}`;
    if (done.has(key)) return done.get(key);
    let out;
    if (u.tree) out = seasonalTree(m, u.tree, place);
    else if (u.tile) out = seasonalTile(cloneMat(m), u.tile, place, toneOf(m.map));
    else if (u.foliage) out = seasonalSprite(cloneMat(m), u.foliage, place);
    else if (u.water) out = seasonalWater(cloneMat(m), place);
    else out = seasonalRoof(cloneMat(m), place);
    out.userData.season = true; done.set(key, out); return out;
  };
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noSeason) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => variant(m, o)) : variant(o.material, o);
  });
}

// A month's light and weather for a battle scene (no tween: a battle stays in one month).
export function lookOf(m) {
  const s = stateOf(m), l = s.light;
  return { sun: l.sun.clone(), si: l.si, back: l.back.clone(), hemi: l.hemi.clone(), hg: l.hg.clone(), hi: l.hi, fog: l.fog.clone(), puff: l.puff.clone(), sky: l.sky.map((c) => c.clone()),
    rain: s.rain, snowfall: s.snowfall, petals: s.petals, fall: s.fall, thunder: s.thunder };
}
// Paint a 1×64 sky gradient texture (canvasTex) from four colours: top, upper, horizon, below.
export function paintSky(tex, [top, up, hor, low]) {
  const g = tex.userData.canvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64), css = (c) => `#${c.getHexString(THREE.SRGBColorSpace)}`;
  gr.addColorStop(0, css(top)); gr.addColorStop(0.45, css(up)); gr.addColorStop(0.78, css(hor)); gr.addColorStop(1, css(low));
  g.fillStyle = gr; g.fillRect(0, 0, 1, 64); tex.needsUpdate = true;
}

// Tween between months: setMonth(m) eases from where the uniforms are now to month m over `secs`.
export function createSeasons(start = 2) {
  let from = stateOf(start), to = from, k = 1, dur = 1, month = start;
  // The tween writes into cur.light, so it and every snapshot own their colours and vectors: a shallow
  // copy would write through into LIGHTS and change a preset for the rest of the game.
  const cloneLight = (l) => ({ ...l, ...Object.fromEntries(['sun', 'back', 'hemi', 'hg', 'fog', 'puff', 'dir'].map((k) => [k, l[k].clone()])), sky: l.sky.map((c) => c.clone()) });
  const cur = { light: cloneLight(from.light) };
  const lerpC = (a, b, t, out) => out.copy(a).lerp(b, t);
  const apply = (t) => {
    for (const [key, u] of [['grass', 'uGrass'], ['forest', 'uForest'], ['farm', 'uFarm'], ['leaf', 'uLeaf']]) U[u].value.forEach((c, i) => lerpC(from[key][i], to[key][i], t, c));
    U.uSnowLat.value = THREE.MathUtils.lerp(from.snow, to.snow, t); U.uSouth.value = THREE.MathUtils.lerp(from.south, to.south, t);
    for (const [key, u] of [['blossom', 'uBlossom'], ['autumn', 'uAutumn'], ['bare', 'uBare'], ['cloud', 'uCloud']]) U[u].value = THREE.MathUtils.lerp(from[key], to[key], t);
    U.uWet.value = THREE.MathUtils.lerp(Math.min(1, from.rain * 1.2), Math.min(1, to.rain * 1.2), t);
    const a = from.light, b = to.light, l = cur.light;
    for (const key of ['sun', 'back', 'hemi', 'hg', 'fog', 'puff']) lerpC(a[key], b[key], t, l[key]);
    l.si = THREE.MathUtils.lerp(a.si, b.si, t); l.hi = THREE.MathUtils.lerp(a.hi, b.hi, t);
    l.dir.copy(a.dir).lerp(b.dir, t).normalize();
    l.sky.forEach((c, i) => lerpC(a.sky[i], b.sky[i], t, c));
    for (const key of ['rain', 'snowfall', 'petals', 'fall', 'thunder']) cur[key] = THREE.MathUtils.lerp(from[key], to[key], t);
  };
  apply(1);
  const api = {
    get month() { return month; },
    cur,
    setMonth(m, secs = 2.5) {
      if (m === month && k >= 1 && secs) return false; // a jump always lands: the uniforms are shared, and another map's tween may have left them elsewhere
      // Start from what is on screen now, so a change mid-tween stays smooth.
      const now = stateOf(month); now.light = cloneLight(cur.light);
      for (const key of KEYS) now[key] = U[{ grass: 'uGrass', forest: 'uForest', farm: 'uFarm', leaf: 'uLeaf' }[key]].value.map((c) => c.clone());
      now.snow = U.uSnowLat.value; now.south = U.uSouth.value; now.blossom = U.uBlossom.value; now.autumn = U.uAutumn.value; now.bare = U.uBare.value; now.cloud = U.uCloud.value;
      for (const key of ['rain', 'snowfall', 'petals', 'fall', 'thunder']) now[key] = cur[key];
      from = now; to = stateOf(m); month = m; dur = Math.max(0.001, secs); k = secs ? 0 : 1; apply(k);
      return true;
    },
    // Returns true while the colours are still moving (callers repaint the sky).
    update(dt, time) {
      U.uTime.value = time;
      if (k >= 1) return false;
      k = Math.min(1, k + dt / dur); apply(k * k * (3 - 2 * k)); return true;
    },
  };
  return api;
}
