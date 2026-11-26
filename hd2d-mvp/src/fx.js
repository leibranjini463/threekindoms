// HD-2D set dressing shared by the war map and the battle cut-in: baked edge occlusion, grass
// tufts, a cloud sea and distant ridges around the diorama, light shafts, drifting petals, and
// one-shot impact effects (slash arc, spark burst, dust puff).
import * as THREE from 'three';
import { canvasTex, rng } from './pixel.js';

const aoTex = canvasTex(1, 32, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 1, 32);
});
aoTex.magFilter = aoTex.minFilter = THREE.LinearFilter;
const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

// Billboards light like the ground they stand on: the normal leans mostly to the sky (a fifth toward the
// camera, so the key light's side still models them a little), whichever face shows. Replaces the old
// emissive fill that kept sprites flat-lit and blind to dusk, torches and shadow.
function skyNormal(shader) {
  shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>',
    '#include <defaultnormal_vertex>\n transformedNormal = normalize(mix(vec3(0., 0., 1.), (viewMatrix * vec4(0., 1., 0., 0.)).xyz, 0.8));');
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
    '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;');
}
export function skyLit(material) { material.onBeforeCompile = skyNormal; return material; }

// Darken a cell's top face along each edge that meets a taller neighbour (voxel-style AO).
export function edgeOcclusion(parent, cells, topOf, wx, wz) {
  const geo = new THREE.PlaneGeometry(1, 0.42);
  const DIR = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
  for (const { x, y } of cells) {
    const h = topOf(x, y);
    for (const [dx, dy, rot] of DIR) {
      const nh = topOf(x + dx, y + dy);
      if (nh == null || nh - h < 0.12) continue;
      const m = new THREE.Mesh(geo, aoMat);
      m.rotation.set(-Math.PI / 2, rot, 0, 'YXZ'); // lie flat, dark edge (+v) toward the neighbour
      m.position.set(wx(x) + dx * 0.29, h + 0.012, wz(y) + dy * 0.29);
      parent.add(m);
    }
  }
}

const tuftTex = [
  canvasTex(8, 8, (g) => { g.fillStyle = '#8cc95a'; for (const [x, h] of [[1, 5], [3, 7], [4, 4], [6, 6]]) g.fillRect(x, 8 - h, 1, h); g.fillStyle = '#5a9a3a'; g.fillRect(2, 4, 1, 4); g.fillRect(5, 3, 1, 5); }),
  canvasTex(8, 8, (g) => { g.fillStyle = '#6aa848'; g.fillRect(3, 3, 1, 5); g.fillRect(5, 4, 1, 4); g.fillStyle = '#f0e070'; g.fillRect(2, 2, 3, 2); g.fillStyle = '#ffffff'; g.fillRect(5, 3, 2, 2); }),
  canvasTex(8, 8, (g) => { g.fillStyle = '#6aa848'; g.fillRect(3, 4, 1, 4); g.fillStyle = '#e06070'; g.fillRect(2, 2, 3, 3); g.fillStyle = '#ffd0d8'; g.fillRect(3, 3, 1, 1); }),
];
// Crossed quads (static, no per-frame billboarding) scattered on grass tops.
export function scatterTufts(parent, spots, seed = 3) {
  const r = rng(seed), geo = new THREE.PlaneGeometry(0.22, 0.22);
  const mats = tuftTex.map((map) => new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }));
  const per = mats.map(() => []);
  for (const [x, y, z] of spots) per[r() < 0.75 ? 0 : r() < 0.5 ? 1 : 2].push([x, y, z, r() * Math.PI]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1);
  per.forEach((list, k) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mats[k], list.length * 2);
    list.forEach(([x, y, z, a], i) => {
      for (let j = 0; j < 2; j++) im.setMatrixAt(i * 2 + j, m4.compose(new THREE.Vector3(x, y + 0.11, z), q.setFromAxisAngle(up, a + j * Math.PI / 2), s));
    });
    im.userData.foliage = 'grass'; parent.add(im);
  });
}

