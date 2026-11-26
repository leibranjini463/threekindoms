// Solid set pieces for the war-map diorama: volumetric trees (leafy crowns and pines built from jittered
// low-poly blobs with pixel leaf textures and leaf cards on the rim to break the faceted silhouette), the
// walled castle that fits its single cell, and village houses — all with curved Chinese hip roofs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, rng } from './pixel.js';

// ---------- Textures ----------
const px = (w, h, draw) => canvasTex(w, h, draw, { repeat: true });
// Leaf mass: overlapping 3–4 texel leaf clumps over a dark ground, lit tops, so a crown reads as foliage up close.
function leafTex(pal, seed) {
  return px(32, 32, (g) => {
    const r = rng(seed);
    g.fillStyle = pal[0]; g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 150; i++) {
      const x = (r() * 32) | 0, y = (r() * 32) | 0, k = r(), c = k < 0.3 ? pal[1] : k < 0.75 ? pal[2] : k < 0.95 ? pal[3] : pal[4];
      g.fillStyle = c;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [1, -1]]) if (r() < 0.8) g.fillRect((x + dx + 32) % 32, (y + dy + 32) % 32, 1, 1);
      g.fillStyle = pal[0]; g.fillRect((x + 1) % 32, (y + 2) % 32, 1, 1);
    }
  });
}
// Leaf card: a ragged clump with transparent gaps, for the crown's outline.
function cardTex(pal, seed) {
  return canvasTex(16, 16, (g) => {
    const r = rng(seed);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 6.5, x = Math.round(8 + Math.cos(a) * d), y = Math.round(8 + Math.sin(a) * d);
      g.fillStyle = y < 7 ? pal[3] : d > 5 ? pal[1] : pal[2]; g.fillRect(x, y, 1 + (r() < 0.4), 1);
    }
  });
}
const barkTex = px(8, 16, (g) => {
  const r = rng(5); g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, 8, 16);
  for (let i = 0; i < 18; i++) { g.fillStyle = r() < 0.5 ? '#4e3826' : '#2a1e14'; g.fillRect((r() * 8) | 0, (r() * 16) | 0, 1, 2 + ((r() * 3) | 0)); }
});
// Roof tiles: rows of half-round tile ridges running down the slope (瓦垄), a lit crest on each.
export function roofTex(base, dark, lit) {
  return px(16, 16, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 16, 16);
    for (let x = 0; x < 16; x += 4) { g.fillStyle = dark; g.fillRect(x, 0, 1, 16); g.fillStyle = lit; g.fillRect(x + 2, 0, 1, 16); }
    g.fillStyle = dark; for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x += 4) g.fillRect(x + 1, y + 3, 3, 1);
  });
}
const thatchTex = px(16, 16, (g) => {
  const r = rng(9); g.fillStyle = '#7a6440'; g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.5 ? '#94784a' : '#5e4a2e'; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 2 + ((r() * 3) | 0)); }
  g.fillStyle = '#4a3a24'; for (let y = 5; y < 16; y += 6) g.fillRect(0, y, 16, 1);
});
// Hall front: red columns between whitewashed bays with lattice windows, a dark sill.
const hallTex = px(48, 16, (g) => {
  g.fillStyle = '#d8ccb0'; g.fillRect(0, 0, 48, 16);
  for (let b = 0; b < 3; b++) {
    const x = b * 16; g.fillStyle = '#8a2a1e'; g.fillRect(x, 0, 2, 16); g.fillStyle = '#a63a28'; g.fillRect(x, 0, 1, 16);
    g.fillStyle = '#4a2a1a'; g.fillRect(x + 5, 4, 7, 7);
    g.fillStyle = '#b08a52'; for (let k = 0; k < 7; k += 2) { g.fillRect(x + 5 + k, 4, 1, 7); g.fillRect(x + 5, 4 + k, 7, 1); }
  }
  g.fillStyle = '#6a2018'; g.fillRect(0, 0, 48, 2); g.fillStyle = '#3a2a1e'; g.fillRect(0, 14, 48, 2);
});
// Village wall: plaster in a dark timber frame, one door and a small window.
const houseTex = px(32, 16, (g) => {
  g.fillStyle = '#cfc2a2'; g.fillRect(0, 0, 32, 16);
  g.fillStyle = '#4a3220'; g.fillRect(0, 0, 32, 1); g.fillRect(0, 15, 32, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16); g.fillRect(31, 0, 1, 16); g.fillRect(0, 7, 32, 1);
  g.fillStyle = '#2e2016'; g.fillRect(5, 8, 5, 7); g.fillStyle = '#5a3e26'; g.fillRect(6, 9, 3, 6);
  g.fillStyle = '#3a2a1c'; g.fillRect(20, 3, 6, 3); g.fillStyle = '#8a6a40'; g.fillRect(22, 3, 1, 3); g.fillRect(24, 3, 1, 3);
});
const stoneTex = px(16, 16, (g) => {
  g.fillStyle = '#857a64'; g.fillRect(0, 0, 16, 16);
  const r = rng(3);
  for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? -4 : 0; x < 16; x += 8) {
    g.fillStyle = ['#7a705c', '#8e836c', '#9a8f76'][(r() * 3) | 0]; g.fillRect(x + 1, y + 1, 7, 3);
    g.fillStyle = '#a89c82'; g.fillRect(x + 1, y + 1, 7, 1);
  }
  g.fillStyle = '#4e463a'; for (let y = 0; y < 16; y += 4) g.fillRect(0, y, 16, 1);
});
const earthTex = px(16, 16, (g) => { // rammed-earth courtyard wall
  const r = rng(4); g.fillStyle = '#9a7e58'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#866a48'; for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
  for (let i = 0; i < 20; i++) { g.fillStyle = r() < 0.5 ? '#aa8e66' : '#7a6040'; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 1); }
});

