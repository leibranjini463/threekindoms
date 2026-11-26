// 简体 → 繁體（台湾标准）: the converter behind 系统 → 文字 (src/lang.js). Pure, no DOM, so tools/zh_hant_table.mjs builds the
// table with this same function and the game converts exactly as the table was checked.
// table: { chars: { 简: 繁 }, phrases: { 简词: 繁詞 } } (src/zhtable.js). A phrase wins over its characters, the longest
// phrase at a place wins (forward maximum matching, as OpenCC's segmentation), and a character with no entry stays as it is.
export function makeConverter({ chars, phrases }) {
  const ph = new Map(Object.entries(phrases)), ch = new Map(Object.entries(chars));
  let max = 1; const starts = new Set();
  for (const k of ph.keys()) { max = Math.max(max, k.length); starts.add(k[0]); }
  const cache = new Map();
  const run = (s) => {
    let out = '';
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (starts.has(c)) {
        let hit = 0;
        for (let n = Math.min(max, s.length - i); n > 1; n--) if (ph.has(s.substr(i, n))) { hit = n; break; }
        if (hit) { out += ph.get(s.substr(i, hit)); i += hit; continue; }
      }
      out += ch.get(c) ?? c; i++;
    }
    return out;
  };
  return (s) => {
    if (typeof s !== 'string' || !/[㐀-鿿]/.test(s)) return s;
    if (s.length > 400) return run(s);
    let v = cache.get(s);
    if (v === undefined) { if (cache.size > 4000) cache.clear(); v = run(s); cache.set(s, v); }
    return v;
  };
}

// 繁 → 简, character by character from the same table: what a player types in a search box (武将一览) meets the 简体 names.
export function makeReverse({ chars, phrases }) {
  const back = new Map();
  for (const [s, t] of Object.entries(chars)) if (!back.has(t)) back.set(t, s);
  for (const [s, t] of Object.entries(phrases)) if (s.length === t.length) for (let i = 0; i < s.length; i++) if (s[i] !== t[i] && !back.has(t[i])) back.set(t[i], s[i]);
  return (s) => (typeof s === 'string' ? [...s].map((c) => back.get(c) ?? c).join('') : s);
}