// Cloud sea under the board and layered ridges on the horizon: the map floats like a diorama.
// ridges: the three layers' colours, near to far; fog: whether scene fog washes them (a cool painted
// haze reads deeper than ridges fogged flat to the sky colour).
export function backdrop(scene, { radius = 40, y = -2.4, tint = '#d8c8b0', ridges: ridgeColors = ['#6f7f8f', '#8796a6', '#a9b6c2'], fog = true, lift = 4 } = {}) {
  const r = rng(77);
  const cloud = canvasTex(64, 64, (g) => {
    g.fillStyle = '#00000000'; g.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 60; i++) {
      const x = r() * 64, yy = r() * 64, rad = 3 + r() * 8;
      g.fillStyle = `rgba(255,248,236,${0.25 + r() * 0.35})`;
      g.beginPath(); g.arc(x, yy, rad, 0, Math.PI * 2); g.fill();
    }
  }, { repeat: true });
  cloud.magFilter = THREE.LinearFilter; cloud.repeat.set(3, 3);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(radius * 4, radius * 4), new THREE.MeshBasicMaterial({ map: cloud, transparent: true, opacity: 0.85, depthWrite: false, color: tint }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = y; scene.add(sea);
  const ridges = new THREE.Group();
  for (let layer = 0; layer < 3; layer++) {
    const tex = canvasTex(256, 32, (g) => {
      g.fillStyle = ridgeColors[layer];
      let h = 12 + layer * 3;
      for (let x = 0; x < 256; x++) { h += (r() - 0.5) * 2.6 + Math.sin(x / (7 + layer * 3)) * 0.5; h = Math.max(4, Math.min(30, h)); g.fillRect(x, 32 - h, 1, h); }
    });
    const rad = radius + layer * 14;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 14 + layer * 4, 64, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog, depthWrite: false }));
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 3;
    m.position.y = y + lift + layer * 1.5; ridges.add(m);
  }
  scene.add(ridges);
  return { ridges, update(t) { cloud.offset.set(t * 0.004, t * 0.002); } };
}

// Soft additive light shafts slanting with the sun.
export function lightShafts(scene, count, area, seed = 9) {
  const r = rng(seed);
  const tex = canvasTex(16, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,236,190,0)'); gr.addColorStop(0.3, 'rgba(255,236,190,0.55)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 64);
    g.globalCompositeOperation = 'destination-in';
    const gx = g.createLinearGradient(0, 0, 16, 0); gx.addColorStop(0, '#0000'); gx.addColorStop(0.5, '#000f'); gx.addColorStop(1, '#0000');
    g.fillStyle = gx; g.fillRect(0, 0, 16, 64);
  });
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  const shafts = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2 + r() * 1.5, 14), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.18, fog: false }));
    m.position.set((r() - 0.5) * area[0], 5, (r() - 0.5) * area[1]); m.rotation.set(0, r() * Math.PI, -0.55);
    m.userData.phase = r() * 6; scene.add(m); shafts.push(m);
  }
  return { meshes: shafts, update(t) { for (const m of shafts) m.material.opacity = 0.1 + 0.08 * Math.sin(t * 0.4 + m.userData.phase); } };
}

// Petals/leaves drifting across the scene.
export function petals(scene, count, box, seed = 4) {
  const r = rng(seed), pos = new Float32Array(count * 3), vel = [];
  for (let i = 0; i < count; i++) { pos.set([(r() - 0.5) * box[0], r() * box[1], (r() - 0.5) * box[2]], i * 3); vel.push([0.3 + r() * 0.4, -0.15 - r() * 0.2, 0.1 + r() * 0.2, r() * 6]); }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const tex = canvasTex(4, 4, (g) => { g.fillStyle = '#ffd8e0'; g.fillRect(1, 0, 2, 4); g.fillRect(0, 1, 4, 2); g.fillStyle = '#ff9fb4'; g.fillRect(1, 1, 2, 2); });
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 0.09, transparent: true, alphaTest: 0.5, depthWrite: false }));
  scene.add(pts);
  return {
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const [vx, vy, vz, ph] = vel[i];
        let x = pos[i * 3] + (vx + Math.sin(t * 2 + ph) * 0.3) * dt, y = pos[i * 3 + 1] + vy * dt, z = pos[i * 3 + 2] + (vz + Math.cos(t * 1.7 + ph) * 0.2) * dt;
        if (y < 0 || x > box[0] / 2) { x = -box[0] / 2; y = box[1] * (0.5 + r() * 0.5); }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// --- One-shot impact effects (used by the battle cut-in) ---
const slashTex = canvasTex(64, 64, (g) => {
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = `rgba(255,${230 - i * 4},${180 - i * 6},${1 - i / 18})`; g.lineWidth = 2;
    g.beginPath(); g.arc(32, 40, 26 - i * 0.6, Math.PI * 1.08 + i * 0.01, Math.PI * 1.92 - i * 0.02); g.stroke();
  }
});
slashTex.magFilter = slashTex.minFilter = THREE.LinearFilter;
// A scene that is not drawn itself (the war map on its painted 2D board, src/warmap2d.js) sets
// userData.flatFx: every effect below tells it what it set off, where and how, and the board draws its own.
const echo = (scene, kind, at, o) => scene.userData?.flatFx?.(kind, at, o);