export const M = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0, ...extra });
export const MAT = {
  bark: M(barkTex), hall: M(hallTex), house: M(houseTex), stone: M(stoneTex), earth: M(earthTex),
  roofDark: M(roofTex('#3a4250', '#262c36', '#56606e'), { side: THREE.DoubleSide }),
  roofGrey: M(roofTex('#55534e', '#3a3934', '#706d66'), { side: THREE.DoubleSide }),
  thatch: M(thatchTex, { side: THREE.DoubleSide }),
  ridge: new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.9 }),
  red: new THREE.MeshStandardMaterial({ color: '#8a2a1e', roughness: 0.9 }),
  gate: new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 1 }),
  lantern: new THREE.MeshStandardMaterial({ color: '#c0402a', emissive: '#ff6a30', emissiveIntensity: 1.6 }),
  wood: new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1 }),
  hay: new THREE.MeshStandardMaterial({ color: '#a8843f', roughness: 1, flatShading: true }),
  crate: new THREE.MeshStandardMaterial({ color: '#6e5032', roughness: 1 }),
};

// ---------- Curved hip roof ----------
// A height field over the eave rectangle: "roof distance" d is 0 on the ridge and 1 on the eaves, the slope
// is concave (y = H(1−d)^1.6, like a 庑殿/歇山 profile) and the corners lift. ax/az: eave half sizes;
// ridge: share of ax the ridge runs along x.
function roofGeo(ax, az, H, ridge = 0.45, lift = 0.25, n = 16) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const s = i / n * 2 - 1, t = j / n * 2 - 1;
    const ds = Math.max(0, (Math.abs(s) - ridge) / (1 - ridge)), d = Math.min(1, Math.max(Math.abs(t), ds));
    const corner = Math.pow(Math.max(0, Math.abs(s) - 0.55) / 0.45 * Math.max(0, Math.abs(t) - 0.55) / 0.45, 1.5);
    pos.push(s * ax, H * Math.pow(1 - d, 1.6) + lift * H * corner, t * az);
    const zFace = Math.abs(t) >= ds; // which slope the vertex is on decides the tile direction
    uv.push((zFace ? s * ax : t * az) * 8, d * 3);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d2 = c + 1; idx.push(a, c, b, b, c, d2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function piece(parent, geo, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
// Roof with a ridge beam and small upturned ridge ends (鸱吻).
export function roof(parent, ax, az, H, y, mat, { ridge = 0.45, lift = 0.25, ridgeMat = MAT.ridge, n = 16 } = {}) {
  piece(parent, roofGeo(ax, az, H, ridge, lift, n), mat, 0, y, 0);
  const rl = ax * ridge * 2;
  if (rl > 0.01) {
    piece(parent, new THREE.BoxGeometry(rl + 0.02, 0.025, 0.03), ridgeMat, 0, y + H + 0.008, 0);
    for (const sx of [-1, 1]) piece(parent, new THREE.BoxGeometry(0.02, 0.05, 0.03), ridgeMat, sx * (rl / 2 + 0.005), y + H + 0.03, 0).rotation.z = -sx * 0.4;
  }
}
// Glazed tiles in a faction's colour: the same tile pattern shaded from that hue.
function glazed(hex) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  const at = (l, sat = 0.55) => '#' + new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, sat), l).getHexString();
  return M(roofTex(at(0.28), at(0.16), at(0.42)), { side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
}

// ---------- Castle ----------
// One cell: a stone platform ringed by a crenellated wall with corner towers, a gate tower over the front
// (+z) wall, and a three-storey keep at the back that rises well above the board, leaving the middle open for
// the unit holding the castle. Main roofs are glazed in the holder's colour with gilded ridges; the group is
// scaled a little past the cell so the walls sit on its rim.
// opts.roofMat replaces the glazed roof (the strategy map tints one material per owner); opts.lights: false
// leaves out the point lights (thirty castles on one map).
// opts.facing: the quarter turn (radians about the vertical) that sends the gate from +z to where the defenders deploy.
export function buildFortress(scene, c, color = '#5a5a66', { roofMat = null, lights: withLights = true, facing = 0 } = {}) {
  const g = new THREE.Group(); g.position.set(c.x, c.h, c.z); g.rotation.y = facing; g.scale.setScalar(1.1); g.userData.landmark = 'castle'; scene.add(g);
  const roofM = roofMat ?? glazed(color), gold = new THREE.MeshStandardMaterial({ color: '#c8a050', roughness: 0.4, metalness: 0.6 });
  const E = 0.44, WH = 0.22, WT = 0.07;
  // Walls, split at the front for the gate.
  const wall = (x, z, len, ry) => piece(g, new THREE.BoxGeometry(len, WH, WT), MAT.stone, x, WH / 2, z, ry);
  wall(0, -E, 2 * E, 0); wall(-E, 0, 2 * E, Math.PI / 2); wall(E, 0, 2 * E, Math.PI / 2);
  wall(-0.27, E, 0.34, 0); wall(0.27, E, 0.34, 0);
  // Merlons along the outer lip of every wall.
  const merlon = new THREE.BoxGeometry(0.045, 0.05, 0.03), ms = [];
  for (let k = -E + 0.06; k <= E - 0.05; k += 0.095) {
    ms.push([k, -E - WT / 2 + 0.015, 0], [-E - WT / 2 + 0.015, k, Math.PI / 2], [E + WT / 2 - 0.015, k, Math.PI / 2]);
    if (Math.abs(k) > 0.12) ms.push([k, E + WT / 2 - 0.015, 0]);
  }
  for (const [x, z, ry] of ms) piece(g, merlon, MAT.stone, x, WH + 0.025, z, ry);
  // Corner towers with small roofs.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const t = new THREE.Group(); t.position.set(sx * E, 0, sz * E); g.add(t);
    piece(t, new THREE.BoxGeometry(0.13, WH + 0.1, 0.13), MAT.stone, 0, (WH + 0.1) / 2, 0);
    piece(t, new THREE.BoxGeometry(0.1, 0.08, 0.1), MAT.hall, 0, WH + 0.14, 0);
    roof(t, 0.1, 0.1, 0.07, WH + 0.18, roofM, { ridge: 0, lift: 0.35 });
  }
  // Gate tower: arched opening in a stone block, a pavilion on top.
  const gt = new THREE.Group(); gt.position.set(0, 0, E); g.add(gt);
  piece(gt, new THREE.BoxGeometry(0.22, WH + 0.04, 0.12), MAT.stone, 0, (WH + 0.04) / 2, 0);
  piece(gt, new THREE.BoxGeometry(0.08, 0.14, 0.125), MAT.gate, 0, 0.07, 0.001);
  piece(gt, new THREE.BoxGeometry(0.2, 0.1, 0.09), MAT.hall, 0, WH + 0.09, 0);
  roof(gt, 0.17, 0.1, 0.08, WH + 0.14, roofM, { ridgeMat: gold });
  for (const sx of [-1, 1]) { const l = piece(gt, new THREE.BoxGeometry(0.025, 0.035, 0.025), MAT.lantern, sx * 0.07, WH + 0.13, 0.075); l.castShadow = false; }
  // Keep: a tall stone podium, then three red-columned storeys stepping in, each under its own curved roof,
  // with lanterns hung at the eave corners of the lower two.
  const hall = new THREE.Group(); hall.position.set(0, 0, -0.22); g.add(hall);
  piece(hall, new THREE.BoxGeometry(0.52, 0.14, 0.27), MAT.stone, 0, 0.07, 0);
  const storeys = [[0.42, 0.17, 0.19, 0.3, 0.17, 0.09], [0.32, 0.14, 0.15, 0.24, 0.13, 0.09], [0.22, 0.12, 0.11, 0.17, 0.1, 0.11]];
  let y = 0.14;
  storeys.forEach(([w, h, d, ax, az, rh], k) => {
    piece(hall, new THREE.BoxGeometry(w, h, d), MAT.hall, 0, y + h / 2, 0);
    roof(hall, ax, az, rh, y + h, roofM, { ridgeMat: k === 2 ? gold : MAT.ridge, lift: 0.3 });
    if (k < 2) for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const l = piece(hall, new THREE.BoxGeometry(0.022, 0.032, 0.022), MAT.lantern, sx * ax * 0.92, y + h - 0.02, sz * az * 0.92); l.castShadow = false;
    }
    y += h + rh * 0.55;
  });
  // A gilded finial on the top ridge.
  piece(hall, new THREE.ConeGeometry(0.02, 0.07, 6), gold, 0, y + 0.08, 0);
  // Lanterns along the inside of the side walls.
  for (const sx of [-1, 1]) for (const z of [-0.05, 0.25]) { const l = piece(g, new THREE.BoxGeometry(0.022, 0.03, 0.022), MAT.lantern, sx * (E - 0.06), WH + 0.02, z); l.castShadow = false; }
  // Banners on the gate tower.
  const flagTex = canvasTex(12, 20, (q) => { q.fillStyle = '#7a1e18'; q.fillRect(0, 0, 12, 20); q.fillStyle = '#a42a20'; q.fillRect(0, 0, 9, 17); q.fillStyle = '#d8b050'; q.fillRect(0, 17, 12, 1); q.fillRect(3, 5, 4, 1); q.fillRect(4, 4, 2, 7); });
  const flags = [];
  for (const sx of [-1, 1]) {
    piece(gt, new THREE.CylinderGeometry(0.007, 0.007, 0.42, 5), MAT.wood, sx * 0.13, WH + 0.21, 0.02);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.14, 4, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 1 }));
    f.geometry.translate(0.045 * sx, 0, 0); f.position.set(sx * 0.13, WH + 0.34, 0.02); f.castShadow = true; gt.add(f); flags.push(f);
  }
  // Warm light spilling from the gate and the hall.
  const lights = [];
  if (!withLights) return { lights, flags, group: g };
  // Kept low and in front of the buildings, so they light walls and ground rather than flare on the roofs.
  for (const [x, y, z] of [[0, 0.2, E + 0.3], [0, 0.12, 0.08]]) { const l = new THREE.PointLight('#ff9a48', 1.1, 1.8, 1.8); l.position.set(c.x + x * Math.cos(facing) + z * Math.sin(facing), c.h + y, c.z - x * Math.sin(facing) + z * Math.cos(facing)); scene.add(l); lights.push(l); }
  return { lights, flags, group: g };
}

