// Battlefield general roster (战场点将栏, 远逝的夏日@devblog, 2026-11-23):
// Lists our alive generals on the left edge (under ☰ 系统 on desktop, or as a compact pull-down drawer under the top bar
// on a phone) so crowded units can be picked and located directly in both 3D and 2D flat battles. Yields the left column
// automatically whenever the action panel (.actpanel: 计略 / 攻击) is open.
// On the desktop 2D flat map the board is never shrunk for the roster: when horizontal margin is enough to clear it,
// the board shifts right and the roster starts open; otherwise the flat map starts collapsed (N or click to toggle).
import { CASTLE, ATTACK_COST } from './core/field.js';
import { name, maxHp as maxHpOf } from './core/game.js';
import { readFlag, writeFlag, PREF } from './prefs.js';
import { PHONE } from './phone.js';
import { FLAT_INSET } from './warmap2d.js';

const ROSTER_W = 168; // desktop panel width (px); left 12 + 168 + 8 gap = 188 px leftClear on 2D
const ROSTER_CLEAR = 12 + ROSTER_W + 8;
const TROOPS_FULL = 1000;
const VILLAGE_MARK = { 病院: ['医', '病院'], 武器店: ['武', '武器店'], 米店: ['米', '米店'] };
const ACT_STAGES = new Set(['strats', 'targets', 'confirm', 'attacks', 'strike']);

