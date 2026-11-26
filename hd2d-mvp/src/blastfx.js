// 爆炎 in the 白兵 (S12 blast; the user's ask of 2026-11-07: a bomb thrown, then a real explosion): a painted 火药罐
// arcs from the general's hand with its fuse burning and its shadow growing under it, then a white flash, a painted
// eight-frame explosion over the 3×3 it strikes (assets/ai/tactical/blast-*.webp, tools/build_blast_fx.py), a
// shockwave, flying clods and fire, embers, and a scorch mark that fades after.
//
// One rig per view, made once. Its pieces stay in the scene, parked far under the field where no camera looks, so
// they are never drawn (frustum culled) yet are compiled with the field by the 白兵 prewarm (post.compile compiles
// only visible objects): the first throw makes no new shader program. No light is added for the flash: a light would
// change the program of every lit material on the field.
import * as THREE from 'three';
import { canvasTex } from './pixel.js';
import { glowTex, sparkBurst, embers, dustPuff, animate } from './fx.js';

const PARK = -400; // far under and off to the side of the field (never over its middle, where tests look for strays)
const DIR = 'assets/ai/tactical';
const texture = (f) => new Promise((res) => new THREE.TextureLoader().load(`${DIR}/${f}`, (t) => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));
// the explosion's eight frames (4 × 2 cells, the blast's foot 8 px over each cell's bottom edge) and how long each
// holds at 1× before the view's pace (ms): a quick bloom, a held fireball, a slow smoke
const FRAMES = [55, 60, 75, 110, 140, 160, 190, 230];
const FOOT = 8 / 256;
const shadowTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.7, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const ringTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 18, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,160,0)'); gr.addColorStop(0.6, 'rgba(255,210,140,0.9)'); gr.addColorStop(0.8, 'rgba(255,170,90,0.5)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
// the flash's own glow: fx.js glowTex keeps a little light at its rim, which at this size shows as a square
const flashTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 28); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,250,230,0.9)'); gr.addColorStop(0.5, 'rgba(255,220,170,0.35)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
for (const t of [shadowTex, ringTex, flashTex]) t.magFilter = t.minFilter = THREE.LinearFilter;