// ---------- Village ----------
// A main house at the back and a side house, a low rammed-earth wall closing the back corner; the middle of
// the cell stays open. Returns the label anchor (above the main roof).
const farmhouses = (g, r) => {
  const house = (x, z, w, d, hgt, ry, roofMat) => {
    const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
    piece(h, new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.02), MAT.stone, 0, 0.015, 0);
    piece(h, new THREE.BoxGeometry(w, hgt, d), MAT.house, 0, 0.03 + hgt / 2, 0);
    roof(h, w / 2 + 0.05, d / 2 + 0.05, hgt * 0.75, 0.03 + hgt, roofMat, { ridge: 0.5, lift: roofMat === MAT.thatch ? 0.05 : 0.2 });
  };
  house(-0.1, -0.29, 0.58, 0.26, 0.24, 0, r() < 0.5 ? MAT.roofGrey : MAT.thatch);
  house(0.31, 0.08, 0.38, 0.2, 0.2, Math.PI / 2, r() < 0.5 ? MAT.thatch : MAT.roofGrey);
  piece(g, new THREE.BoxGeometry(0.06, 0.1, 0.36), MAT.earth, -0.43, 0.05, 0.05);
  piece(g, new THREE.BoxGeometry(0.24, 0.1, 0.06), MAT.earth, 0.26, 0.05, -0.43);
  // Clutter in the front corners: a haystack, stacked crates, a barrel.
  const hay = new THREE.ConeGeometry(0.11, 0.2, 7); hay.translate(0, 0.1, 0);
  piece(g, hay, MAT.hay, -0.32, 0, 0.32);
  piece(g, new THREE.BoxGeometry(0.09, 0.09, 0.09), MAT.crate, 0.3, 0.045, 0.34, 0.3);
  piece(g, new THREE.BoxGeometry(0.07, 0.07, 0.07), MAT.crate, 0.32, 0.125, 0.33, -0.2);
  piece(g, new THREE.CylinderGeometry(0.04, 0.04, 0.11, 8), MAT.crate, 0.18, 0.055, 0.4);
};
// ---------- Field shops ----------
// Three buildings, one per kind of village cell (米店 / 武器店 / 病院), each inside its own cell with a low earth
// wall on the back corner and its clutter in the front. They read apart at the far zoom step by one tall piece:
// the smithy's chimney with its smoke wisp, the rice store's round granary, the clinic's porch and herb racks.
const plankTex = px(16, 16, (g) => { // vertical boards with dark seams and a few knots
  const r = rng(21); g.fillStyle = '#8a6a44'; g.fillRect(0, 0, 16, 16);
  for (let x = 0; x < 16; x += 4) { g.fillStyle = '#5e4630'; g.fillRect(x, 0, 1, 16); g.fillStyle = '#9c7a50'; g.fillRect(x + 2, 0, 1, 16); }
  for (let i = 0; i < 10; i++) { g.fillStyle = '#6e5236'; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 2); }
  g.fillStyle = '#4a3624'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1);
});
const wattleTex = px(16, 16, (g) => { // woven withy basket: offset rows of short strokes
  g.fillStyle = '#9a7a46'; g.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y += 2) for (let x = (y / 2) % 2 ? 2 : 0; x < 16; x += 4) { g.fillStyle = '#b8955a'; g.fillRect(x, y, 3, 1); g.fillStyle = '#6e5430'; g.fillRect(x, y + 1, 4, 1); }
});
const sackTex = px(16, 16, (g) => { // burlap with a tied neck
  const r = rng(22); g.fillStyle = '#c9b88a'; g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? '#b3a173' : '#dccb9c'; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 2, 1); }
  g.fillStyle = '#6a5a3a'; g.fillRect(0, 2, 16, 1);
});
const trayTex = px(16, 16, (g) => { // bamboo tray strewn with dried herbs
  const r = rng(23); g.fillStyle = '#c4aa62'; g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 16; i += 2) { g.fillStyle = '#a58a46'; g.fillRect(i, 0, 1, 16); }
  for (let i = 0; i < 46; i++) { g.fillStyle = ['#5e7a3a', '#8a9a48', '#7a4a2a', '#b88a3a'][(r() * 4) | 0]; g.fillRect((r() * 16) | 0, (r() * 16) | 0, 2, 1); }
});
const bannerTex = (ch, bg, fg) => canvasTex(16, 24, (g) => { // a 幌子: dyed cloth, a pale border, one big character
  g.fillStyle = bg; g.fillRect(0, 0, 16, 24); g.fillStyle = fg; g.fillRect(0, 0, 16, 1); g.fillRect(0, 23, 16, 1); g.fillRect(0, 0, 1, 24); g.fillRect(15, 0, 1, 24);
  g.fillStyle = fg; g.font = 'bold 14px "PingFang SC","Microsoft YaHei",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 8, 12);
  g.fillStyle = bg; for (let x = 1; x < 15; x += 3) g.fillRect(x, 22, 1, 2); // swallow-tail hem
});
const smokeTex = canvasTex(32, 32, (g) => { // a soft puff
  const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15); gr.addColorStop(0, 'rgba(235,232,226,0.85)'); gr.addColorStop(0.6, 'rgba(210,206,200,0.4)'); gr.addColorStop(1, 'rgba(200,196,190,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const SHOP = {
  plank: M(plankTex), wattle: M(wattleTex), sack: M(sackTex), tray: M(trayTex),
  roofBlue: M(roofTex('#4a5668', '#2e3846', '#6a7a90'), { side: THREE.DoubleSide }),
  iron: new THREE.MeshStandardMaterial({ color: '#34363c', roughness: 0.6, metalness: 0.4 }),
  ember: new THREE.MeshStandardMaterial({ color: '#c8501e', emissive: '#ff7a2a', emissiveIntensity: 1.4 }),
  steel: new THREE.MeshStandardMaterial({ color: '#aeb4bc', roughness: 0.45, metalness: 0.5 }),
  jar: new THREE.MeshStandardMaterial({ color: '#7a4a2c', roughness: 0.8 }),
  jarWhite: new THREE.MeshStandardMaterial({ color: '#d8d0bc', roughness: 0.8 }),
  gourd: new THREE.MeshStandardMaterial({ color: '#cf9a28', roughness: 0.7 }),
  shield: new THREE.MeshStandardMaterial({ color: '#8a2a1e', roughness: 0.8 }),
  grain: new THREE.MeshStandardMaterial({ color: '#d6bd6a', roughness: 1 }),
  cord: new THREE.MeshStandardMaterial({ color: '#2a1e14', roughness: 1 }),
  smoke: new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.55 }),
};
const banners = {};
const bannerMat = (ch, bg, fg) => (banners[ch] ||= new THREE.MeshStandardMaterial({ map: bannerTex(ch, bg, fg), side: THREE.DoubleSide, roughness: 1 }));
// A box whose texture keeps its scale: every face's UV spans its real size over `tile` world units.
function sbox(w, h, d, tile = 0.11) {
  const gg = new THREE.BoxGeometry(w, h, d), uv = gg.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) { const i = face * 4 + k; uv.setXY(i, uv.getX(i) * dims[face][0] / tile, uv.getY(i) * dims[face][1] / tile); }
  return gg;
}
// A roof centred on (x, z) of the building group (roof() centres on its parent).
function roofAt(g, x, z, ...a) { const p = new THREE.Group(); p.position.set(x, 0, z); g.add(p); roof(p, ...a); return p; }
const named = (m, name) => { m.name = name; return m; };
const cyl = (r0, r1, h, n = 8, y0 = 0) => { const gg = new THREE.CylinderGeometry(r1, r0, h, n); gg.translate(0, y0 + h / 2, 0); return gg; };
// A pole with a swallow-tailed cloth hanging from a short arm: the shop's 幌子.
function banner(g, x, z, ch, bg, fg, ry = 0, height = 0.5) {
  const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = ry; g.add(b); b.name = 'banner';
  piece(b, cyl(0.011, 0.011, height, 5), MAT.wood, 0, 0, 0);
  piece(b, new THREE.BoxGeometry(0.1, 0.01, 0.01), MAT.wood, 0.05, height - 0.012, 0);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.115), bannerMat(ch, bg, fg)); cloth.position.set(0.05, height - 0.075, 0); cloth.castShadow = true; b.add(cloth);
  return b;
}
// The low rammed-earth wall on a back corner, as the farmhouse has: short enough to clear every shop's footprint on
// either side (the buildings keep |x|, |z| <= 0.48 with their eaves). It is one group so a mirror flips it (scale.x -1).
function wallCorner(g, sx = -1) {
  const w = new THREE.Group(); w.name = 'courtyardWall'; if (sx > 0) w.scale.x = -1; g.add(w);
  piece(w, new THREE.BoxGeometry(0.06, 0.1, 0.26), MAT.earth, -0.44, 0.05, -0.3);
  piece(w, new THREE.BoxGeometry(0.22, 0.1, 0.06), MAT.earth, -0.34, 0.05, -0.45);
  return w;
}
function post(g, x, z, h, r = 0.014) { return piece(g, cyl(r, r, h, 6), MAT.wood, x, 0.03, z); }

