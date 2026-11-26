// The help's 操作 page: what each key, mouse button and pad button does, by scene, as a picture with callouts instead of
// paragraphs. 键鼠: the painted mouse with its four uses, and the keys as caps beside a few words. 手柄: the painted pad of the
// family in hand's layout (offset sticks: Xbox, Switch Pro; side by side: PlayStation) with that family's glyphs laid on its
// buttons and a line from each callout to its button. The pictures are assets/ai/pad/{offset,sym,mouse}.webp
// (tools/gen_pad_glyphs_codex.sh, tools/slice_pad_glyphs.py --pictures), POS the buttons' places on them.
import { h } from './ui.js';
import { RECORD_ACTIONS, recordAction } from './padrecords.js';
import { cellOf } from './pad.js';

const NS = 'http://www.w3.org/2000/svg';
const lines = () => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ctl-lines'); s.setAttribute('aria-hidden', 'true'); return s; };
const SCENES = ['通用', '战略', '战场', '白兵·单挑'];
// In a browser F5 refreshes the page; the desktop game has no browser toolbar to refresh.
export const quickSaveKey = location.protocol === 'app:' ? 'F5' : 'F2';

// Where each physical control is on each pad picture, as fractions of its width and height.
const POS = {
  offset: { lb: [0.25, 0.126], rb: [0.752, 0.126], lt: [0.261, 0.045], rt: [0.743, 0.045], lstick: [0.224, 0.33], l3: [0.224, 0.33], dpad: [0.328, 0.602],
    rstick: [0.663, 0.602], r3: [0.663, 0.602], north: [0.767, 0.247], west: [0.696, 0.343], east: [0.84, 0.343], south: [0.767, 0.444], view: [0.451, 0.394], start: [0.551, 0.394] },
  sym: { lb: [0.227, 0.113], rb: [0.774, 0.113], lt: [0.214, 0.037], rt: [0.787, 0.037], dpad: [0.202, 0.387], lstick: [0.353, 0.596], l3: [0.353, 0.596],
    rstick: [0.64, 0.596], r3: [0.64, 0.596], north: [0.803, 0.259], west: [0.741, 0.361], east: [0.866, 0.361], south: [0.803, 0.471], view: [0.327, 0.312], start: [0.672, 0.312] },
};

// 手柄, by scene: [logical button, what it does]. a/b follow 确定键 (cellOf).
const PAD = {
  通用: [['lstick', '移动光标；菜单里移动焦点'], ['dpad', '同左摇杆，一次一步'], ['a', '确定、选择、跳过演出'], ['b', '取消、返回（逐层退回）'], ['rstick', '转动镜头'],
    ['lt', '缩小'], ['rt', '放大'], ['r3', '镜头复位'], ['start', '系统菜单（战场上可收放小地图）']],
  战略: [['lstick', '光标在城市间跳'], ['a', '选城；再按到命令分组，再按展开'], ['lb', '上一组命令／上一座己方城'], ['rb', '下一组命令／下一座己方城'], ['x', '人物志'],
    ['dpad', '命令分组上推左：城中武将，确定看资料；命令列表首尾相接，首条推上到末条（如「记录」）'], ['view', '道路总览'], ['l3', '欣赏模式（左摇杆平移，扳机缩放）'], ['y', '长按：结束本月行动']],
  战场: [['lstick', '光标一次走一格'], ['a', '选将→移动→命令；对敌将：左侧确认，再按一次开战'], ['b', '返回上一步、取消目标、放开武将'], ['dpad', '目标名单上推右：到地图上选'], ['x', '撤销移动'],
    ['lb', '上一位己方武将'], ['rb', '下一位己方武将'], ['rstick', '拨一下转四分之一圈，上下换远近'], ['l3', '按住：看地形'], ['r3', '攻击、计略时：镜头移到目标'],
    ['view', '俯瞰全局；长按：精确数值'], ['y', '短按：敌军威胁范围；长按：结束本日／布阵完成']],
  '白兵·单挑': [['dpad', '选阵形、指令、部队'], ['a', '选阵形、下令'], ['x', '布阵：部署选中的阵形；单挑：查看双方资料'], ['start', '白兵：开始交战／暂停／继续'], ['y', '白兵：自动；单挑：自动／亲自指挥'],
    ['lt', '白兵：变慢'], ['rt', '白兵：变快'], ['view', '白兵：长按看精确兵数']],
};
// 键鼠, by scene: the mouse's uses (left, right, wheel: the callouts round the picture) and [keys, what they do].
const MOUSE = {
  通用: { left: '选择、确定', right: '取消、返回；拖动：转动镜头', wheel: '缩放' },
  战略: { left: '点城市或城名选城；拖动（城名上也行）：平移地图', right: '拖动：旋转沙盘（平面地图不转）', wheel: '缩放' },
  战场: { left: '选将、移动；点敌将在左侧确认攻击；拖动：平移；停在计略上看效果', right: '返回上一步、放开武将；拖动：转棋盘', wheel: '四档缩放' },
  '白兵·单挑': { left: '点阵形选中、点部署上阵；点指令；点头像看双方资料', right: '', wheel: '' },
};
const KEYS = {
  通用: [[['W', 'A', 'S', 'D'], '平移镜头'], [['Q', 'E'], '旋转镜头'], [['C'], '镜头复位'], [['Esc'], '取消、返回'], [['Enter', '空格'], '跳过当前演出'], [['H'], 'HD-2D 效果开关'],
    // The desktop game's window (desktop/main.js); in a browser these are the browser's own keys.
    ...(window.desktop ? [[window.desktop.mac ? ['⌥Enter'] : ['F11', 'Alt+Enter'], '全屏开关'], [[window.desktop.mac ? '⌘Q' : 'Alt+F4'], '退出游戏']] : [])],
  战略: [[['1–5'], '展开、收起命令分组'], [['R'], '人物志'], [['G'], '道路总览'], [['V'], '欣赏模式（V 或 Esc 恢复）'], [[quickSaveKey], '快捷存档'], [['F8'], '快捷读档']],
  战场: [[['Q', 'E'], '每次转四分之一圈'], [['Tab'], '俯瞰全局，再按回原视角'], [['T'], '按住：看地形'], [['R'], '按住：敌军威胁范围'], [['[', ']'], '上一位、下一位己方武将'], [['N'], '收放我军武将名单'], [['M'], '收放小地图'], [['Alt'], '按住：精确兵数与体力'], [['Z'], '撤销移动'], [['F'], '计略'], [['X'], '再施上次的计略'], [['L'], '攻击、计略时：镜头移到目标'], [['Enter'], '结束本日；确认攻击时：进入白兵战'], [['F8'], '快捷读档（回到战略记录）']],
  '白兵·单挑': [[['Enter'], '布阵：选阵形，在选中的阵形上再按即部署'], [['空格'], '白兵：开始交战／暂停／继续'], [['1–7'], '单挑：选指令'], [['8'], '单挑：查看资料'], [['T'], '单挑：自动／亲自指挥']],
};

