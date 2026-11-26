// Gamepad input (docs/手柄操作可行性方案_2026-11-08.md): the device layer and the menu walk. It reads every standard-mapping pad
// (Xbox, PlayStation, Switch Pro, Steam Deck) once a frame, turns buttons into presses, taps, holds and releases and the sticks
// into steps and looks, and hands them to app.js, which knows what each screen does with them. It also keeps track of the last
// input used (body[data-input] = pad | mouse | key) and the pad's family for the button glyphs (body[data-pad-family]), and walks
// the focus round a menu by direction (walk), which the routing uses wherever a screen is made of buttons.
//
// Buttons by place, whatever the label (the Gamepad API's standard mapping): a bottom, b right, x left, y top, lb rb lt rt,
// view (Back / Share / −), start (Menu / Options / +), l3 r3 (stick clicks). Confirm is the bottom button and cancel the right one,
// unless the player sets 确定键 to the right one (the Nintendo habit, the default for a Nintendo pad): then a and b trade places.

const STD = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const HOLD_MS = 600; // a long press (结束本日 / 结束本月 on Y, the exact numbers on View)
const FIRST_REPEAT = 320, REPEAT = 110; // a held direction steps again after FIRST_REPEAT, then every REPEAT ms
const STICK_ON = 0.5, STICK_OFF = 0.35; // the left stick as a direction: past STICK_ON it steps, back under STICK_OFF it rests
const LOOK_DEAD = 0.18; // the right stick's dead zone (radial), rescaled to 0…1 past it

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const CONFIRM_KEY = 'hd2d-pad-confirm';

// The family by the pad's id string (vendor ids as Chromium reports them on macOS and Windows).
export function familyOf(id = '') {
  const s = id.toLowerCase();
  if (/045e|xbox|xinput/.test(s)) return 'xbox'; // before the rest: an Xbox pad calls itself a "Wireless Controller" too
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  if (/054c|playstation|dualsense|dualshock|wireless controller/.test(s)) return 'ps';
  return 'xbox'; // Xbox, Steam Deck / Steam Input, and any other XInput-like pad
}