function smithy(g) {
  // Open-fronted forge shed: posts, a back wall, a side wall, a deep grey tiled roof.
  const sx = 0.04, sz = -0.2, w = 0.66, d = 0.4, ph = 0.22;
  piece(g, sbox(w, 0.03, d), MAT.stone, sx, 0.015, sz);
  piece(g, new THREE.BoxGeometry(w - 0.04, ph, 0.04), MAT.house, sx, 0.03 + ph / 2, sz - d / 2 + 0.04);
  piece(g, new THREE.BoxGeometry(0.04, ph, d - 0.06), MAT.house, sx - w / 2 + 0.04, 0.03 + ph / 2, sz);
  for (const [x, z] of [[sx + w / 2 - 0.04, sz + d / 2 - 0.04], [sx - w / 2 + 0.04, sz + d / 2 - 0.04], [sx + w / 2 - 0.04, sz - d / 2 + 0.04]]) post(g, x, z, ph);
  roofAt(g, sx, sz, w / 2 + 0.05, d / 2 + 0.05, 0.2, 0.03 + ph, MAT.roofGrey, { ridge: 0.55, lift: 0.18 });
  // Stone forge against the back wall, its chimney rising past the ridge, a glow at the mouth and a wisp of smoke.
  const forge = new THREE.Group(); forge.position.set(sx + 0.16, 0.03, sz - 0.1); g.add(forge); forge.name = 'forge';
  piece(forge, sbox(0.17, 0.1, 0.13), MAT.stone, 0, 0.05, 0);
  piece(forge, new THREE.BoxGeometry(0.08, 0.02, 0.01), SHOP.ember, 0, 0.07, 0.066);
  const chim = named(piece(forge, sbox(0.065, 0.54, 0.065, 0.09), MAT.stone, 0.02, 0.1 + 0.27, -0.02), 'chimney');
  piece(forge, sbox(0.085, 0.025, 0.085, 0.09), MAT.stone, 0.02, 0.645, -0.02);
  // Anvil on a stump and a water tub.
  piece(g, cyl(0.04, 0.045, 0.07, 8), MAT.wood, sx - 0.06, 0.03, sz + 0.07);
  piece(g, new THREE.BoxGeometry(0.1, 0.03, 0.05), SHOP.iron, sx - 0.06, 0.115, sz + 0.07, 0.4);
  piece(g, new THREE.BoxGeometry(0.03, 0.025, 0.04), SHOP.iron, sx - 0.06, 0.1, sz + 0.07, 0.4);
  piece(g, cyl(0.05, 0.045, 0.08, 10), MAT.wood, sx + 0.24, 0.03, sz + 0.12);
  // Weapon rack by the door: two uprights, a cross rail, spears and halberds leaning on it, two shields.
  const rack = new THREE.Group(); rack.position.set(-0.34, 0.03, 0.2); rack.rotation.y = 0.15; g.add(rack); rack.name = 'weaponRack';
  for (const x of [-0.1, 0.1]) piece(rack, cyl(0.012, 0.012, 0.3, 5), MAT.wood, x, 0, 0);
  piece(rack, new THREE.BoxGeometry(0.24, 0.015, 0.02), MAT.wood, 0, 0.16, 0); piece(rack, new THREE.BoxGeometry(0.24, 0.015, 0.02), MAT.wood, 0, 0.26, 0);
  for (let i = 0; i < 5; i++) {
    const x = -0.09 + i * 0.045, len = 0.5 + (i % 2) * 0.06;
    const shaft = piece(rack, cyl(0.005, 0.005, len, 4), MAT.wood, x, 0, 0.02); shaft.rotation.z = (i - 2) * 0.03;
    const a = (i - 2) * 0.03, tip = piece(rack, i % 2 ? new THREE.BoxGeometry(0.03, 0.045, 0.006) : new THREE.ConeGeometry(0.01, 0.05, 4), SHOP.steel, x - Math.sin(a) * len, Math.cos(a) * len + 0.02, 0.02); tip.rotation.z = a;
  }
  for (const [x, z, ry] of [[0.17, 0.04, 0.3], [0.2, -0.01, -0.4]]) {
    const sh = piece(rack, cyl(0.055, 0.055, 0.014, 12), SHOP.shield, x, 0.058, z); sh.rotation.set(Math.PI / 2 - 0.35, ry, 0, 'YXZ');
    piece(rack, cyl(0.014, 0.014, 0.018, 8), SHOP.steel, x, 0.058, z + 0.012).rotation.set(Math.PI / 2 - 0.35, ry, 0, 'YXZ');
  }
  banner(g, 0.36, 0.36, '武', '#8a2a1e', '#f0e2b8', 0);
  // Smoke: soft puffs that rise from the chimney top, grow and fade.
  const puffs = []; for (let i = 0; i < 4; i++) { const s = new THREE.Sprite(SHOP.smoke.clone()); s.name = 'smoke'; g.add(s); puffs.push(s); }
  const cx = forge.position.x + 0.02, cz = forge.position.z - 0.02;
  return (t) => puffs.forEach((s, i) => { const k = (t * 0.18 + i / puffs.length) % 1; s.position.set(cx + k * 0.1 + Math.sin(t + i) * 0.01, 0.68 + k * 0.32, cz); const sc = 0.07 + k * 0.14; s.scale.set(sc, sc, 1); s.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.15)); });
}

