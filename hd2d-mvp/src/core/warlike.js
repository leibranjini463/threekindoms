// 电脑好战 2.0 (g.warlike: an option, off by default, absent from older records; not in the ROM). Off, no line here
// runs and the AI is the original's (tools/sim_warlike.mjs digest). On, per difficulty (TIERS; g.level 0/1/2 =
// 初级/中级/上级): more searching and ronin recruiting, monthly conscription and refilling, domestic work picked by
// need (pickDomestic, no draw), the march on an enemy city with its own thresholds, target choice and strength
// check, and for 上级 extra resources (command points, free refill after battle, development multiplier, gold and
// rice income, recruits' loyalty up to 95). Draws are added or replaced where these choices stand in for the
// original's. Measured numbers: README 「电脑好战」, docs/电脑好战增强方案_2026-11-18.md §6.1. The 阿会喃 march
// (core/ahuinan.js) keeps the original count.

import { conscriptNeed, conscript, conscriptMax, assignTroops, citiesOf, roads, NONE, SERVING, factionOf, troopsOf } from './game.js';
import { TIERS, tier, aiIncome } from './warliketiers.js';
export * from './warliketiers.js';


// ---- The march on an enemy city (§4.3; not in the ROM; draws no random numbers) ----

// A19C main dispatch: the attack weight w[0] (from weights(), a data row, never written) gains the tier's attackWeight.
// The sum is still masked to 16 by aiTurn (D4AD), so the extra weight is taken from the later branches. Off: w itself.
export function adjustWeights(g, w) {
  const t = tier(g);
  return t ? [w[0] + t.attackWeight, ...w.slice(1)] : w;
}

// Replaces A240's "fewest officers" when the tier's target is not 'original'. Candidates are those of A240: cities on a
// road from an own city, owned by another non-allied faction (never neutral). 'fewestThenTroops' (中级, 上级) = fewest
// officers as A240, then the fewest soldiers among the defenders; the reserve does not count (it does not fight).
// A later different candidate wins a tie, as in A240. The source is the own city on a road to the target holding the
// most officers, the later one on ties (A240's source rule). Walks g.cities, so a pack's longer map works. null = none.
export function pickTarget(g, f) {
  const ally = g.factions[f].alliance;
  const score = (c) => [c.officers.length, troopsOf(g, c)];
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  let target = null, best = null;
  for (const c of citiesOf(g, f)) for (const n of roads(c.id)) {
    const e = g.cities[n];
    if (e.faction === NONE || e.faction === f || ally[e.faction] > 0) continue;
    const s = score(e);
    if (target == null || less(s, best) || (n !== target && !less(best, s))) { target = n; best = s; }
  }
  if (target == null) return null;
  let source = null;
  for (const c of citiesOf(g, f)) if (roads(c.id).includes(target) && (source == null || c.officers.length >= g.cities[source].officers.length)) source = c.id;
  return { target, source };
}

// Strength check between A303 and A481, on the march as it will leave: A481 fills every officer of the source to 1000
// or drops the attack, so n marchers bring n × 1000. Against the target's defenders' soldiers × the tier's strength
// (TIERS strength: 0.5 中级, 1 上级); reserves count on neither side.
export function strongEnough(g, target, n) {
  return n * 1000 >= troopsOf(g, target) * tier(g).strength;
}

// Gold a city keeps for one march of all its officers and their fill (gold income comes only in month 3), on the frontier
// only: a city with a road to another faction's city (ai.js isFront; neutral cities do not count). A rear city keeps 100,
// the floor of A55C/A60C, which already pull a march's gold and rice from the richest other own city above 100.
const isFront = (g, f, c) => roads(c.id).some((n) => ![f, NONE].includes(g.cities[n].faction));
export const marchReserve = (g, c) => (isFront(g, c.faction, c) ? c.officers.length * 100 + 100 : 100);

// ---- Start of an AI turn: conscription, refilling, free refill after a battle (not in the ROM; draws no random numbers) ----

// One city's conscription: a share of the shortfall (conscriptNeed: cap of 1000 per officer minus led soldiers and reserve),
// rounded down to 100, paid at 20 gold per 100 men from the gold above the tier's floor or the march reserve, whichever
// is higher (spending down to goldFloor left no gold to march: attacks dropped at A481 and the supplies), never past
// conscriptMax (reserve 10000, gold). true = conscripted, false = nothing to do, null = the turn's points ran out (2 points per conscription).
export function conscriptCity(g, c, t, spend) {
  const need = conscriptNeed(g, c).need;
  const share = Math.floor(need * t.conscriptShare / 100);
  const floor = Math.max(t.goldFloor, marchReserve(g, c));
  const hundreds = Math.min(share, Math.floor((c.gold - floor) / 20), conscriptMax(c));
  if (!(hundreds >= 1)) return false;
  if (!conscript(g, c.id, hundreds).ok) return false;
  return spend(2) ? true : null;
}

