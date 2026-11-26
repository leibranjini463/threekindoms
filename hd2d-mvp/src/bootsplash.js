// Boot splash before the title: the 0-BIT 零元卡带 mark (after the user's reference, 2026-11-13) set to the sound the
// FC original plays under its Namcot logo, 98×3 (sfx-chime; boot.json frames 86–87, the title music 73 frames later).
// A gold cartridge has the dust blown off its contacts and is pushed into the slot; it seats and powers on exactly as the
// chime sounds, and the rest of the mark follows the sound's own shape:
//   onset (+0)        the cartridge seats: shake, a CRT flash, the contacts light outward from the middle, the label wakes
//   swell (+60–100 ms) the louder second part of the chime: the "0" lights up in the label
//   drop (+200 ms)    the chime falls to its ringing tail: the "0" starts to twist into ∞
//   tail end (+620 ms) the ring has died away: ∞ is closed, the two pixel hearts pop (silently)
// The glow under the cartridge follows the chime's measured loudness (ENV) so the light rings with the sound.
// The chime is scheduled on the audio context's clock and the picture runs off that same clock (as heard, after the output
// latency), so the seat lands on the sound on any machine; with no running context it runs on the wall clock in silence.
// On the web the context waits for a gesture: the splash then holds on its first picture with 「按任意键」, and that press
// also lets the title's music play at once. Once running, a click or key skips it.

const CUE = 0.8;                  // splash seconds at which the chime is heard
const FILE_ONSET = 0.017;         // where the sound starts inside sfx-chime.mp3 (the encoder's lead-in)
const LEAD = 0.06;                // scheduling margin on the audio clock
const FADE_OUT = CUE + 1.75, END = CUE + 2.1;
// sfx-chime.mp3 loudness from its onset, 20 ms steps, peak = 1 (RMS of the file).
const ENV = [0.79, 0.82, 0.82, 0.95, 1, 0.96, 0.88, 0.73, 0.72, 0.73, 0.36, 0.33, 0.35, 0.29, 0.27, 0.29, 0.26, 0.25, 0.22, 0.21, 0.22, 0.19, 0.15, 0.16, 0.16, 0.12, 0.12, 0.1, 0.09, 0.1, 0.04, 0.04, 0.04, 0.04];
const env = (k) => { if (k < 0) return 0; const i = k / 0.02, a = Math.floor(i); return a + 1 >= ENV.length ? 0 : ENV[a] + (ENV[a + 1] - ENV[a]) * (i - a); };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];

