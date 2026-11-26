// Title screen after the FC original's opening: the grey stone 三国志 waits on black while the title
// music builds, an arrow flies in from the upper right and sticks in 志 (the original's slot-30 whoosh),
// and on the strike the music's full entrance lands, the stone flashes to gold, the red Ⅱ slams in,
// 霸王的大陆 is written underneath and the landscape band opens between its two blue rules.
// The lettering, Ⅱ and arrow are pixel art drawn into a low-res framebuffer and scaled up crisp; the
// flash, shake, glow, dust and the HD-2D band (assets/ai/title-band.webp) are drawn at full resolution.
import { h } from './ui.js';
import { pacer } from './framecap.js';
import { shakeLevel } from './fx.js';

// Seconds on the title music's clock. Both the original track (NSF 1) and its remix enter in full at
// 4.85 s; the FC boot recording fires the whoosh 0.43 s before that (promo/fc/boot.mkv 7.02 s → 7.45 s).
// The Ⅱ's height to the letters', and 霸王的大陆: its size and how far it rises into the plate, in title pixels.
const TWO_K = 1.5, SUB = { size: 12, over: 3 }, BAND_GAP = 17;
const STONE_IN = 0.4, HOLD = 1.6, WHOOSH = 4.42, HIT = 4.85, END = HIT + 2.6, LOAD_WAIT = 6;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const PAL = {
  gold: ['#4a1606', '#8a300a', '#c85a0e', '#ec8a1c', '#f8b840', '#ffdc78', '#fff4c4'].map(hex),
  leaf: ['#0a240a', '#185a14', '#2e8c22', '#5cba30', '#a6e05a'].map(hex),
  stone: ['#26262a', '#46474d', '#6e6f76', '#9a9ba0', '#c4c4c8', '#ececee'].map(hex),
  moss: ['#141416', '#2c2d31', '#4a4b50', '#77787d', '#a0a1a6'].map(hex),
  red: ['#3a0404', '#760a08', '#b8160e', '#e83a1e', '#ff8a5a', '#ffe0d0'].map(hex),
  ash: ['#18181a', '#2a2a2e', '#3a3a3f', '#4a4a50', '#5a5a60', '#6a6a70'].map(hex),
  white: ['#c8c8d0', '#e0e0e8', '#f4f4f8', '#ffffff', '#ffffff', '#ffffff', '#ffffff'].map(hex),
};
const noise = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------- Pixel sprites ----------
function grid(w, h) { return { w, h, a: new Uint8Array(w * h) }; }
const at = (g, x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? 0 : g.a[y * g.w + x]);
function dilate(g, r, keep = () => true) {
  const o = grid(g.w, g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    if (g.a[y * g.w + x]) { o.a[y * g.w + x] = 1; continue; }
    let hit = false;
    for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r && !hit; dx++) if (dx * dx + dy * dy <= r * r + r && at(g, x + dx, y + dy)) hit = true;
    if (hit && keep(x, y)) o.a[y * g.w + x] = 1;
  }
  return o;
}
// Steps to the nearest outside pixel (4-neighbour), capped: the bevel's height field.
function inset(g, cap) {
  const d = new Float32Array(g.w * g.h);
  for (let i = 0; i < d.length; i++) d[i] = g.a[i] ? cap : 0;
  for (let pass = 0; pass < cap; pass++) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x; if (!g.a[i]) continue;
    d[i] = Math.min(d[i], 1 + Math.min(x > 0 ? d[i - 1] : 0, x < g.w - 1 ? d[i + 1] : 0, y > 0 ? d[i - g.w] : 0, y < g.h - 1 ? d[i + g.w] : 0));
  }
  return d;
}
const pick = (pal, v, x, y) => pal[Math.max(0, Math.min(pal.length - 1, Math.round(v * (pal.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * 0.9)))];

// Lettering in four looks: stone (before the strike), ash with a red edge (the strike frame), white
// (flash) and gold with the original's green leafy rim. One mask, lit from the upper left like the maps.
function buildLogo(text, size) {
  const pad = 8, c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
  x.font = `${size}px "Ma Shan Zheng"`;
  const w = Math.ceil(x.measureText(text).width) + pad * 2, hh = Math.ceil(size * 1.15) + pad * 2;
  c.width = w; c.height = hh; x.font = `${size}px "Ma Shan Zheng"`; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.fillText(text, pad, hh / 2 + size * 0.04);
  const img = x.getImageData(0, 0, w, hh).data, m = grid(w, hh);
  for (let i = 0; i < w * hh; i++) m.a[i] = img[i * 4 + 3] > 96 ? 1 : 0;
  const body = dilate(m, 2), d = inset(body, 5);
  const rim = dilate(body, 2, (px, py) => true), leafy = dilate(rim, 1, (px, py) => noise(px, py) > 0.5);
  const edge = dilate(leafy, 1);
  const H = (px, py) => (px < 0 || py < 0 || px >= w || py >= hh ? 0 : Math.min(3, d[py * w + px]));
  const looks = {};
  for (const [look, fill, rimPal, line] of [['stone', PAL.stone, PAL.moss, hex('#08080a')], ['ash', PAL.ash, PAL.ash, hex('#d01810')], ['white', PAL.white, PAL.white, hex('#d01810')], ['gold', PAL.gold, PAL.leaf, hex('#061006')]]) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const cx = cv.getContext('2d'), out = cx.createImageData(w, hh), o = out.data;
    for (let py = 0; py < hh; py++) for (let px = 0; px < w; px++) {
      const i = py * w + px; let col = null;
      if (body.a[i]) {
        const nx = H(px - 1, py) - H(px + 1, py), ny = H(px, py - 1) - H(px, py + 1);
        const v = 0.2 + 0.16 * (nx + ny) + 0.5 * (1 - py / hh) + 0.05 * Math.min(3, d[i]) + (look === 'stone' ? (noise(px, py) - 0.5) * 0.35 : 0);
        col = pick(fill, v, px, py);
      } else if (leafy.a[i]) {
        const up = at(body, px + 2, py + 2) ? 0.25 : 0;
        col = pick(rimPal, 0.35 + up + (noise(px * 3, py * 7) - 0.5) * 0.7 - 0.2 * (py / hh), px, py);
      } else if (edge.a[i]) col = line;
      if (col) { o[i * 4] = col[0]; o[i * 4 + 1] = col[1]; o[i * 4 + 2] = col[2]; o[i * 4 + 3] = 255; }
    }
    cx.putImageData(out, 0, 0); looks[look] = cv;
  }
  // Where 志 sits, for the arrow: the right end of the lettering, a third down.
  let right = 0; for (let px = w - 1; px >= 0 && !right; px--) for (let py = 0; py < hh; py++) if (body.a[py * w + px]) { right = px; break; }
  return { w, h: hh, looks, body, hit: { x: right - Math.round(hh * 0.36), y: Math.round(hh * 0.4) }, top: 0, lh: hh, twoX: w - 8 };
}

