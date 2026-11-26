// Switches remembered across restarts, in localStorage beside the records. A browser that blocks storage (a private
// window) keeps nothing, and the game runs on its defaults (素月墨羽小尘尘@bilibili, 2026-11-17: HD-2D 关 came back 开 on every start).
export const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
// An on/off switch: '1' / '0', or `dflt` when it was never set.
export const readFlag = (k, dflt = false) => { const v = readPref(k); return v === '1' ? true : v === '0' ? false : dflt; };
export const writeFlag = (k, on) => writePref(k, on ? '1' : '0');

export const PREF = {
  hd2d: 'hd2d-post', // 系统 → HD-2D (and H)
  roads: 'hd2d-roads', // 战略地图: 道路总览 (and G)
  territory: 'hd2d-territory', // 战略地图: 势力范围
  logFold: 'hd2d-log-fold', // 战略地图: the log box folded to its newest line
  threat: 'hd2d-threat', // 战场: 敌军威胁范围, pinned (and the pad's Y)
  warRoster: 'hd2d-war-roster', // 战场: 我军武将点将栏展开／收起（N）
  setup: 'hd2d-setup-options', // the new-game screen's rule switches, as last left: a JSON object of booleans
};