// `anim` lets a scene drive the effect from its own presentation clock (the 单挑 hit-stop freezes it);
// `tilt` fixes the arc's angle instead of a random one.
export function slash(scene, at, flip, scale = 2.2, anim = animate, tilt = 0.5 + Math.random() * 0.6) {
  echo(scene, 'slash', at, { size: scale, flip });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), new THREE.MeshBasicMaterial({ map: slashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.position.copy(at); m.rotation.z = (flip ? 1 : -1) * tilt; m.scale.x = flip ? -1 : 1;
  scene.add(m);
  return anim(260, (k) => { m.material.opacity = 1 - k; m.scale.setScalar(1 + k * 0.4); if (flip) m.scale.x *= -1; }, () => drop(scene, m));
}

const sparkTex = canvasTex(8, 8, (g) => { g.fillStyle = '#fff4c0'; g.fillRect(3, 0, 2, 8); g.fillRect(0, 3, 8, 2); g.fillStyle = '#ffffff'; g.fillRect(3, 3, 2, 2); });
export function sparkBurst(scene, at, n = 40, color = '#ffd070', anim = animate, size = 0.18, map = sparkTex) {
  echo(scene, 'spark', at, { n, color, glow: map === glowTex });
  const pos = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) { pos.set([at.x, at.y, at.z], i * 3); const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; v.push([Math.cos(a) * s, Math.sin(a) * s * 0.8 + 1.5, (Math.random() - 0.5) * 2]); }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ map, size, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: map !== glowTex, fog: false }));
  scene.add(p);
  let last = 0;
  return anim(500, (k) => {
    const dt = (k - last) * 0.5; last = k;
    for (let i = 0; i < n; i++) { v[i][1] -= 9.8 * dt; pos[i * 3] += v[i][0] * dt; pos[i * 3 + 1] += v[i][1] * dt; pos[i * 3 + 2] += v[i][2] * dt; }
    geo.attributes.position.needsUpdate = true; p.material.opacity = 1 - k;
  }, () => drop(scene, p));
}