function riceStore(g) {
  // A plank storehouse on a stone plinth under a deep thatched roof, a round granary beside it.
  const sx = -0.15, sz = -0.28, w = 0.48, d = 0.26, hh = 0.2;
  piece(g, sbox(w + 0.04, 0.05, d + 0.04), MAT.stone, sx, 0.025, sz);
  piece(g, new THREE.BoxGeometry(w, hh, d), SHOP.plank, sx, 0.05 + hh / 2, sz);
  piece(g, new THREE.BoxGeometry(0.1, 0.15, 0.012), MAT.gate, sx - 0.1, 0.05 + 0.075, sz + d / 2 + 0.003); // double door
  piece(g, new THREE.BoxGeometry(0.004, 0.15, 0.014), MAT.wood, sx - 0.1, 0.125, sz + d / 2 + 0.005);
  roofAt(g, sx, sz, w / 2 + 0.07, d / 2 + 0.07, 0.2, 0.05 + hh - 0.02, MAT.thatch, { ridge: 0.5, lift: 0.06 });
  // Round granary (圆囤): a wattle drum on short stone legs under a conical thatch cap with a knob.
  const gr = new THREE.Group(); gr.position.set(0.28, 0, 0.1); g.add(gr); gr.name = 'granary';
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; piece(gr, cyl(0.02, 0.02, 0.05, 5), MAT.stone, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1); }
  piece(gr, cyl(0.145, 0.14, 0.31, 14), SHOP.wattle, 0, 0.05, 0);
  piece(gr, cyl(0.148, 0.148, 0.015, 14), MAT.wood, 0, 0.05, 0);
  piece(gr, cyl(0.148, 0.148, 0.015, 14), MAT.wood, 0, 0.345, 0);
  const cap = new THREE.ConeGeometry(0.2, 0.22, 14, 1, true); cap.translate(0, 0.11, 0);
  piece(gr, cap, MAT.thatch, 0, 0.36, 0);
  piece(gr, new THREE.SphereGeometry(0.024, 6, 5), MAT.thatch, 0, 0.585, 0);
  // Sacks stacked in the front corner, baskets and 斗 measures of grain by the door.
  const sack = (x, y, z, ry) => piece(g, new THREE.BoxGeometry(0.11, 0.065, 0.065), SHOP.sack, x, y, z, ry);
  sack(-0.34, 0.0325, 0.3, 0.1); sack(-0.2, 0.0325, 0.31, -0.06); sack(-0.28, 0.0975, 0.3, 0.05); sack(-0.34, 0.0325, 0.4, 0.25); sack(-0.22, 0.0325, 0.4, -0.2); sack(-0.28, 0.1, 0.4, 0.1);
  for (const [x, z] of [[0.06, 0.34], [0.2, 0.38]]) {
    piece(g, cyl(0.05, 0.06, 0.06, 10), SHOP.wattle, x, 0, z);
    piece(g, cyl(0.05, 0.05, 0.004, 10), SHOP.grain, x, 0.058, z);
  }
  piece(g, new THREE.BoxGeometry(0.05, 0.05, 0.05), MAT.wood, 0.32, 0.025, 0.36, 0.3);
  piece(g, new THREE.BoxGeometry(0.036, 0.003, 0.036), SHOP.grain, 0.32, 0.051, 0.36, 0.3);
  banner(g, -0.08, 0.42, '米', '#c89a2e', '#5a3a14', 0, 0.48);
  return null;
}

