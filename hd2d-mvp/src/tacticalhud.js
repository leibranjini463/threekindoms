// 白兵 command console and battle loop. The player commands one side of a core/tactical.js battle:
// formation, standing orders per troop type (前进/后退/待机/包围), six tactics, pause / speed / auto,
// full withdrawal, 挑发 answers and the 单挑 menu (played in its own scene, src/duelview.js). The other side follows the original AI schedule.
import { PHONE } from './phone.js';
import { h, avatar, figure, keyName } from './ui.js';
import { COMMANDS, TACTICS, FORMATIONS, KINDS } from './core/tactical.js';
import { ORIGINAL, paceSpeed } from './pace.js';
import { realChance } from './core/origrng.js';
import { stage as markStage, fresh, GUARD } from './commitguard.js'; // `stage` is runTactical's 单挑 stage below
import { zh } from './lang.js'; // 繁體: text shown through CSS attr() is not reached by lang.js's patches

// The formation each of the player's generals deployed last, and the army's last (D32 §7): the picker starts on it, so a player
// who keeps to one formation deploys with one press, as before. For this game only (app.js begin clears it).
const lastForm = new Map();
let armyForm = null;
// The sound a 单挑's end plays (null: none). A death plays the original's result phrase 113 whoever falls (bank24 $C22D, mode 13;
// 武将不战死's capture is the same fall to 0); a retreat, chased or not, plays none. Surrender, 说得 and 双方收兵 are not traced on
// the ROM and keep the remake's victory / war-start phrase.
export function duelEndSound(r, won) {
  if (r.dead != null || r.captured != null) return 'sfx-victory';
  if (r.retreated != null) return null;
  return won ? 'sfx-victory' : 'sfx-horn';
}
export function resetFormations() { lastForm.clear(); armyForm = null; }

const KIND_NAME = { gen: '将', cav: '骑', arc: '弓', inf: '步' };
const CMD_ICON = { advance: '▶', retreat: '◀', wait: '■', surround: '◎' };
// One-character order names for the compact console (the full name is in each button's tooltip).
const CMD_SHORT = { advance: '进', retreat: '退', wait: '待', surround: '围' };
const TACTIC_TIP = {
  bind: '使敌将暂时无法移动（50%）', taunt: '邀敌将单挑', xbow: '弓兵射程增至6格（3回合）',
  morale: '提升士兵攻击（4回合）', fire: '弓兵远射威力提升（3回合）', blast: '将领朝所面方向投掷炸弹，落在前方第2格，3×3范围伤害（向哪走就面向哪）',
};
// The tactic badges (暴力倾向@devblog, 2026-11-13): the character each running effect wears on the field's tags (tacticalview.js
// FX_CHAR), on the cards and on the tactic buttons, and what it does to the side it works on.
const FX_INFO = { bind: ['缚', '被咒缚', '将领无法移动，仍可攻击相邻之敌'], xbow: ['弩', '强弩', '弓兵射程增至6格'], fire: ['火', '火矢', '弓兵远射威力提升'], morale: ['气', '士气向上', '全军攻击提升'] };
// One troop type's mark, the same in a formation's picture and in the picker's legend: 步 a disc, 弓 a triangle, 骑 a diamond.
const kindMark = (k, cx, cy, r) => k === 'arc' ? `<path class="k-arc" d="M${cx} ${cy - r * 1.2}L${cx + r * 1.15} ${cy + r * 0.85}L${cx - r * 1.15} ${cy + r * 0.85}Z"/>`
  : k === 'cav' ? `<path class="k-cav" d="M${cx} ${cy - r * 1.3}L${cx + r * 1.3} ${cy}L${cx} ${cy + r * 1.3}L${cx - r * 1.3} ${cy}Z"/>` : `<circle class="k-${k}" cx="${cx}" cy="${cy}" r="${r}"/>`;
