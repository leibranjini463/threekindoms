// 命令演出: the little picture the original plays when a 命令书 is spent (FC confirm routine $D5BD,
// 128 frames: the book counter blinks and drops halfway; then the left stats window wipes into a framed,
// looping pixel vignette for that command, 255 frames, while the result types out a character every 4 frames,
// and the result then waits for A / B). src/pace.js ORIGINAL holds the lengths. Here the result is typed only after
// the picture's 255 frames, the caption saying meanwhile what is being done (#593, see playVignette).
// Here the frame opens large in the middle of the screen. Each scene is one painted shot told in nine frames
// (tools/storyboard_prompts.mjs → gen_storyboard_api.py → build_storyboards.py). A scene without published art falls
// back to the plain result toast. Click / Enter / Space skips. Presentation only: the command has already been applied
// by the caller.
import { h } from './ui.js';
import { pacer } from './framecap.js';
import { keyTaken, paced, paceSpeed, ORIGINAL } from './pace.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// How long an outcome told after the picture stays up when the show closes by itself (快速 / 最快; 原版 waits for a key).
// Not the original's: it typed the result during the picture (#593).
const RESULT_HOLD = 2000;
let enabled = true;
try { enabled = localStorage.getItem('hd2d-vignettes') !== 'off'; } catch {}
export const vignettesOn = () => enabled;
export function setVignettes(on) { enabled = on; try { localStorage.setItem('hd2d-vignettes', on ? 'on' : 'off'); } catch {} }

// Command → scene, with the 开发 field picking land / industry / pop. 调遣 (once 移动), 侦察 and 赈济 (once 施舍) have their own (feedback T12, 2026-10-30).
const SCENE_OF = { 防灾: 'disaster', 记录: 'record', 征兵: 'conscript', 调遣: 'march', 运输: 'move', 搜索: 'search', 侦察: 'scout', 赏赐: 'reward', 赈济: 'alms',
  买米: 'rice-buy', 卖米: 'rice-sell', 卖宝: 'treasure', 医馆: 'hospital', 书馆: 'school', 铁铺: 'weapons', 同盟: 'ally', 诱纳: 'poach', 离间: 'discord' };
// The phrase each command plays (the original's $04D6 writes, research/music-cues-evidence.md §5, and
// research/music-cues.csv; assets/audio/*/cue-*.mp3 from tools/original_audio_placeholders.py). 侦察, 任命 and 分兵
// have none in the original.
const CUE_OF = { 防灾: 'cue-land', 赏赐: 'cue-industry', 赈济: 'cue-industry', 买米: 'cue-town', 卖米: 'cue-town', 卖宝: 'cue-town',
  调遣: 'cue-move', 搜索: 'cue-move', 运输: 'cue-move', 同盟: 'cue-envoy', 诱纳: 'cue-envoy', 离间: 'cue-envoy', 记录: 'cue-record',
  征兵: 'cue-conscript', 铁铺: 'cue-conscript', 医馆: 'cue-study', 书馆: 'cue-study' };
export const cueFor = (act, sub) => (act === '开发' ? { land: 'cue-land', industry: 'cue-industry', pop: 'cue-town' }[sub] || 'cue-land' : CUE_OF[act]);
export const sceneFor = (act, sub) => (act === '开发' ? { land: 'land', industry: 'industry', pop: 'pop' }[sub] || 'land' : SCENE_OF[act]);

