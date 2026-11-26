// 数据包 (docs/战略地图数据包扩展设计_2026-11-17.md): a mod is a folder of JSON under mods/<id>/ that adds cities, roads,
// factions and officers to the game's data, or changes the opening state of the original ones. It is merged here into
// one object of the same shape as data/game-data.json before setData; the rules read only the merged object.
// Pure data (no DOM, no three.js), so tools/check_pack.mjs runs the very same merge and checks in node.
//
// With no pack the merge never runs: the data is game-data.json plus the hand-kept map fields of data/base-map.json,
// and every rule, draw and record stays as before (AGENTS.md rule 4).

export const PACK_FORMAT = 1; // pack.json "game": the layout of the files below
export const PACK_FILES = ['cities.json', 'roads.json', 'factions.json', 'officers.json']; // all optional; pack.json is required
export const FIRST_MOD_FACTION = 8, MAX_MOD_FACTIONS = 8; // 7 is NONE (no owner) and stays a placeholder: 8–15 fit 4 territory bits
const NONE = 7;
export const TIERS = ['capital', 'major', 'county', 'pass'];
// The building style a new city's sand-table model is drawn in (docs/城池风格模型_方案_2026-11-22.md): looks only, no rule
// reads it, so it is not in the save format. han is the default and is left out of the merged record.
export const STYLES = ['han', 'japan', 'korea'];
// The troop looks a new faction's 白兵 squads may wear in place of an original kind's (docs/扩展兵种_方案_2026-11-24.md): looks only,
// each borrows its kind's rules, frames and clips, so no rule reads it and it is not in the save format. The pictures
// (assets/ai/sprites/troops/<side>-<look>[-v2][-turn]) ship with the open-source repository, not in the release packages
// (desktop/build-app.mjs): without them a squad wears its original kind's look.
export const TROOP_LOOKS = { soldier: ['hillman', 'ashigaru'], cavalry: ['elephant', 'steppe'] };
// The women generals' battle looks a new officer may wear in place of his `like` officer's 白兵 sprite, 单挑 strips and war-map
// march strip (tools/heroine_prompts.mjs, one per weapon class): looks only, no rule reads them and they are not in the save
// format; the portrait, faces and every number still come from `like`. The pictures (assets/ai/sprites/{officers,duel,march}/
// <look>*, listed in sprites/heroines.json) ship with the open-source repository, not in the release packages
// (desktop/build-app.mjs): without them the officer fights in his `like` officer's look.
export const HEROINE_LOOKS = { 'f-spear': 'spear', 'f-blade': 'blade', 'f-sword': 'sword' };
export const weaponClassOf = (weapon) => ['sword', 'blade', 'spear'][Math.floor(weapon / 8)];
// The battle look of an officer with no strips of his own: his side's generic general (`attacker` / `defender`, the glaive) in the
// weapon class he holds at that moment — `<side>-spear` or `<side>-sword` for the other two (equipment 0–7 剑, 8–15 刀, 16–23 枪,
// the groups the 单挑 hit table reads). A weapon he buys or wins changes it from the next view built; a missing set falls back to
// the glaive in the views.
export const genericArt = (look, weapon) => { const c = weaponClassOf(weapon); return c && c !== 'blade' ? `${look}-${c}` : look; };
export const MIN_CITY_GAP = 0.9; // board units between two seats (the closest original pair, 兖州–豫州, is 1.13 apart as drawn)

// The map fields of the original 30 (data/base-map.json) go onto game-data.json's cities by id.
const MAP_FIELDS = ['lon', 'lat', 'seat', 'tier', 'bank', 'fort', 'hist'];
export function withBaseMap(d, base) {
  for (const s of base.cities) for (const k of MAP_FIELDS) if (s[k] !== undefined) d.cities[s.id][k] = s[k];
  return d;
}