// A formation's picture from the original coordinate tables, as this general would stand in it (暴力倾向@devblog, 2026-11-13): each squad
// he really has in its troop type's mark (kinds[idx], from the deployed battle), a place he has no squad for as a faint ring, and the
// defender's on his own side of the field (the table's third column), facing left.
function formationSvg(f, kinds, side) {
  const pts = f.map(([ax, y, dx], i) => { const cx = 8 + (side === 'a' ? ax : dx - 9) * 16, cy = 8 + y * 9;
    return i === 0 ? `<circle class="gn" cx="${cx}" cy="${cy}" r="5.6"/>` : kinds[i] ? kindMark(kinds[i], cx, cy, 3.8) : `<circle class="none" cx="${cx}" cy="${cy}" r="3"/>`; }).join('');
  return `<svg viewBox="0 0 112 96" aria-hidden="true">${pts}</svg>`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// warm: run once the field is first laid, before anything shows on it (app.js: its shaders compile while the cut-in covers it).
export async function runTactical({ battle, hs, looks, troopLooks = {}, view, duel: stage, audio, face, name, D, banner, message, profiles = null, warm = null }) {
  const S = battle.side[hs], E = S.foe, es = hs === 'a' ? 'd' : 'a';
  const root = h('div', { class: 'tq', 'data-side': looks[hs] });
  document.body.append(root);
  // The battle opens paused: orders and tactics (定身 first, say) can be set before anything moves, and
  // nothing advances until the player starts it (开始交战, ▶ 继续 or Space).
  let paused = true, auto = false, speed = paceSpeed(), wake = null, queued = null, casting = false; // queued: tactic the loop plays next; casting: ours is playing
  // The 白兵 plays at half the rate its button reads: the player found the old 0.5× right for 1× and the old 1×
  // for 2× (playtest, 2026-10-29), so 1× is twice the 480-frame round measured in the original.
  const rate = () => speed / 2;
  view.setSpeed(rate()); // starts at the 游戏速度 (src/pace.js); the 0.5×–4× buttons change it for this battle
  const resume = () => { const w = wake; wake = null; w?.(); };
  let opening = null; // the 开始交战 prompt while the opening pause holds
  let pauseClock = () => {}; // the round pace's stopwatch (set by the loop)
  // The one way into the fight from the opening pause (开始交战, ▶ 继续, Space, the pad's Start): a new input, after the prompt came up.
  // Until then (the 白兵战 开始 banner included, before the prompt is up) ▶ 继续 and the pad's Start do nothing.
  let begun = false;
  const begin = (e) => { if (!opening || !fresh(e)) return; begun = true; setPaused(false); };
  const setPaused = (on) => { if (on !== paused) pauseClock(on); paused = on; if (!on) { opening?.remove(); opening = null; resume(); } detail(); drawConsole(); };
  // Each squad's exact strength shows on its bar while the battle is paused (and while Alt is held, app.js).
  const detail = () => document.body.classList.toggle('tq-detail', paused);

  // 资料 (feedback R09, 2026-11-02): both generals' particulars with this battle's 体力 and soldiers. The attacker's sheet is on
  // the left and the defender's on the right, as their cards, troops and 单挑 riders stand on the screen (ours first put a
  // defending player's own sheet under the foe's plate: 暴力倾向@devblog, 2026-11-13); each sheet says whose it is. The battle
  // holds while it is open and goes on as it was (paused or not) once it is closed; nothing is spent.
  let looking = false;
  const showProfiles = async (hp = (s) => battle.side[s].hp) => {
    if (!profiles || looking) return;
    looking = true; const was = paused; setPaused(true);
    try { await profiles(['a', 'd'].map((s) => ({ id: battle.side[s].id, hp: hp(s), soldiers: battle.troops(s), side: s, mine: s === hs }))); } finally { looking = false; setPaused(was); }
  };

  let log0 = null; // a line for the log once it is up (the castle's formation, which is not chosen)
  // ---------- Formation ----------
  // The field is deployed first so the picker sits over the live diorama; redeployed after the choice.
  // ownOnly: while the formation is being chosen only our men stand on the field, as the original shows none of
  // the enemy's until both are chosen (analysis/runtime/skirmish-natural/skirmish-entry.png); pointing at a
  // formation lines ours up in it. The field stays laid, so only the men are made again (tacticalview sameField).
  const redeploy = (ownOnly = false) => {
    battle.units = []; battle.deploy();
    if (ownOnly) battle.units = battle.units.filter((u) => u.side === hs);
    view.build(battle, looks, troopLooks);
  };
  const choosing = !(hs === 'd' && battle.castleDef);
  // Picked, pointed at and deployed are three things (D32 §7): pointing at a card (the pointer, the keys' or the pad's focus) lines
  // ours up in it to look at; a click or the confirm key picks it; only 部署 deploys, and it deploys the picked one, never one only
  // pointed at. The picker opens on the formation he (else the army) deployed last, 长蛇 the first time.
  let selected = choosing ? lastForm.get(S.id) ?? armyForm ?? 0 : 0;
  S.formation = selected;
  redeploy(choosing);
  await warm?.();
  if (choosing) {
    // The squads this general fields and each one's troop type (the split is the same in every formation: core/tactical.js deploy()).
    const kinds = []; for (const u of battle.units) if (u.side === hs && u.kind !== 'gen') kinds[u.idx] = u.kind;
    const count = (k) => kinds.filter((x) => x === k).length;
    let framePick = () => {}; // fits the field between the picker's two bands
    let shown = selected, note = () => {}; // note: what is picked and what is only looked at, set once the picker is made
    const look = (i) => { if (i === shown) return; shown = i; S.formation = i; redeploy(true); note(); };
    S.formation = await new Promise((resolve) => {
      const duelist = (X, cls) => h('div', { class: `tq-vs-side ${cls}` }, figure(X.id), h('b', {}, name(X.id)), h('span', {}, `兵 ${X.o.soldiers}　武 ${X.o.war}　智 ${X.o.int}`));
      const cards = FORMATIONS.map((n, i) => h('button', { class: 'tq-form', 'aria-pressed': 'false', onmouseenter: () => look(i), onfocus: () => look(i),
        onclick: (e) => { if (fresh(e, { pick: true })) choose(i); },
        // From the keys: Enter on another card picks it (the click above); a new Enter on the picked one deploys it (held: refused).
        onkeydown: (e) => { if (e.key === 'Enter' && !e.fromPad && i === selected) { e.preventDefault(); go(e); } } }, // the pad's A comes as an Enter too: it only picks, X deploys
        h('i', { class: 'tq-picked' }, '已选'),
        h('div', { class: 'tq-form-svg', html: formationSvg(D.formations[i], kinds, hs) }), h('b', {}, n),
        h('small', {}, ['横列绵长，可左右绕袭，中央较薄', '两翼前出，包抄敌阵', '尖锋突进，正面冲击力强', '层层叠阵，正面坚守'][i])));
      const peek = h('p', { class: 'tq-peeknote' });
      const go = (e) => {
        if (!fresh(e) || pick.classList.contains('out')) return;
        lastForm.set(S.id, selected); armyForm = selected;
        removeEventListener('resize', framePick);
        pick.classList.add('out'); setTimeout(() => { pick.remove(); resolve(selected); }, 260);
      };
      const deploy = h('button', { class: 'tq-btn primary tq-deploy arming', 'data-pad': 'x', onclick: go });
      note = () => {
        cards.forEach((c, i) => { c.classList.toggle('on', i === selected); c.classList.toggle('peek', i === shown && i !== selected); c.setAttribute('aria-pressed', String(i === selected)); });
        const keys = document.body.dataset.input !== 'pad'; // the pad's 部署 shows its button
        peek.textContent = shown !== selected ? `预览：${FORMATIONS[shown]}（未选；点击或按确认键选中）` : `已选：${FORMATIONS[selected]}${keys ? '（在卡上再按 Enter 即部署）' : ''}`;
        deploy.replaceChildren(`部署${FORMATIONS[selected]}阵`, h('kbd', { class: 'pad-only' }));
      };
      const choose = (i) => { selected = i; look(i); note(); };
      // The pointer leaving the cards shows the picked one again.
      const forms = h('div', { class: 'tq-forms', onmouseleave: () => look(selected) }, ...cards);
      // The field is the picture to choose by (暴力倾向@devblog, 2026-11-13): the title keeps to a band at the top and the cards to one at
      // the bottom, nothing darkens or blurs the ground between, and the camera fits the board into that gap (framePick), so every
      // squad and its troop chip shows as the pointed-at formation lines them up. The legend names the marks the cards draw.
      const legend = h('div', { class: 'tq-kinds', 'aria-label': '我军编成' }, h('span', { class: 'gn' }, h('i', { html: '<svg viewBox="0 0 12 12"><circle class="gn" cx="6" cy="6" r="4.6"/></svg>' }), '将'),
        ...[['inf', '步兵'], ['arc', '弓兵'], ['cav', '骑兵']].filter(([k]) => count(k)).map(([k, n]) => h('span', {}, h('i', { html: `<svg viewBox="0 0 12 12">${kindMark(k, 6, 6, 3.8)}</svg>` }), `${n} ×${count(k)}`)));
      const head = h('div', { class: 'tq-form-head' }, h('div', { class: 'tq-kicker' }, '白兵战 · 布阵'), h('h2', {}, '选择阵形'),
        h('p', { class: 'tq-sub' }, `${name(S.id)} 率兵 ${S.o.soldiers}，迎战 ${name(E.id)}（${E.o.soldiers}）`));
      const foot = h('div', { class: 'tq-form-foot' }, legend, forms, h('div', { class: 'tq-deploybar' }, peek, deploy));
      const pick = h('div', { class: 'tq-formation' },
        duelist(S, `me ${hs === 'a' ? 'l' : 'r'} ${looks[hs]}`), duelist(E, `foe ${es === 'a' ? 'l' : 'r'} ${looks[es]}`), head, foot);
      framePick = () => { if (pick.isConnected) view.setInsets?.(head.getBoundingClientRect().bottom + 6, Math.max(0, innerHeight - foot.getBoundingClientRect().top + 6)); };
      note();
      root.append(pick);
      framePick(); setTimeout(framePick, 600); addEventListener('resize', framePick); // again once the bands have risen in
      markStage(); // a click, key or press that brought the picker up does not pick or deploy here
      setTimeout(() => deploy.classList.remove('arming'), GUARD);
      cards[selected].focus({ preventScroll: true });
    });
  } else {
    S.formation = 0;
    log0 = `${name(S.id)}守城，用城池阵`;
  }
  redeploy();
  battle.aiCommands(es); battle.aiTactic(es);

  // ---------- Console ----------
  const top = h('div', { class: 'tq-top' }), con = h('div', { class: 'tq-console' }), feed = h('div', { class: 'tq-feed' });
  root.append(top, con, feed);
  // 体力 with the capture gate marked on it (playtest of 2026-10-31): under the line, from round 4, two squads
  // alongside may take the general, so the player knows when to switch to 围 instead of striking him dead.
  const hpBar = (s, X, mine) => {
    // once his fate is settled (slain, taken, or gone over his edge) the card says so instead of the capture hint
    const gu = battle.gen(s), fate = X.fate === 'dead' ? '阵亡' : X.fate === 'captured' ? '被俘' : X.fate === 'defected' ? '归降' : gu?.out ? '撤出' : null;
    const gate = battle.captureGate(s), low = !fate && gate != null && X.hp < gate;
    return h('div', { class: `tq-bar hp ${low ? 'low' : ''}`, style: gate != null ? `--gate:${gate}%` : null,
      title: gate == null ? '体力（忠诚 100，宁死不降）' : `体力：低于 ${gate} 时，第4回合起被两部以上相邻包围可能被擒` },
    h('i', { style: { width: `${Math.max(0, X.hp)}%` } }), gate != null ? h('b', { class: 'gate' }) : null,
    h('span', {}, `体 ${X.hp}`, fate ? h('em', {}, `　${fate}`) : low ? h('em', {}, mine ? '　可能被擒' : '　可擒') : gate == null && !mine ? h('em', {}, '　不降') : null));
  };
  let toldCapture = false, fxHold = null; // fxHold: the effects as they stood before our cast, shown until its performance has told the outcome
  const card = (s) => {
    const X = battle.side[s], troops = battle.troops(s), mine = s === hs;
    return h('div', { class: `tq-card ${mine ? 'me' : 'foe'} ${s === 'a' ? 'l' : 'r'} ${looks[s]}` },
      profiles ? h('button', { class: 'tq-face', title: '资料：双方武将的详细能力与装备', 'aria-label': `${name(X.id)}的资料`, onclick: () => showProfiles() }, avatar(X.id)) : h('div', { class: 'tq-face' }, avatar(X.id)),
      h('div', { class: 'tq-info' },
        h('div', { class: 'tq-name' }, name(X.id), h('small', {}, `${X.o.army}军 · Lv${X.o.level}`)),
        hpBar(s, X, mine),
        h('div', { class: 'tq-bar tr', title: '兵数' }, h('i', { style: { width: `${Math.min(100, troops / 10)}%` } }), h('span', {}, `兵 ${troops}`)),
        h('div', { class: 'tq-tp', title: '战术点' }, ...Array.from({ length: Math.max(X.tp, 0) }, () => h('i')), h('em', {}, `战术 ${X.tp}`)),
        // what works on this general's side (core/tactical.js effects()): a foe's 咒缚 shows on the bound one's card, not the caster's
        h('div', { class: 'tq-fx' }, ...(fxHold?.[s] ?? battle.effects(s)).map((e) => h('span', { class: `fx-${e.id} ${e.bad ? 'bad' : ''}`, title: `${FX_INFO[e.id][2]}（还剩 ${e.n} 回合）` }, h('b', {}, FX_INFO[e.id][0]), `${FX_INFO[e.id][1]} ${e.n}回合`)))));
  };
  // The cards stand over their own troops, as in the original: the attacker's on the left, the defender's on the right.
  const drawTop = () => top.replaceChildren(card('a'),
    h('div', { class: 'tq-round' }, h('small', {}, '回合'), h('b', {}, battle.round), h('em', {}, ['林', '沙', '平原', '河', '山', '城'][battle.terrain] + '战')),
    card('d'));
  let armed = null, armT = 0, aiming = false;
  // Phone: the orders and the tactics stand folded in two narrow strips by the screen's edges (o0無名0o@bilibili: the open
  // panels hid our own lines). A troop type shows only its standing order; a tap on it unfolds its four orders beside it,
  // and a choice folds it again. 全军 and 战术 unfold the same way. One is open at a time; it folds by itself after a while.
  let open = null, openT = 0;
  const unfold = (id) => { open = id; clearTimeout(openT); if (id) openT = setTimeout(() => { if (open === id) { open = null; if (con.isConnected) drawConsole(); } }, 6000); drawConsole(); };
  const arm = (id) => { armed = id; clearTimeout(armT); armT = setTimeout(() => { if (armed === id) { armed = null; if (con.isConnected) drawConsole(); } }, 4500); drawConsole(); };
  const drawConsole = () => {
    const counts = Object.fromEntries(KINDS.map((k) => [k, battle.live.filter((u) => u.side === hs && u.kind === k).length]));
    const rows = KINDS.slice().reverse().map((k) => h('div', { class: `tq-row ${counts[k] ? '' : 'none'}${PHONE && open === k ? ' open' : ''}` },
      // (phone, unfolded: the name keeps the folded cell's place and width, so a quick second tap there folds it again and never
      // lands on an order)
      h('span', { class: 'tq-kind', onclick: PHONE ? () => unfold(null) : null }, KIND_NAME[k], h('small', {}, k === 'gen' ? '' : `×${counts[k]}`)),
      h('div', { class: 'tq-seg', role: 'radiogroup', 'aria-label': `${KIND_NAME[k]}的将令` }, ...Object.entries(COMMANDS).map(([c, label]) => h('button', {
        class: `tq-cmd ${S.cmd[k] === c ? 'on' : ''}`, role: 'radio', 'aria-checked': S.cmd[k] === c, 'aria-label': label, 'data-k': zh(KIND_NAME[k]), disabled: !counts[k] || auto,
        title: `${label}：${{ advance: '向敌将推进，遇敌即攻', retreat: '向本阵边缘撤出战场', wait: '原地待命，射程内仍会攻击', surround: '包围敌将但不攻击，第4回合起体力低的敌将可能被俘（君主不会被俘）' }[c]}`,
        onclick: () => { if (PHONE && open !== k) return void unfold(k); S.cmd[k] = c; if (PHONE) unfold(null); else drawConsole(); },
      }, h('i', {}, CMD_ICON[c]), CMD_SHORT[c])))));
    // 全军待机 / 全军包围: one press gives every troop type the order (the four segments light up to match).
    const ALL = { wait: ['全军待机', '所有兵种原地待命，射程内仍会攻击'], surround: ['全军包围', '所有兵种包围敌将但不攻击，第4回合起体力低的敌将可能被俘（君主不会被俘）'] };
    const all = h('div', { class: `tq-row tq-all${PHONE && open === 'all' ? ' open' : ''}` }, h('span', { class: 'tq-kind' }, '全军'),
      PHONE ? h('button', { class: 'tq-cmd tq-fold', 'aria-expanded': String(open === 'all'), disabled: auto || battle.over, onclick: () => unfold(open === 'all' ? null : 'all') }, '全军') : null,
      h('div', { class: 'tq-seg', role: 'group', 'aria-label': '全军的将令' }, ...Object.entries(ALL).map(([c, [label, tip]]) => h('button', {
        class: `tq-cmd tq-allcmd ${KINDS.every((k) => S.cmd[k] === c) ? 'on' : ''}`, 'data-all': c, 'aria-label': label, 'aria-pressed': String(KINDS.every((k) => S.cmd[k] === c)), disabled: auto || battle.over,
        title: `${label}：${tip}${auto ? '\n自动中，由电脑下令' : ''}`,
        onclick: () => { battle.commandAll(hs, c); log(`<em>${label}！</em>`); if (PHONE) unfold(null); else drawConsole(); },
      }, h('i', {}, CMD_ICON[c]), CMD_SHORT[c]))));
    // Phone: a tactic's first tap only says what it does and costs (a mouse reads that off the button's tooltip) and the
    // second casts it; 全军撤退 asks the same way. Either lapses after a few seconds or when another is tapped.
    const told = PHONE && armed ? (armed === 'withdraw' ? '全军撤退：各队转身退出战场。' : `${TACTICS.find((t) => t.id === armed)?.name ?? ''}：${TACTIC_TIP[armed] ?? ''}`) : null;
    // 爆炎 flies the way the general faces (D87): its 3×3 is shown on the ground while the button is pointed at, or armed on a
    // phone; facing the board's edge it has nowhere to land and would waste its points, so it waits, saying why.
    const landing = battle.blastAt?.(hs) ?? null; let blastOk = false;
    let running = null; // (phone) the tactic of ours in force, worn by the folded strip
    const tacs = TACTICS.map((t) => {
      const edge = t.id === 'blast' && !landing && !!battle.blastAt;
      const ok = S.tp >= t.cost && battle.canTactic(hs, t.id) && !edge && !auto && !battle.over && !queued && !casting && !battle.duel;
      if (t.id === 'blast') blastOk = ok;
      const aimAt = (on) => { if (t.id !== 'blast') return; aiming = on && ok; view.aim?.(aiming ? landing : null); };
      const live = battle.untold(hs, t.id) ? 0 : Math.max(0, (fxHold?.fx ?? S.fx)[t.id] || 0); // ours running: the button wears the rounds left on its corner (not before a cast under 自动 is told)
      if (live && !running) running = [t, live];
      return h('button', { class: `tq-tac ${live ? `live fx-${t.id}` : ''}${PHONE && armed === t.id ? ' armed' : ''}`, disabled: !ok, title: `${TACTIC_TIP[t.id]}\n需战术点${t.cost}${S.tp < t.cost ? `，现有${S.tp}（每场按智力×13÷100给出）` : ''}${live ? `\n生效中，还剩 ${live} 回合` : !battle.canTactic(hs, t.id) ? '\n已有战术生效中' : edge ? '\n将领面朝战场边缘，前方没有落点' : ''}`,
        onmouseenter: () => aimAt(true), onfocus: () => aimAt(true), onmouseleave: () => aimAt(false), onblur: () => aimAt(false), onclick: () => { if (queued || casting || battle.duel) return; if (PHONE && armed !== t.id) { arm(t.id); unfold('tac'); return; } armed = null; queued = t.id; if (PHONE) open = null; drawConsole(); resume(); } },
        h('b', {}, t.name), h('span', {}, t.cost), live ? h('u', { class: 'tq-tac-live', 'aria-label': `生效中，还剩 ${live} 回合` }, `${live}回合`) : null);
    });
    const fold = PHONE ? h('button', { class: `tq-tac tq-tacfold${running ? ` live fx-${running[0].id}` : ''}`, 'aria-expanded': String(open === 'tac'), title: '战术',
      onclick: () => { if (open === 'tac') armed = null; unfold(open === 'tac' ? null : 'tac'); } },
      h('b', {}, '战术'), h('span', { 'aria-label': '战术点' }, S.tp), running ? h('u', { class: 'tq-tac-live', 'aria-label': `${running[0].name}生效中，还剩 ${running[1]} 回合` }, `${running[0].name}${running[1]}`) : null) : null;
    const tactics = h('div', { class: `tq-tactics${PHONE && open === 'tac' ? ' open' : ''}` }, ...tacs, fold);
    // Two low rows (orders; tactics and controls), so the field keeps most of the screen's height.
    con.replaceChildren(
      h('div', { class: 'tq-orders' }, h('div', { class: 'tq-label' }, '将令'), ...rows, all),
      h('div', { class: 'tq-side' }, h('div', { class: 'tq-label' }, '战术'), tactics,
        h('div', { class: 'tq-ctrl' },
          h('button', { class: `tq-btn ${paused ? 'on' : ''}`, title: '暂停／继续（空格）', 'data-pad': 'start', onclick: (e) => (begun ? setPaused(!paused) : begin(e)) }, paused ? '▶ 继续' : '❚❚ 暂停', h('kbd', { class: 'pad-only' })),
          h('div', { class: 'tq-speed' }, h('kbd', { class: 'pad-only', 'data-glyph': 'lt' }), ...[0.5, 1, 2, 4].map((v) => h('button', { class: `tq-btn ${speed === v ? 'on' : ''}`, title: v < 1 ? '慢速：动画与节奏放慢一半' : null, onclick: () => { speed = v; view.setSpeed(rate()); drawConsole(); } }, `${v}×`)), h('kbd', { class: 'pad-only', 'data-glyph': 'rt' })),
          h('button', { class: `tq-btn ${auto ? 'on' : ''}`, title: '由电脑按原版规则为我军下令', 'data-pad': 'y', onclick: () => { auto = !auto; if (auto) { battle.aiCommands(hs); } drawConsole(); } }, '自动', h('kbd', { class: 'pad-only' })),
          h('button', { class: `tq-btn warn${PHONE && armed === 'withdraw' ? ' armed' : ''}`, onclick: () => { if (PHONE && armed !== 'withdraw') { arm('withdraw'); return; } armed = null; battle.withdrawAll(hs); log('<em>全军撤退！</em>'); drawConsole(); } }, PHONE && armed === 'withdraw' ? '确认撤退' : '全军撤退'))),
      ...(told ? [h('div', { class: 'tq-told' }, told, h('b', {}, armed === 'withdraw' ? '　再点「确认撤退」' : '　再点一次施展'))] : []));
    // the console is drawn anew after each event: the landing follows the general, and goes once 爆炎 cannot be thrown
    view.aim?.((aiming || (PHONE && armed === 'blast')) && blastOk ? landing : null); if (!blastOk) aiming = false;
  };
  // Tell the view how much of the screen the cards and console cover so it frames the field between them.
  const frame = () => { if (root.classList.contains('dueling') || !con.isConnected) return view.setInsets?.(0, 0);
    // Phone: the orders and the tactics stand folded in narrow strips by the left and right edges: the field is framed between
    // them (the folded widths: an unfolded row or grid is a passing thing and does not move the camera), below the top 30 px
    // (the two cards stand in the top corners, clear of the lines in the middle) and above the line of controls.
    if (PHONE) {
      const low = con.querySelector('.tq-ctrl') ?? con;
      const left = Math.max(0, ...[...con.querySelectorAll('.tq-orders .tq-row:not(.open):not(.none)')].map((e) => e.getBoundingClientRect().right));
      const fold = con.querySelector('.tq-tacfold')?.getBoundingClientRect();
      return view.setInsets?.(30, Math.max(0, innerHeight - low.getBoundingClientRect().top + 2), left && left + 4, fold?.width ? innerWidth - fold.left + 4 : 0);
    }
    view.setInsets?.(top.getBoundingClientRect().bottom + 8, Math.max(0, innerHeight - con.getBoundingClientRect().top + 8)); };
  const log = (x) => { feed.prepend(h('p', { html: x })); while (feed.children.length > 7) feed.lastChild.remove(); };
  const update = () => {
    drawTop();
    const F = battle.side[es], gate = battle.captureGate(es);
    if (!toldCapture && gate != null && F.hp > 0 && F.hp < gate) {
      toldCapture = true;
      log(`<em>${name(F.id)}体力 ${F.hp}，已低于 ${gate}：各部改「围」便不再攻击他，第4回合起两部以上相邻即可能擒获</em>`);
    }
  };
  // The console stays shut until the performance ends: the rules settle at once, and 爆炎, which leaves no running effect
  // to bar a second one, could otherwise be thrown again before the first had landed (devblog #131).
  async function useTactic(id) {
    casting = true; fxHold = { a: battle.effects('a'), d: battle.effects('d'), fx: { ...S.fx } };
    try {
      const ev = battle.tactic(hs, id);
      drawConsole(); drawTop();
      await announce(ev);
    } finally { casting = false; fxHold = null; drawTop(); drawConsole(); }
  }
  async function announce(ev) {
    // Cast → effect → outcome, so the result is not given away before the performance.
    const mine = ev.side === hs;
    audio.sfx('sfx-horn');
    await banner(ev.name, mine ? '#6ab8ff' : '#ff8a70');
    await view.play({ ...ev, type: 'tactic' }, hooks);
    log(`${mine ? '我军' : '敌军'}施展 <b>${ev.name}</b>：${!ev.ok ? '失败' : ev.id === 'blast' && !ev.center ? '炸弹飞出战场，没有爆炸' : '成功'}`);
    if (!ev.ok) { audio.sfx('sfx-cancel'); await banner(`${ev.name}·失败`, '#777'); }
  }
  const hooks = {
    sfx: (k) => audio.sfx(k),
    update,
    // 追击 at the edge (core/tactical.js pursue()), worded as the original's 18:7E / 18:FA.
    pursuit: async (ev) => {
      const p = ev.pursuit, nm = name(battle.side[ev.u.side].id), mine = ev.u.side === hs;
      if (p.hit) { audio.sfx('sfx-horn'); await banner(`${nm} 遭到追击　受到 ${p.dmg} 点伤害`, mine ? '#ff8a70' : '#6ab8ff', 1300); }
      else await banner(`${nm} 撤退了`, '#a0a0a0', 900);
    },
    round: (ev) => { if (ev.withdraw && ev.withdraw !== hs) log(`<em>${name(battle.side[ev.withdraw].id)}军开始撤退</em>`); if (auto) { battle.aiCommands(hs); battle.aiTactic(hs); } drawTop(); drawConsole(); },
  };

  // ---------- Duel ----------
  async function runDuel() {
    const duel = battle.duel;
    await view.settle?.();
    audio.playBgm('bgm-duel');
    // Cut to the 单挑 scene: the field HUD steps aside and both generals ride in before the face-off panel appears.
    root.classList.add('dueling'); view.setInsets?.(0, 0);
    await stage.enter(battle, looks);
    // Face-off: a name plate with a live HP bar in each top corner keeps the diorama clear; the order console steps aside.
    // The bar is out of the officer's own 体力 cap (as the 人物志 and war-map bars are), not the 体力 he rode in with,
    // so a general already hurt in the 白兵 enters on a short bar (feedback: 书悦学英语@小红书).
    const full = Object.fromEntries([hs, es].map((s) => { const X = duel.side[s]; return [s, Math.max(D?.officers?.[X.id]?.hp || 100, X.hp, 1)]; }));
    const card = (s) => {
      const X = duel.side[s], bar = h('i'), chip = h('u'), hp = h('em'), dface = h('div', { class: 'tq-dface' }, face(X.id, '', 'calm')), dfx = h('span', { class: 'tq-dfx' });
      const el = h('div', { class: `tq-dcard ${s === hs ? 'me' : 'foe'} ${s === 'a' ? 'l' : 'r'} ${looks[s]}` },
        dface,
        h('div', { class: 'tq-dinfo' }, h('b', {}, name(X.id)), h('small', {}, `武 ${X.o.war}　智 ${X.o.int}`), h('div', { class: 'tq-dbar' }, chip, bar), h('div', { class: 'tq-dfoot' }, hp, dfx)));
      // 骂倒 on this general: the badge with the actions it still lasts (core/skirmish.js curse), beside his 体力.
      el.fx = () => { const n = duel.curse?.[s] || 0; dfx.replaceChildren(...(n > 0 ? [h('b', {}, '骂'), `被骂倒 ${n}次`] : [])); dfx.title = n > 0 ? `受骂倒：命中率减 20，被命中时伤害加三成，不能用说得、骂倒；还有 ${n} 次出手` : ''; };
      // The card shows the HP the audience has seen so far: the rules settle first, the bar moves on the
      // blow's contact event. The bright bar drops at once; the pale chip follows a beat later.
      let chipT = 0;
      el.show = (v) => { const w = `${Math.max(0, (100 * v) / full[s])}%`; bar.style.width = w; clearTimeout(chipT); chipT = setTimeout(() => (chip.style.width = w), 380); hp.textContent = `体力 ${Math.max(0, v)}`; };
      el.sync = () => el.show(X.hp);
      el.mood = (m) => { if (dface.firstChild?.dataset.mood !== m) dface.replaceChildren(face(X.id, '', m)); };
      el.hit = () => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); };
      return el;
    };
    const cards = { [hs]: card(hs), [es]: card(es) }, acts = h('div', { class: 'tq-duel-mid' }), dlog = h('div', { class: 'tq-dlog', 'aria-live': 'polite' });
    const panel = h('div', { class: 'tq-duel' }, cards.a, h('div', { class: 'tq-duel-vs' }, '单挑'), cards.d, acts); // each plate on its rider's side
    root.append(panel);
    const say = (a) => {
      const me = name(a.by), foe = name(a.by === duel.side[hs].id ? duel.side[es].id : duel.side[hs].id), mine = a.by === duel.side[hs].id;
      const verb = { attack: '攻击', feint: '牵制', desperate: '舍身', taunt: '骂倒', persuade: '说得', retreat: '退却', surrender: '降参' }[a.cmd];
      const what = a.cmd === 'surrender' ? `向${foe}投降` : a.cmd === 'taunt' ? (a.hit ? `成功，${foe}心神大乱` : '无效')
        : a.cmd === 'persuade' ? ['', '', `${foe}退出单挑`, '双方收兵', `${foe}投降`][a.out] || `${foe}不为所动`
        : a.cmd === 'retreat' ? (a.hit ? `被追击 <em>−${a.dmg}</em>` : '成功脱身')
        : a.dmg > 0 ? `${foe} <em>−${a.dmg}</em>${a.self ? `，自身 <em>−${a.self}</em>` : ''}` : `落空${a.self ? `，反噬 <em>−${a.self}</em>` : ''}`;
      dlog.prepend(h('p', { class: mine ? 'me' : 'foe', html: `<b>${me}</b> ${verb}：${what}` }));
      while (dlog.children.length > 3) dlog.lastChild.remove();
    };
    // The three blows show the chance they really have (`Duel.odds`: the original's table roll, and the 20 our own
    // 骂倒 adds to it), and the 3/10 more that 骂倒 makes each of them do (D29, 2026-11-09; 舍身 and 牵制 2026-11-14).
    const pct = (s, c) => Math.round(duel.odds(s, c)), rage = (s) => (duel.cursed(s) ? h('em', { class: 'up' }, '伤害 +30%') : null);
    const hitSub = (s, c, calm, tail) => { const t = tail ? `${pct(s, c)}%${tail}` : `命中 ${pct(s, c)}%`; return [duel.cursed(s) ? h('em', { class: 'down' }, t) : calm ?? t, rage(s)]; };
    const calmPct = (s, c) => Math.round(realChance(c === 'feint' ? 100 : c === 'desperate' ? 30 : duel.hitChance(s)));
    const atkTip = (s, c) => (duel.cursed(s) ? `受骂倒：命中由 ${calmPct(s, c)}% 降为 ${pct(s, c)}%，命中后伤害加三成，还有 ${duel.curse[s]} 次出手。` : '');
    const CMDS = [['attack', '攻击', (s) => hitSub(s, 'attack')], ['feint', '牵制', (s) => hitSub(s, 'feint', '必中·1/3伤', '·1/3伤')], ['desperate', '舍身', (s) => hitSub(s, 'desperate', null, '·2倍伤')],
      ['persuade', '说得', () => '劝降对手'], ['taunt', '骂倒', () => '扰乱对手'], ['retreat', '退却', () => '撤出单挑'], ['surrender', '降参', () => '投降被俘']];
    const TIP = { attack: '按命中率出手，命中造成全额伤害', feint: '必定命中，伤害为三分之一', desperate: '约37%机会造成两倍伤害，落空则自损10–30体力',
      persuade: '按双方智德、对手忠诚与体力判定：可能退出、收兵或投降（君主不降）；被骂倒期间不能用', taunt: '成功则对手数次出手内命中下降两成、命中后伤害加三成；用过后本场不能再用（被对手骂倒后恢复），被骂倒期间不能用', retreat: '尝试撤出单挑，失败会被追击',
      surrender: '向对手投降，成为俘虏；白兵战随之败北（君主不能投降）' };
    // Why a command is unavailable this action (the original greys out the 计略 submenu while a 骂倒 counter runs).
    const blocked = (c) => (c === 'persuade' || c === 'taunt') && !duel.canScheme(hs) ? '受骂倒' : c === 'taunt' && !duel.canTaunt(hs) ? '已用过' : c === 'surrender' && !duel.canSurrender(hs) ? '君主不降' : null;
    // 降参 cannot be taken back, so it asks first; 取消 returns to the same action's menu.
    const confirmSurrender = () => new Promise((resolve) => {
      const box = h('div', { class: 'tq-ask' }, h('p', {}, `${name(duel.side[hs].id)} 向 ${name(duel.side[es].id)} 投降？`, h('br'), h('small', {}, '投降后成为俘虏，本场白兵战败北。')),
        h('div', {}, h('button', { class: 'tq-btn warn', onclick: () => { box.remove(); resolve(true); } }, '投降'), h('button', { class: 'tq-btn primary', onclick: () => { box.remove(); resolve(false); } }, '取消')));
      root.append(box);
    });
    // The 单挑 starts in the field's mode (自动 or not) and can be taken over or handed back at any time: the
    // switch only changes who picks our general's next command (playtest of 2026-10-30, T09).
    let dAuto = auto, shown = null;
    const toggle = () => h('button', { class: `tq-btn tq-dauto ${dAuto ? 'on' : ''}`, title: dAuto ? '改为亲自下令：从我方下一次出手起生效（T）' : '交给电脑按原版规则出手（T）',
      'data-pad': 'y', onclick: () => setDAuto(!dAuto) }, PHONE ? (dAuto ? '自动中·接管' : '改自动') : dAuto ? '自动中 · 接管' : '亲自指挥 · 改自动', h('kbd', {}, 'T'));
    const drawDuel = (t) => {
      shown = t;
      for (const s of [hs, es]) { cards[s].classList.toggle('turn', s === t); cards[s].fx(); } // 骂倒's counter drops as the cursed side's action starts (core/skirmish.js next())
      acts.replaceChildren(dlog, t === hs && !dAuto ? h('div', { class: 'tq-duel-acts' },
        ...CMDS.map(([c, l, sub], i) => h('button', { class: `tq-btn dcmd ${c === 'attack' ? 'primary' : ''}`, disabled: !!blocked(c), title: `${c === 'attack' || c === 'feint' || c === 'desperate' ? atkTip(hs, c) : ''}${TIP[c]}（${i + 1}）`, onclick: () => pickCmd?.(c) },
          h('span', {}, l, h('kbd', {}, i + 1)), h('small', {}, ...[blocked(c) || sub(hs)].flat()))),
        // 资料 looks and comes back to this same menu, as in the original: no action and no draw of the dice.
        profiles ? h('button', { class: 'tq-btn dcmd', title: '查看双方资料，不耗行动（8）', 'data-pad': 'x', onclick: () => showProfiles((s) => duel.side[s].hp) }, h('span', {}, '资料', h('kbd', {}, 8)), h('small', {}, '查看双方')) : null)
        : h('div', { class: 'tq-hint' }, t == null ? '' : t === hs ? '自动应战…' : `${name(duel.side[es].id)} 出手…`), toggle());
    };
    let pickCmd = null;
    // Handing over while our menu is up answers it with the AI's pick; taking over shows the menu at our next action.
    const setDAuto = (on) => { dAuto = on; if (on && pickCmd) pickCmd(duel.aiCommand(hs)); else drawDuel(shown); };
    const keys = (e) => {
      if (looking) return; // the 资料 is open: its own keys only
      const k = keyName(e);
      if (k === 't') { e.preventDefault(); return setDAuto(!dAuto); } // not A: WASD pans
      if (k === '8' && pickCmd && profiles) { e.preventDefault(); return showProfiles((s) => duel.side[s].hp); }
      const i = Number(k) - 1; if (pickCmd && CMDS[i] && !blocked(CMDS[i][0])) { e.preventDefault(); pickCmd(CMDS[i][0]); }
    };
    addEventListener('keydown', keys);
    cards[hs].sync(); cards[es].sync();
    const sideOf = (id) => (duel.side[hs].id === id ? hs : es);
    for (let t; (t = duel.next()); ) {
      drawDuel(t);
      let cmd;
      if (t === hs && dAuto) await sleep(300); // taken over during this beat: the player still gets this action
      if (t === hs && !dAuto) {
        for (;;) {
          cmd = await new Promise((r) => (pickCmd = r));
          if (cmd !== 'surrender' || dAuto) break; // handed to the AI mid-menu: its pick stands
          pickCmd = null; drawDuel(null);
          if (await confirmSurrender()) break;
          if (dAuto) { cmd = duel.aiCommand(t); break; }
          drawDuel(t);
        }
      } else { if (t !== hs) await sleep(300); cmd = duel.aiCommand(t); }
      pickCmd = null; drawDuel(null); // no input until this action and its answer have played out
      // Settle once, then let the performance reveal old → new: each card moves on its contact event.
      const before = { [hs]: duel.side[hs].hp, [es]: duel.side[es].hp };
      const act = duel.act(t, cmd);
      const after = { [hs]: duel.side[hs].hp, [es]: duel.side[es].hp };
      const shown = { ...before };
      const reveal = (id, dmg) => { const s = sideOf(id); shown[s] = Math.max(after[s], shown[s] - dmg); cards[s].show(shown[s]); if (dmg > 0) cards[s].hit(); };
      await stage.view.act(act, { hp: { [duel.side[hs].id]: after[hs], [duel.side[es].id]: after[es] }, onHit: reveal, onSelf: reveal });
      cards[hs].show(after[hs]); cards[es].show(after[es]);
      say(act);
      for (const s of [hs, es]) { cards[s].mood(duel.curse?.[s] > 0 ? 'angry' : 'calm'); cards[s].fx(); } // 原版：被骂倒计数未消时怒容
      drawTop();
    }
    removeEventListener('keydown', keys);
    drawDuel(null); await sleep(400);
    const end = battle.resolveDuel();
    const r = end.res;
    await stage.view.finish(r); // the fall (武将不战死 turns it into r.captured: core/tactical.js), the loser leaving, the winner's salute
    const won = r.winner === S.id;
    if (r.winner != null) cards[sideOf(r.winner) === hs ? es : hs].mood('grief'); // 原版败方「不甘心」用忧容
    // 原版：一方退却时，对手怒容喝止（bank 23 $BAF7，18:2A）
    if (r.retreated != null && r.winner != null) {
      cards[sideOf(r.winner)].mood('angry');
      dlog.prepend(h('p', { class: sideOf(r.winner) === hs ? 'me' : 'foe', html: `<b>${name(r.winner)}</b>：站住！临阵脱逃，卑鄙！` }));
      await sleep(900);
    }
    const outcome = r.dead != null ? `${name(r.winner)} 斩 ${name(r.dead)}` : r.captured != null ? `${name(r.winner)} 擒 ${name(r.captured)}` : r.surrendered != null ? `${name(r.surrendered)} 投降` : r.retreated != null ? `${name(r.retreated)} 败走` : r.endSkirmish ? '双方收兵' : '单挑结束';
    const endSound = duelEndSound(r, won); if (endSound) audio.sfx(endSound);
    await banner(outcome, won ? (looks[hs] === 'attacker' ? '#6ab8ff' : '#ff8a70') : '#a0a0a0');
    // 原版：斩杀特定武将或君主后，胜者得到宝物，留在单挑画面上以讯息窗告知（core/tactical.js duelLoot）；
    // the duel's last line and buttons go first, so the window is the only thing on the bottom of the frame.
    if (r.loot) {
      acts.remove();
      const e = D.equipment[r.loot.eq];
      if (sideOf(r.loot.id) === hs) audio.sfx('sfx-income');
      await message('得到宝物', `${name(r.loot.id)}<br>得到了${e.name}（${e.kind === 'weapon' ? `攻击 ${e.atk}` : `防御 ${e.dfn}`}）`, r.loot.id, sideOf(r.loot.id) === hs ? 'joy' : 'calm');
    }
    panel.remove(); root.classList.remove('dueling'); setTimeout(frame, 350);
    await stage.view.pullBack();
    await stage.exit();
    await view.play(end, hooks);
    if (r.dead != null) log(`<em>${name(r.dead)} 在单挑中阵亡</em>`);
    if (r.loot) log(`${name(r.loot.id)} 得到了${D.equipment[r.loot.eq].name}`);
    else if (r.captured != null) log(`<em>${name(r.captured)} 在单挑中被擒</em>`);
    else if (r.surrendered != null) log(`<em>${name(r.surrendered)} 投降</em>`);
    else if (r.retreated != null) log(`${name(r.retreated)} 退出单挑`);
    audio.playBgm('bgm-skirmish'); drawTop(); drawConsole();
  }
  async function answerTaunt(ev) {
    // Asked even under 自动: whether our general rides out is the player's call, never taken for them (T09).
    const yes = await new Promise((resolve) => {
      const box = h('div', { class: 'tq-ask' }, h('p', {}, `${name(battle.side[ev.side].id)} 向 ${name(S.id)} 发出挑战！`),
        h('div', {}, h('button', { class: 'tq-btn primary', onclick: () => { box.remove(); resolve(true); } }, '应战'), h('button', { class: 'tq-btn', onclick: () => { box.remove(); resolve(false); } }, '拒绝')));
      root.append(box);
    });
    const r = battle.answerTaunt(yes);
    if (!r) return;
    if (r.type === 'duel') await runDuel(); else log('拒绝了挑战');
  }

  // ---------- Loop ----------
  window.__tq = battle;
  drawTop(); drawConsole();
  // The console rises in with an animation; measure once it settles, and again on every resize.
  setTimeout(frame, 700); addEventListener('resize', frame);
  log(log0 ?? `${name(S.id)}：${FORMATIONS[S.formation]}之阵`);
  await banner('白兵战　开始', looks[hs] === 'attacker' ? '#6ab8ff' : '#ff8a70');
  if (paused) {
    opening = h('div', { class: 'tq-ask tq-start' },
      h('p', {}, '两军列阵完毕', choosing ? null : h('small', {}, `（${name(S.id)}守城，用城池阵）`), h('br'), h('small', {}, '可先下达将令、施展战术（施展战术不会开始交战），准备好后开始交战。'), h('br'), h('small', {}, (PHONE ? '暂停时可看各队兵数。' : '暂停时或按住 Alt 可看各队兵数。'))),
      h('div', {}, h('button', { class: 'tq-btn primary arming', 'data-pad': 'start', onclick: (e) => begin(e) }, '开始交战', h('kbd', {}, '空格'))));
    root.append(opening);
    markStage(); // the press that deployed, held or repeated, does not start the fight (D32 §7, §9.1)
    setTimeout(() => opening?.querySelector('.arming')?.classList.remove('arming'), GUARD);
  }
  // Space pauses / resumes outside the 单挑 (where the number keys pick commands) and any dialog.
  const spaceKey = (e) => {
    if (e.code !== 'Space' || looking || battle.over || battle.duel || root.querySelector('.tq-ask:not(.tq-start)') || e.target.closest?.('input, textarea')) return;
    e.preventDefault(); document.activeElement?.blur?.(); // a focused button would also take the Space as a click
    if (!begun) return begin(e); // before the fight: only a new press starts it
    if (!e.repeat) setPaused(!paused);
  };
  addEventListener('keydown', spaceKey);
  // Phone: held upright the game is covered by 请把手机横过来 (src/phone.css), so a fight under way stops there; the player resumes it.
  const upright = PHONE ? matchMedia('(orientation: portrait)') : null;
  const turned = () => { if (upright.matches && begun && !paused && !battle.over && !battle.duel) setPaused(true); };
  upright?.addEventListener('change', turned);
  detail();
  // The loop is the only driver of animations, tactics and duels, so a click can never start a
  // second duel or animation alongside the one already playing.
  // Round pace: the original spends 480 frames (8 s) on a round, one unit acting after another. Each round
  // gets that budget (at the current speed), shared out over the slots still queued, so a move waits its beat
  // before the next unit goes and a long clash is made up by quicker beats after it. A slot that only stands
  // (待机, 咒缚, blocked) takes no beat, so the share is spread over the part of the slots that acted in the
  // last round (no prediction of the rules, no extra dice), but no act waits longer than one act of the
  // original's round (ORIGINAL.skirmishAct): with most of the field standing, a lone mover walked a step every
  // 5.2 s at 2× (playtest of 2026-10-31, F03). A round that ends early rests one act more at most.
  // The stopwatch stops while paused, in a 单挑 or on a tactic; a beat being waited out ends at once when
  // the player pauses or queues a tactic, so no decision window is cut short.
  // The stopwatch is stopped while anything holds it (the pause, a tactic, a 单挑); overlapping holds — a
  // tactic used while paused — are taken off once.
  let roundAt = performance.now(), slots = Math.max(1, battle.queue.length), acted = 0, share = 1, holds = 0, heldAt = 0, pauseHeld = false;
  const stop = () => { if (holds++ === 0) heldAt = performance.now(); };
  const go = () => { if (--holds === 0) roundAt += performance.now() - heldAt; };
  const heldFor = () => (holds ? performance.now() - heldAt : 0);
  pauseClock = (on) => { if (on === pauseHeld) return; pauseHeld = on; on ? stop() : go(); };
  if (paused) pauseClock(true);
  const off = async (p) => { stop(); try { await p; } finally { go(); } };
  const beatWait = async (ms) => { const end = performance.now() + ms; while (!paused && !queued && !battle.over && performance.now() < end) await sleep(Math.min(30, end - performance.now())); };
  while (!battle.over) {
    if (battle.duel) { await off(runDuel()); continue; }
    if (queued) { const id = queued; queued = null; await off(useTactic(id)); continue; }
    if (paused) { await new Promise((r) => (wake = r)); continue; }
    const ev = battle.step();
    if (ev?.type === 'tactic') { await off((async () => { await announce(ev); if (ev.ask) await answerTaunt(ev); })()); drawTop(); drawConsole(); continue; }
    if (battle.duel) { if (ev) await view.play(ev, hooks); await off(runDuel()); continue; }
    if (!ev) { if (battle.awaitTaunt) await off(answerTaunt({ side: battle.awaitTaunt })); continue; }
    const t0 = performance.now(), budget = ORIGINAL.skirmishRound / rate(), left = battle.queue.length + 1;
    await view.play(ev, hooks);
    if (ev.type === 'round') {
      const rest = Math.min(ORIGINAL.skirmishAct / rate(), budget - (performance.now() - roundAt - heldFor()));
      if (rest > 0) await beatWait(rest);
      share = Math.max(0.2, acted / slots); acted = 0;
      roundAt = performance.now(); if (holds) heldAt = roundAt;
      slots = Math.max(1, battle.queue.length);
    } else if (ev.type !== 'idle') {
      acted++;
      const used = t0 - roundAt;
      const beat = Math.min(ORIGINAL.skirmishAct / rate(), Math.max(0, (budget - used) / Math.max(1, left * share)));
      const wait = t0 + beat - performance.now();
      if (wait > 0) await beatWait(wait);
    }
    if (ev.type === 'attack' && ev.kill && ev.t.kind === 'gen') log(`<em>${name(battle.side[ev.t.side].id)} 阵亡</em>`);
    if (ev.type === 'attack' && ev.spared) log(`<em>${name(battle.side[ev.t.side].id)} 被俘</em>`);
    if (ev.type === 'exit' && ev.pursuit) {
      const p = ev.pursuit, nm = name(battle.side[ev.u.side].id);
      log(p.hit ? `${nm} 遭到追击，体力 <em>−${p.dmg}</em>（${p.from}→${p.from - p.dmg}）` : `${nm} 成功脱身，退出战场`);
      if (p.fell) log(`<em>${nm} ${p.fell === 'dead' ? '阵亡' : '被俘'}</em>`);
    }
  }
  removeEventListener('keydown', spaceKey); opening?.remove(); upright?.removeEventListener('change', turned);
  document.body.classList.remove('tq-detail');
  await view.settle?.();
  const res = battle.result();
  // ---------- Result ----------
  const why = { dead: '将领阵亡', capture: '将领被俘', defect: '将领归降', retreat: '将领撤出战场', time: '鸣金收兵', parley: '双方收兵' }[battle.over.why] || '战斗结束';
  const sum = h('div', { class: 'tq-result' }, h('div', { class: 'tq-kicker' }, '白兵战 · 结束'), h('h2', {}, why),
    h('div', { class: 'tq-res-row' }, ...['a', 'd'].map((s) => h('div', { class: `tq-res ${looks[s]}` }, h('b', {}, name(battle.side[s].id)),
      h('span', {}, `损兵 ${s === 'a' ? res.lossA : res.lossD}`), h('span', {}, `余兵 ${res[s].soldiers}　体力 ${res[s].hp}`),
      battle.side[s].pursuit ? h('span', { class: 'tq-res-note' }, battle.side[s].pursuit.hit ? `撤退遭追击　体力 −${battle.side[s].pursuit.dmg}` : '撤退时成功脱身') : null,
      res[s].fate ? h('em', {}, { dead: '阵亡', captured: '被俘', defected: '归降' }[res[s].fate]) : null))),
    h('button', { class: 'tq-btn primary', onclick: () => done?.() }, '返回战场'));
  root.append(sum);
  let done; await new Promise((r) => { done = r; setTimeout(r, auto ? 2500 : 60000); });
  root.remove(); removeEventListener('resize', frame); view.setInsets?.(0, 0);
  return res;
}
