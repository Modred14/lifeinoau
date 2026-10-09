// lib3d/stage.js
// Shared 3D setup: renderer, camera, drag-to-rotate controls, a render loop that sleeps when off-screen, and clean-up. Browser only.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createStage(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!opts.alpha, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = opts.exposure ?? 1.05;
  renderer.shadowMap.enabled = opts.shadows !== false; renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in newer three.js
  const el = renderer.domElement; el.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none"; container.appendChild(el);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, 0.1, opts.far ?? 600);
  const controls = new OrbitControls(camera, el); controls.enableDamping = true; controls.dampingFactor = 0.08; Object.assign(controls, opts.controls ?? {});
  const cbs = [], after = []; let fly = null; let last = performance.now(), elapsed = 0, raf = 0, visible = true, alive = true; /* own timer: THREE.Clock is deprecated in newer three.js */
  const resize = () => { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(container);
  const tick = () => { if (!alive) return; raf = requestAnimationFrame(tick); if (!visible || document.hidden) return; const now = performance.now(), raw = (now - last) / 1000; last = now; elapsed += raw; const dt = Math.min(raw, 0.1), t = elapsed; cbs.forEach((f) => f(t, dt)); if (fly) stepFly(dt); controls.update(); renderer.render(scene, camera); after.forEach((f) => f(t, dt)); };
  // button / keyboard alternatives to dragging: rotate, tilt and zoom by a step
  const nudge = ({ az = 0, pol = 0, zoom = 1 } = {}) => { const off = camera.position.clone().sub(controls.target), sp = new THREE.Spherical().setFromVector3(off);
    sp.theta += az; sp.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sp.phi + pol)); sp.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sp.radius * zoom));
    camera.position.copy(controls.target).add(off.setFromSpherical(sp)); controls.update(); };
  // smooth camera move to look at a point from a given distance
  const flyTo = (x, y, z, dist, pol) => { fly = { to: new THREE.Vector3(x, y, z), dist, pol }; };
  function stepFly(dt) { const k = 1 - Math.pow(0.0015, dt), off = camera.position.clone().sub(controls.target), sp = new THREE.Spherical().setFromVector3(off);
    controls.target.lerp(fly.to, k); sp.radius += (fly.dist - sp.radius) * k; if (fly.pol != null) sp.phi += (fly.pol - sp.phi) * k; camera.position.copy(controls.target).add(off.setFromSpherical(sp));
    if (controls.target.distanceTo(fly.to) < 0.15 && Math.abs(sp.radius - fly.dist) < 0.5) fly = null; }
  el.addEventListener("pointerdown", () => { fly = null; }); el.addEventListener("wheel", () => { fly = null; }, { passive: true });
  tick();
  return { THREE, renderer, scene, camera, controls, onFrame: (f) => cbs.push(f), onAfterRender: (f) => after.push(f), nudge, flyTo, resize,
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); }); renderer.dispose(); el.remove(); } };
}