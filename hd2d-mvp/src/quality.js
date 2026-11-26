// Picture quality presets (系统 → 画质), remembered across sessions.
//   高: as designed — pixel ratio up to 2, occlusion at full size (half on a dense screen), full shadow maps.
//   中: pixel ratio up to 1.5 and occlusion always at half size; on a Retina canvas about half the pixels.
//   高 and 中 also hold the 3D canvas to a count of pixels (PRESETS.pixels), whatever the window: the frame's cost is its
//   pixels (the occlusion, depth of field and bloom are all full-screen passes), and a ratio alone left a 4K screen at 2×
//   drawing 8.3 M pixels at 高 and 4.7 M at 中, 21–26 and 33–40 frames a second on an M4 (2026-11-14). Never under one
//   pixel per CSS pixel. The 2D maps and the HUD are not the 3D canvas and stay at the screen's own ratio.
//   低: pixel ratio 1, no occlusion, no MSAA, shadow maps at 2048; the 战略地图 is the flat picture (at once) and, while 系统 → 战场
//       is 随画质 (warView below), the war map the flat painted one (from the next war).
// When the 战略地图 or the war map runs slowly the game offers the next preset down once, in a corner notice the player can
// take or ignore; it never switches by itself.
import { h } from './ui.js';
import { TOUCH } from './phone.js';

const HIGH_PIXELS = 3.7e6, MEDIUM_PIXELS = 2.3e6; // 2560×1440 and about 2020×1140: on an M4 a frame is about 4 ms + 4.9 ms per million pixels
export const PRESETS = {
  high: { label: '高', ratio: 2, pixels: HIGH_PIXELS, ao: 'auto', msaa: true, shadowCap: Infinity },
  medium: { label: '中', ratio: 1.5, pixels: MEDIUM_PIXELS, ao: 'half', msaa: true, shadowCap: Infinity },
  // A phone's 低 keeps the flat maps and the cheap passes but not the pixel ratio of 1: on a 3× screen the 3D scenes that are left (the
  // 白兵, the 单挑, the title) came out a third of the screen's sharpness and read as blurred (iPhone 16 Pro, 2026-11-14). Twice, within
  // a budget a little under 中's. A tablet's 低 is the phone's (TOUCH): its screen is as dense, and 1 read as blurred the same way.
  low: { label: '低', ratio: TOUCH ? 2 : 1, ...(TOUCH ? { pixels: 1.7e6 } : {}), ao: 'off', msaa: false, shadowCap: 2048 },
};
const ORDER = ['high', 'medium', 'low'];
// The 3D canvas's pixel ratio for a preset in a w×h (CSS pixels) window on a screen of ratio dpr.
export const pixelRatioFor = (level, w, h, dpr) => {
  const p = PRESETS[level], cap = Math.min(dpr, p.ratio);
  return p.pixels && w > 0 && h > 0 ? Math.max(Math.min(1, cap), Math.min(cap, Math.sqrt(p.pixels / (w * h)))) : cap;
};
const KEY = 'hd2d-quality', ASKED = 'hd2d-quality-asked';
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

// The preset stored from last time, for what must be decided before the renderer's settings (which 战略地图 to build).
// A phone starts on 低 (the flat 战略地图 and war map: an iPhone 16 Pro only just holds 60 fps on 高, 2026-11-14) until the player picks,
// and so does a tablet (TOUCH): on 高 an Android tablet's GPU drew the 3D maps far below a phone's flat ones (2026-11-20).
export const savedQuality = () => (PRESETS[store(KEY)] ? store(KEY) : TOUCH ? 'low' : 'high');

