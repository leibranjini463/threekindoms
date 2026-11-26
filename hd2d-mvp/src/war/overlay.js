// The war map's overlays (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the range cells, the hovered
// route and its tip, the cursor box and the selection ring. The cells are kept as data (cells) that the 3D meshes and the flat
// painted map both draw from; the flat map builds no meshes for them.
import * as THREE from 'three';
import { canvasTex } from '../pixel.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { W, H, MOUNT, CASTLE, ATTACK_COST, STRATS } from '../core/field.js';
import { name, data } from '../core/game.js';
import { equipIcon } from '../assets.js';
import { FIGURE_STENCIL } from './shared.js';

export function makeOverlay(wv) {
  const { field, human, scene, flat, wx, wz, terr, topY, APRON, GW, grid, where } = wv;
  // --- Overlays ---
  // What is marked, as data: the range layer (reach, castle, attack, 计略 and deployment cells, and a route being walked) and the
  // hovered route. The flat painted map draws from this (flatState); the 3D view draws it as below.
  const cells = { range: [], route: [] };
  // --- The range layer (docs/战场范围显示实施计划_2026-11-13.md). One mesh over the whole board, a patch a cell, and a 32×19 data
  // texture saying what each cell is; the shader draws the reach as one region: a faint fill the ground reads through, thin
  // lines between its cells, and a bright contour round the outside only, found from each cell's eight neighbours. One draw for
  // the layer and one for what shows through woods, hills and walls, where each cell was three meshes before (2026-11-13).
  // Reach is warm gold and the castle orange: blue and red belong to the two sides (A2). The deployment squares are mint, a
  // green well clear of the yellow-green grass and the woods they were lost in as a pale leaf green (feedback, 2026-11-08).
  const MARK = { move: '#ffb81f', attack: '#ff4a36', path: '#fff2c8', castle: '#ff8030', strat: '#c890ff', deploy: '#4dffb8' };
  const KIND = { move: 1, castle: 2, attack: 3, strat: 4, deploy: 5, self: 6 }, KINDS = ['move', 'move', 'castle', 'attack', 'strat', 'deploy', 'move'];
  const cellData = new Uint8Array(W * H * 4), cellTex = new THREE.DataTexture(cellData, W, H, THREE.RGBAFormat);
  cellTex.magFilter = cellTex.minFilter = THREE.NearestFilter; cellTex.needsUpdate = true;
  const hill = (x, y) => (terr(x, y) === MOUNT ? grid[(y + APRON) * GW + x + APRON].hAt : null);
  // On a hill the patch is draped over the slope (a flat one would sink into it at the corners).
  const rangeGeo = flat ? null : (() => {
    const pos = [], uv = [], cell = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const at = hill(x, y), n = at ? 6 : 1, c = topY(x, y), X = wx(x) - 0.5, Z = wz(y) - 0.5, v = (i, j) => { pos.push(X + i / n, at ? at(i / n, j / n) : c, Z + j / n); uv.push(i / n, j / n); cell.push(x, y); };
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { v(i, j); v(i, j + 1); v(i + 1, j); v(i + 1, j); v(i, j + 1); v(i + 1, j + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
    return g;
  })();
  // The look, settled on pictures of three boards (docs/review-assets/2026-11-13/war-range-mock, two rounds, and war-range):
  // the contour is a gold line with a dark one inside it and a soft shade inside that, which carries the line on snow and sand
  // and is lost on dark ground; the lines between cells are a light and a dark hairline side by side, so cells can be counted on
  // snow as on grass; a target (attack, 计略) is a ring near the cell's rim over a faint wash of its colour, the wash because
  // his figure stands on the ring; a castle in reach is washed orange with an orange frame, also seen through its own walls.
  const RANGE_FRAG = `
    uniform sampler2D uCells; uniform vec3 uCol[7]; uniform vec3 uThreat; uniform float uFill, uOnly, uPulse, uGridDark, uTarget; varying vec2 vUv; varying vec2 vCell;
    float inT(vec2 c) { if (c.x < 0. || c.y < 0. || c.x > ${W - 1}. || c.y > ${H - 1}.) return 0.; return texture2D(uCells, (c + .5) / vec2(${W}., ${H}.)).b > .5 ? 1. : 0.; }
    float kindAt(vec2 c) { if (c.x < 0. || c.y < 0. || c.x > ${W - 1}. || c.y > ${H - 1}.) return 0.; return floor(texture2D(uCells, (c + .5) / vec2(${W}., ${H}.)).r * 255. + .5); }
    float inR(vec2 c) { float k = kindAt(c); return (k == 1. || k == 2. || k == 5. || k == 6.) ? 1. : 0.; }
    void main() {
      vec2 c = floor(vCell + .5); vec4 me = texture2D(uCells, (c + .5) / vec2(${W}., ${H}.)); float k = floor(me.r * 255. + .5);
      if (k < .5 && me.b < .5) discard;
      vec2 uv = vUv; float dW = uv.x, dE = 1. - uv.x, dN = uv.y, dS = 1. - uv.y, aa = fwidth(uv.x) + fwidth(uv.y);
      vec3 ink = vec3(0.07, 0.04, 0.01), base = uCol[int(k)], col = base; float a = 0.;
      if (k < .5) { a = 0.; }
      else if (k == 3. || k == 4.) {
        // A target: brackets at the cell's corners over a wash of its colour. Not a ring at his feet: he stands on a base ring of
        // his side's colour (units.js, 0.36–0.46), which lay exactly over one.
        float e = min(min(dW, dE), min(dN, dS)), along = max(min(dW, dE), min(dN, dS)), w = max(0.05, 1.2 * aa), inset = 0.045;
        float arm = 1. - smoothstep(0.3, 0.3 + aa, along);
        float line = (1. - smoothstep(w / 2., w / 2. + aa, abs(e - inset - w / 2.))) * arm;
        float rim = (1. - smoothstep(w / 2. + 0.035, w / 2. + 0.035 + aa, abs(e - inset - w / 2.))) * (1. - smoothstep(0.33, 0.33 + aa, along)) * (1. - line);
        a = uTarget + 0.08 * uPulse; col = mix(col, ink, rim * 0.85); a = max(a, rim * 0.7);
        col = mix(col, mix(base, vec3(1.), 0.05 + 0.2 * uPulse), line); a = mix(a, 1., line);
        if (uOnly > .5) { a = line * 0.6; col = mix(base, vec3(1.), 0.2); }
      } else {
        vec3 rc = k == 5. ? uCol[5] : uCol[1]; col = rc;
        float nW = inR(c + vec2(-1., 0.)), nE = inR(c + vec2(1., 0.)), nN = inR(c + vec2(0., -1.)), nS = inR(c + vec2(0., 1.));
        float d = 1.;
        if (nW < .5) d = min(d, dW); if (nE < .5) d = min(d, dE); if (nN < .5) d = min(d, dN); if (nS < .5) d = min(d, dS);
        if (nW > .5 && nN > .5 && inR(c + vec2(-1., -1.)) < .5) d = min(d, length(vec2(dW, dN)));
        if (nE > .5 && nN > .5 && inR(c + vec2(1., -1.)) < .5) d = min(d, length(vec2(dE, dN)));
        if (nW > .5 && nS > .5 && inR(c + vec2(-1., 1.)) < .5) d = min(d, length(vec2(dW, dS)));
        if (nE > .5 && nS > .5 && inR(c + vec2(1., 1.)) < .5) d = min(d, length(vec2(dE, dS)));
        float lw = max(0.055, 1.2 * aa);
        float line = 1. - smoothstep(lw, lw + aa, d), dark = (1. - smoothstep(lw + 0.05, lw + 0.05 + aa, d)) * (1. - line);
        float shade = (1. - smoothstep(lw, lw + 0.26, d)) * 0.34;
        float glow = (1. - smoothstep(0., 0.3, d)); glow *= glow * 0.16;
        float g = min(min(dW, dE), min(dN, dS)), gw = max(0.012, 0.6 * aa), gridl = (1. - smoothstep(gw, gw + aa, g));
        float gdark = (1. - smoothstep(gw + 0.02, gw + 0.02 + aa, g)) * (1. - gridl);
        a = uFill * (0.9 + 0.2 * uPulse) + glow + me.g * 0.24;
        if (k == 2.) { col = mix(rc, uCol[2], 0.85); a += 0.16; }
        col = mix(col, ink, shade / max(a + shade, 0.001) * 0.9); a = a + shade * (1. - a);
        col = mix(col, ink, gdark * uGridDark); a = max(a, gdark * uGridDark * 0.8);
        col = mix(col, mix(rc, vec3(1.), 0.3), gridl * 0.42); a = max(a, gridl * 0.26);
        col = mix(col, ink, dark * 0.9); a = max(a, dark * 0.78);
        float cw = max(0.05, 1.2 * aa), cf = k == 2. ? (1. - smoothstep(cw, cw + aa, abs(g - 0.16))) : 0.;
        col = mix(col, uCol[2], cf); a = mix(a, 1., cf);
        col = mix(col, mix(rc, vec3(1.), 0.12 * uPulse), line); a = mix(a, 1., line);
        if (uOnly > .5) { a = max(line, cf) * 0.5; col = mix(cf > line ? uCol[2] : rc, vec3(1.), 0.1); }
      }
      if (me.b > .5) {
        // The enemy's threat (第 3 期): a faint red wash and a thin red contour round the cells he could strike, under whatever the cell is marked as.
        float tW = inT(c + vec2(-1., 0.)), tE = inT(c + vec2(1., 0.)), tN = inT(c + vec2(0., -1.)), tS = inT(c + vec2(0., 1.)), td = 1.;
        if (tW < .5) td = min(td, dW); if (tE < .5) td = min(td, dE); if (tN < .5) td = min(td, dN); if (tS < .5) td = min(td, dS);
        if (tW > .5 && tN > .5 && inT(c + vec2(-1., -1.)) < .5) td = min(td, length(vec2(dW, dN)));
        if (tE > .5 && tN > .5 && inT(c + vec2(1., -1.)) < .5) td = min(td, length(vec2(dE, dN)));
        if (tW > .5 && tS > .5 && inT(c + vec2(-1., 1.)) < .5) td = min(td, length(vec2(dW, dS)));
        if (tE > .5 && tS > .5 && inT(c + vec2(1., 1.)) < .5) td = min(td, length(vec2(dE, dS)));
        float tw = max(0.04, 1.1 * aa), off = 0.07; // inset, so it runs beside the gold contour where the two regions end together
        float tl = 1. - smoothstep(tw / 2., tw / 2. + aa, abs(td - off)), tdk = (1. - smoothstep(tw / 2. + 0.035, tw / 2. + 0.035 + aa, abs(td - off))) * (1. - tl);
        float hatch = step(0.82, fract((uv.x + uv.y + c.x + c.y) * 2.5)) * 0.1;
        vec3 tc = uThreat; float ta = 0.07 + hatch;
        tc = mix(tc, ink, tdk * 0.85); ta = max(ta, tdk * 0.6); tc = mix(tc, mix(uThreat, vec3(1.), 0.15), tl); ta = mix(ta, 0.95, tl);
        if (uOnly > .5) { ta = tl * 0.45; tc = uThreat; }
        col = mix(tc, col, a / max(a + ta * (1. - a), 0.001)); a = a + ta * (1. - a);
      }
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const RANGE_VERT = 'attribute vec2 aCell; varying vec2 vUv; varying vec2 vCell; void main() { vUv = uv; vCell = aCell; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }';
  // The fill is a share of gold over the ground: under rain and thunder the wet grass took it as yellow at the clear-day value.
  // On snow the same gold is lost in the white, and so are the light hairlines between cells: more fill, and the dark hairline carries the grid.
  const snowy = !!where.snowing, FILL = where.weather?.rain ? 0.03 : snowy ? 0.11 : 0.045;
  const rangeUniforms = { uCells: { value: cellTex }, uCol: { value: KINDS.map((k) => new THREE.Color(MARK[k])) }, uFill: { value: FILL }, uGridDark: { value: snowy ? 0.6 : 0.3 }, uTarget: { value: snowy ? 0.38 : 0.2 }, uThreat: { value: new THREE.Color('#ff4a36') }, uPulse: { value: 0 } };
  const rangeMat = (only) => new THREE.ShaderMaterial({ vertexShader: RANGE_VERT, fragmentShader: RANGE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
    uniforms: { ...rangeUniforms, uOnly: { value: only ? 1 : 0 } } });
  // Where a wood, a hill or a wall in front hides part of the reach, its contour still shows through, faintly (the woods
  // left players guessing which cells they could move or deploy to: feedback, 2026-11-08). Drawn only where the layer
  // fails the depth test, and never over a general: their pictures mark a stencil bit (FIGURE_STENCIL) the ghost avoids.
  const ghostly = (m) => Object.assign(m, { depthFunc: THREE.GreaterDepth, stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: FIGURE_STENCIL, stencilFuncMask: FIGURE_STENCIL, stencilWriteMask: 0,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  const marks = new THREE.Group(); marks.visible = false; scene.add(marks);
  if (!flat) {
    const layer = new THREE.Mesh(rangeGeo, rangeMat(false)), ghost = new THREE.Mesh(rangeGeo, ghostly(rangeMat(true)));
    layer.position.y = ghost.position.y = 0.015; layer.renderOrder = 1; ghost.renderOrder = 4;
    for (const m of [layer, ghost]) { m.frustumCulled = false; m.raycast = () => {}; marks.add(m); }
  }
  let rangeDirty = false, routeDirty = false, walk = [], routeStart = null, inRange = 0, threat = [];
  // --- The route: an arrow along the cells' tops, a light core on a dark edge, and the cost over where it ends. A hovered
  // route (into 'route') and the one being walked (kind 'path' in the range layer) are the same arrow.
  const route = new THREE.Group(); scene.add(route);
  const routeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, fog: false });
  const routeGhost = ghostly(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  const costEl = document.createElement('div'); costEl.className = 'route-cost';
  const costLabel = new CSS2DObject(costEl); costLabel.visible = false; scene.add(costLabel);
  const groundAt = (px, pz) => { const x = Math.min(W - 1, Math.max(0, Math.floor(px + W / 2))), y = Math.min(H - 1, Math.max(0, Math.floor(pz + H / 2))), at = hill(x, y); return at ? at(px + W / 2 - x, pz + H / 2 - y) : topY(x, y); };
  function buildRoute() {
    for (const m of route.children) m.geometry.dispose(); route.clear(); costLabel.visible = false;
    const hov = cells.route.length > 0, list = hov ? cells.route : walk;
    if (flat || !list.length || !routeStart) return;
    // Along the way, a point every quarter cell at the ground's own height, so the arrow climbs a slope instead of cutting through it.
    const way = [routeStart, ...list].map((c) => new THREE.Vector3(wx(c.x), 0, wz(c.y))), pts = [];
    for (let i = 1; i < way.length; i++) for (let s = i === 1 ? 0 : 1; s <= 4; s++) pts.push(way[i - 1].clone().lerp(way[i], s / 4));
    const back = way.at(-1).clone().sub(way.at(-2)).normalize(); pts[pts.length - 1].addScaledVector(back, -0.3);
    for (const q of pts) q.y = groundAt(q.x, q.z) + 0.07;
    const pos = [], col = [], dark = new THREE.Color('#1a1004'), light = new THREE.Color(MARK.path);
    const ribbon = (wd, head, c, lift) => {
      const put = (q) => { pos.push(q.x, q.y + lift, q.z); col.push(c.r, c.g, c.b); };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = b.clone().sub(a); d.y = 0; d.normalize(); const n = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(wd / 2), e = d.clone().multiplyScalar(wd / 2);
        const A = a.clone().sub(e), B = b.clone().add(e); for (const q of [A.clone().add(n), A.clone().sub(n), B.clone().add(n), A.clone().sub(n), B.clone().sub(n), B.clone().add(n)]) put(q);
      }
      const end = pts.at(-1), n = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(head / 2), foot = end.clone().addScaledVector(back, -(head - wd) * 0.35), tip = end.clone().addScaledVector(back, head * 0.95);
      tip.y = groundAt(way.at(-1).x, way.at(-1).z) + 0.07; for (const q of [foot.clone().add(n), foot.clone().sub(n), tip]) put(q);
    };
    ribbon(0.18, 0.52, dark, 0); ribbon(0.09, 0.4, light, 0.004); // the edge first: nothing writes depth, so the core lies over it
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const arrow = new THREE.Mesh(g, routeMat), ghost = new THREE.Mesh(g, routeGhost); arrow.renderOrder = 5; ghost.renderOrder = 5;
    for (const m of [arrow, ghost]) { m.frustumCulled = false; m.raycast = () => {}; route.add(m); }
    const to = list.at(-1), cost = hov ? wv.st.reach?.dist.get(`${to.x},${to.y}`) : null;
    if (cost != null) { costEl.innerHTML = `<b>−${cost}</b>`; costLabel.position.set(wx(to.x), topY(to.x, to.y) + 0.62, wz(to.y)); costLabel.visible = true; }
  }
  const setCell = (x, y, k, hot = 0) => { const i = (y * W + x) * 4; const n = (v) => (v && v !== KIND.self ? 1 : 0); inRange += n(k) - n(cellData[i]); cellData[i] = k; cellData[i + 1] = hot; rangeDirty = true; };
  // into: 'range' or 'route'. The flat map shows none of the 3D scene, so there the cell is only recorded.
  function mark(x, y, kind, into = 'range') {
    cells[into].push({ x, y, kind });
    if (kind === 'path') { // where the route sets out from: he has not moved yet when its first cell is marked
      if (!routeStart || (into === 'range' ? !walk.length : cells.route.length === 1)) routeStart = wv.st.sel ? { x: wv.st.sel.x, y: wv.st.sel.y } : null;
      if (into === 'range') walk.push({ x, y });
      routeDirty = true; return;
    }
    if (flat) return;
    setCell(x, y, KIND[kind]);
    // He stands inside his own reach: his cell joins the region, so no contour is drawn round it.
    const s = wv.st.sel; if ((kind === 'move' || kind === 'castle') && s && !cellData[(s.y * W + s.x) * 4]) setCell(s.x, s.y, KIND.self);
  }
  // The cells the enemy could strike when he next acts (a Set of 'x,y' from field.threat, or null to put it away): kept as data for the
  // flat map and written to the layer's blue channel.
  function setThreat(set) {
    const next = set ? [...set].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }) : [];
    if (next.length === threat.length && next.every((c, i) => c.x === threat[i].x && c.y === threat[i].y)) return;
    threat = next;
    if (flat) return;
    for (let i = 0; i < W * H; i++) cellData[i * 4 + 2] = 0;
    for (const c of threat) cellData[(c.y * W + c.x) * 4 + 2] = 255;
    rangeDirty = true;
  }
  // Each frame (the entry's update): what changed since the last one goes up once, and the glow breathes slowly.
  function overlayTick(time) {
    if (flat) return;
    if (rangeDirty) {
      rangeDirty = false; const to = cells.route.at(-1);
      for (let i = 0; i < W * H; i++) cellData[i * 4 + 1] = to && i === to.y * W + to.x ? 255 : 0; // the hovered destination is lit
      cellTex.needsUpdate = true; marks.visible = inRange > 0 || threat.length > 0;
    }
    if (routeDirty) { routeDirty = false; buildRoute(); }
    rangeUniforms.uPulse.value = 0.5 + 0.5 * Math.sin(time * 2.6);
  }
  // Hover preview: the route the selected officer would take and what it costs, before committing.
  let previewKey = null, previewTip = null;
  function previewAt(c) {
    const key = c ? `${c.x},${c.y}` : null;
    if (key === previewKey) return previewTip;
    previewKey = key; previewTip = null; cells.route.length = 0; routeDirty = rangeDirty = true;
    if (!c || wv.st.busy || field.over) return null;
    // Every cell names its ground, under whoever stands on it (playtest of 2026-10-31, F04: crowded generals hide
    // the cell they stand on and the ones behind it); off his reach, also what one step onto it costs ours.
    const u = wv.st.sel, t = field.unitAt(c.x, c.y), mine = u && u.side === human && field.turn === human;
    const step = mine && !t && !wv.st.deploying && !wv.st.reach?.dist.has(key) ? `　入此格耗 ${field.cost(u, c.x, c.y)}` : '';
    const ground = `<small class="ground">地形 ${field.ground(c.x, c.y)}${step}</small>`;
    if (wv.st.deploying) return (previewTip = ground);
    return (previewTip = [tipAt(c, key, u, t, mine), ground].filter(Boolean).join('<br>'));
  }
  // field.threat for the enemy as the field stands, worked out once for each state of it (a hover asks it for every cell crossed).
  let threatMemo = { key: null, set: new Set() };
  function threatNow() {
    const foe = human === 'att' ? 'def' : 'att', key = `${field.day}:${field.turn}:${field.pool[foe]}:${field.alive.map((u) => `${u.x},${u.y},${u.stop | 0},${u.qimen | 0},${field.O(u.id).soldiers}`).join(';')}`;
    if (threatMemo.key !== key) threatMemo = { key, set: human ? field.threat(foe) : new Set() };
    return threatMemo.set;
  }
  function tipAt(c, key, u, t, mine) {
    const wid = t ? field.O(t.id).weapon : null;   // his weapon's picture closes the line, after 兵 and 体
    const info = t ? `${t.commander ? '★' : ''}${name(t.id)}　兵${field.O(t.id).soldiers}　体${field.O(t.id).hp}${wid != null && data().equipment[wid] ? `　<img class="eqi" src="${equipIcon(wid)}" alt="">` : ''}` : null;
    if (mine && wv.st.cast != null) return t && field.legal(u, wv.st.cast, t) ? `${STRATS[wv.st.cast].name} → ${name(t.id)}` : info;
    if (mine && t && t.side !== human && field.adjacentEnemies(u).includes(t))
      return field.pool[human] >= ATTACK_COST ? `${info}<br>点选后可攻击　机动力 −${ATTACK_COST}（余 ${field.pool[human] - ATTACK_COST}）` : `${info}<br><em>机动力不足，无法攻击</em>`;
    if (mine && !t && wv.st.reach?.dist.has(key)) {
      const cost = wv.st.reach.dist.get(key);
      for (const [px, py] of field.path(wv.st.reach, c.x, c.y)) mark(px, py, 'path', 'route');
      // What standing there would mean (第 3 期, read-only): whom he could strike from it and how many attacks the pool would still
      // pay for, and whether the enemy could strike him there when his side next acts.
      const left = field.pool[human] - cost, foes = field.adjacentEnemies({ ...u, x: c.x, y: c.y }), strikes = Math.floor(left / ATTACK_COST);
      const reachOf = foes.length ? `<br>到此可攻击：${foes.map((e) => name(e.id)).join('、')}${strikes ? `（余下的机动力够攻击 ${strikes} 次）` : '<em>（余下的机动力不够攻击）</em>'}` : '';
      const danger = threatNow().has(key) ? '<br><em>在敌军威胁范围内</em>' : '';
      return `移动　机动力 −${cost}（余 ${left}）${terr(c.x, c.y) === CASTLE && u.side === 'att' ? '<br><strong>踏上城格即攻占</strong>' : ''}${reachOf}${danger}`;
    }
    return info;
  }
  const clearPreview = () => { previewKey = null; previewTip = null; cells.route.length = 0; routeDirty = rangeDirty = true; };
  const clearMarks = () => { cells.range.length = 0; walk = []; routeDirty = true; if (inRange) { for (let i = 0; i < W * H; i++) cellData[i * 4] = 0; inRange = 0; rangeDirty = true; } };
  const cursor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: canvasTex(16, 16, (g) => {
    g.fillStyle = '#fff'; for (const [a, b, c, d] of [[0, 0, 5, 2], [0, 0, 2, 5], [11, 0, 5, 2], [14, 0, 2, 5], [0, 14, 5, 2], [0, 11, 2, 5], [11, 14, 5, 2], [14, 11, 2, 5]]) g.fillRect(a, b, c, d);
  }), transparent: true, depthWrite: false }));
  cursor.rotation.x = -Math.PI / 2; cursor.visible = false; scene.add(cursor);
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 24), new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);
  // Range cells are cleared off the board before a war ends, so the walk over the scene in dispose() no longer finds what they share.
  // The layer and the route are taken off nothing: the walk over the scene in dispose() frees their geometries and materials.
  // What it does not reach: the cells' data texture (a uniform's value is found, a detached label's element is not).
  const disposeOverlay = () => { cellTex.dispose(); costEl.remove(); };
  // markCol: each kind's colour as drawn (tools/war_look_check.mjs: reach is warm gold, a castle reads apart from it). rangeCells: how many cells the layer shows.
  return { cells, marks, mark, clearMarks, clearPreview, previewAt, cursor, selRing, overlayTick, markCol: MARK, rangeCells: () => inRange, routeFrom: () => routeStart, setThreat, threatCells: () => threat, disposeOverlay };
}
