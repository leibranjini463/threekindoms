// War set-up and write-back shared by field battles (player involved) and AI-vs-AI auto battles.
// 出阵 (5.9 §7), 战后 (6.10 §3–6), AI 自动战 (6.5 第五/六批).
import { markFought } from './warlike.js';
import { data, rng, NONE, DEAD, SERVING, RONIN, roads, officerCity, capturedLoyalty, recruitLoyalty, addExp, citiesOf, kill, isRuler } from './game.js';

// Remove the expedition from its source city and empty the target into the defender's war chest.
export function setupWar(g, { from, to, ids, commander, gold, rice }) {
  const src = g.cities[from], dst = g.cities[to];
  const attacker = src.faction, defender = dst.faction;
  src.officers = src.officers.filter((x) => !ids.includes(x));
  src.gold -= gold; src.rice -= rice;
  if (!src.officers.length) src.faction = NONE;
  const att = [commander, ...ids.filter((x) => x !== commander)];
  if (att.includes(g.factions[attacker].ruler)) g.factions[attacker].city = to;
  const war = {
    city: to, from, attacker, defender, day: 1,
    att: { ids: att, gold, rice }, def: { ids: [...dst.officers], gold: dst.gold, rice: dst.rice },
  };
  dst.officers = []; dst.gold = 0; dst.rice = 0;
  return war;
}

// Empty-city capture (`$B670`): no battle.
export function occupyEmpty(g, { from, to, ids, gold, rice }) {
  const src = g.cities[from], dst = g.cities[to], f = src.faction;
  src.officers = src.officers.filter((x) => !ids.includes(x)); src.gold -= gold; src.rice -= rice;
  if (!src.officers.length) src.faction = NONE;
  dst.officers.push(...ids); dst.gold = Math.min(9999, dst.gold + gold); dst.rice = Math.min(9999, dst.rice + rice); dst.faction = f;
  if (ids.includes(g.factions[f].ruler)) g.factions[f].city = to;
}

// Retreat destination (ABA3): own neighbour with <10 officers (fewest, first on tie), else last neutral neighbour.
export function retreatCity(g, battleCity, f, prefer = null) {
  if (prefer != null && g.cities[prefer].faction === f && g.cities[prefer].officers.length < 10) return prefer;
  let best = null;
  for (const n of roads(battleCity)) {
    const c = g.cities[n];
    if (c.faction === f && c.officers.length < 10 && (best == null || c.officers.length < g.cities[best].officers.length)) best = n;
  }
  if (best != null) return best;
  let neutral = null;
  for (const n of roads(battleCity)) if (g.cities[n].faction === NONE) neutral = n;
  return neutral;
}
function place(g, f, ids, cid) {
  const c = g.cities[cid];
  if (c.faction === NONE) c.faction = f;
  for (const id of ids) { if (c.officers.length >= 10) return ids.slice(ids.indexOf(id)); c.officers.push(id); }
  return [];
}
function toRoninAt(g, id, cid) { const o = g.officers[id]; o.status = RONIN; o.loc = cid; }

// The losing side's settlement queue (`$D0E1`): its survivors still on the field, then its own prisoners.
export function loserQueue(res) {
  const held = res.loser === 'att' ? res.captured.byAtt : res.captured.byDef;
  return [...res.survivors[res.loser].filter((id) => !res.retreated.some((x) => x.id === id)), ...held];
}
// The winning side's queue: its survivors still on the field, then the prisoners it took.
export function winnerQueue(res) {
  const win = res.loser === 'att' ? 'def' : 'att', held = win === 'att' ? res.captured.byAtt : res.captured.byDef;
  return [...res.survivors[win].filter((id) => !res.retreated.some((x) => x.id === id)), ...held];
}
// Where a human loser may send them (`$BB84`): roads from the battle city to own or ownerless cities.
// Full cities are listed too; the menu refuses them (10 per city).
export const retreatOptions = (g, war, f) => roads(war.city).filter((n) => n !== war.city && (g.cities[n].faction === f || g.cities[n].faction === NONE));

