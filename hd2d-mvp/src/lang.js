// 系统 → 文字: 简体 or 繁體（台湾标准）. The game's text is written in 简体 everywhere (code, game-data.json, data packs) and the
// rules compare it as 简体 ('米店', '山', a pack's names), so nothing is translated at its source: in 繁體 the text is
// converted where it reaches the screen. This module patches those places once, before any screen is built (it is
// app.js's and save-editor's first import): text nodes, textContent / innerHTML / innerText, the title, placeholder,
// aria-label and alt attributes, the page title, and canvas fillText / strokeText / measureText (city plates, banners, unit
// glyphs drawn into textures). CSS ::before / ::after text is switched by :lang(zh-Hant) rules in ui.css and phone.css.
// The brush lettering changes face: Ma Shan Zheng has no 繁體 glyphs, so --brush (ui.css) and canvas fonts use LXGW WenKai TC.
// What reads text back from the page sees it converted: compare it with zh('简体') (app.js does), never a bare literal.
// Players' own names (the 鸣谢 roll, the makers) stay as written: rawText(s) is a text node the patches leave alone.
// The choice applies at load: switching on the title reloads it; in a game it waits for 回到标题 (app.js).
// 简体 is untouched: no patch is installed and zh() is the identity.
import TABLE from './zhtable.js';
import { makeConverter, makeReverse } from './zh.js';
import { readPref, writePref } from './prefs.js';

export const LANG_PREF = 'hd2d-lang';
export const LANGS = { hans: '简体', hant: '繁体' };
// Never chosen: a browser or system set to Taiwan, Hong Kong, Macau or 繁體 starts in 繁體, any other in 简体.
const fromSystem = () => {
  const tags = (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  const zh = tags.find((t) => /^zh\b/i.test(t ?? ''));
  return zh && /hant|-(tw|hk|mo)\b/i.test(zh) ? 'hant' : 'hans';
};
const forced = (() => { try { return new URLSearchParams(location.search).get('lang'); } catch { return null; } })(); // ?lang=hant for tests and shots
const url = forced === 'hans' || forced === 'hant' ? forced : null;
// What the player chose (or, never chosen, ?lang= or the system's), and the text this page shows: fixed until it reloads.
export const savedLang = () => { const v = readPref(LANG_PREF); return v === 'hans' || v === 'hant' ? v : url ?? fromSystem(); };
export const lang = url ?? savedLang();
export const setLang = (v) => writePref(LANG_PREF, v);
export const hant = lang === 'hant';

const conv = hant ? makeConverter(TABLE) : null;
const back = hant ? makeReverse(TABLE) : null;
export const zh = hant ? conv : (s) => s;
// 繁體 typed into a search box, back to the 简体 the names are kept in.
export const toHans = hant ? back : (s) => s;

const RAW = new WeakSet();
export const isRaw = (n) => RAW.has(n);
export function rawText(s) {
  const n = document.createTextNode('');
  RAW.add(n); n.data = String(s);
  return n;
}

// data-label: a key's name shown by ::before { content: attr(data-label) } (ui.css kbd.pg, kbd.keycap); no selector reads its text.
const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'data-label']);
function install() {
  const doc = document.documentElement;
  doc.lang = 'zh-Hant-TW';
  const wrap = (proto, key, f) => {
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (d?.set) Object.defineProperty(proto, key, { ...d, set(v) { d.set.call(this, f.call(this, v)); } });
  };
  const text = (v) => (typeof v === 'string' ? conv(v) : v);
  wrap(Node.prototype, 'textContent', text);
  wrap(Node.prototype, 'nodeValue', function (v) { return RAW.has(this) ? v : text(v); });
  wrap(CharacterData.prototype, 'data', function (v) { return RAW.has(this) ? v : text(v); });
  wrap(Element.prototype, 'innerHTML', text);
  wrap(Element.prototype, 'outerHTML', text);
  wrap(HTMLElement.prototype, 'innerText', text);
  wrap(HTMLElement.prototype, 'outerText', text);
  wrap(HTMLElement.prototype, 'title', text);
  wrap(HTMLInputElement.prototype, 'placeholder', text);
  wrap(HTMLTextAreaElement.prototype, 'placeholder', text);
  wrap(HTMLImageElement.prototype, 'alt', text);
  wrap(Document.prototype, 'title', text);
  const ih = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) { return ih.call(this, pos, text(html)); };
  const ctn = Document.prototype.createTextNode;
  Document.prototype.createTextNode = function (s) { return ctn.call(this, text(String(s))); };
  const sa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (k, v) { return sa.call(this, k, ATTRS.has(String(k).toLowerCase()) ? text(String(v)) : v); };
  // append('…'), prepend, before, after, replaceWith, replaceChildren: a string argument is a text node made here.
  const strArgs = (proto, key) => {
    const f = proto[key]; if (typeof f !== 'function') return;
    proto[key] = function (...a) { return f.apply(this, a.map((x) => (typeof x === 'string' ? conv(x) : x))); };
  };
  for (const proto of [Element.prototype, DocumentFragment.prototype, Document.prototype, CharacterData.prototype]) {
    for (const k of ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren']) if (Object.prototype.hasOwnProperty.call(proto, k)) strArgs(proto, k);
  }
  // Ma Shan Zheng has no 繁體 glyphs: canvas lettering asked of it is drawn in LXGW WenKai TC, as --brush is in ui.css.
  const face = (f) => (typeof f === 'string' ? f.replace(/(["']?)Ma Shan Zheng\1/g, '"LXGW WenKai TC"') : f);
  for (const C of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D].filter(Boolean)) {
    for (const k of ['fillText', 'strokeText', 'measureText']) {
      const f = C.prototype[k];
      C.prototype[k] = function (s, ...a) { return f.call(this, typeof s === 'string' ? conv(s) : s, ...a); };
    }
    wrap(C.prototype, 'font', face);
  }
  if (globalThis.FontFaceSet) {
    for (const k of ['load', 'check']) {
      const f = FontFaceSet.prototype[k];
      FontFaceSet.prototype[k] = function (font, t, ...a) { return f.call(this, face(font), t === undefined ? t : conv(String(t)), ...a); };
    }
  }
  // What the page's own markup already holds (index.html's title, the save editor's static form).
  document.title = document.title;
  const walker = document.createTreeWalker(document.body ?? doc, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.data = n.data;
  for (const el of (document.body ?? doc).querySelectorAll('[title], [placeholder], [aria-label], [alt], [data-label]')) {
    for (const k of ATTRS) if (el.hasAttribute(k)) el.setAttribute(k, el.getAttribute(k));
  }
}
if (hant && typeof document !== 'undefined') install();
// The desktop window asks its own questions (closing with a game on, desktop/main.js): in the same text as the page.
try { globalThis.window?.desktop?.setLang?.(lang); } catch { /* not the desktop build */ }