// The painted lettering (tools/gen_title_logo_codex.sh → build_title_logo.py): gold as painted, and the stone, ash and
// white looks of the opening re-lit from its own shading, green plate pixels into the mossy greys. A one-pixel line
// rings it. Resolves null when it is not there, and the brush-font lettering above stands in.
async function paintedLogo() {
  const meta = await fetch('assets/ai/title-logo.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta) return null;
  const img = new Image(); img.src = 'assets/ai/title-logo.webp';
  if (!(await img.decode().then(() => true, () => false))) return null;
  const w = meta.w + 2, hh = meta.h + 2, c = document.createElement('canvas'); c.width = w; c.height = hh;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 1, 1);
  const src = x.getImageData(0, 0, w, hh).data, body = grid(w, hh);
  for (let i = 0; i < w * hh; i++) body.a[i] = src[i * 4 + 3] > 0 ? 1 : 0;
  const edge = dilate(body, 1), looks = {};
  for (const [look, fill, plate, line] of [['stone', PAL.stone, PAL.moss, hex('#08080a')], ['ash', PAL.ash, PAL.ash, hex('#d01810')], ['white', PAL.white, PAL.white, hex('#d01810')], ['gold', null, null, hex('#061006')]]) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const cx = cv.getContext('2d'), out = cx.createImageData(w, hh), o = out.data;
    for (let py = 0; py < hh; py++) for (let px = 0; px < w; px++) {
      const i = py * w + px, j = i * 4; let col = null;
      if (body.a[i]) {
        const r = src[j], g = src[j + 1], b = src[j + 2];
        if (!fill) col = [r, g, b];
        else { const v = (0.3 * r + 0.59 * g + 0.11 * b) / 255; col = pick(g > r && g > b ? plate : fill, Math.min(1, v * 1.15), px, py); }
      } else if (edge.a[i]) col = line;
      if (col) { o[j] = col[0]; o[j + 1] = col[1]; o[j + 2] = col[2]; o[j + 3] = 255; }
    }
    cx.putImageData(out, 0, 0); looks[look] = cv;
  }
  const [top, bottom] = meta.letters;
  return { w, h: hh, looks, body, hit: { x: Math.round(1 + meta.hit[0] * meta.w), y: Math.round(1 + meta.hit[1] * meta.h) },
    top: Math.round(1 + top * meta.h), lh: Math.round((bottom - top) * meta.h), twoX: Math.round(w * 0.9) };
}

