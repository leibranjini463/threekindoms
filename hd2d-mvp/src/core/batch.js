// Commands carried out several times from one confirmation (宙斯之刃@bilibili, 2026-11-16): 病院, 书馆 and 赏赐 for several
// officers at once, each once or until he is full; 施舍, 离间, 诱纳 and 搜索 several times in a row. Not in the ROM, which asks
// for every command on its own. Each time here is still the command itself — game.js's own function, so its own roll in the
// same order as when given one by one, its own gold and its own 命令书 — and only the telling is joined into one. A run stops
// where the next one could not be given (the gold, the books, a cap), and says where and why. Rules only: no rendering.
import { name, maxHp, studyFee, heal, study, reward, charity, sow, lure, search } from './game.js';
import { STRATS } from './field.js';

// For each officer in the order given: step(id) once, or (until) again and again till he is full (full(result): the refusal that
// says so). A refusal that is not his being full stops the whole run (金不足, 没有宝物); so does a time that raised nothing (a gift
// from a ruler of little 人德 can add 0 to 忠诚, and would again), and so do the books running out, which is said when anyone
// was left (done(id): he needs nothing more). Resolves { ok, books, lines: [{ id, n, gain }], stop, msg } — one officer once just
// as the command always told it, more a line each, joined by 　 — or, when nothing could be done, the first refusal itself.
function runOfficers(ids, { until, books, step, full, done, what }) {
  const lines = []; let used = 0, stop = null, refused = null, single = null;
  for (const [k, id] of ids.entries()) {
    const line = { id, n: 0, gain: 0 };
    while (used < books) {
      const r = step(id);
      if (!r.ok) { refused ??= r; if (!full(r)) stop = r; break; }
      used++; line.n++; line.gain += r.gain ?? 0; single ??= r;
      if (!until) break;
      if (!r.gain) { stop = { msg: `${name(id)}这次没有提高` }; break; }
    }
    if (line.n) lines.push(line);
    if (stop) break;
    if (used >= books) { if (k < ids.length - 1 || (until && !done(id))) stop = { msg: '命令书已用完' }; break; }
  }
  if (!used) return refused;
  if (ids.length === 1 && used === 1 && !until) return { ...single, books: 1, lines };
  const msg = lines.map((l) => `${name(l.id)} ${what(l)}${l.n > 1 ? `（${l.n} 次）` : ''}`).join('　');
  return { ok: true, books: used, lines, stop, msg: `${msg}${stop ? `（${stop.msg}，其余未执行）` : ''}` };
}

export function healRun(g, cid, ids, { until = false, books = g.books } = {}) {
  return runOfficers(ids, { until, books, step: (id) => heal(g, cid, id), full: (r) => r.msg === '体力已满',
    done: (id) => g.officers[id].hp >= maxHp(g.officers[id]), what: (l) => `体力 +${l.gain}` });
}
export function studyRun(g, cid, ids, { until = false, books = g.books } = {}) {
  let spent = 0;
  const step = (id) => { const r = study(g, cid, id); if (r.ok) spent += r.cost; return r; };
  const res = runOfficers(ids, { until, books, step, full: (r) => r.msg === '智力80以上无法再学', done: (id) => g.officers[id].int >= 80, what: (l) => `智力 +${l.gain}` });
  return res?.ok && res.books > 1 ? { ...res, msg: `${res.msg}　共花费${spent}金` } : res;
}
// gold: the 赏金 of each time (10–100); treasure: one 宝物 each time instead.
export function rewardRun(g, cid, ids, { gold = 0, treasure = false, until = false, books = g.books } = {}) {
  return runOfficers(ids, { until, books, step: (id) => reward(g, cid, id, gold, treasure), full: (r) => r.msg === '忠诚已高，无需赏赐',
    done: (id) => g.officers[id].loyalty >= 90, what: (l) => `忠诚 +${l.gain}` });
}

// n times in a row, stopping at the first that cannot be given (统治度已满, 金米不足).
export function charityRun(g, cid, gold, rice, n) {
  let done = 0, gain = 0, stop = null, one = null;
  for (let i = 0; i < n; i++) { const r = charity(g, cid, gold, rice); if (!r.ok) { stop = r; break; } one ??= r; done++; gain += r.gain; }
  if (!done) return stop;
  if (n === 1) return one;
  return { ok: true, books: done, gain, msg: `统治度 +${gain}（${done} 次${stop ? `，${stop.msg}，其余未执行` : ''}）` };
}
// The same rumour n times; one that fails does not stop the run, a target at 忠诚 0 does.
export function sowRun(g, actor, id, n) {
  const before = g.officers[id].loyalty; let done = 0, hit = 0, one = null;
  for (let i = 0; i < n; i++) {
    if (done && g.officers[id].loyalty <= 0) break;
    const r = sow(g, actor, id); if (!r.ok) { if (!done) return r; break; }
    one ??= r; done++; if (!r.failed) hit++;
  }
  if (n === 1) return one;
  const now = g.officers[id].loyalty, left = done < n ? `，${name(id)}忠诚已为0，其余未执行` : '';
  return hit
    ? { ok: true, books: done, gain: before - now, msg: `离间${name(id)} ${done} 次，成功 ${hit} 次：忠诚 −${before - now}（现${now}）${left}` }
    : { ok: true, books: done, failed: true, msg: `离间${name(id)} ${done} 次，均失败` };
}
// Until he comes over, at most n times.
export function lureRun(g, cid, actor, id, n) {
  let done = 0, last = null;
  for (let i = 0; i < n; i++) {
    const r = lure(g, cid, actor, id); if (!r.ok) { if (!done) return r; break; }
    done++; last = r; if (r.joined != null) break;
  }
  if (n === 1) return last;
  return last.joined != null
    ? { ...last, books: done, msg: `${last.msg}（第 ${done} 次）` }
    : { ...last, books: done, msg: `诱纳${name(id)} ${done} 次，均失败${done < n ? `，${last.msg}` : ''}` };
}
// At most n times by the same officer. Coin, rice and 宝物 are added up; the first time that turns up someone (who joins, names
// a price or says no) ends the run, so whether to pay him is still the player's to answer. Resolves { books, steps, last, found }.
export function searchRun(g, cid, id, n) {
  const steps = [], found = { gold: 0, rice: 0, treasure: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const c = g.cities[cid], had = { gold: c.gold, rice: c.rice, treasure: c.treasure };
    const r = search(g, cid, id); steps.push(r);
    if (r.joined != null || r.offer != null || r.refused != null) break;
    found.gold += c.gold - had.gold; found.rice += c.rice - had.rice; found.treasure += c.treasure - had.treasure;
    if (c.gold === had.gold && c.rice === had.rice && c.treasure === had.treasure) found.none++;
  }
  return { books: steps.length, steps, last: steps.at(-1), found };
}
// What the coin, rice and 宝物 found came to: '金 73、米 64', or null for nothing.
export const foundText = (f) => [f.gold && `金 ${f.gold}`, f.rice && `米 ${f.rice}`, f.treasure && `宝物 ${f.treasure} 件`].filter(Boolean).join('、') || null;

