// The war map's pointer (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): the ray pick of a cell or a figure,
// who covers a cell from the camera, each figure's fade, and the ground view (T) with its terrain plaques.
// terrainOn is reassigned by setTerrainView (the entry's api) and read here and by units.js: it is wv.terrainOn, never copied.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { W, H } from '../core/field.js';

export function makePick(wv) {
  const { field, human, scene, camera, wx, wz, inside, topY, APRON, GW, GH, tiles, views, figureBox } = wv;
  const ray = new THREE.Raycaster();
  // A unit card is a 1.7-cell-tall quad, so a neighbour standing in front covers the cells behind it
  // (player feedback N08). The pick sees through the card where it is transparent (the material's own
  // alphaTest), and while choosing a destination a free cell in reach under the cursor beats a figure
  // that is not itself a target there; that unit is still picked by clicking low on its own cell.
  const alphas = new WeakMap(), uvp = new THREE.Vector2();
  function opaque(hit) {
    const tex = hit.object.material.map, img = tex?.image;
    if (!img || !hit.uv) return true;
    let a = alphas.get(img);
    if (!a) {
      const w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
      try { a = { w, h, d: cx.getImageData(0, 0, w, h).data }; } catch { return true; }
      alphas.set(img, a);
    }
    tex.updateMatrix(); tex.transformUv(uvp.copy(hit.uv));
    const px = Math.min(a.w - 1, Math.floor(uvp.x * a.w)), py = Math.min(a.h - 1, Math.floor(uvp.y * a.h));
    return a.d[(py * a.w + px) * 4 + 3] >= 128;
  }
  // A cell the current mode would act on as an empty cell (a move destination or a deployment square).
  const freeTarget = (c) => c && !field.unitAt(c.x, c.y) && (wv.st.deploying ? !!wv.st.sel && wv.inRect(c.x, c.y)
    : wv.st.cast == null && wv.st.sel?.side === human && !!wv.st.reach?.dist.has(c.x + ',' + c.y));
  // A figure the current mode would act on: a legal 计略 target, or an enemy the selected unit can attack.
  const unitTarget = (u) => wv.st.sel && (wv.st.cast != null ? field.legal(wv.st.sel, wv.st.cast, u)
    : u.side !== human && field.adjacentEnemies(wv.st.sel).includes(u));
  // Who covers a cell (playtest of 2026-10-31, F04): the generals nearer the camera than the cell whose figure's
  // picture stands over the middle of it on screen (its centre, or two of the four points a quarter cell round it) while
  // they stand on another cell. A figure is about a cell tall, so one a step in front only reaches the cell's near edge
  // and covers nothing; one on higher ground, or a tall one, does.
  // Hovering the cell fades them to 0.3 (their rings stay) so it can be seen, and the pointer leaving the map brings them
  // back; so does the figure the pointer reaches through to a free cell behind him (st.through). Read off the camera,
  // so a turn, a pan or a march changes it.
  const SPOTS = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]], cellPts = SPOTS.map(() => new THREE.Vector3()), footPt = new THREE.Vector3(), cornerPt = new THREE.Vector3();
  function coveringUnits(x, y) {
    if (!inside(x, y)) return [];
    camera.updateMatrixWorld();
    SPOTS.forEach(([dx, dz], i) => cellPts[i].set(wx(x) + dx, topY(x, y), wz(y) + dz));
    const cz = footPt.copy(cellPts[0]).applyMatrix4(camera.matrixWorldInverse).z;
    for (const p of cellPts) p.project(camera);
    return coverers(x, y, cz);
  }
  function coverers(x, y, cz) {
    const out = [];
    for (const [u, v] of views) {
      if (v.fading || !v.g.parent || !v.bill.visible || (u.x === x && u.y === y)) continue;
      if (footPt.copy(v.g.position).applyMatrix4(camera.matrixWorldInverse).z < cz + 0.05) continue; // not nearer the camera than the cell
      const { x0, x1, y0, y1 } = figureBox(v, 0.9);
      const trim = (x1 - x0) * 0.12; // his picture has air at the sides
      const inRect = cellPts.map((p) => p.x > x0 + trim && p.x < x1 - trim && p.y > y0 && p.y < y1);
      if (inRect[0] || inRect.filter(Boolean).length >= 2) out.push(u); // over its centre, or over half the ground round it
    }
    return out;
  }
  // Body opacity of every general each frame: 1, 0.3 where the hovered cell is covered, 0.18 in the ground view (T).
  // Faded, a figure stops writing depth and is drawn after the cell overlays, so the ground and whoever stands behind
  // him show through; back at 1 his material is the opaque one again.
  wv.terrainOn = false;
  function fadeUnits(dt) {
    const cov = !wv.terrainOn && !wv.view.tactical && wv.st.hoverCell ? new Set([...coveringUnits(wv.st.hoverCell.x, wv.st.hoverCell.y), ...(wv.st.through ? [wv.st.through] : [])]) : null, k = 1 - Math.exp(-dt * 25);
    for (const [u, v] of views) {
      if (v.fading) continue;
      const goal = wv.terrainOn ? 0.18 : cov?.has(u) ? 0.3 : 1, m = v.body.material;
      v.opa += (goal - v.opa) * k; if (Math.abs(goal - v.opa) < 0.004) v.opa = goal;
      if (v.opa >= 1) { if (v.faded) { v.faded = false; m.transparent = false; m.opacity = 1; m.alphaTest = 0.5; m.depthWrite = true; v.body.renderOrder = 0; } }
      else { v.faded = true; m.transparent = true; m.opacity = v.opa; m.alphaTest = 0.5 * v.opa; m.depthWrite = false; v.body.renderOrder = 5; } // alphaTest sees the faded alpha
    }
  }
  // T: every figure a ghost (0.18), the name tags away, the x-ray ghosts off, and on each cell a general stands on and the two
  // behind it along the line of sight a small plaque naming its terrain (like the flat map's ground view), edged in the terrain's colour.
  const gtags = new Map();
  function groundTags() {
    const step = [Math.round(-Math.sin(wv.view.yaw)), Math.round(-Math.cos(wv.view.yaw))], want = new Set();
    for (const u of field.alive) { if (u.gone) continue; for (let d = 0; d < 3; d++) { const x = u.x + step[0] * d, y = u.y + step[1] * d; if (inside(x, y)) want.add(`${x},${y}`); } }
    // With one of ours picked, every other cell of his reach says what stepping onto it costs him (第 3 期): the terrain's cost for
    // his arm and numbers (field.cost), which the hover told only for cells outside the reach.
    const s = wv.st.sel, costs = new Map();
    if (s && !s.gone && s.side === human && field.turn === human && wv.st.cast == null && wv.st.reach && !wv.st.deploying)
      for (const k of wv.st.reach.dist.keys()) if (k !== `${s.x},${s.y}` && !want.has(k)) costs.set(`c:${k}:${s.id}`, k);
    for (const [key, o] of gtags) if (!want.has(key) && !costs.has(key)) { scene.remove(o); gtags.delete(key); }
    for (const key of want) if (!gtags.has(key)) {
      const [x, y] = key.split(',').map(Number), t = field.ground(x, y), el = document.createElement('div');
      el.className = 'gtag'; el.dataset.terrain = t; el.textContent = t;
      const o = new CSS2DObject(el); o.position.set(wx(x), topY(x, y) + 0.04, wz(y)); scene.add(o); gtags.set(key, o);
    }
    for (const [key, k] of costs) if (!gtags.has(key)) {
      const [x, y] = k.split(',').map(Number), el = document.createElement('div');
      el.className = 'gcost'; el.textContent = field.cost(s, x, y);
      const o = new CSS2DObject(el); o.position.set(wx(x), topY(x, y) + 0.04, wz(y)); scene.add(o); gtags.set(key, o);
    }
  }
  const tagsShown = () => { for (const v of views.values()) if (!v.fading) v.label.visible = !wv.view.tactical && !wv.terrainOn; };
  // The ground under a ray without raycasting the whole terrain (~150k triangles, ~5 ms a pointer move): the
  // terrain's triangles are filed once under every grid cell their footprint touches, then the ray walks the
  // cells in order (Amanatides–Woo) and tests only those of the cell it is crossing, front faces only like the
  // Raycaster. The first hit inside a cell's stretch of the ray is the nearest, so it is the same face, point and
  // cell the mesh raycast found. Returns { t, cell } with t the distance along the ray (cell null off the board).
  let cellTris = null;
  function indexTerrain() {
    const meshes = tiles.children.map((m) => ({ pos: m.geometry.attributes.position.array, idx: m.geometry.index.array, own: m.geometry.userData.owner }));
    const lists = Array.from({ length: GW * GH }, () => []);
    meshes.forEach(({ pos, idx }, m) => {
      for (let f = 0; f < idx.length; f += 3) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < 3; k++) { const i = idx[f + k] * 3, x = pos[i] + W / 2 + APRON, z = pos[i + 2] + H / 2 + APRON; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        // Faces on a cell border (walls) are filed under the cells on both sides.
        for (let Y = Math.max(0, Math.floor(z0 - 1e-4)); Y <= Math.min(GH - 1, Math.floor(z1 + 1e-4)); Y++)
          for (let X = Math.max(0, Math.floor(x0 - 1e-4)); X <= Math.min(GW - 1, Math.floor(x1 + 1e-4)); X++) lists[Y * GW + X].push(m, f);
      }
    });
    return { meshes, lists };
  }
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), vp = new THREE.Vector3(), vn = new THREE.Vector3(), vt = new THREE.Vector3();
  function groundHit(r) {
    cellTris ??= indexTerrain();
    const { origin: o, direction: d } = r, gx = o.x + W / 2 + APRON, gz = o.z + H / 2 + APRON;
    // Where the ray enters the grid's footprint (it may start outside it).
    let tEnter = 0, tLeave = Infinity;
    for (const [p, v, n] of [[gx, d.x, GW], [gz, d.z, GH]]) {
      if (Math.abs(v) < 1e-9) { if (p < 0 || p >= n) return null; continue; }
      const a = (0 - p) / v, b = (n - p) / v;
      tEnter = Math.max(tEnter, Math.min(a, b)); tLeave = Math.min(tLeave, Math.max(a, b));
    }
    if (tEnter >= tLeave) return null;
    let X = Math.min(GW - 1, Math.floor(gx + d.x * (tEnter + 1e-6))), Y = Math.min(GH - 1, Math.floor(gz + d.z * (tEnter + 1e-6)));
    const sx = Math.sign(d.x), sz = Math.sign(d.z);
    const dX = sx ? Math.abs(1 / d.x) : Infinity, dZ = sz ? Math.abs(1 / d.z) : Infinity;
    let tX = sx ? ((sx > 0 ? X + 1 : X) - gx) / d.x : Infinity, tZ = sz ? ((sz > 0 ? Y + 1 : Y) - gz) / d.z : Infinity;
    const { meshes, lists } = cellTris;
    while (X >= 0 && Y >= 0 && X < GW && Y < GH) {
      const tExit = Math.min(tX, tZ), list = lists[Y * GW + X];
      let best = Infinity, owner = -1;
      for (let i = 0; i < list.length; i += 2) {
        const { pos, idx } = meshes[list[i]], f = list[i + 1];
        va.fromArray(pos, idx[f] * 3); vb.fromArray(pos, idx[f + 1] * 3); vc.fromArray(pos, idx[f + 2] * 3);
        if (!r.intersectTriangle(va, vb, vc, true, vp)) continue;
        const t = o.distanceTo(vp);
        if (t < best && t >= tEnter - 1e-4 && t <= tExit + 1e-4) { best = t; owner = meshes[list[i]].own[f / 3]; vn.subVectors(vc, vb).cross(vt.subVectors(va, vb)).normalize(); } // three's face normal
      }
      if (best < Infinity) {
        // As the mesh pick did: step just inside the face that was hit and read the cell from the position.
        r.at(best, vp).addScaledVector(vn, -0.01);
        // A face is its cell's (diorama.js owner): a wall is the cell on top of it, and a top's rim is that cell's too, however far the
        // wobble bulges either over the lower ground. A mesh without owners is read from the position.
        const x = owner >= 0 ? (owner % GW) - APRON : Math.floor(vp.x + W / 2), y = owner >= 0 ? Math.floor(owner / GW) - APRON : Math.floor(vp.z + H / 2);
        return { t: best, cell: inside(x, y) ? { x, y } : null, wall: vn.y < 0.5 }; // wall: a cliff's face, not the top of a cell
      }
      tEnter = tExit;
      if (tX < tZ) { X += sx; tX += dX; } else { Y += sz; tZ += dZ; }
    }
    return null;
  }
  // The general whose name tag lies under a point of the screen (第 3 期, 7A): the tags are kept clear of each other and of the
  // hills, so a general a hill hides can always be pointed at by his tag. Where two overlap, the one drawn on top.
  function tagAt(ndc) {
    if (wv.view.tactical || wv.terrainOn) return null;
    const px = (ndc.x + 1) / 2 * innerWidth, py = (1 - ndc.y) / 2 * innerHeight; let best = null, bz = -Infinity;
    for (const [u, v] of views) {
      if (v.fading || u.gone || !v.label.visible || !v.el.isConnected || !inside(u.x, u.y)) continue;
      const r = v.el.getBoundingClientRect(); if (!r.width || px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      const z = Number(v.el.style.zIndex) || 0; if (z >= bz) { bz = z; best = u; }
    }
    return best;
  }
  // Marked cells a hill, a wall or a wood's ground in front hides (第 3 期, 7A): where the ray meets the top of a cell of the reach
  // (or of the deployment squares) behind what it hit first, the nearest such cell.
  const topPt = new THREE.Vector3();
  function markedBehind(r, tFront) {
    let best = null, bt = Infinity;
    for (const c of wv.cells.range) {
      if (c.kind !== 'move' && c.kind !== 'castle' && c.kind !== 'deploy') continue;
      const y = topY(c.x, c.y), t = (y - r.origin.y) / r.direction.y; if (!(t > tFront + 0.05) || t >= bt) continue;
      r.at(t, topPt); if (Math.abs(topPt.x - wx(c.x)) <= 0.5 && Math.abs(topPt.z - wz(c.y)) <= 0.5) { bt = t; best = c; }
    }
    return best && { x: best.x, y: best.y, behind: true };
  }
  function pick(ndc) {
    // His name tag is his: a click on it is a click on him, through the same entry and the same guards as one on the map.
    ray.setFromCamera(ndc, camera);
    const ground = groundHit(ray.ray), cell = ground?.cell ?? null, wall = !!ground?.wall;
    // As with his figure below: while a destination is being chosen, a free cell of the reach under the pointer beats the tag of a
    // general who is not himself a target there.
    const tagged = tagAt(ndc); if (tagged) return freeTarget(cell) && !wall && !unitTarget(tagged) ? { ...cell, through: tagged } : { x: tagged.x, y: tagged.y, tag: true };
    // Figures in front of the ground, nearest first; anything behind it is hidden by the terrain.
    const hits = wv.view.tactical ? [] : ray.intersectObjects([...views.values()].filter((v) => v.g.parent).map((v) => v.body), false);
    for (const hit of hits) {
      const u = hit.object.userData.unit;
      if (ground && hit.distance > ground.t) break;
      if (!opaque(hit)) continue;
      if (freeTarget(cell) && !unitTarget(u)) return { ...cell, through: u };
      return { x: u.x, y: u.y };
    }
    // What the ground in front hides. A cell the mode would act on, or one a general stands on, is itself what is pointed at.
    // A cliff's face belongs to the cell on top of it, which has its own top to be pointed at: on the face, a marked cell behind wins.
    if (ground && !wv.view.tactical && (!freeTarget(cell) || wall) && !(cell && field.unitAt(cell.x, cell.y))) {
      // A general behind a hill shows through it as a silhouette in his side's colour (units.js xray): the silhouette is his too.
      if (!freeTarget(cell)) for (const hit of hits) { const u = hit.object.userData.unit, v = views.get(u); if (hit.distance > ground.t && v?.xray.visible && !v.fading && inside(u.x, u.y) && opaque(hit)) return { x: u.x, y: u.y, behind: true }; }
      const c = wv.st.deploying ? (wv.st.sel ? markedBehind(ray.ray, ground.t) : null) : wv.st.cast == null && wv.st.sel?.side === human ? markedBehind(ray.ray, ground.t) : null;
      if (c) return c;
    }
    return cell;
  }
  return { pick, opaque, coveringUnits, fadeUnits, groundTags, tagsShown, gtags, cornerPt };
}
