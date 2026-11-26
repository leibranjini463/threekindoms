// What the war map shows of itself, read-only (split out of src/warview.js, docs/战场3D拆分实施计划_2026-11-13.md): probe(), the
// measures tools/war_look_check.mjs and the tests take, and flatState(), what the flat painted map draws each frame. lastFigs (reassigned
// by units.js's declutter), cells and fx2d are read as wv.lastFigs, wv.cells and wv.fx2d at the moment they are asked for.
import { cutEllipse, CUT_CORE } from '../seethrough.js';
import { W, H } from '../core/field.js';
import { YAWS } from './shared.js';

export function makeProbe(wv) {
  const { field, camera, where, topY, dressed, LANDMARK_KEEP, cutout, VICON, views, look, qimenNote, holdNote, FIGURE, BASE_GEO, markCol, rangeCells, view,
    footprint, stepDist, coveringUnits, gtags, st } = wv;
  // The flat painted map (src/warmap2d.js) draws from this each frame (read-only): range and route cells,
  // where each general stands now (mid-ride too), his frame in the strip and which way he faces.
  const flatState = () => ({
    marks: [...wv.cells.range, ...wv.cells.route],
    threat: wv.threatCells(), // the cells the enemy could strike when he next acts, while that view is on (src/war/overlay.js setThreat)
    routeFrom: wv.routeFrom(), // the cell the hovered or walked route (the marks of kind 'path', in order) sets out from
    units: [...views].map(([u, v]) => {
      const img = v.tex.image, n = v.frames?.length ?? 1, cw = img.width / n;
      return { u, side: look(u.side), x: v.g.position.x + W / 2 - 0.5, y: v.g.position.z + H / 2 - 0.5, lift: v.bill.position.y, flip: v.body.scale.x,
        visible: !!v.g.parent, opacity: v.body.material.opacity ?? 1, img, cw, ch: img.height, sx: Math.max(0, v.frame ?? 0) * cw * (n > 1 ? 1 : 0),
        tilt: v.bill.rotation.z, flash: v.body.material.emissiveIntensity ?? 0,
        qimen: u.qimen > 0 ? { chip: qimenNote(u), spin: field.kongmingOn() } : null, hold: holdNote(u) };
    }),
    sel: st.sel && !st.sel.gone ? st.sel : null, hover: st.hoverCell,
    fx: wv.fx2d, weather: where.weather, month: field.g.month, villages: field.villages.map((v) => ({ x: v.x, y: v.y, icon: VICON[v.kind] || '村' })),
  });
  // What tools/war_look_check.mjs measures that the pixels alone do not tell (read-only).
  const probe = () => ({
    figure: FIGURE, view: { over: (() => { const f = footprint(view.yaw, view.pitch, view.dist); return f ? Math.max(...f.map(([x, z]) => Math.max(Math.abs(x + view.target.x) - W / 2, Math.abs(z + view.target.z) - H / 2))) : null; })(), atFit: !!view.atFit, moved: !!view.moved, dist: view.dist, yaw: view.yaw, yawGoal: view.yawGoal, pitch: view.pitch, zoom: view.zoom, tactical: !!view.tactical, yaws: YAWS, target: view.targetGoal.toArray(), now: view.target.toArray() },
    units: [...views].map(([u, v]) => ({ id: u.id, ...v.size })),
    roundels: [...views.values()].filter((v) => v.rnd?.visible).length, tags: [...views.values()].filter((v) => v.label.visible).length,
    // The share of its picture each dressing mesh keeps where it covers a general (read off the see-through material), by landmark or not.
    kept: (() => { const out = { landmark: new Set(), other: new Set(), blend: new Set(), dither: new Set(), types: new Set() }; const walk = (n, inLm) => { inLm ||= !!n.userData.landmark; if (n.isMesh) for (const m of [n.material].flat()) { const k = m.userData.cutKeep; out.types.add(`${m.type}${k == null ? ' (uncut)' : ''}`); if (k != null) { out[inLm ? 'landmark' : 'other'].add(k); out.blend.add(m.transparent); out.dither.add(/cutNoise/.test(String(m.onBeforeCompile))); } } n.children.forEach((c) => walk(c, inLm)); }; dressed.forEach((o) => walk(o, false)); return { landmark: [...out.landmark], other: [...out.other], blended: [...out.blend], dithered: [...out.dither], types: [...out.types] }; })(),
    landmarks: dressed.filter((o) => o.userData.landmark).map((o) => ({ kind: o.userData.landmark, keep: LANDMARK_KEEP, shop: o.userData.shop ?? null, parts: (() => { const n = new Set(); o.traverse((c) => c.name && n.add(c.name)); return [...n]; })() })),
    bases: [...views].map(([u, v]) => ({ id: u.id, color: `#${v.g.children.find((o) => o.geometry === BASE_GEO)?.material.color.getHexString() ?? '000000'}` })),
    marks: { ...markCol },
    rangeMeshes: rangeCells(), // the cells the range layer shows (none on the flat map, which draws its own); the name is from when each was a mesh
    top: (x, y) => topY(x, y),
    thinTags: () => [...views].filter(([, v]) => v.el.classList.contains('thin')).map(([u, v]) => ({ id: u.id, by: v.thinBy ?? null, exempt: !!u.commander || u === st.sel || v.el.classList.contains('full') })), // which tags are thin, and why (read-only)
    viewOffset: () => camera.view?.offsetY ?? 0, // the projection shift that frames the board between the HUD (read-only)
    figures: () => wv.lastFigs, // each general's picture on screen, px (read-only)
    cuts: () => cutout.rects(), // the see-through ellipses as last set: centre and 1 / half-axes in clip space (read-only)
    // How each general's see-through ellipse fits his picture, over every frame of his strip: the farthest opaque pixel
    // (1 is the rim) and the share of them inside the core, where the cut is whole (read-only).
    cutFit: () => [...views].filter(([u, v]) => !u.gone && v.g.parent).map(([u, v]) => {
      const img = v.tex.image, n = v.frames?.length ?? 1, cw = Math.round(img.width / n), ch = img.height, { w, h } = v.quad, { cx, cy, rx, ry } = cutEllipse(v.body);
      const c = document.createElement('canvas'); c.width = cw * n; c.height = ch; const g = c.getContext('2d'); g.drawImage(img, 0, 0, cw * n, ch, 0, 0, cw * n, ch);
      const d = g.getImageData(0, 0, cw * n, ch).data; let worst = 0, all = 0, core = 0;
      for (let y = 0; y < ch; y++) for (let X = 0; X < cw * n; X++) if (d[(y * cw * n + X) * 4 + 3] > 127) {
        const en = Math.hypot(((((X % cw) + 0.5) / cw - 0.5) * w - cx) / rx, ((1 - (y + 0.5) / ch) * h - cy) / ry);
        worst = Math.max(worst, en); all++; if (en <= CUT_CORE) core++;
      }
      return { id: u.id, worst, inCore: all ? core / all : 1, core: CUT_CORE };
    }),
    fitDist: () => stepDist(view.zoom, { yaw: view.yaw }), // the exact fit of the current wheel step at the current angle (a turn must land on it)
    covering: (x, y) => coveringUnits(x, y).map((u) => u.id), // the generals who hide that cell from the camera (read-only)
    opacity: [...views].map(([u, v]) => ({ id: u.id, a: v.opa })), grounds: [...gtags.keys()],
  });
  return { probe, flatState };
}
