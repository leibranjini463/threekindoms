// Small DOM toolkit for the game HUD: element builder, modal dialogs that resolve to a value,
// click-through message boxes, toasts, banners and officer/city pickers.
import { data, name, cityName, maxHp, artOf } from './core/game.js';
import { PHONE } from './phone.js';

// A mouse's side buttons (3 back, 4 forward) mean history back/forward to Chromium and Electron, and a game is
// never saved on its own, so a brushed side button used to leave the running game. Both pages swallow them here;
// the pages also move between each other with location.replace and the desktop shell keeps no history.
if (typeof addEventListener === 'function') {
  for (const type of ['mousedown', 'mouseup', 'auxclick']) addEventListener(type, (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); }, true);
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// The key a shortcut means, lower case: letters and digits by their place on the keyboard (e.code), so WASD, Q/E,
// T, Z… still work while a Chinese IME is on (e.key is then 'Process') and pan the same on any layout; others by e.key.
export const keyName = (e) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^(Digit|Numpad)[0-9]$/.test(e.code) ? e.code.slice(-1) : (e.key ?? '').toLowerCase());
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
// Clickable non-button elements (cards, rows): focusable, and Enter / Space activate them like a button.
export const pressable = (onclick, extra = {}) => ({ ...extra, tabindex: 0, role: 'button', onclick,
  onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onclick(e); } } });
export const root = () => $('#ui');
export function clear() { root().replaceChildren(); }
// Blocking dialogs (messages, modals) live on their own layer so a HUD redraw (clear) can never
// remove one while its promise is still pending; the map ignores clicks while one is open.
export const layer = () => $('#ui-top');
export const blocking = () => layer().childElementCount > 0;

let portraitFiles = {};
export const setPortraits = (p) => (portraitFiles = p);
// Painted art is indexed by officer id; an 阿会喃 copy (原版漏洞, core/ahuinan.js) wears 阿会喃's.
// Every officer has a painted portrait, half-body and four expressions (tests/artcoverage.test.mjs);
// 阿会喃's portrait is only a last resort, never the original pixel art.
const art = artOf; // a pack's officer, or an 阿会喃 copy, shows the officer whose pictures he borrows
const FALLBACK = 'assets/ai/portraits/0.webp';
export const portrait = (id) => portraitFiles[art(id)] || portraitFiles[0] || FALLBACK;
// Expressions. The original's selector $00A4 takes 0–4, but 0 and 1 share pixels for every face, so there
// are four: 0 calm, 2 angry (going to war, enemy attacks, taunted in a duel), 3 joy (good news, the victor),
// 4 grief (bad news, the loser). Painted busts load from assets/ai/faces/<id>-<mood>.webp.
export const MOODS = { calm: 0, angry: 2, joy: 3, grief: 4 };
let faceFiles = {};
export const setFaces = (f) => (faceFiles = f);
// Three framings (F08): every slot uses one of them, so officers line up the same way side by side.
// - avatar(id, mood): head and shoulders, the expression bust — every small slot (rosters, tables, legend,
//   result ledgers, battle cards, dialogs).
// - figure(id): the standard waist-up portrait (tools/halfbody_prompts.mjs) for the large slots (ruler
//   select, war unit panel, 白兵 face-off); the calm bust stands in until one is generated.
// - face(id): the free-pose illustration, shown whole only on the officer card.
let halfbodyFiles = {};
export const setHalfbody = (f) => (halfbodyFiles = f);
export const avatar = (id, mood = 'calm', cls = '') => face(id, `${cls} avatar`, mood);
export function figure(id, cls = '') {
  if (halfbodyFiles[art(id)]) return h('img', { src: halfbodyFiles[art(id)], class: `${cls} figure ai`, alt: name(id) });
  return avatar(id, 'calm', `${cls} figure`);
}
// face(id) is the officer's portrait; face(id, cls, mood) is the dialog bust with that expression.
export function face(id, cls = '', mood = null) {
  if (mood == null) return h('img', { src: portrait(id), class: `${cls} ai`, alt: name(id) });
  const f = faceFiles[art(id)];
  return h('img', { src: f?.[mood] || f?.calm || portrait(id), class: `${cls} ai`, alt: name(id) });
}