// A spear or halberd thrust: a short straight streak along the line of the weapon.
const thrustTex = canvasTex(64, 8, (g) => {
  const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.8, 'rgba(255,240,200,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 3, 64, 2); g.fillStyle = 'rgba(255,220,160,0.35)'; g.fillRect(8, 2, 56, 4);
});
thrustTex.magFilter = thrustTex.minFilter = THREE.LinearFilter;
export function thrust(scene, at, flip, len = 1.6, anim = animate) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, len / 8), new THREE.MeshBasicMaterial({ map: thrustTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.position.copy(at); m.position.x -= (flip ? -1 : 1) * len * 0.45; m.scale.x = flip ? -1 : 1; scene.add(m);
  return anim(200, (k) => { m.material.opacity = 1 - k; }, () => drop(scene, m));
}

const dustTex = canvasTex(16, 16, (g) => {
  for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(220,200,160,${0.25 + i * 0.1})`; g.beginPath(); g.arc(8, 8, 7 - i, 0, Math.PI * 2); g.fill(); }
});
export function dustPuff(scene, at, size = 0.7, anim = animate) {
  echo(scene, 'dust', at, { size });
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  m.position.copy(at); m.scale.setScalar(size); scene.add(m);
  return anim(600, (k) => { m.scale.setScalar(size * (1 + k * 1.6)); m.position.y = at.y + k * 0.4; m.material.opacity = 0.8 * (1 - k); }, () => drop(scene, m));
}

// Points that rise and fade (embers over a fire, gold motes, spray), from a small disc around `at`.
// A soft round glow (embers, motes, a flash), so a point reads as light at the war map's camera distance where the
// 8-px cross of sparkTex shrinks to a speck.
export const glowTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
glowTex.magFilter = glowTex.minFilter = THREE.LinearFilter;
// A bright flash that swells and fades where something strikes.
export function flare(scene, at, color = '#ffe0a0', { size = 2.4, ms = 360 } = {}, anim = animate) {
  echo(scene, 'flare', at, { color, size, ms });
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  m.position.copy(at); m.renderOrder = 10; scene.add(m);
  return anim(ms, (k) => { m.scale.setScalar(size * (0.5 + k * 0.7)); m.material.opacity = k < 0.2 ? k / 0.2 : (1 - k) / 0.8; }, () => drop(scene, m));
}
// Tongues of flame licking up around `at`: billboards with a flame texture that rise, sway and flicker out.
const flameTex = canvasTex(32, 64, (g) => {
  const gr = g.createRadialGradient(16, 50, 2, 16, 40, 30); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,0.9)'); gr.addColorStop(0.65, 'rgba(255,110,30,0.55)'); gr.addColorStop(1, 'rgba(200,40,10,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(16, 0); g.bezierCurveTo(30, 26, 31, 46, 16, 63); g.bezierCurveTo(1, 46, 2, 26, 16, 0); g.fill();
});
flameTex.magFilter = flameTex.minFilter = THREE.LinearFilter;
export function flames(scene, at, color = '#ffffff', { n = 7, spread = 0.6, h = 1.3, ms = 1000 } = {}, anim = animate) {
  echo(scene, 'flames', at, { color, n, spread, rise: h, ms });
  const all = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, r = spread * (0.3 + Math.random() * 0.7), x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
    const hh = h * (0.7 + Math.random() * 0.6), ph = Math.random() * 6, delay = Math.random() * 0.25;
    m.center.set(0.5, 0); m.renderOrder = 10; scene.add(m);
    all.push(anim(ms, (k) => {
      const q = Math.max(0, (k - delay) / (1 - delay)), life = Math.sin(Math.min(1, q) * Math.PI);
      m.position.set(x + Math.sin(k * 14 + ph) * 0.05, at.y - 0.7 + q * 0.3, z);
      m.scale.set(hh * 0.5 * (0.8 + 0.2 * Math.sin(k * 23 + ph)), hh * life * (0.85 + 0.15 * Math.sin(k * 31 + ph)), 1);
      m.material.opacity = Math.min(1, life * 1.4);
    }, () => drop(scene, m)));
  }
  return Promise.all(all);
}

export function embers(scene, at, n = 30, color = '#ff8a30', { spread = 0.5, rise = 2.2, size = 0.5, ms = 900 } = {}, anim = animate) {
  echo(scene, 'embers', at, { color, n, spread, rise, size, ms });
  const pos = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
    pos.set([at.x + Math.cos(a) * r, at.y - 0.4 + Math.random() * 0.3, at.z + Math.sin(a) * r], i * 3);
    v.push([(Math.random() - 0.5) * 0.6, rise * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * 0.6, Math.random() * 6]);
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, size, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  scene.add(p);
  let last = 0;
  return anim(ms, (k) => {
    const dt = (k - last) * ms / 1000; last = k;
    for (let i = 0; i < n; i++) { pos[i * 3] += (v[i][0] + Math.sin(k * 9 + v[i][3]) * 0.4) * dt; pos[i * 3 + 1] += v[i][1] * dt; pos[i * 3 + 2] += v[i][2] * dt; }
    geo.attributes.position.needsUpdate = true; p.material.opacity = k < 0.6 ? 1 : (1 - k) / 0.4;
  }, () => drop(scene, p));
}

// Streaks that fly in and strike `at`: from above (arrows, rocks, fire arrows) or from the side (bolts).
const streakTex = canvasTex(8, 32, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, '#ffffff');
  g.fillStyle = gr; g.fillRect(3, 0, 2, 32);
});
streakTex.magFilter = streakTex.minFilter = THREE.LinearFilter;
export function streaks(scene, at, n = 8, color = '#ffe0a0', { from = 'above', len = 1.4, ms = 420, spread = 0.7 } = {}, anim = animate) {
  echo(scene, 'streaks', at, { color, n, from, len, ms, spread });
  const all = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len / 5, len), new THREE.MeshBasicMaterial({ map: streakTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const end = new THREE.Vector3(at.x + (Math.random() - 0.5) * spread, at.y - 0.3 + Math.random() * 0.3, at.z + (Math.random() - 0.5) * spread);
    const dir = from === 'side' ? new THREE.Vector3(-1, 0.15, 0) : new THREE.Vector3(-0.35, 1, 0.2);
    const start = end.clone().addScaledVector(dir.normalize(), 4);
    m.rotation.z = Math.atan2(dir.x, dir.y) * -1; m.position.copy(start); scene.add(m);
    const delay = (i / n) * 0.45;
    all.push(anim(ms, (k) => { const q = Math.max(0, Math.min(1, (k - delay) / (1 - delay))); m.position.lerpVectors(start, end, q); m.material.opacity = q <= 0 ? 0 : q < 1 ? 1 : 0; }, () => drop(scene, m)));
  }
  return Promise.all(all);
}

// A flat ring on the ground that opens out (a gate of power, a net closing) or, with `shrink`, closes in.
const ringTex = canvasTex(64, 64, (g) => {
  for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(255,255,255,${0.15 + i * 0.15})`; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 30 - i * 0.8, 0, Math.PI * 2); g.stroke(); }
});
ringTex.magFilter = ringTex.minFilter = THREE.LinearFilter;
export function ring(scene, at, color = '#ffd070', { r = 1.2, shrink = false, ms = 700 } = {}, anim = animate) {
  echo(scene, 'ring', at, { color, r, shrink, ms });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(at.x, at.y - 0.7, at.z); scene.add(m);
  return anim(ms, (k) => { const q = shrink ? 1 - k * 0.85 : 0.2 + k * 0.8; m.scale.setScalar(r * q); m.material.opacity = shrink ? Math.min(1, k * 4) * (1 - k * 0.5) : 1 - k; }, () => drop(scene, m));
}

