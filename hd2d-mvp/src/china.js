// Geography of the 战略地图: city seats, coastline, rivers, lakes and mountain ranges in real lon/lat.
// Pure data and lookups (no three.js), so tools/ can check it in node.

// The city seats and the bank each riverside seat stands on are data: the original 30 in data/base-map.json (checked by
// tools/check_geo.mjs), a pack's own in its cities.json (core/pack.js). Each is { lon, lat, seat, tier, bank? }, a bank
// being [river, 'left' | 'right'] looking downstream: the map nudges a city off the water onto that bank.

// Mainland outline, clockwise from the far north-east, then closed around the west off the board.
const MAINLAND = [
  [126.5, 44], [126.5, 39.2], [125.1, 39.55], [124.3, 39.85], [123.6, 39.75], [123.0, 39.6], [122.2, 39.3], [121.6, 38.85],
  [121.15, 38.85], [121.35, 39.3], [121.85, 39.7], [122.0, 40.2], [122.2, 40.65], [121.6, 40.9], [121.0, 40.85],
  [120.3, 40.3], [119.6, 39.9], [119.0, 39.2], [118.3, 39.05], [117.7, 38.95], [117.6, 38.5], [118.0, 38.1], [118.9, 37.7],
  [119.0, 37.2], [119.8, 37.1], [120.3, 37.5], [120.7, 37.8], [121.4, 37.6], [122.1, 37.5], [122.6, 37.4], [122.4, 36.9],
  [121.6, 36.7], [120.7, 36.3], [120.0, 35.9], [119.4, 35.1], [119.2, 34.6], [120.3, 34.0], [120.8, 33.0], [121.0, 32.5],
  [121.9, 31.8], [121.9, 31.1], [121.0, 30.6], [120.5, 30.3], [121.5, 29.9], [122.0, 29.6], [121.6, 28.6], [121.0, 28.0],
  [120.6, 27.3], [119.7, 26.4], [119.3, 25.5], [118.6, 24.6], [118.0, 24.4], [117.3, 23.7], [116.6, 23.2], [115.4, 22.8],
  [114.3, 22.4], [113.6, 22.2], [112.9, 21.9], [111.8, 21.6], [110.5, 21.2], [110.3, 20.3], [109.8, 20.6], [109.8, 21.4],
  [109.1, 21.5], [108.4, 21.7], [107.9, 21.5], [107.0, 21.0], [106.6, 20.6], [106.0, 19.9], [105.8, 18.5], [96, 18.5], [96, 44],
];
const HAINAN = [[108.6, 19.2], [109.5, 18.2], [110.5, 18.3], [111.0, 19.6], [110.6, 20.1], [109.6, 20.0], [108.7, 19.6]];
const TAIWAN = [[120.1, 23.0], [120.7, 22.0], [121.0, 22.5], [121.6, 24.0], [121.9, 25.0], [121.5, 25.3], [120.8, 24.6], [120.2, 23.6]];
export const LAND = [MAINLAND, HAINAN, TAIWAN];