// Modal: build(close) returns content; close(value) resolves. Esc / backdrop click resolves null.
// title may be '' when the content carries its own heading (results, endings); label then names the dialog.
// forced: a decision the player must make — Esc and a click on the backdrop do not dismiss it.
// focus(box): the control the keys start on (the choice made last time, say) instead of the dialog itself. A held Enter or Space
// never presses anything in a dialog, so starting on a button does not let a key held from the dialog before run through this one.
export function modal(title, build, { wide = false, light = false, label = '', forced = false, focus = null } = {}) {
  return new Promise((resolve) => {
    // Keyboard: the dialog itself takes the focus (not its 确定, which an Enter held through the messages before it
    // would press), Tab cycles inside it, and the focus goes back where it was when it closes.
    const before = document.activeElement;
    const close = (v) => { shade.remove(); removeEventListener('keydown', esc); if (before?.isConnected) before.focus?.({ preventScroll: true }); resolve(v); };
    const esc = (e) => {
      if (shade !== layer().lastElementChild) return; // only the topmost one
      if (e.key === 'Escape' && !forced) close(null);
      else if (e.key === 'Tab') {
        const f = $$('button:not(:disabled), input:not(:disabled), select, [tabindex="0"]', box).filter((el) => el.offsetParent);
        e.preventDefault();
        if (!f.length) { box.focus({ preventScroll: true }); return; } // nothing to move to: the focus stays on the dialog
        const i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length;
        f[n].focus();
      }
    };
    const box = h('div', { class: 'panel modal', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': label || title, style: wide ? { minWidth: 'min(720px,94vw)' } : null }, title ? h('h3', {}, title) : null);
    const shade = h('div', { class: `shade ${light ? 'light' : ''}`, onmousedown: (e) => { if (e.target === shade && !forced) close(null); } }, box);
    box.append(...[build(close)].flat().filter((x) => x != null && x !== false));
    box.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.tagName !== 'INPUT') { e.preventDefault(); e.stopPropagation(); } }, true);
    layer().append(shade); addEventListener('keydown', esc);
    const first = focus?.(box);
    if (first?.isConnected && !first.disabled) first.focus({ preventScroll: true });
    if (!box.contains(document.activeElement)) box.focus({ preventScroll: true }); // a build() that focused a field of its own keeps it
  });
}
// focusOk: the keys start on 确定 (a step the player walks through with Enter, as 再施 → its target → this).
export const confirmBox = (title, text, { focusOk = false } = {}) => modal(title, (close) => [h('p', {}, text), h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(false) }, '取消'), h('button', { class: 'btn primary', onclick: () => close(true) }, '确定'))],
  { focus: (box) => (focusOk ? box.querySelector('.btn.primary') : null) });

