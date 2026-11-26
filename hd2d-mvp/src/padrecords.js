// Player-selected shortcuts on the strategy map. Store physical button positions so changing
// the pad family or confirm side only changes the displayed glyphs.
import { h, modal, confirmBox, toast } from './ui.js';

export const RECORD_ACTIONS = { save: '记录进度', load: '读取记录', quickSave: '快捷存档', quickLoad: '快捷读档' };
const ORIGINAL = { x: '人物志', view: '道路总览', l3: '欣赏模式', r3: '镜头复位' };
const STORAGE = 'hd2d-pad-record-keys';

function read() {
  const valid = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE));
    for (const k of Object.keys(ORIGINAL)) {
      if (Object.hasOwn(RECORD_ACTIONS, saved?.[k]) && !Object.values(valid).includes(saved[k])) valid[k] = saved[k];
    }
  } catch {}
  return valid;
}
let bindings = read();
export const recordAction = k => bindings[k];
export const recordKey = action => Object.keys(bindings).find(k => bindings[k] === action);

function write(next) {
  try { localStorage.setItem(STORAGE, JSON.stringify(next)); }
  catch { toast('按键设置未能保存'); return; }
  bindings = next;
}

export async function configureRecordButton(action, label) {
  const name = RECORD_ACTIONS[action], current = recordKey(action);
  const key = await modal(name + ' · 选择按键', close => [
    h('p', { class: 'hint' }, '在战略地图上按一次即可使用。请选择要分配的手柄键。'),
    h('div', { class: 'record-keys' }, ...Object.entries(ORIGINAL).map(([k, original]) =>
      h('button', { class: 'btn', 'data-pad-first': k === (current ?? 'x'), onclick: () => close(k) },
        label(k), '　', RECORD_ACTIONS[bindings[k]] ?? original))),
    h('div', { class: 'foot' },
      h('button', { class: 'btn', disabled: !current, onclick: () => close('clear') }, '清除绑定'),
      h('button', { class: 'btn', onclick: () => close(null) }, '取消')),
  ]);
  if (!key || key === current) return;
  if (key !== 'clear' && !(await confirmBox('替换战略地图按键',
    `${label(key)} 当前用于「${RECORD_ACTIONS[bindings[key]] ?? ORIGINAL[key]}」，改为「${name}」？`))) return;
  const next = { ...bindings };
  delete next[current];
  if (key !== 'clear') next[key] = action;
  write(next);
}

export async function resetRecordButtons() {
  if (await confirmBox('恢复默认快捷键', '清除四项存读档绑定，恢复这些键在战略地图上的原有操作？')) write({});
}
