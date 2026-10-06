// lib3d/stage.js
// Shared 3D setup: renderer, camera, drag-to-rotate controls, a render loop that sleeps when off-screen, and clean-up. Browser only.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createStage(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!opts.alpha, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = opts.exposure ?? 1.05;
  renderer.shadowMap.enabled = opts.shadows !== false; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const el = renderer.domElement; el.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none"; container.appendChild(el);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, 0.1, opts.far ?? 600);
  const controls = new OrbitControls(camera, el); controls.enableDamping = true; controls.dampingFactor = 0.08; Object.assign(controls, opts.controls ?? {});
  const cbs = []; const clock = new THREE.Clock(); let raf = 0, visible = true, alive = true;
  const resize = () => { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(container);
  const tick = () => { if (!alive) return; raf = requestAnimationFrame(tick); if (!visible || document.hidden) return; const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime; cbs.forEach((f) => f(t, dt)); controls.update(); renderer.render(scene, camera); };
  tick();
  return { THREE, renderer, scene, camera, controls, onFrame: (f) => cbs.push(f), resize,
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); }); renderer.dispose(); el.remove(); } };
}