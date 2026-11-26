// War map renderer (战争地图) for any of the 30 battlefields, driven by core/field.js.
// The human side gets move/attack/retreat/village/undo/end-turn; the AI side's actions are animated.
// The view is built by the modules under src/war/ (docs/战场3D拆分实施计划_2026-11-13.md), each from the shared object wv, in
// this order: what a module destructures from wv at build time was made by one before it and is never reassigned.
import * as THREE from 'three';
import { release } from './fx.js';
import { flatten } from './warmap2d.js';
import { updateSpriteLight } from './sprite3d.js';
import { makeBoard } from './war/board.js';
import { makeUnits } from './war/units.js';
import { makeOverlay } from './war/overlay.js';
import { makeCamera } from './war/camera.js';
import { makePick } from './war/pick.js';
import { makeInteract } from './war/interact.js';
import { makePlay } from './war/play.js';
import { makeProbe } from './war/probe.js';

// 计略演出: each 计略's framed picture and its effect on the board, by 计略 id (src/war/shared.js, played by src/war/play.js).
// Also read by tests/war.test.mjs.
export { STRAT_SCENE, STRAT_FX } from './war/shared.js';

// The module-level constants and helpers the war modules share (src/war/shared.js); the ones this file has always exported
// are exported from here as before.
export { woodsOf, tween, GREY_LIGHTS, SUN_CLEAR, SUN_K, keySun } from './war/shared.js';

