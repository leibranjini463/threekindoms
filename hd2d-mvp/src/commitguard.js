// What counts as a new input for a step that commits an action (docs/战场操作与白兵入口优化方案_2026-11-10_D32.md §9).
// A step that asks for a commitment marks itself with stage(); an input then commits only if it began after that, so a
// double click, a held key, a press on the old screen released on the new one or a burst of clicks never runs on into it.
//
// Each device is judged its own way:
// - the mouse by the click count the browser gives (the second and later clicks of one multi-click never commit; how long
//   the system allows between them depends on the platform and the player's settings, and may well be over 300 ms), and by
//   whether the button went down after the stage came up;
// - a key by whether it went down after the stage came up (a key held from the step before, or its auto-repeat, never
//   commits); Enter and Space on a focused button arrive as a click with detail 0, so the click is matched to the key;
// - the pad by when its button was pressed (pad.js gives one press per push, app.js tells us here);
// - anything else (a script, a test driving the page) only by the short guard below.
// On top of all of them a short guard (GUARD ms from the stage) holds off quick clicks that are not one multi-click.
export const GUARD = 300;
const now = () => performance.now();
let stageAt = -Infinity, downAt = -Infinity, downCount = 0, padAt = -Infinity;
const keys = new Map(); // keys held now: key → when it went down
let lastUp = null; // the last key let go: { key, downAt, at } (Space presses a button on its keyup)

if (typeof addEventListener === 'function') {
  addEventListener('pointerdown', () => { downAt = now(); }, true);
  // The click count of the press under way: pointer events carry none, the mouse events that follow them do.
  addEventListener('mousedown', (e) => { downCount = e.detail; }, true);
  // A repeat keeps the press it repeats (one first seen repeating was held from before: never new); a press that is not a
  // repeat is new even if its keyup went missing (another window took it, a key-mapping tool), so a lost keyup never sticks.
  addEventListener('keydown', (e) => { keys.set(e.key, e.repeat ? keys.get(e.key) ?? -Infinity : now()); }, true);
  addEventListener('keyup', (e) => { lastUp = { key: e.key, downAt: keys.get(e.key) ?? -Infinity, at: now() }; keys.delete(e.key); }, true);
  // Back from another window: nothing is held any more, and the step asks again for a new input.
  addEventListener('blur', () => { keys.clear(); lastUp = null; downAt = -Infinity; stage(); });
}

// A step that asks for a commitment has just come up.
export function stage() { stageAt = now(); }
// The pad's button was pressed (app.js, before it acts on the press).
export function padPressed() { padAt = now(); }

// Where an input came from: an event (a click, a key, a pointer release on the map) or nothing (the pad, a script).
function source(e) {
  const t = now();
  if (e && e.type === 'keydown') return { kind: 'key', at: e.repeat ? -Infinity : keys.get(e.key) ?? -Infinity };
  if (e && (e.type === 'click' || e.type === 'pointerup' || e.type === 'mouseup')) {
    // A finger's release (the map's tap, src/app.js) comes before the mouse events the browser makes up for it, so downCount
    // there is still the tap before's: a quick second tap on a 计略 button would make the map's next tap a "double click"
    // and drop it (2026-11-17). A finger lifted is one tap; the short guard below still holds off a commit tapped too soon.
    const count = e.type === 'click' && e.detail ? e.detail : e.type === 'click' ? 0 : e.type === 'pointerup' && e.pointerType && e.pointerType !== 'mouse' ? 1 : downCount || 1;
    if (count) return { kind: 'mouse', count, at: downAt };
    // detail 0: Enter (pressed on its keydown) or Space (on its keyup) on a focused button, or the pad's button.click().
    if (keys.has('Enter')) return { kind: 'key', at: keys.get('Enter') };
    if (lastUp && lastUp.key === ' ' && t - lastUp.at < 50) return { kind: 'key', at: lastUp.downAt };
  }
  if (t - padAt < 50) return { kind: 'pad', at: padAt };
  return { kind: 'script', at: Infinity };
}

// Whether this input may commit the step on screen. `pick` (choosing, not committing) leaves out the short guard: only the
// held key, the second click of a multi-click and the press from before the stage are refused.
export function fresh(e, { pick = false } = {}) {
  const s = source(e);
  if (s.kind === 'mouse' && s.count >= 2) return false;
  if (s.at <= stageAt && s.kind !== 'script') return false;
  return pick || now() - stageAt >= GUARD;
}
// Whether a key is held now (the panel walks with a held arrow, but never commits on one).
export const held = (key) => keys.has(key);
