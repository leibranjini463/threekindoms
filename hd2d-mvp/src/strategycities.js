// Strategy towns and tags: receives the scene, board, city data/positions and city/hover callbacks.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, rng } from './pixel.js';
import { seasonalRoof } from './seasons.js';
import { layoutTags, measureTags } from './citytags.js';
import { labelK } from './labelsize.js';
import { toX, toZ } from './worldmap.js';
import { buildFortress, buildTown, buildPass, roofTex, M, MAT } from './structures.js';

// A pack's town has no shadow in the board's baked light: a soft one on the ground, toward the bake's lamp side. The 2D map's
// town pictures (tools/bake_strategy_flat.mjs --towns) are photographed with the same one.
let shadowGeo, shadowMat, padMat;
const softDisc = (stops) => { const t = canvasTex(64, 64, (c) => { const r = c.createRadialGradient(32, 32, 2, 32, 32, 32); for (const [k, v] of stops) r.addColorStop(k, v); c.fillStyle = r; c.fillRect(0, 0, 64, 64); }); t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace; return t; };
// Also the packed-earth ground the bake paints round each of its towns (the albedo's pale disc), so a new town does not stand on bare grass.
export function townShadow(half) {
  if (!shadowMat) {
    shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    shadowMat = new THREE.MeshBasicMaterial({ color: '#1c1208', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
      alphaMap: softDisc([[0, '#9a9a9a'], [0.55, '#5a5a5a'], [1, '#000']]) });
    padMat = new THREE.MeshBasicMaterial({ color: '#9c9070', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
      alphaMap: softDisc([[0, '#d8d8d8'], [0.5, '#b0b0b0'], [0.8, '#404040'], [1, '#000']]) });
  }
  const g = new THREE.Group();
  const pad = new THREE.Mesh(shadowGeo, padMat); pad.scale.setScalar(half * 3); pad.position.y = 0.003; pad.renderOrder = 1; pad.userData.keep = true;
  const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.scale.setScalar(half * 2.6); sh.position.set(half * 0.18, 0.004, half * 0.12); sh.renderOrder = 2; sh.userData.keep = true; // own meshes: the pad must draw before the shadow
  g.add(pad, sh);
  return g;
}

