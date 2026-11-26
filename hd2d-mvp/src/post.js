// HD-2D post stack: depth of field (focused on the scene's subject) → bloom → grade + vignette.
// Each scene sets its own profile (PROFILES): the title may carry a little film grain and fringe, play
// screens keep outlines clean — no chromatic aberration, faint grain, a light warm cast and gentle bloom.
// Toggle via setEnabled(false) to compare against a plain render.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Ambient occlusion (GTAO) is computed from the scene pass's own depth (normals rebuilt from depth, so
// alpha-tested sprites occlude by their silhouettes, not their quads) and multiplied in as the depth of
// field first reads the scene, so blurred areas carry their occlusion too.
// Depth of field from the scene's depth: a pixel's blur (circle of confusion) grows with its distance from
// the focus plane, as a fraction of the focus distance. Two separable gather passes; a tap counts only when
// its own blur reaches this pixel, and nothing behind a pixel bleeds onto it unless the pixel is blurred too,
// so a sharp rider never picks up a halo of the field behind. The first pass reads depth and leaves each
// pixel's signed CoC in alpha (near negative, widened by the near blur it took in) for the second.
const Dof = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: null }, ao: { value: 0 }, fromDepth: { value: 1 }, dir: { value: new THREE.Vector2(1, 0) }, res: { value: new THREE.Vector2(1, 1) },
    focus: { value: 20 }, range: { value: 0.08 }, ramp: { value: 0.22 }, radius: { value: 8 }, far: { value: 1 }, near: { value: 1 }, cameraNear: { value: 0.5 }, cameraFar: { value: 200 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `#include <packing>
    uniform sampler2D tDiffuse, tDepth, tAO; uniform vec2 dir, res; varying vec2 vUv;
    uniform float ao, fromDepth, focus, range, ramp, radius, far, near, cameraNear, cameraFar;
    float cocAt(vec2 uv){
      if (fromDepth < .5) return texture2D(tDiffuse, uv).a;
      float z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
      float c = (z - focus) / focus;
      return c > 0. ? smoothstep(range, range + ramp, c) * far : -smoothstep(range, range + ramp, -c) * near;
    }
    vec4 colAt(vec2 uv){
      vec4 c = texture2D(tDiffuse, uv);
      if (ao > 0.) c.rgb *= mix(1., texture2D(tAO, uv).r, ao);
      return c;
    }
    void main(){
      vec4 c0 = colAt(vUv);
      float cc = cocAt(vUv), reach = max(0., -cc), wsum = 1.;
      // No blur (the 战术 overhead view, the stack off): every tap would land on this pixel and give back c0 and cc.
      if (radius <= 0.) { gl_FragColor = vec4(c0.rgb, fromDepth > .5 ? cc : 1.); return; }
      vec3 sum = c0.rgb;
      for (int i = -8; i <= 8; i++) {
        if (i == 0) continue;
        float t = float(i) / 8., dist = abs(t) * radius;
        vec2 uv = vUv + dir / res * t * radius;
        float sc = cocAt(uv);
        float w = clamp(abs(sc) * radius - dist + 1., 0., 1.) * (1. - .4 * t * t);
        if (sc > cc) w *= clamp(abs(cc) * radius - dist + 1., 0., 1.);
        sum += colAt(uv).rgb * w; wsum += w;
        if (sc < 0.) reach = max(reach, -sc * w);
      }
      gl_FragColor = vec4(sum / wsum, fromDepth > .5 ? (reach > 0. ? -reach : cc) : 1.);
    }`,
};

// The scene renders into its own target so the depth of field can read its depth buffer.
class ScenePass extends Pass {
  constructor(scene, camera, samples) {
    super(); this.scene = scene; this.camera = camera; this.needsSwap = false;
    // With a stencil: the landmarks mark their pixels there, and the x-ray ghost (src/seethrough.js) stays off them.
    const depth = new THREE.DepthTexture(1, 1); depth.format = THREE.DepthStencilFormat; depth.type = THREE.UnsignedInt248Type;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture: depth, stencilBuffer: true });
    // With MSAA (a low-DPI screen) three resolves the target each frame. The stencil is only tested while the scene draws,
    // never read after, so only the depth is resolved: on Windows, ANGLE resolves depth and stencil together (D24S8) by
    // mapping the buffer to the CPU (Blit11::copyDepthStencil), every frame at full size, and a Windows player's AMD
    // D3D11 driver crashed in that copy (2026-11-08, the war map went white). three's own transmission targets skip it too.
    this.target.resolveStencilBuffer = false;
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer) { renderer.setRenderTarget(this.target); renderer.render(this.scene, this.camera); }
}

