// Keeping the generals readable when set pieces stand between them and the camera, the way HD-2D
// tactics boards and isometric RPGs do it (a soft hole over the figure, as in Baldur's Gate 3 or RuneScape's
// canopy cutout, and a silhouette where no hole can be made):
//  - cutout: walls, roofs, trees and rocks in front of a unit are blended down over its screen footprint (an
//    ellipse fitted to the opaque pixels of its sprite, cleared in full in its core and easing back in toward
//    the rim), only on the camera's side of the sprite's own reclined plane, so a keep or a house the figure
//    stands into is thinned where it pokes through him while nothing behind him is touched. Each set piece
//    keeps a share of its picture there: a landmark (castle, village house) enough to still read as a keep,
//    a tree or a rock nothing in the core (crowns stand three deep in a wood, and three faint films are a veil),
//    blending back in over the feather. It is a blend, never a screen-door dither: without temporal anti-aliasing
//    a dither's dots stay on screen, crawl over the picture when the camera moves and flicker when the
//    ellipse does (player report, 2026-11-09). Shadows come from the depth pass and stay whole;
//  - x-ray: what cannot be cut (a cliff or the wall of a tier in front of him, another unit, one cell in front
//    of him or ten) shows the hidden part as a ghost in the side's colour, drawn where the sprite fails the
//    depth test. Nothing that is cut is ever tinted by it (CUT_STENCIL): he is seen through those himself.
import * as THREE from 'three';

const MAX = 24, CUT_STENCIL = 1;
// The ellipse against the figure's opaque box: its half-axes are PAD times the box's, and inside CORE of them
// the cut is whole, so the core reaches the middle of the box's edges and the feather lies outside the figure.
export const CUT_PAD = 1.5, CUT_CORE = 0.66;
// The ellipse of a sprite body in its geometry's own units: centre and half-axes. box: the opaque part of its
// picture there ({ x0, x1, y0, y1 }, body.userData.cutBox), or the whole quad without one.
export function cutEllipse(body) {
  const g = body.geometry, q = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox);
  const b = body.userData.cutBox ?? { x0: q.min.x, x1: q.max.x, y0: q.min.y, y1: q.max.y };
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, rx: (b.x1 - b.x0) / 2 * CUT_PAD, ry: (b.y1 - b.y0) / 2 * CUT_PAD };
}