// Officers who fought last month (g.warlikeFought: plain id array so it survives JSON saves; absent on old records) are
// topped up to 1000 on 上级 without touching gold or reserve. Other factions' ids wait for their own turn; ids that no
// longer serve (dead, ...) are dropped so the list cannot grow for ever.
export function warlikePrelude(g, f, spend) {
  const t = tier(g); if (!t) return;
  const fought = g.warlikeFought = (g.warlikeFought ?? []).filter((id) => g.officers[id]?.status === SERVING);
  for (const c of citiesOf(g, f)) {
    if (t.freeRefill) {
      for (const id of c.officers) {
        const i = fought.indexOf(id);
        if (i < 0) continue;
        if (g.officers[id].soldiers < 1000) g.officers[id].soldiers = 1000;
        fought.splice(i, 1);
      }
    }
    if (conscriptCity(g, c, t, spend) === null) return;
    // Reserve goes to the officers with the fewest soldiers first, +100 per assignTroops call (the player's own 分兵 command).
    const order = c.officers.filter((id) => g.officers[id].soldiers < 1000).sort((a, b) => g.officers[a].soldiers - g.officers[b].soldiers);
    for (const id of order.slice(0, t.refillPerMonth)) {
      // assignTroops hands the remainder (soldiers % 100) to the reserve first; at a full reserve it gives it back and the +100 step
      // fails, so an officer at 901-999 may not move: stop when a call makes no progress.
      for (let s = -1; g.officers[id].soldiers < 1000 && c.reserve > 0 && g.officers[id].soldiers !== s;) { s = g.officers[id].soldiers; assignTroops(g, c.id, id, 100); }
      if (c.reserve <= 0) break;
    }
  }
}

// After a battle both sides' officers are remembered; the owner's next prelude refills them (上级). Only officers now in
// an AI faction's city count: the human player's never get free troops. The mark is taken at the battle, so one who defects later keeps it (another AI faction's prelude may refill him, once).
export function markFought(g, war) {
  const s = new Set(g.warlikeFought ?? []);
  for (const id of [...war.att.ids, ...war.def.ids]) if (g.factions[factionOf(g, id)]?.ai) s.add(id);
  g.warlikeFought = [...s];
}

// ---- BEC7 domestic work by need (§4.4; not in the ROM; draws no random numbers) ----

// Replaces BEC7's r(80) threshold and sub-draw: the first need met in this order, run by ai.js DO with its original cost
// draws and effects. equipPrice is the price of the item ai.js equipPick would buy first (null: no weapons shop, no
// upgrade), passed in because this module may not import ai.js (ai.js imports warlike.js). A job is chosen when
// the city can pay its largest cost; no march reserve is kept (2026-11-18, the user chose development first: with one,
// the AI hardly developed; marchReserve stays the floor of conscription only). null = nothing qualifies: the city does nothing and
// no points are spent. goldFloor is not read here; it stays the floor of warlikePrelude's conscription.
export function pickDomestic(g, f, c, equipPrice) {
  const t = tier(g), off = c.officers.map((id) => g.officers[id]);
  const can = (max) => c.gold >= max;
  if (off.some((o) => o.loyalty < t.rewardBelow) && can(29)) return 'reward'; // 20 + r(10)
  if (equipPrice != null && can(equipPrice)) return 'equip'; // later purchases of the same visit: equip's own checks
  if (c.disaster < t.floodBelow && can(19)) return 'flood'; // 10 + r(10)
  // 30 + r(30) gold and rice; rice also for one march of the whole city (officers × 120)
  if (c.gov < t.charityBelow && can(59) && c.rice >= 59 && c.rice >= off.length * 120) return 'charity';
  if (!g.noStudy && off.some((o) => o.int >= 50 && o.int < 80) && can(29)) return 'study'; // 20 + r(10)
  if (!can(23)) return null; // development: 10 + r(14)
  // Income is pop × (field ÷ A + B): population is the multiplier, so it comes first while low. Then the original
  // month rule (3–7 land, else industry); a field at its 999 cap gives way to population, and population at 9999
  // to the other field.
  if (c.pop < t.popFloor) return 'pop';
  const field = g.month >= 3 && g.month <= 7 ? 'land' : 'industry', other = field === 'land' ? 'industry' : 'land';
  if (c[field] < 999) return field;
  if (c.pop < 9999) return 'pop';
  return c[other] < 999 ? other : null;
}