// 升级: a column of gold light rises through the general from a ring opening at his feet, motes drifting up
// with it (the original only stops the theme for phrase 123 and opens its window, bank13 $C747; the light is the
// remake's). `at` is about his chest, as the 计略 effects take it.
const pillarTex = canvasTex(32, 64, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  const gx = g.createLinearGradient(0, 0, 32, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 64);
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, 32, 64); // soft at both sides
});
pillarTex.magFilter = pillarTex.minFilter = THREE.LinearFilter;
export function levelUp(scene, at, anim = animate) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: pillarTex, color: '#ffd978', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
  m.center.set(0.5, 0); m.position.set(at.x, at.y - 0.75, at.z); m.renderOrder = 10; scene.add(m);
  echo(scene, 'flare', at, { color: '#ffd978', size: 2, ms: 1100 });
  ring(scene, at, '#ffcf60', { r: 1.6, ms: 1000 }, anim);
  later(160, () => ring(scene, at, '#fff2c0', { r: 1.05, ms: 900 }, anim));
  later(90, () => flare(scene, at, '#ffe9a8', { size: 1.3, ms: 560 }, anim)); // small: the general stays readable inside the light
  embers(scene, at, 34, '#ffd36a', { spread: 0.5, rise: 2.4, size: 0.42, ms: 1500 }, anim);
  later(300, () => embers(scene, at, 22, '#fff4d0', { spread: 0.32, rise: 3, size: 0.32, ms: 1300 }, anim));
  return anim(1400, (k) => {
    const up = 1 - (1 - Math.min(1, k / 0.35)) ** 3, out = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
    m.scale.set(0.95 * (1 - k * 0.35), 3.4 * up, 1); m.material.opacity = 0.6 * out;
  }, () => drop(scene, m));
}