// Field battle result. survivors: { att:[ids], def:[ids] }, dead:[ids], captured:{byAtt:[ids], byDef:[ids]},
// retreated: [{id, city}], loser:'att'|'def', chests: {att:{gold,rice}, def:{gold,rice}}, field: true from Field.result().
// Writes res.adrift (see the losers' retreat below).
export function resolveWar(g, war, res) {
  const r = rng(g), city = g.cities[war.city];
  const winF = res.loser === 'def' ? war.attacker : war.defender, loseF = res.loser === 'def' ? war.defender : war.attacker;
  const winSide = res.loser === 'def' ? 'att' : 'def', loseSide = res.loser;
  for (const id of res.dead) if (g.officers[id].status !== DEAD) g.officers[id].status = DEAD;
  // Occupation losses (`$BF0A`, only when the defender loses).
  if (res.loser === 'def' && !res.skipCut) {
    const k = war.day < 6 ? 1 : war.day < 11 ? 2 : war.day < 16 ? 3 : war.day < 21 ? 4 : 6;
    const cut = (v, kk) => Math.floor(((v * (10 - kk)) % 65536) / 10);
    city.pop = cut(city.pop, 1 + r(2)); city.land = cut(city.land, k); city.industry = cut(city.industry, k); city.gov = cut(city.gov, k);
  }
  if (res.loser === 'def') city.faction = war.attacker;
  // Prisoners join their captors with recomputed loyalty. Each side's settlement queue ends with its own prisoner list (`$BDCD`/`$D0E1`): the loser's
  // prisoners retreat with the loser rather than being dropped.
  const held = (side) => (side === 'att' ? res.captured.byAtt : res.captured.byDef);
  for (const id of [...held('att'), ...held('def')]) { const o = g.officers[id]; o.loyalty = capturedLoyalty(o.loyalty); o.status = SERVING; }
  const prisoners = held(winSide);
  const left = new Map(res.retreated.map((x) => [x.id, x.city])); // units that walked off the field
  // A human side's settlement menu (`$CE9E`, `$D20D`) chose each officer's city or 下野. Those choices are
  // honoured before anything is placed automatically, so the other side's overflow cannot take the
  // ownerless city or the room the player was shown; a choice that still does not fit falls through.
  // The winners always keep at least one officer in the battle city they hold.
  const chosen = (ids, f, garrison) => {
    if (!res.placement) return ids;
    const keep = garrison && city.officers.length === 0 && !ids.some((id) => res.placement[id] === war.city) ? ids[0] : null;
    return ids.filter((id) => {
      const p = res.placement[id];
      if (id === keep || p == null) return true;
      if (p === 'ronin' && !isRuler(g, id)) { const n = roads(war.city)[r(8)]; toRoninAt(g, id, n ?? war.city); return false; }
      const c = g.cities[p];
      if (c && (c.faction === f || c.faction === NONE) && c.officers.length < 10) { place(g, f, [id], p); return false; }
      return true;
    });
  };
  // Units that walked off the field already reached their city during the war (`$BC2A`).
  // 武将不战死 keeps a ruler from being lost in war, an overflow included: one who walked off is placed first, so
  // later retreats into the same city cannot push him out, and if it is still full he goes to any own city with room.
  const walked = g.noWarDeath ? [...res.retreated].sort((a, b) => isRuler(g, b.id) - isRuler(g, a.id)) : res.retreated;
  for (const { id, city: dest } of walked) {
    const f = res.survivors[winSide].includes(id) ? winF : loseF;
    let over = g.cities[dest].faction === f || g.cities[dest].faction === NONE ? place(g, f, [id], dest) : [id];
    if (over.length && g.noWarDeath && isRuler(g, id)) { const c = citiesOf(g, f).find((c) => c.officers.length < 10); if (c) over = place(g, f, [id], c.id); }
    if (over.length) toRoninAt(g, id, dest);
  }
  let queue = [...res.survivors[winSide].filter((id) => !left.has(id)), ...prisoners], back = loserQueue(res);
  if (res.placementSide === winSide) queue = chosen(queue, winF, true);
  else if (res.placementSide === loseSide) back = chosen(back, loseF, false);
  // Winners (and their prisoners) fill the battle city, then neighbouring own / ownerless cities.
  queue = place(g, winF, queue, war.city);
  while (queue.length) {
    const dest = retreatCity(g, war.city, winF);
    if (dest == null) { for (const id of queue) toRoninAt(g, id, war.city); break; }
    queue = place(g, winF, queue, dest);
  }
  // Losers retreat (attackers prefer their source city).
  const loseChest = res.chests[loseSide], adrift = [];
  for (let first = true; back.length; first = false) {
    const dest = retreatCity(g, war.city, loseF, loseSide === 'att' ? war.from : null);
    if (dest == null) {
      // With nowhere at all to go the queue is lost: officers 下野, the ruler with them dies (checkFactions). The AI
      // settlement (`bank8:$BCE8..$BD56`) keeps the ruler's ID in zero page $02, but the first officer it sends 下野
      // overwrites $02 with battle city × 8 (`$BD3E`), so a ruler behind him is sent 下野 too and survives
      // (devblog #590/#611, 冰). Kept for a field battle the AI side lost on its last city, as in the controlled
      // ROM replays; a ruler with a city left, a human side and AI-vs-AI wars stay as before.
      // docs/原版非太守君主下野兼容_交接_2026-11-21.md
      const lord = g.factions[loseF].ruler;
      if (first && res.field && g.factions[loseF].ai && back.indexOf(lord) > 0 && !citiesOf(g, loseF).length) adrift.push(lord);
      for (const id of back) toRoninAt(g, id, war.city);
      break;
    }
    back = place(g, loseF, back, dest);
  }
  res.adrift = adrift;
  // Gold/rice (`$C027`): winner chest to the battle city. The loser's chest follows its commander
  // (`$052C`) only if he got out still serving the loser; dead, captured or ronin → battle city.
  const add = (c, ch) => { c.gold = Math.min(9999, c.gold + ch.gold); c.rice = Math.min(9999, c.rice + ch.rice); };
  add(city, res.chests[winSide]);
  const cmd = war[loseSide].ids[0], cmdCity = cmd != null && g.officers[cmd].status === SERVING ? officerCity(g, cmd) : null;
  add(cmdCity && cmdCity.faction === loseF && cmdCity.id !== war.city ? cmdCity : city, loseChest);
  // Ruler city bookkeeping and governor swap.
  for (const f of [war.attacker, war.defender]) {
    const ruler = g.factions[f]?.ruler; if (ruler == null) continue;
    const c = officerCity(g, ruler);
    // Only in a city of his own: a ruler taken prisoner (edited loyalty, D49) neither heads his captor's list nor
    // moves his house there; checkFactions then gives the house an heir or lets it fall.
    if (c && c.faction === f) { g.factions[f].city = c.id; c.officers = [ruler, ...c.officers.filter((x) => x !== ruler)]; }
  }
  if (g.warlike) markFought(g, war);
  // adrift: rulers this settlement sent 下野 alive; the report and checkFactions(g, io, res.adrift) read it.
  return { winner: winF, loser: loseF, adrift };
}

