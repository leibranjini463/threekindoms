// Strategy AI wars: receives scene, roads, city positions, camera actions and pulse hooks; owns standards and their show.
import * as THREE from 'three';
import { canvasTex } from './pixel.js';
import { puffTex } from './fx.js';
import { SEA_Y } from './worldmap.js';

// An AI war's standard bears the ruler's surname; the cloth is drawn in a 96×128 space, on the 3D map's plane and the flat map's canvas alike.
export const COMPOUND = ['公孙', '诸葛', '司马', '夏侯', '皇甫', '太史'];
export const surnameOf = (nm) => COMPOUND.find((s) => nm.startsWith(s)) ?? nm[0];
export function paintBanner(g, col, sur) {
  g.fillStyle = col; g.fillRect(0, 0, 96, 128);
  g.fillStyle = '#0005'; g.fillRect(0, 0, 96, 6); g.fillRect(0, 0, 6, 128);
  // the flame-tooth edging along the fly and the foot
  g.fillStyle = '#e8c070';
  for (let y = 0; y < 128; y += 12) { g.beginPath(); g.moveTo(84, y); g.lineTo(96, y + 6); g.lineTo(84, y + 12); g.fill(); }
  for (let x = 6; x < 84; x += 12) { g.beginPath(); g.moveTo(x, 116); g.lineTo(x + 6, 128); g.lineTo(x + 12, 116); g.fill(); }
  g.fillStyle = '#f4ead2'; g.beginPath(); g.arc(45, 58, 34, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0006'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#1a1008'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (sur.length > 1) { g.font = '28px "Ma Shan Zheng", "Noto Serif SC", serif'; g.fillText(sur[0], 45, 42); g.fillText(sur[1], 45, 72); }
  else { g.font = '52px "Ma Shan Zheng", "Noto Serif SC", serif'; g.fillText(sur, 45, 60); }
}

export function createStrategyWar({ scene, sand, cityPos, pathOf, groundY, colorOf, frame, focusCity, clashFocus, attention, addPulse, pulseCount }) {
  let time = 0;
  // A war between two AI factions on the board, in the original's three beats (its AI-turn window reads 「××軍
  // 出陣」, 「××軍 戦闘中」, the winner's 「××軍 勝利」, 142 frames each; research/strategic-ai-evidence.md): the
  // attacker's standard marches down the road from his city, the two standards clash before the walls, the
  // loser's falls and a winning attacker rides in. A standard is a war-room marker: a lacquered block in the
  // faction's colour under a tall banner bearing the ruler's surname, two pennants behind.
  const bannerTex = (f, nm) => {
    const sur = surnameOf(nm), paint = (g) => paintBanner(g, colorOf(f), sur);
    const tex = canvasTex(96, 128, paint); tex.magFilter = THREE.LinearFilter;
    // The brush face may still be loading: paint again once it is in.
    document.fonts?.load('52px "Ma Shan Zheng"', sur).then(() => { const c = tex.userData.canvas.getContext('2d'); c.clearRect(0, 0, 96, 128); paint(c); tex.needsUpdate = true; }).catch(() => {});
    return tex;
  };
  const pennantGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.16, 0), new THREE.Vector3(0.26, -0.08, 0)]);
  pennantGeo.computeVertexNormals();
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false });
  const standard = (f, nm) => {
    const col = colorOf(f), g = new THREE.Group(), mats = [];
    const mat = (o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, ...o }); mats.push(m); return m; };
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.2), mat({ color: col, roughness: 0.35 })); block.position.y = 0.035;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.016, 0.22), mat({ color: "#d8b060", metalness: 0.5, roughness: 0.4 })); trim.position.y = 0.077;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.0, 6), mat({ color: '#3a2818' })); pole.position.set(-0.1, 0.58, 0);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), mat({ color: '#e8c878', metalness: 0.6, roughness: 0.3 })); finial.position.set(-0.1, 1.12, 0);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.44, 8, 1).translate(0.165, -0.22, 0), mat({ map: bannerTex(f, nm), side: THREE.DoubleSide, roughness: 0.9, emissive: '#fff', emissiveIntensity: 0.08 }));
    mats.at(-1).emissiveMap = mats.at(-1).map; banner.position.set(-0.086, 1.06, 0);
    g.add(block, trim, pole, finial, banner);
    const waving = [banner];
    for (const [x, z] of [[0.1, -0.07], [0.15, 0.06]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.62, 5), mats[2]); p.position.set(x, 0.39, z);
      const pen = new THREE.Mesh(pennantGeo.clone(), mat({ color: col, side: THREE.DoubleSide, roughness: 0.9 })); pen.position.set(x, 0.69, z);
      g.add(p, pen); waving.push(pen);
    }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), shadowMat.clone()); shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1, 0.7, 1); shadow.position.y = 0.012; mats.push(shadow.material);
    const root = new THREE.Group(); root.add(shadow, g); root.scale.setScalar(SZ); scene.add(root);
    return { root, body: g, mats, waving, alpha: 1, fall: 0, fallDir: 1, lunge: 0, base: new THREE.Vector3(), set opacity(a) { this.alpha = a; for (const m of mats) m.opacity = m === shadow.material ? 0.32 * a : a; } };
  };
  // A standard stands about as tall as a city's keep, so it reads at the zoom the board frames the two cities at.
  const WAR = sand ? 0.7 : 1, SZ = 1.5 * WAR; // the sand table's towns are smaller than the procedural board's
  let warShow = null;
  function aiWar({ from, to, att, def, attName, defName }) {
    warShow?.dispose();
    const end = cityPos[to];
    // The road from his city as the board draws it; without one, a straight approach from the south-west.
    let pts = from != null && from !== to ? pathOf(from, to) : null;
    if (!pts) { const s = new THREE.Vector3(end.x - 2.4, 0, end.z + 1.4); pts = Array.from({ length: 25 }, (_, k) => { const p = s.clone().lerp(end, k / 24); p.y = groundY(p.x, p.z); return p; }); }
    const runs = [0]; for (let k = 1; k < pts.length; k++) runs.push(runs[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const L = runs.at(-1);
    const at = (d, out = new THREE.Vector3()) => {
      d = Math.max(0, Math.min(L, d));
      let k = 1; while (k < runs.length - 1 && runs[k] < d) k++;
      const u = (d - runs[k - 1]) / ((runs[k] - runs[k - 1]) || 1);
      out.copy(pts[k - 1]).lerp(pts[k], u); out.y = Math.max(SEA_Y, out.y); return out;
    };
    const A = standard(att, attName), D = standard(def, defName), stopA = Math.max(0, L - 2.1 * WAR), holdD = Math.max(0, L - 1.05 * WAR);
    D.root.visible = false; A.opacity = 0;
    const dust = [], puffs = new THREE.SpriteMaterial({ map: puffTex, color: '#d8c8a2', transparent: true, depthWrite: false, opacity: 0.6 });
    const spark = new THREE.SpriteMaterial({ map: puffTex, color: '#ffc070', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const kick = (p, { n = 1, spread = 0.12, size = 0.32, life = 0.9, mat = puffs } = {}) => {
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(mat.clone()); s.position.set(p.x + (Math.random() - 0.5) * spread, p.y + 0.05, p.z + (Math.random() - 0.5) * spread);
        s.userData = { t: 0, life, size, vy: 0.12 + Math.random() * 0.1, o: s.material.opacity }; scene.add(s); dust.push(s);
      }
    };
    let stage = null, t = 0, len = 1, nextDust = 0, attWins = false, rideFrom = 0, leanA = 0, leanD = 0;
    const tmp = new THREE.Vector3(), mid = new THREE.Vector3();
    const place = (S, d, out = S.base) => { at(d, out); S.root.position.copy(out); S.d = d; };
    place(A, 0); place(D, holdD);
    const show = warShow = {
      march(ms) { stage = 'march'; t = 0; len = ms / 1000; if (from != null && from !== to) frame([from, to]); else focusCity(to); },
      clash(ms) {
        // nextDust: the march's clock would hold the first blow back to the clash's last moment.
        stage = 'clash'; t = 0; len = ms / 1000; nextDust = 0; place(A, stopA); A.opacity = 1; D.root.visible = true; D.opacity = 0;
        // Closer in, on the ground between the two standards and the walls behind.
        at((stopA + L) / 2, mid); clashFocus(mid);
      },
      end(wins, ms) {
        stage = 'end'; t = 0; len = ms / 1000; attWins = wins; A.opacity = 1; D.opacity = 1; D.root.visible = true; A.lunge = D.lunge = 0;
        const loser = wins ? D : A; loser.fallDir = Math.sign(loser.root.position.x - (wins ? A : D).root.position.x) || 1;
        // From wherever his last lunge has him, leaning as he was: back to his mark first would be a jump.
        rideFrom = A.d; leanA = A.body.rotation.z; leanD = D.body.rotation.z;
      },
      tick(dt) {
        t += dt;
        for (const S of [A, D]) for (const [i, m] of S.waving.entries()) {
          const p = m.geometry.attributes.position;
          for (let v = 0; v < p.count; v++) { const x = p.getX(v); p.setZ(v, Math.sin(time * 6 + x * 18 + i) * 0.12 * x); }
          p.needsUpdate = true;
        }
        if (stage === 'march') {
          // Rises at his city, then down the road at an even pace with a little stride, dust at its heels.
          A.opacity = Math.min(1, t / 0.3);
          const e = Math.min(1, Math.max(0, (t - 0.2) / Math.max(0.1, len * 0.88 - 0.2))), d = stopA * (e * e * (3 - 2 * e) * 0.35 + e * 0.65);
          place(A, d); A.body.position.y = Math.abs(Math.sin(t * 9)) * 0.03 * (e > 0 && e < 1);
          if (e > 0 && e < 1 && t >= nextDust) { kick(A.base, { size: 0.7 * WAR, spread: 0.3 * WAR }); nextDust = t + 0.09; }
        } else if (stage === 'clash') {
          // The defender's standard stands up before his walls; the two lunge at each other in turn, dust and sparks
          // flying between them, rings of both colours off the city.
          D.opacity = Math.min(1, t / 0.25);
          const beat = (t * 2.6) % 1, a = Math.max(0, Math.sin(beat * Math.PI * 2)), b = Math.max(0, -Math.sin(beat * Math.PI * 2));
          place(A, stopA + 0.3 * a, tmp); place(D, holdD - 0.3 * b, tmp);
          A.body.rotation.z = -0.12 * a * Math.sign(D.root.position.x - A.root.position.x || 1); D.body.rotation.z = 0.12 * b * Math.sign(D.root.position.x - A.root.position.x || 1);
          mid.copy(A.root.position).lerp(D.root.position, 0.5);
          if (t >= nextDust) {
            kick(mid, { n: 4, spread: 0.7 * WAR, size: WAR, life: 0.8 }); kick(mid, { n: 3, spread: 0.5 * WAR, size: 0.4 * WAR, life: 0.3, mat: spark });
            nextDust = t + 0.36;
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 32), new THREE.MeshBasicMaterial({ color: colorOf(Math.floor(t / 0.36) % 2 ? def : att), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            ring.rotation.x = -Math.PI / 2; ring.position.copy(mid); ring.position.y += 0.08; ring.userData.t0 = time; scene.add(ring); addPulse(ring);
          }
        } else if (stage === 'end') {
          // The loser's standard topples away from the winner and fades; a winning attacker rides into the city.
          const loser = attWins ? D : A, winner = attWins ? A : D, f = Math.min(1, t / 0.55);
          const lean = (S) => (S === A ? leanA : leanD) * Math.max(0, 1 - t / 0.15);
          loser.body.rotation.z = lean(loser) - loser.fallDir * (Math.PI / 2) * f * f; loser.opacity = 1 - Math.min(1, Math.max(0, (t - 0.45) / 0.6));
          if (t < 0.1) kick(loser.root.position, { n: 2, spread: 0.6 * WAR, size: 0.9 * WAR });
          winner.body.rotation.z = lean(winner);
          if (attWins) { const e = Math.min(1, t / 0.9); place(A, rideFrom + (L - rideFrom) * e * (2 - e)); }
          winner.body.position.y = 0.05 * Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI));
          if (t > len - 0.35) winner.opacity = Math.max(0, (len - t) / 0.35);
        }
        for (let i = dust.length - 1; i >= 0; i--) {
          const s = dust[i], u = (s.userData.t += dt) / s.userData.life;
          if (u >= 1) { scene.remove(s); s.material.dispose(); dust.splice(i, 1); continue; }
          s.position.y += s.userData.vy * dt; const w = s.userData.size * (0.6 + u * 0.9); s.scale.set(w, w, 1); s.material.opacity = s.userData.o * (1 - u);
        }
      },
      debug() { const of = (S) => ({ x: S.root.position.x, y: S.root.position.y, z: S.root.position.z, lean: S.body.rotation.z }); return { stage, a: of(A), d: of(D), dust: dust.length, rings: pulseCount() }; },
      dispose() {
        for (const S of [A, D]) { scene.remove(S.root); S.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); for (const m of S.mats) { m.map?.dispose(); m.dispose(); } }
        for (const s of dust) { scene.remove(s); s.material.dispose(); } dust.length = 0;
        if (warShow === show) { warShow = null; attention(); }
      },
    };
    attention(); return show;
  }
  return { aiWar, get active() { return !!warShow; }, update(dt, now) { time = now; warShow?.tick(dt); } };
}
