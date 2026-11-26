// The ending, played full screen once the game has been decided. The 统一度 sets how much of it the player sees, at the
// original's two bounds (research/endings-two-player-evidence.md §3): under 40 the hall alone, from 40 the dawn before it,
// from 70 the dusk and the roll of officers too. The thanks close every unification, whatever the score: they are owed
// to those people, not earned by the player. Paintings: tools/gen_ending_codex.sh → build_ending.py.
// A click or key finishes what is being written, or moves on; nothing here can skip the result by accident, since the
// hall waits for its own click and the input is ignored for a moment after each screen opens.
import { name } from './core/game.js';
import { h, avatar, figure } from './ui.js';
// The 鸣谢 and makers are players' own names: rawText keeps them as written in 繁體 too.
import { rawText } from './lang.js';

const ART = { dusk: 'assets/ai/ending/dusk.webp', dawn: 'assets/ai/ending/dawn.webp', court: 'assets/ai/ending.webp', hall: 'assets/ai/ending/hall.webp', fallen: 'assets/ai/ending/fallen.webp' };
const MAKERS = ['tianlin@GitHub'];
const LEVEL = ['LEVEL 1', 'LEVEL 2', 'LEVEL 3'];
const FEATURED = 12; // officers with a card of their own after the ruler; the rest pass together, so a long roll stays a pleasure
const CARD = { ruler: 5000, officer: 2600 };
const SHOT = { hold: 6500, line: 1500, fade: 1400 };
const GUARD = 350; // a click left over from the last screen must not close the next one

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const CN = '〇一二三四五六七八九';
const cnYears = (n) => (n < 10 ? CN[n] : n < 20 ? `十${n % 10 ? CN[n % 10] : ''}` : `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`);
const preload = (src) => { const i = new Image(); i.src = src; return i.decode().catch(() => {}); };
const signature = (line) => { const at = line.lastIndexOf('@'); return [line.slice(0, at), line.slice(at)]; };

// The full-screen layer: one input source, and the paintings cross-fading on it. wait(ms) ends on the next click or key,
// or after ms when given.
function makeStage() {
  const el = h('div', { class: 'ending', role: 'dialog', 'aria-modal': 'true', 'aria-label': '结局', tabindex: '-1' });
  let wake = null, opened = 0, shot = null;
  const input = () => { if (performance.now() - opened >= GUARD) wake?.(); };
  const onKey = (e) => {
    if (e.key === 'Tab') return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat && ['Enter', ' ', 'Escape'].includes(e.key)) input();
  };
  el.addEventListener('pointerdown', input);
  addEventListener('keydown', onKey, true);
  document.body.append(el); el.focus({ preventScroll: true });
  return {
    el,
    wait(ms) { return new Promise((r) => { const end = () => { clearTimeout(t); wake = null; r(); }; const t = ms == null ? 0 : setTimeout(end, ms); wake = end; }); },
    guard() { opened = performance.now(); },
    // Paints src over whatever is showing; the last one goes once this one has come in.
    async paint(src, cls = '') {
      const next = h('div', { class: `end-shot ${cls}`, style: { backgroundImage: `url(${src})` } }), last = shot;
      if (still()) next.classList.add('still');
      el.insertBefore(next, el.querySelector('.end-layer')); shot = next;
      next.getBoundingClientRect(); next.classList.add('in');
      this.guard();
      setTimeout(() => last?.remove(), SHOT.fade + 100);
    },
    add(node) { node.classList.add('end-layer'); el.append(node); return node; },
    clearLayers() { el.querySelectorAll('.end-layer').forEach((n) => n.remove()); },
    close() { removeEventListener('keydown', onKey, true); el.remove(); },
  };
}

