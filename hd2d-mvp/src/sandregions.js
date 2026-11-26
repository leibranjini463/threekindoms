// The sand table with official extension regions (docs/战略地图数据包扩展设计_2026-11-17.md §5.5): the original board and each
// region's board, each built by sandtable.js buildSandtable, set in one frame on one table. Only a data pack that names regions
// (data.pack.regions) comes here; without one strategy.js builds the original board alone, exactly as before.
//
// One frame follows the joint outline of the boards: boards closer than BRIDGE apart are joined by open sea (the outline closes
// over the strait), so no frame stands between them; separate frames would overlap, and the original's east side would cover
// the region's western shore. The outline is rectilinear: each straight run gets one carved box on its outer side, north and
// south runs reaching over the corners as the original's do, east and west runs between them.
import * as THREE from 'three';
import { buildSandtable } from './sandtable.js';
import { toX, toZ } from './worldmap.js';
import { seamsOf, buildOrder } from './regionseam.js';

// SEAM: the open sea reaches a hair over the boards' own; UNDER: the sea bed a grid step under their ground (a board's last grid column
// may stop short of its box: the original's at 12.12 in a box to 12.15).
const FW = 1.5, BRIDGE = 2 * FW, SEAM = 0.004, UNDER = 0.07; // the frame's width (sandtable.js), and the widest strait that is closed over with sea

const inBox = ([X0, X1, Z0, Z1], x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
const seatIn = (box, c) => typeof c.lon === 'number' && inBox(box, toX(c.lon), toZ(c.lat));

// The boards' rectangles and the sea between those close enough, as cells of the grid of all their edges; `fill` per cell.
export function jointOutline(boxes) {
  const rects = boxes.map((b) => [...b]);
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) if (i !== j) {
    const [a0, a1, b0, b1] = boxes[i], [c0, c1, d0, d1] = boxes[j];
    // j east of i across a gap no wider than BRIDGE, overlapping in z: the strait between them, over their shared z.
    if (c0 > a1 && c0 - a1 <= BRIDGE && Math.min(b1, d1) > Math.max(b0, d0)) rects.push([a1, c0, Math.max(b0, d0), Math.min(b1, d1)]);
    // j south of i (z grows southward), overlapping in x.
    if (d0 > b1 && d0 - b1 <= BRIDGE && Math.min(a1, c1) > Math.max(a0, c0)) rects.push([Math.max(a0, c0), Math.min(a1, c1), b1, d0]);
  }
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[1]]))].sort((a, b) => a - b), zs = [...new Set(rects.flatMap((r) => [r[2], r[3]]))].sort((a, b) => a - b);
  const NX = xs.length - 1, NZ = zs.length - 1, fill = new Uint8Array(NX * NZ);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
    fill[i * NZ + j] = rects.some((r) => inBox(r, x, z)) ? 1 : 0;
  }
  const on = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ && fill[i * NZ + j] === 1;
  // Boundary runs: horizontal ones (along x, at a z line) and vertical ones (along z, at an x line), merged where collinear.
  const runs = [];
  for (let j = 0; j <= NZ; j++) for (const out of [-1, 1]) { // out −1: the filled cell is south (open to the north)
    let start = null;
    for (let i = 0; i <= NX; i++) {
      const edge = i < NX && (out < 0 ? on(i, j) && !on(i, j - 1) : on(i, j - 1) && !on(i, j));
      if (edge && start == null) start = i;
      if (!edge && start != null) { runs.push({ h: true, at: zs[j], from: xs[start], to: xs[i], out, i0: start, i1: i, j }); start = null; }
    }
  }
  for (let i = 0; i <= NX; i++) for (const out of [-1, 1]) { // out −1: the filled cell is east (open to the west)
    let start = null;
    for (let j = 0; j <= NZ; j++) {
      const edge = j < NZ && (out < 0 ? on(i, j) && !on(i - 1, j) : on(i - 1, j) && !on(i, j));
      if (edge && start == null) start = j;
      if (!edge && start != null) { runs.push({ h: false, at: xs[i], from: zs[start], to: zs[j], out, j0: start, j1: j, i }); start = null; }
    }
  }
  // A horizontal run's end is a convex corner (it reaches FW past it, over the side run's end) or a concave one (it stops FW
  // short, where the side run's box already stands). Which: is the cell beyond the end, on the run's inner side, filled?
  for (const r of runs) if (r.h) {
    const inner = r.out < 0 ? r.j : r.j - 1;
    r.from += on(r.i0 - 1, inner) ? FW : -FW;
    r.to += on(r.i1, inner) ? -FW : FW;
  }
  return { xs, zs, fill, NX, NZ, runs };
}

// The band of the original's light and ground pictures along its north edge, scaled row by row (gains per channel, row 0 north;
// tools/region_seam_blend.py measures them against the rows past the band). Once per loaded picture.
function liftEdge(S, edge) {
  for (const [key, gains] of Object.entries(edge)) {
    const t = S[key]; if (!t?.image || t.userData.lifted) continue;
    const img = t.image, w = img.width, h = img.height, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const band = g.getImageData(0, 0, w, gains.length), d = band.data;
    for (let r = 0; r < gains.length; r++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) { const i = (r * w + x) * 4 + ch; d[i] = Math.min(255, d[i] * gains[r][ch] + 0.5); }
    g.putImageData(band, 0, 0); t.image = c; t.userData.lifted = true; t.needsUpdate = true;
  }
}

