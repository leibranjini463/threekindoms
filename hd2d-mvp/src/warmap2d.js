// The war map as a flat painted map (the 2026-10-29 direction: A2 read the way Fire Emblem draws its maps).
// The board is one painted picture that never moves: ground, river, rock mesas, woods, the castle and the
// villages are composed once per battle from the painted materials (src/warplate.js) onto a canvas, cells
// square and every cell whole on screen; the generals ride their war-map march strips on top, drawn last, so
// nothing on the map ever hides them. The rules, the AI and the HUD stay the war view's (src/warview.js):
// this layer draws its state each frame and turns a pointer into a cell for it.
// The HUD sits in a strip above and a strip below the map (body.flat2d in ui.css), never over it.
import { painter, MR } from './warplate.js';
import { W, H, FOREST, RIVER, MOUNT, CASTLE } from './core/field.js';
import { name, data } from './core/game.js';
import { createSky2d } from './skyfx2d.js';
import { rng } from './pixel.js';
import { PHONE, TOUCH, FLAT_DPR, margins } from './phone.js';
import { labelK } from './labelsize.js';

const KIND = ['forest', 'sand', 'grass', 'river', 'hill', 'castle'];
// px kept for the HUD strips (ui.css body.flat2d). Under 1200 px the foe's card stacks as a strip above ours (ui.css .unitpanel.compare), so the bottom strip is that much taller.
// A phone has no strips (src/phone.css): the board takes the whole height and the HUD floats in the corners over it; the
// player drags and pinches the board to bring a cell out from under a corner.
export const FLAT_INSET = PHONE ? { top: 4, get bottom() { return Math.max(4, margins().b - 4); }, get side() { return Math.min(margins().l, margins().r); } }
  : { top: 46, get bottom() { return innerWidth <= 1200 ? 196 : 128; }, side: 12 };

// --- The painted map ---
export function paintFlatMap(G, field, { px = 80 } = {}) {
  const map = field.map, clampX = (x) => Math.max(0, Math.min(W - 1, x)), clampY = (y) => Math.max(0, Math.min(H - 1, y));
  const terr = (x, y) => map[clampY(y)][clampX(x)]; // beyond the edge the edge terrain carries on (no seam of grass)
  const kind = (x, y) => KIND[terr(x, y)];
  const towns = [...map.flatMap((row, y) => row.flatMap((t, x) => (t === CASTLE ? [[x, y, 1]] : []))), ...field.villages.map((v) => [v.x, v.y, 0.7])];
  const near = (x, y) => Math.max(0, ...towns.map(([tx, ty, k]) => k * Math.max(0, 1 - Math.hypot(x - tx, y - ty) / 2.4)));
  const seed = field.war.city * 7 + 3;
  const P = painter(G, { x0: 0, y0: 0, w: W, h: H, px, kind, near, seed });
  const { g } = P;
  P.ground({ water: true });

  // A mask (MR texels a cell) moved by (dx, dy) cells and cut out of itself: the band along one side of a shape.
  const band = (m, dx, dy) => {
    const c = Object.assign(document.createElement('canvas'), { width: m.width, height: m.height }), x = c.getContext('2d');
    x.drawImage(m, 0, 0); x.globalCompositeOperation = 'destination-out'; x.drawImage(m, dx * MR, dy * MR); return c;
  };
  const shifted = (m, dx, dy, blur = 0) => {
    const c = Object.assign(document.createElement('canvas'), { width: m.width, height: m.height }), x = c.getContext('2d');
    x.filter = blur ? `blur(${blur}px)` : 'none'; x.drawImage(m, dx * MR, dy * MR); x.filter = 'none';
    x.globalCompositeOperation = 'destination-out'; x.drawImage(m, 0, 0); return c;
  };

  // The river sits a little below the land: along its far (upper) bank a strip of earth face shows, and a pale
  // line of wash runs along every shore.
  const water = P.mask((x, y) => (kind(x, y) === 'river' ? 1 : 0), { cut: 0.52, edge: 0.3 });
  if (water) {
    P.layMask('rgba(0, 18, 30, 0.38)', band(water, 0, 0.26));
    P.layMask((t) => { t.fillStyle = P.pattern('bank', 3, t); t.fillRect(0, 0, P.W, P.H); t.fillStyle = 'rgba(40, 28, 16, 0.45)'; t.fillRect(0, 0, P.W, P.H); }, band(water, 0, 0.11));
    P.layMask('rgba(220, 236, 230, 0.3)', band(water, 0, -0.05));
  }
  P.grid((x, y) => x >= 0 && y >= 0 && x < W && y < H && terr(x, y) !== RIVER, { dark: 0.3, lit: 0.08 });

  // Rock mesas: every range stands up as one, and its heart (two cells in) as a second tier; each tier's lower
  // edge is a cliff face painted column by column from the cliff band (its grassy lip on top), with a shadow
  // cast down and to the right onto the ground below.
  const hillD = new Map(), open = [];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map[y][x] === MOUNT && DIRS.some(([dx, dy]) => map[y + dy]?.[x + dx] != null && map[y + dy][x + dx] !== MOUNT)) { hillD.set(`${x},${y}`, 1); open.push([x, y]); }
  for (let i = 0; i < open.length; i++) {
    const [x, y] = open[i], d = hillD.get(`${x},${y}`);
    for (const [dx, dy] of DIRS) { const k = `${x + dx},${y + dy}`; if (map[y + dy]?.[x + dx] === MOUNT && !hillD.has(k)) { hillD.set(k, d + 1); open.push([x + dx, y + dy]); } }
  }
  const cliff = G.img.cliff;
  const tier = (minD, face) => {
    const m = P.mask((x, y) => (terr(x, y) === MOUNT && (hillD.get(`${clampX(x)},${clampY(y)}`) ?? 9) >= minD ? 1 : 0), { cut: minD > 1 ? 0.55 : 0.45, edge: 0.25 });
    if (!m) return;
    // The top of a tier catches more light than the ground round it.
    if (minD > 1) P.layMask('rgba(255, 240, 200, 0.06)', m); else P.layMask('rgba(255, 236, 190, 0.08)', m);
    P.layMask('rgba(10, 12, 4, 0.5)', shifted(m, 0.16, face * 0.5, 3), { filter: 'blur(2px)' });
    // The face: the bottom `face` of the shape, found column by column at full size.
    const f = band(m, 0, -face), fc = Object.assign(document.createElement('canvas'), { width: P.W, height: P.H }), fx = fc.getContext('2d', { willReadFrequently: true });
    fx.imageSmoothingEnabled = true; fx.drawImage(f, 0, 0, P.W, P.H);
    const a = fx.getImageData(0, 0, P.W, P.H).data, cw = cliff.width, ch = cliff.height, k = (ch / (face * px)) * 0.9;
    g.imageSmoothingEnabled = true;
    for (let x = 0; x < P.W; x++) {
      let y = 0;
      while (y < P.H) {
        while (y < P.H && a[(y * P.W + x) * 4 + 3] < 128) y++;
        const y0 = y;
        while (y < P.H && a[(y * P.W + x) * 4 + 3] >= 128) y++;
        if (y > y0) g.drawImage(cliff, Math.floor((x * k) % cw), 0, 1, ch, x, y0, 1, y - y0);
      }
    }
    // A lit lip along the top edge and a darker one along the right-hand side (the light is from the upper left).
    P.layMask('rgba(255, 236, 180, 0.28)', band(m, 0, 0.05));
    P.layMask('rgba(0, 0, 0, 0.22)', band(m, -0.06, 0));
  };
  tier(1, 0.56); tier(3, 0.36);

  // Woods and lone trees: shadows first, then the crowns from the top of the map down, so nearer crowns overlap.
  const r = rng(field.war.city * 53 + 1), j = (k) => (r() - 0.5) * k, trees = [];
  const castle = towns.find((t) => t[2] === 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (map[y][x] === FOREST) {
      const ahead = castle && Math.abs(x - castle[0]) <= 1 && y > castle[1] && y <= castle[1] + 1;
      if (ahead) { trees.push({ x: x + 0.5 + j(0.2), y: y + 0.8, size: 0.75 }); continue; }
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) trees.push({ x: x + 0.5 + a * 0.24 + j(0.14), y: y + 0.55 + b * 0.24 + j(0.12), size: 0.95 + r() * 0.3, pine: r() < 0.12 });
    } else if (map[y][x] === 2 && near(x, y) === 0 && r() < 0.025) trees.push({ x: x + 0.5 + j(0.4), y: y + 0.8, size: 0.75 + r() * 0.2 });
  }
  trees.sort((a, b) => a.y - b.y);
  const { rects } = G.sheet, broad = rects.filter((q) => q[4] === 'broad'), pines = rects.filter((q) => q[4] === 'pine'), bloom = rects.filter((q) => q[4] === 'bloom');
  const ref = Math.max(...broad.concat(bloom).map((q) => q[2]));
  for (const t of trees) {
    const set = t.pine ? pines : bloom.length && r() < 0.08 ? bloom : broad;
    t.rect = set[Math.floor(r() * set.length)]; t.flip = r() < 0.5;
  }
  g.fillStyle = 'rgba(8, 14, 4, 0.34)';
  for (const t of trees) { g.beginPath(); g.ellipse((t.x + 0.12) * px, (t.y - 0.02) * px, t.size * 0.48 * px, t.size * 0.26 * px, 0, 0, Math.PI * 2); g.fill(); }
  for (const t of trees) {
    const [sx, sy, sw, sh] = t.rect, w = (t.size * sw / ref) * px, h = w * sh / sw;
    g.save(); g.translate(t.x * px, t.y * px); if (t.flip) g.scale(-1, 1);
    g.drawImage(G.atlas, sx, sy, sw, sh, -w / 2, -h, w, h); g.restore();
  }

  // The castle on its cell (it spills onto the cells round it: the units are drawn over it), the villages.
  const prop = (img, cx, cy, wide, footDown) => {
    const w = wide * px, h = w * img.height / img.width;
    g.fillStyle = 'rgba(10, 10, 4, 0.35)'; g.beginPath(); g.ellipse((cx + 0.1) * px, (cy + footDown - 0.08) * px, w * 0.48, w * 0.16, 0, 0, Math.PI * 2); g.fill();
    g.drawImage(img, cx * px - w / 2, (cy + footDown) * px - h, w, h);
  };
  if (castle) prop(G.img.castle, castle[0] + 0.5, castle[1] + 0.5, 2.8, 0.8);
  for (const v of field.villages) prop(G.img.village, v.x + 0.5, v.y + 0.5, 1.45, 0.4);
  return P.canvas;
}