export function blastRig(scene) {
  const add = (o) => { o.position.set(PARK, PARK, PARK); o.userData.noSeason = true; scene.add(o); return o; };
  const sprite = (opt) => add(new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0, ...opt })));
  const flat = (map, opt) => { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, ...opt }))); m.rotation.x = -Math.PI / 2; return m; };
  const bomb = sprite({}), fuse = sprite({ map: glowTex, color: '#ffd080', blending: THREE.AdditiveBlending });
  const burst = sprite({}), flash = sprite({ map: flashTex, color: '#fff2c8', blending: THREE.AdditiveBlending, depthTest: false });
  const shadow = flat(shadowTex), ring = flat(ringTex, { blending: THREE.AdditiveBlending }), scorch = flat(null);
  flash.renderOrder = 10; burst.renderOrder = 6; bomb.renderOrder = 7;
  // a Points object as the sparks, clods and embers of fx.js draw them, so their program is built with the field too
  const dots = add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)), new THREE.PointsMaterial({ map: glowTex, size: 0.2, transparent: true, depthWrite: false, fog: false, opacity: 0 })));
  dots.frustumCulled = true; dots.geometry.computeBoundingSphere();
  // the painted pieces; without them (a failed load) play() falls back to a flash, sparks and smoke alone
  const ready = Promise.all([texture('blast-bomb.webp'), texture('blast-burst.webp'), texture('blast-scorch.webp')]).then(([b, s, c]) => {
    if (b) { bomb.material.map = b; bomb.material.needsUpdate = true; }
    if (s) { s.repeat.set(1 / 4, 1 / 2); burst.material.map = s; burst.material.needsUpdate = true; burst.center.set(0.5, FOOT); }
    if (c) { scorch.material.map = c; scorch.material.needsUpdate = true; }
    return !!(b && s && c);
  });
  const park = (...os) => { for (const o of os) { o.position.set(PARK, PARK, PARK); o.material.opacity = 0; } };
  const frame = (i) => { const t = burst.material.map; if (t) t.offset.set((i % 4) / 4, i < 4 ? 0.5 : 0); };
  let scorchFade = null, last = Promise.resolve();

  // from: the thrower's hand; to: the middle of the 3×3 on the ground; d: the view's pace (ms at 1× → ms now);
  // onBurst() lands the blow (damage, recoil) the moment the explosion goes off; shake(k) shakes the camera.
  // Resolves once the fire has broken into smoke, when the field can go on; the smoke and the scorch carry on.
  // dud: thrown off the board (the original ends the flight at the edge, B440): the pot flies on out of sight, fading, and
  // nothing bursts.
  function play({ from, to, d, onBurst, shake, dud = false }) {
    const run = last.then(async () => {
      const has = await ready;
      if (dud) {
        if (!has) return;
        const far = to.clone().sub(from).setY(0).multiplyScalar(0.6).add(to), fly = d(560);
        bomb.scale.setScalar(0.42); fuse.material.opacity = 1; shadow.material.opacity = 0.4;
        await animate(fly, (k) => {
          bomb.position.lerpVectors(from, far, k); bomb.position.y += Math.sin(Math.min(1, k * 1.25) * Math.PI) * 1.8 - Math.max(0, k - 0.8) * 3;
          bomb.material.rotation = -k * Math.PI * 3; bomb.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
          const r = 0.21, a = bomb.material.rotation + Math.PI * 0.32;
          fuse.position.set(bomb.position.x + Math.cos(a) * r, bomb.position.y + Math.sin(a) * r, bomb.position.z + 0.01);
          fuse.scale.setScalar(0.22 + Math.random() * 0.14); fuse.material.opacity = bomb.material.opacity;
          shadow.position.set(bomb.position.x, to.y + 0.02, bomb.position.z); shadow.material.opacity = 0.4 * bomb.material.opacity;
        });
        park(bomb, fuse, shadow);
        return;
      }
      const dist = from.distanceTo(to), arc = 1.4 + dist * 0.18, fly = d(420 + dist * 22);
      // the throw: the pot spins along its arc, the fuse sparkling at its mouth, its shadow closing in under it
      if (has) {
        bomb.scale.setScalar(0.42); bomb.material.opacity = 1; fuse.material.opacity = 1;
        shadow.material.opacity = 0.5;
        await animate(fly, (k) => {
          bomb.position.lerpVectors(from, to, k); bomb.position.y += Math.sin(k * Math.PI) * arc;
          bomb.material.rotation = -k * Math.PI * 3;
          const r = 0.21, a = bomb.material.rotation + Math.PI * 0.32; // the fuse's tip, up and right of the pot's centre as painted
          fuse.position.set(bomb.position.x + Math.cos(a) * r, bomb.position.y + Math.sin(a) * r, bomb.position.z + 0.01);
          fuse.scale.setScalar(0.22 + Math.random() * 0.14);
          shadow.position.set(bomb.position.x, to.y + 0.02, bomb.position.z); shadow.scale.setScalar(0.35 + k * 0.4); shadow.material.opacity = 0.2 + k * 0.4;
        });
        park(bomb, fuse, shadow);
      }
      // the blast: a flash and the first frame held a beat (the impact frame), the blow, then the fire rolls up
      onBurst?.(); shake?.(0.6);
      flash.position.copy(to).setY(to.y + 0.9);
      animate(d(260), (k) => { flash.scale.setScalar(2 + k * 4); flash.material.opacity = k < 0.12 ? k / 0.12 : (1 - k) ** 2; }, () => park(flash));
      ring.position.copy(to).setY(to.y + 0.04);
      animate(d(480), (k) => { ring.scale.setScalar(0.6 + (1 - (1 - k) ** 3) * 4.4); ring.material.opacity = 0.95 * (1 - k) ** 1.2; }, () => park(ring));
      if (has) {
        clearTimeout(scorchFade?.t); scorchFade?.stop?.();
        scorch.position.copy(to).setY(to.y + 0.05); scorch.scale.setScalar(3.6);
        scorch.rotation.z = Math.random() * Math.PI * 2; scorch.material.opacity = 0.92;
      }
      const flying = sparkBurst(scene, to.clone().setY(to.y + 0.4), 70, '#ffb050', animate, 0.22);
      sparkBurst(scene, to.clone().setY(to.y + 0.3), 26, '#5a3a22', animate, 0.24); // clods of earth
      embers(scene, to, 28, '#ff8a30', { spread: 1.1, rise: 2.4, size: 0.42, ms: d(1500) });
      if (!has) { dustPuff(scene, to.clone().setY(to.y + 0.5), 3.2); await flying; return; }
      burst.position.copy(to); burst.scale.set(3.6, 3.6 * 256 / 192, 1); burst.material.opacity = 1;
      let broken;
      const fire = new Promise((res) => { broken = res; });
      (async () => {
        for (let i = 0; i < FRAMES.length; i++) {
          frame(i);
          if (i === 4) broken();
          const ms = d(FRAMES[i]);
          if (i >= 5) await animate(ms, (k) => { burst.material.opacity = i === 7 ? 1 - k : 1; });
          else await new Promise((r) => setTimeout(r, ms));
        }
        park(burst);
        // the scorch fades over a few seconds after the smoke has gone
        const s = { stop: null }; scorchFade = s;
        s.t = setTimeout(() => { let on = true; s.stop = () => { on = false; }; animate(d(1600), (k) => { if (on) scorch.material.opacity = 0.92 * (1 - k); }, () => on && park(scorch)); }, d(1800));
      })();
      await fire;
    });
    last = run.catch(() => {});
    return run;
  }
  // a new field: nothing of the last 爆炎 lies on it
  function clear() { clearTimeout(scorchFade?.t); scorchFade?.stop?.(); park(bomb, fuse, shadow, burst, flash, ring, scorch); }
  return { play, clear, ready };
}
