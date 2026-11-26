// The phone build of the HUD (docs/手机H5适配设计_2026-11-14.md): a landscape touch layout over the same DOM, in src/phone.css
// under body.phone. PHONE is decided once, at load: a touch-only device or a mobile device with touch, whose short side is under 600 CSS px (a tablet
// keeps the desktop layout), or ?phone on a desktop browser for the tools and tests (?phone=0 turns it off on a phone).
// Nothing here runs on a desktop window: PHONE is false and the body gets no class.
const q = new URLSearchParams(globalThis.location?.search ?? '');
const mm = (s) => !!globalThis.matchMedia?.(s).matches;
// A phone may also report a mouse or trackpad (B站 Toy on Android). Keep mixed-input touch PCs on the desktop layout.
const touchOnly = mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
const mobile = globalThis.navigator?.userAgentData?.mobile === true || /\b(Android|iPhone|iPad|iPod)\b/i.test(globalThis.navigator?.userAgent ?? '');
const mobileTouch = mobile && (mm('(pointer: coarse)') || mm('(any-pointer: coarse)'));
const short = Math.min(globalThis.screen?.width ?? 9999, globalThis.screen?.height ?? 9999);
// TOUCH: a finger drives the game, whatever the screen's size (a tablet too): the maps take two fingers for themselves, the page
// never zooms or scrolls under them, and a long press brings no menu. PHONE adds the phone's own layout on a short screen. Before
// 2026-11-20 the one flag did both, and an Android tablet (short side 800) lost the touch handling with the layout: Chrome took the
// two fingers for its own gesture and cancelled our pointers mid-pinch (docs/dev/pitfalls/ui-input.md). ?touch / ?touch=0 for tests.
const touchSeen = touchOnly || mobileTouch;
export const PHONE = q.has('phone') ? q.get('phone') !== '0' : touchSeen && short < 600;
export const TOUCH = PHONE || (q.has('touch') ? q.get('touch') !== '0' : touchSeen);
// The flat maps' canvas pixels per CSS px (src/warmap2d.js, src/strategyflat.js). 2 on a touch screen: a 3× phone at 3 cost frames
// for nothing seen at arm's length. 3 on a desktop, where 系统 → 界面大小 zooms a 3840x2160 window to 2.5 (desktop/uiscale.js)
// and 2 drew the maps soft.
export const FLAT_DPR = TOUCH ? 2 : 3;

// The safe area (notch, home bar) in CSS px, measured from env(safe-area-inset-*); index.html asks for viewport-fit=cover.
// ?safe=l,r,t,b stands in for a phone's in a desktop browser.
let probe = null;
const forced = q.get('safe')?.split(',').map(Number);
export function safeArea() {
  if (forced) { const [l = 0, r = 0, t = 0, b = 0] = forced; return { l, r, t, b }; }
  if (!globalThis.document?.body) return { l: 0, r: 0, t: 0, b: 0 };
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;z-index:-1;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe), px = (k) => parseFloat(cs[k]) || 0;
  return { l: px('paddingLeft'), r: px('paddingRight'), t: px('paddingTop'), b: px('paddingBottom') };
}

// The margins the HUD keeps: inside the safe area, and never tighter than 10 px (8 at the bottom, above the home bar).
export function margins() { const s = safeArea(); return { l: Math.max(10, s.l), r: Math.max(10, s.r), t: Math.max(6, s.t), b: Math.max(8, s.b) }; }
function applyMargins() {
  const m = margins(), st = document.body.style; // on <body>: src/phone.css gives the tokens their fallbacks there
  st.setProperty('--g', `${m.l}px`); st.setProperty('--gr', `${m.r}px`); st.setProperty('--gt', `${m.t}px`); st.setProperty('--gb', `${m.b}px`);
  // The page's height as the browser shows it now (Safari's bars come and go): the layout follows innerHeight, not 100vh.
  st.setProperty('--vh', `${innerHeight}px`);
}

if (TOUCH && globalThis.document) {
  // src/ui.css gives the maps under body.touch their touch-action: none.
  document.body.classList.add('touch');
  document.documentElement.style.overscrollBehavior = 'none';
  // The page itself never zooms or scrolls: two fingers belong to the map (iOS Safari ignores user-scalable=no).
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest?.('input, textarea')) e.preventDefault(); }); // no long-press menu
}

if (PHONE && globalThis.document) {
  document.body.classList.add('phone');
  // The phone's stylesheet is fetched here, on a phone only. A desktop window never loads it: its rules would match nothing there,
  // but its :has() selectors still cost the browser a little on every redraw of the HUD (a frame late in tests/strategyflat's
  // title-to-record ease, 2026-11-14).
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('./phone.css?v=8', import.meta.url).href }));
  applyMargins();
  for (const t of ['resize', 'orientationchange']) addEventListener(t, () => { applyMargins(); setTimeout(applyMargins, 300); });
  // (Double-tap zoom is turned off in src/phone.css with touch-action, which leaves a quick second tap its click.)
  // A tap on the city panel's header or on a general's card (not on a button in it) folds it open and shut; the state
  // is on <body> so it outlives the HUD's redraws.
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dock .tabs')) return void document.body.classList.remove('city-open'); // the command list takes the open panel's place
    if (e.target.closest?.('button, a, input, summary, .acts')) return;
    if (e.target.closest?.('.citypanel header')) document.body.classList.toggle('city-open');
    else if (e.target.closest?.('.unitpanel:not(.compare)')) document.body.classList.toggle('card-open');
    else if (!e.target.closest?.('.citypanel')) document.body.classList.remove('city-open');
  });
}

// A key or mouse hint reworded for touch: hint(桌面的说法, 手机的说法).
export const hint = (desk, touch) => (PHONE ? touch : desk);
