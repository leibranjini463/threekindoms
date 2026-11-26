// 系统 → 地图标签: how large the maps' own labels are drawn (小 / 标准 / 大), remembered across restarts. One factor for the
// labels that sit on a map: the 战略地图's city tags (3D and flat), the flat war map's name plaques, shop signs, terrain and cost
// plaques, the 3D war map's tags and signs and the 白兵 squads' bars (src/ui.css, by --label-k on <body>). The HUD's panels and buttons are not labels
// and keep their sizes. A phone's maps are small and a desktop's large for the same tag, so one fixed size suits neither end.
import { readPref, writePref } from './prefs.js';

const KEY = 'hd2d-label-size';
export const LABEL_SIZES = [['small', 0.85, '小'], ['normal', 1, '标准'], ['large', 1.2, '大']];
let cur = LABEL_SIZES.find(([k]) => k === readPref(KEY)) ?? LABEL_SIZES[1];
const apply = () => globalThis.document?.body?.style.setProperty('--label-k', String(cur[1]));
apply();

export const labelK = () => cur[1];
export const labelSizeText = () => cur[2];
export function cycleLabelSize() {
  cur = LABEL_SIZES[(LABEL_SIZES.indexOf(cur) + 1) % LABEL_SIZES.length];
  writePref(KEY, cur[0]); apply();
}
