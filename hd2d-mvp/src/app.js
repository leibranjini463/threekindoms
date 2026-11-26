// Game shell: renderer and screens (title → setup → strategy ⇄ war ⇄ cut-in), the HUD, and the
// io bridge the rules core (core/game.js run loop) calls for events, AI turns, wars and the player turn.
// lang.js first: in 繁體 it patches the page's text sinks before any module below writes to them.
import { zh, toHans, lang, savedLang, setLang, LANGS, rawText } from './lang.js';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { terrainTextures } from './pixel.js';
import { createPost } from './post.js';
import { createQuality, savedQuality, warView } from './quality.js';
import { frameCap, pacer } from './framecap.js';
import { loadManifest, loadPixelTexture, equipIcon } from './assets.js';
import { Audio } from './audio.js';
import { playVignette, sceneFor, cueFor, sceneFrame, vignettesOn, setVignettes, recordText } from './vignette.js';
import { playUnification, playFall } from './ending.js';
import { createStrategy, colorOf } from './strategy.js';
import { createStrategyFlat } from './strategyflat.js';
import { createStrategyShell } from './strategyshell.js';
import { loadSandtable } from './sandtable.js';
import { createTitle } from './titlescreen.js';
import { bootSplash } from './bootsplash.js';
import { createTacticalView } from './tacticalview.js';
import { createDuelView } from './duelview.js';
import { runTactical, resetFormations } from './tacticalhud.js';
import { createWarView } from './warview.js';
import { createWarNav } from './warnav.js';
import { createWarRoster } from './warroster.js';
import { loadWarGround } from './warplate.js';
import { FLAT_INSET } from './warmap2d.js';
import { PHONE, hint } from './phone.js';
import { unitCard } from './warcard.js';
import * as G from './core/game.js';
import { genericArt } from './core/pack.js';
import * as B from './core/batch.js';
import { aiTurn, aiDomestic } from './core/ai.js';
import { suspend, peekSuspend, takeSuspend, dropSuspend, withSuspendLock } from './core/suspend.js';
import { warFate } from './warreport.js';
import { setupWar, occupyEmpty, resolveWar, loserQueue, winnerQueue, retreatOptions } from './core/warcore.js';
import { Field, STRAT_INFO } from './core/field.js';
import { $, $$, keyName, h, pressable, clear, root, layer, modal, message, toast, banner, officerRow, officerTable, pickOfficers, sliders, confirmBox, face, avatar, figure, setHalfbody, portrait, setPortraits, setFaces, blocking } from './ui.js';
import { MONTH_NAMES, SEASON_OF, WEATHER_OF } from './seasons.js';
import { ORIGINAL, PACES, paceSpeed, paceLabel, setPace, paced, hold } from './pace.js';
import { shakeLevel, setShakeLevel, onShake } from './fx.js';
import { labelSizeText, cycleLabelSize } from './labelsize.js';
import { uiSizeOn, uiSizeLabel, uiSizeNote, onUiZoom, cycleUiSize } from './uiscale.js';
import { RECORD_ACTIONS, recordAction, recordKey, configureRecordButton, resetRecordButtons } from './padrecords.js';
import { controls, quickSaveKey } from './controls.js';
import { createPad, sendKey, walk, focusFirst, firstIn, focusables, isControl, shown, glyphOf } from './pad.js';
import { fresh as freshInput, padPressed, GUARD } from './commitguard.js';
import { PREF, readFlag, writeFlag, readPref, writePref } from './prefs.js';

const { name, cityName, NONE } = G;
const factionName = (f) => G.factionName(g, f);
// Everything the title waits for is asked for at once; each optional list fails on its own (an empty list), as when they were
// fetched one after another, and is applied in the same order (the portrait list over the manifest's).
const json = (url) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
const optional = (p) => p.catch(() => null);
// The data pack in play (core/pack.js, ?pack= or the title screen's choice): { pack, errors }, errors when it would not load.
let packLoad = null;
const [D, files, portraitList, faceList, halfbodyList, titleArt, officerList, duelList, marchList, troopList] = await Promise.all([
  G.loadWithPack().then((r) => { packLoad = r; return G.data(); }), loadManifest(),
  optional(json('assets/ai/portraits/index.json')), optional(json('assets/ai/faces/index.json')), optional(json('assets/ai/halfbody/index.json')),
  fetch('assets/ai/title.webp', { method: 'HEAD' }).then((r) => r.ok, () => false),
  optional(json('assets/ai/sprites/officers/index.json')), optional(json('assets/ai/sprites/duel/index.json')),
  optional(json('assets/ai/sprites/march/index.json')), optional(json('assets/ai/sprites/troops/index.json')),
]);
try { for (const id of portraitList) files.portraits[id] = `assets/ai/portraits/${id}.webp`; } catch {}
setPortraits(files.portraits);
// Expression busts, listed as "<id>-<mood>"; officers without them fall back to the original pixel expressions.
try { const faces = {}; for (const k of faceList) { const [id, mood] = k.split('-'); (faces[id] ||= {})[mood] = `assets/ai/faces/${k}.webp`; } setFaces(faces); } catch {}
// Standard waist-up portraits (tools/build_halfbody.py), for the large slots; listed by officer id.
try { const hb = {}; for (const id of halfbodyList) hb[id] = `assets/ai/halfbody/${id}.webp`; setHalfbody(hb); } catch {}
if (titleArt) files.titleArt = 'assets/ai/title.webp';
const T = terrainTextures();
const audio = new Audio(files.audio, files.music);
// ?mute: silent page for development and automated tests (AGENTS.md).
if (new URLSearchParams(location.search).has('mute')) audio.setMuted(true, { keep: false });
const sprites = {};
// Star officers' own battle sprites (tools/gen_sprites_codex.sh); loaded when they take the field.
const officerSprites = Array.isArray(officerList) ? officerList : [];
// 单挑 action strips (tools/slice_duel_frames.py): star officers' own, plus the two generic generals'.
const duelStrips = Array.isArray(duelList) ? duelList : [];
async function loadDuelStrip(key) {
  if (!duelStrips.includes(String(key)) || sprites[`duel-${key}`]) return;
  const strip = async (k) => ({ meta: await (await fetch(`assets/ai/sprites/duel/${k}.json`)).json(), tex: await loadPixelTexture(`assets/ai/sprites/duel/${k}.png`) });
  // The 白兵 board also turns him to face along a column with his front / back strip (<key>-turn); in a 单挑 his
  // horse wheels round through that strip and the three-quarter views between it and his side (<key>-wheel).
  // The third sheet (<key>-c: 舍身 run, crushing hit, defeat and triumph; tools/slice_duel_extra.py) only for the riders
  // listed in extra.json, so the others ask for no file they do not have.
  extraStrips ||= json('assets/ai/sprites/duel/extra.json').catch(() => []);
  spinStrips ||= json('assets/ai/sprites/duel/spin.json').catch(() => []);
  leapStrips ||= json('assets/ai/sprites/duel/leap.json').catch(() => []);
  const extra = (await extraStrips).includes(String(key)) ? await strip(`${key}-c`).catch(() => null) : null;
  const spin = (await spinStrips).includes(String(key)) ? await strip(`${key}-spin`).catch(() => null) : null;
  const leap = (await leapStrips).includes(String(key)) ? await strip(`${key}-leap`).catch(() => null) : null;
  try { sprites[`duel-${key}`] = { ...(await strip(key)), turn: await strip(`${key}-turn`).catch(() => null), wheel: await strip(`${key}-wheel`).catch(() => null), extra, spin, leap }; } catch {}
}
let extraStrips = null, spinStrips = null, leapStrips = null;
// War-map march strips: each side's general from the side, three-quarter front and three-quarter back,
// standing and walking (tools/slice_march_frames.py); star officers ride in their own, built from their
// 单挑 strips (tools/build_officer_march.py) and loaded when they take the field.
const loadMarch = async (key) => {
  try { sprites[`march-${key}`] = { meta: await (await fetch(`assets/ai/sprites/march/${key}.json`, { cache: 'no-store' })).json(), tex: await loadPixelTexture(`assets/ai/sprites/march/${key}.png`) }; } catch {}
};
const marchStrips = Array.isArray(marchList) ? marchList : [];
// A pack's officer rides in the strips of the officer he borrows his pictures from (core/pack.js `like`): loaded under that one's
// key, then known by his own as well, so every lookup by id finds them.
// The generic generals' spear and sword sets (core/pack.js genericArt) come along for every war, all four: a general who buys a
// weapon of another class at the field's 武器店 changes his look on the spot (war/interact.js shop).
const GENERIC_ARMED = ['attacker', 'defender'].flatMap((s) => [0, 16].map((w) => genericArt(s, w))); // 0 a sword, 16 a spear
const loadOfficerMarch = async (ids) => Promise.all([...(await Promise.all(ids.map(async (id) => [id, await battleArt(id)]))).filter(([, a]) => marchStrips.includes(String(a)))
  .map(async ([id, a]) => { if (!sprites[`march-${a}`]) await loadMarch(a); if (id !== a && sprites[`march-${a}`]) sprites[`march-${id}`] = sprites[`march-${a}`]; }),
  ...GENERIC_ARMED.filter((k) => marchStrips.includes(k) && !sprites[`march-${k}`]).map(loadMarch)]);
// 白兵 troop action strips (tools/slice_troop_frames.py): <side>-<soldier|archer|cavalry>[-v2], each with its -turn strip.
const loadTroops = async () => {
  try {
    const strip = async (k) => ({ meta: await (await fetch(`assets/ai/sprites/troops/${k}.json`)).json(), tex: await loadPixelTexture(`assets/ai/sprites/troops/${k}.png`) });
    // Each look's front / back strip (<key>-turn) rides along with its side strip when it exists.
    await Promise.all(troopList.map(async (k) => { try { sprites[`troop-${k}`] = { ...(await strip(k)), turn: await strip(`${k}-turn`).catch(() => null) }; } catch {} }));
  } catch {}
};
// A pack faction's troop looks (core/pack.js TROOP_LOOKS: 战象, 蛮兵, 足轻, 铁骑), loaded for the 白兵 that needs them: the strips of
// each side's colours under troop-<attacker|defender>-<look>, as the original kinds'. Their list (troops/looks.json) and strips are
// not in the release packages (desktop/build-app.mjs); there, or when one will not load, the squads wear the original kinds.
let troopLookList;
async function loadTroopLooks(looks, wear) {
  const want = ['a', 'd'].flatMap((s) => Object.values(wear[s] ?? {}).map((l) => `${looks[s]}-${l}`)).filter((k) => !sprites[`troop-${k}`]);
  if (!want.length) return;
  troopLookList ??= await optional(json('assets/ai/sprites/troops/looks.json')) ?? [];
  const strip = async (k) => ({ meta: await (await fetch(`assets/ai/sprites/troops/${k}.json`)).json(), tex: await loadPixelTexture(`assets/ai/sprites/troops/${k}.png`) });
  await Promise.all([...new Set(want)].flatMap((k) => [k, `${k}-v2`]).filter((k) => troopLookList.includes(k)).map(async (k) => {
    try { sprites[`troop-${k}`] = { ...(await strip(k)), turn: await strip(`${k}-turn`).catch(() => null) }; } catch (e) { console.warn('troop look', k, e); }
  }));
}
// The generic generals and troops, the two sides' march strips and the 白兵 strips, all at once; a generic sprite that will not load
// still stops the boot, as before.
await Promise.all([
  ...['attacker', 'defender'].flatMap((side) => [[side, `${side}-general`], ...['soldier', 'archer', 'cavalry'].map((k) => [`${side}-${k}`, `${side}-${k}`])])
    .filter(([, f]) => files.sprites[f]).map(async ([key, f]) => { sprites[key] = await loadPixelTexture(files.sprites[f]); }),
  ...['attacker', 'defender'].map(loadMarch), loadTroops(),
]);
// A pack officer's woman-general look (core/pack.js HEROINE_LOOKS) rides in its own sprite, 单挑 and march strips, listed in
// sprites/heroines.json rather than the index lists and left out of the release packages (desktop/build-app.mjs): the look's key
// joins the three lists once the list says it is there, and an officer whose look is missing fights as his `like` officer.
let heroineList = null;
async function battleArt(id) {
  const look = G.lookOf(id);
  if (!look) return G.artOf(id);
  heroineList ??= optional(json('assets/ai/sprites/heroines.json')).then((l) => {
    const have = Array.isArray(l) ? l : [];
    for (const k of have) for (const list of [officerSprites, duelStrips, marchStrips]) if (!list.includes(k)) list.push(k);
    return have;
  });
  return (await heroineList).includes(look) ? look : G.artOf(id);
}
async function loadOfficerSprites(ids) {
  const arts = await Promise.all(ids.map(battleArt));
  for (const [i, id] of ids.entries()) {
    const a = arts[i];
    if (officerSprites.includes(a) && !sprites[`officer-${a}`]) sprites[`officer-${a}`] = await loadPixelTexture(`assets/ai/sprites/officers/${a}.png`);
    if (a !== id && sprites[`officer-${a}`]) sprites[`officer-${id}`] = sprites[`officer-${a}`];
  }
  // One without strips of his own rides as the generic general in the weapon class he holds (core/pack.js genericArt): that class's
  // set for both sides, the side being the view's to say.
  const plain = ids.filter((id, i) => !duelStrips.includes(String(arts[i])) && !officerSprites.includes(arts[i]));
  const armed = plain.flatMap((id) => ['attacker', 'defender'].map((s) => genericArt(s, g?.officers[id]?.weapon)));
  await Promise.all([...new Set([...arts, 'attacker', 'defender', ...armed])].map(loadDuelStrip));
  for (const [i, id] of ids.entries()) { const a = arts[i]; if (a !== id && sprites[`duel-${a}`]) sprites[`duel-${id}`] = sprites[`duel-${a}`]; }
}

// ---------- Renderer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (error) {
  document.body.dataset.screen = 'startup-error';
  modal('无法启动游戏 · WebGL 2 初始化失败', () => [
    // Not the B站 Toy build (that one says to try an outside browser): here the desktop game, the web page and the APK.
    h('p', {}, '未能创建 WebGL 2 图形环境。请更新浏览器或显卡驱动，并检查硬件加速是否开启。'),
    h('p', { class: 'hint' }, `错误信息：${error?.message || error}`), // the desktop player has no console to read it from
    h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => location.reload() }, '重新载入')),
  ], { forced: true });
  throw error; // Preserve the original startup error in browser and desktop logs.
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; // 1.05 in 0.1.0 read as too dark
// Ground seen at a grazing angle stays sharp instead of smearing or sparkling.
for (const t of Object.values(T)) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
$('#stage').appendChild(renderer.domElement);
// A GPU process that crashes takes the WebGL context with it (a Windows player's AMD driver, 2026-11-08: the war map went
// white for good after the second crash). three asks for it back and rebuilds its programs and targets itself; the desktop
// build stops Chromium from refusing a page that crashed the GPU (desktop/main.js). Meanwhile the player is told, and if
// the picture does not come back he may reload (the records are kept; only what came after the last one is lost).
// The two console.warn lines land in the desktop's startup.log.
{
  let lostAt = 0, wait = 0, closeStuck = null;
  renderer.domElement.addEventListener('webglcontextlost', () => {
    lostAt = performance.now(); console.warn('webgl: context lost');
    toast('<em>显卡驱动重置</em>，正在恢复画面…', 6000);
    clearTimeout(wait);
    wait = setTimeout(() => {
      if (!lostAt || closeStuck) return;
      modal('画面未能恢复', (close) => {
        closeStuck = close;
        return [h('p', {}, '显卡驱动重置后，画面没有恢复。可以继续等待，或重新载入游戏：已有的记录都在，上次记录之后的进度会丢失。'),
          h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(false) }, '继续等待'), h('button', { class: 'btn primary', onclick: () => close(true) }, '重新载入'))];
      }, { forced: true }).then((reload) => { closeStuck = null; if (reload) location.reload(); });
    }, 8000);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn(`webgl: context restored after ${Math.round(performance.now() - lostAt)} ms`);
    lostAt = 0; clearTimeout(wait); closeStuck?.(false);
    toast('<strong>画面已恢复</strong>', 2000);
  });
}
const labels = new CSS2DRenderer(); labels.domElement.className = 'labels'; $('#stage').appendChild(labels.domElement);
const post = createPost(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
// HD-2D 开/关 as left last time (src/prefs.js). Kept while the flat 战略地图 shows the row as 不可用: the 白兵 and 单挑 still use it.
post.setEnabled(readFlag(PREF.hd2d, true));
const toggleHd2d = () => { post.setEnabled(!post.enabled); writeFlag(PREF.hd2d, post.enabled); syncHd2dRow(); };
// mode starts undefined, not null: until the first setMode() (the boot splash, the title loading) it must not equal war, which is
// null outside a war, or every `mode === war` check would pass and reach into a missing war map (思念漂泊凛冬@bilibili, D86: a
// mouse leaving the canvas during the boot threw from war.hoverCell).
let mode, g = null, sel = null, war = null;
let warNav = null; // the 3D war map's minimap, edge markers and edge scrolling (src/warnav.js); none on the flat map
let warRoster = null; // the war map's friendly general roster on the left (src/warroster.js), both 3D and flat
// The 战略地图's UI colours turn with the map's month (ui.css body[data-season]): a new season eases in with it, unless the
// map jumps to it. Other screens keep their own colours, whatever is set here.
let seasonTurn = 0;
function seasonUi(month, instant) {
  const s = `s${Math.floor(month / 3)}`, b = document.body;
  if (b.dataset.season === s) return;
  clearTimeout(seasonTurn); b.classList.toggle('season-turning', !instant && !!b.dataset.season);
  seasonTurn = setTimeout(() => b.classList.remove('season-turning'), 2600);
  b.dataset.season = s;
}
// ?flat pins both flat maps, whatever the 画质 (the tests and tools open them so).
const PIN_FLAT = new URLSearchParams(location.search).has('flat');
const strategy = await createStrategyShell({
  // A city picked on the map with the mouse (its model or its tag) comes out from under the HUD (D53).
  ctx: { data: D, renderer, hudTop: strategyHudTop, onCity: (cid) => { onCity(cid); if (cid != null && sel === cid) keepClear(cid); }, onSeason: seasonUi },
  start: PIN_FLAT || savedQuality() === 'low' ? 'flat' : '3d', fallback3d: !PIN_FLAT,
  flat: createStrategyFlat,
  // At boot, no sand table means the procedural board as ever; a map already up stays rather than give way to that.
  // Mid-game the download may come in at any time, but the build is one long task: it waits for a map with nothing running on it, or it would freeze a war or a 白兵.
  load3d: async (c) => {
    const sand = await loadSandtable(D.pack?.boards ?? [], D.cities.filter((c) => c.mod)); // the boards of a pack's extension regions (design §5.5, core/pack.js regionBoards); none without a pack
    if (c.month != null) {
      if (!sand) throw new Error('no sand table');
      while (!mapCalm()) await sleep(120);
    }
    return createStrategy({ ...c, T, sand });
  },
  stage: stageMap,
  home: () => (g ? sel ?? g.factions[g.player]?.city ?? null : null),
  onFail: (kind) => toast(kind === 'flat' ? `<em>平面地图加载失败</em>${PIN_FLAT ? '' : '，改用3D地图'}` : '<em>3D地图加载失败</em>，继续使用平面地图', 4000),
});
const tview = createTacticalView(T, sprites);
const dview = createDuelView(T, sprites, audio);

// The flat war map's layer and HUD (body.flat2d) show only while it is the mode on screen, not under a 白兵 cut-in; the same for the flat 战略地图's layer (body.flatmap), which keeps the map's usual HUD.
function setMode(m) {
  // The map coming back (under the fade that brought it) takes up the 画质 chosen while it was away; a 退却 pick is still the war.
  if (m === strategy && document.body.dataset.screen !== 'war') strategy.use(mapKind(), { cut: true });
  mode = m; document.body.classList.toggle('flat2d', !!m.flatHud); document.body.classList.toggle('flatmap', !!m.flat && !m.flatHud); $('#tip').hidden = true; post.setView(m.scene, m.camera); setProfile(); labels.domElement.replaceChildren(); resize(); syncHd2dRow();
}
// Post profile per scene (post.js PROFILES); the title shares the strategy scene, so the screen decides.
let profileKey = '';
function setProfile() {
  const k = mode === dview ? 'duel' : mode === tview ? 'skirmish' : mode === strategy ? (document.body.dataset.screen === 'title' ? 'title' : 'strategy') : 'war';
  if (k !== profileKey) { profileKey = k; post.setProfile(k); }
}
let fitPixels = () => {}; // quality.fit, once the presets are up: the 3D canvas's pixel ratio for this window size
function resize() {
  const w = innerWidth, hh = innerHeight;
  fitPixels();
  renderer.setSize(w, hh); labels.setSize(w, hh); post.setSize(w * renderer.getPixelRatio(), hh * renderer.getPixelRatio());
  for (const m of [strategy, tview, dview, war]) if (m) { m.camera.aspect = w / hh; m.camera.updateProjectionMatrix(); }
}
addEventListener('resize', resize);
const quality = createQuality({ renderer, post, resize, onChange: settleMap });
fitPixels = quality.fit;
const fade = (on) => new Promise((r) => { $('#fade').classList.toggle('on', on); setTimeout(r, 450); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Which 战略地图 ----------
const mapKind = () => (PIN_FLAT || quality.level === 'low' ? 'flat' : '3d');
function settleMap() { strategy.retry(); if (mode === strategy && document.body.dataset.screen !== 'war') strategy.use(mapKind()); }
// A switch waits for the map to be on screen with nothing running on it: no command, dialog or map pick is broken off, an AI turn's war
// plays out on the map it began on, and the start of the player's turn (its month's events, on <body> and not blocking(), then the banner)
// and 欣赏模式 are left alone. Then a fade over it, the player's input held; on the title its art covers the map, so no fade.
const mapCalm = () => mode === strategy && !commandOpen() && !$('#fade.on') && (document.body.dataset.screen === 'title' || (document.body.dataset.screen === 'strategy' && !!g && g.current === g.player && !!endPlayer && !scenic && !$('.banner')));
async function stageMap(swap, still) {
  while (still() && !mapCalm()) await sleep(120);
  if (!still()) return;
  if (document.body.dataset.screen === 'title') { swap(); setMode(strategy); return; }
  busy = true;
  try { await fade(true); swap(); setMode(strategy); } finally { await fade(false); busy = false; }
}

// ---------- Input ----------
const ndc = (e) => new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
let drag = null;
const canvas = renderer.domElement;
// Any click starts the sound, including on the title screen's overlay above the canvas.
addEventListener('pointerdown', () => audio.unlock(), { capture: true });
// A touch only counts as the gesture that may start sound when the finger lifts (pointerup, touchend, click), so those unlock it too.
for (const t of ['pointerup', 'touchend', 'click']) addEventListener(t, () => audio.unlock(), { capture: true });
// A phone's browser keeps a hidden page's sound playing (another app in front, the screen locked): the sound stops with the page and comes back with it.
// Phone: how far down the 战略地图's top bar reaches, for strategy.js to centre its view below it (2026-11-17); 0 elsewhere and
// while it is hidden (欣赏模式). Read at most twice a second: the bar is redrawn often, its height seldom changes.
let barReadAt = -Infinity, barBottom = 0;
function strategyHudTop() {
  if (!PHONE || document.body.dataset.screen !== 'strategy') return 0;
  const t = performance.now();
  if (t - barReadAt > 500) { barReadAt = t; const b = document.querySelector('.topbar'); barBottom = b && b.offsetParent ? Math.max(0, b.getBoundingClientRect().bottom) : 0; }
  return barBottom;
}
if (PHONE) document.addEventListener('visibilitychange', () => { const c = audio.ctx; if (!c) return; if (document.hidden) c.suspend?.().catch(() => {}); else audio.wake(); });
// 自动续玩 (phone): a phone's browser may throw a hidden page away (another app in front for a while) and the campaign with it.
// As the page goes out of sight the game is put down where 中断战斗 or a record would put it: the war in progress as a suspended
// battle, the 战略地图 on the player's turn as the auto record (src/core/game.js). Both are dropped when the page comes back,
// so they are there only for a page that never did; nothing is spent and nothing can be loaded twice.
let autoHeld = false;
function autoPut() {
  try {
    if (!g) return;
    if (inWar()) { if (!suspendBlocked() && !peekSuspend() && suspend(g, warCtx.w, warCtx.field, { ...warCtx, yaw: war.yaw })) autoHeld = true; return; }
    if (document.body.dataset.screen === 'strategy' && g.current === g.player && !busy && !blocking()) G.saveAuto(g);
  } catch { /* storage full or closed: the page may still come back */ }
}
function autoTake() { G.dropAuto(); if (autoHeld) { autoHeld = false; dropSuspend(); } }
if (PHONE) { document.addEventListener('visibilitychange', () => (document.hidden ? autoPut() : autoTake())); addEventListener('pagehide', autoPut); addEventListener('pageshow', (e) => { if (e.persisted) autoTake(); }); }
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// A drag lives from pointerdown to its own pointerup. The canvas captures the pointer so a release outside
// the window or over a dialog still ends it, and a cancel, a lost capture, a blur or a move that no longer
// holds the drag's button drops it, so the camera never keeps turning with a released mouse.
const DRAG_BIT = { 0: 1, 1: 4, 2: 2 };
// How far a press may wander and still be a click: a mouse 6 px of path; a finger, which rolls as it lands and lifts, 10 px
// from where it came down (its path alone would turn most taps into drags).
const SLOP = (d) => (d.touch ? 10 : 6);
const endDrag = () => { if (drag && canvas.hasPointerCapture?.(drag.id)) canvas.releasePointerCapture(drag.id); if (drag) mode?.turnEnd?.(); drag = null; };
// tag: the 战略地图 city tag the press began on (D52): a drag from it moves the map as from the ground beside it, and a press
// that stays put is a click on the tag, given on release; the browser's own click that follows is swallowed, wherever it lands.
let swallowClick = false;
function startDrag(e, tag = null) {
  audio.unlock(); $('#tip').hidden = true; hoverAt = null; swallowClick = false;
  if (drag) endDrag(); // a second button mid-drag starts over with the new one
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, b: e.button, moved: 0, tag, x0: e.clientX, y0: e.clientY, touch: e.pointerType === 'touch' };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
}
// Touch (a phone or a tablet): two fingers on the map zoom it about the point between them. The drag under way ends with no click, and the
// finger left on the glass afterwards neither drags nor clicks.
const fingers = new Map(); let pinch = null;
const onBoard = (e) => e.target === canvas || !!e.target.closest?.('.ctag');
const span = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !onBoard(e)) return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (fingers.size === 2) { endDrag(); pinch = span(); $('#tip').hidden = true; }
}, { capture: true });
addEventListener('pointermove', (e) => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!pinch || fingers.size !== 2 || dialogOpen()) return;
  const n = span();
  if (n.d !== pinch.d) mode?.zoom?.(-Math.log(n.d / pinch.d) * 1000, new THREE.Vector2((n.x / innerWidth) * 2 - 1, -(n.y / innerHeight) * 2 + 1), { pinch: true });
  if (mode?.slide) mode.slide(n.x - pinch.x, n.y - pinch.y); // the pair moving together carries the map along
  pinch = n;
}, { capture: true });
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => { if (fingers.delete(e.pointerId) && fingers.size < 2 && pinch) { pinch = null; if (drag) endDrag(); } }, { capture: true });
addEventListener('blur', () => { fingers.clear(); pinch = null; });
canvas.addEventListener('pointerdown', (e) => { if (!pinch) startDrag(e); });
document.addEventListener('pointerdown', (e) => {
  const tag = mode === strategy && (e.button === 0 || e.button === 2) && e.target.closest?.('.ctag');
  if (tag && !pinch) startDrag(e, tag);
});
document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.ctag')) e.preventDefault(); });
addEventListener('click', (e) => { if (swallowClick && e.isTrusted) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } }, { capture: true });
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', (e) => { if (drag?.id === e.pointerId) { mode?.turnEnd?.(); drag = null; } });
addEventListener('blur', endDrag);
canvas.addEventListener('pointermove', (e) => {
  if (drag && (e.pointerId !== drag.id || !(e.buttons & (DRAG_BIT[drag.b] ?? 1)))) endDrag();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = drag.touch ? Math.max(drag.moved, Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0)) : drag.moved + Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    // The left button slides the map (the war map's orbit is its slide), the right one turns it: the 3D war map about its
    // quarter turns, the 3D 战略地图 round and up and down (D52); a flat picture never turns. Elsewhere either drag orbits.
    // The first 6 px of a left press only tell a drag from a click.
    if (drag.b === 2) { if (mode?.turn) mode.turn(dx); else if (!mode?.flat) mode?.orbit?.(dx, dy); }
    else if (drag.b === 0 && drag.moved > SLOP(drag)) { if (mode?.slide) mode.slide(dx, dy); else mode?.orbit?.(dx, dy); }
  } else {
    if (!hoverAt) requestAnimationFrame(hoverNow);
    hoverAt = e;
  }
});
// The pointer leaving the map (onto the HUD or out of the window) takes the war map's hovered cell with it, so
// a general thinned out over that cell (src/warview.js, src/warmap2d.js, F04) comes back and no route preview is left behind.
canvas.addEventListener('pointerleave', (e) => { if (mode === war && !drag && e.pointerType !== 'touch') { hoverAt = null; war.hoverCell(null); $('#tip').hidden = true; } });
// Hover picks once a frame with the latest position: a mouse reports moves faster than the display refreshes,
// and each pick casts a ray and may rebuild a route preview. A press in between drops the pending hover.
let hoverAt = null;
// A dialog over the map (人物志, a city's officers, a confirm…). A map pick's own panel sits on the dialog layer
// too, but it asks the player to point at cities, so it alone does not count.
const dialogOpen = () => layer().childElementCount > (mapPick ? 1 : 0);
// A dialog that opens takes the hover tip with it, however it was opened (key, button, a city's talent note):
// the tip sits above the dialog layer and would cover the dialog.
new MutationObserver(() => { if (dialogOpen()) { $('#tip').hidden = true; hoverAt = null; setScenic(false); } }).observe(layer(), { childList: true });
function hoverNow() {
  const e = hoverAt; hoverAt = null;
  if (!e || drag || scenic) return;
  showTip(mode?.hover?.(ndc(e)), e);
}
// The hover tip for what the pointer, or the gamepad's cursor (at: its spot on screen), is on.
function showTip(hit, e) {
  const tip = $('#tip');
  if (mode === strategy && g && hit && document.body.dataset.screen === 'strategy' && !dialogOpen()) {
    const c = g.cities[hit.id];
    tip.hidden = false;
    // a rival's numbers as his city panel gives them: once scouted (cityKnown), not before (阿拉神丁@qq, 2026-11-19)
    tip.innerHTML = `<b>${cityName(c.id)}</b> <span style="color:${colorOf(c.faction)}">${factionName(c.faction)}</span><br>${cityKnown(c.id) ? `${c.officers.length}将　兵${G.troopsOf(g, c)}` : '未侦察'}${c.faction === g.player ? `<br>金${c.gold} 米${c.rice}` : ''}`;
    placeTip(tip, e);
  } else if (mode === war && hit?.tip && !blocking()) {
    tip.hidden = false; tip.innerHTML = hit.tip; placeTip(tip, e);
  } else tip.hidden = true;
}
// Below right of the pointer, else the first other corner that stays on screen and clear of the unit's action
// menu and the unit cards (near the right edge the tip used to squeeze into a column over the 计略 buttons).
function placeTip(tip, e) {
  const w = tip.offsetWidth, ht = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
  const keep = [...document.querySelectorAll('.unitacts, .unitpanel')].map((el) => el.getBoundingClientRect());
  const spots = [[e.clientX + 16, e.clientY + 12], [e.clientX - 16 - w, e.clientY + 12], [e.clientX + 16, e.clientY - 12 - ht], [e.clientX - 16 - w, e.clientY - 12 - ht]];
  const fits = ([x, y]) => x >= 4 && y >= 4 && x + w <= vw - 4 && y + ht <= vh - 4;
  const clear = ([x, y]) => keep.every((r) => x + w <= r.left || x >= r.right || y + ht <= r.top || y >= r.bottom);
  const [x, y] = spots.find((p) => fits(p) && clear(p)) ?? spots.find(fits) ?? spots[0];
  tip.style.left = `${Math.max(4, Math.min(x, vw - w - 4))}px`; tip.style.top = `${Math.max(4, Math.min(y, vh - ht - 4))}px`;
}
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.tag) { swallowClick = true; if (drag.b === 0 && drag.moved <= SLOP(drag) && drag.tag.isConnected) drag.tag.click(); endDrag(); return; }
  // A release over a dialog that opened mid-press is not a click on the field beneath it.
  if (drag.b === 0 && drag.moved <= SLOP(drag) && !dialogOpen() && document.elementFromPoint(e.clientX, e.clientY) === canvas) mode?.click?.(ndc(e), e);
  // A right click on the war map backs out (the 攻击 prompt, a 计略 target choice), as Esc does.
  if (drag.b === 2 && drag.moved <= SLOP(drag) && mode === war && !dialogOpen()) war.cancel?.();
  endDrag();
});
// A double click on a general's card brings him to the middle of the picture, at the step it has (第 2 期): the camera only. Not a
// double click on the map: the board sliding under the pointer would put a third click on another cell (S10).
document.addEventListener('dblclick', (e) => {
  if (mode !== war || war.flat || e.target.closest?.('button, .acts')) return;
  const card = e.target.closest?.('.unitpanel'); if (!card) return;
  const u = card.classList.contains('compare') ? war.st.peek : war.st.sel;
  if (u && !u.gone) war.centreOn?.(u.x, u.y);
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); mode?.zoom?.(e.deltaY, ndc(e)); }, { passive: false });
// WASD pans while held, scaled by frame time in the loop (key repeat stepped the view in jerks).
const held = new Set();
addEventListener('keyup', (e) => held.delete(keyName(e)));
addEventListener('blur', () => { held.clear(); document.body.classList.remove('alt-held'); });
// Holding Alt shows the exact numbers on every unit tag (war map and 白兵; N09).
for (const t of ['keydown', 'keyup']) addEventListener(t, (e) => { if (e.key === 'Alt') { e.preventDefault(); document.body.classList.toggle('alt-held', t === 'keydown'); } });
// Holding T, or the 地形 button on the war dock (pinned until pressed again), shows the ground under the generals
// on the war map, flat or 3D (playtest of 2026-10-31, F04): they fade to ghosts and the cells they cover name their terrain.
// (The flat map reads the body class; the 3D view is told, war.setTerrainView.) Not under the straight-down overview, which has roundels.
let terrainHeld = false, terrainPinned = false;
const terrainView = () => { const on = terrainHeld || terrainPinned; document.body.classList.toggle('terrain-view', on); $('.wardock .terrainbtn')?.setAttribute('aria-pressed', String(terrainPinned)); war?.setTerrainView?.(on); };
addEventListener('keydown', (e) => { if (keyName(e) === 't' && !e.repeat && mode === war && war && !war.viewState?.()?.tactical && !e.target.closest?.('input, .shade')) { terrainHeld = true; terrainView(); } });
addEventListener('keyup', (e) => { if (keyName(e) === 't' && terrainHeld) { terrainHeld = false; terrainView(); } });
addEventListener('blur', () => { terrainHeld = false; terrainView(); });
// The enemy's threat range (第 3 期): R held, or the 威胁 button pinned, shows the cells any one enemy general could strike when his
// side next acts (core/field.js threat); with the pointer on an enemy, his alone. A view only: nothing is rolled or changed.
let threatHeld = false, threatPinned = readFlag(PREF.threat); // the pin is remembered (src/prefs.js); R held is not
const pinThreat = (on) => { threatPinned = on; writeFlag(PREF.threat, on); threatView(); };
const threatView = () => { const on = threatHeld || threatPinned; document.body.classList.toggle('threat-view', on); $('.wardock .threatbtn')?.setAttribute('aria-pressed', String(threatPinned)); war?.setThreatView?.(on); };
addEventListener('keydown', (e) => { if (keyName(e) === 'r' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode === war && war && !e.target.closest?.('input, .shade')) { threatHeld = true; threatView(); } });
addEventListener('keyup', (e) => { if (keyName(e) === 'r' && threatHeld) { threatHeld = false; threatView(); } });
addEventListener('blur', () => { threatHeld = false; threatView(); });
// [ and ]: the previous and the next of our generals, as LB / RB on a pad (padCycle), on the commands step only: while a target is
// being chosen or an attack or 计略 is asked about, the keys do nothing (D32 §5).
function keyCycle(d) {
  if (mode !== war || blocking()) return;
  const f = war.field, st = war.st, mine = f.alive.filter((u) => u.side === f.human); if (!mine.length || st.busy) return;
  if (st.cast != null || st.confirm || st.strike || st.atkList || st.menu) return;
  if (!(f.turn === f.human || st.deploying)) return;
  const i = mine.indexOf(st.sel), u = mine[(i + d + mine.length) % mine.length];
  if (st.sel && st.sel !== u && !st.deploying) war.cancel?.();
  Promise.resolve(war.clickCell(u.x, u.y)).finally(() => war.keepInView?.(u));
}
// Intercept before the ordinary input handler and before a modal can consume the key. In the desktop game
// F5 must not refresh even when saving is blocked; modified browser shortcuts keep their own meaning.
addEventListener('keydown', (e) => {
  if (e.code !== quickSaveKey && e.code !== 'F8') return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  e.preventDefault();
  if (e.repeat || e.isComposing || e.target.closest?.('input, textarea, select, [contenteditable="true"]') || blocking()) return;
  if (e.code === quickSaveKey) quickRecord(); else quickLoad();
}, true);
addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.target.tagName === 'INPUT' || $('.shade')) return;
  const k = keyName(e);
  // 欣赏模式: V or Esc leaves it; only the view's own keys (pan, turn, reset, HD-2D, roads) work while the HUD is away.
  if (scenic) { if (k === 'v' || k === 'escape') { e.preventDefault(); setScenic(false); return; } if (!/^[wasdqehgc]$/.test(k)) return; }
  else if (k === 'v' && !e.repeat) setScenic(true);
  if (k === 'q') mode?.rotate?.(-1); if (k === 'e') mode?.rotate?.(1);
  if (k === 'c' && !e.repeat) resetCamera();
  // Tab: the war map's straight-down overview (the 3D map only); with a dialog or the 计略 menu up it keeps its focus job.
  // (the 系统 menu keeps Tab for its buttons)
  if (e.key === 'Tab' && mode === war && war.tactical && !dialogOpen() && !e.target.closest?.('.actpanel') && !$('.sysmenu-list:not([hidden])') && !e.target.closest?.('.sysmenu-list, .sysmenu-btn')) { e.preventDefault(); if (!e.repeat) war.tactical(); }
  if (/^[wasd]$/.test(k)) held.add(k);
  if (k === 'h' && !hd2dMoot()) toggleHd2d();
  if (k === 'r' && g && document.body.dataset.screen === 'strategy' && !blocking()) roster();
  if (k === 'g' && mode === strategy && document.body.dataset.screen === 'strategy') toggleRoads();
  if (mode === war && k === 'z') war.undo();
  if (mode === war && (e.key === '[' || e.key === ']') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) keyCycle(e.key === ']' ? 1 : -1);
  if (mode === war && k === 'n' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !blocking()) warRoster?.toggle();
  if (mode === war && k === 'm' && !e.repeat && !blocking()) warNav?.toggleMini();
  // F: the selected general's 计略 list; X: 再施, the 计略 he cast last; L: 定位目标 while a 计略's target is chosen. They press the
  // buttons, so they do what the buttons do, when they do.
  if (mode === war && (k === 'f' || k === 'x' || k === 'l') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !blocking()) $(`:is(.unitpanel .acts, .actpanel) [data-key="${k}"]:not(:disabled)`)?.click();
  // With a 攻击 or a 计略 asked about, Enter answers it (its button shows ⏎) and Esc steps back; otherwise Enter ends the day.
  // A focused button of the panel keeps its own Enter, so 返回 never strikes.
  // (The gamepad's A is not an Enter here: it acts on the cell under its cursor, src/pad.js.)
  if (mode === war && k === 'enter' && !e.fromPad) {
    // The count buttons keep focus after a redraw. Enter confirms that count; Space still presses the button (#527).
    if (e.target.closest?.('.actpanel.confirm [data-run]')) { e.preventDefault(); war.commitCast(e); }
    // A button of the panel or of his card keeps its own Enter (a 计略 row, a target, 施展, 返回).
    else if (e.target.closest?.('.actpanel, .unitpanel .acts')) { /* the button's own */ }
    // The cast waits for its confirmation: Enter gives it, if it is a new press (src/commitguard.js), never a held one.
    else if (war.st?.confirm) { e.preventDefault(); war.commitCast(e); }
    // The same for the 攻击 asked about: Enter enters the 白兵, a new press only.
    else if (war.st?.strike) { e.preventDefault(); war.commitAttack(e); }
    else if (war.st?.cast != null || war.st?.menu || war.st?.atkList) { /* a 计略, its target or the one to strike is being chosen: Enter belongs to the panel's rows, never to the day */ }
    // Enter ends the day on a new press only: not one held through the 白兵's report or the enemy's turn (D32 §9.3, S09).
    else if (freshInput(e)) war.endTurn();
  }
  if (mode === war && k === 'escape') { if (PHONE && warRoster?.close?.()) return; war.cancel?.(); }
  // ← →: the count of a 计略 cast several times in a row, while its confirmation is up (the panel's rows walk with ↑ ↓).
  if (mode === war && (k === 'arrowleft' || k === 'arrowright') && war.st?.confirm && !blocking() && war.runCount?.(k === 'arrowright' ? 1 : -1)) e.preventDefault();
  // 1–5: a group of the city's commands. Not while a command is being carried out (its map pick and windows have no
  // shade), under any window or the 系统 menu, nor again and again from a held key.
  if (mode === strategy && document.body.dataset.screen === 'strategy' && /^[1-5]$/.test(k) && $('.dock') && !e.repeat && !busy && !layer().lastElementChild && !$('.sysmenu-list:not([hidden])')) commandDock.toggle?.(Object.keys(TABS)[Number(k) - 1], { focus: true });
  // Esc puts the command list away, the keys back on its group: not a dialog's Esc (a command's own, or any other on top).
  if (mode === strategy && k === 'escape' && tabOpen && !busy && !layer().lastElementChild && $('.dock')) commandDock.close?.({ focus: true });
});

// ---------- Gamepad (src/pad.js; docs/手柄操作可行性方案_2026-11-08.md) ----------
// What each button does where. The input goes to one of three places (padZone):
//   'map'  — the cursor on the 战略地图 (it snaps from city to city) or on the war map (cell by cell, "up" always up the screen
//            whichever way the board is turned); A acts on what it is on, as a click there would.
//   a menu — a dialog, the 系统 menu, the 计略 list, the 白兵 console, the title, or the map's HUD once the focus is in it:
//            the directions walk the focus, A presses, B backs out.
//   'keys' — a presentation that answers keys only (an ending, a 命令演出): A is Enter, B is Esc.
// Controls name their button with data-pad (data-pad="x": X presses it; "y-hold": a long Y, its glyph filling up meanwhile),
// so the bindings sit beside the buttons they press and the glyphs follow them (ui.css body[data-input=pad]).
const cur = { cid: null, cell: null, hit: null }; // the map cursor: a city, or a war-map cell and what its tip says
let padZoneWas = null, padZoneAt = 0, padFocus = null, lookLatch = 0, padAlt = false, padTerrain = false;
const padRing = h('div', { class: 'padcursor', 'aria-hidden': 'true' }); document.body.append(padRing);
const onMap = () => !scenic && ((mode === strategy && document.body.dataset.screen === 'strategy' && !!g) || (!!war && mode === war && document.body.dataset.screen === 'war'));
const inBattle = () => mode === tview || mode === dview;
function padZone() {
  if ($('.ending') || $('.vig.floating')) return 'keys';
  const top = layer().lastElementChild;
  // 侦察: the city panel's officers, reached from the picker (看武将), are walked as their own zone; B goes back (padCancel).
  if (top && top === mapPick?.panel && mapPick.keep && $(mapPick.keep)?.contains(document.activeElement)) return $(mapPick.keep);
  if (top) return top;
  const sys = $('.sysmenu-list:not([hidden])'); if (sys) return sys;
  if (inBattle()) return $('.tq') ?? document.body;
  if (scenic) return 'scenic';
  if (onMap()) { const a = document.activeElement; return isControl(a) && root().contains(a) ? root() : 'map'; }
  return document.body;
}
// The control bound to button k in this zone (the HUD's for the map), if one is showing and enabled.
function padBound(zone, k) {
  const scope = zone instanceof Element ? zone : zone === 'map' ? root() : zone === 'scenic' ? document.body : null;
  return scope && [...scope.querySelectorAll(`[data-pad~="${k}"]`)].find((el) => !el.disabled && shown(el)) || null;
}
const confirmText = () => `手柄确定键 ${pad.confirm === 'east' ? '右' : '下'}（${padKey('a')}）`;
// A button's label on the pad in hand (Xbox A, PlayStation ✕, Nintendo B…), for text that names it.
const padKey = (k) => glyphOf(pad.family, pad.confirm === 'east', k);
// Text naming buttons, as nodes: each button a <kbd data-glyph> showing its painted glyph (its label until they load).
const padText = (f) => f((k) => `\u0000${k}\u0000`).split('\u0000').map((t, i) => (i % 2 ? h('kbd', { class: 'pg', 'data-glyph': t, 'data-label': padKey(t) ?? '' }) : t));
const padKbd = (k) => `<kbd class="pg" data-glyph="${k}" data-label="${padKey(k) ?? ''}"></kbd>`; // the same, as HTML (a toast)
const padPress = (b) => { b.click(); b.classList.add('padhit'); setTimeout(() => b.classList.remove('padhit'), 160); };
const pad = createPad({
  onActivate() {
    // Picked up after the mouse: a button the mouse left focused on the HUD would take the directions from the map.
    const a = document.activeElement;
    if (onMap() && isControl(a) && root().contains(a)) a.blur();
    syncPadHints();
    const menu = $('.sysmenu-list:not([hidden])');
    if (menu && !menu.cyclePage) menu.refreshPages();
    $('#tip').hidden = true; hoverAt = null;
    cursorShow();
  },
  onMouse(event) {
    const menu = $('.sysmenu-list.pad-pages:not([hidden])');
    if (!menu) return;
    const refresh = () => { if (menu.isConnected && !menu.hidden && !pad.active && menu.cyclePage) menu.refreshPages(); };
    if (event?.type === 'pointerdown' && menu.contains(event.target)) {
      // Keep the clicked control alive until its native click (or a cancelled drag) has finished.
      const controller = new AbortController();
      const finish = () => { controller.abort(); requestAnimationFrame(refresh); };
      for (const type of ['pointerup', 'pointercancel']) {
        window.addEventListener(type, finish, { capture: true, signal: controller.signal });
      }
      window.addEventListener('blur', finish, { signal: controller.signal });
    } else refresh();
  },
  // Unplugged or out of battery while in use: a 白兵 under way stops for it, as it would on a console.
  onLost() {
    toast('手柄已断开', 3000);
    const b = mode === tview && !$('.tq-start') && $('.tq [data-pad~="start"]:not(.on)');
    if (b && shown(b) && !b.disabled) b.click();
  },
  onButton(k, phase) {
    audio.unlock();
    const zone = padZone();
    if (phase === 'hold') {
      const b = padBound(zone, `${k}-hold`); if (b) return padPress(b);
      if (k === 'view' && ((mode === war && zone === 'map') || inBattle())) { padAlt = true; document.body.classList.add('alt-held'); } // the exact numbers, as Alt held
      return;
    }
    if (phase === 'release') {
      if (k === 'view' && padAlt) { padAlt = false; document.body.classList.remove('alt-held'); }
      if (k === 'l3' && padTerrain) { padTerrain = false; terrainHeld = false; terrainView(); }
      return;
    }
    if (phase === 'tap') {
      if (k === 'view' && mode === war && zone === 'map' && war.tactical && !padBound(zone, 'view')) war.tactical();
      // A short Y on the war map: the enemy's threat range, pinned and unpinned (the 威 button, R held on the keys). The long Y ends the day.
      if (k === 'y' && mode === war && zone === 'map' && !blocking() && !war.st.deploying) pinThreat(!threatPinned); // (not while deploying: Y there is 布阵完成 alone)
      return;
    }
    // A press.
    padPressed(); // src/commitguard.js: this press began now, after whatever step is on screen
    // 「按任意键」(the opening held for a first input) takes any button; Start skips a presentation as A does.
    if ($('.boot-press.on, .tt-press.on') || (k === 'start' && (zone === 'keys' || $('.boot')))) { sendKey('Enter'); return; }
    if (k === 'a') return padConfirm(zone);
    if (k === 'b') return padCancel(zone);
    const action = recordAction(k);
    if (action && mode === strategy && g && (zone === 'map' || zone === root() ||
      zone.matches?.('.mappick') || zone.querySelector?.('.otree'))) {
      // A command under way (a city pick, the 外交 roster) is already the player's turn: only the command stands in the way.
      if (!mapCalm()) return toast(commandOpen() ? '请先完成或取消当前命令' : '请在己方回合完成当前动作后使用存读档快捷键', 3000);
      return useRecordAction(action);
    }
    const b = padBound(zone, k);
    if (b) {
      padPress(b);
      // On the war map the cursor follows: 撤销 takes the general back, and the cell's preview is the new day's.
      if (zone === 'map' && mode === war) requestAnimationFrame(() => { const s = war?.st.sel; if (k === 'x' && s && !s.gone) setCell(s); else if (cur.cell && padZone() === 'map') setCell(cur.cell); });
      return;
    }
    if (k === 'start') { if (zone instanceof Element && zone.matches('.sysmenu-list')) return padCancel(zone); const s = !blocking() && $('.sysmenu-btn'); if (s && shown(s)) { s.click(); requestAnimationFrame(() => focusFirst($('.sysmenu-list'))); } return; }
    if (k === 'r3' && (zone === 'map' || zone === 'scenic')) return resetCamera();
    if (k === 'l3') {
      if (zone === 'scenic') return setScenic(false);
      if (zone === 'map' && mode === strategy && !mapPick) return setScenic(true);
      if (zone === 'map' && mode === war && !war.viewState?.()?.tactical) { padTerrain = true; terrainHeld = true; terrainView(); }
      return;
    }
    if ((k === 'lb' || k === 'rb') && zone instanceof Element && zone.cyclePage) {
      zone.cyclePage(k === 'rb' ? 1 : -1);
      return;
    }
    if ((k === 'lb' || k === 'rb') && zone instanceof Element && zone.querySelector('.ctl-tabs')) { // the help's 操作 page: the scene tabs
      const t = [...zone.querySelectorAll('.ctl-tabs .btn')], i = t.findIndex((b) => b.classList.contains('on')), n = t[(i + (k === 'rb' ? 1 : t.length - 1)) % t.length];
      if (n) padPress(n);
      return;
    }
    if ((k === 'lb' || k === 'rb') && (zone === 'map' || zone === root())) return padCycle(k === 'rb' ? 1 : -1);
    if ((k === 'lt' || k === 'rt') && inBattle()) { // the 白兵 speed, a step slower or faster
      const sp = $$('.tq-speed .tq-btn'), i = sp.findIndex((x) => x.classList.contains('on')), n = sp[i + (k === 'rt' ? 1 : -1)];
      if (n) padPress(n);
      return;
    }
    if ((k === 'lt' || k === 'rt') && zone === 'map' && mode === war) return war.zoom?.(k === 'lt' ? 100 : -100);
  },
  onDir(dx, dy) {
    const zone = padZone();
    if (zone === 'keys') return;
    if (zone === 'map') return cursorStep(dx, dy);
    if (zone === 'scenic') return;
    const el = document.activeElement;
    if (el.closest('.otree') && zone.contains(el)) {
      const tree = el.closest('.otree'), branch = el.closest('details'), header = el.matches('summary');
      if (dy) {
        const rows = [...tree.querySelectorAll('summary, tr[tabindex]')].filter(row =>
          !(row.matches('summary') ? row.parentElement.parentElement : row.parentElement).closest('details:not([open])'));
        const next = rows[rows.indexOf(el) + dy];
        (next ?? (dy > 0 ? zone.querySelector('.foot button') : el))?.focus();
      } else if (dx > 0 && header) {
        if (!branch.open) branch.open = true;
        else branch.querySelector(':scope > details > summary, :scope > table tr[tabindex]')?.focus();
      } else if (dx < 0) {
        if (header && branch.open) branch.open = false;
        else (header ? branch.parentElement.closest('details') : branch)?.querySelector('summary')?.focus();
      }
      return;
    }
    // Left and right set the count of a 计略 cast several times in a row while its confirmation is up (羽之@devblog, 2026-11-18).
    if (zone === root() && mode === war && dx && !dy && el?.matches?.('.actpanel.confirm :is([data-target], [data-run])') && $('.actpanel .ap-run') && war.runCount?.(dx)) return; // (on the buttons below they walk)
    // Right out of the action panel's list of targets: to the map, its cursor on the one the list was on, to pick there instead.
    if (zone === root() && mode === war && dx > 0 && !dy && el?.matches?.('.actpanel [data-target]')) {
      const u = war.field.alive.find((x) => x.id === Number(el.dataset.target));
      el.blur(); if (u) setCell(u); else cursorShow();
      return;
    }
    // Up and down in the city's command list go round its ends, as the keys do (the dock's own handler): from the first command ↑ is the
    // last (记录, feedback D61), not the roster that happens to lie above it.
    if (zone.contains(el) && dy && !dx && el?.matches?.('.dock .acts .cmd') && sendKey(dy > 0 ? 'ArrowDown' : 'ArrowUp')) return;
    if (zone.contains(el) && dx && !dy) {
      // Across a range or an amount, left and right set the value (as the arrow keys do); a list steps through its options.
      if (el.matches('input[type=range]')) { if (!sendKey(dx > 0 ? 'ArrowRight' : 'ArrowLeft')) { dx > 0 ? el.stepUp() : el.stepDown(); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } return; }
      if (el.matches('input.amount')) { sendKey(dx > 0 ? 'ArrowUp' : 'ArrowDown'); return; }
      if (el.matches('select')) { const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dx)); if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); } return; }
    }
    walk(zone, dx, dy);
  },
  onLook(rx, ry, dt) {
    const zone = padZone();
    if (zone instanceof Element && zone !== root()) { // a long dialog scrolls under the right stick
      if (!ry) return;
      const box = [zone, ...zone.querySelectorAll('*')].find((el) => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
      box?.scrollBy(0, ry * dt * 900);
      return;
    }
    if (zone !== 'map' && zone !== 'scenic' && zone !== root()) return;
    if (mode === war) {
      // A flick turns the board a quarter (as Q / E); up and down step the zoom.
      if (!war.rotate) return;
      if (lookLatch && Math.hypot(rx, ry) < 0.3) lookLatch = 0;
      if (!lookLatch && Math.abs(rx) > 0.75) { lookLatch = 1; war.rotate(rx > 0 ? 1 : -1); }
      else if (!lookLatch && Math.abs(ry) > 0.75) { lookLatch = 1; war.zoom?.(ry > 0 ? 100 : -100); }
      return;
    }
    if (mode !== strategy || (!rx && !ry)) return;
    if (strategy.flat) mode.slide?.(-rx * dt * 700, -ry * dt * 700); else mode.orbit?.(rx * dt * 380, ry * dt * 260);
  },
  onFrame(t, dt, holding, move) {
    const zone = padZone();
    if (zone !== padZoneWas) { padZoneWas = zone; padZoneAt = performance.now(); padFocus = null; cursorShow(); }
    if (!pad.active) { padTip.hidden = true; return; }
    // A menu always has the focus on one of its controls while the pad is in use: one that comes up (or fills in after it came,
    // as the 白兵's 阵形 cards) takes it to its default answer, and one drawn again (the 白兵 console, a city's page) to the same
    // button in the new one, else the nearest. A dialog holds the focus on itself, not its 确定, against an Enter held from the
    // message before; a pad press is one edge, and A is not taken for 160 ms after the focus lands.
    const a = document.activeElement;
    if (zone instanceof Element && zone !== root()) {
      if (isControl(a) && zone.contains(a)) padFocus = { el: a, key: `${a.className}|${a.textContent.trim().slice(0, 24)}`, r: a.getBoundingClientRect() };
      else {
        const all = focusables(zone);
        if (all.length) {
          const same = padFocus && all.find((el) => `${el.className}|${el.textContent.trim().slice(0, 24)}` === padFocus.key);
          const near = same ?? (padFocus ? all.sort((p, q) => dist(p, padFocus.r) - dist(q, padFocus.r))[0] : firstIn(zone));
          if (!same && !padFocus) padZoneAt = performance.now();
          near?.focus();
        }
      }
    }
    // The long press, filling up on its glyph.
    for (const el of $$('[data-pad~="y-hold"]')) el.style.setProperty('--hold', holding('y').toFixed(3));
    // The 战略地图 zooms while a trigger is held (the war map steps on each press).
    if ((zone === 'map' || zone === 'scenic') && mode === strategy) { const z = (pad.isDown('lt') ? 1 : 0) - (pad.isDown('rt') ? 1 : 0); if (z) mode.zoom?.(z * dt * 900); }
    // 欣赏模式 has no cursor to follow: the left stick slides the view itself, as W A S D do.
    if (zone === 'scenic' && mode === strategy && (move.x || move.y)) mode.pan?.(move.x * dt * 14, move.y * dt * 14);
    cursorFrame(dt, zone); padTipFrame(zone);
  },
});
onShake((k) => pad.rumble(k));
// What a control's title says (the 系统 rows, the 战术, a 单挑 command…), the pointer's tooltip, shown under the pad's focus
// instead. The city menu and the 计略 list tell theirs in their own foot.
const padTip = h('div', { class: 'padtip', role: 'status', hidden: true }); document.body.append(padTip);
function padTipFrame(zone) {
  const a = document.activeElement;
  const text = zone instanceof Element && isControl(a) && !a.closest('.dock .acts, .actpanel .strats') ? (a.getAttribute('title') ?? '').trim() : '';
  if (!text) { padTip.hidden = true; return; }
  if (padTip.dataset.text !== text) { padTip.dataset.text = text; padTip.textContent = text; }
  padTip.hidden = false;
  // Beside the menu it is in (left, else right) so it never covers the row the focus goes to next; else under or over the control.
  const r = a.getBoundingClientRect(), m = (a.closest('.sysmenu-list, .panel, .tq-console, .tq-duel-acts') ?? a).getBoundingClientRect(), w = padTip.offsetWidth, ht = padTip.offsetHeight;
  const midY = Math.max(6, Math.min(innerHeight - ht - 6, r.top + r.height / 2 - ht / 2));
  let x, y;
  if (m.left - 10 - w >= 6) { x = m.left - 10 - w; y = midY; } else if (m.right + 10 + w <= innerWidth - 6) { x = m.right + 10; y = midY; }
  else { x = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)); y = r.bottom + 8 + ht <= innerHeight - 6 ? r.bottom + 8 : Math.max(6, r.top - 8 - ht); }
  padTip.style.left = `${x}px`; padTip.style.top = `${y}px`;
}
const dist = (el, r) => { const b = el.getBoundingClientRect(); return Math.hypot(b.left + b.width / 2 - r.left - r.width / 2, b.top + b.height / 2 - r.top - r.height / 2); };

function padConfirm(zone) {
  if (performance.now() - padZoneAt < 160) return; // a menu that came up under the thumb is not answered by the same press
  if (sendKey('Enter')) return; // taken: a message, a presentation beat, the title's opening, an amount box
  if (zone === 'keys' || zone === 'scenic') return;
  if (zone === 'map') return mapConfirm();
  const el = document.activeElement;
  if (isControl(el) && zone.contains(el)) { if (!el.matches('input, select, textarea')) padPress(el); return; }
  focusFirst(zone);
}
function padCancel(zone) {
  // In the action panel B is its 返回 (which shows it): one step back each press, as Esc (D32 §5), wherever the focus is.
  if (zone === root() && mode === war && document.activeElement?.closest?.('.actpanel')) { war.cancel?.(); return; }
  // The strategy command list closes first, the focus back on its group; the next B leaves the HUD.
  if (zone === root() && mode === strategy && tabOpen && $('.dock')?.contains(document.activeElement)) { commandDock.close?.({ focus: true }); return; }
  if (zone === root()) { cmdFocus = null; document.activeElement?.blur?.(); cursorShow(); return; } // out of the HUD, back to the map
  if (zone instanceof Element && zone.matches('.sysmenu-list')) { $('.sysmenu-btn')?.click(); $('.sysmenu-btn')?.blur(); return; }
  if (zone instanceof Element && mapPick?.keep && zone.matches(mapPick.keep)) { focusFirst(mapPick.panel); return; } // 侦察: back to the picker
  if (zone === 'map' && mode === strategy && sel != null && !mapPick) { onCity(null); return; } // the city put away
  sendKey('Escape');
}

// The cursor on the map. A city of the 战略地图 is lit as the pointer lights it; a war-map cell gets its route preview and
// the foe's card as a hovered cell does, and the 3D map's cursor box. The tip stands beside it, and the view follows it.
const cityOnScreen = (id) => strategy.screenOfCity?.(id) ?? null;
function cursorShow() {
  const on = pad.active && padZone() === 'map';
  padRing.hidden = !(on && mode === strategy && cur.cid != null);
  if (!on) { if (mode === war && cur.cell && war) war.hoverCell(null); if (mode === strategy && pad.active) strategy.hoverId?.(null); if (pad.active) $('#tip').hidden = true; cur.hit = null; return; }
  if (mode === strategy) { if (cur.cid == null || !g?.cities[cur.cid]) cur.cid = sel ?? g?.factions[g.player]?.city ?? null; if (cur.cid != null) setCity(cur.cid); }
  else if (mode === war) { const f = war.field, s = war.st.sel; if (!cur.cell || !f.inside(cur.cell.x, cur.cell.y)) { const u = s && !s.gone ? s : f.alive.find((x) => x.side === f.human) ?? f.alive[0]; cur.cell = u ? { x: u.x, y: u.y } : { x: 0, y: 0 }; } setCell(cur.cell); }
}
function setCity(cid) {
  cur.cid = cid; strategy.hoverId?.(cid);
  const p = cityOnScreen(cid); if (p) showTip({ id: cid }, { clientX: p.x, clientY: p.y + 14 });
  padRing.hidden = false;
}
function setCell(c) {
  cur.cell = { x: c.x, y: c.y }; cur.hit = war.hoverCell(cur.cell, true);
  const p = war.screenOf(c.x, c.y);
  if (cur.hit?.tip && !blocking()) showTip(cur.hit, { clientX: p.x + p.cw / 4, clientY: p.y + 10 }); else $('#tip').hidden = true;
}
function cursorStep(dx, dy) {
  if (mode === strategy) {
    const from = cur.cid; if (from == null) return cursorShow();
    const a = cityOnScreen(from); if (!a) return;
    // The nearest city that way (within 60° of it), a straighter one preferred over a nearer one off to the side.
    let best = null, bs = Infinity;
    for (const c of D.cities) {
      if (c.id === from) continue;
      const b = cityOnScreen(c.id); if (!b || b.off) continue;
      const vx = b.x - a.x, vy = b.y - a.y, d = Math.hypot(vx, vy), cos = (vx * dx + vy * dy) / (d * Math.hypot(dx, dy));
      if (cos < 0.5) continue;
      const score = d * (1 + 2.2 * (1 - cos));
      if (score < bs) { bs = score; best = c.id; }
    }
    if (best != null) { setCity(best); audio.sfx?.('sfx-cursor'); }
    return;
  }
  if (mode !== war) return;
  const f = war.field; if (!cur.cell) return cursorShow();
  // Of the eight cells round it, the one whose place on screen lies most nearly that way: on a board turned to a corner, up the
  // screen is a diagonal of the grid.
  // (By the board's plane at its height, not the neighbours' tops: across a cliff two of them would look the same way.)
  const { x, y } = cur.cell, ax = war.screenAxes(x, y), L = Math.hypot(dx, dy);
  let best = null, bc = 0.4;
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    if ((!ox && !oy) || !f.inside(x + ox, y + oy)) continue;
    const vx = ox * ax.x[0] + oy * ax.y[0], vy = ox * ax.x[1] + oy * ax.y[1], cos = (vx * dx + vy * dy) / (Math.hypot(vx, vy) * L);
    if (cos > bc) { bc = cos; best = { x: x + ox, y: y + oy }; }
  }
  if (best) setCell(best);
}
// Each frame: the ring and the tip stay on the cursor as the view moves, and the view slides to keep the cursor clear of the edges and the HUD.
function cursorFrame(dt, zone) {
  if (zone !== 'map') { if (!padRing.hidden) padRing.hidden = true; return; }
  const p = mode === strategy ? (cur.cid != null ? cityOnScreen(cur.cid) : null) : mode === war && cur.cell ? war.screenOf(cur.cell.x, cur.cell.y) : null;
  if (!p) return;
  if (mode === strategy) { padRing.hidden = false; padRing.style.transform = `translate(${p.x}px, ${p.y}px)`; }
  const tip = $('#tip'); if (!tip.hidden) placeTip(tip, { clientX: p.x + (p.cw ?? 0) / 4, clientY: p.y + 14 });
  const top = mode === war ? ($('.warbar')?.getBoundingClientRect().bottom ?? 0) + 40 : innerHeight * 0.14;
  const low = mode === war ? Math.min(innerHeight, ...$$('.unitpanel:not(.compare), .wardock').filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().top)) - 40 : innerHeight * 0.72;
  // Faster the further out it is, so a city across the map comes in at once and one at the edge creeps in.
  const L = innerWidth * 0.14, R = innerWidth * 0.86, out = (v, a, b) => (v < a ? (v - a) : v > b ? (v - b) : 0) / 120;
  const sx = out(p.off ? innerWidth / 2 : p.x, L, R), sy = out(p.y, top, low);
  if ((sx || sy) && !drag) { const k = (v) => Math.sign(v) * Math.min(6, 1 + Math.abs(v)); mode.pan?.(sx && k(sx) * dt * 14, sy && k(sy) * dt * 14); }
}
function mapConfirm() {
  if (mode === strategy) {
    const cid = cur.cid; if (cid == null) return cursorShow();
    // A second press on the city in hand goes into its menu (a city of another faction: its officers).
    if (cid === sel && !mapPick && $('.citypanel')) { const list = tabOpen && $('.dock .acts'), b = (list && firstIn(list)) || firstIn($('.dock .tabs') ?? $('.citypanel')); /* no dock in another's turn, though the list was open */ if (b) { $('#tip').hidden = true; b.focus(); } return; }
    onCity(cid); return;
  }
  const c = cur.cell; if (!c || !war) return cursorShow();
  const st = war.st, s = st.sel;
  // A second press on the general in hand goes into his commands (计略, 退却, the village's shop or clinic).
  if (s && !s.gone && s.x === c.x && s.y === c.y && s.side === war.field.human && st.cast == null && !st.deploying) {
    // In his card (D32: the same place whoever he is).
    const b = [$('.unitpanel:not(.compare) .acts'), $('.actpanel .ap-body')].map((el) => el && firstIn(el)).find(Boolean);
    if (b) { $('#tip').hidden = true; b.focus(); return; }
  }
  Promise.resolve(war.clickCell(c.x, c.y)).finally(() => { if (padZone() === 'map' && cur.cell) setCell(cur.cell); });
  setCell(c);
}
// LB / RB: the city menu's page; with no menu, the next of the player's cities; on the war map, the next of his generals.
function padCycle(d) {
  if (mode === strategy) {
    const tabs = $$('.dock .tabs .btn');
    if (tabs.length) { commandDock.cycle?.(d); return; }
    const mine = G.citiesOf(g, g.player).map((c) => c.id).sort((p, q) => p - q); if (!mine.length) return;
    const i = mine.indexOf(cur.cid), next = mine[(i + d + mine.length) % mine.length];
    setCity(next); onCity(next);
    return;
  }
  if (mode !== war) return;
  // Not while a 计略, its target or an attack is being chosen or asked about, as the keys' [ and ] (keyCycle, D32 §5): the step
  // on screen is his, and a click on another of ours there would be taken as a target or drop the step.
  const f = war.field, st = war.st, mine = f.alive.filter((u) => u.side === f.human); if (!mine.length || blocking()) return;
  if (st.cast != null || st.confirm || st.strike || st.atkList || st.menu) return;
  const i = mine.indexOf(st.sel), u = mine[(i + d + mine.length) % mine.length];
  setCell(u); // the cursor goes to him even while the enemy acts or a move plays out: only the selecting waits
  if (!st.busy && (f.turn === f.human || st.deploying)) Promise.resolve(war.clickCell(u.x, u.y)).finally(() => padZone() === 'map' && setCell(u));
}

// The war camera frames units between the top bar and the bottom panels, measured as they change.
let insetTick = 0;
// The foe's compare card is a transient strip floating over the bottom band (pointer-events: none): counting it would slide the board each time the pointer crosses an enemy.
function frameWar() {
  const bar = $('.warbar'), lows = $$('.unitpanel:not(.compare), .wardock').filter((e) => e.offsetParent);
  const top = bar?.offsetParent ? bar.getBoundingClientRect().bottom : 0;
  // His commands in the card come and go with the step (the 计略 steps put them away): the board is fitted as if they were not there.
  const topOf = (e) => { const d = e.querySelector(':scope > .acts'); return e.getBoundingClientRect().top + (d?.childElementCount ? d.offsetHeight + 10 : 0); };
  const bottom = lows.length ? innerHeight - Math.min(...lows.map(topOf)) : 0;
  // The action panel's column (D32) is always kept out of the 3D frame on the war map, panel up or not, so the camera never
  // shifts as it comes and goes; in a cut-in the HUD is away and the frame is the whole screen.
  const left = war.flat || document.body.classList.contains('cine') ? 0 : panelWidth() + 20;
  war.setInsets(top, bottom, left);
}

// 待机·结束本日 by touch (phone): one tap under the thumb that has just been moving generals would hand the day to the enemy with no
// way back, so it asks first, with what would be left unused. (A pad holds the button; a mouse and the keys act at once.)
async function endDay() {
  if (!war) return;
  if (PHONE) {
    const f = war.field, pool = f.pool[f.human];
    if (!(await confirmBox('结束本日', `我军机动力还剩 ${pool}。结束后轮到敌军行动，不能撤回。`))) return;
  }
  war?.endTurn();
}

// 战报 (phone): the log box is put away there and its lines pass as toasts; this is the whole of it, newest first.
function logBook() {
  const lines = [...($('.logbox')?.children ?? [])].slice(0, 60).map((p) => h('p', { html: p.innerHTML }));
  return modal('战报', (close) => [h('div', { class: 'logbook' }, ...(lines.length ? lines : [h('p', { class: 'hint' }, '还没有战报')])), h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => close() }, '关闭'))]);
}

// ---------- Frame loop ----------
// Drawn at most 60 times a second unless 系统 → 帧率 says 不限 (src/framecap.js). The desktop shell keeps timers running
// behind other windows (backgroundThrottling off), so a hidden window still moves the game on, 30 times a second, but draws nothing.
// The title screen (.tt) is opaque over the whole window: the map under it goes on turning but is drawn only once for each scene,
// window size and 画质, so its shaders, render targets and shadow maps are ready the moment the title goes (as strategyflat.js, which
// paints nothing under it).
// A new 3D scene (a war, a 白兵 field, a 单挑) compiles its shaders before its first frame, in parallel where the browser can, while
// the fade or the cut-in still covers the screen; the frame loop draws nothing meanwhile, so no frame stops to compile them
// (PERF-05: 26–27 programs, a 115–175 ms frame, at each war and 白兵). Capped: a slow compile never holds the game.
let warming = 0;
async function prewarm(m) {
  if (!m?.scene || m.flat) return;
  warming++;
  try { await Promise.race([post.compile(m.scene, m.camera), sleep(2000)]); } catch (e) { console.warn('prewarm', e); } finally { warming--; }
}
const clock = new THREE.Clock(), focusV = new THREE.Vector3(), due = pacer();
let warmedUnder = '';
const coveredFrameDue = () => {
  const key = `${mode.scene.uuid} ${innerWidth}x${innerHeight}@${renderer.getPixelRatio()} ${quality.level}`;
  if (key === warmedUnder) return false;
  warmedUnder = key; return true;
};
renderer.setAnimationLoop((t) => {
  if (!mode || !due(t, document.hidden ? 30 : undefined)) return;
  const dt = Math.min(0.05, clock.getDelta());
  if (held.size) { const v = dt * 14, k = (c) => (held.has(c) ? 1 : 0); mode.pan?.((k('d') - k('a')) * v, (k('s') - k('w')) * v); }
  mode.update(dt); setProfile();
  if (mode === war) { warNav?.update(dt, { blocked: blocking() || dialogOpen() }); warRoster?.update(); }
  if (mode === war && ++insetTick % 15 === 0) frameWar();
  if (mode === war && !war.flat) for (const el of $$('.unitacts')) el.place?.(false); // the 3D camera moves: the commands follow their general
  if (mode === strategy && document.body.dataset.screen === 'title') strategy.orbit(-dt * 18, 0);
  if (scenic && !scenicStillFits()) setScenic(false);
  if (mode.flat || document.hidden) return; // the flat war map draws itself on its own canvas (src/warmap2d.js): no 3D frame at all
  if (warming) return; // a scene's shaders compiling (prewarm): a frame now would wait for them on the main thread
  if (!document.querySelector('.tt')) warmedUnder = '';
  else if (!coveredFrameDue()) return;
  const dof = mode.dof?.(); if (dof) post.setDof(dof);
  mode.camera.updateMatrixWorld();
  post.setFocus(-focusV.copy(mode.focusPoint()).applyMatrix4(mode.camera.matrixWorldInverse).z);
  post.render(); labels.render(mode.scene, mode.camera);
});

// 版本号 for the 说明 (天使之翼723@devblog). A package carries build.json (desktop/build-app.mjs: version and commit);
// the dev server has none, so the version comes from desktop/package.json and is marked 开发版.
let versionText;
function gameVersion() {
  return (versionText ??= json('build.json').then((b) => `版本 ${b.version ?? '?'}（${b.commit}）`)
    .catch(() => json('desktop/package.json').then((p) => `版本 ${p.version} 开发版`))
    .catch(() => ''));
}

function help() {
  // 关闭 stays at the foot (sticky on a phone): the help fills a phone's screen, with no backdrop left to tap and no Esc (Wrz0903@bilibili).
  const version = h('span', { class: 'help-version' }); // at the title's right, where it shows without scrolling the help
  gameVersion().then((t) => { version.textContent = t; });
  return modal('说明', (close) => [version, h('div', { class: 'help' },
    h('h4', {}, '操作'), controls({ input: pad.active ? 'pad' : PHONE ? 'touch' : 'keys', touch: PHONE, family: pad.family, east: pad.confirm === 'east', label: padKey }),
    h('h4', {}, '战略'), h('p', {}, '一个势力行动一轮为一个月。每月按占城数发放命令书（1–3城3张……28–30城13张），点击己方城市，在下方菜单下令；命令书用完即结束本月。4月收税金，10月收米；统治度低于50易生暴乱；5–6月洪水、8–9月旱灾，防灾可减损。'),
    h('p', {}, '武将到史实卒年后一年比一年易病逝；开局或「☰ 系统」可选「武将不老」，「武将不战死」（体力归零改为被俘，体力回复至30；君主照常阵亡），「三顾模式」（同一位人才在该城至多搜索3次必定出仕），「武将不能读书」（敌我都不能入书馆提高智力），以及「免费记录」（存档不消耗命令书）。进度不会自动保存：城市菜单「城 → 记录」或「☰ 系统 → 记录进度」存入八个记录位置之一（消耗一张命令书，免费记录除外），「☰ 系统 → 读取记录」或标题画面读取。战争中可「☰ 系统 → 中断战斗」回到标题，之后从标题「继续战斗」接着打（不占记录位置，只能继续一次）。'),
    h('p', {}, `快捷存档（${quickSaveKey}）另有一个位置，不占八个普通记录；与普通记录一样，默认消耗一张命令书，开启免费记录后不消耗。己方回合的战略地图可存档，F8 快捷读档；在我军回合的战场读取会放弃当前战斗。快捷记录可以反复读取，不是只能继续一次的战场中断。`),
    h('p', {}, '武将不会自然回复体力、也不会自然增加忠诚，需靠医馆与赏赐。每将最多带1000兵，征兵每百人20金，再用「分兵」分配。'),
    h('h4', {}, '地名'), h('p', { class: 'placenames-help' }, placeNamesHelp()),
    h('h4', {}, '战争'), h('p', {}, '出阵时选武将、总大将并携带金米。攻方先行动，机动力全军共用，按总兵数每天恢复。金色轮廓围出的范围可移动（指向其中一格会画出行军箭头和消耗）、橙框为城、四角红框的敌将可攻击（2机动力）、四角紫框为计略目标；按住 R（3D 战场也可点右下的「威」）显示敌军威胁范围（红色斜纹：敌军下次行动时任何一名敌将单独能打到的格子，指着敌将只看他一人）；[ 和 ] 切换我方武将；点名牌等于点这名武将，被山挡住的武将点他的剪影；选了计略后镜头会移到目标处，也可以直接在目标名单里点名字；拖动可平移。攻方踏上城格即胜；总大将阵亡/被俘/退却即败；30日未决或米尽则败。'),
    h('p', {}, '智力越高可用计略越多（40/60/75/85分档，诸葛亮等名士随等级解锁特殊计）。命中率看双方智力、等级与距离（6格内）。'),
    h('h4', {}, '白兵与单挑'), h('p', {}, '攻击会进入16×10的白兵战场：先选阵形（长蛇、雁行、锥行、鱼鳞），每100兵一队，按步→弓→骑→将的顺序行动。交战中可分别给将、骑、弓、步下令前进、后退、待机或包围（「全军」一栏可一次令各兵种待机或包围），并用战术点施展咒缚、挑发、强弩、士气向上、火矢、爆炎；也可暂停、变速、交给自动或全军撤退。'),
    // Rules players asked about (feedback F13, F22a, F23, 2026-11-02).
    h('p', {}, '战术点每场按智力给出（智力×13÷100，用掉不回复）：爆炎需12点，即智力93以上；己方战术生效期间不能再用其他战术，只有爆炎可以照常施放。第4回合起，敌将体力低于45／40／30（LEVEL 1／2／3）且有两队以上与他相邻时，每回合有机会将他擒获；君主忠诚为100，不会被擒，只能击败或逼退。'),
    h('p', {}, '两将相邻即进入单挑，我方武将单挑时可选择攻击、牵制、舍身、说得、骂倒或退却，也可查看资料；体力归零即阵亡。在单挑中斩杀君主有50%得到龙牙刀，全局只此一把；曹操、董卓、马腾、刘备各有专属宝物与条件。宝物只在单挑中斩杀时得到，白兵中击杀或对方退却都不会得到；宝物会替换胜者原有的装备。'),
    h('p', {}, `${FLAT_RULE}：用左键拖动平移、滚轮缩放，H不起作用。${WAR_RULE}；平面战场不能旋转与远近缩放。`),
    // What the help used to leave out (feedback R11, 2026-11-02) is in the 操作 page's 键鼠 tabs (src/controls.js).
    h('p', {}, '节奏：电脑回合、AI之间的战争、计略与白兵默认按原版时长播放；「☰ 系统 → 游戏速度」可改为快速（2倍）或最快（4倍），演出中按 Enter／空格可跳过当前一段。')),
  h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => close(null) }, '关闭'))], { wide: true });
}

// 地名 原版／考据 (core/game.js setPlaceNames): what the row, its tooltip and the 说明 say follows the switch, and the pairs are read
// from the data, so a name changed there is changed in every sentence here.
const placeNamesText = () => `地名 ${G.placeNames() ? '考据' : '原版'}`;
const placePairsText = () => G.placeNamePairs().map(([a, b]) => `${a}→${b}`).join('、');
const placeNamesTitle = () => `原版：城名照原版　考据：${G.placeNamePairs().length}座以州、关或县为名的城改用更具体的地名（${placePairsText()}）。${PLACE_NOTE}只换显示的名字，城的位置、道路与规则不变，记录通用。现在是${G.placeNames() ? '考据' : '原版'}`;
// Not every name is where its city stands, and the text says so (the three are data/base-map.json's, checked in tests/placenames.test.mjs).
const PLACE_NOTE = '多数是城所在地当时的郡县名；北平、陈留、许昌取其知名，比城在地图上的位置偏出一二百公里。';
const placeNamesHelp = () => (G.placeNames()
  ? `现在显示考据地名：原版有${G.placeNamePairs().length}座城以州、关或县为名，改用更具体的地名（原版名→现用名）：${placePairsText()}。${PLACE_NOTE}${PHONE ? '' : '城市面板的城名旁注有原版名。'}只换名字，城的位置、道路与规则都和原版一样，记录通用；「☰ 系统 → 地名」可换回原版。`
  : `现在显示原版地名。原版有${G.placeNamePairs().length}座城以州、关或县为名；「☰ 系统 → 地名」改为考据后，它们改用更具体的地名（原版名→考据名）：${placePairsText()}。${PLACE_NOTE}只换名字，城的位置、道路与规则不变，记录通用。`);

// ---------- Title ----------
// The flat 战略地图 is a picture with no post effects to switch; the 白兵 and 单挑 scenes still have them, so the setting itself stays as it is.
// The row follows the map on screen, in a menu left open through a switch too (setMode).
const FLAT_RULE = '画质「低」时战略地图是平面画面，不能旋转';
const WAR_RULE = '战场是平面还是3D看「☰ 系统 → 战场」：随画质（默认）时画质「低」为平面战场，也可固定为平面或3D';
const hd2dMoot = () => mode === strategy && !!strategy.flat;
const hd2dText = () => (hd2dMoot() ? 'HD-2D 不可用' : `HD-2D ${post.enabled ? '开' : '关'}`);
function syncHd2dRow(rows = $$('.hd2d-row')) {
  for (const b of rows) {
    b.disabled = hd2dMoot(); b.textContent = hd2dText();
    if (b.disabled) b.title = FLAT_RULE; else b.removeAttribute('title');
  }
}
const hd2dRow = (b) => { b.classList.add('hd2d-row'); syncHd2dRow([b]); return b; };
const SHAKES = [[1, '标准'], [0.4, '减弱'], [0, '关']], shakeText = () => (SHAKES.find(([v]) => v === shakeLevel()) ?? SHAKES[0])[1];
// 镜头复位 (系统 menu, or C): on the strategy map the city in play (the map's own selection is cleared while an AI war plays), else the ruler's.
const resetCamera = () => mode?.resetView?.(mode === strategy ? sel ?? g?.factions[g.player]?.city : undefined);
// Low-frequency switches live behind one 系统 button so they never sit over the field or a unit label.
let sysTab = null; // the phone's 系统 menu: the tab last looked at
// The desktop window (desktop/preload.js); a browser, a phone and the Android package have none, and show neither row.
// 全屏 is the same switch as F11 / Alt+Enter: fullscreen has no title bar and the game no menu bar, so players who found
// their way in could not find the way out, nor a way to leave the game at all (2026-11-17).
const desk = window.desktop ?? null;
// 退出游戏 where a shell can close the game: the desktop window, or the Android package (window.NativeShell,
// apk/.../MainActivity.java; kofwinner@devblog #641). Read when drawn, not at load: the shell adds it as the page loads.
const shellQuit = () => desk ? () => desk.quit() : window.NativeShell?.quit ? () => window.NativeShell.quit() : null;
// ---------- 更新 (online updates: desktop/updater.js; docs/在线增量更新方案与开发交接_2026-11-23.md) ----------
// The shell's updater, where there is one: the desktop release build (desktop/preload.js). Android (Phase 2) will give the same
// calls under window.BawangUpdater. Nothing here goes online by itself: the shell checks only when asked here, or after the
// title when the player turned 启动时自动检查更新 on, and tells every step (onEvent).
const updater = (() => { const u = desk?.updater ?? window.BawangUpdater ?? null; return u?.enabled ? u : null; })();
let updState = { phase: 'idle' };
const updListeners = new Set();
updater?.onEvent((st) => { updState = st; for (const f of updListeners) f(st); });
const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Switching the version reloads the page: only on the title with no game on (the shell checks this again).
const canSwitch = () => !g && document.body.dataset.screen === 'title';
// The title's 发现新版本: shown once a check found something, and never in the way (a corner button, no dialog of its own).
function updateBadge() {
  const b = h('button', { class: 'btn tt-update', hidden: true, onclick: () => updateDialog() });
  const show = (st) => {
    if (!b.isConnected && b.dataset.on) return updListeners.delete(show);
    const text = st.phase === 'update' ? `发现新版本 ${st.version}` : st.phase === 'downloading' ? `正在下载 ${st.version}（${Math.floor((st.done / st.bytes) * 100)}%）`
      : st.phase === 'ready' ? `新版本 ${st.version} 已下载` : st.phase === 'shell-required' ? `新版本 ${st.version} 需下载完整包` : '';
    b.hidden = !text; b.textContent = text; b.dataset.on = '1';
  };
  if (updater) { updListeners.add(show); show(updState); }
  return b;
}
function updateDialog({ check = false } = {}) {
  if (!updater) return;
  const body = h('div', { class: 'update-body' }), foot = h('div', { class: 'foot' });
  const now = h('p', { class: 'update-now' }), auto = h('input', { type: 'checkbox' });
  const revertRow = h('div', { class: 'update-revert' });
  let info = null, close = null;
  const versionLine = () => { now.textContent = info ? `当前版本 ${info.active ?? info.base}${info.active ? `（在 ${info.base} 完整包上更新）` : ''}` : ''; };
  const btn = (text, onclick, primary = false) => h('button', { class: `btn${primary ? ' primary' : ''}`, onclick }, text);
  const notes = (st) => (st.notes?.length ? h('ul', { class: 'update-notes' }, st.notes.map((n) => h('li', {}, n))) : null);
  const head = (st, tail = '') => h('p', { class: 'update-head' }, `${st.version}${st.releasedAt ? `（${st.releasedAt.slice(0, 10)}）` : ''}${tail}`);
  const shut = btn('关闭', () => close(null));
  const render = (st) => {
    body.replaceChildren(); foot.replaceChildren();
    revertRow.hidden = st.phase === 'downloading' || st.phase === 'checking';
    const put = (...xs) => body.append(...xs.filter(Boolean));
    if (st.phase === 'checking') { put(h('p', {}, '正在检查更新…')); foot.append(shut); }
    else if (st.phase === 'latest' || st.phase === 'idle') { put(h('p', {}, st.phase === 'latest' ? '已是最新版本。' : '尚未检查。')); foot.append(btn('检查更新', () => updater.check()), shut); }
    else if (st.phase === 'skip') { put(h('p', {}, `新版本 ${st.version} 上次在这台电脑上未能正常启动，已退回，自动检查不再提示。`)); foot.append(btn('仍要查看', () => updater.check()), shut); }
    else if (st.phase === 'update') {
      put(h('p', { class: 'update-kicker' }, st.cancelled ? '下载已取消。' : '发现新版本'), head(st), notes(st),
        st.bad ? h('p', { class: 'hint update-warn' }, '这个版本上次在这台电脑上未能正常启动，已自动退回。可以再试一次；若仍不行，会再次自动退回。') : null,
        h('p', { class: 'update-size' }, `需下载 ${mb(st.bytes)}，下载期间可以照常游玩。`));
      foot.append(btn('稍后', () => close(null)), btn('下载', () => updater.download(), true));
    } else if (st.phase === 'downloading') {
      const k = st.bytes ? st.done / st.bytes : 0;
      put(h('p', { class: 'update-kicker' }, `正在下载 ${st.version}`), h('div', { class: 'update-bar', role: 'progressbar', 'aria-valuenow': Math.round(k * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${(k * 100).toFixed(1)}%` } })),
        h('p', { class: 'update-size' }, `${mb(st.done)} ／ ${mb(st.bytes)}`), h('p', { class: 'hint' }, '关闭这个窗口不会中断下载。'));
      foot.append(btn('取消下载', () => updater.cancel()), shut);
    } else if (st.phase === 'ready') {
      put(h('p', { class: 'update-kicker' }, '新版本已下载'), head(st), notes(st),
        h('p', { class: 'hint' }, canSwitch() ? '「立即生效」会重新载入游戏画面（不关闭窗口，记录不受影响）；选「稍后」则下次启动时生效。' : '正在游戏中：下次启动时生效，或回到标题画面后在这里选「立即生效」。'));
      foot.append(btn('稍后', () => close(null)));
      if (canSwitch()) foot.append(btn('立即生效', async (e) => { e.currentTarget.disabled = true; if (!(await updater.apply())) { toast('<em>请在标题画面、没有进行中的游戏时生效</em>', 3000); render(updState); } }, true));
    } else if (st.phase === 'shell-required') {
      put(h('p', { class: 'update-kicker' }, '新版本需要下载完整包'), head(st), notes(st),
        h('p', { class: 'hint' }, `这个版本改动了程序本身，不能在现有的 ${info?.base ?? ''} 完整包上在线更新。请在下载页面取得新的完整版本，解压后运行；记录保存在本机，不受影响。`));
      foot.append(shut, btn('打开下载页面', () => updater.openDownloadPage(), true));
    } else if (st.phase === 'error') {
      put(h('p', {}, `${st.error}。`), h('p', { class: 'hint' }, st.retry === 'download' ? '已下载的部分已丢弃，游戏不受影响。' : '可能是网络暂时不通；游戏不受影响，可以照常离线游玩。'),
        st.detail ? h('p', { class: 'update-detail' }, st.detail) : null);
      foot.append(shut, btn('重试', () => (st.retry === 'download' ? updater.check().then((x) => x?.phase === 'update' && updater.download()) : updater.check()), true));
    }
  };
  const revert = () => {
    revertRow.replaceChildren();
    if (!info?.canRevert) return;
    revertRow.append(h('button', { class: 'btn update-revert-btn', disabled: !canSwitch(), title: canSwitch() ? '' : '在标题画面、没有进行中的游戏时可用', onclick: async () => {
      if (!(await confirmBox('回退到原始版本', `不再使用在线更新的 ${info.active}，退回到完整包自带的 ${info.base}，并重新载入游戏画面。记录保存在本机，不受影响；之后可以在这里手动检查更新，重新安装最新版本。`))) return;
      if (!(await updater.revert())) toast('<em>请在标题画面、没有进行中的游戏时回退</em>', 3000);
    } }, `回退到原始版本 ${info.base}`));
  };
  const listen = (st) => { if (!body.isConnected) return updListeners.delete(listen); render(st); };
  updListeners.add(listen);
  auto.onchange = () => updater.setAutoCheck(auto.checked);
  const opts = h('div', { class: 'update-opts' }, h('label', { class: 'update-auto', title: '开启后，每次启动游戏、进入标题画面一会儿后联网检查一次；关闭时只有在这里检查才联网' }, auto, '启动时自动检查更新'), revertRow);
  modal('更新', (c) => { close = c; return [now, body, opts, foot]; }, { label: '更新' }).then(() => updListeners.delete(listen));
  render(updState);
  updater.getState().then((s) => {
    if (!s) return;
    info = s.info; auto.checked = !!info.autoCheck; versionLine(); revert();
    updState = s.status ?? updState;
    if (check && !['downloading', 'checking', 'ready'].includes(updState.phase)) updater.check(); else render(updState);
  });
}

const quitKeys = () => desk ? (desk.mac ? '⌘Q' : 'Alt+F4') : '返回键';
let fullscreen = false;
const fullscreenText = () => `全屏 ${fullscreen ? '开' : '关'}`;
const fullscreenKeys = desk?.mac ? '⌥Enter' : 'F11 或 Alt+Enter';
if (desk) {
  const set = (on, tell) => {
    const was = fullscreen; fullscreen = !!on;
    for (const b of $$('.fullscreen-row')) b.textContent = fullscreenText();
    if (tell && fullscreen && !was) toast(`已全屏：按 ${fullscreenKeys}，或「☰ 系统 → 全屏」恢复窗口`, 4500);
  };
  Promise.resolve(desk.isFullscreen()).then((on) => set(on, false), () => {});
  desk.onFullscreen((on) => set(on, true));
  // 界面大小's row names the zoom in use, which the window changes too (maximize, full screen, another screen).
  onUiZoom(() => { for (const b of $$('.uisize-row')) b.textContent = uiSizeLabel(); });
}
function syncPadHints() {
  document.body.dataset.padRecordKeys = ['x', 'view'].filter(recordAction).join(' ');
  const hints = $('.topbar .record-hints');
  if (hints) hints.replaceChildren(...Object.entries(RECORD_ACTIONS).flatMap(([action, label]) => {
    const key = recordKey(action);
    return key ? [h('span', {}, h('kbd', { 'data-glyph': key, 'aria-label': padKey(key) }), label)] : [];
  }));
}
syncPadHints();
function useRecordAction(action, close) {
  if (action === 'save') {
    const why = saveBlocked();
    if (why) return toast(`<em>${why}</em>`, 3500);
  }
  close?.();
  switch (action) {
    case 'save': return runCommand(saveCity(), '记录');
    case 'load': return loadRecord();
    case 'quickSave': return quickRecord();
    case 'quickLoad': return quickLoad();
  }
}
function recordLabel(action, inGame) {
  const key = recordKey(action);
  return key && inGame ? `${RECORD_ACTIONS[action]}　${padKey(key)}` : RECORD_ACTIONS[action];
}
function sysButtons() {
  const list = h('div', { class: 'sysmenu-list', role: 'menu', hidden: true });
  const item = (label, f, title, padPage) => h('button', { class: 'btn', role: 'menuitem', title, 'data-pad-page': padPage, onclick: (e) => { e.stopPropagation(); f(e.currentTarget); } }, label());
  const recordItem = (action, title) => {
    const label = () => pad.active ? recordLabel(action, !!g && !inWar()) : RECORD_ACTIONS[action] +
      ({ quickSave: ' ' + quickSaveKey, quickLoad: ' F8' }[action] ?? '');
    const row = item(label, () => useRecordAction(action, close), title);
    row.dataset.record = action;
    return row;
  };
  const close = () => { list.hidden = true; removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  // A rule between groups; rows the current screen does not offer leave no empty group behind.
  // Each group has a name: on a phone the menu shows one group at a time under a row of tabs (src/phone.css), the tab last
  // looked at first. Every row is built either way and stays in the list, so what looks a row up by its text still finds it.
  const group = (tab, ...rows) => { rows = rows.filter(Boolean); return rows.length ? h('div', { class: 'sysmenu-group', role: 'group', 'data-tab': tab, 'aria-label': tab }, ...rows) : ''; };
  const showTab = (t) => { sysTab = t; for (const el of list.querySelectorAll('[data-tab]')) el.classList.toggle('on', el.dataset.tab === t); for (const b of list.querySelectorAll('.sysmenu-tabs .btn')) b.setAttribute('aria-selected', String(b.dataset.tab === t)); };
  const tabs = () => {
    delete list.cyclePage;
    list.classList.toggle('pad-pages', pad.active);
    if (pad.active) {
      const pages = new Map();
      const add = (name, row) => {
        if (!pages.has(name)) pages.set(name, group(name, row));
        else pages.get(name).append(row);
      };
      for (const row of list.querySelectorAll('[role=menuitem], .sysrange')) {
        const section = row.closest('.sysmenu-group').dataset.tab;
        const name = row.dataset.padPage ?? (section === '记录' ? '常用' : section);
        add(name, row);
      }
      const common = pages.get('常用') ?? h('div', { class: 'sysmenu-group', 'data-tab': '常用', role: 'group', 'aria-label': '常用' });
      if (!g) common.prepend(...common.querySelectorAll('[data-pad-page="常用"]'));
      if (!g) common.prepend(item(() => '读取记录', () => { close(); loadRecord(); }));
      if (pages.has('战斗')) {
        common.querySelector('[data-record=save]')?.remove();
        common.querySelector('[data-record=quickSave]')?.remove();
        common.prepend(...pages.get('战斗').children);
      }
      const hand = pages.get('手柄');
      const labels = new Map();
      const refresh = () => {
        for (const [action, btn] of labels) {
          const k = recordKey(action);
          btn.textContent = `${RECORD_ACTIONS[action]}　${k ? padKey(k) : '未绑定'}`;
        }
        for (const row of common.querySelectorAll('[data-record]')) row.textContent = recordLabel(row.dataset.record, mode === strategy && !!g && !inWar());
        syncPadHints();
      };
      for (const action of Object.keys(RECORD_ACTIONS)) {
        const btn = item(() => '', async () => { await configureRecordButton(action, padKey); refresh(); });
        labels.set(action, btn);
        hand.append(btn);
      }
      hand.append(item(() => '恢复默认快捷键', async () => { await resetRecordButtons(); refresh(); }));
      refresh();
      const order = [common, ...['画面', '声音', '演出', '规则', '手柄', '其他'].map(name => pages.get(name)).filter(Boolean)];
      const nav = h('div', { class: 'pad-page-tabs', role: 'tablist', 'aria-label': '系统分类' });
      let current = 0;
      const show = i => {
        current = i;
        order.forEach((section, j) => {
          section.hidden = i !== j;
          section.classList.toggle('on', i === j);
          nav.children[j].setAttribute('aria-selected', String(i === j));
        });
        const first = order[i].querySelector('button, input');
        list.querySelector('[data-pad-first]')?.removeAttribute('data-pad-first');
        first?.setAttribute('data-pad-first', '');
        if (!list.hidden) first?.focus();
      };
      order.forEach((section, i) => nav.append(h('button', { class: 'btn', role: 'tab', onclick: () => show(i) }, section.dataset.tab)));
      list.replaceChildren(nav, ...order, h('small', { class: 'hint' }, ...padText(k => `${k('lb')}／${k('rb')} 切换分类`)));
      list.cyclePage = d => show((current + d + order.length) % order.length);
      show(0);
      return;
    }
    if (!PHONE) return;
    const names = [...list.querySelectorAll('.sysmenu-group')].map((el) => el.dataset.tab);
    list.prepend(h('div', { class: 'sysmenu-tabs', role: 'tablist' }, ...names.map((t) => h('button', { class: 'btn', role: 'tab', 'data-tab': t, onclick: (e) => { e.stopPropagation(); showTab(t); } }, t))));
    showTab(names.includes(sysTab) ? sysTab : names[0]);
  };
  // A volume: on a phone − and ＋ stand beside the slider (a thumb drags a short slider badly); each is one of its steps.
  const nudge = (d) => (PHONE ? h('button', { class: `btn mini nudge ${d < 0 ? 'less' : 'more'}`, 'aria-label': d < 0 ? '减小' : '增大', onclick: (e) => { e.preventDefault(); e.stopPropagation(); const i = e.currentTarget.parentNode.querySelector('input'); d < 0 ? i.stepDown() : i.stepUp(); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } }, d < 0 ? '−' : '＋') : null);
  const column = (...groups) => h('div', { class: 'sysmenu-col' }, ...groups);
  const soundRow = () => item(() => `声音 ${audio.muted ? '关' : '开'}`, (b) => { audio.unlock(); audio.setMuted(!audio.muted); b.textContent = `声音 ${audio.muted ? '关' : '开'}`; });
  const trackRow = () => item(() => `曲目 ${audio.sets.find((t) => t.id === audio.set).label}`, (b) => {
    const i = audio.sets.findIndex((t) => t.id === audio.set), next = audio.sets[(i + 1) % audio.sets.length];
    audio.unlock(); audio.setMusicSet(next.id); b.textContent = `曲目 ${next.label}`;
  }, `切换背景音乐版本：${audio.sets.map((t) => t.label).join('／')}`);
  // Two columns: the window's settings on the left, this game's rules and records on the right. One column of 21 rows
  // ran off the bottom of a 1280x800 window (and more of it in a war, where the menu starts lower).
  const fill = () => (list.replaceChildren(column(
    group('画面',
    mode?.resetView ? item(() => '镜头复位（C）', () => { resetCamera(); close(); }, '回到默认视角（选中的城市或武将居中）（C）') : '',
    // The 3D war map's minimap, put away or brought back (M; its own button is the mouse's). A pad has no button left on the war map
    // for it, so the row is here, and only once a pad has been used: the list is at its height at 1024x600 without it.
    warNav && pad.seen && mode === war ? item(() => `小地图 ${warNav.open ? '开' : '关'}`, (b) => { warNav.toggleMini(); b.textContent = `小地图 ${warNav.open ? '开' : '关'}`; }, '收起或显示战场右下角的小地图（M）') : '',
    hd2dRow(item(hd2dText, toggleHd2d)),
    item(qualityText, (b) => {
      const was = [mapLabel(), nextWarLabel()]; quality.cycle(); syncQualityRows();
      const mapTo = mapLabel() !== was[0] ? mapLabel() : null, warTo = nextWarLabel() !== was[1] ? nextWarLabel() : null;
      if (!mapTo && !warTo) return;
      if (inWar()) toast([mapTo ? `回到战略地图后改用${mapTo}地图` : '', warTo ? `本场仍为${warViewLabel()}战场，下一场战争起为${warTo}战场` : ''].filter(Boolean).join('；'), 4500);
      // A map still to be built, or a screen it must wait for, does not change as he clicks: the toast must be true of what he sees.
      else if (!mapTo) toast(`战场从下一场战争起为${warTo}画面`, 3500);
      else {
        const now = strategy.built(mapKind()) && mapCalm(), held = `战场仍为${nextWarLabel()}（「战场」设为${warView.label}）`;
        toast(now ? (warTo ? `战略地图和战场改用${mapTo}画面，战场从下一场战争起生效` : `战略地图改用${mapTo}画面；${held}`)
          : `正在准备${mapTo}画面，稍后切换；${warTo ? '战场从下一场战争起生效' : held}`, 3500);
      }
    }, `高：完整效果　中：降低内部分辨率与遮蔽精度，更流畅　低：关闭环境遮蔽，适合核显。${FLAT_RULE}，随即切换。${WAR_RULE}`),
    item(warViewText, () => {
      warView.cycle(); syncQualityRows();
      if (inWar() && nextWarLabel() !== warViewLabel()) toast(`本场仍为${warViewLabel()}战场，下一场战争起为${nextWarLabel()}战场`, 4500);
    }, '战场用平面画面还是3D画面　随画质：画质「低」时平面，中、高时3D　平面：始终平面，不能旋转与远近缩放，适合核显　3D：始终为可旋转、缩放的3D战场。开战时决定：战争中更改，从下一场战争起生效'),
    // 界面大小 shares 全屏's row: both are the desktop window's, and a row of its own would run the column past a 1024x600 window.
    desk ? h('div', { class: 'sysmenu-pair' },
      (() => { const b = item(fullscreenText, () => desk.toggleFullscreen(), `铺满整个屏幕，再选一次恢复窗口（${fullscreenKeys}）`); b.classList.add('fullscreen-row'); return b; })(),
      uiSizeOn() ? (() => {
        const b = item(uiSizeLabel, () => { cycleUiSize().then((z) => { if (z) toast(uiSizeNote(), 3500); }); b.textContent = uiSizeLabel(); },
          '整个画面（面板、菜单、文字与地图）按屏幕分辨率放大，依次为标准、大、小、中　标准：1920×1080 的屏幕按 125%、2560×1440 按 175% 显示　大：再大一档　小：不放大，与 0.4.1 及以前相同　中：2560×1440 按 150%（0.4.2 的大小）、1920×1080 不放大。窗口模式下放大到窗口放得下为止，窗口较小时不放大');
        b.classList.add('uisize-row'); return b;
      })() : '') : '',
    // 地图标签 shares 帧率's row: a row of its own ran the column 9px past a 1024x600 window in a war (tests/desktopwindow.test.mjs).
    h('div', { class: 'sysmenu-pair' },
      item(() => `地图标签 ${labelSizeText()}`, (b) => { cycleLabelSize(); b.textContent = `地图标签 ${labelSizeText()}`; },
        '地图上城名、武将名牌、村落与地形牌，以及白兵部队兵力条的大小　小／标准／大。面板和按钮的文字不变'),
      item(() => `帧率 ${frameCap.label}`, (b) => { frameCap.toggle(); b.textContent = `帧率 ${frameCap.label}`; },
        '60：每秒最多绘制60帧，在120Hz等高刷新率屏幕上更省电、风扇更安静　不限：按屏幕刷新率绘制。动作与计时快慢不受影响')),
    // Shown once a pad has been used here: which face button confirms (the other cancels).
    pad.seen ? item(confirmText, (b) => { pad.setConfirm(pad.confirm === 'east' ? 'south' : 'east'); b.textContent = confirmText(); },
      '手柄上哪个键确定（另一个取消）　下：Xbox／PlayStation 欧美习惯　右：任天堂与日式习惯。默认按手柄型号', '手柄') : '',
    ), group('声音',
    // 曲目 shares 声音's row when both music sets are here (the shipped build): with a pad used in a war (小地图 and 确定键 on
    // the left) the column ran 9px past a 1024x600 window (tests/desktopwindow.test.mjs).
    audio.sets.length > 1 ? h('div', { class: 'sysmenu-pair' }, soundRow(), trackRow()) : soundRow(),
    h('label', { class: 'btn sysrange', title: '背景音乐音量（音效另调）' }, h('span', {}, '音乐'),
      h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(audio.volume * 100), 'aria-label': '音乐音量', oninput: (e) => { audio.unlock(); audio.setVolume(e.target.value / 100); e.target.nextSibling.textContent = `${e.target.value}%`; } }),
      h('small', {}, `${Math.round(audio.volume * 100)}%`), nudge(-1), nudge(1)),
    h('label', { class: 'btn sysrange', title: '音效音量（背景音乐另调）' }, h('span', {}, '音效'),
      h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(audio.sfxVolume * 100), 'aria-label': '音效音量', oninput: (e) => { audio.unlock(); audio.setSfxVolume(e.target.value / 100); e.target.nextSibling.textContent = `${e.target.value}%`; }, onchange: () => audio.sfx('sfx-clash') }),
      h('small', {}, `${Math.round(audio.sfxVolume * 100)}%`), nudge(-1), nudge(1)),
    ), group('演出',
    item(() => `游戏速度 ${paceLabel()}`, (b) => { const i = PACES.findIndex(([v]) => v === paceSpeed()); setPace(PACES[(i + 1) % PACES.length][0]); b.textContent = `游戏速度 ${paceLabel()}`; },
      '原版：电脑回合、AI之间的战争、计略与白兵按原版时长播放　快速：2倍　最快：4倍（玩家自己的操作不受影响；演出中按 Enter／空格可跳过当前一段）'),
    item(() => `演出 ${vignettesOn() ? '开' : '关'}`, (b) => { setVignettes(!vignettesOn()); b.textContent = `演出 ${vignettesOn() ? '开' : '关'}`; }, '执行命令时播放的小动画（点击画面可跳过）'),
    item(() => `震屏 ${shakeText()}`, (b) => { const i = SHAKES.findIndex(([v]) => v === shakeLevel()); setShakeLevel(SHAKES[(i + 1) % SHAKES.length][0]); b.textContent = `震屏 ${shakeText()}`; },
      '重击、爆炎与标题箭矢的画面震动　标准：原样　减弱：四成　关：不震（顿帧、火花与闪光照旧）'),
    )), column(
    group('规则',
    g ? item(() => `登场情报 ${TALENT_MODES[talentMode]}`, (b) => { const ks = Object.keys(TALENT_MODES); setTalentMode(ks[(ks.indexOf(talentMode) + 1) % ks.length]); b.textContent = `登场情报 ${TALENT_MODES[talentMode]}`; },
      '人物志与城市面板显示多少武将来历　关：只记自己的搜索　已登场：已登场武将的出仕年份与地点　全部：含未登场武将与各城搜索队列（剧透）') : '',
    g ? item(() => `武将寿命 ${g.ageless ? '不老' : '原版'}`, (b) => { g.ageless = !g.ageless; b.textContent = `武将寿命 ${g.ageless ? '不老' : '原版'}`; },
      '原版：武将到史实卒年后一年比一年易病逝　不老：各势力武将都不会因年老病逝（战死、斩首照旧）。随本局记录保存') : '',
    g ? item(() => `战场生死 ${g.noWarDeath ? '不战死' : '原版'}`, (b) => { g.noWarDeath = !g.noWarDeath; b.textContent = `战场生死 ${g.noWarDeath ? '不战死' : '原版'}`; },
      '原版：体力归零的武将阵亡　不战死：白兵、单挑、计略及电脑之间的战争中体力归零的武将改为被对方俘获，体力回复至30。君主不能被俘，照常阵亡；斩首照旧。随本局记录保存') : '',
    g ? item(() => `人才寻访 ${g.sangu ? '三顾' : '原版'}`, (b) => { g.sangu = !g.sangu; b.textContent = `人才寻访 ${g.sangu ? '三顾' : '原版'}`; refreshTalentNote(); },
      '原版：人才是否出仕看搜索结果与他心向的君主　三顾：某城的下一位人才可寻访时，在该城第3次搜索他必定出仕，不论他心向哪位君主。只对玩家的搜索有效，随本局记录保存') : '',
    g ? item(() => `电脑进攻 ${g.warlike ? '好战' : '原版'}`, (b) => { g.warlike = !g.warlike; if (!g.warlike) delete g.warlikeFought; b.textContent = `电脑进攻 ${g.warlike ? '好战' : '原版'}`; },
      '原版：电脑多数回合凑不齐出阵的武将和钱，打不成仗　好战（重制版新增）：电脑按月征兵补兵，内政看城里缺什么做，城的土地和产业、武将和兵都比原版多；钱先用在内政上，初级、中级电脑之间的战争比原版少。难度越高越凶：初级出发城所需武将同原版、搜人稍勤；中级搜人更勤，挑兵少的城打；上级另给电脑资源：金收入多一倍半、米收入多一倍半、每月多一张命令书、打过仗的武将下一回合开头补满、开发更快，新招武将忠诚可到95（更难离间、诱纳不了）。不改变战斗本身的强弱。随本局记录保存') : '',
    g ? item(() => `武将读书 ${g.noStudy ? '不能' : '原版'}`, (b) => { g.noStudy = !g.noStudy; b.textContent = `武将读书 ${g.noStudy ? '不能' : '原版'}`; markNoStudy(); },
      '原版：智力80以下的武将可在书馆学习，电脑也会让武将学习　不能：敌我武将都不能读书提高智力，城市菜单的「书馆」变灰。随本局记录保存') : '',
    g ? item(() => `记录消耗 ${g.freeSave ? '免费' : '原版'}`, (b) => { g.freeSave = !g.freeSave; b.textContent = `记录消耗 ${g.freeSave ? '免费' : '原版'}`; markFreeSave(); },
      '原版：每次记录消耗一张命令书　免费：记录不消耗命令书。随本局记录保存') : '',
    ), group('记录',
    g ? recordItem('save',
      '进度不会自动保存。在八个记录位置之一保存当前进度（消耗一张命令书，开启免费记录时不消耗；与城市菜单「城 → 记录」相同；己方回合、战略地图上可用）') : '',
    g && inWar() ? item(() => '中断战斗', () => { close(); suspendWar(); },
      '保存这场战斗的进行状态并回到标题，之后在标题画面「继续战斗」从此处接着打。不占记录位置、不消耗命令书；继续时取出，只能继续一次。己方回合、无动作进行时可用', '战斗') : '',
    g ? recordItem('load', '读取一份记录，从记录的月份接着玩（当前未记录的进度不保留）') : '',
    (g || G.hasQuick()) ? h('div', { class: 'sysmenu-quick' },
      g ? recordItem('quickSave',
        `存入独立的快捷记录，不占八个普通位置；消耗遵循「记录消耗」设置，己方回合、战略地图上可用（${quickSaveKey}）`) : '',
      recordItem('quickLoad', '读取快捷记录，当前未记录的进度将不保留（F8）')) : '',
    // 退出游戏 shares 回到标题's row in a game, 检查更新's on the title (an update is applied there only, so that is where it is
    // looked for): the right column is at its height in a 1024x600 window (tests/sysmenu.test.mjs).
    g || shellQuit() ? h('div', { class: 'sysmenu-pair' },
      g ? item(() => '回到标题', () => { close(); backToTitle(); }, '结束本局回到标题画面（记录编辑在那里打开）。未记录的进度会丢失，可先记录', '其他') : '',
      !g && updater ? item(() => '检查更新', () => { close(); updateDialog({ check: true }); }, '联网查看有没有新版本，并在这里下载、生效或回退；也可以打开「启动时自动检查更新」', '其他') : '',
      shellQuit() ? item(() => '退出游戏', () => { close(); quitGame(); }, `关闭游戏${g ? '。未记录的进度会丢失，可先记录' : ''}（${quitKeys()}）`, '其他') : '') : '',
    ), group('其他',
    // 地名 shares a row (with 欣赏模式 in a game, 记录编辑 on the title): the right column is at its height in a war in a 1024x600
    // window (tests/sysmenu.test.mjs).
    h('div', { class: 'sysmenu-pair' },
      item(placeNamesText, () => {
        // The menu closes on this one: every name on the map and in the panels behind it has just changed, and that is the answer.
        G.setPlaceNames(!G.placeNames()); writeFlag(G.PLACE_NAMES, G.placeNames()); close();
        // Names on screen are redrawn where they stand: the map and panels in a game, the title's map and its 继续战斗 card. A war's
        // own texts (banner, result, 中断) are written as they come up, so there the next one is already right.
        if (g && document.body.dataset.screen === 'strategy') { strategy.refresh(g); hud(); }
        else if (!g && document.body.dataset.screen === 'title') title();
        const [a0, b0] = G.placeNamePairs()[0];
        toast(G.placeNames() ? `城名改用考据地名（${a0}→${b0}等${G.placeNamePairs().length}城），新旧对照见「说明」` : `城名恢复原版（${b0}→${a0}等）`, 4000);
      }, placeNamesTitle()),
      g ? item(() => '欣赏模式', () => { close(); if (!canScenic()) return toast('<em>欣赏模式在己方回合的战略地图上可用</em>', 2500); setScenic(true); }, `隐藏界面欣赏地图与音乐，地图仍可${strategy.flat ? '' : '旋转、'}缩放、平移；按 V 或 Esc 恢复（V）`) : '',
      // The save editor (save-editor.html, same origin, so the same record slots) is opened from the title only, where no
      // unsaved game is lost; the title's opening is skipped on the way back.
      !g ? item(() => '记录编辑', () => { close(); try { sessionStorage.setItem('hd2d-title-seen', '1'); } catch {} location.replace(`save-editor.html${location.search}`); },
      '修改记录中武将、城市与同盟的数值，或为某份记录打开原版漏洞（阿会喃复制）。改完「写回记录」，回到游戏「读取记录」接着玩', '常用') : ''),
    PHONE && g ? item(() => '战报', () => { close(); logBook(); }, '最近的战报') : '',
    // 文字 shares 说明's row: the right column is at its height in a 1024x600 window (tests/sysmenu.test.mjs).
    h('div', { class: 'sysmenu-pair' }, item(langText, (b) => switchLang(b), langTitle()), item(() => '说明', () => { close(); help(); }))))), tabs());
  list.refreshPages = fill;
  const wrap = h('div', { class: 'sysbtns' },
    h('button', { class: 'btn sysmenu-btn', 'aria-haspopup': 'menu', title: '系统（镜头复位、画面、声音、音乐、演出、说明）', onclick: () => { if (list.hidden) { fill(); list.hidden = false; addEventListener('pointerdown', outside, true); } else close(); } }, '☰ 系统', h('kbd', { class: 'pad-only', 'data-glyph': 'start' })),
    list);
  return wrap;
}
// ---------- Records (save slots) ----------
// 系统 → 记录进度 runs the city menu's 记录 (one 命令书, as the original) from wherever the player is on the 战略地图, and says
// why not elsewhere (feedback F03, 2026-11-02: players found only 读取 in 系统 and lost their progress closing the window).
const inWar = () => !!g && document.body.dataset.screen === 'war';
const saveCity = () => (sel != null && mineCity(sel) ? sel : g.factions[g.player].city);
function saveBlocked() {
  if (inWar()) return '战争中不能记录：可用「☰ 系统 → 中断战斗」暂离，或战后回到战略地图，在己方回合记录';
  if (g.over || document.body.dataset.screen !== 'strategy') return '现在不能记录';
  if (g.current !== g.player || !endPlayer) return '电脑行动中：到己方回合再记录';
  if (busy || mapPick || blocking()) return '请先完成当前命令';
  if (g.books <= 0) return '本月命令书已用完：下月己方回合再记录';
  return null;
}
// A record holds the game with this command's 命令书 already spent, as the original; 免费记录 (g.freeSave, an option off
// by default and absent from older records) spends none.
const writeRecord = (n) => { if (g.freeSave) return G.save(g, n); g.books--; const ok = G.save(g, n); g.books++; return ok; };
const SLOT_NAMES = '一二三四五六七八九十';
const stamp = (t) => { if (!t) return '旧版记录'; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`; };
const recordLine = (s) => `${s.year}年${s.month + 1}月 · ${name(s.factions[s.player].ruler)} · ${G.citiesOf(s, s.player).length}城`;
const recordName = (n) => n === 'quick' || n == null ? '快捷存档' : `记录${SLOT_NAMES[n - 1]}`;
const recordAt = (n) => n === 'quick' ? G.loadQuick() : G.load(n);
// 'load' picks a filled slot to resume; 'save' picks any slot to write, and asks before overwriting another record.
function pickSlot(mode, list, current = null) {
  const rows = list.map((s, i) => ({ s, n: i + 1 }));
  if (mode === 'load') rows.unshift({ s: G.loadQuick(), n: 'quick' });
  // A slot with a record this game cannot read (another pack's, a major version apart) says why rather than looking empty.
  const why = (n) => (typeof n === 'number' ? G.unreadable(n) : null);
  return modal(mode === 'save' ? '记录' : '读取记录', (close) => [
    mode === 'save' ? h('p', {}, g.freeSave ? '选择记录位置（免费记录：不消耗命令书）' : '选择记录位置（消耗一张命令书，与原版相同）') : null,
    h('div', { class: 'slots' }, rows.map(({ s, n }) => h('button', { class: `btn slot ${s ? '' : 'empty'} ${n === current ? 'on' : ''}`, disabled: mode === 'load' && !s,
      onclick: async () => {
        if (mode === 'save' && s && n !== current && !(await confirmBox('覆盖记录', `${recordName(n)}（${recordLine(s)}）将被覆盖，确定吗？`))) return;
        if (mode === 'save' && !s && why(n) && !(await confirmBox('覆盖记录', `${recordName(n)}里有一份读不了的记录（${why(n)}），将被覆盖，确定吗？`))) return;
        close(mode === 'load' ? { n, record: s } : n);
      } },
      h('b', {}, recordName(n)), s ? [h('span', {}, recordLine(s)), h('small', {}, `${s.ageless ? '武将不老 · ' : ''}${s.noWarDeath ? '不战死 · ' : ''}${s.sangu ? '三顾 · ' : ''}${s.warlike ? '电脑好战 · ' : ''}${s.noStudy ? '不能读书 · ' : ''}${s.freeSave ? '免费记录 · ' : ''}${stamp(s.savedAt)}`)] : why(n) ? h('span', { class: 'unreadable' }, `读不了：${why(n)}`) : h('span', {}, n === 'quick' && G.hasQuick() ? '无法读取' : '空')))),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'))]);
}

// Loading during a campaign starts the page over and opens the record on boot: the running month (AI turns,
// a war, its 白兵 and their timers) ends with the page, so nothing from the old game can write into the new one.
const LOAD_KEY = 'haou-hd2d-load';
let quickLoading = false, quickCostExplained = false;
async function restartWithRecord(n, rec, { alwaysConfirm = false } = {}) {
  const held = peekSuspend();
  const loss = g ? (inWar() ? '当前战斗和未记录的进度将丢失。' : '当前未记录的进度将丢失。') : '';
  const warLoss = held ? `中断的${cityName(held.war.city)}之战（第${held.field.day}日）也将放弃。` : '';
  if ((g || held || alwaysConfirm) && !(await confirmBox('读取记录', `读取${recordName(n)}（${recordLine(rec)} · ${stamp(rec.savedAt)}）？${loss}${warLoss}`))) return;
  // Another tab may have replaced the record while the confirmation was open. Never discard the game to
  // load a different record from the one the player just saw and approved.
  const current = recordAt(n);
  if (!current || JSON.stringify(current) !== JSON.stringify(rec)) return toast('<em>记录已改变，请重新选择</em>', 3500);
  if (JSON.stringify(peekSuspend()) !== JSON.stringify(held)) return toast('<em>中断战斗已改变，请重新读档</em>', 3500);
  // Carry the exact record through the fade/reload; the shared slot can change after confirmation.
  // The suspended battle is not removed until that snapshot has been read and validated at the new boot.
  const pending = { kind: n, record: rec, backup: G.restored(rec), held: JSON.stringify(held) };
  try { sessionStorage.setItem(LOAD_KEY, JSON.stringify(pending)); } catch { return toast('<em>无法读取记录</em>'); }
  await fade(true); location.reload();
}
async function loadRecord() {
  const list = G.saves();
  if (!list.some(Boolean) && !G.loadQuick()) return toast('<em>还没有记录</em>');
  const pick = await pickSlot('load', list, g?.slot);
  if (!pick) return;
  await restartWithRecord(pick.n, pick.record);
}
async function quickRecord() {
  if (!g) return toast('<em>进入游戏后才能快捷存档</em>');
  const why = saveBlocked(); if (why) return toast(`<em>${why}</em>`, 3500);
  if (!mapCalm()) return toast('<em>请先完成当前动作</em>', 3000);
  await runCommand(saveCity(), '快捷记录');
}
async function quickLoad() {
  if (quickLoading) return;
  const screen = document.body.dataset.screen;
  if (blocking() || $('#fade.on') || $('.banner')) return toast('<em>请先完成当前动作</em>', 3000);
  if (screen === 'title') { if (!$('.tt.done, .tt.instant, .tt.menu-on')) return; }
  else if (screen === 'strategy') { if (!g || !mapCalm()) return toast('<em>请在己方回合完成当前命令后读档</em>', 3000); }
  else if (screen === 'war') { if (suspendBlocked()) return toast('<em>请在我军回合完成当前动作后读档</em>', 3000); }
  else return toast('<em>现在不能快捷读档</em>', 3000);
  const rec = G.loadQuick();
  if (!rec) return toast(G.hasQuick() ? '<em>快捷存档已损坏或来自更新版本</em>' : '<em>还没有快捷存档</em>', 3500);
  quickLoading = true;
  try { await restartWithRecord('quick', rec, { alwaysConfirm: true }); } finally { quickLoading = false; }
}
// Leaving also starts the page over, for the same reason, with the title's opening skipped as on the way back from
// 记录编辑. Nothing is left until the player says so: 取消, Esc, a failed record and backing out of the slots all stay.
// leaveGame asks; true once the player has said to go (and the record, if he chose one first, is written).
async function leaveGame(heading, question, go) {
  const why = saveBlocked();
  const act = await modal(heading, (close) => [
    h('p', {}, question),
    why ? h('p', { class: 'hint' }, `现在不能先记录：${why}`) : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'),
      h('button', { class: 'btn', onclick: () => close('leave') }, go),
      why ? null : h('button', { class: 'btn primary', onclick: () => close('save') }, '先记录'))]);
  if (!act) return false;
  if (act === 'save') {
    const n = await pickSlot('save', G.saves(), g.slot); if (!n) return false;
    if (!writeRecord(n)) { toast('<em>记录失败：浏览器存储不可用或已满，仍在本局</em>', 3500); return false; }
  }
  return true;
}
// 系统 → 文字: 简体 ⇄ 繁體（台湾标准，src/lang.js）. The page is converted as it loads, so the choice applies by reloading: at
// once on the title, where nothing is lost; in a game it is kept and applies at 回到标题 (which reloads), so a switch never
// throws away a game the player has not recorded.
const langText = () => `文字 ${LANGS[savedLang()]}${savedLang() !== lang ? '（回到标题后）' : ''}`;
const langTitle = () => '简体或繁体（台湾标准）。在标题画面切换立即生效；游戏中切换，回到标题画面后生效，不影响进度与记录';
function switchLang(b) {
  setLang(savedLang() === 'hant' ? 'hans' : 'hant');
  // ?lang= (tests, shots) would hold the old choice over the reload: it goes.
  if (!g) { try { sessionStorage.setItem('hd2d-title-seen', '1'); } catch {} const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.href); return; }
  b.textContent = langText();
  toast(savedLang() === lang ? `文字仍为${LANGS[lang]}` : `回到标题画面后改为${LANGS[savedLang()]}`, 3000);
}
async function backToTitle() {
  if (!(await leaveGame('回到标题', '未记录的进度会丢失。确定回到标题画面吗？', '不记录，回到标题'))) return;
  try { sessionStorage.setItem('hd2d-title-seen', '1'); } catch {}
  await fade(true); location.reload();
}
// 退出游戏 (the desktop game, the Android package): with a game on it asks as 回到标题 does; from the title there is
// nothing to lose. The window's own ✕ asks too, in the shell (desktop/main.js), where it also works over a page that is busy.
// asked: from the Android back key, which may be pressed by accident, so the title asks as well.
async function quitGame({ asked = false } = {}) {
  const quit = shellQuit(); if (!quit) return;
  if (g) { if (!(await leaveGame('退出游戏', '未记录的进度会丢失。确定退出游戏吗？', '不记录，退出'))) return; }
  else if (asked && (await modal('退出游戏', (close) => [h('p', {}, '确定退出游戏吗？'),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'), h('button', { class: 'btn primary', onclick: () => close('quit') }, '退出游戏'))])) !== 'quit') return;
  quit();
}
// The Android back key (BACK_JS in apk/.../MainActivity.java, after the ☰ menu and the phone's open card): Esc, one step back
// as before, and where there is nothing left to step back from, 退出游戏？ (kofwinner@devblog #641: back did nothing, and the
// only way out was the home key). Nothing left: no window, picture or command under way, and the title's menu up; on the
// strategy map the player's turn with no command list open (a picked city is put away first, as the pad's B does, except on a phone, where one is always chosen); on the war map the player's day, idle, with
// nothing for 返回 to put away. A second back press closes the question (its Esc), never quits.
window.__nativeBack = () => {
  const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  const screen = document.body.dataset.screen;
  if (blocking() || $('.shade, .vig, .panel.msg, .aiturn') || scenic || busy || mapPick || !shellQuit()) return esc();
  if (screen === 'title' && $('.tt.menu-on')) return quitGame({ asked: true });
  if (screen === 'setup') return [...document.querySelectorAll('.setup-foot .btn')].find((b) => b.textContent === zh('返回'))?.click(); // 返回 to the title, where Esc had no answer
  if (screen === 'strategy' && mode === strategy && g && g.current === g.player && !tabOpen) {
    if (sel != null && !PHONE) { onCity(null); return; } // the city put away, as the pad's B (padCancel); a phone always has one chosen (onCity)
    return quitGame({ asked: true });
  }
  if (screen === 'war' && mode === war && war) {
    if (PHONE && warRoster?.close?.()) return;
    if (war.cancel?.()) return; // what Esc does here: one step back
    if (war.myTurn && !war.st?.busy && !war.st?.deploying) return quitGame({ asked: true });
  }
  esc();
};
async function pendingLoad() {
  let raw = null;
  try { raw = sessionStorage.getItem(LOAD_KEY); } catch { return null; }
  if (!raw) return null;
  const discardPending = () => { try { if (sessionStorage.getItem(LOAD_KEY) === raw) sessionStorage.removeItem(LOAD_KEY); } catch {} };
  // A pending slot number from an older version still opens normally after upgrading the game.
  if (raw === 'quick' || /^[1-8]$/.test(raw)) {
    discardPending();
    const state = raw === 'quick' ? G.loadQuick() : G.load(Number(raw));
    return state ? { state, keepSuspend: false } : null;
  }
  let pending; try { pending = JSON.parse(raw); } catch { discardPending(); return null; }
  if (!(pending?.kind === 'quick' || (Number.isInteger(pending?.kind) && pending.kind >= 1 && pending.kind <= G.SLOTS)) || typeof pending.held !== 'string') { discardPending(); return null; }
  const state = G.loadSnapshot(pending.record, { quick: pending.kind === 'quick', backup: !!pending.backup });
  if (!state) { discardPending(); return null; }
  // Another page may replace a numbered slot at any point after confirmation. The confirmed snapshot
  // remains playable, but its next write to any occupied slot must be explicitly approved again.
  if (pending.kind !== 'quick') state.slot = null;
  return { state, keepSuspend: true, pendingRaw: raw, expectedHeld: pending.held, source: pending.kind };
}

// 数据包 (docs/战略地图数据包扩展设计_2026-11-17.md): the title's choice, from the packs mods/index.json lists (tools/check_pack.mjs
// --index); it holds for this browser until changed and takes a fresh page, as the boards and rules are built from it at boot.
// ?pack=<id> on the address wins over it, so the choice drops that parameter.
const packMenu = () => !!G.data().pack || new URLSearchParams(location.search).has('packs');
async function pickPack() {
  let list = [];
  try { const r = await fetch('mods/index.json', { cache: 'no-store' }); if (r.ok) list = await r.json(); } catch {}
  const now = G.data().pack?.id ?? null;
  const choice = await modal('数据包', (close) => [
    h('p', { class: 'hint' }, '数据包加入新的城、道路、势力和武将。装了数据包的记录单独存放，与本体的记录互不影响。'),
    // The desktop build also reads the player's own packs (desktop/main.js USER_MODS).
    location.protocol === 'app:' ? h('p', { class: 'hint' }, '自己的数据包：把包的文件夹放进「文稿/Three Kingdoms HD-2D/mods」，再打开这里。') : null,
    h('div', { class: 'slots packs' }, [{ id: null, name: '本体', author: '', version: '' }, ...(Array.isArray(list) ? list : [])].map((p) =>
      h('button', { class: `btn slot ${(p.id ?? null) === now ? 'on' : ''}`, onclick: () => close(p.id ?? 'none') },
        h('b', {}, String(p.name ?? p.id)), h('span', {}, p.id ? `${p.version ?? ''}${p.author ? ` · ${p.author}` : ''}${p.local ? ' · 文稿' : ''}` : '不装数据包')))),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'))]);
  if (choice == null || choice === (now ?? 'none')) return;
  try { localStorage.setItem(G.PACK_CHOICE, choice); } catch { return toast('<em>无法保存选择</em>'); }
  const u = new URL(location.href); u.searchParams.delete('pack');
  await fade(true); location.replace(u);
}
// A pack that would not load: the page plays the base game, and says why once on the title.
let packNoticed = false;
// It waits for the title's menu: a key or click that skips the opening would otherwise close it unread.
function packNotice(wrap) {
  if (packNoticed || !packLoad?.errors?.length) return;
  if (!wrap.isConnected) return;
  if (!wrap.matches('.menu-on, .done, .instant')) return requestAnimationFrame(() => packNotice(wrap));
  packNoticed = true;
  modal('数据包未能载入', (close) => [
    h('p', {}, `数据包「${packLoad.pack}」有 ${packLoad.errors.length} 处问题，这次按本体开始。`),
    h('ul', { class: 'pack-errors' }, packLoad.errors.slice(0, 12).map((e) => h('li', {}, e))),
    packLoad.errors.length > 12 ? h('p', { class: 'hint' }, `另有 ${packLoad.errors.length - 12} 处，用 tools/check_pack.mjs 查看全部。`) : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => { try { localStorage.setItem(G.PACK_CHOICE, 'none'); } catch {} close(); } }, '以后不再载入'),
      h('button', { class: 'btn primary', onclick: () => close() }, '知道了'))]);
}

let titleSeen = (() => { try { const v = sessionStorage.getItem('hd2d-title-seen') === '1'; sessionStorage.removeItem('hd2d-title-seen'); return v; } catch { return false; } })(); // back from 记录编辑
async function title() {
  document.body.dataset.screen = 'title'; g = null; sel = null; desk?.setUnsaved(false);
  const demo = G.newGame(4, 1, 7); strategy.refresh(demo); strategy.select(null);
  setMode(strategy); audio.playBgm('bgm-title');
  clear();
  const list = G.saves(), quick = G.loadQuick(), auto = PHONE ? G.loadAuto() : null; // auto: what a page the phone threw away left behind (自动续玩 below)
  const records = [...list, quick, auto].filter(Boolean), saved = G.latest(records), count = records.filter((r) => r !== auto).length, held = peekSuspend();
  // The opening (arrow, flash, band) plays once per visit; coming back from 选择君主 shows the finished title.
  const screen = createTitle({ audio, intro: !titleSeen, sys: sysButtons(),
    menu: [held ? h('button', { class: 'btn', onclick: async (e) => {
        if (e.currentTarget.disabled) return;
        e.currentTarget.disabled = true; audio.unlock();
        const result = await withSuspendLock(() => JSON.stringify(peekSuspend()) === JSON.stringify(held) ? { record: takeSuspend() } : { changed: true }, { legacyFallback: true });
        if (result?.record) begin(result.record.g, true, result.record);
        else { toast(result?.changed ? '<em>中断战斗已改变，请重新选择</em>' : '<em>中断的战斗已无法读取</em>', 3000); title(); }
      } }, '继续战斗',
        h('small', {}, `${cityName(held.war.city)}之战 · 第${held.field.day}日 · ${held.g.year}年${held.g.month + 1}月 · ${name(held.g.factions[held.g.player].ruler)}`)) : null,
      saved ? h('button', { class: 'btn', onclick: () => { audio.unlock(); begin(saved, true); } }, saved.auto ? '继续上次' : '继续记录', h('small', {}, `${saved.auto ? '离开时的进度' : recordName(saved.slot)} · ${saved.year}年${saved.month + 1}月 · ${name(saved.factions[saved.player].ruler)}`)) : null,
      count > 1 ? h('button', { class: 'btn', onclick: async () => {
        audio.unlock(); const pick = await pickSlot('load', list, saved.slot); if (!pick) return;
        const current = recordAt(pick.n);
        if (!current || JSON.stringify(current) !== JSON.stringify(pick.record)) return toast('<em>记录已改变，请重新选择</em>', 3500);
        begin(pick.record, true);
      } }, '读取记录') : null,
      h('button', { class: 'btn', onclick: () => { audio.unlock(); setup(); } }, '新的征程'),
      // 数据包 is still exploration (not in 0.3.7's notes): the button shows only with ?packs, or while a pack is on so it can be turned off.
      packMenu() ? h('button', { class: 'btn', onclick: () => { audio.unlock(); pickPack(); } }, '数据包', h('small', {}, G.data().pack ? `${G.data().pack.name} · ${G.data().pack.version}` : '本体')) : null,
      shellQuit() ? h('button', { class: 'btn', onclick: () => quitGame() }, '退出游戏') : null],
    footnote: [h('p', { class: 'free' }, ['本游戏免费发布，', '仅供爱好者交流，', '请勿付费购买'].map((t) => h('span', {}, t))),
      h('p', { class: 'maker' }, '制作　', rawText('tianlin'), ' ', h('small', {}, '@GitHub')),
      h('p', {}, '原作《三国志II 霸王的大陆》© 1992 NAMCO · 以FC日版规则为准 · 立绘由AI生成 · ' +
        (audio.sets.length > 1 ? `曲目可在「☰ 系统 → 曲目」切换 ${audio.sets.map((t) => t.label).join('／')}` : `音乐：${audio.sets[0]?.label ?? '合成音'}`))] });
  titleSeen = true;
  if (updater) screen.el.append(updateBadge());
  root().append(screen.el);
  packNotice(screen.el);
}

async function setup() {
  clear(); document.body.dataset.screen = 'setup'; audio.playBgm('bgm-select');
  // The rule switches start as the player left them last time (src/prefs.js), each shown pressed or not; the 难度 and the 秘技 do not.
  const opts = (() => { try { const o = JSON.parse(readPref(PREF.setup)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } })();
  let level = 1, ruler = null, cheat = false;
  let { ageless = false, noWarDeath = false, sangu = false, freeSave = false, warlike = false, noStudy = false } = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, v === true]));
  const keepOpts = () => writePref(PREF.setup, JSON.stringify({ ageless, noWarDeath, sangu, freeSave, warlike, noStudy }));
  const pressed = (b, on) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); keepOpts(); };
  const levels = h('div', { class: 'levels' });
  const keep = (box, draw) => { const i = [...box.children].indexOf(document.activeElement); draw(); if (i >= 0) box.children[i]?.focus(); };
  // LEVEL 1 also offers the original's 秘技 (G.maxRulerCity); it only applies while LEVEL 1 is chosen.
  // The original rings 98×3 the frame the 秘技 goes in (bank9 $DB30; original-audio-trace/cheat.json), not a victory phrase.
  const setCheat = (on) => { cheat = on; if (on) { level = 0; audio.sfx('sfx-chime'); } keep(levels, drawLevels); };
  const drawLevels = () => levels.replaceChildren(...['LEVEL 1', 'LEVEL 2', 'LEVEL 3'].map((t, i) => h('div', { class: `panel level ${level === i ? 'on' : ''}`, 'aria-pressed': level === i ? 'true' : 'false', ...pressable(() => { level = i; keep(levels, drawLevels); }) },
    h('b', {}, t), h('span', { class: 'lv-name' }, ['初阵', '群雄', '霸王'][i]), h('small', {}, ['收入较多，电脑190年起进攻', '标准难度', '收入较少，电脑开局即进攻'][i]),
    i === 0 ? h('button', { class: `cheat ${cheat && level === 0 ? 'on' : ''}`, 'aria-pressed': cheat && level === 0 ? 'true' : 'false', title: '原版秘技：选君主时按住START输入↑↓←→三次。君主所在城的金、米、人口、土地、后备兵为9999，产业999，防灾、统治、宝为99',
      onclick: (e) => { e.stopPropagation(); setCheat(!(cheat && level === 0)); }, onkeydown: (e) => e.stopPropagation() },
      h('i', {}), '秘技 · 君主城金米9999') : null)));
  drawLevels();
  const agelessBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：武将到史实卒年后一年比一年易病逝，六年后必逝。开启后各势力武将都不会因年老病逝（战死、斩首照旧）。游戏中也可在「☰ 系统」切换。',
    onclick: () => { ageless = !ageless; pressed(agelessBtn, ageless); } },
    h('i', {}), '武将不老 · 不会因年老病逝');
  const noDeathBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：体力归零的武将阵亡　不战死：白兵、单挑、计略及电脑之间的战争中体力归零的武将改为被对方俘获，体力回复至30。君主不能被俘，照常阵亡；斩首照旧。便于收集武将；游戏中也可在「☰ 系统」切换。',
    onclick: () => { noWarDeath = !noWarDeath; pressed(noDeathBtn, noWarDeath); } },
    h('i', {}), '武将不战死 · 体力归零改为被俘');
  const sanguBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：人才是否出仕看搜索结果与他心向的君主　三顾：某城的下一位人才可寻访时，在该城第3次搜索他必定出仕，不论他心向哪位君主。只对玩家的搜索有效；游戏中也可在「☰ 系统」切换。',
    onclick: () => { sangu = !sangu; pressed(sanguBtn, sangu); } },
    h('i', {}), '三顾模式 · 第3次搜索必定出仕');
  const warlikeBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：电脑多数回合凑不齐出阵的武将和钱，打不成仗　好战（重制版新增）：电脑按月征兵补兵，内政看城里缺什么做，城的土地和产业、武将和兵都比原版多；钱先用在内政上，初级、中级电脑之间的战争比原版少。难度越高越凶：初级出发城所需武将同原版、搜人稍勤；中级搜人更勤，挑兵少的城打；上级另给电脑资源：金收入多一倍半、米收入多一倍半、每月多一张命令书、打过仗的武将下一回合开头补满、开发更快，新招武将忠诚可到95（更难离间、诱纳不了）。不改变战斗本身的强弱；游戏中也可在「☰ 系统」切换。',
    onclick: () => { warlike = !warlike; pressed(warlikeBtn, warlike); } },
    h('i', {}), '电脑好战 · 难度越高越凶');
  const noStudyBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：智力80以下的武将可在书馆学习，电脑也会让武将学习　不能读书：敌我武将都不能读书提高智力，城市菜单的「书馆」变灰。游戏中也可在「☰ 系统」切换。',
    onclick: () => { noStudy = !noStudy; pressed(noStudyBtn, noStudy); } },
    h('i', {}), '武将不能读书 · 敌我都不能学习');
  const freeSaveBtn = h('button', { class: 'cheat opt', 'aria-pressed': 'false',
    title: '原版：每次记录消耗一张命令书　免费：记录不消耗命令书。游戏中也可在「☰ 系统」切换。',
    onclick: () => { freeSave = !freeSave; pressed(freeSaveBtn, freeSave); } },
    h('i', {}), '免费记录 · 存档不消耗命令书');
  for (const [b, on] of [[agelessBtn, ageless], [noDeathBtn, noWarDeath], [sanguBtn, sangu], [warlikeBtn, warlike], [noStudyBtn, noStudy], [freeSaveBtn, freeSave]]) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  // Phone: a switch's full explanation is its tooltip on a desktop; here a tap on it shows the same text for a while.
  // It drops down from under the row of switches (over the heading and the top of the rulers), so the switches stay in sight.
  const optNote = PHONE ? h('div', { class: 'setup-note', 'aria-live': 'polite' }) : null;
  let optNoteT = 0;
  if (PHONE) for (const b of [agelessBtn, noDeathBtn, sanguBtn, warlikeBtn, noStudyBtn, freeSaveBtn]) b.addEventListener('click', () => {
    optNote.replaceChildren(h('p', { onclick: () => optNote.replaceChildren() }, h('b', {}, b.classList.contains('on') ? '已开启　' : '已关闭　'), b.title));
    clearTimeout(optNoteT); optNoteT = setTimeout(() => optNote.replaceChildren(), 6000);
  });
  // The original input as a hidden shortcut: ↑↓←→ three times on this screen turns the 秘技 on.
  const code = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], typed = [];
  const onCode = (e) => {
    if (!levels.isConnected) return removeEventListener('keydown', onCode);
    typed.push(e.key); if (typed.length > 12) typed.shift();
    if (typed.length === 12 && typed.every((k, i) => k === code[i % 4])) { typed.length = 0; if (!(cheat && level === 0)) { setCheat(true); toast('<strong>秘技成立：君主所在城 金米全满</strong>'); } }
  };
  addEventListener('keydown', onCode);
  const rulers = h('div', { class: 'rulers' });
  const start = h('button', { class: 'btn primary', disabled: true, style: { fontSize: '20px', padding: '10px 40px', letterSpacing: '8px' }, onclick: () => { if (start.disabled) return; start.disabled = true; const ng = G.newGame(ruler, level); if (cheat && level === 0) G.maxRulerCity(ng); if (ageless) ng.ageless = true; if (noWarDeath) ng.noWarDeath = true; if (sangu) ng.sangu = true; if (freeSave) ng.freeSave = true; if (warlike) ng.warlike = true; if (noStudy) ng.noStudy = true; begin(ng, false); } }, '开始');
  // The original's order, then a pack's houses (7, the unowned, is never one).
  const houses = [4, 2, 3, 1, 6, 5, 0, ...D.factions.slice(8).map((f) => f.id)];
  if (houses.length > 7) rulers.style.setProperty('--n', houses.length <= 10 ? houses.length : Math.ceil(houses.length / 2));
  const drawRulers = () => rulers.replaceChildren(...houses.map((f) => {
    const fac = D.factions[f], cs = D.cities.filter((c) => c.faction === f), offs = cs.reduce((a, c) => a + c.officers.length, 0);
    const o = D.officers[fac.ruler];
    return h('div', { class: `panel ruler ${ruler === f ? 'on' : ''}`, style: { '--c': colorOf(f) }, 'aria-pressed': ruler === f ? 'true' : 'false', title: ruler === f ? '再次点击开始' : `选择${name(fac.ruler)}`,
      ...pressable(() => { if (ruler === f) return start.click(); ruler = f; start.disabled = false; start.textContent = `${name(fac.ruler)} · 出征`; keep(rulers, drawRulers); }) },
      figure(fac.ruler), h('i', { class: 'chip' }),
      h('div', { class: 'meta' }, h('b', {}, name(fac.ruler)),
        h('div', { class: 'rstat' }, h('span', {}, '武', h('em', {}, o.war)), h('span', {}, '智', h('em', {}, o.int)), h('span', {}, '德', h('em', {}, o.virtue))),
        h('small', {}, `${cs.length}城 · ${offs}将`), h('small', { class: 'towns' }, cs.map((c) => c.name).join(' · '))));
  }));
  drawRulers();
  root().append(sysButtons(), files.titleArt ? h('div', { class: 'title-art', style: { backgroundImage: `url(${files.titleArt})`, position: 'fixed', filter: 'blur(3px) brightness(.55)' } }) : null, h('div', { class: 'setup' }, h('h2', {}, '选择难度'), levels, h('div', { class: 'setup-opts' }, agelessBtn, noDeathBtn, sanguBtn, warlikeBtn, noStudyBtn, freeSaveBtn), optNote, h('h2', {}, '选择君主'), rulers,
    h('div', { class: 'setup-foot' }, h('button', { class: 'btn', onclick: title }, '返回'), start)));
}

// ---------- Game ----------
// resume: a suspended war (src/core/suspend.js) to take up first; its game keeps its seed, as it never stopped.
async function begin(state, loaded, resume = null, { keepSuspend = false, notice = null, pendingRaw = null, expectedHeld = null, source = state.slot } = {}) {
  if (!resume && !keepSuspend && !(await leaveSuspend())) return title();
  G.dropAuto(); delete state.auto; // 自动续玩 is taken by whatever starts: it never becomes a second record
  quickCostExplained = false;
  try {
    g = loaded && !resume && !new URLSearchParams(location.search).has('fixedseed') ? G.reseed(state) : state;  // ?fixedseed: replay a record exactly
    desk?.setUnsaved(true); // closing the window now asks first
    await fade(true);
    document.body.dataset.screen = 'strategy';
    setMode(strategy); strategy.refresh(g); sel = null; playerPose = null;
    // 道路总览 and 势力范围 as left last time (src/prefs.js), from the campaign's first screen: the title's map shows neither.
    if (strategy.roadsOn !== readFlag(PREF.roads)) strategy.roads(readFlag(PREF.roads));
    strategy.territoryOf?.(null);
    if (strategy.territoryOn !== readFlag(PREF.territory)) strategy.territory(readFlag(PREF.territory));
    hud.log = [];  // the log belongs to this game: not to one finished or left before it (title → 继续记录 after an ending)
    resetFormations(); // the formations deployed last belong to this game too (src/tacticalhud.js)
    strategy.resetView(); strategy.focusCity(g.factions[g.player].city);
    hud(); audio.playBgm('bgm-strategy');
  } catch (error) {
    if (!pendingRaw) throw error;
    // An unexpected initialization failure must not strand the player in a reload loop or discard a battle.
    try { if (sessionStorage.getItem(LOAD_KEY) === pendingRaw) sessionStorage.removeItem(LOAD_KEY); } catch {}
    console.error('记录初始化失败', error);
    await title(); await fade(false);
    toast(`<em>读取失败，已返回标题${expectedHeld !== 'null' ? '；中断战斗仍保留' : ''}</em>`, 6000);
    return;
  }
  // A confirmed load remains recoverable until its snapshot has initialized. Only then can the exact
  // suspended battle that was approved for removal be discarded, under the same lock as other tabs.
  if (pendingRaw) {
    const result = expectedHeld === 'null' ? (peekSuspend() ? 'changed' : 'none') : await withSuspendLock(() => {
      if (JSON.stringify(peekSuspend()) !== expectedHeld) return 'changed';
      dropSuspend(); return peekSuspend() ? 'failed' : 'dropped';
    });
    if (result === 'changed') notice = '中断战斗已改变，已为您保留';
    else if (result === 'failed') notice = '中断战斗未能放弃，已为您保留';
    try { if (sessionStorage.getItem(LOAD_KEY) === pendingRaw) sessionStorage.removeItem(LOAD_KEY); } catch {}
  }
  if (!resume) {
    const notices = [];
    if (loaded && G.restored(state)) notices.push(`${recordName(source)}已损坏，读取的是这一格上一次的记录`);
    if (notice) notices.push(notice);
    if (notices.length) toast(`<em>${notices.join('；')}</em>`, 6000);
    await fade(false); // a resumed war fades in on its own field (fieldWar)
  }
  if (!loaded) await message('出征', `${g.year}年，天下大乱。${name(g.factions[g.player].ruler)}于${cityName(g.factions[g.player].city)}起兵，志在一统三十州。<br>每月君主领取<b>命令书</b>，按占城数发放；用尽即结束本月行动。<br>进度<b>不会自动保存</b>：在己方城市选「城 → 记录」，或「☰ 系统 → 记录进度」存档（消耗一张命令书）。`, g.factions[g.player].ruler);
  if (loaded) g.endTurn = false;
  try { if (resume) await resumeWar(resume); await G.run(g, io); } catch (e) { console.error(e); await message('错误', String(e.stack || e)); }
  await ending();
}

// Phone: the log box is put away (src/phone.css); each line shows as a toast instead, and the whole log is under ☰ 系统.
const log = (html) => { const box = $('.logbox'); if (box) box.prepend(h('p', { html })); if (PHONE && !/^<small|^\s*$/.test(html)) toast(html, 2400); };
const bookPips = () => h('span', { class: 'books' }, Array.from({ length: G.books(g, g.player) }, (_, i) => h('i', { class: i < G.books(g, g.player) - g.books ? 'used' : '' })));

function hud() {
  if (!g || document.body.dataset.screen !== 'strategy') return;
  // Once the player's faction has fallen (its ruler cleared) there is no realm to show; ending() takes over.
  if (g.factions[g.player].ruler == null) { clear(); root().append(sysButtons()); return; }
  const pf = g.player, mine = G.citiesOf(g, pf);
  const sum = (k) => mine.reduce((a, c) => a + c[k], 0);
  const troops = mine.reduce((a, c) => a + G.troopsOf(g, c), 0);
  const turnF = g.current;
  clear();
  root().append(
    sysButtons(),
    h('div', { class: 'panel topbar' },
      h('span', { class: 'date' }, `${g.year}年 ${g.month + 1}月`, h('span', { class: `season s${Math.floor(g.month / 3)}`, title: `${MONTH_NAMES[g.month]}　${WEATHER_OF(g.month)}` }, SEASON_OF(g.month), h('small', {}, WEATHER_OF(g.month)))),
      // the words sit in their own spans: a phone puts them away (src/phone.css), which it cannot do to bare text (D88)
      h('span', { class: 'who turn' }, h('i', { class: 'dot', style: { background: colorOf(turnF ?? pf) } }), h('span', {}, turnF === pf ? `${name(g.factions[pf].ruler)}的回合` : turnF == null ? '准备中' : `${factionName(turnF)}军行动中`)),
      turnF === pf ? h('span', { class: 'who' }, h('span', {}, '命令书'), bookPips(), h('b', {}, g.books)) : null,
      // two groups, one line on a wide screen (.resg is display: contents); a narrow phone puts 金 米 under 城 将 兵 (D88)
      h('span', { class: 'res' }, h('span', { class: 'resg' }, h('span', {}, '城 ', h('b', {}, mine.length)), h('span', {}, '将 ', h('b', {}, mine.reduce((a, c) => a + c.officers.length, 0))),
        h('span', { 'data-k': '兵' }, '兵 ', h('b', {}, troops))), h('span', { class: 'resg' }, h('span', { 'data-k': '金' }, '金 ', h('b', {}, sum('gold'))), h('span', { 'data-k': '米' }, '米 ', h('b', {}, sum('rice'))))),
      h('span', { class: 'tbtns' }, h('button', { class: `btn roadsbtn ${strategy.roadsOn ? 'on' : ''}`, 'aria-pressed': String(strategy.roadsOn), title: '道路总览：加亮全部道路，城名全部常显（G）', 'data-pad': 'view', onclick: toggleRoads }, '道路', h('kbd', { class: 'pad-only' })),
      h('button', { class: `btn terrbtn ${strategy.territoryOn && strategy.territoryOnly == null ? 'on' : ''}`, 'aria-pressed': String(strategy.territoryOn && strategy.territoryOnly == null), title: '势力范围：按归属给地面着色', onclick: toggleTerritory }, '势力'),
      h('button', { class: 'btn wikibtn', title: '人物志：查询武将的所属、所在与出仕来历（R）', 'data-pad': 'x', onclick: () => roster() }, '人物志', h('kbd', { class: 'pad-only' }))),
      turnF === pf ? h('span', { class: 'record-hints', 'aria-label': '手柄存读档快捷键' }) : null),
    // The faction standings over the log (阿拉神丁@qq, 2026-11-19): they stay put however long the log grows. A ruler there is a
    // button: his 势力范围 alone on the map (territoryOf); the log folds to its newest line, as last left (PREF.logFold).
    h('div', { class: 'rightcol' },
      h('div', { class: 'panel legend' }, ...g.factions.filter((f) => f.ruler != null).sort((a, b) => G.citiesOf(g, b.id).length - G.citiesOf(g, a.id).length).map((f) =>
        h('button', { type: 'button', 'data-f': f.id, class: `lg ${f.id === g.player ? 'me' : ''} ${f.id === g.current ? 'now' : ''} ${strategy.territoryOnly === f.id ? 'only' : ''}`, 'aria-pressed': String(strategy.territoryOnly === f.id),
          title: `${factionName(f.id)}：${G.citiesOf(g, f.id).length}城${f.id === g.current ? '（行动中）' : ''}　点击单独查看势力范围`, onclick: () => territoryOf(f.id) }, avatar(f.ruler), h('i', { style: { background: colorOf(f.id) } }),
          h('span', {}, factionName(f.id)), h('b', {}, G.citiesOf(g, f.id).length), g.factions[g.player].alliance[f.id] ? h('em', {}, '盟') : null))),
      h('div', { class: `logwrap ${logFolded ? 'folded' : ''}` },
        h('button', { type: 'button', class: 'logfold', 'aria-expanded': String(!logFolded), title: logFolded ? '展开消息记录' : '收起消息记录，只留最新一条', onclick: toggleLogFold }, logFolded ? '展开' : '收起'),
        h('div', { class: 'panel logbox' }, ...(hud.log || []).slice(-40).reverse().map((x) => h('p', { html: x }))))),
  );
  syncPadHints();
  if (sel != null) cityPanel(sel);
  if (turnF === pf && !g.over) root().append(h('div', { class: 'endturn' }, h('button', { class: 'btn', 'data-pad': 'y-hold', onclick: endTurn }, '结束本月行动', h('kbd', { class: 'pad-only' }))));
  placeStrategyHud();
}
// The strategy HUD's panels make way for each other at any window size (feedback D47, 2026-11-12: at the 1024×600 the
// desktop window allows, the dock covered the end of the city panel's officer rows). The city panel and the columns on
// the right start under the top bar however many rows it wraps to; the dock stays centred where it can, else slides
// right into the room between the city panel and 结束本月行动; only when even that is too narrow does the city panel
// stop short of the dock, its roster scrolling. Widths are measured, as the dock's changes with the page and the pad.
const visibleRect = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect() : null);
const hudWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeStrategyHud()) : null;
let hudWatched = [];
function placeStrategyHud() {
  if (document.body.dataset.screen !== 'strategy') return;
  const GAP = 10, EDGE = 12, W = innerWidth;
  const bar = $('.topbar'), panel = $('.citypanel'), dock = $('.dock'), end = $('.endturn');
  const els = [bar, panel, dock, end].filter(Boolean);
  if (hudWatch && (els.length !== hudWatched.length || els.some((e, i) => e !== hudWatched[i]))) { hudWatch.disconnect(); for (const e of els) hudWatch.observe(e); hudWatched = els; }
  const top = visibleRect(bar);
  if (top) document.body.style.setProperty('--hud-top', `${Math.round(top.bottom + 12)}px`); else document.body.style.removeProperty('--hud-top');
  if (panel) panel.style.maxHeight = '';
  if (PHONE) { if (dock) dock.style.left = ''; return; } // src/phone.css places the dock and its list
  const d = visibleRect(dock);
  if (!d) return;
  const p0 = visibleRect(panel), p = p0 && p0.bottom > d.top - GAP ? p0 : null, e = visibleRect(end), half = d.width / 2;
  const lo = (p ? p.right + GAP : EDGE) + half, hi = (e && e.bottom > d.top ? e.left - GAP : W - EDGE) - half;
  const fits = lo <= hi, x = fits ? Math.min(Math.max(W / 2, lo), hi) : Math.min(Math.max(W / 2, EDGE + half), Math.max(EDGE + half, hi));
  dock.style.left = `${Math.round(x)}px`;
  if (!fits && p) panel.style.maxHeight = `${Math.max(160, Math.floor(d.top - GAP - p.top))}px`;
  placeFly();
}
// The open command list (commandDock) stands over its group's button where it can: within the screen, right of the city
// panel and left of the log and the standings where they reach down to it (rather over those two than over the officers'
// numbers, where both cannot be kept clear). Its notch stays on the button. The still of a command goes on the side with
// room for it, the left first, and is left out where neither has.
function placeFly() {
  const dock = $('.dock'), fly = dock && $('.acts', dock), on = dock && $('.tabs .btn.on', dock);
  if (PHONE || !fly || fly.hidden || !on || !dock.getClientRects().length) return;
  const GAP = 10, EDGE = 12, STILL = 346, d = dock.getBoundingClientRect(), o = on.getBoundingClientRect(), w = fly.offsetWidth;
  const cx = o.left + o.width / 2, y1 = d.top - 12, y0 = y1 - fly.offsetHeight, reaches = (r) => r && r.bottom > y0 && r.top < y1;
  let lo = EDGE, hi = innerWidth - EDGE;
  const p = visibleRect($('.citypanel')); if (reaches(p)) lo = Math.max(lo, p.right + GAP);
  for (const el of $$('.rightcol > *')) { const r = visibleRect(el); if (reaches(r)) hi = Math.min(hi, r.left - GAP); }
  const left = Math.round(hi - lo < w ? lo : Math.min(Math.max(cx - w / 2, lo), hi - w));
  fly.style.setProperty('--fly-x', `${left - Math.round(d.left) - dock.clientLeft}px`);
  fly.style.setProperty('--fly-caret', `${Math.round(Math.min(Math.max(cx - left, 16), w - 16))}px`);
  const pv = $('.cmd-preview', fly), onLeft = left - lo >= STILL, onRight = hi - (left + w) >= STILL;
  pv?.classList.toggle('flip', !onLeft && onRight); pv?.classList.toggle('none', !onLeft && !onRight);
}
addEventListener('resize', () => placeStrategyHud());
hud.log = [];
function addLog(x) { hud.log.push(x); if (hud.log.length > 80) hud.log.shift(); log(x); }

// 欣赏模式 (feedback F07, 2026-11-02: to listen to the music over the map): the HUD, the city tags and the hover tip go,
// the map still turns, zooms and pans. Only on the player's own turn on the 战略地图 with nothing open, where nothing
// moves on by itself; it gives way at once if a dialog, another screen or someone else's turn comes up all the same, so
// the 命令书 and the date are never out of sight while anything can happen. Clicks on the map pick nothing meanwhile.
let scenic = null;
const canScenic = () => !!g && mode === strategy && document.body.dataset.screen === 'strategy' && g.current === g.player && !!endPlayer && !commandOpen();
function setScenic(on) {
  if (on === !!scenic || (on && !canScenic())) return;
  document.body.classList.toggle('scenic', on);
  strategy.scenic?.(on);
  if (on) {
    $('#tip').hidden = true; strategy.highlight(null); strategy.select(null);
    scenic = h('button', { class: 'btn scenic-exit', title: '恢复界面（V 或 Esc）', onclick: () => setScenic(false) }, '退出欣赏', h('kbd', { 'data-glyph': 'l3' }, 'V'));
    document.body.append(scenic); setTimeout(() => scenic?.classList.add('dim'), 3000);
  } else {
    scenic.remove(); scenic = null;
    if (sel != null) strategy.select(sel);
  }
}
const scenicStillFits = () => document.body.dataset.screen === 'strategy' && mode === strategy && g?.current === g?.player && !blocking();

// 道路 overview (T15): every road lit and every city tag solid, until turned off again.
function toggleRoads() {
  strategy.roads(!strategy.roadsOn); writeFlag(PREF.roads, strategy.roadsOn);
  const b = $('.roadsbtn'); b?.classList.toggle('on', strategy.roadsOn); b?.setAttribute('aria-pressed', String(strategy.roadsOn));
}
// 势力 shows every house's land, or none; while one ruler's alone is up (territoryOf), it brings back all of them first.
function toggleTerritory() {
  if (strategy.territoryOnly != null) { strategy.territoryOf(null); strategy.territory(true); }
  else strategy.territory(!strategy.territoryOn);
  writeFlag(PREF.territory, strategy.territoryOn); markTerritory();
}
function markTerritory() {
  const on = strategy.territoryOn && strategy.territoryOnly == null, b = $('.terrbtn');
  b?.classList.toggle('on', on); b?.setAttribute('aria-pressed', String(on));
  for (const el of $$('.legend .lg')) { const only = Number(el.dataset.f) === strategy.territoryOnly; el.classList.toggle('only', only); el.setAttribute('aria-pressed', String(only)); }
}
// One ruler's 势力范围 alone (阿拉神丁@qq, 2026-11-19), the 势力 button's view in part: his name in the standings again, or
// 势力, puts it away. It is a look, not a switch to remember: the 势力 setting (PREF.territory) is left as it was.
function territoryOf(f) {
  if (strategy.territoryOnly === f) { strategy.territoryOf(null); strategy.territory(readFlag(PREF.territory)); }
  else { strategy.territoryOf(f); strategy.territory(true); strategy.frame(G.citiesOf(g, f).map((c) => c.id)); } // his land, framed
  markTerritory();
}
// The log folded to its newest line, or whole (阿拉神丁@qq, 2026-11-19: through a run of commands it filled the screen).
let logFolded = readFlag(PREF.logFold);
function toggleLogFold() {
  logFolded = !logFolded; writeFlag(PREF.logFold, logFolded);
  const w = $('.logwrap'), b = w && $('.logfold', w); if (!w) return;
  w.classList.toggle('folded', logFolded);
  b.textContent = logFolded ? '展开' : '收起'; b.setAttribute('aria-expanded', String(!logFolded)); b.title = logFolded ? '展开消息记录' : '收起消息记录，只留最新一条';
}

// D53 (猫污染@devblog): a city the mouse picks is kept where it can be seen: if it or its tag would sit under the HUD (its own panel
// included, measured once it is up) or near the window's edge, the map slides the least that brings it clear, at the turn, tilt and
// distance the player left it at; one already clear stays put, so picking cities side by side never sets the map swimming.
// A single change of where the view is going: a drag meanwhile simply carries on from it, nothing holds the city or springs back.
function keepClear(cid) {
  requestAnimationFrame(() => {
    if (mode !== strategy || sel !== cid || drag || mapPick || !strategy.screenAtRest) return;
    const p = strategy.screenAtRest(cid); if (p.off) return;
    const now = strategy.screenOfCity(cid), t = strategy.tagOf?.(cid)?.getBoundingClientRect();
    const box = { x0: p.x - 60, x1: p.x + 60, y0: p.y - 25, y1: p.y + 40 }; // its ring and model round the spot
    if (t?.width && !now.off) { const ox = p.x - now.x, oy = p.y - now.y; box.x0 = Math.min(box.x0, t.left + ox); box.x1 = Math.max(box.x1, t.right + ox); box.y0 = Math.min(box.y0, t.top + oy); box.y1 = Math.max(box.y1, t.bottom + oy); }
    const shift = clearShift(box, $$('#ui .panel, #ui .endturn, .sysmenu-btn').map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height), innerWidth, innerHeight);
    if (shift && (shift[0] || shift[1])) strategy.nudge(cid, ...shift);
  });
}
// The least shift [sx, sy] that takes box clear of every rect and inside the window (a margin round each), or null if none does:
// out past one side of what it overlaps, then, from there, past whatever that put it over.
function clearShift(box, rects, w, h, pad = 12, edge = 32) {
  const hits = (s) => rects.filter((r) => box.x1 + s[0] > r.left - pad && box.x0 + s[0] < r.right + pad && box.y1 + s[1] > r.top - pad && box.y0 + s[1] < r.bottom + pad);
  const inside = (s) => [Math.max(0, edge - box.x0 - s[0]) || Math.min(0, w - edge - box.x1 - s[0]), Math.max(0, edge - box.y0 - s[1]) || Math.min(0, h - edge - box.y1 - s[1])];
  const fits = (s) => box.x0 + s[0] >= edge - 0.5 && box.x1 + s[0] <= w - edge + 0.5 && box.y0 + s[1] >= edge - 0.5 && box.y1 + s[1] <= h - edge + 0.5;
  const all = [];
  let front = [[0, 0]];
  for (let round = 0; round < 3; round++) {
    const next = [];
    for (const s of front) {
      const e = inside(s); next.push([s[0] + e[0], s[1] + e[1]]);
      for (const r of hits(s)) next.push([r.left - pad - box.x1, s[1]], [r.right + pad - box.x0, s[1]], [s[0], r.top - pad - box.y1], [s[0], r.bottom + pad - box.y0]);
    }
    all.push(...front); front = next;
  }
  all.push(...front);
  return all.filter((s) => fits(s) && !hits(s).length).sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0] ?? null;
}

function onCity(cid) {
  if (scenic) return;
  if (mapPick) { if (cid != null && mapPick.cids.has(cid)) mapPick.done(cid); return; }
  if (!g || document.body.dataset.screen !== 'strategy' || blocking() || busy) return;
  // Phone: every slide of the map starts as a possible tap, and a tap on open country put the city, its panel and its commands away.
  // There it only closes the open command list; another city is still chosen by tapping it.
  if (PHONE && cid == null && sel != null) { commandDock.close?.(); return; }
  sel = cid; strategy.select(cid); hud();
}

// 搜索 never reveals who is left to find; the city remembers only what the player's own searches turned up,
// so an empty city is not searched again by mistake and a fruitful one is not forgotten.
function noteSearch(cid, what) { (g.searched ||= {})[cid] = { at: g.year * 12 + g.month, what }; }
function searchNote(cid) {
  const s = g.searched?.[cid]; if (!s) return null;
  return h('p', { class: 'hint searchnote' }, `上次搜索　${Math.floor(s.at / 12)}年${(s.at % 12) + 1}月：${s.what}`);
}

// 登场情报 (N22): how much the 人物志 and the city panel tell about where officers come from. 'seen' (default)
// covers officers already in play; 'all' opens every 搜索 queue and arrival; 'off' keeps the original's silence.
const TALENT_MODES = { off: '关', seen: '已登场', all: '全部' };
let talentMode = (() => { try { return localStorage.getItem('hd2d-talent'); } catch { return null; } })();
if (!TALENT_MODES[talentMode]) talentMode = 'seen';
function setTalentMode(m) {
  talentMode = m; try { localStorage.setItem('hd2d-talent', m); } catch {}
  refreshTalentNote();
}
function refreshTalentNote() {
  const panel = $('.citypanel'); // refresh in place, so the open 系统 menu stays open
  if (panel && sel != null && $('.stats', panel)) { $('.talentnote', panel)?.remove(); const n = talentNote(sel); if (n) $('.roster', panel).before(n); }
}
const debutShown = (id) => talentMode === 'all' || (talentMode === 'seen' && g.officers[id].status !== G.UNAPPEARED);

// Where an officer came from, and (still to come) what he is waiting for.
function debutText(id) {
  const d = G.debutInfo(id);
  if (d.kind === 'initial') return `开局 · ${cityName(d.city)}`;
  if (d.kind === 'phantom') return '流落自王莆';
  if (d.kind === 'search') return `${cityName(d.city)}搜索${talentMode === 'all' ? ` 第${d.order}` : ''}`;
  return `自动出仕 · ${factionName(d.faction)}军`;
}
function waitText(id) {
  const d = G.debutInfo(id);
  if (d.kind === 'auto' && g.factions[d.faction].ruler == null) return ['势力已灭', 'bad'];
  const list = d.kind === 'search' ? G.searchQueue(d.city) : G.joinQueue(d.faction), head = G.queueHead(g, list);
  if (head?.id !== id) return [`前有 ${list.slice(0, d.order - 1).filter((i) => g.officers[i].status === G.UNAPPEARED).length} 人`, ''];
  if (!head.ready) return [`${d.year}年起`, ''];
  if (d.kind === 'search') return g.cities[d.city].officers.length >= 10 ? ['城已满10人', 'bad'] : ['可寻访', 'go'];
  const c = g.cities[g.factions[d.faction].city];
  return c.faction === d.faction && c.officers.length < 10 ? ['即将出仕', 'go'] : ['都城已满', 'bad'];
}

// One line under the city's numbers: what 搜索 can still turn up here (opens the 人物志 on this city).
function talentNote(cid) {
  if (talentMode === 'off') return null;
  const t = G.cityTalent(g, cid), c = g.cities[cid], parts = [];
  if (talentMode === 'all') {
    if (t.head) {
      const pf = G.debutInfo(t.head.id).prefer, lean = pf != null && pf !== c.faction ? `（心向${factionName(pf)}）` : '';
      parts.push(t.head.ready ? `可寻访 <b>${name(t.head.id)}</b>${lean}` : `<b>${name(t.head.id)}</b> ${D.officers[t.head.id].year}年起可寻访${lean}`);
      if (t.left > 1) parts.push(`其后尚有 ${t.left - 1} 人`);
    } else parts.push('已无人才可寻访');
  } else parts.push(!t.head ? '已无人才可寻访' : t.head.ready ? '城中似有<b>贤才</b>可寻访' : '眼下无人可寻访');
  if (t.head?.ready && t.full) parts.push('<span class="bad">城已满10人，寻不到人</span>');
  else if (t.head?.ready && g.sangu) parts.push(`三顾 ${g.visits?.[t.head.id] || 0}/${G.SANGU_VISITS}`);
  if (t.ronin.length) parts.push(`附近在野 ${t.ronin.slice(0, 3).map(name).join('、')}${t.ronin.length > 3 ? ` 等${t.ronin.length}人` : ''}`);
  return h('p', { class: 'hint talentnote', title: '打开人物志，查看与此城有关的武将', ...pressable(() => roster({ city: cid })) },
    h('span', { class: 'k' }, '人才'), h('span', { class: 'parts' }, ...parts.map((x) => h('span', { html: x }))), h('span', { class: 'go' }, '人物志 ›'));
}

// 人物志: every officer in one table — search by name, filter by state, faction and city, sort by column.
// opts.city: start filtered to one city (its officers now, and in 'seen'/'all' those who came or will come from it).
const STATES = [['all', '全部'], [G.SERVING, '仕官'], [G.RONIN, '在野'], [G.UNAPPEARED, '未登场'], [G.DEAD, '已故']];
async function roster({ city = null } = {}) {
  const f = { q: '', st: 'all', fac: 'all', city: city ?? 'all' };
  let sortBy = null;
  const statusOf = (id) => g.officers[id].status;
  const placeOf = (id) => { const o = g.officers[id]; return o.status === G.SERVING ? G.officerCity(g, id)?.id ?? null : o.status === G.RONIN ? o.loc : null; };
  const debutCity = (id) => G.debutInfo(id).city ?? null;
  const rank = (id) => { const st = statusOf(id), fc = G.factionOf(g, id); return st === G.SERVING ? (fc === g.player ? 0 : 1 + fc) - (G.isRuler(g, id) ? 0.5 : 0) : st === G.RONIN ? 10 : st === G.UNAPPEARED ? 20 : 30; };
  const COLS = [
    ['武', (id) => g.officers[id].war], ['智', (id) => g.officers[id].int], ['德', (id) => g.officers[id].virtue],
    ['登场', (id) => -D.officers[id].year, (id) => (debutShown(id) ? `${D.officers[id].year}年` : '—'), () => talentMode !== 'off'],
  ];
  const visible = (id) => statusOf(id) !== G.UNAPPEARED || talentMode === 'all';
  const all = g.officers.map((o) => o.id).filter(visible); // the record's cast, 阿会喃 copies included
  const counts = Object.fromEntries(STATES.map(([k]) => [k, k === 'all' ? all.length : all.filter((id) => statusOf(id) === k).length]));
  const hidden = g.officers.length - all.length;
  const table = h('table', { class: 'otable wikitable' }), total = h('span', { class: 'hint count' });
  const chips = h('div', { class: 'tabs wikistates' }), fsel = h('select', { 'aria-label': '势力', onchange: (e) => { f.fac = e.target.value; draw(); } },
    h('option', { value: 'all' }, '全部势力'), ...g.factions.map((x) => h('option', { value: x.id }, `${factionName(x.id)}${x.ruler == null ? '（已灭）' : ''}`)));
  const csel = h('select', { 'aria-label': '城市', onchange: (e) => { f.city = e.target.value === 'all' ? 'all' : Number(e.target.value); draw(); } },
    h('option', { value: 'all' }, '全部城市'), ...D.cities.map((c) => h('option', { value: c.id, selected: c.id === city ? true : null }, c.name)));
  const q = h('input', { type: 'search', placeholder: '武将名', 'aria-label': '查找武将', oninput: (e) => { f.typed = e.target.value.trim(); f.q = toHans(f.typed); draw(); } });
  const draw = () => {
    chips.replaceChildren(...STATES.filter(([k]) => counts[k] || k === f.st).map(([k, t]) => h('button', { class: `btn ${f.st === k ? 'on' : ''}`, onclick: () => { f.st = k; draw(); } }, t, h('small', {}, counts[k]))));
    let ids = all.filter((id) => (f.st === 'all' || statusOf(id) === f.st)
      && (f.fac === 'all' || (statusOf(id) === G.SERVING && G.factionOf(g, id) === Number(f.fac)) || (statusOf(id) === G.UNAPPEARED && G.debutInfo(id).faction === Number(f.fac)))
      && (f.city === 'all' || placeOf(id) === f.city || (debutShown(id) && debutCity(id) === f.city))
      && (!f.q || name(id).includes(f.q) || D.officers[id].jp?.includes(f.typed)));
    ids = sortBy == null ? ids.sort((a, b) => rank(a) - rank(b) || D.officers[a].year - D.officers[b].year || a - b)
      : ids.sort((a, b) => COLS[sortBy][1](b) - COLS[sortBy][1](a) || a - b);
    const cols = COLS.filter((c) => !c[3] || c[3]());
    table.replaceChildren(
      h('thead', {}, h('tr', {}, h('th', { class: 'nm' }, '武将'), ...cols.map((c) => { const i = COLS.indexOf(c); return h('th', { class: sortBy === i ? 'on' : '', title: `按${c[0]}排序`, ...pressable(() => { sortBy = sortBy === i ? null : i; draw(); }) }, c[0]); }),
        h('th', { class: 'tx' }, '所属'), h('th', { class: 'tx' }, '所在'), talentMode !== 'off' ? h('th', { class: 'tx' }, '来历') : null)),
      h('tbody', {}, ...ids.map((id) => {
        const st = statusOf(id), fc = G.factionOf(g, id), at = placeOf(id), d = G.debutInfo(id);
        const wait = st === G.UNAPPEARED ? waitText(id) : null;
        return h('tr', { class: st === G.DEAD ? 'dead' : st === G.UNAPPEARED ? 'yet' : '', 'data-id': id, ...pressable(() => officerCard(id)) },
          h('td', { class: 'nm' }, avatar(id), name(id), G.isRuler(g, id) ? h('em', {}, '君主') : null),
          ...cols.map((c) => h('td', {}, c[2] ? c[2](id) : c[1](id))),
          h('td', { class: 'tx' }, st === G.SERVING ? h('span', { class: 'fac' }, h('i', { class: 'dot', style: { background: colorOf(fc) } }), factionName(fc))
            : h('span', { class: 'dim' }, { [G.RONIN]: '在野', [G.UNAPPEARED]: '未登场', [G.DEAD]: '已故' }[st])),
          h('td', { class: 'tx' }, at != null ? cityName(at) : '—'),
          talentMode !== 'off' ? h('td', { class: 'tx src' }, debutShown(id) ? debutText(id) : '—',
            wait ? h('em', { class: wait[1] }, wait[0]) : null,
            debutShown(id) && d.prefer != null ? h('small', {}, `心向${factionName(d.prefer)}`) : null) : null);
      })));
    if (!ids.length) table.append(h('tbody', {}, h('tr', { class: 'none' }, h('td', { colspan: 9 }, '没有符合条件的武将'))));
    total.innerHTML = `共 <b>${ids.length}</b> 人${hidden ? `　另有 ${hidden} 人尚未登场${talentMode === 'all' ? '' : '（系统菜单「登场情报」设为「全部」可查看）'}` : ''}`;
  };
  draw();
  await modal('人物志', (close) => h('div', { class: 'wiki' },
    h('div', { class: 'wikibar' }, chips, h('span', { style: { flex: 1 } }), q, fsel, csel),
    h('div', { class: 'otable-wrap' }, table),
    h('div', { class: 'foot' }, total, h('span', { style: { flex: 1 } }), h('span', { class: 'hint' }, '点选武将查看详情　点表头排序'), h('button', { class: 'btn', onclick: () => close() }, '关闭'))), { wide: true });
}

// 武将 and 正规军 (the soldiers his officers lead, 预备兵 apart) close the list (阿拉神丁@qq, 2026-11-19): a city's strength at a
// glance, one's own and a scouted rival's alike (off the phone the panel is 侦察's report; the phone's 侦察 window shows the same list).
function cityStats(c) {
  return h('div', { class: 'stats' },
    ...[['金', c.gold], ['米', c.rice], ['宝', c.treasure], ['人口', c.pop * 100], ['土地', c.land], ['产业', c.industry], ['统治', c.gov], ['防灾', c.disaster], ['预备兵', c.reserve],
      ['武将', c.officers.length], ['正规军', G.troopsOf(g, c)]]
      .map(([k, v]) => h('div', { 'data-k': k }, h('span', {}, k), h('b', {}, v))));
}

// What the player knows of a city: all of his own and of an empty one; of a rival's, what 侦察 found this month or the three before.
const cityKnown = (cid) => { const c = g.cities[cid]; return c.faction === g.player || c.faction === NONE || (g.scouted?.[cid] ?? -1) >= g.year * 12 + g.month - 3; };
function cityPanel(cid) {
  if (cid !== tabCity) { tab = '城'; tabOpen = false; cmdFocus = null; tabCity = cid; } // the command menu's group, and its list closed (below)
  const c = g.cities[cid], dc = D.cities[cid], own = c.faction === g.player, f = D.cities[cid].facilities;
  const showDetail = cityKnown(cid);
  const ruler = c.faction !== NONE ? g.factions[c.faction].ruler : null;
  const panel = h('div', { class: 'panel citypanel' },
    h('header', {}, h('h2', {}, cityName(cid)), G.cityOrigName(cid) ? h('span', { class: 'hint origname', title: '「☰ 系统 → 地名」为考据时，城名旁注原版的名字' }, `原版 ${G.cityOrigName(cid)}`) : null, h('span', { class: 'owner', style: { background: colorOf(c.faction) } }, factionName(c.faction)),
      ruler != null && c.officers.includes(ruler) ? h('span', { class: 'hint' }, '君主所在') : null,
      document.body.classList.contains('scouting') ? h('span', { class: 'tagc scouting-tag' }, '侦察中') : null),
    // A rival's numbers wait for 侦察, on the phone too: the map no longer gives his officer count (citytags.js tagHtml).
    showDetail ? cityStats(c) : h('p', { class: 'hint', style: { padding: '8px 14px' } }, '敌方城市。使用「侦察」可查看详细情报。'),
    // 市集 is the original's 商店 (rice and treasure are traded there); its prices are in the 买米 / 卖米 window, and on the tag's
    // tooltip for comparing towns without opening it (阿拉神丁@qq, 2026-11-19: the panel's own 米价 line said it twice).
    h('div', { class: 'facs' }, ...[['weapons', '铁铺'], ['school', '书馆'], ['market', '市集'], ['hospital', '医馆']].filter(([k]) => f[k]).map(([k, t]) =>
      h('i', k === 'market' && (dc.rice_rate[0] || dc.rice_rate[1]) ? { title: `米价：100金买米${dc.rice_rate[1]}，卖100米得金${dc.rice_rate[0]}` } : {}, t))),
    own ? searchNote(cid) : null,
    showDetail ? talentNote(cid) : null,
    // With the pad, the way from the menu to these rows is not to be guessed (feedback D62, 2026-11-14): told above them.
    own && !PHONE && c.officers.length ? h('p', { class: 'roster-tip hint' }, ...padText((k) => `命令分组上推 ← 选武将，${k('a')} 看资料`)) : null,
    h('div', { class: 'roster' }, ...(showDetail ? c.officers : []).map((id, i) => officerRow(g, id, { extra: id === ruler ? '君主' : i === 0 ? '太守' : null, onclick: () => officerCard(id) }))),
  );
  root().append(panel);
  if (own && g.current === g.player && !g.over) root().append(commandDock(cid));
}

// Officer sheet: portrait, attribute meters (0–100), troops, gear.
// Experience as the original shows it (raw / 50, research/experience-evidence.md) with the next level's mark,
// so a player can see who is close to a level; 等级 8 is the last.
const expText = (o) => o.level >= 8 ? `${Math.floor(o.exp / 50)}（满级）` : `${Math.floor(o.exp / 50)}／${D.rules.level_exp[o.level - 1] / 50}`;
// One officer's particulars: the 人物志 card, and the 白兵 / 单挑 资料, where `live` carries the battle's own 体力 and
// soldiers (written back to the record only when the battle ends) and `foot` is left out.
function officerSheet(id, { live = null, foot = null } = {}) {
  const o = g.officers[id], d = D.officers[id], eq = D.equipment, f = live?.faction ?? G.factionOf(g, id), w = eq[o.weapon], a = eq[24 + o.armor];
  const hp = live?.hp ?? o.hp, soldiers = live?.soldiers ?? o.soldiers;
  const meter = (k, v, max = 100, cls = '') => h('div', { class: `meter ${cls}` }, h('span', {}, k), h('div', { class: 'track' }, h('i', { style: { width: `${Math.max(0, Math.min(100, (100 * v) / max))}%` } })), h('b', {}, max === 100 ? v : `${v}/${max}`));
  return h('div', { class: 'ocard' },
    h('img', { src: portrait(id), alt: name(id) }),
    h('div', { class: 'ocard-info' },
      live ? h('h4', { class: 'ocard-name' }, name(id)) : null,
      h('div', { class: 'ocard-tags' },
        live?.side ? h('span', { class: `tagc ocard-side ${live.mine ? 'me' : 'foe'}` }, `${live.mine ? '我军' : '敌军'} · ${live.side === 'a' ? '攻方' : '守方'}`) : null,
        o.status === G.SERVING ? h('span', { class: 'owner', style: { background: colorOf(f) } }, factionName(f)) : h('span', { class: 'owner' }, { [G.RONIN]: '在野', [G.UNAPPEARED]: '未登场', [G.DEAD]: '已故' }[o.status]),
        G.isRuler(g, id) ? h('span', { class: 'tagc' }, '君主') : null, h('span', { class: 'tagc' }, `${o.army}军`), h('span', { class: 'tagc' }, `等级 ${o.level}`)),
      meter('体力', hp, G.maxHp(o, id), hp < G.maxHp(o, id) / 2 ? 'low' : ''), meter('武力', o.war, 100, 'war'), meter('智力', o.int, 100, 'int'), meter('人德', o.virtue, 100, 'vir'), meter('忠诚', o.loyalty, 100, o.loyalty < 60 ? 'low' : 'loy'),
      h('div', { class: 'stats ocard-gear' },
        h('div', {}, h('span', {}, '兵数'), h('b', {}, soldiers)), h('div', {}, h('span', {}, '经验'), h('b', {}, expText(o))),
        h('div', {}, h('span', {}, '武器'), h('b', {}, w ? h('img', { class: 'eqi', src: equipIcon(o.weapon), alt: '' }) : null, `${w?.name ?? '—'}`, w ? h('small', {}, ` 攻${w.atk}`) : null)),
        h('div', {}, h('span', {}, '防具'), h('b', {}, a ? h('img', { class: 'eqi', src: equipIcon(24 + o.armor), alt: '' }) : null, `${a?.name ?? '—'}`, a ? h('small', {}, ` 防${a.dfn}`) : null))),
      live ? null : h('p', { class: 'hint' }, `${d.year}年登场`, debutShown(id) ? `　·　${debutText(id)}` : '', o.status === G.UNAPPEARED && talentMode === 'all' ? `　·　${waitText(id)[0]}` : ''),
      foot));
}
async function officerCard(id) {
  await modal(name(id), (close) => officerSheet(id, { foot: h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close() }, '关闭')) }), { wide: true });
}
// The 白兵 / 单挑 资料 (feedback R09, 2026-11-02; the original's 单挑 menu has it): both generals side by side in the order given
// (tacticalhud.js: the attacker left, the defender right, as they stand on the screen), each marked 我军 / 敌军 and 攻 / 守.
// `factions` maps each general to the house he fights for: a marching army has left its city, so the record alone
// would call him 无主 (feedback 2026-11-07).
function battleProfiles(list, factions = {}) {
  return modal('资料', (close) => [h('div', { class: 'ocard-pair' }, ...list.map(({ id, hp, soldiers, side, mine }) => officerSheet(id, { live: { hp, soldiers, faction: factions[id], side, mine } }))),
    h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => close() }, '返回', h('kbd', { 'data-glyph': 'b' }, 'Esc')))], { wide: true });
}

// ---------- Commands (命令书) ----------
// The groups are one character, the commands two (阿拉神丁@qq, 2026-11-18): 城 for the city's own affairs and 记录, as in
// 原版's 城; 军 for the troops, 调遣 among them; 谋 is 原版's own 外交 group, its three commands straight in the list
// (2026-11-20: as a row of 城 they took a picker more, and a 录 group held 记录 alone). Elsewhere 原版 groups them otherwise and names the town's shops 学问所 / 武器屋 / 病院 and the commands 移動 / 施し (README, 规则实现对照).
// The names are read as a ruler's orders (2026-11-20): 施舍 sounded condescending, so 赈济; 移动 made officers into things to
// be carried, so 调遣 (not 指派, which wants an errand and sits too near 任命); 病院 was the ROM's Japanese, so 医馆, like 书馆.
const TABS = { 城: ['开发', '防灾', '搜索', '记录'], 军: ['出阵', '调遣', '征兵', '分兵', '侦察', '任命'], 仓: ['运输', '赏赐', '赈济'], 町: ['买米', '卖米', '卖宝', '医馆', '书馆', '铁铺'], 谋: ['同盟', '诱纳', '离间'] };
const DESC = {
  开发: '提高土地、产业或人口；智力影响费用与成效', 防灾: '修筑堤防，减轻洪水与旱灾的损失', 调遣: '把武将调往相邻的己方城或空城', 搜索: '在城中寻访人才、金或米', 记录: '保存当前进度',
  出阵: '率军进攻相邻的敌城或空城', 征兵: '每100兵20金，征得的兵进入预备兵', 分兵: '把预备兵分给武将，每将最多1000', 侦察: '消耗一张命令书，连续查看各城情报', 任命: '更换此城的太守',
  运输: '向相邻的己方城运送金、米、宝', 赏赐: '赏金或赐宝，提高武将忠诚', 赈济: '以金米赈济百姓，提高统治度',
  买米: '在市集用金买米', 卖米: '在市集卖米换金', 卖宝: '每件宝物换100金', 医馆: '花50金为武将治伤', 书馆: '智力80以下的武将可在此学习', 铁铺: '为武将购买武器与防具',
  同盟: '遣使与他国结盟，或废除现有同盟', 诱纳: '劝诱敌将投奔我军', 离间: '散布流言，降低敌将忠诚',
};
// The field's village kinds are the ROM's (data/war-maps, field.js); a player reads the 病院 as 医馆, as in the city's menu.
const VILLAGE_NAME = { 病院: '医馆' };
// The command list's rows are one line each: a shorter note where DESC does not fit (it stays the row's tooltip in full).
const NOTE = { 开发: '提高土地、产业或人口', 防灾: '修筑堤防，减轻水旱损失', 征兵: '每100兵20金，进预备兵', 分兵: '把预备兵分给武将', 侦察: '连续查看各城情报', 同盟: '遣使结盟，或废除同盟' };
const FREE = new Set(['分兵', '任命']);
const freeAct = (a) => FREE.has(a) || (a === '记录' && g.freeSave);
// The switch sits in 系统, which stays open over the dock: only the 记录 row's 免 changes (when the 城 list is open).
function markFreeSave() {
  const b = $$('.dock .acts .cmd').find((x) => x.firstChild?.textContent === zh('记录')); if (!b) return;
  const em = b.querySelector('em.free');
  if (freeAct('记录') && !em) b.append(h('em', { class: 'free' }, '免'));
  else if (!freeAct('记录') && em) em.remove();
}
// 武将不能读书 is switched the same way, in 系统 over the dock: the 书馆 row (when its list is open) and the 町
// group's dimming follow at once, without drawing the dock again.
function markNoStudy() {
  const cid = tabCity, b = $$('.dock .acts .cmd').find((x) => x.firstChild?.textContent === zh('书馆'));
  if (cid == null || !g.cities[cid]) return;
  const why = blocked(cid, '书馆');
  if (b) { b.disabled = !!why; b.title = why ? `${DESC['书馆']}（${why}）` : DESC['书馆']; b.querySelector('small').textContent = why ?? DESC['书馆']; }
  $('.dock .tabs .btn[data-tab="町"]')?.classList.toggle('dim', TABS['町'].every((x) => blocked(cid, x)));
}
// Why a command cannot run here right now (null when it can), so the dock can grey it out up front.
function blocked(cid, act) {
  const c = g.cities[cid], f = D.cities[cid].facilities, [sell, buy] = D.cities[cid].rice_rate;
  const near = (pred) => G.roads(cid).some((n) => pred(g.cities[n]));
  if (!FREE.has(act) && g.books <= 0) return '命令书已用完';
  switch (act) {
    case '调遣': return near((n) => (n.faction === g.player || n.faction === NONE) && n.officers.length < 10) ? null : '没有可调往的相邻城市';
    case '出阵': return near((n) => n.faction !== g.player) ? null : '没有相邻的敌城或空城';
    case '征兵': return G.conscriptMax(c) ? null : '金不足或预备兵已满';
    case '运输': return near((n) => n.faction === g.player) ? null : '没有相邻的己方城市';
    case '买米': return f.market && buy ? null : '此城没有市集';
    case '卖米': return f.market && sell ? (c.rice ? null : '城中无米') : '此城没有市集';
    case '卖宝': return c.treasure ? null : '没有宝物';
    case '医馆': return !f.hospital ? '此城没有医馆' : c.officers.some((id) => g.officers[id].hp < G.maxHp(g.officers[id])) ? null : '没有负伤的武将';
    case '书馆': return g.noStudy ? G.NO_STUDY : !f.school ? '此城没有书馆' : c.officers.some((id) => g.officers[id].int < 80) ? null : '没有可以学习的武将';
    case '铁铺': return f.weapons ? null : '此城没有铁铺';
  }
  return null;
}
// The menu page stays put while the same city's HUD is drawn again (after a command, a month), and goes back to 城 for
// another city, however it was chosen: a click, the map, 侦察, a war (feedback R06, 2026-11-02).
// The dock is one row of groups; a group opens its commands in a list above it (方案 2026-11-14). tabOpen: whether that
// list is up. It opens only when asked: closed for a newly chosen city and at the start of a month, and kept through the
// same city's redraws, so a run of commands does not open it again each time.
let tab = '城', tabCity = null, tabOpen = false, cmdFocus = null; // cmdFocus: where the keys were in the menu (commandDock)
// The field last picked for 开发: the picker and the 武将 / 确认 dialogs after it hand the focus back to the 开发
// row, whose still must then be that field's, not always 土地 (feedback 2026-11-07).
let devField = null;
function commandDock(cid) {
  const acts = h('div', { class: 'panel acts', role: 'menu', hidden: true }), tabs = h('div', { class: 'tabs' });
  // Pointing at a command shows a still of its 命令演出 above the dock; the animated scene still plays only
  // when the command is carried out. Hidden with the 演出 switch off and for commands without a scene.
  const frame = h('div', { class: 'vig-frame' }), preview = h('div', { class: 'cmd-preview', 'aria-hidden': 'true' }, frame);
  let want = null;
  const show = async (a) => {
    want = a;
    const scene = vignettesOn() && sceneFor(a, a === '开发' ? devField : undefined), cv = h('canvas');
    if (!scene) return preview.classList.remove('on');
    const text = a === '记录' ? recordText(g.year, g.month, name(g.factions[g.player].ruler)) : undefined;
    if ((await sceneFrame(scene, text ? 2.95 : 1.2, cv, text)) && want === a) { frame.replaceChildren(cv); preview.classList.add('on'); }
  };
  const hide = () => { want = null; preview.classList.remove('on'); };
  // A press anywhere else closes the list: not while a command is being carried out (its dialogs are not "elsewhere",
  // and the focus comes back to its row), nor under a dialog of another kind.
  const outside = (e) => {
    if (!dock.isConnected) return unwatch();
    if (!busy && !layer().lastElementChild && !dock.contains(e.target)) { cmdFocus = null; commandDock.close(); }
  };
  const unwatch = () => removeEventListener('pointerdown', outside, true);
  const names = Object.keys(TABS), tabBtn = (t) => tabs.children[names.indexOf(t)], rows = () => $$('.cmd:not(:disabled)', acts);
  // The groups' buttons are made once, so the one that holds the focus keeps it while its list opens and closes. A press
  // by the keys or the pad (a click without a pointer: detail 0) goes on into the list; the mouse's does not, as the first
  // row's still would come up unasked.
  tabs.append(...names.map((t, i) => h('button', { class: 'btn', 'data-tab': t, title: `${t}（${i + 1}）`,
    'aria-haspopup': 'menu', onclick: (e) => commandDock.toggle(t, { focus: e.detail === 0 }) }, t)));
  const draw = () => {
    for (const t of names) {
      const b = tabBtn(t), on = tabOpen && tab === t, dim = TABS[t].every((a) => blocked(cid, a));
      b.classList.toggle('on', on); b.classList.toggle('dim', dim); b.setAttribute('aria-expanded', String(on));
    }
    // Each row: the command, what it does or (greyed) why it cannot be done here, and 免 where it spends no 命令书.
    acts.replaceChildren(...(tabOpen ? TABS[tab] : []).map((a) => {
      const why = blocked(cid, a);
      return h('button', { class: 'cmd', role: 'menuitem', disabled: !!why, title: why ? `${DESC[a]}（${why}）` : DESC[a], onclick: () => runCommand(cid, a),
        onmouseenter: () => show(a), onmouseleave: hide, onfocus: () => show(a), onblur: hide },
        h('b', {}, a), h('small', {}, why ?? NOTE[a] ?? DESC[a]), freeAct(a) ? h('em', { class: 'free' }, '免') : null);
    }), preview);
    acts.hidden = !tabOpen; acts.setAttribute('aria-label', tab);
    hide(); unwatch(); if (tabOpen) addEventListener('pointerdown', outside, true);
    placeFly(); more();
  };
  // Whether rows are left below the list's edge (a short phone screen): its foot fades then (phone.css).
  const more = () => acts.classList.toggle('more', !acts.hidden && acts.scrollTop + acts.clientHeight < acts.scrollHeight - 2);
  acts.addEventListener('scroll', more, { passive: true });
  // focus: the keys go into the list (its first command that can be done; the group's button when none can).
  commandDock.open = (t, { focus = false } = {}) => {
    if (!TABS[t]) return;
    tab = t; tabOpen = true; draw(); if (focus) (rows()[0] ?? tabBtn(t)).focus({ preventScroll: true });
  };
  // focus: the keys go back to the group's button.
  commandDock.close = ({ focus = false } = {}) => { if (!tabOpen) return; tabOpen = false; draw(); if (focus) tabBtn(tab).focus({ preventScroll: true }); };
  commandDock.toggle = (t, opts) => (tabOpen && tab === t ? commandDock.close(opts) : commandDock.open(t, opts));
  // LB / RB: the group before or after, open, the focus in its list.
  commandDock.cycle = (d) => commandDock.open(names[(names.indexOf(tab) + d + names.length) % names.length], { focus: true });
  // The show plays the same picture large in the middle: the still goes until the player points at a command again
  // (the focus the confirm hands back must not bring it back under or after the show).
  commandDock.hide = hide;
  const dock = h('div', { class: 'panel dock' }, tabs, acts);
  // ↑ ↓ walk the commands that can be done, round the ends; from the group's button (a list the mouse opened) they go
  // into it, ↑ to the row nearest the button.
  dock.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !tabOpen) return;
    const r = rows(), i = r.indexOf(document.activeElement), d = e.key === 'ArrowDown' ? 1 : -1; if (!r.length) return;
    e.preventDefault(); e.stopPropagation();
    r[i < 0 ? (d > 0 ? 0 : r.length - 1) : (i + d + r.length) % r.length].focus({ preventScroll: true });
  });
  // Where the keys are in the menu ('tab:城', or a command's name), for the next drawing of this city's HUD: a command's
  // result draws it all again, and the focus its dialog hands back would be on a button that is gone.
  dock.addEventListener('focusin', (e) => { const b = e.target.closest?.('.cmd, .tabs .btn'); if (b) cmdFocus = b.matches('.cmd') ? b.firstChild.textContent : `tab:${b.dataset.tab}`; });
  commandDock.unwatch?.(); commandDock.unwatch = unwatch; // the dock before this one may have left its listener (no press came to clear it)
  draw();
  // Never under a window: a result told in one (搜索, 同盟, 诱纳…) is up as the HUD is drawn, so the focus waits for it to go.
  const refocus = () => {
    if (!cmdFocus || !dock.isConnected) return;
    if (layer().lastElementChild) { const mo = new MutationObserver(() => { if (!dock.isConnected) mo.disconnect(); else if (!layer().lastElementChild) { mo.disconnect(); queueMicrotask(refocus); } }); mo.observe(layer(), { childList: true }); return; }
    if (document.activeElement && document.activeElement !== document.body) return;
    const b = cmdFocus.startsWith('tab:') ? tabBtn(cmdFocus.slice(4)) : $$('.cmd', acts).find((x) => x.firstChild.textContent === cmdFocus);
    (b && !b.disabled ? b : tabOpen ? tabBtn(tab) : null)?.focus({ preventScroll: true });
  };
  if (cmdFocus) queueMicrotask(refocus);
  return dock;
}

let endPlayer = null, playerPose = null; // playerPose: the strategy view the player last left (strategy.pose()), restored on their next turn
// The command being run (set by runCommand) picks the 命令演出 scene; 开发 passes its field as `sub`.
let curAct = null;
// Book-spending commands play the 命令演出 in the middle of the screen before the HUD shows the new
// numbers; onBook ticks the counter at the halfway beat, as the original does.
// books: how many the command spends (a run of several 开发 or 防灾 spends one each, and shows one picture).
// result: what the command did, told once the picture has played; the caption meanwhile names only the command
// (大佬会不会看到@devblog #593: told from the first frame, the outcome left the picture nothing to show).
const DOING = { land: '开发土地', industry: '开发产业', pop: '开发人口' };
const doing = (act, sub) => `${act === '开发' ? DOING[sub] ?? '开发' : act}……`;
function cmdVignette(result, cid, sub, onShow, part, books = 1) {
  const text = curAct === '记录' ? recordText(g.year, g.month, name(g.factions[g.player].ruler)) : null;
  return playVignette({ scene: sceneFor(curAct, sub), caption: doing(curAct, sub), result, audio, text, onShow, part, books, onBook: () => {
    for (const pip of [...$$('.topbar .books i:not(.used)')].slice(-books)) pip.classList.add('used', 'burn');
    const n = $('.topbar .books + b'); if (n) n.textContent = Math.max(0, g.books - books);
  } });
}
// voice { title, text = res.msg, who, mood }: the original tells this result in a window, with the speaker's
// face set by the outcome ($00A4, research/assets-music.md). It stands in for the toast, once the picture is done.
// A picture's caption: what a run of several officers did is one line each (src/core/batch.js joins them with 　), and a line
// breaks only between them, never inside a name or a count (word joiners and no-break spaces hold each one together).
// More than three would not fit the picture on a phone: the first two, and how many more, whom the toast after it names in full.
const glue = (x) => [...x.replace(/ /g, '\u00a0')].join('\u2060');
const caption = (res) => {
  const n = res.lines?.length ?? 0;
  if (n < 2) return res.msg;
  const parts = res.msg.split('　');
  return n > 3 ? [...parts.slice(0, 2), `另 ${n - 2} 人，共 ${res.books} 次`].map(glue).join('　') : parts.map(glue).join('　');
};
async function spend(res, cid, sub, voice) {
  if (!res) return;
  const book = res.ok && !res.noBook;
  // Its phrase, then the theme from the top (T13), from the picture's first frame; with no picture, at once.
  const k = book ? cueFor(curAct, sub) : null, cue = () => { if (k) audio.cue(k); };
  // res.plain: no picture, as the original's 废除同盟.
  // res.part: how far the picture goes when the mission has not (yet) succeeded (src/vignette.js story).
  // res.quiet: the next control appears immediately in the toast's place (侦察's city picker).
  if (book && !res.plain) commandDock.hide?.();
  if (!(book && !res.plain && (await cmdVignette(caption(res), cid, sub, cue, res.part ?? (res.failed ? 'attempt' : undefined), res.books ?? 1)))) { cue(); if (!voice && !res.quiet) toast(res.ok ? `<strong>${res.msg}</strong>` : `<em>${res.msg}</em>`); }
  else if (res.lines?.length > 3 && !voice) toast(`<strong>${res.msg}</strong>`, 6000); // the picture named only two of them
  addLog(`${cityName(cid)}：${res.msg}`);
  if (book) g.books -= res.books ?? 1;
  strategy.refresh(g); hud();
  if (voice) await message(voice.title, voice.text ?? res.msg, voice.who, voice.mood);
}
// Cities are chosen on the map itself, as in the original: the candidates glow, the rest dim, the view
// frames them; a small panel names them too (hover points the city out) and Esc or 取消 backs out.
let mapPick = null;
// required: the pick cannot be put off (a forced retreat), so there is no 取消 and Esc does nothing.
// list: false keeps the names out of a mouse player's way (阿拉神丁@qq, 2026-11-19: 侦察, 出阵, 运输 said each glowing city
// twice); they are still the way in for the keys, the pad and a phone's finger (ui.css .mappick.nolist), so they stay in the panel.
// session: the picker stays up and each pick goes to session.pick(cid, setNote) (侦察, 霸王之王@devblog 2026-11-25: the city panel
// on the left is the report, so no window repeats it over the map); session.end names the button that closes it, session.esc
// asks before Esc does, and session.keep is the HUD that stays live (the city panel's officers open their cards).
function pickOnMap(title, cids, describe = () => '', { from = null, note = '点选地图上发光的城市', required = false, list = true, session = null } = {}) {
  return new Promise((resolve) => {
    strategy.pickMode(cids, from); strategy.frame(from != null ? [...cids, from] : cids);
    const ui = root(), before = document.activeElement, blockedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];
    // The HUD remains visible over the map, so it must absorb a click rather than passing it through to a city.
    const blockHud = (e) => { if (session?.keep && e.target.closest?.(session.keep)) return; e.preventDefault(); e.stopPropagation(); };
    const pick = (v) => { if (v != null && session) { session.pick(v, (t) => { noteEl.textContent = t; }); strategy.pickMode(cids, from); dockBy(); return; } done(v); };
    const done = (v) => {
      mapPick = null; document.body.classList.remove('picking', 'scouting'); removeEventListener('resize', dockBy); strategy.pickMode(null); strategy.highlight(null); panel.remove();
      removeEventListener('keydown', keys, true); for (const type of blockedEvents) ui.removeEventListener(type, blockHud, true);
      if (before?.isConnected && !before.disabled) before.focus?.({ preventScroll: true }); resolve(v);
    };
    const keys = (e) => {
      if (panel !== layer().lastElementChild) return; // a dialog above the picker gets its own Esc and Tab
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (!required) session?.esc ? session.esc().then((yes) => { if (yes && mapPick?.done === pick) done(null); }) : done(null);
        return;
      }
      const kept = session?.keep ? $(session.keep) : null;
      if (e.key === 'Tab') {
        const buttons = [...$$('button:not(:disabled)', panel), ...(kept ? $$('[role="button"]', kept) : [])].filter((b) => b.offsetParent), i = buttons.indexOf(document.activeElement);
        e.preventDefault(); e.stopPropagation();
        if (buttons.length) buttons[e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i + 1) % buttons.length].focus();
        else panel.focus({ preventScroll: true });
      } else if (ui.contains(e.target) && !kept?.contains(e.target)) { e.preventDefault(); e.stopPropagation(); panel.focus({ preventScroll: true }); }
    };
    const point = (c) => ({ onmouseenter: () => strategy.highlight(c), onmouseleave: () => strategy.highlight(null), onfocus: () => strategy.highlight(c), onblur: () => strategy.highlight(null) });
    const noteEl = h('span', { class: 'hint' }, note);
    const panel = h('div', { class: `panel mappick ${list ? '' : 'nolist'}`, role: 'dialog', tabindex: '-1', 'aria-label': title },
      h('div', { class: 'mp-head' }, h('h4', {}, title), noteEl),
      h('div', { class: 'chips' }, ...cids.map((c) => h('button', { class: 'btn', onclick: () => pick(c), ...point(c) }, cityName(c), describe(c) ? h('small', {}, describe(c)) : null)),
        // The keys and the pad reach the kept panel's officers from here (the mouse clicks them; hidden for it with the names, ui.css).
        session?.keep ? h('button', { class: 'btn keep-in', 'data-pad': 'y', onclick: () => ($(`${session.keep} .roster [role="button"]`) ?? $(`${session.keep} [role="button"]`))?.focus() }, '看武将', h('kbd', { 'data-glyph': 'y' })) : null,
        required ? null : h('button', { class: `btn ghost ${session?.end ? 'end' : ''}`, onclick: () => done(null) }, session?.end ?? '取消', h('kbd', { 'data-glyph': 'b' }, 'Esc'))));
    mapPick = { cids: new Set(cids), done: pick, keep: session?.keep ?? null, panel }; document.body.classList.add('picking');
    // Beside the report rather than centred over its edge (a short window put the picker over the panel's numbers).
    const dockBy = () => { const r = session?.keep && $(session.keep)?.getBoundingClientRect(); if (r?.width) panel.style.setProperty('--kept-right', `${Math.round(r.right)}px`); };
    if (session) { document.body.classList.add('scouting'); requestAnimationFrame(dockBy); addEventListener('resize', dockBy); }
    for (const type of blockedEvents) ui.addEventListener(type, blockHud, true);
    layer().append(panel); addEventListener('keydown', keys, true); panel.focus({ preventScroll: true });
  });
}
const pickCityMap = (title, cids, describe, opts) => pickOnMap(title, cids, describe, { from: sel, ...opts });
// The phone's 侦察 window (elsewhere the city panel is the report, see the 侦察 command): the session remains open while the player
// reads a city and its officers. Esc/backdrop returns to the city picker; only an explicit 结束侦察 ends the session (and, on the last book, the turn).
async function scoutCity(cid) {
  const c = g.cities[cid], ruler = c.faction !== NONE ? g.factions[c.faction].ruler : null;
  const next = await modal(`侦察：${cityName(cid)}`, (close) => [
    h('p', { class: 'hint' }, `${factionName(c.faction)}　·　${c.officers.length}名武将${c.officers.length ? '　·　点击武将查看详情，滚动可查看全部' : ''}`),
    cityStats(c),
    c.officers.length ? h('div', { class: 'otable-wrap scout-roster' }, officerTable(g, c.officers, {
      onPick: (id) => officerCard(id), extra: (id) => (id === ruler ? '君主' : id === c.officers[0] ? '太守' : null),
    })) : h('p', { class: 'hint' }, '这座城没有武将。'),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(false) }, '结束侦察'),
      h('button', { class: 'btn primary', onclick: () => close(true) }, '继续侦察')),
  ], { wide: true, light: true });
  return next !== false;
}
// 诱纳 / 离间: every enemy officer in one tree — faction, then city, then the officers with their numbers —
// instead of a city list followed by a second list; hovering a city points it out on the map.
// Cities start folded, one line each, and only one is open at a time, so a city far down is a short scroll; the
// last target (shared by both commands, as a 离间 is often followed by a 诱纳 of the same man) reopens with his
// city open and his row in view (试着提交留言@devblog #591). Before, the cities next to ours and every city of a
// faction with one or two cities opened with their tables, and one far down meant scrolling past them each time.
let lastMark = null; // { city, id }
function pickEnemyOfficer(act, from) {
  const near = (cid) => (G.roads(from).includes(cid) ? 0 : 1);
  const back = lastMark && g.cities[lastMark.city].faction !== g.player && g.cities[lastMark.city].faction !== NONE && g.cities[lastMark.city].officers.length ? lastMark : null;
  return modal(`${act}：选择对象`, (close) => {
    const tree = h('div', { class: 'otree', onfocusin: e => { const city = e.target.closest('.tc'); strategy.highlight(city ? Number(city.dataset.city) : null); } });
    const fold = (e) => { if (e.target.open) for (const o of tree.querySelectorAll('.tc[open]')) if (o !== e.target) o.open = false; };
    const pick = (cid) => (id) => { lastMark = { city: cid, id }; close(id); };
    for (const f of g.factions.filter((x) => x.ruler != null && x.id !== g.player)) {
      const cities = G.citiesOf(g, f.id).filter((c) => c.officers.length).sort((a, b) => near(a.id) - near(b.id));
      if (!cities.length) continue;
      const grp = h('details', { class: 'tf', open: true }, h('summary', { tabindex: 0 }, h('i', { class: 'dot', style: { background: colorOf(f.id) } }), factionName(f.id), h('small', {}, `${cities.length}城 ${cities.reduce((a, c) => a + c.officers.length, 0)}将`)));
      for (const c of cities) grp.append(h('details', { class: 'tc', 'data-city': c.id, open: back?.city === c.id, ontoggle: fold, onmouseenter: () => strategy.highlight(c.id), onmouseleave: () => strategy.highlight(null) },
        h('summary', { tabindex: 0 }, cityName(c.id), near(c.id) === 0 ? h('em', {}, '邻接') : null, h('small', {}, `${c.officers.length}将`)),
        officerTable(g, c.officers, { onPick: pick(c.id), extra: (id) => [c.officers[0] === id ? '太守' : null, back?.id === id ? '上次' : null].filter(Boolean).join(' ') || null, disabled: (id) => (G.isRuler(g, id) ? '君主' : null) })));
      tree.append(grp);
    }
    const first = tree.querySelector('.tc[open] > summary') ?? tree.querySelector('.tc:has(summary em) > summary') ?? tree.querySelector('.tc > summary');
    first?.setAttribute('data-pad-first', '');
    return [h('p', { class: 'hint' }, `${act === '诱纳' ? '劝诱敌将投奔我军' : '散布流言，降低敌将忠诚'}；忠诚越低越容易成功。点城名展开武将。`, h('span', { class: 'sort-hint' }, '点表头可排序。')), tree,
      h('div', { class: 'foot' },
        h('span', { class: 'hint tree-pad-hint' }, ...padText(k => `↑↓ 移动　←→ 收起／展开　${k('a')} 选择　${k('b')} 取消`)),
        h('button', { class: 'btn', onclick: () => close(null) }, '取消'))];
  }, { wide: true, light: true, focus: (box) => {
    // The last target's row (else his city, else the first city next to ours), scrolled to the middle of the list.
    const el = (back && box.querySelector(`.tc[open] tr[tabindex][data-id="${back.id}"]`)) ?? box.querySelector('.otree [data-pad-first]');
    requestAnimationFrame(() => el?.scrollIntoView({ block: 'center' }));
    return el;
  } }).finally(() => strategy.highlight(null));
}
// The shared 是/否 before a command spends its book (`$D5BD`): 取消 costs nothing.
const sure = (act, text) => confirmBox(act, `${text}（消耗一张命令书）`);
// Who carried each command out last in each city (`${cid}:${act}` → officer id): the list opens on him, marked 上次, so the same
// errand again is one more press (devblog #70 希洛-唯). 任命 names a new 太守 each time and keeps no such memory.
const lastWho = new Map();
async function executor(c, title, ids = c.officers) {
  const k = `${c.id}:${curAct}`, got = await pickOfficers(g, title, ids, { last: curAct === '任命' ? null : lastWho.get(k) });
  if (got?.[0] != null) lastWho.set(k, got[0]);
  return got?.[0];
}
// The 是/否 before 开发 and 防灾, with how many times in a row to carry it out: each is a command of its own (its own cost and gain
// rolled when its turn comes, its own 命令书), told in one picture. cost: this first one's, already rolled; [lo, hi]: what a later one
// can cost. The most offered is what the books and the gold surely cover. Resolves the count, or null.
function confirmRun(act, what, cost, [lo, hi], gold) {
  const max = Math.max(1, Math.min(g.books, 1 + Math.floor((gold - cost) / hi)));
  return confirmCount(act, max, (n) => (n === 1 ? `${what}，需要金 ${cost}。` : `${what}，连续 ${n} 次：第一次需要金 ${cost}，之后每次 ${lo}–${hi}，共用 ${n} 张命令书。`));
}
// The 是/否 of a command that can be given 1 to max times in a row (开发, 防灾, 赈济, 离间, 诱纳, 搜索; 宙斯之刃@bilibili): ←／→ or
// − ＋ set the count, 最多 jumps to the end, the last book is named. text(n) says what will be done. Resolves the count, or null.
function confirmCount(act, max, text) {
  max = Math.max(1, Math.min(g.books, max));
  let n = 1;
  const step = (e) => { const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]; if (d && max > 1) { e.preventDefault(); set(n + d); } };
  const say = h('p', {}), num = h('b', {}, '1');
  const less = h('button', { class: 'btn', 'aria-label': '少一次', onclick: () => set(n - 1) }, '−'), more = h('button', { class: 'btn', 'aria-label': '多一次', onclick: () => set(n + 1) }, '＋');
  const set = (v) => {
    n = Math.max(1, Math.min(max, v)); num.textContent = n; less.disabled = n <= 1; more.disabled = n >= max;
    say.replaceChildren(text(n), ...(n >= g.books ? [h('em', { class: 'runout' }, '命令书将用完，本月行动随之结束。')] : []));
  };
  set(1);
  return modal(act, (close) => [say,
    max > 1 ? h('div', { class: 'runtimes', role: 'group', 'aria-label': '连续执行次数', onkeydown: step },
      h('span', {}, '连续执行'), less, num, more, h('span', {}, `次（最多 ${max}）`), h('button', { class: 'btn ghost', onclick: () => set(n === max ? 1 : max) }, '最多')) : null,
    h('div', { class: 'foot', onkeydown: step },
      h('button', { class: 'btn', onclick: () => close(null) }, '取消'), h('button', { class: 'btn primary runok', onclick: () => close(n) }, '确定'))],
  { focus: (box) => box.querySelector('.runok') });
}
// The 是/否 of 医馆, 书馆 and 赏赐, which can take others along with the one picked (宙斯之刃@bilibili): the others who could go
// stand as buttons to press in ("一并"), numbered in the order they will go, and the command can be given each once or until he is
// full. Each time is still a command of its own (src/core/batch.js). Every time it opens on the one picked, once: what to add is
// chosen afresh, so a press or two of Enter never spends a month's books.
// pool: who else could go; tag(id): what to show by his name (体力 30/80); until: the label of 'until full', or null when there is
// no such thing; plan(ids, until) → { books, gold, treasure }, the most it could take, the dice falling low; what(ids, until): the
// sentence. Resolves { ids, until } or null.
function confirmBatch(act, first, { pool, tag, until: untilLabel, plan, what }) {
  let ids = [first], until = false;
  const say = h('p', {}), note = h('p', { class: 'hint batchnote' });
  const fold = h('div', { class: 'batchwho', role: 'group', 'aria-label': '一并执行的武将' });
  const tog = untilLabel ? h('button', { class: 'btn untilfull', onclick: () => { until = !until; draw(); } }, untilLabel) : null;
  const draw = () => {
    const most = plan(ids, until), books = Math.min(most.books, g.books), cost = [most.gold ? `金 ${most.gold}` : null, most.treasure ? `宝物 ${most.treasure} 件` : null].filter(Boolean).join('、');
    // Once each, the books are known; until full, only the most it could take.
    say.replaceChildren(what(ids, until), ids.length === 1 && !until ? '（消耗一张命令书）' : '',
      ...(books >= g.books ? [h('em', { class: 'runout' }, until && most.books >= g.books ? '命令书可能用完，用完即结束本月行动。' : '命令书将用完，本月行动随之结束。')] : []));
    note.textContent = ids.length === 1 && !until ? '' : `最多用 ${books} 张命令书${cost ? `、${cost}` : ''}，按所列顺序执行；${most.books > g.books ? '命令书不够全部做完，用完即停；' : ''}金不够时停下。`;
    if (tog) { tog.setAttribute('aria-pressed', String(until)); tog.classList.toggle('on', until); }
    const focused = fold.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    fold.replaceChildren(h('span', {}, '一并：'), h('span', { class: 'chip first' }, `1. ${name(first)}`, tag ? h('small', {}, tag(first)) : null), ...pool.map((id) => {
      const on = ids.includes(id);
      return h('button', { class: `btn chip ${on ? 'on' : ''}`, 'data-id': id, 'aria-pressed': String(on), onclick: () => { ids = on ? ids.filter((x) => x !== id) : [...ids, id]; draw(); } },
        on ? `${ids.indexOf(id) + 1}. ` : '＋ ', name(id), tag ? h('small', {}, tag(id)) : null);
    }));
    if (focused != null) fold.querySelector(`[data-id="${focused}"]`)?.focus();
  };
  draw();
  return modal(act, (close) => [say,
    g.books > 1 && pool.length ? fold : null,
    tog && g.books > 1 ? h('div', { class: 'runtimes' }, tog) : null,
    note,
    h('div', { class: 'foot' },
      h('button', { class: 'btn', onclick: () => close(null) }, '取消'),
      h('button', { class: 'btn primary runok', onclick: () => close({ ids, until }) }, '确定'))],
  { focus: (box) => box.querySelector('.runok') });
}
// Carries a command out n times in a row: run(cost) is one go ({ ok, gain, msg }), the first at the cost already shown, each later one at
// a cost rolled then (roll()). It stops at the first that cannot be done (金不足, 已经达到上限). One go is told as it always was; several
// as their sum, with how many were done and why it stopped short if it did.
function runTimes(n, cost, roll, run, sum) {
  let done = 0, gain = 0, stop = null;
  for (let i = 0; i < n; i++) { const r = run(i ? roll() : cost); if (n === 1) return r; if (!r.ok) { stop = r; break; } done++; gain += r.gain; }
  if (!done) return stop;
  return { ok: true, books: done, gain, msg: `${sum(gain)}（${done} 次${stop ? `，${stop.msg}，其余未执行` : ''}）` };
}

// A command (and any dialog it chains, e.g. 征兵 → 分兵) runs to completion before the last book
// hands the turn over, so no dialog stays open while the AI moves.
let busy = false;
// What a command changed, so the HUD can show it: city stats, the realm's totals, each officer.
function snapshot(cid) {
  const c = g.cities[cid], mine = G.citiesOf(g, g.player);
  return {
    city: { 金: c.gold, 米: c.rice, 宝: c.treasure, 人口: c.pop * 100, 土地: c.land, 产业: c.industry, 统治: c.gov, 防灾: c.disaster, 预备兵: c.reserve },
    realm: { 金: mine.reduce((a, x) => a + x.gold, 0), 米: mine.reduce((a, x) => a + x.rice, 0), 兵: mine.reduce((a, x) => a + G.troopsOf(g, x), 0) },
    offs: Object.fromEntries(c.officers.map((id) => { const o = g.officers[id]; return [id, { 兵: o.soldiers, 体: o.hp, 忠: o.loyalty, 智: o.int }]; })),
    books: g.books,
  };
}
const badge = (el, d) => { if (!el || !d) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash', d > 0 ? 'up' : 'down');
  (el.querySelector('b') || el).append(h('i', { class: `delta ${d > 0 ? 'up' : 'down'}` }, `${d > 0 ? '+' : ''}${d}`)); };
// City stats roll from the old value to the new one while flashing green or red.
function countTo(el, from, to) {
  const b = el?.querySelector('b'); if (!b) return;
  el.classList.remove('flash', 'up', 'down'); void el.offsetWidth; el.classList.add('flash', to > from ? 'up' : 'down');
  const t0 = performance.now(), step = (t) => { const k = Math.min(1, (t - t0) / 650); b.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3)); if (k < 1 && b.isConnected) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function showDeltas(cid, before) {
  const after = snapshot(cid);
  let changed = false;
  for (const [k, v] of Object.entries(after.city)) { const d = v - before.city[k]; if (d && cid === sel) countTo($(`.citypanel .stats [data-k="${k}"]`), before.city[k], v); changed ||= !!d; }
  for (const [k, v] of Object.entries(after.realm)) badge($(`.topbar [data-k="${k}"]`), v - before.realm[k]);
  for (const [id, o] of Object.entries(after.offs)) {
    const b = before.offs[id], row = $(`.citypanel .roster [data-id="${id}"]`);
    if (!b) { row?.classList.add('flash', 'up'); changed = true; continue; }
    const parts = Object.entries(o).map(([k, v]) => [k, v - b[k]]).filter(([, d]) => d);
    if (parts.length && row) { row.classList.add('flash', parts[0][1] > 0 ? 'up' : 'down'); row.querySelector('.nm')?.append(...parts.map(([k, d]) => h('i', { class: `delta ${d > 0 ? 'up' : 'down'}` }, `${k}${d > 0 ? '+' : ''}${d}`))); changed = true; }
  }
  if (after.books < before.books && !vignettesOn()) $$('.topbar .books i.used').slice(-(before.books - after.books)).forEach((p) => p.classList.add('burn'));
  if (changed) strategy.pulse?.(cid, colorOf(g.player));
}
// Only inside the player's open turn. The lock holds through the hand-off (the 命令书用尽 banner), so no
// command (分兵 is free) can open while the turn is being passed to the AI. A command that ends the game
// (the last city lost in our own war, or the thirtieth taken) releases the turn whatever books are left, so
// run() reaches ending().
async function runCommand(cid, act) {
  if (busy || !endPlayer || g.over || g.current !== g.player) return;
  busy = true;
  try {
    const before = snapshot(cid);
    curAct = act;
    try { await command(cid, act); } finally { curAct = null; }
    if (g.over || G.citiesOf(g, g.player).length === 30) { const f = endPlayer; endPlayer = null; f?.(); return; }
    if (g.cities[cid]) showDeltas(cid, before);
    if (g.books <= 0 && endPlayer) {
      const f = endPlayer; endPlayer = null;
      document.body.classList.add('handoff'); // the dock and 结束本月行动 show they are closed
      await sleep(900); await banner('命令书用尽　本月行动结束', colorOf(g.player)); f();
    }
  } finally { busy = false; document.body.classList.remove('handoff'); }
}
async function command(cid, act) {
  const c = g.cities[cid], f = D.cities[cid].facilities;
  const near = (pred) => G.roads(cid).filter((n) => pred(g.cities[n]));
  switch (act) {
    case '开发': {
      const was = devField, FIELD = { land: '土地', industry: '产业', pop: '人口' };
      // The keys start on the field developed last (marked 上次), so the same again is one press.
      const field = await modal('开发', (close) => [h('div', { class: 'cities' }, ...Object.entries(FIELD).map(([k, t]) => h('button', { class: 'btn', 'data-k': k, onclick: () => { devField = k; close(k); } }, `${t}（${k === 'pop' ? c.pop * 100 : c[k]}）`, k === was ? h('i', { class: 'lasttag' }) : null))),
        PHONE ? h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消')) : null], // no Esc on a phone
        { focus: (box) => (was ? box.querySelector(`[data-k="${was}"]`) : null) });
      if (!field) return;
      const id = await executor(c, '选择执行的武将（智力影响费用与成效）'); if (id == null) return;
      const cost = G.devCost(g, id);
      const n = await confirmRun('开发', `${name(id)} 开发${FIELD[field]}`, cost, G.devCostRange(g, id), c.gold); if (!n) return;
      return spend(runTimes(n, cost, () => G.devCost(g, id), (k) => G.develop(g, cid, id, field, k), (a) => `${FIELD[field]} +${field === 'pop' ? a * 100 : a}`), cid, field);
    }
    case '防灾': {
      const id = await executor(c, '选择执行的武将'); if (id == null) return;
      const cost = G.disasterCost(g, id);
      const n = await confirmRun('防灾', `${name(id)} 修筑堤防`, cost, G.disasterCostRange(g, id), c.gold); if (!n) return;
      return spend(runTimes(n, cost, () => G.disasterCost(g, id), (k) => G.prevent(g, cid, id, k), (a) => `防灾 +${a}`), cid);
    }
    case '调遣': {
      // A city already at 10 does not glow (it took no one); the room left is in the officer picker's title, now that a mouse
      // player no longer sees the n/10 list (the keys, the pad and a phone still do; see pickOnMap).
      const dests = near((n) => (n.faction === g.player || n.faction === NONE) && n.officers.length < 10);
      if (!dests.length) return toast('<em>没有可调往的相邻城市</em>');
      const to = await pickCityMap('调遣到哪座城池？', dests, (n) => `${g.cities[n].officers.length}/10`, { list: false }); if (to == null) return;
      const room = 10 - g.cities[to].officers.length;
      const ids = await pickOfficers(g, `选择调往${cityName(to)}的武将（还可进 ${room} 人）`, c.officers, { max: Math.min(room, c.officers.length) }); if (!ids?.length) return;
      if (!(await sure('调遣', `${ids.map(name).join('、')} 调往${cityName(to)}${ids.length === c.officers.length ? `，${cityName(cid)}将成为空城` : ''}。`))) return;
      const res = G.moveOfficers(g, cid, to, ids); await spend(res, cid); if (res.ok && !g.cities[cid].officers.length) { sel = to; hud(); }
      return;
    }
    case '搜索': {
      const id = await executor(c, '派谁去搜索？'); if (id == null) return;
      const n = await confirmCount('搜索', g.books, (k) => (k === 1 ? `${name(id)} 在${cityName(cid)}寻访人才与钱粮。（消耗一张命令书）`
        : `${name(id)} 在${cityName(cid)}寻访人才与钱粮，最多 ${k} 次（每次一张命令书）；遇到人才即停，由您决定是否录用。`)); if (!n) return;
      // Several times (宙斯之刃@bilibili): the coin, rice and 宝物 of the times before are added up and told first; the last time
      // is told as a single 搜索 is, so one who names a price is still the player's to pay or not.
      const run = B.searchRun(g, cid, id, n), res = run.last, many = run.books > 1;
      const met = res.joined != null || res.offer != null || res.refused != null, got = B.foundText(run.found);
      const before = !many ? '' : met ? `前 ${run.books - 1} 次${got ? `发现了${got}` : '一无所获'}；第 ${run.books} 次：` : '';
      if (res.offer != null) {
        await cmdVignette(`${before}${name(res.offer)} 求见`, cid, undefined, undefined, 7, run.books); // up to the talk: whether he joins is still to be asked
        g.books -= run.books; strategy.refresh(g); hud();
        if (before) addLog(`${cityName(cid)}：搜索 ${before}${name(res.offer)} 求见`);
        await message('搜索', `${before}发现了一位颇有可取之处的武将——${name(res.offer)}。`, id, 'joy');
        const ok = await confirmBox('求仕', `${name(res.offer)}愿意出仕，但要求 ${res.price} 金。是否支付？`);
        const r2 = ok ? G.hire(g, cid, res.offer, res.price) : null;
        noteSearch(cid, r2?.ok ? `${name(res.offer)}出仕` : `${name(res.offer)}求见后离去`);
        if (ok) { await spend({ ...r2, noBook: true }, cid); if (r2.ok) await message('出仕', `${name(res.offer)}加入了我军。`, res.offer, 'joy'); }
        else await spend({ ok: true, msg: `${name(res.offer)}离去了`, noBook: true }, cid);
        return;
      }
      if (many && !met) {
        // Nothing but coin, rice and 宝物 (or nothing at all), however many times.
        noteSearch(cid, got ? `发现了${got}` : '一无所获');
        const msg = `搜索 ${run.books} 次：${got ? `发现了${got}` : '什么也没有找到'}`;
        await spend({ ok: true, books: run.books, msg, part: 'attempt' }, cid, undefined, got
          ? { title: '搜索', text: `${run.books} 次寻访，共发现了${got}。`, who: id, mood: 'joy' }
          : { title: '搜索', text: `寻访了 ${run.books} 次，很遗憾，什么也没找到。`, who: id, mood: 'grief' });
        return;
      }
      noteSearch(cid, res.joined != null ? `${name(res.joined)}出仕` : res.msg === '什么也没有找到' ? '一无所获' : res.msg);
      // Whoever went out reports back: found something, 喜; nothing, 忧 (bank 27 $A906 / $A931). One who says no speaks for himself.
      // Only one who joins has the picture's whole story; one who says no opens his door, and coin or nothing is the road.
      await spend({ ...res, books: run.books, msg: `${before}${res.msg}`, part: res.joined != null ? undefined : res.refused != null ? 5 : 'attempt' }, cid, undefined, res.joined != null ? null
        : res.refused != null ? { title: '搜索', text: '我还没有侍奉他人的打算，今天就请回吧。', who: res.refused, mood: 'calm' }
        : res.msg === '什么也没有找到' ? { title: '搜索', text: '很遗憾，什么也没找到。', who: id, mood: 'grief' }
        : { title: '搜索', text: `${res.msg}。`, who: id, mood: 'joy' });
      if (res.joined != null) await message('出仕', `${before}${res.msg}`, res.joined, 'joy');
      return;
    }
    case '记录': {
      const n = await pickSlot('save', G.saves(), g.slot); if (!n) return;
      const ok = writeRecord(n);
      return spend({ ok, noBook: !!g.freeSave, msg: ok ? `已记录于记录${SLOT_NAMES[n - 1]}` : '记录失败：浏览器存储不可用或已满' }, cid);
    }
    case '快捷记录': {
      const token = G.quickToken();
      if (token === undefined) return toast('<em>记录失败：浏览器存储不可用</em>', 3500);
      const previous = G.loadQuick();
      const other = !!token && (!previous?.quickId || G.restored(previous) || !g.quickId || previous.quickId !== g.quickId);
      const free = !!g.freeSave, lastBook = !free && g.books === 1;
      const explainCost = !free && !quickCostExplained;
      if (other || lastBook || explainCost) {
        const old = previous && !G.restored(previous) ? `快捷存档（${recordLine(previous)} · ${stamp(previous.savedAt)}）属于另一局或无法确认，保存将覆盖它。` : '已有快捷存档已损坏或无法确认归属，保存将覆盖它。';
        const cost = free ? '本次免费记录。' : `本次消耗一张命令书。${lastBook ? '这是最后一张，保存后本月行动结束。' : ''}`;
        if (!(await confirmBox('快捷存档', `${other ? old : ''}${cost}确定保存吗？`))) return;
      }
      const snapshot = { ...g, freeSave: free, books: g.books - (free ? 0 : 1) };
      const result = await G.saveQuickChecked(snapshot, token);
      if (result === 'changed') return toast('<em>快捷存档已改变，请重新保存</em>', 3500);
      if (result === 'busy') return toast('<em>快捷存档正在使用，请稍后再试</em>', 3500);
      if (result === 'unavailable') return toast('<em>当前环境暂不能快捷存档，请使用普通记录</em>', 3500);
      const ok = result === 'saved';
      if (ok) { g.quickId = snapshot.quickId; quickCostExplained = true; }
      return spend({ ok, noBook: free, plain: true, msg: ok ? `快捷存档成功${free ? '（免费记录）' : '（消耗一张命令书）'}` : '记录失败：浏览器存储不可用或已满' }, cid);
    }
    case '出阵': return expedition(cid);
    case '征兵': {
      const max = G.conscriptMax(c); if (!max) return toast('<em>金不足或预备兵已满</em>');
      // The shortfall stands above the slider, which starts on it (rounded up to a hundred) when there is one.
      const { cap, have, need } = G.conscriptNeed(g, c), want = Math.ceil(need / 100);
      const short = !need ? `城中${c.officers.length}将可带兵 ${cap}，现有 ${have}（含预备兵 ${c.reserve}），兵力已足，无需再征。`
        : `城中${c.officers.length}将可带兵 ${cap}，现有 ${have}（含预备兵 ${c.reserve}），还需征兵 <b>${need}</b>${want > max ? `；本次最多可征 ${max * 100}（${max * 100 + c.reserve >= 10000 ? '预备兵至多10000' : '金不足'}）` : ''}。`;
      const v = await sliders('征兵', [{ key: 'n', label: '百人', min: 1, max, value: need ? Math.min(max, want) : Math.min(max, 5) }], { note: `${short}<br>每100兵需金20。征得的兵进入预备兵，用「分兵」分配给武将（每将最多1000）。` }); if (!v) return;
      await spend(G.conscript(g, cid, v.n), cid); return troopsDialog(cid);
    }
    case '分兵': return troopsDialog(cid);
    case '侦察': {
      if (!(await sure('侦察', '开始侦察，可连续查看各城。'))) return;
      await spend({ ok: true, msg: '开始侦察各城', quiet: true }, cid);
      const look = (target) => {
        if (g.cities[target].faction !== g.player && g.cities[target].faction !== NONE) { g.scouted ||= {}; g.scouted[target] = g.year * 12 + g.month; }
        sel = target; strategy.select(target); hud();
      };
      const askEnd = () => confirmBox('结束侦察', '结束本次侦察？已消耗的命令书不会返还。');
      // Off the phone the city panel on the left is the report: one pick shows a city there, the picker stays up for the next
      // (霸王之王@devblog, 2026-11-25: a window repeating the panel's numbers and officers covered the map). The phone keeps its
      // window, its city panel being folded away while a city is picked (phone.css).
      if (!PHONE) {
        await pickCityMap('侦察中', g.cities.map((x) => x.id), undefined, { list: false, note: '点选城市，左侧显示它的情报',
          session: { end: '结束侦察', esc: askEnd, keep: '.citypanel', pick: (t, note) => { look(t); note(`${cityName(t)}的情报在左侧，可再点选别的城市`); } } });
        hud(); return; // the panel without its 侦察中
      }
      while (true) {
        const target = await pickCityMap('侦察哪座城？', g.cities.map((x) => x.id), undefined, { list: false });
        if (target == null) {
          if (await askEnd()) return;
          continue;
        }
        look(target);
        if (!(await scoutCity(target))) return;
      }
    }
    case '任命': {
      const id = await executor(c, '任命太守'); if (id == null) return;
      return spend(G.appoint(g, cid, id), cid);
    }
    case '运输': {
      const dests = near((n) => n.faction === g.player); if (!dests.length) return toast('<em>没有相邻的己方城市</em>');
      const to = await pickCityMap('运往哪座城？', dests, undefined, { list: false }); if (to == null) return;
      const b = g.cities[to];
      const v = await sliders('运输', [{ key: 'gold', label: '金', min: 0, max: Math.min(c.gold, 9999 - b.gold), step: 10 }, { key: 'rice', label: '米', min: 0, max: Math.min(c.rice, 9999 - b.rice), step: 10 }, { key: 't', label: '宝', min: 0, max: Math.min(c.treasure, 99 - b.treasure) }], { validate: (x) => x.gold + x.rice + x.t > 0 }); if (!v) return;
      return spend(G.transport(g, cid, to, v.gold, v.rice, v.t), cid);
    }
    case '赏赐': {
      const id = await executor(c, '赏赐哪位武将？（忠诚90以上无法赏赐）'); if (id == null) return;
      if (g.officers[id].loyalty >= 90) return toast('<em>忠诚已高，无需赏赐</em>');
      const kind = await modal('赏赐', (close) => [h('div', { class: 'cities' }, h('button', { class: 'btn', disabled: c.gold < 10, onclick: () => close('gold') }, '赏金'), h('button', { class: 'btn', disabled: c.treasure < 1, onclick: () => close('t') }, '赐宝'))]); if (!kind) return;
      const treasure = kind === 't';
      const v = treasure ? { gold: 0 } : await sliders('赏金', [{ key: 'gold', label: '金', min: 10, max: Math.min(100, Math.floor(c.gold / 10) * 10), step: 10, value: 50 }], c.gold < 20 ? { note: '赏金以10为单位，金不足20时只能赏10。' } : {}); if (!v) return;
      const gift = treasure ? '宝物一件' : `金 ${v.gold}`;
      // Who else is below 90 (a ruler is never rewarded): the same gift to each, once or until 90.
      const pool = c.officers.filter((x) => x !== id && !G.isRuler(g, x) && g.officers[x].loyalty < 90);
      const run = await confirmBatch(treasure ? '赐宝' : '赏金', id, { pool, tag: (x) => `忠诚 ${g.officers[x].loyalty}`, until: '赏到忠诚90为止',
        plan: (ids, until) => { const n = ids.reduce((a, x) => a + Math.min(g.books, B.rewardNeed(g, cid, x, { gold: v.gold, treasure, until })), 0); return treasure ? { books: n, treasure: n } : { books: n, gold: n * v.gold }; },
        what: (ids, until) => (ids.length === 1 && !until ? `赐${gift}给${name(id)}。` : `赐${ids.map(name).join('、')}${until ? '，每人赏到忠诚90为止' : '，每人一次'}，每次${gift}。`) });
      if (!run) return;
      const res = B.rewardRun(g, cid, run.ids, { gold: v.gold, treasure, until: run.until });
      return spend(res, cid, undefined, { title: '赏赐', who: res?.lines?.[0]?.id ?? id, mood: 'joy' }); // the one rewarded, 喜 (bank 27 $BD4C)
    }
    case '赈济': {
      const v = await sliders('赈济', [{ key: 'gold', label: '金', min: 0, max: Math.min(100, Math.floor(c.gold / 10) * 10), step: 10 }, { key: 'rice', label: '米', min: 0, max: Math.min(100, Math.floor(c.rice / 10) * 10), step: 10 }], { note: '提高统治度，效果取决于太守的人德。', validate: (x) => x.gold + x.rice > 0 }); if (!v) return;
      const each = [v.gold && `金 ${v.gold}`, v.rice && `米 ${v.rice}`].filter(Boolean).join('、');
      const max = Math.min(v.gold ? Math.floor(c.gold / v.gold) : Infinity, v.rice ? Math.floor(c.rice / v.rice) : Infinity);
      const n = await confirmCount('赈济', max, (k) => (k === 1 ? `以${each}赈济百姓。` : `赈济 ${k} 次，每次${each}，共用 ${k} 张命令书；统治度到100即停。`)); if (!n) return;
      return spend(B.charityRun(g, cid, v.gold, v.rice, n), cid);
    }
    case '买米': case '卖米': {
      const [sell, buy] = D.cities[cid].rice_rate;
      if (!f.market || !(act === '买米' ? buy : sell)) return toast('<em>此城没有市集</em>');
      const max = act === '买米' ? Math.min(Math.ceil((c.gold * buy) / 100), 9999 - c.rice) : c.rice;
      const v = await sliders(act, [{ key: 'q', label: '米', min: 1, max, step: 1, value: Math.min(max, 100) }], { note: act === '买米' ? `100金可买米 ${buy}` : `卖100米得金 ${sell}` }); if (!v) return;
      return spend(act === '买米' ? G.buyRice(g, cid, v.q) : G.sellRice(g, cid, v.q), cid);
    }
    case '卖宝': {
      if (!c.treasure) return toast('<em>没有宝物</em>');
      const v = await sliders('卖宝', [{ key: 'n', label: '件', min: 1, max: c.treasure }], { note: '每件100金' }); if (!v) return;
      return spend(G.sellTreasure(g, cid, v.n), cid);
    }
    case '医馆': {
      if (!f.hospital) return toast('<em>此城没有医馆</em>');
      const hurt = c.officers.filter((id) => g.officers[id].hp < G.maxHp(g.officers[id])); if (!hurt.length) return toast('没有负伤的武将');
      const who = await executor(c, '治疗哪位武将？（50金）', hurt); if (who == null) return;
      const hp = (id) => `体力 ${g.officers[id].hp}/${G.maxHp(g.officers[id])}`;
      const run = await confirmBatch('医馆', who, { pool: hurt.filter((id) => id !== who), tag: hp, until: '治到满为止',
        plan: (ids, until) => { const n = ids.reduce((a, id) => a + B.healNeed(g, id, until), 0); return { books: n, gold: 50 * n }; },
        what: (ids, until) => (ids.length === 1 && !until ? `为${name(who)}治伤，需要金 50。` : `为${ids.map(name).join('、')}治伤，${until ? '每人治到体力满为止' : '每人一次'}，每次金 50。`) });
      if (!run) return;
      return spend(B.healRun(g, cid, run.ids, { until: run.until }), cid);
    }
    case '书馆': {
      if (g.noStudy) return toast(`<em>${G.NO_STUDY}</em>`);
      if (!f.school) return toast('<em>此城没有书馆</em>');
      const ok = c.officers.filter((id) => g.officers[id].int < 80); if (!ok.length) return toast('没有可以学习的武将');
      const who = await executor(c, '谁去学习？（智力80以下）', ok); if (who == null) return;
      const run = await confirmBatch('书馆', who, { pool: ok.filter((id) => id !== who), tag: (id) => `智力 ${g.officers[id].int}`, until: '学到智力80为止',
        plan: (ids, until) => ids.map((id) => B.studyNeed(g, id, until)).reduce((a, x) => ({ books: a.books + x.n, gold: a.gold + x.gold }), { books: 0, gold: 0 }),
        what: (ids, until) => (ids.length === 1 && !until ? `${name(who)} 入书馆学习，需要金 ${G.studyFee(g.officers[who].int)[0]}。`
          : `${ids.map(name).join('、')} 入书馆学习，${until ? '每人学到智力80为止' : '每人一次'}；每次金 30／20／10（智力30以下／60以下／其余）。`) });
      if (!run) return;
      return spend(B.studyRun(g, cid, run.ids, { until: run.until }), cid);
    }
    case '同盟': {
      const facs = g.factions.filter((x) => x.ruler != null && x.id !== g.player).map((x) => x.id);
      const ally = (x) => g.factions[g.player].alliance[x];
      const target = await modal('同盟：选择势力', (close) => [h('p', { class: 'hint' }, '选未结盟的势力遣使结盟；选同盟中的势力可废除同盟。'), h('div', { class: 'cities' }, ...facs.map((x) => h('button', { class: 'btn', onclick: () => close(x) }, h('i', { class: 'dot', style: { background: colorOf(x), display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', marginRight: '6px' } }), `${factionName(x)}（${G.citiesOf(g, x).length}城）${ally(x) ? ` 同盟中${ally(x)}月 · 可废除` : ''}`)))]);
      if (target == null) return;
      // An ally: the original goes straight to the book's 是/否 (bank 28 $CD0A), no envoy.
      if (ally(target)) {
        if (!(await sure('废除同盟', `与${factionName(target)}的同盟还剩${ally(target)}个月。废除后即可进攻${factionName(target)}的城池。`))) return;
        return spend(G.breakAlliance(g, g.player, target), cid);
      }
      const id = await executor(c, '派谁出使？（智力、人德越高越容易成功）'); if (id == null) return;
      if (!(await sure('同盟', `派${name(id)}出使${factionName(target)}。`))) return;
      const res = G.allianceOffer(g, cid, id, target);
      // The envoy reports a refusal with 忧 (bank 28 $CE35).
      // The picture stops at the letter: terms come next, and the treaty is sealed only when they are paid.
      await spend({ ...res, part: 'attempt' }, cid, undefined, res.quote != null ? null : { title: '同盟', text: `很遗憾，${factionName(target)}拒绝了同盟的请求。`, who: id, mood: 'grief' });
      if (res.quote != null) {
        const pay = await confirmBox('同盟', `${factionName(target)}要求${res.kind === 'gold' ? '金' : '米'} ${res.quote}作为盟约之礼。是否支付？（城中现有${res.kind === 'gold' ? '金' + c.gold : '米' + c.rice}）`);
        if (pay) { const done = G.payAlliance(g, cid, target, res.kind, res.quote); if (done.ok) await playVignette({ scene: 'ally', caption: `与${factionName(target)}缔结同盟……`, audio, part: 'after' }); await spend(done, cid, undefined, done.ok ? { title: '同盟', text: `可喜可贺，与${factionName(target)}的同盟已经成立。`, who: id, mood: 'joy' } : null); } // the picture only names the pact; the window after it tells that it stands (#593)
      }
      return;
    }
    case '诱纳': case '离间': {
      const tid = await pickEnemyOfficer(act, cid); if (tid == null) return;
      const id = await executor(c, '派谁执行？'); if (id == null) return;
      const deed = `派${name(id)}对${name(tid)}${act === '诱纳' ? '进行劝诱' : '散布流言'}`;
      const n = await confirmCount(act, g.books, (k) => (k === 1 ? `${deed}。（消耗一张命令书）`
        : act === '诱纳' ? `${deed}，直到成功为止，最多 ${k} 次（每次一张命令书）。` : `${deed}，连续 ${k} 次（每次一张命令书）；忠诚降到0即停。`)); if (!n) return;
      const res = act === '诱纳' ? B.lureRun(g, cid, id, tid, n) : B.sowRun(g, id, tid, n);
      // The one sent reports: failed, 忧; 离间 took, 喜 (bank 28 $D0C5 / $D0BD).
      await spend(res, cid, undefined, !res.ok || res.joined != null ? null
        : res.failed ? { title: act, text: n > 1 ? `抱歉，${res.msg}。` : '抱歉，策略失败了。', who: id, mood: 'grief' }
        : { title: act, text: `呵呵呵，${name(tid)}与君主的关系肯定变坏了吧。（${res.msg}）`, who: id, mood: 'joy' });
      if (res.joined != null) await message('诱纳成功', res.msg, res.joined, 'joy');
      return;
    }
    case '铁铺': {
      if (!f.weapons) return toast('<em>此城没有铁铺</em>');
      // Each one's weapon and armour stand in the list, so the buyer sees who needs what (feedback R08, 2026-11-02).
      const gear = (eq, k, t) => h('span', { class: 'gearcell' }, eq ? [equipIcon(eq.id) ? h('img', { class: 'eqi', src: equipIcon(eq.id), alt: '' }) : null, `${eq.name} ${t}+${eq[k]}`] : '—');
      const cols = [['武器', (o) => D.equipment[o.weapon]?.atk ?? 0, (o) => gear(D.equipment[o.weapon], 'atk', '攻')],
        ['防具', (o) => D.equipment[24 + o.armor]?.dfn ?? 0, (o) => gear(D.equipment[24 + o.armor], 'dfn', '防')]];
      const ids = await pickOfficers(g, '为谁购买装备？', c.officers, { cols }); if (!ids?.length) return;
      const id = ids[0], item = await equipShop(id, D.cities[cid].shop, { gold: c.gold, purse: '城金', block: (e) => G.equipBlock(g, id, e) });
      if (item == null) return;
      if (!(await sure('铁铺', `为${name(id)}购买${D.equipment[item].name}，需要金 ${D.equipment[item].price}。`))) return;
      return spend(G.buyEquip(g, cid, id, item), cid);
    }
  }
}

function troopsDialog(cid) {
  const c = g.cities[cid];
  return modal('分兵', (close) => {
    const list = h('div', {}), top = h('p', { class: 'hint' });
    const draw = () => {
      top.innerHTML = `预备兵 <b>${c.reserve}</b>　每将最多1000兵　（不消耗命令书）`;
      list.replaceChildren(...c.officers.map((id) => h('div', { class: 'row' },
        h('span', { style: { minWidth: '80px', fontWeight: 600 } }, name(id)),
        h('button', { class: 'btn', onclick: () => { G.assignTroops(g, cid, id, -1); draw(); } }, '−100'),
        h('span', { class: 'val' }, g.officers[id].soldiers),
        h('button', { class: 'btn', onclick: () => { G.assignTroops(g, cid, id, 1); draw(); } }, '+100'),
        h('button', { class: 'btn', onclick: () => { for (let k = 0; k < 10; k++) G.assignTroops(g, cid, id, 1); draw(); } }, '补满'),
        h('small', { class: 'hint' }, `${g.officers[id].army}军 武${g.officers[id].war}`))));
    };
    draw();
    return [top, list, h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => { close(true); strategy.refresh(g); hud(); } }, '完成'))];
  });
}

async function expedition(cid) {
  const c = g.cities[cid];
  const targets = G.roads(cid).filter((n) => g.cities[n].faction !== g.player);
  if (!targets.length) return toast('<em>没有相邻的敌城或空城</em>');
  // the owner alone: a rival's officer count is for 侦察 to find out (citytags.js tagHtml)
  const to = await pickCityMap('进攻哪座城？', targets, (n) => (g.cities[n].faction === NONE ? '空城' : factionName(g.cities[n].faction)), { list: false });
  if (to == null) return;
  const t = g.cities[to];
  if (t.faction !== NONE && g.factions[g.player].alliance[t.faction] > 0) return toast('<em>与该势力有同盟</em>　可在「谋 → 同盟」中废除', 4000);
  const ids = await pickOfficers(g, `出阵${cityName(to)}：选择武将（最多10人）`, c.officers, { max: Math.min(10, c.officers.length), note: '留守城中的武将将继续守城；全部出阵则此城成为空城。',
    summary: (sel) => { const troops = (ids) => ids.reduce((a, id) => a + g.officers[id].soldiers, 0), stay = c.officers.filter((id) => !sel.includes(id));
      return `出阵兵力 <b>${troops(sel)}</b>　留守 ${stay.length ? `${stay.length}将 ${troops(stay)}兵` : '<em>无（空城）</em>'}`; } });
  if (!ids?.length) return;
  // The original skips this choice when one officer goes, or when the first chosen in roster order is the
  // ruler (`bank27:$B1E3`): a ruler who takes the field commands it himself.
  const lead = c.officers.find((id) => ids.includes(id)), byRuler = ids.length > 1 && G.isRuler(g, lead);
  const cmd = ids.length === 1 || byRuler ? lead : (await pickOfficers(g, '任命总大将（总大将败走则全军败北）', ids))?.[0];
  if (cmd == null) return;
  const v = await sliders('携带军资', [{ key: 'gold', label: '金', min: 0, max: c.gold, step: 10, value: Math.min(c.gold, 100) }, { key: 'rice', label: '米', min: 0, max: c.rice, step: 10, value: Math.min(c.rice, ids.length * 150) }],
    { note: '米尽即败北；金用于战场村落（买米、治疗），米店也可卖米换金。', ok: '出阵',
      live: (x) => { const per = Math.floor((ids.reduce((a, id) => a + g.officers[id].soldiers, 0) * 4) / 1000), days = per ? Math.floor(x.rice / per) : Infinity;
        return `每日耗米约 <b>${per}</b>，可支撑 <b class="${days < 10 ? 'bad' : days < 30 ? 'warn' : 'good'}">${days >= 30 ? '30日以上' : `${days}日`}</b>（战事最长30日）　城中留金 ${c.gold - x.gold}　米 ${c.rice - x.rice}`; } });
  if (!v) return;
  g.books--;
  addLog(`${byRuler ? '君主亲征：' : ''}${name(cmd)} 率 ${ids.length} 将出阵${cityName(to)}`);
  if (t.faction === NONE && !t.officers.length) {
    occupyEmpty(g, { from: cid, to, ids, gold: v.gold, rice: v.rice });
    strategy.refresh(g); sel = to; strategy.select(to);
    await banner(`占领${cityName(to)}`, colorOf(g.player));
    addLog(`<strong>无血占领${cityName(to)}</strong>`);
    hud();
    return;
  }
  // The original shows the commander's angry face as the army marches (expression selector 2).
  audio.cue('cue-sortie');
  await message('出阵', `${name(cmd)}率${ids.length}将，向${cityName(to)}进军！`, cmd, 'angry');
  const w = setupWar(g, { from: cid, to, ids, commander: cmd, gold: v.gold, rice: v.rice });
  await fieldWar(w, 'att');
}

// ---------- Field war ----------
// Which war map this battle is on: the 低 preset (or ?flat) opens it on the flat painted map, chosen once as it opens, so a
// change of 画质 mid-battle only decides the next war. The war bar and 系统 menu say so (feedback F02, 2026-11-02:
// players upgraded, kept 低 from before, and took the flat map for the new version missing its 3D board).
// Since 2026-11-13 the 系统 menu's 战场 row (quality.js warView) can hold the war map flat or 3D whatever the 画质 (晚风和远方丶@bilibili).
let warFlat = false, flatToldThisRun = false;
const FLAT_WHY = '本场为平面战场（画质「低」），不能旋转与远近缩放。「☰ 系统 → 战场」改为3D后，下一场战争起为3D战场';
const warViewLabel = () => (warFlat ? '平面' : '3D');
const mapLabel = () => (mapKind() === 'flat' ? '平面' : '3D');
const qualityText = () => `画质 ${quality.label}`;
const warViewText = () => `战场 ${warView.label}${warView.value === 'auto' ? `（${nextWarLabel()}）` : ''}${inWar() ? `　本场${warViewLabel()}` : ''}`;
const nextWarFlat = () => PIN_FLAT || warView.flat(quality.level);
const nextWarLabel = () => (nextWarFlat() ? '平面' : '3D');
// The 画质 row changes what 随画质 means, and the war bar's notice changes the 战场 row: an open menu follows both.
function syncQualityRows() {
  for (const b of $$('.sysmenu-list button')) {
    const t = b.textContent;
    if (t.startsWith(zh('战场 '))) b.textContent = warViewText(); else if (t.startsWith(zh('画质 '))) b.textContent = qualityText();
  }
}
function flatInfo() {
  const pinned = warView.value === 'flat', next3d = !nextWarFlat();
  return modal('平面战场', (close) => [
    h('p', {}, pinned ? '「☰ 系统 → 战场」设为「平面」，战场使用平面画面；平面战场没有旋转（Q/E）与远近缩放。'
      : '画质为「低」且「☰ 系统 → 战场」为「随画质」时，战场使用平面画面，适合核显与较旧的电脑；平面战场没有旋转（Q/E）与远近缩放。'),
    h('p', { html: next3d ? '<b>下一场战争起</b>为3D战场；本场保持平面，进度不受影响。'
      : '「战场」改为「3D」后，<b>下一场战争起</b>为可旋转、缩放的3D战场，战略地图仍随画质；本场保持平面，进度不受影响。' }),
    h('div', { class: 'foot' },
      h('button', { class: 'btn', onclick: () => close() }, '关闭'),
      next3d || PIN_FLAT ? null : h('button', { class: 'btn primary', onclick: () => { warView.set('3d'); syncQualityRows(); toast('战场改为3D：下一场战争起为3D战场', 3000); close(); } }, '战场改为3D'))]);
}
// ---------- 战场中断 (src/core/suspend.js) ----------
// The war being fought, as 中断 needs it: its war, the player's side, the ledger's opening soldiers, what follows it and its field.
let warCtx = null;
function suspendBlocked() {
  if (!warCtx || !war || !inWar()) return '现在不能中断';
  if (war.st.deploying) return '布阵完成后才能中断';
  if (mode !== war) return '白兵结束后才能中断';
  if (!war.myTurn) return '敌军行动中：到我军行动时再中断';
  if (war.st.busy || mapPick || blocking()) return '请先完成当前动作';
  return null;
}
async function suspendWar() {
  const why = suspendBlocked(); if (why) return toast(`<em>${why}</em>`, 3000);
  const { w, field } = warCtx, held = peekSuspend();
  const ok = await modal('中断战斗', (close) => [
    h('p', {}, `保存${cityName(w.city)}之战（第${field.day}日）的进行状态，回到标题画面。之后在标题画面选「继续战斗」，从我军这一回合接着打。`),
    h('p', { class: 'hint' }, '中断不是记录：不占记录位置、不消耗命令书；继续时取出，只能继续一次。开始新的征程或读取记录会放弃它。'),
    held ? h('p', { class: 'hint' }, `已有中断的${cityName(held.war.city)}之战（第${held.field.day}日）；中断本场将覆盖它。`) : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(false) }, '取消'), h('button', { class: 'btn primary', onclick: () => close(true) }, '中断并回到标题'))]);
  if (!ok) return;
  const still = suspendBlocked(); if (still) return toast(`<em>${still}</em>`, 3000);
  const result = await withSuspendLock(() => {
    if (warCtx?.w !== w || warCtx?.field !== field || suspendBlocked()) return 'busy';
    if (JSON.stringify(peekSuspend()) !== JSON.stringify(held)) return 'changed';
    return suspend(g, warCtx.w, warCtx.field, { ...warCtx, yaw: war.yaw }) ? 'saved' : 'failed';
  }, { legacyFallback: true });
  if (result === 'busy') return toast('<em>战斗状态已改变，请完成当前动作后再中断</em>', 3500);
  if (result === 'changed') return toast('<em>中断战斗已改变，请重新操作</em>', 3500);
  if (result !== 'saved') return toast('<em>中断失败：浏览器存储不可用或已满，仍在战斗中</em>', 3500);
  try { sessionStorage.setItem('hd2d-title-seen', '1'); } catch {}
  await fade(true); location.reload();
}
// The suspended war taken up from the title (begin): the war, then what came after it in the unbroken game. An attack of the
// player's returns to the player's turn (G.run), as runCommand would; an AI attack finishes that AI's turn (ai.js aiDomestic)
// and the month goes on from the next faction.
async function resumeWar(rec) {
  await fieldWar(rec.war, rec.side, { field: rec.field, start: rec.start, after: rec.after, yaw: rec.yaw });
  if (g.over || G.citiesOf(g, g.player).length === 30) return;
  if (rec.after.kind === 'def') { aiDomestic(g, rec.after.faction, rec.after.pts); g.books = 0; strategy.refresh(g); hud(); }
  else if (g.books <= 0) await banner('命令书用尽　本月行动结束', colorOf(g.player));
}
// Before a new game or a record replaces it: a suspended war is given up only when the player says so.
async function leaveSuspend() {
  const s = peekSuspend(); if (!s) return true;
  const yes = await confirmBox('放弃中断的战斗', `还有一场中断的${cityName(s.war.city)}之战（第${s.field.day}日）没有继续。开始后它将被放弃，确定吗？`);
  if (!yes) return false;
  const result = await withSuspendLock(() => {
    if (JSON.stringify(peekSuspend()) !== JSON.stringify(s)) return 'changed';
    dropSuspend(); return peekSuspend() ? 'failed' : 'dropped';
  }, { legacyFallback: true });
  if (result === 'changed') toast('<em>中断战斗已改变，请重新选择</em>', 3500);
  else if (result !== 'dropped') toast('<em>未能放弃中断战斗</em>', 3500);
  return result === 'dropped';
}
const WHY = { castle: '攻占了城池', commander: '总大将失去了战斗能力', retreat: '总大将撤退', timeout: '战事持续30日未分胜负', rice: '军粮耗尽' };
// opts.after: what follows once the war is settled, kept for 中断 (suspendWar). opts.field / opts.start: a suspended war
// taken up again (resumeWar), its field and the soldiers each general opened it with (the result's ledger).
async function fieldWar(w, humanSide, { after = { kind: humanSide === 'att' ? 'att' : 'def', faction: w.attacker, pts: 0 }, field: snap = null, start: start0 = null, yaw = null } = {}) {
  await fade(true);
  document.body.dataset.screen = 'war'; clear();
  const start = start0 ?? Object.fromEntries([...w.att.ids, ...w.def.ids].map((id) => [id, g.officers[id].soldiers]));
  const field = snap ? Field.restore(g, w, snap) : new Field(g, w, humanSide);
  warCtx = { w, side: humanSide, start, after, field };
  strategy.setSeason(g.month, true); // the shared season uniforms on this month before the battle scenes read them
  const ui = warUi(field);
  await loadOfficerMarch(field.units.map((u) => u.id));
  await loadWarGround(g.month, w.city).catch((e) => console.warn('war ground', e)); // painted materials (src/warplate.js)
  warFlat = nextWarFlat();
  war = createWarView({ T, audio, ui, sprites, flat: warFlat, yaw, onSkirmish: (a, d, res, terrain) => cutIn(field, a, d, res, terrain) }, field);
  warNav?.dispose(); warNav = war.flat ? null : createWarNav(war, document.body); // on <body>: a HUD redraw clears #ui
  warRoster?.dispose(); warRoster = createWarRoster(war, document.body, { blocking: () => blocking() || dialogOpen() });
  await prewarm(war); // under the fade
  terrainPinned = false; terrainView(); // each battle opens with its generals shown
  // The 威胁 pin as the player left it (src/prefs.js), on the 3D map, where its button is: the flat map has only R held (and a
  // pad's Y), so a pin brought over from 3D would stay up there with no button to put it away.
  threatPinned = !war.flat && readFlag(PREF.threat); threatHeld = false; threatView();
  setMode(war); audio.playBgm('bgm-battle');
  await fade(false);
  await banner(snap ? `${cityName(w.city)}之战　第${field.day}日` : `${cityName(w.city)}之战`, colorOf(w.attacker));
  // The first war of this browser says where the controls are told (feedback R11, 2026-11-02).
  // The first flat war of a run says why it is flat, after the controls notice if both are due (one toast shows at a time).
  let helpFirst = false;
  try { if (!localStorage.getItem('hd2d-war-help')) { localStorage.setItem('hd2d-war-help', '1'); helpFirst = true; toast(pad.active ? `全部操作见「☰ 系统 → 说明」：按住 ${padKbd('l3')} 看地形，${padKbd('view')} 俯瞰，${padKbd('b')} 取消` : PHONE ? '单指拖动、双指缩放战场；点金格看路线，再点一次移动' : '全部操作见「☰ 系统 → 说明」：T 看地形，Tab 俯瞰，Esc／右键取消', 6000); } } catch {}
  if (warFlat && !flatToldThisRun && !PIN_FLAT && !PHONE && warView.value === 'auto') { flatToldThisRun = true; setTimeout(() => document.body.dataset.screen === 'war' && toast(FLAT_WHY, 7000), helpFirst ? 6000 : 0); }
  const over = await war.finished;
  warCtx = null; // settled from here on: nothing left to break off
  const res = field.result();
  const before = { att: [...w.att.ids], def: [...w.def.ids] };
  res.placement = await settleMenu(w, res, humanSide); res.placementSide = humanSide;
  const out = resolveWar(g, w, res);
  const win = (over.loser === 'att' ? 'def' : 'att') === humanSide;
  audio.sfx(win ? 'sfx-victory' : 'sfx-horn'); audio.playBgm('bgm-result');
  const ledger = (side) => h('div', { class: `ledger ${side === humanSide ? 'me' : 'foe'}` },
    h('h4', {}, h('i', { class: 'dot', style: { background: colorOf(side === 'att' ? w.attacker : w.defender) } }), `${factionName(side === 'att' ? w.attacker : w.defender)}军`, h('small', {}, side === humanSide ? '我军' : '敌军')),
    ...before[side].map((id) => { const [t, cls, dead] = warFate(g, w, res, id), now = dead ? 0 : g.officers[id].soldiers, lost = start[id] - now;
      return h('div', { class: 'lrow' }, avatar(id, side === over.loser ? 'grief' : 'joy'), h('span', { class: 'nm' }, `${id === before[side][0] ? '★' : ''}${name(id)}`),
        h('span', { class: 'tr' }, `${start[id]} → ${now}`, lost > 0 ? h('em', {}, ` −${lost}`) : null), h('span', { class: `fate ${cls}` }, t)); }));
  await modal('', (close) => [
    h('div', { class: `result ${win ? 'win' : 'lose'}` }, h('h2', {}, win ? '胜　利' : '败　北'), h('p', {}, `${cityName(w.city)}之战　第${field.day}日　${WHY[over.why]}`)),
    h('div', { class: 'ledgers' }, ledger(humanSide), ledger(humanSide === 'att' ? 'def' : 'att')),
    h('p', { class: 'hint', style: { textAlign: 'center' } }, `${cityName(w.city)}归属：${factionName(g.cities[w.city].faction)}`),
    h('div', { class: 'foot' }, h('button', { class: 'btn primary', onclick: () => close(true) }, '返回大地图'))], { wide: true, label: win ? '胜利' : '败北' });
  await fade(true);
  warNav?.dispose(); warNav = null; warRoster?.dispose(); warRoster = null; war?.dispose?.(); war = null; document.body.dataset.screen = 'strategy'; setMode(strategy);
  strategy.refresh(g); sel = w.city; strategy.select(w.city); strategy.focusCity(w.city); audio.playBgm('bgm-strategy'); hud();
  // No save until the faction check: res.adrift lives only here, and a record taken in between (the phone's autosave
  // on hide, during this fade) would come back with the 下野 ruler still heading his house, for a later check to kill.
  const held = busy; busy = true;
  try { await fade(false); await G.checkFactions(g, io, res.adrift); } finally { busy = held; }
  strategy.refresh(g); hud();
  addLog(`${cityName(w.city)}之战：${win ? '<strong>我军胜利</strong>' : '<em>我军败北</em>'}`);
  void out;
}

// Post-war settlement (`$CE9E`). A human loser sends each surviving officer (and our prisoners) to one of the
// neighbouring own / ownerless cities or 下野 (never the ruler). A human winner gets the same menu only when
// survivors and prisoners outnumber the battle city's 10 places (`$D2E1`: up to 10 go in directly), with
// the battle city first. With nowhere to go there is no menu: the ruler is lost and the rest scatter (`$CDB8`).
async function settleMenu(w, res, side) {
  const lost = res.loser === side, f = side === 'att' ? w.attacker : w.defender, queue = lost ? loserQueue(res) : winnerQueue(res);
  const opts = lost ? retreatOptions(g, w, f) : [w.city, ...retreatOptions(g, w, f)];
  if (!queue.length || !opts.length || (!lost && queue.length <= 10)) return null;
  const base = Object.fromEntries(opts.map((n) => [n, (n === w.city ? 0 : g.cities[n].officers.length) + res.retreated.filter((x) => x.city === n).length]));
  if (!opts.some((n) => base[n] < 10)) return null; // every road leads to a full city: the no-retreat rule applies
  const pick = {}, used = { ...base };
  const order = [...opts].sort((a, b) => (b === w.city) - (a === w.city) || (b === w.from) - (a === w.from) || (g.cities[b].faction === f) - (g.cities[a].faction === f) || base[a] - base[b]);
  for (const id of queue) { const n = order.find((c) => used[c] < 10); pick[id] = n ?? (G.isRuler(g, id) ? order[0] : 'ronin'); if (n != null) used[n]++; }
  const cmd = lost && res.retreated.find((x) => x.id === w[res.loser].ids[0]);
  const verb = (c) => (c === w.city ? `入${cityName(c)}` : `${lost ? '退往' : '前往'}${cityName(c)}`);
  return modal('战后安置', (close) => {
    const sum = h('div', { class: 'settle-sum' }), warn = h('p', { class: 'settle-warn' }), ok = h('button', { class: 'btn primary', onclick: () => close(pick) }, '确定');
    const count = () => { const n = { ...base }; for (const v of Object.values(pick)) if (v !== 'ronin') n[v]++; return n; };
    const draw = () => {
      const n = count();
      // A won city needs at least one officer to hold it.
      const bare = !lost && n[w.city] === 0;
      sum.replaceChildren(...opts.map((c) => h('span', { class: n[c] > 10 || (c === w.city && bare) ? 'over' : '' }, `${cityName(c)} ${n[c]}/10`)));
      warn.textContent = bare ? `${cityName(w.city)}须至少留一人驻守` : opts.some((c) => n[c] > 10) ? '有城市超过10人' : '';
      ok.disabled = bare || opts.some((c) => n[c] > 10);
    };
    const rows = queue.map((id) => h('div', { class: 'lrow settle' }, avatar(id, lost ? 'grief' : 'joy'),
      h('span', { class: 'nm' }, name(id), G.isRuler(g, id) ? h('em', {}, '君主') : null), h('span', { class: 'tr' }, `兵 ${g.officers[id].soldiers}`),
      h('select', { 'aria-label': `${name(id)}的去向`, onchange: (e) => { pick[id] = e.target.value === 'ronin' ? 'ronin' : Number(e.target.value); draw(); } },
        ...opts.map((c) => h('option', { value: c, selected: pick[id] === c }, `${verb(c)}${g.cities[c].faction === NONE && c !== w.city ? '（空城）' : ''}`)),
        G.isRuler(g, id) ? null : h('option', { value: 'ronin', selected: pick[id] === 'ronin' }, '下野'))));
    draw();
    const hint = lost ? `${cmd ? `总大将已退往${cityName(cmd.city)}。` : ''}为战场上的武将选择退路，每城最多10人。`
      : `${cityName(w.city)}最多容纳10人，请为其余武将与俘虏选择去处。`;
    return [h('p', { class: 'hint' }, hint), h('div', { class: 'ledger me' }, ...rows), sum, h('div', { class: 'foot' }, warn, ok)];
  }, { label: '战后安置', forced: true }); // like the original's menu (B does not leave it), only 确定 ends it
}

// 铁铺 / 战场武器店: weapons and armour in their own tables, each with its stat set against what he
// carries now. Resolves to the chosen equipment id, or null.
function equipShop(id, stock, { gold, purse, block, title = '铁铺' }) {
  const eq = stock.map((e) => D.equipment[e]), o = g.officers[id];
  const now = { weapon: D.equipment[o.weapon], armor: D.equipment[24 + o.armor] };
  return modal(title, (close) => [h('p', { class: 'hint' }, `${name(id)} 现装备：${now.weapon?.name}（攻${now.weapon?.atk ?? 0}）/ ${now.armor?.name}（防${now.armor?.dfn ?? 0}）　${purse} ${gold}`),
    ...[['weapon', '武器', 'atk', '攻'], ['armor', '防具', 'dfn', '防']].map(([kind, title, k, label]) => {
      const list = eq.filter((e) => e.kind === kind).sort((a, b) => a[k] - b[k]);
      if (!list.length) return null;
      return h('div', { class: 'shop' }, h('h4', {}, title),
        h('div', { class: 'shop-row head' }, h('span', {}, '名称'), h('span', {}, label), h('span', {}, '比较'), h('span', {}, '重'), h('span', {}, '价格'), h('span', {})),
        ...list.map((e) => { const why = block(e.id), dv = e[k] - (now[kind]?.[k] ?? 0);
          return h('button', { class: 'shop-row', disabled: gold < e.price || !!why, title: why || null, onclick: () => close(e.id) },
            h('span', { class: 'nm' }, h('img', { class: 'eqi', src: equipIcon(e.id), alt: '' }), e.name), h('span', {}, e[k]), h('span', { class: dv > 0 ? 'up' : dv < 0 ? 'down' : '' }, dv > 0 ? `+${dv}` : dv || '—'), h('span', {}, e.weight), h('span', {}, `${e.price}金`), h('small', {}, why || (gold < e.price ? '金不足' : ''))); }));
    }),
    h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: () => close(null) }, '取消'))], { wide: true });
}

// A three-quarter arc with its arrowhead, turning left (-1) or right (1): the font's ⟲ ⟳ fall back to a glyph too small to read.
const TURN_ICON = (dir) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="display:block${dir > 0 ? ';transform:scaleX(-1)' : ''}"><path d="M5.5 9.5A7.5 7.5 0 1 1 6 16.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M3 4.5 5.5 10l5.6-1.9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function warUi(field) {
  const human = field.human;
  return {
    log: (x) => { const box = $('.logbox'); if (box) box.prepend(h('p', { html: x })); if (PHONE) toast(x, 2400); },
    warHud(s) {
      $('.warbar')?.remove();
      root().prepend(h('div', { class: 'panel warbar' },
        h('span', { class: 'day' }, `${s.city}之战　第${s.day}日/${s.max}`),
        h('span', { class: `turn ${s.deploying ? 'deploy' : s.myTurn ? 'mine' : 'theirs'}` }, s.deploying ? '布阵中' : s.myTurn ? '我军行动' : '敌军行动'),
        h('span', { class: 'side me' }, `${s.me.name}(${s.me.role})`, '机动力', h('b', {}, s.me.pool), `兵${s.me.troops} 米${s.me.rice} 金${s.me.gold}`),
        h('span', { class: 'side foe' }, `${s.foe.name}`, '机动力', h('b', {}, s.foe.pool), `兵${s.foe.troops} 米${s.foe.rice}`),
        warFlat ? h('button', { class: 'btn viewmode', title: '本场是平面战场，点此查看原因与如何换回3D战场', onclick: flatInfo }, '平面战场') : null));
      if (!$('.logbox')) root().append(h('div', { class: 'panel logbox' }), sysButtons());
      $('.wardock')?.remove();
      const act = s.myTurn && !s.deploying;
      root().append(h('div', { class: 'panel wardock' },
        h('button', { class: 'btn', disabled: !act || !s.canUndo, title: '撤销上一次移动，退还机动力（Z）', 'data-pad': 'x', onclick: () => war?.undo() }, '撤销', h('kbd', {}, 'Z')),
        // Turning the 3D board (Q / E, or a right drag): a pair riding over the dock's right end, so the dock keeps its width beside the foe's card.
        h('div', { class: 'panel turnpair' },
          // 威胁: with the turn pair, so the dock keeps its width beside the foe's card. The flat map has no pair: there it is R alone.
          h('button', { class: 'btn icon threatbtn', 'aria-pressed': String(threatPinned), title: '敌军威胁范围（按住 R 临时查看）：敌军下次行动时，任何一名敌将单独最远能打到的格子。机动力全军共用，不是全体同时能到。指着一名敌将只看他一人的', 'aria-label': '敌军威胁范围', onclick: () => pinThreat(!threatPinned) }, '威', h('kbd', { class: 'pad-only', 'data-glyph': 'y' })),
          h('button', { class: 'btn icon turnbtn', title: '向左旋转视角（Q，或按住右键拖动）', 'aria-label': '向左旋转视角', html: TURN_ICON(-1), onclick: () => war?.rotate?.(-1) }),
          h('button', { class: 'btn icon turnbtn', title: '向右旋转视角（E，或按住右键拖动）', 'aria-label': '向右旋转视角', html: TURN_ICON(1), onclick: () => war?.rotate?.(1) })),
        h('button', { class: 'btn terrainbtn', 'aria-pressed': String(terrainPinned), title: '人物淡出，显示被遮住的地形（按住 T 临时查看）', onclick: () => { terrainPinned = !terrainPinned; terrainView(); } }, '地形', h('kbd', { 'data-glyph': 'l3' }, 'T')),
        PHONE ? h('button', { class: 'btn icon cyclebtn', disabled: !act, 'aria-label': '上一名武将', onclick: () => keyCycle(-1) }, '‹') : null,
        PHONE ? h('button', { class: 'btn icon cyclebtn', disabled: !act, 'aria-label': '下一名武将', onclick: () => keyCycle(1) }, '›') : null,
        h('button', { class: 'btn primary', disabled: !act, title: '我军全体待机，结束本日（Enter）', 'data-pad': 'y-hold', onclick: () => endDay() }, '待机·结束本日', h('kbd', {}, '⏎'))));
    },
    // two of these make a 计略 when the picture is off: each takes half the original's 3.48 s less the wrap-up
    stratBanner: (n) => banner(n, '#c070ff', paced(ORIGINAL.strategyCast)),
    // the original's 95-frame window after a 计略: what it did, closing by itself (Enter / a click sooner)
    // who / mood: the face the original's window wears (war-view playStrategy); also the 十面埋伏 report.
    // extra: ms at 1× added for a run of several casts told in one window, a line each (src/war/play.js playRun)
    stratResult: (n, text, who = null, mood = 'calm', { extra = 0 } = {}) => message(n, text, who, mood, { auto: paced(ORIGINAL.strategyResult + extra) }),
    // 升级 and the 计略 it opens (messages 4A/4D and 4B, bank13 $C74F): windows the player closes, as the original's wait for a button.
    levelUp: ({ id, to, warFrom, war }) => message('升级', `<strong>${name(id)}升级了</strong>　等级 ${to}${war > warFrom ? `<br>武力提升了 ${war - warFrom}（${warFrom}→${war}）` : ''}`, id, 'joy'),
    learnStrategies: ({ id, names }) => message('计略', `<strong>${name(id)}学会了新的计略</strong><br>${names.join('、')}`, id, 'joy'),
    deploy(on) {
      $('.deploybtn')?.remove();
      if (on) root().append(h('div', { class: 'panel deploybtn' },
        h('div', {}, h('b', {}, '布阵'), h('p', { class: 'hint' }, pad.active ? padText((k) => `光标选我军武将按 ${k('a')}，再到绿色格按 ${k('a')} 放置。`) : '点选我军武将，再点绿色格放置。', h('br'), '地形不限，开战后不能再调整。')),
        h('button', { class: 'btn primary', 'data-pad': 'y-hold', onclick: () => war?.finishDeploy() }, '布阵完成', h('kbd', { class: 'pad-only' }))));
    },
    warUnit(info) {
      const was = document.activeElement?.closest?.('.actpanel') ? document.activeElement.dataset : null; // the row the keys were on
      $('.unitpanel:not(.compare)')?.remove(); $('.unitacts')?.remove();
      if (!info) { panelKey = null; $('.actpanel')?.remove(); return cardBoxTidy(); }
      const { u, o, mine, village, canRetreat, canUndoHim, strategies, recast, deploying, busy, flash, asking, targets, stage, confirm, canAttack } = info;
      const ours = mine && field.turn === human && !deploying;
      // His commands stand in his card, the same place whoever he is and wherever he stands, flat or 3D (D32: they used to stand
      // beside him and dock into the card when no spot was clear). While the field plays a move, attack or 计略 out they stay in
      // place but greyed, so the card does not reflow on every action and a list cannot open on a pool that is about to change.
      // Phone: a move waits for its second tap (src/war/interact.js): his card offers the same answer as buttons.
      const ask = PHONE && stage === 'cmds' && ours && !asking && !busy ? war.st.moveAsk : null;
      let acts = ask ? [
        h('button', { class: 'btn primary movego', onclick: () => { moveTapped = true; war.clickCell(ask.x, ask.y); } }, '确认移动', h('small', {}, `机动力 −${ask.spent}`)),
        h('button', { class: 'btn', onclick: () => war.cancel() }, '取消'),
      ] : stage === 'cmds' && ours && !asking ? [
        // 攻击: the enemies beside him in the panel (one alone is asked about at once); a click on a red cell asks the same.
        canAttack ? h('button', { class: 'btn', disabled: !!busy, title: '攻击相邻的敌将（机动力 2），在左侧确认后进入白兵战', onclick: () => war.openAttacks() }, '攻击') : null,
        strategies.length ? h('button', { class: 'btn', disabled: !!busy, 'aria-haspopup': 'menu', 'data-key': 'f', title: '计略（F）', onclick: () => war.openStrategies() }, '计略', h('kbd', { class: 'keycap', 'data-label': 'F' })) : null,
        // 再施: the 计略 he cast last, straight to its targets (the one he cast it on first); greyed, with the reason, when it cannot be cast now.
        recast ? h('button', { class: 'btn recast', disabled: !!busy || !recast.usable, 'data-key': 'x', title: recast.usable ? `再施${recast.name}：机动力 ${recast.cost}，目标照常选择并确认（X）` : `现在不能再施${recast.name}：${recast.why || '无法施展'}`,
          onclick: () => war.recast() }, '再施', h('small', {}, recast.name), h('kbd', { class: 'keycap', 'data-label': 'X' })) : null,
        canUndoHim ? h('button', { class: 'btn', disabled: !!busy, title: '撤销他刚才的移动，退还机动力（Z）', onclick: () => war.undo() }, '撤销移动') : null,
        canRetreat ? h('button', { class: 'btn', disabled: !!busy, onclick: () => retreatDialog(field, u) }, '退却') : null,
        village === '病院' ? (o.hp >= G.maxHp(o, u.id)
          ? h('button', { class: 'btn', disabled: true, title: '体力已满，无需治疗' }, '体力已满')
          : h('button', { class: 'btn', disabled: !!busy, title: `体力 ${o.hp}/${G.maxHp(o, u.id)}，恢复 35–45`, onclick: () => war.service('hospital') }, '治疗 50金')) : null,
        village === '武器店' ? h('button', { class: 'btn', disabled: !!busy, onclick: () => warShop(field, u) }, '武器店') : null,
        // 米店 buys and sells, as the original's field shop does (bank9 $C0BB states 1 and 2; D30, 2026-11-10). Each asks for the
        // amount with the city's rate and what the side holds; a trade that cannot be made is greyed with the reason.
        ...(village === '米店' ? (() => {
          const ch = field.chest(human), [sell, buy] = D.cities[field.war.city].rice_rate;
          const canBuy = Math.min(Math.floor((ch.gold * buy) / 100), 9999 - ch.rice), noSell = !ch.rice ? '军粮已尽' : ch.gold >= 9999 ? '军资金已满' : '';
          return [
            h('button', { class: 'btn', disabled: !!busy || canBuy < 1, title: canBuy < 1 ? (ch.rice >= 9999 ? '军粮已满' : '军资金不足') : `100金可买米 ${buy}`, onclick: async () => {
              const v = await sliders('买米', [{ key: 'q', label: '米', min: 1, max: canBuy, step: 1, value: Math.min(canBuy, 100) }], { note: `100金可买米 ${buy}　军资金 ${ch.gold}　军粮 ${ch.rice}` });
              if (v) war.service('rice', v.q);
            } }, '买米'),
            h('button', { class: 'btn', disabled: !!busy || !!noSell, title: noSell || `卖100米得金 ${sell}`, onclick: async () => {
              const v = await sliders('卖米', [{ key: 'q', label: '米', min: 1, max: ch.rice, step: 1, value: Math.min(ch.rice, 100) }], { note: `卖100米得金 ${sell}　军资金 ${ch.gold}　军粮 ${ch.rice}　米尽即败北` });
              if (v) war.service('sell', v.q);
            } }, '卖米'),
          ];
        })() : []),
      ].filter(Boolean) : [];
      // Phone: 攻击, 计略, 再施 and 撤销移动 each keep a slot of their own at the foot of the stack whether or not they can be used now
      // (greyed, with the reason), so the thumb finds each in the same place for every general. What a place offers (退却, 治疗, the
      // shops) and the answer to a move stand in the row above them, which comes and goes without moving the four.
      if (PHONE && stage === 'cmds' && ours && !asking) {
        const is = (b, t) => b.firstChild?.textContent === zh(t), take = (t) => { const i = acts.findIndex((b) => is(b, t)); return i < 0 ? null : acts.splice(i, 1)[0]; };
        const off = (t, why) => h('button', { class: 'btn slot', disabled: true, title: why }, t, ask ? null : h('small', {}, why));
        const extra = ask ? [acts[1], acts[0]] : null; // 取消 on the left, 确认移动 under the right thumb
        if (ask) acts = [];
        const four = [take('攻击') ?? off('攻击', '身旁无敌将'), take('计略') ?? off('计略', strategies.length ? '' : '未学计略'), take('再施') ?? off('再施', '尚未施计'), take('撤销移动') ?? off('撤销移动', '未移动')];
        for (const b of four) b.classList.add('slot');
        const above = extra ?? acts; // what is left: the place's own commands
        // 确认移动 stood where 退却 (or 治疗 50金) stands once he has moved: a thumb's quick run of taps on it must not run on into
        // that. The place's commands wake a moment after the move has played out.
        if (!ask && !busy && moveTapped) { moveTapped = false; actsHold = performance.now() + 700; }
        // Asleep, a button lets the tap through to the stack under it (src/phone.css), where it does nothing; every such tap keeps
        // the row asleep a little longer (the listener below), so the row wakes only once the thumb has stopped.
        const wake = (b) => { const left = actsHold - performance.now(); if (left > 0) setTimeout(() => wake(b), left); else b.classList.remove('asleep'); };
        if (!ask && (moveTapped || actsHold > performance.now())) for (const b of above) { b.classList.add('asleep'); if (!moveTapped) wake(b); }
        acts = [...(above.length % 2 ? [h('span', { class: 'gap' })] : []), ...above, ...four];
      }
      const picking = stage === 'targets' || stage === 'confirm';
      cardBox().prepend(unitCard({ u, o, field, D, mine, village: village, side: 'left', portrait: figure(u.id), name, expText, equipIcon, flash: !!flash, acts,
        hint: deploying ? (pad.active ? padText((k) => `光标移到绿色格按 ${k('a')} 放置此武将`) : '点击绿色格放置此武将')
          : stage === 'attacks' ? '在左侧选择攻击目标' : stage === 'strike' ? '在左侧确认攻击' : stage === 'strats' ? '在左侧选择计略' : picking && targets ? (stage === 'confirm' ? '在左侧确认施展' : `点紫色格或左侧名单里的武将，施展${targets.name}`) : stage === 'confirm' ? '在左侧确认施展'
          : village ? `所在：${VILLAGE_NAME[village] ?? village}` : mine && field.turn === human ? (pad.active ? padText((k) => `光标移到金格按 ${k('a')} 移动；对他再按 ${k('a')} 打开命令；对红格敌将按 ${k('a')}，再按 ${k('a')} 开战（2机动力）`) : PHONE ? (ask ? '再点一次该格，或点「确认移动」' : '点金格看路线，再点一次移动；点红格敌将开战') : '金格移动；点红格敌将，在左侧确认后开战（2机动力）') : mine ? '敌军行动中' : '敌将' }));
      // On a short window the 计略 steps fold his card to name, bars and gear, so the panel above it has room for its list.
      if (['strats', 'targets', 'confirm', 'attacks', 'strike'].includes(stage) && innerHeight <= 760) $('.unitpanel:not(.compare)')?.classList.add('brief');
      actPanel(info, was);
    },
    // The target the pointer or the pad's cursor is on, lit in the panel's list and scrolled into it (null: none).
    warHot(id) {
      for (const b of $$('.actpanel [data-target].hot')) if (Number(b.dataset.target) !== id) b.classList.remove('hot');
      const b = id == null ? null : $(`.actpanel [data-target="${id}"]`);
      if (b && !b.classList.contains('hot')) { b.classList.add('hot'); b.scrollIntoView({ block: 'nearest' }); }
    },
    // The foe's card beside ours: while one of ours is selected and the pointer is on an enemy, or a 攻击 / 计略
    // is being asked about him. `null` puts it away.
    warCompare(info) {
      $('.unitpanel.compare')?.remove();
      if (!info) return cardBoxTidy();
      const { u, o, village } = info;
      cardBox().append(unitCard({ u, o, field, D, mine: false, village, side: 'right', portrait: figure(u.id), name, expText, equipIcon }));
    },
  };
}

// ---------- The action panel (D32, docs/战场操作与白兵入口优化方案_2026-11-10_D32.md) ----------
// A 计略 is chosen, its target picked and the cast confirmed in one panel at the left edge, the same place whoever casts and
// wherever he stands (feedback D32, kevin@devblog, 仔仔周@devblog: the commands and the target list moved about between his side,
// his card and the top left). On the 3D map it is a column under 系统 that the camera always keeps out of the frame (frameWar's
// left inset); the flat board does not move or shrink for it, so there the panel rises from the strip of cards at the bottom
// (a target it covers can still be taken by name from the list). Head: who, the army's 机动力 (it is the army's, not his own)
// and the step; body: the 计略 or the targets; foot: what will happen and the buttons, which never move with the list's length.
if (PHONE) addEventListener('pointerdown', (e) => { if (performance.now() < actsHold && e.target.closest?.('.unitpanel .acts')) actsHold = performance.now() + 500; }, true);
let moveTapped = false, actsHold = 0; // phone: 确认移动 was tapped; until when the commands in its row stay asleep after the move
let stratArmed = null; // phone: the 计略 whose row was tapped once (its description is up); a second tap picks it
let runClickAt = 0; // when a button of the confirmation's count was last taken (actPanel)
let panelKey = null; // the step on screen: `caster:stage:计略`, to tell a step that has just come up from one redrawn
const panelWidth = () => (innerWidth <= 1200 ? 252 : 288);
function actPanel(info, was) {
  const { u, stage, strategies, targets, confirm, busy, attacks, strike } = info;
  if (!['strats', 'targets', 'confirm', 'attacks', 'strike'].includes(stage) || !war) { $('.actpanel')?.remove(); panelKey = null; return; }
  const f = war.field, pool = f.pool[f.human], S = confirm ?? targets, fighting = stage === 'attacks' || stage === 'strike';
  const key = `${u.id}:${stage}:${S?.id ?? ''}:${(confirm?.t ?? strike?.t)?.id ?? ''}`, fresh = key !== panelKey; panelKey = key;
  // ↑ ↓ walk the rows (Tab still works); a held arrow keeps walking, but never picks.
  const walk = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const l = [...e.currentTarget.closest('.ap-body').querySelectorAll('button:not([disabled])')]; if (l.length < 2) return;
    e.preventDefault(); l[(l.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length].focus();
  };
  const back = h('button', { class: 'btn ap-back', disabled: !!busy, onclick: () => war.cancel() }, '返回', h('kbd', { 'data-glyph': 'b' }, 'Esc'));
  let body, foot;
  if (stage === 'strats') {
    // Each 计略 with its cost; one he cannot cast now says why in the row itself (not only in a tooltip). The foot tells what the
    // one pointed at or walked to does and where it can be cast.
    const idle0 = '命中率取决于双方智力、等级与距离（6格以内）', info2 = h('p', { class: 'hint ap-info' });
    // Phone: there is no pointer to hover with, so the first tap on a 计略 tells what it does (and marks the row) and the second picks
    // it; one that cannot be cast is told the same way, with the reason. stratArmed outlives the panel's redraws.
    if (fresh) stratArmed = null;
    const idle = PHONE ? '点一下计略看说明，再点一次选用' : idle0;
    const tell = (x) => { if (!x) { info2.textContent = idle; return; } const i = STRAT_INFO[x.id]; info2.replaceChildren(h('b', {}, x.name), `　${i.does}。条件：${i.where}。`, x.usable ? (PHONE ? h('i', { class: 'again' }, '再点一次选用') : '') : h('em', {}, `现在不能用：${x.why || '无法施展'}`)); };
    // (the second tap of a quick pair is the pick: it does not pass fresh2, which refuses the second click of a double click)
    const arm = (x, e) => { stratArmed = x.id; for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); tell(x); };
    // The row says it short (the foot has the whole reason): no mobility, no target in reach, or his own place.
    const short = (w = '') => (w.startsWith('机动力不足') ? '机动力不足' : w.startsWith('6格内') ? '6格内无合适目标' : w || '无法施展');
    body = h('div', { class: 'ap-body strats', role: 'menu', 'aria-label': '计略', onpointerleave: PHONE ? null : () => tell(null) },
      ...strategies.map((x) => h('button', { class: `btn${PHONE && stratArmed === x.id ? ' on' : ''}${PHONE && !x.usable ? ' off' : ''}`, role: 'menuitem', disabled: !!busy || (!PHONE && !x.usable), 'aria-disabled': PHONE && !x.usable ? 'true' : null, 'data-sid': x.id, title: `${STRAT_INFO[x.id].does}\n条件：${STRAT_INFO[x.id].where}${x.usable ? '' : `\n现在不能用：${x.why || '无法施展'}`}`,
        onclick: (e) => { if (PHONE && (!x.usable || stratArmed !== x.id)) return arm(x, e); if (PHONE || fresh2(e)) war.chooseStrategy(x.id); }, onfocus: PHONE ? null : () => tell(x), onkeydown: walk },
      h('span', {}, x.name, x.last ? h('i', { class: 'lasttag' }) : null), h('small', {}, x.cost), x.usable ? null : h('em', {}, short(x.why)))));
    // A greyed button takes no pointer events of its own in every browser, so the list watches the pointer for it.
    tell(PHONE ? strategies.find((x) => x.id === stratArmed) : null);
    if (!PHONE) body.addEventListener('pointermove', (e) => { const b = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ap-body.strats .btn'); tell(b ? strategies.find((x) => String(x.id) === b.dataset.sid) : null); });
    foot = h('div', { class: 'ap-foot' }, info2, h('div', { class: 'ap-btns' }, back));
  } else if (fighting) {
    // 攻击 (D32 §6): the enemies beside him, then what the cards do not say and bears on whether to strike: the 白兵's ground (his
    // cell), a castle he holds (he stands in its formation; ours is chosen as ever), whether he is their 总大将, and what is left.
    const t = strike?.t ?? null, on = (r) => t && r.u === t, entering = !!strike?.entering;
    const point = (r) => war?.hoverCell?.({ x: r.u.x, y: r.u.y }, true);
    const reach = (r) => { point(r); if (document.body.dataset.input !== 'mouse') war.keepInView?.(r.u); };
    body = h('div', { class: 'ap-body targets attacks', role: 'group', 'aria-label': '攻击的目标' },
      ...(attacks ?? []).map((r) => h('button', { class: `btn${on(r) ? ' on' : ''}`, disabled: !!busy, 'data-target': r.u.id, 'aria-pressed': on(r) ? 'true' : 'false',
        title: on(r) ? `再按一次攻击${name(r.u.id)}` : `攻击${name(r.u.id)}：兵 ${r.o.soldiers}，白兵地形 ${r.ground}`,
        onclick: (e) => war.clickCell(r.u.x, r.u.y, e), onpointerenter: () => point(r), onfocus: () => reach(r), onkeydown: walk },
      h('span', {}, `${r.commander ? '★' : ''}${name(r.u.id)}`), h('small', {}, `兵${r.o.soldiers}`), h('em', {}, r.ground))));
    const sum = strike ? [
      h('p', { class: 'ap-who' }, name(u.id), h('i', {}, '→'), '攻击', h('i', {}, '→'), name(t.id)),
      // Phone: the foe's card shows his name and bars only (its figures are a hover's on a desktop), so the two are set side by side here.
      ...(PHONE ? [[u, info.o, 'mine'], [t, attacks?.find((r) => r.u === t)?.o, 'foe']].filter(([, o]) => o).map(([x, o, c]) => h('p', { class: `ap-vs ${c}` }, h('b', {}, name(x.id)), `武${o.war} 智${o.int} 等级${o.level} 兵${o.soldiers} 体${o.hp}`)) : []),
      // Every line but the last hint stays at every size: these are what the cards do not say (the hint only repeats the buttons).
      h('p', {}, '白兵地形：', h('b', {}, strike.ground), strike.castle ? `；${name(t.id)}在城内，守方用城池阵，你方照常选阵` : ''),
      strike.commander ? h('p', { class: 'ap-key' }, '敌总大将：白兵中斩杀或俘获他即结束战争（他撤出且生还则战争继续）') : null,
      h('p', {}, `消耗 ${strike.cost}，全军余 `, h('b', {}, strike.left), `（还够攻击 ${strike.attacks} 次）`),
      h('p', { class: 'ap-warn' }, '开战后不能撤回'),
      PHONE ? null : h('p', { class: 'hint' }, entering ? '正在进入战斗…' : pad.active ? padText((k) => `再对${name(t.id)}按 ${k('a')}，或按「进入白兵战」`) : `再点${name(t.id)}或按 Enter 进入白兵战`),
    ] : [h('p', {}, `消耗 2，全军余 `, h('b', {}, pool - 2), `（还够攻击 ${Math.max(0, Math.floor((pool - 2) / 2))} 次）`),
      h('p', { class: 'hint' }, pad.active ? padText((k) => `选好敌将按 ${k('a')}；推右到地图上选`) : '点红格或名单里的敌将')];
    const idle = PHONE && !strike && !busy && !!attacks?.length;
    const go = h('button', { class: `btn primary ap-go${strike && fresh ? ' arming' : ''}${idle ? ' idle' : ''}`, disabled: !!busy || (!strike && !idle) || entering, 'aria-disabled': idle ? 'true' : null, title: strike ? `攻击${name(t.id)}，进入白兵战（Enter）` : '先选一名敌将',
      onclick: (e) => (idle ? nudgeTargets(e.currentTarget) : war.commitAttack(e)) }, entering ? '正在进入战斗…' : idle ? '先点上面的敌将' : '进入白兵战', entering || idle ? null : h('kbd', { 'data-glyph': 'a' }, '⏎'));
    if (strike && fresh) setTimeout(() => go.classList.remove('arming'), GUARD);
    const aim = h('button', { class: 'btn ap-aim', disabled: !!busy, 'data-key': 'l', 'data-pad': 'r3', title: '镜头移到目标处（L）',
      onclick: () => { const id = Number(document.activeElement?.dataset?.target ?? NaN), r = attacks?.find((x) => x.u.id === id); war.locate(t ?? r?.u ?? attacks?.[0]?.u); } }, '定位目标', h('kbd', { 'data-label': 'L' }, 'L'));
    foot = h('div', { class: 'ap-foot' }, h('div', { class: 'ap-sum' }, ...sum.filter(Boolean)), h('div', { class: 'ap-btns' }, back, war.flat ? null : aim, go));
  } else {
    const t = confirm?.t ?? null, on = (r) => t && r.u === t;
    const point = (r) => war?.hoverCell?.({ x: r.u.x, y: r.u.y }, true);
    // A row walked to with the keys or the pad brings its general into the clear if he is not (a pointer sweeping the list does not).
    const reach = (r) => { point(r); if (document.body.dataset.input !== 'mouse') war.keepInView?.(r.u); };
    body = targets ? h('div', { class: 'ap-body targets', role: 'group', 'aria-label': `${targets.name}的目标` },
      ...targets.rows.map((r) => h('button', { class: `btn${on(r) ? ' on' : ''}`, disabled: !!busy, 'data-target': r.u.id, 'data-last': r.last ? '' : null, 'aria-pressed': on(r) ? 'true' : 'false',
        title: `${on(r) ? '再按一次施展' : '对'}${name(r.u.id)}${on(r) ? '' : `施展${targets.name}`}：${targets.id === 8 ? `忠诚 ${r.o.loyalty}，` : ''}命中率约 ${r.chance}%`,
        onclick: (e) => war.clickCell(r.u.x, r.u.y, e), onpointerenter: () => point(r), onfocus: () => reach(r), onkeydown: walk },
      h('span', {}, `${r.commander ? '★' : ''}${name(r.u.id)}`, r.last ? h('i', { class: 'lasttag' }) : null), h('small', {}, `兵${r.o.soldiers}`), h('em', {}, `${r.chance}%`))))
      : h('div', { class: 'ap-body none' }, h('p', { class: 'hint' }, `${name(u.id)}在此林中设下伏兵，兵 100 留作伏兵，5 日内敌军走进两格内的森林时遭伏击。`));
    const sum = confirm ? [
      h('p', { class: 'ap-who' }, name(u.id), h('i', {}, '→'), confirm.name, ...(t ? [h('i', {}, '→'), name(t.id)] : [])),
      t ? h('p', {}, confirm.loyalty != null ? `${name(t.id)}忠诚 ${confirm.loyalty}，` : '', confirm.n > 1 ? '第一次' : '', `命中率约 `, h('b', {}, `${confirm.chance}%`), confirm.n > 1 ? '（升级会变）' : '') : null,
      confirm.max > 1 ? null : h('p', {}, `消耗 ${confirm.cost}，全军余 `, h('b', {}, confirm.left), `（还够攻击 ${confirm.attacks} 次）`), // with a count, said under it
      confirm.n > 1 && !confirm.until ? h('p', { class: 'ap-runnote' }, '每次命中另算；兵尽或不合条件即停') : null,
      h('p', { class: 'ap-does' }, `效果：${STRAT_INFO[confirm.id].does}`),
      h('p', { class: 'hint' }, pad.active ? padText((k) => (t ? `再对${name(t.id)}按 ${k('a')}，或按「施展」` : `按「施展」`)) : t ? `再点${name(t.id)}或按 Enter 施展` : '按 Enter 或「施展」'),
    ] : [h('p', {}, `消耗 ${targets.cost}，全军余 `, h('b', {}, pool - targets.cost), `（还够攻击 ${Math.max(0, Math.floor((pool - targets.cost) / 2))} 次）`),
      h('p', { class: 'hint' }, pad.active ? padText((k) => `选好目标按 ${k('a')}；推右到地图上选`) : '点紫色格或名单里的武将')];
    // 施展 stands in its place from the start, greyed until a target is picked, so the buttons never move between the steps.
    // Picked, it is held off for a moment (src/commitguard.js): the click or the key that picked the target does not cast.
    // Phone (2026-11-17): the hint above is the line a short screen drops first, and a lone target's row, focused as the list
    // comes up, looks picked already; so before a pick the greyed button says what it waits for and, tapped, lights the list.
    const idle = PHONE && !confirm && !busy && !!targets?.rows.length;
    const go = h('button', { class: `btn primary ap-go${confirm && fresh ? ' arming' : ''}${idle ? ' idle' : ''}`, disabled: !!busy || (!confirm && !idle), 'aria-disabled': idle ? 'true' : null, title: confirm ? `施展${confirm.name}（Enter）` : '先选一个目标',
      onclick: (e) => (idle ? nudgeTargets(e.currentTarget) : war.commitCast(e)) }, confirm ? `施展${confirm.name}` : idle ? '先点上面的目标' : '施展', idle ? null : h('kbd', { 'data-glyph': 'a' }, '⏎'));
    if (confirm && fresh) setTimeout(() => go.classList.remove('arming'), GUARD);
    // 连续 N 次 (羽之@devblog, 2026-11-18): 1 to the pool ÷ the cost, from 1 every time the question comes up; ← → (the pad's left and
    // right) or − ＋ set it, 最多 jumps to the end. Not for 十面埋伏, nor when the pool holds one cast. Outside the summary, which
    // scrolls on a phone, so the row is always in sight beside the buttons.
    // What the count costs stands under it (at 1, the line the summary has always had), so on a phone, whose summary scrolls, it is in sight.
    const runSum = confirm && confirm.max > 1 ? (confirm.n === 1 ? h('p', { class: 'ap-runsum' }, `消耗 ${confirm.cost}，全军余 `, h('b', {}, confirm.left), `（还够攻击 ${confirm.attacks} 次）`)
      : confirm.until ? h('p', { class: 'ap-runsum' }, `成功即停；最多耗 ${confirm.cost * confirm.n}，至少余 `, h('b', {}, confirm.left))
      : h('p', { class: 'ap-runsum' }, `共耗 ${confirm.cost * confirm.n}，全军余 `, h('b', {}, confirm.left), `（还够攻击 ${confirm.attacks} 次）`)) : null;
    // The panel grows by this row as the question comes up, so on the flat board (where it rises over the cells) a button of it can
    // come up under the pointer that picked the target: the second click of that double click, or a press from before, must not
    // add a time (src/commitguard.js). A quick run of clicks on the buttons themselves still counts each.
    if (fresh) runClickAt = 0;
    const runClick = (e, f) => { const t = performance.now(), ok = fresh2(e) || (e.detail >= 2 && t - runClickAt < 700); if (!ok) return; runClickAt = t; f(); };
    const run = confirm && confirm.max > 1 ? h('div', { class: 'ap-run', role: 'group', 'aria-label': '连续施展次数' },
      h('span', { class: 'ap-runlabel' }, confirm.until ? '最多' : '连续'),
      h('button', { class: 'btn', 'data-run': 'less', 'aria-label': '少一次', disabled: !!busy || confirm.n <= 1, onclick: (e) => runClick(e, () => war.runCount(-1)) }, '−'),
      h('b', { class: 'ap-runn' }, confirm.n),
      h('button', { class: 'btn', 'data-run': 'more', 'aria-label': '多一次', disabled: !!busy || confirm.n >= confirm.max, onclick: (e) => runClick(e, () => war.runCount(1)) }, '＋'),
      h('button', { class: 'btn ghost', 'data-run': 'max', disabled: !!busy, title: `最多 ${confirm.max} 次（←／→ 调整）`, onclick: (e) => runClick(e, () => war.runCount(0, confirm.n === confirm.max ? 1 : confirm.max)) }, '最多')) : null;
    const aim = targets || t ? h('button', { class: 'btn ap-aim', disabled: !!busy, 'data-key': 'l', 'data-pad': 'r3', title: war.flat ? '平面战场全图可见' : '镜头移到目标处（L）',
      onclick: () => { const id = Number(document.activeElement?.dataset?.target ?? NaN), r = targets?.rows.find((x) => x.u.id === id); war.locate(t ?? r?.u ?? targets?.rows[0]?.u); } }, '定位目标', h('kbd', { 'data-label': 'L' }, 'L')) : null;
    foot = h('div', { class: 'ap-foot' }, h('div', { class: 'ap-sum' }, ...sum.filter(Boolean)), run, runSum, h('div', { class: 'ap-btns' }, back, war.flat ? null : aim, go));
  }
  const step = fighting ? ['命令', '攻击', ...(strike ? [name(strike.t.id)] : [])] : ['命令', '计略', ...(stage !== 'strats' && S ? [S.name] : [])];
  const el = h('div', { class: `panel actpanel ${stage}${war.flat ? ' flat' : ''}`, role: 'group', 'aria-label': `${name(u.id)}的${fighting ? '攻击' : '计略'}` },
    h('div', { class: 'ap-head' }, h('b', {}, name(u.id)), h('span', { class: 'ap-pool' }, '全军机动力 ', h('b', {}, pool)),
      h('div', { class: 'ap-step' }, ...step.flatMap((x, i) => (i ? [h('i', {}, '›'), h('span', {}, x)] : [h('span', {}, x)])))),
    body, foot);
  const old = $('.actpanel'), scroll = old?.querySelector('.ap-body')?.scrollTop ?? 0;
  if (old) old.replaceWith(el); else root().append(el);
  placePanel(el);
  if (!fresh) el.querySelector('.ap-body').scrollTop = scroll;
  // The keys go to the list as it comes up, never to 施展 (D32 §9.2): the 计略 he cast last, the target he was on (or cast on
  // last), the picked target in the confirmation; a redraw keeps the row that had the focus, and a focus the player took back
  // to the map (the pad's right out of the list, a click there) stays where he put it.
  if (busy || (!fresh && !was)) return;
  const pickRow = stage === 'strats'
    ? (was?.sid != null && el.querySelector(`[data-sid="${was.sid}"]:not(:disabled)`)) || (info.chosen != null && el.querySelector(`[data-sid="${info.chosen}"]:not(:disabled)`)) || el.querySelector('.strats [data-sid] .lasttag')?.closest('button:not(:disabled)') || el.querySelector('.strats button:not(:disabled)')
    : (was?.run != null && el.querySelector(`[data-run="${was.run}"]:not(:disabled)`)) || (was?.run != null && el.querySelector('[data-run="max"]')) || ((confirm?.t ?? strike?.t) && el.querySelector(`[data-target="${(confirm?.t ?? strike?.t).id}"]`)) || (was?.target != null && el.querySelector(`[data-target="${was.target}"]`)) || el.querySelector('[data-target][data-last]') || el.querySelector('[data-target]') || (stage === 'confirm' || stage === 'strike' ? back : null);
  pickRow?.focus({ preventScroll: true }); pickRow?.scrollIntoView?.({ block: 'nearest' });
}
// A row picks on a new input only: not the second click of a double click, not a key held from the step before.
const fresh2 = (e) => freshInput(e, { pick: true });
// 3D: a column from under 系统 down to the cards; flat: rising from the strip of cards at the bottom, over the board's edge.
// Phone: the greyed 施展 / 进入白兵战 tapped before a target is picked lights the target rows once, so the eye goes where the tap belongs.
function nudgeTargets(btn) {
  for (const b of btn.closest('.actpanel')?.querySelectorAll('.ap-body.targets [data-target]') ?? []) { b.classList.remove('nudge'); void b.offsetWidth; b.classList.add('nudge'); }
}
function placePanel(el = $('.actpanel')) {
  if (!el || !war) return;
  if (PHONE) { for (const k of ['width', 'top', 'height', 'bottom', 'maxHeight']) el.style[k] = ''; return; } // src/phone.css places it
  el.style.width = `${panelWidth()}px`;
  if (war.flat) { el.style.top = ''; el.style.height = ''; el.style.bottom = `${FLAT_INSET.bottom + 4}px`; el.style.maxHeight = `${innerHeight - FLAT_INSET.top - FLAT_INSET.bottom - 12}px`; return; }
  const top = ($('.sysbtns')?.getBoundingClientRect().bottom ?? 96) + 10, card = $('.unitpanel:not(.compare)')?.getBoundingClientRect();
  // Under 1200 px the foe's card stacks as a strip over ours (ui.css): its room is kept whether it is up or not, so the column does not jump.
  const bottom = Math.max(top + 200, (card?.top ?? innerHeight - 220) - 10 - (innerWidth <= 1200 ? 76 : 0));
  el.style.bottom = ''; el.style.maxHeight = ''; el.style.top = `${top}px`; el.style.height = `${bottom - top}px`;
}
addEventListener('resize', () => placePanel());
// The two general cards share one row above the dock (ours first, the foe's after), so they never overlap
// whatever the width; the row stacks them when the window is narrow (ui.css .warcards).
const cardBox = () => $('.warcards') ?? root().appendChild(h('div', { class: 'warcards' }));
const cardBoxTidy = () => { const b = $('.warcards'); if (b && !b.children.length) b.remove(); };

// The selected general's commands stand beside him on the war map, flat or 3D, so 计略 and its targets are a short reach
// apart wherever he is (playtest of 2026-10-30, T10); the panel at the bottom keeps his particulars. Right of
// him unless that runs off the screen, kept inside the band between the HUD strips (flat) or clear of the HUD panels (3D).
// On the 3D map the camera moves. While it only slides (WASD, a drag) the bar rides along with him as it stands, and once the
// camera has come to rest it looks for its spot again; a turn or a zoom changes the cells round him, so it is placed again every
// frame of those (feedback R05, 2026-11-02: it jumped about under WASD). Where every spot would cover another general, a cell he
// can walk to, strike or cast on, or a panel, and while he is off the screen, `dock` takes the buttons into his card instead; they
// come back beside him once a spot is clear (feedback G01, 2026-11-04: 计略 and 退却 stood on the cell the player wanted). The attack
// prompt has no card: over a general or a target it is hidden, over plain move cells it stays, since those are not its question.
function besideUnit(u, acts, label = `${name(u.id)}的命令`, dock = null) {
  const live = acts.filter(Boolean);
  if (!live.length || !war?.screenOf) return null;
  const el = h('div', { class: 'panel unitacts', role: 'toolbar', 'aria-label': label }, ...live);
  // Move / attack / 计略 cells and other generals stay clickable while the bar is up, so of the spots round him
  // (right, left, then a step further out, then above and below) it takes the first that covers none of them;
  // and one that keeps off the cards, the dock and the other panels.
  let last = null, lens = '', side = null, off = null, still = 0, moved = false, docked = false, away = false;
  const toCard = (on) => {
    if (on === docked) return;
    const box = on ? dock?.() : el;
    if (on && !box) { el.style.visibility = 'hidden'; docked = true; el.dataset.docked = ''; return; } // nowhere to go: out of the way
    const held = document.activeElement; box.append(...live); docked = on;
    el.style.visibility = on ? 'hidden' : ''; on ? (el.dataset.docked = '') : delete el.dataset.docked;
    if (live.includes(held)) held.focus({ preventScroll: true }); // a move takes the focus off a button (the 计略 target list is walked with the keys)
  };
  // The camera's turn, tilt and distance: unchanged between two frames, it only slid.
  const lensOf = () => { const v = war.viewState?.() ?? {}; return `${v.yaw?.toFixed(4)},${v.pitch?.toFixed(4)},${v.dist?.toFixed(3)},${innerWidth},${innerHeight}`; };
  el.place = (force = true) => {
    // A camera easing to rest creeps by fractions of a pixel for seconds; under half a pixel a frame counts as still.
    const three = !war.flat, c = war.screenOf(u.x, u.y), key = { x: c.x, y: c.y, cw: c.cw, w: innerWidth, h: innerHeight };
    if (!force && last && Math.abs(c.x - last.x) < 0.5 && Math.abs(c.y - last.y) < 0.5 && Math.abs(c.cw - last.cw) < 0.1 && last.w === innerWidth && last.h === innerHeight) {
      if (moved && ++still === 12) { moved = false; pick(c, three, true); } // the camera has come to rest
      return;
    }
    const slid = !force && three && off && lensOf() === lens;
    last = key; still = 0; moved = !force;
    const top = three ? ($('.warbar')?.getBoundingClientRect().bottom ?? 0) + 6 : FLAT_INSET.top + 6, bottom = three ? innerHeight - 8 : innerHeight - FLAT_INSET.bottom - 6;
    if (c.x < 0 || c.x > innerWidth || c.y < top || c.y > bottom) { away = true; return toCard(true); } // he is off the screen
    if (away) { away = false; return pick(c, three, true); } // back on it: beside him at once
    if (slid && !docked) { // the camera only slid: ride along as it stands
      const r = { width: el.offsetWidth, height: el.offsetHeight };
      el.style.left = `${Math.max(12, Math.min(innerWidth - 12 - r.width, c.x + off.x))}px`; el.style.top = `${Math.max(top, Math.min(bottom - r.height, c.y + off.y))}px`;
      return;
    }
    pick(c, three, force);
  };
  // Looks for the bar's spot; `settle` (a fresh bar, or the camera at rest) may also take it into the card or bring it back.
  function pick(c, three, settle) {
    lens = lensOf();
    if (away || (docked && !settle)) return; // off the screen he keeps his commands in the card
    const wasDocked = docked; if (docked) toCard(false); // measured where it would stand
    const r = { width: el.offsetWidth, height: el.offsetHeight }, fs = war.flatState?.(); // layout size, not the scaled-in box
    // What stands over a cell: on the flat map the cell and the two above it (his figure and his plaque), on the 3D map a box
    // from his feet to the tag over his head. Other generals' and his own; the marks are the cells that take a click.
    const stand = (p) => three ? [{ x0: p.x - Math.max(p.cw * 0.4, 46), x1: p.x + Math.max(p.cw * 0.4, 46), y0: p.y - p.rise * 1.5 - 56, y1: p.y + p.ch * 0.3 }]
      : [0, 1, 2].map((k) => ({ x0: p.x - p.cw / 2, x1: p.x + p.cw / 2, y0: p.y - p.ch / 2 - k * p.ch, y1: p.y + p.ch / 2 - k * p.ch }));
    const tile = (p, k = 1) => (p.diamond ? { x: p.x, y: p.y, hw: p.cw / 2 * k, hh: p.ch / 2 * k } : { x0: p.x - p.cw / 2 * k, x1: p.x + p.cw / 2 * k, y0: p.y - p.ch / 2 * k, y1: p.y + p.ch / 2 * k });
    // A move cell counts by its middle (a clipped corner still takes the click). It weighs what a general or a target does; for a
    // bar with no card to go to, next to nothing: however many it covers, that never outweighs a target or takes it off the screen.
    const plain = dock ? 1 : 0.005;
    const busy = [...(fs?.marks ?? []).map((m) => (m.kind === 'move' || m.kind === 'path' ? { ...tile(war.screenOf(m.x, m.y), 0.7), w: plain } : { ...tile(war.screenOf(m.x, m.y)), w: 1 })),
      ...(fs?.units ?? []).filter((x) => x.visible && x.u !== u).flatMap((x) => stand(war.screenOf(Math.round(x.x), Math.round(x.y))).map((b) => ({ ...b, w: 1 })))];
    const mine = stand(c);
    const hud = $$('.warbar, .unitpanel, .wardock, .turnpair, .logbox, .sysbtns, .deploybtn, .unitacts, .warroster').filter((e) => e !== el && e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return { x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }; });
    const top = three ? ($('.warbar')?.getBoundingClientRect().bottom ?? 0) + 6 : FLAT_INSET.top + 6, bottom = three ? innerHeight - 8 : innerHeight - FLAT_INSET.bottom - 6;
    const at = (sd, k) => {
      const x = sd === 'r' ? c.x + c.cw * k : sd === 'l' ? c.x - c.cw * k - r.width : c.x - r.width / 2;
      const y = sd === 'u' ? c.y - c.ch * k - r.height : sd === 'd' ? c.y + c.ch * k : c.y - r.height / 2;
      return { sd, k, x: Math.max(12, Math.min(innerWidth - 12 - r.width, x)), y: Math.max(top, Math.min(bottom - r.height, y)) };
    };
    const hits = (p, b) => {
      if (b.hw == null) return p.x < b.x1 && p.x + r.width > b.x0 && p.y < b.y1 && p.y + r.height > b.y0;
      const qx = Math.max(p.x, Math.min(b.x, p.x + r.width)), qy = Math.max(p.y, Math.min(b.y, p.y + r.height)); // the diamond's nearest point in the bar
      return Math.abs(qx - b.x) / b.hw + Math.abs(qy - b.y) / b.hh < 1;
    };
    // The cost of a spot: what it covers, and his own place or a panel is out of the question. A step further out costs less than
    // covering anything, so the nearest clear spot wins however far out it is.
    const cover = (p) => busy.reduce((n, b) => n + (hits(p, b) ? b.w : 0), 0) + (mine.some((b) => hits(p, b)) ? 99 : 0) + hud.filter((b) => hits(p, b)).length * 99;
    const costOf = (p, ring) => cover(p) + ring * 0.0001;
    let best = null;
    search: for (const [ring, k] of [0.62, 1.6, 2.6].entries()) for (const sd of ['r', 'l', 'u', 'd']) {
      const p = at(sd, sd === 'u' || sd === 'd' ? k - 0.1 : k), n = costOf(p, ring);
      if (!best || n < best.n) best = { ...p, n, ring };
      if (n < 0.001) break search; // clear of everything
    }
    // Keep the side the bar was on while it is as good as the best (the camera easing must not flip it from side to side).
    if (side && side.k <= best.k) { const p = at(side.sd, side.k), n = costOf(p, side.ring); if (n <= best.n) best = { ...p, n, ring: side.ring }; }
    side = { sd: best.sd, k: best.k, ring: best.ring };
    el.dataset.side = best.sd === 'l' ? 'l' : 'r';
    el.style.left = `${best.x}px`; el.style.top = `${best.y}px`;
    off = { x: best.x - c.x, y: best.y - c.y };
    // Covering anything that counts in full: into the card, if this is the moment to decide; else as it was.
    const blocks = busy.some((b) => b.w >= 1 && hits(best, b)) || best.n >= 99;
    toCard(settle ? blocks : wasDocked);
  }
  return el;
}
addEventListener('resize', () => { for (const el of $$('.unitacts')) el.place?.(); });

// 战场武器店: the battle city's field stock, paid from this side's 军资金. The field is held while the
// shop and its confirmation are open, and the purchase goes to the unit it was opened for.
async function warShop(field, u) {
  if (!war || war.st.busy) return;
  const view = war; view.hold(true);
  try {
    const ch = field.chest(u.side);
    const item = await equipShop(u.id, field.shopStock().map((e) => e.id), { title: '武器店', gold: ch.gold, purse: '军资金', block: (e) => G.equipBlock(g, u.id, e, { field: true }) });
    if (item == null || !(await confirmBox('武器店', `为${name(u.id)}购买${D.equipment[item].name}，从军资金支付 ${D.equipment[item].price}金。`))) return;
    view.shop(u, item, { held: true });
  } finally { view.hold(false); }
}

// 退却, from the click to the answer: the field is held (no selecting, moving, undo or ending the day
// through the fades and the map), a second click is ignored, and the retreat goes to the unit the dialog
// was opened for.
let retreating = false;
async function retreatDialog(field, u) {
  if (retreating || !war || war.st.busy) return;
  retreating = true; war.hold(true);
  const view = war;
  try {
    const t = field.retreatTargets(u);
    const city = t.length === 1 ? t[0] : await retreatOnMap(field, u, t);
    if (city != null && (await confirmBox('退却', u.commander ? `总大将${name(u.id)}退往${cityName(city)}将使全军败北，确定吗？` : `${name(u.id)}退往${cityName(city)}？${g.cities[city].faction === NONE ? '（退入空城即占领）' : ''}`)))
      view.retreat(city, u, { held: true });
  } finally { view.hold(false); retreating = false; }
}
// 退却 picks its city on the 战略地图, as the original does: the war fades out to the map around the
// battlefield, its roads light up, and the own or empty cities on them glow.
async function retreatOnMap(field, u, cids) {
  const ui = root(), back = mode;
  await fade(true);
  ui.style.visibility = 'hidden'; setMode(strategy); strategy.refresh(g, (c) => field.headcount(c.id)); strategy.select(field.war.city);
  await fade(false);
  const city = await pickOnMap(`${name(u.id)}退往哪座城？`, cids, (n) => (g.cities[n].faction === NONE ? '空城' : `${field.headcount(n)}/10将`),
    { from: field.war.city, note: `${cityName(field.war.city)}相邻的己方城或空城` });
  await fade(true);
  strategy.select(null); ui.style.visibility = ''; setMode(back);
  await fade(false);
  return city;
}

// ---------- 白兵 (tactical battle) ----------
async function cutIn(field, a, d, res, terrain) {
  const human = field.human, battle = res.pending;
  if (!battle) return;
  const look = (u) => (u.side === human || (!human && u.side === 'att') ? 'attacker' : 'defender');
  const looks = { a: look(a), d: look(d) }, hs = battle.human;
  const troopLooks = { a: G.officerTroops(a.id, field.faction(a.side)), d: G.officerTroops(d.id, field.faction(d.side)) }; // a pack's 战象, 足轻 …
  const cine = $('#cine');
  cine.innerHTML = `<div class="bar top"></div><div class="bar bot"></div><div class="vsmark">白兵</div><div class="speed"></div><div class="flash"></div>`;
  cine.className = ''; cine.hidden = false; document.body.classList.add('cine');
  const restoreView = await war.focusPair(a, d);
  let restored = false; const restore = () => { if (!restored) { restored = true; restoreView(); } };
  try { // a throw in the cut must not leave the close-up on: it locks Q / E / Tab for the rest of the battle
    cine.classList.add('enter'); cineFlash(); audio.sfx('sfx-horn');
    await sleep(600);
    await Promise.all([loadOfficerSprites([battle.side.a.id, battle.side.d.id]), loadTroopLooks(looks, troopLooks)]);
    const where = { month: g.month, city: field.war.city }; tview.setPlace(where); // same season and place as the war map
    await tview.ready(); // its painted ground (src/tacticalground.js)
    // Under the walls when either general is within two cells of the castle: the 单挑 is fought before the gate.
    const [cx, cy] = field.castle(), near = (u) => Math.max(Math.abs(u.x - cx), Math.abs(u.y - cy)) <= 2;
    dview.setPlace({ ...where, siege: near(a) || near(d) ? { color: G.factionColor(field.faction('def')) ?? '#5a5a66', look: look({ side: 'def' }) } : null });
    const back = mode; setMode(tview); audio.playBgm('bgm-skirmish');
    // The cut-in's bars stay up while the field just laid compiles its shaders (prewarm).
    const shown = async () => { await prewarm(tview); cine.hidden = true; };
    await runTactical({ battle, hs, looks, troopLooks, view: tview, duel: duelStage(), audio, face, name, D, banner, message, profiles: (list) => battleProfiles(list, { [a.id]: field.faction(a.side), [d.id]: field.faction(d.side) }), warm: shown });
    res.settle();
    cine.hidden = false; cine.className = 'enter'; cineFlash();
    restore(); setMode(back); await sleep(300); cine.hidden = true; document.body.classList.remove('cine'); audio.playBgm('bgm-battle');
  } finally { restore(); }
}
// 单挑 cut: letterbox, white flash and the 单挑 mark, then the duel scene; the reverse on exit.
function duelStage() {
  const cine = $('#cine');
  return {
    view: dview,
    async enter(battle, looks) {
      cine.innerHTML = `<div class="bar top"></div><div class="bar bot"></div><div class="vsmark">单挑</div><div class="speed"></div><div class="flash"></div>`;
      cine.className = ''; cine.hidden = false; void cine.offsetWidth;
      cine.classList.add('enter'); cineFlash(); // the original only changes to the duel theme (bank31 $E35C), no clash
      await sleep(220); setMode(dview);
      await dview.enter(battle, looks, () => prewarm(dview));
    },
    async exit() {
      cineFlash(); await sleep(220); dview.abort(); setMode(tview);
      cine.classList.remove('enter'); await sleep(350); cine.hidden = true;
    },
  };
}
function cineFlash() { const f = $('#cine .flash'); if (!f) return; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

// What the player sees of each rules event. AI events are timed to the original's windows (src/pace.js).
let aiShown = 0; // ms the current AI turn spent showing its events (io.aiTurn holds only the rest)
async function showEvent(e) {
  const P = g.player;
  switch (e.type) {
    case 'income': {
      const mine = e.list.filter(([cid]) => mineCity(cid)), total = mine.reduce((a, [, v]) => a + v, 0);
      addLog(`${e.kind === 'gold' ? '四月税金' : '十月收米'}：我军共得${e.kind === 'gold' ? '金' : '米'} <strong>${total}</strong>`);
      // The month's event stops the music for its own cue and card, as the original's 税金/收米 events do.
      if (!mine.length) break;
      const what = e.kind === 'gold' ? '金' : '米';
      const cue = () => { if (!audio.cue('cue-income')) audio.sfx('sfx-income'); };
      if (!(await playVignette({ scene: e.kind === 'gold' ? 'tax' : 'harvest', caption: `${e.kind === 'gold' ? '四月　征收税金' : '十月　收获米粮'}……`, audio, onShow: cue }))) cue();
      await message(e.kind === 'gold' ? '四月　征收税金' : '十月　收获米粮',
        `${mine.map(([cid, v]) => `${cityName(cid)} ${what}+${v}`).join('　')}<br>我军共得${what} <strong>${total}</strong>`);
      break;
    }
    case 'riot': for (const [cid] of e.list) addLog(`${cityName(cid)}发生暴乱${mineCity(cid) ? '！' : ''}`); if (e.list.some(([cid]) => mineCity(cid))) { audio.cue('cue-disaster'); const hit = e.list.filter(([cid]) => mineCity(cid)); await message('暴乱', `${hit.map(([cid]) => cityName(cid)).join('、')}发生暴乱，城市受损。统治度低于50的城市容易发生暴乱。`, g.cities[hit[0][0]].officers[0] ?? null, 'grief'); } break; // the governor, 忧 (bank 25 $AC77)
    case 'disaster': {
      const mine = e.list.filter(([cid]) => mineCity(cid)), what = e.kind === 'drought' ? '旱灾' : '洪水';
      addLog(`${what}：${e.list.map(([cid]) => cityName(cid)).join('、') || '无'}`);
      if (!e.list.length) break;
      // The struck cities are framed on the map and flash under 旱灾 / 洪水 while the land itself is shown (its
      // picture, src/vignette.js), then the window tells who was hit (playtest of 2026-10-31, F09). Presentation
      // only: the rules core decided all of it. The original shows every 旱灾 / 洪水 for 286 frames, whoever it
      // strikes: someone else's closes by itself within them, the player's own waits for a key.
      const cids = e.list.map(([cid]) => cid), shot = mine.length ? mine.map(([cid]) => cid) : cids;
      if (shot.length > 1) strategy.frame(shot); else strategy.focusCity(shot[0]);
      const tint = e.kind === 'drought' ? '#ffb040' : '#5aa8ff', pic = paced(ORIGINAL.disaster * (mine.length ? 0.6 : 1));
      for (const cid of cids) strategy.announce(cid, what, tint, pic + (mine.length ? paced(ORIGINAL.disaster) : 400)); // and on under the player's own window
      const names = (list) => list.map(([cid]) => cityName(cid)).join('、');
      const shown = await playVignette({ scene: e.kind, caption: `${names(mine.length ? mine : e.list)}遭受${what}……`, audio, duration: pic, onShow: () => audio.cue('cue-disaster') });
      if (!shown) audio.cue('cue-disaster');
      // The struck city's governor tells it: 忧 for the damage, 喜 for 「不过请放心」 where 防灾 held (bank 25 $A850 / $A88D).
      const gov = (list) => g.cities[list[0][0]].officers[0] ?? null;
      const hurt = mine.filter(([, k]) => k !== 10), safe = mine.filter(([, k]) => k === 10);
      if (hurt.length) await message(what, `大事不好，${names(hurt)}遭受${what}。`, gov(hurt), 'grief');
      if (safe.length) await message(what, `${names(safe)}遭受${what}，不过请放心，防灾完备，没有受到损害。`, gov(safe), 'joy');
      if (!mine.length && !shown) await message(what, `${e.list.map(([cid]) => `<span style="color:${colorOf(g.cities[cid].faction)}">${cityName(cid)}</span>`).join('、')}遭受${what}。`, null, 'calm', { auto: pic });
      break;
    }
    case 'join': addLog(`${name(e.id)}加入${factionName(e.faction)}军`); if (e.faction === P) await message('来投', e.lord != null ? `${name(e.id)}追随旧主${name(e.lord)}前来投奔，加入我军。` : `${name(e.id)}前来投奔，加入我军。`, e.id, 'joy'); break;
    case 'death': for (const id of e.list) { addLog(`<em>${name(id)}病逝</em>`); if (e.faction === P) await message('病逝', `${name(id)}因病去世了。`, id, 'grief'); } break;
    // Another faction's succession and fall close by themselves after the original's 240 frames.
    case 'heir': addLog(`${name(e.old)}${e.captured ? '被俘' : '去世'}，${name(e.heir)}继位`); await message('继位', `君主${name(e.old)}${e.captured ? '被俘' : '去世'}，${name(e.heir)}继承了大业。${e.quit.length ? `<br>${e.quit.map(name).join('、')}因不服而离去。` : ''}`, e.heir, 'calm', { auto: e.faction === P ? 0 : paced(ORIGINAL.notice) }); break;
    case 'fall': addLog(`<em>${factionName(e.faction)}势力灭亡</em>`); if (e.faction !== P) await message('灭亡', `<span style="color:${colorOf(e.faction)}">${factionName(e.faction)}</span>一族灭亡了。`, null, 'calm', { auto: paced(ORIGINAL.notice) }); break;
    case 'autobattle': {
      const { war: w, res } = e, winner = res.attWins ? w.attacker : w.defender;
      addLog(`${factionName(w.attacker)}进攻${cityName(w.city)}（${factionName(w.defender)}）：${res.attWins ? '<strong>攻陷</strong>' : '败退'}`);
      // The original plays every war between two AI factions on the map in three beats of 142 frames under its
      // phrase 162 (7.09 s in all), its AI-turn window reading 「××軍 出陣」, 「××軍 戦闘中」 and the winner's
      // 「××軍 勝利」 (research/strategic-ai-evidence.md). The board does the same with the two standards: down the
      // road, before the walls, and the loser's falling while the city flashes under 攻陷 / 守住 (F11).
      const cap = h('div', { class: 'panel aiturn aiwar', title: '按 Enter／空格跳过' });
      const say = (f, word) => cap.replaceChildren(h('i', { style: { background: colorOf(f) } }), avatar(g.factions[f].ruler), h('span', {}, `${factionName(f)}军`), h('b', {}, word));
      document.body.append(cap); requestAnimationFrame(() => cap.classList.add('in'));
      const show = strategy.aiWar({ from: w.from, to: w.city, att: w.attacker, def: w.defender, attName: factionName(w.attacker), defName: factionName(w.defender) }), beat = ORIGINAL.aiWar / 3;
      audio.cue('cue-aiwar');
      try {
        say(w.attacker, '出阵'); show.march(paced(beat));
        if (!(await hold(beat, { el: cap }))) break;
        say(w.attacker, '战斗中'); show.clash(paced(beat));
        if (!(await hold(beat, { el: cap }))) break;
        say(winner, '胜利'); show.end(res.attWins, paced(beat));
        strategy.refresh(g);
        strategy.announce(w.city, res.attWins ? `${factionName(w.attacker)}军攻陷` : `${factionName(w.defender)}军守住`, colorOf(winner), paced(beat));
        await hold(beat, { el: cap });
      } finally { show.dispose(); cap.remove(); strategy.refresh(g); }
      break;
    }
    case 'phantom': {
      // 阿会喃 bug (原版漏洞 mode, core/ahuinan.js): the march on 王莆 resolves off the map. The original shows the AI
      // turn's own window and nothing else; the log says what happened, and the player hears of it when 王莆 was
      // theirs or copies came to their side of the board.
      const where = (p) => (p.city == null ? '在野' : cityName(p.city));
      const out = e.placed.length ? `，${e.placed.length}名阿会喃流落${[...new Set(e.placed.map(where))].join('、')}` : '';
      addLog(`${factionName(e.attacker)}军进攻<em>王莆</em>（${factionName(e.defender)}）：阿会喃${e.att}对${e.def}，${e.attWins ? '攻陷' : '败退'}${out}`);
      const mine = e.placed.filter((p) => p.city != null && g.cities[p.city].faction === P);
      if (e.defender === P || mine.length) {
        strategy.refresh(g);
        await message('王莆', `${factionName(e.attacker)}军向地图上没有的「王莆」出阵，战场上只有阿会喃。${e.defender === P ? (e.attWins ? '王莆失守。' : '王莆守住了。') : ''}${mine.length ? `<br>${mine.length}名阿会喃来到${[...new Set(mine.map(where))].join('、')}，加入我军。` : ''}`, 0, 'calm');
      }
      break;
    }
    case 'aiIncite': addLog(`${factionName(e.faction)}离间我军${name(e.id)}`); await message('离间', `${factionName(e.faction)}的${name(e.actor)}散布流言，${name(e.id)}的忠诚下降了 ${e.loss}。`, e.reporter, 'grief'); break;
    case 'aiLure': addLog(`${name(e.id)}被${factionName(e.faction)}诱纳`); if (e.from === P) await message('诱纳', `我军的${name(e.id)}被${factionName(e.faction)}诱纳，投奔${cityName(e.city)}而去。`, e.reporter, 'grief'); break;
    case 'aiAlliance': addLog(`${factionName(e.faction)}与${factionName(e.target)}结盟`); break;
    case 'talent': case 'gameover': case 'unify': break;
  }
}


// ---------- io bridge for the rules core ----------
const mineCity = (cid) => g.cities[cid]?.faction === g.player;
const io = {
  async event(e) {
    // the 战略中 plaque steps aside while an event has the screen (it sits where the message box opens)
    const t0 = performance.now(), plaque = $('.aiturn'); plaque?.classList.add('aside');
    try { await showEvent(e); } finally { aiShown += performance.now() - t0; plaque?.classList.remove('aside'); }
    if (document.body.dataset.screen === 'strategy') { strategy.refresh(g); hud(); }
  },
  async aiTurn(f) {
    // The original shows the whole map and 「××军　战略中」 for 90 frames; the faction's own domestic orders
    // and moves are not shown. Its events (an AI war, a disaster) play in their own frames on top of those
    // 90, so the plaque holds 1.5 s of its own: the time spent showing events does not count against it.
    hud();
    const plaque = h('div', { class: 'panel aiturn', title: '按 Enter／空格跳过' }, h('i', { style: { background: colorOf(f) } }), avatar(g.factions[f].ruler), h('span', {}, `${factionName(f)}军`), h('b', {}, '战略中'));
    document.body.append(plaque); requestAnimationFrame(() => plaque.classList.add('in'));
    const t0 = performance.now(); aiShown = 0;
    await aiTurn(g, f, io);
    strategy.refresh(g); hud();
    const left = aiShown === Infinity ? 0 : ORIGINAL.aiTurn - (performance.now() - t0 - aiShown) * paceSpeed();
    if (left > 0 && !g.over) await hold(left, { el: plaque });
    plaque.classList.remove('in'); setTimeout(() => plaque.remove(), 200);
  },
  async war(w, budget) {
    // the war screen takes over; no 战略中 hold after it. Every plaque goes: the last faction's may still be fading out.
    $$('.aiturn').forEach((p) => p.remove()); aiShown = Infinity;
    strategy.refresh(g); strategy.select(w.city); strategy.focusCity(w.city);
    audio.cue('cue-sortie'); // the original plays 出阵's phrase for an AI attack on the player too
    // The struck city's governor brings the news, as the 旱灾 / 洪水 and 暴乱 windows have it (已试玩中@devblog #592:
    // the attacker's commander used to speak, though the player is the one attacked). He holds the city (w.def.ids[0]).
    const gov = w.def.ids[0] ?? null, troops = w.att.ids.reduce((a, id) => a + (g.officers[id].soldiers || 0), 0);
    await message('敌军来袭', `大事不好！${factionName(w.attacker)}军${w.att.ids.length}将由${name(w.att.ids[0])}统率，合计兵力 ${troops}，自${cityName(w.from)}来攻${cityName(w.city)}！${gov != null ? `<br>${name(gov)}率军守城。` : ''}`, gov, 'grief');
    await fieldWar(w, 'def', { after: { kind: 'def', faction: budget?.faction ?? w.attacker, pts: budget?.pts ?? 0 } });
  },
  async allianceOffer(f, kind, amount) {
    const yes = await confirmBox('同盟使者', `${factionName(f)}遣使来访，愿以${kind === 'gold' ? '金' : '米'} ${amount}为礼，结为同盟（10个月）。是否接受？`);
    if (yes) await message('同盟', `与${factionName(f)}结成了同盟。`, g.factions[g.player].ruler, 'joy'); // 喜 (bank 28 $D2BA)
    return yes;
  },
  async afterWar() { await G.checkFactions(g, io); strategy.refresh(g); },
  async chooseHeir(f, cands, why) {
    if (why === 'captured') await message('君主被俘', '君主被敌军俘获了。请从部下中选出继承者。');
    else await message('君主驾崩', '君主去世了。请从部下中选出继承者。');
    let id = null;
    while (id == null) id = (await pickOfficers(g, '选择继承者', cands))?.[0];
    return id;
  },
  playerTurn() {
    return new Promise(async (res) => {
      // The view as the player left it goes with the turn: the AI turns' events take it to their cities and zoom out.
      endPlayer = () => { playerPose = strategy.pose(); res(); };
      tabOpen = false; cmdFocus = null; // a new month starts with the command list closed
      // Back over the city the player was working in (else the ruler's) at their own zoom and turn of the map, under the
      // turn banner: the AI turn had left the view on its last event (晚风和远方丶@bilibili, 2026-11-08). C still resets it all.
      sel = sel != null && mineCity(sel) ? sel : g.factions[g.player].city; strategy.select(sel); strategy.returnTo(sel, playerPose);
      document.body.dataset.screen = 'strategy'; hud();
      // No sound of its own: the original changes months with no sound call (D43; the war-start phrase used to play here).
      await banner(`${g.year}年${g.month + 1}月·${MONTH_NAMES[g.month]}　${name(g.factions[g.player].ruler)}的回合`, colorOf(g.player));
    });
  },
};
// Not while a command is still running (a city being picked on the map, its dialogs): the AI turn would
// start under it and the command would then finish in someone else's turn.
const commandOpen = () => busy || !!mapPick || blocking();
// A slow 战略地图 or war map offers a lighter picture preset once (src/quality.js), only while nothing is open on it
// (on the war map: the player's own turn, no dialog, nothing animating).
// The war branch must not read `busy`: runCommand holds it through a war the player starts (attack), and only the war's own busy flag says it is animating.
const qualityIdle = () => !!g && ((mode === strategy && document.body.dataset.screen === 'strategy' && !commandOpen()) || (!!war && mode === war && !!war.myTurn && !war.st.busy && !mapPick && !blocking()));
quality.watch(qualityIdle);
async function endTurn() {
  if (commandOpen() || g.current !== g.player) return;
  if (!(await confirmBox('结束本月行动', `还剩 ${g.books} 张命令书，确定结束本月行动吗？`))) return;
  if (busy || mapPick || g.current !== g.player) return;
  g.endTurn = true; const f = endPlayer; endPlayer = null; f?.();
}

async function ending() {
  const o = g?.over;
  if (!o) return title();
  const P = g.player;
  let stage;
  if (o.type === 'unify') {
    const ruler = g.factions[P].ruler;
    audio.playBgm('bgm-ending');
    // The realm whole on the map, in the player's colour, before the 军师 speaks (喜, bank 26 $85D4).
    // The HUD goes and any banner still up with it: the map alone, all one colour.
    strategy.refresh(g); strategy.resetView(); strategy.select?.(null); clear(); document.querySelectorAll('body > .banner').forEach((b) => b.remove());
    await banner('天下统一', colorOf(P), 1600);
    await message('天下统一', `${name(ruler)}大人，恭喜您统一全国！`, G.evaluator(g), 'joy');
    await fade(true);
    const officers = [...new Set(g.cities.flatMap((c) => c.officers))].filter((id) => id !== ruler);
    const list = await fetch('data/thanks.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
    stage = await playUnification({ g, D, ruler, score: o.score, parts: G.unificationParts(g), officers, list: list.split('\n').map((l) => l.trim()).filter(Boolean), onReady: () => fade(false) });
  } else if (o.type === 'gameover') {
    audio.playBgm('bgm-gameover'); await fade(true);
    stage = await playFall([`${g.year}年${g.month + 1}月`, `${factionName(P)}军的旗帜，从这片大陆上消失了。`], '霸业成空', () => fade(false));
  } else if (o.type === 'talent') {
    audio.playBgm('bgm-gameover'); await fade(true);
    stage = await playFall(['天下武将不足三十人，乱世就此落幕。'], '人才凋零', () => fade(false));
  }
  if (stage) { await fade(true); stage.close(); title(); await fade(false); } else title();
}

// Debug: open a 白兵 directly (no war map) — window.__game.debug.quickTactical(38, 51, 2)
// month / city: the season and place to stage it in (default: the current month at 洛阳); siege: the castle
// holder's { color, look } to fight the 单挑 before the city gate (default: on 城 terrain); human: the side the
// player commands ('d' to defend; the player's side wears the blue 'attacker' look, as from the war map); troopLooks: each side's
// pack troop looks ({ a: { soldier: 'ashigaru' }, d: … }; default: the general's own over those of the faction holding his city).
async function quickTactical(aId = 38, dId = 51, terrain = 2, { month = g?.month ?? 2, city = 12, siege = terrain === 5 ? { color: '#5a5a66', look: 'defender' } : null, human = 'a', troopLooks = null } = {}) {
  const { Tactical } = await import('./core/tactical.js');
  g ||= G.newGame(4, 1, 3);
  const battle = new Tactical(g, aId, dId, terrain, G.rng(g), { human });
  await loadOfficerSprites([aId, dId]);
  strategy.setSeason(month, true); tview.setPlace({ month, city }); dview.setPlace({ month, city, siege });
  await tview.ready();
  // a 白兵 is fought from the war screen; on the title screen the unit labels would stay hidden
  document.body.dataset.screen = 'war';
  setMode(tview); document.body.classList.add('cine'); clear(); audio.playBgm('bgm-skirmish');
  const looks = human === 'a' ? { a: 'attacker', d: 'defender' } : { a: 'defender', d: 'attacker' };
  const held = (id) => G.officerTroops(id, g.cities.find((c) => c.officers.includes(id))?.faction);
  troopLooks ??= { a: held(aId), d: held(dId) };
  await loadTroopLooks(looks, troopLooks);
  const res = await runTactical({ battle, hs: human, looks, troopLooks, view: tview, duel: duelStage(), audio, face, name, D, banner, message, profiles: battleProfiles, warm: () => prewarm(tview) });
  document.body.classList.remove('cine'); return res;
}
window.__game = { qualityIdle, get g() { return g; }, get mode() { return document.body.dataset.screen; }, io, G, audio, strategy, tview, get war() { return war; }, get warNav() { return warNav; }, get warRoster() { return warRoster; }, pad: { get state() { return { zone: (z => z instanceof Element ? z.className || z.tagName : z)(padZone()), cur: { ...cur, hit: undefined }, input: document.body.dataset.input, family: pad.family, confirm: pad.confirm }; } }, debug: { renderer, quality, hud: () => hud(), addLog: (x) => addLog(x), cycleDock: (d) => commandDock.cycle?.(d), holdCommand: (on) => { busy = !!on; }, setupWar, fieldWar, cutIn, quickTactical, settleMenu, duelView: dview, post, show: (k) => setMode({ strategy, tview, dview }[k]) } };
// A fresh start shows the boot splash first (not a record loading, nor back from 记录编辑); the title, and its music, start
// when it is over. Pages driven by Playwright (navigator.webdriver: the tests and capture tools, which go straight to their
// scene through the debug hooks) start at the title unless they ask for the splash with window.__splash = true.
{
  const pending = await pendingLoad();
  if (pending) begin(pending.state, true, null, pending);
  else {
    if (!titleSeen && (window.__splash ?? !navigator.webdriver)) { document.body.dataset.screen = 'boot'; await bootSplash({ audio }).done; }
    title();
  }
}