// Clones the materials of the given objects (shared ones stay untouched for other scenes) and teaches the
// clones the cutout. keep(o) (0-1) is the share of its picture an object and everything under it keeps inside
// the cleared region (the larger of its own and its parents'); the clones are blended, and mark the stencil so
// the x-ray ghost stays off them (xraySprite). Returns update(camera, bodies), bodies being sprite meshes whose
// geometry is a quad standing on its bottom edge (world matrices current); update.rects() is what it last set.
export function seeThrough(objects, { keep = () => 0 } = {}) {
  const u = {
    cutRect: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) }, // centre and 1 / half-axes, in clip space
    cutPlane: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
    cutCount: { value: 0 },
  };
  const clones = new Map();
  const patch = (m, k) => {
    const ck = `${k}`, mine = clones.get(m) ?? clones.set(m, new Map()).get(m);
    if (mine.has(ck)) return mine.get(ck);
    const c = m.clone(), prev = m.onBeforeCompile, key = m.customProgramCacheKey();
    c.onBeforeCompile = (s, r) => {
      prev.call(c, s, r);
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vCutClip; varying vec3 vCutView;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCutClip = gl_Position; vCutView = mvPosition.xyz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vCutClip; varying vec3 vCutView;
          uniform vec4 cutRect[${MAX}]; uniform vec4 cutPlane[${MAX}]; uniform int cutCount;`)
        // After the alpha test: a crown's own cut-out edge is decided by its picture, then what is left of it thins.
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          {
            vec2 p = vCutClip.xy / vCutClip.w; float cut = 0.;
            for (int i = 0; i < ${MAX}; i++) {
              if (i >= cutCount) break;
              vec2 q = (p - cutRect[i].xy) * cutRect[i].zw; float e2 = dot(q, q);
              if (e2 >= 1.) continue; // outside this figure's ellipse: most texels, for most figures
              // Cleared over the figure, easing back in toward the ellipse's rim and across the sprite's plane. Whatever is
              // on the eye's side of that plane at all is cut whole (a crown planted a hand in front of him covered him at
              // half strength when the ease straddled the plane); the ease lies just behind it, where he hides it anyway.
              float side = dot(cutPlane[i].xyz, vCutView) + cutPlane[i].w;
              cut = max(cut, (1. - smoothstep(${CUT_CORE.toFixed(2)}, 1., sqrt(e2))) * smoothstep(-.06, 0., side));
            }
            diffuseColor.a *= 1. - cut * ${(1 - k).toFixed(3)};
            // Cleared whole, a texel is gone (no depth, no stencil), so the cells and marks behind it are drawn as if nothing stood there.
            if (diffuseColor.a < .02) discard;
          }`);
    };
    // Blended, and its texels mark the stencil (one bit: a figure's own bit stays, src/warview.js FIGURE_STENCIL).
    c.transparent = true; c.stencilWrite = true; c.stencilFunc = THREE.AlwaysStencilFunc; c.stencilRef = CUT_STENCIL; c.stencilWriteMask = CUT_STENCIL; c.stencilZPass = THREE.ReplaceStencilOp;
    c.userData = { ...c.userData, cutKeep: k }; // read back by tests (warview probe)
    c.customProgramCacheKey = () => `${key}|cut${ck}`;
    mine.set(ck, c);
    return c;
  };
  const dress = (n, k) => {
    k = Math.max(k, keep(n));
    if (n.isMesh && n.material) n.material = Array.isArray(n.material) ? n.material.map((m) => patch(m, k)) : patch(n.material, k);
    for (const c of n.children) dress(c, k);
  };
  for (const o of objects) dress(o, 0);

  const v = new THREE.Vector3(), lo = new THREE.Vector2(), hi = new THREE.Vector2(), plane = new THREE.Plane(), nm = new THREE.Matrix3(), m4 = new THREE.Matrix4();
  const Z = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  function update(camera, bodies) {
    let n = 0;
    for (const body of bodies) {
      if (n >= MAX) break;
      // The ellipse's own box on screen. A standing figure breathes by stretching its quad (scale.y): the ellipse is
      // that of the figure at rest, or every texel of its rim would change with each breath.
      const { cx, cy, rx, ry } = cutEllipse(body), sy = body.scale.y || 1;
      lo.set(Infinity, Infinity); hi.set(-Infinity, -Infinity);
      for (const x of [cx - rx, cx + rx]) for (const y of [cy - ry, cy + ry]) {
        v.set(x, y / sy, 0).applyMatrix4(body.matrixWorld).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
        lo.min(v); hi.max(v);
      }
      // The sprite's plane in view space, its normal turned toward the eye (at the origin).
      plane.copy(Z).applyMatrix4(m4.multiplyMatrices(camera.matrixWorldInverse, body.matrixWorld), nm.getNormalMatrix(m4));
      if (plane.constant < 0) plane.negate();
      u.cutRect.value[n].set((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 2 / Math.max(hi.x - lo.x, 2e-4), 2 / Math.max(hi.y - lo.y, 2e-4));
      u.cutPlane.value[n].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      n++;
    }
    u.cutCount.value = n;
  }
  update.rects = () => u.cutRect.value.slice(0, u.cutCount.value).map((r) => r.toArray().map((x) => +x.toFixed(5)));
  return update;
}

// The x-ray silhouette: a child of the sprite body sharing its geometry and texture, drawn only where
// something nearer hides the figure: a ghost of the sprite washed toward the side's colour, so the figure
// still reads (armour, horse) and its side is plain at a glance. Whatever stands between him and the camera
// counts, a cell in front of him as much as ten: another general, a cliff or wall, a tree. The quad is drawn
// OWN nearer to the eye, only enough to clear its own picture's depth, so nothing is lost to a gap.
// The ground he stands on and the lip of his own tier are not set pieces: they can reach no higher than his
// hooves, so the bottom HEM of the figure (above where his picture's feet are) never shows the ghost, which
// leaves the ground, the lip, his own ring and the sinking of his feet unable to draw a coloured line, whatever
// tier he stands on. What the cutout thins over him (stencil) is never tinted: he is seen through it himself.
const OWN = 0.05, HEM = 0.16; // view units toward the eye; world units above the feet
export function xraySprite(body, map, color, feet = 0) {
  const m = new THREE.Mesh(body.geometry, new THREE.MeshBasicMaterial({
    map, color, alphaTest: 0.5, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false, toneMapped: false,
    stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: CUT_STENCIL, stencilFuncMask: CUT_STENCIL, stencilWriteMask: 0, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
  }));
  const floor = { value: feet + HEM };
  m.material.onBeforeCompile = (s) => {
    s.uniforms.xrayFloor = floor;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vXrayY;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      vXrayY = position.y; mvPosition.z += ${OWN.toFixed(2)}; gl_Position = projectionMatrix * mvPosition;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vXrayY; uniform float xrayFloor;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nif (vXrayY < xrayFloor) discard;\ndiffuseColor.rgb = diffuse * (.45 + .9 * dot(sampledDiffuseColor.rgb, vec3(.3, .59, .11)));');
  };
  m.renderOrder = 10; m.raycast = () => {};
  body.add(m);
  return m;
}
