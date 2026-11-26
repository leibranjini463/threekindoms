// War map rules (6.2, 6.7, 6.8, 6.10) without rendering. One Field per war; the renderer drives it.
// Ported: deployment blocks and AI role sub-lists, movement costs (600-troop split), shared daily
// mobility, rice per day, 30-day limit, castle capture, commander loss, retreat thresholds, field
// hospital/rice shop, AI roles 0–4 with their decision order. Strategies (计略) are not ported yet.
import { data, rng, NONE, DEAD, roads, addExp, takeLevelUps, equipBlock, wearEquip, spared, SPARED_HP, maxHp, recruitLoyalty } from './game.js';
import { Tactical } from './tactical.js';
import { roll100, realChance } from './origrng.js';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // 上下左右
export const W = 32, H = 19, FOREST = 0, SAND = 1, PLAIN = 2, RIVER = 3, MOUNT = 4, CASTLE = 5;
export const ATTACK_COST = 2, MAX_DAY = 30;
// The terrains by the manual's names (M p34), in the order of the constants above.
export const TERRAIN_NAME = ['林', '沙地', '平地', '河', '山', '城'];

// 16 计略 (6.3): name, player cost, AI cost (AI decides with the player table, then pays its own).
export const STRATS = [
  ['火计', 6, 6], ['陷阱', 5, 5], ['虚兵', 4, 4], ['要击', 6, 6], ['乱水', 7, 7], ['火箭', 8, 8], ['伪击转杀', 8, 8], ['共杀', 8, 12],
  ['笼络', 10, 10], ['落石', 9, 9], ['连环', 9, 9], ['十面埋伏', 10, 15], ['水攻', 10, 14], ['连弩', 8, 15], ['劫火', 12, 25], ['奇门遁甲', 10, 20],
].map(([name, cost, ai], id) => ({ id, name, cost, ai }));
// What each 计略 does and where it can be cast (`legal` below, `cast` for the effect), for the 计略 menu's tips
// (feedback R10, 2026-11-02): `does` is the effect, `where` the condition on the target or on the caster.
export const STRAT_INFO = [
  { does: '火攻敌军，损兵（看智力、等级）', where: '目标在森林或平地' },
  { does: '敌将受伤，体力减少（看武力、智力）', where: '目标在森林或山地' },
  { does: '敌军数日不能移动（我为攻方3日，守方2日）', where: '目标在森林或山地' },
  { does: '伏击敌军，损兵（看武力）', where: '目标在森林或山地' },
  { does: '水淹敌军，损兵（看智力）', where: '目标在河上' },
  { does: '烧毁敌军携带的米', where: '目标是敌总大将' },
  { does: '火攻守城的敌军，损兵（看智力、等级）', where: '目标在城中，与我相邻' },
  { does: '火攻目标及其身边的友军，各自损兵', where: '目标在森林或山地，身边有其友军' },
  { does: '劝敌将倒戈投向我军（看对方忠诚，71以上不会成功）', where: '目标不在城中' },
  { does: '落石砸向敌军：敌将受伤并损兵', where: '自己在山地或城中，目标与我相邻且不在城中' },
  { does: '锁住河上相连的敌军，数日不能移动', where: '目标在河上，身边有同在河上的友军' },
  { does: '在林中设下伏兵（耗兵100），5日内敌军走进两格内的森林时遭伏击', where: '自己在森林，兵数100以上，我军尚无伏兵' },
  { does: '水攻河上相连的敌军，各自损兵', where: '目标在河上，身边有同在河上的友军' },
  { does: '以连弩射击相邻敌军，大量损兵', where: '自己在城中，目标与我相邻' },
  { does: '火烧相连的敌军（城中的除外），各自大量损兵', where: '目标不在城中，身边有不在城中的友军' },
  { does: '困敌于石阵：数日不能移动，诸葛亮在场时每日折兵', where: '目标不在河上和城中' },
];
const SPECIAL = [ // unlock by level for named strategists (6.3 §1)
  [[161, 99, 167, 22, 196, 219, 234, 107, 206, 235, 183], [[4, 12]]],
  [[24, 55, 112, 213, 110, 103], [[4, 12], [5, 14]]],
  [[197, 86, 93], [[4, 12], [5, 14], [6, 15]]],
  [[109], [[4, 12], [5, 14], [6, 15], [7, 16]]],
];
// AI special-strategy users (file 0x10C75, 21 strategists; later entries unlock more).
const AI_SPECIAL = [161, 99, 167, 22, 196, 219, 234, 107, 206, 235, 24, 55, 112, 213, 110, 103, 197, 86, 93, 109, 183];
export function stratCount(id, o) {
  for (const [ids, steps] of SPECIAL) if (ids.includes(id)) { let n = 0; for (const [lv, k] of steps) if (o.level >= lv) n = k; if (n) return n; }
  return o.int < 40 ? 2 : o.int < 60 ? 4 : o.int < 75 ? 6 : o.int < 85 ? 8 : 10;
}
const ARMY_IDX = { 平: 0, 山: 1, 水: 2 };

// Role counts a/b/c/d for team sizes 2..10 (6.8 §2), by side and faction group.
const ROLE_TABLE = {
  def: [['1000 1100 2100 2110 3110 3210 3211 3221 3222', [0, 3, 6]], ['0010 0110 0120 1120 1121 2121 2131 2132 2133', [1, 5]], ['0100 0110 1110 1210 1220 2220 2221 2222 3231', [2, 4]]],
  att: [['1000 2000 2100 2101 3101 3111 3211 4211 4212', [0, 3, 6]], ['1000 1100 1110 2110 2111 2211 2221 3221 3321', [1, 5]], ['1000 1100 2100 2110 2111 2211 3211 3311 3312', [2, 4]]],
};
const SUBLIST = { def: [1, 4, 6, 10], att: [1, 6, 11, 14] };