// Rivers run downstream; w is the half width in degrees. The 黄河 takes its Eastern Han course
// (王景's channel) north-east past 濮阳 to the sea at 千乘.
export const RIVERS = [
  { name: '长江', w: 0.13, pts: [[97.0, 31.6], [98.4, 30.2], [99.3, 28.5], [99.32, 28.46], [99.36, 28.37], [99.42, 28.24], [99.5, 28.07], [99.57, 27.92], [99.64, 27.77], [99.7, 27.64], [99.76, 27.52], [99.81, 27.41], [99.87, 27.31], [99.92, 27.23], [99.98, 27.15], [100.04, 27.09], [100.1, 27.03], [100.16, 26.98], [100.23, 26.94], [100.3, 26.91], [100.37, 26.89], [100.44, 26.87], [100.5, 26.87], [100.57, 26.86], [100.63, 26.83], [100.7, 26.81], [100.76, 26.77], [100.84, 26.74], [100.92, 26.71], [101.01, 26.68], [101.1, 26.66], [101.2, 26.63], [101.31, 26.61], [101.42, 26.59], [101.53, 26.58], [101.67, 26.54], [101.84, 26.49], [102.04, 26.42], [102.26, 26.33], [102.46, 26.31], [102.64, 26.35], [102.79, 26.46], [102.91, 26.64], [103.04, 26.83], [103.18, 27.04], [103.32, 27.27], [103.48, 27.52], [103.64, 27.77], [103.83, 28.01], [104.04, 28.24], [104.26, 28.46], [104.43, 28.63], [104.54, 28.74], [104.6, 28.8], [105.4, 28.9], [106.55, 29.55], [107.4, 29.75], [108.4, 30.8], [109.5, 31.05], [110.4, 31.0], [111.3, 30.7], [112.2, 30.2], [112.9, 29.75], [113.1, 29.45], [113.8, 29.9], [114.3, 30.55], [115.0, 30.2], [116.0, 29.75], [117.05, 30.5], [117.8, 30.95], [118.35, 31.35], [118.72, 32.2], [119.45, 32.25], [120.3, 31.95], [121.0, 31.75], [121.9, 31.45]] },
  { name: '黄河', w: 0.11, pts: [[97.0, 34.6], [99.5, 35.6], [101.5, 36.0], [102.5, 36.05], [103.8, 36.1], [105.0, 37.3], [106.3, 38.5], [106.8, 39.4], [106.9, 40.2], [107.6, 40.85], [108.5, 40.75], [109.8, 40.55], [111.2, 40.3], [111.1, 39.4], [110.6, 38.0], [110.4, 37.0], [110.5, 35.6], [110.3, 34.65], [111.2, 34.85], [112.4, 34.95], [113.6, 34.95], [114.3, 35.3], [115.0, 35.75], [116.0, 36.45], [117.0, 37.15], [118.2, 37.6], [118.9, 37.75]] },
  { name: '汉水', w: 0.07, pts: [[106.2, 33.15], [107.03, 33.0], [108.0, 32.75], [109.0, 32.7], [110.3, 32.7], [111.5, 32.6], [112.15, 32.05], [112.55, 31.2], [112.9, 30.45], [113.6, 30.45], [114.3, 30.55]] },
  { name: '淮河', w: 0.07, pts: [[113.3, 32.45], [114.1, 32.3], [115.5, 32.5], [116.3, 32.45], [116.78, 32.65], [117.4, 32.92], [118.6, 33.3], [119.3, 33.8], [120.2, 34.2]] },
  { name: '渭水', w: 0.05, pts: [[104.6, 35.0], [105.7, 34.6], [107.1, 34.35], [108.0, 34.4], [108.9, 34.4], [109.6, 34.5], [110.3, 34.62]] },
  { name: '湘江', w: 0.06, pts: [[110.9, 25.7], [111.61, 26.25], [112.2, 26.6], [112.57, 26.9], [112.85, 27.4], [112.92, 27.85], [112.95, 28.2], [112.92, 28.8], [112.95, 29.2]] },
  { name: '珠江', w: 0.07, pts: [[105.0, 24.8], [106.6, 24.6], [108.3, 23.6], [109.6, 23.05], [110.5, 23.4], [111.3, 23.5], [112.5, 23.2], [113.27, 23.06], [113.6, 22.5]] },
  { name: '赣江', w: 0.05, pts: [[115.0, 25.9], [114.9, 27.0], [115.3, 28.0], [115.9, 28.7], [116.2, 29.0]] },
];
// Lakes: centre and radii in degrees.
export const LAKES = [
  { name: '洞庭湖', lon: 112.75, lat: 29.2, rx: 0.5, ry: 0.32 },
  { name: '鄱阳湖', lon: 116.25, lat: 29.05, rx: 0.28, ry: 0.5 },
  { name: '太湖', lon: 120.2, lat: 31.2, rx: 0.3, ry: 0.26 },
  { name: '巢湖', lon: 117.55, lat: 31.6, rx: 0.2, ry: 0.12 },
  { name: '青海湖', lon: 100.2, lat: 36.9, rx: 0.4, ry: 0.22 },
];
// Mountain ranges as ridge lines: h is the crest height above the plain (world units), r the half width in degrees.
export const RANGES = [
  { name: '秦岭', h: 1.2, r: 0.45, pts: [[104.5, 34.0], [106.5, 33.85], [108.5, 33.68], [110.5, 33.72], [111.6, 33.5]] },
  { name: '大巴山', h: 0.85, r: 0.5, pts: [[105.6, 32.4], [107.5, 32.0], [109.5, 31.75], [110.8, 31.55]] },
  { name: '巫山', h: 0.8, r: 0.4, pts: [[109.6, 30.6], [110.3, 31.2], [110.9, 31.0]] },
  { name: '太行山', h: 0.95, r: 0.42, pts: [[112.9, 35.2], [113.6, 36.2], [113.8, 37.5], [114.3, 38.8], [114.9, 39.7]] },
  { name: '吕梁山', h: 0.7, r: 0.4, pts: [[111.3, 36.0], [111.4, 37.4], [111.8, 38.7]] },
  { name: '燕山', h: 0.75, r: 0.42, pts: [[115.2, 40.6], [116.8, 40.5], [118.4, 40.4], [119.4, 40.2]] },
  { name: '阴山', h: 0.8, r: 0.45, pts: [[106.8, 41.2], [108.5, 41.4], [110.5, 41.1], [112.5, 41.0], [114.0, 41.3]] },
  { name: '贺兰山', h: 0.9, r: 0.3, pts: [[105.6, 38.0], [105.95, 38.9], [106.4, 39.6]] },
  { name: '祁连山', h: 1.5, r: 0.6, pts: [[97.0, 39.3], [99.0, 38.8], [100.8, 38.2], [102.3, 37.4], [103.2, 37.0]] },
  { name: '六盘山', h: 0.65, r: 0.3, pts: [[106.2, 35.4], [106.3, 36.4]] },
  { name: '泰山', h: 0.55, r: 0.35, pts: [[116.6, 36.0], [117.4, 36.3]] },
  { name: '大别山', h: 0.6, r: 0.4, pts: [[113.9, 31.7], [115.3, 31.3], [116.3, 30.9]] },
  { name: '武夷山', h: 0.8, r: 0.45, pts: [[116.3, 25.8], [117.4, 27.0], [118.4, 28.0]] },
  { name: '南岭', h: 0.75, r: 0.5, pts: [[109.8, 25.4], [111.5, 25.2], [113.2, 25.0], [114.8, 24.9]] },
  { name: '雪峰山', h: 0.65, r: 0.4, pts: [[110.2, 26.6], [110.6, 27.8], [111.3, 28.6]] },
  { name: '武陵山', h: 0.6, r: 0.45, pts: [[108.6, 27.6], [109.7, 28.6], [110.4, 29.4]] },
  { name: '横断山', h: 1.6, r: 0.7, pts: [[98.6, 30.5], [99.0, 28.4], [99.4, 26.5], [99.6, 25.9]] },
  { name: '龙门山', h: 1.1, r: 0.35, pts: [[103.0, 30.5], [103.9, 31.5], [104.9, 32.4]] },
  { name: '千山', h: 0.6, r: 0.45, pts: [[122.3, 39.8], [123.4, 40.6], [124.6, 41.6]] },
  { name: '长白山', h: 0.9, r: 0.6, pts: [[124.8, 41.4], [126.0, 42.2]] },
];