// 触屏 (phone, 2026-11-17, Wrz0903@bilibili: the help showed the mouse to a phone): [what the finger does, what it does], by scene.
// No picture: the phone's own buttons are named as they read on screen.
const TOUCH = {
  通用: [['点一下', '选择、确定；演出中跳过当前一段'], ['单指拖动', '平移镜头'], ['双指捏合', '缩放'], ['双指一起移动', '平移'], ['「返回」「取消」', '退回上一步'], ['「☰ 系统」', '画面、声音、速度、记录与说明']],
  战略: [['点城市或城名', '选城；命令在右侧「城」「军」「仓」「町」「谋」，记录在「城」里'], ['点城的面板标题', '展开、收起城的详情'], ['「道路」「势力」', '道路总览、势力范围'], ['「人物志」', '查看武将'], ['「结束本月行动」', '结束本月']],
  战场: [['点己方武将', '选将，再点金色范围里的一格'], ['再点同一格或「确认移动」', '移动（花费机动力）'], ['点四角红框的敌将', '在左侧确认攻击'], ['计略、攻击', '先点名单里的目标或地图上的格，再点「施展」「进入白兵战」'],
    ['「撤销」', '撤销上一次移动'], ['「威」「地形」', '敌军威胁范围、被遮住的地形'], ['「我军」', '打开我军武将名单，点名字直接选将'], ['「‹」「›」', '上一位、下一位己方武将'], ['「待机·结束本日」', '结束本日']],
  '白兵·单挑': [['点阵形', '选中，再点「部署」上阵'], ['点指令', '下令'], ['点头像', '单挑：查看双方资料']],
};

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const glyph = (k, label) => h('kbd', { class: 'pg', 'data-glyph': k, 'data-label': label(k) ?? '' });

// input: 'touch' | 'pad' | 'keys' (the one shown first); touch: offer the 触屏 page (a phone); family, east: the pad's family and
// 确定键; label(k): a button's text label.
export function controls({ input, touch = false, family, east, label }) {
  let kind = input, scene = store.get('hd2d-help-scene') ?? '通用';
  if (!SCENES.includes(scene)) scene = '通用';
  const el = h('div', { class: 'ctl' });
  let ro = null;
  const draw = () => {
    const seg = (v, t) => h('button', { class: `btn ${kind === v ? 'on' : ''}`, 'aria-pressed': kind === v, onclick: () => { kind = v; draw(); el.querySelector('.ctl-kind .on')?.focus(); } }, t);
    const tab = (s) => h('button', { class: `btn ${scene === s ? 'on' : ''}`, 'aria-pressed': scene === s, onclick: () => { scene = s; store.set('hd2d-help-scene', s); draw(); el.querySelector('.ctl-tabs .on')?.focus(); } }, s);
    el.replaceChildren(
      h('div', { class: 'ctl-head' }, h('div', { class: 'ctl-kind' }, touch ? seg('touch', '触屏') : null, seg('keys', '键鼠'), seg('pad', '手柄')), h('div', { class: 'ctl-tabs' }, ...SCENES.map(tab))),
      kind === 'pad' ? padView(family, east, scene, label) : kind === 'touch' ? touchView(scene) : keysView(scene));
    requestAnimationFrame(() => leaders(el));
  };
  draw();
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => leaders(el)); ro.observe(el); }
  el.addEventListener('load', () => leaders(el), true); // the picture's size is known once it loads
  return el;
}