export class Field {
  constructor(g, war, humanSide) {
    const D = data();
    this.g = g; this.war = war; this.human = humanSide; // 'att' | 'def' | null
    takeLevelUps(g); // level-ups from fights the player did not see (AI wars, a test 白兵) are not told in this one
    this.map = D.maps[war.city];
    this.r = rng(g);
    const dep = D.deploy[war.city][war.from] || Object.values(D.deploy[war.city])[0];
    this.dep = dep;
    this.villages = D.villages[war.city] || [];
    this.units = [];
    for (const side of ['def', 'att']) {
      const ids = war[side].ids, block = side === 'def' ? dep.defender : dep.attacker;
      const roles = this.assignRoles(side, ids);
      const used = new Set();
      const take = (i) => { while (i < block.length && used.has(block[i] + '')) i++; if (i < block.length) { used.add(block[i] + ''); return block[i]; } return block.find((p) => !used.has(p + '') && used.add(p + '')); };
      const next = [...SUBLIST[side]];
      ids.forEach((id, k) => {
        const role = roles[k];
        const pos = k === 0 ? take(0) : take(next[role - 1]++);
        this.units.push({ id, side, x: pos[0], y: pos[1], role, home: role, commander: k === 0, gone: false });
      });
    }
    this.pool = { att: 0, def: 0 };
    this.day = 1; this.turn = 'att'; this.over = null; this.log = [];
    this.recover();
  }
  // 战场中断 (src/core/suspend.js): the whole field as plain data, taken on the player's own idle turn (nothing pending:
  // no 十面埋伏 still to tell, no 白兵 open). The set ambushes name their general by his place in `units`.
  snapshot() {
    const ambush = this.ambush && Object.fromEntries(Object.entries(this.ambush).map(([s, a]) => [s, a && { ...a, u: this.units.indexOf(a.u) }]));
    return structuredClone({ human: this.human, units: this.units, pool: this.pool, day: this.day, turn: this.turn, over: this.over, log: this.log,
      commanderRetreat: this.commanderRetreat ?? null, ambush: ambush ?? null });
  }
  // The field again from a snapshot, on the game and war it was taken with (both restored from the same record). Nothing is
  // drawn and no role is reassigned, so the battle goes on exactly where it stood. `resumed` tells the war view to skip 布阵.
  static restore(g, war, snap) {
    const D = data(), f = Object.create(Field.prototype), s = structuredClone(snap);
    f.g = g; f.war = war; f.human = s.human;
    f.map = D.maps[war.city]; f.r = rng(g);
    f.dep = D.deploy[war.city][war.from] || Object.values(D.deploy[war.city])[0];
    f.villages = D.villages[war.city] || [];
    Object.assign(f, { units: s.units, pool: s.pool, day: s.day, turn: s.turn, over: s.over, log: s.log ?? [], lastAmbush: null, resumed: true });
    if (s.commanderRetreat) f.commanderRetreat = s.commanderRetreat;
    if (s.ambush) f.ambush = Object.fromEntries(Object.entries(s.ambush).map(([k, a]) => [k, a && { ...a, u: f.units[a.u] }]));
    return f;
  }
  O(id) { return this.g.officers[id]; }
  get alive() { return this.units.filter((u) => !u.gone); }
  side(s) { return this.alive.filter((u) => u.side === s); }
  terr(x, y) { return this.map[y][x]; }
  inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
  unitAt(x, y) { return this.alive.find((u) => u.x === x && u.y === y); }
  castle() { return this.dep.defender[0]; }
  faction(s) { return s === 'att' ? this.war.attacker : this.war.defender; }
  chest(s) { return this.war[s]; }

  assignRoles(side, ids) {
    const n = ids.length;
    if (n < 2) return [0];
    // A pack's house (core/pack.js) takes the row of the original house it names as `like`.
    const f = data().factions[this.faction(side)]?.like ?? this.faction(side), row = ROLE_TABLE[side].find(([, fs]) => fs.includes(f))[0].split(' ')[n - 2];
    const counts = [...row].map(Number);
    // sort non-commanders by war descending (bubble with swap on ≥, kept as an approximation)
    const rest = ids.slice(1).sort((a, b) => this.O(b).war - this.O(a).war);
    ids.splice(1, ids.length - 1, ...rest);
    const roles = [0];
    counts.forEach((c, i) => { for (let k = 0; k < c; k++) roles.push(i + 1); });
    while (roles.length < n) roles.push(4);
    return roles;
  }

