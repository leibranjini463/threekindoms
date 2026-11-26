// The war map's camera (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the view and its four wheel steps,
// the quarter turns and the drag turn, the pan, the fits between the HUD bands, the 计略 framing and the overview (Tab), and the
// camera methods of the view's api. focusMode is reassigned by the entry's focus point each frame: it is wv.focusMode, never copied.
import * as THREE from 'three';
import { blurWeight } from '../post.js';
import { W, H } from '../core/field.js';
import { YAWS, PITCH, TOP_PITCH, TURN_MS, EDGE, tween } from './shared.js';

const PINCH_STEP = Math.round(Math.log(1.5) * 1000); // two fingers' span 1.5× wider or narrower is one zoom step (zoom below)

export function makeCamera(wv) {
  const { field, human, camera, flat, wx, wz, topY, S, showRoundels } = wv;
  // --- Camera ---
  // The wheel steps through four distances: the whole battle at the board's own slant (全景, the overview), the board filling the
  // screen (远), 9×6 cells, 5×3 cells (feedback R04, 2026-11-02: 远 alone left the enemy off the screen at a corner angle).
  // Tilt-shift by zoom step. The far step keeps the board's own relative band; mid and near hold ~2 cells of depth sharp either side of the
  // focus (world units, so the playing area stays crisp however close the camera is) and soften only the far top and the extreme bottom.
  wv.focusMode = null; const focusAt = new THREE.Vector3(), focusWant = new THREE.Vector3(), focusPick = new THREE.Vector3();
  const LENS = { whole: { dof: 1.0, band: 0.12, far: 1.2, near: 1 }, far: { dof: 1.2, band: 0.09, far: 1.3, near: 1 }, mid: { dof: 1.4, band: 0.07, bandWorld: 2.2, rampWorld: 3.5, far: 1.4, near: 0.8 }, near: { dof: 1.4, band: 0.05, bandWorld: 2.2, rampWorld: 3.5, far: 1.5, near: 0.8 } };
  const STEPS = ['whole', 'far', 'mid', 'near'], STEP_BOX = { mid: [9, 6], near: [5, 3] }, CENTRE = new THREE.Vector3(0, 0.3, 0);
  const view = { yaw: YAWS[0], yawGoal: YAWS[0], yawFrom: YAWS[0], yawT0: null, dist: 31, distGoal: null, pitch: PITCH, pitchGoal: null, target: CENTRE.clone(), targetGoal: CENTRE.clone(), fit: true,
    zoom: 'whole', zoomAcc: 0, zoomAt: 0, tactical: null };
  // Distance at which a box of cells lies between the HUD bands at the given yaw and pitch (binary search on distance, projecting
  // its corners). The whole board (world = true) is fixed to the map; the 9×6 and 5×3 boxes are laid out on the screen, centred on `target`.
  const corner = new THREE.Vector3();
  function fitBox(wCells, hCells, { yaw = view.yawGoal, pitch = view.pitchGoal ?? view.pitch, target = view.targetGoal, world = false, at = CENTRE, ys = world ? [0, 3] : [0, 1.4], side = 0.96 } = {}) {
    const p = new THREE.Vector3(), cs = Math.cos(yaw), sn = Math.sin(yaw);
    const pts = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const y of ys) {
      const x = a * wCells / 2, z = b * hCells / 2;
      pts.push(world ? new THREE.Vector3(at.x + x, y, at.z + z) : new THREE.Vector3(target.x + x * cs + z * sn, y, target.z - x * sn + z * cs));
    }
    // Between the HUD bands (the title bar, the cards and the dock) and right of the action panel's column, with a small margin.
    const top = Math.min(0.86, 1 - 2 * (Math.max(inset.top, 46) + 8) / innerHeight), bot = Math.max(-0.96, -1 + 2 * (inset.bottom + 8) / innerHeight);
    const lft = -side + 2 * inset.left / innerWidth;
    let lo = 3, hi = 90;
    for (let i = 0; i < 18; i++) {
      const dist = (lo + hi) / 2; poseOn(scratch, { yaw, pitch, dist, target });
      const fits = pts.every((c) => { p.copy(c).project(scratch); return p.x < side && p.x > lft && p.y < top && p.y > bot; });
      if (fits) hi = dist; else lo = dist;
    }
    return Math.min(hi, 70);
  }
  // The ground the screen shows: where its four corners meet the plane through the target, as offsets from the target (null when one
  // looks over the horizon), at the given pose, centred on `target` (the view's centre unless given). The screen is the part right of
  // the action panel's column (inset.left): what lies behind the panel is not the player's view of the board.
  const ground = new THREE.Vector3(), eye = new THREE.Vector3();
  function footprint(yaw, pitch, dist, target = view.target) {
    poseOn(scratch, { yaw, pitch, dist, target });
    const out = [], left = -1 + 2 * Math.min(inset.left, innerWidth * 0.6) / innerWidth;
    for (const sx of [left, 1]) for (const sy of [-1, 1]) {
      ground.set(sx, sy, 0.5).unproject(scratch); eye.copy(scratch.position); ground.sub(eye).normalize();
      if (ground.y > -0.02) { out.length = 0; break; }
      const t = (target.y - eye.y) / ground.y; out.push([eye.x + ground.x * t - target.x, eye.z + ground.z * t - target.z]);
    }
    return out.length ? out : null;
  }
  // 'far' is the widest playing view: the screen stays inside the board and a thin dressed margin (and never wider than the whole
  // board in view). At a corner angle that is the board's middle; the ends are reached by panning, and Tab shows the whole board.
  function fitInside(yaw, pitch) {
    let lo = 3, hi = 90;
    for (let i = 0; i < 18; i++) {
      const d = (lo + hi) / 2, f = footprint(yaw, pitch, d, CENTRE);
      if (f && f.every(([x, z]) => Math.abs(x) <= W / 2 + EDGE && Math.abs(z) <= H / 2 + EDGE)) lo = d; else hi = d;
    }
    return lo;
  }
  // 全景: every general on the field and the castle at the board's slant, centred on them, never closer than a step out from 远
  // nor farther than the whole board (fitting the board's corners at a corner angle leaves the generals specks on a floating slab).
  // Looking straight down (Tab) it is the whole board.
  const wholeAt = new THREE.Vector3();
  function wholeView(o = {}) {
    const yaw = o.yaw ?? view.yawGoal, pitch = o.pitch ?? view.pitchGoal ?? view.pitch;
    const board = fitBox(W, H, { world: true, target: CENTRE, yaw, pitch });
    if (pitch > 1.2) return { target: CENTRE, dist: board };
    const xs = field.alive.map((u) => wx(u.x)), zs = field.alive.map((u) => wz(u.y));
    if (S.castle) { xs.push(S.castle.x); zs.push(S.castle.z); }
    if (!xs.length) return { target: CENTRE, dist: board };
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), k = PAN_INSET.whole;
    wholeAt.set(Math.min(W / 2 - k, Math.max(-W / 2 + k, (x0 + x1) / 2)), CENTRE.y, Math.min(H / 2 - k, Math.max(-H / 2 + k, (z0 + z1) / 2)));
    const fit = fitBox(x1 - x0 + 2, z1 - z0 + 2, { world: true, at: wholeAt, target: wholeAt, ys: [0, 2.6], yaw, pitch }); // up to the name tags
    return { target: wholeAt, dist: Math.min(board, Math.max(fit, 1.2 * farDist(yaw, pitch))) };
  }
  const farDist = (yaw, pitch) => Math.min(fitBox(W, H, { world: true, target: CENTRE, yaw, pitch }), Math.max(fitInside(yaw, pitch), 1.25 * fitBox(...STEP_BOX.mid, { yaw, pitch, target: CENTRE })));
  const stepDist = (step, o = {}) => {
    if (step === 'whole') return wholeView(o).dist;
    if (step !== 'far') return fitBox(...STEP_BOX[step], o);
    // Never closer than a step above 'mid' (at a corner angle the board is too shallow to hold more than its middle).
    return farDist(o.yaw ?? view.yawGoal, o.pitch ?? view.pitchGoal ?? view.pitch);
  };
  // Keeps the middle of the screen over the board, a few cells in from its edge by zoom step, so every edge and corner cell can be slid
  // into the clear middle of the screen at any angle (feedback R04, 2026-11-02: holding the whole screen's ground inside the board's margin
  // left the long axis barely movable at a corner angle and the ends out of reach). Past the board the dimmed margin and the land show.
  const PAN_INSET = { whole: 4, far: 2, mid: 1, near: 0.5 };
  function keepOnBoard() {
    const k = PAN_INSET[view.zoom] ?? 0.5;
    for (const [axis, half] of [['x', W / 2 - k], ['z', H / 2 - k]]) view.targetGoal[axis] = Math.min(half, Math.max(-half, view.targetGoal[axis]));
  }
  // The overview: the whole board between the bands, centred.
  function fitBoard() {
    view.panned = false; view.dist = stepDist('whole'); view.distGoal = null; view.atFit = true; view.zoom = 'whole'; view.targetGoal.copy(wholeView().target);
  }
  // The corner an attacking army starts nearest the viewer's bottom left from (it marches up and to the right).
  function pickYaw() {
    const mine = field.alive.filter((u) => u.side === 'att'); if (!mine.length) return YAWS[0];
    const c = new THREE.Vector3(); for (const u of mine) c.add(corner.set(wx(u.x), 0, wz(u.y))); c.divideScalar(mine.length);
    const p = new THREE.Vector3();
    let best = YAWS[0], bestScore = Infinity;
    for (const yaw of YAWS) { poseOn(scratch, { yaw, pitch: view.pitch, dist: 31, target: view.target }); p.copy(c).project(scratch); if (p.x + p.y < bestScore) { bestScore = p.x + p.y; best = yaw; } }
    return best;
  }
  // Choosing a 计略's target (feedback of 2026-11-09, 张沐镕@bilibili): the camera frames the caster and every general the 计略 may
  // be cast on, never closer than 中, so a knot of targets seen from 全景 comes up to a size that takes a click and one off the
  // screen comes onto it. A view that already shows them all at 远 or closer is left alone. When the choice is over the view
  // goes back to what it was (showOptions), unless the player has moved it himself meanwhile (castMoved).
  let castView = null;
  // The view as it is heading (each goal where one is set), kept to be given back: by the 计略's framing (castView), the overview
  // (view.tactical, truthy exactly while it is up) and a close-up (focusPair).
  const snapshot = () => ({ yaw: view.yawGoal, pitch: view.pitchGoal ?? view.pitch, zoom: view.zoom, dist: view.distGoal ?? view.dist, target: view.targetGoal.clone(),
    atFit: !!view.atFit, moved: !!view.moved, panned: !!view.panned, fit: view.fit });
  // Eases back to a snapshot's step, distance and centre, with the framing flags it had; yaw: its turn and tilt too. What else a
  // caller gives back (the pan flag, the pending fit) it sets itself.
  function restore(s, { yaw = false } = {}) {
    if (yaw) { view.yawFrom = view.yaw; view.yawGoal = s.yaw; view.yawT0 = performance.now(); view.pitchGoal = s.pitch; }
    view.zoom = s.zoom; view.distGoal = s.dist; view.targetGoal.copy(s.target); view.atFit = s.atFit; view.moved = s.moved;
  }
  // The action panel's column on the 3D map (app.js warUnit, ui.css .actpanel) is kept out of the frame by the camera's left inset
  // (placeCamera), so the frame's middle already stands right of it.
  const castAt = new THREE.Vector3(), castPt = new THREE.Vector3();
  // Whether a general and his name tag stand in the clear: between the bands and right of the panel, as `cam` sees him (the real
  // camera unless given).
  function seenClear(e, cam = camera) {
    const top = Math.min(0.86, 1 - 2 * (Math.max(inset.top, 46) + 8) / innerHeight), bot = Math.max(-0.96, -1 + 2 * (inset.bottom + 8) / innerHeight), l = -0.9 + 2 * inset.left / innerWidth;
    cam.updateMatrixWorld();
    return [0, 1.4].every((dy) => { castPt.set(wx(e.x), topY(e.x, e.y) + dy, wz(e.y)).project(cam); return castPt.x > l && castPt.x < 0.9 && castPt.y < top && castPt.y > bot; });
  }
  function frameCast(u, id) {
    if (flat || view.tactical || view.closeup) return;
    const all = [u, ...field.alive.filter((e) => field.legal(u, id, e))]; if (all.length < 2) return;
    // Already in the clear at 远 or closer: the camera stays (D32 §7). At 全景 a cell is too small to take a click.
    if (view.zoom !== 'whole' && view.distGoal == null && all.every((e) => seenClear(e))) return;
    const xs = all.map((e) => wx(e.x)), zs = all.map((e) => wz(e.y)), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    castView ??= snapshot();
    castAt.set((x0 + x1) / 2, CENTRE.y, (z0 + z1) / 2);
    const fit = fitBox(x1 - x0 + 2, z1 - z0 + 2, { world: true, at: castAt, target: castAt, ys: [0, 2.6] }), mid = fitBox(...STEP_BOX.mid, { target: castAt }), far = farDist(view.yawGoal, view.pitchGoal ?? view.pitch);
    const dist = Math.min(Math.max(fit, mid), Math.max(castView.dist, mid)); // no closer than 中, no farther than he was
    view.zoom = dist <= mid * 1.05 ? 'mid' : dist <= far * 1.05 ? 'far' : 'whole';
    view.fit = false; view.atFit = false; view.moved = true; view.panned = false; view.distGoal = dist;
    view.targetGoal.copy(castAt);
  }
  // A target walked to in the list with the keys or the pad, or picked, that stands off the screen or behind the panel: the
  // camera slides the least that brings him into the clear, at the zoom it has (D32 §7). Pointing at a row with the mouse does not
  // move it: a pointer sweeping the list would drag the camera along.
  function keepInView(t) {
    if (flat || view.tactical || view.closeup || !t || seenClear(t)) return;
    castView ??= snapshot();
    slideTo(t);
  }
  // The least slide that brings him into the clear, at the turn and distance the camera has.
  function slideTo(t) {
    const goal = view.targetGoal.clone(), to = new THREE.Vector3(wx(t.x), CENTRE.y, wz(t.y)), at = new THREE.Vector3();
    // The fraction of the way from the frame's middle to him that brings him in, found by halving (the camera keeps its turn and distance).
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) { const k = (lo + hi) / 2; poseOn(scratch, { yaw: view.yaw, pitch: view.pitch, dist: view.dist, target: at.copy(goal).lerp(to, k) }); if (seenClear(t, scratch)) hi = k; else lo = k; }
    view.fit = false; view.atFit = false; view.moved = true; view.panned = false;
    view.targetGoal.copy(goal.lerp(to, Math.min(1, hi + 0.08)));
    if (view.zoom === 'whole') view.zoom = 'far';
  }
  // The enemy's turn (第 2 期, docs/战场3D重构与操作优化方案_2026-11-13.md §6): what he does inside the picture is watched where it
  // is, the camera still; what he does outside it brings the camera over by the least slide, at the step it has; and once the
  // player has moved the camera himself during that turn it is his until the turn ends. Before, every enemy action re-centred the view.
  let handsKey = null;
  const turnKey = () => `${field.day}:${field.turn}`, enemyTurn = () => !!human && field.turn !== human && !field.over && !wv.st?.deploying;
  const tookCamera = () => { if (enemyTurn()) handsKey = turnKey(); };
  function watch(x, y) {
    if (handsKey === turnKey() || view.tactical || view.closeup) return;
    const c = { x: Math.min(W - 1, Math.max(0, Math.round(x))), y: Math.min(H - 1, Math.max(0, Math.round(y))) };
    if (!seenClear(c)) slideTo(c);
  }
  // 定位目标: on the player's asking, the target in the middle of the clear, at 中 (nearer if the view is nearer already).
  function locate(t) {
    if (!t || t.gone) return;
    if (flat) return; // the flat board shows the whole field at once
    if (view.tactical) cam.tactical(false);
    castView ??= snapshot();
    const mid = stepDist('mid', { target: new THREE.Vector3(wx(t.x), 0, wz(t.y)) });
    view.fit = false; view.atFit = false; view.moved = true; view.panned = false;
    view.targetGoal.set(wx(t.x), CENTRE.y, wz(t.y)); view.distGoal = Math.min(view.distGoal ?? view.dist, mid);
    if (view.zoom === 'whole' || view.zoom === 'far') view.zoom = 'mid';
  }
  function unframeCast() {
    const s = castView; castView = null; if (!s || view.tactical || view.closeup) return;
    restore(s); view.panned = s.panned; view.fit = false;
    if (s.atFit && s.zoom === 'whole') { view.targetGoal.copy(wholeView().target); view.distGoal = stepDist('whole'); } // 全景 of the field as it now stands
  }
  const castMoved = () => { castView = null; }; // the player took the camera: it is his view now
  // Wide windows see most of the map, so the camera only leans toward the unit; narrow ones must centre on it or edge units fall off-screen.
  // With the cards taking over half the height (a small window) the free band is narrow: centre on him then too.
  const leanK = () => (view.zoom !== 'far' ? 1 : (innerHeight - inset.top - inset.bottom) / innerHeight < 0.6 ? 0.95 : camera.aspect >= 1.5 ? 0.6 : camera.aspect >= 1.1 ? 0.8 : 0.95);
  // 全景 already shows every general: picking one or following a march leaves it be.
  function focusOn(u) { if (view.tactical || view.zoom === 'whole') return; if (enemyTurn()) return watch(u.x, u.y); const k = leanK(); view.panned = false; view.atFit = false; view.fit = false; view.moved = false; view.targetGoal.set(wx(u.x) * k, 0, wz(u.y) * k + 1); }
  function followPoint(p) { if (view.tactical || view.zoom === 'whole') return; if (enemyTurn()) return watch(p.x + W / 2 - 0.5, p.z + H / 2 - 0.5); const k = leanK(); view.panned = false; view.atFit = false; view.fit = false; view.moved = false; view.targetGoal.set(p.x * k, 0, p.z * k + 1); }
  // Screen space the HUD covers (px): the camera frames the target in the free band between them by
  // shifting the projection centre, so a selected unit never sits behind the unit panel or the dock.
  // left: the action panel's column (D32), so the middle of the frame stands in the middle of the clear right of it.
  const inset = { top: 0, bottom: 0, left: 0 };
  function shiftFor(cam) {
    const W = innerWidth, H = innerHeight, oy = Math.max(0, Math.min(H * 0.3, (inset.bottom - inset.top) / 2)), ox = -Math.max(0, Math.min(W * 0.3, inset.left / 2));
    if (oy > 1 || ox < -1) cam.setViewOffset(W, H, ox, oy, W, H); else if (cam.view) cam.clearViewOffset();
  }
  function placeCamera() {
    const { yaw, dist, pitch, target } = view;
    shiftFor(camera);
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(target);
  }
  // What the screen would show at some other pose (a fit, the footprint, the opening corner, the least slide that brings a general
  // into the clear) is worked out on this spare camera, never by moving the real one: posed as placeCamera poses the real camera,
  // with its lens (fov, aspect, near, far, zoom) and the same HUD shift, so a sum on it projects as the real camera would there.
  const scratch = new THREE.PerspectiveCamera();
  function poseOn(cam, { yaw, pitch, dist, target }) {
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far; cam.zoom = camera.zoom;
    shiftFor(cam);
    cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(target);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    return cam;
  }

  // The wheel's step: 'whole' is the overview fit again (it re-arms atFit); 'far', 'mid' and 'near' are the player's own move, centred
  // on the selected general unless the player has already panned elsewhere.
  function setStep(step) {
    const sel = wv.st.sel && !wv.st.sel.gone ? wv.st.sel : null;
    view.zoom = step; view.fit = false;
    if (step === 'whole') {
      view.panned = false; view.targetGoal.copy(wholeView().target); view.atFit = true; view.moved = !!sel; // a selected general must not pull the overview back to himself
    } else {
      // In from 全景 with no one selected: the board's middle, as 远 has always been, and still untouched, so a general picked next is framed.
      const fresh = !sel && step === 'far' && view.atFit;
      if (sel && (view.atFit || !view.moved)) view.targetGoal.set(wx(sel.x), 0, wz(sel.y) + 1);
      else if (fresh) view.targetGoal.copy(CENTRE);
      view.atFit = false; view.moved = !fresh;
    }
    if (step !== 'whole') keepOnBoard();
    view.distGoal = stepDist(step, { target: view.targetGoal });
  }
  // The camera part of each frame (the entry's api.update): the overview refit, the eases of distance, tilt and centre, the turn.
  function updateCamera(dt) {
    if (view.atFit && view.zoom === 'whole' && view.size !== `${innerWidth}x${innerHeight}`) view.fit = true; // a resized window: the overview fitted again
    if (view.fit && camera.aspect !== 1) { view.fit = false; view.size = `${innerWidth}x${innerHeight}`; fitBoard(); }
    // Wheel zoom (and a scripted tilt) ease toward their goals like the target, instead of stepping per event.
    const ez = 1 - Math.exp(-dt * 9);
    if (view.distGoal != null) { view.dist += (view.distGoal - view.dist) * ez; if (Math.abs(view.distGoal - view.dist) < 0.01) view.distGoal = null; }
    if (view.pitchGoal != null) { view.pitch += (view.pitchGoal - view.pitch) * ez; if (Math.abs(view.pitchGoal - view.pitch) < 0.0005) view.pitchGoal = null; }
    if (view.panned && !view.tactical && !view.closeup) keepOnBoard(); // only a view the player slid (a focus on a general at the edge stays centred on him)
    view.target.lerp(view.targetGoal, 1 - Math.exp(-dt * 3));
    // A quarter turn eases out over TURN_MS; the distance for this zoom step is refitted each frame so the box stays in view all the way round.
    if (view.dragTurn && !view.closeup) view.dist = stepDist(view.zoom, { yaw: view.yaw }); // held by the mouse: the step's box stays in view at every angle
    else if (view.yawT0 != null) {
      const k = Math.min(1, (performance.now() - view.yawT0) / TURN_MS);
      view.yaw = k >= 1 ? view.yawGoal : view.yawFrom + (view.yawGoal - view.yawFrom) * (1 - (1 - k) ** 3);
      if (view.turnFit && !view.tactical && !view.closeup) {
        const want = stepDist(view.zoom, { yaw: view.yaw }); view.distGoal = null;
        if (view.turnFit !== view.zoom) { view.dist += (want - view.dist) * ez; if (Math.abs(want - view.dist) < 0.05) view.turnFit = view.zoom; } // a wheel step in mid-turn eases in
        else view.dist = want;
      }
      if (k >= 1) {
        if (view.turnFit && view.turnFit !== view.zoom && !view.tactical && !view.closeup) view.dist = stepDist(view.zoom, { yaw: view.yaw }); // a wheel step taken mid-turn lands on its exact fit, not ~5% short
        view.yawT0 = null; view.turnFit = null;
      }
    }
    placeCamera();
    // lookAt refreshes the matrices before it turns the camera, so they hold the new position with the last rotation; the sprite
    // light and the tags' declutter read them before the frame's later update. The fits refreshed them as a side effect when they
    // posed the real camera (each turning frame); they pose a spare one now.
    camera.updateMatrixWorld();
    widen(dt);
  }

  // The lens of the step, its sharp band widened over what the player is reading (第 2 期): on his own idle turn with a general
  // picked or targets marked, every marked cell lies inside the band, so the reach is read sharp at 中 and 近 too; the tilt-shift
  // look is kept for the enemy's turn, the set pieces and a board with no one picked. Eased, so a pick does not snap the blur.
  let wide = 0;
  const depthOf = (x, y, z) => -wv.cornerPt.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z;
  function widen(dt) {
    let want = 0; const st = wv.st, cells = wv.cells?.range;
    if (st && cells?.length && human && field.turn === human && !st.busy && !field.over && !view.closeup) {
      const focus = depthOf(focusAt.x, focusAt.y, focusAt.z);
      for (const c of cells) want = Math.max(want, Math.abs(depthOf(wx(c.x), topY(c.x, c.y), wz(c.y)) - focus) / focus);
      want *= 1.08;
    }
    wide += (want - wide) * (dt > 0 ? 1 - Math.exp(-dt * 8) : 1);
  }
  function lens() {
    const l = LENS[view.zoom], focus = depthOf(focusAt.x, focusAt.y, focusAt.z), base = l.bandWorld != null ? l.bandWorld / focus : l.band;
    return wide > base ? { ...l, bandWorld: null, band: wide } : l;
  }
  // The api's camera methods (src/warview.js puts each into its api under the same name).
  const cam = {
    // Focus leans from the view's centre toward the selected unit (the hovered cell when none is selected): a third at the far step, nearly all
    // the way at mid and near so he is always inside the sharp band. It eases (see update) so a click does not snap the blur.
    focusPoint() { return focusAt; },
    // An overview not yet touched is refitted when the bands change by a visible amount (the cards come and go).
    setInsets(top, bottom, left = inset.left) { const moved = Math.abs(top - inset.top) + Math.abs(bottom - inset.bottom) + Math.abs(left - inset.left) > 12; inset.top = top; inset.bottom = bottom; inset.left = left;
      // (the bands are measured after the frame's update and before its draw, app.js frameWar: the new shift goes onto the real camera now, as it did when the fit posed it)
      if (moved && view.atFit && view.zoom === 'whole' && !view.tactical) { view.targetGoal.copy(wholeView().target); view.distGoal = stepDist('whole'); placeCamera(); camera.updateMatrixWorld(); return; } // 全景 eases out round a card that came, with or without a general picked
      if (moved && view.atFit && (!wv.st.sel || view.moved)) view.fit = true; else if (moved && wv.st.sel && !wv.st.sel.gone && !wv.st.busy && !view.moved) focusOn(wv.st.sel); }, // never over a view the player moved; atFit with the view moved is the overview stepped back to with a general selected
    // 镜头复位: default tilt and distance (pulled back on narrow windows), the selected unit centred.
    resetView() {
      castMoved(); cam.tactical(false);
      view.moved = false; view.pitch = PITCH; view.pitchGoal = null; view.zoom = wv.st.sel && !wv.st.sel.gone ? 'mid' : 'whole'; view.zoomAcc = 0;
      if (wv.st.sel && !wv.st.sel.gone) { focusOn(wv.st.sel); view.distGoal = stepDist('mid'); } else view.fit = true;
    },
    // Centre a cell exactly at a given distance (close-ups, review captures).
    frame(x, y, dist = 10) { cam.tactical(false); view.panned = false; view.fit = false; view.atFit = false; view.moved = true; view.targetGoal.set(wx(x), topY(x, y), wz(y)); view.dist = dist; view.distGoal = null; },
    // Whole board in view (the opening shot, and 镜头复位 with nothing selected).
    overview() { castMoved(); cam.tactical(false); wv.st.sel = null; wv.showOptions(); view.moved = false; view.pitch = PITCH; view.pitchGoal = null; view.zoom = 'whole'; view.fit = true; },
    // The board is read from one fixed angle (A2): a drag slides the map instead of turning or tilting it.
    orbit(dx, dy) { const k = view.dist * 0.0021; this.pan(-dx * k, -dy * k / Math.sin(view.pitch)); },
    // The wheel steps 全景 → far → mid → near: every 100 of wheel turned (wheel down pulls back) is one step, and the ends stop.
    // Two fingers (pinch, from app.js: d is -1000 × the log of how much the span grew) step once for each 1.5× they open or close:
    // at 100 a pinch was a step for every 10% and ran from end to end in one small gesture (Android tablet, 2026-11-20).
    zoom(d, at = null, { pinch = false } = {}) { // at: where the pointer is (the wheel's own event); the pad and the keys give none
      if (view.tactical) return;
      const now = performance.now(); if (now - view.zoomAt > 600) view.zoomAcc = 0; view.zoomAt = now;
      view.zoomAcc += d;
      if (Math.abs(view.zoomAcc) < (pinch ? PINCH_STEP : 100)) return;
      castMoved();
      const out = view.zoomAcc > 0, to = Math.min(STEPS.length - 1, Math.max(0, STEPS.indexOf(view.zoom) + (out ? -1 : 1))); view.zoomAcc = 0;
      // Pulling back at 全景 with the camera moved off it goes back to the overview.
      if (STEPS[to] !== view.zoom || (out && !view.atFit)) {
        const from = view.zoom; setStep(STEPS[to]);
        // Pulling in, the cell under the pointer stays under it: with the turn and tilt kept, a point of the ground holds its place
        // on screen when its offset from the view's centre shrinks as the distance does. Without a pointed cell, as before.
        // Out of 全景 the step is 远 as it has always been framed (the board filling the screen): a cell is too small there to aim the wheel at.
        const hov = at && !flat && from !== 'whole' ? wv.pick(at) : null;
        if (!out && hov && from !== STEPS[to] && view.distGoal != null) {
          for (let i = 0; i < 2; i++) { const k = view.distGoal / view.dist; view.targetGoal.set(wx(hov.x) - (wx(hov.x) - view.target.x) * k, view.targetGoal.y, wz(hov.y) - (wz(hov.y) - view.target.z) * k); view.distGoal = stepDist(STEPS[to], { target: view.targetGoal }); }
          keepOnBoard(); view.distGoal = stepDist(STEPS[to], { target: view.targetGoal });
          view.panned = true; view.moved = true; view.atFit = false; view.fit = false;
        }
      }
      tookCamera();
    },
    // A quarter turn about the view's centre; another press mid-turn adds to where the turn is heading. The step and the target stay.
    rotate(dir) {
      if (view.tactical || view.closeup || view.dragTurn || !dir) return;
      castMoved(); tookCamera();
      view.yawFrom = view.yaw; view.yawGoal += Math.sign(dir) * Math.PI / 2; view.yawT0 = performance.now(); view.turnFit ??= view.zoom;
    },
    // A right drag turns the board with the mouse, as in 0.1.x; let go and it eases on to the nearest of the four corners,
    // so tags, fits and the woods are always laid out for one of them. The step and the target stay, as in a quarter turn.
    turn(dx) {
      if (view.tactical || view.closeup || !dx) return;
      castMoved(); tookCamera();
      if (!view.dragTurn) { if (view.yawT0 != null) view.yaw = view.yawGoal; view.yawT0 = null; view.dragTurn = true; view.turnFit = view.zoom; view.distGoal = null; }
      view.yaw -= dx * 0.006; view.yawGoal = view.yaw;
    },
    turnEnd() {
      if (!view.dragTurn) return;
      view.dragTurn = false; const q = Math.PI / 2;
      view.yawFrom = view.yaw; view.yawGoal = YAWS[0] + Math.round((view.yaw - YAWS[0]) / q) * q; view.yawT0 = performance.now();
    },
    // Tab: straight down on the whole board with roundels for the figures; again, the angle, step and framing as they were.
    tactical(on = !view.tactical) {
      if (!!on === !!view.tactical || (on && view.closeup)) return;
      castMoved();
      if (on) {
        view.dragTurn = false; view.turnFit = null;
        view.tactical = snapshot();
        // Straight down the board is read square to the screen (a corner view would waste the corners of the picture), the roundels upright.
        view.yawFrom = view.yaw; view.yawGoal = Math.round(view.yawGoal / Math.PI) * Math.PI; view.yawT0 = performance.now();
        view.pitchGoal = TOP_PITCH; setStep('whole'); showRoundels(true);
      } else {
        const t = view.tactical; view.tactical = null; showRoundels(false);
        restore(t, { yaw: true }); view.fit = t.fit; // the pan flag stays as the overview left it (off)
      }
    },
    // The blur weight at a world point (0 sharp … 1 full, times its side's weight) under the lens now, as the shader will read it.
    blurAt(x, y, z) {
      if (view.tactical) return 0;
      camera.updateMatrixWorld(); const l = lens(), focus = -wv.cornerPt.copy(focusAt).applyMatrix4(camera.matrixWorldInverse).z, d = -wv.cornerPt.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z;
      return blurWeight(d, focus, l);
    },
    // still: the camera has come to rest (no fit, zoom, tilt or turn pending, the target within 0.01 of its goal); tests wait on it instead of a fixed time.
    viewState: () => ({ yaw: view.yaw, pitch: view.pitch, dist: view.dist, zoom: view.zoom, tactical: !!view.tactical,
      still: !view.fit && view.distGoal == null && view.pitchGoal == null && view.yawT0 == null && !view.dragTurn && view.target.distanceTo(view.targetGoal) < 0.01 }),
    // Tilt-shift by zoom step (the nearer, the shallower the sharp band and the stronger the blur); looking straight down nothing is out of focus.
    dof: () => (view.tactical ? { dof: 0, strength: 0, band: 0.09, far: 1.3, near: 1 } : { ...lens(), strength: LENS[view.zoom].dof }),
    // A cell's top surface on screen, in CSS px: its middle, the width and height of the diamond it makes, and how
    // far one cell of height rises (the command bar stands beside a general by it, app.js besideUnit).
    screenOf(x, y) {
      camera.updateMatrixWorld();
      const pt = (dx, dy, dz) => { const p = wv.cornerPt.set(wx(x) + dx, topY(x, y) + dy, wz(y) + dz).project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
      const [cx, cy] = pt(0, 0, 0), [ax, ay] = pt(1, 0, 0), [bx, by] = pt(0, 0, 1), [, uy] = pt(0, 1, 0);
      return { x: cx, y: cy, cw: Math.abs(ax - cx) + Math.abs(bx - cx), ch: Math.abs(ay - cy) + Math.abs(by - cy), rise: cy - uy, diamond: true };
    },
    // One step of the grid along x and along y on screen, at a cell and its own height (the gamepad's cursor steps by these, app.js:
    // by the cells' tops, a cliff beside it would make two neighbours look the same way).
    screenAxes(x, y) {
      camera.updateMatrixWorld();
      const at = (dx, dz) => { const p = wv.cornerPt.set(wx(x) + dx, topY(x, y), wz(y) + dz).project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
      const [ox, oy] = at(0, 0), [ax, ay] = at(1, 0), [bx, by] = at(0, 1);
      return { x: [ax - ox, ay - oy], y: [bx - ox, by - oy] };
    },
    // A cell brought to the middle of the picture at the step and turn it has (the minimap, an edge marker, a double click on a
    // general or his card): out of the overview it steps in to 远, where a cell can be told.
    centreOn(x, y) {
      if (flat || view.closeup) return;
      if (view.tactical) cam.tactical(false);
      castMoved(); tookCamera();
      if (view.zoom === 'whole') { view.zoom = 'far'; }
      view.fit = false; view.atFit = false; view.moved = true; view.panned = true;
      view.targetGoal.set(wx(x), view.targetGoal.y, wz(y) + 1); keepOnBoard(); view.distGoal = stepDist(view.zoom, { target: view.targetGoal });
    },
    // What the picture shows of the board, for the minimap: where the corners of the screen meet the ground, in cells.
    viewQuad() {
      const f = footprint(view.yaw, view.pitch, view.dist); if (!f) return null;
      const q = f.map(([x, z]) => [x + view.target.x + W / 2, z + view.target.z + H / 2]), cx = q.reduce((a, p) => a + p[0], 0) / q.length, cy = q.reduce((a, p) => a + p[1], 0) / q.length;
      return q.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); // round its middle, so it draws as an outline
    },
    pan(dx, dz) { if (view.tactical) return; castMoved(); tookCamera(); view.panned = true; view.atFit = false; view.moved = true; const c = Math.cos(view.yaw), sn = Math.sin(view.yaw); view.targetGoal.x += dx * c + dz * sn; view.targetGoal.z += dz * c - dx * sn; },
    async focusPair(a, d) {
      if (view.tactical) return () => {}; // the overview stays put while they fight
      if (view.dragTurn) cam.turnEnd();
      if (view.yawT0 != null) { view.yaw = view.yawGoal; view.yawT0 = null; view.turnFit = null; } // a turn in progress lands first
      view.closeup = true; view.distGoal = null; const s = snapshot(); // its dist is the live one: no distance goal is left
      view.targetGoal.set((wx(a.x) + wx(d.x)) / 2, 0.4, (wz(a.y) + wz(d.y)) / 2);
      await tween(550, (k) => { view.dist = s.dist + (14 - s.dist) * k * k; });
      return () => { view.closeup = false; view.dist = s.dist; view.targetGoal.copy(s.target); }; // straight back to its distance, the centre eased
    },
  };
  return { view, inset, LENS, STEPS, YAWS, CENTRE, fitBox, footprint, fitInside, wholeView, farDist, stepDist, seenClear, pickYaw, placeCamera,
    keepOnBoard, fitBoard, setStep, focusOn, followPoint, frameCast, keepInView, locate, unframeCast, castMoved, updateCamera, seenClearAt: (x, y) => seenClear({ x, y }),
    focusAt, focusWant, focusPick, snapshot, restore, ...cam };
}
