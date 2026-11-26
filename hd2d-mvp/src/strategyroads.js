// Strategy roads: receives the scene, board, city positions and ground height; owns the paths and the 道路 overview.
import * as THREE from 'three';
import { SEA_Y } from './worldmap.js';
import { courseOf, waterIndex, wetCostOf } from './packgeo.js';

// How a pack road's course reads fresh water (it takes the course that crosses the least of it).
const ROAD_WATER_CELL = 0.5, ROAD_WATER_MARGIN = 0.09;

export function createStrategyRoads({ scene, data, sand, world, cityPos, groundY }) {
  // Roads: ribbons draped on the land, bowing round any city that sits on the straight line; a crossing by sea (辽东–青州 over
  // the 渤海) is a dashed sea lane. The procedural board (no sand table) draws them always, as packed earth.
  const paths = new Map();
  let wetCost = null; // the sand table's, for a pack's roads (set below): how much of a course runs over fresh water
  const pathOf = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!paths.has(key) && sand && world.roadPath(Math.min(a, b), Math.max(a, b))) paths.set(key, world.roadPath(Math.min(a, b), Math.max(a, b)));
    if (!paths.has(key)) paths.set(key, courseOf(Math.min(a, b), Math.max(a, b), cityPos, groundY, wetCost));
    const pts = paths.get(key);
    return a < b ? pts : [...pts].reverse();
  };
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const dirt = new THREE.Color('#8e7650'), lane = new THREE.Color('#efe4c8');
  // A ribbon of half-width w along a road, lifted by `lift`, its colour and alpha per point: (atSea, run, end) → [Color, alpha].
  const ribbon = (pts, w, lift, paint) => {
    const pos = [], col = [], idx = [];
    let run = 0;
    pts.forEach((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const ox = -dz / L * w, oz = dx / L * w;
      if (k) run += p.distanceTo(pts[k - 1]);
      const ground = world.heightAt(p.x, p.z), atSea = ground < SEA_Y + 0.01, end = Math.min(run, 99) < 0.35 || k > pts.length - 8;
      const y = Math.max(p.y, atSea ? SEA_Y : ground) + lift; // baked paths can run under the surface
      const [cc, alpha] = paint(atSea, run, end);
      pos.push(p.x + ox, y, p.z + oz, p.x - ox, y, p.z - oz); col.push(cc.r, cc.g, cc.b, alpha, cc.r, cc.g, cc.b, alpha);
      if (k) { const v = k * 2; idx.push(v - 2, v, v - 1, v - 1, v, v + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const dash = (run) => Math.floor(run / 0.12) % 2 === 0;
  if (!sand) for (const c of data.cities) for (const n of c.roads) if (c.id < n) { // the sand table's roads are in its bake
    const g = ribbon(pathOf(c.id, n), 0.03, 0.02, (atSea, run, end) => [atSea ? lane : dirt, atSea ? (dash(run) ? 0.75 : 0) : end ? 0.4 : 0.8]);
    const road = new THREE.Mesh(g, roadMat); road.receiveShadow = true; road.renderOrder = 2; scene.add(road);
  }
  // On the sand table no road is drawn until asked for (2026-11-21): its ground carries none (tools/sandtable_deroad.py took the
  // baked roads out of the pictures), so a pack may lay towns and roads anywhere without a second network beside the old one. The
  // 道路 overview below and the selected city's beads (strategymarks.js) are the roads. No bridge either, the board's own (sandtable.js
  // UNSEEN) or one for a pack's road. A pack road's course still takes the bow that crosses the least fresh water.
  if (sand && data.pack) {
    // A pack's extension regions bring their own rivers (sandregions.js); without one, the original board's alone.
    wetCost = wetCostOf(waterIndex(sand.regions?.length ? [...sand.meta.water, ...sand.regions.flatMap((r) => r.meta.water)] : sand.meta.water, { cell: ROAD_WATER_CELL, margin: ROAD_WATER_MARGIN }));
  }
  // 道路 overview (playtest of 2026-10-30, T15): every road at once, a bright lacquer-gold line on a dark edge so it
  // reads over sand, snow and water alike; sea lanes dashed. Built on first use; roads(on) shows it.
  let overview = null;
  const buildOverview = () => {
    const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: false });
    const edge = new THREE.Color('#2a1606'), gold = new THREE.Color('#ffd878'), sea = new THREE.Color('#e8f4ff');
    for (const c of data.cities) for (const n of c.roads) if (c.id < n) {
      const pts = pathOf(c.id, n);
      const under = new THREE.Mesh(ribbon(pts, 0.075, 0.035, (atSea, run) => [edge, atSea ? (dash(run) ? 0.5 : 0) : 0.55]), mat);
      const line = new THREE.Mesh(ribbon(pts, 0.036, 0.04, (atSea, run) => [atSea ? sea : gold, atSea ? (dash(run) ? 0.95 : 0) : 0.95]), mat);
      under.renderOrder = 3; line.renderOrder = 4; grp.add(under, line);
    }
    scene.add(grp); return grp;
  };
  let roadsOn = false;
  return {
    pathOf,
    roads(on) { roadsOn = on; if (on) overview ??= buildOverview(); if (overview) overview.visible = on; },
    get roadsOn() { return roadsOn; },
  };
}