function touchView(scene) {
  return h('div', { class: 'ctl-keys ctl-touch' },
    h('div', { class: 'ctl-keylist' }, ...TOUCH[scene].map(([g, t]) => h('div', { class: 'ctl-key' }, h('b', { class: 'gesture' }, g), h('span', {}, t)))));
}

function padView(family, east, scene, label) {
  const layout = family === 'ps' ? 'sym' : 'offset', pos = POS[layout];
  const entries = [...PAD[scene]];
  if (scene === '战略' && recordAction('r3')) entries.push(['r3', '镜头复位']);
  const rows = entries.map(([k, t]) => { const c = cellOf(east, k); return { k, t: scene === '战略' ? RECORD_ACTIONS[recordAction(k)] ?? t : t, c, p: pos[c] }; });
  const side = (left) => rows.filter((r) => (r.p[0] < 0.5) === left).sort((a, b) => a.p[1] - b.p[1])
    .map((r) => h('div', { class: 'ctl-call', 'data-x': r.p[0], 'data-y': r.p[1] }, glyph(r.k, label), h('span', {}, r.t)));
  // One glyph per place on the picture (a stick and its click share one): the first callout's.
  const at = new Map(); for (const r of rows) if (!at.has(String(r.p))) at.set(String(r.p), r);
  return h('div', { class: 'ctl-pad' },
    h('div', { class: 'ctl-side left' }, ...side(true)),
    h('div', { class: 'ctl-fig' }, h('img', { src: `assets/ai/pad/${layout}.webp`, alt: '手柄' }),
      ...[...at.values()].map((r) => h('span', { class: 'ctl-on', style: { left: `${r.p[0] * 100}%`, top: `${r.p[1] * 100}%` } }, glyph(r.k, label)))),
    h('div', { class: 'ctl-side right' }, ...side(false)),
    lines(), h('p', { class: 'ctl-foot' }, '手柄打开「系统 → 手柄」可切换确定键、设置战略地图存读档快捷键'));
}

// Where the mouse's parts are on its picture, as fractions.
const MPOS = { left: [0.233, 0.225], right: [0.764, 0.225], wheel: [0.503, 0.217] };
function keysView(scene) {
  const m = MOUSE[scene], call = (part, t, glyphText) => t ? h('div', { class: 'ctl-call', 'data-x': MPOS[part][0], 'data-y': MPOS[part][1] }, h('b', {}, glyphText), h('span', {}, t)) : null;
  return h('div', { class: 'ctl-keys' },
    h('div', { class: 'ctl-pad mouse' },
      h('div', { class: 'ctl-side left' }, call('left', m.left, '左键')),
      h('div', { class: 'ctl-fig' }, h('img', { src: 'assets/ai/pad/mouse.webp', alt: '鼠标' })),
      h('div', { class: 'ctl-side right' }, call('wheel', m.wheel, '滚轮'), call('right', m.right, '右键')),
      lines()),
    h('div', { class: 'ctl-keylist' }, ...KEYS[scene].map(([ks, t]) => h('div', { class: 'ctl-key' }, h('span', { class: 'caps' }, ...ks.map((k) => h('kbd', {}, k))), h('span', {}, t)))));
}

// A line from each callout's inner edge to its control on the picture.
function leaders(el) {
  for (const pad of el.querySelectorAll('.ctl-pad')) {
    const svg = pad.querySelector('.ctl-lines'), img = pad.querySelector('.ctl-fig img');
    if (!svg || !img?.complete || !img.naturalWidth) continue;
    const o = pad.getBoundingClientRect(), f = img.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`); svg.setAttribute('width', o.width); svg.setAttribute('height', o.height);
    svg.replaceChildren(...[...pad.querySelectorAll('.ctl-call')].flatMap((c) => {
      const r = c.getBoundingClientRect(), left = c.closest('.left'), x0 = (left ? r.right + 4 : r.left - 4) - o.left, y0 = r.top + r.height / 2 - o.top;
      const x1 = f.left + Number(c.dataset.x) * f.width - o.left, y1 = f.top + Number(c.dataset.y) * f.height - o.top;
      const bend = left ? Math.min(x1 - 10, x0 + 18) : Math.max(x1 + 10, x0 - 18);
      // It stops at the rim of the glyph on the button (radius about half a face button), not over it.
      const dx = x1 - bend, dy = y1 - y0, d = Math.hypot(dx, dy) || 1, rim = Math.min(d - 1, f.width * 0.036);
      const x2 = x1 - dx / d * rim, y2 = y1 - dy / d * rim;
      const line = document.createElementNS(NS, 'polyline'); line.setAttribute('points', `${x0},${y0} ${bend},${y0} ${x2},${y2}`);
      const dot = document.createElementNS(NS, 'circle'); dot.setAttribute('cx', x2); dot.setAttribute('cy', y2); dot.setAttribute('r', 2);
      return [line, dot];
    }));
  }
}
