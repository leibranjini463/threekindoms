// Optional generated assets (GPT portraits, PixelLab/GPT sprites, ElevenLabs BGM and SFX).
// assets/manifest.json lists the expected paths; anything missing falls back to placeholders.
import * as THREE from 'three';

// One HEAD per URL: the music sets below ask again for the BGM and phrases the audio list already looked for.
const seen = new Map();
function exists(url) {
  if (!seen.has(url)) seen.set(url, fetch(url, { method: 'HEAD' }).then((r) => r.ok, () => false));
  return seen.get(url);
}

export async function loadManifest() {
  const m = await (await fetch('assets/manifest.json')).json();
  const found = { portraits: {}, sprites: {}, audio: {}, music: {} };
  const jobs = [];
  // A list means "first existing wins": generated asset, then the local original-game placeholder.
  for (const group of ['portraits', 'sprites', 'audio']) for (const [k, urls] of Object.entries(m[group] || {})) {
    jobs.push((async () => {
      for (const url of [urls].flat()) if (await exists(url)) { found[group][k] = url; return; }
    })());
  }
  // Every BGM and phrase that exists, so the player can switch between the music sets (remix, original).
  for (const [k, urls] of Object.entries(m.audio || {})) if (k.startsWith('bgm-') || k.startsWith('cue-')) {
    jobs.push((async () => {
      const ok = await Promise.all([urls].flat().map(exists));
      found.music[k] = [urls].flat().filter((_, i) => ok[i]);
    })());
  }
  await Promise.all(jobs);
  return found;
}

// The painted icon of a piece of equipment (tools/gen_equip_icons_codex.sh): 0-23 weapons, 24-31 armour, as D.equipment.
export const equipIcon = (id) => `assets/ai/icon/equip/${id}.webp`;

export function loadPixelTexture(url) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, (t) => {
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter;
    t.colorSpace = THREE.SRGBColorSpace; res(t);
  }, undefined, rej));
}