// The board effect of each war-map 计略 (src/warview.js STRAT_FX names them by 计略 id), where the target
// stands: the same small vocabulary of sparks, embers, streaks, rings, dust and slashes, mixed so that each
// reads as its own (fire is not a flood, a trap is not an ambush).
const later = (ms, f) => setTimeout(f, ms);
const burst = (s, at, n, c) => sparkBurst(s, at, n, c, animate, 0.5, glowTex);
export const STRATEGY_FX = {
  fire: (s, at) => { flames(s, at, '#ffffff', { n: 7, spread: 0.55, h: 1.5, ms: 1100 }); later(100, () => flare(s, at, '#ff9a40', { size: 2.6, ms: 500 })); embers(s, at, 30, '#ff8a30'); later(380, () => embers(s, at, 24, '#ffc060', { rise: 2.8 })); },
  pit: (s, at) => { ring(s, at, '#c8a070', { r: 1.1, shrink: true, ms: 420 }); later(320, () => { dustPuff(s, at, 1.8); flare(s, at.clone().setY(at.y - 0.5), '#a08060', { size: 1.8 }); slash(s, at, false, 1.4, animate, 1.57); }); later(460, () => dustPuff(s, at, 1.2)); },
  phantom: (s, at) => { for (let i = 0; i < 4; i++) later(i * 140, () => { const a = i * Math.PI / 2 + 0.6, p = at.clone(); p.x += Math.cos(a) * 0.9; p.z += Math.sin(a) * 0.9; dustPuff(s, p, 1); flare(s, p, '#b8a8ff', { size: 1.2, ms: 420 }); }); ring(s, at, '#c8b8ff', { r: 2, shrink: true, ms: 900 }); },
  ambush: (s, at) => { slash(s, at, false, 1.8); later(140, () => slash(s, at, true, 1.8)); later(280, () => { slash(s, at, false, 2.1); flare(s, at, '#fff0c0', { size: 2 }); dustPuff(s, at, 1.3); }); },
  rapids: (s, at) => { flare(s, at, '#8ad8ff', { size: 2.6, ms: 420 }); burst(s, at, 50, '#7ad0ff'); later(200, () => ring(s, at, '#9ae0ff', { r: 1.6 })); later(380, () => burst(s, at, 30, '#e0f6ff')); },
  firearrows: (s, at) => { streaks(s, at, 10, '#ffa040'); later(420, () => { flare(s, at, '#ffb050', { size: 2 }); flames(s, at, '#ffffff', { n: 5, spread: 0.5, h: 1.1, ms: 800 }); embers(s, at, 24, '#ff7a30'); }); },
  feint: (s, at) => { slash(s, at, true, 1.6); later(260, () => { flare(s, at, '#ff6a3a', { size: 2.2 }); burst(s, at, 34, '#ff5a2a'); flames(s, at, '#ffd0c0', { n: 4, spread: 0.35, h: 1, ms: 700 }); }); },
  strife: (s, at) => { for (let i = 0; i < 5; i++) later(i * 110, () => { slash(s, at, i % 2 === 1, 1.5); if (i % 2) { burst(s, at, 14, '#ff4040'); flare(s, at, '#ff5050', { size: 1.4, ms: 260 }); } }); },
  lure: (s, at) => { embers(s, at, 34, '#ffe070', { rise: 1.4, size: 0.6, ms: 1100 }); ring(s, at, '#ffd070', { r: 1.4, ms: 900 }); flare(s, at, '#ffe890', { size: 2.2, ms: 900 }); },
  rocks: (s, at) => { streaks(s, at, 6, '#b8a890', { len: 0.8, ms: 360 }); later(330, () => { dustPuff(s, at, 2); flare(s, at, '#d8c8a8', { size: 1.8, ms: 300 }); burst(s, at, 20, '#d8c8a8'); }); later(480, () => dustPuff(s, at, 1.4)); },
  chain: (s, at) => { ring(s, at, '#c0c8d0', { r: 1.3, shrink: true, ms: 500 }); later(250, () => ring(s, at, '#e8eef4', { r: 0.9, shrink: true, ms: 450 })); later(480, () => { flare(s, at, '#e8f0ff', { size: 2 }); burst(s, at, 30, '#ffffff'); }); },
  encircle: (s, at) => { ring(s, at, '#ff5040', { r: 3, shrink: true, ms: 700 }); for (let i = 0; i < 8; i++) later(i * 60, () => { const a = i * Math.PI / 4, p = at.clone(); p.x += Math.cos(a) * 1.4; p.z += Math.sin(a) * 1.4; dustPuff(s, p, 0.9); }); later(620, () => { slash(s, at, false, 2.2); flare(s, at, '#ff7060', { size: 2 }); }); },
  flood: (s, at) => { ring(s, at, '#6ab8ff', { r: 2.6, ms: 900 }); flare(s, at, '#6ab8ff', { size: 3.2, ms: 700 }); burst(s, at, 60, '#7ad0ff'); later(250, () => embers(s, at, 40, '#c8ecff', { spread: 1.1, rise: 1.6 })); },
  bolts: (s, at) => { streaks(s, at, 12, '#fff0c0', { from: 'side', len: 0.9, ms: 360, spread: 0.6 }); later(300, () => { flare(s, at, '#fff0c0', { size: 1.8, ms: 280 }); burst(s, at, 26, '#ffe0a0'); }); },
  firestorm: (s, at) => { flames(s, at, '#ffffff', { n: 12, spread: 1.3, h: 2, ms: 1300 }); later(150, () => flames(s, at, '#ffb090', { n: 6, spread: 0.6, h: 1.4, ms: 1000 })); ring(s, at, '#ff6a20', { r: 2.4, ms: 800 }); flare(s, at, '#ff7a30', { size: 3.6, ms: 700 }); later(200, () => embers(s, at, 50, '#ff9030', { spread: 1.2, rise: 3 })); },
  qimen: (s, at) => { for (let i = 0; i < 3; i++) later(i * 220, () => ring(s, at, '#c070ff', { r: 1 + i * 0.7, ms: 800 })); flare(s, at, '#c890ff', { size: 2.4, ms: 1000 }); embers(s, at, 30, '#e0b0ff', { rise: 1.2, size: 0.55, ms: 1200 }); },
};