// ---------- Field checks ----------
// Names reach the page as text in some places and as markup in others (city tags, notices): no markup characters at all.
const SAFE_NAME = /^[^<>&"'`\\\u0000-\u001f\u007f]{1,12}$/u, SAFE_TEXT = /^[^<>&"'`\\\u0000-\u001f\u007f]{0,200}$/u;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/, VERSION = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/, COLOR = /^#[0-9a-fA-F]{6}$/;
const CITY_NUM = { gold: [0, 9999], rice: [0, 9999], pop: [0, 9999], land: [0, 999], industry: [0, 999], disaster: [0, 99], gov: [0, 100], reserve: [0, 10000], treasure: [0, 99] };
export const OFFICER_NUM = { hp: [1, 100], war: [1, 100], int: [1, 100], loyalty: [1, 100], virtue: [1, 100], exp: [0, 49999], soldiers: [0, 1000],
  weapon: [0, 23], armor: [0, 7], level: [1, 8], year: [189, 300], death: [189, 400] };
const CITY_ADD = new Set(['name', 'lon', 'lat', 'seat', 'tier', 'style', 'like', 'calamity', 'faction', 'search', ...Object.keys(CITY_NUM), 'facilities', 'rice_rate', 'shop', 'field_shop', 'ai_shop', 'note']);
const CITY_EDIT = new Set(['city', 'faction', ...Object.keys(CITY_NUM), 'note']);
const OFFICER_ADD = new Set(['name', 'like', 'look', 'troops', 'city', 'appear', 'faction', 'army', ...Object.keys(OFFICER_NUM), 'note']);
const OFFICER_EDIT = new Set(['officer', 'city', 'troops', ...Object.keys(OFFICER_NUM), 'army', 'note']);
const FACTION_ADD = new Set(['name', 'ruler', 'like', 'colors', 'troops', 'succession', 'join', 'prefer', 'note']);
const META = new Set(['id', 'name', 'version', 'author', 'game', 'regions', 'description']);

// The longitude and latitude a seat may take: the original board (src/worldmap.js LON0…LAT1), or a declared region's box.
export const BASE_BOX = { lon: [97.5, 125], lat: [20, 43] };

// The boards the regions a pack names stand on, [[board, { lon, lat }]] in the order named; a board inside another's box (east
// inside japan's) is left to that one, which has the same land.
export function regionBoards(regions, index = {}) {
  const all = regions.flatMap((r) => { const e = index?.[r]; return !e ? [] : e.boards ? Object.entries(e.boards) : [[r, e]]; });
  const inside = (a, b) => a.lon[0] >= b.lon[0] && a.lon[1] <= b.lon[1] && a.lat[0] >= b.lat[0] && a.lat[1] <= b.lat[1];
  return all.filter(([n, b], i) => all.findIndex(([m]) => m === n) === i && !all.some(([m, c]) => m !== n && inside(b, c) && !(inside(c, b) && m > n)));
}

// pack: { meta: pack.json, cities, roads, factions, officers } as parsed (missing files undefined).
// opts.regions: the official extension regions open to packs (assets/ai/sandtable/regions/index.json): { name: { lon: [w, e], lat: [s, n] } }
// for a region that is one board of its name, or { name: { boards: { board: { lon, lat }, … } } } for one opened as several boards
// together (japan: the north strip and the east of the table to 46°N, so the table stays one rectangle; regionBoards).
// Returns { data, errors }: data is null when anything is wrong (the game then never starts on half a pack).
export function mergePack(base, pack, opts = {}) {
  const errors = [], err = (where, msg) => errors.push(`${where}：${msg}`);
  const d = structuredClone(base);
  const meta = pack?.meta;
  if (!meta || typeof meta !== 'object') return { data: null, errors: ['pack.json：缺少或不是 JSON 对象'] };
  for (const k of Object.keys(meta)) if (!META.has(k)) err('pack.json', `不认识的字段 ${k}`);
  if (!SLUG.test(meta.id ?? '')) err('pack.json', 'id 只能用小写字母、数字和 -，以字母或数字开头，最长 40');
  if (!SAFE_NAME.test(meta.name ?? '')) err('pack.json', 'name 必填，1–12 字，不能含 < > & " \' ` \\');
  if (!VERSION.test(meta.version ?? '')) err('pack.json', 'version 写成 主.次 或 主.次.修，例如 1.0.0');
  if (meta.author != null && !SAFE_TEXT.test(meta.author)) err('pack.json', 'author 含不允许的字符');
  if (meta.description != null && !SAFE_TEXT.test(meta.description)) err('pack.json', 'description 含不允许的字符或超过 200 字');
  if (meta.game !== PACK_FORMAT) err('pack.json', `game 应为 ${PACK_FORMAT}（本体数据包格式版本）`);
  const regions = meta.regions ?? [];
  if (!Array.isArray(regions) || regions.some((r) => typeof r !== 'string')) err('pack.json', 'regions 应为地块名的数组');
  else for (const r of regions) if (!opts.regions?.[r]) err('pack.json', `regions 里的「${r}」不是已开放的官方扩展地块`);
  const boards = Array.isArray(regions) ? regionBoards(regions, opts.regions) : [];
  const boxes = [BASE_BOX, ...boards.map(([, b]) => b)];

  const list = (file, v, shape) => {
    if (v == null) return shape === 'object' ? {} : [];
    if (shape === 'object' ? (typeof v !== 'object' || Array.isArray(v)) : !Array.isArray(v)) { err(file, shape === 'object' ? '应为 JSON 对象' : '应为 JSON 数组'); return shape === 'object' ? {} : []; }
    return v;
  };
  const citiesFile = list('cities.json', pack.cities, 'object'), officersFile = list('officers.json', pack.officers, 'object');
  for (const k of Object.keys(citiesFile)) if (!['add', 'edit'].includes(k)) err('cities.json', `只能有 add 和 edit，不认识 ${k}`);
  for (const k of Object.keys(officersFile)) if (!['add', 'edit'].includes(k)) err('officers.json', `只能有 add 和 edit，不认识 ${k}`);
  const addCities = list('cities.json add', citiesFile.add), editCities = list('cities.json edit', citiesFile.edit);
  const addOfficers = list('officers.json add', officersFile.add), editOfficers = list('officers.json edit', officersFile.edit);
  const addFactions = list('factions.json', pack.factions), roads = list('roads.json', pack.roads);
  const unknown = (where, o, allowed) => { for (const k of Object.keys(o)) if (!allowed.has(k)) err(where, `不认识的字段 ${k}`); };
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const nums = (where, o, spec) => {
    for (const [k, [lo, hi]] of Object.entries(spec)) if (o[k] !== undefined && !(Number.isInteger(o[k]) && o[k] >= lo && o[k] <= hi)) err(where, `${k} 应为 ${lo}–${hi} 的整数`);
  };

  // Troop looks ({ soldier: 'ashigaru', cavalry: 'steppe' }, TROOP_LOOKS) on a new faction or on an officer, new or original.
  const checkTroops = (where, t) => {
    if (t == null) return;
    const how = Object.entries(TROOP_LOOKS).map(([k, v]) => `"${k}": ${v.map((x) => `"${x}"`).join(' / ')}`).join('，');
    if (!isObj(t) || !Object.keys(t).length) err(where, `troops 应为 { 兵种: 外观 }，可写 ${how}`);
    else for (const [k, v] of Object.entries(t)) if (!TROOP_LOOKS[k]?.includes(v)) err(where, `troops 的 "${k}": ${JSON.stringify(v)} 不认识，可写 ${how}`);
  };

  // ---------- Names and references ----------
  const nOfficers = base.officers.length, nCities = base.cities.length, nFactions = base.factions.length;
  const cityByName = new Map(base.cities.map((c) => [c.name, c.id])), officerByName = new Map(base.officers.map((o) => [o.name, o.id]));
  const factionByName = new Map(base.factions.map((f) => [f.name, f.id]));
  // A reference is an id (number) or a name (string); `orig` limits it to the original data.
  const ref = (where, what, v, byName, count, { orig = false, origCount = count } = {}) => {
    const id = typeof v === 'number' ? v : byName.get(v);
    if (!Number.isInteger(id) || id < 0 || id >= (orig ? origCount : count) || (what === '势力' && id === NONE)) { err(where, `${what}「${v}」不存在${orig ? '于原版' : ''}`); return null; }
    return id;
  };

  // ---------- Factions: the 7 originals, a placeholder at NONE, then the pack's from 8 ----------
  if (addFactions.length > MAX_MOD_FACTIONS) err('factions.json', `最多 ${MAX_MOD_FACTIONS} 个新势力，现有 ${addFactions.length} 个`);
  addFactions.forEach((f, i) => {
    const where = `factions.json [${i}]${f?.name ? ` ${f.name}` : ''}`;
    if (!isObj(f)) return err(where, '应为 JSON 对象');
    unknown(where, f, FACTION_ADD);
    if (!SAFE_NAME.test(f.name ?? '')) err(where, 'name 必填，1–12 字，不能含 < > & " \' ` \\');
    else if (factionByName.has(f.name)) err(where, `势力名「${f.name}」重复`);
    else factionByName.set(f.name, FIRST_MOD_FACTION + i);
    if (!isObj(f.colors) || !COLOR.test(f.colors.flag ?? '') || !COLOR.test(f.colors.land ?? '')) err(where, 'colors 应为 { "flag": "#rrggbb", "land": "#rrggbb" }（旗帜色、领地色）');
    checkTroops(where, f.troops);
  });
  const factionCount = addFactions.length ? FIRST_MOD_FACTION + Math.min(addFactions.length, MAX_MOD_FACTIONS) : nFactions;
  const factionRef = (where, v) => (v == null ? NONE : ref(where, '势力', v, factionByName, factionCount, {}));

  // ---------- Officers: new ones after the 237 ----------
  const newOfficers = [];
  addOfficers.forEach((o, i) => {
    const id = nOfficers + i, where = `officers.json add[${i}]${o?.name ? ` ${o.name}` : ''}`;
    if (!isObj(o)) { err(where, '应为 JSON 对象'); newOfficers.push(null); return; }
    unknown(where, o, OFFICER_ADD);
    if (!SAFE_NAME.test(o.name ?? '')) err(where, 'name 必填，1–12 字，不能含 < > & " \' ` \\');
    else if (officerByName.has(o.name)) err(where, `武将名「${o.name}」与已有武将重复`);
    else officerByName.set(o.name, id);
    newOfficers.push(o);
  });
  const officerCount = nOfficers + addOfficers.length;
  const officerRef = (where, v, orig) => ref(where, '武将', v, officerByName, officerCount, { orig, origCount: nOfficers });

  // ---------- Cities: new ones after the 30 ----------
  addCities.forEach((c, i) => {
    const id = nCities + i, where = `cities.json add[${i}]${c?.name ? ` ${c.name}` : ''}`;
    if (!isObj(c)) return err(where, '应为 JSON 对象');
    if (!SAFE_NAME.test(c.name ?? '')) err(where, 'name 必填，1–12 字，不能含 < > & " \' ` \\');
    else if (cityByName.has(c.name)) err(where, `城名「${c.name}」重复`);
    else cityByName.set(c.name, id);
  });
  const cityCount = nCities + addCities.length;
  const cityRef = (where, v, orig) => ref(where, '城', v, cityByName, cityCount, { orig, origCount: nCities });

  // Factions into the data (their rulers and lists are checked once officers and cities are placed).
  if (addFactions.length) {
    d.factions.push({ id: NONE, name: '', ruler: null, placeholder: true });
    addFactions.slice(0, MAX_MOD_FACTIONS).forEach((f, i) => {
      const id = FIRST_MOD_FACTION + i, where = `factions.json [${i}] ${f?.name ?? ''}`;
      if (!isObj(f)) return;
      const like = f.like == null ? null : ref(where, '势力', f.like, factionByName, nFactions, { orig: true, origCount: nFactions });
      if (f.like == null) err(where, 'like 必填：借用哪个原版势力的 AI 参数（0–6 或君主名）');
      d.factions.push({ id, name: f.name, ruler: null, like: like ?? 0, colors: { flag: f.colors?.flag, land: f.colors?.land }, ...(isObj(f.troops) ? { troops: { ...f.troops } } : {}) });
      const L = like ?? 0;
      for (const row of d.rules.turn_orders) row.push(id); // after the originals, by number (design §5.2)
      for (const e of base.rules.ai_dispatch) if (e.faction_id === L) d.rules.ai_dispatch.push({ ...structuredClone(e), faction_id: id });
      const th = d.rules.ai_domestic.faction_development_threshold_out_of_80; th[NONE] ??= 0; th[id] = th[L];
    });
  }

  // New officers into the data: everything not given is the `like` officer's (art included).
  newOfficers.forEach((o, i) => {
    const id = nOfficers + i, where = `officers.json add[${i}]${o?.name ? ` ${o.name}` : ''}`;
    if (!o) { d.officers.push({ ...structuredClone(base.officers[0]), id, name: `#${id}`, art: 0 }); return; }
    nums(where, o, OFFICER_NUM);
    const like = o.like == null ? (err(where, 'like 必填：借用哪个原版武将的整套美术'), 0) : (officerRef(where, o.like, true) ?? 0);
    const L = base.officers[like], appear = o.appear ?? 'initial';
    if (!['initial', 'search', 'join'].includes(appear)) err(where, 'appear 只能是 initial（开局在城中）、search（搜索出现）、join（自动出仕）');
    if (o.army != null && !['平', '山', '水'].includes(o.army)) err(where, 'army 只能是 平、山、水');
    if (o.look != null && !Object.hasOwn(HEROINE_LOOKS, o.look)) err(where, `look ${JSON.stringify(o.look)} 不认识，可写 ${Object.keys(HEROINE_LOOKS).map((k) => `"${k}"`).join(' / ')}`);
    const pick = (k) => (o[k] !== undefined ? o[k] : L[k]);
    const rec = {
      id, name: o.name, jp: o.name, hp: pick('hp'), war: pick('war'), int: pick('int'), loyalty: pick('loyalty'), virtue: pick('virtue'), exp: pick('exp'),
      soldiers: pick('soldiers'), weapon: pick('weapon'), armor: pick('armor'), level: pick('level'), army: pick('army'),
      appear: { initial: 'initial', search: 'search_city', join: 'automatic_faction' }[appear] ?? 'initial',
      year: o.year ?? 189, city: null, faction: null, death: pick('death'), portrait: L.portrait, profile: L.profile, art: L.art ?? like, mod: true,
    };
    if (Object.hasOwn(HEROINE_LOOKS, o.look ?? '')) rec.look = o.look; // looks only: no rule reads it
    checkTroops(where, o.troops); if (isObj(o.troops)) rec.troops = { ...o.troops }; // the squads he leads, looks only too
    if (rec.death < rec.year) err(where, `death（${rec.death}）早于登场年 year（${rec.year}）`);
    if (appear === 'join') { if (o.city != null) err(where, 'appear 为 join 时不写 city：他出仕到势力君主所在城'); rec.faction = factionRef(where, o.faction ?? null); if (o.faction == null) err(where, 'appear 为 join 时 faction 必填'); }
    else { if (o.faction != null) err(where, 'faction 只用于 appear 为 join；开局所属由所在城决定'); rec.city = o.city == null ? (err(where, 'city 必填'), null) : cityRef(where, o.city); }
    if (appear === 'initial' && rec.year > 189) err(where, 'appear 为 initial 的武将 year 应为 189');
    d.officers.push(rec);
  });

  // New cities into the data: what a city needs to stage a war (field, deployment, villages) comes from `like`.
  addCities.forEach((c, i) => {
    const id = nCities + i, where = `cities.json add[${i}]${c?.name ? ` ${c.name}` : ''}`;
    if (!isObj(c)) { d.cities.push({ ...structuredClone(base.cities[0]), id, name: `#${id}`, faction: NONE, officers: [], roads: [] }); return; }
    unknown(where, c, CITY_ADD); nums(where, c, CITY_NUM);
    const like = c.like == null ? (err(where, 'like 必填：借用哪座原版城的战争地图、布阵和村庄'), 0) : (cityRef(where, c.like, true) ?? 0);
    const L = base.cities[like];
    if (!(typeof c.lon === 'number' && typeof c.lat === 'number')) err(where, 'lon、lat 必填（治所经纬度）');
    else if (!boxes.some((b) => c.lon >= b.lon[0] && c.lon <= b.lon[1] && c.lat >= b.lat[0] && c.lat <= b.lat[1])) err(where, `经纬度 ${c.lon}, ${c.lat} 落在原版沙盘${regions.length ? '和所声明地块' : ''}之外`);
    if (!TIERS.includes(c.tier)) err(where, `tier 只能是 ${TIERS.join(' / ')}`);
    if (c.style != null && !STYLES.includes(c.style)) err(where, `style 只能是 ${STYLES.join(' / ')} 或不写（han）`);
    if (c.seat != null && !SAFE_TEXT.test(c.seat)) err(where, 'seat 含不允许的字符');
    if (c.calamity != null && !['drought', 'flood'].includes(c.calamity)) err(where, 'calamity 只能是 drought（旱）、flood（水）或不写');
    const rec = { ...structuredClone(L), id, name: c.name, faction: factionRef(where, c.faction ?? null), officers: [], roads: [],
      lon: c.lon, lat: c.lat, seat: c.seat ?? c.name, tier: c.tier, like, mod: true };
    delete rec.bank; delete rec.fort;
    if (c.style && c.style !== 'han') rec.style = c.style;
    for (const k of Object.keys(CITY_NUM)) if (c[k] !== undefined) rec[k] = c[k];
    for (const k of ['facilities', 'rice_rate', 'shop', 'field_shop', 'ai_shop']) if (c[k] !== undefined) rec[k] = structuredClone(c[k]);
    if (c.facilities !== undefined && (!isObj(c.facilities) || Object.keys(c.facilities).some((k) => !['weapons', 'school', 'market', 'hospital'].includes(k) || typeof c.facilities[k] !== 'boolean'))) err(where, 'facilities 应为 { weapons, school, market, hospital } 的 true/false');
    if (c.rice_rate !== undefined && !(Array.isArray(c.rice_rate) && c.rice_rate.length === 2 && c.rice_rate.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))) err(where, 'rice_rate 应为 [卖价, 买价]，0–255');
    for (const k of ['shop', 'field_shop', 'ai_shop']) if (c[k] !== undefined && !(Array.isArray(c[k]) && c[k].every((v) => Number.isInteger(v) && v >= 0 && v < base.equipment.length))) err(where, `${k} 应为装备编号的数组`);
    d.cities.push(rec);
    d.maps.push(structuredClone(base.maps[like]));
    d.deploy[String(id)] = structuredClone(base.deploy[String(like)]);
    if (base.villages[String(like)]) d.villages[String(id)] = structuredClone(base.villages[String(like)]);
    if (c.calamity) d.rules[`${c.calamity}_cities`].push(id); // the original tables keep their cities and order
    if (c.search != null) {
      if (!Array.isArray(c.search)) err(where, 'search 应为武将的数组');
      else d.search_table[String(id)] = c.search.map((v) => officerRef(`${where} search`, v)).filter((v) => v != null);
    }
  });

  // Edits of the original cities' opening state.
  editCities.forEach((c, i) => {
    const where = `cities.json edit[${i}]${c?.city != null ? ` ${c.city}` : ''}`;
    if (!isObj(c)) return err(where, '应为 JSON 对象');
    if ('lon' in c || 'lat' in c) err(where, '不能改原版城的经纬度：沙盘上画好的道路不会跟着动（设计 §5.5）');
    unknown(where, c, CITY_EDIT); nums(where, c, CITY_NUM);
    const id = c.city == null ? (err(where, 'city 必填'), null) : cityRef(where, c.city, true);
    if (id == null) return;
    const rec = d.cities[id];
    for (const k of Object.keys(CITY_NUM)) if (c[k] !== undefined) rec[k] = c[k];
    if ('faction' in c) rec.faction = factionRef(where, c.faction);
  });

  // Roads, both ways; a pack only adds.
  roads.forEach((r, i) => {
    const where = `roads.json [${i}]`;
    if (!Array.isArray(r) || r.length !== 2) return err(where, '每条路写成 ["城A", "城B"]');
    const [a, b] = r.map((v) => cityRef(where, v));
    if (a == null || b == null) return;
    if (a === b) return err(where, '道路两端是同一座城');
    if (d.cities[a].roads.includes(b)) return err(where, `${d.cities[a].name}–${d.cities[b].name} 已经有路`);
    d.cities[a].roads.push(b); d.cities[b].roads.push(a);
  });

  // Officers onto their cities: the new initial ones, then any original moved by an edit.
  newOfficers.forEach((o, i) => {
    const rec = d.officers[nOfficers + i];
    if (!o || rec.city == null) return;
    if (rec.appear === 'initial') d.cities[rec.city].officers.push(rec.id);
    else if (rec.appear === 'search_city') (d.search_table[String(rec.city)] ??= []).includes(rec.id) || d.search_table[String(rec.city)].push(rec.id);
  });
  editOfficers.forEach((o, i) => {
    const where = `officers.json edit[${i}]${o?.officer != null ? ` ${o.officer}` : ''}`;
    if (!isObj(o)) return err(where, '应为 JSON 对象');
    unknown(where, o, OFFICER_EDIT); nums(where, o, OFFICER_NUM);
    const id = o.officer == null ? (err(where, 'officer 必填'), null) : officerRef(where, o.officer, true);
    if (id == null) return;
    const rec = d.officers[id];
    if (o.army != null && !['平', '山', '水'].includes(o.army)) err(where, 'army 只能是 平、山、水');
    for (const k of [...Object.keys(OFFICER_NUM), 'army']) if (o[k] !== undefined && k !== 'year') rec[k] = o[k];
    checkTroops(where, o.troops); if (isObj(o.troops)) rec.troops = { ...o.troops };
    if (o.year !== undefined) err(where, '不能改原版武将的登场年：按年份写死的原版事件会对不上');
    if (o.city !== undefined) {
      if (rec.appear !== 'initial') return err(where, '只能挪开局就在城中的武将（appear 为 initial）');
      const to = cityRef(where, o.city); if (to == null) return;
      const from = d.cities.find((c) => c.officers.includes(id));
      if (from) from.officers = from.officers.filter((x) => x !== id);
      d.cities[to].officers.push(id); rec.city = to;
    }
  });
  // ---------- Faction lists and rulers ----------
  const crowned = new Set(base.factions.map((x) => x.ruler));
  addFactions.slice(0, MAX_MOD_FACTIONS).forEach((f, i) => {
    const id = FIRST_MOD_FACTION + i, where = `factions.json [${i}]${f?.name ? ` ${f.name}` : ''}`;
    if (!isObj(f)) return;
    const ruler = f.ruler == null ? (err(where, 'ruler 必填'), null) : officerRef(where, f.ruler);
    if (ruler != null) {
      const o = d.officers[ruler], c = d.cities.find((x) => x.officers.includes(ruler));
      if (crowned.has(ruler)) err(where, `${o.name} 已是别的势力的君主`);
      crowned.add(ruler);
      if (!c) err(where, `君主 ${o.name} 开局不在任何城中（应为 appear initial 并写 city）`);
      else if (c.faction !== id) err(where, `君主 ${o.name} 所在的${c.name}不属于本势力（在 cities.json 里给它写 faction）`);
      else c.officers = [ruler, ...c.officers.filter((x) => x !== ruler)]; // a ruler leads his own city (game.js crown)
      d.factions[id].ruler = ruler;
    }
    const ids = (k) => (f[k] == null ? [] : Array.isArray(f[k]) ? f[k].map((v) => officerRef(`${where} ${k}`, v)).filter((v) => v != null) : (err(where, `${k} 应为武将的数组`), []));
    d.succession[String(id)] = ids('succession');
    d.join_table[String(id)] = [...ids('join'), ...newOfficers.flatMap((o, k) => (o && d.officers[nOfficers + k].appear === 'automatic_faction' && d.officers[nOfficers + k].faction === id ? [nOfficers + k] : []))];
    const prefer = ids('prefer'); if (prefer.length) d.rules.search_preference[String(id)] = prefer;
  });
  // A join officer of an original faction goes onto the end of its queue.
  newOfficers.forEach((o, k) => {
    const rec = d.officers[nOfficers + k];
    if (o && rec.appear === 'automatic_faction' && rec.faction != null && rec.faction < nFactions) (d.join_table[String(rec.faction)] ??= []).push(rec.id);
  });

  // ---------- Whole-map checks ----------
  for (const c of d.cities) {
    if (c.officers.length > 10) err(`城 ${c.name}`, `开局武将 ${c.officers.length} 人，上限 10`);
    if (c.faction !== NONE && !c.officers.length) err(`城 ${c.name}`, '有归属却没有武将：开局就会变成无主城');
    if (c.faction === NONE && c.officers.length) err(`城 ${c.name}`, '有武将却没有归属：给它写 faction');
  }
  for (const f of d.factions) if (!f.placeholder && f.ruler != null && !d.cities.some((c) => c.faction === f.id)) err(`势力 ${f.name}`, '开局没有城');
  for (const f of base.factions) {
    const c = d.cities.find((x) => x.officers.includes(f.ruler));
    if (!c || c.faction !== f.id) err(`原版势力 ${f.name}`, `君主不在本势力的城中（他所在的城被改了归属或被挪走）`);
  }
  // Every city reachable by road from every other (an island no army can reach would never fall).
  const seen = new Set([0]), stack = [0];
  while (stack.length) for (const n of d.cities[stack.pop()].roads) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  const cut = d.cities.filter((c) => !seen.has(c.id)).map((c) => c.name);
  if (cut.length) err('roads.json', `这些城与其余的城没有道路相连：${cut.join('、')}`);
  // Seats apart: a new seat at least MIN_CITY_GAP board units from every other (x is 0.9 per degree of longitude).
  for (const c of d.cities.slice(nCities)) for (const o of d.cities) {
    if (o.id >= c.id || typeof c.lon !== 'number' || typeof o.lon !== 'number') continue;
    const gap = Math.hypot((c.lon - o.lon) * 0.9, c.lat - o.lat);
    if (gap < MIN_CITY_GAP) err(`城 ${c.name}`, `离${o.name}太近（${gap.toFixed(2)}，至少 ${MIN_CITY_GAP}）`);
  }
  if (errors.length) return { data: null, errors };
  d.pack = { id: meta.id, name: meta.name, version: meta.version, author: meta.author ?? '', regions: [...regions], boards: boards.map(([n]) => n) };
  return { data: d, errors };
}

// The 主 of a version: records of a pack load while it stays the same (design §5.3).
export const major = (v) => Number(String(v ?? '').split('.')[0]);

// Browser loading: mods/<id>/pack.json and the optional files. fetchJson(url) → parsed or undefined when the file is missing.
export async function readPack(id, fetchJson) {
  if (!SLUG.test(id)) return { errors: [`数据包名「${id}」不对：只能用小写字母、数字和 -`] };
  const dir = `mods/${id}/`, files = {};
  let meta;
  try { meta = await fetchJson(`${dir}pack.json`); } catch { return { errors: [`mods/${id}/pack.json 不是合法的 JSON`] }; }
  if (meta === undefined) return { errors: [`找不到 mods/${id}/pack.json`] };
  const errors = [];
  for (const f of PACK_FILES) {
    try { files[f.replace('.json', '')] = await fetchJson(dir + f); } catch { errors.push(`mods/${id}/${f} 不是合法的 JSON`); }
  }
  if (meta?.id !== id) errors.push(`pack.json 的 id「${meta?.id}」与文件夹名「${id}」不一致`);
  return { pack: { meta, ...files }, errors };
}