// The labels by place (bottom, right, left, top, …) on each family's pads; the glyph of a logical button is the label of the
// physical one that does it (with 确定键 on the right, confirm shows the right button's label).
const LABELS = {
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', view: '⧉', start: '≡', l3: 'L3', r3: 'R3' },
  ps: { south: '✕', east: '○', west: '□', north: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', view: '创建', start: '选项', l3: 'L3', r3: 'R3' },
  nintendo: { south: 'B', east: 'A', west: 'Y', north: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', view: '−', start: '+', l3: 'L3', r3: 'R3' },
};
export const glyphOf = (family, east, k) => { const L = LABELS[family] ?? LABELS.xbox; return { a: east ? L.east : L.south, b: east ? L.south : L.east, x: L.west, y: L.north }[k] ?? L[k]; };
// Each logical button's glyph as CSS custom properties on <body> (--g-a … --g-r3, a quoted string for content:), and the
// family and the confirm side as data attributes, for ui.css.
// With the painted glyphs (assets/ai/pad/<family>/<cell>.webp, tools/slice_pad_glyphs.py; index.json gives each one's
// width/height) also --gi-<k> (the picture) and --gw-<k> (its width per unit of height), and body[data-glyph-art]: ui.css then
// shows the picture in place of the text, which stays the fallback while they load or if they are missing.
const GLYPH_KEYS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'start', 'l3', 'r3', 'dpad', 'lstick', 'rstick'];
export const cellOf = (east, k) => ({ a: east ? 'east' : 'south', b: east ? 'south' : 'east', x: 'west', y: 'north' }[k] ?? k);
let glyphArt = null; // index.json once loaded: { family: { cell: [w, h] } }
const artLoad = fetch('assets/ai/pad/index.json').then((r) => (r.ok ? r.json() : null)).then((j) => (glyphArt = j)).catch(() => null);
function paintGlyphs(family, east) {
  const b = document.body;
  for (const k of GLYPH_KEYS.slice(0, 12)) b.style.setProperty(`--g-${k}`, JSON.stringify(glyphOf(family, east, k)));
  b.dataset.padFamily = family; b.dataset.padConfirm = east ? 'east' : 'south';
  const art = glyphArt?.[family];
  if (!art) { delete b.dataset.glyphArt; if (!glyphArt) artLoad.then((j) => j && paintGlyphs(family, east)); return; }
  for (const k of GLYPH_KEYS) {
    const c = cellOf(east, k), [w, h] = art[c] ?? [1, 1];
    b.style.setProperty(`--gi-${k}`, `url("${new URL(`assets/ai/pad/${family}/${c}.webp`, document.baseURI).href}")`);
    b.style.setProperty(`--gw-${k}`, (w / h).toFixed(3));
  }
  b.dataset.glyphArt = family;
}

export function createPad({ onButton, onDir, onLook, onFrame, onActivate, onMouse, onLost }) {
  const down = {}, at = {}, held = {}; // per logical button: pressed now, when it went down, whether its hold fired
  const stale = {}; let settle = false, live = false; // buttons still down from before the window came back or the pad was found again: not presses
  let lastRumble = 0, dirKey = null, dirNext = 0, stickOn = false, family = 'xbox', active = false, seen = false, raf = 0, last = 0;
  let confirm = store.get(CONFIRM_KEY); // 'south' | 'east' | null (null: by the pad's family)
  const body = document.body;

  const setInput = (kind, event) => {
    if (body.dataset.input === kind) return;
    body.dataset.input = kind;
    if (kind === 'pad') onActivate?.();
    else if (kind === 'mouse') onMouse?.(event);
  };
  // The mouse or the keyboard takes over as soon as it is used (a synthetic key from this module does not count).
  addEventListener('pointermove', (e) => { if (e.isTrusted && (e.movementX || e.movementY) && body.dataset.input !== 'mouse') { active = false; setInput('mouse', e); } }, true);
  addEventListener('pointerdown', (e) => { if (e.isTrusted) { active = false; setInput('mouse', e); } }, true);
  addEventListener('keydown', (e) => { if (e.isTrusted && !e.fromPad) { active = false; setInput('key'); } }, true);
  addEventListener('gamepadconnected', (e) => { if (e.gamepad.mapping === 'standard') start(); });
  // Everything held is let go (its release told, so a view held open closes), and whatever is still down when the pad is read
  // next is not a new press: the window going away, or the pad itself (unplugged, its battery out).
  const drop = () => { for (const k of STD) { if (down[k] && !(k in DIRS)) onButton(k, 'release'); down[k] = false; held[k] = false; } dirKey = null; stickOn = false; settle = true; };
  addEventListener('blur', drop);

  const east = () => (confirm ? confirm === 'east' : family === 'nintendo');
  // A logical name for a standard index, with confirm and cancel traded when 确定键 is the right button.
  const nameOf = (i) => { const n = STD[i]; if (!east()) return n; return n === 'a' ? 'b' : n === 'b' ? 'a' : n; };

  function read() {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected && p.mapping === 'standard');
    if (!pads.length) return null;
    // Every pad at once: the newest one names the family.
    const p = pads.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    if (familyOf(p.id) !== family) { family = familyOf(p.id); paintGlyphs(family, east()); }
    const btn = {};
    for (const q of pads) q.buttons.forEach((b, i) => { if (i < STD.length) { const n = nameOf(i); btn[n] = btn[n] || b.pressed || b.value > 0.5; } });
    const ax = (k) => pads.reduce((a, q) => (Math.abs(q.axes[k] ?? 0) > Math.abs(a) ? q.axes[k] : a), 0);
    return { btn, lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3) };
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    const s = read();
    if (!s) {
      // The pad is gone: the mouse and the keys get their hints and the pointer back, and the game is told (it pauses a 白兵).
      if (live) { live = false; const was = active; drop(); active = false; if (was) { setInput('mouse'); onLost?.(); } }
      return;
    }
    live = true;
    if (settle) { settle = false; for (const k of STD) stale[k] = !!s.btn[k]; }
    for (const k of STD) { if (stale[k]) { if (s.btn[k]) s.btn[k] = false; else stale[k] = false; } }
    const any = Object.values(s.btn).some(Boolean) || Math.hypot(s.lx, s.ly) > STICK_ON || Math.hypot(s.rx, s.ry) > 0.4;
    if (any && !active) { active = true; seen = true; setInput('pad'); }
    // Buttons (the d-pad is a direction, below).
    for (const k of STD) {
      if (k in DIRS) continue;
      const on = !!s.btn[k];
      if (on && !down[k]) { down[k] = true; at[k] = t; held[k] = false; onButton(k, 'press'); }
      else if (on && !held[k] && t - at[k] >= HOLD_MS) { held[k] = true; onButton(k, 'hold'); }
      else if (!on && down[k]) { down[k] = false; onButton(k, held[k] ? 'release' : 'tap'); if (!held[k]) onButton(k, 'release'); }
    }
    // A direction: the d-pad (diagonals by two arms), else the left stick in eight sectors. It steps on the press, then repeats.
    let dx = (s.btn.right ? 1 : 0) - (s.btn.left ? 1 : 0), dy = (s.btn.down ? 1 : 0) - (s.btn.up ? 1 : 0);
    if (!dx && !dy) {
      const m = Math.hypot(s.lx, s.ly);
      stickOn = m > (stickOn ? STICK_OFF : STICK_ON);
      if (stickOn) { const a = Math.round(Math.atan2(s.ly, s.lx) / (Math.PI / 4)) * Math.PI / 4; dx = Math.round(Math.cos(a)); dy = Math.round(Math.sin(a)); }
    } else stickOn = false;
    const key = dx || dy ? `${dx},${dy}` : null;
    if (key !== dirKey) { dirKey = key; if (key) { dirNext = t + FIRST_REPEAT; onDir(dx, dy, true); } }
    else if (key && t >= dirNext) { dirNext = t + REPEAT; onDir(dx, dy, false); }
    // The right stick: a look, every frame it is off centre.
    const m = Math.hypot(s.rx, s.ry);
    if (m > LOOK_DEAD) { const k = (m - LOOK_DEAD) / (1 - LOOK_DEAD) / m; onLook(s.rx * k, s.ry * k, dt); } else onLook(0, 0, dt);
    // The left stick (or the d-pad) as a push, for what slides while it is held (欣赏模式's view): 0…1 past the dead zone.
    const lm = Math.hypot(s.lx, s.ly), lk = lm > LOOK_DEAD ? (lm - LOOK_DEAD) / (1 - LOOK_DEAD) / lm : 0;
    const move = s.btn.left || s.btn.right || s.btn.up || s.btn.down ? { x: (s.btn.right ? 1 : 0) - (s.btn.left ? 1 : 0), y: (s.btn.down ? 1 : 0) - (s.btn.up ? 1 : 0) } : { x: s.lx * lk, y: s.ly * lk };
    onFrame?.(t, dt, (k) => (down[k] && !held[k] ? Math.min(1, (t - at[k]) / HOLD_MS) : 0), move);
  }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  paintGlyphs(family, east());
  // Chromium lists a pad only after it is used on the page; one already used in an earlier page is there at once.
  if ([...(navigator.getGamepads?.() ?? [])].some((p) => p?.mapping === 'standard')) start();

  return {
    get active() { return active && body.dataset.input === 'pad'; },
    get seen() { return seen; },
    get family() { return family; },
    // 确定键: 'south' (bottom) or 'east' (right); the default follows the pad.
    get confirm() { return east() ? 'east' : 'south'; },
    setConfirm(v) {
      // A thumb still on the old confirm key must lift before it can act as cancel.
      if (down.a || down.b) stale.a = stale.b = true;
      confirm = v;
      store.set(CONFIRM_KEY, v);
      paintGlyphs(family, east());
    },
    isDown: (k) => !!down[k],
    // A short buzz (strength 0…1), at most one every 70 ms while a shake goes on; only while the pad is in use.
    rumble(k) {
      const now = performance.now();
      if (!active || now - lastRumble < 70) return;
      lastRumble = now;
      for (const p of navigator.getGamepads?.() ?? []) p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: 90, strongMagnitude: Math.min(1, k * 1.2), weakMagnitude: Math.min(1, k * 2) })?.catch?.(() => {});
    },
    start,
  };
}

