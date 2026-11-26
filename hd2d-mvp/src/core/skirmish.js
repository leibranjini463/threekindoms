// 白兵 and 单挑 resolver (6.4). Kept from the original: squad split (k=ceil(N/100), even split,
// infantry→archers→cavalry by the composition table, castle defenders' infantry become archers),
// factor F, the troop/HP ladder B, cavalry/general damage reduction, archer 70%, action cadence
// (infantry/archers once, cavalry/general twice, attacker then defender), capture thresholds by
// difficulty from round 4, and the duel hit matrix / damage / 舍身 / initiative formulas.
// Abstracted: there is no 16×10 grid — targets are drawn instead of path-found, and both sides
// fight on "前进" automatically for up to 6 rounds. Generals meeting starts a duel.
import { data, addExp, isRuler, maxHp } from './game.js';
import { tableDraws, realChance } from './origrng.js';

const CASTLE = 5;
const B = (h) => (h < 15 ? 20 : h < 35 ? 40 : h < 60 ? 50 : h < 80 ? 70 : h < 90 ? 85 : h < 100 ? 95 : 100);
const C = (w) => (w < 65 ? 45 : w < 80 ? 50 : w < 87 ? 55 : w < 92 ? 60 : w < 97 ? 65 : 70);
const HIT = [[70, 75, 60], [55, 60, 70], [80, 50, 60]];

function squads(o, castleDef) {
  const D = data(), n = o.soldiers, k = Math.ceil(n / 100);
  const band = o.war >= 80 ? '80-99' : o.war >= 50 ? '50-79' : '0-49';
  const comp = D.composition.find((c) => c.level === o.level && c.war === band) || { inf: 5, arc: 3, cav: 2 };
  const q = Math.floor(n / Math.max(1, k)), rem = n % Math.max(1, k), out = [];
  for (let i = 0; i < k; i++) {
    let type = i < comp.inf ? 'inf' : i < comp.inf + comp.arc ? 'arc' : 'cav';
    if (castleDef && type === 'inf') type = 'arc';
    out.push({ type, hp: q + (i < rem ? 1 : 0) });
  }
  return out;
}

