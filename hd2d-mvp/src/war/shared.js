// What the war map's modules (src/war/, split out of src/warview.js) share at module level: constants, small helpers, and the
// named exports src/warview.js has always given (woodsOf, tween, GREY_LIGHTS, SUN_CLEAR, SUN_K, keySun, STRAT_SCENE, STRAT_FX), which it
// re-exports from here. They live here and not in src/warview.js so a module never imports the entry that imports it.
import * as THREE from 'three';
import { MONTHS, lookOf } from '../seasons.js';
import { W, H } from '../core/field.js';

export const WATER_Y = 0.2;
// The four corner views (the board turns a quarter at a time on Q / E), the tilt they share, and the straight-down tilt of the
// tactical overview (Tab).
export const YAWS = [1, 3, 5, 7].map((k) => k * Math.PI / 4), PITCH = 0.663, TOP_PITCH = 1.55, TURN_MS = 350, EDGE = 3; // EDGE: how far past the board's edge the view may show (cells)
// The battle is fought on the 3D diorama; ctx.flat (the 低 preset, or ?flat) gives the painted 2D map (src/warmap2d.js) instead.
// The painted board (src/warplate.js): terrain → material, and the board plate's margin (cells) and density.
export const KIND = ['forest', 'sand', 'grass', 'river', 'hill', 'castle'], PLATE_M = 2, PLATE_PX = 72;

// Painted woods (A2): four crowns to a forest cell, one in each corner so neighbouring cells close into one
// canopy, the odd conifer; the row in front of the castle low; the odd lone tree on open ground; two
// to a cell in the country around, dimmed with its ground.
// A crown is a picture stood up on its foot, so it must not reach north (away from the camera) past half the next cell: a hill
// there stands a low mesa (0.35 above the ground at its rim, 0.6 in a range's core: ./heights.js) and the crown would pierce its face. size is clamped to what that allows.
export const NORTH_REACH = 0.5;
// A general's picture and base mark this stencil bit, so a range cell's see-through rim (markGhost) is never drawn over him.
export const FIGURE_STENCIL = 2;
export const markFigure = (m) => Object.assign(m, { stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilWriteMask: FIGURE_STENCIL, stencilFunc: THREE.AlwaysStencilFunc,
  stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp });
export function woodsOf(S, r) {
  const out = [], j = (k) => (r() - 0.5) * k;
  const tree = (c, x, z, size, extra = {}) => out.push({ x, z, h: c.h, size: Math.min(size, 2 * (z - (c.z - 0.5 - NORTH_REACH))), ...extra });
  for (const c of S.forests) {
    const ahead = S.castle && Math.abs(c.x - S.castle.x) < 1.6 && c.z > S.castle.z + 0.5 && c.z < S.castle.z + 2.6;
    if (ahead) { tree(c, c.x + j(0.3), c.z + 0.2, 0.7); continue; }
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tree(c, c.x + a * 0.25 + j(0.14), c.z + b * 0.25 + j(0.14), 1.05 + r() * 0.3, { pine: r() < 0.12 });
  }
  for (const c of S.plains) if (Math.abs(c.x) < W / 2 && Math.abs(c.z) < H / 2 && r() < 0.02) tree(c, c.x + j(0.5), c.z + j(0.5), 0.8 + r() * 0.25);
  for (const c of S.wildForests) for (let i = 0; i < 3; i++) tree(c, c.x + j(0.9), c.z + j(0.9), 1 + r() * 0.3, { pine: r() < 0.3, shade: c.shade });
  return out;
}
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function tween(ms, f) {
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); f(k); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
}

// The war map's key light for a month: a pale warm late-afternoon sun (SUN_CLEAR) at the month's own strength on a clear day (the
// brief's #ffbe78 pushed grass to olive and the mesas to orange, so it is paler), the month's own colour in the grey months.
export const GREY_LIGHTS = ['rain', 'storm', 'snow'], SUN_CLEAR = '#ffe3c4', SUN_K = 0.95;
// How much of the month's rain and lightning the war map draws (weather.js createWeather): see board.js.
export const WAR_RAIN = { rain: { n: 0.4, alpha: 0.5, len: 0.6 }, flashK: 0.3 };
export function keySun(month) {
  const look = lookOf(month);
  return { color: GREY_LIGHTS.includes(MONTHS[month].light) ? look.sun : new THREE.Color(SUN_CLEAR), intensity: look.si * SUN_K };
}

// Scene-switch phases for tools/scene_switch_trace.mjs (PERF-05): performance.measure only, no effect on the game.
export const phase = (name, t0) => { performance.measure(name, { start: t0 }); return performance.now(); };

// 计略演出: each 计略 has its own framed picture (tools/vignette_prompts.mjs st-*) and its own effect on the
// board (src/fx.js STRATEGY_FX), by 计略 id (core/field.js STRATS). Also read by tests/war.test.mjs.
export const STRAT_SCENE = ['st-fire', 'st-trap', 'st-ruse', 'st-ambush', 'st-rapids', 'st-firearrow', 'st-feint', 'st-strife',
  'st-lure', 'st-rock', 'st-chain', 'st-encircle', 'st-water', 'st-bow', 'st-firestorm', 'st-magic'];
// The cast phrase by 计略 id: the original's four (bank26 \$D751 by animation number, research/music-cues-evidence.md
// §5): 136 火计 乱水 火箭 伪击转杀 水攻 连弩 劫火; 141 虚兵 要击 共杀 连环 十面埋伏; 145 笼络; 149 陷阱 落石 奇门遁甲.
export const STRAT_CUE = ['cue-st-fire', 'cue-st-trap', 'cue-st-ruse', 'cue-st-ruse', 'cue-st-fire', 'cue-st-fire', 'cue-st-fire', 'cue-st-ruse',
  'cue-st-lure', 'cue-st-trap', 'cue-st-ruse', 'cue-st-ruse', 'cue-st-fire', 'cue-st-fire', 'cue-st-fire', 'cue-st-trap'];
export const STRAT_FX = ['fire', 'pit', 'phantom', 'ambush', 'rapids', 'firearrows', 'feint', 'strife',
  'lure', 'rocks', 'chain', 'encircle', 'flood', 'bolts', 'firestorm', 'qimen'];
