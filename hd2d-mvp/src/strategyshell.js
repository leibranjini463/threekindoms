// The 战略地图 as app.js sees it: one object whichever map the 画质 has up (strategy.js in 3D, strategyflat.js in 2D), built when first
// asked for and kept, so `mode === strategy` holds through a switch and low quality never downloads the sand table.
// A Proxy, not a list of forwards: `mode.slide`, `mode.flat` and the like are tested for by app.js and must read as the current map's,
// absent on the 3D map included.
const OFF_SCREEN = { x: 2, y: 2 };

// flat, load3d: (ctx) => a promise of that map; ctx.month says which month is in play (none at boot).
// stage(swap, still): runs swap() when and how the screen allows, unless still() has stopped holding by then.
// onFail(kind): a map could not be had. fallback3d: a flat map with no picture gives way to the 3D one (else it only reports).
// home(): the city in play, none before a campaign: a map first up in a campaign opens on it, as begin() opens the one on screen.
export async function createStrategyShell({ flat, load3d, ctx, start = '3d', fallback3d = true, stage = (swap) => swap(), onFail = () => {}, home = () => null }) {
  const impl = { flat: null, '3d': null }, building = {}, failed = new Set(), played = new Set(); // played: on screen in this campaign, so its view is the player's
  const state = { refresh: null, selected: null, pick: [null, null], roads: false, territory: false };
  let now = start, asked = start, flatLost = false, booted = false;

  // The map out of sight says nothing to the UI: a 3D map being built opens on 季春 whatever month it is.
  const ctxFor = (kind) => ({ ...ctx, month: booted ? impl[now].month : undefined, onSeason: (m, instant) => { if (now === kind) ctx.onSeason?.(m, instant); }, onPicturesFailed: lost });
  const build = (kind) => (building[kind] ??= (kind === 'flat' ? flat : load3d)(ctxFor(kind)).then((m) => { impl[kind] = m; }).finally(() => { building[kind] = null; }));

  function lost() {
    if (!fallback3d) return onFail('flat');
    if (flatLost) return;
    flatLost = true; onFail('flat');
    if (booted && now === 'flat') use('3d');
  }

  function swap(kind) {
    const was = impl[now], next = impl[kind], { month } = was;
    if (!state.territory && next.territoryOn) next.territory(false); // do not rebuild a hidden overlay on refresh
    if (state.refresh) next.refresh(...state.refresh);
    next.setSeason(month, true);
    next.select(state.selected); next.pickMode(...state.pick);
    if (next.roadsOn !== state.roads) next.roads(state.roads);
    if (state.territory && !next.territoryOn) next.territory(true);
    if (state.selected != null) next.focusCity(state.selected);
    const city = home();
    if (city != null) {
      played.add(now);
      if (!played.has(kind)) { played.add(kind); next.resetView(city, { instant: true }); } // or it would still have the title's distance
    }
    was.hover(OFF_SCREEN);
    was.release?.();
    now = kind;
  }

  // The last call decides: a load that finishes after the player changed his mind stays built, unused. { cut }: the screen is already
  // dark (setMode, as the map comes back), so a map that is built goes up at once, without staging.
  async function use(kind, { cut = false } = {}) {
    if (kind === 'flat' && flatLost) kind = '3d';
    asked = kind;
    if (kind === now) return;
    if (failed.has(kind)) { asked = now; return; } // said once; retry() when the player asks again
    if (cut && impl[kind] && (impl[kind].up ?? true)) { swap(kind); return; }
    const still = () => asked === kind && now !== kind;
    try {
      if (!impl[kind]) await build(kind);
      // In the same tick as the build: each map's seasons write the shared uniforms as they are made, which the map on screen and the 白兵 and 单挑 scenes read.
      impl[kind].setSeason(impl[now].month, true);
      await impl[kind].ready?.();
    } catch (e) {
      console.warn(`战略地图: the ${kind} map did not load`, e);
      if (asked === kind) { asked = now; failed.add(kind); onFail(kind); }
      return;
    }
    if (kind === 'flat' && flatLost) { if (asked === kind) asked = now; if (now !== 'flat') impl.flat.release(); return; }
    if (still()) await stage(() => { if (still()) swap(kind); }, still);
    if (asked !== kind && now !== kind) impl[kind].release?.(); // he changed his mind: a map brought back for nothing lets go again
  }

  try { await build(start); } catch (e) { console.warn(`战略地图: the ${start} map did not load`, e); if (start === 'flat') flatLost = true; failed.add(start); onFail(start); }
  if (!impl[start] || (start === 'flat' && flatLost)) {
    const other = start === 'flat' ? '3d' : 'flat';
    now = asked = other;
    try { await build(other); } catch (e) { if (!impl[start]) throw e; now = asked = start; }
  }
  if (flatLost && now !== 'flat') impl.flat?.release();
  booted = true;

  const own = {
    use,
    retry() { failed.clear(); }, // a map that would not load gets another try: the player has changed the setting
    get kind() { return now; },
    get has3d() { return !!impl['3d']; },
    built: (kind) => !!impl[kind],
    debugMap: (kind) => impl[kind], // tests: a map that is not the one on screen
    // What a new map must be told on a switch; the rest it can be asked of the map on screen.
    refresh(...a) { state.refresh = a; return impl[now].refresh(...a); },
    select(cid) { state.selected = cid; return impl[now].select(cid); },
    pickMode(cids, from = null) { state.pick = [cids, from]; return impl[now].pickMode(cids, from); },
    roads(on) { state.roads = on; return impl[now].roads(on); },
    territory(on) { state.territory = !!on; return impl[now].territory(state.territory); },
  };
  return new Proxy(own, { get: (t, k) => (k in t ? t[k] : impl[now][k]) });
}