function clinic(g) {
  // A tidy plastered house under blue-grey tiles with a small porch, hung with a gourd; herb racks beside it.
  const sx = -0.05, sz = -0.28, w = 0.6, d = 0.28, hh = 0.24;
  piece(g, sbox(w + 0.02, 0.03, d + 0.02), MAT.stone, sx, 0.015, sz);
  piece(g, new THREE.BoxGeometry(w, hh, d), MAT.house, sx, 0.03 + hh / 2, sz);
  roofAt(g, sx, sz, w / 2 + 0.06, d / 2 + 0.06, hh * 0.75, 0.03 + hh, SHOP.roofBlue, { ridge: 0.5, lift: 0.2, n: 12 });
  // Porch: posts under a lower pent-like hip roof against the house front (the door is at its left), a red beam.
  const px0 = sx - 0.12, pz = sz + d / 2 + 0.1;
  const porch = new THREE.Group(); porch.position.set(px0, 0, pz); g.add(porch); porch.name = 'porch';
  piece(porch, sbox(0.36, 0.03, 0.28), MAT.stone, 0, 0.015, 0);
  for (const [x, z] of [[-0.15, -0.11], [0.15, -0.11], [-0.15, 0.11], [0.15, 0.11]]) post(porch, x, z, 0.2, 0.022);
  piece(porch, new THREE.BoxGeometry(0.36, 0.03, 0.03), MAT.red, 0, 0.215, 0.11);
  roof(porch, 0.22, 0.16, 0.08, 0.23, SHOP.roofBlue, { ridge: 0.4, lift: 0.15, n: 8 });
  // The healer's gourd on a cord from the porch beam, and a few medicine jars on the step.
  const gourd = new THREE.Group(); gourd.position.set(px0 + 0.1, 0.16, pz + 0.12); g.add(gourd); gourd.name = 'gourd';
  piece(gourd, cyl(0.004, 0.004, 0.05, 3), SHOP.cord, 0, 0.04, 0);
  piece(gourd, new THREE.SphereGeometry(0.04, 8, 6), SHOP.gourd, 0, 0.0, 0); piece(gourd, new THREE.SphereGeometry(0.058, 8, 6), SHOP.gourd, 0, -0.06, 0);
  for (const [x, z, k] of [[-0.12, 0.2, 0], [-0.05, 0.23, 1], [0.01, 0.2, 0]]) {
    piece(g, cyl(0.026, 0.03, 0.06, 8), k ? SHOP.jarWhite : SHOP.jar, px0 + x, 0.0, pz + z);
    piece(g, cyl(0.016, 0.016, 0.012, 8), MAT.red, px0 + x, 0.06, pz + z);
  }
  // Herb-drying racks: a frame with three tiers of flat bamboo trays.
  const rackAt = (x, z, ry, name) => {
    const rk = new THREE.Group(); rk.position.set(x, 0.03, z); rk.rotation.y = ry; g.add(rk); rk.name = name;
    for (const sx2 of [-0.1, 0.1]) for (const sz2 of [-0.05, 0.05]) piece(rk, cyl(0.01, 0.01, 0.34, 5), MAT.wood, sx2, 0, sz2);
    for (const y of [0.09, 0.18, 0.27]) piece(rk, new THREE.BoxGeometry(0.22, 0.012, 0.13), SHOP.tray, 0, y, 0);
    piece(rk, new THREE.BoxGeometry(0.25, 0.01, 0.15), SHOP.tray, 0, 0.35, 0);
    return rk;
  };
  rackAt(0.34, 0.1, 0.1, 'herbRack'); rackAt(0.34, 0.34, -0.15, 'herbRack'); rackAt(-0.35, 0.36, 0.05, 'herbRack');
  banner(g, 0.12, 0.42, '医', '#e8e0c8', '#2e6a4a', 0, 0.46);
  return null;
}