// GTAO and its denoise both rebuild a pixel's normal from nine depth taps (three's computeNormalFromDepth); the denoise does it again
// for each of its taps, about 100 texture reads a pixel at full size. This pass does it once a frame, the same function at each
// pixel's centre, and the two read it back by texel (normalFetch below), the very texel the rebuild would have taken. Stored
// octahedral in two half floats (half the memory and reads of RGBA), decoded where they are read.
const NormalFromDepth = {
  uniforms: { tDepth: { value: null }, cameraProjectionMatrixInverse: { value: new THREE.Matrix4() } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDepth; uniform mat4 cameraProjectionMatrixInverse; varying vec2 vUv;
    vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
      vec4 clipSpacePosition = vec4(vec3(screenPosition, depth) * 2.0 - 1.0, 1.0);
      vec4 viewSpacePosition = cameraProjectionMatrixInverse * clipSpacePosition;
      return viewSpacePosition.xyz / viewSpacePosition.w;
    }
    float fetchDepth(const ivec2 uv) { return texelFetch(tDepth, uv.xy, 0).x; }
    void main(){
      vec2 uv = vUv, size = vec2(textureSize(tDepth, 0));
      ivec2 p = ivec2(uv * size);
      float c0 = fetchDepth(p);
      float l2 = fetchDepth(p - ivec2(2, 0)), l1 = fetchDepth(p - ivec2(1, 0)), r1 = fetchDepth(p + ivec2(1, 0)), r2 = fetchDepth(p + ivec2(2, 0));
      float b2 = fetchDepth(p - ivec2(0, 2)), b1 = fetchDepth(p - ivec2(0, 1)), t1 = fetchDepth(p + ivec2(0, 1)), t2 = fetchDepth(p + ivec2(0, 2));
      float dl = abs((2.0 * l1 - l2) - c0), dr = abs((2.0 * r1 - r2) - c0), db = abs((2.0 * b1 - b2) - c0), dt = abs((2.0 * t1 - t2) - c0);
      vec3 ce = getViewPosition(uv, c0).xyz;
      vec3 dpdx = (dl < dr) ? ce - getViewPosition((uv - vec2(1.0 / size.x, 0.0)), l1).xyz : -ce + getViewPosition((uv + vec2(1.0 / size.x, 0.0)), r1).xyz;
      vec3 dpdy = (db < dt) ? ce - getViewPosition((uv - vec2(0.0, 1.0 / size.y)), b1).xyz : -ce + getViewPosition((uv + vec2(0.0, 1.0 / size.y)), t1).xyz;
      vec3 n = normalize(cross(dpdx, dpdy)); n /= abs(n.x) + abs(n.y) + abs(n.z);
      vec2 e = n.z >= 0. ? n.xy : (1. - abs(n.yx)) * vec2(n.x >= 0. ? 1. : -1., n.y >= 0. ? 1. : -1.);
      gl_FragColor = vec4(e, 0., 1.);
    }`,
};
const NORMAL_READ = 'return normalize(textureLod(tNormal, uv, 0.).rgb);';
const normalFetch = 'return octNormal(texelFetch(tNormal, ivec2(uv * vec2(textureSize(tNormal, 0))), 0).rg);';
const NORMAL_FN = 'vec3 getViewNormal(const vec2 uv) {';
const octNormal = 'vec3 octNormal(vec2 e) { vec3 n = vec3(e, 1. - abs(e.x) - abs(e.y)); float t = max(-n.z, 0.); n.x += n.x >= 0. ? -t : t; n.y += n.y >= 0. ? -t : t; return normalize(n); }\n';

const Grade = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.95 }, warmth: { value: 0.07 }, sat: { value: 1.15 }, time: { value: 0 }, aberration: { value: 0.0025 }, grain: { value: 0.025 },
    exposure: { value: 1 }, contrast: { value: 1 }, shadowTint: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: Dof.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette, warmth, sat, time, aberration, grain, exposure, contrast; uniform vec3 shadowTint; varying vec2 vUv;
    void main(){
      vec2 off = (vUv - .5) * aberration * length(vUv - .5) * 4.;
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r; c.b = texture2D(tDiffuse, vUv - off).b;
      c.rgb *= exposure;
      c.rgb = .18 * pow(max(c.rgb, vec3(0.)) / .18, vec3(contrast)); // the buffer is linear HDR: pivot on mid-grey
      float l = dot(c.rgb, vec3(.299,.587,.114));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb += shadowTint * (1. - smoothstep(0., .12, l));
      c.rgb += vec3(warmth, warmth*.4, -warmth*.6) * (1. - l);
      vec2 p = vUv - .5;
      c.rgb *= 1. - vignette * dot(p, p) * 1.1;
      c.rgb += (fract(sin(dot(vUv * 913.7 + time, vec2(12.9898, 78.233))) * 43758.5453) - .5) * grain;
      gl_FragColor = c;
    }`,
};

