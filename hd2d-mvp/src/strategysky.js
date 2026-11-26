// Strategy atmosphere: receives a scene, board mode and season callback; owns weather, light, sky and wisps.
import * as THREE from 'three';
import { canvasTex } from './pixel.js';
import { backdrop, lightShafts, puffTex } from './fx.js';
import { createSeasons, SEASON_TABLE, U } from './seasons.js';
import { createWeather } from './weather.js';

// The sand table under the room's lamp: a brighter key than the open map and a moderate fill, so slopes and ranges
// keep a lit and a shaded side (1.15 / 1.6 until 2026-11-13 flattened them).
const SAND_KEY = 1.4, SAND_FILL = 1.2;
const TABLE_TINT = SEASON_TABLE.map((c) => new THREE.Color(c));

export function createStrategySky({ scene, sand, onSeason }) {
  // The month (seasons.js) sets the light, the fog, the sky and the weather; 0.1.1 playtesters asked for
  // the FC map's bright green land and white castles, so the base is high-key daylight, not dusk.
  const season = createSeasons(), weather = createWeather(scene);
  const skyTex = canvasTex(1, 64, () => {});
  const paintSky = ([top, up, hor, low]) => {
    const g = skyTex.userData.canvas.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64), css = (c) => `#${c.getHexString(THREE.SRGBColorSpace)}`;
    gr.addColorStop(0, css(top)); gr.addColorStop(0.45, css(up)); gr.addColorStop(0.78, css(hor)); gr.addColorStop(1, css(low));
    g.fillStyle = gr; g.fillRect(0, 0, 1, 64); skyTex.needsUpdate = true;
  };
  scene.background = skyTex;
  // Aerial perspective: the fog band follows the camera distance (update()), so whatever the zoom the
  // near board stays crisp while the far provinces fade into the month's haze.
  scene.fog = new THREE.Fog('#c9d4dc', 34, 80);
  const sky = backdrop(scene, { radius: 34, y: -2.2, lift: 5, fog: false, tint: '#d8dce0', ridges: ['#6a7a8c', '#8292a4', '#a2b0be'] });
  const shafts = lightShafts(scene, 6, [26, 22]);
  const ambience = [...scene.children]; // weather, sky and shafts: what bakeView takes out of the picture
  let sun, back, hemi, puffMat = null, nearMat, wisps;
  function addLights() {
    // The war map's late-afternoon light: a low warm key for long shadows off ranges, castles and groves, a
    // dim cool fill, so relief is modelled by light rather than by saturated colour.
    sun = new THREE.DirectionalLight('#fff2dc', 3.7); sun.position.set(-17, 21, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 17, bottom: -17, near: 1, far: 80 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    if (sand) sun.castShadow = false; // the sand table's shadows are baked
    back = new THREE.DirectionalLight('#a8c8f0', 0.5); back.position.set(14, 9, -16);
    hemi = new THREE.HemisphereLight('#d4e6ff', '#5e5236', 1.05);
    scene.add(sun, sun.target, back, hemi);
  }
  // Lights, fog, sky and cloud banks follow the month; lightning flashes the sky light.
  const applyLight = (world, flash = 0, repaint = true) => {
    const l = season.cur.light;
    sun.color.copy(l.sun); sun.intensity = l.si * (sand ? SAND_KEY : 1); sun.position.copy(l.dir).multiplyScalar(28);
    back.color.copy(l.back); hemi.color.copy(l.hemi); hemi.groundColor.copy(l.hg); hemi.intensity = l.hi * (sand ? SAND_FILL : 1) * (1 + flash * 2.4);
    scene.fog.color.copy(l.fog); puffMat?.color.copy(l.puff); if (repaint) paintSky(l.sky);
    // The baked board takes the same lamp and sky as three.js's Lambert term (radiance = albedo · E · cos / π).
    const lu = world?.lightUniforms;
    if (lu) {
      lu.uSun.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
      lu.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI).add(new THREE.Color().copy(back.color).multiplyScalar(back.intensity * 0.5 / Math.PI));
    }
  };
  function addClouds(camera) {
    // Cloud banks hug all four rims (lower over the eastern sea), so a low camera never sees where the
    // board stops. Puffs sit low and take the fog like the land behind them.
    puffMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, color: '#f8f2ee', opacity: 0.95 });
    const rr = (() => { let k = 7; return () => ((k = (k * 16807) % 2147483647) / 2147483647); })();
    const rim = [];
    // The south rim faces the default camera, so its bank is lower and further out.
    // The sand table needs none: its frame and the dark table close the board.
    if (!sand) for (let x = -14; x <= 14; x += 1.6) rim.push([x, -12.6 - rr() * 1.4, 1], [x * 0.9, 13.6 + rr() * 1.2, 0.5]);
    if (!sand) for (let z = -12; z <= 12; z += 1.6) rim.push([-13.6 - rr() * 1.4, z, 1], [13.4 + rr() * 1.2, z, 0.7]);
    for (const [x, z, k] of rim) {
      const p = new THREE.Sprite(puffMat), w = (3.2 + rr() * 2.4) * (0.6 + 0.4 * k);
      p.scale.set(w, w * 0.45, 1); p.position.set(x, -0.4 + (0.5 + rr() * 0.6) * k, z); p.renderOrder = 2; scene.add(p);
    }
    // Foreground wisps ride in front of the lens at the bottom corners; they write depth (where visible) so
    // the depth-of-field pass blurs them into soft out-of-focus shapes. They never take clicks and fade out
    // as the view turns top-down.
    nearMat = new THREE.SpriteMaterial({ map: puffTex, transparent: true, alphaTest: 0.04, fog: false, opacity: 0 });
    wisps = [[-1, 0.92, 1.0], [1, 0.98, 1.15], [0.45, 1.08, 0.8]].map(([side, y, w]) => {
      const p = new THREE.Sprite(nearMat); p.renderOrder = 10;
      p.userData = { side, y, w, phase: side * 2 + y }; camera.add(p); return p;
    });
  }
  // Ease into a month's look (2.5 s), or jump to it.
  function setSeason(m, instant = false, world) {
    if (season.setMonth(m, instant ? 0 : 2.5) || instant) { weather.set(season.cur); applyLight(world); }
    onSeason?.(m, instant);
  }
  function update(dt, time, view, world) {
    const turning = season.update(dt, time);
    if (turning) weather.set(season.cur);
    // Snow falls where the view is north of the snow line, blossom south of the 黄河.
    const lat = 31.5 - view.target.z, cur = season.cur;
    weather.set({ snowfall: cur.snowfall * THREE.MathUtils.smoothstep(lat, U.uSnowLat.value - 2.5, U.uSnowLat.value - 0.5), petals: cur.petals * (1 - THREE.MathUtils.smoothstep(lat, 37.5, 40)) });
    weather.update(dt, time, view.target, view.dist); applyLight(world, weather.flash, turning);
  }
  function updateView(time, dist, low, camera) {
    scene.fog.near = dist * 1.05; scene.fog.far = dist * (2.9 - 0.7 * season.cur.rain); // clear up to the focus, hazing beyond it (closer in rain)
    // Foreground wisps: bottom corners of the frame, drifting slowly; only at a low tilt.
    // At 2 units in front of the lens the frame's half height is hh and its half width ww.
    const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2, ww = hh * camera.aspect;
    nearMat.opacity = 0.26 * Math.max(0, (low - 0.25) / 0.75);
    for (const p of wisps) {
      const { side, y, phase, w } = p.userData;
      p.visible = nearMat.opacity > 0.01;
      p.scale.set(w * ww * 0.9, w * ww * 0.4, 1);
      p.position.set(side * ww * 1.0 + Math.sin(time * 0.12 + phase) * ww * 0.04, -hh * y, -2);
    }
  }
  return {
    ambience, addLights, addClouds, setSeason, applyLight, update, updateView,
    advance(time) { sky.update(time); shafts.update(time); },
    // Extension regions (sandregions.js) widen the table: the far ridges ring the boards' joint box as they ring the original
    // board, so a view framing the region never looks past their edge, and the light shafts spread over the whole table (one stood
    // right over the east strip's seam, where it read as a fault in the join). Never called without a pack's regions.
    fitBoards([X0, X1, Z0, Z1]) {
      const [x0, x1, z0, z1] = sand.meta.box, k = Math.hypot(X1 - X0, Z1 - Z0) / Math.hypot(x1 - x0, z1 - z0);
      sky.ridges.position.set((X0 + X1 - x0 - x1) / 2, sky.ridges.position.y, (Z0 + Z1 - z0 - z1) / 2); sky.ridges.scale.set(k, 1, k);
      const kx = (X1 - X0) / (x1 - x0), kz = (Z1 - Z0) / (z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (const m of shafts.meshes) m.position.set((X0 + X1) / 2 + (m.position.x - cx) * kx, m.position.y, (Z0 + Z1) / 2 + (m.position.z - cz) * kz);
    },
    updateTable(dt, world) { world.table?.material.color.lerp(TABLE_TINT[Math.floor(season.month / 3)], 1 - Math.exp(-dt * 1.6)); },
    get month() { return season.month; },
  };
}