// ---------- Lookups ----------
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// A land test over any set of outlines (an overseas region's, src/regions/), the same rule as the mainland's.
export const landOf = (polys) => (lon, lat) => polys.some((p) => inPoly(lon, lat, p));
export const isLand = landOf(LAND);

// Closest point on a polyline: { d, t (0…1 along the whole line), side (+1 left of the flow, −1 right), px, py }.
const lengths = new WeakMap();
export function nearest(pts, x, y) {
  let best = { d: Infinity };
  let run = 0;
  if (!lengths.has(pts)) lengths.set(pts, pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0));
  const total = lengths.get(pts);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (L * L)));
    const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { d, t: (run + t * L) / total, side: Math.sign(dx * (y - ay) - dy * (x - ax)) || 1, px, py, nx: -dy / L, ny: dx / L };
    run += L;
  }
  return best;
}
const ridge = (pts, x, y) => nearest(pts, x, y).d;

// The sand table's town models by tier (tools/blender_sandtable.py SIZE): 都城 2.2, 州治大城 1.7, 关隘 1.6, 郡城 1.3
// board units (x 0.9 per degree of longitude, z 1 per degree of latitude).
const FOOT = { capital: 2.2, major: 1.7, pass: 1.6, county: 1.3 };
// Spreading: towns closer than half their two models plus `gap` push apart, none further than `reach` from its seat.
export const SPREAD = { gap: 0.65, reach: 0.5 };