// three.js frees nothing by itself: an object taken out for good gives back its geometry and material (a sprite's
// geometry is three's shared quad; textures here are shared module constants and stay).
export function drop(parent, o) {
  parent.remove(o);
  if (!o.isSprite) o.geometry?.dispose();
  for (const m of [o.material].flat()) m?.dispose();
}

// The GPU resources (geometries, materials and their textures) of objects taken out of a scene that nothing in
// `live` and nothing in `keep` still uses: the battle views rebuild their sets for every fight. Shared resources
// still in use are spared, and one freed while some other scene holds it is just uploaded again on its next use.
export function release(gone, live, keep = []) {
  const collect = (roots, out) => {
    for (const root of roots) root?.traverse((o) => {
      if (o.geometry && !o.isSprite) out.add(o.geometry);
      for (const m of [o.material].flat()) {
        if (!m) continue;
        out.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) out.add(v);
        for (const u of Object.values(m.uniforms ?? {})) if (u?.value?.isTexture) out.add(u.value);
      }
    });
    return out;
  };
  const used = collect([live], new Set(keep));
  for (const r of collect(gone, new Set())) if (!used.has(r)) r.dispose();
}

// Camera shake as smooth noise, not a fresh random offset each frame (which buzzes like static): two sines per
// axis at unrelated rates (~5–8 Hz, slow enough that each frame moves on from the last at 30–60 fps), about as strong on average as the old ±k/2 jitter. k is the caller's
// decaying strength; the player's 震屏 setting (shakeLevel, 系统 menu) scales it: 1 full, 0.4 reduced, 0 off.
const SHAKE_KEY = 'hd2d-shake';
let shakeK = (() => { try { const v = localStorage.getItem(SHAKE_KEY); return v == null ? 1 : Math.max(0, Math.min(1, Number(v) || 0)); } catch { return 1; } })();
export const shakeLevel = () => shakeK;
export function setShakeLevel(v) { shakeK = v; try { localStorage.setItem(SHAKE_KEY, String(v)); } catch {} }
// The pad's rumble follows the shake (app.js sets it; src/pad.js): the same strength, so 震屏 关 stills both.
let rumbleHook = null;
export const onShake = (f) => { rumbleHook = f; };
export function shakeOffset(t, k, out, ky = 1) {
  k *= shakeK;
  if (k > 0.01) rumbleHook?.(k);
  return out.set(k * (0.36 * Math.sin(t * 31) + 0.22 * Math.sin(t * 47 + 1.3)), ky * k * (0.36 * Math.sin(t * 37 + 2.1) + 0.22 * Math.sin(t * 53 + 0.4)), 0);
}

export function animate(ms, f, done) {
  return new Promise((res) => {
    const t0 = performance.now();
    // k = 0 now, not on the next frame: the game's render runs first there, and would draw a new effect where it was made, at the world origin.
    // A frame's timestamp can predate t0, so k is held at 0 until time has passed.
    f(0);
    const step = (t) => { const k = Math.max(0, Math.min(1, (t - t0) / ms)); f(k); if (k < 1) requestAnimationFrame(step); else { done?.(); res(); } };
    requestAnimationFrame(step);
  });
}

// A soft cumulus puff (linear-filtered, not pixel art): edge cloud banks and out-of-focus foreground wisps.
export const puffTex = (() => {
  const r = rng(41);
  const t = canvasTex(128, 64, (g) => {
    for (let i = 0; i < 26; i++) {
      const x = 20 + r() * 88, y = 30 + (r() - 0.3) * 18, rad = 10 + r() * 16;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,252,246,0.55)'); gr.addColorStop(1, 'rgba(255,252,246,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 64);
    }
  });
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
})();