// A painting with its narration, one line after another; the first input shows the rest, the next moves on.
async function scene(stage, src, lines, { hold = SHOT.hold, foot = false } = {}) {
  await stage.paint(src);
  const box = stage.add(h('div', { class: 'end-text' }, lines.map((t) => h('p', {}, t)), foot ? h('span', { class: 'end-more' }, '▼') : null));
  const ps = [...box.querySelectorAll('p')];
  const lineAt = (i) => SHOT.fade * 0.6 + i * SHOT.line;
  ps.forEach((p, i) => { p.style.transitionDelay = `${lineAt(i)}ms`; });
  box.getBoundingClientRect(); box.classList.add('in');
  const written = lineAt(ps.length);
  const t0 = performance.now();
  await stage.wait(written);
  if (performance.now() - t0 < written - 30) { ps.forEach((p) => { p.style.transition = 'none'; }); stage.guard(); }
  await stage.wait(foot ? undefined : hold);
  box.classList.add('out'); await sleep(350); box.remove();
}

// The result: who, when and how well, with the three parts of the 统一度 so that a low one explains itself.
async function hall(stage, g, ruler, score, parts) {
  await stage.paint(ART.hall);
  const row = (k, v, note) => h('div', { class: 'end-part' }, h('span', {}, k), h('b', {}, v), h('small', {}, note));
  const hint = score >= 70 ? null : `统一度达到 ${score >= 40 ? 70 : 40} 分，结局还有更多可看`;
  const card = stage.add(h('div', { class: 'end-result', 'data-score': score },
    h('div', { class: 'end-frame' }, figure(ruler)),
    h('div', { class: 'end-result-body' },
      h('h2', {}, '天下统一'),
      h('p', { class: 'end-when' }, `${g.year}年${g.month + 1}月　${name(ruler)}平定三十州`),
      h('p', { class: 'end-level' }, LEVEL[g.level] ?? ''),
      h('div', { class: 'end-score' }, h('span', {}, '统一度'), h('b', {}, score)),
      h('div', { class: 'end-parts' },
        row('忠诚', parts.loyalty, '诸将平均忠诚'),
        row('人才', parts.talent, `麾下 ${parts.officers} 人`),
        row('治理', parts.gov, '各城平均统治度')),
      hint ? h('p', { class: 'end-hint' }, hint) : null),
    h('span', { class: 'end-more' }, '▼')));
  card.getBoundingClientRect(); card.classList.add('in');
  await sleep(SHOT.fade); stage.guard();
  await stage.wait();
  card.classList.add('out'); await sleep(350); card.remove();
}

// One officer's card over the darkened hall.
function officerCard(g, D, id, isRuler) {
  const o = g.officers[id], w = D.equipment[o.weapon], a = D.equipment[24 + o.armor];
  const stat = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
  return h('div', { class: `end-card ${isRuler ? 'is-ruler' : ''}`, 'data-id': id },
    h('div', { class: 'end-frame' }, figure(id)),
    h('div', { class: 'end-card-body' },
      isRuler ? h('small', {}, '君主') : null,
      h('h3', {}, name(id)),
      h('div', { class: 'end-stats' }, stat('等级', o.level), stat('武力', o.war), stat('智力', o.int), stat('德', o.virtue), isRuler ? null : stat('忠诚', o.loyalty)),
      h('div', { class: 'end-gear' }, h('span', {}, w?.name ?? '—'), h('span', {}, a?.name ?? '—'))));
}

// The ruler, the strongest officers one by one, then everyone else together: each of them is seen.
async function roll(stage, g, D, ruler, others) {
  await stage.paint(ART.hall, 'dim');
  const head = stage.add(h('div', { class: 'end-heading' }, '开国群臣'));
  await stage.wait(1800);
  const rank = (id) => g.officers[id].war + g.officers[id].int;
  const sorted = [...others].sort((a, b) => rank(b) - rank(a));
  const featured = sorted.slice(0, FEATURED), rest = sorted.slice(FEATURED);
  head.classList.add('small');
  for (const id of [ruler, ...featured]) {
    const card = stage.add(officerCard(g, D, id, id === ruler));
    card.getBoundingClientRect(); card.classList.add('in'); stage.guard();
    await stage.wait(id === ruler ? CARD.ruler : CARD.officer);
    card.classList.add('out'); await sleep(280); card.remove();
  }
  if (rest.length) {
    const wall = stage.add(h('div', { class: 'end-wall' }, h('div', { class: 'end-wall-roll' }, rest.map((id) => h('div', { class: 'end-wall-one', 'data-id': id }, avatar(id), h('span', {}, name(id)))))));
    await scroll(stage, wall.firstChild, Math.max(9000, Math.ceil(rest.length / 8) * 2200));
    wall.remove();
  }
  head.remove();
}

