// Strategic rules core: game state, the monthly faction rotation and every player command.
// Formulas follow 霸王的大陆_HD-2D重制参考.md (chapters 5.2–5.9, 6.6, 6.9). The original draws from a
// fixed 256-byte permutation with per-system cursors; here one seeded generator stands in for all
// of them, so outcomes follow the same ranges and rejection rules but not the original sequence.

import { roll100 } from './origrng.js';
import { withBaseMap, mergePack, readPack } from './pack.js';
import { aiIncome } from './warliketiers.js';
export const NONE = 7; // city owner value for "no faction"; with a pack's factions (8 on, core/pack.js) its slot is a placeholder
export const DEAD = 3, SERVING = 2, UNAPPEARED = 1, RONIN = 0;
export const FACTION_COLORS = ['#5a5a66', '#c8402f', '#7a4ad0', '#e0a020', '#3f8f4f', '#c060a0', '#2f9fb0'];
// A faction's banner colour: the original seven's, a pack faction's own (core/pack.js).
export const factionColor = (f) => D?.factions[f]?.colors?.flag ?? FACTION_COLORS[f];
// A pack faction's 白兵 troop looks ({ soldier: 'ashigaru', … }, core/pack.js TROOP_LOOKS), or null: the original kinds' looks.
export const factionTroops = (f) => D?.factions[f]?.troops ?? null;
// The troop looks of the squads an officer leads into a 白兵: his own (officers.json troops), kind by kind over those of the
// faction he fights for, or null: the original kinds' looks. Not bound to a house: a pack can dress an original officer's men.
export const officerTroops = (id, f) => {
  const t = { ...D?.factions[f]?.troops, ...D?.officers[id]?.troops };
  return Object.keys(t).length ? t : null;
};

let D = null, BASE = null; // static data (data/game-data.json with data/base-map.json, and a pack's when one is in use); BASE without the pack
export const data = () => D;
export async function loadData(url = 'data/game-data.json') {
  const [d, map] = await Promise.all([url, url.replace(/game-data\.json$/, 'base-map.json')].map(async (u) => (await fetch(u)).json()));
  BASE = structuredClone(withBaseMap(d, map)); D = d; nameCities(); return D;
}
export const setData = (d) => { D = d; nameCities(); return D; };
// 地名 原版／考据 (佛砸米兰@qq, 2026-11-18): thirteen of the original thirty are named after a 州 or a 关 (幽州, 荆州, 西平关…); with
// the switch on each shows a more particular name (data/base-map.json `hist`): for most the 郡 or 县 its seat stands in (南郡, 金城, 寿春…), for three the better known name of a place one or two hundred km off (北平 for 蓟, 陈留 for 昌邑, 许昌 for 谯). The name shown
// is all that changes: seats, roads, tables and records go by id, and a pack is still read against the original names (BASE is
// never renamed), so a pack written with either setting loads with both. A pack's own city of the same name keeps it: the
// original city then stays under its original name.
export const PLACE_NAMES = 'hd2d-place-names';
let histNames = false;
export const placeNames = () => histNames;
export function setPlaceNames(on) { histNames = !!on; nameCities(); }
function nameCities() {
  if (!D) return;
  const own = new Set(D.cities.filter((c) => c.mod).map((c) => c.name));
  for (const c of D.cities) if (c.hist != null && !c.mod) {
    if (histNames && !own.has(c.hist)) { c.orig ??= c.name; c.name = c.hist; } else if (c.orig != null) c.name = c.orig; // untouched while off: the data as loaded
  }
}
// The original name of a city shown under another, null when it shows its own.
export const cityOrigName = (cid) => { const c = D.cities[cid]; return !c.mod && c.orig != null && c.orig !== c.name ? c.orig : null; };
// [original, 考据] of every city the switch renames, in city order (the 说明 lists them whichever way the switch stands).
export const placeNamePairs = () => D.cities.filter((c) => c.hist != null && !c.mod).map((c) => [c.orig ?? c.name, c.hist]);
// Play on a data pack (mods/<id>/, core/pack.js): merged over the unchanged base data, so nothing of an earlier pack or of a
// session's 阿会喃 copies stays behind. Returns the problems found; on any, the data is left as it was.
export async function usePack(id, { regions, fetchJson = fetchOptional } = {}) {
  if (!BASE) throw Error('loadData first');
  const { pack, errors } = await readPack(id, fetchJson);
  if (errors.length) return errors;
  const { data: merged, errors: bad } = mergePack(BASE, pack, { regions });
  if (bad.length) return bad;
  D = merged; nameCities(); return [];
}
// The pack the page plays on: ?pack=<id> (?pack=none for none), else the one chosen on the title screen (kept in the browser).
// { pack, errors }: errors when it would not load, the data then being the base game's.
export const PACK_CHOICE = 'haou-hd2d-pack';
export async function loadWithPack(search = globalThis.location?.search ?? '') {
  try { histNames = localStorage.getItem(PLACE_NAMES) === '1'; } catch {}
  await loadData();
  let id = new URLSearchParams(search).get('pack');
  if (id == null) { try { id = localStorage.getItem(PACK_CHOICE); } catch {} }
  if (!id || id === 'none') return { pack: null, errors: [] };
  const errors = await usePack(id, { regions: await loadRegions() });
  return { pack: id, errors };
}
// The official extension regions that are open to packs (design §5.5): assets/ai/sandtable/regions/index.json, { name: { lon, lat } }.
export async function loadRegions() {
  try { return (await fetchOptional('assets/ai/sandtable/regions/index.json')) ?? {}; } catch { return {}; }
}
const fetchOptional = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (r.status === 404) return undefined; if (!r.ok) throw Error(`${u}: ${r.status}`); return r.json(); };
// The officer whose pictures and sprites an officer uses: a pack's officer borrows a whole set (core/pack.js `like`), an 阿会喃
// copy is 阿会喃's own.
// A pack officer's woman-general battle look (core/pack.js HEROINE_LOOKS), or null: he fights in his art officer's look.
export const lookOf = (id) => D?.officers[id]?.look ?? null;
export const artOf = (id) => D?.officers[id]?.art ?? (D?.officers[id]?.clone ? 0 : id);
// The original city whose painted battlefield a city's war uses (a pack's city borrows one whole, core/pack.js `like`).
export const fieldArtOf = (cid) => D?.cities[cid]?.like ?? cid;
// 体力上限: the ROM template's hp, unless the save editor set one on the record (o.maxHp). id for copies of a record.
export const maxHp = (o, id = o.id) => o.maxHp ?? D.officers[id].hp;

