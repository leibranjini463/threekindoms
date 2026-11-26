// The month's weather over a 2D map's whole view (seasonenv.js: rain with thunder, snowfall, petals, falling leaves): screen-space
// particles, a fixed set per kind, as many shown as the month's level asks. The war's painted map (warmap2d.js) and the low-quality 战略地图 (strategyflat.js).
import { rng } from './pixel.js';

export function createSky2d() {
  const drift = Object.fromEntries(['rain', 'snowfall', 'petals', 'fall'].map((k, j) => {
    const r = rng(41 + j); return [k, Array.from({ length: k === 'rain' ? 520 : k === 'snowfall' ? 300 : 110 }, () => ({ x: r(), y: r(), z: 0.5 + r() * 0.5, p: r() * 100 }))];
  }));
  let bolt = 0, boltIn = 4;
  // cell: the map's cell in px, which scales the flakes, petals and leaves. light: the war's painted map, read cell by cell for
  // minutes on end, draws less rain, no grey wash and a soft flash (jason at depot heights@小红书, 2026-11-13); the level w is the month's.
  function draw(g, w, { width: vw, height: vh, cell: c, time, dt, light = false }) {
    if (w.rain > 0.05) {
      g.fillStyle = `rgba(24, 32, 48, ${(light ? 0.05 : 0.16) * w.rain})`; g.fillRect(0, 0, vw, vh);
      g.strokeStyle = `rgba(214, 226, 240, ${(0.3 + 0.25 * w.rain) * (light ? 0.45 : 1)})`; g.lineWidth = light ? 1 : 1.2; g.beginPath();
      const n = Math.round(drift.rain.length * Math.min(1, w.rain) * (light ? 0.45 : 1)), len = (18 + 12 * w.rain) * (light ? 0.65 : 1);
      for (let i = 0; i < n; i++) {
        const d = drift.rain[i], y = ((d.y + time * (1.6 + d.z)) % 1) * (vh + len) - len, x = ((d.x + time * 0.12) % 1) * (vw + 40) - 20 - y * 0.12;
        g.moveTo(x, y); g.lineTo(x - len * 0.2 * d.z, y - len * d.z);
      }
      g.stroke();
    }
    for (const [k, cols, fall, sway, size] of [['snowfall', ['#ffffff', '#eef3ff'], 0.07, 0.012, 3.4], ['petals', ['#ffd6e0', '#ffc2d2', '#fff4f6', '#f8a8be'], 0.06, 0.03, 4.6], ['fall', ['#e0782a', '#c8401e', '#f0b23c', '#b05a1e'], 0.07, 0.03, 5]]) {
      const n = Math.round(drift[k].length * Math.min(1, w[k] ?? 0));
      for (let i = 0; i < n; i++) {
        const d = drift[k][i], y = ((d.y + time * fall * d.z) % 1) * (vh + 20) - 10;
        const x = ((d.x + time * 0.02 + Math.sin(time * 0.9 + d.p) * sway) % 1 + 1) % 1 * vw, r = size * d.z * (Math.max(0.8, c / 48));
        g.globalAlpha = 0.55 + 0.45 * d.z; g.fillStyle = cols[i % cols.length];
        if (k === 'snowfall') { g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.fill(); }
        else { g.save(); g.translate(x, y); g.rotate(time * 2 + d.p); g.scale(1, Math.abs(Math.sin(time * 3 + d.p)) * 0.7 + 0.3); g.beginPath(); g.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
      }
      g.globalAlpha = 1;
    }
    // Thunder: now and then a pale flash over the field, fading in a moment.
    if (w.thunder > 0.05) { boltIn -= dt * w.thunder; if (boltIn <= 0) { bolt = 1; boltIn = 5 + Math.random() * 9; } }
    if (bolt > 0.01) { g.fillStyle = `rgba(232, 238, 255, ${(light ? 0.14 : 0.35) * bolt * (0.6 + 0.4 * Math.sin(time * 60))})`; g.fillRect(0, 0, vw, vh); bolt *= Math.exp(-dt * 7); }
  }
  return { draw };
}
