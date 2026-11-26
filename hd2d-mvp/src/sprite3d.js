// Making flat pixel sprites read as solid figures on the diorama, the way HD-2D characters do: lit by the
// scene's lights through a normal map inflated from the sprite's own silhouette (so the sun models the
// side it reaches and the far side falls into shade), a warm rim where the silhouette turns toward the
// sun, and a shadow cast from an invisible copy that always faces the sun, so the full figure lands on
// the ground instead of the sliver a camera-facing card would throw.
import * as THREE from 'three';

// Normal map from alpha: distance to the nearest transparent texel (two-pass chamfer transform), turned
// into a rounded dome of height sqrt(1 − (1 − d/R)²), plus a little relief from the texels' luminance so
// armour and folds catch light. Cached per texture.
const normalCache = new WeakMap();
export function silhouetteNormals(tex, { radius, relief = 0.18 } = {}) {
  if (normalCache.has(tex)) return normalCache.get(tex);
  const img = tex.image, w = img.width, h = img.height, R = radius ?? Math.max(4, Math.round(Math.min(w, h) * 0.08));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, w, h).data, INF = 1e9, d = new Float32Array(w * h), lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { d[i] = src[i * 4 + 3] < 128 ? 0 : INF; lum[i] = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.59 + src[i * 4 + 2] * 0.11) / 255; }
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (d[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414); }
  const height = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const i = y * w + x, k = Math.min(1, d[i] / R);
    return d[i] ? Math.sqrt(1 - (1 - k) * (1 - k)) + lum[i] * relief : 0;
  };
  const out = g.createImageData(w, h), o = out.data, s = R * 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    // Tangent space: +x right, +y up the texture (rows run down, hence the sign on dy).
    const dx = (height(x + 1, y) - height(x - 1, y)) * s, dy = (height(x, y + 1) - height(x, y - 1)) * s;
    const n = new THREE.Vector3(-dx, dy, 1).normalize();
    o[i] = (n.x * 0.5 + 0.5) * 255; o[i + 1] = (n.y * 0.5 + 0.5) * 255; o[i + 2] = (n.z * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter; t.flipY = tex.flipY; t.colorSpace = THREE.NoColorSpace;
  normalCache.set(tex, t);
  return t;
}

// The shared uniforms every lit sprite reads: the sun's direction in view space (updateSpriteLight each
// frame) and the rim's colour and strength.
export const spriteLight = { sunView: { value: new THREE.Vector3(0, 1, 0) }, rimColor: { value: new THREE.Color('#ffc890') }, rimStrength: { value: 0.9 } };
const _d = new THREE.Vector3();
export function updateSpriteLight(sun, camera) { spriteLight.sunView.value.copy(_d.copy(sun.position).normalize().transformDirection(camera.matrixWorldInverse)); }

// A sprite material lit through its silhouette normals. The base normal leans halfway between facing the
// camera and facing the sky (so overhead light still reaches it and the low sun can model its sides).
// extra.normalMap overrides the generated one (a per-unit clone of an atlas's normals, offset with its frame).
export function litSprite(map, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ map, normalMap: extra.normalMap || silhouetteNormals(map), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, ...extra });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, spriteLight);
    shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>',
      '#include <defaultnormal_vertex>\n transformedNormal = normalize(mix(vec3(0., 0., 1.), (viewMatrix * vec4(0., 1., 0., 0.)).xyz, 0.45));');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sunView; uniform vec3 rimColor; uniform float rimStrength;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;')
      .replace('#include <opaque_fragment>', `
        float ndv = clamp(dot(normal, normalize(vViewPosition)), 0., 1.);
        float toward = max(0., dot(normalize(normal.xy + 1e-5), normalize(sunView.xy + 1e-5)));
        outgoingLight += rimColor * diffuseColor.rgb * pow(1. - ndv, 2.) * toward * rimStrength;
        #include <opaque_fragment>`);
  };
  return m;
}

// Invisible in the camera's pass (no colour, no depth) but drawn by the shadow pass with the sprite's own
// alpha, so it throws the figure's silhouette. Turn it to face the sun with faceSun().
export function shadowCaster(geo, map) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
  m.castShadow = true; m.renderOrder = -1;
  return m;
}
export const sunYaw = (sun) => Math.atan2(sun.position.x, sun.position.z);