export function bootSplash({ audio }) {
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  const press = document.createElement('div'); press.className = 'boot-press'; press.textContent = '— 按任意键 —';
  const el = document.createElement('div'); el.className = 'boot'; el.append(cv, press);
  document.body.append(el);

  const dust = Array.from({ length: 34 }, (_, i) => ({
    x: -140 + (i / 34) * 280 + (Math.random() - 0.5) * 15, y: 88 + (Math.random() - 0.5) * 24,
    vx: 260 + Math.random() * 220, vy: -25 + (Math.random() - 0.5) * 65, size: 3 + (i % 3) * 2, delay: (i / 34) * 0.22,
  }));
  let W = 0, H = 0, t = 0, state = 'wait', clock = null, src = null, synth = false, skipAt = null, raf = 0, finish;
  const done = new Promise((r) => { finish = r; });

  // Seconds of the splash as heard: the output timestamp (what the speakers play now), else the context clock less its latency.
  const heard = () => {
    const c = audio.ctx;
    const ts = c.getOutputTimestamp?.();
    if (ts?.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return c.currentTime - (c.outputLatency || c.baseLatency || 0);
  };

  async function start() {
    if (state !== 'wait' && state !== 'held') return;
    state = 'starting'; press.classList.remove('on');
    const c = audio.ctx, live = c?.state === 'running';
    const buf = live ? await Promise.race([audio.preload('sfx-chime').catch(() => null), new Promise((r) => setTimeout(r, 1500))]) : null;
    if (state !== 'starting') return;
    if (buf && c.state === 'running') {
      const t0 = c.currentTime + LEAD;
      src = audio.sfxAt(buf, t0 + CUE - FILE_ONSET);
      clock = () => heard() - t0;
    } else {
      // No file (a build without the original audio) or no context: the stand-in tone at the seat, else silence.
      synth = live; const w0 = performance.now(); clock = () => (performance.now() - w0) / 1000;
    }
    state = 'run';
  }

  // Wait briefly for the context (it runs at once where autoplay is allowed, as on desktop), else hold for a gesture.
  audio.unlock();
  const since = performance.now();
  const waitCtx = () => {
    if (state !== 'wait') return;
    if (audio.ctx?.state === 'running') return void start();
    if (performance.now() - since > 400) { state = 'held'; press.classList.add('on'); return; }
    setTimeout(waitCtx, 30);
  };
  waitCtx();

  const onInput = (e) => {
    if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    e.stopPropagation(); if (e.type === 'keydown') e.preventDefault();
    if (state === 'held') {
      audio.unlock(); state = 'wait'; press.classList.remove('on');
      const from = performance.now();
      const go = () => (audio.ctx?.state === 'running' || performance.now() - from > 1000 ? start() : setTimeout(go, 20));
      go();
    } else if (state === 'run' && t > 0.25 && skipAt == null) {
      skipAt = t;
      if (t < CUE) { try { src?.stop(); } catch {} synth = false; }  // not heard yet: never sounds after the skip
    }
  };
  addEventListener('pointerdown', onInput, true); addEventListener('keydown', onInput, true);

  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('pointerdown', onInput, true); removeEventListener('keydown', onInput, true);
    el.remove(); finish();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (W !== innerWidth || H !== innerHeight) {
      W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    if (state === 'run') t = Math.max(t, clock());
    window.__bootSplash = { t, state, cue: CUE, onset: FILE_ONSET, heard: state === 'run' && src ? heard() : null };  // tools/boot_capture.mjs
    if (typeof window.__splashAt === 'number') t = window.__splashAt;  // tools/boot_capture.mjs pins the clock
    if (synth && t >= CUE) { synth = false; audio.sfx('sfx-chime'); }
    let alpha = clamp01(t / 0.25) * (1 - clamp01((t - FADE_OUT) / (END - FADE_OUT)));
    if (skipAt != null) alpha *= 1 - clamp01((t - skipAt) / 0.25);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(Math.min(t, END), alpha);
    if (typeof window.__splashAt !== 'number' && (t >= END || (skipAt != null && t - skipAt >= 0.25))) close();
  }
  raf = requestAnimationFrame(frame);

  // ---------- Drawing (CSS pixels; the mark is laid out around the centre and scaled to the window) ----------
  function render(t, alpha) {
    const cx = W / 2, cy = H / 2 - 22, k = t - CUE;
    ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    const bg = ctx.createRadialGradient(cx, cy, 30, cx, cy, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#18131e'); bg.addColorStop(0.55, '#0b090f'); bg.addColorStop(1, '#050407');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Pushed in with gathering speed, seated on the chime, a small rebound after.
    let cartY = -30;
    if (k >= 0) cartY = 4 - 3 * Math.sin(k * 38) * Math.exp(-k / 0.05);
    else if (t >= CUE - 0.24) cartY = -30 + 34 * ((t - (CUE - 0.24)) / 0.24) ** 3;
    let sx = 0, sy = 0;
    if (k >= 0 && k < 0.22) { const a = Math.exp(-k / 0.06); sx = Math.sin(k * 190) * 6 * a; sy = Math.cos(k * 230) * 5 * a; }
    const power = k < 0 ? 0 : 0.55 * clamp01(k / 0.05) + 0.6 * env(k);

    const scale = Math.max(0.4, Math.min(W / 560, H / 520, 1.6));
    ctx.save();
    ctx.translate(cx + sx, cy + sy); ctx.scale(scale, scale);
    if (power > 0) {
      const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 210 + 40 * env(k));
      g.addColorStop(0, `rgba(255,195,75,${0.3 * power})`); g.addColorStop(0.5, `rgba(235,94,40,${0.13 * power})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 260, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.translate(0, cartY); cartridge(t, k, power); ctx.restore();
    if (t >= 0.03 && t <= 0.6) blow(t, cartY);
    lettering(k);
    ctx.restore();

    // CRT lines, and the flash of the power coming on.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.5);
    if (k >= 0 && k < 0.3) {
      // Added light, warm at the cartridge and fading to the edges, so the dark brightens instead of greying over.
      const f = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6), a = Math.exp(-k / 0.06);
      f.addColorStop(0, `rgba(255,220,150,${0.34 * a})`); f.addColorStop(1, `rgba(255,170,90,${0.08 * a})`);
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  function cartridge(t, k, power) {
    const cw = 268, ch = 186, left = -cw / 2, top = -ch / 2 - 15, notch = 24;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
    ctx.beginPath();
    ctx.moveTo(left + notch, top); ctx.lineTo(left + cw - 12, top); ctx.quadraticCurveTo(left + cw, top, left + cw, top + 12);
    ctx.lineTo(left + cw, top + ch - 30); ctx.lineTo(left + cw - 18, top + ch - 30); ctx.lineTo(left + cw - 18, top + ch);
    ctx.lineTo(left + 18, top + ch); ctx.lineTo(left + 18, top + ch - 30); ctx.lineTo(left, top + ch - 30); ctx.lineTo(left, top + notch);
    ctx.closePath();
    const shell = ctx.createLinearGradient(0, top, 0, top + ch);
    shell.addColorStop(0, '#ffd466'); shell.addColorStop(0.55, '#f2a435'); shell.addColorStop(0.82, '#d86624'); shell.addColorStop(1, '#9c3216');
    ctx.fillStyle = shell; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#ffea9f'; ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#8d2d14';
    for (let i = 0; i < 4; i++) { const gy = top + 28 + i * 11; ctx.fillRect(left - 3, gy, 8, 5); ctx.fillRect(left + cw - 5, gy, 8, 5); }

    // The contacts light from the middle outward as the cartridge seats, then shimmer.
    const pins = 18, gap = (cw - 56) / pins;
    for (let i = 0; i < pins; i++) {
      const lit = k >= Math.abs(i - (pins - 1) / 2) / ((pins - 1) / 2) * 0.1;
      const wave = Math.sin(t * 14 - i * 0.45) * 0.5 + 0.5;
      ctx.fillStyle = lit ? `rgba(255,${210 + Math.floor(wave * 45)},${90 + Math.floor(wave * 110)},${Math.min(1, 0.55 + 0.45 * power)})` : '#5e2414';
      ctx.fillRect(left + 28 + i * gap, top + ch - 22, 6, 18);
    }

    const lw = cw - 44, lh = ch - 68, lx = -lw / 2, ly = top + 20;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, 8);
    ctx.fillStyle = '#120d17'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = k >= 0 ? '#57b8ff' : '#3a2b47'; ctx.stroke();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,196,86,0.06)'; ctx.lineWidth = 1;
    for (let gx = lx; gx < lx + lw; gx += 14) { ctx.beginPath(); ctx.moveTo(gx, ly); ctx.lineTo(gx, ly + lh); ctx.stroke(); }
    for (let gy = ly; gy < ly + lh; gy += 14) { ctx.beginPath(); ctx.moveTo(lx, gy); ctx.lineTo(lx + lw, gy); ctx.stroke(); }
    const my = ly + lh / 2;
    if (k >= 0) ribbon(0, my, t, k);
    for (const [at, dy, ph] of [[0.62, -38, Math.sin], [0.74, 38, Math.cos]]) {
      if (k < at) continue;
      heart(0, my + dy, easeOutBack(clamp01((k - at) / 0.24)) * (1 + ph(t * 10) * 0.06) * 2.3);
    }
    ctx.restore();
  }

  // The "0" (free) twisting into ∞ (a gift ribbon without end): three parallel neon strands and a light running round them.
  function ribbon(x0, y0, t, k) {
    const on = 0.35 + 0.65 * clamp01((k - 0.06) / 0.05), m = easeInOutCubic(clamp01((k - 0.2) / 0.42));
    const at = (th, off) => {
      const d = 1 + Math.sin(th) ** 2, span = 68 + off * 0.85;
      return [Math.sin(th) * (26 + off * 0.65) * (1 - m) + (span * Math.cos(th) / d) * m,
        -Math.cos(th) * (36 + off * 0.65) * (1 - m) + (span * 0.88 * Math.sin(th) * Math.cos(th) / d) * m];
    };
    ctx.save(); ctx.translate(x0, y0); ctx.globalAlpha *= on;
    [-5, 0, 5].forEach((off, i) => {
      ctx.beginPath();
      for (let s = 0; s <= 110; s++) { const [x, y] = at((s / 110) * Math.PI * 2, off); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath();
      ctx.shadowColor = '#ffae34'; ctx.shadowBlur = (i === 1 ? 14 : 6) * (1 + env(k));
      ctx.lineWidth = i === 1 ? 3.2 : 1.8; ctx.strokeStyle = i === 1 ? '#fff3c4' : '#f5a623'; ctx.stroke();
    });
    const [px, py] = at((t * 4.5) % (Math.PI * 2), 0);
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function heart(x, y, p) {
    ctx.save();
    ctx.translate(x - (7 * p) / 2, y - (6 * p) / 2);
    ctx.fillStyle = '#ff594f'; ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 8;
    HEART.forEach((row, r) => [...row].forEach((v, c) => { if (v === '1') ctx.fillRect(c * p, r * p, p + 0.4, p + 0.4); }));
    ctx.restore();
  }

  // Blowing the dust off the contacts before it goes in.
  function blow(t, cartY) {
    for (const p of dust) {
      const lt = t - 0.04 - p.delay;
      if (lt <= 0 || lt >= 0.36) continue;
      ctx.fillStyle = `rgba(255,240,200,${Math.sin((lt / 0.36) * Math.PI) * 0.85})`;
      ctx.fillRect(p.x + p.vx * lt, p.y + cartY + p.vy * lt, p.size, p.size);
    }
  }

  function lettering(k) {
    const a = clamp01((k - 0.35) / 0.4), b = clamp01((k - 0.6) / 0.4);
    if (a <= 0) return;
    const base = ctx.globalAlpha, y = 138;
    ctx.save(); ctx.textAlign = 'center';
    ctx.globalAlpha = base * a;
    ctx.font = '900 54px "Courier New", monospace'; ctx.letterSpacing = '4px';
    ctx.fillStyle = '#4a1b0d'; ctx.fillText('0-BIT', 3, y + 4);
    const g = ctx.createLinearGradient(0, y - 42, 0, y + 8);
    g.addColorStop(0, '#fff7d6'); g.addColorStop(0.55, '#f6b93b'); g.addColorStop(1, '#e55039');
    ctx.fillStyle = g; ctx.fillText('0-BIT', 0, y);
    if (b > 0) {
      ctx.globalAlpha = base * b;
      ctx.font = '600 16px "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.letterSpacing = '1.5px';
      ctx.fillStyle = '#dcd3c8'; ctx.fillText('零元卡带 / FREE CARTRIDGE PROJECT', 0, y + 34);
      ctx.font = '500 11px "Courier New", monospace'; ctx.fillStyle = 'rgba(245,185,66,0.72)';
      ctx.fillText('100% FREE GIFT · TRIBUTE TO JRPG & SLG CLASSICS', 0, y + 56);
    }
    ctx.restore();
  }

  return { el, done };
}
