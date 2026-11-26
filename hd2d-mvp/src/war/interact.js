// The player's side of the war map (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the interaction state st,
// the HUD and the unit panel kept in step with it, a click on a cell, Esc, the 攻击 and 计略 questions and their answers, undo, 退却,
// the village's shop and clinic, and the 布阵. What it sets playing (a march, a 白兵, a 计略) is play.js's, read as wv.name when used.
// endDeploy and done are reassigned (play.js's loop and check): they are wv.endDeploy and wv.done, never copied.
import { CASTLE, ATTACK_COST, MAX_DAY, STRATS, TERRAIN_NAME } from '../core/field.js';
import { name, cityName, factionName, maxHp } from '../core/game.js';
import { STRATEGY_FX } from '../fx.js';
import { stage, fresh } from '../commitguard.js';
import { PHONE } from '../phone.js';
import { UNTIL_HIT } from '../core/batch.js';
import { genericArt } from '../core/pack.js';

export function makeInteract(wv) {
  const { field, audio, ui, human, scene, terr, inside, views, removeGone, mark, clearMarks, clearPreview, cursor, frameCast, keepInView, unframeCast } = wv;
  // --- Interaction state ---
  // peek: an enemy clicked while one of ours is selected — his particulars show, ours stays selected, and beside
  // him stands the 攻击 prompt when he can be struck (playtest of 2026-10-31, F02: a click meant to look at an
  // enemy started the 白兵 at once).
  // menu: the 计略 list is open in the action panel; cast: the 计略 whose target is being chosen; confirm: { u, id, t } once a target
  // (or, for 十面埋伏, none) is picked and the cast waits for its own new input (D32: the confirmation in the panel, src/commitguard.js).
  const st = { moveAsk: null, sel: null, reach: null, last: null, busy: false, cast: null, menu: false, confirm: null, deploying: false, peek: null, ask: null, cmp: null, flash: false, strike: null, atkList: false,
    // The step the player is on, read off the fields above (read-only): the 布阵, a field playing something out, nothing of ours
    // selected (an enemy looked at, or no one), else his own step as showOptions tells ui.warUnit.
    get stage() {
      if (this.deploying) return 'deploying';
      if (this.busy) return 'busy';
      const u = this.sel;
      if (!u || u.gone || u.side !== human) return u || this.peek ? 'peek' : 'idle';
      return stepOf();
    },
  };
  // the step ours is on, as ui.warUnit is told it (line 666's chain, unchanged)
  const stepOf = () => (st.strike ? 'strike' : st.atkList ? 'attacks' : st.confirm ? 'confirm' : st.cast != null ? 'targets' : st.menu ? 'strats' : 'cmds');
  const sideLabel = (s) => `${factionName(field.g, field.faction(s))}军`;
  function hud() {
    const mine = human || 'att', foe = mine === 'att' ? 'def' : 'att';
    ui.warHud({
      day: field.day, max: MAX_DAY, myTurn: field.turn === human, deploying: st.deploying, canUndo: !!st.last, city: cityName(field.war.city),
      me: { name: sideLabel(mine), pool: field.pool[mine], rice: field.chest(mine).rice, gold: field.chest(mine).gold, troops: field.troops(mine), role: mine === 'att' ? '攻' : '守' },
      foe: { name: sideLabel(foe), pool: field.pool[foe], rice: field.chest(foe).rice, troops: field.troops(foe) },
    });
  }
  // The foe's card: shown while a 攻击 or 计略 is being asked about him, else for the enemy the pointer is on, and
  // only with one of ours selected. Hover calls it on every move, so it redraws only when the foe changes.
  function compareTarget() {
    const u = st.sel;
    if (!u || u.gone || u.side !== human || st.deploying || field.over) return null;
    const t = st.ask ?? st.peek;
    if (t && !t.gone) return t;
    if (st.busy || !st.hoverCell) return null;
    const e = field.unitAt(st.hoverCell.x, st.hoverCell.y);
    return e && e.side !== human ? e : null;
  }
  function syncCompare(force = false) {
    const t = compareTarget();
    if (!force && t === st.cmp) return;
    st.cmp = t;
    ui.warCompare?.(t ? { u: t, o: field.O(t.id), village: field.village(t)?.kind } : null);
  }
  // What each of the player's generals cast last in this war, and on whom: { id, t }. The 计略 list and the target list start on
  // them, and his commands offer 再施, the same 计略 again (devblog #70 希洛-唯, #175). He stays selected after a cast (play.js castOn,
  // 2026-11-14), so it is offered at once; the cast it starts is confirmed like any other, so a second click cannot cast twice by mistake.
  const lastCast = new Map();
  const recastOf = (u) => { const l = u?.side === human ? lastCast.get(u) : null; return l && field.strategies(u).some((x) => x.id === l.id) ? l : null; };
  function showOptions() {
    clearMarks(); clearPreview();
    const u = st.sel;
    if (st.cast == null && !st.busy) unframeCast(); // the target choice is over (cast, cancelled, another general picked): the view as it was
    if (st.peek && (st.peek.gone || !u || u.gone || u.side !== human || field.over)) st.peek = null;
    // Ours stays on the left; a peeked enemy's particulars stand on the right (syncCompare).
    const shown = u?.side === human ? u : st.peek ?? u;
    const again = shown ? recastOf(shown) : null;
    if (st.menu && (!u || u.gone || u.side !== human || field.turn !== human || field.over)) st.menu = false;
    if (st.confirm && (st.confirm.u !== u || u.gone || field.turn !== human || field.over)) { st.confirm = null; st.ask = null; }
    // The 攻击 asked about (D32 §6) holds while he can still be struck; entering, it stays on screen until the 白兵 takes over.
    if (st.strike && !st.strike.entering && (st.strike.a !== u || !attackable(u, st.strike.t))) { st.strike = null; st.ask = null; }
    if (st.atkList && (!u || !attackTargets(u).length)) st.atkList = false;
    const stage = shown !== u || !u || u.side !== human ? null : stepOf();
    ui.warUnit(shown ? { u: shown, stage, chosen: stage === 'strats' ? st.chosen ?? null : null, confirm: shown === u ? confirmInfo() : null, strike: shown === u ? strikeInfo() : null, attacks: stage === 'attacks' || stage === 'strike' ? attackRows(u) : null, canAttack: shown === u && stage === 'cmds' && attackTargets(u).length > 0, canUndoHim: !!st.last && st.last.u === shown, recast: again ? { id: again.id, name: STRATS[again.id].name, cost: STRATS[again.id].cost, usable: castable(shown, again.id), why: field.whyNot(shown, again.id) } : null, o: field.O(shown.id), mine: shown.side === human, village: field.village(shown)?.kind, canRetreat: shown.side === human && field.retreatTargets(shown).length > 0, canUndo: !!st.last, busy: st.busy, flash: st.flash, asking: !!st.peek, targets: shown === u ? castTargets() : null,
      strategies: shown.side === human ? field.strategies(shown).map((x) => ({ ...x, usable: castable(shown, x.id), why: field.whyNot(shown, x.id), last: x.id === again?.id })) : [] } : null);
    st.flash = false; syncCompare(true);
    if (!u || u.side !== human || field.turn !== human || field.over || st.busy) return;
    if (st.cast != null) { for (const e of field.alive) if (field.legal(u, st.cast, e)) mark(e.x, e.y, 'strat'); return; }
    st.reach = field.reach(u);
    for (const k of st.reach.dist.keys()) { const [x, y] = k.split(',').map(Number); if (x !== u.x || y !== u.y) mark(x, y, terr(x, y) === CASTLE ? 'castle' : 'move'); }
    if (field.pool[u.side] >= ATTACK_COST) for (const e of field.adjacentEnemies(u)) mark(e.x, e.y, 'attack');
  }
  function select(u) { st.sel = u; st.peek = null; st.menu = false; st.confirm = null; st.ask = null; st.strike = null; st.atkList = false; showOptions(); }
  // The enemies he may strike now, beside him (攻击, D32 §6): the 攻击 command lists them when there is more than one.
  const attackTargets = (u) => (u && !u.gone && u.side === human && field.turn === human && !field.over && field.pool[human] >= ATTACK_COST ? field.adjacentEnemies(u).filter((t) => attackable(u, t)) : []);
  const attackRows = (u) => attackTargets(u).map((t) => ({ u: t, o: field.O(t.id), ground: TERRAIN_NAME[field.terr(t.x, t.y)], commander: !!t.commander }));
  // What the 攻击 confirmation states, read off the board only (no battle is made and nothing is drawn before it is given):
  // the 白兵's ground (the struck one's cell, as Field.attack takes it), whether he holds a castle (he stands in its formation;
  // ours is chosen as ever), whether he is the enemy's 总大将, and the mobility left after it.
  function strikeInfo() {
    const s = st.strike; if (!s) return null;
    const left = field.pool[human] - ATTACK_COST, T = field.terr(s.t.x, s.t.y); // as Field.attack reads it
    return { t: s.t, cost: ATTACK_COST, pool: field.pool[human], left, attacks: Math.max(0, Math.floor(left / ATTACK_COST)), ground: TERRAIN_NAME[T], castle: T === CASTLE, commander: !!s.t.commander, entering: !!s.entering, from: s.from };
  }
  // What the panel's confirmation states: the caster, the 计略, its target, the odds, the cost and what the army has left after it.
  // n: how many times in a row (羽之@devblog, 2026-11-18; src/core/batch.js castRun), 1 to max = the pool ÷ the cost; the left and the
  // attacks are for all n. until: 虚兵, 笼络, 连环, 奇门遁甲, whose n is "at most, the first that takes ends it". No count for 十面埋伏.
  function confirmInfo() {
    const c = st.confirm; if (!c) return null;
    const S = STRATS[c.id], chance = c.t ? field.odds(c.u, c.id, c.t) : null, max = runMax(c.id), n = Math.min(c.n ?? 1, max), left = field.pool[human] - S.cost * n;
    return { id: c.id, name: S.name, t: c.t, cost: S.cost, pool: field.pool[human], left, attacks: Math.max(0, Math.floor(left / ATTACK_COST)), chance, loyalty: c.t && c.id === 8 ? field.O(c.t.id).loyalty : null,
      n, max, until: UNTIL_HIT.includes(c.id) };
  }
  const runMax = (id) => (id === 11 ? 1 : Math.max(1, Math.floor(field.pool[human] / STRATS[id].cost)));
  // The count in the confirmation: by d (← →, − ＋, the pad's left and right) or to v (最多); nothing else changes, nothing is spent.
  function runCount(d, v = null) {
    const c = st.confirm; if (!c || st.busy) return false;
    const max = runMax(c.id); if (max <= 1) return false;
    const n = Math.max(1, Math.min(max, v ?? (c.n ?? 1) + d)); if (n === c.n) return true;
    c.n = n; showOptions(); return true;
  }
  // The generals the 计略 in hand may be cast on, likeliest first then nearest, for the list beside the caster (feedback of
  // 2026-11-09, 张沐镕@bilibili: a target at 全景 was a 28×20 px cell): { name, target, rows: [{ u, o, chance, commander }] }, or null.
  function castTargets() {
    const u = st.sel, id = st.cast;
    if (id == null || !u || u.gone || u.side !== human || field.turn !== human || field.over) return null;
    const rows = field.alive.filter((e) => field.legal(u, id, e)).map((e) => ({ u: e, o: field.O(e.id), chance: field.odds(u, id, e), dist: field.dist(u, e), commander: !!e.commander, last: lastCast.get(u)?.t === e }))
      .sort((a, b) => b.chance - a.chance || a.dist - b.dist);
    return { id, name: STRATS[id].name, cost: STRATS[id].cost, rows };
  }
  // The target under the pointer or the pad's cursor, lit in the panel's list (app.js warHot).
  const hot = (c) => { const e = c && (st.cast != null || st.atkList || st.strike) && st.sel ? field.unitAt(c.x, c.y) : null; ui.warHot?.(e && (st.cast != null ? field.legal(st.sel, st.cast, e) : attackable(st.sel, e)) ? e.id : null); };
  const attackable = (a, t) => !!(a && t && a.side === human && t.side !== human && !a.gone && !t.gone && field.turn === human && field.pool[human] >= ATTACK_COST && field.adjacentEnemies(a).includes(t));
  // Whether u may cast this 计略 on someone now (the same check Field.cast makes before it runs).
  const castable = (u, id) => id === 11 ? field.canCast(u, 11, null) : field.side(u.side === 'att' ? 'def' : 'att').some((e) => field.canCast(u, id, e));

  const inRect = (x, y) => wv.rect && x >= wv.rect[0] && x <= wv.rect[1] && y >= wv.rect[2] && y <= wv.rect[3];
  function showDeploy() {
    clearMarks();
    for (let y = wv.rect[2]; y <= wv.rect[3]; y++) for (let x = wv.rect[0]; x <= wv.rect[1]; x++) if (inside(x, y) && !field.unitAt(x, y)) mark(x, y, 'deploy');
    ui.warUnit(st.sel ? { u: st.sel, o: field.O(st.sel.id), mine: true, deploying: true, strategies: [] } : null);
  }
  function deployClick(x, y) {
    const u = field.unitAt(x, y);
    if (u && u.side === human) { st.sel = u; return showDeploy(); }
    if (!u && st.sel && inRect(x, y)) { const s = st.sel; s.x = x; s.y = y; audio.sfx('sfx-step'); showDeploy(); wv.moveAlong(s, [[x, y]], { perCell: 240, follow: false, face: 'foes' }); }
  }
  wv.endDeploy = undefined;
  function finishDeploy() { if (!st.deploying) return; st.deploying = false; clearMarks(); st.sel = null; wv.endDeploy?.(); }
  // e: the input that made the click (a pointer release, a key, nothing for the pad or a script), for src/commitguard.js.
  async function clickCell(x, y, e) {
    if (st.deploying) return deployClick(x, y);
    if (st.busy || field.over || field.turn !== human) return;
    const u = field.unitAt(x, y);
    // Phone: a move asked about (below) is answered by this tap, whatever it lands on.
    const asked = st.moveAsk; if (asked) dropMoveAsk();
    // The 计略 list is open: a click on the map only puts it away (another of ours is selected instead).
    if (st.menu && st.sel) { st.menu = false; if (u && u.side === human && u !== st.sel) return select(u); return showOptions(); }
    // A 攻击 waits for its confirmation (D32 §6): the same enemy again enters the 白兵, if this is a new input (not the second click of
    // a double click, not a press from before the question); another enemy beside him is asked about instead; another of ours is
    // selected; anything else puts the question away and strikes no one.
    if (st.strike && st.sel) {
      const s = st.strike;
      if (s.entering) return;
      if (u && u === s.t) return commitAttack(e);
      if (u && attackable(st.sel, u)) return fresh(e, { pick: true }) ? askAttack(u, s.from) : undefined;
      if (u && u.side === human && u !== st.sel) return select(u);
      st.strike = null; st.ask = null; st.peek = u && u.side !== human ? u : null; return showOptions();
    }
    // The 攻击 command's list of the enemies beside him is open: one of them is asked about; anything else puts the list away.
    if (st.atkList && st.sel) {
      if (u && attackable(st.sel, u)) return fresh(e, { pick: true }) ? askAttack(u, 'list') : undefined;
      st.atkList = false;
      if (u && u.side === human && u !== st.sel) return select(u);
      return showOptions();
    }
    // A target is picked and the cast waits for its confirmation: the same target again casts, if this is a new input (not the
    // second click of a double click, not a press from before); another target is asked about instead; another of ours is selected.
    // Anything else leaves the question as it stands.
    if (st.confirm && st.sel) {
      const c = st.confirm;
      if (u && c.t === u) return commitCast(e);
      if (u && c.t && field.legal(c.u, c.id, u)) return fresh(e, { pick: true }) ? askCast(c.u, c.id, u) : undefined;
      if (u && u.side === human && u !== c.u) { st.cast = null; return select(u); }
      return;
    }
    // Choosing a 计略's target: a purple cell asks to cast; anything else keeps the choice open (an enemy shows
    // his particulars, an empty cell only clears them). The caster himself, Esc or a right click backs out;
    // another of ours is selected instead.
    if (st.cast != null && st.sel) {
      const id = st.cast, caster = st.sel;
      if (u && field.legal(caster, id, u)) { if (!fresh(e, { pick: true })) return; st.peek = null; return askCast(caster, id, u); }
      if (u === caster) return cancel();
      if (u && u.side === human) { st.cast = null; return select(u); }
      st.peek = u ?? null;
      return showOptions();
    }
    if (u && u.side === human) return select(u);
    // An enemy is looked at, never struck by the click itself: with one of ours selected he is peeked (the
    // 攻击 prompt beside him when he is in reach), otherwise he is selected for his particulars.
    // One beside him he may strike is asked about (the 攻击 confirmation in the panel); a second click on him, a new one, strikes.
    if (u && st.sel && st.sel.side === human && !st.sel.gone) {
      if (attackable(st.sel, u)) return fresh(e, { pick: true }) ? askAttack(u, 'map') : undefined;
      st.peek = u; return showOptions();
    }
    if (u) { st.sel = u; st.peek = null; return showOptions(); }
    if (st.peek) { st.peek = null; return showOptions(); } // the first click off him only puts the prompt away
    const s = st.sel;
    if (!s || s.side !== human || !st.reach?.dist.has(x + ',' + y)) { select(null); return; }
    const spent = st.reach.dist.get(x + ',' + y), path = field.path(st.reach, x, y);
    // Phone: a finger covers the cell it taps, so the first tap only shows the route and what it costs (as a mouse's hover does);
    // the same cell again, or 确认移动 on his card, moves him. Another gold cell asks about that one instead.
    if (PHONE && !(asked && asked.x === x && asked.y === y)) { st.moveAsk = { x, y, spent }; st.hoverCell = { x, y }; st.through = null; hot(st.hoverCell); showOptions(); return; }
    wv.lock(); for (const [px, py] of path) mark(px, py, 'path');
    st.last = { u: s, x: s.x, y: s.y, spent, path, heading: views.get(s).heading.clone() };
    field.move(s, x, y, spent); hud();
    await wv.moveAlong(s, path);
    if (field.lastAmbush) { const amb = field.lastAmbush; ui.log(`<em>中了${name(amb.by.id)}的十面埋伏！损兵 ${amb.damage}</em>`); audio.sfx('sfx-clash'); STRATEGY_FX.encircle(scene, views.get(s).g.position.clone().setY(1)); wv.tag(s); field.lastAmbush = null; await ui.stratResult?.('十面埋伏', `遭到敌方伏兵奇袭，士兵减少了 ${amb.damage} 人。`, s.id, 'grief'); await wv.tellLevelUps(); }
    st.busy = false; showOptions(); wv.check();
  }
  // 攻击 (D32 §6): the command lists the enemies beside him (straight to the question when there is one); a click on one of them
  // asks too. Nothing is spent and nothing drawn until the question is answered.
  function openAttacks() {
    const u = st.sel, l = attackTargets(u); if (!l.length || st.busy) return;
    st.peek = null; st.menu = false;
    if (l.length === 1) return askAttack(l[0], 'cmds');
    st.atkList = true; stage(); showOptions();
  }
  function askAttack(t, from) {
    clearPreview(); st.strike = { a: st.sel, t, from }; st.ask = t; st.peek = null; st.atkList = false; stage(); showOptions();
    keepInView(t);
  }
  // The answer (进入白兵战, Enter, the same enemy again, the pad's confirm): a new input only (src/commitguard.js), checked again
  // against the board; once given it is locked in, spent once, and cannot be taken back (the original has no way back from the
  // formation screen, research/rules.md §2).
  async function commitAttack(e) {
    const s = st.strike;
    if (!s || s.entering || st.busy || field.over || !fresh(e)) return;
    const a = st.sel;
    if (a !== s.a || !attackable(a, s.t)) { ui.log(`<em>无法攻击${name(s.t.id)}</em>`); st.strike = null; st.ask = null; return showOptions(); }
    s.entering = true; wv.lock(); st.last = null;
    const res = field.attack(a, s.t);
    await wv.playAttack(a, s.t, res); hud();
    st.strike = null; st.ask = null;
    st.busy = false; if (a.gone || a.side !== human) st.sel = null; showOptions(); stage(); wv.check(); // back on the map: the input that closed the report acts on nothing here (D32 §9.3)
  }
  // Esc / right click / 取消: puts away the 攻击 prompt, else leaves the 计略 target choice, else lets go of the selected
  // general, so his commands and card are put away (feedback R05, 2026-11-02). Spends nothing.
  // Each step goes back one (D32 §5): the confirmation to its target, the target choice to the 计略 list (十面埋伏, which has no
  // target, from its confirmation), the list to his commands.
  function dropMoveAsk() { st.moveAsk = null; st.hoverCell = null; hot(null); }
  function cancel() {
    if (st.busy || st.deploying) return false;
    if (st.moveAsk) { dropMoveAsk(); showOptions(); return true; }
    if (st.strike) { if (st.strike.entering) return false; const from = st.strike.from; st.strike = null; st.ask = null; st.atkList = from === 'list'; stage(); showOptions(); return true; }
    if (st.atkList) { st.atkList = false; showOptions(); return true; }
    if (st.peek) { st.peek = null; showOptions(); return true; }
    if (st.confirm) { const c = st.confirm; st.confirm = null; st.ask = null; if (!c.t) { st.cast = null; st.menu = true; } stage(); showOptions(); return true; }
    if (st.cast != null) { const id = st.cast; st.cast = null; st.menu = true; st.chosen = id; st.hoverCell = null; st.through = null; cursor.visible = false; ui.log(`取消${STRATS[id].name}`); showOptions(); return true; } // the list's row may have pointed at a target: his card goes with it
    if (st.menu) { st.menu = false; showOptions(); return true; }
    if (st.sel) { st.sel = null; showOptions(); return true; }
    return false;
  }
  // 计略: the list of his 计略 opens in the action panel (app.js warUnit); Esc, or a click on the map, puts it away.
  function openStrategies() {
    const u = st.sel; if (!u || u.gone || u.side !== human || st.busy || field.turn !== human || field.over) return;
    st.peek = null; st.menu = true; st.chosen = null; stage(); showOptions();
  }
  function chooseStrategy(id) {
    const u = st.sel; if (!u || st.busy || field.turn !== human) return;
    st.menu = false;
    if (!castable(u, id)) return refuse(u, id);
    if (id === 11) return askCast(u, 11, null);
    st.cast = id; st.peek = null; st.confirm = null; st.ask = null; frameCast(u, id); stage(); showOptions(); ui.log(`选择${STRATS[id].name}的目标（紫色格或名单${document.body.dataset.input === 'pad' || PHONE ? '' : '；Esc 或右键返回'}）`); // (on a pad the panel's 返回 shows its button)
  }
  // 再施: the 计略 the selected general cast last, again; its target is chosen and confirmed as for any other.
  function recast() { const l = recastOf(st.sel); if (l) chooseStrategy(l.id); }
  // The player's 计略 is confirmed before it is cast (the original's confirmation step): the 计略, its target,
  // the hit chance and the mobility it costs. The field is held while asking; 取消 spends nothing and goes
  // back to choosing a target for the same 计略 (十面埋伏, which has none, back to the unit's options).
  function refuse(u, id) {
    st.cast = null;
    ui.log(field.pool[human] < STRATS[id].cost ? `机动力不足，无法施展${STRATS[id].name}（需 ${STRATS[id].cost}，剩 ${field.pool[human]}）` : `${name(u.id)}现在无法施展${STRATS[id].name}`);
    showOptions();
  }
  // A target picked (t null for 十面埋伏): the action panel states the cast and asks for it (D32 §4–5). Nothing is spent until
  // commitCast; a picked target is only looked at. The question is a step of its own (stage), so the input that picked the
  // target, held or clicked again at once, does not answer it.
  function askCast(u, id, t) {
    if (st.busy) return;
    if (!field.canCast(u, id, t)) return refuse(u, id);
    clearPreview(); st.confirm = { u, id, t, n: 1 }; st.ask = t; st.peek = null; stage(); showOptions();
    if (t) keepInView(t);
  }
  // The cast, on the panel's 确认, Enter, the pad's confirm or a second click on the same target. It goes ahead only on a new
  // input (src/commitguard.js) and if the 计略 can still be cast on that same target; otherwise nothing is spent.
  function commitCast(e) {
    const c = st.confirm; if (!c || st.busy || field.over || field.turn !== human) return false;
    if (!fresh(e)) return false;
    st.confirm = null; st.ask = null; st.cast = null;
    if (c.u.gone || !field.canCast(c.u, c.id, c.t)) { refuse(c.u, c.id); return false; }
    wv.castOn(c.u, c.id, c.t, Math.min(c.n ?? 1, runMax(c.id)));
    return true;
  }
  // Undo rides back along the same route, a little quicker than the way out, facing the way he rides, and stands as he stood before.
  async function undo() {
    const l = st.last; if (!l || st.busy || st.confirm || st.strike || field.turn !== human) return;
    l.u.x = l.x; l.u.y = l.y; field.pool[human] += l.spent; st.last = null;
    ui.log(`撤销 ${name(l.u.id)} 的移动，退还机动力 ${l.spent}`); hud();
    wv.lock();
    await wv.moveAlong(l.u, [...l.path.slice(0, -1).reverse(), [l.x, l.y]], { perCell: 100, face: l.heading });
    st.busy = false; select(l.u);
  }
  // The 退却 dialog holds the field (hold) while it asks for the city on the strategy map, then passes the
  // unit it was opened for: whatever is selected by then, and whether the move is still legal, is checked
  // here rather than trusted.
  function retreat(city, u = st.sel, { held = false } = {}) {
    if (!u || u.gone || u.side !== human || (st.busy && !held) || field.over || field.turn !== human || !field.retreatTargets(u).includes(city)) return false;
    field.retreat(u, city); ui.log(`${name(u.id)} 退往${cityName(city)}`); removeGone(); st.sel = null; showOptions(); hud(); wv.check();
    return true;
  }
  // Lock or release every field action (selection, moves, undo, end of day) while a dialog runs.
  function hold(on) { st.busy = on; if (on) clearPreview(); }
  // `held`: called from the shop dialog, which holds the field itself while it is open.
  function shop(u, eq, { held = false } = {}) {
    if (!u || u.gone || u.side !== human || (st.busy && !held) || field.over || field.turn !== human) return;
    const before = genericArt('', field.O(u.id).weapon), res = field.buyEquip(u, eq);
    ui.log(res.ok ? res.msg : `${name(u.id)}：${res.msg}`);
    // A general riding as the generic one takes up the look of the new weapon's class at once (core/pack.js genericArt, war/units.js).
    if (res.ok && genericArt('', field.O(u.id).weapon) !== before && views.get(u)) { wv.drop(views.get(u).g); views.delete(u); wv.addUnit(u); }
    wv.tag(u); hud(); if (res.ok) st.flash = true;
    if (st.sel === u) showOptions(); st.flash = false;
  }
  function service(kind, q) {
    const u = st.sel; if (!u || u.gone || u.side !== human || st.busy || field.over || field.turn !== human) return;
    // The original takes the 50 gold from a general at full HP too and heals 0 (research/war-maps-movement-evidence.md §5);
    // the rules keep that, the view does not offer it (feedback R03, 2026-11-02).
    if (kind === 'hospital' && field.O(u.id).hp >= maxHp(field.O(u.id))) { ui.log(`${name(u.id)}体力已满，无需治疗`); return; }
    const msg = kind === 'hospital' ? field.hospital(u) : kind === 'sell' ? field.sellRice(u, q) : field.buyRice(u, q);
    ui.log(`${name(u.id)}：${msg}`); wv.tag(u); hud(); showOptions();
  }

  wv.done = undefined;
  const finished = new Promise((res) => (wv.done = res));
  return { st, hud, sideLabel, syncCompare, compareTarget, showOptions, select, attackTargets, attackRows, strikeInfo, confirmInfo, castTargets, hot, attackable, castable, recastOf, lastCast, inRect, showDeploy, deployClick, finishDeploy, clickCell, openAttacks, askAttack, commitAttack, cancel, openStrategies, chooseStrategy, recast, refuse, askCast, commitCast, runCount, undo, retreat, hold, shop, service, finished };
}