const SHOPS = { 武器店: smithy, 米店: riceStore, 病院: clinic };
// Where each building's own ridge centre lies in the cell (the plaque hangs over it), in the group's frame.
const RIDGE = { 武器店: [0.04, -0.2], 米店: [-0.15, -0.28], 病院: [-0.05, -0.28] };
// One village cell: the building of its kind (a plain village keeps the farmhouse pair). Returns the label anchor
// (over the building's ridge, 0.3 above it at 0.45); `.tick(t)` animates the smoke when the building has any.
export function buildVillage(scene, c, seed, kind) {
  const r = rng(seed), ry = ((r() * 4) | 0) * Math.PI / 2, g = new THREE.Group(); g.position.set(c.x, c.h, c.z); g.rotation.y = ry; g.userData.landmark = 'village'; scene.add(g);
  const build = SHOPS[kind]; if (build) g.userData.shop = kind;
  const tick = build ? build(g) : farmhouses(g, r);
  if (build) wallCorner(g, r() < 0.5 ? -1 : 1);
  const [lx, lz] = RIDGE[kind] || [0, 0], a = new THREE.Vector3(c.x + lx * Math.cos(ry) + lz * Math.sin(ry), c.h + 0.75, c.z - lx * Math.sin(ry) + lz * Math.cos(ry)); if (tick) a.tick = tick; return a;
}
// A lone farmhouse on the castle's outskirts.
export function buildCottage(scene, c, seed) {
  const r = rng(seed), g = new THREE.Group(); g.position.set(c.x, c.h, c.z); g.rotation.y = r() * Math.PI * 2; scene.add(g);
  piece(g, new THREE.BoxGeometry(0.34, 0.17, 0.2), MAT.house, 0, 0.085, 0);
  roof(g, 0.22, 0.14, 0.12, 0.17, r() < 0.6 ? MAT.thatch : MAT.roofGrey, { ridge: 0.5, lift: 0.1 });
}

