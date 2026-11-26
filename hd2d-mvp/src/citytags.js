// The 战略地图's city tags (DOM .ctag), spaced the same on the 3D map and the flat one.
// A mark is { el, dy, w, h }; an entry is { m: mark, s: scale, d: nearness (smaller goes first), keep: wanted right now, x, y0: the tag's middle on screen, foot: how far below that its city's anchor is (0 if there), px }.

// Tag sizes, read once after their text or form changes; false while they have no size yet (their layer hidden, say).
export function measureTags(marks) {
  for (const m of marks) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
  return marks.every((m) => m.w > 0);
}

// Tags that would cover one another step up out of the way on a thin leader to their city, the wanted and
// nearest first (T14: 新野 under 洛阳, 豫州 over 兖州 at the default view).
export function layoutTags(entries, { dt }) {
  const placed = [], ease = 1 - Math.exp(-dt * 10);
  entries.sort((a, b) => b.keep - a.keep || a.d - b.d);
  for (const { m, s, x, y0, foot = 0 } of entries) {
    if (!m.w) continue;
    const w = m.w * s, h = m.h * s;
    let dy = 0;
    for (let k = 0; k < 6; k++) {
      const hit = placed.find((r) => Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - (y0 + dy)) < (r.h + h) / 2 + 1);
      if (!hit) break;
      dy = hit.y - (hit.h + h) / 2 - 2 - y0;
    }
    placed.push({ x, y: y0 + dy, w, h });
    m.dy += (dy - m.dy) * ease;
    m.el.style.setProperty('--dy', `${m.dy.toFixed(1)}px`);
    m.el.style.setProperty('--lead', `${Math.max(0, (-m.dy - h * 0.55 + foot) / s).toFixed(1)}px`);
  }
}

// What a tag says (阿拉神丁@qq, 2026-11-19): the city's name, inked in its owner's colour (tagInk), and under it, shown only while
// pointed at (ui.css), the owner's name; the legend on the right already pairs each colour with its ruler. A rival's officer count
// is no longer on the map, as his city panel keeps it for 侦察; one's own cities and the 退却 map (a war's headcount) still give it.
// An unowned city keeps 无主 in sight, so it is never told from a house by its colour alone (1(3) of the same feedback: colour-weak players).
export function tagHtml(name, owner, { mine = false, none = false, count = 0 } = {}) {
  return `${name}<small${none ? ' class="open"' : ''}>${owner}${mine && count ? `·${count}将` : ''}</small>`;
}
// The name's ink: the owner's colour, lifted toward white until it reads on the tag's dark ground (董卓's slate would not).
export function tagInk(hex) {
  const v = parseInt(String(hex).replace('#', '').slice(0, 6), 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255];
  const lum = (p) => p.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
  let t = 0, p = c;
  while (lum(p) < 0.3 && t < 1) { t += 0.05; p = c.map((x) => Math.round(x + (255 - x) * t)); }
  return `rgb(${p.join(',')})`;
}