// Seats as drawn: the true seat, moved just far enough off a river to stand clear on its own bank, then eased apart
// where the models and their name tags would crowd (兖州/豫州/徐州/扬州, the 湘江 three, 云南/永昌). Each stays on the
// side of every river its seat is on.
export function placeCities(sites, clear = 0.34) {
  const foot = (id) => FOOT[sites[id].tier] ?? FOOT.county;
  const sides = sites.map((s) => RIVERS.map((rv) => {
    const bank = s.bank;
    return bank && bank[0] === rv.name ? (bank[1] === 'left' ? 1 : -1) : nearest(rv.pts, s.lon, s.lat).side;
  }));
  const offRiver = (id, p) => RIVERS.forEach((rv, k) => {
    const n = nearest(rv.pts, p.lon, p.lat), need = rv.w + clear;
    if (n.d < need) { p.lon = n.px + n.nx * sides[id][k] * need; p.lat = n.py + n.ny * sides[id][k] * need; }
  });
  const base = sites.map((s, id) => { const p = { lon: s.lon, lat: s.lat }; offRiver(id, p); return p; });
  const P = base.map((p) => ({ ...p }));
  for (let it = 0; it < 160; it++) {
    for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
      const dx = (P[b].lon - P[a].lon) * 0.9, dz = P[b].lat - P[a].lat, d = Math.hypot(dx, dz) || 1e-6;
      const short = (foot(a) + foot(b)) / 2 + SPREAD.gap - d;
      if (short <= 0) continue;
      const k = short * 0.25 / d;
      P[a].lon -= dx * k / 0.9; P[a].lat -= dz * k; P[b].lon += dx * k / 0.9; P[b].lat += dz * k;
    }
    P.forEach((p, id) => {
      const ox = (p.lon - base[id].lon) * 0.9, oz = p.lat - base[id].lat, o = Math.hypot(ox, oz);
      if (o > SPREAD.reach) { p.lon = base[id].lon + ox / o * SPREAD.reach / 0.9; p.lat = base[id].lat + oz / o * SPREAD.reach; }
      offRiver(id, p);
      if (!isLand(p.lon, p.lat)) Object.assign(p, base[id]);
    });
  }
  return P.map((p, id) => ({ lon: p.lon, lat: p.lat, seat: sites[id].seat }));
}

// Mountain ranges' height above the plain (world units), smooth across each ridge's width.
export const ranges = (lon, lat) => rangesOf(RANGES)(lon, lat);
// The same for any list of ridge lines (an overseas region's).
export const rangesOf = (list) => (lon, lat) => {
  let h = 0;
  for (const R of list) { const d = ridge(R.pts, lon, lat); if (d < R.r) { const k = 1 - d / R.r; h = Math.max(h, R.h * k * k * (3 - 2 * k)); } }
  return h;
};
// Broad uplands: 青藏高原 west of the 龙门山/横断山 line and south of the 祁连山, the lower 黄土高原 and
// 云贵高原 tablelands, and the 四川盆地 dipping below its rim. Returns { tibet (0…1), h }.
export function plateaus(lon, lat) {
  const tibet = Math.min(1, Math.max(0, (102.6 - lon + (lat - 31) * 0.15) / 2.2)) * Math.min(1, Math.max(0, (37.6 - lat) / 1.2)) * Math.min(1, Math.max(0, (lat - 26.5) / 1.5));
  const loess = Math.max(0, 1 - Math.hypot((lon - 108.5) / 3.2, (lat - 37) / 1.6));
  const yungui = Math.max(0, 1 - Math.hypot((lon - 104.5) / 4.5, (lat - 25.6) / 1.7));
  const basin = Math.max(0, 1 - Math.hypot((lon - 105.4) / 2.0, (lat - 30.2) / 1.5));
  return { tibet, loess, h: tibet * 1.75 + loess * 0.32 + yungui * 0.42 - basin * 0.18 };
}
// Dry country: the 河套/戈壁 fringe and the 河西走廊.
export const aridity = (lon, lat) => Math.min(1, Math.max(0, (lat - 38.6) / 1.2) * Math.max(0, Math.min(1, (111.5 - lon) / 2)) + Math.max(0, (lat - 37.2) / 1.5) * Math.max(0, Math.min(1, (103.5 - lon) / 2)));
