// Save editor rules (save-editor.html): which fields of a record can be changed and to what range. The ranges are
// the ones the game itself keeps (stats as in game-data.json, or a data pack's 100: officerFields, 9999 for city stores, 统治 100 as 开发 and 施舍 reach,
// 后备兵 10000 as 征兵 fills it, 1000 soldiers per officer), so an
// edited record never holds a value the rules cannot produce; the original's overflows (兵力溢出 and the like) stay out.
// Only plain numbers are edited: who serves where, rulers and status are left alone, as changing them would have to
// keep cities[].officers, factions[].ruler and the officer's status in step.
// 体力 is the one exception to "as the game keeps it": the original caps healing at the ROM template's hp and never
// stores a cap on the record. Here editing 体力 sets the officer's 体力上限 (o.maxHp) to the same value, so an edited
// officer is at full 体力 and the 病院, AI healing and the cards all read the edited cap (game.js maxHp).
import { DEAD, maxHp, data, packMismatch } from './game.js';
import { OFFICER_NUM } from './pack.js';

// 体力 as the editor shows and compares it: current / cap, so a change to either one counts.
export const hpText = (o) => `${o.hp}/${maxHp(o)}`;

export const OFFICER_FIELDS = [
  ['war', '武力', 1, 99], ['int', '智力', 1, 99], ['virtue', '人德', 1, 99], ['hp', '体力', 1, 99], ['loyalty', '忠诚', 0, 100],
  ['level', '等级', 1, 8], ['exp', '经验', 0, 49999], ['soldiers', '兵数', 0, 1000], ['weapon', '武器', 0, 23], ['armor', '防具', 0, 7],
];
// The ranges in play: on a data pack 武力、智力、人德、体力 go to the pack's 100 (core/pack.js), which a new game and every
// save keep; the base scenario's officers stop at 99 (D172). Read when called, as the pack loads after this module.
const PACK_STATS = ['war', 'int', 'virtue', 'hp'];
export const officerFields = () => (data()?.pack
  ? OFFICER_FIELDS.map((f) => (PACK_STATS.includes(f[0]) ? [f[0], f[1], f[2], OFFICER_NUM[f[0]][1]] : f)) : OFFICER_FIELDS);
export const CITY_FIELDS = [
  ['gold', '金', 0, 9999], ['rice', '米', 0, 9999], ['pop', '人口', 0, 9999], ['reserve', '后备兵', 0, 10000],
  ['land', '土地', 0, 999], ['industry', '产业', 0, 999], ['disaster', '防灾', 0, 99], ['gov', '统治', 0, 100], ['treasure', '宝', 0, 99],
];
export const ALLIANCE_MAX = 12; // months, as 同盟 sets it

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));
const field = (list, key) => list.find(([k]) => k === key);

// Each returns the value actually stored, or null when the field cannot be edited there.
export function setOfficer(g, id, key, v) {
  const f = field(officerFields(), key), o = g.officers[id];
  if (!f || !o || !Number.isFinite(Number(v))) return null;
  if (o.status === DEAD && key === 'hp') return null; // a dead officer keeps hp 0
  o[key] = clamp(v, f[2], f[3]); if (key === 'hp') o.maxHp = o.hp; // 体力 and 体力上限 move together
  g.edited = true;
  return o[key];
}
export function setCity(g, cid, key, v) {
  const f = field(CITY_FIELDS, key), c = g.cities[cid];
  if (!f || !c || !Number.isFinite(Number(v))) return null;
  c[key] = clamp(v, f[2], f[3]); g.edited = true;
  return c[key];
}
// Alliances are always kept on both sides, as payAlliance and breakAlliance do.
export function setAlliance(g, a, b, v) {
  if (a === b || !g.factions[a] || !g.factions[b] || !Number.isFinite(Number(v))) return null;
  const t = clamp(v, 0, ALLIANCE_MAX);
  g.factions[a].alliance[b] = t; g.factions[b].alliance[a] = t; g.edited = true;
  return t;
}

// A pasted or imported record: enough shape to be a game the editor and the game can open.
export function checkRecord(g) {
  if (!g || typeof g !== 'object') return '不是记录';
  if (!Array.isArray(g.officers) || !Array.isArray(g.cities) || !Array.isArray(g.factions)) return '缺少武将、城市或势力';
  const n = data()?.cities.length ?? 30; // 30, or the pack's count (core/pack.js)
  if (g.cities.length !== n) return `城市数为 ${g.cities.length}，应为 ${n}`;
  const other = packMismatch(g); if (other) return other;
  if (g.cities.some((c) => !Array.isArray(c.officers))) return '城市名册损坏';
  return null;
}

// 原版漏洞 switches kept on the record (g.bugs) and 王莆's owner for the 阿会喃 bug (core/ahuinan.js).
export const BUGS = [['ahuinan', '阿会喃复制（王莆）']];
export function setBug(g, key, on) {
  if (!BUGS.some(([k]) => k === key)) return null;
  if (key === 'ahuinan' && on && data()?.pack) return null; // its table bytes past city 29 are the original's map alone
  g.bugs = { ...(g.bugs ?? {}), [key]: !!on }; g.edited = true;
  return g.bugs[key];
}
export function setPhantomOwner(g, f) {
  f = Number(f);
  if (!g.factions[f] || g.factions[f].ruler == null) return null;
  g.phantom = { ...(g.phantom ?? {}), owner: f }; g.edited = true;
  return f;
}