export function createStrategyCities({ scene, data, sand, world, sites, onCity, onHover, colorOf }) {
  // Town fabric for the strategy map: whitewashed walls and pale stone, so a city stands out on the green
  // like the FC map's white castles; roofs and wall tops take snow in winter.
  const lime = canvasTex(16, 16, (g) => {
    const r = rng(3); g.fillStyle = '#ece8de'; g.fillRect(0, 0, 16, 16);
    for (let i = 0; i < 26; i++) { g.fillStyle = r() < 0.5 ? '#f6f3ec' : '#ddd7ca'; g.fillRect((r() * 16) | 0, (r() * 13) | 0, 1 + (r() < 0.3), 1); }
    g.fillStyle = '#c4bcac'; g.fillRect(0, 12, 16, 1); g.fillStyle = '#9c9484'; g.fillRect(0, 13, 16, 3); // a grey stone footing
    g.fillStyle = '#b8b0a0'; g.fillRect(0, 0, 16, 1);
  }, { repeat: true });
  const ashlar = canvasTex(16, 16, (g) => {
    const r = rng(5); g.fillStyle = '#a8a294'; g.fillRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? -4 : 0; x < 16; x += 8) {
      g.fillStyle = ['#d8d4ca', '#e2ded4', '#cecabe'][(r() * 3) | 0]; g.fillRect(x + 1, y + 1, 7, 3); g.fillStyle = '#eeebe4'; g.fillRect(x + 1, y + 1, 7, 1);
    }
  }, { repeat: true });
  const SWAP = new Map([[MAT.earth, seasonalRoof(M(lime))], [MAT.stone, seasonalRoof(M(ashlar))], [MAT.roofGrey, seasonalRoof(MAT.roofGrey.clone())], [MAT.thatch, seasonalRoof(MAT.thatch.clone())]]);
  const paving = ashlar.clone(); paving.repeat.set(5, 5); paving.needsUpdate = true;
  const terraceMat = seasonalRoof(M(paving, { color: '#e6e0d2' }));
  const cityPos = sand ? sites.map((_, i) => world.cities.find((c) => c.id === i).pos.clone())
    : sites.map(({ lon, lat }) => { const x = toX(lon), z = toZ(lat); return new THREE.Vector3(x, world.heightAt(x, z), z); });
  // Materials precede roads; city meshes follow them, preserving scene and material creation order.
  function build() {
    // Cities, built from the war map's set pieces: 都城 the walled castle with its three-storey keep, 关隘 a
    // long gate wall, 普通城 a walled county town. Main roofs share one grey tile tinted toward the owner's
    // colour (update() deepens it with distance), and the full colour flies on a banner.
    // The walled castle for 都城 (data/base-map.json `fort` where it differs from the sand table's tier), the gate wall for 关隘.
    const fort = (c) => c.fort ?? c.tier === 'capital', pass = (c) => c.tier === 'pass';
    const tileTex = roofTex('#b4b4b4', '#787878', '#dcdcdc'), NEUTRAL = new THREE.Color('#8a9098');
    const flagGeo = new THREE.PlaneGeometry(0.26, 0.16, 6, 1); flagGeo.translate(0.13, 0, 0);
    const pickGeo = new THREE.BoxGeometry(0.95, 0.8, 0.95); pickGeo.translate(0, 0.4, 0);
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    const poleMat = new THREE.MeshStandardMaterial({ color: '#4a3826' });
    const pickables = [], marks = [], flags = [], cityGroups = [], cityReach = [];
    data.cities.forEach((c, i) => {
      const color = colorOf(c.faction), g = new THREE.Group(), roof = seasonalRoof(M(tileTex, { side: THREE.DoubleSide, roughness: 0.8 }));
      roof.color.copy(NEUTRAL);
      const st = sand && world.cities.find((w) => w.id === c.id);
      // Sand table: the Tripo model of the city's tier as baked (its banner pole at the model's north-east corner);
      // the owner's colour flies on the banner and tints the land.
      const half = st ? world.size[{ capital: 'city-capital', major: 'city-major', county: 'city-county', pass: 'pass' }[st.tier]] / 2 * st.ms : 0;
      if (st) for (const { geo, mat } of world.cityModel(st.tier, st.style)) { const m = new THREE.Mesh(geo, mat); m.scale.setScalar(st.ms); m.position.y = -0.03; g.add(m); }
      else if (fort(c)) { const f = buildFortress(g, { x: 0, h: 0, z: 0 }, null, { roofMat: roof, lights: false }); f.group.scale.setScalar(0.95); flags.push(...f.flags); }
      else if (pass(c)) buildPass(g, roof);
      else buildTown(g, roof, c.id * 7 + 3);
      // A pack's town has no shadow in the board's baked light: a soft one on the ground, cast toward the bake's lamp side.
      if (st?.mod) g.add(townShadow(half));
      g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = !st; o.material = SWAP.get(o.material) ?? o.material; } });
      // A pale paved terrace under the walls: the town reads as one bright block from any height.
      const pad = pass(c) ? [1.32, 0.42] : fort(c) ? [1.08, 1.08] : [0.9, 0.9];
      if (!st) { const terrace = new THREE.Mesh(new THREE.BoxGeometry(pad[0], 0.07, pad[1]), terraceMat); terrace.position.y = -0.02; terrace.receiveShadow = true; g.add(terrace); }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5), poleMat);
      const [fx, fz, ph] = st ? [half * 0.92, -half * 0.4, st.tier === 'capital' ? 0.56 : 0.44] : [0.56, 0.12, 0.62];
      pole.scale.y = ph / 0.62; pole.position.set(fx, ph / 2, fz); pole.castShadow = !st;
      const flag = new THREE.Mesh(flagGeo.clone(), new THREE.MeshStandardMaterial({ color: '#fff', side: THREE.DoubleSide, roughness: 0.9, emissive: '#fff', emissiveIntensity: 0.12 }));
      flag.position.set(fx, ph - (st ? 0.07 : 0.09), fz); flag.castShadow = !st; flags.push(flag);
      if (st) flag.scale.setScalar(0.75); // in scale with the Tripo towns, as the review's cloth banners
      const hit = new THREE.Mesh(pickGeo, pickMat); hit.userData.city = c; pickables.push(hit);
      // Small towns stay easy to hit; the tag sits on what is seen, not on the pick box.
      if (st) { const w = Math.max(half * 2, 1.05) / 0.95; hit.scale.set(w, (ph + 0.05) / 0.8, w); }
      g.add(pole, flag); if (!st) g.add(hit);
      const top = new THREE.Box3().setFromObject(g).max.y;
      if (st) g.add(hit);
      cityReach.push(st ? half * 1.28 + 0.1 : 0.56);
      flag.material.color.set(color); flag.material.emissive.set(color);
      // CSS2DRenderer owns the outer element's transform, so the depth scale goes on the inner tag.
      const el = document.createElement('div'); el.className = 'ctag'; el.style.setProperty('--c', color);
      const box = document.createElement('div'); box.className = 'cwrap'; box.append(el);
      const lab = new CSS2DObject(box); lab.position.y = top + 0.15; g.add(lab);
      // The tag is a handle on its city (T14): a click selects it and pointing at it lights the city it names, so a
      // town whose model hides behind a neighbour's never needs the camera turned to be picked.
      el.addEventListener('click', (e) => { e.stopPropagation(); onCity(c.id); });
      el.addEventListener('pointerenter', () => onHover(c.id)); el.addEventListener('pointerleave', () => onHover(null));
      const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: '#ffe680' })); crown.position.y = top + 0.02; g.add(crown);
      g.position.copy(cityPos[i]); g.scale.setScalar(st ? 1 : 1.28); scene.add(g); cityGroups.push(g);
      marks.push({ flag, roof, glaze: null, el, crown, lab, dy: 0, w: 0, h: 0 });
    });
    // The cities' ~1200 static pieces become one mesh per material in world space (~50 draws instead of ~1200,
    // each in the main and the shadow pass). Each city's tinted roof is its own material, so it stays one mesh
    // per city; the banners (they wave), the pick boxes and the ruler's crown keep their own meshes.
    const live = new Set([...flags, ...pickables, ...marks.map((m) => m.crown)]), batches = new Map(), statics = [];
    scene.updateMatrixWorld();
    for (const g of cityGroups) g.traverse((o) => { if (o.isMesh && !live.has(o) && !o.userData.keep) statics.push(o); });
    for (const o of statics) {
      const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      geo.applyMatrix4(o.matrixWorld);
      const key = o.material.uuid + (o.castShadow ? '+' : '-'); // the terraces only receive shadows
      if (!batches.has(key)) batches.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
      batches.get(key).geos.push(geo);
      o.removeFromParent(); o.geometry.dispose();
    }
    for (const { mat, cast, geos } of batches.values()) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = cast && !sand; m.receiveShadow = !sand; scene.add(m);
      for (const geo of geos) geo.dispose();
    }
    let measured = false; // tag sizes, read once after their text changes (update() spaces them)
    function updateFlags(time) {
      flags.forEach((f, i) => { const p = f.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, Math.sin(time * 3 + x * 14 + i) * 0.1 * x); } p.needsUpdate = true; });
    }
    function updateTags(dt, camera, dist, selected, hovered, candidates, roadsOn, DEFAULT_DIST, tmpV) {
      // City tags: nearer is larger, the far ones shrink and fade (the player's, selected and pointed-at ones stay solid).
      const tags = [];
      for (const [i, m] of marks.entries()) {
        const d = camera.position.distanceTo(tmpV.copy(cityPos[i])), s = Math.min(1.15, Math.max(0.72, dist / d)) * labelK(); // 系统 → 地图标签
        // Pointing at a tag lights it but never reorders the spacing below: a stepped-up tag that took the front
        // would slide down from under the pointer, its neighbour slide in, and the two trade the hover every frame.
        const keep = roadsOn || i === selected || m.el.classList.contains('mine') || m.el.classList.contains('hl') || !!candidates?.has(i);
        const v = m.lab.getWorldPosition(tmpV).project(camera);
        if (v.z <= 1) tags.push({ m, s, d, keep, x: (v.x + 1) * innerWidth / 2, y0: (1 - v.y) * innerHeight / 2 });
        const o = keep || i === hovered ? 1 :Math.min(1, Math.max(0.4, 1 - (d - dist * 1.05) / (dist * 0.7)));
        m.el.style.setProperty('--s', s.toFixed(3)); m.el.style.setProperty('--o', o.toFixed(2));
        // Pulled back, a tag is just the city's name (and the banner its owner) unless it matters right now; the
        // two forms differ in height, so the spacing below measures them again when one changes.
        const far = o < 0.75 || (dist > 40 && !keep);
        if (m.far !== far) { m.far = far; m.el.classList.toggle('far', far); measured = false; }
        if (sand) m.flag.scale.setScalar(0.75 * (1 + 1.3 * Math.min(1, Math.max(0, (dist - 30) / 30))));
        // Roof glaze: 40% owner colour up close, up to 70% as the view pulls back or the tag fades with distance.
        const k = 0.4 + 0.3 * Math.max(Math.min(1, Math.max(0, (dist - DEFAULT_DIST) / 28)), (1 - o) / 0.6);
        m.roof.color.copy(NEUTRAL); if (m.glaze) m.roof.color.lerp(m.glaze, k);
      }
      if (!measured) measured = measureTags(marks);
      layoutTags(tags, { dt });
    }
    return { cityReach, pickables, marks, updateFlags, updateTags, invalidate() { measured = false; } };
  }
  return { cityPos, build };
}