// Story message with optional portrait; click / key to continue.
// The text types out; the first click / key finishes it, the next one continues.
// auto (ms, already paced): the box closes by itself that long after it opens, as the original's timed
// windows do (another faction's succession or fall); a click or Enter still closes it sooner.
export function message(title, text, who = null, mood = 'calm', { auto = 0 } = {}) {
  return new Promise((resolve) => {
    if (auto) setTimeout(() => el.isConnected && done(), auto);
    const body = h('p', { html: text }), more = h('span', { class: 'more' }, '▼ 点击继续');
    const nodes = [], walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) { nodes.push([walk.currentNode, walk.currentNode.textContent]); walk.currentNode.textContent = ''; }
    const total = nodes.reduce((a, [, t]) => a + t.length, 0);
    let shown = 0, timer = null;
    const paint = () => { let left = shown; for (const [n, t] of nodes) { n.textContent = t.slice(0, Math.max(0, left)); left -= t.length; } };
    const finish = () => { clearInterval(timer); timer = null; shown = total; paint(); more.hidden = false; };
    const advance = () => { if (timer) finish(); else done(); };
    let gone = false;
    const done = () => { gone = true; clearInterval(timer); el.remove(); removeEventListener('keydown', key); removeEventListener('pointerdown', down, true); removeEventListener('click', away, true); resolve(); };
    // A click anywhere continues, as Enter does from anywhere and as any button did in the original: the player need not travel to
    // the box. The click is taken here, so it presses nothing under the pointer (a HUD button, the map). It counts only when its
    // press began with this box up and on top (not the release of the click that opened it, nor a click meant for a dialog opened
    // over it) and stayed in place: a drag still moves the camera to look at the map behind the box.
    let press = null;
    const onTop = () => el === layer().lastElementChild;
    const down = (e) => { press = e.button === 0 && onTop() && !el.contains(e.target) ? { x: e.clientX, y: e.clientY } : null; };
    const away = (e) => {
      const p = press; press = null;
      if (!p || !onTop() || el.contains(e.target) || Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 6) return;
      e.preventDefault(); e.stopPropagation(); advance();
    };
    const key =(e) => { if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); e.key === 'Escape' ? done() : advance(); } };
    const el = h('div', { class: `panel msg ${who == null ? 'noimg' : ''}`, role: 'dialog', 'aria-label': title, onclick: advance },
      who != null ? face(who, '', mood) : null, h('div', {}, h('h4', {}, title), body), more);
    more.hidden = true;
    layer().append(el);
    addEventListener('pointerdown', down, true); addEventListener('click', away, true);
    shown = total; paint(); body.style.minHeight = `${body.offsetHeight}px`; shown = 0; paint(); // reserve the final height so the box does not grow while typing
    if (auto || matchMedia('(prefers-reduced-motion: reduce)').matches) finish(); // a timed box shows all of its text at once
    else timer = setInterval(() => { shown += 2; paint(); if (shown >= total) finish(); }, 33);
    // Not for a box already closed (a click within these 150 ms, a short timed one): its listener would stay for good and swallow
    // every Enter and Space after it, so no focused button could be pressed by the keys.
    setTimeout(() => { if (!gone) addEventListener('keydown', key); }, 150);
  });
}
export function toast(text, ms = 1800) {
  const kind = text.startsWith('<em>') ? 'bad' : text.startsWith('<strong>') ? 'good' : 'info';
  // On <body>, not #ui: the HUD redraw that follows a command clears #ui and would take the toast with it.
  document.querySelectorAll('body > .toast').forEach((t) => t.remove()); // one at a time, newest wins
  const el = h('div', { class: `panel toast ${kind}`, role: 'status' }, h('span', { class: 'ic' }, { bad: '✕', good: '✓', info: '◆' }[kind]), h('span', { html: text }));
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), ms - 250); setTimeout(() => el.remove(), ms);
}
// ms: how long the caller waits on it (the banner itself stays 400 ms longer as it fades).
export function banner(text, color, ms = 1100) {
  const el = h('div', { class: 'banner', style: { '--c': color } }, h('span', {}, text));
  document.body.append(el); setTimeout(() => el.remove(), ms + 400);
  return new Promise((r) => setTimeout(r, ms));
}

// Officer row used in rosters and pickers.
export function officerRow(g, id, { on, onclick, extra } = {}) {
  const o = g.officers[id];
  return h('div', { class: `off ${on ? 'on' : ''}`, 'data-id': id, ...(onclick ? pressable(onclick, { 'aria-pressed': on ? 'true' : null }) : {}) },
    avatar(id),
    // 军 on the name line, where a narrow panel has room (侦察 reads a rival's officers here, 霸王之王@devblog 2026-11-25).
    h('div', {}, h('div', { class: 'nm' }, name(id), extra ? h('em', {}, extra) : null, h('small', { class: 'army' }, `${o.army}军`)),
      h('div', { class: 'sub' }, ...[['武', o.war], ['智', o.int], ['德', o.virtue], ['忠', o.loyalty]].map(([k, v]) => h('span', {}, k, h('b', {}, v))))),
    h('div', { class: 'tr' }, h('b', {}, o.soldiers), h('br'), `体${o.hp}/${maxHp(o, id)}`));
}
// Officer list as the original lays it out: one line per officer, the numbers in aligned columns
// (体 武 知 忠 德) so officers compare at a glance; a column header sorts by it (again: back to roster order).
// opts: selected (Set, marks rows), onPick(id), extra(id) → tag after the name, disabled(id) → reason or null.
const COLS = [['体', (o, d) => o.hp, (o) => `${o.hp}/${maxHp(o)}`, (o) => o.hp < maxHp(o) / 2], ['武', (o) => o.war], ['智', (o) => o.int], ['德', (o) => o.virtue],
  ['忠', (o) => o.loyalty, null, (o) => o.loyalty < 60], ['兵', (o) => o.soldiers], ['军', (o) => o.army, (o) => o.army]];
