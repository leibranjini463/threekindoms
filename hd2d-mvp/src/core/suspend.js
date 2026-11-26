// 战场中断 (not in the original, whose record is kept from the city menu only): a war can be broken off on the player's own
// turn and taken up again later, from the title. It is not a record: one place apart from the eight slots, no 命令书, and it
// is taken out as it is read, so a battle resumes exactly once and cannot be replayed from the same point. The seed goes with
// it unchanged (records draw a fresh one on load, game.js reseed): continuing is the same battle as never having stopped.
//
// The record: { version, savedAt, g, war, side, start, after, yaw, field } (yaw: which way the war map faced). `after` says what follows the settled war: the
// player's own turn ({ kind: 'att' }), or the rest of the attacking AI's turn ({ kind: 'def', faction, pts }: ai.js aiDomestic).
import { upgrade, registerClones, SAVE_VERSION, data } from './game.js';

// A data pack's suspended war is kept under its own key (`haou-hd2d-suspend@<pack>`), as its records are (game.js).
export const SUSPEND_KEY = 'haou-hd2d-suspend';
const key = () => (data()?.pack ? `${SUSPEND_KEY}@${data().pack.id}` : SUSPEND_KEY);
export const SUSPEND_VERSION = 1;

// Coordinate a confirmed discard with another tab's suspend/continue operation. Browsers without Web
// Locks can coordinate with one another using an IndexedDB read-write transaction. Callbacks must be
// synchronous, so the transaction cannot end between the check and the localStorage update.
export async function withSuspendLock(fn, { legacyFallback = false } = {}) {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
    try { return await locks.request(key(), { signal: abort.signal }, fn); }
    catch { return 'failed'; }
    finally { clearTimeout(timer); }
  }
  // Before locks were added, ordinary suspend/continue only needed localStorage. Preserve that behavior
  // when neither locking API is available; new quick-load discards do not opt in to this fallback.
  const fallback = () => { if (!legacyFallback) return 'failed'; try { return fn(); } catch { return 'failed'; } };
  return new Promise((resolve) => {
    let db = null, tx = null, done = false, ran = false, value = 'failed';
    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); db?.close(); resolve(result); };
    // LocalStorage writes are not part of the IDB transaction. If the synchronous callback already ran,
    // an ensuing IDB abort must return its real result rather than claim that the mutation did not happen.
    const timer = setTimeout(() => { try { tx?.abort(); } catch {} finish(ran ? value : 'failed'); }, 5000);
    try {
      if (!globalThis.indexedDB) return finish(fallback());
      const request = indexedDB.open('haou-hd2d-suspend-lock', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('lock');
      request.onerror = () => { if (!done) finish(fallback()); };
      request.onsuccess = () => {
        if (done) { request.result.close(); return; }
        db = request.result;
        try {
          tx = db.transaction('lock', 'readwrite');
          tx.oncomplete = () => finish(value);
          tx.onabort = tx.onerror = () => finish(ran ? value : 'failed');
          const read = tx.objectStore('lock').get(key());
          read.onsuccess = () => {
            if (done) return;
            try {
              value = fn();
              if (value && typeof value.then === 'function') tx.abort();
              else ran = true;
            } catch { tx.abort(); }
          };
        } catch { finish(tx ? 'failed' : fallback()); }
      };
    } catch { finish(fallback()); }
  });
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
function valid(rec) {
  if (!rec || typeof rec !== 'object' || rec.version !== SUSPEND_VERSION) return null;
  if (!rec.war || !rec.field || !Array.isArray(rec.field.units) || !['att', 'def'].includes(rec.side) || !rec.after) return null;
  return upgrade(rec.g) ? rec : null;
}

// Write the suspension (true when it is stored). The parts are copied as JSON, so the running game is not touched.
export function suspend(g, war, field, { side, start, after, yaw = null }) {
  try {
    const rec = { version: SUSPEND_VERSION, savedAt: Date.now(), g: { ...g, version: SAVE_VERSION }, war, side, start, after, yaw, field: field.snapshot() };
    const text = JSON.stringify(rec);
    if (!valid(parse(text))) return false;
    localStorage.setItem(key(), text);
    return true;
  } catch { return false; }
}
// The stored suspension, left in place (the title's 继续战斗 line); null when there is none or it no longer reads.
export function peekSuspend() { try { return valid(parse(localStorage.getItem(key()))); } catch { return null; } }
// Take it out to resume: read, removed, its 阿会喃 copies registered. A record that no longer reads is removed too.
export function takeSuspend() {
  const rec = peekSuspend();
  dropSuspend();
  if (rec) registerClones(rec.g);
  return rec;
}
export function dropSuspend() { try { localStorage.removeItem(key()); } catch {} }
