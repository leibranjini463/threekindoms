// Finding one's way round the 3D war map (第 2 期, docs/战场3D重构与操作优化方案_2026-11-13.md §6): a minimap of the 32×19 board
// with both armies and the frame the camera shows, a marker at the screen's edge for each general outside the picture, and
// (off unless switched on in the minimap's head) scrolling when the pointer rests at the window's edge. All of it reads the war and moves only
// the camera: nothing here touches the rules. The flat painted map shows the whole field at once and has none of this.
import { W, H, FOREST, SAND, PLAIN, RIVER, MOUNT, CASTLE } from './core/field.js';
import { name } from './core/game.js';

const CELL = 6, MINI_KEY = 'hd2d-minimap', EDGE_KEY = 'hd2d-edgescroll';
const GROUND = { [FOREST]: '#3c6434', [SAND]: '#b9a26c', [PLAIN]: '#76924a', [RIVER]: '#3b6ca3', [MOUNT]: '#6b6658', [CASTLE]: '#d9a24c' };
const OURS = '#5f8ff0', THEIRS = '#e0605a';
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export const edgeScroll = () => read(EDGE_KEY, '0') === '1';
export const setEdgeScroll = (on) => write(EDGE_KEY, on ? '1' : '0');

export function createWarNav(war, host) {
  const field = war.field, ours = (u) => (field.human ? u.side === field.human : u.side === 'att');
  // --- The minimap: the ground once, then each frame the generals and the camera's frame over it.
  const box = Object.assign(document.createElement('div'), { className: 'warmini' });
  const cv = Object.assign(document.createElement('canvas'), { width: W * CELL * 2, height: H * CELL * 2 }); // drawn at 2× for sharp dots
  cv.style.width = `${W * CELL}px`; cv.style.height = `${H * CELL}px`;
  const toggle = Object.assign(document.createElement('button'), { className: 'warmini-toggle', type: 'button', title: '小地图（M）' });
  // Edge scrolling is switched here, with the map it serves (系统's list has no room for another row at 1024×600).
  const edgeBtn = Object.assign(document.createElement('button'), { className: 'warmini-edge', type: 'button', title: '鼠标停在窗口边缘时平移画面（窗口模式下鼠标划出窗口会带动画面，默认关）' });
  const showEdge = () => { edgeBtn.textContent = `边缘滚屏 ${edgeScroll() ? '开' : '关'}`; edgeBtn.setAttribute('aria-pressed', String(edgeScroll())); };
  edgeBtn.onclick = () => { setEdgeScroll(!edgeScroll()); showEdge(); }; showEdge();
  const head = Object.assign(document.createElement('div'), { className: 'warmini-head' }); head.append(edgeBtn, toggle);
  box.append(head, cv); host.append(box);
  const edges = Object.assign(document.createElement('div'), { className: 'waredges' }); host.append(edges);
  const ground = Object.assign(document.createElement('canvas'), { width: cv.width, height: cv.height });
  { const g = ground.getContext('2d'), k = CELL * 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { g.fillStyle = GROUND[field.terr(x, y)] ?? GROUND[PLAIN]; g.fillRect(x * k, y * k, k, k); }
    g.fillStyle = 'rgba(0, 0, 0, 0.14)'; for (let y = 0; y < H; y++) for (let x = (y & 1); x < W; x += 2) g.fillRect(x * k, y * k, k, k); // a faint chequer: cells can be counted
    g.fillStyle = '#f1e2b8'; for (const v of field.villages ?? []) g.fillRect(v.x * k + k * 0.3, v.y * k + k * 0.3, k * 0.4, k * 0.4);
  }
  // Short windows start with it put away (the cards and the log leave it no room); the player's own choice is kept.
  let open = read(MINI_KEY, innerHeight < 680 ? '0' : '1') === '1';
  const show = () => { box.classList.toggle('shut', !open); toggle.textContent = open ? '小地图 ▾' : '小地图 ▸'; };
  const setOpen = (on) => { open = !!on; write(MINI_KEY, open ? '1' : '0'); show(); };
  toggle.onclick = () => setOpen(!open); show();
  const cellAt = (e) => { const r = cv.getBoundingClientRect(); return { x: Math.min(W - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * W))), y: Math.min(H - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * H))) }; };
  let dragging = false;
  const go = (e) => { const c = cellAt(e); war.centreOn?.(c.x, c.y); };
  cv.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; dragging = true; try { cv.setPointerCapture(e.pointerId); } catch { /* gone */ } go(e); e.preventDefault(); });
  cv.addEventListener('pointermove', (e) => { if (dragging) go(e); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) cv.addEventListener(t, () => { dragging = false; });
  function drawMini() {
    const g = cv.getContext('2d'), k = CELL * 2;
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(ground, 0, 0);
    for (const u of field.units) {
      if (u.gone) continue;
      const cx = (u.x + 0.5) * k, cy = (u.y + 0.5) * k, r = u.commander ? k * 0.62 : k * 0.46;
      g.beginPath(); g.arc(cx, cy, r + 2, 0, Math.PI * 2); g.fillStyle = u.commander ? '#f2c14e' : 'rgba(10, 12, 24, 0.9)'; g.fill();
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = ours(u) ? OURS : THEIRS; g.fill();
      if (u === war.st.sel) { g.beginPath(); g.arc(cx, cy, r + 5, 0, Math.PI * 2); g.strokeStyle = '#fff6d8'; g.lineWidth = 2; g.stroke(); }
    }
    const q = war.viewQuad?.();
    if (q) { // where the corners of the screen meet the ground; a corner past the horizon is left out by the view itself
      g.beginPath(); q.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); g.closePath();
      g.strokeStyle = 'rgba(10, 12, 24, 0.85)'; g.lineWidth = 5; g.stroke(); g.strokeStyle = '#fff6d8'; g.lineWidth = 2; g.stroke();
    }
  }
  // --- A marker at the screen's edge for each general the picture does not show: his side's colour and the first glyph of his
  // name (★ for a 总大将); a click brings him to the middle. Kept clear of the bar above and the cards and dock below.
  const chips = new Map();
  function chipOf(u) {
    let c = chips.get(u);
    if (!c) {
      c = Object.assign(document.createElement('button'), { type: 'button', className: `waredge ${ours(u) ? 'ours' : 'theirs'}` });
      c.innerHTML = `<i></i><b>${u.commander ? '★' : ''}${[...name(u.id)][0] ?? '?'}</b>`; c.title = name(u.id);
      c.onclick = () => war.centreOn?.(u.x, u.y);
      edges.append(c); chips.set(u, c);
    }
    return c;
  }
  let band = { top: 56, bottom: 96, left: 12, right: 12 };
  function measure() {
    const bar = document.querySelector('.warbar'), lows = [...document.querySelectorAll('.unitpanel:not(.compare), .wardock')].filter((e) => e.offsetParent);
    const roster = document.querySelector('.warroster:not([hidden])');
    const left = roster?.offsetParent && roster.getBoundingClientRect().width ? Math.round(roster.getBoundingClientRect().right + 10) : 12;
    band = { top: (bar?.offsetParent ? bar.getBoundingClientRect().bottom : 40) + 10, bottom: (lows.length ? innerHeight - Math.min(...lows.map((e) => e.getBoundingClientRect().top)) : 0) + 10, left, right: 12 };
  }
  // The minimap stands just over the turn pair (or the dock), wherever the window's size puts them.
  function place() {
    const under = [...document.querySelectorAll('.wardock .turnpair, .wardock')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().top);
    box.style.bottom = `${Math.round(innerHeight - (under.length ? Math.min(...under) : innerHeight - 110) + 8)}px`;
  }
  function drawEdges() {
    const vw = innerWidth, vh = innerHeight, hide = document.body.classList.contains('cine') || war.viewState?.().tactical || war.st.deploying;
    const x0 = band.left + 18, x1 = vw - band.right - 18, y0 = band.top + 18, y1 = vh - band.bottom - 18, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const u of field.units) {
      const s = !u.gone && !hide ? war.screenOf(u.x, u.y) : null, off = s && (s.x < band.left || s.x > vw - band.right || s.y < band.top - 24 || s.y > vh - band.bottom + 8);
      if (!off) { const c = chips.get(u); if (c) c.hidden = true; continue; }
      // Where the line from the middle of the clear to him leaves it.
      const dx = s.x - cx, dy = s.y - cy, t = Math.min(dx ? (dx > 0 ? x1 - cx : x0 - cx) / dx : Infinity, dy ? (dy > 0 ? y1 - cy : y0 - cy) / dy : Infinity);
      const c = chipOf(u); c.hidden = false;
      c.style.left = `${Math.round(cx + dx * t)}px`; c.style.top = `${Math.round(cy + dy * t)}px`; c.style.setProperty('--a', `${Math.atan2(dy, dx)}rad`);
    }
    for (const [u, c] of chips) if (u.gone) { c.remove(); chips.delete(u); }
  }
  // --- Edge scrolling (the minimap's 边缘滚屏, off by default: in a window the pointer leaves by the edge on its way out).
  let ptr = null;
  const onMove = (e) => { ptr = { x: e.clientX, y: e.clientY }; }, onLeave = () => { ptr = null; };
  addEventListener('pointermove', onMove); document.documentElement.addEventListener('pointerleave', onLeave); addEventListener('blur', onLeave);
  let tick = 0;
  return {
    // Each frame of the war map (src/app.js): the pan at the edge, the markers, and the minimap every third frame.
    update(dt, { blocked = false } = {}) {
      if (ptr && !blocked && edgeScroll() && !dragging) {
        const m = 6, dx = ptr.x <= m ? -1 : ptr.x >= innerWidth - 1 - m ? 1 : 0, dy = ptr.y <= m ? -1 : ptr.y >= innerHeight - 1 - m ? 1 : 0;
        if (dx || dy) war.pan?.(dx * dt * 14, dy * dt * 14);
      }
      box.hidden = !!war.st.deploying; // the 布阵完成 box stands where the minimap does: while the army is being placed the map makes way
      if (tick % 15 === 0) { measure(); place(); }
      drawEdges();
      if (open && tick % 3 === 0) drawMini();
      tick++;
    },
    toggleMini: () => setOpen(!open),
    get open() { return open; },
    // What a test reads: the dots as drawn, and the markers shown.
    probe: () => ({ open, dots: field.units.filter((u) => !u.gone).map((u) => ({ id: u.id, x: u.x, y: u.y, ours: ours(u) })), quad: war.viewQuad?.() ?? null,
      edges: [...chips].filter(([, c]) => !c.hidden).map(([u]) => u.id), rect: (() => { const r = cv.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })() }),
    dispose() { removeEventListener('pointermove', onMove); document.documentElement.removeEventListener('pointerleave', onLeave); removeEventListener('blur', onLeave); box.remove(); edges.remove(); chips.clear(); },
  };
}
