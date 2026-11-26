// The war map's general card: portrait, name, troop and stamina bars, every particular, the gear with its
// bonus, state chips, and a hint line. One builder for both cards of the pair: ours on the left, and the foe's
// on the right (side 'right') while one of ours is selected and the pointer or a confirmation is on him.
import { h } from './ui.js';
import { maxHp as maxHpOf } from './core/game.js';

const TROOPS_FULL = 1000; // 分兵 caps a unit at 1000 (core/game.js), so a full bar is a full unit

const bar = (cls, label, now, max, text) => h('div', { class: `bar ${cls}`, title: label },
  h('span', {}, label), h('div', { class: 'track' }, h('i', { style: { width: `${Math.max(0, Math.min(100, (100 * now) / max))}%` } })), h('b', {}, text));

// u: field unit; o: its officer record; field: the war field; D: game data; village: the kind of village it
// stands in, if any; portrait: the figure element; name/expText: the app's own formatters; equipIcon(id) gives
// the gear's small picture or null (null draws nothing, so there is never a broken <img>).
// extra: lines that go with the card (the 奇门 / 受困 wording, the hint); flash: the gear was just changed.
export function unitCard({ u, o, field, D, mine, village, side = 'left', portrait, name, expText, equipIcon = () => null, hint = null, flash = false, acts = [] }) {
  const w = D.equipment[o.weapon], a = D.equipment[24 + o.armor], maxHp = maxHpOf(o, u.id);
  const gearIcon = (id) => { const src = id == null ? null : equipIcon(id); return src ? h('img', { class: 'eqi', src, alt: '' }) : null; };
  const trapped = u.qimen ? (field.kongmingOn() ? `奇门遁甲：无法移动，每日折兵（余${u.qimen}日）` : '奇门遁甲：无法移动（诸葛亮不在场，不再折兵）') : u.stop ? `${u.stopBy ?? '受困'}：无法移动（余${u.stop}日）` : null;
  const chips = [u.qimen ? `奇门 ${u.qimen}日` : null, u.stop ? `${u.stopBy ?? '受困'} ${u.stop}日` : null, field.ambush?.[u.side]?.u === u ? '伏兵中' : null].filter(Boolean);
  // 兵 and 体 are the bars' own figures above, so the list starts at 武力: four pairs a row fit even a card squeezed beside the other.
  const dl = [['武力', o.war], ['智力', o.int], ['人德', o.virtue], ['忠诚', o.loyalty], ['等级', o.level], ['经验', expText(o)], ['军属性', o.army], ['地形', village ? '村落' : field.ground(u.x, u.y)]];
  const gear = h('div', { class: `gear${flash ? ' flash' : ''}` },
    h('span', {}, gearIcon(w ? o.weapon : null), `武器 ${w ? `${w.name} 攻+${w.atk}` : '—'}`),
    h('span', {}, gearIcon(a ? 24 + o.armor : null), `防具 ${a ? `${a.name} 防+${a.dfn}` : '—'}`));
  if (flash) setTimeout(() => gear.classList.remove('flash'), 600);
  return h('div', { class: `panel unitpanel${side === 'right' ? ' compare' : ''}`, 'data-unit': u.id },
    portrait,
    h('div', { class: 'info' },
      h('div', { class: 'head' }, h('h3', { class: mine ? 'mine' : 'foe' }, `${u.commander ? '★' : ''}${name(u.id)}`),
        h('div', { class: 'bars' }, bar('troops', '兵', o.soldiers, TROOPS_FULL, o.soldiers), bar('hp', '体', o.hp, maxHp, `${o.hp}/${maxHp}`))),
      h('dl', {}, ...dl.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      gear,
      chips.length || trapped ? h('div', { class: 'chips' }, ...chips.map((c) => h('i', { class: 'chip' }, c)), trapped ? h('span', { class: 'hint bad' }, trapped) : null) : null,
      hint ? h('div', { class: 'hint' }, hint) : null),
    acts.length ? h('div', { class: 'acts' }, ...acts) : null);
}
