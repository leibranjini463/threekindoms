// Frame-rate cap (系统 → 帧率), remembered across sessions (feedback F01, 2026-11-02: a 120 Hz Mac drew 80 W rendering
// every refresh). 60 by default; 不限 draws on every display refresh as before. Animation and input go by real time
// (each loop measures its own dt), so the cap changes how often a frame is drawn, never how fast anything moves.
const KEY = 'hd2d-fps';
const store = (v) => { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch {} return null; };
const CAPS = { 60: '60', off: '不限' };
let cap = CAPS[store()] ? store() : '60';

export const frameCap = {
  get value() { return cap; },
  get label() { return CAPS[cap]; },
  toggle() { cap = cap === '60' ? 'off' : '60'; store(cap); },
};

// One per loop: due(t) says whether the frame at rAF time t (ms) should be drawn. `hz` overrides the cap (a hidden window).
// The 1 ms slack keeps a 60 Hz display on every refresh; a 120 Hz one draws every other, a 144 Hz one about 60 a second.
export function pacer() {
  let next = 0;
  return (t, hz = cap === 'off' ? 0 : 60) => {
    if (!hz) return true;
    if (t < next - 1) return false;
    next += 1000 / hz;
    if (next < t) next = t + 1000 / hz; // after a stall (or a slower rate) count from now, not catch up
    return true;
  };
}