// --- The live layer ---
// [fill, edge, hairline]. The reach is a region with one contour (2026-11-13), so its fill is faint: the painted ground reads
// through, and the contour, three pixels over a dark line, keeps it from melting into grass and sand (feedback, 2026-11-08).
// Deployment is mint, clear of the grass's yellow green, as on the 3D board; a target's wash stays strong, under his figure.
const MARK = { move: ['rgba(255, 184, 31, 0.13)', 'rgba(255, 196, 60, 1)', 'rgba(255, 228, 150, 0.3)'], self: ['rgba(255, 184, 31, 0.13)', 'rgba(255, 196, 60, 1)', 'rgba(255, 228, 150, 0.3)'],
  castle: ['rgba(255, 128, 48, 0.32)', 'rgba(255, 150, 70, 1)'],
  attack: ['rgba(255, 70, 50, 0.36)', 'rgba(255, 110, 90, 1)'], strat: ['rgba(190, 130, 255, 0.38)', 'rgba(214, 170, 255, 1)'],
  deploy: ['rgba(77, 255, 184, 0.14)', 'rgba(120, 255, 205, 1)', 'rgba(170, 255, 220, 0.3)'], path: ['rgba(255, 220, 120, 0.34)', 'rgba(255, 242, 200, 1)'] };
const SIDE = { attacker: ['#2f5cc4', '#9cc2ff'], defender: ['#b8322c', '#ffb0a0'] };
// The ground view's plaques by terrain (FOREST…CASTLE, then a village): the manual's name, an edge in its colour.
const GROUND = [['林', '#5fae4a'], ['沙', '#d8b46a'], ['平', '#b8d878'], ['河', '#5aa8e8'], ['山', '#b08860'], ['城', '#b8b0c0'], ['村', '#e8a040']];