// The italic red Ⅱ: two slanted strokes under shared serifs, a white highlight on the lit edge.
function buildTwo(hgt) {
  const slant = 0.26, sw = Math.round(hgt * 0.17), gap = Math.round(hgt * 0.13), serif = Math.max(2, Math.round(hgt * 0.07));
  const w = Math.ceil(hgt * slant + sw * 2 + gap + serif * 2) + 6, hh = hgt + 6, m = grid(w, hh);
  const x0 = (y) => 3 + serif + (hgt - (y - 3)) * slant;
  for (let y = 3; y < 3 + hgt; y++) {
    const b = x0(y), top = y < 3 + serif || y >= 3 + hgt - serif;
    for (let x = 0; x < w; x++) {
      const u = x - b;
      if ((u >= 0 && u < sw) || (u >= sw + gap && u < sw * 2 + gap) || (top && u >= -serif && u < sw * 2 + gap + serif)) m.a[y * w + x] = 1;
    }
  }
  const edge = dilate(m, 1), d = inset(m, 3), make = (pal, line) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const cx = cv.getContext('2d'), out = cx.createImageData(w, hh), o = out.data;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; let col = null;
      if (m.a[i]) {
        const lit = !at(m, x - 1, y) || !at(m, x, y - 1), dark = !at(m, x + 1, y) || !at(m, x, y + 1);
        col = lit ? pal[pal.length - 1] : dark ? pal[1] : pick(pal, 0.45 + 0.3 * (1 - y / hh) + 0.04 * d[i], x, y);
      } else if (edge.a[i]) col = line;
      if (col) { o[i * 4] = col[0]; o[i * 4 + 1] = col[1]; o[i * 4 + 2] = col[2]; o[i * 4 + 3] = 255; }
    }
    cx.putImageData(out, 0, 0); return cv;
  };
  return { w, h: hh, red: make(PAL.red, hex('#140202')), white: make(PAL.white, hex('#d01810')) };
}