// AI-vs-AI automatic battle (`10:ACD5`, `A91F`, `A9CC`, `AF9C`, `ABA3`, `11:CD68`).
// The fight itself (`A91F`, `A9CC`, `AF9C`): strength, days, troop loss, deaths, experience and the losers' loyalty
// draws (captured = draw100 ≥ loyalty). Settlement is the caller's: autoBattle for real cities, ahuinan.js for 王莆.
export function fight(g, war) {
  const r = rng(g), O = (id) => g.officers[id];
  const strength = (ids) => Math.floor(ids.reduce((a, id) => a + O(id).war, 0) / 10) + Math.floor(ids.reduce((a, id) => a + O(id).soldiers, 0) / 100) + 10 * (O(ids[0])?.exp >> 12 || 0);
  const sa = strength(war.att.ids), sd = war.def.ids.length ? strength(war.def.ids) : 0;
  const q = Math.floor((100 * sa) / Math.max(1, sa + sd));
  const days = 30 - Math.abs(Math.floor(q / 2) - 25);
  const proj = (ids) => Math.floor((Math.floor(ids.reduce((a, id) => a + O(id).soldiers, 0) / 100) * (days * 4)) / 10);
  const attWins = !war.def.ids.length || war.def.rice < proj(war.def.ids) || r(100) < q;
  war.day = days;
  // Troop loss by current HP, deaths, experience.
  const loss = { att: 0, def: 0 }, deadN = { att: 0, def: 0 }, dead = [];
  for (const side of ['att', 'def']) for (const id of war[side].ids) { const o = O(id), left = Math.floor((o.soldiers * o.hp) / 100); loss[side] += o.soldiers - left; o.soldiers = left; }
  const surv = { att: [...war.att.ids], def: [...war.def.ids] };
  for (const side of ['att', 'def']) {
    const n = surv[side].length;
    if (n < 5) continue;
    for (let k = 0; k < Math.floor(n / 4); k++) {
      let pick = null;
      for (const id of surv[side]) if (O(id).loyalty !== 100 && (pick == null || O(id).war + O(id).int < O(pick).war + O(pick).int)) pick = id;
      if (pick == null) break;
      surv[side] = surv[side].filter((x) => x !== pick); dead.push(pick); deadN[side]++;
    }
  }
  for (const side of ['att', 'def']) {
    const other = side === 'att' ? 'def' : 'att', n0 = war[side].ids.length;
    for (const id of surv[side]) addExp(g, id, Math.floor(Math.floor((loss[other] + 120 * deadN[other]) / Math.max(1, n0)) / 2));
  }
  // Prisoners: loser officers with draw100 ≥ loyalty are captured.
  const loseSide = attWins ? 'def' : 'att', winSide = attWins ? 'att' : 'def';
  const captured = { byAtt: [], byDef: [] };
  // 武将不战死: those who would have fallen are the other side's prisoners instead (rulers, loyalty 100, never fall here).
  if (g.noWarDeath) for (const id of dead.splice(0)) (war.att.ids.includes(id) ? captured.byDef : captured.byAtt).push(id);
  surv[loseSide] = surv[loseSide].filter((id) => {
    const l = O(id).loyalty;
    if (l === 100) { if (!attWins) r(100); return true; }
    if (r(100) >= l) { (winSide === 'att' ? captured.byAtt : captured.byDef).push(id); return false; }
    return true;
  });
  return { r, attWins, days, proj, surv, dead, captured, loseSide, winSide };
}