// ---------- assets ----------
let index = null;
const images = new Map();
const img = (src) => { if (!images.has(src)) images.set(src, new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = `assets/ai/vignettes/${src}`; })); return images.get(src); };
async function load(scene) {
  index ||= await fetch('assets/ai/vignettes/index.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
  const S = index[scene]; if (!S) return null;
  const storyImg = await img(S.story.src);
  return storyImg ? { ...S, storyImg } : null;
}
const CN = '〇一二三四五六七八九';
const cnum = (n) => String(n).split('').map((d) => CN[d]).join('');
const MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export const recordText = (year, month, who) => [`${cnum(year)}年`, `${MONTH[month]}月`, who, '记'];

// One frame of a scene at time t (seconds since it opened).
function paint(c, S, t, st) {
  const span = st.span ?? 3;
  story(c, S, t, span, st.part);
  if (S.text && st.text) write(c, S, t, span, st.text);
}
// A storyboard scene: one painted shot told in frames (tools/storyboard_prompts.mjs), spread over the show's
// span (seconds) by their holds and resting on the last one, each frame easing in over the one before.
// part picks the frames: 'attempt' stops on the last one that does not give away the outcome (S.story.attempt), for a
// 计略 or mission that fails; 'after' plays the rest; a number stops on that frame. The last one shown is held longest.
// Each frame eases in over the one before for `blend` seconds, or for at most two fifths of its own time when the show
// runs fast: at 4× a frame has about 65 ms, and a fixed 120 ms never let any frame stand whole (D36, 2026-11-10).
// The frames `part` plays: the first one's index and each one's hold, the last one held 1.6.
function framesOf(story, part) {
  const { attempt = 8 } = story, n = story.hold.length;
  const from = part === 'after' ? attempt + 1 : 0, to = part === 'attempt' ? attempt : typeof part === 'number' ? part : n - 1;
  return { from, hold: story.hold.slice(from, to + 1).map((h, i, a) => (i === a.length - 1 ? 1.6 : h)) };
}
export function storyAt(story, t, span, part) {
  const { blend = 0 } = story, { from, hold } = framesOf(story, part);
  const unit = span / hold.reduce((a, b) => a + b, 0);
  let k = Math.max(0, t) / unit, i = 0;
  while (i < hold.length - 1 && k >= hold[i]) k -= hold[i++];
  const into = k * unit, fade = Math.min(blend, hold[i] * unit * 0.4);
  return { frame: from + i, alpha: i && into < fade ? into / fade : 1 };
}
// When (ms into a show of span ms) the last frame storyAt plays has eased in whole and rests.
export function restAt(story, span, part) {
  const { blend = 0 } = story, { hold } = framesOf(story, part), unit = span / hold.reduce((a, b) => a + b, 0);
  return (hold.reduce((a, b) => a + b, 0) - 1.6) * unit + Math.min(blend * 1000, 1.6 * unit * 0.4);
}
function story(c, S, t, span, part) {
  const { cols } = S.story, { frame, alpha } = storyAt(S.story, t, span, part);
  const put = (i) => c.drawImage(S.storyImg, (i % cols) * S.w, Math.floor(i / cols) * S.h, S.w, S.h, 0, 0, S.w, S.h);
  if (alpha < 1) { put(frame - 1); c.globalAlpha = alpha; put(frame); c.globalAlpha = 1; } else put(frame);
}
// 记录: the date set in red on the open scroll, one character after another. The text lies on the paper: T.quad is the
// paper's corners in the frame (far left, far right, near right, near left). The writer sits at the near left long edge,
// so columns run across the paper's width (u falling) and follow one another from the roller toward the far end
// (v falling). T.from and T.to are the share of the show the writing takes.
function onPaper([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) { // unit square → quad (Heckbert)
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den, a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
}
const GLYPH = 64, glyphs = new Map();
function glyph(ch) {
  if (glyphs.has(ch)) return glyphs.get(ch);
  const cv = document.createElement('canvas'); cv.width = cv.height = GLYPH;
  const g = cv.getContext('2d'); g.font = `${GLYPH - 6}px "Ma Shan Zheng", "Noto Serif SC", serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = g.strokeStyle = '#b01a14'; g.lineWidth = 1.6;
  g.fillText(ch, GLYPH / 2, GLYPH / 2 + 2); g.strokeText(ch, GLYPH / 2, GLYPH / 2 + 2);
  glyphs.set(ch, cv); return cv;
}
function write(c, S, t, span, text) {
  const T = S.text, at = onPaper(T.quad), cells = [];
  text.forEach((col, i) => [...col].forEach((ch, j) => cells.push({ ch, u: T.u - j * T.du, v: T.v - i * T.dv })));
  const start = T.from * span, per = (T.to - T.from) * span / cells.length;
  c.save(); c.imageSmoothingEnabled = true; c.globalCompositeOperation = 'multiply';
  cells.forEach((p, i) => {
    const k = Math.max(0, Math.min(1, (t - start - i * per) / per)); if (!k) return;
    // a character's top is toward the far long edge, its right toward the roller
    const [ox, oy] = at(p.u, p.v - T.sv / 2), [rx, ry] = at(p.u, p.v + T.sv / 2), [dx, dy] = at(p.u - T.su, p.v - T.sv / 2);
    c.save(); c.transform((rx - ox) / GLYPH, (ry - oy) / GLYPH, (dx - ox) / GLYPH, (dy - oy) / GLYPH, ox, oy);
    c.drawImage(glyph(p.ch), 0, 0, GLYPH, GLYPH * k, 0, 0, GLYPH, GLYPH * k); c.restore();
  });
  c.restore();
}

// ---------- player ----------
// A timed show (ms): how long its frames have before the wipe out begins.
export const showSpan = (duration) => duration - 320 * Math.min(1, duration / 3200);
// Plays framed in the middle of the screen. books: how many 命令书 the show tells as spent. onBook(), when given, makes it a 命令书 command's show at the
// original's beats: the book blinks 2.13 s and onBook() fires halfway, the picture plays 4.24 s with its text
// typed at the original's rate, and at 原版 it then waits for a key (▼) as the original does; a key during the
// show jumps to that end. At 快速 / 最快 the beats divide and it closes by itself.
// Without onBook (war-map 计略, tax, AI war) the picture opens at once.
// Resolves false (without showing anything) when vignettes are off or the scene has no art yet.
// result, when given, takes the caption's place once the scene has played (all its frames told, the last one resting),
// so the outcome is told after the performance rather than before it; caption then says only what is being done.
// A key during the picture jumps to the result, told whole. Shows that close by themselves then hold it RESULT_HOLD.
// duration (ms), when given, is the whole show's length from the first frame to the end of the wipe, so a
// presentation can be timed to the original's (src/pace.js); without it the show keeps its own length.
// force plays even with vignettes switched off (a picture that stands in for an original screen, not a 命令演出).
// onShow() runs on the picture's first frame: the command's or 计略's phrase starts there, with the picture, not
// before the book's blink or while the art loads (playtest of 2026-10-31, F07). No select blip opens it (F06).
// part: which frames of a storyboard to play (see story()), so the picture never tells an outcome the game did not reach.
export async function playVignette({ scene, caption, onBook, books = 1, onShow, audio, text, result, duration, force, part }) {
  const S = (enabled || force) && scene ? await load(scene) : null;
  if (!S) return false;
  const start = performance.now();
  let skip = false;
  // Played large in the middle of the screen (0.1.0 framed it over the small city panel).
  const box = h('div', { class: 'vig floating', role: 'img', 'aria-label': caption.replace(/\u2060/g, ''), title: '点击跳过', 'data-scene': scene }), dim = h('div', { class: 'vig-dim' });
  const cv = h('canvas', { width: S.w, height: S.h }), cap = h('div', { class: 'vig-cap' });
  box.append(h('div', { class: 'vig-frame' }, cv), cap);
  // A 命令书 show holds the screen as the original does: other keys and clicks around the picture go to it, not
  // to the map or the menus underneath (a click anywhere counts as the key).
  const onKey = (e) => {
    if (keyTaken(e)) return;
    if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); skip = true; } else if (onBook) { e.preventDefault(); e.stopPropagation(); }
  };
  box.addEventListener('click', () => (skip = true));
  if (onBook) { dim.style.pointerEvents = 'auto'; dim.addEventListener('click', () => (skip = true)); document.body.append(dim); } // from the book's blink on
  addEventListener('keydown', onKey, true);
  const wait = async (ms) => { const t0 = performance.now(); while (!skip && performance.now() - t0 < ms) await sleep(30); };

  // 1. The spent book blinks, then burns (the original drops the count halfway through its timer).
  const cmd = !!onBook;
  if (cmd) {
    const pip = [...document.querySelectorAll('.topbar .books i:not(.used)')].pop(), num = document.querySelector('.topbar .books + b');
    pip?.classList.add('blink'); num?.classList.add('blink');
    // The same beat told large in the middle, where the picture then opens: the books spent, then what is left (D63).
    const left = h('small', {}), tag = h('div', { class: 'vig-book', role: 'status' }, h('i'), h('span', {}, `消耗命令书 ${books} 张`), left);
    document.body.append(tag); requestAnimationFrame(() => tag.classList.add('in'));
    await wait(paced(ORIGINAL.command / 2)); pip?.classList.remove('blink'); onBook();
    const now = Number(num?.textContent);
    tag.classList.add('spent'); if (num && Number.isFinite(now)) left.replaceChildren(...(now ? ['剩 ', h('b', {}, now), ' 张'] : ['本月命令书用尽']));
    await wait(paced(ORIGINAL.command / 2)); num?.classList.remove('blink');
    tag.remove();
  }

  // 2. Stats wipe into the frame; 3. the scene loops while the result types out; 4. wipe back.
  document.body.append(dim, box); requestAnimationFrame(() => dim.classList.add('in'));
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  // with a set duration the typing, beats and wipe all scale with it (the 游戏速度 divides the duration)
  const k = duration ? Math.min(1, duration / 3200) : 1, typing = cmd ? paced(ORIGINAL.typeChar) : 45 * k, out = 320 * (cmd ? 1 / paceSpeed() : k);
  // A timed show's frames are told before its wipe begins, so the last one stands whole while the frame is still open:
  // spread over the whole duration, the wipe took the last frame's time and at 2× and 4× closed on it half faded in (D36).
  const t0 = performance.now(), st = { text, part, span: (duration ? showSpan(duration) : cmd ? paced(ORIGINAL.commandScene) : 3000) / 1000 }, due = pacer(); let raf = 0;
  const frame = (t = performance.now()) => { if (due(t)) paint(c, S, (performance.now() - t0) / 1000, st); raf = requestAnimationFrame(frame); };
  frame(); onShow?.();
  box.classList.add('in');
  // A word joiner (U+2060, app.js caption) rides with the character before it: it holds a line together, it is never typed.
  const chars = caption.match(/[^\u2060]\u2060*/gu) ?? [];
  for (let i = 1; i <= chars.length && !skip; i++) { cap.textContent = chars.slice(0, i).join(''); await sleep(typing); }
  cap.textContent = caption;
  // The outcome is told once the picture has played: its frames are all shown and the last one rests. The caption
  // meanwhile says only what is being done. A key during the picture jumps to the outcome, told whole, never past it.
  // (The original types its result while the picture plays; told before the picture shows it, the report after it
  // said nothing new: 大佬会不会看到@devblog #593.)
  const tell = async () => {
    const whole = skip; skip = false;
    box.setAttribute('aria-label', result.replace(/\u2060/g, '')); box.classList.add('told');
    if (!whole) { const more = result.match(/[^\u2060]\u2060*/gu) ?? []; for (let i = 1; i <= more.length && !skip; i++) { cap.textContent = more.slice(0, i).join(''); await sleep(typing); } }
    cap.textContent = result; skip = false;
  };
  if (cmd) {
    await wait(Math.max(0, paced(ORIGINAL.commandScene) - (performance.now() - t0)));
    if (result) await tell();
    if (paceSpeed() === 1) { // the original leaves the result up until A / B
      skip = false; box.append(h('span', { class: 'vig-more', 'aria-hidden': 'true' }, '▼'));
      while (!skip) await sleep(30);
    } else if (result) await wait(Math.max(800, paced(RESULT_HOLD))); // closing by itself, it still leaves the outcome up to be read
  } else {
    // A timed show keeps its length (an AI war's 7.09 s): its outcome comes as the last frame comes to rest, the
    // longest-held one, and stays up to the end. Untimed, it holds RESULT_HOLD after that.
    if (result) { await wait(Math.max(0, restAt(S.story, st.span * 1000, part) - (performance.now() - t0))); await tell(); }
    if (duration || !result) await wait(duration ? Math.max(0, duration - out - (performance.now() - start)) : Math.max(900, 2300 - chars.length * 45));
    else await wait(Math.max(800, paced(RESULT_HOLD)));
  }
  const wipe = skip ? Math.min(120, out) : out;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { box.style.animationDuration = `${wipe}ms`; dim.style.transitionDuration = `${wipe}ms`; } // the wipe runs as long as it is given
  box.classList.add('out'); dim.classList.remove('in'); await sleep(wipe);
  cancelAnimationFrame(raf); box.remove(); dim.remove(); removeEventListener('keydown', onKey, true);
  return true;
}
// Load a scene and draw it at time t onto a canvas (previews and checks).
export async function sceneFrame(scene, t, canvas, text) { const S = await load(scene); if (!S) return false; canvas.width = S.w; canvas.height = S.h; const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; paint(c, S, t, { text }); return true; }