export function skirmish(g, aId, dId, terrain, r, human = null) {
  const D = data(), A = g.officers[aId], Dd = g.officers[dId];
  const eq = (o) => ({ atk: D.equipment[o.weapon]?.atk || 0, def: D.equipment[24 + o.armor]?.dfn || 0, wgrp: Math.floor(o.weapon / 8), weight: (D.equipment[o.weapon]?.weight || 0) + (D.equipment[24 + o.armor]?.weight || 0) });
  const mk = (o, id, castleDef) => ({ id, o, F: Math.floor((C(o.war) * o.war) / 100) + 9 - r(9), eq: eq(o), sq: squads(o, castleDef), hp: o.hp, start: o.soldiers });
  const side = { a: mk(A, aId, false), d: mk(Dd, dId, terrain === CASTLE) };
  const tl = []; let duel = null, fate = { a: null, d: null };
  const capT = [45, 40, 30][g.level], capP = [55, 50, 30][g.level];
  const live = (s) => side[s].sq.filter((x) => x.hp > 0);
  for (let round = 1; round <= 4 && !fate.a && !fate.d && !duel; round++) {
    const onGen = { a: 0, d: 0 }; // only pieces next to a general can strike it: at most 1 per round
    for (const type of ['inf', 'arc', 'cav', 'gen']) for (const s of ['a', 'd']) {
      const me = side[s], foe = side[s === 'a' ? 'd' : 'a'], fs = s === 'a' ? 'd' : 'a';
      const actors = type === 'gen' ? (me.hp > 0 ? [{ type: 'gen', hp: me.hp }] : []) : live(s).filter((x) => x.type === type);
      for (const act of actors) for (let k = 0; k < (type === 'cav' || type === 'gen' ? 2 : 1); k++) {
        if (fate.a || fate.d || duel) break;
        const targets = live(fs);
        const hitGeneral = foe.hp > 0 && onGen[fs] < 1 && (!targets.length || (type !== 'arc' && targets.length <= 1 && r(100) < 50));
        if (!hitGeneral && !targets.length) continue;
        if (hitGeneral) onGen[fs]++;
        if (hitGeneral && type === 'gen' && foe.hp > 0 && r(100) < 60) { duel = human ? new Duel(side, r, g) : runDuel(side, r); break; }
        const H = type === 'gen' ? me.hp : act.hp;
        let F = me.F; if (type === 'arc') F = Math.floor((70 * F) / 100);
        let dmg = Math.floor(((F + (type === 'gen' ? me.eq.atk : 0)) * B(H)) / 100);
        if (hitGeneral) {
          const d2 = Math.max(0, Math.floor(dmg / 2) - foe.eq.def);
          foe.hp = Math.max(0, foe.hp - d2);
          addExp(g, me.id, Math.floor(d2 / 2));
          if (foe.hp <= 0) { fate[fs] = 'dead'; tl.push({ type: 'death', who: foe.id, by: me.id }); }
        } else {
          const t = targets[r(targets.length)];
          if (t.type === 'cav') dmg = Math.floor(dmg / 2) + Math.floor(dmg / 4);
          const lost = Math.min(t.hp, dmg); t.hp -= lost;
          addExp(g, me.id, Math.floor(dmg / 2));
        }
      }
    }
    // A general whose squads are all gone withdraws from the 白兵 (AI 退却, S21).
    if (!live('a').length || !live('d').length) { if (round >= 2) break; }
    // Capture check from round 4: low HP, ≥2 enemy squads, loyalty ≠100, draw below the difficulty gate.
    if (round >= 4) for (const s of ['a', 'd']) {
      const me = side[s], fs = s === 'a' ? 'd' : 'a';
      if (!fate[s] && me.hp < capT && live(fs).length >= 2 && me.o.loyalty !== 100 && r(100) < capP) { fate[s] = 'captured'; tl.push({ type: 'capture', who: me.id }); }
    }
  }
  const sum = (s) => live(s).reduce((a, x) => a + x.hp, 0);
  const res = { timeline: tl, side };
  // finish(): fill results; for a player duel it runs after the interactive duel has ended.
  res.finish = () => {
    const dd = res.duel && !(res.duel instanceof Duel) ? res.duel : res.duel ? { actions: res.duel.actions, ...res.duel.result } : null;
    res.duel = dd;
    if (dd) for (const s of ['a', 'd']) { if (dd.dead === side[s].id) fate[s] = 'dead'; if (dd.surrendered === side[s].id) fate[s] = dd.defected === side[s].id ? 'defected' : 'captured'; }
    for (const s of ['a', 'd']) { res[s] = { soldiers: sum(s), hp: side[s].hp, fate: fate[s] }; }
    res.lossA = side.a.start - res.a.soldiers; res.lossD = side.d.start - res.d.soldiers;
    delete res.pending; return res;
  };
  res.duel = duel;
  if (duel instanceof Duel) {
    res.pending = duel;
    for (const s of ['a', 'd']) res[s] = { soldiers: sum(s), hp: side[s].hp, fate: fate[s] }; // troop totals are final already
    res.lossA = side.a.start - res.a.soldiers; res.lossD = side.d.start - res.d.soldiers;
    res.auto = () => { for (let t; (t = duel.next()); ) duel.act(t, duel.aiCommand(t)); return res.settle(); };
    return res;
  }
  return res.finish();
}

