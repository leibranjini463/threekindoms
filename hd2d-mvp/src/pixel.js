// Procedural placeholder pixel art. Every texture is a tiny canvas drawn with NearestFilter, so the
// whole MVP renders without any external art. Final art replaces these via assets/manifest.json.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function canvasTex(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  // Crisp texels up close; trilinear mips when a texel shrinks below a pixel, so distant ground stops
  // sparkling as the camera moves (nearest-mip sampling was the main source of the "sand" look).
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.userData.canvas = c;
  return t;
}

// 16x16 tile filled with a base colour and speckles from a small palette. Speckles come in 2×2 clumps
// (a few stray single texels kept for texture) and are pulled toward the base colour, so the ground
// reads as calm pixel-art patches rather than per-texel noise.
const mixHex = (a, b, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
function speckle(base, dots, seed, density = 0.35) {
  const soft = dots.map((d) => mixHex(d, base, 0.4));
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (r() < density * 0.55) {
        g.fillStyle = soft[(r() * soft.length) | 0];
        const k = r(); g.fillRect(x, y, k < 0.5 ? 2 : 1 + (k * 4 & 1), k < 0.75 ? 2 : 1);
      } else if (r() < density * 0.15) { g.fillStyle = soft[(r() * soft.length) | 0]; g.fillRect(x + (r() * 2 | 0), y + (r() * 2 | 0), 1, 1); }
    }
  };
}

const SIDE = (top, dark) => (g, w, h) => {
  speckle(dark, ['#5a3b22', '#3f2a18', '#6b4a2c'], 7, 0.45)(g, w, h);
  g.fillStyle = top; g.fillRect(0, 0, w, 3);
  g.fillStyle = '#00000033'; g.fillRect(0, 3, w, 1);
};

// Terrain index: 林0 沙1 平2 河3 山4 城5 (research/war-maps-jp.json terrain_names)
export function terrainTextures() {
  const T = {};
  T.grassTop = canvasTex(16, 16, speckle('#5f9e3a', ['#78b84a', '#4d8530', '#8cc95a', '#4a7d2e'], 11));
  T.grassSide = canvasTex(16, 16, SIDE('#5f9e3a', '#7a5534'));
  T.forestTop = canvasTex(16, 16, speckle('#3f7a2e', ['#2f6224', '#4f8f38', '#2a5420'], 12));
  T.sandTop = canvasTex(16, 16, speckle('#d8b56a', ['#e8c97e', '#c29d55', '#f0d898'], 13));
  T.sandSide = canvasTex(16, 16, SIDE('#d8b56a', '#a07a44'));
  T.rockTop = canvasTex(16, 16, speckle('#8a8478', ['#a39c8e', '#6f695e', '#5d584f', '#b5ae9f'], 14, 0.5));
  T.rockSide = canvasTex(16, 16, (g, w, h) => {
    speckle('#77705f', ['#5d584f', '#8f8877', '#4c483f'], 15, 0.5)(g, w, h);
    g.fillStyle = '#4c483f';
    for (let y = 4; y < h; y += 5) g.fillRect(0, y, w, 1);
  });
  T.snowTop = canvasTex(16, 16, speckle('#e9eef2', ['#ffffff', '#cfd8df', '#dbe4ea'], 16));
  T.bedTop = canvasTex(16, 16, speckle('#6d5a3e', ['#5a4a32', '#7d6a4b'], 17));
  T.water = canvasTex(16, 16, (g, w, h) => {
    g.fillStyle = '#2f7fc1'; g.fillRect(0, 0, w, h);
    const r = rng(18);
    for (let i = 0; i < 9; i++) {
      const x = (r() * w) | 0, y = (r() * h) | 0;
      g.fillStyle = r() < 0.5 ? '#6cc0f0' : '#bfe8ff'; g.fillRect(x, y, 3, 1);
    }
    g.fillStyle = '#25679f';
    for (let i = 0; i < 12; i++) g.fillRect((r() * w) | 0, (r() * h) | 0, 2, 1);
  }, { repeat: true });
  T.stoneTop = canvasTex(16, 16, (g, w, h) => {
    g.fillStyle = '#b9ad94'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8f846d';
    for (let y = 0; y < h; y += 4) { g.fillRect(0, y, w, 1); for (let x = (y / 4) % 2 ? 0 : 4; x < w; x += 8) g.fillRect(x, y, 1, 4); }
  });
  T.wall = canvasTex(16, 16, (g, w, h) => {
    g.fillStyle = '#a89a7c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7c705a';
    for (let y = 0; y < h; y += 4) { g.fillRect(0, y, w, 1); for (let x = (y / 4) % 2 ? 2 : 6; x < w; x += 8) g.fillRect(x, y, 1, 4); }
    g.fillStyle = '#5f5544'; g.fillRect(0, h - 2, w, 2);
  });
  T.roofTile = canvasTex(16, 16, (g, w, h) => {
    g.fillStyle = '#3f5b78'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2c4158';
    for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#5b7a98';
    for (let y = 2; y < h; y += 5) g.fillRect(0, y, w, 1);
  });
  T.roofRed = canvasTex(16, 16, (g, w, h) => {
    g.fillStyle = '#8c3a2a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6a2a1e'; for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
    g.fillStyle = '#b0503a'; for (let y = 2; y < h; y += 5) g.fillRect(0, y, w, 1);
  });
  T.plaster = canvasTex(16, 16, (g, w, h) => {
    speckle('#e6dcc4', ['#d6cab0', '#efe6d2'], 21, 0.3)(g, w, h);
    g.fillStyle = '#6a4a2e'; g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h); g.fillRect(0, h - 1, w, 1);
    g.fillStyle = '#3a2a1c'; g.fillRect(6, 8, 4, 8);
  });
  return T;
}