// 系统 → 战场: which war map a battle opens on, decided as it opens. 随画质 follows the preset (低 → the flat painted map, else
// 3D); 平面 and 3D hold whatever the 画质, so a 3D 战略地图 can go with the flat war map and the other way round
// (feedback 晚风和远方丶@bilibili, 2026-11-13).
export const WAR_VIEWS = { auto: '随画质', flat: '平面', '3d': '3D' };
const WAR_KEY = 'hd2d-war-view', WAR_ORDER = Object.keys(WAR_VIEWS);
let warViewPick = WAR_VIEWS[store(WAR_KEY)] ? store(WAR_KEY) : 'auto';
export const warView = {
  get value() { return warViewPick; },
  get label() { return WAR_VIEWS[warViewPick]; },
  set(v) { if (WAR_VIEWS[v]) { warViewPick = v; store(WAR_KEY, v); } },
  cycle() { warView.set(WAR_ORDER[(WAR_ORDER.indexOf(warViewPick) + 1) % WAR_ORDER.length]); },
  // Whether a war opened now at preset `level` is on the flat map.
  flat: (level) => (warViewPick === 'auto' ? level === 'low' : warViewPick === 'flat'),
};

export function createQuality({ renderer, post, resize, onChange }) {
  let level = savedQuality();
  // Before every resize (app.js): the ratio follows the window, so a window dragged larger does not go over the preset's pixels.
  // dense: the screen itself has ≥1.5 device pixels per CSS pixel, however far the pixel count holds the canvas under that;
  // fullRatio: the ratio the preset would have without the count (post.js keeps the depth of field as wide on the screen by it).
  let told = '';
  const fit = () => {
    const r = pixelRatioFor(level, innerWidth, innerHeight, devicePixelRatio), fullRatio = Math.min(devicePixelRatio, PRESETS[level].ratio), dense = devicePixelRatio >= 1.5;
    if (r !== renderer.getPixelRatio()) renderer.setPixelRatio(r);
    const key = `${level} ${dense} ${fullRatio}`;
    if (key !== told) { told = key; post.setQuality({ ...PRESETS[level], dense, fullRatio }); } // also when the window moves to another screen
  };
  const apply = () => { fit(); resize(); };
  apply();
  const api = {
    get level() { return level; },
    get label() { return PRESETS[level].label; },
    fit,
    set(l) { if (!PRESETS[l] || l === level) return; level = l; store(KEY, l); apply(); onChange?.(l); },
    // 高 → 中 → 低 → 高, for the 系统 menu button.
    cycle() { api.set(ORDER[(ORDER.indexOf(level) + 1) % ORDER.length]); },
    // Watches the frame rate while idle() holds (the 战略地图 with nothing open) and, if it averages under
    // 40 fps over 4 s, offers the next preset down. Asked once per preset; declining stops the offers.
    watch(idle) {
      if (navigator.webdriver) return; // automated captures and checks stay as they are
      let t0 = 0, n = 0, last = 0, notice = null;
      const step = (t) => {
        requestAnimationFrame(step);
        if (notice) { notice.hidden = !idle(); return; } // waits on the 战略地图 for an answer, out of the way elsewhere
        // Counting restarts whenever the map is not idle, the tab is hidden, or a frame stalls past 250 ms (a
        // loading hitch is not the steady frame rate).
        if (!idle() || document.hidden || !last || t - last > 250) { t0 = t; n = 0; last = t; return; }
        last = t; n++;
        if (t - t0 < 4000) return;
        const fps = (n * 1000) / (t - t0), next = ORDER[ORDER.indexOf(level) + 1];
        t0 = t; n = 0;
        const asked = store(ASKED);
        if (fps >= 40 || !next || asked === 'never' || asked === level) return;
        store(ASKED, level);
        const done = (take) => { notice?.remove(); notice = null; if (take) api.set(next); else store(ASKED, 'never'); };
        notice = h('div', { class: 'panel qnotice', role: 'status' },
          h('p', {}, `画面较卡（约 ${Math.round(fps)} 帧/秒）。改用「${PRESETS[next].label}」画质会更流畅，之后可在「系统 → 画质」随时调整。${next !== 'low' ? '' : warView.value === 'auto' ? '（战略地图和战场将改用平面画面，战场从下一场战争起生效）' : '（战略地图将改用平面画面）'}`),
          h('div', { class: 'foot' },
            h('button', { class: 'btn', onclick: () => done(false) }, '不用'),
            h('button', { class: 'btn primary', onclick: () => done(true) }, `改用${PRESETS[next].label}画质`)));
        document.body.append(notice);
      };
      requestAnimationFrame(step);
    },
  };
  return api;
}