export function createWarView(ctx, field) {
  const wv = { ctx, field, T0: performance.now(), threatOn: false, threatKey: null };
  Object.assign(wv, makeBoard(wv));
  Object.assign(wv, makeUnits(wv));
  Object.assign(wv, makeOverlay(wv));
  Object.assign(wv, makeCamera(wv));
  Object.assign(wv, makePick(wv));
  Object.assign(wv, makeInteract(wv));
  Object.assign(wv, makePlay(wv));
  Object.assign(wv, makeProbe(wv));
  wv.view.yaw = wv.view.yawGoal = wv.view.yawFrom = Number.isFinite(ctx.yaw) ? ctx.yaw : wv.pickYaw(); wv.placeCamera(); wv.hud(); // ctx.yaw: a resumed war faces as it was left
  setTimeout(wv.loop, 400);

  let time = 0;
  const api = {
    scene: wv.scene, camera: wv.camera, finished: wv.finished, field,
    update(dt) {
      time += dt;
      wv.updateCamera(dt);
      for (const b of wv.billboards) b.rotation.y = wv.view.yaw;
      if (wv.woods) { wv.woods.userData.aim.yaw.value = wv.view.yaw; wv.woods.userData.aim.tilt.value = wv.view.pitch / 2; } // each crown turns on its own foot to face the eye
      // Sprites turn with the camera and recline by half its pitch (top away, face up toward the eye), so a figure seen from above
      // isn't squashed flat; idle is a slow breath with the feet planted, not a hover. The shadow caster
      // mirrors the figure's facing, height and bounce.
      updateSpriteLight(wv.sun, wv.camera);
      for (const v of wv.views.values()) {
        v.bill.rotation.y = wv.view.yaw; v.bill.rotation.x = -wv.view.pitch * 0.5;
        if (v.rnd?.visible) v.rnd.rotation.y = wv.view.yaw;
        if (!v.moving) { v.bill.position.y = 0; v.body.scale.y = 1 + 0.014 * Math.sin(time * 2.2 + v.bob); }
        if (v.qring?.visible && field.kongmingOn()) v.qring.rotation.z -= dt * 0.35;
        wv.pose(v); v.caster.scale.set(v.flip, v.body.scale.y, 1); v.caster.position.y = v.bill.position.y - 0.02;
      }
      // The selected and the hovered general's tags show their numbers.
      for (const [u, v] of wv.views) v.el.classList.toggle('full', u === wv.st.sel || (!!wv.st.hoverCell && wv.st.hoverCell.x === u.x && wv.st.hoverCell.y === u.y));
      if (!wv.view.tactical) wv.declutter(dt);
      if (!wv.flat) { wv.fadeUnits(dt); if (wv.terrainOn) wv.groundTags(); }
      // Set pieces in front of each general open up over his figure.
      wv.camera.updateMatrixWorld();
      wv.cutout(wv.camera, [...wv.views.values()].filter((v) => !wv.view.tactical && !v.fading && v.g.parent).map((v) => (v.body.updateWorldMatrix(true, false), v.body)));
      wv.waterTex.offset.set(time * 0.03, Math.sin(time * 0.5) * 0.02); wv.dressing.update(time);
      // The enemy's threat (第 3 期): while the view is on, what field.threat forecasts, for the enemy under the pointer alone when there is one.
      if (wv.threatOn && wv.human && !field.over) {
        const foe = wv.human === 'att' ? 'def' : 'att', h = wv.st.hoverCell, one = h && field.unitAt(h.x, h.y), key = `${field.day}:${field.turn}:${field.pool[foe]}:${one?.side === foe ? one.id : ''}:${field.alive.map((u) => `${u.x},${u.y},${u.stop | 0},${u.qimen | 0}`).join(';')}`;
        if (key !== wv.threatKey) { wv.threatKey = key; wv.setThreat(field.threat(foe, one?.side === foe ? one : null)); }
      } else if (wv.threatKey != null) { wv.threatKey = null; wv.setThreat(null); }
      wv.overlayTick(time); // the range layer and the route: what changed goes up once a frame; slow breathing glow
      for (const [i, l] of wv.torches.entries()) l.intensity = 1.5 + Math.sin(time * 13 + i * 2) * 0.25 + Math.sin(time * 7.3 + i) * 0.18;
      // Pulled back, the haze starts behind the board; at 全景 it also closes in before the rim of the country round it (14 cells out; three.js fogs by view depth, so the off-axis rim sits nearer than it looks),
      // so the far corner of the screen dissolves into haze instead of showing the slab's edge against the sky.
      if (wv.scene.fog) { const whole = wv.view.zoom === 'whole' && !wv.view.tactical; wv.scene.fog.near = whole ? wv.view.dist * 1.15 : Math.max(48, wv.view.dist * 1.1); wv.scene.fog.far = whole ? wv.view.dist * 1.55 : wv.scene.fog.near + 52; }
      { // the focus point: the view's centre leaning toward the selected unit (or the hovered cell), eased, but snapped on a start, a step, Tab or a jump
        const want = wv.focusWant.copy(wv.view.target), k = wv.view.zoom === 'whole' ? 0.15 : wv.view.zoom === 'far' ? 0.35 : 0.9, pick = wv.st.sel && !wv.st.sel.gone ? [wv.st.sel.x, wv.st.sel.y] : wv.st.hoverCell ? [wv.st.hoverCell.x, wv.st.hoverCell.y] : null;
        if (pick) want.lerp(wv.focusPick.set(wv.wx(pick[0]), wv.topY(pick[0], pick[1]), wv.wz(pick[1])), wv.st.sel && !wv.st.sel.gone ? k : k * 0.7);
        const mode = `${wv.view.zoom}${wv.view.tactical ? 'T' : ''}`;
        if (wv.focusMode !== mode || wv.focusAt.distanceTo(want) > 5) { wv.focusMode = mode; wv.focusAt.copy(want); } else wv.focusAt.lerp(want, 1 - Math.exp(-dt * 14));
      }
      wv.sky.update(time); wv.shafts.update(time); if (!wv.flat) wv.env.update(dt, time, wv.view.target, wv.view.dist); // the flat map paints its own weather
      const sv = wv.st.sel && !wv.st.sel.gone && wv.views.get(wv.st.sel);
      wv.selRing.visible = !!sv;
      if (sv) { wv.selRing.position.copy(sv.g.position); wv.selRing.position.y += 0.03; wv.selRing.scale.setScalar(1 + Math.sin(time * 5) * 0.08); wv.selRing.material.opacity = 0.6 + Math.sin(time * 5) * 0.3; }
    },
    focusPoint: wv.focusPoint,
    hover(ndc) { const c = wv.pick(ndc); wv.st.hoverCell = c; wv.st.through = c?.through ?? null; wv.syncCompare(); wv.hot(c); wv.cursor.visible = !!c; if (c) wv.cursor.position.set(wv.wx(c.x), wv.topY(c.x, c.y) + 0.03, wv.wz(c.y)); const tip = wv.previewAt(c); return c && { ...c, tip }; },
    click(ndc, e) { const c = wv.pick(ndc); if (c) wv.clickCell(c.x, c.y, e); },
    setInsets: wv.setInsets, resetView: wv.resetView, frame: wv.frame, overview: wv.overview, orbit: wv.orbit, zoom: wv.zoom, rotate: wv.rotate, turn: wv.turn, turnEnd: wv.turnEnd, tactical: wv.tactical,
    // Frees what the battle made: every geometry, material and texture of its scene but the shared textures (ctx.T),
    // and the labels' elements; the view is dropped after it. Without this each war left ~260 geometries and ~15
    // textures (with the sky and the sun's shadow map) on the GPU for the rest of the session.
    dispose() {
      wv.disposeUnits();
      wv.disposeBoard();
      release([wv.scene], null, Object.values(ctx.T ?? {}));
      // Range cells are cleared off the board before a war ends, so the walk above no longer finds what they share.
      wv.disposeOverlay();
    },
    blurAt: wv.blurAt, viewState: wv.viewState, dof: wv.dof,
    // The ground view (T, the 地形 button): see fadeUnits and groundTags.
    setTerrainView(on) {
      on = !!on; if (on === wv.terrainOn) return;
      wv.terrainOn = on; wv.tagsShown();
      for (const v of wv.views.values()) if (!v.fading) v.xray.visible = !on;
      if (on) wv.groundTags(); else { for (const o of wv.gtags.values()) wv.scene.remove(o); wv.gtags.clear(); }
    },
    // The enemy's threat range (R held, or the 威胁 button): see update above and src/war/overlay.js setThreat.
    setThreatView(on) { wv.threatOn = !!on; },
    screenOf: wv.screenOf, screenAxes: wv.screenAxes, pan: wv.pan,
    centreOn: wv.centreOn, viewQuad: wv.viewQuad, // the minimap, the edge markers and a double click (src/warnav.js, src/app.js)
    undo: wv.undo, endTurn: wv.endTurn, retreat: wv.retreat, hold: wv.hold, service: wv.service, shop: wv.shop, clickCell: wv.clickCell, chooseStrategy: wv.chooseStrategy,
    openStrategies: wv.openStrategies, commitCast: wv.commitCast, runCount: wv.runCount, openAttacks: wv.openAttacks, commitAttack: wv.commitAttack, attack: wv.commitAttack, locate: wv.locate,
    keepInView: wv.keepInView, recast: wv.recast, finishDeploy: wv.finishDeploy, cancel: wv.cancel, st: wv.st,
    playStrategy: wv.playStrategy, playAttack: wv.playAttack, // also driven by tests/war.test.mjs and tests/levelup.test.mjs
    faceToward: (u, x, z) => wv.faceToward(wv.views.get(u), new THREE.Vector3(x, 0, z)), // review captures and tests: turn a figure as if he marched that way
    facing: (u) => { const v = wv.views.get(u); return { row: v.frames?.[v.frame] ?? null, flip: v.flip }; },
    get myTurn() { return field.turn === wv.human && !field.over; }, // the frame-rate watch (src/app.js) judges only the player's own idle turn
    get yaw() { return wv.view.yawGoal; }, // kept by 战场中断 (src/app.js suspendWar)
    spriteOf: (u) => wv.views.get(u)?.g, // review captures and probes (read-only)
    flatState: wv.flatState, // the flat painted map draws from it each frame (src/war/probe.js)
    // Hover by cell (the flat map maps the pointer itself): the route preview and its tip, as hover() does.
    // show: the 3D map's cursor box on the cell (the gamepad's cursor, app.js); the flat map draws its own from st.hoverCell.
    hoverCell(c, show = false) { wv.st.hoverCell = c; wv.st.through = null; wv.syncCompare(); wv.hot(c); wv.cursor.visible = !!c && show && !wv.flat; if (wv.cursor.visible) wv.cursor.position.set(wv.wx(c.x), wv.topY(c.x, c.y) + 0.03, wv.wz(c.y)); const tip = wv.previewAt(c); return c && { ...c, tip }; }, // null clears the route preview too
    refreshTags() { for (const [u, v] of wv.views) if (!u.gone && v.g.parent) wv.tag(u); }, // what the day tick does to every tag (tests)
    probe: wv.probe, // what tools/war_look_check.mjs measures that the pixels alone do not tell (src/war/probe.js)
    focusPair: wv.focusPair,
  };
  wv.api = api;
  // ctx.flat: the flat painted map (the 2026-10-29 direction) over the same rules, AI and HUD.
  performance.measure('war:build3d', { start: wv.T0 });
  if (!wv.flat) return api;
  const tf = performance.now(), flatApi = flatten(api, wv.G, new THREE.Scene());
  performance.measure('war:flatten', { start: tf });
  return flatApi;
}
