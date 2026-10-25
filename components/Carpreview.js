// components/Carpreview.js
// One slowly turning 3D car, drawn with the very same body the game drives (lib3d/vehicles.js makeVehicle). Used on the Ride app's car page,
// one at a time, so there is only ever a single WebGL context. If WebGL is not available the page still works: it just shows no picture.
"use client";
import { useEffect, useRef, useState } from "react";

export default function CarPreview({ modelId, paint, label }) {
  const ref = useRef(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false, raf = 0, stop = () => {};
    (async () => {
      try {
        const THREE = await import("three"), { makeVehicle } = await import("../lib3d/vehicles.js");
        const canvas = ref.current; if (dead || !canvas) return;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100), v = makeVehicle(modelId, paint), still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        scene.add(new THREE.HemisphereLight("#ffffff", "#8a93a3", 1.1)); const sun = new THREE.DirectionalLight("#ffffff", 1.6); sun.position.set(5, 8, 6); scene.add(sun);
        v.root.rotation.y = -0.7; scene.add(v.root);
        const r = Math.max(v.length, v.width * 1.4) * 1.45; cam.position.set(r * 0.55, v.height * 1.25, r); cam.lookAt(0, v.height * 0.42, 0);
        const fit = () => { const w = canvas.clientWidth || 300, h = canvas.clientHeight || 170; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
        fit(); const ro = new ResizeObserver(fit); ro.observe(canvas);
        const tick = () => { if (!still) v.root.rotation.y += 0.008; renderer.render(scene, cam); raf = requestAnimationFrame(tick); }; tick();
        stop = () => { cancelAnimationFrame(raf); ro.disconnect(); v.dispose(); renderer.dispose(); };
        if (dead) stop();
      } catch { if (!dead) setFailed(true); }
    })();
    return () => { dead = true; stop(); };
  }, [modelId, paint]);
  if (failed) return null;
  return <canvas ref={ref} className="cp-canvas" role="img" aria-label={label ?? "3D preview of the car"} />;
}