// Runs content up the screen, from under the bottom edge until its end has left the top (or, with stopAt, until that
// element sits in the middle). The first input quickens it; it is never cut short.
async function scroll(stage, content, ms, stopAt = null) {
  const view = content.parentElement.clientHeight, height = content.scrollHeight;
  const box = content.getBoundingClientRect(), mark = stopAt?.getBoundingClientRect();
  const to = mark ? mark.top - box.top + mark.height / 2 - view / 2 : height;
  const anim = content.animate([{ transform: `translateY(${view}px)` }, { transform: `translateY(${-to}px)` }], { duration: ms, easing: 'linear', fill: 'forwards' });
  stage.guard();
  stage.wait().then(() => { if (anim.playState === 'running') anim.playbackRate = 5; });
  await anim.finished;
  stage.guard();
}

// The people who told the project what to fix, then its maker, then 完.
async function thanks(stage, list) {
  await stage.paint(ART.hall, 'dim deep');
  const makers = h('div', { class: 'end-makers' }, MAKERS.map((m) => { const [who, where] = signature(m); return h('p', {}, rawText(who), h('small', {}, where)); }));
  const view = stage.add(h('div', { class: 'end-credits' }, h('div', { class: 'end-credits-roll' },
    h('h2', {}, '特别鸣谢'),
    h('p', { class: 'end-credits-lead' }, '感谢为这个免费项目提出宝贵意见的网友'),
    h('div', { class: 'end-names' }, list.map((line) => { const [who, where] = signature(line); return h('p', {}, rawText(who), h('small', {}, where)); })),
    makers)));
  await scroll(stage, view.firstChild, Math.max(26000, Math.ceil(list.length / 3) * 1500), makers);
  const fin = stage.add(h('div', { class: 'end-fin' }, h('b', {}, '完'), h('span', { class: 'end-more' }, '▼ 回到标题')));
  fin.getBoundingClientRect(); fin.classList.add('in');
  await sleep(1400); stage.guard();
  await stage.wait();
}

// Everything after the 军师's congratulation. list: the thanks, one "name@place" a line.
// Resolves to the stage, still up and black-ready: the caller fades over it, then closes it. onReady: the stage is up.
export async function playUnification({ g, D, ruler, score, parts, officers, list, onReady }) {
  const shown = [score >= 40 && ART.dawn, score >= 70 && ART.dusk, ART.hall, score >= 40 && ART.court].filter(Boolean);
  await Promise.all(shown.map(preload));
  const stage = makeStage();
  onReady?.();
  try {
    const years = g.year - 189;
    if (score >= 70) await scene(stage, ART.dusk, [years > 0 ? `${cnYears(years)}年干戈，到今日为止。` : '不足一年的干戈，到今日为止。', '刀枪入库，征人还乡，炊烟又升起来了。']);
    if (score >= 40) {
      await scene(stage, ART.dawn, ['三十州的山河，在晨光里一点点亮起来。', `走到这里的人，是${name(ruler)}。`]);
      await scene(stage, ART.court, ['百官列于阶下，四方的旗帜都到齐了。', '乱世从这一天起，翻过了最后一页。'], { hold: 5000 });
    }
    await hall(stage, g, ruler, score, parts);
    if (score >= 70) await roll(stage, g, D, ruler, officers);
    stage.clearLayers();
    await thanks(stage, list);
  } catch (e) { console.error(e); } // whatever went wrong, the player still gets back to the title
  return stage;
}

// A faction that fell, or a realm with too few officers left: one painting, its words, and back to the title.
export async function playFall(lines, heading, onReady) {
  await preload(ART.fallen);
  const stage = makeStage();
  onReady?.();
  await stage.paint(ART.fallen);
  const box = stage.add(h('div', { class: 'end-fall' }, h('h2', {}, heading), lines.map((t) => h('p', {}, t)), h('span', { class: 'end-more' }, '▼ 回到标题')));
  box.getBoundingClientRect(); box.classList.add('in');
  await sleep(SHOT.fade); stage.guard();
  await stage.wait();
  return stage;
}