  troops(s) { return this.side(s).reduce((a, u) => a + this.O(u.id).soldiers, 0); }
  recover() {
    const D = data();
    for (const s of ['att', 'def']) {
      const q = Math.min(9, Math.floor(this.troops(s) / 1000));
      this.pool[s] = Math.min(this.pool[s] + D.rules.mobility_recover[q], D.rules.mobility_cap[q]);
    }
  }
  cost(u, x, y) {
    const o = this.O(u.id), D = data();
    const t = this.villages.some((v) => v.x === x && v.y === y) ? PLAIN : this.terr(x, y);
    return D.rules.move_cost[o.soldiers >= 600 ? 'large' : 'small'][o.army][t];
  }
  reach(u, budget = this.pool[u.side]) {
    const dist = new Map([[u.x + ',' + u.y, 0]]), prev = new Map(), open = u.stop || u.qimen ? [] : [[0, u.x, u.y]];
    while (open.length) {
      open.sort((a, b) => a[0] - b[0]);
      const [d, x, y] = open.shift();
      if (d > dist.get(x + ',' + y)) continue;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (!this.inside(nx, ny) || this.unitAt(nx, ny)) continue;
        if (u.side === 'def' && false) continue;
        const nd = d + this.cost(u, nx, ny);
        if (nd > budget || nd >= (dist.get(k) ?? Infinity)) continue;
        dist.set(k, nd); prev.set(k, x + ',' + y); open.push([nd, nx, ny]);
      }
    }
    return { dist, prev };
  }
  path(reach, x, y) { const p = []; for (let k = x + ',' + y; reach.prev.has(k); k = reach.prev.get(k)) p.unshift(k.split(',').map(Number)); return p; }
  adjacentEnemies(u) { return DIRS.map(([dx, dy]) => this.unitAt(u.x + dx, u.y + dy)).filter((e) => e && e.side !== u.side); }
  // --- Read-only forecasts for the war map's display (第 3 期, docs/战场3D重构与操作优化方案_2026-11-13.md §7). They change nothing
  // and roll nothing: reach() and cost() are pure, and a held general is read through a copy.
  // The pool a side will hold when it next acts, seen from the other side's turn: the defender acts later the same day with what
  // he has now; the attacker acts after the day turns, when both pools recover and are capped (recover(), endTurn()).
  poolWhenNext(side) {
    if (side === this.turn || side === 'def') return this.pool[side];
    const D = data(), q = Math.min(9, Math.floor(this.troops(side) / 1000));
    return Math.min(this.pool[side] + D.rules.mobility_recover[q], D.rules.mobility_cap[q]);
  }
  // The cells a side's generals could strike when it next acts: every cell beside one a general can walk to with the pool
  // less the cost of an attack (his own cell counts: he strikes without moving). The pool is shared, so this is how far any one of
  // them could reach alone, not all at once. A general held by 虚兵 / 连环 / 奇门 stays where he is unless the hold runs out with
  // the day that turns before his side acts; held, he is still counted as striking the cells beside him.
  // only: one general of that side. Returns a Set of 'x,y'.
  threat(side, only = null) {
    const out = new Set(), budget = this.poolWhenNext(side) - ATTACK_COST;
    if (budget < 0) return out;
    const dayTurns = side !== this.turn && side === 'att', kong = this.kongmingOn();
    for (const u of this.alive) {
      if (u.side !== side || (only && u !== only)) continue;
      const stop = Math.max(0, (u.stop || 0) - (dayTurns ? 1 : 0)), qimen = Math.max(0, (u.qimen || 0) - (dayTurns && kong ? 1 : 0));
      const from = stop || qimen ? [`${u.x},${u.y}`] : [...this.reach({ ...u, stop: 0, qimen: 0 }, budget).dist.keys()];
      for (const k of from) { const [x, y] = k.split(',').map(Number); for (const [dx, dy] of DIRS) if (this.inside(x + dx, y + dy)) out.add(`${x + dx},${y + dy}`); }
    }
    return out;
  }
  village(u) { return this.villages.find((v) => v.x === u.x && v.y === u.y); }
  // What a cell is to the player: a village (moved and judged as 平地) or its terrain's name.
  ground(x, y) { const v = this.villages.find((q) => q.x === x && q.y === y); return v ? `村落（${v.kind}）` : TERRAIN_NAME[this.terr(x, y)]; }

  // Move along a precomputed path; returns false if the move ends the war (castle).
  move(u, x, y, spent) {
    this.pool[u.side] -= spent; u.x = x; u.y = y;
    this.lastAmbush = this.ambushCheck(u);
    const [cx, cy] = this.castle();
    if (u.side === 'att' && x === cx && y === cy) this.end('def', 'castle');
  }

  // A duel involving the human side comes back pending; the renderer runs it and calls settle().
  // 白兵 (core/tactical.js). With the human side involved it comes back pending: the renderer runs the
  // battle (player commands one side) and calls settle(); otherwise it is fought out by the AI.
  attack(a, d) {
    this.pool[a.side] -= ATTACK_COST;
    const humanIn = this.human && (a.side === this.human || d.side === this.human);
    const battle = new Tactical(this.g, a.id, d.id, this.terr(d.x, d.y), this.r, { human: humanIn ? (a.side === this.human ? 'a' : 'd') : null });
    const res = { battle };
    res.settle = () => { Object.assign(res, battle.result()); delete res.pending; this.applySkirmish(a, d, res); return res; };
    res.auto = () => { battle.runAuto(); return res.settle(); };
    if (humanIn) res.pending = battle; else res.auto();
    return res;
  }
  applySkirmish(a, d, res) {
    for (const [u, info] of [[a, res.a], [d, res.d]]) {
      const o = this.O(u.id);
      o.soldiers = info.soldiers; o.hp = info.hp;
      // A general slain in the 白兵 or its 单挑 pays the one who faced him floor((武力 + 智力) / 2), whatever experience he had
      // (bank13 $C766 → $C799 → bank14 $A009 → bank15 $D8B0 → $D7FB, which halves its input; fanxibaby@devblog). One taken
      // alive pays nothing. tests/killexp.test.mjs.
      if (info.fate === 'dead') { o.status = DEAD; u.gone = true; u.fate = 'dead'; addExp(this.g, (u === a ? d : a).id, Math.floor((o.war + o.int) / 2)); }
      if (info.fate === 'captured') { u.gone = true; u.fate = 'captured'; u.capturedBy = u.side === 'att' ? 'def' : 'att'; }
      if (info.fate === 'defected') this.defect(u, u.side === 'att' ? 'def' : 'att');
    }
    this.checkCommanders();
  }
  // A change of side on the war map (`$C766` codes 4..7: 单挑说得 结果 4, 计略 倒戈): he stays where he stands with the men he
  // has, under the other banner, and his loyalty is recomputed at once by the new ruler's 人德 (`11:$CF3F`). A commander
  // who goes over is lost to his side (checkCommanders); he does not command the new one.
  defect(t, side) {
    t.side = side; t.role = 4; t.commander = false;
    const o = this.O(t.id); o.loyalty = recruitLoyalty(this.O(this.g.factions[this.faction(side)].ruler).virtue, o.loyalty);
  }
  // 武将不战死 keeps a ruler from being lost to an overflow after the war: an AI ruler 退却s only to a city with room,
  // the AI's own 退却 city first, else any own or empty neighbour.
  roomTargets(u) {
    const g = this.g, f = this.faction(u.side);
    const ok = (c) => (g.cities[c].faction === f || g.cities[c].faction === NONE) && this.headcount(c) < 10;
    return [...new Set([...this.retreatTargets(u), ...roads(this.war.city)])].filter(ok);
  }
  // A city's officers as the war stands: those who retreated to it have reached it (`$BC2A`), though they join its
  // list only when the war is settled. The room check and the 退却 map both go by this.
  headcount(c) { return this.g.cities[c].officers.length + this.units.filter((x) => x.fate === 'retreat' && x.to === c).length; }
  checkCommanders() {
    if (this.over) return;
    const lost = (s) => !this.units.some((u) => u.side === s && u.commander && !u.gone);
    if (lost('def')) this.end('def', 'commander');
    else if (lost('att')) this.end('att', 'commander');
  }

  // Retreat destinations. The player's 退却 menu (`bank12:$BB84`, M p37/48) offers every city on a road from
  // the battlefield that is the side's own or empty, attacker or defender alike — an attacker need not go
  // home. The AI (6.8 §4) is narrower: an attacker always heads for its source city; a defender takes its
  // own neighbour with room, else the last neutral one. The original moves a retreating unit into its city
  // at once (`$BC2A`), so units that already left for a city during this war count against its 10-officer room.
  // AI (`AF0D`): the attacker's source city is not checked for room; an overflow is settled after the war.
  retreatTargets(u) {
    const g = this.g, f = this.faction(u.side);
    const room = (c) => this.headcount(c) < 10;
    const ok = (c) => (g.cities[c].faction === f || g.cities[c].faction === NONE) && room(c);
    if (u.side === this.human) return roads(this.war.city).filter(ok);
    if (u.side === 'att') return [this.war.from];
    const near = roads(this.war.city), own = near.find((c) => g.cities[c].faction === f && room(c));
    if (own != null) return [own];
    const empty = near.filter((c) => g.cities[c].faction === NONE);
    return empty.length ? [empty[empty.length - 1]] : [];
  }
  retreat(u, city) {
    u.gone = true; u.fate = 'retreat'; u.to = city;
    const c = this.g.cities[city];
    if (c.faction === NONE) c.faction = this.faction(u.side); // empty city is taken at once (6.10 §1)
    if (u.commander) { this.commanderRetreat = { side: u.side, city }; this.end(u.side, 'retreat'); }
    else this.checkCommanders();
  }

  // Field services (6.7 §5–6). Hospital: 50 gold, +35..45 HP up to the template. Rice shop: buy q rice.
  hospital(u) {
    const ch = this.chest(u.side), o = this.O(u.id);
    if (ch.gold < 50) return '军资金不足';
    ch.gold -= 50; const before = o.hp; o.hp = Math.min(maxHp(o), o.hp + 35 + this.r(11));
    return `体力 +${o.hp - before}`;
  }
  // Field weapon shop (村落 slot 1, `$9BA4`): the battle city's own field stock (`$C525`, not the city
  // shop), paid from the side's war gold; 狼牙枪/圣者之衣 need 武力/人德 90 on this path.
  shopStock() { return (data().cities[this.war.city].field_shop || []).map((e) => data().equipment[e]); }
  buyEquip(u, eq) {
    if (this.village(u)?.kind !== '武器店' || !(data().cities[this.war.city].field_shop || []).includes(eq)) return { ok: false, msg: '此处不卖' };
    const block = equipBlock(this.g, u.id, eq, { field: true }), e = data().equipment[eq], ch = this.chest(u.side);
    if (block) return { ok: false, msg: `${e.name}：${block}` };
    if (ch.gold < e.price) return { ok: false, msg: '军资金不足' };
    ch.gold -= e.price;
    return { ok: true, msg: wearEquip(this.g, u.id, eq) };
  }
  buyRice(u, q) {
    const ch = this.chest(u.side), b = data().cities[this.war.city].rice_rate[1];
    if (!b) return '无法买米';
    q = Math.min(q, Math.floor((ch.gold * b) / 100), 9999 - ch.rice);
    if (q <= 0) return '军资金不足';
    ch.gold -= Math.floor((q * 100) / b); ch.rice += q;
    return `买米 ${q}`;
  }
  // 卖米 at the same shop (bank9 `$C0BB` state 2 → `$C2C0`, settled at `$C2F2`): q rice leaves the side's 军粮 and
  // floor(q × s / 100) gold joins its 军资金, capped at 9999 (research/war-maps-movement-evidence.md §5). s is the city's
  // selling rate, the first byte of its pair; buying uses the second.
  sellRice(u, q) {
    const ch = this.chest(u.side), s = data().cities[this.war.city].rice_rate[0];
    if (!s || this.village(u)?.kind !== '米店') return '无法卖米';
    q = Math.min(q, ch.rice);
    if (!(q > 0)) return '军粮不足';
    ch.rice -= q; ch.gold = Math.min(9999, ch.gold + Math.floor((q * s) / 100));
    return `卖米 ${q}`;
  }

  // ---------- 计略 ----------
  dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  adjacent(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1; }
  enemyNeighbours(t, pred = () => true) { return DIRS.map(([dx, dy]) => this.unitAt(t.x + dx, t.y + dy)).filter((e) => e && e.side === t.side && pred(e)); }
  strategies(u) { return STRATS.slice(0, stratCount(u.id, this.O(u.id))); }
  // Terrain/adjacency gate `$AD80` plus distance <6; target null for 十面埋伏.
  legal(u, id, t) {
    const T = (v) => this.terr(v.x, v.y);
    if (id === 11) return T(u) === FOREST && this.O(u.id).soldiers >= 100 && !this.ambush?.[u.side];
    if (!t || t.gone || t.side === u.side || this.dist(u, t) >= 6) return false;
    switch (id) {
      case 0: return T(t) === FOREST || T(t) === PLAIN;
      case 1: case 2: case 3: return T(t) === FOREST || T(t) === MOUNT;
      case 4: return T(t) === RIVER;
      case 5: return t.commander;
      case 6: return T(t) === CASTLE && this.adjacent(u, t);
      case 7: return (T(t) === FOREST || T(t) === MOUNT) && this.enemyNeighbours(t).length > 0;
      case 8: return T(t) !== CASTLE;
      case 9: return (T(u) === MOUNT || T(u) === CASTLE) && this.adjacent(u, t) && T(t) !== CASTLE;
      case 10: case 12: return T(t) === RIVER && this.enemyNeighbours(t, (e) => T(e) === RIVER).length > 0;
      case 13: return T(u) === CASTLE && this.adjacent(u, t);
      case 14: return T(t) !== CASTLE && this.enemyNeighbours(t, (e) => T(e) !== CASTLE).length > 0;
      case 15: return T(t) !== RIVER && T(t) !== CASTLE;
    }
    return false;
  }
  // Why this unit cannot cast this 计略 now, in words, or null when he can: the mobility, a condition on his own
  // place (十面埋伏, 落石, 连弩), else no foe within reach that meets the 计略's condition.
  whyNot(u, id) {
    const S = STRATS[id], T = this.terr(u.x, u.y), o = this.O(u.id);
    if (this.pool[u.side] < S.cost) return `机动力不足（需 ${S.cost}，剩 ${this.pool[u.side]}）`;
    if (id === 11) return T !== FOREST ? '需自己位于森林' : o.soldiers < 100 ? '兵数不足100' : this.ambush?.[u.side] ? '我军已设下伏兵' : this.legal(u, 11) ? null : '现在无法施展';
    if (id === 9 && T !== MOUNT && T !== CASTLE) return '需自己位于山地或城中';
    if (id === 13 && T !== CASTLE) return '需自己位于城中';
    if (this.side(u.side === 'att' ? 'def' : 'att').some((e) => this.legal(u, id, e))) return null;
    return `6格内没有符合条件的敌军（${STRAT_INFO[id].where.replace(/^自己在[^，]*，/, '')}）`;
  }
  hitChance(u, t) {
    const d = this.dist(u, t); if (d >= 6) return 0;
    const a = this.O(u.id), b = this.O(t.id), D = u.side === this.human || !this.human ? 10 : [5, 10, 20][this.g.level];
    let s = ([15, 10, 5, 0, -5, -10][d] + Math.max(a.int - b.int, 0) + 2 * Math.max(a.level - b.level, 0) + D) & 255;
    if (s & 128) s = 0;
    return Math.min(95, Math.max(5, s));
  }
  lureChance(u, t) {
    const a = this.O(u.id), b = this.O(t.id);
    if (this.dist(u, t) >= 6 || b.loyalty >= 71) return 0;
    return (b.loyalty <= 30 ? 60 : b.loyalty <= 50 ? 30 : 10) + Math.floor(((a.int + a.virtue) & 255) / 10) + 2 * Math.max(a.level - b.level, 0);
  }
  // What the player is told: the chance the cast really has. hitChance / lureChance are the numbers the roll is
  // compared with; the original's roll (core/origrng.js) comes under them more often than that many times in 100.
  odds(u, id, t) { return Math.round(realChance(id === 8 ? this.lureChance(u, t) : this.hitChance(u, t))); }
  // Connected enemy component from t (right,left,down,up), castles excluded (`$B8A1`).
  component(t) {
    const out = [t], seen = new Set([t]);
    for (let i = 0; i < out.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.unitAt(out[i].x + dx, out[i].y + dy);
      if (n && n.side === t.side && !seen.has(n) && this.terr(n.x, n.y) !== CASTLE) { seen.add(n); out.push(n); }
    }
    return out;
  }
  // Whether the side to move may cast this 计略 now: one the unit knows, the mobility it costs still in the pool,
  // a legal target. The original admits a 计略 by its cost before it runs; a menu opened earlier does not count.
  canCast(u, id, t) {
    return !!u && !u.gone && !this.over && u.side === this.turn && this.pool[u.side] >= STRATS[id].cost
      && this.strategies(u).some((s) => s.id === id) && (id === 11 ? this.legal(u, 11) : this.legal(u, id, t));
  }
  cast(u, id, t, ai = false) {
    const S = STRATS[id], r = this.r, a = this.O(u.id), U = (n) => r(n), lines = [], hits = [];
    if (!ai && !this.canCast(u, id, t)) return { ok: false, hit: false, name: S.name, lines: [this.pool[u.side] < S.cost ? '机动力不足' : `无法施展${S.name}`], hits };
    this.pool[u.side] = Math.max(0, this.pool[u.side] - (ai ? S.ai : S.cost));
    // Each general hurt pays at once: `$B68B` adds his loss to the cast's running total and hands that total to `$D7FB`, which
    // halves it into the caster's experience and checks his level, one level a call. So a cast on several may raise him more than
    // once, and the effects read his level anew for every target (`$B070`, `$B1E3`: record byte 0B), as L() does.
    let acc = 0;
    const L = () => a.level - 1;
    const loss = (v, n) => { const o = this.O(v.id), d = Math.min(o.soldiers, Math.max(0, n)); o.soldiers -= d; acc += d; addExp(this.g, u.id, Math.floor(acc / 2)); hits.push({ u: v, soldiers: -d }); lines.push(`${nm(v)} 损兵 ${d}`); };
    const hp = (v, n) => { const o = this.O(v.id), d = Math.min(o.hp, Math.max(0, n)); o.hp -= d; hits.push({ u: v, hp: -d }); lines.push(`${nm(v)} 体力 −${d}`); if (o.hp <= 0) fall(v); };
    // 0 HP: slain, or under 武将不战死 taken by the caster's side at SPARED_HP (a ruler is slain all the same).
    const fall = (v) => {
      const o = this.O(v.id);
      if (!spared(this.g, v.id)) { o.status = DEAD; v.gone = true; v.fate = 'dead'; lines.push(`${nm(v)} 阵亡`); return; }
      o.hp = SPARED_HP; v.gone = true; v.fate = 'captured'; v.capturedBy = u.side; lines.push(`${nm(v)} 被擒`);
    };
    const nm = (v) => data().officers[v.id].name;
    const fire = (v) => loss(v, ((Math.floor((a.int * (9 + U(5))) / 10) + 10 * L()) & 255) + 30);
    if (id === 11) {
      a.soldiers -= 100; (this.ambush ||= {})[u.side] = { u, x: u.x, y: u.y, days: 5 };
      return { ok: true, hit: true, name: S.name, lines: [`${nm(u)} 在林中设下伏兵`], hits };
    }
    const p = id === 8 ? this.lureChance(u, t) : this.hitChance(u, t);
    if (roll100(r) >= p) return { ok: true, hit: false, name: S.name, lines: [`${S.name}失败`], hits };
    switch (id) {
      case 0: case 6: fire(t); break;
      case 1: hp(t, Math.floor((L() + Math.floor(((a.war + a.int) & 255) / 10)) * (5 + U(3)) / 10)); break;
      case 2: t.stop = u.side === 'def' ? 2 : 3; t.stopBy = '虚兵'; lines.push(`${nm(t)} 中了虚兵之计，无法移动`); break;
      case 3: loss(t, Math.floor((a.war * (14 + U(7))) / 10)); break;
      case 4: loss(t, Math.floor((a.int * (20 + U(7))) / 10) + L() + 7); break;
      case 5: { const ch = this.chest(t.side), d = Math.min(ch.rice, Math.floor((ch.rice * (10 + U(5))) / 100) + Math.floor(a.int / 5)); ch.rice -= d; hits.push({ u: t, rice: -d }); lines.push(`烧毁敌军米 ${d}`); break; }
      case 7: fire(t); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const n = this.unitAt(t.x + dx, t.y + dy); if (n && n.side === t.side) fire(n); } break;
      case 8: {
        this.defect(t, u.side);
        lines.push(`${nm(t)} 倒戈投向我军`); break;
      }
      case 9: hp(t, Math.floor((L() + Math.floor(((a.war + a.int) & 255) / 10)) * (5 + U(3)) / 10)); if (!t.gone) loss(t, Math.floor((a.war * (14 + U(7))) / 10)); break;
      case 10: for (const v of this.component(t)) if (this.terr(v.x, v.y) === RIVER) { v.stop = 3 + U(2) + (u.side === 'att' ? 1 : 0); v.stopBy = '连环'; lines.push(`${nm(v)} 被连环锁住`); } break;
      case 12: for (const v of this.component(t)) if (this.terr(v.x, v.y) === RIVER) loss(v, Math.floor((a.int * (20 + U(7))) / 10) + L() + 7); break;
      case 13: loss(t, 150 + U(200) + Math.floor(((a.war + a.int) & 255) / 2)); break;
      case 14: for (const v of this.component(t)) loss(v, Math.floor((a.int * (30 + U(6))) / 10)); break;
      case 15: t.qimen = 5 + (r(256) & 3) + (u.side === 'att' ? 1 : 0); lines.push(`${nm(t)} 陷入奇门遁甲`); break;
    }
    this.checkCommanders();
    return { ok: true, hit: true, name: S.name, lines, hits };
  }
  // 十面埋伏 trigger after a move ends (`$B933`): radius 2 around the ambush, target on forest.
  ambushCheck(mover) {
    const foe = mover.side === 'att' ? 'def' : 'att', am = this.ambush?.[foe];
    if (!am || am.u.gone || this.terr(mover.x, mover.y) !== FOREST || this.dist(mover, am) > 2) return null;
    const a = this.O(am.u.id), raw = (((a.level - 1) << 4) | (ARMY_IDX[a.army] << 2)) & 255;
    const x = (raw * 8) & 255, b = x + raw, offset = (b + raw + (b >= 256 ? 1 : 0)) & 255;
    this.r(101);
    const d = Math.min(this.O(mover.id).soldiers, Math.floor((a.int * (30 + this.r(11))) / 10) + offset);
    this.O(mover.id).soldiers -= d; this.ambush[foe] = null; addExp(this.g, am.u.id, Math.floor(d / 2));
    return { by: am.u, damage: d };
  }

  // End of a side's turn (待机). After the defender: recover, day+1, ≥31 attacker loses, then rice.
  endTurn() {
    if (this.over) return;
    if (this.turn === 'att') { this.turn = 'def'; return; }
    this.recover(); this.day++; this.turn = 'att';
    if (this.day > MAX_DAY) return this.end('att', 'timeout');
    for (const s of ['att', 'def']) {
      const ch = this.chest(s), use = Math.floor((this.troops(s) * 4) / 1000);
      ch.rice = Math.max(0, ch.rice - use);
      if (ch.rice <= 0) return this.end(s, 'rice'); // a zero balance runs out even when the day's use is 0
    }
    // Day tick (bank9 $CE40): 虚兵/连环 counters; 奇门 only while 诸葛亮 (109) is on the field, whichever side he is on.
    // $CE94 adds the low byte of each target's soldiers left into a 16-bit sum; $D7FB halves it into 诸葛亮's experience.
    const kongming = this.kongmingOn(), qimen = [];
    let sum = 0;
    for (const u of this.alive) {
      if (u.stop) u.stop--;
      if (u.qimen && kongming) {
        u.qimen--; let v; do v = this.r(256); while (v >= 71);
        const o = this.O(u.id), d = Math.min(o.soldiers, 80 + v); o.soldiers -= d;
        qimen.push({ u, loss: d }); sum += o.soldiers & 255;
      }
    }
    if (qimen.length) addExp(this.g, 109, Math.floor(sum / 2));
    for (const s of ['att', 'def']) { const am = this.ambush?.[s]; if (am && --am.days <= 0) this.ambush[s] = null; }
    return { qimen };
  }
  kongmingOn() { return this.alive.some((u) => u.id === 109); }
  end(loser, why) { if (!this.over) this.over = { loser, why }; }

  // Build the write-back record for warcore.resolveWar.
  result() {
    const surv = { att: [], def: [] }, captured = { byAtt: [], byDef: [] }, dead = [], retreated = [];
    for (const u of this.units) {
      if (u.fate === 'dead') dead.push(u.id);
      else if (u.fate === 'captured') captured[u.capturedBy === 'att' ? 'byAtt' : 'byDef'].push(u.id);
      else if (u.fate === 'retreat') { retreated.push({ id: u.id, city: u.to }); surv[u.side].push(u.id); }
      else surv[u.side].push(u.id);
    }
    // The losing side's units still on the field are not captured here: the settlement queue (`bank8:$BDCD`)
    // takes them back with their own side, and only 白兵/单挑 produce prisoners (`$C766` code 3). The
    // draw100 ≥ loyalty lottery belongs to the auto battle only; using it here turned a day-31 timeout into
    // a mass capture of untouched officers.
    const loser = this.over.loser;
    this.war.day = this.day; // the occupation-loss tier in resolveWar reads the war's elapsed days
    return { loser, survivors: surv, dead, captured, retreated, chests: { att: this.war.att, def: this.war.def }, field: true };
  }

  // ---------- War AI (6.8) ----------
  // Returns a list of actions performed so the renderer can animate them: {type:'move',u,path,cost}|{type:'attack',a,d,res}|{type:'retreat',u,city}
  // Role adjustment before acting (6.8 §6). Missions: 5 buy rice, 6 seek the hospital; a finished
  // mission (7) restores the saved role. Gold is only reserved (100 per rice run, 50 per hospital run).
  adjustRoles(s) {
    const foe = s === 'att' ? 'def' : 'att', need = (x) => Math.floor((this.troops(x) * 4) / 1000), left = MAX_DAY - this.day;
    const units = this.side(s), mine = units.filter((u) => !u.commander), ch = this.chest(s);
    for (const u of units) if (u.mission?.done) { u.role = u.mission.home; u.mission = null; }
    const missions = (k) => units.filter((u) => u.mission?.kind === k);
    for (;;) {
      const reserve = missions('rice').length * 100 + missions('heal').length * 50;
      if (reserve <= ch.gold) break;
      const drop = missions('heal')[0] || missions('rice')[0];
      drop.role = drop.mission.home; drop.mission = null;
    }
    const full = (u) => !u.mission && u.role >= 1 && u.role <= 4;
    const myRice = ch.rice, foeRice = this.chest(foe).rice;
    if (myRice >= need(s) * left && foeRice < need(foe) * left && foeRice < need(foe) * 5) { for (const u of mine) if (full(u) && (u.role === 1 || u.role === 2)) u.role = 4; return; }
    const shop = this.villages.find((v) => v.kind === '米店'), hospital = this.villages.find((v) => v.kind === '病院');
    if (myRice < need(s) * left && shop && ch.gold >= 100) {
      if (!missions('rice').length) {
        const pick = [2, 4, 1, 3].map((role) => mine.find((u) => full(u) && u.role === role)).find(Boolean);
        if (pick) { pick.mission = { kind: 'rice', x: shop.x, y: shop.y, home: pick.role }; pick.role = 5; }
      }
    } else if (myRice < need(s) * 10) { for (const u of mine) if (full(u)) u.role = 1; return; }
    if (hospital && ch.gold >= 50 && missions('heal').length < 2) {
      for (const u of mine) {
        if (missions('heal').length >= 2) break;
        if (full(u) && this.O(u.id).hp < Math.floor(maxHp(this.O(u.id)) * 0.6)) { u.mission = { kind: 'heal', x: hospital.x, y: hospital.y, home: u.role }; u.role = 6; }
      }
    }
    if (this.troops(foe) < 1000 && this.troops(s) >= 5000) for (const u of mine) if (full(u)) u.role = 1;
  }
  // Mission arrival (6.8 §7): settled when the planned landing is within ±1 of the facility, before moving.
  missionAct(u) {
    const m = u.mission, ch = this.chest(u.side), r = this.r;
    const arrive = Math.abs(u.x - m.x) <= 1 && Math.abs(u.y - m.y) <= 1;
    if (!arrive) return this.approach(u, m) || null;
    const log = [];
    if (m.kind === 'rice') {
      const price = data().cities[this.war.city].rice_rate[1] || 1, need = Math.floor((this.troops(u.side) * 4) / 1000), left = MAX_DAY - this.day;
      const cap = Math.floor((ch.gold * 7) / 10), gap = (need * left - ch.rice) & 65535, cost = Math.floor((gap * 100) / price);
      if (ch.gold >= cost) { ch.gold -= cost; ch.rice += gap; log.push(`买米 ${gap}`); }
      else { ch.gold -= cap; const got = Math.floor((cap * price) / 100); ch.rice += got; log.push(`买米 ${got}`); }
    } else if (ch.gold >= 50) {
      ch.gold -= 50; let v; do v = r(256) & 15; while (v >= 11);
      const o = this.O(u.id), before = o.hp; o.hp = Math.min(maxHp(o), o.hp + 35 + v); log.push(`治疗 体力+${o.hp - before}`);
    }
    m.done = true; u.role = 7;
    return { type: 'mission', u, kind: m.kind, log };
  }
  // Dispatcher (`bank8:$A02D`, 6.8 §9): roles are adjusted once as the side's day begins (`$BE67`), then
  // the side's slots are scanned in slot order (commander first) and every non-wait decision is one action
  // (a move is a single cell), after which the scan continues from the next slot. A scan that reaches the
  // last slot starts over unless every unit in it waited, which ends the side's day. Units thus take turns
  // one action at a time, so the commander is not left with whatever mobility his officers did not walk off.
  *aiActions(s) {
    this.adjustRoles(s);
    const slots = this.units.filter((u) => u.side === s);
    for (let pass = 0; pass < 400; pass++) {
      let acted = false;
      for (const u of slots) {
        if (this.over || u.gone || u.side !== s) continue; // one won over mid-turn (说得, 倒戈) no longer acts for this side
        const act = this.aiDecide(u);
        if (!act) continue;
        acted = true; yield act;
        if (this.over) return;
      }
      if (!acted) return;
    }
  }
  aiDecide(u) {
    const o = this.O(u.id), s = u.side, foe = s === 'att' ? 'def' : 'att', isRuler = this.g.factions[this.faction(s)].ruler === u.id;
    // Retreat check (first matching identity only).
    let flee = false;
    if (isRuler) flee = o.soldiers < 301 && o.hp < 51;
    else if (u.commander) flee = (this.troops(s) < 1757 && this.troops(s) + 3499 < this.troops(foe)) || (o.soldiers < 101 && o.hp < 41);
    else flee = o.soldiers < 201 && o.hp < 100 && this.r(100) < 70;
    // Under 武将不战死 a ruler retreats only where there is room (roomTargets): the AI's own 退却 city is not
    // checked, and an overflow there turns him 下野 after the war.
    if (flee) { const [city] = isRuler && this.g.noWarDeath ? this.roomTargets(u) : this.retreatTargets(u); if (city != null) { this.retreat(u, city); return { type: 'retreat', u, city }; } }
    const way = u.giveWay; u.giveWay = null; // asked this day to step out of a walker's path (approach()); only an idle officer does
    if (u.mission && !u.mission.done) return this.missionAct(u);
    if (u.role === 7) return this.makeWay(u, way);
    const adj = this.adjacentEnemies(u);
    const commanderFoe = this.side(foe).find((e) => e.commander);
    const special = this.aiStrategy(u, true);
    if (special) return special;
    if (u.role === 0) {
      if (s === 'def') return this.aiStrategy(u, false);
      if (this.pool[s] >= ATTACK_COST && adj.length) return this.doAttack(u, adj);
      const n = this.aiStrategy(u, false); if (n) return n;
      if ((this.r(256) & 3) === 0) return null;
      return this.approach(u, commanderFoe);
    }
    if (u.role === 1) {
      const c = adj.find((e) => e.commander);
      if (c && this.pool[s] >= ATTACK_COST) return this.doAttack(u, [c]);
      if (s === 'def') return this.approach(u, commanderFoe);
      const [cx, cy] = this.castle(); return this.approach(u, { x: cx, y: cy });
    }
    if (this.pool[s] >= ATTACK_COST && adj.length) return this.doAttack(u, adj);
    const center = u.role === 3 ? this.side(s).find((x) => x.commander) || u : u, rad = u.role === 4 ? 3 : 2;
    const near = this.side(foe).filter((e) => Math.max(Math.abs(e.x - center.x), Math.abs(e.y - center.y)) <= rad)
      .map((e) => ({ e, sc: Math.abs(e.x - center.x) + Math.abs(e.y - center.y) + (Math.abs(e.y - center.y) === rad ? 1 : 0) }))
      .sort((a, b) => a.sc - b.sc)[0]?.e;
    if (near) {
      if (u.role === 3 && this.side(s).some((x) => !x.commander && x !== u && this.adjacent(x, near))) return this.aiStrategy(u, false);
      return this.approach(u, near);
    }
    if (u.role === 2) { if (s === 'def') return this.approach(u, commanderFoe); const [cx, cy] = this.castle(); return this.approach(u, { x: cx, y: cy }); }
    const n = this.aiStrategy(u, false); if (n) return n;
    // Remake deviation: an escort touching his commander (diagonals too) holds. A60C would square him up beside the
    // commander, which put him back in front of a commander who had just sidestepped him (see approach()).
    const lead = this.side(s).find((x) => x.commander);
    if (lead && lead !== u && Math.max(Math.abs(lead.x - u.x), Math.abs(lead.y - u.y)) <= 1) return this.makeWay(u, way);
    return this.approach(u, lead);
  }
  // An idle officer (an escort beside his commander, one whose errand is done) whom a walker of his own side could not
  // get round steps off the walker's line: one cell across it, the cheaper side first. Remake deviation, with approach().
  makeWay(u, way) {
    if (!way || way.day !== this.day || u.stop || u.qimen) return null;
    const to = [[u.x + way.dy, u.y + way.dx], [u.x - way.dy, u.y - way.dx]].filter(([x, y]) => this.inside(x, y) && !this.unitAt(x, y))
      .map(([x, y]) => ({ x, y, c: this.aiEstimate(u, x, y) })).sort((a, b) => a.c - b.c).find((c) => c.c <= this.pool[u.side]);
    if (!to) return null;
    this.move(u, to.x, to.y, to.c);
    return { type: 'move', u, path: [[to.x, to.y]], cost: to.c };
  }
  // AI strategy choice (6.8 §5): normal priority 6→5→8→9→7→random{2,1,3}→4→0; special 10→15 for listed strategists.
  aiStrategy(u, special) {
    const o = this.O(u.id), s = u.side, foe = s === 'att' ? 'def' : 'att';
    let order;
    if (special) {
      const k = AI_SPECIAL.indexOf(u.id);
      if (k < 0 || o.int < 92 || o.level < 4) return null;
      order = [10, 11].concat(o.level >= 5 && k >= 10 ? [12, 13] : [], o.level >= 6 && k >= 16 ? [14] : [], o.level >= 7 && u.id === 109 ? [15] : []);
    } else {
      const n = o.int < 40 ? 2 : o.int < 60 ? 4 : o.int < 75 ? 6 : o.int < 85 ? 8 : 10;
      order = [6, 5, 8, 9, 7, 'rnd', 4, 0].filter((x) => x === 'rnd' || x < n);
    }
    const targets = this.side(foe).filter((e) => this.dist(u, e) < 6).sort((a, b) => this.O(b.id).soldiers - this.O(a.id).soldiers);
    const needTroops = [0, 3, 4, 6, 7, 9, 12, 13, 14];
    for (let id of order) {
      if (id === 11) { if (this.pool[s] >= STRATS[11].cost && this.legal(u, 11)) return this.doCast(u, 11, null); continue; }
      for (const t of targets) {
        let sid = id;
        if (id === 'rnd') {
          const tt = this.terr(t.x, t.y); if (tt !== FOREST && tt !== MOUNT) break;
          const k = this.r(256) & 3; if (!k) break;
          sid = [0, 2, 1, 3][k]; if (sid === 3 && !this.O(t.id).soldiers) break;
          if (sid >= (o.int < 40 ? 2 : o.int < 60 ? 4 : 10)) break;
        }
        if (this.pool[s] < STRATS[sid].cost || !this.legal(u, sid, t)) continue;
        if (needTroops.includes(sid) && !this.O(t.id).soldiers) continue;
        if ((sid === 2 || sid === 10) && t.stop) continue;
        if (sid === 8 && this.O(t.id).loyalty >= 50) continue;
        if (sid === 15 && (t.qimen || !(o.war >= 85 || o.int >= 85) || o.soldiers < 700)) continue;
        return this.doCast(u, sid, t);
      }
    }
    return null;
  }
  doCast(u, id, t) { const res = this.cast(u, id, t, true); return { type: 'strategy', u, t, id, res }; }
  doAttack(u, targets) {
    const d = [...targets].sort((a, b) => this.O(a.id).soldiers - this.O(b.id).soldiers)[0];
    const res = this.attack(u, d);
    return { type: 'attack', a: u, d, res };
  }
  // AI movement (`A60C`, 6.8 §8): no path-finding. Candidates are the axis with the larger gap first
  // (ties: vertical first), sorted by the estimate table (small table when the troop LOW BYTE ≤2 — an
  // original quirk), first affordable free cell wins and the estimate is what gets paid. Role 1 units
  // attack an enemy blocking that first affordable step. One cell per decision; the dispatcher comes back.
  aiEstimate(u, x, y) {
    const o = this.O(u.id), t = this.villages.some((v) => v.x === x && v.y === y) ? PLAIN : this.terr(x, y);
    const big = [[3, 5, 5], [4, 4, 4], [2, 3, 3], [5, 6, 3], [5, 3, 6], [6, 6, 6]], small = [[2, 3, 3], [3, 3, 3], [1, 2, 2], [3, 5, 2], [3, 2, 4], [4, 4, 4]];
    return ((o.soldiers & 255) <= 2 ? small : big)[t][ARMY_IDX[o.army]];
  }
  approach(u, target) {
    if (!target || this.pool[u.side] <= 0 || u.stop || u.qimen) return null;
    const dx = target.x - u.x, dy = target.y - u.y;
    // A60C has no "stop beside the target": an occupied target cell blocks (or is attacked) below, an
    // empty one (a vacated castle, a village) is entered. Stop once standing on it.
    if (!dx && !dy) return null;
    const vert = [0, Math.sign(dy) || 1], horz = [Math.sign(dx), 0];
    let cands = Math.abs(dx) > Math.abs(dy) ? [horz, vert] : [vert, horz];
    if (!dx) cands = [vert]; else if (!dy) cands = [horz];
    // `u.detour` is the cell a sidestep (below) left, kept while he walks to the same target and until his next
    // ordinary step: he does not walk back onto it, though after the sidestep it is one of the two cells "toward the target".
    if (u.detour && (u.detour.tx !== target.x || u.detour.ty !== target.y)) u.detour = null;
    // A detour that would leave him no cell at all (the target now straight behind it) is forgotten.
    cands = cands.map(([sx, sy]) => [u.x + sx, u.y + sy]).filter(([x, y]) => this.inside(x, y));
    if (u.detour && cands.every(([x, y]) => u.detour.x === x && u.detour.y === y)) u.detour = null;
    const left = ([x, y]) => u.detour && u.detour.x === x && u.detour.y === y;
    cands = cands.filter((c) => !left(c))
      .map(([x, y]) => ({ x, y, c: this.aiEstimate(u, x, y) })).sort((a, b) => a.c - b.c);
    let first = cands.find((c) => c.c <= this.pool[u.side]);
    if (!first) return null;
    const occ = this.unitAt(first.x, first.y);
    if (occ && occ.side !== u.side) return u.role === 1 && this.pool[u.side] >= ATTACK_COST ? this.doAttack(u, [occ]) : null;
    // Remake deviation (player feedback N07): A60C waits when its own officer holds the first step, so two
    // officers queued on one axis (each walking toward the other) stood still until the day-31 timeout.
    // Here the other axis is tried instead; still one greedy step, no path-finding. The sidestep must not be undone
    // by the next decision (2026-11-17, a recording of 冀州: 曹丕 and his escort 田丰 stepped aside and back until the
    // day's mobility was gone, every day): the cell left is remembered in `u.detour`, an escort does not move back
    // in front of his commander (aiDecide), and an idle officer who still boxes a walker in steps aside (makeWay()).
    // tests/aiwalk.test.mjs.
    const from = occ ? { x: u.x, y: u.y, tx: target.x, ty: target.y } : null;
    if (occ) {
      if (first.x === target.x && first.y === target.y) return null; // already beside the officer it walks to
      if (!dx || !dy) cands = [[u.x + (dx ? 0 : 1), u.y + (dy ? 0 : 1)], [u.x - (dx ? 0 : 1), u.y - (dy ? 0 : 1)]]
        .filter(([x, y]) => this.inside(x, y)).filter((c) => !left(c)).map(([x, y]) => ({ x, y, c: this.aiEstimate(u, x, y) })).sort((a, b) => a.c - b.c);
      const held = first;
      first = cands.find((c) => c !== first && c.c <= this.pool[u.side] && !this.unitAt(c.x, c.y));
      // No way round: the officer in the way is asked to step off this line, which he does if he is idle (makeWay()).
      if (!first) { occ.giveWay = { day: this.day, dx: held.x - u.x, dy: held.y - u.y }; return null; }
    }
    u.detour = from;
    this.move(u, first.x, first.y, first.c);
    return { type: 'move', u, path: [[first.x, first.y]], cost: first.c };
  }
}
