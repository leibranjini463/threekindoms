// Weather over the 战略地图, set by the month (seasons.js): slanting rain streaks with lightning in the
// storm months, snowflakes drifting down in winter, peach and plum petals in spring, falling leaves in
// autumn. Particles live in a box that follows the view target and scales with the camera distance, so
// the weather reads the same at every zoom; each kind's intensity (0…1) sets how many are drawn.
import * as THREE from 'three';
import { canvasTex, rng } from './pixel.js';

const flakeTex = canvasTex(4, 4, (g) => { g.fillStyle = '#ffffffb0'; g.fillRect(1, 0, 2, 4); g.fillRect(0, 1, 4, 2); g.fillStyle = '#fff'; g.fillRect(1, 1, 2, 2); });
const petalTex = canvasTex(4, 4, (g) => { g.fillStyle = '#fff'; g.fillRect(1, 0, 2, 4); g.fillRect(0, 1, 4, 2); g.clearRect(3, 0, 1, 1); });
const leafTex = canvasTex(5, 5, (g) => { g.fillStyle = '#fff'; g.fillRect(1, 1, 3, 3); g.fillRect(2, 0, 1, 1); g.fillRect(0, 2, 1, 1); g.fillRect(4, 3, 1, 1); g.fillStyle = '#c8c8c8'; g.fillRect(1, 3, 2, 1); });

// count particles in a unit box [-0.5, 0.5]³; the caller maps the box onto the world each frame.
function cloud(count, seed, tex, colors, size) {
  const r = rng(seed), pos = new Float32Array(count * 3), col = new Float32Array(count * 3), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([r() - 0.5, r() - 0.5, r() - 0.5], i * 3); ph[i] = r() * 100;
    const c = new THREE.Color(colors[(r() * colors.length) | 0]); col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ map: tex, size, vertexColors: true, transparent: true, alphaTest: 0.3, depthWrite: false, fog: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.visible = false;
  return { pts, pos, ph, count, r };
}

// rain: { n, alpha, len } scale a scene's rain (how many streaks, how bright, how long) and flashK its lightning, all 1 by default.
// The war map passes less of each (src/war/board.js): the month's rain level, which the rules' views also read, is left alone.
export function createWeather(scene, { rain: { n: rainN = 1, alpha: rainA = 1, len: rainL = 1 } = {}, flashK = 1 } = {}) {
  // Rain: line segments, each a short streak along its fall direction.
  const RAIN = 2600, rr = rng(17), rainPos = new Float32Array(RAIN * 6), drops = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) drops.set([rr() - 0.5, rr() - 0.5, rr() - 0.5], i * 3);
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: '#dbe4ee', transparent: true, opacity: 0.42, depthWrite: false, fog: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; rain.visible = false;
  const snow = cloud(2400, 23, flakeTex, ['#ffffff', '#f2f6ff', '#e6eefa'], 0.075);
  const petals = cloud(700, 29, petalTex, ['#ffd6e0', '#ffc2d2', '#ffffff', '#f8a8be'], 0.085);
  const leaves = cloud(700, 31, leafTex, ['#e0782a', '#c8401e', '#f0b23c', '#b05a1e', '#d89a30'], 0.1);
  scene.add(rain, snow.pts, petals.pts, leaves.pts);
  const level = { rain: 0, snowfall: 0, petals: 0, fall: 0, thunder: 0 };
  let nextBolt = 6, flash = 0;
  const wrap = (v) => v - Math.floor(v + 0.5); // keep a unit-box coordinate in [-0.5, 0.5)
  // Move a drifting cloud in box units: fall speed vy, wind, and a per-particle sway.
  const drift = (c, dt, t, vy, wind, sway, n) => {
    const { pos, ph } = c;
    for (let i = 0; i < n; i++) {
      const k = i * 3, p = ph[i];
      pos[k] = wrap(pos[k] + (wind + Math.sin(t * 1.3 + p) * sway) * dt);
      pos[k + 1] = wrap(pos[k + 1] - vy * (0.75 + (p % 1) * 0.5) * dt);
      pos[k + 2] = wrap(pos[k + 2] + Math.cos(t * 1.1 + p) * sway * 0.6 * dt);
    }
    c.pts.geometry.attributes.position.needsUpdate = true; c.pts.geometry.setDrawRange(0, n);
  };
  const place = (o, center, half, height) => { o.position.set(center.x, center.y + height / 2 - 0.2, center.z); o.scale.set(half * 2, height, half * 2); };
  return {
    set(l) { Object.assign(level, l); },
    // Lightning: 0…1 this frame (the scene brightens its sky light with it).
    get flash() { return flash * flashK; },
    update(dt, t, center, dist) {
      const half = Math.max(6, dist * 0.55), height = Math.max(4, dist * 0.32);
      // Rain: streaks slanting with the wind; length grows with the box so it reads at every zoom.
      const nr = Math.round(RAIN * rainN * Math.min(1, level.rain));
      rain.visible = nr > 0;
      if (rain.visible) {
        const len = (0.018 + 0.006 * level.rain) * rainL;
        for (let i = 0; i < nr; i++) {
          const k = i * 3, vy = 2.2 + (i % 7) * 0.12;
          drops[k + 1] = wrap(drops[k + 1] - vy * dt); drops[k] = wrap(drops[k] + 0.35 * dt);
          const x = drops[k], y = drops[k + 1], z = drops[k + 2], o = i * 6;
          rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
          rainPos[o + 3] = x - len * 0.16; rainPos[o + 4] = y + len * 2.2; rainPos[o + 5] = z;
        }
        rainGeo.attributes.position.needsUpdate = true; rainGeo.setDrawRange(0, nr * 2);
        rainMat.opacity = (0.22 + 0.25 * level.rain) * rainA;
        place(rain, center, half, height);
      }
      for (const [c, lv, vy, wind, sway] of [[snow, level.snowfall, 0.11, 0.02, 0.025], [petals, level.petals, 0.08, 0.06, 0.05], [leaves, level.fall, 0.1, 0.05, 0.06]]) {
        const n = Math.round(c.count * Math.min(1, lv));
        c.pts.visible = n > 0;
        if (n) { drift(c, dt, t, vy, wind, sway, n); place(c.pts, center, half, height); c.pts.material.size = c === snow ? 0.05 + dist * 0.0018 : 0.06 + dist * 0.002; }
      }
      // Lightning in storms: a double flicker every several seconds.
      flash = Math.max(0, flash - dt * 5);
      if (level.thunder > 0.05) {
        nextBolt -= dt * level.thunder;
        if (nextBolt <= 0) { flash = 1; nextBolt = 5 + Math.random() * 9; setTimeout(() => { flash = 0.8; }, 140); }
      }
    },
  };
}