// The arrow, plotted pixel by pixel along its line so it stays crisp at any angle. `sunk` pixels of
// the head are inside the stone; s runs from the tip back to the nock.
function plotArrow(ctx, tx, ty, ang, len, sunk, alpha = 1) {
  const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
  ctx.globalAlpha = alpha;
  const dot = (s, o, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(tx - dx * s + px * o), Math.round(ty - dy * s + py * o), 1, 1); };
  for (let s = sunk; s <= len; s += 0.5) {
    if (s < 5) { dot(s, 0, '#dfe6ee'); if (s >= 2.5) { dot(s, -1, '#8a94a0'); dot(s, 1, '#5a626c'); } }
    else if (s > len - 11) {
      const k = (s - (len - 11)) / 11;
      dot(s, 0, '#d8c08a');
      dot(s, -1, '#7ad048'); dot(s, 1, '#2e8c22');
      if (k > 0.3) { dot(s, -2, '#5cba30'); dot(s, 2, '#185a14'); }
      if (s > len - 1) dot(s, 0, '#b8160e');
    } else { dot(s, 1, '#4a3418'); dot(s, 0, Math.round(s) % 7 === 0 ? '#a08050' : '#efdcae'); }
  }
  ctx.globalAlpha = 1;
}

// ---------- Screen ----------
export function createTitle({ audio, menu, footnote, sys, intro = true }) {
  const fb = document.createElement('canvas'), fx = fb.getContext('2d');
  const cv = h('canvas', { class: 'tt-canvas' }), ctx = cv.getContext('2d');
  const flash = h('div', { class: 'tt-flash' });
  const sub = h('div', { class: 'tt-sub' }, '霸王的大陆');
  const band = h('div', { class: 'tt-band' }, h('div', { class: 'tt-band-img' }), h('div', { class: 'tt-sun' }), h('div', { class: 'tt-motes' }));
  const press = h('div', { class: 'tt-press' }, '— 按任意键 —');
  const menuBox = h('div', { class: 'tt-menu' }, menu);
  const foot = h('div', { class: 'tt-foot' }, footnote);
  const stage = h('div', { class: 'tt-stage' }, band, cv, sub, press, menuBox);
  const wrap = h('div', { class: `tt ${intro ? '' : 'instant'}` }, stage, flash, foot, sys);

  let logo = null, two = null, P = 3, L = { lx: 0, ly: 0, tx: 0, ty: 0, ix: 0, iy: 0 };
  const ANG = Math.PI - 0.62, SUNK = 7;
  let LEN = 72;
  const chips = [], motes = [], puffs = [];
  let t = intro ? 0 : END, t0 = performance.now(), held = false, clicked = false, free = false, waitFrom = null, started = !intro, fired = { whoosh: false, hit: false }, raf = 0, last = performance.now();

  function layout() {
    const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
    const lw = logo.w + two.w - 6, lh = logo.h;
    P = Math.max(1, Math.min(6, Math.floor(Math.min(W * 0.9 / lw, W * 0.66 / lw + 0.6, H * 0.27 / lh))));
    cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    fb.width = Math.ceil(W / P); fb.height = Math.ceil(H / P);
    L.lx = Math.round((fb.width - lw) / 2); L.ly = Math.round(H * 0.09 / P);
    L.tx = L.lx + logo.twoX; L.ty = L.ly + logo.top + Math.round((logo.lh - two.h) / 2) + 2;
    L.ix = L.lx + logo.hit.x; L.iy = L.ly + logo.hit.y;
    const bottom = (L.ly + lh) * P;
    sub.style.top = `${bottom - P * SUB.over}px`; sub.style.right = `${W - (L.tx + two.w) * P}px`; sub.style.fontSize = `${Math.round(P * SUB.size)}px`;
    const bandTop = bottom + P * BAND_GAP;
    // The menu grows with records / a suspended battle, and footer lines may wrap after fonts load.
    // Reserve their real heights first; the landscape uses only the space left between logo and menu.
    const menuH = menuBox.getBoundingClientRect().height, footH = foot.getBoundingClientRect().height;
    const tight = document.body.classList.contains('phone'), gapM = tight ? 8 : 22; // a phone's screen is short: less air round the menu (src/phone.css)
    const bandH = Math.max(0, Math.min(W / 3, H * 0.36, H - (tight ? 4 : 12) - footH - (tight ? 6 : 16) - menuH - gapM - bandTop));
    stage.style.setProperty('--band-top', `${bandTop}px`); stage.style.setProperty('--band-h', `${bandH}px`);
    press.style.top = `${bandTop + 8}px`;
    menuBox.style.top = `${bandTop + bandH + gapM}px`;
  }

  // The flight path: a quadratic arc from just past the right edge that meets 志 at the arrow's final angle.
  function flight(u) {
    const x0 = fb.width + LEN * 0.3, y0 = L.iy - 4, m = 0.38 * Math.hypot(x0 - L.ix, y0 - L.iy);
    const x1 = L.ix - Math.cos(ANG) * m, y1 = L.iy - Math.sin(ANG) * m, v = 1 - u;
    return { x: v * v * x0 + 2 * v * u * x1 + u * u * L.ix, y: v * v * y0 + 2 * v * u * y1 + u * u * L.iy,
      ang: Math.atan2(v * (y1 - y0) + u * (L.iy - y1), v * (x1 - x0) + u * (L.ix - x1)) };
  }

  // Once started, the intro runs on the music's own clock (t never steps back, so it waits on the stone until
  // the music catches up); with no music to follow (none, failed, or given up on) it runs on the wall clock.
  const clock = () => {
    const at = !free && audio.bgmPlaying() ? audio.bgmTime() : null;
    if (at != null && at < END + 1) return at;
    return (performance.now() - t0) / 1000;
  };
  const skip = () => { t = END; started = true; held = false; t0 = performance.now() - END * 1000; wrap.classList.add('done'); };
  // A click or key: releases the hold when the browser kept the music back, otherwise skips the intro.
  const onInput = (e) => {
    if (!wrap.isConnected) return removeListeners();
    if (t >= END) return;
    if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    // The gesture lets the context run; the frame loop starts the intro once the music actually sounds.
    if (held) { held = false; clicked = true; press.classList.remove('on'); audio.unlock(); audio.preload('sfx-arrow'); waitFrom = performance.now(); return; }
    if (t > STONE_IN) { e.preventDefault?.(); skip(); }
  };
  const removeListeners = () => { removeEventListener('pointerdown', onInput, true); removeEventListener('keydown', onInput, true); };
  addEventListener('pointerdown', onInput, true); addEventListener('keydown', onInput, true);

  function strike() {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.3) * 2.4, v = 30 + Math.random() * 70;
      chips.push({ x: L.ix, y: L.iy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0.6 + Math.random() * 0.6, c: ['#c4c4c8', '#9a9ba0', '#ffdc78', '#f8b840', '#6e6f76'][i % 5] });
    }
    puffs.push({ x: L.ix, y: L.iy, r: 0, life: 0.7 });
  }

  const due = pacer();
  function frame(now) {
    if (!wrap.isConnected) { removeListeners(); removeEventListener('resize', onResize); sizes.disconnect(); return; }
    raf = requestAnimationFrame(frame);
    if (!due(now)) return; // 系统 → 帧率 (src/framecap.js)
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!started) {
      // Hold on the stone until the music is actually running, so the whoosh and the strike are heard.
      t = Math.min(HOLD, (now - t0) / 1000);
      if (t >= HOLD * 0.6 && !held) {
        const st = audio.bgmState();
        waitFrom ??= now;
        // Still fetching or decoding (or the context resuming after the click): keep waiting, but not forever;
        // past LOAD_WAIT the intro plays on its own and the music joins whenever it arrives.
        const waiting = st === 'loading' || (st === 'blocked' && clicked);
        if (st === 'playing' || st === 'none' || (waiting && now - waitFrom > LOAD_WAIT * 1000)) {
          free = st !== 'playing'; started = true; t0 = now - t * 1000;
          audio.unlock(); audio.preload('sfx-arrow');
        } else if (st === 'blocked' && !clicked) { held = true; press.classList.add('on'); }
      }
    } else if (t < END) t = Math.max(t, clock());
    if (typeof window.__titleAt === 'number') { t = window.__titleAt; started = true; held = false; }  // tools/title_capture.mjs
    if (!fired.whoosh && t >= WHOOSH && t < HIT) { fired.whoosh = true; audio.sfx('sfx-arrow'); }
    if (!fired.hit && t >= HIT && t < HIT + 0.3) { fired.hit = true; audio.sfx('sfx-arrow-hit'); strike(); }
    if (t >= HIT) { fired.whoosh = fired.hit = true; }
    wrap.classList.toggle('struck', t >= HIT); wrap.classList.toggle('sub-on', t >= HIT + 0.55);
    wrap.classList.toggle('band-on', t >= HIT + 0.95); wrap.classList.toggle('menu-on', t >= HIT + 1.9);
    draw(t, dt);
  }

  function draw(t, dt) {
    fx.clearRect(0, 0, fb.width, fb.height);
    // Ambient motes drifting up through the dark.
    if (motes.length < 40 && Math.random() < 0.3) motes.push({ x: Math.random() * fb.width, y: fb.height + 2, v: 3 + Math.random() * 6, p: Math.random() * 6 });
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]; m.y -= m.v * dt; m.p += dt;
      if (m.y < -2) { motes.splice(i, 1); continue; }
      fx.globalAlpha = 0.25 + 0.25 * Math.sin(m.p * 2); fx.fillStyle = '#f6b860'; fx.fillRect(Math.round(m.x + Math.sin(m.p) * 2), Math.round(m.y), 1, 1);
    }
    fx.globalAlpha = 1;
    const k = t - HIT, look = t < HIT ? 'stone' : k < 0.07 ? 'ash' : k < 0.17 ? 'white' : 'gold';
    fx.globalAlpha = Math.max(0, Math.min(1, (t - STONE_IN) / 0.9));
    fx.drawImage(logo.looks[look], L.lx, L.ly);
    fx.globalAlpha = 1;
    // A light glint crossing the gold every few seconds.
    if (look === 'gold') {
      const g = ((t - HIT - 0.6) % 5.5) / 1.1;
      if (g > 0 && g < 1) {
        const x = L.lx - logo.h + g * (logo.w + two.w + logo.h * 2);
        fx.save(); fx.globalCompositeOperation = 'source-atop'; fx.fillStyle = 'rgba(255,250,214,0.55)';
        fx.beginPath(); fx.moveTo(x, L.ly); fx.lineTo(x + 5, L.ly); fx.lineTo(x + 5 - logo.h * 0.5, L.ly + logo.h); fx.lineTo(x - logo.h * 0.5, L.ly + logo.h); fx.fill(); fx.restore();
      }
    }
    // Ⅱ: white on the flash, then red, slamming down from 1.8×.
    if (k >= 0.07) {
      const u = Math.min(1, (k - 0.07) / 0.18), s = 1 + 0.8 * (1 - u) ** 2, img = k < 0.17 ? two.white : two.red;
      const w = Math.round(two.w * s), hh = Math.round(two.h * s);
      fx.drawImage(img, Math.round(L.tx + two.w / 2 - w / 2), Math.round(L.ty + two.h / 2 - hh / 2), w, hh);
    }
    // The crack where the head went in.
    if (k >= 0) {
      fx.fillStyle = look === 'gold' ? '#3a1004' : '#101012';
      for (const [cx, cy] of [[0, 0], [1, 0], [-1, 1], [-2, 1], [1, -1], [2, 1], [-1, -1], [0, 2]]) fx.fillRect(L.ix + cx, L.iy + cy, 1, 1);
    }
    // The arrow: lobbed in from beyond the right edge with two afterimages, then stuck and quivering.
    if (t >= WHOOSH) {
      if (k < 0) {
        const u = (t - WHOOSH) / (HIT - WHOOSH);
        for (const [back, a] of [[0.12, 0.18], [0.06, 0.4]]) { const f = flight(u - back); plotArrow(fx, f.x, f.y, f.ang, LEN, 0, a); }
        const f = flight(u); plotArrow(fx, f.x, f.y, f.ang, LEN, 0);
      } else {
        const wob = 0.07 * Math.exp(-k / 0.18) * Math.sin(k * 2 * Math.PI * 16);
        plotArrow(fx, L.ix, L.iy, ANG + wob, LEN, SUNK);
      }
    }
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i]; c.life -= dt; if (c.life <= 0) { chips.splice(i, 1); continue; }
      c.vy += 220 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
      fx.fillStyle = c.c; fx.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
    }
    // Up to the screen: nearest-neighbour pixels, then the full-resolution light on top.
    const dpr = cv.width / innerWidth, sc = P * dpr;
    let sx = 0, sy = 0;
    if (k >= 0 && k < 0.5) { const a = 7 * Math.exp(-k / 0.1) * shakeLevel(); sx = a * (0.36 * Math.sin(k * 55) + 0.22 * Math.sin(k * 80 + 1.3)); sy = a * (0.36 * Math.sin(k * 64 + 2.1) + 0.22 * Math.sin(k * 91 + 0.4)); } // the thud: smooth, not per-frame static (fx.js shakeOffset)
    stage.style.transform = sx || sy ? `translate(${sx}px,${sy}px)` : '';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fb, 0, 0, fb.width * sc, fb.height * sc);
    if (t >= WHOOSH && k < 0) {
      // A soft speed streak trailing the arrow.
      const u = (t - WHOOSH) / (HIT - WHOOSH);
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = flight(u - i * 0.03), b = flight(u - (i + 1) * 0.03);
        ctx.strokeStyle = `rgba(255,240,210,${0.5 * (1 - i / 8)})`; ctx.lineWidth = sc * (1.4 - i * 0.12);
        ctx.beginPath(); ctx.moveTo(a.x * sc, a.y * sc); ctx.lineTo(b.x * sc, b.y * sc); ctx.stroke();
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.life -= dt; p.r += dt * 40; if (p.life <= 0) { puffs.splice(i, 1); continue; }
      const r = (6 + p.r) * sc, gr = ctx.createRadialGradient(p.x * sc, p.y * sc, 0, p.x * sc, p.y * sc, r);
      gr.addColorStop(0, `rgba(255,236,190,${0.55 * p.life})`); gr.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x * sc, p.y * sc, r, 0, Math.PI * 2); ctx.fill();
    }
    flash.style.opacity = k >= 0 && k < 0.6 ? (0.85 * Math.exp(-k / 0.09)).toFixed(3) : '0';
  }

  // The painted lettering, or the brush-font one when it is missing (that one waits for its font); the stone fades in
  // once it is there.
  const brush = () => Promise.race([document.fonts.load('112px "Ma Shan Zheng"', '三国志'), new Promise((r) => setTimeout(r, 3000))]).catch(() => {}).then(() => buildLogo('三国志', 56));
  const ready = paintedLogo().then((p) => p || brush()).then((built) => {
    logo = built; two = buildTwo(Math.round(logo.lh * TWO_K)); LEN = Math.round(logo.lh * 0.95);
    layout(); addEventListener('resize', onResize); sizes.observe(menuBox); sizes.observe(foot);
    t0 = performance.now(); last = t0; if (!intro) { skip(); }
    raf = requestAnimationFrame(frame);
  });
  const onResize = () => { if (wrap.isConnected && logo) layout(); };
  const sizes = new ResizeObserver(onResize);
  return { el: wrap, ready, skip };
}