// ASCII sprite → canvas texture. Palette keys map to colours; '.' is transparent.
export function asciiTex(rows, pal, scale = 1) {
  const h = rows.length, w = rows[0].length;
  return canvasTex(w * scale, h * scale, (g) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = rows[y][x];
      if (k === '.' || !pal[k]) continue;
      g.fillStyle = pal[k]; g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
}

const GENERAL = [
  '..........RR............',
  '.........RRRR...........',
  '..........HH........W...',
  '.........HSSE.......W...',
  '.........AAAA......W....',
  '........AAAAAA....W.....',
  '.......CAAAAAAA..W......',
  '.......CAAGAAAA.W.....MK',
  '........AAAAAA.W.....MKK',
  '........LAAAAL.....MKKKE',
  '....KKKKKKKKKKKKKKKKKKK.',
  '..KKKKKKKKKKKKKKKKKKKK..',
  '.KTKKKKKKKKKKKKKKKKKK...',
  'KT..KKKKKKKKKKKKKKKK....',
  'T...KKBKKKKKKKKKKBKK....',
  '....KK..........KK......',
  '....KK..........KK......',
  '...KK............KK.....',
  '...DD............DD.....',
];
const SOLDIER = [
  '....HH......',
  '...HHHH...W.',
  '....SE....W.',
  '...AAAA...W.',
  '..AAAAAA..W.',
  '..AGAAAAA.W.',
  '...AAAA...W.',
  '...AAAA.....',
  '...L..L.....',
  '...L..L.....',
  '..DD..DD....',
];
export const SIDE_COLORS = {
  attacker: { A: '#2f5fb8', C: '#1d3f80', R: '#e8e8f0', banner: '#2f5fb8' },
  defender: { A: '#b83a2f', C: '#80241d', R: '#f0d040', banner: '#c0392b' },
};
export function unitTex(side, kind = 'general') {
  const c = SIDE_COLORS[side];
  const pal = { R: c.R, H: '#5a5a66', S: '#f0c8a0', E: '#2a1a10', A: c.A, C: c.C, G: '#f0d040', L: '#3a2a1c',
    W: '#d8d8e0', K: '#7a4a28', M: '#2a1a10', T: '#2a1a10', B: '#5a3418', D: '#2a1a10' };
  return asciiTex(kind === 'general' ? GENERAL : SOLDIER, pal);
}

export function bannerTex(side, ch) {
  return canvasTex(32, 40, (g, w, h) => {
    g.fillStyle = SIDE_COLORS[side].banner; g.fillRect(2, 2, w - 4, h - 10);
    g.fillStyle = '#00000040'; g.fillRect(w - 6, 2, 4, h - 10);
    g.fillStyle = '#f5e6b8'; g.fillRect(2, h - 8, w - 4, 2);
    g.fillStyle = '#ffffff'; g.font = 'bold 22px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, w / 2, (h - 8) / 2 + 1);
  });
}

export function treeTex(seed) {
  return canvasTex(16, 24, (g) => {
    const r = rng(seed);
    g.fillStyle = '#4a3020'; g.fillRect(7, 15, 2, 9);
    const blobs = [[8, 8, 7], [5, 11, 4], [11, 11, 4], [8, 4, 4]];
    for (const [cx, cy, rad] of blobs) for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y > rad * rad) continue;
      const shade = (x + y) / rad;
      g.fillStyle = shade < -0.6 ? '#8ccf5a' : shade < 0.2 ? (r() < 0.2 ? '#5aa53a' : '#3f8a30') : '#2a6224';
      g.fillRect(cx + x, cy + y, 1, 1);
    }
  });
}

export function sparkTex() {
  return canvasTex(4, 4, (g) => { g.fillStyle = '#fff6c0'; g.fillRect(1, 0, 2, 4); g.fillRect(0, 1, 4, 2); });
}
