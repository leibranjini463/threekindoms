// Board geometry shared by the 3D sand table and the 2D map, so a data pack's towns and roads (docs/战略地图数据包扩展设计_2026-11-17.md)
// stand in the same place on both: a road's course between two seats, the fresh water it must bridge, and a new town's seat.
// The bake's own roads and towns never come through here; without a pack only courseOf runs, as it always has for a road with no baked course.
import * as THREE from 'three';
import { toX, toZ } from './worldmap.js';

export const TIER_KIND = { capital: 'city-capital', major: 'city-major', county: 'city-county', pass: 'pass' };

// A quadratic curve from p to q bowed `bow` off the straight line, a point every 0.05.
function curve(p, q, bow, groundY) {
  const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
  const cx = (p.x + q.x) / 2 + nx * bow, cz = (p.z + q.z) / 2 + nz * bow, n = Math.ceil(len / 0.05), pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = (1 - t) ** 2 * p.x + 2 * t * (1 - t) * cx + t * t * q.x, z = (1 - t) ** 2 * p.z + 2 * t * (1 - t) * cz + t * t * q.z;
    pts.push(new THREE.Vector3(x, groundY(x, z), z));
  }
  return pts;
}

// The road from city i to city j (i < j) by their seats `pos`, bowing round any other city on the straight line. With `wetCost`
// (a pack on the sand table) the bow is the one of a fan with the least fresh water to bridge, a little for each unit of bow so a
// dry road stays straight.
export function courseOf(i, j, pos, groundY, wetCost = null) {
  const p = pos[i], q = pos[j];
  const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
  // A quadratic curve's offset at t is 2t(1−t)·bow: bow away from the city that needs it most.
  let bow = 0;
  pos.forEach((c, k) => {
    if (k === i || k === j) return;
    const t = ((c.x - p.x) * dx + (c.z - p.z) * dz) / (len * len), s = (c.x - p.x) * nx + (c.z - p.z) * nz;
    if (t < 0.08 || t > 0.92 || Math.abs(s) > 0.6) return;
    const need = (0.62 - Math.abs(s)) / (2 * t * (1 - t));
    if (need > Math.abs(bow)) bow = need * (s > 0 ? -1 : 1);
  });
  bow = Math.max(-len * 0.45, Math.min(len * 0.45, bow));
  let pts = curve(p, q, bow, groundY);
  if (wetCost) {
    let best = wetCost(pts) + Math.abs(bow) * 0.02;
    for (let k = -8; k <= 8; k++) {
      const b2 = len * 0.45 * k / 8, c = curve(p, q, b2, groundY), cost = wetCost(c) + Math.abs(b2) * 0.02;
      if (cost < best - 1e-6) { best = cost; pts = c; }
    }
  }
  return pts;
}

// Is (x, z) on a river or lake of the board (meta.water: the rivers and lakes only; a lake's carved bed can lie below the sea's
// level, so height cannot tell)? The heightfield alone cannot identify them: their triangles are indexed once, with a margin wider
// than half a road sample, so no solid segment bridges the water between samples.
export function waterIndex(water, { cell = 0.5, margin = 0.09 } = {}) {
  const cells = new Map();
  for (const w of water) for (let i = 0; i < w.i.length; i += 3) {
    const a = w.i[i] * 3, b = w.i[i + 1] * 3, c = w.i[i + 2] * 3;
    const tri = [w.v[a], w.v[a + 2], w.v[b], w.v[b + 2], w.v[c], w.v[c + 2]];
    if (Math.abs((tri[2] - tri[0]) * (tri[5] - tri[1]) - (tri[3] - tri[1]) * (tri[4] - tri[0])) < 1e-8) continue;
    const x0 = Math.floor((Math.min(tri[0], tri[2], tri[4]) - margin) / cell), x1 = Math.floor((Math.max(tri[0], tri[2], tri[4]) + margin) / cell);
    const z0 = Math.floor((Math.min(tri[1], tri[3], tri[5]) - margin) / cell), z1 = Math.floor((Math.max(tri[1], tri[3], tri[5]) + margin) / cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(tri); }
  }
  return (x, z) => {
    const tris = cells.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
    if (!tris) return false;
    for (const t of tris) {
      let neg = false, pos = false;
      for (let j = 0; j < 6; j += 2) {
        const k = (j + 2) % 6, dx = t[k] - t[j], dz = t[k + 1] - t[j + 1], cross = dx * (z - t[j + 1]) - dz * (x - t[j]);
        neg ||= cross < 0; pos ||= cross > 0;
        const q = Math.min(1, Math.max(0, ((x - t[j]) * dx + (z - t[j + 1]) * dz) / (dx * dx + dz * dz || 1)));
        if ((x - t[j] - q * dx) ** 2 + (z - t[j + 1] - q * dz) ** 2 <= margin ** 2) return true;
      }
      if (!(neg && pos)) return true;
    }
    return false;
  };
}

// A course's fresh water: its length, and each crossing as much as a stretch of road, so two short bridges beat one along a river.
export const wetCostOf = (waterAt) => (pts) => {
  let w = 0, runs = 0, was = false;
  for (let k = 1; k < pts.length; k++) { const on = waterAt(pts[k].x, pts[k].z); if (on) w += pts[k].distanceTo(pts[k - 1]); if (on && !was) runs++; was = on; }
  return w * 4 + runs * 0.3;
};

// Each run of a course's points over fresh water: [first, last] index, one bridge each.
export function crossings(course, waterAt) {
  const out = [];
  for (let k = 0; k < course.length;) {
    if (!waterAt(course[k].x, course[k].z)) { k++; continue; }
    let e = k; while (e + 1 < course.length && waterAt(course[e + 1].x, course[e + 1].z)) e++;
    out.push([k, e]); k = e + 1;
  }
  return out;
}

// A pack town's seat: the bake levels the ground under its own towns; a new one stands on the highest ground of its footprint, or a
// slope buries its walls. `size`: the board's piece sizes (board.json size).
export function townSeat(c, size, heightAt) {
  const x = toX(c.lon), z = toZ(c.lat), half = size[TIER_KIND[c.tier]] / 2;
  let y = heightAt(x, z);
  for (let k = 0; k < 16; k++) for (const f of [0.5, 1]) y = Math.max(y, heightAt(x + Math.cos(k * Math.PI / 8) * half * f, z + Math.sin(k * Math.PI / 8) * half * f));
  return { x, z, y, half };
}

// The sand table's height at (x, z), from its board.json and height.bin (bilinear, as src/sandtable.js heightAt).
export function heightField(meta, height) {
  const [X0, , Z0] = meta.box, [GW, GH] = meta.grid, [dx, dz] = meta.step;
  const at = (k, j) => meta.h[0] + height[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, k))] / 65535 * (meta.h[1] - meta.h[0]);
  return (x, z) => {
    const fk = (x - X0) / dx, fj = (z - Z0) / dz, k = Math.floor(fk), j = Math.floor(fj), a = fk - k, b = fj - j;
    return (at(k, j) * (1 - a) + at(k + 1, j) * a) * (1 - b) + (at(k, j + 1) * (1 - a) + at(k + 1, j + 1) * a) * b;
  };
}
