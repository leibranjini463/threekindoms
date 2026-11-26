// The war map's units (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): each general's figure on his
// side's ring, his name tag and its declutter, the fade of one leaving the field, and the overview's roundels.
// tacticalOn and lastFigs are reassigned here and read elsewhere: they are wv.tacticalOn and wv.lastFigs, never copied.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { unitTex, canvasTex } from '../pixel.js';
import { litSprite, shadowCaster, sunYaw, silhouetteNormals } from '../sprite3d.js';
import { xraySprite } from '../seethrough.js';
import { name, data } from '../core/game.js';
import { genericArt } from '../core/pack.js';
import { markFigure, tween } from './shared.js';
import { labelK } from '../labelsize.js';

export function makeUnits(wv) {
  const { field, human, sprites, scene, camera, sun, wx, wz, topY, r, vsigns, LANDMARK_KEEP } = wv;
  // --- Units: a star officer rides in his own strip; anyone else as his side's general, the player's side
  // blue-green, the enemy red (the tags and the see-through silhouettes keep the sides' colours either way). ---
  const look = (side) => (side === human || (!human && side === 'att') ? 'attacker' : 'defender');
  const views = new Map();
  // A general stands FIGURE cells tall, and never wider than a cell (a horse's reach or a banner would spill over
  // the neighbour): one whose opaque width in the first frame comes out wider is scaled down whole.
  const FIGURE = 1.3, BASE_H = 0.03, MAX_W = 1;
  // His ring: a side-colour band round the cell's middle over a faint disc of the same colour, flat on the ground.
  const BASE_GEO = new THREE.RingGeometry(0.36, 0.46, 48); BASE_GEO.rotateX(-Math.PI / 2);
  const DISC_GEO = new THREE.CircleGeometry(0.36, 48); DISC_GEO.rotateX(-Math.PI / 2);
  const RING_FILL = 0.42, RING_FALL = 3.2;
  const SIDE_COL = { attacker: '#2f5cc4', defender: '#b8322c' };
  const baseMat = Object.fromEntries(Object.entries(SIDE_COL).map(([k, c]) => [k, markFigure(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))]));
  // The fill is a falloff: clear at the feet, gathering toward the band, so it lays a soft side-colour glow against the band instead of a flat
  // field whose weight swung with the ground under it (a bold disc on grass or water, a faint one over rock).
  const FILL = (() => {
    const n = 128, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), im = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const t = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)), v = Math.round(255 * Math.pow(t, RING_FALL)), i = (y * n + x) * 4; im.data.set([v, v, v, 255], i); }
    g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); return t;
  })();
  const discMat = Object.fromEntries(Object.entries(SIDE_COL).map(([k, c]) => [k, new THREE.MeshBasicMaterial({ color: c, alphaMap: FILL, transparent: true, opacity: RING_FILL, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })]));
  // The opaque box of a strip's first frame as fractions of the cell {x0, x1, y0, y1} (y from the bottom).
  const boxes = new Map();
  function opaqueBox(img, n) {
    if (boxes.has(img)) return boxes.get(img);
    let box = { x0: 0, x1: 1, y0: 0, y1: 1 };
    try {
      const cw = Math.round(img.width / n), ch = img.height, c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch);
      const d = g.getImageData(0, 0, cw, ch).data; let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0) box = { x0: x0 / cw, x1: (x1 + 1) / cw, y0: 1 - (y1 + 1) / ch, y1: 1 - y0 / ch };
    } catch {}
    boxes.set(img, box); return box;
  }
  // The same over every frame of a strip (he turns and walks through them): what the see-through ellipse must cover.
  const unions = new WeakMap();
  function stripBox(img, n) {
    if (unions.has(img)) return unions.get(img);
    let box = { x0: 0, x1: 1, y0: 0, y1: 1 };
    try {
      const cw = Math.round(img.width / n), ch = img.height, c = document.createElement('canvas'); c.width = cw * n; c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, cw * n, ch, 0, 0, cw * n, ch);
      const d = g.getImageData(0, 0, cw * n, ch).data; let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
      for (let y = 0; y < ch; y++) for (let X = 0; X < cw * n; X++) if (d[(y * cw * n + X) * 4 + 3] > 127) { const x = X % cw; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0) box = { x0: x0 / cw, x1: (x1 + 1) / cw, y0: 1 - (y1 + 1) / ch, y1: 1 - y0 / ch };
    } catch {}
    unions.set(img, box); return box;
  }
  wv.tacticalOn = false; // the overview is up (a unit added now gets his roundel at once)
  // With a march strip (tools/slice_march_frames.py) the general turns: side, three-quarter front or back by
  // his heading relative to the camera, mirrored for leftward headings, walking frames stepped by distance.
  // Without one he is the single side sprite, flipped left or right.
  function addUnit(u) {
    // Without a strip of his own he rides as his side's general in the weapon class he holds now (core/pack.js genericArt).
    const g = new THREE.Group(), lk = look(u.side), march = sprites[`march-${u.id}`] || sprites[`march-${genericArt(lk, field.O(u.id)?.weapon)}`] || sprites[`march-${lk}`];
    let tex, ntex = null, frames = null, aspect, bh, n = 1;
    if (march) {
      const { meta } = march; frames = meta.frames;
      tex = march.tex.clone(); tex.repeat.set(1 / frames.length, 1); tex.needsUpdate = true;
      ntex = silhouetteNormals(march.tex).clone(); ntex.repeat.copy(tex.repeat); ntex.needsUpdate = true;
      aspect = meta.cell[0] / meta.cell[1]; bh = FIGURE * meta.cell[1] / meta.standHeight; n = frames.length;
    } else {
      tex = sprites[lk] || unitTex(lk); aspect = tex.image.width / tex.image.height; bh = sprites[lk] ? FIGURE : FIGURE * 0.7;
    }
    const ob = opaqueBox(march ? march.tex.image : tex.image, n), ow = (ob.x1 - ob.x0) * bh * aspect;
    if (ow > MAX_W) bh *= MAX_W / ow;
    const size = { h: (ob.y1 - ob.y0) * bh, w: (ob.x1 - ob.x0) * bh * aspect };
    // The sprite stands on its feet (geometry origin at the bottom edge) so it can lean back toward the camera
    // and breathe without leaving the ground; it is lit through its silhouette normals (src/sprite3d.js),
    // and its shadow comes from an unseen copy turned to face the sun. A soft contact blob stays underfoot.
    const geo = new THREE.PlaneGeometry(bh * aspect, bh); geo.translate(0, bh / 2, 0);
    const body = new THREE.Mesh(geo, markFigure(litSprite(tex, { emissive: '#ffffff', emissiveIntensity: 0, ...(ntex ? { normalMap: ntex } : {}) })));
    { const ub = stripBox(march ? march.tex.image : tex.image, n), w = bh * aspect; body.userData.cutBox = { x0: (ub.x0 - 0.5) * w, x1: (ub.x1 - 0.5) * w, y0: ub.y0 * bh, y1: ub.y1 * bh }; } // src/seethrough.js
    body.position.y = -0.02;
    const caster = shadowCaster(geo, tex); caster.position.y = -0.02; caster.rotation.y = sunYaw(sun);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.3, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
    // He stands on a lacquered base in his side's colour, so the two armies part at a glance (A2).
    const base = new THREE.Mesh(BASE_GEO, baseMat[lk]), disc = new THREE.Mesh(DISC_GEO, discMat[lk]);
    for (const m of [base, disc]) { m.position.y = BASE_H; m.castShadow = false; m.userData.noSeason = true; m.raycast = () => {}; }
    disc.position.y = BASE_H - 0.004; disc.renderOrder = 1;
    const bill = new THREE.Group(); bill.rotation.order = 'YXZ'; bill.position.y = BASE_H; bill.add(body); g.add(shadow, base, disc, caster, bill); scene.add(g);
    // Where terrain, a set piece or another unit still hides him, he shows through as a silhouette in his side's colour.
    const xray = xraySprite(body, tex, lk === 'defender' ? '#ff7a62' : '#5fa8ff', ob.y0 * bh);
    const el = document.createElement('div'); el.className = `tag ${lk}`;
    // The tag stands just over the top of his picture (a mounted figure is ~0.9 tall, not FIGURE), so it reads as his and a leader line from it lands on him.
    const top = BASE_H + ob.y1 * bh * 0.95, label = new CSS2DObject(el); label.position.set(0, top + 0.26, 0); g.add(label);
    body.userData.unit = u;
    views.set(u, { size, top, quad: { w: bh * aspect, h: bh, ob }, opa: 1, ring: [base, disc], g, bill, body, caster, shadow, xray, el, label, bob: r(600) / 100, face: lk === 'defender' ? -1 : 1, flip: lk === 'defender' ? -1 : 1, moving: false, walk: false,
      heading: new THREE.Vector3(lk === 'defender' ? -1 : 1, 0, 0), stride: 0, tex, ntex, frames, frame: -1 });
    place(u); faceFoes(u); tag(u);
    if (wv.tacticalOn) roundelShow(u, views.get(u), true);
  }
  function place(u) { views.get(u).g.position.set(wx(u.x), topY(u.x, u.y), wz(u.y)); }
  // Standing, a general faces the enemy: toward the middle of the other army, along whichever board axis is nearer that way.
  // His heading is in the board's own frame (play.js pose() reads it against the camera each frame). It once was a fixed +x
  // for the attacker and −x for the defender, which at two of the four opening angles (pickYaw) turned both armies'
  // backs to each other. On a grid axis he is always in profile under the 45° camera, and the axis never puts him on the
  // other side of the screen from the enemy: |dx| > |dz| keeps the sign of dx − dz, and of dx + dz, and the same for dz.
  // A tenth of the other axis is kept: on the flat map (board unturned) an enemy mostly up or down the screen shows the
  // three-quarter back or front, and that much (past pose()'s 0.08) still leans it his way. Under the 45° camera it moves
  // the heading 6° (39° from the eye, still in profile; a fifth put it at 34°, the front view's edge).
  function faceFoes(u) {
    const v = views.get(u), foes = field.units.filter((e) => !e.gone && e.side !== u.side); if (!v || !foes.length) return;
    let dx = 0, dz = 0; for (const e of foes) { dx += e.x - u.x; dz += e.y - u.y; }
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
    if (Math.abs(dx) >= Math.abs(dz)) v.heading.set(Math.sign(dx), 0, 0.1 * Math.sign(dz)); else v.heading.set(0.1 * Math.sign(dx), 0, Math.sign(dz));
    v.heading.normalize();
  }
  // 奇门遁甲's day count under the name; with 诸葛亮 off the field the stones no longer take soldiers, and it says so.
  const qimenNote = (u) => (field.kongmingOn() ? `奇门 ${u.qimen}日` : '困·孔明不在');
  // 虚兵 / 连环 hold a general in place for days (feedback F10a, 2026-11-02): his tag says which and for how long, as 奇门 does.
  function holdNote(u) { return u.stop > 0 ? `${u.stopBy ?? '受困'} ${u.stop}日` : null; } // hoisted: tags are drawn before this line runs
  // The stone ring at the trapped one's feet: dashed stones, turning slowly while 诸葛亮 holds the array, still after.
  const QIMEN_RING = canvasTex(128, 128, (g) => {
    g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineCap = 'round'; g.setLineDash([13, 9]);
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.setLineDash([]); g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
  });
  QIMEN_RING.magFilter = QIMEN_RING.minFilter = THREE.LinearFilter;
  function tag(u) {
    const o = field.O(u.id), v = views.get(u);
    const keep = [...v.el.querySelectorAll('.lossnum')];
    v.el.innerHTML = `<b>${u.commander ? '★' : ''}${name(u.id)}</b>${u.qimen > 0 ? `<em class="st qimen">${qimenNote(u)}</em>` : ''}${holdNote(u) ? `<em class="st hold">${holdNote(u)}</em>` : ''}<i style="--w:${Math.min(100, Math.max(0, o.soldiers / 10))}%"></i><u style="--w:${Math.max(0, Math.min(100, (o.hp / (data().officers[u.id]?.hp || 100)) * 100))}%"></u><span>兵${o.soldiers}　体${o.hp}</span><s></s>`;
    v.el.append(...keep);
    v.leader = v.el.querySelector(':scope > s'); v.leaderOn = undefined; // the new <s> starts hidden by CSS
    if (u.qimen > 0 && !v.qring) {
      v.qring = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: QIMEN_RING, color: '#c070ff', transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
      v.qring.rotation.x = -Math.PI / 2; v.qring.position.y = 0.04; v.g.add(v.qring);
    }
    if (v.qring) v.qring.visible = u.qimen > 0;
  }
  // Tags of neighbouring generals would stack on each other (N09): on screen, the nearest (lowest) tag
  // keeps its place and each one behind it that would overlap a placed tag slides sideways (0, +d, -d, +2d, -2d,
  // d = 0.6 of a tag's width) to the first spot that is clear, a thin leader in his side's colour running back from
  // the tag to his head. A crowd with no clear spot folds the rest to a dot at their heads (they unfold when
  // hovered); the commander, the selected and the hovered general are never dots, they rise above the others
  // instead. Everything eases there so a passing unit does not make the tags jump.
  // A general's picture on screen as NDC bounds: the opaque box of his frame, `top` the share of its height to take (the flag poles are thin).
  function figureBox(v, top = 1) {
    v.body.updateWorldMatrix(true, false);
    const { w, h, ob } = v.quad, ye = ob.y0 + (ob.y1 - ob.y0) * top; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [fx, fy] of [[ob.x0, ob.y0], [ob.x1, ob.y0], [ob.x0, ye], [ob.x1, ye]]) {
      wv.cornerPt.set((fx - 0.5) * w, fy * h, 0).applyMatrix4(v.body.matrixWorld).project(camera);
      x0 = Math.min(x0, wv.cornerPt.x); x1 = Math.max(x1, wv.cornerPt.x); y0 = Math.min(y0, wv.cornerPt.y); y1 = Math.max(y1, wv.cornerPt.y);
    }
    return { x0, x1, y0, y1 };
  }
  wv.lastFigs = []; // the pictures on screen at the last declutter (read by probe)
  const cellAt = new THREE.Vector3(), tagAt = new THREE.Vector3(), headAt = new THREE.Vector3(), SHIFTS = [0, 1, -1, 2, -2];
  const isFull = (v) => v.el.classList.contains('full');
  function declutter(dt) {
    const host = [...views.values()].find((v) => v.el.parentElement)?.el.parentElement; if (!host) return;
    const W2 = host.clientWidth / 2, H2 = host.clientHeight / 2, k = 1 - Math.exp(-dt * 12), placed = [];
    const list = [];
    for (const [u, v] of views) {
      if (v.fading || !v.g.parent || !v.el.isConnected || !v.label.visible) continue;
      v.label.getWorldPosition(tagAt).project(camera);
      if (tagAt.z > 1) continue;
      headAt.copy(v.g.position); headAt.y += v.top - 0.1; headAt.project(camera);
      list.push({ v, x: (tagAt.x + 1) * W2, y: (1 - tagAt.y) * H2, hx: (headAt.x + 1) * W2, hy: (1 - headAt.y) * H2, w: v.el.offsetWidth + 4, h: v.el.offsetHeight + 3, h0: v.el.offsetHeight,
        keep: !!u.commander || u === wv.st.sel || isFull(v) });
    }
    list.sort((a, b) => b.y - a.y);
    // Every general's picture on screen (px): a tag may not hide one (more than a tenth of it), his own included.
    const figs = [];
    for (const [u, v] of views) {
      if (v.fading || !v.g.parent || !v.bill.visible) continue;
      const { x0, x1, y0, y1 } = figureBox(v);
      const tr = (x1 - x0) * 0.12; figs.push({ id: u.id, l: (x0 + tr + 1) * W2, r: (x1 - tr + 1) * W2, t: (1 - y1) * H2, b: (1 - y0) * H2 });
    }
    wv.lastFigs = figs;
    // The villages' signs. A sign's box is its anchor's projected point ± half its size (CSS2D centres it there), so nothing is read back from
    // the layout per frame: sizes are measured once (again after a resize), then positions are worked out and the styles written.
    // A sign over a cell on the screen never hangs off its edge (nudged in, by margins as the tags are); one hanging over a general's
    // picture thins to the share the village houses keep (0.45) so he reads through it.
    if (wv.vsignW !== host.clientWidth || wv.vsignK !== labelK()) { wv.vsignW = host.clientWidth; wv.vsignK = labelK(); for (const v of vsigns) v.w = 0; } // 系统 → 地图标签 resizes them too
    for (const v of vsigns) if (!v.w) { v.w = v.el.offsetWidth; v.h = v.el.offsetHeight; }
    for (const v of vsigns) {
      if (!v.w) continue;
      cellAt.copy(v.lab.position).project(camera); const ax = (cellAt.x + 1) * W2, ay = (1 - cellAt.y) * H2, behind = cellAt.z >= 1;
      cellAt.copy(v.cell).project(camera); const cx = (cellAt.x + 1) * W2, cy = (1 - cellAt.y) * H2;
      let mx = 0, my = 0;
      if (!behind && cellAt.z < 1 && cx > 0 && cx < W2 * 2 && cy > 0 && cy < H2 * 2) {
        mx = Math.max(2 - (ax - v.w / 2), Math.min(W2 * 2 - 2 - (ax + v.w / 2), 0)); my = Math.max(2 - (ay - v.h / 2), Math.min(H2 * 2 - 2 - (ay + v.h / 2), 0));
      }
      const l = ax - v.w / 2 + mx, t = ay - v.h / 2 + my, over = figs.some((f) => l < f.r && l + v.w > f.l && t < f.b && t + v.h > f.t);
      const ml = `${Math.round(mx)}px`, mt = `${Math.round(my)}px`, op = over ? String(LANDMARK_KEEP) : '';
      if (v.el.style.marginLeft !== ml) v.el.style.marginLeft = ml; if (v.el.style.marginTop !== mt) v.el.style.marginTop = mt; if (v.el.style.opacity !== op) v.el.style.opacity = op;
      placed.push({ x: l + v.w / 2, w: v.w + 4, top: t - 1, h: v.h + 2 });
    }
    const hides = (cx, top, t) => Math.max(0, ...figs.map((f) => {
      const ox = Math.min(cx + t.w / 2, f.r) - Math.max(cx - t.w / 2, f.l), oy = Math.min(top + t.h, f.b) - Math.max(top, f.t);
      return ox > 0 && oy > 0 ? (ox * oy) / ((f.r - f.l) * (f.b - f.t)) : 0;
    }));
    const free = (cx, top, t) => placed.every((p) => Math.abs(cx - p.x) >= (t.w + p.w) / 2 || top >= p.top + p.h || top + t.h <= p.top);
    for (const t of list) {
      const own = t.y - t.h / 2, keepOn = (cx) => Math.max(t.w / 2 + 2, Math.min(W2 * 2 - t.w / 2 - 2, cx)); // a tag stays on the screen
      // Spots within the leader's reach, nearest first: his own place, then aside, then a tag's height higher, twice. Clear of every other tag
      // and of the pictures. None: a dot; but the commander, the selected and the hovered take the spot that hides least, higher up if need be,
      // and go thin so the figure shows through.
      let spot = null, thin = false; t.v.thinBy = null;
      // His own place over the head, no leader, wins whenever it is clear; else the spot it had stays while that is still nearly clear
      // (or a figure breathing across the line would make the tag shuttle); else the first clear one.
      const had = t.v.pick, at = (lift, m) => ({ cx: keepOn(t.x + m * t.w * 0.6), top: own - lift * t.h, pick: [lift, m] });
      const okAt = (sp, lim) => free(sp.cx, sp.top, t) && hides(sp.cx, sp.top, t) <= lim;
      if (okAt(at(0, 0), 0.1)) spot = at(0, 0);
      else if (had && okAt(at(...had), 0.13)) spot = at(...had);
      if (!spot) outer: for (const lift of [0, 1, 2]) for (const m of SHIFTS) if (okAt(at(lift, m), 0.1)) { spot = at(lift, m); break outer; }
      if (!spot && t.keep) {
        // never over another tag: of the spots free of tags and signs (lifts 0..29), the one that hides least of any figure, ties to the nearest
        // (lowest lift, then smallest aside); none free at all, the one with the least tag under it
        let best = null, least = null;
        for (let lift = 0; lift < 30; lift++) for (const m of SHIFTS) {
          const sp = at(lift, m); if (sp.top < -t.h) continue;
          if (free(sp.cx, sp.top, t)) { const c = hides(sp.cx, sp.top, t); if (!best || c < best.c - 1e-6) best = { ...sp, c }; }
          else { const o = placed.reduce((n, p) => n + Math.max(0, Math.min(sp.cx + t.w / 2, p.x + p.w / 2) - Math.max(sp.cx - t.w / 2, p.x - p.w / 2)) * Math.max(0, Math.min(sp.top + t.h, p.top + p.h) - Math.max(sp.top, p.top)), 0); if (!least || o < least.o) least = { ...sp, o }; }
        }
        spot = best ?? least ?? at(0, 0); thin = (best?.c ?? 1) > 0.1; t.v.thinBy = thin ? 'exempt' : null;
      }
      const dot = !spot, ox = spot ? spot.cx - t.x : 0, top = spot ? spot.top : own; t.v.pick = spot?.pick ?? null;
      if (!dot) placed.push({ x: t.x + ox, w: t.w, top, h: t.h });
      const v = t.v;
      v.sx = (v.sx || 0) + (ox - (v.sx || 0)) * k;
      v.lift = (v.lift || 0) + (top - own - (v.lift || 0)) * k;
      v.el.classList.toggle('dot', dot); v.el.classList.toggle('thin', thin);
      v.el.style.marginLeft = `${Math.round(v.sx)}px`; v.el.style.marginTop = `${Math.round(v.lift)}px`; // CSS2D's centring translate ignores the margins
      // The leader: from the tag's bottom middle to his head, while the tag is off its own place.
      const ln = v.leader, bx = t.x + v.sx, by = t.y + v.lift + t.h0 / 2, dx = t.hx - bx, dy = t.hy - by, len = Math.hypot(dx, dy);
      if (ln) {
        const on = !dot && Math.hypot(v.sx, v.lift) > 6 && len > 4;
        if (on !== v.leaderOn) { v.leaderOn = on; ln.style.display = on ? 'block' : 'none'; }
        if (on) { ln.style.height = `${len.toFixed(1)}px`; ln.style.transform = `rotate(${Math.atan2(-dx, dy).toFixed(4)}rad)`; }
      }
    }
  }
  // Takes a general's figure off the board and frees what was made for him alone (addUnit, tag, roundelOf): off the scene,
  // dispose()'s walk no longer reaches him. What the generals share stays: the base and disc, the sheets his strip was cloned from.
  const SHARED = new Set([BASE_GEO, DISC_GEO]);
  const drop = (g) => {
    g.parent?.remove(g);
    g.traverse((o) => {
      if (o.isCSS2DObject) o.element.remove();
      if (!o.isMesh || SHARED.has(o.geometry)) return;
      if (o.geometry !== roundelGeo) o.geometry.dispose();
      const m = o.material; if (o.userData.roundel) m.map.dispose();
      m.dispose();
    });
    for (const v of views.values()) if (v.g === g && v.frames) { v.tex.dispose(); v.ntex?.dispose(); } // his own clones of the march strip and its normals
  };
  // Fallen, captured or withdrawn units sink and fade out instead of vanishing on the spot.
  function removeGone() {
    let kongLeft = false;
    for (const [u, v] of views) if (u.gone && v.g.parent && !v.fading) {
      if (u.id === 109) kongLeft = true;
      v.fading = true; if (v.rnd) v.rnd.visible = false; v.ring.forEach((m) => { m.visible = false; }); v.caster.visible = false; v.xray.visible = false; v.g.traverse((o) => o.isCSS2DObject && o.element.remove());
      v.body.material.transparent = true; v.body.material.alphaTest = 0.05;
      const y0 = v.g.position.y;
      tween(420, (k) => { v.body.material.opacity = 1 - k; v.shadow.material.opacity = 0.35 * (1 - k); v.g.position.y = y0 - k * k * 0.35; }).then(() => drop(v.g));
    }
    if (kongLeft) for (const [u, v] of views) if (u.qimen > 0 && !u.gone && v.g.parent) tag(u); // the trapped ones' tags now say 孔明不在
  }
  // The tactical overview swaps each figure for a roundel: his side's colour, the first glyph of his name, flat on his cell
  // (a commander's rim is gold). Built on first use.
  const ROUNDEL = 0.8, ROUNDEL_Y = 0.05, roundelGeo = new THREE.PlaneGeometry(ROUNDEL, ROUNDEL);
  function roundelOf(u, v) {
    if (v.rnd) return v.rnd;
    const c = document.createElement('canvas'); c.width = c.height = 192;
    const g = c.getContext('2d'), side = look(u.side) === 'attacker' ? '#2f5cc4' : '#b8322c', hi = look(u.side) === 'attacker' ? '#5f8ff0' : '#e0605a';
    g.beginPath(); g.arc(96, 96, 90, 0, Math.PI * 2); g.fillStyle = u.commander ? '#f2c14e' : '#f4efe2'; g.fill(); // rim
    const body = g.createRadialGradient(80, 70, 8, 96, 96, 80); body.addColorStop(0, hi); body.addColorStop(1, side);
    g.beginPath(); g.arc(96, 96, 78, 0, Math.PI * 2); g.fillStyle = body; g.fill();
    g.font = '700 104px "PingFang SC", "Songti SC", "Noto Serif CJK SC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const glyph = [...name(u.id)][0] ?? '?';
    g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = 'rgba(10,12,24,0.85)'; g.strokeText(glyph, 96, 102); g.fillStyle = '#fff'; g.fillText(glyph, 96, 102);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(roundelGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI / 2; m.position.y = ROUNDEL_Y; m.renderOrder = 3; m.raycast = () => {}; m.visible = false;
    m.userData.roundel = true; v.g.add(m); return (v.rnd = m);
  }
  // Figures (sprite, shadow, tag) give way to the roundels while the overview looks straight down.
  function roundelShow(u, v, on) {
    if (v.fading) return;
    const r = on ? roundelOf(u, v) : v.rnd;
    v.bill.visible = v.caster.visible = v.shadow.visible = !on; v.label.visible = !on && !wv.terrainOn;
    if (r) r.visible = on;
  }
  const showRoundels = (on) => { wv.tacticalOn = on; for (const [u, v] of views) roundelShow(u, v, on); };
  // dispose()'s first step (the entry's, before the board's walk of the scene): the rings' fill map, and each roundel's own map and material.
  function disposeUnits() {
    FILL.dispose();
    for (const v of views.values()) if (v.rnd) { v.rnd.material.map.dispose(); v.rnd.material.dispose(); v.g.remove(v.rnd); v.rnd = null; }
    roundelGeo.dispose(); // off their figures, the walk of the scene no longer finds what the roundels share
  }
  // The generals come on last, when everything addUnit and tag read is made: a war taken up again (战场中断) may hold one in
  // 奇门遁甲, whose tag reads qimenNote and QIMEN_RING at once (run above them, this loop threw and the war never came back).
  // Only those still on the field: a resumed war keeps in field.units the generals who fell, were taken
  // or withdrew, for the settlement and the ambush's index, and they have no figure or name tag (D39, 2026-11-10).
  { const t = performance.now(); for (const u of field.units) if (!u.gone) addUnit(u); performance.measure('war:units', { start: t }); }
  return { views, look, addUnit, place, faceFoes, tag, qimenNote, holdNote, figureBox, declutter, drop, removeGone, roundelOf, roundelShow, showRoundels, FIGURE, BASE_GEO, FILL, disposeUnits };
}