export function createWarRoster(war, host, { blocking = () => false } = {}) {
  const field = war.field, human = field.human;
  if (!human) return null;

  const box = document.createElement('div');
  box.className = 'panel warroster';
  box.setAttribute('aria-label', '我军武将');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'wr-head';
  head.title = PHONE ? '展开或收起我军武将名单' : '收起或展开我军武将名单（N）';
  const title = document.createElement('span');
  title.className = 'wr-title';
  const caret = document.createElement('span');
  caret.className = 'wr-caret';
  caret.setAttribute('aria-hidden', 'true');
  head.append(title, caret);

  const list = document.createElement('div');
  list.className = 'wr-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '我军武将名单');

  box.append(head, list);
  host.append(box);

  const flatFits = () => !war.flat || !!war.canFitLeft?.(ROSTER_CLEAR);
  let open = PHONE ? false : (flatFits() ? readFlag(PREF.warRoster, true) : false);
  let userToggled = false;
  let hovering = null;
  let lastKey = '';
  let lastSel = null;
  let tick = 0;

  const clearHover = () => {
    if (!hovering) return;
    hovering = null;
    if (war.st && !war.st.busy && !document.querySelector('.actpanel')) war.hoverCell?.(null);
  };

  // Phone: tapping outside an open drawer closes it and swallows that tap (pointerdown + matching pointerup + click),
  // so dismissing the drawer never selects a cell or triggers a move on the map underneath.
  let swallowId = null, swallowTimer = null;
  const clearSwallow = () => {
    if (swallowTimer) { clearTimeout(swallowTimer); swallowTimer = null; }
    if (swallowId == null) return;
    swallowId = null;
    removeEventListener('pointerup', swallow, true);
    removeEventListener('pointercancel', swallow, true);
    removeEventListener('click', swallow, true);
  };
  const swallow = (e) => {
    if (e.type !== 'click' && e.pointerId !== swallowId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' || e.type === 'pointercancel') clearSwallow();
  };
  const outside = (e) => {
    if (!PHONE || !open || box.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setOpen(false);
    clearSwallow();
    swallowId = e.pointerId;
    addEventListener('pointerup', swallow, true);
    addEventListener('pointercancel', swallow, true);
    addEventListener('click', swallow, true);
    swallowTimer = setTimeout(clearSwallow, 600);
  };

  const syncToastVar = () => {
    if (!PHONE) return;
    const w = box.hidden ? 0 : Math.ceil(box.getBoundingClientRect().width);
    document.documentElement.style.setProperty('--roster-w', `${w}px`);
  };

  const syncMore = () => {
    const more = !PHONE && open && !box.hidden && list.scrollHeight - list.scrollTop - list.clientHeight > 2;
    list.classList.toggle('more', more);
  };

  const applyClear = () => {
    // Keep 2D leftClear tied only to desktop expanded state (never temporary .actpanel hiding), so opening 计略 never shifts the board.
    if (war.flat) war.setLeftClear?.(!PHONE && open ? ROSTER_CLEAR : 0);
  };

  const syncOpenUi = () => {
    box.classList.toggle('shut', !open);
    head.setAttribute('aria-expanded', String(open));
    caret.textContent = open ? '▾' : '▸';
    if (!open) { clearHover(); list.style.maxHeight = ''; list.classList.remove('more'); }
    applyClear();
    syncToastVar();
  };

  function setOpen(on, { persist = true, manual = false } = {}) {
    on = !!on;
    if (manual) userToggled = true;
    if (on === open) return;
    open = on;
    // Only persist the desktop preference when the current mode has dedicated room (3D, or 2D with enough margin),
    // so opening the floating roster once on a narrow 2D screen doesn't force future narrow 2D battles open.
    if (!PHONE && persist && flatFits()) writeFlag(PREF.warRoster, open);
    if (PHONE) {
      if (open) addEventListener('pointerdown', outside, true);
      else removeEventListener('pointerdown', outside, true);
    }
    syncOpenUi();
    place();
  }

  head.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!open, { manual: true });
    if (e.detail > 0) head.blur();
  });

  list.addEventListener('pointerleave', () => clearHover());
  list.addEventListener('scroll', () => syncMore(), { passive: true });

  const unitsOf = () => field.alive.filter((u) => u.side === human).sort((a, b) => Number(!!b.commander) - Number(!!a.commander));

  const badgesOf = (u, canAct) => {
    const out = [];
    if (u.qimen) out.push(['奇', 'qimen', field.kongmingOn() ? `奇门遁甲（余${u.qimen}日）` : `奇门遁甲（余${u.qimen}日，诸葛亮不在场）`]);
    else if (u.stop) out.push(['困', 'hold', `${u.stopBy ?? '受困'}（余${u.stop}日）`]);
    if (field.ambush?.[u.side]?.u === u) out.push(['伏', 'ambush', '伏兵中']);
    const vk = field.village(u)?.kind;
    if (vk && VILLAGE_MARK[vk]) out.push([VILLAGE_MARK[vk][0], 'place', `所在：${VILLAGE_MARK[vk][1]}`]);
    else if (field.terr(u.x, u.y) === CASTLE) out.push(['城', 'place', '驻守城池']);
    if (canAct && field.pool[human] >= ATTACK_COST && field.adjacentEnemies(u).length > 0) out.push(['攻', 'atk', '相邻有敌将可攻击']);
    return out;
  };

  function pickUnit(u, e) {
    e.stopPropagation();
    if (blocking() || war.st.busy || field.over) return;
    clearHover();
    const st = war.st, mineTurn = field.turn === human || st.deploying;
    if (!mineTurn) {
      war.centreOn?.(u.x, u.y);
      if (PHONE) setOpen(false);
      if (e.detail > 0) e.currentTarget.blur();
      return;
    }
    if (st.sel === u) {
      war.centreOn?.(u.x, u.y);
    } else {
      Promise.resolve(war.clickCell(u.x, u.y, e)).finally(() => war.keepInView?.(u));
    }
    if (PHONE) setOpen(false);
    if (e.detail > 0) e.currentTarget.blur();
  }

  function render(mine, canAct, waiting) {
    title.innerHTML = `我军 <b>${mine.length}</b>`;
    box.classList.toggle('waiting', waiting);
    const sel = war.st.sel;
    const prevScroll = list.scrollTop;
    const frag = document.createDocumentFragment();
    for (const u of mine) {
      const o = field.O(u.id), mhp = maxHpOf(o, u.id);
      const isSel = sel === u;
      const low = o.soldiers <= 200 || o.hp <= mhp * 0.35;
      const trapped = !!(u.qimen || u.stop);
      const badges = badgesOf(u, canAct);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wr-row${isSel ? ' sel' : ''}${low ? ' low' : ''}${trapped ? ' trapped' : ''}`;
      btn.dataset.unit = String(u.id);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(isSel));
      btn.title = `${u.commander ? '总大将 ' : ''}${name(u.id)}　兵 ${o.soldiers}　体 ${o.hp}/${mhp}${badges.length ? `　${badges.map((b) => b[2]).join('、')}` : ''}${isSel ? '\n再点一次居中定位' : ''}`;

      const top = document.createElement('span');
      top.className = 'wr-top';
      const nm = document.createElement('span');
      nm.className = 'wr-name';
      nm.textContent = `${u.commander ? '★' : ''}${name(u.id)}`;
      top.append(nm);

      if (badges.length) {
        const tags = document.createElement('span');
        tags.className = 'wr-tags';
        for (const [glyph, cls, tip] of badges) {
          const em = document.createElement('em');
          em.className = `wr-tag ${cls}`;
          em.textContent = glyph;
          em.title = tip;
          tags.append(em);
        }
        top.append(tags);
      }

      const num = document.createElement('span');
      num.className = 'wr-num';
      num.textContent = String(o.soldiers);
      top.append(num);

      const bars = document.createElement('span');
      bars.className = 'wr-bars';
      const tr = document.createElement('i');
      tr.className = 'wr-tr';
      tr.style.setProperty('--w', `${Math.max(0, Math.min(100, (o.soldiers / TROOPS_FULL) * 100)).toFixed(1)}%`);
      const hp = document.createElement('i');
      hp.className = 'wr-hp';
      hp.style.setProperty('--w', `${Math.max(0, Math.min(100, (o.hp / mhp) * 100)).toFixed(1)}%`);
      bars.append(tr, hp);

      btn.append(top, bars);
      btn.addEventListener('click', (e) => pickUnit(u, e));
      if (!PHONE) {
        btn.addEventListener('pointerenter', (e) => {
          if (e.pointerType !== 'mouse' || blocking() || war.st.busy || field.over || box.hidden) return;
          hovering = u;
          war.hoverCell?.({ x: u.x, y: u.y }, false);
        });
      }
      frag.append(btn);
    }
    list.replaceChildren(frag);
    list.scrollTop = prevScroll;
    if (sel && sel !== lastSel && open) {
      list.querySelector(`[data-unit="${sel.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    lastSel = sel;
    syncToastVar();
  }

  function snapListHeight() {
    list.style.maxHeight = '';
    if (PHONE || !open || box.hidden) return;
    if (list.scrollHeight <= list.clientHeight + 1) { syncMore(); return; }
    const rows = list.querySelectorAll('.wr-row');
    if (!rows.length) { syncMore(); return; }
    const r0 = rows[0].getBoundingClientRect();
    const gap = rows.length > 1 ? Math.max(0, rows[1].getBoundingClientRect().top - r0.bottom) : 3;
    const cs = getComputedStyle(list);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const step = r0.height + gap;
    if (step > 0) {
      // Snap to an integer number of rows so a short window (e.g. 1024×600) never slices the bottom row in half.
      const n = Math.max(1, Math.floor((list.clientHeight - padY + gap) / step));
      list.style.maxHeight = `${Math.floor(n * r0.height + Math.max(0, n - 1) * gap + padY)}px`;
    }
    syncMore();
  }

  function place() {
    if (PHONE) {
      box.classList.remove('inline-top');
      box.style.left = '';
      box.style.top = '';
      box.style.maxHeight = '';
      list.style.maxHeight = '';
      syncToastVar();
      return;
    }
    // 2D desktop: when the player has not manually toggled in this battle, expand automatically only if horizontal
    // margin can clear the roster without shrinking the board; otherwise stay collapsed.
    if (war.flat && !userToggled) {
      const want = flatFits() ? readFlag(PREF.warRoster, true) : false;
      if (want !== open) { open = want; syncOpenUi(); }
    }
    const sysBtn = document.querySelector('.sysmenu-btn');
    const sysR = sysBtn?.offsetParent ? sysBtn.getBoundingClientRect() : null;
    const bar = document.querySelector('.warbar');
    const barR = bar?.offsetParent ? bar.getBoundingClientRect() : null;

    // 2D desktop collapsed pill: sit right beside ☰ 系统 in the top HUD strip whenever there is clear room before .warbar,
    // so it doesn't touch even the top-left corner cell of the board.
    if (war.flat && !open && sysR && barR && barR.left - (sysR.right + 8) >= 88) {
      box.classList.add('inline-top');
      box.style.left = `${Math.round(sysR.right + 8)}px`;
      box.style.top = `${Math.round(sysR.top)}px`;
      box.style.maxHeight = '';
      list.style.maxHeight = '';
      applyClear();
      return;
    }
    box.classList.remove('inline-top');
    box.style.left = '';

    const sysBottom = sysR ? sysR.bottom : (war.flat ? 38 : 96);
    const barBottom = barR && barR.left < ROSTER_CLEAR ? barR.bottom : 0;
    const top = Math.max(war.flat ? FLAT_INSET.top : 0, Math.round(Math.max(sysBottom, barBottom) + 8));
    let bottomLimit;
    if (war.flat) {
      bottomLimit = innerHeight - FLAT_INSET.bottom - 8;
    } else {
      const cards = [...document.querySelectorAll('.unitpanel')].filter((e) => e.offsetParent && (innerWidth <= 1200 || !e.classList.contains('compare')));
      bottomLimit = cards.length ? Math.min(...cards.map((e) => e.getBoundingClientRect().top)) - 10 : innerHeight - 12;
    }
    box.style.top = `${top}px`;
    box.style.maxHeight = `${Math.max(108, Math.round(bottomLimit - top))}px`;
    applyClear();
    snapListHeight();
  }

  const onResize = () => place();
  addEventListener('resize', onResize);
  syncOpenUi();
  place();

  function update() {
    const st = war.st;
    const hide = ACT_STAGES.has(st.stage) || !!document.querySelector('.actpanel');
    if (box.hidden !== hide) {
      box.hidden = hide;
      if (hide) clearHover();
      else place();
      syncToastVar();
    }
    const mine = unitsOf();
    const canAct = field.turn === human && !st.deploying && !st.busy && !field.over;
    const waiting = !st.deploying && (field.turn !== human || st.busy);
    const key = [
      field.day, field.turn, field.pool[human], st.sel?.id ?? '', st.deploying ? 1 : 0, waiting ? 1 : 0,
      ...mine.map((u) => {
        const o = field.O(u.id);
        return `${u.id}:${u.commander ? 1 : 0}:${u.x},${u.y}:${o.soldiers}:${o.hp}:${u.qimen || 0}:${u.stop || 0}:${field.ambush?.[u.side]?.u === u ? 1 : 0}:${field.village(u)?.kind || ''}:${field.terr(u.x, u.y)}:${canAct && field.pool[human] >= ATTACK_COST && field.adjacentEnemies(u).length > 0 ? 1 : 0}`;
      }),
    ].join('|');
    if (key !== lastKey) {
      lastKey = key;
      render(mine, canAct, waiting);
      if (!hide) place();
    } else if (!hide && tick % 15 === 0) {
      place();
    }
    tick++;
  }

  update();

  return {
    update,
    toggle: () => setOpen(!open, { manual: true }),
    setOpen,
    close: () => { if (!open) return false; setOpen(false, { persist: false }); return true; },
    get open() { return open; },
    probe: () => {
      const r = box.getBoundingClientRect();
      return {
        open,
        visible: !box.hidden && r.width > 0 && r.height > 0,
        ids: [...list.querySelectorAll('.wr-row')].map((el) => Number(el.dataset.unit)),
        selectedId: war.st.sel?.id ?? null,
        rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
      };
    },
    dispose() {
      clearHover();
      clearSwallow();
      removeEventListener('resize', onResize);
      removeEventListener('pointerdown', outside, true);
      if (PHONE) document.documentElement.style.removeProperty('--roster-w');
      if (war.flat) war.setLeftClear?.(0);
      box.remove();
    },
  };
}