// ---------- 计略 several times in a row (羽之@devblog, 2026-11-18; docs/战场计略连续施放方案_2026-11-18.md) ----------
// Not in the ROM, which confirms and plays every cast on its own. Each time here is field.cast itself (core/field.js): its own
// check (canCast, again before every time), its own mobility, its own roll in the same order as when cast one by one, its own
// experience and level. Only the telling is joined. A run stops before the time that would be wasted or could not be given:
// the target gone (slain, captured), the work done (笼络 won him over; 虚兵, 连环, 奇门遁甲 took: the ROM lets them be cast again on
// one held, which only resets the days, so stopping is the view's choice, not a rule), a hit that took nothing (no soldiers, no
// rice left), nothing left to take before the next (one target with no soldiers, an enemy with no rice), the target no longer
// meeting the 计略's condition, the mobility, the war over. A failure does not stop it (as 离间's run).
// Resolves { steps: [cast results], n, stop: { why, msg } | null }; stop.msg names the reason, the times not cast are left to the caller.
export const UNTIL_HIT = [2, 8, 10, 15]; // 虚兵, 笼络, 连环, 奇门遁甲: at most n times, the first that takes ends it
const LONE_LOSS = [0, 3, 4, 6, 13]; // 损兵 on the target alone: nothing to take once he has no soldiers
export function castRun(field, u, id, t, n) {
  const steps = [], S = STRATS[id];
  const who = () => (t ? name(t.id) : '');
  let stop = null;
  for (let i = 0; i < n; i++) {
    if (i) {
      const last = steps[i - 1];
      if (field.over) stop = { why: 'over', msg: '战斗已结束' };
      else if (t?.gone) stop = { why: 'gone', msg: `${who()}${t.fate === 'captured' ? '被擒' : t.fate === 'dead' ? '阵亡' : '离场'}` };
      else if (last.hit && UNTIL_HIT.includes(id)) stop = { why: 'took', msg: id === 8 ? `${who()}已倒戈` : `${S.name}已生效` };
      else if (last.hit && last.hits.length && !last.hits.some((h) => h.soldiers || h.hp || h.rice)) stop = { why: 'nothing', msg: last.hits.some((h) => h.rice != null) ? '敌军米已尽' : last.hits.every((h) => h.soldiers != null && !field.O(h.u.id).soldiers) ? `${[...new Set(last.hits.map((h) => name(h.u.id)))].join('、')}兵尽` : '这次没有造成损失' };
      else if (t && LONE_LOSS.includes(id) && !field.O(t.id).soldiers) stop = { why: 'nothing', msg: `${who()}兵尽` };
      else if (t && id === 5 && !field.chest(t.side).rice) stop = { why: 'nothing', msg: '敌军米已尽' };
      else if (!field.canCast(u, id, t)) stop = field.pool[u.side] < S.cost ? { why: 'pool', msg: '机动力不足' } : { why: 'illegal', msg: `${who()}已不符合${S.name}的条件` };
      if (stop) break;
    }
    const r = field.cast(u, id, t); // checks canCast itself before it rolls anything
    if (!r.ok) { if (!steps.length) return { steps: [r], n, stop: null }; stop = { why: 'refused', msg: r.lines[0] }; break; }
    steps.push(r);
  }
  return { steps, n, stop };
}

// The most a run could need, for the confirmation: in books (times) and gold, the dice falling as low as they can.
export function healNeed(g, id, until) { const o = g.officers[id]; return until ? Math.ceil((maxHp(o) - o.hp) / 35) : 1; }
export function studyNeed(g, id, until) {
  let int = g.officers[id].int, n = 0, gold = 0;
  while (int < 80) { const [cost, base] = studyFee(int); n++; gold += cost; int += base; if (!until) break; }
  return { n, gold };
}
// Infinity: the least a gift can raise 忠诚 is 0 (a ruler of little 人德 giving little), so only the books bound it.
export function rewardNeed(g, cid, id, { gold = 0, treasure = false, until = false } = {}) {
  if (!until) return 1;
  const V = g.officers[g.factions[g.cities[cid].faction].ruler].virtue, low = treasure ? Math.floor(V / 10) + 3 : Math.floor(((Math.floor(V / 10) + Math.floor(gold / 20)) * 7) / 10);
  return low > 0 ? Math.ceil((90 - g.officers[id].loyalty) / low) : Infinity;
}
