// Strategy markers: receives the scene, board, city footprints and road/height functions; owns rings, beads and pulses.
import * as THREE from 'three';

// Only the hidden portion of a marker is drawn again; a single instanced draw covers all the beads.
const MARK_GHOST_OPACITY = 0.34, BEAD_GHOST_OPACITY = 0.35;

export function createStrategyMarks({ scene, data, sand, world, cityPos, cityReach, pathOf, groundY }) {
  // Rings round a city follow its footprint and lie on the ground: its level pad ends just inside them, and on a
  // hillside a flat ring would sink into the slope. One geometry per city and kind, made on first use.
  const RINGS = { hover: [0.76, 0.94], sel: [0.9, 1.1], cand: [0.82, 1.08] }, ringGeos = new Map();
  const ringOf = (cid, kind) => {
    const key = `${cid}${kind}`;
    if (!ringGeos.has(key)) {
      const c = cityPos[cid], [a, b] = RINGS[kind].map((f) => f * cityReach[cid]), N = 64, pos = [], idx = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N * Math.PI * 2, s = Math.sin(t), co = Math.cos(t);
        for (const r of [a, b]) pos.push(s * r, Math.max(0, world.heightAt(c.x + s * r, c.z + co * r) - c.y), co * r);
        if (k < N) { const v = k * 2; idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      ringGeos.set(key, g);
    }
    return ringGeos.get(key);
  };
  const ring = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#ffe060', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.visible = false; scene.add(ring);
  const selRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#fff4c0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  selRing.visible = false; scene.add(selRing);
  // Map picking (pickMode): the candidate cities glow with a pulsing gold ring, the rest dim.
  const candMat = new THREE.MeshBasicMaterial({ color: '#ffd860', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ghostMat = (mat, opacity) => { const m = mat.clone(); m.depthFunc = THREE.GreaterDepth; m.depthWrite = false; m.opacity = opacity; m.fog = false; m.toneMapped = false; m.forceSinglePass = true; return m; };
  const ringGhostMat = ghostMat(ring.material, MARK_GHOST_OPACITY), selGhostMat = ghostMat(selRing.material, MARK_GHOST_OPACITY), candGhostMat = ghostMat(candMat, MARK_GHOST_OPACITY);
  const ghostRing = (ring, mat) => { const ghost = new THREE.Mesh(ring.geometry, mat); ghost.renderOrder = 4; ghost.userData.strategyGhost = true; ghost.raycast = () => {}; ring.add(ghost); return ghost; };
  const ringGhost = ghostRing(ring, ringGhostMat), selGhost = ghostRing(selRing, selGhostMat);
  const candRings = [];
  const flow = []; // highlighted roads from the selected city
  const pulses = [];
  const flowMat = new THREE.MeshBasicMaterial({ color: '#ffe080', transparent: true, opacity: 0.9 });
  const flowGeo = sand ? new THREE.BoxGeometry(0.045, 0.032, 0.045) : new THREE.BoxGeometry(0.07, 0.05, 0.07);
  const flowGhostMat = ghostMat(flowMat, BEAD_GHOST_OPACITY), ghostMatrix = new THREE.Matrix4();
  let flowGhost = null;
  function hover(cid) {
    ring.visible = cid != null;
    if (cid != null) { ringGhost.geometry = ring.geometry = ringOf(cid, 'hover'); ring.position.copy(cityPos[cid]); ring.position.y += 0.05; }
  }
  function clearSelection(cid) {
    for (const m of flow) scene.remove(m); flow.length = 0;
    if (flowGhost) { scene.remove(flowGhost); flowGhost.dispose(); flowGhost = null; }
    selRing.visible = cid != null;
  }
  function select(cid) {
    if (cid == null) return;
    selGhost.geometry = selRing.geometry = ringOf(cid, 'sel'); selRing.position.copy(cityPos[cid]); selRing.position.y += 0.06;
    for (const n of data.cities[cid].roads) {
      // Beads along the road as drawn, from this city outward.
      const pts = pathOf(cid, n);
      let run = 0, next = 0.3;
      pts.forEach((p, k) => {
        if (k) run += p.distanceTo(pts[k - 1]);
        if (run < next || k > pts.length - 6) return;
        const d = new THREE.Mesh(flowGeo, flowMat); d.position.copy(p); d.userData = { t: run, y: Math.max(p.y, groundY(p.x, p.z)) + 0.06 }; d.position.y = d.userData.y; scene.add(d); flow.push(d); next += 0.18;
      });
    }
    if (flow.length) {
      flowGhost = new THREE.InstancedMesh(flowGeo, flowGhostMat, flow.length); flowGhost.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      flowGhost.renderOrder = 4; flowGhost.frustumCulled = false; flowGhost.userData.strategyGhost = true; flowGhost.raycast = () => {};
      for (let i = 0; i < flow.length; i++) { const p = flow[i].position; flowGhost.setMatrixAt(i, ghostMatrix.makeTranslation(p.x, p.y, p.z)); }
      flowGhost.instanceMatrix.needsUpdate = true; scene.add(flowGhost);
    }
  }
  function clearCandidates() { for (const r of candRings) scene.remove(r); candRings.length = 0; }
  function addCandidates(candidates) {
    for (const cid of candidates ?? []) { const r = new THREE.Mesh(ringOf(cid, 'cand'), candMat); ghostRing(r, candGhostMat); r.position.copy(cityPos[cid]); r.position.y += 0.07; scene.add(r); candRings.push(r); }
  }
  function pulse(cid, color, time) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.copy(cityPos[cid]); m.position.y += 0.08; m.userData.t0 = time; scene.add(m); pulses.push(m);
  }
  function updateRings(time) {
    { const k = 1 + Math.sin(time * 4) * 0.05; selRing.scale.set(k, 1, k); } selRing.material.opacity = 0.55 + Math.sin(time * 4) * 0.3;
    for (const r of candRings) { const k = 1 + 0.08 * (0.5 + 0.5 * Math.sin(time * 5)); r.scale.set(k, 1, k); }
    candMat.opacity = 0.55 + 0.35 * Math.sin(time * 5);
    selGhostMat.opacity = selRing.material.opacity * MARK_GHOST_OPACITY; candGhostMat.opacity = candMat.opacity * MARK_GHOST_OPACITY;
  }
  function updatePulses(time) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const m = pulses[i], k = (time - m.userData.t0) / 0.9;
      m.visible = k >= 0; if (k < 0) continue; // announce() staggers its rings
      if (k >= 1) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); pulses.splice(i, 1); continue; }
      m.scale.setScalar(1 + k * 2.2); m.material.opacity = 1 - k;
    }
  }
  function updateFlow(time) {
    for (let i = 0; i < flow.length; i++) {
      const d = flow[i]; d.position.y = d.userData.y + Math.max(0, Math.sin(time * 6 - d.userData.t * 3)) * 0.08;
      flowGhost.setMatrixAt(i, ghostMatrix.makeTranslation(d.position.x, d.position.y, d.position.z));
    }
    if (flowGhost) flowGhost.instanceMatrix.needsUpdate = true;
  }
  function updateHover(time) { ring.material.opacity = 0.6 + Math.sin(time * 4) * 0.3; ringGhostMat.opacity = ring.material.opacity * MARK_GHOST_OPACITY; }
  return { hover, clearSelection, select, clearCandidates, addCandidates, pulse, updateRings, updatePulses, updateFlow, updateHover,
    addPulse(ring) { pulses.push(ring); }, pulseCount() { return pulses.length; }, lastPulse() { return pulses[pulses.length - 1]; } };
}