// The boards' shallows maps (sea.png) laid side by side at the original's texel density, in world space over the boards' joint box,
// halved twice and kept with mipmaps: the sea's depth (sandtable.js waterMat, opts.shelf) reads its coarse mip levels from this one
// picture, so they average across a board's edge instead of stopping at it (each board's own coarse levels disagreed at the seam,
// a line down the Yellow Sea from far off; docs/战略地图海面拼缝_修复指南_2026-11-21.md). Black where no board lies: open sea.
function jointShelf(S, regions, boxes) {
  const J = boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.max(u[1], b[1]), Math.min(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, -Infinity, Infinity, -Infinity]);
  const [JX0, JX1, JZ0, JZ1] = J, [X0, X1, Z0, Z1] = S.meta.box, px = S.sea.image.width / (X1 - X0), pz = S.sea.image.height / (Z1 - Z0);
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const full = canvas(Math.round((JX1 - JX0) * px), Math.round((JZ1 - JZ0) * pz)), g = full.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, full.width, full.height);
  // Row 0 of each picture is its north (least z), as the canvas's top: no flip.
  for (const B of [S, ...regions]) { const [b0, b1, b2, b3] = B.meta.box; g.drawImage(B.sea.image, (b0 - JX0) * px, (b2 - JZ0) * pz, (b1 - b0) * px, (b3 - b2) * pz); }
  // Two halvings, not one step to a quarter: the shallows band is a few texels wide and a single step samples it unevenly.
  const half = (src) => { const c = canvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2)), h = c.getContext('2d'); h.imageSmoothingEnabled = true; h.drawImage(src, 0, 0, c.width, c.height); return c; };
  const map = new THREE.CanvasTexture(half(half(full)));
  map.anisotropy = 8; map.colorSpace = THREE.NoColorSpace; // as sea.png's (loadSandtable): anisotropy changes which mip level is read
  return { map, box: J };
}