export function autoBattle(g, war) {
  const { r, attWins, days, proj, surv, dead, captured, loseSide } = fight(g, war);
  // Rice: projected use, then defender rice/gold shrink by the byte-indexed table.
  const shrink = (v) => v - Math.floor((v * (v < 500 ? 50 : v < 1000 ? 0 : v < 3000 ? 60 : v < 5000 ? 0 : 70)) / 100);
  const chests = {
    att: { gold: war.att.gold, rice: Math.max(0, war.att.rice - (attWins ? proj(surv.att) : 0)) },
    def: { gold: shrink(war.def.gold), rice: shrink(Math.max(0, war.def.rice - proj(surv.def))) },
  };
  // City damage when the attacker wins (11:CD68) replaces the field-battle occupation formula.
  if (attWins) {
    const c = g.cities[war.city], pct = days < 5 ? 10 : days < 10 ? 20 : days < 15 ? 30 : days < 20 ? 40 : 60;
    c.pop -= Math.floor((c.pop * (10 + r(10))) / 100);
    for (const k of ['land', 'industry', 'gov']) c[k] -= Math.floor((c[k] * pct) / 100);
  }
  const res = resolveWar(g, war, { loser: loseSide, survivors: surv, dead, captured, retreated: [], chests, skipCut: true });
  for (const id of dead) kill(g, id);
  return { ...res, attWins, days, dead, captured: [...captured.byAtt, ...captured.byDef] };
}

// Officers that can still be placed anywhere for a faction (used for fall checks).
export const factionHasCities = (g, f) => citiesOf(g, f).length > 0;