// cols: more columns after the standard ones, in COLS's form (the 铁铺 adds the gear each one has, feedback R08).
export function officerTable(g, ids, { selected = null, onPick, extra, disabled, cols = [] } = {}) {
  let sortBy = -1;
  const COLS_ = [...COLS, ...cols];
  const table = h('table', { class: 'otable' });
  const draw = () => {
    const D = data().officers, list = sortBy < 0 ? ids : [...ids].sort((a, b) => { const k = COLS_[sortBy][1]; return k(g.officers[b], D[b]) - k(g.officers[a], D[a]) || 0; });
    const head = h('tr', {}, h('th', { class: 'ck' }), h('th', { class: 'nm' }, '武将'), ...COLS_.map(([t], i) => h('th', { class: sortBy === i ? 'on' : '', title: `按${t}排序`, onclick: () => { sortBy = sortBy === i ? -1 : i; draw(); } }, t)));
    table.replaceChildren(h('thead', {}, head), h('tbody', {}, ...list.map((id) => {
      const o = g.officers[id], d = D[id], why = disabled?.(id), on = selected?.has(id);
      return h('tr', { class: `${on ? 'on' : ''} ${why ? 'off-dis' : ''}`, 'data-id': id, title: why || null, ...(onPick && !why ? pressable(() => onPick(id), { 'aria-pressed': selected ? String(!!on) : null }) : {}) },
        h('td', { class: 'ck' }, selected ? (on ? '✓' : '') : avatar(id)),
        h('td', { class: 'nm' }, selected ? avatar(id) : null, name(id), extra?.(id) ? h('em', {}, extra(id)) : null, why ? h('em', { class: 'why' }, why) : null),
        ...COLS_.map(([, v, show, low]) => h('td', { class: low?.(o, d) ? 'low' : '' }, show ? show(o, d) : v(o, d))));
    })));
  };
  draw();
  table.redraw = draw;
  return table;
}
// Multi/single select of officers. Resolves to array of ids (or null).
// summary(selected ids) replaces the plain count in the footer (出阵: troops taken, garrison left).
// last: the officer picked for this the time before, if he is still in the list: his row is marked 上次 and the keys start on it.
export function pickOfficers(g, title, ids, { min = 1, max = 1, note = '', extra, summary, cols, last = null } = {}) {
  if (!ids.includes(last)) last = null;
  const extra0 = extra; if (last != null) extra = (id) => [extra0?.(id), id === last ? '上次' : null].filter(Boolean).join(' ') || null;
  return modal(title, (close) => {
    const sel = new Set(), single = max === 1 && min === 1;
    const ok = h('button', { class: 'btn primary', disabled: true, onclick: () => close([...sel]) }, '确定');
    const count = h('span', { class: 'hint count' });
    const all = h('button', { class: 'btn', onclick: () => { if (sel.size) sel.clear(); else for (const id of ids.slice(0, max)) sel.add(id); draw(); } });
    const table = officerTable(g, ids, { selected: single ? null : sel, extra, cols, onPick: (id) => {
      if (single) return close([id]);
      if (sel.has(id)) sel.delete(id); else { if (max === 1) sel.clear(); if (sel.size < max) sel.add(id); }
      draw();
    } });
    const draw = () => {
      const focused = table.contains(document.activeElement) ? document.activeElement.dataset.id : null;
      table.redraw(); if (focused != null) table.querySelector(`tr[data-id="${focused}"]`)?.focus();
      ok.disabled = sel.size < min;
      count.innerHTML = `已选 <b>${sel.size}</b> / ${max}${summary ? `　${summary([...sel])}` : ''}`;
      all.textContent = sel.size ? '清除' : ids.length > max ? `选前${max}人` : '全选';
    };
    draw();
    return [note ? h('p', { class: 'hint' }, note) : null, h('div', { class: 'otable-wrap' }, table),
      !single ? h('div', { class: 'foot' }, count, h('span', { style: { flex: 1 } }), all, h('button', { class: 'btn', onclick: () => close(null) }, '取消'), ok) : h('p', { class: 'hint' }, '点选一名武将　点表头可排序　Esc 取消')];
  }, { wide: true, focus: (box) => (last != null ? box.querySelector(`tr[data-id="${last}"]`) : null) });
}
// hover(cid | null) lets the caller point the city out on the map while its button is hovered or focused.
export async function pickCity(title, cids, describe = () => '', { hover } = {}) {
  const res = await modal(title, (close) => [h('div', { class: 'cities' }, cids.map((c) => h('button', { class: 'btn', onclick: () => close(c),
    onmouseenter: () => hover?.(c), onfocus: () => hover?.(c), onmouseleave: () => hover?.(null) },
    cityName(c), describe(c) ? h('small', { style: { marginLeft: '6px', color: 'var(--dim)' } }, describe(c)) : null))),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'))], { light: !!hover });
  hover?.(null);
  return res;
}
// Slider rows: fields [{key,label,min,max,step,value}] → resolves {key:value} or null.
// live(vals) → html shown under the sliders and refreshed as they move (e.g. how long the rice lasts).
// Each row also has a box to type the amount in (feedback G03, 2026-11-04). What the box holds counts once it is a legal amount;
// until then 确定 waits, and leaving the box (or Enter) puts it right in sight: empty is the last amount, otherwise the nearest legal one.
export function sliders(title, fields, { note = '', ok = '确定', validate, live } = {}) {
  return modal(title, (close) => {
    // The starting amount is kept inside the row: 赏金 starts at 50, but with 10–19 金 the only amount is 10, the slider has nothing
    // to move and 确定 sent the 50 the city did not have (西风@devblog, 2026-11-17).
    const vals = Object.fromEntries(fields.map((f) => [f.key, Math.max(f.min, Math.min(f.max, f.value ?? f.min))]));
    const unsettled = new Set(), boxes = [];
    // A press on 确定 takes the focus from a box, which puts the amount right and would free the button before the release: a click
    // pressed while a box was unsettled only shows the corrected amount, it confirms nothing. So an unsettled box greys the button
    // by aria-disabled: a natively disabled one never hears the press.
    let pressedUnsettled = false;
    const btn = h('button', { class: 'btn primary', onpointerdown: () => { pressedUnsettled = unsettled.size > 0; },
      onclick: (e) => { const held = e.detail > 0 && pressedUnsettled; pressedUnsettled = false; if (!held && !unsettled.size) close(vals); } }, ok);
    const info = live ? h('p', { class: 'live' }) : null;
    const check = () => {
      btn.setAttribute('aria-disabled', String(unsettled.size > 0));
      btn.disabled = !unsettled.size && validate ? !validate(vals) : false;
      if (info) info.innerHTML = live(vals);
    };
    const rows = fields.map((f) => {
      // keep: leave the thumb where the pointer put it (a drag), only the value snaps.
      const set = (v, keep = false) => { vals[f.key] = Math.max(f.min, Math.min(f.max, v)); if (!keep) input.value = vals[f.key]; out.value = vals[f.key]; settle(true); check(); ends(); };
      const ends = () => { if (less) { less.disabled = f.max <= f.min || vals[f.key] <= f.min; more.disabled = f.max <= f.min || vals[f.key] >= f.max; } };
      const settle = (on) => { unsettled[on ? 'delete' : 'add'](f.key); out.classList.toggle('bad', !on); };
      // The native range runs in steps of 1 so its ends are the real min and max (a step-10 range stops at
      // 130 under a max of 137, or at 0 under 7). A drag takes the nearest step — or the max, when that is
      // nearer than the step past it — so the value only ever follows the pointer. Arrow and page keys move
      // one step from the current value (onto the grid, or to an end); Home / End stay native.
      const step = f.step || 1;
      const nearest = (v) => {
        if (v >= f.max || v <= f.min) return v;
        const s = f.min + step * Math.round((v - f.min) / step);
        return s > f.max ? f.max : s;
      };
      const stepFrom = (v, dir) => {
        const k = (v - f.min) / step;
        return f.min + step * (dir > 0 ? Math.floor(k) + 1 : Math.ceil(k) - 1);
      };
      const KEYS = { ArrowRight: 1, ArrowUp: 1, PageUp: 1, ArrowLeft: -1, ArrowDown: -1, PageDown: -1 };
      const input = h('input', { type: 'range', min: f.min, max: f.max, step: 1, value: vals[f.key], disabled: f.max <= f.min, 'aria-label': f.label,
        oninput: (e) => set(nearest(Number(e.target.value)), true),
        onkeydown: (e) => { const d = KEYS[e.key]; if (!d) return; e.preventDefault(); set(stepFrom(vals[f.key], d)); } });
      // Digits only, full-width ones (a Chinese IME's) included. A partly typed amount is left as it stands: the 1 of a 100 under a minimum of 10.
      const typed = () => {
        const text = out.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, ''), n = Number(text);
        if (text !== out.value) out.value = text;
        if (text !== '' && n >= f.min && n <= f.max && nearest(n) === n) set(n); else { settle(false); check(); }
      };
      // Puts an unsettled box right; true if it had to.
      const commit = () => {
        if (!unsettled.has(f.key)) return false;
        set(out.value === '' ? vals[f.key] : nearest(Math.max(f.min, Math.min(f.max, Number(out.value)))));
        return true;
      };
      let fresh = false; // a click that gave the box the focus leaves the whole amount selected, ready to be typed over
      const out = h('input', { class: 'val amount', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 6, value: vals[f.key], disabled: f.max <= f.min, 'aria-label': `${f.label}数量`,
        onfocus: () => { fresh = true; out.select(); }, onmouseup: (e) => { if (fresh) e.preventDefault(); fresh = false; }, onblur: commit,
        oninput: (e) => { if (!e.isComposing) typed(); }, oncompositionend: typed,
        onkeydown: (e) => {
          if (e.isComposing) return;
          if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); commit(); set(stepFrom(vals[f.key], KEYS[e.key])); return; }
          if (e.key !== 'Enter' || e.repeat) return;
          // Enter shows a corrected amount and stops there; a good one goes on to the next box, the last to 确定.
          e.preventDefault();
          if (commit()) return;
          const next = boxes.slice(boxes.indexOf(out) + 1).find((b) => !b.disabled);
          if (next) next.focus(); else if (!btn.disabled) btn.click();
        } });
      boxes.push(out);
      const quick = (t, v) => h('button', { class: 'btn mini', disabled: f.max <= f.min, onclick: () => set(v) }, t);
      // Phone: − and ＋ at the slider's ends, one step a tap (a thumb cannot set 1 in 9999 by dragging). Held, the button repeats, and
      // the longer it is held the more steps each repeat takes, so a far amount is reached without a hundred taps.
      const nudge = (dir) => {
        let timer = 0, reps = 0;
        const stop = () => { clearTimeout(timer); timer = 0; };
        const go = () => { commit(); const k = reps < 12 ? 1 : reps < 30 ? 5 : reps < 60 ? 20 : 100; reps++; set(stepFrom(vals[f.key], dir) + dir * step * (k - 1)); };
        const again = () => { if (b.disabled || !b.isConnected) return stop(); go(); timer = setTimeout(again, 80); };
        const b = h('button', { class: `btn mini nudge ${dir < 0 ? 'less' : 'more'}`, 'aria-label': `${f.label}${dir < 0 ? '减少' : '增加'}`,
          onpointerdown: (e) => { if (b.disabled) return; e.preventDefault(); stop(); reps = 0; go(); timer = setTimeout(again, 380); },
          onpointerup: stop, onpointercancel: stop, onpointerleave: stop,
          onclick: (e) => { if (e.detail === 0) { reps = 0; go(); } } }, dir < 0 ? '−' : '＋'); // a key or a script; a pointer has stepped already
        return b;
      };
      const less = PHONE ? nudge(-1) : null, more = PHONE ? nudge(1) : null;
      ends();
      return h('div', { class: 'row' }, h('label', {}, f.label), quick('最少', f.min), less, input, more, quick('最多', f.max), out, h('small', { class: 'hint' }, `上限 ${f.max}`));
    });
    check();
    return [note ? h('p', { class: 'hint', html: note }) : null, ...rows, info, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'), btn)];
  });
}