export function buildBoards(scene, S, opts = {}) {
  const regions = S.regions, boxes = [S.meta.box, ...regions.map((R) => R.meta.box)];
  opts = { ...opts, shelf: jointShelf(S, regions, boxes) };
  const ownerOf = (c) => { const k = regions.findIndex((R) => seatIn(R.meta.box, c)); return k + 1; }; // 0: the original board
  // What each board adds to the scene is marked with its box: the 2D map's bake (strategy.js bakeView) clips each board's pieces at its own edge.
  // A board flush east of another starts on that one's last grid column (opts.seams.west), a hair west of its box: its clip reaches there too.
  const build = (B, o) => { const n = scene.children.length, b = buildSandtable(scene, B, o), [x0, ...rest] = B.meta.box, clip = [o.seams?.west ? Math.min(x0, o.seams.west.x - 1e-3) : x0, ...rest]; for (const c of scene.children.slice(n)) c.userData.clip = clip; return b; };
  // A board flush north of the original (the north strip, docs/战略地图日本地块_方案_2026-11-17.md) meets it where its bake shaded
  // its own frame: that band of its light and ground pictures is lifted to the board's own (the region's board.json mainEdge).
  for (const R of regions) if (R.meta.mainEdge) liftEdge(S, R.meta.mainEdge);
  const main = build(S, { ...opts, owns: (c) => ownerOf(c) === 0, frame: false });
  const light = { ...main.lightUniforms, uWoodsFloor: main.uWoodsFloor };
  // A town on another board stands, on this one's list, at the seat the original board gives it (its baked seat for the 30).
  const seat = (c) => main.cities[c.id];
  // A board flush against one built before it starts on that one's last grid column or first row and eases its heights in from
  // there (sandtable.js opts.seams, regionseam.js; docs/战略地图右侧扩展_方案_2026-11-17.md). West and south neighbours come first.
  const placed = [{ meta: S.meta, heightAt: main.heightAt }], parts = [];
  for (const k of buildOrder(regions.map((R) => R.meta))) {
    const R = regions[k], seams = seamsOf(R.meta.box, placed) ?? undefined;
    parts[k] = build(R, { ...opts, owns: (c) => ownerOf(c) === k + 1, frame: false, light, seat, seams });
    parts[k].name = R.name; placed.push({ meta: R.meta, heightAt: parts[k].heightAt });
  }
  const boards = [main, ...parts];
  const boardAt = (x, z) => boards.find((b) => inBox(b.box, x, z));
  const SEA_Y = main.sea, SEABED = Math.min(...boards.map((b, k) => (k ? regions[k - 1] : S).meta.h[0]));

  // ---- Frame and table, as sandtable.js's but along the joint outline ----
  const { xs, zs, fill, NX, NZ, runs } = jointOutline(boxes);
  const top = SEA_Y + 0.36, BOT = -2;
  const carve = S.frame; carve.wrapS = carve.wrapT = THREE.RepeatWrapping;
  const lacquer = new THREE.MeshStandardMaterial({ color: '#2a120a', roughness: 0.35, metalness: 0 });
  for (const r of runs) {
    const len = r.to - r.from, mid = (r.from + r.to) / 2, off = r.at + r.out * FW / 2;
    const [x, z, ry] = r.h ? [mid, off, r.out < 0 ? 0 : Math.PI] : [off, mid, r.out < 0 ? Math.PI / 2 : -Math.PI / 2];
    // The carving's pattern runs on in step with the original frame's over the part they share (its runs start at its corners).
    const [oX0, oX1, oZ0, oZ1] = S.meta.box, phase = r.h ? (r.out < 0 ? r.from - (oX0 - FW) : oX1 + FW - r.to) : (r.out < 0 ? oZ1 - r.to : r.from - oZ0);
    const t = carve.clone(); t.repeat.set(len / FW, 1); t.offset.x = phase / FW; t.needsUpdate = true;
    const topMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.35 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, top - BOT, FW), [lacquer, lacquer, topMat, lacquer, lacquer, lacquer]);
    box.position.set(x, (top + BOT) / 2, z); box.rotation.y = ry; scene.add(box);
    // A run along the original board's own edge, where its frame stood: the 2D map keeps the original's picture there (tools/bake_strategy_flat.mjs --region).
    const [X0, X1, Z0, Z1] = S.meta.box, along = r.h ? (r.at === Z0 || r.at === Z1) && r.from < X1 && r.to > X0 : (r.at === X0 || r.at === X1) && r.from < Z1 && r.to > Z0;
    box.userData.mainFrame = along;
  }
  const table = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#1a0c06', roughness: 0.6 }));
  table.rotation.x = -Math.PI / 2; table.position.y = BOT; scene.add(table);
  // The open sea in the straits: a sea bed in the boards' deep-water colour, the original board's sea over it.
  const bedMat = new THREE.MeshBasicMaterial({ color: '#26303a' });
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) if (fill[i * NZ + j]) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    if (boxes.some((b) => inBox(b, (x0 + x1) / 2, (z0 + z1) / 2))) continue;
    // A hair over the boards' own sea, or a crack shows the sea bed; its shallows blend from the original's to the nearest region's.
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, d = (b) => Math.hypot(Math.max(b[0] - cx, 0, cx - b[1]), Math.max(b[2] - cz, 0, cz - b[3]));
    const R = regions.reduce((p, q) => (d(q.meta.box) < d(p.meta.box) ? q : p));
    main.seaPatch(x0 - SEAM, x1 + SEAM, z0 - SEAM, z1 + SEAM, { sea: R.sea, box: R.meta.box });
    // The bed meets each board's own edge (its heights run on past its edge as its edge row) and blends between them, so the
    // shading of depth (SSAO) finds no step at a board's edge to draw a line along.
    const g = new THREE.PlaneGeometry(x1 - x0 + 2 * UNDER, z1 - z0 + 2 * UNDER, Math.max(1, Math.ceil((x1 - x0) / 0.06)), Math.max(1, Math.ceil((z1 - z0) / 0.06))), p = g.attributes.position;
    g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), z = p.getZ(v); let w = 0, y = 0;
      for (const b of boards) {
        const [bx0, bx1, bz0, bz1] = b.box, d = Math.hypot(Math.max(bx0 - x, 0, x - bx1), Math.max(bz0 - z, 0, z - bz1));
        if (d < 1e-6) { w = 1; y = b.heightAt(x, z); break; }
        w += 1 / d ** 2; y += b.heightAt(x, z) / d ** 2;
      }
      p.setY(v, Math.min(y / w, SEA_Y - 0.02));
    }
    g.computeVertexNormals(); scene.add(new THREE.Mesh(g, bedMat));
  }

  // Each town from the board it stands on; every board's list has the same towns in the same order (index = id).
  const cities = main.cities.map((c, i) => (c.away ? parts[ownerOf(opts.cities[i]) - 1].cities[i] : c));
  const height = (fn) => (x, z) => { const b = boardAt(x, z); return b ? b[fn](x, z) : SEABED; };
  const [X0, X1, Z0, Z1] = boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.max(u[1], b[1]), Math.min(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, -Infinity, Infinity, -Infinity]);
  return {
    ...main,
    heightAt: height('heightAt'), surfaceAt: height('surfaceAt'), table, cities, box: [X0, X1, Z0, Z1], boards,
    disableDetail() { for (const b of boards) b.disableDetail(); },
    setTerritory(on) { for (const b of boards) b.setTerritory(on); },
    setTerritoryFocus(on) { for (const b of boards) b.setTerritoryFocus(on); },
    tintAt: (x, z) => (boardAt(x, z) ?? main).tintAt(x, z),
    nearLods() { for (const b of boards) b.nearLods(); },
    tint(...a) { for (const b of boards) b.tint(...a); },
    update(...a) { for (const b of boards) b.update(...a); },
  };
}