// war: the war view's API (src/warview.js); G: its painted materials. Returns the same API with the drawing,
// the camera and the pointer replaced; the 3D scene is not drawn at all.
export function flatten(war, G, blankScene) {
  const field = war.field;
  // A painted battlefield (tools/gen_warmap_codex.sh) when there is one for this field and month: one picture with
  // its countryside round the board, cells a little shorter than wide (seen from about 50°). Otherwise the
  // composed map, square cells, nothing round it.
  const mapImg = G.painted ? null : paintFlatMap(G, field);
  const pic = G.painted ? { img: G.painted.img, board: G.painted.board, country: true }
    : { img: mapImg, board: { x: 0, y: 0, w: mapImg.width, h: mapImg.height }, country: false };
  // The last battle's layer stays up through its settlement (the final board under the dialogs; app.js setMode
  // hides it once the screen leaves the war) and goes when the next battle's comes.
  for (const old of document.querySelectorAll('.flatwar')) old.dispose?.();
  const wrap = Object.assign(document.createElement('div'), { className: 'flatwar' }), cv = document.createElement('canvas');
  wrap.append(cv); document.body.append(wrap); document.body.classList.add('flat2d');
  const g = cv.getContext('2d');
  const view = { z: 1, x: 0, y: 0 };
  let box = null, time = 0, tv = 0, leftClear = 0; // tv: how far the ground view (F04) is shown; leftClear: px kept on the left for the desktop war roster
  const sky = createSky2d(); let skyT;
  const thin = new Map(); // each general's eased opacity while he covers the hovered cell
  const shift = new Map(); // each general's plaque, eased off its own place out of a neighbour's way (draw)
  let plateRects = []; // the plaques as last drawn, for the tests: { id, x, y, w, h, up }
  function layout() {
    const dpr = Math.min(FLAT_DPR, devicePixelRatio || 1), vw = innerWidth, vh = innerHeight;
    cv.width = vw * dpr; cv.height = vh * dpr; cv.style.width = `${vw}px`; cv.style.height = `${vh}px`;
    place();
  }
  // Where the board sits. Apart from layout() (the window's size), the phone's drag and pinch call it on every move of a
  // finger: it must not touch the canvas's size, which would allocate a new backing store each time (iOS Safari caps the
  // memory all canvases may hold and frees it late).
  function place() {
    const dpr = Math.min(FLAT_DPR, devicePixelRatio || 1), vw = innerWidth, vh = innerHeight;
    // The board as large as the band between the HUD strips allows; the countryside runs on under the strips.
    // Desktop: leftClear only shifts the board right into unused right margin and never shrinks k0.
    const B = pic.board, band = vh - FLAT_INSET.top - FLAT_INSET.bottom;
    const k0 = Math.min((vw - FLAT_INSET.side * 2) / B.w, band / B.h), k = k0 * view.z;
    // The phone's drag and pinch (view): the board may slide until its far edge is a third of the screen in from the side,
    // so every cell can be brought clear of the HUD in the corners.
    const mx = Math.max(0, (B.w * k - vw) / 2) + vw * 0.3, my = Math.max(0, (B.h * k - vh) / 2) + vh * 0.32;
    view.x = Math.max(-mx, Math.min(mx, view.x)); view.y = Math.max(-my, Math.min(my, view.y));
    const baseX = (vw - B.w * k) / 2;
    const shiftX = !PHONE && leftClear > 0 ? Math.min(Math.max(0, leftClear - baseX), Math.max(0, vw - FLAT_INSET.side - (baseX + B.w * k))) : 0;
    box = { k, cw: (B.w * k) / W, ch: (B.h * k) / H, x: baseX + shiftX + view.x, y: FLAT_INSET.top + (band - B.h * k) / 2 + view.y, dpr };
  }
  // A touch device (phone or tablet) only: one finger slides the board, two fingers zoom it about the point between them (app.js).
  const slide = (dx, dy) => { goal = null; view.x += dx; view.y += dy; place(); };
  const zoomAt = (deltaY, ndc) => {
    const z = Math.max(1, Math.min(2.4, view.z * Math.exp(-deltaY * 0.001))); if (z === view.z) return;
    const px = (ndc.x + 1) / 2 * innerWidth, py = (1 - ndc.y) / 2 * innerHeight, fx = (px - box.x) / (box.cw * W), fy = (py - box.y) / (box.ch * H);
    view.z = z; place();
    view.x += px - (box.x + fx * box.cw * W); view.y += py - (box.y + fy * box.ch * H); place();
  };
  // Bring a cell to where the HUD leaves the board clear (the middle of the screen, a little above centre).
  const centreOn = (x, y) => { view.x += innerWidth / 2 - (box.x + (x + 0.5) * box.cw); view.y += innerHeight * 0.45 - (box.y + (y + 0.5) * box.ch); place(); };
  // A touch device's camera follows the play (a mouse sees the whole board at once; a zoomed or slid board does not): the
  // general just selected, the enemy asked about, a unit that has just moved in the enemy's turn. A cell already in the clear
  // middle of the screen moves nothing; otherwise the board eases until it stands there. A drag of the player's ends the ease.
  let goal = null, lastSel = null, lastAsk = null, opened = false; const stood = new Map();
  // A tablet keeps the desktop HUD in strips above and below the board, so a cell anywhere between them is in the clear: the
  // board the battle opens on, whole, moves for nothing; one zoomed or slid moves only for a cell gone under a strip or off the side.
  const clear = (px, py, vw, vh) => (PHONE ? px > vw * 0.24 && px < vw * 0.76 && py > 52 && py < vh - 112
    : px > FLAT_INSET.side + box.cw * 0.5 && px < vw - FLAT_INSET.side - box.cw * 0.5 && py > FLAT_INSET.top + box.ch * 0.5 && py < vh - FLAT_INSET.bottom - box.ch * 0.5);
  const ensure = (x, y) => {
    const px = box.x + (x + 0.5) * box.cw, py = box.y + (y + 0.5) * box.ch, vw = innerWidth, vh = innerHeight;
    if (clear(px, py, vw, vh)) return;
    goal = { x: view.x + vw / 2 - px, y: view.y + vh * 0.45 - py };
  };
  function follow(dt) {
    const st = war.st, f = field, mine = f.units.filter((u) => u.side === f.human && !u.gone);
    if (PHONE && !opened && mine.length) { opened = true; const cx = mine.reduce((a, u) => a + u.x, 0) / mine.length, cy = mine.reduce((a, u) => a + u.y, 0) / mine.length; centreOn(cx - 0.5, cy - 0.5); }
    if (st.sel !== lastSel) { lastSel = st.sel; if (st.sel && !st.sel.gone) ensure(st.sel.x, st.sel.y); }
    const ask = st.confirm?.t ?? st.strike?.t ?? st.ask ?? null;
    if (ask !== lastAsk) { lastAsk = ask; if (ask && !ask.gone) ensure(ask.x, ask.y); }
    for (const u of f.units) { const k = `${u.x},${u.y}`, was = stood.get(u); stood.set(u, k); if (was && was !== k && !u.gone && (f.turn !== f.human || u.side !== f.human)) ensure(u.x, u.y); }
    if (goal) { const k = 1 - Math.exp(-dt * 7); view.x += (goal.x - view.x) * k; view.y += (goal.y - view.y) * k; if (Math.abs(goal.x - view.x) + Math.abs(goal.y - view.y) < 1) goal = null; place(); }
  }
  layout(); addEventListener('resize', layout);
  wrap.dispose = () => { removeEventListener('resize', layout); wrap.remove(); };
  const cellAt = (ndc) => {
    const px = (ndc.x + 1) / 2 * innerWidth, py = (1 - ndc.y) / 2 * innerHeight;
    const x = Math.floor((px - box.x) / box.cw), y = Math.floor((py - box.y) / box.ch);
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  };

  // The board under everything that moves (PERF-04, 2026-11-07): the dark frame, the map scaled to the window, the
  // composed map's drop shadow (a 24 px blur over the whole picture) and gilt edge, the painting's faint grid. None of
  // it changes from frame to frame, so it is painted once onto a canvas of the screen's size and copied pixel for pixel
  // each frame; it is painted again only when what it is drawn from changes: the canvas size (window, DPR, the HUD
  // strips' height, all through layout()), where the board sits (box) and the picture itself. The month, the weather
  // and the ground view (T) are drawn over it each frame and do not touch it.
  const base = document.createElement('canvas'), bg = base.getContext('2d');
  let baseKey = '', basePaints = 0, frames = 0;
  base.addEventListener('contextrestored', () => { baseKey = ''; }); // a 2D context the browser dropped comes back blank
  function paintBase() {
    const { cw: c, ch, x: ox, y: oy, dpr, k } = box, B = pic.board;
    const key = [cv.width, cv.height, innerWidth, innerHeight, dpr, k, c, ch, ox, oy].join();
    if (key === baseKey && base.width === cv.width && base.height === cv.height) return;
    baseKey = key; basePaints++;
    base.width = cv.width; base.height = cv.height; // also clears it and resets its state
    const g = bg;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    // A dark frame round the map, the map itself and a thin gilt edge.
    g.fillStyle = '#16120c'; g.fillRect(0, 0, innerWidth, innerHeight);
    if (pic.country) g.drawImage(pic.img, ox - B.x * k, oy - B.y * k, pic.img.width * k, pic.img.height * k);
    else {
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 24; g.drawImage(pic.img, ox, oy, c * W, ch * H); g.shadowBlur = 0;
      g.strokeStyle = 'rgba(214, 178, 108, 0.55)'; g.lineWidth = 1; g.strokeRect(ox - 0.5, oy - 0.5, c * W + 1, ch * H + 1);
    }
    // The painting has no grid: a faint one over the playable cells, so a move can be counted.
    if (pic.country) {
      g.strokeStyle = 'rgba(20, 24, 10, 0.22)'; g.lineWidth = 1; g.beginPath();
      for (let x = 0; x <= W; x++) { g.moveTo(Math.round(ox + x * c) + 0.5, oy); g.lineTo(Math.round(ox + x * c) + 0.5, oy + ch * H); }
      for (let y = 0; y <= H; y++) { g.moveTo(ox, Math.round(oy + y * ch) + 0.5); g.lineTo(ox + c * W, Math.round(oy + y * ch) + 0.5); }
      g.stroke();
    }
  }

  function draw() {
    const { cw: c, ch, x: ox, y: oy, dpr } = box, s = war.flatState(), LK = labelK(); // 系统 → 地图标签: the plaques' type
    paintBase(); frames++;
    // The board, copied 1:1 in device pixels (it is opaque and covers the canvas, so nothing needs clearing first).
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.drawImage(base, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    // The range, as the 3D board draws it (src/war/overlay.js, 2026-11-13): the reach is one region, a faint fill the painted ground
    // reads through, hairlines between its cells and a bright contour round the outside only; a target is corner brackets over a
    // wash of its colour; the route is an arrow, with what it costs over where it ends.
    const pulse = 0.85 + 0.15 * Math.sin(time * 2.6), INK = 'rgba(22, 12, 2, 0.85)';
    const range = s.marks.filter((m) => m.kind !== 'path'), kindAt = new Map(range.map((m) => [`${m.x},${m.y}`, m.kind]));
    const inR = (x, y) => { const k = kindAt.get(`${x},${y}`); return k === 'move' || k === 'castle' || k === 'deploy' || k === 'self'; };
    if (s.sel && range.some((m) => m.kind === 'move' || m.kind === 'castle') && !kindAt.has(`${s.sel.x},${s.sel.y}`)) kindAt.set(`${s.sel.x},${s.sel.y}`, 'self'); // he stands inside his own reach
    const way = s.marks.filter((m) => m.kind === 'path'), dest = way.at(-1);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // The enemy's threat, under the range: a faint red wash, hatched, and a thin red line round the cells he could strike.
    if (s.threat?.length) {
      const T = new Set(s.threat.map((m) => `${m.x},${m.y}`)), inT = (x, y) => T.has(`${x},${y}`), i = 3;
      for (const m of s.threat) { const X = ox + m.x * c, Y = oy + m.y * ch; g.fillStyle = 'rgba(255, 74, 54, 0.12)'; g.fillRect(X, Y, c, ch); }
      for (const [col, lw] of [[INK, 4], ['rgba(255, 96, 76, 0.95)', 2]]) {
        g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
        for (const m of s.threat) {
          const X = ox + m.x * c, Y = oy + m.y * ch, w = inT(m.x - 1, m.y), e = inT(m.x + 1, m.y), n = inT(m.x, m.y - 1), so = inT(m.x, m.y + 1), x0 = X + (w ? 0 : i), x1 = X + c - (e ? 0 : i), y0 = Y + (n ? 0 : i), y1 = Y + ch - (so ? 0 : i);
          if (!w) { g.moveTo(x0, y0); g.lineTo(x0, y1); } if (!e) { g.moveTo(x1, y0); g.lineTo(x1, y1); }
          if (!n) { g.moveTo(x0, y0); g.lineTo(x1, y0); } if (!so) { g.moveTo(x0, y1); g.lineTo(x1, y1); }
        }
        g.stroke();
      }
    }
    for (const [key, kind] of kindAt) {
      const [x, y] = key.split(',').map(Number), X = ox + x * c, Y = oy + y * ch, [fill, edge] = MARK[kind] ?? MARK.move;
      if (kind === 'attack' || kind === 'strat') {
        g.globalAlpha = pulse; g.fillStyle = fill; g.fillRect(X, Y, c, ch); g.globalAlpha = 1;
        const q = Math.min(c, ch) * 0.3, i = 3;
        for (const [col, lw] of [[INK, 5], [edge, 2.6]]) {
          g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
          for (const [ax, ay, sx, sy] of [[X + i, Y + i, 1, 1], [X + c - i, Y + i, -1, 1], [X + i, Y + ch - i, 1, -1], [X + c - i, Y + ch - i, -1, -1]]) { g.moveTo(ax + sx * q, ay); g.lineTo(ax, ay); g.lineTo(ax, ay + sy * q); }
          g.stroke();
        }
        continue;
      }
      g.fillStyle = dest && dest.x === x && dest.y === y ? MARK.path[0] : fill; g.fillRect(X, Y, c, ch);
      g.strokeStyle = 'rgba(22, 12, 2, 0.28)'; g.lineWidth = 1; g.strokeRect(X + 1.5, Y + 1.5, c - 3, ch - 3); // the lines between cells: a dark and a light hairline
      g.strokeStyle = MARK[kind === 'deploy' ? 'deploy' : 'move'][2]; g.strokeRect(X + 0.5, Y + 0.5, c - 1, ch - 1);
      if (kind === 'castle') { g.strokeStyle = INK; g.lineWidth = 4; g.strokeRect(X + 5, Y + 5, c - 10, ch - 10); g.strokeStyle = edge; g.lineWidth = 2; g.strokeRect(X + 5, Y + 5, c - 10, ch - 10); }
    }
    // The contour: each side of a region cell whose neighbour is not of the region, a dark line under a bright one.
    for (const [col, lw] of [[INK, 5.2], [null, 2.8]]) {
      for (const deploy of [false, true]) {
        g.strokeStyle = col ?? MARK[deploy ? 'deploy' : 'move'][1]; g.lineWidth = lw; g.globalAlpha = col ? 1 : pulse; g.beginPath();
        for (const [key, kind] of kindAt) {
          if ((kind === 'deploy') !== deploy || kind === 'attack' || kind === 'strat') continue;
          const [x, y] = key.split(',').map(Number), X = ox + x * c, Y = oy + y * ch;
          if (!inR(x - 1, y)) { g.moveTo(X, Y); g.lineTo(X, Y + ch); } if (!inR(x + 1, y)) { g.moveTo(X + c, Y); g.lineTo(X + c, Y + ch); }
          if (!inR(x, y - 1)) { g.moveTo(X, Y); g.lineTo(X + c, Y); } if (!inR(x, y + 1)) { g.moveTo(X, Y + ch); g.lineTo(X + c, Y + ch); }
        }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    if (way.length && s.routeFrom) {
      const pts = [s.routeFrom, ...way].map((m) => [ox + (m.x + 0.5) * c, oy + (m.y + 0.5) * ch]), [ex, ey] = pts.at(-1), [px, py] = pts.at(-2), L = Math.hypot(ex - px, ey - py) || 1, ux = (ex - px) / L, uy = (ey - py) / L;
      const hd = Math.min(c, ch) * 0.42; pts[pts.length - 1] = [ex - ux * hd * 0.6, ey - uy * hd * 0.6];
      for (const [col, lw, k] of [['rgba(26, 16, 4, 0.9)', Math.max(5, c * 0.18), 1.25], [MARK.path[1], Math.max(2.5, c * 0.09), 1]]) {
        g.strokeStyle = g.fillStyle = col; g.lineWidth = lw; g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke();
        const [bx, by] = pts.at(-1), w = hd * 0.5 * k; g.beginPath(); g.moveTo(bx + ux * hd * k, by + uy * hd * k); g.lineTo(bx - uy * w, by + ux * w); g.lineTo(bx + uy * w, by - ux * w); g.closePath(); g.fill();
      }
      const cost = dest && war.st.reach?.dist.get(`${dest.x},${dest.y}`);
      if (cost != null && s.hover && s.hover.x === dest.x && s.hover.y === dest.y) {
        const fsC = Math.round(Math.max(12, ch * 0.4) * LK), t = `−${cost}`; g.font = `bold ${fsC}px "Noto Serif SC", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const tw = g.measureText(t).width + 12, X = Math.round(ex - tw / 2) + 0.5, Y = Math.round(ey - ch * 0.5 - fsC - 6) + 0.5;
        g.fillStyle = 'rgba(24, 16, 8, 0.88)'; g.fillRect(X, Y, tw, fsC + 4); g.strokeStyle = '#c8a45a'; g.lineWidth = 1; g.strokeRect(X, Y, tw, fsC + 4);
        g.fillStyle = '#ffd75a'; g.fillText(t, X + tw / 2, Y + fsC / 2 + 2); g.textAlign = 'start';
      }
    }
    if (s.hover) {
      const X = ox + s.hover.x * c, Y = oy + s.hover.y * ch, q = ch * 0.3;
      g.strokeStyle = '#fff6d8'; g.lineWidth = 2;
      for (const [ax, ay, sx, sy] of [[X, Y, 1, 1], [X + c, Y, -1, 1], [X, Y + ch, 1, -1], [X + c, Y + ch, -1, -1]]) { g.beginPath(); g.moveTo(ax + sx * q, ay); g.lineTo(ax, ay); g.lineTo(ax, ay + sy * q); g.stroke(); }
    }
    // The villages' shop signs (米 rice, 武 arms, 医 healer), as the 3D view's tags: a small lacquered plaque at the
    // cell's upper left corner, under the generals.
    const fsV = Math.round(Math.max(10, ch * 0.36) * LK); g.font = `${fsV}px "Noto Serif SC", serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
    for (const v of s.villages) {
      const X = ox + v.x * c + 2, Y = oy + v.y * ch + 2, w = fsV + 6, hh = fsV + 4;
      g.fillStyle = 'rgba(12, 9, 5, 0.72)'; g.fillRect(X, Y, w, hh);
      g.strokeStyle = 'rgba(214, 178, 108, 0.85)'; g.lineWidth = 1; g.strokeRect(X + 0.5, Y + 0.5, w - 1, hh - 1);
      g.fillStyle = '#f4e8cc'; g.fillText(v.icon, X + w / 2, Y + hh / 2 + 1);
    }
    g.textAlign = 'start';
    // The generals, from the top of the map down: base, figure, then the name chip inside his own cell.
    const units = s.units.filter((v) => v.visible).sort((a, b) => a.y - b.y);
    // A 计略 or attack target's cell lies under his figure and disc (playtest of 2026-10-31, F08: the purple cells
    // could not be seen): he gets a ring of the mark's colour round his disc and the same colour on his plaque.
    const aimed = new Map(s.marks.filter((m) => m.kind === 'strat' || m.kind === 'attack').map((m) => [`${m.x},${m.y}`, MARK[m.kind][1]]));
    const aimOf = (v) => aimed.get(`${Math.round(v.x)},${Math.round(v.y)}`);
    const all = document.body.classList.contains('alt-held'), D = data();
    const here = (v, p) => p && Math.round(v.x) === p.x && Math.round(v.y) === p.y;
    const fs = Math.round(Math.max(11, c * 0.26) * LK), pad = Math.max(3, Math.round(fs * 0.3)), tall = c * 1.65;
    // Every plaque laid out first (drawn last): the hover below asks what each general covers.
    const plate = new Map();
    for (const v of units) {
      const o = field.O(v.u.id), full = all || s.sel === v.u || here(v, s.hover);
      const label = `${v.u.commander ? '★' : ''}${name(v.u.id)}`, stats = `兵${o.soldiers}　体${o.hp}`, sf = Math.round(fs * 0.86);
      g.font = `bold ${fs}px "Noto Serif SC", serif`; let tw = g.measureText(label).width;
      if (full) { g.font = `${sf}px "Noto Serif SC", serif`; tw = Math.max(tw, g.measureText(stats).width); }
      // 奇门遁甲's day count (or that 诸葛亮 is gone) as a small violet line under the name, and a 虚兵 / 连环 hold as an amber
      // one, as in the 3D tag.
      const chip = [v.qimen && [v.qimen.chip, '#d9a8ff'], v.hold && [v.hold, '#ffc870']].filter(Boolean), cf = Math.round(fs * 0.78);
      g.font = `${cf}px "Noto Serif SC", serif`; for (const [t] of chip) tw = Math.max(tw, g.measureText(t).width);
      const w = Math.max(c * 0.78, tw + pad * 2), bars = 3 + 2 + 3, hh = fs + chip.length * (cf + 1) + pad + bars + (full ? sf + pad : 0) + pad;
      const cx = ox + (v.x + 0.5) * c, head = oy + (v.y + 0.78) * ch - v.lift * c - c * 1.3;
      plate.set(v, { o, full, label, stats, sf, chip, cf, w, hh, bars, cx, X: Math.round(cx - w / 2) + 0.5, Y: Math.round(head - hh - 2) + 0.5 });
    }
    // Reading the ground under the generals (playtest of 2026-10-31, F04). The ground view (app.js terrainView: T
    // held or the 地形 button) eases in; and under the pointer, a general whose figure or plaque covers the hovered
    // cell while he stands on another thins out, so the cell can be seen without moving anyone.
    const dt = Math.min(0.05, time - (draw.t ?? time)), ease = 1 - Math.exp(-dt * 14); draw.t = time;
    tv += ((document.body.classList.contains('terrain-view') ? 1 : 0) - tv) * ease;
    // Plaques that would cover one another part (the phone's small cells, and 系统 → 地图标签 大: 关羽's plaque over 张飞's name beside him,
    // 2026-11-20). Neighbours in a row first nudge aside by half of what they share; one still covered steps up over the other, a thin
    // leader in his side's colour running back to his head, as the city tags and the 3D war map's tags do. The selected or pointed-at general's
    // keeps its place, then the front rows'. Offsets ease (shift), so a march past a neighbour does not make the plaques jump.
    const shown = units.filter((v) => v.opacity >= 0.5), want = (v) => (s.sel === v.u ? 2 : plate.get(v).full ? 1 : 0);
    for (const v of shown) { const p = plate.get(v); p.tx = 0; p.ty = 0; }
    for (let it = 0; it < 4; it++) for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = plate.get(shown[i]), b = plate.get(shown[j]), dx = (b.cx + b.tx) - (a.cx + a.tx);
      if (Math.abs(a.Y + a.hh - b.Y - b.hh) > Math.min(a.hh, b.hh) * 0.5 || !dx) continue; // a row: their feet level
      const ov = (a.w + b.w) / 2 + 2 - Math.abs(dx); if (ov <= 0 || ov > c * 0.5) continue;
      const lim = c * 0.3, d = Math.sign(dx) * ov / 2;
      a.tx = Math.max(-lim, Math.min(lim, a.tx - d)); b.tx = Math.max(-lim, Math.min(lim, b.tx + d));
    }
    const placed = [];
    for (const v of [...shown].sort((a, b) => want(b) - want(a) || b.y - a.y || a.x - b.x)) {
      const p = plate.get(v);
      for (let k = 0; k < 4; k++) {
        const x = p.cx + p.tx, y = p.Y + p.ty, hit = placed.find((r) => Math.abs(r.x - x) < (r.w + p.w) / 2 - 1 && y < r.y + r.hh - 1 && y + p.hh > r.y + 1);
        if (!hit) break;
        p.ty = hit.y - p.hh - 2 - p.Y;
      }
      placed.push({ x: p.cx + p.tx, y: p.Y + p.ty, w: p.w, hh: p.hh });
    }
    for (const v of shown) {
      const p = plate.get(v), sh = shift.get(v.u) ?? { x: 0, y: 0 }; shift.set(v.u, sh);
      sh.x += (p.tx - sh.x) * ease; sh.y += (p.ty - sh.y) * ease;
      const mx = Math.round(sh.x), my = Math.round(sh.y);
      p.headX = p.cx; p.headY = p.Y + p.hh; p.cx += mx; p.X += mx; p.Y += my; p.up = -my;
    }
    plateRects = shown.map((v) => { const p = plate.get(v); return { id: v.u.id, x: p.X, y: p.Y, w: p.w, h: p.hh, up: p.up }; });
    const hv = s.hover && { x0: ox + (s.hover.x + 0.15) * c, x1: ox + (s.hover.x + 0.85) * c, y0: oy + (s.hover.y + 0.15) * ch, y1: oy + (s.hover.y + 0.85) * ch };
    const hits = (r) => !!hv && r.x0 < hv.x1 && r.x1 > hv.x0 && r.y0 < hv.y1 && r.y1 > hv.y0;
    for (const v of units) {
      const cx = ox + (v.x + 0.5) * c, foot = oy + (v.y + 0.78) * ch, w = v.img ? tall * v.cw / v.ch : c, p = plate.get(v);
      const covers = !here(v, s.hover) && (hits({ x0: cx - w * 0.3, x1: cx + w * 0.3, y0: foot - v.lift * c - tall * 0.9, y1: foot - c * 0.2 }) || hits({ x0: p.X, x1: p.X + p.w, y0: p.Y, y1: p.Y + p.hh }));
      const k = thin.get(v.u) ?? 1; thin.set(v.u, k + ((covers ? 0.3 : 1) - k) * ease);
    }
    const ghost = 1 - tv * 0.82, rw = Math.max(2.5, c * 0.07);
    for (const v of units) {
      const cx = ox + (v.x + 0.5) * c, foot = oy + (v.y + 0.78) * ch, [col, lit] = SIDE[v.side], k = thin.get(v.u) ?? 1;
      const sel = s.sel === v.u;
      g.globalAlpha = v.opacity;
      if (sel) { g.strokeStyle = `rgba(255, 240, 180, ${0.6 + 0.4 * Math.sin(time * 5)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(cx, foot, c * 0.44, c * 0.17, 0, 0, Math.PI * 2); g.stroke(); }
      // A lacquered ring in the side's colour, wider than the horse, so the two armies part at a glance (A2); inside
      // it the cell's own ground shows through under a light tint (F04: a solid disc here hid what he stands on).
      // It stays in the ground view, so every general's place is still marked while his figure is a ghost.
      const ell = (rx, ry, a0 = 0, a1 = Math.PI * 2) => { g.beginPath(); g.ellipse(cx, foot + c * 0.02, rx, ry, 0, a0, a1); };
      g.globalAlpha = v.opacity * Math.max(0.5, k) * (1 - tv);
      g.fillStyle = 'rgba(0,0,0,0.34)'; g.beginPath(); g.ellipse(cx + c * 0.04, foot + c * 0.05, c * 0.36, c * 0.13, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = v.opacity * Math.max(0.5, k) * (1 - tv * 0.6) * 0.26; g.fillStyle = col; ell(c * 0.51, c * 0.19); g.fill();
      g.globalAlpha = v.opacity * Math.max(0.7, k);
      g.strokeStyle = 'rgba(0, 0, 0, 0.5)'; g.lineWidth = rw + 2; ell(c * 0.51, c * 0.19); g.stroke();
      g.strokeStyle = col; g.lineWidth = rw; ell(c * 0.51, c * 0.19); g.stroke();
      g.strokeStyle = lit; g.lineWidth = 1; ell(c * 0.51, c * 0.19, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      // The stone ring of 奇门遁甲: dashed violet stones round the lacquered ring, turning while 诸葛亮 holds the array.
      if (v.qimen) {
        g.save(); g.globalAlpha = v.opacity * 0.45 * (1 - tv * 0.6); g.strokeStyle = '#c070ff'; g.lineWidth = Math.max(2.5, c * 0.08); g.lineCap = 'round';
        g.setLineDash([c * 0.16, c * 0.1]); g.lineDashOffset = v.qimen.spin ? -time * c * 0.18 : 0; ell(c * 0.68, c * 0.26); g.stroke(); g.restore();
      }
      const aim = aimOf(v);
      if (aim) {
        g.save(); g.globalAlpha = v.opacity * 0.45 * pulse; g.fillStyle = aim; ell(c * 0.51, c * 0.19); g.fill();
        g.strokeStyle = aim; g.shadowColor = aim; g.shadowBlur = 12; g.globalAlpha = v.opacity * pulse;
        g.lineWidth = 3.5; ell(c * 0.62, c * 0.26); g.stroke(); g.restore();
      }
      if (v.img) {
        const h = tall, w = h * v.cw / v.ch, a = v.opacity * k * ghost;
        g.globalAlpha = a;
        g.save(); g.translate(cx, foot - v.lift * c + c * 0.04); g.rotate(v.tilt ?? 0); if (v.flip < 0) g.scale(-1, 1);
        g.drawImage(v.img, v.sx, 0, v.cw, v.ch, -w / 2, -h, w, h);
        // Struck: a white flash over the figure as it recoils (the 3D view's emissive pulse).
        if (v.flash > 0.02) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * Math.min(1, v.flash); g.drawImage(v.img, v.sx, 0, v.cw, v.ch, -w / 2, -h, w, h); g.globalCompositeOperation = 'source-over'; }
        g.restore();
      }
      g.globalAlpha = 1;
    }
    effects(s.fx, c, ch, ox, oy);
    // Over every general's head a small lacquered plaque, as in the A2 concept: his name, under it his troops in
    // his side's colour and a thin amber line for his strength (体力). The selected or hovered general's plaque
    // also gives the numbers; Alt shows them for all. The ground view puts them away.
    g.textBaseline = 'middle'; g.textAlign = 'center';
    // Front generals' plaques last (drawn over the ones behind), the selected one on top of all.
    for (const v of [...units].sort((a, b) => (s.sel === a.u) - (s.sel === b.u))) {
      const a = v.opacity * (thin.get(v.u) ?? 1) * (1 - tv);
      if (v.opacity < 0.5 || a < 0.02) continue;
      const [col, lit] = SIDE[v.side], { o, full, label, stats, sf, chip, cf, w, hh, bars, cx, X, Y } = plate.get(v), max = D.officers[v.u.id]?.hp || o.hp || 1;
      g.globalAlpha = a;
      const pl = plate.get(v);
      if (pl.up > 2) { // stepped up: the leader back to his head
        for (const [lc, lw] of [['rgba(0, 0, 0, 0.7)', 3], [col, 1]]) { g.strokeStyle = lc; g.lineWidth = lw; g.beginPath(); g.moveTo(Math.round(cx) + 0.5, Y + hh); g.lineTo(Math.round(pl.headX) + 0.5, pl.headY + 2); g.stroke(); }
      }
      g.fillStyle = 'rgba(0, 0, 0, 0.35)'; g.fillRect(X + 1.5, Y + 2, w, hh);
      g.fillStyle = 'rgba(22, 16, 10, 0.9)'; g.fillRect(X, Y, w, hh);
      const aim = aimOf(v);
      if (aim) { g.save(); g.shadowColor = aim; g.shadowBlur = 10; g.strokeStyle = aim; g.lineWidth = 2.5; g.strokeRect(X - 1, Y - 1, w + 2, hh + 2); g.restore(); }
      else { g.strokeStyle = s.sel === v.u ? 'rgba(255, 226, 150, 0.95)' : 'rgba(196, 160, 96, 0.8)'; g.lineWidth = 1; g.strokeRect(X, Y, w, hh); }
      g.font = `bold ${fs}px "Noto Serif SC", serif`; g.fillStyle = '#f4e8cc'; g.fillText(label, cx, Y + pad + fs / 2);
      g.font = `${cf}px "Noto Serif SC", serif`; chip.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, cx, Y + pad + fs + i * (cf + 1) + cf / 2 + 1); });
      // Troops (of 1000) in the side's colour over a dark track, strength in amber under it.
      const bx = X + pad, bw = w - pad * 2, by = Y + pad + fs + chip.length * (cf + 1) + Math.round(pad * 0.6);
      g.fillStyle = 'rgba(0, 0, 0, 0.6)'; g.fillRect(bx, by, bw, 3); g.fillRect(bx, by + 5, bw, 2);
      g.fillStyle = col; g.fillRect(bx, by, bw * Math.min(1, o.soldiers / 1000), 3);
      g.fillStyle = lit; g.globalAlpha = a * 0.5; g.fillRect(bx, by, bw * Math.min(1, o.soldiers / 1000), 1); g.globalAlpha = a;
      g.fillStyle = '#e8a040'; g.fillRect(bx, by + 5, bw * Math.min(1, o.hp / max), 2);
      if (full) { g.font = `${sf}px "Noto Serif SC", serif`; g.fillStyle = '#e6d6b4'; g.fillText(stats, cx, by + bars + pad * 0.5 + sf / 2 + 1); }
      g.globalAlpha = 1;
    }
    // The day's loss rising over its target: red, outlined, easing up and out above the plaque.
    const now = performance.now() / 1000;
    for (const f of s.fx) {
      const k = (now - f.t) / ((f.ms ?? 900) / 1000), p = f.kind === 'num' && plate.get(units.find((v) => v.u === f.u));
      if (!p || k < 0 || k >= 1) continue;
      // Under his own plaque, over his head: rising toward it, clear of the plaques of those behind.
      const X = p.cx, Y = p.Y + p.hh + c * 0.55 - (1 - (1 - k) * (1 - k)) * c * 0.35;
      g.font = `bold ${Math.round(fs * 1.5)}px "Noto Serif SC", serif`; g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = 'rgba(20, 6, 4, 0.9)';
      g.globalAlpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45; g.fillStyle = f.color;
      g.strokeText(f.text, X, Y); g.fillText(f.text, X, Y);
    }
    g.globalAlpha = 1;
    // The ground view: each cell a general stands on or covers (his own and the two behind him) and the hovered
    // cell outlined, with its terrain on a small plaque edged in the terrain's colour, like the villages' signs.
    if (tv > 0.01) {
      const cells = new Set(s.hover ? [`${s.hover.x},${s.hover.y}`] : []);
      for (const v of units) { const x = Math.round(v.x), y = Math.round(v.y); for (let d = 0; d < 3 && y - d >= 0; d++) cells.add(`${x},${y - d}`); }
      const fsT = Math.round(Math.max(11, ch * 0.34) * LK), w = fsT + 10, hh = fsT + 6;
      g.font = `bold ${fsT}px "Noto Serif SC", serif`;
      for (const key of cells) {
        const [x, y] = key.split(',').map(Number), X = ox + x * c, Y = oy + y * ch;
        const t = field.villages.some((q) => q.x === x && q.y === y) ? 6 : field.terr(x, y), [glyph, tint] = GROUND[t];
        g.globalAlpha = tv * 0.6; g.strokeStyle = '#fff0c8'; g.lineWidth = 1; g.strokeRect(X + 1.5, Y + 1.5, c - 3, ch - 3);
        const PX = Math.round(X + (c - w) / 2) + 0.5, PY = Math.round(Y + (ch - hh) / 2) + 0.5;
        g.globalAlpha = tv;
        g.fillStyle = 'rgba(12, 9, 5, 0.82)'; g.fillRect(PX, PY, w, hh);
        g.strokeStyle = tint; g.lineWidth = 2; g.strokeRect(PX, PY, w, hh);
        g.fillStyle = '#f8eed6'; g.fillText(glyph, PX + w / 2, PY + hh / 2 + 1);
      }
      g.globalAlpha = 1;
    }
    g.textAlign = 'start';
    if (s.weather) { const dt = Math.min(0.05, time - (skyT ?? time)); skyT = time; sky.draw(g, s.weather, { width: innerWidth, height: innerHeight, cell: c, time, dt, light: true }); }
  }

  // A soft round light (fx.js glowTex) and the 2D twins of fx.js's 计略 vocabulary, with the same timings.
  function glow(x, y, rad, color, a = 1) {
    if (rad <= 0.5) return;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, color); grd.addColorStop(0.3, color); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha *= a; g.fillStyle = grd; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.globalAlpha /= a || 1;
  }
  const FX2D = {
    flare(f, k, r, P, c) {
      const [x, y] = P(0, 0, 0); g.globalAlpha = k < 0.2 ? k / 0.2 : (1 - k) / 0.8;
      glow(x, y, f.size * c * 0.42 * (0.5 + k * 0.7), f.color);
    },
    flames(f, k, r, P, c) {
      for (let i = 0; i < f.n; i++) {
        const a = (i / f.n) * Math.PI * 2 + r() * 0.6, rr = f.spread * (0.3 + r() * 0.7), hh = f.rise * (0.7 + r() * 0.6), ph = r() * 6, delay = r() * 0.25;
        const q = Math.max(0, (k - delay) / (1 - delay)), life = Math.sin(Math.min(1, q) * Math.PI);
        if (life <= 0) continue;
        const [x, y] = P(Math.cos(a) * rr + Math.sin(k * 14 + ph) * 0.05, -0.7 + q * 0.3, Math.sin(a) * rr);
        const w = hh * 0.5 * (0.8 + 0.2 * Math.sin(k * 23 + ph)) * c * 0.5, h = hh * life * (0.85 + 0.15 * Math.sin(k * 31 + ph)) * c * 0.55;
        const grd = g.createRadialGradient(x, y - h * 0.22, 1, x, y - h * 0.35, h * 0.75);
        grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(0.3, 'rgba(255,200,90,0.9)'); grd.addColorStop(0.65, 'rgba(255,110,30,0.55)'); grd.addColorStop(1, 'rgba(200,40,10,0)');
        g.globalAlpha = Math.min(1, life * 1.4); g.fillStyle = grd;
        g.beginPath(); g.moveTo(x, y - h); g.bezierCurveTo(x + w * 0.9, y - h * 0.6, x + w, y - h * 0.25, x, y); g.bezierCurveTo(x - w, y - h * 0.25, x - w * 0.9, y - h * 0.6, x, y - h); g.fill();
      }
    },
    embers(f, k, r, P, c) {
      const t = k * f.ms / 1000;
      for (let i = 0; i < f.n; i++) {
        const a = r() * Math.PI * 2, rr = r() * f.spread, y0 = -0.4 + r() * 0.3, vx = (r() - 0.5) * 0.6, vy = f.rise * (0.6 + r() * 0.6), vz = (r() - 0.5) * 0.6, ph = r() * 6;
        const [x, y] = P(Math.cos(a) * rr + vx * t + Math.sin(k * 9 + ph) * 0.4 * t, y0 + vy * t, Math.sin(a) * rr + vz * t);
        g.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4; glow(x, y, f.size * c * 0.16, f.color);
      }
    },
    streaks(f, k, r, P, c) {
      const side = f.from === 'side', [dx, dy, dz] = side ? [-1, 0.15, 0] : [-0.35, 1, 0.2], l = Math.hypot(dx, dy, dz);
      g.strokeStyle = f.color; g.lineCap = 'round';
      for (let i = 0; i < f.n; i++) {
        const ex = (r() - 0.5) * f.spread, ey = -0.3 + r() * 0.3, ez = (r() - 0.5) * f.spread, delay = (i / f.n) * 0.45;
        const q = Math.max(0, Math.min(1, (k - delay) / (1 - delay))); if (q <= 0 || q >= 1) continue;
        const back = 4 * (1 - q), tail = back + f.len;
        const [x1, y1] = P(ex + dx / l * back, ey + dy / l * back, ez + dz / l * back), [x0, y0] = P(ex + dx / l * tail, ey + dy / l * tail, ez + dz / l * tail);
        const grd = g.createLinearGradient(x0, y0, x1, y1); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, f.color);
        g.strokeStyle = grd; g.globalAlpha = 1; g.lineWidth = Math.max(1.5, c * 0.05); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    },
    ring(f, k, r, P, c) {
      const q = f.shrink ? 1 - k * 0.85 : 0.2 + k * 0.8, [x, y] = P(0, -0.7, 0), rx = f.r * q * c, ry = P(0, -0.7, f.r * q)[1] - y;   // flat on the ground
      g.globalAlpha = f.shrink ? Math.min(1, k * 4) * (1 - k * 0.5) : 1 - k; g.strokeStyle = f.color;
      for (const [w, a] of [[c * 0.14, 0.25], [c * 0.05, 0.7], [Math.max(1.2, c * 0.02), 1]]) { g.lineWidth = w; g.globalAlpha *= a; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha /= a; }
    },
  };

  // The scene's effects (src/fx.js, listed by warview.js flatFx), each from where it was set off and for as long
  // as it runs there: sparks, dust and slashes, and the flares, flames, embers, streaks and rings each 计略 mixes
  // into its own. h lifts it off the ground; P maps a step in the world (x, height, z) onto the board.
  const LAST = { slash: 0.35, dust: 0.6, spark: 0.8, num: 0.9 };
  function effects(list, c, ch, ox, oy) {
    const now = performance.now() / 1000;
    for (const f of list) {
      const k = (now - f.t) / (f.ms ? f.ms / 1000 : LAST[f.kind] ?? 0.8);
      if (k < 0 || k >= 1 || f.kind === 'num') continue; // numbers are drawn over the plaques
      const X = ox + (f.x + 0.5) * c, Y = oy + (f.y + 0.78) * ch - f.h * c * 0.55, r = rng(f.seed);
      const P = (dx, dy, dz) => [X + dx * c, Y + dz * ch - dy * c * 0.55];
      if (f.kind in FX2D) { g.save(); g.globalCompositeOperation = 'lighter'; FX2D[f.kind](f, k, r, P, c); g.restore(); continue; }
      if (f.kind === 'dust') {
        const rad = f.size * c * (0.35 + 0.9 * k);
        const grd = g.createRadialGradient(X, Y - k * c * 0.3, 0, X, Y - k * c * 0.3, rad);
        grd.addColorStop(0, `rgba(196, 172, 128, ${0.55 * (1 - k)})`); grd.addColorStop(1, 'rgba(196, 172, 128, 0)');
        g.fillStyle = grd; g.beginPath(); g.arc(X, Y - k * c * 0.3, rad, 0, Math.PI * 2); g.fill();
      } else if (f.kind === 'slash') {
        g.save(); g.globalCompositeOperation = 'lighter'; g.translate(X, Y - c * 0.4); g.rotate(-0.7);
        const R = f.size * c * 0.55, a0 = -Math.PI * 0.75, a1 = a0 + Math.PI * 1.1 * Math.min(1, k * 2.5);
        g.strokeStyle = `rgba(255, 236, 190, ${1 - k})`; g.lineCap = 'round';
        for (const [w, al] of [[c * 0.16, 0.25], [c * 0.07, 0.6], [c * 0.025, 1]]) { g.globalAlpha = al; g.lineWidth = w; g.beginPath(); g.arc(0, 0, R, a0, a1); g.stroke(); }
        g.restore();
      } else {
        g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = f.color;
        const n = Math.min(60, f.n), t = k * 0.8;
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2, sp = (1.2 + r() * 2.8) * c, vy = Math.sin(a) * sp * 0.8 - c * 1.6;
          const px = X + Math.cos(a) * sp * t, py = Y - c * 0.4 + vy * t + c * 5 * t * t, sz = Math.max(1, c * 0.06 * (1 - k));
          g.globalAlpha = (1 - k) * (0.6 + 0.4 * r());
          if (f.glow) glow(px, py, sz * 2.2, f.color); else g.fillRect(px - sz / 2, py - sz / 2, sz, sz);   // 计略 sparks are soft
        }
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }

  return Object.assign(Object.create(war), {
    scene: blankScene, flat: true, flatHud: true,
    composite: () => mapImg ?? paintFlatMap(G, field), // the composed map: the layout guide a painting is made from (tools/flat_shot.mjs --dump)
    // For the tests: how often the board under the generals was painted (paintBase) against frames drawn, and where the board sits.
    flatDebug: () => ({ plates: plateRects, basePaints, frames, base: [base.width, base.height], canvas: [cv.width, cv.height], country: pic.country, box: { x: box.x, y: box.y, w: box.cw * W, h: box.ch * H } }),
    // Desktop: space kept on the left for the expanded war roster, shifting the board into the right margin without shrinking it.
    setLeftClear(px) { const v = Math.max(0, Number(px) || 0); if (v === leftClear) return; leftClear = v; place(); },
    // Whether the full-scale 2D board has enough horizontal slack to sit right of `clear` px without shrinking.
    canFitLeft(clear) {
      if (PHONE) return false;
      const B = pic.board, band = innerHeight - FLAT_INSET.top - FLAT_INSET.bottom;
      const k0 = Math.min((innerWidth - FLAT_INSET.side * 2) / B.w, band / B.h);
      return innerWidth - FLAT_INSET.side - B.w * k0 >= clear - 0.5;
    },
    // A hidden window still moves the war on (app.js runs it 30 times a second) but paints nothing, as the 3D views.
    update(dt) { time += dt; war.update(dt); if (TOUCH) follow(dt); if (!document.hidden) draw(); },
    hover(ndc) { return war.hoverCell(cellAt(ndc)); },
    click(ndc, e) { const c = cellAt(ndc); if (c) war.clickCell(c.x, c.y, e); }, // the event goes on: src/commitguard.js judges the click by it
    // A cell's centre on screen, in CSS px (tools click the map as a player would).
    screenOf: (x, y) => ({ x: box.x + (x + 0.5) * box.cw, y: box.y + (y + 0.5) * box.ch, cw: box.cw, ch: box.ch }),
    screenAxes: () => ({ x: [box.cw, 0], y: [0, box.ch] }), // one grid step on screen (the gamepad's cursor, app.js)
    orbit() {}, zoom(d, ndc) { if (TOUCH) zoomAt(d, ndc); }, pan() {}, resetView() { if (TOUCH) { view.z = 1; view.x = view.y = 0; place(); } }, frame() {}, overview() { war.overview(); },
    ...(TOUCH ? { slide, centreOn } : {}),
    rotate: undefined, turn: undefined, turnEnd: undefined, tactical: undefined, viewState: undefined, dof: undefined, setTerrainView: undefined, // the flat map has no turn, zoom step or overview of its own
    setInsets() {},
  });
}