// 单挑 (D02–D05, D09): initiative floor((hp+war)/10)+20-weights, each side +0..10, re-drawn every two
// actions; hit matrix by weapon group; d=max(0,floor((F+atk)/2)-armor+r-5); the hit roll is the original's
// table roll against 100 (牵制, d/3), the matrix (攻击) or 30 (舍身, 2d; a byte ≥128 skips the hit; a miss costs
// 10..30 HP); the striker's own 骂倒 adds 20 to that roll and 3/10 to d, whatever the command; retreat escapes on r<2×base,
// else takes 5..14. Like the original it only ends at HP 0, a retreat, a persuasion exit or surrender (说得 or 降参);
// a 100-action valve (never reached in real fights) stops zero-damage AI-vs-AI loops by withdrawing the weaker side.
// The AI is the original five-stage dispatcher (`bank23:$B5C8`, D12; see aiCommand).
// Duel AI 牵制(0)/攻击(2) table (`file 0x2F770`): row = enemy HP tier × 3 + own HP tier (0..30/31..60/61..99), column = r(8).
const AI_TABLE = ['00022222', '00000222', '00000022', '00222222', '00002222', '00000222', '02222222', '00022222', '00002222'];
const tier = (h) => (h < 31 ? 0 : h < 61 ? 1 : 2);
const s8 = (v) => ((v & 255) >= 128 ? 0 : v & 255); // `max_signed8`: an 8-bit value with the sign bit set reads as 0
const CMD_CODE = { feint: 0, attack: 2, desperate: 6, persuade: 7, taunt: 8 };
export class Duel {
  // human: the human-controlled skirmish side, if any. The original seats the duel's two generals by
  // controller (`$CD69`): an AI attacker facing a human defender is swapped so the human sits at index 0.
  constructor(side, r, g, human = null) {
    this.side = side; this.r = r; this.n = 0; this.order = []; this.actions = []; this.result = null; this.isRuler = g ? (id) => isRuler(g, id) : null;
    // 先手基值 is set once from the HP each general enters the duel with ($B230 → $04B3/B4); later rounds
    // and the retreat roll reuse it, so wounds taken during the duel don't slow him or his escape.
    const b = (x) => Math.floor((x.hp + x.o.war) / 10) + 20 - x.eq.weight;
    this.base0 = { a: b(side.a), d: b(side.d) };
    this.seat = human === 'd' ? ['d', 'a'] : ['a', 'd'];
    this.init = { a: 0, d: 0 }; this.curse = { a: 0, d: 0 }; this.taunted = { a: false, d: false }; this.last = 0;
  }
  base(s) { return this.base0[s]; }
  hitChance(s) { const me = this.side[s], foe = this.side[s === 'a' ? 'd' : 'a']; return HIT[me.eq.wgrp][foe.eq.wgrp]; }
  // `bank23:$B8D3` reads the striker's own 骂倒 counter (`$04B5,Y`, Y = `$04AA`) before it looks at the command: while
  // it runs, 20 is added to his hit roll and 3/10 to his damage, for 牵制, 攻击 and 舍身 alike (18,432 probe cases).
  cursed(s) { return this.curse[s] > 0; }
  // What the hit roll of s's blow is held under: 100 / the matrix / 30, less the 20 his own 骂倒 adds to the roll.
  threshold(s, cmd) { return Math.max(0, (cmd === 'feint' ? 100 : cmd === 'desperate' ? 30 : this.hitChance(s)) - (this.cursed(s) ? 20 : 0)); }
  // The chance in percent that it lands. The roll is the original's table roll (core/origrng.js), which comes under
  // p more often than p in 100: 舍身 lands 36.7% of the time, 14.5% under 骂倒. The menu shows this number.
  odds(s, cmd) { return realChance(this.threshold(s, cmd)); }
  next() {
    if (this.result) return null;
    if (this.n >= 100) { const [lo, hi] = this.side.a.hp < this.side.d.hp ? ['a', 'd'] : ['d', 'a']; this.result = { dead: null, retreated: this.side[lo].id, winner: this.side[hi].id }; return null; }
    if (this.n % 2 === 0) { this.init = { a: this.base('a') + this.r(11), d: this.base('d') + this.r(11) }; this.order = this.init.a >= this.init.d ? ['a', 'd'] : ['d', 'a']; }
    // `$B361`: the acting side's 骂倒 counter drops as its action starts, before any command is chosen. The
    // original stores the masked counter less one, so a drop also clears that side's $80 (it may taunt again).
    const t = this.order[this.n % 2];
    if (this.curse[t]) { this.curse[t]--; this.taunted[t] = false; }
    return t;
  }
  // Duel work bytes `$04B1+i` as the original lays them out, for the low-HP branch below that reads
  // `$04B1+(HP xor 1)`: HP, 先手基值, 骂倒 byte (counter | $80 once this side has tried 骂倒), the two
  // initiative totals, last command, pair flag, F backups ($04C1/2, skirmish sides), $04C3/4 = 2, hit
  // chances. Bytes the duel does not own ($04B7–BC, $04C7–D0: shared menu/animation scratch) read as 0.
  ram(i) {
    const [L, R] = this.seat, rage = (s) => this.curse[s] | (this.taunted[s] ? 128 : 0);
    const bytes = [this.side[L].hp, this.side[R].hp, this.base(L), this.base(R), rage(L), rage(R), 0, 0, 0, 0, 0, 0,
      this.init[L], this.init[R], this.last, this.n % 2, this.side.a.F, this.side.d.F, 2, 2, this.hitChance(L), this.hitChance(R)];
    return (bytes[i] ?? 0) & 255;
  }
  // `$B5C8`, verified on 45,360 decisions: (surrender — unreachable, `$B7B3` tail-jumps away) → 舍身 when
  // below half the ROM template HP and 30+ behind → the low-HP attack (its EOR #1 lands on own HP, so it
  // reads a neighbouring work byte, kept as is) → 说得 / 骂倒 when not under 骂倒 → the 牵制/攻击 table.
  // The AI never retreats. Each stage draws before the flag checks that may still reject it.
  aiCommand(s) {
    const r = this.r, fs = s === 'a' ? 'd' : 'a', me = this.side[s], foe = this.side[fs], hp = me.hp, o = me.o, e = foe.o;
    if (hp < Math.floor(maxHp(o, me.id) / 2) && hp + 30 < foe.hp && r(100) < s8(124 - hp - Math.max(o.war, o.int))) return 'desperate';
    if (hp < 30 && this.ram(hp ^ 1) >= 50 && r(100) < s8(50 - s8(o.war - e.war))) return 'attack';
    if (!this.curse[s]) {
      if (o.int > e.int && r(100) < s8(o.int + o.virtue - o.war - e.loyalty)) return 'persuade';
      if (e.war >= o.war && r(100) < s8(Math.max(0, e.war - e.int) + 10) && !this.taunted[s] && !this.curse[fs]) return 'taunt';
    }
    return AI_TABLE[tier(foe.hp) * 3 + tier(hp)][r(8)] === '2' ? 'attack' : 'feint';
  }
  // 说得 (D07/D08): 27-cell table by 智+德 / 敌忠 / 敌原记录体力, 8 results each.
  persuadeTable(s) {
    const me = this.side[s], foe = this.side[s === 'a' ? 'd' : 'a'], iv = me.o.int + me.o.virtue;
    const k = `${iv >= 180 ? '180-198' : iv >= 130 ? '130-179' : '0-129'}|${foe.o.loyalty >= 80 ? '80-100' : foe.o.loyalty >= 50 ? '50-79' : '0-49'}|${foe.o.hp >= 80 ? '80-99' : foe.o.hp >= 50 ? '50-79' : '0-49'}`;
    return data().persuade[k];
  }
  // `$B44C`: while a 骂倒 counter is still running after that drop, the 计略 submenu (说得, 骂倒) does not open.
  canScheme(s) { return !this.curse[s]; }
  canTaunt(s) { return this.canScheme(s) && !this.taunted[s]; }
  // 降参 (`B47E`, D10): the human side gives itself up and is taken prisoner; `D262` refuses the seven rulers
  // and returns to the menu. The AI never chooses it (its candidate stage is unreachable).
  canSurrender(s) { return !this.isRuler?.(this.side[s].id); }
  act(s, cmd) {
    const r = this.r, me = this.side[s], fs = s === 'a' ? 'd' : 'a', foe = this.side[fs];
    this.n++; this.last = CMD_CODE[cmd] ?? this.last;
    if ((cmd === 'persuade' && !this.canScheme(s)) || (cmd === 'taunt' && !this.canTaunt(s)) || (cmd === 'surrender' && !this.canSurrender(s))) throw new Error(`单挑：${cmd} not allowed for ${s} now`);
    if (cmd === 'surrender') {
      const a = { by: me.id, cmd, hit: true, dmg: 0 }; this.actions.push(a);
      this.result = { dead: null, surrendered: me.id, winner: foe.id };
      return a;
    }
    if (cmd === 'taunt') {
      // `$C08A` writes $80 over the taunter's 骂倒 byte before the roll (trying once uses it up; his counter is
      // already 0, the submenu being shut while it runs), and a landed 骂倒 overwrites the target's byte.
      this.taunted[s] = true;
      const ok = Math.max(0, me.o.int + me.o.virtue - foe.o.int) + 1 + r(10) >= 110;
      if (ok) { this.curse[fs] = 3 + r(3); this.taunted[fs] = false; }
      const a = { by: me.id, cmd, hit: ok, dmg: 0 }; this.actions.push(a); return a;
    }
    if (cmd === 'persuade') {
      let out = this.persuadeTable(s)[r(8)];
      if (out === 4 && this.isRuler?.(foe.id)) out = 1; // 七君主不会投降 (D10)
      const a = { by: me.id, cmd, hit: out > 1, dmg: 0, out }; this.actions.push(a);
      // 结果 2 (`$BF43`) gives the persuaded general result code 1, the code a retreat leaves: back on the 白兵 field
      // (`CDCF`) his general order turns to 退却 (Tactical.resolveDuel). He is not beaten, so no 败走 banner.
      if (out === 2) this.result = { dead: null, ended: true, withdrew: foe.id, winner: me.id };
      if (out === 3) this.result = { dead: null, ended: true, endSkirmish: true, winner: me.id };
      // 结果 4 (`$BF7E`) gives the persuaded general code 4: at the write-back (`$C766`) he changes side and stays on the
      // war map (Field.applySkirmish), no prisoner. `surrendered` keeps the 投降 text and staging; `defected` is the outcome.
      if (out === 4) this.result = { dead: null, surrendered: foe.id, defected: foe.id, winner: me.id };
      return a;
    }
    if (cmd === 'retreat') {
      const escaped = r(100) < 2 * this.base(s), chase = escaped ? 0 : 5 + r(10);
      me.hp = Math.max(0, me.hp - chase);
      const a = { by: me.id, cmd, hit: !escaped, dmg: chase }; this.actions.push(a);
      this.result = me.hp <= 0 ? { dead: me.id, winner: foe.id } : { dead: null, retreated: me.id, winner: foe.id };
      return a;
    }
    // `$BA15` then `$B8D3`: the hit roll (`$E843`), then the spread (`AND #$0F`, under 11), then a missed 舍身's recoil
    // (`AND #$1F`, under 21), all read on from one cursor. The threshold was read before the roll, as the menu showed it.
    const draw = tableDraws(r), hit = draw(100) < this.threshold(s, cmd);
    let d = Math.max(0, Math.floor((me.F + me.eq.atk) / 2) - foe.eq.def + draw(11, 15) - 5), self = 0;
    if (this.cursed(s)) d += Math.floor((3 * d) / 10);
    let dmg = !hit ? 0 : cmd === 'feint' ? Math.floor(d / 3) : cmd === 'attack' ? d : 2 * d;
    if (cmd === 'desperate' && !hit) { self = 10 + draw(21, 31); me.hp = Math.max(0, me.hp - self); }
    if (dmg >= 128) dmg = 0; // `$B972 BMI`: a damage byte with the sign bit set skips the subtraction (舍身 under 骂倒 can reach it)
    foe.hp = Math.max(0, foe.hp - dmg);
    const a = { by: me.id, cmd, hit, dmg, self }; this.actions.push(a);
    if (foe.hp <= 0 || me.hp <= 0) this.result = { dead: foe.hp <= 0 ? foe.id : me.id, winner: foe.hp <= 0 ? me.id : foe.id };
    return a;
  }
}
function runDuel(side, r) {
  const duel = new Duel(side, r);
  for (let s; (s = duel.next()); ) duel.act(s, duel.aiCommand(s));
  return { actions: duel.actions, ...duel.result };
}