// ---------- Strategy-map towns ----------
// A walled county town (普通城) for the 战略地图, at the fortress's scale: a lower wall ring with a gate
// tower in front, a hall on a podium at the back and a few houses in the corners. Main roofs take roofMat.
export function buildTown(parent, roofMat, seed) {
  const r = rng(seed), g = new THREE.Group(); parent.add(g);
  const E = 0.36, WH = 0.15, WT = 0.06;
  const wall = (x, z, len, ry) => piece(g, new THREE.BoxGeometry(len, WH, WT), MAT.earth, x, WH / 2, z, ry);
  wall(0, -E, 2 * E, 0); wall(-E, 0, 2 * E, Math.PI / 2); wall(E, 0, 2 * E, Math.PI / 2);
  wall(-0.22, E, 0.28, 0); wall(0.22, E, 0.28, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(g, new THREE.BoxGeometry(0.1, WH + 0.06, 0.1), MAT.earth, sx * E, (WH + 0.06) / 2, sz * E);
  const gt = new THREE.Group(); gt.position.set(0, 0, E); g.add(gt);
  piece(gt, new THREE.BoxGeometry(0.18, WH + 0.03, 0.1), MAT.stone, 0, (WH + 0.03) / 2, 0);
  piece(gt, new THREE.BoxGeometry(0.07, 0.11, 0.105), MAT.gate, 0, 0.055, 0.001);
  piece(gt, new THREE.BoxGeometry(0.16, 0.08, 0.08), MAT.hall, 0, WH + 0.07, 0);
  roof(gt, 0.14, 0.09, 0.07, WH + 0.11, roofMat);
  const hall = new THREE.Group(); hall.position.set(0, 0, -0.13); g.add(hall);
  piece(hall, new THREE.BoxGeometry(0.4, 0.08, 0.24), MAT.stone, 0, 0.04, 0);
  piece(hall, new THREE.BoxGeometry(0.32, 0.15, 0.17), MAT.hall, 0, 0.155, 0);
  roof(hall, 0.24, 0.15, 0.11, 0.23, roofMat, { lift: 0.3 });
  for (const [x, z, ry] of [[-0.21, 0.17, 0], [0.22, 0.15, Math.PI / 2]]) {
    const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
    piece(h, new THREE.BoxGeometry(0.2, 0.1, 0.12), MAT.house, 0, 0.05, 0);
    roof(h, 0.13, 0.09, 0.07, 0.1, r() < 0.5 ? MAT.roofGrey : MAT.thatch, { ridge: 0.5, lift: 0.12 });
  }
  return g;
}
// A pass (关): a long crenellated wall across the valley, end bastions and a two-storey gate tower.
export function buildPass(parent, roofMat) {
  const g = new THREE.Group(); parent.add(g);
  const L = 1.1, WH = 0.26, WT = 0.12;
  for (const sx of [-1, 1]) piece(g, new THREE.BoxGeometry(L / 2 - 0.12, WH, WT), MAT.stone, sx * (L / 4 + 0.06), WH / 2, 0);
  const merlon = new THREE.BoxGeometry(0.04, 0.05, 0.03);
  for (let k = -L / 2 + 0.04; k <= L / 2 - 0.03; k += 0.08) if (Math.abs(k) > 0.14) piece(g, merlon, MAT.stone, k, WH + 0.025, WT / 2 - 0.015);
  for (const sx of [-1, 1]) {
    piece(g, new THREE.BoxGeometry(0.14, WH + 0.1, 0.18), MAT.stone, sx * L / 2, (WH + 0.1) / 2, 0);
    piece(g, new THREE.BoxGeometry(0.1, 0.07, 0.12), MAT.hall, sx * L / 2, WH + 0.135, 0);
    const t = new THREE.Group(); t.position.set(sx * L / 2, 0, 0); g.add(t);
    roof(t, 0.1, 0.11, 0.07, WH + 0.17, roofMat, { ridge: 0, lift: 0.35 });
  }
  piece(g, new THREE.BoxGeometry(0.28, WH + 0.06, 0.2), MAT.stone, 0, (WH + 0.06) / 2, 0);
  piece(g, new THREE.BoxGeometry(0.1, 0.17, 0.205), MAT.gate, 0, 0.085, 0);
  piece(g, new THREE.BoxGeometry(0.24, 0.11, 0.15), MAT.hall, 0, WH + 0.115, 0);
  roof(g, 0.2, 0.13, 0.08, WH + 0.17, roofMat, { lift: 0.3 });
  piece(g, new THREE.BoxGeometry(0.15, 0.07, 0.09), MAT.hall, 0, WH + 0.26, 0);
  roof(g, 0.13, 0.08, 0.07, WH + 0.295, roofMat, { lift: 0.3 });
  return g;
}

// ---------- Trees ----------
const PALS = [
  ['#263d1c', '#365424', '#4a6e2c', '#628a36', '#86a84a'],
  ['#2a401c', '#3c5822', '#527428', '#6e9030', '#98b048'],
  ['#323e1c', '#465622', '#5e6e28', '#7c8a32', '#a4aa4a'],
];
const pine = ['#1c3020', '#264428', '#325a30', '#44723a', '#62904a'];
// Displace an icosphere's shared vertices consistently (the geometry is non-indexed, so key by position).
function blob(r, detail, seed, squash = 0.85) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, rr = rng(seed), seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!seen.has(k)) seen.set(k, 0.82 + rr() * 0.3);
    const s = seen.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * squash, p.getZ(i) * s);
  }
  return g;
}
// Shade a crown by height within it and by how far each vertex faces outward: dark underside and core.
function shadeCrown(geo, cy, top) {
  const p = geo.attributes.position, n = p.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = p.getY(i), out = Math.hypot(p.getX(i), p.getZ(i));
    const k = Math.min(1, 0.45 + 0.55 * (y - cy) / (top - cy) + out * 0.6) ;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = Math.max(0.7, k);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function merge(geos) {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
}
// One prototype: { trunk, crown, cards } geometries (unit height ≈ 1), instanced per tree.
function treeProto(kind, seed) {
  const r = rng(seed), rnd = (a, b) => a + r() * (b - a);
  const trunk = new THREE.CylinderGeometry(0.03, 0.055, kind === 'pine' ? 0.5 : 0.55, 6); trunk.translate(0, kind === 'pine' ? 0.25 : 0.275, 0);
  const crownParts = [], cardSpots = [];
  if (kind === 'pine') {
    for (let k = 0; k < 4; k++) {
      const rad = 0.26 - k * 0.055, hgt = 0.3 - k * 0.03, y = 0.3 + k * 0.17;
      const cone = new THREE.ConeGeometry(rad, hgt, 7, 1); const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { const s = 0.85 + r() * 0.3; p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); p.setY(i, p.getY(i) + (r() - 0.5) * 0.04); }
      cone.translate(0, y + hgt / 2, 0); crownParts.push(cone);
    }
  } else {
    const n = 4 + ((r() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const rad = rnd(0.17, 0.26), a = r() * Math.PI * 2, d = k === 0 ? 0 : rnd(0.1, 0.2);
      const pos = [Math.cos(a) * d, k === 0 ? 0.72 : rnd(0.52, 0.85), Math.sin(a) * d];
      const b = blob(rad, 1, seed * 10 + k); b.translate(...pos); crownParts.push(b);
      for (let q = 0; q < 6; q++) { const u = r() * Math.PI * 2, v = rnd(-0.3, 1); cardSpots.push([pos[0] + Math.cos(u) * rad * 0.95, pos[1] + v * rad * 0.7, pos[2] + Math.sin(u) * rad * 0.95, u]); }
    }
  }
  const crown = merge(crownParts);
  crown.computeVertexNormals();
  shadeCrown(crown, kind === 'pine' ? 0.3 : 0.5, kind === 'pine' ? 1.0 : 1.05);
  // Spherical-ish UVs for the leaf texture so it doesn't smear along the merged parts.
  const p = crown.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (Math.atan2(p.getZ(i), p.getX(i)) / Math.PI + 1) * 2; uv[i * 2 + 1] = p.getY(i) * 3; }
  crown.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  let cards = null;
  if (cardSpots.length) {
    cards = merge(cardSpots.map(([x, y, z, u]) => { const q = new THREE.PlaneGeometry(0.16, 0.16); q.rotateY(-u + Math.PI / 2); q.rotateX((r() - 0.5) * 0.8); q.translate(x, y, z); return q; }));
  }
  return { trunk, crown, cards };
}

let protos = null;
function prototypes() {
  if (protos) return protos;
  const list = [];
  for (let i = 0; i < 6; i++) {
    const g = treeProto('broad', 40 + i), pal = PALS[i % 3];
    list.push({ ...g, leaf: M(leafTex(pal, i), { vertexColors: true, roughness: 1 }), card: new THREE.MeshStandardMaterial({ map: cardTex(pal, 60 + i), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }) });
  }
  for (let i = 0; i < 2; i++) {
    const g = treeProto('pine', 80 + i);
    list.push({ ...g, leaf: M(leafTex(pine, 9 + i), { vertexColors: true, roughness: 1, flatShading: true }), card: null, pine: true });
  }
  return (protos = list);
}

// spots: [{ x, z, h, s, ry, pine? }]; instanced by prototype. wrap(material, 'broad' | 'pine' | 'trunk')
// may swap in a scene's own variant of each material (the strategy map's seasonal foliage).
export function plantTrees(scene, spots, seed = 1, { wrap = (m) => m } = {}) {
  const P = prototypes(), r = rng(seed);
  const broad = P.filter((p) => !p.pine), pines = P.filter((p) => p.pine);
  const per = new Map();
  for (const t of spots) { const set = t.pine ? pines : broad, p = set[(r() * set.length) | 0]; if (!per.has(p)) per.set(p, []); per.get(p).push(t); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [p, list] of per) {
    const layer = (geo, mat, tree) => {
      if (!geo) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => im.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.h - 0.02, t.z), q.setFromAxisAngle(up, t.ry), new THREE.Vector3(t.s, t.s, t.s))));
      im.castShadow = im.receiveShadow = true; im.userData.tree = tree; scene.add(im);
    };
    const kind = p.pine ? 'pine' : 'broad';
    layer(p.trunk, wrap(MAT.bark, 'trunk'), 'trunk'); layer(p.crown, wrap(p.leaf, kind), kind); if (p.card) layer(p.cards, wrap(p.card, kind), kind);
  }
}