// bloom: [strength, radius, threshold]; dof: blur strength; band: half-depth of the sharp zone as a share of
// the focus distance (the board is shallow seen down the view axis, so a few percent already reaches its rim);
// far / near: blur scale behind / in front of the focus. ao: occlusion strength (0 skips the pass);
// exposure / contrast / shadowTint: the grade's tone (defaults leave a scene as it was). A scene may override dof/band/far/near per frame (setDof).
export const PROFILES = {
  title:    { bloom: [0.4, 0.5, 0.84], dof: 3.0, band: 0.05, warmth: 0.05, sat: 1.0, aberration: 0.0012, grain: 0.014, vignette: 1.0,
              ao: 0.8, exposure: 1.0, contrast: 1.1, shadowTint: [0.0, 0.012, 0.03] },
  // The 战略地图 shares the war map's occlusion and cool shadows but is graded high-key: 0.1.1 playtesters
  // missed the FC map's bright green land and white castles, so it is lighter, cleaner and less vignetted.
  strategy: { bloom: [0.24, 0.45, 0.9], dof: 1.8, band: 0.07, far: 1, warmth: 0.012, sat: 1.06, aberration: 0, grain: 0.005, vignette: 0.5,
              ao: 0.75, exposure: 1.1, contrast: 1.05, shadowTint: [0.0, 0.01, 0.03] },
  // Lit by the month like the 战略地图 (seasonenv.js), so graded a step brighter and cleaner than the old dusk.
  // A calm board (A2): a lighter AO, whose sampling speckles open ground; softer contrast. War-3d Task 9: a touch of warmth, bloom
  // and grain, a deeper vignette; the tilt-shift per zoom step comes from the view (warview.js dof).
  war:      { bloom: [0.32, 0.5, 0.86], dof: 1.5, band: 0.09, far: 1.3, warmth: 0.03, sat: 1.0, aberration: 0, grain: 0.004, vignette: 0.8,
              ao: 0.7, exposure: 1.0, contrast: 1.06, shadowTint: [0.0, 0.012, 0.03] },
  // The painted field (A2, as the war map): no grain, softer occlusion, the country sinking into a vignette.
  skirmish: { bloom: [0.26, 0.45, 0.9], dof: 2.0, band: 0.08, warmth: 0.02, sat: 0.96, aberration: 0, grain: 0, vignette: 0.9,
              ao: 0.7, exposure: 0.98, contrast: 1.08, shadowTint: [0.0, 0.012, 0.03] },
  duel:     { bloom: [0.26, 0.45, 0.92], dof: 1.5, band: 0.1, warmth: 0.02, sat: 1.0, aberration: 0, grain: 0.006, vignette: 0.65 },
};

// The shader's relative sharp band and ramp for a lens at a focus distance: bandWorld / rampWorld are depth in world units either side of
// the focus plane (so the same depth stays sharp however close the camera is), else band is the share of the focus distance. The one place
// this is worked out: the uniforms and the probe both read it.
export const blurRange = ({ band, bandWorld, rampWorld }, focus) => ({ range: bandWorld != null ? bandWorld / focus : band, ramp: rampWorld != null ? rampWorld / focus : 0.22 });
// The blur weight (0 sharp … 1 full, times the side's weight) of a point at view depth z, as the shader's cocAt reads it.
export const blurWeight = (z, focus, lens) => {
  const { range, ramp } = blurRange(lens, focus), { far = 1, near = 1 } = lens, c = (z - focus) / focus, a = Math.abs(c);
  const t = Math.min(1, Math.max(0, (a - range) / ramp)), k = t * t * (3 - 2 * t);
  return k * (c > 0 ? far : near);
};