// ---------- RNG ----------
export function rng(g) {
  // mulberry32 over g.seed; returns 0..n-1
  return (n) => {
    let t = (g.seed = (g.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

// ---------- New game ----------
export function newGame(playerFaction, level, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) {
  const g = { version: 1, level, player: playerFaction, year: 189, month: 0, seed, turnIdx: -1, monthDone: false, current: null, books: 0, over: null };
  const r = rng(g);
  g.order = r(5); // 新游戏随机0–4 (5.2)
  g.cities = D.cities.map((c) => ({
    id: c.id, faction: c.faction, gold: c.gold, rice: c.rice, pop: c.pop, land: c.land, industry: c.industry,
    disaster: c.disaster, gov: c.gov, reserve: c.reserve, treasure: c.treasure, officers: [...c.officers], riot: 0,
  }));
  g.officers = D.officers.filter((o) => !o.clone).map((o) => ({
    id: o.id, hp: o.hp, war: o.war, int: o.int, loyalty: o.loyalty, virtue: o.virtue, exp: o.exp, soldiers: o.soldiers,
    weapon: o.weapon, armor: o.armor, level: o.level, army: o.army, status: o.appear === 'initial' ? SERVING : UNAPPEARED, loc: o.city,
  }));
  const n = D.factions.length; // 7, or with a pack's factions their last number + 1 (NONE's slot stays empty: core/pack.js)
  g.factions = D.factions.map((f) => ({ id: f.id, ruler: f.ruler, city: f.ruler == null ? null : D.officers[f.ruler].city, ai: f.id !== playerFaction, alliance: new Array(n).fill(0) }));
  g.aiCursor = new Array(n).fill(0);
  if (D.pack) g.pack = { id: D.pack.id, version: D.pack.version };
  return g;
}

// The original's ruler-select 秘技 (hold START, ↑↓←→ ×3 at 「クンシュを えらんでください」, before A):
// the player ruler's seat city starts maxed, every level. Read from the unmodified ROM in FCEUmm
// (research/player-commands-evidence.md): 金/米/人口/土地/后备兵 9999, 产业 999, 防灾/统治/宝 99.
// Officers and the faction's other cities are untouched; 土地 9999 is above the 999 development cap.
export function maxRulerCity(g) {
  const c = g.cities[g.factions[g.player].city];
  Object.assign(c, { gold: 9999, rice: 9999, pop: 9999, land: 9999, reserve: 9999, industry: 999, disaster: 99, gov: 99, treasure: 99 });
  g.cheat = true;
  return g;
}

// ---------- Queries ----------
export const officerCity = (g, id) => g.cities.find((c) => c.officers.includes(id));
export const factionOf = (g, id) => officerCity(g, id)?.faction ?? NONE;
export const citiesOf = (g, f) => g.cities.filter((c) => c.faction === f);
export const alive = (g, f) => g.factions[f].ruler != null;
export const isRuler = (g, id) => g.factions.some((f) => f.ruler === id);
export const roads = (cid) => D.cities[cid].roads;
export const name = (id) => D.officers[id].name;
export const cityName = (cid) => D.cities[cid].name;
// A house goes by its ruler of the day; a fallen one by the ruler it fell under (the scenario's name for an older
// record that has no note of him).
export const factionName = (g, f) => {
  if (f == null || f === NONE) return '无主';
  const who = g.factions[f].ruler ?? g.factions[f].fallen;
  return who != null ? name(who) : D.factions[f].name;
};
export const troopsOf = (g, c) => c.officers.reduce((a, id) => a + g.officers[id].soldiers, 0);
// The table ends at 30 cities (13 books); a pack's realm past that keeps the last entry.
export const books = (g, f) => D.rules.books[Math.min(citiesOf(g, f).length, D.rules.books.length - 1)];

// ---------- Income (5.2): every city, ID 29→0, regardless of owner ----------
// Empty cities too: the original's loop (bank25 $A429 / $A5EE) has no owner test, so an empty city's gold and rice grow
// every year, and the AI's vacant expansion subtracts them from what it must bring (B1FD). Skipping them made the AI
// take far fewer empty cities (docs/dev/pitfalls/rules.md, 123@devblog).
const GOV_C = (t) => (t <= 50 ? 50 : t <= 70 ? 60 : t <= 80 ? 70 : t <= 90 ? 80 : t <= 99 ? 90 : 100);
export function income(g, kind) {
  const [A, B] = D.rules.income_ab[g.level];
  const out = [];
  for (const c of [...g.cities].reverse()) {
    const Dv = kind === 'gold' ? c.industry : c.land, N = kind === 'gold' ? 80 : 60;
    const q = Math.floor((c.pop * (Math.floor(Dv / A) + B)) / N);
    const inc = aiIncome(g, c, kind, Math.floor((q * GOV_C(c.gov)) / 100)); // 电脑好战 上级 bonus (off: unchanged)
    c[kind] = Math.min(9999, c[kind] + inc);
    out.push([c.id, inc]);
  }
  return out;
}

// ---------- Disasters and riots (5.5) ----------
function disasterK(c, r) {
  const Dv = c.disaster;
  let k, b;
  if (Dv === 0) { k = 0; b = 0; } else if (Dv < 20) { k = 2; b = 0; } else if (Dv < 50) { k = 4; b = 1; } else if (Dv < 80) { k = 6; b = 5; } else if (Dv < 99) { k = 8; b = 7; } else { k = 10; b = 10; }
  if (Dv >= 20) c.disaster = Math.max(0, Dv - (b + r(6)));
  return k;
}
const qLoss = (v, k) => (k === 0 ? Math.floor(v / 4) : Math.floor((Math.floor(v / 4) * k) / 10));
const hLoss = (v, k) => (k === 0 ? Math.floor(v / 2) : Math.floor((Math.floor(v / 2) * k) / 10));
export function disaster(g, kind) {
  const r = rng(g), list = kind === 'drought' ? D.rules.drought_cities : D.rules.flood_cities, hit = [];
  for (const cid of [...list, null]) {
    if (r(6) !== 0 || cid == null) continue; // 16 sequential draws, the trailing FF slot included
    const c = g.cities[cid];
    if (c.faction === NONE) continue;
    const k = disasterK(c, r);
    // 防灾 99 holds: no loss, and the event says so with k = 10 (0 is 防灾 0, the worst loss; tests/disaster.test.mjs).
    if (k === 10) { hit.push([cid, 10]); continue; }
    c.pop -= qLoss(c.pop, k);
    if (kind === 'drought') { c.land -= qLoss(c.land, k); for (const id of c.officers) g.officers[id].soldiers -= qLoss(g.officers[id].soldiers, k); }
    else { c.industry -= qLoss(c.industry, k); c.rice -= hLoss(c.rice, k); }
    hit.push([cid, k]);
  }
  return hit;
}
export function riots(g) {
  if (g.year === 189 && g.month < 4) return [];
  const r = rng(g), out = [];
  for (const c of g.cities) {
    if (c.faction === NONE) continue;
    if (c.riot > 0) { c.riot--; continue; }
    const p = c.gov >= 50 ? 0 : c.gov >= 40 ? 5 : c.gov >= 30 ? 10 : c.gov >= 20 ? 30 : 50;
    if (!p || r(100) >= p) continue;
    c.riot = 6;
    const k = { 5: [1, 4], 10: [2, 6], 30: [3, 7], 50: [4, 8] }[p], type = 1 + r(3);
    const cut = (v, kk) => v - Math.floor(v / 16) * kk;
    if (type === 1) c.pop = cut(c.pop, k[0]);
    else if (type === 2) { c.gold = cut(c.gold, k[1]); c.rice = cut(c.rice, k[1]); }
    else { c.land = cut(c.land, k[1]); c.industry = cut(c.industry, k[1]); }
    out.push([c.id, type]);
  }
  return out;
}

// ---------- Appearance, death, succession (6.6) ----------
// 登场队列: a city's 搜索 table and a faction's 自动出仕 table are read in order; only the first officer
// not yet appeared counts, and until his year comes the queue waits (搜索 then finds nearby ronin instead).
// An AI faction's 搜索 reads the same table its own way (C5D2, core/ai.js housekeeping).
export const searchQueue = (cid) => D.search_table[String(cid)] || [];
export const joinQueue = (f) => D.join_table[String(f)] || [];
export function queueHead(g, list) {
  const id = list.find((i) => g.officers[i].status === UNAPPEARED);
  return id == null ? null : { id, ready: D.officers[id].year <= g.year };
}
// How and where an officer enters play: kind 'initial' (in a city at the start), 'search' (city's 搜索 queue,
// order = place in it), 'auto' (joins the faction's ruler city by himself) or 'phantom' (an 阿会喃 copy that came
// out of 王莆, core/ahuinan.js); prefer = faction he favours when found.
export function debutInfo(id) {
  const o = D.officers[id];
  if (o.clone) return { year: o.year, prefer: null, kind: 'phantom' };
  const prefer = Object.entries(D.rules.search_preference).find(([, ids]) => ids.includes(id))?.[0];
  const base = { year: o.year, prefer: prefer == null ? null : Number(prefer) };
  for (const [k, list] of Object.entries(D.search_table)) { const i = list.indexOf(id); if (i >= 0) return { ...base, kind: 'search', city: Number(k), order: i + 1 }; }
  for (const [k, list] of Object.entries(D.join_table)) { const i = list.indexOf(id); if (i >= 0) return { ...base, kind: 'auto', faction: Number(k), order: i + 1 }; }
  return { ...base, kind: 'initial', city: o.city };
}
// What 搜索 in this city can turn up now: the queue head (ready or waiting for his year), how many are still
// to come, whether the city is too full to take anyone, and the ronin a search could find instead.
export function cityTalent(g, cid) {
  const list = searchQueue(cid), near = [cid, ...roads(cid)];
  return {
    list, head: queueHead(g, list), left: list.filter((i) => g.officers[i].status === UNAPPEARED).length,
    full: g.cities[cid].officers.length >= 10, ronin: g.officers.filter((o) => o.status === RONIN && near.includes(o.loc)).map((o) => o.id),
  };
}

export function autoJoin(g, f) {
  const head = queueHead(g, joinQueue(f));
  if (!head?.ready) return null;
  const id = head.id;
  const c = g.cities[g.factions[f].city];
  if (!c || c.faction !== f || c.officers.length >= 10) return null;
  g.officers[id].status = SERVING; c.officers.push(id);
  return { id, city: c.id };
}
// A ruler taken prisoner (D49, smdqj@devblog, 2026-11-13). The original gates every capture on loyalty 100, so this
// needs a ruler whose loyalty was edited down; its own answer there is an anomaly (he stays his house's ruler while
// serving his captor, and the house's queue joins the captor's city: docs/曹操被俘后自动出仕的原版对照_2026-11-13.md).
// Here the house crowns an heir as if he had died (checkFactions, and rotate for a record saved in the stuck state),
// or falls when it has no city left; then its 自动出仕 queue follows him.
export const rulerTaken = (g, f) => {
  const id = g.factions[f].ruler, c = id == null || g.officers[id].status !== SERVING ? null : officerCity(g, id);
  return !!c && c.faction !== f;
};
// 0.3.4 and before wrote the prisoner at the head of his captor's city, over the captor's own ruler when he was
// there too: a record from then gets the ruler back in front (the first of a city's list is its 太守).
function rulerFirst(g, c) {
  const lord = g.factions[c.faction]?.ruler;
  if (c.officers.includes(lord)) c.officers = [lord, ...c.officers.filter((x) => x !== lord)];
}
// The queue of a house that fell with its ruler in another's service: on the house's place in the turn order the
// head joins the city he serves in, under autoJoin's terms (his year, one a turn, room in the city). It stops once he
// is dead or out of office; a house that fell any other way has no such ruler and its queue rests, as in the original.
export function followJoin(g, f) {
  const fac = g.factions[f], lord = fac.ruler == null ? fac.fallen : null;
  if (lord == null || g.officers[lord].status !== SERVING) return null;
  const head = queueHead(g, joinQueue(f)), c = officerCity(g, lord);
  if (c) rulerFirst(g, c);
  if (!head?.ready || !c || c.officers.length >= 10) return null;
  g.officers[head.id].status = SERVING; c.officers.push(head.id);
  return { id: head.id, city: c.id, faction: c.faction, lord };
}

const DEATH_P = [5, 10, 20, 37, 80, 160, 201];
// 武将不战死 (g.noWarDeath, an option off by default and absent from older records; playtest of 2026-10-30, T16/T17):
// a general brought to 0 HP in war is taken prisoner by the other side instead of slain, coming out with SPARED_HP.
// A ruler, who cannot be taken, dies as in the original (succession or the fall of his house): kept alive he stood
// on his last city for good and the war could only end on day 30 (Desktop 0.2.3, 2026-10-31). 斩首 stays.
export const SPARED_HP = 30;
export const spared = (g, id) => (!g.noWarDeath || isRuler(g, id) ? null : 'captured');
// 武将不老 (g.ageless, an option off by default and absent from older records): nobody dies of age; war deaths stay.
export function naturalDeaths(g, f) {
  if (g.ageless) return [];
  const r = rng(g), dead = [], ruler = g.factions[f].ruler;
  for (const c of citiesOf(g, f)) {
    for (let i = 0; i < c.officers.length; i++) { // the original advances the slot even after compaction (skip quirk kept)
      const id = c.officers[i];
      if (id === ruler) continue;
      if (dies(id)) { kill(g, id); dead.push(id); }
    }
  }
  if (ruler != null && dies(ruler)) { kill(g, ruler); dead.push(ruler); }
  return dead;
  function dies(id) {
    const d = g.year - D.officers[id].death;
    return d >= 0 && r(200) < DEATH_P[Math.min(6, d)];
  }
}
export function kill(g, id) {
  const o = g.officers[id], c = officerCity(g, id);
  o.status = DEAD; o.hp = 0;
  if (c) { c.officers = c.officers.filter((x) => x !== id); if (!c.officers.length) c.faction = NONE; }
}

export function heirCandidates(g, f) {
  return citiesOf(g, f).flatMap((c) => c.officers);
}
export function autoHeir(g, f) {
  const cands = heirCandidates(g, f);
  const pref = (D.succession[String(f)] || []).find((id) => cands.includes(id));
  if (pref != null) return pref;
  let best = null;
  for (const id of cands) if (best == null || g.officers[id].virtue >= g.officers[best].virtue) best = id;
  return best;
}
export function crown(g, f, heir, oldRuler) {
  const r = rng(g), fac = g.factions[f], c = officerCity(g, heir), quit = [];
  fac.ruler = heir; fac.city = c.id;
  c.officers = [heir, ...c.officers.filter((x) => x !== heir)];
  if (!(D.succession[String(f)] || []).includes(heir)) {
    const dv = Math.floor(g.officers[heir].virtue / 5) - Math.floor(g.officers[oldRuler].virtue / 5);
    for (const id of heirCandidates(g, f)) {
      if (id === heir) continue;
      const o = g.officers[id];
      o.loyalty = Math.max(10, Math.min(99, o.loyalty + dv - 10));
      if (o.loyalty < 31 && r(100) < 20) quit.push(id);
    }
  }
  g.officers[heir].loyalty = 100;
  for (const id of quit) toRonin(g, id);
  return quit;
}
export function toRonin(g, id) {
  const c = officerCity(g, id), o = g.officers[id];
  o.status = RONIN; o.loc = c?.id ?? o.loc;
  if (c) { c.officers = c.officers.filter((x) => x !== id); if (!c.officers.length) c.faction = NONE; }
}
export function destroyFaction(g, f) {
  g.factions[f].fallen = g.factions[f].ruler; g.factions[f].ruler = null;
  for (const c of citiesOf(g, f)) { for (const id of [...c.officers]) toRonin(g, id); c.faction = NONE; }
}

// Recruit loyalty (CF3F): 8-bit subtraction wrap, then clamp 10..90.
export const recruitLoyalty = (rulerVirtue, old) => Math.min(90, Math.max(10, (70 + Math.floor(rulerVirtue / 10) - old) & 255));
export const capturedLoyalty = (old) => Math.max(10, 51 - Math.abs(50 - old));

// ---------- Experience (6.1) ----------
// Level-ups not told yet, per game: officer id → his level and 武力 before the first of them. Kept off the game
// record so a save never carries them. The original compares each general's level and 武力 with what they were
// before the fight (bank13 $C716 / $DEE9, research/experience-evidence.md §5), so two levels in one 白兵 make one
// message with the whole gain.
const untold = new WeakMap();
export function addExp(g, id, raw) {
  const o = g.officers[id];
  o.exp = Math.min(49999, o.exp + raw);
  const th = D.rules.level_exp[o.level - 1];
  if (o.level < 8 && o.exp >= th) {
    const q = untold.get(g) ?? new Map(); untold.set(g, q);
    if (!q.has(id)) q.set(id, { level: o.level, war: o.war });
    o.level++;
    o.war += o.war <= 50 ? 6 : o.war <= 70 ? 5 : o.war <= 80 ? 4 : o.war <= 89 ? 2 : 0;
    return true;
  }
  return false;
}
// The level-ups since the last call, in the order they came: [{ id, from, to, warFrom, war }]. Clears them.
export function takeLevelUps(g) {
  const q = untold.get(g); if (!q?.size) return [];
  untold.delete(g);
  return [...q].map(([id, b]) => ({ id, from: b.level, to: g.officers[id].level, warFrom: b.war, war: g.officers[id].war }));
}

// ---------- Talent / unification checks (6.9) ----------
export function talentCount(g) {
  const otherRulers = new Set(g.factions.filter((f) => f.id !== g.current).map((f) => f.ruler));
  return g.officers.filter((o) => o.status !== DEAD && !otherRulers.has(o.id)).length;
}
export function unificationParts(g) {
  const ruler = g.factions[g.player].ruler;
  let n = 0, loy = 0, gov = 0;
  for (const c of g.cities) { gov += c.gov; for (const id of c.officers) if (id !== ruler) { n++; loy += g.officers[id].loyalty; } }
  return { officers: n, loyalty: n ? Math.floor(loy / n) : 0, talent: Math.floor((n * 100) / 130), gov: Math.floor(gov / g.cities.length) };
}
export function unificationScore(g) {
  const { loyalty, talent, gov } = unificationParts(g);
  return Math.floor((loyalty + talent + gov) / 3);
}
// Who congratulates the ruler: the realm's sharpest mind, the later city and slot on a tie, as the original's scan at
// bank 26 $C626 (research/endings-two-player-evidence.md §2), which does not leave out the ruler.
export function evaluator(g) {
  let best = g.factions[g.player].ruler, top = -1;
  for (const c of g.cities) for (const id of c.officers) if (g.officers[id].int >= top) { top = g.officers[id].int; best = id; }
  return best;
}

// ---------- Turn loop (5.8) ----------
// io: { event(e), chooseHeir(f, cands, why), aiTurn(f), playerTurn(f) } — all async. Runs until the game ends.
export async function run(g, io) {
  while (!g.over) {
    // Unification is judged before the turn can rotate: a war won with the last command book must not
    // roll into next month's deaths and successions first (the original checks at the command entry).
    if (citiesOf(g, g.player).length === g.cities.length) { g.over = { type: 'unify', score: unificationScore(g) }; await io.event({ type: 'unify', score: g.over.score }); return; }
    if (g.current == null || g.books <= 0 || g.endTurn) { g.endTurn = false; await rotate(g, io); continue; }
    await io.playerTurn(g.current);
  }
}

// After any war or event that can kill rulers or empty a faction: succession, then fall.
// adrift: rulers a field battle's settlement sent 下野 alive (warcore resolveWar, res.adrift). Their house, left with no
// city, falls with him still 下野 and to be found by 搜索; any other ruler out of office is lost.
export async function checkFactions(g, io, adrift = []) {
  for (const fac of g.factions) {
    if (fac.ruler == null) continue;
    const f = fac.id, ruler = fac.ruler;
    const taken = rulerTaken(g, f);
    const loose = g.officers[ruler].status === RONIN && adrift.includes(ruler) && !citiesOf(g, f).length;
    if (!loose && (taken || g.officers[ruler].status === DEAD || g.officers[ruler].status === RONIN)) {
      if (g.officers[ruler].status === RONIN) g.officers[ruler].status = DEAD; // a ruler with nowhere to go is lost
      if (!(await succession(g, io, f, ruler, taken))) continue;
    }
    if (!citiesOf(g, f).length) {
      destroyFaction(g, f);
      await io.event({ type: 'fall', faction: f });
      if (f === g.player) { g.over = { type: 'gameover' }; await io.event({ type: 'gameover' }); }
    }
  }
}

async function rotate(g, io) {
  for (;;) {
    g.turnIdx++;
    if (g.turnIdx >= D.rules.turn_orders[g.order].length) { // 7 houses, or with a pack's after them (core/pack.js)
      g.turnIdx = 0; g.monthDone = false; g.month++;
      if (g.month >= 12) { g.month = 0; g.year++; }
      for (const f of g.factions) f.alliance = f.alliance.map((t) => Math.max(0, t - 1));
    }
    const f = D.rules.turn_orders[g.order][g.turnIdx];
    if (!alive(g, f)) {
      const followed = followJoin(g, f);
      if (followed) await io.event({ type: 'join', ...followed });
      continue;
    }
    // A record saved while its ruler sat in his captor's city (0.3.4 and before) is put right here.
    if (rulerTaken(g, f) && !(await succession(g, io, f, g.factions[f].ruler, true))) { if (g.over) return; continue; }
    g.current = f;
    if (talentCount(g) < 30) { g.over = { type: 'talent' }; await io.event({ type: 'talent' }); return; }
    g.books = books(g, f);
    if (!g.monthDone) {
      g.monthDone = true;
      if (g.month === 3) await io.event({ type: 'income', kind: 'gold', list: income(g, 'gold') });
      else if (g.month === 9) await io.event({ type: 'income', kind: 'rice', list: income(g, 'rice') });
      else { const list = riots(g); if (list.length) await io.event({ type: 'riot', list }); }
      if (g.month === 7 || g.month === 8) await io.event({ type: 'disaster', kind: 'drought', list: disaster(g, 'drought') });
      if (g.month === 4 || g.month === 5) await io.event({ type: 'disaster', kind: 'flood', list: disaster(g, 'flood') });
    }
    const joined = autoJoin(g, f);
    if (joined) await io.event({ type: 'join', faction: f, ...joined });
    const oldRuler = g.factions[f].ruler;
    const dead = naturalDeaths(g, f);
    if (dead.length) await io.event({ type: 'death', faction: f, list: dead });
    if (g.officers[oldRuler].status === DEAD && !(await succession(g, io, f, oldRuler))) continue;
    if (g.factions[f].ai) { await io.aiTurn(f); if (g.over) return; g.books = 0; continue; }
    return; // player's turn begins
  }
}

// captured: the old ruler is not dead but another house's prisoner (rulerTaken); the notices say so.
export async function succession(g, io, f, oldRuler, captured = false) {
  if (captured) rulerFirst(g, officerCity(g, oldRuler));
  const cands = heirCandidates(g, f);
  if (!cands.length) {
    destroyFaction(g, f);
    await io.event({ type: 'fall', faction: f });
    if (f === g.player) { g.over = { type: 'gameover' }; await io.event({ type: 'gameover' }); }
    return false;
  }
  const heir = g.factions[f].ai ? autoHeir(g, f) : await io.chooseHeir(f, cands, captured ? 'captured' : 'dead');
  const quit = crown(g, f, heir, oldRuler);
  await io.event({ type: 'heir', faction: f, heir, old: oldRuler, quit, ...(captured ? { captured: true } : {}) });
  return true;
}

// ---------- Player commands (5.3, 5.7, 5.9) ----------
// Each returns { ok, msg, ... }; the caller spends one command book on success unless noBook.
const bandI = (i) => (i <= 50 ? 0 : i <= 80 ? 1 : 2);
export function devCost(g, executor) { const r = rng(g); return [10, 12, 14, 16, 18, 20, 22, 24, 26][bandI(g.officers[executor].int) * 2 + r(5)]; }
// What one 开发 / 防灾 by this officer can cost, [least, most]: the tables above without their roll (for a run of several, whose later
// costs are not rolled until each is carried out).
export const devCostRange = (g, executor) => { const b = bandI(g.officers[executor].int) * 4; return [10 + b, 18 + b]; };
export const disasterCostRange = (g, executor) => { const b = [10, 13, 16][bandI(g.officers[executor].int)]; return [b, b + 3]; };
export function develop(g, cid, executor, field, cost) {
  const c = g.cities[cid], r = rng(g);
  const cap = field === 'pop' ? 9999 : 999;
  if (c[field] >= cap) return { ok: false, msg: '已经达到上限' };
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost;
  const q = Math.floor((cost * g.officers[executor].int) / 100);
  const d = Math.max(1, Math.floor((q * (r(8) + 10)) / 10));
  const want = field === 'pop' ? Math.max(1, Math.floor(d / 2)) : d;
  const before = c[field]; c[field] = Math.min(cap, before + want);
  const a = c[field] - before;
  c.gov = Math.min(100, c.gov + 1 + (a >= 31 ? 1 : 0));
  return { ok: true, gain: a, msg: `${{ land: '土地', industry: '产业', pop: '人口' }[field]} +${field === 'pop' ? a * 100 : a}` };
}
export function disasterCost(g, executor) { const r = rng(g); return [10, 13, 16][bandI(g.officers[executor].int)] + r(4); }
export function prevent(g, cid, executor, cost) {
  const c = g.cities[cid], r = rng(g);
  if (c.disaster >= 99) return { ok: false, msg: '防灾已满' };
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost;
  const q = Math.floor((cost * g.officers[executor].int) / 100), d = Math.max(1, Math.floor((q * (6 + r(5))) / 10));
  const before = c.disaster; c.disaster = Math.min(99, before + d);
  return { ok: true, gain: c.disaster - before, msg: `防灾 +${c.disaster - before}` };
}
export function reward(g, cid, target, gold, treasure = false) {
  const c = g.cities[cid], o = g.officers[target], r = rng(g);
  if (o.loyalty >= 90) return { ok: false, msg: '忠诚已高，无需赏赐' };
  const V = g.officers[g.factions[c.faction].ruler].virtue;
  let inc;
  if (treasure) { if (c.treasure < 1) return { ok: false, msg: '没有宝物' }; c.treasure--; inc = Math.floor(((Math.floor(V / 10) + 3) * (10 + r(7))) / 10); }
  else { if (gold < 10 || c.gold < gold) return { ok: false, msg: '金不足' }; c.gold -= gold; inc = Math.floor(((Math.floor(V / 10) + Math.floor(gold / 20)) * (7 + r(4))) / 10); }
  const before = o.loyalty; o.loyalty = Math.min(99, before + inc);
  return { ok: true, gain: o.loyalty - before, msg: `${name(target)} 忠诚 +${o.loyalty - before}` };
}
export function charity(g, cid, gold, rice) {
  const c = g.cities[cid], r = rng(g);
  if (c.gov >= 100) return { ok: false, msg: '统治度已满' };
  if ((!gold && !rice) || c.gold < gold || c.rice < rice) return { ok: false, msg: '金米不足' };
  c.gold -= gold; c.rice -= rice;
  const Vg = g.officers[c.officers[0]].virtue;
  const q = Math.floor(((gold + rice) * Vg) / 2000), d = Math.floor((q * (10 + r(7))) / 10);
  const before = c.gov; c.gov = Math.min(100, before + d);
  return { ok: true, gain: c.gov - before, msg: `统治度 +${c.gov - before}` };
}
// 武将不能读书 (g.noStudy, an option off by default and absent from older records; not in the ROM): no officer, the
// player's or the computer's, raises 智力 by study. 书馆 is greyed out in the city menu, and the AI's study draw
// (ai.js domestic) finds no one, as when every officer is outside 50–79.
export const NO_STUDY = '已开启「武将不能读书」';
// 书馆's fee and the least it raises 智力 (+0–4 on top), by the 智力 before (`0x386AD`: 80, then 30 / 60).
export const studyFee = (int) => (int <= 30 ? [30, 5] : int <= 60 ? [20, 8] : [10, 6]);
export function study(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id], r = rng(g);
  if (g.noStudy) return { ok: false, msg: NO_STUDY };
  if (!D.cities[cid].facilities.school) return { ok: false, msg: '此城没有书馆' };
  if (o.int >= 80) return { ok: false, msg: '智力80以上无法再学' };
  const [cost, base] = studyFee(o.int);
  if (c.gold < cost) return { ok: false, msg: '金不足' };
  c.gold -= cost; const inc = base + r(5); o.int += inc;
  return { ok: true, gain: inc, cost, msg: `${name(id)} 智力 +${inc}（花费${cost}金）` };
}
export function heal(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id], r = rng(g), max = maxHp(o);
  if (!D.cities[cid].facilities.hospital) return { ok: false, msg: '此城没有医馆' };
  if (o.hp >= max) return { ok: false, msg: '体力已满' };
  if (c.gold < 50) return { ok: false, msg: '金不足' };
  c.gold -= 50; const before = o.hp; o.hp = Math.min(max, o.hp + 35 + r(11));
  return { ok: true, gain: o.hp - before, cost: 50, msg: `${name(id)} 体力 +${o.hp - before}` };
}
export const conscriptMax = (c) => Math.floor(Math.min(Math.max(0, 10000 - c.reserve), Math.floor(c.gold / 20) * 100) / 100);
// What the city's officers can still lead (1000 each, as 分兵 fills them) beyond the soldiers they have and the
// reserve: the shortfall 征兵 tells the player of (阿拉神丁@qq, 2026-11-18). cap: what they can lead in all;
// have: their soldiers (each counted to 1000) and the reserve; need: cap − have, never below 0.
export const PER_OFFICER = 1000;
export function conscriptNeed(g, c) {
  const led = c.officers.reduce((a, id) => a + Math.min(PER_OFFICER, g.officers[id].soldiers), 0);
  const cap = c.officers.length * PER_OFFICER, have = led + c.reserve;
  return { cap, have, need: Math.max(0, cap - have) };
}
export function conscript(g, cid, hundreds) {
  const c = g.cities[cid];
  if (hundreds < 1 || hundreds > conscriptMax(c)) return { ok: false, msg: '无法征兵' };
  c.gold -= 20 * hundreds; c.reserve += 100 * hundreds;
  return { ok: true, msg: `征兵 ${hundreds * 100}` };
}
// 分兵 (5.9 §8): round to 100, +100 while ≤999 (so 1000 max), −100 keeps reserve ≤10000. No book.
export function assignTroops(g, cid, id, delta) {
  const c = g.cities[cid], o = g.officers[id];
  const rem = o.soldiers % 100; o.soldiers -= rem; c.reserve += rem;
  if (c.reserve > 10000) { o.soldiers += c.reserve - 10000; c.reserve = 10000; }
  if (delta > 0 && o.soldiers <= 900 && c.reserve > 0) { const n = Math.min(100, c.reserve); o.soldiers += n; c.reserve -= n; }
  if (delta < 0 && o.soldiers > 0 && !rem && c.reserve < 9901) { o.soldiers -= 100; c.reserve += 100; }
}
export function moveOfficers(g, from, to, ids) {
  const a = g.cities[from], b = g.cities[to];
  if (!roads(from).includes(to)) return { ok: false, msg: '只能调往道路相连的城' };
  if (b.faction !== a.faction && b.faction !== NONE) return { ok: false, msg: '只能调往己方或无主城' };
  if (b.officers.length + ids.length > 10) return { ok: false, msg: '目标城武将已满10人' };
  const f = a.faction, ruler = g.factions[f].ruler;
  a.officers = a.officers.filter((x) => !ids.includes(x));
  b.officers.push(...ids);
  if (ids.includes(ruler)) { b.officers = [ruler, ...b.officers.filter((x) => x !== ruler)]; g.factions[f].city = to; }
  if (!a.officers.length) a.faction = NONE;
  b.faction = f;
  return { ok: true, msg: `${ids.map(name).join('、')} 调往${cityName(to)}` };
}
export function transport(g, from, to, gold, rice, treasure) {
  const a = g.cities[from], b = g.cities[to];
  if (!roads(from).includes(to) || b.faction !== a.faction) return { ok: false, msg: '只能运往相邻己方城' };
  gold = Math.min(gold, a.gold, 9999 - b.gold); rice = Math.min(rice, a.rice, 9999 - b.rice); treasure = Math.min(treasure, a.treasure, 99 - b.treasure);
  if (!gold && !rice && !treasure) return { ok: false, msg: '没有可运输的物资' };
  a.gold -= gold; b.gold += gold; a.rice -= rice; b.rice += rice; a.treasure -= treasure; b.treasure += treasure;
  return { ok: true, msg: `运往${cityName(to)}：金${gold} 米${rice}${treasure ? ` 宝${treasure}` : ''}` };
}
export function appoint(g, cid, id) {
  const c = g.cities[cid];
  if (c.officers.includes(g.factions[c.faction].ruler)) return { ok: false, msg: '君主所在城由君主任太守' };
  c.officers = [id, ...c.officers.filter((x) => x !== id)];
  return { ok: true, msg: `${name(id)} 任${cityName(cid)}太守`, noBook: true };
}
export function buyRice(g, cid, rice) {
  const c = g.cities[cid], [, buy] = D.cities[cid].rice_rate;
  if (!buy) return { ok: false, msg: '此城没有市集' };
  const max = Math.ceil((c.gold * buy) / 100); rice = Math.min(rice, max, 9999 - c.rice);
  if (rice <= 0) return { ok: false, msg: '金不足' };
  c.gold = Math.max(0, c.gold - Math.floor((rice * 100) / buy)); c.rice += rice;
  return { ok: true, msg: `买米 ${rice}` };
}
export function sellRice(g, cid, rice) {
  const c = g.cities[cid], [sell] = D.cities[cid].rice_rate;
  if (!sell) return { ok: false, msg: '此城没有市集' };
  rice = Math.min(rice, c.rice); if (rice <= 0) return { ok: false, msg: '没有米' };
  c.rice -= rice; c.gold = Math.min(9999, c.gold + Math.floor((rice * sell) / 100));
  return { ok: true, msg: `卖米 ${rice}` };
}
export function sellTreasure(g, cid, n) {
  const c = g.cities[cid]; n = Math.min(n, c.treasure);
  if (n <= 0) return { ok: false, msg: '没有宝物' };
  c.treasure -= n; c.gold = Math.min(9999, c.gold + 100 * n);
  return { ok: true, msg: `卖宝 ${n} 件，得金 ${100 * n}` };
}
// Special items in the strategy shop (`0x38A7B`): owner or stat gate, plus a one-time global bought
// flag (`$6FE1`) written only when the purchase goes through. 狼牙枪/圣者之衣 compare against 91 here.
const SPECIAL = { 15: { bit: 0x02, ok: (o) => o.id === 38, need: '关羽专用' }, 23: { bit: 0x04, ok: (o) => o.id === 153, need: '张飞专用' },
  22: { bit: 0x08, ok: (o) => o.war >= 91, need: '需武力91' }, 30: { bit: 0x10, ok: (o) => o.virtue >= 91, need: '需人德91' } };
// The battlefield shop entry (file 0x1274B) compares 武力/人德 with 90 (BCC on #$5A); the city entry uses 91.
const FIELD_SPECIAL = { 22: { ok: (o) => o.war >= 90, need: '需武力90' }, 30: { ok: (o) => o.virtue >= 90, need: '需人德90' } };
export function equipBlock(g, id, eq, { field = false } = {}) {
  const sp = SPECIAL[eq]; if (!sp) return null;
  if ((g.specialBought || 0) & sp.bit) return '已售出';
  const test = (field && FIELD_SPECIAL[eq]) || sp;
  return test.ok(g.officers[id]) ? null : test.need;
}
// Put a bought item on (no refund for the old one) and mark a special piece as sold for the rest of the game.
export function wearEquip(g, id, eq) {
  const e = D.equipment[eq], o = g.officers[id];
  if (SPECIAL[eq]) g.specialBought = (g.specialBought || 0) | SPECIAL[eq].bit;
  if (e.kind === 'weapon') o.weapon = eq; else o.armor = eq - 24;
  return `${name(id)} 装备了${e.name}`;
}
export function buyEquip(g, cid, id, eq) {
  const c = g.cities[cid], e = D.equipment[eq];
  if (!D.cities[cid].facilities.weapons || !D.cities[cid].shop.includes(eq)) return { ok: false, msg: '此城不卖' };
  const block = equipBlock(g, id, eq); if (block) return { ok: false, msg: `${e.name}：${block}` };
  if (c.gold < e.price) return { ok: false, msg: '金不足' };
  c.gold -= e.price;
  return { ok: true, msg: wearEquip(g, id, eq) };
}

// 搜索 (5.7): matrix row by roster/int/virtue band; candidates from the city's table, else ronin nearby.
// 三顾模式 (g.sangu, an option off by default and absent from older records; the player's 搜索 only, the AI's
// is in ai.js): each search in a city with room while its queue head is ready counts one visit for him
// (g.visits, by officer, kept in the record), whatever it turns up; the third brings him in, whoever he favours.
const band = (v) => (v <= 40 ? 40 : v <= 80 ? 80 : 99);
export const SANGU_VISITS = 3;
export function search(g, cid, executor) {
  const c = g.cities[cid], o = g.officers[executor], r = rng(g);
  const n = Math.min(10, c.officers.length);
  const row = D.search_outcomes[`${Math.max(1, n)},${band(o.int)},${band(o.virtue)}`];
  const full = c.officers.length >= 10;
  const head = g.sangu && !full ? queueHead(g, searchQueue(cid)) : null;
  if (head?.ready) {
    const v = g.visits ||= {};
    v[head.id] = (v[head.id] || 0) + 1;
    if (v[head.id] >= SANGU_VISITS) { join(g, cid, head.id); return { ok: true, msg: `${name(head.id)} 感于三顾之诚，愿意出仕`, joined: head.id }; }
  }
  let res = row[r(8)];
  let cand = null;
  if (!full && (res === 5 || res === 6)) {
    cand = searchCandidate(g, cid);
    if (cand == null) { do res = [1, 1, 2, 2, 8, 8, 8, 8][r(8)]; while (res >= 5); }
    // Only an entry of the city's table meets the preference table; a 下野 officer from the ronin scan keeps 5 or 6 (D50)
    else if (g.officers[cand].status === UNAPPEARED && Object.entries(D.rules.search_preference).some(([f, ids]) => ids.includes(cand))) res = 7;
  }
  if (full) while (res >= 5) res = row[r(8)];
  const extra = () => { let v; do v = r(256); while (v >= 41); return v; };
  if (res === 1) { const v = 30 + extra(); c.gold = Math.min(9999, c.gold + v); return { ok: true, msg: `发现了金 ${v}` }; }
  if (res === 2) { const v = 50 + extra(); c.rice = Math.min(9999, c.rice + v); return { ok: true, msg: `发现了米 ${v}` }; }
  if (res === 3) { const v = 80 + extra(); c.gold = Math.min(9999, c.gold + v); return { ok: true, msg: `发现了大量的金 ${v}` }; }
  if (res === 4) { const v = 1 + r(3); c.treasure = Math.min(99, c.treasure + v); return { ok: true, msg: `发现了宝物 ${v} 件` }; }
  if (res === 8) return { ok: true, msg: '什么也没有找到' };
  const t = g.officers[cand];
  if (res === 5) { join(g, cid, cand); return { ok: true, msg: `${name(cand)} 愿意出仕`, joined: cand }; }
  if (res === 6) return { ok: true, offer: cand, price: Math.floor((t.hp + t.war + t.int) / 3), msg: `${name(cand)} 要求 ${Math.floor((t.hp + t.war + t.int) / 3)} 金` };
  const pf = Number(Object.entries(D.rules.search_preference).find(([, ids]) => ids.includes(cand))[0]);
  const accept = c.faction === pf ? r(16) >= 2 : r(16) >= 13;
  if (accept) { join(g, cid, cand); return { ok: true, msg: `${name(cand)} 被您的仁德打动，愿意出仕`, joined: cand }; }
  return { ok: true, msg: `${name(cand)} 拒绝了出仕`, refused: cand };
}
function searchCandidate(g, cid) {
  const head = queueHead(g, searchQueue(cid));
  if (head?.ready) return head.id;
  const near = [cid, ...roads(cid)];
  return g.officers.find((o) => o.status === RONIN && near.includes(o.loc))?.id ?? null;
}
export function hire(g, cid, id, price) {
  const c = g.cities[cid];
  if (c.gold < price) return { ok: false, msg: '金不足' };
  c.gold -= price; join(g, cid, id);
  return { ok: true, msg: `${name(id)} 出仕`, joined: id };
}
function join(g, cid, id) {
  const c = g.cities[cid], o = g.officers[id];
  if (g.visits) delete g.visits[id];
  if (o.status === RONIN) o.loyalty = recruitLoyalty(g.officers[g.factions[c.faction].ruler].virtue, o.loyalty);
  o.status = SERVING; c.officers.push(id);
}

// ---------- Save / load (localStorage, numbered slots) ----------
// The original kept a single record; here slots 1–SLOTS each hold a whole game. A record from before slots
// (stored under KEY itself) moves into the first empty slot the first time the slots are read.
// Each slot keeps the record it held before the last write under `:bak`, and a slot that no longer parses or
// checks out (a cut-off write, a hand edit) loads that one instead; restored() tells the game so it can say so.
// g.version is the record's layout: MIGRATIONS[n] lifts a version-n record to n + 1 when it loads, and a record
// written by a newer release is refused rather than misread.
export const SLOTS = 8, SAVE_VERSION = 1;
const MIGRATIONS = {};
// A pack's records live under their own keys (`haou-hd2d-save@<pack>:1` …), so the original's slots never see them; a record
// carries its pack ({ id, version }) and loads while the pack's major version is the same (design §5.3).
let KEY = 'haou-hd2d-save', QUICK_KEY = `${KEY}:quick`, QUICK_BAK = `${QUICK_KEY}:bak`, AUTO_KEY = `${KEY}:auto`;
const slotKey = (n) => `${KEY}:${n}`, bakKey = (n) => `${KEY}:${n}:bak`;
const keys = () => {
  const k = D?.pack ? `haou-hd2d-save@${D.pack.id}` : 'haou-hd2d-save';
  if (k !== KEY) { KEY = k; QUICK_KEY = `${KEY}:quick`; QUICK_BAK = `${QUICK_KEY}:bak`; AUTO_KEY = `${KEY}:auto`; }
};
const majorOf = (v) => Number(String(v ?? '').split('.')[0]);
export const samePack = (g) => (g.pack?.id ?? null) === (D?.pack?.id ?? null) && (!g.pack || majorOf(g.pack.version) === majorOf(D.pack.version));
// Why a record cannot be played with the data in use, for the load screen and the editor (null when it can).
export function packMismatch(g) {
  if (!g || typeof g !== 'object' || samePack(g)) return null;
  if (!g.pack) return '这是本体（未装数据包）的记录';
  if (!D?.pack || g.pack.id !== D.pack.id) return `这是数据包「${g.pack.id}」的记录`;
  return `这是数据包「${g.pack.id}」${g.pack.version} 版的记录，与当前 ${D.pack.version} 版的主版本号不同`;
}
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const read = (k) => { try { return parse(localStorage.getItem(k)); } catch { return null; } };
export function upgrade(g) {
  if (!g || typeof g !== 'object') return null;
  try { g.version ??= 1; while (g.version < SAVE_VERSION) MIGRATIONS[g.version++](g); } catch { return null; }
  const ok = g.version === SAVE_VERSION && Number.isInteger(g.year) && Number.isInteger(g.month) && Number.isInteger(g.player)
    && Array.isArray(g.officers) && Array.isArray(g.factions) && Array.isArray(g.cities) && g.cities.length === (D?.cities.length ?? 30) && g.cities.every((c) => Array.isArray(c?.officers))
    && samePack(g);
  return ok ? g : null;
}
const fromBak = new WeakSet();
export const restored = (g) => fromBak.has(g);
function migrate() {
  keys();
  try {
    const old = localStorage.getItem(KEY); if (!old) return;
    for (let n = 1; n <= SLOTS; n++) if (!localStorage.getItem(slotKey(n))) { localStorage.setItem(slotKey(n), old); localStorage.removeItem(KEY); return; }
  } catch {}
}
export function save(g, slot = g.slot ?? 1) {
  keys();
  try {
    const k = slotKey(slot), prev = localStorage.getItem(k);
    if (prev && upgrade(parse(prev))) localStorage.setItem(bakKey(slot), prev);
    g.slot = slot; g.savedAt = Date.now(); g.version = SAVE_VERSION; localStorage.setItem(k, JSON.stringify(g));
    return true;
  } catch { return false; }
}
// The phone's 自动续玩 (src/app.js): the campaign as it stood when the page went out of sight, kept apart from the eight records
// and the quick one. It is written when the page is hidden and dropped when the page comes back, so it only outlives a page the
// system threw away; continuing from it takes it. It is no record: nothing is spent, and it cannot be loaded a second time.
export function saveAuto(g) { keys(); try { localStorage.setItem(AUTO_KEY, JSON.stringify({ ...g, savedAt: Date.now(), version: SAVE_VERSION })); return true; } catch { return false; } }
export function loadAuto() { keys(); const g = upgrade(read(AUTO_KEY)); if (g) { registerClones(g); g.auto = true; } return g; }
export function dropAuto() { keys(); try { localStorage.removeItem(AUTO_KEY); } catch {} }
// Why a numbered slot that holds something gives no record (load returns null): another pack's, an older major version, or damaged.
// null for an empty slot. The load and save lists show it, so a record is never taken for an empty place and written over unawares.
export function unreadable(slot) {
  migrate();
  let raw = null; try { raw = localStorage.getItem(slotKey(slot)); } catch {}
  if (!raw || load(slot)) return null;
  const g = parse(raw);
  return packMismatch(g) ?? (Number.isInteger(g?.version) && g.version > SAVE_VERSION ? '这是更新版本的游戏的记录' : '记录已损坏');
}
export function load(slot) {
  migrate();
  let raw = null; try { raw = localStorage.getItem(slotKey(slot)); } catch {}
  let g = upgrade(parse(raw));
  if (!g && raw && (g = upgrade(read(bakKey(slot))))) fromBak.add(g); // an empty slot stays empty
  if (g) { g.slot = slot; registerClones(g); }
  return g;
}
// The quick record is separate from the eight numbered records. Its owner identifies a campaign, not a
// ruler or a month: two games started with the same ruler must still ask before replacing one another.
const newQuickId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
// The title and editor immediately dereference the player's ruler and city. A parsed JSON object that
// lacks either is damaged, even if the generic legacy record check accepts its arrays.
function quickUpgrade(g) {
  g = upgrade(g); if (!g) return null;
  const originalOfficers = D?.officers?.filter((o) => o && !o.clone).length;
  if (!originalOfficers || g.officers.length < originalOfficers
    || !Number.isInteger(g.month) || g.month < 0 || g.month >= 12
    || !Number.isInteger(g.level) || !D.rules.income_ab[g.level]
    || !Number.isInteger(g.order) || !D.rules.turn_orders[g.order]
    || !Number.isInteger(g.turnIdx) || g.turnIdx < -1 || g.turnIdx >= g.factions.length
    || (g.current != null && (!Number.isInteger(g.current) || !g.factions[g.current]))
    || !Number.isInteger(g.books) || g.books < 0
    || !Array.isArray(g.aiCursor) || g.aiCursor.length < g.factions.length || g.aiCursor.some((i) => !Number.isInteger(i) || i < 0 || i > g.cities.length)) return null;
  const f = g.factions[g.player], ruler = f?.ruler, city = f?.city;
  if (g.clones != null && !Array.isArray(g.clones)) return null;
  const clones = new Set(g.clones ?? []);
  const known = (id) => Number.isInteger(id) && !!g.officers[id] && !!(D?.officers?.[id] || clones.has(id));
  if (!known(ruler) || !Number.isInteger(city) || !g.cities[city]) return null;
  // The HUD, turn loop and editor iterate every officer/faction and dereference each city's roster.
  if (g.officers.some((o, i) => !o || o.id !== i || !known(i))) return null;
  if (g.factions.length !== D?.factions?.length || g.factions.some((fac, i) => !fac || fac.id !== i || !Array.isArray(fac.alliance) || fac.alliance.length < g.factions.length
    || (fac.ruler != null && (!known(fac.ruler) || !Number.isInteger(fac.city) || !g.cities[fac.city])) || (fac.fallen != null && !known(fac.fallen)))) return null;
  if (g.cities.some((c, i) => c.id !== i || !Number.isInteger(c.faction) || (c.faction !== NONE && !g.factions[c.faction]) || c.officers.some((id) => !known(id)))) return null;
  return g;
}
// The raw value is also a change token while an overwrite confirmation is open in another tab.
export function quickToken() { keys(); try { return localStorage.getItem(QUICK_KEY); } catch { return undefined; } }
export function hasQuick() { return !!quickToken(); }
export function saveQuick(g) {
  keys();
  try {
    const id = g.quickId || newQuickId();
    const text = JSON.stringify({ ...g, quickId: id, savedAt: Date.now(), version: SAVE_VERSION });
    if (!quickUpgrade(parse(text))) return false;
    const prev = localStorage.getItem(QUICK_KEY);
    if (prev && quickUpgrade(parse(prev))) localStorage.setItem(QUICK_BAK, prev);
    localStorage.setItem(QUICK_KEY, text);
    g.quickId = id; // never change the running game or its current numbered slot on a failed write
    return true;
  } catch { return false; }
}
// Every game/editor writer checks and writes inside the same origin-wide lock. A token check outside
// the lock alone cannot protect two tabs that both see the empty slot at the same instant.
export async function saveQuickChecked(g, expected, { isCurrent = () => true, onSaved = () => {} } = {}) {
  keys();
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return 'unavailable';
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    return await locks.request(QUICK_KEY, { signal: abort.signal }, () => {
      const token = quickToken();
      if (token === undefined) return 'failed';
      if (token !== expected) return 'changed';
      if (!isCurrent()) return 'cancelled';
      if (!saveQuick(g)) return 'failed';
      try { onSaved(quickToken()); } catch { /* the record was already written */ }
      return 'saved';
    });
  } catch (err) { return err?.name === 'AbortError' ? 'busy' : 'failed'; }
  finally { clearTimeout(timer); }
}
export function loadQuick() {
  keys();
  let raw = null; try { raw = localStorage.getItem(QUICK_KEY); } catch {}
  if (!raw) return null;
  const parsed = parse(raw);
  // An unknown future layout is not a damaged record: do not silently offer an older backup in its place.
  if (Number.isInteger(parsed?.version) && parsed.version > SAVE_VERSION) return null;
  let g = quickUpgrade(parsed), backup = false;
  if (!g && (g = quickUpgrade(read(QUICK_BAK)))) backup = true;
  // The numbered slot saved in the snapshot may since have been replaced by another campaign. A manual
  // save after loading must ask before overwriting it, just as for any other occupied slot.
  return g && loadSnapshot(g, { quick: true, backup });
}
// Reconstitute the record the player confirmed after a page restart, retaining backup diagnostics.
export function loadSnapshot(g, { quick = false, backup = false } = {}) {
  g = quick ? quickUpgrade(g) : upgrade(g); if (!g) return null;
  if (quick) g.slot = null;
  if (backup) fromBak.add(g);
  registerClones(g);
  return g;
}
// 阿会喃 copies made by the 原版漏洞 mode (core/ahuinan.js) are officers past the original 237. Each borrows officer
// 0's static entry (name, portrait, army, appearance) under its own id, so every lookup by id keeps working.
export function registerClones(g) {
  if (D) for (const id of g.clones ?? []) D.officers[id] = { ...D.officers[0], id, clone: true, year: g.officers[id]?.debut ?? g.year };
  return g;
}
// Every slot in order, null where empty; latest() is the one saved most recently (a migrated record has no time).
export function saves() { migrate(); return Array.from({ length: SLOTS }, (_, i) => load(i + 1)); }
export function latest(list = saves()) { return list.filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null; }
// A resumed game draws a fresh seed, so loading the same record and doing the same thing does not replay the
// same events. The original's random cursor drifted with idle frames instead (waiting changed the outcome);
// that is not copied, as it teaches load-wait-retry. The saved seed is kept for reproducing a report.
export function reseed(g, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0) { g.savedSeed = g.seed; g.seed = seed; return g; }

// ---------- Diplomacy (5.6, player side) ----------
// 同盟 (`bank25` proposal), 诱纳 and 离间 (`$D036` → `$E843`) all make the original's percent roll: table bytes from the
// moving cursor, those of 100 and over thrown away (core/origrng.js), which comes under p more often than p in 100.
export function allianceOffer(g, cid, actor, target) {
  const r = rng(g), me = g.cities[cid].faction, a = g.officers[actor], tr = g.officers[g.factions[target].ruler];
  const t = Math.max(a.int + a.virtue - tr.int, 0);
  let p = Math.floor(t / 4) + Math.max(citiesOf(g, me).length - citiesOf(g, target).length, 0);
  if (p & 128) p = 0;
  if (roll100(r) >= p) return { ok: true, msg: `${factionName(g, target)}拒绝了同盟` };
  const c = g.cities[cid], thr = c.gold > c.rice ? 3 : c.gold === c.rice ? 5 : 7;
  return { ok: true, quote: 4 * (100 - p), kind: r(10) < thr ? 'gold' : 'rice', target, msg: `${factionName(g, target)}愿意结盟` };
}
export function payAlliance(g, cid, target, kind, amount) {
  const c = g.cities[cid], me = c.faction;
  if (c[kind] < amount) return { ok: false, msg: `${kind === 'gold' ? '金' : '米'}不足，同盟未成`, noBook: true };
  c[kind] -= amount;
  const dst = officerCity(g, g.factions[target].ruler);
  if (dst) dst[kind] = Math.min(9999, dst[kind] + amount);
  g.factions[me].alliance[target] = 12; g.factions[target].alliance[me] = 12;
  return { ok: true, msg: `与${factionName(g, target)}结成同盟（12个月）`, noBook: true };
}
// 废除同盟 (bank 28 $CD0A→$CEAD→$CEC7): an ally chosen under 同盟 skips the envoy and asks only for the book;
// 是 clears both sides' timers through $D508 and nothing else — no envoy, payment, loyalty or reply. $0473=$80
// skips the officer picture ($D186), so the result is the bare message $44.
export function breakAlliance(g, me, target) {
  g.factions[me].alliance[target] = 0; g.factions[target].alliance[me] = 0;
  return { ok: true, msg: `与${factionName(g, target)}的同盟已经废除`, plain: true };
}
const LURE = [[30, 5000, 250], [40, 4000, 450], [50, 3000, 900], [60, 2000, 1300], [70, 1000, 2000], [75, 0, 2400]];
export function lure(g, cid, actor, id) {
  const r = rng(g), c = g.cities[cid], a = g.officers[actor], o = g.officers[id];
  if (c.officers.length >= 10) return { ok: false, msg: '本城武将已满' };
  if (isRuler(g, id)) return { ok: false, msg: '无法诱纳君主' };
  const row = LURE.find(([l]) => o.loyalty <= l);
  const p = row ? Math.floor((a.int * a.virtue + row[1] + 100 * (a.level - 1)) / row[2]) : 0;
  if (roll100(r) >= p) return { ok: true, msg: `诱纳${name(id)}失败`, failed: true };
  const from = officerCity(g, id);
  from.officers = from.officers.filter((x) => x !== id); if (!from.officers.length) from.faction = NONE;
  c.officers.push(id); o.loyalty = recruitLoyalty(g.officers[g.factions[c.faction].ruler].virtue, o.loyalty);
  return { ok: true, msg: `${name(id)}接受诱纳，加入我军`, joined: id };
}
export function sow(g, actor, id) {
  const r = rng(g), a = g.officers[actor], o = g.officers[id];
  if (isRuler(g, id)) return { ok: false, msg: '无法离间君主' };
  const p = Math.floor((((a.int + a.virtue) & 255) * Math.max(98 - o.loyalty, 0)) / 100);
  if (roll100(r) >= p) return { ok: true, msg: `离间${name(id)}失败`, failed: true };
  const loss = Math.floor(a.int / 20) + (r(256) & 3);
  if (!loss) return { ok: true, msg: `离间${name(id)}失败`, failed: true };
  o.loyalty = Math.max(0, o.loyalty - loss);
  return { ok: true, gain: loss, msg: `${name(id)}忠诚 −${loss}（现${o.loyalty}）` };
}
