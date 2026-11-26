// Play pace. At 原版 (1×) each part of play stays on screen as long as in the 1992 FC original, measured
// from its natural runs (docs/游玩节奏计时对照_2026-10-29.md, analysis/pacing-original.json); 快速 and
// 最快 divide those lengths. Only presentation waits read this: rules, dice and the player's own
// decision windows never do.
export const ORIGINAL = {
  aiTurn: 1500,         // one AI faction's turn on the strategy map: 90 frames of 「××军　战略中」
  aiWar: 7090,          // an AI-vs-AI war: 「××军　出阵」, three 142-frame beats
  disaster: 4760,       // 洪水 / 旱灾: 286 frames, whoever it strikes
  notice: 4000,         // 君主战死 / 势力灭亡 / 继位: 240 frames, then the window closes by itself
  strategy: 3480,       // a 计略 on the war map, 209 frames in all:
  strategyCast: 1410,   //   the cast animation and its phrase (state 8/9, 85 frames)
  strategyShow: 2800,   //   not the original's: the painted 计略 storyboard takes this in place of the cast (user's call, 2026-11-07)
  strategyResult: 1580, //   the window telling what it did, closing by itself (8/11, a fixed 95 frames); the board has the rest
  command: 2130,        // a 命令书 command's confirm: the counter blinks 128 frames and drops at frame 64 (bank 28 $D5BD)
  commandScene: 4240,   //   then its picture plays 255 frames (bank 30 $C934) and waits for A / B (bank 27 $ACB8)
  typeChar: 66.6,       // text types one character every 4 frames (bank 29 $A048)
  move: 170,           // one AI step on the war map: 10 frames a cell, one unit after another
  skirmishRound: 8000,  // one 白兵 round: 480 frames (张飞 700 vs 文丑 800, both sides on automatic orders)
  skirmishAct: 620,     //   one act in it: those 480 frames over the 12.9 acts (moves, attacks) such a round plays (rounds 3–8, 200 runs of src/core)
};

export const PACES = [[1, '原版'], [2, '快速'], [4, '最快']];
let speed = (() => { try { return Number(localStorage.getItem('hd2d-pace')) || 1; } catch { return 1; } })();
if (!PACES.some(([v]) => v === speed)) speed = 1;
const subs = new Set();
export const paceSpeed = () => speed;
export const paceLabel = () => PACES.find(([v]) => v === speed)[1];
export function setPace(v) { speed = v; try { localStorage.setItem('hd2d-pace', String(v)); } catch {} subs.forEach((f) => f(v)); }
export const onPace = (f) => (subs.add(f), () => subs.delete(f));
export const paced = (ms) => ms / speed;

// A key belongs to the player's own input while a window is open (人物志, a message) or a text field has focus;
// presentation waits that skip on Enter / Space leave it alone then. A button left focused by the click that
// started the wait (结束回合) does not count: the wait takes the key, so it does not press that button again.
export const keyTaken = (e) => !!(document.querySelector('[role=dialog]') || e.target?.closest?.('input, select, textarea'));

// Waits a presentation beat of `ms` at 1× (scaled by the pace). Enter, Space or a click on `el` ends it early;
// so does `until()` turning true. Resolves true when it ran to the end. The keys stay with any open window
// (人物志, a message) or focused control, so the beat never takes the player's own input.
export function hold(ms, { el = null, until = null } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now(), len = paced(ms);
    let done = false;
    const end = (full) => { if (done) return; done = true; clearInterval(tick); removeEventListener('keydown', key, true); el?.removeEventListener('click', click); resolve(full); };
    const key = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (keyTaken(e)) return;
      e.preventDefault(); e.stopPropagation(); end(false);
    };
    const click = () => end(false);
    const tick = setInterval(() => { if (until?.()) end(false); else if (performance.now() - t0 >= len) end(true); }, 30);
    addEventListener('keydown', key, true); el?.addEventListener('click', click);
  });
}