// ---------- The focus, walked by direction ----------
const FOCUSABLE = 'button, [tabindex="0"], input:not([type=hidden]), select, textarea, a[href]';
export const shown = (el) => {
  if (!el?.isConnected || el.closest('[hidden], [inert]')) return false;
  const r = el.getClientRects(); if (!r.length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
};
export const focusables = (zone) => [...zone.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.tabIndex >= 0 && shown(el));
export const isControl = (el) => !!el && el !== document.body && el.matches?.(FOCUSABLE) && !el.disabled;

// The control a zone starts on: one marked for it, the default answer, the page or row that is on, else the first.
export function firstIn(zone) {
  const all = focusables(zone);
  return all.find((el) => el.matches('[data-pad-first]')) ?? all.find((el) => el.matches('.primary, .tq-btn.primary'))
    ?? all.find((el) => el.matches('.on, [aria-pressed="true"]')) ?? all[0] ?? null;
}
export function focusFirst(zone) { const el = firstIn(zone); el?.focus({ preventScroll: false }); return el; }

// The nearest control of the zone that lies that way from the focused one, as a television menu walks: along the direction
// first, across it counted double, and one that overlaps the focused one across the direction wins over one that does not.
export function walk(zone, dx, dy) {
  const from = document.activeElement;
  if (!zone.contains(from) || !isControl(from)) return focusFirst(zone);
  const a = from.getBoundingClientRect(), all = focusables(zone).filter((el) => el !== from);
  // Four ways for a menu (a diagonal is taken by its larger arm, the vertical one on a tie).
  if (dx && dy) dx = 0;
  let best = null, bestScore = Infinity;
  for (const el of all) {
    const b = el.getBoundingClientRect();
    const gap = dx > 0 ? b.left - a.right : dx < 0 ? a.left - b.right : dy > 0 ? b.top - a.bottom : a.top - b.bottom;
    const ahead = dx > 0 ? b.left + b.width / 2 > a.left + a.width / 2 + 1 : dx < 0 ? b.left + b.width / 2 < a.left + a.width / 2 - 1
      : dy > 0 ? b.top + b.height / 2 > a.top + a.height / 2 + 1 : b.top + b.height / 2 < a.top + a.height / 2 - 1;
    if (!ahead) continue;
    const across = dx ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const overlap = dx ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0 : Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;
    const score = Math.max(0, gap) + across * 2 + (overlap ? 0 : 40);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  best?.focus();
  return best;
}

// A key as the keyboard would send it, from the pad: the screens' own keys (Enter and Space skip a presentation, Esc backs out)
// do the same for both. e.fromPad marks it, so the keyboard-only shortcuts (Enter ends the day) can leave it alone. True if a
// handler took it (preventDefault).
const CODES = { Enter: 'Enter', Escape: 'Escape', ' ': 'Space', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Tab: 'Tab' };
export function sendKey(key, { code = CODES[key] ?? key, target = document.activeElement ?? document.body, shift = false } = {}) {
  const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, shiftKey: shift });
  Object.defineProperty(e, 'fromPad', { value: true });
  (target?.isConnected ? target : document.body).dispatchEvent(e);
  const up = new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true });
  Object.defineProperty(up, 'fromPad', { value: true });
  (target?.isConnected ? target : document.body).dispatchEvent(up);
  return e.defaultPrevented;
}
