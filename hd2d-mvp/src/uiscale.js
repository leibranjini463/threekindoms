// 系统 → 界面大小 (标准 / 大 / 小 / 中, the desktop game only), remembered across restarts: the whole page, panels, menus and
// maps, zoomed by the window's size, so a 1920x1080 or 2560x1440 screen at Windows' 100% no longer draws the UI small in
// a corner (2026-11-21). The shell does the zooming (desktop/uiscale.js, main.js); the page only says which size. A browser
// has no window.desktop.setUiSize and no row: there the browser's own zoom (Ctrl +) does the same.
// The row names the zoom in use (界面大小 标准 175%): a window can hold two sizes to one zoom, and the name alone did not say
// so (一光年的距离@devblog #643: 标准 and 大 both 175% in a window, 2026-11-24).
import { readPref, writePref } from './prefs.js';

const KEY = 'hd2d-ui-size';
// The order of the row's clicks: 标准 first (the default), then larger, then the smallest and up again.
export const UI_SIZES = [['normal', '标准'], ['large', '大'], ['small', '小'], ['medium', '中']];
const desk = globalThis.window?.desktop;
let cur = UI_SIZES.find(([k]) => k === readPref(KEY)) ?? UI_SIZES[0];
let zoom = null; // { zoom, screen } from the shell; null until it has answered
const listeners = new Set();
const take = (z) => {
  if (typeof z === 'number') zoom = { zoom: z, screen: z }; // a shell that answers the zoom alone
  else if (z && typeof z.zoom === 'number') zoom = { zoom: z.zoom, screen: z.screen ?? z.zoom };
  for (const f of listeners) f();
  return zoom;
};
// Told at once, as the page's modules load: the shell zooms before the first paint, so a 大 is not first drawn 标准.
const tell = () => Promise.resolve(desk?.setUiSize?.(cur[0])).then(take, () => null);
tell();
desk?.onUiZoom?.(take);

export const uiSizeOn = () => typeof desk?.setUiSize === 'function';
export const uiSizeText = () => cur[1];
const pct = (k) => `${Math.round(k * 100)}%`;
// The row's label: 界面大小 标准 175%; the name alone until the shell has answered.
export const uiSizeLabel = () => `界面大小 ${cur[1]}${zoom ? ` ${pct(zoom.zoom)}` : ''}`;
// What the toast says of the size now chosen, once the shell has answered.
export function uiSizeNote() {
  if (!zoom) return '';
  const { zoom: k, screen } = zoom;
  if (cur[0] === 'small') return '界面大小 小：按 100% 显示（不放大，与 0.4.1 及以前相同）';
  if (k < screen) return `界面大小 ${cur[1]}：按 ${pct(k)} 显示（窗口放不下更大；全屏或窗口更大时为 ${pct(screen)}）`;
  return `界面大小 ${cur[1]}：按 ${pct(k)} 显示${k === 1 ? '（这块屏幕上不放大）' : ''}`;
}
// f() after each change of the zoom, whoever made it (a click of the row, the window resized, full screen).
export const onUiZoom = (f) => { listeners.add(f); };
// The next size; resolves to { zoom, screen } (null if the shell did not answer).
export function cycleUiSize() {
  cur = UI_SIZES[(UI_SIZES.indexOf(cur) + 1) % UI_SIZES.length];
  writePref(KEY, cur[0]);
  return tell();
}