export function createPost(renderer, scene, camera) {
  // Quality preset (src/quality.js): ao 'auto' (half size on a Retina canvas) | 'half' | 'off'; msaa; shadowCap,
  // the largest shadow map a scene's sun may use.
  // dense: the screen has ≥1.5 device pixels per CSS pixel (quality.js), though the preset's pixel count may hold the canvas under
  // that ratio; unset (nothing has said), the canvas's own ratio decides.
  // fullRatio: the canvas's pixel ratio before the preset's pixel count lowered it. The depth of field's radius is in canvas pixels, so a
  // canvas held under that ratio takes a radius as much smaller and the blur stays as wide on the screen as it was.
  const quality = { ao: 'auto', msaa: true, shadowCap: Infinity, dense: null, fullRatio: null };
  const retina = () => quality.dense ?? renderer.getPixelRatio() >= 1.5;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  // setSize takes device pixels, like every other target here; left at the renderer's ratio the composer would
  // scale them again (its buffers and the DoF / grade passes at DPR² the screen's pixels: 6400×3600 on Retina).
  composer.setPixelRatio(1);
  const render = new ScenePass(scene, camera, 0);
  const dofH = new ShaderPass(Dof), dofV = new ShaderPass(Dof);
  dofH.uniforms.tDiffuse.value = render.target.texture; dofH.uniforms.tDepth.value = render.target.depthTexture;
  dofH.textureID = null; // reads the scene target, not the composer's buffer
  dofV.uniforms.dir.value.set(0, 1); dofV.uniforms.fromDepth.value = 0;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 0.82);
  const grade = new ShaderPass(Grade);
  // GTAOPass would build its own normal/depth buffers if handed a depth texture at construction (and then
  // trip over the missing normal target), so it is made bare and pointed at the scene pass's depth after.
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.setGBuffer(render.target.depthTexture, undefined);
  gtao.output = GTAOPass.OUTPUT.Off;
  gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.5, scale: 1.25, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2 });
  dofH.uniforms.tAO.value = gtao.pdRenderTarget.texture;
  // The normals, rebuilt from depth once a frame (NormalFromDepth) for both of GTAO's passes; if three's shaders ever stop matching
  // the line patched here, they keep rebuilding their own.
  const normals = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const normalMat = new THREE.ShaderMaterial(NormalFromDepth), normalQuad = new FullScreenQuad(normalMat);
  normalMat.uniforms.tDepth.value = render.target.depthTexture;
  const aoMats = [gtao.gtaoMaterial, gtao.pdMaterial], stock = aoMats.map((m) => m.fragmentShader);
  let cached = false;
  // on: read the cached normals; off: three's own rebuild in each pass (tests/post.test.mjs compares the two).
  const useNormalCache = (on) => {
    cached = on && stock.every((s) => s.includes(NORMAL_READ) && s.includes(NORMAL_FN));
    aoMats.forEach((m, i) => {
      m.fragmentShader = cached ? stock[i].replace(NORMAL_READ, normalFetch).replace(NORMAL_FN, octNormal + NORMAL_FN) : stock[i];
      m.defines.NORMAL_VECTOR_TYPE = cached ? 2 : 0; m.uniforms.tNormal.value = cached ? normals.texture : undefined; m.needsUpdate = true;
    });
    return cached;
  };
  if (!useNormalCache(true)) console.warn('post: GTAO shaders changed, normals stay rebuilt per tap');
  const drawNormals = (renderer) => {
    normalMat.uniforms.cameraProjectionMatrixInverse.value.copy(render.camera.projectionMatrixInverse);
    renderer.setRenderTarget(normals); normalQuad.render(renderer);
  };
  const aoOn = () => enabled && quality.ao !== 'off' && !!profile.ao;
  const scenePass = render.render.bind(render);
  render.render = (renderer) => { scenePass(renderer); if (aoOn()) { if (cached) drawNormals(renderer); gtao.camera = render.camera; gtao.render(renderer, null, null); } };
  for (const p of [render, dofH, dofV, bloom, grade, new OutputPass()]) composer.addPass(p);
  let enabled = true, profile = PROFILES.strategy, dof = null;
  // The DoF passes stay on when the stack is off: with no blur the first one is the copy out of the scene target.
  // A scene may give the sharp band in world units instead (bandWorld, rampWorld: depth either side of the focus plane), which holds the
  // same depth in focus however close the camera is; otherwise band is the share of the focus distance, as the profiles have it.
  let focusDist = 20;
  const setBlur = (lens) => {
    const { strength, far = 1, near = 1 } = lens, { range, ramp } = blurRange(lens, focusDist), held = quality.fullRatio ? Math.min(1, renderer.getPixelRatio() / quality.fullRatio) : 1;
    for (const p of [dofH, dofV]) { p.uniforms.radius.value = enabled ? strength * 3.2 * held : 0; p.uniforms.far.value = far; p.uniforms.near.value = near; p.uniforms.range.value = range; p.uniforms.ramp.value = ramp; }
  };
  // Each scene's sun keeps the map size it was built with unless the preset caps it; a resized map is rebuilt.
  const capShadows = (s) => s?.traverse((o) => {
    if (!o.isLight || !o.castShadow) return;
    const size = Math.min(o.userData.shadowSize ??= o.shadow.mapSize.x, quality.shadowCap);
    if (o.shadow.mapSize.x !== size) { o.shadow.mapSize.set(size, size); o.shadow.map?.dispose(); o.shadow.map = null; }
  });
  const api = {
    setProfile(name) {
      profile = PROFILES[name] || PROFILES.strategy;
      [bloom.strength, bloom.radius, bloom.threshold] = profile.bloom;
      dof = null;
      for (const k of ['warmth', 'sat', 'aberration', 'grain', 'vignette']) grade.uniforms[k].value = profile[k];
      grade.uniforms.exposure.value = profile.exposure ?? 1; grade.uniforms.contrast.value = profile.contrast ?? 1;
      grade.uniforms.shadowTint.value.setRGB(...(profile.shadowTint ?? [0, 0, 0]));
    },
    // A scene may override the profile's blur per frame: { strength, band, far, near }.
    setDof(d) { dof = d; },
    composer, gtao, useNormalCache, get normalCache() { return cached; }, dofUniforms: () => ({ range: dofH.uniforms.range.value, ramp: dofH.uniforms.ramp.value, focus: dofH.uniforms.focus.value, far: dofH.uniforms.far.value, near: dofH.uniforms.near.value }),
    setView(s, c) { render.scene = s; render.camera = c; capShadows(s); },
    // Takes effect with the next setSize (the caller resizes after changing the pixel ratio).
    setQuality(q) { Object.assign(quality, q); capShadows(render.scene); },
    setSize(w, h) {
      // The renderer runs without antialiasing, and stair-stepped voxel and roof edges add to the grainy look.
      // A Retina canvas (pixel ratio ≥1.5) is already supersampled; on low-DPI screens the scene pass gets 2×
      // MSAA (4× cost about 40% of the frame rate for little visible gain). The target is rebuilt on a change.
      // A dense screen whose canvas the pixel count holds under 1.5 (a 4K one at 2×: 1.34 at 高) still goes without:
      // its pixels are small on the glass, the edges look the same side by side, and MSAA there cost about 2 ms of a 15 ms frame (战略地图 at 中, M4).
      const samples = quality.msaa && !retina() ? 2 : 0;
      if (render.target.samples !== samples) { render.target.samples = samples; render.target.dispose(); }
      composer.setSize(w, h); render.setSize(w, h); gtao.setSize(w, h); normals.setSize(w, h);
      // On a Retina canvas the occlusion is traced at half resolution (still one sample per CSS pixel, as on a
      // low-DPI screen) and denoised at full resolution: the denoise weighs its taps by each pixel's own depth
      // and normal, so it also brings the half-size result back up without blurring across edges (a rider against
      // the field, a wall against the valley keep their contact lines). Denoising at half size as well blurred
      // those lines; 8 taps instead of 16 look the same there. About 10 ms a frame saved on a Retina strategy map
      // (M4). On a low-DPI canvas half size is visibly softer for ~3 ms, so only the 中 preset uses it there.
      const half = quality.ao === 'half' || (quality.ao === 'auto' && retina());
      gtao.updatePdMaterial({ samples: half ? 8 : 16 });
      if (half) { const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2); gtao.gtaoRenderTarget.setSize(hw, hh); gtao.gtaoMaterial.uniforms.resolution.value.set(hw, hh); }
      for (const p of [dofH, dofV]) p.uniforms.res.value.set(w, h);
    },
    // Distance from the camera to the focus plane, in world units along the view axis.
    setFocus(dist) { focusDist = Math.max(0.1, dist); for (const p of [dofH, dofV]) p.uniforms.focus.value = focusDist; },
    setEnabled(on) {
      enabled = on;
      bloom.enabled = grade.enabled = on;
    },
    get enabled() { return enabled; },
    // Compile a scene's shaders ahead of its first frame, off the main thread where the browser can (KHR_parallel_shader_compile).
    // Done with the scene target bound, as render() draws the scene: three keys a program on its target (tone mapping, colour space),
    // so a compile against the screen would make programs the frame never uses.
    compile(scene, camera) {
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(render.target);
      try { return renderer.compileAsync(scene, camera); } finally { renderer.setRenderTarget(was); }
    },
    render() {
      setBlur(dof ?? { strength: profile.dof, band: profile.band, far: profile.far });
      dofH.uniforms.ao.value = aoOn() ? profile.ao : 0;
      dofH.uniforms.cameraNear.value = render.camera.near; dofH.uniforms.cameraFar.value = render.camera.far;
      grade.uniforms.time.value = performance.now() / 1000 % 100; composer.render();
    },
  };
  return api;
}
