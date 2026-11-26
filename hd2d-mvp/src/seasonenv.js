// The month and the place for a battle scene (war map, 白兵, 单挑): the same season as the 战略地图 at the
// battle city's latitude. set({ month, city }) relights the scene from the month's light preset (sun, sky
// fill, fog, sky gradient), starts its weather, and returns the place that seasons.js seasonalize() needs
// to recolour ground, trees and sprites and lay snow where the snow line has passed. Beyond the board a
// painted horizon ring (GPT-image panoramas, tools/gen_backdrops_codex.sh) shows the same season.
import * as THREE from 'three';
import { canvasTex } from './pixel.js';
import { data } from './core/game.js';
import { lookOf, paintSky, MONTHS, U } from './seasons.js';
import { createWeather } from './weather.js';

// The horizon plate for a month at a latitude: snow wherever the snow line has passed, the plum rains in
// 五–六月, red woods in 九–十月 (green in the far south), and the snowless southern winter.
export function plateKey(month, lat) {
  const snowing = lat > MONTHS[month].snow - 0.6, south = lat < 27.5;
  if (snowing) return 'winter';
  if (month >= 10) return 'winter-south';
  if (month === 4 || month === 5) return 'rain';
  if (month === 8 || month === 9) return south ? 'summer' : 'autumn';
  if (month === 0 && !south) return 'winter-south'; // 正月 north of the line: thawing, brown, no snow
  return month <= 2 ? 'spring' : 'summer';
}
let plateList = null;
const plates = new Map(), loader = new THREE.TextureLoader();
function plate(key) {
  if (!plates.has(key)) plates.set(key, (plateList ||= fetch('assets/ai/backdrops/index.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => []))
    .then((list) => (list.includes(key) ? loader.loadAsync(`assets/ai/backdrops/${key}.webp`) : null))
    .then((t) => { if (t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; } return t; }).catch(() => null));
  return plates.get(key);
}

// opts: the scene's own lights, how its sun / sky fill sit against the strategy map's (sunK, hemiK), its
// scale for snow on high ground and for woodland patches (snowH, patch), and the horizon ring's radius and
// the height its painted horizon sits at (ring: [radius, horizonY]); calm and bloom as in seasons.js placeUniforms;
// weather: how much of the rain and lightning this scene draws (weather.js createWeather's options).
export function seasonEnv(scene, { sun, back, hemi, sunK = 1, hemiK = 1, snowH = 0.9, patch = 0.3, snowMax = 0.75, calm = 0, bloom = 1, ring: [R, horizon] = [46, 2], weather: weatherLook = {} }) {
  const sky = canvasTex(1, 64, () => {});
  scene.background = sky;
  const weather = createWeather(scene, weatherLook);
  // The plate is 4:1 and wraps the whole circle, so the ring is 2πR/4 tall; its horizon is ~47% down.
  const H = (Math.PI * 2 * R) / 4;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
  ring.position.y = horizon - 0.03 * H; ring.visible = false; ring.userData.noSeason = true; scene.add(ring);
  let look = null, hemiBase = hemi.intensity, ridges = null, want = null;
  return {
    // The procedural ridges (fx.js backdrop) stand in until the plate has loaded, or for good without one.
    backdrop(b) { ridges = b.ridges; if (ring.visible && ridges) ridges.visible = false; },
    set({ month, city }) {
      look = lookOf(month);
      sun.color.copy(look.sun); sun.intensity = look.si * sunK;
      back.color.copy(look.back); hemi.color.copy(look.hemi); hemi.groundColor.copy(look.hg); hemiBase = hemi.intensity = look.hi * hemiK;
      scene.fog?.color.copy(look.fog); paintSky(sky, look.sky);
      const lat = data()?.cities[city]?.lat ?? 33, key = plateKey(month, lat), snowing = lat > MONTHS[month].snow - 0.6;
      // Weather follows the place: snow falls only north of the snow line, blossom only south of the 黄河.
      const sky_ = { rain: look.rain, snowfall: snowing ? Math.max(look.snowfall, 0.25) : 0, petals: lat < 38.5 ? look.petals : 0, fall: look.fall, thunder: look.thunder };
      weather.set({ ...look, ...sky_ });
      want = key;
      plate(key).then((t) => {
        if (want !== key) return;
        ring.visible = !!t; if (t) { ring.material.map = t; ring.material.needsUpdate = true; }
        if (ridges) ridges.visible = !t;
      });
      return { lat, snowH, patch, snowMax, calm, bloom, month, plate: key, snowing, weather: sky_ };
    },
    update(dt, t, center, dist) {
      U.uTime.value = t; // the strategy map's loop, which normally drives it, is paused during a battle
      weather.update(dt, t, center, dist);
      hemi.intensity = hemiBase * (1 + weather.flash * 2.4);
    },
  };
}
