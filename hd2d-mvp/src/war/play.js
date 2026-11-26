// The war map's play (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the march, the charge and the recoil,
// the 计略 and its show, the 升级 told, the day tick's 奇门遁甲, the win check, the AI's turn and the loop of turns.
// fx2d and endHuman are reassigned here (the flat map's effects list, the human turn's resolver): they are wv.fx2d and
// wv.endHuman, never copied; done is interact.js's, read and written as wv.done.
import * as THREE from 'three';
import { W, H, STRATS, stratCount } from '../core/field.js';
import { slash, sparkBurst, dustPuff, STRATEGY_FX, levelUp } from '../fx.js';
import { name, cityName, takeLevelUps, DEAD, factionName } from '../core/game.js';
import { playVignette } from '../vignette.js';
import { ORIGINAL, paced, hold as holdBeat } from '../pace.js';
import { stage } from '../commitguard.js';
import { tween, STRAT_SCENE, STRAT_CUE, STRAT_FX } from './shared.js';
import { castRun } from '../core/batch.js';

export function makePlay(wv) {
  const { ctx, field, audio, ui, human, scene, wx, wz, topY, terr, views, place, removeGone, drop, addUnit, FIGURE, clearMarks, view, focusOn, followPoint,
    st, hud, sideLabel, showOptions, select, lastCast, showDeploy, refuse, castable } = wv;
  // While the field plays something out, the unit panel's commands are greyed: a menu opened then would act on
  // a pool and a board that are about to change.
  const lock = () => { st.busy = true; showOptions(); };

  // A march the way grid tactics games ride it: straight from cell centre to cell centre, the corners cut by
  // a small arc so the position never jerks, and the figure turned once, at the corner, to the next leg's
  // heading (a curve through the centres swept the heading through the camera's axis at every corner, so the
  // front or back view flashed for a few frames, and a staircase route kept him swinging). Even pace with a
  // short ramp at each end. One stride (STRIDE cells, the strip's four walk frames) carries two footfalls:
  // the bob, the hoofbeat and the dust all fall on them, so nothing drifts against the legs. The picture is
  // not tilted or squashed while it rides. The camera follows the rider.
  const STRIDE = 1.6, PACE = 190, CORNER = 0.22, RAMP = 90;
  const right = new THREE.Vector3(), tan = new THREE.Vector3();
  function faceToward(v, dir) { v.heading.copy(dir).setY(0).normalize(); pose(v); }
  // Pick the facing (and walk frame) from the heading in camera space: within ~35° of the camera is the
  // three-quarter front, within ~35° of straight away the three-quarter back, otherwise the side profile;
  // leftward headings mirror the sprite. v.face is ±1 only in profile (it drives the sideways lean).
  // The flat map (src/warmap2d.js) draws the board unturned, +x to the right and +z down toward the eye, whatever
  // angle the 3D view would have had: with that angle's axes a march east was mirrored on it at two of the four.
  const toCam = new THREE.Vector3();
  function pose(v) {
    if (wv.flat) { right.set(1, 0, 0); toCam.set(0, 0, 1); }
    else { right.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw)); toCam.set(Math.sin(view.yaw), 0, Math.cos(view.yaw)); }
    const hx = v.heading.dot(right), hz = v.heading.dot(toCam), ang = Math.atan2(Math.abs(hx), hz);
    if (Math.abs(hx) > 0.08) v.flip = Math.sign(hx);
    if (!v.frames) { v.face = v.flip; v.body.scale.x = v.flip; return; }
    const row = ang < 0.6 ? 'front' : ang > 2.55 ? 'back' : 'side';
    v.face = row === 'side' ? v.flip : 0; v.body.scale.x = v.flip;
    // One stride per STRIDE cells: the generic sheets walk stand → walk_1..3, the star officers' strips walk_1..4.
    const gait = v.frames.includes(`${row}_walk_4`) ? ['walk_1', 'walk_2', 'walk_3', 'walk_4'] : ['stand', 'walk_1', 'walk_2', 'walk_3'];
    const col = v.walk ? gait[Math.floor(v.stride / STRIDE * 4) % 4] : 'stand';
    const f = v.frames.indexOf(`${row}_${col}`);
    if (f !== v.frame) { v.frame = f; v.tex.offset.x = f / v.frames.length; v.ntex.offset.x = v.tex.offset.x; }
  }
  // perCell given: exactly that long per cell (the enemy's march keeps its own timeline). Left out: PACE per
  // cell, the cells past the fourth at 0.7 of it so a long ride doesn't drag. He ends facing the way he rode; `face`, when
  // given, turns him as he reins in ('foes': toward the enemy, as deploying does; a vector: that heading, as undo does).
  async function moveAlong(u, path, { perCell = null, follow = true, sound = true, minMs = 260, settleMs = 180, face = null } = {}) {
    const v = views.get(u);
    if (!path.length) return place(u);
    const pts = [v.g.position.clone()];
    for (const [x, y] of path) { const q = new THREE.Vector3(wx(x), topY(x, y), wz(y)); if (q.distanceTo(pts[pts.length - 1]) > 1e-3) pts.push(q); }
    if (pts.length < 2) return place(u);
    const n = path.length, legs = [], at = [0];
    for (let i = 1; i < pts.length; i++) { const dir = pts[i].clone().sub(pts[i - 1]), l = dir.length(); legs.push({ dir: dir.divideScalar(l), flat: dir.clone().setY(0).normalize(), l }); at.push(at[i - 1] + l); }
    const len = at[at.length - 1], ms = Math.max(minMs, perCell != null ? perCell * n : PACE * (n <= 4 ? n : 4 + (n - 4) * 0.7)), ramp = Math.min(RAMP, ms / 4);
    const turns = (i) => i > 0 && i < legs.length && legs[i - 1].flat.dot(legs[i].flat) < 0.99; // a corner at pts[i]
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    let beat = 1, i = 0;
    v.moving = v.walk = true; v.stride = 0;
    await tween(ms, (k) => {
      // Trapezoid pace: `ramp` ms up to speed, level, `ramp` ms down.
      const t = k * ms, run = t < ramp ? t * t / (2 * ramp) : t > ms - ramp ? ms - ramp - (ms - t) ** 2 / (2 * ramp) : t - ramp / 2;
      const dist = len * run / (ms - ramp), speed = Math.min(1, t / ramp + 0.25, (ms - t) / ramp + 0.25);
      while (i < legs.length - 1 && dist > at[i + 1]) i++;
      const leg = legs[i], s = dist - at[i];
      p.copy(pts[i]).addScaledVector(leg.dir, Math.min(s, leg.l));
      // Within the corner's reach on either side the point rides a quadratic arc past the corner cell's centre.
      const c = turns(i + 1) && leg.l - s < CORNER ? i + 1 : turns(i) && s < CORNER ? i : 0;
      if (c) {
        const q = (dist - at[c] + CORNER) / (2 * CORNER);
        a.copy(pts[c]).addScaledVector(legs[c - 1].dir, -CORNER); b.copy(pts[c]).addScaledVector(legs[c].dir, CORNER);
        p.copy(a).multiplyScalar((1 - q) ** 2).addScaledVector(pts[c], 2 * q * (1 - q)).addScaledVector(b, q * q);
      }
      v.stride = dist; faceToward(v, leg.flat);
      v.g.position.copy(p);
      v.bill.position.y = Math.abs(Math.sin(dist / STRIDE * Math.PI * 2)) * 0.045 * speed;
      if (dist >= beat * STRIDE / 2) {
        beat++;
        if (sound) audio.sfx('sfx-step');
        burst('dust', p.clone().setY(p.y + 0.08).addScaledVector(leg.flat, -0.3), { size: 0.35 });
      }
      if (follow) followPoint(p);
    });
    // Land on this path's last cell, not wherever the unit stands logically by now (later steps may be queued).
    const [ex, ey] = path[path.length - 1]; v.g.position.set(wx(ex), topY(ex, ey), wz(ey));
    // Settle: he reins in, the standing frame, one small sink onto the hooves.
    v.walk = false; v.bill.position.y = 0;
    if (face === 'foes') wv.faceFoes(u); else if (face) v.heading.copy(face);
    await tween(settleMs, (k) => { v.body.scale.y = 1 - 0.022 * Math.sin(k * Math.PI); });
    v.body.scale.y = 1; v.moving = false;
  }
  // A short charge toward the target and back before the 白兵 opens; a struck unit flashes and recoils.
  // Every effect set off in the scene (sparks, dust, slashes, each 计略's flames, rings, streaks …, src/fx.js) is
  // also listed for the flat map (src/warmap2d.js), which draws its own over the painted board.
  wv.fx2d = [];
  scene.userData.flatFx = (kind, at, o) => {
    wv.fx2d.push({ kind, x: at.x + W / 2 - 0.5, y: at.z + H / 2 - 0.5, h: at.y, ...o, t: performance.now() / 1000, seed: (Math.random() * 1e9) | 0 });
    if (wv.fx2d.length > 160) wv.fx2d.splice(0, wv.fx2d.length - 160);
  };
  function burst(kind, at, { n = 40, color = '#ffd070', size = 1 } = {}) {
    if (kind === 'spark') sparkBurst(scene, at, n, color); else if (kind === 'dust') dustPuff(scene, at, size); else slash(scene, at, false, size);
  }
  // The day's loss rises from the trapped one's own tag (a child of it, so it rides wherever declutter() lifts the tag and
  // never lands on a neighbour's), over his head; on the flat map a 'num' effect drawn under that unit's plaque. It
  // lasts 0.9 s at 1×, less at the faster paces, so it is gone before the next group.
  // A 计略's outcome rises the same way (feedback R07, 2026-11-02): `text` in place of the bare loss, held `hold` ms at 1×.
  function lossNum(u, loss, { text = `−${loss}`, hold = 900, gain = false } = {}) {
    const v = views.get(u); if (!v) return;
    const ms = paced(hold), el = Object.assign(document.createElement('div'), { className: `lossnum${gain ? ' gain' : ''}`, textContent: text });
    el.style.animationDuration = `${ms}ms`; v.el.append(el);
    setTimeout(() => el.remove(), ms);
    scene.userData.flatFx('num', v.g.position.clone().setY(FIGURE + 0.1), { text, color: gain ? '#ffd860' : '#ff6a5a', ms, u });
  }
  // 升级 (bank12 $A5FD after the player's 计略, bank13 $C6EA for both generals after a 白兵 and its 单挑, research/
  // experience-evidence.md §5): each of the player's generals who went up since the last telling, one after another.
  // The original stops the theme for phrase 123 and opens a window the player closes: 「…升级了」, with 「武力提升了N」
  // when 武力 rose; a 谋士 whose new level opens more 计略 then gets 「学会了新的计略」 (message 4B). The remake adds
  // the light on the board and the new level rising over him. Generals of the other side go up unannounced.
  async function tellLevelUps(order = []) {
    const rank = (lu) => (order.includes(lu.id) ? order.indexOf(lu.id) : order.length);
    for (const lu of takeLevelUps(field.g).sort((x, y) => rank(x) - rank(y))) {
      const u = field.units.find((x) => x.id === lu.id), v = u && views.get(u), o = field.O(lu.id);
      if (!u || u.side !== human || u.gone || o.status === DEAD) continue;
      if (v) {
        focusOn(u);
        const at = v.g.position.clone(); at.y += 0.8; levelUp(scene, at);
        tween(1100, (k) => { v.body.material.emissive.set('#ffcf70'); v.body.material.emissiveIntensity = 0.45 * Math.sin(Math.PI * Math.min(1, k * 1.6)) ** 2; })
          .then(() => { v.body.material.emissive.set('#ffffff'); v.body.material.emissiveIntensity = 0; });
        lossNum(u, 0, { text: `等级 ${lu.to}`, hold: 1800, gain: true });
        wv.tag(u);
      }
      if (!audio.cue('cue-levelup')) audio.sfx('sfx-levelup');
      if (v) await holdBeat(650); // the light first, then the window over it
      const gain = lu.war - lu.warFrom;
      ui.log(`<strong>${name(lu.id)}升至等级 ${lu.to}</strong>${gain ? `，武力 ${lu.warFrom}→${lu.war}` : ''}`);
      await ui.levelUp?.({ id: lu.id, from: lu.from, to: lu.to, warFrom: lu.warFrom, war: lu.war });
      const was = stratCount(lu.id, { ...o, level: lu.from }), now = stratCount(lu.id, o);
      if (now > was) {
        const learnt = STRATS.slice(was, now).map((S) => S.name);
        ui.log(`${name(lu.id)}学会了新的计略：${learnt.join('、')}`);
        await ui.learnStrategies?.({ id: lu.id, names: learnt });
      }
    }
  }
  // The day tick's 奇门遁甲 (field.endTurn): the trapped within four cells of the first are shown together, the view
  // framed on him, the stones flaring and each one's loss rising; 0.8 s a group, Enter moves on.
  async function qimenBeat(list) {
    const rest = list.filter((x) => views.get(x.u));
    while (rest.length) {
      const lead = rest[0].u, group = rest.filter(({ u }) => Math.max(Math.abs(u.x - lead.x), Math.abs(u.y - lead.y)) <= 4);
      for (const x of group) rest.splice(rest.indexOf(x), 1);
      if (!group.some((x) => x.loss > 0)) continue; // nothing lost here: no flare, no sound, no wait
      focusOn(lead);
      for (const { u, loss } of group) {
        const at = views.get(u).g.position.clone(); at.y += 0.8;
        STRATEGY_FX.qimen(scene, at);
        if (loss > 0) { lossNum(u, loss); ui.log(`${name(u.id)}困于石阵，折兵${loss}`); }
        wv.tag(u);
      }
      audio.sfx('sfx-clash');
      await holdBeat(800);
    }
  }
  async function lunge(a, d) {
    const v = views.get(a), from = v.g.position.clone(), dir = new THREE.Vector3(wx(d.x) - wx(a.x), 0, wz(d.y) - wz(a.y)).normalize();
    faceToward(v, dir); v.moving = true;
    await tween(170, (k) => { const e = k * k; v.g.position.copy(from).addScaledVector(dir, 0.38 * e); v.bill.rotation.z = -v.face * 0.14 * e; });
    await tween(220, (k) => { const e = 1 - (1 - k) * (1 - k); v.g.position.copy(from).addScaledVector(dir, 0.38 * (1 - e)); v.bill.rotation.z = -v.face * 0.14 * (1 - e); });
    v.g.position.copy(from); v.bill.rotation.z = 0; v.moving = false;
  }
  function recoil(t, from) {
    const v = views.get(t); if (!v) return;
    const p0 = v.g.position.clone(), dir = from ? new THREE.Vector3(wx(t.x) - wx(from.x), 0, wz(t.y) - wz(from.y)).normalize() : new THREE.Vector3();
    tween(360, (k) => { const b = Math.sin(k * Math.PI) * (1 - k * 0.5); v.g.position.copy(p0).addScaledVector(dir, 0.16 * b); v.body.material.emissiveIntensity = 0.9 * (1 - k); })
      .then(() => { if (!t.gone) place(t); v.body.material.emissiveIntensity = 0; });
  }
  async function playAttack(a, d, res) {
    ui.log(`${name(a.id)} 攻击 ${name(d.id)}`);
    await lunge(a, d);
    await ctx.onSkirmish(a, d, res, terr(d.x, d.y));
    ui.log(`　${name(d.id)} 损兵 ${res.lossD}，${name(a.id)} 损兵 ${res.lossA}`);
    for (const [u, info] of [[a, res.a], [d, res.d]]) {
      if (info.fate === 'dead') ui.log(`　<em>${name(u.id)} 阵亡</em>`);
      if (info.fate === 'captured') ui.log(`　<em>${name(u.id)} 被俘</em>`);
      // 说得 won him over: he stays where he stands under the other banner, so his figure is made again in its colours (as 倒戈)
      if (info.fate === 'defected') { ui.log(`　<em>${name(u.id)} 归降，转投${factionName(field.g, field.faction(u.side))}军</em>`); if (views.get(u)) { drop(views.get(u).g); views.delete(u); } addUnit(u); continue; }
      wv.tag(u);
    }
    if (res.duel?.retreated) ui.log(`　${name(res.duel.retreated)} 从单挑中退却`);
    removeGone();
    await tellLevelUps([a.id, d.id]); // back on the war map, attacker then defender (bank13 $C69F)
  }

  // 布阵 (6.7 §6.5): the human side may move each unit to any free cell inside its rectangle, any terrain.
  const rect = human ? (human === 'att' ? field.dep.attacker_rect : field.dep.defender_rect) : null;
  // n: times in a row from the one confirmation (羽之@devblog, 2026-11-18): src/core/batch.js castRun casts them, each the rules'
  // own cast, and they are shown as one (playRun). One time is the cast as it has always been, shown as ever.
  async function castOn(u, id, t, n = 1) {
    if (st.busy) return;
    if (!field.canCast(u, id, t)) return refuse(u, id);
    lock(); st.last = null;
    const run = castRun(field, u, id, t, n);
    lastCast.set(u, { id, t });
    await playStrategy(u, t, id, n > 1 ? run : run.steps[0]);
    // The 计略 is done and he stays selected, as after an attack (2026-11-14). While he can still cast the same 计略 on someone, he is
    // back in its target choice, the one cast on (or the likeliest) under the keys and the camera as it framed the choice: it is not
    // pulled back and pushed in again for the next (羽之@devblog, 2026-11-18). Otherwise his commands are back in his card, the view
    // as it was before the choice (showOptions → unframeCast). Esc steps back as ever; 再施 (X) still brings the choice back.
    // The input that closed the result acts on nothing here (stage()); he is let go only if he left the field or the war is over.
    st.busy = false;
    if (u.gone || field.over || field.turn !== human) st.sel = null;
    else if (id !== 11 && castable(u, id)) { st.cast = id; st.peek = null; }
    stage(); showOptions(); hud(); check();
  }
  // Several casts from one confirmation (castRun's { steps, n, stop }): the picture once (whole when any hit, else up to its attempt),
  // one window listing each time, each one struck shaken once with his losses summed over his head, every cast in the log on its
  // own lines as if cast one by one, the levels told after it all. The window stays ROW ms longer for each line past the first
  // (Enter or a click still closes it); the board keeps the original's beat after it.
  const ROW = 450;
  async function playRun(u, t, id, run) {
    const name0 = STRATS[id].name, steps = run.steps, hit = steps.some((s) => s.hit), cast = `${name(u.id)} 施展<strong>${name0}</strong>${t ? `→${name(t.id)}` : ''}`;
    ui.log(cast);
    const cue = () => { if (!audio.cue(STRAT_CUE[id])) audio.sfx('sfx-horn'); };
    const shown = await playVignette({ scene: STRAT_SCENE[id], caption: `${name(u.id)}的${name0}……`, audio, duration: paced(ORIGINAL.strategyShow), onShow: cue, part: hit ? undefined : 'attempt' });
    if (!shown) { cue(); await ui.stratBanner?.(name0); }
    const t0 = performance.now();
    // A line a time; failures in a row share one (第 2–4 次：失败). Past six lines they stand in two columns, so the longest run the
    // pool allows (15 虚兵 at 60) still fits a phone's window.
    const rows = [];
    steps.forEach((s, i) => {
      const prev = rows.at(-1);
      if (!s.hit && prev?.fail && prev.to === i) prev.to = i + 1; else rows.push(s.hit ? { text: s.lines.join('，'), from: i + 1, to: i + 1 } : { fail: true, from: i + 1, to: i + 1 });
    });
    const lines = rows.map((r) => `<span>第 ${r.from === r.to ? r.from : `${r.from}–${r.to}`} 次：${r.fail ? '失败' : r.text}</span>`);
    const tail = run.stop && steps.length < run.n ? `<em class="runstop">${run.stop.msg}，其余 ${run.n - steps.length} 次未施（机动力未扣）</em>` : '';
    const extra = ROW * (lines.length + (tail ? 1 : 0) - 1);
    const told = ui.stratResult?.(`${name0} ×${steps.length}`, `<span class="runrows${lines.length > 6 ? ' many' : ''}">${lines.join('')}</span>${tail}`, u.id, hit ? 'joy' : 'grief', { extra });
    const v = t && views.get(t);
    if (v && hit) { const at = v.g.position.clone(); at.y += 0.8; STRATEGY_FX[STRAT_FX[id]](scene, at); audio.sfx('sfx-clash'); }
    const struck = [...new Set(steps.flatMap((s) => (s.hit ? s.hits.map((h) => h.u) : [])))];
    for (const x of struck) recoil(x, u);
    // Each one's losses over the whole run, one number a kind: 兵 bare, 体 and 米 named.
    const sum = new Map();
    for (const s of steps) for (const h of s.hits) { const m = sum.get(h.u) ?? { hp: 0, rice: 0, soldiers: 0 }; m.hp -= h.hp ?? 0; m.rice -= h.rice ?? 0; m.soldiers -= h.soldiers ?? 0; sum.set(h.u, m); }
    for (const [x, m] of sum) { const l = [m.hp && `体−${m.hp}`, m.rice && `米−${m.rice}`, m.soldiers && `−${m.soldiers}`].filter(Boolean); if (l.length) lossNum(x, 0, { text: l.join('　'), hold: 1600 }); }
    steps.forEach((s, i) => { if (i) ui.log(cast); for (const l of s.lines) ui.log(`　${l}`); });
    for (const x of struck) if (views.get(x)) wv.tag(x);
    if (hit) for (const [x, vw] of views) if (!x.gone && vw.g.parent && x.stop > 0) wv.tag(x);
    if (id === 8 && t && steps.some((s) => s.hit) && views.get(t)) { drop(views.get(t).g); views.delete(t); addUnit(t); }
    await told;
    await new Promise((r) => setTimeout(r, Math.max(0, paced(ORIGINAL.strategy - ORIGINAL.strategyCast + extra) - (performance.now() - t0))));
    removeGone();
    await tellLevelUps();
  }
  async function playStrategy(u, t, id, res) {
    if (res.steps) return playRun(u, t, id, res);
    const name0 = STRATS[id].name;
    ui.log(`${name(u.id)} 施展<strong>${name0}</strong>${t ? `→${name(t.id)}` : ''}`);
    const cue = () => { if (!audio.cue(STRAT_CUE[id])) audio.sfx('sfx-horn'); }; // its phrase, then the war theme from the top (T13)
    // The player has just picked the target on the view he has and keeps it; an enemy's 计略 is shown to him (devblog #96, 2026-11-03).
    if (u.side !== human) focusOn(t || u);
    // The original's beats (src/pace.js): the cast animation names the 计略 and plays its phrase, then a window
    // tells what it did while the effect lands on the board, then the board has the rest of the 3.48 s. Without
    // the picture (演出 off) a banner stands in for the cast.
    const shown = await playVignette({ scene: STRAT_SCENE[id], caption: `${name(u.id)}的${name0}……`, audio, duration: paced(ORIGINAL.strategyShow), onShow: cue, part: res.hit ? undefined : 'attempt' }); // a 计略 that fails stops short of the outcome
    if (!shown) { cue(); await ui.stratBanner?.(name0); }
    const t0 = performance.now(); // the window and the board keep the original's time after the show, however long it ran
    // The face the original's window wears (bank 12 $AACD / $AAE5, bank 13 $C0B6 / $C0C0): the player's caster, 喜 when
    // it works and 忧 when it fails; an enemy's 计略 is told by the one it was aimed at, the other way round.
    const mine = u.side === human, who = mine ? u.id : t?.id ?? res.hits?.[0]?.u.id ?? null;
    const told = ui.stratResult?.(name0, res.hit ? res.lines.join('<br>') : mine ? '计略失败了，非常抱歉。' : `${name0}失败了。`, who, res.hit === mine ? 'joy' : 'grief');
    const v = t && views.get(t);
    if (v && res.hit) {
      const at = v.g.position.clone(); at.y += 0.8;
      STRATEGY_FX[STRAT_FX[id]](scene, at);
      audio.sfx('sfx-clash');
    }
    if (res.hit) for (const h of res.hits) recoil(h.u, u);
    // What each one lost rises over him, one line a unit (落石 takes 体力 and soldiers at once): 兵 bare, 体 and 米 named.
    const lost = new Map();
    for (const h of res.hits) if (h.hp || h.rice || h.soldiers) lost.set(h.u, [...(lost.get(h.u) ?? []), h.hp ? `体−${-h.hp}` : h.rice ? `米−${-h.rice}` : `−${-h.soldiers}`]);
    for (const [v, l] of lost) lossNum(v, 0, { text: l.join('　'), hold: 1600 });
    for (const l of res.lines) ui.log(`　${l}`);
    for (const h of res.hits) if (views.get(h.u)) wv.tag(h.u);
    if (res.hit) for (const [x, vw] of views) if (!x.gone && vw.g.parent && x.stop > 0) wv.tag(x); // 虚兵 / 连环 hold with no loss to report: their tags say so now
    if (id === 8 && res.hit && t) { drop(views.get(t).g); views.delete(t); addUnit(t); }
    await told;
    await new Promise((r) => setTimeout(r, Math.max(0, paced(ORIGINAL.strategy - ORIGINAL.strategyCast) - (performance.now() - t0))));
    removeGone();
    await tellLevelUps();
  }
  // Called after each of the player's actions has played out (a move, an attack back from the 白兵, a 计略 after its window).
  // An action that leaves the shared mobility at 0 ends his turn, as in the original (research/war-ai-evidence.md: A05E/A068
  // take 0 or less as the end of the side's turn), so he need not press 待机 with nothing left (霸王之王@devblog, 2026-11-23).
  // The 退却 and the village's shop and clinic cost nothing, but at 0 the original gives no chance for them either.
  function check() {
    if (field.over) { if (wv.done) { const d = wv.done; wv.done = null; clearMarks(); setTimeout(() => d(field.over), 900); } return; }
    if (human && field.turn === human && field.pool[human] <= 0 && wv.endHuman && !st.busy) { ui.log('机动力用尽，本日行动结束'); endTurn(); }
  }

  // The AI takes its turn one cell at a time, unit after unit (the original dispatcher, 10 frames a cell).
  // Runs of plain steps are gathered and played as one march with the camera on the group, so the camera
  // never swings between units every cell. The march keeps the rotation's own timeline: step k of the run
  // falls at k step-times, and each unit walks its cells in one smooth stroke from its first step's time to
  // its last one's, so the order stays readable and the run lasts as many step-times as it has steps.
  // A step that springs an ambush or takes the castle joins the march as its last cell and the march plays
  // out at once, so the event lands as the unit arrives. Anything else (an attack, a 计略, a retreat) first
  // plays the march so far, then itself.
  async function aiSide(s) {
    ui.log(`—— 第${field.day}日 ${sideLabel(s)}行动 ——`);
    const march = new Map(); let steps = 0; // u → { path, first, last } (step indices in the run)
    const flush = async () => {
      if (!march.size) return;
      const legs = [...march].map(([u, m]) => [u, m.path, m.first, m.last]); march.clear(); steps = 0;
      const c = legs.reduce((a, [u]) => a.add(new THREE.Vector3(wx(u.x), 0, wz(u.y))), new THREE.Vector3()).divideScalar(legs.length);
      followPoint(c);
      const T = paced(ORIGINAL.move);
      await Promise.all(legs.map(([u, path, first, last], i) => new Promise((r) => setTimeout(r, first * T))
        .then(() => moveAlong(u, path, { perCell: ((last - first + 1) * T) / path.length, minMs: T, settleMs: Math.min(180, T), follow: false, sound: i === 0 }))));
      hud();
    };
    for (const act of field.aiActions(s)) {
      if (act.type === 'move') {
        const m = march.get(act.u) || { path: [], first: steps }; m.path.push(...act.path); steps += act.path.length; m.last = steps - 1; march.set(act.u, m);
        if (!field.lastAmbush && !field.over) continue;
        await flush();
        const amb = field.lastAmbush;
        if (amb) { ui.log(`<em>${name(act.u.id)}中了${name(amb.by.id)}的十面埋伏！损兵 ${amb.damage}</em>`); audio.sfx('sfx-clash'); STRATEGY_FX.encircle(scene, views.get(act.u).g.position.clone().setY(1)); wv.tag(act.u); field.lastAmbush = null; await ui.stratResult?.('十面埋伏', `伏兵发动奇袭，敌兵减少了 ${amb.damage} 人。`, amb.by.id, 'joy'); await tellLevelUps(); }
      }
      else {
        await flush();
        if (act.type === 'attack') { focusOn(act.a); await playAttack(act.a, act.d, act.res); }
        else if (act.type === 'retreat') { ui.log(`${name(act.u.id)} 退往${cityName(act.city)}`); removeGone(); }
        else if (act.type === 'strategy') await playStrategy(act.u, act.t, act.id, act.res);
        else if (act.type === 'mission') { ui.log(`${name(act.u.id)} 进村${act.kind === 'rice' ? '买米' : '求医'}：${act.log.join('，') || '金不足'}`); wv.tag(act.u); }
      }
      hud();
      if (field.over) break;
    }
    await flush();
  }
  // Drives both sides until the war ends; the human side waits for endTurn().
  wv.endHuman = undefined;
  async function loop() {
    if (human && rect && !field.resumed) { // a suspended war taken up again (src/core/suspend.js) was deployed before it stopped
      st.deploying = true; hud(); ui.deploy?.(true);
      const first = field.side(human)[0]; if (first) { focusOn(first); st.sel = first; }
      showDeploy();
      await new Promise((res) => (wv.endDeploy = res));
      ui.deploy?.(false);
      for (const u of field.alive) wv.faceFoes(u); // both armies as they now stand (a placing ride may still be settling)
    }
    while (!field.over) {
      if (field.turn === human) {
        ui.log(`—— 第${field.day}日 ${sideLabel(human)}行动 ——`); // silent, as in the original (D43: no war-start phrase each day)
        // The camera turns to the commander but no one is selected: with him selected, a click that missed another
        // general landed on an empty cell in his reach and marched him off (player feedback, 2026-11-03).
        const first = field.side(human).find((u) => u.commander) || field.side(human)[0];
        if (first) focusOn(first);
        select(null);
        hud(); stage(); // our day begins: a key held through the enemy's turn (or a report closed on it) does not end it (src/commitguard.js)
        await new Promise((res) => (wv.endHuman = res));
        st.last = null; select(null);
      } else { st.busy = true; await aiSide(field.turn); st.busy = false; }
      if (field.over) break;
      // The day tick changes soldiers off screen (奇门遁甲's daily loss, the day's recovery): every tag is redrawn
      // from the rules, or it kept the old 兵 under a tip that told the new one (playtest of 2026-10-30).
      const tick = field.endTurn(); if (tick?.qimen.length) { st.busy = true; try { await qimenBeat(tick.qimen); await tellLevelUps(); } finally { st.busy = false; } } // the player waits it out (Enter skips)
      for (const u of field.alive) if (views.get(u)) wv.tag(u); hud();
    }
    check();
  }
  function endTurn() { if (st.busy || st.confirm || st.strike || field.turn !== human || !wv.endHuman) return; st.peek = null; const f = wv.endHuman; wv.endHuman = null; f(); }
  return { lock, faceToward, pose, moveAlong, burst, lossNum, tellLevelUps, qimenBeat, lunge, recoil, playAttack, rect, castOn, playStrategy, playRun, check, aiSide, loop, endTurn };
}
