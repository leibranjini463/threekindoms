// Where an extension board lies flush against another (docs/战略地图右侧扩展_方案_2026-11-17.md, docs/战略地图日本地块_方案_2026-11-17.md):
// its heights ease in from the neighbour's edge, so the coast and hills run on across the seam instead of stepping there. A board
// meets its neighbours on its west side (the original's east edge, or the north strip's) and on its south side (the original's
// north edge). The 3D board (sandtable.js opts.seams), the 2D map (strategyflat.js) and the pack check (tools/check_pack.mjs) all
// read the eased heights, so a town the check lets stand on land stands on land on both maps. No imports: tools/check_pack.mjs
// runs it under node.

// Over a stretch whose width wavers along the seam: where the region's land meets the original's open sea (黄海道 reaches lon 125,
// the original has sea there) the shore it leaves bends like a coast rather than running straight down the seam.
export const SEAM_BLEND = 0.6;
const width = (s) => SEAM_BLEND * Math.max(0.25, 0.6 + 0.45 * Math.sin(s * 4.7 + 1.3) * Math.cos(s * 1.9) + 0.3 * Math.sin(s * 11.3));
// H: the board's heights (world units, row 0 north), eased in place. seams.west { x, at(x, z) }: its first column stands at x, the
// west neighbour's last column, and eases from at(x, z) there; seams.south { z, at(x, z) }: its last row stands at z, the south
// neighbour's first row. The west seam goes first, so the south seam's corner eases into heights already eased.
export function easeSeams(H, meta, seams) {
  const [X0, , Z0] = meta.box, [GW, GH] = meta.grid, [dx, dz] = meta.step, { west, south } = seams;
  if (west) for (let j = 0; j < GH; j++) {
    const z = Z0 + j * dz, e = west.at(west.x, z), B = width(z);
    for (let k = 0; k * dx < B; k++) { const t = k * dx / B, w = t * t * (3 - 2 * t), i = j * GW + k; H[i] = e + (H[i] - e) * w; }
  }
  if (south) for (let k = 0; k < GW; k++) {
    const x = k === 0 && west ? west.x : X0 + k * dx, e = south.at(x, south.z), B = width(x);
    for (let m = 0; m * dz < B && m < GH; m++) { const t = m * dz / B, w = t * t * (3 - 2 * t), i = (GH - 1 - m) * GW + k; H[i] = e + (H[i] - e) * w; }
  }
}
// A board's last grid column, where a board flush east of it has its first column (the original's at 12.12, in a box to 12.15).
export const lastColumn = (meta) => meta.box[0] + (meta.grid[0] - 1) * meta.step[0];
const near = (a, b) => Math.abs(a - b) < 1e-6;
// The seams of a board (box) against the boards already placed ([{ meta, heightAt }], in build order: the original first, then the
// boards by their west edge, south before north): { west, south }, either missing where nothing lies flush there.
export function seamsOf(box, placed) {
  const [x0, , , z1] = box;
  const pick = (list, lo, hi) => (s) => (list.find((n) => s >= n.meta.box[lo] - 1e-6 && s <= n.meta.box[hi] + 1e-6) ?? list.reduce((a, n) => (Math.abs(s - (n.meta.box[lo] + n.meta.box[hi]) / 2) < Math.abs(s - (a.meta.box[lo] + a.meta.box[hi]) / 2) ? n : a)));
  const west = placed.filter((n) => near(n.meta.box[1], x0) && n.meta.box[3] > box[2] && n.meta.box[2] < z1);
  const south = placed.filter((n) => near(n.meta.box[2], z1) && n.meta.box[1] > x0 && n.meta.box[0] < box[1]);
  const seams = {};
  if (west.length) { const by = pick(west, 2, 3); seams.west = { x: lastColumn(west[0].meta), at: (x, z) => by(z).heightAt(x, z) }; }
  if (south.length) { const by = pick(south, 0, 1); seams.south = { z: south[0].meta.box[2], at: (x, z) => by(x).heightAt(x, z) }; }
  return seams.west || seams.south ? seams : null;
}
// The order boards are built and eased in: the original, then the others by their west edge, the southern one first where two share it.
export const buildOrder = (metas) => metas.map((m, k) => k).sort((a, b) => metas[a].box[0] - metas[b].box[0] || metas[b].box[3] - metas[a].box[3]);
// Bilinear heights over a board's grid, as sandtable.js heightAt.
export function gridHeightAt(meta, H) {
  const [X0, , Z0] = meta.box, [GW, GH] = meta.grid, [dx, dz] = meta.step;
  const at = (k, j) => H[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, k))];
  return (x, z) => {
    const fk = (x - X0) / dx, fj = (z - Z0) / dz, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    return (at(k, j) * (1 - a) + at(k + 1, j) * a) * (1 - b) + (at(k, j + 1) * (1 - a) + at(k + 1, j + 1) * a) * b;
  };
}
// The extension boards' heights as their boards stand them (each { meta: board.json, height: height.bin as Uint16Array }), eased
// into the boards placed before them; main: { meta, heightAt } of the original board. Returns their heightAt, in the order given.
export function regionHeights(regions, main) {
  const placed = [main], out = [];
  for (const k of buildOrder(regions.map((r) => r.meta))) {
    const { meta, height } = regions[k], N = meta.grid[0] * meta.grid[1], H = new Float32Array(N);
    for (let i = 0; i < N; i++) H[i] = meta.h[0] + height[i] / 65535 * (meta.h[1] - meta.h[0]);
    const seams = seamsOf(meta.box, placed);
    if (seams) easeSeams(H, meta, seams);
    out[k] = gridHeightAt(meta, H); placed.push({ meta, heightAt: out[k] });
  }
  return out;
}
// One board's, for a single region (as regionHeights).
export const regionHeightAt = (meta, height, main) => regionHeights([{ meta, height }], main)[0];
