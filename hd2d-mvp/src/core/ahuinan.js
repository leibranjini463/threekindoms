// 阿会喃 bug (原版漏洞 mode, off unless a record sets g.bugs.ahuinan in the save editor). research/ahuinan-bug-evidence.md:
// when A240 finds no enemy neighbour that is not allied, the original does not give up the attack. Source and target
// stay FF, and city FF is save RAM $7FE0, whose roster reads as ten of officer 0 (阿会喃). So the faction marches
// 阿会喃s against 阿会喃s at a city that is not on the map (王莆 in the Chinese release), and the losers who walk away
// are placed by ABA3 through a road list read past the table: 幽州, 辽东, 青州, 并州.
//
// The original's copies all share officer 0's one record. Here each copy that leaves 王莆 is an officer of its own,
// made from 阿会喃's record as it stands at the march (so raising 阿会喃 in the save editor raises every later copy).
// AI and player defenders alike auto-resolve; the original opens the war map when 王莆's owner is human.
import { data, maxHp, NONE, SERVING, RONIN, DEAD, citiesOf } from './game.js';
import { fight } from './warcore.js';

export const PHANTOM = 0xff;
export const PHANTOM_ROADS = [1, 0, 3, 2]; // bank16 $9D72 + (FF×8 & FF): table bytes past city 29, then city 0's roads, up to FF
export const PHANTOM_NAME = '王莆';
export const phantomOf = (g) => (g.phantom ??= { owner: 0 }); // $7FE0 low 3 bits: 0 in every save the research read

// One copy of 阿会喃 at a fresh id; registered in the static table so names and portraits resolve.
function spawn(g) {
  const D = data(), id = g.officers.length, base = g.officers[0];
  D.officers[id] ??= { ...D.officers[0], id, clone: true };
  g.officers.push({ ...base, id, hp: base.hp || maxHp(base), soldiers: 1000, status: SERVING, loc: null });
  return id;
}

// ABA3 for faction f: an own city among 王莆's "roads" with room (fewest officers, first on ties), else the last
// ownerless one, which becomes f's; else 下野 at one of them. A faction with no ruler left can hold nothing.
function settle(g, r, f, id) {
  const alive = f !== NONE && g.factions[f]?.ruler != null;
  let best = null, empty = null;
  for (const cid of PHANTOM_ROADS) {
    const c = g.cities[cid];
    if (alive && c.faction === f && c.officers.length < 10 && (best == null || c.officers.length < g.cities[best].officers.length)) best = cid;
    if (c.faction === NONE) empty = cid;
  }
  const dest = best ?? (alive ? empty : null);
  if (dest != null) { const c = g.cities[dest]; if (c.faction === NONE) c.faction = f; c.officers.push(id); return dest; }
  const o = g.officers[id]; o.status = RONIN; o.loc = PHANTOM_ROADS[r(PHANTOM_ROADS.length)];
  return null;
}

// A208 with no target: A45C/A6C9 supplies, A79C/A831 the two sides from 王莆's ten, the auto battle, then AA80
// (attacker won: 王莆 changes hands, defenders who stay loyal leave for its old owner) or AB10 (attacker lost:
// attackers who stay loyal go home to the marching faction). Units captured, dead or on the winning side stay in
// 王莆 and are gone. Returns false when the supplies cannot be raised (domestic work instead), null when the
// command budget ran out, else the outcome.
export function phantomWar(g, f, r, { cover, outCount, spend }) {
  const ph = phantomOf(g), owner = ph.owner;
  const n = outCount(g, 10, r);
  const src = { gold: 0, rice: 0 };
  const rice = n * 120, gold = Math.max(0, n * 100 + (r(256) >= 128 ? 1 : -1) * r(100));
  for (const [k, amt] of [['gold', gold], ['rice', rice]]) { const t = cover(g, f, src, k, amt, spend); if (t !== true) return t === null ? null : false; }
  // Ten temporary copies fight; only those who come out become officers (renumbered to stay contiguous).
  const first = g.officers.length, temp = Array.from({ length: 10 }, () => spawn(g));
  const war = { city: PHANTOM, from: PHANTOM, attacker: f, defender: owner, day: 1, phantom: true,
    att: { ids: temp.slice(0, n), gold, rice }, def: { ids: temp.slice(n), gold: 0, rice: 0 } };
  const { attWins, days, surv, captured, loseSide } = fight(g, war);
  const held = new Set([...captured.byAtt, ...captured.byDef]);
  const out = surv[loseSide].filter((id) => !held.has(id) && g.officers[id].status !== DEAD);
  const goTo = attWins ? owner : f;
  const keep = out.map((id) => ({ ...g.officers[id] }));
  g.officers.length = first;
  const D = data(); // entries past the record stay registered (newGame skips them); each is reset as its id is reused
  g.clones ??= [];
  const placed = keep.map((rec, i) => {
    const id = first + i;
    g.officers.push({ ...rec, id, status: SERVING, loc: null, debut: g.year });
    D.officers[id] = { ...D.officers[0], id, clone: true, year: g.year }; g.clones.push(id);
    return { id, city: settle(g, r, goTo, id) };
  });
  if (attWins) ph.owner = f;
  return { attWins, days, attacker: f, defender: owner, att: n, def: 10 - n, to: goTo, placed };
}
